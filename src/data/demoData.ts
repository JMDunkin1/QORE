import type { MarketBar, ModelRun, Strategy, WeatherPoint } from '../types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function seededNoise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addBusinessDays(start: Date, count: number) {
  const dates: Date[] = []
  const cursor = new Date(start)

  while (dates.length < count) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) {
      dates.push(new Date(cursor))
    }
    cursor.setTime(cursor.getTime() + MS_PER_DAY)
  }

  return dates
}

export const strategies: Strategy[] = [
  {
    id: 'ml-ensemble',
    name: 'ML Weather Ensemble',
    desk: 'Machine learning',
    thesis: 'Blends heating/cooling error, storage trend, volatility, and confidence into a normalized signal.',
    riskLevel: 'Medium',
    color: '#2563eb',
  },
  {
    id: 'weather-stress-long',
    name: 'Weather Stress Long',
    desk: 'Weather alpha',
    thesis: 'Leans long when cold or heat surprise implies incremental gas demand.',
    riskLevel: 'High',
    color: '#e11d48',
  },
  {
    id: 'storage-fade',
    name: 'Storage Fade',
    desk: 'Fundamental spread',
    thesis: 'Fades price weakness when storage tightens and weather demand is firm.',
    riskLevel: 'Medium',
    color: '#0f766e',
  },
  {
    id: 'volatility-breakout',
    name: 'Volatility Breakout',
    desk: 'Tactical',
    thesis: 'Adds exposure when realized gas volatility and weather surprise rise together.',
    riskLevel: 'High',
    color: '#9333ea',
  },
  {
    id: 'balanced-carry',
    name: 'Balanced Carry',
    desk: 'Risk control',
    thesis: 'Keeps smaller exposure unless weather, storage, and trend agree.',
    riskLevel: 'Low',
    color: '#ca8a04',
  },
]

export function generateDemoData(days = 252) {
  const dates = addBusinessDays(new Date('2025-06-02T12:00:00Z'), days)
  const weather: WeatherPoint[] = []
  const market: MarketBar[] = []
  let close = 3.18
  let storage = 2840

  dates.forEach((date, index) => {
    const dayOfYear = Math.floor(
      (date.getTime() - new Date(Date.UTC(date.getUTCFullYear(), 0, 0)).getTime()) / MS_PER_DAY,
    )
    const seasonal = Math.sin(((dayOfYear - 22) / 365) * Math.PI * 2)
    const summer = Math.sin(((dayOfYear - 172) / 365) * Math.PI * 2)
    const weatherPulse = (seededNoise(index + 17) - 0.5) * 9
    const forecastMiss = (seededNoise(index + 41) - 0.5) * 7
    const temp = 56 - seasonal * 24 + summer * 5 + weatherPulse
    const forecastTemp = temp - forecastMiss
    const actualHdd = Math.max(0, 65 - temp)
    const forecastHdd = Math.max(0, 65 - forecastTemp)
    const actualCdd = Math.max(0, temp - 65)
    const forecastCdd = Math.max(0, forecastTemp - 65)
    const hddError = actualHdd - forecastHdd
    const cddError = actualCdd - forecastCdd
    const windMph = 8 + seededNoise(index + 91) * 19
    const precipIn = seededNoise(index + 131) > 0.78 ? seededNoise(index + 132) * 1.2 : 0
    const tempAnomalyF = temp - (55 - seasonal * 18)
    const confidence = Math.max(52, Math.min(97, 87 - Math.abs(forecastMiss) * 5 + seededNoise(index + 12) * 8))
    const demandSurprise = hddError * 0.8 + cddError * 0.55 + tempAnomalyF * -0.06
    const storageSeason = Math.cos(((dayOfYear - 290) / 365) * Math.PI * 2) * 380
    storage = 2860 + storageSeason - actualHdd * 10 + actualCdd * 4 + (seededNoise(index + 73) - 0.5) * 95

    const volatility = 0.012 + Math.abs(demandSurprise) * 0.0016 + (seededNoise(index + 64) > 0.92 ? 0.017 : 0)
    const previousTrendClose = market[index - 1]?.close ?? close
    const olderTrendClose = market[Math.max(0, index - 8)]?.close ?? previousTrendClose
    const trendDrift = (previousTrendClose - olderTrendClose) * 0.002
    const storagePressure = (3000 - storage) / 3000
    const dailyRet =
      0.0002 +
      demandSurprise * 0.0037 +
      storagePressure * 0.003 +
      trendDrift +
      (seededNoise(index + 7) - 0.48) * volatility
    const open = close * (1 + (seededNoise(index + 3) - 0.5) * 0.006)
    close = Math.max(1.7, close * (1 + dailyRet))
    const range = close * (0.012 + seededNoise(index + 4) * 0.024)

    weather.push({
      date: toIsoDate(date),
      stationBlend: index % 3 === 0 ? 'Henry Hub demand basket' : index % 3 === 1 ? 'Midwest HDD basket' : 'Northeast load basket',
      actualHdd: round(actualHdd),
      forecastHdd: round(forecastHdd),
      actualCdd: round(actualCdd),
      forecastCdd: round(forecastCdd),
      tempAnomalyF: round(tempAnomalyF),
      windMph: round(windMph),
      precipIn: round(precipIn, 3),
      confidence: round(confidence, 1),
    })

    market.push({
      date: toIsoDate(date),
      open: round(open, 3),
      high: round(Math.max(open, close) + range * 0.55, 3),
      low: round(Math.min(open, close) - range * 0.45, 3),
      close: round(close, 3),
      volume: Math.round(245000 + seededNoise(index + 29) * 185000 + Math.abs(demandSurprise) * 9000),
      contract: index % 11 === 0 ? 'MNG' : 'NG',
      storageBcf: round(storage, 1),
    })
  })

  return { weather, market }
}

export const modelRuns: ModelRun[] = [
  {
    id: 'champion-v4',
    name: 'Gradient Weather Demand v4',
    target: 'Next 5-day NG return',
    status: 'Champion',
    features: ['HDD miss', 'CDD miss', 'storage trend', 'confidence', 'realized vol'],
    mae: 1.18,
    directionalAccuracyPct: 64.8,
    pnlLiftPct: 9.6,
    lastRun: '2026-06-05',
  },
  {
    id: 'sequence-v1',
    name: 'Sequence LSTM Pilot',
    target: 'Regime shift',
    status: 'Candidate',
    features: ['weather sequence', 'front spread', 'volume', 'temp anomaly'],
    mae: 1.41,
    directionalAccuracyPct: 61.2,
    pnlLiftPct: 5.1,
    lastRun: '2026-06-03',
  },
  {
    id: 'baseline-linear',
    name: 'Elastic Net Baseline',
    target: 'Daily return',
    status: 'Watch',
    features: ['HDD', 'CDD', 'storage Bcf', 'momentum'],
    mae: 1.64,
    directionalAccuracyPct: 56.9,
    pnlLiftPct: 1.7,
    lastRun: '2026-06-01',
  },
]
