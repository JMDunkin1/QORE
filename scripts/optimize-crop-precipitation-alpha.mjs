#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = process.env.QORE_DATA_ROOT ?? path.join(REPO_ROOT, 'data', 'qore')
const OUTPUT_ROOT = process.env.QORE_OUTPUT_ROOT ?? path.join(DATA_ROOT, 'research', 'strategy-agent-runs', 'crop-precipitation-refined')
const CONFIG_FILE = process.env.QORE_CROP_PRECIP_CONFIG ?? path.join(REPO_ROOT, 'config', 'crop-precipitation-universe.json')
const MANIFEST_FILE = path.join(DATA_ROOT, 'weather', 'crop-precipitation', 'collection-manifest.json')
const ACTUALS_DIR = path.join(DATA_ROOT, 'weather', 'crop-precipitation', 'actuals')
const MARKET_DIR = path.join(DATA_ROOT, 'market', 'yahoo')
const INDEX_MARKET_FILE = path.join(MARKET_DIR, 'US-INDEX-BASKET-qore-market.csv')
const INDEX_BASKET_CONFIG_FILE = path.join(REPO_ROOT, 'data', 'qore', 'market', 'index-basket-config.json')
const SENSITIVITY_DIR = process.env.QORE_CROP_SENSITIVITY_DIR ?? path.join(REPO_ROOT, '.local', 'qore', 'crop-refined-sensitivity')

const STRATEGY_START = process.env.QORE_CROP_STRATEGY_START ?? '2020-10-14'
const TRAIN_END = process.env.QORE_CROP_TRAIN_END ?? '2023-12-31'
const VALIDATION_END = process.env.QORE_CROP_VALIDATION_END ?? '2026-01-15'
const HOLDOUT_START = process.env.QORE_CROP_HOLDOUT_START ?? '2026-01-16'
const BASELINE_START = process.env.QORE_CROP_BASELINE_START ?? '2000-01-01'
const BASELINE_END = process.env.QORE_CROP_BASELINE_END ?? '2010-12-31'
const SIGNAL_AVAILABILITY_LAG_DAYS = Number(process.env.QORE_CROP_PRECIP_SIGNAL_LAG_DAYS ?? 2)
const ONE_WAY_COST_BPS = Number(process.env.QORE_CROP_ONE_WAY_COST_BPS ?? 5)
const TRADING_DAYS = 252

const LOOKBACKS = [7, 14, 30, 60]
const THRESHOLDS = [0.35, 0.5, 0.75, 1, 1.5]
const HOLD_DAYS = [3, 5, 10, 20]
const CROP_ALLOCATIONS = [0.15, 0.25, 0.35, 0.5]
const ARCHETYPES = [
  { id: 'adverse-long', label: 'Long supply-adverse precipitation stress' },
  { id: 'adverse-long-relief-short', label: 'Long stress / short favorable relief' },
  { id: 'dry-long', label: 'Long crop-area drought stress' },
  { id: 'wet-long', label: 'Long crop-area excess-rain stress' },
  { id: 'raw-dry-long-wet-short', label: 'Long broad dryness / short broad wetness' },
  { id: 'adverse-fade', label: 'Fade supply-adverse precipitation stress' },
]

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
}

function parseCsv(filePath) {
  const result = Papa.parse(readText(filePath), { header: true, skipEmptyLines: true, dynamicTyping: true })
  if (result.errors.length) throw new Error(`CSV parse failed for ${filePath}: ${result.errors[0].message}`)
  return result.data
}

function safeSymbol(symbol) {
  return symbol.replace(/[^A-Za-z0-9]/g, '-')
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetween(start, end) {
  return (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}

function covariance(left, right) {
  if (left.length < 2 || right.length !== left.length) return 0
  const leftMean = mean(left)
  const rightMean = mean(right)
  return left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0) / (left.length - 1)
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * erf)
}

function dayOfYear(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`)
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.floor((date - start) / 86400000) + 1
}

function wrappedDoy(value) {
  let result = value
  while (result < 1) result += 366
  while (result > 366) result -= 366
  return result
}

function dateInWindow(dateText, window) {
  const monthDay = dateText.slice(5)
  if (window.start <= window.end) return monthDay >= window.start && monthDay <= window.end
  return monthDay >= window.start || monthDay <= window.end
}

function activeWindow(site, dateText) {
  return site.windows.find((window) => dateInWindow(dateText, window)) ?? null
}

function splitForDate(dateText) {
  if (dateText <= TRAIN_END) return 'train'
  if (dateText <= VALIDATION_END) return 'validation'
  return 'holdout'
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  if (!rows.length) return `${headers.join(',')}\n`
  return `${[headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')}\n`
}

function marketRows(symbol, maxDate = null) {
  const cropFile = path.join(MARKET_DIR, `${safeSymbol(symbol)}-daily.csv`)
  const cropRows = parseCsv(cropFile)
    .map((row) => ({ date: row.date, close: Number(row.adjustedClose ?? row.close), volume: Number(row.volume ?? 0) }))
    .filter((row) => row.date >= STRATEGY_START && (!maxDate || row.date <= maxDate) && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  const indexRows = parseCsv(INDEX_MARKET_FILE)
    .map((row) => ({ date: row.date, indexClose: Number(row.close) }))
    .filter((row) => row.date >= STRATEGY_START && (!maxDate || row.date <= maxDate) && Number.isFinite(row.indexClose) && row.indexClose > 0)
  const indexByDate = new Map(indexRows.map((row) => [row.date, row.indexClose]))
  const joined = cropRows
    .filter((row) => indexByDate.has(row.date))
    .map((row) => ({ ...row, indexClose: indexByDate.get(row.date) }))
  if (joined.length < 2) throw new Error(`${symbol} has no usable common history with US-INDEX-BASKET.`)
  if (new Set(joined.map((row) => row.date)).size !== joined.length) throw new Error(`${symbol} common market history has duplicate dates.`)
  return joined
}

function buildSiteFeatureMaps(site, maxDate = null) {
  const rows = parseCsv(path.join(ACTUALS_DIR, `${site.id}.csv`))
    .map((row) => ({ date: row.date, precipitationMm: Number(row.precipitationMm) }))
    .filter((row) => (!maxDate || row.date <= maxDate) && Number.isFinite(row.precipitationMm))
    .sort((a, b) => a.date.localeCompare(b.date))
  const values = rows.map((row) => row.precipitationMm)
  const output = new Map()

  for (const lookback of LOOKBACKS) {
    let running = 0
    const totals = []
    for (let index = 0; index < rows.length; index += 1) {
      running += values[index]
      if (index >= lookback) running -= values[index - lookback]
      totals[index] = index >= lookback - 1 ? running : null
    }

    const samplesByDoy = Array.from({ length: 367 }, () => [])
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].date < BASELINE_START || rows[index].date > BASELINE_END || totals[index] === null) continue
      const doy = dayOfYear(rows[index].date)
      for (let offset = -15; offset <= 15; offset += 1) samplesByDoy[wrappedDoy(doy + offset)].push(totals[index])
    }
    const normalByDoy = samplesByDoy.map((samples) => ({ mean: mean(samples), std: std(samples) }))
    const byDate = new Map()
    for (let index = 0; index < rows.length; index += 1) {
      if (totals[index] === null) continue
      const normal = normalByDoy[dayOfYear(rows[index].date)]
      const z = normal.std > 0 ? (totals[index] - normal.mean) / normal.std : 0
      byDate.set(rows[index].date, { rollingPrecipMm: totals[index], z: Math.max(-4, Math.min(4, z)) })
    }
    output.set(lookback, byDate)
  }
  return output
}

