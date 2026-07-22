#!/usr/bin/env node
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'
import { assertEiaStorageReleaseCalendarCoverage, eiaStorageReleaseAt } from './lib/eia-release-time.mjs'
import { liveGasPositionContractBlocks } from './lib/qore-live-inference-provenance.mjs'
import { resolveLiveWeatherPaths } from './lib/qore-live-paths.mjs'
import { loadAllYearStrategyArtifact, strategyArtifactBindingBlocks } from './lib/qore-live-strategy-artifact.mjs'
import { assertForecastLocationTemperatures } from './lib/qore-weather-data-quality.mjs'
import { omitApiKeyFields, redactSecretText } from './lib/secret-redaction.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const settingsFile = path.resolve(
  argValue(rawArgs, '--settings') ??
    process.env.QORE_LIVE_WEATHER_SETTINGS_FILE ??
    path.join(repoDir, 'config', 'qore-live-weather-settings.json'),
)
const liveWeatherSettings = readJsonFile(settingsFile, {})
const profileName = argValue(rawArgs, '--profile') ?? process.env.QORE_LIVE_WEATHER_PROFILE ?? liveWeatherSettings.defaultProfile ?? 'balanced'
const selectedProfile = liveWeatherSettings.profiles?.[profileName] ?? {}
const selectedProfileExists = Boolean(liveWeatherSettings.profiles?.[profileName])
const once = args.has('--once') || truthy(process.env.QORE_LIVE_WEATHER_ONCE)
const respectCadence = args.has('--respect-cadence') || truthy(process.env.QORE_LIVE_WEATHER_RESPECT_CADENCE)
const runLiveForecast = !args.has('--no-current-forecast') && settingBool('QORE_LIVE_WEATHER_CURRENT_FORECAST', 'runLiveForecast', true)
const runPerformanceTest = !args.has('--no-performance-test') && settingBool('QORE_LIVE_WEATHER_PERFORMANCE_TEST', 'runPerformanceTest', true)
const runForecastCalendar =
  args.has('--forecast-calendar') ||
  (!args.has('--no-forecast-calendar') && settingBool('QORE_LIVE_WEATHER_RUN_GFS_CALENDAR', 'runForecastCalendar', false))
const serviceIntervalMs = settingNumber('QORE_LIVE_WEATHER_INTERVAL_MS', 'liveForecastIntervalMs', 5 * 60 * 1000)
const performanceIntervalMs = settingNumber('QORE_LIVE_WEATHER_PERFORMANCE_INTERVAL_MS', 'performanceIntervalMs', 24 * 60 * 60 * 1000)
const forecastCalendarIntervalMs = settingNumber('QORE_LIVE_WEATHER_GFS_CALENDAR_INTERVAL_MS', 'forecastCalendarIntervalMs', 60 * 60 * 1000)
const fetchTimeoutMs = settingNumber('QORE_LIVE_WEATHER_FETCH_TIMEOUT_MS', 'fetchTimeoutMs', 15_000)
const fetchConcurrency = Math.max(1, Math.floor(settingNumber('QORE_LIVE_WEATHER_FETCH_CONCURRENCY', 'fetchConcurrency', 6)))
const fetchBatchSize = Math.max(1, Math.floor(settingNumber('QORE_LIVE_WEATHER_FETCH_BATCH_SIZE', 'fetchBatchSize', 6)))
const forecastDays = settingNumber('QORE_LIVE_WEATHER_FORECAST_DAYS', 'forecastDays', 10)
const normalStartDate = process.env.QORE_NORMAL_START ?? '1991-01-01'
const normalEndDate = process.env.QORE_NORMAL_END ?? '2020-12-31'
const liveModels = settingList('QORE_LIVE_WEATHER_MODELS', 'models', ['ecmwf_ifs025', 'gfs_global'])
const liveCadenceSettings = liveWeatherSettings.liveCadences ?? liveWeatherSettings.additionalLiveCadences ?? {}
const { stateDir, operatorStatePath, operatorStateSource } = resolveLiveWeatherPaths(repoDir)
const legacyOperatorStateFile = selectedProfile.cadences?.riskAndKillSwitchState?.operatorStateFile
  ?? liveCadenceSettings.riskAndKillSwitchState?.operatorStateFile
if (legacyOperatorStateFile !== undefined) {
  console.error('QORE warning: ignored deprecated riskAndKillSwitchState.operatorStateFile; use QORE_LIVE_OPERATOR_STATE_FILE or QORE_LIVE_WEATHER_STATE_DIR.')
}
const statusPath = path.resolve(process.env.QORE_LIVE_WEATHER_STATUS_FILE ?? path.join(stateDir, 'status.json'))
const snapshotPath = path.resolve(process.env.QORE_LIVE_WEATHER_SNAPSHOT_FILE ?? path.join(stateDir, 'current-weather-snapshot.json'))
const scoreCsvPath = path.resolve(process.env.QORE_LIVE_WEATHER_SCORE_CSV ?? path.join(stateDir, 'current-weather-scores.csv'))
const locationCsvPath = path.resolve(process.env.QORE_LIVE_WEATHER_LOCATION_CSV ?? path.join(stateDir, 'current-weather-location-anomalies.csv'))
const marketReferencePath = path.resolve(process.env.QORE_LIVE_MARKET_REFERENCE_FILE ?? path.join(stateDir, 'market-reference-prices.json'))
const brokerAccountPath = path.resolve(process.env.QORE_LIVE_BROKER_ACCOUNT_FILE ?? path.join(stateDir, 'broker-account-and-positions.json'))
const riskStatePath = path.resolve(process.env.QORE_LIVE_RISK_STATE_FILE ?? path.join(stateDir, 'risk-and-kill-switch-state.json'))
const signalIntentPath = path.resolve(process.env.QORE_LIVE_SIGNAL_INTENT_FILE ?? path.join(stateDir, 'signal-intent-reconcile.json'))
const liveInferencePath = path.resolve(
  process.env.QORE_LIVE_INFERENCE_FILE ?? path.join(repoDir, '.local', 'qore', 'live-inference', 'all-year-target.json'),
)
const eiaStoragePath = path.resolve(process.env.QORE_LIVE_EIA_STORAGE_FILE ?? path.join(stateDir, 'eia-storage-release-window.json'))
const locationsPath = path.join(repoDir, 'data', 'qore', 'weather', 'locations.csv')
const indexBasketConfigPath = path.join(repoDir, 'data', 'qore', 'market', 'index-basket-config.json')
const localEiaStoragePath = path.join(repoDir, 'data', 'qore', 'fundamentals', 'eia', 'working-gas-storage-lower48-weekly.csv')
const comparisonInputPath = path.resolve(
  process.env.QORE_NGAS_LIVE_WEATHER_REFRESH_INPUT_FILE ??
    path.join(repoDir, 'data', 'qore', 'research', 'strategy-agent-runs', 'ngas-all-year-beta', 'selected-trades.csv'),
)
const comparisonOutputDir = path.resolve(
  process.env.QORE_NGAS_LIVE_WEATHER_REFRESH_OUTPUT_DIR ??
    path.join(repoDir, '.local', 'qore', 'ngas-live-weather-refresh'),
)
const comparisonSummaryPath = path.join(comparisonOutputDir, 'comparison-summary.json')
const forecastCalendarOutputRoot = path.join(stateDir, 'forecast-calendar')
const forecastCalendarSources = new Set(['gfs', 'gefs-mean', 'graphcastgfs', 'aigfs', 'ecmwf-ifs', 'ecmwf-aifs', 'gem-global'])

let lastPerformanceRunAt = null
let lastForecastCalendarRunAt = null
let latestJobOutputs = {}
const lastJobRunAt = new Map()
const latestJobStats = new Map()
let shuttingDown = false
let wakeFromSleep = null

