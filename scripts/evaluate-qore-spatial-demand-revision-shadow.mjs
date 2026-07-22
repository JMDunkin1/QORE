#!/usr/bin/env node
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  applyExecutionStep,
  createExecutionState,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
} from './lib/qore-research-execution.mjs'
import {
  SPATIAL_DEMAND_REVISION_OUTCOME_POLICY_DIGEST_SHA256,
  SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE,
  SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256,
  SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY_DIGEST_SHA256,
  readSpatialDemandRevisionManifest,
  spatialDemandRevisionRecordTiming,
  spatialDemandRevisionSettlementTiming,
  validateSpatialDemandRevisionSettlementRecord,
  validateSpatialDemandRevisionTargetRecord,
} from './lib/qore-spatial-demand-revision-shadow.mjs'
import { summerShadowMarketSessionStatus } from './lib/qore-summer-shadow-challenger.mjs'

const repoDir = process.cwd()
const candidateId = SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.candidateId
const defaultStateRoot = path.join(
  repoDir,
  '.local',
  'qore',
  'shadow-validation',
  candidateId,
)

function isoDateTimestamp(value, label) {
  const text = String(value ?? '')
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? Date.parse(`${text}T00:00:00Z`)
    : Number.NaN
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be a valid ISO calendar date.`)
  }
  return timestamp
}

function addDays(date, count) {
  return new Date(isoDateTimestamp(date, 'date') + count * 86_400_000).toISOString().slice(0, 10)
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function newYorkDate(timestamp = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(timestamp).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

function argumentValue(name) {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null
}

export function spatialDemandRevisionExpectedSessions(startDate, throughDate) {
  if (throughDate < startDate) return []
  const dates = []
  for (let date = startDate; date <= throughDate; date = addDays(date, 1)) {
    const status = summerShadowMarketSessionStatus(date)
    if (status.reason === 'unreviewed-session-calendar-year') {
      throw new Error(`Reviewed market-session calendar does not cover evaluation date ${date}.`)
    }
    if (status.session) dates.push(date)
  }
  return dates
}

async function jsonFiles(stateDir, label) {
  let names
  try {
    names = await readdir(stateDir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const unexpected = names.filter((name) => !/^\d{4}-\d{2}-\d{2}\.json$/.test(name))
  if (unexpected.length) throw new Error(`${label} contains unexpected entries: ${unexpected.join(', ')}.`)
  return names.toSorted().map((name) => path.join(stateDir, name))
}

async function readOwnerOnlyRecord(filePath, label) {
  const fileStat = await lstat(filePath)
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`)
  }
  if ((fileStat.mode & 0o077) !== 0) throw new Error(`${label} permissions are not owner-only: ${filePath}`)
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function readTargets({ stateDir, manifest, manifestDigestSha256 }) {
  const records = []
  for (const filePath of await jsonFiles(stateDir, 'Spatial-demand-revision target directory')) {
    const record = await readOwnerOnlyRecord(filePath, 'Shadow target')
    validateSpatialDemandRevisionTargetRecord(record)
    if (path.basename(filePath) !== `${record.targetDate}.json`) {
      throw new Error(`Shadow target filename does not match its target date: ${filePath}`)
    }
    if (record.manifestDigestSha256 !== manifestDigestSha256
      || record.referenceStrategyContractDigestSha256
        !== manifest.referenceStrategy.strategyContractDigestSha256
      || record.referenceStrategyArtifactCoreDigestSha256
        !== manifest.referenceStrategy.strategyArtifactCoreDigestSha256) {
      throw new Error(`Shadow target ${record.targetDate} does not bind the sealed strategy reference.`)
    }
    const timing = spatialDemandRevisionRecordTiming({
      targetDate: record.targetDate,
      generatedAt: record.generatedAt,
      prospectiveStart: manifest.prospectiveStart,
    })
    if (!timing.eligible) {
      throw new Error(`Shadow target ${record.targetDate} violates sealed collection timing: ${timing.reason}.`)
    }
    records.push(record)
  }
  return records
}

