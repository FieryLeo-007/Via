# Integration notes

Facts recorded here must be confirmed against a live spec or a real call (CLAUDE.md §2 rule 1) before code relies on them. Each entry says which.

## OpenWeb Ninja — Real-Time Product Search v2

**Spec-verified 2026-09-27:** official [machine-readable reference](https://www.openwebninja.com/api/real-time-product-search/llms.txt)
and [OpenAPI schema](https://openwebninja.s3.us-east-1.amazonaws.com/portal/openapi/realtime_product_search-v2.yaml).

- API base: `https://api.openwebninja.com/realtime-product-search/v2`.
- Auth: `x-api-key`, loaded server-side from `OPENWEBNINJA_API_KEY`. The key must
  have access to the Real-Time Product Search subscription.
- Live discovery calls `/search` once (Google Shopping across retailers), with
  `q`, `country=us`, `language=en`, `page=1`, `limit=40`, and documented sort,
  condition and optional USD price filters. The former seven E-commerce Data
  marketplace searches are no longer called.
- Explicit colors/colorways remain in the intent query. Separately supplied
  `color` and `must_have` attributes are appended without case-insensitive phrase
  duplicates. The final query is also used in search cache keys.
- Search response: `status=OK`, `data.products`; listings include `product_id`,
  `product_title`, `price`, `store_name`, `product_photos`, `product_rating`,
  `product_num_reviews`, `shipping`, `on_sale`, and optional `original_price`.
  Product IDs are opaque strings and may contain comma-separated identifiers.
- `/product-offers` accepts the unchanged `product_id`, country, language and
  `page=1`; offers are returned in `data.offers`. Up to 12 promising listings
  are resolved concurrently. Offer price, title, store, condition and full retailer
  URL are applied together and constraints are rechecked before ranking.
- Google URLs and unresolved listings are omitted; retailer URLs retain their
  full paths and query strings. Legacy normalizers remain for recorded formats.
- Search and offer caches are isolated by the v2 API base and provider identity
  (`product-search:google-shopping`), with a six-hour TTL. Offline fixtures remain
  available. Existing saved product snapshots are historical data.
- **Live-confirmed 2026-09-27:** authenticated search for `Sony headphones blue`
  returned 40 listings in 3.69 seconds, all normalizable. A v2 offer lookup for
  the first product returned three offers in 2.72 seconds and resolved a direct
  retailer product link. The configured key has access to this subscription.
- Regression coverage includes the public intent/search flow, documented flat
  listings and offer responses, exact v2 request parameters, color query/cache
  separation, malformed data, timeouts, budget rechecks and retailer URLs.

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
