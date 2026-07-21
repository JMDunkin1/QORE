#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  LIVE_TARGET_PARITY_POLICY,
  assessLiveTargetParity,
  evaluateVersionedLiveTargetParity,
} from './lib/qore-live-target-parity.mjs'
import {
  liveTargetParityFailures,
  loadAllYearStrategyArtifact,
} from './lib/qore-live-strategy-artifact.mjs'

const passing = assessLiveTargetParity({
  expectedRows: [
    {
      entryTradeDate: '2025-01-02',
      ungPosition: '-0.25',
      indexFraction: '0.75',
      thesisKind: 'warm-short',
    },
    {
      entryTradeDate: '2025-01-03',
      ungPosition: '0',
      indexFraction: '1',
      thesisKind: 'index-fallback',
    },
  ],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  inferTarget: ({ targetDate }) => targetDate === '2025-01-02'
    ? { gasPosition: -0.2509, indexFraction: 0.7491, thesisKind: 'warm-short' }
    : { gasPosition: 0, indexFraction: 1, thesisKind: 'index-fallback' },
})
assert.equal(passing.exactTargetParity, true)
assert.equal(passing.mismatchCount, 0)

const failing = assessLiveTargetParity({
  expectedRows: [{
    entryTradeDate: '2025-01-02',
    ungPosition: '0',
    indexFraction: '1',
    thesisKind: 'index-fallback',
  }],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  inferTarget: () => ({
    gasPosition: -0.2517,
    indexFraction: 0.7483,
    thesisKind: 'reversion-short',
  }),
})
assert.equal(failing.exactTargetParity, false)
assert.equal(failing.gasPositionMismatchCount, 1)
assert.equal(failing.indexFractionMismatchCount, 1)
assert.equal(failing.thesisKindMismatchCount, 1)

const allocationFailing = assessLiveTargetParity({
  expectedRows: [{
    entryTradeDate: '2025-01-02',
    ungPosition: '-0.25',
    indexFraction: '0.75',
    thesisKind: 'warm-short',
  }],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  inferTarget: () => ({ gasPosition: -0.25, indexFraction: 0.7, thesisKind: 'warm-short' }),
})
assert.equal(allocationFailing.exactTargetParity, false)
assert.equal(allocationFailing.gasPositionMismatchCount, 0)
assert.equal(allocationFailing.indexFractionMismatchCount, 1)
assert.equal(allocationFailing.thesisKindMismatchCount, 0)

