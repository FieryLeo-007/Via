// Voice Mode bundle entry. Loaded on demand by the dashboard (app.js) and exposed as
// window.ProjectVVoiceMode so the WebRTC SDK never weighs down the main bundle.
import { Conversation } from "@elevenlabs/client";
import { animate } from "motion";
import { VoiceOrb } from "../voice-orb.js";
import { postJson, compareProducts } from "../search-client.mjs";
import { cartItems, addToCart, setCartQuantity, fulfillDemoOrder } from "../cart-store.mjs";
import { api, session as accountSession } from "../commerce-client.mjs";
import { createVoiceTools } from "./tools.mjs";
import { createVoiceOverlay } from "./overlay.js";
import { VoiceSession } from "./session.mjs";

async function fetchVoiceSession() {
    const auth = await accountSession();
    const response = await fetch("/api/voice/session", { cache: "no-store", headers: { Authorization: `Bearer ${auth.access_token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || "Voice mode is unavailable right now.");
        Object.assign(error, { code: data.code, missing: data.missing || [] });
        throw error;
    }
    return data;
}

// Prompt for the microphone up front; the SDK opens its own stream once connected.
async function requestMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("This browser can't use a microphone here."), { name: "NotFoundError" });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
}

let orb = null, overlay = null, active = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = animation => Promise.resolve(animation).catch(() => {});
const FAREWELL_EASE = [.4, 0, .2, 1];

// The goodbye: cards and controls settle away, the orb exhales and fades, then the
// overlay dissolves onto a dashboard that has already been prepared behind it.
async function farewell(dialog) {
    const orbCanvas = dialog.querySelector("[data-voice-orb] canvas");
    const chrome = [...dialog.querySelectorAll("[data-voice-stage], .voice-mode-controls, .voice-mode-top")];
    const captions = dialog.querySelector(".voice-mode-captions");
    await Promise.all([
        settle(animate(chrome, { opacity: 0, y: 14 }, { duration: .4, ease: FAREWELL_EASE })),
        settle(animate(captions, { opacity: 0 }, { duration: .5, delay: .45, ease: FAREWELL_EASE })),
        settle(animate(orbCanvas, { scale: .78, opacity: 0 }, { duration: .9, delay: .2, ease: FAREWELL_EASE })),
        settle(animate(dialog, { opacity: 0 }, { duration: .5, delay: .65, ease: "easeIn" }))
    ]);
}

function clearFarewell(dialog) {
    dialog.querySelectorAll("[data-voice-stage], .voice-mode-controls, .voice-mode-top, .voice-mode-captions, [data-voice-orb] canvas")
        .forEach(node => { node.style.opacity = ""; node.style.transform = ""; });
    dialog.style.opacity = "";
}

function today() {
    return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function open(options = {}) {
    const dialog = document.getElementById("voice-mode");
    if (!dialog || active) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let session = null, closing = null, autoClose = null;

    const close = async ({ navigateTo } = {}) => {
        if (closing) return closing;
        closing = (async () => {
            clearTimeout(autoClose);
            overlay.farewell();
            await session?.end();
            // Prepare the dashboard (or start loading the next page) while the overlay still covers it.
            const turns = tools.state.turns.slice();
            const handoff = navigateTo ? null : Promise.resolve().then(() => options.onClose?.({ turns })).catch(() => {});
            if (!reducedMotion) await farewell(dialog);
            if (handoff) await Promise.race([handoff, sleep(reducedMotion ? 400 : 600)]);
            if (navigateTo) { window.location.assign(navigateTo); return; }
            dialog.close();
            clearFarewell(dialog);
            document.documentElement.classList.remove("voice-mode-open");
            dialog.removeEventListener("voice:navigate", onNavigate);
            window.removeEventListener("pagehide", onPageHide);
            active = null;
            options.returnFocus?.focus({ preventScroll: true });
        })();
        return closing;
    };

    // open_page: let V finish its goodbye, then leave gracefully.
    const onNavigate = async event => {
        clearTimeout(autoClose);
        await session?.waitForQuiet({ timeout: 9000, expectSpeech: true });
        close({ navigateTo: event.detail });
    };
    const onPageHide = () => { session?.end(); };

    if (!overlay) {
        overlay = createVoiceOverlay(dialog, {
            reducedMotion,
            onEnd: () => active?.close(),
            onMute: muted => active?.session.setMuted(muted),
            onSend: text => active?.session.sendText(text) || false,
            onRetry: () => active?.retry(),
            onTapAdd: index => active?.tools.tapAdd(index)
        });
    }
    overlay.reset();

    // Tools report activity to the session (orb + status) as well as rendering on the stage.
    const ui = new Proxy(overlay, { get(target, name) {
        if (name === "toolStarted") return tool => session?.toolStarted(tool);
        if (name === "toolFinished") return tool => session?.toolFinished(tool);
        return target[name];
    } });
    const tools = createVoiceTools({
        postJson, compareProducts, api, ui,
        cart: { items: cartItems, add: addToCart, setQuantity: setCartQuantity, fulfillDemoOrder },
        setSaved: options.setSaved || (async () => { throw new Error("Saving isn't available here."); }),
        notify: text => session?.notify(text),
        onTurn: record => options.persistTurn?.(record)
    });
    // V hung up (end_call): a short grace lets the last syllable play before the goodbye animation.
    const sessionUi = { ...overlay, ended(byAgent) { overlay.ended(byAgent); autoClose = setTimeout(() => close(), 450); } };

    clearFarewell(dialog);
    dialog.showModal();
    document.documentElement.classList.add("voice-mode-open");
    dialog.addEventListener("voice:navigate", onNavigate);
    window.addEventListener("pagehide", onPageHide);
    const orbRoot = dialog.querySelector("[data-voice-orb]");
    if (!orb) orb = new VoiceOrb(orbRoot, { variant: "immersive", reducedMotion });
    orb.resize();
    if (!reducedMotion) {
        animate(dialog, { opacity: [0, 1] }, { duration: .3, ease: "easeOut" });
        // Animate the canvas, not the root: the root's CSS transform steps the orb back for the stage.
        animate(orbRoot.querySelector("canvas"), { scale: [.35, 1], opacity: [0, 1] }, { duration: .7, ease: [.23, 1, .32, 1] });
    }

    // Browser tests substitute a scripted conversation; production always uses the SDK.
    const conversationImpl = window.ProjectVVoiceTestConversation || Conversation;
    session = new VoiceSession({ Conversation: conversationImpl, fetchSession: fetchVoiceSession, requestMicrophone, orb, ui: sessionUi, tools });
    active = {
        session, tools, close,
        retry() { overlay.setPhase("connecting"); session.start({ today: today() }); }
    };
    session.start({ today: today() });
}

window.ProjectVVoiceMode = { open, close: () => active?.close() };
window.dispatchEvent(new CustomEvent("projectv:voice-mode-ready"));
