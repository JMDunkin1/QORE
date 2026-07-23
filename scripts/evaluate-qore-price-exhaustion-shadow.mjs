#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import {
  applyExecutionStep,
  createExecutionState,
  loadExecutionCalendar,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
} from './lib/qore-research-execution.mjs'
import {
  PRICE_EXHAUSTION_CANDIDATE_FAMILY,
  PRICE_EXHAUSTION_CANDIDATE_FAMILY_DIGEST_SHA256,
  PRICE_EXHAUSTION_EVALUATION_SCHEMA_VERSION,
  PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
  PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID,
  PRICE_EXHAUSTION_SHADOW,
  PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256,
  PRICE_EXHAUSTION_VOLATILITY_LOOKBACK_SESSIONS,
  buildPriorUngPriceExhaustionContext,
  evaluatePriceExhaustionShadow,
  priceExhaustionValueDigestSha256,
  validatePriceExhaustionImplementationManifest,
  validatePriceExhaustionShadow,
} from './lib/qore-price-exhaustion-shadow.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const SELECTED_TRADES_PATH = path.join(
  REPO_ROOT,
  PRICE_EXHAUSTION_SHADOW.comparator.selectedTradesPath,
)
const RUN_SUMMARY_PATH = path.join(REPO_ROOT, PRICE_EXHAUSTION_SHADOW.comparator.runSummaryPath)
const SELECTION_PREFIX_END = PRICE_EXHAUSTION_SHADOW.evaluation.selectionPrefixEnd
const DEFAULT_BOOTSTRAP_ITERATIONS = 5_000
const EPISODE_EMBARGO_SESSIONS = 10
const BLOCK_LENGTHS = Object.freeze([1, 5, 10, 20, 60])

function argumentValue(name) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function parseBootstrapIterations() {
  const raw = argumentValue('bootstrap-iterations')
  if (raw === undefined) return DEFAULT_BOOTSTRAP_ITERATIONS
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 100 || value > 1_000_000) {
    throw new Error('--bootstrap-iterations must be an integer from 100 through 1000000.')
  }
  return value
}

function outputPathFromArguments() {
  const raw = argumentValue('output')
  if (!raw) return null
  const outputPath = path.resolve(REPO_ROOT, raw)
  const allowedRoots = [
    path.join(REPO_ROOT, 'data/qore/research'),
    path.join(REPO_ROOT, '.local/qore/research'),
  ]
  if (!allowedRoots.some((root) => outputPath === root || outputPath.startsWith(`${root}${path.sep}`))) {
    throw new Error('--output must stay under data/qore/research or .local/qore/research.')
  }
  return outputPath
}

function parseCsv(filePath) {
  const parsed = Papa.parse(fs.readFileSync(filePath, 'utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })
  if (parsed.errors.length) {
    throw new Error(`${path.relative(REPO_ROOT, filePath)}: ${parsed.errors[0].message}`)
  }
  return parsed.data
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function numeric(value, fallback = Number.NaN) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  )
}

function metrics(rows, comparatorByDate = null) {
  if (!rows.length) {
    return {
      sessions: 0,
      totalReturnPct: 0,
      cagrPct: 0,
      sharpe: 0,
      maxDrawdownPct: 0,
      turnover: 0,
      incrementalDailySumPct: 0,
    }
  }
  const returns = rows.map((row) => row.netReturnPct)
  const dailyAverage = mean(returns) / 100
  const annualVolatility = sampleStandardDeviation(returns.map((value) => value / 100))
    * Math.sqrt(252)
  let equity = 1
  let peak = 1
  let maximumDrawdownPct = 0
  for (const value of returns) {
    equity *= 1 + value / 100
    peak = Math.max(peak, equity)
    maximumDrawdownPct = Math.min(maximumDrawdownPct, (equity / peak - 1) * 100)
  }
  const incrementalDailySumPct = comparatorByDate
    ? rows.reduce((sum, row) => {
      const comparator = comparatorByDate.get(row.date)
      if (!comparator) throw new Error(`Comparator is missing ${row.date}.`)
      return sum + row.netReturnPct - comparator.netReturnPct
    }, 0)
    : 0
  return {
    sessions: rows.length,
    totalReturnPct: round((equity - 1) * 100),
    cagrPct: round((equity ** (252 / rows.length) - 1) * 100),
    sharpe: round(annualVolatility ? dailyAverage * 252 / annualVolatility : 0),
    maxDrawdownPct: round(maximumDrawdownPct),
    turnover: round(rows.reduce((sum, row) => sum + row.turnover, 0)),
    incrementalDailySumPct: round(incrementalDailySumPct),
  }
}

function periodRows(rows, startDate = '', endDate = '9999-12-31') {
  return rows.filter((row) => (!startDate || row.date >= startDate) && row.date <= endDate)
}

function summarizePeriods(rows, comparatorByDate = null) {
  return {
    development2021To2023: metrics(
      periodRows(rows, '2021-01-01', '2023-12-31'),
      comparatorByDate,
    ),
    selectionAndTuning2024: metrics(
      periodRows(rows, '2024-01-01', '2024-12-31'),
      comparatorByDate,
    ),
    reportOnly2025: metrics(
      periodRows(rows, '2025-01-01', '2025-12-31'),
      comparatorByDate,
    ),
    observed2026: metrics(periodRows(rows, '2026-01-01'), comparatorByDate),
    selectionPrefix: metrics(periodRows(rows, '', SELECTION_PREFIX_END), comparatorByDate),
    full: metrics(rows, comparatorByDate),
  }
}

function seededRandom(seed) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4_294_967_296
  }
}

