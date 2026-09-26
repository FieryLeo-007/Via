import os

import pytest

from discovery.pipeline import search_products
from discovery.schemas import ShoppingIntent


@pytest.fixture(autouse=True)
def fixtures_mode(monkeypatch):
    monkeypatch.setenv("DATA_MODE", "fixtures")


def test_search_products_matches_fixture_and_respects_constraints():
    intent = ShoppingIntent(
        query="Noise-cancelling headphones under $200 for flights, not Beats",
        max_price_cents=20000,
        brands_exclude=["Beats"],
    )
    result = search_products(intent)

    assert result.partial is False
    assert 1 <= len(result.results) <= 10
    for product in result.results:
        assert product.price_cents <= 20000
        assert product.brand != "Beats"


def test_search_products_no_fixture_match_is_partial_not_error():
    intent = ShoppingIntent(query="a query that matches nothing in fixtures xyzzy")
    result = search_products(intent)

    assert result.partial is True
    assert result.results == []
    assert result.sources[0].status == "error"


def test_search_products_caps_results_at_ten():
    intent = ShoppingIntent(query="Backpack for laptop, water resistant, under $80", max_price_cents=8000)
    result = search_products(intent)
    assert len(result.results) <= 10
