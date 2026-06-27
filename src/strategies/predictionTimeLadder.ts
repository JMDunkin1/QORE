import Papa from 'papaparse'
import type { BacktestMetrics, EquityPoint } from '../types'
import predictionTimeLadderSummaryJson from '../../data/qore/research/strategy-agent-runs/prediction-time-ladder/run-summary.json?raw'
import predictionTimeLadderTradesCsv from '../../data/qore/research/strategy-agent-runs/prediction-time-ladder/selected-trades.csv?raw'
import predictionTimeLadderCandidatesCsv from '../../data/qore/research/strategy-agent-runs/prediction-time-ladder/candidate-summary.csv?raw'
import predictionCrossMarketSummaryJson from '../../data/qore/research/strategy-agent-runs/prediction-cross-market-rv/run-summary.json?raw'
import predictionCrossMarketTradesCsv from '../../data/qore/research/strategy-agent-runs/prediction-cross-market-rv/selected-trades.csv?raw'
import predictionCrossMarketCandidatesCsv from '../../data/qore/research/strategy-agent-runs/prediction-cross-market-rv/candidate-summary.csv?raw'

export type PredictionTimeLadderPromotionStatus = 'research-diagnostic' | 'needs-more-validation'
type PredictionMarketFamily = 'prediction-time-ladder' | 'prediction-cross-market'
type PredictionMarketVariant = 'time-ladder-arb' | 'cross-venue-rv'
type PredictionMarketThesisKind = 'time-ladder-package' | 'cross-venue-rv'
type PredictionMarketSplit = 'train' | 'validation' | 'holdout' | 'current'
type PredictionMarketSplitMetric = PredictionMarketSplit | 'all'
type PredictionMarketValidationScope = 'historical-holdout' | 'current-paper-scan'
type CurrentPaperScanFreshness = {
  isFresh: boolean
  localDate: string
  generatedDate: string | null
  latestObservedDate: string | null
  latestExitDate: string | null
  latestTargetDate: string | null
  currentRowCount: number
  reason:
    | 'historical-scope'
    | 'fresh'
    | 'missing-generated-at'
    | 'generated-at-not-today'
    | 'no-current-rows'
    | 'current-rows-not-today'
    | 'current-rows-expired'
}

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
  family: PredictionMarketFamily
  variant: PredictionMarketVariant
  instrument: 'VOO'
  desk: string
  thesis: string
  directionPolicy: string
  promotionStatus: PredictionTimeLadderPromotionStatus
  riskLevel: 'Low' | 'Medium' | 'High'
  color: string
  liveRoutingEnabled: false
  sourceUniverse: string[]
  timingConvention: 'prediction-market-time-ladder-v1' | 'prediction-cross-market-rv-v1'
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
  variant: PredictionMarketVariant
  observedAt: string
  signalDate: string
  issueDate: string
  targetDate: string
  entryTradeDate: string
  exitTradeDate: string
  targetTradeDate: string
  direction: 'long'
  sourceId: string
  windowId: PredictionMarketThesisKind
  thesisKind: PredictionMarketThesisKind
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
  split: PredictionMarketSplit
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

type PredictionMarketSummaryData = {
  kalshiMarkets: number
  polymarketMarkets: number
  comparablePairs?: number
  parsedDateThresholdMarkets?: number
  ladderPairs?: number
  currentPositivePackages?: number
  currentPackagesAboveSelectedThreshold?: number
  historicalPairsRequested: number
  historicalPairsSucceeded?: number
  historicalPairsFailed?: number
  historicalFailedPairIds?: string[]
  historicalAllowPartial?: boolean
  historicalObservations: number
  historicalStartDate: string
  historicalEndDate: string
  historyDaysRequested: number
  candleIntervalMinutes: number
  portfolioAllocationPct: number
  crossVenueSignals?: number
  crossVenueActionablePaperSignals?: number
  crossVenueExactBoxCandidates?: number
  crossVenueRelativeValuePaperSignals?: number
  crossVenueWatchlistSignals?: number
  spxSpyKalshiCurvePoints?: number
  spxSpyPolymarketCurvePoints?: number
  targetedKalshiMarketsSearched?: number
}

