"""Small deterministic reranker with page-wide identity deduplication."""
import re
from discovery.personalization import aliases


def similar(left, right):
    def tokens(product):
        return set(re.findall(r"[a-z0-9]+", str(product.get("title") or "").lower())) - {"the", "with", "for", "and", "a"}
    a, b = tokens(left), tokens(right)
    if min(len(a), len(b)) < 3:
        return False
    return len(a & b) / max(1, len(a | b)) >= .7


def rank_sections(sections, profile, limit=6):
    negative = profile["negative_products"]
    purchased = profile["purchased_products"]
    recommended = set().union(*(aliases(p) for p in profile["recommended"])) if profile["recommended"] else set()
    summary = profile["summary"]
    candidates, suppressed = [], 0
    for section_index, section in enumerate(sections):
        for index, product in enumerate(section["products"]):
            keys = aliases(product)
            if not keys or not product.get("title") or product.get("price_cents", -1) < 0:
                continue
            blocked = any(keys & aliases(p) for p in purchased)
            penalty = 0
            for entry in negative:
                exact = bool(keys & aliases(entry["product"]))
                alike = similar(product, entry["product"])
                if entry["kind"] in ("dislike", "hide") and (exact or alike):
                    blocked = True
                elif exact or alike:
                    penalty += .25
            if blocked:
                suppressed += 1
                continue
            category = (product.get("category") or section["category"]).lower()
            brand = (product.get("brand") or "").lower()
            score = float(product.get("score") or 0) + .06 * summary["category_affinity"].get(category, 0)
            score += .05 * min(3, summary["brand_affinity"].get(brand, 0))
            score -= penalty + (.35 if keys & recommended else 0)
            # Reward query/title relevance when the same candidate matches two sections.
            query_tokens = set(section["search_query"].lower().split())
            score += .1 * len(query_tokens & set(product["title"].lower().split())) / max(1, len(query_tokens))
            candidates.append((score, section_index, index, product, keys))
        section["products"] = []
    seen, duplicates = set(), 0
    for score, section_index, index, product, keys in sorted(candidates, key=lambda row: (-row[0], row[1], row[2])):
        if keys & seen:
            duplicates += 1
            continue
        section = sections[section_index]
        if len(section["products"]) >= limit:
            continue
        seen.update(keys)
        section["products"].append(product)
    for section in sections:
        if not section["products"] and section["status"] == "ok":
            section["status"] = "empty"
    return sections, {"suppressed": suppressed, "duplicates": duplicates, "candidates": len(candidates)}
