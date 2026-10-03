'use strict';

/*
 * Daily closes from Yahoo Finance's chart endpoint.
 * Stored as data/prices.json:  { "EUR/USD": { d: ["2020-12-01", ...], c: [1.19, ...] } }
 * Only completed days are stored (today's partial bar is dropped), and an update that
 * disagrees with what is already stored is refused (guards against a changed symbol or
 * a re-based series).
 */

const path = require('path');
const cfg = require('./config');
const engine = require('./engine');
const { readJSON, writeJSON, fetchRetry, sleep } = require('./util');

const FILE = path.join(cfg.DATA_DIR, 'prices.json');

async function fetchYahoo(symbol, startKey) {
  const period1 = Math.floor(engine.cotDayNumber(startKey) * 86400);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?period1=' + period1 + '&period2=' + period2 + '&interval=1d&events=history';

  const res = await fetchRetry(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cot-dashboard)', Accept: 'application/json' }
  });

  if (res.status !== 200) {
    throw new Error('Yahoo returned HTTP ' + res.status + ' for ' + symbol);
  }

  const json = await res.json();
  const result = json && json.chart && json.chart.result && json.chart.result[0];

  if (!result || !result.timestamp || !result.indicators || !result.indicators.quote || !result.indicators.quote[0]) {
    throw new Error('Yahoo returned no price data for ' + symbol);
  }

  const stamps = result.timestamp;
  const closes = result.indicators.quote[0].close || [];
  const offset = Number(result.meta && result.meta.gmtoffset) || 0;
  const byKey = {};

  for (let i = 0; i < stamps.length; i++) {
    const c = Number(closes[i]);
    if (closes[i] === null || closes[i] === undefined || !isFinite(c) || c <= 0) continue;
    byKey[engine.cotDayToKey(Math.floor((stamps[i] + offset) / 86400))] = c;
  }

  return Object.keys(byKey).sort().map(function (k) { return { d: k, c: byKey[k] }; });
}

// Merge fetched rows into one stored series. Returns { status, added, detail }.
function mergeSeries(series, fetched, tolerance, todayKey) {
  const rows = fetched.filter(function (r) { return r.d < todayKey; });

  if (rows.length === 0) return { status: 'NO DATA', added: 0, detail: 'source returned no completed days' };

  const lastKey = series.d.length ? series.d[series.d.length - 1] : '';

  if (lastKey) {
    const old = {};
    series.d.forEach(function (k, i) { old[k] = series.c[i]; });
    let worst = 0;
    let compared = 0;
    rows.forEach(function (r) {
      if (old[r.d] === undefined) return;
      compared++;
      worst = Math.max(worst, Math.abs(r.c - old[r.d]) / old[r.d]);
    });
    if (compared > 0 && worst > tolerance) {
      return {
        status: 'MISMATCH', added: 0,
        detail: 'new data differs from stored closes by ' + (worst * 100).toFixed(1) + '% (limit ' +
          (tolerance * 100).toFixed(0) + '%). Not updated.'
      };
    }
  }

  const fresh = rows.filter(function (r) { return !lastKey || r.d > lastKey; });

  if (fresh.length === 0) return { status: 'UP TO DATE', added: 0, detail: 'last close ' + lastKey };

  fresh.forEach(function (r) { series.d.push(r.d); series.c.push(r.c); });

  return { status: 'UPDATED', added: fresh.length, detail: fresh[0].d + ' to ' + fresh[fresh.length - 1].d };
}

async function updatePrices(log) {
  const store = readJSON(FILE, {});
  const todayKey = new Date().toISOString().substring(0, 10);
  const outcomes = [];

  for (const pair of engine.PAIR_LIST) {
    const name = pair[0];
    const symbol = cfg.YAHOO_SYMBOLS[name];
    const series = store[name] || { d: [], c: [] };
    const tolerance = cfg.COMMODITY_PAIRS.indexOf(name) !== -1 ? cfg.PRICE_TOLERANCE_COMMODITY : cfg.PRICE_TOLERANCE_FX;
    let o;

    try {
      const last = series.d.length ? series.d[series.d.length - 1] : null;
      const start = last ? engine.cotDayToKey(engine.cotDayNumber(last) - cfg.PRICE_OVERLAP_DAYS) : cfg.PRICE_START_DATE;
      o = mergeSeries(series, await fetchYahoo(symbol, start), tolerance, todayKey);
    } catch (e) {
      o = { status: 'FAILED', added: 0, detail: e.message };
    }

    store[name] = series;
    o.name = name;
    outcomes.push(o);
    log(name + ': ' + o.status + ' - ' + o.detail);
    await sleep(250);
  }

  writeJSON(FILE, store);

  const problems = outcomes.filter(function (o) {
    return o.status === 'FAILED' || o.status === 'MISMATCH' || o.status === 'NO DATA';
  });

  return {
    added: outcomes.reduce(function (s, o) { return s + o.added; }, 0),
    report: problems.length
      ? 'Price update issues: ' + problems.map(function (o) { return o.name + ' (' + o.status + ': ' + o.detail + ')'; }).join('; ')
      : '',
    problems: problems.length
  };
}

// Stored rows -> { pair: { days, closes } } as the engine expects (blocks under 50 rows are ignored).
function loadPrices() {
  const store = readJSON(FILE, {});
  const out = {};

  Object.keys(store).forEach(function (name) {
    const s = store[name];
    if (!s || !s.d || s.d.length < 50) return;
    out[name] = { days: s.d.map(engine.cotDayNumber), closes: s.c.slice() };
  });

  return out;
}

module.exports = { updatePrices, loadPrices, mergeSeries, fetchYahoo, FILE };
