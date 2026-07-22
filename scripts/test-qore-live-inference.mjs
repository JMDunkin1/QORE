#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadReviewedBrokerExecutionProfile } from './lib/qore-broker-execution-profile.mjs'
import { createSignal, enrichForecastRows, inferAllYearTarget, selectedContracts } from './lib/qore-live-all-year-inference.mjs'
import { liveComponentContractDigestSha256 } from './lib/qore-live-contract.mjs'
import { ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION } from './lib/qore-live-strategy-artifact.mjs'
import { writeValidationEvidenceTestFixtures } from './lib/qore-validation-evidence-test-fixture.mjs'
import {
  ALL_YEAR_SELECTION_CONTRACT,
  VALIDATION_INTEGRITY_MANIFEST_ID,
  VALIDATION_INTEGRITY_SCHEMA_VERSION,
  allYearStrategyArtifactCoreDigestSha256,
  allYearStrategyContractDigestSha256,
  loadValidationIntegrityManifest,
} from './lib/qore-validation-integrity.mjs'

process.env.NODE_ENV = 'test'
process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES = '1'

const root = process.cwd()
const dataRoot = path.join(root, 'data', 'qore')
const require = createRequire(import.meta.url)
const validationFixtureDir = await mkdtemp(path.join(tmpdir(), 'qore-validation-integrity-'))
const validationFixturePath = path.join(validationFixtureDir, 'pristine-validation-integrity.json')

function promotionEligibleLiveTargetParity(parity) {
  return {
    ...parity,
    status: 'pass',
    matchedRowCount: parity.comparedRowCount,
    mismatchCount: 0,
    gasPositionMismatchCount: 0,
    thesisKindMismatchCount: 0,
    exactTargetParity: true,
    comparisonDigestSha256: 'd'.repeat(64),
    mismatches: [],
  }
}

function promotionEligibleGates(gates) {
  return Object.fromEntries(Object.keys(gates).map((gate) => [gate, true]))
}

const validationStrategySource = JSON.parse(await readFile(
  path.join(dataRoot, 'research', 'strategy-agent-runs', 'ngas-all-year-beta', 'run-summary.json'),
  'utf8',
))
validationStrategySource.contract.allYearSelection = ALL_YEAR_SELECTION_CONTRACT
validationStrategySource.validation.liveTargetParity = promotionEligibleLiveTargetParity(
  validationStrategySource.validation.liveTargetParity,
)
validationStrategySource.validation.promotionGates = promotionEligibleGates(
  validationStrategySource.validation.promotionGates,
)
const sealedStrategyContractDigestSha256 = allYearStrategyContractDigestSha256(validationStrategySource)
const sealedStrategyArtifactDigestSha256 = allYearStrategyArtifactCoreDigestSha256(validationStrategySource)
const sealedBrokerExecutionProfileDigestSha256 = loadReviewedBrokerExecutionProfile(root).profileDigestSha256
const paperAccountPseudonymSha256 = 'b'.repeat(64)
const validationEvidenceFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: root,
  manifestPath: validationFixturePath,
  strategyContractDigestSha256: sealedStrategyContractDigestSha256,
  strategyArtifactCoreDigestSha256: sealedStrategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256: sealedBrokerExecutionProfileDigestSha256,
  accountPseudonymSha256: paperAccountPseudonymSha256,
})
await writeFile(validationFixturePath, `${JSON.stringify({
  schemaVersion: VALIDATION_INTEGRITY_SCHEMA_VERSION,
  manifestId: VALIDATION_INTEGRITY_MANIFEST_ID,
  strategyId: 'ngas-all-year-beta',
  reviewedAt: '2025-10-02T00:00:00.000Z',
  sealedStrategyContractDigestSha256,
  sealedStrategyArtifactDigestSha256,
  sealedBrokerExecutionProfileDigestSha256,
  historicalEvidence: {
    status: 'development-contaminated',
    evidenceStart: '2020-01-01',
    developmentBegan: '2022-06-11',
    observedThrough: '2022-12-15',
    prospectiveStart: '2023-01-01',
    pristineForwardEvidence: true,
  },
  minimumForwardEvidence: {
    independentEpisodes: 60,
    completeSummerSeasons: 2,
    completeWinterSeasons: 2,
  },
  observedForwardEvidence: {
    ...validationEvidenceFixtures.forwardSummary,
    evidenceArtifactDigestSha256: validationEvidenceFixtures.forwardEvidenceArtifactDigestSha256,
    reviewedAt: '2025-10-01T00:00:00.000Z',
  },
  minimumPaperExecutionEvidence: {
    tradingSessions: 60,
    filledOrders: 10,
    ungFilledOrders: 4,
    ungLongFilledOrders: 2,
    ungShortFilledOrders: 2,
    maximumMedianAbsoluteSlippageBps: 25,
    maximumP95AbsoluteSlippageBps: 50,
  },
  paperExecutionEvidence: {
    status: 'reviewed',
    ...validationEvidenceFixtures.paperSummary,
    evidenceArtifactDigestSha256: validationEvidenceFixtures.paperEvidenceArtifactDigestSha256,
    reviewedAt: '2025-10-01T01:00:00.000Z',
  },
  approvals: {
    paper: {
      status: 'approved',
      approvalId: 'test-paper-approval',
      approvedAt: '2022-12-31T12:00:00.000Z',
      strategyContractDigestSha256: sealedStrategyContractDigestSha256,
      brokerExecutionProfileDigestSha256: sealedBrokerExecutionProfileDigestSha256,
    },
    live: {
      status: 'approved',
      approvalId: 'test-live-approval',
      approvedAt: '2025-10-02T00:00:00.000Z',
      strategyContractDigestSha256: sealedStrategyContractDigestSha256,
      brokerExecutionProfileDigestSha256: sealedBrokerExecutionProfileDigestSha256,
    },
  },
}, null, 2)}\n`)
process.env.QORE_VALIDATION_INTEGRITY_FILE = validationFixturePath
const pristineValidationIntegrity = loadValidationIntegrityManifest(root)

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
function addDays(date, count) { return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10) }

