import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadReviewedBrokerExecutionProfile } from './qore-broker-execution-profile.mjs'
import { verifyValidationEvidenceArtifacts } from './qore-validation-evidence.mjs'

export const VALIDATION_INTEGRITY_SCHEMA_VERSION = 3
export const VALIDATION_INTEGRITY_MANIFEST_ID = 'ngas-all-year-beta-prospective-validation-v2'
export const VALIDATION_INTEGRITY_STRATEGY_ID = 'ngas-all-year-beta'
export const ALL_YEAR_STRATEGY_ARTIFACT_CORE_SCHEMA_VERSION = 2
export const ALL_YEAR_SELECTION_CONTRACT = Object.freeze({
  schemaVersion: 1,
  policyId: 'summer-material-else-winter-material-else-index-v1',
  componentPriority: ['ngas-summer-alpha', 'ngas-winter-alpha'],
  materialRowPolicy: 'non-index thesis, non-zero gas target, or explicit index-to-cash allocation change',
  overlapPolicy: 'fail-closed',
  fallbackPolicy: 'configured-voo-qqqm-index-basket',
})

const HISTORICAL_DATE_FIELDS = ['evidenceStart', 'developmentBegan', 'observedThrough', 'prospectiveStart']
const EVIDENCE_FIELDS = ['independentEpisodes', 'completeSummerSeasons', 'completeWinterSeasons']
const APPROVAL_KINDS = ['paper', 'live']
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PAPER_EVIDENCE_NULL_FIELDS = [
  'strategyContractDigestSha256',
  'brokerExecutionProfileDigestSha256',
  'accountPseudonymSha256',
  'periodStart',
  'periodEnd',
  'medianAbsoluteSlippageBps',
  'p95AbsoluteSlippageBps',
  'evidenceArtifactDigestSha256',
  'reviewedAt',
]

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

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isNonNegativeFiniteNumber(value) {
  return Number.isFinite(value) && value >= 0
}

function isSha256(value) {
  return SHA256_PATTERN.test(String(value ?? ''))
}

function dateMs(value) {
  return Date.parse(`${value}T00:00:00.000Z`)
}

function validationCutoff(asOf) {
  const parsed = asOf instanceof Date ? new Date(asOf.getTime()) : new Date(asOf)
  if (Number.isNaN(parsed.getTime())) throw new Error('validation asOf must be a valid timestamp')
  return {
    timestampMs: parsed.getTime(),
    calendarDate: parsed.toISOString().slice(0, 10),
  }
}

function inclusiveCalendarDays(start, end) {
  return Math.floor((dateMs(end) - dateMs(start)) / 86400000) + 1
}

function completeSeasonCount(start, end, kind) {
  if (!isDate(start) || !isDate(end) || start > end) return 0
  const startYear = Number(start.slice(0, 4))
  const endYear = Number(end.slice(0, 4))
  let count = 0
  for (let year = startYear - 1; year <= endYear + 1; year += 1) {
    const seasonStart = kind === 'summer' ? `${year}-05-01` : `${year}-11-01`
    const seasonEnd = kind === 'summer' ? `${year}-09-30` : `${year + 1}-03-31`
    if (start <= seasonStart && seasonEnd <= end) count += 1
  }
  return count
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  )
}

function withoutObjectFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => !fields.has(field)),
  )
}

const ARTIFACT_DYNAMIC_SEARCH_FIELDS = new Set([
  'eligibleCandidateCount',
  'selectionStatus',
  'paperEligible',
  'liveEligible',
])
const ARTIFACT_DYNAMIC_VALIDATION_FIELDS = new Set([
  'integrity',
  'eligibility',
])
const ARTIFACT_DYNAMIC_PROMOTION_GATE_FIELDS = new Set([
  'pristineForwardEvidence',
  'strategyContractSeal',
  'paperApproval',
  'paperExecutionEvidence',
  'liveApproval',
])

// This core is the immutable object sealed before prospective evidence starts.
// It deliberately excludes the manifest/evidence/approval state written back into
// the run summary, while retaining research results and independently verifiable
// promotion gates. That makes sealing a fixed point instead of a raw-file cycle.
export function allYearStrategyArtifactCore(summary) {
  const artifact = withoutObjectFields(summary, new Set(['generatedAt', 'status']))
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return {
      schemaVersion: ALL_YEAR_STRATEGY_ARTIFACT_CORE_SCHEMA_VERSION,
      artifact: null,
    }
  }

  artifact.search = withoutObjectFields(summary?.search, ARTIFACT_DYNAMIC_SEARCH_FIELDS)
  artifact.validation = withoutObjectFields(summary?.validation, ARTIFACT_DYNAMIC_VALIDATION_FIELDS)
  if (artifact.validation && typeof artifact.validation === 'object' && !Array.isArray(artifact.validation)) {
    artifact.validation.promotionGates = withoutObjectFields(
      summary?.validation?.promotionGates,
      ARTIFACT_DYNAMIC_PROMOTION_GATE_FIELDS,
    )
  }
  artifact.candidates = Array.isArray(summary?.candidates)
    ? summary.candidates.map((candidate) => withoutObjectFields(candidate, new Set(['eligible'])))
    : summary?.candidates ?? null

  return {
    schemaVersion: ALL_YEAR_STRATEGY_ARTIFACT_CORE_SCHEMA_VERSION,
    artifact,
  }
}

