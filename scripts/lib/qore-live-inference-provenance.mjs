import crypto from 'node:crypto'
import {
  executableLiveComponentActiveForDate,
  executableLiveGasPositionCapForTarget,
  executableLiveGasPositionTargetsForTarget,
  executableLiveComponentContract,
  selectedContracts,
} from './qore-live-contract.mjs'
import {
  LEGACY_FORECAST_TEMPORAL_CONTRACT,
  SUMMER_FORECAST_TEMPORAL_CONTRACT,
} from './qore-summer-forecast-contract.mjs'

const PRODUCTION_MODE = 'selected-contract-live-source-set-00z'
export const LIVE_GAS_POSITION_CAP_TOLERANCE = 1e-6
export const LIVE_INFERENCE_TARGET_BINDING_SCHEMA_VERSION = 1
export const LIVE_INFERENCE_INPUT_PROFILE = Object.freeze({
  schemaVersion: 1,
  profileId: 'qore-reviewed-production-inputs-v1',
  testOnlyOverrideNames: Object.freeze([]),
})

function liveInferenceInputProfileBlocks(profile) {
  const blocks = []
  if (profile?.schemaVersion !== LIVE_INFERENCE_INPUT_PROFILE.schemaVersion) {
    blocks.push(`inputProfile.schemaVersion must equal ${LIVE_INFERENCE_INPUT_PROFILE.schemaVersion}`)
  }
  if (profile?.profileId !== LIVE_INFERENCE_INPUT_PROFILE.profileId) {
    blocks.push(`inputProfile.profileId must equal ${LIVE_INFERENCE_INPUT_PROFILE.profileId}`)
  }
  if (!exactArray(profile?.testOnlyOverrideNames, LIVE_INFERENCE_INPUT_PROFILE.testOnlyOverrideNames)) {
    blocks.push('inputProfile must not contain test-only input overrides')
  }
  return blocks
}

function componentThesesByWindow(component) {
  return Object.fromEntries(
    Object.entries(component.positionCaps).map(([windowId, theses]) => [
      windowId,
      new Set(Object.keys(theses)),
    ]),
  )
}

const CONTRACTS = {
  summer: {
    componentStrategyId: executableLiveComponentContract.summer.strategyId,
    requiredSources: [...selectedContracts.summer.sourceIds],
    collectedSources: [...selectedContracts.summer.sourceIds],
    requiredLeads: [7],
    temporalContract: SUMMER_FORECAST_TEMPORAL_CONTRACT,
    thesesByWindow: componentThesesByWindow(executableLiveComponentContract.summer),
  },
  winter: {
    componentStrategyId: executableLiveComponentContract.winter.strategyId,
    requiredSources: [...selectedContracts.winterFollow.liveSourceIds],
    collectedSources: [...selectedContracts.winterFollow.liveHeatingDemandSourceIds],
    requiredLeads: [1, 2, 3, 7, 8, 9, 10],
    temporalContract: LEGACY_FORECAST_TEMPORAL_CONTRACT,
    thesesByWindow: componentThesesByWindow(executableLiveComponentContract.winter),
  },
}

export function liveGasPositionExactTargetBlocks({
  season,
  componentStrategyId = executableLiveComponentContract[season]?.strategyId,
  windowId,
  thesisKind,
  gasPosition,
}) {
  const numericGasPosition = Number(gasPosition)
  if (!Number.isFinite(numericGasPosition)) return ['intent gasPosition must be finite before exact target validation']
  const allowed = executableLiveGasPositionTargetsForTarget({
    season,
    componentStrategyId,
    windowId,
    thesisKind,
  })
  if (
    numericGasPosition === roundedTargetWeight(numericGasPosition)
    && allowed.includes(numericGasPosition)
  ) return []
  return [
    `intent gasPosition ${numericGasPosition} is not an exact executable ${season} ${windowId}/${thesisKind} target`,
  ]
}

