import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-tests')
const ROUND_TRIP_COST_PCT = 0.064
const MIN_TRADES_FOR_PRIMARY_RANK = 8
const TRAIN_CUTOFF = '2024-01-01'
const VARIANTS = [
  {
    id: 'strict-theory',
    label: 'Strict Theory',
    universe: 'Only score-qualified Arctic Blast rows; rumor window is long UNG and selloff window is short UNG.',
    strictTheory: true,
  },
  {
    id: 'experimental',
    label: 'Experimental',
    universe: 'All no-lookahead UNG forecast-return rows; model direction and thresholds may discover non-Arctic patterns.',
    strictTheory: false,
  },
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

function isStrictTheoryRow(row) {
  return row.scoreQualifies
}

function rowsForVariant(rows, variant) {
  return variant.strictTheory ? rows.filter(isStrictTheoryRow) : rows
}

function theoryDirection(row) {
  return candidateDirection(row, 'theory')
}

function theoryAlignedReturnPct(row) {
  return theoryDirection(row) * row.returnPct
}

function modelTrainingRows(rows, variant) {
  if (!variant.strictTheory) return rows
  return rows.map((row) => ({
    ...row,
    returnPct: theoryAlignedReturnPct(row),
  }))
}

function strategyId(baseId, variant) {
  return `${variant.id}-${baseId}`
}

function strategyLabel(baseLabel, variant) {
  return `${baseLabel} (${variant.label})`
}

function variantParams(variant, params = {}) {
  return {
    variant: variant.id,
    universe: variant.universe,
    theoryAlignment: variant.strictTheory ? 'strict to theory.md' : 'experimental / not theory-constrained',
    samplePolicy: variant.strictTheory
      ? 'Score-qualified pre-2024 Arctic Blast rows are sparse; read strict-theory results as smaller-universe research, with reduced ML sample minimums where needed.'
      : 'Standard ML sample minimums for the wider no-lookahead forecast-return universe.',
    ...params,
  }
}

function scoreKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId, row.modelId].join('|')
}

function loadRows() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const rows = []
  const sourceIds = []
  const inputFiles = []

  for (const calendar of manifest.forecastCalendars) {
    sourceIds.push(calendar.id)
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const returnsPath = path.join(DATA_ROOT, calendar.files.signalReturns)
    inputFiles.push(path.relative(REPO_ROOT, scoresPath), path.relative(REPO_ROOT, returnsPath))
    const scores = new Map()

    for (const score of parseCsv(scoresPath)) {
      scores.set(scoreKey(score), {
        weightedAnomalyF: numberFrom(score.weightedAnomalyF),
        coveragePct: numberFrom(score.coveragePct),
        extremeCount: numberFrom(score.extremeCount),
        sampledWeight: numberFrom(score.sampledWeight),
        locationCount: numberFrom(score.locationCount),
        qualifies: boolFrom(score.qualifies),
      })
    }

    for (const ret of parseCsv(returnsPath)) {
      const score = scores.get(scoreKey(ret))
      const joined = {
        sourceId: calendar.id,
        sourceLabel: calendar.label,
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
        scoreQualifies: score?.qualifies ?? boolFrom(ret.qualifies),
        weightedAnomalyF: score?.weightedAnomalyF ?? 0,
        coveragePct: score?.coveragePct ?? 0,
        extremeCount: score?.extremeCount ?? 0,
        sampledWeight: score?.sampledWeight ?? 0,
        locationCount: score?.locationCount ?? 0,
      }

      if (score && isTradable(joined)) rows.push(joined)
    }
  }

  return { manifest, rows, sourceIds, inputFiles }
}

function sourceSubsets(sourceIds) {
  const present = new Set(sourceIds)
  const subset = (id, ids) => ({ id, sourceIds: ids.filter((sourceId) => present.has(sourceId)) })
  return [
    subset('all', sourceIds),
    subset('long-history-core', ['gfs', 'gefs-mean', 'gem-global', 'ecmwf-ifs']),
    subset('gfs-gefs', ['gfs', 'gefs-mean']),
    subset('gfs-only', ['gfs']),
    subset('gefs-only', ['gefs-mean']),
    subset('gem-only', ['gem-global']),
    subset('ecmwf-ifs-only', ['ecmwf-ifs']),
    subset('graphcast-only', ['graphcastgfs']),
    subset('recent-open-meteo', ['graphcastgfs', 'gem-global', 'ecmwf-ifs', 'ecmwf-aifs', 'aigfs']),
  ].filter((entry) => entry.sourceIds.length)
}

function featureNames(sourceIds) {
  return [
    'leadDays',
    'coldStrength',
    'weightedAnomalyF',
    'coveragePct',
    'extremeCount',
    'sampledWeight',
    'locationCount',
    'qualifies',
    'isRumor',
    'isSelloff',
    'coverageCold',
    'extremeCoverage',
    'doySin',
    'doyCos',
    ...sourceIds.map((sourceId) => `source:${sourceId}`),
  ]
}

