#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import {
  adjustedBarFromYahooRow,
  applyExecutionStep,
  causalReturnContributionsForRow,
  createExecutionState,
  loadExecutionCalendar,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
  validateResearchExecutionContract,
} from './lib/qore-research-execution.mjs'
import { REBALANCE_DEADBAND_POLICY_ID } from './lib/qore-rebalance-deadband.mjs'
import {
  eiaReportAvailableAtOpen,
  nasaPowerActualAvailableAtOpen,
} from './lib/qore-signal-availability.mjs'
import {
  assertEiaStorageReleaseCalendarCoverage,
  eiaStorageReleaseAt,
} from './lib/eia-release-time.mjs'
import {
  COMPONENT_ARTIFACT_SCHEMA_VERSION,
  COMPONENT_SELECTED_TRADES_BINDING_SCHEMA_VERSION,
  validateComponentArtifact,
} from './lib/qore-component-artifact.mjs'
import {
  ALL_YEAR_OUTPUT_ARTIFACT_BINDING_SCHEMA_VERSION,
  validateAllYearOutputArtifactInputs,
  validateAllYearOutputArtifacts,
} from './lib/qore-all-year-output-artifacts.mjs'
import {
  executableLiveComponentContractDigestSha256,
  liveComponentContractDigestSha256,
} from './lib/qore-live-contract.mjs'
import { ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION } from './lib/qore-live-strategy-artifact.mjs'

const repoRoot = process.cwd()

function close(left, right, tolerance = 1e-8, message = '') {
  assert.ok(Math.abs(left - right) <= tolerance, `${message} expected ${right}, received ${left}`)
}

function fixtureContract() {
  return {
    schemaVersion: 1,
    contractId: 'fixture',
    selectionScenarioId: 'baseline',
    priceConvention: 'fixture adjusted open',
    deploymentFraction: 1,
    rebalanceDeadbandPct: 0,
    rebalanceDeadbandPolicyId: REBALANCE_DEADBAND_POLICY_ID,
    indexWeights: { VOO: 0.8, QQQM: 0.2 },
    scenarios: {
      baseline: {
        selectionEligible: true,
        oneWayBps: { UNG: 3.2, VOO: 1, QQQM: 1 },
        annualBorrowRatePct: 0,
      },
      borrow: {
        selectionEligible: false,
        oneWayBps: { UNG: 0, VOO: 0, QQQM: 0 },
        annualBorrowRatePct: 10,
      },
    },
  }
}

function fixtureDay({
  date = '2026-01-05',
  previousDate = '2026-01-02',
  gap = 3,
  ungOvernight = 0,
  ungIntraday = 0,
  vooOvernight = 0,
  vooIntraday = 0,
  qqqmOvernight = 0,
  qqqmIntraday = 0,
} = {}) {
  const symbol = (overnightReturnPct, intradayReturnPct) => ({
    adjustedOpen: 100,
    adjustedClose: 100 * (1 + intradayReturnPct / 100),
    overnightReturnPct,
    intradayReturnPct,
    closeToCloseReturnPct: ((1 + overnightReturnPct / 100) * (1 + intradayReturnPct / 100) - 1) * 100,
  })
  const symbols = {
    UNG: symbol(ungOvernight, ungIntraday),
    VOO: symbol(vooOvernight, vooIntraday),
    QQQM: symbol(qqqmOvernight, qqqmIntraday),
  }
  return {
    date,
    previousDate,
    calendarGapDays: gap,
    symbols,
    indexReturnPct: 0.8 * symbols.VOO.closeToCloseReturnPct + 0.2 * symbols.QQQM.closeToCloseReturnPct,
    indexOvernightReturnPct: 0.8 * vooOvernight + 0.2 * qqqmOvernight,
    indexIntradayReturnPct: 0.8 * vooIntraday + 0.2 * qqqmIntraday,
  }
}

const adjusted = adjustedBarFromYahooRow({
  date: '2026-01-02',
  open: '100',
  high: '110',
  low: '90',
  close: '105',
  adjustedClose: '52.5',
})
close(adjusted.open, 50, 1e-12, 'split-adjusted open')
close(adjusted.high, 55, 1e-12, 'split-adjusted high')
assert.equal(eiaStorageReleaseAt('2024-12-27'), '2025-01-03T15:30:00.000Z')
assert.equal(eiaStorageReleaseAt('2025-01-03'), '2025-01-08T17:00:00.000Z')
assert.equal(eiaStorageReleaseAt('2013-10-11'), '2013-10-22T14:30:00.000Z')
assert.equal(eiaStorageReleaseAt('2023-11-03'), '2023-11-16T15:30:00.000Z')
assert.equal(eiaStorageReleaseAt('2026-11-06'), '2026-11-13T15:30:00.000Z')
assert.equal(eiaStorageReleaseAt('2026-11-20'), '2026-11-25T17:00:00.000Z')
const releaseCalendarCoverageFixture = {
  calendarId: 'fixture-eia-release-calendar',
  verifiedThroughPeriodEndDate: '2026-12-25',
}
assert.equal(
  assertEiaStorageReleaseCalendarCoverage('2026-11-27', releaseCalendarCoverageFixture).remainingCoverageDays,
  28,
)
assert.throws(
  () => assertEiaStorageReleaseCalendarCoverage('2026-11-28', releaseCalendarCoverageFixture),
  /stale or expiring: verified through period 2026-12-25.*28-day live guard/,
)
assert.equal(eiaReportAvailableAtOpen(eiaStorageReleaseAt('2024-12-27'), '2025-01-03'), false)
assert.equal(eiaReportAvailableAtOpen(eiaStorageReleaseAt('2024-12-27'), '2025-01-06'), true)
assert.equal(nasaPowerActualAvailableAtOpen('2026-01-05', '2026-01-07'), false)
assert.equal(nasaPowerActualAvailableAtOpen('2026-01-05', '2026-01-08'), true)

