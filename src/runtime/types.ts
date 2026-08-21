export type PortfolioHistoryPoint = {
  timestamp: string
  equityUsd: number
  profitLossUsd: number | null
  profitLossPct: number | null
}

export type LivePosition = {
  symbol: string
  side: string | null
  quantity: number | null
  marketValueUsd: number | null
  currentPriceUsd: number | null
  averageEntryPriceUsd: number | null
  unrealizedPnlUsd: number | null
  unrealizedPnlPct: number | null
}

export type LiveOrder = {
  id: string | null
  clientOrderId: string | null
  symbol: string | null
  side: string | null
  type: string | null
  status: string | null
  timeInForce: string | null
  quantity: number | null
  notionalUsd: number | null
  filledQuantity: number | null
  limitPriceUsd: number | null
  stopPriceUsd: number | null
  averageFillPriceUsd: number | null
  submittedAt: string | null
  filledAt: string | null
  canceledAt: string | null
  updatedAt: string | null
}

export type LiveIntent = {
  strategyId: string | null
  strategyName: string | null
  generatedAt: string | null
  signalDate: string | null
  targetDate: string | null
  instrument: string | null
  direction: string | null
  confidence: number | null
  expectedReturnPct: number | null
  indexFraction: number | null
  gasPosition: number | null
  cashFraction: number | null
  maxHoldingDays: number | null
  source: string | null
}

export type LiveTelemetry = {
  generatedAt: string
  sourceGeneratedAt: string | null
  mode: 'dry-run' | 'paper' | 'live' | 'unknown'
  brokerConnected: boolean
  stale?: boolean
  staleAfterSeconds?: number
  account: {
    equityUsd: number | null
    cashUsd: number | null
    lastEquityUsd: number | null
    dayPnlUsd: number | null
    dayPnlPct: number | null
    trailingDrawdownPct: number | null
    buyingPowerUsd: number | null
    status: string | null
    shortingEnabled: boolean | null
  } | null
  positions: LivePosition[]
  openOrders: LiveOrder[]
  recentOrders: LiveOrder[]
  marketClock: {
    isOpen: boolean | null
    timestamp: string | null
    nextOpen: string | null
    nextClose: string | null
  } | null
  portfolioHistory: {
    sourceGeneratedAt: string | null
    baseValueUsd: number | null
    baseValueAsOf: string | null
    timeframe: string
    points: PortfolioHistoryPoint[]
    error?: string | null
  } | null
  strategy: {
    intent: LiveIntent | null
    inference: Record<string, unknown> | null
  }
  risk: {
    killSwitchEngaged: boolean | null
    readiness: Record<string, unknown> | null
    blockedReasons: string[]
    warnings: string[]
  } | null
  supervisor: Record<string, unknown> | null
  error?: string
}

export type CommandConnection = {
  generatedAt: string
  phase: string
  progressPct: number
  connected: boolean
  remoteName: string
  transport: 't3-tailscale-ssh'
  detail: string
  error: string | null
}

export type LivePerformancePoint = {
  chartIndex: number
  date: string
  equityUsd: number
  equityPct: number
  dailyPnlPct: number
  drawdownPct: number
}
