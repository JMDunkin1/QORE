import Papa from 'papaparse'
import { indexBasketSymbol } from '../execution'
import type { ExecutionInstrumentCode, StrategySignalIntent, TradeDirection } from '../execution'
import type { BacktestMetrics, EquityPoint } from '../types'
import ngasWinterAlphaSummaryJson from '../../data/qore/research/strategy-agent-runs/ngas-winter-alpha/run-summary.json?raw'
import ngasWinterAlphaTradesCsv from '../../data/qore/research/strategy-agent-runs/ngas-winter-alpha/selected-trades.csv?raw'
import ngasSummerAlphaSummaryJson from '../../data/qore/research/strategy-agent-runs/ngas-summer-alpha/run-summary.json?raw'
import ngasSummerAlphaTradesCsv from '../../data/qore/research/strategy-agent-runs/ngas-summer-alpha/selected-trades.csv?raw'
import ngasAllYearBetaSummaryJson from '../../data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json?raw'
import ngasAllYearBetaTradesCsv from '../../data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv?raw'

export type ArcticBlastStrategyFamily = 'weather-alpha' | 'weather-summer' | 'weather-all-year'
export type ArcticBlastStrategyVariant = 'winter-alpha' | 'summer-alpha' | 'all-year-beta'

export type StrategyPromotionStatus = 'research-diagnostic' | 'research-baseline' | 'paper-candidate' | 'needs-more-validation'

export type ArcticBlastStrategyMetrics = {
  totalReturnPct: number
  cagrPct: number
  sharpe: number
  sortino: number
  maxDrawdownPct: number
  winRatePct: number
  profitFactor: number
  tradeCount: number
  averageTradeReturnPct: number
  averageHoldDays: number
  firstEntry: string
  lastExit: string
}

export type ArcticBlastResearchStrategy = {
  id: string
  name: string
  family: ArcticBlastStrategyFamily
  variant: ArcticBlastStrategyVariant
  instrument: ExecutionInstrumentCode
  desk: string
  thesis: string
  directionPolicy: string
  promotionStatus: StrategyPromotionStatus
  riskLevel: 'Low' | 'Medium' | 'High'
  color: string
  liveRoutingEnabled: false
  sourceUniverse: string[]
  timingConvention: 'daily-weather-rotation-v1'
  returnColumn: 'returnPctEntryCloseToTarget' | 'netReturnPct'
  universe: string
  theoryAlignment: string
  samplePolicy: string
  tradeFile: string
  params: Record<string, unknown>
  metrics: ArcticBlastStrategyMetrics
  caveat: string
}

export type ArcticBlastSignalInput = {
  strategyId: string
  signalDate: string
  targetDate: string
  direction: TradeDirection
  confidence: number
  expectedReturnPct?: number
  indexFraction?: number
  gasPosition?: number
  cashFraction?: number
  maxHoldingDays?: number
  notes?: string[]
}

type HybridSummaryMetrics = {
  totalReturnPct: number
  cagrPct: number
  annualVolPct: number
  sharpe: number
  sortino: number
  maxDrawdownPct: number
  calmar: number
  winRatePct: number
  profitFactor: number
  tradeCount: number
  exposurePct: number
  turnover: number
  var95Pct: number
  cvar95Pct: number
  averageDailyPnlPct: number
  firstEntry: string
  lastExit: string
  averageHoldDays: number
}

type RealityCheckPercentiles = {
  p05: number
  p50: number
  p95: number
}

type RealityCheckSummary = {
  observedAverageDailyEdgePct: number
  pValue: number
  iterations: number
  blockLength: number
  method?: string
  comparison?: string
  alternative?: string
  singleCandidatePValue?: number
  selectionAdjustedPValue?: number | null
  observedAnnualizedEdgePct?: number
  dailyActiveVolPct?: number
  standardErrorDailyEdgePct?: number
  meanConfidenceIntervalDailyEdgePct?: RealityCheckPercentiles
  nullConfidenceIntervalDailyEdgePct?: RealityCheckPercentiles
  nullMaxMeanDailyEdgePct?: RealityCheckPercentiles | null
  candidateFamilySize?: number
  bestObservedCandidateId?: string | null
  bestObservedAverageDailyEdgePct?: number | null
  sampleCount?: number
  activeOverlayDays?: number
  minimumResolvablePValue?: number
  componentPValues?: Record<string, number>
}

type HybridSummary = {
  strategyId: string
  candidates?: Array<Record<string, unknown>>
  selected: {
    candidateId: string
    architectureLabel: string
    sourceSetLabel: string
    sourceIds: string[]
    minGroups: number
    minFamilies: number
    sizingMode: string
    anomalyThreshold: number
    coverageThreshold: number
    minConfidence: number
    weatherFraction: number
    reversionFraction: number
    followHoldDays: number
    reversionHoldDays: number
    minRealizedMovePct: number
    useFollowLeg: boolean
    useReversionLeg: boolean
    allMetrics: HybridSummaryMetrics
    trainMetrics: HybridSummaryMetrics
    validationMetrics: HybridSummaryMetrics
    holdoutMetrics: HybridSummaryMetrics
    splitEdges: {
      train: number
      validation: number
      holdout: number
      all: number
    }
    indexMetrics: {
      all: HybridSummaryMetrics
      train: HybridSummaryMetrics
      validation: HybridSummaryMetrics
      holdout: HybridSummaryMetrics
    }
  }
  contract: {
    trainEnd: string
    validationEnd: string
    holdoutStart: string
    roundTripCostPct: number
    fallback: string
    selectionPolicy: string
    signalTiming: string
    reversionTiming: string
    heatSignalFreshness?: string
  }
  data: {
    marketStartDate: string
    marketEndDate: string
  }
  outputFiles: {
    selectedTrades: string
  }
}

type DualWeatherSummary = HybridSummary & {
  selected: HybridSummary['selected'] & {
    sourceWeightMode: string
    volTargetPct: number
    freshHeatLookbackDays: number
    skippedHeatFollowSignals: number
    legCounts: Record<string, Record<string, number>>
  }
  search: {
    candidateCount: number
    eligibleCandidateCount: number
    selectionUsedHoldout: boolean
  }
  validation: {
    realityCheck: RealityCheckSummary
  }
}

type WinterAlphaSummary = {
  strategyId: string
  candidates?: Array<Record<string, unknown>>
  data: {
    marketStartDate: string
    marketEndDate: string
  }
  contract: {
    trainEnd: string
    validationEnd: string
    holdoutStart: string
    roundTripCostPct: number
    oneWayCostPct: number
    fallback: string
    signalTiming: string
    selectionPolicy: string
    overfitControl: string
    weatherResolutionTiming: string
    followFreshnessTiming?: string
    heatingDemandTiming?: string
    storageTiming?: string
    indexTrendLookbackSessions: number
  }
  inputs: {
    weatherReversion: {
      strategyId: string
      candidateId: string
      role: string
      tradeFile: string
    }
    weatherFollow: {
      strategyId: string
      candidateId: string
      role: string
      tradeFile: string
    }
    volatilityConfirmation: {
      strategyId: string
      candidateId: string
      role: string
      tradeFile: string
    }
  }
  selected: {
    candidateId: string
    architectureLabel: string
    sourceSetLabel: string
    sourceIds: string[]
    sourceWeightMode: string
    sizingMode: string
    weatherResolutionPolicy: {
      id: string
      label: string
      kind: string
      description: string
    }
    coldFollowStoragePolicy?: {
      id: string
      label: string
      kind: string
      description: string
      minSeasonDrawdownBcf?: number
      maxStorageVsSeasonalAverageBcf?: number
    }
    followFreshnessPolicy?: {
      id: string
      label: string
      kind: string
      description: string
      lookbackDays?: number
    }
    heatingDemandPolicy?: {
      id: string
      label: string
      kind: string
      description: string
      minDemandAnomalyF?: number
    }
    indexRiskMode: string
    indexRiskLabel: string
    indexTrendLookbackSessions: number | null
    weatherFraction: number
    reversionFraction: number
    reversionLongScale: number
    standaloneReversionScale: number
    overlayRiskMultiplier: number
    effectiveOverlayCap: number
    overlayCap: number
    followHoldDays: number
    reversionHoldDays: number
    minRealizedMovePct: number
    positionPolicy: string
    conflictPolicy: string
    requiredSideChecks: string[]
    allMetrics: HybridSummaryMetrics
    trainMetrics: HybridSummaryMetrics
    validationMetrics: HybridSummaryMetrics
    holdoutMetrics: HybridSummaryMetrics
    splitEdges: {
      train: number
      validation: number
      holdout: number
      all: number
    }
    indexMetrics: {
      all: HybridSummaryMetrics
      train: HybridSummaryMetrics
      validation: HybridSummaryMetrics
      holdout: HybridSummaryMetrics
    }
    sideReturns: Record<string, Record<string, HybridSummaryMetrics>>
    legCounts: Record<string, Record<string, number>>
  }
  search: {
    candidateCount: number
    eligibleCandidateCount: number
    selectionUsedHoldout: boolean
  }
  validation: {
    realityCheck: RealityCheckSummary
  }
  outputFiles: {
    selectedTrades: string
  }
}

