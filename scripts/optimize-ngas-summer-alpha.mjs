#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'
import {
  applyExecutionStep,
  causalReturnContributionsForRow,
  createExecutionState,
  executionAuditFields,
  loadExecutionCalendar,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
} from './lib/qore-research-execution.mjs'
import { eiaReportAvailableAtOpen } from './lib/qore-signal-availability.mjs'
import {
  eiaStorageReleaseAt,
  loadEiaStorageReleaseCalendar,
} from './lib/eia-release-time.mjs'
import {
  downsideDeviation,
  laggedRollingAnnualizedVolPct,
  volatilityTargetedFraction,
} from './lib/qore-research-statistics.mjs'
import {
  SUMMER_FORECAST_LOCATION_UNIVERSE,
  summarizeSummerForecastCoverage,
  summarizeSummerForecastLocationBreadth,
} from './lib/qore-summer-forecast-coverage.mjs'
import {
  SUMMER_SHADOW_CHALLENGER,
  SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256,
  SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT,
  reversionMoveScale,
  summerShadowCandidate,
} from './lib/qore-summer-shadow-challenger.mjs'
import {
  COMPONENT_ARTIFACT_SCHEMA_VERSION,
  buildComponentSelectedTradesBinding,
} from './lib/qore-component-artifact.mjs'
import { validateForecastCalendarTemperatures } from './lib/qore-weather-data-quality.mjs'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/ngas-summer-alpha')
const GAS_SIGNAL_FILE = path.join(DATA_ROOT, 'market/yahoo/NG-F-qore-market.csv')
const INDEX_MARKET_FILE = path.join(DATA_ROOT, 'market/yahoo/US-INDEX-BASKET-qore-market.csv')
const ACTUAL_ANOMALY_FILE = path.join(DATA_ROOT, 'weather/nasa-power/daily-temperature-anomalies-2021-01-01-2026-03-31.csv')
const EIA_STORAGE_FILE = path.join(DATA_ROOT, 'fundamentals/eia/working-gas-storage-lower48-weekly.csv')
const EIA_STORAGE_RELEASE_CALENDAR_FILE = path.join(
  DATA_ROOT,
  'fundamentals/eia/working-gas-storage-release-calendar.json',
)
const SUMMER_FORECAST_CALENDARS = [
  {
    id: 'gfs',
    label: 'GFS cooling-season day-7 calendar',
    files: {
      locationAnomalies:
        'weather/noaa-gfs/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv',
      signalScores: 'research/gfs-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv',
    },
  },
  {
    id: 'gefs-mean',
    label: 'GEFS mean cooling-season day-7 calendar',
    files: {
      locationAnomalies:
        'weather/noaa-gefs/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-location-anomalies.csv',
      signalScores: 'research/gefs-mean-00z-daily-forecast-calendar-2021-05-01-2025-09-30-leads-7-hours-0-signal-scores.csv',
    },
  },
]

const STRATEGY_ID = 'ngas-summer-alpha'
const INITIAL_CAPITAL = 100000
const FIRST_SIGNAL_DATE = '2021-01-01'
const TRAIN_END = '2023-12-31'
const VALIDATION_END = '2024-12-31'
const HOLDOUT_START = '2025-01-01'
const EXECUTION_CONTRACT = loadResearchExecutionContract(REPO_ROOT)
const BASELINE_EXECUTION_SCENARIO = EXECUTION_CONTRACT.scenarios[EXECUTION_CONTRACT.selectionScenarioId]
const ONE_WAY_COST_PCT = BASELINE_EXECUTION_SCENARIO.oneWayBps.UNG / 100
const ROUND_TRIP_COST_PCT = ONE_WAY_COST_PCT * 2
const TRADING_DAYS = 252
const COOL_COVERAGE_MAX_ANOMALY_F = -5
const COOL_EXTREME_ANOMALY_F = -10
const WARM_COVERAGE_MIN_ANOMALY_F = 8
const WARM_EXTREME_ANOMALY_F = 14
const BOOTSTRAP_ITERATIONS = 1200
const BLOCK_LENGTH = 10
const HEAT_SIGNAL_FRESHNESS_LOOKBACK_DAYS = 3
const STORAGE_SEASONAL_LOOKBACK_YEARS = 5
const STORAGE_DEFICIT_HEAT_SIZE_MULTIPLIER = 1.25
const STORAGE_DEFICIT_HEAT_MAX_FRACTION = 0.4375
const COOLING_DEMAND_BASE_F = 65
const COOLING_DEMAND_SOLID_ANOMALY_F = 5
const COOLING_DEMAND_EXTREME_ANOMALY_F = 8
const COOLING_DEMAND_LOW_REVERSION_SUBTRACT = 0.15
const COOLING_DEMAND_SOLID_REVERSION_ADD = 0.05
const COOLING_DEMAND_EXTREME_REVERSION_ADD = 0.15
const COOLING_DEMAND_REVERSION_MIN_FRACTION = 0.2
const COOLING_DEMAND_REVERSION_SOLID_MAX_FRACTION = 0.45
const COOLING_DEMAND_REVERSION_EXTREME_MAX_FRACTION = 0.5
const WEATHER_RESOLUTION_SOURCE_IDS = new Set(['gfs', 'gefs-mean'])
const WEATHER_RESOLUTION_BASE_MODES = ['none']
const WEATHER_RESOLUTION_VARIANT_MODE = 'graded-shift'
const WEATHER_RESOLUTION_VARIANT_POOL_SIZE = 1
const REALITY_CHECK_RANK_WINDOW = 20
const ACTIVE_FAMILY_SOURCE_SET_ID = 'gfs-gefs-core'

const SOURCE_SETS = [
  {
    id: 'gfs-single',
    label: 'GFS single-source cooling signal',
    sourceIds: ['gfs'],
    minGroups: 1,
    minFamilies: 1,
  },
  {
    id: 'gefs-single',
    label: 'GEFS mean single-source cooling signal',
    sourceIds: ['gefs-mean'],
    minGroups: 1,
    minFamilies: 1,
  },
  {
    id: 'gfs-gefs-core',
    label: 'GFS plus GEFS mean',
    sourceIds: ['gfs', 'gefs-mean'],
    minGroups: 1,
    minFamilies: 2,
  },
  {
    id: 'long-history-core',
    label: 'Long-history multi-model core',
    sourceIds: ['gfs', 'gefs-mean', 'gem-global', 'ecmwf-ifs'],
    minGroups: 2,
    minFamilies: 2,
  },
  {
    id: 'all-source-consensus',
    label: 'All-source consensus',
    sourceIds: ['gfs', 'gefs-mean', 'graphcastgfs', 'ecmwf-ifs', 'ecmwf-aifs', 'aigfs', 'gem-global'],
    minGroups: 2,
    minFamilies: 2,
  },
  {
    id: 'ncep-complex',
    label: 'NCEP complex',
    sourceIds: ['gfs', 'gefs-mean', 'graphcastgfs', 'aigfs'],
    minGroups: 1,
    minFamilies: 2,
  },
]

const SOURCE_WEIGHT_MODES = ['equal', 'bg-shrink']
const SIZING_MODES = ['fixed', 'confidence-scaled', 'vol-target']
const ANOMALY_THRESHOLDS = [3, 5, 8]
const COVERAGE_THRESHOLDS = [0.25, 0.35, 0.5]
const MIN_CONFIDENCES = [0.35, 0.5]
const WEATHER_FRACTIONS = [0.15, 0.25, 0.35]
const REVERSION_FRACTIONS = [0.1, 0.2, 0.3, 0.35]
const FOLLOW_HOLD_DAYS = [3, 5]
const REVERSION_HOLD_DAYS = [1, 2]
const MIN_REALIZED_MOVES = [2, 4]
const REVERSION_DEMAND_MODES = ['fixed', 'cooling-demand-tiered']
const VOL_TARGETS = [18, 24]

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
}

function parseCsv(filePath) {
  return Papa.parse(readText(filePath), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  }).data
}

function numberFrom(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1))
}

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.floor((sorted.length - 1) * pct), 0, sorted.length - 1)
  return sorted[index]
}

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function calendarDaysBetween(startDate, endDate) {
  return (Date.parse(endDate) - Date.parse(startDate)) / 86400000
}

function addCalendarDays(isoDate, days) {
  return new Date(Date.parse(isoDate) + days * 86400000).toISOString().slice(0, 10)
}

function hasRecentHeatSignal(issueDate, priorHeatIssueDates, lookbackDays) {
  return priorHeatIssueDates.some((priorIssueDate) => {
    const ageDays = calendarDaysBetween(priorIssueDate, issueDate)
    return ageDays > 0 && ageDays <= lookbackDays
  })
}

function dayOfYear(isoDate) {
  const date = new Date(Date.parse(isoDate))
  const yearStart = new Date(Date.parse(`${isoDate.slice(0, 4)}-01-01`))
  return Math.floor((date - yearStart) / 86400000) + 1
}

function storageSeasonalWeek(isoDate) {
  return Math.floor((dayOfYear(isoDate) - 1) / 7)
}

function isCoolingSeason(isoDate) {
  const month = Number(isoDate.slice(5, 7))
  return month >= 5 && month <= 9
}

