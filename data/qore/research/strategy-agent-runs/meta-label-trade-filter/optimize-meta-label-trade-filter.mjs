import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const BASELINE_CSV_PATH = path.join(DATA_ROOT, 'research/strategy-tests/arctic-blast-strategy-baselines.csv')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/meta-label-trade-filter')

const ROUND_TRIP_COST_PCT = 0.064
const TRAIN_CUTOFF = '2025-11-01'
const VALIDATION_CUTOFF = '2025-01-01'
const COLD_RUMOR_MAX_WEIGHTED_ANOMALY_F = -8
const COLD_RUMOR_MIN_COVERAGE_PCT = 0.55
const WARM_RUMOR_MIN_WEIGHTED_ANOMALY_F = 8
const WARM_RUMOR_MIN_COVERAGE_PCT = 0.6
const WARM_COVERAGE_MIN_ANOMALY_F = 8
const WARM_EXTREME_ANOMALY_F = 14
const WINTER_THESIS_MIN_SOURCE_GROUPS = 2
const WINTER_THESIS_MIN_MODEL_FAMILIES = 2

const BASE_FILTERS = [
  {
    id: 'fixed-theory-gate',
    minSignalStrengthF: 8,
    minCoveragePct: 0.55,
    minExtremeCount: 0,
    rationale: 'Original strict theory gate: 7-10 day severe cold or significant warmth with broad coverage.',
  },
  {
    id: 'broader-coverage',
    minSignalStrengthF: 8,
    minCoveragePct: 0.7,
    minExtremeCount: 0,
    rationale: 'Weather breadth risk filter: require broader geographic confirmation before trusting the trade.',
  },
  {
    id: 'extreme-count-7',
    minSignalStrengthF: 8,
    minCoveragePct: 0.55,
    minExtremeCount: 7,
    rationale: 'Weather severity risk filter: require at least seven extreme-weighted locations.',
  },
]

const MODEL_GRID = [
  { id: 'lambda008-threshold055', lambda: 0.008, acceptThreshold: 0.55 },
  { id: 'lambda008-threshold060', lambda: 0.008, acceptThreshold: 0.6 },
  { id: 'lambda016-threshold055', lambda: 0.016, acceptThreshold: 0.55 },
  { id: 'lambda016-threshold060', lambda: 0.016, acceptThreshold: 0.6 },
  { id: 'lambda004-threshold055', lambda: 0.004, acceptThreshold: 0.55 },
]

const SOURCE_SET_SPECS = [
  {
    id: 'all-confirmed-sources',
    sourceIds: null,
    rationale: 'All rows that passed independent winter-thesis confirmation.',
  },
  {
    id: 'precutoff-trained-sources',
    dynamic: 'has-precutoff-candidates',
    rationale: 'Drops post-only source rows so the classifier is not asked to generalize to a source family it never saw before the cutoff.',
  },
  {
    id: 'core-cross-provider-no-ai',
    sourceIds: ['gfs', 'gefs-mean', 'graphcastgfs', 'ecmwf-ifs', 'gem-global'],
    rationale: 'Cross-provider core: NCEP, ECMWF, and GEM rows; excludes AIGFS and AIFS partial/post-only lanes.',
  },
  {
    id: 'long-history-cross-provider',
    sourceIds: ['gfs', 'gefs-mean', 'ecmwf-ifs', 'gem-global'],
    rationale: 'Smaller cross-provider set with the longest usable history among non-AI model families.',
  },
  {
    id: 'ncep-gem-cross-provider',
    sourceIds: ['gfs', 'gefs-mean', 'gem-global'],
    rationale: 'Uses full-history NCEP rows plus GEM as an independent non-NCEP confirmation family.',
  },
]

const LANES = [
  { id: 'combined', thesisKinds: ['cold-long', 'warm-short'], minValidationTrades: 3, minTestTrades: 6 },
  { id: 'cold-long', thesisKinds: ['cold-long'], minValidationTrades: 2, minTestTrades: 2 },
  { id: 'warm-short', thesisKinds: ['warm-short'], minValidationTrades: 2, minTestTrades: 3 },
]