type AllYearBetaSummary = {
  strategyId: string
  displayName: string
  candidates?: Array<Record<string, unknown>>
  data: {
    marketStartDate: string
    marketEndDate: string
  }
  contract: {
    fallback: string
    selectionPolicy: string
    signalTiming: string
    overfitControl: string
    maxDrawdownPromotionFloorPct: number
  }
  selected: {
    candidateId: string
    architectureLabel: string
    sourceSetLabel: string
    sourceIds: string[]
    componentStrategyIds: string[]
    sourceWeightMode: string
    sizingMode: string
    allMetrics: HybridSummaryMetrics
    trainMetrics: HybridSummaryMetrics
    validationMetrics: HybridSummaryMetrics
    holdoutMetrics: HybridSummaryMetrics
    indexMetrics: {
      all: HybridSummaryMetrics
      train: HybridSummaryMetrics
      validation: HybridSummaryMetrics
      holdout: HybridSummaryMetrics
    }
    splitEdges: {
      train: number
      validation: number
      holdout: number
      all: number
    }
    splitAnnualEdges: {
      train: number
      validation: number
      holdout: number
      all: number
    }
    rowSelectionPolicy: string
    materialRowDefinition: string
    componentTradeCounts: {
      summer: number
      winter: number
    }
    indexFallbackRows: number
    materialRows: number
    sourceUniverse: string[]
  }
  search: {
    candidateCount: number
    eligibleCandidateCount: number
    selectionUsedHoldout: boolean
  }
  validation: {
    realityCheck: RealityCheckSummary
    componentRealityChecks: Record<string, RealityCheckSummary>
  }
  outputFiles: {
    selectedTrades: string
  }
}

type SeasonalAlphaSplitContract = {
  trainEnd: string
  validationEnd: string
  holdoutStart: string
}

export type ArcticBlastTrade = {
  strategyId: string
  variant: ArcticBlastStrategyVariant
  issueDate: string
  targetDate: string
  entryTradeDate: string
  targetTradeDate: string
  sourceId: string
  windowId: 'rumor' | 'selloff' | string
  thesisKind: 'cold-long' | 'warm-short' | string
  leadDays: number
  direction: 'long' | 'short'
  weightedAnomalyF: number
  coveragePct: number
  coldCoveragePct: number
  warmCoveragePct: number
  extremeCount: number
  grossReturnPct: number
  netReturnPct: number
  rank: number
  confidence?: number
  drawdownPct?: number
  equity?: number
  equityPct?: number
  indexFraction?: number
  investedIndexFraction?: number
  cashFraction?: number
  indexRiskMode?: string
  indexRiskOn?: boolean
  indexReturnPct?: number
  ungPosition?: number
  ungReturnPct?: number
  tradingCostPct?: number
  componentThesisKinds?: string[]
  componentStrategyId?: string
  componentVariant?: ArcticBlastStrategyVariant
  weatherResolutionPolicy?: string
  weatherResolutionSource?: string
  weatherResolutionIssueDate?: string
  weatherResolutionSourceIds?: string[]
  weatherResolutionOriginalAnomalyF?: number
  weatherResolutionAnomalyF?: number
  weatherResolutionShiftF?: number
  weatherResolutionReliefF?: number
  weatherResolutionAction?: string
  weatherResolutionScale?: number
  coldFollowStoragePolicy?: string
  coldFollowStorageAction?: string
  coldFollowStorageMinSeasonDrawdownBcf?: number
  coldFollowStorageMaxStorageVsSeasonalAverageBcf?: number
  followFreshnessPolicy?: string
  followFreshnessAction?: string
  followFreshnessAgeDays?: number
  heatingDemandPolicy?: string
  heatingDemandAction?: string
  heatingDemandAnomalyF?: number
  heatingDemandScale?: number
  coldDemandCoveragePct?: number
  warmDemandCoveragePct?: number
  storageDate?: string
  storageBcf?: number
  storageSeasonPeakBcf?: number
  storageSeasonDrawdownBcf?: number
  storageSeasonalAverageBcf?: number
  storageVsSeasonalAverageBcf?: number
  storageSeasonalPercentile?: number
  storageWeeklyChangeBcf?: number
  storageWeeklyChangeVsSeasonalAverageBcf?: number
  overlayRiskMultiplier?: number
  effectiveOverlayCap?: number
}

export type ArcticBlastEquityPoint = EquityPoint & {
  gasReturnPct: number
  demandScore: number
  storageBcf: number
  closeScaled: number | null
  sourceId: string
  windowId: string
  netReturnPct: number
}

export type ArcticBlastResearchBacktestResult = {
  strategy: ArcticBlastResearchStrategy
  metrics: BacktestMetrics
  researchMetrics: ArcticBlastStrategyMetrics
  curve: ArcticBlastEquityPoint[]
  trades: ArcticBlastTrade[]
  joined: []
}

const initialCapital = 100000
const tradingDaysPerYear = 252
const allYearBetaStrategyId = 'ngas-all-year-beta'
const bootstrapPValuePromotionThreshold = 0.05
const allYearMaxDrawdownPromotionFloorPct = -20

const ngasWinterAlphaStrategyColor = '#d97706'
const summerWeatherStrategyColor = '#db2777'
const allYearBetaStrategyColor = '#0f766e'

export const arcticBlastPromotionGates = [
  'Keep all gas overlay entries strictly after the signal-date close.',
  'Select alpha candidates using train/validation data only; holdout rows stay report-only.',
  'Keep NGAS Winter Alpha weather and volatility inputs frozen inside its own lane, not active strategies.',
  'Keep NGAS Winter Alpha marked needs-more-validation unless the frozen-input blend clears holdout edge and a bootstrap p-value below 0.05.',
  'Keep NGAS Summer Alpha marked needs-more-validation unless both cooling-season sides clear holdout edge and a bootstrap p-value below 0.05.',
  'Let NGAS All-Year Beta use its own checked-in composite artifact, direct bootstrap p-value, and drawdown guard instead of inheriting component sleeve gates.',
  'Prove a non-overlapping paper ledger before any broker adapter exists.',
  'Separate ETF proxy results from futures-grade Henry Hub contract results.',
  'Require human approval for promotion from research-baseline to paper-candidate.',
]

function parseCsv<T extends Record<string, string>>(csv: string): T[] {
  return Papa.parse<T>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  }).data
}

function numberFrom(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values: number[]) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1))
}

function percentile(values: number[], pct: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct)))
  return sorted[index]
}

function daysBetween(startDate: string, endDate: string) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function riskLevelFor(metrics: ArcticBlastStrategyMetrics): ArcticBlastResearchStrategy['riskLevel'] {
  if (metrics.maxDrawdownPct <= -25) return 'High'
  if (metrics.maxDrawdownPct <= -12) return 'Medium'
  return 'Low'
}

function clearsBootstrapPromotionGate(pValue: number | undefined) {
  return typeof pValue === 'number' && Number.isFinite(pValue) && pValue < bootstrapPValuePromotionThreshold
}

