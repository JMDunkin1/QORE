#!/usr/bin/env node
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Papa from 'papaparse'
import {
  enrichForecastRows,
  inferAllYearTarget,
  selectedContracts,
} from './lib/qore-live-all-year-inference.mjs'
import {
  executableLiveComponentContract,
  executableLiveComponentContractDigestSha256,
} from './lib/qore-live-contract.mjs'
import {
  applyExecutionStep,
  createExecutionState,
  loadExecutionCalendar,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
} from './lib/qore-research-execution.mjs'
import { validateForecastCalendarTemperatures } from './lib/qore-weather-data-quality.mjs'
import {
  WINTER_SHADOW_CANDIDATE_FAMILY,
  WINTER_SHADOW_CANDIDATE_FAMILY_DIGEST_SHA256,
  WINTER_SHADOW_CHALLENGER,
  WINTER_SHADOW_CHALLENGER_CANDIDATE_ID,
  WINTER_SHADOW_CHALLENGER_DIGEST_SHA256,
  WINTER_SHADOW_COMPARATOR_CANDIDATE_ID,
  WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256,
  WINTER_SHADOW_EVALUATION_SCHEMA_VERSION,
  validateWinterShadowChallenger,
  winterShadowValueDigestSha256,
} from './lib/qore-winter-shadow-challenger.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const DATA_ROOT = path.join(REPO_ROOT, 'data', 'qore')
const WINTER_TRAIN_END = '2024-03-31'
const WINTER_VALIDATION_END = '2025-10-31'
const WINTER_HOLDOUT_START = '2025-11-01'
const DEFAULT_BOOTSTRAP_ITERATIONS = 10_000
const DEFAULT_EPISODE_BOOTSTRAP_ITERATIONS = 50_000
const BLOCK_LENGTHS = Object.freeze([1, 5, 10, 20, 60])

function parsePositiveIntegerArgument(name, fallback) {
  const prefix = `--${name}=`
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 1_000_000) {
    throw new Error(`${prefix}<integer> must be between 100 and 1000000.`)
  }
  return parsed
}

