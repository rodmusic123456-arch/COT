'use strict';

/*
 * Macro layer: turns the recorded calendar (data/calendar.json), stored prices, US yields and the
 * written notes (data/macro_notes.json) into docs/macro.json for the dashboard's Macro & News page.
 */

const path = require('path');
const cfg = require('./config');
const { readJSON, writeJSON, fetchRetry } = require('./util');

const YIELDS_FILE = path.join(cfg.DATA_DIR, 'yields.json');
const NOTES_FILE = path.join(cfg.DATA_DIR, 'macro_notes.json');

// Key indicators per economy: label, calendar release names (newest match wins), kind.
const INDICATORS = {
  USD: [['Policy rate', ['Federal Funds Rate'], 'rate'], ['Inflation (CPI y/y)', ['CPI y/y'], 'infl'], ['Core inflation', ['Core CPI y/y'], 'infl'],
    ['Growth (GDP q/q, annualised)', ['Advance GDP q/q', 'Prelim GDP q/q', 'Final GDP q/q'], 'growth'], ['Jobs added (payrolls)', ['Non-Farm Employment Change'], 'jobs'],
    ['Unemployment rate', ['Unemployment Rate'], 'unemp'], ['Retail sales m/m', ['Retail Sales m/m'], 'spend'], ['Business: ISM services', ['ISM Services PMI'], 'biz'],
    ['Business: ISM manufacturing', ['ISM Manufacturing PMI'], 'biz'], ['Consumer sentiment', ['Prelim UoM Consumer Sentiment', 'Revised UoM Consumer Sentiment'], 'mood'], ['Trade balance', ['Trade Balance'], 'trade']],
  EUR: [['Policy rate (refinancing)', ['Main Refinancing Rate'], 'rate'], ['Inflation (CPI y/y)', ['CPI Flash Estimate y/y'], 'infl'], ['Core inflation', ['Core CPI Flash Estimate y/y'], 'infl'],
    ['Growth (GDP q/q)', ['Prelim Flash GDP q/q', 'Flash GDP q/q', 'Revised GDP q/q'], 'growth'], ['Unemployment rate', ['Unemployment Rate'], 'unemp'], ['Retail sales m/m', ['Retail Sales m/m'], 'spend'],
    ['Business: services PMI', ['Flash Services PMI'], 'biz'], ['Business: manufacturing PMI', ['Flash Manufacturing PMI'], 'biz'], ['Consumer confidence', ['Consumer Confidence'], 'mood'],
    ['Investor mood (ZEW)', ['ZEW Economic Sentiment'], 'mood'], ['Trade balance', ['Trade Balance'], 'trade']],
  GBP: [['Policy rate', ['Official Bank Rate'], 'rate'], ['Inflation (CPI y/y)', ['CPI y/y'], 'infl'], ['Core inflation', ['Core CPI y/y'], 'infl'], ['Growth (GDP m/m)', ['GDP m/m'], 'growth'],
    ['Unemployment rate', ['Unemployment Rate'], 'unemp'], ['Pay growth', ['Average Earnings Index 3m/y'], 'infl'], ['Retail sales m/m', ['Retail Sales m/m'], 'spend'],
    ['Business: services PMI', ['Flash Services PMI'], 'biz'], ['Business: manufacturing PMI', ['Flash Manufacturing PMI'], 'biz'], ['Consumer confidence', ['GfK Consumer Confidence'], 'mood'], ['Goods trade balance', ['Goods Trade Balance'], 'trade']],
  JPY: [['Policy rate', ['BOJ Policy Rate'], 'rate'], ['Inflation (national core)', ['National Core CPI y/y'], 'infl'], ['Inflation (Tokyo core, early read)', ['Tokyo Core CPI y/y'], 'infl'],
    ['Growth (GDP q/q)', ['Prelim GDP q/q', 'Final GDP q/q'], 'growth'], ['Unemployment rate', ['Unemployment Rate'], 'unemp'], ['Pay growth', ['Average Cash Earnings y/y'], 'infl'],
    ['Household spending y/y', ['Household Spending y/y'], 'spend'], ['Retail sales y/y', ['Retail Sales y/y'], 'spend'], ['Business: Tankan manufacturing', ['Tankan Manufacturing Index'], 'biz'],
    ['Consumer confidence', ['Consumer Confidence'], 'mood'], ['Trade balance', ['Trade Balance'], 'trade']],
  CAD: [['Policy rate', ['Overnight Rate'], 'rate'], ['Inflation (CPI m/m)', ['CPI m/m'], 'infl'], ['Core inflation (median y/y)', ['Median CPI y/y'], 'infl'], ['Core inflation (trimmed y/y)', ['Trimmed CPI y/y'], 'infl'],
    ['Growth (GDP m/m)', ['GDP m/m'], 'growth'], ['Jobs added', ['Employment Change'], 'jobs'], ['Unemployment rate', ['Unemployment Rate'], 'unemp'], ['Retail sales m/m', ['Retail Sales m/m'], 'spend'],
    ['Business: Ivey PMI', ['Ivey PMI'], 'biz'], ['Trade balance', ['Trade Balance'], 'trade']],
  AUD: [['Policy rate', ['Cash Rate'], 'rate'], ['Inflation (CPI y/y)', ['CPI y/y'], 'infl'], ['Core inflation (trimmed mean m/m)', ['Trimmed Mean CPI m/m'], 'infl'], ['Growth (GDP q/q)', ['GDP q/q'], 'growth'],
    ['Jobs added', ['Employment Change'], 'jobs'], ['Unemployment rate', ['Unemployment Rate'], 'unemp'], ['Pay growth (q/q)', ['Wage Price Index q/q'], 'infl'], ['Household spending m/m', ['Household Spending m/m'], 'spend'],
    ['Business confidence (NAB)', ['NAB Business Confidence'], 'biz'], ['Consumer sentiment (Westpac)', ['Westpac Consumer Sentiment'], 'mood'], ['Inflation expectations', ['MI Inflation Expectations'], 'infl'], ['Goods trade balance', ['Goods Trade Balance'], 'trade']],
  NZD: [['Policy rate', ['Official Cash Rate'], 'rate'], ['Inflation (CPI q/q)', ['CPI q/q'], 'infl'], ['Growth (GDP q/q)', ['GDP q/q'], 'growth'], ['Unemployment rate', ['Unemployment Rate'], 'unemp'],
    ['Jobs (q/q)', ['Employment Change q/q'], 'jobs'], ['Retail sales q/q', ['Retail Sales q/q'], 'spend'], ['Card spending y/y', ['Credit Card Spending y/y'], 'spend'], ['Business confidence (ANZ)', ['ANZ Business Confidence'], 'biz'],
    ['Inflation expectations', ['Inflation Expectations q/q'], 'infl'], ['Trade balance', ['Trade Balance'], 'trade']],
  CHF: [['Policy rate', ['SNB Policy Rate'], 'rate'], ['Inflation (CPI m/m)', ['CPI m/m'], 'infl'], ['Growth (GDP q/q)', ['GDP q/q'], 'growth'], ['Unemployment rate', ['Unemployment Rate'], 'unemp'],
    ['Retail sales y/y', ['Retail Sales y/y'], 'spend'], ['Business: manufacturing PMI', ['Manufacturing PMI'], 'biz']],
  CNY: [['Lending rate (1-year)', ['1-y Loan Prime Rate'], 'rate'], ['Inflation (CPI y/y)', ['CPI y/y'], 'infl'], ['Growth (GDP y/y)', ['GDP q/y'], 'growth'], ['Retail sales y/y', ['Retail Sales y/y'], 'spend'],
    ['Factories (official PMI)', ['Manufacturing PMI'], 'biz'], ['Services (official PMI)', ['Non-Manufacturing PMI'], 'biz'], ['Unemployment rate', ['Unemployment Rate'], 'unemp'], ['Trade surplus (USD bn)', ['USD-Denominated Trade Balance'], 'trade']]
};

