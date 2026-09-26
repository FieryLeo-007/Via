# Build a polished website with Codex

This is the Codex-native version of the workflow in the supplied Claude Code guide. The principle is the same: give the coding agent strong project context, reuse trustworthy UI patterns, and ask for a complete implementation plus verification.

## 1. Start with Codex and let it inspect the real stack

Open the project in Codex, then begin with a concrete outcome instead of assuming a framework:

> Inspect this repository and identify its framework, styling system, component conventions, build commands, and tests. Preserve the existing visual language and tell me which files you will change.

Codex can work from the desktop app, IDE, CLI, or cloud workflows. See the official [Codex overview](https://developers.openai.com/learn/codex) for the current setup options.

## 2. Add motion that fits the project

Choose an animation library only after the stack is known:

- React projects: Motion/Framer Motion is a natural component-level option.
- Framework-neutral pages: GSAP and ScrollTrigger work well for timelines and scroll-linked scenes.
- Small interactions: CSS transitions are often enough.

For GSAP, install it with `npm install gsap`, register ScrollTrigger in the page bundle, and respect `prefers-reduced-motion`. The official [ScrollTrigger documentation](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) covers scrubbed, scroll-linked animation.

## 3. Give Codex reusable design guidance

Put repository-wide conventions in `AGENTS.md`: design tokens, file boundaries, test commands, accessibility requirements, and routes that must remain untouched. For a repeatable workflow, invoke the built-in `$skill-creator` and ask Codex to make a focused design or QA skill. OpenAI's [skills guide](https://developers.openai.com/plugins/build/skills) explains the current structure.

You can also add the official OpenAI Developers plugin from `/plugins`, or connect the OpenAI developer documentation MCP server:

```bash
codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp
codex mcp list
```

See [OpenAI Developers for Codex](https://developers.openai.com/learn/developers-codex-plugin) and the [Docs MCP guide](https://developers.openai.com/learn/docs-mcp).

## 4. Use component galleries as references, not assumptions

Find a suitable pattern on [21st.dev](https://21st.dev/) or [Uiverse](https://uiverse.io/), then give Codex the component, screenshot, or URL and ask it to adapt the idea to the repository's actual stack and tokens. Verify the component's license and dependencies before copying it.

For this ProjectV repository, the correct adaptation is Flask templates plus scoped CSS and bundled vanilla JavaScript—not a new React, Tailwind, or shadcn layer. The supplied container-scroll example was therefore translated into a GSAP ScrollTrigger scene while keeping Dashboard files read-only.

### If you intentionally want a separate React/shadcn frontend

Do this as a planned migration or a separate frontend directory, not as part of a one-page styling change:

```bash
npx shadcn@latest init -t vite
npm install framer-motion gsap
npx shadcn@latest add button card badge
```

Choose the React + TypeScript Vite template when prompted. The generated project configures Tailwind and the `@/*` import alias; keep reusable UI in `src/components/ui` (or `/components/ui` when the alias maps to the project root). That predictable path matters because copied components commonly import from `@/components/ui/...`. Follow the official [shadcn Vite setup](https://ui.shadcn.com/docs/installation/vite) if integrating into an existing app, since it includes the current Tailwind and TypeScript alias steps.

## Starter prompt

> Build a premium, responsive discovery page for this repository. First inspect the existing Dashboard and reuse its visual tokens without modifying Dashboard or shared primitives. Use a 21st.dev-style scroll presentation, GSAP for purposeful entrance and hover motion, Uiverse-inspired micro-interactions, outlined cards, and draggable product carousels. Scope every new style and behavior to `/discover`, honor reduced-motion preferences, run the existing build and test suite, and report exactly which files changed.

## Common mistakes to avoid

- Do not force React, shadcn, or Tailwind into a project that uses another architecture just to paste one component.
- Do not change global tokens to style one route; use page-local wrappers and variants.
- Do not stack many unrelated animation styles. One entrance language, one hover language, and one scroll scene are usually enough.
- Do not skip keyboard, focus, reduced-motion, mobile, build, or route checks.
- Do not copy gallery code without checking its dependency list and license.
