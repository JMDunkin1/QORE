import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION,
  executableLiveComponentContractDigestSha256,
  liveComponentContractDigestSha256,
} from './qore-live-contract.mjs'
import {
  ALL_YEAR_SELECTION_CONTRACT,
  allYearStrategyContractDigestSha256,
  loadValidationIntegrityManifest,
} from './qore-validation-integrity.mjs'
import {
  BROKER_EXECUTION_PROFILE_SCHEMA_VERSION,
  brokerExecutionProfileDigestSha256,
  brokerExecutionProfileTieOutFailures,
  loadReviewedBrokerExecutionProfile,
} from './qore-broker-execution-profile.mjs'
import {
  LIVE_TARGET_PARITY_POLICY,
  evaluateVersionedLiveTargetParity,
  versionedLiveTargetParityInputDigestSha256,
} from './qore-live-target-parity.mjs'

const STRATEGY_ID = 'ngas-all-year-beta'
const PROMOTION_STATUS = 'research-baseline'
export const ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION = 5
const REQUIRED_PAPER_GATES = [
  'positiveTrainEdge',
  'positiveValidationEdge',
  'preHoldoutBootstrapSignificance',
  'trainMaxDrawdown',
  'validationMaxDrawdown',
  'summerComponent',
  'winterComponent',
  'liveContract',
  'liveTargetParity',
  'brokerExecution',
  'strategyContractSeal',
  'paperApproval',
]
const REQUIRED_LIVE_GATES = [
  'pristineForwardEvidence',
  'paperExecutionEvidence',
  'liveApproval',
]
const liveTargetParityCache = new Map()

function canonicalParityValue(value) {
  if (Array.isArray(value)) return value.map(canonicalParityValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalParityValue(value[key])]),
  )
}

function parityValuesMatch(left, right) {
  return JSON.stringify(canonicalParityValue(left)) === JSON.stringify(canonicalParityValue(right))
}

function liveContractFailures(summary) {
  const failures = []
  const binding = summary?.contract?.liveInference
  if (binding?.componentContractSchemaVersion !== LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION) {
    failures.push(`live component contract schema must equal ${LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION}`)
  }
  if (!binding?.componentContract || typeof binding.componentContract !== 'object') {
    failures.push('canonical live component contract is missing')
    return failures
  }
  const computedDigest = liveComponentContractDigestSha256(binding.componentContract)
  if (binding.componentContractDigestSha256 !== computedDigest) {
    failures.push('live component contract digest does not match the canonical contract stored in the artifact')
  }
  if (binding.executableContractDigestSha256 !== executableLiveComponentContractDigestSha256) {
    failures.push('reviewed executable live contract digest does not match the current executable contract')
  }
  if (computedDigest !== executableLiveComponentContractDigestSha256) {
    failures.push('reviewed component contract digest does not match the executable live contract')
  }
  return failures
}

function brokerExecutionFailures(summary, reviewedBrokerExecution) {
  const failures = []
  const binding = summary?.contract?.brokerExecution
  if (binding?.schemaVersion !== BROKER_EXECUTION_PROFILE_SCHEMA_VERSION) {
    failures.push(`broker execution profile schema must equal ${BROKER_EXECUTION_PROFILE_SCHEMA_VERSION}`)
  }
  if (!binding?.profile || typeof binding.profile !== 'object') {
    failures.push('canonical broker execution profile is missing')
    return failures
  }
  let computedDigest = null
  try {
    computedDigest = brokerExecutionProfileDigestSha256(binding.profile)
  } catch (error) {
    failures.push(`canonical broker execution profile is invalid: ${error.message}`)
    return failures
  }
  if (binding.profileDigestSha256 !== computedDigest) {
    failures.push('broker execution profile digest does not match the canonical profile stored in the artifact')
  }
  if (binding.profileId !== binding.profile.profileId) {
    failures.push('broker execution profileId does not match the canonical profile stored in the artifact')
  }
  if (computedDigest !== reviewedBrokerExecution.profileDigestSha256) {
    failures.push('artifact broker execution profile does not match the current reviewed broker configuration')
  }
  failures.push(...brokerExecutionProfileTieOutFailures(binding.profile, summary?.contract?.execution))
  return failures
}

