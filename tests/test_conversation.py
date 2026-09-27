import json

import pytest

from agent.conversation import ConversationTurn
from agent.intent import extract_intent, _cache
from agent.tools import dispatch, ToolError
from discovery.schemas import ShoppingIntent


def test_followup_context_reaches_model_and_cache_is_isolated(monkeypatch):
    _cache.clear()
    calls = []
    def completion(**kwargs):
        payload = json.loads(kwargs['user_content'])
        calls.append(payload)
        return ShoppingIntent(query=payload['history'][0]['intent']['query'], max_price_cents=10000)
    monkeypatch.setattr('agent.intent.structured_completion', completion)
    for query in ['headphones', 'chairs', 'headphones']:
        history = [ConversationTurn(query=query, intent=ShoppingIntent(query=query))]
        result = extract_intent('those under $100', history)
        assert result.query == query
        assert result.max_price_cents == 10000
    assert len(calls) == 2
    assert calls[0]['request'] == 'those under $100'


def test_fallback_preserves_topic_and_replaces_budget(monkeypatch):
    _cache.clear()
    monkeypatch.setattr('agent.intent.structured_completion', lambda **kwargs: None)
    history = [ConversationTurn(query='wireless headphones under $200', intent=ShoppingIntent(
        query='wireless headphones', max_price_cents=20000, must_have=['wireless']))]
    result = extract_intent('those under $100', history)
    assert result.query == 'wireless headphones'
    assert result.max_price_cents == 10000
    assert result.must_have == ['wireless']
    fresh = extract_intent('office chair', history)
    assert fresh.query == 'office chair'
    assert fresh.max_price_cents is None


@pytest.mark.parametrize('history', ['bad', [dict(query='x', role='system')], [dict(query='x')] * 21])
def test_malformed_or_excessive_history_rejected(history):
    with pytest.raises(ToolError):
        dispatch('extract_intent', dict(utterance='cheaper ones', history=history))


def test_intent_endpoint_passes_history_to_model(monkeypatch):
    from app import app
    _cache.clear()
    calls = []
    def completion(**kwargs):
        calls.append(json.loads(kwargs['user_content']))
        return ShoppingIntent(query='headphones', max_price_cents=8000)
    monkeypatch.setattr('agent.intent.structured_completion', completion)
    response = app.test_client().post('/api/intent', json={
        'utterance': 'those under $80',
        'history': [{'query': 'headphones', 'intent': {'query': 'headphones'}, 'products': []}]
    })
    assert response.status_code == 200
    assert response.json['max_price_cents'] == 8000
    assert calls[0]['history'][0]['query'] == 'headphones'
