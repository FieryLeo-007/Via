import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceSession, frequencyBands, shapeVolume } from "../static/scripts/voice-mode/session.mjs";

function setup({ fetchSession, startSession, requestMicrophone } = {}) {
    const orbStates = [], statuses = [], phases = [], captions = [], errors = [], frames = new Map();
    let frameId = 0, options = null, aborts = 0, ended = 0;
    const conversation = {
        input: .1, output: .3, muted: null, sent: [], updates: [],
        getInputVolume() { return this.input; }, getOutputVolume() { return this.output; },
        getInputByteFrequencyData: () => new Uint8Array([200, 200, 100, 100, 50, 50, 20, 20, 10, 10]),
        getOutputByteFrequencyData: () => new Uint8Array(10).fill(128),
        setMicMuted(value) { this.muted = value; }, sendUserMessage(text) { this.sent.push(text); },
        sendContextualUpdate(text) { this.updates.push(text); }, endSession: async () => { ended += 1; }
    };
    const orb = { amplitude: [], bands: [], setState: s => orbStates.push(s), setAmplitude(v) { this.amplitude.push(v); }, setBands(b) { this.bands.push(b); } };
    const ui = { setPhase: p => phases.push(p), status: s => statuses.push(s), caption: (role, text) => captions.push([role, text]),
        error: (kind, error) => errors.push([kind, error]), ended: byAgent => phases.push(byAgent ? "ended-by-agent" : "ended-other") };
    const session = new VoiceSession({
        Conversation: { startSession: startSession || (async opts => { options = opts; return conversation; }) },
        fetchSession: fetchSession || (async () => ({ conversationToken: "tok", userId: "u1", dynamicVariables: { user_name: "Ada" } })),
        requestMicrophone, orb, ui, tools: { clientTools: { view_cart: () => ({}) }, abort: () => { aborts += 1; } },
        requestFrame: callback => { frames.set(++frameId, callback); return frameId; },
        cancelFrame: id => frames.delete(id)
    });
    return { session, conversation, orb, orbStates, statuses, phases, captions, errors, frames,
        get options() { return options; }, get aborts() { return aborts; }, get ended() { return ended; },
        step() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); } };
}

test("starts a signed WebRTC session with tools and merged dynamic variables", async () => {
    const app = setup();
    assert.equal(await app.session.start({ today: "Sunday", user_name: "ignored" }), true);
    assert.equal(app.options.conversationToken, "tok");
    assert.equal(app.options.connectionType, "webrtc");
    assert.equal(app.options.userId, "u1");
    assert.deepEqual(app.options.dynamicVariables, { today: "Sunday", user_name: "Ada" });
    assert.equal(typeof app.options.clientTools.view_cart, "function");
    assert.deepEqual(app.phases.slice(0, 2), ["connecting", "live"]);
    assert.equal(app.orbStates[0], "connecting");
    assert.equal(app.orbStates.at(-1), "listening");
});

test("server shopping context reaches dynamic variables and a background update", async () => {
    const context = JSON.stringify({ profile: { full_name: 'Ada', shirt_size: 'M', max_spending_budget_usd: 120 }, user_preferences: [] });
    const app = setup({ fetchSession: async () => ({ conversationToken: 'tok', userId: 'u1', dynamicVariables: { user_name: 'Ada', user_context: context } }) });
    assert.equal(await app.session.start({ user_context: 'untrusted caller override' }), true);
    assert.equal(app.options.dynamicVariables.user_context, context);
    assert.equal(app.conversation.updates.length, 1);
    assert.ok(app.conversation.updates[0].endsWith(context));
    assert.match(app.conversation.updates[0], /Missing values are unknown/);
    assert.deepEqual(app.conversation.sent, [], 'context is not spoken as a user message');
});

test("mode, tool activity and mute drive the orb and status", async () => {
    const app = setup();
    await app.session.start();
    app.options.onModeChange({ mode: "speaking" });
    assert.equal(app.orbStates.at(-1), "speaking"); assert.equal(app.statuses.at(-1), "V is speaking");
    app.options.onModeChange({ mode: "listening" });
    app.session.toolStarted("search_products");
    assert.equal(app.orbStates.at(-1), "processing"); assert.equal(app.statuses.at(-1), "Searching seven stores…");
    app.session.toolFinished("search_products");
    assert.equal(app.orbStates.at(-1), "listening");
    app.session.setMuted(true);
    assert.equal(app.conversation.muted, true); assert.equal(app.statuses.at(-1), "Microphone muted");
});

test("the audio loop feeds the active speaker's level and bands to the orb", async () => {
    const app = setup();
    await app.session.start();
    app.step();
    assert.ok(Math.abs(app.orb.amplitude.at(-1) - shapeVolume(.1)) < 1e-9, "listening uses the microphone level");
    assert.ok(app.orb.bands.at(-1).low > app.orb.bands.at(-1).high);
    app.options.onModeChange({ mode: "speaking" });
    app.step();
    assert.ok(Math.abs(app.orb.amplitude.at(-1) - shapeVolume(.3)) < 1e-9, "speaking uses the agent's output level");
    assert.equal(app.frames.size, 1, "the loop keeps running while live");
});

test("captions, typed messages and contextual updates reach the right places", async () => {
    const app = setup();
    await app.session.start();
    app.options.onMessage({ role: "agent", message: "Hey Ada!" });
    assert.equal(app.session.sendText("  under $100  "), true);
    assert.equal(app.session.sendText("   "), false);
    app.session.notify("Top picks are ready");
    assert.deepEqual(app.captions, [["agent", "Hey Ada!"], ["user", "under $100"]]);
    assert.deepEqual(app.conversation.sent, ["under $100"]);
    assert.deepEqual(app.conversation.updates, ["Top picks are ready"]);
});

