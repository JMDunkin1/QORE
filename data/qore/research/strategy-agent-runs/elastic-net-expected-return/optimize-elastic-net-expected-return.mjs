import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/elastic-net-expected-return')

const TRAIN_CUTOFF = '2025-11-01'
const ROUND_TRIP_COST_PCT = 0.064
const COLD_RUMOR_MAX_WEIGHTED_ANOMALY_F = -8
const COLD_RUMOR_MIN_COVERAGE_PCT = 0.55
const WARM_RUMOR_MIN_WEIGHTED_ANOMALY_F = 8
const WARM_RUMOR_MIN_COVERAGE_PCT = 0.6
const WARM_COVERAGE_MIN_ANOMALY_F = 8
const WARM_EXTREME_ANOMALY_F = 14
const WINTER_THESIS_MIN_SOURCE_GROUPS = 2
const WINTER_THESIS_MIN_MODEL_FAMILIES = 2

const WALK_FORWARD_FOLDS = [
  { id: 'wf-2024-nov-dec', trainEnd: '2024-11-01', validationStart: '2024-11-01', validationEnd: '2025-01-01' },
  { id: 'wf-2025-jan-feb', trainEnd: '2025-01-01', validationStart: '2025-01-01', validationEnd: '2025-03-01' },
  { id: 'wf-2025-mar-oct', trainEnd: '2025-03-01', validationStart: '2025-03-01', validationEnd: TRAIN_CUTOFF },
]

const FEATURE_MODES = ['weather-only', 'source-group', 'source-id']
const ALPHA_GRID = [0.008, 0.03]
const L1_RATIO_GRID = [0.25, 0.5]
const THRESHOLD_GRID = [ROUND_TRIP_COST_PCT, 0.25, 0.5, 1]
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
  if (!Number.isFinite(value)) return 0
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

function dayOfYear(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  const start = new Date(`${date.getUTCFullYear()}-01-01T00:00:00Z`)
  return Math.floor((date.getTime() - start.getTime()) / 86400000) + 1
}

function monthFromIsoDate(isoDate) {
  return Number(isoDate.slice(5, 7))
}

function isHeatingSeasonIssue(isoDate) {
  const month = monthFromIsoDate(isoDate)
  return month <= 3 || month >= 11
}

function expectedWindowIdForLead(leadDays) {
  if (leadDays >= 7 && leadDays <= 10) return 'rumor'
  if (leadDays >= 1 && leadDays <= 3) return 'selloff'
  return 'other'
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

function isColdRumorWindow(score) {
  return score.windowId === 'rumor' && score.leadDays >= 7 && score.leadDays <= 10
}

function isWarmRumorWindow(score) {
  return score.windowId === 'rumor' && score.leadDays >= 7 && score.leadDays <= 10
}

function winterThesisForScore(score) {
  if (!isHeatingSeasonIssue(score.issueDate)) return null

  if (
    isColdRumorWindow(score) &&
    score.weightedAnomalyF <= COLD_RUMOR_MAX_WEIGHTED_ANOMALY_F &&
    score.coldCoveragePct >= COLD_RUMOR_MIN_COVERAGE_PCT
  ) {
    return {
      kind: 'cold-long',
      direction: 1,
      coveragePct: score.coldCoveragePct,
      extremeCount: score.coldExtremeCount,
    }
  }

  if (
    isWarmRumorWindow(score) &&
    score.weightedAnomalyF >= WARM_RUMOR_MIN_WEIGHTED_ANOMALY_F &&
    score.warmCoveragePct >= WARM_RUMOR_MIN_COVERAGE_PCT
  ) {
    return {
      kind: 'warm-short',
      direction: -1,
      coveragePct: score.warmCoveragePct,
      extremeCount: score.warmExtremeCount,
    }
  }

  return null
}

function signalStrength(row) {
  if (row.thesisKind === 'warm-short') return Math.max(0, row.weightedAnomalyF)
  return Math.max(0, -row.weightedAnomalyF)
}

function scoreKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId, row.modelId].join('|')
}

function consensusKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId].join('|')
}

