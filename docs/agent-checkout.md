# Crossmint agent checkout

## Demo experience

Wallet opens with a demo card and a guided preview at `/checkout/demo`. Real payment cards remain available in the **Real payment cards** wallet tab. The cart and per-item checkout dialog also link to the demo with the current selection.

The demo simulates checkout in the browser without Crossmint configuration, scopes or admin access. Completed demos are saved through the authenticated `/api/commerce/demo-orders` endpoint to `checkout_orders` with `is_demo = true`. It uses the existing app sign-in gate. A sample product is provided when opened from Wallet or when the cart has no eligible products. Prices use a clearly labelled sample 8% tax rate and free standard or $12.95 express shipping. Users set a spending limit, watch simulated agent activity, approve the exact demo total, and download a labelled text receipt. Cancelling stops the simulation; retry starts fresh. Session storage preserves the current walkthrough across reloads in the same tab, and the flow still works if storage is unavailable.

The server validates product snapshots, computes demo tax/shipping totals, and checks the approved spending cap. A stable UUID makes save retries idempotent; retries never revive a cancelled or refunded order. Save failures remain visible with a retry button. The Orders page shows all basket items and a Demo badge, with Demo/Refunded filters. Cancel demo order and Refund demo order persist terminal states and a timestamped simulated service request. Atomic owner-and-status predicates prevent concurrent actions from overwriting one another. Demo totals are excluded from real spending.

Demo actions never invoke Crossmint, authorize a payment, or create a merchant order. A successful saved demo checkout from the cart (including voice checkout) removes the purchased quantities and updates the cart badge once per order. Other products and quantities added during checkout remain. Cancelled demos, failed saves, and Wallet sample walkthroughs do not remove cart items. The receipt and all checkout stages remain explicitly labelled as simulations. Real purchases continue through the existing Crossmint flow. The `demo_order_history` migration was applied to the connected project; `supabase/tests/demo_orders.sql` verifies owner-only visibility, denial of direct client writes, the live-provider boundary, and independent refunds for repeated demo baskets in a rolled-back transaction.

## Live checkout

Cart → review per-product USD spending limits → agent checkout → delivery/options → approve a scoped card authorization → Orders.

Each cart product starts a separate Crossmint run. The agent chooses standard shipping and asks for missing delivery details or variants. Spending caps include tax, shipping and fees. The cart is reduced only after the provider confirms a purchase. Orders persist in Supabase and can be resumed on another device.

## Environment and Crossmint console

Configure these in `.env`, never in frontend code:

```dotenv
SUPABASE_SECRET_KEY=your-server-secret-key
CROSSMINT_SERVER_API_KEY=sk_production_...
CROSSMINT_CLIENT_API_KEY=ck_production_...
```

`SUPABASE_SERVICE_ROLE_KEY` also works. Existing `CROSSMINT_SERVER_SIDE`, `CROSSMINT_CLIENT_SIDE`, and the existing misspelling `CORSSMINT_CLIENT_SIDE` are supported. Canonical variables take precedence. Restart the Flask process after rotating existing keys.

Agent Checkouts is **production-only**. Staging keys are rejected before card collection or starting a checkout. Server and client keys must belong to the same production project.

In the Crossmint console:

1. Configure Supabase under Settings → JWT Authentication using the Supabase project URL/issuer. Keep the JWT `sub` as the stable buyer identifier. The backend uses the verified Supabase user ID in `x-crossmint-user-id`.
2. Allow the actual application origin on the production client key. Use HTTPS in deployment and an HTTPS tunnel for local card-network verification.
3. Server key scopes: `agent-checkouts.create`, `agent-checkouts.read`, `agent-checkouts.update`, `agent-checkouts.cancel`.
4. Client key scopes: `payment-methods.create`, `payment-methods.read`, `payment-methods.update`, `payment-methods.delete`, `order-intents.create`, `order-intents.read`, and `protected-inputs.create`.
5. If cards have no supported card-network rail, ask Crossmint to enable encrypted-card access in production. The UI reports unavailable rails rather than pretending authorization succeeded.

The public configuration endpoint sends only the production **client** key, readiness status and missing setting names. Secrets stay server-side. The official SDK embeds Crossmint's hosted card/CVC/password forms. ProjectV never collects PAN, CVC, merchant passwords or card-network credentials. Saved cards remain in Crossmint, tied to the user's JWT; ProjectV stores no card source tokens or payment credentials. The selected payment method ID exists only in the checkout component until it creates an expiring order intent.

