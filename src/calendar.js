'use strict';

/*
 * Economic calendar recorder.
 *
 * Each run reads three weekly pages of the ForexFactory calendar (last week, this week, next week),
 * which carry every release's actual / forecast / previous figures, and merges them into
 * data/calendar.json. Over time this builds the release history the macro pages use.
 * Reads are deliberately light: three pages per run, four seconds apart, with a short retry.
 * If this week's page is refused, the official free JSON feed fills in the upcoming events
 * (forecasts only, no results), and the page will be tried again on the next run.
 */

const path = require('path');
const vm = require('vm');
const cfg = require('./config');
const { readJSON, writeJSON, sleep } = require('./util');

const FILE = path.join(cfg.DATA_DIR, 'calendar.json');
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];
const KEEP_DAYS = 400;
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml'
};

// Week key the calendar uses, e.g. "oct18.2026" for the week starting Sunday 18 Oct 2026.
function weekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - date.getUTCDay()));
  return MON[d.getUTCMonth()] + d.getUTCDate() + '.' + d.getUTCFullYear();
}

// Pull the structured event list out of a calendar page.
function parseWeek(html) {
  const marker = html.indexOf('calendarComponentStates[1] = {');
  if (marker < 0) throw new Error('calendar data not found in page');
  const start = html.indexOf('{', marker);
  let depth = 0, j = start, inStr = false, quote = '';
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const state = vm.runInNewContext('(' + html.slice(start, j + 1) + ')', {}, { timeout: 2000 });
  return (state.days || []).flatMap(function (d) { return d.events || []; });
}

// One stored release: currency, name, time (unix seconds), impact (h/m/l), actual, forecast, previous,
// revised previous, and whether the actual was better (1) or worse (2) than forecast for the currency.
function slim(e) {
  return {
    k: e.currency + '|' + e.name + '|' + e.dateline,
    c: e.currency, n: e.name, t: e.dateline, imp: String(e.impactName || '').charAt(0),
    a: e.actual || '', f: e.forecast || '', p: e.previous || '', r: e.revision || '', bw: e.actualBetterWorse || 0
  };
}

function fromFeed(e) {
  const t = Math.floor(Date.parse(e.date) / 1000);
  return { k: e.country + '|' + e.title + '|' + t, c: e.country, n: e.title, t: t, imp: String(e.impact || '').charAt(0).toLowerCase(),
    a: '', f: e.forecast || '', p: e.previous || '', r: '', bw: 0, src: 'feed' };
}

function keep(e) {
  return CURRENCIES.indexOf(e.c) >= 0 && ['h', 'm', 'l'].indexOf(e.imp) >= 0 && isFinite(e.t);
}

// Merge new rows into the store. A row that already has a result is never blanked by a later read.
function merge(store, rows, now) {
  let added = 0, updated = 0;
  const cutoff = (now || Date.now() / 1000) - KEEP_DAYS * 86400;
  rows.filter(keep).forEach(function (r) {
    const old = store[r.k];
    if (!old) { store[r.k] = r; added++; return; }
    if (old.a && !r.a) return;
    if (JSON.stringify(old) !== JSON.stringify(r)) { store[r.k] = r; updated++; }
  });
  // A feed row is replaced once the page version of the same release arrives.
  Object.keys(store).forEach(function (k) {
    const e = store[k];
    if (e.t < cutoff) { delete store[k]; return; }
    if (e.src === 'feed') {
      const twin = Object.keys(store).find(function (k2) { const x = store[k2]; return x !== e && !x.src && x.c === e.c && x.n === e.n && Math.abs(x.t - e.t) < 6 * 3600; });
      if (twin) delete store[k];
    }
  });
  return { added: added, updated: updated };
}

function load() {
  const raw = readJSON(FILE, { events: [] });
  const store = {};
  (raw.events || []).forEach(function (e) { store[e.k] = e; });
  return store;
}

function save(store) {
  const events = Object.values(store).sort(function (a, b) { return a.t - b.t || (a.k < b.k ? -1 : 1); });
  writeJSON(FILE, { updated: new Date().toISOString(), events: events });
  return events;
}

async function getPage(key) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://www.forexfactory.com/calendar?week=' + key, { headers: PAGE_HEADERS, signal: AbortSignal.timeout(60000) });
      if (res.status === 200) return parseWeek(await res.text());
      if (res.status !== 403 && res.status !== 429 && res.status < 500) throw new Error('HTTP ' + res.status);
      if (attempt === 1) throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (attempt === 1) throw e;
    }
    await sleep(8000);
  }
  return [];
}

async function updateCalendar(log) {
  log = log || function () {};
  const store = load();
  const now = new Date();
  const weeks = [-7, 0, 7].map(function (d) { return weekKey(new Date(now.getTime() + d * 86400000)); });
  const errors = [];
  let added = 0, updated = 0, thisWeekOk = false;

  for (let i = 0; i < weeks.length; i++) {
    try {
      const rows = (await getPage(weeks[i])).map(slim);
      const m = merge(store, rows);
      added += m.added; updated += m.updated;
      if (i === 1) thisWeekOk = true;
      log('Calendar ' + weeks[i] + ': ' + rows.length + ' releases (' + m.added + ' new, ' + m.updated + ' updated)');
    } catch (e) {
      errors.push(weeks[i] + ': ' + e.message);
      log('Calendar ' + weeks[i] + ': FAILED - ' + e.message);
    }
    if (i < weeks.length - 1) await sleep(4000);
  }

  if (!thisWeekOk) {
    try {
      const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { signal: AbortSignal.timeout(30000) });
      const rows = (await res.json()).map(fromFeed);
      const m = merge(store, rows);
      log('Calendar feed fallback: ' + rows.length + ' upcoming releases (' + m.added + ' new)');
    } catch (e) {
      errors.push('feed: ' + e.message);
    }
  }

  const events = save(store);
  return { added: added, updated: updated, errors: errors, total: events.length };
}

function loadEvents() {
  return readJSON(FILE, { events: [] }).events || [];
}

module.exports = { updateCalendar, loadEvents, parseWeek, slim, fromFeed, merge, weekKey, FILE };
