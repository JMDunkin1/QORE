#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/ngas-winter-alpha')
const WEATHER_HYBRID_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/weather-hybrid-rotation')
const DUAL_WEATHER_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/dual-weather-rotation')
const VOLATILITY_REVERSION_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/volatility-mean-reversion')
const INDEX_MARKET_FILE = path.join(DATA_ROOT, 'market/yahoo/US-INDEX-BASKET-qore-market.csv')
const ACTUAL_DAILY_FILE = path.join(DATA_ROOT, 'weather/events/arctic-blast-actual-daily-2021-01-01-2026-03-31.csv')
const STORAGE_FILE = path.join(DATA_ROOT, 'fundamentals/eia/working-gas-storage-lower48-weekly.csv')

const STRATEGY_ID = 'ngas-winter-alpha'
const INITIAL_CAPITAL = 100000
const TRAIN_END = '2024-03-31'
const VALIDATION_END = '2025-10-31'
const HOLDOUT_START = '2025-11-01'
const ROUND_TRIP_COST_PCT = 0.064
const ONE_WAY_COST_PCT = ROUND_TRIP_COST_PCT / 2
const TRADING_DAYS = 252
const BOOTSTRAP_ITERATIONS = 1200
const BLOCK_LENGTH = 10
const INDEX_TREND_LOOKBACK_SESSIONS = 200
const WEATHER_RESOLUTION_SOURCE_IDS = new Set(['gfs', 'gefs-mean'])
const MAX_EFFECTIVE_OVERLAY_CAP = 0.6
const STORAGE_SEASON_START_MONTH = 9
const STORAGE_SEASONAL_WINDOW_DAYS = 10
const EIA_STORAGE_STANDARD_RELEASE_WEEKDAY_UTC = 4
const EIA_STORAGE_STANDARD_RELEASE_LAG_DAYS = 6
const EIA_STORAGE_STANDARD_RELEASE_TIME_ET = '10:30 a.m. ET'

const OVERLAY_RISK_MULTIPLIER_VARIANTS = [
  {
    id: 'risk-110',
    label: '1.10x gas-overlay risk budget',
    value: 1.1,
  },
  {
    id: 'risk-115',
    label: '1.15x gas-overlay risk budget',
    value: 1.15,
  },
  {
    id: 'risk-120',
    label: '1.20x gas-overlay risk budget',
    value: 1.2,
  },
  {
    id: 'risk-125',
    label: '1.25x gas-overlay risk budget',
    value: 1.25,
  },
]

const DEFAULT_HOLD_PERIOD_POLICY = {
  id: 'parent-selected',
  label: 'Parent selected hold periods',
  kind: 'parent-selected',
  followHoldDays: null,
  reversionHoldDays: null,
  description:
    'Keep the parent strategy daily ledgers unchanged; Dual Weather and Weather Hybrid already selected their own follow and reversion hold periods.',
}

const HOLD_PERIOD_POLICIES = [
  {
    id: 'fh1-rh1',
    label: 'One-day follow and one-day reversion hold',
    kind: 'daily-ledger-cap',
    followHoldDays: 1,
    reversionHoldDays: 1,
    description:
      'Keep only the first parent daily ledger row for each forecast-follow setup and each post-window reversion setup.',
  },
  {
    id: 'fh1-rh2',
    label: 'One-day follow and two-day reversion hold',
    kind: 'daily-ledger-cap',
    followHoldDays: 1,
    reversionHoldDays: 2,
    description:
      'Keep only the first parent daily ledger row for each forecast-follow setup, while allowing up to two post-window reversion rows.',
  },
  {
    id: 'fh2-rh1',
    label: 'Two-day follow and one-day reversion hold',
    kind: 'daily-ledger-cap',
    followHoldDays: 2,
    reversionHoldDays: 1,
    description:
      'Allow one follow-through day after the first forecast-follow row, but keep only the first post-window reversion row.',
  },
  {
    id: 'fh2-rh2',
    label: 'Two-day follow and two-day reversion hold',
    kind: 'daily-ledger-cap',
    followHoldDays: 2,
    reversionHoldDays: 2,
    description:
      'Allow one follow-through day after the first forecast-follow row and keep up to two post-window reversion rows.',
  },
  {
    id: 'fh3-rh1',
    label: 'Parent follow and one-day reversion hold',
    kind: 'daily-ledger-cap',
    followHoldDays: 3,
    reversionHoldDays: 1,
    description:
      'Keep the parent forecast-follow hold length, but shorten each post-window reversion setup to its first daily ledger row.',
  },
]

const DEFAULT_WEATHER_RESOLUTION_POLICY = {
  id: 'none',
  label: 'No close-in weather confirmation',
  kind: 'none',
  description: 'Keep parent reversion legs unchanged.',
}

const DEFAULT_COLD_FOLLOW_STORAGE_POLICY = {
  id: 'none',
  label: 'No cold-follow storage gate',
  kind: 'none',
  description: 'Do not alter cold-follow exposure based on EIA storage.',
}

const COLD_FOLLOW_STORAGE_POLICIES = [
  {
    id: 'storage-drawdown-400bcf',
    label: 'Cold-follow requires 400 Bcf storage drawdown',
    kind: 'season-drawdown',
    minSeasonDrawdownBcf: 400,
    description:
      `Allow cold-follow gas longs only after the standard EIA storage release date has confirmed at least a 400 Bcf drawdown from the current withdrawal-season peak.`,
  },
  {
    id: 'storage-drawdown-600bcf',
    label: 'Cold-follow requires 600 Bcf storage drawdown',
    kind: 'season-drawdown',
    minSeasonDrawdownBcf: 600,
    description:
      `Allow cold-follow gas longs only after the standard EIA storage release date has confirmed at least a 600 Bcf drawdown from the current withdrawal-season peak.`,
  },
]

const WEATHER_RESOLUTION_POLICIES = [
  {
    id: 'close-confirm-1_5f',
    label: 'Close-in weather confirms reversion by 1.5F',
    kind: 'confirm-shift',
    minShiftF: 1.5,
    description:
      'Require the latest close-in forecast or already-known actual anomaly to shift at least 1.5F in the same gas-demand direction as the reversion leg.',
  },
  {
    id: 'close-confirm-3f',
    label: 'Close-in weather confirms reversion by 3F',
    kind: 'confirm-shift',
    minShiftF: 3,
    description:
      'Require the latest close-in forecast or already-known actual anomaly to shift at least 3F in the same gas-demand direction as the reversion leg.',
  },
  {
    id: 'spared-confirm-1_5f',
    label: 'Event-spared confirmation by 1.5F',
    kind: 'confirm-relief',
    minReliefF: 1.5,
    description:
      'Require the close-in or already-known actual anomaly to move at least 1.5F toward normal while supporting the same direction as the reversion leg.',
  },
  {
    id: 'block-adverse-2f',
    label: 'Block adverse close-in weather shifts',
    kind: 'block-adverse',
    minAdverseShiftF: 2,
    description:
      'Keep the parent reversion unless the close-in or already-known actual anomaly shifts at least 2F against the reversion direction.',
  },
  {
    id: 'graded-shift-sizing',
    label: 'Grade reversion size by close-in weather shift',
    kind: 'graded-shift',
    description:
      'Scale reversion exposure up when the close-in or already-known actual anomaly confirms the reversion, and shrink it when the weather shift argues against the trade.',
  },
  {
    id: 'graded-shift-standalone-adverse-veto',
    label: 'Grade reversion size and veto adverse standalone fades',
    kind: 'graded-shift-standalone-adverse-veto',
    description:
      'Scale confirmed reversion exposure up, shrink confirmed fades when close-in weather argues against them, and drop unconfirmed standalone fades when close-in weather still supports the original move.',
  },
]

const BLEND_POLICIES = [
  {
    id: 'net-additive-parent-overlay',
    label: 'Net additive parent overlay',
    positionPolicy:
      'Use Dual Weather forecast-follow position plus Weather Hybrid reversion position; opposite signals reduce exposure and same-side signals add, capped at the sum of parent risk budgets.',
    conflictPolicy: 'net-position',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'dual-follow-first',
    label: 'Dual follow first',
    positionPolicy: 'Use Dual Weather follow legs first; use Weather Hybrid reversion only when no follow leg is active.',
    conflictPolicy: 'follow-first',
    overlayCap: 0.25,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'weather-fade-first',
    label: 'Weather Hybrid fade first',
    positionPolicy: 'Use Weather Hybrid reversion first; use Dual Weather follow only when no reversion leg is active.',
    conflictPolicy: 'fade-first',
    overlayCap: 0.25,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'short-fade-priority',
    label: 'Reversion-short priority',
    positionPolicy:
      'Use Weather Hybrid reversion-short first, then Dual Weather follow, then other Weather Hybrid reversion rows.',
    conflictPolicy: 'short-fade-first',
    overlayCap: 0.25,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'fade-primary-confirmed-follow',
    label: 'Fade primary, confirmed follow',
    positionPolicy:
      'Use Weather Hybrid reversion as the primary gas overlay; add Dual Weather follow exposure only when the parent signals point the same way.',
    conflictPolicy: 'fade-confirmed-follow',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'fade-primary-confirmed-follow-risk-off',
    label: 'Fade primary, confirmed follow, index risk-off',
    positionPolicy:
      'Use Weather Hybrid reversion as the primary gas overlay; add Dual Weather follow exposure only when the parent signals point the same way, and move idle index capital to cash when the index is below its 200-session trend.',
    conflictPolicy: 'fade-confirmed-follow',
    overlayCap: 0.45,
    indexRiskMode: 'idle-index-200d-trend',
    selectionEligible: false,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'short-fade-confirmed-long',
    label: 'Short fade plus confirmed long fade',
    positionPolicy:
      'Take Weather Hybrid reversion-short setups directly; take reversion-long setups only when Dual Weather confirms cold demand in the same direction.',
    conflictPolicy: 'short-fade-confirmed-long',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionShort'],
  },
  {
    id: 'short-fade-plus-cold-follow',
    label: 'Short fade plus cold follow',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; keep Weather Hybrid reversion-short setups, adding Dual Weather warm-short exposure when both parent experts point short.',
    conflictPolicy: 'short-fade-plus-cold-follow',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionShort'],
  },
  {
    id: 'short-fade-plus-cold-follow-shrunk-standalone',
    label: 'Short fade plus cold follow with shrunk standalone fade',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; take same-direction warm-short plus reversion-short blends at full size, but shrink standalone Weather Hybrid reversion-short exposure because its train/validation edge is thinner and less balanced than confirmed blends.',
    conflictPolicy: 'short-fade-plus-cold-follow',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionShort'],
    standaloneReversionScale: 0.5,
  },
  {
    id: 'vol-confirmed-fade-plus-cold-follow',
    label: 'Vol-confirmed fade plus cold follow',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; take Weather Hybrid reversion setups only when Volatility Mean Reversion confirms the same overreaction-fade direction, adding same-direction Dual Weather follow exposure as confirmation.',
    conflictPolicy: 'vol-confirmed-fade-plus-cold-follow',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'short-fade-plus-cold-follow-vol-long',
    label: 'Short fade plus cold follow and vol-confirmed long fade',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; keep Weather Hybrid reversion-short setups, adding Dual Weather warm-short exposure when both parent experts point short, and add Weather Hybrid reversion-long setups only when Volatility Mean Reversion confirms the same long-fade direction.',
    conflictPolicy: 'short-fade-plus-cold-follow-vol-long',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
    reversionLongScale: 1,
  },
  {
    id: 'short-fade-plus-cold-follow-vol-long-75',
    label: 'Short fade plus cold follow and 75% vol-confirmed long fade',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; keep Weather Hybrid reversion-short setups, adding Dual Weather warm-short exposure when both parent experts point short, and add 75%-sized Weather Hybrid reversion-long setups only when Volatility Mean Reversion confirms the same long-fade direction.',
    conflictPolicy: 'short-fade-plus-cold-follow-vol-long',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
    reversionLongScale: 0.75,
  },
  {
    id: 'short-fade-plus-cold-follow-vol-long-50',
    label: 'Short fade plus cold follow and 50% vol-confirmed long fade',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; keep Weather Hybrid reversion-short setups, adding Dual Weather warm-short exposure when both parent experts point short, and add half-sized Weather Hybrid reversion-long setups only when Volatility Mean Reversion confirms the same long-fade direction.',
    conflictPolicy: 'short-fade-plus-cold-follow-vol-long',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
    reversionLongScale: 0.5,
  },
  {
    id: 'short-fade-plus-cold-follow-vol-long-25',
    label: 'Short fade plus cold follow and 25% vol-confirmed long fade',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; keep Weather Hybrid reversion-short setups, adding Dual Weather warm-short exposure when both parent experts point short, and add quarter-sized Weather Hybrid reversion-long setups only when Volatility Mean Reversion confirms the same long-fade direction.',
    conflictPolicy: 'short-fade-plus-cold-follow-vol-long',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
    reversionLongScale: 0.25,
  },
  {
    id: 'short-fade-plus-cold-follow-vol-long-50-shrunk-standalone',
    label: 'Short fade plus cold follow, 50% vol-confirmed long fade, shrunk standalone short fade',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; keep same-direction warm-short plus reversion-short blends at full size, add half-sized volatility-confirmed reversion-long exposure, and shrink standalone reversion-short exposure.',
    conflictPolicy: 'short-fade-plus-cold-follow-vol-long',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
    reversionLongScale: 0.5,
    standaloneReversionScale: 0.5,
  },
  {
    id: 'confirmed-warm-short-plus-cold-follow',
    label: 'Confirmed warm short plus cold follow',
    positionPolicy:
      'Take Dual Weather cold-follow setups directly; take warm-short exposure only when Dual Weather and Weather Hybrid agree on the same short direction.',
    conflictPolicy: 'confirmed-warm-short-plus-cold-follow',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionShort'],
  },
  {
    id: 'short-fade-confirmed-long-risk-off',
    label: 'Short fade plus confirmed long fade, index risk-off',
    positionPolicy:
      'Take Weather Hybrid reversion-short setups directly; take reversion-long setups only when Dual Weather confirms cold demand in the same direction, and move idle index capital to cash when the index is below its 200-session trend.',
    conflictPolicy: 'short-fade-confirmed-long',
    overlayCap: 0.45,
    indexRiskMode: 'idle-index-200d-trend',
    selectionEligible: false,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionShort'],
  },
  {
    id: 'weather-hybrid-parent-risk-off',
    label: 'Weather Hybrid parent with index risk-off',
    positionPolicy:
      'Use the selected Weather Hybrid reversion parent unchanged, but move idle index capital to cash when the index is below its 200-session trend.',
    conflictPolicy: 'weather-hybrid-parent',
    overlayCap: 0.2,
    indexRiskMode: 'idle-index-200d-trend',
    selectionEligible: false,
    requiredSideChecks: ['reversionLong', 'reversionShort'],
  },
  {
    id: 'short-fade-only',
    label: 'Weather Hybrid short fade only',
    positionPolicy: 'Use only Weather Hybrid reversion-short setups and leave all other gas overlays inactive.',
    conflictPolicy: 'short-fade-only',
    overlayCap: 0.2,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['reversionShort'],
  },
]

