/************************************************************
 * CODE.GS (corrected full engine)
 * Original system with 9 functions fixed in place plus
 * shared date helpers. Dashboard layer lives in Dashboard.gs.
 *
 * COT REPORT, DASHBOARD, HISTORICAL DATABASE,
 * STRENGTH MATRIX AND PAIR SCANNER
 *
 * Source: CFTC Public Reporting (Legacy Futures Only)
 * Non commercial positioning only
 ************************************************************/

const START_DATE = "2026-03-03";

const CFTC_API = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

const MARKETS = {
  "AUD": "232741",
  "GBP": "096742",
  "CAD": "090741",
  "EUR": "099741",
  "JPY": "097741",
  "CHF": "092741",
  "Dollar Index": "098662",
  "NZD": "112741",
  "XAU": "088691"
};


/************************************************************
 * SHARED HELPERS
 ************************************************************/

// Timezone-safe "yyyy-MM-dd" key from a Date OR an ISO-style string.
function cotToDateKey(value) {

  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  return String(value).substring(0, 10);

}


// Date at 12:00 local time, so a timezone offset can never shift the day.
function cotNoonDate(text) {

  const p = String(text).substring(0, 10).split("-");

  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);

}


function cotSaveSelection() {

  const dashboard = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("COT Dashboard");

  return dashboard ? String(dashboard.getRange("B4").getValue() || "") : "";

}


function cotRestoreSelection(market) {

  if (!market || Object.keys(MARKETS).indexOf(market) === -1) {
    return;
  }

  const dashboard = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("COT Dashboard");

  if (!dashboard) {
    return;
  }

  dashboard.getRange("B4").setValue(market);

  refreshSelectedMarketDashboard(dashboard);

}



const COT_CHECK_SCHEDULE = {
  fridayHour: 18,
  mondayHour: 18
};


/************************************************************
 * MAIN COT UPDATE
 ************************************************************/

function updateCOTReport(data) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!data || !Array.isArray(data)) {
    data = getCOTData();
  }

  if (!data || data.length === 0) {
    throw new Error("No COT data was returned.");
  }

  Object.keys(MARKETS).forEach(function(market) {

    let sheet = ss.getSheetByName(market);

    if (!sheet) {

      sheet = ss.insertSheet(market);

      sheet.getRange(1, 1, 1, 8).setValues([[
        "DATE",
        "LONG",
        "SHORT",
        "CHANGE LONG",
        "CHANGE SHORT",
        "% LONG",
        "% SHORT",
        "NET POSITIONS"
      ]]);

    }

    updateMarket(sheet, MARKETS[market], data);

  });

  applyCOTFontColoursToAllSheets();

  updateCOTDashboard();

  ss.toast("COT report and dashboard updated successfully.");

}


/************************************************************
 * GET COT DATA FROM CFTC
 ************************************************************/

function getCOTData() {

  const codes = Object.values(MARKETS)
    .map(function(code) {
      return "'" + code + "'";
    })
    .join(",");

  const selectFields =
    "report_date_as_yyyy_mm_dd," +
    "cftc_contract_market_code," +
    "market_and_exchange_names," +
    "open_interest_all," +
    "noncomm_positions_long_all," +
    "noncomm_positions_short_all";

  const whereClause =
    "report_date_as_yyyy_mm_dd >= '" + START_DATE + "' " +
    "AND cftc_contract_market_code IN (" + codes + ")";

  const url =
    CFTC_API +
    "?$select=" + encodeURIComponent(selectFields) +
    "&$where=" + encodeURIComponent(whereClause) +
    "&$order=" + encodeURIComponent("report_date_as_yyyy_mm_dd ASC") +
    "&$limit=5000";

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: { "Accept": "application/json" }
  });

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    Logger.log(responseText);
    throw new Error("CFTC API returned HTTP " + responseCode);
  }

  const data = JSON.parse(responseText);

  if (!Array.isArray(data)) {
    throw new Error("CFTC API returned an unexpected response.");
  }

  Logger.log("CFTC records received: " + data.length);

  return data;

}


/************************************************************
 * UPDATE INDIVIDUAL MARKET
 ************************************************************/

function updateMarket(sheet, marketCode, allData) {

  const marketData = allData.filter(function(row) {
    return String(row.cftc_contract_market_code).trim() === String(marketCode).trim();
  });

  if (marketData.length === 0) {
    Logger.log("No data found for " + sheet.getName());
    return;
  }

  const rowsByKey = {};

  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {

    sheet.getRange(2, 1, lastRow - 1, 8).getValues().forEach(function(r) {
      if (r[0]) {
        rowsByKey[normaliseDate(r[0])] = r;
      }
    });

  }

  marketData.forEach(function(row) {

    const date = parseCFTCDate(row.report_date_as_yyyy_mm_dd);

    const longPosition = Number(row.noncomm_positions_long_all) || 0;
    const shortPosition = Number(row.noncomm_positions_short_all) || 0;
    const openInterest = Number(row.open_interest_all) || 0;

    rowsByKey[normaliseDate(date)] = [
      date,
      longPosition,
      shortPosition,
      0,
      0,
      openInterest > 0 ? (longPosition / openInterest) * 100 : 0,
      openInterest > 0 ? (shortPosition / openInterest) * 100 : 0,
      longPosition - shortPosition
    ];

  });

  const rows = Object.keys(rowsByKey).sort().map(function(key) {
    return rowsByKey[key];
  });

  if (lastRow >= 2 && lastRow - 1 > rows.length) {
    sheet.getRange(2 + rows.length, 1, lastRow - 1 - rows.length, 8).clearContent();
  }

  sheet.getRange(2, 1, rows.length, 8).setValues(rows);

  recalculateChanges(sheet);

}


/************************************************************
 * RECALCULATE CHANGES
 ************************************************************/

function recalculateChanges(sheet) {

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  for (let i = 0; i < values.length; i++) {

    const longPosition = Number(values[i][1]) || 0;
    const shortPosition = Number(values[i][2]) || 0;

    let changeLong = 0;
    let changeShort = 0;

    if (i > 0) {
      const previousLong = Number(values[i - 1][1]) || 0;
      const previousShort = Number(values[i - 1][2]) || 0;
      changeLong = longPosition - previousLong;
      changeShort = shortPosition - previousShort;
    }

    values[i][3] = changeLong;
    values[i][4] = changeShort;
    values[i][7] = longPosition - shortPosition;

  }

  const output = values.map(function(row) {
    return [row[3], row[4], row[5], row[6], row[7]];
  });

  sheet.getRange(2, 4, output.length, 5).setValues(output);

  sheet.getRange(2, 1, values.length, 1).setNumberFormat("dd/mm/yyyy");

  sheet.getRange(2, 2, values.length, 7).setNumberFormat("#,##0.0");

}


/************************************************************
 * DATE FUNCTIONS
 ************************************************************/

function parseCFTCDate(value) {

  if (value instanceof Date) {
    return value;
  }

  const parts = String(value).substring(0, 10).split("-");

  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );

}


function normaliseDate(date) {

  if (!(date instanceof Date)) {
    date = new Date(date);
  }

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );

}


/************************************************************
 * CHECK FOR NEW COT DATA
 ************************************************************/

function scheduledCOTCheck() {

  runCOTPipeline(false);

}


/************************************************************
 * DETERMINE WHETHER NEW DATA EXISTS
 ************************************************************/

function hasNewCOTData(ss, data) {

  for (const market in MARKETS) {

    const marketCode = MARKETS[market];

    const marketData = data.filter(function(row) {
      return String(row.cftc_contract_market_code).trim() ===
        String(marketCode).trim();
    });

    if (marketData.length === 0) {
      continue;
    }

    marketData.sort(function(a, b) {
      return new Date(a.report_date_as_yyyy_mm_dd) -
        new Date(b.report_date_as_yyyy_mm_dd);
    });

    const latestCFTCDate = normaliseDate(
      parseCFTCDate(
        marketData[marketData.length - 1].report_date_as_yyyy_mm_dd
      )
    );

    const sheet = ss.getSheetByName(market);

    if (!sheet) {
      return true;
    }

    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return true;
    }

    const dateValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    let latestSheetDate = null;

    dateValues.forEach(function(row) {

      if (row[0]) {

        const date = normaliseDate(row[0]);

        if (!latestSheetDate || date > latestSheetDate) {
          latestSheetDate = date;
        }

      }

    });

    if (!latestSheetDate || latestCFTCDate > latestSheetDate) {
      return true;
    }

  }

  return false;

}


/************************************************************
 * FONT COLOURS
 ************************************************************/

function applyCOTFontColoursToAllSheets() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(MARKETS).forEach(function(market) {

    const sheet = ss.getSheetByName(market);

    if (!sheet) {
      return;
    }

    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return;
    }

    const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

    applyFontColours(sheet, values);

  });

}


function applyFontColours(sheet, values) {

  const green = "#008000";
  const red = "#ff0000";
  const black = "#000000";

  function colourFor(value) {
    return value > 0 ? green : value < 0 ? red : black;
  }

  const changeLongColours = [];
  const changeShortColours = [];
  const netColours = [];

  values.forEach(function(row) {

    changeLongColours.push([colourFor(Number(row[3]) || 0)]);
    changeShortColours.push([colourFor(Number(row[4]) || 0)]);
    netColours.push([colourFor(Number(row[7]) || 0)]);

  });

  sheet.getRange(2, 4, values.length, 1).setFontColors(changeLongColours);
  sheet.getRange(2, 5, values.length, 1).setFontColors(changeShortColours);
  sheet.getRange(2, 8, values.length, 1).setFontColors(netColours);

}


/************************************************************
 * CREATE / UPDATE COT DASHBOARD
 ************************************************************/

