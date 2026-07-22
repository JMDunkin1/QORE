import {
  eiaReportAvailableAtOpen,
  nasaPowerActualAvailableAtOpen,
} from './qore-signal-availability.mjs'
import { eiaStorageReleaseAt } from './eia-release-time.mjs'
import {
  executableLiveComponentActiveForDate,
  executableLiveComponentContract,
  liveAllYearImplementation,
  selectedContracts,
} from './qore-live-contract.mjs'
import {
  SUMMER_SHADOW_CHALLENGER,
  SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256,
  reversionMoveScale,
  summerShadowCandidate,
} from './qore-summer-shadow-challenger.mjs'
import {
  evaluateWinterTargetDecision,
  winterStorageSeasonStartFor,
} from './qore-winter-target-engine.mjs'
import {
  FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  validateForecastCalendarTemperatures,
} from './qore-weather-data-quality.mjs'

export { selectedContracts }

const { summer: SUMMER_IMPLEMENTATION, winter: WINTER_IMPLEMENTATION } = liveAllYearImplementation
const { summer: SUMMER, winterFollow: WINTER_FOLLOW, winterFade: WINTER_FADE } = selectedContracts
const WINTER_SELECTION = executableLiveComponentContract.winter.selected
const WINTER_RELIABILITY = new Map(Object.entries(WINTER_IMPLEMENTATION.sourceReliability))

export function numberFrom(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function std(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1))
}
function calendarDaysBetween(start, end) { return (Date.parse(end) - Date.parse(start)) / 86400000 }
function sourceFamily(sourceId) { return sourceId === 'gefs-mean' ? 'gefs' : sourceId }
function sourceGroup(sourceId) { return ['gfs', 'gefs-mean', 'graphcastgfs', 'aigfs'].includes(sourceId) ? 'ncep' : sourceId }

export function enrichForecastRows(scoreRows, locationRows, season, options = {}) {
  const validated = validateForecastCalendarTemperatures({
    scoreRows,
    locationRows,
    mode: options.temperatureQualityMode ?? 'reject',
    label: options.temperatureQualityLabel ?? `${season} forecast inputs`,
    scoreLocationAggregateContract: Object.hasOwn(options, 'scoreLocationAggregateContract')
      ? options.scoreLocationAggregateContract
      : FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  })
  const locationsByKey = new Map()
  for (const row of validated.locationRows) {
    const key = [row.sourceId, row.issueDate, row.targetDate, row.leadDays, row.modelId].join('|')
    locationsByKey.set(key, [...(locationsByKey.get(key) ?? []), row])
  }
  return validated.scoreRows.map((row) => {
    const rows = locationsByKey.get([row.sourceId, row.issueDate, row.targetDate, row.leadDays, row.modelId].join('|')) ?? []
    const sampledWeight = rows.reduce((sum, item) => sum + numberFrom(item.weight), 0)
    const weighted = (predicate) => sampledWeight
      ? rows.filter(predicate).reduce((sum, item) => sum + numberFrom(item.weight), 0) / sampledWeight
      : 0
    const cooling = rows.map((item) => ({
      value: Math.max(0, numberFrom(item.forecastMeanF) - SUMMER_IMPLEMENTATION.coolingDemand.baseF) -
        Math.max(0, numberFrom(item.normalMeanF) - SUMMER_IMPLEMENTATION.coolingDemand.baseF),
      weight: numberFrom(item.weight),
    }))
    const heating = rows.map((item) => ({
      value: Math.max(0, WINTER_IMPLEMENTATION.heatingDemand.baseF - numberFrom(item.forecastMeanF)) -
        Math.max(0, WINTER_IMPLEMENTATION.heatingDemand.baseF - numberFrom(item.normalMeanF)),
      weight: numberFrom(item.weight),
    }))
    return {
      ...row,
      leadDays: numberFrom(row.leadDays), weightedAnomalyF: numberFrom(row.weightedAnomalyF),
      sampledWeight: numberFrom(row.sampledWeight), locationCount: numberFrom(row.locationCount),
      sourceFamily: sourceFamily(row.sourceId), sourceGroup: sourceGroup(row.sourceId),
      coldCoveragePct: season === 'summer' ? weighted((item) => numberFrom(item.forecastAnomalyF) <= -5) : numberFrom(row.coveragePct),
      coldExtremeCount: season === 'summer' ? rows.filter((item) => numberFrom(item.forecastAnomalyF) <= -10).length : numberFrom(row.extremeCount),
      warmCoveragePct: weighted((item) => numberFrom(item.forecastAnomalyF) >= 8),
      warmExtremeCount: rows.filter((item) => numberFrom(item.forecastAnomalyF) >= 14).length,
      coolingDemandAnomalyF: sampledWeight ? cooling.reduce((sum, item) => sum + item.value * item.weight, 0) / sampledWeight : 0,
      heatingDemandAnomalyF: sampledWeight ? heating.reduce((sum, item) => sum + item.value * item.weight, 0) / sampledWeight : 0,
    }
  })
}

