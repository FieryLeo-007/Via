import "./site-interactions.js";
import {api, accountReady, money, statusLabel, TERMINAL, safeUrl} from "./commerce-client.mjs";
import {reconcileCartOrders} from "./cart-store.mjs";

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
        const paid = amount(order), store = safeUrl(order.item.product_page_url);
        const items = order.result?.items?.length ? order.result.items : [order.item];
        const image = safeUrl(items[0]?.image_url || order.item.image_url);
        const request = order.service_request, disabled = pending.has(order.id) ? "disabled" : "";
        const currency = receipt(order)?.total?.currency || "USD";
        const totalLabel = order.is_demo ? "Demo total" : paid != null ? "Purchase total" : "Spending limit";
        const date = new Date(order.created_at).toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric"});
        const status = order.status === "succeeded" ? "success" : order.status === "refunded" ? "refunded" : TERMINAL.has(order.status) ? "closed" : "active";
        return `<details class="order-card commerce-live-order" data-id="${escape(order.id)}" ${expanded.has(order.id) ? "open" : ""}>
        <summary class="order-row">
            <span class="order-card-heading"><span class="order-card-reference"><span class="order-id-column">Order #${escape(order.id.slice(0,8))}</span>${order.is_demo ? '<b class="order-demo-badge">DEMO</b>' : ""}<span class="order-placed-date">${date}</span></span><span class="status-pill order-status-${status}"><i aria-hidden="true"></i>${escape(label(order))}</span></span>
            <span class="order-cover">${image ? `<img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span aria-hidden="true">◇</span>'}</span>
            <span class="order-card-product"><strong>${escape(order.item.title)}</strong><span>${escape(order.item.store_name || "Online store")}<i aria-hidden="true">·</i>${order.item.quantity} ${order.item.quantity === 1 ? "item" : "items"}${order.cancel_requested && !TERMINAL.has(order.status) ? " · Cancellation pending" : ""}</span></span>
            <span class="order-card-amount"><small>${totalLabel}</small><strong>${money(paid ?? order.max_cost, currency)}</strong></span>
            <span class="order-card-toggle"><span class="sr-only">View order details</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 10 4 4 4-4"/></svg></span>
        </summary>
        <div class="order-expanded">
            <div class="order-detail-grid"><section class="order-products-section"><h3>In this order <span>${items.length}</span></h3><div class="order-product-list">${items.map(item => {
                const thumbnail = safeUrl(item.image_url);
                return `<div class="order-product-line"><span class="order-line-image">${thumbnail ? `<img src="${escape(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span aria-hidden="true">◇</span>'}</span><div><strong>${escape(item.title)}</strong><span>${escape(item.store_name || order.item.store_name || "Online store")} · Qty ${item.quantity}</span></div>${Number.isFinite(item.price_cents) ? `<b>${money(item.price_cents * item.quantity / 100, currency)}</b>` : ""}</div>`;
            }).join("")}</div><p class="order-reference-note">${receipt(order)?.merchantOrderId ? `${order.is_demo ? "Demo reference" : "Merchant order"} <strong>${escape(receipt(order).merchantOrderId)}</strong>` : "Your order details are saved here."}</p></section>
            <section class="order-payment-section"><h3>Order summary</h3><dl>${order.is_demo ? `<div><dt>Subtotal</dt><dd>${money(items.reduce((sum, item) => sum + (item.price_cents || 0) * item.quantity, 0) / 100)}</dd></div><div><dt>${order.result.shipping === "express" ? "Express" : "Standard"} shipping <small>simulated</small></dt><dd>${money((order.result.shipping_cents || 0) / 100)}</dd></div><div><dt>Estimated tax <small>8%</small></dt><dd>${money((order.result.tax_cents || 0) / 100)}</dd></div>` : ""}<div class="order-payment-total"><dt>${totalLabel}</dt><dd>${money(paid ?? order.max_cost, currency)}</dd></div></dl><p>${order.is_demo ? "A simulated purchase. No real payment was made." : paid == null && order.status === "succeeded" ? "The merchant confirmed the purchase but did not supply a receipt total." : escape(order.result?.summary || "Your checkout details are available below.")}</p></section></div>
            ${request ? `<div class="order-service-note"><span aria-hidden="true">✓</span><p>${order.is_demo ? `${request.kind === "refund" ? `Demo refund of ${money(request.amount)} completed` : "Demo order cancelled"}. <span>${new Date(request.completed_at).toLocaleString()} · No real payment was affected.</span>` : `${request.kind === "refund" ? "Refund" : "Cancellation"} request saved. <span>Submit the request with the merchant to complete it. It has not been confirmed yet.</span>`}</p></div>` : ""}
            <div class="order-card-footer"><p>${order.is_demo ? "Demo order · No merchant was contacted." : order.status === "succeeded" ? `Returns follow the merchant’s policy.${store ? ` <a href="${escape(store)}" target="_blank" rel="noopener noreferrer">Visit merchant ↗</a>` : ""}` : escape(typeof order.reason === "string" ? order.reason : "View checkout for the latest agent updates.")}</p><div class="order-card-actions">
            ${!order.is_demo ? `<a class="order-button order-button-primary" href="/checkout/${escape(order.id)}">${order.status === "awaiting_input" ? "Continue checkout" : "View checkout"}</a>` : ""}
            ${!TERMINAL.has(order.status) && order.provider_run_id ? `<button class="order-button order-button-danger" data-action="cancel" ${order.cancel_requested || pending.has(order.id) ? "disabled" : ""}>Cancel checkout</button>` : ""}
            ${order.status === "succeeded" ? `<button class="order-button order-button-danger" data-action="cancellation" ${disabled}>${order.is_demo ? "Cancel demo order" : "Request cancellation"}</button><button class="order-button" data-action="refund" ${disabled}>${order.is_demo ? "Refund demo order" : "Request refund"}</button>` : ""}
            ${order.is_demo || order.status === "succeeded" ? '<button class="order-button" data-action="receipt">Download record <span aria-hidden="true">↓</span></button>' : ""}</div></div>
        </div></details>`;
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
    const data = await api("/orders"); orders = data.orders;
    render();
    try { reconcileCartOrders(orders); }
    catch { showNotice("Your orders are saved, but your cart could not update. Enable browser storage and refresh to retry."); }
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
        const text = [order.is_demo ? "VIA DEMO order record — simulation only" : "VIA order record", `Order: ${order.id}`, `${order.is_demo ? "Demo reference" : "Merchant order"}: ${details?.merchantOrderId || "Not supplied"}`, order.item.title, `Quantity: ${order.item.quantity}`, `Status: ${label(order)}`, ...(order.result?.items || []).map(item => `${item.title} × ${item.quantity} — ${money(item.price_cents * item.quantity / 100)}`), details ? `${order.is_demo ? "Demo" : "Purchase"} total: ${money(details.total.amount, details.total.currency)}` : "Receipt total not supplied by merchant.", order.is_demo && order.service_request ? `Simulated ${order.service_request.kind}: ${order.service_request.completed_at}` : "", "", order.is_demo ? "No real payment, merchant order or monetary refund. Not a tax invoice." : "This is an order record, not a merchant tax invoice."].join("\n");
        const url = URL.createObjectURL(new Blob([text], {type:"text/plain"})); const link = document.createElement("a"); link.href = url; link.download = `VIA-${order.id}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); return;
    }
    if (["cancel", "cancellation", "refund"].includes(action)) openOrderAction(order, action, button);
});

