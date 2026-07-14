const SUMMER = {
  candidateId: 'summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-wrnone-sdef1.25-vol0-fixed',
  sourceSetId: 'gfs-gefs-core', sourceIds: ['gfs', 'gefs-mean'], sourceWeightMode: 'equal',
  anomalyThreshold: 5, coverageThreshold: 0.25, minConfidence: 0.5, minGroups: 1, minFamilies: 2,
  weatherFraction: 0.35, reversionFraction: 0.35, followHoldDays: 3, reversionHoldDays: 1,
  minRealizedMovePct: 2, freshHeatLookbackDays: 3,
}

const WINTER_FOLLOW = {
  candidateId: 'dual-ncep-complex-bg-shrink-a5-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-vol0-fixed',
  sourceSetId: 'ncep-complex', sourceIds: ['gfs', 'gefs-mean', 'graphcastgfs', 'aigfs'], sourceWeightMode: 'bg-shrink',
  anomalyThreshold: 5, coverageThreshold: 0.5, minConfidence: 0.5, minGroups: 1, minFamilies: 2,
  weatherFraction: 0.25, reversionFraction: 0.2, followHoldDays: 3, reversionHoldDays: 2, minRealizedMovePct: 2,
}

const WINTER_FADE = {
  ...WINTER_FOLLOW,
  candidateId: 'fade-only-gfs-gefs-core-a5-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-fixed',
  sourceSetId: 'gfs-gefs-core', sourceIds: ['gfs', 'gefs-mean'], sourceWeightMode: 'equal',
  useFollowLeg: false,
  signalAlgorithm: 'weather-hybrid',
}

const WINTER_RELIABILITY = new Map([['gfs', 0.6092], ['gefs-mean', 1.167]])

export const selectedContracts = { summer: SUMMER, winterFollow: WINTER_FOLLOW, winterFade: WINTER_FADE }

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
function addDays(date, count) { return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10) }
function calendarDaysBetween(start, end) { return (Date.parse(end) - Date.parse(start)) / 86400000 }
function sourceFamily(sourceId) { return sourceId === 'gefs-mean' ? 'gefs' : sourceId }
function sourceGroup(sourceId) { return ['gfs', 'gefs-mean', 'graphcastgfs', 'aigfs'].includes(sourceId) ? 'ncep' : sourceId }

