import {passkeyStatus, registerPasskey, supported, localPasskeyUrl} from "./passkeys.mjs";
const button = document.getElementById("create-passkey");
const message = document.getElementById("passkey-message");
const requested = new URLSearchParams(location.search).get("next");
const next = requested === "/onboarding" ? requested : "/index.html";
const localUrl = localPasskeyUrl();
if (localUrl) {
    const link = document.getElementById("passkey-localhost");
    link.href = localUrl + "?next=" + encodeURIComponent(next);
    link.hidden = false;
}
try {
    if (localUrl) throw new Error("Passkeys need a hostname. Open ProjectV on localhost, sign in, and finish setup there.");
    const {registered} = await passkeyStatus();
    if (registered) location.replace(next);
    else if (!supported()) throw new Error("Use a browser that supports passkeys on HTTPS or localhost to finish setup.");
    else { button.disabled = false; message.textContent = "Your account is ready. Save a passkey to finish setup."; }
} catch (error) {
    message.textContent = error.message;
    message.dataset.error = "true";
    button.disabled = !supported() || !!localUrl;
}
button.addEventListener("click", async () => {
    button.disabled = true;
    message.dataset.error = "false";
    message.textContent = "Follow your device’s prompt to create a passkey…";
    try { await registerPasskey(); location.replace(next); }
    catch (error) { message.textContent = error.message; message.dataset.error = "true"; button.disabled = false; }
});
