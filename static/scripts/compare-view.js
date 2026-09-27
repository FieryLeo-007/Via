import { compareProducts, safeProductUrl } from "./search-client.mjs";
import { addToCart } from "./cart-store.mjs";
import { trackProductEvent } from "./analytics.mjs";

export const MAX_COMPARE = 4;
const MIN_COMPARE = 2;

function formatPrice(product) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency || "USD" }).format(product.price_cents / 100);
}

function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

// Indexes of the best value in a row; empty when every product ties or has no value.
function bestIndexes(values, better) {
    var present = values.filter(function (v) { return v != null; });
    if (present.length < 2) return [];
    var best = present.reduce(function (a, b) { return better(b, a) ? b : a; });
    if (present.every(function (v) { return v === best; })) return [];
    return values.map(function (v, i) { return v === best ? i : -1; }).filter(function (i) { return i >= 0; });
}

const FACT_ROWS = [
    { label: "Price", value: function (p) { return formatPrice(p); }, score: function (p) { return p.price_cents; }, better: function (a, b) { return a < b; } },
    { label: "Rating", value: function (p) { return p.rating != null ? p.rating.toFixed(1) + " ★" : "—"; }, score: function (p) { return p.rating; }, better: function (a, b) { return a > b; } },
    { label: "Reviews", value: function (p) { return (p.rating_count || 0).toLocaleString(); }, score: function (p) { return p.rating_count || 0; }, better: function (a, b) { return a > b; } },
    { label: "Store", value: function (p) { return p.store_name || "—"; } },
    { label: "Brand", value: function (p) { return p.brand || "—"; } },
    { label: "Condition", value: function (p) { return p.condition ? p.condition.charAt(0).toUpperCase() + p.condition.slice(1) : "—"; } },
    { label: "Shipping", value: function (p) { return p.free_shipping === true ? "Free" : p.free_shipping === false ? "Paid" : "—"; } },
    { label: "On sale", value: function (p) { return p.on_sale ? "Yes" : "No"; } }
];

/**
 * Render the comparison result used by both Dashboard and Discover.
 * Selection state stays with the calling page, while the verdict, facts, winner,
 * cart action, pros/cons, loading state, and recovery UI stay identical.
 */
