// Owns one ElevenLabs conversation: signed start, mode/tool state → orb, live audio → orb, clean end.
const TOOL_ACTIVITY = {
    search_products: "Searching seven stores…", compare_products: "Comparing side by side…", get_product_details: "Looking closer…",
    add_to_cart: "Updating your cart…", update_cart_item: "Updating your cart…", view_cart: "Opening your cart…",
    save_product: "Saving for later…", get_checkout_quote: "Preparing checkout…", place_demo_order: "Placing your demo order…",
    start_real_checkout: "Waiting for your confirmation…", list_orders: "Checking your orders…", get_order_status: "Tracking your order…",
    cancel_order: "Cancelling…", open_page: "Opening the page…"
};

const clamp = value => Math.min(Math.max(value, 0), 1);

// Voice energy sits low in the spectrum; weight the bands so each one visibly moves.
export function frequencyBands(data) {
    if (!data?.length) return { low: 0, mid: 0, high: 0 };
    const average = (from, to) => {
        const start = Math.floor(data.length * from), end = Math.max(start + 1, Math.floor(data.length * to));
        let sum = 0;
        for (let i = start; i < end; i++) sum += data[i];
        return sum / (end - start) / 255;
    };
    return { low: clamp(average(0, .12) * 1.4), mid: clamp(average(.12, .4) * 1.8), high: clamp(average(.4, 1) * 3.2) };
}

// SDK volumes are RMS-like and rarely pass ~0.4; lift them into a lively 0..1 range.
export const shapeVolume = volume => Math.pow(clamp((Number(volume) || 0) * 2.6), .7);

export class VoiceSession {
    constructor({ Conversation, fetchSession, requestMicrophone, orb, ui, tools, requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id) }) {
        // Wrapped: browsers throw "Illegal invocation" when rAF is called as a method of another object.
        Object.assign(this, { Conversation, fetchSession, requestMicrophone, orb, ui, tools, requestFrame, cancelFrame });
        this.conversation = null;
        this.phase = "idle";
        this.mode = "listening";
        this.muted = false;
        this.activeTools = new Map();
        this.frame = null;
        this.generation = 0;
    }

    async start(variables = {}) {
        const generation = ++this.generation;
        this.setPhase("connecting");
        try {
            // Ask for the microphone first so a denial gets a clear, specific message.
            const [session] = await Promise.all([this.fetchSession(), this.requestMicrophone?.()]);
            if (generation !== this.generation) return false;
            const conversation = await this.Conversation.startSession({
                conversationToken: session.conversationToken,
                connectionType: "webrtc",
                userId: session.userId,
                dynamicVariables: { ...variables, ...session.dynamicVariables },
                clientTools: this.tools.clientTools,
                onConnect: () => { if (generation === this.generation) this.setPhase("live"); },
                onDisconnect: details => this.handleDisconnect(generation, details),
                onError: (message, context) => {
                    // Tool failures are already spoken by the agent; only transport errors matter here.
                    if (context?.clientToolName) return;
                    console.warn("Voice mode:", message, context);
                },
                onModeChange: ({ mode }) => { if (generation === this.generation) { this.mode = mode; this.syncOrb(); } },
                onMessage: ({ role, message }) => { if (generation === this.generation && message) this.ui.caption(role, message); }
            });
            if (generation !== this.generation) { await conversation.endSession().catch(() => {}); return false; }
            this.conversation = conversation;
            if (this.phase === "connecting") this.setPhase("live");
            this.syncOrb();
            this.loop();
            return true;
        } catch (error) {
            if (generation !== this.generation) return false;
            this.fail(error);
            return false;
        }
    }

    handleDisconnect(generation, details) {
        if (generation !== this.generation) return;
        this.stopLoop();
        this.conversation = null;
        this.tools.abort();
        if (details?.reason === "error") this.fail(new Error(details.message || "The voice connection dropped."));
        else if (this.phase !== "ending") { this.setPhase("ended"); this.ui.ended?.(details?.reason === "agent"); }
    }

    fail(error) {
        this.stopLoop();
        const name = error?.name;
        const kind = name === "NotAllowedError" || name === "SecurityError" ? "microphone"
            : name === "NotFoundError" ? "no-microphone" : error?.code === "voice_unavailable" ? "setup" : "connection";
        this.setPhase("error");
        this.ui.error(kind, error);
    }

    setPhase(phase) {
        this.phase = phase;
        this.ui.setPhase(phase);
        this.syncOrb();
    }

    // Tool calls come from the SDK; the orb and status show what V is doing meanwhile.
    toolStarted(name) {
        this.activeTools.set(name, (this.activeTools.get(name) || 0) + 1);
        this.syncOrb();
    }

    toolFinished(name) {
        const count = (this.activeTools.get(name) || 1) - 1;
        if (count > 0) this.activeTools.set(name, count); else this.activeTools.delete(name);
        this.syncOrb();
    }

    syncOrb() {
        if (this.phase === "connecting") { this.orb.setState("connecting"); this.ui.status("Connecting to V…"); return; }
        if (this.phase === "error") { this.orb.setState("error"); return; }
        if (this.phase !== "live") { this.orb.setState("idle"); return; }
        const tool = [...this.activeTools.keys()].at(-1);
        if (this.mode === "speaking") { this.orb.setState("speaking"); this.ui.status("V is speaking"); }
        else if (tool) { this.orb.setState("processing"); this.ui.status(TOOL_ACTIVITY[tool] || "Working on it…"); }
        else { this.orb.setState("listening"); this.ui.status(this.muted ? "Microphone muted" : "Listening…"); }
    }

    loop() {
        this.stopLoop();
        const step = () => {
            this.frame = null;
            const conversation = this.conversation;
            if (!conversation || this.phase !== "live") return;
            try {
                if (this.mode === "speaking") {
                    this.orb.setAmplitude(shapeVolume(conversation.getOutputVolume()));
                    this.orb.setBands(frequencyBands(conversation.getOutputByteFrequencyData()));
                } else if (!this.muted) {
                    this.orb.setAmplitude(shapeVolume(conversation.getInputVolume()));
                    this.orb.setBands(frequencyBands(conversation.getInputByteFrequencyData()));
                } else {
                    this.orb.setAmplitude(0);
                }
            } catch { /* Audio graphs can briefly be unavailable while devices change. */ }
            this.frame = this.requestFrame(step);
        };
        this.frame = this.requestFrame(step);
    }

    stopLoop() {
        if (this.frame !== null) this.cancelFrame(this.frame);
        this.frame = null;
    }

    setMuted(muted) {
        this.muted = Boolean(muted);
        this.conversation?.setMicMuted(this.muted);
        this.syncOrb();
    }

    sendText(text) {
        const message = String(text || "").trim().slice(0, 1000);
        if (!message || !this.conversation) return false;
        this.conversation.sendUserMessage(message);
        this.ui.caption("user", message);
        return true;
    }

    notify(text) {
        try { this.conversation?.sendContextualUpdate(String(text).slice(0, 1500)); } catch { /* best effort */ }
    }

    async end() {
        this.generation += 1;
        this.setPhase("ending");
        this.stopLoop();
        this.tools.abort();
        const conversation = this.conversation;
        this.conversation = null;
        this.activeTools.clear();
        if (conversation) await conversation.endSession().catch(() => {});
        this.setPhase("ended");
    }
}