function circularSums(values, blockLength) {
  return values.map((_, start) => {
    let total = 0
    for (let offset = 0; offset < blockLength; offset += 1) {
      total += values[(start + offset) % values.length]
    }
    return total
  })
}

function fixedCandidateBootstrap(values, blockLength, iterations) {
  if (!values.length) return { blockLength, iterations, pValue: 1 }
  const observedMean = mean(values)
  const centered = values.map((value) => value - observedMean)
  const fullBlocks = Math.floor(values.length / blockLength)
  const remainder = values.length % blockLength
  const blockSums = circularSums(centered, blockLength)
  const remainderSums = remainder ? circularSums(centered, remainder) : []
  const random = seededRandom(20_260_722 + blockLength)
  let exceedances = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0
    for (let block = 0; block < fullBlocks; block += 1) {
      total += blockSums[Math.floor(random() * values.length)]
    }
    if (remainder) total += remainderSums[Math.floor(random() * values.length)]
    if (total / values.length >= observedMean) exceedances += 1
  }
  return {
    blockLength,
    iterations,
    observedAverageDailyIncrementPct: round(observedMean, 8),
    pValue: round((exceedances + 1) / (iterations + 1), 6),
  }
}

function familyAdjustedBootstrap(matrix, blockLength, iterations) {
  if (!matrix.length || !matrix[0].values.length) {
    return { candidateCount: matrix.length, blockLength, iterations, pValue: 1 }
  }
  const count = matrix[0].values.length
  if (!matrix.every(({ values }) => values.length === count)) {
    throw new Error('Price-exhaustion family bootstrap inputs are not aligned.')
  }
  const observed = matrix.map(({ candidateId, values }) => ({
    candidateId,
    average: mean(values),
  }))
  const winner = observed.toSorted(
    (left, right) => right.average - left.average
      || left.candidateId.localeCompare(right.candidateId),
  )[0]
  const centered = matrix.map(({ candidateId, values }) => {
    const average = mean(values)
    const centeredValues = values.map((value) => value - average)
    return {
      candidateId,
      blockSums: circularSums(centeredValues, blockLength),
      remainderSums: values.length % blockLength
        ? circularSums(centeredValues, values.length % blockLength)
        : [],
    }
  })
  const fullBlocks = Math.floor(count / blockLength)
  const remainder = count % blockLength
  const random = seededRandom(20_260_722 + blockLength + matrix.length)
  let exceedances = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const starts = Array.from({ length: fullBlocks }, () => Math.floor(random() * count))
    const remainderStart = remainder ? Math.floor(random() * count) : 0
    let maximumNullMean = Number.NEGATIVE_INFINITY
    for (const candidate of centered) {
      let total = 0
      for (const start of starts) total += candidate.blockSums[start]
      if (remainder) total += candidate.remainderSums[remainderStart]
      maximumNullMean = Math.max(maximumNullMean, total / count)
    }
    if (maximumNullMean >= winner.average) exceedances += 1
  }
  return {
    candidateCount: matrix.length,
    blockLength,
    iterations,
    observedWinnerId: winner.candidateId,
    observedWinnerAverageDailyIncrementPct: round(winner.average, 8),
    pValue: round((exceedances + 1) / (iterations + 1), 6),
  }
}

function combinations(values, choose) {
  const result = []
  function visit(start, selected) {
    if (selected.length === choose) {
      result.push([...selected])
      return
    }
    for (let index = start; index <= values.length - (choose - selected.length); index += 1) {
      selected.push(values[index])
      visit(index + 1, selected)
      selected.pop()
    }
  }
  visit(0, [])
  return result
}