function candidateDiagnosticsFromSummary(summary: {
  selected: { candidateId: string }
  search?: {
    candidateCount?: number
    eligibleCandidateCount?: number
    selectionUsedHoldout?: boolean
  }
  candidates?: Array<Record<string, unknown>>
}) {
  const candidates = summary.candidates ?? []
  return {
    selectedCandidateId: summary.selected.candidateId,
    candidateCount: summary.search?.candidateCount ?? candidates.length,
    eligibleCandidateCount:
      summary.search?.eligibleCandidateCount ??
      candidates.filter((candidate) => candidate.eligible === true || candidate.selectionEligible === true).length,
    selectionUsedHoldout: summary.search?.selectionUsedHoldout ?? false,
    candidates,
  }
}

function candidateDiagnosticsFromStrategies(strategies: ArcticBlastResearchStrategy[]) {
  const diagnostics = strategies
    .map((strategy) => ({
      strategy,
      diagnostic: strategy.params.candidateDiagnostics,
    }))
    .filter((entry): entry is {
      strategy: ArcticBlastResearchStrategy
      diagnostic: {
        selectedCandidateId?: string
        candidateCount?: number
        eligibleCandidateCount?: number
        selectionUsedHoldout?: boolean
        candidates?: Array<Record<string, unknown>>
      }
    } => Boolean(entry.diagnostic && typeof entry.diagnostic === 'object' && Array.isArray((entry.diagnostic as { candidates?: unknown }).candidates)))

  const candidates = diagnostics.flatMap(({ diagnostic, strategy }) =>
    (diagnostic.candidates ?? []).map((candidate) => ({
      ...candidate,
      componentValidationLane: strategy.name,
    })),
  )
  return {
    selectedCandidateIds: diagnostics.map(({ diagnostic }) => diagnostic.selectedCandidateId).filter(Boolean),
    candidateCount: diagnostics.reduce(
      (sum, { diagnostic }) => sum + (diagnostic.candidateCount ?? diagnostic.candidates?.length ?? 0),
      0,
    ),
    eligibleCandidateCount: diagnostics.reduce(
      (sum, { diagnostic }) =>
        sum +
        (diagnostic.eligibleCandidateCount ??
          diagnostic.candidates?.filter((candidate) => candidate.eligible === true || candidate.selectionEligible === true).length ??
          0),
      0,
    ),
    selectionUsedHoldout: diagnostics.some(({ diagnostic }) => diagnostic.selectionUsedHoldout),
    candidates,
  }
}

function parseWeatherRotationTrades(csv: string, variant: ArcticBlastStrategyVariant): ArcticBlastTrade[] {
  return parseCsv<Record<string, string>>(csv).map((row) => ({
    strategyId: row.strategyId,
    variant,
    issueDate: row.issueDate,
    targetDate: row.targetDate,
    entryTradeDate: row.entryTradeDate,
    targetTradeDate: row.targetTradeDate || row.exitTradeDate,
    sourceId: row.sourceId,
    windowId: row.windowId,
    thesisKind: row.thesisKind,
    leadDays: numberFrom(row.leadDays),
    direction: row.direction === 'short' ? 'short' : 'long',
    weightedAnomalyF: numberFrom(row.weightedAnomalyF),
    coveragePct: numberFrom(row.coveragePct),
    coldCoveragePct: numberFrom(row.coldCoveragePct),
    warmCoveragePct: numberFrom(row.warmCoveragePct),
    extremeCount: numberFrom(row.extremeCount),
    grossReturnPct: numberFrom(row.grossReturnPct),
    netReturnPct: numberFrom(row.netReturnPct),
    rank: numberFrom(row.rank),
    confidence: numberFrom(row.confidence),
    drawdownPct: numberFrom(row.drawdownPct),
    equity: numberFrom(row.equity),
    equityPct: numberFrom(row.equityPct),
    indexFraction: numberFrom(row.indexFraction),
    investedIndexFraction: numberFrom(row.investedIndexFraction),
    cashFraction: numberFrom(row.cashFraction),
    indexRiskMode: row.indexRiskMode,
    indexRiskOn: row.indexRiskOn === 'true',
    indexReturnPct: numberFrom(row.indexReturnPct),
    ungPosition: numberFrom(row.ungPosition),
    ungReturnPct: numberFrom(row.ungReturnPct),
    tradingCostPct: numberFrom(row.tradingCostPct),
    componentThesisKinds: row.componentThesisKinds ? row.componentThesisKinds.split('|').filter(Boolean) : [],
    componentStrategyId: row.componentStrategyId || undefined,
    componentVariant: row.componentVariant as ArcticBlastStrategyVariant | undefined,
    weatherResolutionPolicy: row.weatherResolutionPolicy || undefined,
    weatherResolutionSource: row.weatherResolutionSource || undefined,
    weatherResolutionIssueDate: row.weatherResolutionIssueDate || undefined,
    weatherResolutionSourceIds: row.weatherResolutionSourceIds ? row.weatherResolutionSourceIds.split('|').filter(Boolean) : [],
    weatherResolutionOriginalAnomalyF: row.weatherResolutionOriginalAnomalyF ? numberFrom(row.weatherResolutionOriginalAnomalyF) : undefined,
    weatherResolutionAnomalyF: row.weatherResolutionAnomalyF ? numberFrom(row.weatherResolutionAnomalyF) : undefined,
    weatherResolutionShiftF: row.weatherResolutionShiftF ? numberFrom(row.weatherResolutionShiftF) : undefined,
    weatherResolutionReliefF: row.weatherResolutionReliefF ? numberFrom(row.weatherResolutionReliefF) : undefined,
    weatherResolutionAction: row.weatherResolutionAction || undefined,
    weatherResolutionScale: row.weatherResolutionScale ? numberFrom(row.weatherResolutionScale) : undefined,
    coldFollowStoragePolicy: row.coldFollowStoragePolicy || undefined,
    coldFollowStorageAction: row.coldFollowStorageAction || undefined,
    coldFollowStorageMinSeasonDrawdownBcf: row.coldFollowStorageMinSeasonDrawdownBcf
      ? numberFrom(row.coldFollowStorageMinSeasonDrawdownBcf)
      : undefined,
    coldFollowStorageMaxStorageVsSeasonalAverageBcf: row.coldFollowStorageMaxStorageVsSeasonalAverageBcf
      ? numberFrom(row.coldFollowStorageMaxStorageVsSeasonalAverageBcf)
      : undefined,
    followFreshnessPolicy: row.followFreshnessPolicy || undefined,
    followFreshnessAction: row.followFreshnessAction || undefined,
    followFreshnessAgeDays: row.followFreshnessAgeDays ? numberFrom(row.followFreshnessAgeDays) : undefined,
    heatingDemandPolicy: row.heatingDemandPolicy || undefined,
    heatingDemandAction: row.heatingDemandAction || undefined,
    heatingDemandAnomalyF: row.heatingDemandAnomalyF ? numberFrom(row.heatingDemandAnomalyF) : undefined,
    heatingDemandScale: row.heatingDemandScale ? numberFrom(row.heatingDemandScale) : undefined,
    coldDemandCoveragePct: row.coldDemandCoveragePct ? numberFrom(row.coldDemandCoveragePct) : undefined,
    warmDemandCoveragePct: row.warmDemandCoveragePct ? numberFrom(row.warmDemandCoveragePct) : undefined,
    storageDate: row.storageDate || undefined,
    storageBcf: row.storageBcf ? numberFrom(row.storageBcf) : undefined,
    storageSeasonPeakBcf: row.storageSeasonPeakBcf ? numberFrom(row.storageSeasonPeakBcf) : undefined,
    storageSeasonDrawdownBcf: row.storageSeasonDrawdownBcf ? numberFrom(row.storageSeasonDrawdownBcf) : undefined,
    storageSeasonalAverageBcf: row.storageSeasonalAverageBcf ? numberFrom(row.storageSeasonalAverageBcf) : undefined,
    storageVsSeasonalAverageBcf: row.storageVsSeasonalAverageBcf ? numberFrom(row.storageVsSeasonalAverageBcf) : undefined,
    storageSeasonalPercentile: row.storageSeasonalPercentile ? numberFrom(row.storageSeasonalPercentile) : undefined,
    storageWeeklyChangeBcf: row.storageWeeklyChangeBcf ? numberFrom(row.storageWeeklyChangeBcf) : undefined,
    storageWeeklyChangeVsSeasonalAverageBcf: row.storageWeeklyChangeVsSeasonalAverageBcf
      ? numberFrom(row.storageWeeklyChangeVsSeasonalAverageBcf)
      : undefined,
    overlayRiskMultiplier: row.overlayRiskMultiplier ? numberFrom(row.overlayRiskMultiplier) : undefined,
    effectiveOverlayCap: row.effectiveOverlayCap ? numberFrom(row.effectiveOverlayCap) : undefined,
  }))
}

