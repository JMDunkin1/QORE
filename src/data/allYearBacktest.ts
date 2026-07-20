import Papa from 'papaparse'
import allYearSummaryJson from '../../data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json?raw'
import allYearDisplayCurveCsv from '../../data/qore/research/strategy-agent-runs/ngas-all-year-beta/display-curve.csv?raw'
import weatherQualityJson from '../../data/qore/research/ngas-weather-quality-summary.json?raw'

export type BacktestMetrics = {
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
}

export type BacktestPoint = {
  chartIndex: number
  date: string
  equityPct: number
  benchmarkPct: number
  drawdownPct: number
  activeReturnPct: number
  position: number
  signal: number
  netReturnPct: number
  indexReturnPct: number
  split: 'train' | 'validation' | 'holdout'
  thesisKind: string
}

export type StrategyTrade = BacktestPoint & {
  equityUsd: number
  component: 'summer-alpha' | 'winter-alpha'
  researchInstrument: string
  direction: string
  sourceId: string
  confidence: number
}

type Percentiles = { p05: number; p50: number; p95: number }

type AllYearSummary = {
  generatedAt: string
  strategyId: string
  displayName: string
  data: {
    marketStartDate: string
    marketEndDate: string
    marketDays: number
  }
  contract: {
    selectionPolicy: string
    signalTiming: string
    overfitControl: string
    researchInstruments: {
      summer: { componentStrategyId: string; gasSymbol: string; contract: string }
      winter: { componentStrategyId: string; gasSymbol: string; contract: string }
      indexFallback: { symbol: string; contract: string }
    }
    executionInstrument: { gasSymbol: string; contract: string }
    maxDrawdownPromotionFloorPct: number
  }
  selected: {
    candidateId: string
    allMetrics: BacktestMetrics
    trainMetrics: BacktestMetrics
    validationMetrics: BacktestMetrics
    holdoutMetrics: BacktestMetrics
    indexMetrics: Record<'all' | 'train' | 'validation' | 'holdout', BacktestMetrics>
    splitEdges: Record<'all' | 'train' | 'validation' | 'holdout', number>
    splitAnnualEdges: Record<'all' | 'train' | 'validation' | 'holdout', number>
    componentTradeCounts: { summer: number; winter: number }
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
    realityCheck: {
      method: string
      pValue: number
      observedAverageDailyEdgePct: number
      observedAnnualizedEdgePct: number
      meanConfidenceIntervalDailyEdgePct: Percentiles
      nullConfidenceIntervalDailyEdgePct: Percentiles
      sampleCount: number
      activeOverlayDays: number
      iterations: number
      blockLength: number
    }
    componentRealityChecks: Record<string, { pValue: number; bestObservedCandidateId?: string; candidateFamilySize?: number }>
  }
}

type WeatherQuality = {
  generatedAt: string
  sourceCount: number
  rowCount: number
  maeF: number
  rmseF: number
  biasF: number
  r2: number
  directionalAccuracyPct: number
  coldRecallPct: number
  coldEventThresholdF: number
}

type RawDisplayRow = Record<string, string>

const summary = JSON.parse(allYearSummaryJson) as AllYearSummary

export const weatherQuality = JSON.parse(weatherQualityJson) as WeatherQuality

function numberFrom(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const parsedTrades = Papa.parse<RawDisplayRow>(allYearDisplayCurveCsv, {
  header: true,
  skipEmptyLines: true,
  transformHeader: (header) => header.trim(),
}).data

export const allYearTrades: StrategyTrade[] = parsedTrades.map((row, rowIndex) => {
  return {
    chartIndex: numberFrom(row.chartIndex, rowIndex),
    date: row.date,
    equityPct: numberFrom(row.equityPct),
    benchmarkPct: numberFrom(row.benchmarkPct),
    drawdownPct: numberFrom(row.drawdownPct),
    activeReturnPct: numberFrom(row.activeReturnPct),
    position: numberFrom(row.position),
    signal: numberFrom(row.signal),
    netReturnPct: numberFrom(row.netReturnPct),
    indexReturnPct: numberFrom(row.indexReturnPct),
    split: (row.split || 'train') as BacktestPoint['split'],
    thesisKind: row.thesisKind || 'index-fallback',
    equityUsd: numberFrom(row.equityUsd, 100_000),
    component: (row.component || 'summer-alpha') as StrategyTrade['component'],
    researchInstrument: row.researchInstrument || 'unknown',
    direction: row.direction || 'flat',
    sourceId: row.sourceId || 'unknown',
    confidence: numberFrom(row.confidence),
  }
})

export const backtestPoints: BacktestPoint[] = allYearTrades

export const allYearBacktest = {
  ...summary,
  status:
    summary.selected.splitEdges.holdout > 0 &&
    summary.validation.realityCheck.pValue < 0.05 &&
    summary.selected.allMetrics.maxDrawdownPct > summary.contract.maxDrawdownPromotionFloorPct
      ? ('research-baseline' as const)
      : ('needs-validation' as const),
}

const sleeveLabels: Record<string, string> = {
  'cold-long': 'Winter cold / long gas',
  'warm-short': 'Winter warmth / short gas',
  'summer-heat-long': 'Summer heat / long gas',
  'summer-cold-short': 'Summer cool / short gas',
  'reversion-long': 'Weather reversion / long',
  'reversion-short': 'Weather reversion / short',
  'index-fallback': 'Index fallback',
}

export const sleeveStats = Object.entries(
  allYearTrades.reduce<Record<string, StrategyTrade[]>>((groups, trade) => {
    ;(groups[trade.thesisKind] ??= []).push(trade)
    return groups
  }, {}),
)
  .map(([id, rows]) => {
    const compounded = rows.reduce((equity, row) => equity * (1 + row.netReturnPct / 100), 1)
    const wins = rows.filter((row) => row.netReturnPct > 0).length
    return {
      id,
      label: sleeveLabels[id] ?? id,
      rowCount: rows.length,
      totalReturnPct: round((compounded - 1) * 100, 2),
      winRatePct: round((wins / Math.max(rows.length, 1)) * 100, 1),
      averageReturnPct: round(rows.reduce((sum, row) => sum + row.netReturnPct, 0) / Math.max(rows.length, 1), 3),
    }
  })
  .sort((first, second) => second.rowCount - first.rowCount)

export const recentBacktestRows = allYearTrades.slice(-12).reverse()
