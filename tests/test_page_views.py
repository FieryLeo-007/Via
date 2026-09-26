import re

import pytest
from flask import template_rendered

from app import app


@pytest.mark.parametrize("path,template", [("/orders", "orders.html"), ("/saved", "index.html")])
def test_collection_pages_use_expected_template_and_auth_gate(path, template):
    rendered = []

    def capture(sender, template, context, **extra):
        rendered.append(template.name)

    with template_rendered.connected_to(capture, app):
        response = app.test_client().get(path)

    assert response.status_code == 200
    assert rendered == [template]
    page = response.get_data(as_text=True)
    assert re.search(r'<body\b[^>]*data-auth-page="index"[^>]*\bhidden\b', page)
    assert 'id="auth-config" type="application/json"' in page
    assert 'scripts/auth.js' in page


def test_orders_has_one_route_and_dedicated_controls():
    rules = [rule for rule in app.url_map.iter_rules() if rule.rule == "/orders"]
    assert len(rules) == 1
    page = app.test_client().get("/orders").get_data(as_text=True)
    for control in ("orders-list", "order-search", "order-sort", "clear-filters"):
        assert f'id="{control}"' in page
    assert 'scripts/orders.bundle.js' in page
    assert 'id="composer"' not in page


def test_saved_has_visible_collection_and_accessible_search():
    page = app.test_client().get("/saved").get_data(as_text=True)
    collection = re.search(r'<section\b[^>]*id="saved-collection"[^>]*>', page).group()
    assert "hidden" not in collection
    assert 'for="saved-filter"' in page
    assert 'id="saved-filter" type="search"' in page
    assert 'id="saved-products-grid" aria-busy="true"' in page
    assert 'id="saved-results-count" role="status"' in page
    assert 'styles/saved.css' in page
