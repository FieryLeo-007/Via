-- Only the authenticated application server may write payment state.
create table public.checkout_orders (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    provider_run_id text unique,
    provider_revision bigint not null default -1,
    request_hash text not null,
    status text not null default 'starting',
    item jsonb not null,
    max_cost numeric(12,2) not null check (max_cost > 0 and max_cost <= 100000),
    currency text not null default 'USD' check (currency = 'USD'),
    result jsonb not null default '{}',
    reason jsonb,
    cancel_requested boolean not null default false,
    service_request jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index checkout_orders_user_created_idx on public.checkout_orders(user_id, created_at desc);
alter table public.checkout_orders enable row level security;
revoke all on public.checkout_orders from anon, authenticated;
grant select on public.checkout_orders to authenticated;
grant all on public.checkout_orders to service_role;
create policy "Users read only their checkout orders"
    on public.checkout_orders for select to authenticated
    using ((select auth.uid()) = user_id);
comment on table public.checkout_orders is
    'Server-written Crossmint order metadata. Never store PAN, CVC, passwords, JWTs or card credentials.';
