var VALID_STATES = new Set(["idle", "connecting", "listening", "speaking", "processing", "error"]);
// States whose motion follows live audio: the shopper's voice, or the agent's.
var REACTIVE_STATES = new Set(["listening", "speaking"]);
var DEFAULT_LABELS = { idle: "Ready for your request", connecting: "Connecting", listening: "Listening · audio stays on this device", speaking: "Speaking", processing: "Finding your matches", error: "Something went wrong. Please retry." };
// Immersive palettes: [deep, mid, light] liquid colors and the halo, per state.
var PALETTES = {
    idle: [["8,76,43", "24,143,94", "174,217,191"], "52,211,153"],
    connecting: [["11,107,58", "52,211,153", "217,251,232"], "52,211,153"],
    listening: [["14,138,75", "52,211,153", "217,251,232"], "52,211,153"],
    speaking: [["5,27,16", "11,107,58", "52,211,153"], "22,167,101"],
    processing: [["8,76,43", "22,167,101", "196,216,196"], "24,143,94"],
    error: [["8,76,43", "24,143,94", "174,217,191"], "52,211,153"]
};

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export class MicrophoneAmplitudeMonitor {
    constructor() {
        this.generation = 0;
        this.starting = false;
        this.stream = null;
        this.context = null;
        this.analyser = null;
        this.source = null;
        this.frame = null;
        this.samples = null;
        this.smoothedAmplitude = 0;
        this.noiseFloor = null;
        this.peakHoldUntil = 0;
    }

    async start(onAmplitude) {
        if (this.stream) return true;
        if (this.starting) return false;
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone input is not supported in this browser.");
        const generation = ++this.generation;
        this.starting = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false }, video: false
            });
            // Permission dialogs can finish after navigation or a cancelled request.
            if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
            this.stream = stream;
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) throw new Error("Live audio analysis is not supported in this browser.");
            this.context = new AudioContextClass();
            if (this.context.state === "suspended") await this.context.resume();
            if (generation !== this.generation) return false;
            this.analyser = this.context.createAnalyser();
            this.analyser.fftSize = 1024;
            this.analyser.smoothingTimeConstant = 0;
            this.source = this.context.createMediaStreamSource(this.stream);
            this.source.connect(this.analyser);
            this.samples = new Float32Array(this.analyser.fftSize);
            var readLevel = () => {
                if (!this.analyser || generation !== this.generation) return;
                this.analyser.getFloatTimeDomainData(this.samples);
                var sum = 0;
                var peak = 0;
                for (var i = 0; i < this.samples.length; i += 1) {
                    var sample = Math.abs(this.samples[i]);
                    sum += sample * sample;
                    peak = Math.max(peak, sample);
                }
                var rms = Math.sqrt(sum / this.samples.length);

                // Follow the room's baseline only while the input is quiet. This gives
                // laptop microphones and external microphones the same useful range,
                // without allowing speech to raise the noise gate while somebody talks.
                if (this.noiseFloor === null) this.noiseFloor = clamp(rms, 0.0015, 0.03);
                var isNearFloor = rms < this.noiseFloor * 1.8;
                if (isNearFloor || rms < this.noiseFloor) {
                    var floorSpeed = rms < this.noiseFloor ? 0.08 : 0.008;
                    this.noiseFloor += (rms - this.noiseFloor) * floorSpeed;
                    this.noiseFloor = clamp(this.noiseFloor, 0.0015, 0.04);
                }

                // RMS follows speech body; the weighted sample peak catches claps and
                // consonants that can disappear inside an RMS window.
                var level = Math.max(rms, peak * 0.38);
                var gate = this.noiseFloor * 1.45 + 0.0015;
                var normalized = clamp((level - gate) / Math.max(0.045, 0.16 - gate), 0, 1);
                normalized = Math.pow(normalized, 0.58);

                var now = performance.now();
                if (normalized > this.smoothedAmplitude) {
                    this.smoothedAmplitude += (normalized - this.smoothedAmplitude) * 0.72;
                    this.peakHoldUntil = now + 72;
                } else if (now >= this.peakHoldUntil) {
                    this.smoothedAmplitude += (normalized - this.smoothedAmplitude) * 0.13;
                }
                if (this.smoothedAmplitude < 0.008) this.smoothedAmplitude = 0;
                onAmplitude(this.smoothedAmplitude);
                if (generation === this.generation) this.frame = requestAnimationFrame(readLevel);
            };


            readLevel();
            return true;
        } catch (error) {
            if (generation !== this.generation) return false;
            this.stop();
            throw error;
        } finally {
            if (generation === this.generation) this.starting = false;
        }
    }

    stop() {
        this.generation += 1;
        this.starting = false;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.source?.disconnect();
        this.analyser?.disconnect();
        this.stream?.getTracks().forEach(function (track) { track.stop(); });
        if (this.context && this.context.state !== "closed") this.context.close().catch(function () {});
        this.stream = null;
        this.context = null;
        this.analyser = null;
        this.source = null;
        this.samples = null;
        this.smoothedAmplitude = 0;
        this.noiseFloor = null;
        this.peakHoldUntil = 0;
    }
}

