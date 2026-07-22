export const FORECAST_TEMPERATURE_PLAUSIBILITY = Object.freeze({
  minimumF: -150,
  maximumF: 160,
  anomalyToleranceF: 0.01,
  groupPolicy: 'source-issue-target-lead-atomic',
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

  const invalidKeys = new Set(
    [...groups.values()].filter((group) => group.invalidRowCount > 0).map((group) => group.key),
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
