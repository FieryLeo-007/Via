"""Search E-commerce marketplaces, normalize, resolve retailer offers, and rank."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, wait
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

PROVIDER_TIMEOUT_SECONDS = 12.0
TOTAL_TIMEOUT_SECONDS = 15.0
MAX_RESULTS = 10

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

    pool = ThreadPoolExecutor(max_workers=max(1, len(providers)))
    try:
        futures = {
            pool.submit(_run_provider, provider, intent, mode, cache, PROVIDER_TIMEOUT_SECONDS): provider
            for provider in providers
        }
        done, not_done = wait(futures, timeout=TOTAL_TIMEOUT_SECONDS)

        for future in done:
            provider = futures[future]
            raw_products, source = future.result()
            sources.append(source)
            normalizer = normalize_openwebninja if mode == "fixtures" else _NORMALIZERS.get(provider.name)
            if normalizer:
                for raw in raw_products:
                    try:
                        product = normalizer(raw)
                        if product is not None: all_products.append(product)
                    except (TypeError, ValueError, ValidationError):
                        continue

        for future in not_done:
            provider = futures[future]
            sources.append(SearchSource(name=provider.name, status="timeout", count=0, elapsed_ms=int(TOTAL_TIMEOUT_SECONDS * 1000)))

    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    if mode != "fixtures":
        all_products = _resolve_google_links(all_products, intent, providers, cache)
        # Unresolved Google offers are omitted rather than sending users to Google.
        all_products = [p for p in all_products if p.source != "ecommerce:google-shopping" or merchant_product_url(p.merchant_url)]
    filtered = apply_hard_filters(all_products, intent)
    deduped = dedupe(filtered)
    ranked = rank_products(deduped, intent)
    partial = any(s.status != "ok" for s in sources)

    return SearchResult(results=ranked[:MAX_RESULTS], sources=sources, partial=partial)


def _resolve_google_links(products, intent, providers, cache):
    provider = next((p for p in providers if p.name == "ecommerce:google-shopping"), None)
    if provider is None: return products
    # Resolve at most 20 promising candidates, rather than one call for every listing.
    shortlist = rank_products(apply_hard_filters(products, intent), intent)
    originals = {p.id: p for p in products}
    pending = [originals[p.id] for p in shortlist if p.source == provider.name and not p.merchant_url][:20]
    if not pending: return products

    def resolve(product):
        key = make_cache_key(provider.name, {"api": BASE_URL, "offers": product.source_id})
        cached = cache.get(key)
        offers = cached["offers"] if cached is not None else provider.raw_offers(product.source_id, timeout=8.0)
        if cached is None: cache.set(key, {"offers": offers})
        # Recheck constraints against each actual offer, before selecting a merchant.
        eligible = []
        for offer in offers:
            candidate = apply_merchant_offers(product, [offer])
            if candidate.merchant_url and apply_hard_filters([candidate], intent):
                eligible.append(offer)
        return apply_merchant_offers(product, eligible)

    pool = ThreadPoolExecutor(max_workers=10)
    resolved = {}
    try:
        futures = {pool.submit(resolve, p): p for p in pending}
        done, _ = wait(futures, timeout=18.0)
        for future in done:
            try:
                product = future.result()
                resolved[product.id] = product
            except Exception:
                # A failed offer lookup never turns into a fabricated or Google link.
                continue
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return [resolved.get(p.id, p) for p in products]
