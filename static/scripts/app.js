import { listChats, createChat, saveTurn, loadTurns, deleteChat, listSaved, setSaved, productKey } from "./account-store.mjs";
import { searchProducts, safeProductUrl, retailerProductUrl } from "./search-client.mjs";
import { addToCart } from "./cart-store.mjs";
import { trackProductEvent, observeProductImpression } from "./analytics.mjs";
import { createSavedMotion } from "./saved-motion.js";
import { createCompareView } from "./compare-view.js";
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
    var primaryNav = document.querySelector(".primary-nav");
    var navPill = primaryNav && primaryNav.querySelector(".nav-hover-pill");
    var navLinks = primaryNav ? Array.from(primaryNav.querySelectorAll(".nav-link")) : [];

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
    var conversationThread = document.getElementById("conversation-thread");
    var initialConversationTurn = document.getElementById("initial-conversation-turn");
    var initialConversationQuery = document.getElementById("initial-conversation-query");
    var initialWorkspacePanel = workspacePanel;
    var liveStatus = document.getElementById("live-status");

    /* ---------- Primary navigation ---------- */

    if (primaryNav && navPill && navLinks.length) {
        var activeNavLink = primaryNav.querySelector(".nav-link.is-active");

        function moveNavPill(target, immediate) {
            if (!target) {
                primaryNav.classList.remove("is-pill-ready");
                return;
            }

            if (immediate) navPill.style.transition = "none";
            navPill.style.width = target.offsetWidth + "px";
            navPill.style.transform = "translate3d(" + target.offsetLeft + "px, 0, 0)";
            primaryNav.classList.add("is-pill-ready");

            if (immediate) {
                navPill.getBoundingClientRect();
                navPill.style.removeProperty("transition");
            }
        }

        navLinks.forEach(function (link) {
            link.addEventListener("pointerenter", function () {
                moveNavPill(link, false);
            });
            link.addEventListener("focus", function () {
                moveNavPill(link, false);
            });
        });

        primaryNav.addEventListener("pointerleave", function () {
            moveNavPill(activeNavLink, false);
        });
        primaryNav.addEventListener("focusout", function (event) {
            if (!primaryNav.contains(event.relatedTarget)) moveNavPill(activeNavLink, false);
        });
        window.addEventListener("resize", function () {
            moveNavPill(activeNavLink, true);
        });

        moveNavPill(activeNavLink, true);
    }

    var currentChatId = null;
    var conversationTurns = [];
    var chatContextReady = true;
    var savedProducts = new Map();
    var savingProducts = new Set();
    var savedView = false;
    var savedCollection = document.getElementById("saved-collection");
    var savedGrid = document.getElementById("saved-products-grid");
    var savedFilter = document.getElementById("saved-filter");
    var savedMotion = createSavedMotion(savedCollection);
    // Each search turn's panel maps to its record, so Compare can send that turn's request.
    var turnRecords = new WeakMap();
    var compareView = createCompareView({ announce: announce, getContext: compareContext });

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

    function compareContext(panel) {
        var record = panel && turnRecords.get(panel);
        if (!record) return null;
        var index = conversationTurns.indexOf(record);
        return {
            intent: record.intent || null,
            utterance: record.query,
            history: index > 0 ? conversationTurns.slice(0, index) : []
        };
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
        input.style.height = Math.max(25, Math.min(input.scrollHeight, 220)) + "px";
    }

    input.addEventListener("input", function () {
        autoGrow();
        setTypingState();
    });

    input.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        composer.requestSubmit();
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
            openChat(session.id);
        });
        li.appendChild(btn);
        li.className = "history-row";
        var remove = document.createElement("button");
        remove.className = "chat-delete";
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Delete chat: " + session.title);
        remove.addEventListener("click", async function () {
            if (!window.confirm("Delete this chat and its products? Your saved favorites will stay in Saved.")) return;
            remove.disabled = true;
            if (currentChatId === session.id) resetToHome();
            try { await deleteChat(session.id); li.remove(); }
            catch (error) { remove.disabled = false; showAccountError(error); }
        });
        li.appendChild(remove);
        return li;
    }

    function showAccountError(error) {
        var notice = document.getElementById("account-notice");
        if (!notice) {
            notice = document.createElement("div");
            notice.id = "account-notice";
            notice.className = "account-notice";
            notice.setAttribute("role", "alert");
            document.body.appendChild(notice);
        }
        notice.replaceChildren(document.createTextNode(error.message || "Could not sync. Please try again."));
        var close = document.createElement("button");
        close.type = "button"; close.textContent = "Dismiss";
        close.onclick = function () { notice.remove(); };
        notice.appendChild(close);
    }
    async function refreshHistory() {
        var chats = await listChats();
        recentListEl.replaceChildren();
        chats.forEach(function (chat) { recentListEl.appendChild(buildSidebarItem(chat, ICON_RECENT)); });
        if (!chats.length) recentListEl.textContent = "Your chats will appear here.";
    }
    function renderSaved(options = {}) {
        savedMotion.beforeRender();
        savedGrid.setAttribute("aria-busy", "false");
        document.getElementById("saved-count").textContent = savedProducts.size + (savedProducts.size === 1 ? " find" : " finds");
        var query = savedFilter.value.toLowerCase().trim();
        var products = Array.from(savedProducts.values()).filter(function (p) { return [p.title, p.brand, p.store_name].join(" ").toLowerCase().includes(query); });
        document.getElementById("saved-results-count").textContent = query ? products.length + " of " + savedProducts.size + " finds" : "Saved for another day";
        savedGrid.replaceChildren();
        products.forEach(function (product, index) { savedGrid.appendChild(buildCard(product, index, true)); });
        // Saved finds are a flat collection; a product's Top-pick badge belongs to its search.
        renderProductCards(products.map(function (p) { return { ...p, top_pick_rank: null, pick_reason: null }; }), savedGrid);
        if (!products.length) {
            var empty = document.createElement("div"); empty.className = "saved-empty";
            var icon = document.createElement("span"); icon.className = "saved-empty-icon"; icon.setAttribute("aria-hidden", "true"); icon.innerHTML = ICON_SAVED;
            var heading = document.createElement("h2"); heading.textContent = query ? "No matching finds" : "A little space for your favorites.";
            var copy = document.createElement("p"); copy.textContent = query ? "Try another name or brand." : "Tap the bookmark on any product to keep it here.";
            var action = document.createElement(query ? "button" : "a");
            if (query) { action.type = "button"; action.textContent = "Clear search"; action.addEventListener("click", function () { savedFilter.value = ""; renderSaved(); savedFilter.focus(); }); }
            else { action.href = "/discover"; action.textContent = "Explore Discover"; }
            empty.append(icon, heading, copy, action); savedGrid.appendChild(empty);
        }
        savedMotion.afterRender(options.animate !== false);
        if (options.focusIndex != null) {
            var nextCard = savedGrid.children[Math.min(options.focusIndex, savedGrid.children.length - 1)];
            (nextCard?.querySelector(".product-card-save") || savedGrid.querySelector(".saved-empty a, .saved-empty button") || savedFilter).focus();
        }
    }
    function openSaved() {
        resetToHome("saved");
        renderSaved();
    }
    savedFilter.addEventListener("input", function () { renderSaved({ animate: false }); });
    var savedLink = document.createElement("a");
    savedLink.className = "sidebar-item"; savedLink.href = "/saved";
    savedLink.innerHTML = ICON_SAVED + '<span class="sidebar-item-text">All saved products</span>';
    var savedLi = document.createElement("li"); savedLi.appendChild(savedLink); savedListEl.appendChild(savedLi);
    async function openChat(id) {
        resetToHome("chat"); currentChatId = id;
        chatContextReady = false;
        enterWorkspaceMode("Loading chat…");
        appMain.setAttribute("aria-busy", "true");
        submitBtn.disabled = true;
        composer.classList.add("is-processing");
        var version = searchVersion;
        try {
            var turns = await loadTurns(id);
            if (version !== searchVersion) return;
            conversationTurns = turns;
            chatContextReady = true;
            appMain.classList.add("is-workspace"); conversationThread.hidden = false;
            if (!turns.length) {
                initialConversationQuery.textContent = "Continue this chat";
                intentChipsEl.replaceChildren();
                resultsGridEl.replaceChildren();
            }
            turns.forEach(function (record, i) {
                record.products = (record.products || []).map(product => ({ ...product, analytics_chat_turn_id: record.id }));
                var turn = prepareConversationTurn(record.query, i === 0);
                turnRecords.set(turn.panel, record);
                turn.panel.classList.add("is-visible");
                if (record.intent) renderIntentChips(record.intent, turn.chips);
                else turn.chips.replaceChildren();
                renderSearchResults(record.products, turn.results);
                if (record.status !== "complete") showSearchMessage(record.error_message || "This search was interrupted. Send your request again to continue.", turn.results);
                else if (!record.products.length) showSearchMessage("No products matched this search.", turn.results);
            });
        } catch (error) {
            if (version !== searchVersion) return;
            initialConversationQuery.textContent = "Couldn’t load this chat";
            intentChipsEl.replaceChildren();
            resultsGridEl.replaceChildren();
            showSearchMessage("Please select the chat again to retry.", resultsGridEl);
            showAccountError(error);
        }
        finally {
            if (version === searchVersion) {
                appMain.removeAttribute("aria-busy");
                submitBtn.disabled = !chatContextReady;
                composer.classList.remove("is-processing");
            }
        }
    }
    refreshHistory().catch(showAccountError);
    var accountLoaded = listSaved().then(function (rows) {
        rows.forEach(function (row) { savedProducts.set(row.product_key, row.product_data); });
        if (window.location.pathname === "/saved") openSaved();
    });
    accountLoaded.catch(function (error) {
        showAccountError(error);
        if (window.location.pathname !== "/saved") return;
        savedGrid.setAttribute("aria-busy", "false");
        document.getElementById("saved-count").textContent = "Unable to load";
        savedGrid.replaceChildren();
        var state = document.createElement("div"); state.className = "saved-empty";
        var heading = document.createElement("h2"); heading.textContent = "Couldn’t load your saved finds";
        var copy = document.createElement("p"); copy.textContent = "Check your connection and try again. Your collection is still in your account.";
        var retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry";
        retry.addEventListener("click", function () { window.location.reload(); });
        state.append(heading, copy, retry); savedGrid.appendChild(state);
    });

    newSearchBtn.addEventListener("click", function () {
        if (isMobile.matches) openMobileSidebar(false);
        resetToHome();
    });

    /* ---------- Parsed search intent ---------- */

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
        el.appendChild(value);

        return el;
    }

    function renderIntentChips(intent, target) {
        target = target || intentChipsEl;
        target.innerHTML = "";
        var chips = [{ label: "Search", value: intent.query }];
        if (intent.max_price_cents != null) chips.push({ label: "Budget", value: "Up to $" + (intent.max_price_cents / 100).toFixed(2) });
        if (intent.min_price_cents != null) chips.push({ label: "Minimum", value: "$" + (intent.min_price_cents / 100).toFixed(2) });
        if (intent.category) chips.push({ label: "Category", value: intent.category });
        if (intent.min_rating) chips.push({ label: "Rating", value: intent.min_rating + "★ and up" });
        if (intent.condition && intent.condition !== "any") chips.push({ label: "Condition", value: intent.condition });
        if (intent.brands_exclude.length) chips.push({ label: "Exclude", value: intent.brands_exclude.join(", ") });
        chips.forEach(function (chip, i) { target.appendChild(buildChip(chip, i)); });
    }

    function renderSkeletonChips(target) {
        target = target || intentChipsEl;
        target.innerHTML = "";
        for (var i = 0; i < 4; i++) {
            var s = document.createElement("div");
            s.className = "intent-chip skeleton skeleton-chip";
            target.appendChild(s);
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

    function buildCard(product, index, isSavedCard = false) {
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
                '<div class="product-card-actions"><button type="button" class="product-card-add">Add to cart</button>' + (isSavedCard ? '' : '<button type="button" class="product-card-buy">Buy now</button>') + '</div>' +
            "</div>";

        var mediaEl = card.querySelector(".product-card-media");
        mediaEl.style.setProperty("--accent", "#0B6B3A");
        card.querySelector(".product-card-monogram").textContent = (product.brand || product.store_name || "P").charAt(0);
        var pickRank = product.top_pick_rank;
        if (pickRank) card.classList.add("is-top-pick");
        card.querySelector(".product-card-tag").textContent = pickRank
            ? (pickRank === 1 ? "Best match" : "Top pick #" + pickRank)
            : (index === 0 ? "Best match" : "#" + (index + 1));
        card.querySelector(".product-card-brand").textContent = product.store_name || product.brand || "Online store";
        card.querySelector(".product-card-name").textContent = product.title;
        card.querySelector(".product-card-price").textContent = new Intl.NumberFormat("en-US", { style: "currency", currency: product.currency }).format(product.price_cents / 100);

        var imageUrl = safeProductUrl(product.image_url);
        if (imageUrl) {
            var image = document.createElement("img");
            image.className = "product-card-image";
            image.src = imageUrl;
            image.alt = product.title;
            image.loading = "lazy";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", function () { image.remove(); });
            mediaEl.appendChild(image);
        }
        var detail = document.createElement("p");
        detail.className = "product-card-details";
        detail.textContent = product.rating != null ? product.rating.toFixed(1) + "★ · " + (product.rating_count || 0).toLocaleString() + " reviews" : "No rating available";
        card.querySelector(".product-card-body").appendChild(detail);
        var reasons = document.createElement("p");
        reasons.className = "product-card-details";
        reasons.textContent = (product.reasons || []).join(" · ");
        card.querySelector(".product-card-body").appendChild(reasons);
        if (!isSavedCard) mediaEl.appendChild(compareView.buildSelectControl(product, card));
        var url = retailerProductUrl(product.merchant_url) || retailerProductUrl(product.product_page_url);
        if (url) {
            var link = document.createElement("a");
            link.className = "product-card-link";
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "View at retailer ↗";
            card.querySelector(".product-card-body").appendChild(link);
            link.addEventListener("click", function () {
                void trackProductEvent(product, "view");
                void trackProductEvent(product, "click");
            });
        } else {
            var unavailable = document.createElement("p");
            unavailable.className = "product-card-details";
            unavailable.textContent = "Retailer link unavailable";
            card.querySelector(".product-card-body").appendChild(unavailable);
        }

        var saveBtn = card.querySelector(".product-card-save");
        if (isSavedCard) saveBtn.textContent = "Remove";
        saveBtn.dataset.savedAction = isSavedCard ? "remove" : "toggle";
        var key = productKey(product);
        saveBtn.dataset.productKey = key;
        function updateSaveButton(button) {
            var saved = savedProducts.has(key);
            button.classList.toggle("is-saved", saved);
            var isRemove = button.dataset.savedAction === "remove";
            if (!isRemove) button.setAttribute("aria-pressed", String(saved));
            button.setAttribute("aria-label", (isRemove ? "Remove from Saved: " : saved ? "Unsave " : "Save ") + product.title);
            button.disabled = savingProducts.has(key);
        }
        updateSaveButton(saveBtn);
        saveBtn.addEventListener("click", async function () {
            if (savingProducts.has(key)) return;
            var focusIndex = isSavedCard ? Array.from(savedGrid.children).indexOf(card) : null;
            var removed = false;
            savingProducts.add(key); updateSaveButton(saveBtn);
            if (isSavedCard) saveBtn.textContent = "Removing…";
            try {
                var next = !savedProducts.has(key);
                await setSaved(product, next);
                if (next) savedProducts.set(key, product); else savedProducts.delete(key);
                if (next) void trackProductEvent(product, "save");
                removed = !next;
                announce(next ? "Product saved." : "Product removed from Saved.");
            } catch (error) { showAccountError(error); }
            finally {
                savingProducts.delete(key);
                document.querySelectorAll(".product-card-save").forEach(function (button) {
                    if (button.dataset.productKey === key) updateSaveButton(button);
                });
                if (isSavedCard) saveBtn.textContent = "Remove";
                if (savedView && removed) renderSaved({ animate: false, focusIndex: focusIndex });
            }
        });

        var addBtn = card.querySelector(".product-card-add");
        addBtn.addEventListener("click", function () {
            try { addToCart(product); } catch (error) { announce("Could not add this item. Check your browser storage and try again."); return; }
            announce(product.title + " added to cart.");
            addBtn.textContent = "Added ✓";
            addBtn.classList.add("is-added");
            window.setTimeout(function () { addBtn.textContent = "Add to cart"; addBtn.classList.remove("is-added"); }, 1400);
        });
        card.querySelector(".product-card-buy")?.addEventListener("click", function () {
            addToCart(product);
            void trackProductEvent(product, "click");
            var buyUrl = safeProductUrl(product.product_page_url) || safeProductUrl(product.merchant_url);
            if (buyUrl) window.open(buyUrl, "_blank", "noopener,noreferrer");
            else window.location.href = "/cart";
        });

        if (!isSavedCard) setupProductCardMotion(card);

        // One impression per product per browser session, even if a results
        // grid is re-rendered during search/history navigation.
        observeProductImpression(card, product);

        return card;
    }

    function renderProductCards(products, target) {
        target = target || resultsGridEl;
        target.classList.remove("is-grouped");
        target.innerHTML = "";
        products.forEach(function (product, i) {
            target.appendChild(buildCard(product, i));
        });
    }

    function buildResultsGroup(title, products, startIndex) {
        var section = document.createElement("section");
        section.className = "results-group";
        var heading = document.createElement("h2");
        heading.className = "results-group-title";
        heading.textContent = title;
        var grid = document.createElement("div");
        grid.className = "results-grid";
        products.forEach(function (product, i) {
            grid.appendChild(buildCard(product, startIndex + i));
        });
        section.setAttribute("aria-label", title);
        section.appendChild(heading);
        section.appendChild(grid);
        return section;
    }

    // Search results: AI Top picks first, then the remaining options. Turns saved
    // before Top picks existed have no pick ranks and keep the flat grid.
    function renderSearchResults(products, target) {
        target = target || resultsGridEl;
        var picks = products.filter(function (product) { return product.top_pick_rank; });
        if (!picks.length) return renderProductCards(products, target);
        picks.sort(function (a, b) { return a.top_pick_rank - b.top_pick_rank; });
        var rest = products.filter(function (product) { return !product.top_pick_rank; });
        target.innerHTML = "";
        target.classList.add("is-grouped");
        var top = buildResultsGroup("Top picks for you", picks, 0);
        top.classList.add("results-group--top");
        target.appendChild(top);
        if (rest.length) target.appendChild(buildResultsGroup("More options", rest, picks.length));
    }

    function renderSkeletonCards(target) {
        target = target || resultsGridEl;
        target.classList.remove("is-grouped");
        target.innerHTML = "";
        for (var i = 0; i < 6; i++) {
            var s = document.createElement("div");
            s.className = "product-card skeleton skeleton-card";
            target.appendChild(s);
        }
    }

    /* ---------- Home <-> workspace transition ---------- */

    function prepareConversationTurn(query, initial) {
        var turn;
        var queryEl;
        var panel;
        if (initial) {
            turn = initialConversationTurn;
            queryEl = initialConversationQuery;
            panel = initialWorkspacePanel;
        } else {
            turn = document.createElement("div");
            turn.className = "conversation-turn";
            queryEl = document.createElement("div");
            queryEl.className = "conversation-query";
            panel = document.createElement("section");
            panel.className = "workspace-panel";
            panel.setAttribute("aria-label", "Search results for " + query);
            var chips = document.createElement("div");
            chips.className = "intent-chips";
            var results = document.createElement("div");
            results.className = "results-grid";
            panel.appendChild(chips);
            panel.appendChild(results);
            turn.appendChild(queryEl);
            turn.appendChild(panel);
            conversationThread.appendChild(turn);
        }

        queryEl.textContent = query;
        queryEl.hidden = false;
        panel.hidden = false;
        return {
            turn: turn,
            query: queryEl,
            panel: panel,
            chips: panel.querySelector(".intent-chips"),
            results: panel.querySelector(".results-grid")
        };
    }

    function scrollConversationToTurn(turn) {
        window.requestAnimationFrame(function () {
            var navbar = document.querySelector(".navbar");
            var navbarOffset = navbar ? navbar.getBoundingClientRect().bottom + 24 : 32;
            var targetTop = turn.query.getBoundingClientRect().top + window.scrollY - navbarOffset;
            window.scrollTo({
                top: Math.max(0, targetTop),
                behavior: reduceMotion ? "auto" : "smooth"
            });
        });
    }

    function enterWorkspaceMode(query) {
        appMain.classList.add("is-workspace");
        conversationThread.hidden = false;
        var turn = prepareConversationTurn(query, true);
        workspacePanel = turn.panel;
        intentChipsEl = turn.chips;
        resultsGridEl = turn.results;
        renderSkeletonChips(turn.chips);
        renderSkeletonCards(turn.results);
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                turn.panel.classList.add("is-visible");
                scrollConversationToTurn(turn);
            });
        });
    }

    function enterWorkspaceWithTransition(query) {
        if (!reduceMotion && document.startViewTransition) {
            document.startViewTransition(function () {
                enterWorkspaceMode(query);
            });
        } else {
            enterWorkspaceMode(query);
        }
    }

    var activeSearch = null;
    var searchVersion = 0;

    function resetToHome(nextView) {
        nextView = nextView || "home";
        appMain.removeAttribute("aria-busy");
        appMain.classList.toggle("is-chat-navigation", nextView === "chat");
        currentChatId = null;
        conversationTurns = [];
        chatContextReady = true;
        initialWorkspacePanel.querySelectorAll(".sync-retry").forEach(function (button) { button.remove(); });
        savedView = nextView === "saved";
        document.body.classList.toggle("saved-page", savedView);
        document.querySelector(".saved-skip-link").hidden = !savedView;
        if (!savedView) savedMotion.hide();
        savedCollection.hidden = !savedView;
        appMain.classList.toggle("is-saved-view", savedView);
        searchVersion++;
        if (activeSearch) activeSearch.abort();
        compareView.clear();
        submitBtn.disabled = false;
        composer.classList.remove("is-processing");
        document.querySelectorAll(".sidebar-item.is-active").forEach(function (el) {
            el.classList.remove("is-active");
        });
        appMain.classList.toggle("is-workspace", nextView === "chat");
        conversationThread.hidden = nextView !== "chat";
        initialConversationQuery.hidden = true;
        initialConversationQuery.textContent = "";
        conversationThread.querySelectorAll(".conversation-turn:not(#initial-conversation-turn)").forEach(function (turn) {
            turn.remove();
        });
        workspacePanel = initialWorkspacePanel;
        intentChipsEl = initialWorkspacePanel.querySelector(".intent-chips");
        resultsGridEl = initialWorkspacePanel.querySelector(".results-grid");
        workspacePanel.classList.remove("is-visible");
        workspacePanel.hidden = true;
        intentChipsEl.replaceChildren();
        resultsGridEl.replaceChildren();
        resultsGridEl.classList.remove("is-grouped");
        input.value = "";
        autoGrow();
        blob.classList.remove("is-active");
        setBlobState(null);
        window.setTimeout(updateBlobCenter, 320);
        if (nextView === "home") input.focus();
    }

    function showSearchMessage(message, target) {
        target = target || resultsGridEl;
        var notice = document.createElement("p");
        notice.className = "search-message";
        notice.setAttribute("role", "status");
        notice.textContent = message;
        target.prepend(notice);
        announce(message);
    }

    async function runSearch(queryText) {
        var q = (queryText || "").trim();
        if (!q || !chatContextReady || composer.classList.contains("is-processing")) return;
        if (activeSearch) activeSearch.abort();
        activeSearch = new AbortController();
        var version = ++searchVersion;
        var timer = window.setTimeout(function () {
            if (version === searchVersion) activeSearch.abort();
        }, 30000);

        setBlobState("thinking");
        submitBtn.disabled = true;
        composer.classList.add("is-processing");

        var wasInWorkspace = appMain.classList.contains("is-workspace");
        var turn;
        if (!wasInWorkspace) {
            enterWorkspaceMode(q);
            turn = {
                panel: initialWorkspacePanel,
                query: initialConversationQuery,
                chips: initialWorkspacePanel.querySelector(".intent-chips"),
                results: initialWorkspacePanel.querySelector(".results-grid")
            };
        } else {
            turn = prepareConversationTurn(q, false);
            renderSkeletonChips(turn.chips);
            renderSkeletonCards(turn.results);
            turn.panel.classList.add("is-visible");
            scrollConversationToTurn(turn);
        }

        input.value = "";
        autoGrow();
        setTypingState();
        announce("Searching for products…");
            var chatId = currentChatId || crypto.randomUUID();
            currentChatId = chatId;
        var record = { id: crypto.randomUUID(), query: q, products: [], status: "pending" };
        var history = conversationTurns.slice();
        conversationTurns.push(record);
        turnRecords.set(turn.panel, record);
        compareView.clear();
        var persisted = false;
        // Chat persistence runs alongside the search rather than in front of it, so
        // Supabase round trips never delay results. A persistence failure is reported
        // without discarding products the shopper can already see.
        var persistence = (async function () {
            await accountLoaded;
            if (version !== searchVersion) return;
            if (!wasInWorkspace || !document.querySelector('.sidebar-item[data-id="' + chatId + '"]')) await createChat(q.slice(0, 2000), chatId);
            if (version !== searchVersion) return;
            await saveTurn(chatId, record);
            persisted = true;
            await refreshHistory();
        })().catch(function (error) {
            if (version === searchVersion) showAccountError(error);
        });
        var shownResults = null;
        try {
            var data = await searchProducts(q, {
                history: history,
                signal: activeSearch.signal,
                onIntent: function (intent) {
                    if (version === searchVersion) {
                        record.intent = intent;
                        renderIntentChips(intent, turn.chips);
                    }
                },
                onResults: function (ranked) {
                    if (version !== searchVersion || !ranked.results.length) return;
                    ranked.results.forEach(product => { product.analytics_chat_turn_id = persisted ? record.id : null; });
                    renderSearchResults(ranked.results, turn.results);
                    shownResults = ranked.results;
                    setBlobState("complete");
                }
            });
            if (version !== searchVersion) return;
            data.results.forEach(product => { product.analytics_chat_turn_id = persisted ? record.id : null; });
            // Re-render only when Top picks changed what is already on screen.
            if (data.results !== shownResults) renderSearchResults(data.results, turn.results);
            if (!data.results.length) showSearchMessage("No products matched your search. Try a broader description or budget.", turn.results);
            else announce("Found " + data.results.length + " products for “" + truncate(q, 60) + "”" + (data.results.some(function (p) { return p.top_pick_rank; }) ? ", with top picks highlighted." : "."));
            setBlobState("complete");
            Object.assign(record, { products: data.results, intent: data.intent, status: "complete" });
            await persistence;
            if (version !== searchVersion || !persisted) return;
            data.results.forEach(product => { product.analytics_chat_turn_id = record.id; });
            try { await saveTurn(chatId, record); }
            catch (syncError) {
                if (version !== searchVersion) return;
                showAccountError(new Error("Results could not be saved. Keep this page open and retry saving below."));
                var retry = document.createElement("button"); retry.type = "button"; retry.className = "sync-retry"; retry.textContent = "Retry saving this search";
                retry.onclick = async function () {
                    retry.disabled = true;
                    try { await saveTurn(chatId, record); retry.remove(); }
                    catch (error) { showAccountError(error); retry.disabled = false; }
                };
                turn.panel.appendChild(retry);
            }
        } catch (error) {
            if (version !== searchVersion) return;
            turn.chips.querySelectorAll(".skeleton").forEach(function (el) { el.remove(); });
            turn.results.innerHTML = "";
            turn.results.classList.remove("is-grouped");
            showSearchMessage(error.name === "AbortError" ? "Search took too long. Please try again." : error.message, turn.results);
            setBlobState(null);
            record.status = "error";
            await persistence;
            if (persisted) {
                try { await saveTurn(chatId, { ...record, status: "error", error_message: error.name === "AbortError" ? "Search took too long. Please try again." : error.message }); }
                catch (syncError) { showAccountError(syncError); }
            }
        } finally {
            window.clearTimeout(timer);
            if (version === searchVersion) {
                submitBtn.disabled = false;
                composer.classList.remove("is-processing");
                activeSearch = null;
            }
        }
    }

    composer.addEventListener("submit", function (e) {
        e.preventDefault();
        if (composer.classList.contains("is-processing")) return;
        runSearch(input.value);
    });

    // Shop-again links prepare a search without initiating an account request.
    var suggestedQuery = new URLSearchParams(window.location.search).get("query");
    if (suggestedQuery && window.location.pathname === "/dashboard") {
        input.value = suggestedQuery;
        autoGrow();
    }

    window.addEventListener("pagehide", function () {
        microphoneMonitor.stop();
        voiceOrb.destroy();
    }, { once: true });
})();
