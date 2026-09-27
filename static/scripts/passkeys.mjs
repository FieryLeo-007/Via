import {api} from "./commerce-client.mjs";

export function supported() {
    return !!(globalThis.isSecureContext && globalThis.PublicKeyCredential && globalThis.navigator?.credentials);
}
export function localPasskeyUrl() {
    if (globalThis.location?.hostname !== "127.0.0.1") return null;
    const url = new URL(globalThis.location.href);
    url.hostname = "localhost";
    url.pathname = "/passkey"; url.search = ""; url.hash = "";
    return url.href;
}
export function decode(value) {
    const text = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(text, char => char.charCodeAt(0));
}
export function encode(value) {
    return btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function browserOptions(options, registration = false) {
    const converted = {...options, challenge: decode(options.challenge)};
    for (const key of ["excludeCredentials", "allowCredentials"]) {
        if (options[key]) converted[key] = options[key].map(item => ({...item, id: decode(item.id)}));
    }
    if (registration) converted.user = {...options.user, id: decode(options.user.id)};
    return converted;
}
export function serialize(credential) {
    const response = {};
    for (const key of ["clientDataJSON", "attestationObject", "authenticatorData", "signature", "userHandle"]) {
        if (credential.response[key] != null) response[key] = encode(credential.response[key]);
    }
    if (credential.response.getTransports) response.transports = credential.response.getTransports();
    return {id: credential.id, rawId: encode(credential.rawId), type: credential.type,
        response, clientExtensionResults: credential.getClientExtensionResults()};
}
async function ceremony(path, registration, body) {
    if (localPasskeyUrl()) throw new Error("Open ProjectV on localhost and sign in there to use passkeys.");
    if (!supported()) throw new Error("Passkeys need a supported browser on HTTPS or localhost. Open this site there to continue.");
    const {challengeId, publicKey} = await api(path, {method: "POST", body});
    try {
        const credential = await navigator.credentials[registration ? "create" : "get"]({publicKey: browserOptions(publicKey, registration)});
        if (!credential) throw new Error("No passkey was returned. Please try again.");
        return {challengeId, credential: serialize(credential)};
    } catch (error) {
        if (["NotAllowedError", "AbortError"].includes(error.name)) throw new Error("Passkey request cancelled or timed out. Nothing was approved. Try again when you’re ready.");
        if (error.name === "InvalidStateError") throw new Error("This device already has that passkey. Try signing in again.");
        if (error.name === "SecurityError") throw new Error("Passkeys need the configured HTTPS hostname or localhost. Open the correct site and try again.");
        throw error;
    }
}
export const passkeyStatus = () => api("/passkeys");
export const requestDemoApproval = body => ceremony("/passkeys/demo-approval/options", false, body);
export async function registerPasskey() {
    const body = await ceremony("/passkeys/register/options", true);
    return api("/passkeys/register/verify", {method: "POST", body});
}
export async function approveDemoPurchase(body) {
    const passkey = await requestDemoApproval(body);
    return api("/demo-orders", {method: "POST", body: {...body, passkey}});
}
