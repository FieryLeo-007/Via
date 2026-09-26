import { addToCart, cartCount, cartItems, cartSubtotal, removeFromCart, setCartQuantity, subscribeToCart } from "./cart-store.mjs";

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
    function buy(item) {
        const url = safeUrl(item.product_page_url) || safeUrl(item.merchant_url);
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        else checkout.focus();
    }
    checkout.addEventListener("click", () => { if (cartItems().length) checkout.textContent = "Checkout coming soon"; });
    subscribeToCart(render);
})();
