begin;

alter table public.users
    add column if not exists shirt_size text,
    add column if not exists shoe_size text,
    add column if not exists shipping_address jsonb,
    add column if not exists payment_method_provider text,
    add column if not exists payment_method_ref text,
    add column if not exists payment_card_brand text,
    add column if not exists payment_card_last4 text,
    add column if not exists payment_card_exp_month smallint,
    add column if not exists payment_card_exp_year smallint,
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists max_spending_budget numeric;

grant select, update on public.users to authenticated;

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile" on public.users
    for update to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

commit;