function updateCOTDashboard() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let dashboard = ss.getSheetByName("COT Dashboard");

  if (!dashboard) {
    dashboard = ss.insertSheet("COT Dashboard", 0);
  }

  dashboard.clear();
  dashboard.clearConditionalFormatRules();


  /******************************************************
   * TITLE
   ******************************************************/

  dashboard.getRange("A1:H1").merge();

  dashboard
    .getRange("A1")
    .setValue("COT POSITIONING DASHBOARD")
    .setFontSize(18)
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  dashboard.getRange("A2:H2").merge();

  dashboard
    .getRange("A2")
    .setValue("Non commercial futures positioning based on CFTC COT data")
    .setFontStyle("italic")
    .setHorizontalAlignment("center");


  /******************************************************
   * MARKET SELECTOR
   ******************************************************/

  dashboard.getRange("A4").setValue("SELECT MARKET").setFontWeight("bold");

  dashboard.getRange("B4").setValue("EUR").setFontWeight("bold");

  const marketRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.keys(MARKETS), true)
    .setAllowInvalid(false)
    .build();

  dashboard.getRange("B4").setDataValidation(marketRule);


  /******************************************************
   * MARKET OVERVIEW
   ******************************************************/

  dashboard
    .getRange("A7:H7")
    .setValues([[
      "MARKET",
      "NET POSITION",
      "NET CHANGE",
      "CHANGE LONG",
      "CHANGE SHORT",
      "% LONG",
      "% SHORT",
      "POSITIONING"
    ]])
    .setFontWeight("bold");

  const overview = [];

  Object.keys(MARKETS).forEach(function(market) {

    const sheet = ss.getSheetByName(market);

    if (!sheet || sheet.getLastRow() < 2) {
      overview.push([market, "", "", "", "", "", "", "NO DATA"]);
      return;
    }

    const lastRow = sheet.getLastRow();

    const current = sheet.getRange(lastRow, 1, 1, 8).getValues()[0];

    let previousNet = 0;

    if (lastRow >= 3) {
      previousNet = Number(sheet.getRange(lastRow - 1, 8).getValue()) || 0;
    }

    const net = Number(current[7]) || 0;
    const netChange = net - previousNet;
    const changeLong = Number(current[3]) || 0;
    const changeShort = Number(current[4]) || 0;
    const percentLong = Number(current[5]) || 0;
    const percentShort = Number(current[6]) || 0;

    const classification = classifyPositioning(
      net,
      netChange,
      changeLong,
      changeShort
    );

    overview.push([
      market,
      net,
      netChange,
      changeLong,
      changeShort,
      percentLong,
      percentShort,
      classification
    ]);

  });

  dashboard.getRange(8, 1, overview.length, 8).setValues(overview);


  /******************************************************
   * SELECTED MARKET SUMMARY
   ******************************************************/

  dashboard.getRange("A20:H20").merge();

  dashboard
    .getRange("A20")
    .setValue("SELECTED MARKET ANALYSIS")
    .setFontSize(14)
    .setFontWeight("bold");

  dashboard
    .getRange("A22:B28")
    .setValues([
      ["Metric", "Value"],
      ["Latest Date", ""],
      ["Net Position", ""],
      ["Weekly Net Change", ""],
      ["Change Long", ""],
      ["Change Short", ""],
      ["Historical Percentile", ""]
    ])
    .setFontWeight("normal");

  dashboard.getRange("A22:B22").setFontWeight("bold");

  refreshSelectedMarketDashboard(dashboard);


  /******************************************************
   * HISTORICAL DATA AREA
   ******************************************************/

  dashboard
    .getRange("J1:K1")
    .setValues([["DATE", "NET POSITION"]])
    .setFontWeight("bold");

  updateDashboardHistoricalData(dashboard);


  /******************************************************
   * FORMATTING
   ******************************************************/

  dashboard.getRange("B8:G16").setNumberFormat("#,##0.0");
  dashboard.getRange("B8:E16").setNumberFormat("#,##0");
  dashboard.getRange("F8:G16").setNumberFormat("0.0");
  dashboard.getRange("B23").setNumberFormat("dd/mm/yyyy");
  dashboard.getRange("B24:B27").setNumberFormat("#,##0");
  dashboard.getRange("B28").setNumberFormat("0.0");

  dashboard.setFrozenRows(7);

  dashboard.setColumnWidths(1, 8, 125);
  dashboard.setColumnWidth(1, 150);
  dashboard.setColumnWidth(8, 170);
  dashboard.setColumnWidths(10, 2, 110);


  /******************************************************
   * CONDITIONAL FORMATTING AND CHART
   ******************************************************/

  applyDashboardConditionalFormatting(dashboard);

  createDashboardChart(dashboard);

}


/************************************************************
 * POSITIONING CLASSIFICATION
 ************************************************************/

function classifyPositioning(net, netChange, changeLong, changeShort) {

  if (net > 0 && netChange > 0 && changeLong > 0 && changeShort <= 0) {
    return "Increasing bullish positioning";
  }

  if (net < 0 && netChange < 0 && changeLong <= 0 && changeShort > 0) {
    return "Increasing bearish positioning";
  }

  if (net > 0 && netChange > 0) {
    return "Net positioning increasing";
  }

  if (net < 0 && netChange < 0) {
    return "Net positioning decreasing";
  }

  if (changeLong > 0 && changeShort > 0) {
    return "Long and short increasing";
  }

  if (changeLong < 0 && changeShort < 0) {
    return "Long and short decreasing";
  }

  return "Mixed positioning";

}


/************************************************************
 * REFRESH SELECTED MARKET
 ************************************************************/

function refreshSelectedMarketDashboard(dashboard) {

  const market = dashboard.getRange("B4").getValue();

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(market);

  if (!sheet) {
    return;
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const current = sheet.getRange(lastRow, 1, 1, 8).getValues()[0];

  let previousNet = 0;

  if (lastRow >= 3) {
    previousNet = Number(sheet.getRange(lastRow - 1, 8).getValue()) || 0;
  }

  const net = Number(current[7]) || 0;
  const netChange = net - previousNet;

  const values = sheet
    .getRange(2, 8, lastRow - 1, 1)
    .getValues()
    .map(function(row) {
      return Number(row[0]) || 0;
    });

  let percentile = 0;

  if (values.length > 0) {

    const belowOrEqual = values.filter(function(value) {
      return value <= net;
    }).length;

    percentile = (belowOrEqual / values.length) * 100;

  }

  dashboard.getRange("B23:B28").setValues([
    [current[0]],
    [net],
    [netChange],
    [Number(current[3]) || 0],
    [Number(current[4]) || 0],
    [percentile]
  ]);

  dashboard.getRange("B23").setNumberFormat("dd/mm/yyyy");
  dashboard.getRange("B24:B27").setNumberFormat("#,##0");
  dashboard.getRange("B28").setNumberFormat("0.0");

  updateDashboardHistoricalData(dashboard);

  createDashboardChart(dashboard);

}


/************************************************************
 * HISTORICAL DATA FOR SELECTED MARKET
 ************************************************************/

function updateDashboardHistoricalData(dashboard) {

  const market = dashboard.getRange("B4").getValue();

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(market);

  dashboard.getRange("J2:K1000").clearContent();

  if (!sheet) {
    return;
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  const history = values.map(function(row) {
    return [row[0], Number(row[7]) || 0];
  });

  dashboard.getRange(2, 10, history.length, 2).setValues(history);

  dashboard.getRange(2, 10, history.length, 1).setNumberFormat("dd/mm/yyyy");

  dashboard.getRange(2, 11, history.length, 1).setNumberFormat("#,##0");

}


/************************************************************
 * DASHBOARD CHART
 ************************************************************/

function createDashboardChart(dashboard) {

  dashboard.getCharts().forEach(function(chart) {
    dashboard.removeChart(chart);
  });

  const lastHistoryRow = dashboard
    .getRange("J:J")
    .getValues()
    .filter(String)
    .length;

  if (lastHistoryRow < 2) {
    return;
  }

  const market = dashboard.getRange("B4").getValue();

  const chart = dashboard
    .newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(dashboard.getRange("J1:K" + lastHistoryRow))
    .setPosition(22, 4, 0, 0)
    .setOption("title", market + " Net Position History")
    .setOption("legend", { position: "none" })
    .setOption("hAxis", { title: "Date" })
    .setOption("vAxis", { title: "Net Position" })
    .setOption("height", 350)
    .setOption("width", 700)
    .build();

  dashboard.insertChart(chart);

}


/************************************************************
 * DASHBOARD CONDITIONAL FORMATTING
 ************************************************************/

function applyDashboardConditionalFormatting(dashboard) {

  const greenRule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0)
    .setFontColor("#008000")
    .setRanges([dashboard.getRange("B8:E16")])
    .build();

  const redRule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0)
    .setFontColor("#ff0000")
    .setRanges([dashboard.getRange("B8:E16")])
    .build();

  dashboard.setConditionalFormatRules([greenRule, redRule]);

}


/************************************************************
 * INSTALL FRIDAY AND MONDAY TRIGGERS
 ************************************************************/

function installCOTTriggers() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const tz = ss.getSpreadsheetTimeZone();

  const handlers = [
    "updateCOTReport",
    "scheduledCOTCheck",
    "installCOTTrigger",
    "installCOTTriggers",
    "runCOTPipeline"
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("scheduledCOTCheck")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(COT_CHECK_SCHEDULE.fridayHour)
    .inTimezone(tz)
    .create();

  ScriptApp.newTrigger("scheduledCOTCheck")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(COT_CHECK_SCHEDULE.mondayHour)
    .inTimezone(tz)
    .create();

  ss.toast(
    "Checks installed: Friday " + COT_CHECK_SCHEDULE.fridayHour + ":00 and Monday " +
    COT_CHECK_SCHEDULE.mondayHour + ":00 (" + tz + ")."
  );

}


/************************************************************
 * MANUAL DASHBOARD REFRESH
 ************************************************************/

function refreshCOTDashboard() {

  const selected = cotSaveSelection();

  updateCOTDashboard();

  cotRestoreSelection(selected);

  SpreadsheetApp.getActiveSpreadsheet().toast("COT Dashboard refreshed.");

}


