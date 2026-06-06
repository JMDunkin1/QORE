import type { FeatureImportance, WeatherModelMetrics, WeatherPoint } from '../types'

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function rmse(actual: number[], predicted: number[]) {
  if (!actual.length) return 0
  return Math.sqrt(mean(actual.map((value, index) => (value - predicted[index]) ** 2)))
}

function mae(actual: number[], predicted: number[]) {
  if (!actual.length) return 0
  return mean(actual.map((value, index) => Math.abs(value - predicted[index])))
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function rSquared(actual: number[], predicted: number[]) {
  const actualMean = mean(actual)
  const total = actual.reduce((sum, value) => sum + (value - actualMean) ** 2, 0)
  const residual = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0)
  return total ? 1 - residual / total : 0
}

export function evaluateWeatherModel(weather: WeatherPoint[]): WeatherModelMetrics {
  const actualHdd = weather.map((point) => point.actualHdd)
  const forecastHdd = weather.map((point) => point.forecastHdd)
  const actualCdd = weather.map((point) => point.actualCdd)
  const forecastCdd = weather.map((point) => point.forecastCdd)
  const directionalHits = weather.slice(1).filter((point, index) => {
    const previous = weather[index]
    return Math.sign(point.actualHdd - previous.actualHdd) === Math.sign(point.forecastHdd - previous.forecastHdd)
  }).length
  const coldSurprises = weather.filter((point) => point.actualHdd - point.forecastHdd > 2.5)
  const recalledColdSurprises = coldSurprises.filter((point) => point.confidence < 78 || point.forecastHdd > 8).length
  const directionalAccuracyPct = (directionalHits / Math.max(weather.length - 1, 1)) * 100
  const confidenceMean = mean(weather.map((point) => point.confidence))
  const calibrationScorePct = 100 - Math.abs(confidenceMean - directionalAccuracyPct)

  return {
    hddMae: round(mae(actualHdd, forecastHdd)),
    hddRmse: round(rmse(actualHdd, forecastHdd)),
    cddMae: round(mae(actualCdd, forecastCdd)),
    cddRmse: round(rmse(actualCdd, forecastCdd)),
    r2: round(rSquared(actualHdd, forecastHdd), 3),
    directionalAccuracyPct: round(directionalAccuracyPct, 1),
    coldSurpriseRecallPct: round((recalledColdSurprises / Math.max(coldSurprises.length, 1)) * 100, 1),
    calibrationScorePct: round(Math.max(0, calibrationScorePct), 1),
  }
}

export const featureImportance: FeatureImportance[] = [
  { feature: 'HDD forecast miss', importance: 0.31, direction: 'Bullish gas' },
  { feature: 'Storage tightness', importance: 0.23, direction: 'Bullish gas' },
  { feature: 'CDD forecast miss', importance: 0.14, direction: 'Bullish gas' },
  { feature: 'Realized volatility', importance: 0.12, direction: 'Regime' },
  { feature: 'Temperature anomaly', importance: 0.09, direction: 'Bearish gas' },
  { feature: 'Weather confidence', importance: 0.07, direction: 'Regime' },
  { feature: 'Volume impulse', importance: 0.04, direction: 'Regime' },
]
