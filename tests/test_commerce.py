from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import patch

import httpx
import pytest

from app import app
from commerce import routes, service
from discovery.user_data import AuthenticationError

USER_A, USER_B = str(uuid4()), str(uuid4())


@pytest.fixture
def commerce(monkeypatch):
    records, calls, runs = {}, [], {}
    monkeypatch.setattr(service, "settings", lambda: {"server": "sk_production_test", "client": "ck_production_test",
                        "database_key": "server-only", "database_url": "https://example.supabase.co"})

    class Account:
        def __init__(self, token): self.token = token
        def authenticate(self):
            if self.token not in (USER_A, USER_B): raise AuthenticationError()
            return self.token
        def close(self): pass

    class Store:
        def __init__(self, user_id): self.user_id = user_id
        def list(self): return [deepcopy(r) for r in records.values() if r["user_id"] == self.user_id]
        def get(self, key):
            row = records.get(key)
            if not row or row["user_id"] != self.user_id: raise service.CommerceError("Not found", 404)
            return deepcopy(row)
        def create(self, row):
            if row["id"] in records or self.active_request(row["request_hash"]): return None
            records[row["id"]] = {"provider_revision": -1, "result": {}, "currency": "USD", **row, "user_id": self.user_id}
            return self.get(row["id"])
        def active_request(self, fingerprint):
            return next((r for r in self.list() if r["request_hash"] == fingerprint and r["status"] not in service.TERMINAL), None)
        def update(self, key, values, revision=None, expected_status=None):
            old = self.get(key)
            if (expected_status is None or old["status"] == expected_status) and (revision is None or old["provider_revision"] < revision): records[key].update(values)
            return self.get(key)

    class Provider:
        failure = None
        def __init__(self, user_id): self.user_id = user_id
        def call(self, method, path, body=None, params=None):
            calls.append((self.user_id, method, path, body))
            if method == "POST" and path == "/agent-checkouts":
                if self.failure: raise self.failure
                run_id = str(uuid4())
                runs[run_id] = {"runId": run_id, "status": "running", "revision": 1}
                return deepcopy(runs[run_id])
            if method == "GET" and path == "/agent-checkouts": return {"data": list(runs.values())}
            if method == "GET" and path.endswith("/messages"): return {"messages": []}
            if method == "GET": return deepcopy(runs[path.split("/")[-1]])
            return {"accepted": True}
        def verify_payment(self, *args): pass

    monkeypatch.setattr(routes, "UserData", Account)
    monkeypatch.setattr(routes, "Orders", Store)
    monkeypatch.setattr(routes, "Crossmint", Provider)
    client = app.test_client()
    payload = {"id": str(uuid4()), "item": {"id": "product-1", "title": "Headphones", "quantity": 1,
               "product_page_url": "https://shop.example.com/product/1"}, "maxCost": "120.00", "consent": True}
    return client, payload, records, calls, runs, Provider


def auth(user=USER_A): return {"Authorization": f"Bearer {user}"}


def start(env):
    client, payload, *_ = env
    response = client.post("/api/commerce/orders", json=payload, headers=auth())
    assert response.status_code == 201
    return response.json["order"]


def test_requires_verified_authentication(commerce):
    client = commerce[0]
    assert client.get("/api/commerce/orders").status_code == 401
    assert client.get("/api/commerce/orders", headers=auth("invalid")).status_code == 401


def test_create_persists_and_only_sends_bounded_purchase(commerce):
    row = start(commerce)
    assert row["id"] in commerce[2]
    _, method, path, payload = commerce[3][0]
    assert method == "POST" and path == "/agent-checkouts"
    assert payload["constraints"]["maxCost"] == {"amount": "120.00", "currency": "USD"}
    assert "card" not in payload and "payment" not in payload