function cropFeatures(crop, siteFeatureMaps, market) {
  const byLookback = new Map(LOOKBACKS.map((lookback) => [lookback, new Map()]))
  for (const marketRow of market) {
    const observedThrough = addDays(marketRow.date, -SIGNAL_AVAILABILITY_LAG_DAYS)
    for (const lookback of LOOKBACKS) {
      let activeWeight = 0
      let raw = 0
      let dryStress = 0
      let wetStress = 0
      let favorable = 0
      const stages = []
      const activeSites = []
      for (const site of crop.sites) {
        const window = activeWindow(site, observedThrough)
        const feature = siteFeatureMaps.get(site.id)?.get(lookback)?.get(observedThrough)
        if (!window || !feature) continue
        activeWeight += site.weight
        activeSites.push(site.id)
        stages.push(window.stage)
        raw += site.weight * feature.z
        if (window.mode === 'dry-stress' || window.mode === 'two-sided-stress') dryStress += site.weight * Math.max(0, -feature.z)
        if (window.mode === 'wet-stress' || window.mode === 'two-sided-stress') wetStress += site.weight * Math.max(0, feature.z)
        if (window.mode === 'dry-stress') favorable += site.weight * Math.max(0, feature.z)
        if (window.mode === 'wet-stress') favorable += site.weight * Math.max(0, -feature.z)
      }
      if (activeWeight <= 0) continue
      byLookback.get(lookback).set(marketRow.date, {
        observedThrough,
        rawZ: raw / activeWeight,
        dryStress: dryStress / activeWeight,
        wetStress: wetStress / activeWeight,
        adverseStress: (dryStress + wetStress) / activeWeight,
        favorable: favorable / activeWeight,
        activeWeight,
        activeSites,
        stages: [...new Set(stages)],
      })
    }
  }
  return byLookback
}

function desiredPosition(feature, candidate) {
  if (!feature) return null
  const threshold = candidate.threshold
  if (candidate.archetype === 'adverse-long') return feature.adverseStress >= threshold ? 1 : null
  if (candidate.archetype === 'adverse-long-relief-short') {
    if (feature.adverseStress >= threshold) return 1
    if (feature.favorable >= threshold) return -1
    return null
  }
  if (candidate.archetype === 'dry-long') return feature.dryStress >= threshold ? 1 : null
  if (candidate.archetype === 'wet-long') return feature.wetStress >= threshold ? 1 : null
  if (candidate.archetype === 'raw-dry-long-wet-short') {
    if (feature.rawZ <= -threshold) return 1
    if (feature.rawZ >= threshold) return -1
    return null
  }
  if (candidate.archetype === 'adverse-fade') return feature.adverseStress >= threshold ? -1 : null
  return null
}

function runCandidate(crop, market, featureMap, candidate, keepRows = false) {
  const curve = []
  const trades = []
  let position = 0
  let sessionsRemaining = 0
  for (let index = 0; index < market.length - 1; index += 1) {
    const row = market[index]
    const next = market[index + 1]
    const feature = featureMap.get(row.date)
    const triggerDirection = desiredPosition(feature, candidate)
    let reason = ''
    if (triggerDirection !== null) {
      position = triggerDirection * candidate.cropAllocation
      sessionsRemaining = candidate.holdDays
      reason = 'signal'
    } else if (sessionsRemaining > 0) {
      sessionsRemaining -= 1
      if (sessionsRemaining === 0) {
        position = 0
        reason = 'hold-expired'
      }
    }
    const priorPosition = curve.at(-1)?.position ?? 0
    const turnover = Math.abs(position - priorPosition)
    const cropReturn = next.close / row.close - 1
    const benchmarkReturn = next.indexClose / row.indexClose - 1
    const indexFraction = Math.max(0, 1 - Math.abs(position))
    const grossReturn = position * cropReturn + indexFraction * benchmarkReturn
    const costReturn = turnover * ONE_WAY_COST_BPS / 10000
    const strategyReturn = grossReturn - costReturn
    const point = {
      date: next.date,
      signalDate: row.date,
      observedThrough: feature?.observedThrough ?? '',
      position,
      priorPosition,
      turnover,
      strategyReturn,
      grossReturn,
      costReturn,
      cropReturn,
      benchmarkReturn,
      indexFraction,
      rawZ: feature?.rawZ ?? 0,
      dryStress: feature?.dryStress ?? 0,
      wetStress: feature?.wetStress ?? 0,
      adverseStress: feature?.adverseStress ?? 0,
      favorable: feature?.favorable ?? 0,
      stages: feature?.stages ?? [],
      activeSites: feature?.activeSites ?? [],
      reason,
    }
    curve.push(point)
    if (keepRows && (turnover > 0 || reason === 'signal')) {
      trades.push({
        cropId: crop.id,
        crop: crop.label,
        symbol: crop.symbol,
        candidateId: candidate.id,
        split: splitForDate(next.date),
        signalDate: row.date,
        entryReturnDate: next.date,
        observedThrough: point.observedThrough,
        action: position === 0 ? 'exit' : position > 0 ? 'long' : 'short',
        priorPosition,
        position,
        indexFraction,
        turnover,
        rawZ: round(point.rawZ),
        dryStress: round(point.dryStress),
        wetStress: round(point.wetStress),
        adverseStress: round(point.adverseStress),
        favorable: round(point.favorable),
        stages: point.stages,
        activeSites: point.activeSites,
        reason,
      })
    }
  }
  return { curve, trades }
}

