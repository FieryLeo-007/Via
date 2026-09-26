var VALID_STATES = new Set(["idle", "listening", "processing", "speaking"]);

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export class MicrophoneAmplitudeMonitor {
    constructor() {
        this.stream = null;
        this.context = null;
        this.analyser = null;
        this.source = null;
        this.frame = null;
        this.samples = null;
        this.smoothedAmplitude = 0;
    }

    async start(onAmplitude) {
        if (this.stream) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Microphone input is not supported in this browser.");
        }

        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
        });

        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            this.stop();
            throw new Error("Live audio analysis is not supported in this browser.");
        }

        this.context = new AudioContextClass();
        if (this.context.state === "suspended") await this.context.resume();
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.76;
        this.source = this.context.createMediaStreamSource(this.stream);
        this.source.connect(this.analyser);
        this.samples = new Float32Array(this.analyser.fftSize);

        var readLevel = () => {
            if (!this.analyser) return;
            this.analyser.getFloatTimeDomainData(this.samples);
            var sum = 0;
            for (var i = 0; i < this.samples.length; i += 1) sum += this.samples[i] * this.samples[i];
            var rms = Math.sqrt(sum / this.samples.length);
            // Lift ordinary speech into the expressive part of the animation while
            // retaining enough headroom for louder syllables to feel meaningfully bigger.
            var normalized = clamp((rms - 0.008) / 0.085, 0, 1);
            normalized = Math.pow(normalized, 0.62);
            var smoothing = normalized > this.smoothedAmplitude ? 0.42 : 0.095;
            this.smoothedAmplitude += (normalized - this.smoothedAmplitude) * smoothing;
            onAmplitude(this.smoothedAmplitude);
            this.frame = requestAnimationFrame(readLevel);
        };

        readLevel();
    }

    stop() {
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
    }
}

export class VoiceOrb {
    constructor(root, options) {
        this.root = root;
        this.canvas = root.querySelector("canvas");
        this.context = this.canvas.getContext("2d", { alpha: true });
        this.status = root.querySelector(".voice-orb-status");
        this.reducedMotion = Boolean(options?.reducedMotion);
        this.state = "idle";
        this.amplitude = 0;
        this.targetAmplitude = 0;
        this.frame = null;
        this.visible = true;
        this.size = 0;
        this.lastTime = 0;
        this.startTime = performance.now();

        this.resizeObserver = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => this.resize())
            : null;
        this.resizeObserver?.observe(root);

        this.intersectionObserver = typeof IntersectionObserver !== "undefined"
            ? new IntersectionObserver(entries => {
                this.visible = entries[0].isIntersecting;
                this.syncAnimation();
            }, { threshold: 0.01 })
            : null;
        this.intersectionObserver?.observe(root);

