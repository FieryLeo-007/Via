-- Product snapshots in each turn belong to the chat; favorites are independent copies.
create table public.chats (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null check (length(title) between 1 and 2000),
    created_at timestamptz not null default now(),
    unique (id, user_id)
);
create index chats_user_created_idx on public.chats(user_id, created_at desc);
create table public.chat_turns (
    id uuid primary key default gen_random_uuid(),
    chat_id uuid not null,
    user_id uuid not null,
    query text not null,
    intent jsonb,
    products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array'),
    status text not null default 'pending' check (status in ('pending', 'complete', 'error')),
    error_message text,
    created_at timestamptz not null default now(),
    foreign key (chat_id, user_id) references public.chats(id, user_id) on delete cascade
);
create index chat_turns_chat_owner_idx on public.chat_turns(chat_id, user_id, created_at);
create index chat_turns_user_idx on public.chat_turns(user_id);
create table public.saved_products (
    user_id uuid not null references auth.users(id) on delete cascade,
    product_key text not null,
    product_data jsonb not null check (jsonb_typeof(product_data) = 'object'),
    created_at timestamptz not null default now(),
    primary key (user_id, product_key)
);
create index saved_products_user_created_idx on public.saved_products(user_id, created_at desc);

alter table public.chats enable row level security;
alter table public.chat_turns enable row level security;
alter table public.saved_products enable row level security;
revoke all on public.chats, public.chat_turns, public.saved_products from anon, authenticated;
grant select, insert, update, delete on public.chats, public.chat_turns, public.saved_products to authenticated;
create policy chats_owner on public.chats for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy chat_turns_owner on public.chat_turns for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy saved_products_owner on public.saved_products for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