/************************************************************
 * GOOGLE SHEETS MENU
 ************************************************************/

function onOpen() {

  SpreadsheetApp
    .getUi()
    .createMenu("COT Report")
    .addItem("Update COT Data", "updateCOTReport")
    .addItem("Check for New Data Now", "scheduledCOTCheck")
    .addItem("Refresh Dashboard", "refreshCOTDashboard")
    .addItem("Install Friday & Monday Checks", "installCOTTriggers")
    .addToUi();

  addHistoricalCOTMenu();

  addCOTAnalysisMenu();

  addCOTDashboardMenu();

}


/************************************************************
 * DASHBOARD MARKET SELECTOR
 ************************************************************/

function onEdit(e) {

  if (!e || !e.range) {
    return;
  }

  const sheet = e.range.getSheet();

  if (sheet.getName() !== "COT Dashboard") {
    return;
  }

  if (e.range.getA1Notation() !== "B4") {
    return;
  }

  refreshSelectedMarketDashboard(sheet);

}


/************************************************************
 * COT HISTORICAL DATABASE
 *
 * LEGACY FUTURES ONLY
 * NON COMMERCIAL ONLY
 *
 * History: January 2021 -> current
 ************************************************************/

const HISTORICAL_START_DATE = "2021-01-01";

const COT_HISTORICAL_SHEET = "COT Historical";

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


/************************************************************
 * CREATE / REBUILD HISTORICAL DATABASE
 ************************************************************/

function buildCOTHistoricalDatabase() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(COT_HISTORICAL_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(COT_HISTORICAL_SHEET);
  }

  // Clear existing historical database
  sheet.clear();

  const headers = [
    "DATE",
    "INSTRUMENT",
    "TYPE",
    "OPEN INTEREST",
    "NON COMMERCIAL LONG",
    "NON COMMERCIAL SHORT",
    "NET POSITION",
    "CHANGE LONG",
    "CHANGE SHORT",
    "CHANGE NET",
    "% LONG OI",
    "% SHORT OI"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  let allRows = [];

  Object.keys(HISTORICAL_INSTRUMENTS).forEach(function(instrument) {

    const config = HISTORICAL_INSTRUMENTS[instrument];

    try {

      const rows = getLegacyHistoricalData(
        instrument,
        config.code,
        config.type
      );

      if (rows.length > 0) {
        allRows = allRows.concat(rows);
      }

      Utilities.sleep(300);

    } catch (error) {

      Logger.log("ERROR loading " + instrument + ": " + error.message);

    }

  });

  // Sort by date then instrument
  allRows.sort(function(a, b) {

    const dateA = new Date(a[0]);
    const dateB = new Date(b[0]);

    if (dateA.getTime() !== dateB.getTime()) {
      return dateA - dateB;
    }

    return String(a[1]).localeCompare(String(b[1]));

  });

  if (allRows.length > 0) {
    sheet
      .getRange(2, 1, allRows.length, headers.length)
      .setValues(allRows);
  }

  // Formatting
  sheet.setFrozenRows(1);

  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

  sheet
    .getRange(2, 1, Math.max(allRows.length, 1), 1)
    .setNumberFormat("dd/MM/yyyy");

  sheet
    .getRange(2, 11, Math.max(allRows.length, 1), 2)
    .setNumberFormat("0.0%");

  sheet.autoResizeColumns(1, headers.length);

  // Apply filter
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }

  if (allRows.length > 0) {
    sheet
      .getRange(1, 1, allRows.length + 1, headers.length)
      .createFilter();
  }

  SpreadsheetApp.flush();

  ss.toast("COT Historical database built: " + allRows.length + " rows.");

}


/************************************************************
 * GET LEGACY COT DATA FOR ONE INSTRUMENT
 ************************************************************/

function getLegacyHistoricalData(instrument, contractCode, instrumentType) {

  return getLegacyHistoricalDataFromDate(
    instrument,
    contractCode,
    instrumentType,
    HISTORICAL_START_DATE
  );

}


/************************************************************
 * HISTORICAL DATA FROM A SPECIFIC DATE
 ************************************************************/

function getLegacyHistoricalDataFromDate(
  instrument,
  contractCode,
  instrumentType,
  startDate
) {

  const baseUrl = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

  const where =
    "report_date_as_yyyy_mm_dd >= '" + startDate + "' AND " +
    "cftc_contract_market_code = '" + contractCode + "'";

  const params = {

    "$select":
      "report_date_as_yyyy_mm_dd," +
      "market_and_exchange_names," +
      "cftc_contract_market_code," +
      "open_interest_all," +
      "noncomm_positions_long_all," +
      "noncomm_positions_short_all," +
      "change_in_noncomm_long_all," +
      "change_in_noncomm_short_all," +
      "pct_of_oi_noncomm_long_all," +
      "pct_of_oi_noncomm_short_all",

    "$where": where,

    "$order": "report_date_as_yyyy_mm_dd ASC",

    "$limit": "50000"

  };

  const queryParts = Object.keys(params).map(function(key) {
    return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
  });

  const response = UrlFetchApp.fetch(baseUrl + "?" + queryParts.join("&"), {
    method: "get",
    muteHttpExceptions: true,
    headers: { "Accept": "application/json" }
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status !== 200) {
    throw new Error(
      "CFTC API returned HTTP " + status + " for " + instrument +
      ". Response: " + body.substring(0, 500)
    );
  }

  const data = JSON.parse(body);

  if (!Array.isArray(data)) {
    throw new Error("Unexpected CFTC response for " + instrument);
  }

  const output = [];

  data.forEach(function(row) {

    const openInterest = Number(row.open_interest_all || 0);
    const longPosition = Number(row.noncomm_positions_long_all || 0);
    const shortPosition = Number(row.noncomm_positions_short_all || 0);
    const changeLong = Number(row.change_in_noncomm_long_all || 0);
    const changeShort = Number(row.change_in_noncomm_short_all || 0);

    output.push([
      cotNoonDate(row.report_date_as_yyyy_mm_dd),
      instrument,
      instrumentType,
      openInterest,
      longPosition,
      shortPosition,
      longPosition - shortPosition,
      changeLong,
      changeShort,
      changeLong - changeShort,
      openInterest > 0 ? longPosition / openInterest : 0,
      openInterest > 0 ? shortPosition / openInterest : 0
    ]);

  });

  Logger.log(instrument + ": " + output.length + " historical rows loaded.");

  return output;

}


/************************************************************
 * UPDATE HISTORICAL DATABASE WITH NEW DATA
 *
 * This does NOT rebuild the entire database.
 * It only adds observations newer than the latest
 * date already stored.
 ************************************************************/

function updateCOTHistoricalDatabase() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheet = ss.getSheetByName(COT_HISTORICAL_SHEET);

  if (!sheet || sheet.getLastRow() < 2) {
    buildCOTHistoricalDatabase();
    return;
  }

  const lastRow = sheet.getLastRow();

  const latest = {};
  const seen = {};

  sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(function(r) {

    if (!r[0] || !r[1]) {
      return;
    }

    const key = cotToDateKey(r[0]);
    const name = String(r[1]);

    seen[name + "|" + key] = true;

    if (!latest[name] || key > latest[name]) {
      latest[name] = key;
    }

  });

  const newRows = [];
  const failed = [];

  Object.keys(HISTORICAL_INSTRUMENTS).forEach(function(instrument) {

    const config = HISTORICAL_INSTRUMENTS[instrument];

    try {

      const rows = getLegacyHistoricalDataFromDate(
        instrument,
        config.code,
        config.type,
        latest[instrument] || HISTORICAL_START_DATE
      );

      rows.forEach(function(row) {
        if (!seen[instrument + "|" + cotToDateKey(row[0])]) {
          newRows.push(row);
        }
      });

      Utilities.sleep(300);

    } catch (error) {

      Logger.log("ERROR updating " + instrument + ": " + error.message);
      failed.push(instrument);

    }

  });

  if (newRows.length > 0) {

    newRows.sort(function(a, b) {

      const dateA = cotToDateKey(a[0]);
      const dateB = cotToDateKey(b[0]);

      if (dateA !== dateB) {
        return dateA < dateB ? -1 : 1;
      }

      return String(a[1]).localeCompare(String(b[1]));

    });

    const start = sheet.getLastRow() + 1;

    sheet.getRange(start, 1, newRows.length, newRows[0].length).setValues(newRows);

    sheet.getRange(start, 1, newRows.length, 1).setNumberFormat("dd/MM/yyyy");
    sheet.getRange(start, 11, newRows.length, 2).setNumberFormat("0.0%");

    ss.toast("Added " + newRows.length + " new COT observations.");

  } else {

    ss.toast("No new historical COT data available.");

  }

  if (failed.length > 0) {
    throw new Error("Historical update incomplete for: " + failed.join(", "));
  }

}


/************************************************************
 * TEST ONE INSTRUMENT
 *
 * Use this before running the full historical import.
 ************************************************************/

function testCOTHistoricalXAU() {

  const rows = getLegacyHistoricalData("XAU", "088691", "Metal");

  Logger.log("XAU rows returned: " + rows.length);

  if (rows.length > 0) {
    Logger.log("First row: " + JSON.stringify(rows[0]));
    Logger.log("Last row: " + JSON.stringify(rows[rows.length - 1]));
  }

}


/************************************************************
 * MENU
 ************************************************************/

function addHistoricalCOTMenu() {

  SpreadsheetApp
    .getUi()
    .createMenu("COT Historical")
    .addItem("Build Historical Database", "buildCOTHistoricalDatabase")
    .addItem("Update Historical Database", "updateCOTHistoricalDatabase")
    .addItem("Test XAU Import", "testCOTHistoricalXAU")
    .addToUi();

}


/************************************************************
 * VALIDATE HISTORICAL DATABASE
 ************************************************************/

