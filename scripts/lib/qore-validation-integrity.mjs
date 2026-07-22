import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadReviewedBrokerExecutionProfile } from './qore-broker-execution-profile.mjs'
import {
  REVIEWED_NYSE_CALENDAR_ID,
  forwardOutcomePolicyDigestSha256,
  validateForwardOutcomePolicy,
  verifyValidationEvidenceArtifacts,
} from './qore-validation-evidence.mjs'
import { loadResearchExecutionContract } from './qore-research-execution.mjs'

export const VALIDATION_INTEGRITY_SCHEMA_VERSION = 6
export const VALIDATION_INTEGRITY_MANIFEST_ID = 'ngas-all-year-beta-prospective-validation-v5'
export const VALIDATION_INTEGRITY_STRATEGY_ID = 'ngas-all-year-beta'
export const VALIDATION_PREREGISTRATION_SCHEMA_VERSION = 2
export const FORWARD_VALIDATION_IMPLEMENTATION_SCHEMA_VERSION = 1
export const FORWARD_VALIDATION_IMPLEMENTATION_ID = 'qore-forward-validation-implementation-v1'
export const FORWARD_VALIDATION_IMPLEMENTATION_SOURCE_PATHS = Object.freeze([
  'scripts/build-gfs-forecast-calendar.mjs',
  'scripts/lib/eia-release-time.mjs',
  'scripts/lib/qore-all-year-output-artifacts.mjs',
  'scripts/lib/qore-broker-execution-profile.mjs',
  'scripts/lib/qore-execution-host.mjs',
  'scripts/lib/qore-git-state.mjs',
  'scripts/lib/qore-index-basket.mjs',
  'scripts/lib/qore-live-all-year-inference.mjs',
  'scripts/lib/qore-live-contract.mjs',
  'scripts/lib/qore-live-inference-provenance.mjs',
  'scripts/lib/qore-live-paths.mjs',
  'scripts/lib/qore-live-strategy-artifact.mjs',
  'scripts/lib/qore-live-target-lattice.mjs',
  'scripts/lib/qore-live-target-parity.mjs',
  'scripts/lib/qore-rebalance-deadband.mjs',
  'scripts/lib/qore-research-execution.mjs',
  'scripts/lib/qore-signal-availability.mjs',
  'scripts/lib/qore-summer-forecast-contract.mjs',
  'scripts/lib/qore-summer-forecast-coverage.mjs',
  'scripts/lib/qore-summer-location-universe.mjs',
  'scripts/lib/qore-summer-shadow-challenger.mjs',
  'scripts/lib/qore-validation-evidence.mjs',
  'scripts/lib/qore-validation-integrity.mjs',
  'scripts/lib/qore-weather-data-quality.mjs',
  'scripts/lib/qore-winter-target-engine.mjs',
  'scripts/lib/secret-redaction.mjs',
  'scripts/local-env.mjs',
  'scripts/qore-alpaca-broker.mjs',
  'scripts/qore-live-market-history.mjs',
  'scripts/qore-live-readiness.mjs',
  'scripts/qore-live-strategy-inference.mjs',
  'scripts/qore-live-trading-supervisor.mjs',
  'scripts/qore-live-weather-service.mjs',
])
export const FORWARD_VALIDATION_IMPLEMENTATION_INPUT_PATHS = Object.freeze([
  'config/qore-live-broker-settings.json',
  'config/qore-live-weather-settings.json',
  'config/qore-research-execution.json',
  'data/qore/market/index-basket-config.json',
  'package-lock.json',
  'package.json',
])
export const FORWARD_VALIDATION_APPEND_ONLY_INPUT_CONTRACTS = Object.freeze([
  Object.freeze({
    schemaVersion: 1,
    contractId: 'eia-release-calendar-append-only-prefix-v1',
    path: 'data/qore/fundamentals/eia/working-gas-storage-release-calendar.json',
    calendarId: 'eia-wngsr-release-calendar-v1',
  }),
])
export const VALIDATION_CANDIDATE_REGISTRY_SCHEMA_VERSION = 1
export const VALIDATION_CANDIDATE_REGISTRY_ID =
  'ngas-all-year-beta-frozen-production-candidates-v1'
export const VALIDATION_CANDIDATE_SELECTION_POLICY =
  'single-frozen-production-candidate-no-post-seal-additions-v1'
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
  'filledOrderRatio',
  'medianAbsoluteSlippageBps',
  'p95AbsoluteSlippageBps',
  'ungMedianAbsoluteSlippageBps',
  'ungP95AbsoluteSlippageBps',
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

function newYorkCalendarDate(value) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed)
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]))
  return `${values.year}-${values.month}-${values.day}`
}

