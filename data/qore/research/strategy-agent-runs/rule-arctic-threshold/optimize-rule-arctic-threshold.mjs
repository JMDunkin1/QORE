import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/rule-arctic-threshold')
const BASELINE_TRADES_PATH = path.join(DATA_ROOT, 'research/strategy-tests/strict-theory-rule-arctic-threshold-trades.csv')

const ROUND_TRIP_COST_PCT = 0.064
const TRAIN_CUTOFF = '2025-11-01'
const BASELINE_PARAMS = {
  coldMaxWeightedAnomalyF: -8,
  coldMinCoveragePct: 0.55,
  coldMinExtremeCount: 0,
  warmMinWeightedAnomalyF: 8,
  warmMinCoveragePct: 0.6,
  warmMinExtremeCount: 0,
  minSourceGroups: 2,
  minModelFamilies: 2,
  leadMin: 7,
  leadMax: 10,
}

const GRID = {
  coldMaxWeightedAnomalyF: [-8, -10, -12, -14, -16, -18],
  coldMinCoveragePct: [0.55, 0.7, 0.85, 1],
  coldMinExtremeCount: [0, 4, 8, 12],
  warmMinWeightedAnomalyF: [8, 10, 12, 14, 16, 18],
  warmMinCoveragePct: [0.6, 0.7, 0.84, 0.9, 1],
  warmMinExtremeCount: [0, 4, 8, 12, 16],
}

const SIDE_MODES = ['combined', 'cold-long', 'warm-short']

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
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

function boolFrom(value) {
  return String(value).toLowerCase() === 'true'
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
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function monthFromIsoDate(isoDate) {
  return Number(isoDate.slice(5, 7))
}

function isHeatingSeasonIssue(isoDate) {
  const month = monthFromIsoDate(isoDate)
  return month <= 3 || month >= 11
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

function expectedWindowIdForLead(leadDays) {
  if (leadDays >= 7 && leadDays <= 10) return 'rumor'
  if (leadDays >= 1 && leadDays <= 3) return 'selloff'
  return 'other'
}

function scoreKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId, row.modelId].join('|')
}

function consensusKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId].join('|')
}

function thesisKey(row, thesisKind) {
  return `${consensusKey(row)}|${thesisKind}`
}

function isTradable(row) {
  if (row.symbol !== 'UNG') return false
  if (row.windowId !== expectedWindowIdForLead(row.leadDays)) return false
  if (!row.issueDate || !row.targetDate || !row.entryTradeDate || !row.targetTradeDate) return false
  if (row.entryTradeDate <= row.issueDate) return false
  if (row.targetTradeDate < row.targetDate) return false
  if (row.targetTradeDate <= row.entryTradeDate) return false
  return Number.isFinite(row.returnPct)
}

function signalStrength(row) {
  if (row.thesisKind === 'warm-short') return Math.max(0, row.weightedAnomalyF)
  return Math.max(0, -row.weightedAnomalyF)
}

function rankRow(row) {
  return signalStrength(row) * (0.5 + row.coveragePct) + row.extremeCount * 0.2
}

function directionForThesis(thesisKind) {
  if (thesisKind === 'cold-long') return 1
  if (thesisKind === 'warm-short') return -1
  return 0
}

function thesisForScore(score, params) {
  if (!isHeatingSeasonIssue(score.issueDate)) return null
  if (score.windowId !== 'rumor') return null
  if (score.leadDays < params.leadMin || score.leadDays > params.leadMax) return null

  if (
    score.weightedAnomalyF <= params.coldMaxWeightedAnomalyF &&
    score.coldCoveragePct >= params.coldMinCoveragePct &&
    score.coldExtremeCount >= params.coldMinExtremeCount
  ) {
    return {
      thesisKind: 'cold-long',
      direction: 1,
      coveragePct: score.coldCoveragePct,
      extremeCount: score.coldExtremeCount,
    }
  }

  if (
    score.weightedAnomalyF >= params.warmMinWeightedAnomalyF &&
    score.warmCoveragePct >= params.warmMinCoveragePct &&
    score.warmExtremeCount >= params.warmMinExtremeCount
  ) {
    return {
      thesisKind: 'warm-short',
      direction: -1,
      coveragePct: score.warmCoveragePct,
      extremeCount: score.warmExtremeCount,
    }
  }

  return null
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
    if (Number.isFinite(anomalyF) && anomalyF >= 8) current.warmWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF >= 14) current.warmExtremeCount += 1
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

