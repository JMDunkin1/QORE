import Papa from 'papaparse'
import type { BacktestMetrics, EquityPoint } from '../types'
import predictionTimeLadderSummaryJson from '../../data/qore/research/strategy-agent-runs/prediction-time-ladder/run-summary.json?raw'
import predictionTimeLadderTradesCsv from '../../data/qore/research/strategy-agent-runs/prediction-time-ladder/selected-trades.csv?raw'
import predictionTimeLadderCandidatesCsv from '../../data/qore/research/strategy-agent-runs/prediction-time-ladder/candidate-summary.csv?raw'

export type PredictionTimeLadderPromotionStatus = 'research-diagnostic' | 'needs-more-validation'

export type PredictionTimeLadderMetrics = {
  totalReturnPct: number
  cagrPct: number
  sharpe: number
  sortino: number
  maxDrawdownPct: number
  winRatePct: number
  profitFactor: number
  tradeCount: number
  exposurePct: number
  averageTradeReturnPct: number
  averageHoldDays: number
  firstEntry: string
  lastExit: string
}

export type PredictionTimeLadderResearchStrategy = {
  id: string
  name: string
  family: 'prediction-time-ladder'
  variant: 'time-ladder-arb'
  instrument: 'VOO'
  desk: string
  thesis: string
  directionPolicy: string
  promotionStatus: PredictionTimeLadderPromotionStatus
  riskLevel: 'Low' | 'Medium' | 'High'
  color: string
  liveRoutingEnabled: false
  sourceUniverse: string[]
  timingConvention: 'prediction-market-time-ladder-v1'
  returnColumn: 'netReturnPct'
  universe: string
  theoryAlignment: string
  samplePolicy: string
  tradeFile: string
  params: Record<string, unknown>
  metrics: PredictionTimeLadderMetrics
  caveat: string
}

export type PredictionTimeLadderTrade = {
  strategyId: string
  variant: 'time-ladder-arb'
  observedAt: string
  signalDate: string
  issueDate: string
  targetDate: string
  entryTradeDate: string
  exitTradeDate: string
  targetTradeDate: string
  direction: 'long'
  sourceId: string
  windowId: 'time-ladder-package'
  thesisKind: 'time-ladder-package'
  componentThesisKinds?: string[]
  leadDays: number
  confidence: number
  weightedAnomalyF: number
  coveragePct: number
  coldCoveragePct: number
  warmCoveragePct: number
  extremeCount: number
  grossReturnPct: number
  tradingCostPct: number
  netReturnPct: number
  indexReturnPct: number
  ungReturnPct: number
  ungPosition: number
  equity: number
  equityPct: number
  drawdownPct: number
  rank: number
  pairId: string
  earlyMarketId: string
  laterMarketId: string
  earlyDeadline: string
  laterDeadline: string
  packageCost: number
  grossEdgePct: number
  packageReturnPct: number
  portfolioAllocationPct: number
  executableSize: number
  liquidityMin: number
  volume24hMin: number
  split: 'train' | 'validation' | 'holdout'
}

export type PredictionTimeLadderEquityPoint = EquityPoint & {
  gasReturnPct: number
  demandScore: number
  storageBcf: number
  closeScaled: number | null
  sourceId: string
  windowId: string
  netReturnPct: number
}

export type PredictionTimeLadderBacktestResult = {
  strategy: PredictionTimeLadderResearchStrategy
  metrics: BacktestMetrics
  researchMetrics: PredictionTimeLadderMetrics
  curve: PredictionTimeLadderEquityPoint[]
  trades: PredictionTimeLadderTrade[]
  joined: []
}

type RealityCheckSummary = {
  method?: string
  comparison?: string
  alternative?: string
  pValue?: number | null
  singleCandidatePValue?: number | null
  selectionAdjustedPValue?: number | null
  observedAverageDailyEdgePct?: number
  observedAnnualizedEdgePct?: number
  dailyActiveVolPct?: number
  sampleCount?: number
  selectedSampleCount?: number
  activeOverlayDays?: number
  minimumResolvablePValue?: number | null
  iterations?: number
  blockLength?: number
  limitation?: string
}

type SummaryMetrics = BacktestMetrics & {
  firstEntry: string
  lastExit: string
  averageHoldDays: number
  averageTradeReturnPct: number
}

