/************************************************************
 * DASHBOARD.GS
 * Dashboard data layer, pipeline and web app server.
 * Needs Code.gs (the corrected engine) and Page.gs in the same
 * project. No HTML file is needed.
 ************************************************************/

/************************************************************
 * FILE 2 of 3 — COT DASHBOARD DATA LAYER + PIPELINE
 *
 * Add as a NEW file ("02_Dashboard_Data"). Needs File 1 and
 * your original engine file in the same project.
 *
 * Reads ONLY the existing engine (COT Historical, COT Prices)
 * and reuses its own functions, so the live methodology is
 * unchanged:
 *   computeCOTMetricsAt, scoreCOTPair, backtestComponent,
 *   scalePairAcceleration, PAIR_LIST, PAIR_WEIGHTS,
 *   PAIR_BIAS_THRESHOLD, loadBacktestHistories,
 *   loadBacktestPrices
 *
 * Sheets written (all safe to delete; they are rebuilt):
 *   COT Dashboard Data      one row per item x timeframe
 *   COT Dashboard Changes   what changed since last COT report
 *   COT Dashboard Watch     markets to watch, with reasons
 *   COT Dashboard History   weekly history for charts
 *   COT Dashboard Status    freshness / quality key-value table
 *   COT Dashboard Validation  cross-check vs Matrix/Scanner
 *
 * The Backtest is NOT run by anything in this file.
 ************************************************************/

const COT_DASH_SHEETS = {
  data: "COT Dashboard Data",
  changes: "COT Dashboard Changes",
  watch: "COT Dashboard Watch",
  history: "COT Dashboard History",
  status: "COT Dashboard Status",
  validation: "COT Dashboard Validation"
};

const COT_DASH_VERSION = "1.0";

// |score| >= PAIR_BIAS_THRESHOLD (20) is a bias zone, >= this is "strong".
const COT_DASH_STRONG = 50;

const COT_DASH_HISTORY_WEEKS = 104;

// A component must contribute at least this many score points
// in the bias direction to count as a confluence condition.
const COT_DASH_CONFLUENCE_MIN = 5;

// Price is "neutral" inside +/- this many standard deviations
// of the typical move over the same horizon.
const COT_DASH_PRICE_BAND_MULT = 0.25;

const COT_DASH_ACCEL_BIG = 2;

const COT_DASH_CHANGE_MIN = {
  netPctl: 8,
  momPctl: 10,
  accel: 0.5,
  score: 10,
  strength: 10
};