async function writeStrategyArtifactFixture(filePath, { eligible }) {
  const sourcePath = path.join(dataRoot, 'research', 'strategy-agent-runs', 'ngas-all-year-beta', 'run-summary.json')
  const source = JSON.parse(await readFile(sourcePath, 'utf8'))
  const promotionGates = promotionEligibleGates(source.validation.promotionGates)
  const fixture = {
    ...source,
    artifactSchemaVersion: ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION,
    contract: { ...source.contract, allYearSelection: ALL_YEAR_SELECTION_CONTRACT },
    status: eligible ? 'research-baseline' : 'needs-validation',
    search: {
      ...source.search,
      eligibleCandidateCount: eligible ? 1 : 0,
      selectionStatus: eligible ? 'fixed-composite-passes-promotion-gates' : 'fixed-composite-retained-needs-validation',
      selectionUsedHoldout: false,
    },
    validation: {
      ...source.validation,
      liveTargetParity: eligible
        ? promotionEligibleLiveTargetParity(source.validation.liveTargetParity)
        : source.validation.liveTargetParity,
      integrity: {
        ...pristineValidationIntegrity.binding,
        strategyContractDigestSha256: pristineValidationIntegrity.binding.sealedStrategyContractDigestSha256,
      },
      promotionGates: {
        ...Object.fromEntries(Object.keys(promotionGates).map((gate) => [gate, eligible])),
        pristineForwardEvidence: eligible,
        strategyContractSeal: eligible,
        paperApproval: eligible,
        paperExecutionEvidence: eligible,
        liveApproval: eligible,
      },
    },
    candidates: source.candidates.map((candidate, index) => ({ ...candidate, eligible: eligible && index === 0 })),
  }
  const raw = `${JSON.stringify(fixture, null, 2)}\n`
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, raw)
  return { fixture, digestSha256: crypto.createHash('sha256').update(raw).digest('hex') }
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function startYahooDailyFixture(targetDate) {
  const dates = []
  for (let date = addDays(targetDate, -120); date <= targetDate; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    if (weekday > 0 && weekday < 6) dates.push(date)
  }
  const offsets = { 'NG=F': 2, UNG: 10, VOO: 400, QQQM: 150 }
  const requests = []
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const symbol = decodeURIComponent(url.pathname.split('/').at(-1))
    requests.push(symbol)
    if (!Object.hasOwn(offsets, symbol)) {
      response.writeHead(404)
      response.end()
      return
    }
    const closes = dates.map((date, index) => date === targetDate ? offsets[symbol] * 100 : offsets[symbol] + index * 0.05)
    const payload = {
      chart: {
        result: [{
          timestamp: dates.map((date) => Date.parse(`${date}T00:00:00Z`) / 1000),
          indicators: {
            quote: [{
              open: closes.map((value) => value * 0.99),
              high: closes.map((value) => value * 1.01),
              low: closes.map((value) => value * 0.98),
              close: closes,
              volume: closes.map((_, index) => 1_000_000 + index),
            }],
            adjclose: [{ adjclose: closes }],
          },
        }],
        error: null,
      },
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v8/finance/chart`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function writeCsvWindow(sourcePath, targetPath, startDate, endDate) {
  const [header, ...lines] = (await readFile(sourcePath, 'utf8')).trim().split(/\r?\n/)
  const selected = lines.filter((line) => { const date = line.slice(0, 10); return date >= startDate && date <= endDate })
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${header}\n${selected.join('\n')}${selected.length ? '\n' : ''}`)
}

async function writeCsvThrough(sourcePath, targetPath, endDate) {
  const [header, ...lines] = (await readFile(sourcePath, 'utf8')).trim().split(/\r?\n/)
  const selected = lines.filter((line) => line.slice(0, 10) <= endDate)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${header}\n${selected.join('\n')}\n`)
}

async function writeMarketFixture(sourcePath, targetPath, options) {
  const [header, ...lines] = (await readFile(sourcePath, 'utf8')).trim().split(/\r?\n/)
  const dropped = new Set(options.dropDates ?? [])
  const selected = lines.filter((line) => {
    const date = line.slice(0, 10)
    return date >= (options.startDate ?? '0000-00-00') && date <= options.endDate && !dropped.has(date)
  })
  if (options.extraDate) {
    const source = selected.find((line) => line.startsWith(`${options.extraDate.sourceDate},`))
    assert.ok(source, `Missing market row used to create extra date ${options.extraDate.sourceDate}`)
    selected.push(`${options.extraDate.date}${source.slice(10)}`)
  }
  if (options.duplicateDate) {
    const duplicate = selected.find((line) => line.startsWith(`${options.duplicateDate},`))
    assert.ok(duplicate, `Missing market row to duplicate on ${options.duplicateDate}`)
    selected.push(duplicate)
  }
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${header}\n${selected.join('\n')}${selected.length ? '\n' : ''}`)
}

async function dropLocation(filePath, locationId) {
  const [header, ...lines] = (await readFile(filePath, 'utf8')).trim().split(/\r?\n/)
  const locationIndex = parseLine(header).indexOf('locationId')
  const kept = lines.filter((line) => parseLine(line)[locationIndex] !== locationId)
  await writeFile(filePath, `${header}\n${kept.join('\n')}${kept.length ? '\n' : ''}`)
}

