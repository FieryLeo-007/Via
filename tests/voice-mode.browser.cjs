// Optional Playwright check of Voice Mode with a scripted ElevenLabs conversation.
// Run with PROJECTV_PLAYWRIGHT_PATH (and optionally PROJECTV_TEST_URL, PROJECTV_QA_OUTPUT).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const products = [1, 2, 3].map(n => ({
    id: `amazon:${n}`, source: 'amazon', source_id: String(n), title: `Trailblazer ${n} Waterproof Running Shoe - Men's Lightweight`,
    brand: `Brand${n}`, store_name: n === 2 ? 'Walmart' : 'Amazon', price_cents: 7999 + n * 1000, currency: 'USD', rating: 4.2 + n / 10,
    rating_count: 300 * n, product_page_url: `https://shop.example.com/p/${n}`, score: 1, breakdown: { relevance: 1, constraint_fit: 1, quality: 1, priority_fit: 1, base: 1, score: 1 },
    reasons: ['Waterproof', 'Under budget']
}));

test('voice mode runs discovery, cart and demo checkout through client tools', { skip: !process.env.PROJECTV_PLAYWRIGHT_PATH }, async () => {
    const { chromium } = require(process.env.PROJECTV_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const base = process.env.PROJECTV_TEST_URL || 'http://127.0.0.1:5000';
    const shot = (page, name) => process.env.PROJECTV_QA_OUTPUT && page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, name) });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
        const errors = [], demoOrders = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/scripts/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
        await page.route('**/api/voice/session', route => {
            assert.equal(route.request().headers().authorization, 'Bearer fixture-token');
            return route.fulfill({ json: { conversationToken: 'tok', agentId: 'agent', userId: 'fixture-user', dynamicVariables: { user_name: 'Ada' } } });
        });
        await page.route('**/api/search', route => route.fulfill({ json: { results: products, sources: [], partial: false, picks_source: 'none' } }));
        await page.route('**/api/picks', route => {
            const body = route.request().postDataJSON();
            return route.fulfill({ json: { ...body.result, results: body.result.results.map((p, i) => i === 1 ? { ...p, top_pick_rank: 1, pick_reason: 'Best grip for the price' } : p), picks_source: 'ai' } });
        });
        await page.route('**/api/commerce/demo-orders', route => {
            const body = route.request().postDataJSON();
            demoOrders.push(body);
            return route.fulfill({ status: 201, json: { order: { id: body.id, status: 'succeeded', is_demo: true, item: { title: body.items[0].title },
                result: { purchase: { receipt: { merchantOrderId: 'DEMO-1A2B3C4D', total: { amount: body.maxCost } } } } } } });
        });
        await page.addInitScript(() => {
            localStorage.removeItem('projectv:cart');
            navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
            const query = { select() { return query; }, eq() { return query; }, order() { return query; }, upsert() { return query; }, insert() { return query; }, delete() { return query; }, single() { return query; }, range() { return Promise.resolve({ data: [], error: null }); }, then(resolve, reject) { return Promise.resolve({ data: {}, error: null }).then(resolve, reject); } };
            window.projectVAccount = { user: { id: 'fixture-user' }, client: { from() { return query; }, auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } }, error: null }) } } };
            window.fakeVoice = { sent: [], updates: [], muted: null, ended: 0 };
            window.ProjectVVoiceTestConversation = { async startSession(options) {
                window.voiceOptions = options;
                setTimeout(() => options.onConnect({ conversationId: 'conv' }), 0);
                return {
                    getInputVolume: () => .2, getOutputVolume: () => .35,
                    getInputByteFrequencyData: () => new Uint8Array(64).fill(90), getOutputByteFrequencyData: () => new Uint8Array(64).fill(140),
                    setMicMuted: muted => { fakeVoice.muted = muted; }, sendUserMessage: text => fakeVoice.sent.push(text),
                    sendContextualUpdate: text => fakeVoice.updates.push(text), endSession: async () => { fakeVoice.ended++; }
                };
            } };
        });
        await page.goto(base + '/dashboard');
        await page.evaluate(() => { document.body.hidden = false; });

        await page.locator('#voice-btn').click();
        await page.waitForFunction(() => window.voiceOptions && document.getElementById('voice-mode').dataset.phase === 'live');
        assert.equal(await page.locator('#voice-mode').evaluate(dialog => dialog.open), true);
        const variables = await page.evaluate(() => voiceOptions.dynamicVariables);
        assert.equal(variables.user_name, 'Ada'); assert.match(variables.today, /\d{4}/);
        assert.equal(await page.evaluate(() => voiceOptions.connectionType), 'webrtc');
        assert.equal(await page.locator('[data-voice-status]').textContent(), 'Listening…');
        assert.equal(await page.locator('[data-voice-orb]').getAttribute('data-state'), 'listening');

        await page.evaluate(() => { voiceOptions.onMessage({ role: 'agent', message: 'Hey Ada! What are we shopping for today?' }); voiceOptions.onModeChange({ mode: 'speaking' }); });
        assert.equal(await page.locator('[data-voice-caption-agent]').textContent(), 'Hey Ada! What are we shopping for today?');
        assert.equal(await page.locator('[data-voice-orb]').getAttribute('data-state'), 'speaking');
        await page.waitForTimeout(400);
        await shot(page, 'voice-mode-greeting.png');

        await page.evaluate(() => { voiceOptions.onModeChange({ mode: 'listening' }); voiceOptions.onMessage({ role: 'user', message: 'Waterproof trail running shoes under 120 dollars' }); });
        const search = await page.evaluate(() => voiceOptions.clientTools.search_products({ query: 'trail running shoes', max_price: 120, must_have: ['waterproof'] }));
        assert.equal(search.ok, true); assert.equal(search.results.length, 3);
        await page.waitForSelector('.vm-card-badge');
        assert.equal(await page.locator('.vm-card').count(), 3);
        assert.equal(await page.locator('.vm-card').nth(1).locator('.vm-card-badge').textContent(), "V's pick");
        assert.match((await page.evaluate(() => fakeVoice.updates)).join(' '), /#2 .*Best grip/);
        await page.evaluate(() => voiceOptions.onMessage({ role: 'agent', message: 'Number two is the pick: best grip for the price at eighty-nine ninety-nine. The others are on screen.' }));
        await page.waitForTimeout(600);
        await shot(page, 'voice-mode-results.png');

        // A tap is a real action and the agent is told about it.
        await page.locator('.vm-card').nth(0).locator('.vm-card-add').click();
        await page.waitForFunction(() => fakeVoice.updates.some(text => /tapped Add on item #1/.test(text)));
        const added = await page.evaluate(() => voiceOptions.clientTools.add_to_cart({ item: 'second' }));
        assert.equal(added.cart_count, 2);
        assert.equal(await page.locator('.vm-panel h3').textContent(), '2 in your cart');

        const quote = await page.evaluate(() => voiceOptions.clientTools.get_checkout_quote({ shipping: 'standard' }));
        assert.equal(quote.total, '$205.18');
        assert.match(await page.locator('.vm-eyebrow').textContent(), /Demo checkout/);
        await page.waitForTimeout(500);
        await shot(page, 'voice-mode-quote.png');
        const placed = await page.evaluate(id => voiceOptions.clientTools.place_demo_order({ quote_id: id }), quote.quote_id);
        assert.equal(placed.ok, true); assert.match(await page.locator('.vm-verdict').textContent(), /DEMO-1A2B3C4D/);
        assert.equal(demoOrders.length, 1); assert.equal(demoOrders[0].consent, true); assert.equal(demoOrders[0].maxCost, '205.18');
        assert.equal(await page.locator('.vm-panel h3').textContent(), 'Demo order placed');

        await page.locator('#voice-mode-text').fill('Where is my order?');
        await page.locator('[data-voice-type] button').click();
        assert.deepEqual(await page.evaluate(() => fakeVoice.sent), ['Where is my order?']);
        await page.locator('[data-voice-mute]').click();
        assert.equal(await page.evaluate(() => fakeVoice.muted), true);
        assert.equal(await page.locator('[data-voice-status]').textContent(), 'Microphone muted');

        await page.setViewportSize({ width: 375, height: 760 });
        await page.evaluate(() => voiceOptions.clientTools.search_products({ query: 'trail running shoes' }));
        await page.waitForTimeout(600);
        assert.equal(await page.locator('#voice-mode').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true, 'no horizontal overflow on phones');
        await shot(page, 'voice-mode-mobile.png');

        await page.locator('[data-voice-end]').click();
        await page.waitForFunction(() => !document.getElementById('voice-mode').open);
        assert.equal(await page.evaluate(() => fakeVoice.ended), 1);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'voice-btn');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('projectv:cart')).length), 2);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