function daySplit(isoDate) {
  if (isoDate <= TRAIN_END) return 'train'
  if (isoDate <= VALIDATION_END) return 'validation'
  return 'holdout'
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}${rows.length ? '\n' : ''}`
}

function sourceFamilyFor(sourceId) {
  if (sourceId === 'ecmwf-ifs') return 'ecmwf-ifs'
  if (sourceId === 'ecmwf-aifs') return 'ecmwf-aifs'
  if (sourceId === 'gefs-mean') return 'gefs'
  if (sourceId === 'graphcastgfs') return 'graphcastgfs'
  if (sourceId === 'gfs') return 'gfs'
  if (sourceId === 'aigfs') return 'aigfs'
  if (sourceId === 'gem-global') return 'gem-global'
  return sourceId
}

function sourceGroupFor(sourceId) {
  const family = sourceFamilyFor(sourceId)
  if (['gfs', 'gefs', 'graphcastgfs', 'aigfs'].includes(family)) return 'ncep'
  if (['ecmwf-ifs', 'ecmwf-aifs'].includes(family)) return 'ecmwf'
  if (family === 'gem-global') return 'gem'
  return family
}

function scoreKey(row) {
  return [row.issueDate, row.targetDate, row.leadDays, row.windowId, row.modelId].join('|')
}

function coolingDemandAnomalyF(row) {
  const forecastMeanF = numberFrom(row.forecastMeanF, Number.NaN)
  const normalMeanF = numberFrom(row.normalMeanF, Number.NaN)
  if (!Number.isFinite(forecastMeanF) || !Number.isFinite(normalMeanF)) return Number.NaN
  return Math.max(0, forecastMeanF - COOLING_DEMAND_BASE_F) - Math.max(0, normalMeanF - COOLING_DEMAND_BASE_F)
}

function locationBreadthByScore(locationRows) {
  const grouped = new Map()

  for (const row of locationRows) {
    const key = scoreKey(row)
    const current =
      grouped.get(key) ?? {
        sampledWeight: 0,
        coldWeight: 0,
        coldExtremeCount: 0,
        warmWeight: 0,
        warmExtremeCount: 0,
        coolingDemandWeightedSum: 0,
        coolingDemandWeight: 0,
        coolingDemandSolidWeight: 0,
        coolingDemandExtremeCount: 0,
        locationRows: [],
      }
    const weight = numberFrom(row.weight)
    const anomalyF = numberFrom(row.forecastAnomalyF, Number.NaN)
    const coolingDemand = coolingDemandAnomalyF(row)
    current.sampledWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF <= COOL_COVERAGE_MAX_ANOMALY_F) current.coldWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF <= COOL_EXTREME_ANOMALY_F) current.coldExtremeCount += 1
    if (Number.isFinite(anomalyF) && anomalyF >= WARM_COVERAGE_MIN_ANOMALY_F) current.warmWeight += weight
    if (Number.isFinite(anomalyF) && anomalyF >= WARM_EXTREME_ANOMALY_F) current.warmExtremeCount += 1
    if (Number.isFinite(coolingDemand)) {
      current.coolingDemandWeightedSum += coolingDemand * weight
      current.coolingDemandWeight += weight
      if (coolingDemand >= COOLING_DEMAND_SOLID_ANOMALY_F) current.coolingDemandSolidWeight += weight
      if (coolingDemand >= COOLING_DEMAND_EXTREME_ANOMALY_F) current.coolingDemandExtremeCount += 1
    }
    current.locationRows.push({ locationId: row.locationId, weight: row.weight })
    grouped.set(key, current)
  }

  return new Map(
    [...grouped.entries()].map(([key, value]) => [
      key,
      {
        coldCoveragePct: value.sampledWeight ? value.coldWeight / value.sampledWeight : 0,
        coldExtremeCount: value.coldExtremeCount,
        warmCoveragePct: value.sampledWeight ? value.warmWeight / value.sampledWeight : 0,
        warmExtremeCount: value.warmExtremeCount,
        coolingDemandAnomalyF: value.coolingDemandWeight ? value.coolingDemandWeightedSum / value.coolingDemandWeight : 0,
        coolingDemandCoveragePct: value.coolingDemandWeight ? value.coolingDemandSolidWeight / value.coolingDemandWeight : 0,
        coolingDemandExtremeCount: value.coolingDemandExtremeCount,
        locationRows: value.locationRows,
        locationBreadth: summarizeSummerForecastLocationBreadth(value.locationRows),
      },
    ]),
  )
}

function loadForecastScores() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const scores = []
  const inputFiles = [path.relative(REPO_ROOT, MANIFEST_PATH)]
  const temperatureQuality = []
  const calendars = [...manifest.forecastCalendars, ...SUMMER_FORECAST_CALENDARS]

  for (const calendar of calendars) {
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const locationsPath = path.join(DATA_ROOT, calendar.files.locationAnomalies)
    if (!fs.existsSync(scoresPath) || !fs.existsSync(locationsPath)) continue
    inputFiles.push(path.relative(REPO_ROOT, scoresPath), path.relative(REPO_ROOT, locationsPath))
    const validated = validateForecastCalendarTemperatures({
      scoreRows: parseCsv(scoresPath),
      locationRows: parseCsv(locationsPath),
      mode: 'quarantine',
      label: `${calendar.id} Summer research calendar`,
      sourceId: calendar.id,
    })
    temperatureQuality.push({ sourceId: calendar.id, ...validated.diagnostics })
    const breadth = locationBreadthByScore(validated.locationRows)

    for (const row of validated.scoreRows) {
      const leadDays = numberFrom(row.leadDays)
      if (row.windowId !== 'rumor' || leadDays !== 7 || !isCoolingSeason(row.targetDate)) continue
      const warm = breadth.get(scoreKey(row))
      const weightedAnomalyF = numberFrom(row.weightedAnomalyF, Number.NaN)
      const sampledWeight = numberFrom(row.sampledWeight, Number.NaN)
      const locationCount = numberFrom(row.locationCount, Number.NaN)
      scores.push({
        sourceId: calendar.id,
        sourceLabel: calendar.label,
        sourceFamily: sourceFamilyFor(calendar.id),
        sourceGroup: sourceGroupFor(calendar.id),
        issueDate: row.issueDate,
        targetDate: row.targetDate,
        leadDays,
        windowId: row.windowId,
        modelId: row.modelId,
        weightedAnomalyF: Number.isFinite(weightedAnomalyF) ? weightedAnomalyF : 0,
        coldCoveragePct: warm?.coldCoveragePct ?? 0,
        coldExtremeCount: warm?.coldExtremeCount ?? 0,
        warmCoveragePct: warm?.warmCoveragePct ?? 0,
        warmExtremeCount: warm?.warmExtremeCount ?? 0,
        coolingDemandAnomalyF: warm?.coolingDemandAnomalyF ?? 0,
        coolingDemandCoveragePct: warm?.coolingDemandCoveragePct ?? 0,
        coolingDemandExtremeCount: warm?.coolingDemandExtremeCount ?? 0,
        sampledWeight: Number.isFinite(sampledWeight) ? sampledWeight : 0,
        locationCount: Number.isFinite(locationCount) ? locationCount : 0,
        locationRows: warm?.locationRows ?? [],
        coverageInputComplete:
          warm !== undefined &&
          warm.locationBreadth.complete &&
          Number.isFinite(weightedAnomalyF) &&
          Number.isFinite(sampledWeight) &&
          Math.abs(sampledWeight - warm.locationBreadth.expectedSampledWeight) < 1e-9 &&
          Number.isFinite(locationCount) &&
          locationCount === SUMMER_FORECAST_LOCATION_UNIVERSE.locations.length,
      })
    }
  }

  return { manifest, scores, inputFiles, temperatureQuality }
}

function loadActualWeightedAnomaly() {
  const byDate = new Map()
  for (const row of parseCsv(ACTUAL_ANOMALY_FILE)) {
    const current = byDate.get(row.date) ?? { weighted: 0, weight: 0 }
    const weight = numberFrom(row.weight)
    current.weighted += numberFrom(row.anomalyF) * weight
    current.weight += weight
    byDate.set(row.date, current)
  }
  return new Map([...byDate.entries()].map(([date, value]) => [date, value.weight ? value.weighted / value.weight : 0]))
}

function computeSourceReliability(scores, actualByDate) {
  const errors = new Map()
  for (const score of scores) {
    const actual = actualByDate.get(score.targetDate)
    if (score.targetDate > TRAIN_END || !Number.isFinite(actual)) continue
    const current = errors.get(score.sourceId) ?? []
    current.push(score.weightedAnomalyF - actual)
    errors.set(score.sourceId, current)
  }

  const rmses = [...errors.entries()].map(([sourceId, values]) => ({
    sourceId,
    count: values.length,
    rmse: values.length ? Math.sqrt(mean(values.map((value) => value ** 2))) : 0,
  }))
  const inverseValues = rmses.map((row) => (row.count >= 30 && row.rmse > 0 ? 1 / row.rmse ** 2 : 1))
  const averageInverse = mean(inverseValues) || 1
  const weights = new Map()

  for (const row of rmses) {
    const inverseVariance = row.count >= 30 && row.rmse > 0 ? 1 / row.rmse ** 2 : averageInverse
    weights.set(row.sourceId, clamp(0.5 + 0.5 * (inverseVariance / averageInverse), 0.5, 1.5))
  }

  return {
    weights,
    diagnostics: rmses
      .map((row) => ({
        ...row,
        shrinkWeight: round(weights.get(row.sourceId) ?? 1, 4),
      }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  }
}

function loadWeatherResolutionData() {
  const manifest = JSON.parse(readText(MANIFEST_PATH))
  const forecastByIssueTarget = new Map()
  const inputFiles = []
  const temperatureQuality = []

  for (const calendar of manifest.forecastCalendars) {
    if (!WEATHER_RESOLUTION_SOURCE_IDS.has(calendar.id)) continue
    const scoresPath = path.join(DATA_ROOT, calendar.files.signalScores)
    const locationsPath = path.join(DATA_ROOT, calendar.files.locationAnomalies)
    if (!fs.existsSync(scoresPath) || !fs.existsSync(locationsPath)) continue
    inputFiles.push(path.relative(REPO_ROOT, scoresPath), path.relative(REPO_ROOT, locationsPath))
    const validated = validateForecastCalendarTemperatures({
      scoreRows: parseCsv(scoresPath),
      locationRows: parseCsv(locationsPath),
      mode: 'quarantine',
      label: `${calendar.id} Summer weather-resolution calendar`,
      sourceId: calendar.id,
    })
    temperatureQuality.push({ sourceId: calendar.id, ...validated.diagnostics })

    for (const row of validated.scoreRows) {
      const leadDays = numberFrom(row.leadDays, Number.NaN)
      if (!Number.isFinite(leadDays) || leadDays < 1 || leadDays > 3) continue
      const key = `${row.issueDate}|${row.targetDate}`
      const sampledWeight = Math.max(0.0001, numberFrom(row.sampledWeight, 1))
      const current =
        forecastByIssueTarget.get(key) ?? {
          issueDate: row.issueDate,
          targetDate: row.targetDate,
          weightedSum: 0,
          weightSum: 0,
          sourceIds: new Set(),
        }
      current.weightedSum += numberFrom(row.weightedAnomalyF) * sampledWeight
      current.weightSum += sampledWeight
      current.sourceIds.add(calendar.id)
      forecastByIssueTarget.set(key, current)
    }
  }

  const forecastsByTargetDate = new Map()
  for (const value of forecastByIssueTarget.values()) {
    const row = {
      issueDate: value.issueDate,
      targetDate: value.targetDate,
      weightedAnomalyF: round(value.weightedSum / value.weightSum, 3),
      sourceIds: [...value.sourceIds].sort(),
    }
    forecastsByTargetDate.set(row.targetDate, [...(forecastsByTargetDate.get(row.targetDate) ?? []), row])
  }

  for (const rows of forecastsByTargetDate.values()) {
    rows.sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  }

  return {
    forecastsByTargetDate,
    inputFiles,
    temperatureQuality,
  }
}

function loadMarketRows(filePath) {
  return parseCsv(filePath)
    .map((row) => ({
      date: row.date,
      open: numberFrom(row.open, Number.NaN),
      close: numberFrom(row.close, Number.NaN),
      volume: numberFrom(row.volume),
    }))
    .filter((row) => row.date && Number.isFinite(row.open) && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function loadStorageRows() {
  if (!fs.existsSync(EIA_STORAGE_FILE)) {
    throw new Error(`Missing required EIA storage input: ${EIA_STORAGE_FILE}`)
  }
  const releaseCalendar = loadEiaStorageReleaseCalendar(EIA_STORAGE_RELEASE_CALENDAR_FILE)
  const rows = parseCsv(EIA_STORAGE_FILE)
    .map((row) => ({
      date: row.date,
      year: Number(row.date.slice(0, 4)),
      seasonalWeek: storageSeasonalWeek(row.date),
      storageBcf: numberFrom(row.storageBcf, Number.NaN),
      releasedAt: eiaStorageReleaseAt(row.date, releaseCalendar),
    }))
    .filter((row) => row.date && Number.isFinite(row.storageBcf) && row.storageBcf > 0)
    .sort((a, b) => a.date.localeCompare(b.date))

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

function latestReleasedStorageRow(storageRows, tradeDate) {
  let low = 0
  let high = storageRows.length - 1
  let latest = null
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const row = storageRows[middle]
    if (eiaReportAvailableAtOpen(row.releasedAt, tradeDate)) {
      latest = row
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return latest
}

function storageSeasonalContext(storageRows, tradeDate) {
  const latest = latestReleasedStorageRow(storageRows, tradeDate)
  if (!latest) {
    return {
      storageDate: '',
      storageReleaseAt: '',
      storageBcf: 0,
      storageSeasonalAverageBcf: 0,
      storageSeasonalDiffPct: 0,
      storageDeficitHeatTilt: false,
    }
  }

  const seasonalPeers = storageRows.filter(
    (row) =>
      row.seasonalWeek === latest.seasonalWeek &&
      row.year >= latest.year - STORAGE_SEASONAL_LOOKBACK_YEARS &&
      row.year < latest.year,
  )
  const seasonalAverage = mean(seasonalPeers.map((row) => row.storageBcf))
  const seasonalDiffPct = seasonalAverage ? ((latest.storageBcf - seasonalAverage) / seasonalAverage) * 100 : 0

  return {
    storageDate: latest.date,
    storageReleaseAt: latest.releasedAt,
    storageBcf: round(latest.storageBcf, 2),
    storageSeasonalAverageBcf: round(seasonalAverage, 2),
    storageSeasonalDiffPct: round(seasonalDiffPct, 4),
    storageDeficitHeatTilt: seasonalPeers.length >= 3 && seasonalDiffPct <= 0,
  }
}

function marketReturnByDate(rows) {
  const result = new Map()
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]
    const current = rows[index]
    result.set(current.date, {
      date: current.date,
      open: current.open,
      close: current.close,
      returnPct: previous.close ? ((current.close - previous.close) / previous.close) * 100 : 0,
    })
  }
  return result
}

function loadAlignedMarketDays() {
  const signalRows = loadMarketRows(GAS_SIGNAL_FILE)
  const indexRows = loadMarketRows(INDEX_MARKET_FILE)
  const storageRows = loadStorageRows()
  const signalByDate = marketReturnByDate(signalRows)
  const indexByDate = marketReturnByDate(indexRows)
  const executionDays = loadExecutionCalendar(REPO_ROOT, { startDate: FIRST_SIGNAL_DATE })
  const executionByDate = new Map(executionDays.map((day) => [day.date, day]))
  const signalDates = [...signalByDate.keys()].filter((date) => date >= FIRST_SIGNAL_DATE && indexByDate.has(date)).sort()
  const missingExecutionDates = signalDates.filter((date) => !executionByDate.has(date))
  if (missingExecutionDates.length) {
    throw new Error(
      `Summer Alpha is missing UNG/VOO/QQQM execution data for ${missingExecutionDates.length} signal sessions: ${missingExecutionDates.slice(0, 5).join(', ')}.`,
    )
  }
  const dates = signalDates
  const rows = dates.map((date) => {
    const signal = signalByDate.get(date)
    const executionDay = executionByDate.get(date)
    const storage = storageSeasonalContext(storageRows, date)
    return {
      date,
      signalClose: signal.close,
      signalReturnPct: signal.returnPct,
      ungClose: executionDay.symbols.UNG.adjustedClose,
      ungReturnPct: executionDay.symbols.UNG.closeToCloseReturnPct,
      indexReturnPct: executionDay.indexReturnPct,
      executionDay,
      ...storage,
    }
  })

  const signalReturnsPct = rows.map((row) => row.signalReturnPct)
  return rows.map((row, index) => ({
    ...row,
    signalVolAnnualPct: round(
      laggedRollingAnnualizedVolPct(signalReturnsPct, index, 20, TRADING_DAYS),
      4,
    ),
  }))
}

function sourceWeight(sourceId, candidate, reliabilityWeights) {
  if (candidate.sourceWeightMode !== 'bg-shrink') return 1
  return reliabilityWeights.get(sourceId) ?? 1
}

function sideStats(sideRows, side, candidate, reliabilityWeights) {
  const groups = [...new Set(sideRows.map((row) => row.sourceGroup))].sort()
  const families = [...new Set(sideRows.map((row) => row.sourceFamily))].sort()
  const sourceIds = [...new Set(sideRows.map((row) => row.sourceId))].sort()
  const scoredRows = sideRows.map((row) => {
    const anomaly = side === 'cold' ? Math.max(0, -row.weightedAnomalyF) : Math.max(0, row.weightedAnomalyF)
    const coverage = side === 'cold' ? row.coldCoveragePct : row.warmCoveragePct
    const extremeCount = side === 'cold' ? row.coldExtremeCount : row.warmExtremeCount
    const distance = Math.max(0, anomaly - candidate.anomalyThreshold)
    const coverageLift = Math.max(0, coverage - candidate.coverageThreshold + 0.25)
    const weight = sourceWeight(row.sourceId, candidate, reliabilityWeights)
    return {
      row,
      score: weight * (distance + candidate.anomalyThreshold * 0.35) * coverageLift * Math.sqrt(extremeCount + 1),
      anomaly,
      coverage,
      extremeCount,
      weight,
    }
  })
  const best = scoredRows.slice().sort((a, b) => b.score - a.score)[0]
  const weightSum = scoredRows.reduce((sum, row) => sum + row.weight, 0)
  const weightedStrength = weightSum ? scoredRows.reduce((sum, row) => sum + row.score, 0) / weightSum : 0

  return {
    bestRow: best?.row ?? null,
    groups,
    families,
    sourceIds,
    rowCount: sideRows.length,
    strength: round(weightedStrength, 4),
    maxStrength: round(best?.score ?? 0, 4),
    averageAnomaly: round(mean(scoredRows.map((row) => row.anomaly)), 4),
    averageCoverage: round(mean(scoredRows.map((row) => row.coverage)), 4),
    maxExtremeCount: Math.max(...scoredRows.map((row) => row.extremeCount), 0),
  }
}

function signalConfidence(winner, loser, candidate) {
  const margin = Math.max(0, winner.maxStrength - loser.maxStrength)
  const consensus = 0.6 + winner.groups.length * 0.1 + winner.families.length * 0.08 + Math.min(winner.sourceIds.length, 5) * 0.035
  const raw = 1 / (1 + Math.exp(-(margin + winner.maxStrength * 0.35 - 3.5) / 3.2))
  return clamp(raw * consensus, 0, 1)
}

function createSignalFromIssueRows(rows, candidate, reliabilityWeights) {
  const allowedSources = new Set(candidate.sourceIds)
  const scopedRows = rows.filter((row) => allowedSources.has(row.sourceId))
  if (!scopedRows.length) return null

  const coldRows = scopedRows.filter(
    (row) => row.weightedAnomalyF <= -candidate.anomalyThreshold && row.coldCoveragePct >= candidate.coverageThreshold,
  )
  const warmRows = scopedRows.filter(
    (row) => row.weightedAnomalyF >= candidate.anomalyThreshold && row.warmCoveragePct >= candidate.coverageThreshold,
  )
  const cold = sideStats(coldRows, 'cold', candidate, reliabilityWeights)
  const warm = sideStats(warmRows, 'warm', candidate, reliabilityWeights)
  const winner =
    cold.maxStrength >= warm.maxStrength
      ? { side: 'cold', direction: -1, thesisKind: 'summer-cold-short', stats: cold, loser: warm }
      : { side: 'warm', direction: 1, thesisKind: 'summer-heat-long', stats: warm, loser: cold }

  if (!winner.stats.bestRow) return null
  if (winner.stats.groups.length < candidate.minGroups || winner.stats.families.length < candidate.minFamilies) return null
  if (winner.stats.maxStrength <= winner.loser.maxStrength * 1.15) return null
  const confidence = signalConfidence(winner.stats, winner.loser, candidate)
  if (confidence < candidate.minConfidence) return null

  return {
    issueDate: winner.stats.bestRow.issueDate,
    targetDate: winner.stats.bestRow.targetDate,
    direction: winner.direction,
    thesisKind: winner.thesisKind,
    sourceId: candidate.sourceSetId,
    sourceLabel: candidate.sourceSetLabel,
    sourceIds: [...new Set(scopedRows.map((row) => row.sourceId))].sort(),
    sourceGroups: winner.stats.groups,
    sourceFamilies: winner.stats.families,
    weightedAnomalyF: round(mean(scopedRows.map((row) => row.weightedAnomalyF)), 3),
    coolingDemandAnomalyF: round(mean(scopedRows.map((row) => row.coolingDemandAnomalyF)), 3),
    coolingDemandCoveragePct: round(mean(scopedRows.map((row) => row.coolingDemandCoveragePct)), 4),
    coolingDemandExtremeCount: Math.max(...scopedRows.map((row) => row.coolingDemandExtremeCount), 0),
    sideStrength: winner.stats.maxStrength,
    oppositeStrength: winner.loser.maxStrength,
    coveragePct: winner.stats.averageCoverage,
    extremeCount: winner.stats.maxExtremeCount,
    confidence: round(confidence, 4),
    rank: round(winner.stats.maxStrength * confidence * Math.sqrt(winner.stats.groups.length + winner.stats.families.length), 4),
    leadDays: winner.stats.bestRow.leadDays,
  }
}

function groupScoresByIssueDate(scores) {
  const rowsByIssueDate = new Map()
  for (const score of scores) {
    rowsByIssueDate.set(score.issueDate, [...(rowsByIssueDate.get(score.issueDate) ?? []), score])
  }
  return rowsByIssueDate
}

function signalsForCandidate(rowsByIssueDate, candidate, reliabilityWeights) {
  return [...rowsByIssueDate.values()]
    .map((rows) => createSignalFromIssueRows(rows, candidate, reliabilityWeights))
    .filter(Boolean)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || b.rank - a.rank)
}

function signalCacheKey(candidate) {
  return [
    candidate.sourceSetId,
    candidate.sourceWeightMode,
    candidate.anomalyThreshold,
    candidate.coverageThreshold,
    candidate.minConfidence,
    candidate.minGroups,
    candidate.minFamilies,
  ].join('|')
}

function firstIndexAfter(days, date) {
  return days.findIndex((day) => day.date > date)
}

function firstIndexOnOrAfter(days, date) {
  return days.findIndex((day) => day.date >= date)
}

function scaledFraction(baseFraction, confidence, mode, day, targetVolPct) {
  if (mode === 'fixed') return baseFraction
  const confidenceScale = confidence
  if (mode === 'confidence-scaled') return baseFraction * confidenceScale
  return volatilityTargetedFraction({
    annualizedVolPct: day.signalVolAnnualPct,
    baseFraction,
    confidence: confidenceScale,
    targetVolPct,
  })
}

function heatStorageAdjustedFraction(baseFraction, signal, day) {
  if (signal.thesisKind !== 'summer-heat-long' || !day.storageDeficitHeatTilt) return baseFraction
  return Math.min(STORAGE_DEFICIT_HEAT_MAX_FRACTION, baseFraction * STORAGE_DEFICIT_HEAT_SIZE_MULTIPLIER)
}

function demandAdjustedReversionFraction(baseFraction, signal, candidate) {
  if (candidate.reversionDemandMode !== 'cooling-demand-tiered' || signal.thesisKind !== 'summer-heat-long') return baseFraction
  const coolingDemand = numberFrom(signal.coolingDemandAnomalyF, Number.NaN)
  if (!Number.isFinite(coolingDemand)) return baseFraction
  if (coolingDemand >= COOLING_DEMAND_EXTREME_ANOMALY_F) {
    return Math.min(COOLING_DEMAND_REVERSION_EXTREME_MAX_FRACTION, baseFraction + COOLING_DEMAND_EXTREME_REVERSION_ADD)
  }
  if (coolingDemand >= COOLING_DEMAND_SOLID_ANOMALY_F) {
    return Math.min(COOLING_DEMAND_REVERSION_SOLID_MAX_FRACTION, baseFraction + COOLING_DEMAND_SOLID_REVERSION_ADD)
  }
  return Math.min(
    baseFraction,
    Math.max(COOLING_DEMAND_REVERSION_MIN_FRACTION, baseFraction - COOLING_DEMAND_LOW_REVERSION_SUBTRACT),
  )
}

function latestCloseForecastFor(signal, entryDate, weatherResolutionData) {
  const forecasts = weatherResolutionData.forecastsByTargetDate.get(signal.targetDate) ?? []
  let latest = null
  for (const forecast of forecasts) {
    if (forecast.issueDate <= entryDate) latest = forecast
    if (forecast.issueDate > entryDate) break
  }
  return latest
}

function weatherResolutionDecision(signal, reversionPosition, entryDate, candidate, weatherResolutionData) {
  if (candidate.weatherResolutionMode !== 'graded-shift') {
    return {
      mode: candidate.weatherResolutionMode,
      action: 'none',
      scale: 1,
    }
  }

  const closeForecast = latestCloseForecastFor(signal, entryDate, weatherResolutionData)
  if (!closeForecast) {
    return {
      mode: candidate.weatherResolutionMode,
      action: 'missing-kept',
      scale: 1,
    }
  }

  const originalAnomalyF = numberFrom(signal.weightedAnomalyF, Number.NaN)
  const resolutionAnomalyF = numberFrom(closeForecast.weightedAnomalyF, Number.NaN)
  if (!Number.isFinite(originalAnomalyF) || !Number.isFinite(resolutionAnomalyF)) {
    return {
      mode: candidate.weatherResolutionMode,
      action: 'missing-kept',
      scale: 1,
    }
  }

  const shiftF = resolutionAnomalyF - originalAnomalyF
  const weatherGasDirection = shiftF > 0 ? 1 : shiftF < 0 ? -1 : 0
  const positionDirection = Math.sign(reversionPosition)
  const sameDirectionShift = weatherGasDirection !== 0 && weatherGasDirection === positionDirection
  const adverseDirectionShift = weatherGasDirection !== 0 && weatherGasDirection === -positionDirection

  if (adverseDirectionShift && Math.abs(shiftF) >= 2) {
    return {
      mode: candidate.weatherResolutionMode,
      source: 'close-forecast',
      issueDate: closeForecast.issueDate,
      sourceIds: closeForecast.sourceIds,
      originalAnomalyF: round(originalAnomalyF, 3),
      resolutionAnomalyF: round(resolutionAnomalyF, 3),
      shiftF: round(shiftF, 3),
      action: 'adverse-dropped',
      scale: 0,
    }
  }

  const scale = sameDirectionShift
    ? clamp(0.75 + Math.abs(shiftF) / 8, 0.75, 1.25)
    : adverseDirectionShift
      ? clamp(0.9 - Math.abs(shiftF) / 10, 0.45, 0.9)
      : 0.85

  return {
    mode: candidate.weatherResolutionMode,
    source: 'close-forecast',
    issueDate: closeForecast.issueDate,
    sourceIds: closeForecast.sourceIds,
    originalAnomalyF: round(originalAnomalyF, 3),
    resolutionAnomalyF: round(resolutionAnomalyF, 3),
    shiftF: round(shiftF, 3),
    action: sameDirectionShift ? 'confirm-scaled' : adverseDirectionShift ? 'adverse-shrunk' : 'neutral-shrunk',
    scale: round(scale, 4),
  }
}

function scheduleOverlay(days, signals, candidate, weatherResolutionData) {
  const byIndex = new Map()
  const eventRows = []
  const priorHeatIssueDates = []
  let skippedHeatFollowSignals = 0
  let weatherResolutionAdjustedRows = 0
  let weatherResolutionDroppedRows = 0
  const setPosition = (index, payload) => {
    if (index < 0 || index >= days.length) return
    const current = byIndex.get(index)
    if (!current || payload.rank > current.rank) byIndex.set(index, payload)
  }

  for (const signal of signals) {
    const isHeatSignal = signal.thesisKind === 'summer-heat-long'
    const isFreshHeatSignal =
      !isHeatSignal || !hasRecentHeatSignal(signal.issueDate, priorHeatIssueDates, candidate.freshHeatLookbackDays)
    if (isHeatSignal) priorHeatIssueDates.push(signal.issueDate)

    const entryIndex = firstIndexAfter(days, signal.issueDate)
    const targetIndex = firstIndexOnOrAfter(days, signal.targetDate)
    if (entryIndex < 0 || targetIndex < entryIndex) continue

    const followEndIndex = Math.min(targetIndex, entryIndex + candidate.followHoldDays - 1)
    const eventBase = {
      signal,
      issueDate: signal.issueDate,
      targetDate: signal.targetDate,
      sourceId: signal.sourceId,
      leadDays: signal.leadDays,
      weightedAnomalyF: signal.weightedAnomalyF,
      coolingDemandAnomalyF: signal.coolingDemandAnomalyF,
      coolingDemandCoveragePct: signal.coolingDemandCoveragePct,
      coolingDemandExtremeCount: signal.coolingDemandExtremeCount,
      coveragePct: signal.coveragePct,
      extremeCount: signal.extremeCount,
      confidence: signal.confidence,
      thesisKind: signal.thesisKind,
    }

    if (isFreshHeatSignal) {
      for (let index = entryIndex; index <= followEndIndex; index += 1) {
        const baseFraction = scaledFraction(candidate.weatherFraction, signal.confidence, candidate.sizingMode, days[index], candidate.volTargetPct)
        const adjustedFraction = heatStorageAdjustedFraction(baseFraction, signal, days[index])
        const weatherPosition = signal.direction * adjustedFraction
        setPosition(index, {
          ...eventBase,
          position: weatherPosition,
          signal: signal.direction * signal.confidence,
          windowId: 'weather-follow',
          thesisKind: signal.thesisKind,
          storageDate: days[index].storageDate,
          storageReleaseAt: days[index].storageReleaseAt,
          storageBcf: days[index].storageBcf,
          storageSeasonalAverageBcf: days[index].storageSeasonalAverageBcf,
          storageSeasonalDiffPct: days[index].storageSeasonalDiffPct,
          storageDeficitHeatTilt: days[index].storageDeficitHeatTilt,
          heatSizeMultiplier: adjustedFraction > baseFraction ? round(adjustedFraction / baseFraction, 4) : 1,
          rank: signal.rank + 10,
        })
      }
      eventRows.push({
        ...eventBase,
        leg: 'weather-follow',
        direction: signal.direction === 1 ? 'long' : 'short',
        entryTradeDate: days[entryIndex].date,
        exitTradeDate: days[followEndIndex].date,
        storageDate: days[entryIndex].storageDate,
        storageReleaseAt: days[entryIndex].storageReleaseAt,
        storageBcf: days[entryIndex].storageBcf,
        storageSeasonalAverageBcf: days[entryIndex].storageSeasonalAverageBcf,
        storageSeasonalDiffPct: days[entryIndex].storageSeasonalDiffPct,
        storageDeficitHeatTilt: days[entryIndex].storageDeficitHeatTilt,
        heatSizeMultiplier: days[entryIndex].storageDeficitHeatTilt ? STORAGE_DEFICIT_HEAT_SIZE_MULTIPLIER : 1,
        realizedMovePct: '',
      })
    } else {
      skippedHeatFollowSignals += 1
    }

    const priorClose = days[Math.max(entryIndex - 1, 0)]?.signalClose
    const exitClose = days[followEndIndex]?.signalClose
    const realizedMovePct = priorClose && exitClose ? ((exitClose - priorClose) / priorClose) * 100 : 0
    if (Math.abs(realizedMovePct) < candidate.minRealizedMovePct) continue
    if (Math.sign(realizedMovePct) !== signal.direction) continue
    const moveScale = reversionMoveScale(realizedMovePct, candidate)
    if (moveScale <= 0) continue

    const reversionEntryIndex = followEndIndex + 1
    if (signal.thesisKind === 'summer-heat-long' && days[reversionEntryIndex]?.storageDeficitHeatTilt) continue
    const reversionExitIndex = Math.min(days.length - 1, reversionEntryIndex + candidate.reversionHoldDays - 1)
    for (let index = reversionEntryIndex; index <= reversionExitIndex; index += 1) {
      const baseReversionFraction = scaledFraction(
        candidate.reversionFraction,
        signal.confidence,
        candidate.sizingMode,
        days[index],
        candidate.volTargetPct,
      )
      const demandReversionFraction = demandAdjustedReversionFraction(baseReversionFraction, signal, candidate)
      const rawReversionPosition = -signal.direction * demandReversionFraction * moveScale
      const weatherResolution = weatherResolutionDecision(signal, rawReversionPosition, days[index].date, candidate, weatherResolutionData)
      const reversionPosition = rawReversionPosition * weatherResolution.scale
      if (weatherResolution.action && !['none', 'missing-kept'].includes(weatherResolution.action)) weatherResolutionAdjustedRows += 1
      if (weatherResolution.scale === 0) {
        weatherResolutionDroppedRows += 1
        continue
      }
      setPosition(index, {
        ...eventBase,
        position: reversionPosition,
        signal: Math.sign(reversionPosition) * signal.confidence,
        windowId: 'weather-reversion',
        thesisKind: reversionPosition > 0 ? 'reversion-long' : 'reversion-short',
        storageDate: days[index].storageDate,
        storageReleaseAt: days[index].storageReleaseAt,
        storageBcf: days[index].storageBcf,
        storageSeasonalAverageBcf: days[index].storageSeasonalAverageBcf,
        storageSeasonalDiffPct: days[index].storageSeasonalDiffPct,
        storageDeficitHeatTilt: days[index].storageDeficitHeatTilt,
        heatSizeMultiplier: 1,
        reversionDemandMode: candidate.reversionDemandMode,
        weatherResolutionMode: candidate.weatherResolutionMode,
        weatherResolutionSource: weatherResolution.source ?? '',
        weatherResolutionIssueDate: weatherResolution.issueDate ?? '',
        weatherResolutionSourceIds: weatherResolution.sourceIds ?? [],
        weatherResolutionOriginalAnomalyF: weatherResolution.originalAnomalyF ?? '',
        weatherResolutionAnomalyF: weatherResolution.resolutionAnomalyF ?? '',
        weatherResolutionShiftF: weatherResolution.shiftF ?? '',
        weatherResolutionAction: weatherResolution.action,
        weatherResolutionScale: weatherResolution.scale,
        rank: signal.rank + 5,
        realizedMovePct: round(realizedMovePct, 4),
      })
    }
    if (reversionEntryIndex <= reversionExitIndex) {
      eventRows.push({
        ...eventBase,
        leg: 'weather-reversion',
        direction: realizedMovePct > 0 ? 'short' : 'long',
        entryTradeDate: days[reversionEntryIndex].date,
        exitTradeDate: days[reversionExitIndex].date,
        storageDate: days[reversionEntryIndex].storageDate,
        storageReleaseAt: days[reversionEntryIndex].storageReleaseAt,
        storageBcf: days[reversionEntryIndex].storageBcf,
        storageSeasonalAverageBcf: days[reversionEntryIndex].storageSeasonalAverageBcf,
        storageSeasonalDiffPct: days[reversionEntryIndex].storageSeasonalDiffPct,
        storageDeficitHeatTilt: days[reversionEntryIndex].storageDeficitHeatTilt,
        heatSizeMultiplier: 1,
        realizedMovePct: round(realizedMovePct, 4),
      })
    }
  }

  return { byIndex, eventRows, skippedHeatFollowSignals, weatherResolutionAdjustedRows, weatherResolutionDroppedRows }
}

function buildCurve(days, overlayByIndex) {
  let equity = INITIAL_CAPITAL
  let peak = INITIAL_CAPITAL
  let previousPosition = 0
  let priorCloseThesisKind = 'index-fallback'
  let executionState = createExecutionState(EXECUTION_CONTRACT)
  const curve = []
  const rows = []

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index]
    const overlay = overlayByIndex.get(index)
    const position = round(overlay?.position ?? 0, 4)
    const indexFraction = round(Math.max(0, 1 - Math.abs(position)), 4)
    const targetWeights = targetWeightsForAllocation(EXECUTION_CONTRACT, {
      gasPosition: position,
      investedIndexFraction: indexFraction,
    })
    const execution = applyExecutionStep({
      state: executionState,
      day: day.executionDay,
      targetWeights,
      contract: EXECUTION_CONTRACT,
    })
    executionState = execution.state
    const grossReturnPct = execution.grossReturnPct
    const tradingCostPct = execution.tradingCostPct + execution.borrowCostPct
    const netReturnPct = round(execution.netReturnPct, 4)
    const previousEquity = equity
    equity = Math.max(1, equity * (1 + netReturnPct / 100))
    peak = Math.max(peak, equity)
    const drawdownPct = ((equity - peak) / peak) * 100

    const row = {
      strategyId: STRATEGY_ID,
      signalDate: overlay?.issueDate ?? day.date,
      issueDate: overlay?.issueDate ?? day.date,
      targetDate: overlay?.targetDate ?? day.date,
      entryTradeDate: day.date,
      exitTradeDate: day.date,
      targetTradeDate: day.date,
      direction: position < 0 ? 'short' : 'long',
      sourceId: overlay?.sourceId ?? 'US-INDEX-BASKET',
      windowId: overlay?.windowId ?? 'index-fallback',
      thesisKind: overlay?.thesisKind ?? 'index-fallback',
      priorCloseThesisKind,
      leadDays: overlay?.leadDays ?? 0,
      confidence: overlay?.confidence ?? 0,
      weightedAnomalyF: overlay?.weightedAnomalyF ?? 0,
      coolingDemandAnomalyF: overlay?.coolingDemandAnomalyF ?? 0,
      coolingDemandCoveragePct: overlay?.coolingDemandCoveragePct ?? 0,
      coolingDemandExtremeCount: overlay?.coolingDemandExtremeCount ?? 0,
      coveragePct: overlay?.coveragePct ?? 0,
      coldCoveragePct: overlay?.thesisKind === 'summer-cold-short' ? overlay.coveragePct : 0,
      warmCoveragePct: overlay?.thesisKind === 'summer-heat-long' ? overlay.coveragePct : 0,
      extremeCount: overlay?.extremeCount ?? 0,
      storageDate: overlay?.storageDate ?? day.storageDate,
      storageReleaseAt: overlay?.storageReleaseAt ?? day.storageReleaseAt,
      storageBcf: overlay?.storageBcf ?? day.storageBcf,
      storageSeasonalAverageBcf: overlay?.storageSeasonalAverageBcf ?? day.storageSeasonalAverageBcf,
      storageSeasonalDiffPct: overlay?.storageSeasonalDiffPct ?? day.storageSeasonalDiffPct,
      storageDeficitHeatTilt: overlay?.storageDeficitHeatTilt ?? day.storageDeficitHeatTilt,
      heatSizeMultiplier: overlay?.heatSizeMultiplier ?? 1,
      indexFraction: round(indexFraction, 4),
      ungPosition: round(position, 4),
      ungReturnPct: round(day.ungReturnPct, 4),
      indexReturnPct: round(day.indexReturnPct, 4),
      grossReturnPct: round(grossReturnPct, 4),
      tradingCostPct: round(tradingCostPct, 4),
      netReturnPct,
      componentMaterialRow:
        overlay?.thesisKind !== undefined || Math.abs(position) > 0.000001 || Math.abs(position - previousPosition) > 0.000001,
      ...executionAuditFields(execution, day.executionDay, EXECUTION_CONTRACT),
      equity: round(equity, 2),
      equityPct: round((equity / INITIAL_CAPITAL - 1) * 100, 4),
      drawdownPct: round(drawdownPct, 4),
      rank: overlay?.rank ?? 0,
      realizedMovePct: overlay?.realizedMovePct ?? '',
      reversionDemandMode: overlay?.reversionDemandMode ?? 'fixed',
      weatherResolutionMode: overlay?.weatherResolutionMode ?? 'none',
      weatherResolutionSource: overlay?.weatherResolutionSource ?? '',
      weatherResolutionIssueDate: overlay?.weatherResolutionIssueDate ?? '',
      weatherResolutionSourceIds: overlay?.weatherResolutionSourceIds ?? [],
      weatherResolutionOriginalAnomalyF: overlay?.weatherResolutionOriginalAnomalyF ?? '',
      weatherResolutionAnomalyF: overlay?.weatherResolutionAnomalyF ?? '',
      weatherResolutionShiftF: overlay?.weatherResolutionShiftF ?? '',
      weatherResolutionAction: overlay?.weatherResolutionAction ?? '',
      weatherResolutionScale: overlay?.weatherResolutionScale ?? 1,
    }
    rows.push(row)
    curve.push({
      date: day.date,
      equity,
      equityPct: (equity / INITIAL_CAPITAL - 1) * 100,
      dailyPnlPct: previousEquity ? ((equity - previousEquity) / previousEquity) * 100 : 0,
      drawdownPct,
      position,
      signal: overlay?.signal ?? 0,
      netReturnPct,
      indexReturnPct: day.indexReturnPct,
      activeReturnPct: netReturnPct - day.indexReturnPct,
      totalTurnover: execution.totalTurnover,
      gasTurnover: execution.gasTurnover,
      indexTurnover: execution.indexTurnover,
    })
    previousPosition = position
    priorCloseThesisKind = row.thesisKind
  }

  return { curve, rows }
}

function executedEventRowsFromRows(rows) {
  return rows
    .filter((row) => row.windowId !== 'index-fallback')
    .map((row) => ({
      leg: row.windowId === 'weather-reversion' ? 'weather-reversion' : 'weather-follow',
      issueDate: row.issueDate,
      targetDate: row.targetDate,
      entryTradeDate: row.entryTradeDate,
      exitTradeDate: row.exitTradeDate,
      direction: row.direction,
      sourceId: row.sourceId,
      thesisKind: row.thesisKind,
      leadDays: row.leadDays,
      weightedAnomalyF: row.weightedAnomalyF,
      coolingDemandAnomalyF: row.coolingDemandAnomalyF,
      coolingDemandCoveragePct: row.coolingDemandCoveragePct,
      coolingDemandExtremeCount: row.coolingDemandExtremeCount,
      coveragePct: row.coveragePct,
      extremeCount: row.extremeCount,
      confidence: row.confidence,
      storageDate: row.storageDate,
      storageReleaseAt: row.storageReleaseAt,
      storageBcf: row.storageBcf,
      storageSeasonalAverageBcf: row.storageSeasonalAverageBcf,
      storageSeasonalDiffPct: row.storageSeasonalDiffPct,
      storageDeficitHeatTilt: row.storageDeficitHeatTilt,
      heatSizeMultiplier: row.heatSizeMultiplier,
      realizedMovePct: row.realizedMovePct,
      reversionDemandMode: row.reversionDemandMode,
      weatherResolutionMode: row.weatherResolutionMode,
      weatherResolutionSource: row.weatherResolutionSource,
      weatherResolutionIssueDate: row.weatherResolutionIssueDate,
      weatherResolutionSourceIds: row.weatherResolutionSourceIds,
      weatherResolutionOriginalAnomalyF: row.weatherResolutionOriginalAnomalyF,
      weatherResolutionAnomalyF: row.weatherResolutionAnomalyF,
      weatherResolutionShiftF: row.weatherResolutionShiftF,
      weatherResolutionAction: row.weatherResolutionAction,
      weatherResolutionScale: row.weatherResolutionScale,
    }))
}

function metricsFromCurve(curve, tradeCount) {
  if (!curve.length) {
    return {
      totalReturnPct: 0,
      cagrPct: 0,
      annualVolPct: 0,
      sharpe: 0,
      sortino: 0,
      maxDrawdownPct: 0,
      calmar: 0,
      winRatePct: 0,
      profitFactor: 0,
      tradeCount,
      exposurePct: 0,
      turnover: 0,
      var95Pct: 0,
      cvar95Pct: 0,
      averageDailyPnlPct: 0,
      firstEntry: null,
      lastExit: null,
      averageHoldDays: 1,
      tStat: 0,
    }
  }

  const returns = curve.map((point) => point.dailyPnlPct / 100)
  let rebasedEquity = 1
  let rebasedPeak = 1
  let maxDrawdown = 0
  for (const value of returns) {
    rebasedEquity *= 1 + value
    rebasedPeak = Math.max(rebasedPeak, rebasedEquity)
    maxDrawdown = Math.min(maxDrawdown, rebasedEquity / rebasedPeak - 1)
  }
  const totalReturn = rebasedEquity - 1
  const years = Math.max(daysBetween(curve[0].date, curve.at(-1).date) / 365.25, 1 / 365.25)
  const annualReturn = (1 + totalReturn) ** (1 / years) - 1
  const annualVol = std(returns) * Math.sqrt(TRADING_DAYS)
  const downsideVol = downsideDeviation(returns) * Math.sqrt(TRADING_DAYS)
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)
  const exposure = mean(curve.map((point) => Math.abs(point.position)))
  const turnover = curve.reduce((sum, point) => sum + numberFrom(point.totalTurnover), 0)
  const gasTurnover = curve.reduce((sum, point) => sum + numberFrom(point.gasTurnover), 0)
  const indexTurnover = curve.reduce((sum, point) => sum + numberFrom(point.indexTurnover), 0)
  const avg = mean(returns)
  const standardError = std(returns) ? std(returns) / Math.sqrt(returns.length) : 0

  return {
    totalReturnPct: round(totalReturn * 100, 2),
    cagrPct: round(annualReturn * 100, 2),
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (avg * TRADING_DAYS) / annualVol : 0, 2),
    sortino: round(downsideVol ? (avg * TRADING_DAYS) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdown * 100, 2),
    calmar: round(Math.abs(maxDrawdown) ? annualReturn / Math.abs(maxDrawdown) : 0, 2),
    winRatePct: round((returns.filter((value) => value > 0).length / Math.max(returns.length, 1)) * 100, 1),
    profitFactor: round(losses ? gains / losses : gains ? 99 : 0, 2),
    tradeCount,
    exposurePct: round(exposure * 100, 1),
    turnover: round(turnover, 2),
    gasTurnover: round(gasTurnover, 2),
    indexTurnover: round(indexTurnover, 2),
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(avg * 100, 3),
    firstEntry: curve[0].date,
    lastExit: curve.at(-1).date,
    averageHoldDays: 1,
    tStat: round(standardError ? avg / standardError : 0, 2),
  }
}

function curveForSplit(curve, split) {
  return curve.filter((point) => daySplit(point.date) === split)
}

function eventRowsForSplit(eventRows, split) {
  return eventRows.filter((event) => daySplit(event.entryTradeDate) === split)
}

function indexMetricsForDays(days) {
  let equity = INITIAL_CAPITAL
  const curve = days.map((day) => {
    equity *= 1 + day.indexReturnPct / 100
    return {
      date: day.date,
      equity,
      dailyPnlPct: day.indexReturnPct,
      drawdownPct: 0,
      position: 0,
    }
  })
  let peak = INITIAL_CAPITAL
  return curve.map((point) => {
    peak = Math.max(peak, point.equity)
    return { ...point, drawdownPct: ((point.equity - peak) / peak) * 100 }
  })
}

function legCounts(eventRows, splitFilter = () => true) {
  const scoped = eventRows.filter(splitFilter)
  return {
    weatherFollow: scoped.filter((row) => row.leg === 'weather-follow').length,
    weatherReversion: scoped.filter((row) => row.leg === 'weather-reversion').length,
    summerColdShort: scoped.filter((row) => row.thesisKind === 'summer-cold-short').length,
    summerHeatLong: scoped.filter((row) => row.thesisKind === 'summer-heat-long').length,
    reversionLong: scoped.filter((row) => row.leg === 'weather-reversion' && row.direction === 'long').length,
    reversionShort: scoped.filter((row) => row.leg === 'weather-reversion' && row.direction === 'short').length,
  }
}

function causalSideMetric(rows, thesisMatches, splitFilter = () => true) {
  const pointsByDate = new Map()
  let tradeCount = 0
  for (const row of rows) {
    if (!splitFilter(row)) continue
    const contributions = causalReturnContributionsForRow(row)
    if (thesisMatches(contributions[1].thesisKind)) tradeCount += 1
    for (const contribution of contributions) {
      if (!thesisMatches(contribution.thesisKind)) continue
      const point = pointsByDate.get(row.entryTradeDate) ?? { returnPct: 0, position: 0 }
      point.returnPct += contribution.returnPct
      if (Math.abs(contribution.position) > Math.abs(point.position)) point.position = contribution.position
      pointsByDate.set(row.entryTradeDate, point)
    }
  }

  const points = [...pointsByDate.entries()].map(([date, point]) => ({
    date,
    equity: INITIAL_CAPITAL * (1 + point.returnPct / 100),
    dailyPnlPct: point.returnPct,
    drawdownPct: point.returnPct < 0 ? point.returnPct : 0,
    position: point.position,
  }))
  return metricsFromCurve(points, tradeCount)
}

function sideReturnSnapshot(rows, splitFilter = () => true) {
  return {
    summerColdShort: causalSideMetric(rows, (thesisKind) => thesisKind === 'summer-cold-short', splitFilter),
    summerHeatLong: causalSideMetric(rows, (thesisKind) => thesisKind === 'summer-heat-long', splitFilter),
    weatherFollow: causalSideMetric(
      rows,
      (thesisKind) => ['summer-cold-short', 'summer-heat-long'].includes(thesisKind),
      splitFilter,
    ),
    reversionLong: causalSideMetric(rows, (thesisKind) => thesisKind === 'reversion-long', splitFilter),
    reversionShort: causalSideMetric(rows, (thesisKind) => thesisKind === 'reversion-short', splitFilter),
    weatherReversion: causalSideMetric(
      rows,
      (thesisKind) => ['reversion-long', 'reversion-short'].includes(thesisKind),
      splitFilter,
    ),
  }
}

function summarizeCandidate(days, rowsByIssueDate, indexBenchmarks, candidate, reliabilityWeights, signalCache, weatherResolutionData, options = {}) {
  const cacheKey = signalCacheKey(candidate)
  const signals = signalCache.get(cacheKey) ?? signalsForCandidate(rowsByIssueDate, candidate, reliabilityWeights)
  signalCache.set(cacheKey, signals)
  const {
    byIndex,
    eventRows: scheduledEventRows,
    skippedHeatFollowSignals,
    weatherResolutionAdjustedRows,
    weatherResolutionDroppedRows,
  } = scheduleOverlay(days, signals, candidate, weatherResolutionData)
  const { curve, rows } = buildCurve(days, byIndex)
  const overlayRows = rows.filter((row) => row.windowId !== 'index-fallback')
  const eventRows = executedEventRowsFromRows(rows)
  const completedEvents = eventRows.length
  const allMetrics = metricsFromCurve(curve, completedEvents)
  const trainMetrics = metricsFromCurve(curveForSplit(curve, 'train'), eventRowsForSplit(eventRows, 'train').length)
  const validationMetrics = metricsFromCurve(curveForSplit(curve, 'validation'), eventRowsForSplit(eventRows, 'validation').length)
  const holdoutMetrics = metricsFromCurve(curveForSplit(curve, 'holdout'), eventRowsForSplit(eventRows, 'holdout').length)
  const splitEdges = {
    train: round(trainMetrics.totalReturnPct - indexBenchmarks.train.totalReturnPct, 2),
    validation: round(validationMetrics.totalReturnPct - indexBenchmarks.validation.totalReturnPct, 2),
    holdout: round(holdoutMetrics.totalReturnPct - indexBenchmarks.holdout.totalReturnPct, 2),
    all: round(allMetrics.totalReturnPct - indexBenchmarks.all.totalReturnPct, 2),
  }
  const profitableTrainYears = [...new Set(curveForSplit(curve, 'train').map((point) => point.date.slice(0, 4)))]
    .map((year) => curve.filter((point) => point.date.startsWith(year)))
    .filter((yearCurve) => metricsFromCurve(yearCurve, 0).totalReturnPct > 0).length
  const result = {
    candidateId: [
      'summer',
      candidate.sourceSetId,
      candidate.sourceWeightMode,
      `a${candidate.anomalyThreshold}`,
      `c${candidate.coverageThreshold}`,
      `q${candidate.minConfidence}`,
      `wf${candidate.weatherFraction}`,
      `rf${candidate.reversionFraction}`,
      `rd${candidate.reversionDemandMode}`,
      `fh${candidate.followHoldDays}`,
      `rh${candidate.reversionHoldDays}`,
      `mv${candidate.minRealizedMovePct}`,
      `fresh${candidate.freshHeatLookbackDays}`,
      `wr${candidate.weatherResolutionMode}`,
      `sdef${STORAGE_DEFICIT_HEAT_SIZE_MULTIPLIER}`,
      `vol${candidate.volTargetPct}`,
      candidate.sizingMode,
    ].join('-'),
    architectureId: 'summer-weather-follow-and-fade',
    architectureLabel: 'Confirmed heat follow plus storage-aware same-direction fade',
    architectureDescription:
      'Use multi-model forecast consensus to trade summer heat demand first, then fade only gas moves that overextend in the weather-demand direction when storage is not tight.',
    useFollowLeg: true,
    useReversionLeg: true,
    ...candidate,
    allMetrics,
    trainMetrics,
    validationMetrics,
    holdoutMetrics,
    indexMetrics: {
      all: indexBenchmarks.all,
      train: indexBenchmarks.train,
      validation: indexBenchmarks.validation,
      holdout: indexBenchmarks.holdout,
    },
    splitEdges,
    signalCount: signals.length,
    scheduledEventCount: scheduledEventRows.length,
    skippedHeatFollowSignals,
    storageDeficitHeatTiltRows: overlayRows.filter((row) => row.thesisKind === 'summer-heat-long' && row.storageDeficitHeatTilt).length,
    coolingDemandReversionRows: overlayRows.filter(
      (row) => row.windowId === 'weather-reversion' && row.reversionDemandMode === 'cooling-demand-tiered',
    ).length,
    weatherResolutionAdjustedRows,
    weatherResolutionDroppedRows,
    completedEventCount: completedEvents,
    overlayDayCount: overlayRows.length,
    fallbackDayCount: rows.length - overlayRows.length,
    profitableTrainYears,
    trainYearCount: [...new Set(curveForSplit(curve, 'train').map((point) => point.date.slice(0, 4)))].length,
    legCounts: {
      all: legCounts(eventRows),
      trainValidation: legCounts(eventRows, (row) => row.entryTradeDate <= VALIDATION_END),
      train: legCounts(eventRows, (row) => daySplit(row.entryTradeDate) === 'train'),
      validation: legCounts(eventRows, (row) => daySplit(row.entryTradeDate) === 'validation'),
      holdout: legCounts(eventRows, (row) => daySplit(row.entryTradeDate) === 'holdout'),
    },
    sideReturns: {
      all: sideReturnSnapshot(rows),
      trainValidation: sideReturnSnapshot(rows, (row) => row.entryTradeDate <= VALIDATION_END),
      holdout: sideReturnSnapshot(rows, (row) => daySplit(row.entryTradeDate) === 'holdout'),
    },
    eventRows: options.keepRows ? eventRows : undefined,
    rows: options.keepRows ? rows : undefined,
    curve: options.keepRows ? curve : undefined,
  }
  return {
    ...result,
    eligible: isEligible(result),
    trainValidationRank: trainValidationRank(result),
  }
}

function isEligible(result) {
  const trainValidationLegs = result.legCounts.trainValidation
  const trainValidationSides = result.sideReturns.trainValidation
  return (
    result.minFamilies >= 2 &&
    result.trainMetrics.tradeCount >= 40 &&
    result.validationMetrics.tradeCount >= 12 &&
    trainValidationLegs.weatherFollow >= 40 &&
    trainValidationLegs.weatherReversion >= 4 &&
    trainValidationLegs.summerHeatLong >= 40 &&
    trainValidationLegs.reversionShort >= 4 &&
    result.trainMetrics.maxDrawdownPct >= -35 &&
    result.validationMetrics.maxDrawdownPct >= -25 &&
    result.trainMetrics.totalReturnPct > 0 &&
    result.validationMetrics.totalReturnPct > 0 &&
    result.splitEdges.train > 0 &&
    result.splitEdges.validation > 0 &&
    result.validationMetrics.sharpe >= 0.8 &&
    trainValidationSides.summerHeatLong.totalReturnPct > 0 &&
    trainValidationSides.reversionShort.totalReturnPct > 0 &&
    trainValidationSides.weatherReversion.totalReturnPct > 0 &&
    result.profitableTrainYears >= 2
  )
}

function trainValidationRank(result) {
  const train = result.trainMetrics
  const validation = result.validationMetrics
  const trainValidationExecutedRows = train.tradeCount + validation.tradeCount
  const legDepth = result.legCounts.trainValidation.summerHeatLong + result.legCounts.trainValidation.reversionShort
  const sideQuality =
    Math.min(18, result.sideReturns.trainValidation.summerHeatLong.totalReturnPct) +
    Math.min(12, result.sideReturns.trainValidation.reversionShort.totalReturnPct)
  const complexityPenalty = result.sourceWeightMode === 'bg-shrink' ? 0.75 : 0
  return round(
    result.splitEdges.train * 0.9 +
      result.splitEdges.validation * 1.45 +
      train.sharpe * 8 +
      validation.sharpe * 11 +
      train.sortino * 3 +
      validation.sortino * 4 +
      train.maxDrawdownPct * 0.35 +
      validation.maxDrawdownPct * 0.45 +
      Math.sqrt(trainValidationExecutedRows) * 1.25 +
      result.profitableTrainYears * 1.5 +
      Math.sqrt(legDepth) * 1.25 +
      sideQuality * 0.2 -
      complexityPenalty,
    4,
  )
}

function formatCandidateRow(candidate) {
  return {
    candidateId: candidate.candidateId,
    eligible: candidate.eligible,
    trainValidationRank: candidate.trainValidationRank,
    architectureId: candidate.architectureId,
    sourceSetId: candidate.sourceSetId,
    sourceWeightMode: candidate.sourceWeightMode,
    sizingMode: candidate.sizingMode,
    anomalyThreshold: candidate.anomalyThreshold,
    coverageThreshold: candidate.coverageThreshold,
    minConfidence: candidate.minConfidence,
    weatherFraction: candidate.weatherFraction,
    reversionFraction: candidate.reversionFraction,
    reversionDemandMode: candidate.reversionDemandMode,
    followHoldDays: candidate.followHoldDays,
    reversionHoldDays: candidate.reversionHoldDays,
    minRealizedMovePct: candidate.minRealizedMovePct,
    freshHeatLookbackDays: candidate.freshHeatLookbackDays,
    weatherResolutionMode: candidate.weatherResolutionMode,
    storageDeficitHeatMultiplier: STORAGE_DEFICIT_HEAT_SIZE_MULTIPLIER,
    storageDeficitHeatMaxFraction: STORAGE_DEFICIT_HEAT_MAX_FRACTION,
    storageSeasonalLookbackYears: STORAGE_SEASONAL_LOOKBACK_YEARS,
    storageAvailabilityContract: 'versioned-release-calendar-before-session-open',
    volTargetPct: candidate.volTargetPct,
    signals: candidate.signalCount,
    scheduledEvents: candidate.scheduledEventCount,
    executedRows: candidate.completedEventCount,
    storageDeficitHeatTiltRows: candidate.storageDeficitHeatTiltRows,
    coolingDemandReversionRows: candidate.coolingDemandReversionRows,
    weatherResolutionAdjustedRows: candidate.weatherResolutionAdjustedRows,
    weatherResolutionDroppedRows: candidate.weatherResolutionDroppedRows,
    weatherFollowRows: candidate.legCounts.all.weatherFollow,
    reversionRows: candidate.legCounts.all.weatherReversion,
    summerColdShortRows: candidate.legCounts.all.summerColdShort,
    summerHeatLongRows: candidate.legCounts.all.summerHeatLong,
    reversionLongRows: candidate.legCounts.all.reversionLong,
    reversionShortRows: candidate.legCounts.all.reversionShort,
    trainValidationSummerColdShortReturnPct: candidate.sideReturns.trainValidation.summerColdShort.totalReturnPct,
    trainValidationSummerHeatLongReturnPct: candidate.sideReturns.trainValidation.summerHeatLong.totalReturnPct,
    trainValidationFollowReturnPct: candidate.sideReturns.trainValidation.weatherFollow.totalReturnPct,
    trainValidationReversionLongReturnPct: candidate.sideReturns.trainValidation.reversionLong.totalReturnPct,
    trainValidationReversionShortReturnPct: candidate.sideReturns.trainValidation.reversionShort.totalReturnPct,
    trainValidationReversionReturnPct: candidate.sideReturns.trainValidation.weatherReversion.totalReturnPct,
    holdoutFollowReturnPct: candidate.sideReturns.holdout.weatherFollow.totalReturnPct,
    holdoutReversionReturnPct: candidate.sideReturns.holdout.weatherReversion.totalReturnPct,
    overlayDays: candidate.overlayDayCount,
    fallbackDays: candidate.fallbackDayCount,
    trainReturnPct: candidate.trainMetrics.totalReturnPct,
    trainIndexReturnPct: candidate.indexMetrics.train.totalReturnPct,
    trainEdgePct: candidate.splitEdges.train,
    trainSharpe: candidate.trainMetrics.sharpe,
    trainMaxDrawdownPct: candidate.trainMetrics.maxDrawdownPct,
    profitableTrainYears: candidate.profitableTrainYears,
    trainYearCount: candidate.trainYearCount,
    validationReturnPct: candidate.validationMetrics.totalReturnPct,
    validationIndexReturnPct: candidate.indexMetrics.validation.totalReturnPct,
    validationEdgePct: candidate.splitEdges.validation,
    validationSharpe: candidate.validationMetrics.sharpe,
    validationMaxDrawdownPct: candidate.validationMetrics.maxDrawdownPct,
    holdoutReturnPct: candidate.holdoutMetrics.totalReturnPct,
    holdoutIndexReturnPct: candidate.indexMetrics.holdout.totalReturnPct,
    holdoutEdgePct: candidate.splitEdges.holdout,
    holdoutSharpe: candidate.holdoutMetrics.sharpe,
    holdoutMaxDrawdownPct: candidate.holdoutMetrics.maxDrawdownPct,
    allReturnPct: candidate.allMetrics.totalReturnPct,
    allIndexReturnPct: candidate.indexMetrics.all.totalReturnPct,
    allEdgePct: candidate.splitEdges.all,
    allSharpe: candidate.allMetrics.sharpe,
    allMaxDrawdownPct: candidate.allMetrics.maxDrawdownPct,
  }
}

function sideMetrics(rows) {
  return {
    summerColdShort: causalSideMetric(rows, (thesisKind) => thesisKind === 'summer-cold-short'),
    summerHeatLong: causalSideMetric(rows, (thesisKind) => thesisKind === 'summer-heat-long'),
    reversionLong: causalSideMetric(rows, (thesisKind) => thesisKind === 'reversion-long'),
    reversionShort: causalSideMetric(rows, (thesisKind) => thesisKind === 'reversion-short'),
    fallback: causalSideMetric(rows, (thesisKind) => thesisKind === 'index-fallback'),
  }
}

function yearMetrics(curve) {
  return [...new Set(curve.map((point) => point.date.slice(0, 4)))].sort().map((year) => ({
    year,
    ...metricsFromCurve(curve.filter((point) => point.date.startsWith(year)), 0),
  }))
}

function createSeededRandom(seed = 1729) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function blockBootstrapMeans(values, { seed = 1729 } = {}) {
  const random = createSeededRandom(seed)
  const means = []

  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    const sample = []
    while (sample.length < values.length) {
      const start = Math.floor(random() * values.length)
      for (let offset = 0; offset < BLOCK_LENGTH && sample.length < values.length; offset += 1) {
        sample.push(values[(start + offset) % values.length])
      }
    }
    means.push(mean(sample))
  }

  return means
}

function pValueFromNullMeans(nullMeans, observed) {
  const exceedances = nullMeans.filter((value) => value >= observed).length
  return round((exceedances + 1) / (BOOTSTRAP_ITERATIONS + 1), 4)
}

function pctSummary(values) {
  return {
    p05: round(percentile(values, 0.05) * 100, 5),
    p50: round(percentile(values, 0.5) * 100, 5),
    p95: round(percentile(values, 0.95) * 100, 5),
  }
}

function candidateFamilyRealityCheck(selectedCurve, familyCandidates, observed) {
  const selectedDates = selectedCurve.map((point) => point.date)
  const family = familyCandidates
    .filter((candidate) => candidate.eligible && candidate.curve?.length)
    .map((candidate) => {
      const byDate = new Map(candidate.curve.map((point) => [point.date, point.activeReturnPct / 100]))
      const returns = selectedDates.map((date) => byDate.get(date) ?? 0)
      const candidateObserved = mean(returns)
      return {
        candidateId: candidate.candidateId,
        observed: candidateObserved,
        centeredReturns: returns.map((value) => value - candidateObserved),
      }
    })

  if (!family.length) return null

  const random = createSeededRandom(7919)
  const maxNullMeans = []
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    const sums = Array.from({ length: family.length }, () => 0)
    let sampledCount = 0

    while (sampledCount < selectedDates.length) {
      const start = Math.floor(random() * selectedDates.length)
      for (let offset = 0; offset < BLOCK_LENGTH && sampledCount < selectedDates.length; offset += 1) {
        const sampleIndex = (start + offset) % selectedDates.length
        family.forEach((candidate, candidateIndex) => {
          sums[candidateIndex] += candidate.centeredReturns[sampleIndex]
        })
        sampledCount += 1
      }
    }

    maxNullMeans.push(Math.max(...sums.map((sum) => sum / selectedDates.length)))
  }

  const bestObserved = family.reduce((best, candidate) => (candidate.observed > best.observed ? candidate : best), family[0])

  return {
    candidateFamilySize: family.length,
    pValue: pValueFromNullMeans(maxNullMeans, observed),
    nullMaxMeanDailyEdgePct: pctSummary(maxNullMeans),
    bestObservedCandidateId: bestObserved.candidateId,
    bestObservedAverageDailyEdgePct: round(bestObserved.observed * 100, 5),
  }
}

function blockBootstrapRealityCheck(curve, familyCandidates = []) {
  const activeReturns = curve.map((point) => point.activeReturnPct / 100)
  const observed = mean(activeReturns)
  if (!activeReturns.length || observed <= 0) {
    return {
      observedAverageDailyEdgePct: round(observed * 100, 4),
      pValue: 1,
      singleCandidatePValue: 1,
      selectionAdjustedPValue: null,
      iterations: BOOTSTRAP_ITERATIONS,
      blockLength: BLOCK_LENGTH,
    }
  }

  const centered = activeReturns.map((value) => value - observed)
  const meanBootstrapMeans = blockBootstrapMeans(activeReturns)
  const nullBootstrapMeans = blockBootstrapMeans(centered)
  const familyCheck = candidateFamilyRealityCheck(curve, familyCandidates, observed)
  const singleCandidatePValue = pValueFromNullMeans(nullBootstrapMeans, observed)
  const primaryPValue = familyCheck?.pValue ?? singleCandidatePValue

  return {
    method: familyCheck
      ? 'rank-window selection-adjusted centered circular block bootstrap'
      : 'centered circular block bootstrap',
    comparison: 'strategy net daily return minus US index basket daily return',
    alternative: 'greater-than-zero daily active edge',
    observedAverageDailyEdgePct: round(observed * 100, 5),
    observedAnnualizedEdgePct: round(observed * TRADING_DAYS * 100, 2),
    pValue: primaryPValue,
    singleCandidatePValue,
    selectionAdjustedPValue: familyCheck?.pValue ?? null,
    candidateFamilySize: familyCheck?.candidateFamilySize ?? 1,
    rankWindow: familyCheck ? REALITY_CHECK_RANK_WINDOW : null,
    bestObservedCandidateId: familyCheck?.bestObservedCandidateId ?? null,
    bestObservedAverageDailyEdgePct: familyCheck?.bestObservedAverageDailyEdgePct ?? null,
    dailyActiveVolPct: round(std(activeReturns) * 100, 4),
    meanConfidenceIntervalDailyEdgePct: pctSummary(meanBootstrapMeans),
    nullConfidenceIntervalDailyEdgePct: pctSummary(nullBootstrapMeans),
    nullMaxMeanDailyEdgePct: familyCheck?.nullMaxMeanDailyEdgePct ?? null,
    sampleCount: activeReturns.length,
    activeOverlayDays: curve.filter((point) => Math.abs(point.position) > 1e-9).length,
    minimumResolvablePValue: round(1 / (BOOTSTRAP_ITERATIONS + 1), 4),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BLOCK_LENGTH,
  }
}

function reversionDemandModeDescription(mode) {
  if (mode !== 'cooling-demand-tiered') return 'fixed reversion sizing'
  return `cooling-demand tiered sizing: CDD anomaly < ${COOLING_DEMAND_SOLID_ANOMALY_F}F trims the fade, ${COOLING_DEMAND_SOLID_ANOMALY_F}-${COOLING_DEMAND_EXTREME_ANOMALY_F}F modestly adds size, and >= ${COOLING_DEMAND_EXTREME_ANOMALY_F}F can lift the fade up to ${COOLING_DEMAND_REVERSION_EXTREME_MAX_FRACTION}x`
}

function buildReport(summary) {
  const selected = summary.selected
  const topCandidates = summary.candidates.slice(0, 12)
  const forecastCoverage = summary.validation.forecastCoverage
  const forecastCoverageSources = forecastCoverage.sources
    .map(
      (source) =>
        `${source.sourceId}: ${source.completeIssueDateCount}/${source.requiredIssueDateCount} complete, ${source.missingIssueDateCount} missing`,
    )
    .join('; ')

  return `# NGAS Summer Alpha Lane