const COT_DASH_CCY = ["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "NZD", "USD"];

// weeks = how many weekly COT scores are averaged for that timeframe.
// priceDays = calendar days of price behaviour (0 = last trading day).
const COT_DASH_TIMEFRAMES = [
  { key: "DAILY",     col: "Daily Score",     weeks: 1,  priceDays: 0 },
  { key: "WEEKLY",    col: "Weekly Score",    weeks: 1,  priceDays: 7 },
  { key: "MONTHLY",   col: "Monthly Score",   weeks: 4,  priceDays: 30 },
  { key: "QUARTERLY", col: "Quarterly Score", weeks: 13, priceDays: 91 },
  { key: "6 MONTH",   col: "6M Score",        weeks: 26, priceDays: 182 },
  { key: "ANNUAL",    col: "Annual Score",    weeks: 52, priceDays: 365 }
];

// name = dashboard label, source = key in HISTORICAL_INSTRUMENTS.
const COT_DASH_INSTRUMENTS = [
  { name: "AUD",   source: "AUD",          group: "Currency" },
  { name: "CAD",   source: "CAD",          group: "Currency" },
  { name: "CHF",   source: "CHF",          group: "Currency" },
  { name: "EUR",   source: "EUR",          group: "Currency" },
  { name: "GBP",   source: "GBP",          group: "Currency" },
  { name: "JPY",   source: "JPY",          group: "Currency" },
  { name: "NZD",   source: "NZD",          group: "Currency" },
  { name: "USD",   source: "Dollar Index", group: "Currency" },
  { name: "XAU",   source: "XAU",          group: "Metal" },
  { name: "XAG",   source: "XAG",          group: "Metal" },
  { name: "WTI",   source: "WTI",          group: "Energy" },
  { name: "Brent", source: "Brent",        group: "Energy" }
];

const COT_DASH_COLUMNS = [
  "Kind", "Item", "Group", "Base", "Quote", "Timeframe", "COT Date", "Price Date",
  "Score", "Direction", "Zone", "Pair Bias (Scanner)",
  "Base Strength", "Quote Strength",
  "Positioning Component", "Momentum Component", "Acceleration Component",
  "Positioning Divergence", "Momentum Divergence", "Acceleration Divergence (σ)",
  "Base Net Pctl", "Quote Net Pctl", "Base Mom Pctl", "Quote Mom Pctl", "Momentum Change",
  "Net Position", "Net Percentile", "4W Momentum", "Momentum Percentile", "Normalised Acceleration",
  "Positioning Class", "Extreme", "Reversal",
  "Price Direction", "Price Return %", "COT Price Relationship", "Divergence Type",
  "Daily Score", "Weekly Score", "Monthly Score", "Quarterly Score", "6M Score", "Annual Score",
  "Alignment Count", "Alignment State", "Alignment Description",
  "Previous Score", "Score Change",
  "Confluence Count", "Confluence Total", "Confluence Detail",
  "Bias Since", "Bias Age Weeks", "Extreme Age Weeks",
  "Data Quality", "Last Updated"
];


/************************************************************
 * SMALL PURE HELPERS
 ************************************************************/

function cotDashVal(x, decimals) {

  if (x === null || x === undefined || (typeof x === "number" && isNaN(x))) {
    return "";
  }

  return cotRound(x, decimals);

}


// Mean of the `w` values ending `offset` entries before the last one.
function cotDashWindow(values, offset, w) {

  const end = values.length - 1 - offset;
  const start = end - w + 1;

  if (start < 0 || end < 0) {
    return null;
  }

  let sum = 0;

  for (let i = start; i <= end; i++) {
    sum += values[i];
  }

  return sum / w;

}


// Neutral zone: |score| < PAIR_BIAS_THRESHOLD. Strong: >= COT_DASH_STRONG.
function cotDashDirection(score) {

  if (score === null || score === undefined || isNaN(score)) {
    return { sign: 0, label: "N/A", zone: "N/A" };
  }

  const abs = Math.abs(score);

  if (abs < PAIR_BIAS_THRESHOLD) {
    return { sign: 0, label: "Neutral", zone: "NEUTRAL" };
  }

  const strong = abs >= COT_DASH_STRONG;

  return {
    sign: score > 0 ? 1 : -1,
    label: (strong ? "Strong " : "") + (score > 0 ? "Bullish" : "Bearish"),
    zone: strong ? "STRONG" : "MODERATE"
  };

}


function cotDashPriceLabel(info) {

  if (!info) { return "N/A"; }

  return info.dir > 0 ? "Bullish" : info.dir < 0 ? "Bearish" : "Neutral";

}


// Price direction over the timeframe's horizon, with a volatility-scaled
// neutral band so tiny moves are not called a direction.
function cotDashPriceDirection(series, tf) {

  if (!series) { return null; }

  const days = series.days;
  const closes = series.closes;
  const last = days.length - 1;

  if (last < 30) { return null; }

  let refIdx;

  if (tf.priceDays === 0) {

    refIdx = last - 1;

  } else {

    const target = days[last] - tf.priceDays;

    refIdx = firstIndexAfter(days, target) - 1;

    if (refIdx < 0 || target - days[refIdx] > 6) { return null; }

  }

  if (refIdx < 0 || refIdx >= last) { return null; }

  const ret = (closes[last] / closes[refIdx] - 1) * 100;

  const from = Math.max(1, last - 251);

  const logReturns = [];

  for (let i = from; i <= last; i++) {
    logReturns.push(Math.log(closes[i] / closes[i - 1]) * 100);
  }

  const band = COT_DASH_PRICE_BAND_MULT * cotStdDev(logReturns) * Math.sqrt(last - refIdx);

  return { dir: ret > band ? 1 : ret < -band ? -1 : 0, ret: ret, band: band };

}


function cotDashLastClose(series, day) {

  if (!series) { return null; }

  const i = firstIndexAfter(series.days, day) - 1;

  if (i < 0 || day - series.days[i] > 6) { return null; }

  return series.closes[i];

}


function cotDashRelation(cotSign, scoreOk, info) {

  if (!scoreOk || !info) { return "INSUFFICIENT DATA"; }

  if (cotSign === 0 || info.dir === 0) { return "MIXED"; }

  return cotSign === info.dir ? "ALIGNED" : "DIVERGING";

}


// Alignment uses the five DISTINCT COT windows. DAILY shares the weekly COT
// reading (no daily COT exists), so counting it would double-weight weekly.
function cotDashAlignment(tfScores) {

  const keys = ["WEEKLY", "MONTHLY", "QUARTERLY", "6 MONTH", "ANNUAL"];

  const vals = {};
  let n = 0, bull = 0, bear = 0;

  keys.forEach(function(k) {

    const v = tfScores[k];

    if (v === null || v === undefined || isNaN(v)) { return; }

    vals[k] = v;
    n++;

    if (v >= PAIR_BIAS_THRESHOLD) { bull++; }
    if (v <= -PAIR_BIAS_THRESHOLD) { bear++; }

  });

  if (n < 3) {
    return { count: "N/A", state: "INSUFFICIENT DATA", description: "Not enough timeframes", bull: bull, bear: bear, n: n };
  }

  let state = "MIXED";

  if (bull === n) { state = "ALIGNED BULLISH"; }
  else if (bear === n) { state = "ALIGNED BEARISH"; }
  else if (bull > 0 && bear > 0) { state = "CONFLICTING"; }
  else if (bull >= 3) { state = "MOSTLY BULLISH"; }
  else if (bear >= 3) { state = "MOSTLY BEARISH"; }

  const avg = function(list) {
    const x = list.filter(function(k) { return vals[k] !== undefined; }).map(function(k) { return vals[k]; });
    return x.length ? cotAverage(x) : null;
  };

  const shortTerm = avg(["WEEKLY", "MONTHLY"]);
  const longTerm = avg(["QUARTERLY", "6 MONTH", "ANNUAL"]);

  const t = PAIR_BIAS_THRESHOLD;

  let description = "Mixed across timeframes";

  if (shortTerm !== null && longTerm !== null) {

    if (shortTerm >= t && longTerm >= t) { description = "Broad bullish alignment"; }
    else if (shortTerm <= -t && longTerm <= -t) { description = "Broad bearish alignment"; }
    else if (shortTerm >= t && longTerm <= -t) { description = "Short term bullish against longer term bearish"; }
    else if (shortTerm <= -t && longTerm >= t) { description = "Short term bearish against longer term bullish"; }
    else if (shortTerm >= t) { description = "Short term bullish, longer term mixed"; }
    else if (shortTerm <= -t) { description = "Short term bearish, longer term mixed"; }
    else if (longTerm >= t) { description = "Long term bullish, short term weakening"; }
    else if (longTerm <= -t) { description = "Long term bearish, short term easing"; }

  }

  return {
    count: bull >= bear ? bull + "/" + n + " bullish" : bear + "/" + n + " bearish",
    state: state,
    description: description,
    bull: bull,
    bear: bear,
    n: n
  };

}


function cotDashConfluence(d, posC, momC, accC, priceDir, alignState, extremeSupports) {

  if (!d) {
    return { count: "", total: "", detail: "Neutral zone: no directional conditions" };
  }

  const m = COT_DASH_CONFLUENCE_MIN;

  const supports = function(v) {
    return v === null || v === undefined ? null : v * d >= m;
  };

  const aligned = d > 0
    ? (alignState === "ALIGNED BULLISH" || alignState === "MOSTLY BULLISH")
    : (alignState === "ALIGNED BEARISH" || alignState === "MOSTLY BEARISH");

  const items = [
    { label: "Positioning", ok: supports(posC) },
    { label: "Momentum", ok: supports(momC) },
    { label: "Acceleration", ok: supports(accC) },
    { label: "Price", ok: priceDir === null || priceDir === undefined ? null : priceDir === d },
    { label: "Multi-TF aligned", ok: alignState === "INSUFFICIENT DATA" ? null : aligned },
    { label: "Extreme", ok: extremeSupports }
  ];

  const evaluable = items.filter(function(i) { return i.ok !== null; });

  return {
    count: evaluable.filter(function(i) { return i.ok; }).length,
    total: evaluable.length,
    detail: items.map(function(i) {
      return (i.ok === null ? "– " : i.ok ? "✓ " : "✕ ") + i.label;
    }).join(" | ")
  };

}


// Latest Tuesday whose Friday release date has fully passed.
function cotDashExpectedCOTKey(now) {

  const today = Math.floor(now.getTime() / 86400000);

  let n = today - 4;

  while ((n + 4) % 7 !== 2) {
    n--;
  }

  return cotDayToKey(n);

}


function cotDashStatus(cotKey, priceKey, laggingInstruments, pairsWithoutPrice, now) {

  const today = Math.floor(now.getTime() / 86400000);

  const daysSince = cotKey ? today - cotDayNumber(cotKey) : "";

  const cotStatus = cotKey && cotKey >= cotDashExpectedCOTKey(now) ? "CURRENT" : "AWAITING NEW COT";

  const priceStatus = !priceKey
    ? "PRICE DATA N/A"
    : (today - cotDayNumber(priceKey) > 5 ? "PRICE DATA DELAYED" : "CURRENT");

  let dataStatus = "CURRENT";

  if (laggingInstruments > 0) { dataStatus = "INCOMPLETE"; }
  else if (cotStatus !== "CURRENT") { dataStatus = "AWAITING NEW COT"; }
  else if (priceStatus !== "CURRENT") { dataStatus = priceStatus; }

  return { daysSince: daysSince, cotStatus: cotStatus, priceStatus: priceStatus, dataStatus: dataStatus };

}


/************************************************************
 * CORE COMPUTATION  (pure: no sheet access)
 *
 * POINT IN TIME: every weekly value is produced by the
 * engine's computeCOTMetricsAt(data, i), which only reads
 * data[0..i]. Timeframe scores are averages of those weekly
 * point-in-time scores. No future data is used anywhere.
 ************************************************************/

function cotDashCompute(histories, priceSeries, now, isoNow) {

  const insts = COT_DASH_INSTRUMENTS;
  const tfs = COT_DASH_TIMEFRAMES;

  const wsum =
    PAIR_WEIGHTS.positioning + PAIR_WEIGHTS.momentum + PAIR_WEIGHTS.acceleration;

  /* ---- common weeks across all instruments ---- */

  const idxMaps = {};
  const latestKeys = [];

  insts.forEach(function(inst) {

    const map = {};
    const data = histories[inst.source];

    data.forEach(function(d, i) { map[d.dateKey] = i; });

    idxMaps[inst.name] = map;

    latestKeys.push(data[data.length - 1].dateKey);

  });

  const common = Object.keys(idxMaps[insts[0].name]).filter(function(k) {
    return insts.every(function(inst) {
      const i = idxMaps[inst.name][k];
      return i !== undefined && i >= BACKTEST_WARMUP_WEEKS;
    });
  }).sort();

  if (common.length < 3) {
    throw new Error("Dashboard: not enough common COT weeks across all instruments.");
  }

  const weeks = common.slice(-(COT_DASH_HISTORY_WEEKS + 1));
  const L = weeks.length;
  const lastI = L - 1;

  const newestKey = latestKeys.slice().sort().pop();

  const laggingInstruments = latestKeys.filter(function(k) { return k < newestKey; }).length;

  /* ---- instrument series ---- */

  const I = {};

  insts.forEach(function(inst) {

    const data = histories[inst.source];

    const metrics = weeks.map(function(w) {
      return computeCOTMetricsAt(data, idxMaps[inst.name][w]);
    });

    const strength = [], posC = [], momC = [], accC = [];

    metrics.forEach(function(m) {

      // Strength is on a -100..+100 scale and satisfies
      // pair score = (base strength - quote strength) / 2 exactly.
      const f = 2 / wsum;

      const p = f * PAIR_WEIGHTS.positioning * (m.netPercentile * 100 - 50);
      const mo = f * PAIR_WEIGHTS.momentum * (m.momentumPercentile - 50);
      const a = f * PAIR_WEIGHTS.acceleration * scalePairAcceleration(m.normAcceleration);

      posC.push(p); momC.push(mo); accC.push(a); strength.push(p + mo + a);

    });

    I[inst.name] = { inst: inst, metrics: metrics, strength: strength, posC: posC, momC: momC, accC: accC };

  });

  /* ---- pair series (uses the engine's own scoreCOTPair) ---- */

  const PR = PAIR_LIST.map(function(p) {

    const base = I[p[1]];
    const quote = I[p[2]];

    const score = [], posC = [], momC = [], accC = [], results = [];

    for (let i = 0; i < L; i++) {

      const r = scoreCOTPair(
        backtestComponent(base.metrics[i]),
        backtestComponent(quote.metrics[i])
      );

      results.push(r);
      score.push(r.relativeScore);
      posC.push(r.positioningDivergence * PAIR_WEIGHTS.positioning / wsum);
      momC.push(r.momentumDivergence * PAIR_WEIGHTS.momentum / wsum);
      accC.push(r.accelerationDivergence * PAIR_WEIGHTS.acceleration / wsum);

    }

    const group =
      COT_DASH_CCY.indexOf(p[1]) !== -1 && COT_DASH_CCY.indexOf(p[2]) !== -1
        ? (p[1] === "USD" || p[2] === "USD" ? "FX USD pairs" : "FX crosses")
        : I[p[1]].inst.group;

    return { name: p[0], base: p[1], quote: p[2], group: group, B: base, Q: quote,
             score: score, posC: posC, momC: momC, accC: accC, results: results };

  });

  /* ---- prices ---- */

  const pairPrice = {};
  let maxPriceDay = null;
  let pairsWithoutPrice = 0;

  PR.forEach(function(pr) {

    const series = priceSeries[pr.name];

    pairPrice[pr.name] = {};

    if (!series) { pairsWithoutPrice++; }
    else {
      const d = series.days[series.days.length - 1];
      if (maxPriceDay === null || d > maxPriceDay) { maxPriceDay = d; }
    }

    tfs.forEach(function(tf) {
      pairPrice[pr.name][tf.key] = cotDashPriceDirection(series, tf);
    });

  });

  const priceKey = maxPriceDay === null ? "" : cotDayToKey(maxPriceDay);

  function instPrice(inst, tfKey) {

    if (inst.group !== "Currency") {
      const p = pairPrice[inst.name + "/USD"];
      return p ? p[tfKey] : null;
    }

    let sum = 0, retSum = 0, n = 0;

    PR.forEach(function(pr) {

      if (COT_DASH_CCY.indexOf(pr.base) === -1 || COT_DASH_CCY.indexOf(pr.quote) === -1) { return; }
      if (pr.base !== inst.name && pr.quote !== inst.name) { return; }

      const info = pairPrice[pr.name][tfKey];

      if (!info) { return; }

      const o = pr.base === inst.name ? 1 : -1;

      sum += o * info.dir;
      retSum += o * info.ret;
      n++;

    });

    if (!n) { return null; }

    const avg = sum / n;

    return { dir: avg > 0.25 ? 1 : avg < -0.25 ? -1 : 0, ret: retSum / n };

  }

  const cotKey = weeks[lastI];
  const cotDate = cotNoonDate(cotKey);

  const rows = [];

  const push = function(o) {
    rows.push(COT_DASH_COLUMNS.map(function(c) {
      const v = o[c];
      return v === null || v === undefined ? "" : v;
    }));
  };

  /* ---- signal age helper (weekly resolution only) ---- */

  function streak(values, same) {

    let n = 1;

    for (let i = values.length - 2; i >= 0; i--) {
      if (same(values[i], values[values.length - 1])) { n++; } else { break; }
    }

    return n;

  }

  /* ---- pair rows ---- */

  PR.forEach(function(pr) {

    const bM = pr.B.metrics[lastI];
    const qM = pr.Q.metrics[lastI];
    const res = pr.results[lastI];

    const tfScore = {};
    tfs.forEach(function(tf) { tfScore[tf.key] = cotDashWindow(pr.score, 0, tf.weeks); });

    const align = cotDashAlignment(tfScore);

    const ex = [], rv = [];

    if (bM.extreme !== "No") { ex.push(pr.base + " " + bM.extreme); }
    if (qM.extreme !== "No") { ex.push(pr.quote + " " + qM.extreme); }
    if (bM.reversal !== "No") { rv.push(pr.base + ": " + bM.reversal); }
    if (qM.reversal !== "No") { rv.push(pr.quote + ": " + qM.reversal); }

    const signs = pr.score.map(function(s) { return cotDashDirection(s).sign; });
    const age = streak(signs, function(a, b) { return a === b; });

    const series = priceSeries[pr.name];

    tfs.forEach(function(tf) {

      const score = tfScore[tf.key];
      const prev = cotDashWindow(pr.score, 1, tf.weeks);
      const dir = cotDashDirection(score);
      const info = pairPrice[pr.name][tf.key];
      const posC = cotDashWindow(pr.posC, 0, tf.weeks);
      const momC = cotDashWindow(pr.momC, 0, tf.weeks);
      const accC = cotDashWindow(pr.accC, 0, tf.weeks);
      const rel = cotDashRelation(dir.sign, dir.zone !== "N/A", info);

      const extremeSupports = dir.sign > 0
        ? (bM.extreme === "High" || qM.extreme === "Low")
        : dir.sign < 0
          ? (bM.extreme === "Low" || qM.extreme === "High")
          : false;

      const conf = cotDashConfluence(dir.sign, posC, momC, accC, info ? info.dir : null, align.state, extremeSupports);

      const o = {
        "Kind": "Pair", "Item": pr.name, "Group": pr.group, "Base": pr.base, "Quote": pr.quote,
        "Timeframe": tf.key, "COT Date": cotDate,
        "Price Date": series ? cotNoonDate(cotDayToKey(series.days[series.days.length - 1])) : "",
        "Score": cotDashVal(score, 1), "Direction": dir.label, "Zone": dir.zone,
        "Pair Bias (Scanner)": res.bias,
        "Base Strength": cotDashVal(cotDashWindow(pr.B.strength, 0, tf.weeks), 1),
        "Quote Strength": cotDashVal(cotDashWindow(pr.Q.strength, 0, tf.weeks), 1),
        "Positioning Component": cotDashVal(posC, 1),
        "Momentum Component": cotDashVal(momC, 1),
        "Acceleration Component": cotDashVal(accC, 1),
        "Positioning Divergence": cotDashVal(res.positioningDivergence, 1),
        "Momentum Divergence": cotDashVal(res.momentumDivergence, 1),
        "Acceleration Divergence (σ)": cotDashVal(bM.normAcceleration - qM.normAcceleration, 2),
        "Base Net Pctl": cotDashVal(bM.netPercentile * 100, 1),
        "Quote Net Pctl": cotDashVal(qM.netPercentile * 100, 1),
        "Base Mom Pctl": cotDashVal(bM.momentumPercentile, 1),
        "Quote Mom Pctl": cotDashVal(qM.momentumPercentile, 1),
        "Momentum Change": cotDashVal(res.momentumChangeDivergence, 1),
        "Extreme": ex.length ? ex.join(" | ") : "No",
        "Reversal": rv.length ? rv.join(" | ") : "No",
        "Price Direction": cotDashPriceLabel(info),
        "Price Return %": cotDashVal(info ? info.ret : null, 2),
        "COT Price Relationship": rel,
        "Divergence Type": rel === "DIVERGING"
          ? (dir.sign > 0 ? "COT bullish vs price falling" : "COT bearish vs price rising") : "",
        "Alignment Count": align.count, "Alignment State": align.state, "Alignment Description": align.description,
        "Previous Score": cotDashVal(prev, 1),
        "Score Change": score === null || prev === null ? "" : cotDashVal(score - prev, 1),
        "Confluence Count": conf.count, "Confluence Total": conf.total, "Confluence Detail": conf.detail,
        "Bias Since": cotNoonDate(weeks[L - age]), "Bias Age Weeks": age,
        "Data Quality": (series ? "OK" : "PRICE DATA N/A") + (align.n < 5 ? " / PARTIAL TIMEFRAMES" : ""),
        "Last Updated": isoNow
      };

      tfs.forEach(function(t) { o[t.col] = cotDashVal(tfScore[t.key], 1); });

      push(o);

    });

  });

  /* ---- instrument rows ---- */

  insts.forEach(function(inst) {

    const S = I[inst.name];
    const m = S.metrics[lastI];

    const tfStrength = {};
    tfs.forEach(function(tf) { tfStrength[tf.key] = cotDashWindow(S.strength, 0, tf.weeks); });

    const align = cotDashAlignment(tfStrength);

    const signs = S.strength.map(function(s) { return cotDashDirection(s).sign; });
    const age = streak(signs, function(a, b) { return a === b; });

    const extremes = S.metrics.map(function(x) { return x.extreme; });
    const exAge = m.extreme === "No" ? "" : streak(extremes, function(a, b) { return a === b; });

    const series = inst.group === "Currency" ? null : priceSeries[inst.name + "/USD"];

    tfs.forEach(function(tf) {

      const score = tfStrength[tf.key];
      const prev = cotDashWindow(S.strength, 1, tf.weeks);
      const dir = cotDashDirection(score);
      const info = instPrice(inst, tf.key);
      const posC = cotDashWindow(S.posC, 0, tf.weeks);
      const momC = cotDashWindow(S.momC, 0, tf.weeks);
      const accC = cotDashWindow(S.accC, 0, tf.weeks);
      const rel = cotDashRelation(dir.sign, dir.zone !== "N/A", info);

      const extremeSupports = dir.sign > 0 ? m.extreme === "High" : dir.sign < 0 ? m.extreme === "Low" : false;

      const conf = cotDashConfluence(dir.sign, posC, momC, accC, info ? info.dir : null, align.state, extremeSupports);

      const o = {
        "Kind": "Instrument", "Item": inst.name, "Group": inst.group, "Base": inst.name,
        "Timeframe": tf.key, "COT Date": cotDate,
        "Price Date": series ? cotNoonDate(cotDayToKey(series.days[series.days.length - 1])) : "",
        "Score": cotDashVal(score, 1), "Direction": dir.label, "Zone": dir.zone,
        "Positioning Component": cotDashVal(posC, 1),
        "Momentum Component": cotDashVal(momC, 1),
        "Acceleration Component": cotDashVal(accC, 1),
        "Momentum Change": cotDashVal(m.momentumPctChange, 1),
        "Net Position": m.net,
        "Net Percentile": cotDashVal(m.netPercentile * 100, 1),
        "4W Momentum": cotDashVal(m.momentum, 0),
        "Momentum Percentile": cotDashVal(m.momentumPercentile, 1),
        "Normalised Acceleration": cotDashVal(m.normAcceleration, 2),
        "Positioning Class": m.positioning,
        "Extreme": m.extreme, "Reversal": m.reversal,
        "Price Direction": cotDashPriceLabel(info),
        "Price Return %": cotDashVal(info ? info.ret : null, 2),
        "COT Price Relationship": rel,
        "Divergence Type": rel === "DIVERGING"
          ? (dir.sign > 0 ? "COT bullish vs price falling" : "COT bearish vs price rising") : "",
        "Alignment Count": align.count, "Alignment State": align.state, "Alignment Description": align.description,
        "Previous Score": cotDashVal(prev, 1),
        "Score Change": score === null || prev === null ? "" : cotDashVal(score - prev, 1),
        "Confluence Count": conf.count, "Confluence Total": conf.total, "Confluence Detail": conf.detail,
        "Bias Since": cotNoonDate(weeks[L - age]), "Bias Age Weeks": age, "Extreme Age Weeks": exAge,
        "Data Quality": (info ? "OK" : "PRICE DATA N/A") + (align.n < 5 ? " / PARTIAL TIMEFRAMES" : ""),
        "Last Updated": isoNow
      };

      tfs.forEach(function(t) { o[t.col] = cotDashVal(tfStrength[t.key], 1); });

      push(o);

    });

  });

  /* ---- weekly lookup used by Changes and Watch ---- */

  const wk = {};

  rows.forEach(function(r) {
    const o = {};
    COT_DASH_COLUMNS.forEach(function(c, i) { o[c] = r[i]; });
    if (o["Timeframe"] === "WEEKLY") { wk[o["Kind"] + "|" + o["Item"]] = o; }
  });

  /* ---- what changed since last COT report ---- */

  const changes = [];

  const addChange = function(item, kind, metric, prev, cur, thr, unit, dp) {

    const chg = cur - prev;

    if (Math.abs(chg) < thr) { return; }

    changes.push([
      item, kind, metric, cotRound(prev, dp), cotRound(cur, dp), cotRound(chg, dp), unit,
      cotRound(Math.abs(chg) / thr, 2),
      item + "  " + metric + " " + (chg > 0 ? "+" : "") + cotRound(chg, unit === "σ" ? 1 : 0) + (unit === "σ" ? "σ" : "")
    ]);

  };

  insts.forEach(function(inst) {

    const S = I[inst.name];
    const a = S.metrics[lastI - 1], b = S.metrics[lastI];

    addChange(inst.name, "Instrument", "Positioning", a.netPercentile * 100, b.netPercentile * 100, COT_DASH_CHANGE_MIN.netPctl, "pts", 1);
    addChange(inst.name, "Instrument", "Momentum", a.momentumPercentile, b.momentumPercentile, COT_DASH_CHANGE_MIN.momPctl, "pts", 1);
    addChange(inst.name, "Instrument", "Acceleration", a.normAcceleration, b.normAcceleration, COT_DASH_CHANGE_MIN.accel, "σ", 2);
    addChange(inst.name, "Instrument", "Strength", S.strength[lastI - 1], S.strength[lastI], COT_DASH_CHANGE_MIN.strength, "pts", 1);

  });

  PR.forEach(function(pr) {
    addChange(pr.name, "Pair", "Pair score", pr.score[lastI - 1], pr.score[lastI], COT_DASH_CHANGE_MIN.score, "pts", 1);
  });

  changes.sort(function(a, b) { return b[7] - a[7]; });

  /* ---- markets to watch (descriptive reasons, not trade ideas) ---- */

  const watch = [];

  Object.keys(wk).forEach(function(key) {

    const o = wk[key];
    const reasons = [];

    const sc = Number(o["Score"]);
    const chg = o["Score Change"] === "" ? 0 : Number(o["Score Change"]);

    if (Math.abs(chg) >= COT_DASH_CHANGE_MIN.score) {
      reasons.push("Large score movement (" + (chg > 0 ? "+" : "") + Math.round(chg) + ")");
    }

    if (o["Alignment State"] === "ALIGNED BULLISH" || o["Alignment State"] === "ALIGNED BEARISH") {
      reasons.push("Strong multi timeframe alignment");
    }

    if (o["COT Price Relationship"] === "DIVERGING") {
      reasons.push("COT / price divergence");
    }

    if (o["Extreme"] !== "No") {
      reasons.push(o["Kind"] === "Pair" ? "Extreme positioning (" + o["Extreme"] + ")"
        : (o["Extreme"] === "High" ? "High positioning percentile" : "Low positioning percentile"));
    }

    if (o["Reversal"] !== "No") {
      reasons.push("Potential reversal condition");
    }

    if (o["Kind"] === "Instrument") {

      if (Math.abs(Number(o["Normalised Acceleration"])) >= COT_DASH_ACCEL_BIG) {
        reasons.push("Acceleration " + (Number(o["Normalised Acceleration"]) > 0 ? "+" : "") + Number(o["Normalised Acceleration"]).toFixed(1) + "σ");
      }

      if (Math.abs(Number(o["Momentum Change"])) >= COT_DASH_CHANGE_MIN.momPctl) {
        reasons.push("Strong momentum change");
      }

    } else if (Math.abs(Number(o["Acceleration Divergence (σ)"])) >= COT_DASH_ACCEL_BIG) {

      reasons.push("Large acceleration difference");

    }

    if (reasons.length) {
      watch.push([
        o["Item"], o["Kind"], isNaN(sc) ? "" : sc, o["Direction"],
        reasons.join(" • "), reasons.length, reasons[0]
      ]);
    }

  });

  watch.sort(function(a, b) {
    return b[5] - a[5] || Math.abs(Number(b[2]) || 0) - Math.abs(Number(a[2]) || 0);
  });

  /* ---- weekly history for charts ---- */

  const history = [];

  weeks.forEach(function(w, i) {

    const releaseDay = cotDayNumber(w) + 3;
    const date = cotNoonDate(w);

    PR.forEach(function(pr) {
      const close = cotDashLastClose(priceSeries[pr.name], releaseDay);
      history.push([date, pr.name, "Pair", cotDashVal(pr.score[i], 1), "", "", "",
                    close === null ? "" : cotRound(close, 5)]);
    });

    insts.forEach(function(inst) {

      const m = I[inst.name].metrics[i];

      const close = inst.group === "Currency" ? null : cotDashLastClose(priceSeries[inst.name + "/USD"], releaseDay);

      history.push([date, inst.name, "Instrument", cotDashVal(I[inst.name].strength[i], 1),
                    cotDashVal(m.netPercentile * 100, 1), cotDashVal(m.momentumPercentile, 1),
                    cotDashVal(m.normAcceleration, 2), close === null ? "" : cotRound(close, 5)]);

    });

  });

  return {
    headers: COT_DASH_COLUMNS,
    rows: rows,
    changes: changes,
    watch: watch,
    history: history,
    meta: {
      cotKey: cotKey,
      priceKey: priceKey,
      laggingInstruments: laggingInstruments,
      pairsWithoutPrice: pairsWithoutPrice,
      weeks: L
    }
  };

}


/************************************************************
 * SHEET WRITING
 ************************************************************/

function cotDashWriteTable(ss, name, headers, rows, dateCols) {

  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clear();
  }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");

  if (rows.length > 0) {

    const clean = rows.map(function(r) {
      return r.map(function(v) { return v === null || v === undefined ? "" : v; });
    });

    sheet.getRange(2, 1, clean.length, headers.length).setValues(clean);

    (dateCols || []).forEach(function(c) {
      sheet.getRange(2, c, clean.length, 1).setNumberFormat("yyyy-mm-dd");
    });

  }

  sheet.setFrozenRows(1);

  return sheet;

}


