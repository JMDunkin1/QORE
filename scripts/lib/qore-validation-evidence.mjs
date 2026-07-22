import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyExecutionStep,
  createExecutionState,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
} from './qore-research-execution.mjs'
import {
  liveGasPositionContractBlocks,
  liveInferenceSeasonForDate,
  liveTargetAllocationBlocks,
} from './qore-live-inference-provenance.mjs'
import { loadReviewedBrokerExecutionProfile } from './qore-broker-execution-profile.mjs'

export const FORWARD_VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION = 4
export const PAPER_EXECUTION_EVIDENCE_ARTIFACT_SCHEMA_VERSION = 2
// Kept as a compatibility alias for paper-evidence callers that still import the
// formerly shared schema constant. Forward evidence has its own v4 wire contract.
export const VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION = PAPER_EXECUTION_EVIDENCE_ARTIFACT_SCHEMA_VERSION
export const FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID = 'ngas-all-year-beta-forward-evidence-v4'
export const PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID = 'ngas-all-year-beta-paper-execution-evidence-v2'
export const REVIEWED_NYSE_CALENDAR_ID = 'nyse-full-day-sessions-2020-2035-v1'
export const FORWARD_OUTCOME_POLICY_ID = 'matched-fallback-forward-outcomes-v1'
export const DEFAULT_FORWARD_OUTCOME_POLICY = Object.freeze({
  schemaVersion: 1,
  policyId: FORWARD_OUTCOME_POLICY_ID,
  executionContractId: 'qore-causal-etf-execution-v2',
  executionContractDigestSha256: 'c18dea27526796dd6ad06ecffaa5cb1a32ac34fc587bc0cf79e0a007626e106d',
  marketDataSourceId: 'reviewed-normalized-ung-voo-qqqm-bars-v1',
  scenarioIds: ['baseline', 'elevated', 'stress'],
  minimumMaterialAbsoluteGasPosition: 0.1,
  episodeEmbargoSessions: 10,
  bootstrapIterations: 5000,
  bootstrapSeed: 1729,
  maximumBootstrapProbabilityMeanActiveReturnNonPositive: 0.2,
  minimumMaterialEpisodesByComponent: {
    'ngas-summer-alpha': 15,
    'ngas-winter-alpha': 15,
  },
  minimumMaterialSeasonsByComponent: {
    'ngas-summer-alpha': 2,
    'ngas-winter-alpha': 2,
  },
  minimumCompoundedActiveReturnPct: {
    baseline: 2,
    elevated: 1,
    stress: -2,
  },
  minimumComponentCompoundedActiveReturnPct: {
    'ngas-summer-alpha': 0,
    'ngas-winter-alpha': 0,
  },
  maximumActiveDrawdownPct: 10,
  maximumTopEpisodePositiveContributionFraction: 0.5,
  requirePositiveLeaveOneComponentSeasonOut: true,
  requireTrustedPreopenWriter: true,
})

const STRATEGY_ID = 'ngas-all-year-beta'
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_EVIDENCE_ARTIFACT_BYTES = 10 * 1024 * 1024
const FORWARD_FILE_NAME = 'ngas-all-year-beta-forward-evidence.json'
const PAPER_FILE_NAME = 'ngas-all-year-beta-paper-execution-evidence.json'
const ALLOWED_ORDER_SYMBOLS = new Set(['UNG', 'VOO', 'QQQM'])
const ALLOWED_ORDER_STATUSES = new Set(['filled', 'canceled', 'rejected'])
const ALLOWED_ORDER_SIDES = new Set(['buy', 'sell'])
const NYSE_CALENDAR_START_YEAR = 2020
const NYSE_CALENDAR_END_YEAR = 2035
const NYSE_OPEN_MINUTE = 9 * 60 + 30
const NYSE_CLOSE_MINUTE = 16 * 60
const NYSE_EARLY_CLOSE_MINUTE = 13 * 60
const MAX_REFERENCE_QUOTE_AGE_MS = 5 * 60 * 1000
const MAX_REFERENCE_QUOTE_FUTURE_SKEW_MS = 5 * 1000
const POSITION_TOLERANCE = 1e-8
const FORWARD_COMPONENT_STRATEGY_IDS = ['ngas-summer-alpha', 'ngas-winter-alpha']
const FORWARD_OUTCOME_FIELDS = [
  'strategyNetReturnPct',
  'matchedFallbackNetReturnPct',
  'activeReturnPct',
  'strategyTradingCostPct',
  'matchedFallbackTradingCostPct',
  'strategyBorrowCostPct',
  'matchedFallbackBorrowCostPct',
]

const EXTRAORDINARY_NYSE_CLOSURES = new Set([
  '2025-01-09', // National Day of Mourning for President Jimmy Carter.
])

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !value) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function isSha256(value) {
  return SHA256_PATTERN.test(String(value ?? ''))
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function positiveFiniteNumber(value) {
  return finiteNumber(value) && value > 0
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function addDays(date, count) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + count * 86400000).toISOString().slice(0, 10)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function canonicalDigestSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function forwardOutcomePolicyDigestSha256(policy) {
  return canonicalDigestSha256(policy)
}

export function forwardMarketSessionDigestSha256(marketSession) {
  return canonicalDigestSha256(marketSession)
}

function forwardSettlementDigestProjection(settlement) {
  const { settlementDigestSha256: _ignored, ...projection } = settlement ?? {}
  return projection
}

export function forwardSettlementDigestSha256(settlement) {
  return canonicalDigestSha256(forwardSettlementDigestProjection(settlement))
}

export function forwardInferenceDigestSha256(inference) {
  return canonicalDigestSha256(inference)
}

function executableTargetProjection(inference) {
  return {
    strategyId: inference?.strategyId ?? null,
    componentStrategyId: inference?.componentStrategyId ?? null,
    targetDate: inference?.targetDate ?? null,
    gasPosition: inference?.gasPosition ?? null,
    indexFraction: inference?.indexFraction ?? null,
    cashFraction: inference?.cashFraction ?? null,
    windowId: inference?.windowId ?? null,
    thesisKind: inference?.thesisKind ?? null,
  }
}

export function forwardExecutableTargetDigestSha256(inference) {
  return canonicalDigestSha256(executableTargetProjection(inference))
}

function forwardObservationIdProjection(observation) {
  const { observationIdSha256: _ignored, ...projection } = observation ?? {}
  return projection
}

export function forwardObservationIdSha256(observation) {
  return canonicalDigestSha256(forwardObservationIdProjection(observation))
}

function brokerRecord(order) {
  return {
    orderIdSha256: order?.orderIdSha256 ?? null,
    symbol: order?.symbol ?? null,
    side: order?.side ?? null,
    quantity: order?.quantity ?? null,
    status: order?.status ?? null,
    submittedAt: order?.submittedAt ?? null,
    filledAt: order?.filledAt ?? null,
    averageFillPriceUsd: order?.averageFillPriceUsd ?? null,
    prePositionQuantity: order?.prePositionQuantity ?? null,
    postPositionQuantity: order?.postPositionQuantity ?? null,
  }
}

export function paperBrokerRecordDigestSha256(order) {
  return canonicalDigestSha256(brokerRecord(order))
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function nearestRankPercentile(values, percentile) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)]
}

function artifactPaths(repoDir, manifestPath) {
  const defaultManifestPath = path.join(repoDir, 'config', 'qore-validation-integrity.json')
  const testOverride = path.resolve(manifestPath) !== path.resolve(defaultManifestPath)
  const evidenceDir = testOverride
    ? path.dirname(path.resolve(manifestPath))
    : path.join(repoDir, '.local', 'qore', 'validation-evidence')
  return {
    forward: path.join(evidenceDir, FORWARD_FILE_NAME),
    paper: path.join(evidenceDir, PAPER_FILE_NAME),
  }
}

export function resolveValidationEvidenceArtifactPaths(repoDir, manifestPath) {
  return artifactPaths(repoDir, manifestPath)
}

function readProtectedArtifact(filePath, label) {
  let fileStat
  let raw
  try {
    fileStat = fs.lstatSync(filePath)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error('must be a regular file and must not be a symlink')
    }
    if ((fileStat.mode & 0o077) !== 0) {
      throw new Error('must not grant group or other filesystem permissions')
    }
    if (typeof process.getuid === 'function' && fileStat.uid !== process.getuid()) {
      throw new Error('must be owned by the current runtime user')
    }
    if (fileStat.size > MAX_EVIDENCE_ARTIFACT_BYTES) {
      throw new Error(`must not exceed ${MAX_EVIDENCE_ARTIFACT_BYTES} bytes`)
    }
    raw = fs.readFileSync(filePath)
  } catch (error) {
    throw new Error(`Unable to read protected ${label}: ${error.message}`)
  }

  let artifact
  try {
    artifact = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    throw new Error(`Unable to parse protected ${label}: ${error.message}`)
  }
  return {
    artifact,
    digestSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  }
}

