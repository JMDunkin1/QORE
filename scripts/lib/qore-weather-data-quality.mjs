import { SUMMER_FORECAST_LOCATION_UNIVERSE } from './qore-summer-location-universe.mjs'

export const FORECAST_TEMPERATURE_PLAUSIBILITY = Object.freeze({
  minimumF: -150,
  maximumF: 160,
  anomalyToleranceF: 0.01,
  groupPolicy: 'source-issue-target-lead-atomic',
})

export const FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  contractId: 'qore-executable-score-location-aggregate-v1',
  locationUniverse: SUMMER_FORECAST_LOCATION_UNIVERSE,
  coldCoverageAnomalyF: -8,
  extremeAnomalyF: -14,
  aggregatePrecisionDecimals: 3,
  locationWeightTolerance: 1e-9,
  weightedAnomalyToleranceF: 1e-9,
})
export const LEGACY_FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT = Object.freeze({
  ...FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  contractId: 'qore-versioned-legacy-score-location-aggregate-v1',
  weightedAnomalyToleranceF: 0.001000001,
})

const GROUP_FIELDS = ['sourceId', 'issueDate', 'targetDate', 'leadDays']

function stringValue(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function numericValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return Number.NaN
  return Number(value)
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function groupIdentity(row, fallbackSourceId = '') {
  return {
    sourceId: stringValue(row?.sourceId, stringValue(fallbackSourceId, 'unknown-source')),
    issueDate: stringValue(row?.issueDate, 'unknown-issue'),
    targetDate: stringValue(row?.targetDate, 'unknown-target'),
    leadDays: stringValue(row?.leadDays, 'unknown-lead'),
  }
}

export function forecastLocationGroupKey(row, options = {}) {
  const identity = groupIdentity(row, options.sourceId)
  return GROUP_FIELDS.map((field) => identity[field]).join('|')
}

export function forecastScoreLocationGroupKey(row, options = {}) {
  return [
    forecastLocationGroupKey(row, options),
    stringValue(row?.windowId, 'unknown-window'),
    stringValue(row?.modelId, 'unknown-model'),
  ].join('|')
}

export function forecastLocationTemperatureIssues(row) {
  const forecastMeanF = numericValue(row?.forecastMeanF)
  const normalMeanF = numericValue(row?.normalMeanF)
  const forecastAnomalyF = numericValue(row?.forecastAnomalyF)
  const issues = []

  for (const [field, value] of [
    ['forecastMeanF', forecastMeanF],
    ['normalMeanF', normalMeanF],
    ['forecastAnomalyF', forecastAnomalyF],
  ]) {
    if (!Number.isFinite(value)) issues.push(`${field}-not-finite`)
  }

  for (const [field, value] of [
    ['forecastMeanF', forecastMeanF],
    ['normalMeanF', normalMeanF],
  ]) {
    if (
      Number.isFinite(value)
      && (value < FORECAST_TEMPERATURE_PLAUSIBILITY.minimumF
        || value > FORECAST_TEMPERATURE_PLAUSIBILITY.maximumF)
    ) {
      issues.push(`${field}-outside-physical-range`)
    }
  }

  if (
    Number.isFinite(forecastMeanF)
    && Number.isFinite(normalMeanF)
    && Number.isFinite(forecastAnomalyF)
    && Math.abs(forecastAnomalyF - (forecastMeanF - normalMeanF))
      > FORECAST_TEMPERATURE_PLAUSIBILITY.anomalyToleranceF
  ) {
    issues.push('forecastAnomalyF-inconsistent-with-means')
  }

  return issues
}

function scoreLocationAggregateIssues(score, locationRows, contract) {
  const issues = []
  const expectedLocations = contract.locationUniverse.locations
  const rowsByLocationId = new Map()
  for (const row of locationRows) {
    const locationId = stringValue(row?.locationId)
    rowsByLocationId.set(locationId, [...(rowsByLocationId.get(locationId) ?? []), row])
  }
  const expectedWeights = new Map(
    expectedLocations.map(({ locationId, weight }) => [locationId, weight]),
  )
  if (locationRows.length !== contract.locationUniverse.expectedLocationCount) {
    issues.push('location-universe-count-mismatch')
  }
  for (const { locationId, weight } of expectedLocations) {
    const rows = rowsByLocationId.get(locationId) ?? []
    if (rows.length !== 1) {
      issues.push(rows.length ? 'location-universe-duplicate-id' : 'location-universe-missing-id')
      continue
    }
    const observedWeight = numericValue(rows[0].weight)
    if (
      !Number.isFinite(observedWeight)
      || Math.abs(observedWeight - weight) > contract.locationWeightTolerance
    ) issues.push('location-universe-weight-mismatch')
  }
  if ([...rowsByLocationId.keys()].some((locationId) => !expectedWeights.has(locationId))) {
    issues.push('location-universe-unexpected-id')
  }
  if (score) {
    if (locationRows.some((row) => (
      stringValue(row?.modelId) !== stringValue(score?.modelId)
      || stringValue(row?.windowId) !== stringValue(score?.windowId)
    ))) issues.push('score-location-identity-mismatch')
  }
  const weightedLocations = locationRows.map((row) => ({
    weight: numericValue(row?.weight),
    anomalyF: numericValue(row?.forecastAnomalyF),
  }))
  if (weightedLocations.some(({ weight, anomalyF }) => (
    !Number.isFinite(weight) || weight < 0 || !Number.isFinite(anomalyF)
  ))) {
    issues.push('score-location-input-not-finite')
    return [...new Set(issues)].sort()
  }
  if (!score) return [...new Set(issues)].sort()

  const precision = contract.aggregatePrecisionDecimals
  const sampledWeight = weightedLocations.reduce((sum, row) => sum + row.weight, 0)
  const weightedAnomalyF = sampledWeight
    ? weightedLocations.reduce((sum, row) => sum + row.anomalyF * row.weight, 0)
      / sampledWeight
    : 0
  const coldWeight = weightedLocations
    .filter((row) => row.anomalyF <= contract.coldCoverageAnomalyF)
    .reduce((sum, row) => sum + row.weight, 0)
  const coveragePct = contract.locationUniverse.expectedSampledWeight
    ? coldWeight / contract.locationUniverse.expectedSampledWeight
    : 0
  const extremeCount = weightedLocations
    .filter((row) => row.anomalyF <= contract.extremeAnomalyF).length
  const checks = [
    ['score-locationCount-mismatch', numericValue(score.locationCount), locationRows.length, 1e-9],
    ['score-sampledWeight-mismatch', numericValue(score.sampledWeight), round(sampledWeight, precision), 1e-9],
    ['score-weightedAnomalyF-mismatch', numericValue(score.weightedAnomalyF), round(weightedAnomalyF, precision), contract.weightedAnomalyToleranceF],
    ['score-coveragePct-mismatch', numericValue(score.coveragePct), round(coveragePct, precision), 1e-9],
    ['score-extremeCount-mismatch', numericValue(score.extremeCount), extremeCount, 1e-9],
  ]
  for (const [issue, observed, expected, tolerance] of checks) {
    if (!Number.isFinite(observed) || Math.abs(observed - expected) > tolerance) issues.push(issue)
  }
  return [...new Set(issues)].sort()
}

export function forecastScoreLocationAggregateFailures({
  scoreRows = [],
  locationRows = [],
  sourceId = '',
  contract = FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
} = {}) {
  if (!Array.isArray(scoreRows) || !Array.isArray(locationRows)) {
    return ['score/location aggregate validation requires arrays']
  }
  const locationsByKey = new Map()
  for (const row of locationRows) {
    const key = forecastScoreLocationGroupKey(row, { sourceId })
    locationsByKey.set(key, [...(locationsByKey.get(key) ?? []), row])
  }
  const scoresByKey = new Map()
  for (const score of scoreRows) {
    const key = forecastScoreLocationGroupKey(score, { sourceId })
    scoresByKey.set(key, [...(scoresByKey.get(key) ?? []), score])
  }
  const failures = []
  const keys = new Set([...locationsByKey.keys(), ...scoresByKey.keys()])
  for (const key of [...keys].sort()) {
    const scores = scoresByKey.get(key) ?? []
    const locations = locationsByKey.get(key) ?? []
    if (scoreRows.length && scores.length !== 1) {
      failures.push(`${key}: score-row-count-mismatch`)
    }
    const issues = scoreLocationAggregateIssues(scores[0] ?? null, locations, contract)
    failures.push(...issues.map((issue) => `${key}: ${issue}`))
  }
  return failures
}

export function assertForecastScoreLocationAggregates(options = {}) {
  const failures = forecastScoreLocationAggregateFailures(options)
  if (failures.length) {
    const error = new Error(`Forecast score/location aggregate contract failed: ${failures.join('; ')}.`)
    error.name = 'ForecastScoreLocationAggregateError'
    error.failures = failures
    throw error
  }
  return { contractId: (options.contract ?? FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT).contractId }
}

function quarantineError(label, diagnostics) {
  const first = diagnostics.quarantinedGroups[0]
  const reason = first?.reasons?.join(',') || 'unknown-temperature-quality-failure'
  const error = new Error(
    `${label} failed physical temperature validation for ${diagnostics.quarantinedGroupCount} atomic forecast group(s); first=${first?.key ?? 'unknown'} reason=${reason}.`,
  )
  error.name = 'ForecastTemperatureQualityError'
  error.diagnostics = diagnostics
  return error
}

export function validateForecastCalendarTemperatures({
  scoreRows = [],
  locationRows = [],
  mode = 'reject',
  label = 'Forecast calendar',
  sourceId = '',
  scoreLocationAggregateContract = null,
} = {}) {
  if (!['reject', 'quarantine'].includes(mode)) {
    throw new Error(`Unsupported forecast temperature validation mode: ${mode}.`)
  }
  if (!Array.isArray(scoreRows) || !Array.isArray(locationRows)) {
    throw new Error(`${label} temperature validation requires scoreRows and locationRows arrays.`)
  }

  const groups = new Map()
  for (const row of locationRows) {
    const identity = groupIdentity(row, sourceId)
    const key = forecastLocationGroupKey(row, { sourceId })
    const current = groups.get(key) ?? {
      key,
      ...identity,
      rowCount: 0,
      invalidRowCount: 0,
      reasons: new Set(),
      modelIds: new Set(),
      sampleLocationIds: [],
    }
    current.rowCount += 1
    current.modelIds.add(stringValue(row?.modelId, 'unknown-model'))
    const issues = forecastLocationTemperatureIssues(row)
    if (issues.length) {
      current.invalidRowCount += 1
      for (const issue of issues) current.reasons.add(issue)
      if (current.sampleLocationIds.length < 3) {
        current.sampleLocationIds.push(stringValue(row?.locationId, 'unknown-location'))
      }
    }
    groups.set(key, current)
  }

  if (scoreLocationAggregateContract) {
    const locationsByKey = new Map()
    for (const row of locationRows) {
      const key = forecastScoreLocationGroupKey(row, { sourceId })
      locationsByKey.set(key, [...(locationsByKey.get(key) ?? []), row])
    }
    const scoresByKey = new Map()
    for (const row of scoreRows) {
      const key = forecastScoreLocationGroupKey(row, { sourceId })
      scoresByKey.set(key, [...(scoresByKey.get(key) ?? []), row])
    }
    const keys = new Set([...locationsByKey.keys(), ...scoresByKey.keys()])
    for (const key of keys) {
      const scoreGroup = scoresByKey.get(key) ?? []
      const locationGroup = locationsByKey.get(key) ?? []
      const representative = scoreGroup[0] ?? locationGroup[0] ?? {}
      const identity = groupIdentity(representative, sourceId)
      const quarantineKey = forecastLocationGroupKey(representative, { sourceId })
      const current = groups.get(quarantineKey) ?? {
        key: quarantineKey,
        ...identity,
        rowCount: locationGroup.length,
        invalidRowCount: 0,
        reasons: new Set(),
        modelIds: new Set(),
        sampleLocationIds: [],
      }
      if (scoreRows.length && scoreGroup.length !== 1) {
        current.reasons.add('score-row-count-mismatch')
      }
      for (const issue of scoreLocationAggregateIssues(
        scoreGroup[0] ?? null,
        locationGroup,
        scoreLocationAggregateContract,
      )) current.reasons.add(issue)
      groups.set(quarantineKey, current)
    }
  }

  const invalidKeys = new Set(
    [...groups.values()]
      .filter((group) => group.invalidRowCount > 0 || group.reasons.size > 0)
      .map((group) => group.key),
  )
  const quarantinedGroups = [...groups.values()]
    .filter((group) => invalidKeys.has(group.key))
    .map((group) => ({
      key: group.key,
      sourceId: group.sourceId,
      issueDate: group.issueDate,
      targetDate: group.targetDate,
      leadDays: group.leadDays,
      modelIds: [...group.modelIds].sort(),
      rowCount: group.rowCount,
      invalidRowCount: group.invalidRowCount,
      reasons: [...group.reasons].sort(),
      sampleLocationIds: group.sampleLocationIds,
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
  const acceptedLocationRows = locationRows.filter(
    (row) => !invalidKeys.has(forecastLocationGroupKey(row, { sourceId })),
  )
  const acceptedScoreRows = scoreRows.filter(
    (row) => !invalidKeys.has(forecastLocationGroupKey(row, { sourceId })),
  )
  const diagnostics = {
    policy: FORECAST_TEMPERATURE_PLAUSIBILITY.groupPolicy,
    mode,
    boundsF: {
      minimum: FORECAST_TEMPERATURE_PLAUSIBILITY.minimumF,
      maximum: FORECAST_TEMPERATURE_PLAUSIBILITY.maximumF,
    },
    anomalyToleranceF: FORECAST_TEMPERATURE_PLAUSIBILITY.anomalyToleranceF,
    scoreLocationAggregateContractId: scoreLocationAggregateContract?.contractId ?? null,
    inputLocationRowCount: locationRows.length,
    acceptedLocationRowCount: acceptedLocationRows.length,
    quarantinedLocationRowCount: locationRows.length - acceptedLocationRows.length,
    inputScoreRowCount: scoreRows.length,
    acceptedScoreRowCount: acceptedScoreRows.length,
    quarantinedScoreRowCount: scoreRows.length - acceptedScoreRows.length,
    quarantinedGroupCount: quarantinedGroups.length,
    quarantinedGroups,
  }

  if (invalidKeys.size && mode === 'reject') throw quarantineError(label, diagnostics)
  return {
    scoreRows: acceptedScoreRows,
    locationRows: acceptedLocationRows,
    invalidGroupKeys: invalidKeys,
    diagnostics,
  }
}

export function assertForecastLocationTemperatures(locationRows, options = {}) {
  return validateForecastCalendarTemperatures({
    locationRows,
    mode: 'reject',
    ...options,
  }).diagnostics
}