function sourceWeight(sourceId, candidate) {
  return candidate.sourceWeightMode === 'bg-shrink' ? (WINTER_RELIABILITY.get(sourceId) ?? 1) : 1
}

function sideStats(rows, side, candidate) {
  const scored = rows.map((row) => {
    const anomaly = side === 'cold' ? Math.max(0, -row.weightedAnomalyF) : Math.max(0, row.weightedAnomalyF)
    const coverage = side === 'cold' ? row.coldCoveragePct : row.warmCoveragePct
    const extremeCount = side === 'cold' ? row.coldExtremeCount : row.warmExtremeCount
    const weight = sourceWeight(row.sourceId, candidate)
    return { row, weight, anomaly, coverage, extremeCount,
      score: weight * (Math.max(0, anomaly - candidate.anomalyThreshold) + candidate.anomalyThreshold * 0.35) *
        Math.max(0, coverage - candidate.coverageThreshold + 0.25) * Math.sqrt(extremeCount + 1) }
  })
  const best = scored.toSorted((a, b) => b.score - a.score)[0]
  return {
    bestRow: best?.row ?? null,
    groups: [...new Set(rows.map((row) => row.sourceGroup))].sort(),
    families: [...new Set(rows.map((row) => row.sourceFamily))].sort(),
    sourceIds: [...new Set(rows.map((row) => row.sourceId))].sort(),
    maxStrength: best?.score ?? 0,
    averageCoverage: mean(scored.map((row) => row.coverage)),
    maxExtremeCount: Math.max(...scored.map((row) => row.extremeCount), 0),
  }
}

