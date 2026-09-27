import { account, listSaved, setSaved, productKey } from "./account-store.mjs";
import { trackProductEvent, observeProductImpression } from "./analytics.mjs";
import { addToCart } from "./cart-store.mjs";
import { compareProducts, safeProductUrl, retailerProductUrl } from "./search-client.mjs";
import { MAX_COMPARE, renderComparison } from "./compare-view.js";
import "./cart-nav.js";

import "./site-interactions.js";
const container = document.getElementById("discover-sections");
const refresh = document.getElementById("discover-refresh");
const filters = document.getElementById("discover-filters");
const notice = document.getElementById("discover-notice");
const dialog = document.getElementById("discover-compare-dialog");
const compareBody = document.getElementById("discover-compare-body");
const saved = new Set(), compared = new Map(), hidden = new Set();
let feed, inFlight, cleanups = [], toastTimer, comparisonRequest, comparisonVersion = 0;
let activeCategory = "", refinements = { maximum: null, rating: 0, brands: [] };
const searchInput = document.getElementById("discover-search");
const sortInput = document.getElementById("discover-sort");
const refineForm = document.getElementById("discover-refine");
const brandOf = product => product.brand || product.store_name || "Online store";

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

function compareProduct(product) {
    const score = Number.isFinite(product.score) ? product.score : 0;
    return {
        ...product,
        source: product.source || "discover",
        source_id: product.source_id || String(product.id),
        score,
        breakdown: {
            relevance: 0, constraint_fit: 0, quality: 0, priority_fit: 0,
            base: score, personal: 0, score,
            ...(product.breakdown || {}),
        },
        reasons: Array.isArray(product.reasons) ? product.reasons : [],
    };
}

function comparisonContext(products) {
    const search = searchInput.value.trim();
    const categories = [...new Set(products.map(product => product.category).filter(Boolean))];
    const intent = {
        query: search || categories.join(" versus ") || "Discover recommendations",
        max_price_cents: refinements.maximum == null ? null : Math.round(refinements.maximum * 100),
        min_rating: refinements.rating || null,
        // The filter accepts either a brand or a store; only actual brands map to
        // ShoppingIntent.brands_include, so a retailer name is never misrepresented.
        brands_include: refinements.brands.filter(value => products.some(product => product.brand === value)),
    };
    return { intent, utterance: search || null };
}

async function openComparison() {
    const products = Array.from(compared.values());
    if (products.length < 2) return;
    if (comparisonRequest) comparisonRequest.abort();
    comparisonRequest = new AbortController();
    const current = ++comparisonVersion;
    if (!dialog.open) dialog.showModal();
    const render = (comparison = null, error = null) => renderComparison({
        body: compareBody,
        products,
        comparison,
        error,
        announce,
        onRetry: openComparison,
        onRemove(product) {
            compared.delete(productKey(product));
            compareState();
            if (compared.size < 2) dialog.close(); else openComparison();
        },
    });
    render();
    try {
        const context = comparisonContext(products);
        const comparison = await compareProducts(products.map(compareProduct), { ...context, signal: comparisonRequest.signal });
        if (current !== comparisonVersion || !dialog.open) return;
        render(comparison);
        const winner = comparison.takes.find(take => take.id === comparison.winner_id);
        announce(`Comparison ready.${winner ? ` Our pick: ${winner.short_name}.` : ""}`);
    } catch (error) {
        if (current !== comparisonVersion || error.name === "AbortError" || !dialog.open) return;
        render(null, error.message || "Please try again.");
    }
}

