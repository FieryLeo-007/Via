(async function () {
    "use strict";

    const TOTAL_STEPS = 6;
    const config = JSON.parse(document.getElementById("auth-config").textContent);
    const message = document.getElementById("onboarding-message");
    const form = document.getElementById("onboarding-form");
    const continueButton = document.getElementById("continue-button");
    const backButton = document.getElementById("back-button");
    const brands = [];
    let step = 1;
    let busy = false;

    function showError(text) {
        message.textContent = text;
        message.hidden = false;
        message.focus();
    }

    function clearError() {
        message.hidden = true;
        message.textContent = "";
    }

    if (!config.url || !config.key || !window.supabase) {
        document.body.hidden = false;
        showError("Personalization is not configured yet. Add the Supabase settings and refresh this page.");
        continueButton.disabled = true;
        return;
    }

    const client = window.supabase.createClient(config.url, config.key);
    let user;
    try {
        const userResult = await client.auth.getUser();
        if (userResult.error || !userResult.data.user) throw userResult.error || new Error("Your session has expired.");
        user = userResult.data.user;

        const existing = await client.from("onboarding_preferences").select("id").eq("user_id", user.id).limit(1);
        if (existing.error) throw existing.error;
        if (existing.data?.length) {
            window.location.replace("/index.html");
            return;
        }
        document.body.hidden = false;
        document.getElementById("onboarding-main").focus({ preventScroll: true });
    } catch (error) {
        document.body.hidden = false;
        showError(error.message || "We couldn’t load your preferences. Refresh the page to try again.");
        continueButton.disabled = true;
        return;
    }

    function checkedValue(name) {
        return form.querySelector(`input[name="${name}"]:checked`)?.value || "";
    }

    function checkedValues(name) {
        return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`), input => input.value);
    }

    function validateCurrentStep() {
        const current = form.querySelector(`[data-step="${step}"]`);
        const groups = current.querySelectorAll("[data-required-group]");
        for (const group of groups) {
            if (!group.querySelector("input:checked")) {
                const label = group.querySelector("legend")?.textContent || "this question";
                showError(`Choose an answer for ${label.toLowerCase()} to continue.`);
                group.querySelector("input")?.focus();
                return false;
            }
        }
        clearError();
        return true;
    }

    function renderStep(nextStep, direction = "forward") {
        const previous = form.querySelector(`[data-step="${step}"]`);
        previous.hidden = true;
        previous.classList.remove("is-active");
        step = nextStep;
        const current = form.querySelector(`[data-step="${step}"]`);
        current.hidden = false;
        current.classList.add("is-active");
        current.style.setProperty("--step-direction", direction === "forward" ? "12px" : "-12px");
        document.getElementById("progress-label").textContent = `${step} of ${TOTAL_STEPS}`;
        document.getElementById("progress-bar").style.width = `${(step / TOTAL_STEPS) * 100}%`;
        backButton.hidden = step === 1;
        continueButton.firstChild.textContent = step === TOTAL_STEPS ? "Finish " : "Continue ";
        clearError();
        const heading = current.querySelector("h2");
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo?.({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    }

    function renderBrands() {
        const container = document.getElementById("brand-chips");
        container.replaceChildren(...brands.map((brand, index) => {
            const chip = document.createElement("span");
            chip.className = "brand-chip";
            chip.append(document.createTextNode(brand));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.setAttribute("aria-label", `Remove ${brand}`);
            remove.textContent = "×";
            remove.addEventListener("click", () => { brands.splice(index, 1); renderBrands(); });
            chip.append(remove);
            return chip;
        }));
    }

    function addBrand() {
        const input = document.getElementById("brand-input");
        const brand = input.value.trim().replace(/,$/, "");
        if (!brand) return;
        if (brands.length >= 5) { showError("You can add up to five favorite brands."); return; }
        if (!brands.some(item => item.toLowerCase() === brand.toLowerCase())) brands.push(brand);
        input.value = "";
        clearError();
        renderBrands();
        input.focus();
    }

    document.getElementById("add-brand").addEventListener("click", addBrand);
    document.getElementById("brand-input").addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addBrand(); }
    });

    form.querySelectorAll('input[name="shopping_priorities"]').forEach(input => {
        input.addEventListener("change", () => {
            const selected = checkedValues("shopping_priorities");
            if (selected.length > 5) { input.checked = false; showError("Choose up to five top priorities."); }
            else clearError();
            const count = checkedValues("shopping_priorities").length;
            document.getElementById("priority-count").textContent = `${count} of 5 selected`;
            form.querySelectorAll('input[name="shopping_priorities"]:not(:checked)').forEach(option => { option.disabled = count >= 5; });
        });
    });

    backButton.addEventListener("click", () => {
        if (!busy && step > 1) renderStep(step - 1, "back");
    });

    continueButton.addEventListener("click", async () => {
        if (busy || !validateCurrentStep()) return;
        if (step < TOTAL_STEPS) { renderStep(step + 1); return; }
        await savePreferences();
    });

    function preferenceRows() {
        const rows = [];
        const add = (category, preference_key, preference_value, importance) => rows.push({
            user_id: user.id, category, preference_key, preference_value, importance
        });

        checkedValues("shopping_categories").forEach(key => add("shopping_category", key, true, 0.7));
        checkedValues("shopping_priorities").forEach(key => add("shopping_priority", key, true, 0.9));

        const price = checkedValue("price_sensitivity");
        const priceDetails = {
            price_first: { level: "price_first", description: "lowest_reasonable_price" },
            balanced: { level: "balanced", description: "balance_price_and_quality" },
            product_first: { level: "product_first", description: "best_product" }
        };
        add("price_behavior", "price_sensitivity", priceDetails[price], { price_first: 0.9, balanced: 0.7, product_first: 0.4 }[price]);
        add("recommendation_style", "value_preference", checkedValue("value_preference"), 1.0);

        const weights = { not_important: 0.2, nice_to_have: 0.6, helpful: 0.6, very_important: 1.0 };
        const shipping = checkedValue("fast_shipping");
        const reviews = checkedValue("reviews_importance");
        add("fulfillment", "fast_shipping", shipping, weights[shipping]);
        add("social_proof", "reviews_importance", reviews, weights[reviews]);

        const familiarity = checkedValue("familiarity_preference");
        add("brand", "familiarity_preference", familiarity, { prefer_familiar: 0.8, open_to_alternatives: 0.5, no_preference: 0.2 }[familiarity]);
        if (brands.length) add("brand", "preferred_brands", brands.slice(), 0.6);
        const avoid = document.getElementById("avoid-input").value.trim();
        if (avoid) add("exclusions", "avoid", { notes: avoid }, 0.8);
        return rows;
    }

    async function savePreferences() {
        busy = true;
        clearError();
        continueButton.disabled = true;
        backButton.disabled = true;
        continueButton.setAttribute("aria-busy", "true");
        continueButton.textContent = "Saving your preferences…";
        try {
            const result = await client.from("onboarding_preferences").insert(preferenceRows());
            if (result.error) throw result.error;
            window.location.replace("/index.html");
        } catch (error) {
            const existing = await client.from("onboarding_preferences").select("id").eq("user_id", user.id).limit(1);
            if (!existing.error && existing.data?.length) { window.location.replace("/index.html"); return; }
            showError(`${error.message || "We couldn’t save your preferences."} Your answers are still here—try again.`);
            busy = false;
            continueButton.disabled = false;
            backButton.disabled = false;
            continueButton.removeAttribute("aria-busy");
            continueButton.innerHTML = 'Finish <span aria-hidden="true">&rarr;</span>';
        }
    }
})();