function combinatoriallySymmetricCrossValidation(matrix, blockCount = 10, embargoSessions = 10) {
  const count = matrix[0].values.length
  const blocks = Array.from(
    { length: count },
    (_, index) => Math.min(blockCount - 1, Math.floor((index * blockCount) / count)),
  )
  const splits = combinations(Array.from({ length: blockCount }, (_, index) => index), blockCount / 2)
  let belowMedian = 0
  const winnerCounts = {}
  const selectedTestPercentiles = []
  for (const testBlocks of splits) {
    const testBlockSet = new Set(testBlocks)
    const testIndexes = blocks
      .map((block, index) => (testBlockSet.has(block) ? index : -1))
      .filter((index) => index >= 0)
    const embargoed = new Set()
    for (const index of testIndexes) {
      for (let offset = -embargoSessions; offset <= embargoSessions; offset += 1) {
        embargoed.add(index + offset)
      }
    }
    const trainIndexes = blocks
      .map((block, index) => (!testBlockSet.has(block) && !embargoed.has(index) ? index : -1))
      .filter((index) => index >= 0)
    const scores = matrix.map(({ candidateId, values }) => ({
      candidateId,
      train: mean(trainIndexes.map((index) => values[index])),
      test: mean(testIndexes.map((index) => values[index])),
    }))
    const selected = scores.toSorted(
      (left, right) => right.train - left.train
        || left.candidateId.localeCompare(right.candidateId),
    )[0]
    winnerCounts[selected.candidateId] = (winnerCounts[selected.candidateId] ?? 0) + 1
    const orderedTest = scores.toSorted(
      (left, right) => left.test - right.test
        || left.candidateId.localeCompare(right.candidateId),
    )
    const rank = orderedTest.findIndex(
      ({ candidateId }) => candidateId === selected.candidateId,
    )
    const percentile = (rank + 0.5) / orderedTest.length
    selectedTestPercentiles.push(percentile)
    if (percentile <= 0.5) belowMedian += 1
  }
  const orderedPercentiles = selectedTestPercentiles.toSorted((left, right) => left - right)
  return {
    method: '10-block combinatorially symmetric cross-validation with a 10-session embargo',
    interpretationWarning:
      'PBO is a non-calibrated rank diagnostic, not a posterior probability that the discovered rule is overfit or safe.',
    calibratedProbability: false,
    candidateCount: matrix.length,
    splitCount: splits.length,
    pboDiagnostic: round(belowMedian / splits.length),
    medianSelectedTestPercentile: round(
      orderedPercentiles[Math.floor(orderedPercentiles.length / 2)],
    ),
    mostFrequentTrainWinners: Object.entries(winnerCounts)
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 12)
      .map(([candidateId, selections]) => ({ candidateId, selections })),
  }
}

function strategySeasonId(componentStrategyId, isoDate) {
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  if (componentStrategyId === 'ngas-summer-alpha') return `summer-${year}`
  if (componentStrategyId === 'ngas-winter-alpha') {
    const endingYear = month >= 7 ? year + 1 : year
    return `winter-${endingYear - 1}-${endingYear}`
  }
  return `unknown-${year}`
}

function deriveChangedEpisodes(candidateRows, baselineByDate) {
  const increments = candidateRows.map(
    (row) => row.netReturnPct - baselineByDate.get(row.date).netReturnPct,
  )
  const changedIndexes = candidateRows
    .map((row, index) => (row.changedTarget ? index : -1))
    .filter((index) => index >= 0)
  const episodes = []
  for (const index of changedIndexes) {
    const previous = episodes.at(-1)
    if (!previous || index - previous.lastChangedIndex > EPISODE_EMBARGO_SESSIONS) {
      episodes.push({
        firstChangedIndex: index,
        lastChangedIndex: index,
        changedIndexes: [index],
      })
    } else {
      previous.lastChangedIndex = index
      previous.changedIndexes.push(index)
    }
  }
  const summarized = episodes.map((episode) => {
    const effectEndIndex = Math.min(candidateRows.length - 1, episode.lastChangedIndex + 1)
    const changedRows = episode.changedIndexes.map((index) => candidateRows[index])
    const components = [...new Set(changedRows.map((row) => row.componentStrategyId))]
    const theses = [...new Set(changedRows.map((row) => row.thesisKind))]
    const componentSeasons = [...new Set(changedRows.map((row) => row.componentSeasonId))]
    return {
      startDate: candidateRows[episode.firstChangedIndex].date,
      endDate: candidateRows[effectEndIndex].date,
      componentStrategyId: components.length === 1 ? components[0] : 'mixed-component-embargo-cluster',
      thesisKind: theses.length === 1 ? theses[0] : 'mixed-thesis-embargo-cluster',
      componentSeasonId:
        componentSeasons.length === 1 ? componentSeasons[0] : 'mixed-season-embargo-cluster',
      changedTargetCount: episode.changedIndexes.length,
      incrementalDailySumPct: round(
        increments
          .slice(episode.firstChangedIndex, effectEndIndex + 1)
          .reduce((sum, value) => sum + value, 0),
      ),
    }
  })
  const ranked = summarized.toSorted(
    (left, right) => right.incrementalDailySumPct - left.incrementalDailySumPct,
  )
  const total = increments.reduce((sum, value) => sum + value, 0)
  const positiveTotal = summarized
    .filter((episode) => episode.incrementalDailySumPct > 0)
    .reduce((sum, episode) => sum + episode.incrementalDailySumPct, 0)
  return {
    method:
      'Changed targets within 10 sessions share an episode; attribution runs through one session after the final changed target.',
    embargoSessions: EPISODE_EMBARGO_SESSIONS,
    changedTargetCount: changedIndexes.length,
    independentEpisodeCount: summarized.length,
    positiveEpisodes: summarized.filter((episode) => episode.incrementalDailySumPct > 0).length,
    negativeEpisodes: summarized.filter((episode) => episode.incrementalDailySumPct < 0).length,
    episodesByComponent: countBy(summarized, 'componentStrategyId'),
    episodesByThesis: countBy(summarized, 'thesisKind'),
    topEpisodePositiveContributionShare: round(
      positiveTotal > 0 ? Math.max(0, ranked[0]?.incrementalDailySumPct ?? 0) / positiveTotal : 0,
    ),
    incrementalSumAfterRemovingBestEpisodePct: round(
      total - (ranked[0]?.incrementalDailySumPct ?? 0),
    ),
    incrementalSumAfterRemovingBestThreeEpisodesPct: round(
      total - ranked.slice(0, 3).reduce(
        (sum, episode) => sum + episode.incrementalDailySumPct,
        0,
      ),
    ),
    episodes: ranked,
  }
}

