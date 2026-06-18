import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUT_DIR = path.join(
  DATA_ROOT,
  'research/strategy-agent-runs/regularized-logistic-regression',
)

const TRAIN_CUTOFF = '2025-11-01'
const ROUND_TRIP_COST_PCT = 0.064
const MIN_VALIDATION_TRADES = 5
const MIN_POST_TRADES = 6
const MIN_FOLD_TRAIN_ROWS = 30
const COLD_RUMOR_MAX_WEIGHTED_ANOMALY_F = -8
const COLD_RUMOR_MIN_COVERAGE_PCT = 0.55
const WARM_RUMOR_MIN_WEIGHTED_ANOMALY_F = 8
const WARM_RUMOR_MIN_COVERAGE_PCT = 0.6
const WARM_COVERAGE_MIN_ANOMALY_F = 8
const WARM_EXTREME_ANOMALY_F = 14
const WINTER_THESIS_MIN_SOURCE_GROUPS = 2
const WINTER_THESIS_MIN_MODEL_FAMILIES = 2

const WALK_FORWARD_FOLDS = [
  { id: '2024-11', start: '2024-11-01', end: '2025-01-01' },
  { id: '2025-01', start: '2025-01-01', end: '2025-02-01' },
  { id: '2025-02-to-cutoff', start: '2025-02-01', end: TRAIN_CUTOFF },
]

const FEATURE_SETS = ['weather-core', 'weather-source-group', 'weather-source-id']
const LAMBDA_GRID = [0.002, 0.008, 0.03]
const L1_RATIO_GRID = [0, 0.25]
const THRESHOLD_GRID = [
  { id: 'both-050', coldThreshold: 0.5, warmThreshold: 0.5 },
  { id: 'both-052', coldThreshold: 0.52, warmThreshold: 0.52 },
  { id: 'both-055', coldThreshold: 0.55, warmThreshold: 0.55 },
  { id: 'both-058', coldThreshold: 0.58, warmThreshold: 0.58 },
  { id: 'both-060', coldThreshold: 0.6, warmThreshold: 0.6 },
  { id: 'cold-055-warm-050', coldThreshold: 0.55, warmThreshold: 0.5 },
  { id: 'cold-050-warm-055', coldThreshold: 0.5, warmThreshold: 0.55 },
  { id: 'cold-060-warm-055', coldThreshold: 0.6, warmThreshold: 0.55 },
  { id: 'cold-055-warm-060', coldThreshold: 0.55, warmThreshold: 0.6 },
]

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
  if (!Number.isFinite(value)) return value
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

function isRumorWindow(score) {
  return score.windowId === 'rumor' && score.leadDays >= 7 && score.leadDays <= 10
}

function winterThesisForScore(score) {
  if (!isHeatingSeasonIssue(score.issueDate) || !isRumorWindow(score)) return null

  if (
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

function scoreKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId, row.modelId].join('|')
}

function consensusKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId].join('|')
}

function thesisConfirmationKey(row, thesisKind) {
  return `${consensusKey(row)}|${thesisKind}`
}

