#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { enrichForecastRows } from './lib/qore-live-all-year-inference.mjs'
import { SUMMER_FORECAST_LOCATION_UNIVERSE } from './lib/qore-summer-location-universe.mjs'
import {
  FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  FORECAST_TEMPERATURE_PLAUSIBILITY,
  LEGACY_FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
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
  () => enrichForecastRows(scores, locations, 'winter', {
    scoreLocationAggregateContract: null,
  }),
  (error) => error.name === 'ForecastTemperatureQualityError',
)
const historicalRows = enrichForecastRows(scores, locations, 'winter', {
  temperatureQualityMode: 'quarantine',
  temperatureQualityLabel: 'Synthetic historical inference replay',
  scoreLocationAggregateContract: null,
})
assert.equal(historicalRows.length, 1)
assert.equal(historicalRows[0].sourceId, 'gfs')

console.log('ok - live inference rejects and historical replay atomically quarantines physically impossible forecast batches')

const aggregateLocationRows = SUMMER_FORECAST_LOCATION_UNIVERSE.locations.map(
  ({ locationId, weight }, index) => ({
    sourceId: 'gfs',
    issueDate,
    targetDate,
    leadDays: 1,
    windowId: 'selloff',
    modelId: 'gfs-model',
    locationId,
    weight,
    forecastMeanF: 30 + (index === 0 ? -15 : index === 1 ? -9 : 2),
    normalMeanF: 30,
    forecastAnomalyF: index === 0 ? -15 : index === 1 ? -9 : 2,
  }),
)
const aggregateSampledWeight = aggregateLocationRows.reduce((sum, row) => sum + row.weight, 0)
const aggregateWeightedAnomaly = aggregateLocationRows.reduce(
  (sum, row) => sum + row.weight * row.forecastAnomalyF,
  0,
) / aggregateSampledWeight
const aggregateCoverage = aggregateLocationRows
  .filter((row) => row.forecastAnomalyF <= -8)
  .reduce((sum, row) => sum + row.weight, 0) / aggregateSampledWeight
const aggregateScore = {
  sourceId: 'gfs',
  issueDate,
  targetDate,
  leadDays: 1,
  windowId: 'selloff',
  modelId: 'gfs-model',
  weightedAnomalyF: Number(aggregateWeightedAnomaly.toFixed(3)),
  coveragePct: Number(aggregateCoverage.toFixed(3)),
  extremeCount: 1,
  sampledWeight: Number(aggregateSampledWeight.toFixed(3)),
  locationCount: aggregateLocationRows.length,
}
const strictAggregateValidation = (scoreRows, locationRows, mode = 'reject', contract = FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT) =>
  validateForecastCalendarTemperatures({
    scoreRows,
    locationRows,
    mode,
    sourceId: 'gfs',
    scoreLocationAggregateContract: contract,
  })