function countBy(rows, key) {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row[key]))].toSorted().map((value) => [
      value,
      rows.filter((row) => row[key] === value).length,
    ]),
  )
}

function incrementalAttribution(candidateRows, baselineByDate, keySelector, changedOnly = false) {
  const considered = changedOnly ? candidateRows.filter((row) => row.changedTarget) : candidateRows
  const keys = [...new Set(considered.map(keySelector))].toSorted()
  return Object.fromEntries(keys.map((key) => {
    const rows = considered.filter((row) => keySelector(row) === key)
    const increments = rows.map(
      (row) => row.netReturnPct - baselineByDate.get(row.date).netReturnPct,
    )
    return [key, {
      sessions: rows.length,
      changedTargetCount: rows.filter((row) => row.changedTarget).length,
      incrementalDailySumPct: round(increments.reduce((sum, value) => sum + value, 0)),
      positiveIncrementSessions: increments.filter((value) => value > 0).length,
      negativeIncrementSessions: increments.filter((value) => value < 0).length,
    }]
  }))
}

function leaveOneGroup(candidateRows, baselineByDate, keySelector) {
  const groups = [...new Set(candidateRows.map(keySelector))].toSorted()
  return Object.fromEntries(groups.map((group) => {
    const included = candidateRows.filter((row) => keySelector(row) !== group)
    const excluded = candidateRows.filter((row) => keySelector(row) === group)
    return [group, {
      excludedIncrementalDailySumPct: metrics(excluded, baselineByDate).incrementalDailySumPct,
      remaining: metrics(included, baselineByDate),
    }]
  }))
}

const bootstrapIterations = parseBootstrapIterations()
const outputPath = outputPathFromArguments()
if (
  outputPath?.startsWith(`${path.join(REPO_ROOT, 'data/qore/research')}${path.sep}`)
  && bootstrapIterations !== DEFAULT_BOOTSTRAP_ITERATIONS
) {
  throw new Error('Versioned price-exhaustion output requires the canonical 5000 bootstrap iterations.')
}

const executionContract = loadResearchExecutionContract(REPO_ROOT)
const runSummary = JSON.parse(fs.readFileSync(RUN_SUMMARY_PATH, 'utf8'))
const sealedStrategyContractDigestSha256 =
  runSummary.validation?.integrity?.sealedStrategyContractDigestSha256
const selectedTradesDigestSha256 = sha256File(SELECTED_TRADES_PATH)
const runSummaryDigestSha256 = sha256File(RUN_SUMMARY_PATH)
const executionContractPath = path.join(
  REPO_ROOT,
  PRICE_EXHAUSTION_SHADOW.comparator.executionContractPath,
)
const executionContractDigestSha256 = sha256File(executionContractPath)
const ungPricePath = path.join(REPO_ROOT, PRICE_EXHAUSTION_SHADOW.priceContext.sourcePath)
const ungPriceDigestSha256 = sha256File(ungPricePath)
const implementationManifestPath = path.join(
  REPO_ROOT,
  PRICE_EXHAUSTION_SHADOW.implementationSeal.manifestPath,
)
const implementationManifestContent = fs.readFileSync(implementationManifestPath)
const implementationManifestDigestSha256 = crypto
  .createHash('sha256')
  .update(implementationManifestContent)
  .digest('hex')
if (
  implementationManifestDigestSha256
    !== PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256
) {
  throw new Error('The price-exhaustion implementation-manifest digest is stale.')
}
const implementationManifest = JSON.parse(implementationManifestContent.toString('utf8'))
validatePriceExhaustionImplementationManifest(
  implementationManifest,
  new Map(implementationManifest.files.map((file) => [
    file.path,
    fs.readFileSync(path.join(REPO_ROOT, file.path)),
  ])),
)
validatePriceExhaustionShadow({
  selectedTradesDigestSha256,
  runSummaryDigestSha256,
  executionContractDigestSha256,
  sealedStrategyContractDigestSha256,
  ungPriceDigestSha256,
  implementationManifestDigestSha256,
})