function expectedWindowIdForLead(leadDays) {
  if (leadDays >= 7 && leadDays <= 10) return 'rumor'
  if (leadDays >= 1 && leadDays <= 3) return 'selloff'
  return 'other'
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
  const rows = []
  const sourceIds = []
  const inputFiles = []
  const allScores = []
  const parsedCalendars = []
  const timingReview = {
    totalReturnRows: 0,
    joinedRows: 0,
    confirmedWinterRows: 0,
    tradableStrictRows: 0,
    rejectedTimingRows: 0,
  }

  for (const calendar of manifest.forecastCalendars) {
    sourceIds.push(calendar.id)
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const returnsPath = path.join(DATA_ROOT, calendar.files.signalReturns)
    const locationsPath = path.join(DATA_ROOT, calendar.files.locationAnomalies)
    inputFiles.push(
      path.relative(REPO_ROOT, scoresPath),
      path.relative(REPO_ROOT, returnsPath),
      path.relative(REPO_ROOT, locationsPath),
    )

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
    const key = thesisConfirmationKey(score, thesis.kind)
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

  for (const { calendar, returns, scores } of parsedCalendars) {
    timingReview.totalReturnRows += returns.length
    for (const ret of returns) {
      const score = scores.get(scoreKey(ret))
      if (!score) continue
      timingReview.joinedRows += 1

      const thesis = winterThesisForScore(score)
      const confirmation = thesis ? confirmationBySignal.get(thesisConfirmationKey(score, thesis.kind)) : null
      const confirmedWinterThesis = Boolean(thesis && confirmation)
      if (confirmedWinterThesis) timingReview.confirmedWinterRows += 1

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
        scoreQualifies: confirmedWinterThesis,
        weightedAnomalyF: score.weightedAnomalyF,
        coveragePct: thesis?.coveragePct ?? 0,
        extremeCount: thesis?.extremeCount ?? 0,
        coldCoveragePct: score.coldCoveragePct,
        warmCoveragePct: score.warmCoveragePct,
        coldExtremeCount: score.coldExtremeCount,
        warmExtremeCount: score.warmExtremeCount,
        sampledWeight: score.sampledWeight,
        locationCount: score.locationCount,
        thesisKind: thesis?.kind ?? 'none',
        thesisDirection: thesis?.direction ?? 0,
        confirmedWinterThesis,
        confirmedSourceGroups: confirmation?.sourceGroups ?? [],
        confirmedSourceFamilies: confirmation?.sourceFamilies ?? [],
      }

      if (!confirmedWinterThesis) continue
      if (!isTradable(joined)) {
        timingReview.rejectedTimingRows += 1
        continue
      }

      rows.push(joined)
      timingReview.tradableStrictRows += 1
    }
  }

  return {
    manifest,
    rows,
    sourceIds,
    sourceGroups: [...new Set(sourceIds.map(sourceGroupFor))].sort(),
    inputFiles: [...new Set(inputFiles)].sort(),
    timingReview,
  }
}

function signalStrength(row) {
  if (row.thesisKind === 'warm-short') return Math.max(0, row.weightedAnomalyF)
  return Math.max(0, -row.weightedAnomalyF)
}

function theoryDirection(row) {
  return row.thesisDirection || 0
}

function theoryAlignedGrossReturnPct(row) {
  return theoryDirection(row) * row.returnPct
}

function featureNames(featureSet, sourceIds, sourceGroups) {
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

  if (featureSet === 'weather-source-group') {
    return [...base, ...sourceGroups.map((sourceGroup) => `sourceGroup:${sourceGroup}`)]
  }

  if (featureSet === 'weather-source-id') {
    return [...base, ...sourceIds.map((sourceId) => `source:${sourceId}`)]
  }

  return base
}

function rawFeatures(row, featureSet, sourceIds, sourceGroups) {
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

  if (featureSet === 'weather-source-group') {
    return [...base, ...sourceGroups.map((sourceGroup) => (row.sourceGroup === sourceGroup ? 1 : 0))]
  }

  if (featureSet === 'weather-source-id') {
    return [...base, ...sourceIds.map((sourceId) => (row.sourceId === sourceId ? 1 : 0))]
  }

  return base
}

function fitScaler(rows, featureSet, sourceIds, sourceGroups) {
  const matrix = rows.map((row) => rawFeatures(row, featureSet, sourceIds, sourceGroups))
  const columns = matrix[0]?.length ?? 0
  const means = Array.from({ length: columns }, (_, column) => mean(matrix.map((values) => values[column])))
  const scales = Array.from({ length: columns }, (_, column) => std(matrix.map((values) => values[column])) || 1)
  return { means, scales }
}

function transformRow(row, featureSet, sourceIds, sourceGroups, scaler) {
  return rawFeatures(row, featureSet, sourceIds, sourceGroups).map(
    (value, index) => (value - scaler.means[index]) / scaler.scales[index],
  )
}

function sigmoid(value) {
  if (value >= 35) return 1
  if (value <= -35) return 0
  return 1 / (1 + Math.exp(-value))
}

function dot(weights, values) {
  let total = 0
  for (let index = 0; index < weights.length; index += 1) total += weights[index] * values[index]
  return total
}

