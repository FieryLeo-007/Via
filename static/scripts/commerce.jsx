import React, {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {CrossmintProvider, CrossmintPaymentMethodManagement, OrderIntentVerification,
    CrossmintCvcRecollection, CrossmintProtectedInput} from "@crossmint/client-sdk-react-ui";
import {api, cardApi, accountReady, session, TERMINAL, money, statusLabel, safeUrl} from "./commerce-client.mjs";
import {cartItems, setCartQuantity} from "./cart-store.mjs";
import {account} from "./account-store.mjs";
import {DemoWallet, DemoCheckout} from "./demo-commerce.jsx";

function ErrorMessage({error}) { return error ? <p className="commerce-error" role="alert">{error}</p> : null; }
class Boundary extends React.Component {
    state = {failed: false};
    static getDerivedStateFromError() { return {failed: true}; }
    render() { return this.state.failed ? <p role="alert" className="commerce-error">The secure payment component could not load. Refresh the page to try again.</p> : this.props.children; }
}
function Wallet({jwt}) {
    const [selected, setSelected] = useState(null);
    async function saveMethod(method) {
        const safe = {provider: "crossmint", reference: method.paymentMethodId, brand: method.card?.brand || null, last4: method.card?.last4 || null, expMonth: method.card?.expMonth || null, expYear: method.card?.expYear || null};
        setSelected({brand: safe.brand, last4: safe.last4});
        try {
            const {client, user} = await account();
            await client.from("users").update({payment_method_provider: safe.provider, payment_method_ref: safe.reference, payment_card_brand: safe.brand, payment_card_last4: safe.last4, payment_card_exp_month: safe.expMonth, payment_card_exp_year: safe.expYear, updated_at: new Date().toISOString()}).eq("id", user.id);
        } catch { /* Crossmint remains the source of truth if profile sync is unavailable. */ }
    }
    return <><p className="eyebrow">Secure payments</p><h1>Your wallet</h1><p>Save a card for your shopping agent. You approve each purchase amount before the agent pays.</p>
        <section className="commerce-card"><h2>Payment cards</h2><p>Card details are collected and stored by Crossmint. ProjectV never receives your card number or security code.</p>
        <CrossmintPaymentMethodManagement jwt={jwt} allowedModes={["existing", "new"]} allowedPaymentMethodTypes={["card"]} onPaymentMethodSelected={saveMethod}/>
        {selected && <p role="status" className="commerce-note">{selected.brand || "Card"} ending in {selected.last4} is saved and ready to select at checkout.</p>}</section>
        <a className="commerce-link" href="/cart">Back to cart</a></>;
}
function Payment({action, order, config, jwt, submit}) {
    const [card, setCard] = useState(null), [intent, setIntent] = useState(null);
    const [country, setCountry] = useState("US"), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [verify, setVerify] = useState(false), [sending, setSending] = useState(false);
    const interaction = action.request.interaction;
    const amount = interaction.amount;
    const withinLimit = amount.currency === order.currency && Number(amount.value) > 0 && Number(amount.value) <= Number(order.max_cost);
    async function useIntent(value) {
        setIntent(value);
        if (value.rails?.some(rail => rail.status === "active" && rail.credentialFormats.includes("card"))) {
            setSending(true);
            try { await submit({orderIntentId: value.orderIntentId}); } finally {setSending(false);}
        } else if (value.rails?.some(rail => rail.status === "pending_verification" && rail.credentialFormats.includes("card"))) setVerify(true);
        else if (!value.rails?.some(rail => rail.status === "pending_cvc_recollection")) throw new Error("This card has no available payment rail. Choose another card or contact Crossmint to enable encrypted-card access.");
    }
    async function refreshIntent() {
        setBusy(true); setError(""); setVerify(false);
        try { await useIntent(await cardApi(config, `/order-intents/${encodeURIComponent(intent.orderIntentId)}`)); }
        catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    async function authorize() {
        if (!card || busy || !withinLimit) return;
        setBusy(true); setError("");
        try {
            const auth = await session();
            await cardApi(config, `/payment-methods/${encodeURIComponent(card.paymentMethodId)}/order-intent-registration`, "PUT", {
                email: auth.user.email, countryCode: country, languageCode: "en-US"
            });
            const value = intent || await cardApi(config, "/order-intents", "POST", {
                paymentMethodId: card.paymentMethodId, amount: {value: amount.value, currency: amount.currency},
                description: `ProjectV purchase at ${interaction.merchant.domain}`,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
            });
            await useIntent(value);
        } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    return <><p className="commerce-amount">{money(amount.value, amount.currency)}</p><p>{amount.kind === "maximum" ? "Maximum authorization" : "Purchase total"} at <strong>{interaction.merchant.domain}</strong></p>
        {!withinLimit ? <ErrorMessage error="The requested payment exceeds your spending limit or uses a different currency. Decline this request."/> : <>
        {!intent && <><label>Cardholder country (two-letter code)<input value={country} maxLength={2} pattern="[A-Z]{2}" onChange={e => setCountry(e.target.value.toUpperCase())}/></label>
        <CrossmintPaymentMethodManagement jwt={jwt} allowedModes={["existing", "new"]} allowedPaymentMethodTypes={["card"]} onPaymentMethodSelected={method => {setCard({paymentMethodId: method.paymentMethodId, last4: method.card?.last4}); setError("");}}/>
        {card && <p>Selected card ending in {card.last4}</p>}
        <button className="commerce-button" disabled={!card || busy || !/^[A-Z]{2}$/.test(country)} onClick={authorize}>{busy ? "Authorizing…" : `Authorize ${money(amount.value, amount.currency)} & buy`}</button></>}
        {intent && verify && <OrderIntentVerification orderIntent={intent} displayName="ProjectV shopping agent" onVerificationComplete={refreshIntent} onVerificationError={() => {setVerify(false); setError("Verification did not complete. Try again when ready.");}}/>}
        {intent?.rails?.some(rail => rail.status === "pending_cvc_recollection") && <><p>Re-enter your security code in Crossmint’s secure form to continue.</p><CrossmintCvcRecollection jwt={jwt} paymentMethodId={intent.paymentMethodId} onComplete={refreshIntent} onError={() => setError("The security code could not be verified. Try again.")}/></>}
        {intent && <div className="commerce-actions"><button className="commerce-button secondary" disabled={busy || sending} onClick={refreshIntent}>Check authorization / retry</button><button className="commerce-button secondary" disabled={busy || sending} onClick={() => {setIntent(null); setCard(null); setVerify(false);}}>Choose another card</button></div>}
        </>}<ErrorMessage error={error}/></>;
}
function SchemaField({name, schema, value, change, required}) {
    if (/password|cvc|cvv|card.?number/i.test(name) || schema.format === "password") return <ErrorMessage error="This field needs a secure input request. Decline this form; do not enter card details or passwords."/>;
    if (schema.type === "object") return <fieldset><legend>{schema.title || name}</legend>{Object.entries(schema.properties || {}).map(([key, field]) => <SchemaField key={key} name={key} schema={field} required={schema.required?.includes(key)} value={value?.[key]} change={v => change({...value, [key]: v})}/>)}</fieldset>;
    if (schema.type === "boolean") return <label><input type="checkbox" checked={!!value} onChange={e => change(e.target.checked)}/>{schema.title || name}</label>;
    if (schema.enum) return <label>{schema.title || name}<select required={required} value={value ?? ""} onChange={e => change(schema.enum.find(v => String(v) === e.target.value))}><option value="">Select…</option>{schema.enum.map(v => <option key={String(v)} value={String(v)}>{String(v)}</option>)}</select></label>;
    if (schema.type === "array") return <label>{schema.title || name}<textarea required={required} placeholder="One entry per line" value={(value || []).join("\n")} onChange={e => change(e.target.value.split("\n"))}/></label>;
    const numeric = schema.type === "number" || schema.type === "integer";
    return <label>{schema.title || name}<input required={required} type={numeric ? "number" : schema.format === "email" ? "email" : "text"} step={schema.type === "integer" ? "1" : "any"} min={schema.minimum} max={schema.maximum} minLength={schema.minLength} maxLength={schema.maxLength || 2000} pattern={schema.pattern} value={value ?? ""} onChange={e => change(numeric && e.target.value !== "" ? Number(e.target.value) : e.target.value)}/>{schema.description && <small>{schema.description}</small>}</label>;
}
function FormRequest({action, submit, busy}) {
    const [values, setValues] = useState({});
    const schema = action.request.interaction.responseSchema;
    return <form className="commerce-form" onSubmit={e => {e.preventDefault(); void submit({values});}}><p>Only enter the requested shopping and delivery information. Never enter card details or passwords here.</p>
        <SchemaField name="Details" schema={schema} value={values} change={setValues}/><button className="commerce-button" disabled={busy}>Send details</button></form>;
}
function Checkout({config, jwt, orderId}) {
    const [order, setOrder] = useState(null), [messages, setMessages] = useState([]), [error, setError] = useState("");
    const [busy, setBusy] = useState(false), [answered, setAnswered] = useState(null);
    const messageIds = useRef(new Map()), mounted = useRef(true);
    async function refresh() {
        const data = await api(`/orders/${orderId}`);
        if (mounted.current) setOrder(data.order);
        if (data.order.status === "succeeded" && !data.order.is_demo) {
            const key = `projectv:cart-fulfilled:${orderId}`;
            if (!localStorage.getItem(key)) {
                const item = cartItems().find(item => item.id === data.order.item.id);
                if (item) setCartQuantity(item.id, Math.max(0, item.quantity - data.order.item.quantity));
                localStorage.setItem(key, "1");
            }
        }
        return data.order;
    }
    useEffect(() => {
        let timer, stopped = false, delay = 2000;
        mounted.current = true;
        async function poll() {
            if (stopped) return;
            try {
                const current = await refresh();
                setError("");
                // Fetch all pages so a long checkout never hides its newest messages.
                let cursor, collected = [];
                do {
                    const page = await api(`/orders/${orderId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
                    collected.push(...(page.messages || page.data || [])); cursor = page.nextCursor;
                } while (cursor && !stopped);
                if (!stopped) setMessages(collected);
                if (TERMINAL.has(current.status)) return;
                delay = Math.min(delay * 1.3, 8000);
            } catch (e) { if (!stopped) setError(e.message); delay = Math.min(delay * 1.5, 30000); }
            if (!stopped) timer = setTimeout(poll, delay);
        }
        void poll();
        return () => {stopped = true; mounted.current = false; clearTimeout(timer);};
    }, [orderId]);
    const action = order?.run?.requiredAction;
    async function submit(values) {
        if (!action || busy) return;
        setBusy(true); setError("");
        const signature = JSON.stringify([action.requestId, values]);
        if (!messageIds.current.has(signature)) messageIds.current.set(signature, crypto.randomUUID());
        try {
            await api(`/orders/${orderId}/messages`, {method: "POST", body: {id: messageIds.current.get(signature), requestId: action.requestId, ...values}});
            setAnswered(action.requestId); await refresh();
        } catch (e) {setError(e.message); throw e;} finally {setBusy(false);}
    }
    async function cancel() {
        if (!confirm("Stop this shopping agent? A purchase already placed must be cancelled with the merchant.")) return;
        setBusy(true);
        try {await api(`/orders/${orderId}/cancel`, {method: "POST"}); await refresh();} catch (e) {setError(e.message);} finally {setBusy(false);}
    }
    return <><p className="eyebrow">Your shopping agent</p><h1>Agent checkout</h1><ErrorMessage error={error}/>
        {!order ? <p role="status">Loading your order…</p> : <><section className="commerce-card"><span className="commerce-status">{statusLabel(order.status)}</span><h2 style={{marginTop: 18}}>{order.item.title}</h2><p>Quantity {order.item.quantity} · Spending limit {money(order.max_cost)} including shipping and taxes</p><p className="commerce-muted">{order.item.store_name} · Order {order.id.slice(0, 8)}</p>
        {order.result?.summary && <p>{order.result.summary}</p>}{order.reason && <p>{typeof order.reason === "string" ? order.reason : order.reason.message || order.reason.code || "The checkout stopped. Review the merchant before retrying."}</p>}
        {order.result?.purchase?.receipt && <p>Merchant order {order.result.purchase.receipt.merchantOrderId || "confirmed"} · {money(order.result.purchase.receipt.total.amount, order.result.purchase.receipt.total.currency)}</p>}
        {order.cancel_requested && !TERMINAL.has(order.status) && <p role="status">Cancellation requested. Waiting for confirmation.</p>}
        <div className="commerce-actions"><a className="commerce-link secondary" href="/orders">All orders</a>{!TERMINAL.has(order.status) && order.provider_run_id && <button className="commerce-button secondary" disabled={busy || order.cancel_requested} onClick={cancel}>Cancel checkout</button>}<button className="commerce-button secondary" onClick={() => refresh().catch(e => setError(e.message))}>Refresh status</button></div></section>
        {action && answered !== action.requestId && <section className="commerce-card" key={action.requestId}><h2>{action.request.question}</h2><p className="commerce-muted">Respond before {new Date(action.request.expiresAt).toLocaleString()}.</p>
        {action.request.interaction.kind === "payment" && <Payment action={action} order={order} config={config} jwt={jwt} submit={submit}/>}
        {action.request.interaction.kind === "form" && <FormRequest action={action} submit={v => submit(v).catch(() => {})} busy={busy}/>}
        {action.request.interaction.kind === "protected" && safeUrl(`https://${action.request.interaction.merchant.domain}`) && <><p>Your password goes directly to Crossmint’s secure form.</p><CrossmintProtectedInput jwt={jwt} merchantUrl={`https://${action.request.interaction.merchant.domain}`} label="Merchant password" onCreated={({protectedInputId}) => submit({protectedInputId}).catch(() => {})} onError={() => setError("Secure password collection failed. Try guest checkout instead.")}/><button className="commerce-button secondary" disabled={busy} onClick={() => submit({action: "alternative"}).catch(() => {})}>Use guest checkout</button></>}
        <div className="commerce-actions"><button className="commerce-button secondary" disabled={busy} onClick={() => submit({action: "decline"}).catch(() => {})}>Decline request</button></div></section>}
        {messages.length > 0 && <section className="commerce-card"><h2>Agent updates</h2><div className="commerce-transcript" role="log">{messages.flatMap(message => (message.parts || []).filter(part => ["text", "progress", "result"].includes(part.type)).map((part, index) => <p key={`${message.id}-${index}`}>{part.text || part.summary || part.message || "Working on your checkout…"}</p>))}</div></section>}</>}
    </>;
}
function LiveApp({root}) {
    const [config, setConfig] = useState(null), [jwt, setJwt] = useState(null), [error, setError] = useState("");
    useEffect(() => {
        let subscription, disposed = false;
        (async () => {
            try {
                const account = await accountReady();
                const current = await session();
                if (disposed) return;
                setJwt(current.access_token); setConfig(await api("/config"));
                subscription = account.client.auth.onAuthStateChange((_event, auth) => setJwt(auth?.access_token || null)).data.subscription;
            } catch(e) {setError(e.message);}
        })();
        return () => {disposed = true; subscription?.unsubscribe();};
    }, []);
    if (error) return <ErrorMessage error={error}/>;
    if (!config || !jwt) return <p role="status">Opening your secure account…</p>;
    const contents = root.dataset.page === "wallet" ? <Wallet jwt={jwt}/> : <Checkout orderId={root.dataset.orderId} config={config} jwt={jwt}/>;
    return <><ErrorMessage error={!config.ready ? `Setup needed: ${config.missing.join(", ")}. Checkout remains unavailable until setup is complete.` : ""}/>{config.clientKey ? <CrossmintProvider apiKey={config.clientKey}><Boundary>{contents}</Boundary></CrossmintProvider> : null}</>;
}
const root = document.getElementById("commerce-root");
if (root) createRoot(root).render(root.dataset.page === "wallet"
    ? <DemoWallet liveWallet={<LiveApp root={root}/>}/>
    : root.dataset.orderId === "demo" ? <DemoCheckout/> : <LiveApp root={root}/>);
