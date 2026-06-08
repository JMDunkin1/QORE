# GEM Global Forecast Calendar Source Tests

Generated: 2026-06-08

## Built output

- Source used: Open-Meteo Previous Runs API, `models=gem_global`, `temperature_2m_previous_dayN`
- Calendar type: lead-specific target-day calendar, inverted to `issueDate = targetDate - leadDays`
- Range requested: 2021-01-01..2026-03-31
- Range fetched from source: 2024-01-01..2026-03-31
- Lead days requested: 1, 2, 3, 7, 8, 9, 10
- Lead days obtained: 1, 2, 3, 7
- Lead days blocked: 8, 9, 10 returned null values in spot checks and in the build
- Filter: same heating-season target-date convention as the local NOAA GFS calendar
- Score rows: 1487
- Location anomaly rows: 26766
- Return rows: 2974

## Output paths

- `.local/qore/weather/gem-global/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv`
- `.local/qore/weather/gem-global/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json`
- `.local/qore/research/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv`
- `.local/qore/research/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv`
- `.local/qore/research/gem-global-build-previous-runs-calendar.mjs`

## Commands and API probes

```sh
curl -L --connect-timeout 10 --max-time 45 -sS \
  'https://previous-runs-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&hourly=temperature_2m_previous_day1,temperature_2m_previous_day7&temperature_unit=fahrenheit&timezone=GMT&models=gem_global&start_date=2025-09-01&end_date=2025-09-02&cell_selection=nearest'
```

Result: HTTP 200 with numeric GEM Global values for day 1 and day 7.

```sh
curl -L --connect-timeout 10 --max-time 45 -sS \
  'https://previous-runs-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&hourly=temperature_2m_previous_day8,temperature_2m_previous_day9,temperature_2m_previous_day10&temperature_unit=fahrenheit&timezone=GMT&models=gem_global&start_date=2025-01-15&end_date=2025-01-15&cell_selection=nearest'
```

Result: HTTP 200, but all requested day 8, day 9, and day 10 values were null.

```sh
curl -L --connect-timeout 10 --max-time 45 -sS \
  'https://single-runs-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&hourly=temperature_2m&temperature_unit=fahrenheit&timezone=GMT&models=gem_global&run=2026-01-15T00:00&forecast_hours=241&cell_selection=nearest'
```

Result: HTTP 400, `The requested model run is not available. Model: cmc_gem_gdps_15km_upper_level, run: 2026-01-15T00:00Z`.

```sh
curl -L --connect-timeout 10 --max-time 45 -sS \
  'https://single-runs-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&hourly=temperature_2m&temperature_unit=fahrenheit&timezone=GMT&models=gfs_global&run=2026-01-15T00:00&forecast_hours=241&cell_selection=nearest'
```

Result: HTTP 200 with values, confirming the Single Runs endpoint itself was reachable.

```sh
curl -L --connect-timeout 10 --max-time 45 -sS \
  'https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=41.8781&longitude=-87.6298&hourly=temperature_2m&temperature_unit=fahrenheit&timezone=GMT&models=gem_global&start_date=2025-09-01&end_date=2025-09-02&cell_selection=nearest'
```

Result: HTTP 200 with values, but this endpoint is a stitched historical forecast time series, not an issue-date/lead-day calendar.

```sh
curl -L --connect-timeout 10 --max-time 30 -sS -I \
  'https://dd.weather.gc.ca/20260607/WXO-DD/model_gdps/15km/00/024/20260607T00Z_MSC_GDPS_AirTemp_AGL-2m_LatLon0.15_PT024H.grib2'
```

Result: HTTP 200; content length 1018108. Confirms current official ECCC GDPS 2m air temperature GRIB2 path.

```sh
curl -L --connect-timeout 10 --max-time 30 -sS \
  'https://dd.weather.gc.ca/20260607/WXO-DD/model_gdps/15km/00/024/'
```

Result: HTTP 200 directory listing containing `20260607T00Z_MSC_GDPS_AirTemp_AGL-2m_LatLon0.15_PT024H.grib2`.

```sh
curl -L --connect-timeout 10 --max-time 30 -sS \
  'https://dd.meteo.gc.ca/today/model_gem_global/15km/grib2/lat_lon/00/024/'
```

Result: HTTP 404. The old/search-result `model_gem_global/.../grib2/lat_lon` path was not usable.

## Blockers

- Open-Meteo Single Runs did not provide GEM Global runs for tested dates, even though the same endpoint returned GFS runs.
- Open-Meteo Previous Runs provided GEM Global day 1, 2, 3, and 7, but day 8, 9, and 10 were null.
- ECCC GDPS Datamart is anonymous and official, but public retention is currently 30 days, so it cannot backfill 2021-01-01..2026-03-31.
- Open-Meteo rate-limited an unthrottled first pass. The successful build used monthly requests, a 3.5 second delay, and a 65 second 429 backoff.
