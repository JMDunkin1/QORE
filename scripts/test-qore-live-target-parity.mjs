#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  LIVE_TARGET_PARITY_POLICY,
  assessLiveTargetParity,
  evaluateVersionedLiveTargetParity,
  versionedLiveTargetParityInputDigestSha256,
} from './lib/qore-live-target-parity.mjs'
import {
  liveTargetParityFailures,
} from './lib/qore-live-strategy-artifact.mjs'
import { inferAllYearTarget } from './lib/qore-live-all-year-inference.mjs'

function expectedFixture(overrides = {}) {
  return {
    componentStrategyId: 'ngas-winter-alpha',
    windowId: 'weather-follow',
    ...overrides,
  }
}

function replayFixture(overrides = {}) {
  return {
    componentStrategyId: 'ngas-winter-alpha',
    windowId: 'weather-follow',
    ...overrides,
  }
}

const passing = assessLiveTargetParity({
  expectedRows: [
    expectedFixture({
      entryTradeDate: '2025-01-02',
      ungPosition: '-0.25',
      indexFraction: '0.75',
      thesisKind: 'warm-short',
    }),
    expectedFixture({
      componentStrategyId: 'index-fallback',
      windowId: 'index-fallback',
      entryTradeDate: '2025-01-03',
      ungPosition: '0',
      indexFraction: '1',
      thesisKind: 'index-fallback',
    }),
  ],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  inferTarget: ({ targetDate }) => targetDate === '2025-01-02'
    ? replayFixture({ gasPosition: -0.25, indexFraction: 0.75, thesisKind: 'warm-short' })
    : replayFixture({
        componentStrategyId: 'index-fallback',
        windowId: 'index-fallback',
        gasPosition: 0,
        indexFraction: 1,
        thesisKind: 'index-fallback',
      }),
})
assert.equal(passing.exactTargetParity, true)
assert.equal(passing.mismatchCount, 0)

const nearButNotExact = assessLiveTargetParity({
  expectedRows: [expectedFixture({
    entryTradeDate: '2025-01-02',
    ungPosition: '-0.25',
    indexFraction: '0.75',
    thesisKind: 'warm-short',
  })],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  inferTarget: () => replayFixture({
    gasPosition: -0.2501,
    indexFraction: 0.7499,
    thesisKind: 'warm-short',
  }),
})
assert.equal(nearButNotExact.exactTargetParity, false)
assert.equal(nearButNotExact.gasPositionMismatchCount, 1)
assert.equal(nearButNotExact.indexFractionMismatchCount, 1)

