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

function sessionId() {
    try {
        let id = sessionStorage.getItem(SESSION_KEY);
        if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id); }
        return id;
    } catch { return null; }
}

function impressionSeen(key) {
    try {
        const seen = new Set(JSON.parse(sessionStorage.getItem(IMPRESSION_KEY) || "[]"));
        if (seen.has(key)) return true;
        seen.add(key);
        sessionStorage.setItem(IMPRESSION_KEY, JSON.stringify([...seen].slice(-2000)));
    } catch { /* sessionStorage can be unavailable in privacy mode */ }
    return false;
}

/** Best-effort event insert. The shopping interaction must never await this. */
export async function trackProductEvent(product, eventType, extra = {}) {
    const weight = EVENT_WEIGHTS[eventType];
    if (!product || weight === undefined) return null;
    const id = productKey(product);
    if (eventType === "impression" && impressionSeen(`${id}:impression`)) return null;
    try {
        const { client, user } = await account();
        const row = {
            user_id: user.id,
            chat_turn_id: extra.chatTurnId || product.analytics_chat_turn_id || window.projectVAnalyticsChatTurnId || null,
            event_type: eventType,
            event_weight: weight,
            session_id: sessionId(),
            category: extra.category || product.category || null,
            product_data: product
        };
        let { error } = await client.from("user_events").insert(row);
        // Older hosted user_events tables may not yet have the optional
        // context columns. Preserve the behavioral event with its required
        // fields while the schema is being migrated.
        if (error && (error.code === "PGRST204" || /column|schema cache/i.test(error.message || ""))) {
            const minimal = (({ user_id, chat_turn_id, event_type, event_weight }) => ({ user_id, chat_turn_id, event_type, event_weight }))(row);
            ({ error } = await client.from("user_events").insert(minimal));
        }
        if (error) throw error;
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
    }
}
