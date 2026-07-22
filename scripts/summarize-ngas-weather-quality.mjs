#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import Papa from 'papaparse'
import { validateForecastCalendarTemperatures } from './lib/qore-weather-data-quality.mjs'

const repoDir = process.cwd()
const dataRoot = path.resolve(process.env.QORE_DATA_ROOT ?? path.join(repoDir, 'data', 'qore'))
const manifestPath = path.join(dataRoot, 'dataset-manifest.json')
const actualDailyPath = path.resolve(
  process.env.QORE_WEATHER_ACTUAL_DAILY
    ?? path.join(dataRoot, 'weather', 'events', 'arctic-blast-actual-daily-2021-01-01-2026-03-31.csv'),
)
const outputPath = path.resolve(
  process.env.QORE_WEATHER_QUALITY_OUTPUT
    ?? path.join(dataRoot, 'research', 'ngas-weather-quality-summary.json'),
)
const COLD_EVENT_THRESHOLD_F = -8

function parseCsv(contents) {
  const parsed = Papa.parse(contents, { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() })
  if (parsed.errors.length) throw new Error(parsed.errors[0].message)
  return parsed.data
}

function finiteNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const actualRows = parseCsv(await readFile(actualDailyPath, 'utf8'))
const actualByDate = new Map(
  actualRows
    .map((row) => [row.date, finiteNumber(row.weightedAnomalyF)])
    .filter(([date, value]) => date && value !== null),
)

const points = []
const temperatureQuality = []
for (const calendar of manifest.forecastCalendars ?? []) {
  const scorePath = path.join(dataRoot, calendar.files.signalScores)
  const locationsPath = path.join(dataRoot, calendar.files.locationAnomalies)
  const validated = validateForecastCalendarTemperatures({
    scoreRows: parseCsv(await readFile(scorePath, 'utf8')),
    locationRows: parseCsv(await readFile(locationsPath, 'utf8')),
    mode: 'quarantine',
    label: `${calendar.id} weather-quality calendar`,
    sourceId: calendar.id,
  })
  temperatureQuality.push({ sourceId: calendar.id, ...validated.diagnostics })
  for (const row of validated.scoreRows) {
    if (row.issueDate < calendar.issueDateRange.start || row.issueDate > calendar.issueDateRange.end) continue
    const actualAnomalyF = actualByDate.get(row.targetDate)
    const forecastAnomalyF = finiteNumber(row.weightedAnomalyF)
    if (actualAnomalyF === undefined || forecastAnomalyF === null) continue
    points.push({ sourceId: calendar.id, actualAnomalyF, forecastAnomalyF })
  }
}

if (!points.length) throw new Error('No forecast rows could be joined to natural-gas actual weather rows.')

const actual = points.map((point) => point.actualAnomalyF)
const forecast = points.map((point) => point.forecastAnomalyF)
const actualMean = mean(actual)
const totalVariance = actual.reduce((sum, value) => sum + (value - actualMean) ** 2, 0)
const residualVariance = actual.reduce((sum, value, index) => sum + (value - forecast[index]) ** 2, 0)
const coldEvents = points.filter((point) => point.actualAnomalyF <= COLD_EVENT_THRESHOLD_F)
const summary = {
  generatedAt: new Date().toISOString(),
  method: 'Physically plausible forecast anomaly groups joined to eastern-CONUS NASA POWER actual anomalies by target date; an invalid location quarantines its full source/issue/target/lead group',
  sourceCount: new Set(points.map((point) => point.sourceId)).size,
  rowCount: points.length,
  maeF: round(mean(points.map((point) => Math.abs(point.actualAnomalyF - point.forecastAnomalyF)))),
  rmseF: round(Math.sqrt(mean(points.map((point) => (point.actualAnomalyF - point.forecastAnomalyF) ** 2)))),
  biasF: round(mean(points.map((point) => point.forecastAnomalyF - point.actualAnomalyF))),
  r2: round(totalVariance ? 1 - residualVariance / totalVariance : 0, 3),
  directionalAccuracyPct: round(
    (points.filter((point) => Math.sign(point.actualAnomalyF) === Math.sign(point.forecastAnomalyF)).length / points.length) * 100,
    1,
  ),
  coldRecallPct: round(
    (
      coldEvents.filter((point) => point.forecastAnomalyF <= COLD_EVENT_THRESHOLD_F).length
      / Math.max(coldEvents.length, 1)
    ) * 100,
    1,
  ),
  coldEventThresholdF: COLD_EVENT_THRESHOLD_F,
  weatherTemperatureQuality: {
    policy: temperatureQuality[0]?.policy ?? null,
    quarantinedGroupCount: temperatureQuality.reduce(
      (sum, quality) => sum + quality.quarantinedGroupCount,
      0,
    ),
    quarantinedLocationRowCount: temperatureQuality.reduce(
      (sum, quality) => sum + quality.quarantinedLocationRowCount,
      0,
    ),
    quarantinedScoreRowCount: temperatureQuality.reduce(
      (sum, quality) => sum + quality.quarantinedScoreRowCount,
      0,
    ),
    calendars: temperatureQuality,
  },
}

await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(`Weather quality: ${summary.rowCount} joined rows across ${summary.sourceCount} sources; wrote ${path.relative(repoDir, outputPath)}.`)
