#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  PRICE_EXHAUSTION_CANDIDATE_FAMILY,
  PRICE_EXHAUSTION_CANDIDATE_FAMILY_DIGEST_SHA256,
  PRICE_EXHAUSTION_EVALUATION_DIGEST_SHA256,
  PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
  PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID,
  PRICE_EXHAUSTION_SHADOW,
  PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256,
  buildPriorUngPriceExhaustionContext,
  evaluatePriceExhaustionShadow,
  priceExhaustionValueDigestSha256,
  validatePriceExhaustionImplementationManifest,
  validatePriceExhaustionShadow,
} from './lib/qore-price-exhaustion-shadow.mjs'

const repoRoot = process.cwd()

function fileDigest(relativePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(repoRoot, relativePath)))
    .digest('hex')
}

function sourceFiles(root) {
  const result = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (new Set(['.git', '.local', 'dist', 'node_modules']).has(entry.name)) continue
      result.push(...sourceFiles(entryPath))
    } else if (/\.(?:js|mjs|ts|tsx)$/.test(entry.name)) {
      result.push(entryPath)
    }
  }
  return result
}

assert.equal(validatePriceExhaustionShadow(), true)
assert.equal(PRICE_EXHAUSTION_SHADOW.executionEligible, false)
assert.equal(PRICE_EXHAUSTION_SHADOW.promotionEligible, false)
assert.equal(PRICE_EXHAUSTION_SHADOW.publicStrategy, false)
assert.equal(PRICE_EXHAUSTION_SHADOW.activeStrategyChanged, false)
assert.equal(PRICE_EXHAUSTION_SHADOW.prospectiveStart, null)
assert.equal(PRICE_EXHAUSTION_CANDIDATE_FAMILY.length, 48)
assert.equal(
  new Set(PRICE_EXHAUSTION_CANDIDATE_FAMILY.map(({ candidateId }) => candidateId)).size,
  48,
)
assert.deepEqual(
  [...new Set(PRICE_EXHAUSTION_CANDIDATE_FAMILY.map(({ lookbackSessions }) => lookbackSessions))],
  [2, 3, 5, 10],
)
assert.deepEqual(
  [...new Set(PRICE_EXHAUSTION_CANDIDATE_FAMILY.map(({ threshold }) => threshold))],
  [0.5, 1, 1.5, 2],
)
assert.deepEqual(
  [...new Set(PRICE_EXHAUSTION_CANDIDATE_FAMILY.map(({ exhaustedScale }) => exhaustedScale))],
  [0, 0.5, 0.75],
)
assert.ok(
  PRICE_EXHAUSTION_CANDIDATE_FAMILY.some(
    ({ candidateId }) => candidateId === PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID,
  ),
)
assert.equal(
  priceExhaustionValueDigestSha256(PRICE_EXHAUSTION_CANDIDATE_FAMILY),
  PRICE_EXHAUSTION_CANDIDATE_FAMILY_DIGEST_SHA256,
)
assert.equal(
  priceExhaustionValueDigestSha256(PRICE_EXHAUSTION_SHADOW),
  PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256,
)
assert.throws(
  () => validatePriceExhaustionShadow({ ungPriceDigestSha256: '0'.repeat(64) }),
  /no longer matches its bound inputs/,
)

const completedFixture = Array.from({ length: 20 }, (_, index) => ({
  date: `2024-01-${String(index + 1).padStart(2, '0')}`,
  returnPct: index % 2 === 0 ? 1 + index / 100 : -0.4 - index / 200,
}))
const targetSessionLeak = { date: '2024-02-01', returnPct: 100 }
const causalContext = buildPriorUngPriceExhaustionContext({
  priorCompletedReturns: completedFixture,
  tradeDate: '2024-02-01',
})
const contextWithTargetSessionPayload = buildPriorUngPriceExhaustionContext({
  priorCompletedReturns: [...completedFixture, targetSessionLeak],
  tradeDate: '2024-02-01',
})
assert.deepEqual(
  contextWithTargetSessionPayload,
  causalContext,
  'the target-session adjusted-close return must be excluded from the decision window',
)
assert.equal(causalContext.available, true)
assert.equal(causalContext.mostRecentCompletedSession, '2024-01-20')
assert.equal(causalContext.recentObservationCount, 5)
assert.equal(causalContext.volatilityObservationCount, 20)
assert.equal(buildPriorUngPriceExhaustionContext({
  priorCompletedReturns: completedFixture.slice(0, 4),
  tradeDate: '2024-02-01',
}).available, false)

