import httpx
import pytest

from agent.heuristics import extract_intent_heuristic
from discovery.cache import SqliteCache, make_cache_key
from discovery.normalize import normalize_product_search
from discovery.pipeline import search_products
from discovery.providers.base import ProviderError
from discovery.providers.openwebninja import BASE_URL, SOURCE, OpenWebNinjaProvider
from discovery.schemas import ShoppingIntent


@pytest.mark.parametrize('query,color,must_have,expected', [
    ('headphones', 'navy blue', [], 'headphones navy blue'),
    ('Blue headphones', 'blue', ['blue'], 'Blue headphones'),
    ('headphones', None, ['red'], 'headphones red'),
    ('headphones', None, [], 'headphones'),
    ('blueberry headphones', 'blue', [], 'blueberry headphones blue'),
])
def test_query_includes_color_without_duplicates(query, color, must_have, expected):
    provider = OpenWebNinjaProvider(api_key='test')
    intent = ShoppingIntent(query=query, color=color, must_have=must_have)
    assert provider.cache_params(intent)['q'] == expected


def test_heuristic_preserves_color_in_search():
    intent = extract_intent_heuristic('navy blue headphones under $100')
    assert 'navy blue' in OpenWebNinjaProvider(api_key='test').cache_params(intent)['q']


def test_v2_search_and_offers_contract(monkeypatch, tmp_path):
    monkeypatch.setenv('DATA_MODE', 'live')
    monkeypatch.setenv('OPENWEBNINJA_API_KEY', 'test')
    calls = []
    product_id = 'catalogid:123,productid:456,gpcid:789,pvt:a,pvf:'

    def get(url, **kwargs):
        calls.append((url, kwargs['params']))
        assert kwargs['headers'] == {'x-api-key': 'test'}
        if url == BASE_URL + '/search':
            assert kwargs['params'] == {
                'q': 'headphones blue', 'country': 'us', 'language': 'en',
                'page': 1, 'limit': 40, 'sort_by': 'LOWEST_PRICE',
                'product_condition': 'NEW', 'min_price': 20, 'max_price': 100,
            }
            data = {'products': [{
                'product_id': product_id, 'product_title': 'Blue Headphones',
                'price': '$50.00', 'store_name': 'Store', 'product_rating': 4.5,
                'product_num_reviews': 20, 'product_photos': ['https://store.com/photo.jpg'],
            }]}
        else:
            assert url == BASE_URL + '/product-offers'
            assert kwargs['params'] == {'product_id': product_id, 'country': 'us', 'language': 'en', 'page': 1}
            data = {'offers': [{
                'offer_title': 'Blue Headphones', 'offer_page_url': 'https://store.com/p/1?color=blue',
                'price': '$55.00', 'product_condition': 'NEW', 'store_name': 'Store',
            }]}
        return httpx.Response(200, json={'status': 'OK', 'data': data})

    monkeypatch.setattr('discovery.providers.openwebninja._HTTP.get', get)
    intent = ShoppingIntent(query='headphones', color='blue', min_price_cents=2000,
                            max_price_cents=10000, condition='new', sort_hint='price_low')
    cache = SqliteCache(tmp_path / 'cache.db')
    result = search_products(intent, cache=cache)
    assert len(result.results) == 1 and not result.partial
    assert result.sources[0].name == SOURCE
    assert result.results[0].price_cents == 5500
    assert result.results[0].merchant_url == 'https://store.com/p/1?color=blue'
    search_products(intent, cache=cache)
    assert len(calls) == 2


def test_color_and_api_version_isolate_cache_keys():
    provider = OpenWebNinjaProvider(api_key='test')
    params = provider.cache_params(ShoppingIntent(query='headphones', color='blue'))
    blue = make_cache_key(SOURCE, {'api': BASE_URL, **params})
    red = make_cache_key(SOURCE, {'api': BASE_URL, **provider.cache_params(ShoppingIntent(query='headphones', color='red'))})
    old = make_cache_key('ecommerce:google-shopping', {'api': 'https://api.openwebninja.com/realtime-ecommerce-data', **params})
    assert len({blue, red, old}) == 3


@pytest.mark.parametrize('data', [None, [], {}, {'products': {}}, {'products': None}])
def test_invalid_search_response_is_an_error(monkeypatch, data):
    monkeypatch.setattr('discovery.providers.openwebninja._HTTP.get',
                        lambda *a, **k: httpx.Response(200, json={'status': 'OK', 'data': data}))
    with pytest.raises(ProviderError):
        OpenWebNinjaProvider(api_key='test').raw_search(ShoppingIntent(query='headphones'), 1)


def test_flat_v2_listing_preserves_sale_and_product_rating():
    product = normalize_product_search({
        'product_id': 'catalogid:1,productid:2', 'product_title': 'Blue Shoes',
        'price': '$80.00', 'original_price': '$100.00', 'on_sale': True,
        'product_rating': 4.6, 'product_num_reviews': 30, 'store_name': 'Store',
        'shipping': 'Free delivery', 'product_page_url': 'https://google.com/search?q=shoes',
    })
    assert product.source == SOURCE and product.on_sale
    assert product.price_cents == 8000 and product.rating == 4.6
    assert product.merchant_url is None and product.free_shipping


@pytest.mark.parametrize('data', [{}, {'offers': None}, {'offers': {}}])
def test_invalid_offer_response_is_an_error(monkeypatch, data):
    monkeypatch.setattr('discovery.providers.openwebninja._HTTP.get',
                        lambda *a, **k: httpx.Response(200, json={'status': 'OK', 'data': data}))
    with pytest.raises(ProviderError):
        OpenWebNinjaProvider(api_key='test').raw_offers('catalogid:1', 1)


def test_provider_timeout_is_reported(monkeypatch, tmp_path):
    monkeypatch.setenv('DATA_MODE', 'live')
    provider = OpenWebNinjaProvider(api_key='test')

    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout('request timed out')

    monkeypatch.setattr(provider, 'raw_search', timeout)
    result = search_products(ShoppingIntent(query='headphones'), [provider], SqliteCache(tmp_path / 'cache.db'))
    assert result.partial and result.results == []
    assert result.sources[0].status == 'timeout'