assert.equal(strictAggregateValidation([aggregateScore], aggregateLocationRows).scoreRows.length, 1)
for (const [field, replacement] of [
  ['sampledWeight', aggregateScore.sampledWeight + 0.01],
  ['weightedAnomalyF', aggregateScore.weightedAnomalyF + 0.002],
  ['coveragePct', aggregateScore.coveragePct + 0.01],
  ['extremeCount', aggregateScore.extremeCount + 1],
  ['locationCount', aggregateScore.locationCount - 1],
]) {
  const mutated = { ...aggregateScore, [field]: replacement }
  assert.throws(
    () => strictAggregateValidation([mutated], aggregateLocationRows),
    (error) => error.name === 'ForecastTemperatureQualityError'
      && error.diagnostics.quarantinedGroups[0].reasons.includes(`score-${field}-mismatch`),
  )
  assert.equal(
    strictAggregateValidation([mutated], aggregateLocationRows, 'quarantine').scoreRows.length,
    0,
  )
}
const oneTickScore = {
  ...aggregateScore,
  weightedAnomalyF: aggregateScore.weightedAnomalyF + 0.001,
}
assert.throws(() => strictAggregateValidation([oneTickScore], aggregateLocationRows))
assert.equal(
  strictAggregateValidation(
    [oneTickScore],
    aggregateLocationRows,
    'reject',
    LEGACY_FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  ).scoreRows.length,
  1,
)
assert.throws(() => strictAggregateValidation(
  [{ ...aggregateScore, weightedAnomalyF: aggregateScore.weightedAnomalyF + 0.002 }],
  aggregateLocationRows,
  'reject',
  LEGACY_FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
))
for (const mutatedLocations of [
  aggregateLocationRows.map((row, index) => index === 0 ? { ...row, weight: row.weight + 0.01 } : row),
  aggregateLocationRows.map((row, index) => index === 0 ? { ...row, locationId: 'substituted-location' } : row),
  [...aggregateLocationRows.slice(0, -1), { ...aggregateLocationRows[0] }],
]) {
  assert.throws(() => strictAggregateValidation([aggregateScore], mutatedLocations))
}
assert.throws(() => enrichForecastRows(
  [{ ...aggregateScore, weightedAnomalyF: aggregateScore.weightedAnomalyF + 0.01 }],
  aggregateLocationRows,
  'winter',
))
console.log('ok - executable Winter score aggregates and the exact 18-location universe are bound to location rows')

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
    'issueDate,targetDate,leadDays,windowId,modelId,weightedAnomalyF,coveragePct,extremeCount,sampledWeight,locationCount',
    `${issueDate},${targetDate},1,selloff,gfs-model,-39.808,1,1,1.06,18`,
    '2026-02-13,2026-02-14,1,selloff,gfs-model,4,0,0,1.06,18',
    '',
  ].join('\n'))
  const invalidQualityLocations = SUMMER_FORECAST_LOCATION_UNIVERSE.locations.map(
    ({ locationId, weight }, index) => [
      issueDate,
      targetDate,
      1,
      'selloff',
      'gfs-model',
      locationId,
      weight,
      index === 0 ? -459.67 : 22,
      30,
      index === 0 ? -489.67 : -8,
    ].join(','),
  )
  const acceptedQualityLocations = SUMMER_FORECAST_LOCATION_UNIVERSE.locations.map(
    ({ locationId, weight }) => [
      '2026-02-13',
      '2026-02-14',
      1,
      'selloff',
      'gfs-model',
      locationId,
      weight,
      34,
      30,
      4,
    ].join(','),
  )
  await writeFile(locationPath, [
    'issueDate,targetDate,leadDays,windowId,modelId,locationId,weight,forecastMeanF,normalMeanF,forecastAnomalyF',
    ...invalidQualityLocations,
    ...acceptedQualityLocations,
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
  assert.equal(summary.weatherTemperatureQuality.quarantinedLocationRowCount, 18)
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
  const builderLocationHeader = 'issueDate,targetDate,leadDays,windowId,modelId,locationId,region,weight,forecastMeanF,normalMeanF,forecastAnomalyF,normalSourceContractId,normalSourceContractDigestSha256,normalSourcePayloadDigestSha256,forecastTemporalContractId,sampledValidTimeOffsetsHours,sampledValidHoursUtc,sampledForecastValuesF,forecastSampleProvenanceDigestSha256,forecastSampleVectorDigestSha256,nearestGridLatitude,nearestGridLongitude,source'
  const builderLocationRows = Array.from({ length: 18 }, (_, index) => {
    const forecast = index === 4 ? -459.67 : 24
    return [
      '2026-01-01', '2026-01-02', 1, 'selloff', 'gfs-model', `location-${index}`,
      'region', 0.05, forecast, 30, forecast - 30, '', '', '',
      'legacy-target-utc-midnight-single-snapshot-v1', 0, 0, '', '', '', 40, -80, 'test',
    ].join(',')
  })
  await writeFile(builderLocationPath, `${builderLocationHeader}\n${builderLocationRows.join('\n')}\n`)
  await writeFile(builderScorePath, [
    'issueDate,targetDate,leadDays,windowId,modelId,weightedAnomalyF,coveragePct,extremeCount,sampledWeight,locationCount,forecastTemporalContractId,sampledValidTimeOffsetsHours,sampledValidHoursUtc,qualifies,source',
    '2026-01-01,2026-01-02,1,selloff,gfs-model,-20,1,18,0.9,18,legacy-target-utc-midnight-single-snapshot-v1,0,0,true,test',
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
    NODE_ENV: 'test',
    QORE_TEST_LIVE_INFERENCE_OVERRIDES: '1',
  })
  assert.equal(builderResult.code, 0, builderResult.stderr)
  assert.match(builderResult.stderr, /pruned 1 incomplete, temporally incompatible, or physically implausible output groups/)
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
