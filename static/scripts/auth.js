(async function () {
    "use strict";
    const isHome = document.body.dataset.authPage === "home";
    const isOnboarding = document.body.dataset.authPage === "onboarding";
    const message = document.getElementById("auth-message");
    const fields = document.getElementById("auth-fields");
    let mode = "login";
    let busy = false;
    function notify(text, error = false) {
        message.textContent = text;
        message.dataset.error = String(error);
        message.hidden = false;
    }
    const config = JSON.parse(document.getElementById("auth-config").textContent);
    if (!config.url || !config.key || !window.supabase) {
        if (!isHome) { window.location.replace("/home.html"); return; }
        notify(!config.url || !config.key ? "Account access is not configured yet. Add the Supabase settings to the app’s .env file to get started." : "We couldn’t load account access. Check your connection and refresh the page.", true);
    }
    let client;
    try {
        if (config.url && config.key && window.supabase) {
        client = window.supabase.createClient(config.url, config.key);
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (data.session) {
            const result = await client.auth.getUser();
            if (result.error || !result.data.user) throw result.error || new Error("Session expired. Please log in again.");
            if (isHome) { window.location.replace("/passkey?next=/index.html"); return; }
            const user = result.data.user;
            window.projectVAccount = { client, user };
            if (window.dispatchEvent) window.dispatchEvent(new Event("projectv:account"));
            const avatar = document.querySelector(".avatar-btn");
            if (avatar) {
                const name = user.user_metadata.full_name || user.email || "Account";
                avatar.querySelector("span").textContent = name.charAt(0).toUpperCase();
                avatar.setAttribute("aria-label", name);
                avatar.title = name;
            }
        } else if (!isHome) { window.location.replace("/home.html"); return; }
        }
    } catch (error) {
        if (!isHome) { window.location.replace("/home.html"); return; }
        notify(error.message || "Unable to check your session. Please try again.", true);
    }
    client?.auth.onAuthStateChange((event, session) => {
        if (!isHome && event === "SIGNED_OUT") window.location.replace("/home.html");
        if (isHome && session && event === "SIGNED_IN" && !busy) window.location.replace("/passkey?next=/index.html");
    });
    if (!isHome) {
        if (!isOnboarding) document.body.hidden = false;
        if (!isOnboarding) {
            window.requestAnimationFrame(function () {
                document.getElementById("composer-input")?.focus();
            });
        }
        document.getElementById("sign-out")?.addEventListener("click", async function () {
            this.disabled = true;
            const { error } = await client.auth.signOut();
            if (error) { this.disabled = false; document.getElementById("live-status").textContent = "Could not sign out. Please try again."; return; }
            window.location.replace("/home.html");
        });
        return;
    }
    const form = document.getElementById("auth-form");
    const password = document.getElementById("password");
    const fullName = document.getElementById("full-name");
    const submit = document.getElementById("auth-submit").firstElementChild;
    const loginTab = document.getElementById("login-tab");
    const signupTab = document.getElementById("signup-tab");
    fields.disabled = !client;
    function setMode(next) {
        if (busy) return;
        mode = next;
        const signup = mode === "signup";
        loginTab.setAttribute("aria-pressed", String(!signup));
        signupTab.setAttribute("aria-pressed", String(signup));
        document.getElementById("name-field").hidden = !signup;
        fullName.required = signup;
        document.getElementById("password-hint").hidden = !signup;
        password.minLength = signup ? 8 : 1;
        password.autocomplete = signup ? "new-password" : "current-password";
        password.value = "";
        document.getElementById("auth-title").textContent = signup ? "Find your kind of great." : "Welcome back.";
        document.getElementById("auth-description").textContent = signup ? "Create your account, then save a passkey to securely approve checkout." : "A world of possibilities, picked for you.";
        submit.textContent = signup ? "Create account" : "Log in";
        document.getElementById("auth-switch").firstChild.textContent = signup ? "Already have an account? " : "New here? ";
        document.getElementById("switch-mode").textContent = signup ? "Log in" : "Create an account";
        if (client) message.hidden = true;
    }
    loginTab.addEventListener("click", () => setMode("login"));
    signupTab.addEventListener("click", () => setMode("signup"));
    document.getElementById("switch-mode").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
    document.getElementById("toggle-password").addEventListener("click", function () {
        const visible = password.type === "password";
        password.type = visible ? "text" : "password";
        this.textContent = visible ? "Hide" : "Show";
        this.setAttribute("aria-label", visible ? "Hide password" : "Show password");
        this.setAttribute("aria-pressed", String(visible));
    });
    fullName.addEventListener("input", () => fullName.setCustomValidity(""));
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        if (mode === "signup" && !fullName.value.trim()) { fullName.setCustomValidity("Enter your full name."); fullName.reportValidity(); return; }
        if (!form.reportValidity()) return;
        busy = true;
        fields.disabled = true;
        loginTab.disabled = signupTab.disabled = true;
        form.setAttribute("aria-busy", "true");
        message.hidden = true;
        submit.textContent = mode === "signup" ? "Creating your account…" : "Logging in…";
        try {
            const credentials = { email: document.getElementById("email").value.trim(), password: password.value };
            const { data, error } = mode === "signup"
                ? await client.auth.signUp({ ...credentials, options: { data: { full_name: fullName.value.trim() } } })
                : await client.auth.signInWithPassword(credentials);
            if (error) throw error;
            if (data.session) { window.location.replace(mode === "signup" ? "/passkey?next=/onboarding" : "/passkey?next=/index.html"); return; }
            if (mode === "signup" && data.user) {
                notify("Check your email to confirm your account, then log in to create your passkey.");
                return;
            }
            throw new Error("No login session was returned. Try logging in if you already have an account; otherwise contact support.");
        } catch (error) {
            notify(error.message || "Something went wrong. Please try again.", true);
            message.focus();
        } finally {
            busy = false;
            fields.disabled = false;
            loginTab.disabled = signupTab.disabled = false;
            form.setAttribute("aria-busy", "false");
            submit.textContent = mode === "signup" ? "Create account" : "Log in";
        }
    });
})();
