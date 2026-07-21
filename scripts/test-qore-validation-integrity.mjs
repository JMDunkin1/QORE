#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadReviewedBrokerExecutionProfile } from './lib/qore-broker-execution-profile.mjs'
import { resolveAllYearStrategyArtifactPath } from './lib/qore-live-strategy-artifact.mjs'
import {
  forwardInferenceDigestSha256,
  reviewedNyseSessionStatus,
  verifyValidationEvidenceArtifacts,
} from './lib/qore-validation-evidence.mjs'
import { writeValidationEvidenceTestFixtures } from './lib/qore-validation-evidence-test-fixture.mjs'
import {
  VALIDATION_INTEGRITY_MANIFEST_ID,
  VALIDATION_INTEGRITY_SCHEMA_VERSION,
  VALIDATION_INTEGRITY_STRATEGY_ID,
  loadValidationIntegrityManifest,
  paperExecutionEvidenceSatisfied,
  resolveValidationIntegrityManifestPath,
  validationIntegrityBinding,
  validateValidationIntegrityManifest,
} from './lib/qore-validation-integrity.mjs'

const sealedDigest = 'a'.repeat(64)
const strategyArtifactDigestSha256 = 'b'.repeat(64)
const brokerExecutionProfileDigestSha256 = loadReviewedBrokerExecutionProfile(process.cwd()).profileDigestSha256
const fixtureDir = await mkdtemp(path.join(tmpdir(), 'qore-validation-integrity-test-'))
const fixtureManifestPath = path.join(fixtureDir, 'reviewed-validation-integrity.json')
const accountPseudonymSha256 = 'c'.repeat(64)
const evidenceFixtures = await writeValidationEvidenceTestFixtures({
  repoDir: process.cwd(),
  manifestPath: fixtureManifestPath,
  strategyContractDigestSha256: sealedDigest,
  strategyArtifactDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  submittedOrderCount: 12,
})

async function writeProtectedArtifact(filePath, artifact) {
  const raw = `${JSON.stringify(artifact, null, 2)}\n`
  await writeFile(filePath, raw, { mode: 0o600 })
  await chmod(filePath, 0o600)
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function emptyManifest() {
  return {
    schemaVersion: VALIDATION_INTEGRITY_SCHEMA_VERSION,
    manifestId: VALIDATION_INTEGRITY_MANIFEST_ID,
    strategyId: VALIDATION_INTEGRITY_STRATEGY_ID,
    reviewedAt: '2026-07-21T00:00:00.000Z',
    sealedStrategyContractDigestSha256: sealedDigest,
    sealedStrategyArtifactDigestSha256: null,
    sealedBrokerExecutionProfileDigestSha256: brokerExecutionProfileDigestSha256,
    historicalEvidence: {
      status: 'development-contaminated',
      evidenceStart: '2021-01-01',
      developmentBegan: '2026-06-11',
      observedThrough: '2026-07-14',
      prospectiveStart: '2026-07-22',
      pristineForwardEvidence: false,
    },
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
      evidenceArtifactDigestSha256: null,
      reviewedAt: null,
    },
    minimumPaperExecutionEvidence: {
      tradingSessions: 60,
      filledOrders: 10,
      ungFilledOrders: 4,
      ungLongFilledOrders: 2,
      ungShortFilledOrders: 2,
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
      ungFilledOrders: 0,
      ungLongFilledOrders: 0,
      ungShortFilledOrders: 0,
      medianAbsoluteSlippageBps: null,
      p95AbsoluteSlippageBps: null,
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
}

function promotionReadyManifest() {
  const manifest = emptyManifest()
  manifest.reviewedAt = '2025-10-02T00:00:00.000Z'
  manifest.historicalEvidence = {
    ...manifest.historicalEvidence,
    evidenceStart: '2020-01-01',
    developmentBegan: '2022-06-11',
    observedThrough: '2022-12-15',
    prospectiveStart: '2023-01-01',
  }
  manifest.historicalEvidence.pristineForwardEvidence = true
  manifest.sealedStrategyArtifactDigestSha256 = strategyArtifactDigestSha256
  manifest.observedForwardEvidence = {
    ...evidenceFixtures.forwardSummary,
    evidenceArtifactDigestSha256: evidenceFixtures.forwardEvidenceArtifactDigestSha256,
    reviewedAt: '2025-10-01T00:00:00.000Z',
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

const empty = emptyManifest()
assert.deepEqual(validateValidationIntegrityManifest(empty), [])
assert.equal(paperExecutionEvidenceSatisfied(empty), false)
assert.deepEqual(
  reviewedNyseSessionStatus('2025-01-09'),
  { session: false, reason: 'nyse-full-day-closure' },
)

const ready = promotionReadyManifest()
assert.deepEqual(validateValidationIntegrityManifest(ready), [])
const evidenceVerification = verifyValidationEvidenceArtifacts(process.cwd(), fixtureManifestPath, ready)
assert.deepEqual(evidenceVerification.failures, [])
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

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations[0]
    observation.sessionDate = '2023-01-07'
    observation.recordedAt = '2023-01-07T12:00:00.000Z'
    observation.inference.generatedAt = '2023-01-07T11:59:00.000Z'
    observation.inference.targetDate = '2023-01-07'
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
  }, /sessionDate must be a reviewed NYSE session \(nyse-weekend\)/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    artifact.observations = artifact.observations.filter(({ sessionDate }) => sessionDate !== '2023-05-01')
  }, /completeSummerSeasons .* does not match the reviewed manifest/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const episodes = artifact.observations.filter(({ independentEpisode }) => independentEpisode)
    episodes[0].independentEpisode.observationWindowEnd = episodes[1].independentEpisode.forecastWindowStart
  }, /independentEpisode overlaps the preceding forecast\/observation episode window/)

  await assertMutatedArtifactFails('forward', (artifact) => {
    const observation = artifact.observations[0]
    observation.inference.gasPosition = 0.75
    observation.inference.indexFraction = 0.75
    observation.inferenceDigestSha256 = forwardInferenceDigestSha256(observation.inference)
  }, /inference allocations must sum to one using absolute gas exposure/)

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
