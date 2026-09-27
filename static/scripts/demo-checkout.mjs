// Simulation state and totals. Completed demos are persisted by the UI, never paid.
export const SAMPLE_ITEM = Object.freeze({id: "demo-headphones", title: "Studio Wireless Headphones", store_name: "ProjectV Studio", price_cents: 14900, quantity: 1, image_url: null});
export const DEMO_STAGES = ["review", "shopping", "approval", "purchasing", "complete", "cancelled"];

export function demoItems(items = []) {
    const valid = items.filter(item => item && typeof item.title === "string" && Number.isSafeInteger(item.price_cents) && item.price_cents > 0 && item.price_cents <= 10000000 && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100);
    return (valid.length ? valid : [SAMPLE_ITEM]).map(({id, title, store_name, price_cents, quantity, image_url}) => ({id, title, store_name, price_cents, quantity, image_url}));
}

export function demoQuote(items, shipping = "standard") {
    const subtotal = items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
    const tax = Math.round(subtotal * 0.08);
    const delivery = shipping === "express" ? 1295 : 0;
    return {subtotal, tax, delivery, total: subtotal + tax + delivery};
}

export function withinDemoLimit(total, limit) {
    const cents = Math.round(Number(limit) * 100);
    return /^\d+(\.\d{1,2})?$/.test(String(limit)) && Number.isSafeInteger(cents) && cents > 0 && cents <= 10000000 && total <= cents;
}

export function demoTransition(run, event) {
    if (event === "cancel" && ["shopping", "approval", "purchasing"].includes(run.stage)) return {...run, stage: "cancelled"};
    if (event === "start" && run.stage === "review" && withinDemoLimit(demoQuote(run.items, run.shipping).total, run.limit)) return {...run, stage: "shopping"};
    if (event === "prepared" && run.stage === "shopping") return {...run, stage: "approval"};
    if (event === "approve" && run.stage === "approval" && withinDemoLimit(demoQuote(run.items, run.shipping).total, run.limit)) return {...run, stage: "purchasing"};
    if (event === "finished" && run.stage === "purchasing") return {...run, stage: "complete"};
    return run;
}

export function newDemoRun(items) {
    const products = demoItems(items);
    return {version: 1, orderId: crypto.randomUUID(), items: products, stage: "review", shipping: "standard", limit: String(Math.ceil(demoQuote(products).total / 100 / 10) * 10), id: `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`};
}

export function restoreDemoRun(raw, items) {
    try {
        const run = JSON.parse(raw);
        if (run?.version === 1 && Array.isArray(run.items) && DEMO_STAGES.includes(run.stage) && ["standard", "express"].includes(run.shipping) && /^DEMO-[A-Z0-9]{6}$/.test(run.id) && typeof run.limit === "string" && JSON.stringify(demoItems(run.items)) === JSON.stringify(demoItems(items))) return {...run, orderId: /^[a-f0-9-]{36}$/i.test(run.orderId || "") ? run.orderId : crypto.randomUUID(), items: demoItems(items)};
    } catch { /* Unavailable or outdated session data starts a fresh simulation. */ }
    return newDemoRun(items);
}
