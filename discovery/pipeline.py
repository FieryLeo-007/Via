"""Orchestrates F1's request path: providers in parallel (6s/provider, 8s total,
partial results OK) -> normalize -> merge -> dedupe -> hard filters -> rank.

merchant_url enrichment via /product-offers (needed to resolve a real, non-Google
purchase link) is intentionally not wired into this pass — every result's
merchant_url is None (spec-compliant "view-only" fallback) until that's built, since
it would mean an extra live call per candidate and this pass is scoped to search only.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Optional

from discovery.cache import CacheStore, SqliteCache, make_cache_key
from discovery.data_mode import get_data_mode, load_fixture
from discovery.dedupe import dedupe
from discovery.filters import apply_hard_filters
from discovery.normalize import normalize_openwebninja
from discovery.providers.base import Provider, ProviderError
from discovery.providers.openwebninja import OpenWebNinjaProvider
from discovery.rank import rank_products
from discovery.schemas import Product, SearchResult, SearchSource, ShoppingIntent

PROVIDER_TIMEOUT_SECONDS = 6.0
TOTAL_TIMEOUT_SECONDS = 8.0
MAX_RESULTS = 10

_NORMALIZERS = {
    "openwebninja": normalize_openwebninja,
}


def _run_provider(
    provider: Provider, intent: ShoppingIntent, mode: str, cache: CacheStore, timeout: float
) -> tuple[list[dict], SearchSource]:
    start = time.monotonic()

    if mode == "fixtures":
        raw = load_fixture(provider.name, intent)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        if raw is None:
            return [], SearchSource(name=provider.name, status="error", count=0, elapsed_ms=elapsed_ms, error="no fixture match")
        return raw, SearchSource(name=provider.name, status="ok", count=len(raw), elapsed_ms=elapsed_ms)

    cache_key = make_cache_key(provider.name, {"mode": mode, **provider.cache_params(intent)})
    cached = cache.get(cache_key)
    if cached is not None:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return cached["products"], SearchSource(name=provider.name, status="ok", count=len(cached["products"]), elapsed_ms=elapsed_ms)

    if mode == "hybrid":
        raw = load_fixture(provider.name, intent)
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
    providers = providers if providers is not None else [OpenWebNinjaProvider()]
    cache = cache or SqliteCache()
    mode = get_data_mode()

    sources: list[SearchSource] = []
    all_products: list[Product] = []

    with ThreadPoolExecutor(max_workers=max(1, len(providers))) as pool:
        futures = {
            pool.submit(_run_provider, provider, intent, mode, cache, PROVIDER_TIMEOUT_SECONDS): provider
            for provider in providers
        }
        done, not_done = wait(futures, timeout=TOTAL_TIMEOUT_SECONDS)

        for future in done:
            provider = futures[future]
            raw_products, source = future.result()
            sources.append(source)
            normalizer = _NORMALIZERS.get(provider.name)
            if normalizer:
                all_products.extend(p for p in (normalizer(r) for r in raw_products) if p is not None)

        for future in not_done:
            provider = futures[future]
            sources.append(SearchSource(name=provider.name, status="timeout", count=0, elapsed_ms=int(TOTAL_TIMEOUT_SECONDS * 1000)))

    deduped = dedupe(all_products)
    filtered = apply_hard_filters(deduped, intent)
    ranked = rank_products(filtered, intent)
    partial = any(s.status != "ok" for s in sources)

    return SearchResult(results=ranked[:MAX_RESULTS], sources=sources, partial=partial)
