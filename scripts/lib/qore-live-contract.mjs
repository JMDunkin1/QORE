import crypto from 'node:crypto'
import { SUMMER_FORECAST_LOCATION_UNIVERSE } from './qore-summer-location-universe.mjs'
import { SUMMER_FORECAST_TEMPORAL_CONTRACT } from './qore-summer-forecast-contract.mjs'
import { FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT } from './qore-weather-data-quality.mjs'
import {
  WINTER_GRADED_SHIFT_PARAMETERS,
  WINTER_HEATING_DEMAND_BASE_F,
  WINTER_HEATING_DEMAND_TIERS,
  WINTER_PRODUCTION_HEATING_DEMAND_SOURCE_IDS,
  WINTER_PRODUCTION_SIGNAL_SOURCE_IDS,
} from './qore-winter-target-engine.mjs'
import {
  gasPositionTargetsFromLiveLattice,
  summerLiveTargetLattice,
  winterLiveTargetLattice,
} from './qore-live-target-lattice.mjs'

export { LIVE_TARGET_LATTICE_SCHEMA_VERSION } from './qore-live-target-lattice.mjs'

export const LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION = 5

const SUMMER_ACTIVE_TARGET_DATE_POLICY = Object.freeze({
  policyId: 'summer-session-or-lead-7-target-season-v1',
  sessionMonths: Object.freeze([5, 6, 7, 8, 9]),
  leadMonthActivation: Object.freeze({
    forecastLeadDays: 7,
    minimumEntryLagDays: 1,
    activationOffsetDays: 6,
    targetMonths: Object.freeze([5, 6, 7, 8, 9]),
  }),
  minimumCalendarDayByMonth: Object.freeze({}),
})
const WINTER_ACTIVE_TARGET_DATE_POLICY = Object.freeze({
  policyId: 'winter-session-months-v1',
  sessionMonths: Object.freeze([11, 12, 1, 2, 3]),
  leadMonthActivation: null,
  minimumCalendarDayByMonth: Object.freeze({ 11: 2 }),
})

function projectedActiveTargetDatePolicy(policy) {
  return {
    policyId: policy.policyId,
    sessionMonths: [...policy.sessionMonths],
    leadMonthActivation: policy.leadMonthActivation
      ? {
          forecastLeadDays: policy.leadMonthActivation.forecastLeadDays,
          minimumEntryLagDays: policy.leadMonthActivation.minimumEntryLagDays,
          activationOffsetDays: policy.leadMonthActivation.activationOffsetDays,
          targetMonths: [...policy.leadMonthActivation.targetMonths],
        }
      : null,
    minimumCalendarDayByMonth: { ...policy.minimumCalendarDayByMonth },
  }
}

const SUMMER = {
  candidateId: 'summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-wrnone-sdef1.25-vol0-fixed',
  architectureId: 'summer-weather-follow-and-fade',
  useFollowLeg: true,
  useReversionLeg: true,
  sourceSetId: 'gfs-gefs-core',
  sourceIds: ['gfs', 'gefs-mean'],
  minGroups: 1,
  minFamilies: 2,
  sourceWeightMode: 'equal',
  sizingMode: 'fixed',
  anomalyThreshold: 5,
  coverageThreshold: 0.25,
  minConfidence: 0.5,
  weatherFraction: 0.35,
  reversionFraction: 0.35,
  reversionDemandMode: 'cooling-demand-tiered',
  followHoldDays: 3,
  reversionHoldDays: 1,
  minRealizedMovePct: 2,
  freshHeatLookbackDays: 3,
  volTargetPct: 0,
  weatherResolutionMode: 'none',
}

