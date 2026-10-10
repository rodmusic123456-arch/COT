#!/usr/bin/env node
'use strict';
// EXPERIMENT ONLY. Downloads daily and weekly candles (open, high, low, close) for the dashboard's pairs
// from Yahoo's chart endpoint and writes experiment/data/ohlc_1d.json and ohlc_1wk.json.
// Raw Yahoo timestamps and the exchange time zone are kept so candle alignment can be checked.
const path = require('path');
const cfg = require('../src/config');
const { writeJSON, fetchRetry, sleep } = require('../src/util');

const START = Math.floor(Date.UTC(2010, 0, 1) / 1000);

async function get(symbol, interval) {
  const from = interval === '1h' ? Math.floor(Date.now() / 1000) - 729 * 86400 : START;
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?period1=' + from + '&period2=' + (Math.floor(Date.now() / 1000) + 86400) + '&interval=' + interval + '&events=history';
  const res = await fetchRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cot-dashboard)', Accept: 'application/json' } });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const r = (await res.json()).chart.result[0];
  const q = r.indicators.quote[0];
  return { symbol, interval, timezone: r.meta.exchangeTimezoneName, gmtoffset: r.meta.gmtoffset, t: r.timestamp, o: q.open, h: q.high, l: q.low, c: q.close };
}

(async function () {
  for (const interval of (process.argv[2] ? process.argv[2].split(',') : ['1d', '1wk'])) {
    const out = {};
    for (const pair of Object.keys(cfg.YAHOO_SYMBOLS)) {
      try {
        out[pair] = await get(cfg.YAHOO_SYMBOLS[pair], interval);
        console.log(interval, pair, out[pair].t.length, 'bars');
      } catch (e) {
        console.log(interval, pair, 'FAILED', e.message);
      }
      await sleep(300);
    }
    writeJSON(path.join(__dirname, 'data', 'ohlc_' + interval + '.json'), out);
  }
  // Probe an alternative daily source (Stooq) for comparison; failure is fine.
  try {
    const res = await fetchRetry('https://stooq.com/q/d/l/?s=audusd&i=d', { headers: { 'User-Agent': 'Mozilla/5.0' } }, 2);
    const txt = await res.text();
    require('fs').writeFileSync(path.join(__dirname, 'data', 'stooq_audusd.csv'), txt);
    console.log('stooq', res.status, txt.length, 'bytes');
  } catch (e) { console.log('stooq FAILED', e.message); }
})().catch(e => { console.error(e); process.exit(1); });
