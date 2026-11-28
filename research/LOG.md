# COT Command Centre – research log

Weekly background research. Nothing here changes the live system; Blaze approves every change.
Scripts used are in this folder (`lib.js`, `t1.js`–`t3.js`, run with `node research/t1.js` from repo root after fixing the paths at the top of lib.js).

Conventions: "hit" = share of calls whose move had the right sign. "avg" = average directional move per call in %, after flipping bearish calls.
IS = 2022–2024 (in-sample, where rules are chosen). OOS = 2025–2026 (out-of-sample). "wk" = one vote per week (week counts as a win if the average move of its calls was positive). 1-week horizon unless stated; 2w/4w use non-overlapping weeks only.

---

## 2026-11-22 (first entry)

**Data:** scorecard.json on main, 254 final weeks (2022-01-04 → 2026-11-10), 4,046 calls. backtest.json rows to 2026-11-10 (r1 complete to 2026-11-03).
Score check: backtest score = 0.5·pos + 0.3·mom + 0.2·acc exactly (mean abs error 0.03), so alternative blends can be rebuilt from the row components.

**Scorecard**
- Week of 2026-11-10 (exited 21 Nov): 18 of 19 calls worked, avg +1.42% per call. Best week in months; mostly AUD/NZD/JPY-cross shorts.
- Running: 47.2% hit, −0.07% avg per call (4,046 calls). One vote per week: 44% of 254 weeks positive.
- By year (hit / avg): 2022 50%/−0.07, 2023 43%/−0.20, 2024 45%/−0.13, 2025 49%/+0.11, 2026 47%/−0.08. Only 2025 was positive.

**Momentum fade (main finding, confirmed)** — rule: when pair momentum divergence |mom| > 40, trade AGAINST its sign.
- 1 week: 54% / +0.14 (2,824 calls). IS 55%/+0.15; OOS 52%/+0.12. Current calls: IS 46%/−0.13, OOS 48%/+0.01.
- Years: 2022 52%/+0.11, 2023 55%/+0.22, 2024 58%/+0.13, 2025 46%/−0.04, 2026 58%/+0.26 → beats current calls in 4 of 5 years. 2025 is the exception (the one year the current calls worked).
- One vote per week: 61% of 251 weeks; OOS 65% of 94 weeks (current: 44% / OOS 51%).
- 2 weeks (non-overlapping): 56%/+0.28, positive average in every year (2025 +0.17). 4 weeks: fades out (51%/+0.02).
- Recent: last 13 weeks 60%/+0.23 vs current 47%/−0.11; last 26 weeks 60%/+0.36 vs 44%/−0.29; last 52 weeks 56%/+0.26 vs 46%/−0.07.
- Not just price reversal: corr(mom, prior-week price move) = 0.01, and fading last week's price move alone does nothing (49%/−0.01).
- Broad across currencies (FX 52–58% for every currency, IS and OOS mostly >50%). Oil (WTI/Brent) does NOT work (46–49%, OOS 37%); gold/silver small samples.
- Stronger when prior week's price moved opposite to momentum (56%/+0.21, OOS 53%/+0.22) and on bearish-momentum fades (buy when mom < −40: 56%/+0.20, OOS 54%/+0.15).
- Negative correlation with current calls week to week (e.g. 20 & 27 Oct: current calls won big, fade lost). Much of the current call's failure comes from its momentum component.

**Blend reweighting (pos/mom/acc), grid searched on IS, |score|>20**
- Best IS blends (e.g. −0.2/−0.3/−0.5) reach IS 55%/+0.20 but drop to OOS 50%/+0.05 → overfit, rejected.
- Simple robust options: momentum only, faded (0/−1/0): 54%/+0.11, OOS 53%/+0.09, wk 58% (OOS 59%); 0/−0.6/+0.4: 54%/+0.10, OOS 53%/+0.11, wk 59%, 2w 54%/+0.20.
- Just flipping the momentum sign in the current blend (0.5/−0.3/0.2): 51%/+0.03, OOS 50%/+0.08 — small gain, positioning drags it.
- Dropping momentum (0.7/0/0.3): 49%/−0.02 — not enough.

