-- Demo history uses the same owner-only reads and server-only writes as live orders.
alter table public.checkout_orders add column is_demo boolean not null default false;
alter table public.checkout_orders add constraint checkout_orders_demo_boundary
    check (not is_demo or (provider_run_id is null and status in ('succeeded', 'cancelled', 'refunded')));
comment on column public.checkout_orders.is_demo is
    'Simulated order. Never authorize payment, contact a merchant, or include in real spending.';

-- Demo replays are deduplicated by primary key; identical new demos are allowed.
drop index public.checkout_orders_active_request_unique;
create unique index checkout_orders_active_request_unique
    on public.checkout_orders(user_id, request_hash)
    where not is_demo and status not in ('succeeded', 'blocked', 'failed', 'cancelled');