function loadRows() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const scores = []
  const returnRows = []
  const inputFiles = []

  for (const calendar of manifest.forecastCalendars) {
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const returnsPath = path.join(DATA_ROOT, calendar.files.signalReturns)
    const locationsPath = path.join(DATA_ROOT, calendar.files.locationAnomalies)
    inputFiles.push(path.relative(REPO_ROOT, scoresPath), path.relative(REPO_ROOT, returnsPath), path.relative(REPO_ROOT, locationsPath))

    const breadthByScore = locationBreadthByScore(locationsPath)
    const scoresByKey = new Map()

    for (const score of parseCsv(scoresPath)) {
      const breadth = breadthByScore.get(scoreKey(score))
      const parsedScore = {
        sourceId: calendar.id,
        sourceLabel: calendar.label,
        sourceFamily: sourceFamilyFor(calendar.id),
        sourceGroup: sourceGroupFor(calendar.id),
        issueDate: score.issueDate,
        targetDate: score.targetDate,
        leadDays: numberFrom(score.leadDays),
        windowId: score.windowId,
        modelId: score.modelId,
        weightedAnomalyF: numberFrom(score.weightedAnomalyF),
        coldCoveragePct: numberFrom(score.coveragePct),
        coldExtremeCount: numberFrom(score.extremeCount),
        warmCoveragePct: breadth?.warmCoveragePct ?? 0,
        warmExtremeCount: breadth?.warmExtremeCount ?? 0,
        sampledWeight: numberFrom(score.sampledWeight),
        locationCount: numberFrom(score.locationCount),
        qualifies: boolFrom(score.qualifies),
      }
      scores.push(parsedScore)
      scoresByKey.set(scoreKey(score), parsedScore)
    }

    for (const ret of parseCsv(returnsPath)) {
      const score = scoresByKey.get(scoreKey(ret))
      if (!score) continue
      const joined = {
        ...score,
        symbol: ret.symbol,
        priorTradeDate: ret.priorTradeDate,
        entryTradeDate: ret.entryTradeDate,
        targetTradeDate: ret.targetTradeDate,
        returnPct: numberFrom(ret.returnPctEntryCloseToTarget, Number.NaN),
        priorReturnPct: numberFrom(ret.returnPctPriorCloseToTarget, Number.NaN),
      }
      if (isTradable(joined)) returnRows.push(joined)
    }
  }

  return { manifest, scores, returnRows, inputFiles }
}

function confirmationMap(scores, params) {
  const grouped = new Map()
  for (const score of scores) {
    const thesis = thesisForScore(score, params)
    if (!thesis) continue
    const key = thesisKey(score, thesis.thesisKind)
    const current =
      grouped.get(key) ?? {
        sourceGroups: new Set(),
        sourceFamilies: new Set(),
        sourceIds: new Set(),
      }
    current.sourceGroups.add(score.sourceGroup)
    current.sourceFamilies.add(score.sourceFamily)
    current.sourceIds.add(score.sourceId)
    grouped.set(key, current)
  }

  const confirmed = new Map()
  for (const [key, value] of grouped) {
    if (value.sourceGroups.size >= params.minSourceGroups && value.sourceFamilies.size >= params.minModelFamilies) {
      confirmed.set(key, {
        sourceGroups: [...value.sourceGroups].sort(),
        sourceFamilies: [...value.sourceFamilies].sort(),
        sourceIds: [...value.sourceIds].sort(),
      })
    }
  }
  return confirmed
}

