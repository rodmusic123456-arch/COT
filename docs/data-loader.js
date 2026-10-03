/*
 * Loads the dashboard data from static files (data.json, stamp.json, backtest.json).
 * The page was written against three server calls (cotWebPayload, cotWebStamp, cotWebResearch);
 * this file answers them from data.json, stamp.json and backtest.json.
 */
(function () {
  'use strict';

  var E = window.COT_ENGINE;
  var backtest = null;

  function getJSON(url) {
    return fetch(url + '?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + url + ' (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  var api = {
    cotWebPayload: function () {
      return getJSON('data.json').then(function (p) {
        var s = p.status || {};
        // Recomputed in the browser so "awaiting new COT" is correct even if the file is a few days old.
        p.live = E.cotDashStatus(
          s['COT DATE'] || '', s['PRICE DATE'] || '',
          Number(s['MISSING INSTRUMENTS']) || 0, Number(s['PAIRS WITHOUT PRICE']) || 0, new Date()
        );
        return p;
      });
    },

    cotWebStamp: function () {
      return getJSON('stamp.json').then(function (x) { return x.stamp; });
    },

    cotWebResearch: function (params) {
      var ready = backtest ? Promise.resolve(backtest) : getJSON('backtest.json').then(function (b) { backtest = b; return b; });
      return ready.then(function (b) {
        return window.COTResearch.runResearch(params || {}, b);
      }, function () {
        return { error: 'No backtest data yet. It is built automatically when the update job runs with price data.' };
      });
    }
  };

  function make(success, failure) {
    var o = {
      withSuccessHandler: function (fn) { return make(fn, failure); },
      withFailureHandler: function (fn) { return make(success, fn); }
    };
    Object.keys(api).forEach(function (name) {
      o[name] = function (arg) {
        Promise.resolve().then(function () { return api[name](arg); }).then(
          function (result) { if (success) success(result); },
          function (err) { if (failure) failure(err); else console.error(err); }
        );
      };
    });
    return o;
  }

  window.google = { script: { run: make(null, null) } };
})();