function policySupportsWeatherResolution(policy) {
  return (
    policy.selectionEligible &&
    policy.indexRiskMode === 'full-index-fallback' &&
    policy.requiredSideChecks.some((sideKey) => sideKey.startsWith('reversion'))
  )
}

function isGradedShiftResolutionPolicy(policy) {
  return ['graded-shift', 'graded-shift-standalone-adverse-veto'].includes(policy.weatherResolutionPolicy?.kind)
}

function policySupportsOverlayRiskMultiplier(policy) {
  return (
    policy.selectionEligible &&
    policy.indexRiskMode === 'full-index-fallback' &&
    policy.conflictPolicy === 'short-fade-plus-cold-follow-vol-long' &&
    isGradedShiftResolutionPolicy(policy)
  )
}

function policySupportsHoldPeriodOverlay(policy) {
  return (
    policy.selectionEligible &&
    policy.indexRiskMode === 'full-index-fallback' &&
    policy.conflictPolicy === 'short-fade-plus-cold-follow-vol-long' &&
    isGradedShiftResolutionPolicy(policy)
  )
}

function policySupportsColdFollowStorage(policy) {
  return (
    policy.selectionEligible &&
    policy.indexRiskMode === 'full-index-fallback' &&
    [
      'confirmed-warm-short-plus-cold-follow',
      'short-fade-plus-cold-follow',
      'vol-confirmed-fade-plus-cold-follow',
      'short-fade-plus-cold-follow-vol-long',
    ].includes(policy.conflictPolicy)
  )
}

function expandedHoldPeriodPolicies(policies) {
  return policies.flatMap((policy) => {
    const basePolicy = {
      ...policy,
      holdPeriodPolicy: policy.holdPeriodPolicy ?? DEFAULT_HOLD_PERIOD_POLICY,
    }
    if (!policySupportsHoldPeriodOverlay(basePolicy)) return [basePolicy]

    const holdVariants = HOLD_PERIOD_POLICIES.map((holdPolicy) => ({
      ...basePolicy,
      id: `${basePolicy.id}-${holdPolicy.id}`,
      label: `${basePolicy.label} + ${holdPolicy.label}`,
      positionPolicy: `${basePolicy.positionPolicy} Hold-period overlay: ${holdPolicy.description}`,
      holdPeriodPolicy: holdPolicy,
    }))

    return [basePolicy, ...holdVariants]
  })
}

function expandedColdFollowStoragePolicies(policies) {
  return policies.flatMap((policy) => {
    const basePolicy = {
      ...policy,
      coldFollowStoragePolicy: policy.coldFollowStoragePolicy ?? DEFAULT_COLD_FOLLOW_STORAGE_POLICY,
    }
    if (!policySupportsColdFollowStorage(basePolicy)) return [basePolicy]

    const storagePolicies = COLD_FOLLOW_STORAGE_POLICIES.map((storagePolicy) => ({
      ...basePolicy,
      id: `${basePolicy.id}-${storagePolicy.id}`,
      label: `${basePolicy.label} + ${storagePolicy.label}`,
      positionPolicy: `${basePolicy.positionPolicy} Storage gate: ${storagePolicy.description}`,
      coldFollowStoragePolicy: storagePolicy,
    }))

    return [basePolicy, ...storagePolicies]
  })
}

function expandedOverlayRiskPolicies(policies) {
  return policies.flatMap((policy) => {
    const basePolicy = {
      ...policy,
      overlayRiskMultiplier: policy.overlayRiskMultiplier ?? 1,
    }
    if (!policySupportsOverlayRiskMultiplier(basePolicy)) return [basePolicy]

    const riskVariants = OVERLAY_RISK_MULTIPLIER_VARIANTS.map((variant) => ({
      ...basePolicy,
      id: `${basePolicy.id}-${variant.id}`,
      label: `${basePolicy.label} + ${variant.label}`,
      positionPolicy: `${basePolicy.positionPolicy} Portfolio risk-budget overlay: scale active gas exposure by ${variant.value}x, capped at ${MAX_EFFECTIVE_OVERLAY_CAP}x, without changing signal selection.`,
      overlayRiskMultiplier: variant.value,
    }))
    return [basePolicy, ...riskVariants]
  })
}

function expandedBlendPolicies() {
  const baselines = BLEND_POLICIES.map((policy) => ({
    ...policy,
    weatherResolutionPolicy: DEFAULT_WEATHER_RESOLUTION_POLICY,
    coldFollowStoragePolicy: DEFAULT_COLD_FOLLOW_STORAGE_POLICY,
    overlayRiskMultiplier: 1,
  }))
  const weatherResolved = BLEND_POLICIES.filter(policySupportsWeatherResolution).flatMap((policy) =>
    WEATHER_RESOLUTION_POLICIES.map((resolutionPolicy) => ({
      ...policy,
      id: `${policy.id}-${resolutionPolicy.id}`,
      label: `${policy.label} + ${resolutionPolicy.label}`,
      positionPolicy: `${policy.positionPolicy} Weather-resolution overlay: ${resolutionPolicy.description}`,
      weatherResolutionPolicy: resolutionPolicy,
      coldFollowStoragePolicy: DEFAULT_COLD_FOLLOW_STORAGE_POLICY,
      overlayRiskMultiplier: 1,
    })),
  )
  return expandedOverlayRiskPolicies(expandedHoldPeriodPolicies(expandedColdFollowStoragePolicies([...baselines, ...weatherResolved])))
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
}

function parseCsv(filePath) {
  return Papa.parse(readText(filePath), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  }).data
}

function loadWeatherResolutionData() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const forecastByIssueTarget = new Map()
  const inputFiles = [path.relative(REPO_ROOT, MANIFEST_PATH), path.relative(REPO_ROOT, ACTUAL_DAILY_FILE)]

  for (const calendar of manifest.forecastCalendars) {
    if (!WEATHER_RESOLUTION_SOURCE_IDS.has(calendar.id)) continue
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    inputFiles.push(path.relative(REPO_ROOT, scoresPath))

    for (const row of parseCsv(scoresPath)) {
      const leadDays = numberFrom(row.leadDays, Number.NaN)
      if (!Number.isFinite(leadDays) || leadDays < 1 || leadDays > 3) continue
      const key = `${row.issueDate}|${row.targetDate}`
      const sampledWeight = Math.max(0.0001, numberFrom(row.sampledWeight, 1))
      const current =
        forecastByIssueTarget.get(key) ?? {
          issueDate: row.issueDate,
          targetDate: row.targetDate,
          weightedSum: 0,
          weightSum: 0,
          coverageSum: 0,
          extremeCount: 0,
          sourceIds: new Set(),
        }
      current.weightedSum += numberFrom(row.weightedAnomalyF) * sampledWeight
      current.weightSum += sampledWeight
      current.coverageSum += numberFrom(row.coveragePct) * sampledWeight
      current.extremeCount += numberFrom(row.extremeCount)
      current.sourceIds.add(calendar.id)
      forecastByIssueTarget.set(key, current)
    }
  }

  const forecastsByTargetDate = new Map()
  for (const value of forecastByIssueTarget.values()) {
    const row = {
      issueDate: value.issueDate,
      targetDate: value.targetDate,
      weightedAnomalyF: round(value.weightedSum / value.weightSum, 3),
      coveragePct: round(value.coverageSum / value.weightSum, 4),
      extremeCount: round(value.extremeCount, 4),
      sourceIds: [...value.sourceIds].sort(),
    }
    forecastsByTargetDate.set(row.targetDate, [...(forecastsByTargetDate.get(row.targetDate) ?? []), row])
  }

  for (const rows of forecastsByTargetDate.values()) {
    rows.sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  }

  const actualByDate = new Map(
    parseCsv(ACTUAL_DAILY_FILE)
      .map((row) => [
        row.date,
        {
          date: row.date,
          weightedAnomalyF: numberFrom(row.weightedAnomalyF, Number.NaN),
          coveragePct: numberFrom(row.coveragePct, Number.NaN),
          extremeCount: numberFrom(row.extremeCount, Number.NaN),
        },
      ])
      .filter(([, row]) => Number.isFinite(row.weightedAnomalyF)),
  )

  return { forecastsByTargetDate, actualByDate, inputFiles }
}

function dayOfYear(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.floor((date - yearStart) / 86400000) + 1
}

function addCalendarDays(isoDate, days) {
  return new Date(Date.parse(isoDate) + days * 86400000).toISOString().slice(0, 10)
}

function daysUntilNextWeekday(isoDate, weekdayUtc) {
  const currentWeekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  const daysUntil = (weekdayUtc - currentWeekday + 7) % 7
  return daysUntil === 0 ? 7 : daysUntil
}

function standardEiaStorageReleaseDate(storageDate) {
  return addCalendarDays(storageDate, daysUntilNextWeekday(storageDate, EIA_STORAGE_STANDARD_RELEASE_WEEKDAY_UTC))
}

function storageSeasonStartFor(isoDate) {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  const seasonYear = month >= STORAGE_SEASON_START_MONTH ? year : year - 1
  return `${seasonYear}-${String(STORAGE_SEASON_START_MONTH).padStart(2, '0')}-01`
}

