import { cartCount, subscribeToCart } from "./cart-store.mjs";
subscribeToCart(items => document.querySelectorAll("[data-cart-count]").forEach(badge => { const count = cartCount(items); badge.textContent = count; badge.hidden = !count; }));
