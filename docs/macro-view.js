/*
 * Macro & News layer for the COT Market Command Centre.
 *
 * Reads P.macro (docs/macro.json, built by src/macro.js) and adds:
 *   - the MACRO & NEWS page (Overview, Countries, Pairs, Commodities, Next two weeks)
 *   - a "Coming up" and "Macro snapshot" row on the home page
 *   - a macro panel on Pair Analysis and Instrument Analysis
 * It uses the page's own helpers (esc, col, get, cfg, fD, lineChart) and state (P, S).
 */
(function () {
  'use strict';

  const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF'];
  const NAME = { USD: 'United States', EUR: 'Euro area', GBP: 'United Kingdom', JPY: 'Japan', CAD: 'Canada', AUD: 'Australia', NZD: 'New Zealand', CHF: 'Switzerland', CNY: 'China' };
  const VIEWS = [['overview', 'OVERVIEW'], ['countries', 'COUNTRIES'], ['pairs', 'PAIRS'], ['commod', 'COMMODITIES'], ['cal', 'NEXT TWO WEEKS']];
  const RATE_RE = /^(Federal Funds Rate|Main Refinancing Rate|Official Bank Rate|BOJ Policy Rate|Overnight Rate|Cash Rate|Official Cash Rate|SNB Policy Rate|1-y Loan Prime Rate)$/;
  const LEGS = { USD: 'EUR/USD and USD/JPY', EUR: 'EUR/USD and EUR/GBP', GBP: 'GBP/USD and EUR/GBP', JPY: 'USD/JPY and EUR/JPY', CAD: 'USD/CAD and EUR/CAD', AUD: 'AUD/USD and EUR/AUD', NZD: 'NZD/USD and AUD/NZD', CHF: 'USD/CHF and EUR/CHF' };
  const COMMOD_OF = { XAU: 'gold', XAG: 'silver', WTI: 'oil', Brent: 'oil' };

  const M = () => (typeof P !== 'undefined' && P && P.macro) || null;
  const NOTES = () => (M() && M().notes) || {};
  const CB = c => (NOTES().cb || {})[c] || {};
  const nowS = () => Date.now() / 1000;

  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fT = t => { const d = new Date(t * 1000); return d.getUTCDate() + ' ' + MO[d.getUTCMonth()]; };
  const ukDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
  const fTY = t => { const d = new Date(t * 1000); return d.getUTCDate() + ' ' + MO[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
  const ukFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const ukDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'short' });
  const ukTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
  const uk = t => ukFmt.format(new Date(t * 1000));
  const mn = s => { if (s === undefined || s === null || s === '') return null; const m = String(s).replace(/[<>,]/g, '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
  const clean = s => String(s === undefined || s === null ? '' : s).replace(/^</, '');
  const sg = (v, dp) => v === null || v === undefined || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp === undefined ? 0 : dp);
  const evKey = u => u[0] + '|' + u[1] + '|' + u[3];

  /* ---------- what each kind of release means ---------- */
  // [pattern, what it is, if better than forecast, if worse than forecast]
  const TYPE = [
    [/Rate$|Policy Rate|Cash Rate|Overnight Rate|Federal Funds|Refinancing|Loan Prime/, 'Interest-rate decision by the central bank.', 'A rise, a bigger rise than expected, or strong hints of more usually lifts the currency straight away.', 'A hold when a rise was expected, a cut, or a softer tone usually weakens the currency.', 'The statement, the vote split and the press conference often move the market more than the decision itself.'],
    [/Statement|Press Conference|Outlook Report|Monetary Policy Report|Minutes|Speaks|Testifies/, 'Central bank communication: speeches, minutes or reports.', 'Talk of higher rates for longer supports the currency.', 'Talk of cuts or worries about growth weighs on it.', 'There is no forecast for these. Traders listen for hints about the next rate move.'],
    [/Unemployment Rate|Claims|Claimant/, 'Unemployment. Here a LOWER number is the good outcome.', 'Lower than forecast (fewer people out of work) supports the currency.', 'Higher than forecast weakens it, because it makes rate rises less likely.', ''],
    [/CPI|Inflation|PCE|Price Index|PPI/, 'Inflation: how fast prices are rising.', 'Hotter than forecast means rates stay higher or rise further, which usually lifts the currency in the short run.', 'Cooler than forecast lets the central bank ease off, which usually weakens the currency.', 'Core measures (without food and energy) matter most to central banks.'],
    [/GDP/, 'Economic growth: the total output of the economy.', 'Stronger than forecast supports the currency.', 'Weaker than forecast hurts it and raises the chance of rate cuts.', 'GDP is backward-looking, so surprises matter more than the level.'],
    [/Employment|Payroll|Jobs|Non-Farm/, 'Jobs: how many people were hired.', 'More jobs than forecast support the currency.', 'Fewer jobs (or job losses) weaken it.', 'Revisions to the previous month can matter as much as the new number.'],
    [/Earnings|Wage|Labor Cost|Cash Earnings/, 'Pay growth.', 'Faster pay feeds inflation and keeps rates higher, which supports the currency.', 'Slower pay growth weakens it.', ''],
    [/Retail|Spending|Sales/, 'Spending by households.', 'Strong spending supports growth and the currency.', 'Weak spending points to a slowdown and weighs on the currency.', ''],
    [/PMI|ISM|Tankan|Ivey|Business|ZEW|ifo|Industrial|Manufacturing|Production|Orders/, 'Business activity and surveys. For PMIs, above 50 means growing.', 'A stronger reading supports the currency.', 'A weaker reading weighs on it.', 'These are early signals, so surprises can move the currency even though they are surveys.'],
    [/Confidence|Sentiment/, 'How confident households or businesses feel.', 'More upbeat than forecast supports the currency.', 'Gloomier than forecast weighs on it: worried people spend less.', ''],
    [/Budget|Forecast Statement|Fiscal/, 'Government tax and spending plans.', 'Plans markets see as credible calm bond markets and support the currency.', 'Big unfunded borrowing can push bond yields up and unsettle the currency.', 'There is no forecast: watch borrowing targets and the bond market reaction.'],
    [/Trade|Current Account/, 'Exports minus imports.', 'A bigger surplus (or smaller deficit) means more demand for the currency.', 'A bigger deficit weighs on it.', ''],
    [/Housing|Home|Building|Mortgage/, 'Housing market.', 'Stronger housing supports growth and the currency.', 'Weaker housing weighs on it.', '']
  ];
  const typeOf = n => TYPE.find(x => x[0].test(n)) || [null, 'A scheduled release for this economy.', 'Better than forecast usually supports the currency.', 'Worse than forecast usually weighs on it.', ''];

  /* ---------- derived readings ---------- */
  const ccyData = c => (M() && M().ccy[c]) || null;
  const indOf = (c, re) => ((ccyData(c) || {}).inds || []).find(i => re.test(i.label));
  const lastOf = i => i && i.rows.length ? mn(i.rows[i.rows.length - 1][1]) : null;

  function rate(c) {
    const x = ccyData(c), r = x && x.rate;
    if (!r || r.v === null) return null;
    const v = r.v;
    const show = c === 'USD' ? (v - 0.25).toFixed(2) + '–' + v.toFixed(2) + '%' : c === 'EUR' ? (v - 0.15).toFixed(2) + '% deposit' : c === 'CNY' ? v.toFixed(2) + '% (1-yr)' : v.toFixed(2) + '%';
    // For gaps between currencies use the rate the market watches: the Fed's upper bound, the ECB deposit rate.
    const cmp = c === 'EUR' ? v - 0.15 : v;
    return { v: v, cmp: cmp, show: show, t: r.t, moves: r.moves || [], next: r.next };
  }
  function stance(c) {
    const r = rate(c);
    const recent = r ? r.moves.filter(m => m[0] > nowS() - 120 * 86400) : [];
    if (recent.some(m => m[1] > 0)) return { t: 'Raising', k: 'pos', s: 1 };
    if (recent.some(m => m[1] < 0)) return { t: 'Cutting', k: 'neg', s: -1 };
    if (CB(c).leaning === 'raise') return { t: 'Holding, leaning to raise', k: 'amb', s: 0.5 };
    if (CB(c).leaning === 'cut') return { t: 'Holding, leaning to cut', k: 'amb', s: -0.5 };
    return { t: 'Holding', k: 'mut', s: 0 };
  }
  function inflation(c) {
    const cb = CB(c); let v = null, lab = '';
    const i = indOf(c, /^Inflation \((CPI y\/y|national core)/);
    if (i) { v = lastOf(i); lab = fT(i.rows[i.rows.length - 1][0]); }
    if (cb.cpiYoy) { v = cb.cpiYoy[0]; lab = cb.cpiYoy[1]; }
    if (v === null || cb.target === undefined) return { t: 'n/a', k: 'mut', v: null };
    const d = v - cb.target;
    return { v: v, lab: lab, t: v.toFixed(1) + '% · ' + (d > 0.5 ? 'above target' : d < -0.5 ? 'below target' : 'near target'), k: d > 0.5 ? 'amb' : 'mut' };
  }
  function jobs(c) {
    const i = indOf(c, /^Unemployment rate/);
    if (!i || i.rows.length < 2) return { t: 'n/a', k: 'mut', s: 0 };
    // Trend over the last three releases; a month of job losses overrides a steady unemployment rate.
    const n = i.rows.length, a = mn(i.rows[n - 1][1]), b = mn(i.rows[Math.max(0, n - 4)][1]), d = +(a - b).toFixed(2);
    const added = indOf(c, /^Jobs added/), lost = added && added.rows.length && lastOf(added) < 0;
    if (lost) return { t: a.toFixed(1) + '% · jobs lost', k: 'neg', s: -1 };
    return { t: a.toFixed(1) + '% · ' + (d >= 0.2 ? 'rising' : d <= -0.2 ? 'falling' : 'steady'), k: d >= 0.2 ? 'neg' : d <= -0.2 ? 'pos' : 'mut', s: d >= 0.2 ? -1 : d <= -0.2 ? 1 : 0 };
  }
  function growth(c) {
    const i = indOf(c, /^Growth/);
    if (!i) return { t: 'n/a', k: 'mut', s: 0 };
    const v = lastOf(i), f = mn(i.rows[i.rows.length - 1][2]);
    // What counts as soft depends on how growth is quoted: annualised (US), on a year (China), monthly or quarterly.
    const weak = c === 'USD' ? v < 1.5 : /y\/y/.test(i.label) ? v < 4.5 : /m\/m/.test(i.label) ? v <= 0 : v < 0.3;
    return { t: sg(v, 1) + '%' + (f !== null ? (v > f ? ' · beat' : v < f ? ' · missed' : '') : ''), k: weak ? 'neg' : 'pos', s: weak ? -1 : 1 };
  }
  function surprise(c) {
    const x = ccyData(c);
    if (!x) return { t: 'n/a', k: 'mut', s: 0, n: 0 };
    const use30 = x.s30.n >= 6, s = use30 ? x.s30 : x.s90;
    if (s.v === null) return { t: 'n/a', k: 'mut', s: 0, n: 0 };
    return { v: s.v, n: s.n, win: use30 ? '30 days' : '90 days', t: sg(s.v) + ' (' + (use30 ? '30 days' : '90 days') + ')', k: s.v >= 15 ? 'pos' : s.v <= -15 ? 'neg' : 'mut', s: s.v >= 15 ? 1 : s.v <= -15 ? -1 : 0 };
  }
  function macroRead(c) {
    if (!ccyData(c)) return { t: 'n/a', k: 'mut', s: 0 };
    const pts = stance(c).s + surprise(c).s + jobs(c).s + growth(c).s * 0.5;
    return pts >= 1.5 ? { t: 'Supportive', k: 'pos', s: 1 } : pts <= -1 ? { t: 'Weak', k: 'neg', s: -1 } : { t: 'Mixed', k: 'amb', s: 0 };
  }
  const cotOf = c => { const r = get('Instrument', c, 'WEEKLY'); return r && isFinite(r.Score) ? r : null; };
  function fit(c) {
    const m = macroRead(c), x = cotOf(c);
    if (!x) return { t: '–', k: 'mut' };
    const lim = cfg().neutral, cs = x.Score >= lim ? 1 : x.Score <= -lim ? -1 : 0;
    if (m.s === 0 || cs === 0) return { t: 'No clear clash', k: 'mut' };
    return m.s === cs ? { t: 'Agree', k: 'pos' } : { t: 'Clash: worth a look', k: 'amb' };
  }

  /* ---------- small pieces ---------- */
  const cell = r => '<span class="mcell c-' + r.k + '">' + esc(r.t) + '</span>';
  const tag = c => '<span class="mtag">' + esc(c) + '</span>';
  const cotNum = v => '<b style="color:' + col(v) + '">' + sg(v) + '</b>';
  const cotCell = c => { const x = cotOf(c); return x ? cotNum(x.Score) : '<span class="mut">–</span>'; };
  const bwChip = (f, bw) => !f ? '<span class="mcell c-mut">no forecast</span>' : bw === 1 ? '<span class="mcell c-pos">better</span>' : bw === 2 ? '<span class="mcell c-neg">worse</span>' : '<span class="mcell c-mut">as expected</span>';
  const imp = i => '<span class="mimp ' + i + '" title="' + (i === 'h' ? 'High impact' : 'Medium impact') + '"></span>';
  function spark(vals, color) {
    const v = vals.filter(x => x !== null && isFinite(x));
    if (v.length < 2) return '';
    const W = 110, H = 26, lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), r = (hi - lo) || 1;
    const pts = vals.map((val, i) => val === null || !isFinite(val) ? null : [3 + (W - 6) * i / (vals.length - 1), 3 + (H - 6) * (1 - (val - lo) / r)]).filter(Boolean);
    const last = pts[pts.length - 1];
    return '<svg class="mspark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><polyline fill="none" stroke="' + (color || '#6ea8fe') + '" stroke-width="1.5" points="' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.5" fill="#e6edf3"/></svg>';
  }
  const kcard = (l, v, s, extra) => '<div class="mk"><div class="l">' + l + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + (extra || '') + '</div>';
  const upcoming = () => ((M() && M().upcoming) || []).filter(u => u[0] > nowS() - 300);
  const weeklyPrices = (item, weeks) => { const h = P.hist[item + '|Instrument'] || P.hist[item + '|Pair'] || []; return h.slice(-(weeks || 27)).map(r => mn(r[5])); };
  const pairPrices = (p, weeks) => (P.hist[p + '|Pair'] || []).slice(-(weeks || 27)).map(r => mn(r[5]));
  const writtenNote = () => '<span class="mut small">' + esc(NOTES().written || '') + '</span>';
  const noData = () => '<div class="panel"><h2>Macro &amp; news</h2><div class="note">The macro data will appear after the next data update.</div></div>';

  /* ---------- event detail (shared by the calendar, home and analysis pages) ---------- */
  function eventDetail(u) {
    const ty = typeOf(u[3]), c = u[1], hist = u[6] || [];
    const rows = hist.slice().reverse().map(h => '<tr><td>' + fTY(h[0]) + '</td><td class="mnum"><b>' + esc(clean(h[1])) + '</b></td><td class="mnum">' + esc(clean(h[2]) || '–') + '</td><td>' + bwChip(h[2], h[3]) + '</td><td class="mnum">' +
      (h[4] === null || h[4] === undefined ? '<span class="mut">–</span>' : '<b class="' + (h[4] > 0 ? 'pos' : h[4] < 0 ? 'neg' : '') + '">' + sg(h[4], 2) + '%</b>') + '</td><td class="mnum mut">' + (h[5] ? h[5].toFixed(2) + '%' : '–') + '</td></tr>').join('');
    const scored = hist.filter(h => (h[3] === 1 || h[3] === 2) && h[4] !== null && h[4] !== undefined);
    const textbook = scored.filter(h => (h[3] === 1 && h[4] > 0) || (h[3] === 2 && h[4] < 0)).length;
    const sized = hist.filter(h => h[4] !== null && h[4] !== undefined && h[5]);
    const avgMove = sized.length ? sized.reduce((a, h) => a + Math.abs(h[4]), 0) / sized.length : null;
    const avgTyp = sized.length ? sized.reduce((a, h) => a + h[5], 0) / sized.length : null;
    let tally = '';
    if (scored.length) tally += 'In the last ' + scored.length + ' surprise' + (scored.length > 1 ? 's' : '') + ', ' + c + ' moved the textbook way <b>' + textbook + ' time' + (textbook === 1 ? '' : 's') + '</b> (better than forecast → ' + c + ' up, worse → ' + c + ' down). ';
    if (avgMove !== null) tally += 'On release days ' + c + ' moved <b>' + avgMove.toFixed(2) + '%</b> on average, against <b>' + avgTyp.toFixed(2) + '%</b> on a normal day' + (avgMove > avgTyp * 1.3 ? ', so this release usually moves the market.' : avgMove < avgTyp * 0.8 ? ', so it has rarely been the main driver lately.' : '.');
    const x = cotOf(c);
    const cot = x ? '<div class="small">Speculators on ' + esc(c) + ': COT strength ' + cotNum(x.Score) + ' (' + esc(x.Direction || '') + '). ' +
      (Math.abs(x.Score) >= cfg().neutral ? 'A result that goes against their positioning can trigger a sharper move as they unwind.' : 'No strong lean, so the data can set the direction.') +
      ' <button class="btn" data-go="inst:' + esc(c) + '">OPEN ' + esc(c) + ' ANALYSIS</button> <button class="btn" data-mc="' + esc(c) + '">' + esc(c) + ' MACRO PROFILE</button></div>' : '';
    return '<div class="mevd">' +
      '<div><b>What it is.</b> <span class="msoft">' + esc(ty[1]) + '</span></div>' +
      (u[4] || u[5] ? '<div class="small mut">Forecast <b style="color:var(--text)">' + esc(clean(u[4]) || '–') + '</b> · previous ' + esc(clean(u[5]) || '–') + '</div>' : '') +
      '<div class="mscen"><div><b class="pos">If better than forecast</b><span>' + esc(ty[2]) + '</span></div><div><b class="neg">If worse than forecast</b><span>' + esc(ty[3]) + '</span></div></div>' +
      (ty[4] ? '<div class="small mut">' + esc(ty[4]) + '</div>' : '') +
      (u[2] === 'h' || hist.length ? (hist.length ? '<div class="mtw"><table><tr><th>RELEASED</th><th class="mnum">ACTUAL</th><th class="mnum">FORECAST</th><th>FOR ' + esc(c) + '</th><th class="mnum">' + esc(c) + ' THAT DAY</th><th class="mnum">NORMAL DAY</th></tr>' + rows + '</table></div>' +
        (tally ? '<div class="small msoft">' + tally + '</div>' : '') +
        (u[2] === 'h' && LEGS[c] ? '<div class="small mut">"' + esc(c) + ' that day" = the move over the UK release day, averaged across ' + LEGS[c] + '. "Normal day" = the average daily move over the three months before. Medium-impact releases show results only.</div>' : '')
        : '<div class="small mut">No earlier results recorded yet; history builds up automatically each week.</div>') : '') +
      cot + '</div>';
  }

  function eventRow(u, open, showDay) {
    const k = evKey(u);
    return '<div class="mev' + (showDay ? ' wide' : '') + '" data-mev="' + esc(k) + '" role="button" tabindex="0" aria-expanded="' + open + '"><span class="t">' + (showDay ? uk(u[0]) : ukTime.format(new Date(u[0] * 1000))) + '</span>' + tag(u[1]) + '<span>' + imp(u[2]) + esc(u[3]) + '</span><span class="fp">' + [u[4] ? 'f’cast <b>' + esc(clean(u[4])) + '</b>' : '', u[5] ? 'prev ' + esc(clean(u[5])) : ''].filter(Boolean).join(' · ') + '</span></div>' +
      (open ? eventDetail(u) : '');
  }

  /* ---------- page views ---------- */
  function overview() {
    const themes = (NOTES().themes || []).map(t => '<div class="mtheme"><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></div>').join('');
    const usd = rate('USD');
    const banks = CCYS.concat('CNY').map(c => {
      const cb = CB(c), r = rate(c), st = stance(c), nx = r && r.next && r.next > nowS() ? r.next : null;
      return '<tr class="click" data-mc="' + c + '"><td>' + tag(c) + ' ' + esc(cb.bank || NAME[c]) + '</td><td class="mnum"><b>' + (r ? esc(r.show) : '–') + '</b></td><td>' + cell(st) + '</td><td class="mnum">' + (c === 'USD' || !r || !usd ? '–' : sg((r.cmp - usd.cmp) * 100) + ' bp') + '</td><td>' + (nx ? '<b>' + uk(nx) + '</b>' : '<span class="mut">not in the calendar yet</span>') + '</td><td class="msoft small">' + esc(cb.note || '') + '</td></tr>';
    }).join('');
    const score = CCYS.map(c => '<tr class="click" data-mc="' + c + '"><td>' + tag(c) + '</td><td>' + cell(stance(c)) + '</td><td>' + cell(inflation(c)) + '</td><td>' + cell(growth(c)) + '</td><td>' + cell(jobs(c)) + '</td><td>' + cell(surprise(c)) + '</td><td>' + cell(macroRead(c)) + '</td><td class="mnum">' + cotCell(c) + '</td><td>' + cell(fit(c)) + '</td></tr>').join('');
    return '<div class="panel"><h2>What’s going on in the world right now</h2><div class="mthemes">' + themes + '</div><div style="margin-top:8px">' + writtenNote() + '</div></div>' +
      '<div class="panel"><h2>Macro scoreboard · click a row for the country</h2>' +
      '<details class="mhow"><summary>How to read this</summary><p><b>Rates</b>: is the central bank raising, cutting or holding (any move in the last four months counts)? <b>Inflation</b>: the latest yearly rate against the bank’s target. <b>Growth</b> and <b>Jobs</b>: the latest GDP and unemployment trend (three releases). <b>Data vs forecasts</b>: how often recent releases came in better (+) or worse (−) than forecast, weighted by importance, from −100 to +100. <b>Macro read</b> combines rates, surprises, jobs and growth into Supportive, Mixed or Weak. <b>COT</b> is the weekly COT strength from this dashboard. <b>Macro vs COT</b>: when they clash, either the data have turned and speculators have not caught up, or the crowd sees something the numbers do not.</p></details>' +
      '<div class="mtw"><table><tr><th>CURRENCY</th><th>RATES</th><th>INFLATION</th><th>GROWTH</th><th>JOBS</th><th>DATA VS FORECASTS</th><th>MACRO READ</th><th class="mnum">COT</th><th>MACRO VS COT</th></tr>' + score + '</table></div></div>' +
      '<div class="panel"><h2>Central banks · rates update from each decision</h2><div class="mtw"><table><tr><th>BANK</th><th class="mnum">RATE</th><th>DIRECTION</th><th class="mnum">GAP VS FED</th><th>NEXT DECISION (UK TIME)</th><th>LATEST</th></tr>' + banks + '</table></div></div>';
  }

  function countries() {
    const c = S.mc || 'USD', x = ccyData(c), cb = CB(c), cot = cotOf(c), r = rate(c), su = surprise(c), mr = macroRead(c), inf = inflation(c);
    if (!x) return '<div class="panel">No macro data for ' + esc(c) + '.</div>';
    const pick = '<div class="grp">' + CCYS.concat('CNY').map(k => '<button class="btn ' + (k === c ? 'on' : '') + '" data-mc="' + k + '">' + k + '</button>').join('') + '</div>';
    const ind = x.inds.map(i => {
      const l = i.rows[i.rows.length - 1];
      return '<tr><td>' + esc(i.label) + '<div class="mut small">' + esc(l[5]) + '</div></td><td class="mnum"><b>' + esc(clean(l[1])) + '</b><div class="mut small">' + fT(l[0]) + '</div></td><td class="mnum">' + esc(clean(l[2]) || '–') + '</td><td>' + bwChip(l[2], l[4]) + '</td><td>' + spark(i.rows.map(z => mn(z[1]))) + '<div class="mut small">last ' + i.rows.length + '</div></td><td class="small">' +
        (i.next ? '<b>' + uk(i.next[0]) + '</b>' + (i.next[1] ? '<div class="mut">forecast ' + esc(clean(i.next[1])) + '</div>' : '') : '<span class="mut">–</span>') + '</td></tr>';
    }).join('');
    const ups = upcoming().filter(u => u[1] === c);
    const recent = (x.recent || []).slice().reverse().map(z => '<li><span>' + fT(z[0]) + ' · ' + esc(z[1]) + ': <b>' + esc(clean(z[2])) + '</b> <span class="mut">vs ' + esc(clean(z[3])) + '</span></span>' + bwChip(z[3], z[4]) + '</li>').join('');
    const pairs = c === 'CNY' ? [] : P.pairs.filter(p => p.split('/').indexOf(c) >= 0);
    const fitT = fit(c).t;
    return '<div class="panel">' + pick +
      '<div class="mph"><h3>' + esc(NAME[c]) + ' <span class="mut">· ' + c + '</span></h3><span class="mut">' + esc(cb.bank || '') + '</span></div>' +
      '<div class="mkv">' + kcard('POLICY RATE', r ? esc(r.show) : '–', esc(stance(c).t)) +
      kcard('INFLATION', inf.v !== null && inf.v !== undefined ? inf.v.toFixed(1) + '%' : 'n/a', (cb.target !== undefined ? 'target ' + cb.target + '%' : '') + (inf.lab ? ' · ' + esc(inf.lab) : '')) +
      kcard('DATA VS FORECASTS', su.v !== undefined ? sg(su.v) : 'n/a', su.n ? esc(su.win) + ', ' + su.n + ' releases' : '') +
      kcard('MACRO READ', '<span class="c-' + mr.k + '" style="background:none">' + esc(mr.t) + '</span>', 'rates, surprises, jobs, growth') +
      (cot ? kcard('COT STRENGTH', cotNum(cot.Score), esc(cot.Direction || '') + (cot.Extreme && cot.Extreme !== 'No' ? ' · extreme' : '')) : '') + '</div>' +
      '<div class="mstory"><b>What’s going on.</b> ' + esc((NOTES().stories || {})[c] || '') + '<div class="small mut" style="margin-top:4px">' + esc(NOTES().written || '') + '</div></div>' +
      (cot ? '<div class="small msoft" style="margin-top:8px">' + (fitT === 'Agree' ? 'Macro and positioning point the same way for ' + c + '.' : fitT === 'No clear clash' ? 'No strong signal from either the macro data or positioning for ' + c + '.' : 'Macro and positioning point in different directions for ' + c + ': either the data have turned and speculators have not caught up, or the crowd sees something the recent numbers do not. Check the pairs below.') + '</div>' : '') +
      '</div>' +
      '<div class="panel"><h2>Key indicators · latest result, forecast and recent trend</h2><div class="mtw"><table><tr><th>INDICATOR</th><th class="mnum">LATEST</th><th class="mnum">FORECAST</th><th>RESULT</th><th>TREND</th><th>NEXT RELEASE (UK)</th></tr>' + ind + '</table></div></div>' +
      '<div class="row r2"><div class="panel"><h2>Recent surprises</h2>' + (recent ? '<ul class="l">' + recent + '</ul>' : '<div class="mut small">No high or medium impact surprises in the last six weeks.</div>') + '</div>' +
      '<div class="panel"><h2>Coming up for ' + c + ' · click for the breakdown</h2>' + (ups.length ? ups.map(u => eventRow(u, S.mev === evKey(u), true)).join('') : '<div class="mut small">No high or medium impact releases in the next two weeks.</div>') + '</div></div>' +
      (pairs.length ? '<div class="panel"><h2>Pairs with ' + c + ' · weekly COT score</h2><div class="grp">' + pairs.map(p => { const s = get('Pair', p, 'WEEKLY'); return '<button class="btn" data-mp="' + esc(p) + '">' + esc(p) + ' ' + (s ? cotNum(s.Score) : '') + '</button>'; }).join('') + '</div></div>' : '');
  }

  function legCard(c) {
    if (!ccyData(c)) {
      const key = COMMOD_OF[c], m = key && (NOTES().commodities || {})[key];
      return '<div class="mleg"><div class="mph"><h3>' + esc(c) + '</h3><span class="mut small">commodity</span></div>' + (m ? '<div class="small msoft">' + esc(m.now) + '</div>' : '') + '<div class="small">COT strength ' + cotCell(c) + '</div><button class="btn" data-mv="commod" style="justify-self:start">COMMODITY NOTES</button></div>';
    }
    const cb = CB(c), r = rate(c), ups = upcoming().filter(u => u[1] === c && u[2] === 'h').slice(0, 4);
    return '<div class="mleg"><div class="mph"><h3>' + c + '</h3><span class="mut small">' + esc(cb.bank || '') + '</span></div>' +
      '<div class="small">Rate <b>' + (r ? esc(r.show) : '–') + '</b> ' + cell(stance(c)) + '</div>' +
      '<div class="small">Inflation ' + cell(inflation(c)) + '</div><div class="small">Jobs ' + cell(jobs(c)) + ' Growth ' + cell(growth(c)) + '</div>' +
      '<div class="small">Data vs forecasts ' + cell(surprise(c)) + '</div><div class="small">Macro read ' + cell(macroRead(c)) + ' COT ' + cotCell(c) + '</div>' +
      (ups.length ? '<div class="small mut">Next big events: ' + ups.map(u => esc(u[3]) + ' (' + fT(u[0]) + ')').join(', ') + '</div>' : '') +
      '<button class="btn" data-mc="' + c + '" style="justify-self:start">' + c + ' MACRO PROFILE</button></div>';
  }

  function pairSummary(p) {
    const [b, q] = p.split('/'), s = get('Pair', p, 'WEEKLY');
    if (!s) return { cards: '', read: '' };
    const vals = pairPrices(p), last = vals[vals.length - 1], first = vals.find(v => v !== null);
    const ch6 = last && first ? (last / first - 1) * 100 : null;
    const rb = rate(b), rq = rate(q);
    let cards = kcard('COT PAIR SCORE', cotNum(s.Score), esc(s.Direction || '') + ' · weekly');
    let read = '';
    if (rb && rq) {
      const g = rb.cmp - rq.cmp;
      cards += kcard('INTEREST-RATE GAP', sg(g * 100) + ' bp', (g > 0 ? b + ' pays more' : g < 0 ? q + ' pays more' : 'equal') + '. Money tends to flow to the higher rate.') +
        kcard('RATE DIRECTION', '<span style="font-size:14px">' + b + ': ' + esc(stance(b).t) + '<br>' + q + ': ' + esc(stance(q).t) + '</span>', '');
      const mb = macroRead(b).s, mq = macroRead(q).s, side = mb > mq ? b : mq > mb ? q : null;
      const lim = cfg().neutral, cs = s.Score >= lim ? b : s.Score <= -lim ? q : null;
      read = (side ? 'The macro picture currently favours ' + side + ' (' + b + ' ' + macroRead(b).t.toLowerCase() + ', ' + q + ' ' + macroRead(q).t.toLowerCase() + '). ' : 'The macro picture is balanced between ' + b + ' and ' + q + ' (both ' + macroRead(b).t.toLowerCase() + '). ') +
        (cs ? 'Speculators favour ' + cs + ' (pair score ' + sg(s.Score) + '). ' : 'Speculators have no strong lean (pair score ' + sg(s.Score) + '). ') +
        (side && cs ? (side === cs ? 'They agree, which makes the story consistent. ' : 'They disagree: watch the next big releases for which side gives way. ') : '');
    } else {
      const ccy = ccyData(b) ? b : q, com = ccy === b ? q : b, key = COMMOD_OF[com], m = key && (NOTES().commodities || {})[key];
      read = (m ? m.now + ' ' : '') + 'The USD side: macro read ' + macroRead('USD').t.toLowerCase() + ', rates ' + stance('USD').t.toLowerCase() + '. ';
      void ccy;
    }
    read += 'Price over six months: ' + (ch6 !== null ? sg(ch6, 1) + '%' : 'n/a') + '.';
    cards += kcard('PRICE (WEEKLY)', last ? String(last) : '–', '6 months ' + (ch6 !== null ? sg(ch6, 1) + '%' : '–'), spark(vals));
    return { cards: cards, read: read };
  }

  function pairs() {
    const p = P.pairs.indexOf(S.pair) >= 0 ? S.pair : P.pairs[0], [b, q] = p.split('/'), sm = pairSummary(p);
    const ups = upcoming().filter(u => u[1] === b || u[1] === q || (u[1] === 'USD' && (COMMOD_OF[b] || COMMOD_OF[q])));
    return '<div class="panel"><div class="mph"><h3>' + esc(p) + '</h3>' + selectBox('mpp', P.pairs, p) + '<button class="btn" data-go="pair:' + esc(p) + '">OPEN COT PAIR ANALYSIS</button><span class="mut small">first currency up = pair up</span></div>' +
      '<div class="mkv">' + sm.cards + '</div><div class="mstory"><b>Reading it together.</b> ' + esc(sm.read) + '</div>' +
      '<div class="mvs">' + legCard(b) + '<div class="mid">vs</div>' + legCard(q) + '</div></div>' +
      '<div class="panel"><h2>Events that can move ' + esc(p) + ' · next two weeks · click for the breakdown</h2>' + (ups.length ? ups.map(u => eventRow(u, S.mev === evKey(u), true)).join('') : '<div class="mut small">No high or medium impact releases for these currencies in the next two weeks.</div>') + '</div>';
  }

  function commodities() {
    const C = NOTES().commodities || {}, y = (M() && M().yields) || {};
    const blocks = Object.keys(C).map(k => {
      const m = C[k];
      const cards = m.keys.map((pk, i) => {
        const item = m.cot[i], v = weeklyPrices(item), last = v[v.length - 1], first = v.find(z => z !== null), c6 = last && first ? (last / first - 1) * 100 : null, ct = cotOf(item);
        return kcard(esc(pk), last ? last.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : '–', '6 months ' + sg(c6, 1) + '% · COT ' + (ct ? cotNum(ct.Score) : '–'), spark(v));
      }).join('');
      const extra = k === 'gold' && y.real10 ? kcard('US 10-YEAR REAL YIELD', y.real10[1].toFixed(2) + '%', 'rising = headwind for gold · ' + fD(y.real10[0]), spark((y.real10s || []).map(r => r[1]), '#f0624d')) : '';
      return '<div class="panel"><h2>' + esc(m.title) + '</h2><div class="mkv">' + cards + extra + '</div>' +
        '<div class="row r2" style="margin-top:10px"><div><h3>What it is</h3><div class="msoft">' + esc(m.what) + '</div></div><div><h3>What’s driving it now</h3><div class="msoft">' + esc(m.now) + '</div></div></div>' +
        '<h3>How it connects to currencies</h3><div class="msoft">' + esc(m.links) + '</div>' +
        '<div style="margin-top:8px">' + m.cot.map(i => '<button class="btn" data-go="inst:' + esc(i) + '">OPEN ' + esc(i) + ' ANALYSIS</button> ').join('') + '</div></div>';
    }).join('');
    const yl = y.us10 ? '<div class="panel"><h2>US bond yields · from FRED, updated with each run</h2><div class="mkv">' +
      kcard('US 2-YEAR', y.us2[1].toFixed(2) + '%', 'tracks where the Fed is heading · ' + fD(y.us2[0])) +
      kcard('US 10-YEAR', y.us10[1].toFixed(2) + '%', 'what the US government pays to borrow · ' + fD(y.us10[0]), spark((y.us10s || []).map(r => r[1]))) +
      kcard('US 10-YEAR AFTER INFLATION', y.real10 ? y.real10[1].toFixed(2) + '%' : '–', 'the real return on safe money; high is bad for gold', spark((y.real10s || []).map(r => r[1]), '#f0624d')) +
      kcard('2-YEAR VS 10-YEAR', sg((y.us10[1] - y.us2[1]) * 100) + ' bp', y.us10[1] > y.us2[1] ? 'normal: long-term borrowing costs more' : 'inverted: markets expect rates to fall later') + '</div></div>' : '';
    return blocks + yl + '<div class="small mut">' + esc(NOTES().written || '') + '</div>';
  }

  function calendarView() {
    const f = S.mcf || 'ALL';
    const list = upcoming().filter(u => f === 'ALL' ? true : f === 'HIGH' ? u[2] === 'h' : u[1] === f);
    let day = '', html = '';
    list.forEach(u => {
      const d = ukDay.format(new Date(u[0] * 1000));
      if (d !== day) { html += '<div class="mdayh">' + d + '</div>'; day = d; }
      html += eventRow(u, S.mev === evKey(u), false);
    });
    const pick = '<div class="grp" style="margin-bottom:8px"><label>SHOW</label>' + ['ALL', 'HIGH'].concat(CCYS, ['CNY']).map(k => '<button class="btn ' + (f === k ? 'on' : '') + '" data-mcf="' + k + '">' + (k === 'HIGH' ? 'HIGH IMPACT' : k) + '</button>').join('') + '</div>';
    return '<div class="panel"><h2>Next two weeks · high <span class="mimp h"></span> and medium <span class="mimp m"></span> impact · UK time · click any event</h2>' + pick +
      (html || '<div class="mut small">Nothing scheduled for this filter.</div>') +
      '<div class="small mut" style="margin-top:10px">Results arrive with the next data update after each release. UK clocks go back on the last Sunday of October, so times from then are GMT.</div></div>';
  }

  function page() {
    if (!M()) return noData();
    const v = S.mv || 'overview';
    const sub = '<div class="grp msub">' + VIEWS.map(x => '<button class="btn ' + (v === x[0] ? 'on' : '') + '" data-mv="' + x[0] + '">' + x[1] + '</button>').join('') + '<span class="mut small" style="margin-left:auto">Data to ' + ukDate.format(new Date(M().asOf)) + ' · ' + (M().releaseCount || 0).toLocaleString('en-GB') + ' releases recorded since ' + (M().calendarFrom ? fTY(M().calendarFrom) : '–') + '</span></div>';
    const body = { overview: overview, countries: countries, pairs: pairs, commod: commodities, cal: calendarView }[v]();
    return sub + body + '<div class="panel small mut">Sources: release results and forecasts from the ForexFactory economic calendar, recorded automatically each run; US yields from the Federal Reserve (FRED); COT and prices from this dashboard. Written summaries are dated. Background to inform your own analysis, not advice.</div>';
  }

  /* ---------- panels on the other pages ---------- */
  function homePanels() {
    if (!M()) return '';
    const week = upcoming().filter(u => u[2] === 'h' && u[0] < nowS() + 7 * 86400);
    const shown = week.slice(0, 10);
    const list = shown.map(u => '<li class="mlink" data-mev="' + esc(evKey(u)) + '" data-mgo="1"><span><b class="mut" style="font-weight:600">' + uk(u[0]) + '</b> ' + tag(u[1]) + ' ' + esc(u[3]) + '</span><span class="small mut">' + (u[4] ? 'f’cast ' + esc(clean(u[4])) : '') + '</span></li>').join('') || '<li class="mut">No high-impact releases in the next seven days.</li>';
    const snap = CCYS.map(c => { const r = rate(c); return '<tr class="click" data-mc="' + c + '" data-mgo="1"><td>' + tag(c) + '</td><td class="mnum">' + (r ? esc(r.show.replace(' deposit', '')) : '–') + '</td><td>' + cell(stance(c)) + '</td><td>' + cell(macroRead(c)) + '</td><td class="mnum">' + cotCell(c) + '</td><td>' + cell(fit(c)) + '</td></tr>'; }).join('');
    return '<div class="row r2"><div class="panel"><h2>Coming up · next 7 days · high impact · UK time</h2><ul class="l">' + list + '</ul>' +
      '<div style="margin-top:8px"><button class="btn" data-mv="cal" data-mgo="1">FULL TWO-WEEK CALENDAR' + (week.length > shown.length ? ' (' + week.length + ' this week)' : '') + '</button></div></div>' +
      '<div class="panel"><h2>Macro snapshot · click a currency</h2><div class="mtw"><table><tr><th>CCY</th><th class="mnum">RATE</th><th>RATES</th><th>MACRO READ</th><th class="mnum">COT</th><th>MACRO VS COT</th></tr>' + snap + '</table></div>' +
      '<div style="margin-top:8px"><button class="btn" data-go="page:macro">OPEN MACRO &amp; NEWS</button></div></div></div>';
  }

  function pairPanel(p) {
    if (!M()) return '';
    const [b, q] = p.split('/'), sm = pairSummary(p);
    const ups = upcoming().filter(u => (u[1] === b || u[1] === q || (u[1] === 'USD' && (COMMOD_OF[b] || COMMOD_OF[q]))) && u[2] === 'h').slice(0, 6);
    return '<div class="panel"><h2>Macro &amp; news for ' + esc(p) + '</h2><div class="mkv">' + sm.cards + '</div><div class="mstory"><b>Reading it together.</b> ' + esc(sm.read) + '</div>' +
      '<h3>High-impact events in the next two weeks · click for the breakdown</h3>' + (ups.length ? ups.map(u => eventRow(u, S.mev === evKey(u), true)).join('') : '<div class="mut small">None scheduled.</div>') +
      '<div style="margin-top:8px"><button class="btn" data-mp="' + esc(p) + '">FULL MACRO VIEW OF ' + esc(p) + '</button></div></div>';
  }

  function instPanel(item) {
    if (!M()) return '';
    if (ccyData(item)) {
      const c = item, r = rate(c), inf = inflation(c);
      const ups = upcoming().filter(u => u[1] === c && u[2] === 'h').slice(0, 5);
      return '<div class="panel"><h2>Macro &amp; news for ' + esc(c) + ' · ' + esc(NAME[c]) + '</h2><div class="mkv">' +
        kcard('POLICY RATE', r ? esc(r.show) : '–', esc(stance(c).t)) + kcard('INFLATION', inf.v !== null && inf.v !== undefined ? inf.v.toFixed(1) + '%' : 'n/a', CB(c).target !== undefined ? 'target ' + CB(c).target + '%' : '') +
        kcard('JOBS', esc(jobs(c).t), '') + kcard('GROWTH', esc(growth(c).t), '') + kcard('DATA VS FORECASTS', esc(surprise(c).t), '') + kcard('MACRO READ', esc(macroRead(c).t), 'vs COT: ' + esc(fit(c).t)) + '</div>' +
        '<div class="mstory"><b>What’s going on.</b> ' + esc((NOTES().stories || {})[c] || '') + '<div class="small mut" style="margin-top:4px">' + esc(NOTES().written || '') + '</div></div>' +
        '<h3>High-impact events in the next two weeks · click for the breakdown</h3>' + (ups.length ? ups.map(u => eventRow(u, S.mev === evKey(u), true)).join('') : '<div class="mut small">None scheduled.</div>') +
        '<div style="margin-top:8px"><button class="btn" data-mc="' + esc(c) + '">FULL ' + esc(c) + ' MACRO PROFILE</button></div></div>';
    }
    const key = COMMOD_OF[item], m = key && (NOTES().commodities || {})[key];
    if (!m) return '';
    const ups = upcoming().filter(u => u[1] === 'USD' && u[2] === 'h').slice(0, 4);
    return '<div class="panel"><h2>Macro &amp; news for ' + esc(m.title) + '</h2><div class="row r2"><div><h3>What’s driving it now</h3><div class="msoft">' + esc(m.now) + '</div></div><div><h3>How it connects to currencies</h3><div class="msoft">' + esc(m.links) + '</div></div></div>' +
      '<h3>Big US events in the next two weeks (they move the dollar it is priced in)</h3>' + (ups.length ? ups.map(u => eventRow(u, S.mev === evKey(u), true)).join('') : '<div class="mut small">None scheduled.</div>') +
      '<div style="margin-top:8px"><button class="btn" data-mv="commod" data-mgo="1">COMMODITIES &amp; YIELDS</button></div></div>';
  }

  /* ---------- clicks: returns true when handled ---------- */
  function click(t) {
    const go = t.closest('[data-mgo]');
    const mv = t.closest('[data-mv]'), mc = t.closest('[data-mc]'), mp = t.closest('[data-mp]'), mcf = t.closest('[data-mcf]'), mev = t.closest('[data-mev]');
    if (t.closest('.mevd') && !t.closest('button')) return true;
    if (mev) {
      const k = mev.dataset.mev;
      if (go) { S.page = 'macro'; S.mv = 'cal'; S.mcf = 'ALL'; S.mev = k; render(); scrollToEvent(k); return true; }
      S.mev = S.mev === k ? null : k; render(); if (S.mev) scrollToEvent(k, true); return true;
    }
    if (mc) { S.page = 'macro'; S.mv = 'countries'; S.mc = mc.dataset.mc; render(); window.scrollTo(0, 0); return true; }
    if (mp) { S.page = 'macro'; S.mv = 'pairs'; S.pair = mp.dataset.mp; render(); window.scrollTo(0, 0); return true; }
    if (mcf) { S.mcf = mcf.dataset.mcf; render(); return true; }
    if (mv) { S.page = 'macro'; S.mv = mv.dataset.mv; render(); window.scrollTo(0, 0); return true; }
    return false;
  }
  function scrollToEvent(k, soft) {
    const el = Array.prototype.find.call(document.querySelectorAll('[data-mev]'), e => e.dataset.mev === k && e.classList.contains('mev'));
    if (!el) { window.scrollTo(0, 0); return; }
    const top = el.getBoundingClientRect().top;
    if (!soft || top < 0 || top > window.innerHeight - 120) window.scrollTo(0, Math.max(0, window.scrollY + top - 90));
  }
  document.addEventListener('keydown', ev => {
    const el = ev.target && ev.target.closest && ev.target.closest('.mev');
    if (el && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); el.click(); }
  });

  window.MacroView = { page: page, homePanels: homePanels, pairPanel: pairPanel, instPanel: instPanel, click: click };
})();