function rawFeatures(row, sourceIds) {
  const coldStrength = Math.max(0, -row.weightedAnomalyF)
  const doy = dayOfYear(row.issueDate)
  return [
    row.leadDays,
    coldStrength,
    row.weightedAnomalyF,
    row.coveragePct,
    row.extremeCount,
    row.sampledWeight,
    row.locationCount,
    row.scoreQualifies ? 1 : 0,
    row.windowId === 'rumor' ? 1 : 0,
    row.windowId === 'selloff' ? 1 : 0,
    row.coveragePct * coldStrength,
    row.coveragePct * row.extremeCount,
    Math.sin((2 * Math.PI * doy) / 365.25),
    Math.cos((2 * Math.PI * doy) / 365.25),
    ...sourceIds.map((sourceId) => (row.sourceId === sourceId ? 1 : 0)),
  ]
}

function fitScaler(rows, sourceIds) {
  const matrix = rows.map((row) => rawFeatures(row, sourceIds))
  const columns = matrix[0]?.length ?? 0
  const means = Array.from({ length: columns }, (_, column) => mean(matrix.map((values) => values[column])))
  const scales = Array.from({ length: columns }, (_, column) => std(matrix.map((values) => values[column])) || 1)
  return { means, scales }
}

function transformRow(row, sourceIds, scaler) {
  return rawFeatures(row, sourceIds).map((value, index) => (value - scaler.means[index]) / scaler.scales[index])
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

function trainLogistic(rows, sourceIds, params) {
  const scaler = fitScaler(rows, sourceIds)
  const x = rows.map((row) => transformRow(row, sourceIds, scaler))
  const y = rows.map((row) => (row.returnPct > ROUND_TRIP_COST_PCT ? 1 : 0))
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
      return sigmoid(intercept + dot(weights, transformRow(row, sourceIds, scaler)))
    },
    weights,
    intercept,
    scaler,
  }
}

function trainElasticNet(rows, sourceIds, params) {
  const scaler = fitScaler(rows, sourceIds)
  const x = rows.map((row) => transformRow(row, sourceIds, scaler))
  const yRaw = rows.map((row) => row.returnPct)
  const yMean = mean(yRaw)
  const yScale = std(yRaw) || 1
  const y = yRaw.map((value) => (value - yMean) / yScale)
  const weights = Array.from({ length: x[0]?.length ?? 0 }, () => 0)
  let intercept = 0

  for (let iteration = 0; iteration < params.iterations; iteration += 1) {
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

    intercept -= (params.learningRate * interceptGrad) / x.length
    for (let column = 0; column < weights.length; column += 1) {
      const l2 = params.alpha * (1 - params.l1Ratio) * weights[column]
      weights[column] -= params.learningRate * (grad[column] / x.length + l2)
      const shrink = params.learningRate * params.alpha * params.l1Ratio
      weights[column] = Math.sign(weights[column]) * Math.max(0, Math.abs(weights[column]) - shrink)
    }
  }

  return {
    predict(row) {
      return (intercept + dot(weights, transformRow(row, sourceIds, scaler))) * yScale + yMean
    },
    weights,
    intercept,
    yMean,
    yScale,
    scaler,
  }
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
      const leftY = []
      const rightY = []
      const leftX = []
      const rightX = []
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

function trainGradientBoostedTrees(rows, sourceIds, params) {
  const scaler = fitScaler(rows, sourceIds)
  const x = rows.map((row) => transformRow(row, sourceIds, scaler))
  const y = rows.map((row) => row.returnPct)
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
      const values = transformRow(row, sourceIds, scaler)
      return trees.reduce((prediction, tree) => prediction + params.learningRate * predictTree(tree, values), initial)
    },
    trees,
    initial,
    scaler,
  }
}

