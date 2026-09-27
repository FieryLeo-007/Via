import json
from uuid import uuid4

import httpx
import pytest

from app import app
from discovery.user_data import AuthenticationError
from voice import routes, service, sync_agent

USER = str(uuid4())
CONFIG = {"api_key": "xi-secret-key", "agent_id": "agent_123", "api_base": "https://api.elevenlabs.io"}


@pytest.fixture
def voice(monkeypatch):
    calls = {"closed": 0, "token": [], "rows": []}

    class Account:
        def __init__(self, token): self.token = token
        def authenticate(self):
            if self.token != USER: raise AuthenticationError()
            return self.token
        def rows(self, table, params):
            calls["rows"].append((table, params))
            assert params["id" if table == "users" else "user_id"] == f"eq.{USER}"
            assert "*" not in params["select"]
            return [{"full_name": "Ada Lovelace"}] if table == "users" else []
        def close(self): calls["closed"] += 1

    def token(config):
        calls["token"].append(config)
        return service.conversation_token(config, client=httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"token": "webrtc-token", "conversation_id": "c1"}))))

    monkeypatch.setattr(routes, "UserData", Account)
    monkeypatch.setattr(routes, "settings", lambda: dict(CONFIG))
    monkeypatch.setattr(routes, "conversation_token", token)
    return app.test_client(), calls


def auth(user=USER): return {"Authorization": f"Bearer {user}"}


def test_session_requires_verified_user(voice):
    client, calls = voice
    assert client.get("/api/voice/session").status_code == 401
    assert client.get("/api/voice/session", headers=auth("someone-else")).status_code == 401
    assert calls["token"] == []


def test_session_returns_token_without_leaking_api_key(voice):
    client, calls = voice
    response = client.get("/api/voice/session", headers=auth())
    assert response.status_code == 200
    assert response.json == {"conversationToken": "webrtc-token", "agentId": "agent_123", "userId": USER,
                             "dynamicVariables": {"user_name": "Ada", "user_context": json.dumps({"profile": {"full_name": "Ada Lovelace"}, "onboarding_preferences": [], "user_preferences": []})}}
    assert "xi-secret-key" not in response.get_data(as_text=True)
    assert response.headers["Cache-Control"] == "no-store"
    assert calls["closed"] == 1
    assert {table for table, _ in calls["rows"]} == {"users", "onboarding_preferences", "user_preferences"}


def test_missing_configuration_names_settings(voice, monkeypatch):
    client, _ = voice
    monkeypatch.setattr(routes, "settings", lambda: {**CONFIG, "agent_id": ""})
    monkeypatch.setattr(routes, "conversation_token", service.conversation_token)
    response = client.get("/api/voice/session", headers=auth())
    assert response.status_code == 503
    assert response.json["code"] == "voice_unavailable"
    assert response.json["missing"] == ["ELEVENLABS_AGENT_ID"]


def test_greeting_falls_back_when_profile_unavailable(voice, monkeypatch):
    client, _ = voice
    def broken(self, table, params): raise httpx.ConnectError("down")
    monkeypatch.setattr(routes.UserData, "rows", broken)
    response = client.get("/api/voice/session", headers=auth())
    assert response.status_code == 200
    assert response.json["dynamicVariables"]["user_name"] == "there"


def mock_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_context_is_private_scoped_and_keeps_both_preference_sources(voice, monkeypatch):
    client, _ = voice
    def rows(self, table, params):
        assert params["id" if table == "users" else "user_id"] == f"eq.{USER}"
        if table == "users":
            assert params["select"] == "full_name,shirt_size,shoe_size,max_spending_budget"
            return [{"full_name": "Ada Lovelace", "shirt_size": "M", "shoe_size": "9", "max_spending_budget": 120,
                     "shipping_address": "PRIVATE ADDRESS", "payment_card_last4": "9999", "email": "PRIVATE EMAIL"}]
        return [{"category": "brand", "preference_key": "preferred_brands", "preference_value": [table], "importance": .8},
                {"category": "payment", "preference_key": "card", "preference_value": "PRIVATE CARD"},
                {"category": "shipping", "preference_key": "shipping_address", "preference_value": "PRIVATE ADDRESS"},
                {"category": "shopping_priority", "preference_key": "quality", "preference_value": {"level": "high", "shipping_address": "PRIVATE NESTED ADDRESS"}}]
    monkeypatch.setattr(routes.UserData, "rows", rows)
    response = client.get('/api/voice/session?user_id=another-user', headers=auth())
    assert response.status_code == 200
    context = json.loads(response.json["dynamicVariables"]["user_context"])
    assert context["profile"] == {"full_name": "Ada Lovelace", "shirt_size": "M", "shoe_size": "9", "max_spending_budget_usd": 120}
    for table in ("onboarding_preferences", "user_preferences"):
        assert context[table][0]["value"] == [table]
        assert context[table][1]["value"] == {"level": "high"}
    assert "PRIVATE" not in response.get_data(as_text=True)


def test_missing_preference_source_does_not_discard_available_context(voice, monkeypatch):
    client, _ = voice
    def rows(self, table, params):
        if table == "onboarding_preferences":
            raise httpx.ConnectError("unavailable")
        if table == "users":
            return [{"full_name": "Ada", "max_spending_budget": -1}]
        return [{"category": "shopping_priority", "preference_key": "quality", "preference_value": True}]
    monkeypatch.setattr(routes.UserData, "rows", rows)
    context = json.loads(client.get('/api/voice/session', headers=auth()).json["dynamicVariables"]["user_context"])
    assert context["profile"] == {"full_name": "Ada"}
    assert context["onboarding_preferences"] == []
    assert context["user_preferences"][0]["value"] is True