function loadStorageData() {
  const rows = parseCsv(STORAGE_FILE)
    .map((row, index) => ({
      index,
      date: row.date,
      storageBcf: numberFrom(row.storageBcf, Number.NaN),
    }))
    .filter((row) => row.date && Number.isFinite(row.storageBcf) && row.storageBcf > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row, index) => ({
      ...row,
      index,
      releaseDate: standardEiaStorageReleaseDate(row.date),
      dayOfYear: dayOfYear(row.date),
      year: Number(row.date.slice(0, 4)),
    }))

  const cache = new Map()

  function latestStorageRow(date) {
    let latest = null
    for (const row of rows) {
      if (row.releaseDate <= date) latest = row
      if (row.releaseDate > date) break
    }
    return latest
  }

  function contextForDate(date) {
    if (cache.has(date)) return cache.get(date)

    const latest = latestStorageRow(date)
    if (!latest) {
      const missing = { available: false }
      cache.set(date, missing)
      return missing
    }

    const seasonStart = storageSeasonStartFor(latest.date)
    const seasonRows = rows.filter((row) => row.date >= seasonStart && row.date <= latest.date)
    const seasonPeakBcf = Math.max(...seasonRows.map((row) => row.storageBcf))
    const historicalRows = rows.filter(
      (row) =>
        row.year < latest.year &&
        Math.abs(row.dayOfYear - latest.dayOfYear) <= STORAGE_SEASONAL_WINDOW_DAYS,
    )
    const historicalStorageValues = historicalRows.map((row) => row.storageBcf)
    const seasonalAverageBcf = mean(historicalStorageValues)
    const sortedStorageValues = [...historicalStorageValues].sort((a, b) => a - b)
    const storageSeasonalPercentile = sortedStorageValues.length
      ? (sortedStorageValues.filter((value) => value <= latest.storageBcf).length / sortedStorageValues.length) * 100
      : Number.NaN
    const prior = rows[latest.index - 1]
    const weeklyChangeBcf = prior ? latest.storageBcf - prior.storageBcf : Number.NaN
    const historicalWeeklyChanges = historicalRows
      .map((row) => {
        const priorHistorical = rows[row.index - 1]
        return priorHistorical ? row.storageBcf - priorHistorical.storageBcf : Number.NaN
      })
      .filter(Number.isFinite)
    const seasonalAverageWeeklyChangeBcf = mean(historicalWeeklyChanges)

    const context = {
      available: true,
      storageDate: latest.date,
      storageReleaseDate: latest.releaseDate,
      storageBcf: round(latest.storageBcf, 2),
      storageSeasonPeakBcf: round(seasonPeakBcf, 2),
      storageSeasonDrawdownBcf: round(seasonPeakBcf - latest.storageBcf, 2),
      storageSeasonalAverageBcf: Number.isFinite(seasonalAverageBcf) ? round(seasonalAverageBcf, 2) : '',
      storageVsSeasonalAverageBcf: Number.isFinite(seasonalAverageBcf) ? round(latest.storageBcf - seasonalAverageBcf, 2) : '',
      storageSeasonalPercentile: Number.isFinite(storageSeasonalPercentile) ? round(storageSeasonalPercentile, 2) : '',
      storageWeeklyChangeBcf: Number.isFinite(weeklyChangeBcf) ? round(weeklyChangeBcf, 2) : '',
      storageWeeklyChangeVsSeasonalAverageBcf:
        Number.isFinite(weeklyChangeBcf) && Number.isFinite(seasonalAverageWeeklyChangeBcf)
          ? round(weeklyChangeBcf - seasonalAverageWeeklyChangeBcf, 2)
          : '',
    }
    cache.set(date, context)
    return context
  }

  return {
    inputFiles: [path.relative(REPO_ROOT, STORAGE_FILE)],
    contextForDate,
  }
}

