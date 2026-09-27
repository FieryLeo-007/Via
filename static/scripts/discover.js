import { account, listSaved, setSaved, productKey } from "./account-store.mjs";
import { trackProductEvent, observeProductImpression } from "./analytics.mjs";
import { addToCart } from "./cart-store.mjs";
import { safeProductUrl, retailerProductUrl } from "./search-client.mjs";
import "./cart-nav.js";

import "./site-interactions.js";
const container = document.getElementById("discover-sections");
const refresh = document.getElementById("discover-refresh");
const filters = document.getElementById("discover-filters");
const notice = document.getElementById("discover-notice");
const dialog = document.getElementById("discover-compare-dialog");
const saved = new Set(), compared = new Map(), hidden = new Set();
let feed, inFlight, cleanups = [], toastTimer;

function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
}
function button(label, className, action) {
    const element = node("button", className, label);
    element.type = "button"; element.addEventListener("click", action); return element;
}
function announce(message) {
    const toast = document.getElementById("discover-toast");
    toast.textContent = message; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
    document.getElementById("live-status").textContent = message;
}
function price(product) {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency || "USD" }).format(product.price_cents / 100); }
    catch { return "Price unavailable"; }
}
function message(text) { notice.textContent = text; notice.hidden = !text; }
function clearObservers() { cleanups.forEach(cleanup => cleanup()); cleanups = []; }

function compareState() {
    const count = compared.size;
    document.getElementById("discover-compare-bar").hidden = !count;
    document.getElementById("discover-compare-count").textContent = `${count} of 3 products selected`;
    document.getElementById("discover-compare-open").disabled = count < 2;
    container.querySelectorAll("[data-compare-key]").forEach(el => {
        const selected = compared.has(el.dataset.compareKey);
        el.setAttribute("aria-pressed", String(selected)); el.textContent = selected ? "Selected" : "Compare";
    });
}

function productCard(product) {
    const key = productKey(product), card = node("article", "product-card");
    card.dataset.productKey = key;
    const media = node("div", "product-card-media"); media.style.setProperty("--accent", "#0B6B3A");
    media.append(node("span", "product-card-monogram", (product.brand || product.store_name || "P").charAt(0)));
    const imageURL = safeProductUrl(product.image_url);
    if (imageURL) {
        const image = node("img", "product-card-image");
        image.src = imageURL; image.alt = product.title; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => image.remove(), { once: true }); media.append(image);
    }
    const body = node("div", "product-card-body");
    body.append(node("p", "product-card-brand", product.store_name || product.brand || "Online store"), node("h3", "product-card-name", product.title));
    const footer = node("div", "product-card-footer");
    const save = button(saved.has(key) ? "Saved" : "Save", "product-card-save discover-save", async () => {
        if (save.disabled) return;
        save.disabled = true; const next = !saved.has(key);
        try {
            await setSaved(product, next); next ? saved.add(key) : saved.delete(key);
            if (next) void trackProductEvent(product, "save");
            save.textContent = next ? "Saved" : "Save"; save.setAttribute("aria-pressed", String(next)); save.classList.toggle("is-saved", next);
            announce(next ? "Product saved." : "Product removed from Saved.");
        } catch { announce("Couldn't save this change. Please try again."); }
        finally { save.disabled = false; }
    });
    save.setAttribute("aria-label", `Save ${product.title}`); save.setAttribute("aria-pressed", String(saved.has(key))); save.classList.toggle("is-saved", saved.has(key));
    footer.append(node("span", "product-card-price", price(product)), save); body.append(footer);
    if (Number.isFinite(product.rating)) body.append(node("p", "product-card-details", `${product.rating.toFixed(1)} ★ · ${product.rating_count || 0} reviews`));
    const url = retailerProductUrl(product.merchant_url) || retailerProductUrl(product.product_page_url);
    const actions = node("div", "product-card-actions");
    const add = button("Add to cart", "product-card-add", () => {
        try {
            addToCart(product); add.textContent = "Added ✓"; add.disabled = true;
            setTimeout(() => { add.textContent = "Add to cart"; add.disabled = false; }, 1000); announce("Added to your cart.");
        } catch { announce("Your browser couldn't save the cart. Check storage and try again."); }
    });
    const buy = button("Buy now", "product-card-buy", () => {
        if (!url) return; void trackProductEvent(product, "click"); window.open(url, "_blank", "noopener,noreferrer");
    });
    buy.disabled = !url; buy.title = url ? "Continue checkout at the retailer" : "Retailer link unavailable";
    actions.append(add, buy); body.append(actions);
    if (url) {
        const view = node("a", "product-card-link", "View at retailer ↗");
        view.href = url; view.target = "_blank"; view.rel = "noopener noreferrer";
        view.addEventListener("click", () => { void trackProductEvent(product, "view"); void trackProductEvent(product, "click"); }); body.append(view);
    }
    const secondary = node("div", "discover-card-tools");
    const compare = button("Compare", "discover-quiet-button", () => {
        if (compared.has(key)) compared.delete(key);
        else {
            if (compared.size >= 3) { announce("Compare up to three products. Remove one first."); return; }
            compared.set(key, product); void trackProductEvent(product, "compare");
        }
        compareState();
    });
    compare.dataset.compareKey = key;
    const hide = kind => async () => {
        hidden.add(key); compared.delete(key); card.remove(); compareState();
        announce(kind === "hide" ? "Product hidden." : "We'll show fewer products like this.");
        const event = await trackProductEvent(product, kind);
        if (!event) announce("Hidden for this visit, but feedback couldn't sync. Please try again later.");
    };
    secondary.append(compare, button("Not for me", "discover-quiet-button", hide("dislike")), button("Hide", "discover-quiet-button", hide("hide")));
    body.append(secondary); card.append(media, body); cleanups.push(observeProductImpression(card, product)); return card;
}

