"""Non-LLM fallback intent parser. Used when OPENAI_API_KEY is unset or the LLM call
fails — CLAUDE.md requires extract_intent to degrade gracefully, not error out."""

from __future__ import annotations

import re

from discovery.schemas import ShoppingIntent

_UNDER_RE = re.compile(r"\b(?:under|below|less than|cheaper than)\s*\$?\s*(\d+(?:\.\d{1,2})?)", re.I)
_OVER_RE = re.compile(r"\b(?:over|above|at least|more than)\s*\$?\s*(\d+(?:\.\d{1,2})?)", re.I)
_BETWEEN_RE = re.compile(
    r"\bbetween\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:and|-|to)\s*\$?\s*(\d+(?:\.\d{1,2})?)", re.I
)
_RANGE_DASH_RE = re.compile(r"\$\s*(\d+(?:\.\d{1,2})?)\s*-\s*\$?\s*(\d+(?:\.\d{1,2})?)")
_EXCLUDE_BRAND_RE = re.compile(
    r"\b(?:not|except|excluding|no|avoid)\s+([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)*)"
)
_MIN_RATING_RE = re.compile(r"\b(\d(?:\.\d)?)\s*(?:\+\s*)?stars?\s*(?:and up|or (?:better|higher|more))?", re.I)
_QUANTITY_RE = re.compile(r"\b(\d+)\s*(?:pack|count|pieces|of them|units)\b", re.I)

_CONDITION_KEYWORDS = {
    "refurbished": "refurbished",
    "used": "used",
    "pre-owned": "used",
    "preowned": "used",
    "new": "new",
}

_CHEAPEST_KEYWORDS = ("cheapest", "lowest price", "least expensive")
_TOP_RATED_KEYWORDS = ("best rated", "highest rated", "top rated")

_ATTRIBUTE_KEYWORDS = (
    "wireless", "noise cancelling", "noise-cancelling", "waterproof", "bluetooth",
    "rechargeable", "portable", "lightweight", "fast charging", "foldable",
)


def _find_price_cents(utterance: str) -> tuple[int | None, int | None]:
    match = _BETWEEN_RE.search(utterance) or _RANGE_DASH_RE.search(utterance)
    if match:
        lo, hi = sorted((float(match.group(1)), float(match.group(2))))
        return round(lo * 100), round(hi * 100)

    max_price = None
    min_price = None
    if match := _UNDER_RE.search(utterance):
        max_price = round(float(match.group(1)) * 100)
    if match := _OVER_RE.search(utterance):
        min_price = round(float(match.group(1)) * 100)
    return min_price, max_price


def _find_brands_exclude(utterance: str) -> list[str]:
    return [m.group(1).strip().rstrip(".,!?") for m in _EXCLUDE_BRAND_RE.finditer(utterance)]


def _find_min_rating(utterance: str) -> float | None:
    if match := _MIN_RATING_RE.search(utterance):
        return float(match.group(1))
    return None


def _find_condition(utterance: str) -> str | None:
    lowered = utterance.lower()
    for keyword, condition in _CONDITION_KEYWORDS.items():
        if keyword in lowered:
            return condition
    return None


def _find_sort_hint(utterance: str) -> str:
    lowered = utterance.lower()
    if any(k in lowered for k in _CHEAPEST_KEYWORDS):
        return "price_low"
    if any(k in lowered for k in _TOP_RATED_KEYWORDS):
        return "rating"
    return "best"


def _find_quantity(utterance: str) -> int:
    if match := _QUANTITY_RE.search(utterance):
        return max(1, min(5, int(match.group(1))))
    return 1


def _find_must_have(utterance: str) -> list[str]:
    lowered = utterance.lower()
    return [kw for kw in _ATTRIBUTE_KEYWORDS if kw in lowered][:5]


def extract_intent_heuristic(utterance: str) -> ShoppingIntent:
    min_price, max_price = _find_price_cents(utterance)
    return ShoppingIntent(
        query=utterance.strip(),
        min_price_cents=min_price,
        max_price_cents=max_price,
        must_have=_find_must_have(utterance),
        exclude_terms=[],
        brands_include=[],
        brands_exclude=_find_brands_exclude(utterance),
        min_rating=_find_min_rating(utterance),
        condition=_find_condition(utterance),
        sort_hint=_find_sort_hint(utterance),
        quantity=_find_quantity(utterance),
    )
