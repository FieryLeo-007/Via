import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listChats, loadTurns, listSaved, saveTurn, setSaved, deleteChat } from '../static/scripts/account-store.mjs';

function setup(responses = []) {
    const calls = [];
    globalThis.window = { projectVAccount: { user: { id: 'owner' }, client: {
        from(table) {
            const call = { table, operations: [] }; calls.push(call);
            const response = responses.shift() || { data: [], error: null };
            const builder = {};
            for (const method of ['select', 'eq', 'order', 'range', 'upsert', 'delete', 'single']) {
                builder[method] = (...args) => { call.operations.push([method, ...args]); return builder; };
            }
            builder.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject);
            return builder;
        }
    } } };
    return calls;
}
test('every account collection and deletion explicitly scopes the current user', async () => {
    const calls = setup();
    await listChats(); await loadTurns('chat'); await listSaved(); await deleteChat('chat');
    for (const call of calls) assert.ok(call.operations.some(op => op[0] === 'eq' && op[1] === 'user_id' && op[2] === 'owner'));
});
test('turn retries retain their id and product snapshots without trusting caller ownership', async () => {
    const calls = setup();
    const turn = { id: 'turn', user_id: 'forged', chat_id: 'forged', query: 'headphones', products: [{ id: 'product', title: 'Headphones' }] };
    await saveTurn('chat', turn); await saveTurn('chat', turn);
    for (const call of calls) {
        const row = call.operations.find(op => op[0] === 'upsert')[1];
        assert.equal(row.id, 'turn'); assert.equal(row.user_id, 'owner'); assert.equal(row.chat_id, 'chat');
        assert.deepEqual(row.products, turn.products);
    }
});
test('favorites hold independent snapshots and unsaving never deletes chat history', async () => {
    const calls = setup();
    const product = { id: 'product', title: 'Headphones', price_cents: 12900 };
    await setSaved(product, true); await setSaved(product, false);
    assert.ok(calls.every(call => call.table === 'saved_products'));
    const saved = calls[0].operations.find(op => op[0] === 'upsert')[1];
    assert.deepEqual(saved.product_data, product); assert.equal(saved.chat_id, undefined);
    assert.ok(calls[1].operations.some(op => op[0] === 'eq' && op[1] === 'product_key' && op[2] === 'product'));
});
test('database errors reach the UI instead of reporting successful writes', async () => {
    setup([{ error: { message: 'Connection unavailable' } }]);
    await assert.rejects(setSaved({ id: 'product' }, true), /Connection unavailable/);
});
test('history loads beyond the API page limit', async () => {
    const first = Array.from({ length: 500 }, (_, id) => ({ id }));
    const calls = setup([{ data: first }, { data: [{ id: 500 }] }]);
    assert.equal((await listChats()).length, 501);
    assert.deepEqual(calls[1].operations.find(op => op[0] === 'range'), ['range', 500, 999]);
});
