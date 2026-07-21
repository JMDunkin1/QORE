#!/usr/bin/env node
import assert from 'node:assert/strict'
import process from 'node:process'
import { evaluateOvernightRiskPolicies } from './evaluate-qore-overnight-risk-policies.mjs'

const first = evaluateOvernightRiskPolicies({ repoRoot: process.cwd(), writeArtifacts: false })
const second = evaluateOvernightRiskPolicies({ repoRoot: process.cwd(), writeArtifacts: false })

assert.deepEqual(first, second, 'overnight policy evaluation must be deterministic')
assert.equal(first.summary.candidateCount, 50)
assert.deepEqual(first.summary.scenarioIds, ['baseline', 'elevated', 'stress'])
assert.equal(first.summary.selectionUsedHoldout, false)
assert.equal(first.summary.selectedChallenger.policyId, 'gap-ma10-threshold2p25-cash-flat')
assert.equal(first.summary.selectedChallenger.selectionRank, 1)
assert.equal(typeof first.summary.selectedChallenger.selectionScore, 'number')
assert.equal(first.summary.holdoutComparison.reportingOnly, true)
assert.equal(first.summary.holdoutComparison.meetsAllReferenceThresholds, false)
assert.deepEqual(first.summary.holdoutComparison.comparisons, {
  sharpe: false,
  maxDrawdown: false,
  cagr: false,
})
assert.equal(first.summary.promotionRecommendationPolicyId, first.summary.selectedChallenger.policyId)
assert.equal(first.summary.recommendationBasis, 'train-validation-only')
assert.equal(first.summary.deployedPolicyId, 'carry-100')
assert.equal(first.summary.deploymentMatchesRecommendation, false)

const carry = first.summary.carryPolicy.scenarios
const challenger = first.summary.selectedChallenger.scenarioMetrics
assert.equal(carry.baseline.all.totalReturnPct, 293.56047441)
assert.equal(carry.baseline.all.cagrPct, 28.15870541)
assert.equal(carry.baseline.all.maxDrawdownPct, -28.32421136)
assert.equal(challenger.baseline.preHoldout.closeGasTurnover > 0, true)
assert.equal(challenger.baseline.preHoldout.openGasTurnover > carry.baseline.preHoldout.openGasTurnover, true)
assert.equal(challenger.baseline.preHoldout.tradingCostPct > carry.baseline.preHoldout.tradingCostPct, true)
assert.equal(challenger.elevated.all.tradingCostPct > challenger.baseline.all.tradingCostPct, true)
assert.equal(challenger.stress.all.tradingCostPct > challenger.elevated.all.tradingCostPct, true)

assert.equal(first.candidateRows.length, 150)
assert.equal(first.candidateRows.every((row) => row.selectionUsedHoldout === false), true)
assert.equal(
  first.candidateRows.some((row) => row.policyId === 'cash-retain-0' && row.scenarioId === 'baseline'),
  true,
)
assert.equal(
  first.candidateRows.some((row) => row.policyId === 'flatten-long-overnight' && row.scenarioId === 'baseline'),
  true,
)
assert.equal(
  first.candidateRows.some((row) => row.policyId === 'flatten-short-overnight' && row.scenarioId === 'baseline'),
  true,
)
assert.equal(
  first.candidateRows.some((row) => row.policyId === 'flatten-weekend-overnight' && row.scenarioId === 'baseline'),
  true,
)

console.log(
  [
    'overnight-risk-policy tests passed',
    `challenger=${first.summary.selectedChallenger.policyId}`,
    `score=${first.summary.selectedChallenger.selectionScore}`,
    `holdoutComparison=${first.summary.holdoutComparison.meetsAllReferenceThresholds ? 'meets-reference' : 'below-reference'}`,
    `recommendation=${first.summary.promotionRecommendationPolicyId}`,
    `deployed=${first.summary.deployedPolicyId}`,
  ].join(' '),
)