function cotDashRecordStatus(fields) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(COT_DASH_SHEETS.status);

  if (!sheet) {
    sheet = ss.insertSheet(COT_DASH_SHEETS.status);
  }

  const existing = {};

  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function(r) {
      if (r[0]) { existing[String(r[0])] = r[1]; }
    });
  }

  Object.keys(fields).forEach(function(k) { existing[k] = fields[k]; });

  const keys = Object.keys(existing);

  sheet.clear();

  sheet.getRange(1, 1, 1, 2).setValues([["KEY", "VALUE"]]).setFontWeight("bold");

  sheet.getRange(2, 1, keys.length, 2).setValues(keys.map(function(k) {
    return [k, existing[k] === null || existing[k] === undefined ? "" : String(existing[k])];
  }));

  sheet.setFrozenRows(1);

  sheet.autoResizeColumns(1, 2);

}


/************************************************************
 * BUILD THE DASHBOARD DATA LAYER
 ************************************************************/

function buildCOTDashboardData() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const tz = ss.getSpreadsheetTimeZone();

  const now = new Date();

  const isoNow = Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");

  const histories = loadBacktestHistories();

  let prices = {};
  let priceNote = "";

  try {
    prices = loadBacktestPrices();
  } catch (error) {
    priceNote = error.message;
    Logger.log("Prices unavailable: " + priceNote);
  }

  const out = cotDashCompute(histories, prices, now, isoNow);

  cotDashWriteTable(ss, COT_DASH_SHEETS.data, out.headers, out.rows, []);

  // "COT Date", "Price Date" and "Bias Since" are date columns.
  const dataSheet = ss.getSheetByName(COT_DASH_SHEETS.data);

  ["COT Date", "Price Date", "Bias Since"].forEach(function(name) {
    dataSheet.getRange(2, out.headers.indexOf(name) + 1, out.rows.length, 1).setNumberFormat("yyyy-mm-dd");
  });

  cotDashWriteTable(ss, COT_DASH_SHEETS.changes,
    ["Item", "Kind", "Metric", "Previous", "Current", "Change", "Unit", "Magnitude", "Display"],
    out.changes, []);

  cotDashWriteTable(ss, COT_DASH_SHEETS.watch,
    ["Item", "Kind", "Score", "Direction", "Reasons", "Reason Count", "Primary Reason"],
    out.watch, []);

  cotDashWriteTable(ss, COT_DASH_SHEETS.history,
    ["COT Date", "Item", "Kind", "Score", "Net Percentile", "Momentum Percentile",
     "Normalised Acceleration", "Price Close"],
    out.history, [1]);

  const st = cotDashStatus(out.meta.cotKey, out.meta.priceKey,
    out.meta.laggingInstruments, out.meta.pairsWithoutPrice, now);

  cotDashRecordStatus({
    "COT DATE": out.meta.cotKey,
    "PRICE DATE": out.meta.priceKey,
    "LAST UPDATED": isoNow,
    "DATA STATUS": st.dataStatus,
    "COT STATUS": st.cotStatus,
    "PRICE STATUS": st.priceStatus,
    "DAYS SINCE COT": st.daysSince,
    "MISSING INSTRUMENTS": out.meta.laggingInstruments,
    "PAIRS WITHOUT PRICE": out.meta.pairsWithoutPrice,
    "PRICE NOTE": [priceNote, (typeof COT_PRICE_REPORT !== "undefined" ? COT_PRICE_REPORT : "")].filter(String).join(" | "),
    "WEEKS OF HISTORY": out.meta.weeks,
    "NEUTRAL THRESHOLD": PAIR_BIAS_THRESHOLD,
    "STRONG THRESHOLD": COT_DASH_STRONG,
    "TIMEZONE CHECK": ss.getSpreadsheetTimeZone() === Session.getScriptTimeZone()
      ? "OK" : "MISMATCH: sheet " + ss.getSpreadsheetTimeZone() + " vs script " + Session.getScriptTimeZone(),
    "ENGINE VERSION": COT_DASH_VERSION
  });

  PropertiesService.getScriptProperties().setProperty("COT_SS_ID", ss.getId());

  ss.toast("Dashboard data built: " + out.rows.length + " rows. COT " + out.meta.cotKey + ".");

  return out.meta;

}


