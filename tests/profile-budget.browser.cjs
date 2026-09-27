const { test } = require('node:test');
const assert = require('node:assert/strict');

test('profile budget shows dollars and cents but persists numeric amounts', { skip: !process.env.PROJECTV_PLAYWRIGHT_PATH }, async () => {
    const { chromium } = require(process.env.PROJECTV_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage();
        await page.route('**/scripts/auth.js', route => route.fulfill({ body: '' }));
        await page.addInitScript(() => {
            const data = { full_name: 'Fixture', email: 'fixture@example.com', max_spending_budget: 1234.5 };
            const query = { select() { return query; }, eq() { return query; }, single() { return Promise.resolve({ data }); },
                update(value) { window.fixtureBudget = value.max_spending_budget; return query; },
                then(resolve) { return Promise.resolve({ error: null }).then(resolve); } };
            window.projectVAccount = { user: { id: 'fixture', email: data.email }, client: { from() { return query; } } };
        });
        await page.goto((process.env.PROJECTV_TEST_URL || 'http://127.0.0.1:5000') + '/profile');
        const input = page.locator('#budget');
        await page.waitForFunction(() => document.querySelector('#budget').value === '1234.50');
        assert.equal(await page.locator('.profile-currency-input > span').textContent(), '$');
        for (const [entry, formatted, saved] of [['25', '25.00', 25], ['0', '0.00', 0], ['', '', null]]) {
            await input.fill(entry); await input.blur();
            assert.equal(await input.inputValue(), formatted);
            await page.locator('[type="submit"]').click();
            await page.waitForFunction(expected => window.fixtureBudget === expected, saved);
        }
        await input.fill('-1'); await input.blur();
        assert.equal(await input.evaluate(el => el.checkValidity()), false);
    } finally { await browser.close(); }
});
