import { animate, motionValue, springValue } from "motion";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { MicrophoneAmplitudeMonitor, VoiceOrb } from "./voice-orb.js";

(function () {
    "use strict";

    /* ---------- Elements ---------- */

    var appMain = document.getElementById("app-main");
    var heroCopy = document.getElementById("hero-copy");
    var composer = document.getElementById("composer");
    var input = document.getElementById("composer-input");
    var voiceBtn = document.getElementById("voice-btn");
    var submitBtn = document.getElementById("submit-btn");
    var pills = document.querySelectorAll(".pill");
    var quickActions = document.getElementById("quick-actions");
    var cursorAura = document.getElementById("cursor-aura");
    var cursorAuraLabel = document.getElementById("cursor-aura-label");
    var ambientBg = document.querySelector(".ambient-bg");
    var contextBtn = document.getElementById("context-btn");
    var preferencesBtn = document.getElementById("preferences-btn");
    var contextPopover = document.getElementById("context-popover");
    var preferencesPopover = document.getElementById("preferences-popover");
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var blob = document.getElementById("agent-blob");
    var voiceOrb = new VoiceOrb(blob, { reducedMotion: reduceMotion });
    var microphoneMonitor = new MicrophoneAmplitudeMonitor();

    var sidebar = document.getElementById("sidebar");
    var sidebarToggle = document.getElementById("sidebar-toggle");
    var sidebarBackdrop = document.getElementById("sidebar-backdrop");
    var mobileMenuBtn = document.getElementById("mobile-menu-btn");
    var newSearchBtn = document.getElementById("new-search-btn");
    var recentListEl = document.getElementById("recent-list");
    var savedListEl = document.getElementById("saved-list");

    var workspacePanel = document.getElementById("workspace-panel");
    var intentChipsEl = document.getElementById("intent-chips");
    var resultsGridEl = document.getElementById("results-grid");
    var liveStatus = document.getElementById("live-status");

    /* ---------- Mock data ---------- */

    var RECENT_SESSIONS = [
        { id: "r1", title: "Lightweight running jacket under $120", query: "Find me a lightweight running jacket under $120" },
        { id: "r2", title: "Compare noise-cancelling headphones", query: "Compare noise-cancelling headphones under $250" },
        { id: "r3", title: "Standing desk for a small apartment", query: "Find the best standing desk for a small apartment" }
    ];

    var SAVED_SESSIONS = [
        { id: "s1", title: "Espresso machine shortlist", query: "Compare espresso machines under $400" }
    ];

    var MOCK_PRODUCTS = [
        { name: "Trail Shell Jacket", brand: "Aer", price: "$118", tag: "Best match", accent: "#0B6B3A" },
        { name: "Nimbus Windbreaker", brand: "Fieldstone", price: "$96", tag: "Lightweight", accent: "#16A765" },
        { name: "Trace Running Shell", brand: "Northmark", price: "$109", tag: "Top rated", accent: "#0B6B3A" },
        { name: "Aero Packable Jacket", brand: "Solene", price: "$89", tag: "Great value", accent: "#16A765" },
        { name: "Vantage Storm Jacket", brand: "Aer", price: "$132", tag: "Premium", accent: "#0B6B3A" },
        { name: "Drift Half-Zip Shell", brand: "Northmark", price: "$74", tag: "Budget pick", accent: "#16A765" }
    ];

    var ICON_RECENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4l3 2"/></svg>';
    var ICON_SAVED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z"/></svg>';

    /* ---------- Helpers ---------- */

    function truncate(str, n) {
        if (str.length <= n) return str;
        return str.slice(0, n - 1).trimEnd() + "…";
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function (ch) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
    }

    function announce(msg) {
        liveStatus.textContent = "";
        window.setTimeout(function () {
            liveStatus.textContent = msg;
        }, 60);
    }

    function crossfadeReplace(el, buildFn, duration) {
        duration = duration || 160;
        el.style.transition = "opacity " + duration + "ms ease";
        el.style.opacity = "0";
        window.setTimeout(function () {
            buildFn();
            requestAnimationFrame(function () {
                el.style.opacity = "1";
            });
        }, duration);
    }

    /* ---------- Cursor aura and ambient pointer light ---------- */

    if (!reduceMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        var trailLayer = document.createElement("div");
        trailLayer.className = "cursor-trail";
        trailLayer.setAttribute("aria-hidden", "true");
        document.body.appendChild(trailLayer);

        var cursorTargetX = motionValue(-100);
        var cursorTargetY = motionValue(-100);
        var cursorX = springValue(cursorTargetX, { stiffness: 520, damping: 38, mass: 0.35 });
        var cursorY = springValue(cursorTargetY, { stiffness: 520, damping: 38, mass: 0.35 });
        var ambientTargetX = motionValue(50);
        var ambientTargetY = motionValue(34);
        var ambientX = springValue(ambientTargetX, { stiffness: 42, damping: 20, mass: 1.2 });
        var ambientY = springValue(ambientTargetY, { stiffness: 42, damping: 20, mass: 1.2 });
        var pointerFrameQueued = false;
        var lastTrailPoint = null;
        var lastTrailTime = 0;

        function emitCursorTrail(x, y, velocityX, velocityY) {
            var tile = document.createElement("span");
            tile.className = "cursor-trail-tile";
            tile.style.left = x + "px";
            tile.style.top = y + "px";
            tile.style.setProperty("--trail-angle", Math.atan2(velocityY, velocityX) * 180 / Math.PI + "deg");
            trailLayer.appendChild(tile);

            var driftX = Math.max(-12, Math.min(12, velocityX * -0.045));
            var driftY = Math.max(-12, Math.min(12, velocityY * -0.045));
            tile.animate([
                { opacity: 0.34, transform: "translate(-50%, -50%) rotate(var(--trail-angle)) scale(0.82)" },
                { opacity: 0, transform: "translate(calc(-50% + " + driftX.toFixed(2) + "px), calc(-50% + " + driftY.toFixed(2) + "px)) rotate(var(--trail-angle)) scale(0.2)" }
            ], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }).finished.finally(function () {
                tile.remove();
            });
        }

        function renderPointerEffects() {
            pointerFrameQueued = false;
            cursorAura.style.transform = "translate3d(" + cursorX.get().toFixed(2) + "px, " + cursorY.get().toFixed(2) + "px, 0) translate(-50%, -50%)";
            ambientBg.style.setProperty("--pointer-x", ambientX.get().toFixed(2) + "%");
            ambientBg.style.setProperty("--pointer-y", ambientY.get().toFixed(2) + "%");
        }

        function queuePointerEffects() {
            if (!pointerFrameQueued) {
                pointerFrameQueued = true;
                requestAnimationFrame(renderPointerEffects);
            }
        }

        [cursorX, cursorY, ambientX, ambientY].forEach(function (value) {
            value.on("change", queuePointerEffects);
        });

        document.addEventListener("pointermove", function (event) {
            if (event.pointerType === "touch") return;
            cursorTargetX.set(event.clientX);
            cursorTargetY.set(event.clientY);
            ambientTargetX.set(event.clientX / window.innerWidth * 100);
            ambientTargetY.set(event.clientY / window.innerHeight * 100);
            cursorAura.classList.add("is-visible");

            var now = performance.now();
            if (lastTrailPoint) {
                var dx = event.clientX - lastTrailPoint.x;
                var dy = event.clientY - lastTrailPoint.y;
                var distance = Math.hypot(dx, dy);
                if (distance > 24 && now - lastTrailTime > 34) {
                    emitCursorTrail(event.clientX, event.clientY, dx, dy);
                    lastTrailTime = now;
                    lastTrailPoint = { x: event.clientX, y: event.clientY };
                }
            } else {
                lastTrailPoint = { x: event.clientX, y: event.clientY };
            }
        }, { passive: true });

        document.addEventListener("pointerover", function (event) {
            var target = event.target.closest("[data-cursor-label]");
            if (!target) return;
            cursorAuraLabel.textContent = target.dataset.cursorLabel || "";
            cursorAura.classList.add("is-hovering");
        });

        document.addEventListener("pointerout", function (event) {
            var target = event.target.closest("[data-cursor-label]");
            if (!target || target.contains(event.relatedTarget)) return;
            cursorAura.classList.remove("is-hovering");
            cursorAuraLabel.textContent = "";
        });

        document.addEventListener("pointerdown", function () {
            cursorAura.classList.add("is-pressed");
        });

        document.addEventListener("pointerup", function () {
            cursorAura.classList.remove("is-pressed");
        });
    }

    /* ---------- Context and preference popovers ---------- */

    var openPopover = null;
    var stopPopoverPositioning = null;

    function closeComposerPopover(panel, button) {
        if (!panel || panel.hidden) return;
        button.setAttribute("aria-expanded", "false");
        if (stopPopoverPositioning) {
            stopPopoverPositioning();
            stopPopoverPositioning = null;
        }
        openPopover = null;
        if (reduceMotion) {
            panel.hidden = true;
            return;
        }
        animate(panel, { opacity: [1, 0], y: [0, 7], scale: [1, 0.975] }, { duration: 0.14, ease: "easeIn" }).then(function () {
            if (button.getAttribute("aria-expanded") === "false") panel.hidden = true;
        });
    }

    function openComposerPopover(panel, button) {
        if (openPopover && openPopover.panel !== panel) {
            closeComposerPopover(openPopover.panel, openPopover.button);
        }
        panel.hidden = false;
        button.setAttribute("aria-expanded", "true");
        openPopover = { panel: panel, button: button };
        stopPopoverPositioning = autoUpdate(button, panel, function () {
            computePosition(button, panel, {
                strategy: "fixed",
                placement: "top-start",
                middleware: [offset(10), flip(), shift({ padding: 12 })]
            }).then(function (position) {
                panel.style.left = position.x + "px";
                panel.style.top = position.y + "px";
            });
        });
        if (!reduceMotion) {
            animate(panel, { opacity: [0, 1], y: [8, 0], scale: [0.97, 1] }, { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] });
        }
    }

    function setupComposerPopover(button, panel) {
        button.addEventListener("click", function () {
            if (button.getAttribute("aria-expanded") === "true") closeComposerPopover(panel, button);
            else openComposerPopover(panel, button);
        });
    }

    setupComposerPopover(contextBtn, contextPopover);
    setupComposerPopover(preferencesBtn, preferencesPopover);

    document.querySelectorAll(".popover-choice").forEach(function (choice) {
        choice.addEventListener("click", function () {
            choice.setAttribute("aria-pressed", String(choice.getAttribute("aria-pressed") !== "true"));
        });
    });

    document.addEventListener("pointerdown", function (event) {
        if (!openPopover) return;
        if (openPopover.panel.contains(event.target) || openPopover.button.contains(event.target)) return;
        closeComposerPopover(openPopover.panel, openPopover.button);
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && openPopover) {
            var button = openPopover.button;
            closeComposerPopover(openPopover.panel, button);
            button.focus();
        }
    });

    /* ---------- Composer auto-grow ---------- */

    function autoGrow() {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 220) + "px";
    }

    input.addEventListener("input", function () {
        autoGrow();
        setTypingState();
    });
    autoGrow();

    function setTypingState() {
        if (input.value.trim()) {
            blob.classList.add("is-active");
        } else if (document.activeElement !== input) {
            blob.classList.remove("is-active");
        }
    }

    input.addEventListener("focus", function () {
        blob.classList.add("is-active");
    });

    input.addEventListener("blur", function () {
        if (!input.value.trim()) blob.classList.remove("is-active");
    });

    /* ---------- Quick action pills ---------- */

    pills.forEach(function (pill) {
        pill.addEventListener("click", function () {
            input.value = pill.dataset.prompt || "";
            input.focus();
            autoGrow();
            setTypingState();
        });
    });

    /* ---------- Voice amplitude input ---------- */

    var microphoneDenied = false;
    var isListening = false;

    function stopListening() {
        microphoneMonitor.stop();
        isListening = false;
        voiceBtn.classList.remove("is-active");
        voiceBtn.setAttribute("aria-pressed", "false");
        voiceBtn.setAttribute("aria-label", "Speak your request");
        composer.classList.remove("is-listening");
        voiceOrb.setAmplitude(0);
        voiceOrb.setState("idle");
    }

    voiceBtn.addEventListener("click", async function () {
        if (isListening) {
            stopListening();
            announce("Voice input stopped.");
            return;
        }

        if (microphoneDenied) {
            announce("Microphone access is unavailable. You can still type your request.");
            return;
        }

        voiceBtn.disabled = true;
        voiceOrb.setState("listening");
        try {
            await microphoneMonitor.start(function (amplitude) {
                voiceOrb.setAmplitude(amplitude);
            });
            isListening = true;
            voiceBtn.classList.add("is-active");
            voiceBtn.setAttribute("aria-pressed", "true");
            voiceBtn.setAttribute("aria-label", "Stop listening");
            composer.classList.add("is-listening");
            announce("Listening. Audio stays on this device and is only used to animate the voice orb.");
        } catch (error) {
            microphoneDenied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
            stopListening();
            announce(microphoneDenied
                ? "Microphone access was not allowed. You can still type your request."
                : (error.message || "Microphone input is unavailable. You can still type your request."));
        } finally {
            voiceBtn.disabled = false;
        }
    });

    /* ---------- Agent blob: spring physics, parallax, and dynamic light ---------- */

    var blobCenter = { x: 0, y: 0 };
    var blobTilt = blob.querySelector(".agent-blob-tilt");
    var blobOrb = blob.querySelector(".agent-blob-orb");
    var blobSpectrum = blob.querySelector(".agent-blob-spectrum");

    var spectrumBars = [];
    var SPECTRUM_BAR_COUNT = 0;
    var spectrumRadius = 98;

    for (var spectrumIndex = 0; spectrumIndex < SPECTRUM_BAR_COUNT; spectrumIndex += 1) {
        var spectrumBar = document.createElement("span");
        spectrumBar.className = "agent-blob-spectrum-bar";
        spectrumBar.style.setProperty("--bar-angle", spectrumIndex / SPECTRUM_BAR_COUNT * 360 + "deg");
        blobSpectrum.appendChild(spectrumBar);
        spectrumBars.push(spectrumBar);
    }

    function updateBlobCenter() {
        var rect = blob.getBoundingClientRect();
        blobCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        spectrumRadius = rect.width / 2 + 14;
    }

    updateBlobCenter();
    window.addEventListener("resize", updateBlobCenter);

    if (false && !reduceMotion) {
        var magneticTargetX = motionValue(0);
        var magneticTargetY = motionValue(0);
        var magneticX = springValue(magneticTargetX, { stiffness: 185, damping: 15, mass: 0.72 });
        var magneticY = springValue(magneticTargetY, { stiffness: 185, damping: 15, mass: 0.72 });

        var tiltTargetX = motionValue(0);
        var tiltTargetY = motionValue(0);
        var tiltX = springValue(tiltTargetX, { stiffness: 90, damping: 24, mass: 0.8 });
        var tiltY = springValue(tiltTargetY, { stiffness: 90, damping: 24, mass: 0.8 });

        var lightTargetX = motionValue(32);
        var lightTargetY = motionValue(26);
        var lightX = springValue(lightTargetX, { stiffness: 120, damping: 26, mass: 0.65 });
        var lightY = springValue(lightTargetY, { stiffness: 120, damping: 26, mass: 0.65 });

        var spectrumEnergyTarget = motionValue(0.12);
        var spectrumEnergy = springValue(spectrumEnergyTarget, { stiffness: 150, damping: 18, mass: 0.58 });

        var renderQueued = false;
        var proximity = 0;
        var pointerDirectionX = 0;
        var pointerDirectionY = 0;
        var lastPointer = null;
        var spectrumSettleTimeout = null;
        var spectrumFrameId = null;
        var spectrumInViewport = true;

        function clamp(value, min, max) {
            return Math.min(Math.max(value, min), max);
        }

        function renderBlobMotion() {
            renderQueued = false;
            blob.style.transform = "translate3d(" + magneticX.get().toFixed(2) + "px, " + magneticY.get().toFixed(2) + "px, 0)";
            blobTilt.style.transform = "perspective(700px) rotateX(" + tiltX.get().toFixed(2) + "deg) rotateY(" + tiltY.get().toFixed(2) + "deg)";
            blob.style.setProperty("--light-x", lightX.get().toFixed(2) + "%");
            blob.style.setProperty("--light-y", lightY.get().toFixed(2) + "%");
            blob.style.setProperty("--shadow-x", (-pointerDirectionX * 22).toFixed(2) + "px");
            blob.style.setProperty("--shadow-y", (16 - pointerDirectionY * 13).toFixed(2) + "px");
            blob.style.setProperty("--shadow-opacity", (0.25 + proximity * 0.35).toFixed(3));
            blob.style.setProperty("--glow-opacity", (0.38 + proximity * 0.42).toFixed(3));
            blob.style.setProperty("--glow-scale", (0.94 + proximity * 0.16).toFixed(3));
        }

        function queueBlobRender() {
            if (!renderQueued) {
                renderQueued = true;
                requestAnimationFrame(renderBlobMotion);
            }
        }

        [magneticX, magneticY, tiltX, tiltY, lightX, lightY].forEach(function (value) {
            value.on("change", queueBlobRender);
        });

        function renderSpectrum(time) {
            var stateBoost = 0;
            if (blob.classList.contains("is-listening")) stateBoost = 0.62;
            else if (blob.classList.contains("is-thinking")) stateBoost = 0.48;
            else if (blob.classList.contains("is-active")) stateBoost = 0.2;

            var energy = clamp(spectrumEnergy.get() + stateBoost, 0.08, 1);
            var rotation = time * 0.0022 + pointerDirectionX * 5;
            blobSpectrum.style.transform = "rotate(" + rotation.toFixed(2) + "deg)";
            blobSpectrum.style.opacity = (0.28 + energy * 0.58).toFixed(3);

            spectrumBars.forEach(function (bar, index) {
                var phase = index / SPECTRUM_BAR_COUNT * Math.PI * 2;
                var primaryWave = (Math.sin(time * 0.0042 + phase * 3) + 1) / 2;
                var secondaryWave = (Math.sin(time * 0.0027 - phase * 5) + 1) / 2;
                var wave = primaryWave * 0.68 + secondaryWave * 0.32;
                var scaleY = 0.34 + energy * (0.48 + wave * 1.72);
                var radius = spectrumRadius + energy * wave * 3;
                var angle = index / SPECTRUM_BAR_COUNT * 360;

                bar.style.transform = "rotate(" + angle + "deg) translateY(-" + radius.toFixed(2) + "px) scaleY(" + scaleY.toFixed(3) + ")";
                bar.style.opacity = (0.38 + wave * 0.5).toFixed(3);
            });

            spectrumFrameId = requestAnimationFrame(renderSpectrum);
        }

        function syncSpectrumPlayback() {
            var shouldAnimate = spectrumInViewport && !document.hidden;
            if (shouldAnimate && spectrumFrameId === null) {
                spectrumFrameId = requestAnimationFrame(renderSpectrum);
            } else if (!shouldAnimate && spectrumFrameId !== null) {
                cancelAnimationFrame(spectrumFrameId);
                spectrumFrameId = null;
            }
        }

        if (typeof IntersectionObserver !== "undefined") {
            new IntersectionObserver(function (entries) {
                spectrumInViewport = entries[0].isIntersecting && entries[0].intersectionRatio > 0;
                syncSpectrumPlayback();
            }, { threshold: 0.01 }).observe(blob);
        }

        document.addEventListener("visibilitychange", syncSpectrumPlayback);
        syncSpectrumPlayback();

        document.addEventListener("pointermove", function (event) {
            if (event.pointerType === "touch") return;

            var now = performance.now();
            if (lastPointer) {
                var elapsed = Math.max(now - lastPointer.time, 8);
                var travelled = Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
                var pointerSpeed = travelled / elapsed;
                spectrumEnergyTarget.set(clamp(0.12 + pointerSpeed * 0.42 + proximity * 0.18, 0.12, 0.9));

                window.clearTimeout(spectrumSettleTimeout);
                spectrumSettleTimeout = window.setTimeout(function () {
                    spectrumEnergyTarget.set(0.12 + proximity * 0.12);
                }, 90);
            }
            lastPointer = { x: event.clientX, y: event.clientY, time: now };

            var viewportX = event.clientX / window.innerWidth * 2 - 1;
            var viewportY = event.clientY / window.innerHeight * 2 - 1;
            tiltTargetX.set(viewportY * -8);
            tiltTargetY.set(viewportX * 9);

            var dx = event.clientX - blobCenter.x;
            var dy = event.clientY - blobCenter.y;
            var distance = Math.hypot(dx, dy);
            pointerDirectionX = clamp(dx / 320, -1, 1);
            pointerDirectionY = clamp(dy / 320, -1, 1);
            proximity = clamp(1 - distance / 560, 0, 1);

            lightTargetX.set(clamp(50 + pointerDirectionX * 28, 20, 80));
            lightTargetY.set(clamp(50 + pointerDirectionY * 28, 18, 80));
            queueBlobRender();
        }, { passive: true });

        blob.addEventListener("pointermove", function (event) {
            if (event.pointerType === "touch") return;

            var dx = (event.clientX - blobCenter.x) * 0.2;
            var dy = (event.clientY - blobCenter.y) * 0.2;
            var distance = Math.hypot(dx, dy);
            var maxRadius = 24;

            if (distance > maxRadius) {
                var scale = maxRadius / distance;
                dx *= scale;
                dy *= scale;
            }

            magneticTargetX.set(dx);
            magneticTargetY.set(dy);
        });

        blob.addEventListener("pointerleave", function () {
            magneticTargetX.set(0);
            magneticTargetY.set(0);
        });

        animate(blobOrb, {
            scale: [1, 1.035, 0.985, 1.018, 1],
            borderRadius: [
                "50% 50% 48% 52% / 48% 52% 50% 50%",
                "52% 48% 53% 47% / 51% 47% 53% 49%",
                "48% 52% 47% 53% / 46% 54% 48% 52%",
                "51% 49% 50% 50% / 53% 47% 52% 48%",
                "50% 50% 48% 52% / 48% 52% 50% 50%"
            ]
        }, {
            duration: 8,
            ease: "easeInOut",
            repeat: Infinity
        });
    }

    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(updateBlobCenter).observe(blob);
    }

    heroCopy.addEventListener("transitionend", function (e) {
        if (e.propertyName === "max-height") updateBlobCenter();
    });

    /* ---------- Blob state machine ---------- */

    function setBlobState(state) {
        if (state === "thinking") {
            if (isListening) stopListening();
            voiceOrb.setState("processing");
        } else if (state === "complete") {
            voiceOrb.setState("speaking");
            window.setTimeout(function () {
                voiceOrb.setState("idle");
            }, 700);
        } else {
            voiceOrb.setState("idle");
        }
    }

    /* ---------- Sidebar ---------- */

    var SIDEBAR_KEY = "projectv:sidebar-collapsed";
    var isMobile = window.matchMedia("(max-width: 900px)");

    function setSidebarCollapsed(collapsed) {
        sidebar.dataset.collapsed = String(collapsed);
        sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
        try {
            localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
        } catch (e) {
            /* storage unavailable; ignore */
        }
    }

    function openMobileSidebar(open) {
        sidebar.classList.toggle("is-open", open);
        sidebarBackdrop.classList.toggle("is-visible", open);
        mobileMenuBtn.setAttribute("aria-expanded", String(open));
    }

    function toggleSidebar() {
        if (isMobile.matches) {
            openMobileSidebar(!sidebar.classList.contains("is-open"));
        } else {
            setSidebarCollapsed(sidebar.dataset.collapsed !== "true");
        }
    }

    sidebarToggle.addEventListener("click", toggleSidebar);
    mobileMenuBtn.addEventListener("click", toggleSidebar);
    sidebarBackdrop.addEventListener("click", function () {
        openMobileSidebar(false);
    });

    var storedCollapsed = false;
    try {
        storedCollapsed = localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch (e) {
        /* storage unavailable; default to expanded */
    }
    setSidebarCollapsed(storedCollapsed);

    function buildSidebarItem(session, iconMarkup) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sidebar-item";
        btn.dataset.id = session.id;
        btn.innerHTML = iconMarkup + '<span class="sidebar-item-text">' + escapeHtml(session.title) + "</span>";
        btn.addEventListener("click", function () {
            document.querySelectorAll(".sidebar-item.is-active").forEach(function (el) {
                el.classList.remove("is-active");
            });
            btn.classList.add("is-active");
            if (isMobile.matches) openMobileSidebar(false);
            runSearch(session.query);
        });
        li.appendChild(btn);
        return li;
    }

    RECENT_SESSIONS.forEach(function (session) {
        recentListEl.appendChild(buildSidebarItem(session, ICON_RECENT));
    });

    SAVED_SESSIONS.forEach(function (session) {
        savedListEl.appendChild(buildSidebarItem(session, ICON_SAVED));
    });

    newSearchBtn.addEventListener("click", function () {
        if (isMobile.matches) openMobileSidebar(false);
        resetToHome();
    });

    /* ---------- Intent chip editing ---------- */

    function attachChipEdit(span) {
        function startEdit() {
            var currentText = span.textContent;
            var inputEl = document.createElement("input");
            inputEl.type = "text";
            inputEl.className = "intent-chip-input";
            inputEl.value = currentText;
            span.replaceWith(inputEl);
            inputEl.focus();
            inputEl.select();

            function commit(cancel) {
                var nextSpan = document.createElement("span");
                nextSpan.className = "intent-chip-value";
                nextSpan.tabIndex = 0;
                nextSpan.setAttribute("role", "textbox");
                nextSpan.setAttribute("aria-label", span.getAttribute("aria-label") || "Edit filter");
                nextSpan.textContent = cancel ? currentText : (inputEl.value.trim() || currentText);
                inputEl.replaceWith(nextSpan);
                attachChipEdit(nextSpan);
            }

            inputEl.addEventListener("blur", function () {
                commit(false);
            });
            inputEl.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    inputEl.blur();
                } else if (e.key === "Escape") {
                    commit(true);
                }
            });
        }

        span.addEventListener("click", startEdit);
        span.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                startEdit();
            }
        });
    }

    function buildChip(chip, index) {
        var el = document.createElement("div");
        el.className = "intent-chip";
        el.style.animationDelay = index * 60 + "ms";

        var label = document.createElement("span");
        label.className = "intent-chip-label";
        label.textContent = chip.label;
        el.appendChild(label);

        var value = document.createElement("span");
        value.className = "intent-chip-value";
        value.textContent = chip.value;
        value.tabIndex = 0;
        value.setAttribute("role", "textbox");
        value.setAttribute("aria-label", "Edit " + chip.label);
        attachChipEdit(value);
        el.appendChild(value);

        if (chip.removable !== false) {
            var removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "intent-chip-remove";
            removeBtn.setAttribute("aria-label", "Remove " + chip.label + " filter");
            removeBtn.innerHTML = "&times;";
            removeBtn.addEventListener("click", function () {
                el.classList.add("is-removing");
                window.setTimeout(function () {
                    el.remove();
                }, 180);
            });
            el.appendChild(removeBtn);
        }

        return el;
    }

    function renderIntentChips(query) {
        intentChipsEl.innerHTML = "";
        var chips = [
            { label: "Intent", value: truncate(query, 46), removable: false },
            { label: "Budget", value: "Flexible" },
            { label: "Category", value: "Best match" },
            { label: "Delivery", value: "Any speed" }
        ];
        chips.forEach(function (chip, i) {
            intentChipsEl.appendChild(buildChip(chip, i));
        });
    }

    function renderSkeletonChips() {
        intentChipsEl.innerHTML = "";
        for (var i = 0; i < 4; i++) {
            var s = document.createElement("div");
            s.className = "intent-chip skeleton skeleton-chip";
            intentChipsEl.appendChild(s);
        }
    }

    /* ---------- Product cards ---------- */

    function setupProductCardMotion(card) {
        if (reduceMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

        var media = card.querySelector(".product-card-media");
        var monogram = card.querySelector(".product-card-monogram");

        card.addEventListener("pointermove", function (event) {
            var rect = card.getBoundingClientRect();
            var x = (event.clientX - rect.left) / rect.width;
            var y = (event.clientY - rect.top) / rect.height;
            var rotateX = (0.5 - y) * 5;
            var rotateY = (x - 0.5) * 7;

            card.style.setProperty("--card-rotate-x", rotateX.toFixed(2) + "deg");
            card.style.setProperty("--card-rotate-y", rotateY.toFixed(2) + "deg");
            card.style.setProperty("--card-light-x", (x * 100).toFixed(1) + "%");
            card.style.setProperty("--card-light-y", (y * 100).toFixed(1) + "%");
            media.style.transform = "translate3d(" + ((x - 0.5) * -3).toFixed(2) + "px, " + ((y - 0.5) * -3).toFixed(2) + "px, 18px)";
            monogram.style.transform = "translate3d(" + ((x - 0.5) * 8).toFixed(2) + "px, " + ((y - 0.5) * 8).toFixed(2) + "px, 24px) scale(1.04)";
        });

        card.addEventListener("pointerleave", function () {
            card.style.setProperty("--card-rotate-x", "0deg");
            card.style.setProperty("--card-rotate-y", "0deg");
            media.style.transform = "translate3d(0, 0, 0)";
            monogram.style.transform = "translate3d(0, 0, 0) scale(1)";
        });
    }

    function buildCard(product, index) {
        var card = document.createElement("article");
        card.className = "product-card";
        card.style.animationDelay = index * 70 + "ms";
        card.innerHTML =
            '<div class="product-card-media">' +
                '<span class="product-card-monogram"></span>' +
                '<span class="product-card-tag"></span>' +
            "</div>" +
            '<div class="product-card-body">' +
                '<p class="product-card-brand"></p>' +
                '<h3 class="product-card-name"></h3>' +
                '<div class="product-card-footer">' +
                    '<span class="product-card-price"></span>' +
                    '<button type="button" class="product-card-save">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z"/></svg>' +
                    "</button>" +
                "</div>" +
            "</div>";

        var mediaEl = card.querySelector(".product-card-media");
        mediaEl.style.setProperty("--accent", product.accent);
        card.querySelector(".product-card-monogram").textContent = product.brand.charAt(0);
        card.querySelector(".product-card-tag").textContent = product.tag;
        card.querySelector(".product-card-brand").textContent = product.brand;
        card.querySelector(".product-card-name").textContent = product.name;
        card.querySelector(".product-card-price").textContent = product.price;

        var saveBtn = card.querySelector(".product-card-save");
        saveBtn.setAttribute("aria-label", "Save " + product.name);
        saveBtn.addEventListener("click", function () {
            saveBtn.classList.toggle("is-saved");
            if (!reduceMotion) {
                animate(saveBtn, { scale: [1, 0.82, 1.12, 1] }, { duration: 0.34, ease: [0.34, 1.3, 0.64, 1] });
            }
        });

        setupProductCardMotion(card);

        return card;
    }

    function renderProductCards() {
        resultsGridEl.innerHTML = "";
        MOCK_PRODUCTS.forEach(function (product, i) {
            resultsGridEl.appendChild(buildCard(product, i));
        });
    }

    function renderSkeletonCards() {
        resultsGridEl.innerHTML = "";
        for (var i = 0; i < 6; i++) {
            var s = document.createElement("div");
            s.className = "product-card skeleton skeleton-card";
            resultsGridEl.appendChild(s);
        }
    }

    /* ---------- Home <-> workspace transition ---------- */

    function enterWorkspaceMode() {
        appMain.classList.add("is-workspace");
        workspacePanel.hidden = false;
        renderSkeletonChips();
        renderSkeletonCards();
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                workspacePanel.classList.add("is-visible");
            });
        });
    }

    function enterWorkspaceWithTransition() {
        if (!reduceMotion && document.startViewTransition) {
            document.startViewTransition(enterWorkspaceMode);
        } else {
            enterWorkspaceMode();
        }
    }

    function resetToHome() {
        document.querySelectorAll(".sidebar-item.is-active").forEach(function (el) {
            el.classList.remove("is-active");
        });
        appMain.classList.remove("is-workspace");
        workspacePanel.classList.remove("is-visible");
        window.setTimeout(function () {
            workspacePanel.hidden = true;
            intentChipsEl.innerHTML = "";
            resultsGridEl.innerHTML = "";
        }, 260);
        input.value = "";
        autoGrow();
        blob.classList.remove("is-active");
        setBlobState(null);
        window.setTimeout(updateBlobCenter, 320);
        input.focus();
    }

    function runSearch(queryText) {
        var q = (queryText || "").trim();
        if (!q) return;

        input.value = q;
        autoGrow();
        setTypingState();
        setBlobState("thinking");
        submitBtn.disabled = true;
        composer.classList.add("is-processing");

        var wasInWorkspace = appMain.classList.contains("is-workspace");
        if (!wasInWorkspace) {
            enterWorkspaceWithTransition();
        } else {
            crossfadeReplace(intentChipsEl, renderSkeletonChips);
            crossfadeReplace(resultsGridEl, renderSkeletonCards);
        }

        window.setTimeout(function () {
            crossfadeReplace(intentChipsEl, function () {
                renderIntentChips(q);
            });
        }, 650);

        window.setTimeout(function () {
            crossfadeReplace(resultsGridEl, function () {
                renderProductCards();
            });
            setBlobState("complete");
            submitBtn.disabled = false;
            composer.classList.remove("is-processing");
            announce("Found " + MOCK_PRODUCTS.length + " results for “" + truncate(q, 60) + "”.");
            window.setTimeout(function () {
                setBlobState(null);
            }, 700);
        }, 1500);
    }

    composer.addEventListener("submit", function (e) {
        e.preventDefault();
        if (composer.classList.contains("is-processing")) return;
        runSearch(input.value);
    });

    window.addEventListener("pagehide", function () {
        microphoneMonitor.stop();
        voiceOrb.destroy();
    }, { once: true });
})();