function argValue(argsToRead, name) {
  const inline = argsToRead.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = argsToRead.indexOf(name)
  return index >= 0 ? argsToRead[index + 1] : null
}

function readJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${path.relative(repoDir, filePath)}: ${error.message}`)
  }
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function numberEnv(key, fallback) {
  const parsed = Number(process.env[key])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function numberFrom(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function settingNumber(envKey, profileKey, fallback) {
  if (process.env[envKey] !== undefined) return numberEnv(envKey, fallback)
  return numberFrom(selectedProfile[profileKey], fallback)
}

function settingBool(envKey, profileKey, fallback) {
  if (process.env[envKey] !== undefined) return truthy(process.env[envKey])
  if (selectedProfile[profileKey] !== undefined) return truthy(selectedProfile[profileKey])
  return fallback
}

function listEnv(key, fallback) {
  const value = process.env[key]
  if (!value) return fallback
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length ? items : fallback
}

function settingList(envKey, profileKey, fallback) {
  if (process.env[envKey] !== undefined) return listEnv(envKey, fallback)
  return Array.isArray(selectedProfile[profileKey]) && selectedProfile[profileKey].length ? selectedProfile[profileKey] : fallback
}

function envKeyForJob(jobId, suffix) {
  const snake = jobId.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
  return `QORE_LIVE_${snake}_${suffix}`
}

function jobSetting(jobId, key, fallback) {
  return selectedProfile.cadences?.[jobId]?.[key] ?? liveCadenceSettings[jobId]?.[key] ?? fallback
}

function jobEnabled(jobId, fallback = true) {
  if (args.has(`--no-${jobId}`)) return false
  if (args.has(`--${jobId}`)) return true
  const envKey = envKeyForJob(jobId, 'ENABLED')
  if (process.env[envKey] !== undefined) return truthy(process.env[envKey])
  return truthy(jobSetting(jobId, 'enabled', fallback))
}

function jobIntervalMs(jobId, fallback) {
  const envKey = envKeyForJob(jobId, 'INTERVAL_MS')
  if (process.env[envKey] !== undefined) return numberEnv(envKey, fallback)
  return numberFrom(jobSetting(jobId, 'intervalMs', jobSetting(jobId, 'recommendedIntervalMs', fallback)), fallback)
}

function jobSettingBool(jobId, key, fallback) {
  const envKey = envKeyForJob(jobId, key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase())
  if (process.env[envKey] !== undefined) return truthy(process.env[envKey])
  return truthy(jobSetting(jobId, key, fallback))
}

function jobSettingList(jobId, key, fallback) {
  const envKey = envKeyForJob(jobId, key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase())
  if (process.env[envKey] !== undefined) return listEnv(envKey, fallback)
  const configured = jobSetting(jobId, key, fallback)
  return Array.isArray(configured) && configured.length ? configured : fallback
}

function jobSettingPath(jobId, key, fallback) {
  const envKey = envKeyForJob(jobId, key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase())
  return path.resolve(repoDir, process.env[envKey] ?? jobSetting(jobId, key, fallback))
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function numericValue(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function strictFiniteNumber(value, label) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Validated live inference ${label} is missing or non-finite.`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Validated live inference ${label} is missing or non-finite.`)
  return parsed
}

function strictDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) {
    throw new Error(`Validated live inference ${label} must be a valid YYYY-MM-DD date.`)
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Validated live inference ${label} must be a valid YYYY-MM-DD date.`)
  }
  return value
}