function validateCOTHistoricalDatabase() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheet = ss.getSheetByName(COT_HISTORICAL_SHEET);

  if (!sheet) {
    throw new Error("COT Historical sheet not found.");
  }

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    throw new Error("COT Historical contains no data.");
  }

  const headers = values[0];
  const rows = values.slice(1);

  const col = {};

  [
    "DATE", "INSTRUMENT", "OPEN INTEREST", "NON COMMERCIAL LONG",
    "NON COMMERCIAL SHORT", "NET POSITION", "CHANGE LONG", "CHANGE SHORT",
    "CHANGE NET", "% LONG OI", "% SHORT OI"
  ].forEach(function(name) {

    const index = headers.indexOf(name);

    if (index === -1) {
      throw new Error("Missing required column: " + name);
    }

    col[name] = index;

  });

  const instruments = Object.keys(HISTORICAL_INSTRUMENTS);

  const byInstrument = {};
  const allDates = {};

  instruments.forEach(function(name) {
    byInstrument[name] = [];
  });

  rows.forEach(function(row) {

    const name = row[col["INSTRUMENT"]];

    if (!byInstrument[name] || !row[col["DATE"]]) {
      return;
    }

    const key = cotToDateKey(row[col["DATE"]]);

    byInstrument[name].push({ key: key, row: row });

    allDates[key] = true;

  });

  const allKeys = Object.keys(allDates).sort();

  const globalLatest = allKeys[allKeys.length - 1];

  const output = [[
    "INSTRUMENT", "ROWS", "EARLIEST DATE", "LATEST DATE", "DUPLICATE DATES",
    "MISSING VALUES", "CALCULATION ERRORS", "MISSING WEEKS", "LAG (DAYS)",
    "STATUS", "NOTES"
  ]];

  let attention = 0;

  instruments.forEach(function(name) {

    const list = byInstrument[name];

    if (list.length === 0) {
      attention++;
      output.push([name, 0, "", "", 0, 0, 0, 0, "", "CHECK", "No rows found"]);
      return;
    }

    const seenKeys = {};

    let duplicates = 0;
    let missingValues = 0;
    let calculationErrors = 0;

    list.forEach(function(item) {

      if (seenKeys[item.key]) {
        duplicates++;
      }

      seenKeys[item.key] = true;

      const r = item.row;

      [
        "OPEN INTEREST", "NON COMMERCIAL LONG", "NON COMMERCIAL SHORT",
        "NET POSITION", "CHANGE LONG", "CHANGE SHORT", "CHANGE NET",
        "% LONG OI", "% SHORT OI"
      ].forEach(function(name2) {

        const v = r[col[name2]];

        if (v === "" || v === null || v === undefined) {
          missingValues++;
        }

      });

      const netOk =
        Math.abs(
          Number(r[col["NON COMMERCIAL LONG"]]) -
          Number(r[col["NON COMMERCIAL SHORT"]]) -
          Number(r[col["NET POSITION"]])
        ) <= 0.01;

      const changeOk =
        Math.abs(
          Number(r[col["CHANGE LONG"]]) -
          Number(r[col["CHANGE SHORT"]]) -
          Number(r[col["CHANGE NET"]])
        ) <= 0.01;

      if (!netOk || !changeOk) {
        calculationErrors++;
      }

    });

    const keys = Object.keys(seenKeys).sort();

    const first = keys[0];
    const last = keys[keys.length - 1];

    const expectedWeeks = allKeys.filter(function(k) {
      return k >= first && k <= last;
    });

    const missingWeeks = expectedWeeks.filter(function(k) {
      return !seenKeys[k];
    }).length;

    let largestGap = 0;

    for (let i = 1; i < keys.length; i++) {
      largestGap = Math.max(largestGap, cotDayNumber(keys[i]) - cotDayNumber(keys[i - 1]));
    }

    const lag = cotDayNumber(globalLatest) - cotDayNumber(last);

    const notes = [];

    if (duplicates > 0) { notes.push(duplicates + " duplicate date(s)"); }
    if (missingValues > 0) { notes.push(missingValues + " missing value(s)"); }
    if (calculationErrors > 0) { notes.push(calculationErrors + " calculation mismatch(es)"); }
    if (missingWeeks > 0) { notes.push(missingWeeks + " week(s) missing vs other instruments"); }
    if (largestGap > 10) { notes.push("gap of " + largestGap + " days"); }
    if (lag > 0) { notes.push("missing latest report: " + lag + " days behind other instruments"); }

    const status = notes.length === 0 ? "PASS" : "CHECK";

    if (status !== "PASS") {
      attention++;
    }

    output.push([
      name,
      list.length,
      cotNoonDate(first),
      cotNoonDate(last),
      duplicates,
      missingValues,
      calculationErrors,
      missingWeeks,
      lag,
      status,
      notes.join("; ")
    ]);

  });

  let validationSheet = ss.getSheetByName("COT Database Validation");

  if (!validationSheet) {
    validationSheet = ss.insertSheet("COT Database Validation");
  } else {
    validationSheet.clear();
  }

  validationSheet.getRange(1, 1, output.length, output[0].length).setValues(output);
  validationSheet.getRange(1, 1, 1, output[0].length).setFontWeight("bold");
  validationSheet.getRange(2, 3, output.length - 1, 2).setNumberFormat("dd/MM/yyyy");
  validationSheet.autoResizeColumns(1, output[0].length);

  Logger.log("COT Historical validation: " + attention + " instrument(s) need attention.");

  ss.toast(
    attention === 0
      ? "COT Historical validation PASSED."
      : "COT Historical validation requires attention (" + attention + ")."
  );

  return attention;

}


/************************************************************
 * COT STRENGTH MATRIX (v2)
 *
 * All measures are point in time: each one is calculated
 * using only data up to and including the date measured.
 * That makes computeCOTMetricsAt() safe to reuse for
 * backtesting later (no look-ahead).
 *
 *  NET PERCENTILE       Net position vs its own history (0-100)
 *  4W MOMENTUM          Net minus the 4 week average net
 *  MOMENTUM PERCENTILE  4W momentum vs its own history (0-100)
 *  MOMENTUM PCT CHANGE  Momentum percentile now minus last
 *                       week, both ranked against the same
 *                       reference history (percentile points)
 *  ACCELERATION         Weekly net change minus previous
 *                       week's net change (raw contracts)
 *  NORM ACCELERATION    Acceleration divided by the standard
 *                       deviation of its own history, so it
 *                       is comparable across instruments
 ************************************************************/

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


// Returns 0-1: share of values less than or equal to currentValue.
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


/************************************************************
 * COMPUTE ALL METRICS AT ONE POINT IN TIME
 *
 * data  = array of {date, net, changeLong, changeShort,
 *         changeNet} sorted by date ascending
 * index = position in data to measure
 *
 * Only data[0..index] is used.
 ************************************************************/

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


/************************************************************
 * BUILD STRENGTH MATRIX SHEET
 ************************************************************/

function buildCOTStrengthMatrix() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName("COT Historical");

  if (!sourceSheet) {
    throw new Error("COT Historical sheet not found.");
  }

  const values = sourceSheet.getDataRange().getValues();

  if (values.length < 2) {
    throw new Error("COT Historical contains no data.");
  }

  const headers = values[0];
  const rows = values.slice(1);

  const idx = {
    date: headers.indexOf("DATE"),
    instrument: headers.indexOf("INSTRUMENT"),
    net: headers.indexOf("NET POSITION"),
    changeLong: headers.indexOf("CHANGE LONG"),
    changeShort: headers.indexOf("CHANGE SHORT"),
    changeNet: headers.indexOf("CHANGE NET")
  };

  Object.keys(idx).forEach(function(key) {
    if (idx[key] === -1) {
      throw new Error("Required column not found: " + key);
    }
  });

  const instruments = [
    "AUD",
    "GBP",
    "CAD",
    "EUR",
    "JPY",
    "CHF",
    "Dollar Index",
    "NZD",
    "XAU",
    "XAG",
    "WTI",
    "Brent"
  ];

  /*
   * Build a clean history for each instrument.
   */

  const history = {};

  instruments.forEach(function(instrument) {

    history[instrument] = [];

    rows.forEach(function(row) {

      if (row[idx.instrument] !== instrument) {
        return;
      }

      history[instrument].push({
        date: new Date(row[idx.date]),
        net: Number(row[idx.net]),
        changeLong: Number(row[idx.changeLong]),
        changeShort: Number(row[idx.changeShort]),
        changeNet: Number(row[idx.changeNet])
      });

    });

    history[instrument].sort(function(a, b) {
      return a.date - b.date;
    });

  });

  /*
   * Find the latest common COT date.
   */

  let latestDate = null;

  instruments.forEach(function(instrument) {

    const data = history[instrument];

    if (!data.length) {
      throw new Error("No historical data found for " + instrument);
    }

    const instrumentLatestDate = data[data.length - 1].date;

    if (!latestDate || instrumentLatestDate < latestDate) {
      latestDate = instrumentLatestDate;
    }

  });

  /*
   * Build output.
   */

  const output = [[
    "INSTRUMENT",
    "DATE",
    "CURRENT NET",
    "WEEKLY NET CHANGE",
    "4W NET CHANGE",
    "LONG CHANGE",
    "SHORT CHANGE",
    "NET PERCENTILE",
    "4W MOMENTUM",
    "ACCELERATION",
    "POSITIONING",
    "EXTREME",
    "REVERSAL",
    "MOMENTUM PERCENTILE",
    "MOMENTUM PCT CHANGE",
    "NORM ACCELERATION"
  ]];

  instruments.forEach(function(instrument) {

    const data = history[instrument];

    /*
     * Use the latest record available on or before
     * the common latest date.
     */

    let latestIndex = -1;

    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].date <= latestDate) {
        latestIndex = i;
        break;
      }
    }

    if (latestIndex === -1) {
      return;
    }

    const m = computeCOTMetricsAt(data, latestIndex);

    output.push([
      instrument,
      m.date,
      m.net,
      m.changeNet,
      m.fourWeekChange,
      m.changeLong,
      m.changeShort,
      cotRound(m.netPercentile * 100, 1),
      cotRound(m.momentum, 0),
      cotRound(m.acceleration, 0),
      m.positioning,
      m.extreme,
      m.reversal,
      cotRound(m.momentumPercentile, 1),
      cotRound(m.momentumPctChange, 1),
      cotRound(m.normAcceleration, 2)
    ]);

  });

  /*
   * Create or refresh the Strength Matrix sheet.
   */

  let matrix = ss.getSheetByName("COT Strength Matrix");

  if (!matrix) {
    matrix = ss.insertSheet("COT Strength Matrix");
  } else {
    matrix.clear();
    matrix.clearConditionalFormatRules();
  }

  matrix
    .getRange(1, 1, output.length, output[0].length)
    .setValues(output);

  /*
   * Formatting.
   */

  matrix.getRange(1, 1, 1, output[0].length).setFontWeight("bold");

  matrix.getRange(2, 2, output.length - 1, 1).setNumberFormat("dd/MM/yyyy");

  matrix.getRange(2, 8, output.length - 1, 1).setNumberFormat("0.0");

  matrix.getRange(2, 14, output.length - 1, 2).setNumberFormat("0.0");

  matrix.getRange(2, 16, output.length - 1, 1).setNumberFormat("0.00");

  matrix.autoResizeColumns(1, output[0].length);

  matrix.setFrozenRows(1);

  /*
   * Conditional formatting for both percentile columns.
   */

  const rules = [];

  [8, 14].forEach(function(column) {

    const range = matrix.getRange(2, column, output.length - 1, 1);

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberGreaterThanOrEqualTo(80)
        .setFontColor("#008000")
        .setRanges([range])
        .build()
    );

    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThanOrEqualTo(20)
        .setFontColor("#cc0000")
        .setRanges([range])
        .build()
    );

  });

  matrix.setConditionalFormatRules(rules);

  /*
   * Sort by net percentile, highest first.
   */

  if (output.length > 2) {
    matrix
      .getRange(2, 1, output.length - 1, output[0].length)
      .sort({ column: 8, ascending: false });
  }

  ss.toast("COT Strength Matrix v2 updated.");

  Logger.log("COT Strength Matrix v2 created successfully.");

}


