# AIGFS Historical Data Status

Last checked: 2026-06-08

## Theory Requirement

`theory.md` needs source-backed 2 m temperature forecasts for the eastern-CONUS
arctic-blast basket, with selloff leads 1, 2, and 3 days and rumor leads 7, 8,
9, and 10 days.

## Source-Backed Coverage

The usable checked-in AIGFS forecast-as-of dataset is the Open-Meteo Single Runs
calendar using model selector `ncep_aigfs025`, 00Z initialization, and
`temperature_2m`.

- Issue-date coverage with score rows: 2026-01-07 through 2026-03-30.
- Target-date coverage: 2026-01-08 through 2026-03-31.
- Lead days: 1, 2, 3, 7, 8, 9, and 10.
- Basket: 18 QORE eastern-CONUS locations.
- Rows: 9,810 location-anomaly rows, 545 signal-score rows, and 1,090
  market-return rows.
- Missing rows: 2026-03-27 00Z is unavailable from Open-Meteo Single Runs,
  leaving lead days 1, 2, and 3 missing for that issue date.

Open-Meteo Single Runs is the right Open-Meteo endpoint for this backtest lane
because it preserves individual model-run initialization time. Open-Meteo's
Historical Forecast API is useful context, but it stitches initial hours into a
continuous time series and does not preserve the exact 7-10 day forecast-as-of
structure required here.

## Source Evidence

- NWS Service Change Notice 25-89 says AIGFS became operational on 2025-12-17
  at 12 UTC, after an evaluation period starting 2025-12-09. It also documents
  0.25 degree GRIB2 output, 6-hourly forecast hours 000 through 384, and TMP at
  2 m above ground.
- Open-Meteo Historical Forecast documentation lists AIGFS global 0.25 degree
  data as available since 2026-01-07.
- Open-Meteo Single Runs live probes confirmed `ncep_aigfs025` is retrievable
  for 2026-01-07 00Z and unavailable for 2026-01-06 00Z, 2025-12-17 12Z, and
  2026-03-27 00Z.
- NOAA's AWS GraphCast/EAGLE registry identifies EAGLE SOLO / GraphCastGFS as
  predecessor context, not as AIGFS. GraphCastGFS has separate source-backed
  coverage, but it should not be relabeled as AIGFS.
- The NOAA AWS bucket has no `aigfs.20260331/` prefix; the corresponding
  `graphcastgfs.20260331/` prefix exists, again proving predecessor coverage
  rather than AIGFS coverage.

## Test Inclusion

AIGFS should stay out of the main historical strategy scorecard. It belongs only
in recent-regime checks or sanity checks until a longer source-backed AIGFS
forecast-as-of archive is available. GraphCastGFS can be tested as a separate
predecessor/control model, but it should not be used to extend AIGFS history.

## Remaining Blocker

The blocker is not local parsing. It is source-backed archive depth: no public,
usable AIGFS forecast-as-of history before 2026-01-07 was found, and the NCEP
operational/evaluation NOMADS paths do not expose enough requested-range history
for this backtest from the current public endpoints.
