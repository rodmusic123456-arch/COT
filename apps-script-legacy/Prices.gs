/************************************************************
 * PRICES.GS
 * Automatic price top-up for the "COT Prices" sheet.
 *
 * WHAT IT DOES
 *  - Creates the "COT Prices" layout if it is missing.
 *  - For every pair, finds the last date already stored and
 *    appends ONLY newer closes. Existing history is never
 *    changed, so the backtest stays reproducible.
 *  - An empty block is filled with full history from
 *    COT_PRICE_START.
 *
 * SOURCES
 *  - FX pairs ......... GOOGLEFINANCE (same source as your
 *                       original setup), read through a
 *                       temporary scratch sheet.
 *  - XAU, XAG, WTI, Brent  Yahoo Finance daily chart data for
 *                       the futures symbols in COT_PRICE_YAHOO.
 *                       Change a symbol there if your imported
 *                       CSV history used a different series.
 *
 * SAFETY CHECKS
 *  - Splice check: before appending, the new data is compared
 *    with the last stored closes on overlapping dates. If they
 *    differ by more than the tolerance, the pair is NOT
 *    updated and the reason is reported (this protects you
 *    from mixing two different price series).
 *  - A pair that fails never stops the others, and a price
 *    failure never stops the COT pipeline.
 *  - Blocks that still hold a live GOOGLEFINANCE formula are
 *    skipped because they update themselves.
 ************************************************************/

const COT_PRICE_START = "2020-12-01";

const COT_PRICE_TEMP_SHEET = "COT Price Temp";

// Hour of day (sheet timezone) for the daily top-up trigger.
const COT_PRICE_UPDATE_HOUR = 23;

// Yahoo Finance daily symbols for pairs that GOOGLEFINANCE does not cover.
const COT_PRICE_YAHOO = {
  "XAU/USD": "GC=F",
  "XAG/USD": "SI=F",
  "WTI/USD": "CL=F",
  "Brent/USD": "BZ=F"
};

// Largest allowed difference on overlapping dates before a splice is refused.
const COT_PRICE_TOLERANCE_FX = 0.01;
const COT_PRICE_TOLERANCE_COMMODITY = 0.04;

// Filled by updateCOTPrices() and written to the status sheet by the dashboard build.
var COT_PRICE_REPORT = "";


/************************************************************
 * LAYOUT
 ************************************************************/

function cotPricesEnsureSheet() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(COT_PRICES_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(COT_PRICES_SHEET);
  }

  const neededColumns = PAIR_LIST.length * 2;

  if (sheet.getMaxColumns() < neededColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededColumns - sheet.getMaxColumns());
  }

  PAIR_LIST.forEach(function(pair, i) {

    const col = i * 2 + 1;

    if (String(sheet.getRange(1, col).getValue()).trim() === "") {
      sheet.getRange(1, col).setValue(pair[0]).setFontWeight("bold");
    }

    if (
      String(sheet.getRange(2, col).getValue()).trim() === "" &&
      sheet.getRange(2, col).getFormula() === ""
    ) {
      sheet.getRange(2, col, 1, 2).setValues([["Date", "Close"]]);
    }

  });

  return sheet;

}


/************************************************************
 * READ THE STATE OF EVERY BLOCK (one batch read)
 ************************************************************/

function cotPricesReadState(sheet) {

  const lastRow = Math.max(sheet.getLastRow(), 2);
  const lastCol = PAIR_LIST.length * 2;

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const formulas = sheet.getRange(2, 1, 1, lastCol).getFormulas()[0];

  return PAIR_LIST.map(function(pair, i) {

    const col = i * 2;

    const tail = {};

    let lastKey = "";
    let lastDataRow = 2;

    for (let r = 2; r < values.length; r++) {

      const d = values[r][col];

      if (!(d instanceof Date) || isNaN(d.getTime())) {
        continue;
      }

      const close = Number(values[r][col + 1]);

      if (!isFinite(close) || close <= 0) {
        continue;
      }

      const key = normaliseDate(d);

      lastDataRow = r + 1;

      if (!lastKey || key >= lastKey) {
        lastKey = key;
      }

      tail[key] = close;

    }

    // Keep only the most recent 15 entries for the splice check.
    const keys = Object.keys(tail).sort();

    const recent = {};

    keys.slice(-15).forEach(function(k) { recent[k] = tail[k]; });

    return {
      name: pair[0],
      col: col + 1,
      live: String(formulas[col] || "") !== "",
      lastKey: lastKey,
      lastDataRow: lastDataRow,
      recent: recent
    };

  });

}


/************************************************************
 * SOURCE 1: GOOGLEFINANCE (FX), BATCHED THROUGH A SCRATCH SHEET
 ************************************************************/

