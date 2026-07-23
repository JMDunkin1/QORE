#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  STORAGE_CONTRADICTION_CANDIDATE_FAMILY,
  STORAGE_CONTRADICTION_CANDIDATE_FAMILY_DIGEST_SHA256,
  STORAGE_CONTRADICTION_EVALUATION_DIGEST_SHA256,
  STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
  STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID,
  STORAGE_CONTRADICTION_SHADOW,
  STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256,
  buildCausalStorageContext,
  buildNearestPeriodStorageContext,
  evaluateStorageContradictionShadow,
  storageContradictionValueDigestSha256,
  storageSeasonalWeek,
  validateStorageContradictionImplementationManifest,
  validateStorageContradictionShadow,
} from './lib/qore-storage-contradiction-shadow.mjs'

const repoRoot = process.cwd()

function sourceFiles(root) {
  const result = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      result.push(...sourceFiles(entryPath))
    } else if (/\.(?:js|mjs|ts|tsx)$/.test(entry.name)) {
      result.push(entryPath)
    }
  }
  return result
}

function fileDigest(relativePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(repoRoot, relativePath)))
    .digest('hex')
}

assert.equal(validateStorageContradictionShadow(), true)
assert.equal(STORAGE_CONTRADICTION_SHADOW.executionEligible, false)
assert.equal(STORAGE_CONTRADICTION_SHADOW.promotionEligible, false)
assert.equal(STORAGE_CONTRADICTION_SHADOW.publicStrategy, false)
assert.equal(STORAGE_CONTRADICTION_CANDIDATE_FAMILY.length, 60)
assert.equal(
  new Set(STORAGE_CONTRADICTION_CANDIDATE_FAMILY.map(({ candidateId }) => candidateId)).size,
  60,
)
assert.ok(
  STORAGE_CONTRADICTION_CANDIDATE_FAMILY.some(
    ({ candidateId }) => candidateId === STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID,
  ),
)
assert.equal(
  storageContradictionValueDigestSha256(STORAGE_CONTRADICTION_CANDIDATE_FAMILY),
  STORAGE_CONTRADICTION_CANDIDATE_FAMILY_DIGEST_SHA256,
)
assert.equal(
  storageContradictionValueDigestSha256(STORAGE_CONTRADICTION_SHADOW),
  STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256,
)
assert.throws(
  () => validateStorageContradictionShadow({ selectedTradesDigestSha256: '0'.repeat(64) }),
  /no longer matches its sealed active inputs/,
)

const positiveBoundary = evaluateStorageContradictionShadow({
  gasPosition: 0.35,
  storageContext: { available: true, storageDeviationPct: 10 },
})
assert.equal(positiveBoundary.contradicted, false, 'positive equality must not trigger a strict veto')
assert.equal(positiveBoundary.gasPosition, 0.35)
assert.equal(evaluateStorageContradictionShadow({
  gasPosition: 0.35,
  storageContext: { available: true, storageDeviationPct: 10.000001 },
}).gasPosition, 0)

const negativeBoundary = evaluateStorageContradictionShadow({
  gasPosition: -0.35,
  storageContext: { available: true, storageDeviationPct: -10 },
})
assert.equal(negativeBoundary.contradicted, false, 'negative equality must not trigger a strict veto')
assert.equal(negativeBoundary.gasPosition, -0.35)
assert.equal(evaluateStorageContradictionShadow({
  gasPosition: -0.35,
  storageContext: { available: true, storageDeviationPct: -10.000001 },
}).gasPosition, 0)
assert.deepEqual(
  evaluateStorageContradictionShadow({
    gasPosition: 0,
    storageContext: { available: false, reason: 'fixture' },
  }),
  {
    observationAvailable: false,
    contradicted: false,
    scale: 1,
    gasPosition: 0,
    investedIndexFraction: 1,
    reason: 'no-selected-gas-position',
  },
)
assert.equal(evaluateStorageContradictionShadow({
  gasPosition: 0.35,
  storageContext: { available: false, reason: 'fixture-missing' },
}).reason, 'fixture-missing')