export function createSignal(rows, candidate, season) {
  const allowed = new Set(candidate.sourceIds)
  const scoped = rows.filter((row) => allowed.has(row.sourceId))
  const cold = sideStats(scoped.filter((row) => row.weightedAnomalyF <= -candidate.anomalyThreshold && row.coldCoveragePct >= candidate.coverageThreshold), 'cold', candidate)
  const warm = sideStats(scoped.filter((row) => row.weightedAnomalyF >= candidate.anomalyThreshold && row.warmCoveragePct >= candidate.coverageThreshold), 'warm', candidate)
  const winner = season === 'summer'
    ? { direction: 1, thesisKind: 'summer-heat-long', stats: warm, loser: cold }
    : cold.maxStrength >= warm.maxStrength
      ? { direction: 1, thesisKind: 'cold-long', stats: cold, loser: warm }
      : { direction: -1, thesisKind: 'warm-short', stats: warm, loser: cold }
  if (!winner.stats.bestRow || winner.stats.groups.length < candidate.minGroups || winner.stats.families.length < candidate.minFamilies) return null
  if (winner.stats.maxStrength <= winner.loser.maxStrength * 1.15) return null
  const margin = Math.max(0, winner.stats.maxStrength - winner.loser.maxStrength)
  const consensus = 0.6 + winner.stats.groups.length * 0.1 + winner.stats.families.length * 0.08 + Math.min(winner.stats.sourceIds.length, 5) * 0.035
  const confidence = clamp((1 / (1 + Math.exp(-(margin + winner.stats.maxStrength * 0.35 - 3.5) / 3.2))) * consensus, 0, 1)
  if (confidence < candidate.minConfidence) return null
  const best = winner.stats.bestRow
  const matchingDemandRows = rows.filter((row) => row.targetDate === best.targetDate && row.leadDays === best.leadDays)
  const matchingDemandWeight = matchingDemandRows.reduce((sum, row) => sum + Math.max(0.0001, numberFrom(row.sampledWeight, 1)), 0)
  const heatingDemandAnomalyF = matchingDemandWeight
    ? matchingDemandRows.reduce((sum, row) => sum + row.heatingDemandAnomalyF * Math.max(0.0001, numberFrom(row.sampledWeight, 1)), 0) / matchingDemandWeight
    : 0
  return {
    issueDate: best.issueDate, targetDate: best.targetDate, leadDays: best.leadDays,
    direction: winner.direction, thesisKind: winner.thesisKind, confidence: round(confidence),
    weightedAnomalyF: round(mean(scoped.map((row) => row.weightedAnomalyF)), 3),
    coolingDemandAnomalyF: round(mean(scoped.map((row) => row.coolingDemandAnomalyF)), 3),
    heatingDemandAnomalyF: round(heatingDemandAnomalyF, 3),
    coveragePct: round(winner.stats.averageCoverage), extremeCount: winner.stats.maxExtremeCount,
    sourceIds: [...new Set(scoped.map((row) => row.sourceId))].sort(),
    rank: round(winner.stats.maxStrength * confidence * Math.sqrt(winner.stats.groups.length + winner.stats.families.length)),
  }
}

function createHybridSignal(rows, candidate) {
  const allowed = new Set(candidate.sourceIds)
  const scoped = rows.filter((row) => allowed.has(row.sourceId))
  const calculate = (side) => {
    const sideRows = scoped.filter((row) => side === 'cold'
      ? row.weightedAnomalyF <= -candidate.anomalyThreshold && row.coldCoveragePct >= candidate.coverageThreshold
      : row.weightedAnomalyF >= candidate.anomalyThreshold && row.warmCoveragePct >= candidate.coverageThreshold)
    const strength = (row, includeExtreme = true) => {
      const anomaly = side === 'cold' ? Math.max(0, -row.weightedAnomalyF) : Math.max(0, row.weightedAnomalyF)
      const coverage = side === 'cold' ? row.coldCoveragePct : row.warmCoveragePct
      const extreme = side === 'cold' ? row.coldExtremeCount : row.warmExtremeCount
      return anomaly * coverage * (includeExtreme ? Math.sqrt(extreme + 1) : 1)
    }
    return {
      rows: sideRows,
      groups: [...new Set(sideRows.map((row) => row.sourceGroup))],
      families: [...new Set(sideRows.map((row) => row.sourceFamily))],
      bestRow: sideRows.toSorted((a, b) => strength(b, false) - strength(a, false))[0] ?? null,
      maxStrength: Math.max(...sideRows.map((row) => strength(row)), 0),
    }
  }
  const cold = calculate('cold'); const warm = calculate('warm')
  const winner = cold.maxStrength >= warm.maxStrength ? { side: 'cold', direction: 1, stats: cold, loser: warm } : { side: 'warm', direction: -1, stats: warm, loser: cold }
  if (!winner.stats.bestRow || winner.stats.groups.length < candidate.minGroups || winner.stats.families.length < candidate.minFamilies) return null
  if (winner.stats.maxStrength <= winner.loser.maxStrength * 1.1) return null
  const bonus = 0.65 + winner.stats.groups.length * 0.12 + winner.stats.families.length * 0.1 + Math.min(winner.stats.rows.length, 6) * 0.025
  const confidence = Math.min(1, winner.stats.maxStrength / 14 * bonus)
  if (confidence < candidate.minConfidence) return null
  const best = winner.stats.bestRow
  return {
    issueDate: best.issueDate, targetDate: best.targetDate, leadDays: best.leadDays,
    direction: winner.direction, thesisKind: winner.direction === 1 ? 'cold-long' : 'warm-short',
    confidence: round(confidence), weightedAnomalyF: round(mean(scoped.map((row) => row.weightedAnomalyF)), 3),
    coveragePct: round(winner.side === 'cold' ? best.coldCoveragePct : best.warmCoveragePct),
    extremeCount: winner.side === 'cold' ? best.coldExtremeCount : best.warmExtremeCount,
    sourceIds: [...new Set(scoped.map((row) => row.sourceId))].sort(), rank: round(winner.stats.maxStrength * confidence),
  }
}

