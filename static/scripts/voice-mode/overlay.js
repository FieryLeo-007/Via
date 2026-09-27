// Voice Mode stage: captions under the orb and the cards V "shows" while it talks.
// All third-party text goes through textContent; nothing from a listing is parsed as HTML.
import { animate } from "motion";
import { safeProductUrl, retailerProductUrl } from "../search-client.mjs";
import { statusLabel, TERMINAL } from "../commerce-client.mjs";
import { dollars, shortName } from "./tools.mjs";

const PHASE_COPY = {
    connecting: "Connecting to V…",
    ended: "Talk soon",
    ending: "Talk soon"
};

const ERROR_COPY = {
    microphone: ["Microphone access is blocked.", "Allow microphone access for this site in your browser, then try again."],
    "no-microphone": ["No microphone found.", "Connect a microphone or headset, then try again."],
    setup: ["Voice mode isn't set up yet.", "Add ELEVENLABS_AGENT_ID to .env (run make voice-agent), then restart the server."],
    connection: ["Couldn't reach V.", "Check your connection and try again."]
};

// Order status → how far along the journey it is, for the timeline.
const ORDER_STEPS = ["Started", "Shopping", "Your approval", "Purchased"];
const ORDER_PROGRESS = { starting: 0, queued: 0, running: 1, awaiting_input: 2, succeeded: 3 };

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(child => child != null && child !== false));
    return node;
}

function productImage(product) {
    const url = safeProductUrl(product.image_url);
    const media = el("div", { class: "vm-card-media" }, el("span", { class: "vm-card-monogram", text: (product.brand || product.store_name || "P").charAt(0) }));
    if (url) {
        const image = el("img", { src: url, alt: "", loading: "lazy", referrerpolicy: "no-referrer", decoding: "async" });
        image.addEventListener("error", () => image.remove(), { once: true });
        media.append(image);
    }
    return media;
}