function candidatesForParams(scores, returnRows, params, sideMode) {
  const confirmed = confirmationMap(scores, params)
  return returnRows
    .map((row) => {
      const thesis = thesisForScore(row, params)
      if (!thesis) return null
      if (sideMode !== 'combined' && thesis.thesisKind !== sideMode) return null
      const confirmation = confirmed.get(thesisKey(row, thesis.thesisKind))
      if (!confirmation) return null
      const enriched = {
        ...row,
        thesisKind: thesis.thesisKind,
        thesisDirection: thesis.direction,
        coveragePct: thesis.coveragePct,
        extremeCount: thesis.extremeCount,
        confirmedSourceGroups: confirmation.sourceGroups,
        confirmedSourceFamilies: confirmation.sourceFamilies,
        confirmedSourceIds: confirmation.sourceIds,
      }
      return {
        row: enriched,
        direction: thesis.direction,
        rank: rankRow(enriched),
      }
    })
    .filter(Boolean)
}

function resolveTrades(candidates) {
  const bestByEntry = new Map()
  const sortedByRank = [...candidates].sort((a, b) => b.rank - a.rank)

  for (const candidate of sortedByRank) {
    const key = candidate.row.entryTradeDate
    if (!bestByEntry.has(key)) bestByEntry.set(key, candidate)
  }

  const ordered = [...bestByEntry.values()].sort((a, b) => {
    if (a.row.entryTradeDate !== b.row.entryTradeDate) return a.row.entryTradeDate.localeCompare(b.row.entryTradeDate)
    return b.rank - a.rank
  })

  const trades = []
  let lastTargetTradeDate = ''
  for (const candidate of ordered) {
    if (candidate.row.entryTradeDate <= lastTargetTradeDate) continue
    const grossReturnPct = candidate.direction * candidate.row.returnPct
    const netReturnPct = grossReturnPct - ROUND_TRIP_COST_PCT
    trades.push({ ...candidate, grossReturnPct, netReturnPct })
    lastTargetTradeDate = candidate.row.targetTradeDate
  }
  return trades
}

function tradeMetrics(trades) {
  if (!trades.length) {
    return {
      totalReturnPct: 0,
      cagrPct: 0,
      sharpe: 0,
      sortino: 0,
      maxDrawdownPct: 0,
      winRatePct: 0,
      profitFactor: 0,
      tradeCount: 0,
      averageTradeReturnPct: 0,
      averageHoldDays: 0,
      firstEntry: null,
      lastExit: null,
    }
  }

  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  const tradeReturns = []
  const holdDays = []
  for (const trade of trades) {
    equity *= 1 + trade.netReturnPct / 100
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1)
    tradeReturns.push(trade.netReturnPct / 100)
    holdDays.push(daysBetween(trade.row.entryTradeDate, trade.row.targetTradeDate))
  }

  const firstEntry = trades[0].row.entryTradeDate
  const lastExit = trades.at(-1).row.targetTradeDate
  const years = Math.max(daysBetween(firstEntry, lastExit) / 365.25, 1 / 365.25)
  const totalReturn = equity - 1
  const annualReturn = (1 + totalReturn) ** (1 / years) - 1
  const tradesPerYear = trades.length / years
  const tradeStd = std(tradeReturns)
  const downsideStd = std(tradeReturns.filter((value) => value < 0))
  const gains = tradeReturns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const losses = Math.abs(tradeReturns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))

  return {
    totalReturnPct: round(totalReturn * 100, 2),
    cagrPct: round(annualReturn * 100, 2),
    sharpe: round(tradeStd ? (mean(tradeReturns) / tradeStd) * Math.sqrt(tradesPerYear) : 0, 2),
    sortino: round(downsideStd ? (mean(tradeReturns) / downsideStd) * Math.sqrt(tradesPerYear) : 0, 2),
    maxDrawdownPct: round(maxDrawdown * 100, 2),
    winRatePct: round((tradeReturns.filter((value) => value > 0).length / trades.length) * 100, 1),
    profitFactor: round(losses ? gains / losses : gains ? 99 : 0, 2),
    tradeCount: trades.length,
    averageTradeReturnPct: round(mean(tradeReturns) * 100, 2),
    averageHoldDays: round(mean(holdDays), 1),
    firstEntry,
    lastExit,
  }
}

