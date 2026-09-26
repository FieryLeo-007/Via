import httpx
import pytest

from discovery.normalize import normalize_ecommerce, merchant_product_url
from discovery.pipeline import search_products
from discovery.providers.openwebninja import OpenWebNinjaProvider, MARKETPLACES, BASE_URL
from discovery.cache import SqliteCache
from discovery.schemas import ShoppingIntent


@pytest.mark.parametrize('source,raw', [
    ('amazon', {'asin':'a','product_title':'Sony Headphones','product_price':'$42.99','product_url':'https://amazon.com/dp/a','product_star_rating':'4.5','product_num_ratings':80}),
    ('walmart', {'product_id':'a','title':'Sony Headphones','price':42.99,'url':'https://walmart.com/ip/a','rating':4.5,'review_count':80}),
    ('ebay', {'item_id':'a','title':'Sony Headphones','price':42.99,'url':'https://ebay.com/itm/a','rating':4.5,'review_count':80}),
    ('costco', {'item_number':'a','item_product_name':'Sony Headphones','item_location_pricing_salePrice':42.99,'item_ratings':4.5,'item_product_review_count':80}),
    ('wayfair', {'sku':'a','name':'Sony Headphones','pricing':{'current_price':42.99,'currency':'USD'},'url':'https://wayfair.com/pdp/a','rating':4.5,'review_count':80}),
    ('home-depot', {'item_id':'a','title':'Sony Headphones','pricing':{'current_price':42.99,'currency':'USD'},'url':'https://homedepot.com/p/a','rating':4.5,'total_reviews':'80'}),
    ('google-shopping', {'product_id':'a','product_title':'Sony Headphones','offer':{'price':'$42.99','store_name':'Sony','offer_page_url':'https://sony.com/p/a?color=black'},'product_rating':4.5,'product_num_reviews':80}),
])
def test_normalizes_each_marketplace(source,raw):
    product=normalize_ecommerce(raw,source)
    assert product.price_cents==4299
    assert product.rating==4.5 and product.rating_count==80
    assert product.source==f'ecommerce:{source}'
    if source!='costco': assert merchant_product_url(product.merchant_url)


def test_rejects_non_usd_and_monthly_price():
    base={'product_id':'a','title':'Headphones','price':10}
    assert normalize_ecommerce({**base,'currency':'CAD'},'walmart') is None
    assert normalize_ecommerce({**base,'price_display':'$10/month'},'walmart') is None
    assert normalize_ecommerce({**base,'price':float('nan')},'walmart') is None


@pytest.mark.parametrize('url', ['https://www.google.com/shopping/product/1','https://shopping.google.co.uk/foo','https://www.google.com./url?q=x','https://googleadservices.com/pagead/x','https://retailer.com/','javascript:alert(1)'])
def test_rejects_google_redirects_and_homepages(url):
    assert merchant_product_url(url) is None


def test_offer_resolution_rechecks_budget_and_preserves_full_url(monkeypatch,tmp_path):
    monkeypatch.setenv('DATA_MODE','live')
    provider=OpenWebNinjaProvider(api_key='test')
    monkeypatch.setattr(provider,'raw_search',lambda *a,**k:[{'product_id':'one','product_title':'Sony Headphones','price':'$50.00','product_page_url':'https://google.com/shopping/1'}])
    calls=[]
    def offers(*args,**kwargs):
        calls.append(args)
        return [
            {'offer_page_url':'https://google.com/url?q=x','price':'$20'},
            {'offer_page_url':'https://store.com/p/expensive','price':'$500','store_name':'Store'},
            {'offer_page_url':'https://store.com/p/one?color=blue','price':'$80','store_name':'Store','product_condition':'NEW'}]
    monkeypatch.setattr(provider,'raw_offers',offers)
    cache=SqliteCache(tmp_path/'cache.db')
    intent=ShoppingIntent(query='Sony Headphones',max_price_cents=10000)
    result=search_products(intent,[provider],cache)
    assert len(result.results)==1
    product=result.results[0]
    assert product.price_cents==8000 and product.store_name=='Store'
    assert product.merchant_url=='https://store.com/p/one?color=blue'
    assert product.product_page_url==product.merchant_url
    search_products(intent,[provider],cache)
    assert len(calls)==1


def test_unresolved_google_link_is_not_returned(monkeypatch,tmp_path):
    monkeypatch.setenv('DATA_MODE','live')
    provider=OpenWebNinjaProvider(api_key='test')
    monkeypatch.setattr(provider,'raw_search',lambda *a,**k:[{'product_id':'one','product_title':'Headphones','price':'$50.00'}])
    def fail(*a,**k): raise httpx.ReadTimeout('timeout')
    monkeypatch.setattr(provider,'raw_offers',fail)
    assert search_products(ShoppingIntent(query='Headphones'),[provider],SqliteCache(tmp_path/'c.db')).results==[]


def test_all_sources_share_only_ecommerce_api(monkeypatch,tmp_path):
    monkeypatch.setenv('DATA_MODE','live')
    calls=[]
    def get(url,**kwargs):
        calls.append(url)
        assert url.startswith(BASE_URL+'/')
        if '/amazon/' in url: return httpx.Response(429)
        source=url.split('/')[-2]
        products=[{'product_id':'a','title':'Sony headphones','price':50,'url':'https://walmart.com/ip/a'}] if source=='walmart' else []
        return httpx.Response(200,json={'status':'OK','data':{'products':products}})
    monkeypatch.setattr('discovery.providers.openwebninja.httpx.get',get)
    result=search_products(ShoppingIntent(query='headphones'),cache=SqliteCache(tmp_path/'c.db'))
    assert {url.split('/')[-2] for url in calls}==set(MARKETPLACES)
    assert result.partial and len(result.results)==1
    assert result.results[0].store_name=='Walmart'
