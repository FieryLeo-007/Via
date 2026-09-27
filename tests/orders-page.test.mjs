import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {money, statusLabel, TERMINAL, safeUrl} from '../static/scripts/commerce-client.mjs';

// Exercise the merged Orders controller with a small DOM and an isolated API.
async function setup({fail = false, waitForSave, liveStatus = "succeeded"} = {}) {
    function element() {
        const el = {value: '', textContent: '', innerHTML: '', hidden: true, dataset: {}, events: {},
            classList: {toggle() {}}, setAttribute() {}, focus() {this.focused = true;},
            showModal() {this.open = true;}, close() {this.open = false; this.events.close?.();},
            addEventListener(name, fn) {this.events[name] = fn;},
            querySelectorAll() {return [];}, querySelector() {return this.counter;},
            click() {return this.events.click?.();}};
        el.counter = {textContent: ''};
        return el;
    }
    const ids = Object.fromEntries(['orders-list', 'orders-empty', 'order-search', 'order-sort', 'orders-notice', 'receipt-notice', 'order-count', 'clear-filters', 'dismiss-notice', 'order-action-dialog', 'order-action-form', 'order-action-confirm', 'order-action-keep', 'order-action-close', 'order-action-error', 'order-action-title', 'order-action-description', 'order-action-product', 'order-action-reference', 'order-action-amount', 'order-action-symbol'].map(id => [id, element()]));
    ids['order-sort'].value = 'newest';
    const metrics = Object.fromEntries(['spend', 'active', 'completed'].map(key => [key, element()]));
    const chips = ['all', 'active', 'succeeded', 'demo', 'refunded', 'cancelled'].map(filter => Object.assign(element(), {dataset: {filter}}));
    const row = (id, is_demo) => ({id, is_demo, status: 'succeeded', created_at: '2026-09-27T12:00:00Z',
        item: {title: is_demo ? 'Demo headphones' : 'Live item', quantity: 1, store_name: 'Example', product_page_url: 'https://example.com/item'},
        result: {items: [], shipping: 'standard', shipping_cents: 0, tax_cents: 800,
            purchase: {receipt: {merchantOrderId: id, total: {amount: '108.00', currency: 'USD'}}}}});
    let rows = [row('demo-123', true), {...row('live-123', false), status: liveStatus, provider_run_id: 'run-123'}];
    const calls = [], reconciled = [];
    const api = async (path, options) => {
        calls.push({path, options});
        if (path === '/orders') return {orders: structuredClone(rows)};
        if (waitForSave) await waitForSave;
        if (fail) throw new Error('Could not save request. Please try again.');
        const index = path.includes('demo-123') ? 0 : 1;
        const kind = options.body?.kind || 'cancellation';
        const order = {...rows[index], status: kind === 'refund' ? 'refunded' : 'cancelled',
            service_request: {kind, amount: '108.00', completed_at: '2026-09-27T12:01:00Z'}};
        rows[index] = order;
        return {order, message: 'Demo action saved. No real money moves.'};
    };
    const document = {getElementById: id => ids[id], querySelectorAll: () => chips,
        querySelector: selector => selector.startsWith('[data-metric=') ? metrics[selector.match(/"(.*?)"/)[1]] : chips[0]};
    const source = readFileSync(new URL('../static/scripts/orders.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
    vm.runInNewContext(source, {document, window: {location: {search: '?order=demo-123'}, addEventListener() {}},
        reconcileCartOrders: orders => reconciled.push(structuredClone(orders)), api, accountReady: async () => ({}), money, statusLabel, TERMINAL, safeUrl, URLSearchParams,
        setTimeout() {}, clearTimeout() {}, confirm: () => {throw new Error('Browser confirmations must not be used');}});
    await new Promise(resolve => setImmediate(resolve));
    const action = async (kind, id = 'demo-123') => ids['orders-list'].events.click({target: {closest: () => ({dataset: {action: kind}, closest: () => ({dataset: {id}})})}});
    return {ids, metrics, chips, calls, reconciled, action, submit: () => ids['order-action-form'].events.submit({preventDefault() {}})};
}

test('merged Orders renders persisted demos in the redesign and excludes them from real spend', async () => {
    const {ids, metrics, chips, calls} = await setup();
    assert.match(ids['orders-list'].innerHTML, /data-id="demo-123" open/);
    assert.match(ids['orders-list'].innerHTML, /order-id-column/);
    assert.match(ids['orders-list'].innerHTML, /order-demo-badge/);
    assert.match(ids['orders-list'].innerHTML, /Cancel demo order/);
    assert.match(ids['orders-list'].innerHTML, /Refund demo order/);
    assert.equal(metrics.spend.textContent, '$108.00');
    chips.find(chip => chip.dataset.filter === 'demo').click();
    assert.match(ids['orders-list'].innerHTML, /Demo headphones/);
    assert.doesNotMatch(ids['orders-list'].innerHTML, /Live item/);
    assert.equal(calls.length, 1);
});

for (const [action, label] of [['refund', 'Demo refunded'], ['cancellation', 'Demo cancelled']]) {
    test(`merged Orders persists demo ${action} and renders its final state`, async () => {
        const {ids, calls, action: perform, submit} = await setup();
        await perform(action);
        assert.equal(calls.length, 1, 'opening the modal must not change the order');
        assert.equal(ids['order-action-dialog'].open, true);
        assert.match(ids['order-action-amount'].textContent, /108.00/);
        await submit();
        assert.equal(ids['order-action-dialog'].open, false);
        assert.equal(calls.at(-1).options.method, 'POST');
        assert.equal(calls.at(-1).options.body.kind, action);
        assert.match(ids['orders-list'].innerHTML, new RegExp(label));
        assert.doesNotMatch(ids['orders-list'].innerHTML, /Cancel demo order|Refund demo order/);
        assert.equal(ids['receipt-notice'].textContent, 'Demo action saved. No real money moves.');
    });
}


test('confirmation can be dismissed without submitting any request', async () => {
    const app = await setup();
    for (const control of ['order-action-keep', 'order-action-close']) {
        await app.action('refund');
        assert.equal(app.ids['order-action-keep'].focused, true);
        app.ids[control].click();
        assert.equal(app.ids['order-action-dialog'].open, false);
    }
    await app.action('cancellation');
    const dialog = app.ids['order-action-dialog'];
    dialog.events.click({target: dialog});
    assert.equal(dialog.open, false);
    assert.equal(app.calls.length, 1);
    assert.equal(app.ids['order-search'].focused, true);
});

test('failed requests keep the modal open with an inline error and enabled retry', async () => {
    const app = await setup({fail: true});
    await app.action('refund');
    await app.submit();
    assert.equal(app.ids['order-action-dialog'].open, true);
    assert.equal(app.ids['order-action-error'].hidden, false);
    assert.match(app.ids['order-action-error'].textContent, /Could not save request/);
    assert.equal(app.ids['order-action-confirm'].disabled, false);
    assert.match(app.ids['orders-list'].innerHTML, /Refund demo order/);
});

test('an in-flight confirmation cannot submit twice or be dismissed', async () => {
    let finish;
    const app = await setup({waitForSave: new Promise(resolve => {finish = resolve;})});
    await app.action('refund');
    const submitted = app.submit();
    assert.equal(app.ids['order-action-confirm'].disabled, true);
    await app.submit();
    app.ids['order-action-close'].click();
    let prevented = false;
    app.ids['order-action-dialog'].events.cancel({preventDefault() {prevented = true;}});
    assert.equal(prevented, true);
    assert.equal(app.ids['order-action-dialog'].open, true);
    assert.equal(app.calls.filter(call => call.options?.method === 'POST').length, 1);
    finish();
    await submitted;
    assert.equal(app.ids['order-action-dialog'].open, false);
});

test('real refunds explain the merchant step before saving a request', async () => {
    const app = await setup();
    await app.action('refund', 'live-123');
    assert.equal(app.ids['order-action-title'].textContent, 'Request a refund?');
    assert.match(app.ids['order-action-description'].textContent, /submit it with the merchant/);
    assert.equal(app.ids['order-action-confirm'].textContent, 'Save request');
    assert.equal(app.calls.length, 1);
    await app.submit();
    assert.equal(app.calls.at(-1).path, '/orders/live-123/service-request');
});

test('stopping an active checkout uses the same modal and the cancellation endpoint', async () => {
    const app = await setup({liveStatus: 'running'});
    await app.action('cancel', 'live-123');
    assert.equal(app.ids['order-action-title'].textContent, 'Stop this checkout?');
    await app.submit();
    assert.equal(app.calls.at(-1).path, '/orders/live-123/cancel');
});