function sourceUniverseFor(trades: ArcticBlastTrade[]) {
  return [...new Set(trades.map((trade) => trade.sourceId))].sort()
}

function createHybridMetrics(summary: { selected: { allMetrics: HybridSummaryMetrics } }): ArcticBlastStrategyMetrics {
  const metrics = summary.selected.allMetrics
  return {
    totalReturnPct: metrics.totalReturnPct,
    cagrPct: metrics.cagrPct,
    sharpe: metrics.sharpe,
    sortino: metrics.sortino,
    maxDrawdownPct: metrics.maxDrawdownPct,
    winRatePct: metrics.winRatePct,
    profitFactor: metrics.profitFactor,
    tradeCount: metrics.tradeCount,
    averageTradeReturnPct: metrics.averageDailyPnlPct,
    averageHoldDays: metrics.averageHoldDays,
    firstEntry: metrics.firstEntry,
    lastExit: metrics.lastExit,
  }
}

function createHybridBacktestMetrics(summary: { selected: { allMetrics: HybridSummaryMetrics } }): BacktestMetrics {
  const metrics = summary.selected.allMetrics
  return {
    totalReturnPct: metrics.totalReturnPct,
    cagrPct: metrics.cagrPct,
    annualVolPct: metrics.annualVolPct,
    sharpe: metrics.sharpe,
    sortino: metrics.sortino,
    maxDrawdownPct: metrics.maxDrawdownPct,
    calmar: metrics.calmar,
    winRatePct: metrics.winRatePct,
    profitFactor: metrics.profitFactor,
    tradeCount: metrics.tradeCount,
    exposurePct: metrics.exposurePct,
    turnover: metrics.turnover,
    var95Pct: metrics.var95Pct,
    cvar95Pct: metrics.cvar95Pct,
    averageDailyPnlPct: metrics.averageDailyPnlPct,
  }
}

function createNgasSummerAlphaStrategy(summary: DualWeatherSummary, trades: ArcticBlastTrade[]): ArcticBlastResearchStrategy {
  const metrics = createHybridMetrics(summary)
  const { selected, contract } = summary
  const holdoutEdge = selected.splitEdges.holdout
  const realityCheckPValue = summary.validation.realityCheck.pValue
  const hasCoolSideEvidence = selected.legCounts.trainValidation.summerColdShort >= 4 && selected.legCounts.holdout.summerColdShort >= 2
  const promotionStatus: StrategyPromotionStatus =
    holdoutEdge > 0 && clearsBootstrapPromotionGate(realityCheckPValue) && hasCoolSideEvidence ? 'research-baseline' : 'needs-more-validation'

  return {
    id: summary.strategyId,
    name: 'NGAS Summer Alpha',
    family: 'weather-summer',
    variant: 'summer-alpha',
    instrument: 'NG',
    desk: 'Summer natural gas futures heat edge',
    thesis:
      'Capital stays in the US index basket by default, then uses fresh multi-model day-7 summer heat forecasts to add NG futures exposure and fade repeated same-direction weather overreactions.',
    directionPolicy:
      'Follow the first confirmed broad summer heat signal with a long NG futures overlay, skip clustered heat-follow longs, then short same-direction gas rallies after the observation window. Cool-short remains diagnostic until enough validated cool events exist.',
    promotionStatus,
    riskLevel: riskLevelFor(metrics),
    color: summerWeatherStrategyColor,
    liveRoutingEnabled: false,
    sourceUniverse: sourceUniverseFor(trades),
    timingConvention: 'daily-weather-rotation-v1',
    returnColumn: 'netReturnPct',
    universe: `NG futures and US index basket daily bars from ${summary.data.marketStartDate} through ${summary.data.marketEndDate}.`,
    theoryAlignment:
      'Direct summer cooling-demand lane: fresh multi-model heat demand direction plus same-direction post-window overreaction fade, with index fallback when confidence is low. Cool-short evidence is retained as diagnostic.',
    samplePolicy:
      `Selected ${selected.architectureLabel} on train/validation only; train through ${contract.trainEnd}, validation through ${contract.validationEnd}, holdout from ${contract.holdoutStart}.`,
    tradeFile: summary.outputFiles.selectedTrades,
    params: {
      candidateId: selected.candidateId,
      family: 'weather-summer',
      variant: 'summer-alpha',
      architecture: selected.architectureLabel,
      sourceSet: selected.sourceSetLabel,
      sourceIds: selected.sourceIds,
      sourceWeightMode: selected.sourceWeightMode,
      minGroups: selected.minGroups,
      minFamilies: selected.minFamilies,
      anomalyThreshold: selected.anomalyThreshold,
      coverageThreshold: selected.coverageThreshold,
      minConfidence: selected.minConfidence,
      weatherFraction: selected.weatherFraction,
      reversionFraction: selected.reversionFraction,
      followHoldDays: selected.followHoldDays,
      reversionHoldDays: selected.reversionHoldDays,
      minRealizedMovePct: selected.minRealizedMovePct,
      freshHeatLookbackDays: selected.freshHeatLookbackDays,
      skippedHeatFollowSignals: selected.skippedHeatFollowSignals,
      sizingMode: selected.sizingMode,
      volTargetPct: selected.volTargetPct,
      fallback: contract.fallback,
      roundTripCostPct: contract.roundTripCostPct,
      splitEdges: selected.splitEdges,
      splitAnnualEdges: splitAnnualEdgesFromSelectedMetrics(selected),
      legCounts: selected.legCounts,
      indexMetrics: selected.indexMetrics,
      search: summary.search,
      candidateDiagnostics: candidateDiagnosticsFromSummary(summary),
      realityCheck: summary.validation.realityCheck,
      selectionPolicy: contract.selectionPolicy,
      signalTiming: contract.signalTiming,
      reversionTiming: contract.reversionTiming,
      heatSignalFreshness: contract.heatSignalFreshness,
      sourceUniverse: sourceUniverseFor(trades),
    },
    metrics,
    caveat:
      holdoutEdge > 0 && hasCoolSideEvidence
        ? `Holdout edge versus the index basket is ${signedSplitEdge(holdoutEdge)}; bootstrap p-value ${realityCheckPValue}.`
        : `Needs more validation: heat-follow and same-direction fade improved the summer lane with holdout edge ${signedSplitEdge(holdoutEdge)}, but cool-short evidence is still diagnostic and bootstrap p-value is ${realityCheckPValue}.`,
  }
}

