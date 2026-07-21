import { validateIndexBasketConfig } from './qore-index-basket.mjs'

const DAY_MS = 86_400_000
const EXECUTION_SYMBOLS = new Set(['UNG', 'VOO', 'QQQM'])
const MARKET_TIME_ZONE = 'America/New_York'

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function round(value, digits = 4) {
  const numeric = finiteNumber(value)
  if (numeric === null) return null
  const factor = 10 ** digits
  return Math.round(numeric * factor) / factor
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function safeText(value, maxLength = 160) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength)
}

function dateKey(value, timeZone = MARKET_TIME_ZONE) {
  const timestamp = isoTimestamp(value)
  if (!timestamp) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function zonedClock(value, timeZone = MARKET_TIME_ZONE) {
  const timestamp = isoTimestamp(value)
  if (!timestamp) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    seconds: Number(values.hour) * 3_600 + Number(values.minute) * 60 + Number(values.second),
  }
}

function validDateKey(value) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

function formatDate(value, timeZone = 'America/New_York') {
  const timestamp = isoTimestamp(value)
  if (!timestamp) return 'UNKNOWN'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp)).toUpperCase()
}

function formatDateTime(value, timeZone = 'America/New_York') {
  const timestamp = isoTimestamp(value)
  if (!timestamp) return 'UNKNOWN'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(timestamp)).toUpperCase()
}

function normalizedCadence(value) {
  const cadence = String(value ?? '').toLowerCase()
  if (!['daily', 'weekly'].includes(cadence)) {
    throw new Error(`Unsupported report cadence "${value}". Use daily or weekly.`)
  }
  return cadence
}

function normalizedWeights(basketConfig) {
  const validated = validateIndexBasketConfig(basketConfig, { source: 'Portfolio report index basket config' })
  return validated.components.map((component) => ({
    symbol: safeText(component?.symbol, 12).toUpperCase(),
    label: safeText(component?.label, 80),
    weight: finiteNumber(component?.targetWeight),
  }))
}

function normalizedBenchmarkSeries(accountStatus, weights) {
  const sourceRows = Array.isArray(accountStatus?.benchmarkHistory?.rows)
    ? accountStatus.benchmarkHistory.rows
    : []
  const rowsBySymbol = new Map(sourceRows.map((row) => [safeText(row?.symbol, 12).toUpperCase(), row]))
  const result = new Map()

  for (const component of weights) {
    const row = rowsBySymbol.get(component.symbol)
    const rawPoints = Array.isArray(row?.points) ? row.points : []
    const pointsByDate = new Map()
    for (const point of rawPoints) {
      const timestamp = isoTimestamp(point?.timestamp)
      const closeUsd = finiteNumber(point?.closeUsd)
      const key = dateKey(timestamp, MARKET_TIME_ZONE)
      if (!timestamp || !key || closeUsd === null || closeUsd <= 0) continue
      pointsByDate.set(key, { date: key, timestamp, closeUsd })
    }
    const points = [...pointsByDate.values()].sort((left, right) => left.date.localeCompare(right.date))
    if (points.length < 2) throw new Error(`Benchmark history for ${component.symbol} requires at least two valid daily closes.`)
    result.set(component.symbol, points)
  }
  return result
}