const storageFixture = Array.from({ length: 7 }, (_, offset) => {
  const year = 2017 + offset
  const date = `${year}-01-05`
  return {
    date,
    storageBcf: 3000 + offset * 50,
    releasedAt: year === 2023
      ? '2024-01-11T15:30:00.000Z'
      : `${year}-01-12T15:30:00.000Z`,
  }
})
const causalContext = buildCausalStorageContext(storageFixture, '2024-01-11')
assert.equal(causalContext.available, true)
assert.equal(causalContext.storageDate, '2022-01-05')
assert.equal(causalContext.peerCount, 5)
assert.ok(!causalContext.peerDates.includes('2023-01-05'))
assert.equal(storageSeasonalWeek('2024-01-01'), 0)
assert.equal(storageSeasonalWeek('2024-01-08'), 1)
assert.throws(() => storageSeasonalWeek('2024-02-31'), /Invalid storage date/)
assert.equal(buildCausalStorageContext(storageFixture.slice(-3), '2024-01-11').available, false)
assert.equal(buildNearestPeriodStorageContext(storageFixture, '2024-01-11').available, true)

assert.equal(
  fileDigest(STORAGE_CONTRADICTION_SHADOW.comparator.selectedTradesPath),
  STORAGE_CONTRADICTION_SHADOW.comparator.selectedTradesDigestSha256,
)
assert.equal(
  fileDigest(STORAGE_CONTRADICTION_SHADOW.comparator.executionContractPath),
  STORAGE_CONTRADICTION_SHADOW.comparator.executionContractDigestSha256,
)
const implementationManifestPath = path.join(
  repoRoot,
  STORAGE_CONTRADICTION_SHADOW.implementationSeal.manifestPath,
)
assert.equal(
  fileDigest(STORAGE_CONTRADICTION_SHADOW.implementationSeal.manifestPath),
  STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
)
const implementationManifest = JSON.parse(fs.readFileSync(implementationManifestPath, 'utf8'))
assert.equal(validateStorageContradictionImplementationManifest(
  implementationManifest,
  new Map(implementationManifest.files.map((file) => [
    file.path,
    fs.readFileSync(path.join(repoRoot, file.path)),
  ])),
), true)
const allowedShadowReferences = new Set([
  'scripts/evaluate-qore-storage-contradiction-shadow.mjs',
  'scripts/lib/qore-storage-contradiction-shadow.mjs',
  'scripts/test-qore-storage-contradiction-shadow.mjs',
])
const unexpectedShadowReferences = [
  ...sourceFiles(path.join(repoRoot, 'scripts')),
  ...sourceFiles(path.join(repoRoot, 'src')),
].map((filePath) => path.relative(repoRoot, filePath))
  .filter((relativePath) => (
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
      .includes('qore-storage-contradiction-shadow')
    && !allowedShadowReferences.has(relativePath)
  ))
assert.deepEqual(
  unexpectedShadowReferences,
  [],
  'no repository runtime source may import or expose the storage-contradiction shadow',
)

