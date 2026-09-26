"""Real-Time Product Search v2 client; search live-confirmed 2026-09-26.
See docs/integration-notes.md for the verified request and response contract.
"""

from __future__ import annotations

import os

import httpx

from discovery.providers.base import Provider, ProviderError
from discovery.schemas import ShoppingIntent

BASE_URL = "https://api.openwebninja.com/realtime-product-search/v2"

_CONDITION_MAP = {
    "new": "NEW",
    "used": "USED",
    "refurbished": "REFURBISHED",
    "any": "ANY",
    None: "ANY",
}

_SORT_MAP = {
    "best": "BEST_MATCH",
    "price_low": "LOWEST_PRICE",
    "rating": "TOP_RATED",
}


class OpenWebNinjaProvider(Provider):
    name = "openwebninja"

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or os.environ.get("OPENWEBNINJA_API_KEY", "")

    def _headers(self) -> dict:
        return {"x-api-key": self._api_key}

    def cache_params(self, intent: ShoppingIntent) -> dict:
        params: dict = {
            "q": intent.query,
            "country": "us",
            "language": "en",
            "limit": 40,
            "sort_by": _SORT_MAP.get(intent.sort_hint, "BEST_MATCH"),
            "product_condition": _CONDITION_MAP.get(intent.condition, "ANY"),
        }
        if intent.min_price_cents is not None:
            params["min_price"] = intent.min_price_cents / 100
        if intent.max_price_cents is not None:
            params["max_price"] = intent.max_price_cents / 100
        return params

    def raw_search(self, intent: ShoppingIntent, timeout: float) -> list[dict]:
        if not self._api_key:
            raise ProviderError("OPENWEBNINJA_API_KEY is not set")
        response = httpx.get(
            f"{BASE_URL}/search",
            params=self.cache_params(intent),
            headers=self._headers(),
            timeout=timeout,
        )
        if response.status_code != 200:
            raise ProviderError(f"openwebninja /search returned {response.status_code}")
        body = response.json()
        if body.get("status") not in ("success", "OK", "ok"):
            raise ProviderError(f"openwebninja /search reported status={body.get('status')!r}")
        return body.get("data", {}).get("products", [])

    def raw_offers(self, product_id: str, timeout: float) -> list[dict]:
        if not self._api_key:
            raise ProviderError("OPENWEBNINJA_API_KEY is not set")
        response = httpx.get(
            f"{BASE_URL}/product-offers",
            params={"product_id": product_id, "country": "us", "language": "en"},
            headers=self._headers(),
            timeout=timeout,
        )
        if response.status_code != 200:
            raise ProviderError(f"openwebninja /product-offers returned {response.status_code}")
        return response.json().get("data", {}).get("offers", [])
