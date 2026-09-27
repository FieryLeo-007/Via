import { gsap } from "gsap";

// Each render owns a context so replacing cards cannot retain detached nodes.
export function createSavedMotion(root) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let headerContext;
    let cardsContext;
    let headerPending = true;
    let cardsPending = false;
    let disposed = false;
    function run() {
        if (disposed || document.body.hidden || root.hidden) return;
        if (headerPending && !reduced.matches) {
            headerContext = gsap.context(() => {
                gsap.fromTo(".saved-heading, .saved-toolbar, .saved-results-heading", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .5, stagger: .08, ease: "power3.out", clearProps: "transform,opacity" });
            }, root);
        }
        headerPending = false;
        if (cardsPending && !reduced.matches) {
            cardsContext = gsap.context(() => {
                gsap.fromTo("#saved-products-grid .product-card, .saved-empty", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .5, stagger: .08, ease: "power3.out", clearProps: "transform,opacity" });
            }, root);
        }
        cardsPending = false;
    }
    function clear() {
        headerContext?.revert();
        cardsContext?.revert();
        headerContext = cardsContext = undefined;
    }
    const observer = new MutationObserver(run);
    observer.observe(document.body, { attributes: true, attributeFilter: ["hidden"] });
    observer.observe(root, { attributes: true, attributeFilter: ["hidden"] });
    reduced.addEventListener("change", clear);
    function dispose(event) {
        if (event?.persisted) return;
        disposed = true;
        observer.disconnect();
        reduced.removeEventListener("change", clear);
        window.removeEventListener("pagehide", dispose);
        clear();
    }
    window.addEventListener("pagehide", dispose);
    return {
        beforeRender() { cardsContext?.revert(); cardsContext = undefined; },
        afterRender(animate = true) { cardsPending = animate; run(); },
        hide() { clear(); headerPending = true; cardsPending = false; },
        dispose,
    };
}