function nthWeekdayOfMonth(year, month, weekday, occurrence) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const day = 1 + ((weekday - first + 7) % 7) + (occurrence - 1) * 7
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function lastWeekdayOfMonth(year, month, weekday) {
  const final = new Date(Date.UTC(year, month, 0))
  const day = final.getUTCDate() - ((final.getUTCDay() - weekday + 7) % 7)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function observedFixedHoliday(year, month, day) {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
  if (weekday === 6) return addDays(date, -1)
  if (weekday === 0) return addDays(date, 1)
  return date
}

function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function nyseClosureDates(year) {
  const dates = new Set([
    observedFixedHoliday(year, 1, 1),
    observedFixedHoliday(year + 1, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    addDays(easterSunday(year), -2),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ])
  if (year >= 2022) dates.add(observedFixedHoliday(year, 6, 19))
  return dates
}

export function reviewedNyseSessionStatus(date) {
  if (!isDate(date)) return { session: false, reason: 'invalid-calendar-date' }
  const year = Number(date.slice(0, 4))
  if (year < NYSE_CALENDAR_START_YEAR || year > NYSE_CALENDAR_END_YEAR) {
    return { session: false, reason: 'outside-reviewed-nyse-calendar' }
  }
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
  if (weekday === 0 || weekday === 6) return { session: false, reason: 'nyse-weekend' }
  if (nyseClosureDates(year).has(date) || EXTRAORDINARY_NYSE_CLOSURES.has(date)) {
    return { session: false, reason: 'nyse-full-day-closure' }
  }
  return { session: true, reason: null }
}

export function reviewedNyseSessionDates(startDate, endDate) {
  if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) return []
  const dates = []
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    if (reviewedNyseSessionStatus(date).session) dates.push(date)
  }
  return dates
}

export function reviewedNyseSessionCloseMinute(date) {
  if (!reviewedNyseSessionStatus(date).session) return null
  const year = Number(date.slice(0, 4))
  const thanksgivingFriday = addDays(nthWeekdayOfMonth(year, 11, 4, 4), 1)
  if (
    date === thanksgivingFriday
    || date === `${year}-12-24`
    || date === `${year}-07-03`
  ) return NYSE_EARLY_CLOSE_MINUTE
  return NYSE_CLOSE_MINUTE
}

function newYorkTimestampParts(timestamp) {
  if (!isIsoTimestamp(timestamp)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  }
}

function seasonBounds(season, seasonYear) {
  if (!Number.isInteger(seasonYear) || seasonYear < 2000 || seasonYear > 2100) return null
  if (season === 'summer') return { startDate: `${seasonYear}-05-01`, endDate: `${seasonYear}-09-30` }
  if (season === 'winter') return { startDate: `${seasonYear}-11-01`, endDate: `${seasonYear + 1}-03-31` }
  return null
}

function completeSeasonCounts(sessionDates, prospectiveStart, observedThrough) {
  const covered = new Set(sessionDates)
  const result = { completeSummerSeasons: 0, completeWinterSeasons: 0 }
  if (!isDate(prospectiveStart) || !isDate(observedThrough)) return result
  const firstYear = Number(prospectiveStart.slice(0, 4)) - 1
  const lastYear = Number(observedThrough.slice(0, 4))
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const [season, field] of [
      ['summer', 'completeSummerSeasons'],
      ['winter', 'completeWinterSeasons'],
    ]) {
      const bounds = seasonBounds(season, year)
      if (bounds.startDate < prospectiveStart || bounds.endDate > observedThrough) continue
      const expected = reviewedNyseSessionDates(bounds.startDate, bounds.endDate)
      if (expected.length > 0 && expected.every((date) => covered.has(date))) result[field] += 1
    }
  }
  return result
}

function commonDigest(records, field) {
  const values = [...new Set(records.map((record) => record?.[field]).filter(isSha256))]
  return values.length === 1 ? values[0] : null
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function exactObjectEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

export function validateForwardOutcomePolicy(policy) {
  const failures = []
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return ['forwardOutcomePolicy must be an object']
  }
  if (policy.schemaVersion !== 1) failures.push('forwardOutcomePolicy.schemaVersion must equal 1')
  if (policy.policyId !== FORWARD_OUTCOME_POLICY_ID) {
    failures.push(`forwardOutcomePolicy.policyId must equal ${FORWARD_OUTCOME_POLICY_ID}`)
  }
  if (typeof policy.executionContractId !== 'string' || !policy.executionContractId) {
    failures.push('forwardOutcomePolicy.executionContractId must be a non-empty string')
  }
  if (!isSha256(policy.executionContractDigestSha256)) {
    failures.push('forwardOutcomePolicy.executionContractDigestSha256 must be a lowercase SHA-256 digest')
  }
  if (
    typeof policy.marketDataSourceId !== 'string'
    || policy.marketDataSourceId !== 'reviewed-normalized-ung-voo-qqqm-bars-v1'
  ) {
    failures.push('forwardOutcomePolicy.marketDataSourceId must equal reviewed-normalized-ung-voo-qqqm-bars-v1')
  }
  if (
    !Array.isArray(policy.scenarioIds)
    || !arraysEqual(policy.scenarioIds, ['baseline', 'elevated', 'stress'])
  ) {
    failures.push('forwardOutcomePolicy.scenarioIds must exactly equal baseline, elevated, stress')
  }
  if (!Number.isInteger(policy.episodeEmbargoSessions) || policy.episodeEmbargoSessions < 10) {
    failures.push('forwardOutcomePolicy.episodeEmbargoSessions must be an integer of at least 10 reviewed sessions')
  }
  if (
    !finiteNumber(policy.minimumMaterialAbsoluteGasPosition)
    || policy.minimumMaterialAbsoluteGasPosition < 0.1
    || policy.minimumMaterialAbsoluteGasPosition > 1
  ) {
    failures.push('forwardOutcomePolicy.minimumMaterialAbsoluteGasPosition must be between 0.1 and 1')
  }
  if (!Number.isInteger(policy.bootstrapIterations) || policy.bootstrapIterations < 5000) {
    failures.push('forwardOutcomePolicy.bootstrapIterations must be an integer of at least 5000')
  }
  if (!Number.isInteger(policy.bootstrapSeed) || policy.bootstrapSeed < 0) {
    failures.push('forwardOutcomePolicy.bootstrapSeed must be a non-negative integer')
  }
  if (
    !finiteNumber(policy.maximumBootstrapProbabilityMeanActiveReturnNonPositive)
    || policy.maximumBootstrapProbabilityMeanActiveReturnNonPositive <= 0
    || policy.maximumBootstrapProbabilityMeanActiveReturnNonPositive > 0.2
  ) {
    failures.push('forwardOutcomePolicy maximum bootstrap probability must be greater than zero and at most 0.2')
  }
  for (const componentStrategyId of FORWARD_COMPONENT_STRATEGY_IDS) {
    if (
      !Number.isInteger(policy.minimumMaterialEpisodesByComponent?.[componentStrategyId])
      || policy.minimumMaterialEpisodesByComponent[componentStrategyId] < 15
    ) {
      failures.push(`forwardOutcomePolicy.minimumMaterialEpisodesByComponent.${componentStrategyId} must be an integer of at least 15`)
    }
    if (
      !Number.isInteger(policy.minimumMaterialSeasonsByComponent?.[componentStrategyId])
      || policy.minimumMaterialSeasonsByComponent[componentStrategyId] < 2
    ) {
      failures.push(`forwardOutcomePolicy.minimumMaterialSeasonsByComponent.${componentStrategyId} must be an integer of at least 2`)
    }
    if (
      !finiteNumber(policy.minimumComponentCompoundedActiveReturnPct?.[componentStrategyId])
      || policy.minimumComponentCompoundedActiveReturnPct[componentStrategyId] < 0
    ) {
      failures.push(`forwardOutcomePolicy.minimumComponentCompoundedActiveReturnPct.${componentStrategyId} must be at least zero`)
    }
  }
  for (const [scenarioId, minimum] of Object.entries({ baseline: 2, elevated: 1, stress: -2 })) {
    if (
      !finiteNumber(policy.minimumCompoundedActiveReturnPct?.[scenarioId])
      || policy.minimumCompoundedActiveReturnPct[scenarioId] < minimum
    ) {
      failures.push(`forwardOutcomePolicy.minimumCompoundedActiveReturnPct.${scenarioId} must be at least ${minimum}`)
    }
  }
  if (
    !finiteNumber(policy.maximumActiveDrawdownPct)
    || policy.maximumActiveDrawdownPct <= 0
    || policy.maximumActiveDrawdownPct > 10
  ) {
    failures.push('forwardOutcomePolicy.maximumActiveDrawdownPct must be in (0, 10]')
  }
  if (
    !finiteNumber(policy.maximumTopEpisodePositiveContributionFraction)
    || policy.maximumTopEpisodePositiveContributionFraction <= 0
    || policy.maximumTopEpisodePositiveContributionFraction > 0.5
  ) {
    failures.push('forwardOutcomePolicy.maximumTopEpisodePositiveContributionFraction must be in (0, 0.5]')
  }
  if (policy.requirePositiveLeaveOneComponentSeasonOut !== true) {
    failures.push('forwardOutcomePolicy.requirePositiveLeaveOneComponentSeasonOut must equal true')
  }
  if (policy.requireTrustedPreopenWriter !== true) {
    failures.push('forwardOutcomePolicy.requireTrustedPreopenWriter must equal true')
  }
  return failures
}

function priorReviewedNyseSessionDate(date) {
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addDays(date, -offset)
    if (reviewedNyseSessionStatus(candidate).session) return candidate
  }
  return null
}

