# Arctic Blast / UNG Theory

## Core Observation

Last winter, forecasts for below-normal 2m air temperatures across the central and eastern United States appeared to trigger sharp rises in the United States Natural Gas Fund (UNG). The suspected trade pattern is:

- Buy the rumor: UNG rises when the 7 to 10 day forecast window shows a broad, high-confidence arctic outbreak.
- Sell the news: UNG sells off before or during the 1 to 3 day forecast window, once the cold event is widely known, revised, or nearly realized.

## Research Goal

Backtest the selloff window. The specific question is whether the best exit or fade occurs at T-3, T-2, T-1, event day, or just after event arrival, where T is the forecast-valid start of the cold outbreak.

## Arctic Blast Finder

The first system should identify when cold air is coming, not trade yet. A candidate arctic-blast event should require:

- Broad coverage across the eastern two-thirds of CONUS, not one isolated city.
- A weighted regional 2m temperature anomaly below normal.
- Agreement across several forecast models.
- Persistence across at least two forecast cycles, if run-level data is available.
- Separate scores for the 7 to 10 day rumor window and the 1 to 3 day selloff window.

Initial basket regions: Upper Midwest, Great Lakes, Ohio Valley, Northeast, Mid-Atlantic, Southeast, Mid-South, and Texas/Oklahoma fringe demand areas.

## Weather Data

Future forecasts:

- Open-Meteo Forecast API with `hourly=temperature_2m`.

Backtest forecasts:

- Open-Meteo Single Runs API for full historical forecast horizons from a specific model initialization time. This is the cleanest source for true 7 to 10 day issued forecasts.
- Open-Meteo Previous Runs API for fixed lead-time checks from 1 to 7 days, useful for the 1 to 3 day selloff window.
- Open-Meteo Historical Forecast API for stitched historical forecast/model output, but not as the only source for reconstructing full 7 to 10 day issued forecasts.

Average temperatures:

- Use historical weather or reanalysis normals by location/day/hour, then compare each forecast temperature against that normal.
- Store anomalies in Fahrenheit for trading interpretation, even if raw API data can be pulled in Celsius.

Models to evaluate:

- ECMWF IFS 0.25 degree
- ECMWF AIFS 0.25 degree
- NCEP GFS Global 0.11/0.25 degree
- NCEP HGEFS 0.25 degree ensemble mean
- NCEP AIGFS 0.25 degree
- GEM Global

Implementation note from the 2026-06-06 API probe: Open-Meteo selectors confirmed live for `ecmwf_ifs025`, `ecmwf_aifs025`, `gfs_global`, `gfs025`, `gfs_graphcast025`, and `gem_global`. AIGFS and HGEFS are documented, but their exact live selector names still need confirmation before hard-coding.

## Market Data

Primary target:

- UNG daily OHLCV.

Recommended comparison targets:

- Henry Hub natural gas futures or front-month continuous NG.
- UNG adjusted close, because ETF roll effects can differ from raw gas futures.

The backtest must align forecast issue times with market trading times. A signal issued after the market close should enter on the next tradable session.

## Trading Algorithm To Test

Signal construction:

1. For every model run, compute forecast 2m temperature anomalies for each basket location.
2. Aggregate to a weighted eastern-CONUS anomaly.
3. Flag a rumor signal when the 7 to 10 day window is materially colder than normal and model consensus is high.
4. Track whether the signal strengthens, weakens, or disappears as it moves into the 1 to 3 day window.

Backtest variants:

- Long UNG at the first qualifying 7 to 10 day rumor signal.
- Exit at T-3, T-2, T-1, event-day open, event-day close, and T+1.
- Test short/fade entries in the 1 to 3 day window after a prior rumor signal.
- Compare against winter-only random windows and non-event cold forecasts.

Metrics:

- Return by window.
- Hit rate.
- Average winner/loser.
- Max drawdown.
- Sharpe or simple risk-adjusted return.
- Slippage and commission sensitivity.
- Event overlap handling, especially repeated model runs for the same outbreak.

## First Implementation Path

1. Build an Open-Meteo downloader that writes forecast-run rows to `.local/qore/weather/open-meteo/`.
2. Build normal-temperature rows by location and day-of-year.
3. Build the arctic-blast finder and event deduper.
4. Add a backtest sweep that reports UNG return from signal issue through each selloff-window candidate.
5. Only after the selloff window is proven, promote it into the dashboard strategy board.

## API References

- [Open-Meteo Forecast API](https://open-meteo.com/en/docs)
- [Open-Meteo ECMWF API](https://open-meteo.com/en/docs/ecmwf-api)
- [Open-Meteo GFS and HRRR API](https://open-meteo.com/en/docs/gfs-api)
- [Open-Meteo GEM API](https://open-meteo.com/en/docs/gem-api)
- [Open-Meteo Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api)
- [Open-Meteo Single Runs API](https://open-meteo.com/en/docs/single-runs-api)
- [Open-Meteo Previous Runs API](https://open-meteo.com/en/docs/previous-runs-api)
