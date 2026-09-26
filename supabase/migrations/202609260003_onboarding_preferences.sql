-- Initial preference capture for newly-created accounts.
begin;

create table if not exists public.onboarding_preferences (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    category text not null,
    preference_key text not null,
    preference_value jsonb not null,
    importance float8 not null check (importance >= 0 and importance <= 1),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint onboarding_preferences_user_key unique (user_id, category, preference_key)
);

alter table public.onboarding_preferences enable row level security;
revoke all on public.onboarding_preferences from anon;
grant select, insert, update on public.onboarding_preferences to authenticated;

drop policy if exists "Users can read their own onboarding preferences" on public.onboarding_preferences;
create policy "Users can read their own onboarding preferences" on public.onboarding_preferences
    for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own onboarding preferences" on public.onboarding_preferences;
create policy "Users can add their own onboarding preferences" on public.onboarding_preferences
    for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own onboarding preferences" on public.onboarding_preferences;
create policy "Users can update their own onboarding preferences" on public.onboarding_preferences
    for update to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

commit;
