#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadReviewedBrokerExecutionProfile } from './lib/qore-broker-execution-profile.mjs'
import { resolveAllYearStrategyArtifactPath } from './lib/qore-live-strategy-artifact.mjs'
import {
  DEFAULT_FORWARD_OUTCOME_POLICY,
  buildForwardSettlementRecords,
  forwardComponentSeasonLabel,
  forwardInferenceDigestSha256,
  forwardMarketSessionDigestSha256,
  forwardObservationIdSha256,
  forwardSettlementDigestSha256,
  paperBrokerRecordDigestSha256,
  reviewedNyseSessionCloseMinute,
  reviewedNyseSessionDates,
  reviewedNyseSessionStatus,
  verifyValidationEvidenceArtifacts,
} from './lib/qore-validation-evidence.mjs'
import { writeValidationEvidenceTestFixtures } from './lib/qore-validation-evidence-test-fixture.mjs'
import { loadResearchExecutionContract } from './lib/qore-research-execution.mjs'
import {
  ALL_YEAR_SELECTION_CONTRACT,
  FORWARD_VALIDATION_APPEND_ONLY_INPUT_CONTRACTS,
  FORWARD_VALIDATION_IMPLEMENTATION_INPUT_PATHS,
  FORWARD_VALIDATION_IMPLEMENTATION_SOURCE_PATHS,
  VALIDATION_CANDIDATE_REGISTRY_ID,
  VALIDATION_CANDIDATE_REGISTRY_SCHEMA_VERSION,
  VALIDATION_CANDIDATE_SELECTION_POLICY,
  VALIDATION_INTEGRITY_MANIFEST_ID,
  VALIDATION_INTEGRITY_SCHEMA_VERSION,
  VALIDATION_INTEGRITY_STRATEGY_ID,
  allYearStrategyArtifactCoreDigestSha256,
  allYearStrategyContractDigestSha256,
  appendOnlyForwardInputFailures,
  forwardValidationImplementationDigestSha256,
  loadValidationIntegrityManifest,
  paperExecutionEvidenceSatisfied,
  reviewedForwardValidationImplementation,
  resolveValidationIntegrityManifestPath,
  validationIntegrityBinding,
  validationCandidateRegistryDigestSha256,
  validationPreregistrationDigestSha256,
  validateValidationIntegrityManifest,
} from './lib/qore-validation-integrity.mjs'

process.env.NODE_ENV = 'test'
process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES = '1'

const strategyArtifactCoreFixture = {
  artifactSchemaVersion: 6,
  generatedAt: '2026-07-21T10:00:00.000Z',
  strategyId: 'ngas-all-year-beta',
  displayName: 'Natural Gas All-Year Beta',
  status: 'needs-validation',
  data: {
    summerSelectedTrades: 'summer-trades.csv',
    winterSelectedTrades: 'winter-trades.csv',
    marketEndDate: '2026-07-14',
    selectedTradesArtifact: { contentDigestSha256: '4'.repeat(64), rowCount: 1400 },
    displayCurveArtifact: { contentDigestSha256: '5'.repeat(64), rowCount: 1400 },
  },
  contract: {
    allYearSelection: ALL_YEAR_SELECTION_CONTRACT,
    forwardOutcomePolicy: {
      schemaVersion: 1,
      policyId: 'matched-fallback-forward-outcomes-v1',
      policyDigestSha256: '8'.repeat(64),
    },
    selectionEnd: '2023-09-30',
    liveInference: { componentContract: { summer: { selected: { weatherFraction: 0.35 } } } },
  },
  selected: {
    candidateId: 'ngas-all-year-beta',
    validationMetrics: { totalReturnPct: 12.5 },
  },
  search: {
    candidateCount: 1,
    eligibleCandidateCount: 0,
    selectionStatus: 'fixed-composite-retained-needs-validation',
    selectionUsedHoldout: false,
    paperEligible: false,
    liveEligible: false,
  },
  validation: {
    integrity: {
      manifestDigestSha256: '1'.repeat(64),
      sealedStrategyArtifactDigestSha256: null,
      pristineForwardEvidence: false,
    },
    eligibility: { paperEligible: false, liveEligible: false, promotionEligible: false },
    selectionRealityCheck: { pValue: 0.04 },
    liveTargetParity: { status: 'pass', mismatchCount: 0 },
    promotionGates: {
      positiveValidationEdge: true,
      liveTargetParity: true,
      pristineForwardEvidence: false,
      strategyContractSeal: false,
      paperApproval: false,
      paperExecutionEvidence: false,
      liveApproval: false,
    },
  },
  outputFiles: { selectedTrades: 'selected-trades.csv', displayCurve: 'display-curve.csv' },
  candidates: [{ candidateId: 'ngas-all-year-beta', eligible: false, validationEdgePct: 2.5 }],
}

const unsealedCoreDigestSha256 = allYearStrategyArtifactCoreDigestSha256(strategyArtifactCoreFixture)
const sealedContractDigestFixture = allYearStrategyContractDigestSha256(strategyArtifactCoreFixture)
const changedPolicyContractFixture = structuredClone(strategyArtifactCoreFixture)
changedPolicyContractFixture.contract.forwardOutcomePolicy.policyDigestSha256 = '9'.repeat(64)
assert.notEqual(
  allYearStrategyContractDigestSha256(changedPolicyContractFixture),
  sealedContractDigestFixture,
  'changing the forward outcome policy must invalidate the strategy contract seal',
)
const sealedStrategyArtifactCoreFixture = structuredClone(strategyArtifactCoreFixture)
sealedStrategyArtifactCoreFixture.generatedAt = '2026-07-22T10:00:00.000Z'
sealedStrategyArtifactCoreFixture.status = 'research-baseline'
sealedStrategyArtifactCoreFixture.search.eligibleCandidateCount = 1
sealedStrategyArtifactCoreFixture.search.selectionStatus = 'fixed-composite-passes-promotion-gates'
sealedStrategyArtifactCoreFixture.search.paperEligible = true
sealedStrategyArtifactCoreFixture.search.liveEligible = true
sealedStrategyArtifactCoreFixture.validation.integrity = {
  manifestDigestSha256: '2'.repeat(64),
  sealedStrategyArtifactDigestSha256: unsealedCoreDigestSha256,
  pristineForwardEvidence: true,
  forwardEvidenceArtifactDigestSha256: '3'.repeat(64),
}
sealedStrategyArtifactCoreFixture.validation.eligibility = {
  paperEligible: true,
  liveEligible: true,
  promotionEligible: true,
}
for (const gate of [
  'pristineForwardEvidence',
  'strategyContractSeal',
  'paperApproval',
  'paperExecutionEvidence',
  'liveApproval',
]) sealedStrategyArtifactCoreFixture.validation.promotionGates[gate] = true
sealedStrategyArtifactCoreFixture.candidates[0].eligible = true

assert.notEqual(
  crypto.createHash('sha256').update(JSON.stringify(strategyArtifactCoreFixture)).digest('hex'),
  crypto.createHash('sha256').update(JSON.stringify(sealedStrategyArtifactCoreFixture)).digest('hex'),
  'embedding a seal and approval state must still change the raw artifact digest',
)
assert.equal(
  allYearStrategyArtifactCoreDigestSha256(sealedStrategyArtifactCoreFixture),
  unsealedCoreDigestSha256,
  'embedding the core seal and approval state must be a digest fixed point',
)
for (const mutate of [
  (artifact) => { artifact.contract.selectionEnd = '2023-10-31' },
  (artifact) => { artifact.selected.validationMetrics.totalReturnPct = 13.5 },
  (artifact) => { artifact.validation.promotionGates.positiveValidationEdge = false },
  (artifact) => { artifact.candidates[0].validationEdgePct = 3.5 },
  (artifact) => { artifact.data.selectedTradesArtifact.contentDigestSha256 = '6'.repeat(64) },
  (artifact) => { artifact.data.displayCurveArtifact.contentDigestSha256 = '7'.repeat(64) },
]) {
  const mutated = structuredClone(sealedStrategyArtifactCoreFixture)
  mutate(mutated)
  assert.notEqual(
    allYearStrategyArtifactCoreDigestSha256(mutated),
    unsealedCoreDigestSha256,
    'strategy and research-result mutations must invalidate the core seal',
  )
}