function metrics(curve) {
  if (!curve.length) return emptyMetrics()
  const returns = curve.map((row) => row.strategyReturn)
  const grossReturns = curve.map((row) => row.grossReturn)
  const benchmark = curve.map((row) => row.benchmarkReturn)
  let equity = 1
  let grossEquity = 1
  let benchmarkEquity = 1
  let peak = 1
  let maxDrawdown = 0
  for (let index = 0; index < curve.length; index += 1) {
    equity *= 1 + returns[index]
    grossEquity *= 1 + grossReturns[index]
    benchmarkEquity *= 1 + benchmark[index]
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1)
  }
  const years = Math.max(daysBetween(curve[0].date, curve.at(-1).date) / 365.25, 1 / 365.25)
  const annualVol = std(returns) * Math.sqrt(TRADING_DAYS)
  const negative = returns.filter((value) => value < 0)
  const downsideVol = std(negative) * Math.sqrt(TRADING_DAYS)
  const benchmarkVariance = std(benchmark) ** 2
  const beta = benchmarkVariance ? covariance(returns, benchmark) / benchmarkVariance : 0
  const regressionAlpha = mean(returns.map((value, index) => value - beta * benchmark[index])) * TRADING_DAYS
  const active = returns.map((value, index) => value - benchmark[index])
  const activeVol = std(active) * Math.sqrt(TRADING_DAYS)
  const standardError = std(returns) / Math.sqrt(Math.max(1, returns.length))
  const tStat = standardError ? mean(returns) / standardError : 0
  const twoSidedP = 2 * (1 - normalCdf(Math.abs(tStat)))
  const tradeCount = curve.filter((row) => row.turnover > 0 && row.position !== 0).length
  const positiveYears = Object.values(yearReturns(curve)).filter((value) => value > 0).length
  const yearCount = Object.keys(yearReturns(curve)).length
  return {
    totalReturnPct: round((equity - 1) * 100, 2),
    grossReturnPct: round((grossEquity - 1) * 100, 2),
    benchmarkReturnPct: round((benchmarkEquity - 1) * 100, 2),
    benchmarkEdgePct: round((equity - benchmarkEquity) * 100, 2),
    cagrPct: round(((equity ** (1 / years)) - 1) * 100, 2),
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? mean(returns) * TRADING_DAYS / annualVol : 0, 2),
    sortino: round(downsideVol ? mean(returns) * TRADING_DAYS / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdown * 100, 2),
    beta: round(beta, 3),
    regressionAlphaPct: round(regressionAlpha * 100, 2),
    informationRatio: round(activeVol ? mean(active) * TRADING_DAYS / activeVol : 0, 2),
    exposurePct: round(mean(curve.map((row) => Math.abs(row.position))) * 100, 1),
    turnover: round(curve.reduce((sum, row) => sum + row.turnover, 0), 2),
    tradeCount,
    tStat: round(tStat, 2),
    pValue: round(Math.max(0, Math.min(1, twoSidedP)), 4),
    positiveYears,
    yearCount,
    positiveYearPct: round(yearCount ? positiveYears / yearCount * 100 : 0, 1),
    startDate: curve[0].date,
    endDate: curve.at(-1).date,
  }
}

function emptyMetrics() {
  return {
    totalReturnPct: 0, grossReturnPct: 0, benchmarkReturnPct: 0, benchmarkEdgePct: 0, cagrPct: 0, annualVolPct: 0,
    sharpe: 0, sortino: 0, maxDrawdownPct: 0, beta: 0, regressionAlphaPct: 0, informationRatio: 0,
    exposurePct: 0, turnover: 0, tradeCount: 0, tStat: 0, pValue: 1, positiveYears: 0, yearCount: 0,
    positiveYearPct: 0, startDate: null, endDate: null,
  }
}

function yearReturns(curve) {
  const equities = {}
  for (const row of curve) {
    const year = row.date.slice(0, 4)
    equities[year] = (equities[year] ?? 1) * (1 + row.strategyReturn)
  }
  return Object.fromEntries(Object.entries(equities).map(([year, equity]) => [year, round((equity - 1) * 100, 2)]))
}

function summarizeCandidate(crop, market, features, candidate, keepRows = false) {
  const { curve, trades } = runCandidate(crop, market, features.get(candidate.lookback), candidate, keepRows)
  const trainCurve = curve.filter((row) => splitForDate(row.date) === 'train')
  const validationCurve = curve.filter((row) => splitForDate(row.date) === 'validation')
  const holdoutCurve = curve.filter((row) => splitForDate(row.date) === 'holdout')
  const train = metrics(trainCurve)
  const validation = metrics(validationCurve)
  const holdout = metrics(curve.filter((row) => splitForDate(row.date) === 'holdout'))
  const eligible = train.tradeCount >= 6 && validation.tradeCount >= 4
    && train.benchmarkEdgePct > 0 && validation.benchmarkEdgePct > 0
    && train.totalReturnPct > 0 && validation.totalReturnPct > 0
  const rank = validation.totalReturnPct * 1.5 + train.totalReturnPct * 0.35
    + validation.benchmarkEdgePct * 2 + train.benchmarkEdgePct * 0.5
    + validation.sharpe * 8 + train.sharpe * 2
    - Math.max(0, -validation.maxDrawdownPct - 20) * 0.25
  return {
    cropId: crop.id,
    crop: crop.label,
    symbol: crop.symbol,
    priority: crop.priority,
    candidate,
    eligible,
    selectionRank: round(rank, 4),
    train,
    validation,
    holdout,
    holdoutYears: yearReturns(holdoutCurve),
    curve,
    trades,
  }
}

function candidateGrid() {
  const candidates = []
  for (const lookback of LOOKBACKS) {
    for (const threshold of THRESHOLDS) {
      for (const holdDays of HOLD_DAYS) {
        for (const archetype of ARCHETYPES) {
          for (const cropAllocation of CROP_ALLOCATIONS) {
            candidates.push({
              id: `${archetype.id}-lb${lookback}-z${String(threshold).replace('.', '_')}-h${holdDays}-a${String(cropAllocation).replace('.', '_')}`,
              archetype: archetype.id,
              archetypeLabel: archetype.label,
              lookback,
              threshold,
              holdDays,
              cropAllocation,
            })
          }
        }
      }
    }
  }
  return candidates
}

