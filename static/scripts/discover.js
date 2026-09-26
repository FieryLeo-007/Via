import confetti from "canvas-confetti";
import { gsap } from "gsap";

/** @typedef {{ discountText: string, badgeText?: string }} DealTag */
/** @typedef {{ id: string, title: string, imageUrl: string, link: string, price?: string, deal?: DealTag, tone?: string }} DiscoverItem */

const image = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=640&q=80`;

/** @type {Array<object>} */
const discoveryCards = [
    {
        type: "quad",
        title: "Refresh your home",
        actionLabel: "See more for your home",
        actionHref: "/dashboard?query=home+refresh",
        items: [
            { id: "home-1", title: "Soft lighting", imageUrl: image("photo-1507473885765-e6ed057f782c"), link: "/dashboard?query=table+lamps", tone: "sand" },
            { id: "home-2", title: "Statement chairs", imageUrl: image("photo-1503602642458-232111445657"), link: "/dashboard?query=accent+chairs", tone: "sage" },
            { id: "home-3", title: "Better bedding", imageUrl: image("photo-1505693416388-ac5ce068fe85"), link: "/dashboard?query=bedding", deal: { discountText: "Up to 20% off" }, tone: "blue" },
            { id: "home-4", title: "Modern storage", imageUrl: image("photo-1555041469-a586c61ea9bc"), link: "/dashboard?query=home+storage", tone: "clay" }
        ]
    },
    {
        type: "quad",
        title: "Trending in fashion",
        actionLabel: "Explore new styles",
        actionHref: "/dashboard?query=trending+fashion",
        items: [
            { id: "style-1", title: "Everyday sneakers", imageUrl: image("photo-1542291026-7eec264c27ff"), link: "/dashboard?query=sneakers", deal: { discountText: "15% off", badgeText: "Limited time" }, tone: "rose" },
            { id: "style-2", title: "Carry-all bags", imageUrl: image("photo-1553062407-98eeb64c6a62"), link: "/dashboard?query=carryall+bags", tone: "sand" },
            { id: "style-3", title: "Minimal watches", imageUrl: image("photo-1524592094714-0f0654e20314"), link: "/dashboard?query=minimal+watches", tone: "blue" },
            { id: "style-4", title: "Easy layers", imageUrl: image("photo-1445205170230-053b83016050"), link: "/dashboard?query=lightweight+layers", tone: "sage" }
        ]
    },
    {
        type: "hero",
        title: "Sound that moves with you",
        subtitle: "Portable audio, selected for comfort and clear listening.",
        imageUrl: image("photo-1505740420928-5e560c06d30e"),
        actionLabel: "Shop personal audio",
        actionHref: "/dashboard?query=portable+audio",
        bgTone: "ink"
    },
    {
        type: "recent",
        title: "Keep shopping for",
        actionLabel: "View your history",
        actionHref: "/dashboard",
        items: [
            { id: "recent-1", title: "Compact mirrorless cameras", imageUrl: image("photo-1516035069371-29a1b244cc32"), link: "/dashboard?query=mirrorless+camera", price: "$699", tone: "blue" },
            { id: "recent-2", title: "Mechanical keyboards", imageUrl: image("photo-1587829741301-dc798b83add3"), link: "/dashboard?query=mechanical+keyboard", price: "$89", tone: "clay" }
        ]
    },
    {
        type: "quad",
        title: "Daily essentials",
        actionLabel: "Stock up and save",
        actionHref: "/dashboard?query=daily+essentials",
        items: [
            { id: "daily-1", title: "Skin care", imageUrl: image("photo-1556228578-8c89e6adf883"), link: "/dashboard?query=skin+care", deal: { discountText: "10% off" }, tone: "rose" },
            { id: "daily-2", title: "Coffee at home", imageUrl: image("photo-1495474472287-4d71bcdd2085"), link: "/dashboard?query=coffee+essentials", tone: "clay" },
            { id: "daily-3", title: "Pantry favorites", imageUrl: image("photo-1542838132-92c53300491e"), link: "/dashboard?query=pantry+favorites", tone: "sage" },
            { id: "daily-4", title: "Hydration", imageUrl: image("photo-1602143407151-7111542de6e8"), link: "/dashboard?query=water+bottles", deal: { discountText: "From $18" }, tone: "blue" }
        ]
    }
];

/** @type {DiscoverItem[]} */
const recommendedDeals = [
    { id: "deal-1", title: "Cloud-knit throw blanket", imageUrl: image("photo-1580301762395-21ce84d00bc6"), link: "/dashboard?query=throw+blanket", price: "$28.99", deal: { discountText: "35% off", badgeText: "Limited time deal" }, tone: "sand" },
    { id: "deal-2", title: "Wireless over-ear headphones", imageUrl: image("photo-1484704849700-f032a568e944"), link: "/dashboard?query=wireless+headphones", price: "$74.00", deal: { discountText: "42% off" }, tone: "sage" },
    { id: "deal-3", title: "Stoneware dinner set", imageUrl: image("photo-1610701596007-11502861dcfa"), link: "/dashboard?query=stoneware+dinner+set", price: "$46.50", deal: { discountText: "20% off" }, tone: "blue" },
    { id: "deal-4", title: "Everyday crossbody bag", imageUrl: image("photo-1594223274512-ad4803739b7c"), link: "/dashboard?query=crossbody+bag", price: "$39.99", deal: { discountText: "30% off" }, tone: "rose" },
    { id: "deal-5", title: "Portable table lamp", imageUrl: image("photo-1507473885765-e6ed057f782c"), link: "/dashboard?query=portable+lamp", price: "$31.20", deal: { discountText: "25% off" }, tone: "clay" },
    { id: "deal-6", title: "Travel coffee press", imageUrl: image("photo-1495474472287-4d71bcdd2085"), link: "/dashboard?query=travel+coffee+press", price: "$24.95", deal: { discountText: "18% off" }, tone: "sand" }
];

/** @type {DiscoverItem[]} */
const newFinds = [
    { id: "new-1", title: "Sculptural accent chair", imageUrl: image("photo-1503602642458-232111445657"), link: "/dashboard?query=sculptural+chair", price: "$189", tone: "sage" },
    { id: "new-2", title: "Compact travel weekender", imageUrl: image("photo-1553062407-98eeb64c6a62"), link: "/dashboard?query=travel+weekender", price: "$64", tone: "sand" },
    { id: "new-3", title: "Minimal bedside clock", imageUrl: image("photo-1563861826100-9cb868fdbe1c"), link: "/dashboard?query=bedside+clock", price: "$42", tone: "blue" },
    { id: "new-4", title: "Soft cotton bedding", imageUrl: image("photo-1505693416388-ac5ce068fe85"), link: "/dashboard?query=cotton+bedding", price: "$88", tone: "rose" },
    { id: "new-5", title: "Studio desk keyboard", imageUrl: image("photo-1587829741301-dc798b83add3"), link: "/dashboard?query=desk+keyboard", price: "$95", tone: "clay" },
    { id: "new-6", title: "Matte insulated bottle", imageUrl: image("photo-1602143407151-7111542de6e8"), link: "/dashboard?query=insulated+bottle", price: "$26", tone: "sage" }
];

function safeImageUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
        return "";
    }
}

function productImage(item, className = "") {
    const frame = document.createElement("div");
    frame.className = `discover-image ${className}`.trim();
    frame.dataset.tone = item.tone || "sand";

    const imageElement = document.createElement("img");
    imageElement.src = safeImageUrl(item.imageUrl);
    imageElement.alt = "";
    imageElement.width = 640;
    imageElement.height = 480;
    imageElement.loading = "lazy";
    imageElement.decoding = "async";
    imageElement.referrerPolicy = "no-referrer";
    imageElement.addEventListener("error", () => {
        imageElement.remove();
        frame.classList.add("is-fallback");
    });
    frame.appendChild(imageElement);
    return frame;
}

function actionLink(label, href) {
    const link = document.createElement("a");
    link.className = "discover-card-action";
    link.href = href;
    link.textContent = label;
    link.dataset.pressable = "true";
    return link;
}

function quadCard(card) {
    const article = document.createElement("article");
    article.className = "discover-card surface-card quad-card";
    const title = document.createElement("h3");
    title.textContent = card.title;
    article.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "quad-grid";
    card.items.forEach((item) => {
        const link = document.createElement("a");
        link.className = "quad-item";
        link.href = item.link;
        link.dataset.pressable = "true";
        link.appendChild(productImage(item));
        if (item.deal) {
            const badge = document.createElement("span");
            badge.className = "deal-mini-badge brand-badge";
            badge.textContent = item.deal.discountText;
            link.appendChild(badge);
        }
        const label = document.createElement("span");
        label.className = "quad-label";
        label.textContent = item.title;
        link.appendChild(label);
        grid.appendChild(link);
    });
    article.appendChild(grid);
    article.appendChild(actionLink(card.actionLabel, card.actionHref));
    return article;
}

function heroCard(card) {
    const article = document.createElement("article");
    article.className = "discover-card surface-card promo-card";
    article.dataset.tone = card.bgTone || "ink";
    article.appendChild(productImage({ imageUrl: card.imageUrl, tone: "ink" }, "promo-image"));
    const body = document.createElement("div");
    body.className = "promo-body";
    const title = document.createElement("h3");
    title.textContent = card.title;
    const subtitle = document.createElement("p");
    subtitle.textContent = card.subtitle || "";
    body.append(title, subtitle, actionLink(card.actionLabel, card.actionHref));
    article.appendChild(body);
    return article;
}

function recentCard(card) {
    const article = document.createElement("article");
    article.className = "discover-card surface-card recent-card";
    const title = document.createElement("h3");
    title.textContent = card.title;
    article.appendChild(title);
    const list = document.createElement("div");
    list.className = "recent-list";
    card.items.forEach((item) => {
        const link = document.createElement("a");
        link.className = "recent-item";
        link.href = item.link;
        link.dataset.pressable = "true";
        link.appendChild(productImage(item));
        const copy = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = item.title;
        const price = document.createElement("small");
        price.textContent = `${item.price} · View item`;
        copy.append(name, price);
        link.appendChild(copy);
        list.appendChild(link);
    });
    article.appendChild(list);
    article.appendChild(actionLink(card.actionLabel, card.actionHref));
    return article;
}

function dealCard(item) {
    const article = document.createElement("article");
    article.className = "deal-card surface-card";
    const link = document.createElement("a");
    link.href = item.link;
    link.dataset.pressable = "true";
    if (item.deal) link.dataset.confetti = "deal";
    link.setAttribute("aria-label", `${item.title}, ${item.price}`);
    link.appendChild(productImage(item, "deal-image"));
    if (item.deal) {
        const row = document.createElement("div");
        row.className = "deal-badge-row";
        const discount = document.createElement("span");
        discount.className = "brand-badge";
        discount.textContent = item.deal.discountText;
        row.appendChild(discount);
        if (item.deal.badgeText) {
            const badgeText = document.createElement("small");
            badgeText.textContent = item.deal.badgeText;
            row.appendChild(badgeText);
        }
        link.appendChild(row);
    }
    const title = document.createElement("h3");
    title.textContent = item.title;
    const price = document.createElement("strong");
    price.textContent = item.price || "See price";
    link.append(title, price);
    article.appendChild(link);
    return article;
}

const cardGrid = document.getElementById("discover-card-grid");
discoveryCards.forEach((card) => {
    cardGrid.appendChild(card.type === "quad" ? quadCard(card) : card.type === "hero" ? heroCard(card) : recentCard(card));
});

recommendedDeals.forEach((item) => document.getElementById("recommended-deals").appendChild(dealCard(item)));
newFinds.forEach((item) => document.getElementById("new-finds").appendChild(dealCard(item)));

function tileInfiniteCarousel(track) {
    const items = Array.from(track.children);
    const group = document.createElement("div");
    group.className = "deal-marquee-group";
    group.append(...items);

    const duplicate = group.cloneNode(true);
    duplicate.setAttribute("aria-hidden", "true");
    duplicate.querySelectorAll("a, button").forEach((element) => element.setAttribute("tabindex", "-1"));
    track.replaceChildren(group, duplicate);

    return { group, duplicate };
}

const marqueeTracks = Array.from(document.querySelectorAll(".deal-track"));
marqueeTracks.forEach(tileInfiniteCarousel);

/* ---------- Discover-only motion ---------- */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const motionCards = Array.from(document.querySelectorAll(".discover-card, .deal-card"));
document.body.classList.add("motion-ready");

const motionCleanup = [];
const motionContext = gsap.context(() => {
    if (reduceMotion) return;

    gsap.fromTo(
        ".discover-heading-row, .discover-card, .deal-section",
        { autoAlpha: 0, y: 24 },
        { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.075, delay: 0.12, ease: "power3.out", clearProps: "opacity,visibility" }
    );

    marqueeTracks.forEach((track) => {
        const shell = track.closest(".deal-marquee-shell");
        const reverse = track.dataset.marqueeDirection === "reverse";
        const tween = gsap.fromTo(
            track,
            { xPercent: reverse ? -50 : 0 },
            {
                xPercent: reverse ? 0 : -50,
                duration: reverse ? 42 : 38,
                ease: "none",
                repeat: -1
            }
        );

        const setSpeed = (timeScale) => {
            gsap.to(tween, {
                timeScale,
                duration: timeScale < 1 ? 0.8 : 0.65,
                ease: "power2.out",
                overwrite: true
            });
        };
        const slowMarquee = () => setSpeed(0.15);
        const resumeMarquee = (event) => {
            if (event.type === "focusout" && shell?.contains(event.relatedTarget)) return;
            setSpeed(1);
        };

        shell?.addEventListener("pointerenter", slowMarquee);
        shell?.addEventListener("pointerleave", resumeMarquee);
        shell?.addEventListener("focusin", slowMarquee);
        shell?.addEventListener("focusout", resumeMarquee);
        motionCleanup.push(() => {
            shell?.removeEventListener("pointerenter", slowMarquee);
            shell?.removeEventListener("pointerleave", resumeMarquee);
            shell?.removeEventListener("focusin", slowMarquee);
            shell?.removeEventListener("focusout", resumeMarquee);
            gsap.killTweensOf(tween);
            tween.kill();
        });
    });

    motionCards.forEach((card) => {
        gsap.set(card, { transformPerspective: 900, transformOrigin: "center" });
        const rotateXTo = gsap.quickTo(card, "rotationX", { duration: 0.38, ease: "power3.out" });
        const rotateYTo = gsap.quickTo(card, "rotationY", { duration: 0.38, ease: "power3.out" });
        const scaleTo = gsap.quickTo(card, "scale", { duration: 0.38, ease: "power3.out" });
        const yTo = gsap.quickTo(card, "y", { duration: 0.38, ease: "power3.out" });

        const tiltCard = (event) => {
            if (event.pointerType === "touch") return;
            const bounds = card.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / bounds.width - 0.5;
            const y = (event.clientY - bounds.top) / bounds.height - 0.5;
            rotateXTo(y * -8);
            rotateYTo(x * 10);
        };
        const liftCard = (event) => {
            if (event.pointerType === "touch") return;
            scaleTo(1.025);
            yTo(-6);
        };
        const resetCard = () => {
            rotateXTo(0);
            rotateYTo(0);
            scaleTo(1);
            yTo(0);
        };

        card.addEventListener("pointerenter", liftCard);
        card.addEventListener("pointermove", tiltCard);
        card.addEventListener("pointerleave", resetCard);
        card.addEventListener("pointercancel", resetCard);
        motionCleanup.push(() => {
            card.removeEventListener("pointerenter", liftCard);
            card.removeEventListener("pointermove", tiltCard);
            card.removeEventListener("pointerleave", resetCard);
            card.removeEventListener("pointercancel", resetCard);
            gsap.killTweensOf(card);
        });
    });
}, document.querySelector(".discover-main"));

function cleanupDiscoverMotion() {
    motionCleanup.splice(0).forEach((cleanup) => cleanup());
    motionContext.revert();
}

window.addEventListener("pagehide", (event) => {
    if (!event.persisted) cleanupDiscoverMotion();
});

document.querySelectorAll("button, [data-pressable='true']").forEach((target) => {
    target.addEventListener("pointerdown", () => {
        if (!reduceMotion) gsap.to(target, { scale: 0.96, duration: 0.1, ease: "power2.out", overwrite: true });
    });
    const release = () => {
        if (!reduceMotion) gsap.to(target, { scale: 1, duration: 0.36, ease: "back.out(2.4)", overwrite: true });
    };
    target.addEventListener("pointerup", release);
    target.addEventListener("pointercancel", release);
    target.addEventListener("pointerleave", release);
});

function burstFrom(target) {
    if (reduceMotion) return;
    const rect = target.getBoundingClientRect();
    confetti({
        particleCount: 28,
        spread: 48,
        startVelocity: 20,
        gravity: 0.9,
        scalar: 0.62,
        ticks: 90,
        colors: ["#0B6B3A", "#16A765", "#C4D8C4", "#F7FAF8"],
        origin: {
            x: Math.max(0, Math.min(1, (rect.left + rect.width / 2) / window.innerWidth)),
            y: Math.max(0, Math.min(1, (rect.top + rect.height / 2) / window.innerHeight))
        },
        disableForReducedMotion: true
    });
}

document.querySelector(".promo-card .discover-card-action")?.setAttribute("data-confetti", "featured");
document.querySelectorAll("[data-confetti]").forEach((target) => {
    target.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        burstFrom(target);
        if (!reduceMotion && target.href) {
            event.preventDefault();
            window.setTimeout(() => window.location.assign(target.href), 180);
        }
    });
});

document.querySelectorAll(".deal-mini-badge, .deal-badge-row .brand-badge").forEach((badge) => {
    badge.closest("a")?.addEventListener("pointerenter", () => {
        if (!reduceMotion) {
            gsap.timeline({ defaults: { overwrite: true } })
                .to(badge, { scale: 1.08, y: -2, duration: 0.14, ease: "power2.out" })
                .to(badge, { scale: 1, y: 0, duration: 0.24, ease: "back.out(2)" });
        }
    });
});

const primaryNav = document.querySelector(".primary-nav");
const navPill = primaryNav?.querySelector(".nav-hover-pill");
const navLinks = primaryNav ? Array.from(primaryNav.querySelectorAll(".nav-link")) : [];
const activeNavLink = primaryNav?.querySelector(".nav-link.is-active");

function moveNavPill(target, immediate = false) {
    if (!primaryNav || !navPill || !target) return;
    if (immediate) navPill.style.transition = "none";
    navPill.style.width = `${target.offsetWidth}px`;
    navPill.style.transform = `translate3d(${target.offsetLeft}px, 0, 0)`;
    primaryNav.classList.add("is-pill-ready");
    if (immediate) {
        navPill.getBoundingClientRect();
        navPill.style.removeProperty("transition");
    }
}

navLinks.forEach((link) => {
    link.addEventListener("pointerenter", () => moveNavPill(link));
    link.addEventListener("focus", () => moveNavPill(link));
});
primaryNav?.addEventListener("pointerleave", () => moveNavPill(activeNavLink));
primaryNav?.addEventListener("focusout", (event) => {
    if (!primaryNav.contains(event.relatedTarget)) moveNavPill(activeNavLink);
});
window.addEventListener("resize", () => moveNavPill(activeNavLink, true));
moveNavPill(activeNavLink, true);
