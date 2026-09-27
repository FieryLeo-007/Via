-- Even simultaneous requests from separate devices cannot launch the same active purchase twice.
create unique index checkout_orders_active_request_unique
    on public.checkout_orders(user_id, request_hash)
    where status not in ('succeeded', 'blocked', 'failed', 'cancelled');
