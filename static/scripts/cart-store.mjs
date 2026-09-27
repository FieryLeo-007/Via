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

export function fulfillDemoOrder(order) {
    if (!order?.id || order.is_demo !== true || order.status !== "succeeded") return readCart();
    const key = `projectv:cart-fulfilled:${order.id}`;
    if (localStorage.getItem(key)) return readCart();
    const purchased = new Map();
    for (const item of order.result?.items || []) {
        if (item.id && Number.isInteger(item.quantity) && item.quantity > 0) {
            purchased.set(item.id, (purchased.get(item.id) || 0) + item.quantity);
        }
    }
    if (!purchased.size) return readCart();
    const remaining = readCart().map(item => ({
        ...item, quantity: Math.max(0, item.quantity - (purchased.get(item.id) || 0)),
    })).filter(item => item.quantity > 0);
    // Demo completion is neither a real purchase nor negative shopping feedback.
    const result = writeCart(remaining);
    localStorage.setItem(key, "1");
    return result;
}

export function subscribeToCart(callback) {
    const handler = event => callback(event.detail || readCart());
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) callback(readCart()); });
    callback(readCart());
    return () => window.removeEventListener(EVENT_NAME, handler);
}

export function cartEventName() { return EVENT_NAME; }
