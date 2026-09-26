-- Isolated fixtures; this entire verification rolls back, including Auth rows.
begin;
select set_config('test.owner', gen_random_uuid()::text, true);
select set_config('test.other', gen_random_uuid()::text, true);
select set_config('test.chat', gen_random_uuid()::text, true);
insert into auth.users (id, email, created_at, raw_user_meta_data)
values (current_setting('test.owner')::uuid, 'chat-test-owner@example.invalid', now(), '{}'),
       (current_setting('test.other')::uuid, 'chat-test-other@example.invalid', now(), '{}');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner'), true);
insert into public.chats(id, user_id, title) values(current_setting('test.chat')::uuid, auth.uid(), 'Verification chat');
insert into public.chat_turns(chat_id, user_id, query, products, status)
values(current_setting('test.chat')::uuid, auth.uid(), 'Find a test product', '[{"id":"verification-product","title":"Test product"}]', 'complete');
insert into public.saved_products(user_id, product_key, product_data)
values(auth.uid(), 'verification-product', '{"id":"verification-product","title":"Test product"}');
do $$ begin
    if (select count(*) from public.chat_turns where products->0->>'id' = 'verification-product') <> 1 then raise exception 'Product snapshot not persisted'; end if;
    begin
        update public.chats set user_id = current_setting('test.other')::uuid;
        raise exception 'Owner reassignment allowed';
    exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.other'), true);
do $$ declare n integer; begin
    if exists(select from public.chats) or exists(select from public.chat_turns) or exists(select from public.saved_products) then raise exception 'Cross-user read allowed'; end if;
    update public.chats set title = 'Unauthorized'; get diagnostics n = row_count;
    if n <> 0 then raise exception 'Cross-user update allowed'; end if;
    delete from public.chats; get diagnostics n = row_count;
    if n <> 0 then raise exception 'Cross-user delete allowed'; end if;
    begin
        insert into public.saved_products(user_id, product_key, product_data) values(current_setting('test.owner')::uuid, 'forged', '{}');
        raise exception 'Cross-user saved insert allowed';
    exception when insufficient_privilege then null; end;
    begin
        insert into public.chat_turns(chat_id, user_id, query) values(current_setting('test.chat')::uuid, auth.uid(), 'forged');
        raise exception 'Cross-user chat attachment allowed';
    exception when foreign_key_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.owner'), true);
delete from public.chats where id = current_setting('test.chat')::uuid;
do $$ begin
    if exists(select from public.chat_turns) then raise exception 'Chat products did not cascade'; end if;
    if (select count(*) from public.saved_products) <> 1 then raise exception 'Saved product lost after chat deletion'; end if;
end $$;
delete from public.saved_products where product_key = 'verification-product';
do $$ begin
    if exists(select from public.saved_products) then raise exception 'Unsave failed'; end if;
end $$;
reset role;
do $$ declare t text; begin
    foreach t in array array['chats', 'chat_turns', 'saved_products'] loop
        if has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Anonymous access allowed on %', t; end if;
    end loop;
end $$;
select 'PASS: snapshots, ownership, cross-user isolation, cascade deletion, favorite retention, unsave, anonymous denial' as result;
rollback;