function csv(relativePath) {
  const parsed = Papa.parse(fs.readFileSync(path.join(DATA_ROOT, relativePath), 'utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })
  if (parsed.errors.length) throw new Error(`${relativePath}: ${parsed.errors[0].message}`)
  return parsed.data
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function splitRows(rows, split) {
  if (split === 'all') return rows
  if (split === 'train') return rows.filter((row) => row.date <= WINTER_TRAIN_END)
  if (split === 'validation') {
    return rows.filter((row) => row.date > WINTER_TRAIN_END && row.date <= WINTER_VALIDATION_END)
  }
  if (split === 'holdout') return rows.filter((row) => row.date >= WINTER_HOLDOUT_START)
  if (split === 'postTrain') return rows.filter((row) => row.date > WINTER_TRAIN_END)
  if (split === 'selectionPrefix') return rows.filter((row) => row.date <= WINTER_VALIDATION_END)
  throw new Error(`Unknown Winter shadow split: ${split}.`)
}

function portfolioMetrics(rows) {
  if (!rows.length) {
    return {
      sessionCount: 0,
      totalReturnPct: 0,
      activeEdgeSumPct: 0,
      sharpe: 0,
      maxDrawdownPct: 0,
    }
  }
  const values = rows.map((row) => row.returnPct)
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (const value of values) {
    equity *= 1 + value / 100
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100)
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
    : 0
  return {
    sessionCount: rows.length,
    totalReturnPct: round((equity - 1) * 100),
    activeEdgeSumPct: round(
      rows.reduce((sum, row) => sum + row.returnPct - row.indexReturnPct, 0),
    ),
    sharpe: round(variance ? (average / Math.sqrt(variance)) * Math.sqrt(252) : 0, 3),
    maxDrawdownPct: round(maxDrawdown),
  }
}

function incrementalRows(candidateRows, comparatorRows) {
  if (candidateRows.length !== comparatorRows.length) {
    throw new Error('Winter shadow candidate and comparator calendars are not aligned.')
  }
  return candidateRows.map((row, index) => {
    if (row.date !== comparatorRows[index].date) {
      throw new Error(`Winter shadow candidate calendar diverges on ${row.date}.`)
    }
    return {
      date: row.date,
      incrementalReturnPct: row.returnPct - comparatorRows[index].returnPct,
    }
  })
}

function incrementalSummary(rows) {
  const values = rows.map((row) => row.incrementalReturnPct)
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    sessionCount: rows.length,
    changedReturnDays: values.filter((value) => Math.abs(value) > 1e-8).length,
    incrementalDailySumPct: round(sum, 6),
    incrementalArithmeticMeanBps: round((sum / Math.max(1, values.length)) * 100, 6),
    positive: sum > 0,
  }
}

function circularBlockProbabilityNonPositive(values, blockLength, iterations) {
  if (!values.length) return 1
  const random = seededRandom(0x9e3779b9 ^ blockLength ^ values.length)
  let nonPositive = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0
    let sampled = 0
    while (sampled < values.length) {
      const start = Math.floor(random() * values.length)
      for (let offset = 0; offset < blockLength && sampled < values.length; offset += 1) {
        sum += values[(start + offset) % values.length]
        sampled += 1
      }
    }
    if (sum <= 0) nonPositive += 1
  }
  return round(nonPositive / iterations, 4)
}

function episodeSums(rows) {
  const episodes = []
  let current = null
  for (const row of rows) {
    if (Math.abs(row.incrementalReturnPct) <= 1e-8) {
      current = null
      continue
    }
    if (!current) {
      current = { start: row.date, end: row.date, returnPct: 0, days: 0 }
      episodes.push(current)
    }
    current.end = row.date
    current.returnPct += row.incrementalReturnPct
    current.days += 1
  }
  return episodes.map((episode) => ({ ...episode, returnPct: round(episode.returnPct, 6) }))
}

function episodeBootstrapProbabilityNonPositive(episodes, iterations) {
  if (!episodes.length) return 1
  const random = seededRandom(0xb7e15162 ^ episodes.length)
  let nonPositive = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0
    for (let index = 0; index < episodes.length; index += 1) {
      sum += episodes[Math.floor(random() * episodes.length)].returnPct
    }
    if (sum <= 0) nonPositive += 1
  }
  return round(nonPositive / iterations, 4)
}

function robustnessSummary(rows, bootstrapIterations, episodeBootstrapIterations) {
  const values = rows.map((row) => row.incrementalReturnPct)
  const totalIncremental = values.reduce((sum, value) => sum + value, 0)
  const episodes = episodeSums(rows)
  const ranked = episodes.toSorted((left, right) => right.returnPct - left.returnPct)
  const bestEpisode = ranked[0]?.returnPct ?? 0
  const topThree = ranked.slice(0, 3).reduce((sum, episode) => sum + episode.returnPct, 0)
  const years = [...new Set(rows.map((row) => row.date.slice(0, 4)))]
  return {
    ...incrementalSummary(rows),
    episodeCount: episodes.length,
    positiveEpisodes: episodes.filter((episode) => episode.returnPct > 0).length,
    episodeBootstrapProbabilityNonPositive:
      episodeBootstrapProbabilityNonPositive(episodes, episodeBootstrapIterations),
    circularBlockProbabilityIncrementalMeanNonPositive: Object.fromEntries(
      BLOCK_LENGTHS.map((blockLength) => [
        blockLength,
        circularBlockProbabilityNonPositive(values, blockLength, bootstrapIterations),
      ]),
    ),
    topEpisodeSharePct: totalIncremental > 0
      ? round((bestEpisode / totalIncremental) * 100, 2)
      : null,
    withoutBestEpisodeSumPct: round(totalIncremental - bestEpisode, 6),
    withoutTopThreeEpisodeSumPct: round(totalIncremental - topThree, 6),
    leaveOneYearOutIncrementalSumPct: Object.fromEntries(years.map((year) => [
      year,
      round(
        rows
          .filter((row) => !row.date.startsWith(year))
          .reduce((sum, row) => sum + row.incrementalReturnPct, 0),
        6,
      ),
    ])),
    topEpisodes: ranked.slice(0, 8),
    bottomEpisodes: ranked.slice(-8),
  }
}