function serializeCsvValue(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

async function rewriteCsvRows(filePath, transform) {
  const [header, ...lines] = (await readFile(filePath, 'utf8')).trim().split(/\r?\n/)
  const headers = parseLine(header)
  const rewritten = lines.map((line) => transform(parseLine(line), headers).map(serializeCsvValue).join(','))
  await writeFile(filePath, `${header}\n${rewritten.join('\n')}${rewritten.length ? '\n' : ''}`)
}

async function replaceLocationId(filePath, fromLocationId, toLocationId) {
  await rewriteCsvRows(filePath, (values, headers) => {
    const locationIndex = headers.indexOf('locationId')
    if (values[locationIndex] === fromLocationId) values[locationIndex] = toLocationId
    return values
  })
}

async function reweightLocationAndScore(locationPath, scorePath, locationId, weightDelta) {
  await rewriteCsvRows(locationPath, (values, headers) => {
    const locationIndex = headers.indexOf('locationId')
    const weightIndex = headers.indexOf('weight')
    if (values[locationIndex] === locationId) values[weightIndex] = String(Number(values[weightIndex]) + weightDelta)
    return values
  })
  await rewriteCsvRows(scorePath, (values, headers) => {
    const sampledWeightIndex = headers.indexOf('sampledWeight')
    values[sampledWeightIndex] = String(Number(values[sampledWeightIndex]) + weightDelta)
    return values
  })
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
  const forecasts = enrichForecastRows(scores, locations, 'summer', {
    temperatureQualityMode: 'quarantine',
    temperatureQualityLabel: 'Versioned Summer inference test inputs',
  })
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
  const scores = []; const locations = []
  for (const calendar of manifest.forecastCalendars) {
    scores.push(...(await csv(path.join(dataRoot, calendar.files.signalScores))).map((row) => ({ ...row, sourceId: calendar.id })))
    locations.push(...(await csv(path.join(dataRoot, calendar.files.locationAnomalies))).map((row) => ({ ...row, sourceId: calendar.id })))
  }
  const forecasts = enrichForecastRows(scores, locations, 'winter', {
    temperatureQualityMode: 'quarantine',
    temperatureQualityLabel: 'Versioned Winter inference test inputs',
  })
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
  const actualWeatherRows = await csv(path.join(dataRoot, 'weather/events/arctic-blast-actual-daily-2021-01-01-2026-03-31.csv'))
  return { count: expected.length, forecasts, actualWeatherRows, selected: finalRows }
}

async function positionParity(result, marketFile, label) {
  const market = (await csv(path.join(dataRoot, 'market/yahoo', marketFile))).map((row) => ({ date: row.date, gasClose: Number(row.close) })).filter((row) => row.gasClose > 0)
  const storage = await csv(path.join(dataRoot, 'fundamentals/eia/working-gas-storage-lower48-weekly.csv'))
  const active = result.selected.filter((row) => row.windowId !== 'index-fallback' && Number(row.ungPosition) !== 0)
  const fallback = result.selected.filter((row) => row.windowId === 'index-fallback' && Number(row.ungPosition) === 0)
  assert.ok(active.length >= 100)
  assert.ok(fallback.length >= 100)
  for (const row of [...active, ...fallback]) {
    const inferred = inferAllYearTarget({ forecastRows: result.forecasts, actualWeatherRows: result.actualWeatherRows, marketDays: market, storageRows: storage, targetDate: row.entryTradeDate })
    assert.ok(Math.abs(Number(inferred.gasPosition) - Number(row.ungPosition)) <= 0.001, `${label} position mismatch on ${row.entryTradeDate}: ${inferred.gasPosition} != ${row.ungPosition} (${inferred.thesisKind} / ${row.thesisKind}) ${JSON.stringify(inferred.diagnostics)}`)
    assert.equal(inferred.thesisKind, row.thesisKind, `${label} thesis mismatch on ${row.entryTradeDate}`)
  }
  return active.length + fallback.length
}

async function winterStorageReleaseCalendarBoundary(result) {
  const market = (await csv(path.join(dataRoot, 'market/yahoo/UNG-qore-market.csv')))
    .map((row) => ({ date: row.date, gasClose: Number(row.close) }))
    .filter((row) => row.gasClose > 0)
  const storage = await csv(path.join(dataRoot, 'fundamentals/eia/working-gas-storage-lower48-weekly.csv'))
  const beforeRelease = inferAllYearTarget({
    forecastRows: result.forecasts,
    actualWeatherRows: result.actualWeatherRows,
    marketDays: market,
    storageRows: storage,
    targetDate: '2025-01-03',
  })
  assert.equal(beforeRelease.diagnostics.storage.storageDate, '2024-12-20')
  assert.equal(beforeRelease.diagnostics.storage.storageReleaseAt, '2024-12-27T15:30:00.000Z')
  assert.equal(beforeRelease.diagnostics.storage.releaseCalendarStatus, 'versioned')

  const afterRelease = inferAllYearTarget({
    forecastRows: result.forecasts,
    actualWeatherRows: result.actualWeatherRows,
    marketDays: market,
    storageRows: storage,
    targetDate: '2025-01-06',
  })
  assert.equal(afterRelease.diagnostics.storage.storageDate, '2024-12-27')
  assert.equal(afterRelease.diagnostics.storage.storageReleaseAt, '2025-01-03T15:30:00.000Z')
}

async function summerStorageReleaseCalendarBoundary(result) {
  const market = (await csv(path.join(dataRoot, 'market/yahoo/NG-F-qore-market.csv')))
    .map((row) => ({ date: row.date, gasClose: Number(row.close) }))
    .filter((row) => row.gasClose > 0)
  const storage = await csv(path.join(dataRoot, 'fundamentals/eia/working-gas-storage-lower48-weekly.csv'))
  const beforeRelease = inferAllYearTarget({
    forecastRows: result.forecasts,
    marketDays: market,
    storageRows: storage,
    targetDate: '2023-07-07',
  })
  assert.equal(beforeRelease.diagnostics.storage.storageDate, '2023-06-23')
  assert.equal(beforeRelease.diagnostics.storage.storageReleaseAt, '2023-06-29T14:30:00.000Z')
  assert.equal(beforeRelease.diagnostics.storage.releaseCalendarStatus, 'versioned')

  const afterRelease = inferAllYearTarget({
    forecastRows: result.forecasts,
    marketDays: market,
    storageRows: storage,
    targetDate: '2023-07-10',
  })
  assert.equal(afterRelease.diagnostics.storage.storageDate, '2023-06-30')
  assert.equal(afterRelease.diagnostics.storage.storageReleaseAt, '2023-07-07T14:30:00.000Z')

  assert.throws(
    () => inferAllYearTarget({
      forecastRows: result.forecasts,
      marketDays: market,
      storageRows: [...storage, { date: '2099-01-02', storageBcf: '1' }],
      targetDate: '2023-07-10',
    }),
    /Missing versioned EIA release timestamp for storage period 2099-01-02/,
  )
}

async function liveMarketBoundary(result) {
  const market = (await csv(path.join(dataRoot, 'market/yahoo/NG-F-qore-market.csv')))
    .map((row) => ({ date: row.date, gasClose: Number(row.close) }))
    .filter((row) => row.gasClose > 0)
  const storage = await csv(path.join(dataRoot, 'fundamentals/eia/working-gas-storage-lower48-weekly.csv'))
  const row = result.selected.find((item) => item.windowId === 'weather-follow' && Number(item.ungPosition) !== 0)
  assert.ok(row, 'Missing summer weather-follow fixture')
  const liveMarket = market.filter((item) => item.date <= row.entryTradeDate)
  assert.equal(liveMarket.at(-1)?.date, row.entryTradeDate)
  const inferred = inferAllYearTarget({ forecastRows: result.forecasts, marketDays: liveMarket, storageRows: storage, targetDate: row.entryTradeDate })
  close(inferred.gasPosition, row.ungPosition, 0.001)
  assert.equal(inferred.windowId, 'weather-follow')
}

async function liveLoaderParity(result, date, expectedSources, options = {}) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-live-inference-'))
  try {
    const manifest = JSON.parse(await readFile(path.join(dataRoot, 'dataset-manifest.json'), 'utf8'))
    const weatherDirs = { gfs: 'noaa-gfs', 'gefs-mean': 'noaa-gefs', graphcastgfs: 'gfs-graphcast', aigfs: 'aigfs', 'ecmwf-ifs': 'ecmwf-ifs', 'ecmwf-aifs': 'ecmwf-aifs', 'gem-global': 'gem-global' }
    const forecastRoot = path.join(scratch, 'noaa-calendar')
    const summerCalendars = [
      { id: 'gfs', files: { signalScores: 'research/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv', locationAnomalies: 'weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv' } },
      { id: 'gefs-mean', files: { signalScores: 'research/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv', locationAnomalies: 'weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv' } },
    ]
    const winterCalendars = manifest.forecastCalendars.filter((calendar) => selectedContracts.winterFollow.liveHeatingDemandSourceIds.includes(calendar.id))
    const calendars = expectedSources === selectedContracts.summer.sourceIds ? summerCalendars : winterCalendars
    for (const calendar of calendars) {
      if (options.omittedSources?.includes(calendar.id)) continue
      const fixtureSourceId = options.fixtureSources?.[calendar.id] ?? calendar.id
      const fixtureCalendar = fixtureSourceId === calendar.id ? calendar : manifest.forecastCalendars.find((item) => item.id === fixtureSourceId)
      assert.ok(fixtureCalendar, `Missing fixture calendar ${fixtureSourceId}`)
      const base = `qore-live-${calendar.id}-00z`
      const issueEndDate = options.issueEndDates?.[calendar.id] ?? date
      const scorePath = path.join(forecastRoot, 'research', `${base}-signal-scores.csv`)
      await writeCsvWindow(path.join(dataRoot, fixtureCalendar.files.signalScores), scorePath, addDays(date, -16), issueEndDate)
      const locationPath = path.join(forecastRoot, 'weather', weatherDirs[calendar.id], `${base}-location-anomalies.csv`)
      await writeCsvWindow(path.join(dataRoot, fixtureCalendar.files.locationAnomalies), locationPath, addDays(date, -16), issueEndDate)
      if (options.partialLocationSources?.includes(calendar.id)) await dropLocation(locationPath, 'minneapolis')
      if (options.replacedLocationSources?.includes(calendar.id)) {
        await replaceLocationId(locationPath, 'minneapolis', 'chicago')
      }
      if (options.reweightedLocationSources?.includes(calendar.id)) {
        await reweightLocationAndScore(locationPath, scorePath, 'minneapolis', 0.01)
      }
      await writeFile(path.join(forecastRoot, 'weather', weatherDirs[calendar.id], `${base}-manifest.json`), `${JSON.stringify({ forecastSource: calendar.id, generatedAt: `${date}T12:00:00.000Z`, failures: [] })}\n`)
    }
    const outputPath = path.join(scratch, 'target.json')
    const strategyArtifactPath = path.join(scratch, 'eligible-all-year-run-summary.json')
    const strategyArtifact = await writeStrategyArtifactFixture(strategyArtifactPath, { eligible: true })
    const env = {
      QORE_LIVE_INFERENCE_STATE_DIR: scratch,
      QORE_LIVE_INFERENCE_FILE: outputPath,
      QORE_LIVE_INFERENCE_DATE: date,
      QORE_LIVE_INFERENCE_SKIP_FETCH: '1',
      QORE_LIVE_STRATEGY_ARTIFACT_FILE: strategyArtifactPath,
    }
    const gasFileName = expectedSources === selectedContracts.summer.sourceIds ? 'NG-F-qore-market.csv' : 'UNG-qore-market.csv'
    if (options.marketCollectorBaseUrl) {
      env.QORE_LIVE_MARKET_HISTORY_STATE_DIR = path.join(scratch, 'market-history')
      env.QORE_LIVE_MARKET_HISTORY_YAHOO_BASE_URL = options.marketCollectorBaseUrl
    } else {
      env.QORE_LIVE_INFERENCE_GAS_MARKET_FILE = path.join(dataRoot, 'market/yahoo', gasFileName)
      env.QORE_LIVE_INFERENCE_INDEX_MARKET_FILE = path.join(dataRoot, 'market/yahoo/US-INDEX-BASKET-qore-market.csv')
    }
    if (options.marketFixture) {
      const gasPath = path.join(scratch, gasFileName)
      const indexPath = path.join(scratch, 'US-INDEX-BASKET-qore-market.csv')
      await writeMarketFixture(path.join(dataRoot, 'market/yahoo', gasFileName), gasPath, {
        startDate: options.marketFixture.startDate,
        endDate: options.marketFixture.gasEndDate ?? date,
        dropDates: options.marketFixture.dropGasDates,
        duplicateDate: options.marketFixture.duplicateGasDate,
        extraDate: options.marketFixture.extraGasDate,
      })
      await writeMarketFixture(path.join(dataRoot, 'market/yahoo/US-INDEX-BASKET-qore-market.csv'), indexPath, {
        startDate: options.marketFixture.startDate,
        endDate: options.marketFixture.indexEndDate ?? date,
        dropDates: options.marketFixture.dropIndexDates,
        duplicateDate: options.marketFixture.duplicateIndexDate,
      })
      env.QORE_LIVE_INFERENCE_GAS_MARKET_FILE = gasPath
      env.QORE_LIVE_INFERENCE_INDEX_MARKET_FILE = indexPath
      if (options.marketFixture.maxAgeDays !== undefined) env.QORE_LIVE_INFERENCE_MAX_MARKET_AGE_DAYS = String(options.marketFixture.maxAgeDays)
    }
    if (options.staticStorageEndDate) {
      const storagePath = path.join(scratch, 'working-gas-storage.csv')
      await writeCsvThrough(path.join(dataRoot, 'fundamentals/eia/working-gas-storage-lower48-weekly.csv'), storagePath, options.staticStorageEndDate)
      env.QORE_LIVE_INFERENCE_STORAGE_FILE = storagePath
    }
    if (options.eiaSnapshot) {
      const eiaSnapshotPath = path.join(scratch, 'eia-storage-release-window.json')
      await writeFile(eiaSnapshotPath, `${JSON.stringify(options.eiaSnapshot, null, 2)}\n`)
      env.QORE_LIVE_INFERENCE_EIA_SNAPSHOT_FILE = eiaSnapshotPath
    }
    const run = await runNode(['scripts/qore-live-strategy-inference.mjs'], env)
    if (options.expectedError) {
      assert.equal(run.code, 1, `Expected live inference to fail, got: ${run.stdout}`)
      assert.match(run.stderr, options.expectedError)
      return
    }
    assert.equal(run.code, 0, run.stderr)
    const snapshot = JSON.parse(await readFile(outputPath, 'utf8'))
    assert.equal(snapshot.strategyArtifact.status, 'research-baseline')
    assert.equal(snapshot.strategyArtifact.paperEligible, true)
    assert.equal(snapshot.strategyArtifact.liveEligible, true)
    assert.equal(snapshot.strategyArtifact.promotionEligible, true)
    assert.equal(snapshot.strategyArtifact.digestSha256, strategyArtifact.digestSha256)
    assert.equal(
      snapshot.strategyArtifact.strategyArtifactCoreDigestSha256,
      sealedStrategyArtifactDigestSha256,
    )
    assert.equal(snapshot.marketValidation.targetDate, date)
    assert.equal(snapshot.marketValidation.latestCommonDate, snapshot.marketValidation.latestIndexDate)
    assert.equal(snapshot.marketValidation.recentIndexSessionsValidated, 42)
    assert.ok(snapshot.marketValidation.commonSessionCount >= 42)
    if (!options.skipPositionParity) {
      const expectedPosition = options.expectedPosition ?? result.selected.find((row) => row.entryTradeDate === date)?.ungPosition
      assert.notEqual(expectedPosition, undefined, `Missing expected live target for ${date}`)
      close(snapshot.target.gasPosition, expectedPosition, 0.001)
    }
    assert.deepEqual(snapshot.forecastValidation.requiredSources, expectedSources)
    if (options.expectedLatestIssueDate) assert.equal(snapshot.forecastValidation.latestCommonIssueDate, options.expectedLatestIssueDate)
    if (options.expectedMarket) {
      for (const [key, value] of Object.entries(options.expectedMarket)) assert.deepEqual(snapshot.marketValidation[key], value, `Unexpected marketValidation.${key}`)
    }
    if (options.expectedStorage) {
      assert.equal(snapshot.storageValidation.latestInputDate, options.expectedStorage.latestInputDate)
      assert.equal(snapshot.storageValidation.latestPolledDate, options.expectedStorage.latestInputDate)
      assert.equal(snapshot.storageValidation.latestPolledStorageBcf, options.expectedStorage.storageBcf)
      assert.equal(snapshot.target.diagnostics.storage.storageDate, options.expectedStorage.storageDate)
      assert.equal(snapshot.target.diagnostics.storage.allowed, options.expectedStorage.allowed)
    }
    if (options.marketCollectorBaseUrl) {
      const historyDir = path.join(scratch, 'market-history')
      const manifest = JSON.parse(await readFile(path.join(historyDir, 'manifest.json'), 'utf8'))
      assert.equal(manifest.targetDate, date)
      assert.equal(manifest.completedSessionCutoffExclusive, date)
      assert.equal(manifest.authoritativeSessionsValidated, 42)
      for (const file of ['NG-F-qore-market.csv', 'UNG-qore-market.csv', 'VOO-qore-market.csv', 'QQQM-qore-market.csv', 'US-INDEX-BASKET-qore-market.csv', 'manifest.json']) {
        assert.equal((await stat(path.join(historyDir, file))).mode & 0o777, 0o600, `${file} must be mode 0600`)
        if (file.endsWith('.csv')) {
          assert.equal((await csv(path.join(historyDir, file))).some((row) => row.date === date), false, `${file} retained the target-date bar`)
        }
      }
      assert.equal(snapshot.marketValidation.historySource, 'Yahoo chart API')
      assert.equal(snapshot.marketValidation.completedSessionCutoffExclusive, date)
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function nonPromotedStrategyArtifactFailsClosed() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-live-artifact-gate-'))
  try {
    const strategyArtifactPath = path.join(scratch, 'needs-validation-run-summary.json')
    await writeStrategyArtifactFixture(strategyArtifactPath, { eligible: false })
    const run = await runNode(['scripts/qore-live-strategy-inference.mjs'], {
      QORE_LIVE_INFERENCE_STATE_DIR: scratch,
      QORE_LIVE_INFERENCE_FILE: path.join(scratch, 'target.json'),
      QORE_LIVE_INFERENCE_SKIP_FETCH: '1',
      QORE_LIVE_STRATEGY_ARTIFACT_FILE: strategyArtifactPath,
    })
    assert.equal(run.code, 1)
    assert.match(run.stderr, /artifact is not paper-eligible:.*status must equal research-baseline/)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function mismatchedLiveComponentContractFailsClosed() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-live-contract-gate-'))
  try {
    const strategyArtifactPath = path.join(scratch, 'mismatched-live-contract-run-summary.json')
    const { fixture } = await writeStrategyArtifactFixture(strategyArtifactPath, { eligible: true })
    fixture.contract.liveInference.componentContract.summer.selected.weatherFraction = 0.4
    fixture.contract.liveInference.componentContractDigestSha256 = liveComponentContractDigestSha256(
      fixture.contract.liveInference.componentContract,
    )
    await writeFile(strategyArtifactPath, `${JSON.stringify(fixture, null, 2)}\n`)
    const run = await runNode(['scripts/qore-live-strategy-inference.mjs'], {
      QORE_LIVE_INFERENCE_STATE_DIR: scratch,
      QORE_LIVE_INFERENCE_FILE: path.join(scratch, 'target.json'),
      QORE_LIVE_INFERENCE_SKIP_FETCH: '1',
      QORE_LIVE_STRATEGY_ARTIFACT_FILE: strategyArtifactPath,
    })
    assert.equal(run.code, 1)
    assert.match(run.stderr, /reviewed component contract digest does not match the executable live contract/)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function mismatchedValidationIntegrityFailsClosed() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-validation-integrity-gate-'))
  try {
    const strategyArtifactPath = path.join(scratch, 'mismatched-validation-integrity-run-summary.json')
    const { fixture } = await writeStrategyArtifactFixture(strategyArtifactPath, { eligible: true })
    fixture.validation.integrity.manifestDigestSha256 = '0'.repeat(64)
    await writeFile(strategyArtifactPath, `${JSON.stringify(fixture, null, 2)}\n`)
    const run = await runNode(['scripts/qore-live-strategy-inference.mjs'], {
      QORE_LIVE_INFERENCE_STATE_DIR: scratch,
      QORE_LIVE_INFERENCE_FILE: path.join(scratch, 'target.json'),
      QORE_LIVE_INFERENCE_SKIP_FETCH: '1',
      QORE_LIVE_STRATEGY_ARTIFACT_FILE: strategyArtifactPath,
    })
    assert.equal(run.code, 1)
    assert.match(run.stderr, /validation integrity manifestDigestSha256 does not match the reviewed manifest/)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function mismatchedBrokerExecutionProfileFailsClosed() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-broker-profile-gate-'))
  try {
    const strategyArtifactPath = path.join(scratch, 'mismatched-broker-profile-run-summary.json')
    const { fixture } = await writeStrategyArtifactFixture(strategyArtifactPath, { eligible: true })
    fixture.contract.brokerExecution.profile.sizing.minOrderUsd += 1
    await writeFile(strategyArtifactPath, `${JSON.stringify(fixture, null, 2)}\n`)
    const run = await runNode(['scripts/qore-live-strategy-inference.mjs'], {
      QORE_LIVE_INFERENCE_STATE_DIR: scratch,
      QORE_LIVE_INFERENCE_FILE: path.join(scratch, 'target.json'),
      QORE_LIVE_INFERENCE_SKIP_FETCH: '1',
      QORE_LIVE_STRATEGY_ARTIFACT_FILE: strategyArtifactPath,
    })
    assert.equal(run.code, 1)
    assert.match(run.stderr, /broker execution profile digest does not match the canonical profile stored in the artifact/)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function liveFetchCoverage() {
  if (!process.argv.includes('--live-fetch')) return 0
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-live-source-fetch-'))
  const issueDate = '2026-07-01'
  const targetDate = addDays(issueDate, 10)
  const weatherDirs = {
    gfs: 'noaa-gfs',
    'gefs-mean': 'noaa-gefs',
    graphcastgfs: 'gfs-graphcast',
    aigfs: 'aigfs',
    'ecmwf-ifs': 'ecmwf-ifs',
    'ecmwf-aifs': 'ecmwf-aifs',
    'gem-global': 'gem-global',
  }
  try {
    for (const sourceId of selectedContracts.winterFollow.liveHeatingDemandSourceIds) {
      const outputRoot = path.join(scratch, sourceId)
      const run = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
        QORE_FORECAST_SOURCE: sourceId,
        QORE_GFS_RUN_HOUR: '00',
        QORE_GFS_CALENDAR_START: issueDate,
        QORE_GFS_CALENDAR_ISSUE_END: issueDate,
        QORE_GFS_CALENDAR_END: targetDate,
        QORE_GFS_LEAD_DAYS: '10',
        QORE_GFS_HEATING_SEASON_ONLY: '0',
        QORE_GFS_COOLING_SEASON_ONLY: '0',
        QORE_GFS_MAX_ITEMS: '1',
        QORE_GFS_CONCURRENCY: '1',
        QORE_FETCH_TIMEOUT_MS: '45000',
        QORE_GFS_OUTPUT_ROOT: outputRoot,
      })
      assert.equal(run.code, 0, `${sourceId} live fetch failed: ${run.stderr || run.stdout}`)
      const base = `${sourceId}-00z-daily-forecast-calendar-${issueDate}-${targetDate}-leads-10-hours-0`
      const scores = await csv(path.join(outputRoot, 'research', `${base}-signal-scores.csv`))
      const locations = await csv(path.join(outputRoot, 'weather', weatherDirs[sourceId], `${base}-location-anomalies.csv`))
      assert.equal(scores.length, 1, `${sourceId} did not produce one complete live score`)
      assert.equal(locations.length, 18, `${sourceId} did not produce complete live demand inputs`)
    }
    return selectedContracts.winterFollow.liveHeatingDemandSourceIds.length
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function portableGribPlatformBranch() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-portable-grib-'))
  const packageRoot = path.dirname(require.resolve('grib-js'))
  const gribBytes = await readFile(path.join(packageRoot, 'samples', 'regular_latlon_surface.grib2'))
  const server = createServer((request, response) => {
    if (request.url === '/fixture.idx') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end(`1:0:d=2026010100:TMP:2 m above ground:24 hour fcst:\n2:${gribBytes.length}:d=2026010100:RH:2 m above ground:24 hour fcst:\n`)
      return
    }
    if (request.url === '/fixture') {
      response.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-range': `bytes 0-${gribBytes.length - 1}/${gribBytes.length}`,
      })
      response.end(gribBytes)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const outputRoot = path.join(scratch, 'output')
    const run = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
      QORE_GFS_PORTABLE_GRIB_PARSER: '1',
      QORE_GFS_OBJECT_BASE: `http://127.0.0.1:${address.port}/fixture`,
      QORE_GFS_CALENDAR_START: '2026-01-01',
      QORE_GFS_CALENDAR_ISSUE_END: '2026-01-01',
      QORE_GFS_CALENDAR_END: '2026-01-02',
      QORE_GFS_LEAD_DAYS: '1',
      QORE_GFS_OUTPUT_BASENAME: 'portable-grib-regression',
      QORE_GFS_OUTPUT_ROOT: outputRoot,
      QORE_GFS_CONCURRENCY: '1',
    })
    assert.equal(run.code, 0, run.stderr || run.stdout)
    const rows = await csv(path.join(outputRoot, 'weather/noaa-gfs/portable-grib-regression-location-anomalies.csv'))
    assert.equal(rows.length, 18)
    assert.ok(rows.every((row) => Number.isFinite(Number(row.forecastMeanF))))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(scratch, { recursive: true, force: true })
  }
}

async function allYearInstrumentContract() {
  const artifactDir = path.join(dataRoot, 'research', 'strategy-agent-runs', 'ngas-all-year-beta')
  const summary = JSON.parse(await readFile(path.join(artifactDir, 'run-summary.json'), 'utf8'))
  const rows = await csv(path.join(artifactDir, 'selected-trades.csv'))
  assert.equal(summary.contract.researchInstruments.summer.gasSymbol, 'UNG')
  assert.equal(summary.contract.researchInstruments.summer.signalSymbol, 'NG=F')
  assert.equal(summary.contract.researchInstruments.winter.gasSymbol, 'UNG')
  assert.equal(summary.contract.researchInstruments.winter.signalSymbol, 'UNG')
  assert.equal(summary.contract.executionInstrument.gasSymbol, 'UNG')
  assert.ok(rows.every((row) => row.researchInstrument))
  assert.ok(rows.filter((row) => row.componentStrategyId === 'ngas-summer-alpha' && row.thesisKind !== 'index-fallback')
    .every((row) => row.researchInstrument === 'UNG' && row.signalInstrument === 'NG=F'))
  assert.ok(rows.filter((row) => row.componentStrategyId === 'ngas-winter-alpha' && row.thesisKind !== 'index-fallback')
    .every((row) => row.researchInstrument === 'UNG'))
  assert.ok(rows.filter((row) => row.thesisKind === 'index-fallback')
    .every((row) => row.researchInstrument === 'US-INDEX-BASKET'))
}

await portableGribPlatformBranch()
await nonPromotedStrategyArtifactFailsClosed()
await mismatchedLiveComponentContractFailsClosed()
await mismatchedValidationIntegrityFailsClosed()
await mismatchedBrokerExecutionProfileFailsClosed()
await allYearInstrumentContract()
const summer = await summerParity()
const winter = await winterParity()
await summerStorageReleaseCalendarBoundary(summer)
await winterStorageReleaseCalendarBoundary(winter)
const summerPositions = await positionParity(summer, 'NG-F-qore-market.csv', 'summer')
const winterPositions = await positionParity(winter, 'UNG-qore-market.csv', 'winter')
await liveMarketBoundary(summer)
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
  expectedMarket: {
    gasSymbol: 'NG=F', latestGasDate: '2024-04-24', latestIndexDate: '2024-04-24',
    latestCommonDate: '2024-04-24', marketAgeDays: 1, maxMarketAgeDays: 4, provisionalTargetDate: '2024-04-25',
  },
})
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
  replacedLocationSources: ['gfs'],
  expectedError: /stale or incomplete/,
})
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
  reweightedLocationSources: ['gfs'],
  expectedError: /stale or incomplete/,
})
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
  marketFixture: { gasEndDate: '2024-04-19', indexEndDate: '2024-04-19' },
  expectedError: /cannot verify intervening weekday session\(s\).*2024-04-22, 2024-04-23, 2024-04-24/,
})
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
  marketFixture: { gasEndDate: '2024-04-23', indexEndDate: '2024-04-25' },
  expectedError: /missing a valid NG=F row for recent index session\(s\): 2024-04-24/,
})
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
  marketFixture: { duplicateGasDate: '2024-04-24' },
  expectedError: /NG=F market history contains duplicate date 2024-04-24/,
})
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
  marketFixture: { startDate: '2024-03-15' },
  expectedError: /Market history has only \d+ index sessions through 2024-04-25; at least 42 are required/,
})
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
  marketFixture: { gasEndDate: '2024-04-19', indexEndDate: '2024-04-19', maxAgeDays: 7 },
  expectedError: /cannot verify intervening weekday session\(s\).*2024-04-22, 2024-04-23, 2024-04-24/,
})
await liveLoaderParity(summer, '2024-05-05', selectedContracts.summer.sourceIds, {
  marketFixture: {
    gasEndDate: '2024-05-03', indexEndDate: '2024-05-03',
    extraGasDate: { sourceDate: '2024-05-03', date: '2024-05-05' },
  },
  expectedMarket: {
    latestGasDate: '2024-05-03', latestIndexDate: '2024-05-03', latestCommonDate: '2024-05-03',
    marketAgeDays: 2, provisionalTargetDate: null,
  },
  skipPositionParity: true,
})
const yahooFixture = await startYahooDailyFixture('2024-04-25')
try {
  await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds, {
    marketCollectorBaseUrl: yahooFixture.baseUrl,
    expectedMarket: {
      latestGasDate: '2024-04-24', latestIndexDate: '2024-04-24', latestCommonDate: '2024-04-24',
      marketAgeDays: 1, provisionalTargetDate: '2024-04-25', historySource: 'Yahoo chart API',
    },
    skipPositionParity: true,
  })
  assert.deepEqual(new Set(yahooFixture.requests), new Set(['NG=F', 'UNG', 'VOO', 'QQQM']))
} finally {
  await yahooFixture.close()
}
const completeWinterFixtures = {
  'ecmwf-aifs': 'ecmwf-ifs',
  // The versioned GEM archive has only the long leads; use a complete seven-lead
  // calendar to exercise the live collector's all-lead contract for this fixture.
  'gem-global': 'gfs',
}
await liveLoaderParity(winter, '2026-01-27', selectedContracts.winterFollow.liveSourceIds, {
  fixtureSources: completeWinterFixtures,
  skipPositionParity: true,
})
await liveLoaderParity(winter, '2026-01-27', selectedContracts.winterFollow.liveSourceIds, {
  fixtureSources: completeWinterFixtures,
  staticStorageEndDate: '2026-01-09',
  eiaSnapshot: {
    generatedAt: '2026-01-22T15:00:00.000Z',
    source: 'EIA Open Data API',
    latestStorage: { date: '2026-01-16', storageBcf: 3900, unit: 'Bcf', source: 'EIA Open Data API' },
    storageRows: [{ date: '2026-01-16', storageBcf: 3900, unit: 'Bcf', source: 'EIA Open Data API' }],
  },
  expectedStorage: { latestInputDate: '2026-01-16', storageDate: '2026-01-16', storageBcf: 3900, allowed: true },
  skipPositionParity: true,
})
await liveLoaderParity(winter, '2026-01-27', selectedContracts.winterFollow.liveSourceIds, {
  fixtureSources: completeWinterFixtures,
  omittedSources: ['aigfs'],
  expectedError: /stale or incomplete/,
})
await liveLoaderParity(winter, '2026-01-27', selectedContracts.winterFollow.liveSourceIds, {
  fixtureSources: completeWinterFixtures,
  partialLocationSources: ['aigfs'],
  expectedError: /stale or incomplete/,
})
await liveLoaderParity(winter, '2026-01-27', selectedContracts.winterFollow.liveSourceIds, {
  fixtureSources: completeWinterFixtures,
  partialLocationSources: ['ecmwf-aifs'],
  expectedError: /stale or incomplete/,
})
await liveLoaderParity(winter, '2026-03-10', selectedContracts.winterFollow.liveSourceIds, {
  fixtureSources: completeWinterFixtures,
  issueEndDates: {
    gfs: '2026-03-09', 'gefs-mean': '2026-03-09', aigfs: '2026-03-08',
    'ecmwf-ifs': '2026-03-08', 'ecmwf-aifs': '2026-03-08',
  },
  expectedLatestIssueDate: '2026-03-08',
  skipPositionParity: true,
})
const liveFetchSources = await liveFetchCoverage()
console.log(`live-inference parity passed summerSignals=${summer.count} winterSignals=${winter.count} summerPositions=${summerPositions} winterPositions=${winterPositions} liveFetchSources=${liveFetchSources}`)
await rm(validationFixtureDir, { recursive: true, force: true })