/************************************************************
 * COT PAIR SCANNER (v2)
 *
 * Built on the Strength Matrix v2 measures:
 *
 *   Positioning  = NET PERCENTILE          (0-100)
 *   Momentum     = MOMENTUM PERCENTILE     (0-100)
 *   Acceleration = NORM ACCELERATION       (sigma, capped and
 *                  rescaled to +/-50 so it sits on the same
 *                  scale as a percentile minus 50)
 *
 * Each component is "base minus quote", so every divergence
 * is in comparable points (roughly -100 to +100).
 *
 * RELATIVE SCORE = weighted average of the three divergences.
 * Positive = base stronger than quote = bullish for the pair.
 *
 * USD STRENGTH = Dollar Index positioning, used as is.
 * (Net long Dollar Index futures = long USD, the same
 * direction as net long EUR futures = long EUR.)
 ************************************************************/

const PAIR_WEIGHTS = {
  positioning: 0.50,
  momentum: 0.30,
  acceleration: 0.20
};

// Relative score needed before a bias is declared.
const PAIR_BIAS_THRESHOLD = 20;

// Normalised acceleration is capped at this many sigma.
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


/************************************************************
 * HELPERS
 ************************************************************/

function scalePairAcceleration(sigma) {

  const capped = Math.max(
    -PAIR_ACCELERATION_CAP,
    Math.min(PAIR_ACCELERATION_CAP, sigma)
  );

  return (capped / PAIR_ACCELERATION_CAP) * 50;

}


function cotHasSignal(value) {

  return Boolean(value) && value !== "No" && value !== "None";

}


// USD is represented by the Dollar Index (not inverted).
function getCOTPairComponent(matrix, name) {

  const key = name === "USD" ? "Dollar Index" : name;

  const item = matrix[key];

  if (!item) {
    throw new Error(
      'Instrument "' + key + '" not found in COT Strength Matrix.'
    );
  }

  return item;

}


/************************************************************
 * SCORE ONE PAIR (pure function, no sheet access)
 ************************************************************/

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


/************************************************************
 * BUILD PAIR SCANNER SHEET
 ************************************************************/

function buildCOTPairScanner() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matrixSheet = ss.getSheetByName("COT Strength Matrix");

  if (!matrixSheet) {
    throw new Error(
      "COT Strength Matrix sheet not found. Run buildCOTStrengthMatrix first."
    );
  }

  const values = matrixSheet.getDataRange().getValues();

  if (values.length < 2) {
    throw new Error("COT Strength Matrix contains no data.");
  }

  const headers = values[0];

  const col = {};

  headers.forEach(function(header, index) {
    col[String(header).trim()] = index;
  });

  const requiredColumns = [
    "INSTRUMENT",
    "DATE",
    "NET PERCENTILE",
    "MOMENTUM PERCENTILE",
    "MOMENTUM PCT CHANGE",
    "NORM ACCELERATION",
    "POSITIONING",
    "EXTREME",
    "REVERSAL"
  ];

  requiredColumns.forEach(function(header) {
    if (col[header] === undefined) {
      throw new Error(
        'COT Strength Matrix is missing the column "' + header +
        '". Re-run buildCOTStrengthMatrix (v2) first.'
      );
    }
  });

  /*
   * Instrument lookup.
   */

  const matrix = {};

  for (let r = 1; r < values.length; r++) {

    const row = values[r];

    const instrument = String(row[col["INSTRUMENT"]]).trim();

    if (!instrument) {
      continue;
    }

    matrix[instrument] = {
      date: row[col["DATE"]],
      netPercentile: Number(row[col["NET PERCENTILE"]]) || 0,
      momentumPercentile: Number(row[col["MOMENTUM PERCENTILE"]]) || 0,
      momentumPctChange: Number(row[col["MOMENTUM PCT CHANGE"]]) || 0,
      normAcceleration: Number(row[col["NORM ACCELERATION"]]) || 0,
      positioning: String(row[col["POSITIONING"]] || ""),
      extreme: String(row[col["EXTREME"]] || ""),
      reversal: String(row[col["REVERSAL"]] || "")
    };

  }

  /*
   * Output.
   */

  const output = [[
    "PAIR",
    "DATE",
    "BASE",
    "QUOTE",
    "BASE NET PCTL",
    "QUOTE NET PCTL",
    "POSITIONING DIVERGENCE",
    "BASE MOM PCTL",
    "QUOTE MOM PCTL",
    "MOMENTUM DIVERGENCE",
    "MOM PCT CHANGE DIVERGENCE",
    "BASE NORM ACCEL",
    "QUOTE NORM ACCEL",
    "ACCELERATION DIVERGENCE",
    "RELATIVE SCORE",
    "BIAS",
    "BASE POSITIONING",
    "QUOTE POSITIONING",
    "EXTREME / REVERSAL"
  ]];

  PAIR_LIST.forEach(function(pair) {

    const pairName = pair[0];
    const baseName = pair[1];
    const quoteName = pair[2];

    const base = getCOTPairComponent(matrix, baseName);
    const quote = getCOTPairComponent(matrix, quoteName);

    const result = scoreCOTPair(base, quote);

    const signals = [];

    if (cotHasSignal(base.extreme)) {
      signals.push(baseName + ": " + base.extreme);
    }

    if (cotHasSignal(quote.extreme)) {
      signals.push(quoteName + ": " + quote.extreme);
    }

    if (cotHasSignal(base.reversal)) {
      signals.push(baseName + ": " + base.reversal);
    }

    if (cotHasSignal(quote.reversal)) {
      signals.push(quoteName + ": " + quote.reversal);
    }

    output.push([
      pairName,
      base.date,
      baseName,
      quoteName,
      base.netPercentile,
      quote.netPercentile,
      result.positioningDivergence,
      base.momentumPercentile,
      quote.momentumPercentile,
      result.momentumDivergence,
      result.momentumChangeDivergence,
      base.normAcceleration,
      quote.normAcceleration,
      result.accelerationDivergence,
      result.relativeScore,
      result.bias,
      base.positioning,
      quote.positioning,
      signals.length > 0 ? signals.join(" | ") : "None"
    ]);

  });

  /*
   * Write sheet.
   */

  let sheet = ss.getSheetByName("COT Pair Scanner");

  if (!sheet) {
    sheet = ss.insertSheet("COT Pair Scanner");
  } else {
    sheet.clear();
    sheet.clearFormats();
    sheet.clearConditionalFormatRules();
  }

  const rowCount = output.length - 1;

  sheet
    .getRange(1, 1, output.length, output[0].length)
    .setValues(output);

  /*
   * Formatting.
   */

  sheet.getRange(1, 1, 1, output[0].length).setFontWeight("bold");

  sheet.getRange(2, 2, rowCount, 1).setNumberFormat("dd/MM/yyyy");

  sheet.getRange(2, 5, rowCount, 7).setNumberFormat("0.0");

  sheet.getRange(2, 12, rowCount, 2).setNumberFormat("0.00");

  sheet.getRange(2, 14, rowCount, 2).setNumberFormat("0.0");

  sheet.setFrozenRows(1);

  sheet.autoResizeColumns(1, output[0].length);

  /*
   * Conditional formatting: bias text and relative score.
   */

  const biasRange = sheet.getRange(2, 16, rowCount, 1);
  const scoreRange = sheet.getRange(2, 15, rowCount, 1);

  sheet.setConditionalFormatRules([

    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("Bullish")
      .setFontColor("#008000")
      .setRanges([biasRange])
      .build(),

    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("Bearish")
      .setFontColor("#ff0000")
      .setRanges([biasRange])
      .build(),

    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(PAIR_BIAS_THRESHOLD)
      .setFontColor("#008000")
      .setRanges([scoreRange])
      .build(),

    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThanOrEqualTo(-PAIR_BIAS_THRESHOLD)
      .setFontColor("#ff0000")
      .setRanges([scoreRange])
      .build()

  ]);

  ss.toast("COT Pair Scanner v2 updated successfully.");

}

