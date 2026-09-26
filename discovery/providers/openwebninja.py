"""Real-Time E-commerce Data client; search live-confirmed 2026-09-26.
See docs/integration-notes.md for the verified request and response contract.
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx
from dotenv import dotenv_values

from discovery.providers.base import Provider, ProviderError
from discovery.schemas import ShoppingIntent

BASE_URL = "https://api.openwebninja.com/realtime-ecommerce-data"
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

MARKETPLACES = ("amazon", "walmart", "ebay", "costco", "wayfair", "home-depot", "google-shopping")


class OpenWebNinjaProvider(Provider):
    """One marketplace within the E-commerce Data subscription."""

    def __init__(self, api_key: str | None = None, marketplace: str = "google-shopping"):
        if marketplace not in MARKETPLACES:
            raise ValueError("Unsupported marketplace")
        self.marketplace = marketplace
        self.name = f"ecommerce:{marketplace}"
        self._api_key = api_key.strip() if api_key is not None else _configured_api_key()

    def _headers(self) -> dict:
        return {"x-api-key": self._api_key}

    def cache_params(self, intent: ShoppingIntent) -> dict:
        source = self.marketplace
        params = {"q" if source == "google-shopping" else "query": intent.query}
        if source == "google-shopping":
            params.update(country="us", language="en", limit=40,
                          product_condition=(intent.condition or "any").upper())
        elif source == "amazon":
            params.update(country="US", page=1,
                          product_condition={"new": "NEW", "used": "USED", "refurbished": "RENEWED"}.get(intent.condition, "ALL"))
        elif source == "costco":
            params.update(country="US", start=0)
        elif source == "ebay":
            params.update(domain="com", page=1, buying_format="buy_it_now")
            if intent.condition and intent.condition != "any":
                params["condition"] = intent.condition
        else:
            params["page"] = 1
            if source == "walmart": params["domain"] = "us"
            if source == "wayfair": params.update(domain="com", items_per_page=48)
            if source == "home-depot": params["items_per_page"] = 48
        sorts = {
            "amazon": ("RELEVANCE", "LOWEST_PRICE", "REVIEWS"),
            "walmart": ("best_match", "price_low", "top_rated"),
            "ebay": ("BEST_MATCH", "PRICE_LOWEST", "BEST_MATCH"),
            "wayfair": ("recommended", "price_low_to_high", "customer_rating"),
            "home-depot": ("best_match", "price_low_to_high", "top_rated"),
            "google-shopping": ("BEST_MATCH", "LOWEST_PRICE", "TOP_RATED"),
        }
        if source in sorts:
            params["sort_by"] = sorts[source][("best", "price_low", "rating").index(intent.sort_hint)]
            for key in ("min_price", "max_price"):
                cents = getattr(intent, key + "_cents")
                if cents is not None: params[key] = cents / 100
        return params

    def _get(self, endpoint: str, params: dict, timeout: float) -> dict:
        if not self._api_key:
            raise ProviderError("OPENWEBNINJA_API_KEY is not set")
        response = httpx.get(f"{BASE_URL}/{self.marketplace}/{endpoint}",
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
        if self.marketplace != "google-shopping":
            return []
        offers = self._get("product-offers", {"product_id": product_id, "country": "us", "language": "en"}, timeout).get("offers", [])
        if not isinstance(offers, list):
            raise ProviderError("E-commerce product offers returned invalid data")
        return [offer for offer in offers if isinstance(offer, dict)]
