# GFS GraphCast / GFS025 Variant Investigation

Generated: 2026-06-08

## Decision

- Add a distinct `gfs_graphcast025` / NOAA GraphCastGFS 0.25 calendar if we want an independent AI/ML weather signal. It is populated from 2024-02-05 through the requested 2026-03-31 end date where available, but not for 2021-01-01 through 2024-02-04.
- Do not add a distinct `gfs025` calendar beyond the NOAA GFS 0.25 calendar already built. Open-Meteo `gfs025` is the same GFS pressure-grid family and raw NOAA GFS 0.25 is already the better full-lead source for this repo.
- Open-Meteo Previous Runs can help for lead days 1, 2, 3, and 7. It returned all-null data for lead days 8, 9, and 10 for both `gfs025` and `gfs_graphcast025`, so it is not sufficient by itself for the requested rumor-window lead set.
- Official raw archives can supply the full requested lead set. GraphCastGFS raw GRIB2 has `TMP:2 m above ground` at f024, f048, f072, f168, f192, f216, and f240.

## Scope Tested

- Lead days: 1, 2, 3, 7, 8, 9, 10.
- Temperature variable: near-surface / 2 m temperature.
- Basket: QORE eastern CONUS basket, 18 locations.
- Target range: 2021-01-01 through 2026-03-31 where available.
- Existing NOAA GFS calendar observed:
  - `.local/qore/weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv`: 105,732 data rows.
  - `.local/qore/research/gfs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv`: 5,874 data rows.
  - Existing manifest reports 5,882 expected score rows and 8 missing rows.

## Output Files

- `.local/qore/research/gfs-graphcast-openmeteo-probes.json`: first Open-Meteo reachability probes.
- `.local/qore/research/gfs-graphcast-openmeteo-value-probes.json`: value-count probes; 25 probe entries.
- `.local/qore/weather/gfs-graphcast/raw-archive-probe-2025-03-01.json`: raw archive availability and decoded GRIB samples.

## Open-Meteo Findings

- `gfs_graphcast025` current forecast selector:
  - URL tried: `https://api.open-meteo.com/v1/gfs?latitude=41.8781&longitude=-87.6298&temperature_unit=fahrenheit&timezone=GMT&cell_selection=nearest&forecast_days=16&hourly=temperature_2m&model=gfs_graphcast025`
  - Data obtained: yes, 379/384 non-null hourly values.
- `gfs025` current forecast selector:
  - URL tried: `https://api.open-meteo.com/v1/gfs?latitude=41.8781&longitude=-87.6298&temperature_unit=fahrenheit&timezone=GMT&cell_selection=nearest&forecast_days=16&hourly=temperature_2m&model=gfs025`
  - Data obtained: yes, 379/384 non-null hourly values.
- `gfs_graphcast025` Historical Forecast:
  - URL tried: `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&temperature_unit=fahrenheit&timezone=GMT&cell_selection=nearest&start_date=2024-02-05&end_date=2024-02-06&hourly=temperature_2m&model=gfs_graphcast025`
  - Data obtained: yes, 48/48 non-null hourly values on retry.
- `gfs025` Historical Forecast:
  - URL tried: `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&temperature_unit=fahrenheit&timezone=GMT&cell_selection=nearest&start_date=2021-01-01&end_date=2021-01-02&hourly=temperature_2m&model=gfs025`
  - Data obtained: yes, 48/48 non-null hourly values.
- `gfs_graphcast025` Previous Runs:
  - URL tried: `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&temperature_unit=fahrenheit&timezone=GMT&cell_selection=nearest&start_date=2025-02-10&end_date=2025-02-12&hourly=temperature_2m_previous_day1,temperature_2m_previous_day2,temperature_2m_previous_day3,temperature_2m_previous_day7&model=gfs_graphcast025`
  - Data obtained: yes, each requested variable returned 72/72 non-null values.
  - URL tried for days 8-10: `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&temperature_unit=fahrenheit&timezone=GMT&cell_selection=nearest&start_date=2025-02-15&end_date=2025-02-17&hourly=temperature_2m_previous_day8,temperature_2m_previous_day9,temperature_2m_previous_day10&model=gfs_graphcast025`
  - Data obtained: no usable values; all three variables returned 0/72 non-null.
