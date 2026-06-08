# QORE Shared Research Data

This directory is tracked on purpose. It contains the market, weather, forecast-calendar, and source-evidence artifacts used to test the arctic-blast / natural-gas thesis.

`data/qore` is the default `QORE_DATA_ROOT`. Use `QORE_DATA_ROOT=.local/qore` for private scratch runs that should not be shared through Git.
Collector defaults roll forward: `npm run collect:free-data` starts at `2021-01-01` and ends on the latest complete UTC day, and the NOAA calendar commands use the latest complete UTC day unless a fixed end date is supplied.

The main forecast calendars are stored as:

- `weather/<provider>/...-location-anomalies.csv`
- `research/...-signal-scores.csv`
- `research/...-signal-returns.csv`
- `weather/<provider>/...-manifest.json`

The score files are the best entry point for strategy testing. The location files preserve the 18-city eastern-CONUS basket that produced each score, and the return files join each forecast signal to `UNG` and `NG=F`.

Market-data label: `UNG` rows are ETF history. `NG=F` rows are Yahoo continuous front-month proxy history. These are useful for first-pass strategy research, but they are not futures-grade Henry Hub NG contract performance. See `market/futures/henry-hub-ng-readiness.md` for the missing contract, expiry, and roll dataset.

Timing contract for the return files:

- `issueDate` is the forecast run date and `targetDate` is the weather-valid date being scored.
- `priorClose` / `returnPctPriorCloseToTarget` are context only; do not use them as strategy PnL because the entry starts before the signal is known.
- Conservative close-to-close tests should use `returnPctEntryCloseToTarget` only after applying `src/backtesting/timing.ts`.
- A no-lookahead row must have `entryTradeDate > issueDate`, `targetTradeDate >= targetDate`, and `targetTradeDate > entryTradeDate`.
- Existing shared return files were generated before this contract was explicit, so rows with same-day entry or weekend/holiday target dates need filtering or regeneration before final scorecards.
