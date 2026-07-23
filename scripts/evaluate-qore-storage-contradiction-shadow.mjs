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
  eiaStorageReleaseAt,
  loadEiaStorageReleaseCalendar,
} from './lib/eia-release-time.mjs'
import {
  STORAGE_CONTRADICTION_CANDIDATE_FAMILY,
  STORAGE_CONTRADICTION_CANDIDATE_FAMILY_DIGEST_SHA256,
  STORAGE_CONTRADICTION_EVALUATION_SCHEMA_VERSION,
  STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
  STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID,
  STORAGE_CONTRADICTION_SHADOW,
  STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256,
  buildCausalStorageContext,
  buildNearestPeriodStorageContext,
  evaluateStorageContradictionShadow,
  validateStorageContradictionImplementationManifest,
  storageContradictionValueDigestSha256,
  storageSeasonalWeek,
  validateStorageContradictionShadow,
} from './lib/qore-storage-contradiction-shadow.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const SELECTED_TRADES_PATH = path.join(
  REPO_ROOT,
  STORAGE_CONTRADICTION_SHADOW.comparator.selectedTradesPath,
)
const RUN_SUMMARY_PATH = path.join(
  REPO_ROOT,
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json',
)
const STORAGE_PATH = path.join(REPO_ROOT, STORAGE_CONTRADICTION_SHADOW.storageContext.sourcePath)
const RELEASE_CALENDAR_PATH = path.join(
  REPO_ROOT,
  STORAGE_CONTRADICTION_SHADOW.storageContext.releaseCalendarPath,
)
const SELECTION_PREFIX_END = STORAGE_CONTRADICTION_SHADOW.evaluation.selectionPrefixEnd
const DEFAULT_BOOTSTRAP_ITERATIONS = 10_000
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
  const annualVol = sampleStandardDeviation(returns.map((value) => value / 100)) * Math.sqrt(252)
  let equity = 1
  let peak = 1
  let maximumDrawdown = 0
  for (const value of returns) {
    equity *= 1 + value / 100
    peak = Math.max(peak, equity)
    maximumDrawdown = Math.min(maximumDrawdown, (equity / peak - 1) * 100)
  }
  const incrementalDailySumPct = comparatorByDate
    ? rows.reduce(
      (sum, row) => sum + row.netReturnPct - comparatorByDate.get(row.date).netReturnPct,
      0,
    )
    : 0
  return {
    sessions: rows.length,
    totalReturnPct: round((equity - 1) * 100),
    cagrPct: round((equity ** (252 / rows.length) - 1) * 100),
    sharpe: round(annualVol ? (dailyAverage * 252) / annualVol : 0),
    maxDrawdownPct: round(maximumDrawdown),
    turnover: round(rows.reduce((sum, row) => sum + row.turnover, 0)),
    incrementalDailySumPct: round(incrementalDailySumPct),
  }
}

function periodRows(rows, startDate = '', endDate = '9999-12-31') {
  return rows.filter((row) => (!startDate || row.date >= startDate) && row.date <= endDate)
}

