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
    """Use one real offer consistently for title, price, store, condition and URL."""
    valid = []
    for offer in offers:
        url = merchant_product_url(offer.get("offer_page_url"))
        cents = _money(offer.get("price"))
        if url and cents is not None:
            valid.append((offer, url, cents))
    # Prefer the exact listed merchant/price; otherwise use the least expensive offer.
    valid.sort(key=lambda item: (not (item[0].get("store_name") == product.store_name and item[2] == product.price_cents), item[2]))
    if not valid: return product
    offer, url, cents = valid[0]
    return product.model_copy(update={
        "merchant_url": url, "product_page_url": url, "price_cents": cents,
        "store_name": offer.get("store_name") or product.store_name,
        "title": offer.get("offer_title") or product.title,
        "condition": _condition(offer.get("product_condition")),
        "on_sale": bool(offer.get("on_sale")),
        "free_shipping": "free" in str(offer.get("shipping") or "").lower(),
    })


def merchant_product_url(value: str | None) -> str | None:
    """Preserve the full retailer path/query; never expose Google/ad redirects."""
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme != "https" or not host or parsed.username or parsed.password:
            return None
        if re.search(r"(^|\.)google\.[a-z.]+$", host) or host.endswith(("googleadservices.com", "doubleclick.net")):
            return None
        if parsed.path in ("", "/"):
            return None
        return value
    except ValueError:
        return None


def _money(value, currency="USD") -> int | None:
    from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
    if currency != "USD" or value is None or isinstance(value, bool):
        return None
    text = str(value).strip().replace(",", "")
    if text.startswith("$"):
        text = text[1:].strip()
    try:
        amount = Decimal(text)
        if not amount.is_finite() or amount < 0:
            return None
        return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError):
        return None


def _condition(value):
    value = str(value or "").lower()
    if "refurb" in value or "renew" in value: return "refurbished"
    if "used" in value or "pre-owned" in value: return "used"
    if "new" in value: return "new"
    return value or None


def normalize_ecommerce(raw: dict, marketplace: str) -> Product | None:
    """Map the seven documented marketplace schemas to comparable USD offers."""
    from html import unescape
    from pydantic import ValidationError
    if not isinstance(raw, dict): return None
    try:
        pricing = raw.get("pricing") or {}
        currency = raw.get("currency") or pricing.get("currency") or "USD"
        title = raw.get("title") or raw.get("name") or raw.get("product_title")
        source_id = raw.get("product_id") or raw.get("item_id") or raw.get("asin") or raw.get("sku")
        price = raw.get("price", pricing.get("current_price"))
        original = raw.get("original_price", pricing.get("original_price"))
        brand = raw.get("brand")
        url = raw.get("url") or raw.get("product_url")
        image = raw.get("image") or raw.get("image_url") or raw.get("thumbnail")
        rating = raw.get("rating")
        count = raw.get("review_count") or 0
        store = {"amazon": "Amazon", "walmart": "Walmart", "ebay": "eBay", "costco": "Costco", "wayfair": "Wayfair", "home-depot": "Home Depot"}.get(marketplace)
        shipping = raw.get("free_shipping")
        condition = _condition(raw.get("condition"))
        if raw.get("out_of_stock") is True or raw.get("is_discontinued") is True:
            return None
        if raw.get("in_stock") is False or raw.get("isItemInStock") is False:
            return None
        # Monthly payments and unit prices must not masquerade as total prices.
        if re.search(r"/\s*(month|mo|week)|per month", str(raw.get("price_display", "")), re.I):
            return None
        if marketplace == "amazon":
            price, original = raw.get("product_price"), raw.get("product_original_price")
            rating, count = raw.get("product_star_rating"), raw.get("product_num_ratings") or 0
            image = raw.get("product_photo")
            delivery = raw.get("delivery") or ""
            shipping = "FREE" in delivery and " on $" not in delivery
        elif marketplace == "costco":
            title = raw.get("item_product_name") or title
            source_id = raw.get("item_number")
            price = raw.get("item_location_pricing_salePrice")
            original = raw.get("item_location_pricing_listPrice")
            currency = raw.get("item_location_currencyCode") or "USD"
            rating, count = raw.get("item_ratings"), raw.get("item_product_review_count") or 0
            brand = (raw.get("Brand_attr") or [None])[0]
            # Search may omit URLs. Retain the product, but never invent a link.
        elif marketplace == "home-depot":
            count = raw.get("total_reviews") or 0
            delivery = (raw.get("fulfillment") or {}).get("delivery") or {}
            shipping = any(s.get("has_free_shipping") is True for s in delivery.get("services", []))
        elif marketplace == "ebay":
            shipping = "free" in str(raw.get("shipping") or "").lower()
        elif marketplace == "google-shopping":
            offer = raw.get("offer") or {}
            price = offer.get("price", raw.get("price"))
            original = offer.get("original_price")
            store = offer.get("store_name", raw.get("store_name"))
            url = offer.get("offer_page_url")
            brand = (raw.get("product_attributes") or {}).get("Brand")
            rating, count = raw.get("product_rating"), raw.get("product_num_reviews") or 0
            image = (raw.get("product_photos") or [None])[0]
            condition = _condition(offer.get("product_condition"))
            shipping = "free" in str(offer.get("shipping", raw.get("shipping")) or "").lower()
        cents = _money(price, currency)
        if cents is None or not title or not source_id: return None
        rating = float(rating) if rating is not None else None
        if rating is not None and not 0 <= rating <= 5: rating = None
        original_cents = _money(original, currency)
        direct_url = merchant_product_url(unescape(url)) if isinstance(url, str) else None
        return Product(
            id=f"ecommerce:{marketplace}:{source_id}", source=f"ecommerce:{marketplace}",
            source_id=str(source_id), title=unescape(title), brand=brand or guess_brand(title),
            store_name=store, price_cents=cents, currency=currency, rating=rating,
            rating_count=max(0, int(count)), condition=condition, image_url=unescape(image) if image else None,
            merchant_url=direct_url, product_page_url=direct_url,
            on_sale=original_cents is not None and original_cents > cents, free_shipping=shipping,
        )
    except (ValueError, TypeError, AttributeError, ValidationError):
        return None
