// Forward tracker: current calls (momentum weighted, |score|>20) vs momentum fade (FX only, |mom|>40, trade against momentum).
// Run from repo root on the research branch, after `git checkout origin/main -- docs data` (or with main's files present):
//   node research/track.js
// Adds this COT week's picks (frozen before the outcome) and scores any week whose 1-week / 2-week window has closed.
// Timing: a week's 1w result is final only after the Monday close one week after entry, so a Saturday run scores the
// week before last and prints the just-finished week as PROVISIONAL (not stored). Added 2026-11-28.
// Uses data/prices.json closes for both lists so the comparison is like for like.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const F = path.join(__dirname, 'fade_track.json');
const T = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : { started: null, rules: {}, weeks: [] };
T.rules = {
  current: 'live model call: |pair score| > 20, direction = sign(score)',
  fade: 'FX pairs only (no XAU/XAG/WTI/Brent), |momentum divergence| > 40, direction = opposite of momentum',
  entry: 'first close after the Friday release (COT date + 3 days); exit = last close on or before entry + 7 days (1w) / + 14 days (2w)'
};
const D = JSON.parse(fs.readFileSync(path.join(root, 'docs/data.json'), 'utf8'));
const P = JSON.parse(fs.readFileSync(path.join(root, 'data/prices.json'), 'utf8'));
const COMM = /XAU|XAG|WTI|Brent/;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = new Date().toISOString().slice(0, 10);

// 1. add this week's picks
const rows = D.data.filter(r => r.Kind === 'Pair' && r.Timeframe === 'WEEKLY');
const cot = rows[0] && rows[0]['COT Date'];
if (cot && !T.weeks.find(w => w.cot === cot)) {
  const cur = [], fade = [];
  for (const r of rows) {
    const s = +r.Score, m = +r['Momentum Divergence'];
    if (Math.abs(s) > 20) cur.push({ pair: r.Item, dir: s > 0 ? 1 : -1, score: s, mom: m });
    if (!COMM.test(r.Item) && Math.abs(m) > 40) fade.push({ pair: r.Item, dir: m > 0 ? -1 : 1, score: s, mom: m });
  }
  T.weeks.push({ cot, added: today, current: cur, fade });
  if (!T.started) T.started = cot;
}

// 2. score
function move(pair, cotDate, days) {
  const s = P[pair]; if (!s || !s.d) return null;
  const closes = s.c || s.p || s.close; if (!closes) return null;
  const rel = addDays(cotDate, 3);
  const ei = s.d.findIndex(d => d > rel); if (ei < 0) return null;
  const end = addDays(s.d[ei], days);
  if (end >= today) return null; // window not closed yet
  let xi = -1; for (let i = ei; i < s.d.length && s.d[i] <= end; i++) xi = i;
  if (xi <= ei) return null;
  return +((closes[xi] / closes[ei] - 1) * 100).toFixed(3);
}
for (const w of T.weeks) for (const k of ['current', 'fade']) for (const c of w[k]) {
  if (c.r1 == null) { const m = move(c.pair, w.cot, 7); if (m != null) c.r1 = m; }
  if (c.r2 == null) { const m = move(c.pair, w.cot, 14); if (m != null) c.r2 = m; }
}
fs.writeFileSync(F, JSON.stringify(T, null, 1));

// 3. summary
const stat = (list, h) => { const v = list.filter(c => c[h] != null).map(c => c[h] * c.dir); if (!v.length) return null;
  return { n: v.length, hit: v.filter(x => x > 0).length / v.length, avg: v.reduce((a, b) => a + b, 0) / v.length }; };
const f = s => s ? `${(100 * s.hit).toFixed(0)}% win, ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}% avg (${s.n})` : 'n/a';
const tot = { current: { r1: [], r2: [] }, fade: { r1: [], r2: [] } }, wv = { current: [0, 0], fade: [0, 0] };
let scored = 0;
console.log('COT week   | current calls 1w              | momentum fade 1w');
for (const w of T.weeks) {
  const a = stat(w.current, 'r1'), b = stat(w.fade, 'r1');
  if (a || b) scored++;
  for (const k of ['current', 'fade']) for (const h of ['r1', 'r2']) tot[k][h].push(...w[k].filter(c => c[h] != null));
  for (const [k, s] of [['current', a], ['fade', b]]) if (s) { wv[k][1]++; if (s.avg > 0) wv[k][0]++; }
  console.log(`${w.cot} | ${f(a).padEnd(29)} | ${f(b)}`);
}
console.log(`\nScored weeks: ${scored} (10-week comparison due when this reaches 10)`);
for (const k of ['current', 'fade']) console.log(`${k.padEnd(8)} 1w: ${f(stat(tot[k].r1, 'r1'))} | 2w: ${f(stat(tot[k].r2, 'r2'))} | weeks positive: ${wv[k][0]}/${wv[k][1]}`);
// provisional: weeks whose 1w window is still open (e.g. a Saturday run), entry close -> latest close. Printed only, never stored.
function prov(pair, cotDate) { const s = P[pair]; if (!s || !s.d) return null; const c = s.c; const ei = s.d.findIndex(d => d > addDays(cotDate, 3));
  if (ei < 0 || ei >= s.d.length - 1) return null; return (c[c.length - 1] / c[ei] - 1) * 100; }
for (const w of T.weeks) for (const k of ['current', 'fade']) {
  const open = w[k].filter(c => c.r1 == null); if (!open.length) continue;
  const v = open.map(c => { const m = prov(c.pair, w.cot); return m == null ? null : m * c.dir; }).filter(x => x != null);
  if (v.length) console.log(`PROVISIONAL ${w.cot} ${k}: ${(100 * v.filter(x => x > 0).length / v.length).toFixed(0)}% win, ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}% avg (${v.length}), entry close -> latest close, not final`);
}
const last = T.weeks[T.weeks.length - 1];
console.log(`\nPicks for COT week ${last.cot} (trading from ${addDays(last.cot, 6)}):`);
console.log('Current calls: ' + last.current.map(c => `${c.pair} ${c.dir > 0 ? 'BUY' : 'SELL'} (${c.score})`).join(', '));
console.log('Momentum fade: ' + last.fade.map(c => `${c.pair} ${c.dir > 0 ? 'BUY' : 'SELL'} (mom ${c.mom})`).join(', '));