function splitTradesByIssue(trades, predicate) {
  return trades.filter((trade) => predicate(trade.row.issueDate))
}

function seasonForIssueDate(issueDate) {
  const year = Number(issueDate.slice(0, 4))
  const month = monthFromIsoDate(issueDate)
  if (month >= 11) return `${year}-${year + 1}`
  return `${year - 1}-${year}`
}

function seasonalMetrics(trades) {
  const seasons = [...new Set(trades.map((trade) => seasonForIssueDate(trade.row.issueDate)))].sort()
  return seasons.map((season) => ({
    season,
    metrics: tradeMetrics(trades.filter((trade) => seasonForIssueDate(trade.row.issueDate) === season)),
  }))
}

function sideMetrics(trades) {
  return {
    combined: tradeMetrics(trades),
    coldLong: tradeMetrics(trades.filter((trade) => trade.row.thesisKind === 'cold-long')),
    warmShort: tradeMetrics(trades.filter((trade) => trade.row.thesisKind === 'warm-short')),
  }
}

function minTrainTradesForSide(sideMode) {
  if (sideMode === 'cold-long') return 3
  return 8
}

function trainScore(result) {
  const metrics = result.train.metrics
  if (metrics.tradeCount < minTrainTradesForSide(result.sideMode)) return -100000
  return metrics.totalReturnPct + metrics.sharpe * 2 + metrics.maxDrawdownPct * 0.35 + metrics.profitFactor
}

function robustnessPass(result) {
  if (result.sideMode !== 'combined') return false
  if (result.train.metrics.tradeCount < 8) return false
  if (result.test.metrics.tradeCount < 5) return false
  if (result.full.metrics.tradeCount < 10) return false
  if (result.test.metrics.totalReturnPct <= 0) return false
  if (result.test.metrics.maxDrawdownPct < -18) return false
  if (result.sides.full.coldLong.tradeCount < 3) return false
  if (result.sides.full.warmShort.tradeCount < 6) return false
  return true
}

function evaluateParams(scores, returnRows, params, sideMode) {
  const allCandidates = candidatesForParams(scores, returnRows, params, sideMode)
  const fullTrades = resolveTrades(allCandidates)
  const trainTrades = resolveTrades(allCandidates.filter((candidate) => candidate.row.issueDate < TRAIN_CUTOFF))
  const testTrades = resolveTrades(allCandidates.filter((candidate) => candidate.row.issueDate >= TRAIN_CUTOFF))
  const full = { metrics: tradeMetrics(fullTrades), trades: fullTrades }
  const train = { metrics: tradeMetrics(trainTrades), trades: trainTrades }
  const test = { metrics: tradeMetrics(testTrades), trades: testTrades }
  return {
    id: strategyId(params, sideMode),
    sideMode,
    params,
    full,
    train,
    test,
    sides: {
      full: sideMetrics(fullTrades),
      train: sideMetrics(trainTrades),
      test: sideMetrics(testTrades),
    },
    seasons: seasonalMetrics(fullTrades),
  }
}

function strategyId(params, sideMode) {
  return [
    sideMode,
    `coldA${params.coldMaxWeightedAnomalyF}`,
    `coldC${params.coldMinCoveragePct}`,
    `coldE${params.coldMinExtremeCount}`,
    `warmA${params.warmMinWeightedAnomalyF}`,
    `warmC${params.warmMinCoveragePct}`,
    `warmE${params.warmMinExtremeCount}`,
  ]
    .join('-')
    .replaceAll('.', 'p')
}

