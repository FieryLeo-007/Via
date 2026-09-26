"""Dedupe on normalized title tokens + brand: keep the lowest price, the rest become
alt_offers (CLAUDE.md F1 spec). Two items are the same product when their title token
sets overlap heavily (Jaccard >= 0.9) and their brands don't actively disagree — brand
is often unknown (OpenWeb Ninja doesn't return one), so a missing brand on either side
doesn't block a match; only a confirmed mismatch does."""

from __future__ import annotations

import re

from discovery.schemas import AltOffer, Product

_STOPWORDS = {
    "the", "a", "an", "with", "and", "for", "of", "in", "on",
    "new", "pack", "set", "kit",
}
_TOKEN_RE = re.compile(r"[a-z0-9]+")

SIMILARITY_THRESHOLD = 0.9


def title_tokens(title: str) -> frozenset[str]:
    tokens = _TOKEN_RE.findall(title.lower())
    return frozenset(t for t in tokens if t not in _STOPWORDS)


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union else 0.0


def _is_duplicate(a: Product, b: Product, tokens_a: frozenset[str], tokens_b: frozenset[str]) -> bool:
    if a.brand and b.brand and a.brand.lower() != b.brand.lower():
        return False
    return _jaccard(tokens_a, tokens_b) >= SIMILARITY_THRESHOLD


def _as_alt_offer(product: Product) -> AltOffer:
    return AltOffer(
        store_name=product.store_name or product.source,
        price_cents=product.price_cents,
        url=product.merchant_url or product.product_page_url,
    )


def dedupe(products: list[Product]) -> list[Product]:
    tokens = [title_tokens(p.title) for p in products]
    n = len(products)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(n):
        for j in range(i + 1, n):
            if _is_duplicate(products[i], products[j], tokens[i], tokens[j]):
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)

    deduped: list[Product] = []
    for indices in clusters.values():
        cluster = [products[i] for i in indices]
        cluster.sort(key=lambda p: (p.price_cents, p.id))
        primary, rest = cluster[0], cluster[1:]
        if rest:
            primary = primary.model_copy(update={"alt_offers": [_as_alt_offer(p) for p in rest]})
        deduped.append(primary)

    return deduped