const INTEGRATION_RECOMMENDATION = {
  action: 'Demote strict-theory-meta-label-trade-filter from the primary strategy shortlist; keep it as a diagnostic research lane only.',
  baselineDecision: 'Do not replace the shared meta-label baseline with the four-trade selected candidate.',
  sleeveDecision: 'Do not integrate separate cold-long or warm-short sleeves yet.',
  rationale: [
    'The selected combined candidate improves the post-cutoff report card by shrinking to four trades, below the fixed six-trade minimum used for primary ranking.',
    'The best six-trade combined candidate is only modestly positive and still carries the December cold-long drawdown.',
    'Cold-long has no validation-usable independent sleeve, while the selected warm-short sleeve loses post-cutoff.',
  ],
  nextProofRequired:
    'Require a longer walk-forward window or at least another winter with six or more non-overlapping post-cutoff trades before promotion.',
}

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

function monthFromIsoDate(isoDate) {
  return Number(isoDate.slice(5, 7))
}

function isHeatingSeasonIssue(isoDate) {
  const month = monthFromIsoDate(isoDate)
  return month <= 3 || month >= 11
}

function isColdRumorWindow(score) {
  return score.windowId === 'rumor' && score.leadDays >= 7 && score.leadDays <= 10
}

function isWarmRumorWindow(score) {
  return score.windowId === 'rumor' && score.leadDays >= 7 && score.leadDays <= 10
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

  if (isWarmRumorWindow(score) && score.weightedAnomalyF >= WARM_RUMOR_MIN_WEIGHTED_ANOMALY_F && score.warmCoveragePct >= WARM_RUMOR_MIN_COVERAGE_PCT) {
    return {
      kind: 'warm-short',
      direction: -1,
      coveragePct: score.warmCoveragePct,
      extremeCount: score.warmExtremeCount,
    }
  }

  return null
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

function winterThesisKey(issueDate, thesisKind) {
  return `${issueDate}|${thesisKind}`
}

function signalStrength(row) {
  if (row.thesisKind === 'warm-short') return Math.max(0, row.weightedAnomalyF)
  return Math.max(0, -row.weightedAnomalyF)
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

function isTradable(row) {
  if (row.symbol !== 'UNG') return false
  if (row.windowId !== expectedWindowIdForLead(row.leadDays)) return false
  if (!row.issueDate || !row.targetDate || !row.entryTradeDate || !row.targetTradeDate) return false
  if (row.entryTradeDate <= row.issueDate) return false
  if (row.targetTradeDate < row.targetDate) return false
  if (row.targetTradeDate <= row.entryTradeDate) return false
  return Number.isFinite(row.returnPct)
}

function loadRows() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const rows = []
  const sourceIds = []
  const inputFiles = []
  const parsedCalendars = []
  const allScores = []
  const timingAudit = {
    ungReturnRows: 0,
    acceptedTradableUngRows: 0,
    rejectedLookaheadOrInvalidUngRows: 0,
    missingScoreRows: 0,
  }

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

  for (const { calendar, returns, scores } of parsedCalendars) {
    for (const ret of returns) {
      const score = scores.get(scoreKey(ret))
      const thesis = score ? winterThesisForScore(score) : null
      const confirmation = score && thesis ? confirmationBySignal.get(winterThesisKey(consensusKey(score), thesis.kind)) : null
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
        scoreQualifies: Boolean(score && thesis && confirmation),
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
        confirmedWinterThesis: Boolean(score && thesis && confirmation),
        confirmedSourceGroups: confirmation?.sourceGroups ?? [],
        confirmedSourceFamilies: confirmation?.sourceFamilies ?? [],
      }

      if (joined.symbol === 'UNG') {
        timingAudit.ungReturnRows += 1
        if (!score) timingAudit.missingScoreRows += 1
        if (score && isTradable(joined)) {
          timingAudit.acceptedTradableUngRows += 1
        } else {
          timingAudit.rejectedLookaheadOrInvalidUngRows += 1
        }
      }

      if (score && isTradable(joined)) rows.push(joined)
    }
  }

  return { manifest, rows, sourceIds, inputFiles: [...new Set(inputFiles)].sort(), timingAudit }
}

function featureNames(sourceIds) {
  return [
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
    ...sourceIds.map((sourceId) => `source:${sourceId}`),
  ]
}

