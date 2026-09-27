export const TERMINAL = new Set(["succeeded", "blocked", "failed", "cancelled", "refunded"]);
export const statusLabel = status => ({starting: "Starting checkout", queued: "Queued", running: "Agent is shopping", awaiting_input: "Needs your attention", succeeded: "Purchased", blocked: "Checkout blocked", failed: "Checkout failed", cancelled: "Checkout cancelled", refunded: "Refunded", unknown: "Confirmation needed"}[status] || status?.replaceAll("_", " ") || "Pending");
export const money = (amount, currency = "USD") => new Intl.NumberFormat("en-US", {style: "currency", currency}).format(Number(amount));
export function safeUrl(value) { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; } }
export function accountReady() {
    if (window.projectVAccount) return Promise.resolve(window.projectVAccount);
    return new Promise(resolve => window.addEventListener("projectv:account", () => resolve(window.projectVAccount), {once: true}));
}
export async function session() {
    const account = await accountReady();
    const {data, error} = await account.client.auth.getSession();
    if (error || !data.session) throw new Error("Please sign in again.");
    return data.session;
}
export async function api(path, {method = "GET", body, signal} = {}) {
    const auth = await session();
    const response = await fetch(`/api/commerce${path}`, {method, signal, cache: "no-store", headers: {
        Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json"
    }, ...(body ? {body: JSON.stringify(body)} : {})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || "The request could not be confirmed. Refresh Orders before retrying.");
        error.status = response.status; error.code = data.code; throw error;
    }
    return data;
}
export async function cardApi(config, path, method = "GET", body) {
    const auth = await session();
    const response = await fetch(`https://www.crossmint.com/api/unstable${path}`, {method, cache: "no-store", headers: {
        "X-API-KEY": config.clientKey, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json"
    }, ...(body ? {body: JSON.stringify(body)} : {})});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? "Crossmint could not authorize your account. Check the production client key, allowed origin and Supabase JWT configuration."
        : `Card authorization could not finish (${response.status}). Please try again or choose another card.`);
    return result;
}