function familyAdjustedNullPValue(seriesByCandidate, blockLength, iterations) {
  const candidates = [...seriesByCandidate.values()]
  if (!candidates.length || !candidates[0].length) return 1
  const length = candidates[0].length
  if (!candidates.every((values) => values.length === length)) {
    throw new Error('Winter shadow family-adjustment series are not aligned.')
  }
  const averages = candidates.map(
    (values) => values.reduce((sum, value) => sum + value, 0) / length,
  )
  const observedBest = Math.max(...averages)
  const centered = candidates.map((values, index) =>
    values.map((value) => value - averages[index]))
  const random = seededRandom(0x243f6a88 ^ blockLength ^ length ^ candidates.length)
  let exceedances = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sums = centered.map(() => 0)
    let sampled = 0
    while (sampled < length) {
      const start = Math.floor(random() * length)
      for (let offset = 0; offset < blockLength && sampled < length; offset += 1) {
        const index = (start + offset) % length
        for (let candidateIndex = 0; candidateIndex < centered.length; candidateIndex += 1) {
          sums[candidateIndex] += centered[candidateIndex][index]
        }
        sampled += 1
      }
    }
    if (Math.max(...sums.map((sum) => sum / length)) >= observedBest) exceedances += 1
  }
  return round(exceedances / iterations, 4)
}

function loadForecastInputs() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'dataset-manifest.json'), 'utf8'))
  const scoreRows = []
  const locationRows = []
  const inputFiles = []
  for (const calendar of manifest.forecastCalendars) {
    inputFiles.push(calendar.files.signalScores, calendar.files.locationAnomalies)
    for (const row of csv(calendar.files.signalScores)) scoreRows.push({ ...row, sourceId: calendar.id })
    for (const row of csv(calendar.files.locationAnomalies)) {
      locationRows.push({ ...row, sourceId: calendar.id })
    }
  }
  const validated = validateForecastCalendarTemperatures({
    scoreRows,
    locationRows,
    mode: 'quarantine',
    label: 'Winter shadow historical forecast calendars',
  })
  return {
    rows: enrichForecastRows(validated.scoreRows, validated.locationRows, 'winter'),
    inputFiles,
    temperatureQuality: validated.diagnostics,
  }
}

function applyResearchCandidate(candidate) {
  const active = selectedContracts.winterFollow
  active.sourceIds = [...candidate.signalSourceIds]
  active.liveSourceIds = [...candidate.signalSourceIds]
  active.heatingDemandSourceIds = [...candidate.heatingDemandSourceIds]
  active.liveHeatingDemandSourceIds = [...candidate.heatingDemandSourceIds]
  active.sourceWeightMode = candidate.sourceWeightMode
}

function candidateTargetRows({
  candidate,
  forecastRows,
  actualWeatherRows,
  marketDays,
  storageRows,
  executionDays,
}) {
  applyResearchCandidate(candidate)
  const allowedDemandSources = new Set(candidate.heatingDemandSourceIds)
  const scopedForecastRows = forecastRows
    .filter((row) => allowedDemandSources.has(row.sourceId))
    .map((row) => ({ ...row }))
  const targets = new Map()
  for (const day of executionDays) {
    const month = Number(day.date.slice(5, 7))
    if (![11, 12, 1, 2, 3].includes(month)) continue
    targets.set(day.date, inferAllYearTarget({
      forecastRows: scopedForecastRows,
      actualWeatherRows,
      marketDays,
      storageRows,
      targetDate: day.date,
    }))
  }
  return targets
}

