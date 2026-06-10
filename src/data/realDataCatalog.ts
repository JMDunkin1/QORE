export type ForecastCalendarSummary = {
  id: string
  label: string
  issueDateStart: string
  issueDateEnd: string
  scoreRows: number
  locationRows: number
  returnRows: number
  locationAnomaliesPath: string
  signalScoresPath: string
  signalReturnsPath: string
  manifestPath: string
}

export type SupportDatasetSummary = {
  label: string
  path: string
  detail: string
}

export const realDataCatalog = {
  generatedAt: '2026-06-10T16:19:51.579Z',
  defaultDataRoot: 'data/qore',
  fileCount: 173,
  totalBytes: 103030868,
  forecastCalendars: [
    {
      id: 'gfs',
      label: 'GFS',
      issueDateStart: '2021-01-01',
      issueDateEnd: '2026-03-30',
      scoreRows: 5874,
      locationRows: 105732,
      returnRows: 11748,
      locationAnomaliesPath:
        'weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv',
      signalScoresPath:
        'research/gfs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv',
      signalReturnsPath:
        'research/gfs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv',
      manifestPath:
        'weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json',
    },
    {
      id: 'gefs-mean',
      label: 'GEFS mean',
      issueDateStart: '2021-01-01',
      issueDateEnd: '2026-03-30',
      scoreRows: 5882,
      locationRows: 105876,
      returnRows: 11764,
      locationAnomaliesPath:
        'weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv',
      signalScoresPath:
        'research/gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv',
      signalReturnsPath:
        'research/gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv',
      manifestPath:
        'weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json',
    },
    {
      id: 'graphcastgfs',
      label: 'GraphCastGFS',
      issueDateStart: '2024-10-22',
      issueDateEnd: '2026-03-30',
      scoreRows: 2114,
      locationRows: 38052,
      returnRows: 4228,
      locationAnomaliesPath:
        'weather/gfs-graphcast/graphcastgfs-00z-daily-forecast-calendar-2024-04-26-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv',
      signalScoresPath:
        'research/graphcastgfs-00z-daily-forecast-calendar-2024-04-26-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv',
      signalReturnsPath:
        'research/graphcastgfs-00z-daily-forecast-calendar-2024-04-26-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv',
      manifestPath:
        'weather/gfs-graphcast/graphcastgfs-00z-daily-forecast-calendar-2024-04-26-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json',
    },
    {
      id: 'ecmwf-ifs',
      label: 'ECMWF IFS',
      issueDateStart: '2024-03-01',
      issueDateEnd: '2026-03-30',
      scoreRows: 2291,
      locationRows: 41238,
      returnRows: 4582,
      locationAnomaliesPath:
        'weather/ecmwf-ifs/ecmwf-ifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv',
      signalScoresPath:
        'research/ecmwf-ifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv',
      signalReturnsPath:
        'research/ecmwf-ifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv',
      manifestPath:
        'weather/ecmwf-ifs/ecmwf-ifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json',
    },
    {
      id: 'ecmwf-aifs',
      label: 'ECMWF AIFS',
      issueDateStart: '2024-03-14',
      issueDateEnd: '2024-11-07',
      scoreRows: 171,
      locationRows: 3078,
      returnRows: 342,
      locationAnomaliesPath:
        'weather/ecmwf-aifs/ecmwf-aifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-14-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv',
      signalScoresPath:
        'research/ecmwf-aifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-14-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv',
      signalReturnsPath:
        'research/ecmwf-aifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-14-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv',
      manifestPath:
        'weather/ecmwf-aifs/ecmwf-aifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-14-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json',
    },
    {
      id: 'aigfs',
      label: 'AIGFS',
      issueDateStart: '2026-01-07',
      issueDateEnd: '2026-03-30',
      scoreRows: 545,
      locationRows: 9810,
      returnRows: 1090,
      locationAnomaliesPath:
        'weather/aigfs/aigfs-openmeteo-single-runs-00z-daily-forecast-calendar-2026-01-07-2026-03-31-requested-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv',
      signalScoresPath:
        'research/aigfs-openmeteo-single-runs-00z-daily-forecast-calendar-2026-01-07-2026-03-31-requested-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv',
      signalReturnsPath:
        'research/aigfs-openmeteo-single-runs-00z-daily-forecast-calendar-2026-01-07-2026-03-31-requested-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv',
      manifestPath:
        'weather/aigfs/aigfs-openmeteo-single-runs-00z-daily-forecast-calendar-2026-01-07-2026-03-31-requested-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json',
    },
    {
      id: 'gem-global',
      label: 'GEM Global',
      issueDateStart: '2024-01-19',
      issueDateEnd: '2026-03-30',
      scoreRows: 1487,
      locationRows: 26766,
      returnRows: 2974,
      locationAnomaliesPath:
        'weather/gem-global/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-location-anomalies.csv',
      signalScoresPath:
        'research/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv',
      signalReturnsPath:
        'research/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-returns.csv',
      manifestPath:
        'weather/gem-global/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-manifest.json',
    },
  ] satisfies ForecastCalendarSummary[],
  supportData: [
    {
      label: 'Yahoo market history',
      path: 'market/yahoo',
      detail: 'UNG, NG=F, broad US equity ETF proxies, and the derived US index basket benchmark.',
    },
    {
      label: 'EIA storage',
      path: 'fundamentals/eia',
      detail: 'Weekly Lower 48 working gas storage history.',
    },
    {
      label: 'NASA POWER actuals',
      path: 'weather/nasa-power',
      detail: 'Temperature actuals, normals, and anomaly files for the eastern-CONUS basket.',
    },
    {
      label: 'Arctic blast events',
      path: 'weather/events',
      detail: 'Actual event windows and derived market joins for the thesis window.',
    },
  ] satisfies SupportDatasetSummary[],
}

export const totalSignalScores = realDataCatalog.forecastCalendars.reduce((sum, calendar) => sum + calendar.scoreRows, 0)
export const totalSignalReturns = realDataCatalog.forecastCalendars.reduce((sum, calendar) => sum + calendar.returnRows, 0)
export const totalLocationRows = realDataCatalog.forecastCalendars.reduce((sum, calendar) => sum + calendar.locationRows, 0)
