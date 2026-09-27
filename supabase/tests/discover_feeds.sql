-- Verify snapshots and owner isolation without retaining test accounts or feeds.
begin;
select set_config('test.owner', gen_random_uuid()::text, true);
select set_config('test.other', gen_random_uuid()::text, true);
insert into auth.users (id, email, created_at, raw_user_meta_data)
values (current_setting('test.owner')::uuid, 'discover-owner@example.invalid', now(), '{}'),
       (current_setting('test.other')::uuid, 'discover-other@example.invalid', now(), '{}');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner'), true);
insert into public.discover_feeds(user_id, payload)
values (auth.uid(), '{"sections":[{"products":[{"id":"first"}]}],"cache":{"hit":false}}');
do $$ begin
    if (select payload->'sections'->0->'products'->0->>'id' from public.discover_feeds) <> 'first'
    then raise exception 'Product snapshot did not persist'; end if;
end $$;
insert into public.discover_feeds(user_id, payload)
values (auth.uid(), '{"sections":[{"products":[{"id":"refreshed"}]}],"cache":{"hit":false}}')
on conflict (user_id) do update set payload = excluded.payload, updated_at = now();
do $$ begin
    if (select count(*) from public.discover_feeds) <> 1
       or (select payload->'sections'->0->'products'->0->>'id' from public.discover_feeds) <> 'refreshed'
    then raise exception 'Refresh failed to replace snapshot'; end if;
    begin
        update public.discover_feeds set user_id = current_setting('test.other')::uuid;
        raise exception 'Owner reassignment allowed';
    exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.other'), true);
do $$ declare n integer; begin
    if exists(select from public.discover_feeds) then raise exception 'Cross-user read allowed'; end if;
    update public.discover_feeds set payload = '{"sections":[],"cache":{}}';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'Cross-user update allowed'; end if;
    begin
        insert into public.discover_feeds(user_id, payload)
        values (current_setting('test.owner')::uuid, '{"sections":[],"cache":{}}');
        raise exception 'Cross-user insert allowed';
    exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin
    if has_table_privilege('anon', 'public.discover_feeds', 'SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Anonymous access allowed'; end if;
    if not (select relrowsecurity from pg_class where oid = 'public.discover_feeds'::regclass)
    then raise exception 'RLS not enabled'; end if;
end $$;
select 'PASS: persisted products, refresh upsert, owner isolation, anonymous denial' as result;
rollback;