function numberFrom(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1))
}

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.floor((sorted.length - 1) * pct), 0, sorted.length - 1)
  return sorted[index]
}

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function daySplit(isoDate) {
  if (isoDate <= TRAIN_END) return 'train'
  if (isoDate <= VALIDATION_END) return 'validation'
  return 'holdout'
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}${rows.length ? '\n' : ''}`
}

function isFollowRow(row) {
  return row?.windowId === 'weather-follow'
}

function isReversionRow(row) {
  return row?.windowId === 'weather-reversion'
}

function activeParentHoldLimit(row, holdPeriodPolicy) {
  if (!holdPeriodPolicy || holdPeriodPolicy.kind === 'parent-selected') return null
  if (isFollowRow(row)) return holdPeriodPolicy.followHoldDays
  if (isReversionRow(row)) return holdPeriodPolicy.reversionHoldDays
  return null
}

function parentHoldKey(row) {
  return [row.issueDate, row.targetDate, row.windowId, row.thesisKind, row.direction].join('|')
}

function parentHoldFallbackRow(row, holdPeriodPolicy, holdDay, holdLimit) {
  return {
    ...row,
    direction: 'long',
    sourceId: 'US-INDEX-BASKET',
    windowId: 'index-fallback',
    thesisKind: 'index-fallback',
    confidence: 0,
    indexFraction: 1,
    ungPosition: 0,
    grossReturnPct: numberFrom(row.indexReturnPct),
    tradingCostPct: 0,
    netReturnPct: numberFrom(row.indexReturnPct),
    rank: 0,
    parentHoldPeriodPolicy: holdPeriodPolicy.id,
    parentHoldDay: holdDay,
    parentHoldLimit: holdLimit,
    parentHoldAction: 'trimmed-by-winter-alpha-hold-policy',
  }
}

function applyParentHoldPeriodPolicy(rows, holdPeriodPolicy) {
  if (!holdPeriodPolicy || holdPeriodPolicy.kind === 'parent-selected') {
    return rows.map((row) => ({
      ...row,
      parentHoldPeriodPolicy: DEFAULT_HOLD_PERIOD_POLICY.id,
      parentHoldDay: '',
      parentHoldLimit: '',
      parentHoldAction: isFollowRow(row) || isReversionRow(row) ? 'parent-kept' : 'not-parent-weather',
    }))
  }

  const counts = new Map()
  return rows.map((row) => {
    const holdLimit = activeParentHoldLimit(row, holdPeriodPolicy)
    if (!holdLimit || numberFrom(row.ungPosition) === 0) {
      return {
        ...row,
        parentHoldPeriodPolicy: holdPeriodPolicy.id,
        parentHoldDay: '',
        parentHoldLimit: holdLimit ?? '',
        parentHoldAction: 'not-parent-weather',
      }
    }

    const key = parentHoldKey(row)
    const holdDay = (counts.get(key) ?? 0) + 1
    counts.set(key, holdDay)
    if (holdDay > holdLimit) return parentHoldFallbackRow(row, holdPeriodPolicy, holdDay, holdLimit)

    return {
      ...row,
      parentHoldPeriodPolicy: holdPeriodPolicy.id,
      parentHoldDay: holdDay,
      parentHoldLimit: holdLimit,
      parentHoldAction: 'kept-by-winter-alpha-hold-policy',
    }
  })
}

function volatilityDirection(row) {
  if (row?.direction === 'long') return 1
  if (row?.direction === 'short') return -1
  return 0
}

function baseFallbackRow(dualRow, weatherRow) {
  return dualRow ?? weatherRow
}

function sameDirection(firstPosition, secondPosition) {
  return firstPosition !== 0 && secondPosition !== 0 && Math.sign(firstPosition) === Math.sign(secondPosition)
}

function latestCloseForecastFor(row, weatherResolutionData) {
  const forecasts = weatherResolutionData.forecastsByTargetDate.get(row.targetDate) ?? []
  let latest = null
  for (const forecast of forecasts) {
    if (forecast.issueDate <= row.entryTradeDate) latest = forecast
    if (forecast.issueDate > row.entryTradeDate) break
  }
  return latest
}

function weatherResolutionForRow(row, position, weatherResolutionData) {
  const originalAnomalyF = numberFrom(row?.weightedAnomalyF, Number.NaN)
  const positionDirection = Math.sign(position)
  if (!row || positionDirection === 0 || !Number.isFinite(originalAnomalyF)) {
    return {
      available: false,
      action: 'no-reversion',
      scale: 1,
    }
  }

  const actual = row.targetDate < row.entryTradeDate ? weatherResolutionData.actualByDate.get(row.targetDate) : null
  const closeForecast = actual ? null : latestCloseForecastFor(row, weatherResolutionData)
  const resolutionAnomalyF = actual?.weightedAnomalyF ?? closeForecast?.weightedAnomalyF ?? Number.NaN
  if (!Number.isFinite(resolutionAnomalyF)) {
    return {
      available: false,
      action: 'missing-kept',
      scale: 1,
      originalAnomalyF: round(originalAnomalyF, 3),
    }
  }

  const shiftF = resolutionAnomalyF - originalAnomalyF
  const weatherGasDirection = shiftF < 0 ? 1 : shiftF > 0 ? -1 : 0
  const sameDirectionShift = weatherGasDirection !== 0 && weatherGasDirection === positionDirection
  const adverseDirectionShift = weatherGasDirection !== 0 && weatherGasDirection === -positionDirection
  const reliefF = Math.abs(originalAnomalyF) - Math.abs(resolutionAnomalyF)

  return {
    available: true,
    source: actual ? 'actual' : 'close-forecast',
    issueDate: actual ? row.targetDate : closeForecast.issueDate,
    sourceIds: actual ? ['NASA POWER actual anomaly basket'] : closeForecast.sourceIds,
    originalAnomalyF: round(originalAnomalyF, 3),
    resolutionAnomalyF: round(resolutionAnomalyF, 3),
    shiftF: round(shiftF, 3),
    absShiftF: round(Math.abs(shiftF), 3),
    reliefF: round(reliefF, 3),
    weatherGasDirection,
    sameDirectionShift,
    adverseDirectionShift,
    action: 'kept',
    scale: 1,
  }
}

function weatherResolutionDecision(policy, reversionRow, reversionPosition, weatherResolutionData, blendLeg) {
  const resolutionPolicy = policy.weatherResolutionPolicy ?? DEFAULT_WEATHER_RESOLUTION_POLICY
  const resolution = weatherResolutionForRow(reversionRow, reversionPosition, weatherResolutionData)

  if (resolutionPolicy.kind === 'none' || !resolution.available) {
    return {
      ...resolution,
      policyId: resolutionPolicy.id,
      action: resolution.action === 'missing-kept' ? resolution.action : 'none',
      scale: 1,
    }
  }

  if (resolutionPolicy.kind === 'confirm-shift') {
    const confirmed = resolution.sameDirectionShift && resolution.absShiftF >= resolutionPolicy.minShiftF
    return {
      ...resolution,
      policyId: resolutionPolicy.id,
      action: confirmed ? 'confirmed-kept' : 'unconfirmed-dropped',
      scale: confirmed ? 1 : 0,
    }
  }

  if (resolutionPolicy.kind === 'confirm-relief') {
    const confirmed = resolution.sameDirectionShift && resolution.reliefF >= resolutionPolicy.minReliefF
    return {
      ...resolution,
      policyId: resolutionPolicy.id,
      action: confirmed ? 'spared-kept' : 'not-spared-dropped',
      scale: confirmed ? 1 : 0,
    }
  }

  if (resolutionPolicy.kind === 'block-adverse') {
    const blocked = resolution.adverseDirectionShift && resolution.absShiftF >= resolutionPolicy.minAdverseShiftF
    return {
      ...resolution,
      policyId: resolutionPolicy.id,
      action: blocked ? 'adverse-dropped' : 'not-adverse-kept',
      scale: blocked ? 0 : 1,
    }
  }

  if (isGradedShiftResolutionPolicy(policy)) {
    const standaloneAdverseVeto =
      resolutionPolicy.kind === 'graded-shift-standalone-adverse-veto' &&
      blendLeg === 'weather-hybrid-reversion' &&
      resolution.adverseDirectionShift
    if (standaloneAdverseVeto) {
      return {
        ...resolution,
        policyId: resolutionPolicy.id,
        action: 'standalone-adverse-dropped',
        scale: 0,
      }
    }

    const scale = resolution.sameDirectionShift
      ? clamp(0.75 + resolution.absShiftF / 8, 0.75, 1.25)
      : resolution.adverseDirectionShift
        ? clamp(0.9 - resolution.absShiftF / 10, 0.45, 0.9)
        : 0.85
    return {
      ...resolution,
      policyId: resolutionPolicy.id,
      action: resolution.sameDirectionShift ? 'confirm-scaled' : resolution.adverseDirectionShift ? 'adverse-shrunk' : 'neutral-shrunk',
      scale: round(scale, 4),
    }
  }

  return {
    ...resolution,
    policyId: resolutionPolicy.id,
    action: 'kept',
    scale: 1,
  }
}

function followSurvivesDroppedReversion(policy, followRow) {
  if (!followRow) return false
  if (['net-position', 'follow-first'].includes(policy.conflictPolicy)) return true
  if (followRow.thesisKind !== 'cold-long') return false
  return ['short-fade-plus-cold-follow', 'vol-confirmed-fade-plus-cold-follow', 'short-fade-plus-cold-follow-vol-long'].includes(
    policy.conflictPolicy,
  )
}

function coldFollowStorageDecision(policy, blend, storageContext) {
  const storagePolicy = policy.coldFollowStoragePolicy ?? DEFAULT_COLD_FOLLOW_STORAGE_POLICY
  if (storagePolicy.kind === 'none') {
    return {
      policyId: storagePolicy.id,
      action: blend.followRow?.thesisKind === 'cold-long' ? 'not-gated' : 'not-cold-follow',
      allowed: true,
    }
  }

  if (blend.followRow?.thesisKind !== 'cold-long' || blend.followPosition === 0) {
    return {
      policyId: storagePolicy.id,
      action: 'not-cold-follow',
      allowed: true,
    }
  }

  if (!storageContext?.available) {
    return {
      policyId: storagePolicy.id,
      action: 'missing-storage-blocked',
      allowed: false,
    }
  }

  if (storagePolicy.kind === 'season-drawdown') {
    const seasonDrawdownBcf = numberFrom(storageContext.storageSeasonDrawdownBcf, Number.NaN)
    const allowed = seasonDrawdownBcf >= storagePolicy.minSeasonDrawdownBcf
    return {
      policyId: storagePolicy.id,
      action: allowed ? 'storage-drawdown-confirmed' : 'blocked-insufficient-storage-drawdown',
      allowed,
      minSeasonDrawdownBcf: storagePolicy.minSeasonDrawdownBcf,
      storageSeasonDrawdownBcf: Number.isFinite(seasonDrawdownBcf) ? round(seasonDrawdownBcf, 2) : '',
    }
  }

  return {
    policyId: storagePolicy.id,
    action: 'kept',
    allowed: true,
  }
}

function applyColdFollowStorageGate(policy, blend, storageContext) {
  const decision = coldFollowStorageDecision(policy, blend, storageContext)
  if (decision.allowed) {
    return {
      ...blend,
      coldFollowStorage: decision,
    }
  }

  return {
    ...blend,
    followRow: null,
    reversionRow: null,
    followPosition: 0,
    reversionPosition: 0,
    position: 0,
    blendLeg: 'index-fallback',
    coldFollowStorage: decision,
  }
}

function blendLegAfterWeatherResolution(blend, position) {
  if (position === 0) return 'index-fallback'
  if (blend.followRow && blend.reversionRow) return blend.blendLeg
  if (blend.followRow) return blend.followRow.thesisKind === 'cold-long' ? 'dual-cold-follow' : 'dual-follow'
  if (blend.reversionRow) return blend.blendLeg
  return 'index-fallback'
}

function applyWeatherResolution(policy, blend, weatherResolutionData) {
  if (!blend.reversionRow || blend.reversionPosition === 0) {
    return {
      ...blend,
      weatherResolution: {
        policyId: policy.weatherResolutionPolicy?.id ?? DEFAULT_WEATHER_RESOLUTION_POLICY.id,
        action: 'no-reversion',
        scale: 1,
      },
    }
  }

  const decision = weatherResolutionDecision(policy, blend.reversionRow, blend.reversionPosition, weatherResolutionData, blend.blendLeg)
  const reversionPosition = blend.reversionPosition * decision.scale
  let followRow = blend.followRow
  let followPosition = blend.followPosition
  let reversionRow = decision.scale === 0 ? null : blend.reversionRow

  if (decision.scale === 0 && !followSurvivesDroppedReversion(policy, followRow)) {
    followRow = null
    followPosition = 0
  }

  const nextBlend = {
    ...blend,
    followRow,
    reversionRow,
    followPosition,
    reversionPosition,
    position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
    weatherResolution: decision,
  }
  return {
    ...nextBlend,
    blendLeg: blendLegAfterWeatherResolution(nextBlend, nextBlend.position),
  }
}

function applyOverlayRiskMultiplier(policy, blend) {
  const multiplier = policy.overlayRiskMultiplier ?? 1
  const effectiveOverlayCap = Math.min(MAX_EFFECTIVE_OVERLAY_CAP, policy.overlayCap * multiplier)
  if (multiplier === 1 || blend.position === 0) {
    return {
      ...blend,
      overlayRiskMultiplier: multiplier,
      effectiveOverlayCap,
    }
  }

  const scaledPosition = clamp(blend.position * multiplier, -effectiveOverlayCap, effectiveOverlayCap)
  const realizedMultiplier = blend.position ? scaledPosition / blend.position : 1

  return {
    ...blend,
    followPosition: blend.followPosition * realizedMultiplier,
    reversionPosition: blend.reversionPosition * realizedMultiplier,
    position: scaledPosition,
    overlayRiskMultiplier: multiplier,
    effectiveOverlayCap,
  }
}

function chooseDominantRow(followRow, reversionRow, position, policy) {
  if (policy.conflictPolicy === 'vol-confirmed-fade-plus-cold-follow' && reversionRow) return reversionRow
  if (policy.conflictPolicy === 'net-position' && followRow && reversionRow) {
    return Math.abs(numberFrom(followRow.ungPosition)) >= Math.abs(numberFrom(reversionRow.ungPosition))
      ? followRow
      : reversionRow
  }
  if (position !== 0 && followRow) return followRow
  if (position !== 0 && reversionRow) return reversionRow
  return followRow ?? reversionRow
}

function blendPositionFor(policy, dualRow, weatherRow, volatilityRow) {
  const followRow = isFollowRow(dualRow) ? dualRow : null
  const reversionRow = isReversionRow(weatherRow) ? weatherRow : null
  const followPosition = numberFrom(followRow?.ungPosition)
  const reversionPosition = numberFrom(reversionRow?.ungPosition)
  const volatilityPosition = volatilityDirection(volatilityRow)
  const volatilityConfirmsReversion = reversionRow && volatilityPosition !== 0 && Math.sign(reversionPosition) === volatilityPosition

  if (policy.conflictPolicy === 'net-position') {
    return {
      followRow,
      reversionRow,
      followPosition,
      reversionPosition,
      position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
      blendLeg:
        followRow && reversionRow
          ? 'dual-follow+weather-hybrid-reversion'
          : followRow
            ? 'dual-follow'
            : reversionRow
              ? 'weather-hybrid-reversion'
              : 'index-fallback',
    }
  }

  if (policy.conflictPolicy === 'fade-confirmed-follow') {
    if (reversionRow && followRow && sameDirection(followPosition, reversionPosition)) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-follow+weather-hybrid-reversion',
      }
    }
    if (reversionRow) {
      return {
        followRow: null,
        reversionRow,
        followPosition: 0,
        reversionPosition,
        position: reversionPosition,
        blendLeg: 'weather-hybrid-reversion',
      }
    }
  }

  if (
    policy.conflictPolicy === 'confirmed-warm-short' ||
    policy.conflictPolicy === 'confirmed-warm-short-plus-cold-follow'
  ) {
    if (
      followRow?.thesisKind === 'warm-short' &&
      reversionRow?.thesisKind === 'reversion-short' &&
      sameDirection(followPosition, reversionPosition)
    ) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-warm-short+weather-hybrid-reversion',
      }
    }
    if (policy.conflictPolicy === 'confirmed-warm-short-plus-cold-follow' && followRow?.thesisKind === 'cold-long') {
      return {
        followRow,
        reversionRow: null,
        followPosition,
        reversionPosition: 0,
        position: followPosition,
        blendLeg: 'dual-cold-follow',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-plus-cold-follow') {
    if (followRow?.thesisKind === 'cold-long') {
      const includeReversion = reversionRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = includeReversion ? reversionPosition : 0
      return {
        followRow,
        reversionRow: includeReversion ? reversionRow : null,
        followPosition,
        reversionPosition: scaledReversionPosition,
        position: clamp(followPosition + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeReversion ? 'confirmed-follow+weather-hybrid-reversion' : 'dual-cold-follow',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-short') {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = reversionPosition * (includeFollow ? 1 : (policy.standaloneReversionScale ?? 1))
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition: scaledReversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'confirmed-follow+weather-hybrid-reversion' : 'weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'vol-confirmed-fade-plus-cold-follow') {
    if (volatilityConfirmsReversion) {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'vol-confirmed-follow+weather-hybrid-reversion' : 'vol-confirmed-weather-hybrid-reversion',
      }
    }
    if (followRow?.thesisKind === 'cold-long') {
      return {
        followRow,
        reversionRow: null,
        followPosition,
        reversionPosition: 0,
        position: followPosition,
        blendLeg: 'dual-cold-follow',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-plus-cold-follow-vol-long') {
    if (followRow?.thesisKind === 'cold-long') {
      const includeReversion = reversionRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = includeReversion
        ? reversionPosition * (reversionRow.thesisKind === 'reversion-long' ? (policy.reversionLongScale ?? 1) : 1)
        : 0
      return {
        followRow,
        reversionRow: includeReversion ? reversionRow : null,
        followPosition,
        reversionPosition: scaledReversionPosition,
        position: clamp(followPosition + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeReversion ? 'confirmed-follow+weather-hybrid-reversion' : 'dual-cold-follow',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-long' && volatilityConfirmsReversion) {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = reversionPosition * (policy.reversionLongScale ?? 1)
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition: scaledReversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'vol-confirmed-follow+weather-hybrid-reversion' : 'vol-confirmed-weather-hybrid-reversion',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-short') {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      const scaledReversionPosition = reversionPosition * (includeFollow ? 1 : (policy.standaloneReversionScale ?? 1))
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition: scaledReversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + scaledReversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'confirmed-follow+weather-hybrid-reversion' : 'weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-confirmed-long') {
    if (reversionRow?.thesisKind === 'reversion-short') {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'confirmed-follow+weather-hybrid-reversion' : 'weather-hybrid-reversion',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-long' && followRow && sameDirection(followPosition, reversionPosition)) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-follow+weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'weather-hybrid-parent') {
    if (reversionRow) {
      return {
        followRow: null,
        reversionRow,
        followPosition: 0,
        reversionPosition,
        position: reversionPosition,
        blendLeg: 'weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-only') {
    if (reversionRow?.thesisKind === 'reversion-short') {
      return {
        followRow: null,
        reversionRow,
        followPosition: 0,
        reversionPosition,
        position: reversionPosition,
        blendLeg: 'weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'follow-first') {
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
    if (reversionRow) {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
  }

  if (policy.conflictPolicy === 'fade-first') {
    if (reversionRow) {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
  }

  if (policy.conflictPolicy === 'short-fade-first') {
    if (reversionRow?.thesisKind === 'reversion-short') {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
    if (reversionRow) {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
  }

  return { followRow, reversionRow, followPosition: 0, reversionPosition: 0, position: 0, blendLeg: 'index-fallback' }
}

function buildIndexTrendRiskMap(marketRows) {
  const riskByDate = new Map()
  const closes = []

  for (const row of marketRows) {
    const close = numberFrom(row.close, null)
    if (!Number.isFinite(close) || close <= 0) continue
    const previousClose = closes.at(-1)
    const hasLookback = closes.length >= INDEX_TREND_LOOKBACK_SESSIONS
    const trendAverage = hasLookback ? mean(closes.slice(-INDEX_TREND_LOOKBACK_SESSIONS)) : 0
    riskByDate.set(row.date, !hasLookback || previousClose >= trendAverage)
    closes.push(close)
  }

  return riskByDate
}

function indexRiskOnForDate(policy, date, indexTrendRiskByDate) {
  if (policy.indexRiskMode !== 'idle-index-200d-trend') return true
  return indexTrendRiskByDate.get(date) ?? true
}

function indexRiskLabelFor(policy) {
  return policy.indexRiskMode === 'idle-index-200d-trend'
    ? `${INDEX_TREND_LOOKBACK_SESSIONS}-session index trend risk-off for idle capital`
    : 'Full index fallback for idle capital'
}

function usesVolatilityConfirmation(policy) {
  return ['vol-confirmed-fade-plus-cold-follow', 'short-fade-plus-cold-follow-vol-long'].includes(policy.conflictPolicy)
}

function buildRowsForPolicy(policy, dualRows, weatherRows, volatilityRows, indexTrendRiskByDate, weatherResolutionData, storageData) {
  const holdPeriodPolicy = policy.holdPeriodPolicy ?? DEFAULT_HOLD_PERIOD_POLICY
  const dualRowsForPolicy = applyParentHoldPeriodPolicy(dualRows, holdPeriodPolicy)
  const weatherRowsForPolicy = applyParentHoldPeriodPolicy(weatherRows, holdPeriodPolicy)
  const dualByDate = new Map(dualRowsForPolicy.map((row) => [row.entryTradeDate, row]))
  const weatherByDate = new Map(weatherRowsForPolicy.map((row) => [row.entryTradeDate, row]))
  const volatilityByDate = new Map(volatilityRows.map((row) => [row.entryTradeDate, row]))
  const dates = [...new Set([...dualByDate.keys(), ...weatherByDate.keys()])].sort()
  const rows = []
  const curve = []
  let equity = INITIAL_CAPITAL
  let peak = INITIAL_CAPITAL
  let previousPosition = 0

  for (const date of dates) {
    const dualRow = dualByDate.get(date)
    const weatherRow = weatherByDate.get(date)
    const volatilityRow = volatilityByDate.get(date)
    const fallback = baseFallbackRow(dualRow, weatherRow)
    const storageContext = storageData.contextForDate(date)
    const rawBlend = blendPositionFor(policy, dualRow, weatherRow, volatilityRow)
    const storageGatedBlend = applyColdFollowStorageGate(policy, rawBlend, storageContext)
    const resolvedBlend = applyWeatherResolution(policy, storageGatedBlend, weatherResolutionData)
    const blend = applyOverlayRiskMultiplier(policy, resolvedBlend)
    const weatherActive = blend.position !== 0
    const activeFollowRow = weatherActive ? blend.followRow : null
    const activeReversionRow = weatherActive ? blend.reversionRow : null
    const dominant = weatherActive ? chooseDominantRow(activeFollowRow, activeReversionRow, blend.position, policy) ?? fallback : fallback
    const isFallback = blend.position === 0
    const indexReturnPct = numberFrom(fallback.indexReturnPct)
    const ungReturnPct = numberFrom(fallback.ungReturnPct)
    const indexFraction = Math.max(0, 1 - Math.abs(blend.position))
    const indexRiskOn = indexRiskOnForDate(policy, date, indexTrendRiskByDate)
    const investedIndexFraction = indexRiskOn ? indexFraction : 0
    const cashFraction = indexFraction - investedIndexFraction
    const grossReturnPct = investedIndexFraction * indexReturnPct + blend.position * ungReturnPct
    const tradingCostPct = Math.abs(blend.position - previousPosition) * ONE_WAY_COST_PCT
    const netReturnPct = investedIndexFraction * indexReturnPct + blend.position * ungReturnPct - tradingCostPct
    const previousEquity = equity
    equity = Math.max(1, equity * (1 + netReturnPct / 100))
    peak = Math.max(peak, equity)
    const drawdownPct = ((equity - peak) / peak) * 100
    const componentThesisKinds = [
      activeFollowRow?.thesisKind ? `follow:${activeFollowRow.thesisKind}` : null,
      activeReversionRow?.thesisKind ? `reversion:${activeReversionRow.thesisKind}` : null,
    ].filter(Boolean)

    const row = {
      strategyId: STRATEGY_ID,
      signalDate: dominant.issueDate ?? date,
      issueDate: dominant.issueDate ?? date,
      targetDate: dominant.targetDate ?? date,
      entryTradeDate: date,
      exitTradeDate: date,
      targetTradeDate: date,
      direction: blend.position < 0 ? 'short' : 'long',
      sourceId: isFallback
        ? 'US-INDEX-BASKET'
        : blend.followRow && blend.reversionRow && usesVolatilityConfirmation(policy)
          ? 'dual-weather+weather-hybrid+volatility-reversion'
          : blend.followRow && blend.reversionRow
            ? 'dual-weather+weather-hybrid'
            : blend.reversionRow && usesVolatilityConfirmation(policy)
              ? 'weather-hybrid+volatility-reversion'
              : blend.followRow
                ? blend.followRow.sourceId
                : blend.reversionRow?.sourceId,
      windowId: isFallback
        ? 'index-fallback'
        : blend.followRow && blend.reversionRow
          ? 'winter-alpha-blend'
          : blend.followRow
            ? 'weather-follow'
            : 'weather-reversion',
      thesisKind: isFallback ? 'index-fallback' : dominant.thesisKind,
      leadDays: numberFrom(dominant.leadDays),
      confidence: round(Math.max(numberFrom(activeFollowRow?.confidence), numberFrom(activeReversionRow?.confidence)), 4),
      weightedAnomalyF: numberFrom(dominant.weightedAnomalyF),
      coveragePct: numberFrom(dominant.coveragePct),
      coldCoveragePct: dominant.thesisKind === 'cold-long' ? numberFrom(dominant.coldCoveragePct || dominant.coveragePct) : 0,
      warmCoveragePct: dominant.thesisKind === 'warm-short' ? numberFrom(dominant.warmCoveragePct || dominant.coveragePct) : 0,
      extremeCount: numberFrom(dominant.extremeCount),
      indexFraction: round(indexFraction, 4),
      investedIndexFraction: round(investedIndexFraction, 4),
      cashFraction: round(cashFraction, 4),
      indexRiskMode: policy.indexRiskMode,
      indexRiskOn,
      ungPosition: round(blend.position, 4),
      ungReturnPct: round(ungReturnPct, 4),
      indexReturnPct: round(indexReturnPct, 4),
      grossReturnPct: round(grossReturnPct, 4),
      tradingCostPct: round(tradingCostPct, 4),
      netReturnPct: round(netReturnPct, 4),
      equity: round(equity, 2),
      equityPct: round((equity / INITIAL_CAPITAL - 1) * 100, 4),
      drawdownPct: round(drawdownPct, 4),
      rank: round(Math.max(numberFrom(activeFollowRow?.rank), numberFrom(activeReversionRow?.rank)), 4),
      sourceStrategyId: isFallback
        ? 'index-fallback'
        : blend.followRow && blend.reversionRow && usesVolatilityConfirmation(policy)
          ? 'dual-weather-rotation+weather-hybrid-rotation+volatility-mean-reversion'
          : blend.followRow && blend.reversionRow
            ? 'dual-weather-rotation+weather-hybrid-rotation'
            : blend.reversionRow && usesVolatilityConfirmation(policy)
              ? 'weather-hybrid-rotation+volatility-mean-reversion'
              : blend.followRow
                ? 'dual-weather-rotation'
                : 'weather-hybrid-rotation',
      blendLeg: blend.blendLeg,
      followPosition: round(blend.followPosition, 4),
      reversionPosition: round(blend.reversionPosition, 4),
      componentThesisKinds,
      positionPolicy: policy.id,
      holdPeriodPolicy: holdPeriodPolicy.id,
      holdPeriodAction: [
        activeFollowRow?.parentHoldAction,
        activeReversionRow?.parentHoldAction,
        isFallback ? dominant.parentHoldAction : null,
      ]
        .filter(Boolean)
        .join('|'),
      holdPeriodParentDay: Math.max(numberFrom(activeFollowRow?.parentHoldDay), numberFrom(activeReversionRow?.parentHoldDay), numberFrom(isFallback ? dominant.parentHoldDay : 0)) || '',
      holdPeriodLimit: Math.max(numberFrom(activeFollowRow?.parentHoldLimit), numberFrom(activeReversionRow?.parentHoldLimit), numberFrom(isFallback ? dominant.parentHoldLimit : 0)) || '',
      weatherResolutionPolicy: policy.weatherResolutionPolicy?.id ?? DEFAULT_WEATHER_RESOLUTION_POLICY.id,
      weatherResolutionSource: blend.weatherResolution.source ?? '',
      weatherResolutionIssueDate: blend.weatherResolution.issueDate ?? '',
      weatherResolutionSourceIds: blend.weatherResolution.sourceIds ?? [],
      weatherResolutionOriginalAnomalyF: Number.isFinite(blend.weatherResolution.originalAnomalyF)
        ? round(blend.weatherResolution.originalAnomalyF, 3)
        : '',
      weatherResolutionAnomalyF: Number.isFinite(blend.weatherResolution.resolutionAnomalyF)
        ? round(blend.weatherResolution.resolutionAnomalyF, 3)
        : '',
      weatherResolutionShiftF: Number.isFinite(blend.weatherResolution.shiftF) ? round(blend.weatherResolution.shiftF, 3) : '',
      weatherResolutionReliefF: Number.isFinite(blend.weatherResolution.reliefF) ? round(blend.weatherResolution.reliefF, 3) : '',
      weatherResolutionAction: blend.weatherResolution.action ?? '',
      weatherResolutionScale: round(blend.weatherResolution.scale ?? 1, 4),
      coldFollowStoragePolicy: policy.coldFollowStoragePolicy?.id ?? DEFAULT_COLD_FOLLOW_STORAGE_POLICY.id,
      coldFollowStorageAction: blend.coldFollowStorage?.action ?? '',
      coldFollowStorageMinSeasonDrawdownBcf: Number.isFinite(blend.coldFollowStorage?.minSeasonDrawdownBcf)
        ? round(blend.coldFollowStorage.minSeasonDrawdownBcf, 2)
        : '',
      storageDate: storageContext.storageDate ?? '',
      storageReleaseDate: storageContext.storageReleaseDate ?? '',
      storageBcf: Number.isFinite(storageContext.storageBcf) ? round(storageContext.storageBcf, 2) : '',
      storageSeasonPeakBcf: Number.isFinite(storageContext.storageSeasonPeakBcf) ? round(storageContext.storageSeasonPeakBcf, 2) : '',
      storageSeasonDrawdownBcf: Number.isFinite(storageContext.storageSeasonDrawdownBcf)
        ? round(storageContext.storageSeasonDrawdownBcf, 2)
        : '',
      storageSeasonalAverageBcf: Number.isFinite(storageContext.storageSeasonalAverageBcf)
        ? round(storageContext.storageSeasonalAverageBcf, 2)
        : '',
      storageVsSeasonalAverageBcf: Number.isFinite(storageContext.storageVsSeasonalAverageBcf)
        ? round(storageContext.storageVsSeasonalAverageBcf, 2)
        : '',
      storageSeasonalPercentile: Number.isFinite(storageContext.storageSeasonalPercentile)
        ? round(storageContext.storageSeasonalPercentile, 2)
        : '',
      storageWeeklyChangeBcf: Number.isFinite(storageContext.storageWeeklyChangeBcf) ? round(storageContext.storageWeeklyChangeBcf, 2) : '',
      storageWeeklyChangeVsSeasonalAverageBcf: Number.isFinite(storageContext.storageWeeklyChangeVsSeasonalAverageBcf)
        ? round(storageContext.storageWeeklyChangeVsSeasonalAverageBcf, 2)
        : '',
      overlayRiskMultiplier: round(blend.overlayRiskMultiplier ?? 1, 4),
      effectiveOverlayCap: round(blend.effectiveOverlayCap ?? policy.overlayCap, 4),
    }

    rows.push(row)
    curve.push({
      date,
      equity,
      equityPct: (equity / INITIAL_CAPITAL - 1) * 100,
      dailyPnlPct: previousEquity ? ((equity - previousEquity) / previousEquity) * 100 : 0,
      drawdownPct,
      position: blend.position,
      netReturnPct,
      indexReturnPct,
      activeReturnPct: netReturnPct - indexReturnPct,
    })
    previousPosition = blend.position
  }

  return { rows, curve }
}

function metricsFromCurve(curve, tradeCount) {
  if (!curve.length) {
    return {
      totalReturnPct: 0,
      cagrPct: 0,
      annualVolPct: 0,
      sharpe: 0,
      sortino: 0,
      maxDrawdownPct: 0,
      calmar: 0,
      winRatePct: 0,
      profitFactor: 0,
      tradeCount,
      exposurePct: 0,
      turnover: 0,
      var95Pct: 0,
      cvar95Pct: 0,
      averageDailyPnlPct: 0,
      firstEntry: null,
      lastExit: null,
      averageHoldDays: 1,
      tStat: 0,
    }
  }

  const returns = curve.map((point) => point.dailyPnlPct / 100)
  const negativeReturns = returns.filter((value) => value < 0)
  let rebasedEquity = 1
  let rebasedPeak = 1
  let maxDrawdown = 0
  for (const value of returns) {
    rebasedEquity *= 1 + value
    rebasedPeak = Math.max(rebasedPeak, rebasedEquity)
    maxDrawdown = Math.min(maxDrawdown, rebasedEquity / rebasedPeak - 1)
  }
  const totalReturn = rebasedEquity - 1
  const years = Math.max(daysBetween(curve[0].date, curve.at(-1).date) / 365.25, 1 / 365.25)
  const annualReturn = (1 + totalReturn) ** (1 / years) - 1
  const annualVol = std(returns) * Math.sqrt(TRADING_DAYS)
  const downsideVol = std(negativeReturns) * Math.sqrt(TRADING_DAYS)
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)
  const exposure = mean(curve.map((point) => Math.abs(point.position)))
  const turnover = curve.reduce((sum, point, index) => sum + Math.abs(point.position - (curve[index - 1]?.position ?? 0)), 0)
  const avg = mean(returns)
  const standardError = std(returns) ? std(returns) / Math.sqrt(returns.length) : 0

  return {
    totalReturnPct: round(totalReturn * 100, 2),
    cagrPct: round(annualReturn * 100, 2),
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (avg * TRADING_DAYS) / annualVol : 0, 2),
    sortino: round(downsideVol ? (avg * TRADING_DAYS) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdown * 100, 2),
    calmar: round(Math.abs(maxDrawdown) ? annualReturn / Math.abs(maxDrawdown) : 0, 2),
    winRatePct: round((returns.filter((value) => value > 0).length / Math.max(returns.length, 1)) * 100, 1),
    profitFactor: round(losses ? gains / losses : gains ? 99 : 0, 2),
    tradeCount,
    exposurePct: round(exposure * 100, 1),
    turnover: round(turnover, 2),
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(avg * 100, 3),
    firstEntry: curve[0].date,
    lastExit: curve.at(-1).date,
    averageHoldDays: 1,
    tStat: round(standardError ? avg / standardError : 0, 2),
  }
}

function curveForSplit(curve, split) {
  return curve.filter((point) => daySplit(point.date) === split)
}

function rowsForSplit(rows, split) {
  return rows.filter((row) => daySplit(row.entryTradeDate) === split)
}

function indexCurveFromRows(rows) {
  return rows.map((row) => ({
    date: row.entryTradeDate,
    dailyPnlPct: numberFrom(row.indexReturnPct),
    position: 0,
  }))
}

function rowHasThesisKind(row, thesisKind) {
  if (row.thesisKind === thesisKind) return true
  return Array.isArray(row.componentThesisKinds)
    ? row.componentThesisKinds.some((component) => component === thesisKind || component.endsWith(`:${thesisKind}`))
    : false
}

function sideReturnSnapshot(rows, splitFilter = () => true) {
  const metricFor = (thesisKinds) => {
    const selectedRows = rows.filter((row) => splitFilter(row) && thesisKinds.some((thesisKind) => rowHasThesisKind(row, thesisKind)))
    return metricsFromCurve(
      selectedRows.map((row) => ({
        date: row.entryTradeDate,
        equity: INITIAL_CAPITAL * (1 + numberFrom(row.netReturnPct) / 100),
        dailyPnlPct: numberFrom(row.netReturnPct),
        drawdownPct: numberFrom(row.netReturnPct) < 0 ? numberFrom(row.netReturnPct) : 0,
        position: numberFrom(row.ungPosition),
      })),
      selectedRows.length,
    )
  }

  return {
    coldLong: metricFor(['cold-long']),
    warmShort: metricFor(['warm-short']),
    weatherFollow: metricFor(['cold-long', 'warm-short']),
    reversionLong: metricFor(['reversion-long']),
    reversionShort: metricFor(['reversion-short']),
    weatherReversion: metricFor(['reversion-long', 'reversion-short']),
    longSide: metricFor(['cold-long', 'reversion-long']),
    shortSide: metricFor(['warm-short', 'reversion-short']),
    fallback: metricFor(['index-fallback']),
  }
}

function legCounts(rows, splitFilter = () => true) {
  const scoped = rows.filter((row) => splitFilter(row))
  return {
    dualFollow: scoped.filter((row) => row.blendLeg === 'dual-follow').length,
    dualColdFollow: scoped.filter((row) => row.blendLeg === 'dual-cold-follow').length,
    weatherHybridReversion: scoped.filter((row) => row.blendLeg === 'weather-hybrid-reversion').length,
    volConfirmedReversion: scoped.filter((row) => row.blendLeg === 'vol-confirmed-weather-hybrid-reversion').length,
    blended: scoped.filter((row) => row.blendLeg === 'dual-follow+weather-hybrid-reversion').length,
    confirmedBlended: scoped.filter((row) =>
      [
        'confirmed-follow+weather-hybrid-reversion',
        'confirmed-warm-short+weather-hybrid-reversion',
        'vol-confirmed-follow+weather-hybrid-reversion',
      ].includes(row.blendLeg),
    ).length,
    coldLong: scoped.filter((row) => rowHasThesisKind(row, 'cold-long')).length,
    warmShort: scoped.filter((row) => rowHasThesisKind(row, 'warm-short')).length,
    reversionLong: scoped.filter((row) => rowHasThesisKind(row, 'reversion-long')).length,
    reversionShort: scoped.filter((row) => rowHasThesisKind(row, 'reversion-short')).length,
    coldFollowStorageConfirmed: scoped.filter((row) => row.coldFollowStorageAction === 'storage-drawdown-confirmed').length,
    coldFollowStorageBlocked: scoped.filter((row) => row.coldFollowStorageAction === 'blocked-insufficient-storage-drawdown').length,
    indexRiskOff: scoped.filter((row) => row.indexRiskOn === false).length,
  }
}

function summarizePolicy(policy, dualRows, weatherRows, volatilityRows, indexTrendRiskByDate, weatherResolutionData, storageData) {
  const { rows, curve } = buildRowsForPolicy(policy, dualRows, weatherRows, volatilityRows, indexTrendRiskByDate, weatherResolutionData, storageData)
  const eventRows = rows.filter((row) => row.windowId !== 'index-fallback')
  const indexCurve = indexCurveFromRows(rows)
  const indexMetrics = {
    all: metricsFromCurve(indexCurve, 0),
    train: metricsFromCurve(curveForSplit(indexCurve, 'train'), 0),
    validation: metricsFromCurve(curveForSplit(indexCurve, 'validation'), 0),
    holdout: metricsFromCurve(curveForSplit(indexCurve, 'holdout'), 0),
  }
  const allMetrics = metricsFromCurve(curve, eventRows.length)
  const trainMetrics = metricsFromCurve(curveForSplit(curve, 'train'), rowsForSplit(eventRows, 'train').length)
  const validationMetrics = metricsFromCurve(curveForSplit(curve, 'validation'), rowsForSplit(eventRows, 'validation').length)
  const holdoutMetrics = metricsFromCurve(curveForSplit(curve, 'holdout'), rowsForSplit(eventRows, 'holdout').length)
  const splitEdges = {
    train: round(trainMetrics.totalReturnPct - indexMetrics.train.totalReturnPct, 2),
    validation: round(validationMetrics.totalReturnPct - indexMetrics.validation.totalReturnPct, 2),
    holdout: round(holdoutMetrics.totalReturnPct - indexMetrics.holdout.totalReturnPct, 2),
    all: round(allMetrics.totalReturnPct - indexMetrics.all.totalReturnPct, 2),
  }
  const sideReturns = {
    all: sideReturnSnapshot(rows),
    trainValidation: sideReturnSnapshot(rows, (row) => row.entryTradeDate <= VALIDATION_END),
    holdout: sideReturnSnapshot(rows, (row) => daySplit(row.entryTradeDate) === 'holdout'),
  }
  const result = {
    candidateId: `ngas-alpha-${policy.id}`,
    architectureId: 'parent-expert-blend',
    architectureLabel: policy.label,
    architectureDescription: policy.positionPolicy,
    useFollowLeg: true,
    useReversionLeg: true,
    sourceSetId: 'parent-selected-weather-experts',
    sourceSetLabel:
      usesVolatilityConfirmation(policy)
        ? 'Dual Weather follow plus Weather Hybrid reversion confirmed by Volatility Mean Reversion'
        : 'Dual Weather follow plus Weather Hybrid reversion',
    sourceIds:
      usesVolatilityConfirmation(policy)
        ? ['dual-weather-rotation', 'weather-hybrid-rotation', 'volatility-mean-reversion']
        : ['dual-weather-rotation', 'weather-hybrid-rotation'],
    sourceWeightMode: 'parent-selected',
    sizingMode: policy.id,
    holdPeriodPolicy: policy.holdPeriodPolicy ?? DEFAULT_HOLD_PERIOD_POLICY,
    weatherResolutionPolicy: policy.weatherResolutionPolicy ?? DEFAULT_WEATHER_RESOLUTION_POLICY,
    coldFollowStoragePolicy: policy.coldFollowStoragePolicy ?? DEFAULT_COLD_FOLLOW_STORAGE_POLICY,
    indexRiskMode: policy.indexRiskMode,
    indexRiskLabel: indexRiskLabelFor(policy),
    indexTrendLookbackSessions:
      policy.indexRiskMode === 'idle-index-200d-trend' ? INDEX_TREND_LOOKBACK_SESSIONS : null,
    anomalyThreshold: null,
    coverageThreshold: null,
    minConfidence: null,
    weatherFraction: 0.25,
    reversionFraction: 0.2,
    reversionLongScale: policy.reversionLongScale ?? 1,
    standaloneReversionScale: policy.standaloneReversionScale ?? 1,
    overlayRiskMultiplier: policy.overlayRiskMultiplier ?? 1,
    effectiveOverlayCap: Math.min(MAX_EFFECTIVE_OVERLAY_CAP, policy.overlayCap * (policy.overlayRiskMultiplier ?? 1)),
    overlayCap: policy.overlayCap,
    followHoldDays: (policy.holdPeriodPolicy ?? DEFAULT_HOLD_PERIOD_POLICY).followHoldDays ?? 3,
    reversionHoldDays: (policy.holdPeriodPolicy ?? DEFAULT_HOLD_PERIOD_POLICY).reversionHoldDays ?? 2,
    minRealizedMovePct: 2,
    positionPolicy: policy.positionPolicy,
    conflictPolicy: policy.conflictPolicy,
    selectionEligible: policy.selectionEligible,
    requiredSideChecks: policy.requiredSideChecks,
    allMetrics,
    trainMetrics,
    validationMetrics,
    holdoutMetrics,
    indexMetrics,
    splitEdges,
    sideReturns,
    legCounts: {
      all: legCounts(rows),
      trainValidation: legCounts(rows, (row) => row.entryTradeDate <= VALIDATION_END),
      holdout: legCounts(rows, (row) => daySplit(row.entryTradeDate) === 'holdout'),
    },
    rows,
    curve,
  }

  return {
    ...result,
    eligible: isEligible(result),
    trainValidationRank: trainValidationRank(result),
  }
}

function isEligible(result) {
  const sides = result.sideReturns.trainValidation
  const sideChecksPass = result.requiredSideChecks.every((sideKey) => sides[sideKey].tradeCount > 0 && sides[sideKey].totalReturnPct > 0)

  return (
    result.trainMetrics.tradeCount >= 20 &&
    result.validationMetrics.tradeCount >= 10 &&
    result.trainMetrics.totalReturnPct > 0 &&
    result.validationMetrics.totalReturnPct > 0 &&
    result.selectionEligible &&
    result.indexRiskMode === 'full-index-fallback' &&
    result.splitEdges.train > 0 &&
    result.splitEdges.validation > 0 &&
    result.trainMetrics.maxDrawdownPct > result.indexMetrics.train.maxDrawdownPct &&
    result.validationMetrics.maxDrawdownPct > result.indexMetrics.validation.maxDrawdownPct &&
    result.trainMetrics.annualVolPct <= 20 &&
    result.validationMetrics.annualVolPct <= 20 &&
    sideChecksPass
  )
}

function trainValidationRank(result) {
  const sides = result.sideReturns.trainValidation
  const sideQuality =
    Math.min(12, sides.coldLong.totalReturnPct) +
    Math.min(12, sides.warmShort.totalReturnPct) +
    Math.min(12, sides.reversionLong.totalReturnPct) +
    Math.min(12, sides.reversionShort.totalReturnPct)
  const balance =
    Math.min(result.legCounts.trainValidation.coldLong, result.legCounts.trainValidation.warmShort) +
    Math.min(result.legCounts.trainValidation.reversionLong, result.legCounts.trainValidation.reversionShort)

  return round(
    result.splitEdges.train * 0.6 +
      result.splitEdges.validation * 1.05 +
      result.trainMetrics.sharpe * 8 +
      result.validationMetrics.sharpe * 11 +
      result.trainMetrics.sortino * 3 +
      result.validationMetrics.sortino * 4 +
      (result.trainMetrics.maxDrawdownPct - result.indexMetrics.train.maxDrawdownPct) * 1.3 +
      (result.validationMetrics.maxDrawdownPct - result.indexMetrics.validation.maxDrawdownPct) * 1.5 +
      (result.indexMetrics.train.annualVolPct - result.trainMetrics.annualVolPct) * 0.7 +
      (result.indexMetrics.validation.annualVolPct - result.validationMetrics.annualVolPct) * 0.9 +
      Math.sqrt(result.trainMetrics.tradeCount + result.validationMetrics.tradeCount) * 0.9 +
      Math.sqrt(balance) * 1.15 +
      sideQuality * 0.3,
    4,
  )
}

function formatCandidateRow(candidate) {
  return {
    candidateId: candidate.candidateId,
    eligible: candidate.eligible,
    trainValidationRank: candidate.trainValidationRank,
    architectureId: candidate.architectureId,
    conflictPolicy: candidate.conflictPolicy,
    weatherResolutionPolicy: candidate.weatherResolutionPolicy.id,
    weatherResolutionKind: candidate.weatherResolutionPolicy.kind,
    coldFollowStoragePolicy: candidate.coldFollowStoragePolicy.id,
    coldFollowStorageMinSeasonDrawdownBcf: candidate.coldFollowStoragePolicy.minSeasonDrawdownBcf ?? '',
    holdPeriodPolicy: candidate.holdPeriodPolicy.id,
    holdFollowDays: candidate.holdPeriodPolicy.followHoldDays ?? '',
    holdReversionDays: candidate.holdPeriodPolicy.reversionHoldDays ?? '',
    indexRiskMode: candidate.indexRiskMode,
    selectionEligible: candidate.selectionEligible,
    overlayCap: candidate.overlayCap,
    overlayRiskMultiplier: candidate.overlayRiskMultiplier,
    effectiveOverlayCap: candidate.effectiveOverlayCap,
    reversionLongScale: candidate.reversionLongScale,
    standaloneReversionScale: candidate.standaloneReversionScale,
    trainReturnPct: candidate.trainMetrics.totalReturnPct,
    trainIndexReturnPct: candidate.indexMetrics.train.totalReturnPct,
    trainEdgePct: candidate.splitEdges.train,
    trainSharpe: candidate.trainMetrics.sharpe,
    trainVolatilityPct: candidate.trainMetrics.annualVolPct,
    trainMaxDrawdownPct: candidate.trainMetrics.maxDrawdownPct,
    validationReturnPct: candidate.validationMetrics.totalReturnPct,
    validationIndexReturnPct: candidate.indexMetrics.validation.totalReturnPct,
    validationEdgePct: candidate.splitEdges.validation,
    validationSharpe: candidate.validationMetrics.sharpe,
    validationVolatilityPct: candidate.validationMetrics.annualVolPct,
    validationMaxDrawdownPct: candidate.validationMetrics.maxDrawdownPct,
    trainValidationColdLongReturnPct: candidate.sideReturns.trainValidation.coldLong.totalReturnPct,
    trainValidationWarmShortReturnPct: candidate.sideReturns.trainValidation.warmShort.totalReturnPct,
    trainValidationReversionLongReturnPct: candidate.sideReturns.trainValidation.reversionLong.totalReturnPct,
    trainValidationReversionShortReturnPct: candidate.sideReturns.trainValidation.reversionShort.totalReturnPct,
    holdoutReturnPct: candidate.holdoutMetrics.totalReturnPct,
    holdoutIndexReturnPct: candidate.indexMetrics.holdout.totalReturnPct,
    holdoutEdgePct: candidate.splitEdges.holdout,
    holdoutSharpe: candidate.holdoutMetrics.sharpe,
    holdoutMaxDrawdownPct: candidate.holdoutMetrics.maxDrawdownPct,
    allReturnPct: candidate.allMetrics.totalReturnPct,
    allIndexReturnPct: candidate.indexMetrics.all.totalReturnPct,
    allEdgePct: candidate.splitEdges.all,
    allVolatilityPct: candidate.allMetrics.annualVolPct,
    allSharpe: candidate.allMetrics.sharpe,
    allMaxDrawdownPct: candidate.allMetrics.maxDrawdownPct,
  }
}

function selectedTradeRows(rows) {
  const headers = [
    'strategyId',
    'signalDate',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'exitTradeDate',
    'targetTradeDate',
    'direction',
    'sourceId',
    'windowId',
    'thesisKind',
    'leadDays',
    'confidence',
    'weightedAnomalyF',
    'coveragePct',
    'coldCoveragePct',
    'warmCoveragePct',
    'extremeCount',
    'indexFraction',
    'investedIndexFraction',
    'cashFraction',
    'indexRiskMode',
    'indexRiskOn',
    'ungPosition',
    'ungReturnPct',
    'indexReturnPct',
    'grossReturnPct',
    'tradingCostPct',
    'netReturnPct',
    'equity',
    'equityPct',
    'drawdownPct',
    'rank',
    'sourceStrategyId',
    'blendLeg',
    'followPosition',
    'reversionPosition',
    'componentThesisKinds',
    'positionPolicy',
    'holdPeriodPolicy',
    'holdPeriodAction',
    'holdPeriodParentDay',
    'holdPeriodLimit',
    'weatherResolutionPolicy',
    'weatherResolutionSource',
    'weatherResolutionIssueDate',
    'weatherResolutionSourceIds',
    'weatherResolutionOriginalAnomalyF',
    'weatherResolutionAnomalyF',
    'weatherResolutionShiftF',
    'weatherResolutionReliefF',
    'weatherResolutionAction',
    'weatherResolutionScale',
    'coldFollowStoragePolicy',
    'coldFollowStorageAction',
    'coldFollowStorageMinSeasonDrawdownBcf',
    'storageDate',
    'storageReleaseDate',
    'storageBcf',
    'storageSeasonPeakBcf',
    'storageSeasonDrawdownBcf',
    'storageSeasonalAverageBcf',
    'storageVsSeasonalAverageBcf',
    'storageSeasonalPercentile',
    'storageWeeklyChangeBcf',
    'storageWeeklyChangeVsSeasonalAverageBcf',
    'overlayRiskMultiplier',
    'effectiveOverlayCap',
  ]
  return { headers, rows }
}

function createSeededRandom(seed = 1987) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function activeReturnSeries(curve) {
  return curve.map((point) => numberFrom(point.activeReturnPct) / 100)
}

function blockBootstrapMeans(values, { seed = 1987 } = {}) {
  const random = createSeededRandom(seed)
  const means = []

  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    const sampled = []
    while (sampled.length < values.length) {
      const start = Math.floor(random() * values.length)
      for (let offset = 0; offset < BLOCK_LENGTH && sampled.length < values.length; offset += 1) {
        sampled.push(values[(start + offset) % values.length])
      }
    }
    means.push(mean(sampled))
  }

  return means
}

function pValueFromNullMeans(nullMeans, observed) {
  const exceedances = nullMeans.filter((value) => value >= observed).length
  return round((exceedances + 1) / (BOOTSTRAP_ITERATIONS + 1), 4)
}

function pctSummary(values) {
  return {
    p05: round(percentile(values, 0.05) * 100, 5),
    p50: round(percentile(values, 0.5) * 100, 5),
    p95: round(percentile(values, 0.95) * 100, 5),
  }
}

function candidateFamilyRealityCheck(selectedCurve, candidates, observed) {
  const selectedDates = selectedCurve.map((point) => point.date)
  const family = candidates
    .filter((candidate) => candidate.eligible && candidate.curve?.length)
    .map((candidate) => {
      const byDate = new Map(candidate.curve.map((point) => [point.date, numberFrom(point.activeReturnPct) / 100]))
      const returns = selectedDates.map((date) => byDate.get(date) ?? 0)
      const candidateObserved = mean(returns)
      return {
        candidateId: candidate.candidateId,
        observed: candidateObserved,
        centeredReturns: returns.map((value) => value - candidateObserved),
      }
    })

  if (!family.length) return null

  const random = createSeededRandom(7919)
  const maxNullMeans = []
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    const sums = Array.from({ length: family.length }, () => 0)
    let sampledCount = 0

    while (sampledCount < selectedDates.length) {
      const start = Math.floor(random() * selectedDates.length)
      for (let offset = 0; offset < BLOCK_LENGTH && sampledCount < selectedDates.length; offset += 1) {
        const sampleIndex = (start + offset) % selectedDates.length
        family.forEach((candidate, candidateIndex) => {
          sums[candidateIndex] += candidate.centeredReturns[sampleIndex]
        })
        sampledCount += 1
      }
    }

    maxNullMeans.push(Math.max(...sums.map((sum) => sum / selectedDates.length)))
  }

  const bestObserved = family.reduce((best, candidate) => (candidate.observed > best.observed ? candidate : best), family[0])

  return {
    candidateFamilySize: family.length,
    pValue: pValueFromNullMeans(maxNullMeans, observed),
    nullMaxMeanDailyEdgePct: pctSummary(maxNullMeans),
    bestObservedCandidateId: bestObserved.candidateId,
    bestObservedAverageDailyEdgePct: round(bestObserved.observed * 100, 5),
  }
}

function blockBootstrapRealityCheck(curve, candidates = []) {
  const activeReturns = activeReturnSeries(curve)
  const observed = mean(activeReturns)
  const centered = activeReturns.map((value) => value - observed)
  const meanBootstrapMeans = blockBootstrapMeans(activeReturns, { seed: 1987 })
  const nullBootstrapMeans = blockBootstrapMeans(centered, { seed: 1987 })
  const familyCheck = candidateFamilyRealityCheck(curve, candidates, observed)
  const singleCandidatePValue = pValueFromNullMeans(nullBootstrapMeans, observed)
  const primaryPValue = familyCheck?.pValue ?? singleCandidatePValue

  const meanInterval = pctSummary(meanBootstrapMeans)
  const nullInterval = pctSummary(nullBootstrapMeans)

  return {
    method: familyCheck
      ? 'selection-adjusted centered circular block bootstrap'
      : 'centered circular block bootstrap',
    comparison: 'strategy net daily return minus US index basket daily return',
    alternative: 'greater-than-zero daily active edge',
    pValue: primaryPValue,
    singleCandidatePValue,
    selectionAdjustedPValue: familyCheck?.pValue ?? null,
    observedAverageDailyEdgePct: round(observed * 100, 5),
    observedAnnualizedEdgePct: round(observed * TRADING_DAYS * 100, 2),
    dailyActiveVolPct: round(std(activeReturns) * 100, 4),
    standardErrorDailyEdgePct: round(std(activeReturns) / Math.sqrt(activeReturns.length) * 100, 5),
    meanConfidenceIntervalDailyEdgePct: meanInterval,
    nullConfidenceIntervalDailyEdgePct: nullInterval,
    candidateFamilySize: familyCheck?.candidateFamilySize ?? 1,
    bestObservedCandidateId: familyCheck?.bestObservedCandidateId ?? null,
    bestObservedAverageDailyEdgePct: familyCheck?.bestObservedAverageDailyEdgePct ?? null,
    nullMaxMeanDailyEdgePct: familyCheck?.nullMaxMeanDailyEdgePct ?? null,
    sampleCount: activeReturns.length,
    activeOverlayDays: curve.filter((point) => Math.abs(numberFrom(point.position)) > 1e-9).length,
    minimumResolvablePValue: round(1 / (BOOTSTRAP_ITERATIONS + 1), 4),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BLOCK_LENGTH,
  }
}

function sideRow(label, metrics) {
  return `| ${label} | ${metrics.tradeCount} | ${metrics.totalReturnPct}% | ${metrics.sharpe} | ${metrics.maxDrawdownPct}% |`
}

function winterAlphaPromotionStatus(summary) {
  const holdoutEdge = numberFrom(summary.selected?.splitEdges?.holdout, Number.NEGATIVE_INFINITY)
  const pValue = numberFrom(summary.validation?.realityCheck?.pValue, Number.POSITIVE_INFINITY)
  return holdoutEdge > 0 && pValue <= 0.1 ? 'research-baseline' : 'needs-more-validation'
}

function winterAlphaVerdict(summary) {
  const status = winterAlphaPromotionStatus(summary)
  if (status === 'research-baseline') {
    return 'Load this as an active research-baseline strategy, not broker-ready. The selected blend keeps idle capital in the index fallback so any return improvement comes from explicit gas overlays rather than a cash timing patch. It has cleared the current holdout-edge and bootstrap reality checks, but still needs non-overlapping paper validation before any broker adapter exists.'
  }

  return 'Load this as an active needs-more-validation strategy, not broker-ready. The selected blend keeps idle capital in the index fallback so any return improvement comes from explicit gas overlays rather than a cash timing patch. Holdout and the bootstrap reality check remain the promotion gates.'
}

function buildReport(summary) {
  const selected = summary.selected
  const topCandidates = summary.candidates

  return `# NGAS Winter Alpha