const contract = fixtureContract()
validateResearchExecutionContract(contract)
const conservedRoundedTarget = targetWeightsForAllocation(contract, {
  gasPosition: 0.1976,
  investedIndexFraction: 0.8025,
})
close(
  Math.abs(conservedRoundedTarget.UNG) + conservedRoundedTarget.VOO + conservedRoundedTarget.QQQM,
  1,
  1e-12,
  'rounded target capital conservation',
)
assert.throws(
  () => targetWeightsForAllocation(contract, { gasPosition: 1.01, investedIndexFraction: 0 }),
  /execution targets/,
)
assert.throws(
  () => validateResearchExecutionContract({
    ...contract,
    scenarios: {
      ...contract.scenarios,
      borrow: { ...contract.scenarios.borrow, selectionEligible: true },
    },
  }),
  /Exactly one research execution scenario/,
)
assert.throws(
  () => validateResearchExecutionContract({ ...contract, indexWeights: { VOO: 0.9, QQQM: 0.2 } }),
  /index weights must be non-negative and sum to one/,
)

const entry = applyExecutionStep({
  state: createExecutionState(contract),
  day: fixtureDay({ ungOvernight: 10, ungIntraday: 5 }),
  targetWeights: targetWeightsForAllocation(contract, { gasPosition: 0.35, investedIndexFraction: 0.65 }),
  contract,
})
close(entry.overnightPortfolioReturnPct, 0, 1e-10, 'new gas target must not earn the prior-close-to-open gas move')
close(entry.intradayPortfolioReturnPct, 1.75, 1e-10, 'new gas target earns only the open-to-close gas move')
close(entry.priorCloseReturnContributionPct, 0, 1e-10, 'new thesis receives no prior-close contribution')
close(
  entry.currentSessionReturnContributionPct,
  entry.netReturnPct,
  1e-10,
  'new thesis receives the complete current-session contribution',
)

const zeroDay = fixtureDay()
assert.throws(
  () => applyExecutionStep({
    state: { closeWeights: { UNG: 0, VOO: 0.8, QQQM: 0.2 }, previousDate: '2025-12-31' },
    day: zeroDay,
    targetWeights: { UNG: 0, VOO: 0.8, QQQM: 0.2 },
    contract,
  }),
  /execution calendar is discontinuous/,
)
const entryTurnover = applyExecutionStep({
  state: createExecutionState(contract),
  day: zeroDay,
  targetWeights: targetWeightsForAllocation(contract, { gasPosition: 0.35, investedIndexFraction: 0.65 }),
  contract,
})
close(entryTurnover.turnoverBySymbol.UNG, 0.35, 1e-12, 'entry gas turnover')
close(entryTurnover.turnoverBySymbol.VOO, 0.28, 1e-12, 'entry VOO turnover')
close(entryTurnover.turnoverBySymbol.QQQM, 0.07, 1e-12, 'entry QQQM turnover')
close(entryTurnover.totalTurnover, 0.7, 1e-12, 'entry total turnover')
close(entryTurnover.tradingCostPct, 0.0147, 1e-12, 'all-leg entry cost')

const shortFlip = applyExecutionStep({
  state: { closeWeights: { UNG: 0.35, VOO: 0.52, QQQM: 0.13 }, previousDate: '2026-01-02' },
  day: zeroDay,
  targetWeights: { UNG: -0.35, VOO: 0.52, QQQM: 0.13 },
  contract,
})
close(shortFlip.turnoverBySymbol.UNG, 0.7, 1e-12, 'long-to-short gas turnover')
close(shortFlip.indexTurnover, 0, 1e-12, 'unchanged index target turnover')

const exit = applyExecutionStep({
  state: { closeWeights: { UNG: 0.35, VOO: 0.52, QQQM: 0.13 }, previousDate: '2026-01-02' },
  day: fixtureDay({ ungOvernight: 10 }),
  targetWeights: { UNG: 0, VOO: 0.8, QQQM: 0.2 },
  contract,
})
close(exit.overnightPortfolioReturnPct, 3.5, 1e-10, 'exiting gas target must retain the overnight gas move')
close(exit.priorCloseReturnContributionPct, 3.5, 1e-10, 'exiting thesis retains the overnight contribution')
close(
  exit.priorCloseReturnContributionPct + exit.currentSessionReturnContributionPct,
  exit.netReturnPct,
  1e-10,
  'causal return contributions reconcile on a thesis transition',
)

