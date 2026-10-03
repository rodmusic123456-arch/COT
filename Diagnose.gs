/************************************************************
 * DIAGNOSE.GS  (temporary helper, safe to delete afterwards)
 *
 * Checks that every function and constant from Code.gs,
 * Dashboard.gs and Page.gs is present in this project, which
 * shows whether any file was cut short when it was pasted.
 *
 * HOW TO USE: in the Apps Script editor choose "cotDiagnose"
 * in the function dropdown and click Run. A message box shows
 * the result in the Sheet tab, and the full list is written to
 * a sheet called "COT Diagnose".
 ************************************************************/

const COT_DIAG_EXPECTED = [
  ["cotToDateKey", "Code.gs"],
  ["cotNoonDate", "Code.gs"],
  ["cotSaveSelection", "Code.gs"],
  ["cotRestoreSelection", "Code.gs"],
  ["updateCOTReport", "Code.gs"],
  ["getCOTData", "Code.gs"],
  ["updateMarket", "Code.gs"],
  ["recalculateChanges", "Code.gs"],
  ["parseCFTCDate", "Code.gs"],
  ["normaliseDate", "Code.gs"],
  ["scheduledCOTCheck", "Code.gs"],
  ["hasNewCOTData", "Code.gs"],
  ["applyCOTFontColoursToAllSheets", "Code.gs"],
  ["applyFontColours", "Code.gs"],
  ["updateCOTDashboard", "Code.gs"],
  ["classifyPositioning", "Code.gs"],
  ["refreshSelectedMarketDashboard", "Code.gs"],
  ["updateDashboardHistoricalData", "Code.gs"],
  ["createDashboardChart", "Code.gs"],
  ["applyDashboardConditionalFormatting", "Code.gs"],
  ["installCOTTriggers", "Code.gs"],
  ["refreshCOTDashboard", "Code.gs"],
  ["onOpen", "Code.gs"],
  ["onEdit", "Code.gs"],
  ["buildCOTHistoricalDatabase", "Code.gs"],
  ["getLegacyHistoricalData", "Code.gs"],
  ["getLegacyHistoricalDataFromDate", "Code.gs"],
  ["updateCOTHistoricalDatabase", "Code.gs"],
  ["testCOTHistoricalXAU", "Code.gs"],
  ["addHistoricalCOTMenu", "Code.gs"],
  ["validateCOTHistoricalDatabase", "Code.gs"],
  ["cotAverage", "Code.gs"],
  ["cotStdDev", "Code.gs"],
  ["cotPercentileRank", "Code.gs"],
  ["cotRound", "Code.gs"],
  ["computeCOTMetricsAt", "Code.gs"],
  ["buildCOTStrengthMatrix", "Code.gs"],
  ["scalePairAcceleration", "Code.gs"],
  ["cotHasSignal", "Code.gs"],
  ["getCOTPairComponent", "Code.gs"],
  ["scoreCOTPair", "Code.gs"],
  ["buildCOTPairScanner", "Code.gs"],
  ["addCOTAnalysisMenu", "Code.gs"],
  ["setupCOTPricesSheet", "Code.gs"],
  ["freezeCOTPriceFormulas", "Code.gs"],
  ["importCOTCommodityCSVs", "Code.gs"],
  ["cotDayNumber", "Code.gs"],
  ["cotDayToKey", "Code.gs"],
  ["firstIndexAfter", "Code.gs"],
  ["loadBacktestHistories", "Code.gs"],
  ["loadBacktestPrices", "Code.gs"],
  ["backtestComponent", "Code.gs"],
  ["backtestForwardReturn", "Code.gs"],
  ["backtestStats", "Code.gs"],
  ["backtestRound", "Code.gs"],
  ["backtestSignFromValue", "Code.gs"],
  ["backtestStatRows", "Code.gs"],
  ["writeBacktestTable", "Code.gs"],
  ["runCOTBacktest", "Code.gs"],
  ["START_DATE", "Code.gs"],
  ["CFTC_API", "Code.gs"],
  ["MARKETS", "Code.gs"],
  ["COT_CHECK_SCHEDULE", "Code.gs"],
  ["HISTORICAL_START_DATE", "Code.gs"],
  ["COT_HISTORICAL_SHEET", "Code.gs"],
  ["HISTORICAL_INSTRUMENTS", "Code.gs"],
  ["PAIR_WEIGHTS", "Code.gs"],
  ["PAIR_BIAS_THRESHOLD", "Code.gs"],
  ["PAIR_ACCELERATION_CAP", "Code.gs"],
  ["PAIR_LIST", "Code.gs"],
  ["COT_PRICES_SHEET", "Code.gs"],
  ["BACKTEST_DATA_SHEET", "Code.gs"],
  ["BACKTEST_SUMMARY_SHEET", "Code.gs"],
  ["BACKTEST_WARMUP_WEEKS", "Code.gs"],
  ["BACKTEST_HORIZONS", "Code.gs"],
  ["BACKTEST_ENTRY_MAX_GAP_DAYS", "Code.gs"],
  ["BACKTEST_EXIT_MAX_GAP_DAYS", "Code.gs"],
  ["FX_PRICE_TICKERS", "Code.gs"],
  ["COMMODITY_CSV_SHEETS", "Code.gs"],
  ["cotDashVal", "Dashboard.gs"],
  ["cotDashWindow", "Dashboard.gs"],
  ["cotDashDirection", "Dashboard.gs"],
  ["cotDashPriceLabel", "Dashboard.gs"],
  ["cotDashPriceDirection", "Dashboard.gs"],
  ["cotDashLastClose", "Dashboard.gs"],
  ["cotDashRelation", "Dashboard.gs"],
  ["cotDashAlignment", "Dashboard.gs"],
  ["cotDashConfluence", "Dashboard.gs"],
  ["cotDashExpectedCOTKey", "Dashboard.gs"],
  ["cotDashStatus", "Dashboard.gs"],
  ["cotDashCompute", "Dashboard.gs"],
  ["cotDashWriteTable", "Dashboard.gs"],
  ["cotDashRecordStatus", "Dashboard.gs"],
  ["buildCOTDashboardData", "Dashboard.gs"],
  ["runCOTPipelineForced", "Dashboard.gs"],
  ["runCOTPipeline", "Dashboard.gs"],
  ["validateCOTDashboardData", "Dashboard.gs"],
  ["addCOTDashboardMenu", "Dashboard.gs"],
  ["showCOTWebAppLink", "Dashboard.gs"],
  ["doGet", "Dashboard.gs"],
  ["cotWebSS", "Dashboard.gs"],
  ["cotWebObjects", "Dashboard.gs"],
  ["cotWebStatusMap", "Dashboard.gs"],
  ["cotWebStamp", "Dashboard.gs"],
  ["cotWebPayload", "Dashboard.gs"],
  ["cotWebMedian", "Dashboard.gs"],
  ["cotWebStats", "Dashboard.gs"],
  ["cotWebCondition", "Dashboard.gs"],
  ["cotWebResearch", "Dashboard.gs"],
  ["COT_DASH_SHEETS", "Dashboard.gs"],
  ["COT_DASH_VERSION", "Dashboard.gs"],
  ["COT_DASH_STRONG", "Dashboard.gs"],
  ["COT_DASH_HISTORY_WEEKS", "Dashboard.gs"],
  ["COT_DASH_CONFLUENCE_MIN", "Dashboard.gs"],
  ["COT_DASH_PRICE_BAND_MULT", "Dashboard.gs"],
  ["COT_DASH_ACCEL_BIG", "Dashboard.gs"],
  ["COT_DASH_CHANGE_MIN", "Dashboard.gs"],
  ["COT_DASH_CCY", "Dashboard.gs"],
  ["COT_DASH_TIMEFRAMES", "Dashboard.gs"],
  ["COT_DASH_INSTRUMENTS", "Dashboard.gs"],
  ["COT_DASH_COLUMNS", "Dashboard.gs"],
  ["COT_PAGE_HTML", "Page.gs"]
];

