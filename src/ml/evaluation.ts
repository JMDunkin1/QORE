import type { WeatherModelMetrics, WeatherPoint } from '../types'

export type ForecastAnomalyPoint = {
  actualAnomalyF: number
  forecastAnomalyF: number
  sourceId: string
}

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

function bias(actual: number[], predicted: number[]) {
  if (!actual.length) return 0
  return mean(actual.map((value, index) => predicted[index] - value))
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
  const directionalHits = weather.slice(1).filter((point, index) => {
    const previous = weather[index]
    return Math.sign(point.actualHdd - previous.actualHdd) === Math.sign(point.forecastHdd - previous.forecastHdd)
  }).length
  const coldSurprises = weather.filter((point) => point.actualHdd - point.forecastHdd > 2.5)
  const recalledColdSurprises = coldSurprises.filter((point) => point.confidence < 78 || point.forecastHdd > 8).length
  const directionalAccuracyPct = (directionalHits / Math.max(weather.length - 1, 1)) * 100

  return {
    rowCount: weather.length,
    sourceCount: new Set(weather.map((point) => point.stationBlend)).size || 1,
    metricLabel: 'HDD',
    unitLabel: 'HDD',
    mae: round(mae(actualHdd, forecastHdd)),
    rmse: round(rmse(actualHdd, forecastHdd)),
    bias: round(bias(actualHdd, forecastHdd)),
    r2: round(rSquared(actualHdd, forecastHdd), 3),
    directionalAccuracyPct: round(directionalAccuracyPct, 1),
    coldRecallPct: round((recalledColdSurprises / Math.max(coldSurprises.length, 1)) * 100, 1),
  }
}

export function evaluateForecastAnomalyModel(points: ForecastAnomalyPoint[]): WeatherModelMetrics {
  const validPoints = points.filter(
    (point) => Number.isFinite(point.actualAnomalyF) && Number.isFinite(point.forecastAnomalyF),
  )
  const actualAnomaly = validPoints.map((point) => point.actualAnomalyF)
  const forecastAnomaly = validPoints.map((point) => point.forecastAnomalyF)
  const directionalHits = validPoints.filter(
    (point) => Math.sign(point.actualAnomalyF) === Math.sign(point.forecastAnomalyF),
  ).length
  const coldEvents = validPoints.filter((point) => point.actualAnomalyF <= -8)
  const recalledColdEvents = coldEvents.filter((point) => point.forecastAnomalyF < 0).length

  return {
    rowCount: validPoints.length,
    sourceCount: new Set(validPoints.map((point) => point.sourceId)).size,
    metricLabel: 'Anomaly',
    unitLabel: 'F',
    mae: round(mae(actualAnomaly, forecastAnomaly)),
    rmse: round(rmse(actualAnomaly, forecastAnomaly)),
    bias: round(bias(actualAnomaly, forecastAnomaly)),
    r2: round(rSquared(actualAnomaly, forecastAnomaly), 3),
    directionalAccuracyPct: round((directionalHits / Math.max(validPoints.length, 1)) * 100, 1),
    coldRecallPct: round((recalledColdEvents / Math.max(coldEvents.length, 1)) * 100, 1),
  }
}