const borrow = applyExecutionStep({
  state: { closeWeights: { UNG: -0.35, VOO: 0.52, QQQM: 0.13 }, previousDate: '2026-01-02' },
  day: fixtureDay({ gap: 3 }),
  targetWeights: { UNG: -0.35, VOO: 0.52, QQQM: 0.13 },
  contract,
  scenarioId: 'borrow',
})
close(borrow.borrowCostPct, 0.35 * 10 * 3 / 360, 1e-12, 'three-calendar-day short borrow')
close(
  borrow.priorCloseReturnContributionPct,
  -borrow.borrowCostPct,
  1e-12,
  'overnight borrow belongs to the prior-close thesis',
)

const guardedDeadbandContract = { ...contract, rebalanceDeadbandPct: 0.75 }
const smallUngEntry = applyExecutionStep({
  state: { closeWeights: { UNG: 0, VOO: 0.8, QQQM: 0.2 }, previousDate: '2026-01-02' },
  day: zeroDay,
  targetWeights: { UNG: 0.005, VOO: 0.796, QQQM: 0.199 },
  contract: guardedDeadbandContract,
})
close(smallUngEntry.executedWeights.UNG, 0.005, 1e-12, 'UNG entries bypass the rebalance deadband')
close(smallUngEntry.executedWeights.VOO, 0.796, 1e-12, 'paired VOO reductions follow a bypassed UNG entry')
close(smallUngEntry.executedWeights.QQQM, 0.199, 1e-12, 'paired QQQM reductions follow a bypassed UNG entry')

const allocationEnvelopeContract = {
  ...guardedDeadbandContract,
  deploymentFraction: 0.98,
}
const pairedEntryReduction = applyExecutionStep({
  state: { closeWeights: { UNG: 0, VOO: 0.784, QQQM: 0.196 }, previousDate: '2026-01-02' },
  day: zeroDay,
  targetWeights: { UNG: 0.005, VOO: 0.78, QQQM: 0.195 },
  contract: allocationEnvelopeContract,
})
close(pairedEntryReduction.executedWeights.UNG, 0.005, 1e-12, 'small UNG entry executes atomically')
close(pairedEntryReduction.executedWeights.VOO, 0.78, 1e-12, 'small paired VOO reduction executes atomically')
close(pairedEntryReduction.executedWeights.QQQM, 0.195, 1e-12, 'small paired QQQM reduction executes atomically')
close(
  Object.values(pairedEntryReduction.executedWeights).reduce((sum, weight) => sum + Math.abs(weight), 0),
  allocationEnvelopeContract.deploymentFraction,
  1e-12,
  'deadband bypass cannot exceed the deployment envelope',
)

const smallUngExit = applyExecutionStep({
  state: { closeWeights: { UNG: 0.005, VOO: 0.796, QQQM: 0.199 }, previousDate: '2026-01-02' },
  day: zeroDay,
  targetWeights: { UNG: 0, VOO: 0.8, QQQM: 0.2 },
  contract: guardedDeadbandContract,
})
close(smallUngExit.executedWeights.UNG, 0, 1e-12, 'UNG exits bypass the rebalance deadband')

const smallUngIncrease = applyExecutionStep({
  state: { closeWeights: { UNG: 0.35, VOO: 0.52, QQQM: 0.13 }, previousDate: '2026-01-02' },
  day: zeroDay,
  targetWeights: { UNG: 0.354, VOO: 0.5168, QQQM: 0.1292 },
  contract: guardedDeadbandContract,
})
close(smallUngIncrease.executedWeights.UNG, 0.35, 1e-12, 'same-direction UNG increases may remain inside the deadband')

const smallUngReduction = applyExecutionStep({
  state: { closeWeights: { UNG: 0.354, VOO: 0.5168, QQQM: 0.1292 }, previousDate: '2026-01-02' },
  day: zeroDay,
  targetWeights: { UNG: 0.35, VOO: 0.52, QQQM: 0.13 },
  contract: guardedDeadbandContract,
})
close(smallUngReduction.executedWeights.UNG, 0.35, 1e-12, 'UNG risk reductions bypass the rebalance deadband')

const overDeploymentReduction = applyExecutionStep({
  state: { closeWeights: { UNG: 0, VOO: 0.808, QQQM: 0.202 }, previousDate: '2026-01-02' },
  day: zeroDay,
  targetWeights: { UNG: 0, VOO: 0.8, QQQM: 0.2 },
  contract: guardedDeadbandContract,
})
close(overDeploymentReduction.executedWeights.VOO, 0.8, 1e-12, 'over-deployment VOO reductions bypass the deadband')
close(overDeploymentReduction.executedWeights.QQQM, 0.2, 1e-12, 'over-deployment QQQM reductions bypass the deadband')

assert.deepEqual(
  causalReturnContributionsForRow({
    priorCloseThesisKind: 'cold-long',
    priorCloseComponentThesisKinds: ['follow:cold-long'],
    thesisKind: 'reversion-short',
    componentThesisKinds: ['reversion:reversion-short'],
    priorCloseReturnContributionPct: 1.25,
    currentSessionReturnContributionPct: -0.4,
    netReturnPct: 0.85,
    priorUngPosition: 0.3,
    deployedUngPosition: -0.2,
  }),
  [
    {
      period: 'prior-close-to-open',
      thesisKind: 'cold-long',
      componentThesisKinds: ['follow:cold-long'],
      returnPct: 1.25,
      position: 0.3,
    },
    {
      period: 'current-session',
      thesisKind: 'reversion-short',
      componentThesisKinds: ['reversion:reversion-short'],
      returnPct: -0.4,
      position: -0.2,
    },
  ],
  'transition-day contributions retain their causal thesis owners',
)

