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
    const ws = SC().weeks.slice().reverse();
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
    const nw = finals().length;
    const verdict = hit === null ? '' : 'Over the last ' + nw + ' finished weeks, ' + won + ' of ' + tot + ' calls went the way the command centre pointed (' + Math.round(hit) + '%), ' +
      (hit >= 55 ? 'better than a coin flip.' : hit <= 45 ? 'worse than a coin flip: more calls went the other way than worked.' : 'about the same as a coin flip.') +
      ' Strong calls: ' + sw + ' of ' + sn + (shit === null ? '' : ' (' + Math.round(shit) + '%)') + '. Average move per call: ' + pct(tot ? mv / tot : null) + '.';
    return '<div class="panel"><h2>Week by week · click a week to see its calls</h2><div class="note">' + esc(verdict) + '</div>' +
      '<div class="sctw"><table><tr><th>COT REPORT RELEASED</th><th>STATUS</th><th class="scn">CALLS</th><th class="scn">WORKED</th><th class="scn">OTHER WAY</th><th></th><th class="scn">HIT RATE</th><th class="scn">STRONG</th><th class="scn">AVG MOVE</th></tr>' + rows + '</table></div></div>';
  }

  function page() {
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
    if (w) { S.page = 'score'; S.sw = w.dataset.sw; render(); window.scrollTo(0, 0); return true; }
    return false;
  }

  window.ScoreView = { page: page, homePanel: homePanel, click: click };
})();
