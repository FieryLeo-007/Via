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
    calls = {"closed": 0, "token": []}

    class Account:
        def __init__(self, token): self.token = token
        def authenticate(self):
            if self.token != USER: raise AuthenticationError()
            return self.token
        def rows(self, table, params):
            assert table == "users" and params["id"] == f"eq.{USER}"
            return [{"full_name": "Ada Lovelace"}]
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
                             "dynamicVariables": {"user_name": "Ada"}}
    assert "xi-secret-key" not in response.get_data(as_text=True)
    assert response.headers["Cache-Control"] == "no-store"
    assert calls["closed"] == 1


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