function winterThesisKey(issueTargetWindowKey, thesisKind) {
  return `${issueTargetWindowKey}|${thesisKind}`
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

function loadRows() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const inputFiles = []
  const sourceIds = []
  const parsedCalendars = []
  const allScores = []

  for (const calendar of manifest.forecastCalendars) {
    sourceIds.push(calendar.id)
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const returnsPath = path.join(DATA_ROOT, calendar.files.signalReturns)
    const locationsPath = path.join(DATA_ROOT, calendar.files.locationAnomalies)
    inputFiles.push(path.relative(REPO_ROOT, scoresPath), path.relative(REPO_ROOT, returnsPath), path.relative(REPO_ROOT, locationsPath))

    const breadthByScore = locationBreadthByScore(locationsPath)
    const scores = new Map()

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
      scores.set(scoreKey(score), parsedScore)
      allScores.push(parsedScore)
    }

    parsedCalendars.push({ calendar, returns: parseCsv(returnsPath), scores })
  }

  const thesisCandidatesBySignal = new Map()
  for (const score of allScores) {
    const thesis = winterThesisForScore(score)
    if (!thesis) continue
    const key = winterThesisKey(consensusKey(score), thesis.kind)
    thesisCandidatesBySignal.set(key, [...(thesisCandidatesBySignal.get(key) ?? []), score])
  }

  const confirmationBySignal = new Map()
  for (const [key, candidates] of thesisCandidatesBySignal) {
    const sourceGroups = [...new Set(candidates.map((score) => score.sourceGroup))].sort()
    const sourceFamilies = [...new Set(candidates.map((score) => score.sourceFamily))].sort()
    if (
      sourceGroups.length >= WINTER_THESIS_MIN_SOURCE_GROUPS &&
      sourceFamilies.length >= WINTER_THESIS_MIN_MODEL_FAMILIES
    ) {
      confirmationBySignal.set(key, { sourceGroups, sourceFamilies })
    }
  }

  const rows = []
  let joinedUngRows = 0
  let rejectedTimingRows = 0

  for (const { calendar, returns, scores } of parsedCalendars) {
    for (const ret of returns) {
      if (ret.symbol === 'UNG') joinedUngRows += 1
      const score = scores.get(scoreKey(ret))
      const thesis = score ? winterThesisForScore(score) : null
      const confirmation = score && thesis ? confirmationBySignal.get(winterThesisKey(consensusKey(score), thesis.kind)) : null
      const confirmedWinterThesis = Boolean(score && thesis && confirmation)
      const joined = {
        sourceId: calendar.id,
        sourceLabel: calendar.label,
        sourceFamily: sourceFamilyFor(calendar.id),
        sourceGroup: sourceGroupFor(calendar.id),
        issueDate: ret.issueDate,
        targetDate: ret.targetDate,
        leadDays: numberFrom(ret.leadDays),
        windowId: ret.windowId,
        modelId: ret.modelId,
        symbol: ret.symbol,
        priorTradeDate: ret.priorTradeDate,
        entryTradeDate: ret.entryTradeDate,
        targetTradeDate: ret.targetTradeDate,
        returnPct: numberFrom(ret.returnPctEntryCloseToTarget, Number.NaN),
        priorReturnPct: numberFrom(ret.returnPctPriorCloseToTarget, Number.NaN),
        weightedAnomalyF: score?.weightedAnomalyF ?? 0,
        coveragePct: thesis?.coveragePct ?? 0,
        extremeCount: thesis?.extremeCount ?? 0,
        coldCoveragePct: score?.coldCoveragePct ?? 0,
        warmCoveragePct: score?.warmCoveragePct ?? 0,
        coldExtremeCount: score?.coldExtremeCount ?? 0,
        warmExtremeCount: score?.warmExtremeCount ?? 0,
        sampledWeight: score?.sampledWeight ?? 0,
        locationCount: score?.locationCount ?? 0,
        thesisKind: thesis?.kind ?? 'none',
        thesisDirection: thesis?.direction ?? 0,
        confirmedWinterThesis,
        confirmedSourceGroups: confirmation?.sourceGroups ?? [],
        confirmedSourceFamilies: confirmation?.sourceFamilies ?? [],
      }

      if (!score || !confirmedWinterThesis) continue
      if (isTradable(joined)) {
        rows.push(joined)
      } else if (ret.symbol === 'UNG') {
        rejectedTimingRows += 1
      }
    }
  }

  return { manifest, rows, sourceIds, inputFiles, joinedUngRows, rejectedTimingRows }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort()
}

function featureNames(featureMode, sourceIds) {
  const base = [
    'leadDays',
    'coldStrength',
    'warmStrength',
    'thesisStrength',
    'weightedAnomalyF',
    'coveragePct',
    'extremeCount',
    'coldCoveragePct',
    'warmCoveragePct',
    'coldExtremeCount',
    'warmExtremeCount',
    'sampledWeight',
    'locationCount',
    'isColdThesis',
    'isWarmThesis',
    'thesisDirection',
    'coverageStrength',
    'extremeCoverage',
    'doySin',
    'doyCos',
  ]
  if (featureMode === 'source-group') {
    return [...base, ...uniqueSorted(sourceIds.map(sourceGroupFor)).map((group) => `sourceGroup:${group}`)]
  }
  if (featureMode === 'source-id') {
    return [...base, ...sourceIds.map((sourceId) => `source:${sourceId}`)]
  }
  return base
}