const sealedDigest = 'a'.repeat(64)
const strategyArtifactDigestSha256 = 'b'.repeat(64)
const brokerExecutionProfileDigestSha256 = loadReviewedBrokerExecutionProfile(process.cwd()).profileDigestSha256
const fixtureDir = await mkdtemp(path.join(tmpdir(), 'qore-validation-integrity-test-'))
const fixtureManifestPath = path.join(fixtureDir, 'reviewed-validation-integrity.json')
const accountPseudonymSha256 = 'c'.repeat(64)
let evidenceFixtures

async function writeProtectedArtifact(filePath, artifact) {
  const raw = `${JSON.stringify(artifact, null, 2)}\n`
  await writeFile(filePath, raw, { mode: 0o600 })
  await chmod(filePath, 0o600)
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function emptyManifest() {
  const manifest = {
    schemaVersion: VALIDATION_INTEGRITY_SCHEMA_VERSION,
    manifestId: VALIDATION_INTEGRITY_MANIFEST_ID,
    strategyId: VALIDATION_INTEGRITY_STRATEGY_ID,
    sealedAt: '2026-07-20T20:00:00.000Z',
    reviewedAt: '2026-07-21T00:00:00.000Z',
    sealedStrategyContractDigestSha256: sealedDigest,
    sealedStrategyArtifactDigestSha256: strategyArtifactDigestSha256,
    sealedBrokerExecutionProfileDigestSha256: brokerExecutionProfileDigestSha256,
    historicalEvidence: {
      status: 'development-contaminated',
      evidenceStart: '2021-01-01',
      developmentBegan: '2026-06-11',
      observedThrough: '2026-07-14',
      prospectiveStart: '2026-07-22',
      pristineForwardEvidence: false,
    },
    forwardOutcomePolicy: structuredClone(DEFAULT_FORWARD_OUTCOME_POLICY),
    forwardValidationImplementation: reviewedForwardValidationImplementation(process.cwd()),
    minimumForwardEvidence: {
      independentEpisodes: 60,
      completeSummerSeasons: 2,
      completeWinterSeasons: 2,
    },
    observedForwardEvidence: {
      independentEpisodes: 0,
      completeSummerSeasons: 0,
      completeWinterSeasons: 0,
      observedThrough: null,
      strategyContractDigestSha256: null,
      strategyArtifactDigestSha256: null,
      outcomePolicyDigestSha256: null,
      preregistrationDigestSha256: null,
      sealedAt: null,
      evidenceArtifactDigestSha256: null,
      reviewedAt: null,
    },
    minimumPaperExecutionEvidence: {
      tradingSessions: 60,
      filledOrders: 10,
      ungFilledOrders: 4,
      ungLongFilledOrders: 2,
      ungShortFilledOrders: 2,
      minimumFilledOrderRatio: 0.8,
      maximumMedianAbsoluteSlippageBps: 25,
      maximumP95AbsoluteSlippageBps: 50,
    },
    paperExecutionEvidence: {
      status: 'absent',
      strategyContractDigestSha256: null,
      brokerExecutionProfileDigestSha256: null,
      accountPseudonymSha256: null,
      periodStart: null,
      periodEnd: null,
      tradingSessions: 0,
      submittedOrders: 0,
      filledOrders: 0,
      filledOrderRatio: null,
      ungFilledOrders: 0,
      ungLongFilledOrders: 0,
      ungShortFilledOrders: 0,
      medianAbsoluteSlippageBps: null,
      p95AbsoluteSlippageBps: null,
      ungMedianAbsoluteSlippageBps: null,
      ungP95AbsoluteSlippageBps: null,
      evidenceArtifactDigestSha256: null,
      reviewedAt: null,
    },
    approvals: {
      paper: {
        status: 'absent',
        approvalId: null,
        approvedAt: null,
        strategyContractDigestSha256: null,
        brokerExecutionProfileDigestSha256: null,
      },
      live: {
        status: 'absent',
        approvalId: null,
        approvedAt: null,
        strategyContractDigestSha256: null,
        brokerExecutionProfileDigestSha256: null,
      },
    },
  }
  return sealPreregistration(manifest)
}

function sealPreregistration(manifest) {
  manifest.candidateRegistry = {
    schemaVersion: VALIDATION_CANDIDATE_REGISTRY_SCHEMA_VERSION,
    registryId: VALIDATION_CANDIDATE_REGISTRY_ID,
    familySize: 1,
    selectionPolicy: VALIDATION_CANDIDATE_SELECTION_POLICY,
    candidates: [{
      candidateId: manifest.strategyId,
      strategyContractDigestSha256: manifest.sealedStrategyContractDigestSha256,
      strategyArtifactCoreDigestSha256: manifest.sealedStrategyArtifactDigestSha256,
    }],
    registryDigestSha256: null,
  }
  manifest.candidateRegistry.registryDigestSha256 =
    validationCandidateRegistryDigestSha256(manifest.candidateRegistry)
  manifest.preregistrationDigestSha256 = validationPreregistrationDigestSha256(manifest)
  return manifest
}

function promotionPreregisteredManifest() {
  const manifest = emptyManifest()
  manifest.reviewedAt = '2025-10-02T00:00:00.000Z'
  manifest.sealedAt = '2019-12-31T12:00:00.000Z'
  manifest.historicalEvidence = {
    ...manifest.historicalEvidence,
    evidenceStart: '2017-01-01',
    developmentBegan: '2019-06-11',
    observedThrough: '2019-12-15',
    prospectiveStart: '2020-01-03',
  }
  return sealPreregistration(manifest)
}

function promotionReadyManifest() {
  const manifest = promotionPreregisteredManifest()
  manifest.historicalEvidence.pristineForwardEvidence = true
  manifest.observedForwardEvidence = {
    ...evidenceFixtures.forwardSummary,
    evidenceArtifactDigestSha256: evidenceFixtures.forwardEvidenceArtifactDigestSha256,
    reviewedAt: '2025-10-01T04:30:00.000Z',
  }
  manifest.paperExecutionEvidence = {
    status: 'reviewed',
    ...evidenceFixtures.paperSummary,
    evidenceArtifactDigestSha256: evidenceFixtures.paperEvidenceArtifactDigestSha256,
    reviewedAt: '2025-10-01T01:00:00.000Z',
  }
  manifest.approvals = {
    paper: {
      status: 'approved',
      approvalId: 'paper-test',
      approvedAt: '2022-12-31T12:00:00.000Z',
      strategyContractDigestSha256: sealedDigest,
      brokerExecutionProfileDigestSha256,
    },
    live: {
      status: 'approved',
      approvalId: 'live-test',
      approvedAt: '2025-10-02T00:00:00.000Z',
      strategyContractDigestSha256: sealedDigest,
      brokerExecutionProfileDigestSha256,
    },
  }
  return manifest
}

function removeLiveApproval(manifest) {
  manifest.approvals.live = {
    status: 'absent',
    approvalId: null,
    approvedAt: null,
    strategyContractDigestSha256: null,
    brokerExecutionProfileDigestSha256: null,
  }
  return manifest
}

const fixturePreregistration = promotionPreregisteredManifest()
evidenceFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: fixtureManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactCoreDigestSha256: strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256: fixturePreregistration.preregistrationDigestSha256,
  sealedAt: fixturePreregistration.sealedAt,
  submittedOrderCount: 12,
})

const empty = emptyManifest()
assert.deepEqual(validateValidationIntegrityManifest(empty), [])
assert.deepEqual(
  empty.forwardValidationImplementation.sourceFiles.map((row) => row.path),
  [...FORWARD_VALIDATION_IMPLEMENTATION_SOURCE_PATHS],
)
assert.deepEqual(
  empty.forwardValidationImplementation.inputFiles.map((row) => row.path),
  [...FORWARD_VALIDATION_IMPLEMENTATION_INPUT_PATHS],
)
assert.deepEqual(
  empty.forwardValidationImplementation.appendOnlyInputs.map((row) => row.path),
  FORWARD_VALIDATION_APPEND_ONLY_INPUT_CONTRACTS.map((row) => row.path),
)
assert.equal(paperExecutionEvidenceSatisfied(empty), false)
assert.deepEqual(
  reviewedNyseSessionStatus('2025-01-09'),
  { session: false, reason: 'nyse-full-day-closure' },
)
assert.equal(forwardComponentSeasonLabel('ngas-winter-alpha', '2027-03-31'), 'winter-2026-2027')
assert.equal(forwardComponentSeasonLabel('ngas-winter-alpha', '2027-04-20'), 'winter-2026-2027')
assert.equal(reviewedNyseSessionCloseMinute('2023-11-24'), 13 * 60)
assert.equal(reviewedNyseSessionCloseMinute('2023-11-27'), 16 * 60)

