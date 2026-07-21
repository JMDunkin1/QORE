#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadLocalEnv } from './local-env.mjs'
import { assertEiaStorageReleaseCalendarCoverage } from './lib/eia-release-time.mjs'
import {
  enrichForecastRows,
  inferAllYearTarget,
  inferSummerShadowTarget,
  numberFrom,
  round,
  selectedContracts,
} from './lib/qore-live-all-year-inference.mjs'
import {
  SUMMER_SHADOW_CHALLENGER,
  appendSummerShadowTargetRecord,
  createSummerShadowTargetRecord,
  summerShadowCompatibilityFailures,
  summerShadowValueDigestSha256,
} from './lib/qore-summer-shadow-challenger.mjs'
import { summarizeSummerForecastLocationBreadth } from './lib/qore-summer-forecast-coverage.mjs'
import {
  assertPaperEligibleStrategyArtifact,
  assertStrategyArtifactContractIntegrity,
} from './lib/qore-live-strategy-artifact.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)
const shadowOnly = process.argv.includes('--summer-shadow')
const dataRoot = path.join(repoDir, 'data', 'qore')
const stateDir = path.resolve(process.env.QORE_LIVE_INFERENCE_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'live-inference'))
const forecastRoot = path.join(stateDir, 'noaa-calendar')
const outputPath = path.resolve(process.env.QORE_LIVE_INFERENCE_FILE ?? path.join(stateDir, 'all-year-target.json'))
const summerShadowStateDir = path.resolve(
  process.env.QORE_SUMMER_SHADOW_STATE_DIR
    ?? path.join(repoDir, '.local', 'qore', 'shadow-validation', SUMMER_SHADOW_CHALLENGER.contractId, 'targets'),
)
const marketHistoryStateDir = path.resolve(
  process.env.QORE_LIVE_MARKET_HISTORY_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'live-market-history'),
)
const configuredGasMarketPath = process.env.QORE_LIVE_INFERENCE_GAS_MARKET_FILE
  ? path.resolve(process.env.QORE_LIVE_INFERENCE_GAS_MARKET_FILE)
  : null
const configuredIndexMarketPath = process.env.QORE_LIVE_INFERENCE_INDEX_MARKET_FILE
  ? path.resolve(process.env.QORE_LIVE_INFERENCE_INDEX_MARKET_FILE)
  : null
const storageFilePath = path.resolve(
  process.env.QORE_LIVE_INFERENCE_STORAGE_FILE ?? path.join(dataRoot, 'fundamentals', 'eia', 'working-gas-storage-lower48-weekly.csv'),
)
const eiaSnapshotPath = process.env.QORE_LIVE_INFERENCE_EIA_SNAPSHOT_FILE
  ? path.resolve(process.env.QORE_LIVE_INFERENCE_EIA_SNAPSHOT_FILE)
  : null
const today = process.env.QORE_LIVE_INFERENCE_DATE ?? new Date().toISOString().slice(0, 10)
const lookbackDays = Math.max(10, Number(process.env.QORE_LIVE_INFERENCE_LOOKBACK_DAYS ?? 16))
const fetchTimeoutMs = Number(process.env.QORE_LIVE_INFERENCE_FETCH_TIMEOUT_MS ?? 45_000)
const minimumMarketSessions = 42
const maxMarketAgeDays = Number(process.env.QORE_LIVE_INFERENCE_MAX_MARKET_AGE_DAYS ?? 4)
const month = Number(today.slice(5, 7))
const summer = (month >= 5 && month <= 9) || [5, 6, 7, 8, 9].includes(Number(addDays(today, 7).slice(5, 7)))
const requiredSources = summer ? selectedContracts.summer.sourceIds : selectedContracts.winterFollow.liveSourceIds
const collectedSources = summer ? requiredSources : selectedContracts.winterFollow.liveHeatingDemandSourceIds
const requiredLeads = summer ? [7] : [1, 2, 3, 7, 8, 9, 10]

