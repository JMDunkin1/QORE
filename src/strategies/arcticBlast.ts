import Papa from 'papaparse'
import type { ExecutionInstrumentCode, StrategySignalIntent, TradeDirection } from '../execution'
import type { BacktestMetrics, EquityPoint } from '../types'
import weatherHybridSummaryJson from '../../data/qore/research/strategy-agent-runs/weather-hybrid-rotation/run-summary.json?raw'
import weatherHybridTradesCsv from '../../data/qore/research/strategy-agent-runs/weather-hybrid-rotation/selected-trades.csv?raw'
import volatilityMeanReversionSummaryJson from '../../data/qore/research/strategy-agent-runs/volatility-mean-reversion/run-summary.json?raw'
import volatilityMeanReversionTradesCsv from '../../data/qore/research/strategy-agent-runs/volatility-mean-reversion/selected-trades.csv?raw'

export type ArcticBlastStrategyFamily = 'volatility' | 'weather-hybrid'
export type ArcticBlastStrategyVariant = 'market-technical' | 'hybrid-rotation'

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
  timingConvention: 'close-after-issue-v1' | 'next-session-open-close-v1' | 'daily-weather-rotation-v1'
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

type VolatilitySummaryMetrics = {
  totalReturnPct: number
  cagrPct: number
  sharpe: number
  sortino: number
  maxDrawdownPct: number
  winRatePct: number
  profitFactor: number
  tradeCount: number
  averageTradeReturnPct: number
  firstEntry: string
  lastExit: string
}