function validationCutoff(asOf) {
  const parsed = asOf instanceof Date ? new Date(asOf.getTime()) : new Date(asOf)
  if (Number.isNaN(parsed.getTime())) throw new Error('validation asOf must be a valid timestamp')
  return {
    timestampMs: parsed.getTime(),
    calendarDate: newYorkCalendarDate(parsed),
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

function canonicalDigestSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function forwardValidationImplementationProjection(implementation) {
  return {
    schemaVersion: implementation?.schemaVersion ?? null,
    implementationId: implementation?.implementationId ?? null,
    reviewedNyseCalendarId: implementation?.reviewedNyseCalendarId ?? null,
    sourceFiles: implementation?.sourceFiles ?? null,
    inputFiles: implementation?.inputFiles ?? null,
    appendOnlyInputs: implementation?.appendOnlyInputs ?? null,
  }
}

export function forwardValidationImplementationDigestSha256(implementation) {
  return canonicalDigestSha256(forwardValidationImplementationProjection(implementation))
}

function implementationFileRows(repoDir, relativePaths) {
  return relativePaths.map((relativePath) => ({
    path: relativePath,
    digestSha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(repoDir, relativePath)))
      .digest('hex'),
  }))
}

function eiaCalendarPrefixProjection(calendar, prefixReleaseCount) {
  return {
    schemaVersion: calendar?.schemaVersion ?? null,
    calendarId: calendar?.calendarId ?? null,
    timeZone: calendar?.timeZone ?? null,
    standardReleasePolicy: calendar?.standardReleasePolicy ?? null,
    sources: calendar?.sources ?? null,
    releases: Array.isArray(calendar?.releases)
      ? calendar.releases.slice(0, prefixReleaseCount)
      : null,
  }
}

function eiaCalendarPrefixDigestSha256(calendar, prefixReleaseCount) {
  return canonicalDigestSha256(eiaCalendarPrefixProjection(calendar, prefixReleaseCount))
}

export function appendOnlyForwardInputFailures(binding, calendar) {
  const failures = []
  const label = `forwardValidationImplementation append-only input ${binding?.path ?? '(missing path)'}`
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return [`${label} binding must be an object`]
  }
  if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar)) {
    return [`${label} must contain a JSON object`]
  }
  if (calendar.calendarId !== binding.calendarId) {
    failures.push(`${label} calendarId does not match the sealed append-only contract`)
  }
  if (!isDate(binding.prefixThroughPeriodEndDate)) {
    failures.push(`${label} prefixThroughPeriodEndDate must be YYYY-MM-DD`)
  }
  if (!Number.isInteger(binding.prefixReleaseCount) || binding.prefixReleaseCount < 1) {
    failures.push(`${label} prefixReleaseCount must be a positive integer`)
    return failures
  }
  const releases = Array.isArray(calendar.releases) ? calendar.releases : []
  if (releases.length < binding.prefixReleaseCount) {
    failures.push(`${label} removed rows from the immutable release-calendar prefix`)
    return failures
  }
  const prefix = releases.slice(0, binding.prefixReleaseCount)
  if (prefix.at(-1)?.periodEndDate !== binding.prefixThroughPeriodEndDate) {
    failures.push(`${label} immutable prefix no longer ends on the sealed period`)
  }
  if (
    !isSha256(binding.prefixDigestSha256)
    || binding.prefixDigestSha256
      !== eiaCalendarPrefixDigestSha256(calendar, binding.prefixReleaseCount)
  ) {
    failures.push(`${label} immutable prefix digest does not match current calendar bytes`)
  }
  let priorPeriodEndDate = prefix.at(-1)?.periodEndDate ?? null
  let priorReleasedAt = prefix.at(-1)?.releasedAt ?? null
  for (const [offset, row] of releases.slice(binding.prefixReleaseCount).entries()) {
    const rowLabel = `${label} extension[${offset}]`
    if (
      !row
      || typeof row !== 'object'
      || Array.isArray(row)
      || Object.keys(row).sort().join('|') !== 'periodEndDate|releaseKind|releasedAt'
    ) {
      failures.push(`${rowLabel} must contain only periodEndDate, releasedAt, and releaseKind`)
    }
    if (!isDate(row?.periodEndDate) || row.periodEndDate <= binding.prefixThroughPeriodEndDate) {
      failures.push(`${rowLabel} must append a period strictly after the immutable prefix`)
    }
    if (priorPeriodEndDate && row?.periodEndDate <= priorPeriodEndDate) {
      failures.push(`${rowLabel} periodEndDate must be strictly increasing`)
    } else if (
      priorPeriodEndDate
      && isDate(row?.periodEndDate)
      && (dateMs(row.periodEndDate) - dateMs(priorPeriodEndDate)) / 86400000 !== 7
    ) {
      failures.push(`${rowLabel} must extend the release calendar by exactly seven days`)
    }
    if (!isIsoTimestamp(row?.releasedAt)) {
      failures.push(`${rowLabel}.releasedAt must be an ISO timestamp`)
    } else if (priorReleasedAt && Date.parse(row.releasedAt) <= Date.parse(priorReleasedAt)) {
      failures.push(`${rowLabel}.releasedAt must be strictly increasing`)
    } else {
      const releaseLagDays = (
        Date.parse(row.releasedAt) - Date.parse(`${row.periodEndDate}T00:00:00.000Z`)
      ) / 86400000
      if (!Number.isFinite(releaseLagDays) || releaseLagDays < 1 || releaseLagDays > 21) {
        failures.push(`${rowLabel}.releasedAt must be after the complete period-end day and within the reviewed 21-day publication-lag ceiling`)
      }
    }
    if (typeof row?.releaseKind !== 'string' || !row.releaseKind) {
      failures.push(`${rowLabel}.releaseKind must be non-empty`)
    }
    priorPeriodEndDate = row?.periodEndDate ?? priorPeriodEndDate
    priorReleasedAt = row?.releasedAt ?? priorReleasedAt
  }
  const lastPeriodEndDate = releases.at(-1)?.periodEndDate ?? null
  if (
    !isDate(calendar.verifiedThroughPeriodEndDate)
    || calendar.verifiedThroughPeriodEndDate !== lastPeriodEndDate
    || calendar.verifiedThroughPeriodEndDate < binding.prefixThroughPeriodEndDate
  ) {
    failures.push(`${label} verified-through period must equal the latest release and may not regress`)
  }
  return failures
}

