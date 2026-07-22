import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import {
  enrichForecastRows,
  inferAllYearTarget,
  selectedContracts,
} from './qore-live-all-year-inference.mjs'
import { loadEiaStorageReleaseCalendar } from './eia-release-time.mjs'
import {
  LEGACY_FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  validateForecastCalendarTemperatures,
} from './qore-weather-data-quality.mjs'
import {
  SUMMER_FORECAST_TEMPORAL_CONTRACT,
  compactSummerForecastFailures,
  summarizeSummerForecastTemporalInputs,
} from './qore-summer-forecast-contract.mjs'

const SUMMER_FORECAST_CALENDARS = Object.freeze([
  Object.freeze({
    sourceId: 'gfs',
    signalScores: 'research/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv',
    locationAnomalies: 'weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv',
    manifest: 'weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-manifest.json',
  }),
  Object.freeze({
    sourceId: 'gefs-mean',
    signalScores: 'research/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv',
    locationAnomalies: 'weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv',
    manifest: 'weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-manifest.json',
  }),
])

export const LIVE_TARGET_PARITY_POLICY = Object.freeze({
  schemaVersion: 6,
  policyId: 'all-year-component-production-source-exact-target-identity-and-input-contract-replay-v6',
  componentStrategyId: 'ngas-all-year-beta',
  componentStrategyIds: Object.freeze(['ngas-summer-alpha', 'ngas-winter-alpha']),
  comparisonFields: Object.freeze([
    'gasPosition',
    'indexFraction',
    'thesisKind',
    'componentStrategyId',
    'windowId',
  ]),
  comparisonPrecisionDecimals: 4,
  gasPositionTolerance: 0,
  indexFractionTolerance: 0,
  replayContract: Object.freeze({
    targetDateField: 'entryTradeDate',
    storage: 'versioned-EIA-lower48-weekly-with-reviewed-release-calendar',
    summer: Object.freeze({
      expectedTargets: 'versioned-ngas-summer-alpha-selected-trades',
      forecastUniverse: 'dedicated-versioned-GFS-and-GEFS-mean-daily-lead-7-calendars-2021-05-01-through-2025-09-30',
      forecastSeason: 'summer',
      targetSeasonField: 'targetDate',
      targetSeasonMonths: Object.freeze([5, 6, 7, 8, 9]),
      marketDays: 'versioned-NG=F-adjusted-close',
      temporalContract: SUMMER_FORECAST_TEMPORAL_CONTRACT,
    }),
    winter: Object.freeze({
      expectedTargets: 'versioned-ngas-winter-alpha-selected-trades',
      forecastUniverse: 'all-versioned-dataset-manifest-calendars-enriched-then-filtered-to-liveHeatingDemandSourceIds',
      forecastSeason: 'winter',
      marketDays: 'versioned-UNG-adjusted-close',
      actualWeather: 'versioned-NASA-POWER-arctic-blast-daily',
    }),
  }),
})

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`)
  }
}

function readCsv(filePath, label) {
  let parsed
  try {
    parsed = Papa.parse(fs.readFileSync(filePath, 'utf8'), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
    })
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`)
  }
  if (parsed.errors.length) {
    const first = parsed.errors[0]
    throw new Error(`Unable to parse ${label}: ${first.message} at row ${first.row ?? 'unknown'}.`)
  }
  if (!parsed.data.length) throw new Error(`${label} is empty.`)
  return parsed.data
}