function validateForwardMarketSession(marketSession, sessionDate, outcomePolicy, label, failures) {
  if (!marketSession || typeof marketSession !== 'object' || Array.isArray(marketSession)) {
    failures.push(`${label}.marketSession must be an object`)
    return
  }
  if (marketSession.schemaVersion !== 1) failures.push(`${label}.marketSession.schemaVersion must equal 1`)
  if (marketSession.sourceId !== outcomePolicy?.marketDataSourceId) {
    failures.push(`${label}.marketSession.sourceId must equal the reviewed forward market-data source`)
  }
  if (marketSession.date !== sessionDate) failures.push(`${label}.marketSession.date must equal sessionDate`)
  const expectedPreviousDate = isDate(sessionDate) ? priorReviewedNyseSessionDate(sessionDate) : null
  if (marketSession.previousDate !== expectedPreviousDate) {
    failures.push(`${label}.marketSession.previousDate must equal the preceding reviewed NYSE session`)
  }
  const expectedCalendarGapDays = expectedPreviousDate
    ? Math.round((Date.parse(`${sessionDate}T00:00:00.000Z`) - Date.parse(`${expectedPreviousDate}T00:00:00.000Z`)) / 86400000)
    : null
  if (marketSession.calendarGapDays !== expectedCalendarGapDays) {
    failures.push(`${label}.marketSession.calendarGapDays must equal the reviewed calendar gap`)
  }
  for (const symbol of ['UNG', 'VOO', 'QQQM']) {
    const symbolReturns = marketSession.symbols?.[symbol]
    if (!symbolReturns || typeof symbolReturns !== 'object' || Array.isArray(symbolReturns)) {
      failures.push(`${label}.marketSession.symbols.${symbol} must be an object`)
      continue
    }
    for (const field of ['overnightReturnPct', 'intradayReturnPct']) {
      if (!finiteNumber(symbolReturns[field]) || symbolReturns[field] <= -100) {
        failures.push(`${label}.marketSession.symbols.${symbol}.${field} must be finite and greater than -100`)
      }
    }
  }
}

function settlementTimestampForDate(settledAtBySessionDate, sessionDate) {
  if (typeof settledAtBySessionDate === 'function') return settledAtBySessionDate(sessionDate)
  if (settledAtBySessionDate instanceof Map) return settledAtBySessionDate.get(sessionDate)
  return settledAtBySessionDate?.[sessionDate]
}

function settlementOutcome(strategyStep, fallbackStep) {
  return {
    strategyNetReturnPct: round(strategyStep.netReturnPct, 8),
    matchedFallbackNetReturnPct: round(fallbackStep.netReturnPct, 8),
    activeReturnPct: round(strategyStep.netReturnPct - fallbackStep.netReturnPct, 8),
    strategyTradingCostPct: round(strategyStep.tradingCostPct, 8),
    matchedFallbackTradingCostPct: round(fallbackStep.tradingCostPct, 8),
    strategyBorrowCostPct: round(strategyStep.borrowCostPct, 8),
    matchedFallbackBorrowCostPct: round(fallbackStep.borrowCostPct, 8),
  }
}

export function buildForwardSettlementRecords({
  observations,
  marketSessions,
  outcomePolicy,
  executionContract,
  settledAtBySessionDate,
}) {
  const policyFailures = validateForwardOutcomePolicy(outcomePolicy)
  if (policyFailures.length) throw new Error(policyFailures.join('; '))
  if (executionContract?.contractId !== outcomePolicy.executionContractId) {
    throw new Error('Forward outcome policy does not match the research execution contract.')
  }
  if (executionContract?.digest !== outcomePolicy.executionContractDigestSha256) {
    throw new Error('Forward outcome policy does not match the research execution contract digest.')
  }
  const marketByDate = new Map(marketSessions.map((marketSession) => [marketSession.date, marketSession]))
  const policyDigest = forwardOutcomePolicyDigestSha256(outcomePolicy)
  const fallbackTargetWeights = targetWeightsForAllocation(executionContract, {
    gasPosition: 0,
    investedIndexFraction: 1,
  })
  const states = Object.fromEntries(outcomePolicy.scenarioIds.map((scenarioId) => [scenarioId, {
    strategy: createExecutionState(executionContract),
    fallback: createExecutionState(executionContract),
  }]))

  return observations.map((observation) => {
    const marketSession = marketByDate.get(observation.sessionDate)
    if (!marketSession) throw new Error(`Missing forward market session for ${observation.sessionDate}.`)
    const strategyTargetWeights = targetWeightsForAllocation(executionContract, {
      gasPosition: observation.inference.gasPosition,
      investedIndexFraction: observation.inference.indexFraction,
    })
    const outcomes = {}
    for (const scenarioId of outcomePolicy.scenarioIds) {
      const strategyStep = applyExecutionStep({
        state: states[scenarioId].strategy,
        day: marketSession,
        targetWeights: strategyTargetWeights,
        contract: executionContract,
        scenarioId,
      })
      const fallbackStep = applyExecutionStep({
        state: states[scenarioId].fallback,
        day: marketSession,
        targetWeights: fallbackTargetWeights,
        contract: executionContract,
        scenarioId,
      })
      states[scenarioId].strategy = strategyStep.state
      states[scenarioId].fallback = fallbackStep.state
      outcomes[scenarioId] = settlementOutcome(strategyStep, fallbackStep)
    }
    const settlement = {
      schemaVersion: 1,
      observationIdSha256: observation.observationIdSha256,
      inferenceDigestSha256: observation.inferenceDigestSha256,
      sessionDate: observation.sessionDate,
      settledAt: settlementTimestampForDate(settledAtBySessionDate, observation.sessionDate),
      strategyContractDigestSha256: observation.strategyContractDigestSha256,
      strategyArtifactDigestSha256: observation.strategyArtifactDigestSha256,
      outcomePolicyDigestSha256: policyDigest,
      marketSession,
      marketSessionDigestSha256: forwardMarketSessionDigestSha256(marketSession),
      outcomes,
    }
    settlement.settlementDigestSha256 = forwardSettlementDigestSha256(settlement)
    return settlement
  })
}

function compoundOutcomePct(settlements, scenarioId, field, indexes = null) {
  const selected = indexes ? indexes.map((index) => settlements[index]) : settlements
  return (selected.reduce(
    (wealth, settlement) => wealth * (1 + settlement.outcomes[scenarioId][field] / 100),
    1,
  ) - 1) * 100
}

function relativeActiveDrawdownPct(settlements, scenarioId) {
  let strategyWealth = 1
  let fallbackWealth = 1
  let peakRelativeWealth = 1
  let maximumDrawdownPct = 0
  for (const settlement of settlements) {
    strategyWealth *= 1 + settlement.outcomes[scenarioId].strategyNetReturnPct / 100
    fallbackWealth *= 1 + settlement.outcomes[scenarioId].matchedFallbackNetReturnPct / 100
    const relativeWealth = strategyWealth / fallbackWealth
    peakRelativeWealth = Math.max(peakRelativeWealth, relativeWealth)
    maximumDrawdownPct = Math.min(maximumDrawdownPct, (relativeWealth / peakRelativeWealth - 1) * 100)
  }
  return maximumDrawdownPct
}

export function forwardComponentSeasonLabel(componentStrategyId, date) {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  if (componentStrategyId === 'ngas-summer-alpha') return `summer-${year}`
  const seasonYear = month <= 4 ? year - 1 : year
  return `winter-${seasonYear}-${seasonYear + 1}`
}

function deriveMaterialEpisodes(observations, outcomePolicy, failures) {
  const episodes = []
  let previousGasPosition = 0
  let previousComponentStrategyId = null
  let lastMaterialIndex = Number.NEGATIVE_INFINITY

  observations.forEach((observation, index) => {
    const gasPosition = observation.inference.gasPosition
    const currentMaterial = Math.abs(gasPosition) >= outcomePolicy.minimumMaterialAbsoluteGasPosition
    const priorMaterial = Math.abs(previousGasPosition) >= outcomePolicy.minimumMaterialAbsoluteGasPosition
    if (currentMaterial || priorMaterial) {
      const componentStrategyId = currentMaterial
        ? observation.inference.componentStrategyId
        : previousComponentStrategyId
      const separated = index - lastMaterialIndex > outcomePolicy.episodeEmbargoSessions + 1
      if (!episodes.length || separated) {
        episodes.push({
          startIndex: index,
          endIndex: index,
          componentStrategyId,
          componentSeason: forwardComponentSeasonLabel(componentStrategyId, observation.sessionDate),
        })
      } else {
        const episode = episodes.at(-1)
        episode.endIndex = index
        if (episode.componentStrategyId !== componentStrategyId) {
          failures.push(`forward material episode at ${observation.sessionDate} mixes component strategies inside the embargo window`)
        }
      }
      lastMaterialIndex = index
    }
    previousGasPosition = gasPosition
    previousComponentStrategyId = currentMaterial ? observation.inference.componentStrategyId : null
  })

  return episodes.map((episode) => ({
    ...episode,
    indexes: Array.from(
      { length: episode.endIndex - episode.startIndex + 1 },
      (_, offset) => episode.startIndex + offset,
    ),
  }))
}

function createSeededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function bootstrapProbabilityMeanNonPositive(values, iterations, seed) {
  if (!values.length) return 1
  const random = createSeededRandom(seed)
  let nonPositive = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)]
    }
    if (sum / values.length <= 0) nonPositive += 1
  }
  return (nonPositive + 1) / (iterations + 1)
}