const WINTER_FOLLOW = {
  candidateId: 'dual-ncep-complex-bg-shrink-a5-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-vol0-fixed',
  sourceSetId: 'ncep-complex',
  sourceIds: [...WINTER_PRODUCTION_SIGNAL_SOURCE_IDS],
  sourceWeightMode: 'bg-shrink',
  heatingDemandSourceIds: [...WINTER_PRODUCTION_HEATING_DEMAND_SOURCE_IDS],
  liveSourceIds: [...WINTER_PRODUCTION_SIGNAL_SOURCE_IDS],
  liveHeatingDemandSourceIds: [...WINTER_PRODUCTION_HEATING_DEMAND_SOURCE_IDS],
  anomalyThreshold: 5,
  coverageThreshold: 0.5,
  minConfidence: 0.5,
  minGroups: 1,
  minFamilies: 2,
  weatherFraction: 0.25,
  reversionFraction: 0.2,
  followHoldDays: 3,
  reversionHoldDays: 2,
  minRealizedMovePct: 2,
}

const WINTER_FADE = {
  ...WINTER_FOLLOW,
  candidateId: 'fade-only-gfs-gefs-core-a5-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-fixed',
  sourceSetId: 'gfs-gefs-core',
  sourceIds: ['gfs', 'gefs-mean'],
  sourceWeightMode: 'equal',
  useFollowLeg: false,
  signalAlgorithm: 'weather-hybrid',
}

const SUMMER_IMPLEMENTATION = {
  forecastLocationUniverse: SUMMER_FORECAST_LOCATION_UNIVERSE,
  scoreLocationAggregateContract: FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  forecastTemporalContract: SUMMER_FORECAST_TEMPORAL_CONTRACT,
  storageDeficitHeatMultiplier: 1.25,
  storageDeficitHeatMaxFraction: 0.4375,
  storageSeasonalLookbackYears: 5,
  storageAvailabilityContract: 'versioned-release-calendar-before-session-open',
  coolingDemand: {
    baseF: 65,
    solidAnomalyF: 5,
    extremeAnomalyF: 8,
    lowReversionSubtract: 0.15,
    solidReversionAdd: 0.05,
    extremeReversionAdd: 0.15,
    minimumReversionFraction: 0.2,
    solidMaximumReversionFraction: 0.45,
    extremeMaximumReversionFraction: 0.5,
  },
}

const WINTER_SELECTED = {
  candidateId: 'ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-hdd-follow-tiered-risk-125',
  architectureId: 'frozen-input-blend',
  useFollowLeg: true,
  useReversionLeg: true,
  sourceSetId: 'frozen-input-weather-experts',
  sourceIds: [
    'winter-alpha-weather-follow',
    'winter-alpha-weather-reversion',
    'winter-alpha-volatility-confirmation',
  ],
  sourceWeightMode: 'frozen-input-selected',
  sizingMode: 'short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-hdd-follow-tiered-risk-125',
  holdPeriodPolicy: {
    id: 'parent-selected',
    kind: 'parent-selected',
    followHoldDays: null,
    reversionHoldDays: null,
  },
  weatherResolutionPolicy: { id: 'graded-shift-sizing', kind: 'graded-shift' },
  coldFollowStoragePolicy: { id: 'storage-drawdown-400bcf', kind: 'season-drawdown', minSeasonDrawdownBcf: 400 },
  followFreshnessPolicy: { id: 'none', kind: 'none', lookbackDays: null },
  heatingDemandPolicy: { id: 'hdd-follow-tiered', kind: 'follow-tiered', minDemandAnomalyF: 4 },
  indexRiskMode: 'full-index-fallback',
  anomalyThreshold: null,
  coverageThreshold: null,
  minConfidence: null,
  weatherFraction: 0.25,
  reversionFraction: 0.2,
  reversionLongScale: 1,
  standaloneReversionScale: 1,
  overlayRiskMultiplier: 1.25,
  effectiveOverlayCap: 0.5625,
  overlayCap: 0.45,
  followHoldDays: 3,
  reversionHoldDays: 2,
  minRealizedMovePct: 2,
  conflictPolicy: 'short-fade-plus-cold-follow-vol-long',
}

