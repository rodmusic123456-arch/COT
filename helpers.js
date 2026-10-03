'use strict';

// Deterministic synthetic data so tests never touch the network or the real data folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

function rng(seed) {
  return function () {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function setupTempDirs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cot-test-'));
  process.env.COT_DATA_DIR = path.join(dir, 'data');
  process.env.COT_DOCS_DIR = path.join(dir, 'docs');
  fs.mkdirSync(process.env.COT_DATA_DIR, { recursive: true });
  fs.mkdirSync(process.env.COT_DOCS_DIR, { recursive: true });
  return dir;
}

function dayKey(dayNumber) {
  return new Date(dayNumber * 86400000).toISOString().substring(0, 10);
}

// weeks of COT history for every instrument; `drop` removes the newest N weeks.
function cotFixture(E, weeks, drop, seed) {
  const r = rng(seed || 7);
  const noise = function () { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) / 0.7071; };
  const start = Date.UTC(2021, 0, 5) / 86400000;
  const store = {};

  Object.keys(E.HISTORICAL_INSTRUMENTS).forEach(function (name) {
    let net = noise() * 20000;
    let pl = 0, ps = 0;
    const rows = [];
    for (let i = 0; i < weeks; i++) {
      net += noise() * 8000;
      const L = Math.round(150000 + net / 2), S = Math.round(150000 - net / 2);
      rows.push({ d: dayKey(start + 7 * i), oi: 400000, long: L, short: S, cl: i ? L - pl : 0, cs: i ? S - ps : 0 });
      pl = L; ps = S;
    }
    store[name] = rows.slice(0, rows.length - (drop || 0));
  });

  return store;
}

function priceFixture(E, untilDay, seed) {
  const r = rng(seed || 3);
  const start = Date.UTC(2020, 11, 1) / 86400000;
  const out = {};

  E.PAIR_LIST.forEach(function (p) {
    let px = 1 + r();
    const d = [], c = [];
    for (let day = start; day <= untilDay; day++) {
      const wd = new Date(day * 86400000).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      px *= Math.exp((r() - 0.5) * 0.01);
      d.push(dayKey(day)); c.push(px);
    }
    out[p[0]] = { d: d, c: c };
  });

  return out;
}

module.exports = { setupTempDirs, cotFixture, priceFixture, rng, dayKey };