function forecastCalendarDate(value, label) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Live forecast calendar ${label} must be a valid YYYY-MM-DD date.`)
  }
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`Live forecast calendar ${label} must be a valid YYYY-MM-DD date.`)
  }
  return text
}

function forecastCalendarRunHour(value) {
  const text = String(value ?? '')
  if (!/^\d{2}$/.test(text) || Number(text) < 0 || Number(text) > 23) {
    throw new Error('Live forecast calendar run hours must be two-digit UTC hours from 00 through 23.')
  }
  return text
}

function forecastCalendarSource(value) {
  const text = String(value ?? '')
  if (!forecastCalendarSources.has(text)) throw new Error(`Unsupported live forecast calendar source: ${text || 'empty'}.`)
  return text
}

function validatedLiveTargetContract(target, inference) {
  if (inference?.strategyId !== 'ngas-all-year-beta' || target?.strategyId !== 'ngas-all-year-beta') {
    throw new Error('Validated live inference and target strategyId must equal ngas-all-year-beta.')
  }
  const gasPosition = strictFiniteNumber(target?.gasPosition, 'target.gasPosition')
  const indexFraction = strictFiniteNumber(target?.indexFraction, 'target.indexFraction')
  const cashFraction = strictFiniteNumber(target?.cashFraction, 'target.cashFraction')
  const confidence = strictFiniteNumber(target?.confidence, 'target.confidence')
  const signalDate = strictDate(target?.signalDate, 'target.signalDate')
  const targetDate = strictDate(target?.targetDate, 'target.targetDate')
  if (gasPosition < -1 || gasPosition > 1) throw new Error('Validated live inference target.gasPosition must be between -1 and 1.')
  if (indexFraction < 0 || indexFraction > 1) throw new Error('Validated live inference target.indexFraction must be between 0 and 1.')
  if (cashFraction < 0 || cashFraction > 1) throw new Error('Validated live inference target.cashFraction must be between 0 and 1.')
  if (confidence < 0 || confidence > 1) throw new Error('Validated live inference target.confidence must be between 0 and 1.')
  const allocationTotal = Math.abs(gasPosition) + indexFraction + cashFraction
  if (Math.abs(allocationTotal - 1) > 0.001) {
    throw new Error(
      `Validated live inference target weights are out of contract: abs(gasPosition) + indexFraction + cashFraction must equal 1 (received ${round(allocationTotal, 6)}).`,
    )
  }
  const direction = gasPosition > 0 ? 'long' : gasPosition < 0 ? 'short' : 'flat'
  if (target?.direction !== direction) {
    throw new Error(`Validated live inference target.direction must be ${direction} when gasPosition is ${gasPosition}.`)
  }
  const gasPositionBlocks = liveGasPositionContractBlocks({
    season: inference?.season,
    targetDate,
    componentStrategyId: target?.componentStrategyId,
    windowId: target?.windowId,
    thesisKind: target?.thesisKind,
    gasPosition,
  })
  if (gasPositionBlocks.length) {
    throw new Error(`Validated live inference gas-position contract is invalid: ${gasPositionBlocks.join('; ')}.`)
  }
  return {
    gasPosition,
    indexFraction,
    cashFraction,
    confidence,
    direction,
    signalDate,
    targetDate,
    validatedIssueDate: strictDate(inference?.forecastValidation?.latestCommonIssueDate, 'forecastValidation.latestCommonIssueDate'),
  }
}

function validatedStrategyArtifactBinding(inference) {
  let currentArtifact
  try {
    currentArtifact = loadAllYearStrategyArtifact(repoDir)
  } catch (error) {
    throw new Error(`Validated live inference cannot verify its reviewed strategy artifact: ${error.message}`)
  }
  const blocks = strategyArtifactBindingBlocks(inference?.strategyArtifact, currentArtifact)
  if (blocks.length) {
    throw new Error(`Validated live inference strategy artifact is invalid: ${blocks.join('; ')}.`)
  }
  return currentArtifact.binding
}

function relative(filePath) {
  return path.relative(repoDir, filePath)
}

function compactDate(dateText) {
  return dateText.replaceAll('-', '')
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function ageMinutes(asOf, isoText) {
  const timestamp = Date.parse(isoText)
  return Number.isFinite(timestamp) ? Math.max(0, (asOf.getTime() - timestamp) / 60000) : null
}

function latestRow(rows, dateKey = 'date') {
  return rows
    .filter((row) => row[dateKey])
    .sort((left, right) => String(left[dateKey]).localeCompare(String(right[dateKey])))
    .at(-1)
}

function easternTimeParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
}

function isUsEquityMarketOpen(date = new Date()) {
  const parts = easternTimeParts(date)
  if (['Sat', 'Sun'].includes(parts.weekday)) return false
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n') + '\n'
}

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      value += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }

  values.push(value)
  return values
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

async function ensureDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true })
}

async function writeJson(filePath, value) {
  await ensureDir(filePath)
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n')
}

async function writeCsv(filePath, rows, headers) {
  await ensureDir(filePath)
  await writeFile(filePath, rowsToCsv(rows, headers))
}

function fahrenheitFromCelsius(value) {
  return value * 1.8 + 32
}

function readLocations() {
  return parseCsv(readFileSync(locationsPath, 'utf8')).map((row) => ({
    id: row.id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    region: row.region,
    weight: Number(row.weight),
  }))
}

function normalMeansByMonthDay(locationId) {
  const filePath = path.join(repoDir, 'data', 'qore', 'weather', 'nasa-power', 'normals', `${locationId}-${normalStartDate}-${normalEndDate}.json`)
  const json = JSON.parse(readFileSync(filePath, 'utf8'))
  const values = json.properties?.parameter?.T2M ?? {}
  const grouped = new Map()

  for (const [date, value] of Object.entries(values)) {
    if (typeof value !== 'number' || value <= -900) continue
    const monthDay = date.slice(4)
    grouped.set(monthDay, [...(grouped.get(monthDay) ?? []), value])
  }

  return new Map(
    Array.from(grouped.entries()).map(([monthDay, monthDayValues]) => [
      monthDay,
      monthDayValues.reduce((sum, value) => sum + value, 0) / monthDayValues.length,
    ]),
  )
}

async function fetchJson(url, options = {}) {
  const redactSecrets = options.redactSecrets ?? []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'QORE live weather service' },
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      const safeText = redactSecrets.length ? redactSecretText(text, redactSecrets) : text
      throw new Error(`HTTP ${response.status}: ${safeText.slice(0, 180)}`)
    }
    const json = JSON.parse(text)
    if (json?.error) {
      const detail = json.reason ?? JSON.stringify(json.error)
      throw new Error(redactSecrets.length ? redactSecretText(detail, redactSecrets) : detail)
    }
    return json
  } finally {
    clearTimeout(timeout)
  }
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function safeMarketSymbol(symbol) {
  return symbol.replace(/[^A-Za-z0-9]/g, '-')
}

async function fetchYahooReferencePrice(symbol) {
  const encoded = encodeURIComponent(symbol)
  const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encoded}`)
  url.searchParams.set('range', '1d')
  url.searchParams.set('interval', '1m')
  url.searchParams.set('includePrePost', 'false')
  const json = await fetchJson(url)
  const result = json.chart?.result?.[0]
  const meta = result?.meta ?? {}
  const quote = result?.indicators?.quote?.[0] ?? {}
  const timestamps = result?.timestamp ?? []
  const closes = quote.close ?? []
  const lastIndex = closes.map((value, index) => (Number.isFinite(Number(value)) ? index : -1)).filter((index) => index >= 0).at(-1)
  const lastTimestamp = lastIndex !== undefined ? timestamps[lastIndex] : null
  const lastPrice = lastIndex !== undefined ? numericValue(closes[lastIndex], Number.NaN) : numericValue(meta.regularMarketPrice, Number.NaN)

  if (!Number.isFinite(lastPrice)) throw new Error(`${symbol} did not return a usable reference price.`)

  return {
    symbol,
    status: 'ok',
    price: round(lastPrice, 4),
    priceUpdatedAt: lastTimestamp ? new Date(lastTimestamp * 1000).toISOString() : new Date().toISOString(),
    exchangeName: meta.exchangeName ?? '',
    instrumentType: meta.instrumentType ?? '',
    currency: meta.currency ?? 'USD',
    regularMarketPrice: Number.isFinite(Number(meta.regularMarketPrice)) ? round(Number(meta.regularMarketPrice), 4) : null,
    previousClose: Number.isFinite(Number(meta.chartPreviousClose)) ? round(Number(meta.chartPreviousClose), 4) : null,
    spreadBps: null,
    spreadSource: 'unavailable-from-yahoo-chart',
  }
}

async function fetchLocationForecastBatch(locations) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', locations.map((location) => location.latitude).join(','))
  url.searchParams.set('longitude', locations.map((location) => location.longitude).join(','))
  url.searchParams.set('hourly', 'temperature_2m')
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('forecast_days', String(forecastDays))
  url.searchParams.set('timezone', 'UTC')
  url.searchParams.set('models', liveModels.join(','))
  const json = await fetchJson(url)
  const responses = Array.isArray(json) ? json : [json]
  return locations.map((location, index) => ({
    location,
    forecastJson: responses[index] ?? responses[0],
  }))
}

function modelTemperatureKey(modelId) {
  return liveModels.length === 1 ? 'temperature_2m' : `temperature_2m_${modelId}`
}

function dailyMeanForecastRows(location, forecastJson, normals) {
  const timeRows = forecastJson.hourly?.time ?? []
  const rows = []

  for (const modelId of liveModels) {
    const temperatureRows = forecastJson.hourly?.[modelTemperatureKey(modelId)] ?? []
    const byDate = new Map()

    timeRows.forEach((timeText, index) => {
      const value = Number(temperatureRows[index])
      if (!Number.isFinite(value)) return
      const date = timeText.slice(0, 10)
      byDate.set(date, [...(byDate.get(date) ?? []), value])
    })

    for (const [targetDate, values] of byDate.entries()) {
      const normalC = normals.get(compactDate(targetDate).slice(4))
      if (normalC === undefined) continue
      const forecastMeanF = values.reduce((sum, value) => sum + value, 0) / values.length
      const normalMeanF = fahrenheitFromCelsius(normalC)
      rows.push({
        targetDate,
        locationId: location.id,
        region: location.region,
        weight: location.weight,
        modelId,
        forecastMeanF: round(forecastMeanF),
        normalMeanF: round(normalMeanF),
        forecastAnomalyF: round(forecastMeanF - normalMeanF),
        hourlySamples: values.length,
      })
    }
  }

  return rows
}

function scoreForecastRows(locationRows, locations) {
  const totalBasketWeight = locations.reduce((sum, location) => sum + location.weight, 0)
  const locationWeight = new Map(locations.map((location) => [location.id, location.weight]))
  const dates = [...new Set(locationRows.map((row) => row.targetDate))].sort()

  return dates.map((targetDate) => {
    const targetRows = locationRows.filter((row) => row.targetDate === targetDate)
    const byLocation = new Map()
    const sourceIds = new Set()

    for (const row of targetRows) {
      sourceIds.add(row.modelId)
      byLocation.set(row.locationId, [...(byLocation.get(row.locationId) ?? []), row])
    }

    const locationAverages = Array.from(byLocation.entries()).map(([locationId, rows]) => ({
      locationId,
      weight: locationWeight.get(locationId) ?? 0,
      anomalyF: rows.reduce((sum, row) => sum + row.forecastAnomalyF, 0) / rows.length,
    }))
    const sampledWeight = locationAverages.reduce((sum, row) => sum + row.weight, 0)
    const weightedAnomalyF = sampledWeight
      ? locationAverages.reduce((sum, row) => sum + row.anomalyF * row.weight, 0) / sampledWeight
      : 0
    const coldWeight = locationAverages.filter((row) => row.anomalyF <= -8).reduce((sum, row) => sum + row.weight, 0)
    const warmWeight = locationAverages.filter((row) => row.anomalyF >= 8).reduce((sum, row) => sum + row.weight, 0)

    return {
      targetDate,
      weightedAnomalyF: round(weightedAnomalyF, 2),
      dataCoveragePct: round(totalBasketWeight ? (sampledWeight / totalBasketWeight) * 100 : 0, 1),
      coldCoveragePct: round(totalBasketWeight ? (coldWeight / totalBasketWeight) * 100 : 0, 1),
      warmCoveragePct: round(totalBasketWeight ? (warmWeight / totalBasketWeight) * 100 : 0, 1),
      sourceCount: sourceIds.size,
      sourceIds: [...sourceIds].sort(),
      locationCount: locationAverages.length,
      qualifiesCold: weightedAnomalyF <= -8 && totalBasketWeight > 0 && coldWeight / totalBasketWeight >= 0.55,
      qualifiesWarm: weightedAnomalyF >= 8 && totalBasketWeight > 0 && warmWeight / totalBasketWeight >= 0.55,
    }
  })
}

