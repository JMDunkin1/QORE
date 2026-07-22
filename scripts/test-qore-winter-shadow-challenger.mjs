#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { evaluateWinterShadow } from './evaluate-qore-winter-shadow.mjs'
import {
  executableLiveComponentContract,
  executableLiveComponentContractDigestSha256,
  selectedContracts,
} from './lib/qore-live-contract.mjs'
import {
  WINTER_SHADOW_CANDIDATE_FAMILY,
  WINTER_SHADOW_CANDIDATE_FAMILY_DIGEST_SHA256,
  WINTER_SHADOW_CHALLENGER,
  WINTER_SHADOW_CHALLENGER_CANDIDATE_ID,
  WINTER_SHADOW_CHALLENGER_DIGEST_SHA256,
  WINTER_SHADOW_COMPARATOR_CANDIDATE_ID,
  WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256,
  validateWinterShadowChallenger,
  winterShadowCompatibilityFailures,
  winterShadowValueDigestSha256,
} from './lib/qore-winter-shadow-challenger.mjs'

function fileDigest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

const repoDir = process.cwd()
const protectedFiles = [
  'scripts/lib/qore-live-all-year-inference.mjs',
  'data/qore/research/strategy-agent-runs/ngas-winter-alpha/run-summary.json',
  'data/qore/research/strategy-agent-runs/ngas-winter-alpha/selected-trades.csv',
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json',
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv',
].map((file) => path.join(repoDir, file))
const protectedDigestsBefore = protectedFiles.map(fileDigest)
const activeContractBefore = structuredClone(executableLiveComponentContract)
const activeFollowBefore = structuredClone(selectedContracts.winterFollow)

assert.equal(validateWinterShadowChallenger(), true)
assert.equal(WINTER_SHADOW_CHALLENGER.executionEligible, false)
assert.equal(WINTER_SHADOW_CHALLENGER.publicStrategy, false)
assert.equal(WINTER_SHADOW_CHALLENGER.role, 'historical-research-shadow')
assert.equal(
  winterShadowValueDigestSha256(WINTER_SHADOW_CHALLENGER),
  WINTER_SHADOW_CHALLENGER_DIGEST_SHA256,
)
assert.equal(
  winterShadowValueDigestSha256(WINTER_SHADOW_CANDIDATE_FAMILY),
  WINTER_SHADOW_CANDIDATE_FAMILY_DIGEST_SHA256,
)
assert.equal(
  winterShadowValueDigestSha256(executableLiveComponentContract.winter),
  WINTER_SHADOW_COMPARATOR_COMPONENT_CONTRACT_DIGEST_SHA256,
)
assert.equal(WINTER_SHADOW_CANDIDATE_FAMILY.length, 6)
assert.equal(new Set(WINTER_SHADOW_CANDIDATE_FAMILY.map((row) => row.candidateId)).size, 6)

const comparator = WINTER_SHADOW_CANDIDATE_FAMILY.find(
  (candidate) => candidate.candidateId === WINTER_SHADOW_COMPARATOR_CANDIDATE_ID,
)
const challenger = WINTER_SHADOW_CANDIDATE_FAMILY.find(
  (candidate) => candidate.candidateId === WINTER_SHADOW_CHALLENGER_CANDIDATE_ID,
)
assert.deepEqual(comparator.signalSourceIds, selectedContracts.winterFollow.sourceIds)
assert.deepEqual(
  comparator.heatingDemandSourceIds,
  selectedContracts.winterFollow.liveHeatingDemandSourceIds,
)
assert.equal(comparator.sourceWeightMode, 'bg-shrink')
assert.deepEqual(challenger.signalSourceIds, ['gfs', 'gefs-mean'])
assert.deepEqual(challenger.heatingDemandSourceIds, ['gfs', 'gefs-mean'])
assert.equal(challenger.sourceWeightMode, 'equal')
assert.throws(() => { challenger.sourceWeightMode = 'bg-shrink' }, TypeError)
assert.match(
  winterShadowCompatibilityFailures({
    activeComponentContract: {
      ...executableLiveComponentContract.winter,
      selected: {
        ...executableLiveComponentContract.winter.selected,
        overlayRiskMultiplier: 9,
      },
    },
  }).join('; '),
  /does not match the frozen shadow comparator/,
)

const report = evaluateWinterShadow({
  bootstrapIterations: 100,
  episodeBootstrapIterations: 100,
})
assert.equal(report.executionEligible, false)
assert.equal(report.selectedArtifactsChanged, false)
assert.equal(report.activeInferenceChanged, false)
assert.equal(report.historicalEvidenceStatus, 'development-contaminated')
assert.equal(report.decision.promotionEligible, false)
assert.equal(report.decision.brokerEligible, false)
assert.equal(report.decision.activeContractUnchanged, true)
assert.equal(report.decision.postTrainIncrementalPositive, false)
assert.equal(report.inputs.weatherTemperatureQuality.quarantinedGroupCount, 2)
assert.equal(report.candidateResults.length, WINTER_SHADOW_CANDIDATE_FAMILY.length)
assert.equal(report.focusedChallenger.candidateId, WINTER_SHADOW_CHALLENGER_CANDIDATE_ID)
assert.equal(report.focusedChallenger.executionEligible, false)
assert.deepEqual(report.focusedChallenger.signalSourceIds, ['gfs', 'gefs-mean'])
assert.deepEqual(report.focusedChallenger.heatingDemandSourceIds, ['gfs', 'gefs-mean'])
assert.equal(report.focusedChallenger.sourceWeightMode, 'equal')
assert.ok(report.focusedChallenger.incrementalVsComparatorBySplit.train.incrementalDailySumPct > 0)
assert.ok(report.focusedChallenger.incrementalVsComparatorBySplit.validation.incrementalDailySumPct < 0)
assert.ok(report.focusedChallenger.incrementalVsComparatorBySplit.postTrain.incrementalDailySumPct < 0)
assert.ok(report.focusedChallenger.robustness.postTrain.episodeCount > 0)
assert.ok(
  report.focusedChallenger.robustness.postTrain.episodeBootstrapProbabilityNonPositive >= 0.5,
)
assert.deepEqual(executableLiveComponentContract, activeContractBefore)
assert.deepEqual(selectedContracts.winterFollow, activeFollowBefore)
assert.equal(
  winterShadowValueDigestSha256(executableLiveComponentContract),
  executableLiveComponentContractDigestSha256,
)
assert.deepEqual(protectedFiles.map(fileDigest), protectedDigestsBefore)

const packageJson = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'))
assert.equal(
  packageJson.scripts['research:winter-shadow'],
  'node scripts/evaluate-qore-winter-shadow.mjs',
)

console.log(
  `winter shadow challenger passed digest=${WINTER_SHADOW_CHALLENGER_DIGEST_SHA256} trainIncrement=${report.focusedChallenger.incrementalVsComparatorBySplit.train.incrementalDailySumPct} postTrainIncrement=${report.focusedChallenger.incrementalVsComparatorBySplit.postTrain.incrementalDailySumPct}`,
)
