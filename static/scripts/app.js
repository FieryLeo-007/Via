import "./site-interactions.js";
import { listChats, createChat, saveTurn, loadTurns, deleteChat, listSaved, setSaved, productKey } from "./account-store.mjs";
import { searchProducts, safeProductUrl, retailerProductUrl } from "./search-client.mjs";
import { addToCart } from "./cart-store.mjs";
import { trackProductEvent, observeProductImpression } from "./analytics.mjs";
import { createSavedMotion } from "./saved-motion.js";
import { createSavedLocker } from "./saved-locker.js";
import { createCompareView } from "./compare-view.js";
import { animate } from "motion";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { VoiceOrb } from "./voice-orb.js";

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
    var contextBtn = document.getElementById("context-btn");
    var preferencesBtn = document.getElementById("preferences-btn");
    var contextPopover = document.getElementById("context-popover");
    var preferencesPopover = document.getElementById("preferences-popover");
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var blob = document.getElementById("agent-blob");
    var voiceOrb = new VoiceOrb(blob, { reducedMotion: reduceMotion });
    var orbRetry = document.getElementById("voice-orb-retry");
    var orbErrorKind = null;
    var orbRetryQuery = "";

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

    var currentChatId = null;
    var conversationTurns = [];
    var chatContextReady = true;
    var savedProducts = new Map();
    var savingProducts = new Set();
    var savedView = false;
    var savedCollection = document.getElementById("saved-collection");
    var savedGrid = document.getElementById("saved-products-grid");
    var savedFilter = document.getElementById("saved-filter");
    var savedSort = document.getElementById("saved-sort");
    var savedMotion = createSavedMotion(savedCollection);
    var savedLocker = createSavedLocker(savedCollection, productKey, announce);
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

    /* ---------- Voice mode ---------- */

    // The ElevenLabs conversation lives in its own bundle, fetched when the shopper
    // shows intent (hover/focus) so the dashboard's first load stays light.
    var voiceBundle = null;
    var voiceChat = null;

    function loadVoiceMode() {
        if (window.ProjectVVoiceMode) return Promise.resolve(window.ProjectVVoiceMode);
        if (voiceBundle) return voiceBundle;
        voiceBundle = new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.src = voiceBtn.dataset.voiceBundle;
            script.async = true;
            script.onload = function () {
                if (window.ProjectVVoiceMode) resolve(window.ProjectVVoiceMode);
                else reject(new Error("Voice mode failed to start. Refresh and try again."));
            };
            script.onerror = function () {
                script.remove();
                voiceBundle = null;
                reject(new Error("Voice mode could not load. Check your connection and try again."));
            };
            document.head.appendChild(script);
        });
        return voiceBundle;
    }

    ["pointerenter", "focus"].forEach(function (type) {
        voiceBtn.addEventListener(type, function () { loadVoiceMode().catch(function () {}); }, { once: true });
    });

    // Voice searches become a normal chat, so they show in Recent and reopen on the dashboard.
    function persistVoiceTurn(record) {
        if (!voiceChat) {
            var id = crypto.randomUUID();
            voiceChat = { id: id, saved: 0, ready: accountLoaded.catch(function () {}).then(function () {
                return createChat(("Voice · " + record.query).slice(0, 2000), id);
            }) };
        }
        var chat = voiceChat;
        chat.ready = chat.ready
            .then(function () { return saveTurn(chat.id, record); })
            .then(function () { chat.saved += 1; })
            .catch(function (error) { showAccountError(error); });
    }

    async function saveFromVoice(product, saved) {
        await setSaved(product, saved);
        var key = productKey(product);
        if (saved) savedProducts.set(key, product); else savedProducts.delete(key);
        if (saved) void trackProductEvent(product, "save");
    }

    async function finishVoiceMode(summary) {
        var chat = voiceChat;
        voiceChat = null;
        if (!chat) return;
        await chat.ready;
        await refreshHistory().catch(showAccountError);
        // Awaited so Voice Mode can fade out onto results that are already in place.
        if (chat.saved && summary.turns.length) await openChat(chat.id);
    }

    function showOrbError(kind, message) {
        orbErrorKind = kind;
        voiceOrb.setState("error", message);
        orbRetry.textContent = kind === "voice" ? "Retry voice mode" : "Retry search";
        orbRetry.hidden = false;
    }

    orbRetry.addEventListener("click", function () {
        if (orbErrorKind === "voice") voiceBtn.click();
        else runSearch(orbRetryQuery);
    });

    voiceBtn.addEventListener("click", async function () {
        if (voiceBtn.getAttribute("aria-busy") === "true") return;
        voiceBtn.setAttribute("aria-busy", "true");
        orbRetry.hidden = true;
        try {
            var voiceMode = await loadVoiceMode();
            voiceOrb.setState("idle");
            voiceMode.open({ persistTurn: persistVoiceTurn, setSaved: saveFromVoice, onClose: finishVoiceMode, returnFocus: voiceBtn });
        } catch (error) {
            showOrbError("voice", error.message);
            announce(error.message);
        } finally {
            voiceBtn.removeAttribute("aria-busy");
        }
    });


    /* ---------- Blob state machine ---------- */

    function setBlobState(state) {
        orbRetry.hidden = true;
        if (state === "thinking") {
            voiceOrb.setState("processing");
        } else if (state === "complete") {
            voiceOrb.setState("idle", "Matches ready");
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
        if (sidebar.classList.contains("is-open")) { openMobileSidebar(false); return; }
        if (isMobile.matches || document.body.classList.contains("redesigned-page")) {
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
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && sidebar.classList.contains("is-open")) {
            openMobileSidebar(false);
            (document.getElementById("dashboard-history-open") || mobileMenuBtn).focus();
        }
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
        var continuation = document.getElementById("dashboard-continue-list");
        if (!continuation) return;
        continuation.replaceChildren();
        chats.slice(0, 3).forEach(function (chat) {
            var button = document.createElement("button");
            button.type = "button"; button.className = "dashboard-session";
            var state = document.createElement("span"); state.textContent = "Continue search";
            var title = document.createElement("strong"); title.textContent = chat.title;
            var date = document.createElement("small");
            var created = new Date(chat.updated_at || chat.created_at);
            date.textContent = Number.isNaN(created.getTime()) ? "Open your saved conversation →" : (chat.updated_at ? "Updated " : "Started ") + created.toLocaleDateString();
            button.append(state, title, date);
            button.addEventListener("click", function () { openChat(chat.id); });
            continuation.appendChild(button);
        });
        if (!chats.length) continuation.innerHTML = '<p class="dashboard-empty">Start a search to build your collection of finds.</p>';
        if (chats.length) {
            try {
                var histories = await Promise.all(chats.slice(0, 3).map(function (chat) { return loadTurns(chat.id).catch(function () { return []; }); }));
                histories.forEach(function (records, index) {
                    var product = records.slice().reverse().find(function (turn) { return turn.products?.length; })?.products[0];
                    var url = product && safeProductUrl(product.image_url);
                    if (url && continuation.children[index]) {
                        var image = document.createElement("img");
                        image.src = url; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
                        image.addEventListener("error", function () { image.remove(); }, { once: true });
                        continuation.children[index].prepend(image);
                    }
                });
            } catch { /* History still works when result previews cannot load. */ }
        }
    }
    document.getElementById("dashboard-history-open")?.addEventListener("click", function (event) {
        event.preventDefault(); openMobileSidebar(true); sidebarToggle.focus();
    });
    function renderSaved(options = {}) {
        savedMotion.beforeRender();
        savedGrid.setAttribute("aria-busy", "false");
        document.getElementById("saved-count").textContent = savedProducts.size + (savedProducts.size === 1 ? " find" : " finds");
        var query = savedFilter.value.toLowerCase().trim();
        var products = Array.from(savedProducts.values()).filter(function (p) { return [p.title, p.brand, p.store_name].join(" ").toLowerCase().includes(query); });
        if (savedSort?.value === "name") products.sort(function (a, b) { return String(a.title || "").localeCompare(String(b.title || "")); });
        if (savedSort?.value === "store") products.sort(function (a, b) { return String(a.store_name || a.brand || "").localeCompare(String(b.store_name || b.brand || "")); });
        document.getElementById("saved-results-count").textContent = query ? products.length + " of " + savedProducts.size + " finds" : savedProducts.size + (savedProducts.size === 1 ? " saved find" : " saved finds");
        savedGrid.replaceChildren();
        // Saved finds are a flat collection; a product's Top-pick badge belongs to its search.
        products.forEach(function (product, index) { savedGrid.appendChild(buildCard({ ...product, top_pick_rank: null, pick_reason: null }, index, true)); });
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
        savedLocker.render(products, savedProducts, buildCard);
        savedMotion.afterRender(options.animate !== false);
        if (options.focusIndex != null) {
            var nextCard = savedGrid.children[Math.max(0, Math.min(options.focusIndex, savedGrid.children.length - 1))];
            (nextCard?.querySelector(".locker-select, .product-card-save") || savedGrid.querySelector(".saved-empty a, .saved-empty button") || savedFilter).focus();
        }
    }
    function openSaved() {
        resetToHome("saved");
        renderSaved();
    }
    savedFilter.addEventListener("input", function () { if (savedGrid.getAttribute("aria-busy") !== "true") renderSaved({ animate: false }); });
    savedSort?.addEventListener("change", function () { if (savedGrid.getAttribute("aria-busy") !== "true") renderSaved(); });
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
        card.querySelector(".product-card-tag").textContent = isSavedCard ? "Saved" : pickRank
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
        voiceOrb.setState("idle");
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

        orbRetryQuery = q;
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
            showOrbError("search", "Search failed. Retry your search below.");
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

    window.addEventListener("pagehide", function (event) {
        if (event.persisted) { voiceOrb.visible = false; voiceOrb.syncAnimation(); return; }
        voiceOrb.destroy();
    });
    window.addEventListener("pageshow", function (event) {
        if (event.persisted) { voiceOrb.visible = true; voiceOrb.syncAnimation(); }
    });
})();