type PredictionTimeLadderSummary = {
  strategyId: string
  displayName: string
  data: {
    kalshiMarkets: number
    polymarketMarkets: number
    parsedDateThresholdMarkets: number
    ladderPairs: number
    currentPositivePackages: number
    currentPackagesAboveSelectedThreshold: number
    historicalPairsRequested: number
    historicalObservations: number
    historicalStartDate: string
    historicalEndDate: string
    historyDaysRequested: number
    candleIntervalMinutes: number
    portfolioAllocationPct: number
  }
  contract: {
    trainEnd: string
    validationEnd: string
    holdoutStart: string
    feeHaircutCents: number
    capitalAllocationPct: number
    fallback: string
    selectionPolicy: string
    signalTiming: string
    overfitControl: string
  }
  selected: {
    candidateId: string
    architectureLabel: string
    sourceSetLabel: string
    sourceIds: string[]
    minGrossEdgeCents: number
    feeHaircutCents: number
    minSpacingHours: number
    capitalAllocationPct: number
    allMetrics: SummaryMetrics
    trainMetrics: SummaryMetrics
    validationMetrics: SummaryMetrics
    holdoutMetrics: SummaryMetrics
    splitEdges: Record<'train' | 'validation' | 'holdout' | 'all', number>
    splitAnnualEdges: Record<'train' | 'validation' | 'holdout' | 'all', number>
    sourceUniverse: string[]
    currentTopOpportunities: Array<Record<string, unknown>>
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
    candidateSummary: string
    currentMarkets: string
    detectedPairs: string
    historicalObservations: string
  }
  caveat: string
}

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

