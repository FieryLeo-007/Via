# Integration notes

Facts recorded here must be confirmed against a live spec or a real call (CLAUDE.md §2 rule 1) before code relies on them. Each entry says which.

## OpenWeb Ninja — Real-Time Product Search v2

**Confirmed:** 2026-09-26, via `llms.txt` and the OpenAPI spec (spec-confirmed, no live call made yet).

- Base URL: `https://api.openwebninja.com/realtime-product-search/v2`
- Auth: header `x-api-key`
- `GET /search` — params: `q` (required), `country` (default `us`), `language` (default `en`), `page` (default 1, max 100), `limit` (default 40, max 120), `sort_by` (`BEST_MATCH|TOP_RATED|LOWEST_PRICE|HIGHEST_PRICE`), `min_price`, `max_price`, `product_condition` (`ANY|NEW|USED|REFURBISHED`), `stores` (comma-delimited), `free_returns`, `free_shipping`, `on_sale` (booleans), `return_filters`.
  - Response: `{status, request_id, data: {filters[], products: [{product_id, product_title, price, original_price, product_page_url, on_sale, discount_percent, product_photos[], store_name, has_multiple_offers, product_rating, product_num_reviews, shipping}], sponsored_products[]}}`.
  - `price`/`original_price` are strings like `"$42.99"`, not numbers — must be parsed to cents.
  - `product_page_url` is a `google.com` redirect URL, **not** the merchant. It is never used as `merchant_url`.
- `GET /product-offers` — params: `product_id` (required), `page` (default 1, 10 stores/page), `country`, `language`.
  - Response: `{status, request_id, data: {offers: [{offer_id, offer_title, offer_page_url, price, shipping, offer_badge, on_sale, original_price, percent_off, product_condition, store_name, store_rating, store_review_count, store_reviews_page_url, store_favicon, coupon_discount_percent, payment_methods}], product_rating, product_num_reviews, product_num_offers, videos[], top_insights[], discussions_and_forums[]}}`.
  - `offers[].offer_page_url` is the real merchant URL — this is what `merchant_url` is derived from (https origin only).
- Not yet used by F1 but documented for later: `/product-details`, `/product-price-history-v2`, `/product-reviews`, `/deals`, `/store-reviews`.
- No documented rate-limit headers or error envelope in the spec content that was fetched — treat any non-200 as a provider failure for the pipeline's per-provider timeout/error handling, and confirm the actual error shape the first time a live call is made.
- **Not yet live-confirmed:** no real request has been made against this API in this repo. `DATA_MODE=fixtures` is the default until a live call is explicitly requested and this section is updated with the real observed response.

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
- **Not yet live-confirmed:** no real call has been made against this API in this repo yet.
