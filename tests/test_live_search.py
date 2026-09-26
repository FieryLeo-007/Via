"""Exercise the public search flow with real parsing/ranking and mocked HTTP only."""
from types import SimpleNamespace

import httpx
import pytest

from app import app
from discovery.cache import SqliteCache
from discovery.schemas import ShoppingIntent


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_MODE", "live")
    monkeypatch.setenv("OPENWEBNINJA_API_KEY", "test-secret")
    monkeypatch.setattr("discovery.pipeline.SqliteCache", lambda: SqliteCache(tmp_path / "cache.sqlite3"))
    return app.test_client()


def test_natural_language_to_top_ten(client, monkeypatch):
    intent = ShoppingIntent(query="wireless headphones", max_price_cents=20000)
    def complete(**kwargs):
        assert kwargs["text"]["format"]["strict"] is True
        assert "flights" in kwargs["input"][1]["content"]
        return SimpleNamespace(output_text=intent.model_dump_json())
    monkeypatch.setattr("agent.llm._client", lambda: SimpleNamespace(responses=SimpleNamespace(create=complete)))
    def get(url, **kwargs):
        assert "/realtime-ecommerce-data/" in url
        if not url.endswith("/google-shopping/search"):
            return httpx.Response(200, json={"status": "OK", "data": {"products": []}})
        assert kwargs["headers"] == {"x-api-key": "test-secret"}
        assert kwargs["params"]["q"] == "wireless headphones"
        assert kwargs["params"]["max_price"] == 200
        return httpx.Response(200, json={"status": "OK", "data": {"products": [
            {"product_id": str(i), "product_title": f"Brand{i} Wireless Headphones Model{i}",
             "price": "$99.99" if i < 14 else "$300.00", "store_name": "Store",
             "product_rating": 4.5, "product_num_reviews": 100,
             "product_photos": ["https://example.com/photo.jpg"],
             "offer": {"offer_page_url": "https://retailer.example/product/1", "price": "$99.99" if i < 14 else "$300.00", "store_name": "Store"},
             "product_page_url": "https://www.google.com/shopping/product/1"}
            for i in range(16)
        ]}})
    monkeypatch.setattr("discovery.providers.openwebninja.httpx.get", get)
    response = client.post("/api/intent", json={"utterance": "Headphones for flights under $200"})
    assert response.status_code == 200
    result = client.post("/api/search", json={"intent": response.json})
    assert result.status_code == 200
    assert len(result.json["results"]) == 10
    assert all(p["price_cents"] <= 20000 and p["reasons"] for p in result.json["results"])
    assert "test-secret" not in result.get_data(as_text=True)


@pytest.mark.parametrize("status", [401, 429, 500])
def test_provider_errors_are_retryable_not_empty_success(client, monkeypatch, status):
    monkeypatch.setattr("discovery.providers.openwebninja.httpx.get", lambda *a, **k: httpx.Response(status))
    result = client.post("/api/search", json={"intent": {"query": "headphones"}})
    assert result.status_code == 503
    assert result.json["error"]["retryable"] is True


def test_valid_empty_results(client, monkeypatch):
    monkeypatch.setattr("discovery.providers.openwebninja.httpx.get", lambda *a, **k: httpx.Response(200, json={"status": "OK", "data": {"products": []}}))
    response = client.post("/api/search", json={"intent": {"query": "headphones"}})
    assert response.status_code == 200
    assert response.json["results"] == []


@pytest.mark.parametrize("utterance", ["", "   ", "x" * 2001])
def test_invalid_utterance(client, utterance):
    assert client.post("/api/intent", json={"utterance": utterance}).status_code == 400


def test_live_default(monkeypatch):
    from discovery.data_mode import get_data_mode
    monkeypatch.delenv("DATA_MODE", raising=False)
    assert get_data_mode() == "live"


def test_provider_picks_up_changed_dotenv_key(monkeypatch, tmp_path):
    from discovery.providers import openwebninja

    env_file = tmp_path / ".env"
    env_file.write_text("OPENWEBNINJA_API_KEY=new-file-key\n")
    monkeypatch.setattr(openwebninja, "ENV_FILE", env_file)
    monkeypatch.setattr(openwebninja, "_INITIAL_DOTENV_API_KEY", "old-file-key")
    monkeypatch.setenv("OPENWEBNINJA_API_KEY", "old-file-key")

    provider = openwebninja.OpenWebNinjaProvider()

    assert provider._headers() == {"x-api-key": "new-file-key"}


def test_provider_prefers_external_environment_key(monkeypatch, tmp_path):
    from discovery.providers import openwebninja

    env_file = tmp_path / ".env"
    env_file.write_text("OPENWEBNINJA_API_KEY=file-key\n")
    monkeypatch.setattr(openwebninja, "ENV_FILE", env_file)
    monkeypatch.setattr(openwebninja, "_INITIAL_DOTENV_API_KEY", "initial-file-key")
    monkeypatch.setenv("OPENWEBNINJA_API_KEY", "deployment-key")

    provider = openwebninja.OpenWebNinjaProvider()

    assert provider._headers() == {"x-api-key": "deployment-key"}


def test_hybrid_fixture_cache_does_not_leak_into_live(client, monkeypatch):
    from discovery.pipeline import _run_provider
    from discovery.providers.openwebninja import OpenWebNinjaProvider
    cache = {}
    class MemoryCache:
        def get(self, key): return cache.get(key)
        def set(self, key, value): cache[key] = value
    provider = OpenWebNinjaProvider()
    intent = ShoppingIntent(query="headphones")
    monkeypatch.setattr("discovery.pipeline.load_fixture", lambda *a: [{"fixture": True}])
    monkeypatch.setattr(provider, "raw_search", lambda *a, **k: [{"live": True}])
    _run_provider(provider, intent, "hybrid", MemoryCache(), 6)
    raw, _ = _run_provider(provider, intent, "live", MemoryCache(), 6)
    assert raw == [{"live": True}]