export function allYearStrategyArtifactCoreDigestSha256(summary) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(allYearStrategyArtifactCore(summary))))
    .digest('hex')
}

export function allYearStrategyContract(summary) {
  return {
    schemaVersion: 1,
    strategyId: summary?.strategyId ?? null,
    allYearSelection: summary?.contract?.allYearSelection ?? null,
    liveComponentContract: summary?.contract?.liveInference?.componentContract ?? null,
    liveTargetParity: summary?.contract?.liveTargetParity ?? null,
    researchExecution: summary?.contract?.execution ?? null,
    brokerExecution: {
      schemaVersion: summary?.contract?.brokerExecution?.schemaVersion ?? null,
      profileId: summary?.contract?.brokerExecution?.profileId ?? null,
      profileDigestSha256: summary?.contract?.brokerExecution?.profileDigestSha256 ?? null,
    },
    overnightRisk: {
      contractId: summary?.contract?.overnightRisk?.contractId ?? null,
      contractDigest: summary?.contract?.overnightRisk?.contractDigest ?? null,
      deployedPolicyId: summary?.contract?.overnightRisk?.deployedPolicyId ?? null,
    },
  }
}

export function allYearStrategyContractDigestSha256(summary) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(allYearStrategyContract(summary))))
    .digest('hex')
}

function validateApproval(approval, kind, manifest, failures) {
  if (!approval || typeof approval !== 'object') {
    failures.push(`${kind} approval must be an object`)
    return
  }
  if (!['absent', 'approved'].includes(approval.status)) {
    failures.push(`${kind} approval status must equal absent or approved`)
    return
  }
  if (approval.status === 'absent') {
    if (
      approval.approvalId !== null
      || approval.approvedAt !== null
      || approval.strategyContractDigestSha256 !== null
      || approval.brokerExecutionProfileDigestSha256 !== null
    ) {
      failures.push(`${kind} approval must not carry approval metadata while absent`)
    }
    return
  }
  if (typeof approval.approvalId !== 'string' || !approval.approvalId.trim()) {
    failures.push(`${kind} approvalId is required when approved`)
  }
  if (!isIsoTimestamp(approval.approvedAt)) {
    failures.push(`${kind} approvedAt must be an ISO timestamp when approved`)
  }
  if (!isSha256(approval.strategyContractDigestSha256)) {
    failures.push(`${kind} approval strategy-contract digest must be a lowercase SHA-256 digest`)
  }
  if (!isSha256(approval.brokerExecutionProfileDigestSha256)) {
    failures.push(`${kind} approval broker-profile digest must be a lowercase SHA-256 digest`)
  }
  if (approval.strategyContractDigestSha256 !== manifest?.sealedStrategyContractDigestSha256) {
    failures.push(`${kind} approval strategy-contract digest must equal the sealed strategy contract`)
  }
  if (approval.brokerExecutionProfileDigestSha256 !== manifest?.sealedBrokerExecutionProfileDigestSha256) {
    failures.push(`${kind} approval broker-profile digest must equal the sealed broker execution profile`)
  }
}

