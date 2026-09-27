// Optional browser checks using an external Playwright installation; no app dependency.
// Set PROJECTV_PLAYWRIGHT_PATH to its module path and run `node --test tests/orders.browser.cjs`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("Orders fixture view: responsive layout, filtering, accordion, receipts and motion", {
    skip: !process.env.PROJECTV_PLAYWRIGHT_PATH,
}, async () => {
    const { chromium } = require(process.env.PROJECTV_PLAYWRIGHT_PATH);
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        // This test covers the fixture UI in isolation, never bypasses production auth.
        await page.route("**/scripts/auth.js", route => route.fulfill({ contentType: "text/javascript", body: "" }));
        await page.route("**/scripts/cart-nav.js", route => route.fulfill({ contentType: "text/javascript", body: "" }));
        await page.goto(`${process.env.PROJECTV_TEST_URL || "http://127.0.0.1:5000"}/orders`);
        assert.equal(await page.locator("body").evaluate(body => body.hidden), true);
        await page.evaluate(() => { document.body.hidden = false; });
        await page.waitForFunction(() => document.querySelectorAll(".order-card").length === 4);
        // The initial server-rendered value already equals the final counter value;
        // let the delayed roll-up start and finish before checking it.
        await page.waitForTimeout(1700);
        await page.waitForFunction(() => document.querySelector('[data-metric="spend"]').textContent === "$1,248.36");
        await page.waitForFunction(() => [...document.querySelectorAll(".summary-card, .orders-controls, .orders-list-heading, .order-card")].every(el => getComputedStyle(el).opacity === "1"));
        assert.equal(await page.locator('[data-metric="spend"]').textContent(), "$1,248.36");
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, "orders-desktop.png"), fullPage: true });
        const assertNoOverflow = async label => {
            const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => {
                const rect = el.getBoundingClientRect();
                return getComputedStyle(el).position !== "fixed" && rect.width > 0 && rect.right > innerWidth + 1;
            }).map(el => `${el.tagName}.${el.className}: ${el.getBoundingClientRect().right}`));
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: ${overflow.join(", ")}`);
        };
        await assertNoOverflow("desktop");
        await page.locator('[data-filter="processing"]').click();
        assert.equal(await page.locator(".order-card").count(), 1);
        await page.locator(".order-row").click();
        await page.waitForTimeout(500);
        assert.equal(await page.locator(".order-row").getAttribute("aria-expanded"), "true");
        assert.equal(await page.locator(".order-details").evaluate(el => el.inert), false);
        assert.match(await page.locator(".receipt").textContent(), /112\.00/);
        await page.locator(".order-row").press("Escape");
        await page.waitForTimeout(400);
        assert.equal(await page.locator(".order-details").evaluate(el => el.hidden && el.inert), true);
        await page.locator("#order-search").fill("camera");
        assert.equal(await page.locator("#orders-empty").isVisible(), true);
        await page.locator("#clear-filters").click();
        assert.equal(await page.locator(".order-card").count(), 4);
        await page.locator("#order-search").fill("blanket");
        await page.locator("#arrival-track").click();
        assert.equal(await page.locator('[data-id="PV-84291"] .order-row').getAttribute("aria-expanded"), "true");
        await page.locator("#order-sort").selectOption("highest");
        assert.equal(await page.locator(".order-card").first().getAttribute("data-id"), "PV-82714");
        assert.equal(await page.locator('[data-id="PV-84291"] .order-row').getAttribute("aria-expanded"), "true");
        const downloadPromise = page.waitForEvent("download");
        await page.locator('[data-id="PV-84291"] [data-action="invoice"]').click();
        assert.equal((await downloadPromise).suggestedFilename(), "ProjectV-PV-84291-receipt.txt");
        assert.equal(await page.locator("#orders-notice").isVisible(), true);
        await page.locator("#dismiss-notice").click();
        for (const width of [768, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await assertNoOverflow(`viewport ${width}`);
        }
        await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, "orders-mobile.png"), fullPage: true });
        await page.locator('[data-id="PV-84291"] .order-row').focus();
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
        await page.waitForTimeout(100);
        assert.deepEqual(await page.locator("body").evaluate(body => ({
            background: getComputedStyle(body).backgroundColor,
            colorScheme: getComputedStyle(body).colorScheme,
        })), { background: "rgb(247, 250, 248)", colorScheme: "light" });
        assert.equal(await page.locator('[data-id="PV-84291"] .order-row').evaluate(el => document.activeElement === el), true);
        assert.equal(await page.locator(".order-details").filter({ visible: true }).count(), 1);
        await page.locator('[data-id="PV-84291"] .order-row').click();
        assert.equal(await page.locator('[data-id="PV-84291"] .order-details').evaluate(el => el.hidden), true);
        await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
        await assertNoOverflow("320px, 200% text");
        await page.setViewportSize({ width: 1440, height: 1000 });
        await assertNoOverflow("desktop, 200% text");
        await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.activeElement.blur(); scrollTo(0, 0); });
        if (process.env.PROJECTV_QA_OUTPUT) await page.screenshot({ path: path.join(process.env.PROJECTV_QA_OUTPUT, "orders-light-with-dark-preference.png"), fullPage: true });
        // An explicit teardown should remove UI listeners and stop counter/row animations.
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
        await page.locator('[data-filter="processing"]').click();
        assert.equal(await page.locator(".order-card").count(), 4);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
