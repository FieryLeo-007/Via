create table if not exists public.user_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    chat_turn_id uuid references public.chat_turns(id) on delete set null,
    event_type text not null check (event_type in ('impression','view','click','compare','save','add_to_cart','purchase','remove_from_cart','dislike','hide')),
    event_weight numeric(4,2) not null check (
        (event_type = 'impression' and event_weight = 0.10) or
        (event_type = 'view' and event_weight = 0.25) or
        (event_type = 'click' and event_weight = 0.40) or
        (event_type = 'compare' and event_weight = 0.50) or
        (event_type = 'save' and event_weight = 0.70) or
        (event_type = 'add_to_cart' and event_weight = 0.85) or
        (event_type = 'purchase' and event_weight = 1.00) or
        (event_type = 'remove_from_cart' and event_weight = -0.30) or
        (event_type in ('dislike', 'hide') and event_weight = -1.00)
    ),
    session_id text,
    category text,
    product_data jsonb check (product_data is null or jsonb_typeof(product_data) = 'object'),
    created_at timestamptz not null default now()
);

create index if not exists user_events_user_created_idx on public.user_events(user_id, created_at desc);
create index if not exists user_events_user_chat_idx on public.user_events(user_id, chat_turn_id, created_at desc);
create index if not exists user_events_type_idx on public.user_events(user_id, event_type, created_at desc);

alter table public.user_events enable row level security;
revoke all on public.user_events from anon, authenticated;
grant insert on public.user_events to authenticated;
drop policy if exists user_events_insert_own on public.user_events;
create policy user_events_insert_own on public.user_events
    for insert to authenticated
    with check ((select auth.uid()) = user_id);