/************************************************************
 * FULL PIPELINE
 *
 * 1 check CFTC  2 market sheets  3 historical  4 Strength Matrix
 * 5 Pair Scanner  6 Dashboard Data  7 status.
 * The Backtest is never run here.
 ************************************************************/

function runCOTPipelineForced() {

  runCOTPipeline(true);

}


function runCOTPipeline(force) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const tz = ss.getSpreadsheetTimeZone();

  const stamp = function() {
    return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
  };

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    ss.toast("Another COT update is already running.");
    return;
  }

  let step = "start";

  try {

    cotDashRecordStatus({ "LAST CHECK": stamp() });

    step = "CFTC download";
    const data = getCOTData();

    step = "new data check";
    const isNew = hasNewCOTData(ss, data);

    if (isNew || force === true) {

      step = "market sheets";
      const selected = cotSaveSelection();
      updateCOTReport(data);
      cotRestoreSelection(selected);

      step = "historical database";
      updateCOTHistoricalDatabase();

      step = "strength matrix";
      buildCOTStrengthMatrix();

      step = "pair scanner";
      buildCOTPairScanner();

    } else {

      applyCOTFontColoursToAllSheets();

    }

    step = "price top-up";
    try {
      updateCOTPrices();
    } catch (pe) {
      COT_PRICE_REPORT = "Price top-up failed: " + pe.message;
    }

    step = "dashboard data";
    const meta = buildCOTDashboardData();

    let validation = "not run";

    try {
      validation = validateCOTDashboardData() + " mismatch(es)";
    } catch (e) {
      validation = "skipped: " + e.message;
    }

    cotDashRecordStatus({
      "LAST SUCCESSFUL UPDATE": stamp(),
      "LAST ERROR": "",
      "LAST RUN": isNew || force === true ? "New COT data processed" : "No new COT data",
      "VALIDATION": validation
    });

    ss.toast(isNew || force === true ? "New COT data found. Pipeline complete." : "No new COT data. Dashboard refreshed.");

  } catch (error) {

    Logger.log("Pipeline failed at " + step + ": " + error.message);

    cotDashRecordStatus({ "LAST ERROR": stamp() + " [" + step + "] " + error.message });

    ss.toast("COT pipeline failed at " + step + ": " + error.message);

    throw error;

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * VALIDATE THE DATA LAYER AGAINST THE EXISTING SHEETS
 *
 * Strength Matrix / Pair Scanner store rounded values, so
 * small tolerances apply. Returns the number of mismatches.
 ************************************************************/

function validateCOTDashboardData() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const data = ss.getSheetByName(COT_DASH_SHEETS.data);
  const matrix = ss.getSheetByName("COT Strength Matrix");
  const scanner = ss.getSheetByName("COT Pair Scanner");

  if (!data || !matrix || !scanner) {
    throw new Error("Build the Strength Matrix, Pair Scanner and Dashboard Data first.");
  }

  const toObjects = function(sheet) {

    const v = sheet.getDataRange().getValues();
    const h = v[0].map(function(x) { return String(x).trim(); });

    return v.slice(1).map(function(r) {
      const o = {};
      h.forEach(function(name, i) { o[name] = r[i]; });
      return o;
    });

  };

  const dash = {};

  toObjects(data).forEach(function(o) {
    if (o["Timeframe"] === "WEEKLY") { dash[o["Kind"] + "|" + o["Item"]] = o; }
  });

  const out = [["CHECK", "ITEM", "EXISTING SHEET", "DASHBOARD DATA", "DIFFERENCE", "STATUS"]];

  let bad = 0;

  const num = function(check, item, expected, actual, tol) {

    const diff = Number(actual) - Number(expected);
    const ok = isFinite(diff) && Math.abs(diff) <= tol;

    if (!ok) { bad++; }

    out.push([check, item, expected, actual, isFinite(diff) ? cotRound(diff, 3) : "n/a", ok ? "PASS" : "FAIL"]);

  };

  const txt = function(check, item, expected, actual) {

    const ok = String(expected) === String(actual);

    if (!ok) { bad++; }

    out.push([check, item, expected, actual, "", ok ? "PASS" : "FAIL"]);

  };

  toObjects(matrix).forEach(function(m) {

    const name = m["INSTRUMENT"] === "Dollar Index" ? "USD" : m["INSTRUMENT"];
    const d = dash["Instrument|" + name];

    if (!d) { return; }

    txt("COT date", name, cotToDateKey(m["DATE"]), cotToDateKey(d["COT Date"]));
    num("Net percentile", name, m["NET PERCENTILE"], d["Net Percentile"], 0.2);
    num("Momentum percentile", name, m["MOMENTUM PERCENTILE"], d["Momentum Percentile"], 0.2);
    num("Momentum % change", name, m["MOMENTUM PCT CHANGE"], d["Momentum Change"], 0.2);
    num("Norm acceleration", name, m["NORM ACCELERATION"], d["Normalised Acceleration"], 0.011);
    txt("Extreme", name, m["EXTREME"], d["Extreme"]);
    txt("Reversal", name, m["REVERSAL"], d["Reversal"]);
    txt("Positioning class", name, m["POSITIONING"], d["Positioning Class"]);

  });

  toObjects(scanner).forEach(function(p) {

    const d = dash["Pair|" + p["PAIR"]];

    if (!d) { return; }

    num("Pair score", p["PAIR"], p["RELATIVE SCORE"], d["Score"], 0.5);
    txt("Pair bias", p["PAIR"], p["BIAS"], d["Pair Bias (Scanner)"]);

  });

  Object.keys(dash).forEach(function(key) {

    const d = dash[key];

    if (d["Kind"] === "Pair") {
      num("Score = (base - quote strength) / 2", d["Item"],
        d["Score"], (Number(d["Base Strength"]) - Number(d["Quote Strength"])) / 2, 0.15);
    }

    num("Daily = Weekly COT score", d["Item"], d["Weekly Score"], d["Daily Score"], 0);

  });

  let sheet = ss.getSheetByName(COT_DASH_SHEETS.validation);

  if (!sheet) { sheet = ss.insertSheet(COT_DASH_SHEETS.validation); } else { sheet.clear(); }

  sheet.getRange(1, 1, out.length, 6).setValues(out);
  sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 6);

  ss.toast("Dashboard validation: " + bad + " mismatch(es) out of " + (out.length - 1) + " checks.");

  return bad;

}


