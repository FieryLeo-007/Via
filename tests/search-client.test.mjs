import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProducts, safeProductUrl } from '../static/scripts/search-client.mjs';

test('search sends intent, then ranked search, then picks', async () => {
    const requests = [];
    const intent = { query: 'headphones', max_price_cents: 20000 };
    const ranked = { results: [{ title: 'Actual product', top_pick_rank: null }], partial: false };
    const picked = { results: [{ title: 'Actual product', top_pick_rank: 1 }], partial: false, picks_source: 'ai' };
    const early = [];
    const result = await searchProducts('headphones under $200', {
        onResults: (data) => early.push(data),
        fetchImpl: async (url, options) => {
            requests.push([url, JSON.parse(options.body)]);
            return { ok: true, json: async () => [intent, ranked, picked][requests.length - 1] };
        }
    });
    assert.deepEqual(requests, [
        ['/api/intent', { utterance: 'headphones under $200' }],
        ['/api/search', { intent, utterance: 'headphones under $200', picks: false }],
        ['/api/picks', { result: ranked, intent, utterance: 'headphones under $200' }]
    ]);
    assert.equal(early.length, 1);
    assert.equal(early[0].results[0].top_pick_rank, null);
    assert.equal(result.results[0].top_pick_rank, 1);
});

test('picks failure keeps ranked results', async () => {
    let n = 0;
    const result = await searchProducts('chair', { fetchImpl: async () => {
        n++;
        if (n === 3) return { ok: false, json: async () => ({ error: { message: 'picks down' } }) };
        return { ok: true, json: async () => n === 1 ? { query: 'chair' } : { results: [{ title: 'Chair' }] } };
    } });
    assert.equal(result.results[0].title, 'Chair');
});

test('API failure reaches the UI as an error', async () => {
    await assert.rejects(searchProducts('chair', { fetchImpl: async () => ({ ok: false, json: async () => ({ error: { message: 'Try again' } }) }) }), /Try again/);
});

test('cancelled intent does not start another product request', async () => {
    const controller = new AbortController();
    let count = 0;
    await assert.rejects(searchProducts('chair', { signal: controller.signal, fetchImpl: async () => {
        count++; controller.abort();
        return { ok: true, json: async () => ({ query: 'chair' }) };
    } }), { name: 'AbortError' });
    assert.equal(count, 1);
});

test('untrusted product URLs only allow HTTPS', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,bad', 'http://example.com', null, 'https://user:secret@example.com']) assert.equal(safeProductUrl(value), null);
    assert.equal(safeProductUrl('https://example.com/product/123'), 'https://example.com/product/123');
});

test('retailer links preserve product path and reject Google Shopping', async () => {
    const { retailerProductUrl } = await import('../static/scripts/search-client.mjs');
    assert.equal(retailerProductUrl('https://store.example/products/item?size=M'), 'https://store.example/products/item?size=M');
    for (const url of ['https://www.google.com/shopping/product/1', 'https://google.co.uk/url?q=x', 'https://store.example/']) assert.equal(retailerProductUrl(url), null);
});

test('followups send the same compact history to intent, search and picks', async () => {
    const requests = [];
    const history = [{ query: 'headphones', intent: { query: 'headphones' }, status: 'complete', products: [
        { title: 'Quiet headphones', price_cents: 15000, top_pick_rank: 1, merchant_url: 'https://example.com/private' }
    ] }];
    await searchProducts('cheaper ones', { history, fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        return { ok: true, json: async () => url === '/api/intent' ? { query: 'headphones' } : { results: [{ title: 'Budget headphones' }] } };
    } });
    assert.equal(requests.length, 3);
    for (const body of requests) {
        assert.equal(body.utterance, 'cheaper ones');
        assert.equal(body.history[0].products[0].title, 'Quiet headphones');
        assert.equal(body.history[0].products[0].merchant_url, undefined);
        assert.equal(body.history.length, 1);
    }
    assert.equal(history[0].products[0].merchant_url, 'https://example.com/private');
});

test('history window keeps recent turns in order and new chats start empty', async () => {
    const { conversationHistory } = await import('../static/scripts/search-client.mjs');
    const turns = Array.from({ length: 25 }, (_, i) => ({ query: String(i), products: [] }));
    assert.deepEqual(conversationHistory(turns).map(turn => turn.query), turns.slice(5).map(turn => turn.query));
    assert.deepEqual(conversationHistory([]), []);
});

test('compare posts the selected products with turn context and surfaces errors', async () => {
    const { compareProducts } = await import('../static/scripts/search-client.mjs');
    const requests = [];
    const products = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
    const intent = { query: 'headphones' };
    const history = [{ query: 'earlier', products: [] }];
    const comparison = { winner_id: 'a', verdict: 'A wins', takes: [], source: 'ai' };
    const result = await compareProducts(products, { intent, utterance: 'headphones', history, fetchImpl: async (url, options) => {
        requests.push([url, JSON.parse(options.body)]);
        return { ok: true, json: async () => comparison };
    } });
    assert.deepEqual(result, comparison);
    assert.equal(requests[0][0], '/api/compare');
    assert.deepEqual(requests[0][1].products, products);
    assert.deepEqual(requests[0][1].intent, intent);
    assert.equal(requests[0][1].utterance, 'headphones');
    assert.equal(requests[0][1].history[0].query, 'earlier');

    await assert.rejects(
        compareProducts(products, { fetchImpl: async () => ({ ok: false, json: async () => ({ error: { message: 'Bad input' } }) }) }),
        /Bad input/
    );
});
