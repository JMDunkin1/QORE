#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Papa from 'papaparse'
import {
  SUMMER_FORECAST_LOCATION_UNIVERSE,
  summarizeSummerForecastCoverage,
  summarizeSummerForecastLocationBreadth,
} from './lib/qore-summer-forecast-coverage.mjs'
import {
  canonicalComponentLiveContractFromSummaries,
  executableLiveComponentContract,
  executableLiveComponentContractDigestSha256,
  liveComponentContractDigestSha256,
} from './lib/qore-live-contract.mjs'
import {
  SUMMER_FORECAST_LOCATION_UNIVERSE as DIRECT_SUMMER_FORECAST_LOCATION_UNIVERSE,
} from './lib/qore-summer-location-universe.mjs'

const DAY_MS = 86400000

function addCalendarDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function calendarDates(startDate, endDate) {
  const dates = []
  for (let date = startDate; date <= endDate; date = addCalendarDays(date, 1)) dates.push(date)
  return dates
}

function completeScore(sourceId, issueDate, overrides = {}) {
  const locationRows = overrides.locationRows ?? SUMMER_FORECAST_LOCATION_UNIVERSE.locations
  return {
    sourceId,
    issueDate,
    targetDate: addCalendarDays(issueDate, 7),
    leadDays: 7,
    windowId: 'rumor',
    coverageInputComplete: true,
    ...overrides,
    locationRows,
  }
}

function scoresFor(sourceIds, issueDates) {
  return sourceIds.flatMap((sourceId) => issueDates.map((issueDate) => completeScore(sourceId, issueDate)))
}

function testCompleteCoverageHonorsReviewedInception() {
  const issueDates = calendarDates('2021-05-01', '2021-05-03')
  const coverage = summarizeSummerForecastCoverage({
    scores: scoresFor(['gfs', 'gefs-mean'], issueDates),
    requiredSourceIds: ['gfs', 'gefs-mean'],
    marketEndDate: '2021-05-10',
  })

  assert.equal(coverage.status, 'complete')
  assert.equal(coverage.complete, true)
  assert.equal(coverage.promotionEligible, true)
  assert.equal(coverage.firstRequiredIssueDate, '2021-05-01')
  assert.equal(coverage.lastRequiredIssueDate, '2021-05-03')
  assert.equal(coverage.requiredIssueDateCount, 3)
  assert.equal(coverage.missingSourceIssueDateCount, 0)
  console.log('ok - complete active-source coverage passes the Summer component promotion gate')
}

function testMissingAndMalformedInputsFailClosed() {
  const issueDates = calendarDates('2026-04-24', '2026-05-04')
  const scores = scoresFor(['gfs', 'gefs-mean'], issueDates).filter(
    (score) => !(score.sourceId === 'gfs' && ['2026-05-01', '2026-05-02'].includes(score.issueDate)),
  )
  const invalidGefs = scores.find((score) => score.sourceId === 'gefs-mean' && score.issueDate === '2026-05-03')
  invalidGefs.coverageInputComplete = false
  scores.push(completeScore('gfs', '2026-05-01', { targetDate: '2026-05-09' }))

  const coverage = summarizeSummerForecastCoverage({
    scores,
    requiredSourceIds: ['gfs', 'gefs-mean'],
    marketEndDate: '2026-05-11',
    coverageStartDate: '2026-04-24',
  })

  assert.equal(coverage.status, 'incomplete')
  assert.equal(coverage.complete, false)
  assert.equal(coverage.promotionEligible, false)
  assert.equal(coverage.requiredIssueDateCount, 11)
  assert.equal(coverage.fullyCoveredIssueDateCount, 8)
  assert.equal(coverage.missingUniqueIssueDateCount, 3)
  assert.equal(coverage.missingSourceIssueDateCount, 3)
  assert.equal(coverage.firstMissingIssueDate, '2026-05-01')
  assert.equal(coverage.lastMissingIssueDate, '2026-05-03')

  const gfs = coverage.sources.find((source) => source.sourceId === 'gfs')
  assert.deepEqual(gfs.missingRanges, [{
    startIssueDate: '2026-05-01',
    endIssueDate: '2026-05-02',
    startTargetDate: '2026-05-08',
    endTargetDate: '2026-05-09',
    missingIssueDateCount: 2,
  }])
  const gefs = coverage.sources.find((source) => source.sourceId === 'gefs-mean')
  assert.equal(gefs.missingIssueDateCount, 1)
  assert.deepEqual(gefs.missingRanges[0], {
    startIssueDate: '2026-05-03',
    endIssueDate: '2026-05-03',
    startTargetDate: '2026-05-10',
    endTargetDate: '2026-05-10',
    missingIssueDateCount: 1,
  })
  console.log('ok - missing, malformed, and wrong-target inputs are explicit and fail closed')
}