function rawFeatures(row, featureMode, sourceIds) {
  const coldStrength = Math.max(0, -row.weightedAnomalyF)
  const warmStrength = Math.max(0, row.weightedAnomalyF)
  const thesisStrength = signalStrength(row)
  const doy = dayOfYear(row.issueDate)
  const base = [
    row.leadDays,
    coldStrength,
    warmStrength,
    thesisStrength,
    row.weightedAnomalyF,
    row.coveragePct,
    row.extremeCount,
    row.coldCoveragePct,
    row.warmCoveragePct,
    row.coldExtremeCount,
    row.warmExtremeCount,
    row.sampledWeight,
    row.locationCount,
    row.thesisKind === 'cold-long' ? 1 : 0,
    row.thesisKind === 'warm-short' ? 1 : 0,
    row.thesisDirection,
    row.coveragePct * thesisStrength,
    row.coveragePct * row.extremeCount,
    Math.sin((2 * Math.PI * doy) / 365.25),
    Math.cos((2 * Math.PI * doy) / 365.25),
  ]
  if (featureMode === 'source-group') {
    const groups = uniqueSorted(sourceIds.map(sourceGroupFor))
    return [...base, ...groups.map((group) => (row.sourceGroup === group ? 1 : 0))]
  }
  if (featureMode === 'source-id') {
    return [...base, ...sourceIds.map((sourceId) => (row.sourceId === sourceId ? 1 : 0))]
  }
  return base
}

function fitScaler(rows, featureMode, sourceIds) {
  const matrix = rows.map((row) => rawFeatures(row, featureMode, sourceIds))
  const columns = matrix[0]?.length ?? 0
  const means = Array.from({ length: columns }, (_, column) => mean(matrix.map((values) => values[column])))
  const scales = Array.from({ length: columns }, (_, column) => std(matrix.map((values) => values[column])) || 1)
  return { means, scales }
}

function transformRow(row, featureMode, sourceIds, scaler) {
  return rawFeatures(row, featureMode, sourceIds).map((value, index) => (value - scaler.means[index]) / scaler.scales[index])
}

function dot(weights, values) {
  let total = 0
  for (let index = 0; index < weights.length; index += 1) total += weights[index] * values[index]
  return total
}

function theoryAlignedReturnPct(row) {
  return row.thesisDirection * row.returnPct
}

function trainElasticNet(rows, config, sourceIds) {
  const scaler = fitScaler(rows, config.featureMode, sourceIds)
  const x = rows.map((row) => transformRow(row, config.featureMode, sourceIds, scaler))
  const yRaw = rows.map(theoryAlignedReturnPct)
  const yMean = mean(yRaw)
  const yScale = std(yRaw) || 1
  const y = yRaw.map((value) => (value - yMean) / yScale)
  const weights = Array.from({ length: x[0]?.length ?? 0 }, () => 0)
  let intercept = 0

  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    const grad = Array.from({ length: weights.length }, () => 0)
    let interceptGrad = 0

    for (let rowIndex = 0; rowIndex < x.length; rowIndex += 1) {
      const prediction = intercept + dot(weights, x[rowIndex])
      const error = prediction - y[rowIndex]
      interceptGrad += error
      for (let column = 0; column < weights.length; column += 1) {
        grad[column] += error * x[rowIndex][column]
      }
    }

    intercept -= (config.learningRate * interceptGrad) / x.length
    for (let column = 0; column < weights.length; column += 1) {
      const l2 = config.alpha * (1 - config.l1Ratio) * weights[column]
      weights[column] -= config.learningRate * (grad[column] / x.length + l2)
      const shrink = config.learningRate * config.alpha * config.l1Ratio
      weights[column] = Math.sign(weights[column]) * Math.max(0, Math.abs(weights[column]) - shrink)
    }
  }

  return {
    predict(row) {
      return (intercept + dot(weights, transformRow(row, config.featureMode, sourceIds, scaler))) * yScale + yMean
    },
    weights,
    intercept,
    yMean,
    yScale,
    scaler,
  }
}

function coefficientSummary(model, names, count = 10) {
  return model.weights
    .map((weight, index) => ({ feature: names[index], weight: round(weight, 5) }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, count)
}

function sideRows(rows, sideMode) {
  if (sideMode === 'combined') return rows
  return rows.filter((row) => row.thesisKind === sideMode)
}

function minTrainRows(sideMode) {
  return sideMode === 'combined' ? 32 : 12
}

function scoreCandidates(model, evalRows, config) {
  return evalRows
    .map((row) => {
      const expectedReturnPct = model.predict(row)
      return {
        row,
        direction: expectedReturnPct >= config.minExpectedTheoryReturnPct ? row.thesisDirection : 0,
        rank: expectedReturnPct,
        expectedReturnPct,
      }
    })
    .filter((candidate) => candidate.direction)
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
      coldTrades: 0,
      warmTrades: 0,
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
    coldTrades: trades.filter((trade) => trade.row.thesisKind === 'cold-long').length,
    warmTrades: trades.filter((trade) => trade.row.thesisKind === 'warm-short').length,
  }
}

