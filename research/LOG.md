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
