import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createVoiceTools, resolveRef, shortName, dollars, TOOL_NAMES } from "../static/scripts/voice-mode/tools.mjs";

const definitions = JSON.parse(readFileSync(new URL("../voice/agent/tools.json", import.meta.url), "utf8"));

function product(n, extra = {}) {
    return { id: `amazon:${n}`, source: "amazon", source_id: String(n), title: `Brand${n} Trail Runner ${n} - Men's Running Shoe, Breathable`,
        brand: `Brand${n}`, store_name: "Amazon", price_cents: 8999 + n * 1000, currency: "USD", rating: 4.5, rating_count: 120 * n,
        product_page_url: `https://shop.example.com/p/${n}`, score: 1 - n / 10, breakdown: {}, reasons: [`Reason ${n}`],
        analytics_chat_turn_id: "local-only", ...extra };
}

function setup({ results = [1, 2, 3, 4, 5, 6].map(n => product(n)), picks, apiImpl } = {}) {
    const calls = [], ui = [], notes = [], turns = [];
    let cart = [], ids = 0, clock = 1000;
    const deps = {
        postJson: async (path, body) => {
            calls.push({ path, body });
            if (path === "/api/search") return { results, sources: [], partial: false, picks_source: "none" };
            if (path === "/api/picks") return picks ? await picks(body) : new Promise(() => {});
            throw new Error("unexpected " + path);
        },
        compareProducts: async (products, options) => {
            calls.push({ path: "compare", products, options });
            return { winner_id: products[1].id, verdict: "Second is lighter.", takes: products.map(p => ({ id: p.id, short_name: p.brand, best_for: "runs", pros: ["a", "b", "c"], cons: ["d"] })), source: "rules" };
        },
        cart: {
            fulfillDemoOrder: order => calls.push({ path: "cart-fulfill", order }),
            items: () => cart.map(item => ({ ...item })),
            add: p => { const line = cart.find(i => i.id === p.id); if (line) line.quantity += 1; else cart.push({ ...p, quantity: 1 }); },
            setQuantity: (id, q) => { cart = cart.map(i => i.id === id ? { ...i, quantity: q } : i).filter(i => i.quantity > 0); }
        },
        setSaved: async (p, saved) => calls.push({ path: "saved", id: p.id, saved }),
        api: async (path, options = {}) => {
            calls.push({ path, options });
            if (apiImpl) return apiImpl(path, options);
            if (path === "/demo-orders") return { order: { id: options.body.id, status: "succeeded", is_demo: true, result: { purchase: { receipt: { merchantOrderId: "DEMO-1", total: { amount: options.body.maxCost } } } } } };
            throw new Error("unexpected api " + path);
        },
        ui: new Proxy({}, { get: (_, name) => (...args) => { ui.push([name, ...args]); if (name === "confirmRealCheckout") return deps.confirm?.(...args); } }),
        notify: text => notes.push(text),
        onTurn: record => turns.push(record),
        uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
        now: () => clock
    };
    const tools = createVoiceTools(deps);
    return { tools, run: tools.clientTools, calls, ui, notes, turns, deps, get cart() { return cart; }, set cart(value) { cart = value; }, tick(ms) { clock += ms; } };
}

test("every agent tool definition has a browser handler and vice versa", () => {
    const names = definitions.map(tool => tool.name).sort();
    assert.deepEqual(names, [...TOOL_NAMES].sort());
    assert.deepEqual(Object.keys(setup().run).sort(), names);
});

test("references resolve by number, spoken ordinal, or product name", () => {
    const list = ["Sony WH-1000XM5 Headphones", "Bose QuietComfort Ultra", "Apple AirPods Max"];
    const name = x => x;
    assert.equal(resolveRef("2", list, name), 1);
    assert.equal(resolveRef("#3", list, name), 2);
    assert.equal(resolveRef("number one", list, name), 0);
    assert.equal(resolveRef("the second one", list, name), 1);
    assert.equal(resolveRef("last", list, name), 2);
    assert.equal(resolveRef("the bose", list, name), 1);
    assert.equal(resolveRef("airpods max", list, name), 2);
    assert.equal(resolveRef("9", list, name), null);
    assert.equal(resolveRef("samsung", list, name), null);
    assert.equal(shortName("Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black, 30 Hour Battery"), "Sony WH-1000XM5 Wireless Noise Canceling Headphones");
    assert.equal(dollars(8999), "$89.99"); assert.equal(dollars(12000), "$120");
});

