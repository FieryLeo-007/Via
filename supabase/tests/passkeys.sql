begin;
do $$
declare
    table_name text;
    uid uuid;
    challenge_id uuid := gen_random_uuid();
    consumed integer;
begin
    foreach table_name in array array['passkey_credentials', 'passkey_challenges'] loop
        if not (select relrowsecurity from pg_class where oid = ('public.' || table_name)::regclass) then
            raise exception 'RLS missing on %', table_name;
        end if;
        if has_table_privilege('anon', 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE')
            or has_table_privilege('authenticated', 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE') then
            raise exception 'Browser access permitted on %', table_name;
        end if;
        if not has_table_privilege('service_role', 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE') then
            raise exception 'Server access missing on %', table_name;
        end if;
    end loop;
    select id into uid from auth.users limit 1;
    if uid is not null then
        insert into public.passkey_challenges(user_id, purpose, id, challenge, expires_at)
        values(uid, 'registration', challenge_id, 'test-only', now() + interval '5 minutes')
        on conflict (user_id, purpose) do update set id = excluded.id,
            challenge = excluded.challenge, expires_at = excluded.expires_at;
        delete from public.passkey_challenges where user_id = uid
            and purpose = 'registration' and id = challenge_id and expires_at > now();
        get diagnostics consumed = row_count;
        if consumed <> 1 then raise exception 'Challenge consumption failed'; end if;
        delete from public.passkey_challenges where user_id = uid and id = challenge_id;
        get diagnostics consumed = row_count;
        if consumed <> 0 then raise exception 'Challenge replay was accepted'; end if;
    end if;
end $$;
rollback;