function testPartialAndWrongLocationBreadthFailClosed() {
  const issueDates = calendarDates('2026-05-01', '2026-05-03')
  const scores = scoresFor(['gfs', 'gefs-mean'], issueDates)
  const replaceScore = (sourceId, issueDate, locationRows) => {
    const index = scores.findIndex((score) => score.sourceId === sourceId && score.issueDate === issueDate)
    scores[index] = completeScore(sourceId, issueDate, { locationRows })
  }

  replaceScore('gfs', '2026-05-01', SUMMER_FORECAST_LOCATION_UNIVERSE.locations.slice(0, -1))
  replaceScore('gefs-mean', '2026-05-02', SUMMER_FORECAST_LOCATION_UNIVERSE.locations.map((location) =>
    location.locationId === 'houston'
      ? { locationId: 'phoenix', weight: location.weight }
      : location,
  ))
  replaceScore('gfs', '2026-05-03', SUMMER_FORECAST_LOCATION_UNIVERSE.locations.map((location) =>
    location.locationId === 'new-york'
      ? { ...location, weight: 0.1 }
      : location,
  ))

  const partialBreadth = summarizeSummerForecastLocationBreadth(
    SUMMER_FORECAST_LOCATION_UNIVERSE.locations.slice(0, -1),
  )
  assert.equal(partialBreadth.complete, false)
  assert.deepEqual(partialBreadth.missingLocationIds, ['houston'])

  const coverage = summarizeSummerForecastCoverage({
    scores,
    requiredSourceIds: ['gfs', 'gefs-mean'],
    marketEndDate: '2026-05-10',
    coverageStartDate: '2026-05-01',
  })

  assert.equal(coverage.complete, false)
  assert.equal(coverage.promotionEligible, false)
  assert.equal(coverage.requiredIssueDateCount, 3)
  assert.equal(coverage.fullyCoveredIssueDateCount, 0)
  assert.equal(coverage.missingUniqueIssueDateCount, 3)
  assert.equal(coverage.missingSourceIssueDateCount, 3)
  assert.equal(coverage.policy.locationUniverse.expectedLocationCount, 18)
  assert.equal(coverage.policy.locationUniverse.expectedSampledWeight, 1.06)
  assert.deepEqual(
    coverage.policy.locationUniverse.locations,
    SUMMER_FORECAST_LOCATION_UNIVERSE.locations,
  )
  assert.equal(
    coverage.sources.find((source) => source.sourceId === 'gfs').locationBreadthFailureIssueDateCount,
    2,
  )
  assert.equal(
    coverage.sources.find((source) => source.sourceId === 'gefs-mean').locationBreadthFailureIssueDateCount,
    1,
  )
  console.log('ok - partial, unexpected-ID, and wrong-weight location baskets fail closed')
}

function testNoObservableSeasonFailsClosed() {
  const coverage = summarizeSummerForecastCoverage({
    scores: [],
    requiredSourceIds: ['gfs', 'gefs-mean'],
    coverageStartDate: '2026-05-01',
    marketEndDate: '2026-05-07',
  })

  assert.equal(coverage.status, 'not-observable')
  assert.equal(coverage.complete, false)
  assert.equal(coverage.promotionEligible, false)
  assert.equal(coverage.requiredIssueDateCount, 0)
  console.log('ok - an empty observable window does not pass by vacuous truth')
}