function validatePaperExecutionEvidence(manifest, failures) {
  const minimum = manifest?.minimumPaperExecutionEvidence
  if (!minimum || typeof minimum !== 'object') {
    failures.push('minimumPaperExecutionEvidence must be an object')
  } else {
    for (const field of [
      'tradingSessions',
      'filledOrders',
      'ungFilledOrders',
      'ungLongFilledOrders',
      'ungShortFilledOrders',
    ]) {
      if (!Number.isInteger(minimum[field]) || minimum[field] < 1) {
        failures.push(`minimumPaperExecutionEvidence.${field} must be a positive integer`)
      }
    }
    for (const field of ['maximumMedianAbsoluteSlippageBps', 'maximumP95AbsoluteSlippageBps']) {
      if (!isNonNegativeFiniteNumber(minimum[field])) {
        failures.push(`minimumPaperExecutionEvidence.${field} must be a non-negative finite number`)
      }
    }
    if (
      isNonNegativeFiniteNumber(minimum.maximumMedianAbsoluteSlippageBps)
      && isNonNegativeFiniteNumber(minimum.maximumP95AbsoluteSlippageBps)
      && minimum.maximumP95AbsoluteSlippageBps < minimum.maximumMedianAbsoluteSlippageBps
    ) {
      failures.push('minimumPaperExecutionEvidence maximum p95 slippage must be at least the maximum median slippage')
    }
  }

  const evidence = manifest?.paperExecutionEvidence
  if (!evidence || typeof evidence !== 'object') {
    failures.push('paperExecutionEvidence must be an object')
    return
  }
  if (!['absent', 'reviewed'].includes(evidence.status)) {
    failures.push('paperExecutionEvidence.status must equal absent or reviewed')
    return
  }
  const countFields = [
    'tradingSessions',
    'submittedOrders',
    'filledOrders',
    'ungFilledOrders',
    'ungLongFilledOrders',
    'ungShortFilledOrders',
  ]
  for (const field of countFields) {
    if (!isNonNegativeInteger(evidence[field])) {
      failures.push(`paperExecutionEvidence.${field} must be a non-negative integer`)
    }
  }
  if (evidence.status === 'absent') {
    for (const field of PAPER_EVIDENCE_NULL_FIELDS) {
      if (evidence[field] !== null) failures.push(`paperExecutionEvidence.${field} must be null while absent`)
    }
    for (const field of countFields) {
      if (evidence[field] !== 0) failures.push(`paperExecutionEvidence.${field} must equal zero while absent`)
    }
    return
  }

  for (const field of [
    'strategyContractDigestSha256',
    'brokerExecutionProfileDigestSha256',
    'accountPseudonymSha256',
    'evidenceArtifactDigestSha256',
  ]) {
    if (!isSha256(evidence[field])) failures.push(`paperExecutionEvidence.${field} must be a lowercase SHA-256 digest when reviewed`)
  }
  for (const field of ['periodStart', 'periodEnd']) {
    if (!isDate(evidence[field])) failures.push(`paperExecutionEvidence.${field} must be a calendar date when reviewed`)
  }
  if (!isIsoTimestamp(evidence.reviewedAt)) {
    failures.push('paperExecutionEvidence.reviewedAt must be an ISO timestamp when reviewed')
  }
  for (const field of ['medianAbsoluteSlippageBps', 'p95AbsoluteSlippageBps']) {
    if (!isNonNegativeFiniteNumber(evidence[field])) {
      failures.push(`paperExecutionEvidence.${field} must be a non-negative finite number when reviewed`)
    }
  }
  if (
    isDate(evidence.periodStart)
    && isDate(evidence.periodEnd)
    && isDate(manifest?.historicalEvidence?.prospectiveStart)
    && !(manifest.historicalEvidence.prospectiveStart <= evidence.periodStart && evidence.periodStart <= evidence.periodEnd)
  ) {
    failures.push('paper execution evidence must start on or after prospectiveStart and end on or after it starts')
  }
  if (
    isDate(evidence.periodStart)
    && isDate(evidence.periodEnd)
    && isNonNegativeInteger(evidence.tradingSessions)
    && evidence.tradingSessions > inclusiveCalendarDays(evidence.periodStart, evidence.periodEnd)
  ) {
    failures.push('paperExecutionEvidence.tradingSessions cannot exceed the calendar days in its evidence period')
  }
  if (
    isNonNegativeInteger(evidence.submittedOrders)
    && isNonNegativeInteger(evidence.filledOrders)
    && evidence.filledOrders > evidence.submittedOrders
  ) {
    failures.push('paperExecutionEvidence.filledOrders cannot exceed submittedOrders')
  }
  if (
    isNonNegativeInteger(evidence.ungFilledOrders)
    && isNonNegativeInteger(evidence.filledOrders)
    && evidence.ungFilledOrders > evidence.filledOrders
  ) {
    failures.push('paperExecutionEvidence.ungFilledOrders cannot exceed filledOrders')
  }
  if (
    isNonNegativeInteger(evidence.ungLongFilledOrders)
    && isNonNegativeInteger(evidence.ungShortFilledOrders)
    && isNonNegativeInteger(evidence.ungFilledOrders)
    && evidence.ungLongFilledOrders + evidence.ungShortFilledOrders > evidence.ungFilledOrders
  ) {
    failures.push('paperExecutionEvidence directional UNG fills cannot exceed ungFilledOrders')
  }
  if (
    isNonNegativeFiniteNumber(evidence.medianAbsoluteSlippageBps)
    && isNonNegativeFiniteNumber(evidence.p95AbsoluteSlippageBps)
    && evidence.p95AbsoluteSlippageBps < evidence.medianAbsoluteSlippageBps
  ) {
    failures.push('paperExecutionEvidence p95 slippage cannot be below median slippage')
  }
  if (
    isIsoTimestamp(evidence.reviewedAt)
    && isDate(evidence.periodEnd)
    && evidence.reviewedAt.slice(0, 10) <= evidence.periodEnd
  ) {
    failures.push('paperExecutionEvidence.reviewedAt must be after periodEnd')
  }
}

