#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  canonicalComponentLiveContractFromSummaries,
  executableLiveComponentContract,
  liveComponentContractDigestSha256,
  selectedContracts,
} from './lib/qore-live-contract.mjs'
import {
  inferAllYearTarget,
  inferSummerShadowTarget,
} from './lib/qore-live-all-year-inference.mjs'
import {
  SUMMER_SHADOW_CHALLENGER,
  SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256,
  appendSummerShadowTargetRecord,
  createSummerShadowTargetRecord,
  reversionMoveScale,
  summerShadowCompatibilityFailures,
  summerShadowCandidate,
  summerShadowMarketSessionStatus,
  summerShadowRecordTiming,
  validateSummerShadowTargetRecord,
} from './lib/qore-summer-shadow-challenger.mjs'

const repoDir = process.cwd()
const summerSummaryPath = path.join(
  repoDir,
  'data/qore/research/strategy-agent-runs/ngas-summer-alpha/run-summary.json',
)
const winterSummaryPath = path.join(
  repoDir,
  'data/qore/research/strategy-agent-runs/ngas-winter-alpha/run-summary.json',
)

const active = selectedContracts.summer
const challenger = summerShadowCandidate(active)
assert.equal(challenger.candidateId, SUMMER_SHADOW_CHALLENGER.challengerCandidateId)
assert.equal(challenger.minRealizedMovePct, 1.5)
assert.equal(challenger.reversionMoveScaleMode, 'linear-ramp')
assert.equal(challenger.reversionRampStartPct, 1.5)
assert.equal(challenger.reversionFullSizeMovePct, 2)
for (const [field, value] of Object.entries(active)) {
  if (['candidateId', 'minRealizedMovePct'].includes(field)) continue
  assert.deepEqual(challenger[field], value, `shadow candidate unexpectedly changes ${field}`)
}
assert.equal(reversionMoveScale(1.5, challenger), 0)
assert.equal(reversionMoveScale(1.75, challenger), 0.5)
assert.equal(reversionMoveScale(2, challenger), 1)
assert.equal(reversionMoveScale(4, challenger), 1)
assert.equal(reversionMoveScale(1.5, active), 1)
assert.equal(SUMMER_SHADOW_CHALLENGER.executionEligible, false)
assert.equal(SUMMER_SHADOW_CHALLENGER.publicStrategy, false)

const forecastRows = ['gfs', 'gefs-mean'].map((sourceId) => ({
  sourceId,
  sourceFamily: sourceId === 'gefs-mean' ? 'gefs' : 'gfs',
  sourceGroup: 'ncep',
  issueDate: '2026-07-10',
  targetDate: '2026-07-17',
  leadDays: 7,
  weightedAnomalyF: 10,
  coldCoveragePct: 0,
  coldExtremeCount: 0,
  warmCoveragePct: 0.8,
  warmExtremeCount: 2,
  coolingDemandAnomalyF: 10,
  heatingDemandAnomalyF: -10,
  sampledWeight: 1,
}))
const marketDays = [
  ['2026-07-10', 100],
  ['2026-07-13', 100.5],
  ['2026-07-14', 101],
  ['2026-07-15', 101.75],
  ['2026-07-16', 101.75],
  ['2026-07-17', 101.75],
].map(([date, gasClose]) => ({ date, gasClose }))
const storageRows = [{ date: '2021-01-01', storageBcf: 3000 }]
const activeTargetBefore = inferAllYearTarget({
  forecastRows,
  marketDays,
  storageRows,
  targetDate: '2026-07-16',
})
const shadowTarget = inferSummerShadowTarget({
  forecastRows,
  marketDays,
  storageRows,
  targetDate: '2026-07-16',
})
const activeTargetAfter = inferAllYearTarget({
  forecastRows,
  marketDays,
  storageRows,
  targetDate: '2026-07-16',
})
assert.deepEqual(activeTargetAfter, activeTargetBefore, 'shadow inference mutated the active inference path')
assert.equal(activeTargetBefore.gasPosition, 0)
assert.equal(shadowTarget.gasPosition, -0.25)
assert.equal(shadowTarget.realizedMovePct, 1.75)
assert.equal(shadowTarget.executionEligible, false)
assert.notEqual(shadowTarget.strategyId, 'ngas-all-year-beta')