function forwardOutcomeSummary(
  settlements,
  episodes,
  outcomePolicy,
  minimumForwardEvidence,
  trustedPreopenWriterSatisfied,
) {
  const allIndexes = settlements.map((_, index) => index)
  const compoundedActiveReturnPct = Object.fromEntries(outcomePolicy.scenarioIds.map((scenarioId) => {
    const strategyReturn = compoundOutcomePct(settlements, scenarioId, 'strategyNetReturnPct')
    const fallbackReturn = compoundOutcomePct(settlements, scenarioId, 'matchedFallbackNetReturnPct')
    return [scenarioId, round(strategyReturn - fallbackReturn, 8)]
  }))
  const baselineEpisodeActiveReturns = episodes.map((episode) => {
    const strategyReturn = compoundOutcomePct(settlements, 'baseline', 'strategyNetReturnPct', episode.indexes)
    const fallbackReturn = compoundOutcomePct(settlements, 'baseline', 'matchedFallbackNetReturnPct', episode.indexes)
    return strategyReturn - fallbackReturn
  })
  const positiveEpisodeReturns = baselineEpisodeActiveReturns.filter((value) => value > 0)
  const topEpisodePositiveContributionFraction = positiveEpisodeReturns.length
    ? Math.max(...positiveEpisodeReturns) / positiveEpisodeReturns.reduce((sum, value) => sum + value, 0)
    : 1
  const bootstrapProbability = bootstrapProbabilityMeanNonPositive(
    baselineEpisodeActiveReturns,
    outcomePolicy.bootstrapIterations,
    outcomePolicy.bootstrapSeed,
  )
  const materialEpisodesByComponent = Object.fromEntries(FORWARD_COMPONENT_STRATEGY_IDS.map((componentStrategyId) => [
    componentStrategyId,
    episodes.filter((episode) => episode.componentStrategyId === componentStrategyId).length,
  ]))
  const componentCompoundedActiveReturnPct = Object.fromEntries(FORWARD_COMPONENT_STRATEGY_IDS.map((componentStrategyId) => {
    const indexes = [...new Set(episodes
      .filter((episode) => episode.componentStrategyId === componentStrategyId)
      .flatMap((episode) => episode.indexes))].sort((left, right) => left - right)
    const strategyReturn = compoundOutcomePct(settlements, 'baseline', 'strategyNetReturnPct', indexes)
    const fallbackReturn = compoundOutcomePct(settlements, 'baseline', 'matchedFallbackNetReturnPct', indexes)
    return [componentStrategyId, round(strategyReturn - fallbackReturn, 8)]
  }))
  const componentSeasons = [...new Set(episodes.map((episode) => (
    `${episode.componentStrategyId}:${episode.componentSeason}`
  )))]
  const materialSeasonsByComponent = Object.fromEntries(FORWARD_COMPONENT_STRATEGY_IDS.map((componentStrategyId) => [
    componentStrategyId,
    new Set(episodes
      .filter((episode) => episode.componentStrategyId === componentStrategyId)
      .map((episode) => episode.componentSeason)).size,
  ]))
  const leaveOneComponentSeasonOutActiveReturnPct = Object.fromEntries(componentSeasons.map((componentSeason) => {
    const excluded = new Set(episodes
      .filter((episode) => `${episode.componentStrategyId}:${episode.componentSeason}` === componentSeason)
      .flatMap((episode) => episode.indexes))
    const retainedIndexes = allIndexes.filter((index) => !excluded.has(index))
    const strategyReturn = compoundOutcomePct(settlements, 'baseline', 'strategyNetReturnPct', retainedIndexes)
    const fallbackReturn = compoundOutcomePct(settlements, 'baseline', 'matchedFallbackNetReturnPct', retainedIndexes)
    return [componentSeason, round(strategyReturn - fallbackReturn, 8)]
  }))
  const componentSpecificLeaveOneSeasonOutActiveReturnPct = Object.fromEntries(
    FORWARD_COMPONENT_STRATEGY_IDS.map((componentStrategyId) => {
      const seasons = [...new Set(episodes
        .filter((episode) => episode.componentStrategyId === componentStrategyId)
        .map((episode) => episode.componentSeason))]
      const results = Object.fromEntries(seasons.map((season) => {
        const retainedIndexes = [...new Set(episodes
          .filter((episode) => (
            episode.componentStrategyId === componentStrategyId
            && episode.componentSeason !== season
          ))
          .flatMap((episode) => episode.indexes))].sort((left, right) => left - right)
        const strategyReturn = compoundOutcomePct(
          settlements,
          'baseline',
          'strategyNetReturnPct',
          retainedIndexes,
        )
        const fallbackReturn = compoundOutcomePct(
          settlements,
          'baseline',
          'matchedFallbackNetReturnPct',
          retainedIndexes,
        )
        return [season, round(strategyReturn - fallbackReturn, 8)]
      }))
      return [componentStrategyId, results]
    }),
  )
  const maximumRelativeActiveDrawdownPct = relativeActiveDrawdownPct(settlements, 'baseline')
  const gates = {
    minimumIndependentEpisodes: episodes.length >= minimumForwardEvidence.independentEpisodes,
    minimumComponentEpisodes: FORWARD_COMPONENT_STRATEGY_IDS.every((componentStrategyId) => (
      materialEpisodesByComponent[componentStrategyId]
        >= outcomePolicy.minimumMaterialEpisodesByComponent[componentStrategyId]
    )),
    minimumComponentSeasons: FORWARD_COMPONENT_STRATEGY_IDS.every((componentStrategyId) => (
      materialSeasonsByComponent[componentStrategyId]
        >= outcomePolicy.minimumMaterialSeasonsByComponent[componentStrategyId]
    )),
    baselineEfficacy:
      compoundedActiveReturnPct.baseline > outcomePolicy.minimumCompoundedActiveReturnPct.baseline,
    elevatedCostEfficacy:
      compoundedActiveReturnPct.elevated > outcomePolicy.minimumCompoundedActiveReturnPct.elevated,
    stressLossLimit:
      compoundedActiveReturnPct.stress >= outcomePolicy.minimumCompoundedActiveReturnPct.stress,
    componentNoninferiority: FORWARD_COMPONENT_STRATEGY_IDS.every((componentStrategyId) => (
      componentCompoundedActiveReturnPct[componentStrategyId]
        >= outcomePolicy.minimumComponentCompoundedActiveReturnPct[componentStrategyId]
    )),
    bootstrapEfficacy:
      bootstrapProbability <= outcomePolicy.maximumBootstrapProbabilityMeanActiveReturnNonPositive,
    activeDrawdown:
      maximumRelativeActiveDrawdownPct >= -outcomePolicy.maximumActiveDrawdownPct,
    episodeConcentration:
      topEpisodePositiveContributionFraction <= outcomePolicy.maximumTopEpisodePositiveContributionFraction,
    leaveOneComponentSeasonOut:
      componentSeasons.length >= 4
      && Object.values(leaveOneComponentSeasonOutActiveReturnPct).every((value) => value > 0),
    componentSpecificLeaveOneSeasonOut: FORWARD_COMPONENT_STRATEGY_IDS.every((componentStrategyId) => (
      Object.values(componentSpecificLeaveOneSeasonOutActiveReturnPct[componentStrategyId]).length
        >= outcomePolicy.minimumMaterialSeasonsByComponent[componentStrategyId]
      && Object.values(componentSpecificLeaveOneSeasonOutActiveReturnPct[componentStrategyId])
        .every((value) => (
          value > 0
          && value >= outcomePolicy.minimumComponentCompoundedActiveReturnPct[componentStrategyId]
        ))
    )),
    trustedPreopenCommitments:
      outcomePolicy.requireTrustedPreopenWriter === true && trustedPreopenWriterSatisfied === true,
  }
  return {
    settledSessions: settlements.length,
    materialEpisodes: episodes.length,
    materialEpisodesByComponent,
    materialSeasonsByComponent,
    compoundedActiveReturnPct,
    componentCompoundedActiveReturnPct,
    bootstrapProbabilityMeanActiveReturnNonPositive: round(bootstrapProbability, 8),
    maximumRelativeActiveDrawdownPct: round(maximumRelativeActiveDrawdownPct, 8),
    topEpisodePositiveContributionFraction: round(topEpisodePositiveContributionFraction, 8),
    leaveOneComponentSeasonOutActiveReturnPct,
    componentSpecificLeaveOneSeasonOutActiveReturnPct,
    trustedPreopenWriterSatisfied,
    gates,
    outcomeGatesSatisfied: Object.values(gates).every(Boolean),
  }
}

