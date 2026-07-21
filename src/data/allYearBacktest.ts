import Papa from 'papaparse'
import allYearSummaryJson from '../../data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json?raw'
import allYearDisplayCurveCsv from '../../data/qore/research/strategy-agent-runs/ngas-all-year-beta/display-curve.csv?raw'
import overnightRiskCandidatesCsv from '../../data/qore/research/strategy-agent-runs/ngas-all-year-beta/overnight-risk-candidate-summary.csv?raw'
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
  gasTurnover?: number
  indexTurnover?: number
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
  signalInstrument: string
  direction: string
  sourceId: string
  confidence: number
  priorCloseThesisKind: string
  priorCloseReturnContributionPct: number
  currentSessionReturnContributionPct: number
}

type Percentiles = { p05: number; p50: number; p95: number }

type SplitKey = 'all' | 'train' | 'validation' | 'holdout'

type RealityCheck = {
  method: string
  pValue: number
  observedAverageDailyEdgePct: number
  observedAnnualizedEdgePct: number
  meanConfidenceIntervalDailyEdgePct: Percentiles
  nullConfidenceIntervalDailyEdgePct: Percentiles
  sampleCount: number
  sampleStartDate: string
  sampleEndDate: string
  activeOverlayDays: number
  iterations: number
  blockLength: number
}

export const promotionGateKeys = [
  'positiveTrainEdge',
  'positiveValidationEdge',
  'preHoldoutBootstrapSignificance',
  'trainMaxDrawdown',
  'validationMaxDrawdown',
  'summerComponent',
  'winterComponent',
  'liveContract',
  'liveTargetParity',
  'brokerExecution',
  'pristineForwardEvidence',
  'strategyContractSeal',
  'paperApproval',
  'paperExecutionEvidence',
  'liveApproval',
] as const

type PromotionGateKey = (typeof promotionGateKeys)[number]
type PromotionGates = Record<PromotionGateKey, boolean>

type AllYearSummary = {
  generatedAt: string
  strategyId: string
  displayName: string
  status: 'research-baseline' | 'needs-validation'
  data: {
    marketStartDate: string
    marketEndDate: string
    marketDays: number
  }
  contract: {
    trainEnd: string
    selectionEnd: string
    validationEnd: string
    holdoutStart: string
    selectionPolicy: string
    signalTiming: string
    overfitControl: string
    researchInstruments: {
      summer: { componentStrategyId: string; gasSymbol: string; signalSymbol: string; contract: string }
      winter: { componentStrategyId: string; gasSymbol: string; signalSymbol: string; contract: string }
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
    indexMetrics: Record<SplitKey, BacktestMetrics>
    splitEdges: Record<SplitKey, number>
    splitAnnualEdges: Record<SplitKey, number>
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
    selectionRealityCheck: RealityCheck
    selectionMetrics: {
      throughDate: string
      strategy: Record<SplitKey, BacktestMetrics>
      index: Record<SplitKey, BacktestMetrics>
      splitEdges: Record<SplitKey, number>
    }
    promotionGates: PromotionGates
    realityCheck: RealityCheck
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

type OvernightRiskHeatmapCell = {
  eligible: boolean
  lookbackSessions: number
  policyId: string
  researchLeader: boolean
  thresholdPct: number
  validationReturnPct: number
  validationSharpe: number
}

function parseAllYearSummary(raw: string): AllYearSummary {
  const parsed = JSON.parse(raw) as { validation?: { promotionGates?: unknown } }
  const gates = parsed?.validation?.promotionGates
  if (!gates || typeof gates !== 'object' || Array.isArray(gates)) {
    throw new Error('All-year research artifact promotionGates must be an object.')
  }
  const expectedKeys = [...promotionGateKeys].sort()
  const actualKeys = Object.keys(gates).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `All-year research artifact promotionGates must exactly match the browser contract: expected ${expectedKeys.join(', ')}; received ${actualKeys.join(', ')}.`,
    )
  }
  for (const key of promotionGateKeys) {
    if ((gates as Record<string, unknown>)[key] !== true && (gates as Record<string, unknown>)[key] !== false) {
      throw new Error(`All-year research artifact promotionGates.${key} must be boolean.`)
    }
  }
  return parsed as AllYearSummary
}

const summary = parseAllYearSummary(allYearSummaryJson)

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
  const thesisKind = row.thesisKind || 'index-fallback'
  const priorCloseThesisKind = row.priorCloseThesisKind || 'index-fallback'

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
    thesisKind,
    equityUsd: numberFrom(row.equityUsd, 100_000),
    component: (row.component || 'summer-alpha') as StrategyTrade['component'],
    researchInstrument: row.researchInstrument || 'unknown',
    signalInstrument: row.signalInstrument || 'unknown',
    direction: row.direction || 'flat',
    sourceId: row.sourceId || 'unknown',
    confidence: numberFrom(row.confidence),
    priorCloseThesisKind,
    priorCloseReturnContributionPct: numberFrom(row.priorCloseReturnContributionPct),
    currentSessionReturnContributionPct: numberFrom(row.currentSessionReturnContributionPct, numberFrom(row.netReturnPct)),
  }
})