/************************************************************
 * MENU + WEB APP LINK
 ************************************************************/

function addCOTDashboardMenu() {

  SpreadsheetApp
    .getUi()
    .createMenu("COT Command Centre")
    .addItem("Run Full Pipeline (only if new data)", "runCOTPipeline")
    .addItem("Run Full Pipeline (force rebuild)", "runCOTPipelineForced")
    .addSeparator()
    .addItem("Build Dashboard Data only", "buildCOTDashboardData")
    .addItem("Validate Dashboard Data", "validateCOTDashboardData")
    .addSeparator()
    .addItem("Update Prices Now", "updateCOTPrices")
    .addItem("Install All Automatic Checks", "installCOTAllTriggers")
    .addSeparator()
    .addItem("Show Web App Link", "showCOTWebAppLink")
    .addToUi();

}


function showCOTWebAppLink() {

  const url = ScriptApp.getService().getUrl();

  SpreadsheetApp.getUi().alert(
    url
      ? "Dashboard web app:\n\n" + url
      : "Not deployed yet. In Apps Script: Deploy > New deployment > Web app, " +
        "Execute as: Me. Then open this menu item again."
  );

}



/************************************************************
 * FILE 3 of 3 — WEB APP SERVER CODE
 *
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone (or Anyone with Google account)
 *
 * This only READS the dashboard sheets built by File 2.
 * It never calls CFTC and never runs the backtest.
 ************************************************************/