const WINTER_IMPLEMENTATION = {
  forecastLocationUniverse: SUMMER_FORECAST_LOCATION_UNIVERSE,
  scoreLocationAggregateContract: FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  weatherFollow: WINTER_FOLLOW,
  weatherReversion: WINTER_FADE,
  sourceReliability: { gfs: 0.6092, 'gefs-mean': 1.167 },
  volatilityConfirmation: {
    candidateId: 'lb40-z0.8-vol2.5-6',
    lookbackSessions: 40,
    minimumReversalZ: 0.8,
    minimumVolatilityPct: 2.5,
    maximumVolatilityPct: 6,
  },
  weatherResolution: {
    sourceIds: ['gfs', 'gefs-mean'],
    minimumLeadDays: 1,
    maximumLeadDays: 3,
    ...WINTER_GRADED_SHIFT_PARAMETERS,
  },
  heatingDemand: {
    baseF: WINTER_HEATING_DEMAND_BASE_F,
    minimumAnomalyF: 4,
    ...WINTER_HEATING_DEMAND_TIERS,
  },
}

export const selectedContracts = {
  summer: SUMMER,
  winterFollow: WINTER_FOLLOW,
  winterFade: WINTER_FADE,
}

export const liveAllYearImplementation = {
  summer: SUMMER_IMPLEMENTATION,
  winter: WINTER_IMPLEMENTATION,
}

function projectPolicy(policy, fields) {
  return Object.fromEntries(fields.map((field) => [field, policy?.[field] ?? null]))
}

function projectSelected(selected, fields) {
  return Object.fromEntries(fields.map((field) => [field, selected?.[field] ?? null]))
}

const SUMMER_SELECTED_FIELDS = [
  'candidateId',
  'architectureId',
  'useFollowLeg',
  'useReversionLeg',
  'sourceSetId',
  'sourceIds',
  'minGroups',
  'minFamilies',
  'sourceWeightMode',
  'sizingMode',
  'anomalyThreshold',
  'coverageThreshold',
  'minConfidence',
  'weatherFraction',
  'reversionFraction',
  'reversionDemandMode',
  'followHoldDays',
  'reversionHoldDays',
  'minRealizedMovePct',
  'freshHeatLookbackDays',
  'volTargetPct',
  'weatherResolutionMode',
]

const WINTER_SELECTED_FIELDS = [
  'candidateId',
  'architectureId',
  'useFollowLeg',
  'useReversionLeg',
  'sourceSetId',
  'sourceIds',
  'sourceWeightMode',
  'sizingMode',
  'indexRiskMode',
  'anomalyThreshold',
  'coverageThreshold',
  'minConfidence',
  'weatherFraction',
  'reversionFraction',
  'reversionLongScale',
  'standaloneReversionScale',
  'overlayRiskMultiplier',
  'effectiveOverlayCap',
  'overlayCap',
  'followHoldDays',
  'reversionHoldDays',
  'minRealizedMovePct',
  'conflictPolicy',
]

function reviewedMaximumPositionFraction(label, values) {
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(`${label} contains an invalid executable position fraction.`)
  }
  return Math.max(...values)
}

function summerPositionCaps(selected, implementation) {
  const ordinaryFollowFraction = reviewedMaximumPositionFraction(
    'Summer ordinary weather-follow contract',
    [selected.weatherFraction],
  )
  const heatFollowFraction = reviewedMaximumPositionFraction(
    'Summer heat-follow contract',
    [ordinaryFollowFraction, implementation.storageDeficitHeatMaxFraction],
  )
  const heatReversionFraction = reviewedMaximumPositionFraction(
    'Summer heat-reversion contract',
    [
      selected.reversionFraction,
      implementation.coolingDemand.solidMaximumReversionFraction,
      implementation.coolingDemand.extremeMaximumReversionFraction,
    ],
  )
  return {
    'weather-follow': {
      'summer-heat-long': heatFollowFraction,
    },
    'weather-reversion': {
      'reversion-short': heatReversionFraction,
    },
  }
}

function winterPositionCaps(selected) {
  const overlayFraction = reviewedMaximumPositionFraction(
    'Winter live component contract',
    [selected.effectiveOverlayCap],
  )
  return {
    'weather-follow': {
      'cold-long': overlayFraction,
      'warm-short': overlayFraction,
    },
    'winter-alpha-blend': {
      'cold-long': overlayFraction,
      'warm-short': overlayFraction,
    },
    'weather-reversion': {
      'reversion-long': overlayFraction,
      'reversion-short': overlayFraction,
    },
  }
}