function bhAdjust(items) {
  const sorted = items.map((item, index) => ({ index, p: item.p })).sort((a, b) => a.p - b.p)
  let prior = 1
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const rank = index + 1
    const adjusted = Math.min(prior, sorted[index].p * sorted.length / rank)
    sorted[index].q = adjusted
    prior = adjusted
  }
  const output = new Array(items.length)
  for (const item of sorted) output[item.index] = round(item.q, 4)
  return output
}

function promotion(selected, qValue) {
  const holdout = selected.holdout
  if (holdout.benchmarkEdgePct > 0 && holdout.regressionAlphaPct > 0 && qValue <= 0.1 && holdout.tradeCount >= 3) return 'A - deeper research'
  if (holdout.benchmarkEdgePct > 0 && holdout.regressionAlphaPct > 0 && holdout.tradeCount >= 3) return 'B - paper/watchlist'
  if (holdout.benchmarkEdgePct > 0 || holdout.regressionAlphaPct > 0) return 'C - screen flag only'
  return 'Reject'
}

function formatCandidateRow(result) {
  return {
    cropId: result.cropId,
    crop: result.crop,
    symbol: result.symbol,
    priority: result.priority,
    candidateId: result.candidate.id,
    archetype: result.candidate.archetype,
    lookbackDays: result.candidate.lookback,
    thresholdZ: result.candidate.threshold,
    holdSessions: result.candidate.holdDays,
    cropAllocation: result.candidate.cropAllocation,
    eligible: result.eligible,
    selectionRank: result.selectionRank,
    trainAlphaPct: result.train.regressionAlphaPct,
    trainSharpe: result.train.sharpe,
    trainTrades: result.train.tradeCount,
    validationAlphaPct: result.validation.regressionAlphaPct,
    validationSharpe: result.validation.sharpe,
    validationTrades: result.validation.tradeCount,
  }
}

function formatCropRow(selected) {
  return {
    rank: selected.selectionRankOverall,
    cropId: selected.cropId,
    crop: selected.crop,
    symbol: selected.symbol,
    priority: selected.priority,
    promotion: selected.promotion,
    selectedCandidate: selected.candidate.id,
    archetype: selected.candidate.archetype,
    lookbackDays: selected.candidate.lookback,
    thresholdZ: selected.candidate.threshold,
    holdSessions: selected.candidate.holdDays,
    cropAllocation: selected.candidate.cropAllocation,
    selectedWithoutWalkForward: true,
    validationAlphaPct: selected.validation.regressionAlphaPct,
    validationSharpe: selected.validation.sharpe,
    holdoutAlphaPct: selected.holdout.regressionAlphaPct,
    holdoutTotalReturnPct: selected.holdout.totalReturnPct,
    holdoutIndexReturnPct: selected.holdout.benchmarkReturnPct,
    holdoutEdgePct: selected.holdout.benchmarkEdgePct,
    holdoutCagrPct: selected.holdout.cagrPct,
    holdoutSharpe: selected.holdout.sharpe,
    holdoutMaxDrawdownPct: selected.holdout.maxDrawdownPct,
    holdoutTradeCount: selected.holdout.tradeCount,
    holdoutPositiveYears: `${selected.holdout.positiveYears}/${selected.holdout.yearCount}`,
    holdoutPValue: selected.holdout.pValue,
    holdoutQValue: selected.holdoutQValue,
  }
}

function portfolioCurve(selectedCrops, split = null) {
  if (!selectedCrops.length) return []
  const rowsByCrop = selectedCrops.map((selected) => new Map(selected.curve
    .filter((point) => !split || splitForDate(point.date) === split)
    .map((row) => [row.date, row])))
  const commonDates = [...rowsByCrop[0].keys()]
    .filter((date) => rowsByCrop.every((rows) => rows.has(date)))
    .sort()
  return commonDates.map((date) => {
    const rows = rowsByCrop.map((byDate) => byDate.get(date))
    return {
    date,
    strategyReturn: mean(rows.map((row) => row.strategyReturn)),
    grossReturn: mean(rows.map((row) => row.grossReturn)),
    benchmarkReturn: mean(rows.map((row) => row.benchmarkReturn)),
    position: mean(rows.map((row) => Math.abs(row.position))),
    turnover: mean(rows.map((row) => row.turnover)),
    }
  })
}

function htmlEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function metricTone(value) {
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}

function loadSensitivity() {
  const scenarios = [
    { id: 'lag3', label: '3-day availability lag', signalLagDays: 3, oneWayCostBps: 5 },
    { id: 'lag5', label: '5-day availability lag', signalLagDays: 5, oneWayCostBps: 5 },
    { id: 'cost10', label: '10 bps per side', signalLagDays: 2, oneWayCostBps: 10 },
  ]
  return scenarios.flatMap((scenario) => {
    const filePath = path.join(SENSITIVITY_DIR, scenario.id, 'run-summary.json')
    if (!fs.existsSync(filePath)) return []
    const run = JSON.parse(readText(filePath))
    return [{
      ...scenario,
      generatedAt: run.generatedAt,
      portfolio: run.portfolio.holdout,
      crops: run.selectedCrops.map((crop) => ({
        cropId: crop.cropId,
        crop: crop.crop,
        candidateId: crop.candidate.id,
        holdoutAlphaPct: crop.holdout.regressionAlphaPct,
        holdoutSharpe: crop.holdout.sharpe,
        holdoutMaxDrawdownPct: crop.holdout.maxDrawdownPct,
      })),
    }]
  })
}

