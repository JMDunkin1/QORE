import type {
  BacktestMetrics,
  BacktestResult,
  BacktestSettings,
  EquityPoint,
  JoinedPoint,
  MarketBar,
  Strategy,
  StrategyId,
  WeatherPoint,
} from '../types'
import { strategies } from '../data/demoData'

const TRADING_DAYS = 252

export const defaultSettings: BacktestSettings = {
  initialCapital: 100000,
  riskPerSignal: 0.34,
  slippageBps: 2.5,
  commissionBps: 0.7,
  weatherWeight: 0.7,
  storageWeight: 0.3,
  maxExposure: 1.35,
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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
  const index = clamp(Math.floor((sorted.length - 1) * pct), 0, sorted.length - 1)
  return sorted[index]
}

export function joinMarketWeather(market: MarketBar[], weather: WeatherPoint[]): JoinedPoint[] {
  const weatherByDate = new Map(weather.map((point) => [point.date, point]))
  let previousClose = market[0]?.close ?? 0
  let previousStorage = market[0]?.storageBcf ?? 0

  return market
    .filter((bar) => weatherByDate.has(bar.date))
    .map((bar) => {
      const point = weatherByDate.get(bar.date)!
      const dailyReturn = previousClose ? (bar.close - previousClose) / previousClose : 0
      const hddError = point.actualHdd - point.forecastHdd
      const cddError = point.actualCdd - point.forecastCdd
      const weatherSurprise = hddError * 0.72 + cddError * 0.46 - point.tempAnomalyF * 0.04
      const demandScore =
        point.actualHdd * 0.62 + point.actualCdd * 0.38 + weatherSurprise * 1.4 + point.windMph * 0.06
      const storageTrend = previousStorage ? (bar.storageBcf - previousStorage) / previousStorage : 0
      previousClose = bar.close
      previousStorage = bar.storageBcf

      return {
        ...point,
        ...bar,
        dailyReturn,
        hddError,
        cddError,
        weatherSurprise,
        demandScore,
        storageTrend,
      }
    })
}

function rollingVolatility(points: JoinedPoint[], index: number) {
  const slice = points.slice(Math.max(0, index - 20), index + 1).map((point) => point.dailyReturn)
  return std(slice)
}

function signalFor(strategyId: StrategyId, point: JoinedPoint, points: JoinedPoint[], index: number, settings: BacktestSettings) {
  const previous = points[Math.max(0, index - 1)]
  const momentum = previous?.close ? (point.close - previous.close) / previous.close : 0
  const vol = rollingVolatility(points, index)
  const storageTightness = clamp((3000 - point.storageBcf) / 340, -1.6, 1.6)
  const weather = clamp(point.weatherSurprise / 8, -1.4, 1.4)
  const confidence = clamp((point.confidence - 55) / 40, 0, 1)

  switch (strategyId) {
    case 'weather-stress-long':
      return clamp(weather * 1.4 + Math.max(0, point.demandScore - 18) / 22 - Math.max(0, -momentum) * 2, -1, 1)
    case 'storage-fade':
      return clamp(storageTightness * settings.storageWeight + weather * settings.weatherWeight - momentum * 7, -1, 1)
    case 'volatility-breakout':
      return clamp(Math.sign(momentum || weather) * (Math.abs(weather) * 0.65 + vol * 31 + confidence * 0.15), -1, 1)
    case 'balanced-carry':
      return clamp((weather * 0.45 + storageTightness * 0.55 + Math.sign(momentum) * 0.15) * 0.72, -0.72, 0.72)
    case 'ml-ensemble':
    default:
      return clamp(weather * settings.weatherWeight + storageTightness * settings.storageWeight + momentum * 5 + confidence * 0.12, -1, 1)
  }
}

