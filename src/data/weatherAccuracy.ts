import Papa from 'papaparse'
import aigfsScoresCsv from '../../data/qore/research/aigfs-openmeteo-single-runs-00z-daily-forecast-calendar-2026-01-07-2026-03-31-requested-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv?raw'
import ecmwfAifsScoresCsv from '../../data/qore/research/ecmwf-aifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-14-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv?raw'
import ecmwfIfsScoresCsv from '../../data/qore/research/ecmwf-ifs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-available-2024-03-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv?raw'
import gefsMeanScoresCsv from '../../data/qore/research/gefs-mean-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv?raw'
import gemGlobalScoresCsv from '../../data/qore/research/gem-global-open-meteo-previous-runs-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv?raw'
import gfsScoresCsv from '../../data/qore/research/gfs-00z-daily-forecast-calendar-2021-01-01-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv?raw'
import graphcastgfsScoresCsv from '../../data/qore/research/graphcastgfs-00z-daily-forecast-calendar-2024-04-26-2026-03-31-leads-1-2-3-7-8-9-10-hours-0-signal-scores.csv?raw'
import actualDailyAnomaliesCsv from '../../data/qore/weather/events/arctic-blast-actual-daily-2021-01-01-2026-03-31.csv?raw'
import { evaluateForecastAnomalyModel, type ForecastAnomalyPoint } from '../ml/evaluation'
import { realDataCatalog } from './realDataCatalog'

const scoreCsvByCalendarId = {
  aigfs: aigfsScoresCsv,
  'ecmwf-aifs': ecmwfAifsScoresCsv,
  'ecmwf-ifs': ecmwfIfsScoresCsv,
  'gefs-mean': gefsMeanScoresCsv,
  'gem-global': gemGlobalScoresCsv,
  gfs: gfsScoresCsv,
  graphcastgfs: graphcastgfsScoresCsv,
} as const

function numberFrom(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseActualAnomalies(csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  return new Map(
    parsed.data
      .map((row) => [row.date, numberFrom(row.weightedAnomalyF)] as const)
      .filter((row): row is readonly [string, number] => Boolean(row[0]) && row[1] !== null),
  )
}

function parseForecastAnomalies(
  sourceId: string,
  csv: string,
  actualByDate: Map<string, number>,
  issueDateStart: string,
  issueDateEnd: string,
): ForecastAnomalyPoint[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  return parsed.data
    .map((row) => {
      if (row.issueDate < issueDateStart || row.issueDate > issueDateEnd) return null
      const actualAnomalyF = actualByDate.get(row.targetDate)
      const forecastAnomalyF = numberFrom(row.weightedAnomalyF)
      if (!Number.isFinite(actualAnomalyF) || forecastAnomalyF === null) return null
      return {
        actualAnomalyF,
        forecastAnomalyF,
        sourceId,
      }
    })
    .filter((point): point is ForecastAnomalyPoint => point !== null)
}

const actualAnomalyByDate = parseActualAnomalies(actualDailyAnomaliesCsv)
const sharedForecastAnomalies = realDataCatalog.forecastCalendars.flatMap((calendar) => {
  const csv = scoreCsvByCalendarId[calendar.id as keyof typeof scoreCsvByCalendarId]
  return csv
    ? parseForecastAnomalies(calendar.id, csv, actualAnomalyByDate, calendar.issueDateStart, calendar.issueDateEnd)
    : []
})

export const sharedWeatherMetrics = evaluateForecastAnomalyModel(sharedForecastAnomalies)