function doGet() {

  return HtmlService
    .createHtmlOutput(COT_PAGE_HTML)
    .setTitle("COT Market Command Centre")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");

}


function cotWebSS() {

  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) { return active; }
  } catch (e) {
    // fall through to the stored id
  }

  const id = PropertiesService.getScriptProperties().getProperty("COT_SS_ID");

  if (!id) {
    throw new Error("Run 'COT Command Centre > Build Dashboard Data only' once from the sheet.");
  }

  return SpreadsheetApp.openById(id);

}


// Sheet -> array of compact objects (empty cells omitted, dates as yyyy-MM-dd).
function cotWebObjects(ss, name, tz) {

  const sheet = ss.getSheetByName(name);

  if (!sheet || sheet.getLastRow() < 2) { return []; }

  const v = sheet.getDataRange().getValues();
  const h = v[0];
  const out = [];

  for (let r = 1; r < v.length; r++) {

    const o = {};

    for (let c = 0; c < h.length; c++) {

      let x = v[r][c];

      if (x === "" || x === null) { continue; }

      if (x instanceof Date) { x = Utilities.formatDate(x, tz, "yyyy-MM-dd"); }

      o[h[c]] = x;

    }

    out.push(o);

  }

  return out;

}


function cotWebStatusMap(ss) {

  const sheet = ss.getSheetByName(COT_DASH_SHEETS.status);
  const map = {};

  if (sheet && sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function(r) {
      if (r[0]) { map[String(r[0])] = String(r[1]); }
    });
  }

  return map;

}


