'use strict';
// EXPERIMENT. Overextended W (bullish) and M (bearish) detector on closed candles.
//
// W, in order (low1 to alert within MAX_AFTER_LOW1 bars):
//   start  s : highest high in the few bars before the first low
//   low1   a : the stretch from start high to low1 low is at least STRETCH x the typical move
//               (average absolute close-to-close move over the 20 bars before the start), within MAX_STRETCH_BARS
//   middle m : highest high between low1 and low2 (the bounce); at least BOUNCE of the stretch
//   low2   b : lowest low after the middle (can be the alert candle's own wick); it retests at least RETEST of the bounce. Its wick may
//               undercut low1 by up to UNDERCUT typical moves, but no close after low1 may close below
//               low1's close zone (by more than CLOSE_TOL typical moves)
//   alert  i : the FIRST candle that closes above the middle high. No earlier close above it.
// M is the same on an upside-down chart.
const P = {
  STRETCH: 4.0, MAX_STRETCH_BARS: 7, TYPICAL_BARS: 20,
  BOUNCE: 0.25, RETEST: 0.4, UNDERCUT: 1.0, CLOSE_TOL: 0.25,
  MAX_TOTAL_BARS: 30, MAX_AFTER_LOW1: 10
};

function flip(bars) { return bars.map(b => ({ d: b.d, o: -b.o, h: -b.l, l: -b.h, c: -b.c })); }

function typicalAbs(bars, s) {
  if (s < P.TYPICAL_BARS + 1) return null;
  let sum = 0;
  for (let k = s - P.TYPICAL_BARS + 1; k <= s; k++) sum += Math.abs(bars[k].c - bars[k - 1].c);
  return sum / P.TYPICAL_BARS;
}

// Find a W that confirms exactly on bar i (its close is the first close above the middle).
function wAt(bars, i, p) {
  p = Object.assign({}, P, p || {});
  let best = null;
  for (let a = i - 2; a >= Math.max(p.TYPICAL_BARS + 2, i - p.MAX_AFTER_LOW1); a--) {
    // low1 must be the lowest low from the start of the stretch to itself
    let s = -1, sh = -Infinity;
    for (let k = a - 1; k >= Math.max(0, a - p.MAX_STRETCH_BARS); k--) if (bars[k].h > sh) { sh = bars[k].h; s = k; }
    if (s < 0) continue;
    let isLow = true;
    for (let k = s; k < a; k++) if (bars[k].l < bars[a].l) { isLow = false; break; }
    if (!isLow) continue;
    const T = typicalAbs(bars, s);
    if (!T) continue;
    const stretch = sh - bars[a].l;
    if (stretch < p.STRETCH * T) continue;
    // middle = highest high between low1 and the bar before i; low2 = lowest low after the middle, before i
    let m = -1, mh = -Infinity;
    for (let k = a + 1; k < i; k++) if (bars[k].h > mh) { mh = bars[k].h; m = k; }
    if (m < 0) continue;
    // the second test may be the alert candle's own wick (it pokes back towards low1, then closes above the middle)
    let b = -1, bl = Infinity;
    for (let k = m + 1; k <= i; k++) if (bars[k].l < bl) { bl = bars[k].l; b = k; }
    if (b < 0) continue;
    const bounce = mh - bars[a].l;
    if (bounce < p.BOUNCE * stretch || bounce < T) continue;
    if (mh - bl < p.RETEST * bounce) continue;
    if (bl < bars[a].l - p.UNDERCUT * T) continue;
    // low1 stays the extreme of the whole pattern (only low2's wick may poke slightly below it)
    let lowest = true;
    for (let k = a + 1; k <= i; k++) if (bars[k].l < bars[a].l - p.UNDERCUT * T) { lowest = false; break; }
    if (!lowest) continue;
    for (let k = a + 1; k <= m; k++) if (bars[k].l < bars[a].l) { lowest = false; break; }
    if (!lowest) continue;
    // closes: none after low1 below low1's close zone; none above the middle before i; bar i closes above it
    const floor = Math.min(bars[a].c, bars[a - 1].c, bars[a + 1] ? bars[a + 1].c : Infinity) - p.CLOSE_TOL * T;
    let ok = true;
    for (let k = a + 1; k < i; k++) { if (bars[k].c < floor || bars[k].c > mh) { ok = false; break; } }
    if (!ok || !(bars[i].c > mh)) continue;
    const cand = { start: s, low1: a, middle: m, low2: b, alert: i, stretchTypical: stretch / T, typical: T,
      startPrice: sh, low1Price: bars[a].l, middlePrice: mh, low2Price: bl, closePrice: bars[i].c };
    if (!best || cand.stretchTypical > best.stretchTypical) best = cand;
  }
  return best;
}

function scan(bars, p) {
  const out = [], last = { W: -99, M: -99 };
  const up = bars, dn = flip(bars);
  for (let i = 0; i < bars.length; i++) {
    const w = wAt(up, i, p);
    if (w && i - last.W > 5) { out.push(Object.assign({ type: 'W', date: bars[i].d }, w)); last.W = i; }
    const m = wAt(dn, i, p);
    if (m && i - last.M > 5) {
      last.M = i;
      ['startPrice', 'low1Price', 'middlePrice', 'low2Price', 'closePrice'].forEach(k => { m[k] = -m[k]; });
      out.push(Object.assign({ type: 'M', date: bars[i].d }, m));
    }
  }
  return out;
}

module.exports = { scan, wAt, P };