function artifactTestOverrideActive() {
  return Boolean(
    process.env.QORE_LIVE_STRATEGY_ARTIFACT_FILE
    && process.env.NODE_ENV === 'test'
    && process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES === '1',
  )
}

function currentLiveTargetParity(repoDir, summary) {
  if (artifactTestOverrideActive()) return summary?.validation?.liveTargetParity ?? null
  const inputDigestSha256 = versionedLiveTargetParityInputDigestSha256(repoDir)
  const cached = liveTargetParityCache.get(repoDir)
  if (cached?.inputDigestSha256 === inputDigestSha256) return cached.report
  const report = evaluateVersionedLiveTargetParity(repoDir)
  const confirmedInputDigestSha256 = versionedLiveTargetParityInputDigestSha256(repoDir)
  if (
    report.inputDigestSha256 !== inputDigestSha256
    || confirmedInputDigestSha256 !== inputDigestSha256
  ) {
    throw new Error('Live-target parity inputs changed during the deterministic replay; retry from a stable checkout.')
  }
  liveTargetParityCache.set(repoDir, { inputDigestSha256, report })
  return report
}

export function liveTargetParityFailures(summary, currentParity) {
  const failures = []
  const embedded = summary?.validation?.liveTargetParity
  if (!parityValuesMatch(summary?.contract?.liveTargetParity, LIVE_TARGET_PARITY_POLICY)) {
    failures.push('sealed live-target parity policy does not match the executable parity policy')
  }
  if (!embedded || typeof embedded !== 'object') {
    failures.push('live-target parity replay is missing')
    return failures
  }
  if (!currentParity || typeof currentParity !== 'object') {
    failures.push('current live-target parity replay is unavailable')
    return failures
  }
  const policyFields = Object.keys(LIVE_TARGET_PARITY_POLICY)
  for (const field of policyFields) {
    if (!parityValuesMatch(embedded[field], LIVE_TARGET_PARITY_POLICY[field])) {
      failures.push(`live-target parity ${field} does not match the executable parity policy`)
    }
  }
  const reportFields = [...new Set([
    ...Object.keys(currentParity),
    ...Object.keys(embedded),
  ])].filter((field) => !policyFields.includes(field)).sort()
  for (const field of reportFields) {
    if (!parityValuesMatch(embedded[field], currentParity[field])) {
      failures.push(`live-target parity ${field} does not match the current deterministic replay`)
    }
  }
  const countsAreCoherent = (
    Number.isInteger(embedded.comparedRowCount)
    && embedded.comparedRowCount > 0
    && Number.isInteger(embedded.matchedRowCount)
    && Number.isInteger(embedded.mismatchCount)
    && embedded.matchedRowCount + embedded.mismatchCount === embedded.comparedRowCount
    && Array.isArray(embedded.mismatches)
    && embedded.mismatches.length === embedded.mismatchCount
  )
  if (!countsAreCoherent) failures.push('live-target parity row counts are internally inconsistent')
  if (embedded.exactTargetParity !== (embedded.mismatchCount === 0)) {
    failures.push('live-target parity status does not agree with its mismatch count')
  }
  if (embedded.status !== (embedded.exactTargetParity ? 'pass' : 'fail')) {
    failures.push('live-target parity status label does not agree with exactTargetParity')
  }
  if (summary?.validation?.promotionGates?.liveTargetParity !== embedded.exactTargetParity) {
    failures.push('promotion gate liveTargetParity must equal the deterministic replay result')
  }
  return failures
}