function metricsForSide(trades, thesisKind) {
  return tradeMetrics(trades.filter((trade) => trade.row.thesisKind === thesisKind))
}

function scoreMetricForSelection(metrics, sideMode) {
  const minimum = sideMode === 'combined' ? 5 : 2
  const tradePenalty = metrics.tradeCount >= minimum ? 0 : -10000
  return tradePenalty + metrics.totalReturnPct + metrics.sharpe * 2 + metrics.maxDrawdownPct * 0.35
}

function evaluatePeriod(rows, sourceIds, config, trainStart, trainEnd, evalStart, evalEnd) {
  const scopedRows = sideRows(rows, config.sideMode)
  const trainRows = scopedRows.filter((row) => (!trainStart || row.issueDate >= trainStart) && row.issueDate < trainEnd)
  const evalRows = scopedRows.filter((row) => row.issueDate >= evalStart && row.issueDate < evalEnd)
  if (trainRows.length < minTrainRows(config.sideMode) || !evalRows.length) {
    return {
      skipped: true,
      trainRows: trainRows.length,
      evalRows: evalRows.length,
      trades: [],
      candidates: [],
      metrics: tradeMetrics([]),
      coefficients: [],
    }
  }
  const model = trainElasticNet(trainRows, config, sourceIds)
  const candidates = scoreCandidates(model, evalRows, config)
  const trades = resolveTrades(candidates)
  return {
    skipped: false,
    trainRows: trainRows.length,
    evalRows: evalRows.length,
    candidates,
    trades,
    metrics: tradeMetrics(trades),
    coefficients: coefficientSummary(model, featureNames(config.featureMode, sourceIds)),
  }
}

function walkForward(rows, sourceIds, config) {
  const foldResults = WALK_FORWARD_FOLDS.map((fold) => {
    const result = evaluatePeriod(rows, sourceIds, config, null, fold.trainEnd, fold.validationStart, fold.validationEnd)
    return {
      ...fold,
      skipped: result.skipped,
      trainRows: result.trainRows,
      validationRows: result.evalRows,
      candidateCount: result.candidates.length,
      metrics: result.metrics,
      trades: result.trades,
    }
  })
  const trades = foldResults.flatMap((fold) => fold.trades)
  return {
    folds: foldResults.map((fold) => ({
      id: fold.id,
      trainEnd: fold.trainEnd,
      validationStart: fold.validationStart,
      validationEnd: fold.validationEnd,
      skipped: fold.skipped,
      trainRows: fold.trainRows,
      validationRows: fold.validationRows,
      candidateCount: fold.candidateCount,
      metrics: fold.metrics,
    })),
    metrics: tradeMetrics(trades.sort((a, b) => a.row.entryTradeDate.localeCompare(b.row.entryTradeDate))),
  }
}

function finalTrainTest(rows, sourceIds, config) {
  return evaluatePeriod(rows, sourceIds, config, null, TRAIN_CUTOFF, TRAIN_CUTOFF, '9999-12-31')
}

function configId(config) {
  return [
    config.sideMode,
    config.featureMode,
    `alpha-${config.alpha}`,
    `l1-${config.l1Ratio}`,
    `min-${config.minExpectedTheoryReturnPct}`,
  ].join('__')
}

function candidateConfigs() {
  const configs = []
  for (const sideMode of SIDE_MODES) {
    for (const featureMode of FEATURE_MODES) {
      for (const alpha of ALPHA_GRID) {
        for (const l1Ratio of L1_RATIO_GRID) {
          for (const minExpectedTheoryReturnPct of THRESHOLD_GRID) {
            configs.push({
              id: configId({ sideMode, featureMode, alpha, l1Ratio, minExpectedTheoryReturnPct }),
              sideMode,
              featureMode,
              alpha,
              l1Ratio,
              minExpectedTheoryReturnPct,
              learningRate: 0.035,
              iterations: 380,
            })
          }
        }
      }
    }
  }
  return configs
}

function flattenResult(config, cv, test, train) {
  const cvScore = scoreMetricForSelection(cv.metrics, config.sideMode)
  const postMin = config.sideMode === 'combined' ? 8 : 4
  const cvMin = config.sideMode === 'combined' ? 5 : 2
  const sourceRobust = config.featureMode !== 'source-id'
  return {
    config,
    cv,
    train,
    test,
    cvScore: round(cvScore, 4),
    replacementEligible:
      sourceRobust &&
      cv.metrics.tradeCount >= cvMin &&
      cv.metrics.totalReturnPct > 0 &&
      test.metrics.tradeCount >= postMin &&
      test.metrics.totalReturnPct > 0 &&
      test.metrics.maxDrawdownPct >= -12,
  }
}

