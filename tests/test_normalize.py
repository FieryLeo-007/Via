from discovery.normalize import (
    apply_merchant_offers,
    guess_brand,
    https_origin,
    normalize_openwebninja,
    parse_price_to_cents,
)


def test_parse_price_to_cents_basic():
    assert parse_price_to_cents("$42.99") == 4299
    assert parse_price_to_cents("$1,299.00") == 129900
    assert parse_price_to_cents("$5") == 500


def test_parse_price_to_cents_rejects_non_usd_or_missing():
    assert parse_price_to_cents("€42.99") is None
    assert parse_price_to_cents(None) is None
    assert parse_price_to_cents("Free") is None
    assert parse_price_to_cents("") is None


def test_guess_brand_from_leading_capitalized_word():
    assert guess_brand("Sony WH-1000XM5 Headphones") == "Sony"
    assert guess_brand("the best headphones") is None
    assert guess_brand("") is None


def test_https_origin_excludes_google_and_non_https():
    assert https_origin("https://www.bestbuy.com/site/123") == "https://www.bestbuy.com"
    assert https_origin("https://www.google.com/shopping/product/1") is None
    assert https_origin("http://insecure.com/x") is None
    assert https_origin(None) is None


def test_normalize_openwebninja_drops_unparseable_price():
    raw = {"product_id": "1", "product_title": "Widget", "price": "Contact for price"}
    assert normalize_openwebninja(raw) is None


def test_normalize_openwebninja_builds_canonical_product():
    raw = {
        "product_id": "abc123",
        "product_title": "Sony WH-1000XM5 Headphones",
        "price": "$198.00",
        "product_page_url": "https://www.google.com/shopping/product/1",
        "product_photos": ["https://example.com/a.jpg"],
        "store_name": "Best Buy",
        "product_rating": 4.7,
        "product_num_reviews": 2114,
        "on_sale": True,
        "shipping": "Free shipping",
    }
    product = normalize_openwebninja(raw)
    assert product.id == "openwebninja:abc123"
    assert product.price_cents == 19800
    assert product.brand == "Sony"
    assert product.rating == 4.7
    assert product.on_sale is True
    assert product.free_shipping is True
    assert product.merchant_url is None


def test_apply_merchant_offers_sets_first_non_google_origin():
    raw = {
        "product_id": "abc123", "product_title": "Widget", "price": "$10.00",
        "store_name": "Best Buy",
    }
    product = normalize_openwebninja(raw)
    offers = [
        {"offer_page_url": "https://www.google.com/x"},
        {"offer_page_url": "https://www.bestbuy.com/site/widget"},
    ]
    enriched = apply_merchant_offers(product, offers)
    assert enriched.merchant_url == "https://www.bestbuy.com"
    assert product.merchant_url is None  # original untouched