## Persistence and recovery

Apply the checked-in `agent_checkout_orders` and `checkout_duplicate_guard` Supabase migrations. They were applied to the connected project during implementation.

`checkout_orders` has RLS enabled. Authenticated users can read only their own rows; only the server role writes. All server database calls independently filter the verified user ID. Order amounts and statuses cannot be forged through the browser's Supabase credentials.

A reservation is saved before starting a provider run. The client reuses its request ID on retries, and a partial unique index prevents concurrent identical active requests across devices. No automatic retry is made for an ambiguous create request. A stable order reference in the provider's task allows later read-only reconciliation if the create response was lost. If confirmation remains unknown, the user must check the merchant/provider before starting again.

Status synchronization uses provider revisions to prevent older reads overwriting newer state. Polling resumes when the user opens Orders or a checkout; Crossmint continues running independently of the page. The database holds safe result/receipt metadata, not shipping form responses, JWTs, protected-input IDs, browser-session URLs or payment intent IDs. Message history is read from Crossmint for the authenticated owner.

## Cancellation and refunds

`Cancel checkout` calls the documented Crossmint cancel-run endpoint. A `202` response means the request was accepted; the UI waits for a confirmed `cancelled` status. Cancelling an agent does **not** reverse a purchase already placed.

For a confirmed purchase, `Request cancellation` and `Request refund` save a `needs_merchant_action` request and show a merchant link and merchant order reference. **The user must submit the request to the merchant.** These buttons do not send a refund/cancellation to the merchant and never mark money refunded. Crossmint's documented Agent Checkouts API provides no merchant refund endpoint. Do not substitute an NFT/token Checkout refund API for a physical merchant purchase.

The UI says Purchased when Crossmint succeeds; it does not infer shipment or delivery. When no merchant receipt total is captured, the spending cap is explicitly labelled as a cap, not a paid amount.

## Verification

Run:

```sh
.venv/bin/pip install -r requirements.txt
npm ci
npm run build
PYTHONDONTWRITEBYTECODE=1 .venv/bin/pytest -q
node --test tests/*.test.mjs tests/*.test.cjs
```

`supabase/tests/checkout_orders.sql` verifies owner visibility, cross-account isolation, anonymous denial, and denial of client INSERT/UPDATE/DELETE, inside a rolled-back transaction. It requires two existing accounts. Execute it with the SQL editor or Supabase CLI/MCP. It was executed successfully on the connected database.

No Playwright tests were used. Read-only live probes of the production Crossmint list endpoint and Supabase order table both returned HTTP 200. The hosted Wallet card form was visually checked in the signed-in Chrome session. Live provider-linked orders and a confirmed cancellation were observed after the user's interaction. No paid purchase, card authorization or merchant refund was executed by the coding agent.

Crossmint SDK 4.8.0 imports an optional Node crypto fallback; the browser build externalizes `crypto` and uses browser Web Crypto. Its unused MetaMask import emits an upstream esbuild empty-glob warning. The emitted checkout bundle is approximately 397 KB minified.

`npm audit` currently reports 77 transitive advisories (30 high) in the latest SDK's dependency graph. A compatible `npm audit fix` did not eliminate them; the suggested forced SDK downgrade would remove the required components and was not applied. An esbuild metafile check found zero emitted bytes from packages with direct advisories in this checkout bundle. This is a build-scope observation, not a guarantee of SDK security. Review upstream SDK updates before deployment.

Separate existing security finding: `public.chats` has RLS disabled. This feature does not change it; review and enable the intended ownership policies independently.

## Provider references

- https://docs.crossmint.com/agents/agent-checkouts-quickstart
- https://docs.crossmint.com/agents/payment-flows/agent-checkouts-payment-method
- https://docs.crossmint.com/agents/payment-methods/cards/save-card
- https://docs.crossmint.com/agents/payment-methods/cards/register-card
- https://docs.crossmint.com/agents/payment-methods/cards/create-agent-card
- https://docs.crossmint.com/agents/payment-methods/cards/recollect-cvc
- https://docs.crossmint.com/agents/payment-flows/agent-checkouts-browser-profiles
- https://docs.crossmint.com/wallets/guides/bring-your-own-auth
