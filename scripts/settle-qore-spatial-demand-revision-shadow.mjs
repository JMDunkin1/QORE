#!/usr/bin/env node
import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadLocalEnv } from './local-env.mjs'
import { loadResearchExecutionContract } from './lib/qore-research-execution.mjs'
import {
  SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE,
  appendSpatialDemandRevisionSettlementRecord,
  createSpatialDemandRevisionSettlementRecord,
  previousReviewedMarketSession,
  readSpatialDemandRevisionManifest,
  spatialDemandRevisionSettlementTiming,
  spatialDemandRevisionYahooChartUrl,
  validateSpatialDemandRevisionSettlementRecord,
  validateSpatialDemandRevisionTargetRecord,
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
    `Spatial-demand-revision settlement forbids test mode and endpoint overrides${forbiddenCollectionOverrides.length ? `: ${forbiddenCollectionOverrides.join(', ')}` : '.'}`,
  )
}

const candidateId = SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.candidateId
const shadowRoot = path.join(
  repoDir,
  '.local',
  'qore',
  'shadow-validation',
  candidateId,
)
const targetStateDir = path.join(shadowRoot, 'targets')
const settlementStateDir = path.join(shadowRoot, 'settlements')
const manifestPath = path.join(repoDir, 'config', 'qore-spatial-demand-revision-shadow.json')

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

function dateFromEpoch(seconds) {
  return new Date(Number(seconds) * 1_000).toISOString().slice(0, 10)
}

async function fetchSymbolOutcome({ symbol, targetDate, settlementCutoffDate }) {
  const sourceUrl = spatialDemandRevisionYahooChartUrl({
    symbol,
    targetDate: settlementCutoffDate,
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'QORE spatial-demand-revision research settlement' },
      redirect: 'error',
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`Yahoo ${symbol} request failed with HTTP ${response.status}: ${body.slice(0, 180)}`)
    }
    const responsePayloadDigestSha256 = crypto.createHash('sha256').update(body).digest('hex')
    const payload = JSON.parse(body)
    const result = payload.chart?.result?.[0]
    const quote = result?.indicators?.quote?.[0]
    const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? []
    const timestamps = result?.timestamp ?? []
    if (!result || !quote || !timestamps.length || result.meta?.symbol !== symbol) {
      throw new Error(`Yahoo ${symbol} response did not include daily bars.`)
    }
    const rows = timestamps.map((timestamp, index) => [
      dateFromEpoch(timestamp),
      {
        rawOpen: Number(quote.open?.[index]),
        rawHigh: Number(quote.high?.[index]),
        rawLow: Number(quote.low?.[index]),
        rawClose: Number(quote.close?.[index]),
        adjustedClose: Number(adjusted[index] ?? quote.close?.[index]),
        volume: Number(quote.volume?.[index] ?? 0),
      },
    ])
    const seenDates = new Set()
    for (const [date] of rows) {
      if (seenDates.has(date)) throw new Error(`Yahoo ${symbol} response contains duplicate date ${date}.`)
      seenDates.add(date)
    }
    const byDate = new Map(rows)
    const previousDate = previousReviewedMarketSession(targetDate)
    const previousRaw = byDate.get(previousDate)
    const currentRaw = byDate.get(targetDate)
    if (!previousRaw || !currentRaw) {
      throw new Error(
        `Yahoo ${symbol} response is missing reviewed settlement bars ${previousDate}/${targetDate}.`,
      )
    }
    const adjustmentFactor = currentRaw.adjustedClose / currentRaw.rawClose
    return {
      symbol,
      sourceId: 'yahoo-chart-api',
      sourceUrl,
      responsePayloadDigestSha256,
      previous: {
        date: previousDate,
        rawClose: previousRaw.rawClose,
        adjustedClose: previousRaw.adjustedClose,
      },
      current: {
        date: targetDate,
        ...currentRaw,
        adjustmentFactor,
        adjustedOpen: currentRaw.rawOpen * adjustmentFactor,
        adjustedHigh: currentRaw.rawHigh * adjustmentFactor,
        adjustedLow: currentRaw.rawLow * adjustmentFactor,
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  const now = new Date()
  const settlementDate = newYorkDate(now)
  const targetDate = previousReviewedMarketSession(settlementDate)
  const { manifest, manifestDigestSha256 } = await readSpatialDemandRevisionManifest(
    repoDir,
    manifestPath,
  )
  if (targetDate < manifest.prospectiveStart) {
    console.log(
      `spatial-demand-revision-settlement written=false reason=before-prospective-start target=${targetDate}`,
    )
    return
  }
  const timing = spatialDemandRevisionSettlementTiming({
    targetDate,
    generatedAt: now.toISOString(),
    prospectiveStart: manifest.prospectiveStart,
  })
  if (!timing.eligible) {
    console.log(
      `spatial-demand-revision-settlement written=false reason=${timing.reason} target=${targetDate}`,
    )
    return
  }
  const targetPath = path.join(targetStateDir, `${targetDate}.json`)
  if (!existsSync(targetPath)) {
    throw new Error(`Required pre-open shadow target is missing for settlement date ${targetDate}.`)
  }
  const targetStat = await lstat(targetPath)
  if (!targetStat.isFile() || targetStat.isSymbolicLink() || (targetStat.mode & 0o077) !== 0) {
    throw new Error(`Pre-open shadow target is not an owner-only regular file: ${targetPath}`)
  }
  const targetRecord = JSON.parse(await readFile(targetPath, 'utf8'))
  validateSpatialDemandRevisionTargetRecord(targetRecord)
  if (targetRecord.manifestDigestSha256 !== manifestDigestSha256) {
    throw new Error(`Pre-open shadow target ${targetDate} does not bind the active research manifest.`)
  }

  const existingSettlementPath = path.join(settlementStateDir, `${targetDate}.json`)
  if (existsSync(existingSettlementPath)) {
    const existingStat = await lstat(existingSettlementPath)
    if (!existingStat.isFile() || existingStat.isSymbolicLink() || (existingStat.mode & 0o077) !== 0) {
      throw new Error(`Existing settlement is not an owner-only regular file: ${existingSettlementPath}`)
    }
    const existing = JSON.parse(await readFile(existingSettlementPath, 'utf8'))
    validateSpatialDemandRevisionSettlementRecord(existing)
    if (existing.targetRecordDigestSha256 !== targetRecord.recordDigestSha256) {
      throw new Error(`Existing settlement ${targetDate} does not bind its immutable target record.`)
    }
    console.log(
      `spatial-demand-revision-settlement written=false reason=already-settled target=${targetDate}`,
    )
    return
  }

  const executionContract = loadResearchExecutionContract(repoDir)
  const symbolOutcomes = []
  for (const symbol of SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.outcomePolicy.instruments) {
    symbolOutcomes.push(await fetchSymbolOutcome({
      symbol,
      targetDate,
      settlementCutoffDate: timing.settlementDate,
    }))
  }
  const generatedAt = new Date().toISOString()
  const record = createSpatialDemandRevisionSettlementRecord({
    generatedAt,
    targetDate,
    manifestDigestSha256,
    targetRecordDigestSha256: targetRecord.recordDigestSha256,
    executionContractDigestSha256: executionContract.digest,
    symbolOutcomes,
  })
  const appended = await appendSpatialDemandRevisionSettlementRecord({
    stateDir: settlementStateDir,
    record,
    prospectiveStart: manifest.prospectiveStart,
  })
  console.log(
    `spatial-demand-revision-settlement written=${appended.written} reason=${appended.reason ?? 'none'} target=${targetDate} file=${appended.filePath ? path.relative(repoDir, appended.filePath) : 'none'}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