/************************************************************
 * COT BACKTEST
 *
 * Tests the frozen Pair Scanner score against subsequent
 * 1, 2 and 4 week returns.
 *
 * Price layout ("COT Prices" sheet): one 2 column block per
 * pair, in PAIR_LIST order.
 *   Row 1  = pair name (above the Date column)
 *   Row 2  = "Date" / "Close" (GOOGLEFINANCE writes this)
 *   Row 3+ = daily data
 *
 * FX pairs: GOOGLEFINANCE formulas (then frozen to values).
 * XAU, XAG, WTI, Brent: imported from CSV sheets.
 ************************************************************/
 
const COT_PRICES_SHEET = "COT Prices";
const BACKTEST_DATA_SHEET = "COT Backtest Data";
const BACKTEST_SUMMARY_SHEET = "COT Backtest Summary";
 
const BACKTEST_WARMUP_WEEKS = 52;
const BACKTEST_HORIZONS = [1, 2, 4];
 
// Entry must be within this many days after the Friday release.
const BACKTEST_ENTRY_MAX_GAP_DAYS = 5;
 
// Exit close must be within this many days before the target date.
const BACKTEST_EXIT_MAX_GAP_DAYS = 4;
 
const FX_PRICE_TICKERS = {
  "EUR/USD": "EURUSD",
  "GBP/USD": "GBPUSD",
  "AUD/USD": "AUDUSD",
  "NZD/USD": "NZDUSD",
  "USD/JPY": "USDJPY",
  "USD/CHF": "USDCHF",
  "USD/CAD": "USDCAD",
  "EUR/GBP": "EURGBP",
  "EUR/JPY": "EURJPY",
  "GBP/JPY": "GBPJPY",
  "AUD/JPY": "AUDJPY",
  "NZD/JPY": "NZDJPY",
  "CAD/JPY": "CADJPY",
  "EUR/CHF": "EURCHF",
  "GBP/CHF": "GBPCHF",
  "AUD/CAD": "AUDCAD",
  "AUD/NZD": "AUDNZD"
};
 
// Import each CSV as a NEW SHEET with exactly these names.
const COMMODITY_CSV_SHEETS = {
  "XAU/USD": "CSV_XAU",
  "XAG/USD": "CSV_XAG",
  "WTI/USD": "CSV_WTI",
  "Brent/USD": "CSV_Brent"
};
 
 
/************************************************************
 * MENU FOR ANALYSIS TOOLS
 ************************************************************/
 
function addCOTAnalysisMenu() {
 
  SpreadsheetApp
    .getUi()
    .createMenu("COT Analysis")
    .addItem("Build Strength Matrix", "buildCOTStrengthMatrix")
    .addItem("Build Pair Scanner", "buildCOTPairScanner")
    .addSeparator()
    .addItem("Set Up Price Sheet", "setupCOTPricesSheet")
    .addItem("Freeze FX Price Formulas", "freezeCOTPriceFormulas")
    .addItem("Import Commodity CSVs", "importCOTCommodityCSVs")
    .addSeparator()
    .addItem("Run Backtest", "runCOTBacktest")
    .addToUi();
 
}
 
 
/************************************************************
 * PRICE SHEET SETUP
 ************************************************************/
 
function setupCOTPricesSheet() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(COT_PRICES_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(COT_PRICES_SHEET);
  }

  const neededColumns = PAIR_LIST.length * 2;
  const neededRows = 2500;

  if (sheet.getMaxColumns() < neededColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededColumns - sheet.getMaxColumns());
  }

  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  }

  const skipped = [];

  PAIR_LIST.forEach(function(pair, i) {

    const name = pair[0];
    const col = i * 2 + 1;

    sheet.getRange(1, col).setValue(name).setFontWeight("bold");

    sheet
      .getRange(3, col, sheet.getMaxRows() - 2, 1)
      .setNumberFormat("yyyy-mm-dd");

    if (FX_PRICE_TICKERS[name]) {

      const hasFormula = sheet.getRange(2, col).getFormula() !== "";
      const hasFrozenData = sheet.getRange(3, col).getValue() instanceof Date;

      if (hasFrozenData && !hasFormula) {
        skipped.push(name);
        return;
      }

      sheet.getRange(2, col, sheet.getMaxRows() - 1, 2).clearContent();

      sheet
        .getRange(2, col)
        .setFormula(
          '=GOOGLEFINANCE("CURRENCY:' + FX_PRICE_TICKERS[name] +
          '","close",DATE(2020,12,1),TODAY())'
        );

    } else if (sheet.getRange(2, col).getValue() === "") {

      sheet.getRange(2, col, 1, 2).setValues([["Date", "Close"]]);

    }

  });

  ss.toast(
    "Price sheet ready." +
    (skipped.length ? " Frozen blocks kept: " + skipped.length + "." : " FX formulas are loading.") +
    " Import the commodity CSVs next, then freeze the FX formulas."
  );

}
 
 
/************************************************************
 * FREEZE FX FORMULAS TO VALUES
 *
 * GOOGLEFINANCE recalculates, so history can change or
 * error later. Freezing keeps the backtest reproducible.
 ************************************************************/
 
function freezeCOTPriceFormulas() {
 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
 
  const sheet = ss.getSheetByName(COT_PRICES_SHEET);
 
  if (!sheet) {
    throw new Error("Run setupCOTPricesSheet first.");
  }
 
  const lastRow = sheet.getLastRow();
 
  const problems = [];
 
  PAIR_LIST.forEach(function(pair, i) {
 
    const name = pair[0];
 
    if (!FX_PRICE_TICKERS[name]) {
      return;
    }
 
    const col = i * 2 + 1;
 
    if (lastRow < 3) {
      problems.push(name + " (no data)");
      return;
    }
 
    const range = sheet.getRange(2, col, lastRow - 1, 2);
 
    const values = range.getValues();
 
    let dataRows = 0;
    let bad = false;
 
    values.forEach(function(row, r) {
 
      row.forEach(function(value) {
        if (
          typeof value === "string" &&
          (value.charAt(0) === "#" || value.indexOf("Loading") !== -1)
        ) {
          bad = true;
        }
      });
 
      if (r > 0 && row[0] instanceof Date) {
        dataRows++;
      }
 
    });
 
    if (bad || dataRows < 100) {
      problems.push(name + " (" + dataRows + " rows)");
      return;
    }
 
    range.setValues(values);
 
  });
 
  if (problems.length > 0) {
    throw new Error(
      "These blocks were not frozen (still loading, errors or too " +
      "few rows). Wait a minute and run again: " + problems.join(", ")
    );
  }
 
  ss.toast("FX price formulas frozen to values.");
 
}
 
 
/************************************************************
 * IMPORT COMMODITY CSVs
 *
 * 1. File > Import > Upload the CSV > "Insert new sheet"
 * 2. Name the new sheet CSV_XAU, CSV_XAG, CSV_WTI, CSV_Brent
 * 3. Run importCOTCommodityCSVs
 *
 * The CSV needs a "Date" column and a "Close" column
 * (Yahoo Finance and Stooq exports both have these).
 ************************************************************/
 
function importCOTCommodityCSVs() {
 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
 
  const priceSheet = ss.getSheetByName(COT_PRICES_SHEET);
 
  if (!priceSheet) {
    throw new Error("Run setupCOTPricesSheet first.");
  }
 
  const imported = [];
  const missing = [];
 
  Object.keys(COMMODITY_CSV_SHEETS).forEach(function(pairName) {
 
    const sourceName = COMMODITY_CSV_SHEETS[pairName];
 
    const source = ss.getSheetByName(sourceName);
 
    if (!source) {
      missing.push(sourceName);
      return;
    }
 
    const pairIndex = PAIR_LIST.findIndex(function(pair) {
      return pair[0] === pairName;
    });
 
    const col = pairIndex * 2 + 1;
 
    const values = source.getDataRange().getValues();
 
    if (values.length < 2) {
      throw new Error(sourceName + " contains no data.");
    }
 
    const headers = values[0].map(function(header) {
      return String(header).trim().toLowerCase();
    });
 
    const dateCol = headers.indexOf("date");
    const closeCol = headers.indexOf("close");
 
    if (dateCol === -1 || closeCol === -1) {
      throw new Error(
        sourceName + ' needs a "Date" and a "Close" column in row 1.'
      );
    }
 
    const points = {};
 
    for (let r = 1; r < values.length; r++) {
 
      let date = values[r][dateCol];
 
      if (!(date instanceof Date)) {
 
        const text = String(date).trim();
 
        date = /^\d{4}-\d{2}-\d{2}/.test(text)
          ? parseCFTCDate(text.substring(0, 10))
          : new Date(text);
 
      }
 
      const close = Number(
        String(values[r][closeCol]).replace(/,/g, "")
      );
 
      if (isNaN(date.getTime()) || !isFinite(close) || close <= 0) {
        continue;
      }
 
      points[normaliseDate(date)] = close;
 
    }
 
    const keys = Object.keys(points).sort();
 
    if (keys.length < 100) {
      throw new Error(
        sourceName + " produced only " + keys.length +
        " usable rows. Check the Date and Close columns."
      );
    }
 
    const output = keys.map(function(key) {
      return [parseCFTCDate(key), points[key]];
    });
 
    priceSheet
      .getRange(3, col, priceSheet.getMaxRows() - 2, 2)
      .clearContent();
 
    priceSheet.getRange(2, col, 1, 2).setValues([["Date", "Close"]]);
 
    priceSheet
      .getRange(3, col, output.length, 2)
      .setValues(output);
 
    priceSheet
      .getRange(3, col, output.length, 1)
      .setNumberFormat("yyyy-mm-dd");
 
    imported.push(pairName + " (" + output.length + " rows)");
 
  });
 
  ss.toast(
    (imported.length ? "Imported: " + imported.join(", ") + ". " : "") +
    (missing.length ? "Sheets not found: " + missing.join(", ") + "." : "")
  );
 
  Logger.log("Imported: " + imported.join(", "));
  Logger.log("Missing: " + missing.join(", "));
 
}
 
 
/************************************************************
 * DATE HELPERS
 ************************************************************/
 