const ready = promotionReadyManifest()
assert.deepEqual(validateValidationIntegrityManifest(ready), [])
const evidenceVerification = verifyValidationEvidenceArtifacts(process.cwd(), fixtureManifestPath, ready)
assert.deepEqual(evidenceVerification.failures, [])
assert.equal(evidenceVerification.forward.summary.outcomeGatesSatisfied, true)
assert.equal(evidenceVerification.forward.summary.outcomeSummary.materialEpisodes, 60)
assert.equal(evidenceVerification.forward.summary.outcomeSummary.gates.minimumComponentEpisodes, true)
assert.equal(paperExecutionEvidenceSatisfied(ready), false, 'manifest claims alone must not satisfy paper evidence')
assert.equal(paperExecutionEvidenceSatisfied(ready, evidenceVerification), true)
assert.equal(
  Object.hasOwn(
    validationIntegrityBinding(ready, 'f'.repeat(64), evidenceVerification),
    'paperExecutionAccountPseudonymSha256',
  ),
  false,
  'browser-bound research integrity must not expose the stable paper account pseudonym',
)

const driftedExecutionContract = structuredClone(loadResearchExecutionContract(process.cwd()))
driftedExecutionContract.digest = 'd'.repeat(64)
assert.throws(() => buildForwardSettlementRecords({
  observations: evidenceFixtures.forwardArtifact.observations,
  marketSessions: evidenceFixtures.forwardArtifact.settlements.map(({ marketSession }) => marketSession),
  outcomePolicy: DEFAULT_FORWARD_OUTCOME_POLICY,
  executionContract: driftedExecutionContract,
  settledAtBySessionDate: (sessionDate) => `${sessionDate}T22:00:00.000Z`,
}), /research execution contract digest/)

const zeroGasManifestPath = path.join(fixtureDir, 'zero-gas', 'reviewed-validation-integrity.json')
const zeroGasFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: zeroGasManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactCoreDigestSha256: strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256: fixturePreregistration.preregistrationDigestSha256,
  sealedAt: fixturePreregistration.sealedAt,
  submittedOrderCount: 12,
  materialGasPosition: 0,
})
const zeroGasManifest = promotionReadyManifest()
zeroGasManifest.historicalEvidence.pristineForwardEvidence = false
zeroGasManifest.observedForwardEvidence = {
  ...zeroGasFixtures.forwardSummary,
  evidenceArtifactDigestSha256: zeroGasFixtures.forwardEvidenceArtifactDigestSha256,
  reviewedAt: '2025-10-01T04:30:00.000Z',
}
zeroGasManifest.paperExecutionEvidence = {
  ...zeroGasManifest.paperExecutionEvidence,
  evidenceArtifactDigestSha256: zeroGasFixtures.paperEvidenceArtifactDigestSha256,
}
zeroGasManifest.approvals.live = {
  status: 'absent',
  approvalId: null,
  approvedAt: null,
  strategyContractDigestSha256: null,
  brokerExecutionProfileDigestSha256: null,
}
assert.deepEqual(validateValidationIntegrityManifest(zeroGasManifest), [])
const zeroGasVerification = verifyValidationEvidenceArtifacts(process.cwd(), zeroGasManifestPath, zeroGasManifest)
assert.deepEqual(zeroGasVerification.failures, [])
assert.equal(zeroGasVerification.forward.summary.independentEpisodes, 0)
assert.equal(zeroGasVerification.forward.summary.outcomeSummary.materialEpisodes, 0)
assert.equal(zeroGasVerification.forward.summary.outcomeGatesSatisfied, false)

const negativeAlphaManifestPath = path.join(fixtureDir, 'negative-alpha', 'reviewed-validation-integrity.json')
const negativeAlphaFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: negativeAlphaManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactCoreDigestSha256: strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256: fixturePreregistration.preregistrationDigestSha256,
  sealedAt: fixturePreregistration.sealedAt,
  submittedOrderCount: 12,
  materialUngIntradayReturnPct: -1,
})
const negativeAlphaManifest = promotionReadyManifest()
negativeAlphaManifest.observedForwardEvidence = {
  ...negativeAlphaFixtures.forwardSummary,
  evidenceArtifactDigestSha256: negativeAlphaFixtures.forwardEvidenceArtifactDigestSha256,
  reviewedAt: '2025-10-01T04:30:00.000Z',
}
negativeAlphaManifest.paperExecutionEvidence = {
  ...negativeAlphaManifest.paperExecutionEvidence,
  evidenceArtifactDigestSha256: negativeAlphaFixtures.paperEvidenceArtifactDigestSha256,
}
assert.deepEqual(validateValidationIntegrityManifest(negativeAlphaManifest), [])
const negativeAlphaVerification = verifyValidationEvidenceArtifacts(
  process.cwd(),
  negativeAlphaManifestPath,
  negativeAlphaManifest,
)
assert.deepEqual(negativeAlphaVerification.failures, [])
assert.equal(negativeAlphaVerification.forward.summary.independentEpisodes, 60)
assert.equal(negativeAlphaVerification.forward.summary.outcomeSummary.gates.bootstrapEfficacy, false)
assert.equal(negativeAlphaVerification.forward.summary.outcomeGatesSatisfied, false)
assert.equal(
  validationIntegrityBinding(negativeAlphaManifest, 'f'.repeat(64), negativeAlphaVerification).pristineForwardEvidence,
  false,
  'episode counts and approvals must not promote negative realized alpha',
)

const dustManifestPath = path.join(fixtureDir, 'dust-exposure', 'reviewed-validation-integrity.json')
const dustFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: dustManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactCoreDigestSha256: strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256: fixturePreregistration.preregistrationDigestSha256,
  sealedAt: fixturePreregistration.sealedAt,
  submittedOrderCount: 12,
  materialGasPosition: 0.05,
})
const dustManifest = promotionReadyManifest()
dustManifest.observedForwardEvidence = {
  ...dustFixtures.forwardSummary,
  evidenceArtifactDigestSha256: dustFixtures.forwardEvidenceArtifactDigestSha256,
  reviewedAt: '2025-10-01T04:30:00.000Z',
}
dustManifest.paperExecutionEvidence = {
  ...dustManifest.paperExecutionEvidence,
  evidenceArtifactDigestSha256: dustFixtures.paperEvidenceArtifactDigestSha256,
}
const dustVerification = verifyValidationEvidenceArtifacts(process.cwd(), dustManifestPath, dustManifest)
assert.match(
  dustVerification.failures.join('; '),
  /gasPosition 0\.05 is not an exact executable summer weather-follow\/summer-heat-long target/,
)
assert.equal(dustVerification.forward.valid, false)
assert.equal(
  validationIntegrityBinding(dustManifest, 'f'.repeat(64), dustVerification).pristineForwardEvidence,
  false,
  'dust gas exposure cannot manufacture material episodes',
)

const forgedTargetManifestPath = path.join(fixtureDir, 'forged-target', 'reviewed-validation-integrity.json')
const forgedTargetFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: forgedTargetManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactCoreDigestSha256: strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256: fixturePreregistration.preregistrationDigestSha256,
  sealedAt: fixturePreregistration.sealedAt,
  submittedOrderCount: 12,
  materialGasPosition: 0.2,
})
const forgedTargetManifest = promotionReadyManifest()
forgedTargetManifest.observedForwardEvidence = {
  ...forgedTargetFixtures.forwardSummary,
  evidenceArtifactDigestSha256: forgedTargetFixtures.forwardEvidenceArtifactDigestSha256,
  reviewedAt: '2025-10-01T04:30:00.000Z',
}
forgedTargetManifest.paperExecutionEvidence = {
  ...forgedTargetManifest.paperExecutionEvidence,
  evidenceArtifactDigestSha256: forgedTargetFixtures.paperEvidenceArtifactDigestSha256,
}
const forgedTargetVerification = verifyValidationEvidenceArtifacts(
  process.cwd(),
  forgedTargetManifestPath,
  forgedTargetManifest,
)
assert.match(
  forgedTargetVerification.failures.join('; '),
  /gasPosition 0\.2 is not an exact executable summer weather-follow\/summer-heat-long target/,
)
assert.equal(forgedTargetVerification.forward.valid, false)