type PredictionTimeLadderSummary = {
  strategyId: string
  displayName: string
  generatedAt?: string
  data: PredictionMarketSummaryData
  contract: {
    trainEnd: string | null
    validationEnd: string | null
    holdoutStart: string | null
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
    trainMetrics: SummaryMetrics | null
    validationMetrics: SummaryMetrics | null
    holdoutMetrics: SummaryMetrics | null
    currentMetrics?: SummaryMetrics | null
    splitEdges: Partial<Record<PredictionMarketSplitMetric, number | null>>
    splitAnnualEdges: Partial<Record<PredictionMarketSplitMetric, number | null>>
    splitTotalReturns?: Partial<Record<PredictionMarketSplitMetric, number | null>>
    sourceUniverse: string[]
    currentTopOpportunities: Array<Record<string, unknown>>
  }
  search: {
    candidateCount: number
    eligibleCandidateCount: number
    selectionUsedHoldout: boolean
    validationScope?: PredictionMarketValidationScope
  }
  validation: {
    realityCheck: RealityCheckSummary
  }
  outputFiles: {
    selectedTrades: string
    candidateSummary: string
    crossVenueSignals?: string
    timeLadderSelectedTrades?: string
    timeLadderCandidateSummary?: string
    currentMarkets?: string
    detectedPairs?: string
    historicalObservations?: string
    comparablePairs?: string
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

function optionalNumberFrom(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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
  return parseCsv<Record<string, string>>(csv).map((row) => {
    const variant: PredictionMarketVariant = row.variant === 'cross-venue-rv' ? 'cross-venue-rv' : 'time-ladder-arb'
    const thesisKind: PredictionMarketThesisKind = row.thesisKind === 'cross-venue-rv' ? 'cross-venue-rv' : 'time-ladder-package'
    const windowId: PredictionMarketThesisKind = row.windowId === 'cross-venue-rv' ? 'cross-venue-rv' : 'time-ladder-package'
    return {
      strategyId: row.strategyId,
      variant,
      observedAt: row.observedAt || row.issueDate || row.signalDate,
      signalDate: row.signalDate,
      issueDate: row.issueDate,
      targetDate: row.targetDate,
      entryTradeDate: row.entryTradeDate,
      exitTradeDate: row.exitTradeDate,
      targetTradeDate: row.targetTradeDate,
      direction: 'long',
      sourceId: row.sourceId,
      windowId,
      thesisKind,
      componentThesisKinds: row.componentThesisKinds ? row.componentThesisKinds.split('|').filter(Boolean) : [],
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
      split: row.split === 'current' ? 'current' : row.split === 'holdout' ? 'holdout' : row.split === 'validation' ? 'validation' : 'train',
    }
  })
}

function validationScopeForSummary(summary: PredictionTimeLadderSummary): PredictionMarketValidationScope {
  if (summary.search.validationScope) return summary.search.validationScope
  if (summary.validation.realityCheck.method === 'current-cross-venue-paper-scan') return 'current-paper-scan'
  if (summary.data.historicalObservations === 0 && summary.data.crossVenueSignals) return 'current-paper-scan'
  return 'historical-holdout'
}

function isoDatePart(value: string | null | undefined) {
  return typeof value === 'string' ? (value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null) : null
}

function localIsoDate(now: Date) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function latestIsoDate(values: Array<string | null>) {
  return values.filter((value): value is string => !!value).sort().at(-1) ?? null
}

function currentPaperScanFreshness(
  summary: PredictionTimeLadderSummary,
  trades: PredictionTimeLadderTrade[],
  now = new Date(),
): CurrentPaperScanFreshness {
  const localDate = localIsoDate(now)
  const generatedDate = isoDatePart(summary.generatedAt)
  if (validationScopeForSummary(summary) !== 'current-paper-scan') {
    return {
      isFresh: true,
      localDate,
      generatedDate,
      latestObservedDate: null,
      latestExitDate: null,
      latestTargetDate: null,
      currentRowCount: 0,
      reason: 'historical-scope',
    }
  }

  const currentRows = trades.filter((trade) => trade.split === 'current')
  const latestObservedDate = latestIsoDate(currentRows.map((trade) => isoDatePart(trade.observedAt)))
  const latestExitDate = latestIsoDate(currentRows.map((trade) => isoDatePart(trade.exitTradeDate)))
  const latestTargetDate = latestIsoDate(currentRows.map((trade) => isoDatePart(trade.targetTradeDate || trade.targetDate)))

  const hasNonExpiredCurrentRows = currentRows.some((trade) => {
    if (isoDatePart(trade.observedAt) !== localDate) return false

    const exitDate = isoDatePart(trade.exitTradeDate)
    const targetDate = isoDatePart(trade.targetTradeDate || trade.targetDate)
    return (!exitDate || exitDate >= localDate) && (!targetDate || targetDate >= localDate)
  })

  const reason: CurrentPaperScanFreshness['reason'] = !generatedDate
    ? 'missing-generated-at'
    : generatedDate !== localDate
      ? 'generated-at-not-today'
      : currentRows.length === 0
        ? 'no-current-rows'
        : latestObservedDate !== localDate
          ? 'current-rows-not-today'
          : !hasNonExpiredCurrentRows
            ? 'current-rows-expired'
            : 'fresh'

  return {
    isFresh: reason === 'fresh',
    localDate,
    generatedDate,
    latestObservedDate,
    latestExitDate,
    latestTargetDate,
    currentRowCount: currentRows.length,
    reason,
  }
}

function splitMetricValue(
  values: Partial<Record<PredictionMarketSplitMetric, number | null>>,
  split: PredictionMarketSplitMetric,
) {
  return optionalNumberFrom(values[split])
}

function splitMetricsForScope(
  values: Partial<Record<PredictionMarketSplitMetric, number | null>>,
  validationScope: PredictionMarketValidationScope,
) {
  if (validationScope !== 'current-paper-scan') return values
  const current = splitMetricValue(values, 'current') ?? splitMetricValue(values, 'holdout')
  return {
    current,
    all: splitMetricValue(values, 'all') ?? current,
  }
}

function candidateDiagnosticsFromCsv(
  csv: string,
  summary: PredictionTimeLadderSummary,
  validationScope: PredictionMarketValidationScope,
) {
  const isCurrentPaperScan = validationScope === 'current-paper-scan'
  const candidates = parseCsv<Record<string, string>>(csv).map((row) => ({
    candidateId: row.candidateId,
    minGrossEdgeCents: numberFrom(row.minGrossEdgeCents),
    feeHaircutCents: numberFrom(row.feeHaircutCents),
    minSpacingHours: numberFrom(row.minSpacingHours),
    eligible: booleanFrom(row.eligible),
    selectionEligible: booleanFrom(row.selectionEligible),
    trainValidationRank: numberFrom(row.trainValidationRank),
    trainEdgePct: optionalNumberFrom(row.trainEdgePct),
    validationEdgePct: optionalNumberFrom(row.validationEdgePct),
    holdoutEdgePct: isCurrentPaperScan ? null : optionalNumberFrom(row.holdoutEdgePct),
    currentEdgePct: optionalNumberFrom(row.currentEdgePct) ?? (isCurrentPaperScan ? optionalNumberFrom(row.holdoutEdgePct) : null),
    allEdgePct: optionalNumberFrom(row.allEdgePct),
    trainReturnPct: optionalNumberFrom(row.trainReturnPct),
    validationReturnPct: optionalNumberFrom(row.validationReturnPct),
    holdoutReturnPct: isCurrentPaperScan ? null : optionalNumberFrom(row.holdoutReturnPct),
    currentReturnPct: optionalNumberFrom(row.currentReturnPct) ?? (isCurrentPaperScan ? optionalNumberFrom(row.holdoutReturnPct) : null),
    trainSharpe: optionalNumberFrom(row.trainSharpe),
    validationSharpe: optionalNumberFrom(row.validationSharpe),
    holdoutSharpe: isCurrentPaperScan ? null : optionalNumberFrom(row.holdoutSharpe),
    currentSharpe: optionalNumberFrom(row.currentSharpe) ?? (isCurrentPaperScan ? optionalNumberFrom(row.holdoutSharpe) : null),
    trainMaxDrawdownPct: optionalNumberFrom(row.trainMaxDrawdownPct),
    validationMaxDrawdownPct: optionalNumberFrom(row.validationMaxDrawdownPct),
    holdoutMaxDrawdownPct: isCurrentPaperScan ? null : optionalNumberFrom(row.holdoutMaxDrawdownPct),
    currentMaxDrawdownPct: optionalNumberFrom(row.currentMaxDrawdownPct) ?? (isCurrentPaperScan ? optionalNumberFrom(row.holdoutMaxDrawdownPct) : null),
    tradeCount: numberFrom(row.tradeCount),
    holdoutTradeCount: isCurrentPaperScan ? null : optionalNumberFrom(row.holdoutTradeCount),
    currentTradeCount: optionalNumberFrom(row.currentTradeCount) ?? (isCurrentPaperScan ? optionalNumberFrom(row.holdoutTradeCount) : null),
    averageNetReturnPct: optionalNumberFrom(row.averageNetReturnPct),
    averagePackageReturnPct: optionalNumberFrom(row.averagePackageReturnPct),
  }))
  return {
    selectedCandidateId: summary.selected.candidateId,
    candidateCount: summary.search.candidateCount,
    eligibleCandidateCount: summary.search.eligibleCandidateCount,
    selectionUsedHoldout: summary.search.selectionUsedHoldout,
    validationScope,
    candidates,
  }
}

function riskLevelFor(metrics: PredictionTimeLadderMetrics): PredictionTimeLadderResearchStrategy['riskLevel'] {
  if (metrics.tradeCount < 25) return 'High'
  if (metrics.exposurePct > 15 || metrics.maxDrawdownPct <= -10) return 'Medium'
  return 'Low'
}

function formatCount(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback.toLocaleString()
  return numberFrom(value, fallback).toLocaleString()
}

function createCrossMarketUniverse(
  summary: PredictionTimeLadderSummary,
  metrics: PredictionTimeLadderMetrics,
  validationScope: PredictionMarketValidationScope,
) {
  const baseUniverse = `${summary.data.kalshiMarkets.toLocaleString()} raw Kalshi markets and ${summary.data.polymarketMarkets.toLocaleString()} Polymarket markets`
  const comparablePairs = optionalNumberFrom(summary.data.comparablePairs)

  if (validationScope === 'historical-holdout') {
    return `${baseUniverse}; ${formatCount(comparablePairs, summary.data.historicalPairsRequested)} fixed comparable pairs and ${summary.data.historicalObservations.toLocaleString()} hourly quote-overlap observations from ${summary.data.historicalStartDate} through ${summary.data.historicalEndDate}.`
  }

  if (comparablePairs !== null) {
    return `${baseUniverse}; ${formatCount(comparablePairs)} comparable pairs, ${formatCount(summary.data.crossVenueSignals, metrics.tradeCount)} current cross-venue signals, ${formatCount(summary.data.crossVenueActionablePaperSignals, metrics.tradeCount)} selected paper rows, and ${formatCount(summary.data.crossVenueWatchlistSignals)} watchlist rows.`
  }

  return `${baseUniverse}; ${summary.data.spxSpyKalshiCurvePoints?.toLocaleString() ?? '0'} Kalshi SPX curve points, ${summary.data.spxSpyPolymarketCurvePoints?.toLocaleString() ?? '0'} Polymarket SPY curve points, and ${summary.data.targetedKalshiMarketsSearched?.toLocaleString() ?? '0'} targeted comparable Kalshi searches.`
}

function createCrossMarketSamplePolicy(
  summary: PredictionTimeLadderSummary,
  metrics: PredictionTimeLadderMetrics,
  validationScope: PredictionMarketValidationScope,
) {
  if (validationScope === 'historical-holdout') {
    return `${summary.contract.selectionPolicy} Historical holdout proof uses ${summary.data.historicalObservations.toLocaleString()} quote-overlap observations across ${summary.data.historicalPairsRequested.toLocaleString()} requested pairs from ${summary.data.historicalStartDate} through ${summary.data.historicalEndDate}; the selected candidate contributes ${metrics.tradeCount.toLocaleString()} selected historical rows, with holdout report-only. The separate current top-of-book review found ${formatCount(summary.data.crossVenueSignals)} signals and ${formatCount(summary.data.crossVenueActionablePaperSignals)} actionable paper rows.`
  }

  return `${summary.contract.selectionPolicy} This artifact is a current paper scan with ${formatCount(summary.data.crossVenueSignals, metrics.tradeCount)} cross-venue signals, ${formatCount(summary.data.crossVenueActionablePaperSignals, metrics.tradeCount)} selected paper rows, and ${formatCount(summary.data.crossVenueWatchlistSignals)} watchlist rows; it is not a historical fill backtest.`
}

function createPredictionTimeLadderStrategy(
  summary: PredictionTimeLadderSummary,
  trades: PredictionTimeLadderTrade[],
  candidateSummaryCsv: string,
): PredictionTimeLadderResearchStrategy {
  const metrics = createMetrics(summary.selected.allMetrics)
  const isCrossMarket = summary.strategyId === 'prediction-cross-market-rv-alpha'
  const validationScope = validationScopeForSummary(summary)
  const scanFreshness = currentPaperScanFreshness(summary, trades)
  const family: PredictionMarketFamily = isCrossMarket ? 'prediction-cross-market' : 'prediction-time-ladder'
  const variant: PredictionMarketVariant = isCrossMarket ? 'cross-venue-rv' : 'time-ladder-arb'
  const crossMarketUniverse = isCrossMarket ? createCrossMarketUniverse(summary, metrics, validationScope) : ''
  const crossMarketSamplePolicy = isCrossMarket ? createCrossMarketSamplePolicy(summary, metrics, validationScope) : ''
  return {
    id: summary.strategyId,
    name: summary.displayName,
    family,
    variant,
    instrument: 'VOO',
    desk: isCrossMarket ? 'Prediction market cross-venue relative value' : 'Prediction market deadline arbitrage',
    thesis: isCrossMarket
      ? 'Compare fixed comparable Kalshi and Polymarket contracts, then paper-trade the cheap YES leg against the rich NO leg while keeping rule text, settlement source, and venue basis under review.'
      : 'Find nested prediction-market deadline ladders where the earlier YES bid is above the later YES ask, then model the package buy NO earlier plus buy YES later as a tiny-capacity canary allocation.',
    directionPolicy: isCrossMarket
      ? 'Only paper-enter when the cross-venue midpoint gap clears fee and basis haircuts; every pair still needs rule-text, settlement-source, liquidity, restriction, and venue-basis review.'
      : 'Only enter when the detected package clears the selected gross-edge threshold, fee haircut, and pair-spacing rule; all rows remain paper/research until contract wording is reviewed.',
    promotionStatus: 'needs-more-validation',
    riskLevel: riskLevelFor(metrics),
    color: isCrossMarket ? '#0f766e' : '#7c3aed',
    liveRoutingEnabled: false,
    sourceUniverse: summary.selected.sourceUniverse,
    timingConvention: isCrossMarket ? 'prediction-cross-market-rv-v1' : 'prediction-market-time-ladder-v1',
    returnColumn: 'netReturnPct',
    universe: isCrossMarket
      ? crossMarketUniverse
      : `${summary.data.kalshiMarkets.toLocaleString()} Kalshi active markets and ${summary.data.polymarketMarkets.toLocaleString()} Polymarket active markets; ` +
        `${formatCount(summary.data.parsedDateThresholdMarkets)} parsed date-threshold markets and ${formatCount(summary.data.ladderPairs)} same-venue ladders.`,
    theoryAlignment: isCrossMarket
      ? 'Cross-venue relative-value check: compare matched probability curves or close economic substitutes, buy the cheaper probability, hedge with the richer opposite leg, and treat basis flags as paper-only brakes rather than live-order permission.'
      : 'Pure monotonicity check: if before-date A is a subset of before-date B, YES(A) should not be more expensive than YES(B). Positive rows are treated as pricing-discrepancy observations, not proof of settlement-safe arbitrage.',
    samplePolicy: isCrossMarket
      ? crossMarketSamplePolicy
      : `${summary.contract.selectionPolicy} Historical proof uses ${summary.data.historicalObservations.toLocaleString()} Kalshi candle observations across ${summary.data.historicalPairsRequested} ladder pairs from ${summary.data.historicalStartDate} through ${summary.data.historicalEndDate}.`,
    tradeFile: summary.outputFiles.selectedTrades,
    params: {
      candidateId: summary.selected.candidateId,
      family,
      variant,
      architecture: summary.selected.architectureLabel,
      sourceSet: summary.selected.sourceSetLabel,
      sourceIds: summary.selected.sourceIds,
      minGrossEdgeCents: summary.selected.minGrossEdgeCents,
      feeHaircutCents: summary.selected.feeHaircutCents,
      minSpacingHours: summary.selected.minSpacingHours,
      capitalAllocationPct: summary.selected.capitalAllocationPct,
      fallback: summary.contract.fallback,
      splitEdges: splitMetricsForScope(summary.selected.splitEdges, validationScope),
      splitAnnualEdges: splitMetricsForScope(summary.selected.splitAnnualEdges, validationScope),
      splitTotalReturns: splitMetricsForScope(summary.selected.splitTotalReturns ?? summary.selected.splitEdges, validationScope),
      validationScope,
      currentPaperScanFreshness: scanFreshness,
      search: { ...summary.search, validationScope },
      candidateDiagnostics: candidateDiagnosticsFromCsv(candidateSummaryCsv, summary, validationScope),
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
const predictionTimeLadderStrategy = createPredictionTimeLadderStrategy(
  predictionTimeLadderSummary,
  predictionTimeLadderTrades,
  predictionTimeLadderCandidatesCsv,
)
const predictionCrossMarketSummary = JSON.parse(predictionCrossMarketSummaryJson) as PredictionTimeLadderSummary
const predictionCrossMarketTrades = parsePredictionTimeLadderTrades(predictionCrossMarketTradesCsv)
const predictionCrossMarketStrategy = createPredictionTimeLadderStrategy(
  predictionCrossMarketSummary,
  predictionCrossMarketTrades,
  predictionCrossMarketCandidatesCsv,
)
const predictionCrossMarketBacktestResult: PredictionTimeLadderBacktestResult = {
  strategy: predictionCrossMarketStrategy,
  researchMetrics: predictionCrossMarketStrategy.metrics,
  metrics: createBacktestMetrics(predictionCrossMarketSummary.selected.allMetrics),
  curve: curveFromTrades(predictionCrossMarketTrades),
  trades: predictionCrossMarketTrades,
  joined: [],
}

export const predictionTimeLadderResearchStrategies: PredictionTimeLadderResearchStrategy[] = [
  predictionTimeLadderStrategy,
  predictionCrossMarketStrategy,
]
export const predictionTimeLadderResearchBacktestResults: PredictionTimeLadderBacktestResult[] = [
  {
    strategy: predictionTimeLadderStrategy,
    researchMetrics: predictionTimeLadderStrategy.metrics,
    metrics: createBacktestMetrics(predictionTimeLadderSummary.selected.allMetrics),
    curve: curveFromTrades(predictionTimeLadderTrades),
    trades: predictionTimeLadderTrades,
    joined: [],
  },
  predictionCrossMarketBacktestResult,
]