const selectedRows = parseCsv(SELECTED_TRADES_PATH)
const selectedByDate = new Map(selectedRows.map((row) => [row.entryTradeDate, row]))
const startDate = selectedRows[0]?.entryTradeDate
const endDate = selectedRows.at(-1)?.entryTradeDate
const executionDays = loadExecutionCalendar(REPO_ROOT, {
  startDate,
  endDate,
  contract: executionContract,
}).filter((day) => selectedByDate.has(day.date))

const primaryContextByLookback = new Map(
  [...new Set(PRICE_EXHAUSTION_CANDIDATE_FAMILY.map(({ lookbackSessions }) => lookbackSessions))]
    .map((lookback) => [lookback, new Map()]),
)
const extraLagContextByLookback = new Map(
  [...primaryContextByLookback.keys()].map((lookback) => [lookback, new Map()]),
)
const priorCompletedUngReturns = []
for (const day of executionDays) {
  for (const lookbackSessions of primaryContextByLookback.keys()) {
    primaryContextByLookback.get(lookbackSessions).set(
      day.date,
      buildPriorUngPriceExhaustionContext({
        priorCompletedReturns: priorCompletedUngReturns,
        tradeDate: day.date,
        lookbackSessions,
        volatilityLookbackSessions: PRICE_EXHAUSTION_VOLATILITY_LOOKBACK_SESSIONS,
      }),
    )
    extraLagContextByLookback.get(lookbackSessions).set(
      day.date,
      buildPriorUngPriceExhaustionContext({
        priorCompletedReturns: priorCompletedUngReturns.slice(0, -1),
        tradeDate: day.date,
        lookbackSessions,
        volatilityLookbackSessions: PRICE_EXHAUSTION_VOLATILITY_LOOKBACK_SESSIONS,
      }),
    )
  }
  priorCompletedUngReturns.push({
    date: day.date,
    returnPct: day.symbols.UNG.closeToCloseReturnPct,
  })
}

const baselineCandidate = Object.freeze({
  candidateId: 'active-all-year-comparator',
  comparator: true,
})
const matchedFallbackCandidate = Object.freeze({
  candidateId: 'matched-index-fallback',
  matchedFallback: true,
})

function simulate(
  candidate,
  scenarioId = executionContract.selectionScenarioId,
  contextByLookback = primaryContextByLookback,
) {
  let state = createExecutionState(executionContract)
  const daily = []
  for (const day of executionDays) {
    const selected = selectedByDate.get(day.date)
    const selectedGasPosition = numeric(selected.ungPosition, 0)
    const priceContext = candidate.lookbackSessions
      ? contextByLookback.get(candidate.lookbackSessions).get(day.date)
      : null
    let decision
    if (candidate.matchedFallback) {
      decision = {
        observationAvailable: true,
        priceExhausted: selectedGasPosition !== 0,
        scale: 0,
        gasPosition: 0,
        investedIndexFraction: 1,
        reason: 'matched-index-fallback',
      }
    } else if (candidate.comparator) {
      decision = {
        observationAvailable: true,
        priceExhausted: false,
        scale: 1,
        gasPosition: selectedGasPosition,
        investedIndexFraction: 1 - Math.abs(selectedGasPosition),
        reason: 'active-all-year-comparator',
      }
    } else {
      decision = evaluatePriceExhaustionShadow({
        gasPosition: selectedGasPosition,
        priceContext,
        threshold: candidate.threshold,
        exhaustedScale: candidate.exhaustedScale,
      })
    }
    const step = applyExecutionStep({
      state,
      day,
      targetWeights: targetWeightsForAllocation(executionContract, decision),
      contract: executionContract,
      scenarioId,
    })
    state = step.state
    daily.push({
      date: day.date,
      year: day.date.slice(0, 4),
      componentStrategyId: selected.componentStrategyId,
      thesisKind: selected.thesisKind,
      componentSeasonId: strategySeasonId(selected.componentStrategyId, day.date),
      selectedGasPosition,
      shadowGasPosition: decision.gasPosition,
      scale: decision.scale,
      observationAvailable: decision.observationAvailable,
      priceExhausted: decision.priceExhausted,
      priceExhaustionZ: priceContext?.available ? priceContext.z : null,
      directionalScore: decision.directionalScore ?? null,
      changedTarget: Math.abs(decision.gasPosition - selectedGasPosition) > 1e-9,
      netReturnPct: step.netReturnPct,
      turnover: step.totalTurnover,
    })
  }
  return daily
}

const baselineDaily = simulate(baselineCandidate)
const baselineByDate = new Map(baselineDaily.map((row) => [row.date, row]))
const maximumDailyBaselineTieOutErrorPct = Math.max(
  ...baselineDaily.map((row) => (
    Math.abs(row.netReturnPct - numeric(selectedByDate.get(row.date).netReturnPct))
  )),
)
if (maximumDailyBaselineTieOutErrorPct > 0.000051) {
  throw new Error(`Active all-year baseline replay failed by ${maximumDailyBaselineTieOutErrorPct} percentage points.`)
}

