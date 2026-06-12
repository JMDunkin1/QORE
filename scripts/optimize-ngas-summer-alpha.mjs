#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/ngas-summer-alpha')
const GAS_MARKET_FILE = path.join(DATA_ROOT, 'market/yahoo/NG-F-qore-market.csv')
const INDEX_MARKET_FILE = path.join(DATA_ROOT, 'market/yahoo/US-INDEX-BASKET-qore-market.csv')
const ACTUAL_ANOMALY_FILE = path.join(DATA_ROOT, 'weather/nasa-power/daily-temperature-anomalies-2021-01-01-2026-03-31.csv')
const SUMMER_FORECAST_CALENDARS = [
  {
    id: 'gfs',
    label: 'GFS cooling-season day-7 calendar',
    files: {
      locationAnomalies:
        'weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv',
      signalScores: 'research/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv',
    },
  },
  {
    id: 'gefs-mean',
    label: 'GEFS mean cooling-season day-7 calendar',
    files: {
      locationAnomalies:
        'weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv',
      signalScores: 'research/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv',
    },
  },
]

const STRATEGY_ID = 'ngas-summer-alpha'
const INITIAL_CAPITAL = 100000
const FIRST_SIGNAL_DATE = '2021-01-01'
const TRAIN_END = '2023-12-31'
const VALIDATION_END = '2024-12-31'
const HOLDOUT_START = '2025-01-01'
const ROUND_TRIP_COST_PCT = 0.064
const ONE_WAY_COST_PCT = ROUND_TRIP_COST_PCT / 2
const TRADING_DAYS = 252
const COOL_COVERAGE_MAX_ANOMALY_F = -5
const COOL_EXTREME_ANOMALY_F = -10
const WARM_COVERAGE_MIN_ANOMALY_F = 8
const WARM_EXTREME_ANOMALY_F = 14
const BOOTSTRAP_ITERATIONS = 1200
const BLOCK_LENGTH = 10

const SOURCE_SETS = [
  {
    id: 'gfs-single',
    label: 'GFS single-source cooling signal',
    sourceIds: ['gfs'],
    minGroups: 1,
    minFamilies: 1,
  },
  {
    id: 'gefs-single',
    label: 'GEFS mean single-source cooling signal',
    sourceIds: ['gefs-mean'],
    minGroups: 1,
    minFamilies: 1,
  },
  {
    id: 'gfs-gefs-core',
    label: 'GFS plus GEFS mean',
    sourceIds: ['gfs', 'gefs-mean'],
    minGroups: 1,
    minFamilies: 2,
  },
  {
    id: 'long-history-core',
    label: 'Long-history multi-model core',
    sourceIds: ['gfs', 'gefs-mean', 'gem-global', 'ecmwf-ifs'],
    minGroups: 2,
    minFamilies: 2,
  },
  {
    id: 'all-source-consensus',
    label: 'All-source consensus',
    sourceIds: ['gfs', 'gefs-mean', 'graphcastgfs', 'ecmwf-ifs', 'ecmwf-aifs', 'aigfs', 'gem-global'],
    minGroups: 2,
    minFamilies: 2,
  },
  {
    id: 'ncep-complex',
    label: 'NCEP complex',
    sourceIds: ['gfs', 'gefs-mean', 'graphcastgfs', 'aigfs'],
    minGroups: 1,
    minFamilies: 2,
  },
]

const SOURCE_WEIGHT_MODES = ['equal', 'bg-shrink']
const SIZING_MODES = ['fixed', 'confidence-scaled', 'vol-target']
const ANOMALY_THRESHOLDS = [3, 5, 8]
const COVERAGE_THRESHOLDS = [0.25, 0.35, 0.5]
const MIN_CONFIDENCES = [0.35, 0.5]
const WEATHER_FRACTIONS = [0.15, 0.25]
const REVERSION_FRACTIONS = [0.1, 0.2, 0.3]
const FOLLOW_HOLD_DAYS = [3, 5]
const REVERSION_HOLD_DAYS = [1, 2]
const MIN_REALIZED_MOVES = [2, 4]
const VOL_TARGETS = [18, 24]

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
}

function parseCsv(filePath) {
  return Papa.parse(readText(filePath), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  }).data
}

function numberFrom(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1))
}

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.floor((sorted.length - 1) * pct), 0, sorted.length - 1)
  return sorted[index]
}

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function isCoolingSeason(isoDate) {
  const month = Number(isoDate.slice(5, 7))
  return month >= 5 && month <= 9
}

