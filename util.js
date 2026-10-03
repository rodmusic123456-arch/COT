'use strict';

const fs = require('fs');
const path = require('path');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw e;
  }
}

function writeJSON(file, value, pretty) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, pretty ? 1 : 0) + '\n');
  fs.renameSync(tmp, file);
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// fetch with retries and a timeout. Returns the Response, or throws after the last attempt.
async function fetchRetry(url, options, tries) {
  let last;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(45000) }, options || {}));
      if (res.status === 429 || res.status >= 500) {
        last = new Error('HTTP ' + res.status);
      } else {
        return res;
      }
    } catch (e) {
      last = e;
    }
    await sleep(1500 * Math.pow(2, i));
  }
  throw last;
}

// Local date parts -> yyyy-MM-dd (the engine builds its Dates from local parts).
function localKey(d) {
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

module.exports = { readJSON, writeJSON, sleep, fetchRetry, localKey };