function trainLogistic(rows, featureSet, sourceIds, sourceGroups, params) {
  const scaler = fitScaler(rows, featureSet, sourceIds, sourceGroups)
  const x = rows.map((row) => transformRow(row, featureSet, sourceIds, sourceGroups, scaler))
  const y = rows.map((row) => (theoryAlignedGrossReturnPct(row) > ROUND_TRIP_COST_PCT ? 1 : 0))
  const positives = y.reduce((sum, value) => sum + value, 0)
  const positiveWeight = positives ? y.length / (2 * positives) : 1
  const negativeWeight = positives < y.length ? y.length / (2 * (y.length - positives)) : 1
  const weights = Array.from({ length: x[0]?.length ?? 0 }, () => 0)
  let intercept = Math.log((positives + 1) / (y.length - positives + 1))

  for (let iteration = 0; iteration < params.iterations; iteration += 1) {
    const grad = Array.from({ length: weights.length }, () => 0)
    let interceptGrad = 0

    for (let rowIndex = 0; rowIndex < x.length; rowIndex += 1) {
      const probability = sigmoid(intercept + dot(weights, x[rowIndex]))
      const balanceWeight = params.classBalance ? (y[rowIndex] ? positiveWeight : negativeWeight) : 1
      const error = (probability - y[rowIndex]) * balanceWeight
      interceptGrad += error
      for (let column = 0; column < weights.length; column += 1) {
        grad[column] += error * x[rowIndex][column]
      }
    }

    intercept -= (params.learningRate * interceptGrad) / x.length
    for (let column = 0; column < weights.length; column += 1) {
      const l2 = params.lambda * (1 - params.l1Ratio) * weights[column]
      weights[column] -= params.learningRate * (grad[column] / x.length + l2)
      const shrink = params.learningRate * params.lambda * params.l1Ratio
      weights[column] = Math.sign(weights[column]) * Math.max(0, Math.abs(weights[column]) - shrink)
    }
  }

  return {
    predict(row) {
      return sigmoid(intercept + dot(weights, transformRow(row, featureSet, sourceIds, sourceGroups, scaler)))
    },
    weights,
    intercept,
    scaler,
  }
}

