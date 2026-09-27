import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import * as demo from '../static/scripts/demo-checkout.mjs';
import {cartItems, fulfillDemoOrder} from '../static/scripts/cart-store.mjs';
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
        ...demo, ...icons, cartItems, fulfillDemoOrder, money, safeUrl, statusLabel,
        window, URLSearchParams, localStorage,
        sessionStorage: {getItem: () => JSON.stringify(run), setItem() {}},
        React: {createElement: () => null},
        useState: initial => [typeof initial === 'function' ? initial() : initial, value => { if (typeof value === 'string' && value) errors.push(value); }],
        useRef: value => ({current: value}),
        useEffect: effect => effects.push(effect),
        api: async (path, options) => {
            requests.push({path, options});
            if (fail) throw new Error('Save failed');
            return {order: {id: options.body.id, is_demo: true, status: 'succeeded', result: {items: options.body.items}}};
        },
    });
    vm.runInContext(compiled + '\nDemoCheckout();', context);
    effects[1]();
    await new Promise(resolve => setImmediate(resolve));
    return {requests, errors};
}

test('demo page saves the order, then removes only the selected cart product', async () => {
    const other = {id: 'two', title: 'Two', price_cents: 2000, quantity: 1};
    const app = await checkout({initial: [{id: 'one', title: 'One', price_cents: 1000, quantity: 2}, other]});
    assert.equal(app.requests[0].path, '/demo-orders');
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
