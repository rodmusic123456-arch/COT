'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

h.setupTempDirs();

const cal = require('../src/calendar');
const macro = require('../src/macro');

const T0 = Date.UTC(2026, 9, 1, 12, 30) / 1000; // Thu 1 Oct 2026 12:30 UTC

function ev(c, n, t, a, f, p, bw, imp) {
  return { k: c + '|' + n + '|' + t, c: c, n: n, t: t, imp: imp || 'h', a: a, f: f, p: p, r: '', bw: bw || 0 };
}

test('weekKey uses the Sunday that starts the week', function () {
  assert.equal(cal.weekKey(new Date(Date.UTC(2026, 9, 19))), 'oct18.2026');
  assert.equal(cal.weekKey(new Date(Date.UTC(2026, 9, 18))), 'oct18.2026');
  assert.equal(cal.weekKey(new Date(Date.UTC(2026, 10, 1))), 'nov1.2026');
});

test('parseWeek reads the event list out of a calendar page', function () {
  const state = { days: [{ events: [
    { currency: 'USD', name: 'CPI y/y', dateline: T0, impactName: 'high', actual: '3.7%', forecast: '3.6%', previous: '3.5%', actualBetterWorse: 1, note: 'brace } and "quote" inside' }
  ] }, { events: [] }] };
  const html = '<html><script>window.calendarComponentStates[1] = ' + JSON.stringify(state) + ';\nother = {};</script></html>';
  const rows = cal.parseWeek(html).map(cal.slim);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { k: 'USD|CPI y/y|' + T0, c: 'USD', n: 'CPI y/y', t: T0, imp: 'h', a: '3.7%', f: '3.6%', p: '3.5%', r: '', bw: 1 });
  assert.throws(function () { cal.parseWeek('<html></html>'); });
});

test('merge never blanks a recorded result, drops other currencies, and replaces feed rows', function () {
  const store = {};
  const now = T0 + 86400;
  cal.merge(store, [ev('USD', 'CPI y/y', T0, '3.7%', '3.6%', '3.5%', 1), ev('MXN', 'CPI y/y', T0, '1', '1', '1')], now);
  assert.equal(Object.keys(store).length, 1);

  const m = cal.merge(store, [ev('USD', 'CPI y/y', T0, '', '3.6%', '3.5%')], now);
  assert.equal(m.updated, 0);
  assert.equal(store['USD|CPI y/y|' + T0].a, '3.7%');

  const feed = cal.fromFeed({ country: 'GBP', title: 'CPI y/y', date: new Date((T0 + 7 * 86400) * 1000).toISOString(), impact: 'High', forecast: '3.4%', previous: '3.1%' });
  cal.merge(store, [feed], now);
  assert.equal(Object.values(store).filter(function (e) { return e.src === 'feed'; }).length, 1);
  cal.merge(store, [ev('GBP', 'CPI y/y', T0 + 7 * 86400 + 3600, '', '3.4%', '3.1%')], now);
  assert.equal(Object.values(store).filter(function (e) { return e.src === 'feed'; }).length, 0);

  // very old rows are pruned
  cal.merge(store, [ev('EUR', 'CPI y/y', T0 - 500 * 86400, '1%', '1%', '1%')], now);
  assert.equal(Object.values(store).filter(function (e) { return e.c === 'EUR'; }).length, 0);
});

test('releaseMove measures the currency move over the London release day', function () {
  // EUR/USD and USD/JPY daily prices; the label for day D is about the previous close, so D's move = c[D+1]/c[D] - 1.
  const d = [], eu = [], uj = [];
  for (let i = 0; i < 80; i++) {
    d.push(new Date(Date.UTC(2026, 6, 1) + i * 86400000).toISOString().slice(0, 10));
    eu.push(1.10); uj.push(150);
  }
  const k = d.indexOf('2026-08-20');
  eu[k + 1] = 1.10 * 0.99; // EUR/USD -1% over the day => USD +1%
  uj[k + 1] = 150 * 1.01;  // USD/JPY +1% => USD +1%
  for (let i = k + 2; i < 80; i++) { eu[i] = eu[k + 1]; uj[i] = uj[k + 1]; }
  const store = { 'EUR/USD': { d: d, c: eu }, 'USD/JPY': { d: d, c: uj } };
  const r = macro.releaseMove(store, 'USD', Date.UTC(2026, 7, 20, 12, 30) / 1000);
  assert.equal(r[0], 1);
  assert.equal(r[1], 0);
  assert.equal(macro.releaseMove(store, 'XYZ', T0), null);
});

test('buildMacro gives indicators, surprise scores, rate moves and upcoming events with history', function () {
  const events = [];
  for (let m = 0; m < 4; m++) {
    const t = T0 - (3 - m) * 30 * 86400;
    events.push(ev('USD', 'CPI y/y', t, (3.4 + m * 0.1).toFixed(1) + '%', '3.5%', '3.3%', m % 2 ? 1 : 2));
  }
  events.push(ev('USD', 'Federal Funds Rate', T0 - 20 * 86400, '4.00%', '4.00%', '3.75%', 0));
  events.push(ev('USD', 'CPI y/y', T0 + 5 * 86400, '', '3.8%', '3.7%', 0));
  events.push(ev('USD', 'Federal Funds Rate', T0 + 10 * 86400, '', '4.25%', '4.00%', 0));
  events.push(ev('USD', 'Some low event', T0 + 2 * 86400, '', '', '', 0, 'l'));

  const out = macro.buildMacro({ events: events, priceStore: {}, now: new Date(T0 * 1000 + 3600000) });
  const usd = out.ccy.USD;
  const cpi = usd.inds.find(function (i) { return i.kind === 'infl'; });
  assert.equal(cpi.rows.length, 4);
  assert.equal(cpi.rows[3][1], '3.7%');
  assert.deepEqual(cpi.next, [T0 + 5 * 86400, '3.8%', '3.7%']);
  assert.equal(usd.rate.v, 4);
  assert.deepEqual(usd.rate.moves, [[T0 - 20 * 86400, 0.25]]);
  assert.equal(usd.rate.next, T0 + 10 * 86400);
  assert.equal(usd.s30.n, 2); // the CPI beat plus the in-line rate decision
  assert.equal(usd.s30.v, 50);

  assert.equal(out.upcoming.length, 2); // low impact left out
  assert.equal(out.upcoming[0][3], 'CPI y/y');
  assert.equal(out.upcoming[0][6].length, 4);
  assert.equal(out.ccy.EUR.inds.length, 0);
});
