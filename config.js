'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  DATA_DIR: process.env.COT_DATA_DIR || path.join(ROOT, 'data'),
  DOCS_DIR: process.env.COT_DOCS_DIR || path.join(ROOT, 'docs'),

  CFTC_URL: 'https://publicreporting.cftc.gov/resource/6dca-aqww.json',
  // First COT week downloaded on a fresh install (the engine needs 52 weeks of warm-up).
  COT_START_DATE: '2021-01-01',
  // Re-download this many days before the last stored week, so revisions are picked up.
  COT_OVERLAP_DAYS: 21,

  PRICE_START_DATE: '2020-12-01',
  PRICE_OVERLAP_DAYS: 10,
  // Refuse a price update when the new closes differ from the stored ones by more than this.
  PRICE_TOLERANCE_FX: 0.01,
  PRICE_TOLERANCE_COMMODITY: 0.04,

  YAHOO_SYMBOLS: {
    'EUR/USD': 'EURUSD=X', 'GBP/USD': 'GBPUSD=X', 'AUD/USD': 'AUDUSD=X', 'NZD/USD': 'NZDUSD=X',
    'USD/JPY': 'USDJPY=X', 'USD/CHF': 'USDCHF=X', 'USD/CAD': 'USDCAD=X',
    'EUR/GBP': 'EURGBP=X', 'EUR/JPY': 'EURJPY=X', 'GBP/JPY': 'GBPJPY=X',
    'AUD/JPY': 'AUDJPY=X', 'NZD/JPY': 'NZDJPY=X', 'CAD/JPY': 'CADJPY=X',
    'EUR/CHF': 'EURCHF=X', 'GBP/CHF': 'GBPCHF=X',
    'AUD/CAD': 'AUDCAD=X', 'AUD/NZD': 'AUDNZD=X',
    'XAU/USD': 'GC=F', 'XAG/USD': 'SI=F', 'WTI/USD': 'CL=F', 'Brent/USD': 'BZ=F'
  },
  COMMODITY_PAIRS: ['XAU/USD', 'XAG/USD', 'WTI/USD', 'Brent/USD']
};
