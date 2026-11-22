'use strict';

/*
 * Scorecard: how the command centre's weekly calls actually played out.
 *
 * A "call" is a pair whose weekly COT pair score is at or beyond the bias line (+/-PAIR_BIAS_THRESHOLD):
 * bullish = expect the pair to rise, bearish = expect it to fall. "Strong" calls are at or beyond COT_DASH_STRONG.
 *
 * Each COT report (Tuesday positions) is published on Friday. Its calls are tracked over the following
 * trading week: entry = the first stored price after the Friday release (the same entry the Research page uses),
 * exit = the price one week later. While the week is still running, the latest price is used.
 *
 * Calls are recorded in data/calls.json the first time they are seen, so a week's picks never change afterwards,
 * even if the model is adjusted later. Weeks from before recording started are rebuilt with the same rules,
 * using only the data available at the time.
 */

const path = require('path');
const cfg = require('./config');
const E = require('./engine');
const { readJSON, writeJSON } = require('./util');

const FILE = path.join(cfg.DATA_DIR, 'calls.json');
const WEEKS = Infinity; // every week with enough history (COT from 2021, so calls from early 2022)

const leg = c => (c === 'USD' ? 'Dollar Index' : c);

/*
 * Momentum fade (trial list, tracked beside the model's calls; it does not change the model).
 * Research 2022-2026: when the pair's momentum divergence is beyond +/-FADE_MOMENTUM, the price more often moved
 * AGAINST the momentum over the next one to two weeks. So a fade pick trades the opposite way to momentum.
 * FX pairs only (it did not work on oil). Picks are stored as [pair, momentum divergence]; direction = -sign(momentum).
 */
const FADE_MOMENTUM = 40;
const FADE_EXCLUDE = /^(XAU|XAG|WTI|Brent)\//;
const fadeDir = m => (m > 0 ? -1 : 1);

// Point-in-time model calls and fade picks for the last `weeks` COT reports: { week: { calls, fade } }.
function rebuildWeeks(histories, weeks) {
  const names = Object.keys(histories);
  if (!names.length) return {};
  const keys = histories[names[0]].map(r => r.dateKey).filter(k => names.every(n => histories[n].some(r => r.dateKey === k)));
  const out = {};
  keys.slice(-weeks).forEach(function (wk) {
    const m = {};
    names.forEach(function (n) {
      const d = histories[n];
      const i = d.findIndex(r => r.dateKey === wk);
      if (i >= E.BACKTEST_WARMUP_WEEKS) m[n] = E.computeCOTMetricsAt(d, i);
    });
    if (Object.keys(m).length < names.length) return; // not enough history yet for every market
    const calls = [], fade = [];
    E.PAIR_LIST.forEach(function (p) {
      const a = m[leg(p[1])], b = m[leg(p[2])];
      if (!a || !b) return;
      const r = E.scoreCOTPair(E.backtestComponent(a), E.backtestComponent(b));
      const s = r.relativeScore, mo = r.momentumDivergence;
      if (isFinite(s) && Math.abs(s) >= E.PAIR_BIAS_THRESHOLD) calls.push([p[0], E.cotRound(s, 1)]);
      if (isFinite(mo) && Math.abs(mo) > FADE_MOMENTUM && !FADE_EXCLUDE.test(p[0])) fade.push([p[0], E.cotRound(mo, 1)]);
    });
    out[wk] = { calls: calls, fade: fade };
  });
  return out;
}

// Model calls only: { week: [[pair, score], ...] }.
function rebuildCalls(histories, weeks) {
  const w = rebuildWeeks(histories, weeks), out = {};
  Object.keys(w).forEach(k => { out[k] = w[k].calls; });
  return out;
}

// Fade picks: { week: [[pair, momentum], ...] }.
function rebuildFade(histories, weeks) {
  const w = rebuildWeeks(histories, weeks), out = {};
  Object.keys(w).forEach(k => { out[k] = w[k].fade; });
  return out;
}

// Merge freshly computed weeks into the record. Recorded weeks are never changed.
function recordCalls(store, fresh, nowIso) {
  store.weeks = store.weeks || {};
  let added = 0;
  Object.keys(fresh).sort().forEach(function (wk) {
    if (store.weeks[wk]) return;
    // When recording starts, older weeks are rebuilt from history; from then on each week is recorded as it happens.
    store.weeks[wk] = { calls: fresh[wk], recorded: nowIso };
    added++;
  });
  if (!store.started) store.started = nowIso;
  return added;
}

// Same for the fade list. Weeks recorded before the fade list existed get it once (rebuilt with the same
// point-in-time data), then it is never changed.
function recordFade(store, fresh, nowIso) {
  store.weeks = store.weeks || {};
  let added = 0;
  Object.keys(fresh).sort().forEach(function (wk) {
    const rec = store.weeks[wk];
    if (!rec || rec.fade) return;
    rec.fade = fresh[wk];
    rec.fadeRecorded = nowIso;
    added++;
  });
  if (!store.fadeStarted) store.fadeStarted = nowIso;
  return added;
}

// Latest known price: the newest stored close, or the live quote captured at the last update if it is newer.
function latest(s) {
  const lastStored = { p: s.c[s.c.length - 1], t: (E.cotDayNumber(s.d[s.d.length - 1]) + 1) * 86400 };
  if (s.last && s.last.p > 0 && s.last.t > lastStored.t - 86400) return { p: s.last.p, t: s.last.t, live: true };
  return { p: lastStored.p, t: lastStored.t - 86400, live: false, d: s.d[s.d.length - 1] };
}