- `gfs025` Previous Runs:
  - URL tried: `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&temperature_unit=fahrenheit&timezone=GMT&cell_selection=nearest&start_date=2025-02-10&end_date=2025-02-12&hourly=temperature_2m_previous_day1,temperature_2m_previous_day2,temperature_2m_previous_day3,temperature_2m_previous_day7&model=gfs025`
  - Data obtained: yes, each requested variable returned 72/72 non-null values.
  - URL tried for days 8-10: `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&temperature_unit=fahrenheit&timezone=GMT&cell_selection=nearest&start_date=2025-02-15&end_date=2025-02-17&hourly=temperature_2m_previous_day8,temperature_2m_previous_day9,temperature_2m_previous_day10&model=gfs025`
  - Data obtained: no usable values; all three variables returned 0/72 non-null.
- Open-Meteo selector pitfall:
  - `gfs025` with `models=gfs025` returned HTTP 200 but 0 populated values.
  - `gfs025` with `model=gfs025` returned populated values.
  - `gfs_graphcast025` worked with `model=gfs_graphcast025`; some `models=` historical calls also populated, but use singular `model=` for consistency.

## Official Raw Archive Findings

- GraphCastGFS S3 listing tried:
  - `https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/?list-type=2&prefix=graphcastgfs.20250301/&max-keys=20`
  - `https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/?list-type=2&prefix=graphcastgfs.20260331/&max-keys=10`
  - Data obtained: yes.
- GraphCastGFS 2 m temperature index URLs tried:
  - `https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/graphcastgfs.20250301/00/forecasts_13_levels/graphcastgfs.t00z.pgrb2.0p25.f024.idx`
  - `https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/graphcastgfs.20250301/00/forecasts_13_levels/graphcastgfs.t00z.pgrb2.0p25.f240.idx`
  - Data obtained: yes. `TMP:2 m above ground` was line 3 in both indexes.
- NOAA GFS 0.25 comparison URLs tried:
  - `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20250301/00/atmos/gfs.t00z.pgrb2.0p25.f024.idx`
  - `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20250301/00/atmos/gfs.t00z.pgrb2.0p25.f240.idx`
  - Data obtained: yes. `TMP:2 m above ground` was present in both indexes.
- Raw availability probe:
  - 35 HEAD checks across GraphCastGFS and NOAA GFS selected dates/leads.
  - 21 succeeded, 14 failed.
  - Failures were all GraphCastGFS `.idx` URLs on the first archive date, 2024-02-05, for 00z and 12z sampled leads. Later GraphCastGFS dates worked.
- Decoded raw sample, 2025-03-01 00z, 18-location basket:
  - GraphCastGFS f024 weighted mean: 40.857 F; Chicago: 25.423 F.
  - NOAA GFS f024 weighted mean: 40.353 F; Chicago: 28.812 F.
  - GraphCastGFS f240 weighted mean: 52.250 F; Chicago: 40.556 F.
  - NOAA GFS f240 weighted mean: 45.807 F; Chicago: 31.585 F.
  - This confirms GraphCastGFS is a distinct forecast signal, especially at day 10.

## Expected GraphCast Calendar Size

If we mirror the existing NOAA GFS calendar rules from 2024-02-05 through 2026-03-31, target date within range, heating-season target dates only:

- Expected score rows: 2,466.
- Expected location rows: 44,388.
- Expected return rows: 4,932.
- By lead: day 1 = 357, day 2 = 356, day 3 = 355, day 7 = 351, day 8 = 350, day 9 = 349, day 10 = 348.

## Blockers

- No GraphCastGFS data for the full requested 2021-01-01 through 2024-02-04 window.
- Open-Meteo Previous Runs does not populate day 8-10 values for either tested selector, so it cannot alone produce the full requested lead set.
- Open-Meteo Historical Forecast is a stitched continuous time series, not a specific issue-run calendar. It is useful for model data access checks, but not enough for issue-date/target-date backtesting.
- Open-Meteo Single Runs worked for `gfs_graphcast025` in 2025, but starts too late to cover the whole GraphCast archive.
- First-day GraphCastGFS raw `.idx` files were missing in the sampled S3 paths, even though later raw archive dates and Open-Meteo data were populated.