const summaryPath = path.join(repoRoot, 'data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json')
const summerSummaryPath = path.join(
  repoRoot,
  'data/qore/research/strategy-agent-runs/ngas-summer-alpha/run-summary.json',
)
const tradesPath = path.join(repoRoot, 'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv')
const displayCurvePath = path.join(repoRoot, 'data/qore/research/strategy-agent-runs/ngas-all-year-beta/display-curve.csv')
for (const checkedInSummaryPath of [summaryPath, summerSummaryPath]) {
  const sizeBytes = fs.statSync(checkedInSummaryPath).size
  assert.ok(
    sizeBytes <= 512 * 1024,
    `${path.relative(repoRoot, checkedInSummaryPath)} must stay at or below 512 KiB; received ${sizeBytes} bytes`,
  )
}
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
const tradesRaw = fs.readFileSync(tradesPath)
const parsedAllYearTrades = Papa.parse(tradesRaw.toString('utf8'), { header: true, skipEmptyLines: true })
const rows = parsedAllYearTrades.data
const displayCurveRaw = fs.readFileSync(displayCurvePath)
const parsedDisplayCurve = Papa.parse(displayCurveRaw.toString('utf8'), { header: true, skipEmptyLines: true })
const displayRows = parsedDisplayCurve.data
const summerTradesPath = path.join(
  repoRoot,
  'data/qore/research/strategy-agent-runs/ngas-summer-alpha/selected-trades.csv',
)
const summerTradesRaw = fs.readFileSync(summerTradesPath)
const summerTrades = Papa.parse(
  summerTradesRaw.toString('utf8'),
  { header: true, skipEmptyLines: true },
)
const summerRows = summerTrades.data
const winterTradesPath = path.join(
  repoRoot,
  'data/qore/research/strategy-agent-runs/ngas-winter-alpha/selected-trades.csv',
)
const winterTradesRaw = fs.readFileSync(winterTradesPath)
const winterTrades = Papa.parse(
  winterTradesRaw.toString('utf8'),
  { header: true, skipEmptyLines: true },
)
const winterRows = winterTrades.data
const componentTradeArtifacts = new Map([
  ['ngas-summer-alpha', {
    raw: summerTradesRaw,
    headers: summerTrades.meta.fields ?? [],
    rows: summerRows,
  }],
  ['ngas-winter-alpha', {
    raw: winterTradesRaw,
    headers: winterTrades.meta.fields ?? [],
    rows: winterRows,
  }],
])
const executionContract = loadResearchExecutionContract(repoRoot)
assert.equal(summary.artifactSchemaVersion, ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION)
assert.equal(
  summary.data.selectedTradesArtifact.schemaVersion,
  ALL_YEAR_OUTPUT_ARTIFACT_BINDING_SCHEMA_VERSION,
)
assert.equal(
  summary.data.displayCurveArtifact.schemaVersion,
  ALL_YEAR_OUTPUT_ARTIFACT_BINDING_SCHEMA_VERSION,
)
assert.equal(
  summary.data.selectedTradesArtifact.contentDigestSha256,
  crypto.createHash('sha256').update(tradesRaw).digest('hex'),
)
assert.equal(
  summary.data.displayCurveArtifact.contentDigestSha256,
  crypto.createHash('sha256').update(displayCurveRaw).digest('hex'),
)
assert.doesNotThrow(() => validateAllYearOutputArtifacts(repoRoot, summary))