const positiveBoundary = evaluatePriceExhaustionShadow({
  gasPosition: 0.35,
  priceContext: { available: true, z: 1 },
})
assert.equal(positiveBoundary.priceExhausted, false, 'positive equality must not trigger')
assert.equal(positiveBoundary.gasPosition, 0.35)
assert.equal(evaluatePriceExhaustionShadow({
  gasPosition: 0.35,
  priceContext: { available: true, z: 1.000001 },
}).gasPosition, 0)
const negativeBoundary = evaluatePriceExhaustionShadow({
  gasPosition: -0.35,
  priceContext: { available: true, z: -1 },
})
assert.equal(negativeBoundary.priceExhausted, false, 'negative equality must not trigger')
assert.equal(negativeBoundary.gasPosition, -0.35)
assert.equal(evaluatePriceExhaustionShadow({
  gasPosition: -0.35,
  priceContext: { available: true, z: -1.000001 },
}).gasPosition, 0)
assert.deepEqual(
  evaluatePriceExhaustionShadow({
    gasPosition: 0,
    priceContext: { available: false, reason: 'fixture' },
  }),
  {
    observationAvailable: false,
    priceExhausted: false,
    scale: 1,
    gasPosition: 0,
    investedIndexFraction: 1,
    reason: 'no-selected-gas-position',
  },
)
assert.equal(evaluatePriceExhaustionShadow({
  gasPosition: 0.35,
  priceContext: { available: false, reason: 'fixture-missing' },
}).reason, 'fixture-missing')

assert.equal(
  fileDigest(PRICE_EXHAUSTION_SHADOW.comparator.selectedTradesPath),
  PRICE_EXHAUSTION_SHADOW.comparator.selectedTradesDigestSha256,
)
assert.equal(
  fileDigest(PRICE_EXHAUSTION_SHADOW.comparator.runSummaryPath),
  PRICE_EXHAUSTION_SHADOW.comparator.runSummaryDigestSha256,
)
assert.equal(
  fileDigest(PRICE_EXHAUSTION_SHADOW.comparator.executionContractPath),
  PRICE_EXHAUSTION_SHADOW.comparator.executionContractDigestSha256,
)
assert.equal(
  fileDigest(PRICE_EXHAUSTION_SHADOW.priceContext.sourcePath),
  PRICE_EXHAUSTION_SHADOW.priceContext.sourceDigestSha256,
)
const implementationManifestPath = path.join(
  repoRoot,
  PRICE_EXHAUSTION_SHADOW.implementationSeal.manifestPath,
)
assert.equal(
  fileDigest(PRICE_EXHAUSTION_SHADOW.implementationSeal.manifestPath),
  PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
)
const implementationManifest = JSON.parse(fs.readFileSync(implementationManifestPath, 'utf8'))
assert.equal(validatePriceExhaustionImplementationManifest(
  implementationManifest,
  new Map(implementationManifest.files.map((file) => [
    file.path,
    fs.readFileSync(path.join(repoRoot, file.path)),
  ])),
), true)

const allowedShadowReferences = new Set([
  'scripts/evaluate-qore-price-exhaustion-shadow.mjs',
  'scripts/lib/qore-price-exhaustion-shadow.mjs',
  'scripts/test-qore-price-exhaustion-shadow.mjs',
])
const unexpectedShadowReferences = [
  ...sourceFiles(repoRoot),
].map((filePath) => path.relative(repoRoot, filePath))
  .filter((relativePath) => (
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
      .includes('qore-price-exhaustion-shadow')
    && !allowedShadowReferences.has(relativePath)
  ))
assert.deepEqual(
  unexpectedShadowReferences,
  [],
  'no repository runtime source may import or expose the price-exhaustion shadow',
)

