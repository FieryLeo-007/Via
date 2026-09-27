import { account, productKey } from "./account-store.mjs";

export const EVENT_WEIGHTS = Object.freeze({
    impression: 0.1,
    view: 0.25,
    click: 0.4,
    compare: 0.5,
    save: 0.7,
    add_to_cart: 0.85,
    purchase: 1.0,
    remove_from_cart: -0.3,
    dislike: -1.0,
    hide: -1.0
});

const SESSION_KEY = "projectv:analytics-session";
const IMPRESSION_KEY = "projectv:analytics-impressions";
const inFlightImpressions = new Set();
const seenImpressions = new Set();

function sessionId() {
    try {
        let id = sessionStorage.getItem(SESSION_KEY);
        if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id); }
        return id;
    } catch { return null; }
}

function impressionSeen(key, mark = false) {
    try {
        const seen = new Set(JSON.parse(sessionStorage.getItem(IMPRESSION_KEY) || "[]"));
        if (!mark) return seen.has(key) || seenImpressions.has(key);
        seen.add(key); seenImpressions.add(key);
        sessionStorage.setItem(IMPRESSION_KEY, JSON.stringify([...seen].slice(-2000)));
    } catch { /* sessionStorage can be unavailable in privacy mode */ }
    return seenImpressions.has(key);
}

/** Best-effort event insert. The shopping interaction must never await this. */
export async function trackProductEvent(product, eventType, extra = {}) {
    const weight = EVENT_WEIGHTS[eventType];
    // External retailer redirects are not confirmed purchases. Only a future
    // verified server-side order/webhook integration may insert purchase events.
    if (!product || weight === undefined || eventType === "purchase") return null;
    const id = productKey(product);
    let impressionKey;
    try {
        const { client, user } = await account();
        if (eventType === "impression") {
            impressionKey = `${user.id}:${sessionId()}:${id}`;
            if (impressionSeen(impressionKey) || inFlightImpressions.has(impressionKey)) return null;
            inFlightImpressions.add(impressionKey);
        }
        // Never borrow the most recent conversation's ID for unrelated products.
        // Saved/cart snapshots may reference a deleted turn: retain product data
        // without an invalid foreign key in that case.
        let chatTurnId = extra.chatTurnId || product.analytics_chat_turn_id || null;
        if (chatTurnId) {
            const { data, error } = await client.from("chat_turns").select("id")
                .eq("id", chatTurnId).eq("user_id", user.id).maybeSingle();
            if (error || !data) chatTurnId = null;
        }
        const row = {
            user_id: user.id,
            chat_turn_id: chatTurnId,
            event_type: eventType,
            event_weight: weight,
            session_id: sessionId(),
            category: extra.category || product.category || null,
            product_data: { ...product, id },
            created_at: new Date().toISOString()
        };
        let { error } = await client.from("user_events").insert(row);
        if (error?.code === "23503" && /chat_turn_id/.test(error.message || "")) {
            row.chat_turn_id = null; // Turn deleted between verification and insert.
            ({ error } = await client.from("user_events").insert(row));
        }
        if (error) throw error;
        if (impressionKey) impressionSeen(impressionKey, true);
        if (eventType !== "impression") window.dispatchEvent(new CustomEvent("projectv:recommendations-changed", { detail: { eventType } }));
        return row;
    } catch (error) {
        // Telemetry is deliberately non-blocking, but retain enough detail to
        // diagnose RLS/schema failures in the browser console.
        console.warn("ProjectV analytics event was not recorded", JSON.stringify({
            eventType,
            productId: id,
            code: error?.code,
            details: error?.details,
            hint: error?.hint,
            message: error?.message || String(error)
        }));
        return null;
    } finally {
        if (impressionKey) inFlightImpressions.delete(impressionKey);
    }
}

// Observe visibility, not rendering. Short-lived or hidden-tab cards don't count.
export function observeProductImpression(element, product, extra = {}) {
    if (typeof IntersectionObserver === "undefined") return () => {};
    let visible = false, timer;
    const cancel = () => { clearTimeout(timer); timer = null; };
    const schedule = () => {
        cancel();
        if (!visible || document.visibilityState === "hidden") return;
        timer = setTimeout(() => {
            if (element.isConnected && document.visibilityState !== "hidden") {
                void trackProductEvent(product, "impression", extra);
                cleanup();
            }
        }, 500);
    };
    const observer = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .5);
        schedule();
    }, { threshold: [.5] });
    const cleanup = () => {
        cancel(); observer.disconnect(); document.removeEventListener("visibilitychange", schedule);
    };
    document.addEventListener("visibilitychange", schedule);
    observer.observe(element);
    return cleanup;
}