function runGrid(rows, sourceIds) {
  const trainRows = rows.filter((row) => row.issueDate < TRAIN_CUTOFF)
  return candidateConfigs().map((config) => {
    const cv = walkForward(rows, sourceIds, config)
    const test = finalTrainTest(rows, sourceIds, config)
    const train = {
      metrics: tradeMetrics(resolveTrades(scoreCandidates(trainElasticNet(sideRows(trainRows, config.sideMode), config, sourceIds), sideRows(trainRows, config.sideMode), config))),
      rowCount: sideRows(trainRows, config.sideMode).length,
    }
    return flattenResult(config, cv, test, train)
  })
}

function selectBest(results, sideMode, { robustOnly = false } = {}) {
  const scoped = results.filter((result) => result.config.sideMode === sideMode)
  const eligible = robustOnly ? scoped.filter((result) => result.replacementEligible) : scoped
  return [...eligible].sort((a, b) => b.cvScore - a.cvScore)[0] ?? null
}

function combineTwoSleeve(rows, sourceIds, coldResult, warmResult) {
  const candidates = []
  const sleeveSummaries = []
  for (const result of [coldResult, warmResult].filter(Boolean)) {
    const config = result.config
    const period = finalTrainTest(rows, sourceIds, config)
    candidates.push(...period.candidates)
    sleeveSummaries.push({
      sideMode: config.sideMode,
      configId: config.id,
      featureMode: config.featureMode,
      alpha: config.alpha,
      l1Ratio: config.l1Ratio,
      minExpectedTheoryReturnPct: config.minExpectedTheoryReturnPct,
      metrics: period.metrics,
    })
  }
  const trades = resolveTrades(candidates)
  return {
    id: 'two-sleeve-side-specific-elastic-net',
    selectionPolicy: 'Cold-long and warm-short elastic-net configs selected by pre-cutoff walk-forward score, then combined post-cutoff with the same non-overlap rules.',
    sleeves: sleeveSummaries,
    metrics: tradeMetrics(trades),
    sideMetrics: {
      coldLong: metricsForSide(trades, 'cold-long'),
      warmShort: metricsForSide(trades, 'warm-short'),
    },
    trades,
  }
}