export function resolveAllYearStrategyArtifactPath(repoDir) {
  const configured = process.env.QORE_LIVE_STRATEGY_ARTIFACT_FILE
  if (
    configured
    && !(
      process.env.NODE_ENV === 'test'
      && process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES === '1'
    )
  ) {
    throw new Error('QORE_LIVE_STRATEGY_ARTIFACT_FILE requires the explicit reviewed-artifact test capability; live routing is bound to the checked-in all-year artifact.')
  }
  return configured
    ? path.resolve(configured)
    : path.join(repoDir, 'data', 'qore', 'research', 'strategy-agent-runs', STRATEGY_ID, 'run-summary.json')
}

function validationIntegrityFailures(summary, reviewedIntegrity) {
  const failures = []
  const embedded = summary?.validation?.integrity
  if (!embedded || typeof embedded !== 'object') {
    failures.push('validation integrity binding is missing')
    return failures
  }
  for (const [field, expected] of Object.entries(reviewedIntegrity.binding)) {
    if (embedded[field] !== expected) {
      failures.push(`validation integrity ${field} does not match the reviewed manifest`)
    }
  }
  const strategyContractDigestSha256 = allYearStrategyContractDigestSha256(summary)
  if (embedded.strategyContractDigestSha256 !== strategyContractDigestSha256) {
    failures.push('validation integrity strategyContractDigestSha256 does not match the artifact strategy contract')
  }
  if (reviewedIntegrity.binding.sealedStrategyContractDigestSha256 !== strategyContractDigestSha256) {
    failures.push('reviewed validation-integrity seal does not match the artifact strategy contract')
  }
  if (JSON.stringify(summary?.contract?.allYearSelection) !== JSON.stringify(ALL_YEAR_SELECTION_CONTRACT)) {
    failures.push('all-year selection contract does not match the executable reviewed selector')
  }
  if (summary?.validation?.promotionGates?.pristineForwardEvidence !== embedded.pristineForwardEvidence) {
    failures.push('promotion gate pristineForwardEvidence must match the reviewed validation-integrity manifest')
  }
  if (summary?.validation?.promotionGates?.strategyContractSeal !== (
    reviewedIntegrity.binding.sealedStrategyContractDigestSha256 === strategyContractDigestSha256
  )) {
    failures.push('promotion gate strategyContractSeal must match the reviewed validation-integrity manifest')
  }
  if (summary?.validation?.promotionGates?.paperApproval !== (embedded.paperApprovalStatus === 'approved')) {
    failures.push('promotion gate paperApproval must match the reviewed validation-integrity manifest')
  }
  if (summary?.validation?.promotionGates?.paperExecutionEvidence !== embedded.paperExecutionEvidenceSatisfied) {
    failures.push('promotion gate paperExecutionEvidence must match the reviewed validation-integrity manifest')
  }
  if (summary?.validation?.promotionGates?.liveApproval !== (embedded.liveApprovalStatus === 'approved')) {
    failures.push('promotion gate liveApproval must match the reviewed validation-integrity manifest')
  }
  return failures
}

function paperEligibilityFailures(summary, reviewedIntegrity, reviewedBrokerExecution, currentParity) {
  const failures = []
  if (summary?.artifactSchemaVersion !== ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION) {
    failures.push(`artifact schema must equal ${ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION}`)
  }
  if (summary?.strategyId !== STRATEGY_ID) failures.push(`strategyId must equal ${STRATEGY_ID}`)
  if (summary?.status !== PROMOTION_STATUS) failures.push(`status must equal ${PROMOTION_STATUS}`)
  if (summary?.search?.eligibleCandidateCount !== 1) failures.push('eligibleCandidateCount must equal 1')
  if (summary?.search?.selectionUsedHoldout !== false) failures.push('selectionUsedHoldout must equal false')
  if (summary?.selected?.candidateId !== STRATEGY_ID) failures.push(`selected candidateId must equal ${STRATEGY_ID}`)
  if (summary?.candidates?.length !== 1 || summary.candidates[0]?.candidateId !== STRATEGY_ID || summary.candidates[0]?.eligible !== true) {
    failures.push('the sole all-year candidate must be explicitly eligible')
  }
  const gates = summary?.validation?.promotionGates
  for (const gate of REQUIRED_PAPER_GATES) {
    if (gates?.[gate] !== true) failures.push(`promotion gate ${gate} must pass`)
  }
  failures.push(...validationIntegrityFailures(summary, reviewedIntegrity))
  failures.push(...liveContractFailures(summary))
  failures.push(...liveTargetParityFailures(summary, currentParity))
  failures.push(...brokerExecutionFailures(summary, reviewedBrokerExecution))
  return failures
}

