import crypto from 'node:crypto'
import {
  executableLiveComponentContract,
  selectedContracts,
} from './qore-live-contract.mjs'

export const WINTER_SHADOW_CHALLENGER_SCHEMA_VERSION = 1
export const WINTER_SHADOW_EVALUATION_SCHEMA_VERSION = 1

function freezeCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy))
  if (!value || typeof value !== 'object') return value
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, freezeCopy(nested)]),
  ))
}

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

export function winterShadowValueDigestSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export const WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT = freezeCopy(
  executableLiveComponentContract.winter,
)

export const WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256 =
  '779b88fe3c55b9d5419010892f3c134732cff2f7ff59371b44b92ab174538236'

const ACTIVE_SIGNAL_SOURCE_IDS = freezeCopy(selectedContracts.winterFollow.sourceIds)
const ACTIVE_HEATING_DEMAND_SOURCE_IDS = freezeCopy(
  selectedContracts.winterFollow.liveHeatingDemandSourceIds,
)
const FIXED_CORE_SOURCE_IDS = Object.freeze(['gfs', 'gefs-mean'])

export const WINTER_SHADOW_COMPARATOR_CANDIDATE_ID =
  'winter-current-expanding-sources-bg-shrink-comparator-v1'
export const WINTER_SHADOW_CHALLENGER_CANDIDATE_ID =
  'winter-fixed-gfs-gefs-core-equal-shadow-v1'

export const WINTER_SHADOW_CANDIDATE_FAMILY = freezeCopy([
  {
    candidateId: WINTER_SHADOW_COMPARATOR_CANDIDATE_ID,
    role: 'active-comparator',
    signalSourceIds: ACTIVE_SIGNAL_SOURCE_IDS,
    heatingDemandSourceIds: ACTIVE_HEATING_DEMAND_SOURCE_IDS,
    sourceWeightMode: selectedContracts.winterFollow.sourceWeightMode,
  },
  {
    candidateId: 'winter-fixed-gfs-gefs-core-bg-shrink-sensitivity-v1',
    role: 'adjacent-sensitivity',
    signalSourceIds: FIXED_CORE_SOURCE_IDS,
    heatingDemandSourceIds: FIXED_CORE_SOURCE_IDS,
    sourceWeightMode: 'bg-shrink',
  },
  {
    candidateId: WINTER_SHADOW_CHALLENGER_CANDIDATE_ID,
    role: 'frozen-research-challenger',
    signalSourceIds: FIXED_CORE_SOURCE_IDS,
    heatingDemandSourceIds: FIXED_CORE_SOURCE_IDS,
    sourceWeightMode: 'equal',
  },
  {
    candidateId: 'winter-expanding-sources-equal-sensitivity-v1',
    role: 'adjacent-sensitivity',
    signalSourceIds: ACTIVE_SIGNAL_SOURCE_IDS,
    heatingDemandSourceIds: ACTIVE_HEATING_DEMAND_SOURCE_IDS,
    sourceWeightMode: 'equal',
  },
  {
    candidateId: 'winter-fixed-core-equal-all-demand-sensitivity-v1',
    role: 'adjacent-sensitivity',
    signalSourceIds: FIXED_CORE_SOURCE_IDS,
    heatingDemandSourceIds: ACTIVE_HEATING_DEMAND_SOURCE_IDS,
    sourceWeightMode: 'equal',
  },
  {
    candidateId: 'winter-fixed-core-signal-all-demand-bg-shrink-sensitivity-v1',
    role: 'adjacent-sensitivity',
    signalSourceIds: FIXED_CORE_SOURCE_IDS,
    heatingDemandSourceIds: ACTIVE_HEATING_DEMAND_SOURCE_IDS,
    sourceWeightMode: 'bg-shrink',
  },
])

export const WINTER_SHADOW_CANDIDATE_FAMILY_DIGEST_SHA256 =
  '4d6e3e5c55f74d51a295cbea579d69810aaeeb47700f17fef167911a599afca2'

