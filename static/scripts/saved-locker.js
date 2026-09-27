import { gsap } from "gsap";

// Only presentation preferences live here; products remain account-backed.
export function createSavedLocker(root, productKey, announce) {
    const stage = root.querySelector('.saved-locker');
    const display = root.querySelector('.locker-display');
    const preview = root.querySelector('#locker-product');
    const pin = root.querySelector('#locker-pin');
    const label = root.querySelector('#locker-featured-label');
    const backgrounds = [...root.querySelectorAll('[data-locker-background]')];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let preferences = { background: 'mint', featured: null };
    let storageKey, selected, visible = [], buildCard, context;
    const clearMotion = () => { context?.revert(); context = undefined; };
    function save() {
        try { localStorage.setItem(storageKey, JSON.stringify(preferences)); }
        catch { announce('Customization applied for this visit. Browser storage is unavailable.'); }
    }
    function applyBackground() {
        stage.dataset.background = preferences.background;
        backgrounds.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lockerBackground === preferences.background)));
    }
    function markTiles() {
        root.querySelectorAll('.locker-select').forEach(button => {
            const active = button.dataset.productKey === selected;
            button.setAttribute('aria-pressed', String(active));
            button.closest('.product-card').classList.toggle('is-selected', active);
            button.querySelector('.locker-tile-state').textContent = button.dataset.productKey === preferences.featured ? 'Featured favorite' : active ? 'Selected' : 'View item';
        });
    }
    function show(animate = false) {
        clearMotion();
        const product = visible.find(item => productKey(item) === selected);
        display.hidden = !product;
        preview.replaceChildren();
        if (!product) return;
        preview.appendChild(buildCard({ ...product, top_pick_rank: null, pick_reason: null }, 0, true));
        const featured = selected === preferences.featured;
        pin.textContent = featured ? 'Unpin featured favorite' : 'Pin as featured';
        pin.setAttribute('aria-pressed', String(featured));
        label.textContent = featured ? 'Featured favorite' : 'Selected item';
        markTiles();
        if (animate && !reduced.matches && !document.body.hidden && !root.hidden) {
            context = gsap.context(() => gsap.fromTo(preview, { opacity: .4, y: 8 }, { opacity: 1, y: 0, duration: .22, ease: 'power3.out', clearProps: 'transform,opacity' }), root);
        }
    }
    function chooseBackground(event) {
        preferences.background = event.currentTarget.dataset.lockerBackground;
        applyBackground(); save();
    }
    function togglePin() {
        preferences.featured = preferences.featured === selected ? null : selected;
        save();
        const featured = selected === preferences.featured;
        pin.textContent = featured ? 'Unpin featured favorite' : 'Pin as featured';
        pin.setAttribute('aria-pressed', String(featured));
        label.textContent = featured ? 'Featured favorite' : 'Selected item';
        markTiles();
        announce(featured ? 'Featured favorite pinned.' : 'Featured favorite unpinned.');
    }
    backgrounds.forEach(button => { button.disabled = true; button.addEventListener('click', chooseBackground); });
    pin.addEventListener('click', togglePin);
    reduced.addEventListener('change', clearMotion);
    function dispose(event) {
        if (event.persisted) return;
        clearMotion();
        backgrounds.forEach(button => button.removeEventListener('click', chooseBackground));
        pin.removeEventListener('click', togglePin);
        reduced.removeEventListener('change', clearMotion);
        window.removeEventListener('pagehide', dispose);
    }
    window.addEventListener('pagehide', dispose);
    return {
        render(products, savedProducts, builder) {
            backgrounds.forEach(button => { button.disabled = false; });
            visible = products; buildCard = builder;
            const nextKey = 'projectv:saved-locker:' + (window.projectVAccount?.user?.id || 'local');
            if (nextKey !== storageKey) {
                storageKey = nextKey; selected = undefined;
                preferences = { background: 'mint', featured: null };
                try {
                    const stored = JSON.parse(localStorage.getItem(storageKey));
                    if (['mint', 'grid', 'pearl'].includes(stored?.background)) preferences.background = stored.background;
                    if (typeof stored?.featured === 'string') preferences.featured = stored.featured;
                } catch { /* Corrupt or blocked storage never prevents browsing. */ }
            }
            if (preferences.featured && !savedProducts.has(preferences.featured)) { preferences.featured = null; save(); }
            if (!visible.some(item => productKey(item) === selected)) {
                const first = visible.find(item => productKey(item) === preferences.featured) || visible[0];
                selected = first ? productKey(first) : undefined;
            }
            applyBackground();
            root.querySelectorAll('#saved-products-grid .product-card').forEach((card, index) => {
                const product = visible[index];
                const button = document.createElement('button');
                button.type = 'button'; button.className = 'locker-select';
                button.dataset.productKey = productKey(product);
                button.setAttribute('aria-label', 'Preview ' + product.title);
                button.setAttribute('aria-controls', 'locker-product');
                button.append(card.querySelector('.product-card-media'), card.querySelector('.product-card-brand'), card.querySelector('.product-card-name'), card.querySelector('.product-card-price'));
                const state = document.createElement('span'); state.className = 'locker-tile-state'; button.appendChild(state);
                card.replaceChildren(button);
                button.addEventListener('click', () => {
                    selected = productKey(product); show(true); announce(product.title + ' selected.');
                    if (window.matchMedia('(max-width: 700px)').matches) {
                        preview.querySelector('.product-card-add').focus({ preventScroll: true });
                        display.scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'start' });
                    }
                });
            });
            show();
        },
    };
}
