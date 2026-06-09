import type { ExecutionInstrumentCode, StrategySignalIntent, TradeDirection } from '../execution'

export type ArcticBlastStrategyFamily = 'rule' | 'logistic' | 'elastic-net' | 'gradient-boosted-trees' | 'meta-label'

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

export type ArcticBlastResearchStrategy = {
  id: string
  name: string
  family: ArcticBlastStrategyFamily
  instrument: ExecutionInstrumentCode
  directionPolicy: string
  promotionStatus: StrategyPromotionStatus
  liveRoutingEnabled: false
  sourceUniverse: string[]
  timingConvention: 'close-after-issue-v1'
  returnColumn: 'returnPctEntryCloseToTarget'
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

const commonContract = {
  instrument: 'UNG',
  timingConvention: 'close-after-issue-v1',
  returnColumn: 'returnPctEntryCloseToTarget',
  liveRoutingEnabled: false,
} as const

export const arcticBlastResearchStrategies: ArcticBlastResearchStrategy[] = [
  {
    ...commonContract,
    id: 'rule-arctic-threshold',
    name: 'Rule-based Arctic Blast threshold baseline',
    family: 'rule',
    directionPolicy: 'Grid-selected signed rule; compare against long-only credible baseline before promotion.',
    promotionStatus: 'needs-more-validation',
    sourceUniverse: ['gfs', 'gefs-mean'],
    tradeFile: 'data/qore/research/strategy-tests/experimental-rule-arctic-threshold-trades.csv',
    params: {
      windows: ['rumor', 'selloff'],
      maxWeightedAnomalyF: -2,
      minCoveragePct: 0,
      minExtremeCount: 0,
      directionMode: 'contrarian-theory',
      overlapPolicy: 'one best-ranked trade per entry date; no overlapping holding windows',
    },
    metrics: {
      totalReturnPct: 135.09,
      cagrPct: 18.16,
      sharpe: 0.81,
      sortino: 1.66,
      maxDrawdownPct: -33.83,
      winRatePct: 66.7,
      profitFactor: 2.18,
      tradeCount: 39,
      averageTradeReturnPct: 2.57,
      averageHoldDays: 6.1,
      firstEntry: '2021-02-01',
      lastExit: '2026-03-18',
    },
    caveat: 'Max-return grid selected a contrarian direction; keep the long-only lower-drawdown variant as the thesis-aligned baseline.',
  },
  {
    ...commonContract,
    id: 'regularized-logistic-regression',
    name: 'Regularized Logistic Regression',
    family: 'logistic',
    directionPolicy: 'Signed probability threshold: long above upper probability, short below lower probability.',
    promotionStatus: 'research-baseline',
    sourceUniverse: ['gfs', 'gefs-mean', 'gem-global', 'ecmwf-ifs'],
    tradeFile: 'data/qore/research/strategy-tests/experimental-regularized-logistic-regression-trades.csv',
    params: {
      trainCutoff: '2024-01-01',
      lambda: 0.03,
      l1Ratio: 0.7,
      classBalance: true,
      longThreshold: 0.52,
      shortThreshold: 0.44,
      directionMode: 'signed-probability',
    },
    metrics: {
      totalReturnPct: 156.23,
      cagrPct: 52.61,
      sharpe: 1.7,
      sortino: 4.52,
      maxDrawdownPct: -14.91,
      winRatePct: 59.5,
      profitFactor: 3.24,
      tradeCount: 42,
      averageTradeReturnPct: 2.45,
      averageHoldDays: 3,
      firstEntry: '2024-01-08',
      lastExit: '2026-03-31',
    },
    caveat: 'Best max-return run is stronger than stricter holdout checks; rerun after more winters before paper promotion.',
  },
  {
    ...commonContract,
    id: 'elastic-net-expected-return',
    name: 'Elastic Net expected-return regression',
    family: 'elastic-net',
    directionPolicy: 'Go long/short only when predicted return clears tuned expected-return thresholds.',
    promotionStatus: 'research-baseline',
    sourceUniverse: ['gefs-mean'],
    tradeFile: 'data/qore/research/strategy-tests/experimental-elastic-net-expected-return-trades.csv',
    params: {
      trainCutoff: '2024-01-01',
      alpha: 0.008,
      l1Ratio: 0.25,
      longThresholdPct: 1.2,
      shortThresholdPct: -0.8,
    },
    metrics: {
      totalReturnPct: 70.24,
      cagrPct: 27.04,
      sharpe: 0.88,
      sortino: 1.36,
      maxDrawdownPct: -24.01,
      winRatePct: 56.7,
      profitFactor: 1.88,
      tradeCount: 30,
      averageTradeReturnPct: 2.19,
      averageHoldDays: 4.8,
      firstEntry: '2024-01-02',
      lastExit: '2026-03-24',
    },
    caveat: 'Strict walk-forward variants were cleaner but much lower return; keep both views during validation.',
  },
  {
    ...commonContract,
    id: 'gradient-boosted-trees',
    name: 'Gradient Boosted Trees',
    family: 'gradient-boosted-trees',
    directionPolicy: 'Shallow boosted return model with signed thresholding.',
    promotionStatus: 'research-baseline',
    sourceUniverse: ['gfs'],
    tradeFile: 'data/qore/research/strategy-tests/experimental-gradient-boosted-trees-trades.csv',
    params: {
      trainCutoff: '2024-01-01',
      estimators: 45,
      maxDepth: 2,
      learningRate: 0.14,
      minLeaf: 12,
      longThresholdPct: 0.1,
      shortThresholdPct: -0.1,
    },
    metrics: {
      totalReturnPct: 112.49,
      cagrPct: 39.95,
      sharpe: 1.29,
      sortino: 2.08,
      maxDrawdownPct: -25.68,
      winRatePct: 59.5,
      profitFactor: 2.52,
      tradeCount: 37,
      averageTradeReturnPct: 2.31,
      averageHoldDays: 5.4,
      firstEntry: '2024-01-02',
      lastExit: '2026-03-31',
    },
    caveat: 'A broader boosted tree leaned heavily on calendar/price features; this registry keeps the weather-row baseline explicit.',
  },
  {
    ...commonContract,
    id: 'meta-label-trade-filter',
    name: 'Meta-labeling trade filter',
    family: 'meta-label',
    directionPolicy: 'Start from Arctic Blast candidates and accept only classifier-approved trades.',
    promotionStatus: 'paper-candidate',
    sourceUniverse: ['gfs', 'gefs-mean'],
    tradeFile: 'data/qore/research/strategy-tests/experimental-meta-label-trade-filter-trades.csv',
    params: {
      trainCutoff: '2024-01-01',
      baseRule: {
        windows: ['rumor', 'selloff'],
        directionMode: 'theory',
        maxWeightedAnomalyF: -2,
        minCoveragePct: 0,
        minExtremeCount: 0,
      },
      lambda: 0.008,
      l1Ratio: 0.25,
      classBalance: true,
      acceptThreshold: 0.7,
    },
    metrics: {
      totalReturnPct: 47.9,
      cagrPct: 19.78,
      sharpe: 1.28,
      sortino: 26.69,
      maxDrawdownPct: -2.89,
      winRatePct: 77.8,
      profitFactor: 8.97,
      tradeCount: 9,
      averageTradeReturnPct: 4.67,
      averageHoldDays: 2.6,
      firstEntry: '2024-01-16',
      lastExit: '2026-03-18',
    },
    caveat: 'Low trade count and strict non-overlap make this a watchlist candidate, not a deployable edge.',
  },
]

export const arcticBlastPromotionGates = [
  'Pass no-lookahead timing review using returnPctEntryCloseToTarget only.',
  'Re-run after each added winter or forecast-calendar backfill.',
  'Prove a non-overlapping paper ledger before any broker adapter exists.',
  'Separate ETF proxy results from futures-grade Henry Hub contract results.',
  'Require human approval for promotion from research-baseline to paper-candidate.',
]

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
