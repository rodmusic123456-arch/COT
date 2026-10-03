/*
 * COT ENGINE
 *
 * The scoring methodology, copied unchanged from the verified Google Apps Script
 * system (Code.gs and Dashboard.gs). Only pure calculation lives here: no network,
 * no files, no sheets. Every weekly value is point in time (computeCOTMetricsAt only
 * reads data up to the week being scored).
 *
 * Do not edit the maths here without re-running `npm test`.
 */
'use strict';

function cotNoonDate(text) {

  const p = String(text).substring(0, 10).split("-");

  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);

}

const HISTORICAL_INSTRUMENTS = {
  "AUD": { code: "232741", type: "Currency" },
  "GBP": { code: "096742", type: "Currency" },
  "CAD": { code: "090741", type: "Currency" },
  "EUR": { code: "099741", type: "Currency" },
  "JPY": { code: "097741", type: "Currency" },
  "CHF": { code: "092741", type: "Currency" },
  "Dollar Index": { code: "098662", type: "Currency" },
  "NZD": { code: "112741", type: "Currency" },
  "XAU": { code: "088691", type: "Metal" },
  "XAG": { code: "084691", type: "Metal" },
  "WTI": { code: "067651", type: "Energy" },
  "Brent": { code: "06765T", type: "Energy" }
};

function cotAverage(array) {

  if (!array.length) {
    return 0;
  }

  return array.reduce(function(sum, value) {
    return sum + value;
  }, 0) / array.length;

}

function cotStdDev(array) {

  if (array.length < 2) {
    return 0;
  }

  const mean = cotAverage(array);

  const variance = array.reduce(function(sum, value) {
    return sum + Math.pow(value - mean, 2);
  }, 0) / array.length;

  return Math.sqrt(variance);

}

function cotPercentileRank(array, currentValue) {

  if (!array.length) {
    return 0;
  }

  let belowOrEqual = 0;

  array.forEach(function(value) {
    if (value <= currentValue) {
      belowOrEqual++;
    }
  });

  return belowOrEqual / array.length;

}

function cotRound(value, decimals) {

  const multiplier = Math.pow(10, decimals);

  return Math.round(value * multiplier) / multiplier;

}

function computeCOTMetricsAt(data, index) {

  const nets = [];
  const changeNets = [];

  for (let i = 0; i <= index; i++) {
    nets.push(data[i].net);
    changeNets.push(data[i].changeNet);
  }

  const current = data[index];

  function momentumAt(i) {

    const start = Math.max(0, i - 3);

    return nets[i] - cotAverage(nets.slice(start, i + 1));

  }

  /*
   * Four week net change.
   */

  const fourWeekChange =
    index >= 4 ? current.net - nets[index - 4] : 0;

  /*
   * Positioning percentile (0-1).
   */

  const netPercentile = cotPercentileRank(nets, current.net);

  /*
   * Momentum and momentum percentile.
   *
   * The reference distribution only uses weeks that have
   * a full four week window.
   */

  const momentum = momentumAt(index);

  const momentumHistory = [];

  for (let i = 3; i <= index; i++) {
    momentumHistory.push(momentumAt(i));
  }

  let momentumPercentile = 50;
  let momentumPctChange = 0;

  if (momentumHistory.length >= 2) {

    momentumPercentile =
      cotPercentileRank(momentumHistory, momentum) * 100;

    if (index >= 1) {

      const previousPercentile =
        cotPercentileRank(momentumHistory, momentumAt(index - 1)) * 100;

      momentumPctChange = momentumPercentile - previousPercentile;

    }

  }

  /*
   * Acceleration and normalised acceleration.
   */

  const accelerationHistory = [];

  for (let i = 1; i <= index; i++) {
    accelerationHistory.push(changeNets[i] - changeNets[i - 1]);
  }

  const acceleration =
    accelerationHistory.length
      ? accelerationHistory[accelerationHistory.length - 1]
      : 0;

  const accelerationStd = cotStdDev(accelerationHistory);

  const normAcceleration =
    accelerationStd > 0 ? acceleration / accelerationStd : 0;

  /*
   * Positioning classification.
   */

  let positioning = "Neutral";

  if (current.net > 0 && current.changeNet > 0) {
    positioning = "Increasing Bullish";
  } else if (current.net > 0 && current.changeNet < 0) {
    positioning = "Bullish but weakening";
  } else if (current.net < 0 && current.changeNet < 0) {
    positioning = "Increasing Bearish";
  } else if (current.net < 0 && current.changeNet > 0) {
    positioning = "Bearish but weakening";
  }

  /*
   * Extreme positioning.
   */

  let extreme = "No";

  if (netPercentile >= 0.80) {
    extreme = "High";
  } else if (netPercentile <= 0.20) {
    extreme = "Low";
  }

  /*
   * Reversal detection.
   * High positioning + negative change
   * Low positioning + positive change
   */

  let reversal = "No";

  if (netPercentile >= 0.80 && current.changeNet < 0) {
    reversal = "Potential bearish reversal";
  } else if (netPercentile <= 0.20 && current.changeNet > 0) {
    reversal = "Potential bullish reversal";
  }

  return {
    date: current.date,
    net: current.net,
    changeNet: current.changeNet,
    changeLong: current.changeLong,
    changeShort: current.changeShort,
    fourWeekChange: fourWeekChange,
    netPercentile: netPercentile,
    momentum: momentum,
    momentumPercentile: momentumPercentile,
    momentumPctChange: momentumPctChange,
    acceleration: acceleration,
    normAcceleration: normAcceleration,
    positioning: positioning,
    extreme: extreme,
    reversal: reversal
  };

}

