from discovery.rank import rank_products
from discovery.schemas import Product, ShoppingIntent


def _product(**kwargs):
    defaults = dict(
        id="openwebninja:1", source="openwebninja", source_id="1",
        title="Widget", price_cents=1000, rating=4.5, rating_count=100,
    )
    defaults.update(kwargs)
    return Product(**defaults)


def test_rank_is_deterministic():
    intent = ShoppingIntent(query="wireless headphones")
    products = [
        _product(id="a", source_id="a", title="Wireless Headphones A", rating=4.2, rating_count=50),
        _product(id="b", source_id="b", title="Wireless Headphones B", rating=4.8, rating_count=500),
    ]
    first = [p.score for p in rank_products(products, intent)]
    second = [p.score for p in rank_products(products, intent)]
    assert first == second


def test_higher_quality_ranks_above_lower_quality_all_else_equal():
    intent = ShoppingIntent(query="widget")
    high = _product(id="a", source_id="a", title="Widget", rating=4.9, rating_count=1000)
    low = _product(id="b", source_id="b", title="Widget", rating=3.0, rating_count=1000)
    ranked = rank_products([low, high], intent)
    assert ranked[0].id == "a"


def test_reasons_capped_at_three_and_mention_price_cap():
    intent = ShoppingIntent(query="headphones", max_price_cents=20000)
    product = _product(title="Headphones", price_cents=15000, rating=4.7, rating_count=2000)
    ranked = rank_products([product], intent)
    assert len(ranked[0].reasons) <= 3
    assert any("$200" in r for r in ranked[0].reasons)


def test_empty_input_returns_empty_list():
    intent = ShoppingIntent(query="widget")
    assert rank_products([], intent) == []


def test_ties_broken_by_price_then_id():
    intent = ShoppingIntent(query="widget")
    products = [
        _product(id="z", source_id="z", title="Widget", price_cents=1000, rating=4.5, rating_count=100),
        _product(id="a", source_id="a", title="Widget", price_cents=1000, rating=4.5, rating_count=100),
        _product(id="a", source_id="a2", title="Widget", price_cents=900, rating=4.5, rating_count=100),
    ]
    # give the third a distinct id to keep pydantic happy about non-uniqueness in the list itself
    products[2] = products[2].model_copy(update={"id": "aa"})
    ranked = rank_products(products, intent)
    assert ranked[0].id == "aa"  # cheapest first
    assert [p.id for p in ranked[1:]] == ["a", "z"]  # then id order among equal price