async function readSettlements({
  stateDir,
  manifest,
  manifestDigestSha256,
  targetsByDate,
  executionContract,
}) {
  const records = []
  for (const filePath of await jsonFiles(stateDir, 'Spatial-demand-revision settlement directory')) {
    const record = await readOwnerOnlyRecord(filePath, 'Shadow settlement')
    validateSpatialDemandRevisionSettlementRecord(record)
    if (path.basename(filePath) !== `${record.targetDate}.json`) {
      throw new Error(`Settlement filename does not match its target date: ${filePath}`)
    }
    const target = targetsByDate.get(record.targetDate)
    if (!target || record.targetRecordDigestSha256 !== target.recordDigestSha256) {
      throw new Error(`Settlement ${record.targetDate} does not bind its immutable pre-open target.`)
    }
    if (record.manifestDigestSha256 !== manifestDigestSha256
      || record.executionContractDigestSha256 !== executionContract.digest) {
      throw new Error(`Settlement ${record.targetDate} does not bind the sealed manifest/execution contract.`)
    }
    const timing = spatialDemandRevisionSettlementTiming({
      targetDate: record.targetDate,
      generatedAt: record.generatedAt,
      prospectiveStart: manifest.prospectiveStart,
    })
    if (!timing.eligible) {
      throw new Error(`Settlement ${record.targetDate} violates the next-session timing contract: ${timing.reason}.`)
    }
    records.push(record)
  }
  return records
}

function executionDayFromSettlement(record, executionContract) {
  const bySymbol = new Map(record.symbolOutcomes.map((outcome) => [outcome.symbol, outcome]))
  const symbols = Object.fromEntries(record.symbolOutcomes.map((outcome) => {
    const previousClose = outcome.previous.adjustedClose
    const adjustedOpen = outcome.current.adjustedOpen
    const adjustedClose = outcome.current.adjustedClose
    return [outcome.symbol, {
      adjustedOpen,
      adjustedClose,
      overnightReturnPct: (adjustedOpen / previousClose - 1) * 100,
      intradayReturnPct: (adjustedClose / adjustedOpen - 1) * 100,
      closeToCloseReturnPct: (adjustedClose / previousClose - 1) * 100,
    }]
  }))
  const previousDate = bySymbol.get('UNG').previous.date
  return {
    date: record.targetDate,
    previousDate,
    calendarGapDays: Math.max(
      1,
      (isoDateTimestamp(record.targetDate, 'targetDate') - isoDateTimestamp(previousDate, 'previousDate'))
        / 86_400_000,
    ),
    symbols,
    indexReturnPct:
      executionContract.indexWeights.VOO * symbols.VOO.closeToCloseReturnPct
      + executionContract.indexWeights.QQQM * symbols.QQQM.closeToCloseReturnPct,
  }
}

function compoundedReturnPct(rows, field) {
  return (rows.reduce((equity, row) => equity * (1 + row[field] / 100), 1) - 1) * 100
}

function maximumDrawdownPct(rows, field) {
  let equity = 1
  let peak = 1
  let drawdown = 0
  for (const row of rows) {
    equity *= 1 + row[field] / 100
    peak = Math.max(peak, equity)
    drawdown = Math.min(drawdown, equity / peak - 1)
  }
  return drawdown * 100
}

