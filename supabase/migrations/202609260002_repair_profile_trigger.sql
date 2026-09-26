-- Run this entire file in the Supabase SQL editor.
-- Fixes: relation "public.profiles" does not exist during signup.
-- Only redirects AFTER INSERT, FOR EACH ROW signup triggers whose functions
-- reference the missing public.profiles table. Other triggers are preserved.
begin;

create or replace function public.projectv_create_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into public.users (id, full_name, email, created_at)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
            coalesce(new.email, ''), new.created_at)
    on conflict (id) do nothing;
    return new;
end;
$$;

revoke all on function public.projectv_create_user() from public, anon, authenticated;

do $$
declare
    stale_trigger record;
begin
    if to_regclass('public.users') is null then
        raise exception 'Run 202609260001_users.sql first to create public.users.';
    end if;

    -- If profiles actually exists, this repair no longer matches the reported
    -- problem. Stop rather than change a potentially valid profile workflow.
    if to_regclass('public.profiles') is not null then
        raise exception 'public.profiles exists. Inspect the current Auth logs before applying this repair.';
    end if;

    for stale_trigger in
        select t.tgname
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = 'auth.users'::regclass
          and not t.tgisinternal
          and t.tgtype = 5 -- AFTER INSERT, FOR EACH ROW only
          and regexp_replace(lower(pg_get_functiondef(p.oid)), '["[:space:]]', '', 'g')
              like '%insertintopublic.profiles%'
    loop
        execute format('drop trigger %I on auth.users', stale_trigger.tgname);
        raise notice 'Removed stale signup trigger %; ProjectV will create the users row.', stale_trigger.tgname;
    end loop;

    -- One signup writer replaces the stale profile writers; keep all user rows.
    drop trigger if exists projectv_auth_user_created on auth.users;
    create trigger projectv_auth_user_created after insert on auth.users
        for each row execute function public.projectv_create_user();
end;
$$;

commit;

-- Review remaining signup triggers after the repair.
select t.tgname as trigger_name, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
