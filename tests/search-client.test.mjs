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