const failing = assessLiveTargetParity({
  expectedRows: [expectedFixture({
    componentStrategyId: 'index-fallback',
    windowId: 'index-fallback',
    entryTradeDate: '2025-01-02',
    ungPosition: '0',
    indexFraction: '1',
    thesisKind: 'index-fallback',
  })],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  inferTarget: () => replayFixture({
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
  expectedRows: [expectedFixture({
    entryTradeDate: '2025-01-02',
    ungPosition: '-0.25',
    indexFraction: '0.75',
    thesisKind: 'warm-short',
  })],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  inferTarget: () => replayFixture({
    gasPosition: -0.25,
    indexFraction: 0.7,
    thesisKind: 'warm-short',
  }),
})
assert.equal(allocationFailing.exactTargetParity, false)
assert.equal(allocationFailing.gasPositionMismatchCount, 0)
assert.equal(allocationFailing.indexFractionMismatchCount, 1)
assert.equal(allocationFailing.thesisKindMismatchCount, 0)

for (const [label, expectedRows, inferTarget, rawField] of [
  [
    'expected',
    [expectedFixture({
      entryTradeDate: '2025-01-02',
      ungPosition: '-0.250001',
      indexFraction: '0.750001',
      thesisKind: 'warm-short',
    })],
    () => replayFixture({
      gasPosition: -0.25,
      indexFraction: 0.75,
      thesisKind: 'warm-short',
    }),
    'expectedRawGasPosition',
  ],
  [
    'replay',
    [expectedFixture({
      entryTradeDate: '2025-01-02',
      ungPosition: '-0.25',
      indexFraction: '0.75',
      thesisKind: 'warm-short',
    })],
    () => replayFixture({
      gasPosition: -0.250001,
      indexFraction: 0.750001,
      thesisKind: 'warm-short',
    }),
    'replayRawGasPosition',
  ],
]) {
  const nonCanonical = assessLiveTargetParity({
    expectedRows,
    forecastRows: [],
    actualWeatherRows: [],
    marketDays: [],
    storageRows: [],
    inferTarget,
  })
  assert.equal(nonCanonical.exactTargetParity, false, `${label} raw precision must fail`)
  assert.equal(nonCanonical.gasPositionMismatchCount, 1)
  assert.equal(nonCanonical.indexFractionMismatchCount, 1)
  assert.equal(nonCanonical.mismatches[0][rawField], -0.250001)
  assert.equal(nonCanonical.mismatches[0].gasPositionDifference, 0)
  assert.equal(nonCanonical.mismatches[0].indexFractionDifference, 0)
}

const identityFailing = assessLiveTargetParity({
  expectedRows: [expectedFixture({
    entryTradeDate: '2025-01-02',
    ungPosition: '-0.25',
    indexFraction: '0.75',
    thesisKind: 'warm-short',
  })],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  inferTarget: () => replayFixture({
    componentStrategyId: 'ngas-summer-alpha',
    windowId: 'weather-reversion',
    gasPosition: -0.25,
    indexFraction: 0.75,
    thesisKind: 'warm-short',
  }),
})
assert.equal(identityFailing.exactTargetParity, false)
assert.equal(identityFailing.gasPositionMismatchCount, 0)
assert.equal(identityFailing.indexFractionMismatchCount, 0)
assert.equal(identityFailing.thesisKindMismatchCount, 0)
assert.equal(identityFailing.componentStrategyIdMismatchCount, 1)
assert.equal(identityFailing.windowIdMismatchCount, 1)
assert.notEqual(identityFailing.comparisonDigestSha256, passing.comparisonDigestSha256)
assert.ok(LIVE_TARGET_PARITY_POLICY.comparisonFields.includes('componentStrategyId'))
assert.ok(LIVE_TARGET_PARITY_POLICY.comparisonFields.includes('windowId'))

const injectedStorageReleaseCalendar = {
  calendarId: 'parity-injected-calendar',
  byPeriodEndDate: new Map([
    ['2024-12-13', { periodEndDate: '2024-12-13', releasedAt: '2024-12-19T15:30:00.000Z' }],
    ['2024-12-20', { periodEndDate: '2024-12-20', releasedAt: '2025-01-07T15:30:00.000Z' }],
    ['2024-12-27', { periodEndDate: '2024-12-27', releasedAt: '2025-01-10T15:30:00.000Z' }],
  ]),
}
const injectedStorageInputs = {
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [{ date: '2025-01-06', gasClose: 20 }],
  storageRows: [
    { date: '2024-12-13', storageBcf: 3600 },
    { date: '2024-12-20', storageBcf: 3500 },
    { date: '2024-12-27', storageBcf: 3400 },
  ],
  targetDate: '2025-01-06',
}
const defaultCalendarTarget = inferAllYearTarget(injectedStorageInputs)
assert.equal(defaultCalendarTarget.diagnostics.storage.storageDate, '2024-12-27')
const injectedCalendarTarget = inferAllYearTarget({
  ...injectedStorageInputs,
  storageReleaseCalendar: injectedStorageReleaseCalendar,
})
assert.equal(injectedCalendarTarget.diagnostics.storage.storageDate, '2024-12-13')
assert.equal(
  injectedCalendarTarget.diagnostics.storage.storageReleaseAt,
  '2024-12-19T15:30:00.000Z',
  'inference must consume the explicitly supplied release calendar instead of the module default',
)

let forwardedStorageReleaseCalendar = null
assessLiveTargetParity({
  expectedRows: [expectedFixture({
    componentStrategyId: 'index-fallback',
    windowId: 'index-fallback',
    entryTradeDate: '2025-01-06',
    ungPosition: '0',
    indexFraction: '1',
    thesisKind: 'index-fallback',
  })],
  forecastRows: [],
  actualWeatherRows: [],
  marketDays: [],
  storageRows: [],
  storageReleaseCalendar: injectedStorageReleaseCalendar,
  inferTarget: (inputs) => {
    forwardedStorageReleaseCalendar = inputs.storageReleaseCalendar
    return replayFixture({
      componentStrategyId: 'index-fallback',
      windowId: 'index-fallback',
      gasPosition: 0,
      indexFraction: 1,
      thesisKind: 'index-fallback',
    })
  },
})
assert.equal(
  forwardedStorageReleaseCalendar,
  injectedStorageReleaseCalendar,
  'parity assessment must forward the exact reviewed release-calendar object into inference',
)

const formerWinterMismatchDates = [
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
]
const versioned = evaluateVersionedLiveTargetParity(process.cwd(), {
  captureWinterTargetDates: formerWinterMismatchDates,
})
assert.equal(versioned.schemaVersion, LIVE_TARGET_PARITY_POLICY.schemaVersion)
assert.equal(versioned.status, 'fail')
assert.equal(versioned.exactTargetParity, false)
assert.equal(versioned.inputContractValid, false)
assert.ok(versioned.inputContractFailureCount > versioned.inputContractFailureSamples.length)
assert.equal(versioned.inputContractFailureSamples.length, 20)
assert.match(versioned.inputContractFailureDigestSha256, /^[a-f0-9]{64}$/)
assert.equal(Object.hasOwn(versioned, 'inputContractFailures'), false)
assert.ok(versioned.inputContractFailureSamples.some((failure) =>
  failure.includes('corrected Summer contract')))
assert.equal(versioned.comparedRowCount, 1947)
assert.equal(versioned.matchedRowCount, 1947)
assert.equal(versioned.mismatchCount, 0)
assert.equal(versioned.gasPositionMismatchCount, 0)
assert.equal(versioned.indexFractionMismatchCount, 0)
assert.equal(versioned.thesisKindMismatchCount, 0)
assert.equal(versioned.componentStrategyIdMismatchCount, 0)
assert.equal(versioned.windowIdMismatchCount, 0)
assert.deepEqual(versioned.productionForecastSourceIds.summer, ['gfs', 'gefs-mean'])
assert.deepEqual(versioned.productionForecastSourceIds.winter, [
  'gfs',
  'gefs-mean',
  'graphcastgfs',
  'aigfs',
  'ecmwf-ifs',
  'ecmwf-aifs',
  'gem-global',
])
assert.equal(versioned.components.summer.status, 'fail')
assert.equal(versioned.components.summer.exactTargetParity, false)
assert.equal(versioned.components.summer.targetReplayExact, true)
assert.equal(versioned.components.summer.inputContractValid, false)
assert.ok(versioned.components.summer.inputContractFailureCount > 20)
assert.equal(versioned.components.summer.inputContractFailureSamples.length, 20)
assert.equal(Object.hasOwn(versioned.components.summer, 'inputContractFailures'), false)
assert.ok(versioned.components.summer.temporalInputs.every((input) =>
  input.failureSamples.length <= 20
  && input.failureSamples.length < input.failureCount
  && /^[a-f0-9]{64}$/.test(input.failureDigestSha256)
  && !Object.hasOwn(input, 'failures')))
assert.equal(versioned.components.summer.comparedRowCount, 585)
assert.equal(versioned.components.summer.matchedRowCount, 585)
assert.equal(versioned.components.summer.mismatchCount, 0)
assert.equal(versioned.components.summer.componentStrategyIdMismatchCount, 0)
assert.equal(versioned.components.summer.windowIdMismatchCount, 0)
assert.equal(versioned.components.summer.forecastRowCount, 1516)
assert.deepEqual(versioned.components.summer.productionForecastSourceIds, ['gfs', 'gefs-mean'])
assert.match(
  versioned.components.summer.inputFiles.forecastCalendars.join(';'),
  /2021-05-01-2025-09-30-leads-7-hours-0/,
)
assert.equal(
  versioned.components.summer.inputFiles.forecastCalendars.filter((file) => file.endsWith('-manifest.json')).length,
  2,
)
assert.equal(versioned.components.winter.status, 'pass')
assert.equal(versioned.components.winter.exactTargetParity, true)
assert.equal(versioned.components.winter.comparedRowCount, 1362)
assert.equal(versioned.components.winter.matchedRowCount, 1362)
assert.equal(versioned.components.winter.mismatchCount, 0)
assert.equal(versioned.components.winter.componentStrategyIdMismatchCount, 0)
assert.equal(versioned.components.winter.windowIdMismatchCount, 0)
assert.deepEqual(
  versioned.components.winter.capturedComparisons.map((row) => row.targetDate),
  formerWinterMismatchDates,
)
assert.ok(versioned.components.winter.capturedComparisons.every((row) => row.matches))
assert.deepEqual(
  versioned.components.winter.capturedComparisons
    .filter((row) => ['2026-01-26', '2026-01-27'].includes(row.targetDate))
    .map((row) => ({
      targetDate: row.targetDate,
      expectedGasPosition: row.expectedGasPosition,
      replayGasPosition: row.replayGasPosition,
      expectedThesisKind: row.expectedThesisKind,
      replayThesisKind: row.replayThesisKind,
    })),
  [
    {
      targetDate: '2026-01-26',
      expectedGasPosition: 0.3906,
      replayGasPosition: 0.3906,
      expectedThesisKind: 'cold-long',
      replayThesisKind: 'cold-long',
    },
    {
      targetDate: '2026-01-27',
      expectedGasPosition: -0.25,
      replayGasPosition: -0.25,
      expectedThesisKind: 'reversion-short',
      replayThesisKind: 'reversion-short',
    },
  ],
)

const storageReleaseCalendar =
  'data/qore/fundamentals/eia/working-gas-storage-release-calendar.json'
assert.equal(versioned.inputFiles.storageReleaseCalendar, storageReleaseCalendar)
const versionedInputFiles = new Set([
  versioned.inputFiles.storage,
  versioned.inputFiles.storageReleaseCalendar,
  versioned.inputFiles.summer.expectedTargets,
  ...versioned.inputFiles.summer.forecastCalendars,
  versioned.inputFiles.summer.market,
  versioned.inputFiles.winter.datasetManifest,
  versioned.inputFiles.winter.expectedTargets,
  versioned.inputFiles.winter.actualWeather,
  ...versioned.inputFiles.winter.forecastCalendars,
  versioned.inputFiles.winter.market,
])
const scratchRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'qore-parity-calendar-digest-'))
try {
  for (const relativePath of versionedInputFiles) {
    const scratchPath = path.join(scratchRepo, relativePath)
    fs.mkdirSync(path.dirname(scratchPath), { recursive: true })
    fs.symlinkSync(path.join(process.cwd(), relativePath), scratchPath)
  }
  assert.equal(
    versionedLiveTargetParityInputDigestSha256(scratchRepo),
    versioned.inputDigestSha256,
    'the scratch replay must begin with the same versioned input digest',
  )

  const scratchCalendarPath = path.join(scratchRepo, storageReleaseCalendar)
  const mutatedCalendar = JSON.parse(fs.readFileSync(scratchCalendarPath, 'utf8'))
  mutatedCalendar.calendarId = `${mutatedCalendar.calendarId}-digest-regression`
  fs.unlinkSync(scratchCalendarPath)
  fs.writeFileSync(scratchCalendarPath, `${JSON.stringify(mutatedCalendar, null, 2)}\n`)
  assert.notEqual(
    versionedLiveTargetParityInputDigestSha256(scratchRepo),
    versioned.inputDigestSha256,
    'mutating the reviewed storage release calendar must invalidate the parity input digest',
  )
} finally {
  fs.rmSync(scratchRepo, { recursive: true, force: true })
}

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

console.log(
  `ok - legacy Summer targets still replay ${versioned.components.summer.matchedRowCount} rows but fail the temporal input contract; Winter parity passes ${versioned.components.winter.comparedRowCount} rows`,
)
