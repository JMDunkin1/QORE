#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  LEGACY_FORECAST_TEMPORAL_CONTRACT_ID,
  SUMMER_FORECAST_FAILURE_SAMPLE_LIMIT,
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT,
  SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
  assertSummerForecastTemporalInputs,
  compactSummerForecastFailures,
  forecastLocationSampleSetDigestSha256,
  forecastSampleVectorDigestSha256,
  forecastValidTimeForTargetOffset,
  summarizeSummerForecastTemporalInputs,
  summerTargetDateForIssueDate,
} from './lib/qore-summer-forecast-contract.mjs'

const root = process.cwd()

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
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

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += character
    }
  }
  values.push(value)
  return values
}

async function parseCsv(filePath) {
  const lines = (await readFile(filePath, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

async function rewriteCsv(filePath, mutateRow) {
  const rows = await parseCsv(filePath)
  const headers = parseCsvLine((await readFile(filePath, 'utf8')).split(/\r?\n/, 1)[0])
  const body = rows.map((row) => headers.map((header) => csvEscape(mutateRow(row)[header])).join(','))
  await writeFile(filePath, `${headers.join(',')}\n${body.join('\n')}\n`)
}

const targetDate = '2026-05-08'
assert.equal(
  forecastValidTimeForTargetOffset({ targetDate, offsetHours: 24 }),
  '2026-05-09T00:00',
)
assert.throws(
  () => forecastValidTimeForTargetOffset({ targetDate: '2026-02-30', offsetHours: 24 }),
  /targetDate must be a valid ISO calendar date/,
)
assert.throws(
  () => summerTargetDateForIssueDate('2026-02-30'),
  /issueDate must be a valid ISO calendar date/,
)

const diagnosticFailures = Array.from(
  { length: SUMMER_FORECAST_FAILURE_SAMPLE_LIMIT + 5 },
  (_, index) => `failure-${String(index).padStart(2, '0')}`,
)
const compactDiagnostics = compactSummerForecastFailures([
  ...diagnosticFailures.toReversed(),
  diagnosticFailures[0],
])
assert.equal(compactDiagnostics.failureCount, diagnosticFailures.length)
assert.equal(compactDiagnostics.failureSamples.length, SUMMER_FORECAST_FAILURE_SAMPLE_LIMIT)
assert.deepEqual(compactDiagnostics.failureSamples, diagnosticFailures.slice(
  0,
  SUMMER_FORECAST_FAILURE_SAMPLE_LIMIT,
))
assert.match(compactDiagnostics.failureDigestSha256, /^[a-f0-9]{64}$/)
assert.deepEqual(
  compactDiagnostics,
  compactSummerForecastFailures(diagnosticFailures),
  'failure diagnostics must be order-independent, duplicate-free, and deterministic',
)
assert.throws(
  () => compactSummerForecastFailures(['valid', '']),
  /array of non-empty strings/,
)

const requestedTimes = []
const hourlyTimes = [
  '2026-05-08T00:00',
  '2026-05-08T06:00',
  '2026-05-08T12:00',
  '2026-05-08T18:00',
  '2026-05-09T00:00',
]
const hourlyTemperatures = [50, 60, 70, 80, 100]
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  requestedTimes.push(url.searchParams.get('run'))
  const latitudeCount = url.searchParams.get('latitude')?.split(',').length ?? 0
  const payload = Array.from({ length: latitudeCount }, (_, index) => ({
    latitude: 30 + index,
    longitude: -100 + index,
    hourly: {
      time: hourlyTimes,
      temperature_2m: hourlyTemperatures,
    },
  }))
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const scratch = await mkdtemp(path.join(tmpdir(), 'qore-summer-temporal-contract-'))
try {
  const address = server.address()
  const commonEnv = {
    NODE_ENV: 'test',
    QORE_TEST_LIVE_INFERENCE_OVERRIDES: '1',
    QORE_DATA_ROOT: path.join(root, 'data', 'qore'),
    QORE_FORECAST_SOURCE: 'aigfs',
    QORE_GFS_RUN_HOUR: '00',
    QORE_GFS_CALENDAR_START: '2026-05-01',
    QORE_GFS_CALENDAR_ISSUE_END: '2026-05-01',
    QORE_GFS_CALENDAR_END: targetDate,
    QORE_GFS_LEAD_DAYS: '7',
    QORE_GFS_HEATING_SEASON_ONLY: '0',
    QORE_GFS_COOLING_SEASON_ONLY: '1',
    QORE_GFS_CONCURRENCY: '1',
    QORE_GFS_VALID_HOURS: '',
    QORE_OPEN_METEO_SINGLE_RUNS_BASE_URL: `http://127.0.0.1:${address.port}/v1/forecast`,
  }
  const productionOverride = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
    ...commonEnv,
    NODE_ENV: 'production',
    QORE_TEST_LIVE_INFERENCE_OVERRIDES: '0',
    QORE_GFS_OUTPUT_ROOT: path.join(scratch, 'rejected-production-upstream-override'),
  })
  assert.equal(productionOverride.code, 1)
  assert.match(productionOverride.stderr, /QORE_OPEN_METEO_SINGLE_RUNS_BASE_URL is restricted/)
  const correctedRoot = path.join(scratch, 'corrected')
  const corrected = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
    ...commonEnv,
    QORE_GFS_OUTPUT_ROOT: correctedRoot,
    QORE_GFS_OUTPUT_BASENAME: 'corrected-summer-contract',
    QORE_GFS_VALID_OFFSETS_HOURS: '6,12,18,24',
    QORE_GFS_TEMPORAL_CONTRACT_ID: SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
  })
  assert.equal(corrected.code, 0, corrected.stderr || corrected.stdout)
  assert.equal(requestedTimes.length, 4)
  assert.ok(requestedTimes.every((run) => run === '2026-05-01T00:00'))

  const correctedScorePath = path.join(
    correctedRoot,
    'research',
    'corrected-summer-contract-signal-scores.csv',
  )
  const correctedLocationPath = path.join(
    correctedRoot,
    'weather',
    'aigfs',
    'corrected-summer-contract-location-anomalies.csv',
  )
  const correctedManifestPath = path.join(
    correctedRoot,
    'weather',
    'aigfs',
    'corrected-summer-contract-manifest.json',
  )
  const correctedScores = await parseCsv(correctedScorePath)
  const correctedLocations = await parseCsv(correctedLocationPath)
  const correctedManifest = JSON.parse(await readFile(correctedManifestPath, 'utf8'))
  assert.equal(correctedScores.length, 1)
  assert.equal(correctedLocations.length, 18)
  assert.ok(correctedLocations.every((row) => row.targetDate === targetDate))
  assert.ok(correctedLocations.every((row) => Number(row.forecastMeanF) === 77.5))
  assert.ok(correctedLocations.every((row) => row.sampledValidTimeOffsetsHours === '6|12|18|24'))
  assert.ok(correctedLocations.every((row) => row.sampledForecastValuesF === '60|70|80|100'))
  assert.ok(correctedLocations.every((row) => /^[a-f0-9]{64}$/.test(row.forecastSampleVectorDigestSha256)))
  const correctedProvenance = JSON.parse(correctedScores[0].forecastSampleProvenanceJson)
  assert.deepEqual(correctedProvenance.map((sample) => sample.offsetHours), [6, 12, 18, 24])
  assert.deepEqual(correctedProvenance.map((sample) => sample.validTimeUtc), [
    '2026-05-08T06:00',
    '2026-05-08T12:00',
    '2026-05-08T18:00',
    '2026-05-09T00:00',
  ])
  assert.ok(correctedProvenance.every((sample) => /^[a-f0-9]{64}$/.test(sample.sourcePayloadDigestSha256)))
  assert.ok(correctedProvenance.every((sample) => sample.indexUrl === ''))
  assert.ok(correctedProvenance.every((sample) => sample.indexLine === ''))
  assert.ok(correctedProvenance.every((sample) => sample.sourceIndexPayloadDigestSha256 === ''))
  assert.match(correctedScores[0].forecastSampleProvenanceDigestSha256, /^[a-f0-9]{64}$/)
  assert.match(correctedScores[0].locationSampleVectorSetDigestSha256, /^[a-f0-9]{64}$/)
  assert.equal(correctedManifest.temporalSampling.contractId, SUMMER_FORECAST_TEMPORAL_CONTRACT_ID)
  assert.deepEqual(
    correctedManifest.temporalSampling.validTimeOffsetsHoursFromTargetUtcMidnight,
    [6, 12, 18, 24],
  )
  assert.match(correctedManifest.temporalSampling.targetDateSemantics, /Offset 24 samples the following UTC midnight/)
  assert.equal(assertSummerForecastTemporalInputs({
    sourceId: 'aigfs',
    manifest: correctedManifest,
    scoreRows: correctedScores,
    locationRows: correctedLocations,
  }).complete, true)
  assert.match(
    correctedManifest.temporalSampling.valueBinding.acquisitionTrustBoundary,
    /malicious process.*trusted builder acquisition-attestation boundary/,
  )

  // A forged normal/anomaly can be made internally coherent and every mutable
  // vector/set digest can be recomputed. It must still fail independent
  // authentication against the retained, sealed normal payload.
  const forgedLocations = correctedLocations.map((row) => {
    const offsets = row.sampledValidTimeOffsetsHours.split('|').map(Number)
    const sampleValuesF = row.sampledForecastValuesF.split('|').map(Number)
    const forged = {
      ...row,
      normalMeanF: String(Number(row.normalMeanF) + 1),
      forecastAnomalyF: String(Number(row.forecastAnomalyF) - 1),
    }
    forged.forecastSampleVectorDigestSha256 = forecastSampleVectorDigestSha256({
      contractId: forged.forecastTemporalContractId,
      issueDate: forged.issueDate,
      targetDate: forged.targetDate,
      leadDays: forged.leadDays,
      modelId: forged.modelId,
      locationId: forged.locationId,
      weight: forged.weight,
      offsets,
      sampleValuesF,
      normalMeanF: forged.normalMeanF,
      forecastAnomalyF: forged.forecastAnomalyF,
      normalSourceContractId: forged.normalSourceContractId,
      normalSourceContractDigestSha256: forged.normalSourceContractDigestSha256,
      normalSourcePayloadDigestSha256: forged.normalSourcePayloadDigestSha256,
      provenanceDigestSha256: forged.forecastSampleProvenanceDigestSha256,
    })
    return forged
  })
  const forgedSampledWeight = forgedLocations.reduce(
    (sum, row) => sum + Number(row.weight),
    0,
  )
  const forgedWeightedAnomalyF = forgedLocations.reduce(
    (sum, row) => sum + Number(row.forecastAnomalyF) * Number(row.weight),
    0,
  ) / forgedSampledWeight
  const forgedScores = correctedScores.map((row) => ({
    ...row,
    weightedAnomalyF: String(Math.round(forgedWeightedAnomalyF * 1000) / 1000),
    locationSampleVectorSetDigestSha256: forecastLocationSampleSetDigestSha256({
      contractId: row.forecastTemporalContractId,
      issueDate: row.issueDate,
      targetDate: row.targetDate,
      leadDays: row.leadDays,
      modelId: row.modelId,
      locationRows: forgedLocations,
    }),
  }))
  const forgedSummary = summarizeSummerForecastTemporalInputs({
    sourceId: 'aigfs',
    manifest: correctedManifest,
    scoreRows: forgedScores,
    locationRows: forgedLocations,
  })
  assert.equal(forgedSummary.complete, false)
  assert.match(
    forgedSummary.failures.join(' | '),
    /normalMeanF does not match the reviewed retained normal payload/,
  )
  assert.doesNotMatch(
    forgedSummary.failures.join(' | '),
    /forecastSampleVectorDigestSha256|locationSampleVectorSetDigestSha256/,
  )

  for (const [field, expectedFailure] of [
    ['sampledWeight', /score sampledWeight must be finite/],
    ['weightedAnomalyF', /score weightedAnomalyF must be finite/],
  ]) {
    const nonfiniteScoreSummary = summarizeSummerForecastTemporalInputs({
      sourceId: 'aigfs',
      manifest: correctedManifest,
      scoreRows: correctedScores.map((row) => ({ ...row, [field]: 'NaN' })),
      locationRows: correctedLocations,
    })
    assert.equal(nonfiniteScoreSummary.complete, false)
    assert.match(nonfiniteScoreSummary.failures.join(' | '), expectedFailure)
  }
  const nonfiniteLocationSummary = summarizeSummerForecastTemporalInputs({
    sourceId: 'aigfs',
    manifest: correctedManifest,
    scoreRows: correctedScores,
    locationRows: correctedLocations.map((row, index) =>
      index === 0 ? { ...row, forecastMeanF: 'NaN' } : row),
  })
  assert.equal(nonfiniteLocationSummary.complete, false)
  assert.match(nonfiniteLocationSummary.failures.join(' | '), /location forecastMeanF must be finite/)

  const extraModelGroupSummary = summarizeSummerForecastTemporalInputs({
    sourceId: 'aigfs',
    manifest: correctedManifest,
    scoreRows: [
      ...correctedScores,
      { ...correctedScores[0], windowId: 'other', modelId: 'unreviewed-model' },
    ],
    locationRows: correctedLocations,
  })
  assert.equal(extraModelGroupSummary.complete, false)
  assert.match(
    extraModelGroupSummary.failures.join(' | '),
    /extra group for the same source, issueDate, and leadDays/,
  )
  assert.match(extraModelGroupSummary.failures.join(' | '), /modelId does not match the reviewed/)

  const orphanLocationSummary = summarizeSummerForecastTemporalInputs({
    sourceId: 'aigfs',
    manifest: correctedManifest,
    scoreRows: correctedScores,
    locationRows: [
      ...correctedLocations,
      { ...correctedLocations[0], windowId: 'other', modelId: 'unreviewed-model' },
    ],
  })
  assert.equal(orphanLocationSummary.complete, false)
  assert.match(orphanLocationSummary.failures.join(' | '), /has no score row/)

  const legacyRoot = path.join(scratch, 'legacy')
  const legacy = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
    ...commonEnv,
    QORE_GFS_OUTPUT_ROOT: legacyRoot,
    QORE_GFS_OUTPUT_BASENAME: 'legacy-midnight-contract',
    QORE_GFS_VALID_OFFSETS_HOURS: '0',
    QORE_GFS_TEMPORAL_CONTRACT_ID: LEGACY_FORECAST_TEMPORAL_CONTRACT_ID,
  })
  assert.equal(legacy.code, 0, legacy.stderr || legacy.stdout)
  const legacyManifest = JSON.parse(await readFile(
    path.join(legacyRoot, 'weather', 'aigfs', 'legacy-midnight-contract-manifest.json'),
    'utf8',
  ))
  const legacyScorePath = path.join(
    legacyRoot,
    'research',
    'legacy-midnight-contract-signal-scores.csv',
  )
  const legacyLocationPath = path.join(
    legacyRoot,
    'weather',
    'aigfs',
    'legacy-midnight-contract-location-anomalies.csv',
  )
  const legacyManifestPath = path.join(
    legacyRoot,
    'weather',
    'aigfs',
    'legacy-midnight-contract-manifest.json',
  )
  const legacyScores = await parseCsv(legacyScorePath)
  const legacyLocations = await parseCsv(legacyLocationPath)
  assert.equal(legacyManifest.temporalSampling.contractId, LEGACY_FORECAST_TEMPORAL_CONTRACT_ID)
  assert.equal(legacyManifest.temporalSampling.summerExecutionEligible, false)
  assert.deepEqual(legacyManifest.validTimeOffsetsHoursFromTargetUtcMidnight, [0])
  assert.ok(legacyLocations.every((row) => row.sampledForecastValuesF === '50'))
  assert.throws(() => assertSummerForecastTemporalInputs({
    sourceId: 'aigfs',
    manifest: legacyManifest,
    scoreRows: legacyScores,
    locationRows: legacyLocations,
  }), /Corrected Summer forecast temporal inputs are required/)

  const correctedOffsets = '6|12|18|24'
  const relabelRow = (row) => ({
    ...row,
    forecastTemporalContractId: SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
    sampledValidTimeOffsetsHours: correctedOffsets,
    sampledValidHoursUtc: correctedOffsets,
  })
  const relabeledManifest = {
    ...legacyManifest,
    validTimeOffsetsHoursFromTargetUtcMidnight: [6, 12, 18, 24],
    validHoursUtc: [6, 12, 18, 24],
    temporalSampling: correctedManifest.temporalSampling,
  }
  const relabelSummary = summarizeSummerForecastTemporalInputs({
    sourceId: 'aigfs',
    manifest: relabeledManifest,
    scoreRows: legacyScores.map(relabelRow),
    locationRows: legacyLocations.map(relabelRow),
  })
  assert.equal(relabelSummary.complete, false)
  assert.match(relabelSummary.failures.join(' | '), /sample count|sample vectors|provenance|digest/)

  // A resume must not trust corrected labels pasted over a one-snapshot cache.
  await rewriteCsv(legacyScorePath, relabelRow)
  await rewriteCsv(legacyLocationPath, relabelRow)
  await writeFile(legacyManifestPath, `${JSON.stringify(relabeledManifest, null, 2)}\n`)
  const requestCountBeforeResume = requestedTimes.length
  const resumed = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
    ...commonEnv,
    QORE_GFS_OUTPUT_ROOT: legacyRoot,
    QORE_GFS_OUTPUT_BASENAME: 'legacy-midnight-contract',
    QORE_GFS_VALID_OFFSETS_HOURS: '6,12,18,24',
    QORE_GFS_TEMPORAL_CONTRACT_ID: SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
    QORE_GFS_RESUME: '1',
  })
  assert.equal(resumed.code, 0, resumed.stderr || resumed.stdout)
  assert.match(resumed.stderr, /resume pruned 1 incomplete, temporally incompatible/)
  assert.equal(requestedTimes.length - requestCountBeforeResume, 4)
  const rebuiltScores = await parseCsv(legacyScorePath)
  const rebuiltLocations = await parseCsv(legacyLocationPath)
  const rebuiltManifest = JSON.parse(await readFile(legacyManifestPath, 'utf8'))
  assert.ok(rebuiltLocations.every((row) => row.sampledForecastValuesF === '60|70|80|100'))
  assert.equal(assertSummerForecastTemporalInputs({
    sourceId: 'aigfs',
    manifest: rebuiltManifest,
    scoreRows: rebuiltScores,
    locationRows: rebuiltLocations,
  }).complete, true)

  for (const [offsets, expectedError] of [
    ['6,12,18', /requires run 00, lead days 7, and the exact ordered offset set 6,12,18,24/],
    ['6,12,12,24', /must not contain duplicate offsets/],
    ['6,18,12,24', /must be strictly increasing/],
    ['6,12,18,25', /integers from 0 through 24/],
  ]) {
    const rejected = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
      ...commonEnv,
      QORE_GFS_OUTPUT_ROOT: path.join(scratch, `rejected-${offsets.replaceAll(',', '-')}`),
      QORE_GFS_VALID_OFFSETS_HOURS: offsets,
      QORE_GFS_TEMPORAL_CONTRACT_ID: SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
    })
    assert.equal(rejected.code, 1, `offset set ${offsets} unexpectedly succeeded`)
    assert.match(rejected.stderr, expectedError)
  }

  console.log('ok - Summer builder binds sampled values and acquisition provenance, rejects relabeling, refetches invalid resume caches, and rejects malformed contracts')
} finally {
  await new Promise((resolve) => server.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