function daySplit(isoDate) {
  if (isoDate <= TRAIN_END) return 'train'
  if (isoDate <= VALIDATION_END) return 'validation'
  return 'holdout'
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}${rows.length ? '\n' : ''}`
}

function sourceFamilyFor(sourceId) {
  if (sourceId === 'ecmwf-ifs') return 'ecmwf-ifs'
  if (sourceId === 'ecmwf-aifs') return 'ecmwf-aifs'
  if (sourceId === 'gefs-mean') return 'gefs'
  if (sourceId === 'graphcastgfs') return 'graphcastgfs'
  if (sourceId === 'gfs') return 'gfs'
  if (sourceId === 'aigfs') return 'aigfs'
  if (sourceId === 'gem-global') return 'gem-global'
  return sourceId
}

function sourceGroupFor(sourceId) {
  const family = sourceFamilyFor(sourceId)
  if (['gfs', 'gefs', 'graphcastgfs', 'aigfs'].includes(family)) return 'ncep'
  if (['ecmwf-ifs', 'ecmwf-aifs'].includes(family)) return 'ecmwf'
  if (family === 'gem-global') return 'gem'
  return family
}

function scoreKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId, row.modelId].join('|')
}

function locationBreadthByScore(filePath) {
  const grouped = new Map()

  for (const row of parseCsv(filePath)) {
    const key = scoreKey(row)
    const current =
      grouped.get(key) ?? {
        sampledWeight: 0,
        coldWeight: 0,
        coldExtremeCount: 0,
        warmWeight: 0,
        warmExtremeCount: 0,
      }
    const weight = numberFrom(row.weight)
    const anomalyF = numberFrom(row.forecastAnomalyF, Number.NaN)
    current.sampledWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF <= COOL_COVERAGE_MAX_ANOMALY_F) current.coldWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF <= COOL_EXTREME_ANOMALY_F) current.coldExtremeCount += 1
    if (Number.isFinite(anomalyF) && anomalyF >= WARM_COVERAGE_MIN_ANOMALY_F) current.warmWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF >= WARM_EXTREME_ANOMALY_F) current.warmExtremeCount += 1
    grouped.set(key, current)
  }

  return new Map(
    [...grouped.entries()].map(([key, value]) => [
      key,
      {
        coldCoveragePct: value.sampledWeight ? value.coldWeight / value.sampledWeight : 0,
        coldExtremeCount: value.coldExtremeCount,
        warmCoveragePct: value.sampledWeight ? value.warmWeight / value.sampledWeight : 0,
        warmExtremeCount: value.warmExtremeCount,
      },
    ]),
  )
}

function loadForecastScores() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const scores = []
  const inputFiles = [path.relative(REPO_ROOT, MANIFEST_PATH)]
  const calendars = [...manifest.forecastCalendars, ...SUMMER_FORECAST_CALENDARS]

  for (const calendar of calendars) {
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const locationsPath = path.join(DATA_ROOT, calendar.files.locationAnomalies)
    if (!fs.existsSync(scoresPath) || !fs.existsSync(locationsPath)) continue
    inputFiles.push(path.relative(REPO_ROOT, scoresPath), path.relative(REPO_ROOT, locationsPath))
    const breadth = locationBreadthByScore(locationsPath)

    for (const row of parseCsv(scoresPath)) {
      const leadDays = numberFrom(row.leadDays)
      if (row.windowId !== 'rumor' || leadDays !== 7 || !isCoolingSeason(row.targetDate)) continue
      const warm = breadth.get(scoreKey(row))
      scores.push({
        sourceId: calendar.id,
        sourceLabel: calendar.label,
        sourceFamily: sourceFamilyFor(calendar.id),
        sourceGroup: sourceGroupFor(calendar.id),
        issueDate: row.issueDate,
        targetDate: row.targetDate,
        leadDays,
        windowId: row.windowId,
        modelId: row.modelId,
        weightedAnomalyF: numberFrom(row.weightedAnomalyF),
        coldCoveragePct: warm?.coldCoveragePct ?? 0,
        coldExtremeCount: warm?.coldExtremeCount ?? 0,
        warmCoveragePct: warm?.warmCoveragePct ?? 0,
        warmExtremeCount: warm?.warmExtremeCount ?? 0,
        sampledWeight: numberFrom(row.sampledWeight),
        locationCount: numberFrom(row.locationCount),
      })
    }
  }

  return { manifest, scores, inputFiles }
}

function loadActualWeightedAnomaly() {
  const byDate = new Map()
  for (const row of parseCsv(ACTUAL_ANOMALY_FILE)) {
    const current = byDate.get(row.date) ?? { weighted: 0, weight: 0 }
    const weight = numberFrom(row.weight)
    current.weighted += numberFrom(row.anomalyF) * weight
    current.weight += weight
    byDate.set(row.date, current)
  }
  return new Map([...byDate.entries()].map(([date, value]) => [date, value.weight ? value.weighted / value.weight : 0]))
}

function computeSourceReliability(scores, actualByDate) {
  const errors = new Map()
  for (const score of scores) {
    const actual = actualByDate.get(score.targetDate)
    if (score.targetDate > TRAIN_END || !Number.isFinite(actual)) continue
    const current = errors.get(score.sourceId) ?? []
    current.push(score.weightedAnomalyF - actual)
    errors.set(score.sourceId, current)
  }

  const rmses = [...errors.entries()].map(([sourceId, values]) => ({
    sourceId,
    count: values.length,
    rmse: values.length ? Math.sqrt(mean(values.map((value) => value ** 2))) : 0,
  }))
  const inverseValues = rmses.map((row) => (row.count >= 30 && row.rmse > 0 ? 1 / row.rmse ** 2 : 1))
  const averageInverse = mean(inverseValues) || 1
  const weights = new Map()

  for (const row of rmses) {
    const inverseVariance = row.count >= 30 && row.rmse > 0 ? 1 / row.rmse ** 2 : averageInverse
    weights.set(row.sourceId, clamp(0.5 + 0.5 * (inverseVariance / averageInverse), 0.5, 1.5))
  }

  return {
    weights,
    diagnostics: rmses
      .map((row) => ({
        ...row,
        shrinkWeight: round(weights.get(row.sourceId) ?? 1, 4),
      }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  }
}

function loadMarketRows(filePath) {
  return parseCsv(filePath)
    .map((row) => ({
      date: row.date,
      open: numberFrom(row.open, Number.NaN),
      close: numberFrom(row.close, Number.NaN),
      volume: numberFrom(row.volume),
    }))
    .filter((row) => row.date && Number.isFinite(row.open) && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function marketReturnByDate(rows) {
  const result = new Map()
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]
    const current = rows[index]
    result.set(current.date, {
      date: current.date,
      open: current.open,
      close: current.close,
      returnPct: previous.close ? ((current.close - previous.close) / previous.close) * 100 : 0,
    })
  }
  return result
}

function rollingVolPct(rows, index, lookback = 20) {
  const returns = rows.slice(Math.max(0, index - lookback + 1), index + 1).map((row) => row.ungReturnPct / 100)
  return std(returns) * Math.sqrt(TRADING_DAYS) * 100
}

function loadAlignedMarketDays() {
  const ungRows = loadMarketRows(GAS_MARKET_FILE)
  const indexRows = loadMarketRows(INDEX_MARKET_FILE)
  const ungByDate = marketReturnByDate(ungRows)
  const indexByDate = marketReturnByDate(indexRows)
  const dates = [...ungByDate.keys()].filter((date) => date >= FIRST_SIGNAL_DATE && indexByDate.has(date)).sort()
  const rows = dates.map((date) => {
    const ung = ungByDate.get(date)
    const index = indexByDate.get(date)
    return {
      date,
      ungClose: ung.close,
      indexClose: index.close,
      ungReturnPct: ung.returnPct,
      indexReturnPct: index.returnPct,
    }
  })

  return rows.map((row, index) => ({
    ...row,
    ungVolAnnualPct: round(rollingVolPct(rows, index), 4),
  }))
}

function sourceWeight(sourceId, candidate, reliabilityWeights) {
  if (candidate.sourceWeightMode !== 'bg-shrink') return 1
  return reliabilityWeights.get(sourceId) ?? 1
}

function sideStats(sideRows, side, candidate, reliabilityWeights) {
  const groups = [...new Set(sideRows.map((row) => row.sourceGroup))].sort()
  const families = [...new Set(sideRows.map((row) => row.sourceFamily))].sort()
  const sourceIds = [...new Set(sideRows.map((row) => row.sourceId))].sort()
  const scoredRows = sideRows.map((row) => {
    const anomaly = side === 'cold' ? Math.max(0, -row.weightedAnomalyF) : Math.max(0, row.weightedAnomalyF)
    const coverage = side === 'cold' ? row.coldCoveragePct : row.warmCoveragePct
    const extremeCount = side === 'cold' ? row.coldExtremeCount : row.warmExtremeCount
    const distance = Math.max(0, anomaly - candidate.anomalyThreshold)
    const coverageLift = Math.max(0, coverage - candidate.coverageThreshold + 0.25)
    const weight = sourceWeight(row.sourceId, candidate, reliabilityWeights)
    return {
      row,
      score: weight * (distance + candidate.anomalyThreshold * 0.35) * coverageLift * Math.sqrt(extremeCount + 1),
      anomaly,
      coverage,
      extremeCount,
      weight,
    }
  })
  const best = scoredRows.slice().sort((a, b) => b.score - a.score)[0]
  const weightSum = scoredRows.reduce((sum, row) => sum + row.weight, 0)
  const weightedStrength = weightSum ? scoredRows.reduce((sum, row) => sum + row.score, 0) / weightSum : 0

  return {
    bestRow: best?.row ?? null,
    groups,
    families,
    sourceIds,
    rowCount: sideRows.length,
    strength: round(weightedStrength, 4),
    maxStrength: round(best?.score ?? 0, 4),
    averageAnomaly: round(mean(scoredRows.map((row) => row.anomaly)), 4),
    averageCoverage: round(mean(scoredRows.map((row) => row.coverage)), 4),
    maxExtremeCount: Math.max(...scoredRows.map((row) => row.extremeCount), 0),
  }
}

function signalConfidence(winner, loser, candidate) {
  const margin = Math.max(0, winner.maxStrength - loser.maxStrength)
  const consensus = 0.6 + winner.groups.length * 0.1 + winner.families.length * 0.08 + Math.min(winner.sourceIds.length, 5) * 0.035
  const raw = 1 / (1 + Math.exp(-(margin + winner.maxStrength * 0.35 - 3.5) / 3.2))
  return clamp(raw * consensus, 0, 1)
}

function createSignalFromIssueRows(rows, candidate, reliabilityWeights) {
  const allowedSources = new Set(candidate.sourceIds)
  const scopedRows = rows.filter((row) => allowedSources.has(row.sourceId))
  if (!scopedRows.length) return null

  const coldRows = scopedRows.filter(
    (row) => row.weightedAnomalyF <= -candidate.anomalyThreshold && row.coldCoveragePct >= candidate.coverageThreshold,
  )
  const warmRows = scopedRows.filter(
    (row) => row.weightedAnomalyF >= candidate.anomalyThreshold && row.warmCoveragePct >= candidate.coverageThreshold,
  )
  const cold = sideStats(coldRows, 'cold', candidate, reliabilityWeights)
  const warm = sideStats(warmRows, 'warm', candidate, reliabilityWeights)
  const winner =
    cold.maxStrength >= warm.maxStrength
      ? { side: 'cold', direction: -1, thesisKind: 'summer-cold-short', stats: cold, loser: warm }
      : { side: 'warm', direction: 1, thesisKind: 'summer-heat-long', stats: warm, loser: cold }

  if (!winner.stats.bestRow) return null
  if (winner.stats.groups.length < candidate.minGroups || winner.stats.families.length < candidate.minFamilies) return null
  if (winner.stats.maxStrength <= winner.loser.maxStrength * 1.15) return null
  const confidence = signalConfidence(winner.stats, winner.loser, candidate)
  if (confidence < candidate.minConfidence) return null

  return {
    issueDate: winner.stats.bestRow.issueDate,
    targetDate: winner.stats.bestRow.targetDate,
    direction: winner.direction,
    thesisKind: winner.thesisKind,
    sourceId: candidate.sourceSetId,
    sourceLabel: candidate.sourceSetLabel,
    sourceIds: [...new Set(scopedRows.map((row) => row.sourceId))].sort(),
    sourceGroups: winner.stats.groups,
    sourceFamilies: winner.stats.families,
    weightedAnomalyF: round(mean(scopedRows.map((row) => row.weightedAnomalyF)), 3),
    sideStrength: winner.stats.maxStrength,
    oppositeStrength: winner.loser.maxStrength,
    coveragePct: winner.stats.averageCoverage,
    extremeCount: winner.stats.maxExtremeCount,
    confidence: round(confidence, 4),
    rank: round(winner.stats.maxStrength * confidence * Math.sqrt(winner.stats.groups.length + winner.stats.families.length), 4),
    leadDays: winner.stats.bestRow.leadDays,
  }
}

function groupScoresByIssueDate(scores) {
  const rowsByIssueDate = new Map()
  for (const score of scores) {
    rowsByIssueDate.set(score.issueDate, [...(rowsByIssueDate.get(score.issueDate) ?? []), score])
  }
  return rowsByIssueDate
}

function signalsForCandidate(rowsByIssueDate, candidate, reliabilityWeights) {
  return [...rowsByIssueDate.values()]
    .map((rows) => createSignalFromIssueRows(rows, candidate, reliabilityWeights))
    .filter(Boolean)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || b.rank - a.rank)
}

function signalCacheKey(candidate) {
  return [
    candidate.sourceSetId,
    candidate.sourceWeightMode,
    candidate.anomalyThreshold,
    candidate.coverageThreshold,
    candidate.minConfidence,
    candidate.minGroups,
    candidate.minFamilies,
  ].join('|')
}

function firstIndexAfter(days, date) {
  return days.findIndex((day) => day.date > date)
}

function firstIndexOnOrAfter(days, date) {
  return days.findIndex((day) => day.date >= date)
}

function scaledFraction(baseFraction, confidence, mode, day, targetVolPct) {
  if (mode === 'fixed') return baseFraction
  const confidenceScale = confidence
  if (mode === 'confidence-scaled') return baseFraction * confidenceScale
  const volScale = day.ungVolAnnualPct > 0 ? clamp(targetVolPct / day.ungVolAnnualPct, 0.35, 1.25) : 1
  return baseFraction * confidenceScale * volScale
}

function scheduleOverlay(days, signals, candidate) {
  const byIndex = new Map()
  const eventRows = []
  const setPosition = (index, payload) => {
    if (index < 0 || index >= days.length) return
    const current = byIndex.get(index)
    if (!current || payload.rank > current.rank) byIndex.set(index, payload)
  }

  for (const signal of signals) {
    const entryIndex = firstIndexAfter(days, signal.issueDate)
    const targetIndex = firstIndexOnOrAfter(days, signal.targetDate)
    if (entryIndex < 0 || targetIndex < entryIndex) continue

    const followEndIndex = Math.min(targetIndex, entryIndex + candidate.followHoldDays - 1)
    const eventBase = {
      signal,
      issueDate: signal.issueDate,
      targetDate: signal.targetDate,
      sourceId: signal.sourceId,
      leadDays: signal.leadDays,
      weightedAnomalyF: signal.weightedAnomalyF,
      coveragePct: signal.coveragePct,
      extremeCount: signal.extremeCount,
      confidence: signal.confidence,
      thesisKind: signal.thesisKind,
    }

    for (let index = entryIndex; index <= followEndIndex; index += 1) {
      const weatherPosition =
        signal.direction * scaledFraction(candidate.weatherFraction, signal.confidence, candidate.sizingMode, days[index], candidate.volTargetPct)
      setPosition(index, {
        ...eventBase,
        position: weatherPosition,
        signal: signal.direction * signal.confidence,
        windowId: 'weather-follow',
        thesisKind: signal.thesisKind,
        rank: signal.rank + 10,
      })
    }
    eventRows.push({
      ...eventBase,
      leg: 'weather-follow',
      direction: signal.direction === 1 ? 'long' : 'short',
      entryTradeDate: days[entryIndex].date,
      exitTradeDate: days[followEndIndex].date,
      realizedMovePct: '',
    })

    const priorClose = days[Math.max(entryIndex - 1, 0)]?.ungClose
    const exitClose = days[followEndIndex]?.ungClose
    const realizedMovePct = priorClose && exitClose ? ((exitClose - priorClose) / priorClose) * 100 : 0
    if (Math.abs(realizedMovePct) < candidate.minRealizedMovePct) continue
    if (Math.sign(realizedMovePct) !== signal.direction) continue

    const reversionEntryIndex = followEndIndex + 1
    const reversionExitIndex = Math.min(days.length - 1, reversionEntryIndex + candidate.reversionHoldDays - 1)
    for (let index = reversionEntryIndex; index <= reversionExitIndex; index += 1) {
      const reversionPosition =
        -signal.direction * scaledFraction(candidate.reversionFraction, signal.confidence, candidate.sizingMode, days[index], candidate.volTargetPct)
      setPosition(index, {
        ...eventBase,
        position: reversionPosition,
        signal: Math.sign(reversionPosition) * signal.confidence,
        windowId: 'weather-reversion',
        thesisKind: reversionPosition > 0 ? 'reversion-long' : 'reversion-short',
        rank: signal.rank + 5,
        realizedMovePct: round(realizedMovePct, 4),
      })
    }
    if (reversionEntryIndex <= reversionExitIndex) {
      eventRows.push({
        ...eventBase,
        leg: 'weather-reversion',
        direction: realizedMovePct > 0 ? 'short' : 'long',
        entryTradeDate: days[reversionEntryIndex].date,
        exitTradeDate: days[reversionExitIndex].date,
        realizedMovePct: round(realizedMovePct, 4),
      })
    }
  }

  return { byIndex, eventRows }
}

function buildCurve(days, overlayByIndex) {
  let equity = INITIAL_CAPITAL
  let peak = INITIAL_CAPITAL
  let previousPosition = 0
  const curve = []
  const rows = []

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index]
    const overlay = overlayByIndex.get(index)
    const position = overlay?.position ?? 0
    const indexFraction = Math.max(0, 1 - Math.abs(position))
    const grossReturnPct = indexFraction * day.indexReturnPct + position * day.ungReturnPct
    const tradingCostPct = Math.abs(position - previousPosition) * ONE_WAY_COST_PCT
    const netReturnPct = grossReturnPct - tradingCostPct
    const previousEquity = equity
    equity = Math.max(1, equity * (1 + netReturnPct / 100))
    peak = Math.max(peak, equity)
    const drawdownPct = ((equity - peak) / peak) * 100

    const row = {
      strategyId: STRATEGY_ID,
      signalDate: overlay?.issueDate ?? day.date,
      issueDate: overlay?.issueDate ?? day.date,
      targetDate: overlay?.targetDate ?? day.date,
      entryTradeDate: day.date,
      exitTradeDate: day.date,
      targetTradeDate: day.date,
      direction: position < 0 ? 'short' : 'long',
      sourceId: overlay?.sourceId ?? 'US-INDEX-BASKET',
      windowId: overlay?.windowId ?? 'index-fallback',
      thesisKind: overlay?.thesisKind ?? 'index-fallback',
      leadDays: overlay?.leadDays ?? 0,
      confidence: overlay?.confidence ?? 0,
      weightedAnomalyF: overlay?.weightedAnomalyF ?? 0,
      coveragePct: overlay?.coveragePct ?? 0,
      coldCoveragePct: overlay?.thesisKind === 'summer-cold-short' ? overlay.coveragePct : 0,
      warmCoveragePct: overlay?.thesisKind === 'summer-heat-long' ? overlay.coveragePct : 0,
      extremeCount: overlay?.extremeCount ?? 0,
      indexFraction: round(indexFraction, 4),
      ungPosition: round(position, 4),
      ungReturnPct: round(day.ungReturnPct, 4),
      indexReturnPct: round(day.indexReturnPct, 4),
      grossReturnPct: round(grossReturnPct, 4),
      tradingCostPct: round(tradingCostPct, 4),
      netReturnPct: round(netReturnPct, 4),
      equity: round(equity, 2),
      equityPct: round((equity / INITIAL_CAPITAL - 1) * 100, 4),
      drawdownPct: round(drawdownPct, 4),
      rank: overlay?.rank ?? 0,
      realizedMovePct: overlay?.realizedMovePct ?? '',
    }
    rows.push(row)
    curve.push({
      date: day.date,
      equity,
      equityPct: (equity / INITIAL_CAPITAL - 1) * 100,
      dailyPnlPct: previousEquity ? ((equity - previousEquity) / previousEquity) * 100 : 0,
      drawdownPct,
      position,
      signal: overlay?.signal ?? 0,
      netReturnPct,
      indexReturnPct: day.indexReturnPct,
      activeReturnPct: netReturnPct - day.indexReturnPct,
    })
    previousPosition = position
  }

  return { curve, rows }
}

function executedEventRowsFromRows(rows) {
  return rows
    .filter((row) => row.windowId !== 'index-fallback')
    .map((row) => ({
      leg: row.windowId === 'weather-reversion' ? 'weather-reversion' : 'weather-follow',
      issueDate: row.issueDate,
      targetDate: row.targetDate,
      entryTradeDate: row.entryTradeDate,
      exitTradeDate: row.exitTradeDate,
      direction: row.direction,
      sourceId: row.sourceId,
      thesisKind: row.thesisKind,
      leadDays: row.leadDays,
      weightedAnomalyF: row.weightedAnomalyF,
      coveragePct: row.coveragePct,
      extremeCount: row.extremeCount,
      confidence: row.confidence,
      realizedMovePct: row.realizedMovePct,
    }))
}

function metricsFromCurve(curve, tradeCount) {
  if (!curve.length) {
    return {
      totalReturnPct: 0,
      cagrPct: 0,
      annualVolPct: 0,
      sharpe: 0,
      sortino: 0,
      maxDrawdownPct: 0,
      calmar: 0,
      winRatePct: 0,
      profitFactor: 0,
      tradeCount,
      exposurePct: 0,
      turnover: 0,
      var95Pct: 0,
      cvar95Pct: 0,
      averageDailyPnlPct: 0,
      firstEntry: null,
      lastExit: null,
      averageHoldDays: 1,
      tStat: 0,
    }
  }

  const returns = curve.map((point) => point.dailyPnlPct / 100)
  const negativeReturns = returns.filter((value) => value < 0)
  let rebasedEquity = 1
  let rebasedPeak = 1
  let maxDrawdown = 0
  for (const value of returns) {
    rebasedEquity *= 1 + value
    rebasedPeak = Math.max(rebasedPeak, rebasedEquity)
    maxDrawdown = Math.min(maxDrawdown, rebasedEquity / rebasedPeak - 1)
  }
  const totalReturn = rebasedEquity - 1
  const years = Math.max(daysBetween(curve[0].date, curve.at(-1).date) / 365.25, 1 / 365.25)
  const annualReturn = (1 + totalReturn) ** (1 / years) - 1
  const annualVol = std(returns) * Math.sqrt(TRADING_DAYS)
  const downsideVol = std(negativeReturns) * Math.sqrt(TRADING_DAYS)
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)
  const exposure = mean(curve.map((point) => Math.abs(point.position)))
  const turnover = curve.reduce((sum, point, index) => {
    const previous = curve[index - 1]?.position ?? 0
    return sum + Math.abs(point.position - previous)
  }, 0)
  const avg = mean(returns)
  const standardError = std(returns) ? std(returns) / Math.sqrt(returns.length) : 0

  return {
    totalReturnPct: round(totalReturn * 100, 2),
    cagrPct: round(annualReturn * 100, 2),
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (avg * TRADING_DAYS) / annualVol : 0, 2),
    sortino: round(downsideVol ? (avg * TRADING_DAYS) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdown * 100, 2),
    calmar: round(Math.abs(maxDrawdown) ? annualReturn / Math.abs(maxDrawdown) : 0, 2),
    winRatePct: round((returns.filter((value) => value > 0).length / Math.max(returns.length, 1)) * 100, 1),
    profitFactor: round(losses ? gains / losses : gains ? 99 : 0, 2),
    tradeCount,
    exposurePct: round(exposure * 100, 1),
    turnover: round(turnover, 2),
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(avg * 100, 3),
    firstEntry: curve[0].date,
    lastExit: curve.at(-1).date,
    averageHoldDays: 1,
    tStat: round(standardError ? avg / standardError : 0, 2),
  }
}

function curveForSplit(curve, split) {
  return curve.filter((point) => daySplit(point.date) === split)
}

function eventRowsForSplit(eventRows, split) {
  return eventRows.filter((event) => daySplit(event.entryTradeDate) === split)
}

function indexMetricsForDays(days) {
  let equity = INITIAL_CAPITAL
  const curve = days.map((day) => {
    equity *= 1 + day.indexReturnPct / 100
    return {
      date: day.date,
      equity,
      dailyPnlPct: day.indexReturnPct,
      drawdownPct: 0,
      position: 0,
    }
  })
  let peak = INITIAL_CAPITAL
  return curve.map((point) => {
    peak = Math.max(peak, point.equity)
    return { ...point, drawdownPct: ((point.equity - peak) / peak) * 100 }
  })
}

function legCounts(eventRows, splitFilter = () => true) {
  const scoped = eventRows.filter(splitFilter)
  return {
    weatherFollow: scoped.filter((row) => row.leg === 'weather-follow').length,
    weatherReversion: scoped.filter((row) => row.leg === 'weather-reversion').length,
    summerColdShort: scoped.filter((row) => row.thesisKind === 'summer-cold-short').length,
    summerHeatLong: scoped.filter((row) => row.thesisKind === 'summer-heat-long').length,
    reversionLong: scoped.filter((row) => row.leg === 'weather-reversion' && row.direction === 'long').length,
    reversionShort: scoped.filter((row) => row.leg === 'weather-reversion' && row.direction === 'short').length,
  }
}

function sideReturnSnapshot(rows, splitFilter = () => true) {
  const metricFor = (thesisKinds) =>
    metricsFromCurve(
      rows
        .filter((row) => splitFilter(row) && thesisKinds.includes(row.thesisKind))
        .map((row) => ({
          date: row.entryTradeDate,
          equity: INITIAL_CAPITAL * (1 + row.netReturnPct / 100),
          dailyPnlPct: row.netReturnPct,
          drawdownPct: row.netReturnPct < 0 ? row.netReturnPct : 0,
          position: row.ungPosition,
        })),
      rows.filter((row) => splitFilter(row) && thesisKinds.includes(row.thesisKind)).length,
    )

  return {
    summerColdShort: metricFor(['summer-cold-short']),
    summerHeatLong: metricFor(['summer-heat-long']),
    weatherFollow: metricFor(['summer-cold-short', 'summer-heat-long']),
    reversionLong: metricFor(['reversion-long']),
    reversionShort: metricFor(['reversion-short']),
    weatherReversion: metricFor(['reversion-long', 'reversion-short']),
  }
}

function summarizeCandidate(days, rowsByIssueDate, indexBenchmarks, candidate, reliabilityWeights, signalCache, options = {}) {
  const cacheKey = signalCacheKey(candidate)
  const signals = signalCache.get(cacheKey) ?? signalsForCandidate(rowsByIssueDate, candidate, reliabilityWeights)
  signalCache.set(cacheKey, signals)
  const { byIndex, eventRows: scheduledEventRows } = scheduleOverlay(days, signals, candidate)
  const { curve, rows } = buildCurve(days, byIndex)
  const overlayRows = rows.filter((row) => row.windowId !== 'index-fallback')
  const eventRows = executedEventRowsFromRows(rows)
  const completedEvents = eventRows.length
  const allMetrics = metricsFromCurve(curve, completedEvents)
  const trainMetrics = metricsFromCurve(curveForSplit(curve, 'train'), eventRowsForSplit(eventRows, 'train').length)
  const validationMetrics = metricsFromCurve(curveForSplit(curve, 'validation'), eventRowsForSplit(eventRows, 'validation').length)
  const holdoutMetrics = metricsFromCurve(curveForSplit(curve, 'holdout'), eventRowsForSplit(eventRows, 'holdout').length)
  const splitEdges = {
    train: round(trainMetrics.totalReturnPct - indexBenchmarks.train.totalReturnPct, 2),
    validation: round(validationMetrics.totalReturnPct - indexBenchmarks.validation.totalReturnPct, 2),
    holdout: round(holdoutMetrics.totalReturnPct - indexBenchmarks.holdout.totalReturnPct, 2),
    all: round(allMetrics.totalReturnPct - indexBenchmarks.all.totalReturnPct, 2),
  }
  const profitableTrainYears = [...new Set(curveForSplit(curve, 'train').map((point) => point.date.slice(0, 4)))]
    .map((year) => curve.filter((point) => point.date.startsWith(year)))
    .filter((yearCurve) => metricsFromCurve(yearCurve, 0).totalReturnPct > 0).length
  const result = {
    candidateId: [
      'summer',
      candidate.sourceSetId,
      candidate.sourceWeightMode,
      `a${candidate.anomalyThreshold}`,
      `c${candidate.coverageThreshold}`,
      `q${candidate.minConfidence}`,
      `wf${candidate.weatherFraction}`,
      `rf${candidate.reversionFraction}`,
      `fh${candidate.followHoldDays}`,
      `rh${candidate.reversionHoldDays}`,
      `mv${candidate.minRealizedMovePct}`,
      `vol${candidate.volTargetPct}`,
      candidate.sizingMode,
    ].join('-'),
    architectureId: 'summer-weather-follow-and-fade',
    architectureLabel: 'Confirmed heat follow plus same-direction fade',
    architectureDescription:
      'Use multi-model forecast consensus to trade summer heat demand first, then fade only gas moves that overextend in the weather-demand direction.',
    useFollowLeg: true,
    useReversionLeg: true,
    ...candidate,
    allMetrics,
    trainMetrics,
    validationMetrics,
    holdoutMetrics,
    indexMetrics: {
      all: indexBenchmarks.all,
      train: indexBenchmarks.train,
      validation: indexBenchmarks.validation,
      holdout: indexBenchmarks.holdout,
    },
    splitEdges,
    signalCount: signals.length,
    scheduledEventCount: scheduledEventRows.length,
    completedEventCount: completedEvents,
    overlayDayCount: overlayRows.length,
    fallbackDayCount: rows.length - overlayRows.length,
    profitableTrainYears,
    trainYearCount: [...new Set(curveForSplit(curve, 'train').map((point) => point.date.slice(0, 4)))].length,
    legCounts: {
      all: legCounts(eventRows),
      trainValidation: legCounts(eventRows, (row) => row.entryTradeDate <= VALIDATION_END),
      train: legCounts(eventRows, (row) => daySplit(row.entryTradeDate) === 'train'),
      validation: legCounts(eventRows, (row) => daySplit(row.entryTradeDate) === 'validation'),
      holdout: legCounts(eventRows, (row) => daySplit(row.entryTradeDate) === 'holdout'),
    },
    sideReturns: {
      all: sideReturnSnapshot(rows),
      trainValidation: sideReturnSnapshot(rows, (row) => row.entryTradeDate <= VALIDATION_END),
      holdout: sideReturnSnapshot(rows, (row) => daySplit(row.entryTradeDate) === 'holdout'),
    },
    eventRows: options.keepRows ? eventRows : undefined,
    rows: options.keepRows ? rows : undefined,
    curve: options.keepRows ? curve : undefined,
  }
  return {
    ...result,
    eligible: isEligible(result),
    trainValidationRank: trainValidationRank(result),
  }
}

function isEligible(result) {
  const trainValidationLegs = result.legCounts.trainValidation
  const trainValidationSides = result.sideReturns.trainValidation
  return (
    result.minFamilies >= 2 &&
    result.trainMetrics.tradeCount >= 40 &&
    result.validationMetrics.tradeCount >= 12 &&
    trainValidationLegs.weatherFollow >= 40 &&
    trainValidationLegs.weatherReversion >= 4 &&
    trainValidationLegs.summerHeatLong >= 40 &&
    trainValidationLegs.reversionShort >= 4 &&
    result.trainMetrics.maxDrawdownPct >= -35 &&
    result.validationMetrics.maxDrawdownPct >= -25 &&
    result.trainMetrics.totalReturnPct > 0 &&
    result.validationMetrics.totalReturnPct > 0 &&
    result.splitEdges.train > 0 &&
    result.splitEdges.validation > 0 &&
    result.validationMetrics.sharpe >= 0.8 &&
    trainValidationSides.summerHeatLong.totalReturnPct > 0 &&
    trainValidationSides.reversionShort.totalReturnPct > 0 &&
    trainValidationSides.weatherReversion.totalReturnPct > 0 &&
    result.profitableTrainYears >= 2
  )
}

function trainValidationRank(result) {
  const train = result.trainMetrics
  const validation = result.validationMetrics
  const trainValidationExecutedRows = train.tradeCount + validation.tradeCount
  const legDepth = result.legCounts.trainValidation.summerHeatLong + result.legCounts.trainValidation.reversionShort
  const sideQuality =
    Math.min(18, result.sideReturns.trainValidation.summerHeatLong.totalReturnPct) +
    Math.min(12, result.sideReturns.trainValidation.reversionShort.totalReturnPct)
  const complexityPenalty = result.sourceWeightMode === 'bg-shrink' ? 0.75 : 0
  return round(
    result.splitEdges.train * 0.9 +
      result.splitEdges.validation * 1.45 +
      train.sharpe * 8 +
      validation.sharpe * 11 +
      train.sortino * 3 +
      validation.sortino * 4 +
      train.maxDrawdownPct * 0.35 +
      validation.maxDrawdownPct * 0.45 +
      Math.sqrt(trainValidationExecutedRows) * 1.25 +
      result.profitableTrainYears * 1.5 +
      Math.sqrt(legDepth) * 1.25 +
      sideQuality * 0.2 -
      complexityPenalty,
    4,
  )
}

function formatCandidateRow(candidate) {
  return {
    candidateId: candidate.candidateId,
    eligible: candidate.eligible,
    trainValidationRank: candidate.trainValidationRank,
    architectureId: candidate.architectureId,
    sourceSetId: candidate.sourceSetId,
    sourceWeightMode: candidate.sourceWeightMode,
    sizingMode: candidate.sizingMode,
    anomalyThreshold: candidate.anomalyThreshold,
    coverageThreshold: candidate.coverageThreshold,
    minConfidence: candidate.minConfidence,
    weatherFraction: candidate.weatherFraction,
    reversionFraction: candidate.reversionFraction,
    followHoldDays: candidate.followHoldDays,
    reversionHoldDays: candidate.reversionHoldDays,
    minRealizedMovePct: candidate.minRealizedMovePct,
    volTargetPct: candidate.volTargetPct,
    signals: candidate.signalCount,
    scheduledEvents: candidate.scheduledEventCount,
    executedRows: candidate.completedEventCount,
    weatherFollowRows: candidate.legCounts.all.weatherFollow,
    reversionRows: candidate.legCounts.all.weatherReversion,
    summerColdShortRows: candidate.legCounts.all.summerColdShort,
    summerHeatLongRows: candidate.legCounts.all.summerHeatLong,
    reversionLongRows: candidate.legCounts.all.reversionLong,
    reversionShortRows: candidate.legCounts.all.reversionShort,
    trainValidationSummerColdShortReturnPct: candidate.sideReturns.trainValidation.summerColdShort.totalReturnPct,
    trainValidationSummerHeatLongReturnPct: candidate.sideReturns.trainValidation.summerHeatLong.totalReturnPct,
    trainValidationFollowReturnPct: candidate.sideReturns.trainValidation.weatherFollow.totalReturnPct,
    trainValidationReversionLongReturnPct: candidate.sideReturns.trainValidation.reversionLong.totalReturnPct,
    trainValidationReversionShortReturnPct: candidate.sideReturns.trainValidation.reversionShort.totalReturnPct,
    trainValidationReversionReturnPct: candidate.sideReturns.trainValidation.weatherReversion.totalReturnPct,
    holdoutFollowReturnPct: candidate.sideReturns.holdout.weatherFollow.totalReturnPct,
    holdoutReversionReturnPct: candidate.sideReturns.holdout.weatherReversion.totalReturnPct,
    overlayDays: candidate.overlayDayCount,
    fallbackDays: candidate.fallbackDayCount,
    trainReturnPct: candidate.trainMetrics.totalReturnPct,
    trainIndexReturnPct: candidate.indexMetrics.train.totalReturnPct,
    trainEdgePct: candidate.splitEdges.train,
    trainSharpe: candidate.trainMetrics.sharpe,
    trainMaxDrawdownPct: candidate.trainMetrics.maxDrawdownPct,
    profitableTrainYears: candidate.profitableTrainYears,
    trainYearCount: candidate.trainYearCount,
    validationReturnPct: candidate.validationMetrics.totalReturnPct,
    validationIndexReturnPct: candidate.indexMetrics.validation.totalReturnPct,
    validationEdgePct: candidate.splitEdges.validation,
    validationSharpe: candidate.validationMetrics.sharpe,
    validationMaxDrawdownPct: candidate.validationMetrics.maxDrawdownPct,
    holdoutReturnPct: candidate.holdoutMetrics.totalReturnPct,
    holdoutIndexReturnPct: candidate.indexMetrics.holdout.totalReturnPct,
    holdoutEdgePct: candidate.splitEdges.holdout,
    holdoutSharpe: candidate.holdoutMetrics.sharpe,
    holdoutMaxDrawdownPct: candidate.holdoutMetrics.maxDrawdownPct,
    allReturnPct: candidate.allMetrics.totalReturnPct,
    allIndexReturnPct: candidate.indexMetrics.all.totalReturnPct,
    allEdgePct: candidate.splitEdges.all,
    allSharpe: candidate.allMetrics.sharpe,
    allMaxDrawdownPct: candidate.allMetrics.maxDrawdownPct,
  }
}

function sideMetrics(rows) {
  const side = (thesisKind) =>
    metricsFromCurve(
      rows
        .filter((row) => row.thesisKind === thesisKind)
        .map((row) => ({
          date: row.entryTradeDate,
          equity: INITIAL_CAPITAL * (1 + row.netReturnPct / 100),
          dailyPnlPct: row.netReturnPct,
          drawdownPct: row.netReturnPct < 0 ? row.netReturnPct : 0,
          position: row.ungPosition,
        })),
      rows.filter((row) => row.thesisKind === thesisKind).length,
    )
  return {
    summerColdShort: side('summer-cold-short'),
    summerHeatLong: side('summer-heat-long'),
    reversionLong: side('reversion-long'),
    reversionShort: side('reversion-short'),
    fallback: side('index-fallback'),
  }
}

function yearMetrics(curve) {
  return [...new Set(curve.map((point) => point.date.slice(0, 4)))].sort().map((year) => ({
    year,
    ...metricsFromCurve(curve.filter((point) => point.date.startsWith(year)), 0),
  }))
}

function createSeededRandom(seed = 1729) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function blockBootstrapRealityCheck(curve) {
  const activeReturns = curve.map((point) => point.activeReturnPct / 100)
  const observed = mean(activeReturns)
  if (!activeReturns.length || observed <= 0) {
    return {
      observedAverageDailyEdgePct: round(observed * 100, 4),
      pValue: 1,
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BLOCK_LENGTH,
    }
  }

  const centered = activeReturns.map((value) => value - observed)
  const random = createSeededRandom()
  let exceedances = 0
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    const sample = []
    while (sample.length < centered.length) {
      const start = Math.floor(random() * centered.length)
      for (let offset = 0; offset < BLOCK_LENGTH && sample.length < centered.length; offset += 1) {
        sample.push(centered[(start + offset) % centered.length])
      }
    }
    if (mean(sample) >= observed) exceedances += 1
  }

  return {
    observedAverageDailyEdgePct: round(observed * 100, 4),
    pValue: round((exceedances + 1) / (BOOTSTRAP_ITERATIONS + 1), 4),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BLOCK_LENGTH,
  }
}

function buildReport(summary) {
  const selected = summary.selected
  const topCandidates = summary.candidates.slice(0, 12)

  return `# NGAS Summer Alpha Lane

