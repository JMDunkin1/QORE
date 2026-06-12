import Papa from 'papaparse'
import type { ExecutionInstrumentCode, StrategySignalIntent, TradeDirection } from '../execution'
import type { BacktestMetrics, EquityPoint } from '../types'
import ngasWinterAlphaSummaryJson from '../../data/qore/research/strategy-agent-runs/ngas-winter-alpha/run-summary.json?raw'
import ngasWinterAlphaTradesCsv from '../../data/qore/research/strategy-agent-runs/ngas-winter-alpha/selected-trades.csv?raw'
import ngasSummerAlphaSummaryJson from '../../data/qore/research/strategy-agent-runs/ngas-summer-alpha/run-summary.json?raw'
import ngasSummerAlphaTradesCsv from '../../data/qore/research/strategy-agent-runs/ngas-summer-alpha/selected-trades.csv?raw'

export type ArcticBlastStrategyFamily = 'weather-alpha' | 'weather-summer'
export type ArcticBlastStrategyVariant = 'winter-alpha' | 'summer-alpha'

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

type HybridSummary = {
  strategyId: string
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
    legCounts: Record<string, Record<string, number>>
  }
  search: {
    candidateCount: number
    eligibleCandidateCount: number
    selectionUsedHoldout: boolean
  }
  validation: {
    realityCheck: {
      observedAverageDailyEdgePct: number
      pValue: number
      iterations: number
      blockLength: number
    }
  }
}

