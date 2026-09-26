"""Deterministic base ranker — the unpersonalized baseline F2 will later wrap with a
personal term (CLAUDE.md rule 3: ranking is code, never the LLM). `personal` is fixed
at 0.0 here since no TasteProfile exists yet; F2 adds it without changing this module's
contract (score = (1-w)*base + w*personal, w=0 today).

    base = .45*relevance + .25*constraint_fit + .15*quality + .15*priority_fit

quality uses the exact Bayesian formula from CLAUDE.md's F2 section — it's plain
rating math, not personalization, so F1 can use it as-is."""

from __future__ import annotations

from discovery.dedupe import title_tokens
from discovery.schemas import Product, RankedProduct, ScoreBreakdown, ShoppingIntent

WEIGHTS = {"relevance": 0.45, "constraint_fit": 0.25, "quality": 0.15, "priority_fit": 0.15}
DEFAULT_RATING = 4.0
RATING_PRIOR_WEIGHT = 20


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _normalize(value: float, lo: float, hi: float) -> float:
    if hi <= lo:
        return 0.5
    return _clamp((value - lo) / (hi - lo))


def _relevance(product: Product, query_tokens: frozenset[str], intent: ShoppingIntent) -> float:
    product_tokens = title_tokens(product.title)
    overlap_ratio = (
        len(query_tokens & product_tokens) / len(query_tokens) if query_tokens else 0.5
    )
    if intent.must_have:
        matched = sum(1 for term in intent.must_have if title_tokens(term) <= product_tokens)
        must_have_ratio = matched / len(intent.must_have)
    else:
        must_have_ratio = 1.0
    return _clamp(0.6 * overlap_ratio + 0.4 * must_have_ratio)


def _constraint_fit(product: Product, intent: ShoppingIntent) -> float:
    """Hard filters already gate admission; this rewards being centered in an explicit
    price range rather than sitting right at an edge."""
    if intent.min_price_cents is None or intent.max_price_cents is None:
        return 1.0
    lo, hi = intent.min_price_cents, intent.max_price_cents
    if hi <= lo:
        return 1.0
    center = (lo + hi) / 2
    distance = abs(product.price_cents - center) / ((hi - lo) / 2)
    return _clamp(1.0 - 0.3 * _clamp(distance))


def _quality(product: Product) -> float:
    rating = product.rating if product.rating is not None else DEFAULT_RATING
    count = product.rating_count
    bayesian = (count / (count + RATING_PRIOR_WEIGHT)) * rating + (
        RATING_PRIOR_WEIGHT / (count + RATING_PRIOR_WEIGHT)
    ) * DEFAULT_RATING
    return _clamp(bayesian / 5.0)


def _priority_fit_all(products: list[Product], intent: ShoppingIntent) -> list[float]:
    if intent.sort_hint == "price_low":
        prices = [p.price_cents for p in products]
        lo, hi = min(prices), max(prices)
        return [1.0 - _normalize(p.price_cents, lo, hi) for p in products]
    if intent.sort_hint == "rating":
        ratings = [p.rating if p.rating is not None else DEFAULT_RATING for p in products]
        lo, hi = min(ratings), max(ratings)
        return [_normalize(r, lo, hi) for r in ratings]
    return [0.5] * len(products)


def _reasons(product: Product, intent: ShoppingIntent, breakdown: ScoreBreakdown) -> list[str]:
    reasons: list[str] = []

    if intent.max_price_cents is not None:
        reasons.append(f"Under your ${intent.max_price_cents / 100:.0f} cap")
    elif intent.min_price_cents is not None:
        reasons.append(f"Above your ${intent.min_price_cents / 100:.0f} floor")

    if product.rating is not None and product.rating_count:
        reasons.append(f"{product.rating:.1f}★ from {product.rating_count:,} reviews")

    if len(reasons) < 3 and intent.must_have:
        product_tokens = title_tokens(product.title)
        for term in intent.must_have:
            if title_tokens(term) <= product_tokens:
                reasons.append(f"Matches '{term}'")
                break

    if len(reasons) < 3:
        if intent.sort_hint == "price_low" and breakdown.priority_fit >= 0.75:
            reasons.append("One of the lowest prices in your results")
        elif intent.sort_hint == "rating" and breakdown.priority_fit >= 0.75:
            reasons.append("Top rated among your results")
        elif product.on_sale:
            reasons.append("Currently on sale")
        elif product.free_shipping:
            reasons.append("Free shipping")

    return reasons[:3]


def rank_products(products: list[Product], intent: ShoppingIntent) -> list[RankedProduct]:
    if not products:
        return []

    query_tokens = title_tokens(intent.query)
    priority_fits = _priority_fit_all(products, intent)

    ranked: list[RankedProduct] = []
    for product, priority_fit in zip(products, priority_fits):
        relevance = _relevance(product, query_tokens, intent)
        constraint_fit = _constraint_fit(product, intent)
        quality = _quality(product)
        base = (
            WEIGHTS["relevance"] * relevance
            + WEIGHTS["constraint_fit"] * constraint_fit
            + WEIGHTS["quality"] * quality
            + WEIGHTS["priority_fit"] * priority_fit
        )
        breakdown = ScoreBreakdown(
            relevance=relevance,
            constraint_fit=constraint_fit,
            quality=quality,
            priority_fit=priority_fit,
            base=base,
            personal=0.0,
            score=base,
        )
        ranked.append(
            RankedProduct(
                **product.model_dump(),
                score=base,
                breakdown=breakdown,
                reasons=_reasons(product, intent, breakdown),
            )
        )

    ranked.sort(key=lambda p: (-p.score, p.price_cents, p.id))
    return ranked