const aprilForecastRows = forecastRows.map((row) => ({
  ...row,
  issueDate: '2026-04-24',
  targetDate: '2026-05-01',
}))
const aprilMarketDays = [
  ['2026-04-24', 100],
  ['2026-04-27', 100.5],
  ['2026-04-28', 101],
  ['2026-04-29', 101.75],
  ['2026-04-30', 101.75],
  ['2026-05-01', 101.75],
].map(([date, gasClose]) => ({ date, gasClose }))
const activeAprilTarget = inferAllYearTarget({
  forecastRows: aprilForecastRows,
  marketDays: aprilMarketDays,
  storageRows,
  targetDate: '2026-04-27',
})
const shadowAprilTarget = inferSummerShadowTarget({
  forecastRows: aprilForecastRows,
  marketDays: aprilMarketDays,
  storageRows,
  targetDate: '2026-04-27',
})
assert.notEqual(activeAprilTarget.gasPosition, 0, 'active Summer schedule must include April entries for May targets')
assert.equal(
  shadowAprilTarget.gasPosition,
  activeAprilTarget.gasPosition,
  'shadow Summer schedule must preserve the active contract at the April/May target-season boundary',
)

const summerSummary = JSON.parse(fs.readFileSync(summerSummaryPath, 'utf8'))
const winterSummary = JSON.parse(fs.readFileSync(winterSummaryPath, 'utf8'))
const embeddedShadow = summerSummary.researchOnly?.prospectiveShadowChallenger
assert.deepEqual(
  summerShadowCompatibilityFailures({
    activeComponentContract: executableLiveComponentContract.summer,
    embeddedShadow,
  }),
  [],
  'the checked-in Summer shadow contract must match its active comparator',
)
assert.match(
  summerShadowCompatibilityFailures({
    activeComponentContract: executableLiveComponentContract.summer,
    embeddedShadow: { ...embeddedShadow, role: 'execution-candidate' },
  }).join('; '),
  /does not match the current frozen contract/,
)
assert.match(
  summerShadowCompatibilityFailures({
    activeComponentContract: executableLiveComponentContract.summer,
    embeddedShadow: { ...embeddedShadow, contractDigestSha256: '0'.repeat(64) },
  }).join('; '),
  /digest is stale or malformed/,
)
assert.match(
  summerShadowCompatibilityFailures({
    activeComponentContract: {
      ...executableLiveComponentContract.summer,
      selected: { ...active, candidateId: 'obsolete-comparator' },
    },
    embeddedShadow,
  }).join('; '),
  /does not match the frozen comparator/,
)
assert.match(
  summerShadowCompatibilityFailures({
    activeComponentContract: {
      ...executableLiveComponentContract.summer,
      selected: { ...active, weatherFraction: 0.99 },
    },
    embeddedShadow,
  }).join('; '),
  /parameters do not match|component contract does not match/,
)
assert.match(
  summerShadowCompatibilityFailures({
    activeComponentContract: {
      ...executableLiveComponentContract.summer,
      implementation: {
        ...executableLiveComponentContract.summer.implementation,
        storageDeficitHeatMultiplier: 9,
      },
    },
    embeddedShadow,
  }).join('; '),
  /component contract does not match/,
)
const componentDigestBefore = liveComponentContractDigestSha256(
  canonicalComponentLiveContractFromSummaries(summerSummary, winterSummary),
)
const summaryWithShadow = structuredClone(summerSummary)
summaryWithShadow.researchOnly = {
  prospectiveShadowChallenger: {
    ...SUMMER_SHADOW_CHALLENGER,
    contractDigestSha256: SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256,
  },
}
const componentDigestAfter = liveComponentContractDigestSha256(
  canonicalComponentLiveContractFromSummaries(summaryWithShadow, winterSummary),
)
assert.equal(componentDigestAfter, componentDigestBefore, 'research-only shadow metadata changed the live component digest')

