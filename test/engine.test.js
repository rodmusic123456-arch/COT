'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

h.setupTempDirs();

const E = require('../src/engine');
const cfg = require('../src/config');
const cot = require('../src/cot');
const prices = require('../src/prices');
const { build } = require('../src/build');
const { runResearch } = require('../src/research');

const NOW = new Date(Date.UTC(2026, 9, 2, 10, 0, 0));
const PRICE_END = Date.UTC(2026, 9, 1) / 86400000;

function writeData(weeks, drop, withPrices) {
  fs.writeFileSync(cot.FILE, JSON.stringify(h.cotFixture(E, weeks, drop)));
  fs.writeFileSync(prices.FILE, JSON.stringify(withPrices ? h.priceFixture(E, PRICE_END) : {}));
}

test('every pair score equals (base strength - quote strength) / 2', function () {
  writeData(299, 0, true);
  const r = build({ now: NOW, write: false });
  assert.equal(r.check.problems.length, 0, r.check.problems.join('\n'));
  assert.ok(r.check.checks >= 100);
});

test('zones: |score| under 20 is neutral, 20 to 50 a bias zone, 50 and over strong', function () {
  writeData(299, 0, true);
  const rows = build({ now: NOW, write: false }).payload.data.filter(function (x) { return x.Kind === 'Pair'; });
  assert.ok(rows.length > 0);
  rows.forEach(function (x) {
    const s = Math.abs(x.Score);
    // Scores are shown rounded to 1 decimal; skip values sitting on a boundary.
    if (Math.abs(s - 20) < 0.11 || Math.abs(s - 50) < 0.11) return;
    const zone = String(x.Zone).toUpperCase();
    if (s < 20) assert.match(zone, /NEUTRAL/, x.Item + ' ' + x.Score);
    else if (s >= 50) assert.match(zone, /STRONG/, x.Item + ' ' + x.Score);
    else assert.doesNotMatch(zone, /NEUTRAL|STRONG/, x.Item + ' ' + x.Score);
  });
});

test('point in time: removing the newest weeks never changes older scores', function () {
  writeData(299, 0, false);
  const full = build({ now: NOW, write: false }).payload.hist;
  writeData(299, 6, false);
  const cut = build({ now: NOW, write: false }).payload.hist;

  let compared = 0;
  Object.keys(cut).forEach(function (key) {
    const fullByDate = {};
    full[key].forEach(function (row) { fullByDate[row[0]] = row; });
    cut[key].forEach(function (row) {
      if (!fullByDate[row[0]]) return; // older than the full run's chart window
      assert.deepEqual(fullByDate[row[0]].slice(1, 5), row.slice(1, 5), key + ' ' + row[0]);
      compared++;
    });
  });
  assert.ok(compared > 1000, 'compared ' + compared);
});

test('missing prices give PRICE DATA N/A, not a delay warning', function () {
  writeData(299, 0, false);
  const s = build({ now: NOW, write: false }).payload.status;
  assert.equal(s['PRICE STATUS'], 'PRICE DATA N/A');
  assert.equal(s['DATA STATUS'], 'PRICE DATA N/A');
});

test('a fresh COT week and fresh prices give CURRENT', function () {
  writeData(299, 0, true);
  const s = build({ now: NOW, write: false }).payload.status;
  assert.equal(s['COT STATUS'], 'CURRENT');
  assert.equal(s['PRICE STATUS'], 'CURRENT');
  assert.equal(s['DATA STATUS'], 'CURRENT');
});

test('an instrument one week behind makes the data INCOMPLETE', function () {
  const store = h.cotFixture(E, 299, 0);
  store.EUR.pop();
  fs.writeFileSync(cot.FILE, JSON.stringify(store));
  fs.writeFileSync(prices.FILE, JSON.stringify(h.priceFixture(E, PRICE_END)));
  const s = build({ now: NOW, write: false }).payload.status;
  assert.equal(s['DATA STATUS'], 'INCOMPLETE');
  assert.equal(s['MISSING INSTRUMENTS'], '1');
});

