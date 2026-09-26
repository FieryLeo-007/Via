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

    var blob = document.getElementById("agent-blob");

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

    /* ---------- Voice button (visual state only; no speech capture) ---------- */

    var voiceTimeout = null;

    voiceBtn.addEventListener("click", function () {
        var isActive = !voiceBtn.classList.contains("is-active");
        voiceBtn.classList.toggle("is-active", isActive);
        voiceBtn.setAttribute("aria-pressed", String(isActive));
        blob.classList.toggle("is-listening", isActive);

        window.clearTimeout(voiceTimeout);
        if (isActive) {
            voiceTimeout = window.setTimeout(function () {
                voiceBtn.classList.remove("is-active");
                voiceBtn.setAttribute("aria-pressed", "false");
                blob.classList.remove("is-listening");
            }, 4000);
        }
    });

    /* ---------- Agent blob: breathing handled by CSS; here we add cursor proximity ---------- */

    var blobCenter = { x: 0, y: 0 };

    function updateBlobCenter() {
        var rect = blob.getBoundingClientRect();
        blobCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    updateBlobCenter();
    window.addEventListener("resize", updateBlobCenter);

    var PROXIMITY_RADIUS = 260;
    var MAX_SHIFT = 14;
    var pointerRafId = null;
    var lastPointerEvent = null;

    function applyProximity() {
        pointerRafId = null;
        if (!lastPointerEvent) return;
        var dx = lastPointerEvent.clientX - blobCenter.x;
        var dy = lastPointerEvent.clientY - blobCenter.y;
        var dist = Math.hypot(dx, dy);

        if (dist < PROXIMITY_RADIUS && dist > 0.001) {
            var strength = 1 - dist / PROXIMITY_RADIUS;
            var tx = (dx / dist) * strength * MAX_SHIFT;
            var ty = (dy / dist) * strength * MAX_SHIFT;
            blob.style.transform = "translate(" + tx.toFixed(1) + "px, " + ty.toFixed(1) + "px)";
        } else {
            blob.style.transform = "translate(0, 0)";
        }
    }

    document.addEventListener("mousemove", function (e) {
        lastPointerEvent = e;
        if (pointerRafId === null) {
            pointerRafId = requestAnimationFrame(applyProximity);
        }
    });

    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(updateBlobCenter).observe(blob);
    }

    heroCopy.addEventListener("transitionend", function (e) {
        if (e.propertyName === "max-height") updateBlobCenter();
    });

    /* ---------- Blob state machine ---------- */

    function setBlobState(state) {
        blob.classList.remove("is-thinking", "is-complete");
        if (state === "thinking") {
            blob.classList.add("is-thinking");
        } else if (state === "complete") {
            blob.classList.add("is-complete");
            window.setTimeout(function () {
                blob.classList.remove("is-complete");
            }, 700);
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

    function buildCard(product, index) {
        var card = document.createElement("article");
        card.className = "product-card";
        card.style.animationDelay = index * 70 + "ms";
        card.innerHTML =
            '<div class="product-card-media" style="--accent:' + product.accent + '">' +
                '<span class="product-card-monogram">' + escapeHtml(product.brand.charAt(0)) + "</span>" +
                '<span class="product-card-tag">' + escapeHtml(product.tag) + "</span>" +
            "</div>" +
            '<div class="product-card-body">' +
                '<p class="product-card-brand">' + escapeHtml(product.brand) + "</p>" +
                '<h3 class="product-card-name">' + escapeHtml(product.name) + "</h3>" +
                '<div class="product-card-footer">' +
                    '<span class="product-card-price">' + escapeHtml(product.price) + "</span>" +
                    '<button type="button" class="product-card-save" aria-label="Save ' + escapeHtml(product.name) + '">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z"/></svg>' +
                    "</button>" +
                "</div>" +
            "</div>";

        var saveBtn = card.querySelector(".product-card-save");
        saveBtn.addEventListener("click", function () {
            saveBtn.classList.toggle("is-saved");
        });

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
            enterWorkspaceMode();
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
})();