function addDays(date, count) { return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10) }
function truthy(value) { return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase()) }
function targetProjection(target) {
  return {
    strategyId: target.strategyId,
    componentStrategyId: target.componentStrategyId,
    candidateId: target.candidateId ?? null,
    executionEligible: target.executionEligible ?? true,
    targetDate: target.targetDate,
    direction: target.direction,
    gasPosition: target.gasPosition,
    indexFraction: target.indexFraction,
    cashFraction: target.cashFraction,
    signalDate: target.signalDate,
    confidence: target.confidence,
    windowId: target.windowId,
    thesisKind: target.thesisKind,
    sourceIds: target.sourceIds,
    weightedAnomalyF: target.weightedAnomalyF,
    realizedMovePct: target.realizedMovePct ?? null,
  }
}
function interveningWeekdays(startDate, endDate) {
  const dates = []
  for (let date = addDays(startDate, 1); date < endDate; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    if (weekday > 0 && weekday < 6) dates.push(date)
  }
  return dates
}
function parseCsvLine(line) {
  const values = []; let value = ''; let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]; const next = line[index + 1]
    if (char === '"' && quoted && next === '"') { value += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { values.push(value); value = '' }
    else value += char
  }
  values.push(value); return values
}
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}
async function readCsv(filePath) { return existsSync(filePath) ? parseCsv(await readFile(filePath, 'utf8')) : [] }
async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n')
  await rename(temporary, filePath)
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoDir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-12000) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve({ code, stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${(stderr || stdout).trim()}`)))
  })
}
function sourcePaths(sourceId) {
  const weatherDir = {
    gfs: 'noaa-gfs', 'gefs-mean': 'noaa-gefs', graphcastgfs: 'gfs-graphcast', aigfs: 'aigfs',
    'ecmwf-ifs': 'ecmwf-ifs', 'ecmwf-aifs': 'ecmwf-aifs', 'gem-global': 'gem-global',
  }[sourceId]
  if (!weatherDir) throw new Error(`Unsupported live inference source: ${sourceId}`)
  const base = `qore-live-${sourceId}-00z`
  return {
    base,
    score: path.join(forecastRoot, 'research', `${base}-signal-scores.csv`),
    locations: path.join(forecastRoot, 'weather', weatherDir, `${base}-location-anomalies.csv`),
    manifest: path.join(forecastRoot, 'weather', weatherDir, `${base}-manifest.json`),
  }
}
async function collectNoaa(sourceId) {
  const paths = sourcePaths(sourceId)
  const result = await run(process.execPath, ['scripts/build-gfs-forecast-calendar.mjs'], {
    QORE_FORECAST_SOURCE: sourceId,
    QORE_GFS_RUN_HOUR: '00',
    QORE_GFS_CALENDAR_START: addDays(today, -lookbackDays),
    QORE_GFS_CALENDAR_ISSUE_END: today,
    QORE_GFS_CALENDAR_END: addDays(today, 10),
    QORE_GFS_LEAD_DAYS: requiredLeads.join(','),
    QORE_GFS_HEATING_SEASON_ONLY: '0',
    QORE_GFS_COOLING_SEASON_ONLY: '0',
    QORE_GFS_RESUME: '1',
    QORE_GFS_ALLOW_PARTIAL: '1',
    QORE_GFS_CONCURRENCY: process.env.QORE_LIVE_INFERENCE_FETCH_CONCURRENCY ?? '4',
    QORE_FETCH_TIMEOUT_MS: String(fetchTimeoutMs),
    QORE_GFS_OUTPUT_ROOT: forecastRoot,
    QORE_GFS_OUTPUT_BASENAME: paths.base,
  })
  return { sourceId, paths, result }
}
function forecastRowKey(row) {
  return [row.sourceId, row.issueDate, row.targetDate, row.leadDays, row.modelId].join('|')
}
async function loadForecastRows() {
  const scores = []; const locations = []; const manifests = []
  for (const sourceId of collectedSources) {
    const paths = sourcePaths(sourceId)
    for (const row of await readCsv(paths.score)) scores.push({ ...row, sourceId })
    for (const row of await readCsv(paths.locations)) locations.push({ ...row, sourceId })
    if (existsSync(paths.manifest)) manifests.push(JSON.parse(await readFile(paths.manifest, 'utf8')))
  }
  const locationCoverage = new Map()
  for (const row of locations) {
    const key = forecastRowKey(row)
    locationCoverage.set(key, [...(locationCoverage.get(key) ?? []), row])
  }
  const rows = enrichForecastRows(scores, locations, summer ? 'summer' : 'winter').map((row) => {
    const coverageRows = locationCoverage.get(forecastRowKey(row)) ?? []
    const sampledWeight = coverageRows.reduce((sum, location) => sum + numberFrom(location.weight), 0)
    const exactSummerLocationUniverse = !summer
      || summarizeSummerForecastLocationBreadth(coverageRows).complete
    const demandInputsComplete = coverageRows.length === numberFrom(row.locationCount)
      && Math.abs(sampledWeight - numberFrom(row.sampledWeight)) < 1e-6
      && exactSummerLocationUniverse
    return { ...row, demandInputsComplete }
  })
  return { rows, manifests }
}
async function marketDays() {
  const fileName = summer ? 'NG-F-qore-market.csv' : 'UNG-qore-market.csv'
  const gasFilePath = configuredGasMarketPath ?? path.join(marketHistoryStateDir, fileName)
  const indexFilePath = configuredIndexMarketPath ?? path.join(marketHistoryStateDir, 'US-INDEX-BASKET-qore-market.csv')
  let marketHistoryManifest = null
  if (!configuredGasMarketPath) {
    const manifestPath = path.join(marketHistoryStateDir, 'manifest.json')
    if (!existsSync(manifestPath)) throw new Error(`Live market-history manifest is unavailable: ${manifestPath}. Run npm run trade:market-history.`)
    marketHistoryManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (marketHistoryManifest.serviceId !== 'qore-live-market-history' || marketHistoryManifest.targetDate !== today
      || marketHistoryManifest.completedSessionCutoffExclusive !== today) {
      throw new Error(`Live market-history manifest is not valid for target ${today}. Run npm run trade:market-history.`)
    }
  }
  if (!Number.isFinite(maxMarketAgeDays) || maxMarketAgeDays < 0) {
    throw new Error(`QORE_LIVE_INFERENCE_MAX_MARKET_AGE_DAYS must be a non-negative number; received ${process.env.QORE_LIVE_INFERENCE_MAX_MARKET_AGE_DAYS}.`)
  }
  const throughTarget = (sourceRows, label) => {
    const rows = sourceRows.filter((row) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '') || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`))) {
        throw new Error(`${label} market history contains an invalid date: ${row.date || 'missing'}.`)
      }
      // The target-date daily bar may still be in progress. Even after the close,
      // the causal target is built only from sessions completed before targetDate.
      return row.date < today
    }).sort((left, right) => left.date.localeCompare(right.date))
    const seen = new Set()
    for (const row of rows) {
      if (seen.has(row.date)) throw new Error(`${label} market history contains duplicate date ${row.date}.`)
      seen.add(row.date)
    }
    return rows
  }
  const gasRows = throughTarget(await readCsv(gasFilePath), summer ? 'NG=F' : 'UNG')
  const indexRows = throughTarget(await readCsv(indexFilePath), 'US-INDEX-BASKET')
  const validGasByDate = new Map(gasRows.filter((row) => numberFrom(row.close) > 0).map((row) => [row.date, row]))
  const recentIndexRows = indexRows.slice(-minimumMarketSessions)
  if (recentIndexRows.length < minimumMarketSessions) {
    throw new Error(`Market history has only ${recentIndexRows.length} index sessions through ${today}; at least ${minimumMarketSessions} are required.`)
  }
  const missingRecentGasDates = recentIndexRows.filter((row) => !validGasByDate.has(row.date)).map((row) => row.date)
  if (missingRecentGasDates.length) {
    throw new Error(`Market history is missing a valid ${summer ? 'NG=F' : 'UNG'} row for recent index session(s): ${missingRecentGasDates.join(', ')}.`)
  }
  const indexDates = new Set(indexRows.map((row) => row.date))
  const rows = gasRows.filter((row) => indexDates.has(row.date) && numberFrom(row.close) > 0)
    .map((row) => ({ date: row.date, gasClose: numberFrom(row.close) }))
  if (rows.length < minimumMarketSessions) {
    throw new Error(`Market history has only ${rows.length} common sessions through ${today}; at least ${minimumMarketSessions} are required.`)
  }
  const latestIndexDate = indexRows.at(-1)?.date ?? null
  const latestCommonDate = rows.at(-1)?.date ?? null
  if (!latestIndexDate || latestCommonDate !== latestIndexDate) {
    throw new Error(`Market history latest common date (${latestCommonDate ?? 'none'}) does not match latest index date (${latestIndexDate ?? 'none'}).`)
  }
  const missingInterveningWeekdays = interveningWeekdays(latestCommonDate, today)
  if (missingInterveningWeekdays.length) {
    throw new Error(`Market history cannot verify intervening weekday session(s) after latest shared close ${latestCommonDate} and before target ${today}: ${missingInterveningWeekdays.join(', ')}.`)
  }
  const marketAgeDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latestCommonDate}T00:00:00Z`)) / 86400000
  // Calendar age remains a second cap. Weekdays are conservatively assumed to be
  // sessions, so an exchange holiday blocks until the rolling history verifies a
  // later completed close instead of being silently bridged.
  if (!Number.isFinite(marketAgeDays) || marketAgeDays < 0 || marketAgeDays > maxMarketAgeDays) {
    throw new Error(`Market history is stale: latest shared close ${latestCommonDate} is ${round(marketAgeDays, 2)} calendar days before ${today} (maximum ${maxMarketAgeDays}).`)
  }
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const provisionalTargetDate = weekday > 0 && weekday < 6 && latestCommonDate < today ? today : null
  if (provisionalTargetDate) rows.push({ date: today, gasClose: rows.at(-1).gasClose, provisional: true })
  return {
    rows,
    validation: {
      gasSymbol: summer ? 'NG=F' : 'UNG', indexSymbol: 'US-INDEX-BASKET', targetDate: today,
      minimumCommonSessions: minimumMarketSessions, commonSessionCount: rows.length - (provisionalTargetDate ? 1 : 0),
      latestGasDate: gasRows.filter((row) => numberFrom(row.close) > 0).at(-1)?.date ?? null,
      latestIndexDate, latestCommonDate, marketAgeDays: round(marketAgeDays, 2), maxMarketAgeDays,
      recentIndexSessionsValidated: recentIndexRows.length, provisionalTargetDate,
      completedSessionCutoffExclusive: today,
      unverifiedInterveningWeekdays: missingInterveningWeekdays,
      calendarPolicy: 'Every intervening weekday is conservatively treated as an expected exchange session; holidays fail closed until a later completed close is verified.',
      historySource: configuredGasMarketPath ? 'configured-files' : marketHistoryManifest?.source ?? 'qore-live-market-history',
      historyGeneratedAt: marketHistoryManifest?.generatedAt ?? null,
    },
  }
}
function completeIssueDates(rows) {
  const byIssue = new Map()
  for (const row of rows) {
    if (!row.demandInputsComplete) continue
    const key = row.issueDate
    const entry = byIssue.get(key) ?? new Map()
    entry.set(`${row.sourceId}|${row.leadDays}`, true); byIssue.set(key, entry)
  }
  return [...byIssue.entries()].filter(([, keys]) => collectedSources.every((source) => requiredLeads.every((lead) => keys.has(`${source}|${lead}`))))
    .map(([date]) => date).sort()
}

async function loadActualWeatherRows() {
  const configured = process.env.QORE_LIVE_ACTUAL_WEATHER_FILE
  if (configured) return readCsv(path.resolve(configured))
  const manifestPath = path.join(dataRoot, 'runs', 'free-data-manifest.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const files = manifest.weather?.actualArcticBlastEvents?.flatMap((entry) => entry.files ?? []) ?? []
    const daily = files.filter((file) => path.basename(file).startsWith('arctic-blast-actual-daily-')).sort().at(-1)
    if (daily) return readCsv(path.resolve(repoDir, daily))
  }
  return readCsv(path.join(dataRoot, 'weather', 'events', 'arctic-blast-actual-daily-2021-01-01-2026-03-31.csv'))
}

async function loadStorageRows() {
  const staticRows = await readCsv(storageFilePath)
  if (!eiaSnapshotPath) {
    return {
      rows: staticRows,
      validation: {
        source: 'static-cache',
        latestInputDate: staticRows.map((row) => row.date).filter(Boolean).sort().at(-1) ?? null,
        latestPolledDate: null,
        polledRowCount: 0,
      },
    }
  }
  if (!existsSync(eiaSnapshotPath)) throw new Error(`Polled EIA snapshot is unavailable: ${eiaSnapshotPath}`)
  const snapshot = JSON.parse(await readFile(eiaSnapshotPath, 'utf8'))
  const polledRows = Array.isArray(snapshot.storageRows) ? snapshot.storageRows : []
  const latestPolledDate = snapshot.latestStorage?.date ?? null
  const latestPolledStorageBcf = numberFrom(snapshot.latestStorage?.storageBcf, Number.NaN)
  const byDate = new Map(staticRows.filter((row) => row.date).map((row) => [row.date, row]))
  for (const row of polledRows) if (row.date && numberFrom(row.storageBcf) > 0) byDate.set(row.date, row)
  const rows = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
  const latestInputDate = rows.at(-1)?.date ?? null
  const latestPolledInput = byDate.get(latestPolledDate)
  if (!latestPolledDate || !latestPolledInput || !Number.isFinite(latestPolledStorageBcf)
    || Math.abs(numberFrom(latestPolledInput.storageBcf) - latestPolledStorageBcf) > 1e-6) {
    throw new Error(`Inference EIA input lags the polled release (polled: ${latestPolledDate ?? 'none'}, input: ${latestInputDate ?? 'none'}).`)
  }
  return {
    rows,
    validation: {
      source: snapshot.source ?? 'polled-snapshot',
      snapshotGeneratedAt: snapshot.generatedAt ?? null,
      latestInputDate,
      latestPolledDate,
      latestPolledStorageBcf,
      polledRowCount: polledRows.length,
    },
  }
}

async function main() {
  if (shadowOnly && !summer) {
    throw new Error('Summer shadow collection is limited to the active Summer comparator schedule, including its April/May boundary.')
  }
  const strategyArtifact = shadowOnly
    ? assertStrategyArtifactContractIntegrity(repoDir)
    : assertPaperEligibleStrategyArtifact(repoDir)
  if (shadowOnly) {
    if (strategyArtifact.currentParity?.components?.summer?.exactTargetParity !== true) {
      throw new Error('Summer shadow collection requires exact current production-source parity for the active Summer comparator.')
    }
    const summerSummaryPath = path.join(
      repoDir,
      'data/qore/research/strategy-agent-runs/ngas-summer-alpha/run-summary.json',
    )
    let summerSummary
    try {
      summerSummary = JSON.parse(await readFile(summerSummaryPath, 'utf8'))
    } catch (error) {
      throw new Error(`Summer shadow collection could not read the versioned Summer summary: ${error.message}`)
    }
    const shadowFailures = summerShadowCompatibilityFailures({
      activeComponentContract:
        strategyArtifact.summary?.contract?.liveInference?.componentContract?.summer,
      embeddedShadow: summerSummary?.researchOnly?.prospectiveShadowChallenger,
    })
    if (shadowFailures.length) {
      throw new Error(`Summer shadow collection requires the current frozen comparator contract: ${shadowFailures.join('; ')}`)
    }
  }
  assertEiaStorageReleaseCalendarCoverage(today)
  if (Boolean(configuredGasMarketPath) !== Boolean(configuredIndexMarketPath)) {
    throw new Error('QORE_LIVE_INFERENCE_GAS_MARKET_FILE and QORE_LIVE_INFERENCE_INDEX_MARKET_FILE must be configured together.')
  }
  await mkdir(forecastRoot, { recursive: true })
  const collections = []
  if (!['1', 'true', 'yes'].includes(String(process.env.QORE_LIVE_INFERENCE_SKIP_FETCH ?? '').toLowerCase())) {
    for (const sourceId of collectedSources) collections.push(await collectNoaa(sourceId))
  }
  const { rows, manifests } = await loadForecastRows()
  const relevantRows = rows.filter((row) => requiredLeads.includes(row.leadDays))
  const validIssueDates = completeIssueDates(relevantRows)
  const validIssueDateSet = new Set(validIssueDates)
  const inferenceRows = rows.filter((row) => validIssueDateSet.has(row.issueDate) && row.demandInputsComplete)
  const latestIssueDate = validIssueDates.at(-1) ?? null
  const issueAgeDays = latestIssueDate ? (Date.parse(today) - Date.parse(latestIssueDate)) / 86400000 : null
  if (!latestIssueDate || issueAgeDays > 2) throw new Error(`Validated ${collectedSources.join('/')} 00z demand-input set is stale or incomplete (latest common issue: ${latestIssueDate ?? 'none'}).`)
  if (!configuredGasMarketPath && !truthy(process.env.QORE_LIVE_INFERENCE_SKIP_MARKET_REFRESH)) {
    await run(process.execPath, ['scripts/qore-live-market-history.mjs'], {
      QORE_LIVE_MARKET_HISTORY_DATE: today,
      QORE_LIVE_MARKET_HISTORY_STATE_DIR: marketHistoryStateDir,
    })
  }
  const { rows: days, validation: marketValidation } = await marketDays()
  const { rows: storageRows, validation: storageValidation } = await loadStorageRows()
  const actualWeatherRows = await loadActualWeatherRows()
  const target = inferAllYearTarget({ forecastRows: inferenceRows, actualWeatherRows, marketDays: days, storageRows, targetDate: today })
  if (shadowOnly) {
    const shadowTarget = inferSummerShadowTarget({
      forecastRows: inferenceRows,
      marketDays: days,
      storageRows,
      targetDate: today,
    })
    const generatedAt = new Date().toISOString()
    const record = createSummerShadowTargetRecord({
      generatedAt,
      targetDate: today,
      activeStrategyContractDigestSha256: strategyArtifact.binding.strategyContractDigestSha256,
      activeStrategyArtifactDigestSha256: strategyArtifact.binding.digestSha256,
      activeTarget: targetProjection(target),
      shadowTarget: targetProjection(shadowTarget),
      inputProvenance: {
        forecastRowsDigestSha256: summerShadowValueDigestSha256(inferenceRows),
        marketDaysDigestSha256: summerShadowValueDigestSha256(days),
        storageRowsDigestSha256: summerShadowValueDigestSha256(storageRows),
        forecastValidation: {
          latestCommonIssueDate: latestIssueDate,
          issueAgeDays: round(issueAgeDays, 2),
          requiredSources,
          collectedSources,
          requiredLeads,
        },
        marketValidation,
        storageValidation,
      },
    })
    const appended = await appendSummerShadowTargetRecord({ stateDir: summerShadowStateDir, record })
    console.log(
      `summer-shadow written=${appended.written} reason=${appended.reason ?? 'none'} target=${today} file=${appended.filePath ? path.relative(repoDir, appended.filePath) : 'none'}`,
    )
    return
  }
  const snapshot = {
    generatedAt: new Date().toISOString(), serviceId: 'qore-live-all-year-inference',
    validated: strategyArtifact.binding.paperEligible,
    inferenceMode: 'selected-contract-live-source-set-00z', liveForecastAppliedToTarget: true,
    strategyId: 'ngas-all-year-beta', season: summer ? 'summer' : 'winter', target,
    strategyArtifact: strategyArtifact.binding,
    forecastValidation: {
      latestCommonIssueDate: latestIssueDate, issueAgeDays: round(issueAgeDays, 2), runHourUtc: '00',
      requiredSources, collectedSources, requiredLeads,
      scoreRowCount: inferenceRows.filter((row) => requiredLeads.includes(row.leadDays)).length,
    },
    marketValidation,
    storageValidation,
    selectedContracts: summer ? { summer: selectedContracts.summer } : { winterFollow: selectedContracts.winterFollow, winterFade: selectedContracts.winterFade },
    files: {
      snapshot: path.relative(repoDir, outputPath),
      forecastState: path.relative(repoDir, forecastRoot),
      marketHistory: configuredGasMarketPath ? null : path.relative(repoDir, marketHistoryStateDir),
    },
    collection: { attempted: collections.length > 0, manifests: manifests.map((manifest) => ({ source: manifest.forecastSource, generatedAt: manifest.generatedAt, failures: manifest.failures?.length ?? 0 })) },
  }
  await writeJsonAtomic(outputPath, snapshot)
  console.log(`live-inference validated=true season=${snapshot.season} issue=${latestIssueDate} target=${today} gas=${target.gasPosition} file=${path.relative(repoDir, outputPath)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
