"""Real P-256 signatures exercise py_webauthn; only persistence is replaced."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from uuid import UUID, uuid4

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
import pytest
from webauthn.helpers import bytes_to_base64url as b64

from commerce import passkeys, routes
from test_commerce import commerce, auth, demo_payload, USER_A, USER_B

ORIGIN = "https://shop.example.com"


@pytest.fixture
def ceremony(commerce, monkeypatch):
    monkeypatch.setenv("PASSKEY_ORIGIN", ORIGIN)
    database = {"passkey_credentials": [], "passkey_challenges": []}

    def call(store, table, method, params=None, body=None, upsert=False):
        rows = database[table]
        def match(row):
            if row["user_id"] != store.user_id: return False
            for key, value in (params or {}).items():
                if key == "on_conflict": continue
                operator, expected = value.split(".", 1)
                if operator == "eq" and str(row.get(key)) != expected: return False
                if operator == "gt" and row[key] <= expected: return False
            return True
        matched = [row for row in rows if match(row)]
        if method == "GET": return deepcopy(matched)
        if method == "DELETE":
            database[table] = [row for row in rows if row not in matched]
            return deepcopy(matched)
        if method == "POST":
            if upsert:
                database[table] = [row for row in rows if not (row["user_id"] == store.user_id and row["purpose"] == body["purpose"])]
            database[table].append(deepcopy(body))
            return [deepcopy(body)]
        if method == "PATCH":
            for row in matched: row.update(body)
            return deepcopy(matched)
        raise AssertionError(method)
    monkeypatch.setattr(passkeys.Passkeys, "call", call)
    return commerce, database


def post(env, path, data=None, user=USER_A, origin=ORIGIN):
    return env[0][0].post('/api/commerce' + path, json=data or {}, headers={**auth(user), "Origin": origin})


def registration(options, key, credential_id, *, origin=ORIGIN, flags=0x45):
    public = key.public_key().public_numbers()
    cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: public.x.to_bytes(32, 'big'), -3: public.y.to_bytes(32, 'big')})
    auth_data = hashlib.sha256(b'shop.example.com').digest() + bytes([flags]) + bytes(4) + bytes(16) + len(credential_id).to_bytes(2, 'big') + credential_id + cose
    client = json.dumps({"type": "webauthn.create", "challenge": options['publicKey']['challenge'], "origin": origin}).encode()
    return {"challengeId": options['challengeId'], "credential": {"id": b64(credential_id), "rawId": b64(credential_id), "type": "public-key", "response": {
        "clientDataJSON": b64(client), "attestationObject": b64(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data}))}}}


def enroll(env, user=USER_A):
    key, credential_id = ec.generate_private_key(ec.SECP256R1()), uuid4().bytes
    options = post(env, '/passkeys/register/options', user=user)
    assert options.status_code == 200
    proof = registration(options.json, key, credential_id)
    response = post(env, '/passkeys/register/verify', proof, user=user)
    assert response.status_code == 200, response.json
    return key, credential_id


def assertion(options, key, credential_id, *, origin=ORIGIN, flags=5, rp='shop.example.com', count=1, user=USER_A, challenge=None):
    client = json.dumps({"type": "webauthn.get", "challenge": challenge or options['publicKey']['challenge'], "origin": origin}).encode()
    auth_data = hashlib.sha256(rp.encode()).digest() + bytes([flags]) + count.to_bytes(4, 'big')
    signature = key.sign(auth_data + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
    return {"challengeId": options['challengeId'], "credential": {"id": b64(credential_id), "rawId": b64(credential_id), "type": "public-key", "response": {
        "authenticatorData": b64(auth_data), "clientDataJSON": b64(client), "signature": b64(signature), "userHandle": b64(UUID(user).bytes)}}}


def prepare(env, **kwargs):
    key, credential_id = enroll(env)
    payload = demo_payload()
    options = post(env, '/passkeys/demo-approval/options', payload)
    assert options.status_code == 200, options.json
    payload['passkey'] = assertion(options.json, key, credential_id, **kwargs)
    return payload


def test_registration_and_signed_checkout(ceremony):
    env, database = ceremony
    payload = prepare(ceremony)
    row = database['passkey_credentials'][0]
    assert row['user_id'] == USER_A and row['sign_count'] == 0
    assert set(row) == {'id', 'user_id', 'public_key', 'sign_count'}
    response = post(ceremony, '/demo-orders', payload)
    assert response.status_code == 201, response.json
    assert row['sign_count'] == 1
    assert database['passkey_challenges'] == []
    assert response.json['order']['result']['purchase']['receipt']['total']['amount'] == '173.87'
    assert not env[3]  # No Crossmint calls.
    assert post(ceremony, '/demo-orders', payload).status_code == 200  # Lost response recovery.
    assert len(env[2]) == 1
    payload['id'] = str(uuid4())
    assert post(ceremony, '/demo-orders', payload).status_code == 403
    assert len(env[2]) == 1


@pytest.mark.parametrize('changes', [{'origin': 'https://evil.example'}, {'flags': 1}, {'flags': 4}, {'rp': 'evil.example'}, {'user': USER_B}, {'challenge': b64(b'wrong challenge')}])
def test_invalid_signed_approvals_never_create_orders(ceremony, changes):
    payload = prepare(ceremony, **changes)
    response = post(ceremony, '/demo-orders', payload)
    assert response.status_code == 403, response.json
    assert not ceremony[0][2]
    assert not ceremony[1]['passkey_challenges']


def test_bad_signature_and_replay(ceremony):
    payload = prepare(ceremony)
    original = deepcopy(payload)
    payload['passkey']['credential']['response']['signature'] = b64(b'not a signature')
    assert post(ceremony, '/demo-orders', payload).status_code == 403
    assert post(ceremony, '/demo-orders', original).status_code == 403
    assert not ceremony[0][2]


@pytest.mark.parametrize('field,value', [('maxCost', '190'), ('shipping', 'standard'), ('id', str(uuid4()))])
def test_approval_bound_to_purchase(ceremony, field, value):
    payload = prepare(ceremony)
    original = deepcopy(payload)
    payload[field] = value
    assert post(ceremony, '/demo-orders', payload).status_code == 403
    assert not ceremony[0][2]
    assert post(ceremony, '/demo-orders', original).status_code == 201


def test_changed_basket_and_other_account(ceremony):
    payload = prepare(ceremony)
    original = deepcopy(payload)
    payload['items'][0]['quantity'] = 2
    payload['maxCost'] = '500'
    assert post(ceremony, '/demo-orders', payload).status_code == 403
    assert post(ceremony, '/demo-orders', original, user=USER_B).status_code == 403
    assert not ceremony[0][2]


def test_missing_expired_and_malformed_proofs(ceremony):
    assert post(ceremony, '/demo-orders', demo_payload()).status_code == 403
    assert post(ceremony, '/passkeys/demo-approval/options', demo_payload()).status_code == 409
    payload = prepare(ceremony)
    ceremony[1]['passkey_challenges'][0]['expires_at'] = datetime(2000, 1, 1, tzinfo=timezone.utc).isoformat()
    assert post(ceremony, '/demo-orders', payload).status_code == 403
    payload['passkey']['credential']['response'] = []
    assert post(ceremony, '/demo-orders', payload).status_code == 403
    assert not ceremony[0][2]


@pytest.mark.parametrize('changes', [{'origin': 'https://evil.example'}, {'flags': 0x41}])
def test_registration_verifies_origin_and_user(ceremony, changes):
    options = post(ceremony, '/passkeys/register/options').json
    proof = registration(options, ec.generate_private_key(ec.SECP256R1()), uuid4().bytes, **changes)
    assert post(ceremony, '/passkeys/register/verify', proof).status_code == 403
    assert not ceremony[1]['passkey_credentials']
    assert not ceremony[1]['passkey_challenges']


def test_registration_replay_and_missing_data(ceremony):
    options = post(ceremony, '/passkeys/register/options').json
    assert options['publicKey']['authenticatorSelection']['userVerification'] == 'required'
    proof = registration(options, ec.generate_private_key(ec.SECP256R1()), uuid4().bytes)
    assert post(ceremony, '/passkeys/register/verify', proof).status_code == 200
    assert post(ceremony, '/passkeys/register/verify', proof).status_code == 403
    assert post(ceremony, '/passkeys/register/verify', {}).status_code == 400
    assert len(ceremony[1]['passkey_credentials']) == 1


def test_authentication_and_origin_are_required(ceremony):
    for path in ['/passkeys/register/options', '/passkeys/register/verify', '/passkeys/demo-approval/options']:
        assert post(ceremony, path, user='invalid').status_code == 401
        assert post(ceremony, path, demo_payload(), origin='https://evil.example').status_code == 403
    assert ceremony[0][0].get('/api/commerce/passkeys').status_code == 401


def test_localhost_and_production_origin_configuration(monkeypatch):
    from app import app
    monkeypatch.delenv('PASSKEY_ORIGIN', raising=False)
    with app.test_request_context('/', base_url='http://localhost:5000', headers={'Origin': 'http://localhost:5000'}):
        assert passkeys.relying_party() == ('localhost', 'http://localhost:5000')
    for host in ('http://127.0.0.1:5000', 'https://unconfigured.example.com'):
        with app.test_request_context('/', base_url=host, headers={'Origin': host}):
            with pytest.raises(passkeys.CommerceError):
                passkeys.relying_party()