function paperExecutionEvidenceClaimsSatisfied(manifest) {
  const minimum = manifest?.minimumPaperExecutionEvidence
  const evidence = manifest?.paperExecutionEvidence
  return evidence?.status === 'reviewed'
    && isSha256(evidence.strategyContractDigestSha256)
    && evidence.strategyContractDigestSha256 === manifest?.sealedStrategyContractDigestSha256
    && isSha256(evidence.brokerExecutionProfileDigestSha256)
    && evidence.brokerExecutionProfileDigestSha256 === manifest?.sealedBrokerExecutionProfileDigestSha256
    && isSha256(evidence.accountPseudonymSha256)
    && isSha256(evidence.evidenceArtifactDigestSha256)
    && isDate(evidence.periodStart)
    && isDate(evidence.periodEnd)
    && evidence.periodStart >= manifest?.historicalEvidence?.prospectiveStart
    && evidence.periodEnd >= evidence.periodStart
    && isNonNegativeInteger(evidence.tradingSessions)
    && evidence.tradingSessions >= minimum?.tradingSessions
    && isNonNegativeInteger(evidence.submittedOrders)
    && isNonNegativeInteger(evidence.filledOrders)
    && evidence.filledOrders >= minimum?.filledOrders
    && evidence.filledOrders <= evidence.submittedOrders
    && isNonNegativeInteger(evidence.ungFilledOrders)
    && evidence.ungFilledOrders >= minimum?.ungFilledOrders
    && evidence.ungFilledOrders <= evidence.filledOrders
    && isNonNegativeInteger(evidence.ungLongFilledOrders)
    && evidence.ungLongFilledOrders >= minimum?.ungLongFilledOrders
    && isNonNegativeInteger(evidence.ungShortFilledOrders)
    && evidence.ungShortFilledOrders >= minimum?.ungShortFilledOrders
    && evidence.ungLongFilledOrders + evidence.ungShortFilledOrders <= evidence.ungFilledOrders
    && isNonNegativeFiniteNumber(evidence.medianAbsoluteSlippageBps)
    && evidence.medianAbsoluteSlippageBps <= minimum?.maximumMedianAbsoluteSlippageBps
    && isNonNegativeFiniteNumber(evidence.p95AbsoluteSlippageBps)
    && evidence.p95AbsoluteSlippageBps <= minimum?.maximumP95AbsoluteSlippageBps
    && evidence.p95AbsoluteSlippageBps >= evidence.medianAbsoluteSlippageBps
    && isIsoTimestamp(evidence.reviewedAt)
    && evidence.reviewedAt.slice(0, 10) > evidence.periodEnd
}

export function paperExecutionEvidenceSatisfied(manifest, evidenceVerification = null) {
  return paperExecutionEvidenceClaimsSatisfied(manifest)
    && evidenceVerification?.paper?.valid === true
}

export function resolveValidationIntegrityManifestPath(repoDir) {
  const configured = process.env.QORE_VALIDATION_INTEGRITY_FILE
  if (
    configured
    && !(
      process.env.NODE_ENV === 'test'
      && process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES === '1'
    )
  ) {
    throw new Error('QORE_VALIDATION_INTEGRITY_FILE requires the explicit reviewed-artifact test capability; runtime routing is bound to the checked-in validation-integrity manifest.')
  }
  return configured
    ? path.resolve(configured)
    : path.join(repoDir, 'config', 'qore-validation-integrity.json')
}

