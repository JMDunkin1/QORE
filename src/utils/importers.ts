import Papa from 'papaparse'
import type { SignalReturnRow } from '../backtesting/timing'
import type { MarketBar, WeatherPoint } from '../types'

function numberFrom(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function textFrom(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function nullableNumberFrom(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function booleanFrom(value: unknown) {
  return typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true'
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

export function parseSignalReturnsCsv(csv: string): SignalReturnRow[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  return parsed.data
    .filter((row) => row.issueDate && row.targetDate)
    .map((row) => ({
      issueDate: textFrom(row.issueDate),
      targetDate: textFrom(row.targetDate),
      leadDays: numberFrom(row.leadDays),
      windowId: textFrom(row.windowId),
      modelId: textFrom(row.modelId),
      symbol: textFrom(row.symbol),
      priorTradeDate: textFrom(row.priorTradeDate),
      entryTradeDate: textFrom(row.entryTradeDate),
      targetTradeDate: textFrom(row.targetTradeDate),
      priorClose: nullableNumberFrom(row.priorClose),
      entryClose: nullableNumberFrom(row.entryClose),
      targetClose: nullableNumberFrom(row.targetClose),
      returnPctPriorCloseToTarget: nullableNumberFrom(row.returnPctPriorCloseToTarget),
      returnPctEntryCloseToTarget: nullableNumberFrom(row.returnPctEntryCloseToTarget),
      qualifies: booleanFrom(row.qualifies),
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