const tinyEdgeManifestPath = path.join(fixtureDir, 'tiny-edge', 'reviewed-validation-integrity.json')
const tinyEdgeFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: tinyEdgeManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactCoreDigestSha256: strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256: fixturePreregistration.preregistrationDigestSha256,
  sealedAt: fixturePreregistration.sealedAt,
  submittedOrderCount: 12,
  materialUngIntradayReturnPct: 0.1,
})
const tinyEdgeManifest = promotionReadyManifest()
tinyEdgeManifest.observedForwardEvidence = {
  ...tinyEdgeFixtures.forwardSummary,
  evidenceArtifactDigestSha256: tinyEdgeFixtures.forwardEvidenceArtifactDigestSha256,
  reviewedAt: '2025-10-01T04:30:00.000Z',
}
tinyEdgeManifest.paperExecutionEvidence = {
  ...tinyEdgeManifest.paperExecutionEvidence,
  evidenceArtifactDigestSha256: tinyEdgeFixtures.paperEvidenceArtifactDigestSha256,
}
const tinyEdgeVerification = verifyValidationEvidenceArtifacts(
  process.cwd(),
  tinyEdgeManifestPath,
  tinyEdgeManifest,
)
assert.deepEqual(tinyEdgeVerification.failures, [])
assert.equal(tinyEdgeVerification.forward.summary.independentEpisodes, 60)
assert.ok(tinyEdgeVerification.forward.summary.outcomeSummary.compoundedActiveReturnPct.baseline > 0)
assert.ok(tinyEdgeVerification.forward.summary.outcomeSummary.compoundedActiveReturnPct.baseline < 2)
assert.equal(tinyEdgeVerification.forward.summary.outcomeSummary.gates.baselineEfficacy, false)
assert.equal(tinyEdgeVerification.forward.summary.outcomeGatesSatisfied, false)
assert.equal(
  validationIntegrityBinding(tinyEdgeManifest, 'f'.repeat(64), tinyEdgeVerification).pristineForwardEvidence,
  false,
  'statistically tidy but economically trivial edge cannot promote',
)

const embargoManifestPath = path.join(fixtureDir, 'embargo-grouping', 'reviewed-validation-integrity.json')
const embargoFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: embargoManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactCoreDigestSha256: strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256: fixturePreregistration.preregistrationDigestSha256,
  sealedAt: fixturePreregistration.sealedAt,
  submittedOrderCount: 12,
  additionalWithinEmbargoTarget: true,
})
const embargoManifest = removeLiveApproval(promotionReadyManifest())
embargoManifest.historicalEvidence.pristineForwardEvidence = false
embargoManifest.observedForwardEvidence = {
  ...embargoFixtures.forwardSummary,
  evidenceArtifactDigestSha256: embargoFixtures.forwardEvidenceArtifactDigestSha256,
  reviewedAt: '2025-10-01T04:30:00.000Z',
}
embargoManifest.paperExecutionEvidence = {
  ...embargoManifest.paperExecutionEvidence,
  evidenceArtifactDigestSha256: embargoFixtures.paperEvidenceArtifactDigestSha256,
}
assert.deepEqual(validateValidationIntegrityManifest(embargoManifest), [])
const embargoVerification = verifyValidationEvidenceArtifacts(
  process.cwd(),
  embargoManifestPath,
  embargoManifest,
)
assert.deepEqual(embargoVerification.failures, [])
assert.equal(embargoVerification.forward.summary.independentEpisodes, 59)

const concentratedPolicy = structuredClone(DEFAULT_FORWARD_OUTCOME_POLICY)
concentratedPolicy.minimumMaterialSeasonsByComponent = {
  'ngas-summer-alpha': 5,
  'ngas-winter-alpha': 5,
}
const concentratedPreregistration = promotionPreregisteredManifest()
concentratedPreregistration.forwardOutcomePolicy = concentratedPolicy
sealPreregistration(concentratedPreregistration)
const concentratedManifestPath = path.join(fixtureDir, 'one-season-components', 'reviewed-validation-integrity.json')
const concentratedFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: concentratedManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactCoreDigestSha256: strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256: concentratedPreregistration.preregistrationDigestSha256,
  sealedAt: concentratedPreregistration.sealedAt,
  submittedOrderCount: 12,
  forwardOutcomePolicy: concentratedPolicy,
})
const concentratedManifest = removeLiveApproval(promotionReadyManifest())
concentratedManifest.historicalEvidence.pristineForwardEvidence = false
concentratedManifest.forwardOutcomePolicy = concentratedPolicy
sealPreregistration(concentratedManifest)
concentratedManifest.observedForwardEvidence = {
  ...concentratedFixtures.forwardSummary,
  evidenceArtifactDigestSha256: concentratedFixtures.forwardEvidenceArtifactDigestSha256,
  reviewedAt: '2025-10-01T04:30:00.000Z',
}
concentratedManifest.paperExecutionEvidence = {
  ...concentratedManifest.paperExecutionEvidence,
  evidenceArtifactDigestSha256: concentratedFixtures.paperEvidenceArtifactDigestSha256,
}
assert.deepEqual(validateValidationIntegrityManifest(concentratedManifest), [])
const concentratedVerification = verifyValidationEvidenceArtifacts(
  process.cwd(),
  concentratedManifestPath,
  concentratedManifest,
)
assert.deepEqual(concentratedVerification.failures, [])
assert.equal(concentratedVerification.forward.summary.outcomeSummary.gates.minimumComponentEpisodes, true)
assert.equal(concentratedVerification.forward.summary.outcomeSummary.gates.minimumComponentSeasons, false)
assert.equal(
  concentratedVerification.forward.summary.outcomeSummary.gates.componentSpecificLeaveOneSeasonOut,
  false,
)

const impossibleSeasonClaim = promotionReadyManifest()
impossibleSeasonClaim.observedForwardEvidence.observedThrough = '2024-03-31'
assert.match(
  validateValidationIntegrityManifest(impossibleSeasonClaim).join('; '),
  /completeSummerSeasons exceeds the complete prospective Summer seasons available/,
)

const unboundForwardEvidence = promotionReadyManifest()
unboundForwardEvidence.observedForwardEvidence.strategyContractDigestSha256 = 'e'.repeat(64)
assert.match(
  validateValidationIntegrityManifest(unboundForwardEvidence).join('; '),
  /pristine forward evidence must be bound to the sealed strategy-contract digest/,
)

const unboundForwardArtifact = promotionReadyManifest()
unboundForwardArtifact.observedForwardEvidence.strategyArtifactDigestSha256 = 'e'.repeat(64)
assert.match(
  validateValidationIntegrityManifest(unboundForwardArtifact).join('; '),
  /pristine forward evidence must be bound to the sealed strategy-artifact digest/,
)

const retrospectiveSeal = promotionReadyManifest()
retrospectiveSeal.sealedAt = '2020-01-03T15:00:00.000Z'
sealPreregistration(retrospectiveSeal)
assert.match(
  validateValidationIntegrityManifest(retrospectiveSeal).join('; '),
  /sealedAt New York calendar date must precede prospectiveStart/,
)

const hiddenParallelCandidate = promotionReadyManifest()
hiddenParallelCandidate.candidateRegistry.candidates.push({
  candidateId: 'post-hoc-provisional-candidate',
  strategyContractDigestSha256: 'd'.repeat(64),
  strategyArtifactCoreDigestSha256: 'e'.repeat(64),
})
hiddenParallelCandidate.candidateRegistry.familySize = 2
hiddenParallelCandidate.candidateRegistry.registryDigestSha256 =
  validationCandidateRegistryDigestSha256(hiddenParallelCandidate.candidateRegistry)
hiddenParallelCandidate.preregistrationDigestSha256 =
  validationPreregistrationDigestSha256(hiddenParallelCandidate)
assert.match(
  validateValidationIntegrityManifest(hiddenParallelCandidate).join('; '),
  /candidateRegistry.familySize must equal one/,
)

const reorderedImplementation = promotionReadyManifest()
reorderedImplementation.forwardValidationImplementation.sourceFiles.reverse()
reorderedImplementation.forwardValidationImplementation.implementationDigestSha256 =
  'f'.repeat(64)
sealPreregistration(reorderedImplementation)
assert.match(
  validateValidationIntegrityManifest(reorderedImplementation).join('; '),
  /sourceFiles\[0\]\.path must equal|implementationDigestSha256 must bind/,
)

const extraImplementationFile = promotionReadyManifest()
extraImplementationFile.forwardValidationImplementation.sourceFiles.push({
  path: 'scripts/lib/unreviewed-forward-rule.mjs',
  digestSha256: 'f'.repeat(64),
})
sealPreregistration(extraImplementationFile)
assert.match(
  validateValidationIntegrityManifest(extraImplementationFile).join('; '),
  /sourceFiles must contain the exact reviewed file inventory/,
)