export function renderComparison({ body, products, comparison = null, error = null, announce, onRemove, onRetry }) {
    var takes = new Map((comparison ? comparison.takes : []).map(function (take) { return [take.id, take]; }));
    var winnerIndex = comparison ? products.findIndex(function (product) { return product.id === comparison.winner_id; }) : -1;

    function renderVerdict() {
        var box = el("section", "compare-verdict");
        box.setAttribute("aria-live", "polite");
        if (error) {
            box.classList.add("is-error");
            box.appendChild(el("p", "compare-verdict-label", "Comparison unavailable"));
            box.appendChild(el("p", "compare-verdict-text", error));
            var retry = el("button", "compare-retry", "Try again");
            retry.type = "button";
            retry.addEventListener("click", onRetry);
            box.appendChild(retry);
            return box;
        }
        if (!comparison) {
            box.classList.add("is-loading");
            box.appendChild(el("p", "compare-verdict-label", "Weighing your options…"));
            box.appendChild(el("span", "compare-skeleton compare-skeleton--wide"));
            box.appendChild(el("span", "compare-skeleton"));
            return box;
        }
        box.appendChild(el("p", "compare-verdict-label", comparison.source === "ai" ? "Verdict" : "Quick comparison"));
        box.appendChild(el("p", "compare-verdict-text", comparison.verdict));
        return box;
    }

    var wrap = el("div", "compare-table-wrap");
    var table = el("table", "compare-table");
    table.style.setProperty("--compare-cols", products.length);
    table.appendChild(el("caption", "sr-only", "Side-by-side comparison of " + products.length + " products"));
    function colClass(index) { return index === winnerIndex ? "is-winner" : ""; }

    var head = el("thead");
    var headRow = el("tr");
    headRow.appendChild(el("td"));
    products.forEach(function (product, index) {
        var th = el("th", "compare-product " + colClass(index));
        th.scope = "col";
        if (index === winnerIndex) th.appendChild(el("span", "compare-winner-badge", "Our pick for you"));
        var media = el("div", "compare-product-media");
        var monogram = function () { return el("span", "compare-product-monogram", (product.brand || product.store_name || "P").charAt(0)); };
        var imageUrl = safeProductUrl(product.image_url);
        if (imageUrl) {
            var image = el("img");
            image.src = imageUrl;
            image.alt = "";
            image.loading = "lazy";
            image.referrerPolicy = "no-referrer";
            // A blocked or broken image must not leave an empty bordered box that reads as a text field.
            image.addEventListener("error", function () { image.replaceWith(monogram()); });
            media.appendChild(image);
        } else {
            media.appendChild(monogram());
        }
        th.appendChild(media);
        var take = takes.get(product.id);
        if (take) th.appendChild(el("span", "compare-product-short", take.short_name));
        th.appendChild(el("span", "compare-product-name", product.title));
        var actions = el("div", "compare-product-actions");
        var add = el("button", "compare-add", "Add to cart");
        add.type = "button";
        add.addEventListener("click", function () {
            try { addToCart(product); } catch (cartError) {
                announce("Could not add this item. Check your browser storage and try again.");
                return;
            }
            announce(product.title + " added to cart.");
            add.textContent = "Added ✓";
            window.setTimeout(function () { add.textContent = "Add to cart"; }, 1400);
        });
        var remove = el("button", "compare-remove", "Remove");
        remove.type = "button";
        remove.disabled = products.length <= MIN_COMPARE;
        remove.setAttribute("aria-label", "Remove " + product.title + " from comparison");
        remove.addEventListener("click", function () { onRemove(product); });
        actions.append(add, remove);
        th.appendChild(actions);
        headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var tbody = el("tbody");
    function addRow(label, cells, className) {
        var tr = el("tr", className || "");
        var th = el("th", "compare-row-label", label);
        th.scope = "row";
        tr.appendChild(th);
        cells.forEach(function (cell, index) {
            var td = el("td", colClass(index));
            if (cell instanceof Node) td.appendChild(cell); else td.textContent = cell;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    }
    function aiCell(build) {
        return products.map(function (product) {
            if (!comparison) return error ? el("span", "compare-empty", "—") : el("span", "compare-skeleton");
            var take = takes.get(product.id);
            return take ? build(take) : el("span", "compare-empty", "—");
        });
    }
    function pointList(points, kind) {
        if (!points.length) return el("span", "compare-empty", "—");
        var list = el("ul", "compare-points compare-points--" + kind);
        points.forEach(function (point) { list.appendChild(el("li", null, point)); });
        return list;
    }

    addRow("Best for", aiCell(function (take) { return el("span", "compare-best-for", take.best_for); }), "compare-row-ai");
    FACT_ROWS.forEach(function (row) {
        var best = row.score ? bestIndexes(products.map(row.score), row.better) : [];
        addRow(row.label, products.map(function (product, index) {
            return el("span", best.includes(index) ? "compare-best-value" : null, row.value(product));
        }));
    });
    addRow("Pros", aiCell(function (take) { return pointList(take.pros, "pros"); }), "compare-row-ai");
    addRow("Cons", aiCell(function (take) { return pointList(take.cons, "cons"); }), "compare-row-ai");
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.replaceChildren(renderVerdict(), wrap);
}

/**
 * Selection (2–4 products from one search turn), the Compare bar above that turn's
 * results, and the compare dialog. getContext(panel) returns { intent, utterance,
 * history } for that turn so the AI weighs the products against what was asked.
 */
export function createCompareView({ announce, getContext }) {
    var dialog = document.getElementById("compare-dialog");
    var body = document.getElementById("compare-body");
    var selection = { panel: null, products: new Map() };
    var request = null;
    var version = 0;
    var syncQueued = false;

    function buildBar() {
        var bar = el("div", "compare-bar");
        bar.setAttribute("role", "group");
        bar.setAttribute("aria-label", "Compare products");
        var hint = el("span", "compare-bar-hint");
        hint.setAttribute("aria-live", "polite");
        var clearBtn = el("button", "compare-bar-clear", "Clear");
        clearBtn.type = "button";
        clearBtn.addEventListener("click", function () { clear(); announce("Selection cleared."); });
        var openBtn = el("button", "compare-bar-open", "Compare");
        openBtn.type = "button";
        openBtn.addEventListener("click", open);
        bar.append(hint, clearBtn, openBtn);
        return bar;
    }

    function syncBar(panel) {
        var hasCards = !!panel.querySelector(".product-card-select input");
        var bar = panel.querySelector(".compare-bar");
        if (!hasCards) { if (bar) bar.remove(); return; }
        if (!bar) { bar = buildBar(); panel.insertBefore(bar, panel.querySelector(".results-grid")); }
        var count = selection.panel === panel ? selection.products.size : 0;
        bar.classList.toggle("is-active", count > 0);
        bar.querySelector(".compare-bar-hint").textContent = count === 0
            ? "Select 2–" + MAX_COMPARE + " products to compare"
            : count < MIN_COMPARE
                ? "1 selected · select at least one more"
                : count + " selected" + (count === MAX_COMPARE ? " (max)" : "");
        bar.querySelector(".compare-bar-clear").hidden = count === 0;
        var openBtn = bar.querySelector(".compare-bar-open");
        openBtn.disabled = count < MIN_COMPARE;
        openBtn.textContent = count >= MIN_COMPARE ? "Compare " + count : "Compare";
    }

    function sync() {
        var panels = new Set();
        document.querySelectorAll(".product-card-select input").forEach(function (input) {
            var panel = input.closest(".workspace-panel");
            if (!panel) return;
            panels.add(panel);
            var inSelection = selection.panel === panel;
            var on = inSelection && selection.products.has(input.dataset.productId);
            input.checked = on;
            // At the limit, unselected cards in the active search can't be added.
            input.disabled = !on && inSelection && selection.products.size >= MAX_COMPARE;
            input.closest(".product-card").classList.toggle("is-compare-selected", on);
        });
        document.querySelectorAll(".workspace-panel").forEach(function (panel) {
            if (panels.has(panel) || panel.querySelector(".compare-bar")) syncBar(panel);
        });
    }

    function scheduleSync() {
        if (syncQueued) return;
        syncQueued = true;
        window.requestAnimationFrame(function () { syncQueued = false; sync(); });
    }

    function toggle(product, panel, checked) {
        if (selection.panel !== panel) selection = { panel: panel, products: new Map() };
        if (!checked) {
            selection.products.delete(product.id);
            if (!selection.products.size) selection.panel = null;
        } else if (selection.products.size >= MAX_COMPARE) {
            announce("You can compare up to " + MAX_COMPARE + " products.");
        } else {
            selection.products.set(product.id, product);
        }
        sync();
    }

    function clear() {
        selection = { panel: null, products: new Map() };
        if (dialog.open) dialog.close();
        scheduleSync();
    }

    function buildSelectControl(product, card) {
        var label = el("label", "product-card-select");
        label.title = "Select to compare";
        var input = el("input");
        input.type = "checkbox";
        input.dataset.productId = product.id;
        input.setAttribute("aria-label", "Select " + product.title + " to compare");
        var box = el("span", "product-card-select-box");
        box.setAttribute("aria-hidden", "true");
        box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
        label.append(input, box);
        label.addEventListener("click", function (event) { event.stopPropagation(); });
        input.addEventListener("change", function () {
            toggle(product, card.closest(".workspace-panel"), input.checked);
        });
        // Cards are re-rendered when Top picks land; sync new controls once per frame.
        scheduleSync();
        return label;
    }

    /* ---------- Dialog ---------- */

    function render(products, comparison, error) {
        renderComparison({
            body: body,
            products: products,
            comparison: comparison,
            error: error,
            announce: announce,
            onRetry: run,
            onRemove: function (product) {
                selection.products.delete(product.id);
                sync();
                run();
            }
        });
    }

    async function run() {
        var products = Array.from(selection.products.values());
        if (products.length < MIN_COMPARE) { dialog.close(); return; }
        if (request) request.abort();
        request = new AbortController();
        var current = ++version;
        render(products, null);
        var context = getContext(selection.panel) || {};
        try {
            var comparison = await compareProducts(products, {
                intent: context.intent || null,
                utterance: context.utterance || null,
                history: context.history || [],
                signal: request.signal
            });
            if (current !== version) return;
            render(products, comparison);
            var winner = comparison.takes.find(function (take) { return take.id === comparison.winner_id; });
            announce("Comparison ready." + (winner ? " Our pick: " + winner.short_name + "." : ""));
        } catch (error) {
            if (current !== version || error.name === "AbortError") return;
            render(products, null, error.message || "Please try again.");
        }
    }

    function open() {
        if (selection.products.size < MIN_COMPARE) return;
        selection.products.forEach(function (product) { void trackProductEvent(product, "compare"); });
        dialog.showModal();
        run();
    }

    document.getElementById("compare-close").addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", function () {
        version++;
        if (request) { request.abort(); request = null; }
    });
    return { buildSelectControl: buildSelectControl, clear: clear };
}
