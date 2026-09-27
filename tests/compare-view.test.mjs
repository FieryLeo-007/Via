import test from "node:test";
import assert from "node:assert/strict";

class FakeNode {
    constructor(tagName = "") {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.className = "";
        this.textContent = "";
        this.style = { values: new Map(), setProperty: (key, value) => this.style.values.set(key, value) };
        this.classList = { add: value => {
            const classes = new Set(this.className.split(/\s+/).filter(Boolean));
            classes.add(value);
            this.className = [...classes].join(" ");
        } };
        this.listeners = new Map();
    }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
}

globalThis.Node = FakeNode;
globalThis.document = { createElement: tagName => new FakeNode(tagName) };
globalThis.window = { setTimeout };

const { renderComparison } = await import("../static/scripts/compare-view.js");

function descendants(root) {
    return [root, ...root.children.flatMap(descendants)];
}

function renderedText(root) {
    return descendants(root).map(node => node.textContent).filter(Boolean).join(" ");
}

test("shared comparison renderer shows the verdict, winner, best-for labels, pros, and cons", () => {
    const products = [
        { id: "one", title: "Atlas Travel Headphones", brand: "Atlas", price_cents: 19900, currency: "USD", rating: 4.7, rating_count: 840, free_shipping: true },
        { id: "two", title: "Nova Flight Headphones", brand: "Nova", price_cents: 14900, currency: "USD", rating: 4.4, rating_count: 120, free_shipping: false },
    ];
    const comparison = {
        source: "ai",
        winner_id: "one",
        verdict: "Atlas is the stronger overall choice for frequent travel.",
        takes: [
            { id: "one", short_name: "Atlas Travel", best_for: "Frequent flyers", pros: ["More ratings support its score"], cons: ["Higher upfront cost"] },
            { id: "two", short_name: "Nova Flight", best_for: "Budget shoppers", pros: ["Leaves more room in the budget"], cons: ["Less review history"] },
        ],
    };
    const body = new FakeNode("div");

    renderComparison({ body, products, comparison, announce() {}, onRemove() {}, onRetry() {} });

    const text = renderedText(body);
    assert.match(text, /Verdict/);
    assert.match(text, /Atlas is the stronger overall choice/);
    assert.match(text, /Our pick for you/);
    assert.match(text, /Frequent flyers/);
    assert.match(text, /Pros More ratings support its score/);
    assert.match(text, /Cons Higher upfront cost/);
    assert.equal(descendants(body).filter(node => node.className.split(/\s+/).includes("is-winner")).length > 0, true);
});

