import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoItems, demoQuote, demoTransition, newDemoRun, restoreDemoRun, withinDemoLimit} from '../static/scripts/demo-checkout.mjs';

test('quotes include quantity, rounded tax and shipping without changing cart data', () => {
    const cart = [{id:'cart-item',title:'Example',price_cents:1999,quantity:3}];
    const original = structuredClone(cart);
    const items = demoItems(cart);
    assert.deepEqual(demoQuote(items, 'express'), {subtotal:5997,tax:480,delivery:1295,total:7772});
    const run = newDemoRun(items);
    let current = run;
    for (const event of ['start','prepared','approve','finished']) current = demoTransition(current,event);
    assert.equal(current.stage,'complete');
    assert.deepEqual(cart, original);
});
test('agent cannot finish without explicit approval and cannot bypass a spending cap', () => {
    let run = newDemoRun([]);
    assert.equal(demoTransition(run, 'finished').stage, 'review');
    run = demoTransition(run, 'start');
    assert.equal(demoTransition(run, 'approve').stage, 'shopping');
    run = demoTransition(run, 'prepared');
    assert.equal(demoTransition(run, 'finished').stage, 'approval');
    assert.equal(demoTransition({...run,limit:'1'}, 'approve').stage, 'approval');
    assert.equal(demoTransition(run, 'approve').stage, 'purchasing');
    assert.equal(demoTransition({...run,stage:'review',limit:'1'}, 'start').stage, 'review');
    assert.equal(withinDemoLimit(16092,'160.92'),true);
    for (const limit of ['160.91','-10','NaN','Infinity','','0','160.919']) assert.equal(withinDemoLimit(16092, limit),false);
});
test('cancellation stops in-flight transitions and completing twice is harmless', () => {
    for (const stage of ['shopping','approval','purchasing']) {
        const cancelled = demoTransition({...newDemoRun([]),stage}, 'cancel');
        assert.equal(cancelled.stage, 'cancelled');
        for (const event of ['prepared','approve','finished']) assert.equal(demoTransition(cancelled,event).stage, 'cancelled');
    }
    const finished = {...newDemoRun([]), stage:'complete'};
    assert.equal(demoTransition(finished,'finished'),finished);
});
test('refresh resumes only a compatible demo, and invalid session data starts fresh', () => {
    const run = {...newDemoRun([]),stage:'approval'};
    assert.deepEqual(restoreDemoRun(JSON.stringify(run), run.items),run);
    for (const raw of ['{broken','null',JSON.stringify({...run,stage:'paid'}),JSON.stringify({...run,items:null})]) assert.equal(restoreDemoRun(raw, run.items).stage,'review');
    assert.equal(restoreDemoRun(JSON.stringify(run),[{id:'different',title:'Different',price_cents:5000,quantity:1}]).stage,'review');
});
test('empty carts and unusable prices fall back to a clearly identified sample', () => {
    assert.equal(demoItems([])[0].id,'demo-headphones');
    assert.equal(demoItems([{title:'Bad price',price_cents:NaN,quantity:1}])[0].id,'demo-headphones');
});
