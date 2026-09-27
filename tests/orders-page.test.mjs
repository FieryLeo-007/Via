import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {money, statusLabel, TERMINAL, safeUrl} from '../static/scripts/commerce-client.mjs';

// Exercise the merged Orders controller with a small DOM and an isolated API.
async function setup() {
    function element() {
        const el = {value: '', textContent: '', innerHTML: '', hidden: true, dataset: {}, events: {},
            classList: {toggle() {}}, setAttribute() {}, focus() {},
            addEventListener(name, fn) {this.events[name] = fn;},
            querySelectorAll() {return [];}, querySelector() {return this.counter;},
            click() {return this.events.click?.();}};
        el.counter = {textContent: ''};
        return el;
    }
    const ids = Object.fromEntries(['orders-list', 'orders-empty', 'order-search', 'order-sort', 'orders-notice', 'receipt-notice', 'order-count', 'clear-filters', 'dismiss-notice'].map(id => [id, element()]));
    ids['order-sort'].value = 'newest';
    const metrics = Object.fromEntries(['spend', 'active', 'completed'].map(key => [key, element()]));
    const chips = ['all', 'active', 'succeeded', 'demo', 'refunded', 'cancelled'].map(filter => Object.assign(element(), {dataset: {filter}}));
    const row = (id, is_demo) => ({id, is_demo, status: 'succeeded', created_at: '2026-09-27T12:00:00Z',
        item: {title: is_demo ? 'Demo headphones' : 'Live item', quantity: 1, store_name: 'Example', product_page_url: 'https://example.com/item'},
        result: {items: [], shipping: 'standard', shipping_cents: 0, tax_cents: 800,
            purchase: {receipt: {merchantOrderId: id, total: {amount: '108.00', currency: 'USD'}}}}});
    let rows = [row('demo-123', true), row('live-123', false)];
    const calls = [];
    const api = async (path, options) => {
        calls.push({path, options});
        if (path === '/orders') return {orders: structuredClone(rows)};
        assert.equal(path, '/orders/demo-123/service-request');
        const order = {...rows[0], status: options.body.kind === 'refund' ? 'refunded' : 'cancelled',
            service_request: {kind: options.body.kind, amount: '108.00', completed_at: '2026-09-27T12:01:00Z'}};
        rows[0] = order;
        return {order, message: 'Demo action saved. No real money moves.'};
    };
    const document = {getElementById: id => ids[id], querySelectorAll: () => chips,
        querySelector: selector => selector.startsWith('[data-metric=') ? metrics[selector.match(/"(.*?)"/)[1]] : chips[0]};
    const source = readFileSync(new URL('../static/scripts/orders.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
    vm.runInNewContext(source, {document, window: {location: {search: '?order=demo-123'}, addEventListener() {}},
        api, accountReady: async () => ({}), money, statusLabel, TERMINAL, safeUrl, URLSearchParams,
        setTimeout() {}, clearTimeout() {}, confirm: () => true});
    await new Promise(resolve => setImmediate(resolve));
    const action = async kind => ids['orders-list'].events.click({target: {closest: () => ({dataset: {action: kind}, closest: () => ({dataset: {id: 'demo-123'}})})}});
    return {ids, metrics, chips, calls, action};
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
        const {ids, calls, action: perform} = await setup();
        await perform(action);
        assert.equal(calls.at(-1).options.method, 'POST');
        assert.equal(calls.at(-1).options.body.kind, action);
        assert.match(ids['orders-list'].innerHTML, new RegExp(label));
        assert.doesNotMatch(ids['orders-list'].innerHTML, /Cancel demo order|Refund demo order/);
        assert.equal(ids['receipt-notice'].textContent, 'Demo action saved. No real money moves.');
    });
}