const PAIR_WEIGHTS = {
  positioning: 0.50,
  momentum: 0.30,
  acceleration: 0.20
};

const PAIR_BIAS_THRESHOLD = 20;

const PAIR_ACCELERATION_CAP = 3;

const PAIR_LIST = [

  ["EUR/USD", "EUR", "USD"],
  ["GBP/USD", "GBP", "USD"],
  ["AUD/USD", "AUD", "USD"],
  ["NZD/USD", "NZD", "USD"],

  ["USD/JPY", "USD", "JPY"],
  ["USD/CHF", "USD", "CHF"],
  ["USD/CAD", "USD", "CAD"],

  ["EUR/GBP", "EUR", "GBP"],
  ["EUR/JPY", "EUR", "JPY"],
  ["GBP/JPY", "GBP", "JPY"],

  ["AUD/JPY", "AUD", "JPY"],
  ["NZD/JPY", "NZD", "JPY"],
  ["CAD/JPY", "CAD", "JPY"],

  ["EUR/CHF", "EUR", "CHF"],
  ["GBP/CHF", "GBP", "CHF"],

  ["AUD/CAD", "AUD", "CAD"],
  ["AUD/NZD", "AUD", "NZD"],

  ["XAU/USD", "XAU", "USD"],
  ["XAG/USD", "XAG", "USD"],

  ["WTI/USD", "WTI", "USD"],
  ["Brent/USD", "Brent", "USD"]

];

function scalePairAcceleration(sigma) {

  const capped = Math.max(
    -PAIR_ACCELERATION_CAP,
    Math.min(PAIR_ACCELERATION_CAP, sigma)
  );

  return (capped / PAIR_ACCELERATION_CAP) * 50;

}

function scoreCOTPair(base, quote) {

  const weightSum =
    PAIR_WEIGHTS.positioning +
    PAIR_WEIGHTS.momentum +
    PAIR_WEIGHTS.acceleration;

  const positioningDivergence =
    base.netPercentile - quote.netPercentile;

  const momentumDivergence =
    base.momentumPercentile - quote.momentumPercentile;

  const momentumChangeDivergence =
    base.momentumPctChange - quote.momentumPctChange;

  const accelerationDivergence =
    scalePairAcceleration(base.normAcceleration) -
    scalePairAcceleration(quote.normAcceleration);

  const relativeScore =
    (
      positioningDivergence * PAIR_WEIGHTS.positioning +
      momentumDivergence * PAIR_WEIGHTS.momentum +
      accelerationDivergence * PAIR_WEIGHTS.acceleration
    ) / weightSum;

  let bias = "Neutral";

  if (relativeScore >= PAIR_BIAS_THRESHOLD) {

    bias = "Bullish";

    if (momentumChangeDivergence < 0) {
      bias = "Bullish but momentum fading";
    }

  } else if (relativeScore <= -PAIR_BIAS_THRESHOLD) {

    bias = "Bearish";

    if (momentumChangeDivergence > 0) {
      bias = "Bearish but momentum fading";
    }

  }

  return {
    positioningDivergence: positioningDivergence,
    momentumDivergence: momentumDivergence,
    momentumChangeDivergence: momentumChangeDivergence,
    accelerationDivergence: accelerationDivergence,
    relativeScore: relativeScore,
    bias: bias
  };

}

const BACKTEST_WARMUP_WEEKS = 52;

const BACKTEST_HORIZONS = [1, 2, 4];

