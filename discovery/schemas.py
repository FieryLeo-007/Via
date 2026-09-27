"""Pydantic v2 schemas for the discovery pipeline. Every model forbids extra fields
per CLAUDE.md rule 1 (the agent layer must reject malformed tool input/output)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Condition = Literal["new", "used", "refurbished", "any"]
SortHint = Literal["best", "price_low", "rating"]
ProviderStatus = Literal["ok", "timeout", "error"]
PicksSource = Literal["ai", "ranked", "none"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShoppingIntent(StrictModel):
    query: str
    category: Optional[str] = None
    color: Optional[str] = Field(default=None, max_length=100)
    min_price_cents: Optional[int] = Field(default=None, ge=0)
    max_price_cents: Optional[int] = Field(default=None, ge=0)
    must_have: list[str] = Field(default_factory=list, max_length=5)
    exclude_terms: list[str] = Field(default_factory=list)
    brands_include: list[str] = Field(default_factory=list)
    brands_exclude: list[str] = Field(default_factory=list)
    min_rating: Optional[float] = Field(default=None, ge=0, le=5)
    condition: Optional[Condition] = None
    sort_hint: SortHint = "best"
    quantity: int = Field(default=1, ge=1, le=5)


class AltOffer(StrictModel):
    store_name: str
    price_cents: int
    url: Optional[str] = None


class Product(StrictModel):
    id: str  # "{source}:{source_id}"
    source: str
    source_id: str
    title: str
    brand: Optional[str] = None
    store_name: Optional[str] = None
    price_cents: int
    currency: str = "USD"
    rating: Optional[float] = None
    rating_count: int = 0
    condition: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    merchant_url: Optional[str] = None  # Full retailer product URL; never a Google Shopping URL
    product_page_url: Optional[str] = None
    on_sale: bool = False
    free_shipping: Optional[bool] = None
    alt_offers: list[AltOffer] = Field(default_factory=list)


class ScoreBreakdown(StrictModel):
    relevance: float
    constraint_fit: float
    quality: float
    priority_fit: float
    base: float
    personal: float = 0.0
    score: float


class RankedProduct(Product):
    score: float
    breakdown: ScoreBreakdown
    reasons: list[str] = Field(default_factory=list, max_length=3)
    top_pick_rank: Optional[int] = Field(default=None, ge=1, le=4)
    pick_reason: Optional[str] = Field(default=None, max_length=200)


class SearchSource(StrictModel):
    name: str
    status: ProviderStatus
    count: int
    elapsed_ms: int
    error: Optional[str] = None


class SearchResult(StrictModel):
    results: list[RankedProduct]
    sources: list[SearchSource]
    partial: bool
    picks_source: PicksSource = "none"
