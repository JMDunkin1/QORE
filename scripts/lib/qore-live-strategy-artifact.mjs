import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION,
  executableLiveComponentContractDigestSha256,
  liveComponentContractDigestSha256,
} from './qore-live-contract.mjs'

const STRATEGY_ID = 'ngas-all-year-beta'
const PROMOTION_STATUS = 'research-baseline'
const ARTIFACT_SCHEMA_VERSION = 3
const REQUIRED_PROMOTION_GATES = [
  'positiveTrainEdge',
  'positiveValidationEdge',
  'preHoldoutBootstrapSignificance',
  'trainMaxDrawdown',
  'validationMaxDrawdown',
  'summerComponent',
  'winterComponent',
  'liveContract',
]

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

export function resolveAllYearStrategyArtifactPath(repoDir) {
  const configured = process.env.QORE_LIVE_STRATEGY_ARTIFACT_FILE
  if (configured && process.env.NODE_ENV !== 'test') {
    throw new Error('QORE_LIVE_STRATEGY_ARTIFACT_FILE is test-only; live routing is bound to the checked-in all-year artifact.')
  }
  return configured
    ? path.resolve(configured)
    : path.join(repoDir, 'data', 'qore', 'research', 'strategy-agent-runs', STRATEGY_ID, 'run-summary.json')
}

function promotionFailures(summary) {
  const failures = []
  if (summary?.artifactSchemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    failures.push(`artifact schema must equal ${ARTIFACT_SCHEMA_VERSION}`)
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
  for (const gate of REQUIRED_PROMOTION_GATES) {
    if (gates?.[gate] !== true) failures.push(`promotion gate ${gate} must pass`)
  }
  failures.push(...liveContractFailures(summary))
  return failures
}

export function loadAllYearStrategyArtifact(repoDir) {
  const filePath = resolveAllYearStrategyArtifactPath(repoDir)
  let raw
  let summary
  try {
    raw = fs.readFileSync(filePath)
    summary = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    throw new Error(`Unable to read the reviewed all-year strategy artifact: ${error.message}`)
  }
  const failures = promotionFailures(summary)
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
    promotionEligible: failures.length === 0,
  }
  return { filePath, summary, binding, promotionFailures: failures }
}

export function strategyArtifactBindingBlocks(providedBinding, currentArtifact) {
  const blocks = []
  if (currentArtifact.promotionFailures.length) {
    blocks.push(`reviewed artifact is not promotion-eligible: ${currentArtifact.promotionFailures.join('; ')}`)
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
    'promotionEligible',
  ]) {
    if (providedBinding[field] !== current[field]) {
      blocks.push(`inference strategy artifact ${field} does not match the current reviewed artifact`)
    }
  }
  return blocks
}

export function assertPromotionEligibleStrategyArtifact(repoDir) {
  const artifact = loadAllYearStrategyArtifact(repoDir)
  if (artifact.promotionFailures.length) {
    throw new Error(
      `The reviewed ${STRATEGY_ID} artifact is not promotion-eligible: ${artifact.promotionFailures.join('; ')}. Paper/live inference remains disabled.`,
    )
  }
  return artifact
}
