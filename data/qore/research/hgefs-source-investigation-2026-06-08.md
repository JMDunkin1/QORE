# HGEFS / GEFS Source Investigation

Generated: 2026-06-08T03:21Z

## Requested Calendar

- Window: 2021-01-01 through 2026-03-31
- Run: 00Z
- Leads: 1, 2, 3, 7, 8, 9, 10 days
- Valid hour sampled: 00 UTC
- Variable: 2 m temperature / closest 2 m temperature ensemble mean
- Basket: existing QORE eastern CONUS 18-location basket
- Calendar rule used for comparability: heating-season target dates only

## Official HGEFS

- Product docs tested: https://www.nco.ncep.noaa.gov/pmb/products/hgefs/
- NOAA service notice tested: https://www.weather.gov/media/notification/pdf_2025/scn25-89_AIGFS_AIGEFS_and_HGEFS.pdf
- Current retained data URL tested:
  - https://nomads.ncep.noaa.gov/pub/data/nccf/com/hgefs/prod/hgefs.20260607/00/ensstat/products/atmos/grib2/hgefs.t00z.sfc.avg.f024.grib2.idx
  - Result: HTTP 200; index includes `TMP:2 m above ground:24 hour fcst:ens mean`
- Historical requested-window URLs tested:
  - https://nomads.ncep.noaa.gov/pub/data/nccf/com/hgefs/prod/hgefs.20251217/00/ensstat/products/atmos/grib2/hgefs.t00z.sfc.avg.f024.grib2.idx
  - https://nomads.ncep.noaa.gov/pub/data/nccf/com/hgefs/para/hgefs.20251209/00/ensstat/products/atmos/grib2/hgefs.t00z.sfc.avg.f024.grib2.idx
  - https://nomads.ncep.noaa.gov/pub/data/nccf/com/hgefs/v1.0/hgefs.20251218/00/ensstat/products/atmos/grib2/hgefs.t00z.sfc.avg.f024.grib2.idx
  - Result: expired / no longer available from NOMADS
- Filter endpoint tested: https://nomads.ncep.noaa.gov/gribfilter.php?ds=hgefs
  - Result: not a valid grib-filter dataset

## Official GEFS Ensemble Mean Equivalent

- Product docs tested: https://www.nco.ncep.noaa.gov/pmb/products/gens/
- AWS registry tested: https://registry.opendata.aws/noaa-gefs/
- NOAA GEFS AWS index examples tested:
  - https://noaa-gefs-pds.s3.amazonaws.com/gefs.20210101/00/atmos/pgrb2sp25/geavg.t00z.pgrb2s.0p25.f024.idx
  - https://noaa-gefs-pds.s3.amazonaws.com/gefs.20210101/00/atmos/pgrb2sp25/geavg.t00z.pgrb2s.0p25.f240.idx
  - https://noaa-gefs-pds.s3.amazonaws.com/gefs.20260331/00/atmos/pgrb2sp25/geavg.t00z.pgrb2s.0p25.f024.idx
  - https://noaa-gefs-pds.s3.amazonaws.com/gefs.20260321/00/atmos/pgrb2sp25/geavg.t00z.pgrb2s.0p25.f240.idx
  - Result: HTTP 200; indexes include `TMP:2 m above ground:* hour fcst:ens mean`
- Builder: .local/qore/research/hgefs-build-gefs-ensemble-calendar.mjs
- Resumable command:
  - `QORE_HGEFS_START=2021-01-01 QORE_HGEFS_END=2026-03-31 QORE_HGEFS_LEAD_DAYS=1,2,3,7,8,9,10 QORE_HGEFS_CONCURRENCY=8 QORE_HGEFS_RESUME=1 QORE_HGEFS_ALLOW_PARTIAL=1 node .local/qore/research/hgefs-build-gefs-ensemble-calendar.mjs`

## Outputs Created

- .local/qore/weather/hgefs/hgefs-current-20260607-00z-f024-2m-temp-probe.json
- .local/qore/weather/hgefs/gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv
- .local/qore/research/hgefs-gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv
- .local/qore/research/hgefs-gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv
- .local/qore/weather/hgefs/gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json

## Partial Build Counts

- Expected full GEFS-equivalent score rows: 5,882
- Completed score rows: 274
- Completed location anomaly rows: 4,932
- Completed return rows: 548
- Source failures during partial build: 0

## Blockers

- HGEFS did not exist for most of the requested window and the retained NOMADS-only HGEFS data inside the window has expired.
- No HGEFS public AWS/NODD bucket was found; `noaa-hgefs-pds` does not exist.
- The official GEFS ensemble mean equivalent is available and scriptable, but the raw NOAA AWS backfill requires thousands of byte-range GRIB pulls and is a long-running job.
