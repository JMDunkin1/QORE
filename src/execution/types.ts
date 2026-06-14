export type ExecutionMode = 'research' | 'paper' | 'live-disabled'

export type TradeDirection = 'long' | 'short' | 'flat'

export type GasExecutionInstrumentCode = 'UNG' | 'NG' | 'MNG' | 'QG'

export type IndexBasketComponentCode = 'VOO' | 'QQQM'

export type ExecutionInstrumentCode = GasExecutionInstrumentCode | IndexBasketComponentCode

export type SyntheticInstrumentCode = 'US-INDEX-BASKET'

export type OrderLegRole = 'gas-overlay' | 'index-fallback' | 'cash'

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
  minConfidence: number
  maxHoldingDays: number
  maxNotionalUsd: number
  maxOpenIntents: number
  liveRoutingEnabled: false
}

export type RiskDecision = {
  approved: boolean
  mode: ExecutionMode
  reasons: string[]
  cappedNotionalUsd: number
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
