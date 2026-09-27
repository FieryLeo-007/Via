"""Exercise the public search flow with real parsing/ranking and mocked HTTP only."""
import json
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
    intent = ShoppingIntent(query="wireless headphones", color="blue", max_price_cents=20000)
    def complete(**kwargs):
        assert kwargs["text"]["format"]["strict"] is True
        assert "flights" in kwargs["input"][1]["content"]
        if kwargs["text"]["format"]["name"] == "top_picks":
            return SimpleNamespace(output_text=json.dumps({"picks": [
                {"id": f"p{i}", "reason": f"Pick {i} suits long flights under your budget."} for i in (3, 1, 5, 2)
            ]}))
        return SimpleNamespace(output_text=intent.model_dump_json())
    monkeypatch.setattr("agent.llm._client", lambda *a, **k: SimpleNamespace(responses=SimpleNamespace(create=complete)))
    def get(url, **kwargs):
        assert "/realtime-product-search/v2/" in url
        if url.endswith("/product-offers"):
            return httpx.Response(200, json={"status": "OK", "data": {"offers": [{
                "offer_page_url": "https://retailer.example/product/" + kwargs["params"]["product_id"],
                "price": "$99.99", "store_name": "Store", "product_condition": "NEW"
            }]}})
        assert url.endswith("/search")
        assert kwargs["headers"] == {"x-api-key": "test-secret"}
        assert kwargs["params"]["q"] == "wireless headphones blue"
        assert kwargs["params"]["max_price"] == 200
        return httpx.Response(200, json={"status": "OK", "data": {"products": [
            {"product_id": str(i), "product_title": f"Brand{i} Wireless Headphones Model{i}",
             "price": "$99.99" if i < 14 else "$300.00", "store_name": "Store",
             "product_rating": 4.5, "product_num_reviews": 100,
             "product_photos": ["https://example.com/photo.jpg"],
             "product_page_url": "https://www.google.com/shopping/product/1"}
            for i in range(16)
        ]}})
    monkeypatch.setattr("discovery.providers.openwebninja._HTTP.get", get)
    response = client.post("/api/intent", json={"utterance": "Blue headphones for flights under $200"})
    assert response.status_code == 200
    result = client.post("/api/search", json={"intent": response.json, "utterance": "Blue headphones for flights under $200"})
    assert result.status_code == 200
    assert len(result.json["results"]) == 10
    assert result.json["picks_source"] == "ai"
    top = result.json["results"][:4]
    assert [p["top_pick_rank"] for p in top] == [1, 2, 3, 4]
    assert all(p["pick_reason"] for p in top)
    assert all(p["top_pick_rank"] is None for p in result.json["results"][4:])
    assert all(p["price_cents"] <= 20000 and p["reasons"] for p in result.json["results"])
    assert "test-secret" not in result.get_data(as_text=True)


@pytest.mark.parametrize("status", [401, 429, 500])
def test_provider_errors_are_retryable_not_empty_success(client, monkeypatch, status):
    monkeypatch.setattr("discovery.providers.openwebninja._HTTP.get", lambda *a, **k: httpx.Response(status))
    result = client.post("/api/search", json={"intent": {"query": "headphones"}})
    assert result.status_code == 503
    assert result.json["error"]["retryable"] is True


def test_valid_empty_results(client, monkeypatch):
    monkeypatch.setattr("discovery.providers.openwebninja._HTTP.get", lambda *a, **k: httpx.Response(200, json={"status": "OK", "data": {"products": []}}))
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


def test_search_can_defer_picks_to_picks_endpoint(client, monkeypatch):
    calls = []
    def complete(**kwargs):
        calls.append(kwargs["text"]["format"]["name"])
        return SimpleNamespace(output_text=json.dumps({"picks": [{"id": "p1", "reason": "Cheapest wireless option."}]}))
    monkeypatch.setattr("agent.llm._client", lambda *a, **k: SimpleNamespace(responses=SimpleNamespace(create=complete)))
    monkeypatch.setattr("discovery.providers.openwebninja._HTTP.get", lambda url, **k: httpx.Response(200, json={"status": "OK", "data": {"products": [
        {"product_id": "a", "product_title": "Sony Wireless Headphones", "offer": {"price": "$50", "offer_page_url": "https://walmart.com/ip/a"}}
    ] if url.endswith("/search") else []}}))
    intent = {"query": "wireless headphones"}
    ranked = client.post("/api/search", json={"intent": intent, "picks": False})
    assert ranked.status_code == 200 and calls == []
    assert ranked.json["results"][0]["top_pick_rank"] is None
    picked = client.post("/api/picks", json={"result": ranked.json, "intent": intent, "utterance": "wireless headphones"})
    assert picked.status_code == 200 and calls == ["top_picks"]
    assert picked.json["picks_source"] == "ai" and picked.json["results"][0]["top_pick_rank"] == 1


def test_picks_endpoint_rejects_bad_body(client):
    assert client.post("/api/picks", json={"result": "nope"}).status_code == 400


def test_repeat_utterance_reuses_intent(monkeypatch):
    from agent.intent import extract_intent
    calls = []
    def complete(**kwargs):
        calls.append(1)
        return SimpleNamespace(output_text=ShoppingIntent(query="office chair").model_dump_json())
    monkeypatch.setattr("agent.llm._client", lambda *a, **k: SimpleNamespace(responses=SimpleNamespace(create=complete)))
    assert extract_intent("Office  chair").query == "office chair"
    assert extract_intent("office chair").query == "office chair"
    assert len(calls) == 1


def test_reasoning_effort_is_sent(monkeypatch):
    from agent.llm import structured_completion
    seen = {}
    def complete(**kwargs):
        seen.update(kwargs)
        return SimpleNamespace(output_text=ShoppingIntent(query="x").model_dump_json())
    monkeypatch.setattr("agent.llm._client", lambda *a, **k: SimpleNamespace(responses=SimpleNamespace(create=complete)))
    structured_completion(system_prompt="s", user_content="u", schema_name="n", output_model=ShoppingIntent)
    assert seen["reasoning"] == {"effort": "none"}