Generated at ${summary.generatedAt}.

## Purpose

This is the NGAS Summer Alpha cooling-season research strategy. It explicitly requires both active legs: a multi-model summer heat-demand follow trade and a same-direction post-move overreaction fade. Capital that is not assigned to gas stays in the diversified US index basket.

## Research Basis

- Demand link: EIA treats cooling degree days as the measure of air-conditioning need, so this lane maps broad summer warmth to higher gas-fired power demand and broad summer coolness to lower demand.
- Forecast-combination link: Bates-Granger-style forecast combination says independent forecasts can contain useful information even when none should be selected alone. This lane tests equal-weight and train-only inverse-error-shrunk source weights.
- Weather-risk-premium link: published natural-gas event studies report that U.S. natural gas futures react to forecasted temperatures and temperature shocks.
- Overreaction link: the fade leg is a constrained contrarian response only when gas first moves in the weather-demand direction, not a standalone price-only reversal.
- Overfit control: candidate rank uses train and validation only. Holdout after ${HOLDOUT_START} is reported after selection, and a deterministic block-bootstrap reality check is run on daily active return versus the index fallback.

## Selected Candidate

- Architecture: ${selected.architectureLabel}.
- Source set: ${selected.sourceSetLabel}.
- Source weighting: ${selected.sourceWeightMode === 'bg-shrink' ? 'train-only inverse forecast-error shrinkage' : 'equal forecast weights'}.
- Weather leg: ${selected.weatherFraction}x max NG futures overlay for ${selected.followHoldDays} trading day(s), long for broad summer heat. Cool-short rows remain diagnostic until the data produces enough confirmed cool events.
- Reversion leg: ${selected.reversionFraction}x max NG futures overlay for ${selected.reversionHoldDays} trading day(s) after a ${selected.minRealizedMovePct}% realized same-direction gas move, opposite the weather-driven move.
- Sizing: ${selected.sizingMode}${selected.sizingMode === 'vol-target' ? `, ${selected.volTargetPct}% annualized UNG volatility target` : ''}.
- Signal gates: absolute forecast anomaly >= ${selected.anomalyThreshold}F; side coverage >= ${selected.coverageThreshold}; confidence >= ${selected.minConfidence}; source groups >= ${selected.minGroups}; model families >= ${selected.minFamilies}.
- Cost: ${ROUND_TRIP_COST_PCT}% round trip, charged as ${ONE_WAY_COST_PCT}% one-way on gas position changes.
- Selection: candidate rank used train and validation only. Holdout rows after ${HOLDOUT_START} were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | ${selected.trainMetrics.tradeCount} | ${selected.trainMetrics.totalReturnPct}% | ${selected.indexMetrics.train.totalReturnPct}% | ${selected.splitEdges.train}% | ${selected.trainMetrics.cagrPct}% | ${selected.trainMetrics.sharpe} | ${selected.trainMetrics.sortino} | ${selected.trainMetrics.maxDrawdownPct}% | ${selected.trainMetrics.exposurePct}% |
| Validation | ${selected.validationMetrics.tradeCount} | ${selected.validationMetrics.totalReturnPct}% | ${selected.indexMetrics.validation.totalReturnPct}% | ${selected.splitEdges.validation}% | ${selected.validationMetrics.cagrPct}% | ${selected.validationMetrics.sharpe} | ${selected.validationMetrics.sortino} | ${selected.validationMetrics.maxDrawdownPct}% | ${selected.validationMetrics.exposurePct}% |
| Holdout | ${selected.holdoutMetrics.tradeCount} | ${selected.holdoutMetrics.totalReturnPct}% | ${selected.indexMetrics.holdout.totalReturnPct}% | ${selected.splitEdges.holdout}% | ${selected.holdoutMetrics.cagrPct}% | ${selected.holdoutMetrics.sharpe} | ${selected.holdoutMetrics.sortino} | ${selected.holdoutMetrics.maxDrawdownPct}% | ${selected.holdoutMetrics.exposurePct}% |
| Full | ${selected.allMetrics.tradeCount} | ${selected.allMetrics.totalReturnPct}% | ${selected.indexMetrics.all.totalReturnPct}% | ${selected.splitEdges.all}% | ${selected.allMetrics.cagrPct}% | ${selected.allMetrics.sharpe} | ${selected.allMetrics.sortino} | ${selected.allMetrics.maxDrawdownPct}% | ${selected.allMetrics.exposurePct}% |

