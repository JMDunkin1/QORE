export type ExecutionMode = 'research' | 'paper' | 'live-disabled'

export type TradeDirection = 'long' | 'short' | 'flat'

export type ExecutionInstrumentCode = 'UNG' | 'NG' | 'MNG' | 'QG'

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

export type OrderIntent = {
  id: string
  mode: ExecutionMode
  createdAt: string
  signal: StrategySignalIntent
  side: 'buy' | 'sell' | 'hold'
  quantity: number
  notionalUsd: number
  riskDecision: RiskDecision
}

export type PaperFill = {
  orderIntentId: string
  filledAt: string
  fillPrice: number
  quantity: number
  notionalUsd: number
  status: 'paper-filled' | 'paper-rejected'
  notes: string[]
}

export type ExecutionGateway = {
  mode: ExecutionMode
  submitOrderIntent: (intent: OrderIntent) => PaperFill
}