**Other checks (not working / no edge)**
- Positioning alone (|pos|>40 or >70): 47–48%, avg ≈ −0.05. Fading it: mixed by year (fails 2022, 2025-26 at 1w). At 4 weeks fading extreme positioning (|pos|>70) was 57% but avg −0.13 (one bad 2022) → no.
- Acceleration: 1w follow 52%/+0.04 (weak). 4w FADE acc>20: 56%/+0.41, every year positive, OOS 58%/+0.56, wk 61% of 62 (OOS 64% of 22 weeks — too few weeks). Watch item.
- Score bands: strong (>50) 47%/−0.04; 20–35 and 35–50 no better. Higher threshold doesn't help.
- Bullish calls slightly better than bearish (48%/−0.04 vs 45%/−0.13) but neither positive overall.
- Calls with momentum agreeing vs disagreeing with score: no reliable difference.
- News tilt (scorecard newsTilt, since Mar 2026): calls AGAINST the news tilt 57%/+0.45 (119 calls, 27 weeks); WITH the news tilt 41%/−0.18 (104 calls, 26 weeks). Too small; watch.

**Independence:** ~16 calls/week across 32 pairs sharing 8 currencies + 4 commodities. Real independent sample ≈ number of weeks (≈250 total, ≈96 OOS), not number of calls. Weekly-vote results above are the honest ones.

**Recommendation this week:** add a tracked "momentum fade" list (FX only, |mom|>40, trade against momentum, 1–2 week hold) to the scorecard alongside the current calls, without changing the current calls. Review after ~8 more weeks; if it keeps beating, consider replacing the momentum weight with a faded one.

**Still checking next week:** fade-momentum live track (incl. week 2026-11-10 once r1 lands), 4w acceleration fade, news-tilt contrarian effect as weeks accumulate, whether 2025-style regimes can be detected in advance (e.g. trailing 8-week result of current vs fade).

### 2026-11-22 (later): forward tracker started (Blaze's request)
- New `research/track.js` + `research/fade_track.json`: each Sunday it freezes the coming week's picks for both lists (current calls vs momentum fade) and scores weeks once their 1w/2w windows close, using data/prices.json daily closes for both (so moves can differ slightly from the scorecard, which uses its own exit stamp).
- First tracked COT week: 2026-11-17 (trades 23–27 Nov). The 10-week comparison report is due once 10 weeks are scored (around the end of January 2027).
- Note on this week: the two lists disagree on 7 pairs (AUD/JPY, AUD/CHF, AUD/CAD, NZD/JPY, NZD/CHF, GBP/AUD, GBP/NZD): the current calls follow the selling in AUD/NZD and the fade says buy.

---

## 2026-11-28 (Saturday run)

**Data:** main @ ccd3ec3 (Data update 2026-11-28T06:57Z). **No new COT this week**: status "AWAITING NEW COT", latest COT date still 2026-11-17. The 24 Nov report was held back by the US Thanksgiving holiday (normally released the following Monday; the Monday 17:30 UTC catch-up run should pick it up). So there is **no pending scorecard week**; the 2026-11-17 week has been finalised. backtest.json r1 now complete to 2026-11-10 (r1 filled for 33 rows since last week; no score/mom values changed).

**Scorecard**
- Week of 2026-11-17 (traded 23–27 Nov): current calls 10 of 21 worked (48%), avg −0.16%. Scorecard fade list 4 of 10 (40%), avg −0.01%.
- Running: 47% hit, −0.07% avg (4,067 calls); one vote per week 44% of 255 weeks. By year unchanged in substance (2025 the only positive year).
- Scorecard fade list (rebuilt history, FX only): 54% / +0.08 (2,479 calls), weeks 56% of 247; IS 56%/+0.11, OOS 52%/+0.04.
- Recent swing: last 4 weeks current 66%/+0.50 vs fade 38%/−0.32; last 8 weeks 58%/+0.29 vs 45%/−0.16. Last 13/26/52 weeks still favour the fade (56%/+0.17, 61%/+0.28, 55%/+0.11 vs 52%/+0.04, 45%/−0.22, 47%/−0.05). The fade lost 4 of the last 6 weeks.

**Tracker (research/track.js)**
- Timing fix: the 1w window runs Monday close → Monday close (same as backtest r1), so a Saturday run cannot finalise the week just traded. The rule is unchanged; the script now also prints a PROVISIONAL line (entry close → latest close, not stored). Effect: each Saturday report finalises the week before last. (Tried a Fri→Fri window first; it gave very different numbers for this week (current 86%, fade 0%) because of the big Friday 20 Nov move, so the original rule was kept for consistency with the research.)
- Scored weeks: 0 (2026-11-17 finalises after Mon 30 Nov close). Provisional 2026-11-17: current 38% / −0.11 (21), fade 40% / −0.17 (10).
- No new picks this week (no new COT). 10-week comparison now due around early February 2027.