function liveEligibilityFailures(summary, paperFailures) {
  const failures = [...paperFailures]
  const gates = summary?.validation?.promotionGates
  for (const gate of REQUIRED_LIVE_GATES) {
    if (gates?.[gate] !== true) failures.push(`promotion gate ${gate} must pass`)
  }
  return failures
}

function contractIntegrityFailures(
  summary,
  reviewedIntegrity,
  reviewedBrokerExecution,
  currentParity,
) {
  const failures = []
  if (summary?.artifactSchemaVersion !== ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION) {
    failures.push(`artifact schema must equal ${ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION}`)
  }
  if (summary?.strategyId !== STRATEGY_ID) failures.push(`strategyId must equal ${STRATEGY_ID}`)
  if (summary?.selected?.candidateId !== STRATEGY_ID) {
    failures.push(`selected candidateId must equal ${STRATEGY_ID}`)
  }
  failures.push(...validationIntegrityFailures(summary, reviewedIntegrity))
  failures.push(...liveContractFailures(summary))
  failures.push(...liveTargetParityFailures(summary, currentParity))
  failures.push(...brokerExecutionFailures(summary, reviewedBrokerExecution))
  return failures
}

export function loadAllYearStrategyArtifact(repoDir) {
  const filePath = resolveAllYearStrategyArtifactPath(repoDir)
  const reviewedIntegrity = loadValidationIntegrityManifest(repoDir)
  const reviewedBrokerExecution = loadReviewedBrokerExecutionProfile(repoDir)
  let raw
  let summary
  try {
    raw = fs.readFileSync(filePath)
    summary = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    throw new Error(`Unable to read the reviewed all-year strategy artifact: ${error.message}`)
  }
  let currentParity
  try {
    currentParity = currentLiveTargetParity(repoDir, summary)
  } catch (error) {
    throw new Error(`Unable to verify live-target parity: ${error.message}`)
  }
  const paperFailures = paperEligibilityFailures(
    summary,
    reviewedIntegrity,
    reviewedBrokerExecution,
    currentParity,
  )
  const integrityFailures = contractIntegrityFailures(
    summary,
    reviewedIntegrity,
    reviewedBrokerExecution,
    currentParity,
  )
  const liveFailures = liveEligibilityFailures(summary, paperFailures)
  const paperEligible = paperFailures.length === 0
  const liveEligible = liveFailures.length === 0
  const binding = {
    strategyId: summary?.strategyId ?? null,
    artifactSchemaVersion: summary?.artifactSchemaVersion ?? null,
    digestSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    generatedAt: summary?.generatedAt ?? null,
    status: summary?.status ?? null,
    eligibleCandidateCount: summary?.search?.eligibleCandidateCount ?? null,
    selectionUsedHoldout: summary?.search?.selectionUsedHoldout ?? null,
    liveComponentContractDigestSha256:
      summary?.contract?.liveInference?.componentContractDigestSha256 ?? null,
    brokerExecutionProfileDigestSha256:
      summary?.contract?.brokerExecution?.profileDigestSha256 ?? null,
    validationIntegrityDigestSha256: summary?.validation?.integrity?.manifestDigestSha256 ?? null,
    pristineForwardEvidence: summary?.validation?.integrity?.pristineForwardEvidence ?? null,
    forwardObservedThrough: summary?.validation?.integrity?.forwardObservedThrough ?? null,
    forwardEvidenceArtifactDigestSha256:
      summary?.validation?.integrity?.forwardEvidenceArtifactDigestSha256 ?? null,
    forwardEvidenceReviewedAt:
      summary?.validation?.integrity?.forwardEvidenceReviewedAt ?? null,
    paperExecutionEvidenceStatus:
      summary?.validation?.integrity?.paperExecutionEvidenceStatus ?? null,
    paperExecutionEvidenceArtifactDigestSha256:
      summary?.validation?.integrity?.paperExecutionEvidenceArtifactDigestSha256 ?? null,
    paperExecutionEvidenceSatisfied:
      summary?.validation?.integrity?.paperExecutionEvidenceSatisfied ?? null,
    paperApprovalStatus: summary?.validation?.integrity?.paperApprovalStatus ?? null,
    liveApprovalStatus: summary?.validation?.integrity?.liveApprovalStatus ?? null,
    strategyContractDigestSha256: summary?.validation?.integrity?.strategyContractDigestSha256 ?? null,
    paperEligible,
    liveEligible,
    // Backward-compatible handoff field; promotion means eligibility for real-capital routing.
    promotionEligible: liveEligible,
  }
  return {
    filePath,
    summary,
    binding,
    reviewedIntegrity,
    reviewedBrokerExecution,
    currentParity,
    contractIntegrityFailures: integrityFailures,
    paperEligibilityFailures: paperFailures,
    liveEligibilityFailures: liveFailures,
    promotionFailures: liveFailures,
  }
}