function skeletons() {
    clearObservers(); container.replaceChildren();
    for (let i = 0; i < 4; i++) {
        const section = node("section", "discover-section"); section.setAttribute("aria-hidden", "true");
        section.append(node("div", "skeleton discover-skeleton-heading")); const grid = node("div", "results-grid discover-product-grid");
        for (let j = 0; j < 3; j++) grid.append(node("div", "skeleton discover-skeleton-card"));
        section.append(grid); container.append(section);
    }
}
function render(filter = "") {
    clearObservers(); container.replaceChildren();
    for (const section of feed.sections.filter(s => !filter || s.category === filter)) {
        const wrapper = node("section", "discover-section"), heading = node("div", "discover-heading-row"), copy = node("div");
        copy.append(node("p", "", section.exploration ? "A little unexpected" : "Selected for you"));
        const title = node("h2", "", section.title); title.id = `${section.id}-title`; copy.append(title); wrapper.setAttribute("aria-labelledby", title.id);
        const explore = node("a", "", "Explore more ↗"); explore.href = `/dashboard?query=${encodeURIComponent(section.search_query)}`;
        heading.append(copy, explore); wrapper.append(heading);
        const products = section.products.filter(p => !hidden.has(productKey(p)));
        if (products.length) {
            const grid = node("div", "results-grid discover-product-grid"); products.forEach(p => grid.append(productCard(p))); wrapper.append(grid);
        } else {
            const empty = node("div", "discover-empty");
            empty.append(node("p", "", section.status === "error" ? "This collection couldn't load. Other discoveries are still available." : "No new matches here right now. Try exploring a broader search."));
            if (section.status === "error") empty.append(button("Retry discoveries", "discover-button", () => load(true))); wrapper.append(empty);
        }
        container.append(wrapper);
    }
    compareState();
}
function renderFilters() {
    filters.replaceChildren();
    for (const category of ["", ...new Set(feed.sections.map(s => s.category))]) {
        const filter = button(category || "All discoveries", "discover-filter", () => {
            filters.querySelectorAll("button").forEach(el => el.setAttribute("aria-pressed", String(el === filter))); render(category);
        });
        filter.setAttribute("aria-pressed", String(!category)); filters.append(filter);
    }
    filters.hidden = false;
}
async function load(force = false) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        refresh.disabled = true; refresh.textContent = "Finding your next finds…"; container.setAttribute("aria-busy", "true"); message("");
        if (!feed) skeletons(); let timeout;
        try {
            const { client } = await account(), { data, error } = await client.auth.getSession();
            if (error || !data.session?.access_token) throw new Error("Please sign in again to see your discoveries.");
            const controller = new AbortController(); timeout = setTimeout(() => controller.abort(), 90000);
            const response = await fetch(`/api/discover${force ? "?refresh=1" : ""}`, {
                headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: controller.signal, cache: "no-store",
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Discoveries couldn't load. Please try again.");
            feed = payload; renderFilters(); render();
            if (feed.partial) message("Some collections are taking longer to load. You can browse these finds or retry shortly.");
            document.getElementById("discover-description").textContent = feed.cold_start
                ? "A few starting points for you. Save what catches your eye to make your next visit more personal."
                : "Fresh possibilities, shaped by what you like. A little familiar. A little unexpected.";
            document.getElementById("live-status").textContent = `${feed.sections.reduce((n, s) => n + s.products.length, 0)} discoveries ready.`;
        } catch (error) {
            if (!feed) { clearObservers(); container.replaceChildren(node("div", "discover-empty", "Your next finds are a refresh away. You can also search from the dashboard.")); }
            message(error.name === "AbortError" ? "This is taking longer than expected. Please try again." : error.message);
        } finally {
            clearTimeout(timeout); container.setAttribute("aria-busy", "false"); refresh.disabled = false; refresh.textContent = "Refresh discoveries";
        }
    })().finally(() => { inFlight = null; }); return inFlight;
}
refresh.addEventListener("click", () => load(true));
document.getElementById("discover-compare-open").addEventListener("click", () => {
    const grid = document.getElementById("discover-compare-products"); grid.replaceChildren();
    for (const product of compared.values()) {
        const item = node("article", "discover-compare-item");
        item.append(node("h3", "", product.title), node("p", "product-card-price", price(product)), node("p", "", product.store_name || product.brand || "Online store"),
            node("p", "", Number.isFinite(product.rating) ? `${product.rating} ★ (${product.rating_count || 0} reviews)` : "No rating available"), node("p", "", product.condition || "Condition not provided"));
        grid.append(item); void trackProductEvent(product, "view");
    }
    dialog.showModal();
});
document.getElementById("discover-compare-close").addEventListener("click", () => dialog.close());
document.getElementById("discover-compare-clear").addEventListener("click", () => { compared.clear(); compareState(); });
window.addEventListener("projectv:recommendations-changed", () => { if (!inFlight) message("Your feedback will shape your next discoveries. Refresh when you're ready."); });
window.addEventListener("pagehide", clearObservers);
void listSaved().then(rows => {
    rows.forEach(row => saved.add(row.product_key));
    container.querySelectorAll(".product-card").forEach(card => {
        const save = card.querySelector(".product-card-save"), active = saved.has(card.dataset.productKey);
        save.textContent = active ? "Saved" : "Save"; save.setAttribute("aria-pressed", String(active)); save.classList.toggle("is-saved", active);
    });
}).catch(() => { /* Save buttons stay usable if initial status cannot load. */ });
void load();
