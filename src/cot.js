'use strict';

/*
 * CFTC legacy futures-only report, non-commercial positions (Socrata dataset 6dca-aqww).
 * Stored as data/cot_history.json:
 *   { "EUR": [ { d: "2021-01-05", oi, long, short, cl, cs }, ... ] }   (oldest first)
 */

const path = require('path');
const cfg = require('./config');
const engine = require('./engine');
const { readJSON, writeJSON, fetchRetry } = require('./util');

const FILE = path.join(cfg.DATA_DIR, 'cot_history.json');

function dayKeyBack(key, days) {
  return engine.cotDayToKey(engine.cotDayNumber(key) - days);
}

async function fetchInstrument(name, code, sinceKey) {
  const params = new URLSearchParams({
    $select: 'report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,' +
      'noncomm_positions_short_all,change_in_noncomm_long_all,change_in_noncomm_short_all',
    $where: "report_date_as_yyyy_mm_dd >= '" + sinceKey + "' AND cftc_contract_market_code = '" + code + "'",
    $order: 'report_date_as_yyyy_mm_dd ASC',
    $limit: '50000'
  });

  const res = await fetchRetry(cfg.CFTC_URL + '?' + params.toString(), { headers: { Accept: 'application/json' } });

  if (res.status !== 200) {
    throw new Error('CFTC API returned HTTP ' + res.status + ' for ' + name);
  }

  const rows = await res.json();

  if (!Array.isArray(rows)) {
    throw new Error('Unexpected CFTC response for ' + name);
  }

  return rows.map(function (r) {
    return {
      d: String(r.report_date_as_yyyy_mm_dd).substring(0, 10),
      oi: Number(r.open_interest_all || 0),
      long: Number(r.noncomm_positions_long_all || 0),
      short: Number(r.noncomm_positions_short_all || 0),
      cl: Number(r.change_in_noncomm_long_all || 0),
      cs: Number(r.change_in_noncomm_short_all || 0)
    };
  });
}

// Download new weeks for every instrument and merge them into the stored file.
// Returns { added, errors }. A failing instrument keeps its stored history.
async function updateCOT(log) {
  const store = readJSON(FILE, {});
  let added = 0;
  const errors = [];

  for (const name of Object.keys(engine.HISTORICAL_INSTRUMENTS)) {
    const code = engine.HISTORICAL_INSTRUMENTS[name].code;
    const have = store[name] || [];
    const last = have.length ? have[have.length - 1].d : null;
    const since = last ? dayKeyBack(last, cfg.COT_OVERLAP_DAYS) : cfg.COT_START_DATE;

    try {
      const fresh = await fetchInstrument(name, code, since);
      const byDate = {};
      have.forEach(function (r) { byDate[r.d] = r; });
      let n = 0;
      fresh.forEach(function (r) {
        if (!byDate[r.d]) n++;
        byDate[r.d] = r;
      });
      store[name] = Object.keys(byDate).sort().map(function (k) { return byDate[k]; });
      added += n;
      log(name + ': ' + n + ' new week(s), latest ' + store[name][store[name].length - 1].d);
    } catch (e) {
      errors.push(name + ': ' + e.message);
      log(name + ': FAILED - ' + e.message);
    }
  }

  writeJSON(FILE, store);
  return { added: added, errors: errors };
}

// Stored rows -> the shape the engine expects (what loadBacktestHistories produced in Sheets).
function loadHistories() {
  const store = readJSON(FILE, null);

  if (!store) {
    throw new Error('data/cot_history.json is missing. Run `npm run update` with internet access first.');
  }

  const out = {};

  Object.keys(engine.HISTORICAL_INSTRUMENTS).forEach(function (name) {
    const rows = store[name] || [];

    if (rows.length <= engine.BACKTEST_WARMUP_WEEKS + 4) {
      throw new Error('Not enough COT history for ' + name + ' (' + rows.length + ' weeks).');
    }

    out[name] = rows.map(function (r) {
      return {
        date: new Date(r.d + 'T12:00:00Z'),
        dateKey: r.d,
        net: r.long - r.short,
        changeLong: r.cl,
        changeShort: r.cs,
        changeNet: r.cl - r.cs
      };
    });
  });

  return out;
}

// Raw report rows for the dashboard's "COT report history" view: the latest `days` days per instrument.
// Shape: { EUR: [[date, long, short, changeLong, changeShort, openInterest], ...] } oldest first.
// The Dollar Index is published under the dashboard's instrument name, USD.
function loadRecentReports(days) {
  const store = readJSON(FILE, {});
  const out = {};

  Object.keys(engine.HISTORICAL_INSTRUMENTS).forEach(function (name) {
    const rows = store[name] || [];
    if (!rows.length) return;
    const from = dayKeyBack(rows[rows.length - 1].d, days);
    out[name === 'Dollar Index' ? 'USD' : name] = rows
      .filter(function (r) { return r.d >= from; })
      .map(function (r) { return [r.d, r.long, r.short, r.cl, r.cs, r.oi]; });
  });

  return out;
}

module.exports = { updateCOT, loadHistories, loadRecentReports, FILE };
