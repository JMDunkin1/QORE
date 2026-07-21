import { SUMMER_FORECAST_LOCATION_UNIVERSE } from './qore-summer-location-universe.mjs'

export { SUMMER_FORECAST_LOCATION_UNIVERSE } from './qore-summer-location-universe.mjs'

const DAY_MS = 86400000

const DEFAULT_COVERAGE_START_DATE = '2021-05-01'
const TARGET_SEASON_START_MONTH_DAY = '05-01'
const TARGET_SEASON_END_MONTH_DAY = '09-30'
const REQUIRED_LEAD_DAYS = 7
const REQUIRED_WINDOW_ID = 'rumor'
const LOCATION_WEIGHT_TOLERANCE = 1e-9

const REVIEWED_LOCATION_WEIGHTS = new Map(
  SUMMER_FORECAST_LOCATION_UNIVERSE.locations.map(({ locationId, weight }) => [locationId, weight]),
)

function assertIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new Error(`${label} must be an ISO calendar date.`)
  }
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid ISO calendar date.`)
  }
  return value
}

function addCalendarDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function calendarDates(startDate, endDate) {
  if (startDate > endDate) return []
  const dates = []
  for (let date = startDate; date <= endDate; date = addCalendarDays(date, 1)) dates.push(date)
  return dates
}

function compactDateRanges(dates) {
  if (!dates.length) return []
  const sortedDates = [...new Set(dates)].sort()
  const ranges = []
  let startIssueDate = sortedDates[0]
  let endIssueDate = sortedDates[0]

  function pushRange() {
    ranges.push({
      startIssueDate,
      endIssueDate,
      startTargetDate: addCalendarDays(startIssueDate, REQUIRED_LEAD_DAYS),
      endTargetDate: addCalendarDays(endIssueDate, REQUIRED_LEAD_DAYS),
      missingIssueDateCount:
        Math.round((Date.parse(`${endIssueDate}T00:00:00Z`) - Date.parse(`${startIssueDate}T00:00:00Z`)) / DAY_MS) + 1,
    })
  }

  for (const date of sortedDates.slice(1)) {
    if (date === addCalendarDays(endIssueDate, 1)) {
      endIssueDate = date
      continue
    }
    pushRange()
    startIssueDate = date
    endIssueDate = date
  }
  pushRange()
  return ranges
}

function requiredIssueDates({ coverageStartDate, marketEndDate }) {
  const finalObservableIssueDate = addCalendarDays(marketEndDate, -REQUIRED_LEAD_DAYS)
  if (finalObservableIssueDate < coverageStartDate) return []

  const dates = []
  const firstYear = Number(coverageStartDate.slice(0, 4))
  const finalYear = Number(finalObservableIssueDate.slice(0, 4))
  for (let year = firstYear; year <= finalYear; year += 1) {
    const targetSeasonStart = `${year}-${TARGET_SEASON_START_MONTH_DAY}`
    const targetSeasonEnd = `${year}-${TARGET_SEASON_END_MONTH_DAY}`
    const issueSeasonStart = addCalendarDays(targetSeasonStart, -REQUIRED_LEAD_DAYS)
    const issueSeasonEnd = addCalendarDays(targetSeasonEnd, -REQUIRED_LEAD_DAYS)
    const startDate = [issueSeasonStart, coverageStartDate].sort().at(-1)
    const endDate = [issueSeasonEnd, finalObservableIssueDate].sort()[0]
    dates.push(...calendarDates(startDate, endDate))
  }
  return dates
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function summarizeSummerForecastLocationBreadth(locationRows) {
  if (!Array.isArray(locationRows)) throw new Error('locationRows must be an array.')

  const rowsByLocationId = new Map()
  for (const row of locationRows) {
    const locationId = typeof row?.locationId === 'string' ? row.locationId : ''
    rowsByLocationId.set(locationId, [...(rowsByLocationId.get(locationId) ?? []), row])
  }

  const missingLocationIds = SUMMER_FORECAST_LOCATION_UNIVERSE.locations
    .map((location) => location.locationId)
    .filter((locationId) => !rowsByLocationId.has(locationId))
  const unexpectedLocationIds = [...rowsByLocationId.keys()]
    .filter((locationId) => !REVIEWED_LOCATION_WEIGHTS.has(locationId))
    .sort()
  const duplicateLocationIds = [...rowsByLocationId.entries()]
    .filter(([, rows]) => rows.length !== 1)
    .map(([locationId]) => locationId)
    .sort()
  const invalidWeightLocationIds = []
  const mismatchedWeights = []

  for (const { locationId, weight: expectedWeight } of SUMMER_FORECAST_LOCATION_UNIVERSE.locations) {
    const rows = rowsByLocationId.get(locationId)
    if (!rows || rows.length !== 1) continue
    const observedWeight = Number(rows[0].weight)
    if (!Number.isFinite(observedWeight)) {
      invalidWeightLocationIds.push(locationId)
      continue
    }
    if (Math.abs(observedWeight - expectedWeight) > LOCATION_WEIGHT_TOLERANCE) {
      mismatchedWeights.push({ locationId, expectedWeight, observedWeight })
    }
  }

  const observedSampledWeight = locationRows.reduce((sum, row) => {
    const weight = Number(row?.weight)
    return sum + (Number.isFinite(weight) ? weight : 0)
  }, 0)
  const complete =
    locationRows.length === SUMMER_FORECAST_LOCATION_UNIVERSE.locations.length &&
    missingLocationIds.length === 0 &&
    unexpectedLocationIds.length === 0 &&
    duplicateLocationIds.length === 0 &&
    invalidWeightLocationIds.length === 0 &&
    mismatchedWeights.length === 0

  return {
    contractId: SUMMER_FORECAST_LOCATION_UNIVERSE.contractId,
    complete,
    expectedLocationCount: SUMMER_FORECAST_LOCATION_UNIVERSE.expectedLocationCount,
    observedLocationCount: locationRows.length,
    expectedSampledWeight: SUMMER_FORECAST_LOCATION_UNIVERSE.expectedSampledWeight,
    observedSampledWeight: round(observedSampledWeight, 6),
    missingLocationIds,
    unexpectedLocationIds,
    duplicateLocationIds,
    invalidWeightLocationIds,
    mismatchedWeights,
  }
}

export function summarizeSummerForecastCoverage({
  scores,
  requiredSourceIds,
  marketEndDate,
  coverageStartDate = DEFAULT_COVERAGE_START_DATE,
}) {
  assertIsoDate(coverageStartDate, 'coverageStartDate')
  assertIsoDate(marketEndDate, 'marketEndDate')
  if (!Array.isArray(scores)) throw new Error('scores must be an array.')
  if (!Array.isArray(requiredSourceIds) || !requiredSourceIds.length) {
    throw new Error('requiredSourceIds must contain at least one forecast source.')
  }

  const sourceIds = [...new Set(requiredSourceIds)]
  if (sourceIds.length !== requiredSourceIds.length || sourceIds.some((sourceId) => !sourceId)) {
    throw new Error('requiredSourceIds must contain unique non-empty forecast source IDs.')
  }

  const expectedIssueDates = requiredIssueDates({ coverageStartDate, marketEndDate })
  const expectedIssueDateSet = new Set(expectedIssueDates)
  const completeIssuesBySource = new Map(sourceIds.map((sourceId) => [sourceId, new Set()]))
  const locationBreadthFailuresBySource = new Map(sourceIds.map((sourceId) => [sourceId, new Set()]))

  for (const score of scores) {
    const completeIssues = completeIssuesBySource.get(score.sourceId)
    if (!completeIssues || !expectedIssueDateSet.has(score.issueDate)) continue
    const locationBreadth = summarizeSummerForecastLocationBreadth(
      Array.isArray(score.locationRows) ? score.locationRows : [],
    )
    if (!locationBreadth.complete) {
      locationBreadthFailuresBySource.get(score.sourceId).add(score.issueDate)
      continue
    }
    if (
      score.coverageInputComplete !== true ||
      score.windowId !== REQUIRED_WINDOW_ID ||
      Number(score.leadDays) !== REQUIRED_LEAD_DAYS ||
      score.targetDate !== addCalendarDays(score.issueDate, REQUIRED_LEAD_DAYS)
    ) continue
    completeIssues.add(score.issueDate)
  }

  const sources = sourceIds.map((sourceId) => {
    const completeIssues = completeIssuesBySource.get(sourceId)
    const missingIssueDates = expectedIssueDates.filter((date) => !completeIssues.has(date))
    const locationBreadthFailureIssueDates = missingIssueDates.filter((date) =>
      locationBreadthFailuresBySource.get(sourceId).has(date),
    )
    return {
      sourceId,
      completeIssueDateCount: completeIssues.size,
      requiredIssueDateCount: expectedIssueDates.length,
      coveragePct: expectedIssueDates.length ? round((completeIssues.size / expectedIssueDates.length) * 100) : 0,
      missingIssueDateCount: missingIssueDates.length,
      firstMissingIssueDate: missingIssueDates[0] ?? null,
      lastMissingIssueDate: missingIssueDates.at(-1) ?? null,
      missingRanges: compactDateRanges(missingIssueDates),
      locationBreadthFailureIssueDateCount: locationBreadthFailureIssueDates.length,
      locationBreadthFailureRanges: compactDateRanges(locationBreadthFailureIssueDates),
    }
  })
  const missingUniqueIssueDates = expectedIssueDates.filter((date) =>
    sources.some((source) => !completeIssuesBySource.get(source.sourceId).has(date)),
  )
  const complete = expectedIssueDates.length > 0 && sources.every((source) => source.missingIssueDateCount === 0)

  return {
    contractId: 'summer-active-source-daily-lead-7-location-universe-v1',
    status: expectedIssueDates.length === 0 ? 'not-observable' : complete ? 'complete' : 'incomplete',
    complete,
    promotionEligible: complete,
    coverageStartDate,
    marketEndDate,
    finalObservableIssueDate: addCalendarDays(marketEndDate, -REQUIRED_LEAD_DAYS),
    firstRequiredIssueDate: expectedIssueDates[0] ?? null,
    lastRequiredIssueDate: expectedIssueDates.at(-1) ?? null,
    requiredIssueDateCount: expectedIssueDates.length,
    fullyCoveredIssueDateCount: expectedIssueDates.length - missingUniqueIssueDates.length,
    missingUniqueIssueDateCount: missingUniqueIssueDates.length,
    missingSourceIssueDateCount: sources.reduce((sum, source) => sum + source.missingIssueDateCount, 0),
    firstMissingIssueDate: missingUniqueIssueDates[0] ?? null,
    lastMissingIssueDate: missingUniqueIssueDates.at(-1) ?? null,
    policy: {
      requiredSourceIds: sourceIds,
      frequency: 'daily-calendar-issue',
      windowId: REQUIRED_WINDOW_ID,
      leadDays: REQUIRED_LEAD_DAYS,
      targetSeasonStartMonthDay: TARGET_SEASON_START_MONTH_DAY,
      targetSeasonEndMonthDay: TARGET_SEASON_END_MONTH_DAY,
      requiresMatchingLocationBreadth: true,
      locationUniverse: SUMMER_FORECAST_LOCATION_UNIVERSE,
      marketCutoff:
        'Require each in-season lead-7 issue date to have its target date on or before the aligned market ledger end; the initial calendar is reviewed as beginning 2021-05-01.',
    },
    sources,
  }
}
