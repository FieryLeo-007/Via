"""Bounded, recency-aware signals. The planner never receives account identifiers."""
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import re
from urllib.parse import urlsplit, urlunsplit

WEIGHTS = {"impression": .1, "view": .25, "click": .4, "compare": .5, "save": .7,
           "add_to_cart": .85, "purchase": 1., "remove_from_cart": -.3, "dislike": -1., "hide": -1.}
META_CATEGORIES = {"shopping_category", "shopping_priority", "price_behavior", "recommendation_style",
                   "fulfillment", "social_proof", "brand", "exclusions"}


def clean(value, limit=160):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def age(value, now):
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return max(0, (now - date.replace(tzinfo=date.tzinfo or timezone.utc)).total_seconds() / 86400)
    except (TypeError, ValueError, AttributeError):
        return 180.


def decay(value, now):
    return 2 ** (-age(value, now) / 30)


def aliases(product):
    result = set()
    for key in ("id", "product_id"):
        if product.get(key):
            result.add("id:" + str(product[key]))
    if product.get("source_id") and product.get("source"):
        result.add(f"merchant:{product['source']}:{product['source_id']}")
    for key in ("merchant_url", "product_page_url"):
        try:
            url = urlsplit(product.get(key) or "")
            if url.hostname and url.path.strip("/"):
                # Keep identity-bearing query params (e.g. ?sku=), dropping tracking only.
                from urllib.parse import parse_qsl, urlencode
                query = urlencode(sorted((k, v) for k, v in parse_qsl(url.query)
                    if not k.lower().startswith("utm_") and k.lower() not in {"ref", "tag", "gclid", "fbclid"}))
                result.add("url:" + urlunsplit(("https", url.hostname.lower(), url.path.rstrip("/"), query, "")))
        except ValueError:
            pass
    title = re.sub(r"[^a-z0-9]+", " ", clean(product.get("title"), 300).lower()).strip()
    if title:
        result.add("title:" + title + ":" + clean(product.get("store_name") or product.get("source")).lower())
    return result


def snapshot(product, category=None):
    return {"title": clean(product.get("title")), "category": clean(product.get("category") or category).lower(),
            "brand": clean(product.get("brand"), 60), "price_cents": product.get("price_cents")}


def fingerprint(data):
    # Impressions/recommendation writes must not invalidate the strategy they created.
    relevant = {key: data.get(key, []) for key in ("onboarding_preferences", "user_preferences", "saved_products", "chat_turns")}
    relevant["user_events"] = [row for row in data.get("user_events", []) if row.get("event_type") != "impression"]
    relevant["search_sessions"] = [row for row in data.get("search_sessions", []) if (row.get("parsed_intent") or {}).get("source") != "discover"]
    return hashlib.sha256(json.dumps(relevant, sort_keys=True, default=str).encode()).hexdigest()


