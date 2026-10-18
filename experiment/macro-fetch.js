#!/usr/bin/env node
'use strict';
// EXPERIMENT. Collects macro indicators for the eight currencies (plus China, for AUD/NZD and commodities)
// into experiment/data/macro/*.json. Each source is independent: one failing never stops the others.
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'data', 'macro');
fs.mkdirSync(OUT, { recursive: true });
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; cot-dashboard)', Accept: '*/*' };
async function get(url, opt) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, Object.assign({ headers: UA, signal: AbortSignal.timeout(90000) }, opt || {}));
      const t = await r.text();
      if (r.status === 200) return t;
      if (r.status < 500 && r.status !== 429) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120));
    } catch (e) { if (i === 2) throw e; }
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
}
const log = {};
const save = (name, obj) => fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(obj));
const keep = (p, v, n) => { const k = Math.max(0, p.length - (n || 36)); return { p: p.slice(k), v: v.slice(k) }; };

// 1. OECD key short-term indicators via DBnomics, one area at a time.
const AREAS = ['USA', 'EA20', 'GBR', 'JPN', 'CAN', 'AUS', 'NZL', 'CHE', 'CHN'];
const WANT = [/\.M\.CP\.GR\._Z\._Z\.GY$/, /\.Q\.CP\.GR\._Z\._Z\.GY$/, /\.UNEMP\./, /\.IR3TIB\./, /\.IRLT\./, /\.TOVM\..*\.GY$/, /\.PRVM\..*\.GY$/,
  /\.CCICP\./, /\.BCICP\./, /\.B1GQ\..*\.G1$/, /\.B1GQ\..*\.GY$/, /\.H_EARN\..*\.GY$/, /\.EMP\..*\.GY$/, /\.EX\.USD\./, /\.IM\.USD\./];
async function kei() {
  const out = {};
  for (const a of AREAS) {
    out[a] = {};
    for (const freq of ['M', 'Q']) {
      let offset = 0;
      while (true) {
        const dims = encodeURIComponent(JSON.stringify({ REF_AREA: [a], FREQ: [freq] }));
        const url = 'https://api.db.nomics.world/v22/series/OECD/DSD_KEI@DF_KEI?dimensions=' + dims + '&observations=1&limit=1000&offset=' + offset;
        let j;
        try { j = JSON.parse(await get(url)); } catch (e) { log['kei_' + a + freq] = e.message; break; }
        (j.series.docs || []).forEach(d => {
          if (!WANT.some(r => r.test(d.series_code))) return;
          const name = (d.series_name || '').split(' – ').slice(2).join(' – ');
          out[a][d.series_code] = Object.assign({ name }, keep(d.period, d.value, freq === 'M' ? 36 : 12));
        });
        offset += (j.series.docs || []).length;
        if (!j.series.docs || !j.series.docs.length || offset >= j.series.num_found) break;
      }
    }
    log['kei_' + a] = Object.keys(out[a]).length + ' series';
  }
  save('oecd_kei', out);
}

// 2. Central bank rates and bond yields from the banks / FRED directly.
function csvLast(txt, n) { const rows = txt.trim().split(/\r?\n/).slice(1).map(l => l.split(',')).filter(r => r[1] !== '' && r[1] !== '.'); return rows.slice(-(n || 400)).map(r => [r[0], +r[1]]); }
async function rates() {
  const out = {};
  const tasks = {
    fed_upper: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU'), 800),
    us_2y: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2'), 260),
    us_10y: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10'), 260),
    ecb_deposit: async () => { const t = await get('https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?startPeriod=2024-01-01&format=csvdata'); const h = t.split('\n')[0].split(','); const ip = h.indexOf('TIME_PERIOD'), iv = h.indexOf('OBS_VALUE'); return t.trim().split('\n').slice(1).map(l => l.split(',')).map(r => [r[ip], +r[iv]]); },
    ecb_hicp: async () => { const t = await get('https://data-api.ecb.europa.eu/service/data/ICP/M.U2.N.000000.4.ANR?lastNObservations=24&format=csvdata'); const h = t.split('\n')[0].split(','); const ip = h.indexOf('TIME_PERIOD'), iv = h.indexOf('OBS_VALUE'); return t.trim().split('\n').slice(1).map(l => l.split(',')).map(r => [r[ip], +r[iv]]); },
    ecb_hicp_core: async () => { const t = await get('https://data-api.ecb.europa.eu/service/data/ICP/M.U2.N.XEF000.4.ANR?lastNObservations=24&format=csvdata'); const h = t.split('\n')[0].split(','); const ip = h.indexOf('TIME_PERIOD'), iv = h.indexOf('OBS_VALUE'); return t.trim().split('\n').slice(1).map(l => l.split(',')).map(r => [r[ip], +r[iv]]); },
    boc_policy: async () => { const j = JSON.parse(await get('https://www.bankofcanada.ca/valet/observations/V39079/json?start_date=2024-01-01')); return j.observations.map(o => [o.d, +o.V39079.v]); },
    ca_2y: async () => { const j = JSON.parse(await get('https://www.bankofcanada.ca/valet/observations/BD.CDN.2YR.DQ.YLD/json?recent=260')); return j.observations.map(o => [o.d, +o['BD.CDN.2YR.DQ.YLD'].v]); },
    ca_10y: async () => { const j = JSON.parse(await get('https://www.bankofcanada.ca/valet/observations/BD.CDN.10YR.DQ.YLD/json?recent=260')); return j.observations.map(o => [o.d, +o['BD.CDN.10YR.DQ.YLD'].v]); },
    rba_cash: async () => { const t = await get('https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv'); return t.split(/\r?\n/).filter(l => /^\d{2}-[A-Za-z]{3}-\d{4}/.test(l)).map(l => l.split(',')).map(r => [r[0], +r[1]]).slice(-40); },
    snb_policy: async () => { const t = await get('https://data.snb.ch/api/cube/snbgwdzid/data/csv/en'); return t.split(/\r?\n/).filter(l => /SNB|LZ/.test(l)).slice(-40); },
    boe_bank_rate: async () => { const t = await get('https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2024&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N'); return t.trim().split(/\r?\n/).slice(-30); },
    uk_10y_monthly: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=IRLTLT01GBM156N'), 36),
    oil_wti_daily: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILWTICO'), 260),
    us_real_10y: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10'), 260),
    us_cpi_index: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL'), 30),
    us_core_cpi_index: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPILFESL'), 30),
    us_unrate: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE'), 30),
    us_payrolls: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=PAYEMS'), 30),
    us_retail: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=RSAFS'), 30),
    us_gdp_growth: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=A191RL1Q225SBEA'), 12),
    us_sentiment: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=UMCSENT'), 30),
    us_wages: async () => csvLast(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=CES0500000003'), 30)
  };
  for (const [k, fn] of Object.entries(tasks)) {
    try { out[k] = await fn(); log[k] = Array.isArray(out[k]) ? out[k].length + ' rows, last ' + JSON.stringify(out[k][out[k].length - 1]) : 'ok'; }
    catch (e) { log[k] = 'FAILED ' + e.message.slice(0, 150); }
  }
  save('rates', out);
}

// 3. This week's calendar (all impacts) for the news layer.
async function calendar() {
  try { save('calendar_thisweek', JSON.parse(await get('https://nfs.faireconomy.media/ff_calendar_thisweek.json'))); log.calendar = 'ok'; }
  catch (e) { log.calendar = 'FAILED ' + e.message; }
}

(async () => {
  await rates(); await calendar(); await kei();
  save('log', Object.assign({ at: new Date().toISOString() }, log));
  console.log(JSON.stringify(log, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