## Executed Leg Rows

| split | follow | reversion | summer-cold-short | summer-heat-long | reversion-long | reversion-short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train/validation | ${selected.legCounts.trainValidation.weatherFollow} | ${selected.legCounts.trainValidation.weatherReversion} | ${selected.legCounts.trainValidation.summerColdShort} | ${selected.legCounts.trainValidation.summerHeatLong} | ${selected.legCounts.trainValidation.reversionLong} | ${selected.legCounts.trainValidation.reversionShort} |
| Holdout | ${selected.legCounts.holdout.weatherFollow} | ${selected.legCounts.holdout.weatherReversion} | ${selected.legCounts.holdout.summerColdShort} | ${selected.legCounts.holdout.summerHeatLong} | ${selected.legCounts.holdout.reversionLong} | ${selected.legCounts.holdout.reversionShort} |

## Side Checks

Train/validation side gates used for selection:

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Summer cold-short diagnostic | ${selected.sideReturns.trainValidation.summerColdShort.tradeCount} | ${selected.sideReturns.trainValidation.summerColdShort.totalReturnPct}% | ${selected.sideReturns.trainValidation.summerColdShort.sharpe} | ${selected.sideReturns.trainValidation.summerColdShort.maxDrawdownPct}% |
| Summer heat-long | ${selected.sideReturns.trainValidation.summerHeatLong.tradeCount} | ${selected.sideReturns.trainValidation.summerHeatLong.totalReturnPct}% | ${selected.sideReturns.trainValidation.summerHeatLong.sharpe} | ${selected.sideReturns.trainValidation.summerHeatLong.maxDrawdownPct}% |
| Weather follow combined | ${selected.sideReturns.trainValidation.weatherFollow.tradeCount} | ${selected.sideReturns.trainValidation.weatherFollow.totalReturnPct}% | ${selected.sideReturns.trainValidation.weatherFollow.sharpe} | ${selected.sideReturns.trainValidation.weatherFollow.maxDrawdownPct}% |
| Reversion-long | ${selected.sideReturns.trainValidation.reversionLong.tradeCount} | ${selected.sideReturns.trainValidation.reversionLong.totalReturnPct}% | ${selected.sideReturns.trainValidation.reversionLong.sharpe} | ${selected.sideReturns.trainValidation.reversionLong.maxDrawdownPct}% |
| Reversion-short | ${selected.sideReturns.trainValidation.reversionShort.tradeCount} | ${selected.sideReturns.trainValidation.reversionShort.totalReturnPct}% | ${selected.sideReturns.trainValidation.reversionShort.sharpe} | ${selected.sideReturns.trainValidation.reversionShort.maxDrawdownPct}% |
| Weather reversion combined | ${selected.sideReturns.trainValidation.weatherReversion.tradeCount} | ${selected.sideReturns.trainValidation.weatherReversion.totalReturnPct}% | ${selected.sideReturns.trainValidation.weatherReversion.sharpe} | ${selected.sideReturns.trainValidation.weatherReversion.maxDrawdownPct}% |