export function strategyArtifactBindingBlocks(providedBinding, currentArtifact, { mode = 'paper' } = {}) {
  const blocks = []
  const liveMode = mode === 'live'
  const eligibilityFailures = liveMode
    ? currentArtifact.liveEligibilityFailures
    : currentArtifact.paperEligibilityFailures
  if (eligibilityFailures.length) {
    blocks.push(`reviewed artifact is not ${liveMode ? 'live' : 'paper'}-eligible: ${eligibilityFailures.join('; ')}`)
  }
  const current = currentArtifact.binding
  if (!providedBinding || typeof providedBinding !== 'object') {
    blocks.push('inference is missing its reviewed strategy artifact binding')
    return blocks
  }
  for (const field of [
    'strategyId',
    'artifactSchemaVersion',
    'digestSha256',
    'generatedAt',
    'status',
    'eligibleCandidateCount',
    'selectionUsedHoldout',
    'liveComponentContractDigestSha256',
    'brokerExecutionProfileDigestSha256',
    'validationIntegrityDigestSha256',
    'pristineForwardEvidence',
    'forwardObservedThrough',
    'forwardEvidenceArtifactDigestSha256',
    'forwardEvidenceReviewedAt',
    'paperExecutionEvidenceStatus',
    'paperExecutionEvidenceArtifactDigestSha256',
    'paperExecutionEvidenceSatisfied',
    'paperApprovalStatus',
    'liveApprovalStatus',
    'strategyContractDigestSha256',
    'paperEligible',
    'liveEligible',
    'promotionEligible',
  ]) {
    if (providedBinding[field] !== current[field]) {
      blocks.push(`inference strategy artifact ${field} does not match the current reviewed artifact`)
    }
  }
  return blocks
}

export function assertPaperEligibleStrategyArtifact(repoDir) {
  const artifact = loadAllYearStrategyArtifact(repoDir)
  if (artifact.paperEligibilityFailures.length) {
    throw new Error(
      `The reviewed ${STRATEGY_ID} artifact is not paper-eligible: ${artifact.paperEligibilityFailures.join('; ')}. Paper inference remains disabled.`,
    )
  }
  return artifact
}

export function assertStrategyArtifactContractIntegrity(repoDir) {
  const artifact = loadAllYearStrategyArtifact(repoDir)
  if (artifact.contractIntegrityFailures.length) {
    throw new Error(
      `The reviewed ${STRATEGY_ID} artifact contract is not current and internally consistent: ${artifact.contractIntegrityFailures.join('; ')}. Research shadow collection remains disabled.`,
    )
  }
  return artifact
}

export const assertPromotionEligibleStrategyArtifact = assertPaperEligibleStrategyArtifact