Generated at ${summary.generatedAt}.

## Purpose

This is the NGAS Summer Alpha cooling-season research strategy. It explicitly requires both active legs: a multi-model summer heat-demand follow trade and a same-direction post-move overreaction fade. Capital that is not assigned to gas stays in the diversified US index basket.

## Research Basis

- Demand link: EIA treats cooling degree days as the measure of air-conditioning need, so this lane maps broad summer warmth to higher gas-fired power demand and broad summer coolness to lower demand.
- Forecast-combination link: Bates-Granger-style forecast combination says independent forecasts can contain useful information even when none should be selected alone. This lane tests equal-weight and train-only inverse-error-shrunk source weights.
- Weather-risk-premium link: published natural-gas event studies report that U.S. natural gas futures react to forecasted temperatures and temperature shocks.
- Freshness link: the heat-follow leg only buys the first broad heat signal after a quiet period, because repeated heat forecasts are more likely already priced.
- Storage-deficit link: the heat-follow leg gets a modest size tilt only when the latest EIA Lower 48 storage report available before the session open is below its trailing ${STORAGE_SEASONAL_LOOKBACK_YEARS}-year seasonal norm, because summer heat should matter more when the supply cushion is thinner.
- Overreaction link: the fade leg is a constrained contrarian response only when gas first moves in the weather-demand direction, not a standalone price-only reversal.
- Cooling-demand fade sizing link: the fade can size heat-rally shorts by forecast CDD anomaly, because CDD is closer to summer power-sector gas burn than raw temperature anomaly alone.
- Storage-aware fade link: heat-driven rallies are not faded when the latest released Lower 48 storage report is below its trailing seasonal norm, because a tight balance sheet can let weather risk persist.
- Overfit control: candidate rank uses train and validation only. Holdout after ${HOLDOUT_START} is reported after selection, and a deterministic block-bootstrap reality check is run on daily active return versus the index fallback.