function summarizeForwardArtifact(
  artifact,
  manifest,
  failures,
  repoDir,
  allowTestTrustedWriter = false,
) {
  const prefix = 'forward validation evidence artifact'
  const failureStart = failures.length
  if (artifact?.schemaVersion !== FORWARD_VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION) {
    failures.push(`${prefix} schemaVersion must equal ${FORWARD_VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION}`)
  }
  if (artifact?.artifactId !== FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID) {
    failures.push(`${prefix} artifactId must equal ${FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID}`)
  }
  if (artifact?.strategyId !== STRATEGY_ID) failures.push(`${prefix} strategyId must equal ${STRATEGY_ID}`)
  if (artifact?.marketCalendarId !== REVIEWED_NYSE_CALENDAR_ID) {
    failures.push(`${prefix} marketCalendarId must equal ${REVIEWED_NYSE_CALENDAR_ID}`)
  }
  if (artifact?.observedThrough !== manifest?.observedForwardEvidence?.observedThrough) {
    failures.push(`${prefix} observedThrough must equal the reviewed manifest`)
  }

  const prospectiveStart = manifest?.historicalEvidence?.prospectiveStart
  const observedThrough = manifest?.observedForwardEvidence?.observedThrough
  const expectedPreregistrationDigestSha256 = manifest?.preregistrationDigestSha256
  const expectedSealedAt = manifest?.sealedAt
  const sealedStrategyDigest = manifest?.sealedStrategyContractDigestSha256
  // The manifest field retains its historical wire name, but it seals the canonical
  // strategy-artifact core rather than the self-referential raw run-summary bytes.
  const sealedArtifactCoreDigest = manifest?.sealedStrategyArtifactDigestSha256
  const observations = Array.isArray(artifact?.observations) ? artifact.observations : []
  if (!Array.isArray(artifact?.observations)) failures.push(`${prefix} observations must be an array`)
  const observationIds = new Set()
  const observationDates = new Set()
  const inferenceDigests = new Set()
  const outcomePolicy = manifest?.forwardOutcomePolicy
  const policyFailures = validateForwardOutcomePolicy(outcomePolicy)
  failures.push(...policyFailures)
  const expectedOutcomePolicyDigest = policyFailures.length
    ? null
    : forwardOutcomePolicyDigestSha256(outcomePolicy)
  if (artifact?.outcomePolicyDigestSha256 !== expectedOutcomePolicyDigest) {
    failures.push(`${prefix} outcomePolicyDigestSha256 must match the reviewed forward outcome policy`)
  }
  if (artifact?.preregistrationDigestSha256 !== expectedPreregistrationDigestSha256) {
    failures.push(`${prefix} preregistrationDigestSha256 must match the immutable reviewed preregistration`)
  }
  if (artifact?.sealedAt !== expectedSealedAt) {
    failures.push(`${prefix} sealedAt must match the immutable reviewed preregistration timestamp`)
  }
  const commitmentJournal = artifact?.commitmentJournal
  if (!commitmentJournal || typeof commitmentJournal !== 'object' || Array.isArray(commitmentJournal)) {
    failures.push(`${prefix} commitmentJournal must be an object`)
  } else {
    if (commitmentJournal.schemaVersion !== 1) {
      failures.push(`${prefix} commitmentJournal.schemaVersion must equal 1`)
    }
    if (typeof commitmentJournal.writerId !== 'string' || !commitmentJournal.writerId) {
      failures.push(`${prefix} commitmentJournal.writerId must be a non-empty string`)
    }
    if (
      commitmentJournal.preregistrationDigestSha256
      !== expectedPreregistrationDigestSha256
    ) {
      failures.push(`${prefix} commitmentJournal.preregistrationDigestSha256 must match the immutable reviewed preregistration`)
    }
    if (commitmentJournal.sealedAt !== expectedSealedAt) {
      failures.push(`${prefix} commitmentJournal.sealedAt must match the immutable reviewed preregistration timestamp`)
    }
  }
  const trustedPreopenWriterSatisfied = (
    allowTestTrustedWriter === true
    && commitmentJournal?.writerId === 'qore-test-forward-commitment-writer-v1'
    && commitmentJournal?.testOnly === true
  )

  for (const [index, observation] of observations.entries()) {
    const label = `${prefix} observations[${index}]`
    if (!isSha256(observation?.observationIdSha256)) {
      failures.push(`${label}.observationIdSha256 must be a lowercase SHA-256 digest`)
    } else if (observationIds.has(observation.observationIdSha256)) {
      failures.push(`${label}.observationIdSha256 must be unique`)
    } else observationIds.add(observation.observationIdSha256)
    if (
      isSha256(observation?.observationIdSha256)
      && observation.observationIdSha256 !== forwardObservationIdSha256(observation)
    ) failures.push(`${label}.observationIdSha256 must bind the complete pre-open commitment record`)

    if (!isDate(observation?.sessionDate)) {
      failures.push(`${label}.sessionDate must be a calendar date`)
    } else {
      if (observationDates.has(observation.sessionDate)) failures.push(`${label}.sessionDate must be unique`)
      observationDates.add(observation.sessionDate)
      const sessionStatus = reviewedNyseSessionStatus(observation.sessionDate)
      if (!sessionStatus.session) failures.push(`${label}.sessionDate must be a reviewed NYSE session (${sessionStatus.reason})`)
      if (isDate(prospectiveStart) && observation.sessionDate < prospectiveStart) {
        failures.push(`${label}.sessionDate cannot precede prospectiveStart`)
      }
      if (isDate(observedThrough) && observation.sessionDate > observedThrough) {
        failures.push(`${label}.sessionDate cannot exceed observedThrough`)
      }
    }

    const recordedParts = newYorkTimestampParts(observation?.recordedAt)
    if (!recordedParts) failures.push(`${label}.recordedAt must be an ISO timestamp`)
    else if (recordedParts.date !== observation.sessionDate || recordedParts.minute >= NYSE_OPEN_MINUTE) {
      failures.push(`${label}.recordedAt must be before 09:30 America/New_York on sessionDate`)
    }
    if (
      isIsoTimestamp(observation?.recordedAt)
      && isIsoTimestamp(expectedSealedAt)
      && Date.parse(observation.recordedAt) < Date.parse(expectedSealedAt)
    ) failures.push(`${label}.recordedAt cannot precede the immutable preregistration seal`)

    if (observation?.preregistrationDigestSha256 !== expectedPreregistrationDigestSha256) {
      failures.push(`${label}.preregistrationDigestSha256 must equal the immutable reviewed preregistration`)
    }
    if (observation?.sealedAt !== expectedSealedAt) {
      failures.push(`${label}.sealedAt must equal the immutable reviewed preregistration timestamp`)
    }

    if (observation?.strategyContractDigestSha256 !== sealedStrategyDigest) {
      failures.push(`${label}.strategyContractDigestSha256 must equal the sealed strategy contract`)
    }
    if (
      observation?.strategyArtifactDigestSha256 !== sealedArtifactCoreDigest
      || !isSha256(sealedArtifactCoreDigest)
    ) {
      failures.push(`${label}.strategyArtifactDigestSha256 must equal the sealed strategy-artifact core digest`)
    }
    if (observation?.outcomePolicyDigestSha256 !== expectedOutcomePolicyDigest) {
      failures.push(`${label}.outcomePolicyDigestSha256 must equal the reviewed forward outcome policy digest`)
    }
    if (!observation?.inference || typeof observation.inference !== 'object' || Array.isArray(observation.inference)) {
      failures.push(`${label}.inference must be an object`)
    } else {
      if (observation.inference.schemaVersion !== 1) failures.push(`${label}.inference.schemaVersion must equal 1`)
      if (observation.inference.strategyId !== STRATEGY_ID) failures.push(`${label}.inference.strategyId must equal ${STRATEGY_ID}`)
      const generatedParts = newYorkTimestampParts(observation.inference.generatedAt)
      if (!generatedParts) failures.push(`${label}.inference.generatedAt must be an ISO timestamp`)
      else {
        if (isIsoTimestamp(observation.recordedAt) && Date.parse(observation.inference.generatedAt) > Date.parse(observation.recordedAt)) {
          failures.push(`${label}.inference.generatedAt cannot postdate recordedAt`)
        }
        if (
          isIsoTimestamp(expectedSealedAt)
          && Date.parse(observation.inference.generatedAt) < Date.parse(expectedSealedAt)
        ) failures.push(`${label}.inference.generatedAt cannot precede the immutable preregistration seal`)
        if (generatedParts.date !== observation.sessionDate || generatedParts.minute >= NYSE_OPEN_MINUTE) {
          failures.push(`${label}.inference.generatedAt must be before 09:30 America/New_York on sessionDate`)
        }
      }
      if (observation.inference.targetDate !== observation.sessionDate) {
        failures.push(`${label}.inference.targetDate must equal sessionDate`)
      }
      for (const field of ['gasPosition', 'indexFraction', 'cashFraction']) {
        if (!finiteNumber(observation.inference[field])) failures.push(`${label}.inference.${field} must be finite`)
      }
      if (
        finiteNumber(observation.inference.gasPosition)
        && (observation.inference.gasPosition < -1 || observation.inference.gasPosition > 1)
      ) failures.push(`${label}.inference.gasPosition must be between -1 and 1`)
      for (const field of ['indexFraction', 'cashFraction']) {
        if (
          finiteNumber(observation.inference[field])
          && (observation.inference[field] < 0 || observation.inference[field] > 1)
        ) failures.push(`${label}.inference.${field} must be between 0 and 1`)
      }
      if (
        ['gasPosition', 'indexFraction', 'cashFraction']
          .every((field) => finiteNumber(observation.inference[field]))
      ) {
        for (const block of liveTargetAllocationBlocks(observation.inference)) {
          failures.push(`${label}.inference allocation is invalid: ${block}`)
        }
      }
      if (typeof observation.inference.thesisKind !== 'string' || !observation.inference.thesisKind) {
        failures.push(`${label}.inference.thesisKind must be a non-empty string`)
      }
      if (finiteNumber(observation.inference.gasPosition) && observation.inference.gasPosition !== 0) {
        const season = liveInferenceSeasonForDate(observation.sessionDate)
        const provenanceBlocks = liveGasPositionContractBlocks({
          season,
          targetDate: observation.sessionDate,
          componentStrategyId: observation.inference.componentStrategyId,
          windowId: observation.inference.windowId,
          thesisKind: observation.inference.thesisKind,
          gasPosition: observation.inference.gasPosition,
        })
        failures.push(...provenanceBlocks.map((block) => `${label}.inference ${block}`))
      } else if (
        observation.inference.componentStrategyId !== 'index-fallback'
        || observation.inference.windowId !== 'index-fallback'
        || observation.inference.thesisKind !== 'index-fallback'
      ) {
        failures.push(`${label}.inference flat targets must use the executable index-fallback component/window/thesis identity`)
      }
    }
    if (!isSha256(observation?.inferenceDigestSha256)) {
      failures.push(`${label}.inferenceDigestSha256 must be a lowercase SHA-256 digest`)
    } else {
      if (inferenceDigests.has(observation.inferenceDigestSha256)) failures.push(`${label}.inferenceDigestSha256 must be unique`)
      inferenceDigests.add(observation.inferenceDigestSha256)
      if (observation?.inference && observation.inferenceDigestSha256 !== forwardInferenceDigestSha256(observation.inference)) {
        failures.push(`${label}.inferenceDigestSha256 must match the canonical inference record`)
      }
    }
    for (const field of [
      'liveInferenceDigestSha256',
      'signalHandoffDigestSha256',
      'inputProvenanceDigestSha256',
    ]) {
      if (!isSha256(observation?.[field])) {
        failures.push(`${label}.${field} must be a lowercase SHA-256 digest`)
      }
    }
    if (!isSha256(observation?.executableTargetDigestSha256)) {
      failures.push(`${label}.executableTargetDigestSha256 must be a lowercase SHA-256 digest`)
    } else if (
      observation?.inference
      && observation.executableTargetDigestSha256 !== forwardExecutableTargetDigestSha256(observation.inference)
    ) {
      failures.push(`${label}.executableTargetDigestSha256 must bind the exact committed target fields`)
    }
    if (Object.hasOwn(observation, 'independentEpisode')) {
      failures.push(`${label}.independentEpisode is not accepted in schema v4; material episodes are derived from committed gas exposure`)
    }
  }

  const expectedSessionDates = isDate(prospectiveStart) && isDate(observedThrough)
    ? reviewedNyseSessionDates(prospectiveStart, observedThrough)
    : []
  const artifactSessionDates = observations.map((observation) => observation.sessionDate)
  if (!arraysEqual(artifactSessionDates, expectedSessionDates)) {
    failures.push(`${prefix} observations must contain every reviewed NYSE session in chronological order from prospectiveStart through observedThrough`)
  }

  const settlements = Array.isArray(artifact?.settlements) ? artifact.settlements : []
  if (!Array.isArray(artifact?.settlements)) failures.push(`${prefix} settlements must be an array`)
  if (settlements.length !== observations.length) {
    failures.push(`${prefix} must contain exactly one settlement for every observation`)
  }
  const observationsById = new Map(observations.map((observation) => [observation.observationIdSha256, observation]))
  const settlementObservationIds = new Set()
  for (const [index, settlement] of settlements.entries()) {
    const label = `${prefix} settlements[${index}]`
    if (settlement?.schemaVersion !== 1) failures.push(`${label}.schemaVersion must equal 1`)
    if (!isSha256(settlement?.observationIdSha256)) {
      failures.push(`${label}.observationIdSha256 must be a lowercase SHA-256 digest`)
    } else if (settlementObservationIds.has(settlement.observationIdSha256)) {
      failures.push(`${label}.observationIdSha256 must be unique`)
    } else settlementObservationIds.add(settlement.observationIdSha256)
    const observation = observationsById.get(settlement?.observationIdSha256)
    if (!observation) {
      failures.push(`${label}.observationIdSha256 must reference an observation in the artifact`)
      continue
    }
    if (settlement.sessionDate !== observation.sessionDate) failures.push(`${label}.sessionDate must equal the committed observation date`)
    if (settlement.inferenceDigestSha256 !== observation.inferenceDigestSha256) {
      failures.push(`${label}.inferenceDigestSha256 must equal the committed inference digest`)
    }
    if (settlement.strategyContractDigestSha256 !== observation.strategyContractDigestSha256) {
      failures.push(`${label}.strategyContractDigestSha256 must equal the committed strategy contract digest`)
    }
    if (settlement.strategyArtifactDigestSha256 !== observation.strategyArtifactDigestSha256) {
      failures.push(`${label}.strategyArtifactDigestSha256 must equal the committed strategy artifact digest`)
    }
    if (settlement.outcomePolicyDigestSha256 !== expectedOutcomePolicyDigest) {
      failures.push(`${label}.outcomePolicyDigestSha256 must equal the reviewed forward outcome policy digest`)
    }
    const settledParts = newYorkTimestampParts(settlement.settledAt)
    if (!settledParts) failures.push(`${label}.settledAt must be an ISO timestamp`)
    else if (
      settledParts.date < settlement.sessionDate
      || (settledParts.date === settlement.sessionDate && settledParts.minute < 16 * 60)
    ) {
      failures.push(`${label}.settledAt must be at or after 16:00 America/New_York on sessionDate`)
    }
    if (
      isIsoTimestamp(settlement.settledAt)
      && isIsoTimestamp(manifest?.observedForwardEvidence?.reviewedAt)
      && Date.parse(settlement.settledAt) > Date.parse(manifest.observedForwardEvidence.reviewedAt)
    ) {
      failures.push(`${label}.settledAt cannot postdate the reviewed forward evidence`)
    }
    validateForwardMarketSession(settlement.marketSession, settlement.sessionDate, outcomePolicy, label, failures)
    const marketSessionDigest = forwardMarketSessionDigestSha256(settlement.marketSession)
    if (settlement.marketSessionDigestSha256 !== marketSessionDigest) {
      failures.push(`${label}.marketSessionDigestSha256 must match the canonical market session`)
    }
    for (const scenarioId of outcomePolicy?.scenarioIds ?? []) {
      for (const field of FORWARD_OUTCOME_FIELDS) {
        if (!finiteNumber(settlement.outcomes?.[scenarioId]?.[field])) {
          failures.push(`${label}.outcomes.${scenarioId}.${field} must be finite`)
        }
      }
    }
    if (!isSha256(settlement.settlementDigestSha256)) {
      failures.push(`${label}.settlementDigestSha256 must be a lowercase SHA-256 digest`)
    } else if (settlement.settlementDigestSha256 !== forwardSettlementDigestSha256(settlement)) {
      failures.push(`${label}.settlementDigestSha256 must match the canonical settlement record`)
    }
  }

  let outcomeSummary = null
  if (failures.length === failureStart) {
    try {
      const executionContract = loadResearchExecutionContract(repoDir)
      if (executionContract.contractId !== outcomePolicy.executionContractId) {
        failures.push(`${prefix} forward outcome policy executionContractId does not match the reviewed execution contract`)
      } else if (executionContract.digest !== outcomePolicy.executionContractDigestSha256) {
        failures.push(`${prefix} forward outcome policy executionContractDigestSha256 does not match the reviewed execution contract`)
      } else if (outcomePolicy.scenarioIds.some((scenarioId) => !executionContract.scenarios[scenarioId])) {
        failures.push(`${prefix} forward outcome policy references an unknown execution scenario`)
      } else {
        const expectedSettlements = buildForwardSettlementRecords({
          observations,
          marketSessions: settlements.map((settlement) => settlement.marketSession),
          outcomePolicy,
          executionContract,
          settledAtBySessionDate: new Map(settlements.map((settlement) => [settlement.sessionDate, settlement.settledAt])),
        })
        expectedSettlements.forEach((expected, index) => {
          const actual = settlements[index]
          if (!exactObjectEqual(actual?.outcomes, expected.outcomes)) {
            failures.push(`${prefix} settlements[${index}].outcomes do not match causal post-cost recomputation`)
          }
          if (actual?.settlementDigestSha256 !== expected.settlementDigestSha256) {
            failures.push(`${prefix} settlements[${index}].settlementDigestSha256 does not bind the recomputed outcome`)
          }
        })
        if (failures.length === failureStart) {
          const episodes = deriveMaterialEpisodes(observations, outcomePolicy, failures)
          if (failures.length === failureStart) {
            outcomeSummary = forwardOutcomeSummary(
              expectedSettlements,
              episodes,
              outcomePolicy,
              manifest.minimumForwardEvidence,
              trustedPreopenWriterSatisfied,
            )
          }
        }
      }
    } catch (error) {
      failures.push(`${prefix} could not recompute causal outcomes: ${error.message}`)
    }
  }

  const seasonCounts = completeSeasonCounts([...observationDates], prospectiveStart, observedThrough)
  return {
    independentEpisodes: outcomeSummary?.materialEpisodes ?? 0,
    ...seasonCounts,
    observedThrough: artifact?.observedThrough ?? null,
    strategyContractDigestSha256: commonDigest(observations, 'strategyContractDigestSha256'),
    strategyArtifactDigestSha256: commonDigest(observations, 'strategyArtifactDigestSha256'),
    outcomePolicyDigestSha256: artifact?.outcomePolicyDigestSha256 ?? null,
    preregistrationDigestSha256: artifact?.preregistrationDigestSha256 ?? null,
    sealedAt: artifact?.sealedAt ?? null,
    outcomeGatesSatisfied: outcomeSummary?.outcomeGatesSatisfied === true,
    outcomeSummary,
  }
}

