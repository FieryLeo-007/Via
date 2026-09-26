# Integration notes

Facts recorded here must be confirmed against a live spec or a real call (CLAUDE.md §2 rule 1) before code relies on them. Each entry says which.

## OpenWeb Ninja — Real-Time E-commerce Data

**Verified 2026-09-26:** official [machine-readable reference](https://www.openwebninja.com/api/real-time-e-commerce-data/llms.txt),
[OpenAPI schema](https://openwebninja.s3.us-east-1.amazonaws.com/portal/openapi/realtime_ecommerce_data.yaml), and authenticated live requests.

- Only API base used: `https://api.openwebninja.com/realtime-ecommerce-data`.
- Auth remains `x-api-key`, loaded server-side from `OPENWEBNINJA_API_KEY`.
- Search endpoints: `/amazon/search`, `/walmart/search`, `/ebay/search`,
  `/costco/search`, `/wayfair/search`, `/home-depot/search`, `/google-shopping/search`.
- Google uses `q`; the others use `query`. Sort, country, condition, pagination,
  and price filter names are mapped separately to each endpoint's documented contract.
- All seven returned HTTP 200 / status `OK` / `data.products` in individual live checks.
  Candidate counts: Amazon 16, Walmart 40, eBay 60, Costco 24, Wayfair 48,
  Home Depot 24, Google Shopping 20 (the diagnostic requested 20).
- Amazon uses dollar strings and `product_*` fields; Walmart/eBay use numeric
  prices; Wayfair/Home Depot nest prices under `pricing`; Costco uses `item_*`
  fields. Non-USD, missing/invalid prices, installment prices, and explicitly
  unavailable products are excluded. Ratings remain product ratings, not seller ratings.
- Google documentation includes a nested `offer`, but the live search returned
  flat price/store fields without retailer URLs. Both formats are supported.
- `/google-shopping/product-offers` is part of this same E-commerce API. A live
  request returned three offers including the full Best Buy product path, SKU and
  query string. URLs are never truncated to the store origin. An offer's price,
  title, store and condition are applied together and re-filtered before ranking.
- Costco search/detail samples do not provide a product URL. No URL is invented;
  cards without a URL show a clear unavailable-link message.
- Search caches are isolated by API base, marketplace and mode; offers have their
  own cache keys. Existing cache TTL is six hours. Offline fixtures remain available.
- Combined live Flask test: HTTP 200, 10 ranked products under $200 in 21.68 seconds,
  with direct Macy's, Best Buy, Target, LP Tunes, Amazon and Walmart product links.
  Home Depot timed out in that run; the other six sources completed and the result
  correctly reported `partial=true`.

## OpenAI — Responses API

**Confirmed:** 2026-09-26, via `developers.openai.com/api/docs` (guides: function-calling, structured-outputs; quickstart) — spec-confirmed.

- SDK: `pip install openai`; `from openai import OpenAI; client = OpenAI()` — reads `OPENAI_API_KEY` from the environment automatically.
- Model id comes from `OPENAI_MODEL` env var (not hardcoded). Default in this repo: `gpt-5.6-terra` (balances intelligence/cost for a structured-extraction task). `gpt-5.6-luna` is the cheaper option if cost needs to come down further; avoid `gpt-6-astra` for `extract_intent` — it's the most capable/most expensive tier and this is a small structured-extraction call, not an "end-to-end hardest work" task.
- Structured output (used for `extract_intent`, no tool-calling round trip needed): 
  ```python
  client.responses.create(
      model=os.environ["OPENAI_MODEL"],
      input=[{"role": "system", "content": ...}, {"role": "user", "content": ...}],
      text={"format": {"type": "json_schema", "name": "shopping_intent", "strict": True, "schema": {...}}},
  )
  ```
  Result is read from `response.output_text` (a JSON string) and validated against the pydantic model.
- Strict-mode schema rules (mandatory or the API rejects the request): `additionalProperties: false` on every object, every property listed in `required` (optional fields are modeled as `["type", "null"]` unions, not omitted from `required`).
- Tool/function calling (not used by F1's `extract_intent`, but documented for the shared agent layer later): `tools: [{type: "function", name, description, parameters, strict: true}]`, `tool_choice`, and the model's tool call comes back as `{"type": "function_call", "call_id", "name", "arguments"}` (arguments is a JSON string).
- **Live-confirmed:** the configured account supports `gpt-5.6-terra`. Responses structured output validated as ShoppingIntent, including a $200 budget and excluded Beats brand. The local OpenAI SDK is installed; calls have a 20-second timeout with no automatic retries and log a safe failure type before heuristic fallback.

## Account chat history and Saved

The dashboard uses the existing verified Supabase auth client (`auth.js`) through
`account-store.mjs`. Only the public browser key is used; RLS enforces ownership.
The migration `20260926205356_chat_history_and_saved_products.sql` is applied to
the configured project.

- `chats`: one user-owned conversation, shown in Recent.
- `chat_turns`: each query, parsed intent, status, and full ranked product snapshots
  in the `products` JSONB array. The composite chat/owner foreign key prevents
  attaching a turn to another user's chat. Deleting a chat cascades its turns
  and product snapshots.
- `saved_products`: independent product snapshots keyed by user and product ID.
  No chat foreign key: favorites remain after chat deletion. Unsave deletes only
  the favorite copy. `/saved` supports searching and reuses the dashboard cards.

Queries persist before searching. Results persist before display; a failed result
write offers an explicit retry. Interrupted queries remain in history with a
message on reopening. The old mock Recent/Saved entries are removed; earlier
browser-only conversations were never persisted and cannot be recovered after reload.

Verification: `node --test tests/*.test.mjs tests/auth.test.cjs`, `python -m pytest -q`,
and `npm run build`. `supabase/tests/chat_persistence.sql` runs isolated rollback-only
fixtures against Postgres to verify ownership, cross-user denial, anonymous grants,
product retention, cascading deletion, and independent favorites.

Existing project advisory (outside this migration): `onboarding_preferences` has
RLS policies but RLS is disabled. Review the existing ownership policies before
running `ALTER TABLE public.onboarding_preferences ENABLE ROW LEVEL SECURITY;`.
