"""Minimal shopping context, using the verified user's RLS-scoped connection."""
from concurrent.futures import ThreadPoolExecutor
import json
import math
import re

import httpx

SENSITIVE = re.compile(r"payment|card|address|email|phone|postal|zip|token|secret|recipient|cvv|cvc|bank", re.I)
CARD_NUMBER = re.compile(r"(?:\d[ -]?){13,19}")


def clean(value, depth=0):
    if depth > 3:
        return None
    if isinstance(value, str):
        # Free-text preferences are not a channel for credentials or card numbers.
        if CARD_NUMBER.search(value) or re.search(r"(?:shipping|billing)\s+address|(?:credit|debit)\s+card", value, re.I):
            return None
        return re.sub(r"\s+", " ", value).strip()[:240]
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, list):
        return [item for item in (clean(item, depth + 1) for item in value[:10]) if item is not None]
    if isinstance(value, dict):
        return {str(key)[:60]: sanitized for key, item in list(value.items())[:15]
                if not SENSITIVE.search(str(key)) and (sanitized := clean(item, depth + 1)) is not None}
    return None


def shopping_context(account, user_id):
    specs = {
        "users": {"select": "full_name,shirt_size,shoe_size,max_spending_budget", "id": f"eq.{user_id}", "limit": "1"},
        **{table: {"select": "category,preference_key,preference_value,importance", "user_id": f"eq.{user_id}",
                   "order": "updated_at.desc", "limit": "50"}
           for table in ("onboarding_preferences", "user_preferences")},
    }

    def fetch(item):
        table, params = item
        try:
            rows = account.rows(table, params)
            return table, rows if isinstance(rows, list) else []
        except (httpx.HTTPError, ValueError, AttributeError, TypeError):
            return table, []

    with ThreadPoolExecutor(max_workers=3) as pool:
        data = dict(pool.map(fetch, specs.items()))
    row = data["users"][0] if data["users"] and isinstance(data["users"][0], dict) else {}
    profile = {field: clean(row[field]) for field in ("full_name", "shirt_size", "shoe_size") if row.get(field)}
    profile = {key: value for key, value in profile.items() if value is not None}
    try:
        budget = float(row["max_spending_budget"])
        if not isinstance(row["max_spending_budget"], bool) and math.isfinite(budget) and budget >= 0:
            profile["max_spending_budget_usd"] = budget
    except (KeyError, ValueError, TypeError, OverflowError):
        pass
    context = {"profile": profile, "onboarding_preferences": [], "user_preferences": []}
    for table in ("onboarding_preferences", "user_preferences"):
        for pref in data[table]:
            if not isinstance(pref, dict):
                continue
            category, key = str(pref.get("category") or ""), str(pref.get("preference_key") or "")
            if not category or not key or SENSITIVE.search(category + " " + key):
                continue
            value = clean(pref.get("preference_value"))
            if value is None or value == {} or value == []:
                continue
            entry = {"category": clean(category), "key": clean(key), "value": value}
            importance = clean(pref.get("importance"))
            if isinstance(importance, (int, float)) and not isinstance(importance, bool) and 0 <= importance <= 1:
                entry["importance"] = importance
            context[table].append(entry)
    # Leave room for explicit preferences when onboarding has many rows.
    while len(json.dumps(context, ensure_ascii=False)) > 6000:
        largest = max(("onboarding_preferences", "user_preferences"), key=lambda table: len(context[table]))
        if not context[largest]:
            break
        context[largest].pop()
    return context
