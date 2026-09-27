-- Runs against a configured project with at least two existing accounts.
-- Inserts only a transaction-local test order and rolls it back.
begin;
do $$
declare
    owners uuid[];
    order_key uuid := gen_random_uuid();
    visible_count integer;
begin
    select array_agg(id) into owners from (select id from auth.users order by created_at limit 2) u;
    if array_length(owners, 1) < 2 then raise exception 'Two existing accounts required for isolation test'; end if;
    insert into public.checkout_orders(id,user_id,request_hash,item,max_cost)
        values(order_key,owners[1],'rls-test','{"id":"rls-test","title":"Isolation test"}',1);
    perform set_config('request.jwt.claim.sub',owners[1]::text,true);
    set local role authenticated;
    select count(*) into visible_count from public.checkout_orders where id=order_key;
    if visible_count != 1 then raise exception 'Owner cannot read order'; end if;
    begin
        update public.checkout_orders set status='succeeded' where id=order_key;
        raise exception 'Authenticated client can forge order status';
    exception when insufficient_privilege then null;
    end;
    begin
        delete from public.checkout_orders where id=order_key;
        raise exception 'Authenticated client can delete payment history';
    exception when insufficient_privilege then null;
    end;
    begin
        insert into public.checkout_orders(id,user_id,request_hash,item,max_cost)
            values(gen_random_uuid(),owners[1],'forged','{}',1);
        raise exception 'Authenticated client can forge an order';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claim.sub',owners[2]::text,true);
    select count(*) into visible_count from public.checkout_orders where id=order_key;
    if visible_count != 0 then raise exception 'Another user can read the order'; end if;
    reset role;
    set local role anon;
    begin
        perform id from public.checkout_orders where id=order_key;
        raise exception 'Anonymous access allowed';
    exception when insufficient_privilege then null;
    end;
    reset role;
end $$;
rollback;
