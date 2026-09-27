const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Shared navigation glass and cursor ring on all collection pages', {
    skip: !process.env.PROJECTV_PLAYWRIGHT_PATH,
}, async () => {
    const { chromium } = require(process.env.PROJECTV_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // UI isolation only: do not change production auth or access hosted accounts.
        await page.route('**/scripts/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
        await page.route('https://**', route => route.abort());
        for (const path of ['/dashboard', '/discover', '/saved', '/orders']) {
            await page.goto(`${process.env.PROJECTV_TEST_URL || 'http://127.0.0.1:5000'}${path}`);
            await page.evaluate(() => { document.body.hidden = false; });
            const link = page.locator('.primary-nav a[href="/saved"]');
            await link.hover();
            await page.waitForTimeout(350);
            assert.equal(await page.locator('#cursor-aura').count(), 1, path);
            assert.equal(await page.locator('#cursor-aura').evaluate(el => el.classList.contains('is-visible')), true, path);
            const geometry = await page.evaluate(() => {
                const link = document.querySelector('.primary-nav a[href="/saved"]').getBoundingClientRect();
                const pill = document.querySelector('.nav-hover-pill').getBoundingClientRect();
                return { delta: Math.abs(link.left - pill.left), width: Math.abs(link.width - pill.width) };
            });
            assert.ok(geometry.delta < 1 && geometry.width < 1, `${path}: glass follows hover`);
            await page.locator('.primary-nav a[href="/discover"]').focus();
            await page.waitForTimeout(300);
            assert.equal(await page.locator('.primary-nav').evaluate(el => el.classList.contains('is-pill-ready')), true);
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.mouse.move(100, 100);
            assert.equal(await page.locator('.cursor-aura.is-visible').count(), 0, `${path}: reduced motion`);
            await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});