test('too little history is refused, not guessed', function () {
  writeData(40, 0, false);
  assert.throws(function () { build({ now: NOW, write: false }); }, /Not enough COT history/);
});

test('price merge: appends only newer days, is idempotent, and refuses a different series', function () {
  const series = { d: ['2026-09-01', '2026-09-02', '2026-09-03'], c: [1.1, 1.11, 1.12] };

  let o = prices.mergeSeries(series, [{ d: '2026-09-02', c: 1.11 }, { d: '2026-09-03', c: 1.12 }, { d: '2026-09-04', c: 1.13 }], 0.01, '2026-10-01');
  assert.equal(o.status, 'UPDATED');
  assert.equal(o.added, 1);
  assert.deepEqual(series.d.slice(-1), ['2026-09-04']);

  o = prices.mergeSeries(series, [{ d: '2026-09-03', c: 1.12 }, { d: '2026-09-04', c: 1.13 }], 0.01, '2026-10-01');
  assert.equal(o.status, 'UP TO DATE');
  assert.equal(series.d.length, 4);

  o = prices.mergeSeries(series, [{ d: '2026-09-03', c: 1.9 }, { d: '2026-09-05', c: 1.95 }], 0.01, '2026-10-01');
  assert.equal(o.status, 'MISMATCH');
  assert.equal(series.d.length, 4);

  o = prices.mergeSeries(series, [{ d: '2026-10-01', c: 1.14 }], 0.01, '2026-10-01');
  assert.equal(o.status, 'NO DATA', "today's partial bar is never stored");
});

test('research: directional filter flips bearish signs and respects score bounds', function () {
  const bt = {
    notes: [],
    rows: [
      { week: '2024-01-02', pair: 'EUR/USD', score: 30, bias: 'Bullish', pos: 25, mom: 5, acc: 1, r1: 1, r2: 2, r4: 4, idx: 0 },
      { week: '2024-01-09', pair: 'EUR/USD', score: -30, bias: 'Bearish', pos: -25, mom: -5, acc: -1, r1: -1, r2: -2, r4: -4, idx: 1 },
      { week: '2024-01-16', pair: 'GBP/USD', score: 5, bias: 'Neutral', pos: 1, mom: 1, acc: 0, r1: 9, r2: 9, r4: 9, idx: 2 }
    ]
  };
  const r = runResearch({ pair: 'ALL', directional: true }, bt);
  assert.equal(r.matched, 2);
  assert.equal(r.results[0].all.mean, 1);
  assert.equal(r.results[0].all.hit, 100);

  const only = runResearch({ pair: 'EUR/USD', bias: 'Bearish', scoreMin: -40, scoreMax: -20 }, bt);
  assert.equal(only.matched, 1);

  assert.ok(runResearch({}, { rows: [] }).error);
});

test('build writes the files the page reads', function () {
  writeData(299, 0, true);
  build({ now: NOW });
  ['data.json', 'stamp.json', 'backtest.json'].forEach(function (f) {
    assert.ok(fs.existsSync(path.join(cfg.DOCS_DIR, f)), f);
  });
  const p = JSON.parse(fs.readFileSync(path.join(cfg.DOCS_DIR, 'data.json'), 'utf8'));
  assert.equal(p.cfg.neutral, 20);
  assert.equal(p.cfg.strong, 50);
  assert.ok(p.data.length > 100);
});

test('payload carries about six months of raw COT reports per instrument', function () {
  writeData(299, 0, true);
  const p = build({ now: NOW, write: false }).payload;
  const names = p.data.filter(function (x) { return x.Kind === 'Instrument' && x.Timeframe === 'WEEKLY'; }).map(function (x) { return x.Item; });
  assert.ok(names.length >= 12);
  names.forEach(function (n) {
    const rows = p.cot[n];
    assert.ok(rows && rows.length >= 25 && rows.length <= 28, n + ' has ' + (rows ? rows.length : 0) + ' rows');
    assert.equal(rows[rows.length - 1][0], p.status['COT DATE'], n + ' ends on the latest COT date');
    rows.forEach(function (r, i) { if (i) assert.ok(r[0] > rows[i - 1][0], n + ' is oldest first'); });
  });
});