function computeMetrics(curve: EquityPoint[], settings: BacktestSettings, tradeCount: number): BacktestMetrics {
  const returns = curve.map((point) => point.dailyPnlPct / 100).slice(1)
  const negativeReturns = returns.filter((value) => value < 0)
  const finalEquity = curve.at(-1)?.equity ?? settings.initialCapital
  const totalReturn = finalEquity / settings.initialCapital - 1
  const years = Math.max(curve.length / TRADING_DAYS, 1 / TRADING_DAYS)
  const annualVol = std(returns) * Math.sqrt(TRADING_DAYS)
  const annualReturn = (1 + totalReturn) ** (1 / years) - 1
  const downsideVol = std(negativeReturns) * Math.sqrt(TRADING_DAYS)
  const maxDrawdown = Math.min(...curve.map((point) => point.drawdownPct), 0) / 100
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)
  const exposure = mean(curve.map((point) => Math.abs(point.position)))
  const turnover = curve.reduce((sum, point, index) => {
    const previous = curve[index - 1]?.position ?? 0
    return sum + Math.abs(point.position - previous)
  }, 0)

  return {
    totalReturnPct: round(totalReturn * 100, 2),
    cagrPct: round(annualReturn * 100, 2),
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (mean(returns) * TRADING_DAYS) / annualVol : 0, 2),
    sortino: round(downsideVol ? (mean(returns) * TRADING_DAYS) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdown * 100, 2),
    calmar: round(Math.abs(maxDrawdown) ? annualReturn / Math.abs(maxDrawdown) : 0, 2),
    winRatePct: round((returns.filter((value) => value > 0).length / Math.max(returns.length, 1)) * 100, 1),
    profitFactor: round(losses ? gains / losses : gains ? 99 : 0, 2),
    tradeCount,
    exposurePct: round(exposure * 100, 1),
    turnover: round(turnover, 2),
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(mean(returns) * 100, 3),
  }
}

export function runBacktest(
  market: MarketBar[],
  weather: WeatherPoint[],
  strategy: Strategy,
  settings: BacktestSettings = defaultSettings,
): BacktestResult {
  const joined = joinMarketWeather(market, weather)
  let equity = settings.initialCapital
  let peak = equity
  let position = 0
  let tradeCount = 0
  const curve: EquityPoint[] = []

  joined.forEach((point, index) => {
    const rawSignal = signalFor(strategy.id, point, joined, index, settings)
    const targetPosition = clamp(rawSignal * settings.riskPerSignal, -settings.maxExposure, settings.maxExposure)
    const tradedNotional = Math.abs(targetPosition - position) * equity
    const tradingCost = tradedNotional * ((settings.slippageBps + settings.commissionBps) / 10000)
    if (Math.abs(targetPosition - position) > 0.09) tradeCount += 1

    const previousEquity = equity
    equity = Math.max(1, equity * (1 + position * point.dailyReturn) - tradingCost)
    peak = Math.max(peak, equity)
    const dailyPnlPct = previousEquity ? ((equity - previousEquity) / previousEquity) * 100 : 0

    curve.push({
      date: point.date,
      equity: round(equity, 2),
      equityPct: round((equity / settings.initialCapital - 1) * 100, 2),
      dailyPnlPct: round(dailyPnlPct, 3),
      drawdownPct: round(((equity - peak) / peak) * 100, 2),
      close: point.close,
      weatherSurprise: round(point.weatherSurprise, 2),
      hddError: round(point.hddError, 2),
      position: round(position, 3),
      signal: round(rawSignal, 3),
    })

    position = targetPosition
  })

  return {
    strategy,
    settings,
    curve,
    metrics: computeMetrics(curve, settings, tradeCount),
    joined,
  }
}

export function rankStrategies(market: MarketBar[], weather: WeatherPoint[], settings: BacktestSettings) {
  return strategies
    .map((strategy) => runBacktest(market, weather, strategy, settings))
    .sort((a, b) => b.metrics.sharpe - a.metrics.sharpe || b.metrics.totalReturnPct - a.metrics.totalReturnPct)
}