## Selected Candidate

- Architecture: ${selected.architectureLabel}.
- Source set: ${selected.sourceSetLabel}.
- Source weighting: ${selected.sourceWeightMode === 'bg-shrink' ? 'train-only inverse forecast-error shrinkage' : 'equal forecast weights'}.
- Weather leg: ${selected.weatherFraction}x max UNG return sleeve for ${selected.followHoldDays} trading day(s), long only on fresh broad summer heat after ${selected.freshHeatLookbackDays} quiet calendar day(s). NG=F remains a price-confirmation input; cool-short rows remain diagnostic until the data produces enough confirmed cool events.
- Storage tilt: fresh heat-follow rows are scaled by ${STORAGE_DEFICIT_HEAT_SIZE_MULTIPLIER}x, capped at ${STORAGE_DEFICIT_HEAT_MAX_FRACTION}x notional, only when the latest EIA storage report published before that session's open is below its trailing ${STORAGE_SEASONAL_LOOKBACK_YEARS}-year seasonal average.
- Reversion leg: ${selected.reversionFraction}x max UNG return sleeve for ${selected.reversionHoldDays} trading day(s) after a ${selected.minRealizedMovePct}% realized same-direction NG=F move, opposite the weather-driven move. Heat-rally fades are skipped when released storage is below its trailing seasonal norm.
- Reversion demand sizing: ${reversionDemandModeDescription(selected.reversionDemandMode)}.
- Close-in weather-resolution fade check: ${selected.weatherResolutionMode === 'graded-shift' ? 'graded GFS/GEFS lead-1 to lead-3 forecast shift sizing' : 'none'}.
- Sizing: ${selected.sizingMode}${selected.sizingMode === 'vol-target' ? `, ${selected.volTargetPct}% annualized NG=F signal-volatility target` : ''}.
- Signal gates: absolute forecast anomaly >= ${selected.anomalyThreshold}F; side coverage >= ${selected.coverageThreshold}; confidence >= ${selected.minConfidence}; source groups >= ${selected.minGroups}; model families >= ${selected.minFamilies}; heat-follow freshness lookback ${selected.freshHeatLookbackDays} calendar day(s).
- Execution: prior-close holdings earn the overnight move; current UNG/VOO/QQQM targets become effective at the split-adjusted session open.
- Cost: frozen ${EXECUTION_CONTRACT.contractId} baseline, with ${BASELINE_EXECUTION_SCENARIO.oneWayBps.UNG} bps one-way on UNG and ${BASELINE_EXECUTION_SCENARIO.oneWayBps.VOO} bp one-way on each index ETF leg, applied to drift-aware executed turnover.
- Selection: candidate rank used train and validation only. Holdout rows after ${HOLDOUT_START} were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | ${selected.trainMetrics.tradeCount} | ${selected.trainMetrics.totalReturnPct}% | ${selected.indexMetrics.train.totalReturnPct}% | ${selected.splitEdges.train}% | ${selected.trainMetrics.cagrPct}% | ${selected.trainMetrics.sharpe} | ${selected.trainMetrics.sortino} | ${selected.trainMetrics.maxDrawdownPct}% | ${selected.trainMetrics.exposurePct}% |
| Validation | ${selected.validationMetrics.tradeCount} | ${selected.validationMetrics.totalReturnPct}% | ${selected.indexMetrics.validation.totalReturnPct}% | ${selected.splitEdges.validation}% | ${selected.validationMetrics.cagrPct}% | ${selected.validationMetrics.sharpe} | ${selected.validationMetrics.sortino} | ${selected.validationMetrics.maxDrawdownPct}% | ${selected.validationMetrics.exposurePct}% |
| Holdout | ${selected.holdoutMetrics.tradeCount} | ${selected.holdoutMetrics.totalReturnPct}% | ${selected.indexMetrics.holdout.totalReturnPct}% | ${selected.splitEdges.holdout}% | ${selected.holdoutMetrics.cagrPct}% | ${selected.holdoutMetrics.sharpe} | ${selected.holdoutMetrics.sortino} | ${selected.holdoutMetrics.maxDrawdownPct}% | ${selected.holdoutMetrics.exposurePct}% |
| Full | ${selected.allMetrics.tradeCount} | ${selected.allMetrics.totalReturnPct}% | ${selected.indexMetrics.all.totalReturnPct}% | ${selected.splitEdges.all}% | ${selected.allMetrics.cagrPct}% | ${selected.allMetrics.sharpe} | ${selected.allMetrics.sortino} | ${selected.allMetrics.maxDrawdownPct}% | ${selected.allMetrics.exposurePct}% |

