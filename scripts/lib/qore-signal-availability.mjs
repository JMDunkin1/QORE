import { easternTimeToUtcIso } from './eia-release-time.mjs'

export const NASA_POWER_ACTUAL_LAG_DAYS = 3

export function addCalendarDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

export function eiaReportAvailableAtOpen(releasedAt, tradeDate) {
  const releaseTime = Date.parse(String(releasedAt ?? ''))
  const marketOpen = Date.parse(easternTimeToUtcIso(tradeDate, '09:30') ?? '')
  return Number.isFinite(releaseTime) && Number.isFinite(marketOpen) && releaseTime <= marketOpen
}

export function nasaPowerActualAvailableAtOpen(targetDate, tradeDate) {
  return addCalendarDays(targetDate, NASA_POWER_ACTUAL_LAG_DAYS) <= tradeDate
}