function reviewedAppendOnlyInputRows(repoDir) {
  return FORWARD_VALIDATION_APPEND_ONLY_INPUT_CONTRACTS.map((contract) => {
    const filePath = path.join(repoDir, contract.path)
    const calendar = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (calendar.calendarId !== contract.calendarId) {
      throw new Error(`${contract.path} calendarId must equal ${contract.calendarId}`)
    }
    const prefixThroughPeriodEndDate = calendar.verifiedThroughPeriodEndDate
    const prefixReleaseCount = Array.isArray(calendar.releases)
      ? calendar.releases.findLastIndex(
          (row) => row?.periodEndDate <= prefixThroughPeriodEndDate,
        ) + 1
      : 0
    const binding = {
      ...contract,
      prefixThroughPeriodEndDate,
      prefixReleaseCount,
      prefixDigestSha256: eiaCalendarPrefixDigestSha256(calendar, prefixReleaseCount),
    }
    const failures = appendOnlyForwardInputFailures(binding, calendar)
    if (failures.length) throw new Error(failures.join('; '))
    return binding
  })
}

export function reviewedForwardValidationImplementation(repoDir = process.cwd()) {
  const implementation = {
    schemaVersion: FORWARD_VALIDATION_IMPLEMENTATION_SCHEMA_VERSION,
    implementationId: FORWARD_VALIDATION_IMPLEMENTATION_ID,
    reviewedNyseCalendarId: REVIEWED_NYSE_CALENDAR_ID,
    sourceFiles: implementationFileRows(repoDir, FORWARD_VALIDATION_IMPLEMENTATION_SOURCE_PATHS),
    inputFiles: implementationFileRows(repoDir, FORWARD_VALIDATION_IMPLEMENTATION_INPUT_PATHS),
    appendOnlyInputs: reviewedAppendOnlyInputRows(repoDir),
  }
  return {
    ...implementation,
    implementationDigestSha256:
      forwardValidationImplementationDigestSha256(implementation),
  }
}

export function validationCandidateRegistryProjection(registry) {
  return {
    schemaVersion: registry?.schemaVersion ?? null,
    registryId: registry?.registryId ?? null,
    familySize: registry?.familySize ?? null,
    selectionPolicy: registry?.selectionPolicy ?? null,
    candidates: registry?.candidates ?? null,
  }
}

export function validationCandidateRegistryDigestSha256(registry) {
  return canonicalDigestSha256(validationCandidateRegistryProjection(registry))
}

