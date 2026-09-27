# Voice Mode

The mic button in the dashboard composer opens **Voice Mode**: a full-screen conversation with **V**, an ElevenLabs agent. V handles product discovery, comparison, the cart, demo checkout (or a real Crossmint checkout, confirmed on screen) and order tracking. The green orb reacts to both voices: it deforms with the shopper's microphone while listening and with V's output while speaking.

## Setup

1. Put `ELEVENLABS_API_KEY` in `.env`.
2. Run `make voice-agent`. This creates or updates the client tools and the agent from `voice/agent/` and prints `ELEVENLABS_AGENT_ID=…`.
3. Add that line to `.env` and restart Flask. Re-run `make voice-agent` after editing the prompt, the tools or the agent settings. It upserts tools by name and patches the agent in place.

Optional overrides: `ELEVENLABS_VOICE_ID` and `ELEVENLABS_LLM` change the voice and model without editing `agent.json`. Use `python -m voice.sync_agent --dry-run` to print the payloads without calling ElevenLabs.

The agent has `platform_settings.auth.enable_auth` turned on. Browsers can't start a session on their own. `GET /api/voice/session` checks the Supabase user and mints a short-lived WebRTC conversation token with the server-side key. The key never reaches the browser.

## How it works

| Piece | Where |
|---|---|
| Prompt, tools, agent settings (config as code) | `voice/agent/prompt.md`, `tools.json`, `agent.json` |
| Sync to ElevenLabs | `voice/sync_agent.py` |
| Session token endpoint | `voice/routes.py`, `voice/service.py` |
| Client tool handlers (search, compare, cart, quote, demo order, real checkout, orders) | `static/scripts/voice-mode/tools.mjs` |
| Conversation lifecycle, orb states, audio levels | `static/scripts/voice-mode/session.mjs` |
| Full-screen stage, captions, cards | `static/scripts/voice-mode/overlay.js`, `templates/partials/voice-mode.html`, `static/styles/voice-mode.css` |
| Bundle entry (`voice-mode.bundle.js`, loaded on demand) | `static/scripts/voice-mode/index.js` |

Every tool is a **client tool**. It runs in the page with the shopper's session, reuses the existing `/api/search`, `/api/picks`, `/api/compare` and `/api/commerce/*` endpoints and the local cart, and updates the stage right away. ElevenLabs therefore never needs a public webhook URL or the user's JWT.

- **Search** builds the `ShoppingIntent` directly from the agent's tool arguments, which skips the `/api/intent` LLM hop. It answers as soon as ranked results exist. Top picks load afterwards: they add badges without renumbering the cards and brief the agent with a contextual update.
- **Money safety.**
  - A demo order needs a quote from `get_checkout_quote`. That quote expires after 15 minutes and is bound to the exact cart contents.
  - Replaying the same quote returns the same order.
  - The prompt requires a spoken "yes".
  - A real checkout also needs an on-screen **Confirm** tap. Card approval then happens on the existing `/checkout/<id>` page.
- **Untrusted text.** Product titles and other listing text reach the LLM truncated and labelled as data.
- **Continuity.** Voice searches are saved as a chat titled "Voice · …". When Voice Mode closes, that chat opens in the dashboard thread.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 .venv/bin/pytest -q tests/test_voice.py
node --test tests/voice-tools.test.mjs tests/voice-session.test.mjs tests/voice-orb.test.cjs
# Optional browser checks against a running server (Playwright + installed Chrome):
PROJECTV_PLAYWRIGHT_PATH=/path/to/playwright-core PROJECTV_TEST_URL=http://127.0.0.1:5000 \
  node --test tests/voice-mode.browser.cjs tests/voice-orb.browser.cjs
```

`tests/voice-mode.browser.cjs` scripts the conversation through `window.ProjectVVoiceTestConversation`. Production always uses the ElevenLabs SDK.
