import { readFileSync } from 'node:fs'

const DAY_MS = 86_400_000
const EASTERN_TIME_ZONE = 'America/New_York'
export const EIA_RELEASE_CALENDAR_MINIMUM_FUTURE_DAYS = 28
const DEFAULT_RELEASE_CALENDAR_URL = new URL(
  '../../data/qore/fundamentals/eia/working-gas-storage-release-calendar.json',
  import.meta.url,
)

let defaultReleaseCalendar = null

function validIsoDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText ?? ''))) return null
  const date = new Date(`${dateText}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) return null
  return date
}

function utcOffsetMinutes(date, timeZone) {
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')
    ?.value
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetName ?? '')
  if (!match) return null
  const magnitude = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -magnitude : magnitude
}

export function easternTimeToUtcIso(dateText, timeText) {
  const date = validIsoDate(dateText)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeText ?? ''))
  if (!date || !timeMatch) return null
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  if (hour > 23 || minute > 59) return null
  const offsetMinutes = utcOffsetMinutes(date, EASTERN_TIME_ZONE)
  if (offsetMinutes === null) return null
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute)
      - offsetMinutes * 60_000,
  ).toISOString()
}

// EIA's weekly storage period ends Friday; the WNGSR normally publishes the
// observation the following Thursday at 10:30 a.m. America/New_York.
// Historical consumers must use the versioned calendar below because holiday
// and extraordinary delays can move publication in either direction.
export function nominalEiaStorageReleaseAt(periodEndDate) {
  const period = validIsoDate(periodEndDate)
  if (!period) return null
  const releaseDate = new Date(period.getTime() + 6 * DAY_MS)
  return easternTimeToUtcIso(releaseDate.toISOString().slice(0, 10), '10:30')
}

export function loadEiaStorageReleaseCalendar(calendarUrl = DEFAULT_RELEASE_CALENDAR_URL) {
  const parsed = JSON.parse(readFileSync(calendarUrl, 'utf8'))
  if (
    parsed.schemaVersion !== 1
    || !parsed.calendarId
    || !validIsoDate(parsed.verifiedThroughPeriodEndDate)
    || !Array.isArray(parsed.releases)
    || !parsed.releases.length
  ) {
    throw new Error(`Invalid EIA storage release calendar: ${calendarUrl}`)
  }
  const byPeriodEndDate = new Map()
  for (const [index, row] of parsed.releases.entries()) {
    if (!validIsoDate(row.periodEndDate) || Number.isNaN(Date.parse(row.releasedAt))) {
      throw new Error(`Invalid EIA storage release row for ${row.periodEndDate ?? 'unknown period'}`)
    }
    if (byPeriodEndDate.has(row.periodEndDate)) {
      throw new Error(`Duplicate EIA storage release row for ${row.periodEndDate}`)
    }
    const previous = parsed.releases[index - 1]
    if (previous && Date.parse(`${row.periodEndDate}T00:00:00Z`) - Date.parse(`${previous.periodEndDate}T00:00:00Z`) !== 7 * DAY_MS) {
      throw new Error(`Non-weekly EIA storage release row after ${previous.periodEndDate}`)
    }
    if (previous && Date.parse(row.releasedAt) < Date.parse(previous.releasedAt)) {
      throw new Error(`Non-chronological EIA storage release timestamp for ${row.periodEndDate}`)
    }
    byPeriodEndDate.set(row.periodEndDate, row)
  }
  if (parsed.releases.at(-1).periodEndDate !== parsed.verifiedThroughPeriodEndDate) {
    throw new Error(
      `EIA storage release calendar ends at ${parsed.releases.at(-1).periodEndDate}, not its verified-through period ${parsed.verifiedThroughPeriodEndDate}`,
    )
  }
  return { ...parsed, byPeriodEndDate }
}

export function assertEiaStorageReleaseCalendarCoverage(
  asOfDate,
  calendar = null,
  minimumFutureDays = EIA_RELEASE_CALENDAR_MINIMUM_FUTURE_DAYS,
) {
  const asOf = validIsoDate(asOfDate)
  if (!asOf) throw new Error(`Invalid EIA release-calendar coverage date: ${asOfDate ?? 'missing'}`)
  if (!Number.isInteger(minimumFutureDays) || minimumFutureDays < 0) {
    throw new Error(`Invalid EIA release-calendar future-coverage guard: ${minimumFutureDays}`)
  }
  if (!calendar) {
    defaultReleaseCalendar ??= loadEiaStorageReleaseCalendar()
    calendar = defaultReleaseCalendar
  }
  const verifiedThrough = validIsoDate(calendar.verifiedThroughPeriodEndDate)
  if (!verifiedThrough) {
    throw new Error(`Invalid verified-through period in EIA storage release calendar ${calendar.calendarId ?? 'unknown'}`)
  }
  const requiredThrough = new Date(asOf.getTime() + minimumFutureDays * DAY_MS)
  if (verifiedThrough < requiredThrough) {
    const requiredDate = requiredThrough.toISOString().slice(0, 10)
    throw new Error(
      `EIA storage release calendar ${calendar.calendarId ?? 'unknown'} is stale or expiring: verified through period ${calendar.verifiedThroughPeriodEndDate}, but ${asOfDate} requires coverage through at least ${requiredDate} (${minimumFutureDays}-day live guard). Verify the published schedule and run npm run data:eia-release-calendar before live inference.`,
    )
  }
  return {
    calendarId: calendar.calendarId,
    asOfDate,
    verifiedThroughPeriodEndDate: calendar.verifiedThroughPeriodEndDate,
    minimumFutureDays,
    remainingCoverageDays: Math.floor((verifiedThrough.getTime() - asOf.getTime()) / DAY_MS),
  }
}

export function eiaStorageReleaseAt(periodEndDate, calendar = null) {
  if (!validIsoDate(periodEndDate)) return null
  if (!calendar) {
    defaultReleaseCalendar ??= loadEiaStorageReleaseCalendar()
    calendar = defaultReleaseCalendar
  }
  return calendar.byPeriodEndDate.get(periodEndDate)?.releasedAt ?? null
}
