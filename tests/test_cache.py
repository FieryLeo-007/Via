import tempfile
import time
from pathlib import Path

from discovery.cache import SqliteCache, make_cache_key


def test_make_cache_key_stable_and_order_independent():
    a = make_cache_key("openwebninja", {"q": "shoes", "max_price": 100})
    b = make_cache_key("openwebninja", {"max_price": 100, "q": "shoes"})
    c = make_cache_key("openwebninja", {"q": "shoes", "max_price": 200})
    assert a == b
    assert a != c


def test_cache_roundtrip_and_ttl_expiry():
    with tempfile.TemporaryDirectory() as tmp:
        cache = SqliteCache(Path(tmp) / "test.sqlite3")
        key = make_cache_key("openwebninja", {"q": "shoes"})

        assert cache.get(key) is None

        cache.set(key, {"products": [{"id": "1"}]}, ttl_seconds=10)
        assert cache.get(key) == {"products": [{"id": "1"}]}

        cache.set(key, {"products": []}, ttl_seconds=-1)
        assert cache.get(key) is None


def test_cache_persists_across_instances():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "test.sqlite3"
        key = make_cache_key("openwebninja", {"q": "shoes"})
        SqliteCache(path).set(key, {"products": []})
        reopened = SqliteCache(path)
        assert reopened.get(key) == {"products": []}
