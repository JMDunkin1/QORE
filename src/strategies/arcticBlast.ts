import Papa from 'papaparse'
import type { ExecutionInstrumentCode, StrategySignalIntent, TradeDirection } from '../execution'
import type { BacktestMetrics, EquityPoint } from '../types'
import summaryCsv from '../../data/qore/research/strategy-tests/arctic-blast-strategy-baselines.csv?raw'
import strictTheoryElasticNetTradesCsv from '../../data/qore/research/strategy-tests/strict-theory-elastic-net-expected-return-trades.csv?raw'
import strictTheoryGradientBoostedTreesTradesCsv from '../../data/qore/research/strategy-tests/strict-theory-gradient-boosted-trees-trades.csv?raw'
import strictTheoryMetaLabelTradesCsv from '../../data/qore/research/strategy-tests/strict-theory-meta-label-trade-filter-trades.csv?raw'
import strictTheoryLogisticTradesCsv from '../../data/qore/research/strategy-tests/strict-theory-regularized-logistic-regression-trades.csv?raw'
import strictTheoryRuleTradesCsv from '../../data/qore/research/strategy-tests/strict-theory-rule-arctic-threshold-trades.csv?raw'

export type ArcticBlastStrategyFamily = 'rule' | 'logistic' | 'elastic-net' | 'gradient-boosted-trees' | 'meta-label'
export type ArcticBlastStrategyVariant = 'strict-theory'

export type StrategyPromotionStatus = 'research-baseline' | 'paper-candidate' | 'needs-more-validation'

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

const minTradesForPrimaryRank = 8

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
  timingConvention: 'close-after-issue-v1'
  returnColumn: 'returnPctEntryCloseToTarget'
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