const resultPath = path.join(
  repoRoot,
  'data/qore/research/price-exhaustion-shadow-audit.json',
)
assert.ok(fs.existsSync(resultPath), 'the versioned price-exhaustion audit must be generated')
const replayRelativePath = `.local/qore/research/price-exhaustion-shadow-test-${process.pid}.json`
const replayPath = path.join(repoRoot, replayRelativePath)
fs.mkdirSync(path.dirname(replayPath), { recursive: true })
try {
  execFileSync(process.execPath, [
    'scripts/evaluate-qore-price-exhaustion-shadow.mjs',
    `--output=${replayRelativePath}`,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.deepEqual(
    fs.readFileSync(replayPath),
    fs.readFileSync(resultPath),
    'the versioned price-exhaustion audit must byte-match a fresh deterministic replay',
  )
} finally {
  fs.rmSync(replayPath, { force: true })
}

const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
const { evaluationDigestSha256, ...resultWithoutDigest } = result
assert.equal(
  priceExhaustionValueDigestSha256(resultWithoutDigest),
  evaluationDigestSha256,
)
assert.equal(evaluationDigestSha256, PRICE_EXHAUSTION_EVALUATION_DIGEST_SHA256)
assert.equal(result.contractDigestSha256, PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256)
assert.equal(result.candidateFamilyDigestSha256, PRICE_EXHAUSTION_CANDIDATE_FAMILY_DIGEST_SHA256)
assert.equal(result.executionEligible, false)
assert.equal(result.promotionEligible, false)
assert.equal(result.publicStrategy, false)
assert.equal(result.activeStrategyChanged, false)
assert.equal(result.baselineTieOut.pass, true)
assert.equal(result.decision.prospectiveStart, null)
assert.equal(
  result.decision.prospectiveCollectionStatus,
  'blocked-no-trusted-writer-terminal-date-or-external-seal',
)
assert.match(result.decision.reasons.at(-1), /legacy active comparator is bound/)
assert.doesNotMatch(JSON.stringify(result.decision), /comparator fails/i)
assert.equal(result.selectedShadow.candidateId, PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID)
assert.equal(result.selectedShadow.focusedFamilyPromotionSelected, false)
assert.match(result.selectedShadow.status, /^retrospectively-discovered-/)
assert.equal(result.multipleTesting.focusedFamilyCandidateCount, 48)
assert.equal(result.multipleTesting.full48FamilyAdjustedCircularBlockBootstrap.length, 5)
assert.ok(result.multipleTesting.full48FamilyAdjustedCircularBlockBootstrap
  .every(({ candidateCount, iterations }) => candidateCount === 48 && iterations === 5_000))
assert.equal(result.multipleTesting.pboNonCalibratedDiagnostic.calibratedProbability, false)
assert.match(
  result.multipleTesting.pboNonCalibratedDiagnostic.interpretationWarning,
  /not a posterior probability/,
)
assert.equal(result.signalContract.targetSessionExcluded, true)
assert.equal(result.comparator.full.totalReturnPct, 293.019148)
assert.equal(result.selectedShadow.periods.full.totalReturnPct, 411.369778)
assert.equal(result.selectedShadow.periods.reportOnly2025.incrementalDailySumPct, -5.089917)
assert.equal(result.reportOnly2025Failure.verdict, 'failed')
assert.ok(result.reportOnly2025Failure.shadowTotalReturnPct
  < result.reportOnly2025Failure.comparatorTotalReturnPct)
assert.equal(result.episodeRobustness.fullCalendar.independentEpisodeCount, 22)
assert.equal(result.episodeRobustness.fullCalendar.positiveEpisodes, 18)
assert.equal(result.episodeRobustness.fullCalendar.negativeEpisodes, 4)
assert.equal(
  result.episodeRobustness.fullCalendar.incrementalSumAfterRemovingBestThreeEpisodesPct,
  11.810702,
)
assert.equal(result.reportOnly2025Failure.worstEpisode.startDate, '2025-02-18')
assert.equal(result.reportOnly2025Failure.worstEpisode.endDate, '2025-02-21')
assert.equal(result.reportOnly2025Failure.worstEpisode.incrementalDailySumPct, -5.318018)
assert.deepEqual(Object.keys(result.frictionScenarios), ['baseline', 'elevated', 'stress'])
assert.equal(result.frictionScenarios.baseline.shadow.totalReturnPct, 411.369778)
assert.equal(result.frictionScenarios.elevated.shadow.totalReturnPct, 394.093365)
assert.equal(result.frictionScenarios.stress.shadow.totalReturnPct, 335.907747)
assert.equal(
  result.temporalNegativeControl.periods.selectionPrefix.incrementalDailySumPct,
  -4.369504,
)
assert.equal(
  result.temporalNegativeControl.periods.full.incrementalDailySumPct,
  -5.858269,
)

console.log(
  `price exhaustion shadow passed contract=${PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256} episodes=${result.episodeRobustness.fullCalendar.independentEpisodeCount} familyBlock10P=${result.multipleTesting.full48FamilyAdjustedCircularBlockBootstrap.find(({ blockLength }) => blockLength === 10).pValue}`,
)