assert.deepEqual(
  summerShadowRecordTiming({ targetDate: '2026-07-23', generatedAt: '2026-07-23T12:00:00.000Z' }),
  { eligible: true, reason: null },
)
assert.deepEqual(
  summerShadowRecordTiming({ targetDate: '2027-04-27', generatedAt: '2027-04-27T12:00:00.000Z' }),
  { eligible: true, reason: null },
)
assert.equal(
  summerShadowRecordTiming({ targetDate: '2026-07-23', generatedAt: '2026-07-23T13:30:00.000Z' }).reason,
  'at-or-after-session-open',
)
assert.equal(
  summerShadowRecordTiming({ targetDate: '2026-07-22', generatedAt: '2026-07-22T12:00:00.000Z' }).reason,
  'before-prospective-start',
)
assert.deepEqual(
  summerShadowMarketSessionStatus('2026-07-25'),
  { session: false, reason: 'not-us-equity-market-session' },
)
assert.deepEqual(
  summerShadowMarketSessionStatus('2026-07-26'),
  { session: false, reason: 'not-us-equity-market-session' },
)
assert.deepEqual(
  summerShadowMarketSessionStatus('2026-02-30'),
  { session: false, reason: 'invalid-target-date' },
)
for (const holiday of ['2027-06-18', '2027-07-05', '2027-12-24']) {
  assert.equal(summerShadowMarketSessionStatus(holiday).reason, 'not-us-equity-market-session')
}
for (const sessionDate of ['2027-12-31', '2026-11-27', '2026-12-24', '2028-07-03', '2028-02-29']) {
  assert.deepEqual(summerShadowMarketSessionStatus(sessionDate), { session: true, reason: null })
}
assert.equal(
  summerShadowRecordTiming({ targetDate: '2026-11-26', generatedAt: '2026-11-26T12:00:00.000Z' }).reason,
  'not-us-equity-market-session',
)
assert.equal(
  summerShadowRecordTiming({ targetDate: '2029-01-02', generatedAt: '2029-01-02T12:00:00.000Z' }).reason,
  'unreviewed-session-calendar-year',
)
assert.deepEqual(
  summerShadowRecordTiming({ targetDate: '2026-07-23', generatedAt: '2026-07-23T13:29:00.000Z' }),
  { eligible: true, reason: null },
)
assert.equal(
  summerShadowRecordTiming({ targetDate: '2026-07-23', generatedAt: '2026-07-23T13:30:00.000Z' }).reason,
  'at-or-after-session-open',
)
assert.equal(
  summerShadowRecordTiming({ targetDate: '2026-11-27', generatedAt: '2026-11-27T14:30:00.000Z' }).reason,
  'outside-summer-comparator-schedule',
)

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'qore-summer-shadow-'))
try {
  const projectedTarget = ({ targetDate, shadow = false }) => ({
    strategyId: shadow ? 'ngas-summer-shadow-challenger' : 'ngas-all-year-beta',
    componentStrategyId: 'index-fallback',
    candidateId: shadow ? SUMMER_SHADOW_CHALLENGER.challengerCandidateId : null,
    executionEligible: shadow ? false : true,
    targetDate,
    direction: 'flat',
    gasPosition: 0,
    indexFraction: 1,
    cashFraction: 0,
    signalDate: targetDate,
    confidence: 0,
    windowId: 'index-fallback',
    thesisKind: 'index-fallback',
  })
  const inputProvenance = {
    forecastRowsDigestSha256: 'c'.repeat(64),
    marketDaysDigestSha256: 'd'.repeat(64),
    storageRowsDigestSha256: 'e'.repeat(64),
    forecastValidation: { fixture: true },
    marketValidation: { fixture: true },
    storageValidation: { fixture: true },
  }
  const record = createSummerShadowTargetRecord({
    generatedAt: '2026-07-23T12:00:00.000Z',
    targetDate: '2026-07-23',
    activeStrategyContractDigestSha256: 'a'.repeat(64),
    activeStrategyArtifactDigestSha256: 'b'.repeat(64),
    activeTarget: projectedTarget({ targetDate: '2026-07-23' }),
    shadowTarget: projectedTarget({ targetDate: '2026-07-23', shadow: true }),
    inputProvenance,
  })
  assert.equal(validateSummerShadowTargetRecord(record), true)
  assert.throws(
    () => validateSummerShadowTargetRecord({
      ...record,
      shadowTarget: { ...record.shadowTarget, executionEligible: true },
    }),
    /explicitly execution-ineligible/,
  )
  assert.throws(
    () => validateSummerShadowTargetRecord({
      ...record,
      shadowTarget: { ...record.shadowTarget, targetDate: '2026-07-24' },
    }),
    /targetDate must match/,
  )
  assert.throws(
    () => validateSummerShadowTargetRecord({
      ...record,
      shadowTarget: { ...record.shadowTarget, candidateId: 'obsolete-challenger' },
    }),
    /candidateId is invalid/,
  )
  assert.throws(
    () => validateSummerShadowTargetRecord({
      ...record,
      activeTarget: { ...record.activeTarget, indexFraction: 0.5 },
    }),
    /allocations must sum to one/,
  )
  assert.throws(
    () => validateSummerShadowTargetRecord({ ...record, inputProvenance: null }),
    /inputProvenance must be an object/,
  )
  const first = await appendSummerShadowTargetRecord({ stateDir: temporaryRoot, record })
  assert.equal(first.written, true)
  const originalBytes = await readFile(first.filePath)
  const fileStat = await stat(first.filePath)
  assert.equal(fileStat.isFile(), true)
  assert.equal(fileStat.mode & 0o077, 0, 'shadow evidence must not grant group or other permissions')

  const changedRecord = { ...record, generatedAt: '2026-07-23T12:01:00.000Z' }
  const second = await appendSummerShadowTargetRecord({ stateDir: temporaryRoot, record: changedRecord })
  assert.deepEqual(
    { written: second.written, reason: second.reason },
    { written: false, reason: 'already-recorded' },
  )
  assert.deepEqual(await readFile(first.filePath), originalBytes, 'a repeated run overwrote the first shadow record')

  const lateRecord = {
    ...record,
    targetDate: '2026-07-24',
    generatedAt: '2026-07-24T13:30:00.000Z',
    activeTarget: projectedTarget({ targetDate: '2026-07-24' }),
    shadowTarget: projectedTarget({ targetDate: '2026-07-24', shadow: true }),
  }
  const late = await appendSummerShadowTargetRecord({ stateDir: temporaryRoot, record: lateRecord })
  assert.deepEqual(
    { written: late.written, reason: late.reason },
    { written: false, reason: 'at-or-after-session-open' },
  )

  const holidayRecord = {
    ...record,
    targetDate: '2026-11-26',
    generatedAt: '2026-11-26T12:00:00.000Z',
    activeTarget: projectedTarget({ targetDate: '2026-11-26' }),
    shadowTarget: projectedTarget({ targetDate: '2026-11-26', shadow: true }),
  }
  const holiday = await appendSummerShadowTargetRecord({ stateDir: temporaryRoot, record: holidayRecord })
  assert.deepEqual(
    { written: holiday.written, reason: holiday.reason },
    { written: false, reason: 'not-us-equity-market-session' },
  )
  assert.equal(
    fs.existsSync(path.join(temporaryRoot, '2026-11-26.json')),
    false,
    'holiday shadow evidence must not be created',
  )
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log(
  `summer shadow challenger passed digest=${SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256} activeGas=${activeTargetBefore.gasPosition} shadowGas=${shadowTarget.gasPosition}`,
)
