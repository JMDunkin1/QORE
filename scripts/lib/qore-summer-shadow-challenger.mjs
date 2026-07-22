import crypto from 'node:crypto'
import { link, mkdir, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { executableLiveComponentContract } from './qore-live-contract.mjs'
import { SUMMER_FORECAST_TEMPORAL_CONTRACT_ID } from './qore-summer-forecast-contract.mjs'

export const SUMMER_SHADOW_CHALLENGER_SCHEMA_VERSION = 1
export const SUMMER_SHADOW_TARGET_RECORD_SCHEMA_VERSION = 1

const COMPARATOR_CANDIDATE_ID =
  'summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-wrnone-sdef1.25-vol0-fixed'

const PARAMETER_DELTA = Object.freeze({
  minRealizedMovePct: 1.5,
  reversionMoveScaleMode: 'linear-ramp',
  reversionRampStartPct: 1.5,
  reversionFullSizeMovePct: 2,
})

function freezeCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy))
  if (!value || typeof value !== 'object') return value
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, freezeCopy(nested)]),
  ))
}

export const SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT = freezeCopy(
  executableLiveComponentContract.summer,
)

export const SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256 =
  summerShadowValueDigestSha256(SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT)

const NYSE_FULL_DAY_CLOSURES = Object.freeze({
  2026: Object.freeze([
    '2026-01-01',
    '2026-01-19',
    '2026-02-16',
    '2026-04-03',
    '2026-05-25',
    '2026-06-19',
    '2026-07-03',
    '2026-09-07',
    '2026-11-26',
    '2026-12-25',
  ]),
  2027: Object.freeze([
    '2027-01-01',
    '2027-01-18',
    '2027-02-15',
    '2027-03-26',
    '2027-05-31',
    '2027-06-18',
    '2027-07-05',
    '2027-09-06',
    '2027-11-25',
    '2027-12-24',
  ]),
  2028: Object.freeze([
    '2028-01-17',
    '2028-02-21',
    '2028-04-14',
    '2028-05-29',
    '2028-06-19',
    '2028-07-04',
    '2028-09-04',
    '2028-11-23',
    '2028-12-25',
  ]),
})

export const SUMMER_SHADOW_SESSION_CALENDAR = Object.freeze({
  market: 'NYSE equities',
  timeZone: 'America/New_York',
  reviewedYears: Object.freeze([2026, 2027, 2028]),
  fullDayClosureSource: 'https://www.nyse.com/trade/hours-calendars',
  fullDayClosures: NYSE_FULL_DAY_CLOSURES,
  unreviewedYearPolicy: 'fail-closed',
})

export const SUMMER_SHADOW_CHALLENGER = Object.freeze({
  schemaVersion: SUMMER_SHADOW_CHALLENGER_SCHEMA_VERSION,
  contractId: 'summer-realized-move-ramp-1p5-to-2-shadow-v1',
  challengerCandidateId:
    'summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv1.5-ramp1.5to2-fresh3-wrnone-sdef1.25-vol0-fixed',
  comparatorCandidateId: COMPARATOR_CANDIDATE_ID,
  role: 'prospective-research-shadow',
  executionEligible: false,
  publicStrategy: false,
  frozenOn: '2026-07-22',
  prospectiveStart: '2026-07-23',
  comparatorComponentContract: SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT,
  comparatorComponentContractDigestSha256:
    SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256,
  parameterDelta: PARAMETER_DELTA,
  evaluation: Object.freeze({
    historicalEvidenceStatus: 'development-contaminated',
    comparison: 'daily causal UNG/VOO/QQQM net return versus the unchanged selected Summer contract on the active Summer comparator schedule',
    recordTiming: 'target must be on the active Summer comparator schedule and recorded before 09:30 America/New_York on its target session',
    sessionCalendar: SUMMER_SHADOW_SESSION_CALENDAR,
    missingObservationPolicy: 'missing or late shadow targets remain missing and must not be reconstructed',
    promotionPolicy: 'research review only; this contract cannot authorize paper or live execution',
  }),
})

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_APPEND_CLOCK_SKEW_MS = 60 * 1000

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  )
}

