import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrders, selectOrders, summarizeOrders, receiptText } from "../static/scripts/orders-model.mjs";

const fixtures = [
    { id: "PV-A", status: "shipped", statusLabel: "Shipped", date: "Sep 24, 2026", timestamp: 20260924, total: 0,
        items: [{ name: "Headphones", detail: "Green", price: 19.99 }, { name: "Coffee press", detail: "Black", price: 10.10 }] },
    { id: "PV-B", status: "processing", statusLabel: "Processing", date: "Sep 22, 2026", timestamp: 20260922,
        items: [{ name: "Throw blanket", detail: "Oatmeal", price: 56, quantity: 2 }, { name: "Lamp", detail: "White", price: 56 }] },
    { id: "PV-C", status: "delivered", statusLabel: "Delivered", date: "Sep 12, 2026", timestamp: 20260912,
        items: [{ name: "Camera", detail: "Graphite", price: 699 }] },
];
const orders = normalizeOrders(fixtures);

test("quantity-aware totals replace stale totals without modifying source data", () => {
    assert.equal(orders[0].total, 30.09);
    assert.equal(orders[1].total, 168);
    assert.equal(orders[1].itemCount, 3);
    assert.equal(orders[0].items[0].quantity, 1);
    assert.equal(fixtures[0].total, 0);
    assert.equal(fixtures[0].items[0].quantity, undefined);
});
test("filters combine with trimmed case-insensitive ID, status and item searches", () => {
    assert.deepEqual(selectOrders(orders, { query: " COFFEE " }).map(x => x.id), ["PV-A"]);
    assert.deepEqual(selectOrders(orders, { query: "pv-b", filter: "processing" }).map(x => x.id), ["PV-B"]);
    assert.deepEqual(selectOrders(orders, { query: "delivered" }).map(x => x.id), ["PV-C"]);
    assert.deepEqual(selectOrders(orders, { query: "camera", filter: "processing" }), []);
});
test("all three sorts are deterministic and don't reorder the source collection", () => {
    assert.deepEqual(selectOrders(orders).map(x => x.id), ["PV-A", "PV-B", "PV-C"]);
    assert.deepEqual(selectOrders(orders, { sort: "oldest" }).map(x => x.id), ["PV-C", "PV-B", "PV-A"]);
    assert.deepEqual(selectOrders(orders, { sort: "highest" }).map(x => x.id), ["PV-C", "PV-B", "PV-A"]);
    assert.deepEqual(orders.map(x => x.id), ["PV-A", "PV-B", "PV-C"]);
});
test("summary derives completed and active counts from the full history", () => {
    assert.deepEqual(summarizeOrders(orders), { spend: 897.09, active: 2, completed: 1 });
    assert.deepEqual(summarizeOrders([]), { spend: 0, active: 0, completed: 0 });
});
test("receipt includes quantities, line totals and an honest preview disclosure", () => {
    const money = value => `$${value.toFixed(2)}`;
    const text = receiptText(orders[1], money);
    assert.match(text, /2 × \$56.00 = \$112.00/);
    assert.match(text, /Total paid: \$168.00/);
    assert.match(text, /Not a tax invoice/);
});