const allYearArtifactInputs = {
  summary,
  selectedTrades: {
    raw: tradesRaw,
    headers: parsedAllYearTrades.meta.fields ?? [],
    rows,
  },
  displayCurve: {
    raw: displayCurveRaw,
    headers: parsedDisplayCurve.meta.fields ?? [],
    rows: displayRows,
  },
}
assert.throws(
  () => validateAllYearOutputArtifactInputs({
    ...allYearArtifactInputs,
    displayCurve: {
      ...allYearArtifactInputs.displayCurve,
      raw: Buffer.concat([displayCurveRaw, Buffer.from('\n')]),
    },
  }),
  /display-curve artifact binding does not match its reviewed summary/,
  'changing display-curve bytes must invalidate the sealed summary binding',
)
const allYearLinesWithInteriorDeletion = tradesRaw.toString('utf8').trimEnd().split('\n')
allYearLinesWithInteriorDeletion.splice(101, 1)
const allYearRawWithInteriorDeletion = Buffer.from(`${allYearLinesWithInteriorDeletion.join('\n')}\n`)
const allYearTradesWithInteriorDeletion = Papa.parse(allYearRawWithInteriorDeletion.toString('utf8'), {
  header: true,
  skipEmptyLines: true,
})
assert.throws(
  () => validateAllYearOutputArtifactInputs({
    ...allYearArtifactInputs,
    selectedTrades: {
      raw: allYearRawWithInteriorDeletion,
      headers: allYearTradesWithInteriorDeletion.meta.fields ?? [],
      rows: allYearTradesWithInteriorDeletion.data,
    },
  }),
  /selected-trades and display-curve dates diverge/,
  'removing one selected ledger row must fail the sealed cross-artifact date shape',
)
const displayRowsWithProjectionMismatch = structuredClone(displayRows)
displayRowsWithProjectionMismatch[100].equityPct = String(
  Number(displayRowsWithProjectionMismatch[100].equityPct) + 1,
)
assert.throws(
  () => validateAllYearOutputArtifactInputs({
    ...allYearArtifactInputs,
    displayCurve: {
      ...allYearArtifactInputs.displayCurve,
      rows: displayRowsWithProjectionMismatch,
    },
  }),
  /display-curve equityPct does not match selected-trades/,
  'changing a displayed projection must fail even if a new display binding could be generated for it',
)
assert.equal(
  Object.hasOwn(summary.validation.integrity, 'paperExecutionAccountPseudonymSha256'),
  false,
  'browser-imported research artifacts must not expose a stable paper account pseudonym',
)
assert.equal(summary.contract.execution.contractDigest, executionContract.digest)
assert.equal(
  summary.contract.liveInference.componentContractDigestSha256,
  liveComponentContractDigestSha256(summary.contract.liveInference.componentContract),
)
assert.notEqual(
  summary.contract.liveInference.componentContractDigestSha256,
  executableLiveComponentContractDigestSha256,
  'legacy hours-0 Summer research must not match the corrected executable component contract',
)
assert.equal(summary.search.selectionUsedHoldout, false)
assert.equal(summary.search.eligibleCandidateCount, summary.status === 'research-baseline' ? 1 : 0)
assert.equal(summary.candidates[0].eligible, summary.status === 'research-baseline')
assert.equal(
  summary.candidates[0].validationReturnPct,
  summary.validation.selectionMetrics.strategy.validation.totalReturnPct,
  'candidate selection fields must use the component-safe validation prefix',
)
assert.equal(
  summary.candidates[0].validationEdgePct,
  summary.validation.selectionMetrics.splitEdges.validation,
  'candidate validation edge must exclude later reporting-only composite returns',
)
assert.deepEqual(Object.keys(summary.validation.promotionGates).sort(), [
  'brokerExecution',
  'liveApproval',
  'liveContract',
  'liveTargetParity',
  'paperApproval',
  'paperExecutionEvidence',
  'positiveTrainEdge',
  'positiveValidationEdge',
  'preHoldoutBootstrapSignificance',
  'pristineForwardEvidence',
  'strategyContractSeal',
  'summerComponent',
  'summerTemporalContract',
  'trainMaxDrawdown',
  'validationMaxDrawdown',
  'winterComponent',
])
assert.equal(summary.validation.liveTargetParity.exactTargetParity, false)
assert.equal(summary.validation.liveTargetParity.inputContractValid, false)
assert.equal(summary.validation.liveTargetParity.comparedRowCount, 1947)
assert.equal(summary.validation.liveTargetParity.mismatchCount, 0)
assert.equal(summary.validation.liveTargetParity.componentStrategyIdMismatchCount, 0)
assert.equal(summary.validation.liveTargetParity.windowIdMismatchCount, 0)
assert.ok(summary.validation.liveTargetParity.inputContractFailureCount > 20)
assert.equal(summary.validation.liveTargetParity.inputContractFailureSamples.length, 20)
assert.match(summary.validation.liveTargetParity.inputContractFailureDigestSha256, /^[a-f0-9]{64}$/)
assert.equal(Object.hasOwn(summary.validation.liveTargetParity, 'inputContractFailures'), false)
assert.equal(summary.validation.liveTargetParity.components.summer.comparedRowCount, 585)
assert.equal(summary.validation.liveTargetParity.components.summer.mismatchCount, 0)
assert.equal(summary.validation.liveTargetParity.components.summer.targetReplayExact, true)
assert.equal(summary.validation.liveTargetParity.components.summer.inputContractValid, false)
assert.equal(summary.validation.liveTargetParity.components.winter.comparedRowCount, 1362)
assert.equal(summary.validation.liveTargetParity.components.winter.mismatchCount, 0)
assert.equal(summary.validation.liveTargetParity.components.winter.exactTargetParity, true)
assert.equal(summary.validation.promotionGates.liveTargetParity, false)
assert.equal(
  summary.validation.selectionRealityCheck.sampleCount,
  rows.filter((row) => row.entryTradeDate <= summary.contract.selectionEnd).length,
  'all-year eligibility bootstrap must stop before the earliest component holdout',
)
const selectionRows = rows.filter((row) => row.entryTradeDate <= summary.contract.selectionEnd)
assert.equal(summary.validation.selectionRealityCheck.sampleStartDate, selectionRows[0].entryTradeDate)
assert.equal(summary.validation.selectionRealityCheck.sampleEndDate, selectionRows.at(-1).entryTradeDate)
assert.equal(
  summary.validation.selectionRealityCheck.inputDateDigest,
  crypto.createHash('sha256').update(selectionRows.map((row) => row.entryTradeDate).join('\n')).digest('hex'),
  'all-year eligibility bootstrap must preserve the chronological artifact row order',
)
const componentSummaries = new Map()
for (const componentId of ['ngas-summer-alpha', 'ngas-winter-alpha']) {
  const componentSummary = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, `data/qore/research/strategy-agent-runs/${componentId}/run-summary.json`),
      'utf8',
    ),
  )
  componentSummaries.set(componentId, componentSummary)
  assert.equal(componentSummary.artifactSchemaVersion, COMPONENT_ARTIFACT_SCHEMA_VERSION)
  assert.equal(componentSummary.contract.execution.contractId, executionContract.contractId)
  assert.equal(componentSummary.contract.execution.contractDigest, executionContract.digest)
  assert.equal(componentSummary.contract.execution.scenarioId, executionContract.selectionScenarioId)
  assert.deepEqual(componentSummary.contract.execution.scenarios, executionContract.scenarios)
  assert.doesNotThrow(() => validateComponentArtifact({
    repoRoot,
    label: `${componentId} checked-in artifact`,
    expectedStrategyId: componentId,
    requiredSchemaVersion: COMPONENT_ARTIFACT_SCHEMA_VERSION,
    summary: componentSummary,
    trades: componentTradeArtifacts.get(componentId),
    executionContract,
  }))
  assert.equal(
    componentSummary.data.selectedTradesArtifact.contentDigestSha256,
    crypto.createHash('sha256').update(componentTradeArtifacts.get(componentId).raw).digest('hex'),
  )
}
const componentContracts = [...componentSummaries.values()].map((componentSummary) => componentSummary.contract)
const expectedAllYearTrainEnd = componentContracts.map((contract) => contract.trainEnd).sort()[0]
const componentHoldoutStarts = componentContracts.map((contract) => contract.holdoutStart).sort()
const expectedSelectionEnd = new Date(
  Date.parse(`${componentHoldoutStarts[0]}T00:00:00Z`) - 86400000,
).toISOString().slice(0, 10)
const expectedAllYearHoldoutStart = componentHoldoutStarts.at(-1)
const expectedAllYearValidationEnd = new Date(
  Date.parse(`${expectedAllYearHoldoutStart}T00:00:00Z`) - 86400000,
).toISOString().slice(0, 10)
assert.equal(summary.contract.trainEnd, expectedAllYearTrainEnd)
assert.equal(summary.contract.selectionEnd, expectedSelectionEnd)
assert.equal(summary.contract.validationEnd, expectedAllYearValidationEnd)
assert.equal(summary.contract.holdoutStart, expectedAllYearHoldoutStart)
for (const [index, row] of rows.entries()) {
  if (index > 0) assert.ok(rows[index - 1].entryTradeDate < row.entryTradeDate, 'all-year ledger must be chronological')
  const expectedSplit = row.entryTradeDate >= summary.contract.holdoutStart
    ? 'holdout'
    : row.entryTradeDate > summary.contract.trainEnd
      ? 'validation'
      : 'train'
  assert.equal(row.split, expectedSplit, `${row.entryTradeDate} must use the calendar-wide all-year split`)
  const componentContract = componentSummaries.get(row.componentStrategyId)?.contract
  assert.ok(componentContract, `${row.entryTradeDate} has an unknown source component`)
  const expectedComponentSplit = row.entryTradeDate >= componentContract.holdoutStart
    ? 'holdout'
    : row.entryTradeDate > componentContract.trainEnd && row.entryTradeDate <= componentContract.validationEnd
      ? 'validation'
      : 'train'
  assert.equal(row.componentSplit, expectedComponentSplit, `${row.entryTradeDate} must retain its source component split`)
}
assert.equal(
  rows.some((row) => row.split === 'holdout' && row.componentSplit !== 'holdout'),
  false,
  'every public holdout row must also be holdout for its source component',
)
assert.equal(
  selectionRows.some((row) => row.componentSplit === 'holdout'),
  false,
  'component holdout rows must not enter all-year promotion inputs',
)
assert.ok(
  rows.some((row, index) => index > 0 && row.priorCloseComponentThesisKinds && row.priorCloseComponentThesisKinds === rows[index - 1].componentThesisKinds),
  'all-year rows must carry pipe-delimited component thesis attribution into the following prior-close row',
)
const summerSummary = componentSummaries.get('ngas-summer-alpha')
assert.equal(
  summary.validation.promotionGates.summerComponent,
  summerSummary.promotion?.eligible === true,
  'all-year Summer promotion must include the component forecast-coverage gate',
)
const summerArtifact = {
  raw: summerTradesRaw,
  headers: summerTrades.meta.fields ?? [],
  rows: summerRows,
}
const validateSummerArtifact = (summaryFixture = summerSummary, tradesFixture = summerArtifact) =>
  validateComponentArtifact({
    repoRoot,
    label: 'NGAS Summer Alpha fixture',
    expectedStrategyId: 'ngas-summer-alpha',
    requiredSchemaVersion: COMPONENT_ARTIFACT_SCHEMA_VERSION,
    summary: summaryFixture,
    trades: tradesFixture,
    executionContract,
  })
