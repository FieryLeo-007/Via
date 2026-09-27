import "./site-interactions.js";
import {api, accountReady, money, statusLabel, TERMINAL, safeUrl} from "./commerce-client.mjs";

const list = document.getElementById("orders-list");
const empty = document.getElementById("orders-empty");
const search = document.getElementById("order-search");
const sort = document.getElementById("order-sort");
const notice = document.getElementById("orders-notice");
let orders = [], filter = "all", stopped = false, timer;
const pending = new Set();
const linkedOrder = new URLSearchParams(window.location.search).get("order");
let initialRender = true;
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const receipt = order => order.result?.purchase?.receipt;
const amount = order => receipt(order)?.total?.amount;
const label = order => order.is_demo ? ({succeeded: "Demo purchased", cancelled: "Demo cancelled", refunded: "Demo refunded"}[order.status] || `Demo · ${statusLabel(order.status)}`) : statusLabel(order.status);
const matchesFilter = (order, selected) => selected === "all" || (selected === "demo" ? order.is_demo : selected === "active" ? !TERMINAL.has(order.status) : order.status === selected);
function showNotice(text) {notice.hidden = false; document.getElementById("receipt-notice").textContent = text;}
function render() {
    const expanded = new Set([...list.querySelectorAll("details[open]")].map(el => el.dataset.id));
    if (initialRender && linkedOrder) expanded.add(linkedOrder);
    initialRender = false;
    const query = search.value.trim().toLowerCase();
    const rows = orders.filter(order => matchesFilter(order, filter) && `${order.id} ${order.item.title} ${(order.result?.items || []).map(item => item.title).join(" ")} ${label(order)} ${receipt(order)?.merchantOrderId || ""}`.toLowerCase().includes(query));
    rows.sort((a,b) => sort.value === "highest" ? Number(amount(b) || 0) - Number(amount(a) || 0) : (sort.value === "oldest" ? 1 : -1) * (new Date(a.created_at) - new Date(b.created_at)));
    list.innerHTML = rows.map(order => {
        const paid = amount(order), store = safeUrl(order.item.product_page_url), image = safeUrl(order.item.image_url);
        const request = order.service_request, disabled = pending.has(order.id) ? "disabled" : "";
        return `<details class="order-card commerce-live-order" data-id="${escape(order.id)}" ${expanded.has(order.id) ? "open" : ""}>
        <summary class="order-row"><span class="order-id-column">#${escape(order.id.slice(0,8))}${order.is_demo ? '<b class="order-demo-badge">DEMO</b>' : ""}</span><span class="order-thumbs">${image ? `<span class="order-thumb"><img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : "✦"}</span>
        <span class="order-identity"><small>Order ${escape(order.id.slice(0,8))} ${order.is_demo ? '<b class="order-demo-badge">DEMO</b>' : ""}</small><strong>${escape(order.item.title)}</strong><span>Quantity ${order.item.quantity} · ${escape(order.item.store_name)}</span></span>
        <span class="order-date"><small>Started</small><time>${new Date(order.created_at).toLocaleDateString()}</time></span>
        <span class="order-total"><small>${order.is_demo ? "Demo total" : paid != null ? "Purchase total" : "Spending limit"}</small><strong>${money(paid ?? order.max_cost, receipt(order)?.total?.currency || "USD")}</strong></span>
        <span class="order-state"><span class="status-pill">${escape(label(order))}</span>${order.cancel_requested && !TERMINAL.has(order.status) ? "<small>Cancellation pending</small>" : ""}</span><span class="order-chevron"><span class="details-label">View details</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 10 4 4 4-4"/></svg></span></summary>
        <div class="commerce-live-details"><p class="commerce-order-summary">${escape(order.result?.summary || (typeof order.reason === "string" ? order.reason : "Open checkout for agent updates and any requested information."))}</p>
        ${receipt(order)?.merchantOrderId ? `<p class="commerce-order-meta">${order.is_demo ? "Demo reference" : "Merchant order"}: ${escape(receipt(order).merchantOrderId)}</p>` : ""}
        ${order.is_demo ? `<div class="order-demo-items">${(order.result.items || []).map(item => `<div><span>${escape(item.title)} × ${item.quantity}</span><strong>${money(item.price_cents * item.quantity / 100)}</strong></div>`).join("")}<div><span>Simulated shipping · ${escape(order.result.shipping)}</span><strong>${money(order.result.shipping_cents / 100)}</strong></div><div><span>Estimated tax (8%)</span><strong>${money(order.result.tax_cents / 100)}</strong></div></div>` : ""}
        ${paid == null && order.status === "succeeded" ? "<p>Purchase confirmed; the merchant did not return a receipt total. Your spending limit is not a receipt.</p>" : ""}
        <div class="commerce-order-actions">${!order.is_demo ? `<a class="commerce-link" href="/checkout/${escape(order.id)}">${order.status === "awaiting_input" ? "Continue checkout" : "View checkout"}</a>` : ""}
        ${!TERMINAL.has(order.status) && order.provider_run_id ? `<button class="commerce-button secondary" data-action="cancel" ${order.cancel_requested ? "disabled" : ""}>Cancel checkout</button>` : ""}
        ${order.status === "succeeded" ? `<button class="commerce-button secondary" data-action="cancellation" ${disabled}>${order.is_demo ? "Cancel demo order" : "Request cancellation"}</button><button class="commerce-button secondary" data-action="refund" ${disabled}>${order.is_demo ? "Refund demo order" : "Request refund"}</button>` : ""}
        ${order.is_demo || order.status === "succeeded" ? '<button class="commerce-button secondary" data-action="receipt">Download order record</button>' : ""}</div>
        ${order.is_demo ? '<p class="commerce-order-meta">Demo only. Cancellation and refunds update this saved simulation; no merchant is contacted and no real money moves.</p>' : order.status === "succeeded" ? `<p class="commerce-order-meta">Cancellation and refunds follow the merchant’s policy. ${store ? `<a href="${escape(store)}" target="_blank" rel="noopener noreferrer">Open merchant ↗</a>` : ""}</p>` : ""}
        ${request ? order.is_demo ? `<p class="commerce-note">${request.kind === "refund" ? `Demo refund of ${money(request.amount)} completed` : "Demo order cancelled"}. Saved ${new Date(request.completed_at).toLocaleString()}. No real payment was affected.</p>` : `<p class="commerce-note">${request.kind === "refund" ? "Refund" : "Cancellation"} request saved. <strong>Action needed:</strong> submit it with the merchant. No refund or cancellation has been confirmed.</p>` : ""}</div></details>`;
    }).join("");
    empty.hidden = rows.length > 0;
    document.getElementById("order-count").textContent = `${rows.length} of ${orders.length} orders`;
    const spend = orders.filter(o => !o.is_demo && o.status === "succeeded" && receipt(o)?.total?.currency === "USD").reduce((total,o) => total + Number(amount(o) || 0),0);
    document.querySelector('[data-metric="spend"]').textContent = money(spend);
    document.querySelector('[data-metric="active"]').textContent = orders.filter(o => !TERMINAL.has(o.status)).length;
    document.querySelector('[data-metric="completed"]').textContent = orders.filter(o => o.status === "succeeded").length;
    document.querySelectorAll(".filter-chip").forEach(chip => {chip.querySelector("span").textContent = orders.filter(o => matchesFilter(o, chip.dataset.filter)).length;});
}
async function load() {
    const data = await api("/orders"); orders = data.orders; render();
    // Reconcile only a bounded set per round, with rotation for larger histories.
    return orders.filter(o => !o.is_demo && !TERMINAL.has(o.status) && o.provider_run_id);
}
let offset = 0;
async function poll() {
    try {
        const active = await load();
        const batch = [...active.slice(offset), ...active.slice(0,offset)].slice(0,4);
        await Promise.allSettled(batch.map(o => api(`/orders/${o.id}`)));
        offset = active.length ? (offset + 4) % active.length : 0;
        if (batch.length) await load();
    } catch(e) {showNotice(e.message);}
    if (!stopped) timer = setTimeout(poll, 12000);
}
list.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const order = orders.find(o => o.id === button.closest("details").dataset.id); if (!order) return;
    const action = button.dataset.action;
    if (pending.has(order.id)) return;
    if (action === "receipt") {
        const details = receipt(order);
        const text = [order.is_demo ? "ProjectV DEMO order record — simulation only" : "ProjectV order record", `Order: ${order.id}`, `${order.is_demo ? "Demo reference" : "Merchant order"}: ${details?.merchantOrderId || "Not supplied"}`, order.item.title, `Quantity: ${order.item.quantity}`, `Status: ${label(order)}`, ...(order.result?.items || []).map(item => `${item.title} × ${item.quantity} — ${money(item.price_cents * item.quantity / 100)}`), details ? `${order.is_demo ? "Demo" : "Purchase"} total: ${money(details.total.amount, details.total.currency)}` : "Receipt total not supplied by merchant.", order.is_demo && order.service_request ? `Simulated ${order.service_request.kind}: ${order.service_request.completed_at}` : "", "", order.is_demo ? "No real payment, merchant order or monetary refund. Not a tax invoice." : "This is an order record, not a merchant tax invoice."].join("\n");
        const url = URL.createObjectURL(new Blob([text], {type:"text/plain"})); const link = document.createElement("a"); link.href = url; link.download = `ProjectV-${order.id}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); return;
    }
    if (action === "cancel" && !confirm("Stop this checkout? An order already placed must be cancelled with the merchant.")) return;
    if (order.is_demo && !confirm(action === "refund" ? `Simulate a full refund of ${money(amount(order))}? This updates your saved demo order. No real money moves.` : "Cancel this saved demo order? No real merchant order or payment is affected.")) return;
    pending.add(order.id); render();
    try {
        const result = action === "cancel" ? await api(`/orders/${order.id}/cancel`, {method:"POST"}) : await api(`/orders/${order.id}/service-request`, {method:"POST", body:{kind:action}});
        orders = orders.map(row => row.id === result.order.id ? result.order : row);
        showNotice(result.message);
    } catch(e) {showNotice(e.message);}
    finally {pending.delete(order.id); render();}
});
search.addEventListener("input", render); sort.addEventListener("change", render);
document.querySelectorAll(".filter-chip").forEach(chip => chip.addEventListener("click", () => {filter = chip.dataset.filter; document.querySelectorAll(".filter-chip").forEach(c => {c.classList.toggle("is-active", c === chip); c.setAttribute("aria-pressed", String(c === chip));}); render();}));
const chips = [...document.querySelectorAll(".filter-chip")];
chips.forEach((chip, index) => chip.addEventListener("keydown", event => {
    const next = {ArrowRight: (index + 1) % chips.length, ArrowLeft: (index + chips.length - 1) % chips.length, Home: 0, End: chips.length - 1}[event.key];
    if (next !== undefined) {event.preventDefault(); chips[next].focus(); chips[next].click();}
}));
document.getElementById("clear-filters").addEventListener("click", () => {search.value=""; sort.value="newest"; document.querySelector('[data-filter="all"]').click();});
document.getElementById("dismiss-notice").addEventListener("click", () => notice.hidden = true);
window.addEventListener("pagehide", () => {stopped = true; clearTimeout(timer);});
window.addEventListener("pageshow", event => {if (event.persisted) {stopped = false; void poll();}});
void accountReady().then(poll);
