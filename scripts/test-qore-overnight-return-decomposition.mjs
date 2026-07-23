#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { summarizeQoreOvernightReturnDecomposition } from './summarize-qore-overnight-return-decomposition.mjs'

const OUTPUT_DIRECTORY = 'data/qore/research/strategy-agent-runs/ngas-all-year-beta'
const SUMMARY_PATH = `${OUTPUT_DIRECTORY}/overnight-return-decomposition.json`
const LEDGER_PATH = `${OUTPUT_DIRECTORY}/overnight-return-decomposition.csv`
const TOLERANCE = 0.00000005
const AGGREGATE_TOLERANCE = 0.000001

function nearlyEqual(actual, expected, tolerance = TOLERANCE, label = 'values') {
  assert.equal(
    Math.abs(actual - expected) <= tolerance,
    true,
    `${label} differ: ${actual} versus ${expected}`,
  )
}

const first = summarizeQoreOvernightReturnDecomposition({
  repoRoot: process.cwd(),
  writeArtifacts: false,
})
const second = summarizeQoreOvernightReturnDecomposition({
  repoRoot: process.cwd(),
  writeArtifacts: false,
})
assert.deepEqual(first, second, 'overnight return decomposition must be deterministic')

assert.equal(first.summary.schemaVersion, 1)
assert.equal(first.summary.researchOnly, true)
assert.equal(first.summary.sessionCount, 1387)
assert.equal(first.summary.startDate, '2021-01-04')
assert.equal(first.summary.endDate, '2026-07-14')
assert.equal(first.summary.aggregates.byRiskSplit.train.sessions, 753)
assert.equal(first.summary.aggregates.byRiskSplit.validation.sessions, 252)
assert.equal(first.summary.aggregates.byRiskSplit.holdout.sessions, 382)
assert.equal(first.summary.aggregates.byRiskSplit.all.sessions, 1387)

for (const row of first.rows) {
  nearlyEqual(
    row.closeToOpenNetContributionPct + row.openToCloseNetContributionPct,
    row.additiveNetReturnPct,
    TOLERANCE,
    `${row.date} additive ledger`,
  )
  nearlyEqual(
    row.ungCloseToOpenNetContributionPct + row.indexCloseToOpenNetContributionPct,
    row.closeToOpenNetContributionPct,
    TOLERANCE,
    `${row.date} close-to-open leg attribution`,
  )
  nearlyEqual(
    row.ungOpenToCloseNetContributionPct + row.indexOpenToCloseNetContributionPct,
    row.openToCloseNetContributionPct,
    TOLERANCE,
    `${row.date} open-to-close leg attribution`,
  )
  nearlyEqual(
    row.ungAdditiveNetContributionPct + row.indexAdditiveNetContributionPct,
    row.additiveNetReturnPct,
    TOLERANCE * 2,
    `${row.date} additive instrument attribution`,
  )
}

assert.equal(first.summary.reconciliation.maxAbsoluteReportedNetResidualPct <= 0.00005, true)
assert.equal(first.summary.reconciliation.maxAbsoluteReportedGrossResidualPct <= 0.00005, true)
assert.equal(first.summary.reconciliation.maxAbsoluteCloseToOpenLegResidualPct <= TOLERANCE, true)
assert.equal(first.summary.reconciliation.maxAbsoluteOpenToCloseLegResidualPct <= TOLERANCE, true)

for (const [split, aggregate] of Object.entries(first.summary.aggregates.byRiskSplit)) {
  nearlyEqual(
    aggregate.ledgerNet.closeToOpenContributionPct + aggregate.ledgerNet.openToCloseContributionPct,
    aggregate.ledgerNet.additiveContributionPct,
    AGGREGATE_TOLERANCE,
    `${split} additive aggregate`,
  )
  nearlyEqual(
    aggregate.netUng.additiveContributionPct + aggregate.netIndex.additiveContributionPct,
    aggregate.ledgerNet.additiveContributionPct,
    AGGREGATE_TOLERANCE,
    `${split} instrument aggregate`,
  )
}