def build_profile(data, now=None):
    now = now or datetime.now(timezone.utc)
    categories, brands = defaultdict(float), defaultdict(float)
    preferences = {}
    for table, strength in (("onboarding_preferences", 1.5), ("user_preferences", 3.0)):
        # Oldest first; newer explicit preferences replace onboarding values with same key.
        for row in reversed(data.get(table, [])):
            category, key = clean(row.get("category")).lower(), clean(row.get("preference_key"))
            try:
                importance = min(1., max(0., float(row.get("importance") if row.get("importance") is not None else .7)))
            except (ValueError, TypeError):
                importance = .7
            preferences[(category, key)] = {"category": category, "key": key,
                "value": row.get("preference_value"), "strength": strength * importance,
                "source": "explicit" if table == "user_preferences" else "onboarding"}
    for pref in preferences.values():
        category, value = pref["category"], pref["value"]
        if category == "shopping_category" and value is True:
            categories[pref["key"].replace("_", " ").lower()] += pref["strength"]
        elif category and category not in META_CATEGORIES:
            categories[category] += pref["strength"] * (1 if value is not False else -1)
        if pref["key"] == "preferred_brands" and isinstance(value, list):
            for brand in value[:10]:
                brands[clean(brand, 60).lower()] += pref["strength"]
    positive, negative, purchased = [], [], []
    negative_products, purchased_products = [], []
    seen, impression_budget = set(), .15
    product_scores, negative_categories = defaultdict(float), defaultdict(set)
    events = sorted(data.get("user_events", []), key=lambda row: row.get("created_at") or "", reverse=True)
    for row in events:
        kind = row.get("event_type")
        if kind not in WEIGHTS:
            continue
        product = row.get("product_data") or {}
        if not isinstance(product, dict):
            continue
        keys = aliases(product)
        identity = sorted(keys)[0] if keys else clean(product.get("title"))
        dedup = (identity, kind)  # One contribution per product/action, not click spam.
        if not identity or dedup in seen:
            continue
        seen.add(dedup)
        factor = decay(row.get("created_at"), now)
        score = WEIGHTS[kind] * factor
        if kind == "impression":
            score = min(score, impression_budget)
            impression_budget -= score
        info = snapshot(product, row.get("category"))
        category = info["category"]
        # One rejection doesn't blacklist a whole category or brand.
        if score < 0:
            negative.append({**info, "event": kind, "signal": round(score, 3)})
            if factor >= .125:
                negative_products.append({"product": product, "kind": kind})
            if category:
                negative_categories[category].add(identity)
        else:
            contribution = min(score, max(0., 1.5 - product_scores[identity]))
            product_scores[identity] += contribution
            if category:
                categories[category] += min(contribution, .7)
            if info["brand"]:
                brands[info["brand"].lower()] += min(contribution, .5)
            if kind != "impression":
                positive.append({**info, "event": kind, "signal": round(score, 3)})
        if kind == "purchase" and age(row.get("created_at"), now) < 60:
            purchased.append(info)
            purchased_products.append(product)
    for category, identities in negative_categories.items():
        if len(identities) >= 3:
            categories[category] -= min(2, len(identities) * .3)
    saved = []
    for row in data.get("saved_products", [])[:40]:
        product = row.get("product_data") or {}
        if isinstance(product, dict):
            info = snapshot(product)
            saved.append(info)
            if info["category"]:
                categories[info["category"]] += .7 * max(.2, decay(row.get("created_at"), now))
    searches, seen_queries = [], set()
    rows = data.get("search_sessions", []) + data.get("chat_turns", [])
    for row in sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True):
        intent = row.get("parsed_intent") or row.get("intent") or {}
        query = clean(row.get("query"), 180)
        if intent.get("source") == "discover" or not query or query.lower() in seen_queries:
            continue
        seen_queries.add(query.lower())
        category = clean(row.get("category") or intent.get("category")).lower()
        signal = .25 * decay(row.get("created_at"), now)
        searches.append({"query": query, "category": category, "signal": round(signal, 3)})
        if category:
            categories[category] += signal
        if len(searches) >= 12:
            break
    recent_products = [snapshot(p) for turn in data.get("chat_turns", [])[:5]
                       for p in (turn.get("products") or [])[:3] if isinstance(p, dict)]
    recommended = [row.get("product_data") or {"id": row.get("product_id")}
                   for row in data.get("recommendation_results", []) if age(row.get("created_at"), now) < 14]
    # Truncate free-text values before the model boundary, keeping valid JSON (not raw dumps).
    compact_preferences = [{**p, "value": clean(json.dumps(p["value"], ensure_ascii=False), 240)}
                           for p in sorted(preferences.values(), key=lambda p: -p["strength"])[:25]]
    summary = {"preferences": compact_preferences,
        "category_affinity": dict(sorted(((k, round(min(5, v), 3)) for k, v in categories.items() if k), key=lambda kv: -kv[1])[:10]),
        "brand_affinity": dict(sorted(brands.items(), key=lambda kv: -kv[1])[:8]),
        "positive_signals": sorted(positive, key=lambda p: -p["signal"])[:16],
        "negative_signals": negative[:16], "recent_searches": searches,
        "purchased_products": purchased[:8], "saved_products": saved[:12], "recent_products": recent_products[:10],
        "previously_recommended": [snapshot(p) for p in recommended[:10]]}
    useful = bool(preferences or positive or saved or searches or negative)
    return {"summary": summary, "preferences": list(preferences.values()), "negative_products": negative_products, "purchased_products": purchased_products,
            "recommended": recommended, "cold_start": not useful, "fingerprint": fingerprint(data)}
