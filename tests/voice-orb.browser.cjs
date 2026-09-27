// Optional Playwright checks with account, audio and API fixtures only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('orb preview and production voice/search lifecycle', { skip: !process.env.PROJECTV_PLAYWRIGHT_PATH }, async () => {
    const { chromium } = require(process.env.PROJECTV_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const base = process.env.PROJECTV_TEST_URL || 'http://127.0.0.1:5000';
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/static/orb-preview.html');
        await page.waitForFunction(() => window.previewOrb);
        const snapshot = () => page.locator('canvas').evaluate(canvas => canvas.toDataURL());
        const idle = await snapshot(); await page.waitForTimeout(200);
        assert.notEqual(await snapshot(), idle);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => { previewOrb.setState('listening'); previewOrb.setAmplitude(.9); });
        const still = await snapshot(); await page.waitForTimeout(200);
        assert.equal(await snapshot(), still);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => previewOrb.setState('idle'));
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, 'liquid-orb-preview.png') });

        await page.route('**/scripts/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
        await page.addInitScript(() => {
            window.fixtureAudioRequests = 0; window.fixtureDenied = true; window.fixtureStopped = 0;
            navigator.mediaDevices.getUserMedia = async () => {
                window.fixtureAudioRequests++;
                if (window.fixtureDenied) throw new DOMException('Permission denied', 'NotAllowedError');
                return { getTracks: () => [{ stop() { window.fixtureStopped++; } }] };
            };
            window.AudioContext = class {
                state = 'running';
                createAnalyser() { return { disconnect() {}, getFloatTimeDomainData(samples) { samples.fill(.25); } }; }
                createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
                close() { this.state = 'closed'; return Promise.resolve(); }
            };
            const query = { select() { return query; }, eq() { return query; }, order() { return query; }, upsert() { return query; }, insert() { return query; }, single() { return query; }, range() { return Promise.resolve({ data: [], error: null }); }, then(resolve, reject) { return Promise.resolve({ data: {}, error: null }).then(resolve, reject); } };
            window.projectVAccount = { user: { id: 'fixture-user' }, client: { from() { return query; } } };
        });
        let failSearch = true, releasePicks, picksArrived;
        const picksPending = new Promise(resolve => { picksArrived = resolve; });
        const product = { id: 'fixture', title: 'Fixture headphones', price_cents: 10000, currency: 'USD', rating: null };
        await page.route('**/api/intent', route => route.fulfill({ status: failSearch ? 500 : 200, json: failSearch ? { error: { message: 'Fixture failure' } } : { query: 'headphones', brands_exclude: [] } }));
        await page.route('**/api/search', route => route.fulfill({ json: { results: [product] } }));
        await page.route('**/api/picks', async route => {
            await new Promise(resolve => { releasePicks = resolve; picksArrived(); });
            await route.fulfill({ json: { results: [product] } });
        });
        await page.goto(base + '/dashboard');
        await page.evaluate(() => { document.body.hidden = false; });
        const state = () => page.locator('#agent-blob').getAttribute('data-state');
        assert.equal(await state(), 'idle'); assert.equal(await page.evaluate(() => fixtureAudioRequests), 0);
        await page.locator('#voice-btn').click();
        await page.waitForFunction(() => document.getElementById('agent-blob').dataset.state === 'error');
        assert.match(await page.locator('.voice-orb-status').textContent(), /Microphone blocked/);
        await page.evaluate(() => { fixtureDenied = false; });
        await page.locator('#voice-orb-retry').focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('agent-blob').dataset.state === 'listening');
        assert.equal(await page.evaluate(() => fixtureAudioRequests), 2);
        await page.locator('#composer-input').fill('headphones'); await page.locator('#composer-input').press('Enter');
        await page.waitForFunction(() => document.getElementById('agent-blob').dataset.state === 'error');
        assert.equal(await page.evaluate(() => fixtureStopped), 1);
        assert.equal(await page.locator('.voice-orb-retry').isVisible(), true);
        assert.match(await page.locator('.voice-orb-status').textContent(), /Search failed/);
        failSearch = false;
        await page.locator('#voice-orb-retry').click(); await picksPending;
        assert.equal(await state(), 'processing');
        assert.equal(await page.locator('.voice-orb-status').isVisible(), true);
        releasePicks();
        await page.waitForFunction(() => document.getElementById('agent-blob').dataset.state === 'idle');
        assert.equal(await page.locator('.voice-orb-status').textContent(), 'Matches ready');
        assert.equal(await page.locator('.voice-orb-retry').isVisible(), false);
        await page.locator('#new-search-btn').click();
        assert.equal(await state(), 'idle');
        await page.setViewportSize({ width: 320, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; document.activeElement.blur(); scrollTo(0, 0); });
        await page.waitForTimeout(500);
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, 'liquid-orb-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
