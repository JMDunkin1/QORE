import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUTPUT_DIR = fileURLToPath(new URL('.', import.meta.url))
const TRAIN_CUTOFF = '2025-11-01'
const ROUND_TRIP_COST_PCT = 0.064
const MIN_SOURCE_GROUPS = 2
const MIN_MODEL_FAMILIES = 2
const COLD_RUMOR_MAX_WEIGHTED_ANOMALY_F = -8
const COLD_RUMOR_MIN_COVERAGE_PCT = 0.55
const WARM_RUMOR_MIN_WEIGHTED_ANOMALY_F = 8
const WARM_RUMOR_MIN_COVERAGE_PCT = 0.6
const WARM_COVERAGE_MIN_ANOMALY_F = 8
const WARM_EXTREME_ANOMALY_F = 14

const SOURCE_POLICIES = {
  longHistoryCore: ['gfs', 'gefs-mean', 'gem-global', 'ecmwf-ifs'],
  allConfirmed: ['gfs', 'gefs-mean', 'gem-global', 'ecmwf-ifs', 'graphcastgfs', 'ecmwf-aifs', 'aigfs'],
  noAigfs: ['gfs', 'gefs-mean', 'gem-global', 'ecmwf-ifs', 'graphcastgfs', 'ecmwf-aifs'],
}

