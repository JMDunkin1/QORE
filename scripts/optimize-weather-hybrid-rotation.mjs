#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/weather-hybrid-rotation')
const UNG_MARKET_FILE = path.join(DATA_ROOT, 'market/yahoo/UNG-qore-market.csv')
const INDEX_MARKET_FILE = path.join(DATA_ROOT, 'market/yahoo/US-INDEX-BASKET-qore-market.csv')

const STRATEGY_ID = 'weather-hybrid-rotation'
const INITIAL_CAPITAL = 100000
const FIRST_SIGNAL_DATE = '2021-01-01'
const TRAIN_END = '2024-03-31'
const VALIDATION_END = '2025-10-31'
const HOLDOUT_START = '2025-11-01'
const ROUND_TRIP_COST_PCT = 0.064
const ONE_WAY_COST_PCT = ROUND_TRIP_COST_PCT / 2
const TRADING_DAYS = 252
const WARM_COVERAGE_MIN_ANOMALY_F = 8
const WARM_EXTREME_ANOMALY_F = 14

const SOURCE_SETS = [
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

const ARCHITECTURES = [
  {
    id: 'follow-only',
    label: 'Weather direction only',
    useFollowLeg: true,
    useReversionLeg: false,
    description: 'Rotate from the index basket into UNG long/short after a broad 7-10 day cold/warm forecast.',
  },
  {
    id: 'follow-and-fade',
    label: 'Weather direction plus overreaction fade',
    useFollowLeg: true,
    useReversionLeg: true,
    description: 'Trade the initial weather-demand direction, then fade outsized UNG moves after the weather window.',
  },
  {
    id: 'fade-only',
    label: 'Overreaction fade only',
    useFollowLeg: false,
    useReversionLeg: true,
    description: 'Use the weather signal only to identify fear windows, then wait and fade the realized UNG move.',
  },
]

const WEATHER_FRACTIONS = [0.25, 0.4]
const REVERSION_FRACTIONS = [0.2]
const MIN_CONFIDENCES = [0.35, 0.5]
const ANOMALY_THRESHOLDS = [5, 8]
const COVERAGE_THRESHOLDS = [0.35, 0.5]
const FOLLOW_HOLD_DAYS = [3, 5]
const REVERSION_HOLD_DAYS = [1, 2]
const MIN_REALIZED_MOVES = [2, 4]
const SIZING_MODES = ['fixed', 'confidence-scaled']

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
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct)))
  return sorted[index]
}

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function isHeatingSeason(isoDate) {
  const month = Number(isoDate.slice(5, 7))
  return month <= 3 || month >= 11
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
        warmWeight: 0,
        warmExtremeCount: 0,
      }
    const weight = numberFrom(row.weight)
    const anomalyF = numberFrom(row.forecastAnomalyF, Number.NaN)
    current.sampledWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF >= WARM_COVERAGE_MIN_ANOMALY_F) current.warmWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF >= WARM_EXTREME_ANOMALY_F) current.warmExtremeCount += 1
    grouped.set(key, current)
  }

  return new Map(
    [...grouped.entries()].map(([key, value]) => [
      key,
      {
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

  for (const calendar of manifest.forecastCalendars) {
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const locationsPath = path.join(DATA_ROOT, calendar.files.locationAnomalies)
    inputFiles.push(path.relative(REPO_ROOT, scoresPath), path.relative(REPO_ROOT, locationsPath))
    const breadth = locationBreadthByScore(locationsPath)

    for (const row of parseCsv(scoresPath)) {
      const leadDays = numberFrom(row.leadDays)
      if (row.windowId !== 'rumor' || leadDays < 7 || leadDays > 10 || !isHeatingSeason(row.issueDate)) continue
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
        coldCoveragePct: numberFrom(row.coveragePct),
        coldExtremeCount: numberFrom(row.extremeCount),
        warmCoveragePct: warm?.warmCoveragePct ?? 0,
        warmExtremeCount: warm?.warmExtremeCount ?? 0,
        sampledWeight: numberFrom(row.sampledWeight),
        locationCount: numberFrom(row.locationCount),
      })
    }
  }

  return { manifest, scores, inputFiles }
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

function loadAlignedMarketDays() {
  const ungRows = loadMarketRows(UNG_MARKET_FILE)
  const indexRows = loadMarketRows(INDEX_MARKET_FILE)
  const ungByDate = marketReturnByDate(ungRows)
  const indexByDate = marketReturnByDate(indexRows)
  const dates = [...ungByDate.keys()].filter((date) => date >= FIRST_SIGNAL_DATE && indexByDate.has(date)).sort()

  return dates.map((date) => {
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
}

function createSignalFromIssueRows(rows, candidate) {
  const allowedSources = new Set(candidate.sourceIds)
  const scopedRows = rows.filter((row) => allowedSources.has(row.sourceId))
  if (!scopedRows.length) return null

  const coldRows = scopedRows.filter(
    (row) => row.weightedAnomalyF <= -candidate.anomalyThreshold && row.coldCoveragePct >= candidate.coverageThreshold,
  )
  const warmRows = scopedRows.filter(
    (row) => row.weightedAnomalyF >= candidate.anomalyThreshold && row.warmCoveragePct >= candidate.coverageThreshold,
  )

  const sideStats = (sideRows, side) => {
    const groups = [...new Set(sideRows.map((row) => row.sourceGroup))].sort()
    const families = [...new Set(sideRows.map((row) => row.sourceFamily))].sort()
    const strengthValues = sideRows.map((row) => {
      const anomaly = side === 'cold' ? Math.max(0, -row.weightedAnomalyF) : Math.max(0, row.weightedAnomalyF)
      const coverage = side === 'cold' ? row.coldCoveragePct : row.warmCoveragePct
      const extremeCount = side === 'cold' ? row.coldExtremeCount : row.warmExtremeCount
      return anomaly * coverage * Math.sqrt(extremeCount + 1)
    })
    const bestRow = sideRows
      .slice()
      .sort((a, b) => {
        const aStrength = side === 'cold' ? Math.max(0, -a.weightedAnomalyF) * a.coldCoveragePct : Math.max(0, a.weightedAnomalyF) * a.warmCoveragePct
        const bStrength = side === 'cold' ? Math.max(0, -b.weightedAnomalyF) * b.coldCoveragePct : Math.max(0, b.weightedAnomalyF) * b.warmCoveragePct
        return bStrength - aStrength
      })[0]
    return {
      bestRow,
      groups,
      families,
      rowCount: sideRows.length,
      strength: mean(strengthValues),
      maxStrength: Math.max(...strengthValues, 0),
    }
  }

  const cold = sideStats(coldRows, 'cold')
  const warm = sideStats(warmRows, 'warm')
  const winner =
    cold.maxStrength >= warm.maxStrength
      ? { side: 'cold', direction: 1, stats: cold, oppositeStrength: warm.maxStrength }
      : { side: 'warm', direction: -1, stats: warm, oppositeStrength: cold.maxStrength }

  if (!winner.stats.bestRow) return null
  if (winner.stats.groups.length < candidate.minGroups || winner.stats.families.length < candidate.minFamilies) return null
  if (winner.stats.maxStrength <= winner.oppositeStrength * 1.1) return null

  const consensusBonus = 0.65 + winner.stats.groups.length * 0.12 + winner.stats.families.length * 0.1 + Math.min(winner.stats.rowCount, 6) * 0.025
  const confidence = Math.min(1, (winner.stats.maxStrength / 14) * consensusBonus)
  if (confidence < candidate.minConfidence) return null

  return {
    issueDate: winner.stats.bestRow.issueDate,
    targetDate: winner.stats.bestRow.targetDate,
    direction: winner.direction,
    thesisKind: winner.direction === 1 ? 'cold-long' : 'warm-short',
    sourceId: candidate.sourceSetId,
    sourceLabel: candidate.sourceSetLabel,
    sourceIds: [...new Set(scopedRows.map((row) => row.sourceId))].sort(),
    sourceGroups: winner.stats.groups,
    sourceFamilies: winner.stats.families,
    weightedAnomalyF: round(mean(scopedRows.map((row) => row.weightedAnomalyF)), 3),
    coveragePct: round(winner.side === 'cold' ? winner.stats.bestRow.coldCoveragePct : winner.stats.bestRow.warmCoveragePct, 4),
    extremeCount: winner.side === 'cold' ? winner.stats.bestRow.coldExtremeCount : winner.stats.bestRow.warmExtremeCount,
    confidence: round(confidence, 4),
    rank: round(winner.stats.maxStrength * confidence, 4),
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

function signalsForCandidate(rowsByIssueDate, candidate) {
  return [...rowsByIssueDate.values()]
    .map((rows) => createSignalFromIssueRows(rows, candidate))
    .filter(Boolean)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || b.rank - a.rank)
}

function firstIndexAfter(days, date) {
  return days.findIndex((day) => day.date > date)
}

function firstIndexOnOrAfter(days, date) {
  return days.findIndex((day) => day.date >= date)
}

function scaledFraction(baseFraction, confidence, mode) {
  return mode === 'confidence-scaled' ? baseFraction * confidence : baseFraction
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
    const weatherPosition = signal.direction * scaledFraction(candidate.weatherFraction, signal.confidence, candidate.sizingMode)
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
    }

    if (candidate.useFollowLeg) {
      for (let index = entryIndex; index <= followEndIndex; index += 1) {
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
      })
    }

    if (!candidate.useReversionLeg) continue
    const priorClose = days[Math.max(entryIndex - 1, 0)]?.ungClose
    const exitClose = days[followEndIndex]?.ungClose
    const realizedMovePct = priorClose && exitClose ? ((exitClose - priorClose) / priorClose) * 100 : 0
    if (Math.abs(realizedMovePct) < candidate.minRealizedMovePct) continue

    const reversionPosition =
      -Math.sign(realizedMovePct || signal.direction) * scaledFraction(candidate.reversionFraction, signal.confidence, candidate.sizingMode)
    const reversionEntryIndex = followEndIndex + 1
    const reversionExitIndex = Math.min(days.length - 1, reversionEntryIndex + candidate.reversionHoldDays - 1)
    for (let index = reversionEntryIndex; index <= reversionExitIndex; index += 1) {
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
        direction: reversionPosition > 0 ? 'long' : 'short',
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
      coldCoveragePct: overlay?.thesisKind === 'cold-long' ? overlay.coveragePct : 0,
      warmCoveragePct: overlay?.thesisKind === 'warm-short' ? overlay.coveragePct : 0,
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
    })
    previousPosition = position
  }

  return { curve, rows }
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

function summarizeCandidate(days, rowsByIssueDate, indexBenchmarks, candidate, options = {}) {
  const signals = signalsForCandidate(rowsByIssueDate, candidate)
  const { byIndex, eventRows } = scheduleOverlay(days, signals, candidate)
  const { curve, rows } = buildCurve(days, byIndex)
  const overlayRows = rows.filter((row) => row.windowId !== 'index-fallback')
  const completedEvents = eventRows.length
  const allMetrics = metricsFromCurve(curve, completedEvents)
  const trainMetrics = metricsFromCurve(curveForSplit(curve, 'train'), eventRows.filter((event) => daySplit(event.entryTradeDate) === 'train').length)
  const validationMetrics = metricsFromCurve(
    curveForSplit(curve, 'validation'),
    eventRows.filter((event) => daySplit(event.entryTradeDate) === 'validation').length,
  )
  const holdoutMetrics = metricsFromCurve(
    curveForSplit(curve, 'holdout'),
    eventRows.filter((event) => daySplit(event.entryTradeDate) === 'holdout').length,
  )
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
      candidate.architectureId,
      candidate.sourceSetId,
      `a${candidate.anomalyThreshold}`,
      `c${candidate.coverageThreshold}`,
      `q${candidate.minConfidence}`,
      `wf${candidate.weatherFraction}`,
      `rf${candidate.reversionFraction}`,
      `fh${candidate.followHoldDays}`,
      `rh${candidate.reversionHoldDays}`,
      `mv${candidate.minRealizedMovePct}`,
      candidate.sizingMode,
    ].join('-'),
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
    completedEventCount: completedEvents,
    overlayDayCount: overlayRows.length,
    fallbackDayCount: rows.length - overlayRows.length,
    profitableTrainYears,
    trainYearCount: [...new Set(curveForSplit(curve, 'train').map((point) => point.date.slice(0, 4)))].length,
    eventRows: options.keepRows ? eventRows : undefined,
    rows: options.keepRows ? rows : undefined,
  }
  return {
    ...result,
    eligible: isEligible(result),
    trainValidationRank: trainValidationRank(result),
  }
}