function summarizePeriods(rows, comparatorByDate) {
  return {
    development2021To2023: metrics(periodRows(rows, '2021-01-01', '2023-12-31'), comparatorByDate),
    selectionAndTuning2024: metrics(
      periodRows(rows, '2024-01-01', '2024-12-31'),
      comparatorByDate,
    ),
    reportOnly2025: metrics(periodRows(rows, '2025-01-01', '2025-12-31'), comparatorByDate),
    reportOnly2026: metrics(periodRows(rows, '2026-01-01'), comparatorByDate),
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
  const random = seededRandom(0x9e3779b9 ^ blockLength ^ values.length)
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
    throw new Error('Storage-contradiction family bootstrap inputs are not aligned.')
  }
  const observed = matrix.map(({ candidateId, values }) => ({ candidateId, average: mean(values) }))
  const winner = observed.toSorted(
    (left, right) => right.average - left.average || left.candidateId.localeCompare(right.candidateId),
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
  const random = seededRandom(0x85ebca6b ^ blockLength ^ matrix.length)
  let exceedances = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const starts = Array.from({ length: fullBlocks }, () => Math.floor(random() * count))
    const remainderStart = remainder ? Math.floor(random() * count) : 0
    let maximumNullMean = Number.NEGATIVE_INFINITY
    for (const candidate of centered) {
      let total = starts.reduce((sum, start) => sum + candidate.blockSums[start], 0)
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
      (left, right) => right.train - left.train || left.candidateId.localeCompare(right.candidateId),
    )[0]
    winnerCounts[selected.candidateId] = (winnerCounts[selected.candidateId] ?? 0) + 1
    const orderedTest = scores.toSorted(
      (left, right) => left.test - right.test || left.candidateId.localeCompare(right.candidateId),
    )
    const rank = orderedTest.findIndex(({ candidateId }) => candidateId === selected.candidateId)
    const percentile = (rank + 0.5) / orderedTest.length
    selectedTestPercentiles.push(percentile)
    if (percentile <= 0.5) belowMedian += 1
  }
  const orderedPercentiles = selectedTestPercentiles.toSorted((left, right) => left - right)
  return {
    method: '10-block combinatorially symmetric cross-validation with a 10-session embargo',
    interpretationWarning:
      'This diagnostic is not a calibrated posterior probability that the selected rule is overfit.',
    candidateCount: matrix.length,
    splitCount: splits.length,
    pboDiagnostic: round(belowMedian / splits.length),
    medianSelectedTestPercentile: round(orderedPercentiles[Math.floor(orderedPercentiles.length / 2)]),
    mostFrequentTrainWinners: Object.entries(winnerCounts)
      .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 10)
      .map(([candidateId, selections]) => ({ candidateId, selections })),
  }
}

function deriveChangedEpisodes(candidateRows, baselineRows) {
  const increments = candidateRows.map(
    (row, index) => row.netReturnPct - baselineRows[index].netReturnPct,
  )
  const episodes = []
  let previousChanged = false
  let previousComponent = null
  let lastMaterialIndex = Number.NEGATIVE_INFINITY
  candidateRows.forEach((row, index) => {
    const currentMaterial = row.changedTarget
    const priorMaterial = previousChanged
    if (currentMaterial || priorMaterial) {
      const componentStrategyId = currentMaterial ? row.componentStrategyId : previousComponent
      const separated = index - lastMaterialIndex > EPISODE_EMBARGO_SESSIONS + 1
      if (!episodes.length || separated) {
        episodes.push({
          startIndex: index,
          endIndex: index,
          componentStrategyId,
        })
      } else {
        const episode = episodes.at(-1)
        episode.endIndex = index
        if (episode.componentStrategyId !== componentStrategyId) {
          episode.componentStrategyId = 'mixed-component-embargo-cluster'
        }
      }
      lastMaterialIndex = index
    }
    previousChanged = currentMaterial
    previousComponent = currentMaterial ? row.componentStrategyId : null
  })
  const summarized = episodes.map((episode) => ({
    startDate: candidateRows[episode.startIndex].date,
    endDate: candidateRows[episode.endIndex].date,
    componentStrategyId: episode.componentStrategyId,
    changedTargetCount: candidateRows
      .slice(episode.startIndex, episode.endIndex + 1)
      .filter((row) => row.changedTarget).length,
    incrementalDailySumPct: round(
      increments
        .slice(episode.startIndex, episode.endIndex + 1)
        .reduce((sum, value) => sum + value, 0),
    ),
  }))
  const ranked = summarized.toSorted(
    (left, right) => right.incrementalDailySumPct - left.incrementalDailySumPct,
  )
  const total = increments.reduce((sum, value) => sum + value, 0)
  const positiveTotal = summarized
    .filter((episode) => episode.incrementalDailySumPct > 0)
    .reduce((sum, episode) => sum + episode.incrementalDailySumPct, 0)
  return {
    method:
      'Current-or-prior changed target, with the production 10-session embargo and prior-close effect.',
    embargoSessions: EPISODE_EMBARGO_SESSIONS,
    changedTargetCount: candidateRows.filter((row) => row.changedTarget).length,
    independentEpisodeCount: summarized.length,
    episodesByComponent: Object.fromEntries(
      [...new Set(summarized.map((episode) => episode.componentStrategyId))].map((component) => [
        component,
        summarized.filter((episode) => episode.componentStrategyId === component).length,
      ]),
    ),
    productionForwardPolicyScaleReference: {
      minimumIndependentEpisodes: 60,
      minimumEpisodesPerComponent: 15,
      applicability:
        'Scale reference only. This shadow counts changed-target interventions and is not evaluated by the production exposure gate.',
    },
    positiveEpisodes: summarized.filter((episode) => episode.incrementalDailySumPct > 0).length,
    negativeEpisodes: summarized.filter((episode) => episode.incrementalDailySumPct < 0).length,
    topEpisodePositiveContributionShare: round(
      positiveTotal > 0 ? Math.max(0, ranked[0]?.incrementalDailySumPct ?? 0) / positiveTotal : 0,
    ),
    incrementalSumAfterRemovingBestEpisodePct: round(
      total - (ranked[0]?.incrementalDailySumPct ?? 0),
    ),
    incrementalSumAfterRemovingBestThreeEpisodesPct: round(
      total - ranked.slice(0, 3).reduce((sum, episode) => sum + episode.incrementalDailySumPct, 0),
    ),
    episodes: ranked,
  }
}