**Correction to last week's log.** The headline fade figures (54%/+0.14, 2,824 calls, weekly 61%) included gold, silver and oil. **FX only** (the rule actually tracked): 54% / +0.08 (2,468), weekly 56% of 246; IS 55%/+0.11, OOS 52%/+0.04 (weekly OOS 54% of 93). Years 2022 52%/−0.00, 2023 56%/+0.13, 2024 59%/+0.18, 2025 46%/−0.08, 2026 57%/+0.15. It still beats the current calls in 4 of 5 years on both hit and avg, but the edge is about half what was written.
- Metals fades (XAU+XAG): 56%/+0.98 (178 calls, 117 weeks) but IS only 51%/+0.26; OOS 67%/+2.60 is almost all 2026. Not chosen on IS → watch only. Oil fades: 46–49%, OOS 37% → still excluded.

**New tests (research/t4.js)**
- Fade 2w (non-overlapping): 56%/+0.19 (offset 0). **Offset check**, starting one week later: 55%/+0.12, but 2025 −0.31 and weekly OOS only 44% of 45. So the 2-week hold is less robust than it looked; the 1-week rule is the main one.
- Fade "week 2 only" (2nd week after the report): 55%/+0.07, IS 55%/+0.10, OOS 54%/+0.01. Current calls week 2 only: 48%/−0.03. A stale (week-old) report still carries a small fade edge and no current-call edge. Relevant this week because of the delayed report.
- **4w acceleration fade: rejected.** Last week's "every year positive, OOS 58%" was for one starting week only. Other start offsets: 48%/+0.02, 54%/+0.01, 44%/−0.33. Phase luck, drop from the watch list.
- Regime switch (each week use whichever list had the better trailing N-week avg, lagged one week so it's known in time): N=2/4/6/8/13 give weekly 52–55%, below always-fade (56%); IS 48–52% vs fade 58%. Weekly fade-minus-current spread autocorrelation lag1 = 0.14, lag2 0.04. Streaks are too short to switch on. Rejected.
- Both lists agree (|score|>20 and fade same direction): 48%/+0.19, only 52 calls / 42 weeks. Too small; no evidence that agreement helps.
- Lists disagree, follow the fade: 54%/+0.10 (1,548), IS 56%/+0.14, OOS 52%/+0.04. When they clash, the fade side has been the better one.
- Current FX calls with no fade signal: 47%/−0.06 (1,910). No edge.
- Fade by strength: |mom| 40–60 53%/+0.08; 60–80 54%/+0.07; >80 57%/+0.10 (weekly 60% of 119, OOS 63% of 46). Mild monotone, not enough to change the threshold.
- News tilt (since Mar 2026): current calls AGAINST tilt 56%/+0.41 (124 calls, 28 weeks); WITH tilt 40%/−0.19 (109, 27 weeks). Holding up, still just under the 30-week bar. Fade list shows no such effect (with 61%/+0.21, against 53%/+0.06).

**Watch items carried forward:** fade live track; metals fade; news-tilt contrarian on current calls (re-check at 30+ weeks); fade |mom|>80 band.

**Setups watchlist for week of 30 Nov–4 Dec (from COT 2026-11-17, re-check after the delayed report)**
Macro reads (dashboard rule): USD Supportive, GBP Supportive, AUD Supportive, EUR Mixed, JPY Mixed, CHF Mixed, CAD Weak, NZD Weak.
1. USD/CHF BUY: fade (mom −58.9), no current call; macro agrees. Week 1 −0.62% (against). Last 0.8345, wk −1.1%, ~67% of 1m range.
2. EUR/AUD SELL: fade (mom +54.9); macro agrees. Week 1 worked (−0.75%). Last 1.6530, wk +0.3%, ~95% of range.
3. AUD/CHF BUY: fade (mom −91.8, strongest); CONTESTED (current SELL −59.3); macro agrees with buy. Last 0.5539, wk −1.4%, ~9% of range.
4. GBP/USD SELL: fade (mom +60.2), no current call; macro neutral (both Supportive). Last 1.3107, wk +0.2%, ~16% of range.
5. NZD/USD SELL: current call (score −39.3, mom −15.1); macro agrees (NZD Weak vs USD Supportive). Stale current calls have no week-2 edge. Last 0.5471, wk −0.2%, ~9% of range.
Contested (current vs fade): GBP/AUD, GBP/NZD, AUD/JPY, AUD/CHF, AUD/CAD, NZD/JPY, NZD/CHF.

**Recommendation:** no change yet. Keep tracking. If the delayed report lands Monday, the tracker should be run on it (node research/track.js) to freeze picks.
