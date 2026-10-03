#!/usr/bin/env node
'use strict';

/*
 * Download new COT and price data, then rebuild the dashboard files in docs/.
 *
 *   node scripts/update.js            full update (needs internet)
 *   node scripts/update.js --offline  rebuild from the stored data only
 *
 * A failing download never stops the build: the stored history is kept, the problem is
 * written to the dashboard's status, and the page shows what it has.
 */

const fs = require('fs');
const path = require('path');
const cfg = require('../src/config');
const cot = require('../src/cot');
const prices = require('../src/prices');
const { build } = require('../src/build');

function log(msg) { console.log(msg); }

async function main() {
  const offline = process.argv.includes('--offline');
  const errors = [];
  let priceReport = '';

  if (!offline) {
    log('--- CFTC COT ---');
    const c = await cot.updateCOT(log);
    errors.push.apply(errors, c.errors);
    log(c.added + ' new COT row(s).');

    log('--- Prices ---');
    const p = await prices.updatePrices(log);
    priceReport = p.report;
    log(p.added + ' new price row(s).');
  }

  log('--- Build ---');
  const result = build({
    priceReport: priceReport,
    lastError: errors.length ? 'COT download: ' + errors.join('; ') : ''
  });

  // The page loads the same engine code as the build, so the browser can never disagree with it.
  ['engine.js', 'research.js'].forEach(function (f) {
    fs.copyFileSync(path.join(cfg.ROOT, 'src', f), path.join(cfg.DOCS_DIR, f));
  });
  fs.writeFileSync(path.join(cfg.DOCS_DIR, '.nojekyll'), '');

  const s = result.payload.status;
  log('COT ' + s['COT DATE'] + ' | prices ' + (s['PRICE DATE'] || 'none') + ' | status ' + s['DATA STATUS'] + ' | ' + s['VALIDATION']);

  if (result.check.problems.length) {
    console.error('Validation problems:\n' + result.check.problems.join('\n'));
    process.exitCode = 1;
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