assert.doesNotThrow(() => validateSummerArtifact())
assert.equal(
  summerSummary.data.selectedTradesArtifact.schemaVersion,
  COMPONENT_SELECTED_TRADES_BINDING_SCHEMA_VERSION,
)
assert.equal(summerSummary.data.selectedTradesArtifact.rowCount, summerRows.length)
assert.equal(
  summerSummary.data.selectedTradesArtifact.contentDigestSha256,
  crypto.createHash('sha256').update(summerTradesRaw).digest('hex'),
)
assert.throws(
  () => validateSummerArtifact({ ...summerSummary, artifactSchemaVersion: 1 }),
  /artifact schema 1 does not match required schema 3/,
)
assert.throws(
  () => validateSummerArtifact({
    ...summerSummary,
    contract: {
      ...summerSummary.contract,
      execution: { ...summerSummary.contract.execution, contractDigest: 'stale' },
    },
  }),
  /current research execution contract/,
)
assert.throws(
  () => validateSummerArtifact(summerSummary, {
    ...summerArtifact,
    headers: summerArtifact.headers.filter((header) => header !== 'ungPosition'),
  }),
  /selected-trades schema is missing: ungPosition/,
)
assert.throws(
  () => validateSummerArtifact(summerSummary, {
    ...summerArtifact,
    rows: [{ ...summerArtifact.rows[0], strategyId: 'ngas-winter-alpha' }],
  }),
  /selected-trades row .* is stale or malformed/,
)
const summerLinesWithInteriorDeletion = summerTradesRaw.toString('utf8').trimEnd().split('\n')
summerLinesWithInteriorDeletion.splice(101, 1)
const summerRawWithInteriorDeletion = `${summerLinesWithInteriorDeletion.join('\n')}\n`
const summerTradesWithInteriorDeletion = Papa.parse(summerRawWithInteriorDeletion, {
  header: true,
  skipEmptyLines: true,
})
assert.throws(
  () => validateSummerArtifact(summerSummary, {
    raw: Buffer.from(summerRawWithInteriorDeletion),
    headers: summerTradesWithInteriorDeletion.meta.fields ?? [],
    rows: summerTradesWithInteriorDeletion.data,
  }),
  /dates do not exactly match the authoritative .* execution calendar/,
  'removing one component target row must fail before live-target parity can use the ledger',
)
assert.throws(
  () => validateSummerArtifact(summerSummary, {
    ...summerArtifact,
    raw: Buffer.concat([summerTradesRaw, Buffer.from('\n')]),
  }),
  /selected-trades artifact binding does not match its reviewed summary/,
  'changing the selected-trades bytes must invalidate the reviewed digest',
)
for (const row of summerRows) {
  if (!row.storageDate) continue
  const releasedAt = eiaStorageReleaseAt(row.storageDate)
  assert.ok(releasedAt, `Missing EIA release timestamp for Summer storage ${row.storageDate}.`)
  assert.equal(row.storageReleaseAt, releasedAt)
  assert.equal(
    eiaReportAvailableAtOpen(releasedAt, row.entryTradeDate),
    true,
    `Summer EIA release ${releasedAt} was unavailable at the ${row.entryTradeDate} open.`,
  )
}
const summerHolidayBeforeOpen = summerRows.find((row) => row.entryTradeDate === '2023-07-07')
const summerHolidayAfterOpen = summerRows.find((row) => row.entryTradeDate === '2023-07-10')
assert.equal(summerHolidayBeforeOpen?.storageDate, '2023-06-23')
assert.equal(summerHolidayAfterOpen?.storageDate, '2023-06-30')
assert.equal(summerRows.find((row) => row.entryTradeDate === '2024-06-21')?.storageDate, '2024-06-07')
assert.equal(summerRows.find((row) => row.entryTradeDate === '2024-06-24')?.storageDate, '2024-06-14')
for (const row of winterRows) {
  if (row.storageReleaseDate) {
    const releasedAt = eiaStorageReleaseAt(row.storageDate)
    assert.ok(releasedAt, `Missing EIA release timestamp for ${row.storageDate}.`)
    assert.equal(row.storageReleaseDate, releasedAt.slice(0, 10))
    assert.equal(
      eiaReportAvailableAtOpen(releasedAt, row.entryTradeDate),
      true,
      `EIA release ${releasedAt} was unavailable at the ${row.entryTradeDate} open.`,
    )
  }
  if (row.weatherResolutionSource === 'actual') {
    assert.equal(
      nasaPowerActualAvailableAtOpen(row.weatherResolutionIssueDate, row.entryTradeDate),
      true,
      `NASA POWER actual ${row.weatherResolutionIssueDate} was unavailable at the ${row.entryTradeDate} open.`,
    )
  }
}
const eiaReleaseBoundaryRow = winterRows.find((row) => row.entryTradeDate === '2024-01-11')
assert.ok(eiaReleaseBoundaryRow)
assert.equal(eiaReleaseBoundaryRow.storageSeasonDrawdownBcf, '360')
assert.equal(eiaReleaseBoundaryRow.ungPosition, '0')
const eiaHolidayDelayBoundaryRow = winterRows.find((row) => row.entryTradeDate === '2025-01-03')
assert.ok(eiaHolidayDelayBoundaryRow)
assert.equal(eiaHolidayDelayBoundaryRow.storageDate, '2024-12-20')
assert.equal(eiaHolidayDelayBoundaryRow.storageReleaseDate, '2024-12-27')
const nasaLatencyBoundaryRow = winterRows.find((row) => row.entryTradeDate === '2023-12-27')
assert.ok(nasaLatencyBoundaryRow)
assert.notEqual(nasaLatencyBoundaryRow.weatherResolutionSource, 'actual')
assert.ok(rows.length > 0)
assert.equal(displayRows.length, rows.length)
assert.ok(displayRows.every((row) => row.priorCloseThesisKind))
assert.ok(displayRows.every((row) => row.priorCloseReturnContributionPct !== ''))
assert.ok(displayRows.every((row) => row.currentSessionReturnContributionPct !== ''))
for (const row of displayRows) {
  close(
    Number(row.netReturnPct),
    Number(row.priorCloseReturnContributionPct) + Number(row.currentSessionReturnContributionPct),
    0.0002,
    `${row.date} display causal attribution identity`,
  )
}
const causalTransitionRow = displayRows.find((row) => row.date === '2021-02-01')
assert.equal(causalTransitionRow?.priorCloseThesisKind, 'warm-short')
assert.equal(causalTransitionRow?.thesisKind, 'reversion-long')
close(Number(causalTransitionRow?.priorCloseReturnContributionPct), -3.4832697, 0.000001)
close(Number(causalTransitionRow?.currentSessionReturnContributionPct), 0.59743522, 0.000001)
assert.ok(rows.filter((row) => row.thesisKind !== 'index-fallback').every((row) => row.researchInstrument === 'UNG'))
assert.ok(
  rows
    .filter((row) => row.componentStrategyId === 'ngas-summer-alpha' && row.thesisKind !== 'index-fallback')
    .every((row) => row.signalInstrument === 'NG=F'),
)
assert.ok(
  rows
    .filter((row) => row.componentStrategyId === 'ngas-winter-alpha' && row.thesisKind !== 'index-fallback')
    .every((row) => row.signalInstrument === 'UNG'),
)