function outcome(s, wk, nowS) {
  const rel = E.cotDayNumber(wk) + 3;                 // Friday release
  const windowEnd = (E.cotDayNumber(wk) + 10) * 86400 + 21 * 3600; // the following Friday, after the close
  const days = s.d.map(E.cotDayNumber);
  const ei = E.firstIndexAfter(days, rel);
  if (ei >= days.length) return { status: nowS > windowEnd ? 'nodata' : 'pending' };
  if (days[ei] - rel > E.BACKTEST_ENTRY_MAX_GAP_DAYS) return { status: 'nodata' };
  const entry = s.c[ei];
  const target = days[ei] + 7;
  if (days[days.length - 1] >= target) {
    const xi = E.firstIndexAfter(days, target) - 1;
    if (xi > ei) return { status: 'final', entry: entry, exit: s.c[xi], entryD: s.d[ei], exitD: s.d[xi] };
  }
  const L = latest(s);
  // A price series that stopped updating would give a false result: leave the call out instead.
  if (!L.live && E.cotDayNumber(L.d) < Math.min(target, Math.floor(nowS / 86400)) - 4) return { status: 'nodata' };
  return { status: nowS > windowEnd ? 'final' : 'running', entry: entry, exit: L.p, entryD: s.d[ei], exitD: L.live ? new Date(L.t * 1000).toISOString().slice(0, 16) + 'Z' : L.d };
}

const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'];

// High-impact releases inside a week's tracking window (Friday release to the following Friday close).
// bw: 1 = better than forecast for that currency, 2 = worse, 0 = as expected / no forecast.
function weekNews(events, wk) {
  const from = (E.cotDayNumber(wk) + 3) * 86400 + 21 * 3600, to = (E.cotDayNumber(wk) + 10) * 86400 + 21 * 3600;
  return (events || []).filter(e => e.imp === 'h' && CCYS.indexOf(e.c) >= 0 && e.t >= from && e.t < to)
    .map(e => [e.t, e.c, e.n, e.a || '', e.f || '', e.bw || 0]);
}

// Did the week's news favour the call? Better data for the base currency (or worse for the quote) favours a rise.
function newsTilt(pair, dir, news) {
  const p = pair.split('/');
  let t = 0;
  news.forEach(function (n) {
    const v = n[5] === 1 ? 1 : n[5] === 2 ? -1 : 0;
    if (n[1] === p[0]) t += v;
    if (n[1] === p[1]) t -= v;
  });
  return t * dir;
}

// A week counts as recorded live when its calls were saved within six days of the Friday release;
// anything saved later was rebuilt from history (same rules, only the data available at the time).
function isRebuilt(wk, recorded) {
  if (!recorded) return true;
  return Date.parse(recorded) > (E.cotDayNumber(wk) + 3 + 6) * 86400000;
}

function buildScorecard(store, priceStore, now, events) {
  const nowS = Math.floor(now.getTime() / 1000);
  const weeks = Object.keys(store.weeks || {}).sort();
  const out = { asOf: now.toISOString(), neutral: E.PAIR_BIAS_THRESHOLD, strong: E.COT_DASH_STRONG, started: store.started || null,
    fadeMomentum: FADE_MOMENTUM, fadeStarted: store.fadeStarted || null, weeks: [] };
  weeks.forEach(function (wk) {
    const rec = store.weeks[wk];
    const track = function (c, dir) {
      const s = priceStore[c[0]];
      if (!s || !s.d || s.d.length < 2) return [c[0], c[1], dir, null, null, null, '', '', 'nodata'];
      const o = outcome(s, wk, nowS);
      const move = o.entry ? E.cotRound((o.exit / o.entry - 1) * 100, 3) : null;
      return [c[0], c[1], dir, o.entry || null, o.exit || null, move, o.entryD || '', o.exitD || '', o.status];
    };
    const calls = rec.calls.map(c => track(c, c[1] > 0 ? 1 : -1));
    const fade = (rec.fade || []).map(c => track(c, fadeDir(c[1])));
    // All pairs share the same window, so the week is final once any pair is.
    const st = calls.concat(fade).map(c => c[8]);
    const status = st.indexOf('final') >= 0 ? 'final' : st.indexOf('running') >= 0 ? 'running' : 'pending';
    const news = weekNews(events, wk);
    calls.forEach(function (c) { c.push(newsTilt(c[0], c[2], news)); });
    fade.forEach(function (c) { c.push(newsTilt(c[0], c[2], news)); });
    out.weeks.push({ week: wk, release: E.cotDayToKey(E.cotDayNumber(wk) + 3), rebuilt: isRebuilt(wk, rec.recorded), fadeRebuilt: isRebuilt(wk, rec.fadeRecorded), status: status, calls: calls, fade: fade, news: news });
  });
  return out;
}

function load() { return readJSON(FILE, { weeks: {} }); }
function save(store) { writeJSON(FILE, store); }

module.exports = { FADE_MOMENTUM, fadeDir, isRebuilt, weekNews, newsTilt, rebuildWeeks, rebuildCalls, rebuildFade, recordCalls, recordFade, buildScorecard, outcome, latest, load, save, FILE, WEEKS };
