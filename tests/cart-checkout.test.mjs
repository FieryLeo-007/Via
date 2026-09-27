import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {cartItems, cartCount, fulfillDemoOrder, subscribeToCart} from '../static/scripts/cart-store.mjs';

let storage, events;
beforeEach(() => {
    storage = new Map();
    events = [];
    globalThis.localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    };
    globalThis.window = new EventTarget();
    window.addEventListener('projectv:cart-updated', event => events.push(event.detail));
});

const product = (id, quantity = 1) => ({id, title: id, quantity, price_cents: 1000});
const seed = items => localStorage.setItem('projectv:cart', JSON.stringify(items));
const order = (items, id = 'demo-order') => ({id, is_demo: true, status: 'succeeded', result: {items}});

test('successful checkout removes the selected product and immediately updates the cart badge', () => {
    seed([product('checked-out'), product('keep', 2)]);
    const counts = [];
    const unsubscribe = subscribeToCart(items => counts.push(cartCount(items)));
    fulfillDemoOrder(order([product('checked-out')]));
    assert.deepEqual(cartItems(), [product('keep', 2)]);
    assert.deepEqual(counts, [3, 2]);
    assert.equal(events.length, 1);
    unsubscribe();
});

test('a whole-cart demo empties the cart', () => {
    const items = [product('one', 2), product('two')];
    seed(items);
    fulfillDemoOrder(order(items));
    assert.deepEqual(cartItems(), []);
    assert.equal(cartCount(), 0);
});

test('only checked-out quantities are removed; new additions survive', () => {
    seed([product('one', 5), product('two', 2), product('added-later')]);
    fulfillDemoOrder(order([product('one', 2), product('two', 3)]));
    assert.deepEqual(cartItems(), [product('one', 3), product('added-later')]);
});

test('retrying or reopening the same order never removes newly added products', async () => {
    const completed = order([product('one', 2)]);
    seed([product('one', 3)]);
    fulfillDemoOrder(completed);
    assert.equal(cartItems()[0].quantity, 1);
    seed([product('one', 4)]);
    // A fresh module instance simulates a page reload; the marker must persist.
    const reopened = await import('../static/scripts/cart-store.mjs?reopened');
    reopened.fulfillDemoOrder(completed);
    assert.equal(cartItems()[0].quantity, 4);
    assert.equal(events.length, 1);
});

test('incomplete, cancelled, refunded and live orders leave the cart alone', () => {
    const items = [product('one')];
    seed(items);
    for (const status of ['running', 'failed', 'cancelled', 'refunded']) {
        fulfillDemoOrder({...order(items), status});
    }
    fulfillDemoOrder({...order(items), is_demo: false});
    fulfillDemoOrder(null);
    assert.deepEqual(cartItems(), items);
    assert.equal(events.length, 0);
});

test('storage failure does not mark the order fulfilled, so the cart update can retry', () => {
    const items = [product('one')];
    seed(items);
    const write = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('Storage unavailable'); };
    assert.throws(() => fulfillDemoOrder(order(items)), /Storage unavailable/);
    assert.deepEqual(cartItems(), items);
    assert.equal(storage.has('projectv:cart-fulfilled:demo-order'), false);
    localStorage.setItem = write;
    fulfillDemoOrder(order(items));
    assert.deepEqual(cartItems(), []);
});
