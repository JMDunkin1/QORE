const DAY_MS = 86_400_000
const EASTERN_TIME_ZONE = 'America/New_York'

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

// EIA's weekly storage period ends Friday; the WNGSR normally publishes the
// observation the following Thursday at 10:30 a.m. America/New_York.
// Holiday delays make this nominal timestamp conservative by up to one day.
export function nominalEiaStorageReleaseAt(periodEndDate) {
  const period = validIsoDate(periodEndDate)
  if (!period) return null
  const releaseDate = new Date(period.getTime() + 6 * DAY_MS)
  const offsetMinutes = utcOffsetMinutes(releaseDate, EASTERN_TIME_ZONE)
  if (offsetMinutes === null) return null
  const releaseUtc = Date.UTC(
    releaseDate.getUTCFullYear(),
    releaseDate.getUTCMonth(),
    releaseDate.getUTCDate(),
    10,
    30,
  ) - offsetMinutes * 60_000
  return new Date(releaseUtc).toISOString()
}
