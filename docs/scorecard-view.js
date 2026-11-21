/*
 * Scorecard: did the command centre's weekly calls work out?
 * Reads P.scorecard (built by src/scorecard.js). Adds the SCORECARD page and a "Last week's calls" panel on the home page.
 * Uses the page's helpers (esc, col, fD) and state (P, S).
 */
(function () {
  'use strict';

  const SC = () => (typeof P !== 'undefined' && P && P.scorecard) || null;
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dn = k => { const p = String(k).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
  const fd = (k, wd) => { const d = new Date(typeof k === 'number' ? k : dn(k)); return (wd ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + MO[d.getUTCMonth()]; };
  const addD = (k, n) => dn(k) + n * 86400000;
  const pct = (v, dp) => v === null || v === undefined || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp === undefined ? 2 : dp) + '%';
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v));

  // One week's numbers. A call "worked" when price moved the way the call said; "went the other way" when it moved against it.
  function stats(w, strongOnly) {
    const lim = SC().strong;
    const calls = w.calls.filter(c => c[5] !== null && (!strongOnly || Math.abs(c[1]) >= lim));
    const won = calls.filter(c => c[5] * c[2] > 0), lost = calls.filter(c => c[5] * c[2] < 0);
    const avg = calls.length ? calls.reduce((a, c) => a + c[5] * c[2], 0) / calls.length : null;
    return { n: calls.length, won: won.length, lost: lost.length, hit: calls.length ? won.length / calls.length * 100 : null, avg: avg, wonList: won, lostList: lost, nodata: w.calls.filter(c => c[5] === null && c[8] !== 'pending').length };
  }
  const finals = () => SC().weeks.filter(w => w.status === 'final');
  const lastFinal = () => { const f = finals(); return f.length ? f[f.length - 1] : null; };
  const weekLabel = w => 'Report of ' + fd(w.release, true) + ' · tracked ' + fd(addD(w.release, 3)) + ' – ' + fd(addD(w.release, 7));
  const hitCol = h => h === null ? 'var(--mut)' : h >= 55 ? '#58c26d' : h <= 45 ? '#f0624d' : '#e8a33d';

  function callRow(c) {
    const fav = c[5] === null ? null : c[5] * c[2];
    const lim = SC().strong;
    return '<tr class="click" data-go="pair:' + esc(c[0]) + '"><td><b>' + esc(c[0]) + '</b>' + (Math.abs(c[1]) >= lim ? ' <span class="scstrong">STRONG</span>' : '') + '</td>' +
      '<td><span class="' + (c[2] > 0 ? 'pos' : 'neg') + '">' + (c[2] > 0 ? '▲ Up (bullish)' : '▼ Down (bearish)') + '</span></td>' +
      '<td class="scn"><b style="color:' + col(c[1]) + '">' + sgn(c[1]) + '</b></td>' +
      '<td class="scn">' + pct(c[5]) + '</td>' +
      '<td class="scn"><b class="' + (fav > 0 ? 'pos' : fav < 0 ? 'neg' : '') + '">' + pct(fav) + '</b></td>' +
      '<td>' + (c[9] > 0 ? '<span class="mcell c-pos" title="More of that week\u2019s big releases favoured this call">\u2714 backed</span>' : c[9] < 0 ? '<span class="mcell c-neg" title="More of that week\u2019s big releases went against this call">\u2718 against</span>' : '<span class="mcell c-mut" title="No clear lean from that week\u2019s big releases">mixed</span>') + '</td></tr>';
  }
  const callTable = (list, empty) => list.length ? '<div class="sctw"><table><tr><th>PAIR</th><th>CALL</th><th class="scn">COT SCORE</th><th class="scn">PRICE MOVE</th><th class="scn">FOR THE CALL</th><th>NEWS</th></tr>' + list.map(callRow).join('') + '</table></div>' : '<div class="mut small">' + empty + '</div>';

  function kpi(v, l, c, sub) { return '<div class="kpi"><div class="v"' + (c ? ' style="color:' + c + '"' : '') + '>' + v + '</div><div class="l">' + l + '</div>' + (sub ? '<div class="small mut">' + sub + '</div>' : '') + '</div>'; }

  function weekBlock(w) {
    const s = stats(w), ss = stats(w, true);
    const byFav = (a, b) => Math.abs(b[5]) - Math.abs(a[5]);
    const running = w.status === 'running';
    return '<div class="kpis">' +
      kpi(s.n, 'CALLS TRACKED', null, s.nodata ? s.nodata + ' without price data' : '') +
      kpi(s.won, 'WENT AS FORESEEN', '#58c26d') + kpi(s.lost, 'WENT THE OTHER WAY', '#f0624d') +
      kpi(s.hit === null ? '–' : Math.round(s.hit) + '%', 'HIT RATE', hitCol(s.hit), 'a coin flip is 50%') +
      kpi(pct(s.avg), 'AVERAGE MOVE FOR THE CALL', s.avg > 0 ? '#58c26d' : s.avg < 0 ? '#f0624d' : null, 'gains minus losses, per call') +
      kpi(ss.n ? ss.won + ' / ' + ss.n : '–', 'STRONG CALLS THAT WORKED', ss.n ? hitCol(ss.hit) : null, 'score beyond ±' + SC().strong) + '</div>' +
      (running ? '<div class="note">This week is still running: moves are measured to the latest price and will change until Friday’s close.</div>' : '') +
      '<div class="row r2" style="margin-top:12px"><div><h3 class="pos">✔ Went as foreseen (' + s.won + ')</h3>' + callTable(s.wonList.slice().sort(byFav), 'None.') + '</div>' +
      '<div><h3 class="neg">\u2718 Went the other way (' + s.lost + ')</h3>' + callTable(s.lostList.slice().sort(byFav), 'None.') + '</div></div>' +
      newsBlock(w, 'The news that week \u00b7 high-impact releases for these currencies (UK time)', false);
  }

  const ukT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const bwTag = (n, ccy) => !n[3] ? '<span class="mcell c-mut">' + (n[0] < Date.now() / 1000 ? 'no figure' : 'to come') + '</span>' : !n[4] ? '<span class="mcell c-mut">no forecast</span>' : n[5] === 1 ? '<span class="mcell c-pos">better for ' + ccy + '</span>' : n[5] === 2 ? '<span class="mcell c-neg">worse for ' + ccy + '</span>' : '<span class="mcell c-mut">as expected</span>';

  // The week's big releases for the currencies in its calls.
  function newsBlock(w, title, upcoming) {
    const ccys = {};
    w.calls.forEach(c => c[0].split('/').forEach(x => { ccys[x] = 1; }));
    const list = (w.news || []).filter(n => ccys[n[1]]);
    if (!list.length) return '<h3>' + title + '</h3><div class="mut small">No high-impact releases for these currencies in that window.</div>';
    const rows = list.map(n => '<li' + (upcoming ? ' class="mlink" data-mev="' + esc(n[0] + '|' + n[1] + '|' + n[2]) + '" data-mgo="1" title="Open the breakdown in Macro & News"' : '') + '><span><span class="mut">' + ukT.format(new Date(n[0] * 1000)) + '</span> <span class="mtag">' + esc(n[1]) + '</span> ' + esc(n[2]) +
      (n[3] ? ' <b>' + esc(n[3]) + '</b> <span class="mut">vs ' + esc(n[4] || '\u2013') + '</span>' : n[4] ? ' <span class="mut">forecast ' + esc(n[4]) + '</span>' : '') + '</span>' + bwTag(n, n[1]) + '</li>').join('');
    let read = '';
    if (!upcoming) {
      const s = stats(w);
      const wb = s.wonList.filter(c => c[9] > 0).length, la = s.lostList.filter(c => c[9] < 0).length;
      read = '<div class="small msoft" style="margin-bottom:6px">Of the ' + s.won + ' calls that worked, <b>' + wb + '</b> had the week\u2019s news behind them. Of the ' + s.lost + ' that went the other way, <b>' + la + '</b> had the news against them' +
        (s.lost && la / s.lost >= 0.5 ? ', so surprises in the data explain much of the miss.' : s.lost ? ', so most misses were not down to the scheduled data.' : '.') + '</div>';
    }
    return '<h3>' + title + '</h3>' + read + '<ul class="l scnews">' + rows + '</ul>';
  }

  function history() {
    const ws = SC().weeks.slice(-27).reverse();
    let tot = 0, won = 0, sn = 0, sw = 0, mv = 0;
    const rows = ws.map(w => {
      const s = stats(w), ss = stats(w, true);
      if (w.status === 'final') { tot += s.n; won += s.won; sn += ss.n; sw += ss.won; mv += (s.avg || 0) * s.n; }
      const bar = s.n ? '<div class="scbar"><i style="width:' + (s.won / s.n * 100) + '%;background:#3fae5a"></i><i style="width:' + (s.lost / s.n * 100) + '%;background:#d9412b"></i></div>' : '';
      return '<tr class="click" data-sw="' + esc(w.week) + '"' + (S.sw === w.week ? ' style="background:#1a2432"' : '') + '><td>' + fd(w.release, true) + (w.rebuilt ? ' <span class="mut small" title="Rebuilt from history with the same rules, before recording started">rebuilt</span>' : '') + '</td><td>' +
        (w.status === 'final' ? 'Done' : w.status === 'running' ? '<span style="color:#e8a33d">Running</span>' : '<span class="mut">Starts ' + fd(addD(w.release, 3), true) + '</span>') + '</td>' +
        '<td class="scn">' + (w.status === 'pending' ? w.calls.length : s.n) + '</td><td class="scn pos">' + (w.status === 'pending' ? '' : s.won) + '</td><td class="scn neg">' + (w.status === 'pending' ? '' : s.lost) + '</td><td style="min-width:110px">' + bar + '</td>' +
        '<td class="scn"><b style="color:' + hitCol(s.hit) + '">' + (s.hit === null ? '' : Math.round(s.hit) + '%') + '</b></td><td class="scn">' + (ss.n ? ss.won + '/' + ss.n : '') + '</td><td class="scn">' + (s.avg === null ? '' : pct(s.avg)) + '</td></tr>';
    }).join('');
    const hit = tot ? won / tot * 100 : null, shit = sn ? sw / sn * 100 : null;
    const nw = ws.filter(w => w.status === 'final').length;
    const verdict = hit === null ? '' : 'Over the last ' + nw + ' finished weeks, ' + won + ' of ' + tot + ' calls went the way the command centre pointed (' + Math.round(hit) + '%), ' +
      (hit >= 55 ? 'better than a coin flip.' : hit <= 45 ? 'worse than a coin flip: more calls went the other way than worked.' : 'about the same as a coin flip.') +
      ' Strong calls: ' + sw + ' of ' + sn + (shit === null ? '' : ' (' + Math.round(shit) + '%)') + '. Average move per call: ' + pct(tot ? mv / tot : null) + '.';
    return '<div class="panel"><h2>Week by week · last six months · click a week to see its calls · older weeks are in PERFORMANCE</h2><div class="note">' + esc(verdict) + '</div>' +
      '<div class="sctw"><table><tr><th>COT REPORT RELEASED</th><th>STATUS</th><th class="scn">CALLS</th><th class="scn">WORKED</th><th class="scn">OTHER WAY</th><th></th><th class="scn">HIT RATE</th><th class="scn">STRONG</th><th class="scn">AVG MOVE</th></tr>' + rows + '</table></div></div>';
  }

  /* ================= Performance: win rate by week, month, quarter, half-year and year ================= */
  const GROUPS = [['W', 'WEEKLY'], ['M', 'MONTHLY'], ['Q', 'QUARTERLY'], ['H', '6 MONTHS'], ['Y', 'YEARLY']];
  const FILTERS = [['all', 'ALL CALLS'], ['strong', 'STRONG ONLY'], ['bull', 'BULLISH CALLS'], ['bear', 'BEARISH CALLS']];
  const ym = k => k.slice(0, 7);
  function bucketOf(release, g) {
    const y = release.slice(0, 4), m = +release.slice(5, 7);
    if (g === 'W') return release;
    if (g === 'M') return ym(release);
    if (g === 'Q') return y + '-Q' + Math.ceil(m / 3);
    if (g === 'H') return y + '-H' + (m <= 6 ? 1 : 2);
    return y;
  }
  function bucketLabel(k, g) {
    if (g === 'W') return fd(k) + ' ' + k.slice(2, 4);
    if (g === 'M') return MO[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4);
    if (g === 'Q') return k.slice(5) + ' ' + k.slice(0, 4);
    if (g === 'H') return (k.slice(5) === 'H1' ? 'Jan–Jun ' : 'Jul–Dec ') + k.slice(0, 4);
    return k;
  }
  const keepCall = (c, f) => c[5] !== null && (f === 'all' || (f === 'strong' && Math.abs(c[1]) >= SC().strong) || (f === 'bull' && c[2] > 0) || (f === 'bear' && c[2] < 0));
  function agg(weeks, f) {
    const a = { weeks: weeks.length, n: 0, won: 0, sum: 0, sn: 0, sw: 0 };
    weeks.forEach(w => w.calls.forEach(c => {
      if (!keepCall(c, f)) return;
      const v = c[5] * c[2];
      a.n++; a.sum += v; if (v > 0) a.won++;
      if (Math.abs(c[1]) >= SC().strong) { a.sn++; if (v > 0) a.sw++; }
    }));
    a.lost = a.n - a.won; a.hit = a.n ? a.won / a.n * 100 : null; a.avg = a.n ? a.sum / a.n : null;
    return a;
  }

  function perfRange() {
    const fin = finals();
    const first = ym(fin[0].release), last = ym(fin[fin.length - 1].release);
    let from = S.pf || '', to = S.pt || '';
    if (!from || from < first) from = first;
    if (!to || to > last) to = last;
    if (from > to) from = to;
    return { first: first, last: last, from: from, to: to };
  }
  function addMonths(k, n) { const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); }

  function barChart(rows, g) {
    if (!rows.length) return '';
    const W = Math.max(640, rows.length * (g === 'W' ? 7 : 34)), H = 190, pl = 34, pr = 8, pt = 10, pb = 26;
    const bw = (W - pl - pr) / rows.length, Y = v => pt + (H - pt - pb) * (1 - v / 100);
    let g2 = '';
    [0, 25, 50, 75, 100].forEach(v => { g2 += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#263140"' + (v === 50 ? ' stroke-dasharray="4 3" stroke="#8b98a8"' : '') + '/><text x="' + (pl - 5) + '" y="' + (Y(v) + 3) + '" fill="#8b98a8" font-size="9" text-anchor="end">' + v + '%</text>'; });
    const every = Math.ceil(rows.length / (W / 70));
    rows.forEach((r, i) => {
      const x = pl + i * bw, h = r.a.hit;
      if (h !== null) g2 += '<rect x="' + (x + bw * 0.15).toFixed(1) + '" y="' + Y(h).toFixed(1) + '" width="' + Math.max(1, bw * 0.7).toFixed(1) + '" height="' + (Y(0) - Y(h)).toFixed(1) + '" fill="' + (h >= 50 ? '#3fae5a' : '#d9412b') + '" rx="1"><title>' + esc(bucketLabel(r.k, g) + ': ' + r.a.won + ' of ' + r.a.n + ' calls worked (' + Math.round(h) + '%)') + '</title></rect>';
      if (i % every === 0) g2 += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" fill="#8b98a8" font-size="9" text-anchor="middle">' + esc(bucketLabel(r.k, g)) + '</text>';
    });
    return '<div class="small mut">WIN RATE PER ' + ({ W: 'WEEK', M: 'MONTH', Q: 'QUARTER', H: 'HALF-YEAR', Y: 'YEAR' })[g] + ' · dashed line = 50% (a coin flip) · hover a bar for its numbers</div><div class="sctw"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;min-width:' + Math.min(W, 1200) + 'px;height:auto;display:block">' + g2 + '</svg></div>';
  }

  function equityChart(weeks, f) {
    let cum = 0;
    const vals = weeks.map(w => { const a = agg([w], f); cum += a.avg || 0; return cum; });
    if (vals.length < 2) return '';
    return lineChart(vals, { title: 'RUNNING TOTAL OF THE AVERAGE MOVE PER CALL, WEEK BY WEEK (%) · rising = the calls were paying, falling = they were not', dates: weeks.map(w => w.release), zero: 0, incZero: true, color: vals[vals.length - 1] >= 0 ? '#58c26d' : '#f0624d', fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + '%', h: 140 });
  }

  function perfPage() {
    const fin = finals();
    if (!fin.length) return '<div class="panel">No finished weeks yet.</div>';
    const g = S.pg || 'M', f = S.pfl || 'all', R = perfRange();
    const weeks = fin.filter(w => ym(w.release) >= R.from && ym(w.release) <= R.to);
    const tot = agg(weeks, f);
    const buckets = {};
    weeks.forEach(w => { const k = bucketOf(w.release, g); (buckets[k] = buckets[k] || []).push(w); });
    const rows = Object.keys(buckets).sort().map(k => ({ k: k, a: agg(buckets[k], f) }));
    const scored = rows.filter(r => r.a.n);
    const best = scored.slice().sort((a, b) => b.a.hit - a.a.hit || b.a.n - a.a.n)[0], worst = scored.slice().sort((a, b) => a.a.hit - b.a.hit || b.a.n - a.a.n)[0];
    const above = scored.filter(r => r.a.hit > 50).length;

    // period controls
    const years = []; for (let y = +R.first.slice(0, 4); y <= +R.last.slice(0, 4); y++) years.push(y);
    const presets = [['3M', 'LAST 3 MONTHS', addMonths(R.last, -2), R.last], ['6M', 'LAST 6 MONTHS', addMonths(R.last, -5), R.last], ['12M', 'LAST 12 MONTHS', addMonths(R.last, -11), R.last]]
      .concat(years.map(y => [String(y), String(y), y + '-01', y + '-12'])).concat([['ALL', 'ALL HISTORY', R.first, R.last]]);
    const isOn = p => { const a = p[2] < R.first ? R.first : p[2], b = p[3] > R.last ? R.last : p[3]; return a === R.from && b === R.to; };
    const mSel = (id, v) => '<select id="' + id + '">' + MO.map((m, i) => '<option value="' + String(i + 1).padStart(2, '0') + '"' + (+v.slice(5, 7) === i + 1 ? ' selected' : '') + '>' + m + '</option>').join('') + '</select>';
    const ySel = (id, v) => '<select id="' + id + '">' + years.map(y => '<option' + (+v.slice(0, 4) === y ? ' selected' : '') + '>' + y + '</option>').join('') + '</select>';
    const ctl = '<div class="scctl">' +
      '<div class="grp"><label>VIEW BY</label>' + GROUPS.map(x => '<button class="btn ' + (g === x[0] ? 'on' : '') + '" data-pg="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
      '<div class="grp"><label>PERIOD</label>' + presets.map(p => '<button class="btn ' + (isOn(p) ? 'on' : '') + '" data-pr="' + p[2] + '|' + p[3] + '">' + p[1] + '</button>').join('') + '</div>' +
      '<div class="grp"><label>FROM</label>' + mSel('pfm', R.from) + ySel('pfy', R.from) + '<label style="margin-left:8px">TO</label>' + mSel('ptm', R.to) + ySel('pty', R.to) + '</div>' +
      '<div class="grp"><label>CALLS</label>' + FILTERS.map(x => '<button class="btn ' + (f === x[0] ? 'on' : '') + '" data-pfl="' + x[0] + '">' + x[1] + '</button>').join('') + '</div></div>';

    const span = bucketLabel(R.from, 'M') + ' – ' + bucketLabel(R.to, 'M');
    const kp = '<div class="kpis">' +
      kpi(tot.hit === null ? '–' : Math.round(tot.hit) + '%', 'WIN RATE', hitCol(tot.hit), tot.won + ' of ' + tot.n + ' calls') +
      kpi(tot.n, 'CALLS', null, tot.weeks + ' weeks') + kpi(tot.won, 'WENT AS FORESEEN', '#58c26d') + kpi(tot.lost, 'WENT THE OTHER WAY', '#f0624d') +
      kpi(pct(tot.avg), 'AVERAGE MOVE PER CALL', tot.avg > 0 ? '#58c26d' : tot.avg < 0 ? '#f0624d' : null, 'gains minus losses') +
      kpi(f === 'all' && tot.sn ? Math.round(tot.sw / tot.sn * 100) + '%' : '–', 'STRONG CALLS WIN RATE', f === 'all' && tot.sn ? hitCol(tot.sw / tot.sn * 100) : null, f === 'all' ? tot.sw + ' of ' + tot.sn : 'see ALL CALLS') +
      kpi(scored.length ? above + ' / ' + scored.length : '–', 'PERIODS ABOVE 50%', null, ({ W: 'weeks', M: 'months', Q: 'quarters', H: 'half-years', Y: 'years' })[g]) + '</div>' +
      (best && scored.length > 1 ? '<div class="small mut" style="margin-top:6px">Best: <b class="pos">' + esc(bucketLabel(best.k, g)) + '</b> (' + Math.round(best.a.hit) + '%, ' + best.a.won + ' of ' + best.a.n + '). Worst: <b class="neg">' + esc(bucketLabel(worst.k, g)) + '</b> (' + Math.round(worst.a.hit) + '%, ' + worst.a.won + ' of ' + worst.a.n + ').</div>' : '');

    const table = '<div class="sctw"><table><tr><th>PERIOD</th><th class="scn">WEEKS</th><th class="scn">CALLS</th><th class="scn">WORKED</th><th class="scn">OTHER WAY</th><th></th><th class="scn">WIN RATE</th><th class="scn">AVG MOVE</th>' + (f === 'all' ? '<th class="scn">STRONG</th>' : '') + '</tr>' +
      rows.slice().reverse().map(r => '<tr' + (g === 'W' ? ' class="click" data-sw="' + esc(buckets[r.k][0].week) + '"' : '') + '><td>' + esc(bucketLabel(r.k, g)) + '</td><td class="scn">' + r.a.weeks + '</td><td class="scn">' + r.a.n + '</td><td class="scn pos">' + r.a.won + '</td><td class="scn neg">' + r.a.lost + '</td><td style="min-width:110px">' +
        (r.a.n ? '<div class="scbar"><i style="width:' + (r.a.won / r.a.n * 100) + '%;background:#3fae5a"></i><i style="width:' + (r.a.lost / r.a.n * 100) + '%;background:#d9412b"></i></div>' : '') + '</td><td class="scn"><b style="color:' + hitCol(r.a.hit) + '">' + (r.a.hit === null ? '–' : Math.round(r.a.hit) + '%') + '</b></td><td class="scn">' + pct(r.a.avg) + '</td>' +
        (f === 'all' ? '<td class="scn">' + (r.a.sn ? r.a.sw + '/' + r.a.sn : '') + '</td>' : '') + '</tr>').join('') + '</table></div>';

    // by pair, and bullish vs bearish
    const byPair = {};
    weeks.forEach(w => w.calls.forEach(c => { if (!keepCall(c, f)) return; const p = byPair[c[0]] = byPair[c[0]] || { n: 0, won: 0, sum: 0 }; const v = c[5] * c[2]; p.n++; p.sum += v; if (v > 0) p.won++; }));
    const pairs = Object.keys(byPair).map(k => ({ k: k, n: byPair[k].n, won: byPair[k].won, hit: byPair[k].won / byPair[k].n * 100, avg: byPair[k].sum / byPair[k].n })).sort((a, b) => b.hit - a.hit || b.n - a.n);
    const pairRow = p => '<tr class="click" data-go="pair:' + esc(p.k) + '"><td><b>' + esc(p.k) + '</b></td><td class="scn">' + p.n + '</td><td class="scn">' + p.won + '</td><td class="scn"><b style="color:' + hitCol(p.n >= 5 ? p.hit : null) + '">' + Math.round(p.hit) + '%</b></td><td class="scn">' + pct(p.avg) + '</td></tr>';
    const pairTable = list => '<div class="sctw"><table><tr><th>PAIR</th><th class="scn">CALLS</th><th class="scn">WORKED</th><th class="scn">WIN RATE</th><th class="scn">AVG MOVE</th></tr>' + list.map(pairRow).join('') + '</table></div>';
    const bull = agg(weeks, f === 'bear' ? 'none' : 'bull'), bear = agg(weeks, f === 'bull' ? 'none' : 'bear');
    const side = f === 'all' || f === 'strong' ? '<div class="small msoft" style="margin:4px 0 10px">Bullish calls: <b style="color:' + hitCol(bull.hit) + '">' + (bull.hit === null ? '–' : Math.round(bull.hit) + '%') + '</b> (' + bull.won + ' of ' + bull.n + '). Bearish calls: <b style="color:' + hitCol(bear.hit) + '">' + (bear.hit === null ? '–' : Math.round(bear.hit) + '%') + '</b> (' + bear.won + ' of ' + bear.n + ').' + (f === 'strong' ? ' (all calls, not just strong)' : '') + '</div>' : '';

    return '<div class="panel"><h2>Performance · ' + esc(span) + ' · ' + esc(FILTERS.find(x => x[0] === f)[1].toLowerCase()) + '</h2>' + ctl + kp + '</div>' +
      '<div class="panel">' + barChart(rows, g) + '<div style="max-width:900px">' + equityChart(weeks, f) + '</div></div>' +
      '<div class="panel"><h2>Period by period' + (g === 'W' ? ' \u00b7 click a week for its calls' : '') + '</h2>' + table + '</div>' +
      '<div class="panel"><h2>By pair · best to worst win rate in this period</h2>' + side + (pairs.length ? pairTable(pairs) : '<div class="mut small">No calls.</div>') + '<div class="small mut" style="margin-top:6px">Win rates on fewer than 5 calls are shown in grey: too few to mean much.</div></div>' +
      '<div class="panel small mut">Win rate = share of calls where the price moved the way the call said over the following week. Each week is counted in the period its COT report was released. Weeks before recording started (' + (SC().started ? fd(SC().started.slice(0, 10)) + ' ' + SC().started.slice(0, 4) : 'n/a') + ') are rebuilt with the same rules using only the data available at the time. Direction only: no entries, stops, targets or spreads.</div>';
  }

  function perfClick(t) {
    const a = t.closest('[data-pg]'), b = t.closest('[data-pr]'), c = t.closest('[data-pfl]'), v = t.closest('[data-scv]');
    if (v) { S.scv = v.dataset.scv; render(); return true; }
    if (a) { S.pg = a.dataset.pg; render(); return true; }
    if (c) { S.pfl = c.dataset.pfl; render(); return true; }
    if (b) { const p = b.dataset.pr.split('|'); S.pf = p[0]; S.pt = p[1]; render(); return true; }
    return false;
  }
  function perfAfter() {
    const read = () => { const g = id => document.getElementById(id); if (!g('pfy')) return; S.pf = g('pfy').value + '-' + g('pfm').value; S.pt = g('pty').value + '-' + g('ptm').value; if (S.pf > S.pt) { const x = S.pf; S.pf = S.pt; S.pt = x; } render(); };
    ['pfm', 'pfy', 'ptm', 'pty'].forEach(id => { const el = document.getElementById(id); if (el) el.onchange = read; });
  }

  function page() {
    if (!SC() || !SC().weeks.length) return '<div class="panel"><h2>Scorecard</h2><div class="note">The scorecard will appear after the next data update.</div></div>';
    const v = S.scv || 'week';
    const tabs = '<div class="grp msub">' + [['week', 'WEEK BY WEEK'], ['perf', 'PERFORMANCE \u00b7 WIN RATE OVER TIME']].map(x => '<button class="btn ' + (v === x[0] ? 'on' : '') + '" data-scv="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
    return tabs + (v === 'perf' ? perfPage() : weekPage());
  }

  function weekPage() {
    if (!SC() || !SC().weeks.length) return '<div class="panel"><h2>Scorecard</h2><div class="note">The scorecard will appear after the next data update.</div></div>';
    const all = SC().weeks;
    const sel = all.find(w => w.week === S.sw) || lastFinal() || all[all.length - 1];
    S.sw = sel.week;
    const pending = all.filter(w => w.status === 'pending').pop();
    const running = all.filter(w => w.status === 'running').pop();
    const upcoming = pending ? '<div class="panel"><h2>Calls for the coming week · ' + esc(weekLabel(pending)) + '</h2><div class="small mut" style="margin-bottom:8px">Picked from the latest COT report. Tracking starts with the first price after the release; check back next weekend for the result.</div><div class="scchips">' +
      pending.calls.slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(c => '<span class="scchip click" data-go="pair:' + esc(c[0]) + '"><b>' + esc(c[0]) + '</b> <span class="' + (c[2] > 0 ? 'pos' : 'neg') + '">' + (c[2] > 0 ? '▲' : '▼') + '</span> <b style="color:' + col(c[1]) + '">' + sgn(c[1]) + '</b></span>').join('') + '</div>' + newsBlock(pending, 'News that could move these calls \u00b7 click for the breakdown', true) + '</div>' : '';
    const opts = all.slice().reverse().filter(w => w.status !== 'pending').map(w => '<option value="' + esc(w.week) + '"' + (w.week === sel.week ? ' selected' : '') + '>' + esc(weekLabel(w)) + (w.status === 'running' ? ' (running)' : '') + '</option>').join('');
    return '<div class="panel"><h2>Scorecard · did the calls work out?</h2>' +
      '<div class="chp"><label for="scw">WEEK</label><select id="scw">' + opts + '</select>' + (running && running.week !== sel.week ? '<button class="btn" data-sw="' + esc(running.week) + '">THIS WEEK SO FAR</button>' : '') + '</div>' +
      '<div class="small mut" style="margin-bottom:10px">' + esc(weekLabel(sel)) + '. A call is any pair the command centre showed as bullish or bearish (weekly pair score beyond ±' + SC().neutral + '). It worked if the price then moved that way over the week; it went the other way if it moved against it. Click a pair for its full analysis.</div>' +
      weekBlock(sel) + '</div>' + upcoming + history() +
      '<div class="panel small mut"><b>How it is measured.</b> Each Friday’s COT report gives that week’s calls. Each call is tracked from the first price after the release to the price a week later (for the newest week, the latest price), the same way the Research page measures returns. ' +
      '“For the call” is the move in the direction of the call: + means it worked, − means it went the other way. Calls are saved the first time they are seen and never rewritten' + (SC().started ? ' (recording since ' + fd(SC().started.slice(0, 10)) + ')' : '') + '; earlier weeks marked “rebuilt” were recreated with the same rules using only the data available at the time. ' +
      'This measures direction only: it ignores entries, stops, targets and spreads, so it is not a trading result. Past hit rates do not promise future ones.</div>';
  }

  function homePanel() {
    if (!SC()) return '';
    const w = lastFinal();
    if (!w) return '';
    const s = stats(w);
    const top = list => list.slice().sort((a, b) => Math.abs(b[5]) - Math.abs(a[5])).slice(0, 4).map(c => '<li data-go="pair:' + esc(c[0]) + '" style="cursor:pointer"><span><b>' + esc(c[0]) + '</b> <span class="mut small">' + (c[2] > 0 ? 'called up' : 'called down') + ' (' + sgn(c[1]) + ')</span></span><span class="' + (c[5] * c[2] > 0 ? 'pos' : 'neg') + '"><b>' + pct(c[5] * c[2]) + '</b></span></li>').join('');
    return '<div class="panel"><h2>Last week’s calls · ' + esc(weekLabel(w)) + '</h2>' +
      '<div class="scsum"><span><b style="font-size:22px;color:' + hitCol(s.hit) + '">' + s.won + ' of ' + s.n + '</b> went as foreseen' + (s.hit === null ? '' : ' (' + Math.round(s.hit) + '%)') + '</span>' +
      '<div class="scbar" style="flex:1 1 200px"><i style="width:' + (s.n ? s.won / s.n * 100 : 0) + '%;background:#3fae5a"></i><i style="width:' + (s.n ? s.lost / s.n * 100 : 0) + '%;background:#d9412b"></i></div>' +
      '<button class="btn" data-go="page:score">OPEN SCORECARD</button></div>' +
      '<div class="row r2" style="margin-top:8px"><div><h3 class="pos">Biggest that worked</h3><ul class="l">' + (top(s.wonList) || '<li class="mut">None.</li>') + '</ul></div><div><h3 class="neg">Biggest that went the other way</h3><ul class="l">' + (top(s.lostList) || '<li class="mut">None.</li>') + '</ul></div></div></div>';
  }

  function click(t) {
    const w = t.closest('[data-sw]');
    if (w) { S.page = 'score'; S.scv = 'week'; S.sw = w.dataset.sw; render(); window.scrollTo(0, 0); return true; }
    if (perfClick(t)) return true;
    return false;
  }

  window.ScoreView = { page: page, homePanel: homePanel, click: click, after: perfAfter };
})();