function digestFor(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function chunks(items, size) {
  const groups = []
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size))
  return groups
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

async function collectCurrentForecast() {
  const fetchedAt = new Date().toISOString()
  const locations = readLocations()
  const locationRows = []
  const sourceResults = []
  const locationBatches = chunks(locations, fetchBatchSize)

  const batchResults = await mapWithConcurrency(locationBatches, fetchConcurrency, async (locationBatch) => {
    try {
      const forecasts = await fetchLocationForecastBatch(locationBatch)
      return forecasts.map(({ location, forecastJson }) => {
        const normals = normalMeansByMonthDay(location.id)
        return {
          rows: dailyMeanForecastRows(location, forecastJson, normals),
          result: {
            locationId: location.id,
            status: 'ok',
            latitude: forecastJson.latitude,
            longitude: forecastJson.longitude,
            firstForecastTime: forecastJson.hourly?.time?.[0] ?? null,
            lastForecastTime: forecastJson.hourly?.time?.at(-1) ?? null,
          },
        }
      })
    } catch (error) {
      return locationBatch.map((location) => ({
        rows: [],
        result: {
          locationId: location.id,
          status: 'failed',
          error: error.message,
        },
      }))
    }
  })

  for (const result of batchResults.flat()) {
    locationRows.push(...result.rows)
    sourceResults.push(result.result)
  }

  assertForecastLocationTemperatures(locationRows, {
    label: `Open-Meteo current forecast collected ${fetchedAt}`,
    sourceId: 'open-meteo-current',
  })
  const scores = scoreForecastRows(locationRows, locations)
  const latestActionableScore =
    scores.find((score) => score.qualifiesCold || score.qualifiesWarm) ??
    scores.find((score) => score.targetDate >= fetchedAt.slice(0, 10)) ??
    scores[0] ??
    null
  const snapshot = {
    generatedAt: fetchedAt,
    serviceId: 'qore-live-weather-service',
    source: 'Open-Meteo current forecast API',
    models: liveModels,
    forecastDays,
    dataRoot: relative(stateDir),
    sourceResults,
    rowCounts: {
      locations: locations.length,
      requestBatches: locationBatches.length,
      locationModelDateRows: locationRows.length,
      dailyScores: scores.length,
      failedLocations: sourceResults.filter((result) => result.status !== 'ok').length,
    },
    latestActionableScore,
    riskContext: latestActionableScore
      ? {
          forecastIssuedAt: fetchedAt,
          sourceCount: latestActionableScore.sourceCount,
          coveragePct: latestActionableScore.dataCoveragePct,
          sourceIds: latestActionableScore.sourceIds,
        }
      : null,
    digest: digestFor({ models: liveModels, scores }),
    scores,
    files: {
      snapshot: relative(snapshotPath),
      scoresCsv: relative(scoreCsvPath),
      locationAnomaliesCsv: relative(locationCsvPath),
    },
  }

  await writeJson(snapshotPath, snapshot)
  await writeCsv(scoreCsvPath, scores, [
    'targetDate',
    'weightedAnomalyF',
    'dataCoveragePct',
    'coldCoveragePct',
    'warmCoveragePct',
    'sourceCount',
    'sourceIds',
    'locationCount',
    'qualifiesCold',
    'qualifiesWarm',
  ])
  await writeCsv(locationCsvPath, locationRows, [
    'targetDate',
    'locationId',
    'region',
    'weight',
    'modelId',
    'forecastMeanF',
    'normalMeanF',
    'forecastAnomalyF',
    'hourlySamples',
  ])

  if (!scores.length) {
    throw new Error(
      `Open-Meteo current forecast produced no usable daily scores; ${snapshot.rowCounts.failedLocations}/${locations.length} locations failed.`,
    )
  }

  return snapshot
}

async function collectMarketReferencePrices() {
  const generatedAt = new Date().toISOString()
  const asOf = new Date(generatedAt)
  const symbols = jobSettingList('marketReferencePrices', 'symbols', ['UNG', 'VOO', 'QQQM', 'NG=F'])
  const rows = await mapWithConcurrency(symbols, Math.min(4, symbols.length), async (symbol) => {
    try {
      return await fetchYahooReferencePrice(symbol)
    } catch (error) {
      const localPath = path.join(repoDir, 'data', 'qore', 'market', 'yahoo', `${safeMarketSymbol(symbol)}-qore-market.csv`)
      try {
        const local = latestRow(parseCsv(await readFile(localPath, 'utf8')))
        if (!local) throw new Error('No local fallback row.')
        return {
          symbol,
          status: 'fallback-local',
          price: round(numericValue(local.close, Number.NaN), 4),
          priceUpdatedAt: `${local.date}T20:00:00.000Z`,
          currency: 'USD',
          previousClose: null,
          spreadBps: null,
          spreadSource: 'unavailable-from-local-daily-cache',
          error: error.message,
          fallbackFile: relative(localPath),
        }
      } catch (fallbackError) {
        return {
          symbol,
          status: 'failed',
          price: null,
          priceUpdatedAt: null,
          spreadBps: null,
          spreadSource: 'unavailable',
          error: `${error.message}; fallback failed: ${fallbackError.message}`,
        }
      }
    }
  })
  const referencePrices = Object.fromEntries(rows.filter((row) => Number.isFinite(row.price)).map((row) => [row.symbol, row.price]))
  const freshestPriceUpdatedAt = rows
    .map((row) => row.priceUpdatedAt)
    .filter(Boolean)
    .sort()
    .at(-1)

  const snapshot = {
    generatedAt,
    serviceId: 'qore-live-market-reference-prices',
    source: 'Yahoo chart API with local daily fallback',
    symbols,
    rows,
    referencePrices,
    freshness: {
      freshestPriceUpdatedAt,
      freshestAgeMinutes: freshestPriceUpdatedAt ? round(ageMinutes(asOf, freshestPriceUpdatedAt), 2) : null,
    },
    rowCounts: {
      symbols: symbols.length,
      ok: rows.filter((row) => row.status === 'ok').length,
      fallbackLocal: rows.filter((row) => row.status === 'fallback-local').length,
      failed: rows.filter((row) => row.status === 'failed').length,
    },
    files: {
      snapshot: relative(marketReferencePath),
    },
  }
  await writeJson(marketReferencePath, snapshot)
  return snapshot
}