const bootstrapIterations = parseBootstrapIterations()
const outputPath = outputPathFromArguments()
if (
  outputPath?.startsWith(`${path.join(REPO_ROOT, 'data/qore/research')}${path.sep}`)
  && bootstrapIterations !== DEFAULT_BOOTSTRAP_ITERATIONS
) {
  throw new Error('Versioned storage-contradiction output requires the canonical 10000 bootstrap iterations.')
}
const executionContract = loadResearchExecutionContract(REPO_ROOT)
const runSummary = JSON.parse(fs.readFileSync(RUN_SUMMARY_PATH, 'utf8'))
const sealedStrategyContractDigestSha256 =
  runSummary.validation?.integrity?.sealedStrategyContractDigestSha256
const selectedTradesDigestSha256 = sha256File(SELECTED_TRADES_PATH)
const executionContractDigestSha256 = sha256File(
  path.join(REPO_ROOT, STORAGE_CONTRADICTION_SHADOW.comparator.executionContractPath),
)
const implementationManifestPath = path.join(
  REPO_ROOT,
  STORAGE_CONTRADICTION_SHADOW.implementationSeal.manifestPath,
)
const implementationManifestContent = fs.readFileSync(implementationManifestPath)
const implementationManifestDigestSha256 = crypto
  .createHash('sha256')
  .update(implementationManifestContent)
  .digest('hex')
if (
  implementationManifestDigestSha256
    !== STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256
) {
  throw new Error('The storage-contradiction implementation-manifest digest is stale.')
}
const implementationManifest = JSON.parse(implementationManifestContent.toString('utf8'))
const implementationContentsByPath = new Map(
  implementationManifest.files.map((file) => [
    file.path,
    fs.readFileSync(path.join(REPO_ROOT, file.path)),
  ]),
)
validateStorageContradictionImplementationManifest(
  implementationManifest,
  implementationContentsByPath,
)

validateStorageContradictionShadow({
  selectedTradesDigestSha256,
  executionContractDigestSha256,
  sealedStrategyContractDigestSha256,
  implementationManifestDigestSha256,
})

const releaseCalendar = loadEiaStorageReleaseCalendar(new URL(`file://${RELEASE_CALENDAR_PATH}`))
const storageRows = parseCsv(STORAGE_PATH).map((row) => ({
  date: row.date,
  year: Number(String(row.date).slice(0, 4)),
  seasonalWeek: storageSeasonalWeek(row.date),
  storageBcf: numeric(row.storageBcf),
  releasedAt: eiaStorageReleaseAt(row.date, releaseCalendar),
})).filter((row) => row.releasedAt && Number.isFinite(row.storageBcf) && row.storageBcf > 0)