const BACKTEST_ENTRY_MAX_GAP_DAYS = 5;

const BACKTEST_EXIT_MAX_GAP_DAYS = 4;

function cotDayNumber(dateKey) {
 
  const parts = String(dateKey).split("-");
 
  return Date.UTC(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  ) / 86400000;
 
}

function cotDayToKey(day) {
 
  return new Date(day * 86400000).toISOString().substring(0, 10);
 
}

function firstIndexAfter(days, day) {
 
  let lo = 0;
  let hi = days.length;
 
  while (lo < hi) {
 
    const mid = (lo + hi) >> 1;
 
    if (days[mid] > day) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
 
  }
 
  return lo;
 
}

function backtestComponent(metrics) {
 
  return {
    netPercentile: metrics.netPercentile * 100,
    momentumPercentile: metrics.momentumPercentile,
    momentumPctChange: metrics.momentumPctChange,
    normAcceleration: metrics.normAcceleration
  };
 
}

function backtestForwardReturn(series, entryIndex, weeks) {
 
  const days = series.days;
 
  const target = days[entryIndex] + 7 * weeks;
 
  if (target > days[days.length - 1]) {
    return null;
  }
 
  const exitIndex = firstIndexAfter(days, target) - 1;
 
  if (exitIndex <= entryIndex) {
    return null;
  }
 
  if (target - days[exitIndex] > BACKTEST_EXIT_MAX_GAP_DAYS) {
    return null;
  }
 
  return (series.closes[exitIndex] / series.closes[entryIndex] - 1) * 100;
 
}

const COT_DASH_VERSION = "1.0";

const COT_DASH_STRONG = 50;

const COT_DASH_HISTORY_WEEKS = 104;

const COT_DASH_CONFLUENCE_MIN = 5;

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

const COT_DASH_TIMEFRAMES = [
  { key: "DAILY",     col: "Daily Score",     weeks: 1,  priceDays: 0 },
  { key: "WEEKLY",    col: "Weekly Score",    weeks: 1,  priceDays: 7 },
  { key: "MONTHLY",   col: "Monthly Score",   weeks: 4,  priceDays: 30 },
  { key: "QUARTERLY", col: "Quarterly Score", weeks: 13, priceDays: 91 },
  { key: "6 MONTH",   col: "6M Score",        weeks: 26, priceDays: 182 },
  { key: "ANNUAL",    col: "Annual Score",    weeks: 52, priceDays: 365 }
];

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

function cotDashVal(x, decimals) {

  if (x === null || x === undefined || (typeof x === "number" && isNaN(x))) {
    return "";
  }

  return cotRound(x, decimals);

}

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

const __COT_ENGINE = {
  cotNoonDate,
  HISTORICAL_INSTRUMENTS,
  cotAverage,
  cotStdDev,
  cotPercentileRank,
  cotRound,
  computeCOTMetricsAt,
  PAIR_WEIGHTS,
  PAIR_BIAS_THRESHOLD,
  PAIR_ACCELERATION_CAP,
  PAIR_LIST,
  scalePairAcceleration,
  scoreCOTPair,
  BACKTEST_WARMUP_WEEKS,
  BACKTEST_HORIZONS,
  BACKTEST_ENTRY_MAX_GAP_DAYS,
  BACKTEST_EXIT_MAX_GAP_DAYS,
  cotDayNumber,
  cotDayToKey,
  firstIndexAfter,
  backtestComponent,
  backtestForwardReturn,
  COT_DASH_VERSION,
  COT_DASH_STRONG,
  COT_DASH_HISTORY_WEEKS,
  COT_DASH_CONFLUENCE_MIN,
  COT_DASH_PRICE_BAND_MULT,
  COT_DASH_ACCEL_BIG,
  COT_DASH_CHANGE_MIN,
  COT_DASH_CCY,
  COT_DASH_TIMEFRAMES,
  COT_DASH_INSTRUMENTS,
  COT_DASH_COLUMNS,
  cotDashVal,
  cotDashWindow,
  cotDashDirection,
  cotDashPriceLabel,
  cotDashPriceDirection,
  cotDashLastClose,
  cotDashRelation,
  cotDashAlignment,
  cotDashConfluence,
  cotDashExpectedCOTKey,
  cotDashStatus,
  cotDashCompute,
  cotWebMedian,
  cotWebStats,
  cotWebCondition
};

if (typeof module !== 'undefined' && module.exports) module.exports = __COT_ENGINE;
else if (typeof self !== 'undefined') self.COT_ENGINE = __COT_ENGINE;
