# COT Market Command Centre

A dashboard built on the CFTC Commitments of Traders (COT) report. For 21 FX pairs, gold, silver and two oil benchmarks it shows who is bullish or bearish, how strong the signal is, and whether price agrees.

It runs entirely on GitHub, free:

- A scheduled GitHub Action downloads the latest CFTC and price data, runs the scoring, and publishes the page.
- The page is a static site on GitHub Pages. There is no server, no spreadsheet and no script editor to maintain.

## Set up (about 5 minutes, once)

1. Create a new repository on GitHub. Public is fine; Pages on a private repo needs a paid plan.
2. Upload everything in this folder to it, keeping the folder structure. Make sure the hidden `.github` folder goes up too (check that `.github/workflows/update.yml` exists in the repo afterwards).
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. **Actions → Update dashboard → Run workflow.** The first run downloads about five years of history and takes a couple of minutes.
5. Open the address shown at the end of the run (also under Settings → Pages). It looks like `https://<your-name>.github.io/<repo>/`.

## When it updates

| Job | When (UTC) | Why |
| --- | --- | --- |
| COT + prices | Friday 23:00 UK time | CFTC publishes Friday 15:30 US Eastern (about 20:30 UK), so the report is out. Two schedule entries cover summer and winter time; only the one that is 23:00 in London runs |
| COT + prices | Monday 17:30 | catch-up if a Friday run was missed |
| COT + prices | Mon to Thu 22:30 | daily price refresh (COT only changes when CFTC publishes) |

The page checks for new data every minute and reloads itself. You can also run **Actions → Update dashboard → Run workflow** any time.

## How to read it

Open the **Glossary** and **Methodology** tabs on the page. Every number has a hover explanation: what it means, why it matters, and what it means for the trade plan.

- Gauges run from -100 (bearish, left, red) through 0 at the top (neutral) to +100 (bullish, right, green).
- `|score| < 20` is the neutral zone, not worth your time. `20 to 50` is a bias zone where a setup may exist. `50 and above` is strong.
- Timeframes are averages of weekly point-in-time scores. COT is weekly, so DAILY means "this week's COT with today's price"; no daily COT is invented.

## Layout

```
src/engine.js      the scoring maths (unchanged from the Google Sheets version)
src/cot.js         CFTC download and storage
src/prices.js      price download, storage, safety checks
src/build.js       builds docs/data.json and the backtest
src/research.js    backtest explorer (runs in Node and in the browser)
scripts/update.js  what the Action runs
data/              stored COT history and prices (committed by the Action)
docs/              the website (index.html + generated data files)
test/              automated checks (run before every update)
```

## Run it on your own computer

Needs Node 20 or newer. Nothing to install.

```
npm test            automated checks
npm run update      download data and rebuild docs/
npm run build       rebuild from stored data only (no internet)
npm run serve       view at http://localhost:8080
```

## Things to know

- **Prices come from Yahoo Finance's public chart endpoint.** It is unofficial and sometimes refuses requests from GitHub's servers. If that happens the COT side still updates and the page says which pairs have stale prices (status line and PRICE NOTE). Nothing is made up. To change the source, edit `src/prices.js`.
- Gold, silver and oil use Yahoo's continuous futures contracts (`GC=F`, `SI=F`, `CL=F`, `BZ=F`). They can show small jumps when the contract rolls.
- A price update that disagrees with what is already stored (more than 1% for FX, 4% for commodities) is refused rather than blended in.
- Prices differ slightly from a Google Finance based history, so backtest figures will not match the old spreadsheet to the last decimal. COT-based scores do.
- This is positioning information, not trading advice or a forecast. The backtest is historical and includes no costs.
