import Papa from 'papaparse'
import type { MarketBar, WeatherPoint } from '../types'

function numberFrom(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function textFrom(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function parseWeatherCsv(csv: string): WeatherPoint[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  return parsed.data
    .filter((row) => row.date)
    .map((row) => ({
      date: textFrom(row.date),
      stationBlend: textFrom(row.stationBlend, 'Imported basket'),
      actualHdd: numberFrom(row.actualHdd),
      forecastHdd: numberFrom(row.forecastHdd),
      actualCdd: numberFrom(row.actualCdd),
      forecastCdd: numberFrom(row.forecastCdd),
      tempAnomalyF: numberFrom(row.tempAnomalyF),
      windMph: numberFrom(row.windMph),
      precipIn: numberFrom(row.precipIn),
      confidence: numberFrom(row.confidence, 75),
    }))
}

export function parseMarketCsv(csv: string): MarketBar[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  return parsed.data
    .filter((row) => row.date)
    .map((row) => ({
      date: textFrom(row.date),
      open: numberFrom(row.open),
      high: numberFrom(row.high),
      low: numberFrom(row.low),
      close: numberFrom(row.close),
      volume: numberFrom(row.volume),
      contract: textFrom(row.contract, 'NG'),
      storageBcf: numberFrom(row.storageBcf),
    }))
}
