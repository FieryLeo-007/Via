"""Real-Time Product Search v2 client; spec-confirmed 2026-09-27.
See docs/integration-notes.md for the verified request and response contract.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import httpx
from dotenv import dotenv_values

from discovery.providers.base import Provider, ProviderError
from discovery.schemas import ShoppingIntent

BASE_URL = "https://api.openwebninja.com/realtime-product-search/v2"
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

# Flask loads .env once when the process starts. Remember the value that came
# from that initial load so an edited .env can be picked up without treating a
# genuinely external environment variable as file-backed configuration.
_INITIAL_DOTENV_API_KEY = (dotenv_values(ENV_FILE).get("OPENWEBNINJA_API_KEY") or "").strip()


def _configured_api_key() -> str:
    environment_value = os.environ.get("OPENWEBNINJA_API_KEY", "").strip()
    file_value = (dotenv_values(ENV_FILE).get("OPENWEBNINJA_API_KEY") or "").strip()

    if file_value and (not environment_value or environment_value == _INITIAL_DOTENV_API_KEY):
        return file_value
    return environment_value

# Shared keep-alive pool: searches and offer lookups hit the same host, so
# reusing connections skips a TCP+TLS handshake on every request.
_HTTP = httpx.Client(limits=httpx.Limits(max_connections=32, max_keepalive_connections=32, keepalive_expiry=120))

SOURCE = "product-search:google-shopping"


class OpenWebNinjaProvider(Provider):
    """Google Shopping through the Real-Time Product Search v2 subscription."""

    name = SOURCE

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key.strip() if api_key is not None else _configured_api_key()

    def _headers(self) -> dict:
        return {"x-api-key": self._api_key}

    def cache_params(self, intent: ShoppingIntent) -> dict:
        query = " ".join(intent.query.split())
        # Include requested attributes even when the parser puts a color only in
        # must_have. Use the same final query for HTTP requests and cache keys.
        for attribute in [intent.color, *intent.must_have]:
            attribute = " ".join((attribute or "").split())
            if attribute and not re.search(r"(?<!\w)" + re.escape(attribute) + r"(?!\w)", query, re.I):
                query = f"{query} {attribute}".strip()
        params = {
            "q": query, "country": "us", "language": "en", "page": 1, "limit": 40,
            "product_condition": (intent.condition or "any").upper(),
            "sort_by": {"best": "BEST_MATCH", "price_low": "LOWEST_PRICE", "rating": "TOP_RATED"}[intent.sort_hint],
        }
        for key in ("min_price", "max_price"):
            cents = getattr(intent, key + "_cents")
            if cents is not None:
                params[key] = cents / 100
        return params

    def _get(self, endpoint: str, params: dict, timeout: float) -> dict:
        if not self._api_key:
            raise ProviderError("OPENWEBNINJA_API_KEY is not set")
        response = _HTTP.get(f"{BASE_URL}/{endpoint}",
                             params=params, headers=self._headers(), timeout=timeout)
        if response.status_code != 200:
            raise ProviderError(f"{self.name} /{endpoint} returned {response.status_code}")
        body = response.json()
        if not isinstance(body, dict) or body.get("status") not in ("success", "OK", "ok"):
            raise ProviderError(f"{self.name} /{endpoint} returned an invalid response")
        data = body.get("data")
        if not isinstance(data, dict):
            raise ProviderError(f"{self.name} /{endpoint} returned invalid data")
        return data

    def raw_search(self, intent: ShoppingIntent, timeout: float) -> list[dict]:
        products = self._get("search", self.cache_params(intent), timeout).get("products")
        if not isinstance(products, list):
            raise ProviderError(f"{self.name} returned invalid products")
        return [p for p in products if isinstance(p, dict)]

    def raw_offers(self, product_id: str, timeout: float) -> list[dict]:
        offers = self._get("product-offers", {"product_id": product_id, "country": "us", "language": "en", "page": 1}, timeout).get("offers")
        if not isinstance(offers, list):
            raise ProviderError("Product Search product offers returned invalid data")
        return [offer for offer in offers if isinstance(offer, dict)]
