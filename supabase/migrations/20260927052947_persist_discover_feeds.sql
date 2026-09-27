-- One durable display snapshot per account; normal visits never expire it.
create table public.discover_feeds (
    user_id uuid primary key references auth.users(id) on delete cascade,
    payload jsonb not null check (
        jsonb_typeof(payload) = 'object'
        and coalesce(jsonb_typeof(payload->'sections') = 'array', false)
        and coalesce(jsonb_typeof(payload->'cache') = 'object', false)
    ),
    updated_at timestamptz not null default now()
);

alter table public.discover_feeds enable row level security;
revoke all on public.discover_feeds from public, anon, authenticated;
grant select, insert, update on public.discover_feeds to authenticated;

create policy discover_feeds_select_own on public.discover_feeds
for select to authenticated using (user_id = (select auth.uid()));

create policy discover_feeds_insert_own on public.discover_feeds
for insert to authenticated with check (user_id = (select auth.uid()));

create policy discover_feeds_update_own on public.discover_feeds
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
