import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api, cardApi, TERMINAL, safeUrl, statusLabel} from '../static/scripts/commerce-client.mjs';

globalThis.window = {projectVAccount: {client: {auth: {getSession: async () => ({data:{session:{access_token:'user-jwt'}}})}}}};
test('backend calls authenticate the current session and never cache payment data', async () => {
    globalThis.fetch = async (url, options) => {
        assert.equal(url, '/api/commerce/orders');
        assert.equal(options.headers.Authorization, 'Bearer user-jwt');
        assert.equal(options.cache,'no-store');
        assert.deepEqual(JSON.parse(options.body),{id:'stable-id'});
        return {ok:true,json:async()=>({order:{id:'stable-id'}})};
    };
    assert.equal((await api('/orders',{method:'POST',body:{id:'stable-id'}})).order.id,'stable-id');
});
test('card registration goes to production with a client key and user JWT', async () => {
    globalThis.fetch = async (url, options) => {
        assert.equal(url,'https://www.crossmint.com/api/unstable/payment-methods/pm/order-intent-registration');
        assert.equal(options.headers['X-API-KEY'],'ck_production_test');
        assert.equal(options.headers.Authorization,'Bearer user-jwt');
        assert.equal(options.method,'PUT');
        return {ok:true,json:async()=>({rails:[]})};
    };
    await cardApi({clientKey:'ck_production_test'},'/payment-methods/pm/order-intent-registration','PUT',{countryCode:'US'});
});
test('provider auth failures are actionable and never echoed as raw provider data', async () => {
    globalThis.fetch=async()=>({ok:false,status:403,json:async()=>({message:'secret provider debug data'})});
    await assert.rejects(cardApi({clientKey:'ck'},'/order-intents'),/Supabase JWT/);
});
test('failed API responses cannot masquerade as completed purchases',async()=>{
    globalThis.fetch=async()=>({ok:false,status:502,json:async()=>({error:'Confirmation missing'})});
    await assert.rejects(api('/orders'),/Confirmation missing/);
    assert.equal(TERMINAL.has('awaiting_input'),false);
    assert.equal(statusLabel('succeeded'),'Purchased');
    assert.equal(statusLabel('cancelled'),'Checkout cancelled');
});
test('untrusted receipt links cannot execute scripts or include URL credentials',()=>{
    assert.equal(safeUrl('javascript:alert(1)'),null);
    assert.equal(safeUrl('http://shop.example.com'),null);
    assert.equal(safeUrl('https://user:password@shop.example.com'),null);
    assert.equal(safeUrl('https://shop.example.com/orders/1'),'https://shop.example.com/orders/1');
});