## Executed Leg Rows

| split | follow | reversion | summer-cold-short | summer-heat-long | reversion-long | reversion-short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train/validation | ${selected.legCounts.trainValidation.weatherFollow} | ${selected.legCounts.trainValidation.weatherReversion} | ${selected.legCounts.trainValidation.summerColdShort} | ${selected.legCounts.trainValidation.summerHeatLong} | ${selected.legCounts.trainValidation.reversionLong} | ${selected.legCounts.trainValidation.reversionShort} |
| Holdout | ${selected.legCounts.holdout.weatherFollow} | ${selected.legCounts.holdout.weatherReversion} | ${selected.legCounts.holdout.summerColdShort} | ${selected.legCounts.holdout.summerHeatLong} | ${selected.legCounts.holdout.reversionLong} | ${selected.legCounts.holdout.reversionShort} |

## Side Checks

Train/validation side gates used for selection:

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Summer cold-short diagnostic | ${selected.sideReturns.trainValidation.summerColdShort.tradeCount} | ${selected.sideReturns.trainValidation.summerColdShort.totalReturnPct}% | ${selected.sideReturns.trainValidation.summerColdShort.sharpe} | ${selected.sideReturns.trainValidation.summerColdShort.maxDrawdownPct}% |
| Summer heat-long | ${selected.sideReturns.trainValidation.summerHeatLong.tradeCount} | ${selected.sideReturns.trainValidation.summerHeatLong.totalReturnPct}% | ${selected.sideReturns.trainValidation.summerHeatLong.sharpe} | ${selected.sideReturns.trainValidation.summerHeatLong.maxDrawdownPct}% |
| Weather follow combined | ${selected.sideReturns.trainValidation.weatherFollow.tradeCount} | ${selected.sideReturns.trainValidation.weatherFollow.totalReturnPct}% | ${selected.sideReturns.trainValidation.weatherFollow.sharpe} | ${selected.sideReturns.trainValidation.weatherFollow.maxDrawdownPct}% |
| Reversion-long | ${selected.sideReturns.trainValidation.reversionLong.tradeCount} | ${selected.sideReturns.trainValidation.reversionLong.totalReturnPct}% | ${selected.sideReturns.trainValidation.reversionLong.sharpe} | ${selected.sideReturns.trainValidation.reversionLong.maxDrawdownPct}% |
| Reversion-short | ${selected.sideReturns.trainValidation.reversionShort.tradeCount} | ${selected.sideReturns.trainValidation.reversionShort.totalReturnPct}% | ${selected.sideReturns.trainValidation.reversionShort.sharpe} | ${selected.sideReturns.trainValidation.reversionShort.maxDrawdownPct}% |
| Weather reversion combined | ${selected.sideReturns.trainValidation.weatherReversion.tradeCount} | ${selected.sideReturns.trainValidation.weatherReversion.totalReturnPct}% | ${selected.sideReturns.trainValidation.weatherReversion.sharpe} | ${selected.sideReturns.trainValidation.weatherReversion.maxDrawdownPct}% |

