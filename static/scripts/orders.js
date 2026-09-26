import { gsap } from "gsap";

const image = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=180&q=80`;
const orders = [
    { id: "PV-84291", status: "shipped", statusLabel: "Shipped", date: "Sep 24, 2026", timestamp: 20260924, total: 284.98, eta: "Expected Sep 27", items: [
        { name: "Studio wireless headphones", detail: "Forest green · 1", price: 189.99, image: image("photo-1505740420928-5e560c06d30e") },
        { name: "Travel coffee press", detail: "Matte black · 1", price: 94.99, image: image("photo-1495474472287-4d71bcdd2085") }
    ], timeline: [["Order confirmed", "Sep 24 · 9:18 AM"], ["Shipped", "Sep 25 · 4:42 PM"], ["Out for delivery", "Expected Sep 27"]] },
    { id: "PV-84037", status: "processing", statusLabel: "Processing", date: "Sep 22, 2026", timestamp: 20260922, total: 168.00, eta: "Preparing to ship", items: [
        { name: "Cloud-knit throw blanket", detail: "Oatmeal · Qty 2 · $56.00 each", quantity: 2, price: 56.00, image: image("photo-1580301762395-21ce84d00bc6") },
        { name: "Portable table lamp", detail: "Warm white · 1", price: 56.00, image: image("photo-1507473885765-e6ed057f782c") }
    ], timeline: [["Order confirmed", "Sep 22 · 2:04 PM"], ["Processing", "Items are being prepared"], ["Shipped", "Pending"]] },
    { id: "PV-82714", status: "delivered", statusLabel: "Delivered", date: "Sep 12, 2026", timestamp: 20260912, total: 699.00, eta: "Delivered Sep 15", items: [
        { name: "Compact mirrorless camera", detail: "Graphite · 1", price: 699.00, image: image("photo-1516035069371-29a1b244cc32") }
    ], timeline: [["Order confirmed", "Sep 12 · 11:30 AM"], ["Shipped", "Sep 13 · 8:12 AM"], ["Delivered", "Sep 15 · 1:46 PM"]] },
    { id: "PV-81952", status: "delivered", statusLabel: "Delivered", date: "Aug 28, 2026", timestamp: 20260828, total: 96.38, eta: "Delivered Aug 31", items: [
        { name: "Matte insulated bottle", detail: "Sage · 1", price: 26.00, image: image("photo-1602143407151-7111542de6e8") },
        { name: "Everyday crossbody bag", detail: "Stone · 1", price: 70.38, image: image("photo-1594223274512-ad4803739b7c") }
    ], timeline: [["Order confirmed", "Aug 28 · 3:12 PM"], ["Shipped", "Aug 29 · 10:02 AM"], ["Delivered", "Aug 31 · 4:20 PM"]] }
].map(order => ({ ...order, items: order.items.map(item => ({ quantity: 1, ...item })), itemCount: order.items.reduce((sum, item) => sum + (item.quantity || 1), 0), total: order.items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0) }));

const list = document.getElementById("orders-list");
const count = document.getElementById("order-count");
const empty = document.getElementById("orders-empty");
const search = document.getElementById("order-search");
const sort = document.getElementById("order-sort");
let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let hoverEnabled = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
let activeFilter = "all";
let activeRows = [];
let disposed = false;
let renderContext = null;
let media = null;
let initialized = false;
const main = document.querySelector(".orders-main");
const downloadUrls = new Set();
const pageEvents = new AbortController();

const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function orderTemplate(order) {
    const thumbs = order.items.slice(0, 3).map(item => `<span class="order-thumb"><img src="${escapeHtml(item.image)}" alt="" width="58" height="58" loading="lazy" referrerpolicy="no-referrer"></span>`).join("");
    const receipt = order.items.map(item => `<li><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></span><b>${money(item.price * item.quantity)}</b></li>`).join("");
    const timeline = order.timeline.map((step, index) => `<li class="${index < order.timeline.length - 1 || order.status === "delivered" ? "is-complete" : ""}"><span class="timeline-dot"></span><div><strong>${escapeHtml(step[0])}</strong><small>${escapeHtml(step[1])}</small></div></li>`).join("");
    const primaryAction = order.status === "delivered" ? `<a class="order-action-primary" href="/dashboard?query=${encodeURIComponent(order.items[0].name)}">Shop again<span aria-hidden="true">↗</span></a>` : `<button type="button" class="order-action-primary" data-action="track">View tracking<span aria-hidden="true">↗</span></button>`;
    const date = String(order.timestamp).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    return `<article class="order-card" data-status="${order.status}" data-id="${order.id}" style="--spot-x:50%;--spot-y:50%">
        <button class="order-row" id="trigger-${order.id}" type="button" aria-expanded="false" aria-controls="details-${order.id}">
            <span class="order-thumbs">${thumbs}</span>
            <span class="order-identity"><small>Order ${order.id}</small><strong>${escapeHtml(order.items[0].name)}${order.items.length > 1 ? ` <em>+${order.items.length - 1} more</em>` : ""}</strong><span>${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}</span></span>
            <span class="order-date"><small>Ordered</small><time datetime="${date}">${order.date}</time></span>
            <span class="order-total"><small>Total</small><strong>${money(order.total)}</strong></span>
            <span class="order-state"><span class="status-pill status-${order.status}"><i></i>${order.statusLabel}</span><small>${order.eta}</small></span>
            <span class="order-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 10 4 4 4-4"/></svg></span>
        </button>
        <div class="order-details" id="details-${order.id}" role="region" aria-labelledby="trigger-${order.id}" aria-hidden="true" hidden inert><div class="order-details-inner">
            <section class="tracking" tabindex="-1" aria-label="Tracking for order ${order.id}"><h3 class="detail-kicker">Tracking</h3><ol>${timeline}</ol></section>
            <section class="receipt"><div><h3 class="detail-kicker">Receipt</h3><span>${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}</span></div><ul>${receipt}</ul><div class="receipt-total"><span>Total paid</span><strong>${money(order.total)}</strong></div></section>
            <div class="order-actions">${primaryAction}<button type="button" class="order-action-secondary" data-action="invoice">Download receipt<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg></button></div>
        </div></div>
    </article>`;
}

function cleanupRows() {
    renderContext?.revert();
    renderContext = null;
    activeRows.splice(0).forEach(cleanup => cleanup());
}

function setupRow(card) {
    const order = orders.find(item => item.id === card.dataset.id);
    const trigger = card.querySelector(".order-row");
    const details = card.querySelector(".order-details");
    const inner = card.querySelector(".order-details-inner");
    const rowEvents = new AbortController();
    const rowContext = gsap.context(() => {}, card);
    let accordion;
    rowContext.add("toggle", () => {
        const opening = trigger.getAttribute("aria-expanded") !== "true";
        const startHeight = details.hidden ? 0 : details.getBoundingClientRect().height;
        accordion?.kill();
        trigger.setAttribute("aria-expanded", String(opening));
        details.setAttribute("aria-hidden", String(!opening));
        details.inert = !opening;
        card.classList.toggle("is-open", opening);
        if (!opening && details.contains(document.activeElement)) trigger.focus();
        details.hidden = false;
        if (reduceMotion) { details.style.height = opening ? "auto" : "0px"; details.hidden = !opening; return; }
        gsap.set(inner.children, { clearProps: "opacity,visibility,transform" });
        accordion = gsap.timeline({ onComplete: () => { details.hidden = !opening; details.style.height = opening ? "auto" : "0px"; } });
        accordion.fromTo(details, { height: startHeight }, { height: opening ? details.scrollHeight : 0, duration: opening ? .42 : .3, ease: "power3.inOut" });
        if (opening) accordion.fromTo(inner.children, { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .28, stagger: .04, ease: "power3.out", clearProps: "opacity,visibility,transform" }, "-=.22");
    });
    trigger.addEventListener("click", rowContext.toggle, { signal: rowEvents.signal });
    card.querySelector('[data-action="track"]')?.addEventListener("click", () => {
        const tracking = card.querySelector(".tracking");
        tracking.focus({ preventScroll: true });
        tracking.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "center" });
        document.getElementById("live-status").textContent = `${order.id}: ${order.eta}.`;
    }, { signal: rowEvents.signal });
    card.querySelector('[data-action="invoice"]').addEventListener("click", () => {
        const lines = ["ProjectV receipt", `Order ${order.id}`, `Ordered ${order.date}`, `Status: ${order.statusLabel}`, "", ...order.items.map(item => `${item.name} (${item.detail}) — ${item.quantity} × ${money(item.price)} = ${money(item.price * item.quantity)}`), "", `Total paid: ${money(order.total)}`];
        const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
        downloadUrls.add(url);
        const link = document.createElement("a");
        link.href = url;
        link.download = `ProjectV-${order.id}-receipt.txt`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
        document.getElementById("live-status").textContent = `Receipt downloaded for order ${order.id}.`;
    }, { signal: rowEvents.signal });
    if (!reduceMotion && hoverEnabled) rowContext.add(() => {
        const moveX = gsap.quickTo(card, "x", { duration: .35, ease: "power3.out" });
        const moveY = gsap.quickTo(card, "y", { duration: .35, ease: "power3.out" });
        const scale = gsap.quickTo(card, "scale", { duration: .3, ease: "power3.out" });
        card.addEventListener("pointermove", event => {
            if (event.pointerType === "touch") return;
            const rect = card.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            card.style.setProperty("--spot-x", `${x}px`);
            card.style.setProperty("--spot-y", `${y}px`);
            moveX((x / rect.width - .5) * 2);
            moveY((y / rect.height - .5) * 2);
        }, { signal: rowEvents.signal });
        card.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") scale(1.015); }, { signal: rowEvents.signal });
        card.addEventListener("pointerleave", () => { moveX(0); moveY(0); scale(1); }, { signal: rowEvents.signal });
    });
    activeRows.push(() => { rowEvents.abort(); accordion?.kill(); rowContext.revert(); });
}

function currentOrders() {
    const query = search.value.trim().toLowerCase();
    const filtered = orders.filter(order => (activeFilter === "all" || order.status === activeFilter) && (!query || `${order.id} ${order.statusLabel} ${order.items.map(item => item.name).join(" ")}`.toLowerCase().includes(query)));
    return filtered.sort((a, b) => sort.value === "oldest" ? a.timestamp - b.timestamp : sort.value === "highest" ? b.total - a.total : b.timestamp - a.timestamp);
}

function render({ animate = true } = {}) {
    cleanupRows();
    const visible = currentOrders();
    list.innerHTML = visible.map(orderTemplate).join("");
    list.querySelectorAll(".order-card").forEach(setupRow);
    empty.hidden = visible.length > 0;
    count.textContent = `${visible.length} ${visible.length === 1 ? "order" : "orders"}`;
    if (animate && !reduceMotion && visible.length) renderContext = gsap.context(() => {
        gsap.fromTo(list.children, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .48, stagger: .08, ease: "power3.out", clearProps: "opacity,visibility,transform" });
    }, list);
}

function initialize() {
    if (initialized || disposed || document.body.hidden) return;
    initialized = true;
    visibilityObserver.disconnect();
    const metrics = {
        spend: orders.reduce((sum, order) => sum + order.total, 0),
        active: orders.filter(order => order.status !== "delivered").length,
        completed: orders.filter(order => order.status === "delivered").length
    };
    document.querySelectorAll("[data-counter]").forEach(element => { element.dataset.counter = metrics[element.dataset.metric]; });
    document.querySelectorAll(".filter-chip").forEach(chip => { chip.querySelector("span").textContent = chip.dataset.filter === "all" ? orders.length : orders.filter(order => order.status === chip.dataset.filter).length; });
    document.querySelectorAll(".filter-chip").forEach(chip => chip.addEventListener("click", () => {
        activeFilter = chip.dataset.filter;
        document.querySelectorAll(".filter-chip").forEach(item => { const active = item === chip; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); });
        render();
    }, { signal: pageEvents.signal }));
    search.addEventListener("input", () => render({ animate: false }), { signal: pageEvents.signal });
    sort.addEventListener("change", () => render(), { signal: pageEvents.signal });
    document.getElementById("clear-filters").addEventListener("click", () => { activeFilter = "all"; search.value = ""; sort.value = "newest"; document.querySelectorAll(".filter-chip").forEach(item => { const active = item.dataset.filter === "all"; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); }); render(); search.focus(); }, { signal: pageEvents.signal });

    media = gsap.matchMedia();
    media.add({ reduce: "(prefers-reduced-motion: reduce)", standard: "(prefers-reduced-motion: no-preference)", hover: "(hover: hover) and (pointer: fine)" }, context => {
        reduceMotion = context.conditions.reduce;
        hoverEnabled = context.conditions.hover;
        render({ animate: !reduceMotion });
        if (!reduceMotion) {
            gsap.fromTo(".orders-heading, .summary-card, .orders-controls, .orders-list-heading", { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .52, stagger: .08, ease: "power3.out", clearProps: "opacity,visibility,transform" });
            document.querySelectorAll("[data-counter]").forEach(element => {
                const target = Number(element.dataset.counter);
                const state = { value: 0 };
                gsap.to(state, { value: target, duration: 1.1, delay: 0.22, ease: "power3.out", onUpdate: () => { element.textContent = element.dataset.format === "currency" ? money(state.value) : Math.round(state.value).toLocaleString(); } });
            });
        } else document.querySelectorAll("[data-counter]").forEach(element => { const target = Number(element.dataset.counter); element.textContent = element.dataset.format === "currency" ? money(target) : target.toLocaleString(); });
        return () => {
            cleanupRows();
            document.querySelectorAll("[data-counter]").forEach(element => { const target = Number(element.dataset.counter); element.textContent = element.dataset.format === "currency" ? money(target) : target.toLocaleString(); });
        };
    }, main);

    const primaryNav = document.querySelector(".primary-nav");
    const navPill = primaryNav?.querySelector(".nav-hover-pill");
    const navLinks = primaryNav ? [...primaryNav.querySelectorAll(".nav-link")] : [];
    const activeNav = primaryNav?.querySelector(".nav-link.is-active");
    const positionPill = (target, immediate = false) => { if (!target || !navPill) return; if (immediate) navPill.style.transition = "none"; navPill.style.width = `${target.offsetWidth}px`; navPill.style.transform = `translate3d(${target.offsetLeft}px,0,0)`; primaryNav.classList.add("is-pill-ready"); if (immediate) { navPill.getBoundingClientRect(); navPill.style.removeProperty("transition"); } };
    navLinks.forEach(link => { link.addEventListener("pointerenter", () => positionPill(link), { signal: pageEvents.signal }); link.addEventListener("focus", () => positionPill(link), { signal: pageEvents.signal }); });
    primaryNav?.addEventListener("pointerleave", () => positionPill(activeNav), { signal: pageEvents.signal });
    primaryNav?.addEventListener("focusout", event => { if (!primaryNav.contains(event.relatedTarget)) positionPill(activeNav); }, { signal: pageEvents.signal });
    window.addEventListener("resize", () => positionPill(activeNav, true), { signal: pageEvents.signal });
    positionPill(activeNav, true);
}

const visibilityObserver = new MutationObserver(initialize);
visibilityObserver.observe(document.body, { attributes: true, attributeFilter: ["hidden"] });
initialize();
function cleanup() {
    if (disposed) return;
    disposed = true;
    visibilityObserver.disconnect();
    pageEvents.abort();
    media?.revert();
    cleanupRows();
    downloadUrls.forEach(url => URL.revokeObjectURL(url));
    downloadUrls.clear();
}
// Preserve interactive state when this document enters the back-forward cache.
window.addEventListener("pagehide", event => { if (!event.persisted) cleanup(); });
