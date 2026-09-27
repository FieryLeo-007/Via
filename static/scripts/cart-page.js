import { addToCart, cartCount, cartItems, cartSubtotal, removeFromCart, setCartQuantity, subscribeToCart } from "./cart-store.mjs";
import { trackProductEvent } from "./analytics.mjs";
import { api, accountReady } from "./commerce-client.mjs";

(function () {
    "use strict";
    const list = document.getElementById("cart-items");
    const summaryCount = document.getElementById("cart-summary-count");
    const subtotal = document.getElementById("cart-subtotal");
    const checkout = document.getElementById("cart-checkout");
    const badge = document.querySelector("[data-cart-count]");
    const currency = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    const safeUrl = value => { try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; } };

    function render(items) {
        const count = cartCount(items);
        if (badge) { badge.textContent = count; badge.hidden = !count; }
        summaryCount.textContent = `${count} ${count === 1 ? "item" : "items"}`;
        subtotal.textContent = currency(cartSubtotal(items));
        checkout.disabled = !items.length;
        list.innerHTML = "";
        if (!items.length) {
            list.innerHTML = '<div class="cart-empty"><span class="cart-empty-icon">✦</span><h2>Your cart is waiting</h2><p>Add something from Discover and it will show up here.</p><a class="cart-primary-link" href="/dashboard">Browse products</a></div>';
            return;
        }
        items.forEach(item => {
            const row = document.createElement("article"); row.className = "cart-item";
            const image = safeUrl(item.image_url);
            row.innerHTML = `<div class="cart-item-media"><span>${escape((item.brand || item.store_name || "P").charAt(0))}</span>${image ? `<img src="${escape(image)}" alt="">` : ""}</div><div class="cart-item-info"><p class="cart-item-brand">${escape(item.store_name || item.brand || "Online store")}</p><h2>${escape(item.title)}</h2><p class="cart-item-detail">${item.rating != null ? `${item.rating.toFixed(1)}★ · ${item.rating_count.toLocaleString()} reviews` : "No rating available"}</p><div class="cart-item-actions"><div class="quantity-control" aria-label="Quantity"><button type="button" data-minus aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-plus aria-label="Increase quantity">+</button></div><button type="button" class="cart-remove" data-remove>Remove</button></div></div><div class="cart-item-buy"><strong>${currency(item.price_cents)}</strong><button type="button" class="cart-buy-button" data-buy>Buy now</button></div>`;
            row.querySelector("[data-minus]").addEventListener("click", () => setCartQuantity(item.id, item.quantity - 1));
            row.querySelector("[data-plus]").addEventListener("click", () => setCartQuantity(item.id, item.quantity + 1));
            row.querySelector("[data-remove]").addEventListener("click", () => removeFromCart(item.id));
            row.querySelector("[data-buy]").addEventListener("click", () => buy(item));
            list.appendChild(row);
        });
    }
    function buy(item) { void openCheckout([item]); }
    async function openCheckout(items) {
        if (!items.length || document.querySelector(".checkout-dialog")) return;
        const demoHref = `/checkout/demo?source=cart${items.length === 1 ? `&item=${encodeURIComponent(items[0].id)}` : ""}`;
        const dialog = document.createElement("dialog"); dialog.className = "checkout-dialog";
        dialog.setAttribute("aria-labelledby", "checkout-title");
        dialog.innerHTML = `<button class="checkout-close" aria-label="Close checkout">×</button><h2 id="checkout-title">Let your agent check out</h2><p>Set a maximum for each product, including taxes and shipping. Each product gets its own checkout. You’ll approve the card payment before the agent buys.</p><a class="cart-demo-checkout" href="${escape(demoHref)}">✦ Preview with demo checkout <span>→</span></a><p class="cart-demo-note">The full experience, with a demo card. No real charges.</p><form><div>${items.map((item, i) => `<div class="checkout-product"><strong>${escape(item.title)} · Qty ${item.quantity}</strong><label>Maximum total (USD)<input name="limit-${i}" type="number" min="0.01" max="100000" step="0.01" value="${((item.price_cents || 0) * item.quantity / 100).toFixed(2)}" required></label></div>`).join("")}</div><p>Increase the limits to allow for taxes and delivery. The agent will stop if it cannot stay within your limit.</p><label>Product preferences (optional)<textarea name="instructions" maxlength="2000" placeholder="Size, color, or delivery preference. Never enter card details or passwords."></textarea></label><label><input type="checkbox" name="consent" required> I authorize the agent to shop for these products within the limits above.</label><p data-checkout-error role="alert" class="commerce-error" hidden></p><div class="commerce-actions"><button class="commerce-button" type="submit" disabled>Checking setup…</button><a class="commerce-link secondary" href="/wallet">Manage wallet</a><a href="/orders">View orders</a></div></form>`;
        document.body.append(dialog); dialog.showModal();
        dialog.querySelector(".checkout-close").addEventListener("click", () => dialog.close());
        dialog.addEventListener("close", () => dialog.remove());
        const submit = dialog.querySelector('[type="submit"]'), error = dialog.querySelector("[data-checkout-error]");
        function report(message) {error.hidden = false; error.textContent = message;}
        try {
            const config = await api("/config");
            if (!config.ready) {report(`Setup needed: ${config.missing.join(", ")}. Open Wallet for details.`); submit.textContent = "Setup needed"; return;}
            submit.disabled = false; submit.textContent = "Start agent checkout";
        } catch (e) {report(e.message); return;}
        dialog.querySelector("form").addEventListener("submit", async event => {
            event.preventDefault(); if (submit.disabled) return;
            submit.disabled = true; submit.textContent = "Starting checkout…"; error.hidden = true;
            const form = new FormData(event.target), started = [];
            try {
                const account = await accountReady();
                for (const [i, item] of items.entries()) {
                    const payload = {item, maxCost: form.get(`limit-${i}`), consent: true, instructions: form.get("instructions")};
                    // A shared, stable key also survives navigation or a lost HTTP response.
                    const source = JSON.stringify([account.user.id, item.id, item.quantity, payload.maxCost, payload.instructions]);
                    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)))].map(b => b.toString(16).padStart(2,"0")).join("");
                    const key = `projectv:checkout:${digest}`;
                    let id = localStorage.getItem(key);
                    if (id) {
                        const previous = (await api(`/orders/${id}`)).order;
                        if (["succeeded", "blocked", "failed", "cancelled"].includes(previous.status)) {
                            const warning = previous.status === "succeeded" ? "This product was already purchased. Start a separate new purchase?" : "The earlier checkout has finished. Start a new checkout attempt? Check the merchant first if payment may have been placed.";
                            if (!confirm(warning)) { window.location.assign(`/checkout/${id}`); return; }
                            id = null;
                        }
                    }
                    id ||= crypto.randomUUID(); localStorage.setItem(key, id);
                    const result = await api("/orders", {method: "POST", body: {...payload, id}});
                    localStorage.setItem(key, result.order.id);
                    started.push(result.order.id);
                }
                window.location.assign(started.length === 1 ? `/checkout/${started[0]}` : "/orders");
            } catch(e) {
                report(`${e.message} ${started.length ? `${started.length} checkout(s) were saved. ` : ""}Check Orders before starting again.`);
                submit.textContent = "Check Orders to continue";
                // Do not silently retry an uncertain purchase creation.
            }
        });
    }
    checkout.addEventListener("click", () => { void openCheckout(cartItems()); });
    subscribeToCart(render);
})();
