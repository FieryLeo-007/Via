var VALID_STATES = new Set(["idle", "listening", "processing", "error"]);

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
        this.state = "idle";
        this.amplitude = this.targetAmplitude = 0;
        this.frame = null;
        this.visible = true;
        this.destroyed = false;
        this.size = this.lastTime = this.phase = 0;
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
        this.state = VALID_STATES.has(nextState) ? nextState : "idle";
        this.root.dataset.state = this.state;
        const labels = { idle: "Ready for your request", listening: "Listening · audio stays on this device", processing: "Finding your matches", error: "Something went wrong. Please retry." };
        this.status.textContent = message || labels[this.state];
        this.status.setAttribute("aria-live", "polite");
        this.status.setAttribute("aria-atomic", "true");
        if (this.state !== "listening") this.amplitude = this.targetAmplitude = 0;
        if (this.state === "error") this.phase = 0;
        this.syncAnimation();
        this.draw();
    }

    setAmplitude(value) {
        if (this.destroyed || this.state !== "listening") return;
        this.targetAmplitude = clamp(Number(value) || 0, 0, 1);
        // Reduced motion stays genuinely static, even while the microphone samples.
    }

    resize() {
        if (this.destroyed) return;
        const size = Math.max(1, this.root.getBoundingClientRect().width);
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
        this.phase += delta * (this.state === "processing" ? .00065 : .00022);
        const smoothing = this.targetAmplitude > this.amplitude ? .3 : .09;
        this.amplitude += (this.targetAmplitude - this.amplitude) * smoothing * (delta / 16.67);
        this.draw();
        this.frame = requestAnimationFrame(next => this.tick(next));
    }

    draw() {
        if (this.destroyed || !this.context || !this.size) return;
        const ctx = this.context, size = this.size, c = size / 2;
        const staticState = this.reducedMotion || this.state === "error";
        const t = staticState ? 0 : this.phase;
        const amplitude = !staticState && this.state === "listening" ? this.amplitude : 0;
        const r = size * .345 * (1 + Math.sin(t * 1.6) * .008 + amplitude * .018);
        const opaque = this.transparencyMedia.matches || this.contrastMedia.matches;
        const circle = radius => { ctx.beginPath(); ctx.arc(c, c, radius, 0, Math.PI * 2); };
        ctx.clearRect(0, 0, size, size);

        // Halo and ground shadow stay bounded; no animated CSS blur or layout changes.
        let gradient = ctx.createRadialGradient(c, c, r * .6, c, c, r * 1.4);
        gradient.addColorStop(0, "rgba(52,211,153,.15)");
        gradient.addColorStop(.65, "rgba(52,211,153,.07)");
        gradient.addColorStop(1, "rgba(52,211,153,0)");
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
        ctx.fillStyle = gradient; ctx.fillRect(c - r, c - r, r * 2, r * 2);
        const colors = ["8,76,43", "24,143,94", "174,217,191"];
        for (let i = 0; i < 3; i++) {
            const angle = t + i * Math.PI * 2 / 3;
            const x = c + Math.cos(angle) * r * .48, y = c + Math.sin(angle * .85 + i) * r * .42;
            gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 1.13);
            gradient.addColorStop(0, "rgba(" + colors[i] + "," + (.64 + amplitude * .12) + ")");
            gradient.addColorStop(.5, "rgba(" + colors[i] + ",.25)");
            gradient.addColorStop(1, "rgba(" + colors[i] + ",0)");
            ctx.fillStyle = gradient; ctx.fillRect(c - r, c - r, r * 2, r * 2);
        }

        // Curved liquid ribbons, not an opaque deforming outer blob.
        ctx.save(); ctx.translate(c, c); ctx.rotate(t * .6);
        for (let i = 0; i < 5; i++) {
            const y = (i - 2) * r * .24;
            const wave = Math.sin(t * 1.8 + i * .8) * r * (.12 + amplitude * .3);
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
        ctx.beginPath(); ctx.arc(c, c, r * .95, Math.PI * 1.1, Math.PI * 1.65); ctx.stroke();
        if (amplitude > .02) {
            for (let i = 0; i < 2; i++) {
                const progress = (t * 1.6 + i * .5) % 1;
                ctx.strokeStyle = "rgba(11,107,58," + ((1 - progress) * amplitude * .24) + ")";
                ctx.lineWidth = 1; circle(r * (1.04 + progress * .24)); ctx.stroke();
            }
        }
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