function* paramGridForSide(sideMode) {
  const coldAnomalyGrid = sideMode === 'warm-short' ? [BASELINE_PARAMS.coldMaxWeightedAnomalyF] : GRID.coldMaxWeightedAnomalyF
  const coldCoverageGrid = sideMode === 'warm-short' ? [BASELINE_PARAMS.coldMinCoveragePct] : GRID.coldMinCoveragePct
  const coldExtremeGrid = sideMode === 'warm-short' ? [BASELINE_PARAMS.coldMinExtremeCount] : GRID.coldMinExtremeCount
  const warmAnomalyGrid = sideMode === 'cold-long' ? [BASELINE_PARAMS.warmMinWeightedAnomalyF] : GRID.warmMinWeightedAnomalyF
  const warmCoverageGrid = sideMode === 'cold-long' ? [BASELINE_PARAMS.warmMinCoveragePct] : GRID.warmMinCoveragePct
  const warmExtremeGrid = sideMode === 'cold-long' ? [BASELINE_PARAMS.warmMinExtremeCount] : GRID.warmMinExtremeCount

  for (const coldMaxWeightedAnomalyF of coldAnomalyGrid) {
    for (const coldMinCoveragePct of coldCoverageGrid) {
      for (const coldMinExtremeCount of coldExtremeGrid) {
        for (const warmMinWeightedAnomalyF of warmAnomalyGrid) {
          for (const warmMinCoveragePct of warmCoverageGrid) {
            for (const warmMinExtremeCount of warmExtremeGrid) {
              yield {
                ...BASELINE_PARAMS,
                coldMaxWeightedAnomalyF,
                coldMinCoveragePct,
                coldMinExtremeCount,
                warmMinWeightedAnomalyF,
                warmMinCoveragePct,
                warmMinExtremeCount,
              }
            }
          }
        }
      }
    }
  }
}

function resultSortKey(result) {
  return trainScore(result)
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function toCsv(rows, headers) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')
}

function flattenResult(result, rankIndex = null) {
  return {
    rank: rankIndex ?? '',
    id: result.id,
    sideMode: result.sideMode,
    trainScore: round(resultSortKey(result), 4),
    robustnessPass: robustnessPass(result),
    trainTotalReturnPct: result.train.metrics.totalReturnPct,
    trainMaxDrawdownPct: result.train.metrics.maxDrawdownPct,
    trainSharpe: result.train.metrics.sharpe,
    trainProfitFactor: result.train.metrics.profitFactor,
    trainTrades: result.train.metrics.tradeCount,
    testTotalReturnPct: result.test.metrics.totalReturnPct,
    testMaxDrawdownPct: result.test.metrics.maxDrawdownPct,
    testSharpe: result.test.metrics.sharpe,
    testProfitFactor: result.test.metrics.profitFactor,
    testTrades: result.test.metrics.tradeCount,
    fullTotalReturnPct: result.full.metrics.totalReturnPct,
    fullMaxDrawdownPct: result.full.metrics.maxDrawdownPct,
    fullSharpe: result.full.metrics.sharpe,
    fullProfitFactor: result.full.metrics.profitFactor,
    fullTrades: result.full.metrics.tradeCount,
    fullColdTrades: result.sides.full.coldLong.tradeCount,
    fullColdTotalReturnPct: result.sides.full.coldLong.totalReturnPct,
    fullWarmTrades: result.sides.full.warmShort.tradeCount,
    fullWarmTotalReturnPct: result.sides.full.warmShort.totalReturnPct,
    coldMaxWeightedAnomalyF: result.params.coldMaxWeightedAnomalyF,
    coldMinCoveragePct: result.params.coldMinCoveragePct,
    coldMinExtremeCount: result.params.coldMinExtremeCount,
    warmMinWeightedAnomalyF: result.params.warmMinWeightedAnomalyF,
    warmMinCoveragePct: result.params.warmMinCoveragePct,
    warmMinExtremeCount: result.params.warmMinExtremeCount,
  }
}

