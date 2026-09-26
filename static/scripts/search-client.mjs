// Both providers run on Flask; browser requests never contain API credentials.
// Ranked results are handed to onResults as soon as they exist; the slower AI Top
// picks are fetched afterwards and never block (or fail) the search.
export async function searchProducts(utterance, { signal, fetchImpl = fetch, onIntent = () => {}, onResults = () => {} } = {}) {
    async function post(path, body) {
        const response = await fetchImpl(path, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body), signal
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Product search failed. Please try again.");
        return data;
    }
    const intent = await post("/api/intent", { utterance });
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    onIntent(intent);
    const ranked = await post("/api/search", { intent, utterance, picks: false });
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    onResults({ intent, ...ranked });
    if (!ranked.results?.length) return { intent, ...ranked };
    try {
        const picked = await post("/api/picks", { result: ranked, intent, utterance });
        return { intent, ...picked };
    } catch (error) {
        if (error.name === "AbortError") throw error;
        return { intent, ...ranked };
    }
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