function executeCandidate({
  candidate,
  candidateTargets,
  selectedByDate,
  executionContract,
  executionDays,
}) {
  const allocations = []
  let changedVsSelectedArtifactWinterTargets = 0
  for (const day of executionDays) {
    const selected = selectedByDate.get(day.date)
    if (!selected) throw new Error(`Missing selected all-year row for ${day.date}.`)
    const candidateTarget = candidateTargets.get(day.date)
    const gasPosition = candidateTarget
      ? Number(candidateTarget.gasPosition)
      : Number(selected.ungPosition)
    if (
      candidateTarget
      && Math.abs(gasPosition - Number(selected.ungPosition)) > 0.000001
    ) {
      changedVsSelectedArtifactWinterTargets += 1
    }
    allocations.push({
      day,
      gasPosition,
      investedIndexFraction: Math.max(0, 1 - Math.abs(gasPosition)),
    })
  }

  const rowsByScenario = {}
  for (const scenarioId of Object.keys(executionContract.scenarios)) {
    let state = createExecutionState(executionContract)
    rowsByScenario[scenarioId] = allocations.map(({ day, gasPosition, investedIndexFraction }) => {
      const step = applyExecutionStep({
        state,
        day,
        targetWeights: targetWeightsForAllocation(
          executionContract,
          { gasPosition, investedIndexFraction },
        ),
        contract: executionContract,
        scenarioId,
      })
      state = step.state
      return {
        date: day.date,
        returnPct: step.netReturnPct,
        indexReturnPct: day.indexReturnPct,
      }
    })
  }
  return {
    candidate,
    winterTargetCount: candidateTargets.size,
    changedVsSelectedArtifactWinterTargets,
    rowsByScenario,
  }
}