def test_double_submit_and_replay_do_not_create_second_run(commerce):
    start(commerce)
    client, payload, _, calls, *_ = commerce
    response = client.post("/api/commerce/orders", json=payload, headers=auth())
    assert response.status_code == 200
    assert len(calls) == 1
    payload["maxCost"] = "121.00"
    assert client.post("/api/commerce/orders", json=payload, headers=auth()).status_code == 409
    assert len(calls) == 1


def test_different_device_request_ids_reuse_same_active_purchase(commerce):
    first = start(commerce)
    client, payload, _, calls, *_ = commerce
    payload["id"] = str(uuid4())
    response = client.post("/api/commerce/orders", json=payload, headers=auth())
    assert response.status_code == 200
    assert response.json["order"]["id"] == first["id"]
    assert len(calls) == 1


def test_timeout_preserves_uncertain_reservation_without_retry(commerce):
    client, payload, records, calls, _, provider = commerce
    provider.failure = service.CommerceError("Timeout", 502, "provider_uncertain")
    assert client.post("/api/commerce/orders", json=payload, headers=auth()).status_code == 502
    assert records[payload["id"]]["status"] == "unknown"
    provider.failure = None
    assert client.post("/api/commerce/orders", json=payload, headers=auth()).status_code == 200
    assert len(calls) == 1


def test_lost_response_is_reconciled_by_reference_without_another_purchase(commerce):
    row = start(commerce)
    commerce[4][row["provider_run_id"]]["input"] = {"request": {"task": f'Buy this. [ProjectV order reference: {row["id"]}]'}}
    commerce[2][row["id"]].update(provider_run_id=None, status="unknown", provider_revision=-1)
    response = commerce[0].get(f'/api/commerce/orders/{row["id"]}', headers=auth())
    assert response.status_code == 200
    assert response.json["order"]["provider_run_id"] == row["provider_run_id"]
    assert len([c for c in commerce[3] if c[1:3] == ("POST", "/agent-checkouts")]) == 1


@pytest.mark.parametrize("suffix,method", [("", "get"), ("/messages", "get"), ("/messages", "post"), ("/cancel", "post"), ("/service-request", "post")])
def test_cross_account_order_access_is_denied(commerce, suffix, method):
    row = start(commerce)
    response = getattr(commerce[0], method)(f'/api/commerce/orders/{row["id"]}{suffix}', headers=auth(USER_B),
                                          json={"id": str(uuid4()), "kind": "refund"} if method == "post" else None)
    assert response.status_code == 404
    assert len(commerce[3]) == 1  # No provider call for an unowned run.
    assert commerce[0].get("/api/commerce/orders", headers=auth(USER_B)).json == {"orders": []}


def test_cancel_does_not_claim_confirmation_until_provider_confirms(commerce):
    row = start(commerce)
    response = commerce[0].post(f'/api/commerce/orders/{row["id"]}/cancel', headers=auth())
    assert response.status_code == 202
    assert response.json["order"]["cancel_requested"] is True
    assert response.json["order"]["status"] == "running"
    commerce[4][row["provider_run_id"]].update(status="cancelled", revision=2)
    result = commerce[0].get(f'/api/commerce/orders/{row["id"]}', headers=auth()).json
    assert result["order"]["status"] == "cancelled"


def test_refund_is_saved_as_merchant_action_not_fake_refund(commerce):
    row = start(commerce)
    url = f'/api/commerce/orders/{row["id"]}/service-request'
    assert commerce[0].post(url, json={"kind": "refund"}, headers=auth()).status_code == 409
    commerce[4][row["provider_run_id"]].update(status="succeeded", revision=2,
        result={"purchase": {"kind": "receipt_captured", "receipt": {"total": {"amount": "115.14", "currency": "USD"}}}})
    response = commerce[0].post(url, json={"kind": "refund"}, headers=auth())
    assert response.status_code == 200
    assert response.json["order"]["status"] == "succeeded"
    assert response.json["order"]["service_request"] == {"kind": "refund", "status": "needs_merchant_action"}
    assert commerce[0].post(f'/api/commerce/orders/{row["id"]}/cancel', headers=auth()).status_code == 409


