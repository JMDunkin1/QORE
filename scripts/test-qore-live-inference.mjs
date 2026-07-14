#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createSignal, enrichForecastRows, inferAllYearTarget, selectedContracts } from './lib/qore-live-all-year-inference.mjs'

const root = process.cwd()
const dataRoot = path.join(root, 'data', 'qore')

function parseLine(line) {
  const values = []; let value = ''; let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { values.push(value); value = '' }
    else value += char
  }
  values.push(value); return values
}
async function csv(filePath) {
  const lines = (await readFile(filePath, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
  const headers = parseLine(lines[0])
  return lines.slice(1).map((line) => { const values = parseLine(line); return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) })
}
function group(rows) {
  const result = new Map()
  for (const row of rows) result.set(row.issueDate, [...(result.get(row.issueDate) ?? []), row])
  return result
}
function close(actual, expected, tolerance = 0.002) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${actual} did not match ${expected}`)
}

async function summerParity() {
  const definitions = [
    ['gfs', 'weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv', 'research/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv'],
    ['gefs-mean', 'weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv', 'research/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv'],
  ]
  const scores = []; const locations = []
  for (const [sourceId, locationFile, scoreFile] of definitions) {
    scores.push(...(await csv(path.join(dataRoot, scoreFile))).map((row) => ({ ...row, sourceId })))
    locations.push(...(await csv(path.join(dataRoot, locationFile))).map((row) => ({ ...row, sourceId })))
  }
  const forecasts = enrichForecastRows(scores, locations, 'summer')
  const signals = new Map([...group(forecasts).entries()].map(([date, rows]) => [date, createSignal(rows, selectedContracts.summer, 'summer')]))
  const selected = await csv(path.join(dataRoot, 'research/strategy-agent-runs/ngas-summer-alpha/selected-trades.csv'))
  const expected = [...new Map(selected.filter((row) => row.windowId === 'weather-follow').map((row) => [row.issueDate, row])).values()]
  assert.ok(expected.length > 30)
  for (const row of expected) {
    const signal = signals.get(row.issueDate)
    assert.ok(signal, `Missing summer signal for ${row.issueDate}`)
    assert.equal(signal.thesisKind, row.thesisKind)
    close(signal.confidence, row.confidence)
    close(signal.weightedAnomalyF, row.weightedAnomalyF)
  }
  return { count: expected.length, forecasts, selected }
}

async function winterParity() {
  const manifest = JSON.parse(await readFile(path.join(dataRoot, 'dataset-manifest.json'), 'utf8'))
  const allowed = new Set(selectedContracts.winterFollow.sourceIds)
  const scores = []; const locations = []
  for (const calendar of manifest.forecastCalendars.filter((item) => allowed.has(item.id))) {
    scores.push(...(await csv(path.join(dataRoot, calendar.files.signalScores))).map((row) => ({ ...row, sourceId: calendar.id })))
    locations.push(...(await csv(path.join(dataRoot, calendar.files.locationAnomalies))).map((row) => ({ ...row, sourceId: calendar.id })))
  }
  const forecasts = enrichForecastRows(scores, locations, 'winter')
  const eligible = forecasts.filter((row) => row.windowId === 'rumor' && row.leadDays >= 7 && row.leadDays <= 10 && [11, 12, 1, 2, 3].includes(Number(row.issueDate.slice(5, 7))))
  const signals = new Map([...group(eligible).entries()].map(([date, rows]) => [date, createSignal(rows, selectedContracts.winterFollow, 'winter')]))
  const fadeSignals = new Map([...group(eligible).entries()].map(([date, rows]) => [date, createSignal(rows, selectedContracts.winterFade, 'winter')]))
  const selected = await csv(path.join(dataRoot, 'research/strategy-agent-runs/ngas-winter-alpha/frozen-inputs/dual-weather-selected-trades.csv'))
  const expected = [...new Map(selected.filter((row) => row.windowId === 'weather-follow').map((row) => [row.issueDate, row])).values()]
  assert.ok(expected.length > 30)
  for (const row of expected) {
    const signal = signals.get(row.issueDate)
    assert.ok(signal, `Missing winter signal for ${row.issueDate}`)
    assert.equal(signal.thesisKind, row.thesisKind)
    close(signal.confidence, row.confidence, 0.004)
    close(signal.weightedAnomalyF, row.weightedAnomalyF)
  }
  assert.ok(fadeSignals.get('2021-01-07'), 'Missing known winter fade-parent signal for 2021-01-07')
  const finalRows = await csv(path.join(dataRoot, 'research/strategy-agent-runs/ngas-winter-alpha/selected-trades.csv'))
  return { count: expected.length, forecasts, selected: finalRows }
}

async function positionParity(result, marketFile, label) {
  const market = (await csv(path.join(dataRoot, 'market/yahoo', marketFile))).map((row) => ({ date: row.date, gasClose: Number(row.close) })).filter((row) => row.gasClose > 0)
  const storage = await csv(path.join(dataRoot, 'fundamentals/eia/working-gas-storage-lower48-weekly.csv'))
  const active = result.selected.filter((row) => row.windowId !== 'index-fallback' && Number(row.ungPosition) !== 0)
  const sample = [...active.slice(0, 8), ...active.slice(-8)]
  assert.ok(sample.length >= 12)
  for (const row of sample) {
    const inferred = inferAllYearTarget({ forecastRows: result.forecasts, marketDays: market, storageRows: storage, targetDate: row.entryTradeDate })
    assert.ok(Math.abs(Number(inferred.gasPosition) - Number(row.ungPosition)) <= 0.001, `${label} position mismatch on ${row.entryTradeDate}: ${inferred.gasPosition} != ${row.ungPosition} (${inferred.thesisKind} / ${row.thesisKind}) ${JSON.stringify(inferred.diagnostics)}`)
    assert.equal(inferred.thesisKind, row.thesisKind, `${label} thesis mismatch on ${row.entryTradeDate}`)
  }
  return sample.length
}

const summer = await summerParity()
const winter = await winterParity()
const summerPositions = await positionParity(summer, 'NG-F-qore-market.csv', 'summer')
const winterPositions = await positionParity(winter, 'UNG-qore-market.csv', 'winter')
console.log(`live-inference parity passed summerSignals=${summer.count} winterSignals=${winter.count} summerPositions=${summerPositions} winterPositions=${winterPositions}`)