function finiteNumber(value, label) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    throw new Error(`${label} must be a finite number.`)
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be a finite number.`)
  return numeric
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function versionedInputPaths(repoDir, manifest) {
  const dataRoot = path.join(repoDir, 'data', 'qore')
  const winterForecastCalendars = manifest.forecastCalendars.map((calendar) => ({
    sourceId: String(calendar?.id ?? ''),
    signalScores: path.join(dataRoot, String(calendar?.files?.signalScores ?? '')),
    locationAnomalies: path.join(dataRoot, String(calendar?.files?.locationAnomalies ?? '')),
  }))
  const summerForecastCalendars = SUMMER_FORECAST_CALENDARS.map((calendar) => ({
    sourceId: calendar.sourceId,
    signalScores: path.join(dataRoot, calendar.signalScores),
    locationAnomalies: path.join(dataRoot, calendar.locationAnomalies),
    manifest: path.join(dataRoot, calendar.manifest),
  }))
  return {
    manifestPath: path.join(dataRoot, 'dataset-manifest.json'),
    summerExpectedTargetsPath: path.join(
      dataRoot,
      'research',
      'strategy-agent-runs',
      'ngas-summer-alpha',
      'selected-trades.csv',
    ),
    winterExpectedTargetsPath: path.join(
      dataRoot,
      'research',
      'strategy-agent-runs',
      'ngas-winter-alpha',
      'selected-trades.csv',
    ),
    summerMarketPath: path.join(dataRoot, 'market', 'yahoo', 'NG-F-qore-market.csv'),
    winterMarketPath: path.join(dataRoot, 'market', 'yahoo', 'UNG-qore-market.csv'),
    storagePath: path.join(dataRoot, 'fundamentals', 'eia', 'working-gas-storage-lower48-weekly.csv'),
    storageReleaseCalendarPath: path.join(
      dataRoot,
      'fundamentals',
      'eia',
      'working-gas-storage-release-calendar.json',
    ),
    actualWeatherPath: path.join(
      dataRoot,
      'weather',
      'events',
      'arctic-blast-actual-daily-2021-01-01-2026-03-31.csv',
    ),
    summerForecastCalendars,
    winterForecastCalendars,
  }
}

export function versionedLiveTargetParityInputDigestSha256(repoDir = process.cwd()) {
  const manifestPath = path.join(repoDir, 'data', 'qore', 'dataset-manifest.json')
  const manifest = readJson(manifestPath, 'QORE dataset manifest')
  if (!Array.isArray(manifest?.forecastCalendars) || !manifest.forecastCalendars.length) {
    throw new Error('QORE dataset manifest does not contain forecast calendars.')
  }
  const paths = versionedInputPaths(repoDir, manifest)
  const files = [
    paths.manifestPath,
    paths.summerExpectedTargetsPath,
    paths.winterExpectedTargetsPath,
    paths.summerMarketPath,
    paths.winterMarketPath,
    paths.storagePath,
    paths.storageReleaseCalendarPath,
    paths.actualWeatherPath,
    ...paths.summerForecastCalendars.flatMap((calendar) => [
      calendar.signalScores,
      calendar.locationAnomalies,
      calendar.manifest,
    ]),
    ...paths.winterForecastCalendars.flatMap((calendar) => [
      calendar.signalScores,
      calendar.locationAnomalies,
    ]),
  ]
  const digest = crypto.createHash('sha256')
  for (const filePath of files) {
    digest.update(path.relative(repoDir, filePath))
    digest.update('\0')
    try {
      digest.update(fs.readFileSync(filePath))
    } catch (error) {
      throw new Error(`Unable to hash live-target parity input ${path.relative(repoDir, filePath)}: ${error.message}`)
    }
    digest.update('\0')
  }
  return digest.digest('hex')
}

export function assessLiveTargetParity({
  expectedRows,
  forecastRows,
  actualWeatherRows,
  marketDays,
  storageRows,
  storageReleaseCalendar = null,
  inferTarget = inferAllYearTarget,
  policy = LIVE_TARGET_PARITY_POLICY,
  captureTargetDates = [],
}) {
  if (!Array.isArray(expectedRows) || !expectedRows.length) {
    throw new Error('Live-target parity requires at least one expected component target row.')
  }
  const seenDates = new Set()
  const comparisons = expectedRows.map((row) => {
    const targetDate = String(row?.entryTradeDate ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new Error(`Live-target parity found an invalid entryTradeDate: ${targetDate || 'missing'}.`)
    }
    if (seenDates.has(targetDate)) {
      throw new Error(`Live-target parity found duplicate expected target date ${targetDate}.`)
    }
    seenDates.add(targetDate)

    const expectedRawGasPosition = finiteNumber(
      row?.ungPosition,
      `Live-target parity expected UNG position on ${targetDate}`,
    )
    const expectedRawIndexFraction = finiteNumber(
      row?.indexFraction,
      `Live-target parity expected index fraction on ${targetDate}`,
    )
    const expectedGasPosition = round(
      expectedRawGasPosition,
      policy.comparisonPrecisionDecimals,
    )
    const expectedIndexFraction = round(
      expectedRawIndexFraction,
      policy.comparisonPrecisionDecimals,
    )
    const expectedGasPositionCanonical = expectedRawGasPosition === expectedGasPosition
    const expectedIndexFractionCanonical = expectedRawIndexFraction === expectedIndexFraction
    const expectedThesisKind = String(row?.thesisKind ?? '')
    if (!expectedThesisKind) {
      throw new Error(`Live-target parity expected thesisKind is missing on ${targetDate}.`)
    }
    const expectedComponentStrategyId = String(
      row?.componentStrategyId
        ?? (expectedGasPosition === 0 ? 'index-fallback' : row?.strategyId)
        ?? '',
    )
    if (!expectedComponentStrategyId) {
      throw new Error(`Live-target parity expected componentStrategyId is missing on ${targetDate}.`)
    }
    const expectedWindowId = String(row?.windowId ?? '')
    if (!expectedWindowId) {
      throw new Error(`Live-target parity expected windowId is missing on ${targetDate}.`)
    }
    const replay = inferTarget({
      forecastRows,
      actualWeatherRows,
      marketDays,
      storageRows,
      storageReleaseCalendar,
      targetDate,
    })
    const replayRawGasPosition = finiteNumber(
      replay?.gasPosition,
      `Live-target parity replay gas position on ${targetDate}`,
    )
    const replayRawIndexFraction = finiteNumber(
      replay?.indexFraction,
      `Live-target parity replay index fraction on ${targetDate}`,
    )
    const replayGasPosition = round(
      replayRawGasPosition,
      policy.comparisonPrecisionDecimals,
    )
    const replayIndexFraction = round(
      replayRawIndexFraction,
      policy.comparisonPrecisionDecimals,
    )
    const replayGasPositionCanonical = replayRawGasPosition === replayGasPosition
    const replayIndexFractionCanonical = replayRawIndexFraction === replayIndexFraction
    const replayThesisKind = String(replay?.thesisKind ?? '')
    if (!replayThesisKind) {
      throw new Error(`Live-target parity replay thesisKind is missing on ${targetDate}.`)
    }
    const replayComponentStrategyId = String(replay?.componentStrategyId ?? '')
    if (!replayComponentStrategyId) {
      throw new Error(`Live-target parity replay componentStrategyId is missing on ${targetDate}.`)
    }
    const replayWindowId = String(replay?.windowId ?? '')
    if (!replayWindowId) {
      throw new Error(`Live-target parity replay windowId is missing on ${targetDate}.`)
    }
    const gasPositionDifference = round(replayGasPosition - expectedGasPosition)
    const indexFractionDifference = round(replayIndexFraction - expectedIndexFraction)
    const gasPositionMatches = expectedGasPositionCanonical
      && replayGasPositionCanonical
      && Math.abs(gasPositionDifference) <= policy.gasPositionTolerance
    const indexFractionMatches = expectedIndexFractionCanonical
      && replayIndexFractionCanonical
      && Math.abs(indexFractionDifference) <= policy.indexFractionTolerance
    const thesisKindMatches = replayThesisKind === expectedThesisKind
    const componentStrategyIdMatches = replayComponentStrategyId === expectedComponentStrategyId
    const windowIdMatches = replayWindowId === expectedWindowId
    return {
      targetDate,
      expectedGasPosition,
      replayGasPosition,
      expectedGasPositionCanonical,
      replayGasPositionCanonical,
      ...(!expectedGasPositionCanonical ? { expectedRawGasPosition } : {}),
      ...(!replayGasPositionCanonical ? { replayRawGasPosition } : {}),
      gasPositionDifference,
      expectedIndexFraction,
      replayIndexFraction,
      expectedIndexFractionCanonical,
      replayIndexFractionCanonical,
      ...(!expectedIndexFractionCanonical ? { expectedRawIndexFraction } : {}),
      ...(!replayIndexFractionCanonical ? { replayRawIndexFraction } : {}),
      indexFractionDifference,
      expectedThesisKind,
      replayThesisKind,
      expectedComponentStrategyId,
      replayComponentStrategyId,
      expectedWindowId,
      replayWindowId,
      gasPositionMatches,
      indexFractionMatches,
      thesisKindMatches,
      componentStrategyIdMatches,
      windowIdMatches,
      matches: gasPositionMatches
        && indexFractionMatches
        && thesisKindMatches
        && componentStrategyIdMatches
        && windowIdMatches,
    }
  })
  const mismatches = comparisons.filter((row) => !row.matches)
  const capturedDateSet = new Set(captureTargetDates)
  return {
    comparedRowCount: comparisons.length,
    matchedRowCount: comparisons.length - mismatches.length,
    mismatchCount: mismatches.length,
    gasPositionMismatchCount: mismatches.filter((row) => !row.gasPositionMatches).length,
    indexFractionMismatchCount: mismatches.filter((row) => !row.indexFractionMatches).length,
    thesisKindMismatchCount: mismatches.filter((row) => !row.thesisKindMatches).length,
    componentStrategyIdMismatchCount:
      mismatches.filter((row) => !row.componentStrategyIdMatches).length,
    windowIdMismatchCount: mismatches.filter((row) => !row.windowIdMatches).length,
    exactTargetParity: mismatches.length === 0,
    comparisonDigestSha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(comparisons))
      .digest('hex'),
    mismatches,
    ...(capturedDateSet.size
      ? { capturedComparisons: comparisons.filter((row) => capturedDateSet.has(row.targetDate)) }
      : {}),
  }
}

export function evaluateVersionedLiveTargetParity(repoDir = process.cwd(), { captureWinterTargetDates = [] } = {}) {
  const dataRoot = path.join(repoDir, 'data', 'qore')
  const manifestPath = path.join(dataRoot, 'dataset-manifest.json')
  const manifest = readJson(manifestPath, 'QORE dataset manifest')
  if (!Array.isArray(manifest?.forecastCalendars) || !manifest.forecastCalendars.length) {
    throw new Error('QORE dataset manifest does not contain forecast calendars.')
  }
  const calendarIds = manifest.forecastCalendars.map((calendar) => calendar?.id)
  if (new Set(calendarIds).size !== calendarIds.length) {
    throw new Error('QORE dataset manifest contains duplicate forecast calendar ids.')
  }
  const inputPaths = versionedInputPaths(repoDir, manifest)
  const {
    summerExpectedTargetsPath,
    winterExpectedTargetsPath,
    summerMarketPath,
    winterMarketPath,
    storagePath,
    storageReleaseCalendarPath,
    actualWeatherPath,
  } = inputPaths
  const inputDigestSha256 = versionedLiveTargetParityInputDigestSha256(repoDir)

  const readForecastCalendars = (calendars, label) => {
    const scoreRows = []
    const locationRows = []
    const inputFiles = []
    const temporalInputs = []
    for (const calendar of calendars) {
      const sourceId = String(calendar?.sourceId ?? '')
      if (!sourceId || !calendar?.signalScores || !calendar?.locationAnomalies) {
        throw new Error(`${label} contains an incomplete forecast calendar entry.`)
      }
      const calendarScoreRows = readCsv(calendar.signalScores, `${sourceId} ${label} forecast scores`)
      const calendarLocationRows = readCsv(calendar.locationAnomalies, `${sourceId} ${label} forecast locations`)
      for (const row of calendarScoreRows) {
        scoreRows.push({ ...row, sourceId })
      }
      for (const row of calendarLocationRows) {
        locationRows.push({ ...row, sourceId })
      }
      inputFiles.push(calendar.signalScores, calendar.locationAnomalies)
      if (calendar.manifest) inputFiles.push(calendar.manifest)
      temporalInputs.push({
        sourceId,
        manifest: calendar.manifest
          ? readJson(calendar.manifest, `${sourceId} ${label} manifest`)
          : null,
        scoreRows: calendarScoreRows,
        locationRows: calendarLocationRows,
      })
    }
    return { scoreRows, locationRows, inputFiles, temporalInputs }
  }

  const summerProductionForecastSourceIds = [...selectedContracts.summer.sourceIds]
  const summerCalendarIds = inputPaths.summerForecastCalendars.map((calendar) => calendar.sourceId)
  const missingSummerSources = summerProductionForecastSourceIds.filter(
    (sourceId) => !summerCalendarIds.includes(sourceId),
  )
  const unexpectedSummerSources = summerCalendarIds.filter(
    (sourceId) => !summerProductionForecastSourceIds.includes(sourceId),
  )
  if (missingSummerSources.length || unexpectedSummerSources.length) {
    throw new Error(
      `Dedicated Summer replay sources do not match the executable contract; missing=${missingSummerSources.join(',') || 'none'} unexpected=${unexpectedSummerSources.join(',') || 'none'}.`,
    )
  }
  const summerInputs = readForecastCalendars(
    inputPaths.summerForecastCalendars,
    'dedicated Summer lead-7 calendar',
  )
  const summerTemporalInputs = summerInputs.temporalInputs.map((input) =>
    summarizeSummerForecastTemporalInputs(input))
  const summerInputContractFailures = summerTemporalInputs.flatMap((summary) =>
    summary.failures.map((failure) => `${summary.sourceId}: ${failure}`))
  if (summerTemporalInputs.length !== summerProductionForecastSourceIds.length) {
    summerInputContractFailures.push(
      `expected ${summerProductionForecastSourceIds.length} temporal inputs but found ${summerTemporalInputs.length}`,
    )
  }
  const summerInputContractValid = summerInputContractFailures.length === 0
  const compactSummerTemporalInputs = summerTemporalInputs.map((summary) => {
    const { failures, ...metadata } = summary
    return { ...metadata, ...compactSummerForecastFailures(failures) }
  })
  const summerInputContractDiagnostics = compactSummerForecastFailures(
    summerInputContractFailures,
  )
  const winterInputContractFailures = []
  const winterInputContractDiagnostics = compactSummerForecastFailures(
    winterInputContractFailures,
  )
  const summerTemperatureQuality = validateForecastCalendarTemperatures({
    scoreRows: summerInputs.scoreRows,
    locationRows: summerInputs.locationRows,
    mode: 'quarantine',
    label: 'Versioned Summer live-target replay inputs',
  })
  const summerSourceSet = new Set(summerProductionForecastSourceIds)
  const summerForecastRows = enrichForecastRows(
    summerTemperatureQuality.scoreRows,
    summerTemperatureQuality.locationRows,
    'summer',
  ).filter((row) => summerSourceSet.has(row.sourceId))
  if (!summerForecastRows.length) {
    throw new Error('Versioned production-source Summer forecast replay is empty.')
  }

  const winterInputs = readForecastCalendars(
    inputPaths.winterForecastCalendars,
    'dataset-manifest Winter calendar',
  )
  const winterTemperatureQuality = validateForecastCalendarTemperatures({
    scoreRows: winterInputs.scoreRows,
    locationRows: winterInputs.locationRows,
    mode: 'quarantine',
    label: 'Versioned Winter live-target replay inputs',
  })
  const winterProductionForecastSourceIds = [
    ...selectedContracts.winterFollow.liveHeatingDemandSourceIds,
  ]
  const missingWinterSources = winterProductionForecastSourceIds.filter(
    (sourceId) => !calendarIds.includes(sourceId),
  )
  if (missingWinterSources.length) {
    throw new Error(
      `QORE dataset manifest is missing production Winter source(s): ${missingWinterSources.join(', ')}.`,
    )
  }
  const winterSourceSet = new Set(winterProductionForecastSourceIds)
  const winterForecastRows = enrichForecastRows(
    winterTemperatureQuality.scoreRows,
    winterTemperatureQuality.locationRows,
    'winter',
    { scoreLocationAggregateContract: LEGACY_FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT },
  ).filter((row) => winterSourceSet.has(row.sourceId))
  if (!winterForecastRows.length) {
    throw new Error('Versioned production-source Winter forecast replay is empty.')
  }

  const marketDays = (filePath, label) => readCsv(filePath, label)
    .map((row) => ({ date: row.date, gasClose: Number(row.close) }))
    .filter((row) => Number.isFinite(row.gasClose) && row.gasClose > 0)
  const summerMarketDays = marketDays(summerMarketPath, 'NG=F Summer signal history')
  const winterMarketDays = marketDays(winterMarketPath, 'UNG Winter market history')
  const storageRows = readCsv(storagePath, 'EIA storage history')
  const storageReleaseCalendar = loadEiaStorageReleaseCalendar(storageReleaseCalendarPath)
  const actualWeatherRows = readCsv(actualWeatherPath, 'Winter actual weather history')

  const summerAssessment = assessLiveTargetParity({
    expectedRows: readCsv(summerExpectedTargetsPath, 'Summer selected targets').filter((row) => {
      const month = Number(String(row?.targetDate ?? '').slice(5, 7))
      return LIVE_TARGET_PARITY_POLICY.replayContract.summer.targetSeasonMonths.includes(month)
    }),
    forecastRows: summerForecastRows,
    actualWeatherRows: [],
    marketDays: summerMarketDays,
    storageRows,
    storageReleaseCalendar,
  })
  const winterAssessment = assessLiveTargetParity({
    expectedRows: readCsv(winterExpectedTargetsPath, 'Winter selected targets'),
    forecastRows: winterForecastRows,
    actualWeatherRows,
    marketDays: winterMarketDays,
    storageRows,
    storageReleaseCalendar,
    captureTargetDates: captureWinterTargetDates,
  })

  const components = {
    summer: {
      componentStrategyId: 'ngas-summer-alpha',
      status: summerAssessment.exactTargetParity && summerInputContractValid ? 'pass' : 'fail',
      productionForecastSourceIds: summerProductionForecastSourceIds,
      productionSignalSourceIds: [...selectedContracts.summer.sourceIds],
      forecastRowCount: summerForecastRows.length,
      weatherTemperatureQuality: summerTemperatureQuality.diagnostics,
      temporalInputs: compactSummerTemporalInputs,
      inputContractValid: summerInputContractValid,
      inputContractFailureCount: summerInputContractDiagnostics.failureCount,
      inputContractFailureDigestSha256: summerInputContractDiagnostics.failureDigestSha256,
      inputContractFailureSamples: summerInputContractDiagnostics.failureSamples,
      inputFiles: {
        expectedTargets: path.relative(repoDir, summerExpectedTargetsPath),
        forecastCalendars: summerInputs.inputFiles.map((filePath) => path.relative(repoDir, filePath)),
      },
      ...summerAssessment,
      targetReplayExact: summerAssessment.exactTargetParity,
      exactTargetParity: summerAssessment.exactTargetParity && summerInputContractValid,
    },
    winter: {
      componentStrategyId: 'ngas-winter-alpha',
      status: winterAssessment.exactTargetParity ? 'pass' : 'fail',
      productionForecastSourceIds: winterProductionForecastSourceIds,
      productionSignalSourceIds: [...selectedContracts.winterFollow.liveSourceIds],
      forecastRowCount: winterForecastRows.length,
      weatherTemperatureQuality: winterTemperatureQuality.diagnostics,
      inputContractValid: true,
      inputContractFailureCount: winterInputContractDiagnostics.failureCount,
      inputContractFailureDigestSha256: winterInputContractDiagnostics.failureDigestSha256,
      inputContractFailureSamples: winterInputContractDiagnostics.failureSamples,
      inputFiles: {
        datasetManifest: path.relative(repoDir, manifestPath),
        expectedTargets: path.relative(repoDir, winterExpectedTargetsPath),
        actualWeather: path.relative(repoDir, actualWeatherPath),
        forecastCalendars: winterInputs.inputFiles.map((filePath) => path.relative(repoDir, filePath)),
      },
      ...winterAssessment,
    },
  }
  const mismatches = Object.values(components).flatMap((component) =>
    component.mismatches.map((row) => ({
      componentStrategyId: component.componentStrategyId,
      ...row,
    })))
  const exactTargetParity = components.summer.exactTargetParity && components.winter.exactTargetParity
  const inputContractFailures = [
    ...summerInputContractFailures.map((failure) => `ngas-summer-alpha: ${failure}`),
    ...winterInputContractFailures.map((failure) => `ngas-winter-alpha: ${failure}`),
  ]
  const inputContractValid = inputContractFailures.length === 0
  const inputContractDiagnostics = compactSummerForecastFailures(inputContractFailures)
  const comparisonDigestSha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      summer: components.summer.comparisonDigestSha256,
      winter: components.winter.comparisonDigestSha256,
    }))
    .digest('hex')

  return {
    ...LIVE_TARGET_PARITY_POLICY,
    status: exactTargetParity ? 'pass' : 'fail',
    productionForecastSourceIds: {
      summer: components.summer.productionForecastSourceIds,
      winter: components.winter.productionForecastSourceIds,
    },
    productionSignalSourceIds: {
      summer: components.summer.productionSignalSourceIds,
      winter: components.winter.productionSignalSourceIds,
    },
    forecastRowCount: components.summer.forecastRowCount + components.winter.forecastRowCount,
    inputContractValid,
    inputContractFailureCount: inputContractDiagnostics.failureCount,
    inputContractFailureDigestSha256: inputContractDiagnostics.failureDigestSha256,
    inputContractFailureSamples: inputContractDiagnostics.failureSamples,
    inputDigestSha256,
    inputFiles: {
      storage: path.relative(repoDir, storagePath),
      storageReleaseCalendar: path.relative(repoDir, storageReleaseCalendarPath),
      summer: {
        ...components.summer.inputFiles,
        market: path.relative(repoDir, summerMarketPath),
      },
      winter: {
        ...components.winter.inputFiles,
        market: path.relative(repoDir, winterMarketPath),
      },
    },
    comparedRowCount: components.summer.comparedRowCount + components.winter.comparedRowCount,
    matchedRowCount: components.summer.matchedRowCount + components.winter.matchedRowCount,
    mismatchCount: mismatches.length,
    gasPositionMismatchCount:
      components.summer.gasPositionMismatchCount + components.winter.gasPositionMismatchCount,
    indexFractionMismatchCount:
      components.summer.indexFractionMismatchCount + components.winter.indexFractionMismatchCount,
    thesisKindMismatchCount:
      components.summer.thesisKindMismatchCount + components.winter.thesisKindMismatchCount,
    componentStrategyIdMismatchCount:
      components.summer.componentStrategyIdMismatchCount
      + components.winter.componentStrategyIdMismatchCount,
    windowIdMismatchCount:
      components.summer.windowIdMismatchCount + components.winter.windowIdMismatchCount,
    exactTargetParity,
    comparisonDigestSha256,
    mismatches,
    components,
  }
}