function tradeRow(trade, strategyLabel) {
  return {
    strategy: strategyLabel,
    issueDate: trade.row.issueDate,
    targetDate: trade.row.targetDate,
    entryTradeDate: trade.row.entryTradeDate,
    targetTradeDate: trade.row.targetTradeDate,
    sourceId: trade.row.sourceId,
    thesisKind: trade.row.thesisKind,
    leadDays: trade.row.leadDays,
    direction: trade.direction === 1 ? 'long' : 'short',
    weightedAnomalyF: round(trade.row.weightedAnomalyF, 3),
    coveragePct: round(trade.row.coveragePct, 3),
    coldCoveragePct: round(trade.row.coldCoveragePct, 3),
    warmCoveragePct: round(trade.row.warmCoveragePct, 3),
    extremeCount: trade.row.extremeCount,
    confirmedSourceGroups: trade.row.confirmedSourceGroups.join('|'),
    confirmedSourceFamilies: trade.row.confirmedSourceFamilies.join('|'),
    grossReturnPct: round(trade.grossReturnPct, 4),
    netReturnPct: round(trade.netReturnPct, 4),
    rank: round(trade.rank, 5),
  }
}

function writeArtifacts({ baseline, bestTrain, bestRobust, bestBySide, ranked, manifest, inputFiles }) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const candidateHeaders = Object.keys(flattenResult(ranked[0], 1))
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'candidate-summary.csv'),
    `${toCsv(ranked.slice(0, 120).map((result, index) => flattenResult(result, index + 1)), candidateHeaders)}\n`,
  )

  const tradeHeaders = Object.keys(tradeRow(baseline.full.trades[0] ?? bestTrain.full.trades[0], ''))
  const selectedTrades = [
    ...baseline.full.trades.map((trade) => tradeRow(trade, 'baseline-reproduction')),
    ...bestTrain.full.trades.map((trade) => tradeRow(trade, 'best-train-ranked')),
    ...bestRobust.full.trades.map((trade) => tradeRow(trade, 'best-robust-validation')),
  ]
  fs.writeFileSync(path.join(OUTPUT_DIR, 'selected-trades.csv'), `${toCsv(selectedTrades, tradeHeaders)}\n`)

  const sideRows = []
  for (const [label, result] of [
    ['baseline-reproduction', baseline],
    ['best-train-ranked', bestTrain],
    ['best-robust-validation', bestRobust],
    ...Object.entries(bestBySide).map(([side, result]) => [`best-${side}`, result]),
  ]) {
    for (const [split, metricsBySide] of Object.entries(result.sides)) {
      for (const [side, metrics] of Object.entries(metricsBySide)) {
        sideRows.push({
          strategy: label,
          split,
          side,
          totalReturnPct: metrics.totalReturnPct,
          maxDrawdownPct: metrics.maxDrawdownPct,
          sharpe: metrics.sharpe,
          winRatePct: metrics.winRatePct,
          profitFactor: metrics.profitFactor,
          tradeCount: metrics.tradeCount,
        })
      }
    }
  }
  const sideHeaders = Object.keys(sideRows[0])
  fs.writeFileSync(path.join(OUTPUT_DIR, 'side-metrics.csv'), `${toCsv(sideRows, sideHeaders)}\n`)

  const seasonRows = []
  for (const [label, result] of [
    ['baseline-reproduction', baseline],
    ['best-train-ranked', bestTrain],
    ['best-robust-validation', bestRobust],
  ]) {
    for (const row of result.seasons) {
      seasonRows.push({
        strategy: label,
        season: row.season,
        totalReturnPct: row.metrics.totalReturnPct,
        maxDrawdownPct: row.metrics.maxDrawdownPct,
        sharpe: row.metrics.sharpe,
        winRatePct: row.metrics.winRatePct,
        profitFactor: row.metrics.profitFactor,
        tradeCount: row.metrics.tradeCount,
      })
    }
  }
  const seasonHeaders = Object.keys(seasonRows[0])
  fs.writeFileSync(path.join(OUTPUT_DIR, 'season-checks.csv'), `${toCsv(seasonRows, seasonHeaders)}\n`)

  const summary = {
    generatedAt: new Date().toISOString(),
    trainCutoff: TRAIN_CUTOFF,
    pnlColumn: 'returnPctEntryCloseToTarget',
    noLookaheadRules: ['entryTradeDate > issueDate', 'targetTradeDate >= targetDate', 'targetTradeDate > entryTradeDate'],
    roundTripCostPct: ROUND_TRIP_COST_PCT,
    baselineTradeFile: path.relative(REPO_ROOT, BASELINE_TRADES_PATH),
    inputFiles,
    manifestGeneratedAt: manifest.generatedAt,
    grid: GRID,
    minValidationPolicy: {
      combinedTrainTrades: 8,
      combinedTestTrades: 5,
      combinedFullTrades: 10,
      coldOnlyTrainTrades: minTrainTradesForSide('cold-long'),
      warmOnlyTrainTrades: minTrainTradesForSide('warm-short'),
      coldFullTrades: 3,
      warmFullTrades: 6,
      maxAcceptedTestDrawdownPct: -18,
    },
    robustCandidateCount: ranked.filter(robustnessPass).length,
    baseline: compactResult(baseline),
    bestTrainRanked: compactResult(bestTrain),
    bestRobustValidation: compactResult(bestRobust),
    bestBySide: Object.fromEntries(Object.entries(bestBySide).map(([key, value]) => [key, compactResult(value)])),
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.md'), reportMarkdown(summary))
}