function derivedUngDirection(order) {
  if (order?.symbol !== 'UNG') return null
  if (order.side === 'buy' && order.postPositionQuantity > 0 && order.postPositionQuantity > order.prePositionQuantity) return 'long'
  if (order.side === 'sell' && order.postPositionQuantity < 0 && order.postPositionQuantity < order.prePositionQuantity) return 'short'
  return null
}

function summarizePaperArtifact(artifact, manifest, failures, repoDir) {
  const prefix = 'paper execution evidence artifact'
  let reviewedBrokerProfile = null
  try {
    const loaded = loadReviewedBrokerExecutionProfile(repoDir)
    reviewedBrokerProfile = loaded.profile
    if (loaded.profileDigestSha256 !== manifest?.sealedBrokerExecutionProfileDigestSha256) {
      failures.push(`${prefix} sealed broker profile digest must equal the loaded reviewed broker profile`)
    }
    if (loaded.profileDigestSha256 !== artifact?.brokerExecutionProfileDigestSha256) {
      failures.push(`${prefix} broker profile digest must equal the loaded reviewed broker profile`)
    }
  } catch (error) {
    failures.push(`${prefix} could not load the reviewed broker profile: ${error.message}`)
  }
  const paperApprovalAt = manifest?.approvals?.paper?.status === 'approved'
    && isIsoTimestamp(manifest.approvals.paper.approvedAt)
    ? manifest.approvals.paper.approvedAt
    : null
  if (paperApprovalAt === null) {
    failures.push(`${prefix} requires an approved paper route with an absolute approval timestamp`)
  }
  if (artifact?.schemaVersion !== VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION) {
    failures.push(`${prefix} schemaVersion must equal ${VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION}`)
  }
  if (artifact?.artifactId !== PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID) {
    failures.push(`${prefix} artifactId must equal ${PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID}`)
  }
  if (artifact?.strategyId !== STRATEGY_ID) failures.push(`${prefix} strategyId must equal ${STRATEGY_ID}`)
  if (artifact?.marketCalendarId !== REVIEWED_NYSE_CALENDAR_ID) {
    failures.push(`${prefix} marketCalendarId must equal ${REVIEWED_NYSE_CALENDAR_ID}`)
  }
  if (artifact?.strategyContractDigestSha256 !== manifest?.sealedStrategyContractDigestSha256) {
    failures.push(`${prefix} strategy-contract digest must equal the sealed strategy contract`)
  }
  if (artifact?.brokerExecutionProfileDigestSha256 !== manifest?.sealedBrokerExecutionProfileDigestSha256) {
    failures.push(`${prefix} broker execution profile digest must equal the sealed broker profile`)
  }
  if (artifact?.accountPseudonymSha256 !== manifest?.paperExecutionEvidence?.accountPseudonymSha256) {
    failures.push(`${prefix} account pseudonym must equal the reviewed manifest`)
  }

  const sessions = Array.isArray(artifact?.tradingSessions) ? artifact.tradingSessions : []
  if (!Array.isArray(artifact?.tradingSessions)) failures.push(`${prefix} tradingSessions must be an array`)
  const sessionSet = new Set()
  for (const [index, sessionDate] of sessions.entries()) {
    if (!isDate(sessionDate)) failures.push(`${prefix} tradingSessions[${index}] must be a calendar date`)
    const status = reviewedNyseSessionStatus(sessionDate)
    if (isDate(sessionDate) && !status.session) {
      failures.push(`${prefix} tradingSessions[${index}] must be a reviewed NYSE session (${status.reason})`)
    }
    if (sessionSet.has(sessionDate)) failures.push(`${prefix} tradingSessions[${index}] must be unique`)
    sessionSet.add(sessionDate)
    if (index > 0 && sessions[index - 1] >= sessionDate) failures.push(`${prefix} tradingSessions must be strictly chronological`)
  }
  if (sessions.length > 0 && isDate(sessions[0]) && isDate(sessions.at(-1))) {
    const expectedSessions = reviewedNyseSessionDates(sessions[0], sessions.at(-1))
    if (!arraysEqual(sessions, expectedSessions)) {
      failures.push(`${prefix} tradingSessions must equal the complete reviewed NYSE session set for the evidence period`)
    }
  }

  const orders = Array.isArray(artifact?.orders) ? artifact.orders : []
  if (!Array.isArray(artifact?.orders)) failures.push(`${prefix} orders must be an array`)
  const orderIds = new Set()
  const brokerRecordDigests = new Set()
  const filledOrders = []
  const coherentFilledOrders = []
  for (const [index, order] of orders.entries()) {
    const label = `${prefix} orders[${index}]`
    if (Object.hasOwn(order ?? {}, 'targetExposure')) {
      failures.push(`${label}.targetExposure is not accepted; direction must derive from side, quantity, and signed positions`)
    }
    if (!isSha256(order?.orderIdSha256)) failures.push(`${label}.orderIdSha256 must be a lowercase SHA-256 digest`)
    else if (orderIds.has(order.orderIdSha256)) failures.push(`${label}.orderIdSha256 must be unique`)
    else orderIds.add(order.orderIdSha256)
    if (!isSha256(order?.brokerRecordDigestSha256)) failures.push(`${label}.brokerRecordDigestSha256 must be a lowercase SHA-256 digest`)
    else {
      if (brokerRecordDigests.has(order.brokerRecordDigestSha256)) failures.push(`${label}.brokerRecordDigestSha256 must be unique`)
      brokerRecordDigests.add(order.brokerRecordDigestSha256)
      if (order.brokerRecordDigestSha256 !== paperBrokerRecordDigestSha256(order)) {
        failures.push(`${label}.brokerRecordDigestSha256 must match the canonical broker order/fill record`)
      }
    }
    if (!ALLOWED_ORDER_SYMBOLS.has(order?.symbol)) failures.push(`${label}.symbol must be UNG, VOO, or QQQM`)
    if (!ALLOWED_ORDER_STATUSES.has(order?.status)) failures.push(`${label}.status must be filled, canceled, or rejected`)
    if (!ALLOWED_ORDER_SIDES.has(order?.side)) failures.push(`${label}.side must equal buy or sell`)
    if (!positiveFiniteNumber(order?.quantity)) failures.push(`${label}.quantity must be positive`)
    if (!isIsoTimestamp(order?.submittedAt)) failures.push(`${label}.submittedAt must be an ISO timestamp`)
    if (
      paperApprovalAt !== null
      && isIsoTimestamp(order?.submittedAt)
      && Date.parse(order.submittedAt) < Date.parse(paperApprovalAt)
    ) failures.push(`${label}.submittedAt cannot precede the paper approval timestamp`)
    const submittedParts = newYorkTimestampParts(order?.submittedAt)
    const sessionDate = submittedParts?.date ?? null
    if (sessionDate && !sessionSet.has(sessionDate)) failures.push(`${label}.submittedAt must fall on a recorded trading session`)

    if (order?.status === 'filled') {
      const coherenceFailureCount = failures.length
      if (!isIsoTimestamp(order?.filledAt)) failures.push(`${label}.filledAt must be an ISO timestamp when filled`)
      const filledParts = newYorkTimestampParts(order?.filledAt)
      if (
        isIsoTimestamp(order?.submittedAt)
        && isIsoTimestamp(order?.filledAt)
        && (Date.parse(order.filledAt) < Date.parse(order.submittedAt) || filledParts?.date !== sessionDate)
      ) failures.push(`${label}.filledAt must be on the submission session and not precede submittedAt`)
      if (
        paperApprovalAt !== null
        && isIsoTimestamp(order?.filledAt)
        && Date.parse(order.filledAt) < Date.parse(paperApprovalAt)
      ) failures.push(`${label}.filledAt cannot precede the paper approval timestamp`)
      if (
        filledParts !== null
        && (
          filledParts.minute < NYSE_OPEN_MINUTE
          || filledParts.minute >= reviewedNyseSessionCloseMinute(filledParts.date)
        )
      ) failures.push(`${label}.filledAt must fall within the regular New York trading session`)
      if (!finiteNumber(order?.prePositionQuantity)) failures.push(`${label}.prePositionQuantity must be finite when filled`)
      if (!finiteNumber(order?.postPositionQuantity)) failures.push(`${label}.postPositionQuantity must be finite when filled`)
      if (finiteNumber(order?.prePositionQuantity) && finiteNumber(order?.postPositionQuantity) && positiveFiniteNumber(order?.quantity)) {
        const expectedPost = order.prePositionQuantity + (order.side === 'buy' ? order.quantity : -order.quantity)
        if (Math.abs(expectedPost - order.postPositionQuantity) > POSITION_TOLERANCE) {
          failures.push(`${label} side, quantity, and pre/post signed position are incoherent`)
        }
        const increasesShortExposure = order.side === 'sell'
          && order.postPositionQuantity < 0
          && order.postPositionQuantity < order.prePositionQuantity
        if (
          reviewedBrokerProfile?.orders?.fractionalShortSales === false
          && increasesShortExposure
          && (
            !Number.isSafeInteger(order.quantity)
            || !Number.isSafeInteger(Math.abs(order.postPositionQuantity))
          )
        ) failures.push(`${label} must use whole-share quantity and resulting position when opening or increasing a short`)
      }
      if (!positiveFiniteNumber(order?.referencePriceUsd)) failures.push(`${label}.referencePriceUsd must be positive when filled`)
      if (!positiveFiniteNumber(order?.averageFillPriceUsd)) failures.push(`${label}.averageFillPriceUsd must be positive when filled`)
      if (!isIsoTimestamp(order?.referenceQuoteTimestamp)) failures.push(`${label}.referenceQuoteTimestamp must be an ISO timestamp when filled`)
      if (!positiveFiniteNumber(order?.referenceQuoteBidPriceUsd)) failures.push(`${label}.referenceQuoteBidPriceUsd must be positive when filled`)
      if (!positiveFiniteNumber(order?.referenceQuoteAskPriceUsd)) failures.push(`${label}.referenceQuoteAskPriceUsd must be positive when filled`)
      if (
        positiveFiniteNumber(order?.referenceQuoteBidPriceUsd)
        && positiveFiniteNumber(order?.referenceQuoteAskPriceUsd)
        && order.referenceQuoteAskPriceUsd < order.referenceQuoteBidPriceUsd
      ) failures.push(`${label} reference quote ask must not be below bid`)
      if (
        positiveFiniteNumber(order?.referencePriceUsd)
        && positiveFiniteNumber(order?.referenceQuoteBidPriceUsd)
        && positiveFiniteNumber(order?.referenceQuoteAskPriceUsd)
      ) {
        const midpoint = (order.referenceQuoteBidPriceUsd + order.referenceQuoteAskPriceUsd) / 2
        if (Math.abs(order.referencePriceUsd - midpoint) > Math.max(1e-8, midpoint * 1e-8)) {
          failures.push(`${label}.referencePriceUsd must equal the reviewed quote midpoint`)
        }
        const spreadBps = (order.referenceQuoteAskPriceUsd - order.referenceQuoteBidPriceUsd) / midpoint * 10000
        if (
          finiteNumber(reviewedBrokerProfile?.risk?.maxAllowedSpreadBps)
          && spreadBps > reviewedBrokerProfile.risk.maxAllowedSpreadBps + 1e-8
        ) failures.push(`${label} reference quote spread exceeds the reviewed broker profile maximum`)
      }
      if (isIsoTimestamp(order?.filledAt) && isIsoTimestamp(order?.referenceQuoteTimestamp)) {
        const quoteAgeMs = Date.parse(order.filledAt) - Date.parse(order.referenceQuoteTimestamp)
        if (quoteAgeMs > MAX_REFERENCE_QUOTE_AGE_MS || quoteAgeMs < -MAX_REFERENCE_QUOTE_FUTURE_SKEW_MS) {
          failures.push(`${label}.referenceQuoteTimestamp must be fresh at fill time`)
        }
      }
      if (
        positiveFiniteNumber(order?.quantity)
        && positiveFiniteNumber(order?.averageFillPriceUsd)
        && finiteNumber(reviewedBrokerProfile?.sizing?.minOrderUsd)
        && order.quantity * order.averageFillPriceUsd + 1e-8 < reviewedBrokerProfile.sizing.minOrderUsd
      ) failures.push(`${label} filled notional is below the reviewed broker profile minimum order USD`)
      if (positiveFiniteNumber(order?.referencePriceUsd) && positiveFiniteNumber(order?.averageFillPriceUsd)) filledOrders.push(order)
      if (failures.length === coherenceFailureCount) coherentFilledOrders.push(order)
    } else {
      for (const field of [
        'filledAt',
        'referencePriceUsd',
        'averageFillPriceUsd',
        'referenceQuoteTimestamp',
        'referenceQuoteBidPriceUsd',
        'referenceQuoteAskPriceUsd',
        'prePositionQuantity',
        'postPositionQuantity',
      ]) {
        if (order?.[field] !== null) failures.push(`${label}.${field} must be null unless status equals filled`)
      }
    }
  }

  const lastPositionBySymbol = new Map()
  for (const order of coherentFilledOrders.sort((left, right) => left.filledAt.localeCompare(right.filledAt))) {
    if (lastPositionBySymbol.has(order.symbol)) {
      const previousPost = lastPositionBySymbol.get(order.symbol)
      if (Math.abs(previousPost - order.prePositionQuantity) > POSITION_TOLERANCE) {
        failures.push(`${prefix} filled ${order.symbol} orders must form a coherent signed-position chain`)
      }
    }
    lastPositionBySymbol.set(order.symbol, order.postPositionQuantity)
  }

  const slippageBps = filledOrders.map((order) => Math.abs(order.averageFillPriceUsd / order.referencePriceUsd - 1) * 10000)
  const ungFilledOrders = filledOrders.filter((order) => order.symbol === 'UNG')
  const ungSlippageBps = ungFilledOrders.map((order) => (
    Math.abs(order.averageFillPriceUsd / order.referencePriceUsd - 1) * 10000
  ))
  return {
    strategyContractDigestSha256: artifact?.strategyContractDigestSha256 ?? null,
    brokerExecutionProfileDigestSha256: artifact?.brokerExecutionProfileDigestSha256 ?? null,
    accountPseudonymSha256: artifact?.accountPseudonymSha256 ?? null,
    periodStart: sessions[0] ?? null,
    periodEnd: sessions.at(-1) ?? null,
    tradingSessions: sessions.length,
    submittedOrders: orders.length,
    filledOrders: filledOrders.length,
    filledOrderRatio: orders.length > 0 ? round(filledOrders.length / orders.length) : 0,
    ungFilledOrders: ungFilledOrders.length,
    ungLongFilledOrders: ungFilledOrders.filter((order) => derivedUngDirection(order) === 'long').length,
    ungShortFilledOrders: ungFilledOrders.filter((order) => derivedUngDirection(order) === 'short').length,
    medianAbsoluteSlippageBps: round(median(slippageBps)),
    p95AbsoluteSlippageBps: round(nearestRankPercentile(slippageBps, 0.95)),
    ungMedianAbsoluteSlippageBps: round(median(ungSlippageBps)),
    ungP95AbsoluteSlippageBps: round(nearestRankPercentile(ungSlippageBps, 0.95)),
  }
}

