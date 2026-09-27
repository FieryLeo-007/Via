"""Search E-commerce marketplaces, normalize, resolve retailer offers, and rank."""

from __future__ import annotations

import time
import math
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Optional
from functools import partial
from pydantic import ValidationError

from discovery.cache import CacheStore, SqliteCache, make_cache_key
from discovery.data_mode import get_data_mode, load_fixture
from discovery.dedupe import dedupe
from discovery.filters import apply_hard_filters
from discovery.normalize import normalize_openwebninja, normalize_ecommerce, apply_merchant_offers, merchant_product_url
from discovery.providers.base import Provider, ProviderError
from discovery.providers.openwebninja import OpenWebNinjaProvider, MARKETPLACES, BASE_URL
from discovery.rank import rank_products
from discovery.schemas import Product, SearchResult, SearchSource, ShoppingIntent

PROVIDER_TIMEOUT_SECONDS = 6.0
TOTAL_TIMEOUT_SECONDS = 6.0
# Once this share of marketplaces has answered, the rest get a short grace period
# instead of holding every search hostage to the slowest source.
QUORUM_FRACTION = 0.7
STRAGGLER_GRACE_SECONDS = 1.0
MAX_OFFER_LOOKUPS = 12
OFFER_TIMEOUT_SECONDS = 4.0
OFFER_TOTAL_TIMEOUT_SECONDS = 4.0
OFFER_WORKERS = 12
MAX_RESULTS = 10
GOOGLE = "ecommerce:google-shopping"

_NORMALIZERS = {
    **{f"ecommerce:{source}": partial(normalize_ecommerce, marketplace=source) for source in MARKETPLACES},
    "openwebninja": normalize_openwebninja,  # Offline recorded fixture format only.
}


def _run_provider(
    provider: Provider, intent: ShoppingIntent, mode: str, cache: CacheStore, timeout: float
) -> tuple[list[dict], SearchSource]:
    start = time.monotonic()

    if mode == "fixtures":
        raw = load_fixture("openwebninja" if provider.name == "ecommerce:google-shopping" else provider.name, intent)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        if raw is None:
            return [], SearchSource(name=provider.name, status="error", count=0, elapsed_ms=elapsed_ms, error="no fixture match")
        return raw, SearchSource(name=provider.name, status="ok", count=len(raw), elapsed_ms=elapsed_ms)

    cache_key = make_cache_key(provider.name, {"mode": mode, "api": BASE_URL, **provider.cache_params(intent)})
    cached = cache.get(cache_key)
    if cached is not None:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return cached["products"], SearchSource(name=provider.name, status="ok", count=len(cached["products"]), elapsed_ms=elapsed_ms)

    if mode == "hybrid":
        raw = load_fixture("openwebninja" if provider.name == "ecommerce:google-shopping" else provider.name, intent)
        if raw is not None:
            cache.set(cache_key, {"products": raw})
            elapsed_ms = int((time.monotonic() - start) * 1000)
            return raw, SearchSource(name=provider.name, status="ok", count=len(raw), elapsed_ms=elapsed_ms)

    try:
        raw = provider.raw_search(intent, timeout=timeout)
        cache.set(cache_key, {"products": raw})
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return raw, SearchSource(name=provider.name, status="ok", count=len(raw), elapsed_ms=elapsed_ms)
    except ProviderError as exc:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return [], SearchSource(name=provider.name, status="error", count=0, elapsed_ms=elapsed_ms, error=str(exc))
    except Exception as exc:  # noqa: BLE001 - httpx timeout and friends land here
        elapsed_ms = int((time.monotonic() - start) * 1000)
        status = "timeout" if "timeout" in type(exc).__name__.lower() else "error"
        return [], SearchSource(name=provider.name, status=status, count=0, elapsed_ms=elapsed_ms, error=str(exc))