function reportHtml(summary) {
  const rows = summary.selectedCrops.map((item) => `
    <tr>
      <td><span class="rank">${item.selectionRank}</span></td>
      <td><strong>${htmlEscape(item.crop)}</strong><small>${htmlEscape(item.symbol)} · ${htmlEscape(item.priority)}</small></td>
      <td><span class="bucket ${item.promotion.startsWith('A') ? 'a' : item.promotion.startsWith('B') ? 'b' : item.promotion.startsWith('C') ? 'c' : 'reject'}">${htmlEscape(item.promotion)}</span></td>
      <td>${htmlEscape(item.candidate.archetypeLabel)}<small>${item.candidate.lookback}d · z ${item.candidate.threshold} · ${item.candidate.holdDays} sessions · ${(item.candidate.cropAllocation * 100).toFixed(0)}% crop</small></td>
      <td class="number ${metricTone(item.validation.benchmarkEdgePct)}">${item.validation.benchmarkEdgePct.toFixed(2)}%</td>
      <td class="number ${metricTone(item.holdout.totalReturnPct)}">${item.holdout.totalReturnPct.toFixed(2)}%</td>
      <td class="number ${metricTone(item.holdout.benchmarkEdgePct)}">${item.holdout.benchmarkEdgePct.toFixed(2)}%</td>
      <td class="number">${item.holdout.sharpe.toFixed(2)}</td>
      <td class="number negative">${item.holdout.maxDrawdownPct.toFixed(2)}%</td>
      <td class="number">${item.holdout.tradeCount}</td>
    </tr>`).join('')
  const portfolio = summary.portfolio.holdout
  const frozenPortfolio = summary.portfolio.frozenSelection
  const top = summary.selectedCrops.find((item) => item.selectionRank === 1) ?? summary.selectedCrops[0]
  const sourceRows = summary.sources.map((source) => `<li><a href="${htmlEscape(source.url)}">${htmlEscape(source.id)}</a><span>${htmlEscape(source.role)}</span></li>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QORE Refined Crop Precipitation Walk-Forward</title>
<style>
:root{--ink:#17211d;--muted:#637069;--paper:#f4f1e9;--card:#fffdf8;--line:#d7d3c7;--green:#1e6848;--red:#a44035;--amber:#9c6b16;--blue:#315d76}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{background:#17372d;color:#f9f6ee;padding:54px max(5vw,42px) 46px;border-bottom:6px solid #b89958}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:12px;color:#d6c79e;font-weight:700}h1{font-family:Georgia,serif;font-size:clamp(38px,5vw,68px);line-height:1.02;max-width:980px;margin:10px 0 18px}header p{max-width:920px;color:#dfe7e2;font-size:17px;margin:0}.wrap{max-width:1500px;margin:auto;padding:34px max(3vw,24px) 70px}.warning{background:#fff4d9;border:1px solid #dfc17b;border-left:6px solid var(--amber);padding:16px 18px;margin-bottom:24px;border-radius:4px}.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:30px}.tile{background:var(--card);border:1px solid var(--line);padding:20px}.tile strong{display:block;font:34px Georgia,serif}.tile span{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.08em}.section{background:var(--card);border:1px solid var(--line);margin:20px 0;padding:24px}.section h2{font:28px Georgia,serif;margin:0 0 8px}.section>p{color:var(--muted);margin:0 0 20px;max-width:1050px}.table-wrap{overflow:auto;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;min-width:1180px;background:#fff}th{background:#ece8de;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#56615b;padding:12px 10px;position:sticky;top:0}td{padding:13px 10px;border-top:1px solid #e6e2d9;vertical-align:top}td small{display:block;color:var(--muted);font-size:12px;margin-top:3px}.number{text-align:right;font-variant-numeric:tabular-nums}.positive{color:var(--green);font-weight:700}.negative{color:var(--red)}.rank{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#e8e3d7}.bucket{display:inline-block;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}.bucket.a{background:#dcefe5;color:#155437}.bucket.b{background:#e5edf2;color:#254f67}.bucket.c{background:#f3ead3;color:#79530d}.bucket.reject{background:#f0dfdc;color:#83362f}.method{display:grid;grid-template-columns:1fr 1fr;gap:24px}.method h3{margin:0 0 8px;font-size:16px}.method ul{margin:0;padding-left:19px}.method li{margin:7px 0}.sources{list-style:none;padding:0!important}.sources li{display:grid;grid-template-columns:180px 1fr;padding:9px 0;border-bottom:1px solid #e6e2d9}.sources a{color:var(--blue);font-weight:700}.sources span{color:var(--muted)}footer{color:var(--muted);font-size:12px;margin-top:30px}.top-read{font-size:17px;color:var(--ink)!important}.top-read strong{color:var(--green)}
@media(max-width:900px){.tiles{grid-template-columns:1fr 1fr}.method{grid-template-columns:1fr}header{padding-left:24px;padding-right:24px}}@media(max-width:560px){.tiles{grid-template-columns:1fr}.wrap{padding-left:12px;padding-right:12px}.section{padding:16px}}
</style></head><body>
<header><div class="eyebrow">QORE research · frozen six-month evaluation</div><h1>Refined crop precipitation walk-forward</h1><p>${summary.search.candidateCount.toLocaleString()} rules were optimized only through ${summary.contract.optimizationEnd}. The frozen portfolio was then opened once on ${summary.contract.walkForwardStart}–${summary.contract.walkForwardEnd}, with the same daily-target-weight 80% VOO / 20% QQQM fallback as NGAS All-Year Beta.</p></header>
<main class="wrap">
<div class="warning"><strong>Pseudo-walk-forward discovery evidence—not a live trading result.</strong> The date embargo is real, but NASA POWER precipitation is finalized rather than archived point-in-time weather data, and Yahoo futures are uncontrolled continuous proxies.</div>
<div class="tiles"><div class="tile"><strong class="${metricTone(portfolio.totalReturnPct)}">${portfolio.totalReturnPct.toFixed(2)}%</strong><span>frozen strategy return</span></div><div class="tile"><strong>${portfolio.benchmarkReturnPct.toFixed(2)}%</strong><span>80/20 index fallback</span></div><div class="tile"><strong class="${metricTone(portfolio.benchmarkEdgePct)}">${portfolio.benchmarkEdgePct.toFixed(2)}%</strong><span>incremental edge</span></div><div class="tile"><strong class="negative">${portfolio.maxDrawdownPct.toFixed(2)}%</strong><span>maximum drawdown</span></div></div>
<section class="section"><h2>First read</h2><p class="top-read">Before the six-month window was opened, the optimizer froze <strong>${htmlEscape(frozenPortfolio.id)}</strong> using ${frozenPortfolio.cropCount} crop lane(s): ${frozenPortfolio.cropIds.map(htmlEscape).join(', ')}. It returned <strong>${portfolio.totalReturnPct.toFixed(2)}%</strong> versus ${portfolio.benchmarkReturnPct.toFixed(2)}% for the fallback basket, an incremental ${portfolio.benchmarkEdgePct.toFixed(2)} percentage points. The highest pre-walk-forward-ranked individual lane was ${htmlEscape(top.crop)}; its six-month result was ${top.holdout.totalReturnPct.toFixed(2)}% with ${top.holdout.benchmarkEdgePct.toFixed(2)} points of edge.</p></section>
<section class="section"><h2>Pre-ranked crop board</h2><p>Rank order was frozen before January 16. Walk-forward columns are evaluation-only and were not used to select rules, allocations, crops, or portfolio breadth.</p><div class="table-wrap"><table><thead><tr><th>Frozen rank</th><th>Crop</th><th>Status</th><th>Selected rule</th><th>Validation edge</th><th>Walk-forward return</th><th>Walk-forward edge</th><th>Sharpe</th><th>Max drawdown</th><th>Trades</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="section"><h2>Fallback mechanics</h2><p class="top-read">On idle days the strategy is 100% invested in the 80% VOO / 20% QQQM basket. A 35% crop position leaves 65% in that basket. Daily return is the proportional index return plus the signed crop return, less crop-position turnover cost; the basket itself keeps the all-year strategy’s costless daily-target-weight assumption.</p></section>
<section class="section"><h2>Isolation and method</h2><div class="method"><div><h3>Frozen before evaluation</h3><ul><li>Optimization ended ${summary.contract.optimizationEnd}; the January 15-to-16 return belongs to walk-forward.</li><li>The selection ledger contains no walk-forward columns.</li><li>Candidate IDs, crop allocations, portfolio breadth, costs, input hashes, and code hash were sealed under digest <code>${htmlEscape(summary.freezeDigest.slice(0,16))}…</code>.</li><li>Open positions formed before the boundary carry naturally into the first walk-forward return.</li></ul></div><div><h3>Remaining limitations</h3><ul><li>Replace finalized precipitation with archived operational GEFS vintages and availability timestamps.</li><li>Replace Yahoo continuous proxies with individual contracts, controlled rolls, collateral yield, and tick-level costs.</li><li>Add prior-year acreage, point-in-time crop progress, soil moisture, irrigation, and evapotranspiration.</li><li>Do not retune this architecture in response to the six-month result; new rules need a new future holdout.</li></ul></div></div></section>
<section class="section"><h2>Source ledger</h2><p>The data and biological hypotheses rely on official or primary sources. NASA POWER is a convenient global discovery layer, but its precipitation quality is not sufficient as the sole production dataset.</p><ul class="sources">${sourceRows}</ul></section>
<footer>Generated ${htmlEscape(summary.generatedAt)} · Frozen selection ${htmlEscape(summary.freezeDigest)} · Research-priority labels are not recommendations or approved positions.</footer>
</main></body></html>`
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256File(filePath) {
  return sha256Text(readText(filePath))
}

function sha256SelectionCsv(filePath) {
  const lines = readText(filePath).trim().split(/\r?\n/)
  const selectionLines = [lines[0], ...lines.slice(1).filter((line) => line.slice(0, 10) <= VALIDATION_END)]
  return sha256Text(`${selectionLines.join('\n')}\n`)
}

function commonContract(manifest) {
  const indexConfig = JSON.parse(readText(INDEX_BASKET_CONFIG_FILE))
  return {
    baselineStart: BASELINE_START,
    baselineEnd: BASELINE_END,
    strategyStart: STRATEGY_START,
    trainEnd: TRAIN_END,
    optimizationEnd: VALIDATION_END,
    walkForwardStart: HOLDOUT_START,
    walkForwardEnd: manifest.contract.endDate,
    signalAvailabilityLagDays: SIGNAL_AVAILABILITY_LAG_DAYS,
    oneWayCropCostBps: ONE_WAY_COST_BPS,
    selectionUsesWalkForward: false,
    indexFallback: {
      symbol: indexConfig.symbol,
      label: indexConfig.label,
      rebalance: indexConfig.rebalance,
      components: indexConfig.components.map((component) => ({ symbol: component.symbol, targetWeight: component.targetWeight })),
      formula: 'indexFraction=max(0,1-abs(cropPosition)); gross=indexFraction*indexReturn+cropPosition*cropReturn; net=gross-cropTurnoverCost',
    },
    signalTiming: 'Finalized precipitation through T-2 forms a signal at close T; the first realized return is close T to the next common crop/index session.',
    weatherCaveat: 'NASA POWER is finalized/reconstructed observation data, so this remains a pseudo-walk-forward discovery test rather than historical forecast-vintage proof.',
    marketCaveat: 'Yahoo continuous futures are proxy histories without controlled contract rolls, collateral accounting, or executable spreads. The synthetic basket assumes costless daily target-weight rebalancing.',
    alphaDefinition: 'Annualized daily regression intercept of net strategy return versus the 80/20 VOO/QQQM index fallback return.',
  }
}

function portfolioSelectionCandidates(selected) {
  const ordered = [...selected].sort((left, right) => right.selectionRank - left.selectionRank)
  return [1, 2, 3, 5, ordered.length].map((cropCount) => {
    const crops = ordered.slice(0, cropCount)
    const curve = portfolioCurve(crops)
    const train = metrics(curve.filter((row) => splitForDate(row.date) === 'train'))
    const validation = metrics(curve.filter((row) => splitForDate(row.date) === 'validation'))
    const eligible = train.benchmarkEdgePct >= 0 && validation.benchmarkEdgePct >= 0
    const selectionRank = round(validation.totalReturnPct * 1.5 + train.totalReturnPct * 0.35
      + validation.benchmarkEdgePct * 2 + train.benchmarkEdgePct * 0.5 + validation.sharpe * 8 + train.sharpe * 2, 4)
    return { id: `top-${cropCount}-equal-weight`, cropCount, cropIds: crops.map((crop) => crop.cropId), eligible, selectionRank, train, validation }
  }).sort((left, right) => right.selectionRank - left.selectionRank)
}

function inputHashes(config) {
  const fixedFiles = [CONFIG_FILE, INDEX_BASKET_CONFIG_FILE]
  const datedFiles = [
    INDEX_MARKET_FILE,
    ...config.crops.map((crop) => path.join(MARKET_DIR, `${safeSymbol(crop.symbol)}-daily.csv`)),
    ...config.crops.flatMap((crop) => crop.sites.map((site) => path.join(ACTUALS_DIR, `${site.id}.csv`))),
  ]
  const hashes = Object.fromEntries([
    ...fixedFiles.map((filePath) => [path.relative(REPO_ROOT, filePath), sha256File(filePath)]),
    ...datedFiles.map((filePath) => [path.relative(REPO_ROOT, filePath), sha256SelectionCsv(filePath)]),
  ])
  return { files: hashes, combined: sha256Text(JSON.stringify(hashes)) }
}

function selectPhase() {
  const config = JSON.parse(readText(CONFIG_FILE))
  const manifest = JSON.parse(readText(MANIFEST_FILE))
  if (manifest.status !== 'ok') throw new Error(`Crop precipitation collection manifest status is ${manifest.status}; rerun the collector.`)
  const grid = candidateGrid()
  const candidateRows = []
  const selected = []
  const allSiteFeatures = new Map()

  for (const crop of config.crops) {
    console.log(`selection features: ${crop.id}`)
    for (const site of crop.sites) {
      if (!allSiteFeatures.has(site.id)) allSiteFeatures.set(site.id, buildSiteFeatureMaps(site, VALIDATION_END))
    }
    const market = marketRows(crop.symbol, VALIDATION_END)
    if (market.some((row) => row.date >= HOLDOUT_START)) throw new Error(`Walk-forward row entered selection for ${crop.id}.`)
    const features = cropFeatures(crop, allSiteFeatures, market)
    const results = grid.map((candidate) => summarizeCandidate(crop, market, features, candidate))
      .sort((left, right) => right.selectionRank - left.selectionRank)
    candidateRows.push(...results.map(formatCandidateRow))
    const selectedBase = results.find((result) => result.eligible) ?? results[0]
    const selectedWithRows = summarizeCandidate(crop, market, features, selectedBase.candidate, true)
    selected.push(selectedWithRows)
    console.log(`frozen: ${crop.id} ${selectedBase.candidate.id} validationReturn=${selectedBase.validation.totalReturnPct}% validationEdge=${selectedBase.validation.benchmarkEdgePct}%`)
  }

  selected.sort((left, right) => right.selectionRank - left.selectionRank)
  selected.forEach((item, index) => { item.selectionRankOverall = index + 1 })
  const portfolioCandidates = portfolioSelectionCandidates(selected)
  const selectedPortfolio = portfolioCandidates.find((candidate) => candidate.eligible) ?? portfolioCandidates[0]
  const hashes = inputHashes(config)
  const frozenPayload = {
    strategyId: 'crop-precipitation-index-fallback-refined-v2',
    contract: commonContract(manifest),
    search: {
      lookbacks: LOOKBACKS,
      thresholds: THRESHOLDS,
      holdDays: HOLD_DAYS,
      cropAllocations: CROP_ALLOCATIONS,
      archetypes: ARCHETYPES,
      candidatesPerCrop: grid.length,
      objective: 'Maximize train/validation total return with positive active edge versus the exact index fallback in both splits; holdout is inaccessible during selection.',
    },
    selectedCrops: selected.map((item) => ({
      selectionRank: item.selectionRankOverall,
      cropId: item.cropId,
      crop: item.crop,
      symbol: item.symbol,
      priority: item.priority,
      candidate: item.candidate,
      eligible: item.eligible,
      selectionScore: item.selectionRank,
      train: item.train,
      validation: item.validation,
    })),
    portfolio: {
      selected: selectedPortfolio,
      candidates: portfolioCandidates,
    },
    inputHashes: hashes,
    codeHash: sha256File(fileURLToPath(import.meta.url)),
  }
  const freezeDigest = sha256Text(JSON.stringify(frozenPayload))
  const frozenSelection = { generatedAt: new Date().toISOString(), freezeDigest, ...frozenPayload }
  const selectionSummary = {
    generatedAt: frozenSelection.generatedAt,
    status: 'selection-frozen-walk-forward-unopened',
    freezeDigest,
    contract: frozenPayload.contract,
    search: { ...frozenPayload.search, candidateCount: grid.length * config.crops.length, eligibleCandidateCount: candidateRows.filter((row) => row.eligible).length },
    selectedCrops: frozenPayload.selectedCrops,
    portfolio: frozenPayload.portfolio,
  }
  writeText(path.join(OUTPUT_ROOT, 'candidate-summary.csv'), rowsToCsv(candidateRows, Object.keys(candidateRows[0])))
  writeText(path.join(OUTPUT_ROOT, 'frozen-selection.json'), `${JSON.stringify(frozenSelection, null, 2)}\n`)
  writeText(path.join(OUTPUT_ROOT, 'selection-summary.json'), `${JSON.stringify(selectionSummary, null, 2)}\n`)
  console.log(`selection frozen: ${path.relative(REPO_ROOT, path.join(OUTPUT_ROOT, 'frozen-selection.json'))}`)
  console.log(`freeze digest: ${freezeDigest}`)
}

function evaluatePhase() {
  const config = JSON.parse(readText(CONFIG_FILE))
  const manifest = JSON.parse(readText(MANIFEST_FILE))
  const frozenFile = path.join(OUTPUT_ROOT, 'frozen-selection.json')
  if (!fs.existsSync(frozenFile)) throw new Error('Missing frozen-selection.json. Run the selection phase before opening walk-forward data.')
  const frozen = JSON.parse(readText(frozenFile))
  const frozenPayload = { ...frozen }
  delete frozenPayload.generatedAt
  delete frozenPayload.freezeDigest
  if (sha256Text(JSON.stringify(frozenPayload)) !== frozen.freezeDigest) throw new Error('Frozen selection digest mismatch.')
  const currentContract = commonContract(manifest)
  if (JSON.stringify(currentContract) !== JSON.stringify(frozen.contract)) {
    throw new Error('Frozen selection contract does not match the current runtime and collection contract. Rerun the selection phase before evaluation.')
  }
  const currentInputHashes = inputHashes(config)
  if (JSON.stringify(currentInputHashes) !== JSON.stringify(frozen.inputHashes)) {
    throw new Error('Frozen selection input hashes do not match the current pre-cutoff inputs. Rerun the selection phase before evaluation.')
  }
  if (sha256File(fileURLToPath(import.meta.url)) !== frozen.codeHash) {
    throw new Error('Frozen selection code hash does not match the current optimizer. Rerun the selection phase before evaluation.')
  }
  const allSiteFeatures = new Map()
  const selected = []

  for (const frozenCrop of frozen.selectedCrops) {
    const crop = config.crops.find((item) => item.id === frozenCrop.cropId)
    if (!crop) throw new Error(`Frozen crop ${frozenCrop.cropId} is absent from config.`)
    for (const site of crop.sites) {
      if (!allSiteFeatures.has(site.id)) allSiteFeatures.set(site.id, buildSiteFeatureMaps(site))
    }
    const market = marketRows(crop.symbol)
    const features = cropFeatures(crop, allSiteFeatures, market)
    const evaluated = summarizeCandidate(crop, market, features, frozenCrop.candidate, true)
    evaluated.selectionRankOverall = frozenCrop.selectionRank
    evaluated.frozenSelectionScore = frozenCrop.selectionScore
    selected.push(evaluated)
    console.log(`walk-forward: ${crop.id} return=${evaluated.holdout.totalReturnPct}% edge=${evaluated.holdout.benchmarkEdgePct}%`)
  }

  const qValues = bhAdjust(selected.map((item) => ({ p: item.holdout.pValue })))
  selected.forEach((item, index) => {
    item.holdoutQValue = qValues[index]
    item.promotion = promotion(item, item.holdoutQValue)
  })
  selected.sort((left, right) => left.selectionRankOverall - right.selectionRankOverall)
  const portfolioCrops = frozen.portfolio.selected.cropIds.map((cropId) => selected.find((item) => item.cropId === cropId))
  if (portfolioCrops.some((item) => !item)) throw new Error('Frozen portfolio references a missing selected crop.')
  const portfolioCurveAll = portfolioCurve(portfolioCrops)
  const portfolioHoldoutCurve = portfolioCurveAll.filter((row) => splitForDate(row.date) === 'holdout')
  const portfolioHoldout = metrics(portfolioHoldoutCurve)
  const selectedTrades = selected.flatMap((item) => item.trades)
  const selectedDaily = selected.flatMap((item) => item.curve.map((row) => ({ cropId: item.cropId, symbol: item.symbol, ...row })))
  const walkForwardTrades = selectedTrades.filter((row) => row.entryReturnDate >= HOLDOUT_START)
  const cropRows = selected.map(formatCropRow)
  const summary = {
    generatedAt: new Date().toISOString(),
    strategyId: frozen.strategyId,
    status: 'six-month-pseudo-walk-forward-evaluated-once',
    freezeDigest: frozen.freezeDigest,
    data: {
      configFile: path.relative(REPO_ROOT, CONFIG_FILE),
      collectionManifest: path.relative(REPO_ROOT, MANIFEST_FILE),
      indexBasketFile: path.relative(REPO_ROOT, INDEX_MARKET_FILE),
      crops: config.crops.length,
      weatherSites: manifest.counts.sites,
      weatherRows: manifest.counts.weatherRows,
      marketRows: manifest.counts.marketRows,
      marketStartDate: STRATEGY_START,
      marketEndDate: manifest.contract.endDate,
    },
    contract: frozen.contract,
    search: { ...frozen.search, candidateCount: frozen.search.candidatesPerCrop * config.crops.length },
    selectedCrops: selected.map((item) => ({
      selectionRank: item.selectionRankOverall,
      cropId: item.cropId,
      crop: item.crop,
      symbol: item.symbol,
      priority: item.priority,
      hypothesis: config.crops.find((crop) => crop.id === item.cropId).hypothesis,
      candidate: item.candidate,
      promotion: item.promotion,
      holdoutQValue: item.holdoutQValue,
      train: item.train,
      validation: item.validation,
      holdout: item.holdout,
      holdoutYears: item.holdoutYears,
    })),
    portfolio: {
      frozenSelection: frozen.portfolio.selected,
      holdout: portfolioHoldout,
      holdoutYears: yearReturns(portfolioHoldoutCurve),
      openPositionsAtEnd: portfolioCrops.map((item) => ({ cropId: item.cropId, position: item.curve.at(-1)?.position ?? 0 })).filter((item) => item.position !== 0),
    },
    sensitivity: { posture: 'Not opened during the first six-month walk-forward evaluation.', scenarios: [] },
    sources: [
      ...config.sources,
      { id: 'NASA POWER precipitation assessment', url: 'https://power.larc.nasa.gov/docs/methodology/meteorology/assessment/', role: 'Validation caveat for precipitation quality' },
      { id: 'NOAA GEFS archive', url: 'https://www.ncei.noaa.gov/products/weather-climate-models/global-ensemble-forecast', role: 'Next-stage operational forecast-vintage source' },
      { id: 'USDA NASS Crop Progress', url: 'https://www.nass.usda.gov/Surveys/Guide_to_NASS_Surveys/Crop_Progress_and_Condition/index.php', role: 'Next-stage point-in-time phenology clock' },
    ],
    outputs: {
      report: path.relative(REPO_ROOT, path.join(OUTPUT_ROOT, 'report.html')),
      cropSummary: path.relative(REPO_ROOT, path.join(OUTPUT_ROOT, 'crop-summary.csv')),
      candidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_ROOT, 'candidate-summary.csv')),
      frozenSelection: path.relative(REPO_ROOT, frozenFile),
      selectedTrades: path.relative(REPO_ROOT, path.join(OUTPUT_ROOT, 'selected-trades.csv')),
      selectedDaily: path.relative(REPO_ROOT, path.join(OUTPUT_ROOT, 'selected-daily.csv')),
      walkForwardTrades: path.relative(REPO_ROOT, path.join(OUTPUT_ROOT, 'walk-forward-trades.csv')),
      runSummary: path.relative(REPO_ROOT, path.join(OUTPUT_ROOT, 'run-summary.json')),
    },
  }
  writeText(path.join(OUTPUT_ROOT, 'crop-summary.csv'), rowsToCsv(cropRows, Object.keys(cropRows[0])))
  writeText(path.join(OUTPUT_ROOT, 'selected-trades.csv'), rowsToCsv(selectedTrades, Object.keys(selectedTrades[0] ?? { cropId: '' })))
  writeText(path.join(OUTPUT_ROOT, 'selected-daily.csv'), rowsToCsv(selectedDaily, Object.keys(selectedDaily[0] ?? { cropId: '' })))
  writeText(path.join(OUTPUT_ROOT, 'walk-forward-trades.csv'), rowsToCsv(walkForwardTrades, Object.keys(walkForwardTrades[0] ?? { cropId: '' })))
  writeText(path.join(OUTPUT_ROOT, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_ROOT, 'report.html'), reportHtml(summary))
  console.log(`report: ${summary.outputs.report}`)
  console.log(`frozen portfolio walk-forward return=${portfolioHoldout.totalReturnPct}% benchmark=${portfolioHoldout.benchmarkReturnPct}% edge=${portfolioHoldout.benchmarkEdgePct}%`)
}

if (process.argv.includes('--evaluate')) evaluatePhase()
else selectPhase()
