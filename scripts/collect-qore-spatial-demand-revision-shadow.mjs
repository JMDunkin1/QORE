#!/usr/bin/env node
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadLocalEnv } from './local-env.mjs'
import { loadAllYearStrategyArtifact } from './lib/qore-live-strategy-artifact.mjs'
import {
  SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE,
  appendSpatialDemandRevisionTargetRecord,
  buildSpatialDemandRevisionFeatures,
  createSpatialDemandRevisionTargetRecord,
  previousReviewedMarketSession,
  readSpatialDemandRevisionManifest,
  spatialDemandRevisionDigestSha256,
  spatialDemandRevisionRecordTiming,
  spatialDemandRevisionSeasonForDate,
  spatialDemandRevisionShadowDecision,
  spatialDemandRevisionYahooChartUrl,
} from './lib/qore-spatial-demand-revision-shadow.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const forbiddenCollectionOverrides = [
  'QORE_GFS_OBJECT_BASE',
  'QORE_LIVE_MARKET_HISTORY_YAHOO_BASE_URL',
  'QORE_OPEN_METEO_SINGLE_RUNS_BASE_URL',
].filter((name) => Boolean(process.env[name]))
const testCapabilityEnabled = ['1', 'true', 'yes', 'on']
  .includes(String(process.env.QORE_TEST_LIVE_INFERENCE_OVERRIDES ?? '').toLowerCase())
if (process.env.NODE_ENV === 'test'
  || testCapabilityEnabled
  || forbiddenCollectionOverrides.length) {
  throw new Error(
    `Spatial-demand-revision collection forbids test mode and endpoint overrides${forbiddenCollectionOverrides.length ? `: ${forbiddenCollectionOverrides.join(', ')}` : '.'}`,
  )
}

const dataRoot = path.join(repoDir, 'data', 'qore')
const shadowRoot = path.join(
  repoDir,
  '.local',
  'qore',
  'shadow-validation',
  SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.candidateId,
)
const forecastRoot = path.join(shadowRoot, 'forecast-state')
const targetStateDir = path.join(shadowRoot, 'targets')
const manifestPath = path.join(repoDir, 'config', 'qore-spatial-demand-revision-shadow.json')
const SOURCE_IDS = ['gfs', 'gefs-mean']
const WEATHER_DIRS = { gfs: 'noaa-gfs', 'gefs-mean': 'noaa-gefs' }

function newYorkDate(timestamp = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(timestamp).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

function addDays(date, count) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10)
}

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      value += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }
  values.push(value)
  return values
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

