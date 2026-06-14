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

export type BacktestSignalContext = {
  points: JoinedPoint[]
  index: number
  settings: BacktestSettings
  rollingVolatility: (lookback?: number) => number
}

export type Strategy = {
  id: string
  name: string
  desk: string
  thesis: string
  riskLevel: 'Low' | 'Medium' | 'High'
  color: string
  signal: (point: JoinedPoint, context: BacktestSignalContext) => number
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
  rowCount: number
  sourceCount: number
  metricLabel: string
  unitLabel: string
  mae: number
  rmse: number
  bias: number
  r2: number
  directionalAccuracyPct: number
  coldRecallPct: number
}

export type IntegrationConnector = {
  name: string
  category: 'Weather' | 'Market data' | 'Execution' | 'Storage' | 'ML'
  status: 'Ready scaffold' | 'Free API key' | 'Free email token' | 'Needs key' | 'Dry run only' | 'Not connected' | 'Research'
  purpose: string
  envVar: string
  sourceUrl: string
}

export type ExecutionVenue = {
  instrument: string
  code: 'NG' | 'MNG' | 'QG' | 'VOO' | 'QQQM'
  venue: string
  contractSize: string
  settlement: string
  role: string
}