function cotPricesFetchGoogle(jobs) {

  const results = {};

  if (jobs.length === 0) {
    return results;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let tmp = ss.getSheetByName(COT_PRICE_TEMP_SHEET);

  if (!tmp) {
    tmp = ss.insertSheet(COT_PRICE_TEMP_SHEET);
  } else {
    tmp.clear();
  }

  const neededRows = 3000;

  if (tmp.getMaxRows() < neededRows) {
    tmp.insertRowsAfter(tmp.getMaxRows(), neededRows - tmp.getMaxRows());
  }

  const neededColumns = jobs.length * 3;

  if (tmp.getMaxColumns() < neededColumns) {
    tmp.insertColumnsAfter(tmp.getMaxColumns(), neededColumns - tmp.getMaxColumns());
  }

  jobs.forEach(function(job, k) {

    const p = job.startKey.split("-");

    tmp.getRange(1, k * 3 + 1).setFormula(
      '=GOOGLEFINANCE("CURRENCY:' + FX_PRICE_TICKERS[job.name] +
      '","close",DATE(' + Number(p[0]) + ',' + Number(p[1]) + ',' + Number(p[2]) + '),TODAY())'
    );

  });

  SpreadsheetApp.flush();

  // GOOGLEFINANCE calculates asynchronously: wait until nothing says "Loading...".
  let data = [];

  for (let attempt = 0; attempt < 12; attempt++) {

    data = tmp.getDataRange().getValues();

    const loading = jobs.some(function(job, k) {
      const cell = data.length > 0 ? data[0][k * 3] : "";
      return String(cell).indexOf("Loading") !== -1;
    });

    if (!loading) {
      break;
    }

    Utilities.sleep(2000);

  }

  jobs.forEach(function(job, k) {

    const rows = [];

    let error = "";

    const first = data.length > 0 ? data[0][k * 3] : "";

    if (typeof first === "string" && first.charAt(0) === "#") {
      error = "GOOGLEFINANCE returned " + first;
    } else if (String(first).indexOf("Loading") !== -1) {
      error = "GOOGLEFINANCE was still loading";
    } else {

      for (let r = 1; r < data.length; r++) {

        const d = data[r][k * 3];
        const c = Number(data[r][k * 3 + 1]);

        if (d instanceof Date && !isNaN(d.getTime()) && isFinite(c) && c > 0) {
          rows.push({ key: normaliseDate(d), close: c });
        }

      }

    }

    results[job.name] = { rows: rows, error: error };

  });

  ss.deleteSheet(tmp);

  return results;

}


/************************************************************
 * SOURCE 2: YAHOO FINANCE DAILY CHART (commodities)
 ************************************************************/

function cotPricesFetchYahoo(symbol, startKey) {

  const period1 = Math.floor(cotDayNumber(startKey) * 86400);
  const period2 = Math.floor(Date.now() / 1000) + 86400;

  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) +
    "?period1=" + period1 + "&period2=" + period2 + "&interval=1d&events=history";

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
  });

  const status = response.getResponseCode();

  if (status !== 200) {
    return { rows: [], error: "Yahoo returned HTTP " + status + " for " + symbol };
  }

  let json;

  try {
    json = JSON.parse(response.getContentText());
  } catch (e) {
    return { rows: [], error: "Yahoo returned unreadable data for " + symbol };
  }

  const result = json && json.chart && json.chart.result && json.chart.result[0];

  if (!result || !result.timestamp || !result.indicators || !result.indicators.quote || !result.indicators.quote[0]) {
    return { rows: [], error: "Yahoo returned no price data for " + symbol };
  }

  const stamps = result.timestamp;
  const closes = result.indicators.quote[0].close || [];
  const offset = Number(result.meta && result.meta.gmtoffset) || 0;

  const byKey = {};

  for (let i = 0; i < stamps.length; i++) {

    const c = Number(closes[i]);

    if (closes[i] === null || closes[i] === undefined || !isFinite(c) || c <= 0) {
      continue;
    }

    byKey[cotDayToKey(Math.floor((stamps[i] + offset) / 86400))] = c;

  }

  return {
    rows: Object.keys(byKey).sort().map(function(k) { return { key: k, close: byKey[k] }; }),
    error: ""
  };

}


/************************************************************
 * TOP-UP: ONE PAIR
 *
 * Returns { status, added, detail }.
 ************************************************************/

function cotPricesApply(sheet, state, fetched, tolerance) {

  if (fetched.error) {
    return { status: "FAILED", added: 0, detail: fetched.error };
  }

  const rows = fetched.rows;

  if (rows.length === 0) {
    return { status: "NO DATA", added: 0, detail: "source returned no rows" };
  }

  // Splice check against the closes already stored.
  if (state.lastKey) {

    let checked = "";
    let worst = 0;

    rows.forEach(function(r) {

      const old = state.recent[r.key];

      if (old === undefined) {
        return;
      }

      const diff = Math.abs(r.close - old) / old;

      checked = r.key;

      if (diff > worst) {
        worst = diff;
      }

    });

    if (checked && worst > tolerance) {
      return {
        status: "MISMATCH",
        added: 0,
        detail: "new data differs from stored closes by " + (worst * 100).toFixed(1) +
          "% (limit " + (tolerance * 100).toFixed(0) + "%). Not updated. Import a fresh CSV or change the source symbol."
      };
    }

  }

  const fresh = rows.filter(function(r) {
    return !state.lastKey || r.key > state.lastKey;
  });

  if (fresh.length === 0) {
    return { status: "UP TO DATE", added: 0, detail: "last close " + state.lastKey };
  }

  const startRow = state.lastDataRow + 1;

  if (sheet.getMaxRows() < startRow + fresh.length) {
    sheet.insertRowsAfter(sheet.getMaxRows(), startRow + fresh.length - sheet.getMaxRows() + 50);
  }

  sheet
    .getRange(startRow, state.col, fresh.length, 2)
    .setValues(fresh.map(function(r) { return [cotNoonDate(r.key), r.close]; }));

  sheet.getRange(startRow, state.col, fresh.length, 1).setNumberFormat("yyyy-mm-dd");

  return {
    status: "UPDATED",
    added: fresh.length,
    detail: fresh[0].key + " to " + fresh[fresh.length - 1].key
  };

}


