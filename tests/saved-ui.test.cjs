const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/scripts/app.js'), 'utf8');
const render = source.slice(source.indexOf('    function renderSaved('), source.indexOf('    function openSaved('));
const build = source.slice(source.indexOf('    function buildCard('), source.indexOf('    function renderProductCards('));

// Only the DOM surface used by product cards; behavior comes from app.js itself.
function setup({ persist = async () => {}, add = () => {} } = {}) {
    let document;
    class Element {
        constructor(tag = 'div') {
            this.tag = tag;
            this.children = [];
            this.className = '';
            this.textContent = '';
            this.dataset = {};
            this.attributes = {};
            this.events = {};
            this.style = { setProperty() {} };
            this.classList = {
                add: name => { this.className += ' ' + name; },
                remove: name => { this.className = this.className.split(' ').filter(x => x !== name).join(' '); },
                toggle: (name, enabled) => enabled ? this.classList.add(name) : this.classList.remove(name),
            };
        }
        set innerHTML(html) {
            this.children = [];
            for (const match of html.matchAll(/<(\w+)\b[^>]*class="([^"]+)"/g)) {
                const child = new Element(match[1]);
                child.className = match[2];
                this.children.push(child);
            }
        }
        appendChild(child) { this.children.push(child); return child; }
        append(...children) { children.forEach(child => this.appendChild(child)); }
        replaceChildren(...children) { this.children = children; }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(name, callback) { this.events[name] = callback; }
        focus() { document.activeElement = this; }
        querySelectorAll(selector) {
            const matches = [];
            for (const child of this.children) {
                if (selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tag === selector) matches.push(child);
                matches.push(...child.querySelectorAll(selector));
            }
            return matches;
        }
        querySelector(selector) {
            for (const part of selector.split(',')) {
                const pieces = part.trim().split(/\s+/);
                const found = pieces.length === 1 ? this.querySelectorAll(pieces[0])[0] : this.querySelector(pieces[0])?.querySelector(pieces[1]);
                if (found) return found;
            }
            return null;
        }
    }
    const savedGrid = new Element();
    const savedFilter = new Element('input');
    savedFilter.value = '';
    const ids = new Map([['saved-count', new Element()], ['saved-results-count', new Element()]]);
    document = {
        createElement: tag => new Element(tag),
        getElementById: id => ids.get(id),
        querySelectorAll: selector => savedGrid.querySelectorAll(selector),
    };
    const products = [
        { id: 'one', title: 'Linen shirt', price_cents: 4500, currency: 'USD', top_pick_rank: 1, pick_reason: 'Search-specific recommendation' },
        { id: 'two', title: 'Canvas bag', price_cents: 6200, currency: 'USD' },
    ];
    const savedProducts = new Map(products.map(product => [product.id, product]));
    const announcements = [];
    const errors = [];
    const persistenceCalls = [];
    const cartCalls = [];
    const context = vm.createContext({
        document, savedGrid, savedFilter, savedProducts, savedSort: { value: 'saved' },
        savedView: true, savingProducts: new Set(),
        savedMotion: { beforeRender() {}, afterRender() {} },
        savedLocker: { render() {} },
        ICON_SAVED: '', productKey: product => product.id,
        safeProductUrl: () => null, retailerProductUrl: () => null,
        setSaved: async (product, saved) => { persistenceCalls.push([product.id, saved]); await persist(); },
        addToCart: product => { add(product); cartCalls.push(product); },
        announce: message => announcements.push(message),
        showAccountError: error => errors.push(error.message),
        trackProductEvent: () => Promise.resolve(),
        window: { setTimeout() {} },
    });
    vm.runInContext(render + build + '\nrenderSaved();', context);
    return { document, savedGrid, savedProducts, products, announcements, errors, persistenceCalls, cartCalls,
        render: (query = '', sort = 'saved') => { savedFilter.value = query; context.savedSort.value = sort; vm.runInContext('renderSaved();', context); } };
}

test('Saved renders each item once with Saved actions, without search-specific rankings', () => {
    const app = setup();
    assert.equal(app.savedGrid.children.length, 2);
    const card = app.savedGrid.children[0];
    assert.equal(card.querySelector('.product-card-tag').textContent, 'Saved');
    assert.equal(card.querySelector('.product-card-save').textContent, 'Remove');
    assert.equal(card.querySelector('.product-card-buy'), null);
    assert.equal(card.className.includes('is-top-pick'), false);
    assert.equal(app.products[0].top_pick_rank, 1);
});

test('Saved search and sort leave the underlying account collection untouched', () => {
    const app = setup();
    app.render('', 'name');
    assert.equal(app.savedGrid.children[0].querySelector('.product-card-name').textContent, 'Canvas bag');
    app.render(' SHIRT ');
    assert.equal(app.savedGrid.children.length, 1);
    assert.equal(app.savedGrid.children[0].querySelector('.product-card-name').textContent, 'Linen shirt');
    assert.equal(app.savedProducts.size, 2);
    app.render('not found');
    assert.equal(app.savedGrid.querySelector('.saved-empty h2').textContent, 'No matching finds');
    assert.equal(app.savedGrid.querySelector('.saved-empty button').textContent, 'Clear search');
});