function parseCsv(filePath) {
  return Papa.parse(readFileSync(filePath, 'utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  }).data
}

function testReviewedUniverseMatchesVersionedLocationConfig() {
  const configuredLocations = parseCsv('data/qore/weather/locations.csv').map((row) => ({
    locationId: row.id,
    weight: Number(row.weight),
  }))
  assert.deepEqual(configuredLocations, SUMMER_FORECAST_LOCATION_UNIVERSE.locations)
  const breadth = summarizeSummerForecastLocationBreadth(configuredLocations)
  assert.equal(breadth.complete, true)
  assert.equal(breadth.expectedLocationCount, 18)
  assert.equal(breadth.expectedSampledWeight, 1.06)
  console.log('ok - the reviewed Summer location universe matches the versioned weather basket')
}

function testReviewedUniverseIsSealedInLiveComponentContract() {
  const summerSummary = JSON.parse(readFileSync(
    'data/qore/research/strategy-agent-runs/ngas-summer-alpha/run-summary.json',
    'utf8',
  ))
  const winterSummary = JSON.parse(readFileSync(
    'data/qore/research/strategy-agent-runs/ngas-winter-alpha/run-summary.json',
    'utf8',
  ))
  const canonicalContract = canonicalComponentLiveContractFromSummaries(
    summerSummary,
    winterSummary,
  )

  assert.equal(
    SUMMER_FORECAST_LOCATION_UNIVERSE,
    DIRECT_SUMMER_FORECAST_LOCATION_UNIVERSE,
    'coverage must re-export the single neutral location-universe constant',
  )
  assert.deepEqual(
    canonicalContract.summer.implementation.forecastLocationUniverse,
    SUMMER_FORECAST_LOCATION_UNIVERSE,
  )
  assert.deepEqual(
    executableLiveComponentContract.summer.implementation.forecastLocationUniverse,
    SUMMER_FORECAST_LOCATION_UNIVERSE,
  )
  assert.equal(
    liveComponentContractDigestSha256(canonicalContract),
    executableLiveComponentContractDigestSha256,
  )

  const tamperedSummerSummary = structuredClone(summerSummary)
  tamperedSummerSummary.validation.forecastCoverage.policy.locationUniverse.locations[0].weight = 0.08
  const tamperedContract = canonicalComponentLiveContractFromSummaries(
    tamperedSummerSummary,
    winterSummary,
  )
  assert.notEqual(
    liveComponentContractDigestSha256(tamperedContract),
    executableLiveComponentContractDigestSha256,
    'changing a Summer location weight must invalidate the executable component contract digest',
  )
  console.log('ok - the exact Summer location universe is sealed into the live component contract')
}

function scoreKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId, row.modelId].join('|')
}

function loadCheckedInCoverageScores(sourceId, scoreFile, locationFile) {
  const locationRowsByKey = new Map()
  for (const row of parseCsv(locationFile)) {
    const key = scoreKey(row)
    locationRowsByKey.set(key, [
      ...(locationRowsByKey.get(key) ?? []),
      { locationId: row.locationId, weight: row.weight },
    ])
  }
  return parseCsv(scoreFile).map((row) => {
    const locationRows = locationRowsByKey.get(scoreKey(row)) ?? []
    const locationBreadth = summarizeSummerForecastLocationBreadth(locationRows)
    return {
      sourceId,
      issueDate: row.issueDate,
      targetDate: row.targetDate,
      leadDays: Number(row.leadDays),
      windowId: row.windowId,
      locationRows,
      coverageInputComplete:
        locationBreadth.complete &&
        Number.isFinite(Number(row.weightedAnomalyF)) &&
        Number(row.sampledWeight) === locationBreadth.expectedSampledWeight &&
        Number(row.locationCount) === locationBreadth.expectedLocationCount,
    }
  })
}

function testCheckedInCalendarsExposeCurrentGap() {
  const scores = [
    ...loadCheckedInCoverageScores(
      'gfs',
      'data/qore/research/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv',
      'data/qore/weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv',
    ),
    ...loadCheckedInCoverageScores(
      'gefs-mean',
      'data/qore/research/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv',
      'data/qore/weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv',
    ),
  ]
  const coverage = summarizeSummerForecastCoverage({
    scores,
    requiredSourceIds: ['gfs', 'gefs-mean'],
    marketEndDate: '2026-07-14',
  })

  assert.equal(coverage.status, 'incomplete')
  assert.equal(coverage.promotionEligible, false)
  assert.equal(coverage.requiredIssueDateCount, 833)
  assert.equal(coverage.fullyCoveredIssueDateCount, 758)
  assert.equal(coverage.missingUniqueIssueDateCount, 75)
  assert.equal(coverage.missingSourceIssueDateCount, 150)
  assert.equal(coverage.firstMissingIssueDate, '2026-04-24')
  assert.equal(coverage.lastMissingIssueDate, '2026-07-07')
  assert.ok(coverage.sources.every((source) => source.missingIssueDateCount === 75))
  assert.ok(coverage.sources.every((source) => source.missingRanges.length === 1))
  console.log('ok - checked-in GFS/GEFS calendars expose the 2026-04-24 through 2026-07-07 coverage gap')
}

testCompleteCoverageHonorsReviewedInception()
testMissingAndMalformedInputsFailClosed()
testPartialAndWrongLocationBreadthFailClosed()
testNoObservableSeasonFailsClosed()
testReviewedUniverseMatchesVersionedLocationConfig()
testReviewedUniverseIsSealedInLiveComponentContract()
testCheckedInCalendarsExposeCurrentGap()
