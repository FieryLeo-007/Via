import { motionValue, springValue } from "motion";

// Shared decorations only: no authentication, product or voice state here.
const events = new AbortController();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
const nav = document.querySelector(".primary-nav");
const pill = nav?.querySelector(".nav-hover-pill");
const active = nav?.querySelector(".nav-link.is-active");
let current = active;
let stopPointer = () => {};

function positionPill(target = active, immediate = false) {
    current = target;
    if (!pill || !target) return;
    if (immediate || reduced.matches) pill.style.transition = "none";
    pill.style.width = `${target.offsetWidth}px`;
    pill.style.transform = `translate3d(${target.offsetLeft}px, 0, 0)`;
    nav.classList.add("is-pill-ready");
    if (immediate || reduced.matches) {
        pill.getBoundingClientRect();
        pill.style.removeProperty("transition");
    }
}
nav?.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("pointerenter", event => {
        if (event.pointerType !== "touch") positionPill(link);
    }, { signal: events.signal });
    link.addEventListener("focus", () => positionPill(link), { signal: events.signal });
});
nav?.addEventListener("pointerleave", () => positionPill(nav.querySelector(".nav-link:focus") || active), { signal: events.signal });
nav?.addEventListener("focusout", event => {
    if (!nav.contains(event.relatedTarget)) positionPill(active);
}, { signal: events.signal });
const resize = new ResizeObserver(() => positionPill(current, true));
if (nav) resize.observe(nav);
document.fonts?.ready.then(() => { if (!events.signal.aborted) positionPill(current, true); });
positionPill(active, true);

function configurePointer() {
    stopPointer();
    if (reduced.matches || !finePointer.matches || events.signal.aborted) return;
    const pointerEvents = new AbortController();
    let aura = document.getElementById("cursor-aura");
    const created = !aura;
    if (!aura) {
        aura = document.createElement("div");
        aura.id = "cursor-aura";
        aura.className = "cursor-aura";
        aura.appendChild(document.createElement("span"));
        document.body.appendChild(aura);
    }
    aura.setAttribute("aria-hidden", "true");
    const label = aura.querySelector("span");
    const ambient = document.querySelector(".ambient-bg");
    const targets = [motionValue(-100), motionValue(-100), motionValue(50), motionValue(34)];
    const values = targets.map((target, index) => springValue(target, index < 2
        ? { stiffness: 520, damping: 38, mass: 0.35 }
        : { stiffness: 42, damping: 20, mass: 1.2 }));
    let frame = 0;
    const render = () => {
        frame = 0;
        aura.style.transform = `translate3d(${values[0].get()}px, ${values[1].get()}px, 0) translate(-50%, -50%)`;
        ambient?.style.setProperty("--pointer-x", `${values[2].get()}%`);
        ambient?.style.setProperty("--pointer-y", `${values[3].get()}%`);
    };
    const subscriptions = values.map(value => value.on("change", () => {
        if (!frame) frame = requestAnimationFrame(render);
    }));
    const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: pointerEvents.signal, passive: true });
    const hide = () => {
        aura.classList.remove("is-visible", "is-hovering", "is-pressed");
        if (label) label.textContent = "";
    };
    listen(document, "pointermove", event => {
        if (event.pointerType === "touch") { hide(); return; }
        targets[0].set(event.clientX);
        targets[1].set(event.clientY);
        targets[2].set(event.clientX / innerWidth * 100);
        targets[3].set(event.clientY / innerHeight * 100);
        aura.classList.add("is-visible");
        const target = event.target.closest?.("[data-cursor-label]");
        aura.classList.toggle("is-hovering", Boolean(target));
        if (label) label.textContent = target?.dataset.cursorLabel || "";
    });
    listen(document, "pointerdown", event => { if (event.pointerType !== "touch") aura.classList.add("is-pressed"); });
    listen(document, "pointerup", () => aura.classList.remove("is-pressed"));
    listen(document, "pointercancel", hide);
    listen(document.documentElement, "pointerleave", hide);
    listen(window, "blur", hide);
    listen(document, "visibilitychange", () => { if (document.hidden) hide(); });
    stopPointer = () => {
        pointerEvents.abort();
        cancelAnimationFrame(frame);
        subscriptions.forEach(unsubscribe => unsubscribe());
        values.forEach(value => value.destroy());
        targets.forEach(value => value.destroy());
        hide();
        if (created) aura.remove();
    };
}
reduced.addEventListener("change", configurePointer, { signal: events.signal });
finePointer.addEventListener("change", configurePointer, { signal: events.signal });
configurePointer();
window.addEventListener("pagehide", event => {
    if (event.persisted) { stopPointer(); return; }
    events.abort();
    resize.disconnect();
    stopPointer();
}, { signal: events.signal });
window.addEventListener("pageshow", event => { if (event.persisted) configurePointer(); }, { signal: events.signal });