function evaluateReturns({ sessions, targetsByDate, settlementsByDate, executionContract }) {
  const firstGapIndex = sessions.findIndex((date) => {
    const target = targetsByDate.get(date)
    return !target || target.decision.status === 'input-failure' || !settlementsByDate.has(date)
  })
  const prefix = firstGapIndex === -1 ? sessions : sessions.slice(0, firstGapIndex)
  if (!prefix.length) {
    return {
      status: sessions.length ? 'awaiting-complete-prefix' : 'awaiting-prospective-sessions',
      evaluatedThrough: null,
      sessionCount: 0,
      scenarioMetrics: null,
      rowsByScenario: {},
    }
  }
  const rowsByScenario = {}
  for (const scenarioId of Object.keys(executionContract.scenarios)) {
    let candidateState = createExecutionState(executionContract)
    let fallbackState = createExecutionState(executionContract)
    rowsByScenario[scenarioId] = prefix.map((date) => {
      const target = targetsByDate.get(date).decision.target
      const day = executionDayFromSettlement(settlementsByDate.get(date), executionContract)
      const candidateStep = applyExecutionStep({
        state: candidateState,
        day,
        targetWeights: targetWeightsForAllocation(executionContract, {
          gasPosition: target.gasPosition,
          investedIndexFraction: target.indexFraction,
        }),
        contract: executionContract,
        scenarioId,
      })
      const fallbackStep = applyExecutionStep({
        state: fallbackState,
        day,
        targetWeights: targetWeightsForAllocation(executionContract, {
          gasPosition: 0,
          investedIndexFraction: 1,
        }),
        contract: executionContract,
        scenarioId,
      })
      candidateState = candidateStep.state
      fallbackState = fallbackStep.state
      return {
        date,
        candidateReturnPct: candidateStep.netReturnPct,
        fallbackReturnPct: fallbackStep.netReturnPct,
        incrementalReturnPct:
          ((1 + candidateStep.netReturnPct / 100) / (1 + fallbackStep.netReturnPct / 100) - 1) * 100,
      }
    })
  }
  const scenarioMetrics = Object.fromEntries(Object.entries(rowsByScenario).map(([scenarioId, rows]) => {
    const candidateCompoundedReturnPct = compoundedReturnPct(rows, 'candidateReturnPct')
    const fallbackCompoundedReturnPct = compoundedReturnPct(rows, 'fallbackReturnPct')
    return [scenarioId, {
      sessionCount: rows.length,
      candidateCompoundedReturnPct: round(candidateCompoundedReturnPct),
      fallbackCompoundedReturnPct: round(fallbackCompoundedReturnPct),
      compoundedIncrementalReturnPct: round(compoundedReturnPct(rows, 'incrementalReturnPct')),
      compoundedReturnDifferencePct: round(candidateCompoundedReturnPct - fallbackCompoundedReturnPct),
      candidateMaximumDrawdownPct: round(maximumDrawdownPct(rows, 'candidateReturnPct')),
      incrementalMaximumDrawdownPct: round(maximumDrawdownPct(rows, 'incrementalReturnPct')),
    }]
  }))
  return {
    status: prefix.length === sessions.length ? 'complete-through-requested-window' : 'partial-contiguous-prefix',
    evaluatedThrough: prefix.at(-1),
    sessionCount: prefix.length,
    scenarioMetrics,
    rowsByScenario,
  }
}

function componentSeason(record) {
  const season = record.featureBundle?.season
  if (!['summer', 'winter'].includes(season)) return null
  const year = Number(record.targetDate.slice(0, 4))
  const month = Number(record.targetDate.slice(5, 7))
  return season === 'summer'
    ? { component: 'summer', seasonId: `summer-${year}` }
    : month >= 11
      ? { component: 'winter', seasonId: `winter-${year}-${year + 1}` }
      : { component: 'winter', seasonId: `winter-${year - 1}-${year}` }
}

export function spatialDemandRevisionIndependentEpisodes({ sessions, records }) {
  const indexByDate = new Map(sessions.map((date, index) => [date, index]))
  const signals = records
    .filter((record) => record.decision.status === 'valid-signal' && indexByDate.has(record.targetDate))
    .toSorted((left, right) => left.targetDate.localeCompare(right.targetDate))
  const episodes = []
  const embargo = SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.evidence.episodeEmbargoSessions
  for (const record of signals) {
    const index = indexByDate.get(record.targetDate)
    const current = episodes.at(-1)
    if (!current || index - current.lastSignalSessionIndex > embargo) {
      const identity = componentSeason(record)
      episodes.push({
        startDate: record.targetDate,
        endDate: record.targetDate,
        firstSignalSessionIndex: index,
        lastSignalSessionIndex: index,
        component: identity?.component ?? null,
        seasonId: identity?.seasonId ?? null,
        signalCount: 1,
      })
    } else {
      current.endDate = record.targetDate
      current.lastSignalSessionIndex = index
      current.signalCount += 1
    }
  }
  return episodes
}