def test_voice_context_is_bounded_valid_json(voice, monkeypatch):
    client, _ = voice
    monkeypatch.setattr(routes.UserData, "rows", lambda self, table, params: [] if table == 'users' else [
        {"category": "shopping_priority", "preference_key": str(i), "preference_value": ['x' * 500] * 10} for i in range(50)])
    raw = client.get('/api/voice/session', headers=auth()).json["dynamicVariables"]["user_context"]
    assert len(raw) <= 6000
    assert json.loads(raw)["user_preferences"]


def test_token_request_uses_server_key_and_agent():
    seen = {}
    def handler(request):
        seen.update(url=str(request.url), key=request.headers["xi-api-key"])
        return httpx.Response(200, json={"token": "t"})
    assert service.conversation_token(CONFIG, client=mock_client(handler)) == "t"
    assert seen == {"url": "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_123",
                    "key": "xi-secret-key"}


@pytest.mark.parametrize("status,code", [(401, "voice_upstream"), (429, "voice_busy"), (500, "voice_upstream")])
def test_token_errors_are_mapped(status, code):
    with pytest.raises(service.VoiceError) as error:
        service.conversation_token(CONFIG, client=mock_client(lambda request: httpx.Response(status, json={})))
    assert error.value.code == code
    assert "xi-secret-key" not in str(error.value)


def test_token_rejects_malformed_and_unreachable_upstream():
    with pytest.raises(service.VoiceError):
        service.conversation_token(CONFIG, client=mock_client(lambda request: httpx.Response(200, json={"token": ""})))
    def down(request): raise httpx.ConnectTimeout("slow")
    with pytest.raises(service.VoiceError) as error:
        service.conversation_token(CONFIG, client=mock_client(down))
    assert error.value.status == 502


def test_agent_definition_is_consistent():
    tools, agent, prompt = sync_agent.load_definition()
    names = {tool["name"] for tool in tools}
    assert {"search_products", "add_to_cart", "get_checkout_quote", "place_demo_order",
            "start_real_checkout", "list_orders", "get_order_status"} <= names
    for tool in tools:
        assert tool["type"] == "client" and tool["expects_response"] is True
        assert 1 <= tool["response_timeout_secs"] <= 120
        params = tool["parameters"]
        assert set(params["required"]) <= set(params["properties"])
        # Every tool the prompt teaches must exist, and vice versa.
        assert f'**{tool["name"]}**' in prompt
    assert agent["platform_settings"]["auth"]["enable_auth"] is True
    # Without these events the browser never hears audio or receives client tool calls.
    assert {"audio", "client_tool_call", "agent_response", "user_transcript"} <= set(agent["conversation_config"]["conversation"]["client_events"])
    assert "{{user_name}}" in agent["conversation_config"]["agent"]["first_message"]
    assert "{{user_context}}" in prompt
    assert agent["conversation_config"]["agent"]["dynamic_variables"]["dynamic_variable_placeholders"]["user_context"] == "{}"
    # The default end_call prompt hangs up on a mere "thanks"; ours only ends on a clear goodbye.
    end_call = agent["conversation_config"]["agent"]["prompt"]["built_in_tools"]["end_call"]["description"]
    assert "goodbye" in end_call and "thanks" in end_call


def test_dry_run_payload_includes_every_tool(capsys):
    assert sync_agent.main(["--dry-run"]) == 0
    output = json.loads(capsys.readouterr().out)
    tools, _, prompt = sync_agent.load_definition()
    assert [t["tool_config"]["name"] for t in output["tools"]] == [t["name"] for t in tools]
    agent_prompt = output["agent"]["conversation_config"]["agent"]["prompt"]
    assert agent_prompt["prompt"] == prompt
    assert agent_prompt["tool_ids"] == [f'<{t["name"]}>' for t in tools]
    assert "end_call" in agent_prompt["built_in_tools"]


def test_sync_upserts_tools_by_name_and_updates_agent():
    requests = []
    def handler(request):
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, request.url.path, body))
        if request.method == "GET":
            name = request.url.params["search"]
            return httpx.Response(200, json={"tools": [{"id": "t-search", "tool_config": {"name": "search_products"}},
                                                       {"id": "t-other", "tool_config": {"name": "search_products_v0"}}]
                                              if name == "search_products" else [], "has_more": False})
        if request.method == "POST" and request.url.path == "/v1/convai/tools":
            return httpx.Response(200, json={"id": "t-" + body["tool_config"]["name"]})
        return httpx.Response(200, json={"agent_id": "agent_123"})
    api = sync_agent.ElevenLabs("k", "https://api.elevenlabs.io", client=httpx.Client(
        base_url="https://api.elevenlabs.io", transport=httpx.MockTransport(handler)))
    tools = [{"name": "search_products"}, {"name": "view_cart"}]
    assert api.upsert_tools(tools) == ["t-search", "t-view_cart"]
    assert ("PATCH", "/v1/convai/tools/t-search", {"tool_config": {"name": "search_products"}}) in requests
    assert api.upsert_agent("agent_123", {"name": "x"}) == "agent_123"
    assert requests[-1][:2] == ("PATCH", "/v1/convai/agents/agent_123")
    assert api.upsert_agent("", {"name": "x"}) == "agent_123"
    assert requests[-1][:2] == ("POST", "/v1/convai/agents/create")
