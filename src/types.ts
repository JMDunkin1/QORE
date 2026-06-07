export type ActiveView = 'overview' | 'backtest' | 'models' | 'data' | 'execution' | 'github'

export type WeatherPoint = {
  date: string
  stationBlend: string
  actualHdd: number
  forecastHdd: number
  actualCdd: number
  forecastCdd: number
  tempAnomalyF: number
  windMph: number
  precipIn: number
  confidence: number
}

export type MarketBar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  contract: 'NG' | 'MNG' | 'QG' | string
  storageBcf: number
}

export type JoinedPoint = WeatherPoint &
  MarketBar & {
    dailyReturn: number
    hddError: number
    cddError: number
    weatherSurprise: number
    demandScore: number
    storageTrend: number
  }

export type StrategyId =
  | 'weather-stress-long'
  | 'storage-fade'
  | 'ml-ensemble'
  | 'volatility-breakout'
  | 'balanced-carry'

export type Strategy = {
  id: StrategyId
  name: string
  desk: string
  thesis: string
  riskLevel: 'Low' | 'Medium' | 'High'
  color: string
}

export type BacktestSettings = {
  initialCapital: number
  riskPerSignal: number
  slippageBps: number
  commissionBps: number
  weatherWeight: number
  storageWeight: number
  maxExposure: number
}

export type EquityPoint = {
  date: string
  equity: number
  equityPct: number
  dailyPnlPct: number
  drawdownPct: number
  close: number
  weatherSurprise: number
  hddError: number
  position: number
  signal: number
}

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
}

export type BacktestResult = {
  strategy: Strategy
  settings: BacktestSettings
  curve: EquityPoint[]
  metrics: BacktestMetrics
  joined: JoinedPoint[]
}

export type WeatherModelMetrics = {
  hddMae: number
  hddRmse: number
  cddMae: number
  cddRmse: number
  r2: number
  directionalAccuracyPct: number
  coldSurpriseRecallPct: number
  calibrationScorePct: number
}

export type ModelRun = {
  id: string
  name: string
  target: string
  status: 'Candidate' | 'Champion' | 'Watch'
  features: string[]
  mae: number
  directionalAccuracyPct: number
  pnlLiftPct: number
  lastRun: string
}

export type FeatureImportance = {
  feature: string
  importance: number
  direction: 'Bullish gas' | 'Bearish gas' | 'Regime'
}

export type IntegrationConnector = {
  name: string
  category: 'Weather' | 'Market data' | 'Execution' | 'Storage' | 'ML'
  status: 'Ready scaffold' | 'Free demo key' | 'Free email token' | 'Needs key' | 'Paper only' | 'Research'
  purpose: string
  envVar: string
  sourceUrl: string
}

export type ExecutionVenue = {
  instrument: string
  code: 'NG' | 'MNG' | 'QG'
  venue: string
  contractSize: string
  settlement: string
  role: string
}