function episodeRobustness({ episodes, baselineRows, sessions }) {
  if (!episodes.length || !baselineRows?.length) {
    return {
      topPositiveContributionFraction: null,
      leaveOneComponentSeasonOutPositive: false,
      contributions: [],
    }
  }
  const rowByDate = new Map(baselineRows.map((row) => [row.date, row]))
  const contributions = episodes.map((episode) => {
    const endIndex = Math.min(sessions.length - 1, episode.lastSignalSessionIndex + 1)
    let logIncrement = 0
    for (let index = episode.firstSignalSessionIndex; index <= endIndex; index += 1) {
      const row = rowByDate.get(sessions[index])
      if (row) logIncrement += Math.log1p(row.incrementalReturnPct / 100)
    }
    return {
      ...episode,
      incrementalReturnPct: round(Math.expm1(logIncrement) * 100),
    }
  })
  const positives = contributions.filter((episode) => episode.incrementalReturnPct > 0)
  const positiveTotal = positives.reduce((sum, episode) => sum + episode.incrementalReturnPct, 0)
  const topPositiveContributionFraction = positiveTotal > 0
    ? Math.max(...positives.map((episode) => episode.incrementalReturnPct)) / positiveTotal
    : null
  const seasonIds = [...new Set(contributions.map((episode) => episode.seasonId).filter(Boolean))]
  const leaveOneComponentSeasonOutPositive = seasonIds.length > 0 && seasonIds.every((seasonId) => (
    contributions
      .filter((episode) => episode.seasonId !== seasonId)
      .reduce((sum, episode) => sum + Math.log1p(episode.incrementalReturnPct / 100), 0) > 0
  ))
  return {
    topPositiveContributionFraction: topPositiveContributionFraction === null
      ? null
      : round(topPositiveContributionFraction),
    leaveOneComponentSeasonOutPositive,
    contributions,
  }
}

