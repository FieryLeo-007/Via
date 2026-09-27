-- Enforce existing owner policies; no user data is changed or removed.
alter table public.user_events enable row level security;
alter table public.chat_turns enable row level security;
alter table public.onboarding_preferences enable row level security;

-- Behavioral history is append-only from authenticated browser sessions.
revoke all on public.user_events from anon;
revoke update, delete, truncate, references, trigger on public.user_events from authenticated;
grant select, insert on public.user_events to authenticated;

-- Restrictive policy composes with the existing users_insert_own_events policy.
-- Confirmed purchases must be inserted by a trusted order/webhook integration.
create policy discover_event_integrity on public.user_events
as restrictive for insert to authenticated
with check (
    user_id = (select auth.uid())
    and (chat_turn_id is null or exists (
        select 1 from public.chat_turns t
        where t.id = chat_turn_id and t.user_id = (select auth.uid())
    ))
    and product_data is not null
    and jsonb_typeof(product_data) = 'object'
    and event_weight = case event_type
        when 'impression' then 0.1 when 'view' then 0.25
        when 'click' then 0.4 when 'compare' then 0.5
        when 'save' then 0.7 when 'add_to_cart' then 0.85
        when 'remove_from_cart' then -0.3
        when 'dislike' then -1.0 when 'hide' then -1.0
        else null end
);
create index if not exists onboarding_preferences_user_idx on public.onboarding_preferences(user_id);
create index if not exists user_events_chat_turn_idx on public.user_events(chat_turn_id);
create index if not exists chat_turns_user_created_idx on public.chat_turns(user_id, created_at desc);