function createNgasWinterAlphaStrategy(summary: WinterAlphaSummary, trades: ArcticBlastTrade[]): ArcticBlastResearchStrategy {
  const metrics = createHybridMetrics(summary)
  const { selected, contract } = summary
  const holdoutEdge = selected.splitEdges.holdout
  const realityCheckPValue = summary.validation.realityCheck.pValue
  const promotionStatus: StrategyPromotionStatus =
    holdoutEdge > 0 && clearsBootstrapPromotionGate(realityCheckPValue) ? 'research-baseline' : 'needs-more-validation'

  return {
    id: summary.strategyId,
    name: 'NGAS Winter Alpha',
    family: 'weather-alpha',
    variant: 'winter-alpha',
    instrument: 'UNG',
    desk: 'Winter natural gas alpha blend',
    thesis:
      'Blend frozen Winter Alpha inputs conservatively: embedded weather-follow rows supply cold-follow and warm-short context, embedded weather-reversion rows supply post-window fades, volatility confirmation checks long fades, close-in weather resolution sizes reversion exposure, freshness and HDD demand overlays can filter repeated or weak follow rows, EIA storage gates can block premature cold-follow longs, and idle capital remains in the index fallback.',
    directionPolicy:
      `${selected.positionPolicy} Idle capital uses ${selected.indexRiskLabel.toLowerCase()}.`,
    promotionStatus,
    riskLevel: riskLevelFor(metrics),
    color: ngasWinterAlphaStrategyColor,
    liveRoutingEnabled: false,
    sourceUniverse: sourceUniverseFor(trades),
    timingConvention: 'daily-weather-rotation-v1',
    returnColumn: 'netReturnPct',
    universe: `UNG and US index basket daily bars from ${summary.data.marketStartDate} through ${summary.data.marketEndDate}.`,
    theoryAlignment:
      'Frozen-input blend of winter forecast-follow demand risk, same-direction weather fades, volatility-confirmed long-fade sizing, non-lookahead close-in or already-known actual weather-resolution sizing, follow-freshness gating, HDD demand confirmation, and EIA storage context.',
    samplePolicy:
      `${selected.architectureLabel}; train through ${contract.trainEnd}, validation through ${contract.validationEnd}, holdout from ${contract.holdoutStart}. ${contract.overfitControl}`,
    tradeFile: summary.outputFiles.selectedTrades,
    params: {
      candidateId: selected.candidateId,
      family: 'weather-alpha',
      variant: 'winter-alpha',
      architecture: selected.architectureLabel,
      sourceSet: selected.sourceSetLabel,
      sourceIds: selected.sourceIds,
      sourceWeightMode: selected.sourceWeightMode,
      sizingMode: selected.sizingMode,
      weatherResolutionPolicy: selected.weatherResolutionPolicy,
      coldFollowStoragePolicy: selected.coldFollowStoragePolicy,
      followFreshnessPolicy: selected.followFreshnessPolicy,
      heatingDemandPolicy: selected.heatingDemandPolicy,
      indexRiskMode: selected.indexRiskMode,
      indexRiskLabel: selected.indexRiskLabel,
      indexTrendLookbackSessions: selected.indexTrendLookbackSessions,
      weatherFraction: selected.weatherFraction,
      reversionFraction: selected.reversionFraction,
      reversionLongScale: selected.reversionLongScale,
      standaloneReversionScale: selected.standaloneReversionScale,
      overlayRiskMultiplier: selected.overlayRiskMultiplier,
      effectiveOverlayCap: selected.effectiveOverlayCap,
      overlayCap: selected.overlayCap,
      followHoldDays: selected.followHoldDays,
      reversionHoldDays: selected.reversionHoldDays,
      minRealizedMovePct: selected.minRealizedMovePct,
      positionPolicy: selected.positionPolicy,
      conflictPolicy: selected.conflictPolicy,
      requiredSideChecks: selected.requiredSideChecks,
      inputs: summary.inputs,
      fallback: contract.fallback,
      roundTripCostPct: contract.roundTripCostPct,
      oneWayCostPct: contract.oneWayCostPct,
      splitEdges: selected.splitEdges,
      splitAnnualEdges: splitAnnualEdgesFromSelectedMetrics(selected),
      sideReturns: selected.sideReturns,
      legCounts: selected.legCounts,
      indexMetrics: selected.indexMetrics,
      search: summary.search,
      candidateDiagnostics: candidateDiagnosticsFromSummary(summary),
      realityCheck: summary.validation.realityCheck,
      selectionPolicy: contract.selectionPolicy,
      signalTiming: contract.signalTiming,
      weatherResolutionTiming: contract.weatherResolutionTiming,
      followFreshnessTiming: contract.followFreshnessTiming,
      heatingDemandTiming: contract.heatingDemandTiming,
      storageTiming: contract.storageTiming,
      sourceUniverse: sourceUniverseFor(trades),
    },
    metrics,
    caveat:
      holdoutEdge > 0
        ? `Holdout edge versus the index basket is ${signedSplitEdge(holdoutEdge)}; primary bootstrap p-value is ${realityCheckPValue}. Keep this behind paper validation.`
        : `Needs more validation: train/validation edge is strong, but holdout edge versus the index basket is ${signedSplitEdge(holdoutEdge)} and bootstrap p-value is ${realityCheckPValue}.`,
  }
}

function tradePosition(trade: ArcticBlastTrade) {
  if (Number.isFinite(trade.ungPosition)) return trade.ungPosition ?? 0
  if (trade.thesisKind === 'index-fallback') return 0
  return trade.direction === 'short' ? -1 : 1
}

function isMaterialStrategyRow(trade: ArcticBlastTrade) {
  return (
    trade.thesisKind !== 'index-fallback' ||
    Math.abs(trade.tradingCostPct ?? 0) > 0.000001 ||
    Math.abs(tradePosition(trade)) > 0.000001
  )
}

function dailyTradesByEntryDate(trades: ArcticBlastTrade[], label: string) {
  const byDate = new Map<string, ArcticBlastTrade>()
  trades.forEach((trade) => {
    if (byDate.has(trade.entryTradeDate)) {
      throw new Error(`${label} has multiple rows for ${trade.entryTradeDate}; NGAS All-Year Beta expects one daily row per source lane.`)
    }
    byDate.set(trade.entryTradeDate, trade)
  })
  return byDate
}

function createCompositeTrade(trade: ArcticBlastTrade): ArcticBlastTrade {
  const compositeTrade: ArcticBlastTrade = {
    ...trade,
    strategyId: allYearBetaStrategyId,
    variant: 'all-year-beta',
    componentStrategyId: trade.strategyId,
    componentVariant: trade.variant,
  }
  delete compositeTrade.equity
  delete compositeTrade.equityPct
  delete compositeTrade.drawdownPct
  return compositeTrade
}

function combineAllYearBetaTrades(summerTrades: ArcticBlastTrade[], winterTrades: ArcticBlastTrade[]) {
  const summerByDate = dailyTradesByEntryDate(summerTrades, 'NGAS Summer Alpha')
  const winterByDate = dailyTradesByEntryDate(winterTrades, 'NGAS Winter Alpha')
  const entryDates = [...new Set([...summerByDate.keys(), ...winterByDate.keys()])].sort()

  return entryDates.map((entryDate) => {
    const summerTrade = summerByDate.get(entryDate)
    const winterTrade = winterByDate.get(entryDate)
    const summerIsMaterial = summerTrade ? isMaterialStrategyRow(summerTrade) : false
    const winterIsMaterial = winterTrade ? isMaterialStrategyRow(winterTrade) : false

    if (summerTrade && winterTrade && summerIsMaterial && winterIsMaterial) {
      throw new Error(`NGAS All-Year Beta conflict on ${entryDate}: both summer and winter lanes have material rows.`)
    }
    if (
      summerTrade &&
      winterTrade &&
      !summerIsMaterial &&
      !winterIsMaterial &&
      Math.abs(summerTrade.netReturnPct - winterTrade.netReturnPct) > 0.0001
    ) {
      throw new Error(`NGAS All-Year Beta fallback mismatch on ${entryDate}; refusing to pick between different idle rows.`)
    }

    const selectedTrade = summerIsMaterial ? summerTrade : winterIsMaterial ? winterTrade : summerTrade ?? winterTrade
    if (!selectedTrade) throw new Error(`NGAS All-Year Beta missing source row for ${entryDate}.`)
    return createCompositeTrade(selectedTrade)
  })
}

function assertClose(label: string, actual: number | undefined, expected: number | undefined, tolerance = 0.0001) {
  const actualValue = actual ?? 0
  const expectedValue = expected ?? 0
  if (Math.abs(actualValue - expectedValue) > tolerance) {
    throw new Error(`${label} drifted: expected ${expectedValue}, got ${actualValue}.`)
  }
}

