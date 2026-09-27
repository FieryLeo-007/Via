-- Transaction-local fixtures; nothing is retained in the user's order history.
begin;
do $$
declare
    owners uuid[];
    order_key uuid := gen_random_uuid();
    other_key uuid := gen_random_uuid();
    visible_count integer;
begin
    select array_agg(id) into owners from (select id from auth.users order by created_at limit 2) u;
    if coalesce(array_length(owners, 1), 0) < 2 then raise exception 'Two accounts required'; end if;
    insert into public.checkout_orders(id,user_id,request_hash,item,max_cost,is_demo,status)
        values(order_key,owners[1],'demo-isolation','{"title":"Demo test"}',1,true,'succeeded'),
              (other_key,owners[1],'demo-isolation','{"title":"Demo test"}',1,true,'succeeded');
    -- Separate, identical demos can both be refunded, without the live duplicate guard.
    update public.checkout_orders set status='refunded' where id in (order_key,other_key);
    begin
        update public.checkout_orders set provider_run_id='forbidden-demo-provider' where id=order_key;
        raise exception 'Demo accepted a live provider run';
    exception when check_violation then null;
    end;
    perform set_config('request.jwt.claim.sub',owners[1]::text,true);
    set local role authenticated;
    select count(*) into visible_count from public.checkout_orders where id=order_key;
    if visible_count != 1 then raise exception 'Owner cannot read demo'; end if;
    begin
        update public.checkout_orders set status='cancelled' where id=order_key;
        raise exception 'Client can forge demo status';
    exception when insufficient_privilege then null;
    end;
    begin
        insert into public.checkout_orders(id,user_id,request_hash,item,max_cost,is_demo,status)
            values(gen_random_uuid(),owners[1],'forged-demo','{}',1,true,'succeeded');
        raise exception 'Client can forge demo owner/status';
    exception when insufficient_privilege then null;
    end;
    begin
        delete from public.checkout_orders where id=order_key;
        raise exception 'Client can delete demo';
    exception when insufficient_privilege then null;
    end;
    perform set_config('request.jwt.claim.sub',owners[2]::text,true);
    select count(*) into visible_count from public.checkout_orders where id=order_key;
    if visible_count != 0 then raise exception 'Another user can read demo'; end if;
    reset role;
    set local role anon;
    begin
        perform id from public.checkout_orders where id=order_key;
        raise exception 'Anonymous access to demo allowed';
    exception when insufficient_privilege then null;
    end;
    reset role;
end $$;
rollback;