async function collectBrokerAccountAndPositions() {
  const generatedAt = new Date().toISOString()
  const inputPath = jobSettingPath('brokerAccountAndPositions', 'snapshotFile', '.local/qore/broker/account-snapshot.json')
  const fileSnapshot = await readJsonIfExists(inputPath)
  const envHasAccount =
    process.env.QORE_BROKER_EQUITY_USD !== undefined ||
    process.env.QORE_BROKER_CASH_USD !== undefined ||
    process.env.QORE_BROKER_OPEN_INTENT_COUNT !== undefined
  const envSnapshot = envHasAccount
    ? {
        brokerConnected: truthy(process.env.QORE_BROKER_CONNECTED),
        account: {
          equityUsd: numericValue(process.env.QORE_BROKER_EQUITY_USD, 0),
          cashUsd: numericValue(process.env.QORE_BROKER_CASH_USD, 0),
          openIntentCount: numericValue(process.env.QORE_BROKER_OPEN_INTENT_COUNT, 0),
          dayPnlPct: numericValue(process.env.QORE_BROKER_DAY_PNL_PCT, 0),
          trailingDrawdownPct: numericValue(process.env.QORE_BROKER_TRAILING_DRAWDOWN_PCT, 0),
          consecutiveLosses: numericValue(process.env.QORE_BROKER_CONSECUTIVE_LOSSES, 0),
        },
        positions: [],
        openOrders: [],
      }
    : null
  const sourceSnapshot = fileSnapshot ?? envSnapshot
  const snapshot = {
    generatedAt,
    serviceId: 'qore-live-broker-account-and-positions',
    source: fileSnapshot ? 'adapter-snapshot-file' : envSnapshot ? 'environment' : 'not-connected',
    brokerConnected: Boolean(sourceSnapshot?.brokerConnected),
    liveRoutingEnabled: Boolean(sourceSnapshot?.liveRoutingEnabled),
    inputFile: relative(inputPath),
    account: sourceSnapshot?.account ?? null,
    positions: sourceSnapshot?.positions ?? [],
    openOrders: sourceSnapshot?.openOrders ?? [],
    rowCounts: {
      positions: sourceSnapshot?.positions?.length ?? 0,
      openOrders: sourceSnapshot?.openOrders?.length ?? 0,
    },
    notes: sourceSnapshot
      ? ['Broker/account state is being read from the separate Alpaca reconciler snapshot. This weather service does not submit orders itself.']
      : ['No Alpaca reconciler snapshot is present yet. Run npm run broker:status to populate the configured snapshot file.'],
    files: {
      snapshot: relative(brokerAccountPath),
    },
  }
  await writeJson(brokerAccountPath, snapshot)
  return snapshot
}

function storageInferenceIsCoherent(inference, eia) {
  const latest = eia?.latestStorage
  const validation = inference?.storageValidation
  const inferenceValue = Number(validation?.latestPolledStorageBcf)
  const polledValue = Number(latest?.storageBcf)
  return Boolean(
    latest?.date
    && validation?.latestPolledDate === latest.date
    && Number.isFinite(inferenceValue)
    && Number.isFinite(polledValue)
    && Math.abs(inferenceValue - polledValue) <= 1e-6,
  )
}

async function collectRiskAndKillSwitchState() {
  const generatedAt = new Date().toISOString()
  const operatorFile = await readJsonIfExists(operatorStatePath)
  const market = latestJobOutputs.marketReferencePrices
  const broker = latestJobOutputs.brokerAccountAndPositions
  const weather = latestJobOutputs.currentWeather
  const eia = latestJobOutputs.eiaStorageReleaseWindow
  const inference = latestJobOutputs.strategyInference ?? (await readJsonIfExists(liveInferencePath))
  const storageContextCoherent = storageInferenceIsCoherent(inference, eia)
  const operatorStateValid = typeof operatorFile?.killSwitchEngaged === 'boolean'
  const operator = operatorStateValid
    ? {
        killSwitchEngaged: operatorFile.killSwitchEngaged,
        venueOpen: operatorFile?.venueOpen ?? isUsEquityMarketOpen(),
        manualApproval: operatorFile?.manualApproval ?? false,
        source: 'operator-state-file',
      }
    : null
  const operatorBlock = operatorFile
    ? 'Operator state is invalid; killSwitchEngaged must be boolean.'
    : `Operator state is missing at ${relative(operatorStatePath)}; explicitly engage or clear the kill switch before paper/live routing.`
  const snapshot = {
    generatedAt,
    serviceId: 'qore-live-risk-and-kill-switch-state',
    liveRoutingEnabled: Boolean(broker?.liveRoutingEnabled),
    operatorStateFile: relative(operatorStatePath),
    operator,
    blockedReasons: operatorStateValid ? [] : [operatorBlock],
    account: broker?.account ?? null,
    market: market
      ? {
          priceUpdatedAt: market.freshness?.freshestPriceUpdatedAt ?? null,
          referencePrices: market.referencePrices,
          stalePriceCount: market.rows.filter((row) => row.status !== 'ok').length,
        }
      : null,
    weather: weather?.riskContext ?? null,
    storage: storageContextCoherent ? eia.riskContext : null,
    readiness: {
      killSwitchClear: operatorStateValid ? !operator.killSwitchEngaged : null,
      venueOpen: operator?.venueOpen ?? null,
      accountContextPresent: Boolean(broker?.account),
      marketContextPresent: Boolean(market?.referencePrices && Object.keys(market.referencePrices).length),
      weatherContextPresent: Boolean(weather?.riskContext),
      storageContextPresent: Boolean(eia?.riskContext && storageContextCoherent),
      storageInferenceCoherent: storageContextCoherent,
    },
    files: {
      snapshot: relative(riskStatePath),
    },
  }
  await writeJson(riskStatePath, snapshot)
  return snapshot
}

async function reconcileSignalIntent() {
  const generatedAt = new Date().toISOString()
  const inference = latestJobOutputs.strategyInference ?? (await readJsonIfExists(liveInferencePath))
  if (!inference?.validated || !inference.liveForecastAppliedToTarget || !inference.target) {
    throw new Error(`Validated live strategy inference is unavailable: ${inference?.error ?? 'no successful inference snapshot'}`)
  }
  const strategyArtifact = validatedStrategyArtifactBinding(inference)
  const eia = latestJobOutputs.eiaStorageReleaseWindow
  if (eia?.latestStorage && !storageInferenceIsCoherent(inference, eia)) {
    throw new Error(`Live strategy inference storage input does not match polled EIA release ${eia.latestStorage.date}.`)
  }
  const latest = inference.target
  const {
    gasPosition,
    indexFraction,
    cashFraction,
    confidence,
    direction,
    signalDate,
    targetDate,
    validatedIssueDate,
  } = validatedLiveTargetContract(latest, inference)
  const signalAgeDays = validatedIssueDate
    ? Math.max(0, (Date.parse(`${generatedAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${validatedIssueDate}T00:00:00Z`)) / 86400000)
    : null
  const intent = {
    strategyId: 'ngas-all-year-beta',
    strategyName: 'NGAS All-Year Beta',
    generatedAt,
    signalDate,
    targetDate,
    instrument: 'UNG',
    direction,
    confidence,
    expectedReturnPct: 0,
    indexFraction: round(indexFraction, 4),
    gasPosition: round(gasPosition, 4),
    cashFraction: round(cashFraction, 4),
    sourceSynthetic: indexFraction > 0 ? 'US-INDEX-BASKET' : undefined,
    maxHoldingDays: latest.windowId === 'weather-follow' ? 3 : 1,
    source: 'live-selected-contract-inference',
    notes: [
      'Live reconciliation snapshot only. No broker order is routed.',
      `Target was inferred from validated NOAA GFS/GEFS 00z data for ${inference.forecastValidation.latestCommonIssueDate}.`,
    ],
  }
  const snapshot = {
    generatedAt,
    serviceId: 'qore-live-signal-intent-reconcile',
    sourceFile: relative(liveInferencePath),
    stale: inference.forecastValidation.issueAgeDays > 2,
    signalAgeDays: signalAgeDays === null ? null : round(signalAgeDays, 2),
    intent,
    inference: {
      strategyId: inference.strategyId,
      mode: inference.inferenceMode,
      season: inference.season,
      targetDate: latest.targetDate,
      liveForecastAppliedToTarget: true,
      validated: strategyArtifact.paperEligible,
      strategyArtifact,
      forecastValidation: inference.forecastValidation,
      componentStrategyId: latest.componentStrategyId,
      windowId: latest.windowId,
      thesisKind: latest.thesisKind,
    },
    context: {
      currentWeatherDigest: latestJobOutputs.currentWeather?.digest ?? null,
      marketReferenceGeneratedAt: latestJobOutputs.marketReferencePrices?.generatedAt ?? null,
      riskStateGeneratedAt: latestJobOutputs.riskAndKillSwitchState?.generatedAt ?? null,
    },
    files: {
      snapshot: relative(signalIntentPath),
    },
  }
  await writeJson(signalIntentPath, snapshot)
  return snapshot
}

