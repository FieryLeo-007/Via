import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserOptions, serialize, registerPasskey, approveDemoPurchase, encode} from '../static/scripts/passkeys.mjs';

const bytes = new Uint8Array([0, 128, 255]);
const encoded = encode(bytes);
const credential = () => ({id: encoded, rawId: bytes, type: 'public-key',
    response: {clientDataJSON: bytes, authenticatorData: bytes, signature: bytes, userHandle: bytes},
    getClientExtensionResults: () => ({})});
function browser({cancel = false, failVerify = false} = {}) {
    const calls = [];
    globalThis.isSecureContext = true;
    globalThis.PublicKeyCredential = class {};
    globalThis.window = {projectVAccount: {client: {auth: {getSession: async () => ({data: {session: {access_token: 'token'}}})}}}};
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {credentials: {
        get: async options => {
            calls.push(['get', options]);
            if (cancel) throw new DOMException('Cancelled', 'NotAllowedError');
            return credential();
        },
        create: async options => {
            calls.push(['create', options]);
            return {...credential(), response: {clientDataJSON: bytes, attestationObject: bytes, getTransports: () => ['internal']}};
        },
    }}});
    globalThis.fetch = async (url, options) => {
        calls.push([url, options.body ? JSON.parse(options.body) : null]);
        if (url.endsWith('/options')) return {ok: true, json: async () => ({challengeId: 'challenge', publicKey: {challenge: encoded, user: {id: encoded}, allowCredentials: [{id: encoded}]}})};
        return {ok: !failVerify, status: 403, json: async () => failVerify ? {error: 'Invalid signature'} : {registered: true, order: {id: 'order'}}};
    };
    return calls;
}

test('WebAuthn binary values roundtrip without modifying server options', () => {
    const options = {challenge: encoded, user: {id: encoded}, excludeCredentials: [{id: encoded, type: 'public-key'}]};
    const parsed = browserOptions(options, true);
    assert.deepEqual(parsed.challenge, bytes);
    assert.deepEqual(parsed.user.id, bytes);
    assert.deepEqual(parsed.excludeCredentials[0].id, bytes);
    assert.equal(options.user.id, encoded);
    const result = serialize(credential());
    assert.equal(result.response.signature, encoded);
    assert.equal(result.response.userHandle, encoded);
});
test('registration is verified by the server before reporting success', async () => {
    const calls = browser();
    assert.deepEqual(await registerPasskey(), {registered: true, order: {id: 'order'}});
    assert.equal(calls[1][0], 'create');
    assert.equal(calls[2][0], '/api/commerce/passkeys/register/verify');
    assert.equal(calls[2][1].challengeId, 'challenge');
    assert.deepEqual(calls[2][1].credential.response.transports, ['internal']);
});
test('checkout submits a signed proof with the exact reviewed purchase', async () => {
    const calls = browser();
    const purchase = {id: 'order', consent: true, maxCost: '180', shipping: 'express', items: [{title: 'Item'}]};
    await approveDemoPurchase(purchase);
    assert.deepEqual(calls[0][1], purchase);
    assert.equal(calls[1][0], 'get');
    assert.equal(calls[2][0], '/api/commerce/demo-orders');
    assert.deepEqual(calls[2][1], {...purchase, passkey: {challengeId: 'challenge', credential: serialize(credential())}});
});
test('cancelled prompts never submit or approve an order', async () => {
    const calls = browser({cancel: true});
    await assert.rejects(approveDemoPurchase({id: 'order'}), /cancelled or timed out/);
    assert.equal(calls.length, 2);
});
test('verification rejection and unsupported browsers cannot claim success', async () => {
    browser({failVerify: true});
    await assert.rejects(approveDemoPurchase({id: 'order'}), /Invalid signature/);
    const calls = browser();
    globalThis.isSecureContext = false;
    await assert.rejects(registerPasskey(), /HTTPS or localhost/);
    assert.deepEqual(calls, []);
});

test('IP-address development origins get actionable guidance before opening a device prompt', async () => {
    const calls = browser();
    globalThis.location = {hostname: '127.0.0.1', href: 'http://127.0.0.1:5000/checkout/demo'};
    try {
        await assert.rejects(registerPasskey(), /localhost/);
        assert.deepEqual(calls, []);
    } finally { delete globalThis.location; }
});