const resultPath = path.join(
  repoRoot,
  'data/qore/research/storage-contradiction-shadow-audit.json',
)
assert.ok(fs.existsSync(resultPath), 'the versioned storage-contradiction audit must be generated')
const replayRelativePath = `.local/qore/research/storage-contradiction-shadow-test-${process.pid}.json`
const replayPath = path.join(repoRoot, replayRelativePath)
fs.mkdirSync(path.dirname(replayPath), { recursive: true })
try {
  execFileSync(process.execPath, [
    'scripts/evaluate-qore-storage-contradiction-shadow.mjs',
    `--output=${replayRelativePath}`,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.deepEqual(
    fs.readFileSync(replayPath),
    fs.readFileSync(resultPath),
    'the versioned storage-contradiction audit must byte-match a fresh deterministic replay',
  )
} finally {
  fs.rmSync(replayPath, { force: true })
}
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
const { evaluationDigestSha256, ...resultWithoutDigest } = result
assert.equal(
  storageContradictionValueDigestSha256(resultWithoutDigest),
  evaluationDigestSha256,
)
assert.equal(evaluationDigestSha256, STORAGE_CONTRADICTION_EVALUATION_DIGEST_SHA256)
assert.equal(result.contractDigestSha256, STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256)
assert.equal(result.candidateFamilyDigestSha256, STORAGE_CONTRADICTION_CANDIDATE_FAMILY_DIGEST_SHA256)
assert.equal(result.executionEligible, false)
assert.equal(result.promotionEligible, false)
assert.equal(result.activeStrategyChanged, false)
assert.equal(result.baselineTieOut.pass, true)
assert.equal(result.multipleTesting.familyCandidateCount, 60)
assert.match(result.multipleTesting.scopeCaveat, /unversioned original 327 other overlays, a later unversioned 480-row cross-market pass/)
assert.equal(result.decision.prospectiveStart, null)
assert.equal(
  result.decision.prospectiveCollectionStatus,
  'blocked-no-trusted-writer-terminal-date-or-external-seal',
)
assert.deepEqual(
  result.decision.reasons.slice(-1),
  ['No trusted pre-open writer, external chronology anchor, or outcome-independent terminal evaluation date exists.'],
)
assert.equal(result.selectedShadow.candidateId, STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID)
assert.equal(result.selectedShadow.tiedSelectionWinnerIds.length, 2)
assert.equal(result.comparator.full.totalReturnPct, 293.019148)
assert.equal(result.selectedShadow.periods.full.totalReturnPct, 354.764347)
assert.equal(result.selectedShadow.periods.reportOnly2025.incrementalDailySumPct, -3.58241)
assert.equal(result.episodeRobustness.selectionPrefix.independentEpisodeCount, 12)
assert.ok(
  Object.values(result.episodeRobustness.selectionPrefix.episodesByComponent)
    .every((count) => count < 15),
)
assert.equal(result.episodeRobustness.fullCalendar.independentEpisodeCount, 13)
assert.equal(result.episodeRobustness.fullCalendar.positiveEpisodes, 8)
assert.equal(result.episodeRobustness.fullCalendar.negativeEpisodes, 5)
assert.equal(
  result.episodeRobustness.fullCalendar.incrementalSumAfterRemovingBestThreeEpisodesPct,
  -0.285271,
)
assert.equal(result.storageAvailability.unavailableSessions, 5)
assert.equal(result.seasonalDefinitionSensitivity.alternativeDefinitionAvailability.unavailableSessions, 0)
assert.equal(
  result.seasonalDefinitionSensitivity.alternativeSelectedShadowPeriods.full.totalReturnPct,
  342.746057,
)
assert.equal(result.frictionScenarios.baseline.shadow.totalReturnPct, 354.764347)
assert.equal(result.frictionScenarios.elevated.shadow.totalReturnPct, 341.991776)
assert.equal(result.frictionScenarios.stress.shadow.totalReturnPct, 297.696848)
assert.match(STORAGE_CONTRADICTION_SHADOW.storageContext.valueVintagePolicy, /current checked-in EIA/)
assert.equal(
  result.inputBindings.implementationManifest.digestSha256,
  STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
)
for (const binding of [result.inputBindings.storage, result.inputBindings.releaseCalendar]) {
  assert.equal(fileDigest(binding.path), binding.digestSha256)
}
const familyBlock10 = result.multipleTesting.familyAdjustedCircularBlockBootstrap
  .find(({ blockLength }) => blockLength === 10)
assert.ok(
  result.multipleTesting.familyAdjustedCircularBlockBootstrap
    .every(({ iterations }) => iterations === 10_000),
)
assert.ok(
  result.multipleTesting.fixedSelectedCandidateCircularBlockBootstrap
    .every(({ iterations }) => iterations === 10_000),
)
assert.equal(familyBlock10.pValue, 0.160884)

console.log(
  `storage contradiction shadow passed contract=${STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256} episodes=${result.episodeRobustness.fullCalendar.independentEpisodeCount} familyBlock10P=${familyBlock10.pValue}`,
)
