#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { enrichForecastRows } from './lib/qore-live-all-year-inference.mjs'
import {
  FORECAST_TEMPERATURE_PLAUSIBILITY,
  validateForecastCalendarTemperatures,
} from './lib/qore-weather-data-quality.mjs'

function score(sourceId, issueDate, targetDate, weightedAnomalyF) {
  return {
    sourceId,
    issueDate,
    targetDate,
    leadDays: 1,
    windowId: 'selloff',
    modelId: `${sourceId}-model`,
    weightedAnomalyF,
    coveragePct: 1,
    extremeCount: 2,
    sampledWeight: 1,
    locationCount: 2,
  }
}

function location(sourceId, issueDate, targetDate, locationId, forecastMeanF, normalMeanF = 30) {
  return {
    sourceId,
    issueDate,
    targetDate,
    leadDays: 1,
    windowId: 'selloff',
    modelId: `${sourceId}-model`,
    locationId,
    weight: 0.5,
    forecastMeanF,
    normalMeanF,
    forecastAnomalyF: forecastMeanF - normalMeanF,
  }
}

const issueDate = '2026-02-12'
const targetDate = '2026-02-13'
const scores = [
  score('gefs-mean', issueDate, targetDate, -491.868),
  score('gfs', issueDate, targetDate, 7.1),
]
const locations = [
  location('gefs-mean', issueDate, targetDate, 'chicago', -459.67),
  location('gefs-mean', issueDate, targetDate, 'boston', 22),
  location('gfs', issueDate, targetDate, 'chicago', 36),
  location('gfs', issueDate, targetDate, 'boston', 38),
]

assert.equal(FORECAST_TEMPERATURE_PLAUSIBILITY.minimumF, -150)
assert.throws(
  () => validateForecastCalendarTemperatures({ scoreRows: scores, locationRows: locations }),
  (error) => {
    assert.equal(error.name, 'ForecastTemperatureQualityError')
    assert.equal(error.diagnostics.quarantinedGroupCount, 1)
    assert.equal(error.diagnostics.quarantinedLocationRowCount, 2)
    assert.equal(error.diagnostics.quarantinedScoreRowCount, 1)
    assert.deepEqual(error.diagnostics.quarantinedGroups[0].sampleLocationIds, ['chicago'])
    assert.deepEqual(error.diagnostics.quarantinedGroups[0].reasons, ['forecastMeanF-outside-physical-range'])
    return true
  },
)

const quarantined = validateForecastCalendarTemperatures({
  scoreRows: scores,
  locationRows: locations,
  mode: 'quarantine',
  label: 'Synthetic historical calendar',
})
assert.deepEqual(quarantined.scoreRows.map((row) => row.sourceId), ['gfs'])
assert.equal(quarantined.locationRows.length, 2)
assert.ok(quarantined.locationRows.every((row) => row.sourceId === 'gfs'))
assert.equal(quarantined.diagnostics.quarantinedGroupCount, 1)

assert.throws(
  () => enrichForecastRows(scores, locations, 'winter'),
  (error) => error.name === 'ForecastTemperatureQualityError',
)
const historicalRows = enrichForecastRows(scores, locations, 'winter', {
  temperatureQualityMode: 'quarantine',
  temperatureQualityLabel: 'Synthetic historical inference replay',
})
assert.equal(historicalRows.length, 1)
assert.equal(historicalRows[0].sourceId, 'gfs')

console.log('ok - live inference rejects and historical replay atomically quarantines physically impossible forecast batches')

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