const substitutedImplementationPath = promotionReadyManifest()
substitutedImplementationPath.forwardValidationImplementation.sourceFiles[0].path =
  'scripts/lib/substituted-live-contract.mjs'
sealPreregistration(substitutedImplementationPath)
assert.match(
  validateValidationIntegrityManifest(substitutedImplementationPath).join('; '),
  /sourceFiles\[0\]\.path must equal/,
)

const appendOnlyBinding = empty.forwardValidationImplementation.appendOnlyInputs[0]
const appendOnlyCalendar = JSON.parse(await readFile(
  path.join(process.cwd(), appendOnlyBinding.path),
  'utf8',
))
assert.deepEqual(appendOnlyForwardInputFailures(appendOnlyBinding, appendOnlyCalendar), [])
const validCalendarExtension = structuredClone(appendOnlyCalendar)
validCalendarExtension.releases.push({
  periodEndDate: '2027-01-01',
  releasedAt: '2027-01-07T15:30:00.000Z',
  releaseKind: 'standard-schedule',
})
validCalendarExtension.verifiedThroughPeriodEndDate = '2027-01-01'
assert.deepEqual(
  appendOnlyForwardInputFailures(appendOnlyBinding, validCalendarExtension),
  [],
  'a strictly later reviewed release-calendar row must not reset prospective validation',
)
const mutatedCalendarPrefix = structuredClone(appendOnlyCalendar)
mutatedCalendarPrefix.releases[0].releasedAt = '2010-01-07T15:31:00.000Z'
assert.match(
  appendOnlyForwardInputFailures(appendOnlyBinding, mutatedCalendarPrefix).join('; '),
  /immutable prefix digest does not match/,
)
const lookaheadCalendarExtension = structuredClone(validCalendarExtension)
lookaheadCalendarExtension.releases.at(-1).releasedAt = '2027-01-01T00:00:00.000Z'
assert.match(
  appendOnlyForwardInputFailures(appendOnlyBinding, lookaheadCalendarExtension).join('; '),
  /releasedAt must be after the complete period-end day/,
)

const changedHistoricalContamination = promotionReadyManifest()
const originalHistoricalPreregistration =
  changedHistoricalContamination.preregistrationDigestSha256
changedHistoricalContamination.historicalEvidence.observedThrough = '2019-12-14'
assert.notEqual(
  validationPreregistrationDigestSha256(changedHistoricalContamination),
  originalHistoricalPreregistration,
  'the immutable historical contamination snapshot must rotate the preregistration',
)

const mutableReviewUpdate = promotionReadyManifest()
const immutablePreregistrationDigest = mutableReviewUpdate.preregistrationDigestSha256
const mutableManifestDigestBeforeReview = crypto.createHash('sha256')
  .update(JSON.stringify(mutableReviewUpdate))
  .digest('hex')
mutableReviewUpdate.reviewedAt = '2025-10-03T00:00:00.000Z'
assert.equal(
  validationPreregistrationDigestSha256(mutableReviewUpdate),
  immutablePreregistrationDigest,
  'mutable review metadata must not invalidate prior preregistration commitments',
)
assert.notEqual(
  crypto.createHash('sha256').update(JSON.stringify(mutableReviewUpdate)).digest('hex'),
  mutableManifestDigestBeforeReview,
  'the mutable full-manifest identity must still rotate when review metadata changes',
)

const changedOutcomePolicy = promotionReadyManifest()
changedOutcomePolicy.forwardOutcomePolicy.maximumActiveDrawdownPct = 11
assert.match(
  validateValidationIntegrityManifest(changedOutcomePolicy).join('; '),
  /maximumActiveDrawdownPct must be in \(0, 10\]/,
)

const weakenedComponentMinimum = promotionReadyManifest()
weakenedComponentMinimum.forwardOutcomePolicy.minimumMaterialEpisodesByComponent['ngas-summer-alpha'] = 1
assert.match(
  validateValidationIntegrityManifest(weakenedComponentMinimum).join('; '),
  /minimumMaterialEpisodesByComponent.ngas-summer-alpha must be an integer of at least 15/,
)

const weakenedEconomicHurdle = promotionReadyManifest()
weakenedEconomicHurdle.forwardOutcomePolicy.minimumCompoundedActiveReturnPct.baseline = -10
assert.match(
  validateValidationIntegrityManifest(weakenedEconomicHurdle).join('; '),
  /minimumCompoundedActiveReturnPct.baseline must be at least 2/,
)

const weakenedForwardMinimum = promotionReadyManifest()
weakenedForwardMinimum.minimumForwardEvidence.independentEpisodes = 1
weakenedForwardMinimum.minimumForwardEvidence.completeSummerSeasons = 1
assert.match(
  validateValidationIntegrityManifest(weakenedForwardMinimum).join('; '),
  /independentEpisodes must be at least 60.*completeSummerSeasons must be at least 2/,
)

const weakenedPaperMinimum = promotionReadyManifest()
weakenedPaperMinimum.minimumPaperExecutionEvidence.tradingSessions = 1
weakenedPaperMinimum.minimumPaperExecutionEvidence.maximumP95AbsoluteSlippageBps = 500
assert.match(
  validateValidationIntegrityManifest(weakenedPaperMinimum).join('; '),
  /tradingSessions must be at least 60.*maximumP95AbsoluteSlippageBps cannot exceed 50/,
)

const reusedStrategyApproval = promotionReadyManifest()
reusedStrategyApproval.approvals.live.strategyContractDigestSha256 = 'e'.repeat(64)
assert.match(
  validateValidationIntegrityManifest(reusedStrategyApproval).join('; '),
  /live approval strategy-contract digest must equal the sealed strategy contract/,
)

const reusedBrokerApproval = promotionReadyManifest()
reusedBrokerApproval.approvals.paper.brokerExecutionProfileDigestSha256 = 'e'.repeat(64)
assert.match(
  validateValidationIntegrityManifest(reusedBrokerApproval).join('; '),
  /paper approval broker-profile digest must equal the sealed broker execution profile/,
)

const approvalAtImplementationSeal = promotionReadyManifest()
approvalAtImplementationSeal.approvals.paper.approvedAt = approvalAtImplementationSeal.sealedAt
assert.match(
  validateValidationIntegrityManifest(approvalAtImplementationSeal).join('; '),
  /paper approval must follow the current implementation seal/,
)

const prematureLiveApproval = promotionReadyManifest()
prematureLiveApproval.approvals.live.approvedAt = '2025-09-30T12:00:00.000Z'
assert.match(
  validateValidationIntegrityManifest(prematureLiveApproval).join('; '),
  /live approval cannot precede the paper execution evidence review/,
)

const weakPaperEvidence = promotionReadyManifest()
weakPaperEvidence.paperExecutionEvidence.filledOrders = 9
assert.equal(paperExecutionEvidenceSatisfied(weakPaperEvidence), false)
assert.match(
  validateValidationIntegrityManifest(weakPaperEvidence).join('; '),
  /live approval requires sufficient reviewed paper execution evidence/,
)

const weakFillRatio = promotionReadyManifest()
weakFillRatio.paperExecutionEvidence.submittedOrders = 20
weakFillRatio.paperExecutionEvidence.filledOrderRatio = 0.5
assert.equal(paperExecutionEvidenceSatisfied(weakFillRatio), false)
assert.match(
  validateValidationIntegrityManifest(weakFillRatio).join('; '),
  /live approval requires sufficient reviewed paper execution evidence/,
)

const dilutedUngSlippage = promotionReadyManifest()
dilutedUngSlippage.paperExecutionEvidence.submittedOrders = 81
dilutedUngSlippage.paperExecutionEvidence.filledOrders = 81
dilutedUngSlippage.paperExecutionEvidence.filledOrderRatio = 1
dilutedUngSlippage.paperExecutionEvidence.medianAbsoluteSlippageBps = 0
dilutedUngSlippage.paperExecutionEvidence.p95AbsoluteSlippageBps = 0
dilutedUngSlippage.paperExecutionEvidence.ungMedianAbsoluteSlippageBps = 500
dilutedUngSlippage.paperExecutionEvidence.ungP95AbsoluteSlippageBps = 500
assert.equal(paperExecutionEvidenceSatisfied(dilutedUngSlippage), false)
assert.match(
  validateValidationIntegrityManifest(dilutedUngSlippage).join('; '),
  /live approval requires sufficient reviewed paper execution evidence/,
)