function signalsFor(rows, candidate, season) {
  const grouped = new Map()
  for (const row of rows) grouped.set(row.issueDate, [...(grouped.get(row.issueDate) ?? []), row])
  return [...grouped.values()].map((group) => candidate.signalAlgorithm === 'weather-hybrid' ? createHybridSignal(group, candidate) : createSignal(group, candidate, season))
    .filter(Boolean).sort((a, b) => a.issueDate.localeCompare(b.issueDate))
}

function schedule(days, signals, candidate, season) {
  const byDate = new Map()
  const priorHeat = []
  const put = (index, payload) => {
    if (index < 0 || index >= days.length) return
    const current = byDate.get(days[index].date)
    if (!current || payload.rank > current.rank) byDate.set(days[index].date, payload)
  }
  for (const signal of signals) {
    const entry = days.findIndex((day) => day.date > signal.issueDate)
    const targetIndex = days.findIndex((day) => day.date >= signal.targetDate)
    const target = targetIndex < 0 ? days.length - 1 : targetIndex
    if (entry < 0 || target < entry) continue
    const followEnd = Math.min(target, entry + candidate.followHoldDays - 1)
    const isHeat = signal.thesisKind === 'summer-heat-long'
    const fresh = !isHeat || !priorHeat.some((date) => { const age = calendarDaysBetween(date, signal.issueDate); return age > 0 && age <= candidate.freshHeatLookbackDays })
    if (isHeat) priorHeat.push(signal.issueDate)
    if (fresh && candidate.useFollowLeg !== false) {
      for (let index = entry; index <= followEnd; index += 1) {
        let fraction = candidate.weatherFraction
        if (season === 'summer' && isHeat && days[index].summerStorageDeficit) {
          fraction = Math.min(
            SUMMER_IMPLEMENTATION.storageDeficitHeatMaxFraction,
            fraction * SUMMER_IMPLEMENTATION.storageDeficitHeatMultiplier,
          )
        }
        put(index, { ...signal, position: signal.direction * fraction, windowId: 'weather-follow', rank: signal.rank + 10 })
      }
    }
    const priorClose = days[Math.max(0, entry - 1)]?.gasClose
    const exitClose = days[followEnd]?.gasClose
    const move = priorClose && exitClose ? ((exitClose - priorClose) / priorClose) * 100 : 0
    if (Math.abs(move) < candidate.minRealizedMovePct) continue
    if (season === 'summer' && Math.sign(move) !== signal.direction) continue
    const moveScale = season === 'summer' ? reversionMoveScale(move, candidate) : 1
    if (moveScale <= 0) continue
    const reversionEntry = followEnd + 1
    if (season === 'summer' && isHeat && days[reversionEntry]?.summerStorageDeficit) continue
    for (let index = reversionEntry; index <= Math.min(days.length - 1, reversionEntry + candidate.reversionHoldDays - 1); index += 1) {
      let fraction = candidate.reversionFraction
      if (season === 'summer' && isHeat) {
        const demand = SUMMER_IMPLEMENTATION.coolingDemand
        fraction = signal.coolingDemandAnomalyF >= demand.extremeAnomalyF
          ? Math.min(demand.extremeMaximumReversionFraction, fraction + demand.extremeReversionAdd)
          : signal.coolingDemandAnomalyF >= demand.solidAnomalyF
            ? Math.min(demand.solidMaximumReversionFraction, fraction + demand.solidReversionAdd)
            : Math.min(fraction, Math.max(demand.minimumReversionFraction, fraction - demand.lowReversionSubtract))
      }
      const position = season === 'summer'
        ? -signal.direction * fraction * moveScale
        : -Math.sign(move || signal.direction) * fraction
      put(index, { ...signal, position, windowId: 'weather-reversion', thesisKind: position > 0 ? 'reversion-long' : 'reversion-short', realizedMovePct: round(move), rank: signal.rank + 5 })
    }
  }
  return byDate
}