type VolatilitySummary = {
  strategyId: string
  selected: {
    candidateId: string
    volatilityLookbackSessions: number
    reversalZThreshold: number
    minVolatilityPct: number
    maxVolatilityPct: number
    allMetrics: VolatilitySummaryMetrics
  }
  contract: {
    trainCutoff: string
    roundTripCostPct: number
    positionFraction: number
    signalTiming: string
    entryExit: string
    noLookahead: string
    selectionPolicy: string
  }
  data: {
    marketFile: string
    marketStartDate: string
    marketEndDate: string
  }
  outputFiles: {
    selectedTrades: string
  }
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
  indexReturnPct?: number
  ungPosition?: number
  ungReturnPct?: number
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

const volatilityStrategyColor = '#0891b2'
const weatherHybridStrategyColor = '#7c3aed'

export const arcticBlastPromotionGates = [
  'Keep next-session open-to-close entries strictly after the signal-date close.',
  'Select thresholds using train data only; holdout rows stay report-only.',
  'Track long-after-down-shock and short-after-up-shock legs separately.',
  'Track weather-hybrid return against the index basket, not just absolute return.',
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

function parseVolatilityTrades(csv: string): ArcticBlastTrade[] {
  return parseCsv<Record<string, string>>(csv).map((row) => ({
    strategyId: row.strategyId,
    variant: 'market-technical',
    issueDate: row.signalDate,
    targetDate: row.exitTradeDate,
    entryTradeDate: row.entryTradeDate,
    targetTradeDate: row.exitTradeDate,
    sourceId: 'UNG market',
    windowId: 'next-session-open-close',
    thesisKind: 'volatility-reversion',
    leadDays: 1,
    direction: row.direction === 'short' ? 'short' : 'long',
    weightedAnomalyF: numberFrom(row.previousReturnPct),
    coveragePct: numberFrom(row.volatilityPct ?? row.volatility20dPct),
    coldCoveragePct: 0,
    warmCoveragePct: 0,
    extremeCount: 0,
    grossReturnPct: numberFrom(row.grossReturnPct),
    netReturnPct: numberFrom(row.netReturnPct),
    rank: Math.abs(numberFrom(row.reversalZ)),
  }))
}

function parseWeatherHybridTrades(csv: string): ArcticBlastTrade[] {
  return parseCsv<Record<string, string>>(csv).map((row) => ({
    strategyId: row.strategyId,
    variant: 'hybrid-rotation',
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
    indexReturnPct: numberFrom(row.indexReturnPct),
    ungPosition: numberFrom(row.ungPosition),
    ungReturnPct: numberFrom(row.ungReturnPct),
  }))
}

function sourceUniverseFor(trades: ArcticBlastTrade[]) {
  return [...new Set(trades.map((trade) => trade.sourceId))].sort()
}

function createVolatilityMetrics(summary: VolatilitySummary): ArcticBlastStrategyMetrics {
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
    averageTradeReturnPct: metrics.averageTradeReturnPct,
    averageHoldDays: 1,
    firstEntry: metrics.firstEntry,
    lastExit: metrics.lastExit,
  }
}

function createVolatilityStrategy(summary: VolatilitySummary, trades: ArcticBlastTrade[]): ArcticBlastResearchStrategy {
  const metrics = createVolatilityMetrics(summary)
  const { selected, contract } = summary
  return {
    id: summary.strategyId,
    name: 'Volatility Mean Reversion',
    family: 'volatility',
    variant: 'market-technical',
    instrument: 'UNG',
    desk: 'Winter UNG volatility',
    thesis:
      `UNG tends to mean-revert intraday after unusually large winter close-to-close moves when measured against trailing ${selected.volatilityLookbackSessions}-session volatility.`,
    directionPolicy:
      'After the signal-date close, go long next-session open-to-close after a negative volatility shock and short next-session open-to-close after a positive volatility shock.',
    promotionStatus: 'research-baseline',
    riskLevel: riskLevelFor(metrics),
    color: volatilityStrategyColor,
    liveRoutingEnabled: false,
    sourceUniverse: sourceUniverseFor(trades),
    timingConvention: 'next-session-open-close-v1',
    returnColumn: 'netReturnPct',
    universe: `UNG winter daily bars from ${summary.data.marketStartDate} through ${summary.data.marketEndDate}.`,
    theoryAlignment: 'Market-technical winter UNG volatility reversion; not an Arctic Blast forecast-following signal.',
    samplePolicy:
      `Train-only grid before ${contract.trainCutoff}; selected ${selected.candidateId}; ` +
      `${selected.volatilityLookbackSessions}-session volatility; ${contract.positionFraction}x notional; ${contract.roundTripCostPct}% round-trip cost.`,
    tradeFile: summary.outputFiles.selectedTrades,
    params: {
      candidateId: selected.candidateId,
      family: 'volatility',
      variant: 'market-technical',
      volatilityLookbackSessions: selected.volatilityLookbackSessions,
      reversalZThreshold: selected.reversalZThreshold,
      minVolatilityPct: selected.minVolatilityPct,
      maxVolatilityPct: selected.maxVolatilityPct,
      positionFraction: contract.positionFraction,
      roundTripCostPct: contract.roundTripCostPct,
      signalTiming: contract.signalTiming,
      entryExit: contract.entryExit,
      noLookahead: contract.noLookahead,
      selectionPolicy: contract.selectionPolicy,
      sourceUniverse: sourceUniverseFor(trades),
    },
    metrics,
    caveat:
      'Active research baseline. The rejected weather-forecast variants remain archived as research evidence, but this is the only strategy loaded into the registry.',
  }
}

function createHybridMetrics(summary: HybridSummary): ArcticBlastStrategyMetrics {
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

function createHybridBacktestMetrics(summary: HybridSummary): BacktestMetrics {
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

function createWeatherHybridStrategy(summary: HybridSummary, trades: ArcticBlastTrade[]): ArcticBlastResearchStrategy {
  const metrics = createHybridMetrics(summary)
  const { selected, contract } = summary
  return {
    id: summary.strategyId,
    name: 'Weather Hybrid Rotation',
    family: 'weather-hybrid',
    variant: 'hybrid-rotation',
    instrument: 'UNG',
    desk: 'Winter weather rotation',
    thesis:
      'Capital stays in the US index basket by default, then rotates a measured UNG overlay around high-confidence 7-10 day winter cold/warm forecast windows and post-window overreaction fades.',
    directionPolicy:
      selected.useFollowLeg && selected.useReversionLeg
        ? 'Trade the weather-demand direction first, then fade large realized UNG moves after the weather window.'
        : selected.useReversionLeg
          ? 'Use weather fear as the setup, then fade the realized UNG move after the forecast window.'
          : 'Trade the weather-demand direction while idle capital remains in the index basket.',
    promotionStatus: 'research-baseline',
    riskLevel: riskLevelFor(metrics),
    color: weatherHybridStrategyColor,
    liveRoutingEnabled: false,
    sourceUniverse: sourceUniverseFor(trades),
    timingConvention: 'daily-weather-rotation-v1',
    returnColumn: 'netReturnPct',
    universe: `UNG and US index basket daily bars from ${summary.data.marketStartDate} through ${summary.data.marketEndDate}.`,
    theoryAlignment:
      'Direct Arctic Blast thesis lane: forecast-driven cold/warm demand risk plus post-window overreaction control, with index fallback when confidence is low.',
    samplePolicy:
      `Selected ${selected.architectureLabel} on train/validation only; train through ${contract.trainEnd}, validation through ${contract.validationEnd}, holdout from ${contract.holdoutStart}.`,
    tradeFile: summary.outputFiles.selectedTrades,
    params: {
      candidateId: selected.candidateId,
      family: 'weather-hybrid',
      variant: 'hybrid-rotation',
      architecture: selected.architectureLabel,
      sourceSet: selected.sourceSetLabel,
      sourceIds: selected.sourceIds,
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
      fallback: contract.fallback,
      roundTripCostPct: contract.roundTripCostPct,
      splitEdges: selected.splitEdges,
      indexMetrics: selected.indexMetrics,
      selectionPolicy: contract.selectionPolicy,
      signalTiming: contract.signalTiming,
      reversionTiming: contract.reversionTiming,
      sourceUniverse: sourceUniverseFor(trades),
    },
    metrics,
    caveat:
      `Holdout is one winter so far: ${signedSplitEdge(selected.splitEdges.holdout)} edge versus the index basket after train/validation selection.`,
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

const volatilitySummary = JSON.parse(volatilityMeanReversionSummaryJson) as VolatilitySummary
const volatilityTrades = parseVolatilityTrades(volatilityMeanReversionTradesCsv)
const weatherHybridSummary = JSON.parse(weatherHybridSummaryJson) as HybridSummary
const weatherHybridTrades = parseWeatherHybridTrades(weatherHybridTradesCsv)
const tradesByStrategyId = new Map([
  [weatherHybridSummary.strategyId, weatherHybridTrades] as const,
  [volatilitySummary.strategyId, volatilityTrades] as const,
])

export const arcticBlastResearchStrategies: ArcticBlastResearchStrategy[] = [
  createWeatherHybridStrategy(weatherHybridSummary, weatherHybridTrades),
  createVolatilityStrategy(volatilitySummary, volatilityTrades),
]

export const arcticBlastResearchBacktestResults: ArcticBlastResearchBacktestResult[] = arcticBlastResearchStrategies.map((strategy) => {
  const trades = tradesByStrategyId.get(strategy.id) ?? []
  return {
    strategy,
    researchMetrics: strategy.metrics,
    metrics: strategy.id === weatherHybridSummary.strategyId ? createHybridBacktestMetrics(weatherHybridSummary) : metricsFromResearch(strategy.metrics, trades),
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
