const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
    const frames = new Map(), media = new Map(), events = new Map(), observers = [];
    let id = 0, draws = 0, permissionCalls = 0, sample = .12;
    const gradient = { addColorStop() {} };
    const context = new Proxy({}, { get(_, key) {
        if (key.startsWith('create')) return () => gradient;
        return (...args) => { if (key === 'clearRect') draws++; };
    }, set() { return true; } });
    const status = { textContent: '', setAttribute() {} };
    const canvas = { style: {}, getContext: () => context };
    const root = { dataset: {}, querySelector: selector => selector === 'canvas' ? canvas : status, getBoundingClientRect: () => ({ width: 280, height: 400 }) };
    const stream = { stopped: 0, getTracks: () => [{ stop: () => stream.stopped++ }] };
    const audio = { state: 'running', closes: 0, disconnects: 0,
        createAnalyser: () => ({ disconnect: () => audio.disconnects++, getFloatTimeDomainData: values => values.fill(sample) }),
        createMediaStreamSource: () => ({ connect() {}, disconnect: () => audio.disconnects++ }),
        close: () => { audio.closes++; audio.state = 'closed'; return Promise.resolve(); },
    };
    const sandbox = vm.createContext({
        root, Float32Array, performance: { now: () => 100 },
        requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
        cancelAnimationFrame: id => frames.delete(id),
        ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
        IntersectionObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
        document: { hidden: false, addEventListener: (name, cb) => events.set(name, cb), removeEventListener: name => events.delete(name) },
        navigator: { mediaDevices: { getUserMedia: async () => { permissionCalls++; return stream; } } },
        window: { devicePixelRatio: 3, AudioContext: class { constructor() { return audio; } },
            matchMedia(query) {
                if (!media.has(query)) media.set(query, { matches: false, listeners: new Set(), addEventListener(_, cb) { this.listeners.add(cb); }, removeEventListener(_, cb) { this.listeners.delete(cb); } });
                return media.get(query);
            },
        },
    });
    const source = fs.readFileSync(path.join(__dirname, '../static/scripts/voice-orb.js'), 'utf8').replaceAll('export class', 'class');
    vm.runInContext(source + '\nthis.VoiceOrb = VoiceOrb; this.MicrophoneAmplitudeMonitor = MicrophoneAmplitudeMonitor;', sandbox);
    return { sandbox, root, status, canvas, frames, media, observers, events, stream, audio,
        get draws() { return draws; }, get permissionCalls() { return permissionCalls; },
        step(time = 116) { const [key, callback] = frames.entries().next().value; frames.delete(key); callback(time); },
        setSample(value) { sample = value; },
    };
}

test('orb starts idle without microphone access, uses bounded DPR and rejects invalid states', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root);
    assert.equal(orb.state, 'idle'); assert.equal(app.permissionCalls, 0);
    assert.equal(app.canvas.width, 560); assert.equal(app.frames.size, 1);
    orb.setState('shouting'); assert.equal(orb.state, 'idle');
    orb.destroy();
});

test('only live audio states react to audio; processing is real state and error freezes animation', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root);
    orb.setAmplitude(1); assert.equal(orb.targetAmplitude, 0);
    orb.setState('listening'); orb.setAmplitude(2); app.step(100); app.step(117);
    assert.equal(orb.targetAmplitude, 1); assert.ok(orb.amplitude > 0);
    orb.setState('processing'); assert.equal(orb.amplitude, 0);
    orb.setState('error', 'Retry microphone');
    assert.equal(app.frames.size, 0); assert.equal(app.status.textContent, 'Retry microphone');
    orb.setState('idle'); assert.equal(app.frames.size, 1); orb.destroy();
});

test('reduced motion stays static during audio and preference changes cancel frames', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root);
    const motion = app.media.get('(prefers-reduced-motion: reduce)');
    motion.matches = true; motion.listeners.forEach(cb => cb());
    orb.setState('listening'); const draws = app.draws;
    orb.setAmplitude(.8); orb.setAmplitude(.4);
    assert.equal(app.draws, draws); assert.equal(app.frames.size, 0);
    motion.matches = false; motion.listeners.forEach(cb => cb());
    assert.equal(app.frames.size, 1); orb.destroy();
});

test('speech produces a quick pulse with a smooth reverberating release', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root);
    orb.setState('listening');
    orb.setAmplitude(1);
    app.step(100);
    for (let time = 117; time <= 270; time += 17) app.step(time);
    assert.ok(orb.amplitude > .95, 'speech attacks promptly');
    assert.ok(orb.speechPhase > 1, 'speech drives a faster wave phase');
    const loud = orb.amplitude;
    orb.setAmplitude(0);
    app.step(287);
    assert.ok(orb.amplitude > .8 && orb.amplitude < loud, 'release reverberates without snapping');
    for (let time = 304; time < 1300; time += 17) app.step(time);
    assert.ok(orb.amplitude < .01, 'silence settles the reactive pulse');
    orb.setState('idle');
    assert.equal(orb.speechPhase, 0);
    orb.destroy();
});