function versionedStorageRows(storageRows, storageReleaseCalendar = null) {
  const rows = storageRows
    .map((row) => ({
      ...row,
      date: row.date,
      value: numberFrom(row.storageBcf),
      releasedAt: eiaStorageReleaseAt(row.date, storageReleaseCalendar),
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!rows.length) throw new Error('EIA storage input is empty; refusing to infer a storage-aware target.')
  const missingRelease = rows.find((row) => !row.releasedAt)
  if (missingRelease) {
    throw new Error(`Missing versioned EIA release timestamp for storage period ${missingRelease.date}`)
  }
  const outOfOrderRelease = rows.find(
    (row, index) => index > 0 && Date.parse(row.releasedAt) < Date.parse(rows[index - 1].releasedAt),
  )
  if (outOfOrderRelease) {
    throw new Error(`EIA release timestamps are not chronological at storage period ${outOfOrderRelease.date}`)
  }
  return rows
}

function latestStorageAvailableAtOpen(rows, date) {
  let low = 0
  let high = rows.length - 1
  let latest = null
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const row = rows[middle]
    if (eiaReportAvailableAtOpen(row.releasedAt, date)) {
      latest = row
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return latest
}

function winterStorageContext(rows, date) {
  const released = latestStorageAvailableAtOpen(rows, date)
  if (!released) return { available: false, storageSeasonDrawdownBcf: null, drawdownBcf: null }
  const seasonStart = winterStorageSeasonStartFor(released.date)
  const season = rows.filter((row) => row.date >= seasonStart && row.date <= released.date)
  const drawdownBcf = Math.max(...season.map((row) => row.value)) - released.value
  return {
    available: true,
    storageSeasonStart: seasonStart,
    storageSeasonDrawdownBcf: round(drawdownBcf, 2),
    drawdownBcf: round(drawdownBcf, 2),
    storageDate: released.date,
    storageReleaseAt: released.releasedAt,
    releaseCalendarStatus: 'versioned',
  }
}

function volatilityDirection(days, date) {
  const index = days.findIndex((day) => day.date === date)
  if (index < 2) return { direction: 0 }
  const contract = WINTER_IMPLEMENTATION.volatilityConfirmation
  const returns = []
  for (let cursor = Math.max(1, index - contract.lookbackSessions - 1); cursor < index - 1; cursor += 1) returns.push(((days[cursor].gasClose - days[cursor - 1].gasClose) / days[cursor - 1].gasClose) * 100)
  const previousReturnPct = ((days[index - 1].gasClose - days[index - 2].gasClose) / days[index - 2].gasClose) * 100
  const volatilityPct = std(returns)
  const reversalZ = volatilityPct ? previousReturnPct / volatilityPct : 0
  const qualifies = volatilityPct >= contract.minimumVolatilityPct && volatilityPct <= contract.maximumVolatilityPct && Math.abs(reversalZ) >= contract.minimumReversalZ
  return { direction: qualifies ? -Math.sign(previousReturnPct) : 0, previousReturnPct: round(previousReturnPct), volatilityPct: round(volatilityPct), reversalZ: round(reversalZ), qualifies }
}

function winterWeatherResolutionContext(forecastRows, actualWeatherRows, fadeRow, fadePosition, entryDate) {
  if (!fadeRow || fadePosition === 0) return { available: false, action: 'no-reversion', scale: 1 }
  const contract = WINTER_IMPLEMENTATION.weatherResolution
  const actual = nasaPowerActualAvailableAtOpen(fadeRow.targetDate, entryDate)
    ? actualWeatherRows.find((row) => row.date === fadeRow.targetDate && Number.isFinite(numberFrom(row.weightedAnomalyF, Number.NaN)))
    : null
  const eligible = actual ? [] : forecastRows.filter((row) => contract.sourceIds.includes(row.sourceId) && row.leadDays >= contract.minimumLeadDays && row.leadDays <= contract.maximumLeadDays && row.targetDate === fadeRow.targetDate && row.issueDate <= entryDate)
  const latestIssue = actual ? fadeRow.targetDate : eligible.map((row) => row.issueDate).sort().at(-1)
  const closeRows = actual ? [] : eligible.filter((row) => row.issueDate === latestIssue)
  if (!actual && !closeRows.length) {
    return {
      available: false,
      action: 'missing-kept',
      scale: 1,
      originalAnomalyF: round(fadeRow.weightedAnomalyF, 3),
    }
  }
  const weight = closeRows.reduce((sum, row) => sum + Math.max(0.0001, numberFrom(row.sampledWeight, 1)), 0)
  const resolutionAnomalyF = actual
    ? numberFrom(actual.weightedAnomalyF)
    : round(
        closeRows.reduce(
          (sum, row) => sum
            + row.weightedAnomalyF * Math.max(0.0001, numberFrom(row.sampledWeight, 1)),
          0,
        ) / weight,
        3,
      )
  const shiftF = resolutionAnomalyF - fadeRow.weightedAnomalyF
  const weatherGasDirection = shiftF < 0 ? 1 : shiftF > 0 ? -1 : 0
  const sameDirectionShift = weatherGasDirection !== 0 && weatherGasDirection === Math.sign(fadePosition)
  const adverseDirectionShift = weatherGasDirection !== 0 && weatherGasDirection === -Math.sign(fadePosition)
  return {
    available: true,
    source: actual ? 'actual' : 'close-forecast',
    issueDate: latestIssue,
    sourceIds: actual ? ['NASA POWER actual anomaly basket'] : [...new Set(closeRows.map((row) => row.sourceId))].sort(),
    originalAnomalyF: round(fadeRow.weightedAnomalyF, 3),
    resolutionAnomalyF: round(resolutionAnomalyF, 3),
    shiftF: round(shiftF, 3),
    absShiftF: round(Math.abs(shiftF), 3),
    reliefF: round(Math.abs(fadeRow.weightedAnomalyF) - Math.abs(resolutionAnomalyF), 3),
    weatherGasDirection,
    sameDirectionShift,
    adverseDirectionShift,
    action: 'kept',
    scale: 1,
  }
}

function summerStorageContext(storageRows, date) {
  const latest = latestStorageAvailableAtOpen(storageRows, date)
  if (!latest) {
    return {
      summerStorageDeficit: false,
      storageDate: '',
      storageReleaseAt: '',
      releaseCalendarStatus: 'versioned',
    }
  }
  const day = Math.floor((Date.parse(latest.date) - Date.parse(`${latest.date.slice(0, 4)}-01-01`)) / 86400000)
  const peers = storageRows.filter((row) => Number(row.date.slice(0, 4)) < Number(latest.date.slice(0, 4)) && Number(row.date.slice(0, 4)) >= Number(latest.date.slice(0, 4)) - SUMMER_IMPLEMENTATION.storageSeasonalLookbackYears)
    .filter((row) => Math.floor((Date.parse(row.date) - Date.parse(`${row.date.slice(0, 4)}-01-01`)) / 86400000 / 7) === Math.floor(day / 7))
  return {
    summerStorageDeficit: peers.length >= 3 && latest.value <= mean(peers.map((row) => row.value)),
    storageDate: latest.date,
    storageReleaseAt: latest.releasedAt,
    releaseCalendarStatus: 'versioned',
  }
}

const scheduleCache = new WeakMap()

function preparedSchedules(forecastRows, marketDays, storageRows, storageReleaseCalendar = null) {
  let marketCache = scheduleCache.get(forecastRows)
  if (!marketCache) { marketCache = new WeakMap(); scheduleCache.set(forecastRows, marketCache) }
  let storageCache = marketCache.get(marketDays)
  if (!storageCache) { storageCache = new WeakMap(); marketCache.set(marketDays, storageCache) }
  let releaseCalendarCache = storageCache.get(storageRows)
  if (!releaseCalendarCache) { releaseCalendarCache = new Map(); storageCache.set(storageRows, releaseCalendarCache) }
  let prepared = releaseCalendarCache.get(storageReleaseCalendar)
  if (prepared) return prepared
  const releasedStorageRows = versionedStorageRows(storageRows, storageReleaseCalendar)
  const days = marketDays.map((day) => ({ ...day, ...summerStorageContext(releasedStorageRows, day.date) }))
  const summerRows = forecastRows.filter((row) => Number(row.targetDate.slice(5, 7)) >= 5 && Number(row.targetDate.slice(5, 7)) <= 9 && row.leadDays === 7)
  const winterRows = forecastRows.filter((row) => [11, 12, 1, 2, 3].includes(Number(row.issueDate.slice(5, 7))) && row.leadDays >= 7 && row.leadDays <= 10)
  prepared = {
    days,
    releasedStorageRows,
    summer: schedule(days, signalsFor(summerRows, SUMMER, 'summer'), SUMMER, 'summer'),
    follow: schedule(days, signalsFor(winterRows, WINTER_FOLLOW, 'winter'), WINTER_FOLLOW, 'winter'),
    fade: schedule(days, signalsFor(winterRows, WINTER_FADE, 'winter'), WINTER_FADE, 'winter'),
  }
  releaseCalendarCache.set(storageReleaseCalendar, prepared)
  return prepared
}

export function inferSummerShadowTarget({
  forecastRows,
  marketDays,
  storageRows,
  storageReleaseCalendar = null,
  targetDate,
}) {
  const candidate = summerShadowCandidate(SUMMER)
  const releasedStorageRows = versionedStorageRows(storageRows, storageReleaseCalendar)
  const days = marketDays.map((day) => ({ ...day, ...summerStorageContext(releasedStorageRows, day.date) }))
  const summerRows = forecastRows.filter(
    (row) => Number(row.targetDate.slice(5, 7)) >= 5
      && Number(row.targetDate.slice(5, 7)) <= 9
      && row.leadDays === 7,
  )
  const scheduled = schedule(days, signalsFor(summerRows, candidate, 'summer'), candidate, 'summer')
  const selected = scheduled.get(targetDate) ?? null
  const position = selected?.position ?? 0
  const targetDay = days.find((day) => day.date === targetDate)
  return {
    strategyId: 'ngas-summer-shadow-challenger',
    componentStrategyId: position ? 'research-only-summer-shadow' : 'index-fallback',
    candidateId: SUMMER_SHADOW_CHALLENGER.challengerCandidateId,
    challengerContractDigestSha256: SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256,
    executionEligible: false,
    targetDate,
    direction: position > 0 ? 'long' : position < 0 ? 'short' : 'flat',
    gasPosition: round(position),
    indexFraction: round(Math.max(0, 1 - Math.abs(position))),
    cashFraction: 0,
    signalDate: selected?.issueDate ?? targetDate,
    confidence: selected?.confidence ?? 0,
    windowId: selected?.windowId ?? 'index-fallback',
    thesisKind: selected?.thesisKind ?? 'index-fallback',
    sourceIds: selected?.sourceIds ?? [],
    weightedAnomalyF: selected?.weightedAnomalyF ?? 0,
    realizedMovePct: selected?.realizedMovePct ?? null,
    diagnostics: {
      storage: targetDay
        ? {
            storageDate: targetDay.storageDate,
            storageReleaseAt: targetDay.storageReleaseAt,
            storageDeficit: targetDay.summerStorageDeficit,
            releaseCalendarStatus: targetDay.releaseCalendarStatus,
          }
        : null,
    },
  }
}

export function inferAllYearTarget({
  forecastRows,
  actualWeatherRows = [],
  marketDays,
  storageRows,
  storageReleaseCalendar = null,
  targetDate,
}) {
  const summerActive = executableLiveComponentActiveForDate({ season: 'summer', targetDate })
  const winterActive = executableLiveComponentActiveForDate({ season: 'winter', targetDate })
  const prepared = preparedSchedules(forecastRows, marketDays, storageRows, storageReleaseCalendar)
  const { days } = prepared
  const summer = prepared.summer.get(targetDate) ?? null
  const follow = prepared.follow.get(targetDate) ?? null
  const fade = prepared.fade.get(targetDate) ?? null
  let component = 'index-fallback'; let position = 0; let selected = null
  let windowId = 'index-fallback'; const diagnostics = {}
  const targetDay = days.find((day) => day.date === targetDate)
  if (targetDay && summerActive) {
    diagnostics.storage = {
      storageDate: targetDay.storageDate,
      storageReleaseAt: targetDay.storageReleaseAt,
      storageDeficit: targetDay.summerStorageDeficit,
      releaseCalendarStatus: targetDay.releaseCalendarStatus,
    }
  }
  if (summerActive && summer) {
    component = 'ngas-summer-alpha'; position = summer.position; selected = summer
    windowId = summer.windowId
  } else if (winterActive) {
    const storage = winterStorageContext(prepared.releasedStorageRows, targetDate)
    const vol = volatilityDirection(days, targetDate)
    diagnostics.rawRows = {
      follow: follow ? { issueDate: follow.issueDate, windowId: follow.windowId, thesisKind: follow.thesisKind, position: follow.position } : null,
      fade: fade ? { issueDate: fade.issueDate, windowId: fade.windowId, thesisKind: fade.thesisKind, position: fade.position } : null,
    }
    const blend = evaluateWinterTargetDecision({
      policy: WINTER_SELECTION,
      dualRow: follow,
      weatherRow: fade,
      volatilityPosition: vol.direction,
      storageContext: storage,
      weatherResolutionContext: winterWeatherResolutionContext(
        forecastRows,
        actualWeatherRows,
        fade,
        fade?.position ?? 0,
        targetDate,
      ),
      heatingDemandContext: follow
        ? { heatingDemandAnomalyF: numberFrom(follow.heatingDemandAnomalyF) }
        : null,
    })
    position = blend.position
    diagnostics.storage = {
      ...storage,
      allowed: blend.coldFollowStorage.allowed,
    }
    diagnostics.volatility = vol
    diagnostics.weatherResolution = blend.weatherResolution
    diagnostics.heatingDemand = blend.heatingDemand
    diagnostics.blend = {
      blendLeg: blend.blendLeg,
      followPosition: round(blend.followPosition),
      reversionPosition: round(blend.reversionPosition),
      overlayRiskMultiplier: blend.overlayRiskMultiplier,
    }
    if (position) {
      component = 'ngas-winter-alpha'
      selected = blend.dominantRow
      windowId = blend.followRow && blend.reversionRow
        ? 'winter-alpha-blend'
        : blend.followRow
          ? 'weather-follow'
          : 'weather-reversion'
    }
  }
  const executedPosition = round(position)
  return {
    strategyId: 'ngas-all-year-beta', componentStrategyId: component, targetDate,
    direction: executedPosition > 0 ? 'long' : executedPosition < 0 ? 'short' : 'flat',
    gasPosition: executedPosition,
    indexFraction: round(Math.max(0, 1 - Math.abs(executedPosition))),
    cashFraction: 0,
    signalDate: selected?.issueDate ?? targetDate, confidence: selected?.confidence ?? 0,
    windowId, thesisKind: selected?.thesisKind ?? 'index-fallback',
    sourceIds: selected?.sourceIds ?? [], weightedAnomalyF: selected?.weightedAnomalyF ?? 0,
    diagnostics,
  }
}