function commonDates(series, symbols) {
  const counts = new Map()
  for (const symbol of symbols) {
    for (const point of series.get(symbol) ?? []) counts.set(point.date, (counts.get(point.date) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count === symbols.length)
    .map(([date]) => date)
    .sort()
}

function reportDateRange(series, weights, cadence, completedCalendarDates, requestedPeriodEnd = null) {
  const completed = new Set(completedCalendarDates)
  const dates = commonDates(series, weights.map((row) => row.symbol)).filter((date) => completed.has(date))
  if (dates.length < 2) throw new Error('VOO and QQQM benchmark history has no common two-session range.')
  const endDate = requestedPeriodEnd ?? dates.at(-1)
  if (requestedPeriodEnd && !completed.has(requestedPeriodEnd)) {
    throw new Error(`Requested report period ${requestedPeriodEnd} is not a completed Alpaca market session.`)
  }
  if (!dates.includes(endDate)) {
    throw new Error(`Benchmark history is missing requested completed market session ${endDate}.`)
  }
  if (!requestedPeriodEnd && endDate !== completedCalendarDates.at(-1)) {
    throw new Error(`Benchmark history is missing the latest completed market session ${completedCalendarDates.at(-1)}.`)
  }
  const periodDates = dates.filter((date) => date <= endDate)
  if (periodDates.length < 2) throw new Error(`Report period ${endDate} has no prior common market session.`)
  if (cadence === 'daily') return { startDate: periodDates.at(-2), endDate, dates: periodDates.slice(-2) }

  const target = new Date(`${endDate}T12:00:00Z`).getTime() - 7 * DAY_MS
  const eligible = periodDates.filter((date) => Date.parse(`${date}T12:00:00Z`) <= target)
  const startDate = eligible.at(-1)
  if (!startDate) {
    throw new Error('Weekly benchmark history requires a common close at least seven calendar days before the endpoint.')
  }
  const selected = periodDates.filter((date) => date >= startDate && date <= endDate)
  if (selected.length < 2) throw new Error('Weekly benchmark history requires at least two common sessions.')
  return { startDate, endDate, dates: selected }
}

function benchmarkPerformance(series, weights, range) {
  const rows = weights.map((component) => {
    const byDate = new Map(series.get(component.symbol).map((point) => [point.date, point]))
    const start = byDate.get(range.startDate)
    const end = byDate.get(range.endDate)
    if (!start || !end) throw new Error(`${component.symbol} is missing a report boundary close.`)
    return {
      symbol: component.symbol,
      label: component.label,
      weight: component.weight,
      startCloseUsd: round(start.closeUsd, 4),
      endCloseUsd: round(end.closeUsd, 4),
      changeUsd: round(end.closeUsd - start.closeUsd, 4),
      returnPct: round(((end.closeUsd / start.closeUsd) - 1) * 100, 4),
    }
  })

  const pointMaps = new Map(weights.map((component) => [
    component.symbol,
    new Map(series.get(component.symbol).map((point) => [point.date, point])),
  ]))
  let basketGrowth = 1
  for (let index = 1; index < range.dates.length; index += 1) {
    const previousDate = range.dates[index - 1]
    const currentDate = range.dates[index]
    const sessionReturn = weights.reduce((sum, component) => {
      const previous = pointMaps.get(component.symbol).get(previousDate)?.closeUsd
      const current = pointMaps.get(component.symbol).get(currentDate)?.closeUsd
      if (!previous || !current) throw new Error(`Index basket cannot price the ${currentDate} session.`)
      return sum + component.weight * ((current / previous) - 1)
    }, 0)
    basketGrowth *= 1 + sessionReturn
  }

  return {
    rows,
    basket: {
      symbol: safeText('US-INDEX-BASKET', 32),
      label: weights.map((component) => `${Math.round(component.weight * 100)}% ${component.symbol}`).join(' / '),
      returnPct: round((basketGrowth - 1) * 100, 4),
    },
  }
}

function normalizedHistoryPoints(accountStatus) {
  const rawPoints = Array.isArray(accountStatus?.portfolioHistory?.points)
    ? accountStatus.portfolioHistory.points
    : []
  const pointsByDate = new Map()
  for (const point of rawPoints) {
    const timestamp = isoTimestamp(point?.timestamp)
    const equityUsd = finiteNumber(point?.equityUsd)
    const key = dateKey(timestamp, MARKET_TIME_ZONE)
    if (!timestamp || !key || equityUsd === null || equityUsd <= 0) continue
    pointsByDate.set(key, {
      date: key,
      timestamp,
      equityUsd,
      profitLossUsd: finiteNumber(point?.profitLossUsd),
      profitLossPct: finiteNumber(point?.profitLossPct),
    })
  }
  return [...pointsByDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export function completedMarketCalendarDates(accountStatus, asOf) {
  if (accountStatus?.marketCalendar?.source !== 'Alpaca US market calendar') {
    throw new Error('Portfolio reports require Alpaca US market-calendar telemetry.')
  }
  const clock = zonedClock(asOf, MARKET_TIME_ZONE)
  if (!clock) throw new Error('Portfolio report session-completion time is invalid.')
  const dates = []
  for (const row of Array.isArray(accountStatus?.marketCalendar?.rows) ? accountStatus.marketCalendar.rows : []) {
    const date = String(row?.date ?? '')
    if (!validDateKey(date)) continue
    const closeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(row?.close ?? ''))
    if (!closeMatch) throw new Error(`Alpaca market calendar session ${date} has no valid close time.`)
    const closeHour = Number(closeMatch[1])
    const closeMinute = Number(closeMatch[2])
    const closeSecond = Number(closeMatch[3] ?? 0)
    if (closeHour > 23 || closeMinute > 59 || closeSecond > 59) {
      throw new Error(`Alpaca market calendar session ${date} has an invalid close time.`)
    }
    const closeSeconds = closeHour * 3_600 + closeMinute * 60 + closeSecond
    if (date < clock.date || (date === clock.date && clock.seconds >= closeSeconds)) dates.push(date)
  }
  return [...new Set(dates)].sort()
}

function normalizedCalendarDates(accountStatus, asOf) {
  const dates = completedMarketCalendarDates(accountStatus, asOf)
  if (dates.length < 2) throw new Error('Alpaca US market calendar requires at least two valid sessions.')
  return dates
}

export function latestCompletedMarketSessionDate(accountStatus, asOf = new Date().toISOString()) {
  return completedMarketCalendarDates(accountStatus, asOf).at(-1) ?? null
}

function assertAlignedSessionGrid(series, weights, range, accountPoints, calendarDates) {
  const expected = range.dates
  const sources = [
    ...weights.map((component) => ({
      label: component.symbol,
      dates: (series.get(component.symbol) ?? [])
        .map((point) => point.date)
        .filter((date) => date >= range.startDate && date <= range.endDate),
    })),
    {
      label: 'Alpaca portfolio history',
      dates: accountPoints
        .map((point) => point.date)
        .filter((date) => date >= range.startDate && date <= range.endDate),
    },
    {
      label: 'Alpaca US market calendar',
      dates: calendarDates.filter((date) => date >= range.startDate && date <= range.endDate),
    },
  ]
  for (const source of sources) {
    if (source.dates.length !== expected.length || source.dates.some((date, index) => date !== expected[index])) {
      throw new Error(
        `${source.label} does not share the complete ${range.startDate} through ${range.endDate} session grid.`,
      )
    }
  }
}

function accountPerformance(accountStatus, cadence, range, historyPoints) {
  const equityUsd = finiteNumber(accountStatus?.account?.equityUsd)
  if (equityUsd === null || equityUsd <= 0) throw new Error('Broker account telemetry requires positive current equity.')

  const start = historyPoints.find((point) => point.date === range.startDate) ?? null
  const end = historyPoints.find((point) => point.date === range.endDate) ?? null
  if (!start || !end) {
    throw new Error(
      `${cadence === 'daily' ? 'Daily' : 'Weekly'} account performance requires exact portfolio-history points `
      + `for ${range.startDate} and ${range.endDate}.`,
    )
  }

  const cumulativeStart = finiteNumber(start.profitLossPct)
  const cumulativeEnd = finiteNumber(end.profitLossPct)
  const returnPct = cumulativeStart !== null && cumulativeEnd !== null && cumulativeStart > -100
    ? (((1 + cumulativeEnd / 100) / (1 + cumulativeStart / 100)) - 1) * 100
    : ((end.equityUsd / start.equityUsd) - 1) * 100
  const reportedPnl = finiteNumber(start.profitLossUsd) !== null && finiteNumber(end.profitLossUsd) !== null
    ? end.profitLossUsd - start.profitLossUsd
    : start.equityUsd * (returnPct / 100)

  return {
    equityUsd: round(equityUsd, 2),
    equityAsOf: isoTimestamp(accountStatus?.sourceGeneratedAt ?? accountStatus?.generatedAt),
    periodEndEquityUsd: round(end.equityUsd, 2),
    baseEquityUsd: round(start.equityUsd, 2),
    pnlUsd: round(reportedPnl, 2),
    returnPct: round(returnPct, 4),
    source: 'Alpaca portfolio history',
  }
}

function normalizedPositions(accountStatus, equityUsd) {
  if (!Array.isArray(accountStatus?.positions)) {
    throw new Error('Portfolio reports require an explicit Alpaca positions array.')
  }
  const aggregates = new Map([...EXECUTION_SYMBOLS].map((symbol) => [symbol, 0]))
  let otherMarketValueUsd = 0
  let otherPositionCount = 0
  let grossExposureUsd = 0
  for (const position of accountStatus.positions) {
    const symbol = safeText(position?.symbol, 12).toUpperCase()
    const marketValueUsd = finiteNumber(position?.marketValueUsd ?? position?.market_value)
    if (marketValueUsd === null) {
      throw new Error('Position telemetry contains an unpriced holding; portfolio allocation is unavailable.')
    }
    const side = String(position?.side ?? '').toLowerCase()
    if (!['long', 'short'].includes(side)) {
      throw new Error('Position telemetry contains a holding without an exact long or short side.')
    }
    const signedValue = (side === 'short' ? -1 : 1) * Math.abs(marketValueUsd)
    grossExposureUsd += Math.abs(signedValue)
    if (EXECUTION_SYMBOLS.has(symbol)) aggregates.set(symbol, aggregates.get(symbol) + signedValue)
    else {
      otherMarketValueUsd += signedValue
      otherPositionCount += 1
    }
  }
  const rows = [...aggregates.entries()].map(([symbol, marketValueUsd]) => ({
    symbol,
    marketValueUsd: round(marketValueUsd, 2),
    allocationPct: round((marketValueUsd / equityUsd) * 100, 4),
  }))
  if (otherPositionCount > 0) {
    rows.push({
      symbol: 'OTHER',
      marketValueUsd: round(otherMarketValueUsd, 2),
      allocationPct: round((otherMarketValueUsd / equityUsd) * 100, 4),
    })
  }
  const cashUsd = finiteNumber(accountStatus?.account?.cashUsd)
  if (cashUsd === null) throw new Error('Portfolio reports require numeric Alpaca cash telemetry.')
  rows.push({
    symbol: 'CASH',
    marketValueUsd: round(cashUsd, 2),
    allocationPct: round((cashUsd / equityUsd) * 100, 4),
  })
  return {
    rows,
    otherPositionCount,
    grossExposureUsd: round(grossExposureUsd, 2),
    grossExposurePct: round((grossExposureUsd / equityUsd) * 100, 4),
  }
}

function insightRows({ account, benchmark, allocations, risk, attribution }) {
  const relative = account.returnPct - benchmark.basket.returnPct
  const relativeUsd = account.baseEquityUsd * (relative / 100)
  const relation = relative > 0.00005 ? 'beat' : relative < -0.00005 ? 'lagged' : 'matched'
  const absoluteRelation = relation === 'matched' ? '' : ` by ${Math.abs(relative).toFixed(2)} pp`
  const subject = attribution.scope === 'dedicated-account' ? 'QORE dedicated account' : 'QORE account'
  const insights = [{
    kind: relative > 0.00005 ? 'positive' : relative < -0.00005 ? 'negative' : 'neutral',
    text: `${subject} ${relation} the configured index basket${absoluteRelation}; the hypothetical active gap was ${formatSignedCurrency(relativeUsd)} on opening equity.`,
  }]

  const sortedIndexes = [...benchmark.rows].sort((left, right) => right.returnPct - left.returnPct)
  if (sortedIndexes.length >= 2) {
    insights.push({
      kind: 'neutral',
      text: `${sortedIndexes[0].symbol} led ${sortedIndexes.at(-1).symbol} by ${(sortedIndexes[0].returnPct - sortedIndexes.at(-1).returnPct).toFixed(2)} pp.`,
    })
  }

  const blockedReasons = Array.isArray(risk?.blockedReasons)
    ? risk.blockedReasons.map((value) => safeText(value, 180)).filter(Boolean)
    : []
  if (blockedReasons.length) {
    insights.push({
      kind: 'negative',
      text: `${risk.blockCount} operational risk gate${risk.blockCount === 1 ? '' : 's'} blocked: ${blockedReasons[0]}`,
    })
  } else if (risk?.reportedWarningCount > 0) {
    insights.push({
      kind: 'neutral',
      text: `Runtime risk telemetry reported ${risk.reportedWarningCount} warning${risk.reportedWarningCount === 1 ? '' : 's'} with no active blocked gate.`,
    })
  } else if (allocations.otherPositionCount > 0) {
    insights.push({
      kind: 'negative',
      text: `${allocations.otherPositionCount} non-QORE position${allocations.otherPositionCount === 1 ? '' : 's'} were aggregated as OTHER; results remain account-level.`,
    })
  } else {
    const cash = allocations.rows.find((row) => row.symbol === 'CASH')
    insights.push({
      kind: 'neutral',
      text: `Gross ETF exposure was ${formatPercent(allocations.grossExposurePct)} of equity; cash was ${formatPercent(cash?.allocationPct)}.`,
    })
  }
  return insights.slice(0, 3)
}

function runtimeFreshness(snapshot, {
  expectedServiceId,
  label,
  generatedAt,
  maxAgeHours,
} = {}) {
  if (!snapshot) return { status: 'unavailable', generatedAt: null, detail: `${label} is unavailable.` }
  if (snapshot?.serviceId !== expectedServiceId) {
    return { status: 'invalid', generatedAt: null, detail: `${label} has an invalid service identity.` }
  }
  const snapshotGeneratedAt = isoTimestamp(snapshot?.generatedAt)
  const now = Date.parse(generatedAt)
  const timestamp = Date.parse(snapshotGeneratedAt)
  const maxAgeMs = Number(maxAgeHours) * 3_600_000
  if (!snapshotGeneratedAt || !Number.isFinite(timestamp) || !Number.isFinite(now)) {
    return { status: 'invalid', generatedAt: snapshotGeneratedAt, detail: `${label} has an invalid timestamp.` }
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error('maxRuntimeStateAgeHours must be positive.')
  }
  if (timestamp > now + 15 * 60_000) {
    return { status: 'invalid', generatedAt: snapshotGeneratedAt, detail: `${label} is future-dated.` }
  }
  if (now - timestamp > maxAgeMs) {
    return { status: 'stale', generatedAt: snapshotGeneratedAt, detail: `${label} is stale.` }
  }
  return { status: 'current', generatedAt: snapshotGeneratedAt, detail: null }
}

function normalizedRisk(riskSnapshot, generatedAt, maxRuntimeStateAgeHours) {
  const freshness = runtimeFreshness(riskSnapshot, {
    expectedServiceId: 'qore-live-risk-and-kill-switch-state',
    label: 'Runtime risk telemetry',
    generatedAt,
    maxAgeHours: maxRuntimeStateAgeHours,
  })
  const killSwitchEngaged = typeof riskSnapshot?.operator?.killSwitchEngaged === 'boolean'
    ? riskSnapshot.operator.killSwitchEngaged
    : null
  const reportedBlockCount = Array.isArray(riskSnapshot?.blockedReasons)
    ? Math.min(99, riskSnapshot.blockedReasons.length)
    : 0
  const reportedOperatorGate = Array.isArray(riskSnapshot?.blockedReasons)
    && riskSnapshot.blockedReasons.some((reason) => /(?:kill[\s-]*switch|operator)/i.test(String(reason ?? '')))
  const reportedWarningCount = Array.isArray(riskSnapshot?.warnings)
    ? Math.min(99, riskSnapshot.warnings.length)
    : 0
  const blockedReasons = []
  if (freshness.status !== 'current') blockedReasons.push(freshness.detail)
  if (killSwitchEngaged === true) blockedReasons.push('The trading kill switch is engaged.')
  else if (killSwitchEngaged === null) blockedReasons.push('Operator kill-switch state is unavailable.')
  if (freshness.status === 'current' && reportedBlockCount > 0) {
    blockedReasons.push(`Runtime risk service reported ${reportedBlockCount} blocked gate${reportedBlockCount === 1 ? '' : 's'}.`)
  }
  const derivedBlockCount = (freshness.status === 'current' ? 0 : 1)
    + (killSwitchEngaged === true || killSwitchEngaged === null
      ? freshness.status === 'current' && reportedOperatorGate ? 0 : 1
      : 0)
  const blockCount = derivedBlockCount + (freshness.status === 'current' ? reportedBlockCount : 0)
  return {
    status: freshness.status,
    generatedAt: freshness.generatedAt,
    killSwitchEngaged,
    reportedBlockCount,
    reportedWarningCount,
    blockCount,
    blockedReasons: [...new Set(blockedReasons.filter(Boolean))].slice(0, 8),
    warnings: reportedWarningCount > 0
      ? [`Runtime risk service reported ${reportedWarningCount} warning${reportedWarningCount === 1 ? '' : 's'}.`]
      : [],
  }
}

function normalizedTarget(signalSnapshot, generatedAt, maxRuntimeStateAgeHours) {
  const freshness = runtimeFreshness(signalSnapshot, {
    expectedServiceId: 'qore-live-signal-intent-reconcile',
    label: 'Signal intent',
    generatedAt,
    maxAgeHours: maxRuntimeStateAgeHours,
  })
  if (freshness.status !== 'current' || signalSnapshot?.stale === true) {
    return {
      target: null,
      status: signalSnapshot?.stale === true ? 'stale' : freshness.status,
      generatedAt: freshness.generatedAt,
    }
  }
  const intent = signalSnapshot?.intent
  const gasPosition = finiteNumber(intent?.gasPosition)
  const indexFraction = finiteNumber(intent?.indexFraction)
  const cashFraction = finiteNumber(intent?.cashFraction)
  const targetDate = safeText(intent?.targetDate, 24)
  const derivedDirection = gasPosition > 0 ? 'LONG' : gasPosition < 0 ? 'SHORT' : gasPosition === 0 ? 'FLAT' : null
  const direction = safeText(intent?.direction, 16).toUpperCase()
  const total = gasPosition === null || indexFraction === null || cashFraction === null
    ? null
    : Math.abs(gasPosition) + indexFraction + cashFraction
  const valid = intent?.strategyId === 'ngas-all-year-beta'
    && gasPosition !== null && gasPosition >= -1 && gasPosition <= 1
    && indexFraction !== null && indexFraction >= 0 && indexFraction <= 1
    && cashFraction !== null && cashFraction >= 0 && cashFraction <= 1
    && total !== null && Math.abs(total - 1) <= 0.001
    && direction === derivedDirection
    && validDateKey(targetDate)
  if (!valid) return { target: null, status: 'invalid', generatedAt: freshness.generatedAt }
  return {
    status: 'current',
    generatedAt: freshness.generatedAt,
    target: {
      direction,
      gasPosition: round(gasPosition, 4),
      indexFraction: round(indexFraction, 4),
      cashFraction: round(cashFraction, 4),
      targetDate,
      generatedAt: freshness.generatedAt,
    },
  }
}

export function buildPortfolioReport({
  accountStatus,
  signalSnapshot = null,
  riskSnapshot = null,
  basketConfig,
  cadence = 'daily',
  generatedAt = new Date().toISOString(),
  timeZone = 'America/New_York',
  maxRuntimeStateAgeHours = 6,
  dedicatedQoreAccount = false,
  periodEnd = null,
} = {}) {
  const normalized = normalizedCadence(cadence)
  const requestedPeriodEnd = periodEnd === null ? null : String(periodEnd)
  if (requestedPeriodEnd !== null && !validDateKey(requestedPeriodEnd)) {
    throw new Error('Portfolio report periodEnd must be a valid YYYY-MM-DD date.')
  }
  const reportGeneratedAt = isoTimestamp(generatedAt)
  if (!reportGeneratedAt) throw new Error('Portfolio report generatedAt must be a valid timestamp.')
  if (!accountStatus || accountStatus?.brokerConnected !== true) {
    throw new Error('A connected, read-only Alpaca account-status snapshot is required before generating a report.')
  }
  const mode = safeText(accountStatus?.mode, 24).toLowerCase()
  if (!['dry-run', 'paper', 'live'].includes(mode)) {
    throw new Error('Portfolio reports require an explicit dry-run, paper, or live broker mode.')
  }
  if (accountStatus?.serviceId !== 'qore-alpaca-broker-status') {
    throw new Error('Portfolio reports require qore-alpaca-broker-status telemetry.')
  }
  if (accountStatus?.benchmarkHistory?.source !== 'Alpaca historical stock bars'
      || accountStatus?.benchmarkHistory?.timeframe !== '1Day'
      || accountStatus?.benchmarkHistory?.adjustment !== 'all') {
    throw new Error('Portfolio reports require adjusted Alpaca 1Day benchmark-history telemetry.')
  }
  const benchmarkFeed = safeText(accountStatus?.benchmarkHistory?.feed, 24).toLowerCase()
  if (!['iex', 'sip'].includes(benchmarkFeed)) {
    throw new Error('Portfolio reports require an explicit IEX or SIP stock benchmark feed.')
  }
  if (accountStatus?.portfolioHistory?.timeframe !== '1D') {
    throw new Error('Portfolio reports require Alpaca portfolio history with exact timeframe 1D.')
  }
  const performanceCaptureTimes = [
    isoTimestamp(accountStatus?.portfolioHistory?.generatedAt),
    isoTimestamp(accountStatus?.benchmarkHistory?.generatedAt),
  ]
  if (performanceCaptureTimes.some((value) => !value)) {
    throw new Error('Portfolio reports require explicit portfolio and benchmark capture timestamps.')
  }
  if (performanceCaptureTimes.some((value) => Date.parse(value) > Date.parse(reportGeneratedAt))) {
    throw new Error('Portfolio performance telemetry is future-dated relative to report generation.')
  }
  const performanceCaptureEpochs = performanceCaptureTimes.map((value) => Date.parse(value))
  if (Math.max(...performanceCaptureEpochs) - Math.min(...performanceCaptureEpochs) > 5 * 60_000) {
    throw new Error('Portfolio and benchmark capture timestamps differ by more than five minutes.')
  }
  const performanceCapturedAt = performanceCaptureTimes.sort().at(0)

  const weights = normalizedWeights(basketConfig)
  const calendarDates = normalizedCalendarDates(accountStatus, performanceCapturedAt)
  const series = normalizedBenchmarkSeries(accountStatus, weights)
  const range = reportDateRange(series, weights, normalized, calendarDates, requestedPeriodEnd)
  const historyPoints = normalizedHistoryPoints(accountStatus)
  assertAlignedSessionGrid(series, weights, range, historyPoints, calendarDates)
  const benchmark = benchmarkPerformance(series, weights, range)
  const account = accountPerformance(accountStatus, normalized, range, historyPoints)
  const allocations = normalizedPositions(accountStatus, account.equityUsd)
  const attribution = {
    requestedScope: dedicatedQoreAccount === true ? 'dedicated-account' : 'account',
    scope: dedicatedQoreAccount === true && allocations.otherPositionCount === 0 ? 'dedicated-account' : 'account',
  }
  const relativePctPoints = round(account.returnPct - benchmark.basket.returnPct, 4)
  const relativeUsd = round(account.baseEquityUsd * (relativePctPoints / 100), 2)
  const risk = normalizedRisk(riskSnapshot, reportGeneratedAt, maxRuntimeStateAgeHours)
  const targetState = normalizedTarget(signalSnapshot, reportGeneratedAt, maxRuntimeStateAgeHours)

  const report = {
    schemaVersion: 1,
    serviceId: 'qore-portfolio-report',
    strategyId: 'ngas-all-year-beta',
    generatedAt: reportGeneratedAt,
    timeZone,
    cadence: normalized,
    period: { startDate: range.startDate, endDate: range.endDate },
    mode,
    account,
    benchmark: {
      source: 'Alpaca historical stock bars',
      feed: benchmarkFeed,
      ...benchmark,
    },
    relative: { pctPoints: relativePctPoints, usd: relativeUsd },
    allocations,
    attribution,
    target: targetState.target,
    targetStatus: { status: targetState.status, generatedAt: targetState.generatedAt },
    risk,
  }
  report.insights = insightRows(report)
  return report
}

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function formatCurrency(value, digits = 0) {
  const numeric = finiteNumber(value)
  if (numeric === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numeric)
}

function formatSignedCurrency(value, digits = 0) {
  const numeric = finiteNumber(value)
  if (numeric === null) return '—'
  const formatted = formatCurrency(Math.abs(numeric), digits)
  return `${numeric > 0 ? '+' : numeric < 0 ? '−' : ''}${formatted}`
}

function formatPercent(value, digits = 2, signed = false) {
  const numeric = finiteNumber(value)
  if (numeric === null) return '—'
  const sign = signed ? numeric > 0 ? '+' : numeric < 0 ? '−' : '' : numeric < 0 ? '−' : ''
  return `${sign}${Math.abs(numeric).toFixed(digits)}%`
}

function formatPercentagePoints(value, digits = 2) {
  const numeric = finiteNumber(value)
  if (numeric === null) return '—'
  const sign = numeric > 0 ? '+' : numeric < 0 ? '−' : ''
  return `${sign}${Math.abs(numeric).toFixed(digits)} PP`
}

function tone(value) {
  const numeric = finiteNumber(value)
  if (numeric === null || Math.abs(numeric) < 0.00005) return '#dce7de'
  return numeric > 0 ? '#87ff9f' : '#ff6b73'
}

function textLines(value, maxChars = 56, maxLines = 2) {
  const words = safeText(value, 240).split(/\s+/).filter(Boolean)
  const lines = []
  for (const word of words) {
    const current = lines.at(-1)
    if (!current || `${current} ${word}`.length > maxChars) lines.push(word)
    else lines[lines.length - 1] = `${current} ${word}`
    if (lines.length > maxLines) break
  }
  if (lines.length > maxLines) lines.length = maxLines
  const consumed = lines.join(' ').length
  if (consumed < safeText(value, 240).length && lines.length) {
    lines[lines.length - 1] = `${lines.at(-1).slice(0, Math.max(0, maxChars - 1)).trim()}…`
  }
  return lines
}

function scoreBar({ label, detail, value, y, max, primary = false }) {
  const normalized = Math.max(-1, Math.min(1, (finiteNumber(value) ?? 0) / max))
  const center = 513
  const width = Math.abs(normalized) * 250
  const x = normalized >= 0 ? center : center - width
  const color = primary ? tone(value) : '#758379'
  const bar = width > 0
    ? `<rect x="${x}" y="${y - 12}" width="${Math.max(2, width)}" height="10" rx="5" fill="${color}" opacity="${primary ? 1 : 0.72}"/>`
    : ''
  return `
    <text x="80" y="${y}" class="label">${xml(label)}</text>
    <text x="80" y="${y + 27}" class="detail">${xml(detail)}</text>
    <line x1="263" y1="${y - 7}" x2="763" y2="${y - 7}" class="track"/>
    <line x1="513" y1="${y - 15}" x2="513" y2="${y + 1}" class="zero"/>
    ${bar}
    <text x="795" y="${y + 2}" class="score" fill="${tone(value)}">${xml(formatPercent(value, 2, true))}</text>`
}

function allocationRow(row, y, max) {
  const magnitude = Math.min(max, Math.abs(finiteNumber(row?.allocationPct) ?? 0))
  const width = (magnitude / max) * 285
  const negative = (finiteNumber(row?.allocationPct) ?? 0) < 0
  const bar = width > 0
    ? `<rect x="955" y="${y - 12}" width="${Math.max(2, width)}" height="10" rx="5" fill="${negative ? '#ff6b73' : row.symbol === 'UNG' ? '#87ff9f' : '#758379'}" opacity="0.78"/>`
    : ''
  return `
    <text x="875" y="${y}" class="label">${xml(row.symbol)}</text>
    <rect x="955" y="${y - 12}" width="285" height="10" rx="5" fill="#132117"/>
    ${bar}
    <text x="1270" y="${y}" class="allocation-value">${xml(formatCurrency(row.marketValueUsd, 0))}</text>
    <text x="1515" y="${y}" class="allocation-pct">${xml(formatPercent(row.allocationPct, 1, true))}</text>`
}

export function renderPortfolioReportSvg(report) {
  const cadenceLabel = report.cadence.toUpperCase()
  const periodLabel = `${report.period.startDate} → ${report.period.endDate}`
  const relation = report.relative.pctPoints > 0 ? 'AHEAD' : report.relative.pctPoints < 0 ? 'BEHIND' : 'EVEN'
  const benchmarkRows = report.benchmark.rows
  const basketMix = benchmarkRows.map((row) => `${Math.round(row.weight * 100)}% ${row.symbol}`).join(' · ')
  const allocationRows = report.allocations.rows
  const allocationDomain = Math.max(100, Math.ceil(Math.max(
    0,
    ...allocationRows.map((row) => Math.abs(row?.allocationPct ?? 0)),
  ) / 25) * 25)
  const scoreDomain = Math.max(1, Math.ceil(Math.max(
    Math.abs(report.account.returnPct ?? 0),
    Math.abs(report.benchmark.basket.returnPct ?? 0),
    ...benchmarkRows.map((row) => Math.abs(row.returnPct ?? 0)),
  )))
  const allocationGap = allocationRows.length > 1 ? Math.min(54, 170 / (allocationRows.length - 1)) : 54
  const allocationEndY = 515 + Math.max(0, allocationRows.length - 1) * allocationGap
  const performanceLabel = report.attribution?.scope === 'dedicated-account' ? 'QORE DEDICATED' : 'QORE ACCOUNT'
  const attributionDisclosure = report.attribution?.scope === 'dedicated-account'
    ? 'DEDICATED-ACCOUNT VIEW · THIS IS NOT ORDER-LINEAGE STRATEGY ATTRIBUTION; CASH FLOWS OR MANUAL TRADES CAN DISTORT RESULTS.'
    : 'ACCOUNT-LEVEL COMPARISON · DEPOSITS, WITHDRAWALS, MANUAL TRADES, OR UNRELATED POSITIONS CAN DISTORT RESULTS.'
  const insights = report.insights.flatMap((insight, index) => {
    const lines = textLines(insight.text, 42, 3)
    const x = 80 + index * 500
    const y = 828
    const color = insight.kind === 'positive' ? '#87ff9f' : insight.kind === 'negative' ? '#ff6b73' : '#9baa9e'
    return [`<circle cx="${x + 4}" cy="${y - 7}" r="4" fill="${color}"/>`, ...lines.map((line, lineIndex) => (
      `<text x="${x + 24}" y="${y + lineIndex * 24}" class="insight">${xml(line)}</text>`
    ))].join('\n')
  }).join('\n')
  const target = report.target
    ? `${report.target.targetDate} · ${report.target.direction} UNG ${formatPercent((report.target.gasPosition ?? 0) * 100, 0, true)} · INDEX ${formatPercent((report.target.indexFraction ?? 0) * 100, 0)} · CASH ${formatPercent((report.target.cashFraction ?? 0) * 100, 0)}`
    : `${(report.targetStatus?.status ?? 'unavailable').toUpperCase()} TARGET SNAPSHOT`
  const riskLabel = report.risk.blockCount > 0
    ? `${report.risk.blockCount} RISK GATE${report.risk.blockCount === 1 ? '' : 'S'} BLOCKED`
    : report.risk.reportedWarningCount > 0
      ? `${report.risk.reportedWarningCount} RISK WARNING${report.risk.reportedWarningCount === 1 ? '' : 'S'} · NO ACTIVE BLOCKS`
      : report.risk.killSwitchEngaged === true ? 'KILL SWITCH ENGAGED' : 'NO ACTIVE RISK BLOCKS'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" role="img" aria-labelledby="title desc">
  <title id="title">QORE ${xml(cadenceLabel)} portfolio report</title>
  <desc id="desc">Portfolio equity, period return, VOO and QQQM benchmarks, index-relative performance, allocations, and operational insights.</desc>
  <defs>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#87ff9f" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#87ff9f" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
      <path d="M 44 0 L 0 0 0 44" fill="none" stroke="#132117" stroke-width="1" opacity="0.38"/>
    </pattern>
  </defs>
  <style>
    text { font-family: SFMono-Regular, Cascadia Code, DejaVu Sans Mono, monospace; }
    .eyebrow { fill: #758379; font-size: 16px; font-weight: 600; letter-spacing: 3px; }
    .wordmark { fill: #eef7f0; font-size: 25px; font-weight: 700; letter-spacing: 3px; }
    .wordmark-accent { fill: #87ff9f; }
    .hero { fill: #eef7f0; font-size: 66px; font-weight: 600; letter-spacing: -3px; }
    .hero-change { font-size: 26px; font-weight: 600; }
    .label { fill: #dce7de; font-size: 18px; font-weight: 600; letter-spacing: 1px; }
    .detail { fill: #758379; font-size: 13px; }
    .track { stroke: #1a2b1d; stroke-width: 10; stroke-linecap: round; }
    .zero { stroke: #45564a; stroke-width: 2; }
    .score { font-size: 21px; font-weight: 600; text-anchor: end; }
    .metric-label { fill: #758379; font-size: 13px; letter-spacing: 2px; }
    .metric-value { font-size: 30px; font-weight: 600; }
    .allocation-value { fill: #dce7de; font-size: 17px; font-weight: 600; text-anchor: end; }
    .allocation-pct { fill: #9baa9e; font-size: 16px; text-anchor: end; }
    .insight { fill: #c6d2c8; font-size: 17px; }
    .footer { fill: #758379; font-size: 13px; letter-spacing: 1px; }
  </style>
  <rect width="1600" height="1000" fill="#050806"/>
  <rect width="1600" height="1000" fill="url(#grid)"/>
  <circle cx="1450" cy="-20" r="390" fill="url(#glow)"/>
  <g transform="translate(80 64)">
    <path d="M34 0A34 34 0 1 1 16 5" fill="none" stroke="#87ff9f" stroke-width="7" stroke-linecap="round"/>
    <circle cx="34" cy="34" r="9" fill="#87ff9f"/>
    <text x="92" y="30" class="wordmark">QORE<tspan class="wordmark-accent">//NG</tspan></text>
    <text x="92" y="58" class="eyebrow">${xml(cadenceLabel)} PORTFOLIO BRIEF · ${xml(report.mode.toUpperCase())}</text>
  </g>
  <text x="1520" y="88" class="eyebrow" text-anchor="end">${xml(periodLabel)}</text>
  <line x1="80" y1="155" x2="1520" y2="155" stroke="#2d4a32"/>

  <text x="80" y="211" class="metric-label">CURRENT ALPACA EQUITY · AS OF ${xml(formatDateTime(report.account.equityAsOf, report.timeZone))}</text>
  <text x="80" y="286" class="hero">${xml(formatCurrency(report.account.equityUsd, 0))}</text>
  <text x="80" y="336" class="hero-change" fill="${tone(report.account.returnPct)}">PERIOD ${xml(formatSignedCurrency(report.account.pnlUsd, 0))}  ·  ${xml(formatPercent(report.account.returnPct, 2, true))}</text>
  <text x="80" y="371" class="detail">CLOSE-TO-CLOSE ${xml(performanceLabel)} ${xml(report.cadence.toUpperCase())} PERFORMANCE · ${xml(report.account.source.toUpperCase())}</text>

  <g transform="translate(910 196)">
    <text x="0" y="15" class="metric-label">VERSUS CONFIGURED INDEX BASKET</text>
    <text x="0" y="67" class="metric-value" fill="${tone(report.relative.pctPoints)}">${xml(formatPercentagePoints(report.relative.pctPoints, 2))}</text>
    <text x="0" y="108" class="metric-value" fill="${tone(report.relative.usd)}">${xml(formatSignedCurrency(report.relative.usd, 0))}</text>
    <text x="0" y="145" class="eyebrow" fill="${tone(report.relative.pctPoints)}">${xml(relation)} · HYPOTHETICAL ACTIVE GAP ON OPENING EQUITY</text>
  </g>

  <line x1="80" y1="420" x2="1520" y2="420" stroke="#1a2b1d"/>
  <text x="80" y="466" class="eyebrow">PERFORMANCE SCORECARD · SHARED SCALE ±${xml(scoreDomain)}%</text>
  ${scoreBar({ label: performanceLabel, detail: `${formatSignedCurrency(report.account.pnlUsd, 0)} · PERIOD-END EQUITY ${formatCurrency(report.account.periodEndEquityUsd, 0)}`, value: report.account.returnPct, y: 515, max: scoreDomain, primary: true })}
  ${benchmarkRows.map((row, index) => scoreBar({
    label: row.symbol,
    detail: `ADJ CLOSE ${formatCurrency(row.startCloseUsd, 2)} → ${formatCurrency(row.endCloseUsd, 2)} · Δ ${formatSignedCurrency(row.changeUsd, 2)}`,
    value: row.returnPct,
    y: 575 + index * 58,
    max: scoreDomain,
  })).join('\n')}
  ${scoreBar({ label: 'INDEX', detail: `${basketMix} · DAILY TARGET WEIGHT`, value: report.benchmark.basket.returnPct, y: 575 + benchmarkRows.length * 58, max: scoreDomain })}

  <line x1="840" y1="450" x2="840" y2="700" stroke="#1a2b1d"/>
  <text x="875" y="466" class="eyebrow">PORTFOLIO ALLOCATION · SCALE ${xml(allocationDomain)}%</text>
  ${allocationRows.map((row, index) => allocationRow(row, 515 + index * allocationGap, allocationDomain)).join('\n')}
  <text x="875" y="${allocationEndY + 36}" class="detail">GROSS EXPOSURE ${xml(formatCurrency(report.allocations.grossExposureUsd, 0))} · ${xml(formatPercent(report.allocations.grossExposurePct, 1))}</text>

  <line x1="80" y1="755" x2="1520" y2="755" stroke="#1a2b1d"/>
  <text x="80" y="792" class="eyebrow">WHAT MATTERED</text>
  ${insights}

  <text x="80" y="925" class="detail">${xml(attributionDisclosure)}</text>
  <line x1="80" y1="945" x2="1520" y2="945" stroke="#2d4a32"/>
  <text x="80" y="982" class="footer">TARGET · ${xml(target)}</text>
  <text x="1520" y="982" class="footer" text-anchor="end">${xml(riskLabel)} · ${xml((report.benchmark.feed ?? 'UNKNOWN').toUpperCase())} BENCHMARK · GENERATED ${xml(formatDate(report.generatedAt, report.timeZone))}</text>
</svg>`
}

export function reportCaption(report) {
  const subject = report.attribution?.scope === 'dedicated-account' ? 'Dedicated account' : 'Account'
  return [
    `QORE ${report.cadence.toUpperCase()} · ${report.mode.toUpperCase()} · ${report.period.endDate}`,
    `Equity ${formatCurrency(report.account.equityUsd, 0)} · ${subject} ${formatSignedCurrency(report.account.pnlUsd, 0)} (${formatPercent(report.account.returnPct, 2, true)})`,
    `Index basket ${formatPercent(report.benchmark.basket.returnPct, 2, true)} · active gap ${formatPercentagePoints(report.relative.pctPoints, 2).toLowerCase()} / hypothetical ${formatSignedCurrency(report.relative.usd, 0)}`,
  ].join('\n')
}

export const portfolioReportFormatters = {
  currency: formatCurrency,
  signedCurrency: formatSignedCurrency,
  percent: formatPercent,
  percentagePoints: formatPercentagePoints,
}