function compactResult(result) {
  return {
    id: result.id,
    sideMode: result.sideMode,
    params: result.params,
    trainScore: round(resultSortKey(result), 4),
    robustnessPass: robustnessPass(result),
    full: result.full.metrics,
    train: result.train.metrics,
    test: result.test.metrics,
    sides: result.sides,
    seasons: result.seasons,
    worstFullTrades: result.full.trades
      .slice()
      .sort((a, b) => a.netReturnPct - b.netReturnPct)
      .slice(0, 5)
      .map((trade) => tradeRow(trade, result.id)),
    topFullTrades: result.full.trades
      .slice()
      .sort((a, b) => b.netReturnPct - a.netReturnPct)
      .slice(0, 5)
      .map((trade) => tradeRow(trade, result.id)),
  }
}

function metricLine(metrics) {
  return `${metrics.totalReturnPct}% total, ${metrics.maxDrawdownPct}% maxDD, Sharpe ${metrics.sharpe}, ${metrics.tradeCount} trades`
}

function paramsLine(params) {
  return `cold <= ${params.coldMaxWeightedAnomalyF}F, cold coverage >= ${params.coldMinCoveragePct}, cold extremes >= ${params.coldMinExtremeCount}; warm >= ${params.warmMinWeightedAnomalyF}F, warm coverage >= ${params.warmMinCoveragePct}, warm extremes >= ${params.warmMinExtremeCount}`
}

function reportMarkdown(summary) {
  const robustNote = summary.robustCandidateCount
    ? `${summary.robustCandidateCount} combined candidate(s) passed the robustness gate.`
    : 'No combined candidate passed the robustness gate.'
  const recommendation =
    summary.bestTrainRanked.robustnessPass && summary.bestTrainRanked.test.totalReturnPct > summary.baseline.test.totalReturnPct
      ? 'Candidate is strong enough to consider as a baseline replacement, pending a code review and a fresh data rerun.'
      : 'Do not replace the current baseline yet; use the refined thresholds as research input because the validation set is still small and side balance is fragile.'

  return `# Rule Arctic Threshold Optimization

Generated: ${summary.generatedAt}

## Method

- PnL: \`${summary.pnlColumn}\`, net of ${summary.roundTripCostPct}% round-trip cost.
- Timing filter: ${summary.noLookaheadRules.join('; ')}.
- Validation: train issue dates before ${summary.trainCutoff}; test issue dates on/after ${summary.trainCutoff}.
- Search discipline: fixed small threshold grid, 2+ source groups, 2+ model families, rumor-window lead days 7-10 only.

## Baseline Reproduction

- Full: ${metricLine(summary.baseline.full)}
- Train: ${metricLine(summary.baseline.train)}
- Test: ${metricLine(summary.baseline.test)}

## Best Train-Ranked Candidate

- Params: ${paramsLine(summary.bestTrainRanked.params)}
- Full: ${metricLine(summary.bestTrainRanked.full)}
- Train: ${metricLine(summary.bestTrainRanked.train)}
- Test: ${metricLine(summary.bestTrainRanked.test)}
- Cold full: ${metricLine(summary.bestTrainRanked.sides.full.coldLong)}
- Warm full: ${metricLine(summary.bestTrainRanked.sides.full.warmShort)}

## Best Robust Validation Candidate

${robustNote}

- Params: ${paramsLine(summary.bestRobustValidation.params)}
- Full: ${metricLine(summary.bestRobustValidation.full)}
- Train: ${metricLine(summary.bestRobustValidation.train)}
- Test: ${metricLine(summary.bestRobustValidation.test)}
- Cold full: ${metricLine(summary.bestRobustValidation.sides.full.coldLong)}
- Warm full: ${metricLine(summary.bestRobustValidation.sides.full.warmShort)}

## Side Checks

- Cold-only best: ${metricLine(summary.bestBySide['cold-long'].full)} with ${paramsLine(summary.bestBySide['cold-long'].params)}
- Warm-only best: ${metricLine(summary.bestBySide['warm-short'].full)} with ${paramsLine(summary.bestBySide['warm-short'].params)}

## Recommendation

${recommendation}
`
}