Generated at ${summary.generatedAt}.

## Purpose

This active QORE research strategy combines parent experts without fitting new weather thresholds: Dual Weather supplies the cold/warm forecast-follow context, Weather Hybrid supplies post-window reversion context, Volatility Mean Reversion can confirm same-direction overreaction fades, optional weather-resolution overlays test whether close-in or already-known actual weather shifted enough to support the fade, and optional EIA storage-drawdown gates test whether cold-follow longs are allowed only after the withdrawal season has consumed enough inventory. The selected blend is ranked on train/validation only, with holdout reported after selection.

## Selected Candidate

- Architecture: ${selected.architectureLabel}.
- Parent experts: Dual Weather Rotation for forecast-follow, Weather Hybrid Rotation for post-window reversion, and Volatility Mean Reversion for same-direction fade confirmation.
- Position policy: ${selected.positionPolicy}
- Max weather UNG overlay: ${selected.overlayCap}x; parent weather leg ${selected.weatherFraction}x and weather reversion leg ${selected.reversionFraction}x.
- Winter-alpha hold overlay: ${selected.holdPeriodPolicy.label}. ${selected.holdPeriodPolicy.description}
- Effective parent-ledger holds: forecast-follow ${selected.followHoldDays} trading day(s), post-window reversion ${selected.reversionHoldDays} trading day(s).
- Gas-overlay risk multiplier: ${selected.overlayRiskMultiplier}x; effective max weather UNG overlay ${selected.effectiveOverlayCap}x.
- Vol-confirmed reversion-long size: ${selected.reversionLongScale}x of the parent reversion leg.
- Standalone reversion fade size: ${selected.standaloneReversionScale}x of the parent reversion leg when no same-direction follow signal confirms it.
- Weather-resolution overlay: ${selected.weatherResolutionPolicy.label}. ${selected.weatherResolutionPolicy.description}
- Cold-follow storage gate: ${selected.coldFollowStoragePolicy.label}. ${selected.coldFollowStoragePolicy.description}
- Idle capital risk mode: ${selected.indexRiskLabel}.
- Cost: ${ROUND_TRIP_COST_PCT}% round trip, charged as ${ONE_WAY_COST_PCT}% one-way on UNG position changes.
- Selection: ${summary.contract.selectionPolicy}

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | ${selected.trainMetrics.tradeCount} | ${selected.trainMetrics.totalReturnPct}% | ${selected.indexMetrics.train.totalReturnPct}% | ${selected.splitEdges.train}% | ${selected.trainMetrics.cagrPct}% | ${selected.trainMetrics.sharpe} | ${selected.trainMetrics.sortino} | ${selected.trainMetrics.maxDrawdownPct}% | ${selected.trainMetrics.exposurePct}% |
| Validation | ${selected.validationMetrics.tradeCount} | ${selected.validationMetrics.totalReturnPct}% | ${selected.indexMetrics.validation.totalReturnPct}% | ${selected.splitEdges.validation}% | ${selected.validationMetrics.cagrPct}% | ${selected.validationMetrics.sharpe} | ${selected.validationMetrics.sortino} | ${selected.validationMetrics.maxDrawdownPct}% | ${selected.validationMetrics.exposurePct}% |
| Holdout | ${selected.holdoutMetrics.tradeCount} | ${selected.holdoutMetrics.totalReturnPct}% | ${selected.indexMetrics.holdout.totalReturnPct}% | ${selected.splitEdges.holdout}% | ${selected.holdoutMetrics.cagrPct}% | ${selected.holdoutMetrics.sharpe} | ${selected.holdoutMetrics.sortino} | ${selected.holdoutMetrics.maxDrawdownPct}% | ${selected.holdoutMetrics.exposurePct}% |
| Full | ${selected.allMetrics.tradeCount} | ${selected.allMetrics.totalReturnPct}% | ${selected.indexMetrics.all.totalReturnPct}% | ${selected.splitEdges.all}% | ${selected.allMetrics.cagrPct}% | ${selected.allMetrics.sharpe} | ${selected.allMetrics.sortino} | ${selected.allMetrics.maxDrawdownPct}% | ${selected.allMetrics.exposurePct}% |

