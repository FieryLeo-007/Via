import { trackProductEvent } from "./analytics.mjs";
const STORAGE_KEY = "projectv:cart";
const EVENT_NAME = "projectv:cart-updated";

function readCart() {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(value) ? value.filter(item => item && item.id && item.quantity > 0) : [];
    } catch {
        return [];
    }
}

function writeCart(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: items }));
    return items;
}

export function cartItems() { return readCart(); }
export function cartCount(items = readCart()) { return items.reduce((sum, item) => sum + item.quantity, 0); }
export function cartSubtotal(items = readCart()) { return items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0); }

export function addToCart(product) {
    const items = readCart();
    const existing = items.find(item => item.id === product.id);
    if (existing) existing.quantity += 1;
    else items.push({ ...product, quantity: 1 });
    const result = writeCart(items);
    void trackProductEvent(product, "add_to_cart");
    return result;
}

export function setCartQuantity(id, quantity) {
    if (!Number.isInteger(quantity) || quantity < 0) return readCart();
    const before = readCart();
    const changed = before.find(item => item.id === id);
    const items = before.map(item => item.id === id ? { ...item, quantity } : item).filter(item => item.quantity > 0);
    const result = writeCart(items);
    if (changed && changed.quantity !== quantity) void trackProductEvent(changed, quantity > changed.quantity ? "add_to_cart" : "remove_from_cart");
    return result;
}

export function removeFromCart(id) {
    const items = readCart();
    const removed = items.find(item => item.id === id);
    const result = writeCart(items.filter(item => item.id !== id));
    if (removed) void trackProductEvent(removed, "remove_from_cart");
    return result;
}

export function trackCartCheckout(orderId) {
    if (orderId) localStorage.setItem(`projectv:cart-pending:${orderId}`, "1");
}

export function fulfillOrder(order) {
    if (!order?.id || order.status !== "succeeded") return readCart();
    const key = `projectv:cart-fulfilled:${order.id}`;
    if (localStorage.getItem(key)) return readCart();
    const purchased = new Map();
    const items = order.is_demo ? order.result?.items || [] : [order.item];
    for (const item of items) {
        if (item?.id && Number.isInteger(item.quantity) && item.quantity > 0) {
            purchased.set(item.id, (purchased.get(item.id) || 0) + item.quantity);
        }
    }
    if (!purchased.size) return readCart();
    const remaining = readCart().map(item => ({
        ...item, quantity: Math.max(0, item.quantity - (purchased.get(item.id) || 0)),
    })).filter(item => item.quantity > 0);
    // Completion is not negative shopping feedback. Do not emit remove events.
    const result = writeCart(remaining);
    localStorage.setItem(key, "1");
    return result;
}

export function fulfillDemoOrder(order) {
    return order?.is_demo === true ? fulfillOrder(order) : readCart();
}

export function reconcileCartOrders(orders) {
    for (const order of orders) {
        const key = `projectv:cart-pending:${order.id}`;
        // Old history and Wallet samples must not consume newly added items.
        if (!localStorage.getItem(key)) continue;
        fulfillOrder(order);
        if (localStorage.getItem(`projectv:cart-fulfilled:${order.id}`)
                || ["cancelled", "refunded", "failed", "blocked"].includes(order.status)) {
            localStorage.removeItem(key);
        }
    }
    return readCart();
}

export function subscribeToCart(callback) {
    const handler = event => callback(event.detail || readCart());
    const storageHandler = event => { if (event.key === STORAGE_KEY) callback(readCart()); };
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", storageHandler);
    callback(readCart());
    return () => { window.removeEventListener(EVENT_NAME, handler); window.removeEventListener("storage", storageHandler); };
}

export function cartEventName() { return EVENT_NAME; }