const untestedShortRoute = promotionReadyManifest()
untestedShortRoute.paperExecutionEvidence.ungShortFilledOrders = 1
assert.equal(paperExecutionEvidenceSatisfied(untestedShortRoute), false)
assert.match(
  validateValidationIntegrityManifest(untestedShortRoute).join('; '),
  /live approval requires sufficient reviewed paper execution evidence/,
)

const futureApproval = promotionReadyManifest()
futureApproval.approvals.live.approvedAt = '2025-10-03T00:00:00.000Z'
assert.match(
  validateValidationIntegrityManifest(futureApproval).join('; '),
  /live approval cannot postdate the manifest review/,
)

const futureEvidence = promotionReadyManifest()
assert.match(
  validateValidationIntegrityManifest(futureEvidence, { asOf: '2024-01-01T12:00:00.000Z' }).join('; '),
  /cannot be in the future|must precede the validation cutoff date/,
)

const sameDayEvidenceReview = promotionReadyManifest()
sameDayEvidenceReview.paperExecutionEvidence.reviewedAt = `${sameDayEvidenceReview.paperExecutionEvidence.periodEnd}T23:59:59.000Z`
assert.match(
  validateValidationIntegrityManifest(sameDayEvidenceReview).join('; '),
  /paperExecutionEvidence.reviewedAt must be after periodEnd/,
)

const forwardReviewPostdatesManifest = removeLiveApproval(promotionReadyManifest())
forwardReviewPostdatesManifest.reviewedAt = '2025-10-01T05:00:00.000Z'
forwardReviewPostdatesManifest.observedForwardEvidence.reviewedAt = '2025-10-01T06:00:00.000Z'
assert.match(
  validateValidationIntegrityManifest(forwardReviewPostdatesManifest).join('; '),
  /prospective forward-evidence review cannot postdate the manifest review/,
)

const beforeNewYorkMidnight = removeLiveApproval(promotionReadyManifest())
beforeNewYorkMidnight.reviewedAt = '2025-10-01T02:00:00.000Z'
beforeNewYorkMidnight.observedForwardEvidence.reviewedAt = '2025-10-01T00:30:00.000Z'
beforeNewYorkMidnight.paperExecutionEvidence.reviewedAt = '2025-10-01T01:00:00.000Z'
const beforeNewYorkMidnightFailures = validateValidationIntegrityManifest(beforeNewYorkMidnight, {
  asOf: '2025-10-01T02:30:00.000Z',
}).join('; ')
assert.match(beforeNewYorkMidnightFailures, /observedForwardEvidence.observedThrough must precede the validation cutoff date/)
assert.match(beforeNewYorkMidnightFailures, /observedForwardEvidence.reviewedAt must be after observedThrough/)

const paperReviewAfterUtcMidnight = removeLiveApproval(promotionReadyManifest())
const paperPeriodEndNextUtcDate = new Date(
  Date.parse(`${paperReviewAfterUtcMidnight.paperExecutionEvidence.periodEnd}T00:00:00.000Z`) + 86400000,
).toISOString().slice(0, 10)
paperReviewAfterUtcMidnight.paperExecutionEvidence.reviewedAt = `${paperPeriodEndNextUtcDate}T00:30:00.000Z`
assert.match(
  validateValidationIntegrityManifest(paperReviewAfterUtcMidnight).join('; '),
  /paperExecutionEvidence.reviewedAt must be after periodEnd/,
)

const approvalAfterUtcMidnight = removeLiveApproval(promotionReadyManifest())
const paperStartNextUtcDate = new Date(
  Date.parse(`${approvalAfterUtcMidnight.paperExecutionEvidence.periodStart}T00:00:00.000Z`) + 86400000,
).toISOString().slice(0, 10)
approvalAfterUtcMidnight.approvals.paper.approvedAt = `${paperStartNextUtcDate}T00:30:00.000Z`
assert.doesNotMatch(
  validateValidationIntegrityManifest(approvalAfterUtcMidnight).join('; '),
  /paper execution evidence cannot start before paper approval/,
)

