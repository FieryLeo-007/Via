// Compact snapshots keep account metadata and large product payloads out of prompts.
export function conversationHistory(turns) {
    return turns.slice(-20).map(turn => ({
        query: turn.query.slice(0, 2000),
        intent: turn.intent || null,
        status: turn.status || "complete",
        products: (turn.products || []).slice(0, 20).map(product => ({
            title: product.title.slice(0, 500),
            brand: product.brand ? product.brand.slice(0, 200) : null,
            price_cents: product.price_cents,
            top_pick_rank: product.top_pick_rank || null
        }))
    }));
}

// The UI tags products with browser-only fields (analytics); Flask's schemas forbid extras.
export function serverProduct({ analytics_chat_turn_id, ...product }) {
    return product;
}

// POST JSON to a discovery endpoint and surface Flask's error message on failure.
export async function postJson(path, body, { signal, fetchImpl = fetch } = {}) {
    const response = await fetchImpl(path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Product search failed. Please try again.");
    return data;
}

// Both providers run on Flask; browser requests never contain API credentials.
// Ranked results are handed to onResults as soon as they exist; the slower AI Top
// picks are fetched afterwards and never block (or fail) the search.
export async function searchProducts(utterance, { history = [], signal, fetchImpl = fetch, onIntent = () => {}, onResults = () => {} } = {}) {
    const post = (path, body) => postJson(path, body, { signal, fetchImpl });
    const context = history.length ? { history: conversationHistory(history) } : {};
    let profile_context = null;
    try {
        const { getUserProfileContext } = await import('./account-store.mjs');
        profile_context = await getUserProfileContext();
    } catch { /* Search remains useful when profile data is unavailable. */ }
    const profile = profile_context ? { profile_context } : {};
    const intent = await post("/api/intent", { utterance, ...context, ...profile });
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    onIntent(intent);
    const ranked = await post("/api/search", { intent, utterance, picks: false, ...context, ...profile });
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    onResults({ intent, ...ranked });
    if (!ranked.results?.length) return { intent, ...ranked };
    try {
        const picked = await post("/api/picks", { result: { ...ranked, results: ranked.results.map(serverProduct) }, intent, utterance, ...context, ...profile });
        return { intent, ...picked };
    } catch (error) {
        if (error.name === "AbortError") throw error;
        return { intent, ...ranked };
    }
}

// The AI comparison of 2–4 products the shopper selected from one search turn.
// Flask always answers with a comparison (AI or rules), so errors here are transport errors.
export async function compareProducts(products, { intent = null, utterance = null, history = [], signal, fetchImpl = fetch } = {}) {
    const context = history.length ? { history: conversationHistory(history) } : {};
    const headers = { "Content-Type": "application/json" };
    try {
        const sessionResult = typeof window !== "undefined"
            ? await window.projectVAccount?.client?.auth.getSession()
            : null;
        const token = sessionResult?.data?.session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
        // The server falls back to objective comparison when account data is unavailable.
    }
    let profile_context = null;
    try {
        const { getUserProfileContext } = await import('./account-store.mjs');
        profile_context = await getUserProfileContext();
    } catch { /* Objective comparison remains available without a profile. */ }
    const response = await fetchImpl("/api/compare", {
        method: "POST", headers,
        body: JSON.stringify({ products: products.map(serverProduct), intent, utterance, ...context, ...(profile_context ? { profile_context } : {}) }), signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Comparison failed. Please try again.");
    return data;
}

export function safeProductUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function retailerProductUrl(value) {
    const safe = safeProductUrl(value);
    if (!safe) return null;
    const url = new URL(safe);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (/(^|\.)google\.[a-z.]+$/.test(host) || host.endsWith("googleadservices.com") || host.endsWith("doubleclick.net")) return null;
    return url.pathname !== "/" ? safe : null;
}