async function main() {
  const manifestPath = argumentValue('manifest')
    ? path.resolve(argumentValue('manifest'))
    : path.join(repoDir, 'config', 'qore-spatial-demand-revision-shadow.json')
  const stateRoot = argumentValue('state-dir')
    ? path.resolve(argumentValue('state-dir'))
    : defaultStateRoot
  const { manifest, manifestDigestSha256 } = await readSpatialDemandRevisionManifest(
    repoDir,
    manifestPath,
  )
  const executionContract = loadResearchExecutionContract(repoDir)
  const throughDate = argumentValue('through') ?? addDays(newYorkDate(), -1)
  isoDateTimestamp(throughDate, '--through')
  const targets = await readTargets({
    stateDir: path.join(stateRoot, 'targets'),
    manifest,
    manifestDigestSha256,
  })
  const targetsByDate = new Map(targets.map((record) => [record.targetDate, record]))
  const settlements = await readSettlements({
    stateDir: path.join(stateRoot, 'settlements'),
    manifest,
    manifestDigestSha256,
    targetsByDate,
    executionContract,
  })
  const settlementsByDate = new Map(settlements.map((record) => [record.targetDate, record]))
  const inWindow = targets.filter((record) => record.targetDate <= throughDate)
  const sessions = spatialDemandRevisionExpectedSessions(manifest.prospectiveStart, throughDate)
  const recordedDates = new Set(inWindow.map((record) => record.targetDate))
  const settledDates = new Set(settlements
    .filter((record) => record.targetDate <= throughDate)
    .map((record) => record.targetDate))
  const missingSessions = sessions.filter((date) => !recordedDates.has(date))
  const missingSettlements = sessions.filter((date) => recordedDates.has(date) && !settledDates.has(date))
  const inputFailures = inWindow.filter((record) => record.decision.status === 'input-failure')
  const validSignals = inWindow.filter((record) => record.decision.status === 'valid-signal')
  const validFlats = inWindow.filter((record) => record.decision.status === 'valid-flat')
  const seasons = Object.fromEntries(['summer', 'winter', 'inactive'].map((season) => [
    season,
    inWindow.filter((record) => record.featureBundle?.season === season).length,
  ]))
  const returns = evaluateReturns({ sessions, targetsByDate, settlementsByDate, executionContract })
  const evaluatedRecords = returns.evaluatedThrough
    ? inWindow.filter((record) => record.targetDate <= returns.evaluatedThrough)
    : []
  const episodes = spatialDemandRevisionIndependentEpisodes({
    sessions,
    records: evaluatedRecords,
  })
  const episodeCountsByComponent = Object.fromEntries(['summer', 'winter'].map((component) => [
    component,
    episodes.filter((episode) => episode.component === component).length,
  ]))
  const distinctSeasonsByComponent = Object.fromEntries(['summer', 'winter'].map((component) => [
    component,
    new Set(episodes
      .filter((episode) => episode.component === component)
      .map((episode) => episode.seasonId)).size,
  ]))
  const robustness = episodeRobustness({
    episodes,
    baselineRows: returns.rowsByScenario.baseline,
    sessions,
  })
  const evidence = SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.evidence
  const baseline = returns.scenarioMetrics?.baseline
  const elevated = returns.scenarioMetrics?.elevated
  const stress = returns.scenarioMetrics?.stress
  const empiricalGates = {
    completeTargetAndSettlementWindow:
      missingSessions.length === 0 && missingSettlements.length === 0 && inputFailures.length === 0,
    minimumIndependentEpisodes: episodes.length >= evidence.minimumIndependentEpisodes,
    minimumEpisodesByComponent: ['summer', 'winter'].every(
      (component) => episodeCountsByComponent[component] >= evidence.minimumEpisodesByComponent,
    ),
    minimumSeasonsByComponent: ['summer', 'winter'].every(
      (component) => distinctSeasonsByComponent[component] >= evidence.minimumSeasonsByComponent,
    ),
    baselineReturn: Boolean(
      baseline && baseline.compoundedIncrementalReturnPct > evidence.minimumCompoundedActiveReturnPct.baseline,
    ),
    elevatedReturn: Boolean(
      elevated && elevated.compoundedIncrementalReturnPct > evidence.minimumCompoundedActiveReturnPct.elevated,
    ),
    stressReturn: Boolean(
      stress && stress.compoundedIncrementalReturnPct >= evidence.minimumCompoundedActiveReturnPct.stress,
    ),
    maximumActiveDrawdown: Boolean(
      baseline && baseline.incrementalMaximumDrawdownPct >= -evidence.maximumActiveDrawdownPct,
    ),
    concentration: robustness.topPositiveContributionFraction !== null
      && robustness.topPositiveContributionFraction <= evidence.maximumTopEpisodePositiveContributionFraction,
    leaveOneComponentSeasonOut: robustness.leaveOneComponentSeasonOutPositive,
  }
  const blockingReasons = [
    ...(manifest.externalAnchor === null ? ['external-preregistration-anchor-missing'] : []),
    ...(manifest.pristineForwardEvidence !== true ? ['evidence-not-pristine'] : []),
    ...Object.entries(empiricalGates).filter(([, passed]) => !passed).map(([gate]) => gate),
  ]

  const report = {
    schemaVersion: 1,
    reportKind: 'qore-spatial-demand-revision-shadow-evaluation',
    generatedAt: new Date().toISOString(),
    executionEligible: false,
    publicStrategy: false,
    candidateId,
    candidateContractDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256,
    registryDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY_DIGEST_SHA256,
    outcomePolicyDigestSha256: SPATIAL_DEMAND_REVISION_OUTCOME_POLICY_DIGEST_SHA256,
    manifestDigestSha256,
    executionContract: {
      contractId: executionContract.contractId,
      digestSha256: executionContract.digest,
      selectionScenarioId: executionContract.selectionScenarioId,
    },
    manifest: {
      sealedAt: manifest.sealedAt,
      prospectiveStart: manifest.prospectiveStart,
      externalAnchor: manifest.externalAnchor,
      pristineForwardEvidence: manifest.pristineForwardEvidence,
      historicalEvidenceStatus: manifest.historicalEvidenceStatus,
      referenceStrategy: manifest.referenceStrategy,
    },
    window: {
      throughDate,
      expectedSessionCount: sessions.length,
      recordedSessionCount: inWindow.length,
      settledSessionCount: settlements.filter((record) => record.targetDate <= throughDate).length,
      missingSessionCount: missingSessions.length,
      missingSessions,
      missingSettlementCount: missingSettlements.length,
      missingSettlements,
      recordsAfterThroughDate: targets.filter((record) => record.targetDate > throughDate).length,
    },
    observations: {
      validSignalCount: validSignals.length,
      validFlatCount: validFlats.length,
      inputFailureCount: inputFailures.length,
      longSignalCount: validSignals.filter((record) => record.decision.target.direction === 'long').length,
      shortSignalCount: validSignals.filter((record) => record.decision.target.direction === 'short').length,
      independentEpisodeCount: episodes.length,
      episodeCountsByComponent,
      distinctSeasonsByComponent,
      seasons,
    },
    returnEvaluation: {
      status: returns.status,
      evaluatedThrough: returns.evaluatedThrough,
      sessionCount: returns.sessionCount,
      comparator: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.evidence.comparator,
      scenarioMetrics: returns.scenarioMetrics,
      episodeRobustness: robustness,
    },
    promotionAssessment: {
      eligible: false,
      empiricalGates,
      blockingReasons: [...new Set(blockingReasons)],
      policy:
        'Even a full empirical pass can only nominate a new reviewed production proposal; this research shadow is never executable.',
    },
  }
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