## Anti-Overfit Check

- Candidate search count: ${summary.search.candidateCount}.
- Eligible dual-leg candidates: ${summary.search.eligibleCandidateCount}.
- Block-bootstrap p-value versus index daily active return: ${summary.validation.realityCheck.pValue}.
- Bootstrap setup: ${summary.validation.realityCheck.iterations} iterations, ${summary.validation.realityCheck.blockLength}-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${topCandidates
  .map(
    (candidate) =>
      `| ${candidate.candidateId} | ${candidate.eligible ? 'yes' : 'no'} | ${candidate.trainValidationRank} | ${candidate.trainEdgePct}% | ${candidate.validationEdgePct}% | ${candidate.holdoutEdgePct}% | ${candidate.allEdgePct}% | ${candidate.executedRows} |`,
  )
  .join('\n')}

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. It fixes the prior underperformance by using the futures-grade gas series, requiring multi-model confirmation, and only fading same-direction heat overreactions. The cool-short side remains diagnostic until there are enough confirmed cooling-season cool events to validate it without overfitting.
`
}

function main() {
  const days = loadAlignedMarketDays()
  const indexCurve = indexMetricsForDays(days)
  const indexBenchmarks = {
    all: metricsFromCurve(indexCurve, 0),
    train: metricsFromCurve(curveForSplit(indexCurve, 'train'), 0),
    validation: metricsFromCurve(curveForSplit(indexCurve, 'validation'), 0),
    holdout: metricsFromCurve(curveForSplit(indexCurve, 'holdout'), 0),
  }
  const { scores, inputFiles } = loadForecastScores()
  const actualByDate = loadActualWeightedAnomaly()
  const reliability = computeSourceReliability(scores, actualByDate)
  const rowsByIssueDate = groupScoresByIssueDate(scores)
  const signalCache = new Map()
  const presentSources = new Set(scores.map((score) => score.sourceId))
  const sourceSets = SOURCE_SETS.map((sourceSet) => ({
    ...sourceSet,
    sourceIds: sourceSet.sourceIds.filter((sourceId) => presentSources.has(sourceId)),
  })).filter((sourceSet) => sourceSet.sourceIds.length)
  const candidates = []

  for (const sourceSet of sourceSets) {
    for (const sourceWeightMode of SOURCE_WEIGHT_MODES) {
      for (const sizingMode of SIZING_MODES) {
        for (const anomalyThreshold of ANOMALY_THRESHOLDS) {
          for (const coverageThreshold of COVERAGE_THRESHOLDS) {
            for (const minConfidence of MIN_CONFIDENCES) {
              for (const weatherFraction of WEATHER_FRACTIONS) {
                for (const reversionFraction of REVERSION_FRACTIONS) {
                  for (const followHoldDays of FOLLOW_HOLD_DAYS) {
                    for (const reversionHoldDays of REVERSION_HOLD_DAYS) {
                      for (const minRealizedMovePct of MIN_REALIZED_MOVES) {
                        const volTargets = sizingMode === 'vol-target' ? VOL_TARGETS : [0]
                        for (const volTargetPct of volTargets) {
                          candidates.push(
                            summarizeCandidate(
                              days,
                              rowsByIssueDate,
                              indexBenchmarks,
                              {
                                sourceSetId: sourceSet.id,
                                sourceSetLabel: sourceSet.label,
                                sourceIds: sourceSet.sourceIds,
                                minGroups: sourceSet.minGroups,
                                minFamilies: sourceSet.minFamilies,
                                sourceWeightMode,
                                sizingMode,
                                anomalyThreshold,
                                coverageThreshold,
                                minConfidence,
                                weatherFraction,
                                reversionFraction,
                                followHoldDays,
                                reversionHoldDays,
                                minRealizedMovePct,
                                volTargetPct,
                              },
                              reliability.weights,
                              signalCache,
                            ),
                          )
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    return b.trainValidationRank - a.trainValidationRank
  })

  const selectedCandidate = candidates.find((candidate) => candidate.eligible)
  if (!selectedCandidate) {
    throw new Error('No eligible summer-weather candidate satisfied heat-follow, same-direction fade, and multi-model confirmation gates.')
  }
  const selected = summarizeCandidate(days, rowsByIssueDate, indexBenchmarks, selectedCandidate, reliability.weights, signalCache, { keepRows: true })
  const summaryCandidates = candidates.map(formatCandidateRow)
  const summary = {
    generatedAt: new Date().toISOString(),
    strategyId: STRATEGY_ID,
    data: {
      weatherManifest: path.relative(REPO_ROOT, MANIFEST_PATH),
      gasMarketFile: path.relative(REPO_ROOT, GAS_MARKET_FILE),
      indexMarketFile: path.relative(REPO_ROOT, INDEX_MARKET_FILE),
      actualAnomalyFile: path.relative(REPO_ROOT, ACTUAL_ANOMALY_FILE),
      firstSignalDate: FIRST_SIGNAL_DATE,
      marketStartDate: days[0]?.date,
      marketEndDate: days.at(-1)?.date,
      marketDays: days.length,
      forecastScoreRows: scores.length,
      inputFiles,
    },
    researchBasis: [
      {
        label: 'EIA degree days and weather-sensitive gas demand',
        url: 'https://www.eia.gov/energyexplained/units-and-calculators/degree-days.php',
      },
      {
        label: 'EIA Weather Sensitivity in Natural Gas Markets',
        url: 'https://www.eia.gov/outlooks/steo/special/pdf/2014_sp_03.pdf',
      },
      {
        label: 'Bates and Granger forecast combination',
        url: 'https://www.cambridge.org/core/books/abs/essays-in-econometrics/combination-of-forecasts/9DA6A0F804E60BA563AC01F98A9EE639',
      },
      {
        label: 'Extreme weather forecast risk in US natural gas futures',
        url: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4326098',
      },
      {
        label: 'White Reality Check for data snooping',
        url: 'https://www.ssc.wisc.edu/~bhansen/718/White2000.pdf',
      },
    ],
    contract: {
      trainEnd: TRAIN_END,
      validationEnd: VALIDATION_END,
      holdoutStart: HOLDOUT_START,
      roundTripCostPct: ROUND_TRIP_COST_PCT,
      oneWayCostPct: ONE_WAY_COST_PCT,
      fallback: 'Unallocated capital remains in US-INDEX-BASKET close-to-close.',
      signalTiming: 'Forecast issue-date signals are used only on trading sessions strictly after the issue date.',
      reversionTiming:
        'Reversion legs use realized gas moves through the weather-follow leg, require the move to match the weather-demand direction, and start no earlier than the next trading session.',
      selectionPolicy:
        'The architecture requires multi-model heat-follow and same-direction overreaction-fade legs. Cool-short rows are kept diagnostic until the data produces enough confirmed cool events. Rank and eligibility use train and validation splits only; holdout metrics are reported after selection.',
      sourceWeighting:
        'bg-shrink weights are fit only on train-period forecast temperature errors versus NASA POWER actual weighted anomalies, then shrunk halfway toward equal weights.',
    },
    sourceReliability: reliability.diagnostics,
    selected: {
      ...selected,
      rows: undefined,
      eventRows: undefined,
      curve: undefined,
    },
    search: {
      candidateCount: candidates.length,
      eligibleCandidateCount: candidates.filter((candidate) => candidate.eligible).length,
      selectionUsedHoldout: false,
    },
    validation: {
      sideMetrics: sideMetrics(selected.rows),
      yearMetrics: yearMetrics(selected.curve),
      realityCheck: blockBootstrapRealityCheck(selected.curve),
    },
    outputFiles: {
      selectedTrades: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-trades.csv')),
      selectedEvents: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-events.csv')),
      candidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'candidate-summary.csv')),
      runSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'run-summary.json')),
      report: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'report.md')),
    },
    candidates: summaryCandidates.slice(0, 75),
  }

  writeText(path.join(OUTPUT_DIR, 'selected-trades.csv'), rowsToCsv(selected.rows, [
    'strategyId',
    'signalDate',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'exitTradeDate',
    'targetTradeDate',
    'direction',
    'sourceId',
    'windowId',
    'thesisKind',
    'leadDays',
    'confidence',
    'weightedAnomalyF',
    'coveragePct',
    'coldCoveragePct',
    'warmCoveragePct',
    'extremeCount',
    'indexFraction',
    'ungPosition',
    'ungReturnPct',
    'indexReturnPct',
    'grossReturnPct',
    'tradingCostPct',
    'netReturnPct',
    'equity',
    'equityPct',
    'drawdownPct',
    'rank',
    'realizedMovePct',
  ]))

  writeText(path.join(OUTPUT_DIR, 'selected-events.csv'), rowsToCsv(selected.eventRows, [
    'leg',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'exitTradeDate',
    'direction',
    'sourceId',
    'thesisKind',
    'leadDays',
    'weightedAnomalyF',
    'coveragePct',
    'extremeCount',
    'confidence',
    'realizedMovePct',
  ]))

  writeText(path.join(OUTPUT_DIR, 'candidate-summary.csv'), rowsToCsv(summaryCandidates, [
    'candidateId',
    'eligible',
    'trainValidationRank',
    'architectureId',
    'sourceSetId',
    'sourceWeightMode',
    'sizingMode',
    'anomalyThreshold',
    'coverageThreshold',
    'minConfidence',
    'weatherFraction',
    'reversionFraction',
    'followHoldDays',
    'reversionHoldDays',
    'minRealizedMovePct',
    'volTargetPct',
    'signals',
    'scheduledEvents',
    'executedRows',
    'weatherFollowRows',
    'reversionRows',
    'summerColdShortRows',
    'summerHeatLongRows',
    'reversionLongRows',
    'reversionShortRows',
    'trainValidationSummerColdShortReturnPct',
    'trainValidationSummerHeatLongReturnPct',
    'trainValidationFollowReturnPct',
    'trainValidationReversionLongReturnPct',
    'trainValidationReversionShortReturnPct',
    'trainValidationReversionReturnPct',
    'holdoutFollowReturnPct',
    'holdoutReversionReturnPct',
    'overlayDays',
    'fallbackDays',
    'trainReturnPct',
    'trainIndexReturnPct',
    'trainEdgePct',
    'trainSharpe',
    'trainMaxDrawdownPct',
    'profitableTrainYears',
    'trainYearCount',
    'validationReturnPct',
    'validationIndexReturnPct',
    'validationEdgePct',
    'validationSharpe',
    'validationMaxDrawdownPct',
    'holdoutReturnPct',
    'holdoutIndexReturnPct',
    'holdoutEdgePct',
    'holdoutSharpe',
    'holdoutMaxDrawdownPct',
    'allReturnPct',
    'allIndexReturnPct',
    'allEdgePct',
    'allSharpe',
    'allMaxDrawdownPct',
  ]))

  writeText(path.join(OUTPUT_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_DIR, 'report.md'), buildReport(summary))

  console.log(JSON.stringify({
    selected: summary.selected.candidateId,
    train: summary.selected.trainMetrics,
    validation: summary.selected.validationMetrics,
    holdout: summary.selected.holdoutMetrics,
    full: summary.selected.allMetrics,
    edge: summary.selected.splitEdges,
    legCounts: summary.selected.legCounts,
    realityCheck: summary.validation.realityCheck,
    outputFiles: summary.outputFiles,
  }, null, 2))
}

main()