def test_typed_form_response_validates_schema_and_stale_requests(commerce):
    row = start(commerce)
    commerce[4][row["provider_run_id"]].update(status="awaiting_input", revision=2, requiredAction={"requestId": "req1", "request": {
        "interaction": {"kind": "form", "responseSchema": {"type": "object", "properties": {"size": {"enum": ["S", "M"]}}, "required": ["size"]}}}})
    url = f'/api/commerce/orders/{row["id"]}/messages'
    data = {"id": str(uuid4()), "requestId": "req1", "values": {"size": "M"}}
    assert commerce[0].post(url, json={**data, "requestId": "old"}, headers=auth()).status_code == 409
    assert commerce[0].post(url, json={**data, "values": {"size": "XL"}}, headers=auth()).status_code == 400
    assert commerce[0].post(url, json={**data, "values": {"password": "secret"}}, headers=auth()).status_code == 400
    assert commerce[0].post(url, json=data, headers=auth()).status_code == 202
    assert commerce[3][-1][3]["parts"][0]["response"] == {"kind": "form", "values": {"size": "M"}}


@pytest.mark.parametrize("url", ["http://store.com/p", "javascript:alert(1)", "https://127.0.0.1/a", "https://localhost/x", "https://10.0.0.1/x", "https://user:pass@shop.com/p", "https://store.com:8080/x"])
def test_unsafe_store_urls_are_rejected(url):
    with pytest.raises(service.CommerceError): service.https_url(url)


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-1", 0, "10.001", "100001", None])
def test_invalid_spending_caps_are_rejected(value):
    with pytest.raises(service.CommerceError): service.money(value)


def test_provider_errors_never_expose_credentials(monkeypatch):
    monkeypatch.setattr(service, "settings", lambda: {"server": "sk_secret"})
    def fake(method, url, **kwargs):
        assert kwargs["headers"]["x-crossmint-user-id"] == USER_A
        return httpx.Response(403, json={"message": "sk_secret rejected"})
    monkeypatch.setattr(httpx, "request", fake)
    with pytest.raises(service.CommerceError) as error: service.Crossmint(USER_A).call("GET", "/agent-checkouts")
    assert "sk_secret" not in str(error.value)


@pytest.mark.parametrize("changed", [{"total": "999"}, {"currency": "EUR"}, {"expired": True}, {"rail": "pending_verification"}, {"http": 404}])
def test_payment_authorization_rejects_wrong_amount_expiry_rail_or_owner(monkeypatch, changed):
    monkeypatch.setattr(service, "settings", lambda: {"server": "sk_production_test", "client": "ck_production_test"})
    intent = {"status": "active", "amount": {"total": changed.get("total", "42.50"), "currency": changed.get("currency", "USD")},
              "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=-1 if changed.get("expired") else 1)).isoformat(),
              "rails": [{"status": changed.get("rail", "active"), "credentialFormats": ["card"]}]}
    def get(url, **kwargs):
        assert kwargs["headers"]["Authorization"] == "Bearer owner-token"
        return httpx.Response(changed.get("http", 200), json=intent, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx, "get", get)
    with pytest.raises(service.CommerceError):
        service.Crossmint(USER_A).verify_payment(str(uuid4()), "owner-token", {"amount": {"value": "42.50", "currency": "USD"}}, "50.00")


def test_staging_keys_are_blocked_and_server_key_never_reaches_client(monkeypatch):
    monkeypatch.setattr(service, "settings", lambda: {"server": "sk_staging_secret", "client": "ck_staging_public", "database_key": "dbsecret"})
    config = service.public_config()
    assert config["ready"] is False and config["clientKey"] == ""
    assert "sk_staging_secret" not in str(config) and "dbsecret" not in str(config)


def test_checkout_and_wallet_pages_are_gated_and_orders_are_not_samples():
    client = app.test_client()
    for path in ("/wallet", "/checkout/demo", f"/checkout/{uuid4()}"):
        page = client.get(path).text
        assert 'data-auth-page="index" hidden' in page
        assert "commerce.bundle.js" in page
    assert "Sample orders" not in client.get("/orders").text