export function liveTargetAllocationBlocks({ gasPosition, indexFraction, cashFraction }) {
  const numericGasPosition = Number(gasPosition)
  const numericIndexFraction = Number(indexFraction)
  const numericCashFraction = Number(cashFraction)
  if (
    !Number.isFinite(numericGasPosition)
    || !Number.isFinite(numericIndexFraction)
    || !Number.isFinite(numericCashFraction)
  ) {
    return ['target gasPosition, indexFraction, and cashFraction must all be finite']
  }
  const blocks = []
  const expectedIndexFraction = roundedTargetWeight(
    Math.max(0, 1 - Math.abs(numericGasPosition)),
  )
  if (numericGasPosition !== roundedTargetWeight(numericGasPosition)) {
    blocks.push('target gasPosition must equal its canonical four-decimal representation')
  }
  if (numericIndexFraction !== expectedIndexFraction) {
    blocks.push(`target indexFraction must exactly equal ${expectedIndexFraction} for gasPosition ${numericGasPosition}`)
  }
  if (numericCashFraction !== 0) {
    blocks.push('target cashFraction must exactly equal zero')
  }
  return blocks
}

function exactArray(actual, expected) {
  return (
    Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
  )
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function digestValueSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function exactValue(actual, expected) {
  return JSON.stringify(canonicalize(actual)) === JSON.stringify(canonicalize(expected))
}

function roundedTargetWeight(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric * 10_000) / 10_000
}

export function liveInferenceTargetDigestSha256(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null
  return digestValueSha256({
    schemaVersion: LIVE_INFERENCE_TARGET_BINDING_SCHEMA_VERSION,
    target,
  })
}

export function liveInferenceSourceTargetBlocks(signalHandoff, sourceInference) {
  const blocks = []
  const target = sourceInference?.target
  const binding = signalHandoff?.sourceInferenceTargetBinding
  const targetDigestSha256 = liveInferenceTargetDigestSha256(target)
  if (!targetDigestSha256) {
    return ['configured source inference snapshot has no canonical target object']
  }
  if (binding?.schemaVersion !== LIVE_INFERENCE_TARGET_BINDING_SCHEMA_VERSION) {
    blocks.push(`sourceInferenceTargetBinding.schemaVersion must equal ${LIVE_INFERENCE_TARGET_BINDING_SCHEMA_VERSION}`)
  }
  if (binding?.digestSha256 !== targetDigestSha256) {
    blocks.push('sourceInferenceTargetBinding.digestSha256 does not match the configured source inference target')
  }
  if (binding?.sourceServiceId !== sourceInference?.serviceId) {
    blocks.push('sourceInferenceTargetBinding.sourceServiceId does not match the configured source inference snapshot')
  }
  if (binding?.sourceGeneratedAt !== sourceInference?.generatedAt) {
    blocks.push('sourceInferenceTargetBinding.sourceGeneratedAt does not match the configured source inference snapshot')
  }
  if (sourceInference?.validated !== true || sourceInference?.liveForecastAppliedToTarget !== true) {
    blocks.push('configured source inference snapshot must be validated with its live forecast applied')
  }
  blocks.push(...liveInferenceInputProfileBlocks(sourceInference?.inputProfile))
  blocks.push(...liveGasPositionContractBlocks({
    season: sourceInference?.season,
    targetDate: target?.targetDate,
    componentStrategyId: target?.componentStrategyId,
    windowId: target?.windowId,
    thesisKind: target?.thesisKind,
    gasPosition: target?.gasPosition,
  }))
  blocks.push(...liveTargetAllocationBlocks(target ?? {}))

  const intent = signalHandoff?.intent
  const inference = signalHandoff?.inference
  const exactIntentFields = [
    ['strategyId', target?.strategyId],
    ['signalDate', target?.signalDate],
    ['targetDate', target?.targetDate],
    ['direction', target?.direction],
    ['confidence', target?.confidence],
  ]
  for (const [field, expected] of exactIntentFields) {
    if (intent?.[field] !== expected) {
      blocks.push(`signal intent ${field} does not match the configured source inference target`)
    }
  }
  for (const field of ['gasPosition', 'indexFraction', 'cashFraction']) {
    if (Number(intent?.[field]) !== roundedTargetWeight(target?.[field])) {
      blocks.push(`signal intent ${field} does not match the configured source inference target`)
    }
  }

  const exactInferenceFields = [
    ['strategyId', sourceInference?.strategyId],
    ['mode', sourceInference?.inferenceMode],
    ['season', sourceInference?.season],
    ['targetDate', target?.targetDate],
    ['componentStrategyId', target?.componentStrategyId],
    ['windowId', target?.windowId],
    ['thesisKind', target?.thesisKind],
  ]
  for (const [field, expected] of exactInferenceFields) {
    if (inference?.[field] !== expected) {
      blocks.push(`signal inference ${field} does not match the configured source inference snapshot`)
    }
  }
  if (!exactValue(inference?.forecastValidation, sourceInference?.forecastValidation)) {
    blocks.push('signal forecastValidation does not match the configured source inference snapshot')
  }
  if (!exactValue(inference?.strategyArtifact, sourceInference?.strategyArtifact)) {
    blocks.push('signal strategyArtifact does not match the configured source inference snapshot')
  }
  if (!exactValue(inference?.inputProfile, sourceInference?.inputProfile)) {
    blocks.push('signal inputProfile does not match the configured source inference snapshot')
  }
  return blocks
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : null
}

