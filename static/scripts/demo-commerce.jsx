import React, {useEffect, useRef, useState} from "react";
import {ArrowUpRight, ArrowRight, ArrowLeft, Check, CreditCard, Fingerprint, Headphones, LockKeyhole, Package, RotateCcw, ShieldCheck, ShoppingBag, Sparkles, Truck, X, Zap} from "lucide-react";
import {cartItems, fulfillDemoOrder, trackCartCheckout} from "./cart-store.mjs";
import {account} from "./account-store.mjs";
import {api, money, safeUrl, statusLabel} from "./commerce-client.mjs";
import {demoItems, demoQuote, demoTransition, newDemoRun, restoreDemoRun, withinDemoLimit} from "./demo-checkout.mjs";

import {passkeyStatus, registerPasskey, approveDemoPurchase, localPasskeyUrl} from "./passkeys.mjs";

const usd = cents => money(cents / 100);
function DemoBadge() { return <span className="demo-badge"><span/>Demo mode</span>; }
function DemoNotice() { return <div className="demo-notice"><ShieldCheck size={17}/><span>A little preview of what’s possible. <strong>No real charges or orders.</strong></span><DemoBadge/></div>; }

function DemoCard({compact = false}) {
    return <div className={`demo-payment-card ${compact ? "compact" : ""}`} aria-label="ProjectV demo card ending in 4242, simulation only">
        <div className="demo-card-top"><span className="demo-card-brand">V<span>ProjectV</span></span><span className="demo-card-tag">DEMO CARD</span></div>
        <div className="demo-card-art" aria-hidden="true"><i/><i/><i/></div>
        <div className="demo-card-chip" aria-hidden="true"><span/><span/><span/></div>
        <div className="demo-card-number"><span>••••</span><span>••••</span><span>••••</span><span>4242</span></div>
        <div className="demo-card-bottom"><div><small>CARDHOLDER</small><span>Your shopping agent</span></div><div><small>VALID FOR</small><span>The possibilities</span></div><Sparkles size={24}/></div>
    </div>;
}

export function DemoWallet({liveWallet}) {
    const [tab, setTab] = useState("demo");
    return <div className="demo-shell wallet-shell"><div className="demo-heading"><div><p className="eyebrow">A little more freedom</p><h1>Your wallet, reimagined.</h1><p>You find your next favorite. Your agent takes it from there.</p></div><span className="demo-heading-icon"><CreditCard size={27}/></span></div>
        <div className="demo-tabs" aria-label="Wallet view"><button aria-pressed={tab === "demo"} onClick={() => setTab("demo")}><Sparkles size={15}/>Demo wallet<span>Try it out</span></button><button aria-pressed={tab === "live"} onClick={() => setTab("live")}><CreditCard size={16}/>Real payment cards<ArrowUpRight size={14}/></button></div>
        {tab === "live" ? <section className="demo-live-panel">{liveWallet}</section> : <>
        <DemoNotice/>
        <div className="demo-wallet-grid"><section className="demo-card-display"><div className="demo-section-label"><span>Your agent’s +1</span><span className="demo-ready"><span/>Ready to explore</span></div><DemoCard/><div className="demo-card-caption"><LockKeyhole size={15}/><span>A pretend card. A real feel for the experience.</span></div></section>
        <section className="demo-wallet-intro"><span className="demo-kicker"><Sparkles size={14}/> MEET AGENT CHECKOUT</span><h2>Less checkout.<br/>More checked off.</h2><p>Watch your agent handle the details, find shipping, and get everything ready. You give the final okay.</p><a className="demo-primary" href="/checkout/demo">Try a demo checkout<ArrowRight size={18}/></a><a className="demo-text-link" href="/checkout/demo?source=cart">Try it with your cart<ArrowUpRight size={15}/></a><span className="demo-micro">About 30 seconds · No card details needed</span></section></div>
        <section className="demo-perks" aria-label="How agent checkout works">{[[ShieldCheck, "Your rules. Always.", "Set a spending limit. Your agent stays within it."], [Fingerprint, "The final say is yours.", "Review the total before you approve a payment."], [Package, "Details, taken care of.", "From delivery options to a tidy order receipt."]].map(([Icon, title, body], i) => <article key={title}><span className="demo-perk-icon"><Icon size={21}/></span><small>0{i + 1}</small><h3>{title}</h3><p>{body}</p></article>)}</section>
        <div className="demo-wallet-footer"><span><LockKeyhole size={15}/> Real payments are powered by Crossmint.</span><button onClick={() => setTab("live")}>Manage real cards<ArrowUpRight size={15}/></button></div>
        </>}
    </div>;
}