export class VoiceOrb {
    constructor(root, options) {
        this.root = root;
        this.canvas = root.querySelector("canvas");
        this.context = this.canvas.getContext("2d", { alpha: true });
        this.status = root.querySelector(".voice-orb-status");
        this.motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.transparencyMedia = window.matchMedia("(prefers-reduced-transparency: reduce)");
        this.contrastMedia = window.matchMedia("(prefers-contrast: more)");
        this.reducedMotion = Boolean(options?.reducedMotion || this.motionMedia.matches);
        // "immersive" lets the glass envelope deform into a living blob driven by audio bands.
        this.immersive = options?.variant === "immersive";
        this.labels = { ...DEFAULT_LABELS, ...(options?.labels || {}) };
        this.state = "idle";
        this.amplitude = this.targetAmplitude = 0;
        this.bands = { low: 0, mid: 0, high: 0 };
        this.targetBands = { low: 0, mid: 0, high: 0 };
        this.frame = null;
        this.visible = true;
        this.destroyed = false;
        this.size = this.lastTime = this.phase = this.speechPhase = 0;
        this.onPreferenceChange = () => {
            this.reducedMotion = this.motionMedia.matches;
            this.syncAnimation();
            this.draw();
        };
        [this.motionMedia, this.transparencyMedia, this.contrastMedia].forEach(media => media.addEventListener("change", this.onPreferenceChange));
        this.resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.resize()) : null;
        this.resizeObserver?.observe(root);
        this.intersectionObserver = typeof IntersectionObserver !== "undefined"
            ? new IntersectionObserver(entries => { this.visible = entries[0].isIntersecting; this.syncAnimation(); }, { threshold: 0.01 }) : null;
        this.intersectionObserver?.observe(root);
        this.onVisibilityChange = () => this.syncAnimation();
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        this.resize();
        this.setState("idle");
    }

    setState(nextState, message) {
        if (this.destroyed) return;
        const previous = this.state;
        this.state = VALID_STATES.has(nextState) ? nextState : "idle";
        this.root.dataset.state = this.state;
        if (this.status) {
            this.status.textContent = message || this.labels[this.state];
            this.status.setAttribute("aria-live", "polite");
            this.status.setAttribute("aria-atomic", "true");
        }
        if (!REACTIVE_STATES.has(this.state)) {
            this.targetAmplitude = 0;
            this.targetBands = { low: 0, mid: 0, high: 0 };
            // The immersive blob winds down from speech instead of snapping still.
            if (!this.immersive) {
                this.amplitude = 0;
                this.speechPhase = 0;
                this.bands = { low: 0, mid: 0, high: 0 };
            }
        } else if (previous !== this.state) {
            // Hand-offs between the shopper and the agent start from the new speaker's level.
            this.targetAmplitude = 0;
        }
        if (this.state === "error") this.phase = 0;
        this.syncAnimation();
        this.draw();
    }

    setAmplitude(value) {
        if (this.destroyed || !REACTIVE_STATES.has(this.state)) return;
        this.targetAmplitude = clamp(Number(value) || 0, 0, 1);
        // Reduced motion stays genuinely static, even while the microphone samples.
    }

    // Optional spectral detail (0..1 each). Low swells the body, high adds surface ripples.
    setBands(bands) {
        if (this.destroyed || !REACTIVE_STATES.has(this.state) || !bands) return;
        this.targetBands = { low: clamp(Number(bands.low) || 0, 0, 1), mid: clamp(Number(bands.mid) || 0, 0, 1), high: clamp(Number(bands.high) || 0, 0, 1) };
    }

    resize() {
        if (this.destroyed) return;
        // Layout width ignores CSS transforms, so a scaled-down orb keeps its drawing size.
        const size = Math.max(1, this.root.clientWidth || this.root.getBoundingClientRect().width);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = this.canvas.height = Math.round(size * ratio);
        this.canvas.style.width = this.canvas.style.height = size + "px";
        this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.size = size;
        this.draw();
    }

    syncAnimation() {
        if (this.destroyed) return;
        const shouldRun = this.context && !this.reducedMotion && this.state !== "error" && this.visible && !document.hidden;
        if (!shouldRun && this.frame !== null) { cancelAnimationFrame(this.frame); this.frame = null; }
        this.lastTime = 0;
        if (shouldRun && this.frame === null) this.frame = requestAnimationFrame(time => this.tick(time));
    }

    tick(time) {
        this.frame = null;
        if (this.destroyed || this.reducedMotion || this.state === "error" || !this.visible || document.hidden) return;
        const delta = Math.min(Math.max(time - (this.lastTime || time), 0), 34);
        this.lastTime = time;
        this.phase += delta * (this.state === "processing" ? .00065 : this.state === "connecting" ? .0004 : .00022);
        // Fast attack catches syllables; slower release lets the glass reverberate.
        const responseTime = this.targetAmplitude > this.amplitude ? 45 : 180;
        this.amplitude += (this.targetAmplitude - this.amplitude) * (1 - Math.exp(-delta / responseTime));
        for (const band of ["low", "mid", "high"]) {
            const target = this.targetBands[band], bandTime = target > this.bands[band] ? 60 : 240;
            this.bands[band] += (target - this.bands[band]) * (1 - Math.exp(-delta / bandTime));
        }
        if (REACTIVE_STATES.has(this.state) || (this.immersive && this.amplitude > .005)) this.speechPhase += delta * (.002 + this.amplitude * .007);
        this.draw();
        this.frame = requestAnimationFrame(next => this.tick(next));
    }

    draw() {
        if (this.destroyed || !this.context || !this.size) return;
        const ctx = this.context, size = this.size, c = size / 2;
        const staticState = this.reducedMotion || this.state === "error";
        const t = staticState ? 0 : this.phase;
        // Immersive orbs keep drawing the decaying level after a speaker stops.
        const reactive = !staticState && (REACTIVE_STATES.has(this.state) || this.immersive);
        const amplitude = reactive ? this.amplitude : 0;
        const speech = staticState ? 0 : this.speechPhase;
        const bands = reactive ? this.bands : { low: 0, mid: 0, high: 0 };
        const breathe = this.state === "connecting" && !staticState ? Math.sin(t * 9) * .025 : 0;
        const r = size * (this.immersive ? .3 : .345) * (1 + Math.sin(t * 1.6) * .008 + breathe + amplitude * (.045 + Math.sin(speech * 2) * .018) + bands.low * (this.immersive ? .05 : 0));
        const opaque = this.transparencyMedia.matches || this.contrastMedia.matches;
        const [colors, halo] = this.immersive ? PALETTES[this.state] : PALETTES.idle;
        const blob = this.immersive && !staticState ? this.blobOutline(t, speech, amplitude, bands) : null;
        // A deformed envelope can bulge past r, so its fills must cover the bulge.
        const fill = blob ? r * 1.35 : r;
        // The immersive envelope is a closed smooth curve through radially displaced points.
        const circle = radius => {
            ctx.beginPath();
            if (!blob) { ctx.arc(c, c, radius, 0, Math.PI * 2); return; }
            const points = blob.map(([angle, scale]) => [c + Math.cos(angle) * radius * scale, c + Math.sin(angle) * radius * scale]);
            const count = points.length;
            ctx.moveTo((points[0][0] + points[count - 1][0]) / 2, (points[0][1] + points[count - 1][1]) / 2);
            for (let i = 0; i < count; i++) {
                const point = points[i], next = points[(i + 1) % count];
                ctx.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
            }
            ctx.closePath();
        };
        ctx.clearRect(0, 0, size, size);

        // Halo and ground shadow stay bounded; no animated CSS blur or layout changes.
        let gradient = ctx.createRadialGradient(c, c, r * .6, c, c, r * 1.4);
        gradient.addColorStop(0, `rgba(${halo},${.15 + amplitude * .18})`);
        gradient.addColorStop(.65, `rgba(${halo},${.07 + amplitude * .09})`);
        gradient.addColorStop(1, `rgba(${halo},0)`);
        ctx.fillStyle = gradient; circle(r * 1.4); ctx.fill();
        ctx.save();
        ctx.translate(c, c + r * 1.08); ctx.scale(1, .16);
        gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r * .85);
        gradient.addColorStop(0, "rgba(11,107,58,.13)"); gradient.addColorStop(1, "rgba(11,107,58,0)");
        ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, r * .85, 0, Math.PI * 2); ctx.fill(); ctx.restore();

        // An almost circular glass envelope contains all of the flowing color.
        ctx.save(); circle(r); ctx.clip();
        gradient = ctx.createLinearGradient(c - r, c - r, c + r, c + r);
        gradient.addColorStop(0, opaque ? "#F7FAF8" : "rgba(255,255,255,.72)");
        gradient.addColorStop(.48, opaque ? "#D9FBE8" : "rgba(217,251,232,.35)");
        gradient.addColorStop(1, opaque ? "#C4D8C4" : "rgba(196,216,196,.55)");
        ctx.fillStyle = gradient; ctx.fillRect(c - fill, c - fill, fill * 2, fill * 2);
        for (let i = 0; i < 3; i++) {
            const angle = t + Math.sin(speech + i) * amplitude * .45 + i * Math.PI * 2 / 3;
            const x = c + Math.cos(angle) * r * .48, y = c + Math.sin(angle * .85 + i) * r * .42;
            gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 1.13);
            gradient.addColorStop(0, "rgba(" + colors[i] + "," + (.64 + amplitude * .12) + ")");
            gradient.addColorStop(.5, "rgba(" + colors[i] + ",.25)");
            gradient.addColorStop(1, "rgba(" + colors[i] + ",0)");
            ctx.fillStyle = gradient; ctx.fillRect(c - fill, c - fill, fill * 2, fill * 2);
        }

        // Curved liquid ribbons, not an opaque deforming outer blob.
        ctx.save(); ctx.translate(c, c); ctx.rotate(t * .6 + Math.sin(speech * .6) * amplitude * .18);
        for (let i = 0; i < 5; i++) {
            const y = (i - 2) * r * .24;
            const wave = r * (Math.sin(t * 1.8 + i * .8) * .12
                + Math.sin(speech * 2.4 + i * 1.1) * amplitude * .48);
            gradient = ctx.createLinearGradient(-r, y - r * .3, r, y + r * .3);
            gradient.addColorStop(0, "rgba(11,107,58,0)");
            gradient.addColorStop(.4, i % 2 ? "rgba(255,255,255,.48)" : "rgba(11,107,58,.32)");
            gradient.addColorStop(.7, "rgba(24,143,94,.36)");
            gradient.addColorStop(1, "rgba(217,251,232,0)");
            ctx.beginPath(); ctx.moveTo(-r * 1.2, y);
            ctx.bezierCurveTo(-r * .55, y - r * .7 + wave, r * .25, y + r * .8 - wave, r * 1.2, y);
            ctx.bezierCurveTo(r * .25, y + r * .44 - wave, -r * .55, y - r * .35 + wave, -r * 1.2, y);
            ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
        }
        ctx.restore();
        if (this.immersive && this.state === "speaking" && amplitude > .02) {
            // The agent's voice glows outward from the core rather than rippling in from the rim.
            gradient = ctx.createRadialGradient(c, c, 0, c, c, r * (.55 + amplitude * .5));
            gradient.addColorStop(0, `rgba(217,251,232,${.2 + amplitude * .45})`);
            gradient.addColorStop(1, "rgba(217,251,232,0)");
            ctx.fillStyle = gradient; ctx.fillRect(c - r * 1.2, c - r * 1.2, r * 2.4, r * 2.4);
        }
        gradient = ctx.createRadialGradient(c - r * .32, c - r * .4, 0, c - r * .32, c - r * .4, r * .83);
        gradient.addColorStop(0, "rgba(255,255,255,.8)"); gradient.addColorStop(.25, "rgba(255,255,255,.3)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient; circle(r); ctx.fill();
        ctx.restore();

        // Rim highlights add glass depth without covering content or status text.
        ctx.lineWidth = opaque ? 2 : 1.3;
        gradient = ctx.createLinearGradient(c - r, c - r, c + r, c + r);
        gradient.addColorStop(0, "rgba(255,255,255,.95)"); gradient.addColorStop(.45, "rgba(255,255,255,.28)"); gradient.addColorStop(1, "rgba(11,107,58,.4)");
        ctx.strokeStyle = gradient; circle(r); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = size * .009;
        if (!blob) { ctx.beginPath(); ctx.arc(c, c, r * .95, Math.PI * 1.1, Math.PI * 1.65); ctx.stroke(); }
        if (amplitude > .02 && this.state !== "speaking") {
            for (let i = 0; i < 3; i++) {
                const progress = (speech * .65 + i / 3) % 1;
                ctx.strokeStyle = "rgba(11,107,58," + ((1 - progress) ** 2 * amplitude * .5) + ")";
                ctx.lineWidth = size * .004; circle(r * (1.02 + progress * .28)); ctx.stroke();
            }
        }
    }

    // [angle, radial scale] pairs. Layered slow sines keep it organic; audio bands add
    // broad swells (low), mid-sized lobes (mid) and fine surface shimmer (high).
    blobOutline(t, speech, amplitude, bands) {
        const points = [], count = 14;
        const calm = { idle: .018, connecting: .03, listening: .022, speaking: .03, processing: .045, error: 0 }[this.state];
        for (let i = 0; i < count; i++) {
            const angle = i / count * Math.PI * 2;
            let scale = 1 + calm * (Math.sin(angle * 2 + t * 2.1) + Math.sin(angle * 3 - t * 1.3 + 1.7) * .6);
            scale += amplitude * .07 * Math.sin(angle * 2 + speech * 1.4);
            scale += bands.low * .06 * Math.sin(angle + speech * .9 + 0.6);
            scale += bands.mid * .05 * Math.sin(angle * 4 - speech * 1.7);
            scale += bands.high * .03 * Math.sin(angle * 7 + speech * 3.1);
            points.push([angle, scale]);
        }
        return points;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.resizeObserver?.disconnect(); this.intersectionObserver?.disconnect();
        [this.motionMedia, this.transparencyMedia, this.contrastMedia].forEach(media => media.removeEventListener("change", this.onPreferenceChange));
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
}
