'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

h.setupTempDirs();

const sc = require('../src/scorecard');
const prices = require('../src/prices');

// Daily prices from 2026-11-01 with a chosen path.
function series(from, vals) {
  const d = [];
  for (let i = 0; i < vals.length; i++) d.push(new Date(Date.UTC(2026, 10, from) + i * 86400000).toISOString().slice(0, 10));
  return { d: d, c: vals.slice() };
}

test('recorded calls are never rewritten, and only the first seed is marked rebuilt', function () {
  const store = { weeks: {} };
  sc.recordCalls(store, { '2026-11-03': [['EUR/USD', -30]], '2026-11-10': [['EUR/USD', -40]] }, '2026-11-12T00:00:00Z');
  assert.equal(store.weeks['2026-11-03'].rebuilt, true);
  assert.equal(store.weeks['2026-11-10'].rebuilt, false);
  sc.recordCalls(store, { '2026-11-10': [['EUR/USD', 55]], '2026-11-17': [['GBP/USD', 25]] }, '2026-11-19T00:00:00Z');
  assert.deepEqual(store.weeks['2026-11-10'].calls, [['EUR/USD', -40]]);
  assert.equal(store.weeks['2026-11-17'].rebuilt, false);
});

test('a call is tracked from the first price after the Friday release to one week later', function () {
  // COT 2026-11-03 (Tue) -> release Fri 6 Nov -> entry Sat 7 Nov (first stored day after), exit 14 Nov.
  const vals = [];
  for (let i = 0; i < 20; i++) vals.push(100 + i);
  const s = series(1, vals); // 1 Nov = 100, 7 Nov = 106, 14 Nov = 113
  const o = sc.outcome(s, '2026-11-03', Date.UTC(2026, 10, 25) / 1000);
  assert.equal(o.status, 'final');
  assert.equal(o.entry, 106);
  assert.equal(o.exit, 113);

  const store = { weeks: { '2026-11-03': { calls: [['EUR/USD', -30], ['GBP/USD', 45]] } } };
  const out = sc.buildScorecard(store, { 'EUR/USD': s, 'GBP/USD': s }, new Date(Date.UTC(2026, 10, 25)));
  const w = out.weeks[0];
  assert.equal(w.status, 'final');
  assert.equal(w.calls[0][2], -1);            // bearish call
  assert.ok(w.calls[0][5] > 0);              // price rose: went the other way
  assert.ok(w.calls[1][5] * w.calls[1][2] > 0); // bullish call worked
});

test('the newest week runs to the latest price, and waits until there is a price after the release', function () {
  const s = series(1, [100, 100, 100, 100, 100, 100, 100, 101, 102, 103]); // to 10 Nov
  const running = sc.outcome(s, '2026-11-03', Date.UTC(2026, 10, 10, 12) / 1000);
  assert.equal(running.status, 'running');
  assert.equal(running.exit, 103);
  s.last = { p: 104.5, t: Date.UTC(2026, 10, 10, 20) / 1000 };
  assert.equal(sc.outcome(s, '2026-11-03', Date.UTC(2026, 10, 10, 21) / 1000).exit, 104.5);
  assert.equal(sc.outcome(s, '2026-11-10', Date.UTC(2026, 10, 14) / 1000).status, 'pending');
});

test('price revisions are taken instead of freezing the series; broken data is still refused', function () {
  const s = { d: ['2026-11-02', '2026-11-03', '2026-11-04'], c: [1.10, 1.11, 1.12] };
  let o = prices.mergeSeries(s, [{ d: '2026-11-04', c: 1.14 }, { d: '2026-11-05', c: 1.15 }], 0.01, '2026-11-20');
  assert.equal(o.status, 'REVISED');
  assert.deepEqual(s.c, [1.10, 1.11, 1.14, 1.15]);
  o = prices.mergeSeries(s, [{ d: '2026-11-05', c: 1.6 }], 0.01, '2026-11-20');
  assert.equal(o.status, 'MISMATCH');
  assert.equal(s.c[3], 1.15);
});

test('news in the tracking window is attached and scored for or against each call', function () {
  const t = d => Date.UTC(2026, 10, d, 13, 30) / 1000;
  const events = [
    { c: 'USD', n: 'CPI y/y', t: t(10), imp: 'h', a: '3.9%', f: '3.7%', bw: 1 },   // inside 6-13 Nov window
    { c: 'AUD', n: 'Employment Change', t: t(12), imp: 'h', a: '-5K', f: '20K', bw: 2 },
    { c: 'USD', n: 'Retail Sales m/m', t: t(3), imp: 'h', a: '1%', f: '0.5%', bw: 1 }, // before the window
    { c: 'GBP', n: 'CPI y/y', t: t(11), imp: 'm', a: '3%', f: '3%', bw: 0 }            // medium impact: left out
  ];
  const news = sc.weekNews(events, '2026-11-03');
  assert.deepEqual(news.map(n => n[2]), ['CPI y/y', 'Employment Change']);
  assert.equal(sc.newsTilt('AUD/USD', -1, news), 2);  // bearish AUD/USD: strong USD data and weak AUD data both backed it
  assert.equal(sc.newsTilt('AUD/USD', 1, news), -2);
  assert.equal(sc.newsTilt('EUR/GBP', 1, news), 0);
});