function coefficientSummary(model, names, count = 8) {
  if (!model.weights) return []
  return model.weights
    .map((weight, index) => ({ feature: names[index], weight: round(weight, 5) }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, count)
}

function candidateDirection(row, mode, score = null) {
  if (mode === 'long') return 1
  if (mode === 'short') return -1
  if (mode === 'theory') return row.windowId === 'selloff' ? -1 : 1
  if (mode === 'contrarian-theory') return row.windowId === 'selloff' ? 1 : -1
  if (mode === 'signed-model') return score >= 0 ? 1 : -1
  return 0
}

function probabilityCandidates(scored, variant, params) {
  return scored
    .map(({ row, probability }) => {
      if (variant.strictTheory) {
        return {
          row,
          direction: probability >= params.acceptThreshold ? theoryDirection(row) : 0,
          rank: probability,
          probability,
        }
      }

      const direction =
        params.directionMode === 'signed-probability' && probability <= params.shortThreshold
          ? -1
          : probability >= params.longThreshold
            ? 1
            : 0
      return { row, direction, rank: direction === -1 ? 1 - probability : probability, probability }
    })
    .filter((candidate) => candidate.direction)
}

function expectedReturnCandidates(scored, variant, params) {
  return scored
    .map(({ row, expectedReturnPct }) => {
      if (variant.strictTheory) {
        return {
          row,
          direction: expectedReturnPct >= params.minExpectedTheoryReturnPct ? theoryDirection(row) : 0,
          rank: expectedReturnPct,
          expectedReturnPct,
        }
      }

      return {
        row,
        direction: expectedReturnPct >= params.longThresholdPct ? 1 : expectedReturnPct <= params.shortThresholdPct ? -1 : 0,
        rank: Math.abs(expectedReturnPct),
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

function rankResult(result) {
  const minTradePenalty = result.metrics.tradeCount >= MIN_TRADES_FOR_PRIMARY_RANK ? 0 : -10000
  return minTradePenalty + result.metrics.totalReturnPct + result.metrics.sharpe * 2 + result.metrics.maxDrawdownPct * 0.25
}

function betterResult(a, b) {
  if (!b) return true
  return rankResult(a) > rankResult(b)
}

function sourceFilteredRows(rows, sourceIds) {
  const allowed = new Set(sourceIds)
  return rows.filter((row) => allowed.has(row.sourceId))
}

function windowFilteredRows(rows, windows) {
  const allowed = new Set(windows)
  return rows.filter((row) => allowed.has(row.windowId))
}

function summarizeStrategy(id, label, params, trades, extras = {}) {
  return {
    id,
    label,
    variant: params.variant,
    universe: params.universe,
    theoryAlignment: params.theoryAlignment,
    params,
    metrics: tradeMetrics(trades),
    topTrades: trades
      .slice()
      .sort((a, b) => b.netReturnPct - a.netReturnPct)
      .slice(0, 8)
      .map(formatTrade),
    worstTrades: trades
      .slice()
      .sort((a, b) => a.netReturnPct - b.netReturnPct)
      .slice(0, 5)
      .map(formatTrade),
    trades,
    ...extras,
  }
}

function formatTrade(trade) {
  return {
    issueDate: trade.row.issueDate,
    entryTradeDate: trade.row.entryTradeDate,
    targetTradeDate: trade.row.targetTradeDate,
    windowId: trade.row.windowId,
    sourceId: trade.row.sourceId,
    leadDays: trade.row.leadDays,
    direction: trade.direction === 1 ? 'long' : 'short',
    netReturnPct: round(trade.netReturnPct, 3),
    grossReturnPct: round(trade.grossReturnPct, 3),
    rank: round(trade.rank, 4),
    weightedAnomalyF: round(trade.row.weightedAnomalyF, 3),
    coveragePct: round(trade.row.coveragePct, 3),
    extremeCount: trade.row.extremeCount,
  }
}

function optimizeRuleBaseline(rows, subsets, variant) {
  let best = null
  const windowsGrid = [['rumor'], ['selloff'], ['rumor', 'selloff']]
  const anomalyGrid = variant.strictTheory ? [-8, -10, -12, -14, -16] : [-2, -4, -6, -8, -10, -12, -14, -16]
  const coverageGrid = variant.strictTheory ? [0.55, 0.7, 0.85] : [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85]
  const extremeGrid = [0, 1, 2, 4, 6, 8]
  const directionModes = variant.strictTheory ? ['theory'] : ['long', 'short', 'theory', 'contrarian-theory']
  const variantRows = rowsForVariant(rows, variant)

  for (const subset of subsets) {
    const sourceRows = sourceFilteredRows(variantRows, subset.sourceIds)
    for (const windows of windowsGrid) {
      const scopedRows = windowFilteredRows(sourceRows, windows)
      for (const maxWeightedAnomalyF of anomalyGrid) {
        for (const minCoveragePct of coverageGrid) {
          for (const minExtremeCount of extremeGrid) {
            const baseRows = scopedRows.filter(
              (row) =>
                row.weightedAnomalyF <= maxWeightedAnomalyF &&
                row.coveragePct >= minCoveragePct &&
                row.extremeCount >= minExtremeCount,
            )
            if (!baseRows.length) continue
            for (const directionMode of directionModes) {
              const candidates = baseRows.map((row) => {
                const coldStrength = Math.max(0, -row.weightedAnomalyF)
                return {
                  row,
                  direction: candidateDirection(row, directionMode),
                  rank: coldStrength * (0.5 + row.coveragePct) + row.extremeCount * 0.2,
                }
              })
              const trades = resolveTrades(candidates)
              const result = summarizeStrategy(strategyId('rule-arctic-threshold', variant), strategyLabel('Rule-based Arctic Blast threshold baseline', variant), variantParams(variant, {
                subset: subset.id,
                sourceIds: subset.sourceIds,
                windows,
                maxWeightedAnomalyF,
                minCoveragePct,
                minExtremeCount,
                directionMode,
                overlapPolicy: 'one best-ranked trade per entry date; no overlapping holding windows',
              }), trades)
              if (betterResult(result, best)) best = result
            }
          }
        }
      }
    }
  }
  return best
}

function trainTestRows(rows) {
  const train = rows.filter((row) => row.issueDate < TRAIN_CUTOFF)
  const test = rows.filter((row) => row.issueDate >= TRAIN_CUTOFF)
  return { train, test }
}

function minModelSamples(variant) {
  return variant.strictTheory ? { train: 20, test: 20 } : { train: 200, test: 40 }
}

function minMetaSamples(variant) {
  return variant.strictTheory ? { train: 12, test: 8 } : { train: 80, test: 20 }
}

function minTreeLeaf(trainLength, variant) {
  return variant.strictTheory ? Math.max(4, Math.floor(trainLength * 0.08)) : Math.max(12, Math.floor(trainLength * 0.012))
}

function optimizeLogistic(rows, subsets, variant) {
  let best = null
  const namesBySubset = new Map(subsets.map((subset) => [subset.id, featureNames(subset.sourceIds)]))
  const lambdaGrid = [0, 0.0005, 0.002, 0.008, 0.03]
  const l1RatioGrid = [0, 0.25, 0.7]
  const longThresholdGrid = [0.52, 0.56, 0.6, 0.65, 0.7]
  const shortThresholdGrid = [0.3, 0.35, 0.4, 0.44, 0.48]
  const directionModes = ['long-probability', 'signed-probability']
  const variantRows = rowsForVariant(rows, variant)

  for (const subset of subsets) {
    const scopedRows = sourceFilteredRows(variantRows, subset.sourceIds)
    const { train, test } = trainTestRows(scopedRows)
    const minSamples = minModelSamples(variant)
    if (train.length < minSamples.train || test.length < minSamples.test) continue
    for (const lambda of lambdaGrid) {
      for (const l1Ratio of l1RatioGrid) {
        for (const classBalance of [false, true]) {
          const params = { lambda, l1Ratio, classBalance, learningRate: 0.08, iterations: 280 }
          const model = trainLogistic(modelTrainingRows(train, variant), subset.sourceIds, params)
          const scored = test.map((row) => ({ row, probability: model.predict(row) }))
          if (variant.strictTheory) {
            for (const acceptThreshold of longThresholdGrid) {
              const strategyParams = variantParams(variant, {
                subset: subset.id,
                sourceIds: subset.sourceIds,
                trainCutoff: TRAIN_CUTOFF,
                lambda,
                l1Ratio,
                classBalance,
                trainRows: train.length,
                testRows: test.length,
                acceptThreshold,
                directionMode: 'theory-fixed',
                target: 'theory-aligned returnPctEntryCloseToTarget > roundTripCostPct',
                overlapPolicy: 'one best-ranked trade per entry date; no overlapping holding windows',
              })
              const trades = resolveTrades(probabilityCandidates(scored, variant, strategyParams))
              const result = summarizeStrategy(
                strategyId('regularized-logistic-regression', variant),
                strategyLabel('Regularized Logistic Regression', variant),
                strategyParams,
                trades,
                {
                  coefficients: coefficientSummary(model, namesBySubset.get(subset.id)),
                },
              )
              if (betterResult(result, best)) best = result
            }
            continue
          }
          for (const directionMode of directionModes) {
            for (const longThreshold of longThresholdGrid) {
              for (const shortThreshold of shortThresholdGrid) {
                const strategyParams = variantParams(variant, {
                  subset: subset.id,
                  sourceIds: subset.sourceIds,
                  trainCutoff: TRAIN_CUTOFF,
                  lambda,
                  l1Ratio,
                  classBalance,
                  trainRows: train.length,
                  testRows: test.length,
                  longThreshold,
                  shortThreshold,
                  directionMode,
                  target: 'returnPctEntryCloseToTarget > roundTripCostPct',
                  overlapPolicy: 'one best-ranked trade per entry date; no overlapping holding windows',
                })
                const trades = resolveTrades(probabilityCandidates(scored, variant, strategyParams))
                const result = summarizeStrategy(strategyId('regularized-logistic-regression', variant), strategyLabel('Regularized Logistic Regression', variant), strategyParams, trades, {
                  coefficients: coefficientSummary(model, namesBySubset.get(subset.id)),
                })
                if (betterResult(result, best)) best = result
              }
            }
          }
        }
      }
    }
  }
  return best
}

function optimizeElasticNet(rows, subsets, variant) {
  let best = null
  const namesBySubset = new Map(subsets.map((subset) => [subset.id, featureNames(subset.sourceIds)]))
  const alphaGrid = [0, 0.0005, 0.002, 0.008, 0.03]
  const l1RatioGrid = [0, 0.25, 0.5, 0.8]
  const longThresholdGrid = [0.15, 0.3, 0.5, 0.8, 1.2]
  const shortThresholdGrid = [-0.15, -0.3, -0.5, -0.8, -1.2]
  const variantRows = rowsForVariant(rows, variant)

  for (const subset of subsets) {
    const scopedRows = sourceFilteredRows(variantRows, subset.sourceIds)
    const { train, test } = trainTestRows(scopedRows)
    const minSamples = minModelSamples(variant)
    if (train.length < minSamples.train || test.length < minSamples.test) continue
    for (const alpha of alphaGrid) {
      for (const l1Ratio of l1RatioGrid) {
        const params = { alpha, l1Ratio, learningRate: 0.035, iterations: 380 }
        const model = trainElasticNet(modelTrainingRows(train, variant), subset.sourceIds, params)
        const scored = test.map((row) => ({ row, expectedReturnPct: model.predict(row) }))
        if (variant.strictTheory) {
          for (const minExpectedTheoryReturnPct of longThresholdGrid) {
            const strategyParams = variantParams(variant, {
              subset: subset.id,
              sourceIds: subset.sourceIds,
              trainCutoff: TRAIN_CUTOFF,
              alpha,
              l1Ratio,
              trainRows: train.length,
              testRows: test.length,
              minExpectedTheoryReturnPct,
              directionMode: 'theory-fixed',
              target: 'theory-aligned returnPctEntryCloseToTarget',
              overlapPolicy: 'one best-ranked trade per entry date; no overlapping holding windows',
            })
            const trades = resolveTrades(expectedReturnCandidates(scored, variant, strategyParams))
            const result = summarizeStrategy(
              strategyId('elastic-net-expected-return', variant),
              strategyLabel('Elastic Net expected-return regression', variant),
              strategyParams,
              trades,
              {
                coefficients: coefficientSummary(model, namesBySubset.get(subset.id)),
              },
            )
            if (betterResult(result, best)) best = result
          }
          continue
        }
        for (const longThresholdPct of longThresholdGrid) {
          for (const shortThresholdPct of shortThresholdGrid) {
            const strategyParams = variantParams(variant, {
              subset: subset.id,
              sourceIds: subset.sourceIds,
              trainCutoff: TRAIN_CUTOFF,
              alpha,
              l1Ratio,
              trainRows: train.length,
              testRows: test.length,
              longThresholdPct,
              shortThresholdPct,
              target: 'returnPctEntryCloseToTarget',
              overlapPolicy: 'one best-ranked trade per entry date; no overlapping holding windows',
            })
            const trades = resolveTrades(expectedReturnCandidates(scored, variant, strategyParams))
            const result = summarizeStrategy(strategyId('elastic-net-expected-return', variant), strategyLabel('Elastic Net expected-return regression', variant), strategyParams, trades, {
              coefficients: coefficientSummary(model, namesBySubset.get(subset.id)),
            })
            if (betterResult(result, best)) best = result
          }
        }
      }
    }
  }
  return best
}

function optimizeGradientBoostedTrees(rows, subsets, variant) {
  let best = null
  const estimatorGrid = [20, 45, 75]
  const depthGrid = [1, 2, 3]
  const learningRateGrid = [0.04, 0.08, 0.14]
  const longThresholdGrid = [0.1, 0.25, 0.5, 0.8, 1.2]
  const shortThresholdGrid = [-0.1, -0.25, -0.5, -0.8, -1.2]
  const variantRows = rowsForVariant(rows, variant)

  for (const subset of subsets) {
    const scopedRows = sourceFilteredRows(variantRows, subset.sourceIds)
    const { train, test } = trainTestRows(scopedRows)
    const minSamples = minModelSamples(variant)
    if (train.length < minSamples.train || test.length < minSamples.test) continue
    for (const estimators of estimatorGrid) {
      for (const maxDepth of depthGrid) {
        for (const learningRate of learningRateGrid) {
          const minLeaf = minTreeLeaf(train.length, variant)
          const model = trainGradientBoostedTrees(modelTrainingRows(train, variant), subset.sourceIds, { estimators, maxDepth, learningRate, minLeaf })
          const scored = test.map((row) => ({ row, expectedReturnPct: model.predict(row) }))
          if (variant.strictTheory) {
            for (const minExpectedTheoryReturnPct of longThresholdGrid) {
              const strategyParams = variantParams(variant, {
                subset: subset.id,
                sourceIds: subset.sourceIds,
                trainCutoff: TRAIN_CUTOFF,
                estimators,
                maxDepth,
                learningRate,
                minLeaf,
                trainRows: train.length,
                testRows: test.length,
                minExpectedTheoryReturnPct,
                directionMode: 'theory-fixed',
                target: 'theory-aligned returnPctEntryCloseToTarget',
                overlapPolicy: 'one best-ranked trade per entry date; no overlapping holding windows',
              })
              const trades = resolveTrades(expectedReturnCandidates(scored, variant, strategyParams))
              const result = summarizeStrategy(
                strategyId('gradient-boosted-trees', variant),
                strategyLabel('Gradient Boosted Trees', variant),
                strategyParams,
                trades,
                {
                  modelNotes: 'Dependency-free gradient boosting over shallow regression trees.',
                },
              )
              if (betterResult(result, best)) best = result
            }
            continue
          }
          for (const longThresholdPct of longThresholdGrid) {
            for (const shortThresholdPct of shortThresholdGrid) {
              const strategyParams = variantParams(variant, {
                subset: subset.id,
                sourceIds: subset.sourceIds,
                trainCutoff: TRAIN_CUTOFF,
                estimators,
                maxDepth,
                learningRate,
                minLeaf,
                trainRows: train.length,
                testRows: test.length,
                longThresholdPct,
                shortThresholdPct,
                target: 'returnPctEntryCloseToTarget',
                overlapPolicy: 'one best-ranked trade per entry date; no overlapping holding windows',
              })
              const trades = resolveTrades(expectedReturnCandidates(scored, variant, strategyParams))
              const result = summarizeStrategy(strategyId('gradient-boosted-trees', variant), strategyLabel('Gradient Boosted Trees', variant), strategyParams, trades, {
                modelNotes: 'Dependency-free gradient boosting over shallow regression trees.',
              })
              if (betterResult(result, best)) best = result
            }
          }
        }
      }
    }
  }
  return best
}

function baseMetaCandidates(rows, params) {
  const scoped = windowFilteredRows(rows, params.windows)
  return scoped
    .filter(
      (row) =>
        row.weightedAnomalyF <= params.maxWeightedAnomalyF &&
        row.coveragePct >= params.minCoveragePct &&
        row.extremeCount >= params.minExtremeCount,
    )
    .map((row) => ({
      row,
      baseDirection: candidateDirection(row, params.directionMode),
      baseRank: Math.max(0, -row.weightedAnomalyF) * (0.5 + row.coveragePct) + row.extremeCount * 0.2,
      baseProfitPct: candidateDirection(row, params.directionMode) * row.returnPct - ROUND_TRIP_COST_PCT,
    }))
    .filter((candidate) => candidate.baseDirection)
}

function optimizeMetaLabel(rows, subsets, variant) {
  let best = null
  const baseParamGrid = variant.strictTheory
    ? [
        { windows: ['rumor', 'selloff'], directionMode: 'theory', maxWeightedAnomalyF: -8, minCoveragePct: 0.55, minExtremeCount: 0 },
        { windows: ['rumor', 'selloff'], directionMode: 'theory', maxWeightedAnomalyF: -10, minCoveragePct: 0.55, minExtremeCount: 0 },
        { windows: ['rumor', 'selloff'], directionMode: 'theory', maxWeightedAnomalyF: -8, minCoveragePct: 0.7, minExtremeCount: 0 },
        { windows: ['rumor'], directionMode: 'theory', maxWeightedAnomalyF: -8, minCoveragePct: 0.55, minExtremeCount: 0 },
        { windows: ['selloff'], directionMode: 'theory', maxWeightedAnomalyF: -8, minCoveragePct: 0.55, minExtremeCount: 0 },
      ]
    : [
        { windows: ['rumor', 'selloff'], directionMode: 'theory', maxWeightedAnomalyF: -2, minCoveragePct: 0, minExtremeCount: 0 },
        { windows: ['rumor', 'selloff'], directionMode: 'theory', maxWeightedAnomalyF: -4, minCoveragePct: 0.1, minExtremeCount: 0 },
        { windows: ['rumor', 'selloff'], directionMode: 'theory', maxWeightedAnomalyF: -6, minCoveragePct: 0.25, minExtremeCount: 1 },
        { windows: ['rumor'], directionMode: 'long', maxWeightedAnomalyF: -4, minCoveragePct: 0.1, minExtremeCount: 0 },
        { windows: ['selloff'], directionMode: 'short', maxWeightedAnomalyF: -4, minCoveragePct: 0.1, minExtremeCount: 0 },
      ]
  const lambdaGrid = [0, 0.002, 0.008, 0.03]
  const acceptThresholdGrid = [0.5, 0.55, 0.6, 0.65, 0.7]
  const variantRows = rowsForVariant(rows, variant)

  for (const subset of subsets) {
    const scopedRows = sourceFilteredRows(variantRows, subset.sourceIds)
    for (const baseParams of baseParamGrid) {
      const candidates = baseMetaCandidates(scopedRows, baseParams)
      const train = candidates.filter((candidate) => candidate.row.issueDate < TRAIN_CUTOFF)
      const test = candidates.filter((candidate) => candidate.row.issueDate >= TRAIN_CUTOFF)
      const minSamples = minMetaSamples(variant)
      if (train.length < minSamples.train || test.length < minSamples.test) continue
      const trainRows = train.map((candidate) => ({
        ...candidate.row,
        returnPct: candidate.baseProfitPct,
      }))
      const testRows = test.map((candidate) => ({
        ...candidate.row,
        baseDirection: candidate.baseDirection,
        baseRank: candidate.baseRank,
        returnPct: candidate.baseProfitPct,
      }))

      for (const lambda of lambdaGrid) {
        const model = trainLogistic(trainRows, subset.sourceIds, {
          lambda,
          l1Ratio: 0.25,
          classBalance: true,
          learningRate: 0.08,
          iterations: 260,
        })
        const scored = testRows.map((row) => ({ row, acceptProbability: model.predict(row) }))
        for (const acceptThreshold of acceptThresholdGrid) {
          const accepted = scored
            .map(({ row, acceptProbability }) => ({
              row,
              direction: row.baseDirection,
              rank: acceptProbability * (1 + row.baseRank / 10),
              acceptProbability,
            }))
            .filter((candidate) => candidate.acceptProbability >= acceptThreshold)
          const trades = resolveTrades(accepted)
          const result = summarizeStrategy(strategyId('meta-label-trade-filter', variant), strategyLabel('Meta-labeling trade filter', variant), variantParams(variant, {
            subset: subset.id,
            sourceIds: subset.sourceIds,
            trainCutoff: TRAIN_CUTOFF,
            baseRule: baseParams,
            lambda,
            l1Ratio: 0.25,
            classBalance: true,
            trainRows: train.length,
            testRows: test.length,
            acceptThreshold,
            target: 'base candidate net return > 0',
            overlapPolicy: 'one best-ranked accepted trade per entry date; no overlapping holding windows',
          }), trades, {
            coefficients: coefficientSummary(model, featureNames(subset.sourceIds)),
          })
          if (betterResult(result, best)) best = result
        }
      }
    }
  }
  return best
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function writeTradeCsv(strategy) {
  const rows = strategy.trades.map((trade) => ({
    strategyId: strategy.id,
    variant: strategy.variant,
    issueDate: trade.row.issueDate,
    targetDate: trade.row.targetDate,
    entryTradeDate: trade.row.entryTradeDate,
    targetTradeDate: trade.row.targetTradeDate,
    sourceId: trade.row.sourceId,
    windowId: trade.row.windowId,
    leadDays: trade.row.leadDays,
    direction: trade.direction === 1 ? 'long' : 'short',
    weightedAnomalyF: round(trade.row.weightedAnomalyF, 3),
    coveragePct: round(trade.row.coveragePct, 3),
    extremeCount: trade.row.extremeCount,
    grossReturnPct: round(trade.grossReturnPct, 4),
    netReturnPct: round(trade.netReturnPct, 4),
    rank: round(trade.rank, 5),
  }))
  const headers = Object.keys(rows[0] ?? {
    strategyId: '',
    variant: '',
    issueDate: '',
    targetDate: '',
    entryTradeDate: '',
    targetTradeDate: '',
    sourceId: '',
    windowId: '',
    leadDays: '',
    direction: '',
    weightedAnomalyF: '',
    coveragePct: '',
    extremeCount: '',
    grossReturnPct: '',
    netReturnPct: '',
    rank: '',
  })
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')
  const outPath = path.join(OUTPUT_DIR, `${strategy.id}-trades.csv`)
  fs.writeFileSync(outPath, `${csv}\n`)
  return path.relative(REPO_ROOT, outPath)
}

function writeSummaryCsv(strategies) {
  const rows = strategies.map((strategy) => ({
    strategyId: strategy.id,
    variant: strategy.variant,
    label: strategy.label,
    universe: strategy.universe,
    theoryAlignment: strategy.theoryAlignment,
    samplePolicy: strategy.params.samplePolicy,
    totalReturnPct: strategy.metrics.totalReturnPct,
    cagrPct: strategy.metrics.cagrPct,
    sharpe: strategy.metrics.sharpe,
    sortino: strategy.metrics.sortino,
    maxDrawdownPct: strategy.metrics.maxDrawdownPct,
    winRatePct: strategy.metrics.winRatePct,
    profitFactor: strategy.metrics.profitFactor,
    tradeCount: strategy.metrics.tradeCount,
    averageTradeReturnPct: strategy.metrics.averageTradeReturnPct,
    averageHoldDays: strategy.metrics.averageHoldDays,
    firstEntry: strategy.metrics.firstEntry,
    lastExit: strategy.metrics.lastExit,
    tradeFile: strategy.tradeFile,
  }))
  const headers = [
    'strategyId',
    'variant',
    'label',
    'universe',
    'theoryAlignment',
    'samplePolicy',
    'totalReturnPct',
    'cagrPct',
    'sharpe',
    'sortino',
    'maxDrawdownPct',
    'winRatePct',
    'profitFactor',
    'tradeCount',
    'averageTradeReturnPct',
    'averageHoldDays',
    'firstEntry',
    'lastExit',
    'tradeFile',
  ]
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')
  const outPath = path.join(OUTPUT_DIR, 'arctic-blast-strategy-baselines.csv')
  fs.writeFileSync(outPath, `${csv}\n`)
  return path.relative(REPO_ROOT, outPath)
}

function stripTrades(strategy) {
  const { trades, ...rest } = strategy
  return {
    ...rest,
    tradeFile: writeTradeCsv(strategy),
  }
}

function resetOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  for (const fileName of fs.readdirSync(OUTPUT_DIR)) {
    if (fileName === 'arctic-blast-strategy-baselines.csv' || fileName === 'arctic-blast-strategy-baselines.json' || fileName.endsWith('-trades.csv')) {
      fs.unlinkSync(path.join(OUTPUT_DIR, fileName))
    }
  }
}

function main() {
  const { manifest, rows, sourceIds, inputFiles } = loadRows()
  const subsets = sourceSubsets(sourceIds)
  resetOutputDir()

  const optimizers = [
    optimizeRuleBaseline,
    optimizeLogistic,
    optimizeElasticNet,
    optimizeGradientBoostedTrees,
    optimizeMetaLabel,
  ]
  const strategies = optimizers.flatMap((optimizer) => VARIANTS.map((variant) => optimizer(rows, subsets, variant))).filter(Boolean)

  if (strategies.length !== optimizers.length * VARIANTS.length) {
    throw new Error(`Expected ${optimizers.length * VARIANTS.length} strategy variants, generated ${strategies.length}`)
  }

  const strippedStrategies = strategies.map(stripTrades)
  const summaryCsvPath = writeSummaryCsv(strippedStrategies)
  const summary = {
    generatedAt: new Date().toISOString(),
    theory: 'Arctic Blast forecast windows for UNG: buy the 7-10 day rumor, test the 1-3 day selloff/fade window.',
    dataRoot: path.relative(REPO_ROOT, DATA_ROOT),
    inputFiles: [...new Set(inputFiles)].sort(),
    timingContract: {
      convention: 'close-after-issue-v1',
      returnColumn: 'returnPctEntryCloseToTarget',
      rejectedLookaheadRows: 'Rows must have entryTradeDate > issueDate, targetTradeDate >= targetDate, and targetTradeDate > entryTradeDate.',
      symbol: 'UNG',
    },
    optimizationNotes: [
      'Each strategy was optimized on the shared forecast signal-score plus signal-return rows.',
      'Strict Theory variants only trade score-qualified Arctic Blast rows and fix direction to the theory.md thesis: long the 7-10 day rumor window and short the 1-3 day selloff window.',
      'Experimental variants keep the previous unconstrained search space and may include non-Arctic or non-theory trades.',
      'ML strategies train before 2024-01-01 and report post-cutoff trades to reduce lookahead during model fitting.',
      'The grid search ranks realized strategy returns, so treat these as optimized research baselines rather than clean out-of-sample production proof.',
      'Trade selection permits one best-ranked trade per entry date and rejects overlapping holding windows.',
      `Round-trip friction is ${ROUND_TRIP_COST_PCT}% per trade.`,
      'These are first-pass research baselines on UNG ETF history, not futures-grade Henry Hub contract results.',
    ],
    dataset: {
      forecastCalendars: manifest.forecastCalendars.map((calendar) => ({
        id: calendar.id,
        label: calendar.label,
        issueDateRange: calendar.issueDateRange,
        rows: calendar.rows,
      })),
      usableUngRows: rows.length,
      firstIssueDate: rows.map((row) => row.issueDate).sort()[0] ?? null,
      lastIssueDate: rows.map((row) => row.issueDate).sort().at(-1) ?? null,
      strictTheoryRows: rows.filter(isStrictTheoryRow).length,
    },
    summaryCsv: summaryCsvPath,
    strategies: strippedStrategies,
  }

  const summaryPath = path.join(OUTPUT_DIR, 'arctic-blast-strategy-baselines.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

  console.log(`Wrote ${path.relative(REPO_ROOT, summaryPath)}`)
  for (const strategy of summary.strategies) {
    console.log(
      `${strategy.id}: total=${strategy.metrics.totalReturnPct}% sharpe=${strategy.metrics.sharpe} dd=${strategy.metrics.maxDrawdownPct}% trades=${strategy.metrics.tradeCount} file=${strategy.tradeFile}`,
    )
  }
}

main()
