"""Provider protocol. Each provider is a dumb HTTP client: it maps a ShoppingIntent
to that provider's query params and returns raw, provider-shaped dicts. Turning those
into canonical Products happens in discovery/normalize.py, not here, so a provider
never needs to know the canonical schema."""

from __future__ import annotations

from abc import ABC, abstractmethod

from discovery.schemas import ShoppingIntent


class ProviderError(Exception):
    """Raised for any non-timeout provider failure (bad status, malformed body)."""


class Provider(ABC):
    name: str

    @abstractmethod
    def cache_params(self, intent: ShoppingIntent) -> dict:
        """The exact params this provider's search request would use for this intent —
        used to derive the cache key, so it must be stable and provider-specific."""
        raise NotImplementedError

    @abstractmethod
    def raw_search(self, intent: ShoppingIntent, timeout: float) -> list[dict]:
        """Return raw product dicts in this provider's own shape. Raises ProviderError
        on failure; raises httpx.TimeoutException (or similar) on timeout — the pipeline
        distinguishes the two for the partial-source banner."""
        raise NotImplementedError
