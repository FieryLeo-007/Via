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
    return writeCart(items);
}

export function setCartQuantity(id, quantity) {
    const items = readCart().map(item => item.id === id ? { ...item, quantity } : item).filter(item => item.quantity > 0);
    return writeCart(items);
}

export function removeFromCart(id) {
    return writeCart(readCart().filter(item => item.id !== id));
}

export function subscribeToCart(callback) {
    const handler = event => callback(event.detail || readCart());
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) callback(readCart()); });
    callback(readCart());
    return () => window.removeEventListener(EVENT_NAME, handler);
}

export function cartEventName() { return EVENT_NAME; }