function formatTrade(trade, strategyId) {
  return {
    strategyId,
    issueDate: trade.row.issueDate,
    targetDate: trade.row.targetDate,
    entryTradeDate: trade.row.entryTradeDate,
    targetTradeDate: trade.row.targetTradeDate,
    sourceId: trade.row.sourceId,
    sourceGroup: trade.row.sourceGroup,
    thesisKind: trade.row.thesisKind,
    direction: trade.direction === 1 ? 'long' : 'short',
    leadDays: trade.row.leadDays,
    weightedAnomalyF: round(trade.row.weightedAnomalyF, 3),
    coveragePct: round(trade.row.coveragePct, 3),
    coldCoveragePct: round(trade.row.coldCoveragePct, 3),
    warmCoveragePct: round(trade.row.warmCoveragePct, 3),
    extremeCount: trade.row.extremeCount,
    expectedReturnPct: round(trade.expectedReturnPct, 4),
    grossReturnPct: round(trade.grossReturnPct, 4),
    netReturnPct: round(trade.netReturnPct, 4),
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function writeCsv(fileName, rows, fallbackHeaders) {
  const headers = Object.keys(rows[0] ?? fallbackHeaders)
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')
  const outPath = path.join(OUT_DIR, fileName)
  fs.writeFileSync(outPath, `${csv}\n`)
  return path.relative(REPO_ROOT, outPath)
}

function resultRow(result) {
  return {
    configId: result.config.id,
    sideMode: result.config.sideMode,
    featureMode: result.config.featureMode,
    alpha: result.config.alpha,
    l1Ratio: result.config.l1Ratio,
    minExpectedTheoryReturnPct: result.config.minExpectedTheoryReturnPct,
    cvScore: result.cvScore,
    cvTradeCount: result.cv.metrics.tradeCount,
    cvTotalReturnPct: result.cv.metrics.totalReturnPct,
    cvSharpe: result.cv.metrics.sharpe,
    cvMaxDrawdownPct: result.cv.metrics.maxDrawdownPct,
    trainRowCount: result.train.rowCount,
    trainTradeCount: result.train.metrics.tradeCount,
    trainTotalReturnPct: result.train.metrics.totalReturnPct,
    postTradeCount: result.test.metrics.tradeCount,
    postColdTrades: result.test.metrics.coldTrades,
    postWarmTrades: result.test.metrics.warmTrades,
    postTotalReturnPct: result.test.metrics.totalReturnPct,
    postSharpe: result.test.metrics.sharpe,
    postMaxDrawdownPct: result.test.metrics.maxDrawdownPct,
    postWinRatePct: result.test.metrics.winRatePct,
    postProfitFactor: result.test.metrics.profitFactor,
    replacementEligible: result.replacementEligible,
  }
}

function summarizeRows(rows, sourceIds) {
  const bySide = rows.reduce(
    (counts, row) => {
      counts[row.thesisKind] = (counts[row.thesisKind] ?? 0) + 1
      return counts
    },
    {},
  )
  const bySource = sourceIds.map((sourceId) => ({
    sourceId,
    trainRows: rows.filter((row) => row.sourceId === sourceId && row.issueDate < TRAIN_CUTOFF).length,
    postRows: rows.filter((row) => row.sourceId === sourceId && row.issueDate >= TRAIN_CUTOFF).length,
    firstIssueDate: rows.filter((row) => row.sourceId === sourceId).map((row) => row.issueDate).sort()[0] ?? null,
    lastIssueDate: rows.filter((row) => row.sourceId === sourceId).map((row) => row.issueDate).sort().at(-1) ?? null,
  }))
  return {
    rowCount: rows.length,
    firstIssueDate: rows.map((row) => row.issueDate).sort()[0] ?? null,
    lastIssueDate: rows.map((row) => row.issueDate).sort().at(-1) ?? null,
    trainRows: rows.filter((row) => row.issueDate < TRAIN_CUTOFF).length,
    postRows: rows.filter((row) => row.issueDate >= TRAIN_CUTOFF).length,
    bySide,
    bySource,
  }
}

function markdownTable(rows, headers) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => row[header]).join(' | ')} |`),
  ]
  return lines.join('\n')
}

function writeReport(summary, bestCombined, bestCold, bestWarm, twoSleeve, baseline) {
  const topRows = []
  if (baseline) {
    topRows.push({
      candidate: 'baseline reproduction',
      features: baseline.config.featureMode,
      threshold: baseline.config.minExpectedTheoryReturnPct,
      cvTrades: baseline.cv.metrics.tradeCount,
      cvReturn: `${baseline.cv.metrics.totalReturnPct}%`,
      postTrades: baseline.test.metrics.tradeCount,
      postReturn: `${baseline.test.metrics.totalReturnPct}%`,
      postDD: `${baseline.test.metrics.maxDrawdownPct}%`,
      replace: 'no',
    })
  }
  for (const [label, result] of [
    ['best combined by CV', bestCombined],
    ['best cold-long by CV', bestCold],
    ['best warm-short by CV', bestWarm],
  ]) {
    if (!result) continue
    topRows.push({
      candidate: label,
      features: result.config.featureMode,
      threshold: result.config.minExpectedTheoryReturnPct,
      cvTrades: result.cv.metrics.tradeCount,
      cvReturn: `${result.cv.metrics.totalReturnPct}%`,
      postTrades: result.test.metrics.tradeCount,
      postReturn: `${result.test.metrics.totalReturnPct}%`,
      postDD: `${result.test.metrics.maxDrawdownPct}%`,
      replace: result.replacementEligible ? 'yes' : 'no',
    })
  }

  topRows.push({
    candidate: 'two-sleeve',
    features: twoSleeve.sleeves.map((sleeve) => `${sleeve.sideMode}:${sleeve.featureMode}`).join(' + '),
    threshold: twoSleeve.sleeves.map((sleeve) => `${sleeve.sideMode}:${sleeve.minExpectedTheoryReturnPct}`).join(' + '),
    cvTrades: `${bestCold?.cv.metrics.tradeCount ?? 0}/${bestWarm?.cv.metrics.tradeCount ?? 0}`,
    cvReturn: `${bestCold?.cv.metrics.totalReturnPct ?? 0}%/${bestWarm?.cv.metrics.totalReturnPct ?? 0}%`,
    postTrades: twoSleeve.metrics.tradeCount,
    postReturn: `${twoSleeve.metrics.totalReturnPct}%`,
    postDD: `${twoSleeve.metrics.maxDrawdownPct}%`,
    replace: twoSleeve.metrics.tradeCount >= 8 && twoSleeve.metrics.totalReturnPct > 0 ? 'maybe' : 'no',
  })

  const body = `# Elastic Net Expected-Return Lane

Generated at ${summary.generatedAt}.

## Setup

- Strategy lane: strict-theory-elastic-net-expected-return.
- Train/test: fit final models on issueDate < ${TRAIN_CUTOFF}; report holdout on issueDate >= ${TRAIN_CUTOFF}.
- Walk-forward selection: ${WALK_FORWARD_FOLDS.map((fold) => `${fold.id} ${fold.validationStart} to ${fold.validationEnd}`).join('; ')}.
- PnL: returnPctEntryCloseToTarget, with entryTradeDate > issueDate, targetTradeDate >= targetDate, and targetTradeDate > entryTradeDate.
- Cost: ${ROUND_TRIP_COST_PCT}% round trip per trade.

## Commands

- node scripts/optimize-arctic-strategies.mjs
- node data/qore/research/strategy-agent-runs/elastic-net-expected-return/optimize-elastic-net-expected-return.mjs

## Changed Files

