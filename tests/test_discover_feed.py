from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from discovery import discover_service as service
from discovery.recommendation_planner import deterministic_plan
from discovery.user_data import AuthenticationError, UserData


class Repository:
    def __init__(self, database, user_id="user-a"):
        self.database = database
        self.user_id = user_id
        self.load = Mock(return_value=({}, []))
        self.remember = Mock()

    def load_discover_feed(self):
        return deepcopy(self.database.get(self.user_id))

    def save_discover_feed(self, payload):
        self.database[self.user_id] = {
            "payload": deepcopy(payload), "updated_at": datetime.now(timezone.utc).isoformat(),
        }


@pytest.fixture
def search(monkeypatch):
    service.clear_cache()
    monkeypatch.setattr(service, "plan_discover", Mock(side_effect=lambda p: (deterministic_plan(p), True)))

    def result(intent):
        product = {"id": intent.query, "title": intent.query, "price_cents": 1000, "score": .8}
        return SimpleNamespace(results=[SimpleNamespace(model_dump=lambda **kwargs: product)], partial=False)

    search = Mock(side_effect=result)
    monkeypatch.setattr(service, "search_products", search)
    yield search
    service.clear_cache()


def test_reload_after_restart_and_profile_change_reuses_durable_products(search):
    database = {}
    first = service.discover_feed(Repository(database))
    assert not first["cache"]["hit"]
    assert first["cache"]["expires_at"] is None
    assert search.call_count == 4
    service.clear_cache()  # Simulate another worker or a server restart.
    database["user-a"]["updated_at"] = "2020-01-01T00:00:00+00:00"
    repository = Repository(database)
    repository.load.side_effect = AssertionError("Reload must not rebuild the profile")
    second = service.discover_feed(repository)
    assert second["cache"]["hit"]
    assert second["sections"] == first["sections"]
    assert search.call_count == 4
    repository.remember.assert_not_called()
    assert not database["user-a"]["payload"]["cache"]["hit"]


def test_explicit_refresh_replaces_snapshot_and_observes_cooldown(search):
    database = {}
    repository = Repository(database)
    service.discover_feed(repository)
    assert service.discover_feed(repository, refresh=True)["cache"]["hit"]
    assert search.call_count == 4
    database["user-a"]["updated_at"] = "2020-01-01T00:00:00+00:00"
    refreshed = service.discover_feed(repository, refresh=True)
    assert not refreshed["cache"]["hit"]
    assert search.call_count == 8
    assert database["user-a"]["payload"] == refreshed
    assert service.discover_feed(repository)["cache"]["hit"]
    assert search.call_count == 8


def test_accounts_have_independent_feeds(search):
    database = {}
    service.discover_feed(Repository(database, "user-a"))
    service.discover_feed(Repository(database, "user-b"))
    assert set(database) == {"user-a", "user-b"}
    assert search.call_count == 8


def test_simultaneous_first_loads_share_generation(search):
    database = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: service.discover_feed(Repository(database)), range(2)))
    assert sorted(r["cache"]["hit"] for r in responses) == [False, True]
    assert search.call_count == 4


def test_cache_read_failure_never_triggers_paid_search(search):
    repository = Repository({})
    repository.load_discover_feed = Mock(side_effect=httpx.ReadTimeout("Unavailable"))
    with pytest.raises(httpx.ReadTimeout):
        service.discover_feed(repository)
    search.assert_not_called()
    repository.load.assert_not_called()


def test_cache_write_failure_is_not_reported_as_success(search):
    repository = Repository({})
    repository.save_discover_feed = Mock(side_effect=httpx.ReadTimeout("Unavailable"))
    with pytest.raises(httpx.ReadTimeout):
        service.discover_feed(repository)
    repository.remember.assert_not_called()


def test_failed_refresh_preserves_saved_products(search):
    database = {}
    repository = Repository(database)
    first = service.discover_feed(repository)
    database["user-a"]["updated_at"] = "2020-01-01T00:00:00+00:00"
    original = deepcopy(database)
    search.side_effect = RuntimeError("Provider unavailable")
    refreshed = service.discover_feed(repository, refresh=True)
    assert refreshed["cache"]["hit"] and refreshed["partial"]
    assert refreshed["sections"] == first["sections"]
    assert database == original


def test_failed_first_load_can_retry(search):
    database = {}
    search.side_effect = RuntimeError("Provider unavailable")
    response = service.discover_feed(Repository(database))
    assert response["partial"]
    assert database == {}


def test_partial_feed_with_products_is_saved(search):
    database = {}
    normal_search = search.side_effect
    search.side_effect = lambda intent: (SimpleNamespace(results=[], partial=True)
        if intent.query == "portable audio" else normal_search(intent))
    first = service.discover_feed(Repository(database), debug=True)
    assert first["partial"]
    assert "debug" not in database["user-a"]["payload"]
    service.clear_cache()
    second = service.discover_feed(Repository(database))
    assert second["cache"]["hit"]
    assert second["sections"] == first["sections"]
    assert search.call_count == 4


def test_repository_round_trip_uses_user_filter_and_upsert(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-key")
    database = {}
    payload = {"sections": [{"products": [{"id": "product-1"}]}], "cache": {"hit": False}}

    def handle(request):
        assert request.url.path == "/rest/v1/discover_feeds"
        if request.method == "GET":
            assert request.url.params["user_id"] == "eq.user-a"
            assert request.url.params["select"] == "payload,updated_at"
            return httpx.Response(200, json=list(database.values()))
        assert request.url.params["on_conflict"] == "user_id"
        assert request.headers["Prefer"] == "resolution=merge-duplicates,return=minimal"
        row = json.loads(request.content)
        assert row["user_id"] == "user-a"
        database[row["user_id"]] = row
        return httpx.Response(201)

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        repository = UserData("token", client=client)
        with pytest.raises(AuthenticationError):
            repository.load_discover_feed()
        with pytest.raises(AuthenticationError):
            repository.save_discover_feed(payload)
        repository.user_id = "user-a"
        assert repository.load_discover_feed() is None
        repository.save_discover_feed(payload)
        assert repository.load_discover_feed()["payload"] == payload


def test_cache_database_errors_propagate(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-key")
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(503))) as client:
        repository = UserData("token", client=client)
        repository.user_id = "user-a"
        with pytest.raises(httpx.HTTPStatusError):
            repository.load_discover_feed()
        with pytest.raises(httpx.HTTPStatusError):
            repository.save_discover_feed({"sections": []})
