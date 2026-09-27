// Optional fixture-only browser checks. Uses an external Playwright module,
// never an actual account and never writes to the hosted database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('Saved: collection, actions, search, sort, empty states and responsive layout', {
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
            const image = id => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=400&q=80`;
            window.savedFixture = [
                { id: 'one', title: 'Studio wireless headphones', brand: 'Studio', store_name: 'Audio Co.', price_cents: 18999, currency: 'USD', image_url: image('photo-1505740420928-5e560c06d30e'), top_pick_rank: 1, pick_reason: 'Old search ranking' },
                { id: 'two', title: 'Everyday crossbody bag', brand: 'Everyday', store_name: 'The Edit', price_cents: 7038, currency: 'USD', image_url: image('photo-1594223274512-ad4803739b7c') },
                { id: 'three', title: 'Portable table lamp', brand: 'Home', store_name: 'Home Studio', price_cents: 5600, currency: 'USD', image_url: image('photo-1507473885765-e6ed057f782c') },
                { id: 'four', title: 'Travel coffee press', brand: 'Brew', store_name: 'Brew Supply', price_cents: 9499, currency: 'USD', image_url: image('photo-1495474472287-4d71bcdd2085') },
            ];
            window.fixtureWrites = [];
            window.projectVAccount = { user: { id: 'fixture-user' }, client: {
                from(table) {
                    let deleting = false;
                    const query = {
                        select() { return query; }, order() { return query; },
                        delete() { deleting = true; return query; },
                        eq(key, value) {
                            if (deleting && key === 'product_key') {
                                window.fixtureWrites.push(value);
                                if (!window.savedFixtureFail) window.savedFixture = window.savedFixture.filter(item => item.id !== value);
                            }
                            return query;
                        },
                        insert() { return Promise.resolve({ data: [], error: null }); },
                        range() { return Promise.resolve({ data: table === 'saved_products' ? window.savedFixture.map(item => ({ product_key: item.id, product_data: item })) : [], error: null }); },
                        then(resolve, reject) { return Promise.resolve({ data: [], error: deleting && window.savedFixtureFail ? { message: 'Fixture connection failure' } : null }).then(resolve, reject); },
                    };
                    return query;
                },
            } };
        });
        await page.goto(`${process.env.PROJECTV_TEST_URL || 'http://127.0.0.1:5000'}/saved`);
        assert.equal(await page.locator('body').evaluate(body => body.hidden), true);
        await page.evaluate(() => { document.body.hidden = false; });
        await page.waitForFunction(() => document.querySelectorAll('#saved-products-grid .product-card').length === 4);
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#saved-products-grid .product-card-buy').count(), 0);
        assert.equal(await page.locator('#saved-products-grid .is-top-pick').count(), 0);
        assert.equal(await page.locator('.locker-select').count(), 4);
        await page.locator('.locker-select').nth(1).focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#locker-product .product-card-name').textContent(), 'Everyday crossbody bag');
        assert.equal(await page.locator('.locker-select[aria-pressed="true"]').count(), 1);
        await page.locator('#locker-pin').click();
        await page.locator('[data-locker-background="grid"]').click();
        assert.equal(await page.locator('.saved-locker').getAttribute('data-background'), 'grid');
        await page.locator('[data-locker-background="pearl"]').click();
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('projectv:saved-locker:fixture-user'))), { background: 'pearl', featured: 'two' });
        await page.reload();
        await page.evaluate(() => { document.body.hidden = false; });
        await page.waitForFunction(() => document.querySelectorAll('.locker-select').length === 4);
        assert.equal(await page.locator('.saved-locker').getAttribute('data-background'), 'pearl');
        assert.equal(await page.locator('#locker-product .product-card-name').textContent(), 'Everyday crossbody bag');
        assert.equal(await page.locator('#locker-pin').getAttribute('aria-pressed'), 'true');
        await page.locator('.locker-select').first().click();
        await page.locator('#locker-pin').click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('projectv:saved-locker:fixture-user')).featured), 'one');
        await page.locator('#locker-pin').click();
        assert.equal(await page.locator('#locker-pin').getAttribute('aria-pressed'), 'false');
        await page.locator('.locker-select').nth(1).click();
        await page.locator('#locker-pin').click();
        await page.locator('[data-locker-background="mint"]').click();
        await page.waitForTimeout(1100);
        const noOverflow = async label => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
        await noOverflow('desktop');
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, 'saved-desktop.png'), fullPage: true });
        await page.locator('#saved-sort').selectOption('name');
        assert.equal(await page.locator('#saved-products-grid .product-card-name').first().textContent(), 'Everyday crossbody bag');
        await page.locator('#saved-filter').fill(' HEADPHONES ');
        assert.equal(await page.locator('#saved-products-grid .product-card').count(), 1);
        await page.locator('.product-card-add').click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('projectv:cart'))[0].id), 'one');
        await page.evaluate(() => { window.savedFixtureFail = true; });
        await page.locator('.product-card-save').click();
        await page.waitForFunction(() => document.querySelector('.account-notice'));
        assert.equal(await page.locator('.product-card-save').isEnabled(), true);
        assert.equal(await page.locator('#saved-products-grid .product-card').count(), 1);
        await page.locator('.account-notice button').click();
        await page.evaluate(() => { window.savedFixtureFail = false; });
        await page.locator('#saved-filter').fill('unfindable');
        assert.equal(await page.locator('.saved-empty h2').textContent(), 'No matching finds');
        await page.locator('.saved-empty button').click();
        assert.equal(await page.locator('#saved-products-grid .product-card').count(), 4);
        for (const width of [1000, 768, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await noOverflow(`viewport ${width}`);
        }
        await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#sidebar').isVisible(), false);
        await page.locator('#mobile-menu-btn').click();
        assert.equal(await page.locator('#sidebar').isVisible(), true);
        await page.locator('#sidebar-backdrop').click({ position: { x: 300, y: 20 } });
        assert.equal(await page.locator('#sidebar').isVisible(), false);
        await page.locator('.locker-select').nth(2).focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#locker-product .product-card-name').textContent(), 'Studio wireless headphones');
        assert.equal(await page.locator('#locker-product .product-card-add').evaluate(el => document.activeElement === el), true);
        await page.locator('.locker-select').first().click();
        await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
        await page.waitForTimeout(500);
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, 'saved-mobile.png'), fullPage: true });
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        await noOverflow('320px, 200% text');
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.locator('.product-card-save').first().click();
        await page.waitForFunction(() => document.querySelectorAll('#saved-products-grid .product-card').length === 3);
        assert.equal(await page.locator('.locker-select').first().evaluate(el => document.activeElement === el), true);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('projectv:saved-locker:fixture-user')).featured), null);
        while (await page.locator('.product-card-save').count()) {
            const before = await page.locator('.locker-select').count();
            await page.locator('.product-card-save').first().click();
            await page.waitForFunction(count => document.querySelectorAll('.locker-select').length < count, before);
        }
        assert.equal(await page.locator('.saved-empty a').getAttribute('href'), '/discover');
        assert.equal(await page.locator('.locker-display').isVisible(), false);
        await page.evaluate(() => localStorage.setItem('projectv:saved-locker:fixture-user', '{invalid'));
        await page.reload();
        await page.evaluate(() => { document.body.hidden = false; });
        await page.waitForFunction(() => document.querySelectorAll('.locker-select').length === 4);
        assert.equal(await page.locator('.saved-locker').getAttribute('data-background'), 'mint');
        assert.equal(await page.locator('#locker-pin').getAttribute('aria-pressed'), 'false');
        await page.evaluate(() => {
            window.fixtureSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
                if (key.startsWith('projectv:saved-locker:')) throw new Error('Blocked storage');
                return window.fixtureSetItem.call(this, key, value);
            };
        });
        await page.locator('[data-locker-background="grid"]').click();
        assert.equal(await page.locator('.saved-locker').getAttribute('data-background'), 'grid');
        await page.waitForFunction(() => document.getElementById('live-status').textContent.includes('storage is unavailable'));
        assert.match(await page.locator('#live-status').textContent(), /storage is unavailable/);
        await page.evaluate(() => { Storage.prototype.setItem = window.fixtureSetItem; });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