function addDays(dateText, count) {
  return new Date(Date.parse(`${dateText}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10)
}

export function liveInferenceSeasonForDate(dateText) {
  if (!validDate(dateText)) return null
  const month = Number(dateText.slice(5, 7))
  const leadMonth = Number(addDays(dateText, 7).slice(5, 7))
  return (month >= 5 && month <= 9) || (leadMonth >= 5 && leadMonth <= 9) ? 'summer' : 'winter'
}

export function liveGasPositionContractBlocks({
  season,
  targetDate,
  componentStrategyId,
  windowId,
  thesisKind,
  gasPosition,
}) {
  const blocks = []
  const expectedSeason = liveInferenceSeasonForDate(targetDate)
  if (!expectedSeason) blocks.push('targetDate must be valid before applying the reviewed gas-position limit')
  if (!Object.hasOwn(CONTRACTS, season)) {
    blocks.push('inference season must equal summer or winter before applying the reviewed gas-position limit')
    return blocks
  }
  if (expectedSeason && season !== expectedSeason) {
    blocks.push(`inference season must equal ${expectedSeason} for target date ${targetDate}`)
  }

  const numericGasPosition = gasPosition === null || gasPosition === undefined || gasPosition === ''
    ? null
    : Number(gasPosition)
  if (!Number.isFinite(numericGasPosition)) {
    blocks.push('intent gasPosition must be finite before applying the reviewed gas-position limit')
    return blocks
  }

  const contract = CONTRACTS[season]
  if (componentStrategyId === 'index-fallback') {
    if (windowId !== 'index-fallback' || thesisKind !== 'index-fallback' || numericGasPosition !== 0) {
      blocks.push('index-fallback provenance requires index-fallback window/thesis and zero gasPosition')
    }
  } else if (componentStrategyId !== contract.componentStrategyId) {
    blocks.push(`componentStrategyId must equal ${contract.componentStrategyId} or index-fallback for ${season}`)
  } else {
    if (expectedSeason && !executableLiveComponentActiveForDate({ season, targetDate })) {
      blocks.push(`${contract.componentStrategyId} is not active for target date ${targetDate} under its sealed target-date policy`)
    }
    const allowedTheses = contract.thesesByWindow[windowId]
    const exactTargets = executableLiveGasPositionTargetsForTarget({
      season,
      componentStrategyId,
      windowId,
      thesisKind,
    })
    const targetSigns = new Set(exactTargets.map(Math.sign).filter((sign) => sign !== 0))
    if (!allowedTheses?.has(thesisKind)) {
      blocks.push(`${contract.componentStrategyId} windowId/thesisKind is not a reviewed ${season} target combination`)
    }
    if (numericGasPosition === 0) {
      blocks.push(`${contract.componentStrategyId} provenance requires a nonzero intent gasPosition`)
    } else if (targetSigns.size === 1 && targetSigns.has(1) && numericGasPosition <= 0) {
      blocks.push(`${thesisKind} provenance requires intent gasPosition greater than zero`)
    } else if (targetSigns.size === 1 && targetSigns.has(-1) && numericGasPosition >= 0) {
      blocks.push(`${thesisKind} provenance requires intent gasPosition less than zero`)
    }
    if (numericGasPosition !== 0 && allowedTheses?.has(thesisKind)) {
      blocks.push(...liveGasPositionExactTargetBlocks({
        season,
        componentStrategyId,
        windowId,
        thesisKind,
        gasPosition: numericGasPosition,
      }))
    }
  }

  const cap = executableLiveGasPositionCapForTarget({
    season,
    componentStrategyId,
    windowId,
    thesisKind,
  })
  if (cap === null) {
    blocks.push(`reviewed executable gas-position cap is unavailable for ${season}/${windowId}/${thesisKind}`)
  } else if (Math.abs(numericGasPosition) > cap + LIVE_GAS_POSITION_CAP_TOLERANCE) {
    blocks.push(
      `intent gasPosition ${numericGasPosition} exceeds the reviewed ${season} ${windowId}/${thesisKind} executable cap ${cap}`,
    )
  }
  return blocks
}

export function liveInferenceProvenanceBlocks(signalHandoff, asOf = new Date()) {
  const blocks = []
  const inference = signalHandoff?.inference
  const intent = signalHandoff?.intent
  const today = asOf.toISOString().slice(0, 10)
  const intentTargetDate = validDate(intent?.targetDate)
  const inferenceTargetDate = validDate(inference?.targetDate)
  if (!intentTargetDate || intent?.targetDate !== today) {
    blocks.push(`intent targetDate must be the current UTC date ${today}`)
  }
  if (!inferenceTargetDate || inference?.targetDate !== intent?.targetDate) {
    blocks.push('inference targetDate must be valid and exactly match intent targetDate')
  }

  const season = liveInferenceSeasonForDate(today)
  const contract = CONTRACTS[season]
  if (inference?.season !== season) blocks.push(`inference season must equal ${season} for target date ${today}`)
  if (inference?.mode !== PRODUCTION_MODE) {
    blocks.push(`inference mode must equal ${PRODUCTION_MODE}`)
  }
  const validation = inference?.forecastValidation
  blocks.push(...liveInferenceInputProfileBlocks(inference?.inputProfile))
  if (validation?.runHourUtc !== '00') blocks.push('forecast runHourUtc must equal 00')
  if (!exactArray(validation?.requiredSources, contract.requiredSources)) {
    blocks.push(`requiredSources must equal the reviewed ${season} selected-contract source set`)
  }
  if (!exactArray(validation?.collectedSources, contract.collectedSources)) {
    blocks.push(`collectedSources must equal the reviewed ${season} selected-contract collection set`)
  }
  if (!exactArray(validation?.requiredLeads, contract.requiredLeads)) {
    blocks.push(`requiredLeads must equal the reviewed ${season} selected-contract lead set`)
  }
  if (!exactValue(validation?.temporalContract, contract.temporalContract)) {
    blocks.push(`forecast temporalContract must equal the reviewed ${season} temporal sampling contract`)
  }
  const scoreRowCount = Number(validation?.scoreRowCount)
  const minimumRows = contract.requiredSources.length * contract.requiredLeads.length
  if (!Number.isInteger(scoreRowCount) || scoreRowCount < minimumRows) {
    blocks.push(`scoreRowCount must be an integer of at least ${minimumRows} for a complete common issue set`)
  }

  const componentStrategyId = inference?.componentStrategyId
  const windowId = inference?.windowId
  const thesisKind = inference?.thesisKind
  blocks.push(...liveGasPositionContractBlocks({
    season: inference?.season,
    targetDate: intent?.targetDate,
    componentStrategyId,
    windowId,
    thesisKind,
    gasPosition: intent?.gasPosition,
  }))
  blocks.push(...liveTargetAllocationBlocks(intent ?? {}))

  const issueDate = validDate(validation?.latestCommonIssueDate)
  const issueAgeDays = Number(validation?.issueAgeDays)
  if (!issueDate) {
    blocks.push('latestCommonIssueDate must be a valid date')
  } else {
    const computedAgeDays = (Date.parse(`${today}T00:00:00Z`) - issueDate.getTime()) / 86400000
    if (
      !Number.isFinite(issueAgeDays)
      || issueAgeDays < 0
      || Math.abs(issueAgeDays - computedAgeDays) > 0.01
    ) {
      blocks.push('issueAgeDays must coherently match latestCommonIssueDate')
    }
  }
  return blocks
}