export function validateValidationIntegrityManifest(manifest, { asOf = new Date() } = {}) {
  const failures = []
  const cutoff = validationCutoff(asOf)
  if (manifest?.schemaVersion !== VALIDATION_INTEGRITY_SCHEMA_VERSION) {
    failures.push(`schemaVersion must equal ${VALIDATION_INTEGRITY_SCHEMA_VERSION}`)
  }
  if (manifest?.manifestId !== VALIDATION_INTEGRITY_MANIFEST_ID) {
    failures.push(`manifestId must equal ${VALIDATION_INTEGRITY_MANIFEST_ID}`)
  }
  if (manifest?.strategyId !== VALIDATION_INTEGRITY_STRATEGY_ID) {
    failures.push(`strategyId must equal ${VALIDATION_INTEGRITY_STRATEGY_ID}`)
  }
  if (!isIsoTimestamp(manifest?.reviewedAt)) failures.push('reviewedAt must be an ISO timestamp')
  else if (Date.parse(manifest.reviewedAt) > cutoff.timestampMs) failures.push('reviewedAt cannot be in the future')

  const historical = manifest?.historicalEvidence
  if (!historical || typeof historical !== 'object') {
    failures.push('historicalEvidence must be an object')
  } else {
    if (historical.status !== 'development-contaminated') {
      failures.push('historicalEvidence.status must equal development-contaminated')
    }
    for (const field of HISTORICAL_DATE_FIELDS) {
      if (!isDate(historical[field])) failures.push(`historicalEvidence.${field} must be a calendar date`)
    }
    if (typeof historical.pristineForwardEvidence !== 'boolean') {
      failures.push('historicalEvidence.pristineForwardEvidence must be boolean')
    }
    if (
      HISTORICAL_DATE_FIELDS.every((field) => isDate(historical[field]))
      && !(
        historical.evidenceStart <= historical.developmentBegan
        && historical.developmentBegan <= historical.observedThrough
        && historical.observedThrough < historical.prospectiveStart
      )
    ) {
      failures.push('historical evidence dates must satisfy evidenceStart <= developmentBegan <= observedThrough < prospectiveStart')
    }
    if (isDate(historical.observedThrough) && historical.observedThrough >= cutoff.calendarDate) {
      failures.push('historicalEvidence.observedThrough must precede the validation cutoff date')
    }
  }

  const minimum = manifest?.minimumForwardEvidence
  const observed = manifest?.observedForwardEvidence
  for (const [label, evidence, requirePositive] of [
    ['minimumForwardEvidence', minimum, true],
    ['observedForwardEvidence', observed, false],
  ]) {
    if (!evidence || typeof evidence !== 'object') {
      failures.push(`${label} must be an object`)
      continue
    }
    for (const field of EVIDENCE_FIELDS) {
      if (!isNonNegativeInteger(evidence[field]) || (requirePositive && evidence[field] < 1)) {
        failures.push(`${label}.${field} must be a ${requirePositive ? 'positive' : 'non-negative'} integer`)
      }
    }
  }

  if (observed && typeof observed === 'object') {
    const observedCount = EVIDENCE_FIELDS.reduce((sum, field) => (
      sum + (isNonNegativeInteger(observed[field]) ? observed[field] : 0)
    ), 0)
    if (observedCount === 0) {
      for (const field of [
        'observedThrough',
        'strategyContractDigestSha256',
        'strategyArtifactDigestSha256',
        'evidenceArtifactDigestSha256',
        'reviewedAt',
      ]) {
        if (observed[field] !== null) failures.push(`observedForwardEvidence.${field} must be null while no evidence is recorded`)
      }
    } else {
      if (!isDate(observed.observedThrough)) {
        failures.push('observedForwardEvidence.observedThrough must be a calendar date when evidence is recorded')
      }
      for (const field of [
        'strategyContractDigestSha256',
        'strategyArtifactDigestSha256',
        'evidenceArtifactDigestSha256',
      ]) {
        if (!isSha256(observed[field])) failures.push(`observedForwardEvidence.${field} must be a lowercase SHA-256 digest when evidence is recorded`)
      }
      if (!isIsoTimestamp(observed.reviewedAt)) {
        failures.push('observedForwardEvidence.reviewedAt must be an ISO timestamp when evidence is recorded')
      }
      if (
        isDate(historical?.prospectiveStart)
        && isDate(observed.observedThrough)
        && observed.observedThrough < historical.prospectiveStart
      ) {
        failures.push('observedForwardEvidence.observedThrough cannot precede prospectiveStart')
      }
      if (isDate(observed.observedThrough) && observed.observedThrough >= cutoff.calendarDate) {
        failures.push('observedForwardEvidence.observedThrough must precede the validation cutoff date')
      }
      if (
        isDate(observed.observedThrough)
        && isIsoTimestamp(observed.reviewedAt)
        && observed.reviewedAt.slice(0, 10) <= observed.observedThrough
      ) {
        failures.push('observedForwardEvidence.reviewedAt must be after observedThrough')
      }
      if (isIsoTimestamp(observed.reviewedAt) && Date.parse(observed.reviewedAt) > cutoff.timestampMs) {
        failures.push('observedForwardEvidence.reviewedAt cannot be in the future')
      }
      if (
        isDate(historical?.prospectiveStart)
        && isDate(observed.observedThrough)
        && isNonNegativeInteger(observed.independentEpisodes)
        && observed.independentEpisodes > inclusiveCalendarDays(historical.prospectiveStart, observed.observedThrough)
      ) {
        failures.push('observedForwardEvidence.independentEpisodes cannot exceed elapsed prospective calendar days')
      }
      if (
        isDate(historical?.prospectiveStart)
        && isDate(observed.observedThrough)
        && isNonNegativeInteger(observed.completeSummerSeasons)
        && observed.completeSummerSeasons > completeSeasonCount(historical.prospectiveStart, observed.observedThrough, 'summer')
      ) {
        failures.push('observedForwardEvidence.completeSummerSeasons exceeds the complete prospective Summer seasons available')
      }
      if (
        isDate(historical?.prospectiveStart)
        && isDate(observed.observedThrough)
        && isNonNegativeInteger(observed.completeWinterSeasons)
        && observed.completeWinterSeasons > completeSeasonCount(historical.prospectiveStart, observed.observedThrough, 'winter')
      ) {
        failures.push('observedForwardEvidence.completeWinterSeasons exceeds the complete prospective Winter seasons available')
      }
    }
  }

  validatePaperExecutionEvidence(manifest, failures)

  for (const kind of APPROVAL_KINDS) validateApproval(manifest?.approvals?.[kind], kind, manifest, failures)

  if (
    historical?.pristineForwardEvidence === true
    && minimum
    && observed
    && EVIDENCE_FIELDS.some((field) => observed[field] < minimum[field])
  ) {
    failures.push('pristineForwardEvidence cannot be true before every minimum forward-evidence requirement is met')
  }
  const sealedDigest = manifest?.sealedStrategyContractDigestSha256
  if (sealedDigest !== null && !isSha256(sealedDigest)) {
    failures.push('sealedStrategyContractDigestSha256 must be null or a lowercase SHA-256 digest')
  }
  if (historical?.pristineForwardEvidence === true && sealedDigest === null) {
    failures.push('pristineForwardEvidence cannot be true without a sealed strategy-contract digest')
  }
  const sealedStrategyArtifactDigest = manifest?.sealedStrategyArtifactDigestSha256
  if (sealedStrategyArtifactDigest !== null && !isSha256(sealedStrategyArtifactDigest)) {
    failures.push('sealedStrategyArtifactDigestSha256 must be null or a lowercase SHA-256 digest')
  }
  if (historical?.pristineForwardEvidence === true && sealedStrategyArtifactDigest === null) {
    failures.push('pristineForwardEvidence cannot be true without a sealed strategy-artifact digest')
  }
  const sealedBrokerProfileDigest = manifest?.sealedBrokerExecutionProfileDigestSha256
  if (!isSha256(sealedBrokerProfileDigest)) {
    failures.push('sealedBrokerExecutionProfileDigestSha256 must be a lowercase SHA-256 digest')
  }
  if (
    historical?.pristineForwardEvidence === true
    && observed?.strategyContractDigestSha256 !== sealedDigest
  ) {
    failures.push('pristine forward evidence must be bound to the sealed strategy-contract digest')
  }
  if (
    historical?.pristineForwardEvidence === true
    && observed?.strategyArtifactDigestSha256 !== sealedStrategyArtifactDigest
  ) {
    failures.push('pristine forward evidence must be bound to the sealed strategy-artifact digest')
  }
  if (
    manifest?.paperExecutionEvidence?.status === 'reviewed'
    && manifest.paperExecutionEvidence.strategyContractDigestSha256 !== sealedDigest
  ) {
    failures.push('paper execution evidence must be bound to the sealed strategy-contract digest')
  }
  if (
    manifest?.paperExecutionEvidence?.status === 'reviewed'
    && manifest.paperExecutionEvidence.brokerExecutionProfileDigestSha256 !== sealedBrokerProfileDigest
  ) {
    failures.push('paper execution evidence must be bound to the sealed broker execution profile')
  }

  const paperApproval = manifest?.approvals?.paper
  const liveApproval = manifest?.approvals?.live
  const manifestReviewedAt = isIsoTimestamp(manifest?.reviewedAt) ? Date.parse(manifest.reviewedAt) : null
  for (const [kind, approval] of [['paper', paperApproval], ['live', liveApproval]]) {
    if (
      approval?.status === 'approved'
      && isIsoTimestamp(approval.approvedAt)
      && Date.parse(approval.approvedAt) > cutoff.timestampMs
    ) {
      failures.push(`${kind} approval cannot be in the future`)
    }
    if (
      approval?.status === 'approved'
      && isIsoTimestamp(approval.approvedAt)
      && manifestReviewedAt !== null
      && Date.parse(approval.approvedAt) > manifestReviewedAt
    ) {
      failures.push(`${kind} approval cannot postdate the manifest review`)
    }
  }
  const paperEvidence = manifest?.paperExecutionEvidence
  if (
    paperEvidence?.status === 'reviewed'
    && isIsoTimestamp(paperEvidence.reviewedAt)
    && Date.parse(paperEvidence.reviewedAt) > cutoff.timestampMs
  ) {
    failures.push('paper execution evidence review cannot be in the future')
  }
  if (
    paperEvidence?.status === 'reviewed'
    && isDate(paperEvidence.periodEnd)
    && paperEvidence.periodEnd >= cutoff.calendarDate
  ) {
    failures.push('paper execution evidence periodEnd must precede the validation cutoff date')
  }
  if (
    paperEvidence?.status === 'reviewed'
    && isIsoTimestamp(paperEvidence.reviewedAt)
    && manifestReviewedAt !== null
    && Date.parse(paperEvidence.reviewedAt) > manifestReviewedAt
  ) {
    failures.push('paper execution evidence review cannot postdate the manifest review')
  }
  if (
    paperEvidence?.status === 'reviewed'
    && paperApproval?.status === 'approved'
    && isIsoTimestamp(paperApproval.approvedAt)
    && isDate(paperEvidence.periodStart)
    && paperEvidence.periodStart < paperApproval.approvedAt.slice(0, 10)
  ) {
    failures.push('paper execution evidence cannot start before paper approval')
  }
  if (liveApproval?.status === 'approved') {
    if (paperApproval?.status !== 'approved') failures.push('live approval requires paper approval')
    if (historical?.pristineForwardEvidence !== true) failures.push('live approval requires pristine forward evidence')
    if (!paperExecutionEvidenceClaimsSatisfied(manifest)) failures.push('live approval requires sufficient reviewed paper execution evidence')
    if (
      isIsoTimestamp(liveApproval.approvedAt)
      && isIsoTimestamp(paperApproval?.approvedAt)
      && Date.parse(liveApproval.approvedAt) < Date.parse(paperApproval.approvedAt)
    ) {
      failures.push('live approval cannot precede paper approval')
    }
    if (
      isIsoTimestamp(liveApproval.approvedAt)
      && isIsoTimestamp(paperEvidence?.reviewedAt)
      && Date.parse(liveApproval.approvedAt) < Date.parse(paperEvidence.reviewedAt)
    ) {
      failures.push('live approval cannot precede the paper execution evidence review')
    }
    if (
      isIsoTimestamp(liveApproval.approvedAt)
      && isIsoTimestamp(observed?.reviewedAt)
      && Date.parse(liveApproval.approvedAt) < Date.parse(observed.reviewedAt)
    ) {
      failures.push('live approval cannot precede the prospective forward-evidence review')
    }
  }
  return failures
}

