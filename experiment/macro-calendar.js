#!/usr/bin/env node
'use strict';
// EXPERIMENT. Builds a release history (actual / forecast / previous) for every economy from the
// calendar's weekly pages: the last ~30 weeks plus this week. Writes experiment/data/macro/calendar_history.json.
// Polite: one page every 4 seconds, about 31 pages per run.
const fs = require('fs'), path = require('path'), vm = require('vm');
const OUT = path.join(__dirname, 'data', 'macro');
fs.mkdirSync(OUT, { recursive: true });
const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', Accept: 'text/html,application/xhtml+xml' };
const KEEP_CCY = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];

function parse(html) {
  const i = html.indexOf('calendarComponentStates[1] = {');
  if (i < 0) throw new Error('no calendar state in page');
  const s = html.indexOf('{', i);
  let d = 0, j = s, inStr = false, q = '';
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (c === '\\') { j++; continue; } if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; }
  }
  const obj = vm.runInNewContext('(' + html.slice(s, j + 1) + ')', {}, { timeout: 2000 });
  return obj.days.flatMap(x => x.events || []);
}

(async () => {
  const weeks = [];
  const now = new Date();
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  for (let k = 30; k >= -1; k--) weeks.push(new Date(sunday.getTime() - k * 7 * 86400000));
  const all = {}, log = [];
  for (const w of weeks) {
    const key = MON[w.getUTCMonth()] + w.getUTCDate() + '.' + w.getUTCFullYear();
    try {
      const r = await fetch('https://www.forexfactory.com/calendar?week=' + key, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const evs = parse(await r.text());
      let n = 0;
      evs.forEach(e => {
        if (!KEEP_CCY.includes(e.currency)) return;
        if (!['high', 'medium', 'low'].includes(e.impactName)) return;
        all[e.id] = { id: e.id, eb: e.ebaseId, t: e.dateline, c: e.currency, n: e.name, imp: e.impactName[0],
          a: e.actual || '', f: e.forecast || '', p: e.previous || '', r: e.revision || '', bw: e.actualBetterWorse || 0 };
        n++;
      });
      log.push(key + ': ' + n + ' events');
    } catch (e) { log.push(key + ': FAILED ' + e.message); }
    await new Promise(r => setTimeout(r, 4000));
  }
  const events = Object.values(all).sort((a, b) => a.t - b.t);
  fs.writeFileSync(path.join(OUT, 'calendar_history.json'), JSON.stringify({ at: new Date().toISOString(), events }));
  fs.writeFileSync(path.join(OUT, 'calendar_log.json'), JSON.stringify(log, null, 1));
  console.log(log.join('\n'));
  console.log(events.length, 'events kept');
})().catch(e => { console.error(e); process.exit(1); });