type WinterAlphaSummary = {
  strategyId: string
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
    indexTrendLookbackSessions: number
  }
  parents: {
    weatherHybrid: {
      strategyId: string
      candidateId: string
      role: string
    }
    dualWeather: {
      strategyId: string
      candidateId: string
      role: string
    }
    volatilityReversion: {
      strategyId: string
      candidateId: string
      role: string
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
    indexRiskMode: string
    indexRiskLabel: string
    indexTrendLookbackSessions: number | null
    weatherFraction: number
    reversionFraction: number
    reversionLongScale: number
    standaloneReversionScale: number
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
    realityCheck: {
      observedAverageDailyEdgePct: number
      pValue: number
      iterations: number
      blockLength: number
    }
  }
  outputFiles: {
    selectedTrades: string
  }
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
  componentThesisKinds?: string[]
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

const ngasWinterAlphaStrategyColor = '#d97706'
const summerWeatherStrategyColor = '#db2777'

export const arcticBlastPromotionGates = [
  'Keep all gas overlay entries strictly after the signal-date close.',
  'Select alpha candidates using train/validation data only; holdout rows stay report-only.',
  'Keep parent weather and volatility lanes archived as inputs, not active strategies.',
  'Keep NGAS Winter Alpha marked needs-more-validation unless the parent blend clears holdout edge and bootstrap reality checks.',
  'Keep NGAS Summer Alpha marked needs-more-validation unless both cooling-season sides clear holdout edge and bootstrap reality checks.',
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
    componentThesisKinds: row.componentThesisKinds ? row.componentThesisKinds.split('|').filter(Boolean) : [],
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
    holdoutEdge > 0 && realityCheckPValue <= 0.1 && hasCoolSideEvidence ? 'research-baseline' : 'needs-more-validation'

  return {
    id: summary.strategyId,
    name: 'NGAS Summer Alpha',
    family: 'weather-summer',
    variant: 'summer-alpha',
    instrument: 'NG',
    desk: 'Summer natural gas futures heat edge',
    thesis:
      'Capital stays in the US index basket by default, then uses multi-model day-7 summer heat forecasts to add NG futures exposure and fade same-direction weather overreactions.',
    directionPolicy:
      'Follow confirmed broad summer heat with a long NG futures overlay, then short only same-direction gas rallies after the weather-follow window. Cool-short remains diagnostic until enough validated cool events exist.',
    promotionStatus,
    riskLevel: riskLevelFor(metrics),
    color: summerWeatherStrategyColor,
    liveRoutingEnabled: false,
    sourceUniverse: sourceUniverseFor(trades),
    timingConvention: 'daily-weather-rotation-v1',
    returnColumn: 'netReturnPct',
    universe: `NG futures and US index basket daily bars from ${summary.data.marketStartDate} through ${summary.data.marketEndDate}.`,
    theoryAlignment:
      'Direct summer cooling-demand lane: multi-model heat demand direction plus same-direction post-window overreaction fade, with index fallback when confidence is low. Cool-short evidence is retained as diagnostic.',
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
      sizingMode: selected.sizingMode,
      volTargetPct: selected.volTargetPct,
      fallback: contract.fallback,
      roundTripCostPct: contract.roundTripCostPct,
      splitEdges: selected.splitEdges,
      legCounts: selected.legCounts,
      indexMetrics: selected.indexMetrics,
      search: summary.search,
      realityCheck: summary.validation.realityCheck,
      selectionPolicy: contract.selectionPolicy,
      signalTiming: contract.signalTiming,
      reversionTiming: contract.reversionTiming,
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
    holdoutEdge > 0 && realityCheckPValue <= 0.1 ? 'research-baseline' : 'needs-more-validation'

  return {
    id: summary.strategyId,
    name: 'NGAS Winter Alpha',
    family: 'weather-alpha',
    variant: 'winter-alpha',
    instrument: 'UNG',
    desk: 'Winter natural gas alpha blend',
    thesis:
      'Blend parent experts conservatively: Dual Weather supplies cold-follow and warm-short context, Weather Hybrid supplies post-window fades, Volatility Mean Reversion confirms long fades, close-in weather resolution sizes reversion exposure, and idle capital remains in the index fallback.',
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
      'Parent-expert blend of winter forecast-follow demand risk, same-direction weather fades, volatility-confirmed long-fade sizing, and non-lookahead close-in or already-known actual weather-resolution sizing.',
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
      indexRiskMode: selected.indexRiskMode,
      indexRiskLabel: selected.indexRiskLabel,
      indexTrendLookbackSessions: selected.indexTrendLookbackSessions,
      weatherFraction: selected.weatherFraction,
      reversionFraction: selected.reversionFraction,
      reversionLongScale: selected.reversionLongScale,
      standaloneReversionScale: selected.standaloneReversionScale,
      overlayCap: selected.overlayCap,
      followHoldDays: selected.followHoldDays,
      reversionHoldDays: selected.reversionHoldDays,
      minRealizedMovePct: selected.minRealizedMovePct,
      positionPolicy: selected.positionPolicy,
      conflictPolicy: selected.conflictPolicy,
      requiredSideChecks: selected.requiredSideChecks,
      parents: summary.parents,
      fallback: contract.fallback,
      roundTripCostPct: contract.roundTripCostPct,
      oneWayCostPct: contract.oneWayCostPct,
      splitEdges: selected.splitEdges,
      sideReturns: selected.sideReturns,
      legCounts: selected.legCounts,
      indexMetrics: selected.indexMetrics,
      search: summary.search,
      realityCheck: summary.validation.realityCheck,
      selectionPolicy: contract.selectionPolicy,
      signalTiming: contract.signalTiming,
      weatherResolutionTiming: contract.weatherResolutionTiming,
      sourceUniverse: sourceUniverseFor(trades),
    },
    metrics,
    caveat:
      holdoutEdge > 0
        ? `Holdout edge versus the index basket is ${signedSplitEdge(holdoutEdge)}, but bootstrap p-value is ${realityCheckPValue}; keep this behind paper validation.`
        : `Needs more validation: train/validation edge is strong, but holdout edge versus the index basket is ${signedSplitEdge(holdoutEdge)} and bootstrap p-value is ${realityCheckPValue}.`,
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
        date: trade.targetTradeDate,
        equity: round(equity, 2),
        equityPct: Number.isFinite(trade.equityPct) ? round(trade.equityPct ?? 0, 2) : round((equity / initialCapital - 1) * 100, 2),
        dailyPnlPct: round(previousEquity ? ((equity - previousEquity) / previousEquity) * 100 : 0, 3),
        drawdownPct: Number.isFinite(trade.drawdownPct) ? round(trade.drawdownPct ?? 0, 2) : round(((equity - peak) / peak) * 100, 2),
        close: 0,
        weatherSurprise: round(trade.weightedAnomalyF, 2),
        hddError: round(trade.weightedAnomalyF, 2),
        position: direction,
        signal: Number.isFinite(trade.confidence) ? round((trade.confidence ?? 0) * Math.sign(direction), 3) : direction,
        gasReturnPct: round(trade.netReturnPct, 3),
        demandScore: Number.isFinite(trade.confidence) ? round(trade.confidence ?? 0, 3) : round(trade.rank, 3),
        storageBcf: Number.isFinite(trade.indexFraction) ? round((trade.indexFraction ?? 0) * 100, 2) : 0,
        closeScaled: null,
        sourceId: trade.sourceId,
        windowId: trade.windowId,
        netReturnPct: round(trade.netReturnPct, 3),
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
const tradesByStrategyId = new Map([
  [ngasSummerAlphaSummary.strategyId, ngasSummerAlphaTrades] as const,
  [ngasWinterAlphaSummary.strategyId, ngasWinterAlphaTrades] as const,
])
const dailyRotationMetricsByStrategyId = new Map([
  [ngasSummerAlphaSummary.strategyId, createHybridBacktestMetrics(ngasSummerAlphaSummary)] as const,
  [ngasWinterAlphaSummary.strategyId, createHybridBacktestMetrics(ngasWinterAlphaSummary)] as const,
])

export const arcticBlastResearchStrategies: ArcticBlastResearchStrategy[] = [
  createNgasSummerAlphaStrategy(ngasSummerAlphaSummary, ngasSummerAlphaTrades),
  createNgasWinterAlphaStrategy(ngasWinterAlphaSummary, ngasWinterAlphaTrades),
]

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