export function validationIntegrityBinding(manifest, digestSha256, evidenceVerification = null) {
  return {
    manifestSchemaVersion: manifest.schemaVersion,
    manifestId: manifest.manifestId,
    manifestDigestSha256: digestSha256,
    sealedStrategyContractDigestSha256: manifest.sealedStrategyContractDigestSha256,
    sealedStrategyArtifactDigestSha256: manifest.sealedStrategyArtifactDigestSha256,
    sealedBrokerExecutionProfileDigestSha256: manifest.sealedBrokerExecutionProfileDigestSha256,
    historicalEvidenceStatus: manifest.historicalEvidence.status,
    historicalEvidenceStart: manifest.historicalEvidence.evidenceStart,
    developmentBegan: manifest.historicalEvidence.developmentBegan,
    observedThrough: manifest.historicalEvidence.observedThrough,
    prospectiveStart: manifest.historicalEvidence.prospectiveStart,
    pristineForwardEvidence:
      manifest.historicalEvidence.pristineForwardEvidence === true
      && evidenceVerification?.forward?.valid === true,
    minimumIndependentEpisodes: manifest.minimumForwardEvidence.independentEpisodes,
    minimumCompleteSummerSeasons: manifest.minimumForwardEvidence.completeSummerSeasons,
    minimumCompleteWinterSeasons: manifest.minimumForwardEvidence.completeWinterSeasons,
    observedIndependentEpisodes: manifest.observedForwardEvidence.independentEpisodes,
    observedCompleteSummerSeasons: manifest.observedForwardEvidence.completeSummerSeasons,
    observedCompleteWinterSeasons: manifest.observedForwardEvidence.completeWinterSeasons,
    forwardObservedThrough: manifest.observedForwardEvidence.observedThrough,
    forwardEvidenceStrategyContractDigestSha256: manifest.observedForwardEvidence.strategyContractDigestSha256,
    forwardEvidenceStrategyArtifactDigestSha256: manifest.observedForwardEvidence.strategyArtifactDigestSha256,
    forwardEvidenceArtifactDigestSha256: manifest.observedForwardEvidence.evidenceArtifactDigestSha256,
    forwardEvidenceReviewedAt: manifest.observedForwardEvidence.reviewedAt,
    minimumPaperTradingSessions: manifest.minimumPaperExecutionEvidence.tradingSessions,
    minimumPaperFilledOrders: manifest.minimumPaperExecutionEvidence.filledOrders,
    minimumPaperUngFilledOrders: manifest.minimumPaperExecutionEvidence.ungFilledOrders,
    minimumPaperUngLongFilledOrders: manifest.minimumPaperExecutionEvidence.ungLongFilledOrders,
    minimumPaperUngShortFilledOrders: manifest.minimumPaperExecutionEvidence.ungShortFilledOrders,
    maximumPaperMedianAbsoluteSlippageBps: manifest.minimumPaperExecutionEvidence.maximumMedianAbsoluteSlippageBps,
    maximumPaperP95AbsoluteSlippageBps: manifest.minimumPaperExecutionEvidence.maximumP95AbsoluteSlippageBps,
    paperExecutionEvidenceStatus: manifest.paperExecutionEvidence.status,
    paperExecutionStrategyContractDigestSha256: manifest.paperExecutionEvidence.strategyContractDigestSha256,
    paperExecutionBrokerProfileDigestSha256: manifest.paperExecutionEvidence.brokerExecutionProfileDigestSha256,
    paperExecutionPeriodStart: manifest.paperExecutionEvidence.periodStart,
    paperExecutionPeriodEnd: manifest.paperExecutionEvidence.periodEnd,
    paperExecutionTradingSessions: manifest.paperExecutionEvidence.tradingSessions,
    paperExecutionSubmittedOrders: manifest.paperExecutionEvidence.submittedOrders,
    paperExecutionFilledOrders: manifest.paperExecutionEvidence.filledOrders,
    paperExecutionUngFilledOrders: manifest.paperExecutionEvidence.ungFilledOrders,
    paperExecutionUngLongFilledOrders: manifest.paperExecutionEvidence.ungLongFilledOrders,
    paperExecutionUngShortFilledOrders: manifest.paperExecutionEvidence.ungShortFilledOrders,
    paperExecutionMedianAbsoluteSlippageBps: manifest.paperExecutionEvidence.medianAbsoluteSlippageBps,
    paperExecutionP95AbsoluteSlippageBps: manifest.paperExecutionEvidence.p95AbsoluteSlippageBps,
    paperExecutionEvidenceArtifactDigestSha256: manifest.paperExecutionEvidence.evidenceArtifactDigestSha256,
    paperExecutionEvidenceReviewedAt: manifest.paperExecutionEvidence.reviewedAt,
    paperExecutionEvidenceSatisfied: paperExecutionEvidenceSatisfied(manifest, evidenceVerification),
    paperApprovalStatus: manifest.approvals.paper.status,
    paperApprovalStrategyContractDigestSha256: manifest.approvals.paper.strategyContractDigestSha256,
    paperApprovalBrokerProfileDigestSha256: manifest.approvals.paper.brokerExecutionProfileDigestSha256,
    liveApprovalStatus: manifest.approvals.live.status,
    liveApprovalStrategyContractDigestSha256: manifest.approvals.live.strategyContractDigestSha256,
    liveApprovalBrokerProfileDigestSha256: manifest.approvals.live.brokerExecutionProfileDigestSha256,
  }
}

