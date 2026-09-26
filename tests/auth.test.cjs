// Run with: node --test tests/auth.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/scripts/auth.js'), 'utf8');

async function setup({ page = 'home', configured = true, session = null, response, userError } = {}) {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', textContent: '', dataset: {}, hidden: false, disabled: true,
            firstChild: {}, firstElementChild: {}, events: {}, attributes: {},
            addEventListener(event, callback) { this.events[event] = callback; },
            setAttribute(key, value) { this.attributes[key] = value; },
            querySelector() { return this.firstChild; },
            setCustomValidity(value) { this.validationMessage = value; },
            reportValidity() { return !this.validationMessage; }, focus() {},
        });
        return elements.get(id);
    }
    element('auth-config').textContent = JSON.stringify(configured ? { url: 'https://example.supabase.co', key: 'public-test-key' } : {});
    element('email').value = ' alex@example.com ';
    element('password').value = 'test-password';
    element('full-name').value = ' Alex Morgan ';
    const calls = [];
    const redirects = [];
    const auth = {
        getSession: async () => ({ data: { session } }),
        getUser: async () => ({ data: { user: { email: 'alex@example.com', user_metadata: { full_name: 'Alex Morgan' } } }, error: userError }),
        onAuthStateChange() {},
        signUp: async args => { calls.push(['signup', args]); return response; },
        signInWithPassword: async args => { calls.push(['login', args]); return response; },
        signOut: async () => ({ error: null }),
    };
    const body = { dataset: { authPage: page }, hidden: page === 'index' };
    await vm.runInNewContext(source, {
        document: { body, getElementById: element, querySelector: element },
        window: { supabase: { createClient: () => ({ auth }) }, location: { origin: 'http://localhost:5000', replace: url => redirects.push(url) } },
    });
    return { element, calls, redirects, body, submit: () => element('auth-form').events.submit({ preventDefault() {} }) };
}

test('login sends credentials and redirects to index', async () => {
    const app = await setup({ response: { data: { session: { access_token: 'test' } } } });
    await app.submit();
    assert.equal(app.calls[0][0], 'login');
    assert.equal(app.calls[0][1].email, 'alex@example.com');
    assert.deepEqual(app.redirects, ['/index.html']);
});
test('signup sends full name and redirects immediately without confirmation options', async () => {
    const app = await setup({ response: { data: { session: { access_token: 'test' } } } });
    app.element('signup-tab').events.click();
    app.element('password').value = 'test-password';
    await app.submit();
    assert.equal(app.calls[0][1].options.data.full_name, 'Alex Morgan');
    assert.equal(app.calls[0][1].options.emailRedirectTo, undefined);
    assert.deepEqual(app.redirects, ['/index.html']);
});
test('signup without a session does not imply successful login', async () => {
    const app = await setup({ response: { data: { session: null } } });
    app.element('signup-tab').events.click();
    app.element('password').value = 'test-password';
    await app.submit();
    assert.match(app.element('auth-message').textContent, /No login session/);
    assert.equal(app.element('auth-message').dataset.error, 'true');
    assert.equal(app.redirects.length, 0);
});
test('database signup failures remain visible and never redirect', async () => {
    const app = await setup({ response: { error: { message: 'Database error saving new user' } } });
    app.element('signup-tab').events.click();
    app.element('password').value = 'test-password';
    await app.submit();
    assert.equal(app.element('auth-message').textContent, 'Database error saving new user');
    assert.equal(app.element('auth-fields').disabled, false);
    assert.equal(app.redirects.length, 0);
});
test('auth errors restore form without redirect', async () => {
    const app = await setup({ response: { error: { message: 'Invalid login credentials' } } });
    await app.submit();
    assert.equal(app.element('auth-message').dataset.error, 'true');
    assert.equal(app.element('auth-fields').disabled, false);
    assert.equal(app.redirects.length, 0);
});
test('signed-out index redirects and remains hidden', async () => {
    const app = await setup({ page: 'index' });
    assert.deepEqual(app.redirects, ['/home.html']);
    assert.equal(app.body.hidden, true);
});
test('validated session shows index and supports sign-out', async () => {
    const app = await setup({ page: 'index', session: {} });
    assert.equal(app.body.hidden, false);
    await app.element('sign-out').events.click.call(app.element('sign-out'));
    assert.deepEqual(app.redirects, ['/home.html']);
});
test('invalid session cannot reveal index', async () => {
    const app = await setup({ page: 'index', session: {}, userError: { message: 'Expired' } });
    assert.equal(app.body.hidden, true);
    assert.deepEqual(app.redirects, ['/home.html']);
});
test('missing configuration disables submission but allows switching pages', async () => {
    const app = await setup({ configured: false });
    assert.equal(app.element('auth-fields').disabled, true);
    app.element('signup-tab').events.click();
    assert.equal(app.element('name-field').hidden, false);
    assert.equal(app.element('auth-message').hidden, false);
});