// "yyyy-MM-dd" -> whole days since 1970-01-01.
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
 
 
// Index of the first element greater than day (length if none).
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
 
 
/************************************************************
 * LOAD DATA FOR THE BACKTEST
 ************************************************************/
 
function loadBacktestHistories() {
 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
 
  const sheet = ss.getSheetByName(COT_HISTORICAL_SHEET);
 
  if (!sheet) {
    throw new Error("COT Historical sheet not found.");
  }
 
  const values = sheet.getDataRange().getValues();
 
  const headers = values[0];
 
  const idx = {
    date: headers.indexOf("DATE"),
    instrument: headers.indexOf("INSTRUMENT"),
    net: headers.indexOf("NET POSITION"),
    changeLong: headers.indexOf("CHANGE LONG"),
    changeShort: headers.indexOf("CHANGE SHORT"),
    changeNet: headers.indexOf("CHANGE NET")
  };
 
  Object.keys(idx).forEach(function(key) {
    if (idx[key] === -1) {
      throw new Error("Required column not found: " + key);
    }
  });
 
  const seen = {};
  const history = {};
 
  Object.keys(HISTORICAL_INSTRUMENTS).forEach(function(name) {
    seen[name] = {};
  });
 
  for (let r = 1; r < values.length; r++) {
 
    const row = values[r];
 
    const name = row[idx.instrument];
 
    if (!seen[name]) {
      continue;
    }
 
    const date = new Date(row[idx.date]);
 
    if (isNaN(date.getTime())) {
      continue;
    }
 
    const key = normaliseDate(date);
 
    seen[name][key] = {
      date: date,
      dateKey: key,
      net: Number(row[idx.net]),
      changeLong: Number(row[idx.changeLong]),
      changeShort: Number(row[idx.changeShort]),
      changeNet: Number(row[idx.changeNet])
    };
 
  }
 
  Object.keys(seen).forEach(function(name) {
 
    history[name] = Object.keys(seen[name])
      .sort()
      .map(function(key) {
        return seen[name][key];
      });
 
    if (history[name].length <= BACKTEST_WARMUP_WEEKS + 4) {
      throw new Error(
        "Not enough COT history for " + name + " (" +
        history[name].length + " weeks)."
      );
    }
 
  });
 
  return history;
 
}
 
 
function loadBacktestPrices() {
 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
 
  const sheet = ss.getSheetByName(COT_PRICES_SHEET);
 
  if (!sheet) {
    throw new Error(
      '"' + COT_PRICES_SHEET + '" sheet not found. Run setupCOTPricesSheet.'
    );
  }
 
  const values = sheet.getDataRange().getValues();
 
  if (values.length < 3) {
    throw new Error("COT Prices contains no data.");
  }
 
  const pairNames = {};
 
  PAIR_LIST.forEach(function(pair) {
    pairNames[pair[0]] = true;
  });
 
  const result = {};
 
  const labels = values[0];
 
  for (let c = 0; c < labels.length; c++) {
 
    const label = String(labels[c]).trim();
 
    if (!pairNames[label]) {
      continue;
    }
 
    const points = {};
 
    for (let r = 2; r < values.length; r++) {
 
      const dateValue = values[r][c];
 
      if (!(dateValue instanceof Date) || isNaN(dateValue.getTime())) {
        continue;
      }
 
      const close = Number(values[r][c + 1]);
 
      if (!isFinite(close) || close <= 0) {
        continue;
      }
 
      points[cotDayNumber(normaliseDate(dateValue))] = close;
 
    }
 
    const days = Object.keys(points)
      .map(Number)
      .sort(function(a, b) {
        return a - b;
      });
 
    // Fewer than 50 rows means the block has not been loaded.
    if (days.length < 50) {
      continue;
    }
 
    result[label] = {
      days: days,
      closes: days.map(function(day) {
        return points[day];
      })
    };
 
  }
 
  return result;
 
}
 
 
/************************************************************
 * BACKTEST CALCULATION HELPERS
 ************************************************************/
 