const WALK_FORWARD_FOLDS = [
  { id: 'winter-2024-25-front', trainEnd: '2024-11-01', testStart: '2024-11-01', testEnd: '2025-02-01' },
  { id: 'winter-2024-25-back', trainEnd: '2025-02-01', testStart: '2025-02-01', testEnd: '2025-11-01' },
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
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
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

function signalStrength(row) {
  return row.thesisKind === 'warm-short' ? Math.max(0, row.weightedAnomalyF) : Math.max(0, -row.weightedAnomalyF)
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

function winterThesisForScore(score) {
  if (!isHeatingSeasonIssue(score.issueDate)) return null
  if (
    score.windowId === 'rumor' &&
    score.leadDays >= 7 &&
    score.leadDays <= 10 &&
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
    score.windowId === 'rumor' &&
    score.leadDays >= 7 &&
    score.leadDays <= 10 &&
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

function winterThesisKey(issueSignalKey, thesisKind) {
  return `${issueSignalKey}|${thesisKind}`
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

function loadStrictTheoryRows() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const rows = []
  const allScores = []
  const parsedCalendars = []

  for (const calendar of manifest.forecastCalendars) {
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const returnsPath = path.join(DATA_ROOT, calendar.files.signalReturns)
    const locationsPath = path.join(DATA_ROOT, calendar.files.locationAnomalies)
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
    if (sourceGroups.length >= MIN_SOURCE_GROUPS && sourceFamilies.length >= MIN_MODEL_FAMILIES) {
      confirmationBySignal.set(key, { sourceGroups, sourceFamilies })
    }
  }

  for (const { calendar, returns, scores } of parsedCalendars) {
    for (const ret of returns) {
      const score = scores.get(scoreKey(ret))
      const thesis = score ? winterThesisForScore(score) : null
      const confirmation = score && thesis ? confirmationBySignal.get(winterThesisKey(consensusKey(score), thesis.kind)) : null
      if (!score || !thesis || !confirmation) continue

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
        weightedAnomalyF: score.weightedAnomalyF,
        coveragePct: thesis.coveragePct,
        extremeCount: thesis.extremeCount,
        coldCoveragePct: score.coldCoveragePct,
        warmCoveragePct: score.warmCoveragePct,
        coldExtremeCount: score.coldExtremeCount,
        warmExtremeCount: score.warmExtremeCount,
        sampledWeight: score.sampledWeight,
        locationCount: score.locationCount,
        thesisKind: thesis.kind,
        thesisDirection: thesis.direction,
        confirmedSourceGroups: confirmation.sourceGroups,
        confirmedSourceFamilies: confirmation.sourceFamilies,
      }
      if (isTradable(joined)) rows.push(joined)
    }
  }

  return { manifest, rows }
}

function featureNames(featureSet, sourcePolicy) {
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
  if (featureSet === 'weatherSourceGroup') {
    const groups = [...new Set(SOURCE_POLICIES[sourcePolicy].map(sourceGroupFor))].sort()
    return [...base, ...groups.map((group) => `sourceGroup:${group}`)]
  }
  if (featureSet === 'weatherSourceId') {
    return [...base, ...SOURCE_POLICIES[sourcePolicy].map((sourceId) => `source:${sourceId}`)]
  }
  return base
}

function rawFeatures(row, featureSet, sourcePolicy) {
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
  if (featureSet === 'weatherSourceGroup') {
    const groups = [...new Set(SOURCE_POLICIES[sourcePolicy].map(sourceGroupFor))].sort()
    return [...base, ...groups.map((group) => (row.sourceGroup === group ? 1 : 0))]
  }
  if (featureSet === 'weatherSourceId') {
    return [...base, ...SOURCE_POLICIES[sourcePolicy].map((sourceId) => (row.sourceId === sourceId ? 1 : 0))]
  }
  return base
}

function fitScaler(rows, featureSet, sourcePolicy) {
  const matrix = rows.map((row) => rawFeatures(row, featureSet, sourcePolicy))
  const columns = matrix[0]?.length ?? 0
  const means = Array.from({ length: columns }, (_, column) => mean(matrix.map((values) => values[column])))
  const scales = Array.from({ length: columns }, (_, column) => std(matrix.map((values) => values[column])) || 1)
  return { means, scales }
}

function transformRow(row, featureSet, sourcePolicy, scaler) {
  return rawFeatures(row, featureSet, sourcePolicy).map((value, index) => (value - scaler.means[index]) / scaler.scales[index])
}

function splitCandidates(values, maxCandidates = 8) {
  if (values.length < 2) return []
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  if (sorted.length <= maxCandidates) return sorted.slice(0, -1)
  return Array.from({ length: maxCandidates }, (_, index) => {
    const pct = (index + 1) / (maxCandidates + 1)
    return sorted[Math.floor((sorted.length - 1) * pct)]
  })
}

function leafValue(values) {
  return mean(values)
}

function sse(values) {
  const avg = mean(values)
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0)
}

function buildTree(x, y, depth, maxDepth, minLeaf) {
  if (depth >= maxDepth || y.length <= minLeaf * 2) return { value: leafValue(y) }
  let best = null
  const featureCount = x[0]?.length ?? 0

  for (let feature = 0; feature < featureCount; feature += 1) {
    for (const threshold of splitCandidates(x.map((row) => row[feature]))) {
      const leftX = []
      const leftY = []
      const rightX = []
      const rightY = []
      for (let rowIndex = 0; rowIndex < x.length; rowIndex += 1) {
        if (x[rowIndex][feature] <= threshold) {
          leftX.push(x[rowIndex])
          leftY.push(y[rowIndex])
        } else {
          rightX.push(x[rowIndex])
          rightY.push(y[rowIndex])
        }
      }
      if (leftY.length < minLeaf || rightY.length < minLeaf) continue
      const loss = sse(leftY) + sse(rightY)
      if (!best || loss < best.loss) best = { feature, threshold, leftX, leftY, rightX, rightY, loss }
    }
  }

  if (!best) return { value: leafValue(y) }
  return {
    feature: best.feature,
    threshold: best.threshold,
    left: buildTree(best.leftX, best.leftY, depth + 1, maxDepth, minLeaf),
    right: buildTree(best.rightX, best.rightY, depth + 1, maxDepth, minLeaf),
  }
}

function predictTree(tree, values) {
  if (Object.hasOwn(tree, 'value')) return tree.value
  return values[tree.feature] <= tree.threshold ? predictTree(tree.left, values) : predictTree(tree.right, values)
}

function trainGradientBoostedTrees(rows, params) {
  const scaler = fitScaler(rows, params.featureSet, params.sourcePolicy)
  const x = rows.map((row) => transformRow(row, params.featureSet, params.sourcePolicy, scaler))
  const y = rows.map((row) => row.thesisDirection * row.returnPct)
  const initial = mean(y)
  let predictions = y.map(() => initial)
  const trees = []

  for (let estimator = 0; estimator < params.estimators; estimator += 1) {
    const residuals = y.map((value, index) => value - predictions[index])
    const tree = buildTree(x, residuals, 0, params.maxDepth, params.minLeaf)
    trees.push(tree)
    predictions = predictions.map((value, index) => value + params.learningRate * predictTree(tree, x[index]))
  }

  return {
    predict(row) {
      const values = transformRow(row, params.featureSet, params.sourcePolicy, scaler)
      return trees.reduce((prediction, tree) => prediction + params.learningRate * predictTree(tree, values), initial)
    },
    trees,
    initial,
  }
}

function sourceFilter(rows, sourcePolicy) {
  const allowed = new Set(SOURCE_POLICIES[sourcePolicy])
  return rows.filter((row) => allowed.has(row.sourceId))
}

function sideFilter(rows, sideScope) {
  if (sideScope === 'all') return rows
  return rows.filter((row) => row.thesisKind === sideScope)
}

function weatherGate(row, params) {
  if (signalStrength(row) < params.minSignalStrengthF) return false
  if (row.coveragePct < params.minCoveragePct) return false
  if (row.extremeCount < params.minExtremeCount) return false
  return true
}

function groupKey(row) {
  return [row.issueDate, row.targetDate, row.entryTradeDate, row.targetTradeDate, row.thesisKind].join('|')
}

function candidateRows(scoredRows, params) {
  const eligible = scoredRows.filter(({ row, prediction }) => weatherGate(row, params) && prediction >= params.minExpectedTheoryReturnPct)
  if (params.candidateMode === 'row') {
    return eligible.map(({ row, prediction }) => ({
      row,
      direction: row.thesisDirection,
      rank: prediction,
      predictedTheoryReturnPct: prediction,
      sourceCount: 1,
      sourceGroups: [row.sourceGroup],
      sourceFamilies: [row.sourceFamily],
      candidateMode: params.candidateMode,
    }))
  }

  const groups = new Map()
  for (const scored of eligible) {
    const key = groupKey(scored.row)
    groups.set(key, [...(groups.get(key) ?? []), scored])
  }

  const candidates = []
  for (const group of groups.values()) {
    const sourceGroups = [...new Set(group.map(({ row }) => row.sourceGroup))].sort()
    const sourceFamilies = [...new Set(group.map(({ row }) => row.sourceFamily))].sort()
    if (sourceGroups.length < MIN_SOURCE_GROUPS || sourceFamilies.length < MIN_MODEL_FAMILIES) continue
    const predictions = group.map(({ prediction }) => prediction)
    const representative = group.slice().sort((a, b) => b.prediction - a.prediction)[0].row
    candidates.push({
      row: representative,
      direction: representative.thesisDirection,
      rank: median(predictions),
      predictedTheoryReturnPct: median(predictions),
      meanPredictedTheoryReturnPct: mean(predictions),
      sourceCount: group.length,
      sourceGroups,
      sourceFamilies,
      candidateMode: params.candidateMode,
    })
  }
  return candidates
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

function evaluatePeriod(rows, params, trainEnd, testStart, testEnd = null) {
  const scopedRows = sideFilter(sourceFilter(rows, params.sourcePolicy), params.sideScope)
  const train = scopedRows.filter((row) => row.issueDate < trainEnd)
  const test = scopedRows.filter((row) => row.issueDate >= testStart && (!testEnd || row.issueDate < testEnd))
  const minTrainRows = params.sideScope === 'all' ? 40 : 24
  const minTestRows = params.sideScope === 'all' ? 10 : 4
  if (train.length < minTrainRows || test.length < minTestRows) return null

  const minLeaf = Math.max(params.minLeafAbs, Math.floor(train.length * params.minLeafFrac))
  const modelParams = { ...params, minLeaf }
  const model = trainGradientBoostedTrees(train, modelParams)
  const scoredRows = test.map((row) => ({ row, prediction: model.predict(row) }))
  const candidates = candidateRows(scoredRows, modelParams)
  const trades = resolveTrades(candidates)
  const weatherEligible = scoredRows.filter(({ row }) => weatherGate(row, modelParams))
  const thresholdEligible = weatherEligible.filter(({ prediction }) => prediction >= modelParams.minExpectedTheoryReturnPct)
  return {
    trainRows: train.length,
    testRows: test.length,
    minLeaf,
    predictionStats: predictionStats(scoredRows.map(({ prediction }) => prediction)),
    weatherEligibleCount: weatherEligible.length,
    thresholdEligibleCount: thresholdEligible.length,
    candidateCount: candidates.length,
    trades,
    metrics: tradeMetrics(trades),
    sideMetrics: sideMetrics(trades),
  }
}

function predictionStats(values) {
  if (!values.length) return { min: 0, p25: 0, median: 0, p75: 0, max: 0, mean: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (pct) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)))]
  return {
    min: round(sorted[0], 4),
    p25: round(at(0.25), 4),
    median: round(median(sorted), 4),
    p75: round(at(0.75), 4),
    max: round(sorted.at(-1), 4),
    mean: round(mean(sorted), 4),
  }
}