function exactSummaryFailures(label, summary, expected, fields) {
  const failures = []
  for (const field of fields) {
    if (summary[field] !== expected?.[field]) {
      failures.push(`${label} ${field} (${summary[field]}) does not match the reviewed manifest (${expected?.[field]})`)
    }
  }
  return failures
}

function verifyOne({ filePath, label, expectedDigest, summarize, manifest, expected, fields }) {
  const failures = []
  let loaded
  try {
    loaded = readProtectedArtifact(filePath, label)
  } catch (error) {
    failures.push(error.message)
    return { required: true, valid: false, filePath, digestSha256: null, summary: null, failures }
  }
  if (loaded.digestSha256 !== expectedDigest) {
    failures.push(`${label} digest ${loaded.digestSha256} does not match the reviewed manifest ${expectedDigest}`)
  }
  const summary = summarize(loaded.artifact, manifest, failures)
  failures.push(...exactSummaryFailures(label, summary, expected, fields))
  return {
    required: true,
    valid: failures.length === 0,
    filePath,
    digestSha256: loaded.digestSha256,
    summary,
    failures,
  }
}

export function verifyValidationEvidenceArtifacts(repoDir, manifestPath, manifest) {
  const paths = artifactPaths(repoDir, manifestPath)
  const defaultManifestPath = path.join(repoDir, 'config', 'qore-validation-integrity.json')
  const allowTestTrustedWriter = (
    path.resolve(manifestPath) !== path.resolve(defaultManifestPath)
    && process.env.NODE_ENV === 'test'
    && process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES === '1'
  )
  const observed = manifest?.observedForwardEvidence
  const observedCount = ['independentEpisodes', 'completeSummerSeasons', 'completeWinterSeasons']
    .reduce((sum, field) => sum + (Number.isInteger(observed?.[field]) ? observed[field] : 0), 0)
  const forward = observedCount > 0
    ? verifyOne({
        filePath: paths.forward,
        label: 'forward validation evidence artifact',
        expectedDigest: observed?.evidenceArtifactDigestSha256,
        summarize: (artifact, reviewedManifest, failures) => (
          summarizeForwardArtifact(
            artifact,
            reviewedManifest,
            failures,
            repoDir,
            allowTestTrustedWriter,
          )
        ),
        manifest,
        expected: observed,
        fields: [
          'independentEpisodes',
          'completeSummerSeasons',
          'completeWinterSeasons',
          'observedThrough',
          'strategyContractDigestSha256',
          'strategyArtifactDigestSha256',
          'outcomePolicyDigestSha256',
          'preregistrationDigestSha256',
          'sealedAt',
        ],
      })
    : { required: false, valid: false, filePath: paths.forward, digestSha256: null, summary: null, failures: [] }
  const paper = manifest?.paperExecutionEvidence?.status === 'reviewed'
    ? verifyOne({
        filePath: paths.paper,
        label: 'paper execution evidence artifact',
        expectedDigest: manifest.paperExecutionEvidence.evidenceArtifactDigestSha256,
        summarize: (artifact, reviewedManifest, failures) => (
          summarizePaperArtifact(artifact, reviewedManifest, failures, repoDir)
        ),
        manifest,
        expected: manifest.paperExecutionEvidence,
        fields: [
          'strategyContractDigestSha256',
          'brokerExecutionProfileDigestSha256',
          'accountPseudonymSha256',
          'periodStart',
          'periodEnd',
          'tradingSessions',
          'submittedOrders',
          'filledOrders',
          'filledOrderRatio',
          'ungFilledOrders',
          'ungLongFilledOrders',
          'ungShortFilledOrders',
          'medianAbsoluteSlippageBps',
          'p95AbsoluteSlippageBps',
          'ungMedianAbsoluteSlippageBps',
          'ungP95AbsoluteSlippageBps',
        ],
      })
    : { required: false, valid: false, filePath: paths.paper, digestSha256: null, summary: null, failures: [] }
  return {
    paths,
    forward,
    paper,
    failures: [...forward.failures, ...paper.failures],
  }
}