## Train/Validation Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
${sideRow('Cold-long', selected.sideReturns.trainValidation.coldLong)}
${sideRow('Warm-short', selected.sideReturns.trainValidation.warmShort)}
${sideRow('Reversion-long', selected.sideReturns.trainValidation.reversionLong)}
${sideRow('Reversion-short', selected.sideReturns.trainValidation.reversionShort)}
${sideRow('Long-side combined', selected.sideReturns.trainValidation.longSide)}
${sideRow('Short-side combined', selected.sideReturns.trainValidation.shortSide)}

## Full Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
${sideRow('Cold-long', selected.sideReturns.all.coldLong)}
${sideRow('Warm-short', selected.sideReturns.all.warmShort)}
${sideRow('Reversion-long', selected.sideReturns.all.reversionLong)}
${sideRow('Reversion-short', selected.sideReturns.all.reversionShort)}
${sideRow('Long-side combined', selected.sideReturns.all.longSide)}
${sideRow('Short-side combined', selected.sideReturns.all.shortSide)}
${sideRow('Index fallback', selected.sideReturns.all.fallback)}

## Anti-Overfit Check

- Candidate count: ${summary.search.candidateCount}.
- Eligible candidates: ${summary.search.eligibleCandidateCount}.
- Eligibility requires a selectable gas-alpha policy, positive train and validation edge, lower train and validation drawdown than the index basket, and train/validation volatility under a 20% annualized risk budget.
- Index risk-off variants are diagnostic-only because they can create cash-flat equity shelves and are a portfolio overlay rather than a gas-alpha rule.
- Weather-resolution overlays use GFS/GEFS lead-1 to lead-3 forecasts available by the trade date, or target-day actual weather only when the target date is already before the trade date.
- Cold-follow storage gates use EIA Lower 48 working gas storage rows on or after the standard ${EIA_STORAGE_STANDARD_RELEASE_TIME_ET} Thursday release date, normally six calendar days after the Friday week-ending storage date. The seasonal drawdown is measured from the current withdrawal-season storage peak.
- Hold-period overlays only shorten parent-selected daily ledger holds for the selected graded vol-confirmed family; they do not create new weather signals, extend a parent hold, alter forecast thresholds, or use holdout rows for selection.
- Gas-overlay risk multipliers are predeclared sizing variants on the selected graded vol-confirmed family only; they do not change entry dates, directions, parent signals, or weather thresholds.
- Holdout was not used for selection: ${summary.search.selectionUsedHoldout ? 'no' : 'yes'}.
- Primary p-value: ${summary.validation.realityCheck.pValue} (${summary.validation.realityCheck.method}).
- Single-candidate p-value: ${summary.validation.realityCheck.singleCandidatePValue}.
- Selection-adjusted p-value: ${summary.validation.realityCheck.selectionAdjustedPValue ?? 'n/a'} across ${summary.validation.realityCheck.candidateFamilySize} eligible candidates.
- Observed active edge: ${summary.validation.realityCheck.observedAverageDailyEdgePct}% per day / ${summary.validation.realityCheck.observedAnnualizedEdgePct}% annualized.
- Mean daily-edge 90% bootstrap interval: ${summary.validation.realityCheck.meanConfidenceIntervalDailyEdgePct.p05}% to ${summary.validation.realityCheck.meanConfidenceIntervalDailyEdgePct.p95}%.
- Zero-edge null 90% interval: ${summary.validation.realityCheck.nullConfidenceIntervalDailyEdgePct.p05}% to ${summary.validation.realityCheck.nullConfidenceIntervalDailyEdgePct.p95}%.
- Bootstrap setup: ${summary.validation.realityCheck.iterations} iterations, ${summary.validation.realityCheck.blockLength}-session circular blocks, minimum resolvable p-value ${summary.validation.realityCheck.minimumResolvablePValue}.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | hold | storage gate | risk mult | rank | train edge | validation edge | holdout edge | full edge | Sharpe | maxDD |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${topCandidates
  .map(
    (candidate) =>
      `| ${candidate.candidateId} | ${candidate.eligible ? 'yes' : 'no'} | ${candidate.holdPeriodPolicy} | ${candidate.coldFollowStoragePolicy} | ${candidate.overlayRiskMultiplier}x | ${candidate.trainValidationRank} | ${candidate.trainEdgePct}% | ${candidate.validationEdgePct}% | ${candidate.holdoutEdgePct}% | ${candidate.allEdgePct}% | ${candidate.allSharpe} | ${candidate.allMaxDrawdownPct}% |`,
  )
  .join('\n')}

