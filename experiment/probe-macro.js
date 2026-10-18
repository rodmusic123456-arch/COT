#!/usr/bin/env node
'use strict';
// EXPERIMENT ONLY: checks which free macro data sources answer from GitHub's servers.
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'data', 'probe');
const URLS = {
  dbn_bis_policy: 'https://api.db.nomics.world/v22/series/BIS/WS_CBPOL?dimensions=%7B%22FREQ%22%3A%5B%22M%22%5D%2C%22REF_AREA%22%3A%5B%22US%22%2C%22XM%22%2C%22GB%22%2C%22JP%22%2C%22CA%22%2C%22AU%22%2C%22NZ%22%2C%22CH%22%5D%7D&observations=1&format=json',
  dbn_kei_dataset: 'https://api.db.nomics.world/v22/datasets/OECD/DSD_KEI@DF_KEI?format=json',
  dbn_kei_gbr: 'https://api.db.nomics.world/v22/series/OECD/DSD_KEI@DF_KEI?dimensions=%7B%22REF_AREA%22%3A%5B%22GBR%22%5D%2C%22FREQ%22%3A%5B%22M%22%5D%7D&observations=1&limit=100&format=json',
  dbn_search_kei: 'https://api.db.nomics.world/v22/search?q=key%20economic%20indicators&limit=10&format=json',
  oecd_kei_gbr: 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_KEI@DF_KEI,4.0/GBR.M......?startPeriod=2026-01&format=csvfilewithlabels',
  fred_us10y: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10',
  fred_uk10y: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=IRLTLT01GBM156N',
  fred_ukcpi: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPALTT01GBM659N',
  fred_fedfunds: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU',
  ecb_dfr: 'https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?lastNObservations=3&format=csvdata',
  ecb_hicp: 'https://data-api.ecb.europa.eu/service/data/ICP/M.U2.N.000000.4.ANR?lastNObservations=6&format=csvdata',
  ff_week: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  ff_next: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
  statcan_cpi: 'https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods',
  yahoo_us10y: 'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?range=1mo&interval=1d'
};
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = {};
  for (const [k, url] of Object.entries(URLS)) {
    try {
      const opt = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cot-dashboard)', Accept: '*/*' }, signal: AbortSignal.timeout(60000) };
      if (k === 'statcan_cpi') { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify([{ vectorId: 41690973, latestN: 6 }]); }
      const r = await fetch(url, opt);
      const txt = await r.text();
      fs.writeFileSync(path.join(OUT, k + '.txt'), txt.slice(0, 400000));
      summary[k] = { status: r.status, bytes: txt.length, head: txt.slice(0, 300) };
    } catch (e) { summary[k] = { error: e.message }; }
    console.log(k, JSON.stringify(summary[k]).slice(0, 200));
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
})();