function booleanFrom(value: unknown) {
  return value === true || String(value).toLowerCase() === 'true'
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function createMetrics(metrics: SummaryMetrics): PredictionTimeLadderMetrics {
  return {
    totalReturnPct: numberFrom(metrics.totalReturnPct),
    cagrPct: numberFrom(metrics.cagrPct),
    sharpe: numberFrom(metrics.sharpe),
    sortino: numberFrom(metrics.sortino),
    maxDrawdownPct: numberFrom(metrics.maxDrawdownPct),
    winRatePct: numberFrom(metrics.winRatePct),
    profitFactor: numberFrom(metrics.profitFactor),
    tradeCount: numberFrom(metrics.tradeCount),
    exposurePct: numberFrom(metrics.exposurePct),
    averageTradeReturnPct: numberFrom(metrics.averageTradeReturnPct),
    averageHoldDays: numberFrom(metrics.averageHoldDays, 1),
    firstEntry: metrics.firstEntry,
    lastExit: metrics.lastExit,
  }
}

function createBacktestMetrics(metrics: SummaryMetrics): BacktestMetrics {
  return {
    totalReturnPct: numberFrom(metrics.totalReturnPct),
    cagrPct: numberFrom(metrics.cagrPct),
    annualVolPct: numberFrom(metrics.annualVolPct),
    sharpe: numberFrom(metrics.sharpe),
    sortino: numberFrom(metrics.sortino),
    maxDrawdownPct: numberFrom(metrics.maxDrawdownPct),
    calmar: numberFrom(metrics.calmar),
    winRatePct: numberFrom(metrics.winRatePct),
    profitFactor: numberFrom(metrics.profitFactor),
    tradeCount: numberFrom(metrics.tradeCount),
    exposurePct: numberFrom(metrics.exposurePct),
    turnover: numberFrom(metrics.turnover),
    var95Pct: numberFrom(metrics.var95Pct),
    cvar95Pct: numberFrom(metrics.cvar95Pct),
    averageDailyPnlPct: numberFrom(metrics.averageDailyPnlPct),
  }
}

function parsePredictionTimeLadderTrades(csv: string): PredictionTimeLadderTrade[] {
  return parseCsv<Record<string, string>>(csv).map((row) => ({
    strategyId: row.strategyId,
    variant: 'time-ladder-arb',
    observedAt: row.observedAt,
    signalDate: row.signalDate,
    issueDate: row.issueDate,
    targetDate: row.targetDate,
    entryTradeDate: row.entryTradeDate,
    exitTradeDate: row.exitTradeDate,
    targetTradeDate: row.targetTradeDate,
    direction: 'long',
    sourceId: row.sourceId,
    windowId: 'time-ladder-package',
    thesisKind: 'time-ladder-package',
    componentThesisKinds: [],
    leadDays: numberFrom(row.leadDays),
    confidence: numberFrom(row.confidence),
    weightedAnomalyF: numberFrom(row.weightedAnomalyF),
    coveragePct: numberFrom(row.coveragePct),
    coldCoveragePct: numberFrom(row.coldCoveragePct),
    warmCoveragePct: numberFrom(row.warmCoveragePct),
    extremeCount: numberFrom(row.extremeCount),
    grossReturnPct: numberFrom(row.grossReturnPct),
    tradingCostPct: numberFrom(row.tradingCostPct),
    netReturnPct: numberFrom(row.netReturnPct),
    indexReturnPct: numberFrom(row.indexReturnPct),
    ungReturnPct: numberFrom(row.ungReturnPct),
    ungPosition: numberFrom(row.ungPosition),
    equity: numberFrom(row.equity),
    equityPct: numberFrom(row.equityPct),
    drawdownPct: numberFrom(row.drawdownPct),
    rank: numberFrom(row.rank),
    pairId: row.pairId,
    earlyMarketId: row.earlyMarketId,
    laterMarketId: row.laterMarketId,
    earlyDeadline: row.earlyDeadline,
    laterDeadline: row.laterDeadline,
    packageCost: numberFrom(row.packageCost),
    grossEdgePct: numberFrom(row.grossEdgePct),
    packageReturnPct: numberFrom(row.packageReturnPct),
    portfolioAllocationPct: numberFrom(row.portfolioAllocationPct),
    executableSize: numberFrom(row.executableSize),
    liquidityMin: numberFrom(row.liquidityMin),
    volume24hMin: numberFrom(row.volume24hMin),
    split: row.split === 'holdout' ? 'holdout' : row.split === 'validation' ? 'validation' : 'train',
  }))
}

function candidateDiagnosticsFromCsv(csv: string, summary: PredictionTimeLadderSummary) {
  const candidates = parseCsv<Record<string, string>>(csv).map((row) => ({
    candidateId: row.candidateId,
    minGrossEdgeCents: numberFrom(row.minGrossEdgeCents),
    feeHaircutCents: numberFrom(row.feeHaircutCents),
    minSpacingHours: numberFrom(row.minSpacingHours),
    eligible: booleanFrom(row.eligible),
    selectionEligible: booleanFrom(row.selectionEligible),
    trainValidationRank: numberFrom(row.trainValidationRank),
    trainEdgePct: numberFrom(row.trainEdgePct),
    validationEdgePct: numberFrom(row.validationEdgePct),
    holdoutEdgePct: numberFrom(row.holdoutEdgePct),
    allEdgePct: numberFrom(row.allEdgePct),
    trainReturnPct: numberFrom(row.trainReturnPct),
    validationReturnPct: numberFrom(row.validationReturnPct),
    holdoutReturnPct: numberFrom(row.holdoutReturnPct),
    trainSharpe: numberFrom(row.trainSharpe),
    validationSharpe: numberFrom(row.validationSharpe),
    holdoutSharpe: numberFrom(row.holdoutSharpe),
    trainMaxDrawdownPct: numberFrom(row.trainMaxDrawdownPct),
    validationMaxDrawdownPct: numberFrom(row.validationMaxDrawdownPct),
    holdoutMaxDrawdownPct: numberFrom(row.holdoutMaxDrawdownPct),
    tradeCount: numberFrom(row.tradeCount),
    holdoutTradeCount: numberFrom(row.holdoutTradeCount),
    averageNetReturnPct: numberFrom(row.averageNetReturnPct),
    averagePackageReturnPct: numberFrom(row.averagePackageReturnPct),
  }))
  return {
    selectedCandidateId: summary.selected.candidateId,
    candidateCount: summary.search.candidateCount,
    eligibleCandidateCount: summary.search.eligibleCandidateCount,
    selectionUsedHoldout: summary.search.selectionUsedHoldout,
    candidates,
  }
}

function riskLevelFor(metrics: PredictionTimeLadderMetrics): PredictionTimeLadderResearchStrategy['riskLevel'] {
  if (metrics.tradeCount < 25) return 'High'
  if (metrics.exposurePct > 15 || metrics.maxDrawdownPct <= -10) return 'Medium'
  return 'Low'
}

function createPredictionTimeLadderStrategy(summary: PredictionTimeLadderSummary): PredictionTimeLadderResearchStrategy {
  const metrics = createMetrics(summary.selected.allMetrics)
  return {
    id: summary.strategyId,
    name: summary.displayName,
    family: 'prediction-time-ladder',
    variant: 'time-ladder-arb',
    instrument: 'VOO',
    desk: 'Prediction market deadline arbitrage',
    thesis:
      'Find nested prediction-market deadline ladders where the earlier YES bid is above the later YES ask, then model the package buy NO earlier plus buy YES later as a tiny-capacity canary allocation.',
    directionPolicy:
      'Only enter when the detected package clears the selected gross-edge threshold, fee haircut, and pair-spacing rule; all rows remain paper/research until contract wording is reviewed.',
    promotionStatus: 'needs-more-validation',
    riskLevel: riskLevelFor(metrics),
    color: '#7c3aed',
    liveRoutingEnabled: false,
    sourceUniverse: summary.selected.sourceUniverse,
    timingConvention: 'prediction-market-time-ladder-v1',
    returnColumn: 'netReturnPct',
    universe:
      `${summary.data.kalshiMarkets.toLocaleString()} Kalshi active markets and ${summary.data.polymarketMarkets.toLocaleString()} Polymarket active markets; ` +
      `${summary.data.parsedDateThresholdMarkets.toLocaleString()} parsed date-threshold markets and ${summary.data.ladderPairs.toLocaleString()} same-venue ladders.`,
    theoryAlignment:
      'Pure monotonicity check: if before-date A is a subset of before-date B, YES(A) should not be more expensive than YES(B). Positive rows are treated as pricing-discrepancy observations, not proof of settlement-safe arbitrage.',
    samplePolicy:
      `${summary.contract.selectionPolicy} Historical proof uses ${summary.data.historicalObservations.toLocaleString()} Kalshi candle observations across ${summary.data.historicalPairsRequested} ladder pairs from ${summary.data.historicalStartDate} through ${summary.data.historicalEndDate}.`,
    tradeFile: summary.outputFiles.selectedTrades,
    params: {
      candidateId: summary.selected.candidateId,
      family: 'prediction-time-ladder',
      variant: 'time-ladder-arb',
      architecture: summary.selected.architectureLabel,
      sourceSet: summary.selected.sourceSetLabel,
      sourceIds: summary.selected.sourceIds,
      minGrossEdgeCents: summary.selected.minGrossEdgeCents,
      feeHaircutCents: summary.selected.feeHaircutCents,
      minSpacingHours: summary.selected.minSpacingHours,
      capitalAllocationPct: summary.selected.capitalAllocationPct,
      fallback: summary.contract.fallback,
      splitEdges: summary.selected.splitEdges,
      splitAnnualEdges: summary.selected.splitAnnualEdges,
      search: summary.search,
      candidateDiagnostics: candidateDiagnosticsFromCsv(predictionTimeLadderCandidatesCsv, summary),
      realityCheck: summary.validation.realityCheck,
      selectionPolicy: summary.contract.selectionPolicy,
      signalTiming: summary.contract.signalTiming,
      overfitControl: summary.contract.overfitControl,
      dataAudit: summary.data,
      currentTopOpportunities: summary.selected.currentTopOpportunities,
      sourceUniverse: summary.selected.sourceUniverse,
    },
    metrics,
    caveat: summary.caveat,
  }
}

function curveFromTrades(trades: PredictionTimeLadderTrade[]): PredictionTimeLadderEquityPoint[] {
  return trades.map((trade) => ({
    date: trade.entryTradeDate,
    equity: round(trade.equity, 2),
    equityPct: round(trade.equityPct, 4),
    dailyPnlPct: round(trade.netReturnPct, 4),
    drawdownPct: round(trade.drawdownPct, 4),
    close: trade.packageCost,
    weatherSurprise: trade.grossEdgePct,
    hddError: trade.packageReturnPct,
    position: trade.portfolioAllocationPct,
    signal: trade.confidence,
    gasReturnPct: trade.netReturnPct,
    demandScore: trade.packageReturnPct,
    storageBcf: trade.executableSize,
    closeScaled: trade.packageCost * 100,
    sourceId: trade.sourceId,
    windowId: trade.windowId,
    netReturnPct: trade.netReturnPct,
  }))
}

const predictionTimeLadderSummary = JSON.parse(predictionTimeLadderSummaryJson) as PredictionTimeLadderSummary
const predictionTimeLadderTrades = parsePredictionTimeLadderTrades(predictionTimeLadderTradesCsv)
const predictionTimeLadderStrategy = createPredictionTimeLadderStrategy(predictionTimeLadderSummary)

export const predictionTimeLadderResearchStrategies: PredictionTimeLadderResearchStrategy[] = [predictionTimeLadderStrategy]
export const predictionTimeLadderResearchBacktestResults: PredictionTimeLadderBacktestResult[] = [
  {
    strategy: predictionTimeLadderStrategy,
    researchMetrics: predictionTimeLadderStrategy.metrics,
    metrics: createBacktestMetrics(predictionTimeLadderSummary.selected.allMetrics),
    curve: curveFromTrades(predictionTimeLadderTrades),
    trades: predictionTimeLadderTrades,
    joined: [],
  },
]
