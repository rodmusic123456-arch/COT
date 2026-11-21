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
const WEEKS = 26;

const leg = c => (c === 'USD' ? 'Dollar Index' : c);

// Point-in-time pair scores for the last `weeks` COT reports.
function rebuildCalls(histories, weeks) {
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
    const calls = [];
    E.PAIR_LIST.forEach(function (p) {
      const a = m[leg(p[1])], b = m[leg(p[2])];
      if (!a || !b) return;
      const s = E.scoreCOTPair(E.backtestComponent(a), E.backtestComponent(b)).relativeScore;
      if (isFinite(s) && Math.abs(s) >= E.PAIR_BIAS_THRESHOLD) calls.push([p[0], E.cotRound(s, 1)]);
    });
    out[wk] = calls;
  });
  return out;
}

// Merge freshly computed weeks into the record. Recorded weeks are never changed.
function recordCalls(store, fresh, nowIso) {
  store.weeks = store.weeks || {};
  let added = 0;
  const keys = Object.keys(fresh).sort(), newest = keys[keys.length - 1];
  keys.forEach(function (wk) {
    if (store.weeks[wk]) return;
    // When recording starts, older weeks are rebuilt from history; from then on each week is recorded as it happens.
    store.weeks[wk] = { calls: fresh[wk], recorded: nowIso, rebuilt: !store.started && wk !== newest };
    added++;
  });
  if (!store.started) store.started = nowIso;
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

function buildScorecard(store, priceStore, now) {
  const nowS = Math.floor(now.getTime() / 1000);
  const weeks = Object.keys(store.weeks || {}).sort().slice(-WEEKS);
  const out = { asOf: now.toISOString(), neutral: E.PAIR_BIAS_THRESHOLD, strong: E.COT_DASH_STRONG, started: store.started || null, weeks: [] };
  weeks.forEach(function (wk) {
    const rec = store.weeks[wk];
    const calls = rec.calls.map(function (c) {
      const s = priceStore[c[0]];
      const dir = c[1] > 0 ? 1 : -1;
      if (!s || !s.d || s.d.length < 2) return [c[0], c[1], dir, null, null, null, '', '', 'nodata'];
      const o = outcome(s, wk, nowS);
      const move = o.entry ? E.cotRound((o.exit / o.entry - 1) * 100, 3) : null;
      return [c[0], c[1], dir, o.entry || null, o.exit || null, move, o.entryD || '', o.exitD || '', o.status];
    });
    // All pairs share the same window, so the week is final once any pair is.
    const st = calls.map(c => c[8]);
    const status = st.indexOf('final') >= 0 ? 'final' : st.indexOf('running') >= 0 ? 'running' : 'pending';
    out.weeks.push({ week: wk, release: E.cotDayToKey(E.cotDayNumber(wk) + 3), rebuilt: !!rec.rebuilt, status: status, calls: calls });
  });
  return out;
}

function load() { return readJSON(FILE, { weeks: {} }); }
function save(store) { writeJSON(FILE, store); }

module.exports = { rebuildCalls, recordCalls, buildScorecard, outcome, latest, load, save, FILE, WEEKS };