function baselineFileMetrics() {
  const rows = parseCsv(BASELINE_TRADES_PATH)
  const trades = rows.map((row) => ({
    row: {
      issueDate: row.issueDate,
      entryTradeDate: row.entryTradeDate,
      targetTradeDate: row.targetTradeDate,
      thesisKind: row.thesisKind,
    },
    netReturnPct: numberFrom(row.netReturnPct),
  }))
  return tradeMetrics(trades)
}

function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const { manifest, scores, returnRows, inputFiles } = loadRows()
  const baseline = evaluateParams(scores, returnRows, BASELINE_PARAMS, 'combined')
  const baselineFile = baselineFileMetrics()
  const baselineDelta = round(baseline.full.metrics.totalReturnPct - baselineFile.totalReturnPct, 4)
  if (Math.abs(baselineDelta) > 0.01 || baseline.full.metrics.tradeCount !== baselineFile.tradeCount) {
    throw new Error(
      `Baseline reproduction mismatch: computed ${baseline.full.metrics.totalReturnPct}%/${baseline.full.metrics.tradeCount} trades vs file ${baselineFile.totalReturnPct}%/${baselineFile.tradeCount} trades`,
    )
  }

  const results = []
  for (const sideMode of SIDE_MODES) {
    for (const params of paramGridForSide(sideMode)) {
      results.push(evaluateParams(scores, returnRows, params, sideMode))
    }
  }

  const ranked = results
    .filter((result) => result.train.metrics.tradeCount >= minTrainTradesForSide(result.sideMode))
    .sort((a, b) => resultSortKey(b) - resultSortKey(a))

  const combinedRanked = ranked.filter((result) => result.sideMode === 'combined')
  const bestTrain = combinedRanked[0]
  const robustCandidates = combinedRanked.filter(robustnessPass)
  const bestRobust =
    robustCandidates.sort((a, b) => {
      if (b.test.metrics.totalReturnPct !== a.test.metrics.totalReturnPct) return b.test.metrics.totalReturnPct - a.test.metrics.totalReturnPct
      return resultSortKey(b) - resultSortKey(a)
    })[0] ?? bestTrain
  const bestBySide = {
    'cold-long': ranked.find((result) => result.sideMode === 'cold-long'),
    'warm-short': ranked.find((result) => result.sideMode === 'warm-short'),
  }

  writeArtifacts({ baseline, bestTrain, bestRobust, bestBySide, ranked, manifest, inputFiles })
  console.log(
    JSON.stringify(
      {
        outputDir: path.relative(REPO_ROOT, OUTPUT_DIR),
        searchedCandidates: results.length,
        rankedCandidates: ranked.length,
        baseline: baseline.full.metrics,
        bestTrain: compactResult(bestTrain),
        bestRobust: compactResult(bestRobust),
        bestBySide: Object.fromEntries(Object.entries(bestBySide).map(([key, value]) => [key, compactResult(value)])),
      },
      null,
      2,
    ),
  )
}

run()