async function collectStrategyInference() {
  const result = await runCommand('live-all-year-strategy-inference', process.execPath, ['scripts/qore-live-strategy-inference.mjs'], {
    env: existsSync(eiaStoragePath) ? { QORE_LIVE_INFERENCE_EIA_SNAPSHOT_FILE: eiaStoragePath } : {},
  })
  if (!result.ok) throw new Error(result.stderr || result.stdout || 'Live all-year inference failed.')
  const snapshot = await readJsonIfExists(liveInferencePath)
  if (!snapshot?.validated || !snapshot.liveForecastAppliedToTarget) throw new Error(snapshot?.error ?? 'Inference snapshot was not validated.')
  validatedStrategyArtifactBinding(snapshot)
  return snapshot
}

async function collectEiaStorageReleaseWindow() {
  const generatedAt = new Date().toISOString()
  const releaseCalendarCoverage = assertEiaStorageReleaseCalendarCoverage(generatedAt.slice(0, 10))
  const eiaApiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'
  const localRows = parseCsv(await readFile(localEiaStoragePath, 'utf8'))
  const localLatest = latestRow(localRows)
  let liveRows = []
  let liveError = null

  if (jobSettingBool('eiaStorageReleaseWindow', 'fetchLive', true)) {
    try {
      const url = new URL('https://api.eia.gov/v2/natural-gas/stor/wkly/data/')
      url.searchParams.set('api_key', eiaApiKey)
      url.searchParams.set('frequency', 'weekly')
      url.searchParams.set('data[0]', 'value')
      url.searchParams.append('facets[series][]', 'NW2_EPG0_SWO_R48_BCF')
      url.searchParams.set('sort[0][column]', 'period')
      url.searchParams.set('sort[0][direction]', 'desc')
      url.searchParams.set('offset', '0')
      url.searchParams.set('length', '12')
      const json = omitApiKeyFields(await fetchJson(url, { redactSecrets: [eiaApiKey] }), [eiaApiKey])
      liveRows = (json.response?.data ?? [])
        .map((row) => ({
          date: row.period,
          series: row.series,
          storageBcf: numericValue(row.value, Number.NaN),
          unit: row['unit-name'] ?? row.units ?? 'Bcf',
          areaName: row['area-name'] ?? 'Lower 48',
          source: 'EIA Open Data API',
        }))
        .filter((row) => row.date && Number.isFinite(row.storageBcf))
    } catch (error) {
      liveError = redactSecretText(error.message, [eiaApiKey])
    }
  }

  const liveLatest = latestRow(liveRows)
  const latest = liveLatest ?? localLatest
  const snapshot = {
    generatedAt,
    serviceId: 'qore-live-eia-storage-release-window',
    source: liveLatest ? 'EIA Open Data API' : 'local-cache',
    releaseCalendarCoverage,
    liveFetchAttempted: jobSettingBool('eiaStorageReleaseWindow', 'fetchLive', true),
    liveError,
    latestStorage: latest
      ? {
          date: latest.date,
          storageBcf: numericValue(latest.storageBcf, null),
          unit: latest.unit,
          areaName: latest.areaName,
          source: latest.source,
        }
      : null,
    localLatestStorage: localLatest
      ? {
          date: localLatest.date,
          storageBcf: numericValue(localLatest.storageBcf, null),
          source: localLatest.source,
        }
      : null,
    riskContext: latest
      ? {
          reportedAt: eiaStorageReleaseAt(latest.date),
          storageVsSeasonalAverageBcf: null,
        }
      : null,
    rowCounts: {
      liveRows: liveRows.length,
      localRows: localRows.length,
    },
    storageRows: liveRows,
    files: {
      snapshot: relative(eiaStoragePath),
      localCache: relative(localEiaStoragePath),
    },
  }
  await writeJson(eiaStoragePath, snapshot)
  return snapshot
}

function runCommand(label, command, commandArgs, options = {}) {
  const startedAt = new Date()
  const maxOutputChars = 6000
  const childEnv = {
    ...process.env,
    ...(options.env ?? {}),
  }
  for (const key of options.unsetEnv ?? []) delete childEnv[key]

  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: repoDir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-maxOutputChars)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-maxOutputChars)
    })
    child.on('error', (error) => {
      resolve({
        label,
        ok: false,
        exitCode: null,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        stdout: stdout.trim(),
        stderr: (stderr || error.message).trim(),
      })
    })
    child.on('close', (code) => {
      resolve({
        label,
        ok: code === 0,
        exitCode: code,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })
  })
}

async function maybeRunForecastCalendar() {
  if (!runForecastCalendar) return []
  if (lastForecastCalendarRunAt && Date.now() - Date.parse(lastForecastCalendarRunAt) < forecastCalendarIntervalMs) return []

  const today = new Date().toISOString().slice(0, 10)
  const lookbackDays = numberEnv('QORE_LIVE_WEATHER_GFS_LOOKBACK_DAYS', 1)
  const startDate = forecastCalendarDate(process.env.QORE_LIVE_WEATHER_GFS_START ?? addDays(today, -lookbackDays), 'start')
  const endDate = forecastCalendarDate(process.env.QORE_LIVE_WEATHER_GFS_END ?? today, 'end')
  if (startDate > endDate) throw new Error('Live forecast calendar start must not be after end.')
  const runHours = listEnv('QORE_LIVE_WEATHER_GFS_RUN_HOURS', ['00', '06', '12', '18']).map(forecastCalendarRunHour)
  const forecastSources = listEnv('QORE_LIVE_WEATHER_GFS_SOURCES', ['gfs', 'gefs-mean']).map(forecastCalendarSource)
  const commands = []

  for (const forecastSource of forecastSources) {
    for (const runHour of runHours) {
      commands.push(
        await runCommand(`forecast-calendar:${forecastSource}:${runHour}z`, process.execPath, ['scripts/build-gfs-forecast-calendar.mjs'], {
          unsetEnv: ['QORE_GFS_OUTPUT_BASENAME'],
          env: {
            QORE_FORECAST_SOURCE: forecastSource,
            QORE_GFS_RUN_HOUR: runHour,
            QORE_GFS_CALENDAR_START: startDate,
            QORE_GFS_CALENDAR_END: endDate,
            QORE_GFS_OUTPUT_ROOT: forecastCalendarOutputRoot,
            QORE_GFS_FORCE_DEFAULT_OUTPUT_BASENAME: '1',
            QORE_GFS_RESUME: '1',
            QORE_GFS_ALLOW_PARTIAL: '1',
            QORE_FETCH_TIMEOUT_MS: String(numberEnv('QORE_LIVE_WEATHER_GFS_FETCH_TIMEOUT_MS', 30_000)),
          },
        }),
      )
    }
  }

  lastForecastCalendarRunAt = new Date().toISOString()
  return commands
}