export function enrichForecastRows(scoreRows, locationRows, season) {
  const locationsByKey = new Map()
  for (const row of locationRows) {
    const key = [row.sourceId, row.issueDate, row.targetDate, row.leadDays, row.modelId].join('|')
    locationsByKey.set(key, [...(locationsByKey.get(key) ?? []), row])
  }
  return scoreRows.map((row) => {
    const rows = locationsByKey.get([row.sourceId, row.issueDate, row.targetDate, row.leadDays, row.modelId].join('|')) ?? []
    const sampledWeight = rows.reduce((sum, item) => sum + numberFrom(item.weight), 0)
    const weighted = (predicate) => sampledWeight
      ? rows.filter(predicate).reduce((sum, item) => sum + numberFrom(item.weight), 0) / sampledWeight
      : 0
    const cooling = rows.map((item) => ({
      value: Math.max(0, numberFrom(item.forecastMeanF) - 65) - Math.max(0, numberFrom(item.normalMeanF) - 65),
      weight: numberFrom(item.weight),
    }))
    const heating = rows.map((item) => ({
      value: Math.max(0, 65 - numberFrom(item.forecastMeanF)) - Math.max(0, 65 - numberFrom(item.normalMeanF)),
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
  const winner = cold.maxStrength >= warm.maxStrength
    ? { direction: season === 'summer' ? -1 : 1, thesisKind: season === 'summer' ? 'summer-cold-short' : 'cold-long', stats: cold, loser: warm }
    : { direction: season === 'summer' ? 1 : -1, thesisKind: season === 'summer' ? 'summer-heat-long' : 'warm-short', stats: warm, loser: cold }
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
    const target = days.findIndex((day) => day.date >= signal.targetDate)
    if (entry < 0 || target < entry) continue
    const followEnd = Math.min(target, entry + candidate.followHoldDays - 1)
    const isHeat = signal.thesisKind === 'summer-heat-long'
    const fresh = !isHeat || !priorHeat.some((date) => { const age = calendarDaysBetween(date, signal.issueDate); return age > 0 && age <= candidate.freshHeatLookbackDays })
    if (isHeat) priorHeat.push(signal.issueDate)
    if (fresh && candidate.useFollowLeg !== false) {
      for (let index = entry; index <= followEnd; index += 1) {
        let fraction = candidate.weatherFraction
        if (season === 'summer' && isHeat && days[index].summerStorageDeficit) fraction = Math.min(0.4375, fraction * 1.25)
        put(index, { ...signal, position: signal.direction * fraction, windowId: 'weather-follow', rank: signal.rank + 10 })
      }
    }
    const priorClose = days[Math.max(0, entry - 1)]?.gasClose
    const exitClose = days[followEnd]?.gasClose
    const move = priorClose && exitClose ? ((exitClose - priorClose) / priorClose) * 100 : 0
    if (Math.abs(move) < candidate.minRealizedMovePct) continue
    if (season === 'summer' && Math.sign(move) !== signal.direction) continue
    const reversionEntry = followEnd + 1
    if (season === 'summer' && isHeat && days[reversionEntry]?.summerStorageDeficit) continue
    for (let index = reversionEntry; index <= Math.min(days.length - 1, reversionEntry + candidate.reversionHoldDays - 1); index += 1) {
      let fraction = candidate.reversionFraction
      if (season === 'summer' && isHeat) {
        fraction = signal.coolingDemandAnomalyF >= 8 ? Math.min(0.5, fraction + 0.15)
          : signal.coolingDemandAnomalyF >= 5 ? Math.min(0.45, fraction + 0.05) : Math.min(fraction, Math.max(0.2, fraction - 0.15))
      }
      const position = season === 'summer' ? -signal.direction * fraction : -Math.sign(move || signal.direction) * fraction
      put(index, { ...signal, position, windowId: 'weather-reversion', thesisKind: position > 0 ? 'reversion-long' : 'reversion-short', realizedMovePct: round(move), rank: signal.rank + 5 })
    }
  }
  return byDate
}

function winterStorageAllowed(storageRows, date) {
  const rows = storageRows.map((row) => ({ date: row.date, value: numberFrom(row.storageBcf) })).filter((row) => row.value > 0).sort((a, b) => a.date.localeCompare(b.date))
  const released = rows.filter((row) => addDays(row.date, ((4 - new Date(`${row.date}T00:00:00Z`).getUTCDay() + 7) % 7) || 7) <= date).at(-1)
  if (!released) return { allowed: false, drawdownBcf: null }
  const month = Number(released.date.slice(5, 7)); const year = Number(released.date.slice(0, 4)); const seasonYear = month >= 11 ? year : year - 1
  const season = rows.filter((row) => row.date >= `${seasonYear}-11-01` && row.date <= released.date)
  const drawdownBcf = Math.max(...season.map((row) => row.value)) - released.value
  return { allowed: drawdownBcf >= 400, drawdownBcf: round(drawdownBcf, 2), storageDate: released.date }
}

function volatilityDirection(days, date) {
  const index = days.findIndex((day) => day.date === date)
  if (index < 2) return { direction: 0 }
  const returns = []
  for (let cursor = Math.max(1, index - 40); cursor < index; cursor += 1) returns.push(((days[cursor].gasClose - days[cursor - 1].gasClose) / days[cursor - 1].gasClose) * 100)
  const previousReturnPct = returns.at(-1) ?? 0
  const volatilityPct = std(returns)
  const reversalZ = volatilityPct ? previousReturnPct / volatilityPct : 0
  const qualifies = volatilityPct >= 2.5 && volatilityPct <= 6 && Math.abs(reversalZ) >= 0.8
  return { direction: qualifies ? -Math.sign(previousReturnPct) : 0, previousReturnPct: round(previousReturnPct), volatilityPct: round(volatilityPct), reversalZ: round(reversalZ), qualifies }
}

function winterWeatherResolution(forecastRows, fadeRow, fadePosition, entryDate, standalone) {
  if (!fadeRow || fadePosition === 0) return { position: fadePosition, action: 'no-reversion', scale: 1 }
  const eligible = forecastRows.filter((row) => ['gfs', 'gefs-mean'].includes(row.sourceId) && row.leadDays >= 1 && row.leadDays <= 3 && row.targetDate === fadeRow.targetDate && row.issueDate <= entryDate)
  const latestIssue = eligible.map((row) => row.issueDate).sort().at(-1)
  const closeRows = eligible.filter((row) => row.issueDate === latestIssue)
  if (!closeRows.length) return { position: fadePosition, action: 'missing-kept', scale: 1 }
  const weight = closeRows.reduce((sum, row) => sum + Math.max(0.0001, numberFrom(row.sampledWeight, 1)), 0)
  const resolutionAnomalyF = closeRows.reduce((sum, row) => sum + row.weightedAnomalyF * Math.max(0.0001, numberFrom(row.sampledWeight, 1)), 0) / weight
  const shiftF = resolutionAnomalyF - fadeRow.weightedAnomalyF
  const weatherGasDirection = shiftF < 0 ? 1 : shiftF > 0 ? -1 : 0
  const same = weatherGasDirection !== 0 && weatherGasDirection === Math.sign(fadePosition)
  const adverse = weatherGasDirection !== 0 && weatherGasDirection === -Math.sign(fadePosition)
  if (standalone && adverse) {
    return { position: 0, action: 'standalone-adverse-dropped', scale: 0, issueDate: latestIssue, resolutionAnomalyF: round(resolutionAnomalyF, 3), shiftF: round(shiftF, 3) }
  }
  const scale = same ? clamp(0.75 + Math.abs(shiftF) / 8, 0.75, 1.25)
    : adverse ? clamp(0.9 - Math.abs(shiftF) / 10, 0.45, 0.9) : 0.85
  return {
    position: fadePosition * scale,
    action: same ? 'confirm-scaled' : adverse ? 'adverse-shrunk' : 'neutral-shrunk',
    scale: round(scale), issueDate: latestIssue, resolutionAnomalyF: round(resolutionAnomalyF, 3), shiftF: round(shiftF, 3),
  }
}

function summerStorageDeficit(storageRows, date) {
  const cutoff = addDays(date, -7)
  const rows = storageRows.map((row) => ({ ...row, value: numberFrom(row.storageBcf) })).filter((row) => row.date <= cutoff && row.value > 0).sort((a, b) => a.date.localeCompare(b.date))
  const latest = rows.at(-1)
  if (!latest) return false
  const day = Math.floor((Date.parse(latest.date) - Date.parse(`${latest.date.slice(0, 4)}-01-01`)) / 86400000)
  const peers = rows.filter((row) => Number(row.date.slice(0, 4)) < Number(latest.date.slice(0, 4)) && Number(row.date.slice(0, 4)) >= Number(latest.date.slice(0, 4)) - 5)
    .filter((row) => Math.floor((Date.parse(row.date) - Date.parse(`${row.date.slice(0, 4)}-01-01`)) / 86400000 / 7) === Math.floor(day / 7))
  return peers.length >= 3 && latest.value <= mean(peers.map((row) => row.value))
}

export function inferAllYearTarget({ forecastRows, marketDays, storageRows, targetDate }) {
  const month = Number(targetDate.slice(5, 7))
  const days = marketDays.map((day) => ({ ...day, summerStorageDeficit: summerStorageDeficit(storageRows, day.date) }))
  const summerRows = forecastRows.filter((row) => Number(row.issueDate.slice(5, 7)) >= 5 && Number(row.issueDate.slice(5, 7)) <= 9 && row.leadDays === 7)
  const winterRows = forecastRows.filter((row) => [11, 12, 1, 2, 3].includes(Number(row.issueDate.slice(5, 7))) && row.leadDays >= 7 && row.leadDays <= 10)
  const summer = schedule(days, signalsFor(summerRows, SUMMER, 'summer'), SUMMER, 'summer').get(targetDate) ?? null
  const follow = schedule(days, signalsFor(winterRows, WINTER_FOLLOW, 'winter'), WINTER_FOLLOW, 'winter').get(targetDate) ?? null
  const fade = schedule(days, signalsFor(winterRows, WINTER_FADE, 'winter'), WINTER_FADE, 'winter').get(targetDate) ?? null
  let component = 'index-fallback'; let position = 0; let selected = null; const diagnostics = {}
  if (month >= 5 && month <= 9 && summer) {
    component = 'ngas-summer-alpha'; position = summer.position; selected = summer
  } else if ([11, 12, 1, 2, 3].includes(month)) {
    const followRow = follow?.windowId === 'weather-follow' ? follow : null
    const fadeRow = fade?.windowId === 'weather-reversion' ? fade : null
    const storage = winterStorageAllowed(storageRows, targetDate)
    const vol = volatilityDirection(days, targetDate)
    diagnostics.storage = storage; diagnostics.volatility = vol
    diagnostics.rawRows = {
      follow: follow ? { issueDate: follow.issueDate, windowId: follow.windowId, thesisKind: follow.thesisKind, position: follow.position } : null,
      fade: fade ? { issueDate: fade.issueDate, windowId: fade.windowId, thesisKind: fade.thesisKind, position: fade.position } : null,
    }
    let followPosition = followRow?.position ?? 0; let fadePosition = fadeRow?.position ?? 0
    if (followRow?.thesisKind === 'cold-long' && !storage.allowed) { followPosition = 0; fadePosition = 0 }
    if (followPosition || fadePosition) {
      if (followRow?.thesisKind === 'cold-long' && followPosition) {
        if (!fadePosition || Math.sign(fadePosition) !== Math.sign(followPosition)) fadePosition = 0
      } else if (fadeRow?.thesisKind === 'reversion-long' && fadePosition) {
        if (vol.direction !== 1) { followPosition = 0; fadePosition = 0 }
        else if (!followPosition || Math.sign(followPosition) !== Math.sign(fadePosition)) followPosition = 0
      } else if (fadeRow?.thesisKind === 'reversion-short' && fadePosition) {
        if (!followPosition || Math.sign(followPosition) !== Math.sign(fadePosition)) followPosition = 0
      } else {
        followPosition = 0; fadePosition = 0
      }
    }
    const volConfirmedLongFade = fadeRow?.thesisKind === 'reversion-long' && vol.direction === 1 && fadePosition !== 0
    const resolution = winterWeatherResolution(forecastRows, fadeRow, fadePosition, targetDate, followPosition === 0 && !volConfirmedLongFade)
    fadePosition = resolution.position
    if (resolution.scale === 0 && followRow?.thesisKind !== 'cold-long') followPosition = 0
    diagnostics.weatherResolution = resolution
    position = clamp(followPosition + fadePosition, -0.45, 0.45)
    if (followRow && followPosition) {
      const demand = numberFrom(followRow.heatingDemandAnomalyF)
      const confirms = Math.sign(demand) === (followRow.thesisKind === 'cold-long' ? 1 : -1)
      const scale = !confirms ? 0 : Math.abs(demand) >= 12 ? 1.25 : Math.abs(demand) >= 8 ? 1.1 : Math.abs(demand) >= 4 ? 1 : 0.65
      position = clamp(position - followPosition + followPosition * scale, -0.45, 0.45)
      diagnostics.heatingDemand = { anomalyF: round(demand), scale }
    }
    position = clamp(position * 1.25, -0.5625, 0.5625)
    if (position) { component = 'ngas-winter-alpha'; selected = Math.abs(followPosition) >= Math.abs(fadePosition) ? followRow : fadeRow }
  }
  return {
    strategyId: 'ngas-all-year-beta', componentStrategyId: component, targetDate,
    direction: position > 0 ? 'long' : position < 0 ? 'short' : 'flat', gasPosition: round(position),
    indexFraction: round(Math.max(0, 1 - Math.abs(position))), cashFraction: 0,
    signalDate: selected?.issueDate ?? targetDate, confidence: selected?.confidence ?? 0,
    windowId: selected?.windowId ?? 'index-fallback', thesisKind: selected?.thesisKind ?? 'index-fallback',
    sourceIds: selected?.sourceIds ?? [], weightedAnomalyF: selected?.weightedAnomalyF ?? 0,
    diagnostics,
  }
}