const scratch = await mkdtemp(path.join(tmpdir(), 'qore-weather-quality-'))
try {
  const scorePath = path.join(scratch, 'research', 'scores.csv')
  const locationPath = path.join(scratch, 'weather', 'test', 'locations.csv')
  const actualPath = path.join(scratch, 'actual.csv')
  const outputPath = path.join(scratch, 'quality.json')
  await mkdir(path.dirname(scorePath), { recursive: true })
  await mkdir(path.dirname(locationPath), { recursive: true })
  await writeFile(path.join(scratch, 'dataset-manifest.json'), `${JSON.stringify({
    forecastCalendars: [{
      id: 'gfs',
      issueDateRange: { start: issueDate, end: '2026-02-13' },
      files: {
        signalScores: 'research/scores.csv',
        locationAnomalies: 'weather/test/locations.csv',
      },
    }],
  })}\n`)
  await writeFile(scorePath, [
    'issueDate,targetDate,leadDays,windowId,modelId,weightedAnomalyF',
    `${issueDate},${targetDate},1,selloff,gfs-model,-491.868`,
    '2026-02-13,2026-02-14,1,selloff,gfs-model,4',
    '',
  ].join('\n'))
  await writeFile(locationPath, [
    'issueDate,targetDate,leadDays,windowId,modelId,locationId,weight,forecastMeanF,normalMeanF,forecastAnomalyF',
    `${issueDate},${targetDate},1,selloff,gfs-model,chicago,0.5,-459.67,30,-489.67`,
    `${issueDate},${targetDate},1,selloff,gfs-model,boston,0.5,22,30,-8`,
    '2026-02-13,2026-02-14,1,selloff,gfs-model,chicago,0.5,34,30,4',
    '2026-02-13,2026-02-14,1,selloff,gfs-model,boston,0.5,34,30,4',
    '',
  ].join('\n'))
  await writeFile(actualPath, 'date,weightedAnomalyF\n2026-02-13,5\n2026-02-14,5\n')

  const result = await runNode(['scripts/summarize-ngas-weather-quality.mjs'], {
    QORE_DATA_ROOT: scratch,
    QORE_WEATHER_ACTUAL_DAILY: actualPath,
    QORE_WEATHER_QUALITY_OUTPUT: outputPath,
  })
  assert.equal(result.code, 0, result.stderr)
  const summary = JSON.parse(await readFile(outputPath, 'utf8'))
  assert.equal(summary.rowCount, 1)
  assert.equal(summary.rmseF, 1)
  assert.equal(summary.weatherTemperatureQuality.quarantinedGroupCount, 1)
  assert.equal(summary.weatherTemperatureQuality.quarantinedLocationRowCount, 2)
  assert.equal(summary.weatherTemperatureQuality.quarantinedScoreRowCount, 1)
  console.log('ok - weather-quality RMSE excludes a complete sentinel-contaminated forecast group and records diagnostics')

  const builderRoot = path.join(scratch, 'builder-output')
  const builderBase = 'resume-sentinel'
  const builderLocationPath = path.join(
    builderRoot,
    'weather',
    'noaa-gfs',
    `${builderBase}-location-anomalies.csv`,
  )
  const builderScorePath = path.join(builderRoot, 'research', `${builderBase}-signal-scores.csv`)
  const builderReturnPath = path.join(builderRoot, 'research', `${builderBase}-signal-returns.csv`)
  await mkdir(path.dirname(builderLocationPath), { recursive: true })
  await mkdir(path.dirname(builderScorePath), { recursive: true })
  const builderLocationHeader = 'issueDate,targetDate,leadDays,windowId,modelId,locationId,region,weight,forecastMeanF,normalMeanF,forecastAnomalyF,sampledValidHoursUtc,nearestGridLatitude,nearestGridLongitude,source'
  const builderLocationRows = Array.from({ length: 18 }, (_, index) => {
    const forecast = index === 4 ? -459.67 : 24
    return `2026-01-01,2026-01-02,1,selloff,gfs-model,location-${index},region,0.05,${forecast},30,${forecast - 30},0,40,-80,test`
  })
  await writeFile(builderLocationPath, `${builderLocationHeader}\n${builderLocationRows.join('\n')}\n`)
  await writeFile(builderScorePath, [
    'issueDate,targetDate,leadDays,windowId,modelId,weightedAnomalyF,coveragePct,extremeCount,sampledWeight,locationCount,sampledValidHoursUtc,qualifies,source',
    '2026-01-01,2026-01-02,1,selloff,gfs-model,-20,1,18,0.9,18,0,true,test',
    '',
  ].join('\n'))
  await writeFile(builderReturnPath, [
    'issueDate,targetDate,leadDays,windowId,modelId,symbol,priorTradeDate,entryTradeDate,targetTradeDate,priorClose,entryClose,targetClose,returnPctPriorCloseToTarget,returnPctEntryCloseToTarget,qualifies',
    '2026-01-01,2026-01-02,1,selloff,gfs-model,UNG,,,,,,,,,true',
    '2026-01-01,2026-01-02,1,selloff,gfs-model,NG=F,,,,,,,,,true',
    '',
  ].join('\n'))
  const builderResult = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
    QORE_DATA_ROOT: path.join(process.cwd(), 'data', 'qore'),
    QORE_GFS_OUTPUT_ROOT: builderRoot,
    QORE_GFS_OUTPUT_BASENAME: builderBase,
    QORE_GFS_CALENDAR_START: '2026-01-01',
    QORE_GFS_CALENDAR_ISSUE_END: '2026-01-01',
    QORE_GFS_CALENDAR_END: '2026-01-02',
    QORE_GFS_LEAD_DAYS: '1',
    QORE_GFS_HEATING_SEASON_ONLY: '0',
    QORE_GFS_COOLING_SEASON_ONLY: '0',
    QORE_GFS_RESUME: '1',
    QORE_GFS_ALLOW_PARTIAL: '1',
    QORE_GFS_CONCURRENCY: '1',
    QORE_FETCH_TIMEOUT_MS: '50',
    QORE_GFS_OBJECT_BASE: 'http://127.0.0.1:1/synthetic-sentinel',
  })
  assert.equal(builderResult.code, 0, builderResult.stderr)
  assert.match(builderResult.stderr, /pruned 1 incomplete or physically implausible output groups/)
  assert.equal((await readFile(builderLocationPath, 'utf8')).trim(), builderLocationHeader)
  const builderManifest = JSON.parse(await readFile(
    path.join(builderRoot, 'weather', 'noaa-gfs', `${builderBase}-manifest.json`),
    'utf8',
  ))
  assert.equal(builderManifest.resumePrunedRowsBeforeRun, 1)
  assert.equal(builderManifest.finalCompleteRows, 0)
  assert.equal(builderManifest.failures.length, 1)
  console.log('ok - forecast builder resume prunes a complete-but-physically-impossible atom before reuse')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
