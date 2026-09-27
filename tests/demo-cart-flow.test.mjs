import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as demo from '../static/scripts/demo-checkout.mjs';
import {cartItems, fulfillDemoOrder, trackCartCheckout} from '../static/scripts/cart-store.mjs';
import {money, safeUrl, statusLabel} from '../static/scripts/commerce-client.mjs';

// Run the real checkout component's completion effect with browser storage and
// an isolated API; no payment provider or hosted account is involved.
const source = readFileSync(new URL('../static/scripts/demo-commerce.jsx', import.meta.url), 'utf8');
const compiled = transformSync(source.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function'), {loader: 'jsx'}).code;
const icons = Object.fromEntries(source.match(/import \{(.*?)\} from "lucide-react"/)[1].split(',').map(name => [name.trim(), () => null]));

async function checkout({fromCart = true, stage = 'complete', fail = false, initial = [{id: 'one', title: 'One', price_cents: 1000, quantity: 2}]} = {}) {
    const storage = new Map([['projectv:cart', JSON.stringify(initial)]]);
    globalThis.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
    globalThis.window = new EventTarget();
    window.location = {search: fromCart ? '?source=cart&item=one' : ''};
    const selected = fromCart ? initial.filter(item => item.id === 'one') : [];
    const run = {...demo.newDemoRun(selected), stage};
    const effects = [], requests = [], errors = [];
    const context = vm.createContext({
        ...demo, ...icons, localPasskeyUrl: () => null, cartItems, fulfillDemoOrder, money, safeUrl, statusLabel,
        window, URLSearchParams, localStorage,
        sessionStorage: {getItem: () => JSON.stringify(run), setItem() {}},
        React: {createElement: () => null},
        useState: initial => [typeof initial === 'function' ? initial() : initial, value => { if (typeof value === 'string' && value) errors.push(value); }],
        useRef: value => ({current: value}),
        useEffect: effect => effects.push(effect),
        api: async (path, options) => {
            requests.push({path, options});
            if (fail) throw new Error('Save failed');
            return {order: {id: run.orderId, is_demo: true, status: 'succeeded', result: {items: run.items}}};
        },
    });
    vm.runInContext(compiled + '\nDemoCheckout();', context);
    effects[3]();
    await new Promise(resolve => setImmediate(resolve));
    return {requests, errors};
}

test('demo page checks the server-approved order, then removes only the selected cart product', async () => {
    const other = {id: 'two', title: 'Two', price_cents: 2000, quantity: 1};
    const app = await checkout({initial: [{id: 'one', title: 'One', price_cents: 1000, quantity: 2}, other]});
    assert.match(app.requests[0].path, /^\/orders\/[a-f0-9-]+$/);
    assert.equal(app.requests[0].options, undefined);
    assert.deepEqual(cartItems(), [other]);
    assert.deepEqual(app.errors, []);
});

test('failed saves and cancelled demo walkthroughs keep their cart items', async () => {
    const failed = await checkout({fail: true});
    assert.deepEqual(failed.errors, ['Save failed']);
    assert.equal(cartItems()[0].quantity, 2);
    const cancelled = await checkout({stage: 'cancelled'});
    assert.equal(cancelled.requests.length, 0);
    assert.equal(cartItems()[0].quantity, 2);
});

test('Wallet samples and cart sample fallbacks never consume cart products', async () => {
    await checkout({fromCart: false, initial: [{...demo.SAMPLE_ITEM}]});
    assert.equal(cartItems()[0].id, 'demo-headphones');
    await checkout({initial: [{id: 'one', title: 'Invalid price', price_cents: 0, quantity: 1}]});
    assert.equal(cartItems()[0].id, 'one');
});

function approval({registered = true, reject = false, fromCart = false} = {}) {
    const cart = [{id: 'one', title: 'One', price_cents: 1000, quantity: 2}];
    const storage = new Map([['projectv:cart', JSON.stringify(cart)]]);
    globalThis.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
    globalThis.window = new EventTarget();
    window.location = {search: fromCart ? '?source=cart' : ''};
    const run = {...demo.newDemoRun(fromCart ? cart : []), stage: 'approval'};
    const nodes = [], states = [], calls = [];
    const context = vm.createContext({
        ...demo, ...icons, localPasskeyUrl: () => null, money, safeUrl, statusLabel,
        window, URLSearchParams, cartItems, fulfillDemoOrder, trackCartCheckout,
        sessionStorage: {getItem: () => JSON.stringify(run)},
        React: {createElement: (type, props, ...children) => { const node = {type, props, children}; nodes.push(node); return node; }},
        useState: initial => {
            const index = states.length;
            states.push(typeof initial === 'function' ? initial() : initial);
            return [states[index], value => {states[index] = typeof value === 'function' ? value(states[index]) : value;}];
        },
        useRef: value => ({current: value}), useEffect() {},
        passkeyStatus: async () => ({registered}),
        registerPasskey: async () => {calls.push('register');},
        approveDemoPurchase: async () => {calls.push('verify'); if (reject) throw new Error('Passkey cancelled'); return {order: {id: run.orderId, is_demo: true, status: "succeeded", result: {items: run.items}}};},
    });
    vm.runInContext(compiled + '\nDemoCheckout();', context);
    const click = nodes.find(n => n.type === 'button' && n.props?.onClick?.name === 'approve').props.onClick;
    return {click, states, calls, stage: () => states.find(s => s?.version === 1)?.stage};
}

test('checkout advances only after successful passkey verification and blocks duplicate clicks', async () => {
    const app = approval();
    const pending = app.click();
    await app.click();
    await pending;
    assert.deepEqual(app.calls, ['verify']);
    assert.equal(app.stage(), 'purchasing');
    const cancelled = approval({reject: true});
    await cancelled.click();
    assert.equal(cancelled.stage(), 'approval');
    assert.ok(cancelled.states.includes('Passkey cancelled'));
});

test('creating a first passkey does not approve the purchase', async () => {
    const app = approval({registered: false});
    await app.click();
    assert.deepEqual(app.calls, ['register']);
    assert.equal(app.stage(), 'approval');
});


test('search checkout removes purchased products as soon as the server confirms completion', async () => {
    const app = approval({fromCart: true});
    assert.equal(cartItems().length, 1);
    await app.click();
    assert.deepEqual(cartItems(), []);
    assert.equal(app.stage(), 'purchasing');
    const cancelled = approval({fromCart: true, reject: true});
    await cancelled.click();
    assert.equal(cartItems().length, 1);
});
