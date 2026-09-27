import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cartItems, fulfillOrder, subscribeToCart, cartCount} from '../static/scripts/cart-store.mjs';

// Exercise the actual Python order normalization and browser cart store together.
// Earlier tests used short IDs or browser-shaped mocks and missed server truncation.
const root = fileURLToPath(new URL('..', import.meta.url));
const python = fileURLToPath(new URL('../.venv/bin/python', import.meta.url));
const productId = 'product-search:google-shopping:catalogid:11834299784973750224,productid:9045417074878629248,gpcid:2594221828226506045,headlineOfferDocid:10711971104529786622,rds:PC_2594221828226506045|PROD_PC_2594221828226506045,imageDocid:16864816272954520955,mid:576462512317065448,pvt:a,pvf:';
const product = {id: productId, title: 'Test sweatshirt', price_cents: 3199, quantity: 1, product_page_url: 'https://shop.example.com/sweatshirt'};
function serverOrder(kind) {
    return JSON.parse(execFileSync(python, ['-B', '-c', `
import json, sys
from commerce.demo import demo_order_input
from commerce.service import checkout_input
payload = json.load(sys.stdin)
if '${kind}' == 'demo':
    order = demo_order_input(payload, payload['id'])
else:
    item, limit, _, fingerprint = checkout_input(payload)
    order = dict(id=payload['id'], item=item, max_cost=limit, request_hash=fingerprint, status='succeeded', is_demo=False)
print(json.dumps(order))
`], {cwd: root, input: JSON.stringify({id: 'a08de4eb-ea72-4362-a42b-9284e9a805401', consent: true, maxCost: '100', shipping: 'standard', items: [product], item: product}), encoding: 'utf8'}));
}

for (const kind of ['demo', 'live']) test(`${kind} server order removes a real-length Google Shopping cart key exactly once`, () => {
    const other = {...product, id: productId + 'another-variant'};
    const storage = new Map([['projectv:cart', JSON.stringify([product, other])]]);
    globalThis.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
    globalThis.window = new EventTarget();
    const counts = [];
    const unsubscribe = subscribeToCart(items => counts.push(cartCount(items)));
    const completed = serverOrder(kind);
    assert.equal(completed.item.id, productId);
    fulfillOrder(completed);
    assert.deepEqual(cartItems(), [other]);
    assert.deepEqual(counts, [2, 1]);
    localStorage.setItem('projectv:cart', JSON.stringify([product, other]));
    fulfillOrder(completed);
    assert.deepEqual(cartItems(), [product, other]);
    unsubscribe();
});