## Verdict

${winterAlphaVerdict(summary)}
`
}

function main() {
  const weatherSummary = JSON.parse(readText(path.join(WEATHER_HYBRID_DIR, 'run-summary.json')))
  const dualSummary = JSON.parse(readText(path.join(DUAL_WEATHER_DIR, 'run-summary.json')))
  const volatilitySummary = JSON.parse(readText(path.join(VOLATILITY_REVERSION_DIR, 'run-summary.json')))
  const weatherRows = parseCsv(path.join(WEATHER_HYBRID_DIR, 'selected-trades.csv'))
  const dualRows = parseCsv(path.join(DUAL_WEATHER_DIR, 'selected-trades.csv'))
  const volatilityRows = parseCsv(path.join(VOLATILITY_REVERSION_DIR, 'selected-trades.csv'))
  const indexMarketRows = parseCsv(INDEX_MARKET_FILE)
  const indexTrendRiskByDate = buildIndexTrendRiskMap(indexMarketRows)
  const weatherResolutionData = loadWeatherResolutionData()
  const storageData = loadStorageData()
  const policies = expandedBlendPolicies()
  const candidates = policies
    .map((policy) => summarizePolicy(policy, dualRows, weatherRows, volatilityRows, indexTrendRiskByDate, weatherResolutionData, storageData))
    .sort((a, b) => b.trainValidationRank - a.trainValidationRank)
  const selected = candidates.find((candidate) => candidate.eligible) ?? candidates[0]
  const realityCheck = blockBootstrapRealityCheck(selected.curve, candidates)
  const { headers, rows } = selectedTradeRows(selected.rows)
  const summary = {
    generatedAt: new Date().toISOString(),
    strategyId: STRATEGY_ID,
    data: {
      weatherHybridSummary: path.relative(REPO_ROOT, path.join(WEATHER_HYBRID_DIR, 'run-summary.json')),
      weatherHybridTrades: path.relative(REPO_ROOT, path.join(WEATHER_HYBRID_DIR, 'selected-trades.csv')),
      dualWeatherSummary: path.relative(REPO_ROOT, path.join(DUAL_WEATHER_DIR, 'run-summary.json')),
      dualWeatherTrades: path.relative(REPO_ROOT, path.join(DUAL_WEATHER_DIR, 'selected-trades.csv')),
      volatilityReversionSummary: path.relative(REPO_ROOT, path.join(VOLATILITY_REVERSION_DIR, 'run-summary.json')),
      volatilityReversionTrades: path.relative(REPO_ROOT, path.join(VOLATILITY_REVERSION_DIR, 'selected-trades.csv')),
      weatherResolutionInputs: weatherResolutionData.inputFiles,
      storageInputs: storageData.inputFiles,
      marketStartDate: selected.allMetrics.firstEntry,
      marketEndDate: selected.allMetrics.lastExit,
      marketDays: selected.rows.length,
    },
    contract: {
      trainEnd: TRAIN_END,
      validationEnd: VALIDATION_END,
      holdoutStart: HOLDOUT_START,
      roundTripCostPct: ROUND_TRIP_COST_PCT,
      oneWayCostPct: ONE_WAY_COST_PCT,
      fallback: 'Unallocated capital remains in US-INDEX-BASKET close-to-close.',
      signalTiming:
        'Parent strategies already enforce post-signal execution; NGAS Winter Alpha only combines parent daily ledgers and recalculates costs.',
      selectionPolicy:
        'Only predeclared parent-blend policies, parent daily-ledger hold overlays, cold-follow EIA storage-drawdown gates, and bounded gas-overlay risk multipliers are selected on train and validation. Generic idle-index risk-off variants are reported as diagnostics only, and holdout rows after 2025-11-01 are reported after selection.',
      overfitControl:
        'No holdout rows are used for selection. Parent candidates were selected by their own train/validation generators, and this layer only chooses a fixed blend policy plus one predeclared weather-resolution overlay, one predeclared parent daily-ledger hold overlay, one predeclared cold-follow storage-drawdown gate, and one bounded gas-overlay risk multiplier. Volatility Mean Reversion is used only as a predeclared same-direction fade confirmer while portfolio-level risk-off overlays stay diagnostic.',
      weatherResolutionTiming:
        'Weather-resolution overlays use GFS/GEFS lead-1 to lead-3 forecasts with issueDate <= entryTradeDate, or NASA POWER actual anomalies only when targetDate < entryTradeDate.',
      storageTiming:
        `Cold-follow storage gates use EIA Lower 48 working gas storage rows on or after the standard ${EIA_STORAGE_STANDARD_RELEASE_TIME_ET} Thursday release date, normally ${EIA_STORAGE_STANDARD_RELEASE_LAG_DAYS} calendar days after the Friday week-ending storage date; historical seasonal comparisons use only prior storage years.`,
      indexTrendLookbackSessions: INDEX_TREND_LOOKBACK_SESSIONS,
    },
    parents: {
      weatherHybrid: {
        strategyId: weatherSummary.strategyId,
        candidateId: weatherSummary.selected.candidateId,
        role: 'post-window overreaction fade expert',
      },
      dualWeather: {
        strategyId: dualSummary.strategyId,
        candidateId: dualSummary.selected.candidateId,
        role: 'cold-long and warm-short forecast-follow expert',
      },
      volatilityReversion: {
        strategyId: volatilitySummary.strategyId,
        candidateId: volatilitySummary.selected.candidateId,
        role: 'same-direction winter overreaction fade confirmer',
      },
    },
    selected: {
      ...selected,
      rows: undefined,
      curve: undefined,
    },
    candidates: candidates.map(formatCandidateRow),
    search: {
      candidateCount: candidates.length,
      eligibleCandidateCount: candidates.filter((candidate) => candidate.eligible).length,
      selectionUsedHoldout: false,
    },
    validation: {
      realityCheck,
    },
    outputFiles: {
      candidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'candidate-summary.csv')),
      selectedTrades: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-trades.csv')),
      report: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'report.md')),
    },
  }

  writeText(path.join(OUTPUT_DIR, 'candidate-summary.csv'), rowsToCsv(candidates.map(formatCandidateRow), Object.keys(formatCandidateRow(candidates[0]))))
  writeText(path.join(OUTPUT_DIR, 'selected-trades.csv'), rowsToCsv(rows, headers))
  writeText(path.join(OUTPUT_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_DIR, 'report.md'), buildReport(summary))

  console.log(
    [
      `Selected ${selected.candidateId}`,
      `return=${selected.allMetrics.totalReturnPct}%`,
      `edge=${selected.splitEdges.all}%`,
      `holdoutEdge=${selected.splitEdges.holdout}%`,
      `holdPolicy=${selected.holdPeriodPolicy.id}`,
      `storageGate=${selected.coldFollowStoragePolicy.id}`,
      `pValue=${realityCheck.pValue}`,
    ].join(' '),
  )
}

main()
