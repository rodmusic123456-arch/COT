'use strict';

/*
 * Turns stored COT and price data into the files the dashboard reads:
 *   docs/data.json      dashboard payload (same shape the Apps Script web app served)
 *   docs/backtest.json  backtest observations for the Research page
 *   docs/stamp.json     tiny file the page polls to detect new data
 */

const path = require('path');
const cfg = require('./config');
const E = require('./engine');
const cot = require('./cot');
const prices = require('./prices');
const { writeJSON, localKey } = require('./util');

/* ---------- table rows -> objects (empty cells dropped, dates as yyyy-MM-dd) ---------- */

function plain(x) {
  if (x instanceof Date) return localKey(x);
  return x;
}

function toObjects(headers, rows) {
  return rows.map(function (row) {
    const o = {};
    headers.forEach(function (h, i) {
      const v = plain(row[i]);
      if (v === '' || v === null || v === undefined) return;
      o[h] = v;
    });
    return o;
  });
}

/* ---------- backtest observations (same procedure as runCOTBacktest) ---------- */

function buildBacktest(histories, priceSeries) {
  const pairsWithPrices = E.PAIR_LIST.filter(function (p) { return Boolean(priceSeries[p[0]]); });
  const pairsMissing = E.PAIR_LIST.filter(function (p) { return !priceSeries[p[0]]; }).map(function (p) { return p[0]; });

  if (pairsWithPrices.length === 0) return null;

  const instruments = Object.keys(histories);
  const metricsByKey = {};

  instruments.forEach(function (name) {
    const data = histories[name];
    metricsByKey[name] = {};
    for (let i = E.BACKTEST_WARMUP_WEEKS; i < data.length; i++) {
      metricsByKey[name][data[i].dateKey] = E.computeCOTMetricsAt(data, i);
    }
  });

  const weekKeys = Object.keys(metricsByKey[instruments[0]]).filter(function (k) {
    return instruments.every(function (n) { return metricsByKey[n][k] !== undefined; });
  }).sort();

  if (weekKeys.length === 0) return null;

  const rows = [];

  weekKeys.forEach(function (weekKey, weekIdx) {
    const releaseDay = E.cotDayNumber(weekKey) + 3;

    pairsWithPrices.forEach(function (pair) {
      const baseKey = pair[1] === 'USD' ? 'Dollar Index' : pair[1];
      const quoteKey = pair[2] === 'USD' ? 'Dollar Index' : pair[2];

      const result = E.scoreCOTPair(
        E.backtestComponent(metricsByKey[baseKey][weekKey]),
        E.backtestComponent(metricsByKey[quoteKey][weekKey])
      );

      const series = priceSeries[pair[0]];
      const entryIndex = E.firstIndexAfter(series.days, releaseDay);

      if (entryIndex >= series.days.length) return;
      if (series.days[entryIndex] - releaseDay > E.BACKTEST_ENTRY_MAX_GAP_DAYS) return;

      const ret = {};
      E.BACKTEST_HORIZONS.forEach(function (h) { ret[h] = E.backtestForwardReturn(series, entryIndex, h); });

      const r = function (v, d) { return v === null || v === undefined ? '' : E.cotRound(v, d); };

      rows.push({
        week: weekKey,
        pair: pair[0],
        score: E.cotRound(result.relativeScore, 1),
        bias: result.bias,
        pos: E.cotRound(result.positioningDivergence, 1),
        mom: E.cotRound(result.momentumDivergence, 1),
        acc: E.cotRound(result.accelerationDivergence, 1),
        entry: E.cotDayToKey(series.days[entryIndex]),
        r1: r(ret[1], 3),
        r2: r(ret[2], 3),
        r4: r(ret[4], 3),
        idx: weekIdx
      });
    });
  });

  const w = E.PAIR_WEIGHTS;

  const notes = [
    'Model: weights positioning ' + w.positioning + ' / momentum ' + w.momentum + ' / acceleration ' + w.acceleration +
      ', bias threshold +/-' + E.PAIR_BIAS_THRESHOLD + ', acceleration cap ' + E.PAIR_ACCELERATION_CAP +
      ' sigma, warm-up ' + E.BACKTEST_WARMUP_WEEKS + ' weeks.',
    'Signals from ' + weekKeys[0] + ' to ' + weekKeys[weekKeys.length - 1] + ' (' + weekKeys.length + ' weeks), ' +
      rows.length + ' observations, ' + pairsWithPrices.length + ' of ' + E.PAIR_LIST.length + ' pairs with prices.',
    'Entry: first close after the Friday release (COT date + 3 days). Exit: last close on or before entry + 1, 2 or 4 weeks.',
    'Returns are % price changes. Directional return: positive means the signal worked (Bearish signals are sign flipped). ' +
      'Hit % = share of directional signals with a positive result.',
    't-stats treat observations as independent. Overlapping 2W/4W windows and shared currency legs overstate significance, ' +
      'so rely on the non-overlap columns and treat |t| below 3 with caution.'
  ];

  if (pairsMissing.length) notes.push('Pairs without price data: ' + pairsMissing.join(', '));

  return { rows: rows, notes: notes };
}