await writeFile(fixtureManifestPath, `${JSON.stringify(ready, null, 2)}\n`)
const previousFixtureManifestOverride = process.env.QORE_VALIDATION_INTEGRITY_FILE
const previousFixtureNodeEnv = process.env.NODE_ENV
const previousFixtureCapability = process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES
try {
  process.env.NODE_ENV = 'test'
  process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES = '1'
  process.env.QORE_VALIDATION_INTEGRITY_FILE = fixtureManifestPath
  const loaded = loadValidationIntegrityManifest(process.cwd())
  assert.equal(loaded.binding.pristineForwardEvidence, true)
  assert.equal(loaded.binding.paperExecutionEvidenceSatisfied, true)

  const fabricatedImplementationSeal = structuredClone(ready)
  const fabricatedSourceRow = fabricatedImplementationSeal.forwardValidationImplementation
    .sourceFiles.find((row) => row.path === 'scripts/lib/qore-live-contract.mjs')
  assert.ok(fabricatedSourceRow)
  fabricatedSourceRow.digestSha256 = 'e'.repeat(64)
  fabricatedImplementationSeal.forwardValidationImplementation.implementationDigestSha256 =
    forwardValidationImplementationDigestSha256(
      fabricatedImplementationSeal.forwardValidationImplementation,
    )
  sealPreregistration(fabricatedImplementationSeal)
  await writeFile(
    fixtureManifestPath,
    `${JSON.stringify(fabricatedImplementationSeal, null, 2)}\n`,
  )
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /qore-live-contract\.mjs digest does not match the current reviewed bytes/,
  )

  const fabricatedAppendOnlySeal = structuredClone(ready)
  fabricatedAppendOnlySeal.forwardValidationImplementation
    .appendOnlyInputs[0].prefixDigestSha256 = 'e'.repeat(64)
  fabricatedAppendOnlySeal.forwardValidationImplementation.implementationDigestSha256 =
    forwardValidationImplementationDigestSha256(
      fabricatedAppendOnlySeal.forwardValidationImplementation,
    )
  sealPreregistration(fabricatedAppendOnlySeal)
  await writeFile(
    fixtureManifestPath,
    `${JSON.stringify(fabricatedAppendOnlySeal, null, 2)}\n`,
  )
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /immutable prefix digest does not match current calendar bytes/,
  )

  for (const field of ['executionContractId', 'executionContractDigestSha256']) {
    const unboundZeroEvidencePolicy = emptyManifest()
    unboundZeroEvidencePolicy.forwardOutcomePolicy[field] =
      field === 'executionContractId' ? 'substituted-execution-contract' : 'e'.repeat(64)
    sealPreregistration(unboundZeroEvidencePolicy)
    await writeFile(
      fixtureManifestPath,
      `${JSON.stringify(unboundZeroEvidencePolicy, null, 2)}\n`,
    )
    assert.throws(
      () => loadValidationIntegrityManifest(process.cwd()),
      new RegExp(`forwardOutcomePolicy\\.${field} must equal the loaded reviewed research execution contract`),
    )
  }
  await writeFile(fixtureManifestPath, `${JSON.stringify(ready, null, 2)}\n`)

  async function assertMutatedArtifactFails(kind, mutate, expectedFailure) {
    const manifestField = kind === 'forward' ? 'observedForwardEvidence' : 'paperExecutionEvidence'
    const artifact = structuredClone(
      kind === 'forward' ? evidenceFixtures.forwardArtifact : evidenceFixtures.paperArtifact,
    )
    mutate(artifact)
    const digestSha256 = await writeProtectedArtifact(evidenceFixtures.paths[kind], artifact)
    const mutatedManifest = structuredClone(ready)
    mutatedManifest[manifestField].evidenceArtifactDigestSha256 = digestSha256
    await writeFile(fixtureManifestPath, `${JSON.stringify(mutatedManifest, null, 2)}\n`)
    assert.throws(() => loadValidationIntegrityManifest(process.cwd()), expectedFailure)
    const restoredDigest = await writeProtectedArtifact(
      evidenceFixtures.paths[kind],
      kind === 'forward' ? evidenceFixtures.forwardArtifact : evidenceFixtures.paperArtifact,
    )
    assert.equal(
      restoredDigest,
      kind === 'forward'
        ? evidenceFixtures.forwardEvidenceArtifactDigestSha256
        : evidenceFixtures.paperEvidenceArtifactDigestSha256,
    )
    await writeFile(fixtureManifestPath, `${JSON.stringify(ready, null, 2)}\n`)
  }

  async function assertMutatedPaperArtifactPasses(mutate, mutateManifest = () => {}) {
    const artifact = structuredClone(evidenceFixtures.paperArtifact)
    mutate(artifact)
    const digestSha256 = await writeProtectedArtifact(evidenceFixtures.paths.paper, artifact)
    const mutatedManifest = structuredClone(ready)
    mutatedManifest.paperExecutionEvidence.evidenceArtifactDigestSha256 = digestSha256
    mutateManifest(mutatedManifest)
    await writeFile(fixtureManifestPath, `${JSON.stringify(mutatedManifest, null, 2)}\n`)
    const result = loadValidationIntegrityManifest(process.cwd())
    assert.equal(result.evidenceVerification.paper.valid, true)
    const restoredDigest = await writeProtectedArtifact(
      evidenceFixtures.paths.paper,
      evidenceFixtures.paperArtifact,
    )
    assert.equal(restoredDigest, evidenceFixtures.paperEvidenceArtifactDigestSha256)
    await writeFile(fixtureManifestPath, `${JSON.stringify(ready, null, 2)}\n`)
  }

  await assertMutatedArtifactFails('forward', (artifact) => {
    artifact.preregistrationDigestSha256 = 'd'.repeat(64)
  }, /preregistrationDigestSha256 must match the immutable reviewed preregistration/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    artifact.commitmentJournal.preregistrationDigestSha256 = 'd'.repeat(64)
  }, /commitmentJournal.preregistrationDigestSha256 must match the immutable reviewed preregistration/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations[0]
    observation.preregistrationDigestSha256 = 'd'.repeat(64)
    observation.observationIdSha256 = forwardObservationIdSha256(observation)
  }, /observations\[0\]\.preregistrationDigestSha256 must equal the immutable reviewed preregistration/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations[0]
    observation.inference.generatedAt = '2019-12-31T11:59:00.000Z'
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
    observation.observationIdSha256 = forwardObservationIdSha256(observation)
  }, /inference.generatedAt cannot precede the immutable preregistration seal/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations[0]
    observation.recordedAt = '2019-12-31T11:59:00.000Z'
    observation.observationIdSha256 = forwardObservationIdSha256(observation)
  }, /recordedAt cannot precede the immutable preregistration seal/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations[0]
    observation.sessionDate = '2023-01-07'
    observation.recordedAt = '2023-01-07T12:00:00.000Z'
    observation.inference.generatedAt = '2023-01-07T11:59:00.000Z'
    observation.inference.targetDate = '2023-01-07'
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
  }, /sessionDate must be a reviewed NYSE session \(nyse-weekend\)/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations.find(({ inference }) => inference.gasPosition !== 0)
    observation.inference.generatedAt = `${observation.sessionDate}T16:00:00.000Z`
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
  }, /inference.generatedAt must be before 09:30 America\/New_York on sessionDate/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    artifact.observations = artifact.observations.filter(({ sessionDate }) => sessionDate !== '2023-05-01')
  }, /completeSummerSeasons .* does not match the reviewed manifest/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const settlement = artifact.settlements.find(({ outcomes }) => outcomes.baseline.activeReturnPct > 0)
    settlement.outcomes.baseline.activeReturnPct += 1
    settlement.settlementDigestSha256 = forwardSettlementDigestSha256(settlement)
  }, /outcomes do not match causal post-cost recomputation/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const settlement = artifact.settlements[0]
    settlement.marketSession.sourceId = 'self-reported-substitute-source'
    settlement.marketSessionDigestSha256 = forwardMarketSessionDigestSha256(settlement.marketSession)
    settlement.settlementDigestSha256 = forwardSettlementDigestSha256(settlement)
  }, /marketSession.sourceId must equal the reviewed forward market-data source/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations.find(({ inference }) => (
      inference.componentStrategyId === 'ngas-summer-alpha'
    ))
    observation.inference.componentStrategyId = 'ngas-winter-alpha'
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
    const settlement = artifact.settlements.find(({ observationIdSha256 }) => (
      observationIdSha256 === observation.observationIdSha256
    ))
    settlement.inferenceDigestSha256 = observation.inferenceDigestSha256
    settlement.settlementDigestSha256 = forwardSettlementDigestSha256(settlement)
  }, /componentStrategyId must equal ngas-summer-alpha or index-fallback for summer/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations.find(({ inference }) => (
      inference.componentStrategyId === 'ngas-winter-alpha'
    ))
    observation.inference.thesisKind = 'arbitrary-weather-thesis'
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
    const settlement = artifact.settlements.find(({ observationIdSha256 }) => (
      observationIdSha256 === observation.observationIdSha256
    ))
    settlement.inferenceDigestSha256 = observation.inferenceDigestSha256
    settlement.settlementDigestSha256 = forwardSettlementDigestSha256(settlement)
  }, /windowId\/thesisKind is not a reviewed winter target combination/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations[0]
    observation.inference.gasPosition = 0.75
    observation.inference.indexFraction = 0.75
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
  }, /target indexFraction must exactly equal 0.25 for gasPosition 0.75/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations.find(({ inference }) => inference.gasPosition !== 0)
    observation.inference.gasPosition += Math.sign(observation.inference.gasPosition) * 0.000001
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
  }, /target gasPosition must equal its canonical four-decimal representation/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations[0]
    observation.inference.cashFraction = 0.0000001
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
  }, /target cashFraction must exactly equal zero/)

  await assertMutatedArtifactFails('paper', (artifact) => {
    artifact.tradingSessions.push('2023-01-07')
    artifact.tradingSessions.sort()
  }, /tradingSessions\[.*\] must be a reviewed NYSE session \(nyse-weekend\)/)

  await assertMutatedArtifactFails('paper', (artifact) => {
    artifact.orders[0].targetExposure = 'short'
  }, /targetExposure is not accepted; direction must derive from side, quantity, and signed positions/)

  await assertMutatedArtifactFails('paper', (artifact) => {
    const order = artifact.orders[0]
    order.referenceQuoteTimestamp = new Date(Date.parse(order.filledAt) - 10 * 60 * 1000).toISOString()
  }, /referenceQuoteTimestamp must be fresh at fill time/)

  await assertMutatedArtifactFails('paper', (artifact) => {
    const order = artifact.orders[9]
    order.quantity = 0.05
    order.postPositionQuantity = order.prePositionQuantity + 0.05
    order.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(order)
  }, /filled notional is below the reviewed broker profile minimum order USD/)

  await assertMutatedArtifactFails('paper', (artifact) => {
    const order = artifact.orders[0]
    order.referenceQuoteBidPriceUsd = 99
    order.referenceQuoteAskPriceUsd = 101
  }, /reference quote spread exceeds the reviewed broker profile maximum/)

  await assertMutatedArtifactFails('paper', (artifact) => {
    const order = artifact.orders[0]
    order.filledAt = `${artifact.tradingSessions[0]}T22:00:01.000Z`
    order.referenceQuoteTimestamp = `${artifact.tradingSessions[0]}T22:00:00.000Z`
    order.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(order)
  }, /filledAt must fall within the regular New York trading session/)

  await assertMutatedArtifactFails('paper', (artifact) => {
    const earlyCloseSessions = reviewedNyseSessionDates('2023-11-24', '2024-03-31').slice(0, 60)
    artifact.tradingSessions = earlyCloseSessions
    for (const [index, order] of artifact.orders.entries()) {
      const sessionDate = earlyCloseSessions[Math.min(index, earlyCloseSessions.length - 1)]
      order.submittedAt = `${sessionDate}T15:00:00.000Z`
      if (order.status === 'filled') {
        order.filledAt = `${sessionDate}T15:00:01.000Z`
        order.referenceQuoteTimestamp = `${sessionDate}T15:00:00.000Z`
      }
      order.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(order)
    }
    const earlyCloseOrder = artifact.orders[0]
    earlyCloseOrder.submittedAt = '2023-11-24T18:59:00.000Z'
    earlyCloseOrder.filledAt = '2023-11-24T19:00:00.000Z'
    earlyCloseOrder.referenceQuoteTimestamp = '2023-11-24T18:59:59.000Z'
    earlyCloseOrder.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(earlyCloseOrder)
  }, /filledAt must fall within the regular New York trading session/)

  await assertMutatedArtifactFails('paper', (artifact) => {
    const crossingOrder = artifact.orders[2]
    crossingOrder.prePositionQuantity = 0.5
    crossingOrder.quantity = 1
    crossingOrder.postPositionQuantity = -0.5
    crossingOrder.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(crossingOrder)
    const nextOrder = artifact.orders[3]
    nextOrder.prePositionQuantity = -0.5
    nextOrder.postPositionQuantity = -1.5
    nextOrder.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(nextOrder)
  }, /whole-share quantity and resulting position when opening or increasing a short/)

  await assertMutatedPaperArtifactPasses((artifact) => {
    const fractionalLong = artifact.orders[9]
    fractionalLong.quantity = 0.5
    fractionalLong.postPositionQuantity = fractionalLong.prePositionQuantity + 0.5
    fractionalLong.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(fractionalLong)
  })

  await assertMutatedPaperArtifactPasses((artifact) => {
    const cover = artifact.orders[3]
    cover.side = 'buy'
    cover.quantity = 1.5
    cover.prePositionQuantity = -1
    cover.postPositionQuantity = 0.5
    cover.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(cover)
    const fractionalLongExit = artifact.orders[4]
    fractionalLongExit.symbol = 'UNG'
    fractionalLongExit.side = 'sell'
    fractionalLongExit.quantity = 0.5
    fractionalLongExit.prePositionQuantity = 0.5
    fractionalLongExit.postPositionQuantity = 0
    fractionalLongExit.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(fractionalLongExit)
    const replacementShort = artifact.orders[5]
    replacementShort.symbol = 'UNG'
    replacementShort.side = 'sell'
    replacementShort.quantity = 1
    replacementShort.prePositionQuantity = 0
    replacementShort.postPositionQuantity = -1
    replacementShort.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(replacementShort)
  }, (manifest) => {
    manifest.paperExecutionEvidence.ungFilledOrders = 6
    manifest.paperExecutionEvidence.ungLongFilledOrders = 3
  })

  const approvalAfterFirstOrders = structuredClone(ready)
  approvalAfterFirstOrders.approvals.paper.approvedAt = '2023-01-03T16:00:00.000Z'
  await writeFile(fixtureManifestPath, `${JSON.stringify(approvalAfterFirstOrders, null, 2)}\n`)
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /submittedAt cannot precede the paper approval timestamp/,
  )
  await writeFile(fixtureManifestPath, `${JSON.stringify(ready, null, 2)}\n`)

  const untrustedWriterArtifact = structuredClone(evidenceFixtures.forwardArtifact)
  untrustedWriterArtifact.commitmentJournal = {
    ...untrustedWriterArtifact.commitmentJournal,
    writerId: 'manually-backfilled-untrusted-writer',
    testOnly: false,
  }
  const untrustedWriterDigest = await writeProtectedArtifact(
    evidenceFixtures.paths.forward,
    untrustedWriterArtifact,
  )
  const untrustedWriterManifest = structuredClone(ready)
  untrustedWriterManifest.observedForwardEvidence.evidenceArtifactDigestSha256 = untrustedWriterDigest
  await writeFile(fixtureManifestPath, `${JSON.stringify(untrustedWriterManifest, null, 2)}\n`)
  const untrustedWriterResult = loadValidationIntegrityManifest(process.cwd())
  assert.equal(untrustedWriterResult.evidenceVerification.forward.valid, true)
  assert.equal(
    untrustedWriterResult.evidenceVerification.forward.summary.outcomeSummary.gates.trustedPreopenCommitments,
    false,
  )
  assert.equal(untrustedWriterResult.binding.pristineForwardEvidence, false)
  await writeProtectedArtifact(evidenceFixtures.paths.forward, evidenceFixtures.forwardArtifact)
  await writeFile(fixtureManifestPath, `${JSON.stringify(ready, null, 2)}\n`)

  const fabricatedDigest = structuredClone(ready)
  fabricatedDigest.paperExecutionEvidence.evidenceArtifactDigestSha256 = 'd'.repeat(64)
  await writeFile(fixtureManifestPath, `${JSON.stringify(fabricatedDigest, null, 2)}\n`)
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /paper execution evidence artifact digest .* does not match the reviewed manifest/,
  )

  const fabricatedCounts = structuredClone(ready)
  fabricatedCounts.paperExecutionEvidence.filledOrders = 11
  await writeFile(fixtureManifestPath, `${JSON.stringify(fabricatedCounts, null, 2)}\n`)
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /paper execution evidence artifact filledOrders .* does not match the reviewed manifest/,
  )

  const fabricatedSlippage = structuredClone(ready)
  fabricatedSlippage.paperExecutionEvidence.p95AbsoluteSlippageBps = 19
  await writeFile(fixtureManifestPath, `${JSON.stringify(fabricatedSlippage, null, 2)}\n`)
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /paper execution evidence artifact p95AbsoluteSlippageBps .* does not match the reviewed manifest/,
  )

  const fabricatedUngSlippage = structuredClone(ready)
  fabricatedUngSlippage.paperExecutionEvidence.ungP95AbsoluteSlippageBps = 9
  await writeFile(fixtureManifestPath, `${JSON.stringify(fabricatedUngSlippage, null, 2)}\n`)
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /paper execution evidence artifact ungP95AbsoluteSlippageBps .* does not match the reviewed manifest/,
  )

  const fabricatedForwardDigest = structuredClone(ready)
  fabricatedForwardDigest.observedForwardEvidence.evidenceArtifactDigestSha256 = 'b'.repeat(64)
  await writeFile(fixtureManifestPath, `${JSON.stringify(fabricatedForwardDigest, null, 2)}\n`)
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /forward validation evidence artifact digest .* does not match the reviewed manifest/,
  )

  const fabricatedForwardCount = structuredClone(ready)
  fabricatedForwardCount.observedForwardEvidence.independentEpisodes = 61
  await writeFile(fixtureManifestPath, `${JSON.stringify(fabricatedForwardCount, null, 2)}\n`)
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /forward validation evidence artifact independentEpisodes .* does not match the reviewed manifest/,
  )

  await writeFile(fixtureManifestPath, `${JSON.stringify(ready, null, 2)}\n`)
  await chmod(evidenceFixtures.paths.paper, 0o644)
  assert.throws(
    () => loadValidationIntegrityManifest(process.cwd()),
    /paper execution evidence artifact: must not grant group or other filesystem permissions/,
  )
  await chmod(evidenceFixtures.paths.paper, 0o600)
} finally {
  await chmod(evidenceFixtures.paths.forward, 0o600)
  await chmod(evidenceFixtures.paths.paper, 0o600)
  await writeFile(fixtureManifestPath, `${JSON.stringify(ready, null, 2)}\n`)
  if (previousFixtureManifestOverride === undefined) delete process.env.QORE_VALIDATION_INTEGRITY_FILE
  else process.env.QORE_VALIDATION_INTEGRITY_FILE = previousFixtureManifestOverride
  if (previousFixtureNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousFixtureNodeEnv
  if (previousFixtureCapability === undefined) delete process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES
  else process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES = previousFixtureCapability
}

const previousNodeEnv = process.env.NODE_ENV
const previousCapability = process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES
const previousManifestOverride = process.env.QORE_VALIDATION_INTEGRITY_FILE
const previousArtifactOverride = process.env.QORE_LIVE_STRATEGY_ARTIFACT_FILE
try {
  process.env.NODE_ENV = 'test'
  delete process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES
  process.env.QORE_VALIDATION_INTEGRITY_FILE = '/tmp/qore-test-manifest.json'
  process.env.QORE_LIVE_STRATEGY_ARTIFACT_FILE = '/tmp/qore-test-artifact.json'
  assert.throws(() => resolveValidationIntegrityManifestPath(process.cwd()), /explicit reviewed-artifact test capability/)
  assert.throws(() => resolveAllYearStrategyArtifactPath(process.cwd()), /explicit reviewed-artifact test capability/)
  process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES = '1'
  assert.equal(resolveValidationIntegrityManifestPath(process.cwd()), '/tmp/qore-test-manifest.json')
  assert.equal(resolveAllYearStrategyArtifactPath(process.cwd()), '/tmp/qore-test-artifact.json')
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousNodeEnv
  if (previousCapability === undefined) delete process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES
  else process.env.QORE_TEST_REVIEWED_ARTIFACT_OVERRIDES = previousCapability
  if (previousManifestOverride === undefined) delete process.env.QORE_VALIDATION_INTEGRITY_FILE
  else process.env.QORE_VALIDATION_INTEGRITY_FILE = previousManifestOverride
  if (previousArtifactOverride === undefined) delete process.env.QORE_LIVE_STRATEGY_ARTIFACT_FILE
  else process.env.QORE_LIVE_STRATEGY_ARTIFACT_FILE = previousArtifactOverride
}

console.log('ok - validation integrity chronology, seals, and paper execution evidence fail closed')
await rm(fixtureDir, { recursive: true, force: true })