def demo_payload():
    return {"id": str(uuid4()), "consent": True, "maxCost": "180", "shipping": "express", "items": [
        {"id": "headphones", "title": "Demo headphones", "quantity": 1, "price_cents": 14900, "store_name": "Demo store"}]}


def save_demo(commerce, payload=None):
    payload = payload or demo_payload()
    # These tests cover order behavior after approval. test_passkeys exercises
    # this same endpoint with actual cryptographically signed WebAuthn responses.
    with patch.object(routes.Passkeys, "verify_approval"):
        response = commerce[0].post("/api/commerce/demo-orders", json=payload, headers=auth())
    assert response.status_code == 201
    return response.json["order"], payload


def test_demo_is_saved_without_crossmint_and_totals_are_computed_on_server(commerce, monkeypatch):
    def forbidden(*args):
        raise AssertionError("Demo must never instantiate Crossmint")
    monkeypatch.setattr(routes, "Crossmint", forbidden)
    payload = {**demo_payload(), "user_id": USER_B, "is_demo": False, "status": "refunded", "total": "0.01"}
    row, _ = save_demo(commerce, payload)
    assert row["is_demo"] is True and row["user_id"] == USER_A and row["status"] == "succeeded"
    assert row["result"]["purchase"]["receipt"]["total"]["amount"] == "173.87"
    assert commerce[0].get(f'/api/commerce/orders/{row["id"]}', headers=auth()).json["order"] == row
    assert commerce[0].get("/api/commerce/orders", headers=auth()).json["orders"] == [row]
    assert commerce[0].get(f'/api/commerce/orders/{row["id"]}/messages', headers=auth()).json == {"messages": []}
    assert not commerce[3]


@pytest.mark.parametrize("kind,target", [("refund", "refunded"), ("cancellation", "cancelled")])
def test_demo_actions_persist_and_retries_never_revive_the_order(commerce, monkeypatch, kind, target):
    monkeypatch.setattr(routes, "Crossmint", lambda *args: pytest.fail("No live provider for demo actions"))
    row, payload = save_demo(commerce)
    url = f'/api/commerce/orders/{row["id"]}/service-request'
    for _ in range(2):
        response = commerce[0].post(url, json={"kind": kind}, headers=auth())
        assert response.status_code == 200
        assert response.json["order"]["status"] == target
        assert response.json["order"]["service_request"]["status"] == "simulated"
    replay = commerce[0].post("/api/commerce/demo-orders", json=payload, headers=auth())
    assert replay.status_code == 200 and replay.json["order"]["status"] == target
    assert len(commerce[2]) == 1
    opposite = "refund" if kind == "cancellation" else "cancellation"
    assert commerce[0].post(url, json={"kind": opposite}, headers=auth()).status_code == 409
    assert commerce[2][row["id"]]["status"] == target


def test_demo_cancel_endpoint_and_account_isolation(commerce, monkeypatch):
    row, payload = save_demo(commerce)
    client = commerce[0]
    monkeypatch.setattr(routes, "Crossmint", lambda *args: pytest.fail("Demo accessed provider"))
    assert client.post("/api/commerce/demo-orders", json=payload).status_code == 401
    assert client.post("/api/commerce/demo-orders", json=payload, headers=auth(USER_B)).status_code == 403
    for suffix, method, data in [("", "get", None), ("/cancel", "post", {}), ("/service-request", "post", {"kind": "refund"})]:
        assert getattr(client, method)(f'/api/commerce/orders/{row["id"]}{suffix}', json=data, headers=auth(USER_B)).status_code == 404
    response = client.post(f'/api/commerce/orders/{row["id"]}/cancel', headers=auth())
    assert response.status_code == 200 and response.json["order"]["status"] == "cancelled"
    assert client.post(f'/api/commerce/orders/{row["id"]}/messages', json={"id": str(uuid4())}, headers=auth()).status_code == 409