const selectedRows = parseCsv(SELECTED_TRADES_PATH)
const selectedByDate = new Map(selectedRows.map((row) => [row.entryTradeDate, row]))
const startDate = selectedRows[0]?.entryTradeDate
const endDate = selectedRows.at(-1)?.entryTradeDate
const executionDays = loadExecutionCalendar(REPO_ROOT, {
  startDate,
  endDate,
  contract: executionContract,
}).filter((day) => selectedByDate.has(day.date))
const storageContextByDate = new Map(
  executionDays.map((day) => [day.date, buildCausalStorageContext(storageRows, day.date)]),
)
const nearestPeriodStorageContextByDate = new Map(
  executionDays.map((day) => [day.date, buildNearestPeriodStorageContext(storageRows, day.date)]),
)

const baselineCandidate = Object.freeze({
  candidateId: 'active-all-year-comparator',
  thresholdPct: Number.POSITIVE_INFINITY,
  contradictedScale: 1,
  comparator: true,
})
const matchedFallbackCandidate = Object.freeze({
  candidateId: 'matched-index-fallback',
  matchedFallback: true,
})

function simulate(
  candidate,
  scenarioId = executionContract.selectionScenarioId,
  contextByDate = storageContextByDate,
) {
  let state = createExecutionState(executionContract)
  const daily = []
  for (const day of executionDays) {
    const selected = selectedByDate.get(day.date)
    const selectedGasPosition = numeric(selected.ungPosition, 0)
    let decision
    if (candidate.matchedFallback) {
      decision = {
        observationAvailable: true,
        contradicted: selectedGasPosition !== 0,
        scale: 0,
        gasPosition: 0,
        investedIndexFraction: 1,
        reason: 'matched-index-fallback',
      }
    } else if (candidate.comparator) {
      decision = {
        observationAvailable: true,
        contradicted: false,
        scale: 1,
        gasPosition: selectedGasPosition,
        investedIndexFraction: 1 - Math.abs(selectedGasPosition),
        reason: 'active-all-year-comparator',
      }
    } else {
      decision = evaluateStorageContradictionShadow({
        gasPosition: selectedGasPosition,
        storageContext: contextByDate.get(day.date),
        thresholdPct: candidate.thresholdPct,
        contradictedScale: candidate.contradictedScale,
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
      componentStrategyId: selected.componentStrategyId,
      thesisKind: selected.thesisKind,
      selectedGasPosition,
      shadowGasPosition: decision.gasPosition,
      storageDeviationPct: contextByDate.get(day.date)?.storageDeviationPct ?? null,
      observationAvailable: decision.observationAvailable,
      changedTarget: Math.abs(decision.gasPosition - selectedGasPosition) >= 0.1,
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
const candidateSummaries = STORAGE_CONTRADICTION_CANDIDATE_FAMILY.map((candidate) => {
  const daily = simulate(candidate)
  candidateDaily.set(candidate.candidateId, daily)
  const periods = summarizePeriods(daily, baselineByDate)
  return {
    ...candidate,
    changedTargetCount: daily.filter((row) => row.changedTarget).length,
    periods,
    incrementalByYear: Object.fromEntries(
      [...new Set(daily.map((row) => row.date.slice(0, 4)))].map((year) => [
        year,
        metrics(daily.filter((row) => row.date.startsWith(year)), baselineByDate)
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
  ({ candidateId }) => candidateId === STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID,
)
const selectedDaily = candidateDaily.get(STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID)
const selectedCandidate = STORAGE_CONTRADICTION_CANDIDATE_FAMILY.find(
  ({ candidateId }) => candidateId === STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID,
)
const nearestPeriodSelectedDaily = simulate(
  selectedCandidate,
  executionContract.selectionScenarioId,
  nearestPeriodStorageContextByDate,
)
const bestSelectionIncrement = candidateSummaries[0].periods.selectionPrefix.incrementalDailySumPct
const tiedSelectionWinnerIds = candidateSummaries
  .filter((candidate) => (
    Math.abs(candidate.periods.selectionPrefix.incrementalDailySumPct - bestSelectionIncrement) <= 1e-9
  ))
  .map(({ candidateId }) => candidateId)
const selectionPrefixBaseline = periodRows(baselineDaily, '', SELECTION_PREFIX_END)
const selectedPrefixIncrements = periodRows(selectedDaily, '', SELECTION_PREFIX_END).map(
  (row) => row.netReturnPct - baselineByDate.get(row.date).netReturnPct,
)
const familyMatrix = STORAGE_CONTRADICTION_CANDIDATE_FAMILY.map(({ candidateId }) => ({
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
    const scenarioSelected = simulate(
      selectedCandidate,
      scenarioId,
    )
    return [scenarioId, {
      selectionEligible: executionContract.scenarios[scenarioId].selectionEligible,
      comparator: metrics(scenarioBaseline),
      shadow: metrics(scenarioSelected, scenarioBaselineByDate),
      incrementalByYear: Object.fromEntries(
        [...new Set(scenarioSelected.map((row) => row.date.slice(0, 4)))].map((year) => [
          year,
          metrics(
            scenarioSelected.filter((row) => row.date.startsWith(year)),
            scenarioBaselineByDate,
          ).incrementalDailySumPct,
        ]),
      ),
    }]
  }),
)

const episodeRobustness = deriveChangedEpisodes(selectedDaily, baselineDaily)
const selectionPrefixEpisodeRobustness = deriveChangedEpisodes(
  periodRows(selectedDaily, '', SELECTION_PREFIX_END),
  selectionPrefixBaseline,
)

function storageAvailabilitySummary(contextByDate) {
  const observations = [...contextByDate.entries()]
  const unavailableObservations = observations
    .filter(([, context]) => !context.available)
    .map(([date, context]) => ({
      date,
      reason: context.reason,
      storageDate: context.storageDate ?? null,
      peerCount: context.peerCount ?? 0,
    }))
  return {
    availableSessions: observations.length - unavailableObservations.length,
    unavailableSessions: unavailableObservations.length,
    unavailableObservations,
  }
}

const resultWithoutDigest = {
  schemaVersion: STORAGE_CONTRADICTION_EVALUATION_SCHEMA_VERSION,
  evaluationId: 'ngas-all-year-storage-contradiction-shadow-audit-v1',
  contractId: STORAGE_CONTRADICTION_SHADOW.contractId,
  contractDigestSha256: STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256,
  candidateFamilyDigestSha256: STORAGE_CONTRADICTION_CANDIDATE_FAMILY_DIGEST_SHA256,
  evaluatedThrough: endDate,
  historicalEvidenceStatus: 'development-contaminated',
  status: 'research-only-not-promotion-eligible',
  executionEligible: false,
  promotionEligible: false,
  activeStrategyChanged: false,
  decision: {
    outcome: 'retain-active-strategy-and-run-storage-rule-as-a-separately-sealed-shadow',
    reasons: [
      'The selected rule improves the 2021-2024 tuning prefix but loses incremental return in 2025.',
      'The focused-family block-bootstrap result is not strong enough for promotion and is a lower bound on lifetime search multiplicity.',
      'The apparent gain is concentrated in far fewer independent episodes than the production evidence policy requires.',
      'Every historical session was already development-visible, so none is a pristine holdout.',
      'EIA release timing is causal, but the checked storage values are current-vintage and cannot exclude historical revisions.',
      'No trusted pre-open writer, external chronology anchor, or outcome-independent terminal evaluation date exists.',
    ],
    prospectiveStart: STORAGE_CONTRADICTION_SHADOW.prospectiveStart,
    prospectiveCollectionStatus:
      STORAGE_CONTRADICTION_SHADOW.evaluation.prospectiveCollectionStatus,
  },
  inputBindings: {
    implementationManifest: {
      path: path.relative(REPO_ROOT, implementationManifestPath),
      digestSha256: implementationManifestDigestSha256,
      files: implementationManifest.files,
    },
    selectedTrades: {
      path: path.relative(REPO_ROOT, SELECTED_TRADES_PATH),
      digestSha256: selectedTradesDigestSha256,
    },
    executionContract: {
      path: STORAGE_CONTRADICTION_SHADOW.comparator.executionContractPath,
      digestSha256: executionContractDigestSha256,
    },
    sealedStrategyContractDigestSha256,
    storage: {
      path: path.relative(REPO_ROOT, STORAGE_PATH),
      digestSha256: sha256File(STORAGE_PATH),
    },
    releaseCalendar: {
      path: path.relative(REPO_ROOT, RELEASE_CALENDAR_PATH),
      digestSha256: sha256File(RELEASE_CALENDAR_PATH),
    },
  },
  baselineTieOut: {
    sessionCount: baselineDaily.length,
    maximumDailyNetReturnDifferencePct: round(maximumDailyBaselineTieOutErrorPct, 9),
    pass: true,
  },
  storageAvailability: storageAvailabilitySummary(storageContextByDate),
  comparator: summarizePeriods(baselineDaily),
  selectedShadow: {
    candidateId: selectedSummary.candidateId,
    historicalSelectionRank: candidateSummaries.findIndex(
      ({ candidateId }) => candidateId === selectedSummary.candidateId,
    ) + 1,
    tiedSelectionWinnerIds,
    selectionStatus:
      'The 10% rule ties the 9% rule on the 2021-2024 tuning prefix; its round threshold is frozen as the research hypothesis, not claimed as a unique winner.',
    thresholdPct: selectedSummary.thresholdPct,
    contradictedScale: selectedSummary.contradictedScale,
    changedTargetCount: selectedSummary.changedTargetCount,
    periods: selectedSummary.periods,
    incrementalByYear: selectedSummary.incrementalByYear,
  },
  multipleTesting: {
    familyCandidateCount: STORAGE_CONTRADICTION_CANDIDATE_FAMILY.length,
    selectionPeriod: `through-${SELECTION_PREFIX_END}`,
    scopeCaveat:
      'Focused-family lower bound only: the adjustment covers 60 storage rows, not the recorded but unversioned original 327 other overlays, a later unversioned 480-row cross-market pass with some overlapping configurations, the active comparator, or the wider lifetime QORE search.',
    fixedSelectedCandidateCircularBlockBootstrap: BLOCK_LENGTHS.map((blockLength) =>
      fixedCandidateBootstrap(selectedPrefixIncrements, blockLength, bootstrapIterations)),
    familyAdjustedCircularBlockBootstrap: BLOCK_LENGTHS.map((blockLength) =>
      familyAdjustedBootstrap(familyMatrix, blockLength, bootstrapIterations)),
    combinatoriallySymmetricCrossValidation:
      combinatoriallySymmetricCrossValidation(pboMatrix),
  },
  episodeRobustness: {
    selectionPrefix: selectionPrefixEpisodeRobustness,
    fullCalendar: episodeRobustness,
  },
  seasonalDefinitionSensitivity: {
    selectedDefinition: 'jan1-anchored-seven-day-bucket',
    alternativeDefinition: 'nearest-period-end-within-eight-seasonal-days',
    purpose:
      'Tests leap/calendar drift and the year-end bucket cliff without tuning the frozen threshold or scale.',
    selectedDefinitionAvailability: storageAvailabilitySummary(storageContextByDate),
    alternativeDefinitionAvailability: storageAvailabilitySummary(nearestPeriodStorageContextByDate),
    alternativeSelectedShadowPeriods: summarizePeriods(nearestPeriodSelectedDaily, baselineByDate),
    alternativeEpisodeRobustness: deriveChangedEpisodes(nearestPeriodSelectedDaily, baselineDaily),
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
  evaluationDigestSha256: storageContradictionValueDigestSha256(resultWithoutDigest),
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
    reportOnly2025IncrementalDailySumPct:
      result.selectedShadow.periods.reportOnly2025.incrementalDailySumPct,
    familyAdjustedBlock10PValue:
      result.multipleTesting.familyAdjustedCircularBlockBootstrap
        .find(({ blockLength }) => blockLength === 10)?.pValue,
    independentEpisodeCount: result.episodeRobustness.fullCalendar.independentEpisodeCount,
  }, null, 2))
} else {
  console.log(JSON.stringify(result, null, 2))
}