/* ---------- self-checks (the Apps Script validator's arithmetic checks) ---------- */

function validate(out) {
  const col = {};
  out.headers.forEach(function (h, i) { col[h] = i; });

  let checks = 0;
  const problems = [];

  out.rows.forEach(function (r) {
    if (r[col['Kind']] !== 'Pair') return;

    const score = Number(r[col['Score']]);
    const base = Number(r[col['Base Strength']]);
    const quote = Number(r[col['Quote Strength']]);

    if (!isFinite(score) || !isFinite(base) || !isFinite(quote)) return;

    checks++;

    // Strength values are rounded to 1 decimal, so allow 0.1.
    if (Math.abs(score - (base - quote) / 2) > 0.1) {
      problems.push(r[col['Item']] + ' ' + r[col['Timeframe']] + ': score ' + score + ' vs (base - quote)/2 = ' + (base - quote) / 2);
    }
  });

  out.rows.forEach(function (r) {
    r.forEach(function (v) {
      if (typeof v === 'number' && !isFinite(v)) problems.push('non-finite number in ' + r[col['Item']]);
    });
  });

  return { checks: checks, problems: problems };
}

/* ---------- main ---------- */

function build(opts) {
  opts = opts || {};
  const now = opts.now || new Date();
  const isoNow = now.toISOString();

  const histories = cot.loadHistories();

  let priceSeries = {};
  let priceNote = '';

  try {
    priceSeries = prices.loadPrices();
    if (Object.keys(priceSeries).length === 0) priceNote = 'No price data yet.';
  } catch (e) {
    priceNote = e.message;
  }

  const out = E.cotDashCompute(histories, priceSeries, now, isoNow);

  const st = E.cotDashStatus(out.meta.cotKey, out.meta.priceKey, out.meta.laggingInstruments, out.meta.pairsWithoutPrice, now);

  const check = validate(out);
  const backtest = buildBacktest(histories, priceSeries);

  const status = {
    'COT DATE': String(out.meta.cotKey || ''),
    'PRICE DATE': String(out.meta.priceKey || ''),
    'LAST UPDATED': isoNow,
    'DATA STATUS': st.dataStatus,
    'COT STATUS': st.cotStatus,
    'PRICE STATUS': st.priceStatus,
    'DAYS SINCE COT': String(st.daysSince),
    'MISSING INSTRUMENTS': String(out.meta.laggingInstruments),
    'PAIRS WITHOUT PRICE': String(out.meta.pairsWithoutPrice),
    'PRICE NOTE': [priceNote, opts.priceReport || ''].filter(String).join(' | '),
    'WEEKS OF HISTORY': String(out.meta.weeks),
    'NEUTRAL THRESHOLD': String(E.PAIR_BIAS_THRESHOLD),
    'STRONG THRESHOLD': String(E.COT_DASH_STRONG),
    'VALIDATION': check.problems.length ? check.problems.length + ' problem(s): ' + check.problems.slice(0, 3).join('; ') : check.checks + ' checks passed',
    'ENGINE VERSION': E.COT_DASH_VERSION,
    'LAST ERROR': opts.lastError || ''
  };

  const hist = {};

  out.history.forEach(function (row) {
    const key = row[1] + '|' + row[2];
    (hist[key] = hist[key] || []).push([plain(row[0]), row[3], row[4], row[5], row[6], row[7]]);
  });

  const stamp = status['LAST UPDATED'] + '|' + status['COT DATE'];

  const payload = {
    cfg: {
      neutral: E.PAIR_BIAS_THRESHOLD,
      strong: E.COT_DASH_STRONG,
      tfs: E.COT_DASH_TIMEFRAMES.map(function (t) { return t.key; }),
      weights: E.PAIR_WEIGHTS
    },
    status: status,
    live: st,
    data: toObjects(out.headers, out.rows),
    changes: toObjects(['Item', 'Kind', 'Metric', 'Previous', 'Current', 'Change', 'Unit', 'Magnitude', 'Display'], out.changes),
    watch: toObjects(['Item', 'Kind', 'Score', 'Direction', 'Reasons', 'Reason Count', 'Primary Reason'], out.watch),
    hist: hist,
    hasBacktest: !!backtest,
    stamp: stamp,
    serverTime: isoNow
  };


  if (opts.write !== false) {
    writeJSON(path.join(cfg.DOCS_DIR, 'data.json'), payload);
    writeJSON(path.join(cfg.DOCS_DIR, 'stamp.json'), { stamp: stamp });
    if (backtest) writeJSON(path.join(cfg.DOCS_DIR, 'backtest.json'), backtest);
  }

  return { payload: payload, backtest: backtest, check: check };
}

module.exports = { build, buildBacktest, validate, toObjects };
