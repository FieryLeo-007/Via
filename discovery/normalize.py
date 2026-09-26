"""Raw provider dicts -> canonical Product. Each provider gets its own normalize_*
function since raw shapes differ; the canonical Product is what everything downstream
(dedupe/filters/rank) works with."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from discovery.schemas import Product

_PRICE_RE = re.compile(r"^\$\s*([\d,]+(?:\.\d{1,2})?)$")

# No exhaustive brand list exists; this is a best-effort guess from the leading
# capitalized token of a title (e.g. "Sony WH-1000XM5..." -> "Sony"). It's wrong
# often enough that dedupe treats it as a weak signal, not a hard key on its own.
_BRAND_STOPWORDS = {"the", "new", "a", "an"}


def parse_price_to_cents(price: str | None) -> int | None:
    """Returns None for missing, non-USD, or unparseable prices — callers drop the item."""
    if not price:
        return None
    match = _PRICE_RE.match(price.strip())
    if not match:
        return None
    try:
        return round(float(match.group(1).replace(",", "")) * 100)
    except ValueError:
        return None


def guess_brand(title: str) -> str | None:
    words = title.strip().split()
    if not words:
        return None
    first = words[0].strip(",.-")
    if not first or first.lower() in _BRAND_STOPWORDS or not first[0].isupper():
        return None
    return first


def https_origin(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        return None
    if "google." in parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def normalize_openwebninja(raw: dict) -> Product | None:
    price_cents = parse_price_to_cents(raw.get("price"))
    if price_cents is None:
        return None
    product_id = raw.get("product_id")
    title = raw.get("product_title")
    if not product_id or not title:
        return None

    photos = raw.get("product_photos") or []
    shipping = (raw.get("shipping") or "").lower()

    return Product(
        id=f"openwebninja:{product_id}",
        source="openwebninja",
        source_id=str(product_id),
        title=title,
        brand=guess_brand(title),
        store_name=raw.get("store_name"),
        price_cents=price_cents,
        currency="USD",
        rating=raw.get("product_rating"),
        rating_count=raw.get("product_num_reviews") or 0,
        condition=None,
        category=None,
        image_url=photos[0] if photos else None,
        merchant_url=None,
        product_page_url=raw.get("product_page_url"),
        on_sale=bool(raw.get("on_sale")),
        free_shipping=("free" in shipping) if shipping else None,
    )


def apply_merchant_offers(product: Product, offers: list[dict]) -> Product:
    """Set merchant_url from the first non-Google offer; else leave it None (view-only)."""
    for offer in offers:
        origin = https_origin(offer.get("offer_page_url"))
        if origin:
            return product.model_copy(update={"merchant_url": origin})
    return product