/************************************************************
 * TOP-UP: ALL PAIRS
 ************************************************************/

function updateCOTPrices() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheet = cotPricesEnsureSheet();

  const states = cotPricesReadState(sheet);

  const outcomes = [];

  const googleJobs = [];
  const yahooJobs = [];

  states.forEach(function(state) {

    const startKey = state.lastKey
      ? cotDayToKey(cotDayNumber(state.lastKey) - 7)
      : COT_PRICE_START;

    if (state.live) {
      outcomes.push({ name: state.name, status: "LIVE FORMULA", added: 0, detail: "updates itself" });
    } else if (FX_PRICE_TICKERS[state.name]) {
      googleJobs.push({ name: state.name, startKey: startKey, state: state });
    } else if (COT_PRICE_YAHOO[state.name]) {
      yahooJobs.push({ name: state.name, startKey: startKey, state: state });
    } else {
      outcomes.push({ name: state.name, status: "NO SOURCE", added: 0, detail: "no price source configured" });
    }

  });

  // FX
  let googleResults = {};

  try {
    googleResults = cotPricesFetchGoogle(googleJobs);
  } catch (error) {
    googleJobs.forEach(function(job) {
      googleResults[job.name] = { rows: [], error: error.message };
    });
  }

  googleJobs.forEach(function(job) {

    const o = cotPricesApply(sheet, job.state, googleResults[job.name], COT_PRICE_TOLERANCE_FX);

    o.name = job.name;

    outcomes.push(o);

  });

  // Commodities
  yahooJobs.forEach(function(job) {

    let fetched;

    try {
      fetched = cotPricesFetchYahoo(COT_PRICE_YAHOO[job.name], job.startKey);
    } catch (error) {
      fetched = { rows: [], error: "Yahoo request failed: " + error.message };
    }

    const o = cotPricesApply(sheet, job.state, fetched, COT_PRICE_TOLERANCE_COMMODITY);

    o.name = job.name;

    outcomes.push(o);

    Utilities.sleep(300);

  });

  const added = outcomes.reduce(function(sum, o) { return sum + o.added; }, 0);

  const problems = outcomes.filter(function(o) {
    return o.status === "FAILED" || o.status === "MISMATCH" || o.status === "NO DATA" || o.status === "NO SOURCE";
  });

  COT_PRICE_REPORT =
    problems.length === 0
      ? ""
      : "Price top-up issues: " + problems.map(function(o) { return o.name + " (" + o.status + ": " + o.detail + ")"; }).join("; ");

  Logger.log("Price top-up: " + added + " rows added.");

  outcomes.forEach(function(o) {
    Logger.log(o.name + ": " + o.status + " - " + o.detail);
  });

  cotDashRecordStatus({
    "PRICE UPDATE": added + " rows added; " + problems.length + " pair(s) with issues",
    "PRICE UPDATE TIME": Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX")
  });

  ss.toast("Prices: " + added + " rows added" + (problems.length ? ", " + problems.length + " issue(s) (see COT Dashboard Status)" : "."));

  return outcomes;

}


/************************************************************
 * DAILY JOB: top up prices, then refresh the dashboard data.
 * No CFTC download and no backtest.
 ************************************************************/

function scheduledPriceUpdate() {

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    return;
  }

  try {

    updateCOTPrices();

    buildCOTDashboardData();

    cotDashRecordStatus({ "LAST ERROR": "" });

  } catch (error) {

    Logger.log("Price update failed: " + error.message);

    cotDashRecordStatus({ "LAST ERROR": "[price update] " + error.message });

    throw error;

  } finally {

    lock.releaseLock();

  }

}


/************************************************************
 * TRIGGERS: Friday + Monday COT checks (existing) plus the
 * daily price top-up. Safe to run repeatedly.
 ************************************************************/

function installCOTAllTriggers() {

  installCOTTriggers();

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "scheduledPriceUpdate") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("scheduledPriceUpdate")
    .timeBased()
    .everyDays(1)
    .atHour(COT_PRICE_UPDATE_HOUR)
    .inTimezone(ss.getSpreadsheetTimeZone())
    .create();

  ss.toast(
    "Automatic checks installed: COT Friday and Monday, prices daily at " +
    COT_PRICE_UPDATE_HOUR + ":00 (" + ss.getSpreadsheetTimeZone() + ")."
  );

}