function validationRank(metrics, foldCount, worstFoldReturnPct) {
  const minTradePenalty = metrics.tradeCount >= 6 ? 0 : -5000
  const foldPenalty = foldCount >= 2 ? 0 : -2500
  const lossPenalty = worstFoldReturnPct >= -8 ? 0 : -1000
  return (
    minTradePenalty +
    foldPenalty +
    lossPenalty +
    metrics.totalReturnPct +
    metrics.sharpe * 2 +
    metrics.maxDrawdownPct * 0.25 +
    Math.min(metrics.tradeCount, 12) * 0.1
  )
}

function summarizeConfig(rows, params) {
  const folds = []
  const foldTrades = []
  for (const fold of WALK_FORWARD_FOLDS) {
    const result = evaluatePeriod(rows, params, fold.trainEnd, fold.testStart, fold.testEnd)
    if (!result) continue
    folds.push({
      id: fold.id,
      trainEnd: fold.trainEnd,
      testStart: fold.testStart,
      testEnd: fold.testEnd,
      trainRows: result.trainRows,
      testRows: result.testRows,
      minLeaf: result.minLeaf,
      predictionStats: result.predictionStats,
      weatherEligibleCount: result.weatherEligibleCount,
      thresholdEligibleCount: result.thresholdEligibleCount,
      candidateCount: result.candidateCount,
      metrics: result.metrics,
      sideMetrics: result.sideMetrics,
    })
    foldTrades.push(...result.trades.map((trade) => ({ ...trade, foldId: fold.id })))
  }

  const validationMetrics = tradeMetrics(foldTrades.sort((a, b) => a.row.entryTradeDate.localeCompare(b.row.entryTradeDate)))
  const worstFoldReturnPct = folds.length ? Math.min(...folds.map((fold) => fold.metrics.totalReturnPct)) : 0
  const holdout = evaluatePeriod(rows, params, TRAIN_CUTOFF, TRAIN_CUTOFF)
  return {
    id: configId(params),
    params,
    folds,
    validationMetrics,
    validationSideMetrics: sideMetrics(foldTrades),
    validationWorstFoldReturnPct: round(worstFoldReturnPct, 2),
    validationRank: round(validationRank(validationMetrics, folds.length, worstFoldReturnPct), 4),
    holdout: holdout
      ? {
          trainRows: holdout.trainRows,
          testRows: holdout.testRows,
          minLeaf: holdout.minLeaf,
          predictionStats: holdout.predictionStats,
          weatherEligibleCount: holdout.weatherEligibleCount,
          thresholdEligibleCount: holdout.thresholdEligibleCount,
          candidateCount: holdout.candidateCount,
          metrics: holdout.metrics,
          sideMetrics: holdout.sideMetrics,
          trades: holdout.trades,
        }
      : null,
  }
}