export function loadValidationIntegrityManifest(repoDir, { asOf = new Date() } = {}) {
  const filePath = resolveValidationIntegrityManifestPath(repoDir)
  let raw
  let manifest
  try {
    raw = fs.readFileSync(filePath)
    manifest = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    throw new Error(`Unable to read the reviewed validation-integrity manifest: ${error.message}`)
  }
  const failures = validateValidationIntegrityManifest(manifest, { asOf })
  try {
    const reviewedProfile = loadReviewedBrokerExecutionProfile(repoDir)
    if (manifest?.sealedBrokerExecutionProfileDigestSha256 !== reviewedProfile.profileDigestSha256) {
      failures.push('sealedBrokerExecutionProfileDigestSha256 must equal the reviewed broker execution profile')
    }
  } catch (error) {
    failures.push(`Unable to verify the reviewed broker execution profile: ${error.message}`)
  }
  const evidenceVerification = verifyValidationEvidenceArtifacts(repoDir, filePath, manifest)
  failures.push(...evidenceVerification.failures)
  if (failures.length) {
    throw new Error(`The reviewed validation-integrity manifest is invalid: ${failures.join('; ')}`)
  }
  const digestSha256 = crypto.createHash('sha256').update(raw).digest('hex')
  return {
    filePath,
    manifest,
    digestSha256,
    binding: validationIntegrityBinding(manifest, digestSha256, evidenceVerification),
    evidenceVerification,
  }
}