test('offscreen, hidden and destroyed orbs cancel frames and clean observers/listeners', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root);
    app.observers[1].callback([{ isIntersecting: false }]); assert.equal(app.frames.size, 0);
    app.observers[1].callback([{ isIntersecting: true }]); assert.equal(app.frames.size, 1);
    app.sandbox.document.hidden = true; app.events.get('visibilitychange')(); assert.equal(app.frames.size, 0);
    orb.destroy(); orb.destroy(); orb.setState('listening'); orb.resize();
    assert.equal(app.events.size, 0); assert.ok(app.observers.every(observer => observer.disconnected));
    assert.ok([...app.media.values()].every(media => media.listeners.size === 0));
});

test('microphone samples real amplitude only on explicit start and closes all resources', async () => {
    const app = setup(), mic = new app.sandbox.MicrophoneAmplitudeMonitor(), levels = [];
    assert.equal(app.permissionCalls, 0);
    assert.equal(await mic.start(value => levels.push(value)), true);
    app.step(); assert.ok(levels.some(value => value > 0));
    assert.equal(await mic.start(() => {}), true); assert.equal(app.permissionCalls, 1);
    mic.stop(); mic.stop();
    assert.equal(app.frames.size, 0); assert.equal(app.stream.stopped, 1);
    assert.equal(app.audio.closes, 1); assert.equal(app.audio.disconnects, 2);
});

test('late microphone permission grants after stop immediately release the stream', async () => {
    const app = setup(), mic = new app.sandbox.MicrophoneAmplitudeMonitor();
    let grant;
    app.sandbox.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
    const pending = mic.start(() => {}); mic.stop(); grant(app.stream);
    assert.equal(await pending, false); assert.equal(app.stream.stopped, 1);
    assert.equal(app.frames.size, 0); assert.equal(mic.stream, null);
});

test('audio initialization failures release the acquired microphone', async () => {
    const app = setup(), mic = new app.sandbox.MicrophoneAmplitudeMonitor();
    app.sandbox.window.AudioContext = undefined;
    await assert.rejects(mic.start(() => {}), /not supported/);
    assert.equal(app.stream.stopped, 1); assert.equal(app.frames.size, 0); assert.equal(mic.starting, false);
});

test('speaking follows the agent voice and hands off cleanly to listening', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root);
    orb.setState('speaking'); orb.setAmplitude(.9); app.step(100); app.step(117);
    assert.equal(orb.state, 'speaking'); assert.equal(app.root.dataset.state, 'speaking');
    assert.ok(orb.amplitude > 0, 'agent speech drives the orb');
    orb.setState('listening');
    assert.equal(orb.targetAmplitude, 0, 'the next speaker starts from their own level');
    orb.setState('connecting'); assert.equal(orb.state, 'connecting'); assert.equal(orb.amplitude, 0);
    orb.setBands({ low: 1, mid: 1, high: 1 }); assert.equal(orb.targetBands.low, 0, 'bands ignored while not live');
    orb.destroy();
});

test('audio bands are clamped, smoothed and settle when the voice stops', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root, { variant: 'immersive' });
    orb.setState('listening'); orb.setBands({ low: 3, mid: .5, high: -1 });
    assert.deepEqual({ ...orb.targetBands }, { low: 1, mid: .5, high: 0 });
    app.step(100); for (let time = 117; time < 400; time += 17) app.step(time);
    assert.ok(orb.bands.low > .6 && orb.bands.mid > .3);
    orb.setState('processing');
    for (let time = 400; time < 2400; time += 17) app.step(time);
    assert.ok(orb.bands.low < .01, 'immersive bands decay smoothly instead of snapping');
    orb.destroy();
});

test('immersive blob outline deforms with audio and stays bounded', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root, { variant: 'immersive', labels: { speaking: 'V is talking' } });
    orb.setState('speaking'); assert.equal(app.status.textContent, 'V is talking');
    const calm = orb.blobOutline(1, 1, 0, { low: 0, mid: 0, high: 0 });
    const loud = orb.blobOutline(1, 1, 1, { low: 1, mid: 1, high: 1 });
    assert.equal(calm.length, loud.length);
    const spread = points => Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]));
    assert.ok(spread(loud) > spread(calm), 'loud audio deforms the envelope more');
    assert.ok(loud.every(([, scale]) => scale > .7 && scale < 1.3), 'deformation stays inside the fill bounds');
    const draws = app.draws; app.step(100); assert.ok(app.draws > draws);
    orb.destroy();
});

test('an orb without a status element still renders and changes state', () => {
    const app = setup();
    app.root.querySelector = selector => selector === 'canvas' ? app.canvas : null;
    const orb = new app.sandbox.VoiceOrb(app.root, { variant: 'immersive' });
    orb.setState('speaking'); assert.equal(orb.state, 'speaking'); orb.destroy();
});

test('the immersive orb winds down from speech instead of snapping still', () => {
    const app = setup(), orb = new app.sandbox.VoiceOrb(app.root, { variant: 'immersive' });
    orb.setState('speaking'); orb.setAmplitude(1);
    app.step(100); for (let time = 117; time < 400; time += 17) app.step(time);
    const loud = orb.amplitude;
    orb.setState('idle');
    assert.ok(orb.amplitude > .9 * loud, 'no snap on the state change');
    app.step(417); app.step(434); // the first frame after a state change restarts the clock
    assert.ok(orb.amplitude < loud && orb.amplitude > 0, 'it eases down');
    for (let time = 451; time < 2500; time += 17) app.step(time);
    assert.ok(orb.amplitude < .01, 'and settles');
    orb.destroy();
});