export function summerShadowValueDigestSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export const SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256 = summerShadowValueDigestSha256(
  SUMMER_SHADOW_CHALLENGER,
)

export function summerShadowCompatibilityFailures({ activeComponentContract, embeddedShadow }) {
  const failures = []
  const activeCandidate = activeComponentContract?.selected
  try {
    validateSummerShadowChallenger(activeCandidate)
  } catch (error) {
    failures.push(error.message)
  }
  if (!embeddedShadow || typeof embeddedShadow !== 'object') {
    failures.push('The versioned Summer summary is missing the frozen shadow challenger contract.')
    return failures
  }
  if (!activeComponentContract || typeof activeComponentContract !== 'object') {
    failures.push('The active Summer component contract is missing.')
  } else if (
    activeComponentContract?.implementation?.forecastTemporalContract?.contractId
      !== SUMMER_FORECAST_TEMPORAL_CONTRACT_ID
  ) {
    failures.push('The active Summer comparator does not use the corrected target-local-day temporal contract; prospective shadow evidence is blocked.')
  } else if (
    summerShadowValueDigestSha256(activeComponentContract)
      !== SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256
  ) {
    failures.push('The active Summer component contract does not match the frozen shadow comparator contract.')
  }
  const embeddedContract = Object.fromEntries(
    Object.keys(SUMMER_SHADOW_CHALLENGER).map((field) => [field, embeddedShadow[field]]),
  )
  if (
    summerShadowValueDigestSha256(embeddedContract)
      !== SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256
  ) {
    failures.push('The versioned Summer shadow challenger does not match the current frozen contract.')
  }
  if (embeddedShadow.contractDigestSha256 !== SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256) {
    failures.push('The versioned Summer shadow challenger digest is stale or malformed.')
  }
  if (
    embeddedShadow.comparator?.candidateId !== SUMMER_SHADOW_CHALLENGER.comparatorCandidateId
    || embeddedShadow.comparator?.selectedContractUnchanged !== true
  ) {
    failures.push('The versioned Summer shadow comparator is not the unchanged frozen comparator.')
  }
  if (
    embeddedShadow.comparator?.forecastTemporalContractId
      !== SUMMER_FORECAST_TEMPORAL_CONTRACT_ID
  ) {
    failures.push('The versioned Summer shadow comparator does not bind corrected temporal inputs.')
  }
  if (activeCandidate?.candidateId !== embeddedShadow.comparator?.candidateId) {
    failures.push('The active Summer candidate does not match the versioned shadow comparator.')
  }
  return failures
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`)
}

export function validateSummerShadowChallenger(activeCandidate) {
  if (!activeCandidate || typeof activeCandidate !== 'object') {
    throw new Error('The Summer shadow challenger requires the active Summer candidate.')
  }
  if (activeCandidate.candidateId !== SUMMER_SHADOW_CHALLENGER.comparatorCandidateId) {
    throw new Error(
      `Summer shadow comparator ${activeCandidate.candidateId ?? 'missing'} does not match the frozen comparator ${SUMMER_SHADOW_CHALLENGER.comparatorCandidateId}.`,
    )
  }
  if (
    summerShadowValueDigestSha256(activeCandidate)
      !== summerShadowValueDigestSha256(SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT.selected)
  ) {
    throw new Error('The active Summer candidate parameters do not match the frozen shadow comparator.')
  }
  if (activeCandidate.minRealizedMovePct !== 2) {
    throw new Error('The Summer shadow ramp is defined only against the reviewed 2% realized-move comparator.')
  }
  const delta = SUMMER_SHADOW_CHALLENGER.parameterDelta
  assertFiniteNumber(delta.minRealizedMovePct, 'Summer shadow minimum realized move')
  assertFiniteNumber(delta.reversionRampStartPct, 'Summer shadow ramp start')
  assertFiniteNumber(delta.reversionFullSizeMovePct, 'Summer shadow full-size move')
  if (
    delta.minRealizedMovePct !== delta.reversionRampStartPct
    || delta.reversionFullSizeMovePct !== activeCandidate.minRealizedMovePct
    || delta.reversionFullSizeMovePct <= delta.reversionRampStartPct
    || delta.reversionMoveScaleMode !== 'linear-ramp'
  ) {
    throw new Error('The Summer shadow challenger must ramp linearly from 1.5% to the active 2% full-size gate.')
  }
  if (SUMMER_SHADOW_CHALLENGER.executionEligible || SUMMER_SHADOW_CHALLENGER.publicStrategy) {
    throw new Error('The Summer shadow challenger must remain research-only and execution-ineligible.')
  }
  return true
}

export function summerShadowCandidate(activeCandidate) {
  validateSummerShadowChallenger(activeCandidate)
  return {
    ...activeCandidate,
    candidateId: SUMMER_SHADOW_CHALLENGER.challengerCandidateId,
    ...SUMMER_SHADOW_CHALLENGER.parameterDelta,
  }
}

export function reversionMoveScale(realizedMovePct, candidate) {
  if (candidate?.reversionMoveScaleMode === undefined) return 1
  if (candidate.reversionMoveScaleMode !== 'linear-ramp') {
    throw new Error(`Unsupported reversion move scale mode: ${candidate.reversionMoveScaleMode}.`)
  }
  const move = Math.abs(Number(realizedMovePct))
  const start = Number(candidate.reversionRampStartPct)
  const fullSize = Number(candidate.reversionFullSizeMovePct)
  if (!Number.isFinite(move) || !Number.isFinite(start) || !Number.isFinite(fullSize) || fullSize <= start) {
    throw new Error('The Summer shadow reversion ramp is malformed.')
  }
  return Math.max(0, Math.min(1, (move - start) / (fullSize - start)))
}

function newYorkClock(timestamp) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

function parsedIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null
  return { date, year }
}

export function summerShadowMarketSessionStatus(targetDate) {
  const parsed = parsedIsoDate(targetDate)
  if (!parsed) return { session: false, reason: 'invalid-target-date' }
  const closures = NYSE_FULL_DAY_CLOSURES[parsed.year]
  if (!closures) return { session: false, reason: 'unreviewed-session-calendar-year' }
  const weekday = parsed.date.getUTCDay()
  if (weekday === 0 || weekday === 6 || closures.includes(targetDate)) {
    return { session: false, reason: 'not-us-equity-market-session' }
  }
  return { session: true, reason: null }
}

export function summerShadowRecordTiming({ targetDate, generatedAt }) {
  if (!parsedIsoDate(targetDate)) return { eligible: false, reason: 'invalid-target-date' }
  if (targetDate < SUMMER_SHADOW_CHALLENGER.prospectiveStart) {
    return { eligible: false, reason: 'before-prospective-start' }
  }
  const session = summerShadowMarketSessionStatus(targetDate)
  if (!session.session) return { eligible: false, reason: session.reason }
  const month = Number(targetDate.slice(5, 7))
  const leadMonth = Number(new Date(parsedIsoDate(targetDate).date.getTime() + 7 * 86400000)
    .toISOString().slice(5, 7))
  if (!((month >= 5 && month <= 9) || (leadMonth >= 5 && leadMonth <= 9))) {
    return { eligible: false, reason: 'outside-summer-comparator-schedule' }
  }
  const clock = newYorkClock(generatedAt)
  if (!clock) return { eligible: false, reason: 'invalid-generation-time' }
  if (clock.date !== targetDate) return { eligible: false, reason: 'not-target-session-date' }
  if (clock.minuteOfDay >= 9 * 60 + 30) return { eligible: false, reason: 'at-or-after-session-open' }
  return { eligible: true, reason: null }
}

export function createSummerShadowTargetRecord({
  generatedAt,
  targetDate,
  activeStrategyContractDigestSha256,
  activeStrategyArtifactDigestSha256,
  activeTarget,
  shadowTarget,
  inputProvenance,
}) {
  const record = {
    schemaVersion: SUMMER_SHADOW_TARGET_RECORD_SCHEMA_VERSION,
    recordKind: 'research-only-summer-shadow-target',
    generatedAt,
    targetDate,
    challengerId: SUMMER_SHADOW_CHALLENGER.contractId,
    challengerContractDigestSha256: SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256,
    activeStrategyContractDigestSha256,
    activeStrategyArtifactDigestSha256,
    executionEligible: false,
    activeTarget,
    shadowTarget,
    inputProvenance,
  }
  validateSummerShadowTargetRecord(record)
  return record
}

function assertShadowTargetProjection(target, { label, recordTargetDate, shadow }) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error(`${label} must be an object.`)
  }
  if (target.targetDate !== recordTargetDate) throw new Error(`${label}.targetDate must match the record targetDate.`)
  if (!parsedIsoDate(target.signalDate) || target.signalDate > recordTargetDate) {
    throw new Error(`${label}.signalDate must be a valid date on or before the target date.`)
  }
  for (const field of ['gasPosition', 'indexFraction', 'cashFraction', 'confidence']) {
    if (typeof target[field] !== 'number' || !Number.isFinite(target[field])) {
      throw new Error(`${label}.${field} must be a finite number.`)
    }
  }
  if (target.gasPosition < -1 || target.gasPosition > 1) throw new Error(`${label}.gasPosition must be between -1 and 1.`)
  if (target.indexFraction < 0 || target.indexFraction > 1) throw new Error(`${label}.indexFraction must be between 0 and 1.`)
  if (target.cashFraction < 0 || target.cashFraction > 1) throw new Error(`${label}.cashFraction must be between 0 and 1.`)
  if (target.confidence < 0 || target.confidence > 1) throw new Error(`${label}.confidence must be between 0 and 1.`)
  if (Math.abs(Math.abs(target.gasPosition) + target.indexFraction + target.cashFraction - 1) > 1e-6) {
    throw new Error(`${label} allocations must sum to one using absolute gas exposure.`)
  }
  const expectedDirection = target.gasPosition > 0 ? 'long' : target.gasPosition < 0 ? 'short' : 'flat'
  if (target.direction !== expectedDirection) throw new Error(`${label}.direction must agree with gasPosition.`)
  if (typeof target.windowId !== 'string' || !target.windowId || typeof target.thesisKind !== 'string' || !target.thesisKind) {
    throw new Error(`${label} windowId and thesisKind must be non-empty strings.`)
  }

  if (shadow) {
    if (target.strategyId !== 'ngas-summer-shadow-challenger') throw new Error(`${label}.strategyId is invalid.`)
    if (target.candidateId !== SUMMER_SHADOW_CHALLENGER.challengerCandidateId) throw new Error(`${label}.candidateId is invalid.`)
    if (target.executionEligible !== false) throw new Error(`${label} must be explicitly execution-ineligible.`)
  } else {
    if (target.strategyId !== 'ngas-all-year-beta') throw new Error(`${label}.strategyId is invalid.`)
    if (target.candidateId !== null) throw new Error(`${label}.candidateId must be null for the active all-year projection.`)
    if (typeof target.executionEligible !== 'boolean') throw new Error(`${label}.executionEligible must be boolean.`)
  }

  const expectedComponent = shadow ? 'research-only-summer-shadow' : 'ngas-summer-alpha'
  if (target.gasPosition === 0) {
    if (
      target.componentStrategyId !== 'index-fallback'
      || target.windowId !== 'index-fallback'
      || target.thesisKind !== 'index-fallback'
    ) {
      throw new Error(`${label} flat targets must use coherent index-fallback provenance.`)
    }
  } else if (
    target.componentStrategyId !== expectedComponent
    || target.windowId === 'index-fallback'
    || target.thesisKind === 'index-fallback'
  ) {
    throw new Error(`${label} nonzero targets must use coherent Summer component provenance.`)
  }
}

export function validateSummerShadowTargetRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('The Summer shadow target record must be an object.')
  }
  if (
    record.schemaVersion !== SUMMER_SHADOW_TARGET_RECORD_SCHEMA_VERSION
    || record.recordKind !== 'research-only-summer-shadow-target'
    || record.challengerId !== SUMMER_SHADOW_CHALLENGER.contractId
    || record.challengerContractDigestSha256 !== SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256
    || record.executionEligible !== false
  ) {
    throw new Error('The Summer shadow target record does not match the frozen research-only contract.')
  }
  if (!parsedIsoDate(record.targetDate)) throw new Error('The Summer shadow target record targetDate is invalid.')
  const generatedAt = new Date(record.generatedAt)
  if (Number.isNaN(generatedAt.getTime()) || generatedAt.toISOString() !== record.generatedAt) {
    throw new Error('The Summer shadow target record generatedAt must be a canonical ISO timestamp.')
  }
  for (const [label, digest] of [
    ['active strategy contract', record.activeStrategyContractDigestSha256],
    ['active strategy artifact', record.activeStrategyArtifactDigestSha256],
  ]) {
    if (!SHA256_PATTERN.test(String(digest ?? ''))) throw new Error(`${label} digest must be a lowercase SHA-256 digest.`)
  }
  assertShadowTargetProjection(record.activeTarget, {
    label: 'activeTarget',
    recordTargetDate: record.targetDate,
    shadow: false,
  })
  assertShadowTargetProjection(record.shadowTarget, {
    label: 'shadowTarget',
    recordTargetDate: record.targetDate,
    shadow: true,
  })
  const provenance = record.inputProvenance
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error('inputProvenance must be an object.')
  }
  for (const field of ['forecastRowsDigestSha256', 'marketDaysDigestSha256', 'storageRowsDigestSha256']) {
    if (!SHA256_PATTERN.test(String(provenance[field] ?? ''))) {
      throw new Error(`inputProvenance.${field} must be a lowercase SHA-256 digest.`)
    }
  }
  for (const field of ['forecastValidation', 'marketValidation', 'storageValidation']) {
    if (!provenance[field] || typeof provenance[field] !== 'object' || Array.isArray(provenance[field])) {
      throw new Error(`inputProvenance.${field} must be an object.`)
    }
  }
  return true
}

function appendClock(testNow) {
  if (testNow === undefined) return new Date()
  if (
    process.env.NODE_ENV !== 'test'
    || process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES !== '1'
  ) {
    throw new Error(
      'The Summer shadow test clock requires the explicit reviewed-artifact test capability.',
    )
  }
  const parsed = new Date(testNow)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== testNow) {
    throw new Error('The Summer shadow test clock must be a canonical ISO timestamp.')
  }
  return parsed
}

export async function appendSummerShadowTargetRecord({ stateDir, record, testNow }) {
  validateSummerShadowTargetRecord(record)
  const now = appendClock(testNow)
  const timing = summerShadowRecordTiming(record)
  if (!timing.eligible) return { written: false, reason: timing.reason, filePath: null }
  const currentClock = newYorkClock(now.toISOString())
  if (currentClock?.date !== record.targetDate) {
    return { written: false, reason: 'not-current-target-session-date', filePath: null }
  }
  if (currentClock.minuteOfDay >= 9 * 60 + 30) {
    return { written: false, reason: 'at-or-after-session-open', filePath: null }
  }
  if (Math.abs(now.getTime() - Date.parse(record.generatedAt)) > MAX_APPEND_CLOCK_SKEW_MS) {
    return { written: false, reason: 'generation-time-not-current', filePath: null }
  }

  const resolvedDir = path.resolve(stateDir)
  await mkdir(resolvedDir, { recursive: true, mode: 0o700 })
  const filePath = path.join(resolvedDir, `${record.targetDate}.json`)
  const temporaryPath = path.join(
    resolvedDir,
    `.${record.targetDate}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  let handle
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`)
    await handle.sync()
    await handle.close()
    handle = null
    try {
      await link(temporaryPath, filePath)
    } catch (error) {
      if (error?.code === 'EEXIST') return { written: false, reason: 'already-recorded', filePath }
      throw error
    }
    return { written: true, reason: null, filePath }
  } finally {
    await handle?.close().catch(() => {})
    await unlink(temporaryPath).catch(() => {})
  }
}