async function readCsv(filePath) {
  if (!existsSync(filePath)) throw new Error(`Required shadow input is unavailable: ${filePath}`)
  return parseCsv(await readFile(filePath, 'utf8'))
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-12_000) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12_000) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${path.basename(command)} exited ${code}: ${(stderr || stdout).trim().slice(-2_000)}`))
    })
  })
}

function forecastPaths(sourceId) {
  const base = `qore-spatial-demand-revision-${sourceId}-00z`
  return {
    base,
    score: path.join(forecastRoot, 'research', `${base}-signal-scores.csv`),
    locations: path.join(forecastRoot, 'weather', WEATHER_DIRS[sourceId], `${base}-location-anomalies.csv`),
    manifest: path.join(forecastRoot, 'weather', WEATHER_DIRS[sourceId], `${base}-manifest.json`),
  }
}

async function collectForecastSource({ sourceId, priorIssueDate, currentIssueDate }) {
  const paths = forecastPaths(sourceId)
  await run(process.execPath, ['scripts/build-gfs-forecast-calendar.mjs'], {
    QORE_DATA_ROOT: dataRoot,
    QORE_NORMAL_START: '1991-01-01',
    QORE_NORMAL_END: '2020-12-31',
    QORE_FORECAST_SOURCE: sourceId,
    QORE_GFS_RUN_HOUR: '00',
    QORE_GFS_CALENDAR_START: priorIssueDate,
    QORE_GFS_CALENDAR_ISSUE_END: currentIssueDate,
    QORE_GFS_CALENDAR_END: addDays(currentIssueDate, 8),
    QORE_GFS_LEAD_DAYS: '7,8',
    QORE_GFS_VALID_HOURS: '',
    QORE_GFS_VALID_OFFSETS_HOURS: '6,12,18,24',
    QORE_GFS_HEATING_SEASON_ONLY: '0',
    QORE_GFS_COOLING_SEASON_ONLY: '0',
    QORE_GFS_RESUME: '1',
    QORE_GFS_ALLOW_PARTIAL: '0',
    QORE_GFS_CONCURRENCY: '4',
    QORE_GFS_MAX_ITEMS: '0',
    QORE_GFS_FORCE_DEFAULT_OUTPUT_BASENAME: '0',
    QORE_GFS_PORTABLE_GRIB_PARSER: '1',
    QORE_FETCH_TIMEOUT_MS: '45000',
    QORE_GFS_OUTPUT_ROOT: forecastRoot,
    QORE_GFS_OUTPUT_BASENAME: paths.base,
  })
  const [scoreRows, locationRows, manifestRaw] = await Promise.all([
    readCsv(paths.score),
    readCsv(paths.locations),
    readFile(paths.manifest, 'utf8'),
  ])
  return {
    sourceId,
    manifest: JSON.parse(manifestRaw),
    manifestDigestSha256: spatialDemandRevisionDigestSha256(JSON.parse(manifestRaw)),
    scoreRows: scoreRows.map((row) => ({ ...row, sourceId })),
    locationRows: locationRows.map((row) => ({ ...row, sourceId })),
  }
}

function dateFromEpoch(seconds) {
  return new Date(Number(seconds) * 1_000).toISOString().slice(0, 10)
}

async function collectMarketHistory(targetDate) {
  const sourceUrl = spatialDemandRevisionYahooChartUrl({ symbol: 'NG=F', targetDate })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'QORE spatial-demand-revision research shadow' },
      redirect: 'error',
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`Yahoo NG=F request failed with HTTP ${response.status}: ${body.slice(0, 180)}`)
    }
    const responsePayloadDigestSha256 = crypto.createHash('sha256').update(body).digest('hex')
    const payload = JSON.parse(body)
    const result = payload.chart?.result?.[0]
    const quote = result?.indicators?.quote?.[0]
    const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? []
    const timestamps = result?.timestamp ?? []
    if (!result || !quote || !timestamps.length || result.meta?.symbol !== 'NG=F') {
      throw new Error('Yahoo NG=F response did not include daily bars.')
    }
    const rows = timestamps.map((timestamp, index) => ({
      date: dateFromEpoch(timestamp),
      close: Number(adjusted[index] ?? quote.close?.[index]),
      contract: 'NG=F',
      provisional: false,
      sourceUrl,
      responsePayloadDigestSha256,
    })).filter((row) => row.date < targetDate && Number.isFinite(row.close) && row.close > 0)
      .toSorted((left, right) => left.date.localeCompare(right.date))
    const seen = new Set()
    for (const row of rows) {
      if (seen.has(row.date)) throw new Error(`Yahoo NG=F response contains duplicate date ${row.date}.`)
      seen.add(row.date)
    }
    return {
      rows,
      marketSource: {
        sourceId: 'yahoo-chart-api',
        symbol: 'NG=F',
        sourceUrl,
        responsePayloadDigestSha256,
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}

function selectedForecastAtoms(sourceInputs, currentIssueDate) {
  const priorIssueDate = addDays(currentIssueDate, -1)
  const weatherTargetDate = addDays(currentIssueDate, 7)
  return sourceInputs.map((input) => {
    const selectedScores = input.scoreRows.filter((row) => (
      row.targetDate === weatherTargetDate
      && ((row.issueDate === currentIssueDate && Number(row.leadDays) === 7)
        || (row.issueDate === priorIssueDate && Number(row.leadDays) === 8))
    ))
    const identities = new Set(selectedScores.map((row) => [
      row.issueDate,
      row.targetDate,
      row.leadDays,
      row.windowId,
      row.modelId,
    ].join('|')))
    const selectedLocations = input.locationRows.filter((row) => identities.has([
      row.issueDate,
      row.targetDate,
      row.leadDays,
      row.windowId,
      row.modelId,
    ].join('|')))
    return {
      sourceId: input.sourceId,
      manifest: input.manifest,
      manifestDigestSha256: input.manifestDigestSha256,
      scoreRows: selectedScores,
      locationRows: selectedLocations,
    }
  })
}

function selectedMarketRows(gasBars, featureBundle) {
  if (!featureBundle?.priceResponse) return []
  const selectedDates = new Set([
    featureBundle.priceResponse.startSessionDate,
    featureBundle.priceResponse.endSessionDate,
  ])
  return gasBars.filter((row) => selectedDates.has(row.date)).map((row) => ({
    date: row.date,
    close: Number(row.close),
    contract: row.contract || 'NG=F',
    provisional: row.provisional === true || String(row.provisional).toLowerCase() === 'true',
    sourceUrl: row.sourceUrl,
    responsePayloadDigestSha256: row.responsePayloadDigestSha256,
  }))
}

function safeErrorMessage(error) {
  return String(error?.message ?? error ?? 'unknown input failure')
    .replaceAll(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 1_000)
}

async function main() {
  const now = new Date()
  const targetDate = newYorkDate(now)
  const { manifest, manifestDigestSha256 } = await readSpatialDemandRevisionManifest(repoDir, manifestPath)
  const timing = spatialDemandRevisionRecordTiming({
    targetDate,
    generatedAt: now.toISOString(),
    prospectiveStart: manifest.prospectiveStart,
  })
  if (!timing.eligible) {
    console.log(`spatial-demand-revision-shadow written=false reason=${timing.reason} target=${targetDate}`)
    return
  }
  let settlementFailure = null
  try {
    await run(process.execPath, ['scripts/settle-qore-spatial-demand-revision-shadow.mjs'])
  } catch (error) {
    settlementFailure = safeErrorMessage(error)
    console.error(`Prior spatial-demand-revision settlement failed: ${settlementFailure}`)
  }
  const strategyArtifact = loadAllYearStrategyArtifact(repoDir)
  if (strategyArtifact.binding.strategyContractDigestSha256
      !== manifest.referenceStrategy.strategyContractDigestSha256
    || strategyArtifact.binding.strategyArtifactCoreDigestSha256
      !== manifest.referenceStrategy.strategyArtifactCoreDigestSha256) {
    throw new Error('The versioned strategy/artifact reference rotated after the research shadow was sealed.')
  }

  let sourceInputs = []
  let gasBars = []
  let marketSource = null
  let featureBundle = null
  let decision
  let diagnosticError = null
  let resolvedIssueDate = null
  try {
    const season = spatialDemandRevisionSeasonForDate(targetDate)
    if (season === 'inactive') {
      featureBundle = buildSpatialDemandRevisionFeatures({ targetDate, sourceInputs: [], gasBars: [] })
    } else {
      resolvedIssueDate = previousReviewedMarketSession(targetDate)
      const priorIssueDate = addDays(resolvedIssueDate, -1)
      await mkdir(forecastRoot, { recursive: true, mode: 0o700 })
      sourceInputs = []
      for (const sourceId of SOURCE_IDS) {
        sourceInputs.push(await collectForecastSource({
          sourceId,
          priorIssueDate,
          currentIssueDate: resolvedIssueDate,
        }))
      }
      const market = await collectMarketHistory(targetDate)
      gasBars = market.rows
      marketSource = market.marketSource
      featureBundle = buildSpatialDemandRevisionFeatures({ targetDate, sourceInputs, gasBars })
    }
    decision = spatialDemandRevisionShadowDecision(featureBundle)
  } catch (error) {
    diagnosticError = safeErrorMessage(error)
    featureBundle = null
    decision = { status: 'input-failure', target: null, reason: 'input-collection-or-validation-failed' }
  }

  const currentIssueDate = featureBundle?.currentIssueDate ?? resolvedIssueDate
  const forecastAtoms = currentIssueDate ? selectedForecastAtoms(sourceInputs, currentIssueDate) : []
  const marketRows = selectedMarketRows(gasBars, featureBundle)
  const inputProvenance = {
    forecastInputsDigestSha256: spatialDemandRevisionDigestSha256(forecastAtoms),
    marketRowsDigestSha256: spatialDemandRevisionDigestSha256(marketRows),
    marketSourceDigestSha256: spatialDemandRevisionDigestSha256(marketSource),
    forecastAtoms,
    marketRows,
    marketSource,
    dataCollectionStatus: diagnosticError ? 'input-failure' : 'complete',
  }
  const generatedAt = new Date().toISOString()
  const record = createSpatialDemandRevisionTargetRecord({
    generatedAt,
    targetDate,
    manifestDigestSha256,
    referenceStrategyContractDigestSha256: strategyArtifact.binding.strategyContractDigestSha256,
    referenceStrategyArtifactCoreDigestSha256:
      strategyArtifact.binding.strategyArtifactCoreDigestSha256,
    featureBundle,
    decision,
    inputProvenance,
    diagnostics: diagnosticError
      ? {
          status: 'input-failure',
          message: diagnosticError,
          priorSettlementFailure: settlementFailure,
          referenceContractIntegrityFailures: strategyArtifact.contractIntegrityFailures,
        }
      : {
          status: featureBundle.diagnostics.status,
          message: null,
          priorSettlementFailure: settlementFailure,
          referenceContractIntegrityFailures: strategyArtifact.contractIntegrityFailures,
        },
  })
  const appended = await appendSpatialDemandRevisionTargetRecord({
    stateDir: targetStateDir,
    record,
    prospectiveStart: manifest.prospectiveStart,
  })
  console.log(
    `spatial-demand-revision-shadow written=${appended.written} reason=${appended.reason ?? 'none'} target=${targetDate} decision=${decision.status} file=${appended.filePath ? path.relative(repoDir, appended.filePath) : 'none'}`,
  )
  if (settlementFailure || diagnosticError) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