function ProductArt({item}) {
    const [failed, setFailed] = useState(false);
    const url = safeUrl(item.image_url);
    return <div className="demo-product-art">{url && !failed ? <img src={url} alt="" onError={() => setFailed(true)}/> : item.id === "demo-headphones" ? <Headphones strokeWidth={1.1} size={55}/> : <ShoppingBag strokeWidth={1.2} size={34}/>}</div>;
}

function Summary({run, quote}) {
    return <aside className="demo-order-summary"><div className="demo-section-label"><h2>Your selection</h2><span>{run.items.reduce((n, item) => n + item.quantity, 0)} {run.items.reduce((n, item) => n + item.quantity, 0) === 1 ? "item" : "items"}</span></div><div className="demo-products">{run.items.map((item, index) => <div className="demo-product" key={`${item.id}-${index}`}><ProductArt item={item}/><div><small>{item.store_name || "Online store"}</small><h3>{item.title}</h3><span>Qty {item.quantity}</span></div><strong>{usd(item.price_cents * item.quantity)}</strong></div>)}</div>
        <dl className="demo-totals"><div><dt>Subtotal</dt><dd>{usd(quote.subtotal)}</dd></div><div><dt>{run.shipping === "express" ? "Express" : "Standard"} shipping</dt><dd className={!quote.delivery ? "demo-free" : ""}>{quote.delivery ? usd(quote.delivery) : "Free"}</dd></div><div><dt>Estimated tax <span title="A sample 8% tax rate for this demo">(8%)</span></dt><dd>{usd(quote.tax)}</dd></div><div className="demo-total"><dt>Demo total</dt><dd>{usd(quote.total)}</dd></div></dl>
        <div className="demo-summary-card"><span className="demo-mini-card">V</span><div><strong>ProjectV demo card</strong><span>•••• 4242 · Simulation only</span></div><Check size={17}/></div><p className="demo-summary-note"><LockKeyhole size={14}/> No money moves in this demo.</p>
    </aside>;
}

const SHOP_EVENTS = ["Opening the storefront", "Checking your items and quantities", "Comparing delivery options", "Preparing your total for approval"];
const PAY_EVENTS = ["Applying your one-time demo approval", "Simulating the merchant checkout", "Preparing your demo receipt"];
function Activity({stage, tick, shipping}) {
    const events = ["Checkout preferences received", ...SHOP_EVENTS, "You approved the demo payment", ...PAY_EVENTS];
    const count = stage === "review" ? 1 : stage === "shopping" ? tick + 2 : stage === "approval" ? 5 : stage === "purchasing" ? tick + 7 : stage === "complete" ? 9 : 1;
    return <section className="demo-activity"><div className="demo-section-label"><h2><Sparkles size={16}/> Agent activity</h2><span>SIMULATED</span></div><ol aria-label="Agent activity">{events.slice(0, count).map((event, i) => <li key={event} className={i === count - 1 && ["shopping", "purchasing"].includes(stage) ? "is-working" : ""}><span className="demo-activity-dot"><Check size={11}/></span><span>{event}{i === 3 && stage !== "shopping" && <small>{shipping === "express" ? "Express delivery · $12.95" : "Standard delivery · free shipping"}</small>}</span><span className="demo-event-time">{i === 0 ? "START" : `0:${String(i * 2).padStart(2, "0")}`}</span></li>)}</ol></section>;
}