test("ending stops audio, aborts tools and ignores late callbacks", async () => {
    const app = setup();
    await app.session.start();
    const { onModeChange, onDisconnect } = app.options;
    await app.session.end();
    assert.equal(app.ended, 1); assert.equal(app.aborts, 1); assert.equal(app.frames.size, 0);
    const states = app.orbStates.length;
    onModeChange({ mode: "speaking" }); onDisconnect({ reason: "error", message: "late" });
    assert.equal(app.orbStates.length, states); assert.equal(app.errors.length, 0);
    assert.equal(app.phases.at(-1), "ended");
});

test("an agent hang-up ends the session; a dropped connection reports an error", async () => {
    const hangup = setup();
    await hangup.session.start();
    hangup.options.onDisconnect({ reason: "agent" });
    assert.equal(hangup.phases.at(-1), "ended-by-agent"); assert.equal(hangup.frames.size, 0);
    const drop = setup();
    await drop.session.start();
    drop.options.onDisconnect({ reason: "error", message: "ICE failed" });
    assert.equal(drop.errors[0][0], "connection"); assert.equal(drop.orbStates.at(-1), "error");
});

test("start failures are classified for helpful recovery copy", async () => {
    const denied = setup({ requestMicrophone: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } });
    assert.equal(await denied.session.start(), false);
    assert.equal(denied.errors[0][0], "microphone");
    const setupMissing = setup({ fetchSession: async () => { throw Object.assign(new Error("not configured"), { code: "voice_unavailable" }); } });
    await setupMissing.session.start();
    assert.equal(setupMissing.errors[0][0], "setup");
    const network = setup({ startSession: async () => { throw new Error("WebRTC unavailable"); } });
    await network.session.start();
    assert.equal(network.errors[0][0], "connection");
});

test("ending while connecting discards the late conversation", async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const app = setup({ fetchSession: () => pending });
    const starting = app.session.start();
    await app.session.end();
    finish({ conversationToken: "tok", dynamicVariables: {} });
    assert.equal(await starting, false);
    assert.equal(app.options, null, "no conversation is started after the shopper left");
});

test("audio helpers stay within 0..1", () => {
    assert.equal(shapeVolume(-1), 0); assert.equal(shapeVolume(5), 1);
    assert.deepEqual(frequencyBands(new Uint8Array()), { low: 0, mid: 0, high: 0 });
    const loud = frequencyBands(new Uint8Array(64).fill(255));
    assert.ok(Object.values(loud).every(value => value <= 1 && value > .9));
});

test("the default frame scheduler calls the global rAF unbound", async () => {
    const calls = [];
    globalThis.requestAnimationFrame = function (callback) { if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation"); calls.push(callback); return 1; };
    globalThis.cancelAnimationFrame = function () { if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation"); };
    try {
        const conversation = { getInputVolume: () => 0, getInputByteFrequencyData: () => new Uint8Array(), endSession: async () => {} };
        const session = new VoiceSession({
            Conversation: { startSession: async () => conversation }, fetchSession: async () => ({ conversationToken: "t", dynamicVariables: {} }),
            orb: { setState() {}, setAmplitude() {}, setBands() {} }, ui: { setPhase() {}, status() {}, caption() {}, error: (kind, error) => { throw error; } },
            tools: { clientTools: {}, abort() {} }
        });
        assert.equal(await session.start(), true);
        assert.equal(calls.length, 1);
        await session.end();
    } finally { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});

test("ending after V hung up is a no-op, so the status never flickers", async () => {
    const app = setup();
    await app.session.start();
    app.options.onDisconnect({ reason: "agent" });
    const phases = app.phases.length;
    await app.session.end();
    assert.equal(app.phases.length, phases, "no ending/ended phase churn after a hang-up");
    assert.equal(app.ended, 0, "the SDK session was already closed by the agent");
});

test("waitForQuiet waits for V to finish speaking and for tools to settle", async () => {
    const app = setup();
    await app.session.start();
    app.options.onModeChange({ mode: "speaking" });
    let done = false;
    const waiting = app.session.waitForQuiet({ timeout: 3000, settle: 150 }).then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(done, false, "still speaking");
    app.options.onModeChange({ mode: "listening" });
    app.session.toolStarted("open_page");
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(done, false, "a tool is still running");
    app.session.toolFinished("open_page");
    await waiting;
    assert.equal(done, true);
    const started = Date.now();
    app.options.onModeChange({ mode: "speaking" });
    await app.session.waitForQuiet({ timeout: 200, settle: 150 });
    assert.ok(Date.now() - started < 600, "the timeout caps the wait");
});

test("waitForQuiet can wait for V to start its goodbye before it counts as quiet", async () => {
    const app = setup();
    await app.session.start();
    let done = false;
    const waiting = app.session.waitForQuiet({ timeout: 3000, settle: 100, expectSpeech: true, speechGrace: 2000 }).then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(done, false, "silence before V replies is not the end");
    app.options.onModeChange({ mode: "speaking" });
    await new Promise(resolve => setTimeout(resolve, 200));
    app.options.onModeChange({ mode: "listening" });
    await waiting;
    assert.equal(done, true);
    const started = Date.now();
    await app.session.waitForQuiet({ timeout: 3000, settle: 100, expectSpeech: true, speechGrace: 300 });
    assert.ok(Date.now() - started < 1000, "a silent agent does not hold the page hostage");
});