export function evaluateWinterShadow({
  bootstrapIterations = DEFAULT_BOOTSTRAP_ITERATIONS,
  episodeBootstrapIterations = DEFAULT_EPISODE_BOOTSTRAP_ITERATIONS,
} = {}) {
  validateWinterShadowChallenger()
  const liveContractDigestBefore = winterShadowValueDigestSha256(executableLiveComponentContract)
  if (liveContractDigestBefore !== executableLiveComponentContractDigestSha256) {
    throw new Error('The executable component contract digest was stale before Winter shadow evaluation.')
  }

  const forecast = loadForecastInputs()
  const marketDays = csv('market/yahoo/UNG-qore-market.csv')
    .map((row) => ({ date: row.date, gasClose: Number(row.close) }))
    .filter((row) => Number.isFinite(row.gasClose) && row.gasClose > 0)
  const storageRows = csv('fundamentals/eia/working-gas-storage-lower48-weekly.csv')
  const actualWeatherRows = csv('weather/events/arctic-blast-actual-daily-2021-01-01-2026-03-31.csv')
  const selectedRows = csv('research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv')
  const selectedByDate = new Map(selectedRows.map((row) => [row.entryTradeDate, row]))
  const lastSelectedDate = selectedRows.at(-1)?.entryTradeDate
  if (!lastSelectedDate) throw new Error('The selected all-year ledger is empty.')
  const executionContract = loadResearchExecutionContract(REPO_ROOT)
  const executionDays = loadExecutionCalendar(REPO_ROOT, {
    startDate: '2021-01-01',
    endDate: lastSelectedDate,
  })

  const active = selectedContracts.winterFollow
  const activeSnapshot = {
    sourceIds: [...active.sourceIds],
    liveSourceIds: [...active.liveSourceIds],
    heatingDemandSourceIds: [...active.heatingDemandSourceIds],
    liveHeatingDemandSourceIds: [...active.liveHeatingDemandSourceIds],
    sourceWeightMode: active.sourceWeightMode,
  }
  const evaluations = []
  try {
    for (const candidate of WINTER_SHADOW_CANDIDATE_FAMILY) {
      const targets = candidateTargetRows({
        candidate,
        forecastRows: forecast.rows,
        actualWeatherRows,
        marketDays,
        storageRows,
        executionDays,
      })
      evaluations.push(executeCandidate({
        candidate,
        candidateTargets: targets,
        selectedByDate,
        executionContract,
        executionDays,
      }))
    }
  } finally {
    Object.assign(active, activeSnapshot)
  }

  const liveContractDigestAfter = winterShadowValueDigestSha256(executableLiveComponentContract)
  if (liveContractDigestAfter !== liveContractDigestBefore) {
    throw new Error('Winter shadow evaluation did not restore the executable component contract.')
  }
  validateWinterShadowChallenger()

  const comparator = evaluations.find(
    (evaluation) => evaluation.candidate.candidateId === WINTER_SHADOW_COMPARATOR_CANDIDATE_ID,
  )
  if (!comparator) throw new Error('The Winter shadow comparator evaluation is missing.')
  const comparatorRows = comparator.rowsByScenario.baseline
  const splitNames = ['all', 'train', 'validation', 'holdout', 'postTrain', 'selectionPrefix']
  const results = evaluations.map((evaluation) => {
    const baselineRows = evaluation.rowsByScenario.baseline
    const incremental = incrementalRows(baselineRows, comparatorRows)
    return {
      candidateId: evaluation.candidate.candidateId,
      role: evaluation.candidate.role,
      signalSourceIds: evaluation.candidate.signalSourceIds,
      heatingDemandSourceIds: evaluation.candidate.heatingDemandSourceIds,
      sourceWeightMode: evaluation.candidate.sourceWeightMode,
      executionEligible: false,
      winterTargetCount: evaluation.winterTargetCount,
      changedVsSelectedArtifactWinterTargets:
        evaluation.changedVsSelectedArtifactWinterTargets,
      portfolioMetricsBySplit: Object.fromEntries(splitNames.map((split) => [
        split,
        portfolioMetrics(splitRows(baselineRows, split)),
      ])),
      scenarioMetrics: Object.fromEntries(
        Object.entries(evaluation.rowsByScenario).map(([scenarioId, rows]) => [
          scenarioId,
          portfolioMetrics(rows),
        ]),
      ),
      incrementalVsComparatorBySplit: Object.fromEntries(splitNames.map((split) => [
        split,
        incrementalSummary(splitRows(incremental, split)),
      ])),
      robustness: evaluation === comparator
        ? null
        : {
            all: robustnessSummary(
              incremental,
              bootstrapIterations,
              episodeBootstrapIterations,
            ),
            postTrain: robustnessSummary(
              splitRows(incremental, 'postTrain'),
              bootstrapIterations,
              episodeBootstrapIterations,
            ),
          },
      byYear: Object.fromEntries(
        [...new Set(baselineRows.map((row) => row.date.slice(0, 4)))].map((year) => [
          year,
          portfolioMetrics(baselineRows.filter((row) => row.date.startsWith(year))),
        ]),
      ),
    }
  })

  const incrementalSeries = new Map(evaluations
    .filter((evaluation) => evaluation !== comparator)
    .map((evaluation) => [
      evaluation.candidate.candidateId,
      incrementalRows(evaluation.rowsByScenario.baseline, comparatorRows),
    ]))
  const familyAdjustmentBySplit = Object.fromEntries(
    ['all', 'train', 'validation', 'holdout', 'postTrain', 'selectionPrefix'].map((split) => {
      const valuesByCandidate = new Map([...incrementalSeries.entries()].map(([candidateId, rows]) => [
        candidateId,
        splitRows(rows, split).map((row) => row.incrementalReturnPct),
      ]))
      return [split, Object.fromEntries(BLOCK_LENGTHS.map((blockLength) => [
        blockLength,
        familyAdjustedNullPValue(valuesByCandidate, blockLength, bootstrapIterations),
      ]))]
    }),
  )
  const challenger = results.find(
    (result) => result.candidateId === WINTER_SHADOW_CHALLENGER_CANDIDATE_ID,
  )
  if (!challenger) throw new Error('The frozen Winter shadow challenger result is missing.')

  return {
    schemaVersion: WINTER_SHADOW_EVALUATION_SCHEMA_VERSION,
    reportKind: 'research-only-winter-source-shadow-evaluation',
    contractId: WINTER_SHADOW_CHALLENGER.contractId,
    contractDigestSha256: WINTER_SHADOW_CHALLENGER_DIGEST_SHA256,
    comparatorComponentContractDigestSha256:
      WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256,
    candidateFamilyDigestSha256: WINTER_SHADOW_CANDIDATE_FAMILY_DIGEST_SHA256,
    historicalEvidenceStatus: WINTER_SHADOW_CHALLENGER.evaluation.historicalEvidenceStatus,
    executionEligible: false,
    selectedArtifactsChanged: false,
    activeInferenceChanged: false,
    executableComponentContractDigestBefore: liveContractDigestBefore,
    executableComponentContractDigestAfter: liveContractDigestAfter,
    splits: {
      trainEnd: WINTER_TRAIN_END,
      validationEnd: WINTER_VALIDATION_END,
      holdoutStart: WINTER_HOLDOUT_START,
      postTrainDefinition: `entry session after ${WINTER_TRAIN_END}`,
    },
    inputs: {
      selectedAllYearLedger:
        'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv',
      forecastFiles: forecast.inputFiles,
      weatherTemperatureQuality: forecast.temperatureQuality,
      evaluationEnd: lastSelectedDate,
      executionContractId: executionContract.contractId,
      executionContractDigest: executionContract.digest,
    },
    bootstrap: {
      deterministic: true,
      circularBlockLengths: BLOCK_LENGTHS,
      iterations: bootstrapIterations,
      episodeIterations: episodeBootstrapIterations,
    },
    candidateFamily: WINTER_SHADOW_CANDIDATE_FAMILY,
    candidateResults: results,
    familyAdjustedCenteredCircularBlockNullPValue: familyAdjustmentBySplit,
    focusedChallenger: challenger,
    decision: {
      promotionEligible: false,
      brokerEligible: false,
      activeContractUnchanged: liveContractDigestAfter === liveContractDigestBefore,
      postTrainIncrementalPositive:
        challenger.incrementalVsComparatorBySplit.postTrain.positive,
      reason:
        'The fixed source/weight choice was frozen after inspecting development-contaminated history; this evaluator cannot authorize execution or satisfy QORE promotion gates.',
      multipleTestingCaveat:
        'The family-adjusted result covers only this frozen focused family and is a lower bound because prior strategy searches also inspected the same history.',
    },
    reportDigestSha256: null,
  }
}

function finalizeReport(report) {
  const digestable = { ...report, reportDigestSha256: undefined }
  return {
    ...report,
    reportDigestSha256: winterShadowValueDigestSha256(digestable),
  }
}

async function main() {
  const report = finalizeReport(evaluateWinterShadow({
    bootstrapIterations: parsePositiveIntegerArgument(
      'bootstrap-iterations',
      DEFAULT_BOOTSTRAP_ITERATIONS,
    ),
    episodeBootstrapIterations: parsePositiveIntegerArgument(
      'episode-bootstrap-iterations',
      DEFAULT_EPISODE_BOOTSTRAP_ITERATIONS,
    ),
  }))
  const compact = process.argv.includes('--compact')
  process.stdout.write(`${JSON.stringify(report, null, compact ? 0 : 2)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
