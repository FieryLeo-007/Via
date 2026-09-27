(async function () {
    "use strict";
    const message = document.getElementById("profile-message");
    const form = document.getElementById("profile-form");
    const fields = ["full-name", "email", "shirt-size", "shoe-size", "budget", "recipient-name", "address-line-1", "address-line-2", "city", "state", "postal-code", "country"];
    const value = id => document.getElementById(id).value.trim();
    const notify = (text, error = false) => { message.textContent = text; message.dataset.error = String(error); message.hidden = false; };
    const set = (id, next) => { document.getElementById(id).value = next == null ? "" : String(next); };
    const budgetInput = document.getElementById("budget");
    const formatBudget = () => {
        if (budgetInput.value !== "" && budgetInput.checkValidity() && Number.isFinite(budgetInput.valueAsNumber)) {
            budgetInput.value = budgetInput.valueAsNumber.toFixed(2);
        }
    };
    budgetInput.addEventListener("blur", formatBudget);
    try {
        const account = await window.projectVAccount ? window.projectVAccount : await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Account connection unavailable. Refresh and try again.")), 15000);
            window.addEventListener("projectv:account", () => { clearTimeout(timer); resolve(window.projectVAccount); }, {once: true});
        });
        const {data, error} = await account.client.from("users").select("id,full_name,email,shirt_size,shoe_size,shipping_address,max_spending_budget,payment_method_provider,payment_method_ref,payment_card_brand,payment_card_last4,payment_card_exp_month,payment_card_exp_year").eq("id", account.user.id).single();
        if (error) throw error;
        set("full-name", data.full_name); set("email", data.email || account.user.email); set("shirt-size", data.shirt_size); set("shoe-size", data.shoe_size); set("budget", data.max_spending_budget);
        formatBudget();
        const address = data.shipping_address || {};
        [["recipient-name", "recipient_name"], ["address-line-1", "address_line_1"], ["address-line-2", "address_line_2"], ["city", "city"], ["state", "state"], ["postal-code", "postal_code"], ["country", "country"]].forEach(([id, key]) => set(id, address[key]));
        const payment = document.getElementById("payment-summary");
        if (data.payment_method_ref) { const strong = document.createElement("strong"); strong.textContent = `${data.payment_card_brand || "Card"} •••• ${data.payment_card_last4 || ""}`; const small = document.createElement("small"); small.textContent = `Expires ${String(data.payment_card_exp_month || "").padStart(2, "0")}/${String(data.payment_card_exp_year || "").slice(-2)} · Stored securely by ${data.payment_method_provider || "your payment provider"}`; payment.replaceChildren(strong, small); document.getElementById("remove-payment").hidden = false; }
        else payment.textContent = "No saved payment method yet.";
        document.body.hidden = false;
        form.addEventListener("submit", async event => {
            event.preventDefault(); if (!form.reportValidity()) return;
            const submit = form.querySelector('[type="submit"]'); submit.disabled = true; message.hidden = true;
            const addressFields = {recipient_name: value("recipient-name"), address_line_1: value("address-line-1"), address_line_2: value("address-line-2"), city: value("city"), state: value("state"), postal_code: value("postal-code"), country: value("country")};
            const budget = value("budget");
            const update = {full_name: value("full-name"), email: value("email"), shirt_size: value("shirt-size") || null, shoe_size: value("shoe-size") || null, shipping_address: Object.values(addressFields).some(Boolean) ? addressFields : null, max_spending_budget: budget ? Number(budget) : null, updated_at: new Date().toISOString()};
            try { const result = await account.client.from("users").update(update).eq("id", account.user.id); if (result.error) throw result.error; if (value("email") !== account.user.email) { const authUpdate = await account.client.auth.updateUser({email: value("email")}); if (authUpdate.error) throw authUpdate.error; } notify("Your profile was saved."); } catch (error) { notify(error.message || "Could not save your profile.", true); } finally { submit.disabled = false; }
        });
        document.getElementById("remove-payment").addEventListener("click", async () => { const result = await account.client.from("users").update({payment_method_provider: null, payment_method_ref: null, payment_card_brand: null, payment_card_last4: null, payment_card_exp_month: null, payment_card_exp_year: null, updated_at: new Date().toISOString()}).eq("id", account.user.id); if (result.error) notify(result.error.message, true); else { document.getElementById("payment-summary").textContent = "No saved payment method yet."; document.getElementById("remove-payment").hidden = true; notify("Saved payment method removed."); } });
    } catch (error) { notify(error.message || "Could not load your profile.", true); document.body.hidden = false; fields.forEach(id => document.getElementById(id).disabled = true); }
})();