export function validationPreregistrationProjection(manifest) {
  const outcomePolicy = manifest?.forwardOutcomePolicy ?? null
  const candidateRegistry = manifest?.candidateRegistry ?? null
  return {
    schemaVersion: VALIDATION_PREREGISTRATION_SCHEMA_VERSION,
    manifestIdentity: {
      schemaVersion: manifest?.schemaVersion ?? null,
      manifestId: manifest?.manifestId ?? null,
      strategyId: manifest?.strategyId ?? null,
    },
    sealedAt: manifest?.sealedAt ?? null,
    historicalEvidence: {
      status: manifest?.historicalEvidence?.status ?? null,
      evidenceStart: manifest?.historicalEvidence?.evidenceStart ?? null,
      developmentBegan: manifest?.historicalEvidence?.developmentBegan ?? null,
      observedThrough: manifest?.historicalEvidence?.observedThrough ?? null,
      prospectiveStart: manifest?.historicalEvidence?.prospectiveStart ?? null,
    },
    sealedDigests: {
      strategyContractDigestSha256:
        manifest?.sealedStrategyContractDigestSha256 ?? null,
      strategyArtifactDigestSha256:
        manifest?.sealedStrategyArtifactDigestSha256 ?? null,
      brokerExecutionProfileDigestSha256:
        manifest?.sealedBrokerExecutionProfileDigestSha256 ?? null,
    },
    candidateRegistry: candidateRegistry
      ? {
          ...validationCandidateRegistryProjection(candidateRegistry),
          registryDigestSha256: candidateRegistry.registryDigestSha256 ?? null,
        }
      : null,
    forwardOutcomePolicy: {
      contract: outcomePolicy,
      digestSha256: outcomePolicy ? forwardOutcomePolicyDigestSha256(outcomePolicy) : null,
    },
    forwardValidationImplementation:
      manifest?.forwardValidationImplementation ?? null,
    minimumGates: {
      forwardEvidence: manifest?.minimumForwardEvidence ?? null,
      paperExecutionEvidence: manifest?.minimumPaperExecutionEvidence ?? null,
    },
  }
}