function canonicalSummerFromSummary(summary) {
  const selected = projectSelected(summary?.selected, SUMMER_SELECTED_FIELDS)
  const candidate = summary?.candidates?.find((row) => row?.candidateId === selected.candidateId)
  const forecastCoverage = summary?.validation?.forecastCoverage
  const correctedTemporalInputs = forecastCoverage?.promotionEligible === true
    && Array.isArray(forecastCoverage?.sources)
    && forecastCoverage.sources.length > 0
    && forecastCoverage.sources.every((source) => source?.temporalContractComplete === true)
  const implementation = {
    ...SUMMER_IMPLEMENTATION,
    forecastLocationUniverse:
      summary?.validation?.forecastCoverage?.policy?.locationUniverse ?? null,
    forecastTemporalContract: correctedTemporalInputs
      ? forecastCoverage?.policy?.temporalContract ?? null
      : null,
    storageDeficitHeatMultiplier: candidate?.storageDeficitHeatMultiplier ?? null,
    storageDeficitHeatMaxFraction: candidate?.storageDeficitHeatMaxFraction ?? null,
    storageSeasonalLookbackYears: candidate?.storageSeasonalLookbackYears ?? null,
    storageAvailabilityContract: candidate?.storageAvailabilityContract ?? null,
  }
  return {
    strategyId: summary?.strategyId ?? null,
    activeTargetDatePolicy: projectedActiveTargetDatePolicy(SUMMER_ACTIVE_TARGET_DATE_POLICY),
    selected,
    implementation,
    targetLattice: summerLiveTargetLattice(selected, implementation),
    positionCaps: summerPositionCaps(selected, implementation),
  }
}

function projectedWinterSelected(selected) {
  return {
    ...projectSelected(selected, WINTER_SELECTED_FIELDS),
    holdPeriodPolicy: projectPolicy(selected?.holdPeriodPolicy, [
      'id',
      'kind',
      'followHoldDays',
      'reversionHoldDays',
    ]),
    weatherResolutionPolicy: projectPolicy(selected?.weatherResolutionPolicy, ['id', 'kind']),
    coldFollowStoragePolicy: projectPolicy(selected?.coldFollowStoragePolicy, [
      'id',
      'kind',
      'minSeasonDrawdownBcf',
    ]),
    followFreshnessPolicy: projectPolicy(selected?.followFreshnessPolicy, ['id', 'kind', 'lookbackDays']),
    heatingDemandPolicy: projectPolicy(selected?.heatingDemandPolicy, ['id', 'kind', 'minDemandAnomalyF']),
  }
}

function canonicalWinterFromSummary(summary) {
  const selected = projectedWinterSelected(summary?.selected)
  const projectInput = (input) => ({
    strategyId: input?.strategyId ?? null,
    candidateId: input?.candidateId ?? null,
  })
  const implementation = WINTER_IMPLEMENTATION
  return {
    strategyId: summary?.strategyId ?? null,
    activeTargetDatePolicy: projectedActiveTargetDatePolicy(WINTER_ACTIVE_TARGET_DATE_POLICY),
    inputs: {
      weatherReversion: projectInput(summary?.inputs?.weatherReversion),
      weatherFollow: projectInput(summary?.inputs?.weatherFollow),
      volatilityConfirmation: projectInput(summary?.inputs?.volatilityConfirmation),
    },
    selected,
    implementation,
    targetLattice: winterLiveTargetLattice(selected, implementation),
    positionCaps: winterPositionCaps(selected),
  }
}

export function canonicalComponentLiveContractFromSummaries(summerSummary, winterSummary) {
  return {
    schemaVersion: LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION,
    summer: canonicalSummerFromSummary(summerSummary),
    winter: canonicalWinterFromSummary(winterSummary),
  }
}