function rawFeatures(row, sourceIds) {
  const coldStrength = Math.max(0, -row.weightedAnomalyF)
  const warmStrength = Math.max(0, row.weightedAnomalyF)
  const thesisStrength = signalStrength(row)
  const doy = dayOfYear(row.issueDate)
  return [
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
  const y = rows.map((row) => (row.returnPct > 0 ? 1 : 0))
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

function coefficientSummary(model, sourceIds, count = 8) {
  return model.weights
    .map((weight, index) => ({ feature: featureNames(sourceIds)[index], weight: round(weight, 5) }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, count)
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

function strictTheoryRows(rows) {
  return rows.filter((row) => row.confirmedWinterThesis)
}

function candidateBaseRows(rows, sourceIds, lane, baseFilter) {
  const allowedSources = new Set(sourceIds)
  const allowedKinds = new Set(lane.thesisKinds)
  return strictTheoryRows(rows)
    .filter(
      (row) =>
        allowedSources.has(row.sourceId) &&
        row.windowId === 'rumor' &&
        allowedKinds.has(row.thesisKind) &&
        signalStrength(row) >= baseFilter.minSignalStrengthF &&
        row.coveragePct >= baseFilter.minCoveragePct &&
        row.extremeCount >= baseFilter.minExtremeCount,
    )
    .map((row) => ({
      row,
      baseDirection: row.thesisDirection,
      baseRank: signalStrength(row) * (0.5 + row.coveragePct) + row.extremeCount * 0.2,
      baseProfitPct: row.thesisDirection * row.returnPct - ROUND_TRIP_COST_PCT,
    }))
    .filter((candidate) => candidate.baseDirection)
}

function candidatesToTrainingRows(candidates) {
  return candidates.map((candidate) => ({
    ...candidate.row,
    returnPct: candidate.baseProfitPct,
  }))
}

function scoreCandidates(model, candidates, acceptThreshold) {
  return candidates
    .map((candidate) => {
      const row = {
        ...candidate.row,
        returnPct: candidate.baseProfitPct,
      }
      const acceptProbability = model.predict(row)
      return {
        row: candidate.row,
        direction: candidate.baseDirection,
        rank: acceptProbability * (1 + candidate.baseRank / 10),
        acceptProbability,
        baseRank: candidate.baseRank,
      }
    })
    .filter((candidate) => candidate.acceptProbability >= acceptThreshold)
}

function validationScore(record, lane) {
  if (!record.validationUsable) return -100000
  const minTradePenalty = record.validation.metrics.tradeCount >= lane.minValidationTrades ? 0 : -10000
  return (
    minTradePenalty +
    record.validation.metrics.totalReturnPct +
    record.validation.metrics.sharpe * 1.5 +
    record.validation.metrics.maxDrawdownPct * 0.2 +
    record.validation.metrics.tradeCount * 0.25
  )
}

function finalScore(record, lane) {
  if (!record.testUsable) return -100000
  const minTradePenalty = record.test.metrics.tradeCount >= lane.minTestTrades ? 0 : -10000
  return (
    minTradePenalty +
    record.test.metrics.totalReturnPct +
    record.test.metrics.sharpe * 1.5 +
    record.test.metrics.maxDrawdownPct * 0.2 +
    record.test.metrics.tradeCount * 0.15
  )
}

function sourceIdsForSpec(spec, allSourceIds, rows, lane) {
  if (spec.dynamic === 'has-precutoff-candidates') {
    const strictRows = strictTheoryRows(rows)
    return allSourceIds.filter((sourceId) =>
      strictRows.some((row) => row.sourceId === sourceId && lane.thesisKinds.includes(row.thesisKind) && row.issueDate < TRAIN_CUTOFF),
    )
  }
  if (spec.sourceIds) return spec.sourceIds.filter((sourceId) => allSourceIds.includes(sourceId))
  return allSourceIds
}

function hasReasonableSourceSpread(sourceIds) {
  const groups = new Set(sourceIds.map(sourceGroupFor))
  const families = new Set(sourceIds.map(sourceFamilyFor))
  return groups.size >= 2 && families.size >= 2
}

function evaluateConfig(rows, allSourceIds, lane, sourceSpec, baseFilter, modelParams) {
  const sourceIds = sourceIdsForSpec(sourceSpec, allSourceIds, rows, lane)
  const candidates = candidateBaseRows(rows, sourceIds, lane, baseFilter)
  const fitForValidation = candidates.filter((candidate) => candidate.row.issueDate < VALIDATION_CUTOFF)
  const validationCandidates = candidates.filter((candidate) => candidate.row.issueDate >= VALIDATION_CUTOFF && candidate.row.issueDate < TRAIN_CUTOFF)
  const fitForTest = candidates.filter((candidate) => candidate.row.issueDate < TRAIN_CUTOFF)
  const testCandidates = candidates.filter((candidate) => candidate.row.issueDate >= TRAIN_CUTOFF)

  const sourceSpreadOk = hasReasonableSourceSpread(sourceIds)
  const enoughValidationFit = fitForValidation.length >= 24
  const enoughFinalFit = fitForTest.length >= 24
  const validation = {
    candidateCount: validationCandidates.length,
    trades: [],
    metrics: tradeMetrics([]),
  }
  const test = {
    candidateCount: testCandidates.length,
    trades: [],
    metrics: tradeMetrics([]),
  }
  let validationCoefficients = []
  let testCoefficients = []

  if (sourceSpreadOk && enoughValidationFit && validationCandidates.length >= lane.minValidationTrades) {
    const validationModel = trainLogistic(candidatesToTrainingRows(fitForValidation), sourceIds, {
      lambda: modelParams.lambda,
      l1Ratio: 0.25,
      classBalance: true,
      learningRate: 0.08,
      iterations: 260,
    })
    validation.trades = resolveTrades(scoreCandidates(validationModel, validationCandidates, modelParams.acceptThreshold))
    validation.metrics = tradeMetrics(validation.trades)
    validationCoefficients = coefficientSummary(validationModel, sourceIds)
  }

  if (sourceSpreadOk && enoughFinalFit && testCandidates.length >= lane.minTestTrades) {
    const testModel = trainLogistic(candidatesToTrainingRows(fitForTest), sourceIds, {
      lambda: modelParams.lambda,
      l1Ratio: 0.25,
      classBalance: true,
      learningRate: 0.08,
      iterations: 260,
    })
    test.trades = resolveTrades(scoreCandidates(testModel, testCandidates, modelParams.acceptThreshold))
    test.metrics = tradeMetrics(test.trades)
    testCoefficients = coefficientSummary(testModel, sourceIds)
  }

  return {
    id: `${lane.id}__${sourceSpec.id}__${baseFilter.id}__${modelParams.id}`,
    lane: lane.id,
    sourceSet: sourceSpec.id,
    sourceIds,
    sourceSetRationale: sourceSpec.rationale,
    sourceSpreadOk,
    baseFilter: baseFilter.id,
    baseFilterRationale: baseFilter.rationale,
    modelParams,
    validationUsable: sourceSpreadOk && enoughValidationFit && validationCandidates.length >= lane.minValidationTrades,
    testUsable: sourceSpreadOk && enoughFinalFit && testCandidates.length >= lane.minTestTrades,
    fitForValidationCount: fitForValidation.length,
    validation,
    fitForTestCount: fitForTest.length,
    test,
    validationCoefficients,
    testCoefficients,
    validationRank: null,
    finalRank: null,
  }
}

function evaluateLane(rows, allSourceIds, lane) {
  const records = []
  for (const sourceSpec of SOURCE_SET_SPECS) {
    for (const baseFilter of BASE_FILTERS) {
      for (const modelParams of MODEL_GRID) {
        const record = evaluateConfig(rows, allSourceIds, lane, sourceSpec, baseFilter, modelParams)
        record.validationRank = round(validationScore(record, lane), 4)
        record.finalRank = round(finalScore(record, lane), 4)
        records.push(record)
      }
    }
  }

  const selected =
    records
      .filter((record) => record.validationUsable && record.validation.metrics.tradeCount >= lane.minValidationTrades)
      .sort((a, b) => b.validationRank - a.validationRank)[0] ?? null
  return { lane: lane.id, selectedId: selected?.id ?? null, records }
}

function selectedTradeRows(strategyId, trades) {
  return trades.map((trade) => ({
    strategyId,
    issueDate: trade.row.issueDate,
    targetDate: trade.row.targetDate,
    entryTradeDate: trade.row.entryTradeDate,
    targetTradeDate: trade.row.targetTradeDate,
    sourceId: trade.row.sourceId,
    sourceGroup: trade.row.sourceGroup,
    thesisKind: trade.row.thesisKind,
    leadDays: trade.row.leadDays,
    direction: trade.direction === 1 ? 'long' : 'short',
    weightedAnomalyF: round(trade.row.weightedAnomalyF, 3),
    coveragePct: round(trade.row.coveragePct, 3),
    extremeCount: trade.row.extremeCount,
    acceptProbability: round(trade.acceptProbability, 5),
    grossReturnPct: round(trade.grossReturnPct, 4),
    netReturnPct: round(trade.netReturnPct, 4),
    rank: round(trade.rank, 5),
  }))
}

function selectedRecord(laneResult) {
  return laneResult.records.find((record) => record.id === laneResult.selectedId) ?? null
}

function minimumTradeEligibleRecord(laneResult) {
  const lane = LANES.find((entry) => entry.id === laneResult.lane)
  if (!lane) return null
  return (
    laneResult.records
      .filter(
        (record) =>
          record.validationUsable &&
          record.validation.metrics.tradeCount >= lane.minValidationTrades &&
          record.test.metrics.tradeCount >= lane.minTestTrades,
      )
      .sort((a, b) => b.validationRank - a.validationRank)[0] ?? null
  )
}

function buildSideSeparateCandidate(coldSelected, warmSelected) {
  if (!coldSelected || !warmSelected) return null
  const trades = resolveTrades([...coldSelected.test.trades, ...warmSelected.test.trades])
  return {
    id: 'side-separate-selected-meta-label',
    lane: 'side-separate-combined',
    selectedFrom: {
      coldLong: coldSelected.id,
      warmShort: warmSelected.id,
    },
    test: {
      trades,
      metrics: tradeMetrics(trades),
    },
    validationNotes: 'Cold-long and warm-short filters were selected independently on pre-cutoff validation, then merged for post-cutoff scoring.',
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function writeCsv(filePath, rows, headers) {
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')
  fs.writeFileSync(filePath, `${csv}\n`)
}

function flattenResultRows(laneResults) {
  return laneResults.flatMap((laneResult) =>
    laneResult.records.map((record) => ({
      selectedForLane: record.id === laneResult.selectedId,
      lane: record.lane,
      sourceSet: record.sourceSet,
      sourceIds: record.sourceIds,
      baseFilter: record.baseFilter,
      modelGrid: record.modelParams.id,
      lambda: record.modelParams.lambda,
      acceptThreshold: record.modelParams.acceptThreshold,
      sourceSpreadOk: record.sourceSpreadOk,
      fitForValidationCount: record.fitForValidationCount,
      validationCandidateCount: record.validation.candidateCount,
      validationTradeCount: record.validation.metrics.tradeCount,
      validationTotalReturnPct: record.validation.metrics.totalReturnPct,
      validationSharpe: record.validation.metrics.sharpe,
      validationMaxDrawdownPct: record.validation.metrics.maxDrawdownPct,
      validationRank: record.validationRank,
      fitForTestCount: record.fitForTestCount,
      testCandidateCount: record.test.candidateCount,
      testTradeCount: record.test.metrics.tradeCount,
      testTotalReturnPct: record.test.metrics.totalReturnPct,
      testSharpe: record.test.metrics.sharpe,
      testMaxDrawdownPct: record.test.metrics.maxDrawdownPct,
      testWinRatePct: record.test.metrics.winRatePct,
      testProfitFactor: record.test.metrics.profitFactor,
      finalRank: record.finalRank,
      firstEntry: record.test.metrics.firstEntry,
      lastExit: record.test.metrics.lastExit,
      recordId: record.id,
    })),
  )
}

function baselineMetaMetrics() {
  if (!fs.existsSync(BASELINE_CSV_PATH)) return null
  const row = parseCsv(BASELINE_CSV_PATH).find((entry) => entry.strategyId === 'strict-theory-meta-label-trade-filter')
  if (!row) return null
  return {
    strategyId: row.strategyId,
    totalReturnPct: numberFrom(row.totalReturnPct, Number.NaN),
    sharpe: numberFrom(row.sharpe, Number.NaN),
    maxDrawdownPct: numberFrom(row.maxDrawdownPct, Number.NaN),
    tradeCount: numberFrom(row.tradeCount, Number.NaN),
    winRatePct: numberFrom(row.winRatePct, Number.NaN),
    firstEntry: row.firstEntry,
    lastExit: row.lastExit,
  }
}

function formatMetrics(metrics) {
  return `${metrics.totalReturnPct}% total, ${metrics.tradeCount} trades, ${metrics.winRatePct}% win, ${metrics.maxDrawdownPct}% maxDD, Sharpe ${metrics.sharpe}`
}

function markdownCell(value) {
  if (value === null || value === undefined) return ''
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

function markdownTable(rows, headers) {
  const headerLine = `| ${headers.map(markdownCell).join(' | ')} |`
  const divider = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${headers.map((header) => markdownCell(row[header])).join(' | ')} |`)
  return [headerLine, divider, ...body].join('\n')
}

function writeReport({ laneResults, sideSeparate, baseline, timingAudit, manifest, selectedRowsPath, minimumTradeRowsPath, summaryCsvPath, resultsJsonPath }) {
  const selectedRows = laneResults.map((laneResult) => {
    const selected = selectedRecord(laneResult)
    return {
      lane: laneResult.lane,
      selected: selected ? `${selected.sourceSet} / ${selected.baseFilter} / ${selected.modelParams.id}` : 'none',
      validation: selected ? formatMetrics(selected.validation.metrics) : 'n/a',
      test: selected ? formatMetrics(selected.test.metrics) : 'n/a',
      sourceIds: selected ? selected.sourceIds.join('|') : '',
    }
  })
  const minimumTradeRows = laneResults.map((laneResult) => {
    const eligible = minimumTradeEligibleRecord(laneResult)
    const lane = LANES.find((entry) => entry.id === laneResult.lane)
    return {
      lane: laneResult.lane,
      minimumTrades: lane?.minTestTrades ?? '',
      selected: eligible ? `${eligible.sourceSet} / ${eligible.baseFilter} / ${eligible.modelParams.id}` : 'none',
      validation: eligible ? formatMetrics(eligible.validation.metrics) : 'n/a',
      test: eligible ? formatMetrics(eligible.test.metrics) : 'n/a',
      sourceIds: eligible ? eligible.sourceIds.join('|') : '',
    }
  })

  if (sideSeparate) {
    selectedRows.push({
      lane: sideSeparate.lane,
      selected: 'cold and warm filters selected independently, then merged',
      validation: sideSeparate.validationNotes,
      test: formatMetrics(sideSeparate.test.metrics),
      sourceIds: 'see selected cold/warm records',
    })
  }

  const combinedSelected = selectedRecord(laneResults.find((laneResult) => laneResult.lane === 'combined'))
  const coldSelected = selectedRecord(laneResults.find((laneResult) => laneResult.lane === 'cold-long'))
  const warmSelected = selectedRecord(laneResults.find((laneResult) => laneResult.lane === 'warm-short'))
  const bestPost = [combinedSelected, coldSelected, warmSelected, sideSeparate]
    .filter(Boolean)
    .sort((a, b) => {
      const aMetrics = a.test?.metrics ?? a.test.metrics
      const bMetrics = b.test?.metrics ?? b.test.metrics
      return bMetrics.totalReturnPct - aMetrics.totalReturnPct
    })[0]
  const bestPostMetrics = bestPost?.test?.metrics ?? bestPost?.test.metrics
  const bestMinimumTradeCombined = minimumTradeEligibleRecord(laneResults.find((laneResult) => laneResult.lane === 'combined'))

  const replacementVerdict =
    sideSeparate && baseline && sideSeparate.test.metrics.totalReturnPct > baseline.totalReturnPct && sideSeparate.test.metrics.tradeCount >= 6
      ? 'Do not replace the shared baseline yet. The selected side-separate risk filter improves the post-cutoff report card, but the out-of-sample window is still one winter with only a handful of non-overlapping trades.'
      : 'Do not replace the shared baseline. Use this as a risk-filter diagnostic unless a longer walk-forward window confirms it.'

  const lines = [
    '# Meta-label trade filter optimization',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Verdict',
    '',
    replacementVerdict,
    '',
    baseline
      ? `Current shared meta-label baseline: ${baseline.totalReturnPct}% total, ${baseline.tradeCount} post-cutoff trades, ${baseline.maxDrawdownPct}% maxDD, Sharpe ${baseline.sharpe}.`
      : 'Current shared meta-label baseline was not found in the shared summary CSV.',
    bestPostMetrics ? `Best validation-selected post-cutoff report card in this run: ${formatMetrics(bestPostMetrics)}.` : '',
    bestMinimumTradeCombined
      ? `Best combined candidate that clears the fixed six-trade post-cutoff minimum: ${formatMetrics(bestMinimumTradeCombined.test.metrics)}.`
      : 'No combined candidate cleared the fixed six-trade post-cutoff minimum.',
    '',
    '## Integration recommendation',
    '',
    `- Action: ${INTEGRATION_RECOMMENDATION.action}`,
    `- Baseline decision: ${INTEGRATION_RECOMMENDATION.baselineDecision}`,
    `- Sleeve decision: ${INTEGRATION_RECOMMENDATION.sleeveDecision}`,
    ...INTEGRATION_RECOMMENDATION.rationale.map((entry) => `- Evidence: ${entry}`),
    `- Promotion gate: ${INTEGRATION_RECOMMENDATION.nextProofRequired}`,
    '',
    '## Selected lanes',
    '',
    markdownTable(selectedRows, ['lane', 'selected', 'validation', 'test', 'sourceIds']),
    '',
    '## Minimum-trade candidates',
    '',
    markdownTable(minimumTradeRows, ['lane', 'minimumTrades', 'selected', 'validation', 'test', 'sourceIds']),
    '',
    '## Overfit controls',
    '',
    `- Final train/test split: train issueDate < ${TRAIN_CUTOFF}; test issueDate >= ${TRAIN_CUTOFF}.`,
    `- Hyperparameter selection split: fit issueDate < ${VALIDATION_CUTOFF}; validation ${VALIDATION_CUTOFF} <= issueDate < ${TRAIN_CUTOFF}.`,
    `- Small fixed grid only: ${BASE_FILTERS.length} weather gates x ${MODEL_GRID.length} logistic settings x ${SOURCE_SET_SPECS.length} source sets.`,
    '- The post-cutoff test return was not used to choose the selected lane configurations.',
    `- No-lookahead timing filter enforced: entryTradeDate > issueDate, targetTradeDate >= targetDate, targetTradeDate > entryTradeDate, symbol UNG.`,
    `- Timing audit: ${timingAudit.acceptedTradableUngRows} accepted UNG rows; ${timingAudit.rejectedLookaheadOrInvalidUngRows} rejected invalid/lookahead UNG rows from ${timingAudit.ungReturnRows} UNG return rows.`,
    '- Source-set candidates require at least two source groups and two model families; dynamic trained-source set drops sources with no pre-cutoff candidate evidence.',
    `- Round-trip friction applied per trade: ${ROUND_TRIP_COST_PCT}%.`,
    '',
    '## Weather rationale',
    '',
    '- Cold-long stays tied to the theory: winter 7-10 day broad severe cold should lift UNG into the event window.',
    '- Warm-short is evaluated separately because broad warmth is a different natural-gas demand story: less heating demand, bearish UNG exposure.',
    '- The best-looking filters should reduce trades that are weak by breadth, severity, source family coverage, or classifier-estimated acceptance probability; they should not create trades outside the winter rumor-window thesis.',
    '',
    '## Outputs',
    '',
    `- Summary CSV: ${path.relative(REPO_ROOT, summaryCsvPath)}`,
    `- Full JSON: ${path.relative(REPO_ROOT, resultsJsonPath)}`,
    `- Selected post-cutoff trades: ${path.relative(REPO_ROOT, selectedRowsPath)}`,
    `- Minimum-trade post-cutoff trades: ${path.relative(REPO_ROOT, minimumTradeRowsPath)}`,
    '',
    '## Dataset',
    '',
    `- Forecast calendars: ${manifest.forecastCalendars.map((calendar) => calendar.id).join(', ')}`,
    `- Return column used as PnL: returnPctEntryCloseToTarget.`,
    '',
  ].filter((line) => line !== '')

  const reportPath = path.join(OUTPUT_DIR, 'report.md')
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`)
  return reportPath
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const { manifest, rows, sourceIds, inputFiles, timingAudit } = loadRows()
  const laneResults = LANES.map((lane) => evaluateLane(rows, sourceIds, lane))
  const coldSelected = selectedRecord(laneResults.find((laneResult) => laneResult.lane === 'cold-long'))
  const warmSelected = selectedRecord(laneResults.find((laneResult) => laneResult.lane === 'warm-short'))
  const sideSeparate = buildSideSeparateCandidate(coldSelected, warmSelected)
  const baseline = baselineMetaMetrics()

  const summaryRows = flattenResultRows(laneResults)
  const summaryCsvPath = path.join(OUTPUT_DIR, 'candidate-summary.csv')
  writeCsv(summaryCsvPath, summaryRows, [
    'selectedForLane',
    'lane',
    'sourceSet',
    'sourceIds',
    'baseFilter',
    'modelGrid',
    'lambda',
    'acceptThreshold',
    'sourceSpreadOk',
    'fitForValidationCount',
    'validationCandidateCount',
    'validationTradeCount',
    'validationTotalReturnPct',
    'validationSharpe',
    'validationMaxDrawdownPct',
    'validationRank',
    'fitForTestCount',
    'testCandidateCount',
    'testTradeCount',
    'testTotalReturnPct',
    'testSharpe',
    'testMaxDrawdownPct',
    'testWinRatePct',
    'testProfitFactor',
    'finalRank',
    'firstEntry',
    'lastExit',
    'recordId',
  ])

  const selectedTradeCsvRows = [
    ...laneResults.flatMap((laneResult) => {
      const selected = selectedRecord(laneResult)
      return selected ? selectedTradeRows(selected.id, selected.test.trades) : []
    }),
    ...(sideSeparate ? selectedTradeRows(sideSeparate.id, sideSeparate.test.trades) : []),
  ]
  const selectedRowsPath = path.join(OUTPUT_DIR, 'selected-post-cutoff-trades.csv')
  writeCsv(selectedRowsPath, selectedTradeCsvRows, [
    'strategyId',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'targetTradeDate',
    'sourceId',
    'sourceGroup',
    'thesisKind',
    'leadDays',
    'direction',
    'weightedAnomalyF',
    'coveragePct',
    'extremeCount',
    'acceptProbability',
    'grossReturnPct',
    'netReturnPct',
    'rank',
  ])

  const minimumTradeCsvRows = laneResults.flatMap((laneResult) => {
    const eligible = minimumTradeEligibleRecord(laneResult)
    return eligible ? selectedTradeRows(`minimum-trade__${eligible.id}`, eligible.test.trades) : []
  })
  const minimumTradeRowsPath = path.join(OUTPUT_DIR, 'minimum-trade-post-cutoff-trades.csv')
  writeCsv(minimumTradeRowsPath, minimumTradeCsvRows, [
    'strategyId',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'targetTradeDate',
    'sourceId',
    'sourceGroup',
    'thesisKind',
    'leadDays',
    'direction',
    'weightedAnomalyF',
    'coveragePct',
    'extremeCount',
    'acceptProbability',
    'grossReturnPct',
    'netReturnPct',
    'rank',
  ])

  const resultsJsonPath = path.join(OUTPUT_DIR, 'results.json')
  fs.writeFileSync(
    resultsJsonPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        theory: 'Strict winter 7-10 day UNG weather demand thesis: cold-long and warm-short evaluated separately and together.',
        trainCutoff: TRAIN_CUTOFF,
        validationCutoff: VALIDATION_CUTOFF,
        returnColumn: 'returnPctEntryCloseToTarget',
        timingContract: {
          entryTradeDate: '> issueDate',
          targetTradeDate: '>= targetDate and > entryTradeDate',
          symbol: 'UNG',
        },
        roundTripCostPct: ROUND_TRIP_COST_PCT,
        dataRoot: path.relative(REPO_ROOT, DATA_ROOT),
        inputFiles,
        timingAudit,
        baseline,
        integrationRecommendation: INTEGRATION_RECOMMENDATION,
        laneResults,
        minimumTradeEligibleSelections: Object.fromEntries(
          laneResults.map((laneResult) => [laneResult.lane, minimumTradeEligibleRecord(laneResult)?.id ?? null]),
        ),
        sideSeparate,
      },
      null,
      2,
    )}\n`,
  )

  const reportPath = writeReport({
    laneResults,
    sideSeparate,
    baseline,
    timingAudit,
    manifest,
    selectedRowsPath,
    minimumTradeRowsPath,
    summaryCsvPath,
    resultsJsonPath,
  })

  console.log(`Wrote ${path.relative(REPO_ROOT, summaryCsvPath)}`)
  console.log(`Wrote ${path.relative(REPO_ROOT, selectedRowsPath)}`)
  console.log(`Wrote ${path.relative(REPO_ROOT, minimumTradeRowsPath)}`)
  console.log(`Wrote ${path.relative(REPO_ROOT, resultsJsonPath)}`)
  console.log(`Wrote ${path.relative(REPO_ROOT, reportPath)}`)
  for (const laneResult of laneResults) {
    const selected = selectedRecord(laneResult)
    if (!selected) {
      console.log(`${laneResult.lane}: no validation-usable candidate`)
      continue
    }
    console.log(
      `${laneResult.lane}: selected=${selected.sourceSet}/${selected.baseFilter}/${selected.modelParams.id} validation=${selected.validation.metrics.totalReturnPct}% test=${selected.test.metrics.totalReturnPct}% trades=${selected.test.metrics.tradeCount}`,
    )
  }
  if (sideSeparate) {
    console.log(`side-separate-combined: test=${sideSeparate.test.metrics.totalReturnPct}% trades=${sideSeparate.test.metrics.tradeCount}`)
  }
}

main()