        this.onVisibilityChange = () => this.syncAnimation();
        document.addEventListener("visibilitychange", this.onVisibilityChange);
        this.resize();
        this.setState("idle");
    }

    setState(nextState) {
        this.state = VALID_STATES.has(nextState) ? nextState : "idle";
        this.root.dataset.state = this.state;
        var labels = {
            idle: "Ready for your request",
            listening: "Listening",
            processing: "Thinking",
            speaking: "Speaking"
        };
        this.status.textContent = labels[this.state];
        this.root.setAttribute("aria-label", "ProjectV voice assistant: " + labels[this.state].toLowerCase());
        if (this.state !== "listening" && this.state !== "speaking") this.targetAmplitude = 0;
        this.syncAnimation();
    }

    setAmplitude(value) {
        this.targetAmplitude = clamp(Number(value) || 0, 0, 1) * 0.7;
        if (this.reducedMotion) {
            this.amplitude += (this.targetAmplitude - this.amplitude) * 0.2;
            this.draw(performance.now());
        }
    }

    resize() {
        var rect = this.root.getBoundingClientRect();
        var size = Math.max(1, Math.min(rect.width, rect.height - 28));
        var pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(size * pixelRatio);
        this.canvas.height = Math.round(size * pixelRatio);
        this.canvas.style.width = size + "px";
        this.canvas.style.height = size + "px";
        this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        this.size = size;
        this.draw(performance.now());
    }

    syncAnimation() {
        var shouldRun = !this.reducedMotion && this.visible && !document.hidden;
        if (shouldRun && this.frame === null) this.frame = requestAnimationFrame(time => this.tick(time));
        if (!shouldRun && this.frame !== null) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
        }
        if (!shouldRun) this.draw(performance.now());
    }

    tick(time) {
        var delta = Math.min(time - (this.lastTime || time), 34);
        this.lastTime = time;
        var isVoiceState = this.state === "listening" || this.state === "speaking";
        var smoothing = isVoiceState
            ? (this.targetAmplitude > this.amplitude ? 0.17 : 0.07)
            : (this.targetAmplitude > this.amplitude ? 0.26 : 0.08);
        this.amplitude += (this.targetAmplitude - this.amplitude) * smoothing * (delta / 16.67);
        this.draw(time);
        this.frame = requestAnimationFrame(nextTime => this.tick(nextTime));
    }

    stateEnergy(time) {
        if (this.state === "processing") return 0.27 + Math.sin(time * 0.003) * 0.035;
        if (this.state === "speaking") return Math.max(0.58, 0.16 + this.amplitude * 0.9);
        if (this.state === "listening") {
            return this.amplitude < 0.015 ? 0.045 : 0.13 + this.amplitude * 0.82;
        }
        return 0.22 + Math.sin(time * 0.0012) * 0.018;
    }

    createPoints(time, radius, energy, layer) {
        var points = [];
        var count = 72;
        var idleRate = this.state === "idle" ? 0.00155 : 0.00048;
        var idleTime = (time - this.startTime) * idleRate;
        var isVoiceActive = this.state === "listening" || this.state === "speaking";
        var activeSpeed = this.state === "processing" ? 1.7 : isVoiceActive ? 2.25 + energy * 0.5 : 1.15;
        for (var i = 0; i < count; i += 1) {
            var angle = i / count * Math.PI * 2;
            var idle = Math.sin(angle * 3 + idleTime + layer * 1.8) * radius * 0.052
                + Math.sin(angle * 4 - idleTime * 0.72 + layer) * radius * 0.034;
            var speech = Math.sin(angle * 2 + idleTime * activeSpeed + layer) * radius * energy * 0.15
                + Math.sin(angle * 5 - idleTime * activeSpeed * 1.23 + layer * 2.4) * radius * energy * 0.092
                + Math.sin(angle * 8 + idleTime * activeSpeed * 0.91 + layer * 0.6) * radius * energy * 0.048;
            // A traveling lobe makes different parts of the surface push and recede
            // instead of reading as a uniform scale animation.
            var lobeCenter = idleTime * activeSpeed * 0.72 + layer * 1.47;
            var lobe = Math.pow(Math.max(0, Math.cos(angle - lobeCenter)), 5)
                * radius * energy * 0.115;
            var counterLobe = -Math.pow(Math.max(0, Math.cos(angle - lobeCenter - Math.PI * 0.72)), 7)
                * radius * energy * 0.066;
            var r = radius + idle + speech + lobe + counterLobe;
            points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
        }
        return points;
    }

    traceShape(points, center) {
        var ctx = this.context;
        var last = points[points.length - 1];
        var first = points[0];
        var start = midpoint(last, first);
        ctx.beginPath();
        ctx.moveTo(center + start.x, center + start.y);
        for (var i = 0; i < points.length; i += 1) {
            var point = points[i];
            var next = points[(i + 1) % points.length];
            var mid = midpoint(point, next);
            ctx.quadraticCurveTo(center + point.x, center + point.y, center + mid.x, center + mid.y);
        }
        ctx.closePath();
    }

    draw(time) {
        if (!this.context || !this.size) return;
        var ctx = this.context;
        var size = this.size;
        var center = size / 2;
        var energy = this.stateEnergy(time);
        var radius = size * 0.305;
        ctx.clearRect(0, 0, size, size);

        ctx.save();
        ctx.filter = "blur(" + Math.round(size * 0.06) + "px)";
        ctx.globalAlpha = 0.15 + energy * 0.22;
        ctx.fillStyle = "#1d6552";
        ctx.beginPath();
        ctx.ellipse(center, center + radius * 0.74, radius * 0.74, radius * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.filter = "blur(" + Math.round(size * 0.07) + "px)";
        ctx.globalAlpha = 0.14 + energy * 0.42;
        ctx.fillStyle = "#5fc2a4";
        this.traceShape(this.createPoints(time, radius * 1.12, energy * 0.55, 3), center);
        ctx.fill();
        ctx.restore();

        var baseGradient = ctx.createRadialGradient(center - radius * 0.34, center - radius * 0.4, radius * 0.06, center, center, radius * 1.15);
        baseGradient.addColorStop(0, "rgba(248,250,246,0.98)");
        baseGradient.addColorStop(0.2, "rgba(157,219,193,0.98)");
        baseGradient.addColorStop(0.57, "rgba(29,101,82,0.98)");
        baseGradient.addColorStop(1, "rgba(13,51,43,0.99)");
        this.traceShape(this.createPoints(time, radius, energy, 0), center);
        ctx.fillStyle = baseGradient;
        ctx.shadowColor = "rgba(29,101,82," + Math.min(0.76, 0.26 + energy * 0.44).toFixed(3) + ")";
        ctx.shadowBlur = size * (0.075 + energy * 0.065);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.save();
        this.traceShape(this.createPoints(time, radius * 0.92, energy * 0.78, 1), center);
        var innerGradient = ctx.createRadialGradient(center + radius * 0.2, center + radius * 0.15, 0, center, center, radius);
        innerGradient.addColorStop(0, "rgba(116,210,171,0.48)");
        innerGradient.addColorStop(0.62, "rgba(29,101,82,0.1)");
        innerGradient.addColorStop(1, "rgba(5,27,16,0.38)");
        ctx.fillStyle = innerGradient;
        ctx.globalCompositeOperation = "screen";
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.translate(center - radius * 0.28, center - radius * 0.34);
        ctx.rotate(-0.42);
        var sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.58);
        sheen.addColorStop(0, "rgba(255,255,255,0.62)");
        sheen.addColorStop(0.45, "rgba(255,255,255,0.14)");
        sheen.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = sheen;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 0.44, radius * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    destroy() {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.resizeObserver?.disconnect();
        this.intersectionObserver?.disconnect();
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
}