const candidateDaily = new Map()
const candidateSummaries = PRICE_EXHAUSTION_CANDIDATE_FAMILY.map((candidate) => {
  const daily = simulate(candidate)
  candidateDaily.set(candidate.candidateId, daily)
  return {
    ...candidate,
    changedTargetCount: daily.filter((row) => row.changedTarget).length,
    periods: summarizePeriods(daily, baselineByDate),
    incrementalByYear: Object.fromEntries(
      [...new Set(daily.map((row) => row.year))].map((year) => [
        year,
        metrics(daily.filter((row) => row.year === year), baselineByDate)
          .incrementalDailySumPct,
      ]),
    ),
  }
})
candidateSummaries.sort((left, right) => (
  right.periods.selectionPrefix.incrementalDailySumPct
    - left.periods.selectionPrefix.incrementalDailySumPct
  || right.periods.selectionPrefix.sharpe - left.periods.selectionPrefix.sharpe
  || left.candidateId.localeCompare(right.candidateId)
))

const selectedSummary = candidateSummaries.find(
  ({ candidateId }) => candidateId === PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID,
)
const selectedCandidate = PRICE_EXHAUSTION_CANDIDATE_FAMILY.find(
  ({ candidateId }) => candidateId === PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID,
)
const selectedDaily = candidateDaily.get(PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID)
const selectionPrefixBaseline = periodRows(baselineDaily, '', SELECTION_PREFIX_END)
const selectedPrefixIncrements = periodRows(selectedDaily, '', SELECTION_PREFIX_END).map(
  (row) => row.netReturnPct - baselineByDate.get(row.date).netReturnPct,
)
const familyMatrix = PRICE_EXHAUSTION_CANDIDATE_FAMILY.map(({ candidateId }) => ({
  candidateId,
  values: periodRows(candidateDaily.get(candidateId), '', SELECTION_PREFIX_END).map(
    (row) => row.netReturnPct - baselineByDate.get(row.date).netReturnPct,
  ),
}))
const pboMatrix = [
  { candidateId: baselineCandidate.candidateId, values: selectionPrefixBaseline.map(() => 0) },
  ...familyMatrix,
]

const matchedFallbackDaily = simulate(matchedFallbackCandidate)
const matchedFallbackByDate = new Map(matchedFallbackDaily.map((row) => [row.date, row]))
const activeVersusMatchedFallback = selectionPrefixBaseline.map(
  (row) => row.netReturnPct - matchedFallbackByDate.get(row.date).netReturnPct,
)

const frictionScenarios = Object.fromEntries(
  Object.keys(executionContract.scenarios).map((scenarioId) => {
    const scenarioBaseline = simulate(baselineCandidate, scenarioId)
    const scenarioBaselineByDate = new Map(scenarioBaseline.map((row) => [row.date, row]))
    const scenarioSelected = simulate(selectedCandidate, scenarioId)
    return [scenarioId, {
      selectionEligible: executionContract.scenarios[scenarioId].selectionEligible,
      comparator: metrics(scenarioBaseline),
      shadow: metrics(scenarioSelected, scenarioBaselineByDate),
      incrementalByYear: Object.fromEntries(
        [...new Set(scenarioSelected.map((row) => row.year))].map((year) => [
          year,
          metrics(
            scenarioSelected.filter((row) => row.year === year),
            scenarioBaselineByDate,
          ).incrementalDailySumPct,
        ]),
      ),
    }]
  }),
)

const extraLagSelectedDaily = simulate(
  selectedCandidate,
  executionContract.selectionScenarioId,
  extraLagContextByLookback,
)
const selectedEpisodeRobustness = deriveChangedEpisodes(selectedDaily, baselineByDate)
const selectedPrefixEpisodeRobustness = deriveChangedEpisodes(
  periodRows(selectedDaily, '', SELECTION_PREFIX_END),
  baselineByDate,
)

function binding(role, relativePath) {
  const filePath = path.join(REPO_ROOT, relativePath)
  return {
    role,
    path: relativePath,
    digestSha256: sha256File(filePath),
    byteLength: fs.statSync(filePath).size,
  }
}

