from discovery.filters import apply_hard_filters
from discovery.schemas import Product, ShoppingIntent


def _product(**kwargs):
    defaults = dict(
        id="openwebninja:1", source="openwebninja", source_id="1",
        title="Widget", price_cents=1000, rating=4.5, rating_count=100,
    )
    defaults.update(kwargs)
    return Product(**defaults)


def test_price_range_filter():
    intent = ShoppingIntent(query="widget", min_price_cents=500, max_price_cents=1500)
    products = [_product(price_cents=400), _product(price_cents=1000), _product(price_cents=2000)]
    result = apply_hard_filters(products, intent)
    assert [p.price_cents for p in result] == [1000]


def test_min_rating_filter():
    intent = ShoppingIntent(query="widget", min_rating=4.0)
    products = [_product(rating=3.5), _product(rating=4.5), _product(rating=None)]
    result = apply_hard_filters(products, intent)
    assert len(result) == 1
    assert result[0].rating == 4.5


def test_brand_exclusion_filter():
    intent = ShoppingIntent(query="headphones", brands_exclude=["Beats"])
    products = [_product(brand="Beats"), _product(brand="Sony")]
    result = apply_hard_filters(products, intent)
    assert len(result) == 1
    assert result[0].brand == "Sony"


def test_exclude_terms_filter_matches_title():
    intent = ShoppingIntent(query="jacket", exclude_terms=["waterproof"])
    products = [_product(title="Waterproof Rain Jacket"), _product(title="Wool Winter Jacket")]
    result = apply_hard_filters(products, intent)
    assert len(result) == 1
    assert result[0].title == "Wool Winter Jacket"
