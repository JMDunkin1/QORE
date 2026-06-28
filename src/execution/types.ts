export type ExecutionMode = 'research' | 'paper' | 'live-disabled'

export type TradeDirection = 'long' | 'short' | 'flat'

export type GasExecutionInstrumentCode = 'UNG' | 'NG' | 'MNG' | 'QG'

export type IndexBasketComponentCode = 'VOO' | 'QQQM'

export type ExecutionInstrumentCode = GasExecutionInstrumentCode | IndexBasketComponentCode

export type SyntheticInstrumentCode = 'US-INDEX-BASKET'

export type OrderLegRole = 'gas-overlay' | 'index-fallback' | 'cash'

export type RiskCheckStatus = 'pass' | 'warn' | 'block'

export type RiskCheckCategory =
  | 'architecture'
  | 'instrument'
  | 'confidence'
  | 'holding-window'
  | 'notional'
  | 'exposure'
  | 'freshness'
  | 'market'
  | 'portfolio'
  | 'drawdown'
  | 'operations'

export type RiskCheckResult = {
  id: string
  label: string
  category: RiskCheckCategory
  status: RiskCheckStatus
  detail: string
}

export type StrategySignalIntent = {
  strategyId: string
  strategyName: string
  generatedAt: string
  signalDate: string
  targetDate: string
  instrument: ExecutionInstrumentCode
  direction: TradeDirection
  confidence: number
  expectedReturnPct?: number
  indexFraction?: number
  gasPosition?: number
  cashFraction?: number
  sourceSynthetic?: SyntheticInstrumentCode
  maxHoldingDays: number
  source: 'research-backtest' | 'paper-simulation'
  notes: string[]
}

export type RiskPolicy = {
  id: string
  mode: ExecutionMode
  allowedInstruments: ExecutionInstrumentCode[]
  maxConfidence: number
  minConfidence?: number
  maxHoldingDays?: number
  maxNotionalUsd?: number
  maxOpenIntents?: number
  maxSingleLegNotionalUsd?: number
  maxGasLegNotionalUsd?: number
  maxIndexLegNotionalUsd?: number
  maxAccountAllocationPct?: number
  minCashBufferPct?: number
  maxDailyLossPct?: number
  maxTrailingDrawdownPct?: number
  maxConsecutiveLosses?: number
  cooldownDaysAfterLoss?: number
  maxSignalAgeDays?: number
  maxWeatherIssueAgeHours?: number
  maxMarketDataAgeMinutes?: number
  maxStorageDataAgeDays?: number
  maxAllowedSpreadBps?: number
  minReferencePriceUsd?: number
  minWeatherSourceCount?: number
  minWeatherCoveragePct?: number
  minWeatherDirectionalAccuracyPct?: number
  requireFreshWeatherContext?: boolean
  requireStorageContext?: boolean
  requireMarketContext?: boolean
  requireAccountContext?: boolean
  requireOperatorContext?: boolean
  requireManualApproval?: boolean
  allowShortGas?: boolean
  notes?: string[]
  liveRoutingEnabled: false
}

export type RiskDecision = {
  approved: boolean
  mode: ExecutionMode
  reasons: string[]
  warnings: string[]
  checks: RiskCheckResult[]
  cappedNotionalUsd: number
}

export type RiskAccountContext = {
  equityUsd: number
  cashUsd: number
  openIntentCount: number
  dayPnlPct?: number
  trailingDrawdownPct?: number
  consecutiveLosses?: number
  lastLossDate?: string
}

export type RiskWeatherContext = {
  forecastIssuedAt: string
  sourceCount: number
  coveragePct: number
  directionalAccuracyPct?: number
  sourceIds?: string[]
}

export type RiskMarketContext = {
  priceUpdatedAt: string
  referencePrices: PaperReferencePrices
  spreadsBps?: Partial<Record<ExecutionInstrumentCode, number>>
}

export type RiskStorageContext = {
  reportedAt: string
  storageVsSeasonalAverageBcf?: number
}

export type RiskOperatorContext = {
  manualApproval?: boolean
  killSwitchEngaged?: boolean
  venueOpen?: boolean
}

export type RiskEvaluationContext = {
  asOf?: string
  requestedNotionalUsd?: number
  account?: RiskAccountContext
  weather?: RiskWeatherContext
  market?: RiskMarketContext
  storage?: RiskStorageContext
  operator?: RiskOperatorContext
}

export type OrderLegIntent = {
  id: string
  role: OrderLegRole
  instrument: ExecutionInstrumentCode | 'CASH'
  side: 'buy' | 'sell' | 'hold'
  targetWeight: number
  quantity: number
  notionalUsd: number
  sourceSynthetic?: SyntheticInstrumentCode
}

export type OrderIntent = {
  id: string
  mode: ExecutionMode
  createdAt: string
  signal: StrategySignalIntent
  side: 'buy' | 'sell' | 'hold'
  quantity: number
  notionalUsd: number
  legs: OrderLegIntent[]
  riskDecision: RiskDecision
}

export type PaperFillStatus = 'paper-filled' | 'paper-rejected'

export type PaperFill = {
  orderIntentId: string
  filledAt: string
  fillPrice: number
  quantity: number
  notionalUsd: number
  status: PaperFillStatus
  notes: string[]
  legFills?: PaperLegFill[]
}

export type PaperLegFill = {
  orderLegId: string
  instrument: OrderLegIntent['instrument']
  side: OrderLegIntent['side']
  fillPrice: number
  quantity: number
  notionalUsd: number
  status: PaperFillStatus
}

export type PaperReferencePrices = Partial<Record<OrderLegIntent['instrument'], number>>

export type ExecutionGateway = {
  mode: ExecutionMode
  submitOrderIntent: (intent: OrderIntent) => PaperFill
}