export const WINTER_SHADOW_CHALLENGER = freezeCopy({
  schemaVersion: WINTER_SHADOW_CHALLENGER_SCHEMA_VERSION,
  contractId: 'winter-fixed-gfs-gefs-core-equal-shadow-v1',
  challengerCandidateId: WINTER_SHADOW_CHALLENGER_CANDIDATE_ID,
  comparatorCandidateId: WINTER_SHADOW_COMPARATOR_CANDIDATE_ID,
  role: 'historical-research-shadow',
  executionEligible: false,
  publicStrategy: false,
  frozenOn: '2026-07-22',
  comparatorComponentContract: WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT,
  comparatorComponentContractDigestSha256:
    WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256,
  candidateFamily: WINTER_SHADOW_CANDIDATE_FAMILY,
  candidateFamilyDigestSha256: WINTER_SHADOW_CANDIDATE_FAMILY_DIGEST_SHA256,
  parameterDelta: {
    weatherFollow: {
      sourceSetId: 'gfs-gefs-core',
      sourceIds: FIXED_CORE_SOURCE_IDS,
      sourceWeightMode: 'equal',
    },
    heatingDemand: {
      sourceIds: FIXED_CORE_SOURCE_IDS,
      sourceWeightMode: 'equal',
    },
    unchangedLayers: [
      'weather-reversion signal',
      'volatility confirmation',
      'weather-resolution sizing',
      'storage gate',
      'heating-demand tiers',
      'hold periods',
      'overlay risk multiplier and cap',
      'execution contract and costs',
      'all-year selector and index fallback',
    ],
  },
  evaluation: {
    historicalEvidenceStatus: 'development-contaminated',
    comparison:
      'Causal daily UNG/VOO/QQQM net return versus a recomputed unchanged active Winter comparator.',
    familyAdjustment:
      'The deterministic evaluator adjusts against every non-comparator candidate in the frozen focused family.',
    outputPolicy: 'stdout only; callers may redirect only to untracked .local/qore research state',
    promotionPolicy:
      'Research review only. This contract cannot alter selected artifacts, live target parity, broker handoffs, or paper/live eligibility.',
  },
})

export const WINTER_SHADOW_CHALLENGER_DIGEST_SHA256 =
  '330877b809d2ddbc00286908addcfb48dfc1bbff75d64972d51cd5e1eec97ba8'

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

export function validateWinterShadowChallenger(
  activeComponentContract = executableLiveComponentContract.winter,
) {
  if (!activeComponentContract || typeof activeComponentContract !== 'object') {
    throw new Error('The Winter shadow challenger requires the active Winter component contract.')
  }
  if (
    winterShadowValueDigestSha256(activeComponentContract)
      !== WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256
  ) {
    throw new Error('The active Winter component contract does not match the frozen shadow comparator.')
  }
  if (WINTER_SHADOW_CHALLENGER.executionEligible || WINTER_SHADOW_CHALLENGER.publicStrategy) {
    throw new Error('The Winter shadow challenger must remain research-only and execution-ineligible.')
  }

  const candidateIds = new Set()
  for (const candidate of WINTER_SHADOW_CANDIDATE_FAMILY) {
    if (!candidate?.candidateId || candidateIds.has(candidate.candidateId)) {
      throw new Error('The Winter shadow candidate family contains a missing or duplicate candidateId.')
    }
    candidateIds.add(candidate.candidateId)
    if (!['equal', 'bg-shrink'].includes(candidate.sourceWeightMode)) {
      throw new Error(`Winter shadow candidate ${candidate.candidateId} has an unsupported source weight mode.`)
    }
    if (!candidate.signalSourceIds.length || !candidate.heatingDemandSourceIds.length) {
      throw new Error(`Winter shadow candidate ${candidate.candidateId} has an empty source set.`)
    }
  }

  const comparator = WINTER_SHADOW_CANDIDATE_FAMILY.find(
    (candidate) => candidate.candidateId === WINTER_SHADOW_CHALLENGER.comparatorCandidateId,
  )
  if (
    !comparator
    || comparator.role !== 'active-comparator'
    || !sameStringArray(comparator.signalSourceIds, ACTIVE_SIGNAL_SOURCE_IDS)
    || !sameStringArray(comparator.heatingDemandSourceIds, ACTIVE_HEATING_DEMAND_SOURCE_IDS)
    || comparator.sourceWeightMode !== selectedContracts.winterFollow.sourceWeightMode
  ) {
    throw new Error('The Winter shadow comparator candidate does not reproduce the active source contract.')
  }

  const challenger = WINTER_SHADOW_CANDIDATE_FAMILY.find(
    (candidate) => candidate.candidateId === WINTER_SHADOW_CHALLENGER.challengerCandidateId,
  )
  if (
    !challenger
    || challenger.role !== 'frozen-research-challenger'
    || !sameStringArray(challenger.signalSourceIds, FIXED_CORE_SOURCE_IDS)
    || !sameStringArray(challenger.heatingDemandSourceIds, FIXED_CORE_SOURCE_IDS)
    || challenger.sourceWeightMode !== 'equal'
  ) {
    throw new Error('The Winter shadow challenger is not the frozen GFS/GEFS equal-weight contract.')
  }
  if (
    WINTER_SHADOW_CHALLENGER.candidateFamilyDigestSha256
      !== winterShadowValueDigestSha256(WINTER_SHADOW_CANDIDATE_FAMILY)
  ) {
    throw new Error('The Winter shadow candidate-family digest is stale.')
  }
  if (
    WINTER_SHADOW_CHALLENGER_DIGEST_SHA256
      !== winterShadowValueDigestSha256(WINTER_SHADOW_CHALLENGER)
  ) {
    throw new Error('The frozen Winter shadow challenger digest is stale.')
  }
  return true
}

export function winterShadowCompatibilityFailures({ activeComponentContract } = {}) {
  const failures = []
  try {
    validateWinterShadowChallenger(activeComponentContract)
  } catch (error) {
    failures.push(error.message)
  }
  return failures
}