const seasons = first.summary.aggregates.ungOverlayBySeason
const all = first.summary.aggregates.byRiskSplit.all
nearlyEqual(
  seasons.summer.all.grossUngCloseToOpenContributionPct +
    seasons.winter.all.grossUngCloseToOpenContributionPct,
  all.grossUng.closeToOpenContributionPct,
  AGGREGATE_TOLERANCE,
  'seasonal close-to-open UNG attribution',
)
nearlyEqual(
  seasons.summer.all.grossUngOpenToCloseContributionPctOnOpenEquity +
    seasons.winter.all.grossUngOpenToCloseContributionPctOnOpenEquity,
  all.grossUng.openToCloseContributionPctOnOpenEquity,
  AGGREGATE_TOLERANCE,
  'seasonal open-to-close UNG attribution',
)
assert.equal(
  seasons.summer.all.currentSessionActiveSessions + seasons.winter.all.currentSessionActiveSessions,
  all.activeOverlay.currentSessionSessions,
)
assert.equal(
  seasons.summer.all.priorCloseActiveSessions + seasons.winter.all.priorCloseActiveSessions,
  all.activeOverlay.priorCloseSessions,
)

assert.deepEqual(first.summary.regimeDiagnostic, {
  preHoldoutGrossUngCloseToOpenContributionPct: 4.56811091,
  holdoutGrossUngCloseToOpenContributionPct: 27.1024704,
  grossUngCloseToOpenSignReversed: false,
})
assert.equal(first.summary.decision.deploymentPolicyId, 'carry-100')
assert.equal(first.summary.decision.promotionEligible, false)
assert.equal(
  first.summary.decision.selectedChallengerPolicyId,
  'gap-ma10-threshold2p25-cash-flat',
)
assert.deepEqual(first.summary.decision.selectedChallengerHoldoutComparisons, {
  sharpe: false,
  maxDrawdown: false,
  cagr: false,
})
assert.equal(first.summary.decision.selectedChallengerFailsAllHoldoutGates, true)

const fixedRetention = first.summary.fixedRetentionComparison
assert.equal(fixedRetention.scenarioId, 'baseline')
assert.equal(fixedRetention.allCagrStrictlyDeclinesAsRetentionFalls, true)
assert.deepEqual(
  fixedRetention.policies.map((policy) => policy.policyId),
  ['carry-100', 'cash-retain-75', 'cash-retain-50', 'cash-retain-25', 'cash-retain-0'],
)
assert.deepEqual(
  fixedRetention.policies.map((policy) => policy.metrics.all.cagrPct),
  [28.12676615, 26.29285138, 24.37641023, 22.3963568, 20.37296575],
)

for (const binding of [
  first.summary.inputBindings.selectedTrades,
  first.summary.inputBindings.overnightRiskSummary,
  first.summary.inputBindings.overnightRiskCandidateSummary,
  first.summary.inputBindings.allYearRunSummary,
  first.summary.inputBindings.overnightRiskPolicyConfig,
  first.summary.inputBindings.researchExecutionConfig,
  first.summary.inputBindings.marketData.UNG,
  first.summary.inputBindings.marketData.VOO,
  first.summary.inputBindings.marketData.QQQM,
  first.summary.inputBindings.generator,
]) {
  assert.match(binding.sha256, /^[a-f0-9]{64}$/)
}
assert.equal(
  first.summary.artifacts.ledger.sha256,
  crypto.createHash('sha256').update(first.ledgerText).digest('hex'),
)

const onDiskSummary = JSON.parse(fs.readFileSync(path.join(process.cwd(), SUMMARY_PATH), 'utf8'))
const onDiskLedger = fs.readFileSync(path.join(process.cwd(), LEDGER_PATH), 'utf8')
assert.deepEqual(onDiskSummary, first.summary, 'checked-in decomposition JSON must match a fresh replay')
assert.equal(onDiskLedger, first.ledgerText, 'checked-in decomposition CSV must match a fresh replay')

console.log([
  'overnight-return-decomposition tests passed',
  `sessions=${first.summary.sessionCount}`,
  `ungCloseToOpen=${all.grossUng.closeToOpenContributionPct}%`,
  `ungOpenToClose=${all.grossUng.openToCloseContributionPctOnOpenEquity}%`,
  `preHoldoutUngCloseToOpen=${first.summary.regimeDiagnostic.preHoldoutGrossUngCloseToOpenContributionPct}%`,
  `holdoutUngCloseToOpen=${first.summary.regimeDiagnostic.holdoutGrossUngCloseToOpenContributionPct}%`,
  `deployed=${first.summary.decision.deploymentPolicyId}`,
].join(' '))
