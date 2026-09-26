-- Run in the Supabase SQL editor before enabling signup.
begin;

create table if not exists public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null default '',
    email text not null,
    created_at timestamptz not null default now()
);

alter table public.users enable row level security;
revoke all on public.users from anon;
grant select on public.users to authenticated;

drop policy if exists "Users can read their own profile" on public.users;
create policy "Users can read their own profile" on public.users
    for select to authenticated using ((select auth.uid()) = id);

-- Runs in the same transaction as signup, even before email confirmation.
create or replace function public.projectv_create_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.users (id, full_name, email, created_at)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
            coalesce(new.email, ''), new.created_at);
    return new;
end;
$$;
revoke all on function public.projectv_create_user() from public, anon, authenticated;

drop trigger if exists projectv_auth_user_created on auth.users;
create trigger projectv_auth_user_created after insert on auth.users
    for each row execute function public.projectv_create_user();

-- Add missing profiles for existing accounts without overwriting their data.
insert into public.users (id, full_name, email, created_at)
select id, coalesce(raw_user_meta_data ->> 'full_name', ''), coalesce(email, ''), created_at
from auth.users on conflict (id) do nothing;

commit;
