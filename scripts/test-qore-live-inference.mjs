#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSignal, enrichForecastRows, inferAllYearTarget, selectedContracts } from './lib/qore-live-all-year-inference.mjs'

process.env.NODE_ENV = 'test'

const root = process.cwd()
const dataRoot = path.join(root, 'data', 'qore')
const require = createRequire(import.meta.url)

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

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
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

async function dropLocation(filePath, locationId) {
  const [header, ...lines] = (await readFile(filePath, 'utf8')).trim().split(/\r?\n/)
  const locationIndex = parseLine(header).indexOf('locationId')
  const kept = lines.filter((line) => parseLine(line)[locationIndex] !== locationId)
  await writeFile(filePath, `${header}\n${kept.join('\n')}${kept.length ? '\n' : ''}`)
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
  const scores = []; const locations = []
  for (const calendar of manifest.forecastCalendars) {
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
      await writeCsvWindow(path.join(dataRoot, fixtureCalendar.files.signalScores), path.join(forecastRoot, 'research', `${base}-signal-scores.csv`), addDays(date, -16), issueEndDate)
      const locationPath = path.join(forecastRoot, 'weather', weatherDirs[calendar.id], `${base}-location-anomalies.csv`)
      await writeCsvWindow(path.join(dataRoot, fixtureCalendar.files.locationAnomalies), locationPath, addDays(date, -16), issueEndDate)
      if (options.partialLocationSources?.includes(calendar.id)) await dropLocation(locationPath, 'minneapolis')
      await writeFile(path.join(forecastRoot, 'weather', weatherDirs[calendar.id], `${base}-manifest.json`), `${JSON.stringify({ forecastSource: calendar.id, generatedAt: `${date}T12:00:00.000Z`, failures: [] })}\n`)
    }
    const outputPath = path.join(scratch, 'target.json')
    const env = {
      QORE_LIVE_INFERENCE_STATE_DIR: scratch,
      QORE_LIVE_INFERENCE_FILE: outputPath,
      QORE_LIVE_INFERENCE_DATE: date,
      QORE_LIVE_INFERENCE_SKIP_FETCH: '1',
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
    if (!options.skipPositionParity) {
      const expectedPosition = options.expectedPosition ?? result.selected.find((row) => row.entryTradeDate === date)?.ungPosition
      assert.notEqual(expectedPosition, undefined, `Missing expected live target for ${date}`)
      close(snapshot.target.gasPosition, expectedPosition, 0.001)
    }
    assert.deepEqual(snapshot.forecastValidation.requiredSources, expectedSources)
    if (options.expectedLatestIssueDate) assert.equal(snapshot.forecastValidation.latestCommonIssueDate, options.expectedLatestIssueDate)
    if (options.expectedStorage) {
      assert.equal(snapshot.storageValidation.latestInputDate, options.expectedStorage.latestInputDate)
      assert.equal(snapshot.storageValidation.latestPolledDate, options.expectedStorage.latestInputDate)
      assert.equal(snapshot.storageValidation.latestPolledStorageBcf, options.expectedStorage.storageBcf)
      assert.equal(snapshot.target.diagnostics.storage.storageDate, options.expectedStorage.storageDate)
      assert.equal(snapshot.target.diagnostics.storage.allowed, options.expectedStorage.allowed)
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function liveFetchCoverage() {
  if (!process.argv.includes('--live-fetch')) return 0
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-live-source-fetch-'))
  const issueDate = '2026-07-01'
  const targetDate = addDays(issueDate, 10)
  const weatherDirs = { gfs: 'noaa-gfs', 'gefs-mean': 'noaa-gefs', aigfs: 'aigfs', 'ecmwf-ifs': 'ecmwf-ifs', 'ecmwf-aifs': 'ecmwf-aifs' }
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
  assert.equal(summary.contract.researchInstruments.summer.gasSymbol, 'NG=F')
  assert.equal(summary.contract.researchInstruments.winter.gasSymbol, 'UNG')
  assert.equal(summary.contract.executionInstrument.gasSymbol, 'UNG')
  assert.ok(rows.every((row) => row.researchInstrument))
  assert.ok(rows.filter((row) => row.componentStrategyId === 'ngas-summer-alpha' && row.thesisKind !== 'index-fallback')
    .every((row) => row.researchInstrument === 'NG=F'))
  assert.ok(rows.filter((row) => row.componentStrategyId === 'ngas-winter-alpha' && row.thesisKind !== 'index-fallback')
    .every((row) => row.researchInstrument === 'UNG'))
  assert.ok(rows.filter((row) => row.thesisKind === 'index-fallback')
    .every((row) => row.researchInstrument === 'US-INDEX-BASKET'))
}

await portableGribPlatformBranch()
await allYearInstrumentContract()
const summer = await summerParity()
const winter = await winterParity()
const summerPositions = await positionParity(summer, 'NG-F-qore-market.csv', 'summer')
const winterPositions = await positionParity(winter, 'UNG-qore-market.csv', 'winter')
await liveMarketBoundary(summer)
await liveLoaderParity(summer, '2024-04-25', selectedContracts.summer.sourceIds)
const completeWinterFixtures = { 'ecmwf-aifs': 'ecmwf-ifs' }
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
  expectedStorage: { latestInputDate: '2026-01-16', storageDate: '2026-01-16', storageBcf: 3900, allowed: false },
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
  skipPositionParity: true,
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
