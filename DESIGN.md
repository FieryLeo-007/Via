# DESIGN.md — ProjectV visual & interaction system

> Source of truth for every pixel. Read fully before touching UI. Stack: **HTML + Tailwind CSS v4 + vanilla JavaScript (ES modules, Vite)**. No framework.
> The one sentence to design against: **"A private shopper that shows its reasoning."**

---

## 1. Direction: "The Glasshouse"

ProjectV is a well-lit private shopping room: cool daylight, porcelain surfaces, precise instruments. It is calm, not flashy. The product shows reasoning that other shops hide, so the design gives that reasoning the best seat in the room.

**The one bold thing: the Score Ribbon.** Every ranked product carries a thin horizontal bar split into colored segments, one per ranking factor. The **orchid "You" segment** is personalization made literal. When taste changes, the orchid grows or shrinks and the rows physically re-sort. When the user toggles *Show unpersonalized*, every orchid segment drains to zero and the shelf reorders in front of them.

Everything else stays quiet so the ribbon is what people remember.

**What we are deliberately not:** a dark neon dashboard, a cream-and-serif editorial page, a grid of identical rounded cards, glassmorphism, gradient washes, or a chatbot window with a product carousel bolted on.

---

## 2. Color

Light is the primary theme (projectors and daylight demo halls favor it); dark is fully supported. All text pairs below are measured and pass WCAG AA (4.5:1+).

| Token | Light | Dark | Role |
|---|---|---|---|
| `porcelain` | `#EEF1EC` | `#151A21` | App background |
| `paper` | `#F8FAF6` | `#232B35` | Raised surfaces: hero pick, sheets, popovers |
| `shelf` | `#E3E8E1` | `#1D242D` | Recessed areas: image plates, input wells, row hover |
| `ink` | `#1C2430` | `#E8ECE6` | Primary text, primary buttons (13.7:1) |
| `ink-2` | `#4A5563` | `#A4AEB9` | Secondary text (6.6:1) |
| `line` | `ink` @ 10% | `ink` @ 12% | Hairlines and dividers |
| `orchid` | `#9E2F86` | `#E27BCB` | **You/personalization. Nothing else uses this hue.** (5.8:1) |
| `spruce` | `#1D6552` | `#5FC2A4` | Verified, secure, confirmed (6.1:1) |
| `slate` | `#46618C` | `#8FA8D6` | Relevance factor, links, focus ring |
| `ochre` | `#8C6212` | `#E0B456` | Quality/rating factor |
| `sage` | `#5E7D63` | `#9DBBA1` | Constraint-fit factor. **Bar fills only, never text** (4.0:1). |
| `brick` | `#A63A28` | `#F08A76` | Errors and destructive actions only |

**Color rules**
- **Orchid is sacred.** It only ever means "because of you": the ribbon segment, reasons rooted in taste, the Taste page, and preference suggestions. That consistency is what lets a judge learn the language in ten seconds.
- **Spruce is trust.** It appears only on verified checks, the authorization flow, and confirmations.
- **Ribbon segments always follow the same order and colors:** relevance (slate) → constraints (sage) → quality (ochre) → you (orchid). Never rely on color alone: every ribbon has a text legend on hover/focus and an `aria-label`.
- **No gradients.** The single exception is the voice waveform, which is drawn, not decorative.

---

## 3. Typography