test("search builds a strict ShoppingIntent directly, speaks five results and records the turn", async () => {
    const app = setup();
    const result = await app.run.search_products({ query: " trail running shoes ", max_price: 120, brands: ["Brooks"], must_have: ["waterproof", "wide", "light", "grippy", "cushioned", "extra"], sort: "rating", condition: "bogus", min_rating: 9 });
    const search = app.calls.find(c => c.path === "/api/search").body;
    assert.deepEqual(search.intent, { query: "trail running shoes", category: null, min_price_cents: null, max_price_cents: 12000,
        must_have: ["waterproof", "wide", "light", "grippy", "cushioned"], exclude_terms: [], brands_include: ["Brooks"], brands_exclude: [],
        min_rating: 5, condition: null, sort_hint: "rating", quantity: 1 });
    assert.equal(search.picks, false);
    assert.equal(search.utterance, "trail running shoes from Brooks with waterproof, wide, light, grippy, cushioned under $120");
    assert.equal(result.ok, true); assert.equal(result.shown_on_screen, 6); assert.equal(result.results.length, 5);
    assert.deepEqual(result.results[0], { n: 1, name: "Brand1 Trail Runner 1", brand: "Brand1", price: "$99.99", store: "Amazon", rating: 4.5, reviews: 120, why: "Reason 1" });
    assert.match(result.note, /untrusted|data/i);
    assert.equal(app.turns.length, 1); assert.equal(app.turns[0].status, "complete");
    assert.ok(app.ui.some(([name]) => name === "showProducts"));
});

test("background picks add badges without renumbering and brief the agent", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const app = setup({ picks: async body => {
        assert.ok(body.result.results.every(p => !("analytics_chat_turn_id" in p)), "browser-only fields are stripped");
        await gate;
        return { results: body.result.results.map((p, i) => i === 2 ? { ...p, top_pick_rank: 1, pick_reason: "Best grip" } : p) };
    } });
    await app.run.search_products({ query: "shoes" });
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(app.tools.state.results[2].top_pick_rank, 1);
    assert.equal(app.tools.state.results[0].id, "amazon:1", "numbering stays stable");
    assert.match(app.notes[0], /#3 .*Best grip/);
    assert.ok(app.ui.some(([name]) => name === "updatePicks"));
});

test("stale picks from an older search are ignored", async () => {
    let first = true, release;
    const gate = new Promise(resolve => { release = resolve; });
    const app = setup({ picks: async body => { if (first) { first = false; await gate; } return { results: body.result.results.map(p => ({ ...p, top_pick_rank: 1 })) }; } });
    await app.run.search_products({ query: "shoes" });
    await app.run.search_products({ query: "boots" });
    await new Promise(resolve => setTimeout(resolve, 0));
    const notesAfterSecond = app.notes.length;
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(app.notes.length, notesAfterSecond, "the older picks never reach the agent");
});

test("tool errors come back as speakable results instead of throwing", async () => {
    const app = setup();
    assert.deepEqual(await app.run.add_to_cart({ item: "1" }), { ok: false, error: "There are no products on screen yet. Search first." });
    assert.equal((await app.run.search_products({ query: "" })).ok, false);
    await app.run.search_products({ query: "shoes" });
    assert.match((await app.run.get_product_details({ item: "42" })).error, /1 to 6/);
    assert.match((await app.run.compare_products({ items: ["1"] })).error, /two to four/);
});