export function validationPreregistrationDigestSha256(manifest) {
  return canonicalDigestSha256(validationPreregistrationProjection(manifest))
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
    schemaVersion: 2,
    strategyId: summary?.strategyId ?? null,
    allYearSelection: summary?.contract?.allYearSelection ?? null,
    forwardOutcomePolicy: {
      schemaVersion: summary?.contract?.forwardOutcomePolicy?.schemaVersion ?? null,
      policyId: summary?.contract?.forwardOutcomePolicy?.policyId ?? null,
      policyDigestSha256: summary?.contract?.forwardOutcomePolicy?.policyDigestSha256 ?? null,
    },
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
    const minimumCountFloors = {
      tradingSessions: 60,
      filledOrders: 10,
      ungFilledOrders: 4,
      ungLongFilledOrders: 2,
      ungShortFilledOrders: 2,
    }
    for (const [field, floor] of Object.entries(minimumCountFloors)) {
      if (Number.isInteger(minimum[field]) && minimum[field] < floor) {
        failures.push(`minimumPaperExecutionEvidence.${field} must be at least ${floor}`)
      }
    }
    if (
      !isNonNegativeFiniteNumber(minimum.minimumFilledOrderRatio)
      || minimum.minimumFilledOrderRatio < 0.8
      || minimum.minimumFilledOrderRatio > 1
    ) {
      failures.push('minimumPaperExecutionEvidence.minimumFilledOrderRatio must be between 0.8 and 1')
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
    if (
      isNonNegativeFiniteNumber(minimum.maximumMedianAbsoluteSlippageBps)
      && minimum.maximumMedianAbsoluteSlippageBps > 25
    ) failures.push('minimumPaperExecutionEvidence.maximumMedianAbsoluteSlippageBps cannot exceed 25')
    if (
      isNonNegativeFiniteNumber(minimum.maximumP95AbsoluteSlippageBps)
      && minimum.maximumP95AbsoluteSlippageBps > 50
    ) failures.push('minimumPaperExecutionEvidence.maximumP95AbsoluteSlippageBps cannot exceed 50')
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
  for (const field of [
    'filledOrderRatio',
    'medianAbsoluteSlippageBps',
    'p95AbsoluteSlippageBps',
    'ungMedianAbsoluteSlippageBps',
    'ungP95AbsoluteSlippageBps',
  ]) {
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
    isNonNegativeInteger(evidence.submittedOrders)
    && isNonNegativeInteger(evidence.filledOrders)
    && isNonNegativeFiniteNumber(evidence.filledOrderRatio)
  ) {
    const expectedRatio = evidence.submittedOrders > 0
      ? Math.round(evidence.filledOrders / evidence.submittedOrders * 1e6) / 1e6
      : 0
    if (evidence.filledOrderRatio !== expectedRatio) {
      failures.push('paperExecutionEvidence.filledOrderRatio must equal filledOrders divided by submittedOrders')
    }
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
    isNonNegativeFiniteNumber(evidence.ungMedianAbsoluteSlippageBps)
    && isNonNegativeFiniteNumber(evidence.ungP95AbsoluteSlippageBps)
    && evidence.ungP95AbsoluteSlippageBps < evidence.ungMedianAbsoluteSlippageBps
  ) {
    failures.push('paperExecutionEvidence UNG p95 slippage cannot be below UNG median slippage')
  }
  if (
    isIsoTimestamp(evidence.reviewedAt)
    && isDate(evidence.periodEnd)
    && newYorkCalendarDate(evidence.reviewedAt) <= evidence.periodEnd
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
    && isNonNegativeFiniteNumber(evidence.filledOrderRatio)
    && evidence.filledOrderRatio >= minimum?.minimumFilledOrderRatio
    && evidence.filledOrderRatio === Math.round(evidence.filledOrders / evidence.submittedOrders * 1e6) / 1e6
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
    && isNonNegativeFiniteNumber(evidence.ungMedianAbsoluteSlippageBps)
    && evidence.ungMedianAbsoluteSlippageBps <= minimum?.maximumMedianAbsoluteSlippageBps
    && isNonNegativeFiniteNumber(evidence.ungP95AbsoluteSlippageBps)
    && evidence.ungP95AbsoluteSlippageBps <= minimum?.maximumP95AbsoluteSlippageBps
    && evidence.ungP95AbsoluteSlippageBps >= evidence.ungMedianAbsoluteSlippageBps
    && isIsoTimestamp(evidence.reviewedAt)
    && newYorkCalendarDate(evidence.reviewedAt) > evidence.periodEnd
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

function validateCandidateRegistry(manifest, failures) {
  const registry = manifest?.candidateRegistry
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    failures.push('candidateRegistry must be an object')
    return
  }
  const registryFields = new Set([
    'schemaVersion',
    'registryId',
    'familySize',
    'selectionPolicy',
    'candidates',
    'registryDigestSha256',
  ])
  for (const field of Object.keys(registry)) {
    if (!registryFields.has(field)) failures.push(`candidateRegistry.${field} is not allowed`)
  }
  if (registry.schemaVersion !== VALIDATION_CANDIDATE_REGISTRY_SCHEMA_VERSION) {
    failures.push(`candidateRegistry.schemaVersion must equal ${VALIDATION_CANDIDATE_REGISTRY_SCHEMA_VERSION}`)
  }
  if (registry.registryId !== VALIDATION_CANDIDATE_REGISTRY_ID) {
    failures.push(`candidateRegistry.registryId must equal ${VALIDATION_CANDIDATE_REGISTRY_ID}`)
  }
  if (registry.selectionPolicy !== VALIDATION_CANDIDATE_SELECTION_POLICY) {
    failures.push(`candidateRegistry.selectionPolicy must equal ${VALIDATION_CANDIDATE_SELECTION_POLICY}`)
  }
  const candidates = Array.isArray(registry.candidates) ? registry.candidates : []
  if (!Array.isArray(registry.candidates)) {
    failures.push('candidateRegistry.candidates must be an array')
  }
  if (!Number.isInteger(registry.familySize) || registry.familySize !== candidates.length) {
    failures.push('candidateRegistry.familySize must equal the frozen candidate list length')
  }
  if (registry.familySize !== 1) {
    failures.push('candidateRegistry.familySize must equal one for the reviewed single-candidate selection policy')
  }
  const candidateIds = new Set()
  candidates.forEach((candidate, index) => {
    const label = `candidateRegistry.candidates[${index}]`
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      failures.push(`${label} must be an object`)
      return
    }
    const candidateFields = new Set([
      'candidateId',
      'strategyContractDigestSha256',
      'strategyArtifactCoreDigestSha256',
    ])
    for (const field of Object.keys(candidate)) {
      if (!candidateFields.has(field)) failures.push(`${label}.${field} is not allowed`)
    }
    if (typeof candidate.candidateId !== 'string' || !candidate.candidateId) {
      failures.push(`${label}.candidateId must be a non-empty string`)
    } else if (candidateIds.has(candidate.candidateId)) {
      failures.push(`${label}.candidateId must be unique`)
    } else candidateIds.add(candidate.candidateId)
    for (const field of [
      'strategyContractDigestSha256',
      'strategyArtifactCoreDigestSha256',
    ]) {
      if (!isSha256(candidate[field])) {
        failures.push(`${label}.${field} must be a lowercase SHA-256 digest`)
      }
    }
  })
  const activeCandidate = candidates.find(
    (candidate) => candidate?.candidateId === manifest?.strategyId,
  )
  if (!activeCandidate) {
    failures.push('candidateRegistry must contain the active manifest strategyId')
  } else {
    if (
      activeCandidate.strategyContractDigestSha256
      !== manifest?.sealedStrategyContractDigestSha256
    ) {
      failures.push('candidateRegistry active candidate must bind the sealed strategy-contract digest')
    }
    if (
      activeCandidate.strategyArtifactCoreDigestSha256
      !== manifest?.sealedStrategyArtifactDigestSha256
    ) {
      failures.push('candidateRegistry active candidate must bind the sealed strategy-artifact digest')
    }
  }
  if (!isSha256(registry.registryDigestSha256)) {
    failures.push('candidateRegistry.registryDigestSha256 must be a lowercase SHA-256 digest')
  } else if (
    registry.registryDigestSha256 !== validationCandidateRegistryDigestSha256(registry)
  ) {
    failures.push('candidateRegistry.registryDigestSha256 must bind the canonical frozen candidate registry')
  }
}

function validateForwardValidationImplementation(implementation, failures) {
  const label = 'forwardValidationImplementation'
  if (!implementation || typeof implementation !== 'object' || Array.isArray(implementation)) {
    failures.push(`${label} must be an object`)
    return
  }
  const allowedFields = new Set([
    'schemaVersion',
    'implementationId',
    'reviewedNyseCalendarId',
    'sourceFiles',
    'inputFiles',
    'appendOnlyInputs',
    'implementationDigestSha256',
  ])
  for (const field of Object.keys(implementation)) {
    if (!allowedFields.has(field)) failures.push(`${label}.${field} is not allowed`)
  }
  if (implementation.schemaVersion !== FORWARD_VALIDATION_IMPLEMENTATION_SCHEMA_VERSION) {
    failures.push(`${label}.schemaVersion must equal ${FORWARD_VALIDATION_IMPLEMENTATION_SCHEMA_VERSION}`)
  }
  if (implementation.implementationId !== FORWARD_VALIDATION_IMPLEMENTATION_ID) {
    failures.push(`${label}.implementationId must equal ${FORWARD_VALIDATION_IMPLEMENTATION_ID}`)
  }
  if (implementation.reviewedNyseCalendarId !== REVIEWED_NYSE_CALENDAR_ID) {
    failures.push(`${label}.reviewedNyseCalendarId must equal ${REVIEWED_NYSE_CALENDAR_ID}`)
  }
  for (const [field, expectedPaths] of [
    ['sourceFiles', FORWARD_VALIDATION_IMPLEMENTATION_SOURCE_PATHS],
    ['inputFiles', FORWARD_VALIDATION_IMPLEMENTATION_INPUT_PATHS],
  ]) {
    const rows = implementation[field]
    if (!Array.isArray(rows)) {
      failures.push(`${label}.${field} must be an array`)
      continue
    }
    if (rows.length !== expectedPaths.length) {
      failures.push(`${label}.${field} must contain the exact reviewed file inventory`)
    }
    const seen = new Set()
    rows.forEach((row, index) => {
      const rowLabel = `${label}.${field}[${index}]`
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        failures.push(`${rowLabel} must be an object`)
        return
      }
      const keys = Object.keys(row).sort()
      if (keys.length !== 2 || keys[0] !== 'digestSha256' || keys[1] !== 'path') {
        failures.push(`${rowLabel} must contain only path and digestSha256`)
      }
      if (row.path !== expectedPaths[index]) {
        failures.push(`${rowLabel}.path must equal ${expectedPaths[index] ?? '(no extra path)'}`)
      }
      if (seen.has(row.path)) failures.push(`${label}.${field} paths must be unique`)
      seen.add(row.path)
      if (!isSha256(row.digestSha256)) {
        failures.push(`${rowLabel}.digestSha256 must be a lowercase SHA-256 digest`)
      }
    })
  }
  const appendOnlyInputs = implementation.appendOnlyInputs
  if (!Array.isArray(appendOnlyInputs)) {
    failures.push(`${label}.appendOnlyInputs must be an array`)
  } else {
    if (appendOnlyInputs.length !== FORWARD_VALIDATION_APPEND_ONLY_INPUT_CONTRACTS.length) {
      failures.push(`${label}.appendOnlyInputs must contain the exact reviewed append-only inventory`)
    }
    const expectedKeys = [
      'calendarId',
      'contractId',
      'path',
      'prefixDigestSha256',
      'prefixReleaseCount',
      'prefixThroughPeriodEndDate',
      'schemaVersion',
    ]
    const seen = new Set()
    appendOnlyInputs.forEach((row, index) => {
      const rowLabel = `${label}.appendOnlyInputs[${index}]`
      const expected = FORWARD_VALIDATION_APPEND_ONLY_INPUT_CONTRACTS[index]
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        failures.push(`${rowLabel} must be an object`)
        return
      }
      if (Object.keys(row).sort().join('|') !== expectedKeys.join('|')) {
        failures.push(`${rowLabel} must contain only the reviewed append-only binding fields`)
      }
      for (const field of ['schemaVersion', 'contractId', 'path', 'calendarId']) {
        if (row[field] !== expected?.[field]) {
          failures.push(`${rowLabel}.${field} must equal ${expected?.[field] ?? '(no extra binding)'}`)
        }
      }
      if (seen.has(row.path)) failures.push(`${label}.appendOnlyInputs paths must be unique`)
      seen.add(row.path)
      if (!isDate(row.prefixThroughPeriodEndDate)) {
        failures.push(`${rowLabel}.prefixThroughPeriodEndDate must be YYYY-MM-DD`)
      }
      if (!Number.isInteger(row.prefixReleaseCount) || row.prefixReleaseCount < 1) {
        failures.push(`${rowLabel}.prefixReleaseCount must be a positive integer`)
      }
      if (!isSha256(row.prefixDigestSha256)) {
        failures.push(`${rowLabel}.prefixDigestSha256 must be a lowercase SHA-256 digest`)
      }
    })
  }
  if (!isSha256(implementation.implementationDigestSha256)) {
    failures.push(`${label}.implementationDigestSha256 must be a lowercase SHA-256 digest`)
  } else if (
    implementation.implementationDigestSha256
    !== forwardValidationImplementationDigestSha256(implementation)
  ) {
    failures.push(`${label}.implementationDigestSha256 must bind the exact reviewed implementation inventory`)
  }
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
  if (!isIsoTimestamp(manifest?.sealedAt)) {
    failures.push('sealedAt must be an ISO timestamp')
  } else if (Date.parse(manifest.sealedAt) > cutoff.timestampMs) {
    failures.push('sealedAt cannot be in the future')
  }
  if (!isIsoTimestamp(manifest?.reviewedAt)) failures.push('reviewedAt must be an ISO timestamp')
  else if (Date.parse(manifest.reviewedAt) > cutoff.timestampMs) failures.push('reviewedAt cannot be in the future')
  if (
    isIsoTimestamp(manifest?.sealedAt)
    && isIsoTimestamp(manifest?.reviewedAt)
    && Date.parse(manifest.reviewedAt) < Date.parse(manifest.sealedAt)
  ) failures.push('reviewedAt cannot precede sealedAt')

  const outcomePolicyFailures = validateForwardOutcomePolicy(manifest?.forwardOutcomePolicy)
  failures.push(...outcomePolicyFailures)
  const outcomePolicyDigestSha256 = outcomePolicyFailures.length === 0
    ? forwardOutcomePolicyDigestSha256(manifest.forwardOutcomePolicy)
    : null

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

  if (
    isIsoTimestamp(manifest?.sealedAt)
    && isDate(historical?.prospectiveStart)
    && newYorkCalendarDate(manifest.sealedAt) >= historical.prospectiveStart
  ) {
    failures.push('sealedAt New York calendar date must precede prospectiveStart')
  }

  validateCandidateRegistry(manifest, failures)
  validateForwardValidationImplementation(manifest?.forwardValidationImplementation, failures)
  if (!isSha256(manifest?.preregistrationDigestSha256)) {
    failures.push('preregistrationDigestSha256 must be a lowercase SHA-256 digest')
  } else if (
    manifest.preregistrationDigestSha256 !== validationPreregistrationDigestSha256(manifest)
  ) {
    failures.push('preregistrationDigestSha256 must bind the canonical immutable preregistration projection')
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
    if (label === 'minimumForwardEvidence') {
      if (isNonNegativeInteger(evidence.independentEpisodes) && evidence.independentEpisodes < 60) {
        failures.push('minimumForwardEvidence.independentEpisodes must be at least 60')
      }
      for (const field of ['completeSummerSeasons', 'completeWinterSeasons']) {
        if (isNonNegativeInteger(evidence[field]) && evidence[field] < 2) {
          failures.push(`minimumForwardEvidence.${field} must be at least 2`)
        }
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
        'outcomePolicyDigestSha256',
        'preregistrationDigestSha256',
        'sealedAt',
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
        'outcomePolicyDigestSha256',
        'preregistrationDigestSha256',
        'evidenceArtifactDigestSha256',
      ]) {
        if (!isSha256(observed[field])) failures.push(`observedForwardEvidence.${field} must be a lowercase SHA-256 digest when evidence is recorded`)
      }
      if (!isIsoTimestamp(observed.reviewedAt)) {
        failures.push('observedForwardEvidence.reviewedAt must be an ISO timestamp when evidence is recorded')
      }
      if (
        outcomePolicyDigestSha256 !== null
        && observed.outcomePolicyDigestSha256 !== outcomePolicyDigestSha256
      ) {
        failures.push('observedForwardEvidence.outcomePolicyDigestSha256 must equal the reviewed forward outcome policy digest')
      }
      if (
        observed.preregistrationDigestSha256 !== manifest?.preregistrationDigestSha256
      ) {
        failures.push('observedForwardEvidence.preregistrationDigestSha256 must equal the immutable preregistration digest')
      }
      if (observed.sealedAt !== manifest?.sealedAt) {
        failures.push('observedForwardEvidence.sealedAt must equal the immutable preregistration timestamp')
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
        && newYorkCalendarDate(observed.reviewedAt) <= observed.observedThrough
      ) {
        failures.push('observedForwardEvidence.reviewedAt must be after observedThrough')
      }
      if (isIsoTimestamp(observed.reviewedAt) && Date.parse(observed.reviewedAt) > cutoff.timestampMs) {
        failures.push('observedForwardEvidence.reviewedAt cannot be in the future')
      }
      if (
        isIsoTimestamp(observed.reviewedAt)
        && isIsoTimestamp(manifest?.reviewedAt)
        && Date.parse(observed.reviewedAt) > Date.parse(manifest.reviewedAt)
      ) {
        failures.push('prospective forward-evidence review cannot postdate the manifest review')
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
  if (!isSha256(sealedDigest)) {
    failures.push('sealedStrategyContractDigestSha256 must be a lowercase SHA-256 digest')
  }
  const sealedStrategyArtifactDigest = manifest?.sealedStrategyArtifactDigestSha256
  if (!isSha256(sealedStrategyArtifactDigest)) {
    failures.push('sealedStrategyArtifactDigestSha256 must be a lowercase SHA-256 digest')
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
      && isIsoTimestamp(manifest?.sealedAt)
      && Date.parse(approval.approvedAt) <= Date.parse(manifest.sealedAt)
    ) {
      failures.push(`${kind} approval must follow the current implementation seal`)
    }
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
    && paperEvidence.periodStart < newYorkCalendarDate(paperApproval.approvedAt)
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
    sealedAt: manifest.sealedAt,
    preregistrationDigestSha256: manifest.preregistrationDigestSha256,
    candidateRegistryId: manifest.candidateRegistry.registryId,
    candidateRegistryDigestSha256: manifest.candidateRegistry.registryDigestSha256,
    candidateFamilySize: manifest.candidateRegistry.familySize,
    forwardValidationImplementationId:
      manifest.forwardValidationImplementation.implementationId,
    forwardValidationImplementationDigestSha256:
      manifest.forwardValidationImplementation.implementationDigestSha256,
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
      && evidenceVerification?.forward?.valid === true
      && evidenceVerification?.forward?.summary?.outcomeGatesSatisfied === true,
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
  try {
    const executionContract = loadResearchExecutionContract(repoDir)
    if (manifest?.forwardOutcomePolicy?.executionContractId !== executionContract.contractId) {
      failures.push('forwardOutcomePolicy.executionContractId must equal the loaded reviewed research execution contract')
    }
    if (manifest?.forwardOutcomePolicy?.executionContractDigestSha256 !== executionContract.digest) {
      failures.push('forwardOutcomePolicy.executionContractDigestSha256 must equal the loaded reviewed research execution contract digest')
    }
  } catch (error) {
    failures.push(`Unable to verify the reviewed research execution contract: ${error.message}`)
  }
  try {
    const reviewedImplementation = reviewedForwardValidationImplementation(repoDir)
    for (const field of ['sourceFiles', 'inputFiles']) {
      const sealedRows = new Map(
        (manifest?.forwardValidationImplementation?.[field] ?? [])
          .map((row) => [row?.path, row?.digestSha256]),
      )
      for (const row of reviewedImplementation[field]) {
        if (sealedRows.get(row.path) !== row.digestSha256) {
          failures.push(`forwardValidationImplementation ${row.path} digest does not match the current reviewed bytes`)
        }
      }
    }
    for (const binding of manifest?.forwardValidationImplementation?.appendOnlyInputs ?? []) {
      try {
        const calendar = JSON.parse(fs.readFileSync(path.join(repoDir, binding.path), 'utf8'))
        failures.push(...appendOnlyForwardInputFailures(binding, calendar))
      } catch (error) {
        failures.push(`Unable to verify forwardValidationImplementation append-only input ${binding?.path ?? '(missing path)'}: ${error.message}`)
      }
    }
  } catch (error) {
    failures.push(`Unable to verify the reviewed forward-validation implementation: ${error.message}`)
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
