import { gsap } from "gsap";

const image = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=180&q=80`;
const orders = [
    { id: "PV-84291", status: "shipped", statusLabel: "Shipped", date: "Sep 24, 2026", timestamp: 20260924, total: 284.98, eta: "Arrives tomorrow", items: [
        { name: "Studio wireless headphones", detail: "Forest green · 1", price: 189.99, image: image("photo-1505740420928-5e560c06d30e") },
        { name: "Travel coffee press", detail: "Matte black · 1", price: 94.99, image: image("photo-1495474472287-4d71bcdd2085") }
    ], timeline: [["Order confirmed", "Sep 24 · 9:18 AM"], ["Shipped", "Sep 25 · 4:42 PM"], ["Out for delivery", "Expected Sep 27"]] },
    { id: "PV-84037", status: "processing", statusLabel: "Processing", date: "Sep 22, 2026", timestamp: 20260922, total: 168.00, eta: "Preparing to ship", items: [
        { name: "Cloud-knit throw blanket", detail: "Oatmeal · 2", price: 56.00, image: image("photo-1580301762395-21ce84d00bc6") },
        { name: "Portable table lamp", detail: "Warm white · 1", price: 56.00, image: image("photo-1507473885765-e6ed057f782c") }
    ], timeline: [["Order confirmed", "Sep 22 · 2:04 PM"], ["Processing", "Items are being prepared"], ["Shipped", "Pending"]] },
    { id: "PV-82714", status: "delivered", statusLabel: "Delivered", date: "Sep 12, 2026", timestamp: 20260912, total: 699.00, eta: "Delivered Sep 15", items: [
        { name: "Compact mirrorless camera", detail: "Graphite · 1", price: 699.00, image: image("photo-1516035069371-29a1b244cc32") }
    ], timeline: [["Order confirmed", "Sep 12 · 11:30 AM"], ["Shipped", "Sep 13 · 8:12 AM"], ["Delivered", "Sep 15 · 1:46 PM"]] },
    { id: "PV-81952", status: "delivered", statusLabel: "Delivered", date: "Aug 28, 2026", timestamp: 20260828, total: 96.38, eta: "Delivered Aug 31", items: [
        { name: "Matte insulated bottle", detail: "Sage · 1", price: 26.00, image: image("photo-1602143407151-7111542de6e8") },
        { name: "Everyday crossbody bag", detail: "Stone · 1", price: 70.38, image: image("photo-1594223274512-ad4803739b7c") }
    ], timeline: [["Order confirmed", "Aug 28 · 3:12 PM"], ["Shipped", "Aug 29 · 10:02 AM"], ["Delivered", "Aug 31 · 4:20 PM"]] }
];

const list = document.getElementById("orders-list");
const count = document.getElementById("order-count");
const empty = document.getElementById("orders-empty");
const search = document.getElementById("order-search");
const sort = document.getElementById("order-sort");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let activeFilter = "all";
let activeRows = [];
let disposed = false;
let renderTween = null;
const pageEvents = new AbortController();

const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function orderTemplate(order) {
    const thumbs = order.items.slice(0, 3).map(item => `<span class="order-thumb"><img src="${escapeHtml(item.image)}" alt="" width="58" height="58" loading="lazy" referrerpolicy="no-referrer"></span>`).join("");
    const receipt = order.items.map(item => `<li><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></span><b>${money(item.price)}</b></li>`).join("");
    const timeline = order.timeline.map((step, index) => `<li class="${index < order.timeline.length - 1 || order.status === "delivered" ? "is-complete" : ""}"><span class="timeline-dot"></span><div><strong>${escapeHtml(step[0])}</strong><small>${escapeHtml(step[1])}</small></div></li>`).join("");
    const trackLabel = order.status === "delivered" ? "Buy again" : "Track package";
    return `<article class="order-card" data-status="${order.status}" data-id="${order.id}" style="--spot-x:50%;--spot-y:50%">
        <button class="order-row" type="button" aria-expanded="false" aria-controls="details-${order.id}">
            <span class="order-thumbs">${thumbs}</span>
            <span class="order-identity"><small>Order ${order.id}</small><strong>${order.items[0].name}${order.items.length > 1 ? ` <em>+${order.items.length - 1} more</em>` : ""}</strong><span>${order.items.length} ${order.items.length === 1 ? "item" : "items"} · ${money(order.total)}</span></span>
            <span class="order-date"><small>Ordered</small><strong>${order.date}</strong></span>
            <span class="order-state"><span class="status-pill status-${order.status}"><i></i>${order.statusLabel}</span><small>${order.eta}</small></span>
            <span class="order-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 10 4 4 4-4"/></svg></span>
        </button>
        <div class="order-details" id="details-${order.id}" aria-hidden="true"><div class="order-details-inner">
            <section class="tracking"><p class="detail-kicker">Tracking</p><ol>${timeline}</ol></section>
            <section class="receipt"><div><p class="detail-kicker">Receipt</p><span>${order.items.length} ${order.items.length === 1 ? "item" : "items"}</span></div><ul>${receipt}</ul><div class="receipt-total"><span>Total</span><strong>${money(order.total)}</strong></div></section>
            <div class="order-actions"><button type="button" class="order-action-primary">${trackLabel}<span>↗</span></button><button type="button" class="order-action-secondary">Invoice<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg></button></div>
        </div></div>
    </article>`;
}

function cleanupRows() {
    activeRows.splice(0).forEach(cleanup => cleanup());
}

function setupRow(card) {
    const trigger = card.querySelector(".order-row");
    const details = card.querySelector(".order-details");
    const inner = card.querySelector(".order-details-inner");
    const onToggle = () => {
        const opening = trigger.getAttribute("aria-expanded") !== "true";
        trigger.setAttribute("aria-expanded", String(opening));
        details.setAttribute("aria-hidden", String(!opening));
        card.classList.toggle("is-open", opening);
        if (reduceMotion) { details.style.height = opening ? "auto" : "0px"; return; }
        gsap.killTweensOf(details);
        if (opening) {
            details.style.height = "auto";
            const target = details.offsetHeight;
            details.style.height = "0px";
            gsap.timeline().to(details, { height: target, duration: 0.5, ease: "power3.inOut" }).fromTo(inner.children, { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.35, stagger: 0.045, ease: "power3.out" }, "-=0.25").set(details, { height: "auto" });
        } else {
            gsap.to(details, { height: 0, duration: 0.4, ease: "power3.inOut" });
        }
    };
    const moveX = gsap.quickTo(card, "x", { duration: 0.35, ease: "power3.out" });
    const moveY = gsap.quickTo(card, "y", { duration: 0.35, ease: "power3.out" });
    const scale = gsap.quickTo(card, "scale", { duration: 0.3, ease: "power3.out" });
    const onMove = event => {
        if (event.pointerType === "touch") return;
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        card.style.setProperty("--spot-x", `${x}px`);
        card.style.setProperty("--spot-y", `${y}px`);
        moveX(((x / rect.width) - 0.5) * 3);
        moveY(((y / rect.height) - 0.5) * 3);
    };
    const onEnter = event => { if (event.pointerType !== "touch" && !reduceMotion) scale(1.015); };
    const onLeave = () => { if (!reduceMotion) { moveX(0); moveY(0); scale(1); } };
    trigger.addEventListener("click", onToggle);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerenter", onEnter);
    card.addEventListener("pointerleave", onLeave);
    activeRows.push(() => { trigger.removeEventListener("click", onToggle); card.removeEventListener("pointermove", onMove); card.removeEventListener("pointerenter", onEnter); card.removeEventListener("pointerleave", onLeave); gsap.killTweensOf([card, details, inner.children]); });
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
    renderTween?.kill();
    renderTween = animate && !reduceMotion && visible.length ? gsap.fromTo(list.children, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.52, stagger: 0.08, ease: "power3.out", clearProps: "opacity,visibility" }) : null;
}

document.querySelectorAll(".filter-chip").forEach(chip => chip.addEventListener("click", () => {
    activeFilter = chip.dataset.filter;
    document.querySelectorAll(".filter-chip").forEach(item => { const active = item === chip; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); });
    render();
}, { signal: pageEvents.signal }));
search.addEventListener("input", () => render(), { signal: pageEvents.signal });
sort.addEventListener("change", () => render(), { signal: pageEvents.signal });
document.getElementById("clear-filters").addEventListener("click", () => { activeFilter = "all"; search.value = ""; document.querySelectorAll(".filter-chip").forEach(item => { const active = item.dataset.filter === "all"; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); }); render(); }, { signal: pageEvents.signal });

render({ animate: false });
document.body.classList.add("orders-motion-ready");
const pageContext = gsap.context(() => {
    if (!reduceMotion) {
        gsap.fromTo(".orders-heading, .summary-card, .orders-controls, .orders-list-heading, .order-card", { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.58, stagger: 0.08, delay: 0.08, ease: "power3.out", clearProps: "opacity,visibility" });
        document.querySelectorAll("[data-counter]").forEach(element => {
            const target = Number(element.dataset.counter);
            const state = { value: 0 };
            gsap.to(state, { value: target, duration: 1.1, delay: 0.22, ease: "power3.out", onUpdate: () => { element.textContent = element.dataset.format === "currency" ? money(state.value) : Math.round(state.value).toLocaleString(); } });
        });
    } else document.querySelectorAll("[data-counter]").forEach(element => { const target = Number(element.dataset.counter); element.textContent = element.dataset.format === "currency" ? money(target) : target.toLocaleString(); });
}, document.querySelector(".orders-main"));

const primaryNav = document.querySelector(".primary-nav");
const navPill = primaryNav?.querySelector(".nav-hover-pill");
const navLinks = primaryNav ? [...primaryNav.querySelectorAll(".nav-link")] : [];
const activeNav = primaryNav?.querySelector(".nav-link.is-active");
const positionPill = (target, immediate = false) => { if (!target || !navPill) return; if (immediate) navPill.style.transition = "none"; navPill.style.width = `${target.offsetWidth}px`; navPill.style.transform = `translate3d(${target.offsetLeft}px,0,0)`; primaryNav.classList.add("is-pill-ready"); if (immediate) { navPill.getBoundingClientRect(); navPill.style.removeProperty("transition"); } };
navLinks.forEach(link => { link.addEventListener("pointerenter", () => positionPill(link), { signal: pageEvents.signal }); link.addEventListener("focus", () => positionPill(link), { signal: pageEvents.signal }); });
primaryNav?.addEventListener("pointerleave", () => positionPill(activeNav), { signal: pageEvents.signal });
positionPill(activeNav, true);

function cleanup() { if (disposed) return; disposed = true; pageEvents.abort(); cleanupRows(); renderTween?.kill(); pageContext.revert(); }
window.addEventListener("pagehide", cleanup, { once: true });