## Anti-Overfit Check

- Candidate search count: ${summary.search.candidateCount}.
- Eligible dual-leg candidates: ${summary.search.eligibleCandidateCount}.
- Skipped clustered heat-follow signals: ${selected.skippedHeatFollowSignals}.
- Storage-deficit boosted heat-follow rows: ${selected.storageDeficitHeatTiltRows}.
- Cooling-demand-sized reversion rows: ${selected.coolingDemandReversionRows}.
- Close-in weather-resolution adjusted rows: ${selected.weatherResolutionAdjustedRows}.
- Close-in weather-resolution dropped rows: ${selected.weatherResolutionDroppedRows}.
- Close-in weather-resolution comparison: ${summary.search.weatherResolutionComparison}.
- Primary block-bootstrap p-value versus index daily active return: ${summary.validation.realityCheck.pValue} (${summary.validation.realityCheck.method}).
- Single-candidate p-value: ${summary.validation.realityCheck.singleCandidatePValue}.
- Selection-adjusted p-value: ${summary.validation.realityCheck.selectionAdjustedPValue ?? 'n/a'} across ${summary.validation.realityCheck.candidateFamilySize} near-top eligible candidates.
- Bootstrap setup: ${summary.validation.realityCheck.iterations} iterations, ${summary.validation.realityCheck.blockLength}-session circular blocks.
- Forecast-coverage promotion gate: ${forecastCoverage.complete ? 'pass' : 'fail'} (${forecastCoverage.status}); ${forecastCoverage.fullyCoveredIssueDateCount}/${forecastCoverage.requiredIssueDateCount} required issue dates are complete across every active source.
- Forecast coverage by source: ${forecastCoverageSources}.
- Missing forecast issue span: ${forecastCoverage.firstMissingIssueDate ?? 'none'} through ${forecastCoverage.lastMissingIssueDate ?? 'none'}; missing periods remain index fallback in the research ledger and cannot qualify the component for promotion.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | weather resolution | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
${topCandidates
  .map(
    (candidate) =>
      `| ${candidate.candidateId} | ${candidate.eligible ? 'yes' : 'no'} | ${candidate.trainValidationRank} | ${candidate.weatherResolutionMode} | ${candidate.trainEdgePct}% | ${candidate.validationEdgePct}% | ${candidate.holdoutEdgePct}% | ${candidate.allEdgePct}% | ${candidate.executedRows} |`,
  )
  .join('\n')}

