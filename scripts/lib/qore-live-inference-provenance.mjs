import {
  executableLiveGasPositionCapForTarget,
  executableLiveComponentContract,
  selectedContracts,
} from './qore-live-contract.mjs'

const PRODUCTION_MODE = 'selected-contract-live-source-set-00z'
export const LIVE_GAS_POSITION_CAP_TOLERANCE = 1e-6

const CONTRACTS = {
  summer: {
    componentStrategyId: executableLiveComponentContract.summer.strategyId,
    requiredSources: [...selectedContracts.summer.sourceIds],
    collectedSources: [...selectedContracts.summer.sourceIds],
    requiredLeads: [7],
    thesesByWindow: {
      'weather-follow': new Set(['summer-heat-long', 'summer-cold-short']),
      'weather-reversion': new Set(['reversion-long', 'reversion-short']),
    },
  },
  winter: {
    componentStrategyId: executableLiveComponentContract.winter.strategyId,
    requiredSources: [...selectedContracts.winterFollow.liveSourceIds],
    collectedSources: [...selectedContracts.winterFollow.liveHeatingDemandSourceIds],
    requiredLeads: [1, 2, 3, 7, 8, 9, 10],
    thesesByWindow: {
      'weather-follow': new Set(['cold-long', 'warm-short']),
      'weather-reversion': new Set(['reversion-long', 'reversion-short']),
    },
  },
}

const LONG_THESES = new Set(['summer-heat-long', 'cold-long', 'reversion-long'])
const SHORT_THESES = new Set(['summer-cold-short', 'warm-short', 'reversion-short'])

function exactArray(actual, expected) {
  return (
    Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
  )
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
    const allowedTheses = contract.thesesByWindow[windowId]
    if (!allowedTheses?.has(thesisKind)) {
      blocks.push(`${contract.componentStrategyId} windowId/thesisKind is not a reviewed ${season} target combination`)
    }
    if (numericGasPosition === 0) {
      blocks.push(`${contract.componentStrategyId} provenance requires a nonzero intent gasPosition`)
    } else if (LONG_THESES.has(thesisKind) && numericGasPosition <= 0) {
      blocks.push(`${thesisKind} provenance requires intent gasPosition greater than zero`)
    } else if (SHORT_THESES.has(thesisKind) && numericGasPosition >= 0) {
      blocks.push(`${thesisKind} provenance requires intent gasPosition less than zero`)
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
