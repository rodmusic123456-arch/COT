#!/usr/bin/env node
'use strict';
// EXPERIMENT ONLY: can the calendar's result history be read automatically from GitHub's servers?
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'data', 'probe');
const URLS = {
  ff_xml: 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
  ff_csv: 'https://nfs.faireconomy.media/ff_calendar_thisweek.csv',
  ff_event_ukcpi: 'https://www.forexfactory.com/calendar/82-uk-cpi-yy',
  mm_event_ukcpi: 'https://www.metalsmine.com/calendar/82-uk-cpi-yy',
  ff_calendar_week: 'https://www.forexfactory.com/calendar?week=oct12.2026'
};
(async () => {
  const sum = {};
  for (const [k, u] of Object.entries(URLS)) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', Accept: 'text/html,application/xhtml+xml,*/*' }, signal: AbortSignal.timeout(60000) });
      const t = await r.text();
      fs.writeFileSync(path.join(OUT, k + '.txt'), t.slice(0, 600000));
      sum[k] = { status: r.status, bytes: t.length, actualMentions: (t.match(/actual/gi) || []).length, head: t.slice(0, 200) };
    } catch (e) { sum[k] = { error: e.message }; }
    console.log(k, JSON.stringify(sum[k]).slice(0, 220));
  }
  fs.writeFileSync(path.join(OUT, 'calendar-summary.json'), JSON.stringify(sum, null, 1));
})();
