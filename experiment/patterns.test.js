'use strict';
// EXPERIMENT. The three examples Blaze marked on Exness charts must trigger, on the right day.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./candles');
const Pt = require('./patterns');

const aud = C.daily('AUD/USD');
const hits = Pt.scan(aud);
const find = (type, from, to) => hits.filter(h => h.type === type && h.date >= from && h.date <= to);

test('overextended W, Mar/Apr 2026, alerts on the 7 Apr breakout candle', () => {
  assert.deepEqual(find('W', '2026-03-25', '2026-04-20').map(h => h.date), ['2026-04-07']);
});
test('overextended M, Jul 2025, alerts on 28 Jul', () => {
  assert.deepEqual(find('M', '2025-07-20', '2025-08-08').map(h => h.date), ['2025-07-28']);
});
test('overextended W, Feb/Mar 2024, alerts on 6 Mar', () => {
  assert.deepEqual(find('W', '2024-02-26', '2024-03-10').map(h => h.date), ['2024-03-06']);
});