export const backtestPoints: BacktestPoint[] = allYearTrades

export const allYearBacktest = summary

const parsedOvernightRiskCandidates = Papa.parse<RawDisplayRow>(overnightRiskCandidatesCsv, {
  header: true,
  skipEmptyLines: true,
  transformHeader: (header) => header.trim(),
}).data

const overnightRiskCells: OvernightRiskHeatmapCell[] = parsedOvernightRiskCandidates
  .filter((row) => row.policyType === 'lagged-mean-absolute-gap' && row.scenarioId === 'baseline')
  .map((row) => ({
    eligible: row.selectionEligible === 'true',
    lookbackSessions: numberFrom(row.lookbackSessions),
    policyId: row.policyId,
    researchLeader: row.selectionRank === '1',
    thresholdPct: numberFrom(row.thresholdPct),
    validationReturnPct: numberFrom(row.validationTotalReturnPct),
    validationSharpe: numberFrom(row.validationSharpe),
  }))

export const overnightRiskHeatmap = {
  cells: overnightRiskCells,
  lookbacks: [...new Set(overnightRiskCells.map((cell) => cell.lookbackSessions))].sort((first, second) => second - first),
  thresholds: [...new Set(overnightRiskCells.map((cell) => cell.thresholdPct))].sort((first, second) => first - second),
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

type CausalSleeve = {
  rowCount: number
  returnsByDate: Map<string, number>
}

const causalSleeves = new Map<string, CausalSleeve>()

function sleeveFor(id: string) {
  const existing = causalSleeves.get(id)
  if (existing) return existing
  const created = { rowCount: 0, returnsByDate: new Map<string, number>() }
  causalSleeves.set(id, created)
  return created
}

for (const trade of allYearTrades) {
  sleeveFor(trade.thesisKind).rowCount += 1
  const contributions = [
    { id: trade.priorCloseThesisKind, returnPct: trade.priorCloseReturnContributionPct },
    { id: trade.thesisKind, returnPct: trade.currentSessionReturnContributionPct },
  ]
  for (const contribution of contributions) {
    const sleeve = sleeveFor(contribution.id)
    sleeve.returnsByDate.set(
      trade.date,
      (sleeve.returnsByDate.get(trade.date) ?? 0) + contribution.returnPct,
    )
  }
}

export const sleeveStats = [...causalSleeves.entries()]
  .map(([id, sleeve]) => {
    const dailyReturns = [...sleeve.returnsByDate.entries()]
      .sort(([firstDate], [secondDate]) => firstDate.localeCompare(secondDate))
      .map(([, returnPct]) => returnPct)
    const compounded = dailyReturns.reduce((equity, returnPct) => equity * (1 + returnPct / 100), 1)
    const wins = dailyReturns.filter((returnPct) => returnPct > 0).length
    return {
      id,
      label: sleeveLabels[id] ?? id,
      rowCount: sleeve.rowCount,
      totalReturnPct: round((compounded - 1) * 100, 2),
      winRatePct: round((wins / Math.max(dailyReturns.length, 1)) * 100, 1),
      averageReturnPct: round(dailyReturns.reduce((sum, returnPct) => sum + returnPct, 0) / Math.max(dailyReturns.length, 1), 3),
    }
  })
  .sort((first, second) => second.rowCount - first.rowCount)