type BaselineRow = {
  strategyId: string
  variant: ArcticBlastStrategyVariant
  label: string
  universe: string
  theoryAlignment: string
  samplePolicy: string
  totalReturnPct: string
  cagrPct: string
  sharpe: string
  sortino: string
  maxDrawdownPct: string
  winRatePct: string
  profitFactor: string
  tradeCount: string
  averageTradeReturnPct: string
  averageHoldDays: string
  firstEntry: string
  lastExit: string
  tradeFile: string
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

const tradeCsvByStrategyId: Record<string, string> = {
  'strict-theory-rule-arctic-threshold': strictTheoryRuleTradesCsv,
  'strict-theory-regularized-logistic-regression': strictTheoryLogisticTradesCsv,
  'strict-theory-elastic-net-expected-return': strictTheoryElasticNetTradesCsv,
  'strict-theory-gradient-boosted-trees': strictTheoryGradientBoostedTreesTradesCsv,
  'strict-theory-meta-label-trade-filter': strictTheoryMetaLabelTradesCsv,
}

const strategyColors = [
  '#2563eb',
  '#0f766e',
  '#f97316',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#65a30d',
  '#b45309',
  '#be185d',
  '#475569',
]

export const arcticBlastPromotionGates = [
  'Pass no-lookahead timing review using returnPctEntryCloseToTarget only.',
  'Report cold-long and warm-short legs separately before promotion.',
  'Re-run after each added winter or forecast-calendar backfill.',
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

function familyFromId(strategyId: string): ArcticBlastStrategyFamily {
  if (strategyId.includes('regularized-logistic')) return 'logistic'
  if (strategyId.includes('elastic-net')) return 'elastic-net'
  if (strategyId.includes('gradient-boosted-trees')) return 'gradient-boosted-trees'
  if (strategyId.includes('meta-label')) return 'meta-label'
  return 'rule'
}

function riskLevelFor(metrics: ArcticBlastStrategyMetrics): ArcticBlastResearchStrategy['riskLevel'] {
  if (metrics.maxDrawdownPct <= -25) return 'High'
  if (metrics.maxDrawdownPct <= -12) return 'Medium'
  return 'Low'
}

function promotionStatusFor(metrics: ArcticBlastStrategyMetrics): StrategyPromotionStatus {
  return metrics.tradeCount >= minTradesForPrimaryRank ? 'research-baseline' : 'needs-more-validation'
}

function parseMetrics(row: BaselineRow): ArcticBlastStrategyMetrics {
  return {
    totalReturnPct: numberFrom(row.totalReturnPct),
    cagrPct: numberFrom(row.cagrPct),
    sharpe: numberFrom(row.sharpe),
    sortino: numberFrom(row.sortino),
    maxDrawdownPct: numberFrom(row.maxDrawdownPct),
    winRatePct: numberFrom(row.winRatePct),
    profitFactor: numberFrom(row.profitFactor),
    tradeCount: numberFrom(row.tradeCount),
    averageTradeReturnPct: numberFrom(row.averageTradeReturnPct),
    averageHoldDays: numberFrom(row.averageHoldDays),
    firstEntry: row.firstEntry,
    lastExit: row.lastExit,
  }
}

function parseTrades(csv: string): ArcticBlastTrade[] {
  return parseCsv<Record<string, string>>(csv).map((row) => ({
    strategyId: row.strategyId,
    variant: row.variant as ArcticBlastStrategyVariant,
    issueDate: row.issueDate,
    targetDate: row.targetDate,
    entryTradeDate: row.entryTradeDate,
    targetTradeDate: row.targetTradeDate,
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
  }))
}

function sourceUniverseFor(trades: ArcticBlastTrade[]) {
  return [...new Set(trades.map((trade) => trade.sourceId))].sort()
}

function createStrategy(row: BaselineRow, index: number, trades: ArcticBlastTrade[]): ArcticBlastResearchStrategy {
  const metrics = parseMetrics(row)
  return {
    id: row.strategyId,
    name: row.label,
    family: familyFromId(row.strategyId),
    variant: row.variant,
    instrument: 'UNG',
    desk: 'Winter Weather Demand strict theory',
    thesis: `${row.universe} ${row.samplePolicy}`,
    directionPolicy:
      'Theory-fixed: long UNG when independently confirmed winter 7-10 day cold raises heating demand; short UNG when independently confirmed winter 7-10 day warmth weakens heating demand.',
    promotionStatus: promotionStatusFor(metrics),
    riskLevel: riskLevelFor(metrics),
    color: strategyColors[index % strategyColors.length],
    liveRoutingEnabled: false,
    sourceUniverse: sourceUniverseFor(trades),
    timingConvention: 'close-after-issue-v1',
    returnColumn: 'returnPctEntryCloseToTarget',
    universe: row.universe,
    theoryAlignment: row.theoryAlignment,
    samplePolicy: row.samplePolicy,
    tradeFile: row.tradeFile,
    params: {
      variant: row.variant,
      family: familyFromId(row.strategyId),
      theoryAlignment: row.theoryAlignment,
      sourceUniverse: sourceUniverseFor(trades),
    },
    metrics,
    caveat: row.samplePolicy,
  }
}

function curveFromTrades(trades: ArcticBlastTrade[]): ArcticBlastEquityPoint[] {
  let equity = initialCapital
  let peak = initialCapital

  return trades
    .slice()
    .sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate) || a.targetTradeDate.localeCompare(b.targetTradeDate))
    .map((trade) => {
      const previousEquity = equity
      equity = Math.max(1, equity * (1 + trade.netReturnPct / 100))
      peak = Math.max(peak, equity)
      const direction = trade.direction === 'short' ? -1 : 1
      return {
        date: trade.targetTradeDate,
        equity: round(equity, 2),
        equityPct: round((equity / initialCapital - 1) * 100, 2),
        dailyPnlPct: round(previousEquity ? ((equity - previousEquity) / previousEquity) * 100 : 0, 3),
        drawdownPct: round(((equity - peak) / peak) * 100, 2),
        close: 0,
        weatherSurprise: round(trade.weightedAnomalyF, 2),
        hddError: round(trade.weightedAnomalyF, 2),
        position: direction,
        signal: direction,
        gasReturnPct: round(trade.netReturnPct, 3),
        demandScore: round(trade.rank, 3),
        storageBcf: 0,
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

const baselineRows = parseCsv<BaselineRow>(summaryCsv)
const tradesByStrategyId = new Map(
  Object.entries(tradeCsvByStrategyId).map(([strategyId, csv]) => [strategyId, parseTrades(csv)]),
)

export const arcticBlastResearchStrategies: ArcticBlastResearchStrategy[] = baselineRows.map((row, index) =>
  createStrategy(row, index, tradesByStrategyId.get(row.strategyId) ?? []),
)

export const arcticBlastResearchBacktestResults: ArcticBlastResearchBacktestResult[] = arcticBlastResearchStrategies.map((strategy) => {
  const trades = tradesByStrategyId.get(strategy.id) ?? []
  return {
    strategy,
    researchMetrics: strategy.metrics,
    metrics: metricsFromResearch(strategy.metrics, trades),
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