## Verdict

${summary.promotion.eligible
  ? 'The component promotion gates pass, but this remains a research strategy and is not independently broker-routable.'
  : 'Keep this component blocked from promotion. Missing required forecast inputs cannot be interpreted as evidence that an index fallback was the strategy target.'} It uses NG=F only for the Summer price-confirmation signal and calculates every gas-sleeve return with executable UNG history under the frozen causal-open cost contract. The cool-short side remains diagnostic until there are enough confirmed cooling-season cool events to validate it without overfitting.
`
}

function main() {
  const days = loadAlignedMarketDays()
  const indexCurve = indexMetricsForDays(days)
  const indexBenchmarks = {
    all: metricsFromCurve(indexCurve, 0),
    train: metricsFromCurve(curveForSplit(indexCurve, 'train'), 0),
    validation: metricsFromCurve(curveForSplit(indexCurve, 'validation'), 0),
    holdout: metricsFromCurve(curveForSplit(indexCurve, 'holdout'), 0),
  }
  const { scores, inputFiles, temperatureQuality } = loadForecastScores()
  const weatherResolutionData = loadWeatherResolutionData()
  const actualByDate = loadActualWeightedAnomaly()
  const reliability = computeSourceReliability(scores, actualByDate)
  const rowsByIssueDate = groupScoresByIssueDate(scores)
  const signalCache = new Map()
  const presentSources = new Set(scores.map((score) => score.sourceId))
  const sourceSets = SOURCE_SETS.map((sourceSet) => ({
    ...sourceSet,
    sourceIds: sourceSet.sourceIds.filter((sourceId) => presentSources.has(sourceId)),
  })).filter((sourceSet) => sourceSet.sourceIds.length)
  const activeSourceSetDefinition = SOURCE_SETS.find((sourceSet) => sourceSet.id === ACTIVE_FAMILY_SOURCE_SET_ID)
  const activeSourceSet = sourceSets.find((sourceSet) => sourceSet.id === ACTIVE_FAMILY_SOURCE_SET_ID)
  if (!activeSourceSetDefinition || !activeSourceSet) {
    throw new Error(`Active Summer Alpha source set ${ACTIVE_FAMILY_SOURCE_SET_ID} is unavailable in the current forecast data.`)
  }
  const forecastCoverage = summarizeSummerForecastCoverage({
    scores,
    requiredSourceIds: activeSourceSetDefinition.sourceIds,
    marketEndDate: days.at(-1)?.date,
  })

  const activeFamilyBase = {
    sourceSetId: activeSourceSet.id,
    sourceSetLabel: activeSourceSet.label,
    sourceIds: activeSourceSet.sourceIds,
    minGroups: activeSourceSet.minGroups,
    minFamilies: activeSourceSet.minFamilies,
    sourceWeightMode: 'equal',
    sizingMode: 'fixed',
    anomalyThreshold: 5,
    coverageThreshold: 0.25,
    minConfidence: 0.5,
    weatherFraction: 0.35,
    reversionFraction: 0.35,
    reversionDemandMode: 'cooling-demand-tiered',
    followHoldDays: 3,
    reversionHoldDays: 1,
    minRealizedMovePct: 2,
    freshHeatLookbackDays: HEAT_SIGNAL_FRESHNESS_LOOKBACK_DAYS,
    volTargetPct: 0,
  }
  const weatherResolutionModes = [...WEATHER_RESOLUTION_BASE_MODES, WEATHER_RESOLUTION_VARIANT_MODE]
  const candidates = weatherResolutionModes.map((weatherResolutionMode) =>
    summarizeCandidate(
      days,
      rowsByIssueDate,
      indexBenchmarks,
      {
        ...activeFamilyBase,
        weatherResolutionMode,
      },
      reliability.weights,
      signalCache,
      weatherResolutionData,
    ),
  )

  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    return b.trainValidationRank - a.trainValidationRank
  })

  const selectedCandidate = candidates.find((candidate) => candidate.eligible)
  if (!selectedCandidate) {
    throw new Error('No eligible summer-weather candidate satisfied heat-follow, same-direction fade, and multi-model confirmation gates.')
  }
  const selected = summarizeCandidate(
    days,
    rowsByIssueDate,
    indexBenchmarks,
    selectedCandidate,
    reliability.weights,
    signalCache,
    weatherResolutionData,
    { keepRows: true },
  )
  const familyRankFloor = selected.trainValidationRank - REALITY_CHECK_RANK_WINDOW
  const realityCheckFamily = candidates
    .filter((candidate) => candidate.eligible && candidate.trainValidationRank >= familyRankFloor)
    .map((candidate) =>
      summarizeCandidate(
        days,
        rowsByIssueDate,
        indexBenchmarks,
        candidate,
        reliability.weights,
        signalCache,
        weatherResolutionData,
        { keepRows: true },
      ),
    )
  const shadowCandidateDefinition = summerShadowCandidate(
    SUMMER_SHADOW_COMPARATOR_COMPONENT_CONTRACT.selected,
  )
  const shadowEvaluation = summarizeCandidate(
    days,
    rowsByIssueDate,
    indexBenchmarks,
    shadowCandidateDefinition,
    reliability.weights,
    signalCache,
    weatherResolutionData,
  )
  const summaryCandidates = candidates.map(formatCandidateRow)
  const statisticallyEligibleCandidateCount = candidates.filter((candidate) => candidate.eligible).length
  const summary = {
    artifactSchemaVersion: COMPONENT_ARTIFACT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    strategyId: STRATEGY_ID,
    data: {
      weatherManifest: path.relative(REPO_ROOT, MANIFEST_PATH),
      signalGasMarketFile: path.relative(REPO_ROOT, GAS_SIGNAL_FILE),
      executionMarketFiles: ['UNG', 'VOO', 'QQQM'].map((symbol) => `data/qore/market/yahoo/${symbol}-daily.csv`),
      executionContractFile: path.relative(REPO_ROOT, EXECUTION_CONTRACT.filePath),
      indexMarketFile: path.relative(REPO_ROOT, INDEX_MARKET_FILE),
      actualAnomalyFile: path.relative(REPO_ROOT, ACTUAL_ANOMALY_FILE),
      eiaStorageFile: path.relative(REPO_ROOT, EIA_STORAGE_FILE),
      eiaStorageReleaseCalendarFile: path.relative(REPO_ROOT, EIA_STORAGE_RELEASE_CALENDAR_FILE),
      weatherResolutionInputs: weatherResolutionData.inputFiles,
      weatherTemperatureQuality: {
        signalCalendars: temperatureQuality,
        weatherResolutionCalendars: weatherResolutionData.temperatureQuality,
      },
      firstSignalDate: FIRST_SIGNAL_DATE,
      marketStartDate: days[0]?.date,
      marketEndDate: days.at(-1)?.date,
      marketDays: days.length,
      forecastScoreRows: scores.length,
      inputFiles,
    },
    researchBasis: [
      {
        label: 'EIA degree days and weather-sensitive gas demand',
        url: 'https://www.eia.gov/energyexplained/units-and-calculators/degree-days.php',
      },
      {
        label: 'EIA Weather Sensitivity in Natural Gas Markets',
        url: 'https://www.eia.gov/outlooks/steo/special/pdf/2014_sp_03.pdf',
      },
      {
        label: 'Bates and Granger forecast combination',
        url: 'https://www.cambridge.org/core/books/abs/essays-in-econometrics/combination-of-forecasts/9DA6A0F804E60BA563AC01F98A9EE639',
      },
      {
        label: 'Extreme weather forecast risk in US natural gas futures',
        url: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4326098',
      },
      {
        label: 'White Reality Check for data snooping',
        url: 'https://www.ssc.wisc.edu/~bhansen/718/White2000.pdf',
      },
    ],
    contract: {
      trainEnd: TRAIN_END,
      validationEnd: VALIDATION_END,
      holdoutStart: HOLDOUT_START,
      ungRoundTripCostPct: ROUND_TRIP_COST_PCT,
      ungOneWayCostPct: ONE_WAY_COST_PCT,
      signalInstrument: {
        symbol: 'NG=F',
        role: 'Summer price confirmation, realized-move gates, and signal-volatility sizing only.',
      },
      pnlInstrument: {
        symbol: 'UNG',
        role: 'All gas-sleeve P&L, candidate ranking, and validation.',
      },
      execution: {
        contractId: EXECUTION_CONTRACT.contractId,
        contractDigest: EXECUTION_CONTRACT.digest,
        scenarioId: EXECUTION_CONTRACT.selectionScenarioId,
        priceConvention: EXECUTION_CONTRACT.priceConvention,
        deploymentFraction: EXECUTION_CONTRACT.deploymentFraction,
        rebalanceDeadbandPct: EXECUTION_CONTRACT.rebalanceDeadbandPct,
        rebalanceDeadbandPolicyId: EXECUTION_CONTRACT.rebalanceDeadbandPolicyId,
        indexWeights: EXECUTION_CONTRACT.indexWeights,
        selectionRule: EXECUTION_CONTRACT.selectionRule,
        costCalibration: EXECUTION_CONTRACT.costCalibration,
        oneWayBps: BASELINE_EXECUTION_SCENARIO.oneWayBps,
        annualBorrowRatePct: BASELINE_EXECUTION_SCENARIO.annualBorrowRatePct,
        borrowBasis: BASELINE_EXECUTION_SCENARIO.borrowBasis,
        scenarios: EXECUTION_CONTRACT.scenarios,
      },
      fallback: 'Unallocated deployable capital is routed to the configured VOO/QQQM target-weight index basket; the broker cash buffer remains uninvested.',
      signalTiming:
        'Forecast issue-date signals are used only on later trading sessions. Prior holdings earn close-to-open returns; current targets earn adjusted-open-to-close returns.',
      reversionTiming:
        'Reversion legs use realized gas moves through the weather-follow leg, require the move to match the weather-demand direction, start no earlier than the next trading session, and skip heat-rally fades when the latest storage report available before the open is below its trailing seasonal norm.',
      weatherResolutionTiming:
        `Close-in weather-resolution fade sizing is tested on the top ${WEATHER_RESOLUTION_VARIANT_POOL_SIZE} eligible base-grid candidates and uses frozen 00Z GFS/GEFS lead-1 to lead-3 forecasts with issueDate <= the reversion entry date. Same-date 00Z runs are assumed available before the New York session open because the historical calendar has no separate publication timestamp.`,
      reversionDemandSizing:
        `When selected, cooling-demand-tiered fade sizing uses forecast CDD anomaly versus a ${COOLING_DEMAND_BASE_F}F base: below ${COOLING_DEMAND_SOLID_ANOMALY_F}F trims reversion size, ${COOLING_DEMAND_SOLID_ANOMALY_F}-${COOLING_DEMAND_EXTREME_ANOMALY_F}F modestly adds size, and at least ${COOLING_DEMAND_EXTREME_ANOMALY_F}F can lift the reversion sleeve up to ${COOLING_DEMAND_REVERSION_EXTREME_MAX_FRACTION}x.`,
      heatSignalFreshness:
        'Summer heat-follow exposure is allowed only when no prior broad summer heat signal was issued within the fixed freshness lookback window; repeated heat signals can still qualify for the same-direction fade.',
      storageDeficitHeatTilt:
        `Fresh summer heat-follow exposure is multiplied by ${STORAGE_DEFICIT_HEAT_SIZE_MULTIPLIER}x, capped at ${STORAGE_DEFICIT_HEAT_MAX_FRACTION}x notional, only when the latest EIA Lower 48 storage report available before the session open is below its trailing ${STORAGE_SEASONAL_LOOKBACK_YEARS}-year seasonal average.`,
      storageTiming:
        'Storage rows are available only at a session open after their timestamp in the versioned EIA WNGSR release calendar; a missing release-calendar row fails artifact generation.',
      selectionPolicy:
        'The architecture requires fresh multi-model heat-follow and storage-aware same-direction overreaction-fade legs. Cool-short rows are kept diagnostic until the data produces enough confirmed cool events. Rank and eligibility use train and validation splits only; holdout metrics are reported after selection.',
      sourceWeighting:
        'bg-shrink weights are fit only on train-period forecast temperature errors versus NASA POWER actual weighted anomalies, then shrunk halfway toward equal weights.',
    },
    sourceReliability: reliability.diagnostics,
    selected: {
      ...selected,
      rows: undefined,
      eventRows: undefined,
      curve: undefined,
    },
    researchOnly: {
      prospectiveShadowChallenger: {
        ...SUMMER_SHADOW_CHALLENGER,
        contractDigestSha256: SUMMER_SHADOW_CHALLENGER_DIGEST_SHA256,
        comparator: {
          candidateId: selected.candidateId,
          selectedContractUnchanged: true,
        },
        historicalEvaluation: {
          evidenceStatus: SUMMER_SHADOW_CHALLENGER.evaluation.historicalEvidenceStatus,
          candidateId: SUMMER_SHADOW_CHALLENGER.challengerCandidateId,
          eligibleDiagnostic: shadowEvaluation.eligible,
          trainMetrics: shadowEvaluation.trainMetrics,
          validationMetrics: shadowEvaluation.validationMetrics,
          holdoutMetrics: shadowEvaluation.holdoutMetrics,
          allMetrics: shadowEvaluation.allMetrics,
          splitEdges: shadowEvaluation.splitEdges,
          legCounts: shadowEvaluation.legCounts,
          signalCount: shadowEvaluation.signalCount,
          overlayDayCount: shadowEvaluation.overlayDayCount,
        },
      },
    },
    search: {
      candidateCount: candidates.length,
      eligibleCandidateCount: statisticallyEligibleCandidateCount,
      weatherResolutionVariantPoolSize: WEATHER_RESOLUTION_VARIANT_POOL_SIZE,
      weatherResolutionComparison: 'current active Summer Alpha family with no close-in fade check versus graded close-in fade check',
      selectionUsedHoldout: false,
    },
    promotion: {
      eligible: statisticallyEligibleCandidateCount > 0 && forecastCoverage.promotionEligible,
      gates: {
        statisticallyEligibleCandidate: statisticallyEligibleCandidateCount > 0,
        forecastCoverageComplete: forecastCoverage.promotionEligible,
      },
    },
    validation: {
      sideMetrics: sideMetrics(selected.rows),
      yearMetrics: yearMetrics(selected.curve),
      realityCheck: blockBootstrapRealityCheck(selected.curve, realityCheckFamily),
      forecastCoverage,
    },
    outputFiles: {
      selectedTrades: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-trades.csv')),
      selectedEvents: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-events.csv')),
      candidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'candidate-summary.csv')),
      runSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'run-summary.json')),
    },
    candidates: summaryCandidates.slice(0, 75),
  }

  const selectedTradesText = rowsToCsv(selected.rows, [
    'strategyId',
    'signalDate',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'exitTradeDate',
    'targetTradeDate',
    'direction',
    'sourceId',
    'windowId',
    'thesisKind',
    'priorCloseThesisKind',
    'leadDays',
    'confidence',
    'weightedAnomalyF',
    'coolingDemandAnomalyF',
    'coolingDemandCoveragePct',
    'coolingDemandExtremeCount',
    'coveragePct',
    'coldCoveragePct',
    'warmCoveragePct',
    'extremeCount',
    'storageDate',
    'storageReleaseAt',
    'storageBcf',
    'storageSeasonalAverageBcf',
    'storageSeasonalDiffPct',
    'storageDeficitHeatTilt',
    'heatSizeMultiplier',
    'indexFraction',
    'ungPosition',
    'ungReturnPct',
    'indexReturnPct',
    'grossReturnPct',
    'tradingCostPct',
    'netReturnPct',
    'componentMaterialRow',
    'executionInstrument',
    'executionPriceConvention',
    'priorUngPosition',
    'deployedUngPosition',
    'deployedVooPosition',
    'deployedQqqmPosition',
    'ungOvernightReturnPct',
    'ungIntradayReturnPct',
    'vooReturnPct',
    'qqqmReturnPct',
    'indexOvernightReturnPct',
    'indexIntradayReturnPct',
    'overnightPortfolioReturnPct',
    'intradayPortfolioReturnPct',
    'priorCloseReturnContributionPct',
    'currentSessionReturnContributionPct',
    'gasTargetTurnover',
    'vooTargetTurnover',
    'qqqmTargetTurnover',
    'gasTurnover',
    'vooTurnover',
    'qqqmTurnover',
    'indexTurnover',
    'totalTurnover',
    'gasTradingCostPct',
    'vooTradingCostPct',
    'qqqmTradingCostPct',
    'borrowCostPct',
    'frictionContractId',
    'frictionScenarioId',
    'equity',
    'equityPct',
    'drawdownPct',
    'rank',
    'realizedMovePct',
    'reversionDemandMode',
    'weatherResolutionMode',
    'weatherResolutionSource',
    'weatherResolutionIssueDate',
    'weatherResolutionSourceIds',
    'weatherResolutionOriginalAnomalyF',
    'weatherResolutionAnomalyF',
    'weatherResolutionShiftF',
    'weatherResolutionAction',
    'weatherResolutionScale',
  ])
  summary.data.selectedTradesArtifact = buildComponentSelectedTradesBinding({
    repoRoot: REPO_ROOT,
    file: summary.outputFiles.selectedTrades,
    raw: selectedTradesText,
    rows: selected.rows,
    executionContract: EXECUTION_CONTRACT,
    label: 'NGAS Summer Alpha',
  })
  writeText(path.join(OUTPUT_DIR, 'selected-trades.csv'), selectedTradesText)

  writeText(path.join(OUTPUT_DIR, 'selected-events.csv'), rowsToCsv(selected.eventRows, [
    'leg',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'exitTradeDate',
    'direction',
    'sourceId',
    'thesisKind',
    'leadDays',
    'weightedAnomalyF',
    'coolingDemandAnomalyF',
    'coolingDemandCoveragePct',
    'coolingDemandExtremeCount',
    'coveragePct',
    'extremeCount',
    'confidence',
    'storageDate',
    'storageReleaseAt',
    'storageBcf',
    'storageSeasonalAverageBcf',
    'storageSeasonalDiffPct',
    'storageDeficitHeatTilt',
    'heatSizeMultiplier',
    'realizedMovePct',
    'reversionDemandMode',
    'weatherResolutionMode',
    'weatherResolutionSource',
    'weatherResolutionIssueDate',
    'weatherResolutionSourceIds',
    'weatherResolutionOriginalAnomalyF',
    'weatherResolutionAnomalyF',
    'weatherResolutionShiftF',
    'weatherResolutionAction',
    'weatherResolutionScale',
  ]))

  writeText(path.join(OUTPUT_DIR, 'candidate-summary.csv'), rowsToCsv(summaryCandidates, [
    'candidateId',
    'eligible',
    'trainValidationRank',
    'architectureId',
    'sourceSetId',
    'sourceWeightMode',
    'sizingMode',
    'anomalyThreshold',
    'coverageThreshold',
    'minConfidence',
    'weatherFraction',
    'reversionFraction',
    'reversionDemandMode',
    'followHoldDays',
    'reversionHoldDays',
    'minRealizedMovePct',
    'freshHeatLookbackDays',
    'weatherResolutionMode',
    'storageDeficitHeatMultiplier',
    'storageDeficitHeatMaxFraction',
    'storageSeasonalLookbackYears',
    'storageAvailabilityContract',
    'volTargetPct',
    'signals',
    'scheduledEvents',
    'executedRows',
    'storageDeficitHeatTiltRows',
    'coolingDemandReversionRows',
    'weatherResolutionAdjustedRows',
    'weatherResolutionDroppedRows',
    'weatherFollowRows',
    'reversionRows',
    'summerColdShortRows',
    'summerHeatLongRows',
    'reversionLongRows',
    'reversionShortRows',
    'trainValidationSummerColdShortReturnPct',
    'trainValidationSummerHeatLongReturnPct',
    'trainValidationFollowReturnPct',
    'trainValidationReversionLongReturnPct',
    'trainValidationReversionShortReturnPct',
    'trainValidationReversionReturnPct',
    'holdoutFollowReturnPct',
    'holdoutReversionReturnPct',
    'overlayDays',
    'fallbackDays',
    'trainReturnPct',
    'trainIndexReturnPct',
    'trainEdgePct',
    'trainSharpe',
    'trainMaxDrawdownPct',
    'profitableTrainYears',
    'trainYearCount',
    'validationReturnPct',
    'validationIndexReturnPct',
    'validationEdgePct',
    'validationSharpe',
    'validationMaxDrawdownPct',
    'holdoutReturnPct',
    'holdoutIndexReturnPct',
    'holdoutEdgePct',
    'holdoutSharpe',
    'holdoutMaxDrawdownPct',
    'allReturnPct',
    'allIndexReturnPct',
    'allEdgePct',
    'allSharpe',
    'allMaxDrawdownPct',
  ]))

  writeText(path.join(OUTPUT_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_DIR, 'report.md'), buildReport(summary))

  console.log(JSON.stringify({
    selected: summary.selected.candidateId,
    train: summary.selected.trainMetrics,
    validation: summary.selected.validationMetrics,
    holdout: summary.selected.holdoutMetrics,
    full: summary.selected.allMetrics,
    edge: summary.selected.splitEdges,
    legCounts: summary.selected.legCounts,
    realityCheck: summary.validation.realityCheck,
    forecastCoverage: summary.validation.forecastCoverage,
    promotion: summary.promotion,
    outputFiles: summary.outputFiles,
  }, null, 2))
}

main()