test("cart tools add quantities, update, remove and summarise", async () => {
    const app = setup();
    await app.run.search_products({ query: "shoes" });
    const added = await app.run.add_to_cart({ item: "second", quantity: 3 });
    assert.deepEqual(added, { ok: true, added: "Brand2 Trail Runner 2", quantity_in_cart: 3, cart_count: 3, cart_subtotal: "$329.97" });
    await app.run.add_to_cart({ item: "Brand4" });
    assert.equal((await app.run.update_cart_item({ item: "Brand4", quantity: 0 })).removed, "Brand4 Trail Runner 4");
    const cart = await app.run.view_cart();
    assert.deepEqual(cart.items, [{ n: 1, name: "Brand2 Trail Runner 2", quantity: 3, price: "$109.99" }]);
    assert.match((await app.run.update_cart_item({ item: "1", quantity: 99 })).error, /between 0 and 20/);
});

test("compare maps the winner back to on-screen numbers", async () => {
    const app = setup();
    await app.run.search_products({ query: "shoes" });
    const result = await app.run.compare_products({ items: ["1", "3", "3"] });
    assert.equal(result.winner, 3); assert.equal(result.takes.length, 2);
    assert.deepEqual(result.takes[0].pros, ["a", "b"]);
    const compare = app.calls.find(c => c.path === "compare");
    assert.equal(compare.options.utterance, "shoes");
});