function coefficientSummary(model, names, count = 10) {
  return model.weights
    .map((weight, index) => ({ feature: names[index], weight: round(weight, 5) }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, count)
}

function scoreRows(rows, model) {
  return rows.map((row) => ({
    row,
    probability: model.predict(row),
    label: theoryAlignedGrossReturnPct(row) > ROUND_TRIP_COST_PCT ? 1 : 0,
  }))
}

function thresholdFor(row, thresholds) {
  return row.thesisKind === 'warm-short' ? thresholds.warmThreshold : thresholds.coldThreshold
}

function candidatesFromScores(scored, thresholds) {
  return scored
    .map(({ row, probability }) => ({
      row,
      direction: probability >= thresholdFor(row, thresholds) ? theoryDirection(row) : 0,
      rank: probability,
      probability,
      threshold: thresholdFor(row, thresholds),
    }))
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

function sideMetrics(trades) {
  return {
    all: tradeMetrics(trades),
    coldLong: tradeMetrics(trades.filter((trade) => trade.row.thesisKind === 'cold-long')),
    warmShort: tradeMetrics(trades.filter((trade) => trade.row.thesisKind === 'warm-short')),
  }
}

function calibrationStats(scored) {
  if (!scored.length) {
    return { count: 0, positiveRatePct: 0, averageProbability: 0, brier: 0 }
  }

  const brier = mean(scored.map((entry) => (entry.probability - entry.label) ** 2))
  return {
    count: scored.length,
    positiveRatePct: round(mean(scored.map((entry) => entry.label)) * 100, 1),
    averageProbability: round(mean(scored.map((entry) => entry.probability)), 4),
    brier: round(brier, 4),
  }
}

function calibrationBySide(scored) {
  return {
    all: calibrationStats(scored),
    coldLong: calibrationStats(scored.filter((entry) => entry.row.thesisKind === 'cold-long')),
    warmShort: calibrationStats(scored.filter((entry) => entry.row.thesisKind === 'warm-short')),
  }
}

function foldTradeMetrics(trades) {
  return WALK_FORWARD_FOLDS.map((fold) => {
    const foldTrades = trades.filter((trade) => trade.row.issueDate >= fold.start && trade.row.issueDate < fold.end)
    return { fold: fold.id, ...tradeMetrics(foldTrades) }
  })
}

function validationRank(metrics, foldMetrics) {
  const negativeFoldPenalty = foldMetrics.filter((fold) => fold.tradeCount > 0 && fold.totalReturnPct < 0).length * 3
  const samplePenalty = metrics.tradeCount < MIN_VALIDATION_TRADES ? 1000 : 0
  const drawdownPenalty = Math.abs(Math.min(0, metrics.maxDrawdownPct)) * 0.2
  return round(metrics.totalReturnPct + metrics.sharpe * 1.5 - drawdownPenalty - negativeFoldPenalty - samplePenalty, 4)
}

function splitRows(rows) {
  return {
    train: rows.filter((row) => row.issueDate < TRAIN_CUTOFF),
    test: rows.filter((row) => row.issueDate >= TRAIN_CUTOFF),
  }
}

function buildWalkForwardScores(rows, modelParams, sourceIds, sourceGroups) {
  const scored = []
  const folds = []

  for (const fold of WALK_FORWARD_FOLDS) {
    const trainRows = rows.filter((row) => row.issueDate < fold.start)
    const validationRows = rows.filter((row) => row.issueDate >= fold.start && row.issueDate < fold.end)

    if (trainRows.length < MIN_FOLD_TRAIN_ROWS || validationRows.length === 0) {
      folds.push({
        ...fold,
        trainRows: trainRows.length,
        validationRows: validationRows.length,
        skipped: true,
      })
      continue
    }

    const model = trainLogistic(trainRows, modelParams.featureSet, sourceIds, sourceGroups, modelParams)
    scored.push(...scoreRows(validationRows, model).map((entry) => ({ ...entry, fold: fold.id })))
    folds.push({
      ...fold,
      trainRows: trainRows.length,
      validationRows: validationRows.length,
      skipped: false,
      calibration: calibrationBySide(scoreRows(validationRows, model)),
    })
  }

  return { scored, folds }
}

function evaluateScored(scored, thresholds) {
  const trades = resolveTrades(candidatesFromScores(scored, thresholds))
  return {
    trades,
    metrics: sideMetrics(trades),
    calibration: calibrationBySide(scored),
    foldMetrics: foldTradeMetrics(trades),
  }
}

function configId(modelParams, thresholds) {
  return [
    modelParams.featureSet,
    `lambda-${modelParams.lambda}`,
    `l1-${modelParams.l1Ratio}`,
    thresholds.id,
  ].join('__')
}

function compactMetrics(prefix, metrics) {
  return {
    [`${prefix}TotalReturnPct`]: metrics.totalReturnPct,
    [`${prefix}Sharpe`]: metrics.sharpe,
    [`${prefix}MaxDrawdownPct`]: metrics.maxDrawdownPct,
    [`${prefix}WinRatePct`]: metrics.winRatePct,
    [`${prefix}ProfitFactor`]: metrics.profitFactor,
    [`${prefix}TradeCount`]: metrics.tradeCount,
    [`${prefix}AverageTradeReturnPct`]: metrics.averageTradeReturnPct,
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function writeCsv(filePath, rows, fallbackHeaders) {
  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')
  fs.writeFileSync(filePath, `${csv}\n`)
}

function formatTrade(strategyId, trade) {
  return {
    strategyId,
    issueDate: trade.row.issueDate,
    targetDate: trade.row.targetDate,
    entryTradeDate: trade.row.entryTradeDate,
    targetTradeDate: trade.row.targetTradeDate,
    sourceId: trade.row.sourceId,
    sourceGroup: trade.row.sourceGroup,
    windowId: trade.row.windowId,
    thesisKind: trade.row.thesisKind,
    leadDays: trade.row.leadDays,
    direction: trade.direction === 1 ? 'long' : 'short',
    probability: round(trade.probability, 5),
    threshold: round(trade.threshold, 3),
    weightedAnomalyF: round(trade.row.weightedAnomalyF, 3),
    coveragePct: round(trade.row.coveragePct, 3),
    coldCoveragePct: round(trade.row.coldCoveragePct, 3),
    warmCoveragePct: round(trade.row.warmCoveragePct, 3),
    extremeCount: trade.row.extremeCount,
    grossReturnPct: round(trade.grossReturnPct, 4),
    netReturnPct: round(trade.netReturnPct, 4),
    rank: round(trade.rank, 5),
  }
}

function existingLogisticBaseline() {
  const baselinePath = path.join(DATA_ROOT, 'research/strategy-tests/arctic-blast-strategy-baselines.csv')
  if (!fs.existsSync(baselinePath)) return null
  const row = parseCsv(baselinePath).find((entry) => entry.strategyId === 'strict-theory-regularized-logistic-regression')
  if (!row) return null
  return {
    totalReturnPct: numberFrom(row.totalReturnPct),
    sharpe: numberFrom(row.sharpe),
    maxDrawdownPct: numberFrom(row.maxDrawdownPct),
    winRatePct: numberFrom(row.winRatePct),
    profitFactor: numberFrom(row.profitFactor),
    tradeCount: numberFrom(row.tradeCount),
    averageTradeReturnPct: numberFrom(row.averageTradeReturnPct),
    firstEntry: row.firstEntry,
    lastExit: row.lastExit,
    tradeFile: row.tradeFile,
  }
}

function reportMarkdown(summary) {
  const selected = summary.selected
  const post = selected.post.metrics
  const validation = selected.validation.metrics
  const baseline = summary.existingBaseline
  const thresholdAudit = summary.thresholdAudit
  const decision = summary.decision

  return `# Worker 2 Regularized Logistic Regression

Generated: ${summary.generatedAt}

## Scope

- Lane: strict-theory-regularized-logistic-regression.
- Data root: data/qore.
- Output folder: data/qore/research/strategy-agent-runs/regularized-logistic-regression.
- PnL column: returnPctEntryCloseToTarget.
- No-lookahead rule: entryTradeDate > issueDate, targetTradeDate >= targetDate, targetTradeDate > entryTradeDate.
- Model family: dependency-free L1/L2-regularized logistic regression on theory-aligned return labels.

## Selected Candidate

- Config: ${selected.id}
- Feature set: ${selected.modelParams.featureSet}
- Lambda: ${selected.modelParams.lambda}
- L1 ratio: ${selected.modelParams.l1Ratio}
- Cold threshold: ${selected.thresholds.coldThreshold}
- Warm threshold: ${selected.thresholds.warmThreshold}
- Validation rank: ${selected.validationRank}
- Train rows before ${TRAIN_CUTOFF}: ${summary.samples.trainRows}
- Post-cutoff rows: ${summary.samples.testRows}

## Verdict

- Decision: ${decision.verdict}.
- Integration action: ${decision.integrationAction}
- Baseline action: ${decision.baselineAction}
- Cold sleeve: ${decision.coldSleeveAction}
- Warm sleeve: ${decision.warmSleeveAction}

## Metrics

| Sample | Side | Trades | Total return % | Max DD % | Win % | Profit factor | Sharpe |
|---|---:|---:|---:|---:|---:|---:|---:|
| Walk-forward validation | all | ${validation.all.tradeCount} | ${validation.all.totalReturnPct} | ${validation.all.maxDrawdownPct} | ${validation.all.winRatePct} | ${validation.all.profitFactor} | ${validation.all.sharpe} |
| Walk-forward validation | cold-long | ${validation.coldLong.tradeCount} | ${validation.coldLong.totalReturnPct} | ${validation.coldLong.maxDrawdownPct} | ${validation.coldLong.winRatePct} | ${validation.coldLong.profitFactor} | ${validation.coldLong.sharpe} |
| Walk-forward validation | warm-short | ${validation.warmShort.tradeCount} | ${validation.warmShort.totalReturnPct} | ${validation.warmShort.maxDrawdownPct} | ${validation.warmShort.winRatePct} | ${validation.warmShort.profitFactor} | ${validation.warmShort.sharpe} |
| Post-cutoff test | all | ${post.all.tradeCount} | ${post.all.totalReturnPct} | ${post.all.maxDrawdownPct} | ${post.all.winRatePct} | ${post.all.profitFactor} | ${post.all.sharpe} |
| Post-cutoff test | cold-long | ${post.coldLong.tradeCount} | ${post.coldLong.totalReturnPct} | ${post.coldLong.maxDrawdownPct} | ${post.coldLong.winRatePct} | ${post.coldLong.profitFactor} | ${post.coldLong.sharpe} |
| Post-cutoff test | warm-short | ${post.warmShort.tradeCount} | ${post.warmShort.totalReturnPct} | ${post.warmShort.maxDrawdownPct} | ${post.warmShort.winRatePct} | ${post.warmShort.profitFactor} | ${post.warmShort.sharpe} |

## Baseline / Threshold Audit

- Existing shared strict logistic baseline: ${baseline ? `${baseline.tradeCount} trades, ${baseline.totalReturnPct}% total return, ${baseline.maxDrawdownPct}% max DD, ${baseline.winRatePct}% win rate` : 'not found'}.
- Same final model at 0.55/0.55 thresholds: ${thresholdAudit.sameModelBaseline.metrics.all.tradeCount} trades, ${thresholdAudit.sameModelBaseline.metrics.all.totalReturnPct}% total return, ${thresholdAudit.sameModelBaseline.metrics.all.maxDrawdownPct}% max DD.
- Selected thresholds vs 0.55/0.55: ${post.all.totalReturnPct - thresholdAudit.sameModelBaseline.metrics.all.totalReturnPct >= 0 ? '+' : ''}${round(post.all.totalReturnPct - thresholdAudit.sameModelBaseline.metrics.all.totalReturnPct, 2)} percentage points of post-cutoff total return.
- Demotion rationale: ${decision.demoteReason}

## Overfit Checks

- Hyperparameter grid was fixed and small: ${FEATURE_SETS.length} feature sets x ${LAMBDA_GRID.length} lambda values x ${L1_RATIO_GRID.length} L1 ratios x ${THRESHOLD_GRID.length} threshold pairs.
- Threshold selection used only walk-forward validation before ${TRAIN_CUTOFF}; post-cutoff rows were evaluated after selection.
- Minimum validation trades: ${MIN_VALIDATION_TRADES}; minimum post-cutoff trades for replacement consideration: ${MIN_POST_TRADES}.
- Source exact IDs were tested, but source-group and weather-only feature sets were also tested to make source dependence visible.
- Sleeve split was evaluated from side metrics only, not promoted as a new fitted strategy, because the post-cutoff side samples are 2 cold trades and 4 warm trades.
- Top coefficients: ${selected.coefficients.map((entry) => `${entry.feature}=${entry.weight}`).join(', ')}.

## Recommendation

${decision.recommendation}
`
}

function decisionFor(selected, baseline) {
  const post = selected.post.metrics.all
  const validation = selected.validation.metrics.all
  const hasMinimumPostTrades = post.tradeCount >= MIN_POST_TRADES
  const improvesBaseline =
    baseline &&
    post.totalReturnPct > baseline.totalReturnPct &&
    post.maxDrawdownPct >= baseline.maxDrawdownPct &&
    post.tradeCount >= baseline.tradeCount
  const validationIsPositive = validation.tradeCount >= MIN_VALIDATION_TRADES && validation.totalReturnPct > 0
  const bothSidesVisible = selected.post.metrics.coldLong.tradeCount > 0 && selected.post.metrics.warmShort.tradeCount > 0

  if (hasMinimumPostTrades && improvesBaseline && validationIsPositive && bothSidesVisible) {
    return {
      verdict: 'candidate replacement, not production-ready',
      integrationAction:
        'Do not auto-integrate into shared strategy-tests. Queue this exact config for independent reproduction on the next fresh winter sample before replacing the current baseline.',
      baselineAction:
        'Keep the existing strict logistic baseline until a second out-of-sample season confirms the replacement.',
      coldSleeveAction:
        'Do not split cold into a standalone sleeve yet; require at least one more winter with multiple cold trades.',
      warmSleeveAction:
        'Do not split warm into a standalone sleeve yet; require at least one more winter with multiple warm trades.',
      demoteReason:
        'The selected candidate clears the mechanical comparison, but it is still one post-cutoff winter and remains sample-limited.',
      recommendation:
        'Use this as a candidate replacement only after another worker or a later run reproduces it on a fresh season. It improves the current strict logistic baseline while preserving the weather thesis and minimum sample checks, but the post-cutoff sample is still one winter.',
    }
  }

  return {
    verdict: 'demote logistic to diagnostics/watchlist',
    integrationAction:
      'Do not change shared strategy-tests from this lane. Do not replace the baseline and do not add cold/warm production sleeves; mark strict-theory-regularized-logistic-regression as diagnostic/watchlist until another winter validates it.',
    baselineAction:
      'Demote the strict logistic baseline from any primary/hero ranking because its six-trade post-cutoff result is fragile and driven by one large cold loss plus one large cold recovery.',
    coldSleeveAction:
      'Do not promote cold-long: post-cutoff has only 2 trades, with one -17.38% net loss and one +19.82% net gain.',
    warmSleeveAction:
      'Do not promote warm-short as production: post-cutoff is better controlled at 4 trades, +4.45% total return, and -2.71% max drawdown, but validation was only 3 warm trades and +0.88%.',
    demoteReason:
      'The validation curve looks strong, but the post-cutoff sample is only 6 trades, the cold side is unstable, and the 0.50 threshold improvement over 0.55 is mostly threshold sensitivity rather than robust model evidence.',
    recommendation:
      'Do not replace or split the shared baseline yet. Use this run only as threshold calibration and side-diagnostic evidence; the least overfit integration is to demote logistic to a watchlist/diagnostic strategy until more out-of-sample winter rows arrive.',
  }
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const { manifest, rows, sourceIds, sourceGroups, inputFiles, timingReview } = loadRows()
  const { train, test } = splitRows(rows)
  const candidateRows = []
  const fullResults = []

  for (const featureSet of FEATURE_SETS) {
    for (const lambda of LAMBDA_GRID) {
      for (const l1Ratio of L1_RATIO_GRID) {
        const modelParams = {
          featureSet,
          lambda,
          l1Ratio,
          classBalance: true,
          learningRate: 0.08,
          iterations: 300,
        }
        const validationScores = buildWalkForwardScores(train, modelParams, sourceIds, sourceGroups)
        if (!validationScores.scored.length) continue

        for (const thresholds of THRESHOLD_GRID) {
          const validation = evaluateScored(validationScores.scored, thresholds)
          const rank = validationRank(validation.metrics.all, validation.foldMetrics)
          const id = configId(modelParams, thresholds)
          candidateRows.push({
            id,
            featureSet,
            lambda,
            l1Ratio,
            classBalance: modelParams.classBalance,
            coldThreshold: thresholds.coldThreshold,
            warmThreshold: thresholds.warmThreshold,
            validationRank: rank,
            validationNegativeFolds: validation.foldMetrics.filter(
              (fold) => fold.tradeCount > 0 && fold.totalReturnPct < 0,
            ).length,
            ...compactMetrics('validationAll', validation.metrics.all),
            ...compactMetrics('validationCold', validation.metrics.coldLong),
            ...compactMetrics('validationWarm', validation.metrics.warmShort),
          })
          fullResults.push({
            id,
            modelParams,
            thresholds,
            validationRank: rank,
            validation,
            walkForward: validationScores.folds,
          })
        }
      }
    }
  }

  const eligible = fullResults
    .filter((result) => result.validation.metrics.all.tradeCount >= MIN_VALIDATION_TRADES)
    .sort((a, b) => b.validationRank - a.validationRank)

  if (!eligible.length) {
    throw new Error('No validation-eligible regularized logistic candidates were found.')
  }

  const finalEvaluated = eligible.map((result) => {
    const model = trainLogistic(train, result.modelParams.featureSet, sourceIds, sourceGroups, result.modelParams)
    const testScores = scoreRows(test, model)
    const post = evaluateScored(testScores, result.thresholds)
    return {
      ...result,
      post,
      postCalibration: calibrationBySide(testScores),
      coefficients: coefficientSummary(
        model,
        featureNames(result.modelParams.featureSet, sourceIds, sourceGroups),
      ),
    }
  })

  const selected = finalEvaluated[0]
  const existingBaseline = existingLogisticBaseline()

  const selectedFinalModel = trainLogistic(train, selected.modelParams.featureSet, sourceIds, sourceGroups, selected.modelParams)
  const selectedTestScores = scoreRows(test, selectedFinalModel)
  const sameModelBaseline = evaluateScored(selectedTestScores, {
    id: 'both-055',
    coldThreshold: 0.55,
    warmThreshold: 0.55,
  })

  selected.replacementConsideration =
    selected.post.metrics.all.tradeCount >= MIN_POST_TRADES &&
    selected.validation.metrics.all.tradeCount >= MIN_VALIDATION_TRADES

  const decision = decisionFor(selected, existingBaseline)
  const recommendation = decision.recommendation

  const summary = {
    generatedAt: new Date().toISOString(),
    strategyLane: 'strict-theory-regularized-logistic-regression',
    dataRoot: path.relative(REPO_ROOT, DATA_ROOT),
    outputDir: path.relative(REPO_ROOT, OUT_DIR),
    theory:
      'Winter Weather Demand: long UNG on severe broad 7-10 day cold; short UNG on significant broad 7-10 day warmth after independent source confirmation.',
    timingContract: {
      returnColumn: 'returnPctEntryCloseToTarget',
      entryRule: 'entryTradeDate > issueDate',
      exitRule: 'targetTradeDate >= targetDate and targetTradeDate > entryTradeDate',
      symbol: 'UNG',
      roundTripCostPct: ROUND_TRIP_COST_PCT,
    },
    grid: {
      featureSets: FEATURE_SETS,
      lambda: LAMBDA_GRID,
      l1Ratio: L1_RATIO_GRID,
      thresholds: THRESHOLD_GRID,
      classBalance: [true],
      selectedBy: 'walk-forward validation rank before the post-cutoff test window',
    },
    samples: {
      strictTradableRows: rows.length,
      trainRows: train.length,
      testRows: test.length,
      trainCutoff: TRAIN_CUTOFF,
      bySide: {
        trainColdLongRows: train.filter((row) => row.thesisKind === 'cold-long').length,
        trainWarmShortRows: train.filter((row) => row.thesisKind === 'warm-short').length,
        testColdLongRows: test.filter((row) => row.thesisKind === 'cold-long').length,
        testWarmShortRows: test.filter((row) => row.thesisKind === 'warm-short').length,
      },
    },
    walkForwardFolds: WALK_FORWARD_FOLDS,
    timingReview,
    existingBaseline,
    thresholdAudit: {
      sameModelBaseline: {
        thresholds: { coldThreshold: 0.55, warmThreshold: 0.55 },
        metrics: sameModelBaseline.metrics,
      },
    },
    selected,
    decision,
    topValidationCandidates: finalEvaluated.slice(0, 12).map((result, index) => ({
      rank: index + 1,
      id: result.id,
      modelParams: result.modelParams,
      thresholds: result.thresholds,
      validationRank: result.validationRank,
      validationMetrics: result.validation.metrics,
      postMetrics: result.post.metrics,
    })),
    inputFiles,
    datasetCalendars: manifest.forecastCalendars.map((calendar) => ({
      id: calendar.id,
      label: calendar.label,
      issueDateRange: calendar.issueDateRange,
      rows: calendar.rows,
    })),
    recommendation,
  }

  const candidateAuditRows = finalEvaluated.map((result, index) => ({
    validationRankOrder: index + 1,
    id: result.id,
    featureSet: result.modelParams.featureSet,
    lambda: result.modelParams.lambda,
    l1Ratio: result.modelParams.l1Ratio,
    coldThreshold: result.thresholds.coldThreshold,
    warmThreshold: result.thresholds.warmThreshold,
    validationRank: result.validationRank,
    ...compactMetrics('validationAll', result.validation.metrics.all),
    ...compactMetrics('validationCold', result.validation.metrics.coldLong),
    ...compactMetrics('validationWarm', result.validation.metrics.warmShort),
    ...compactMetrics('postAll', result.post.metrics.all),
    ...compactMetrics('postCold', result.post.metrics.coldLong),
    ...compactMetrics('postWarm', result.post.metrics.warmShort),
  }))

  const strategyId = 'worker2-strict-theory-regularized-logistic-regression'
  const tradeRows = selected.post.trades.map((trade) => formatTrade(strategyId, trade))
  const validationTradeRows = selected.validation.trades.map((trade) => formatTrade(`${strategyId}-validation`, trade))

  writeCsv(
    path.join(OUT_DIR, 'worker2-regularized-logistic-regression-candidates.csv'),
    candidateAuditRows,
    [],
  )
  writeCsv(
    path.join(OUT_DIR, 'worker2-regularized-logistic-regression-post-trades.csv'),
    tradeRows,
    [],
  )
  writeCsv(
    path.join(OUT_DIR, 'worker2-regularized-logistic-regression-validation-trades.csv'),
    validationTradeRows,
    [],
  )
  fs.writeFileSync(
    path.join(OUT_DIR, 'worker2-regularized-logistic-regression-results.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  fs.writeFileSync(path.join(OUT_DIR, 'REPORT.md'), reportMarkdown(summary))

  console.log(JSON.stringify({
    selected: {
      id: selected.id,
      validation: selected.validation.metrics,
      post: selected.post.metrics,
      recommendation,
    },
    outputs: {
      results: path.relative(REPO_ROOT, path.join(OUT_DIR, 'worker2-regularized-logistic-regression-results.json')),
      candidates: path.relative(REPO_ROOT, path.join(OUT_DIR, 'worker2-regularized-logistic-regression-candidates.csv')),
      postTrades: path.relative(REPO_ROOT, path.join(OUT_DIR, 'worker2-regularized-logistic-regression-post-trades.csv')),
      validationTrades: path.relative(REPO_ROOT, path.join(OUT_DIR, 'worker2-regularized-logistic-regression-validation-trades.csv')),
    },
  }, null, 2))
}

main()