const resultWithoutDigest = {
  schemaVersion: PRICE_EXHAUSTION_EVALUATION_SCHEMA_VERSION,
  evaluationId: 'ngas-all-year-price-exhaustion-shadow-audit-v1',
  contractId: PRICE_EXHAUSTION_SHADOW.contractId,
  contractDigestSha256: PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256,
  candidateFamilyDigestSha256: PRICE_EXHAUSTION_CANDIDATE_FAMILY_DIGEST_SHA256,
  evaluatedThrough: endDate,
  historicalEvidenceStatus: 'development-contaminated',
  status: 'research-only-not-promotion-eligible',
  executionEligible: false,
  promotionEligible: false,
  publicStrategy: false,
  activeStrategyChanged: false,
  decision: {
    outcome: 'retain-active-strategy-and-freeze-price-exhaustion-as-an-ineligible-research-shadow',
    reasons: [
      'The five-session rule was discovered in a wider retrospective search; this focused family cannot turn that discovery into independent validation.',
      'The frozen rule loses incremental return in 2025, including the single worst embargoed intervention episode.',
      'The focused 48-member bootstrap is only a lower bound on the wider lifetime search multiplicity.',
      'A one-extra-session-lag negative control reverses the selection-prefix and full-calendar edge, so the timing result is not robust.',
      'Every historical session was already development-visible, so none is a pristine holdout.',
      'The legacy active comparator is bound, but there is no trusted writer, external chronology seal, or outcome-independent terminal date.',
    ],
    prospectiveStart: PRICE_EXHAUSTION_SHADOW.prospectiveStart,
    prospectiveCollectionStatus:
      PRICE_EXHAUSTION_SHADOW.evaluation.prospectiveCollectionStatus,
  },
  inputBindings: {
    implementationManifest: {
      path: path.relative(REPO_ROOT, implementationManifestPath),
      digestSha256: implementationManifestDigestSha256,
      files: implementationManifest.files,
    },
    selectedTrades: binding(
      'legacy-active-all-year-comparator-ledger',
      PRICE_EXHAUSTION_SHADOW.comparator.selectedTradesPath,
    ),
    runSummary: binding(
      'legacy-active-all-year-comparator-summary',
      PRICE_EXHAUSTION_SHADOW.comparator.runSummaryPath,
    ),
    executionContract: binding(
      'shared-research-execution-contract',
      PRICE_EXHAUSTION_SHADOW.comparator.executionContractPath,
    ),
    sealedStrategyContractDigestSha256,
    adjustedClosePayload: binding(
      'prior-completed-ung-adjusted-close-signal-and-execution-input',
      PRICE_EXHAUSTION_SHADOW.priceContext.sourcePath,
    ),
    executionMarketInputs: [
      binding('ung-adjusted-market-bars', 'data/qore/market/yahoo/UNG-daily.csv'),
      binding('voo-adjusted-market-bars', 'data/qore/market/yahoo/VOO-daily.csv'),
      binding('qqqm-adjusted-market-bars', 'data/qore/market/yahoo/QQQM-daily.csv'),
      binding('index-basket-weights', 'data/qore/market/index-basket-config.json'),
    ],
    simulatorSources: [
      binding('shared-execution-simulator', 'scripts/lib/qore-research-execution.mjs'),
      binding('shared-rebalance-deadband', 'scripts/lib/qore-rebalance-deadband.mjs'),
    ],
  },
  signalContract: {
    selectedRule:
      'strict full veto when sign(selected gas position) times the prior five-session compounded UNG adjusted-close return divided by prior up-to-20-session daily sample standard deviation times sqrt(5) is greater than 1',
    targetSessionExcluded: true,
    targetSessionReturnUse: 'never; the context is built before appending the current session return',
    expandingInceptionWindow:
      'The historical discovery used up to 20 prior returns at comparator inception; the first selected-rule veto occurs only after 20 prior observations.',
    releasedCapacityDestination: 'the unchanged 80/20 VOO/QQQM index basket',
  },
  baselineTieOut: {
    sessionCount: baselineDaily.length,
    maximumDailyNetReturnDifferencePct: round(maximumDailyBaselineTieOutErrorPct, 9),
    pass: true,
  },
  comparator: summarizePeriods(baselineDaily),
  selectedShadow: {
    candidateId: selectedSummary.candidateId,
    status: 'retrospectively-discovered-and-frozen-before-this-focused-sensitivity-audit',
    focusedFamilyPromotionSelected: false,
    focusedFamilySensitivityRank:
      candidateSummaries.findIndex(({ candidateId }) => candidateId === selectedSummary.candidateId) + 1,
    selectionCaveat:
      'Rank is descriptive sensitivity information only. The focused family neither selected nor promoted this previously discovered rule.',
    lookbackSessions: selectedSummary.lookbackSessions,
    volatilityLookbackSessions: PRICE_EXHAUSTION_VOLATILITY_LOOKBACK_SESSIONS,
    threshold: selectedSummary.threshold,
    exhaustedScale: selectedSummary.exhaustedScale,
    changedTargetCount: selectedSummary.changedTargetCount,
    periods: selectedSummary.periods,
    incrementalByYear: selectedSummary.incrementalByYear,
  },
  reportOnly2025Failure: {
    verdict: 'failed',
    comparatorTotalReturnPct: summarizePeriods(baselineDaily).reportOnly2025.totalReturnPct,
    shadowTotalReturnPct: selectedSummary.periods.reportOnly2025.totalReturnPct,
    incrementalDailySumPct: selectedSummary.periods.reportOnly2025.incrementalDailySumPct,
    worstEpisode: selectedEpisodeRobustness.episodes.at(-1) ?? null,
    consequence: 'reject-promotion-and-do-not-assign-a-prospective-start',
  },
  multipleTesting: {
    focusedFamilyCandidateCount: PRICE_EXHAUSTION_CANDIDATE_FAMILY.length,
    exactGrid: {
      lookbackSessions: [2, 3, 5, 10],
      thresholds: [0.5, 1, 1.5, 2],
      exhaustedScales: [0, 0.5, 0.75],
    },
    selectionPeriod: `through-${SELECTION_PREFIX_END}`,
    scopeCaveat:
      'Focused-family lower bound only: the adjustment covers all 48 UNG exhaustion rows, but not the wider prior 388-row market-state search, the later 480-row cross-market search, the active comparator, or the lifetime QORE search.',
    fixedDiscoveredCandidateCircularBlockBootstrap: BLOCK_LENGTHS.map((blockLength) =>
      fixedCandidateBootstrap(selectedPrefixIncrements, blockLength, bootstrapIterations)),
    full48FamilyAdjustedCircularBlockBootstrap: BLOCK_LENGTHS.map((blockLength) =>
      familyAdjustedBootstrap(familyMatrix, blockLength, bootstrapIterations)),
    pboNonCalibratedDiagnostic: combinatoriallySymmetricCrossValidation(pboMatrix),
  },
  episodeRobustness: {
    selectionPrefix: selectedPrefixEpisodeRobustness,
    fullCalendar: selectedEpisodeRobustness,
  },
  componentAndThesisAttribution: {
    changedTargetSessionsOnly: {
      byComponent: incrementalAttribution(
        selectedDaily,
        baselineByDate,
        (row) => row.componentStrategyId,
        true,
      ),
      byThesis: incrementalAttribution(
        selectedDaily,
        baselineByDate,
        (row) => row.thesisKind,
        true,
      ),
      byComponentAndThesis: incrementalAttribution(
        selectedDaily,
        baselineByDate,
        (row) => `${row.componentStrategyId}/${row.thesisKind}`,
        true,
      ),
    },
    allSessionIncrementAccounting: {
      byComponent: incrementalAttribution(
        selectedDaily,
        baselineByDate,
        (row) => row.componentStrategyId,
      ),
      byThesis: incrementalAttribution(selectedDaily, baselineByDate, (row) => row.thesisKind),
    },
  },
  deletionRobustness: {
    method:
      'Delete the named calendar or component-season rows from the aligned incremental-return series; do not retune or reselect.',
    selectionPrefixLeaveOneCalendarYear: leaveOneGroup(
      periodRows(selectedDaily, '', SELECTION_PREFIX_END),
      baselineByDate,
      (row) => row.year,
    ),
    fullLeaveOneCalendarYear: leaveOneGroup(selectedDaily, baselineByDate, (row) => row.year),
    fullLeaveOneComponentSeason: leaveOneGroup(
      selectedDaily,
      baselineByDate,
      (row) => row.componentSeasonId,
    ),
  },
  temporalNegativeControl: {
    status: 'diagnostic-only-not-a-reselection',
    rule: 'apply the exact frozen rule with one additional completed-session lag',
    purpose:
      'Checks whether the result depends narrowly on the immediately preceding adjusted-close return.',
    periods: summarizePeriods(extraLagSelectedDaily, baselineByDate),
    incrementalByYear: Object.fromEntries(
      [...new Set(extraLagSelectedDaily.map((row) => row.year))].map((year) => [
        year,
        metrics(
          extraLagSelectedDaily.filter((row) => row.year === year),
          baselineByDate,
        ).incrementalDailySumPct,
      ]),
    ),
    episodeRobustness: deriveChangedEpisodes(extraLagSelectedDaily, baselineByDate),
  },
  frictionScenarios,
  matchedFallbackRealityCheck: {
    comparator: '98%-deployed VOO/QQQM basket replayed through the same execution simulator',
    activeAllYearSelectionPrefix: metrics(selectionPrefixBaseline, matchedFallbackByDate),
    matchedFallbackFull: metrics(matchedFallbackDaily),
    circularBlockBootstrap: BLOCK_LENGTHS.map((blockLength) =>
      fixedCandidateBootstrap(activeVersusMatchedFallback, blockLength, bootstrapIterations)),
  },
  candidateSummaries,
}

const result = {
  ...resultWithoutDigest,
  evaluationDigestSha256: priceExhaustionValueDigestSha256(resultWithoutDigest),
}

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({
    output: path.relative(REPO_ROOT, outputPath),
    status: result.status,
    activeStrategyChanged: result.activeStrategyChanged,
    selectedCandidateId: result.selectedShadow.candidateId,
    selectedFull: result.selectedShadow.periods.full,
    reportOnly2025Failure: result.reportOnly2025Failure,
    familyAdjustedBlock10PValue:
      result.multipleTesting.full48FamilyAdjustedCircularBlockBootstrap
        .find(({ blockLength }) => blockLength === 10)?.pValue,
    independentEpisodeCount: result.episodeRobustness.fullCalendar.independentEpisodeCount,
  }, null, 2))
} else {
  console.log(JSON.stringify(result, null, 2))
}