async function maybeRunPerformanceTest() {
  if (!runPerformanceTest) return null
  if (lastPerformanceRunAt && Date.now() - Date.parse(lastPerformanceRunAt) < performanceIntervalMs) return null

  const result = await runCommand('ngas-live-weather-refresh-comparison', process.execPath, [
    'scripts/test-ngas-live-weather-refresh.mjs',
  ], {
    env: {
      QORE_NGAS_LIVE_WEATHER_REFRESH_INPUT_FILE: comparisonInputPath,
      QORE_NGAS_LIVE_WEATHER_REFRESH_OUTPUT_DIR: comparisonOutputDir,
    },
  })
  lastPerformanceRunAt = new Date().toISOString()
  return result
}

async function readLatestComparison() {
  if (!existsSync(comparisonSummaryPath)) return null
  try {
    const summary = JSON.parse(await readFile(comparisonSummaryPath, 'utf8'))
    return {
      generatedAt: summary.generatedAt,
      strategyId: summary.strategyId,
      headline: summary.headline ?? null,
      rowCounts: summary.rowCounts,
      files: {
        summary: relative(comparisonSummaryPath),
      },
    }
  } catch (error) {
    return {
      error: error.message,
      files: {
        summary: relative(comparisonSummaryPath),
      },
    }
  }
}

function liveJobs() {
  return [
    {
      id: 'currentWeather',
      label: 'Current weather forecast',
      enabled: runLiveForecast,
      intervalMs: serviceIntervalMs,
      outputFile: snapshotPath,
      run: collectCurrentForecast,
    },
    {
      id: 'marketReferencePrices',
      label: 'Market reference prices and spread availability',
      enabled: jobEnabled('marketReferencePrices', true),
      intervalMs: jobIntervalMs('marketReferencePrices', 15_000),
      outputFile: marketReferencePath,
      run: collectMarketReferencePrices,
    },
    {
      id: 'brokerAccountAndPositions',
      label: 'Broker account, positions, and open orders',
      enabled: jobEnabled('brokerAccountAndPositions', true),
      intervalMs: jobIntervalMs('brokerAccountAndPositions', 5_000),
      outputFile: brokerAccountPath,
      run: collectBrokerAccountAndPositions,
    },
    {
      id: 'eiaStorageReleaseWindow',
      label: 'EIA storage release window',
      enabled: jobEnabled('eiaStorageReleaseWindow', true),
      intervalMs: jobIntervalMs('eiaStorageReleaseWindow', 60_000),
      outputFile: eiaStoragePath,
      run: collectEiaStorageReleaseWindow,
    },
    {
      id: 'strategyInference',
      label: 'Validated NOAA forecast to all-year target inference',
      enabled: jobEnabled('strategyInference', true),
      intervalMs: jobIntervalMs('strategyInference', 60 * 60 * 1000),
      outputFile: liveInferencePath,
      run: collectStrategyInference,
    },
    {
      id: 'riskAndKillSwitchState',
      label: 'Risk and kill-switch state',
      enabled: jobEnabled('riskAndKillSwitchState', true),
      intervalMs: jobIntervalMs('riskAndKillSwitchState', 1_000),
      outputFile: riskStatePath,
      run: collectRiskAndKillSwitchState,
    },
    {
      id: 'signalIntentReconcile',
      label: 'Current signal-intent reconcile',
      enabled: jobEnabled('signalIntentReconcile', true),
      intervalMs: jobIntervalMs('signalIntentReconcile', 60_000),
      outputFile: signalIntentPath,
      run: reconcileSignalIntent,
    },
    {
      id: 'forecastCalendar',
      label: 'Near-window NOAA forecast calendar',
      enabled: runForecastCalendar,
      intervalMs: forecastCalendarIntervalMs,
      outputFile: null,
      run: maybeRunForecastCalendar,
    },
    {
      id: 'performanceComparison',
      label: 'Live weather performance comparison',
      enabled: runPerformanceTest,
      intervalMs: performanceIntervalMs,
      outputFile: comparisonSummaryPath,
      run: maybeRunPerformanceTest,
    },
  ]
}

function jobIsDue(job, nowMs) {
  if (!job.enabled) return false
  if (once && !respectCadence) return true
  const lastRunAt = lastJobRunAt.get(job.id)
  if (lastRunAt) return nowMs - Date.parse(lastRunAt) >= job.intervalMs
  if (!respectCadence || !job.outputFile || !existsSync(job.outputFile)) return true
  if (!persistedOutputIsUsable(job, latestJobOutputs[job.id])) return true
  return nowMs - statSync(job.outputFile).mtimeMs >= job.intervalMs
}

function persistedOutputIsUsable(job, output) {
  if (!output || typeof output !== 'object') return false
  if (job.id === 'strategyInference') {
    return Boolean(output.validated && output.liveForecastAppliedToTarget && output.target)
  }
  return true
}

async function hydratePersistedJobOutputs(jobs) {
  if (!respectCadence) return
  for (const job of jobs) {
    if (!job.enabled || !job.outputFile || latestJobOutputs[job.id] !== undefined) continue
    try {
      const output = await readJsonIfExists(job.outputFile)
      if (persistedOutputIsUsable(job, output)) latestJobOutputs[job.id] = output
    } catch {
      // A missing or malformed output must be refreshed instead of satisfying cadence.
    }
  }
}

function nextDueSleepMs(jobs, nowMs) {
  const enabled = jobs.filter((job) => job.enabled)
  if (!enabled.length) return 60_000
  const waits = enabled.map((job) => {
    const lastRunAt = lastJobRunAt.get(job.id)
    if (lastRunAt) return Math.max(0, job.intervalMs - (nowMs - Date.parse(lastRunAt)))
    if (respectCadence && job.outputFile && existsSync(job.outputFile) && persistedOutputIsUsable(job, latestJobOutputs[job.id])) {
      return Math.max(0, job.intervalMs - (nowMs - statSync(job.outputFile).mtimeMs))
    }
    return 0
  })
  return Math.min(...waits)
}

async function runLiveJob(job) {
  const startedAt = new Date()
  try {
    const output = await job.run()
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const cycleOverrunMs = Math.max(0, durationMs - job.intervalMs)
    const stat = {
      id: job.id,
      label: job.label,
      ok: true,
      enabled: job.enabled,
      intervalMs: job.intervalMs,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      cycleOverrunMs,
      cadenceMet: cycleOverrunMs === 0,
      outputFile: job.outputFile ? relative(job.outputFile) : null,
    }
    latestJobOutputs[job.id] = output
    latestJobStats.set(job.id, stat)
    lastJobRunAt.set(job.id, finishedAt.toISOString())
    return stat
  } catch (error) {
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const stat = {
      id: job.id,
      label: job.label,
      ok: false,
      enabled: job.enabled,
      intervalMs: job.intervalMs,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      cycleOverrunMs: Math.max(0, durationMs - job.intervalMs),
      cadenceMet: durationMs <= job.intervalMs,
      outputFile: job.outputFile ? relative(job.outputFile) : null,
      error: error.message,
    }
    latestJobStats.set(job.id, stat)
    lastJobRunAt.set(job.id, finishedAt.toISOString())
    return stat
  }
}