const RATE_EVENT = /^(Federal Funds Rate|Main Refinancing Rate|Official Bank Rate|BOJ Policy Rate|Overnight Rate|Cash Rate|Official Cash Rate|SNB Policy Rate|1-y Loan Prime Rate)$/;

// How each currency's own move is measured on a release day: [pair, sign], averaged.
const MOVE_LEGS = {
  USD: [['EUR/USD', -1], ['USD/JPY', 1]], EUR: [['EUR/USD', 1], ['EUR/GBP', 1]], GBP: [['GBP/USD', 1], ['EUR/GBP', -1]],
  JPY: [['USD/JPY', -1], ['EUR/JPY', -1]], CAD: [['USD/CAD', -1], ['EUR/CAD', -1]], AUD: [['AUD/USD', 1], ['EUR/AUD', -1]],
  NZD: [['NZD/USD', 1], ['AUD/NZD', -1]], CHF: [['USD/CHF', -1], ['EUR/CHF', -1]]
};

const num = function (s) {
  if (s === undefined || s === null || s === '') return null;
  const m = String(s).replace(/[<>,]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? +m[0] : null;
};

const londonParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
function londonDay(t) {
  const p = {};
  londonParts.formatToParts(new Date(t * 1000)).forEach(function (x) { p[x.type] = x.value; });
  return { key: p.year + '-' + p.month + '-' + p.day, hour: +p.hour };
}

// Move of a currency over the UK day of a release (late-evening releases count from the next day).
// The stored forex "close" for a date is the price at London midnight starting that day, so the move
// over day D is price[next day] / price[D] - 1.
function releaseMove(store, ccy, t) {
  const legs = MOVE_LEGS[ccy];
  if (!legs) return null;
  const ld = londonDay(t);
  const moves = [], typ = [];
  legs.forEach(function (leg) {
    const s = store[leg[0]];
    if (!s || !s.d) return;
    let i = s.d.findIndex(function (d) { return ld.hour >= 21 ? d > ld.key : d >= ld.key; });
    if (i < 1 || i + 1 >= s.d.length) return;
    moves.push(leg[1] * (s.c[i + 1] / s.c[i] - 1) * 100);
    let sum = 0, n = 0;
    for (let k = Math.max(1, i - 60); k < i; k++) { sum += Math.abs(s.c[k] / s.c[k - 1] - 1) * 100; n++; }
    if (n) typ.push(sum / n);
  });
  if (!moves.length) return null;
  const avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
  return [+avg(moves).toFixed(2), typ.length ? +avg(typ).toFixed(2) : null];
}

function buildMacro(opts) {
  const events = opts.events || [];
  const now = opts.now ? Math.floor(opts.now.getTime() / 1000) : Math.floor(Date.now() / 1000);
  const prices = opts.priceStore || {};
  const released = events.filter(function (e) { return e.t <= now && e.a; });
  const out = { asOf: new Date(now * 1000).toISOString(), ccy: {}, upcoming: [], yields: opts.yields || {}, notes: opts.notes || {} };

  Object.keys(INDICATORS).forEach(function (c) {
    const inds = INDICATORS[c].map(function (def) {
      const names = def[1];
      const rows = released.filter(function (e) { return e.c === c && names.indexOf(e.n) >= 0; }).slice(-7);
      const next = events.find(function (e) { return e.c === c && names.indexOf(e.n) >= 0 && e.t > now; });
      return { label: def[0], kind: def[2], rows: rows.map(function (e) { return [e.t, e.a, e.f, e.p, e.bw, e.n]; }), next: next ? [next.t, next.f, next.p] : null };
    }).filter(function (i) { return i.rows.length; });

    const weights = { h: 3, m: 2, l: 1 };
    const surprise = function (days) {
      let score = 0, total = 0, n = 0;
      released.forEach(function (e) {
        if (e.c !== c || e.t <= now - days * 86400 || !e.f || [0, 1, 2].indexOf(e.bw) < 0) return;
        const w = weights[e.imp] || 1;
        total += w; n++;
        if (e.bw === 1) score += w;
        if (e.bw === 2) score -= w;
      });
      return { v: total ? Math.round(score / total * 100) : null, n: n };
    };

    const rateRows = released.filter(function (e) { return e.c === c && RATE_EVENT.test(e.n); });
    const lastRate = rateRows.length ? rateRows[rateRows.length - 1] : null;
    const moves = rateRows.filter(function (e) { return num(e.a) !== null && num(e.p) !== null && num(e.a) !== num(e.p); })
      .map(function (e) { return [e.t, +(num(e.a) - num(e.p)).toFixed(2)]; });
    const nextRate = events.find(function (e) { return e.c === c && RATE_EVENT.test(e.n) && e.t > now; });

    out.ccy[c] = {
      inds: inds, s30: surprise(30), s90: surprise(90),
      recent: released.filter(function (e) { return e.c === c && e.t > now - 45 * 86400 && e.f && (e.imp === 'h' || e.imp === 'm') && (e.bw === 1 || e.bw === 2); })
        .slice(-6).map(function (e) { return [e.t, e.n, e.a, e.f, e.bw]; }),
      rate: lastRate ? { v: num(lastRate.a), t: lastRate.t, moves: moves, next: nextRate ? nextRate.t : null } : null
    };
  });

  events.filter(function (e) { return e.t > now && e.t < now + 14 * 86400 && (e.imp === 'h' || e.imp === 'm'); }).forEach(function (e) {
    const hist = released.filter(function (x) { return x.c === e.c && x.n === e.n; }).slice(-6).map(function (x) {
      const mv = e.imp === 'h' ? releaseMove(prices, x.c, x.t) : null;
      return [x.t, x.a, x.f, x.bw, mv ? mv[0] : null, mv ? mv[1] : null];
    });
    out.upcoming.push([e.t, e.c, e.imp, e.n, e.f, e.p, hist]);
  });

  out.calendarFrom = events.length ? events[0].t : null;
  out.releaseCount = released.length;
  return out;
}

// US Treasury yields from FRED (2-year, 10-year, 10-year after inflation). Light: three small files.
async function updateYields(log) {
  log = log || function () {};
  const out = readJSON(YIELDS_FILE, {});
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const series = { us2: 'DGS2', us10: 'DGS10', real10: 'DFII10' };
  const errors = [];
  for (const key of Object.keys(series)) {
    try {
      const res = await fetchRetry('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + series[key] + '&cosd=' + since, {}, 2);
      if (res.status !== 200) throw new Error('HTTP ' + res.status);
      const rows = (await res.text()).trim().split(/\r?\n/).slice(1).map(function (l) { return l.split(','); })
        .filter(function (r) { return r[1] && r[1] !== '.' && isFinite(+r[1]); }).map(function (r) { return [r[0], +r[1]]; });
      if (rows.length) out[key] = rows;
    } catch (e) { errors.push(key + ': ' + e.message); }
  }
  writeJSON(YIELDS_FILE, out);
  log('Yields: ' + (errors.length ? 'some failed - ' + errors.join('; ') : 'updated'));
  return { errors: errors };
}

function loadYields() {
  const y = readJSON(YIELDS_FILE, {});
  const thin = function (a) { return (a || []).filter(function (x, i, arr) { return i % 5 === 0 || i === arr.length - 1; }).slice(-28); };
  const last = function (a) { return a && a.length ? a[a.length - 1] : null; };
  return { us2: last(y.us2), us10: last(y.us10), real10: last(y.real10), us10s: thin(y.us10), real10s: thin(y.real10) };
}

function loadNotes() { return readJSON(NOTES_FILE, {}); }

module.exports = { buildMacro, updateYields, loadYields, loadNotes, releaseMove, INDICATORS, MOVE_LEGS, YIELDS_FILE, NOTES_FILE };