const executionByDate = new Map(
  loadExecutionCalendar(repoRoot, {
    startDate: rows[0].entryTradeDate,
    endDate: rows.at(-1).entryTradeDate,
  }).map((day) => [day.date, day]),
)

let compounded = 1
let totalTurnover = 0
let gasTurnover = 0
let indexTurnover = 0
for (const row of rows) {
  const number = (key) => Number(row[key] || 0)
  const executionDay = executionByDate.get(row.entryTradeDate)
  assert.ok(executionDay, `missing execution calendar row for ${row.entryTradeDate}`)
  assert.ok(
    Math.abs(number('ungPosition')) + number('investedIndexFraction') <= 1 + 1e-12,
    `${row.entryTradeDate} target weights exceed one`,
  )
  close(number('ungReturnPct'), executionDay.symbols.UNG.closeToCloseReturnPct, 0.00006, `${row.entryTradeDate} UNG close-to-close`)
  close(number('ungOvernightReturnPct'), executionDay.symbols.UNG.overnightReturnPct, 0.00000006, `${row.entryTradeDate} UNG overnight`)
  close(number('ungIntradayReturnPct'), executionDay.symbols.UNG.intradayReturnPct, 0.00000006, `${row.entryTradeDate} UNG intraday`)
  compounded *= 1 + number('netReturnPct') / 100
  totalTurnover += number('totalTurnover')
  gasTurnover += number('gasTurnover')
  indexTurnover += number('indexTurnover')
  close(number('totalTurnover'), number('gasTurnover') + number('vooTurnover') + number('qqqmTurnover'), 0.000003, `${row.entryTradeDate} turnover identity`)
  close(
    number('tradingCostPct'),
    number('gasTradingCostPct') + number('vooTradingCostPct') + number('qqqmTradingCostPct') + number('borrowCostPct'),
    0.0002,
    `${row.entryTradeDate} cost identity`,
  )
  close(number('netReturnPct'), number('grossReturnPct') - number('tradingCostPct'), 0.0002, `${row.entryTradeDate} return identity`)
  close(
    number('netReturnPct'),
    number('priorCloseReturnContributionPct') + number('currentSessionReturnContributionPct'),
    0.0002,
    `${row.entryTradeDate} causal attribution identity`,
  )
  assert.ok(row.priorCloseThesisKind, `${row.entryTradeDate} is missing prior-close thesis attribution`)
}
close((compounded - 1) * 100, summary.selected.allMetrics.totalReturnPct, 0.08, 'artifact compounded return')
close(totalTurnover, summary.selected.allMetrics.turnover, 0.03, 'artifact total turnover')
close(gasTurnover, summary.selected.allMetrics.gasTurnover, 0.03, 'artifact gas turnover')
close(indexTurnover, summary.selected.allMetrics.indexTurnover, 0.03, 'artifact index turnover')

const scenarios = summary.validation.frictionScenarios
assert.ok(scenarios.baseline.metrics.all.cagrPct >= scenarios.elevated.metrics.all.cagrPct)
assert.ok(scenarios.elevated.metrics.all.cagrPct >= scenarios.stress.metrics.all.cagrPct)
assert.equal(scenarios.baseline.selectionEligible, true)
assert.equal(scenarios.elevated.selectionEligible, false)
assert.equal(scenarios.stress.selectionEligible, false)

console.log(
  `research execution passed rows=${rows.length} cagr=${summary.selected.allMetrics.cagrPct}% turnover=${summary.selected.allMetrics.turnover}x`,
)