async function runCycle() {
  const cycleStartedAt = new Date()
  const jobs = liveJobs()
  await hydratePersistedJobOutputs(jobs)
  const dueJobs = jobs.filter((job) => jobIsDue(job, cycleStartedAt.getTime()))
  const jobRuns = []

  for (const job of dueJobs) {
    jobRuns.push(await runLiveJob(job))
  }

  const latestComparison = await readLatestComparison()
  const finishedAt = new Date()
  const durationMs = finishedAt.getTime() - cycleStartedAt.getTime()
  const sleepMs = once || shuttingDown ? 0 : nextDueSleepMs(jobs, finishedAt.getTime())
  const activeJobStats = Object.fromEntries(jobs.map((job) => [job.id, latestJobStats.get(job.id) ?? { id: job.id, enabled: job.enabled, intervalMs: job.intervalMs, ok: null }]))
  const ok = Object.values(activeJobStats).every((stat) => stat.enabled === false || stat.ok !== false)
  const currentWeatherReady = Boolean(latestJobOutputs.currentWeather) && activeJobStats.currentWeather?.ok !== false
  const enabledIntervals = jobs.filter((job) => job.enabled).map((job) => job.intervalMs)
  const shortestDueIntervalMs = enabledIntervals.length ? Math.min(...enabledIntervals) : 60_000
  const cycleOverrunMs = Math.max(0, durationMs - shortestDueIntervalMs)
  const nextRunAt = once || shuttingDown ? null : new Date(finishedAt.getTime() + sleepMs).toISOString()

  const status = {
    generatedAt: finishedAt.toISOString(),
    serviceId: 'qore-live-weather-service',
    mode: once ? 'one-shot' : 'loop',
    ok,
    repoDir,
    intervalMs: shortestDueIntervalMs,
    nextRunAt,
    runConfiguration: {
      settingsFile: relative(settingsFile),
      profile: profileName,
      profileFound: selectedProfileExists,
      profileDescription: selectedProfile.description ?? null,
      runLiveForecast,
      runForecastCalendar,
      runPerformanceTest,
      respectCadence,
      liveModels,
      forecastDays,
      fetchConcurrency,
      fetchBatchSize,
      fetchTimeoutMs,
      performanceIntervalMs,
      forecastCalendarIntervalMs,
      forecastCalendarOutputRoot: relative(forecastCalendarOutputRoot),
      stateDir: relative(stateDir),
      operatorState: {
        file: relative(operatorStatePath),
        source: operatorStateSource,
        ignoredLegacyCadenceFile: legacyOperatorStateFile ?? null,
      },
    },
    cadencePlan: {
      currentWeather: {
        enabled: runLiveForecast,
        requestedIntervalMs: serviceIntervalMs,
        profile: profileName,
      },
      forecastCalendar: {
        enabled: runForecastCalendar,
        intervalMs: forecastCalendarIntervalMs,
      },
      performanceComparison: {
        enabled: runPerformanceTest,
        intervalMs: performanceIntervalMs,
      },
      liveCadences: Object.fromEntries(
        jobs.map((job) => [
          job.id,
          {
            enabled: job.enabled,
            intervalMs: job.intervalMs,
            outputFile: job.outputFile ? relative(job.outputFile) : null,
            slider: liveCadenceSettings[job.id]?.slider ?? null,
            reason: liveCadenceSettings[job.id]?.reason ?? null,
          },
        ]),
      ),
    },
    readiness: {
      vpsContinuousWeatherPolling: runLiveForecast,
      liveWeatherSnapshot: currentWeatherReady ? 'ready' : 'unavailable',
      marketReferencePrices: latestJobOutputs.marketReferencePrices ? 'ready' : 'unavailable',
      brokerAccountAndPositions: latestJobOutputs.brokerAccountAndPositions?.brokerConnected ? 'connected' : 'not-connected',
      riskAndKillSwitchState: latestJobOutputs.riskAndKillSwitchState ? 'ready' : 'unavailable',
      signalIntentReconcile: latestJobOutputs.signalIntentReconcile ? 'ready' : 'unavailable',
      strategyInference: latestJobOutputs.strategyInference?.validated ? 'ready' : 'unavailable',
      eiaStorageReleaseWindow: latestJobOutputs.eiaStorageReleaseWindow ? 'ready' : 'unavailable',
      liveRoutingEnabled: Boolean(latestJobOutputs.brokerAccountAndPositions?.liveRoutingEnabled),
      brokerAdapter: latestJobOutputs.brokerAccountAndPositions?.brokerConnected
        ? 'Alpaca reconciler snapshot connected; order submission remains in the separate broker process'
        : 'Alpaca reconciler available but no connected account snapshot is present',
      historicalComparison: latestComparison?.headline ? 'ready' : 'unavailable',
    },
    cycle: {
      startedAt: cycleStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      requestedIntervalMs: shortestDueIntervalMs,
      sleepMs,
      cycleOverrunMs,
      cadenceMet: cycleOverrunMs === 0,
      dueJobs: dueJobs.map((job) => job.id),
      jobRuns,
    },
    liveJobs: activeJobStats,
    currentWeather: latestJobOutputs.currentWeather
      ? {
          generatedAt: latestJobOutputs.currentWeather.generatedAt,
          source: latestJobOutputs.currentWeather.source,
          models: latestJobOutputs.currentWeather.models,
          rowCounts: latestJobOutputs.currentWeather.rowCounts,
          latestActionableScore: latestJobOutputs.currentWeather.latestActionableScore,
          riskContext: latestJobOutputs.currentWeather.riskContext,
          digest: latestJobOutputs.currentWeather.digest,
          files: latestJobOutputs.currentWeather.files,
        }
      : null,
    marketReferencePrices: latestJobOutputs.marketReferencePrices ?? null,
    brokerAccountAndPositions: latestJobOutputs.brokerAccountAndPositions ?? null,
    riskAndKillSwitchState: latestJobOutputs.riskAndKillSwitchState ?? null,
    signalIntentReconcile: latestJobOutputs.signalIntentReconcile ?? null,
    strategyInference: latestJobOutputs.strategyInference ?? null,
    eiaStorageReleaseWindow: latestJobOutputs.eiaStorageReleaseWindow ?? null,
    performance: latestComparison,
    files: {
      status: relative(statusPath),
      snapshot: relative(snapshotPath),
      scoresCsv: relative(scoreCsvPath),
      locationAnomaliesCsv: relative(locationCsvPath),
      marketReferencePrices: relative(marketReferencePath),
      brokerAccountAndPositions: relative(brokerAccountPath),
      riskAndKillSwitchState: relative(riskStatePath),
      signalIntentReconcile: relative(signalIntentPath),
      strategyInference: relative(liveInferencePath),
      eiaStorageReleaseWindow: relative(eiaStoragePath),
    },
  }

  await writeJson(statusPath, status)
  console.log(
    [
      `live-weather ok=${status.ok}`,
      `profile=${profileName}`,
      `intervalMs=${shortestDueIntervalMs}`,
      `durationMs=${durationMs}`,
      cycleOverrunMs ? `overrunMs=${cycleOverrunMs}` : null,
      `due=${dueJobs.map((job) => job.id).join('|') || 'none'}`,
      latestJobOutputs.currentWeather ? `digest=${latestJobOutputs.currentWeather.digest.slice(0, 12)}` : 'snapshot=none',
      latestComparison?.headline?.all ? `liveVsNoRefreshAll=${latestComparison.headline.all.liveMinusNoRefreshPct}%` : null,
      `status=${relative(statusPath)}`,
    ]
      .filter(Boolean)
      .join(' '),
  )
  return status
}

async function sleep(ms) {
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeFromSleep = null
      resolve()
    }, ms)
    wakeFromSleep = () => {
      clearTimeout(timer)
      wakeFromSleep = null
      resolve()
    }
  })
}

function requestShutdown() {
  shuttingDown = true
  if (wakeFromSleep) wakeFromSleep()
}

async function main() {
  process.on('SIGINT', requestShutdown)
  process.on('SIGTERM', requestShutdown)

  do {
    const status = await runCycle()
    if (once && !status.ok) process.exitCode = 1
    if (once) break
    await sleep(status.cycle.sleepMs)
  } while (!shuttingDown)
}

main().catch(async (error) => {
  await writeJson(statusPath, {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-live-weather-service',
    ok: false,
    error: error.message,
  })
  console.error(error)
  process.exit(1)
})