// Matrix metrics -> the shape scoreCOTPair expects.
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
 
 
function backtestStats(values) {
 
  const n = values.length;
 
  if (n === 0) {
    return { n: 0, mean: null, hit: null, t: null };
  }
 
  const mean = cotAverage(values);
 
  let t = null;
 
  if (n >= 2) {
 
    const variance = values.reduce(function(sum, value) {
      return sum + Math.pow(value - mean, 2);
    }, 0) / (n - 1);
 
    const sd = Math.sqrt(variance);
 
    t = sd > 0 ? mean / (sd / Math.sqrt(n)) : null;
 
  }
 
  const hit = values.filter(function(value) {
    return value > 0;
  }).length / n * 100;
 
  return { n: n, mean: mean, hit: hit, t: t };
 
}
 
 
function backtestRound(value, decimals) {
 
  return value === null || value === undefined
    ? ""
    : cotRound(value, decimals);
 
}
 
 
// Sign (+1 bullish, -1 bearish, null none) from a divergence value.
function backtestSignFromValue(value) {
 
  if (value >= PAIR_BIAS_THRESHOLD) {
    return 1;
  }
 
  if (value <= -PAIR_BIAS_THRESHOLD) {
    return -1;
  }
 
  return null;
 
}
 
 
// Rows of stats for one signal definition, one row per horizon.
// raw = true reports plain returns (no direction, no hit rate).
function backtestStatRows(label, obsList, signFn, raw) {
 
  const rows = [];
 
  BACKTEST_HORIZONS.forEach(function(h) {
 
    const all = [];
    const nonOverlap = [];
 
    obsList.forEach(function(o) {
 
      const r = o.returns[h];
 
      if (r === null || r === undefined) {
        return;
      }
 
      const s = signFn(o);
 
      if (!s) {
        return;
      }
 
      const value = s * r;
 
      all.push(value);
 
      if (o.weekIdx % h === 0) {
        nonOverlap.push(value);
      }
 
    });
 
    const a = backtestStats(all);
    const b = backtestStats(nonOverlap);
 
    rows.push([
      label,
      h + "W",
      a.n,
      backtestRound(a.mean, 3),
      raw ? "" : backtestRound(a.hit, 1),
      backtestRound(a.t, 2),
      b.n,
      backtestRound(b.mean, 3),
      backtestRound(b.t, 2)
    ]);
 
  });
 
  return rows;
 
}
 
 
function writeBacktestTable(sheet, startRow, title, headers, rows) {
 
  sheet
    .getRange(startRow, 1)
    .setValue(title)
    .setFontWeight("bold")
    .setFontSize(12);
 
  sheet
    .getRange(startRow + 1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight("bold");
 
  if (rows.length > 0) {
    sheet
      .getRange(startRow + 2, 1, rows.length, headers.length)
      .setValues(rows);
  }
 
  return startRow + 2 + rows.length + 2;
 
}
 
 
/************************************************************
 * RUN THE BACKTEST
 ************************************************************/
 
function runCOTBacktest() {
 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
 
  const histories = loadBacktestHistories();
  const priceSeries = loadBacktestPrices();
 
  const pairsWithPrices = PAIR_LIST.filter(function(pair) {
    return Boolean(priceSeries[pair[0]]);
  });
 
  const pairsMissing = PAIR_LIST
    .filter(function(pair) {
      return !priceSeries[pair[0]];
    })
    .map(function(pair) {
      return pair[0];
    });
 
  if (pairsWithPrices.length === 0) {
    throw new Error("No price data found in " + COT_PRICES_SHEET + ".");
  }
 
  /*
   * Point in time metrics for every instrument and week.
   */
 
  const instruments = Object.keys(histories);
 
  const metricsByKey = {};
 
  instruments.forEach(function(instrument) {
 
    const data = histories[instrument];
 
    metricsByKey[instrument] = {};
 
    for (let i = BACKTEST_WARMUP_WEEKS; i < data.length; i++) {
      metricsByKey[instrument][data[i].dateKey] =
        computeCOTMetricsAt(data, i);
    }
 
  });
 
  const weekKeys = Object.keys(metricsByKey[instruments[0]])
    .filter(function(key) {
      return instruments.every(function(instrument) {
        return metricsByKey[instrument][key] !== undefined;
      });
    })
    .sort();
 
  if (weekKeys.length === 0) {
    throw new Error("No common COT weeks across all instruments.");
  }
 
  /*
   * One observation per week and pair.
   */
 
  const observations = [];
 
  weekKeys.forEach(function(weekKey, weekIdx) {
 
    const releaseDay = cotDayNumber(weekKey) + 3;
 
    pairsWithPrices.forEach(function(pair) {
 
      const pairName = pair[0];
 
      const baseKey = pair[1] === "USD" ? "Dollar Index" : pair[1];
      const quoteKey = pair[2] === "USD" ? "Dollar Index" : pair[2];
 
      const result = scoreCOTPair(
        backtestComponent(metricsByKey[baseKey][weekKey]),
        backtestComponent(metricsByKey[quoteKey][weekKey])
      );
 
      const series = priceSeries[pairName];
 
      const entryIndex = firstIndexAfter(series.days, releaseDay);
 
      if (entryIndex >= series.days.length) {
        return;
      }
 
      if (series.days[entryIndex] - releaseDay > BACKTEST_ENTRY_MAX_GAP_DAYS) {
        return;
      }
 
      const returns = {};
 
      BACKTEST_HORIZONS.forEach(function(h) {
        returns[h] = backtestForwardReturn(series, entryIndex, h);
      });
 
      observations.push({
        week: weekKey,
        weekIdx: weekIdx,
        pair: pairName,
        score: result.relativeScore,
        bias: result.bias,
        posDiv: result.positioningDivergence,
        momDiv: result.momentumDivergence,
        accDiv: result.accelerationDivergence,
        entryDay: series.days[entryIndex],
        returns: returns
      });
 
    });
 
  });
 
  if (observations.length === 0) {
    throw new Error("No observations could be matched to prices.");
  }
 
  /*
   * Detail sheet.
   */
 
  let dataSheet = ss.getSheetByName(BACKTEST_DATA_SHEET);
 
  if (!dataSheet) {
    dataSheet = ss.insertSheet(BACKTEST_DATA_SHEET);
  } else {
    dataSheet.clear();
  }
 
  const dataHeaders = [
    "COT DATE",
    "PAIR",
    "SCORE",
    "BIAS",
    "POSITIONING DIV",
    "MOMENTUM DIV",
    "ACCELERATION DIV",
    "ENTRY DATE",
    "1W RETURN %",
    "2W RETURN %",
    "4W RETURN %",
    "WEEK INDEX"
  ];
 
  const dataRows = observations.map(function(o) {
    return [
      o.week,
      o.pair,
      cotRound(o.score, 1),
      o.bias,
      cotRound(o.posDiv, 1),
      cotRound(o.momDiv, 1),
      cotRound(o.accDiv, 1),
      cotDayToKey(o.entryDay),
      backtestRound(o.returns[1], 3),
      backtestRound(o.returns[2], 3),
      backtestRound(o.returns[4], 3),
      o.weekIdx
    ];
  });
 
  dataSheet
    .getRange(1, 1, 1, dataHeaders.length)
    .setValues([dataHeaders])
    .setFontWeight("bold");
 
  dataSheet
    .getRange(2, 1, dataRows.length, dataHeaders.length)
    .setValues(dataRows);
 
  dataSheet.setFrozenRows(1);
 
  /*
   * Summary sheet.
   */
 
  let summary = ss.getSheetByName(BACKTEST_SUMMARY_SHEET);
 
  if (!summary) {
    summary = ss.insertSheet(BACKTEST_SUMMARY_SHEET);
  } else {
    summary.clear();
  }
 
  summary
    .getRange(1, 1)
    .setValue("COT BACKTEST SUMMARY")
    .setFontWeight("bold")
    .setFontSize(16);
 
  const notes = [
    "Model: weights positioning " + PAIR_WEIGHTS.positioning +
      " / momentum " + PAIR_WEIGHTS.momentum +
      " / acceleration " + PAIR_WEIGHTS.acceleration +
      ", bias threshold +/-" + PAIR_BIAS_THRESHOLD +
      ", acceleration cap " + PAIR_ACCELERATION_CAP +
      " sigma, warm-up " + BACKTEST_WARMUP_WEEKS + " weeks.",
    "Signals from " + weekKeys[0] + " to " +
      weekKeys[weekKeys.length - 1] + " (" + weekKeys.length +
      " weeks), " + observations.length + " observations, " +
      pairsWithPrices.length + " of " + PAIR_LIST.length +
      " pairs with prices.",
    "Entry: first close after the Friday release (COT date + 3 days). " +
      "Exit: last close on or before entry + 1, 2 or 4 weeks.",
    "Returns are % price changes. Directional return: positive means " +
      "the signal worked (Bearish signals are sign flipped). " +
      "Hit % = share of directional signals with a positive result.",
    "t-stats treat observations as independent. Overlapping 2W/4W " +
      "windows and shared currency legs overstate significance, so " +
      "rely on the non-overlap columns and treat |t| below 3 with caution."
  ];
 
  if (pairsMissing.length > 0) {
    notes.push("Pairs without price data: " + pairsMissing.join(", "));
  }
 
  notes.forEach(function(text, i) {
    summary.getRange(2 + i, 1).setValue(text);
  });
 
  let row = 3 + notes.length;
 
  const statHeaders = [
    "GROUP",
    "HORIZON",
    "N",
    "MEAN %",
    "HIT %",
    "T-STAT",
    "NON-OVERLAP N",
    "NON-OVERLAP MEAN %",
    "NON-OVERLAP T-STAT"
  ];
 
  /*
   * A. Results by bias label.
   */
 
  function biasIs(label) {
    return function(o) {
      return o.bias === label ? (label.indexOf("Bullish") === 0 ? 1 : -1) : null;
    };
  }
 
  const alwaysOne = function() {
    return 1;
  };
 
  const sectionA = []
    .concat(backtestStatRows("Bullish", observations, biasIs("Bullish"), false))
    .concat(backtestStatRows(
      "Bullish but momentum fading",
      observations,
      biasIs("Bullish but momentum fading"),
      false
    ))
    .concat(backtestStatRows("Bearish", observations, biasIs("Bearish"), false))
    .concat(backtestStatRows(
      "Bearish but momentum fading",
      observations,
      biasIs("Bearish but momentum fading"),
      false
    ))
    .concat(backtestStatRows(
      "All directional (signed)",
      observations,
      function(o) {
        return backtestSignFromValue(o.score);
      },
      false
    ))
    .concat(backtestStatRows(
      "Neutral (raw return)",
      observations,
      function(o) {
        return o.bias === "Neutral" ? 1 : null;
      },
      true
    ))
    .concat(backtestStatRows(
      "All observations (raw return)",
      observations,
      alwaysOne,
      true
    ));
 
  row = writeBacktestTable(
    summary,
    row,
    "A. Directional result by bias label (positive = signal worked)",
    statHeaders,
    sectionA
  );
 
  /*
   * B. Score quintiles (pooled, raw returns).
   */
 
  const sorted = observations.slice().sort(function(a, b) {
    return a.score - b.score;
  });
 
  sorted.forEach(function(o, i) {
    o.quintile = Math.min(5, Math.floor(i * 5 / sorted.length) + 1);
  });
 
  const quintileRows = [];
 
  const quintileMeans = {};
 
  for (let q = 1; q <= 5; q++) {
 
    const group = observations.filter(function(o) {
      return o.quintile === q;
    });
 
    const scores = group.map(function(o) {
      return o.score;
    });
 
    const means = BACKTEST_HORIZONS.map(function(h) {
 
      const values = group
        .map(function(o) {
          return o.returns[h];
        })
        .filter(function(value) {
          return value !== null && value !== undefined;
        });
 
      return values.length ? cotAverage(values) : null;
 
    });
 
    quintileMeans[q] = means;
 
    quintileRows.push([
      "Q" + q + (q === 1 ? " (most bearish)" : q === 5 ? " (most bullish)" : ""),
      cotRound(Math.min.apply(null, scores), 1) + " to " +
        cotRound(Math.max.apply(null, scores), 1),
      group.length,
      backtestRound(means[0], 3),
      backtestRound(means[1], 3),
      backtestRound(means[2], 3)
    ]);
 
  }
 
  quintileRows.push([
    "Q5 minus Q1",
    "",
    "",
    backtestRound(
      quintileMeans[5][0] === null || quintileMeans[1][0] === null
        ? null
        : quintileMeans[5][0] - quintileMeans[1][0],
      3
    ),
    backtestRound(
      quintileMeans[5][1] === null || quintileMeans[1][1] === null
        ? null
        : quintileMeans[5][1] - quintileMeans[1][1],
      3
    ),
    backtestRound(
      quintileMeans[5][2] === null || quintileMeans[1][2] === null
        ? null
        : quintileMeans[5][2] - quintileMeans[1][2],
      3
    )
  ]);
 
  row = writeBacktestTable(
    summary,
    row,
    "B. Mean raw return by score quintile (pooled across pairs)",
    ["QUINTILE", "SCORE RANGE", "OBS", "1W MEAN %", "2W MEAN %", "4W MEAN %"],
    quintileRows
  );
 
  /*
   * C. Which component carries the signal.
   */
 
  const sectionC = []
    .concat(backtestStatRows("Combined score", observations, function(o) {
      return backtestSignFromValue(o.score);
    }, false))
    .concat(backtestStatRows("Positioning only", observations, function(o) {
      return backtestSignFromValue(o.posDiv);
    }, false))
    .concat(backtestStatRows("Momentum only", observations, function(o) {
      return backtestSignFromValue(o.momDiv);
    }, false))
    .concat(backtestStatRows("Acceleration only", observations, function(o) {
      return backtestSignFromValue(o.accDiv);
    }, false));
 
  row = writeBacktestTable(
    summary,
    row,
    "C. Component comparison (same threshold, directional result)",
    statHeaders,
    sectionC
  );
 
  /*
   * D. By pair (combined score, directional result).
   */
 
  const pairRows = pairsWithPrices.map(function(pair) {
 
    const group = observations.filter(function(o) {
      return o.pair === pair[0];
    });
 
    const cells = [pair[0], 0];
 
    let signalCount = 0;
 
    BACKTEST_HORIZONS.forEach(function(h) {
 
      const values = [];
 
      group.forEach(function(o) {
 
        const r = o.returns[h];
        const s = backtestSignFromValue(o.score);
 
        if (r === null || r === undefined || !s) {
          return;
        }
 
        values.push(s * r);
 
      });
 
      const stats = backtestStats(values);
 
      signalCount = Math.max(signalCount, stats.n);
 
      cells.push(backtestRound(stats.mean, 3));
      cells.push(backtestRound(stats.hit, 1));
 
    });
 
    cells[1] = signalCount;
 
    return cells;
 
  });
 
  row = writeBacktestTable(
    summary,
    row,
    "D. By pair (combined score, directional result)",
    [
      "PAIR",
      "SIGNALS",
      "1W MEAN %",
      "1W HIT %",
      "2W MEAN %",
      "2W HIT %",
      "4W MEAN %",
      "4W HIT %"
    ],
    pairRows
  );
 
  summary.setColumnWidth(1, 240);
  summary.setColumnWidths(2, 8, 130);
 
  ss.toast(
    "Backtest complete: " + observations.length +
    " observations. See COT Backtest Summary."
  );
 
}
 