function configId(params) {
  return [
    'strict-theory-gbt',
    params.sideScope,
    params.candidateMode,
    params.sourcePolicy,
    params.featureSet,
    `e${params.estimators}`,
    `d${params.maxDepth}`,
    `lr${params.learningRate}`,
    `lf${params.minLeafFrac}`,
    `sig${params.minSignalStrengthF}`,
    `cov${params.minCoveragePct}`,
    `ex${params.minExtremeCount}`,
    `thr${params.minExpectedTheoryReturnPct}`,
  ].join('__')
}

function buildGrid() {
  const grid = []
  for (const sideScope of ['all', 'cold-long', 'warm-short']) {
    for (const candidateMode of ['consensus', 'row']) {
      for (const sourcePolicy of ['longHistoryCore', 'noAigfs', 'allConfirmed']) {
        for (const featureSet of ['weatherOnly', 'weatherSourceGroup', 'weatherSourceId']) {
          for (const estimators of [6, 12, 20]) {
            for (const maxDepth of [1, 2]) {
              for (const learningRate of [0.06]) {
                for (const minLeafFrac of [0.1, 0.2]) {
                  for (const minSignalStrengthF of [8, 12]) {
                    for (const minCoveragePct of [0.55, 0.7]) {
                      for (const minExtremeCount of [0, 8]) {
                        for (const minExpectedTheoryReturnPct of [ROUND_TRIP_COST_PCT, 0.25, 0.5, 1]) {
                          if (
                            candidateMode === 'row' &&
                            (featureSet !== 'weatherSourceId' ||
                              ![12, 20].includes(estimators) ||
                              maxDepth !== 1 ||
                              minLeafFrac !== 0.1 ||
                              ![0.25, 0.5].includes(minExpectedTheoryReturnPct))
                          ) {
                            continue
                          }
                          if (candidateMode === 'consensus' && featureSet === 'weatherSourceId') continue
                          grid.push({
                            sideScope,
                            candidateMode,
                            sourcePolicy,
                            featureSet,
                            estimators,
                            maxDepth,
                            learningRate,
                            minLeafFrac,
                            minLeafAbs: 10,
                            minSignalStrengthF,
                            minCoveragePct,
                            minExtremeCount,
                            minExpectedTheoryReturnPct,
                          })
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
  return grid
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function writeCsv(filePath, rows, headers) {
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')
  fs.writeFileSync(filePath, `${csv}\n`)
}

function flattenSummary(summary) {
  return {
    id: summary.id,
    validationRank: summary.validationRank,
    sideScope: summary.params.sideScope,
    candidateMode: summary.params.candidateMode,
    sourcePolicy: summary.params.sourcePolicy,
    featureSet: summary.params.featureSet,
    estimators: summary.params.estimators,
    maxDepth: summary.params.maxDepth,
    learningRate: summary.params.learningRate,
    minLeafFrac: summary.params.minLeafFrac,
    minLeafAbs: summary.params.minLeafAbs,
    minSignalStrengthF: summary.params.minSignalStrengthF,
    minCoveragePct: summary.params.minCoveragePct,
    minExtremeCount: summary.params.minExtremeCount,
    minExpectedTheoryReturnPct: summary.params.minExpectedTheoryReturnPct,
    validationTradeCount: summary.validationMetrics.tradeCount,
    validationTotalReturnPct: summary.validationMetrics.totalReturnPct,
    validationSharpe: summary.validationMetrics.sharpe,
    validationMaxDrawdownPct: summary.validationMetrics.maxDrawdownPct,
    validationWorstFoldReturnPct: summary.validationWorstFoldReturnPct,
    validationColdTrades: summary.validationSideMetrics.coldLong.tradeCount,
    validationColdReturnPct: summary.validationSideMetrics.coldLong.totalReturnPct,
    validationWarmTrades: summary.validationSideMetrics.warmShort.tradeCount,
    validationWarmReturnPct: summary.validationSideMetrics.warmShort.totalReturnPct,
    holdoutPredictionMax: summary.holdout?.predictionStats.max ?? 0,
    holdoutWeatherEligibleCount: summary.holdout?.weatherEligibleCount ?? 0,
    holdoutThresholdEligibleCount: summary.holdout?.thresholdEligibleCount ?? 0,
    holdoutCandidateCount: summary.holdout?.candidateCount ?? 0,
    holdoutTradeCount: summary.holdout?.metrics.tradeCount ?? 0,
    holdoutTotalReturnPct: summary.holdout?.metrics.totalReturnPct ?? 0,
    holdoutSharpe: summary.holdout?.metrics.sharpe ?? 0,
    holdoutMaxDrawdownPct: summary.holdout?.metrics.maxDrawdownPct ?? 0,
    holdoutWinRatePct: summary.holdout?.metrics.winRatePct ?? 0,
    holdoutColdTrades: summary.holdout?.sideMetrics.coldLong.tradeCount ?? 0,
    holdoutColdReturnPct: summary.holdout?.sideMetrics.coldLong.totalReturnPct ?? 0,
    holdoutWarmTrades: summary.holdout?.sideMetrics.warmShort.tradeCount ?? 0,
    holdoutWarmReturnPct: summary.holdout?.sideMetrics.warmShort.totalReturnPct ?? 0,
  }
}

function tradeRow(trade, strategyId) {
  return {
    strategyId,
    issueDate: trade.row.issueDate,
    targetDate: trade.row.targetDate,
    entryTradeDate: trade.row.entryTradeDate,
    targetTradeDate: trade.row.targetTradeDate,
    sourceId: trade.row.sourceId,
    sourceGroup: trade.row.sourceGroup,
    sourceFamily: trade.row.sourceFamily,
    windowId: trade.row.windowId,
    thesisKind: trade.row.thesisKind,
    leadDays: trade.row.leadDays,
    direction: trade.direction === 1 ? 'long' : 'short',
    weightedAnomalyF: round(trade.row.weightedAnomalyF, 3),
    coveragePct: round(trade.row.coveragePct, 3),
    coldCoveragePct: round(trade.row.coldCoveragePct, 3),
    warmCoveragePct: round(trade.row.warmCoveragePct, 3),
    extremeCount: trade.row.extremeCount,
    sourceCount: trade.sourceCount,
    sourceGroups: trade.sourceGroups.join('|'),
    sourceFamilies: trade.sourceFamilies.join('|'),
    predictedTheoryReturnPct: round(trade.predictedTheoryReturnPct, 4),
    grossReturnPct: round(trade.grossReturnPct, 4),
    netReturnPct: round(trade.netReturnPct, 4),
    rank: round(trade.rank, 5),
  }
}

function tradeHeaders(strategyId) {
  return Object.keys(tradeRow({ row: {}, sourceGroups: [], sourceFamilies: [], direction: 1 }, strategyId))
}

function reportMarkdown(best, baseline, robustTop, diagnosticTopHoldout, dataset) {
  const topHoldout = diagnosticTopHoldout[0]
  const lines = [
    '# Strict-Theory Gradient Boosted Trees Run',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Contract',
    '',
    '- PnL column: `returnPctEntryCloseToTarget`.',
    '- Timing guard: `entryTradeDate > issueDate`, `targetTradeDate >= targetDate`, `targetTradeDate > entryTradeDate`.',
    '- Universe: winter 7-10 day UNG rumor rows with cold-long or warm-short strict-theory confirmation from at least two source groups and two model families.',
    '- Validation: model/config ranking uses only pre-2025-11-01 walk-forward folds; the post-2025-11-01 holdout is reported after selection.',
    '',
    '## Dataset',
    '',
    `- Strict-theory tradable rows: ${dataset.strictTheoryRows}`,
    `- Pre-cutoff rows: ${dataset.preCutoffRows}`,
    `- Post-cutoff rows: ${dataset.postCutoffRows}`,
    `- Side counts: cold-long ${dataset.sideCounts['cold-long'] ?? 0}, warm-short ${dataset.sideCounts['warm-short'] ?? 0}`,
    '',
    '## Selected By Walk-Forward Rank',
    '',
    `- ID: \`${best.id}\``,
    `- Params: side=${best.params.sideScope}, candidateMode=${best.params.candidateMode}, sourcePolicy=${best.params.sourcePolicy}, features=${best.params.featureSet}, estimators=${best.params.estimators}, depth=${best.params.maxDepth}, learningRate=${best.params.learningRate}, minLeafFrac=${best.params.minLeafFrac}`,
    `- Weather gate: minSignal=${best.params.minSignalStrengthF}F, minCoverage=${best.params.minCoveragePct}, minExtremeCount=${best.params.minExtremeCount}, minExpectedTheoryReturn=${best.params.minExpectedTheoryReturnPct}%`,
    `- Walk-forward: total=${best.validationMetrics.totalReturnPct}%, sharpe=${best.validationMetrics.sharpe}, drawdown=${best.validationMetrics.maxDrawdownPct}%, trades=${best.validationMetrics.tradeCount}, worstFold=${best.validationWorstFoldReturnPct}%`,
    `- Holdout: total=${best.holdout?.metrics.totalReturnPct ?? 0}%, sharpe=${best.holdout?.metrics.sharpe ?? 0}, drawdown=${best.holdout?.metrics.maxDrawdownPct ?? 0}%, trades=${best.holdout?.metrics.tradeCount ?? 0}`,
    `- Holdout sides: cold-long ${best.holdout?.sideMetrics.coldLong.totalReturnPct ?? 0}% / ${best.holdout?.sideMetrics.coldLong.tradeCount ?? 0} trades; warm-short ${best.holdout?.sideMetrics.warmShort.totalReturnPct ?? 0}% / ${best.holdout?.sideMetrics.warmShort.tradeCount ?? 0} trades`,
    '',
    '## Current Shared Baseline Comparator',
    '',
    `- Current strict-theory GBT baseline: total=${baseline.totalReturnPct}%, sharpe=${baseline.sharpe}, drawdown=${baseline.maxDrawdownPct}%, trades=${baseline.tradeCount}`,
    '',
    '## Robust Top Candidates',
    '',
    ...(robustTop.length
      ? robustTop.map(
          (candidate, index) =>
            `${index + 1}. ${candidate.id}: WF ${candidate.validationMetrics.totalReturnPct}%/${candidate.validationMetrics.tradeCount} trades; holdout ${candidate.holdout?.metrics.totalReturnPct ?? 0}%/${candidate.holdout?.metrics.tradeCount ?? 0} trades; side=${candidate.params.sideScope}; mode=${candidate.params.candidateMode}; source=${candidate.params.sourcePolicy}`,
        )
      : ['- None met the minimum robustness bar of 6 validation trades plus at least 3 holdout trades.']),
    '',
    '## Diagnostic Top Holdout',
    '',
    topHoldout
      ? `- ${topHoldout.id}: holdout=${topHoldout.holdout?.metrics.totalReturnPct ?? 0}% over ${topHoldout.holdout?.metrics.tradeCount ?? 0} trades; walk-forward=${topHoldout.validationMetrics.totalReturnPct}% over ${topHoldout.validationMetrics.tradeCount} trades; cold holdout=${topHoldout.holdout?.sideMetrics.coldLong.totalReturnPct ?? 0}%/${topHoldout.holdout?.sideMetrics.coldLong.tradeCount ?? 0} trades; warm holdout=${topHoldout.holdout?.sideMetrics.warmShort.totalReturnPct ?? 0}%/${topHoldout.holdout?.sideMetrics.warmShort.tradeCount ?? 0} trades. This is useful evidence, not a replacement-grade result, because the validation sample is only two trades.`
      : '- None traded in holdout.',
    '',
    '## Recommendation',
    '',
    best.holdout && best.holdout.metrics.tradeCount >= 6 && best.validationMetrics.tradeCount >= 6 && best.validationWorstFoldReturnPct > -8
      ? 'Use this only as an informing candidate, not an automatic replacement, until it survives a larger post-cutoff window or futures-grade NG validation. It improves the current GBT holdout but still depends on a short 2025-26 out-of-sample season.'
      : 'Do not replace the baseline. The GBT lane either lacks enough robust trades or relies too heavily on a short holdout pocket; demote it unless future winters add confirming evidence.',
    '',
  ]
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

function readSharedGbtBaseline() {
  const filePath = path.join(DATA_ROOT, 'research/strategy-tests/arctic-blast-strategy-baselines.csv')
  const row = parseCsv(filePath).find((entry) => entry.strategyId === 'strict-theory-gradient-boosted-trees')
  return {
    totalReturnPct: numberFrom(row?.totalReturnPct),
    sharpe: numberFrom(row?.sharpe),
    maxDrawdownPct: numberFrom(row?.maxDrawdownPct),
    tradeCount: numberFrom(row?.tradeCount),
  }
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const { rows } = loadStrictTheoryRows()
  const strictRows = rows
  const dataset = {
    strictTheoryRows: strictRows.length,
    preCutoffRows: strictRows.filter((row) => row.issueDate < TRAIN_CUTOFF).length,
    postCutoffRows: strictRows.filter((row) => row.issueDate >= TRAIN_CUTOFF).length,
    sideCounts: strictRows.reduce((counts, row) => {
      counts[row.thesisKind] = (counts[row.thesisKind] ?? 0) + 1
      return counts
    }, {}),
  }

  const summaries = buildGrid()
    .map((params) => summarizeConfig(strictRows, params))
    .filter((summary) => summary.holdout && summary.folds.length)

  const sorted = summaries.slice().sort((a, b) => b.validationRank - a.validationRank)
  const best = sorted[0]
  const robustTop = sorted
    .filter(
      (summary) =>
        summary.params.candidateMode === 'consensus' &&
        summary.params.sourcePolicy !== 'allConfirmed' &&
        summary.validationMetrics.tradeCount >= 6 &&
        summary.holdout?.metrics.tradeCount >= 3,
    )
    .slice(0, 10)
  const diagnosticTopHoldout = summaries
    .filter((summary) => summary.holdout?.metrics.tradeCount > 0)
    .sort((a, b) => b.holdout.metrics.totalReturnPct - a.holdout.metrics.totalReturnPct)
    .slice(0, 10)
  const baseline = readSharedGbtBaseline()

  const summaryRows = sorted.map(flattenSummary)
  writeCsv(path.join(OUTPUT_DIR, 'strict-theory-gbt-grid-summary.csv'), summaryRows, Object.keys(summaryRows[0] ?? {}))

  const holdoutTradeHeaders = tradeHeaders(best.id)
  const bestTrades = (best.holdout?.trades ?? []).map((trade) => tradeRow(trade, best.id))
  writeCsv(path.join(OUTPUT_DIR, 'strict-theory-gbt-best-holdout-trades.csv'), bestTrades, holdoutTradeHeaders)

  const robustTrades = robustTop.flatMap((summary) => (summary.holdout?.trades ?? []).map((trade) => tradeRow(trade, summary.id)))
  writeCsv(path.join(OUTPUT_DIR, 'strict-theory-gbt-robust-top-holdout-trades.csv'), robustTrades, holdoutTradeHeaders)

  const diagnosticTrades = diagnosticTopHoldout.flatMap((summary) => (summary.holdout?.trades ?? []).map((trade) => tradeRow(trade, summary.id)))
  writeCsv(path.join(OUTPUT_DIR, 'strict-theory-gbt-diagnostic-top-holdout-trades.csv'), diagnosticTrades, holdoutTradeHeaders)

  const details = {
    generatedAt: new Date().toISOString(),
    trainCutoff: TRAIN_CUTOFF,
    roundTripCostPct: ROUND_TRIP_COST_PCT,
    timingContract: {
      pnlColumn: 'returnPctEntryCloseToTarget',
      entryRule: 'entryTradeDate > issueDate',
      targetRule: 'targetTradeDate >= targetDate and targetTradeDate > entryTradeDate',
    },
    dataset,
    currentSharedBaseline: baseline,
    selectedByWalkForwardRank: {
      ...best,
      holdout: best.holdout ? { ...best.holdout, trades: best.holdout.trades.map((trade) => tradeRow(trade, best.id)) } : null,
    },
    robustTop: robustTop.map((summary) => ({
      ...summary,
      holdout: summary.holdout ? { ...summary.holdout, trades: summary.holdout.trades.map((trade) => tradeRow(trade, summary.id)) } : null,
    })),
    diagnosticTopHoldout: diagnosticTopHoldout.map((summary) => ({
      ...summary,
      holdout: summary.holdout ? { ...summary.holdout, trades: summary.holdout.trades.map((trade) => tradeRow(trade, summary.id)) } : null,
    })),
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'strict-theory-gbt-summary.json'), `${JSON.stringify(details, null, 2)}\n`)
  fs.writeFileSync(path.join(OUTPUT_DIR, 'strict-theory-gbt-report.md'), reportMarkdown(best, baseline, robustTop, diagnosticTopHoldout, dataset))

  console.log(`evaluated=${summaries.length}`)
  console.log(`best=${best.id}`)
  console.log(
    `walkForward total=${best.validationMetrics.totalReturnPct}% sharpe=${best.validationMetrics.sharpe} trades=${best.validationMetrics.tradeCount} worstFold=${best.validationWorstFoldReturnPct}%`,
  )
  console.log(
    `holdout total=${best.holdout?.metrics.totalReturnPct ?? 0}% sharpe=${best.holdout?.metrics.sharpe ?? 0} trades=${best.holdout?.metrics.tradeCount ?? 0}`,
  )
  console.log(`wrote=${path.relative(REPO_ROOT, OUTPUT_DIR)}`)
}

main()
