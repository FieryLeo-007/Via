// Frontend fixtures only; never reads or mutates a hosted account.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('Reference redesign: real-data Dashboard and Discover refinements', {
    skip: !process.env.PROJECTV_PLAYWRIGHT_PATH,
}, async () => {
    const { chromium } = require(process.env.PROJECTV_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/scripts/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
        await page.addInitScript(() => {
            window.fixtureProducts = [
                { id: 'jacket', title: 'Lightweight running jacket', brand: 'Field', store_name: 'Field Supply', price_cents: 11000, currency: 'USD', rating: 4.6, rating_count: 320, image_url: 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=400&q=80' },
                { id: 'audio', title: 'Travel headphones', brand: 'Studio', store_name: 'Studio', price_cents: 18900, currency: 'USD', rating: 4.2, rating_count: 60, image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=400&q=80' },
                { id: 'lamp', title: 'Portable table lamp', brand: 'Home', store_name: 'Home Studio', price_cents: 5600, currency: 'USD', rating: 4.8, rating_count: 20, image_url: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=400&q=80' },
            ];
            window.projectVAccount = { user: { id: 'fixture' }, client: {
                auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } }, error: null }) },
                from(table) {
                    const query = { select() { return query; }, eq() { return query; }, order() { return query; },
                        upsert() { return query; }, delete() { return query; }, insert() { return query; },
                        range() { return Promise.resolve({ data: table === 'chats'
                            ? [{ id: 'chat-one', title: 'Lightweight running jacket under $120', created_at: '2026-09-25' }]
                            : table === 'chat_turns' ? [{ id: 'turn-one', products: window.fixtureProducts, query: 'running jacket', status: 'complete' }] : [], error: null }); },
                        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
                    }; return query;
                },
            } };
        });
        await page.route('**/api/discover**', async route => {
            const products = await page.evaluate(() => window.fixtureProducts);
            await route.fulfill({ json: { sections: [{ id: 'collection', category: 'Everyday', title: 'Selected for you', search_query: 'essentials', products }], cold_start: false, partial: false } });
        });
        const base = process.env.PROJECTV_TEST_URL || 'http://127.0.0.1:5000';
        await page.goto(base + '/dashboard');
        await page.evaluate(() => { document.body.hidden = false; });
        await page.waitForFunction(() => document.querySelectorAll('.dashboard-recent-list .product-card').length === 3);
        assert.equal(await page.locator('.dashboard-session').count(), 1);
        assert.match(await page.locator('.dashboard-session').textContent(), /Lightweight running jacket/);
        await page.locator('#dashboard-history-open').click();
        assert.equal(await page.locator('#sidebar').isVisible(), true);
        await page.locator('#sidebar-toggle').click();
        assert.equal(await page.locator('#sidebar').isVisible(), false);
        await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, 'redesign-dashboard.png'), fullPage: true });
        for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Dashboard ${width}px`);
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(base + '/discover');
        await page.evaluate(() => { document.body.hidden = false; });
        await page.waitForFunction(() => document.querySelectorAll('#discover-sections .product-card').length === 3);
        await page.locator('#discover-search').fill('jacket');
        assert.equal(await page.locator('#discover-sections .product-card').count(), 1);
        await page.locator('#discover-search').fill('');
        await page.locator('#discover-sort').selectOption('price-low');
        assert.equal(await page.locator('#discover-sections .product-card-name').first().textContent(), 'Portable table lamp');
        await page.locator('#discover-max-price').fill('120');
        await page.locator('.discover-apply').click();
        assert.equal(await page.locator('#discover-sections .product-card').count(), 2);
        await page.locator('#discover-min-rating').selectOption('4.5');
        await page.locator('#discover-brand-options input[value="Field"]').check();
        await page.locator('.discover-apply').click();
        assert.equal(await page.locator('#discover-sections .product-card').count(), 1);
        await page.locator('#discover-refine [type="reset"]').click();
        assert.equal(await page.locator('#discover-sections .product-card').count(), 3);
        await page.locator('.discover-save').first().click();
        assert.equal(await page.locator('.discover-save').first().getAttribute('aria-pressed'), 'true');
        const compare = page.locator('[data-compare-key]');
        await compare.nth(0).click(); await compare.nth(1).click();
        await page.locator('#discover-compare-open').click();
        assert.equal(await page.locator('#discover-compare-dialog').isVisible(), true);
        await page.locator('#discover-compare-close').click();
        await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, 'redesign-discover.png'), fullPage: true });
        for (const width of [1440, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Discover ${width}px`);
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