**One family: [Schibsted Grotesk](https://fonts.google.com/specimen/Schibsted+Grotesk)** (variable, 400–900), from Google Fonts. Its slightly condensed, editorial grotesk voice gives prices and headlines real presence without resorting to a serif.
- Fallback stack: `"Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif`.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere a number can change (prices, ranks, counts, timers). No monospace font anywhere in the product UI.

| Style | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| `price-hero` | 56 / 56 | 800 | -0.03em | Hero pick price |
| `display` | 40 / 44 | 750 | -0.025em | Empty-state ask prompt, receipt total |
| `title` | 26 / 32 | 700 | -0.015em | Hero product title, page titles |
| `heading` | 18 / 24 | 650 | -0.01em | Section and sheet headings |
| `body` | 15 / 22 | 450 | 0 | Default text |
| `row-title` | 15 / 20 | 600 | -0.005em | Ranked row titles (2-line clamp) |
| `small` | 13 / 18 | 500 | 0 | Merchant, rating, timestamps, reasons |
| `micro` | 12 / 16 | 600 | 0.01em | Rank numbers, legend keys |

**Type rules**
- Sentence case everywhere. **No all-caps labels, no eyebrow text above headings.**
- Maximum line length is 68ch for prose (agent replies, errors).
- Price is always the heaviest element in its container.
- Never highlight a single word in a headline with color or italics.

---

## 4. Space, shape, elevation

- **Grid:** 4 px base. Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64. Page gutter is 32 px desktop, 16 px mobile.
- **Radii follow hierarchy, not habit:** 6 px controls and inputs · 10 px thumbnails · 16 px hero pick and panels · 24 px sheets · full-round only for the mic button and avatars.
- **Elevation is earned.** Rows sit flat on `porcelain`, separated by `line` hairlines. Only floating layers (sheets, popovers, toasts) get shadow:
  `0 1px 2px rgb(28 36 48 / .06), 0 12px 32px -8px rgb(28 36 48 / .18)` (in dark: black at 40%).
- **Focus ring:** 2 px `slate` outline with 2 px offset, on every interactive element, always visible on keyboard focus.

---

## 5. Layout

### 5.1 Workspace (≥1280 px)
The shelf dominates; the agent narrates alongside it; the ask bar docks on top.
```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ProjectV    [ Ask for anything…                              🎙 ]   Maya ▾  ◐  ⛨ │  ← ask bar docked (64px)
├───────────────────────────────────────────────┬───────────────────────────────┤
│ Under $200 ✕  Noise cancelling ✕  Not Beats ✕ │ You                           │
│ Personalization ━━━━━●━━  [Show unpersonalized]│ "Headphones for flights…"     │
│ ┌───────────────────────────────────────────┐ │                               │
│ │ [ image plate ]   Sony WH-1000XM5         │ │ ProjectV                         │
│ │                   $179.99                 │ │ ✓ Understood your request 0.6s│
│ │                   Best Buy · 4.7 (2.1k)   │ │ ✓ Searched 2 stores     1.8s  │
│ │  ribbon ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬           │ │ ✓ Compared 41 → 12 options    │
│ │  ■ In your usual $150–220 range           │ │ ✓ Ranked for you              │
│ │  ■ Matches your Sony history              │ │                               │
│ │  [Compare] [Save]      [Review purchase]  │ │ "The XM5 is the strongest fit │
│ └───────────────────────────────────────────┘ │  for long flights…"           │
│ 2  ▢ Bose QC Ultra        ▬▬▬▬▬▬▬▬▬   $199.00 ↑2│                               │
│ 3  ▢ Sennheiser Mom. 4    ▬▬▬▬▬▬▬▬    $189.95  │ ┌ Suggested preference ─────┐ │
│ 4  ▢ Anker Q45            ▬▬▬▬▬▬▬     $ 89.99  │ │ Avoid Beats in the future?│ │
│ …                                              │ │ [Remember] [Not now]      │ │
│ ✦  A wildcard outside your usual taste         │ └───────────────────────────┘ │
│                                                │ [ Reply to ProjectV         🎙] │
└───────────────────────────────────────────────┴───────────────────────────────┘
      shelf: flexible, min 720px                       agent column: 380px
```
- Content is left-aligned throughout. Prices are right-aligned in rows so they form a scannable column.
- The top-right cluster holds the persona switcher (avatar + name), the theme toggle, and the trust indicator ⛨. The trust indicator opens the audit log.

### 5.2 Empty state (first load): the only centered layout
```
                    Good evening, Maya.
          [ What are you shopping for?                 🎙 ]

          Headphones for long flights under $200
          A carry-on that fits under a seat
          A gift for a runner, around $80

          Your taste  ■ Sony  ■ Muji  ■ Patagonia  ■ free returns
```
- The ask field is 64 px tall at `display` size placeholder weight 450.
- Example asks are written from the persona's profile and are real buttons.
- On first submit, the ask bar **docks** to the top (see §7.2) and the shelf builds beneath it.

### 5.3 Mobile (<768 px)
A single column: docked ask bar on top, then the shelf. The agent column becomes a bottom drawer peeking 56 px high, showing the latest trace line; swipe or tap to expand. The review sheet is full-screen. Ranked rows keep the ribbon; reasons move behind a "Why this?" tap.

### 5.4 Other screens
- **Taste** (`/taste`): the profile page (§6.9).
- **Orders** (`/orders`): the order list and timeline.
- Both screens use the same docked header and a single 760 px content column.

---

## 6. Components

Each component is a plain JS module that returns DOM elements. **Product and provider text is always set with `textContent`, never `innerHTML`** (see §9).

### 6.1 Ask bar
- A wide input on a `shelf` well with a 6 px radius and the mic button inside at the right.
- `/` or `⌘K` focuses it from anywhere.
- While the agent works, the input stays editable; submitting again cancels the in-flight request (`AbortController`).
- **Voice state:** the placeholder text is replaced by a live waveform (Web Audio `AnalyserNode` drawn on a `<canvas>` in `ink-2`), plus a "Listening" label and a stop button. The transcript lands in the field, editable, before sending.

### 6.2 Agent trace
- Lives in the agent column as a vertical list of steps in plain language, never tool names: *Understood your request*, *Searched 2 stores*, *Compared 41 → 12 options*, *Ranked for you*.
- Each step: a status glyph (pending ring → spinning arc → spruce check, or brick ✕), a label, and a right-aligned duration in `small` with tabular numbers.
- A step that used the fallback says so honestly: *Understood your request (backup parser)*.
- Collapsed to one summary line after completion: "Ranked 12 options in 3.1s". Click to expand.

### 6.3 Hero pick
- The #1 result on a `paper` surface with a 16 px radius, spanning the shelf width.
- Layout: image plate on the left (1:1, `shelf` background, image `object-contain` with 24 px padding); title, `price-hero`, merchant and rating, Score Ribbon, and up to 3 reasons on the right.
- Actions: `Compare` and `Save` as quiet text buttons; `Review purchase` as the only filled `ink` button on the page. It's disabled with a tooltip until F5 ships, and disabled for view-only products.
- If the price is on sale, the original price sits beside it in `ink-2` with a strikethrough, at `heading` size.

### 6.4 Ranked row
- 72 px tall, flat on `porcelain`, separated by `line` hairlines. Hover and focus raise it onto `shelf`.
- Columns: rank number (`micro`, `ink-2`; ranking is a real sequence, so numbering is honest) · 56 px thumbnail (10 px radius) · title plus merchant/rating in `small` · Score Ribbon (120 px) · price (right-aligned, `row-title` weight 700).
- **Rank delta:** after a rerank, a small `↑2` or `↓1` appears beside the price for 4 s. Moving up is orchid when caused by personalization, `ink-2` otherwise. It then fades out.
- Click or `Enter` opens the product detail popover; the whole row is one focusable element.

### 6.5 Score Ribbon ★
- A 6 px tall bar (8 px in the hero) with a 3 px radius on the outer ends and 2 px gaps between segments.
- Segment widths are the factor contributions from the server's `breakdown`, scaled so the full ribbon width equals score 1.0. The unfilled remainder is `line`.
- Order is fixed: relevance (slate), constraints (sage), quality (ochre), **you (orchid)**.
- On hover or focus, a popover shows the legend: each factor's name, contribution as a percentage, and one plain sentence ("You've clicked Sony 4 times this week").
- `role="img"` with an `aria-label` such as "Match 82%: relevance 34%, constraints 20%, quality 9%, you 19%."
- Width changes animate (§7.3). This is the component judges should remember.

### 6.6 Reasons
- Up to 3 short lines under the hero title (or in the row's "Why this?" popover). Each has an 8 px square swatch in its factor color, followed by `small` text.
- Written from the user's side, plainly: "In your usual $150–220 range", "Free returns, which you asked for", "Rated 4.7 by 2,100 buyers".
- **Never** rendered as a line of pills joined by dots.

### 6.7 Personalization controls
- **Strength slider:** a 160 px track in `line` with an orchid fill and an 18 px `paper` thumb with an orchid border. Labelled "Personalization"; the current value is shown as None / Light / Strong. Changes rerank live (debounced 150 ms).
- **Show unpersonalized:** a switch. While on, a thin orchid banner explains the view: "Showing results without your taste. 5 items changed position." Rows show their personalized rank as a ghost number to the left.
- **Persona switcher:** avatar plus name in the header. The menu lists the 3 demo personas, each with a one-line taste summary. Switching triggers the rerank moment.

### 6.8 Preference suggestion
- A card in the agent column with a 2 px orchid left border on `paper`. It shows the quoted evidence ("You said 'not Beats'"), the question ("Avoid Beats in future searches?"), and two buttons: `Remember` (orchid outline) and `Not now` (text).
- On Remember: the card collapses into a one-line confirmation "Beats will stay out of your results", and the Taste page updates.
- **Nothing is saved without this tap.**

### 6.9 Taste page
- A heading ("Your taste"), then sections: Brands, Stores, Categories, Price comfort, Priorities.
- **Brand affinity is a diverging bar chart:** a center axis, orchid bars to the right for affinity, `ink-2` bars to the left for aversion, sorted by magnitude. Each row has an `✕` to remove it.
- **Price comfort:** per category, a horizontal range showing the user's usual band as an orchid span on a `line` track, with the median marked.
- A **"What we use"** section in plain sentences lists the signal types and their retention, with `Export` and `Clear history` actions. Clear history asks for confirmation in a dialog that states exactly what gets deleted.

### 6.10 Review sheet (F5)
- Slides up from the bottom on mobile, and in from the right at 480 px width on desktop. `paper` surface, 24 px radius on the leading corners, and a scrim at `ink` 30%.
- Order of content: product and merchant host (with an `https` lock) → quantity → total in `display` size, with a line item breakdown → **security checklist** → primary action.
- **Security checklist:** five rows, each with a spruce check that draws in sequence as the server confirms it (60 ms stagger, only once per sheet):
  1. Price confirmed by ProjectV just now
  2. Within your $300 spending limit
  3. Merchant-locked, one-time payment
  4. You approve on a secure page ProjectV can't see
  5. The AI assistant cannot complete payment
- The primary button is `ink`, full width: **"Authorize purchase"**. The label stays the same through the flow; the toast says "Purchase authorized."
- A countdown ("Offer held for 9:42") in `small` tabular numerals sits under the button.

### 6.11 Receipt and order timeline
- The receipt replaces the sheet content in place: a spruce circle with a check that draws once (400 ms), then "Order confirmed", the order number (selectable, with a copy button), the total, and the merchant.
- The timeline is a vertical sequence of states with timestamps. Future states are hollow; simulated states carry a small "Simulated" tag in `ink-2`.

### 6.12 Feedback
- **Toasts:** bottom-center, `ink` background with `paper` text, one line, auto-dismiss after 4 s, with an action when undo is possible.
- **Skeletons:** rows and the hero pick render as `shelf` blocks in their exact final geometry with a slow 1.6 s opacity pulse. Nothing shifts when data lands.
- **Partial results:** an inline note above the shelf in `ink-2` with an ochre swatch: "One store didn't respond in time. Showing 14 results from Google Shopping."

---

## 7. Motion

**One orchestrated moment: the rerank.** Everything else is a direct response to the user's action and shows what changed. There are no entrance animations on page sections and no ambient motion.

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | Most transitions |
| `--ease-spring` | `cubic-bezier(.34, 1.3, .64, 1)` | Sheets, row settling |
| `--dur-fast` | 120 ms | Hover, press, focus |
| `--dur-base` | 220 ms | Popovers, toggles, ribbon width |
| `--dur-slow` | 420 ms | Rerank, sheet, ask-bar dock |

### 7.1 The rerank (FLIP)
When the order changes (persona switch, strength slider, unpersonalized toggle, a click that shifts affinity):
1. **First:** record each row's `getBoundingClientRect()` keyed by product id.
2. Apply the new order to the DOM (reuse existing row elements; never re-create them).
3. **Last/Invert/Play:** animate each row from its old offset to zero with the Web Animations API, `--dur-slow`, `--ease-spring`, staggered 18 ms by new rank.
4. At the same time, ribbon segments tween to their new widths (`--dur-base`), and rank deltas appear.
5. The hero pick crossfades its content if the #1 item changes (it does not move).

### 7.2 Ask-bar dock
On first submit, the centered ask field moves to the header position with a View Transition (`document.startViewTransition`, feature-detected; without support, it simply snaps).

### 7.3 Everything else
Hover lifts rows onto `shelf` (`--dur-fast`, color only, no transforms). Popovers fade and scale from 98% (`--dur-base`). Sheets slide (`--dur-slow`, spring). Trace glyphs rotate while pending. Checklist checks draw with `stroke-dashoffset`.

### 7.4 Reduced motion
Under `prefers-reduced-motion: reduce`: no FLIP, no spring, no stagger, no draw-ons. Changes apply instantly, and rank deltas stay visible for 6 s so change is still communicated. The waveform becomes a static level meter.

---

## 8. Voice and copy

- Write from the user's side, in plain verbs, sentence case, active voice. Describe what something does, not how it's built: "Searched 2 stores", never "Called search_products".
- **An action keeps its name through the whole flow:** Review purchase → Authorize purchase → "Purchase authorized."
- The agent speaks in 3 sentences or fewer, recommends one thing, and says why. It never uses exclamation marks, filler ("Great question"), or emoji.
- **Errors say what happened and what to do, without apologizing:** "The price changed from $179.99 to $189.99. Review the new price to continue."
- **Empty states invite action:** "No results under $50 that match. Raise the budget to $80 to see 9 options."

---

## 9. Implementation (vanilla HTML + Tailwind v4 + JS)

**Setup:** Vite (vanilla template) + Tailwind v4 via `@tailwindcss/vite`. Before writing config, confirm current syntax in the [Tailwind v4 docs](https://tailwindcss.com/docs).

```css
/* src/styles.css */
@import "tailwindcss";
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
  --font-sans: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif;
  --color-porcelain: #EEF1EC;  --color-paper: #F8FAF6;  --color-shelf: #E3E8E1;
  --color-ink: #1C2430;        --color-ink-2: #4A5563;
  --color-orchid: #9E2F86;     --color-spruce: #1D6552;  --color-slate: #46618C;
  --color-ochre: #8C6212;      --color-sage: #5E7D63;    --color-brick: #A63A28;
  --radius-control: 6px; --radius-thumb: 10px; --radius-panel: 16px; --radius-sheet: 24px;
  --ease-out: cubic-bezier(.2,.8,.2,1); --ease-spring: cubic-bezier(.34,1.3,.64,1);
}
[data-theme="dark"] {
  --color-porcelain: #151A21; --color-paper: #232B35; --color-shelf: #1D242D;
  --color-ink: #E8ECE6; --color-ink-2: #A4AEB9;
  --color-orchid: #E27BCB; --color-spruce: #5FC2A4; --color-slate: #8FA8D6;
  --color-ochre: #E0B456; --color-sage: #9DBBA1; --color-brick: #F08A76;
}
```
- The theme defaults to `prefers-color-scheme`; the toggle sets `data-theme` on `<html>` and saves the choice in `localStorage`.
- `line` is not a separate color: use `border-ink/10` (dark: `border-ink/12`).

**Structure**
```
index.html            one page; <main> regions for shelf, agent column, sheet root, toast root
src/main.js           boot, router (hash-based: #/, #/taste, #/orders)
src/state.js          tiny store: get(), set(patch), subscribe(key, fn)
src/dom.js            h(tag, attrs, ...children)  — creates elements; text via textContent only
src/api.js            fetch wrapper: JWT, AbortController, error envelope → toast
src/components/       askBar.js, trace.js, heroPick.js, row.js, ribbon.js, reasons.js,
                      personaSwitch.js, strength.js, suggestion.js, reviewSheet.js, receipt.js,
                      timeline.js, toast.js, popover.js, skeleton.js
src/motion/flip.js    FLIP rerank helper (Web Animations API)
src/pages/            workspace.js, taste.js, orders.js
```

**Rules**
- **Security:** never pass provider or LLM text into `innerHTML` or template strings that become HTML. Use `h()` / `textContent`. Images must be `https` URLs, loaded with `loading="lazy"`, `decoding="async"`, explicit `width`/`height`, and an `onerror` fallback to a `shelf` plate with the product's initial.
- **Rendering:** keyed updates by product id. Rerender only what changed; rows are reused so FLIP works and focus is preserved.
- **Icons:** [Lucide](https://lucide.dev) as inline SVG, 16/20 px, 1.75 stroke, `currentColor`. Icon-only buttons get `aria-label`.
- **Fonts:** preconnect to Google Fonts; `font-display: swap`; preload the variable font file.
- **Performance budget:** JS under 60 KB gzipped (excluding the Supabase client). No layout shift on data arrival. Target Lighthouse performance ≥ 90.

---

## 10. Accessibility (native, before UserWay)

- Landmarks: `header`, `main`, `aside` (agent column), `dialog` (sheet). A skip link goes to the shelf.
- The shelf is a list (`ol`, since it is ranked). Each row is one focusable button; arrow keys move between rows; `Enter` opens details.
- The trace region is `aria-live="polite"`. Rerank announces in a visually hidden live region: "Results re-ranked. Bose QC Ultra moved to 2."
- The sheet uses `<dialog>` with `showModal()`, traps focus, closes on `Esc`, and returns focus to the button that opened it.
- Touch targets are ≥ 44 px. Text zooms to 200% without horizontal scroll.
- The UserWay widget loads last and must not cover the ask bar or the review sheet's primary button. Position it bottom-left.

---

## 11. Never do this

- All-caps labels, eyebrow text over headings, or `→` appended to buttons.
- Meta strings chained with middle dots, or reasons shown as a pill row.
- Monospace fonts for numbers or labels (use tabular numerals).
- Gradient backgrounds, glassmorphism, blur panels, glow effects.
- Identical cards in a uniform grid for results. The shelf is a ranked list with one hero.
- Orchid used for anything that isn't personalization; spruce for anything that isn't trust.
- Entrance animations on sections, parallax, confetti, emoji in UI or agent copy.
- A spinner where a skeleton or trace step could show real progress.
- `innerHTML` with any external text.

---

## 12. Review checklist (before any UI merge)

1. Light and dark at 1440 px and 390 px; nothing overflows, nothing shifts when data arrives.
2. The rerank moment works: persona switch, slider, and unpersonalized toggle all animate, and deltas show.
3. Every state is designed: loading, empty, partial, error, view-only product, reduced motion.
4. Keyboard only: ask → rows → details → review sheet → authorize → receipt.
5. axe shows 0 critical/serious issues; focus is visible everywhere.
6. Orchid appears only where personalization is the cause.
7. Remove one accessory: if an element doesn't explain, direct, or confirm something, cut it.