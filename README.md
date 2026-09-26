# ProjectV
Agentic E-Commerce Application for HackGT 2026

## Run locally

1. Install dependencies: `pip install -r requirements.txt` and `npm install`.
   The interactive search orb uses Motion and is bundled for the browser with
   `npm run build`. Run `npm run watch:js` while editing `static/scripts/app.js`.
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY` from your Supabase project's API settings.
   The legacy anon key also works. Never use a service-role or secret key;
   these settings are intentionally sent to the browser.
3. Run `supabase/migrations/202609260001_users.sql` in the Supabase SQL editor.
   It supports an existing `public.users` table with the specified columns,
   creates missing profiles for existing accounts, enables row-level security,
   and installs a trigger that inserts each new Auth user into `public.users`.
   Signup and profile creation are atomic. Review any existing table policies separately.
   Then run `supabase/migrations/202609260003_onboarding_preferences.sql` to create
   the onboarding preference table and authenticated-user RLS policies.
4. Under Supabase Authentication → URL Configuration, set the local Site URL
   to `http://localhost:5000` and allow `http://localhost:5000/home.html` as a
   redirect URL. Add your production origin and `/home.html` URL on deployment.
   Enable the Email provider and turn off **Confirm email** under Authentication
   → Sign In / Providers → Email. Signup is configured for immediate login.
5. Start with `python app.py` and open `http://localhost:5000/home.html`.

`/` opens the login/signup page. Successful login redirects to `/index.html`;
successful signup redirects to `/onboarding`, then to `/index.html` after the
preferences are saved. The app does not send email-confirmation redirect options or
display an inbox-confirmation flow. Sign out returns to `/home.html`.

The Supabase browser SDK persists and refreshes sessions. The index has a browser session guard; Flask endpoints that
serve private data must independently verify access tokens. Database access
is protected by Supabase RLS, not by hiding the page.

## Verify authentication

- Create an account with a full name, email, and password of at least 8 characters.
- Confirm `auth.users` and `public.users` have matching IDs, and that the profile
  contains `full_name`, `email`, and `created_at`.
- Check that signup immediately redirects to `/onboarding` without an email step.
- Complete onboarding and confirm multiple rows are written with the signed-in
  user ID, then confirm a repeat visit redirects to `/index.html`.
- Sign out, try an incorrect password, then log in successfully and refresh.
- Open `/index.html` while signed out and verify the redirect to `/home.html`.
- Verify another authenticated account cannot read the first account's profile.

Profile creation follows the [Supabase user management trigger pattern](https://supabase.com/docs/guides/auth/managing-user-data).

## Existing trigger points at a missing profiles table

If signup fails with `42P01: relation "public.profiles" does not exist`, run
`supabase/migrations/202609260002_repair_profile_trigger.sql` in the SQL editor.
It removes only row-level AFTER INSERT signup triggers whose function explicitly
inserts into the missing `public.profiles` table, and installs the ProjectV
writer for `public.users`. User rows and unrelated triggers are preserved.
The final query lists remaining triggers for review. This SQL requires project
SQL-editor access; the browser's public key cannot apply it.

## Live product discovery

Set `OPENAI_API_KEY` and `OPENWEBNINJA_API_KEY` in `.env` (server-side only).
`OPENAI_MODEL` defaults to `gpt-5.6-terra`; `DATA_MODE` defaults to `live`.
Restart Flask after changing these settings and run `npm run build` after JS edits.

The search box calls `/api/intent` to turn natural language into a structured query
with OpenAI, then `/api/search` to fetch up to 40 candidates from OpenWeb Ninja's
[Real-Time Product Search v2 API](https://www.openwebninja.com/api/real-time-product-search/docs).
The pipeline deduplicates, filters constraints, ranks by relevance/quality/preferences
in the query, and returns up to **10** products. Cards show images, prices, stores,
ratings, recommendation reasons, and product links. Links currently open Google
Shopping product pages supplied by the API. Amazon and E-commerce endpoints are
not required for this cross-store search and are not called.

Successful provider responses are cached for six hours. Live mode never substitutes
fixtures; `DATA_MODE=fixtures` is available for offline development. OpenAI failures
use the heuristic intent parser and log the failure type. Provider failures show a
retryable error instead of fake products. Intent chips summarize the parsed search;
edit the search text and resubmit to change constraints.

Validation: `.venv/bin/python -m pytest -q`,
`node --test tests/search-client.test.mjs tests/auth.test.cjs`, and `npm run build`.
