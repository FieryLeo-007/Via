"""Hard filters per CLAUDE.md F1 spec: price range, excluded brands/terms, min rating,
condition. `must_have` is deliberately NOT a hard filter here (it isn't listed as one) —
it's a relevance signal handled in rank.py, since a match can be implied without the
literal term appearing in the title."""

from __future__ import annotations

from discovery.schemas import Product, ShoppingIntent


def _fails(product: Product, intent: ShoppingIntent) -> bool:
    if intent.min_price_cents is not None and product.price_cents < intent.min_price_cents:
        return True
    if intent.max_price_cents is not None and product.price_cents > intent.max_price_cents:
        return True
    if intent.min_rating is not None and (product.rating is None or product.rating < intent.min_rating):
        return True
    if intent.condition and intent.condition != "any" and product.condition and product.condition != intent.condition:
        return True

    excluded_brands = {b.lower() for b in intent.brands_exclude}
    if excluded_brands and product.brand and product.brand.lower() in excluded_brands:
        return True

    title_lower = product.title.lower()
    for term in intent.exclude_terms:
        if term.lower() in title_lower:
            return True

    return False


def apply_hard_filters(products: list[Product], intent: ShoppingIntent) -> list[Product]:
    return [p for p in products if not _fails(p, intent)]