// Cheap call used by the page every minute to detect new data.
function cotWebStamp() {

  const status = cotWebStatusMap(cotWebSS());

  return (status["LAST UPDATED"] || "") + "|" + (status["COT DATE"] || "");

}


function cotWebPayload() {

  const ss = cotWebSS();
  const tz = ss.getSpreadsheetTimeZone();
  const now = new Date();

  const status = cotWebStatusMap(ss);

  const live = cotDashStatus(
    status["COT DATE"] || "",
    status["PRICE DATE"] || "",
    Number(status["MISSING INSTRUMENTS"]) || 0,
    Number(status["PAIRS WITHOUT PRICE"]) || 0,
    now
  );

  const hist = {};

  cotWebObjects(ss, COT_DASH_SHEETS.history, tz).forEach(function(o) {

    const key = o["Item"] + "|" + o["Kind"];

    if (!hist[key]) { hist[key] = []; }

    hist[key].push([
      o["COT Date"], o["Score"], o["Net Percentile"],
      o["Momentum Percentile"], o["Normalised Acceleration"], o["Price Close"]
    ]);

  });

  return {
    cfg: {
      neutral: PAIR_BIAS_THRESHOLD,
      strong: COT_DASH_STRONG,
      tfs: COT_DASH_TIMEFRAMES.map(function(t) { return t.key; }),
      weights: PAIR_WEIGHTS
    },
    status: status,
    live: live,
    data: cotWebObjects(ss, COT_DASH_SHEETS.data, tz),
    changes: cotWebObjects(ss, COT_DASH_SHEETS.changes, tz),
    watch: cotWebObjects(ss, COT_DASH_SHEETS.watch, tz),
    hist: hist,
    hasBacktest: !!ss.getSheetByName(BACKTEST_DATA_SHEET),
    stamp: (status["LAST UPDATED"] || "") + "|" + (status["COT DATE"] || ""),
    serverTime: now.toISOString()
  };

}