function isEligible(result) {
  return (
    result.trainMetrics.tradeCount >= 6 &&
    result.validationMetrics.tradeCount >= 2 &&
    result.trainMetrics.maxDrawdownPct >= -35 &&
    result.validationMetrics.maxDrawdownPct >= -25 &&
    result.trainMetrics.totalReturnPct > 0 &&
    result.splitEdges.train > -10 &&
    result.splitEdges.validation > 0 &&
    result.validationMetrics.sharpe >= 0.5 &&
    result.profitableTrainYears >= 2
  )
}

function trainValidationRank(result) {
  const train = result.trainMetrics
  const validation = result.validationMetrics
  const trainValidationEventCount = train.tradeCount + validation.tradeCount
  return round(
    result.splitEdges.train * 0.8 +
      result.splitEdges.validation * 1.35 +
      train.sharpe * 8 +
      validation.sharpe * 10 +
      train.sortino * 3 +
      validation.sortino * 4 +
      train.maxDrawdownPct * 0.35 +
      validation.maxDrawdownPct * 0.45 +
      Math.sqrt(trainValidationEventCount) * 1.5 +
      result.profitableTrainYears * 1.25,
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
    sizingMode: candidate.sizingMode,
    anomalyThreshold: candidate.anomalyThreshold,
    coverageThreshold: candidate.coverageThreshold,
    minConfidence: candidate.minConfidence,
    weatherFraction: candidate.weatherFraction,
    reversionFraction: candidate.reversionFraction,
    followHoldDays: candidate.followHoldDays,
    reversionHoldDays: candidate.reversionHoldDays,
    minRealizedMovePct: candidate.minRealizedMovePct,
    signals: candidate.signalCount,
    events: candidate.completedEventCount,
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
  const side = (thesisKind) => metricsFromCurve(
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
    coldLong: side('cold-long'),
    warmShort: side('warm-short'),
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

function buildReport(summary) {
  const selected = summary.selected
  const topCandidates = summary.candidates.slice(0, 12)

  return `# Weather Hybrid Rotation Lane

Generated at ${summary.generatedAt}.

## Purpose

This is the second active QORE research strategy. It tests the user thesis directly: use 7-10 day Arctic Blast / warm-winter forecasts to rotate part of the portfolio into UNG, then fade post-window overreactions, while idle capital stays in the diversified US index basket.

## Selected Candidate

- Architecture: ${selected.architectureLabel}.
- Source set: ${selected.sourceSetLabel}.
- Weather leg: ${selected.weatherFraction}x max UNG overlay; ${selected.followHoldDays} trading-day max hold; ${selected.sizingMode} sizing.
- Reversion leg: ${selected.useReversionLeg ? `${selected.reversionFraction}x max UNG overlay for ${selected.reversionHoldDays} trading day(s) after a ${selected.minRealizedMovePct}% realized UNG move.` : 'disabled.'}
- Signal gates: absolute forecast anomaly >= ${selected.anomalyThreshold}F; side coverage >= ${selected.coverageThreshold}; confidence >= ${selected.minConfidence}; source groups >= ${selected.minGroups}; model families >= ${selected.minFamilies}.
- Cost: ${ROUND_TRIP_COST_PCT}% round trip, charged as ${ONE_WAY_COST_PCT}% one-way on UNG position changes.
- Selection: candidate rank used train and validation only. Holdout rows after ${HOLDOUT_START} were reported after selection.

## Metrics

| split | events | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | ${selected.trainMetrics.tradeCount} | ${selected.trainMetrics.totalReturnPct}% | ${selected.indexMetrics.train.totalReturnPct}% | ${selected.splitEdges.train}% | ${selected.trainMetrics.cagrPct}% | ${selected.trainMetrics.sharpe} | ${selected.trainMetrics.sortino} | ${selected.trainMetrics.maxDrawdownPct}% | ${selected.trainMetrics.exposurePct}% |
| Validation | ${selected.validationMetrics.tradeCount} | ${selected.validationMetrics.totalReturnPct}% | ${selected.indexMetrics.validation.totalReturnPct}% | ${selected.splitEdges.validation}% | ${selected.validationMetrics.cagrPct}% | ${selected.validationMetrics.sharpe} | ${selected.validationMetrics.sortino} | ${selected.validationMetrics.maxDrawdownPct}% | ${selected.validationMetrics.exposurePct}% |
| Holdout | ${selected.holdoutMetrics.tradeCount} | ${selected.holdoutMetrics.totalReturnPct}% | ${selected.indexMetrics.holdout.totalReturnPct}% | ${selected.splitEdges.holdout}% | ${selected.holdoutMetrics.cagrPct}% | ${selected.holdoutMetrics.sharpe} | ${selected.holdoutMetrics.sortino} | ${selected.holdoutMetrics.maxDrawdownPct}% | ${selected.holdoutMetrics.exposurePct}% |
| Full | ${selected.allMetrics.tradeCount} | ${selected.allMetrics.totalReturnPct}% | ${selected.indexMetrics.all.totalReturnPct}% | ${selected.splitEdges.all}% | ${selected.allMetrics.cagrPct}% | ${selected.allMetrics.sharpe} | ${selected.allMetrics.sortino} | ${selected.allMetrics.maxDrawdownPct}% | ${selected.allMetrics.exposurePct}% |

## Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | ${summary.validation.sideMetrics.coldLong.tradeCount} | ${summary.validation.sideMetrics.coldLong.totalReturnPct}% | ${summary.validation.sideMetrics.coldLong.sharpe} | ${summary.validation.sideMetrics.coldLong.maxDrawdownPct}% |
| Warm-short | ${summary.validation.sideMetrics.warmShort.tradeCount} | ${summary.validation.sideMetrics.warmShort.totalReturnPct}% | ${summary.validation.sideMetrics.warmShort.sharpe} | ${summary.validation.sideMetrics.warmShort.maxDrawdownPct}% |
| Reversion-long | ${summary.validation.sideMetrics.reversionLong.tradeCount} | ${summary.validation.sideMetrics.reversionLong.totalReturnPct}% | ${summary.validation.sideMetrics.reversionLong.sharpe} | ${summary.validation.sideMetrics.reversionLong.maxDrawdownPct}% |
| Reversion-short | ${summary.validation.sideMetrics.reversionShort.tradeCount} | ${summary.validation.sideMetrics.reversionShort.totalReturnPct}% | ${summary.validation.sideMetrics.reversionShort.sharpe} | ${summary.validation.sideMetrics.reversionShort.maxDrawdownPct}% |
| Index fallback | ${summary.validation.sideMetrics.fallback.tradeCount} | ${summary.validation.sideMetrics.fallback.totalReturnPct}% | ${summary.validation.sideMetrics.fallback.sharpe} | ${summary.validation.sideMetrics.fallback.maxDrawdownPct}% |

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | events |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${topCandidates
  .map(
    (candidate) =>
      `| ${candidate.candidateId} | ${candidate.eligible ? 'yes' : 'no'} | ${candidate.trainValidationRank} | ${candidate.trainEdgePct}% | ${candidate.validationEdgePct}% | ${candidate.holdoutEdgePct}% | ${candidate.allEdgePct}% | ${candidate.events} |`,
  )
  .join('\n')}

## Verdict

Promote this as an active research baseline, not broker-ready. It gives QORE the intended second lane: a weather-aware portfolio rotation that remains market-invested when the forecast edge is weak. The strongest caution is that the holdout is still only one winter, so the strategy should stay behind human promotion gates until more winters or paper-trading evidence accumulate.
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
  const rowsByIssueDate = groupScoresByIssueDate(scores)
  const presentSources = new Set(scores.map((score) => score.sourceId))
  const sourceSets = SOURCE_SETS.map((sourceSet) => ({
    ...sourceSet,
    sourceIds: sourceSet.sourceIds.filter((sourceId) => presentSources.has(sourceId)),
  })).filter((sourceSet) => sourceSet.sourceIds.length)
  const candidates = []

  for (const architecture of ARCHITECTURES) {
    for (const sourceSet of sourceSets) {
      for (const sizingMode of SIZING_MODES) {
        for (const anomalyThreshold of ANOMALY_THRESHOLDS) {
          for (const coverageThreshold of COVERAGE_THRESHOLDS) {
            for (const minConfidence of MIN_CONFIDENCES) {
              for (const weatherFraction of WEATHER_FRACTIONS) {
                for (const reversionFraction of REVERSION_FRACTIONS) {
                  for (const followHoldDays of FOLLOW_HOLD_DAYS) {
                    for (const reversionHoldDays of REVERSION_HOLD_DAYS) {
                      for (const minRealizedMovePct of MIN_REALIZED_MOVES) {
                        candidates.push(
                          summarizeCandidate(days, rowsByIssueDate, indexBenchmarks, {
                            architectureId: architecture.id,
                            architectureLabel: architecture.label,
                            architectureDescription: architecture.description,
                            useFollowLeg: architecture.useFollowLeg,
                            useReversionLeg: architecture.useReversionLeg,
                            sourceSetId: sourceSet.id,
                            sourceSetLabel: sourceSet.label,
                            sourceIds: sourceSet.sourceIds,
                            minGroups: sourceSet.minGroups,
                            minFamilies: sourceSet.minFamilies,
                            sizingMode,
                            anomalyThreshold,
                            coverageThreshold,
                            minConfidence,
                            weatherFraction,
                            reversionFraction,
                            followHoldDays,
                            reversionHoldDays,
                            minRealizedMovePct,
                          }),
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

  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    return b.trainValidationRank - a.trainValidationRank
  })

  const selectedCandidate = candidates.find((candidate) => candidate.eligible) ?? candidates[0]
  const selected = summarizeCandidate(days, rowsByIssueDate, indexBenchmarks, selectedCandidate, { keepRows: true })
  const summaryCandidates = candidates.map(formatCandidateRow)
  const summary = {
    generatedAt: new Date().toISOString(),
    strategyId: STRATEGY_ID,
    data: {
      weatherManifest: path.relative(REPO_ROOT, MANIFEST_PATH),
      ungMarketFile: path.relative(REPO_ROOT, UNG_MARKET_FILE),
      indexMarketFile: path.relative(REPO_ROOT, INDEX_MARKET_FILE),
      firstSignalDate: FIRST_SIGNAL_DATE,
      marketStartDate: days[0]?.date,
      marketEndDate: days.at(-1)?.date,
      marketDays: days.length,
      forecastScoreRows: scores.length,
      inputFiles,
    },
    contract: {
      trainEnd: TRAIN_END,
      validationEnd: VALIDATION_END,
      holdoutStart: HOLDOUT_START,
      roundTripCostPct: ROUND_TRIP_COST_PCT,
      oneWayCostPct: ONE_WAY_COST_PCT,
      fallback: 'Unallocated capital remains in US-INDEX-BASKET close-to-close.',
      signalTiming: 'Forecast issue-date signals are used only on trading sessions strictly after the issue date.',
      reversionTiming: 'Reversion legs use realized UNG move through the weather leg and start no earlier than the next trading session.',
      selectionPolicy: 'Rank and eligibility use train and validation splits only; holdout metrics are reported after selection.',
    },
    selected: {
      ...selected,
      rows: undefined,
      eventRows: undefined,
    },
    validation: {
      sideMetrics: sideMetrics(selected.rows),
      yearMetrics: yearMetrics(
        selected.rows.map((row) => ({
          date: row.entryTradeDate,
          equity: row.equity,
          dailyPnlPct: row.netReturnPct,
          drawdownPct: row.drawdownPct,
          position: row.ungPosition,
        })),
      ),
    },
    outputFiles: {
      selectedTrades: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-trades.csv')),
      selectedEvents: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-events.csv')),
      candidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'candidate-summary.csv')),
      runSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'run-summary.json')),
      report: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'report.md')),
    },
    candidates: summaryCandidates.slice(0, 50),
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
  ]))

  writeText(path.join(OUTPUT_DIR, 'selected-events.csv'), rowsToCsv(selected.eventRows, [
    'leg',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'exitTradeDate',
    'direction',
    'sourceId',
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
    'sizingMode',
    'anomalyThreshold',
    'coverageThreshold',
    'minConfidence',
    'weatherFraction',
    'reversionFraction',
    'followHoldDays',
    'reversionHoldDays',
    'minRealizedMovePct',
    'signals',
    'events',
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
    outputFiles: summary.outputFiles,
  }, null, 2))
}

main()