export function createVoiceOverlay(dialog, { onEnd, onMute, onSend, onRetry, onTapAdd, reducedMotion = false }) {
    const stage = dialog.querySelector("[data-voice-stage]");
    const status = dialog.querySelector("[data-voice-status]");
    const userCaption = dialog.querySelector("[data-voice-caption-user]");
    const agentCaption = dialog.querySelector("[data-voice-caption-agent]");
    const errorBox = dialog.querySelector("[data-voice-error]");
    const muteButton = dialog.querySelector("[data-voice-mute]");
    const typeForm = dialog.querySelector("[data-voice-type]");
    const typeInput = typeForm.querySelector("input");
    let pendingConfirm = null, products = [], savedIds = new Set(), view = null;

    // The stage scrolls when V shows something taller than the space left; flag it for the edge fade.
    function syncScroll() {
        const scrollable = stage.scrollHeight > stage.clientHeight + 1;
        stage.classList.toggle("is-scrollable", scrollable);
        stage.classList.toggle("is-at-end", !scrollable || stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2);
    }
    const stageResize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncScroll) : null;
    stageResize?.observe(stage);

    const listeners = [
        [stage, "scroll", syncScroll],
        [dialog.querySelector("[data-voice-end]"), "click", () => onEnd()],
        [dialog.querySelector("[data-voice-retry]"), "click", () => onRetry()],
        [muteButton, "click", () => {
            const muted = muteButton.getAttribute("aria-pressed") !== "true";
            muteButton.setAttribute("aria-pressed", String(muted));
            muteButton.querySelector("span").textContent = muted ? "Unmute" : "Mute";
            onMute(muted);
        }],
        [typeForm, "submit", event => {
            event.preventDefault();
            if (onSend(typeInput.value)) typeInput.value = "";
        }],
        // Escape ends the conversation gracefully instead of silently closing the dialog.
        [dialog, "cancel", event => { event.preventDefault(); onEnd(); }]
    ];
    listeners.forEach(([node, type, handler]) => node?.addEventListener(type, handler));

    function reveal(node, delay = 0) {
        if (reducedMotion || !node.isConnected) return;
        animate(node, { opacity: [0, 1], y: [18, 0], scale: [.98, 1] }, { duration: .42, delay, ease: [.23, 1, .32, 1] });
    }

    function setView(name, node) {
        if (pendingConfirm && name !== "confirm") { pendingConfirm.resolve(false); pendingConfirm = null; }
        view = name;
        stage.replaceChildren(node);
        stage.scrollTop = 0;
        dialog.dataset.stage = "true";
        reveal(node);
        stageResize?.disconnect(); stageResize?.observe(stage); stageResize?.observe(node);
        requestAnimationFrame(syncScroll);
        return node;
    }

    function panel(title, eyebrow, ...body) {
        return el("div", { class: "vm-panel" },
            el("header", { class: "vm-panel-head" }, eyebrow ? el("span", { class: "vm-eyebrow", text: eyebrow }) : null, el("h3", { text: title })),
            ...body);
    }

    function productCard(product, index) {
        const url = retailerProductUrl(product.merchant_url) || retailerProductUrl(product.product_page_url);
        const saved = savedIds.has(product.id);
        const rating = product.rating != null ? `${product.rating.toFixed(1)}★ · ${(product.rating_count || 0).toLocaleString()}` : "No rating yet";
        return el("article", { class: "vm-card" + (product.top_pick_rank ? " is-pick" : ""), "data-index": index, "aria-label": `Item ${index + 1}: ${product.title}` },
            productImage(product),
            el("span", { class: "vm-card-number", "aria-hidden": "true", text: String(index + 1) }),
            product.top_pick_rank ? el("span", { class: "vm-card-badge", text: product.top_pick_rank === 1 ? "V's pick" : `Top pick #${product.top_pick_rank}` }) : null,
            saved ? el("span", { class: "vm-card-saved", text: "Saved" }) : null,
            el("div", { class: "vm-card-body" },
                el("p", { class: "vm-card-store", text: product.store_name || product.brand || "Online store" }),
                el("h4", { class: "vm-card-title", text: shortName(product.title, 70), title: product.title }),
                el("p", { class: "vm-card-meta", text: rating }),
                el("div", { class: "vm-card-foot" },
                    el("strong", { class: "vm-card-price", text: dollars(product.price_cents) }),
                    el("div", { class: "vm-card-actions" },
                        url ? el("a", { class: "vm-card-link", href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": `View ${shortName(product.title)} at retailer`, text: "View" }) : null,
                        el("button", { type: "button", class: "vm-card-add", text: "Add", "aria-label": `Add ${shortName(product.title)} to cart`,
                            onclick: event => { event.currentTarget.textContent = "Added ✓"; onTapAdd(index); } })))));
    }

    function renderProducts() {
        const rail = el("div", { class: "vm-rail", role: "list" }, products.map((product, i) => {
            const card = productCard(product, i);
            card.setAttribute("role", "listitem");
            return card;
        }));
        return rail;
    }

    function cartPanel(items, highlightId) {
        const subtotal = items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
        if (!items.length) return panel("Your cart is empty", "Cart", el("p", { class: "vm-muted", text: "Ask V to add something you like." }));
        return panel(`${items.reduce((sum, item) => sum + item.quantity, 0)} in your cart`, "Cart",
            el("ul", { class: "vm-lines" }, items.map((item, i) => el("li", { class: "vm-line" + (item.id === highlightId ? " is-new" : "") },
                el("span", { class: "vm-line-n", text: String(i + 1) }),
                el("span", { class: "vm-line-name", text: shortName(item.title, 60) }),
                el("span", { class: "vm-line-qty", text: `× ${item.quantity}` }),
                el("strong", { text: dollars(item.price_cents * item.quantity) })))),
            el("div", { class: "vm-total" }, el("span", { text: "Subtotal" }), el("strong", { text: dollars(subtotal) })),
            el("a", { class: "vm-quiet-link", href: "/cart", target: "_blank", rel: "noopener", text: "Open cart page ↗" }));
    }

    function quotePanel(quote, state = "review") {
        const { subtotal, tax, delivery, total } = quote.totals;
        return panel(state === "placing" ? "Placing your demo order…" : "Ready to check out", "Demo checkout · no real charge",
            el("ul", { class: "vm-lines" }, quote.items.map(item => el("li", { class: "vm-line" },
                el("span", { class: "vm-line-name", text: shortName(item.title, 60) }),
                el("span", { class: "vm-line-qty", text: `× ${item.quantity}` }),
                el("strong", { text: dollars(item.price_cents * item.quantity) })))),
            el("dl", { class: "vm-breakdown" },
                el("dt", { text: "Subtotal" }), el("dd", { text: dollars(subtotal) }),
                el("dt", { text: "Sample tax (8%)" }), el("dd", { text: dollars(tax) }),
                el("dt", { text: quote.shipping === "express" ? "Express shipping" : "Standard shipping" }), el("dd", { text: delivery ? dollars(delivery) : "Free" })),
            el("div", { class: "vm-total is-grand" }, el("span", { text: "Total" }), el("strong", { text: dollars(total) })),
            el("p", { class: "vm-muted", text: state === "placing" ? "Simulating the purchase. No payment is made." : "Say “yes, place it” to confirm." }));
    }

    // The dialog sits in the top layer, so confetti must draw on a canvas inside it to be seen.
    function celebrate() {
        import("canvas-confetti").then(({ default: confetti }) => {
            const canvas = el("canvas", { class: "vm-confetti", "aria-hidden": "true" });
            dialog.append(canvas);
            const burst = confetti.create(canvas, { resize: true, useWorker: false, disableForReducedMotion: true });
            return Promise.resolve(burst({ particleCount: 110, spread: 75, startVelocity: 38, origin: { y: .72 },
                colors: ["#006b45", "#34d399", "#d9fbe8", "#0e8a4b"] })).finally(() => { burst.reset(); canvas.remove(); });
        }).catch(() => {});
    }

    function orderRow(order, n) {
        const done = order.status === "succeeded", live = !TERMINAL.has(order.status);
        return el("li", { class: "vm-order" },
            el("span", { class: "vm-line-n", text: String(n) }),
            el("span", { class: "vm-line-name", text: shortName(order.item?.title || "Order", 60) }),
            order.is_demo ? el("span", { class: "vm-tag", text: "Demo" }) : null,
            el("span", { class: "vm-status" + (done ? " is-done" : live ? " is-live" : ""), text: statusLabel(order.status) }));
    }

    function timeline(order) {
        const step = ORDER_PROGRESS[order.status];
        if (step === undefined) return el("p", { class: "vm-muted", text: statusLabel(order.status) });
        return el("ol", { class: "vm-timeline" }, ORDER_STEPS.map((label, i) =>
            el("li", { class: i < step ? "is-done" : i === step ? (i === 3 ? "is-done" : "is-current") : "" }, el("span", { text: label }))));
    }

    return {
        setPhase(phase) {
            dialog.dataset.phase = phase;
            if (PHASE_COPY[phase]) status.textContent = PHASE_COPY[phase];
            if (phase !== "error") errorBox.hidden = true;
            const live = phase === "live";
            muteButton.disabled = !live;
            typeInput.disabled = !live;
            typeForm.querySelector("button").disabled = !live;
        },
        status(text) { if (status.textContent !== text) status.textContent = text; },
        caption(role, message) {
            const target = role === "user" ? userCaption : agentCaption;
            target.textContent = message;
            if (role === "agent") userCaption.classList.add("is-past");
            else { userCaption.classList.remove("is-past"); agentCaption.classList.add("is-past"); }
            if (role === "agent") agentCaption.classList.remove("is-past");
            if (!reducedMotion) animate(target, { opacity: [0, 1], y: [6, 0] }, { duration: .3, ease: "easeOut" });
        },
        error(kind, error) {
            const [title, detail] = ERROR_COPY[kind] || ERROR_COPY.connection;
            errorBox.hidden = false;
            errorBox.querySelector("strong").textContent = title;
            errorBox.querySelector("p").textContent = kind === "connection" && error?.message && error.message.length < 160 ? error.message : detail;
            status.textContent = title;
        },
        ended() { status.textContent = "Talk soon"; },
        farewell() {
            if (pendingConfirm) { pendingConfirm.resolve(false); pendingConfirm = null; }
            dialog.dataset.phase = "ended";
            status.textContent = "Talk soon";
            muteButton.disabled = typeInput.disabled = typeForm.querySelector("button").disabled = true;
        },
        toolStarted() {}, toolFinished() {},

        showSearching(utterance) {
            const skeleton = el("div", { class: "vm-rail is-loading", "aria-hidden": "true" }, Array.from({ length: 4 }, () => el("div", { class: "vm-card vm-skeleton" })));
            setView("searching", el("div", { class: "vm-stack" }, el("p", { class: "vm-stage-title", text: `Searching for “${shortName(utterance, 80)}”` }), skeleton));
        },
        showProducts(results, { query } = {}) {
            products = results.slice();
            if (!products.length) { setView("products", panel("No matches yet", "Search", el("p", { class: "vm-muted", text: "Try a wider budget or fewer must-haves." }))); return; }
            const body = el("div", { class: "vm-stack" }, el("p", { class: "vm-stage-title", text: `${products.length} finds for “${shortName(query || "", 80)}”` }), renderProducts());
            setView("products", body);
            if (!reducedMotion) body.querySelectorAll(".vm-card").forEach((card, i) => reveal(card, .05 * i));
        },
        updatePicks(results) {
            products = results.slice();
            if (view !== "products") return;
            const rail = stage.querySelector(".vm-rail");
            rail?.replaceWith(renderProducts());
        },
        spotlight(index) {
            if (view !== "products") this.showProducts(products, {});
            stage.querySelectorAll(".vm-card").forEach((card, i) => card.classList.toggle("is-spotlit", i === index));
            stage.querySelector(`.vm-card[data-index="${index}"]`)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", inline: "center", block: "nearest" });
        },
        showComparing(indices) { this.spotlight(indices[0]); stage.querySelectorAll(".vm-card").forEach((card, i) => card.classList.toggle("is-spotlit", indices.includes(i))); },
        showCompare(result, picked) {
            const winner = picked.find(entry => entry.product.id === result.winner_id);
            setView("compare", panel(winner ? `#${winner.n} comes out ahead` : "Side by side", "Comparison",
                el("p", { class: "vm-verdict", text: result.verdict }),
                el("div", { class: "vm-compare" }, picked.map(entry => {
                    const take = (result.takes || []).find(item => item.id === entry.product.id) || {};
                    return el("section", { class: "vm-compare-col" + (entry === winner ? " is-winner" : "") },
                        productImage(entry.product),
                        el("h4", { text: `#${entry.n} · ${take.short_name || shortName(entry.product.title, 40)}` }),
                        el("strong", { class: "vm-card-price", text: dollars(entry.product.price_cents) }),
                        take.best_for ? el("p", { class: "vm-muted", text: `Best for ${take.best_for}` }) : null,
                        el("ul", { class: "vm-pros" }, (take.pros || []).slice(0, 3).map(text => el("li", { text }))),
                        el("ul", { class: "vm-cons" }, (take.cons || []).slice(0, 2).map(text => el("li", { text }))));
                }))));
        },
        showCart(items, { highlightId } = {}) { setView("cart", cartPanel(items, highlightId)); },
        markSaved(id) {
            savedIds.add(id);
            if (view === "products") stage.querySelector(".vm-rail")?.replaceWith(renderProducts());
        },
        showQuote(quote) { setView("quote", quotePanel(quote)); },
        showPlacing(quote) { setView("quote", quotePanel(quote, "placing")); },
        showOrderPlaced(order, quote) {
            const confirmation = order.result?.purchase?.receipt?.merchantOrderId;
            setView("placed", panel("Demo order placed", "Done",
                el("div", { class: "vm-success", "aria-hidden": "true" }, el("span", { text: "✓" })),
                el("p", { class: "vm-verdict", text: `${dollars(quote.totals.total)} · ${quote.items.length} item${quote.items.length === 1 ? "" : "s"}${confirmation ? ` · ${confirmation}` : ""}` }),
                el("p", { class: "vm-muted", text: "Simulation only. No payment was made and no merchant order was placed." }),
                el("a", { class: "vm-quiet-link", href: "/orders", target: "_blank", rel: "noopener", text: "View in Orders ↗" })));
            if (!reducedMotion) celebrate();
        },
        confirmRealCheckout({ item, maxCost }) {
            if (pendingConfirm) pendingConfirm.resolve(false);
            return new Promise(resolve => {
                const timer = setTimeout(() => settle(false), 100000);
                function settle(value) {
                    clearTimeout(timer);
                    if (pendingConfirm?.resolve === settle) pendingConfirm = null;
                    resolve(value);
                    confirmButton.disabled = cancelButton.disabled = true;
                }
                const confirmButton = el("button", { type: "button", class: "vm-button is-primary", text: "Confirm real checkout", onclick: () => settle(true) });
                const cancelButton = el("button", { type: "button", class: "vm-button", text: "Cancel", onclick: () => settle(false) });
                setView("confirm", panel("Start a real purchase?", "Real checkout · needs your tap",
                    el("div", { class: "vm-line is-confirm" }, el("span", { class: "vm-line-name", text: shortName(item.title, 70) }), el("span", { class: "vm-line-qty", text: `× ${item.quantity}` })),
                    el("div", { class: "vm-total is-grand" }, el("span", { text: "Spending cap (incl. tax & shipping)" }), el("strong", { text: "$" + maxCost })),
                    el("p", { class: "vm-muted", text: "ProjectV's checkout agent will shop within this cap. You'll approve the card payment on the next page. Nothing is charged before that." }),
                    el("div", { class: "vm-actions" }, cancelButton, confirmButton)));
                pendingConfirm = { resolve: settle };
                confirmButton.focus({ preventScroll: true });
            });
        },
        showRealCheckout(order) {
            setView("real", panel("Checkout agent started", "Real checkout",
                el("p", { class: "vm-verdict", text: `${shortName(order.item?.title || "Your item", 60)} · ${statusLabel(order.status)}` }),
                el("p", { class: "vm-muted", text: "Approve the card payment on the secure checkout page. V stays here while you do." }),
                el("div", { class: "vm-actions" }, el("a", { class: "vm-button is-primary", href: `/checkout/${encodeURIComponent(order.id)}`, target: "_blank", rel: "noopener", text: "Approve payment ↗" }))));
        },
        showOrders(orders) {
            setView("orders", orders.length
                ? panel(`${orders.length} recent order${orders.length === 1 ? "" : "s"}`, "Orders", el("ul", { class: "vm-lines" }, orders.map((order, i) => orderRow(order, i + 1))),
                    el("a", { class: "vm-quiet-link", href: "/orders", target: "_blank", rel: "noopener", text: "Open Orders ↗" }))
                : panel("No orders yet", "Orders", el("p", { class: "vm-muted", text: "Your purchases and demo orders will show up here." })));
        },
        showOrder(order) {
            const amount = order.result?.purchase?.receipt?.total?.amount;
            setView("order", panel(shortName(order.item?.title || "Order", 70), order.is_demo ? "Demo order" : "Order",
                timeline(order),
                el("div", { class: "vm-total" }, el("span", { text: amount ? "Total" : "Spending cap" }), el("strong", { text: "$" + (amount || order.max_cost || "—") })),
                order.status === "awaiting_input" || !TERMINAL.has(order.status)
                    ? el("a", { class: "vm-button is-primary", href: `/checkout/${encodeURIComponent(order.id)}`, target: "_blank", rel: "noopener", text: "Open checkout ↗" })
                    : el("a", { class: "vm-quiet-link", href: "/orders", target: "_blank", rel: "noopener", text: "Open Orders ↗" })));
        },
        openPage(href) { dialog.dispatchEvent(new CustomEvent("voice:navigate", { detail: href })); },
        reset() {
            if (pendingConfirm) { pendingConfirm.resolve(false); pendingConfirm = null; }
            products = []; savedIds = new Set(); view = null;
            stage.replaceChildren(); delete dialog.dataset.stage;
            userCaption.textContent = ""; agentCaption.textContent = "";
            userCaption.classList.remove("is-past"); agentCaption.classList.remove("is-past");
            errorBox.hidden = true;
            muteButton.setAttribute("aria-pressed", "false"); muteButton.querySelector("span").textContent = "Mute";
            typeInput.value = "";
        },
        destroy() { stageResize?.disconnect(); listeners.forEach(([node, type, handler]) => node?.removeEventListener(type, handler)); }
    };
}