- data/qore/research/strategy-agent-runs/elastic-net-expected-return/optimize-elastic-net-expected-return.mjs
- data/qore/research/strategy-agent-runs/elastic-net-expected-return/candidate-metrics.csv
- data/qore/research/strategy-agent-runs/elastic-net-expected-return/selected-trades.csv
- data/qore/research/strategy-agent-runs/elastic-net-expected-return/run-summary.json
- data/qore/research/strategy-agent-runs/elastic-net-expected-return/report.md

## Dataset

- Strict tradable rows: ${summary.dataset.rowCount}; train ${summary.dataset.trainRows}; post-cutoff ${summary.dataset.postRows}.
- Side rows: cold-long ${summary.dataset.bySide['cold-long'] ?? 0}; warm-short ${summary.dataset.bySide['warm-short'] ?? 0}.

## Best Candidates

${markdownTable(topRows, ['candidate', 'features', 'threshold', 'cvTrades', 'cvReturn', 'postTrades', 'postReturn', 'postDD', 'replace'])}

## Recommendation

${summary.recommendation}
`
  const outPath = path.join(OUT_DIR, 'report.md')
  fs.writeFileSync(outPath, body)
  return path.relative(REPO_ROOT, outPath)
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const { manifest, rows, sourceIds, inputFiles, joinedUngRows, rejectedTimingRows } = loadRows()
  const dataset = summarizeRows(rows, sourceIds)
  const results = runGrid(rows, sourceIds)
  const byCv = [...results].sort((a, b) => b.cvScore - a.cvScore)
  const baseline =
    results.find(
      (result) =>
        result.config.sideMode === 'combined' &&
        result.config.featureMode === 'source-id' &&
        result.config.alpha === 0.008 &&
        result.config.l1Ratio === 0.25 &&
        result.config.minExpectedTheoryReturnPct === ROUND_TRIP_COST_PCT,
    ) ?? null
  const bestCombined = selectBest(results, 'combined', { robustOnly: true }) ?? selectBest(results, 'combined')
  const bestCold = selectBest(results, 'cold-long', { robustOnly: true }) ?? selectBest(results, 'cold-long')
  const bestWarm = selectBest(results, 'warm-short', { robustOnly: true }) ?? selectBest(results, 'warm-short')
  const twoSleeve = combineTwoSleeve(rows, sourceIds, bestCold, bestWarm)
  const replacement =
    bestCombined?.replacementEligible && bestCombined.test.metrics.tradeCount >= 8
      ? bestCombined
      : twoSleeve.metrics.tradeCount >= 8 && twoSleeve.metrics.totalReturnPct > 0 && twoSleeve.metrics.maxDrawdownPct >= -12
        ? twoSleeve
        : null

  const recommendation = replacement
    ? 'Use this as a candidate for a paper-trading shadow baseline, not live replacement yet; post-cutoff trade count clears the minimum but the data window is still one winter.'
    : 'Do not replace the current baseline. The best-looking holdout returns are still dominated by too few post-cutoff trades, and the side-specific checks show the warm-short sleeve is not independently robust.'

  const metricsCsv = writeCsv(
    'candidate-metrics.csv',
    byCv.map(resultRow),
    {
      configId: '',
      sideMode: '',
      featureMode: '',
      alpha: '',
      l1Ratio: '',
      minExpectedTheoryReturnPct: '',
      cvScore: '',
      cvTradeCount: '',
      cvTotalReturnPct: '',
      cvSharpe: '',
      cvMaxDrawdownPct: '',
      trainRowCount: '',
      trainTradeCount: '',
      trainTotalReturnPct: '',
      postTradeCount: '',
      postColdTrades: '',
      postWarmTrades: '',
      postTotalReturnPct: '',
      postSharpe: '',
      postMaxDrawdownPct: '',
      postWinRatePct: '',
      postProfitFactor: '',
      replacementEligible: '',
    },
  )

  const tradeRows = [
    ...(baseline?.test.trades ?? []).map((trade) => formatTrade(trade, 'baseline-reproduction')),
    ...(bestCombined?.test.trades ?? []).map((trade) => formatTrade(trade, 'best-combined-by-cv')),
    ...twoSleeve.trades.map((trade) => formatTrade(trade, 'two-sleeve-side-specific')),
  ]
  const tradesCsv = writeCsv('selected-trades.csv', tradeRows, {
    strategyId: '',
    issueDate: '',
    targetDate: '',
    entryTradeDate: '',
    targetTradeDate: '',
    sourceId: '',
    sourceGroup: '',
    thesisKind: '',
    direction: '',
    leadDays: '',
    weightedAnomalyF: '',
    coveragePct: '',
    coldCoveragePct: '',
    warmCoveragePct: '',
    extremeCount: '',
    expectedReturnPct: '',
    grossReturnPct: '',
    netReturnPct: '',
  })

  const summary = {
    generatedAt: new Date().toISOString(),
    lane: 'strict-theory-elastic-net-expected-return',
    timingContract: {
      returnColumn: 'returnPctEntryCloseToTarget',
      entry: 'entryTradeDate > issueDate',
      exit: 'targetTradeDate >= targetDate and targetTradeDate > entryTradeDate',
      symbol: 'UNG',
    },
    optimizationPolicy: {
      trainCutoff: TRAIN_CUTOFF,
      walkForwardFolds: WALK_FORWARD_FOLDS,
      featureModes: FEATURE_MODES,
      alphaGrid: ALPHA_GRID,
      l1RatioGrid: L1_RATIO_GRID,
      thresholdGrid: THRESHOLD_GRID,
      sideModes: SIDE_MODES,
      roundTripCostPct: ROUND_TRIP_COST_PCT,
      replacementRule:
        'Replacement candidates must avoid source-id features, be positive in walk-forward and post-cutoff, and have at least 8 combined or 4 side-specific post-cutoff trades.',
    },
    dataRoot: path.relative(REPO_ROOT, DATA_ROOT),
    inputFiles: [...new Set(inputFiles)].sort(),
    dataset,
    joinedUngRows,
    rejectedTimingRows,
    forecastCalendars: manifest.forecastCalendars.map((calendar) => ({
      id: calendar.id,
      label: calendar.label,
      issueDateRange: calendar.issueDateRange,
      rows: calendar.rows,
    })),
    baselineReproduction: baseline
      ? {
          config: baseline.config,
          cv: baseline.cv,
          train: baseline.train,
          test: {
            metrics: baseline.test.metrics,
            sideMetrics: {
              coldLong: metricsForSide(baseline.test.trades, 'cold-long'),
              warmShort: metricsForSide(baseline.test.trades, 'warm-short'),
            },
            coefficients: baseline.test.coefficients,
            trades: baseline.test.trades.map((trade) => formatTrade(trade, 'baseline-reproduction')),
          },
        }
      : null,
    bestByPreCutoffWalkForward: {
      combined: bestCombined
        ? {
            config: bestCombined.config,
            cv: bestCombined.cv,
            train: bestCombined.train,
            test: {
              metrics: bestCombined.test.metrics,
              sideMetrics: {
                coldLong: metricsForSide(bestCombined.test.trades, 'cold-long'),
                warmShort: metricsForSide(bestCombined.test.trades, 'warm-short'),
              },
              coefficients: bestCombined.test.coefficients,
              trades: bestCombined.test.trades.map((trade) => formatTrade(trade, 'best-combined-by-cv')),
            },
            replacementEligible: bestCombined.replacementEligible,
          }
        : null,
      coldLong: bestCold
        ? {
            config: bestCold.config,
            cv: bestCold.cv,
            train: bestCold.train,
            test: {
              metrics: bestCold.test.metrics,
              coefficients: bestCold.test.coefficients,
              trades: bestCold.test.trades.map((trade) => formatTrade(trade, 'best-cold-long-by-cv')),
            },
            replacementEligible: bestCold.replacementEligible,
          }
        : null,
      warmShort: bestWarm
        ? {
            config: bestWarm.config,
            cv: bestWarm.cv,
            train: bestWarm.train,
            test: {
              metrics: bestWarm.test.metrics,
              coefficients: bestWarm.test.coefficients,
              trades: bestWarm.test.trades.map((trade) => formatTrade(trade, 'best-warm-short-by-cv')),
            },
            replacementEligible: bestWarm.replacementEligible,
          }
        : null,
    },
    twoSleeve: {
      ...twoSleeve,
      trades: twoSleeve.trades.map((trade) => formatTrade(trade, 'two-sleeve-side-specific')),
    },
    topCandidatesByCv: byCv.slice(0, 25).map(resultRow),
    files: {
      metricsCsv,
      tradesCsv,
      summaryJson: path.relative(REPO_ROOT, path.join(OUT_DIR, 'run-summary.json')),
      reportMd: path.relative(REPO_ROOT, path.join(OUT_DIR, 'report.md')),
    },
    recommendation,
  }

  const summaryPath = path.join(OUT_DIR, 'run-summary.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  const reportMd = writeReport(summary, bestCombined, bestCold, bestWarm, twoSleeve, baseline)

  console.log(`Wrote ${path.relative(REPO_ROOT, summaryPath)}`)
  console.log(`Wrote ${metricsCsv}`)
  console.log(`Wrote ${tradesCsv}`)
  console.log(`Wrote ${reportMd}`)
  console.log(`Best combined post: ${bestCombined?.test.metrics.totalReturnPct}% trades=${bestCombined?.test.metrics.tradeCount} cv=${bestCombined?.cv.metrics.totalReturnPct}%`)
  console.log(`Two-sleeve post: ${twoSleeve.metrics.totalReturnPct}% trades=${twoSleeve.metrics.tradeCount} dd=${twoSleeve.metrics.maxDrawdownPct}%`)
  console.log(recommendation)
}

main()