export function DemoCheckout() {
    const [context] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const fromCart = params.get("source") === "cart";
        const cart = fromCart ? cartItems() : [];
        const selected = params.has("item") ? cart.filter(item => item.id === params.get("item")) : cart;
        const items = demoItems(selected);
        const key = `projectv:demo-checkout:${fromCart ? "cart" : "sample"}:${params.get("item") || "all"}`;
        let raw; try { raw = sessionStorage.getItem(key); } catch { /* Demo works without storage. */ }
        return {items, key, fromCart, fallback: fromCart && (!selected.length || items[0].id === "demo-headphones"), initial: restoreDemoRun(raw, items)};
    });
    const [run, setRun] = useState(context.initial), [tick, setTick] = useState(0);
    const [profile, setProfile] = useState(null), [address, setAddress] = useState({});
    const [saved, setSaved] = useState(null), [saveError, setSaveError] = useState(""), [saving, setSaving] = useState(false), [saveAttempt, setSaveAttempt] = useState(0);
    const [registered, setRegistered] = useState(null), [verifying, setVerifying] = useState(false), [approvalError, setApprovalError] = useState("");
    const approvalLock = useRef(false);
    const heading = useRef(null), previousStage = useRef(run.stage);
    const quote = demoQuote(run.items, run.shipping), allowed = withinDemoLimit(quote.total, run.limit);
    const reference = saved?.result?.purchase?.receipt?.merchantOrderId || run.id;
    const busy = ["shopping", "purchasing"].includes(run.stage);
    const activeStep = ({review: 0, shopping: 1, approval: 2, purchasing: 3, complete: 3, cancelled: 1})[run.stage];
    useEffect(() => {
        let disposed = false;
        passkeyStatus().then(({registered}) => {if (!disposed) setRegistered(registered);})
            .catch(error => {if (!disposed) setApprovalError(error.message);});
        return () => {disposed = true;};
    }, []);
    async function approve() {
        if (approvalLock.current || !allowed) return;
        approvalLock.current = true; setVerifying(true); setApprovalError("");
        try {
            const status = await passkeyStatus();
            setRegistered(status.registered);
            if (!status.registered) {
                await registerPasskey(); setRegistered(true);
                // Registration is not purchase approval. Ask for a separate click.
                return;
            }
            if (context.fromCart && !context.fallback) trackCartCheckout(run.orderId);
            const {order} = await approveDemoPurchase({id: run.orderId, items: run.items, shipping: run.shipping, maxCost: run.limit, consent: true});
            setSaved(order);
            if (context.fromCart && !context.fallback) fulfillDemoOrder(order);
            transition("approve");
        } catch (error) { setApprovalError(error.message); }
        finally {approvalLock.current = false; setVerifying(false);}
    }
    function transition(event) { setRun(current => demoTransition(current, event)); }
    useEffect(() => {
        let disposed = false;
        account().then(({client, user}) => client.from("users").select("shipping_address,max_spending_budget,payment_method_ref,payment_card_brand,payment_card_last4,payment_card_exp_month,payment_card_exp_year").eq("id", user.id).single())
            .then(({data, error}) => { if (error) throw error; if (disposed || !data) return; setProfile(data); setAddress(data.shipping_address || {}); const savedBudget = Number(data.max_spending_budget); if (run.stage === "review" && savedBudget > 0 && savedBudget * 100 >= quote.total) setRun(current => ({...current, limit: String(savedBudget)})); })
            .catch(() => {});
        return () => { disposed = true; };
    }, []);
    function restart() { setTick(0); setSaved(null); setSaveError(""); setApprovalError(""); setRun(newDemoRun(context.items)); }
    useEffect(() => {try { sessionStorage.setItem(context.key, JSON.stringify(run)); } catch { /* In-memory flow remains available. */ }}, [run, context.key]);
    useEffect(() => {
        if (run.stage !== "complete") return;
        let disposed = false;
        setSaving(true); setSaveError("");
        (saved ? Promise.resolve({order: saved}) : api(`/orders/${run.orderId}`))
            .then(({order}) => {
                if (context.fromCart && !context.fallback) fulfillDemoOrder(order);
                if (!disposed) setSaved(order);
            })
            .catch(error => {if (!disposed) {
                if (error.status === 404) {setRun(current => ({...current, stage: "approval"})); setApprovalError("Verify your passkey to finish this checkout.");}
                else setSaveError(error.message);
            }})
            .finally(() => {if (!disposed) setSaving(false);});
        return () => {disposed = true;};
    }, [run.stage, run.orderId, saveAttempt]);
    useEffect(() => {
        if (previousStage.current !== run.stage) {
            heading.current?.focus({preventScroll: true});
            heading.current?.scrollIntoView({block: "nearest"});
        }
        previousStage.current = run.stage;
        setTick(0);
        if (!busy) return;
        const length = run.stage === "shopping" ? SHOP_EVENTS.length : PAY_EVENTS.length;
        let progress = 0;
        const timer = setInterval(() => {
            progress += 1;
            if (progress >= length) { clearInterval(timer); transition(run.stage === "shopping" ? "prepared" : "finished"); }
            else setTick(progress);
        }, 1500);
        return () => clearInterval(timer);
    }, [run.stage]);
    const titles = {review: "You set the rules.", shopping: "Your agent’s on it.", approval: "One last thing. Your okay.", purchasing: "Consider it handled.", complete: "That’s checkout, checked off.", cancelled: "Demo checkout paused here."};
    function downloadReceipt() {
        const receipt = ["PROJECTV — DEMO RECEIPT", "SIMULATION ONLY. No real payment or merchant order was placed.", reference, `Status: ${saved ? statusLabel(saved.status) : "Demo complete"}`, "", ...run.items.map(item => `${item.title} × ${item.quantity} — ${usd(item.price_cents * item.quantity)}`), "", `Subtotal: ${usd(quote.subtotal)}`, `Simulated shipping: ${usd(quote.delivery)}`, `Estimated tax (8%): ${usd(quote.tax)}`, `Demo total: ${usd(quote.total)}`, "Demo card: •••• 4242", "Delivery: fictional demo address"].join("\n");
        const url = URL.createObjectURL(new Blob([receipt], {type: "text/plain"}));
        const link = document.createElement("a"); link.href = url; link.download = `${reference}-receipt.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <div className="demo-shell checkout-shell"><a className="demo-back" href="/wallet"><ArrowLeft size={15}/>Back to wallet</a><div className="demo-heading"><div><p className="eyebrow">You choose. We take care.</p><h1>Agent checkout</h1><p>A few little steps. A whole lot less effort.</p></div><DemoBadge/></div><DemoNotice/>
        {context.fallback && <p className="demo-fallback">Your cart has no eligible items for this demo, so we’ve picked a sample for you.</p>}
        <ol className="demo-stepper" aria-label="Checkout progress">{["Your preferences", "Agent at work", "Your approval", "All taken care of"].map((label, i) => <li key={label} className={i <= activeStep ? "is-active" : ""} aria-current={i === activeStep ? "step" : undefined}><span>{i < activeStep || run.stage === "complete" ? <Check size={15}/> : `0${i + 1}`}</span>{label}</li>)}</ol>
        <div className="demo-checkout-grid"><div className="demo-checkout-left"><section className={`demo-stage-panel stage-${run.stage}`}>
            <div className={`demo-agent-symbol ${busy ? "is-busy" : ""}`} aria-hidden="true">{run.stage === "complete" ? <Check size={29}/> : run.stage === "cancelled" ? <X size={27}/> : run.stage === "approval" ? <Fingerprint size={29}/> : <Sparkles size={27}/>}</div>
            <h2 ref={heading} tabIndex={-1}>{titles[run.stage]}</h2>
            {run.stage === "review" && <><p>Give your agent a little direction. We’ll handle the busywork and come back for your approval.</p><form onSubmit={event => {event.preventDefault(); transition("start");}}>
                <div className="demo-form-label"><label htmlFor="demo-limit">Your spending limit</label><span>Includes shipping & tax</span></div><div className={`demo-limit ${!allowed ? "is-invalid" : ""}`}><span>$</span><input id="demo-limit" inputMode="decimal" type="number" min="0.01" step="0.01" max="100000" required value={run.limit} aria-describedby="demo-limit-help" onChange={e => setRun({...run, limit: e.target.value})}/><span>USD</span><ShieldCheck size={19}/></div><p id="demo-limit-help" className={`demo-field-note ${!allowed ? "demo-field-error" : ""}`}>{allowed ? `Your estimated total is ${usd(quote.total)}. You only approve the final amount.` : `Set a limit from ${usd(quote.total)} to $100,000 to cover this demo checkout.`}</p>
                <fieldset className="demo-shipping"><legend>How soon is soon enough?</legend>{[["standard", Truck, "Standard delivery", "3–5 business days", "Free"], ["express", Zap, "Express delivery", "1–2 business days", "$12.95"]].map(([value, Icon, title, detail, cost]) => <label key={value} className={run.shipping === value ? "is-selected" : ""}><input type="radio" name="demo-shipping" value={value} checked={run.shipping === value} onChange={() => setRun({...run, shipping: value})}/><Icon size={20}/><span><strong>{title}</strong><small>{detail}</small></span><b>{cost}</b></label>)}</fieldset>
                <div className="demo-address"><span><Package size={18}/><strong>Delivery address</strong><span>{profile?.shipping_address ? "Saved from your profile · Editable for this checkout" : "Add an address for this checkout"}</span></span><div className="demo-address-fields">{[["recipient_name", "Recipient / full name"], ["address_line_1", "Address line 1"], ["city", "City"], ["state", "State / region"], ["postal_code", "ZIP / postal code"], ["country", "Country"]].map(([key, label]) => <label key={key}>{label}<input value={address[key] || ""} onChange={e => setAddress({...address, [key]: e.target.value})}/></label>)}</div>{profile?.payment_method_ref && <p>Saved payment: {profile.payment_card_brand || "Card"} •••• {profile.payment_card_last4} · Expires {String(profile.payment_card_exp_month || "").padStart(2, "0")}/{String(profile.payment_card_exp_year || "").slice(-2)}</p>}</div>
                {profile?.max_spending_budget && quote.total > Number(profile.max_spending_budget) * 100 && <p className="demo-field-note demo-field-error">This purchase is above your saved ${Number(profile.max_spending_budget).toLocaleString()} spending limit. You can continue anyway.</p>}
                <button className="demo-primary" disabled={!allowed} type="submit"><Sparkles size={17}/>Let my agent take over<ArrowRight size={18}/></button><span className="demo-micro demo-centered">{context.fromCart && !context.fallback ? "No real charges. Completed items will be removed from your cart." : "Just a simulation. No real charges."}</span>
            </form></>}
            {busy && <><p>{run.stage === "shopping" ? "Finding the smoothest way from your cart to your door. Sit back for a moment." : "Your approval is in. Your agent is taking care of the final details."}</p><div className="demo-working-message" role="status"><span className="demo-spinner"/>{(run.stage === "shopping" ? SHOP_EVENTS : PAY_EVENTS)[Math.min(tick, (run.stage === "shopping" ? SHOP_EVENTS : PAY_EVENTS).length - 1)]}…</div><div className="demo-progress-track" aria-hidden="true"><span style={{width: `${(tick + 1) / (run.stage === "shopping" ? 4 : 3) * 100}%`}}/></div><div className="demo-agent-promise"><ShieldCheck size={18}/>{run.stage === "shopping" ? "Your agent will stop and ask before payment." : "Using your demo card. No real payment is made."}</div>{run.stage === "shopping" && <button className="demo-text-button" onClick={() => transition("cancel")}>Cancel demo checkout</button>}</>}
            {run.stage === "approval" && <><p>Everything’s ready. Review the total, then use your passkey to approve this demo purchase.</p><div className="demo-approval-amount"><span>One-time demo approval</span><strong>{usd(quote.total)}</strong><span><ShieldCheck size={15}/>{usd(Math.round(Number(run.limit) * 100) - quote.total)} below your spending limit</span></div><div className="demo-approval-card"><DemoCard compact/></div><div className="demo-agent-promise"><LockKeyhole size={18}/>This passkey approval is only for this simulated purchase.</div>{registered === false && <p>Create a passkey first, then use it to approve this purchase.</p>}{localPasskeyUrl() && <p><a className="demo-text-link" href={localPasskeyUrl()}>Open ProjectV on localhost to set up your passkey</a></p>}{approvalError && <p className="commerce-error" role="alert">{approvalError}</p>}<button className="demo-primary" disabled={!allowed || verifying || !!localPasskeyUrl()} onClick={approve}><Fingerprint size={18}/>{verifying ? "Follow your device’s passkey prompt…" : registered === false ? "Create passkey" : `Approve ${usd(quote.total)} with passkey`}<ArrowRight size={17}/></button><span className="demo-micro demo-centered" role="status">{registered === true ? "Use your fingerprint, face, or device PIN." : "A passkey is required to approve checkout."}</span><div className="demo-approval-actions"><button className="demo-text-button" disabled={verifying} onClick={() => setRun({...run, stage: "review"})}>Edit preferences</button><button className="demo-text-button" disabled={verifying} onClick={() => transition("cancel")}>Decline</button></div></>}
            {run.stage === "complete" && <><p>Your agent did the legwork. You stayed in control.<br/>Imagine every checkout feeling this easy.</p><div className="demo-success-receipt"><div><span className="demo-receipt-label">DEMO RECEIPT</span><Check size={17}/></div><strong>{usd(quote.total)}</strong><p>{reference} · Card ending in 4242</p><span><Truck size={17}/> {run.shipping === "express" ? "1–2" : "3–5"} business days · simulated delivery</span></div><p className="demo-success-note">Demo complete. No real payment or merchant order was placed.{saved?.status === "succeeded" && context.fromCart && !context.fallback && " Checked-out items have been removed from your cart."}</p><div className="demo-save-status" role="status">{saving && <p>Saving your demo order…</p>}{saved && <><p><Check size={15}/> Saved to your orders{saved.status !== "succeeded" ? ` · ${statusLabel(saved.status)} (demo)` : ""}</p><a className="demo-primary" href={`/orders?order=${saved.id}`}>View order · Cancel or refund<ArrowRight size={17}/></a></>}{saveError && <><p className="commerce-error">Your demo finished, but saving the order or updating your cart failed: {saveError}</p><button className="demo-primary" onClick={() => setSaveAttempt(value => value + 1)}>Retry finishing checkout</button></>}</div><button className="demo-primary secondary" onClick={downloadReceipt}>Download demo receipt<ArrowUpRight size={17}/></button><div className="demo-approval-actions"><button className="demo-text-button" disabled={saving || !!saveError} onClick={restart}><RotateCcw size={14}/>Try again</button><a className="demo-text-link" href="/cart">Back to cart<ArrowRight size={15}/></a></div></>}
            {run.stage === "cancelled" && <><p>You’re always in control. This simulation has stopped, and nothing has been charged or ordered.</p><button className="demo-primary" onClick={restart}><RotateCcw size={17}/>Start a fresh demo</button><a className="demo-text-link" href="/wallet">Back to wallet<ArrowRight size={15}/></a></>}
        </section>{run.stage !== "review" && run.stage !== "cancelled" && <Activity stage={run.stage} tick={tick} shipping={run.shipping}/>}</div><Summary run={run} quote={quote}/></div><div className="demo-checkout-footer"><ShieldCheck size={16}/><span>Your agent does the work. You stay in control.</span><span>PROJECTV · AGENT CHECKOUT</span></div>
    </div>;
}