export const executableLiveComponentContract = {
  schemaVersion: LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION,
  summer: {
    strategyId: 'ngas-summer-alpha',
    activeTargetDatePolicy: projectedActiveTargetDatePolicy(SUMMER_ACTIVE_TARGET_DATE_POLICY),
    selected: projectSelected(SUMMER, SUMMER_SELECTED_FIELDS),
    implementation: SUMMER_IMPLEMENTATION,
    targetLattice: summerLiveTargetLattice(
      projectSelected(SUMMER, SUMMER_SELECTED_FIELDS),
      SUMMER_IMPLEMENTATION,
    ),
    positionCaps: summerPositionCaps(
      projectSelected(SUMMER, SUMMER_SELECTED_FIELDS),
      SUMMER_IMPLEMENTATION,
    ),
  },
  winter: {
    strategyId: 'ngas-winter-alpha',
    activeTargetDatePolicy: projectedActiveTargetDatePolicy(WINTER_ACTIVE_TARGET_DATE_POLICY),
    inputs: {
      weatherReversion: {
        strategyId: 'winter-alpha-weather-reversion',
        candidateId: WINTER_FADE.candidateId,
      },
      weatherFollow: {
        strategyId: 'winter-alpha-weather-follow',
        candidateId: WINTER_FOLLOW.candidateId,
      },
      volatilityConfirmation: {
        strategyId: 'winter-alpha-volatility-confirmation',
        candidateId: WINTER_IMPLEMENTATION.volatilityConfirmation.candidateId,
      },
    },
    selected: projectedWinterSelected(WINTER_SELECTED),
    implementation: WINTER_IMPLEMENTATION,
    targetLattice: winterLiveTargetLattice(
      projectedWinterSelected(WINTER_SELECTED),
      WINTER_IMPLEMENTATION,
    ),
    positionCaps: winterPositionCaps(projectSelected(WINTER_SELECTED, WINTER_SELECTED_FIELDS)),
  },
}

function validTargetDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function executableLiveComponentActiveForDate({ season, targetDate }) {
  const component = executableLiveComponentContract[season]
  if (!component || !validTargetDate(targetDate)) return false
  const policy = component.activeTargetDatePolicy
  const month = Number(targetDate.slice(5, 7))
  const day = Number(targetDate.slice(8, 10))
  if (policy.sessionMonths.includes(month)) {
    return day >= Number(policy.minimumCalendarDayByMonth?.[month] ?? 1)
  }
  if (!policy.leadMonthActivation) return false
  const leadDate = new Date(
    Date.parse(`${targetDate}T00:00:00Z`)
      + policy.leadMonthActivation.activationOffsetDays * 86400000,
  ).toISOString().slice(0, 10)
  return policy.leadMonthActivation.targetMonths.includes(Number(leadDate.slice(5, 7)))
}

export function executableLiveGasPositionTargetsForTarget({
  season,
  componentStrategyId,
  windowId,
  thesisKind,
}) {
  if (componentStrategyId === 'index-fallback') {
    return windowId === 'index-fallback' && thesisKind === 'index-fallback' ? [0] : []
  }
  const component = executableLiveComponentContract[season]
  if (!component || component.strategyId !== componentStrategyId) return []
  return gasPositionTargetsFromLiveLattice(component.targetLattice, windowId, thesisKind)
}

export const executableLiveGasPositionCaps = Object.freeze({
  summer: Object.freeze(Object.fromEntries(
    Object.entries(executableLiveComponentContract.summer.positionCaps)
      .map(([windowId, caps]) => [windowId, Object.freeze({ ...caps })]),
  )),
  winter: Object.freeze(Object.fromEntries(
    Object.entries(executableLiveComponentContract.winter.positionCaps)
      .map(([windowId, caps]) => [windowId, Object.freeze({ ...caps })]),
  )),
})

export function executableLiveGasPositionCapForTarget({
  season,
  componentStrategyId,
  windowId,
  thesisKind,
}) {
  if (componentStrategyId === 'index-fallback') return 0
  const seasonContract = executableLiveComponentContract[season]
  if (!seasonContract || componentStrategyId !== seasonContract.strategyId) return null
  return executableLiveGasPositionCaps[season]?.[windowId]?.[thesisKind] ?? null
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

export function liveComponentContractDigestSha256(contract) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(contract))).digest('hex')
}

export const executableLiveComponentContractDigestSha256 = liveComponentContractDigestSha256(
  executableLiveComponentContract,
)