test('failed Saved removal keeps the card and restores its action', async () => {
    const app = setup({ persist: async () => { throw new Error('Connection unavailable'); } });
    const card = app.savedGrid.children[0];
    const remove = card.querySelector('.product-card-save');
    await remove.events.click();
    assert.deepEqual(app.persistenceCalls, [['one', false]]);
    assert.equal(app.savedProducts.has('one'), true);
    assert.equal(app.savedGrid.children[0], card);
    assert.equal(remove.disabled, false);
    assert.equal(remove.textContent, 'Remove');
    assert.deepEqual(app.errors, ['Connection unavailable']);
    assert.deepEqual(app.announcements, []);
});

test('successful Saved removal focuses the next remaining item', async () => {
    const app = setup();
    await app.savedGrid.children[0].querySelector('.product-card-save').events.click();
    assert.equal(app.savedProducts.has('one'), false);
    assert.equal(app.savedGrid.children.length, 1);
    const next = app.savedGrid.children[0].querySelector('.product-card-save');
    assert.equal(next.dataset.productKey, 'two');
    assert.equal(app.document.activeElement, next);
    assert.deepEqual(app.announcements, ['Product removed from Saved.']);
});

test('removing the final Saved item offers Discover and keeps keyboard focus visible', async () => {
    const app = setup();
    await app.savedGrid.children[0].querySelector('.product-card-save').events.click();
    await app.savedGrid.children[0].querySelector('.product-card-save').events.click();
    assert.equal(app.savedProducts.size, 0);
    assert.equal(app.savedGrid.querySelector('.product-card-save'), null);
    const action = app.savedGrid.querySelector('.saved-empty a');
    assert.equal(action.href, '/discover');
    assert.equal(action.textContent, 'Explore Discover');
    assert.equal(app.document.activeElement, action);
});

test('Saved add-to-cart calls the cart store and announces the item', () => {
    const app = setup();
    const add = app.savedGrid.children[0].querySelector('.product-card-add');
    add.events.click();
    assert.equal(app.cartCalls[0].id, app.products[0].id);
    assert.deepEqual(app.announcements, ['Linen shirt added to cart.']);
    assert.equal(app.savedProducts.size, 2);
});

function setupMotion(reducedMotion = false) {
    const contexts = [];
    const animations = [];
    const body = { hidden: true };
    const root = { hidden: false };
    const windowEvents = new Map();
    const mediaEvents = new Map();
    const media = {
        matches: reducedMotion,
        addEventListener: (name, callback) => mediaEvents.set(name, callback),
        removeEventListener: name => mediaEvents.delete(name),
    };
    let observer;
    const context = vm.createContext({
        document: { body },
        window: {
            matchMedia: () => media,
            addEventListener: (name, callback) => windowEvents.set(name, callback),
            removeEventListener: name => windowEvents.delete(name),
        },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.disconnects = 0; observer = this; }
            observe() {}
            disconnect() { this.disconnects += 1; }
        },
        gsap: {
            context(callback, scope) {
                const animationContext = { scope, reverts: 0, revert() { this.reverts += 1; } };
                contexts.push(animationContext);
                callback();
                return animationContext;
            },
            fromTo: (...args) => animations.push(args),
        },
        root,
    });
    const motionSource = fs.readFileSync(path.join(__dirname, '../static/scripts/saved-motion.js'), 'utf8')
        .replace(/^import[^\n]+\n/, '').replace('export function', 'function');
    vm.runInContext(motionSource + '\nvar motion = createSavedMotion(root);', context);
    return { motion: context.motion, body, contexts, animations, observer, windowEvents, mediaEvents };
}

test('Saved motion waits for authentication and cleans up replaced cards and page listeners', () => {
    const app = setupMotion();
    app.motion.afterRender();
    assert.equal(app.animations.length, 0);
    app.body.hidden = false;
    app.observer.callback();
    assert.equal(app.animations.length, 2);
    app.motion.beforeRender();
    assert.equal(app.contexts[1].reverts, 1);
    app.motion.afterRender();
    assert.equal(app.animations.length, 3);
    app.windowEvents.get('pagehide')({ persisted: true });
    assert.equal(app.observer.disconnects, 0);
    app.windowEvents.get('pagehide')({ persisted: false });
    assert.equal(app.observer.disconnects, 1);
    assert.equal(app.windowEvents.has('pagehide'), false);
    assert.equal(app.mediaEvents.size, 0);
    assert.equal(app.contexts[0].reverts, 1);
    assert.equal(app.contexts[2].reverts, 1);
});

test('Saved motion respects reduced motion while rendering remains available', () => {
    const app = setupMotion(true);
    app.body.hidden = false;
    app.motion.afterRender();
    app.motion.beforeRender();
    app.motion.afterRender();
    assert.equal(app.animations.length, 0);
    app.motion.dispose();
    assert.equal(app.observer.disconnects, 1);
});