def search_products(
    intent: ShoppingIntent,
    providers: Optional[list[Provider]] = None,
    cache: Optional[CacheStore] = None,
) -> SearchResult:
    providers = providers if providers is not None else [OpenWebNinjaProvider(marketplace=source) for source in MARKETPLACES]
    cache = cache or SqliteCache()
    mode = get_data_mode()
    if mode == "fixtures":
        providers = [p for p in providers if p.name == "ecommerce:google-shopping"] or providers

    sources: list[SearchSource] = []
    all_products: list[Product] = []
    google = next((p for p in providers if p.name == GOOGLE), None) if mode != "fixtures" else None
    offers_pool = ThreadPoolExecutor(max_workers=OFFER_WORKERS)
    offer_futures: dict = {}

    # Stragglers keep running after the deadline and still write the cache, so a
    # slow marketplace speeds up the next search instead of blocking this one.
    pool = ThreadPoolExecutor(max_workers=max(1, len(providers)))
    try:
        futures = {
            pool.submit(_run_provider, provider, intent, mode, cache, PROVIDER_TIMEOUT_SECONDS): provider
            for provider in providers
        }
        start = time.monotonic()
        deadline = start + TOTAL_TIMEOUT_SECONDS
        quorum = max(1, math.ceil(len(providers) * QUORUM_FRACTION))
        pending = set(futures)
        while pending:
            done, pending = wait(pending, timeout=max(0.0, deadline - time.monotonic()), return_when=FIRST_COMPLETED)
            if not done:
                break
            for future in done:
                provider = futures[future]
                raw_products, source = future.result()
                sources.append(source)
                products = _normalize_all(provider, raw_products, mode)
                all_products.extend(products)
                if provider is google:
                    # Resolve retailer offers now, overlapping with the other marketplaces.
                    offer_futures = _start_offer_resolution(products, intent, google, cache, offers_pool)
            if len(futures) - len(pending) >= quorum:
                deadline = min(deadline, time.monotonic() + STRAGGLER_GRACE_SECONDS)

        elapsed_ms = int((time.monotonic() - start) * 1000)
        for future in pending:
            provider = futures[future]
            sources.append(SearchSource(name=provider.name, status="timeout", count=0, elapsed_ms=elapsed_ms))

        if google is not None:
            all_products = _finish_offer_resolution(all_products, offer_futures)
            # Unresolved Google offers are omitted rather than sending users to Google.
            all_products = [p for p in all_products if p.source != GOOGLE or merchant_product_url(p.merchant_url)]
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
        offers_pool.shutdown(wait=False, cancel_futures=True)

    filtered = apply_hard_filters(all_products, intent)
    deduped = dedupe(filtered)
    ranked = rank_products(deduped, intent)
    partial = any(s.status != "ok" for s in sources)

    return SearchResult(results=ranked[:MAX_RESULTS], sources=sources, partial=partial)


def _normalize_all(provider: Provider, raw_products: list[dict], mode: str) -> list[Product]:
    normalizer = normalize_openwebninja if mode == "fixtures" else _NORMALIZERS.get(provider.name)
    products: list[Product] = []
    if normalizer:
        for raw in raw_products:
            try:
                product = normalizer(raw)
                if product is not None: products.append(product)
            except (TypeError, ValueError, ValidationError):
                continue
    return products


def _start_offer_resolution(products, intent, provider, cache, pool) -> dict:
    # Resolve only the most promising candidates, rather than one call for every listing.
    shortlist = rank_products(apply_hard_filters(products, intent), intent)
    originals = {p.id: p for p in products}
    pending = [originals[p.id] for p in shortlist if not p.merchant_url][:MAX_OFFER_LOOKUPS]

    def resolve(product):
        key = make_cache_key(provider.name, {"api": BASE_URL, "offers": product.source_id})
        cached = cache.get(key)
        offers = cached["offers"] if cached is not None else provider.raw_offers(product.source_id, timeout=OFFER_TIMEOUT_SECONDS)
        if cached is None: cache.set(key, {"offers": offers})
        # Recheck constraints against each actual offer, before selecting a merchant.
        eligible = []
        for offer in offers:
            candidate = apply_merchant_offers(product, [offer])
            if candidate.merchant_url and apply_hard_filters([candidate], intent):
                eligible.append(offer)
        return apply_merchant_offers(product, eligible)

    started = time.monotonic()
    return {pool.submit(resolve, p): started for p in pending}


def _finish_offer_resolution(products, offer_futures: dict):
    if not offer_futures: return products
    started = min(offer_futures.values())
    done, _ = wait(offer_futures, timeout=max(0.0, started + OFFER_TOTAL_TIMEOUT_SECONDS - time.monotonic()))
    resolved = {}
    for future in done:
        try:
            product = future.result()
            resolved[product.id] = product
        except Exception:
            # A failed offer lookup never turns into a fabricated or Google link.
            continue
    return [resolved.get(p.id, p) for p in products]