test("demo checkout needs a current quote, refuses a changed cart, and never double-places", async () => {
    const app = setup();
    assert.match((await app.run.get_checkout_quote({ shipping: "standard" })).error, /empty/);
    await app.run.search_products({ query: "shoes" });
    await app.run.add_to_cart({ item: "1" });
    assert.match((await app.run.place_demo_order({ quote_id: "QNOPE" })).error, /isn't current/);
    const quote = await app.run.get_checkout_quote({ shipping: "express" });
    assert.equal(quote.total, "$120.94"); assert.equal(quote.shipping, "$12.95 express");
    await app.run.add_to_cart({ item: "2" });
    assert.match((await app.run.place_demo_order({ quote_id: quote.quote_id })).error, /cart changed/);
    const fresh = await app.run.get_checkout_quote({ shipping: "standard" });
    const placed = await app.run.place_demo_order({ quote_id: fresh.quote_id.toLowerCase() });
    assert.equal(placed.ok, true); assert.equal(placed.demo, true); assert.equal(placed.total, "$226.78");
    assert.ok(!JSON.stringify(placed).includes("DEMO-1"), "order codes stay on screen, not in speech");
    const request = app.calls.find(c => c.path === "/demo-orders").options;
    assert.equal(request.method, "POST");
    assert.equal(request.body.consent, true); assert.equal(request.body.maxCost, "226.78");
    assert.deepEqual(Object.keys(request.body.items[0]).sort(), ["id", "image_url", "price_cents", "quantity", "store_name", "title"]);
    assert.deepEqual(await app.run.place_demo_order({ quote_id: fresh.quote_id }), placed);
    assert.equal(app.calls.filter(c => c.path === "/demo-orders").length, 1);
    const fulfilled = app.calls.filter(c => c.path === "cart-fulfill");
    assert.equal(fulfilled.length, 1);
    assert.equal(fulfilled[0].order.id, request.body.id);
});

test("failed demo order saves do not fulfill the voice cart", async () => {
    const app = setup({ apiImpl: async () => { throw new Error("Save unavailable"); } });
    await app.run.search_products({ query: "shoes" });
    await app.run.add_to_cart({ item: "1" });
    const quote = await app.run.get_checkout_quote({ shipping: "standard" });
    assert.match((await app.run.place_demo_order({ quote_id: quote.quote_id })).error, /Save unavailable/);
    assert.equal(app.cart.length, 1);
    assert.equal(app.calls.filter(c => c.path === "cart-fulfill").length, 0);
});

test("an expired quote must be refreshed", async () => {
    const app = setup();
    await app.run.search_products({ query: "shoes" });
    await app.run.add_to_cart({ item: "1" });
    const quote = await app.run.get_checkout_quote({ shipping: "standard" });
    app.tick(16 * 60 * 1000);
    assert.match((await app.run.place_demo_order({ quote_id: quote.quote_id })).error, /expired/);
});

test("real checkout waits for an on-screen confirmation before starting", async () => {
    const created = [];
    const app = setup({ apiImpl: (path, options) => {
        if (path === "/config") return { ready: true };
        if (path === "/orders") { created.push(options.body); return { order: { id: options.body.id, status: "running" } }; }
        throw new Error(path);
    } });
    await app.run.search_products({ query: "shoes" });
    await app.run.add_to_cart({ item: "1" });
    app.deps.confirm = async () => false;
    assert.match((await app.run.start_real_checkout({ item: "1", max_cost: 130 })).error, /did not tap Confirm/);
    assert.equal(created.length, 0);
    let confirmation;
    app.deps.confirm = details => { confirmation = details; return Promise.resolve(true); };
    const started = await app.run.start_real_checkout({ item: "Brand1", max_cost: 130 });
    assert.equal(started.ok, true); assert.equal(started.spending_cap, "$130.00");
    assert.equal(confirmation.maxCost, "130.00");
    assert.equal(created[0].consent, true); assert.equal(created[0].item.id, "amazon:1");
    assert.match((await app.run.start_real_checkout({ item: "1", max_cost: 0 })).error, /spending cap/);
});

test("real checkout reports missing setup instead of asking for confirmation", async () => {
    const app = setup({ apiImpl: path => path === "/config" ? { ready: false, missing: ["Crossmint server key"] } : null });
    await app.run.search_products({ query: "shoes" });
    await app.run.add_to_cart({ item: "1" });
    const result = await app.run.start_real_checkout({ item: "1", max_cost: 100 });
    assert.equal(result.ok, false); assert.match(result.say, /demo/);
    assert.ok(!app.ui.some(([name]) => name === "confirmRealCheckout"));
});

test("orders are listed newest first, filtered, tracked and cancelled only when confirmed", async () => {
    const rows = [
        { id: "a", status: "succeeded", is_demo: true, created_at: "2026-09-20T10:00:00Z", item: { title: "Old Kettle" }, max_cost: "40.00", result: { purchase: { receipt: { total: { amount: "38.10" } } } } },
        { id: "b", status: "awaiting_input", is_demo: false, created_at: "2026-09-26T10:00:00Z", item: { title: "Sony WH-1000XM5 Headphones" }, max_cost: "400.00" }
    ];
    const app = setup({ apiImpl: (path, options) => {
        if (path === "/orders") return { orders: rows };
        if (path === "/orders/b") return { order: rows[1] };
        if (path === "/orders/a/cancel") return { order: { ...rows[0], status: "cancelled" }, message: "Demo order cancelled." };
        throw new Error(path);
    } });
    const listed = await app.run.list_orders({});
    assert.deepEqual(listed.orders.map(o => o.name), ["Sony WH-1000XM5 Headphones", "Old Kettle"]);
    assert.equal(listed.orders[0].needs_action, "Open the checkout page to answer the checkout agent.");
    assert.equal(listed.orders[1].total, "$38.10"); assert.equal(listed.orders[0].spending_cap, "$400.00");
    assert.equal((await app.run.list_orders({ filter: "active" })).count, 1);
    assert.equal((await app.run.get_order_status({ order: "latest" })).order.status, "Needs your attention");
    await app.run.list_orders({ filter: "all" });
    assert.equal((await app.run.cancel_order({ order: "kettle", confirmed: false })).ok, false);
    assert.ok(!app.calls.some(c => c.path.endsWith("/cancel")));
    const cancelled = await app.run.cancel_order({ order: "kettle", confirmed: true });
    assert.equal(cancelled.status, "Checkout cancelled"); assert.equal(cancelled.message, "Demo order cancelled.");
});

test("open_page only allows known pages", async () => {
    const app = setup();
    assert.equal((await app.run.open_page({ page: "orders" })).ok, true);
    assert.deepEqual(app.ui.find(([name]) => name === "openPage"), ["openPage", "/orders"]);
    assert.equal((await app.run.open_page({ page: "https://evil.example" })).ok, false);
});

test("a tap on a card adds it and tells the agent", async () => {
    const app = setup();
    await app.run.search_products({ query: "shoes" });
    await app.tools.tapAdd(1);
    assert.equal(app.cart[0].id, "amazon:2");
    assert.match(app.notes.at(-1), /tapped Add on item #2/);
});
