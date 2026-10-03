'use strict';

/*
 * Backtest explorer: filters the stored backtest observations and returns summary statistics.
 * Runs in Node (tests) and in the browser (the dashboard's Research page). Logic is the same
 * as the Apps Script version (cotWebResearch).
 *
 * rows: array of objects with the keys used in docs/backtest.json.
 */
(function (root, factory) {
  const E = typeof module !== 'undefined' && module.exports ? require('./engine') : root.COT_ENGINE;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.COTResearch = api;
})(typeof self !== 'undefined' ? self : this, function (E) {

  function runResearch(p, backtest) {
    if (!backtest || !backtest.rows || backtest.rows.length === 0) {
      return { error: 'No backtest data yet. Run the update job (it builds the backtest automatically).' };
    }

    const neutral = E.PAIR_BIAS_THRESHOLD;
    const blank = function (x) { return x === '' || x === null || x === undefined; };
    const scoreMin = blank(p.scoreMin) ? -Infinity : Number(p.scoreMin);
    const scoreMax = blank(p.scoreMax) ? Infinity : Number(p.scoreMax);

    const horizons = [{ h: 1, col: 'r1' }, { h: 2, col: 'r2' }, { h: 4, col: 'r4' }];
    const buckets = { 1: [], 2: [], 4: [] };
    const nonOverlap = { 1: [], 2: [], 4: [] };

    let first = null, last = null, matched = 0;

    backtest.rows.forEach(function (row) {
      if (p.pair && p.pair !== 'ALL' && row.pair !== p.pair) return;
      if (p.bias && p.bias !== 'any' && row.bias !== p.bias) return;
      if (row.score < scoreMin || row.score > scoreMax) return;
      if (!E.cotWebCondition(row.pos, p.pos)) return;
      if (!E.cotWebCondition(row.mom, p.mom)) return;
      if (!E.cotWebCondition(row.acc, p.acc)) return;

      const key = row.week;
      if (p.from && key < p.from) return;
      if (p.to && key > p.to) return;

      let sign = 1;
      if (p.directional) {
        if (row.score >= neutral) sign = 1;
        else if (row.score <= -neutral) sign = -1;
        else return;
      }

      matched++;
      if (first === null || key < first) first = key;
      if (last === null || key > last) last = key;

      horizons.forEach(function (hz) {
        const x = row[hz.col];
        if (x === '' || x === null || x === undefined) return;
        const value = sign * Number(x);
        buckets[hz.h].push(value);
        if (Number(row.idx) % hz.h === 0) nonOverlap[hz.h].push(value);
      });
    });

    return {
      matched: matched,
      from: first,
      to: last,
      results: horizons.map(function (hz) {
        return { horizon: hz.h + 'W', all: E.cotWebStats(buckets[hz.h]), nonOverlap: E.cotWebStats(nonOverlap[hz.h]) };
      }),
      notes: backtest.notes || [],
      directional: !!p.directional,
      threshold: neutral
    };
  }

  return { runResearch: runResearch };
});
