'use strict';
// EXPERIMENT. Turns the downloaded Yahoo data into clean daily and weekly candles.
// Yahoo's daily forex bars have a usable open/high/low but their "close" is a stale price close to the
// open, so for forex each day's close is taken from the next day's open (which matches broker closes
// to a few pips). Futures (gold, silver, oil) bars are used as they are.
const path = require('path');
const raw = { '1d': null };

function load() {
  if (!raw['1d']) raw['1d'] = require(path.join(__dirname, 'data', 'ohlc_1d.json'));
  return raw['1d'];
}

function londonDate(ts, tz) {
  // Yahoo stamps forex days at London midnight and futures at New York midnight; take the calendar date there.
  return new Date((ts + (tz === 'Europe/London' ? 6 : 12) * 3600) * 1000).toISOString().slice(0, 10);
}

function daily(pair) {
  const s = load()[pair];
  if (!s) return [];
  const fx = s.timezone === 'Europe/London';
  const bars = [];
  for (let i = 0; i < s.t.length; i++) {
    if ([s.o[i], s.h[i], s.l[i], s.c[i]].some(v => v === null || v === undefined || !(v > 0))) continue;
    const d = londonDate(s.t[i], s.timezone);
    const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    if (wd === 0 || wd === 6) continue;
    bars.push({ d, o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i] });
  }
  if (fx) {
    // close = next bar's open; the newest bar has no next open yet, so it is still forming: drop it.
    for (let i = 0; i < bars.length - 1; i++) {
      bars[i].c = bars[i + 1].o;
      bars[i].h = Math.max(bars[i].h, bars[i].c);
      bars[i].l = Math.min(bars[i].l, bars[i].c);
    }
    bars.pop();
  }
  return bars;
}

function weekly(pair) {
  const out = [];
  daily(pair).forEach(b => {
    const dt = new Date(b.d + 'T12:00:00Z');
    const monday = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    const w = out[out.length - 1];
    if (w && w.d === monday) { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.last = b.d; }
    else out.push({ d: monday, o: b.o, h: b.h, l: b.l, c: b.c, last: b.d });
  });
  return out;
}

module.exports = { daily, weekly };