@pytest.mark.parametrize("changes", [{"consent": False}, {"maxCost": "1"}, {"maxCost": "NaN"}, {"shipping": "unknown"}, {"items": []}, {"items": [{"title": "Bad", "quantity": 1, "price_cents": True}]}])
def test_invalid_demo_never_writes_an_order(commerce, changes):
    response = commerce[0].post("/api/commerce/demo-orders", json={**demo_payload(), **changes}, headers=auth())
    assert response.status_code == 400 and not commerce[2] and not commerce[3]


def test_demo_replay_rejects_changed_basket(commerce):
    row, payload = save_demo(commerce)
    payload["items"][0]["title"] = "A different product"
    assert commerce[0].post("/api/commerce/demo-orders", json=payload, headers=auth()).status_code == 409
    assert commerce[2][row["id"]]["item"]["title"] == "Demo headphones"


def test_demo_status_update_uses_atomic_owner_and_status_predicates(monkeypatch):
    monkeypatch.setattr(service, "settings", lambda: {"database_key": "test", "database_url": "https://example.supabase.co"})
    order_id = str(uuid4())
    def fake(method, url, **kwargs):
        assert method == "PATCH"
        assert kwargs["params"] == {"user_id": f"eq.{USER_A}", "id": f"eq.{order_id}", "status": "eq.succeeded"}
        return httpx.Response(200, json=[{"id": order_id, "status": "refunded"}], request=httpx.Request(method, url))
    monkeypatch.setattr(httpx, "request", fake)
    assert service.Orders(USER_A).update(order_id, {"status": "refunded"}, expected_status="succeeded")["status"] == "refunded"


def test_losing_a_demo_refund_race_does_not_overwrite_cancellation(commerce, monkeypatch):
    row, _ = save_demo(commerce)
    original = routes.Orders.update
    def race(store, key, values, **kwargs):
        commerce[2][key]["status"] = "cancelled"
        return original(store, key, values, **kwargs)
    monkeypatch.setattr(routes.Orders, "update", race)
    response = commerce[0].post(f'/api/commerce/orders/{row["id"]}/service-request', json={"kind": "refund"}, headers=auth())
    assert response.status_code == 409
    assert commerce[2][row["id"]]["status"] == "cancelled"


LONG_PRODUCT_ID = (
    'product-search:google-shopping:catalogid:11834299784973750224,'
    'productid:9045417074878629248,gpcid:2594221828226506045,'
    'headlineOfferDocid:10711971104529786622,rds:PC_2594221828226506045|'
    'PROD_PC_2594221828226506045,imageDocid:16864816272954520955,'
    'mid:576462512317065448,pvt:a,pvf:'
)


def test_demo_preserves_long_cart_ids_in_order_and_receipt(commerce):
    payload = demo_payload()
    payload['items'][0]['id'] = LONG_PRODUCT_ID
    row, _ = save_demo(commerce, payload)
    assert len(LONG_PRODUCT_ID) == 278
    assert row['item']['id'] == LONG_PRODUCT_ID
    assert row['result']['items'][0]['id'] == LONG_PRODUCT_ID
    restored = commerce[0].get(f'/api/commerce/orders/{row["id"]}', headers=auth()).json['order']
    assert restored['result']['items'][0]['id'] == LONG_PRODUCT_ID


def test_demo_hash_distinguishes_products_with_same_first_200_characters():
    from commerce.demo import demo_order_input
    payload = demo_payload()
    payload['items'][0]['id'] = LONG_PRODUCT_ID
    first = demo_order_input(payload, payload['id'])
    payload['items'][0]['id'] = LONG_PRODUCT_ID + 'different-variant'
    second = demo_order_input(payload, payload['id'])
    assert first['request_hash'] != second['request_hash']


def test_live_checkout_preserves_long_cart_id(commerce):
    commerce[1]['item']['id'] = LONG_PRODUCT_ID
    row = start(commerce)
    assert row['item']['id'] == LONG_PRODUCT_ID