function assertEqual(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${label} drifted: expected ${String(expected)}, got ${String(actual)}.`)
}

function assertSplitMetrics(
  label: string,
  actual: { train: number; validation: number; holdout: number; all: number },
  expected: { train: number; validation: number; holdout: number; all: number },
) {
  assertClose(`${label}.train`, actual.train, expected.train, 0.01)
  assertClose(`${label}.validation`, actual.validation, expected.validation, 0.01)
  assertClose(`${label}.holdout`, actual.holdout, expected.holdout, 0.01)
  assertClose(`${label}.all`, actual.all, expected.all, 0.01)
}

function assertAllYearBetaArtifact(
  artifactTrades: ArcticBlastTrade[],
  expectedTrades: ArcticBlastTrade[],
  summary: AllYearBetaSummary,
  contractsByStrategyId: Map<string, SeasonalAlphaSplitContract>,
) {
  assertEqual('NGAS All-Year Beta row count', artifactTrades.length, expectedTrades.length)

  const textFields = [
    'entryTradeDate',
    'targetTradeDate',
    'sourceId',
    'windowId',
    'thesisKind',
    'direction',
    'strategyId',
    'variant',
    'componentStrategyId',
    'componentVariant',
  ] as const
  const numberFields = [
    'leadDays',
    'weightedAnomalyF',
    'coveragePct',
    'grossReturnPct',
    'netReturnPct',
    'indexReturnPct',
    'ungPosition',
    'tradingCostPct',
  ] as const

  artifactTrades.forEach((artifactTrade, index) => {
    const expectedTrade = expectedTrades[index]
    if (!expectedTrade) throw new Error(`NGAS All-Year Beta artifact has unexpected row ${index}.`)

    textFields.forEach((field) => {
      assertEqual(`NGAS All-Year Beta ${field} row ${index}`, artifactTrade[field] ?? '', expectedTrade[field] ?? '')
    })
    numberFields.forEach((field) => {
      assertClose(`NGAS All-Year Beta ${field} row ${index}`, artifactTrade[field] ?? 0, expectedTrade[field] ?? 0, 0.0001)
    })
  })

  const metrics = dailyBacktestMetricsFromTrades(artifactTrades)
  const expectedMetrics = summary.selected.allMetrics
  assertClose('NGAS All-Year Beta totalReturnPct', metrics.totalReturnPct, expectedMetrics.totalReturnPct, 0.01)
  assertClose('NGAS All-Year Beta cagrPct', metrics.cagrPct, expectedMetrics.cagrPct, 0.01)
  assertClose('NGAS All-Year Beta annualVolPct', metrics.annualVolPct, expectedMetrics.annualVolPct, 0.01)
  assertClose('NGAS All-Year Beta sharpe', metrics.sharpe, expectedMetrics.sharpe, 0.01)
  assertClose('NGAS All-Year Beta sortino', metrics.sortino, expectedMetrics.sortino, 0.01)
  assertClose('NGAS All-Year Beta maxDrawdownPct', metrics.maxDrawdownPct, expectedMetrics.maxDrawdownPct, 0.01)
  assertClose('NGAS All-Year Beta winRatePct', metrics.winRatePct, expectedMetrics.winRatePct, 0.1)
  assertClose('NGAS All-Year Beta profitFactor', metrics.profitFactor, expectedMetrics.profitFactor, 0.01)
  assertClose('NGAS All-Year Beta tradeCount', metrics.tradeCount, expectedMetrics.tradeCount, 0.01)
  assertClose('NGAS All-Year Beta exposurePct', metrics.exposurePct, expectedMetrics.exposurePct, 0.1)
  assertClose('NGAS All-Year Beta turnover', metrics.turnover, expectedMetrics.turnover, 0.01)
  assertClose('NGAS All-Year Beta var95Pct', metrics.var95Pct, expectedMetrics.var95Pct, 0.01)
  assertClose('NGAS All-Year Beta cvar95Pct', metrics.cvar95Pct, expectedMetrics.cvar95Pct, 0.01)
  assertClose('NGAS All-Year Beta averageDailyPnlPct', metrics.averageDailyPnlPct, expectedMetrics.averageDailyPnlPct, 0.001)

  assertSplitMetrics('NGAS All-Year Beta splitEdges', splitEdgesFromTrades(artifactTrades, contractsByStrategyId), summary.selected.splitEdges)
  assertSplitMetrics(
    'NGAS All-Year Beta splitAnnualEdges',
    splitAnnualEdgesFromTrades(artifactTrades, contractsByStrategyId),
    summary.selected.splitAnnualEdges,
  )
}

function compoundReturnPct(trades: ArcticBlastTrade[], returnKey: 'netReturnPct' | 'indexReturnPct') {
  const total = trades.reduce((equity, trade) => equity * (1 + (trade[returnKey] ?? 0) / 100), 1)
  return round((total - 1) * 100, 2)
}

function annualizedCompoundReturnPct(trades: ArcticBlastTrade[], returnKey: 'netReturnPct' | 'indexReturnPct') {
  const orderedTrades = [...trades].sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate) || a.targetTradeDate.localeCompare(b.targetTradeDate))
  const total = orderedTrades.reduce((equity, trade) => equity * (1 + (trade[returnKey] ?? 0) / 100), 1)
  const firstEntry = orderedTrades[0]?.entryTradeDate ?? ''
  const lastExit = orderedTrades.at(-1)?.targetTradeDate ?? orderedTrades.at(-1)?.entryTradeDate ?? firstEntry
  const years = firstEntry && lastExit ? daysBetween(firstEntry, lastExit) / 365.25 : 1
  return round((total ** (1 / Math.max(years, 1 / 365.25)) - 1) * 100, 2)
}

function profitFactor(returns: number[]) {
  const grossWins = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const grossLosses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  if (!grossLosses) return grossWins ? Number.POSITIVE_INFINITY : 0
  return grossWins / grossLosses
}

function dailyBacktestMetricsFromTrades(trades: ArcticBlastTrade[]): BacktestMetrics {
  const orderedTrades = [...trades].sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate) || a.targetTradeDate.localeCompare(b.targetTradeDate))
  const returns = orderedTrades.map((trade) => trade.netReturnPct / 100)
  const negativeReturns = returns.filter((value) => value < 0)
  const firstEntry = orderedTrades[0]?.entryTradeDate ?? ''
  const lastExit = orderedTrades.at(-1)?.targetTradeDate ?? orderedTrades.at(-1)?.entryTradeDate ?? firstEntry
  const years = firstEntry && lastExit ? daysBetween(firstEntry, lastExit) / 365.25 : 1
  let equity = 1
  let peak = 1
  let maxDrawdownPct = 0

  returns.forEach((dailyReturn) => {
    equity = Math.max(0.000001, equity * (1 + dailyReturn))
    peak = Math.max(peak, equity)
    maxDrawdownPct = Math.min(maxDrawdownPct, ((equity - peak) / peak) * 100)
  })

  const totalReturnPct = round((equity - 1) * 100, 2)
  const cagrPct = round((equity ** (1 / Math.max(years, 1 / 365.25)) - 1) * 100, 2)
  const annualVol = std(returns) * Math.sqrt(tradingDaysPerYear)
  const downsideVol = std(negativeReturns) * Math.sqrt(tradingDaysPerYear)
  const averageDailyReturn = mean(returns)
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)
  const activeTradeCount = orderedTrades.filter((trade) => trade.thesisKind !== 'index-fallback').length

  return {
    totalReturnPct,
    cagrPct,
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (averageDailyReturn * tradingDaysPerYear) / annualVol : 0, 2),
    sortino: round(downsideVol ? (averageDailyReturn * tradingDaysPerYear) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    calmar: round(Math.abs(maxDrawdownPct) ? cagrPct / Math.abs(maxDrawdownPct) : 0, 2),
    winRatePct: round(returns.length ? (returns.filter((value) => value > 0).length / returns.length) * 100 : 0, 1),
    profitFactor: round(profitFactor(returns), 2),
    tradeCount: activeTradeCount,
    exposurePct: round(mean(orderedTrades.map((trade) => Math.abs(tradePosition(trade)))) * 100, 1),
    turnover: round(
      orderedTrades.reduce((sum, trade, index) => sum + Math.abs(tradePosition(trade) - tradePosition(orderedTrades[index - 1] ?? ({ thesisKind: 'index-fallback' } as ArcticBlastTrade))), 0),
      2,
    ),
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(averageDailyReturn * 100, 3),
  }
}

function splitNameForTrade(trade: ArcticBlastTrade, contractsByStrategyId: Map<string, SeasonalAlphaSplitContract>) {
  const sourceStrategyId = trade.componentStrategyId ?? trade.strategyId
  const contract = contractsByStrategyId.get(sourceStrategyId)
  if (!contract) return 'all'
  if (trade.entryTradeDate >= contract.holdoutStart) return 'holdout'
  if (trade.entryTradeDate > contract.trainEnd && trade.entryTradeDate <= contract.validationEnd) return 'validation'
  return 'train'
}

function splitEdgesFromTrades(
  trades: ArcticBlastTrade[],
  contractsByStrategyId: Map<string, SeasonalAlphaSplitContract>,
) {
  const splits = {
    train: [] as ArcticBlastTrade[],
    validation: [] as ArcticBlastTrade[],
    holdout: [] as ArcticBlastTrade[],
    all: trades,
  }
  trades.forEach((trade) => {
    const split = splitNameForTrade(trade, contractsByStrategyId)
    if (split !== 'all') splits[split].push(trade)
  })
  return {
    train: round(compoundReturnPct(splits.train, 'netReturnPct') - compoundReturnPct(splits.train, 'indexReturnPct'), 2),
    validation: round(compoundReturnPct(splits.validation, 'netReturnPct') - compoundReturnPct(splits.validation, 'indexReturnPct'), 2),
    holdout: round(compoundReturnPct(splits.holdout, 'netReturnPct') - compoundReturnPct(splits.holdout, 'indexReturnPct'), 2),
    all: round(compoundReturnPct(splits.all, 'netReturnPct') - compoundReturnPct(splits.all, 'indexReturnPct'), 2),
  }
}

function splitAnnualEdgesFromTrades(
  trades: ArcticBlastTrade[],
  contractsByStrategyId: Map<string, SeasonalAlphaSplitContract>,
) {
  const splits = {
    train: [] as ArcticBlastTrade[],
    validation: [] as ArcticBlastTrade[],
    holdout: [] as ArcticBlastTrade[],
    all: trades,
  }
  trades.forEach((trade) => {
    const split = splitNameForTrade(trade, contractsByStrategyId)
    if (split !== 'all') splits[split].push(trade)
  })
  return {
    train: round(annualizedCompoundReturnPct(splits.train, 'netReturnPct') - annualizedCompoundReturnPct(splits.train, 'indexReturnPct'), 2),
    validation: round(annualizedCompoundReturnPct(splits.validation, 'netReturnPct') - annualizedCompoundReturnPct(splits.validation, 'indexReturnPct'), 2),
    holdout: round(annualizedCompoundReturnPct(splits.holdout, 'netReturnPct') - annualizedCompoundReturnPct(splits.holdout, 'indexReturnPct'), 2),
    all: round(annualizedCompoundReturnPct(splits.all, 'netReturnPct') - annualizedCompoundReturnPct(splits.all, 'indexReturnPct'), 2),
  }
}

function splitAnnualEdgesFromSelectedMetrics(selected: {
  allMetrics: HybridSummaryMetrics
  trainMetrics: HybridSummaryMetrics
  validationMetrics: HybridSummaryMetrics
  holdoutMetrics: HybridSummaryMetrics
  indexMetrics: {
    all: HybridSummaryMetrics
    train: HybridSummaryMetrics
    validation: HybridSummaryMetrics
    holdout: HybridSummaryMetrics
  }
}) {
  return {
    train: round(selected.trainMetrics.cagrPct - selected.indexMetrics.train.cagrPct, 2),
    validation: round(selected.validationMetrics.cagrPct - selected.indexMetrics.validation.cagrPct, 2),
    holdout: round(selected.holdoutMetrics.cagrPct - selected.indexMetrics.holdout.cagrPct, 2),
    all: round(selected.allMetrics.cagrPct - selected.indexMetrics.all.cagrPct, 2),
  }
}

function createNgasAllYearBetaStrategy(
  summary: AllYearBetaSummary,
  trades: ArcticBlastTrade[],
  sourceStrategies: ArcticBlastResearchStrategy[],
): ArcticBlastResearchStrategy {
  const metrics = createHybridMetrics(summary)
  const { selected, contract } = summary
  const realityCheck = summary.validation.realityCheck
  const drawdownPromotionFloorPct = Number.isFinite(contract.maxDrawdownPromotionFloorPct)
    ? contract.maxDrawdownPromotionFloorPct
    : allYearMaxDrawdownPromotionFloorPct
  const promotionStatus: StrategyPromotionStatus =
    selected.splitEdges.holdout > 0 &&
    clearsBootstrapPromotionGate(realityCheck?.pValue) &&
    metrics.maxDrawdownPct > drawdownPromotionFloorPct
      ? 'research-baseline'
      : 'needs-more-validation'

  return {
    id: summary.strategyId,
    name: summary.displayName,
    family: 'weather-all-year',
    variant: 'all-year-beta',
    instrument: 'NG',
    desk: 'All-year natural gas beta artifact',
    thesis:
      'Checked-in all-year artifact of the existing NGAS Summer Alpha and NGAS Winter Alpha ledgers: use the exact source-lane row when that lane has an active or cost-bearing gas row, otherwise use the single shared US index basket fallback row.',
    directionPolicy:
      'No independent signal rules: Summer Alpha owns summer heat and fade rows, Winter Alpha owns cold, warm, and winter fade rows, and the loader fails if both source lanes ever produce material rows on the same date.',
    promotionStatus,
    riskLevel: riskLevelFor(metrics),
    color: allYearBetaStrategyColor,
    liveRoutingEnabled: false,
    sourceUniverse: selected.sourceUniverse ?? sourceUniverseFor(trades),
    timingConvention: 'daily-weather-rotation-v1',
    returnColumn: 'netReturnPct',
    universe: `NGAS source ledgers and US index basket daily bars from ${summary.data.marketStartDate} through ${summary.data.marketEndDate}.`,
    theoryAlignment:
      'No new alpha thesis or thresholds. The artifact freezes the current seasonal row selector so the all-year path is reproducible without changing source-lane behavior.',
    samplePolicy:
      `${contract.selectionPolicy} ${contract.overfitControl} Promotion uses the direct all-year bootstrap p-value below ${bootstrapPValuePromotionThreshold}, positive holdout edge, and max drawdown above ${drawdownPromotionFloorPct}%.`,
    tradeFile: summary.outputFiles.selectedTrades,
    params: {
      candidateId: selected.candidateId,
      family: 'weather-all-year',
      variant: 'all-year-beta',
      architecture: selected.architectureLabel,
      sourceSet: selected.sourceSetLabel,
      sourceIds: selected.sourceIds,
      componentStrategyIds: selected.componentStrategyIds,
      sourceWeightMode: selected.sourceWeightMode,
      sizingMode: selected.sizingMode,
      fallback: contract.fallback,
      rowSelectionPolicy: selected.rowSelectionPolicy,
      materialRowDefinition: selected.materialRowDefinition,
      splitEdges: selected.splitEdges,
      splitAnnualEdges: selected.splitAnnualEdges,
      indexMetrics: selected.indexMetrics,
      search: summary.search,
      candidateDiagnostics: candidateDiagnosticsFromStrategies(sourceStrategies),
      allYearArtifactDiagnostics: candidateDiagnosticsFromSummary(summary),
      realityCheck,
      componentRealityChecks: summary.validation.componentRealityChecks,
      componentTradeCounts: selected.componentTradeCounts,
      indexFallbackRows: selected.indexFallbackRows,
      materialRows: selected.materialRows,
      selectionPolicy: contract.selectionPolicy,
      signalTiming: contract.signalTiming,
      overfitControl: contract.overfitControl,
      maxDrawdownPromotionFloorPct: drawdownPromotionFloorPct,
      sourceUniverse: selected.sourceUniverse ?? sourceUniverseFor(trades),
    },
    metrics,
    caveat:
      `Checked-in artifact, not broker-ready. It preserves exact Summer/Winter row behavior, has direct all-year bootstrap p-value ${realityCheck.pValue}, and still needs non-overlapping paper validation before live consideration.`,
  }
}

function signedSplitEdge(value: number) {
  return `${value >= 0 ? '+' : ''}${round(value, 2)}%`
}

function curveFromTrades(trades: ArcticBlastTrade[]): ArcticBlastEquityPoint[] {
  let equity = initialCapital
  let peak = initialCapital

  return trades
    .slice()
    .sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate) || a.targetTradeDate.localeCompare(b.targetTradeDate))
    .map((trade) => {
      const previousEquity = equity
      equity = trade.equity && trade.equity > 0 ? trade.equity : Math.max(1, equity * (1 + trade.netReturnPct / 100))
      peak = Math.max(peak, equity)
      const direction = Number.isFinite(trade.ungPosition) ? trade.ungPosition ?? 0 : trade.direction === 'short' ? -1 : 1
      return {
        date: trade.entryTradeDate || trade.targetTradeDate,
        equity: round(equity, 2),
        equityPct: Number.isFinite(trade.equityPct) ? round(trade.equityPct ?? 0, 2) : round((equity / initialCapital - 1) * 100, 2),
        dailyPnlPct: round(previousEquity ? ((equity - previousEquity) / previousEquity) * 100 : 0, 3),
        drawdownPct: Number.isFinite(trade.drawdownPct) ? round(trade.drawdownPct ?? 0, 2) : round(((equity - peak) / peak) * 100, 2),
        close: 0,
        weatherSurprise: round(trade.weightedAnomalyF, 2),
        hddError: round(trade.weightedAnomalyF, 2),
        position: direction,
        signal: Number.isFinite(trade.confidence) ? round((trade.confidence ?? 0) * Math.sign(direction), 3) : direction,
        gasReturnPct: trade.netReturnPct,
        demandScore: Number.isFinite(trade.confidence) ? round(trade.confidence ?? 0, 3) : round(trade.rank, 3),
        storageBcf: Number.isFinite(trade.storageBcf) ? round(trade.storageBcf ?? 0, 2) : 0,
        closeScaled: null,
        sourceId: trade.sourceId,
        windowId: trade.windowId,
        netReturnPct: trade.netReturnPct,
      }
    })
}

function metricsFromResearch(metrics: ArcticBlastStrategyMetrics, trades: ArcticBlastTrade[]): BacktestMetrics {
  const returns = trades.map((trade) => trade.netReturnPct / 100)
  const negativeReturns = returns.filter((value) => value < 0)
  const years = metrics.firstEntry && metrics.lastExit ? daysBetween(metrics.firstEntry, metrics.lastExit) / 365.25 : 1
  const tradesPerYear = trades.length / Math.max(years, 1 / 365.25)
  const tradeVol = std(returns) * Math.sqrt(Math.max(tradesPerYear, 1))
  const downsideVol = std(negativeReturns) * Math.sqrt(Math.max(tradesPerYear, 1))
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)

  return {
    totalReturnPct: metrics.totalReturnPct,
    cagrPct: metrics.cagrPct,
    annualVolPct: round(tradeVol * 100, 2),
    sharpe: metrics.sharpe,
    sortino: metrics.sortino || round(downsideVol ? (mean(returns) * tradesPerYear) / downsideVol : 0, 2),
    maxDrawdownPct: metrics.maxDrawdownPct,
    calmar: round(Math.abs(metrics.maxDrawdownPct) ? metrics.cagrPct / Math.abs(metrics.maxDrawdownPct) : 0, 2),
    winRatePct: metrics.winRatePct,
    profitFactor: metrics.profitFactor,
    tradeCount: metrics.tradeCount,
    exposurePct: round((metrics.averageHoldDays * metrics.tradeCount * 100) / Math.max(daysBetween(metrics.firstEntry, metrics.lastExit), 1), 1),
    turnover: metrics.tradeCount,
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(mean(returns) * 100, 3),
  }
}

const ngasSummerAlphaSummary = JSON.parse(ngasSummerAlphaSummaryJson) as DualWeatherSummary
const ngasSummerAlphaTrades = parseWeatherRotationTrades(ngasSummerAlphaTradesCsv, 'summer-alpha')
const ngasWinterAlphaSummary = JSON.parse(ngasWinterAlphaSummaryJson) as WinterAlphaSummary
const ngasWinterAlphaTrades = parseWeatherRotationTrades(ngasWinterAlphaTradesCsv, 'winter-alpha')
const ngasAllYearBetaSummary = JSON.parse(ngasAllYearBetaSummaryJson) as AllYearBetaSummary
const ngasAllYearBetaTrades = parseWeatherRotationTrades(ngasAllYearBetaTradesCsv, 'all-year-beta')
const ngasAllYearBetaExpectedTrades = combineAllYearBetaTrades(ngasSummerAlphaTrades, ngasWinterAlphaTrades)
const allYearBetaSplitContractsByStrategyId = new Map<string, SeasonalAlphaSplitContract>([
  [ngasSummerAlphaSummary.strategyId, ngasSummerAlphaSummary.contract],
  [ngasWinterAlphaSummary.strategyId, ngasWinterAlphaSummary.contract],
])
assertAllYearBetaArtifact(
  ngasAllYearBetaTrades,
  ngasAllYearBetaExpectedTrades,
  ngasAllYearBetaSummary,
  allYearBetaSplitContractsByStrategyId,
)
const ngasSummerAlphaStrategy = createNgasSummerAlphaStrategy(ngasSummerAlphaSummary, ngasSummerAlphaTrades)
const ngasWinterAlphaStrategy = createNgasWinterAlphaStrategy(ngasWinterAlphaSummary, ngasWinterAlphaTrades)
const ngasAllYearBetaStrategy = createNgasAllYearBetaStrategy(ngasAllYearBetaSummary, ngasAllYearBetaTrades, [
  ngasSummerAlphaStrategy,
  ngasWinterAlphaStrategy,
])
// Summer/Winter stay loaded as source ledgers for All-Year, but are deprecated from the active dashboard registry.
const activeArcticBlastResearchStrategies: ArcticBlastResearchStrategy[] = [ngasAllYearBetaStrategy]

const tradesByStrategyId = new Map([
  [ngasSummerAlphaSummary.strategyId, ngasSummerAlphaTrades] as const,
  [ngasWinterAlphaSummary.strategyId, ngasWinterAlphaTrades] as const,
  [ngasAllYearBetaSummary.strategyId, ngasAllYearBetaTrades] as const,
])
const dailyRotationMetricsByStrategyId = new Map([
  [ngasSummerAlphaSummary.strategyId, createHybridBacktestMetrics(ngasSummerAlphaSummary)] as const,
  [ngasWinterAlphaSummary.strategyId, createHybridBacktestMetrics(ngasWinterAlphaSummary)] as const,
  [ngasAllYearBetaSummary.strategyId, createHybridBacktestMetrics(ngasAllYearBetaSummary)] as const,
])

export const arcticBlastResearchStrategies: ArcticBlastResearchStrategy[] = activeArcticBlastResearchStrategies

export const arcticBlastResearchBacktestResults: ArcticBlastResearchBacktestResult[] = arcticBlastResearchStrategies.map((strategy) => {
  const trades = tradesByStrategyId.get(strategy.id) ?? []
  return {
    strategy,
    researchMetrics: strategy.metrics,
    metrics: dailyRotationMetricsByStrategyId.get(strategy.id) ?? metricsFromResearch(strategy.metrics, trades),
    curve: curveFromTrades(trades),
    trades,
    joined: [],
  }
})

export function findArcticBlastStrategy(strategyId: string) {
  return arcticBlastResearchStrategies.find((strategy) => strategy.id === strategyId) ?? null
}

export function createArcticBlastSignalIntent(input: ArcticBlastSignalInput): StrategySignalIntent {
  const strategy = findArcticBlastStrategy(input.strategyId)
  if (!strategy) throw new Error(`Unknown Arctic Blast strategy: ${input.strategyId}`)

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    generatedAt: new Date().toISOString(),
    signalDate: input.signalDate,
    targetDate: input.targetDate,
    instrument: strategy.instrument,
    direction: input.direction,
    confidence: input.confidence,
    expectedReturnPct: input.expectedReturnPct,
    indexFraction: input.indexFraction,
    gasPosition: input.gasPosition,
    cashFraction: input.cashFraction,
    sourceSynthetic: input.indexFraction && input.indexFraction > 0 ? indexBasketSymbol : undefined,
    maxHoldingDays: input.maxHoldingDays ?? Math.ceil(strategy.metrics.averageHoldDays),
    source: 'research-backtest',
    notes: [
      strategy.timingConvention,
      strategy.returnColumn,
      'No live routing is enabled for this signal.',
      ...(input.notes ?? []),
    ],
  }
}