const versioned = evaluateVersionedLiveTargetParity(process.cwd())
assert.equal(versioned.schemaVersion, LIVE_TARGET_PARITY_POLICY.schemaVersion)
assert.equal(versioned.status, 'fail')
assert.equal(versioned.exactTargetParity, false)
assert.equal(versioned.comparedRowCount, 1947)
assert.equal(versioned.matchedRowCount, 1932)
assert.equal(versioned.mismatchCount, 15)
assert.equal(versioned.gasPositionMismatchCount, 15)
assert.equal(versioned.indexFractionMismatchCount, 15)
assert.equal(versioned.thesisKindMismatchCount, 10)
assert.deepEqual(versioned.productionForecastSourceIds.summer, ['gfs', 'gefs-mean'])
assert.deepEqual(versioned.productionForecastSourceIds.winter, [
  'gfs',
  'gefs-mean',
  'ecmwf-ifs',
  'ecmwf-aifs',
  'aigfs',
])
assert.equal(versioned.components.summer.status, 'pass')
assert.equal(versioned.components.summer.exactTargetParity, true)
assert.equal(versioned.components.summer.comparedRowCount, 585)
assert.equal(versioned.components.summer.matchedRowCount, 585)
assert.equal(versioned.components.summer.mismatchCount, 0)
assert.equal(versioned.components.summer.forecastRowCount, 1516)
assert.deepEqual(versioned.components.summer.productionForecastSourceIds, ['gfs', 'gefs-mean'])
assert.match(
  versioned.components.summer.inputFiles.forecastCalendars.join(';'),
  /2021-05-01-2025-09-30-leads-7-hours-0/,
)
assert.equal(versioned.components.winter.status, 'fail')
assert.equal(versioned.components.winter.exactTargetParity, false)
assert.equal(versioned.components.winter.comparedRowCount, 1362)
assert.equal(versioned.components.winter.matchedRowCount, 1347)
assert.equal(versioned.components.winter.mismatchCount, 15)
assert.deepEqual(
  versioned.components.winter.mismatches.map((row) => row.targetDate),
  [
    '2024-11-22',
    '2024-11-25',
    '2024-11-26',
    '2024-11-29',
    '2024-12-16',
    '2024-12-17',
    '2025-11-17',
    '2025-11-24',
    '2026-01-20',
    '2026-01-21',
    '2026-01-22',
    '2026-01-23',
    '2026-01-26',
    '2026-01-27',
    '2026-02-02',
  ],
)
assert.deepEqual(
  versioned.components.winter.mismatches.find((row) => row.targetDate === '2024-11-25'),
  {
    targetDate: '2024-11-25',
    expectedGasPosition: 0,
    replayGasPosition: -0.2517,
    gasPositionDifference: -0.2517,
    expectedIndexFraction: 1,
    replayIndexFraction: 0.7483,
    indexFractionDifference: -0.2517,
    expectedThesisKind: 'index-fallback',
    replayThesisKind: 'reversion-short',
    gasPositionMatches: false,
    indexFractionMatches: false,
    thesisKindMatches: false,
    matches: false,
  },
)
assert.deepEqual(
  versioned.components.winter.mismatches.find((row) => row.targetDate === '2025-11-24'),
  {
    targetDate: '2025-11-24',
    expectedGasPosition: -0.4681,
    replayGasPosition: 0,
    gasPositionDifference: 0.4681,
    expectedIndexFraction: 0.5319,
    replayIndexFraction: 1,
    indexFractionDifference: 0.4681,
    expectedThesisKind: 'warm-short',
    replayThesisKind: 'index-fallback',
    gasPositionMatches: false,
    indexFractionMatches: false,
    thesisKindMatches: false,
    matches: false,
  },
)

const paritySummary = {
  contract: { liveTargetParity: structuredClone(LIVE_TARGET_PARITY_POLICY) },
  validation: {
    liveTargetParity: structuredClone(versioned),
    promotionGates: { liveTargetParity: versioned.exactTargetParity },
  },
}
assert.deepEqual(liveTargetParityFailures(paritySummary, versioned), [])
for (const [field, mutate, expectedFailure] of [
  [
    'componentStrategyIds',
    (report) => { report.componentStrategyIds = ['ngas-summer-alpha'] },
    /componentStrategyIds does not match the executable parity policy/,
  ],
  [
    'indexFractionTolerance',
    (report) => { report.indexFractionTolerance = 0.5 },
    /indexFractionTolerance does not match the executable parity policy/,
  ],
  [
    'indexFractionMismatchCount',
    (report) => { report.indexFractionMismatchCount += 1 },
    /indexFractionMismatchCount does not match the current deterministic replay/,
  ],
  [
    'components',
    (report) => { report.components.summer.forecastRowCount += 1 },
    /components does not match the current deterministic replay/,
  ],
  [
    'inputFiles',
    (report) => { report.inputFiles.storage = 'another-storage-input.csv' },
    /inputFiles does not match the current deterministic replay/,
  ],
]) {
  const tampered = structuredClone(paritySummary)
  mutate(tampered.validation.liveTargetParity)
  assert.match(
    liveTargetParityFailures(tampered, versioned).join('; '),
    expectedFailure,
    `${field} tampering must fail artifact parity verification`,
  )
}

const artifact = loadAllYearStrategyArtifact(process.cwd())
assert.equal(artifact.binding.paperEligible, false)
assert.match(artifact.paperEligibilityFailures.join('; '), /promotion gate liveTargetParity must pass/)

console.log(
  `ok - Summer parity passes ${versioned.components.summer.comparedRowCount} rows; Winter parity fails closed ${versioned.components.winter.mismatchCount}/${versioned.components.winter.comparedRowCount}`,
)