function compareState() {
    const count = compared.size;
    document.getElementById("discover-compare-bar").hidden = !count;
    document.getElementById("discover-compare-count").textContent = `${count} of ${MAX_COMPARE} products selected`;
    document.getElementById("discover-compare-open").disabled = count < 2;
    const previews = document.getElementById("discover-compare-previews");
    previews.replaceChildren();
    for (const [key, product] of compared) {
        const preview = node("div", "discover-compare-preview");
        const url = safeProductUrl(product.image_url);
        if (url) { const image = node("img"); image.src = url; image.alt = ""; image.referrerPolicy = "no-referrer"; preview.append(image); }
        const copy = node("div"); copy.append(node("strong", "", product.title), node("span", "", price(product)));
        const remove = button("×", "discover-quiet-button", () => { compared.delete(key); compareState(); });
        remove.setAttribute("aria-label", `Remove ${product.title} from comparison`);
        preview.append(copy, remove); previews.append(preview);
    }
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
            if (compared.size >= MAX_COMPARE) { announce(`Compare up to ${MAX_COMPARE} products. Remove one first.`); return; }
            compared.set(key, product);
        }
        compareState();
    });
    compare.dataset.compareKey = key;
    const hide = kind => async () => {
        hidden.add(key); compared.delete(key); render();
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
function render(filter = activeCategory) {
    if (!feed) return;
    activeCategory = filter;
    clearObservers(); container.replaceChildren();
    let resultCount = 0;
    const query = searchInput.value.trim().toLowerCase();
    for (const section of feed.sections.filter(s => !filter || s.category === filter)) {
        const wrapper = node("section", "discover-section"), heading = node("div", "discover-heading-row"), copy = node("div");
        copy.append(node("p", "", section.exploration ? "A little unexpected" : "Selected for you"));
        const title = node("h2", "", section.title); title.id = `${section.id}-title`; copy.append(title); wrapper.setAttribute("aria-labelledby", title.id);
        const explore = node("a", "", "Explore more ↗"); explore.href = `/dashboard?query=${encodeURIComponent(section.search_query)}`;
        heading.append(copy, explore); wrapper.append(heading);
        const products = section.products.filter(p => !hidden.has(productKey(p))
            && (!query || [p.title, p.brand, p.store_name].join(" ").toLowerCase().includes(query))
            && (refinements.maximum === null || Number.isFinite(p.price_cents) && p.price_cents <= refinements.maximum * 100)
            && (!refinements.rating || Number.isFinite(p.rating) && p.rating >= refinements.rating)
            && (!refinements.brands.length || refinements.brands.includes(brandOf(p))));
        const sort = sortInput.value;
        if (sort === "price-low") products.sort((a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity));
        if (sort === "price-high") products.sort((a, b) => (b.price_cents ?? -Infinity) - (a.price_cents ?? -Infinity));
        if (sort === "rating") products.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
        resultCount += products.length;
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
    document.getElementById("discover-result-count").textContent = `${resultCount} matching ${resultCount === 1 ? "find" : "finds"} in your collections`;
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
function renderBrands() {
    const options = document.getElementById("discover-brand-options");
    options.replaceChildren();
    const brands = [...new Set(feed.sections.flatMap(section => section.products.map(brandOf)))].sort();
    brands.forEach(brand => {
        const label = node("label");
        const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.name = "brand"; checkbox.value = brand;
        checkbox.checked = refinements.brands.includes(brand);
        label.append(checkbox, document.createTextNode(brand)); options.append(label);
    });
    if (!brands.length) options.append(node("p", "dashboard-empty", "No brands available yet."));
}
searchInput.addEventListener("input", () => render());
sortInput.addEventListener("change", () => render());
refineForm.addEventListener("submit", event => {
    event.preventDefault();
    const value = document.getElementById("discover-max-price").value;
    refinements = { maximum: value === "" ? null : Number(value), rating: Number(document.getElementById("discover-min-rating").value),
        brands: [...refineForm.querySelectorAll('[name="brand"]:checked')].map(input => input.value) };
    render();
});
refineForm.addEventListener("reset", () => {
    refinements = { maximum: null, rating: 0, brands: [] };
    searchInput.value = ""; sortInput.value = "match"; render();
});
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
            feed = payload; activeCategory = ""; renderFilters(); renderBrands(); render();
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
    compared.forEach(product => void trackProductEvent(product, "compare"));
    openComparison();
});
document.getElementById("discover-compare-close").addEventListener("click", () => dialog.close());
document.getElementById("discover-compare-clear").addEventListener("click", () => { compared.clear(); compareState(); });
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => {
    comparisonVersion++;
    if (comparisonRequest) { comparisonRequest.abort(); comparisonRequest = null; }
});
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