/************************************************************
 * RESEARCH / BACKTEST QUERY
 *
 * Reads the stored "COT Backtest Data" sheet (produced only
 * when you deliberately run the backtest). It never touches
 * live data and never recalculates the backtest.
 ************************************************************/

function cotWebMedian(values) {

  const s = values.slice().sort(function(a, b) { return a - b; });
  const n = s.length;

  if (!n) { return null; }

  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;

}


function cotWebStats(values) {

  const n = values.length;

  if (n === 0) { return { n: 0 }; }

  const mean = cotAverage(values);

  let sd = null, t = null;

  if (n >= 2) {
    sd = Math.sqrt(values.reduce(function(s, v) { return s + Math.pow(v - mean, 2); }, 0) / (n - 1));
    t = sd > 0 ? mean / (sd / Math.sqrt(n)) : null;
  }

  return {
    n: n,
    mean: mean,
    median: cotWebMedian(values),
    hit: values.filter(function(v) { return v > 0; }).length / n * 100,
    sd: sd,
    t: t
  };

}


function cotWebCondition(value, code) {

  if (!code || code === "any") { return true; }

  const v = Number(value);

  if (!isFinite(v)) { return false; }

  if (code === "ge20") { return v >= 20; }
  if (code === "le-20") { return v <= -20; }
  if (code === "gt0") { return v > 0; }
  if (code === "lt0") { return v < 0; }

  return true;

}


function cotWebResearch(p) {

  const ss = cotWebSS();
  const tz = ss.getSpreadsheetTimeZone();

  const sheet = ss.getSheetByName(BACKTEST_DATA_SHEET);

  if (!sheet || sheet.getLastRow() < 2) {
    return { error: "No backtest data yet. Run: COT Analysis > Run Backtest (deliberately, from the sheet menu)." };
  }

  const v = sheet.getDataRange().getValues();
  const h = v[0];

  const ix = {};
  h.forEach(function(name, i) { ix[name] = i; });

  const neutral = PAIR_BIAS_THRESHOLD;

  const scoreMin = p.scoreMin === "" || p.scoreMin === null || p.scoreMin === undefined ? -Infinity : Number(p.scoreMin);
  const scoreMax = p.scoreMax === "" || p.scoreMax === null || p.scoreMax === undefined ? Infinity : Number(p.scoreMax);

  const horizons = [
    { h: 1, col: "1W RETURN %" },
    { h: 2, col: "2W RETURN %" },
    { h: 4, col: "4W RETURN %" }
  ];

  const buckets = { 1: [], 2: [], 4: [] };
  const nonOverlap = { 1: [], 2: [], 4: [] };

  let first = null, last = null, matched = 0;

  for (let r = 1; r < v.length; r++) {

    const row = v[r];

    if (p.pair && p.pair !== "ALL" && row[ix["PAIR"]] !== p.pair) { continue; }
    if (p.bias && p.bias !== "any" && row[ix["BIAS"]] !== p.bias) { continue; }

    const score = Number(row[ix["SCORE"]]);

    if (score < scoreMin || score > scoreMax) { continue; }

    if (!cotWebCondition(row[ix["POSITIONING DIV"]], p.pos)) { continue; }
    if (!cotWebCondition(row[ix["MOMENTUM DIV"]], p.mom)) { continue; }
    if (!cotWebCondition(row[ix["ACCELERATION DIV"]], p.acc)) { continue; }

    const key = cotToDateKey(row[ix["COT DATE"]]);

    if (p.from && key < p.from) { continue; }
    if (p.to && key > p.to) { continue; }

    let sign = 1;

    if (p.directional) {
      if (score >= neutral) { sign = 1; }
      else if (score <= -neutral) { sign = -1; }
      else { continue; }
    }

    matched++;

    if (first === null || key < first) { first = key; }
    if (last === null || key > last) { last = key; }

    horizons.forEach(function(hz) {

      const x = row[ix[hz.col]];

      if (x === "" || x === null || x === undefined) { return; }

      const value = sign * Number(x);

      buckets[hz.h].push(value);

      if (Number(row[ix["WEEK INDEX"]]) % hz.h === 0) { nonOverlap[hz.h].push(value); }

    });

  }

  const result = horizons.map(function(hz) {
    return { horizon: hz.h + "W", all: cotWebStats(buckets[hz.h]), nonOverlap: cotWebStats(nonOverlap[hz.h]) };
  });

  // Methodology notes written by the backtest itself (rows 2-7 of the summary).
  let notes = [];
  const summary = ss.getSheetByName(BACKTEST_SUMMARY_SHEET);

  if (summary && summary.getLastRow() >= 7) {
    notes = summary.getRange(2, 1, 6, 1).getValues().map(function(r) { return String(r[0]); }).filter(String);
  }

  return {
    matched: matched,
    from: first,
    to: last,
    results: result,
    notes: notes,
    directional: !!p.directional,
    threshold: neutral
  };

}