const dialog = document.getElementById("order-action-dialog");
const actionForm = document.getElementById("order-action-form");
const confirmButton = document.getElementById("order-action-confirm");
const keepButton = document.getElementById("order-action-keep");
const closeButton = document.getElementById("order-action-close");
const actionError = document.getElementById("order-action-error");
let selectedAction = null, submitting = false;
function actionAllowed(order, action) {
    return order && (action === "cancel" ? !TERMINAL.has(order.status) && order.provider_run_id && !order.cancel_requested : order.status === "succeeded");
}
function openOrderAction(order, action, trigger) {
    if (dialog.open || !actionAllowed(order, action)) return;
    selectedAction = {id: order.id, action, trigger};
    const refund = action === "refund";
    const title = action === "cancel" ? "Stop this checkout?" : order.is_demo ? refund ? "Refund this demo order?" : "Cancel this demo order?" : refund ? "Request a refund?" : "Request a cancellation?";
    document.getElementById("order-action-title").textContent = title;
    document.getElementById("order-action-description").textContent = order.is_demo
        ? refund ? "This marks your saved demo order as refunded. No real money moves." : "This cancels your saved demo order. No real payment or merchant order is affected."
        : action === "cancel" ? "We’ll ask the shopping agent to stop. If the order has already been placed, you’ll need to cancel with the merchant."
        : "We’ll save your request here. You’ll still need to submit it with the merchant, whose policy determines the outcome.";
    document.getElementById("order-action-product").textContent = order.item.title;
    document.getElementById("order-action-reference").textContent = `Order #${order.id.slice(0,8)} · ${order.item.quantity} ${order.item.quantity === 1 ? "item" : "items"}`;
    document.getElementById("order-action-amount").textContent = `${amount(order) == null ? "Spending limit" : order.is_demo ? "Demo total" : "Purchase total"} ${money(amount(order) ?? order.max_cost, receipt(order)?.total?.currency || "USD")}`;
    document.getElementById("order-action-symbol").textContent = refund ? "↶" : "×";
    confirmButton.textContent = action === "cancel" ? "Stop checkout" : order.is_demo ? refund ? "Refund demo order" : "Cancel demo order" : "Save request";
    confirmButton.dataset.label = confirmButton.textContent;
    dialog.dataset.kind = refund ? "refund" : "cancel";
    actionError.hidden = true;
    dialog.showModal();
    keepButton.focus();
}
function dismissOrderAction() { if (!submitting) dialog.close(); }
keepButton.addEventListener("click", dismissOrderAction);
closeButton.addEventListener("click", dismissOrderAction);
dialog.addEventListener("click", event => { if (event.target === dialog) dismissOrderAction(); });
dialog.addEventListener("cancel", event => { if (submitting) event.preventDefault(); });
dialog.addEventListener("close", () => {
    const previous = selectedAction;
    selectedAction = null;
    if (!previous) return;
    const card = [...list.querySelectorAll("details")].find(card => card.dataset.id === previous.id);
    const target = card?.querySelector(`[data-action="${previous.action}"]:not(:disabled)`) || card?.querySelector("summary") || search;
    target.focus();
});
actionForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting || !selectedAction) return;
    const {id, action} = selectedAction;
    if (!actionAllowed(orders.find(order => order.id === id), action)) {
        actionError.textContent = "This order has changed. Close this dialog and review its latest status.";
        actionError.hidden = false;
        return;
    }
    submitting = true;
    pending.add(id);
    confirmButton.disabled = keepButton.disabled = closeButton.disabled = true;
    confirmButton.textContent = "Processing…";
    dialog.setAttribute("aria-busy", "true");
    actionError.hidden = true;
    render();
    let succeeded = false;
    try {
        const result = action === "cancel" ? await api(`/orders/${id}/cancel`, {method:"POST"}) : await api(`/orders/${id}/service-request`, {method:"POST", body:{kind:action}});
        orders = orders.map(row => row.id === result.order.id ? result.order : row);
        showNotice(result.message || "Your order has been updated.");
        succeeded = true;
    } catch(e) {
        actionError.textContent = e.message;
        actionError.hidden = false;
    } finally {
        submitting = false;
        pending.delete(id);
        confirmButton.disabled = keepButton.disabled = closeButton.disabled = false;
        confirmButton.textContent = confirmButton.dataset.label;
        dialog.setAttribute("aria-busy", "false");
        render();
        if (succeeded) dialog.close();
    }
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