function cotDiagnose() {

  const missing = [];
  const present = {};

  COT_DIAG_EXPECTED.forEach(function(item) {

    let ok = false;

    try {
      ok = typeof eval(item[0]) !== "undefined";
    } catch (e) {
      ok = false;
    }

    if (!ok) {
      missing.push(item);
    }

    present[item[1]] = (present[item[1]] || 0) + (ok ? 1 : 0);

  });

  const total = {};

  COT_DIAG_EXPECTED.forEach(function(item) {
    total[item[1]] = (total[item[1]] || 0) + 1;
  });

  const lines = Object.keys(total).map(function(file) {
    return file + ": " + (present[file] || 0) + " of " + total[file] + " found";
  });

  let message;

  if (missing.length === 0) {

    message = "All " + COT_DIAG_EXPECTED.length + " items are present.\n\n" + lines.join("\n") +
      "\n\nIf a menu is still missing, run onOpen from the editor and send me the red error text.";

  } else {

    message = missing.length + " item(s) are MISSING, so a file was probably cut short when pasted.\n\n" +
      lines.join("\n") +
      "\n\nFirst missing:\n" +
      missing.slice(0, 12).map(function(item) { return item[0] + " (" + item[1] + ")"; }).join("\n");

  }

  Logger.log(message);

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName("COT Diagnose");

  if (!sheet) {
    sheet = ss.insertSheet("COT Diagnose");
  } else {
    sheet.clear();
  }

  const rows = [["NAME", "SHOULD BE IN", "STATUS"]];

  COT_DIAG_EXPECTED.forEach(function(item) {
    rows.push([
      item[0],
      item[1],
      missing.indexOf(item) === -1 ? "OK" : "MISSING"
    ]);
  });

  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 3);

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    ss.toast(message.substring(0, 200));
  }

  return missing.length;

}
