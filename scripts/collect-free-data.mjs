#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const repoDir = process.cwd()
const dataRoot = process.env.QORE_DATA_ROOT ?? path.join(repoDir, '.local', 'qore')
const timeoutMs = Number(process.env.QORE_FETCH_TIMEOUT_MS ?? 15000)
const weatherFailureLimit = Number(process.env.QORE_WEATHER_FAILURE_LIMIT ?? 8)
const startDate = process.env.QORE_TEST_START ?? '2025-11-01'
const endDate = process.env.QORE_TEST_END ?? '2026-03-31'
const normalStartDate = process.env.QORE_NORMAL_START ?? '1991-01-01'
const normalEndDate = process.env.QORE_NORMAL_END ?? '2020-12-31'
const marketEndDate = process.env.QORE_MARKET_END ?? addDays(new Date().toISOString().slice(0, 10), 1)
const yahooEndEpoch = Math.floor(new Date(`${marketEndDate}T00:00:00Z`).getTime() / 1000)

const locations = [
  { id: 'minneapolis', name: 'Minneapolis', latitude: 44.9778, longitude: -93.265, region: 'Upper Midwest', weight: 0.07 },
  { id: 'chicago', name: 'Chicago', latitude: 41.8781, longitude: -87.6298, region: 'Great Lakes', weight: 0.09 },
  { id: 'detroit', name: 'Detroit', latitude: 42.3314, longitude: -83.0458, region: 'Great Lakes', weight: 0.06 },
  { id: 'cleveland', name: 'Cleveland', latitude: 41.4993, longitude: -81.6944, region: 'Great Lakes', weight: 0.05 },
  { id: 'indianapolis', name: 'Indianapolis', latitude: 39.7684, longitude: -86.1581, region: 'Ohio Valley', weight: 0.05 },
  { id: 'st-louis', name: 'St. Louis', latitude: 38.627, longitude: -90.1994, region: 'Midwest', weight: 0.05 },
  { id: 'kansas-city', name: 'Kansas City', latitude: 39.0997, longitude: -94.5786, region: 'Central Plains', weight: 0.04 },
  { id: 'nashville', name: 'Nashville', latitude: 36.1627, longitude: -86.7816, region: 'Mid-South', weight: 0.05 },
  { id: 'memphis', name: 'Memphis', latitude: 35.1495, longitude: -90.049, region: 'Mid-South', weight: 0.04 },
  { id: 'atlanta', name: 'Atlanta', latitude: 33.749, longitude: -84.388, region: 'Southeast', weight: 0.07 },
  { id: 'charlotte', name: 'Charlotte', latitude: 35.2271, longitude: -80.8431, region: 'Southeast', weight: 0.05 },
  { id: 'raleigh', name: 'Raleigh', latitude: 35.7796, longitude: -78.6382, region: 'Southeast', weight: 0.04 },
  { id: 'washington-dc', name: 'Washington, DC', latitude: 38.9072, longitude: -77.0369, region: 'Mid-Atlantic', weight: 0.07 },
  { id: 'philadelphia', name: 'Philadelphia', latitude: 39.9526, longitude: -75.1652, region: 'Mid-Atlantic', weight: 0.06 },
  { id: 'new-york', name: 'New York', latitude: 40.7128, longitude: -74.006, region: 'Northeast', weight: 0.11 },
  { id: 'boston', name: 'Boston', latitude: 42.3601, longitude: -71.0589, region: 'Northeast', weight: 0.06 },
  { id: 'dallas', name: 'Dallas', latitude: 32.7767, longitude: -96.797, region: 'Texas/Oklahoma fringe', weight: 0.05 },
  { id: 'houston', name: 'Houston', latitude: 29.7604, longitude: -95.3698, region: 'Texas/Oklahoma fringe', weight: 0.05 },
]

const forecastModels = [
  { id: 'ecmwf-ifs', modelParam: 'ecmwf_ifs', source: 'single-runs', runStart: '2024-03-14' },
  { id: 'ecmwf-ifs-025', modelParam: 'ecmwf_ifs025', source: 'historical-forecast' },
  { id: 'ecmwf-aifs-025', modelParam: 'ecmwf_aifs025', source: 'historical-forecast' },
  { id: 'gfs-global', modelParam: 'gfs_global', source: 'historical-forecast' },
  { id: 'gfs-025', modelParam: 'gfs025', source: 'historical-forecast' },
  { id: 'gfs-graphcast-025', modelParam: 'gfs_graphcast025', source: 'historical-forecast' },
  { id: 'gem-global', modelParam: 'gem_global', source: 'historical-forecast' },
]

const marketSymbols = [
  { symbol: 'UNG', label: 'United States Natural Gas Fund', period1: 1176903000 },
  { symbol: 'NG=F', label: 'Yahoo continuous front-month natural gas future', period1: 967608000 },
]

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n') + '\n'
}

function dateFromEpoch(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function compactDate(dateText) {
  return dateText.replaceAll('-', '')
}

function isoFromCompactDate(dateText) {
  return `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`
}

function fahrenheitFromCelsius(value) {
  return value * 1.8 + 32
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function datesBetween(start, end, stepDays) {
  const dates = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, stepDays)) {
    dates.push(cursor)
  }
  return dates
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'QORE research data collector' },
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`)
    }
    const json = JSON.parse(text)
    if (json?.error) {
      throw new Error(json.reason ?? JSON.stringify(json.error))
    }
    return json
  } finally {
    clearTimeout(timeout)
  }
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n')
}

async function writeCsv(filePath, rows, headers) {
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, rowsToCsv(rows, headers))
}

async function collectYahooMarket(manifest) {
  const marketDir = path.join(dataRoot, 'market', 'yahoo')
  await ensureDir(marketDir)

  for (const source of marketSymbols) {
    const encoded = encodeURIComponent(source.symbol)
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?period1=${source.period1}&period2=${yahooEndEpoch}&interval=1d&events=history&includeAdjustedClose=true`
    try {
      const json = await fetchJson(url)
      const result = json.chart?.result?.[0]
      const quote = result?.indicators?.quote?.[0]
      const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? []
      const timestamps = result?.timestamp ?? []
      if (!result || !quote || !timestamps.length) {
        throw new Error('Yahoo response did not include daily bars.')
      }
      const rows = timestamps.map((timestamp, index) => ({
        date: dateFromEpoch(timestamp),
        open: quote.open?.[index] ?? '',
        high: quote.high?.[index] ?? '',
        low: quote.low?.[index] ?? '',
        close: quote.close?.[index] ?? '',
        adjustedClose: adjusted[index] ?? quote.close?.[index] ?? '',
        volume: quote.volume?.[index] ?? '',
        symbol: source.symbol,
        source: 'Yahoo chart API',
      })).filter((row) => row.open !== '' && row.high !== '' && row.low !== '' && row.close !== '')
      const safeSymbol = source.symbol.replace(/[^A-Za-z0-9]/g, '-')
      const csvPath = path.join(marketDir, `${safeSymbol}-daily.csv`)
      const jsonPath = path.join(marketDir, `${safeSymbol}-daily.raw.json`)
      const appCsvPath = path.join(marketDir, `${safeSymbol}-qore-market.csv`)
      await writeCsv(csvPath, rows, ['date', 'open', 'high', 'low', 'close', 'adjustedClose', 'volume', 'symbol', 'source'])
      await writeJson(jsonPath, json)
      await writeCsv(
        appCsvPath,
        rows.map((row) => ({
          date: row.date,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.adjustedClose || row.close,
          volume: row.volume,
          contract: source.symbol,
          storageBcf: 0,
        })),
        ['date', 'open', 'high', 'low', 'close', 'volume', 'contract', 'storageBcf'],
      )
      manifest.market.push({
        status: 'ok',
        symbol: source.symbol,
        label: source.label,
        rows: rows.length,
        firstDate: rows[0]?.date,
        lastDate: rows.at(-1)?.date,
        files: [csvPath, appCsvPath, jsonPath].map((file) => path.relative(repoDir, file)),
      })
      console.log(`market ok: ${source.symbol} ${rows.length} rows`)
    } catch (error) {
      manifest.market.push({
        status: 'failed',
        symbol: source.symbol,
        label: source.label,
        error: error.message,
      })
      console.warn(`market failed: ${source.symbol}: ${error.message}`)
    }
  }
}

async function collectLocationCsv() {
  const filePath = path.join(dataRoot, 'weather', 'locations.csv')
  await writeCsv(filePath, locations, ['id', 'name', 'latitude', 'longitude', 'region', 'weight'])
  return filePath
}

async function collectNasaPowerTemperatures(manifest) {
  const actualDir = path.join(dataRoot, 'weather', 'nasa-power', 'actuals')
  const normalDir = path.join(dataRoot, 'weather', 'nasa-power', 'normals')
  const anomalyRows = []
  await ensureDir(actualDir)
  await ensureDir(normalDir)

  for (const location of locations) {
    const normalUrl = new URL('https://power.larc.nasa.gov/api/temporal/daily/point')
    normalUrl.searchParams.set('parameters', 'T2M')
    normalUrl.searchParams.set('community', 'RE')
    normalUrl.searchParams.set('longitude', String(location.longitude))
    normalUrl.searchParams.set('latitude', String(location.latitude))
    normalUrl.searchParams.set('start', compactDate(normalStartDate))
    normalUrl.searchParams.set('end', compactDate(normalEndDate))
    normalUrl.searchParams.set('format', 'JSON')

    const actualUrl = new URL('https://power.larc.nasa.gov/api/temporal/daily/point')
    actualUrl.searchParams.set('parameters', 'T2M')
    actualUrl.searchParams.set('community', 'RE')
    actualUrl.searchParams.set('longitude', String(location.longitude))
    actualUrl.searchParams.set('latitude', String(location.latitude))
    actualUrl.searchParams.set('start', compactDate(startDate))
    actualUrl.searchParams.set('end', compactDate(endDate))
    actualUrl.searchParams.set('format', 'JSON')

    try {
      const normalJson = await fetchJson(normalUrl)
      const actualJson = await fetchJson(actualUrl)
      const normalValues = normalJson.properties?.parameter?.T2M ?? {}
      const actualValues = actualJson.properties?.parameter?.T2M ?? {}
      const normalsByMonthDay = new Map()

      for (const [date, value] of Object.entries(normalValues)) {
        if (typeof value !== 'number' || value <= -900) continue
        const monthDay = date.slice(4)
        const values = normalsByMonthDay.get(monthDay) ?? []
        values.push(value)
        normalsByMonthDay.set(monthDay, values)
      }

      const normalMeansByMonthDay = new Map(
        Array.from(normalsByMonthDay.entries()).map(([monthDay, values]) => [
          monthDay,
          values.reduce((sum, value) => sum + value, 0) / values.length,
        ]),
      )

      for (const [date, value] of Object.entries(actualValues)) {
        if (typeof value !== 'number' || value <= -900) continue
        const normalC = normalMeansByMonthDay.get(date.slice(4))
        if (normalC === undefined) continue
        anomalyRows.push({
          date: isoFromCompactDate(date),
          locationId: location.id,
          region: location.region,
          weight: location.weight,
          tempMeanC: round(value),
          tempMeanF: round(fahrenheitFromCelsius(value)),
          normalMeanC: round(normalC),
          normalMeanF: round(fahrenheitFromCelsius(normalC)),
          anomalyF: round(fahrenheitFromCelsius(value) - fahrenheitFromCelsius(normalC)),
          source: 'NASA POWER daily T2M',
        })
      }

      const normalPath = path.join(normalDir, `${location.id}-${normalStartDate}-${normalEndDate}.json`)
      const actualPath = path.join(actualDir, `${location.id}-${startDate}-${endDate}.json`)
      await writeJson(normalPath, normalJson)
      await writeJson(actualPath, actualJson)
      manifest.weather.nasaPower.push({
        status: 'ok',
        locationId: location.id,
        normalRows: Object.keys(normalValues).length,
        actualRows: Object.keys(actualValues).length,
        files: [normalPath, actualPath].map((file) => path.relative(repoDir, file)),
      })
      console.log(`nasa power ok: ${location.id}`)
    } catch (error) {
      manifest.weather.nasaPower.push({
        status: 'failed',
        locationId: location.id,
        normalUrl: normalUrl.toString(),
        actualUrl: actualUrl.toString(),
        error: error.message,
      })
      console.warn(`nasa power failed: ${location.id}: ${error.message}`)
    }
  }

  const anomalyPath = path.join(dataRoot, 'weather', 'nasa-power', `daily-temperature-anomalies-${startDate}-${endDate}.csv`)
  await writeCsv(anomalyPath, anomalyRows, [
    'date',
    'locationId',
    'region',
    'weight',
    'tempMeanC',
    'tempMeanF',
    'normalMeanC',
    'normalMeanF',
    'anomalyF',
    'source',
  ])
  manifest.weather.nasaPowerAnomalyFile = path.relative(repoDir, anomalyPath)
  manifest.weather.nasaPowerAnomalyRows = anomalyRows.length
}

async function collectNormals(manifest) {
  const normalDir = path.join(dataRoot, 'weather', 'open-meteo', 'normals')
  await ensureDir(normalDir)
  let failures = 0

  for (const location of locations) {
    if (failures >= weatherFailureLimit) {
      manifest.weather.normals.push({
        status: 'skipped',
        reason: `Stopped after ${failures} failed Open-Meteo normal requests.`,
      })
      break
    }
    const url = new URL('https://archive-api.open-meteo.com/v1/archive')
    url.searchParams.set('latitude', String(location.latitude))
    url.searchParams.set('longitude', String(location.longitude))
    url.searchParams.set('start_date', normalStartDate)
    url.searchParams.set('end_date', normalEndDate)
    url.searchParams.set('hourly', 'temperature_2m')
    url.searchParams.set('temperature_unit', 'fahrenheit')
    url.searchParams.set('timezone', 'UTC')
    try {
      const json = await fetchJson(url)
      const filePath = path.join(normalDir, `${location.id}.json`)
      await writeJson(filePath, json)
      manifest.weather.normals.push({
        status: 'ok',
        locationId: location.id,
        rows: json.hourly?.time?.length ?? 0,
        firstTime: json.hourly?.time?.[0],
        lastTime: json.hourly?.time?.at(-1),
        file: path.relative(repoDir, filePath),
      })
      console.log(`normal ok: ${location.id}`)
    } catch (error) {
      manifest.weather.normals.push({
        status: 'failed',
        locationId: location.id,
        url: url.toString(),
        error: error.message,
      })
      failures += 1
      console.warn(`normal failed: ${location.id}: ${error.message}`)
    }
  }
}

async function collectHistoricalForecasts(manifest) {
  const forecastDir = path.join(dataRoot, 'weather', 'open-meteo', 'historical-forecast')
  await ensureDir(forecastDir)
  const models = forecastModels.filter((model) => model.source === 'historical-forecast')
  let failures = 0

  for (const location of locations) {
    for (const model of models) {
      if (failures >= weatherFailureLimit) {
        manifest.weather.historicalForecasts.push({
          status: 'skipped',
          reason: `Stopped after ${failures} failed Open-Meteo historical-forecast requests.`,
        })
        return
      }
      const url = new URL('https://historical-forecast-api.open-meteo.com/v1/forecast')
      url.searchParams.set('latitude', String(location.latitude))
      url.searchParams.set('longitude', String(location.longitude))
      url.searchParams.set('start_date', startDate)
      url.searchParams.set('end_date', endDate)
      url.searchParams.set('hourly', 'temperature_2m')
      url.searchParams.set('models', model.modelParam)
      url.searchParams.set('temperature_unit', 'fahrenheit')
      url.searchParams.set('timezone', 'UTC')
      try {
        const json = await fetchJson(url)
        const filePath = path.join(forecastDir, `${location.id}-${model.id}-${startDate}-${endDate}.json`)
        await writeJson(filePath, json)
        manifest.weather.historicalForecasts.push({
          status: 'ok',
          locationId: location.id,
          modelId: model.id,
          rows: json.hourly?.time?.length ?? 0,
          firstTime: json.hourly?.time?.[0],
          lastTime: json.hourly?.time?.at(-1),
          file: path.relative(repoDir, filePath),
        })
        console.log(`historical forecast ok: ${location.id} ${model.id}`)
      } catch (error) {
        manifest.weather.historicalForecasts.push({
          status: 'failed',
          locationId: location.id,
          modelId: model.id,
        url: url.toString(),
        error: error.message,
      })
      failures += 1
      console.warn(`historical forecast failed: ${location.id} ${model.id}: ${error.message}`)
    }
  }
}
}

async function collectSingleRuns(manifest) {
  const singleRunDir = path.join(dataRoot, 'weather', 'open-meteo', 'single-runs')
  await ensureDir(singleRunDir)
  const runDates = datesBetween(startDate, endDate, Number(process.env.QORE_RUN_STEP_DAYS ?? 7))
  const model = forecastModels.find((candidate) => candidate.source === 'single-runs')
  let failures = 0

  if (!model) return

  for (const location of locations) {
    for (const date of runDates) {
      if (failures >= weatherFailureLimit) {
        manifest.weather.singleRuns.push({
          status: 'skipped',
          reason: `Stopped after ${failures} failed Open-Meteo single-run requests.`,
        })
        return
      }
      const run = `${date}T00:00`
      const url = new URL('https://single-runs-api.open-meteo.com/v1/forecast')
      url.searchParams.set('latitude', String(location.latitude))
      url.searchParams.set('longitude', String(location.longitude))
      url.searchParams.set('run', run)
      url.searchParams.set('hourly', 'temperature_2m')
      url.searchParams.set('models', model.modelParam)
      url.searchParams.set('temperature_unit', 'fahrenheit')
      url.searchParams.set('timezone', 'UTC')
      try {
        const json = await fetchJson(url)
        const filePath = path.join(singleRunDir, `${location.id}-${model.id}-${date}.json`)
        await writeJson(filePath, json)
        manifest.weather.singleRuns.push({
          status: 'ok',
          locationId: location.id,
          modelId: model.id,
          run,
          rows: json.hourly?.time?.length ?? 0,
          firstTime: json.hourly?.time?.[0],
          lastTime: json.hourly?.time?.at(-1),
          file: path.relative(repoDir, filePath),
        })
        console.log(`single run ok: ${location.id} ${run}`)
      } catch (error) {
        manifest.weather.singleRuns.push({
          status: 'failed',
          locationId: location.id,
          modelId: model.id,
          run,
        url: url.toString(),
        error: error.message,
      })
      failures += 1
      console.warn(`single run failed: ${location.id} ${run}: ${error.message}`)
    }
  }
}
}

async function collectPreviousRuns(manifest) {
  const previousDir = path.join(dataRoot, 'weather', 'open-meteo', 'previous-runs')
  await ensureDir(previousDir)
  let failures = 0

  for (const location of locations) {
    if (failures >= weatherFailureLimit) {
      manifest.weather.previousRuns.push({
        status: 'skipped',
        reason: `Stopped after ${failures} failed Open-Meteo previous-run requests.`,
      })
      break
    }
    const url = new URL('https://previous-runs-api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(location.latitude))
    url.searchParams.set('longitude', String(location.longitude))
    url.searchParams.set(
      'hourly',
      'temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day2,temperature_2m_previous_day3,temperature_2m_previous_day4,temperature_2m_previous_day5,temperature_2m_previous_day6,temperature_2m_previous_day7',
    )
    url.searchParams.set('past_days', '92')
    url.searchParams.set('forecast_days', '1')
    url.searchParams.set('temperature_unit', 'fahrenheit')
    url.searchParams.set('timezone', 'UTC')
    try {
      const json = await fetchJson(url)
      const filePath = path.join(previousDir, `${location.id}-previous-runs.json`)
      await writeJson(filePath, json)
      manifest.weather.previousRuns.push({
        status: 'ok',
        locationId: location.id,
        rows: json.hourly?.time?.length ?? 0,
        firstTime: json.hourly?.time?.[0],
        lastTime: json.hourly?.time?.at(-1),
        file: path.relative(repoDir, filePath),
      })
      console.log(`previous runs ok: ${location.id}`)
    } catch (error) {
      manifest.weather.previousRuns.push({
        status: 'failed',
        locationId: location.id,
        url: url.toString(),
        error: error.message,
      })
      failures += 1
      console.warn(`previous runs failed: ${location.id}: ${error.message}`)
    }
  }
}

async function maybeReadPreviousManifest() {
  const filePath = path.join(dataRoot, 'runs', 'free-data-manifest.json')
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function main() {
  const profile = process.env.QORE_COLLECT_PROFILE ?? 'winter-2025-2026'
  const previousManifest = await maybeReadPreviousManifest()
  const manifest = {
    generatedAt: new Date().toISOString(),
    profile,
    dataRoot: path.relative(repoDir, dataRoot),
    sourceNote: 'No-key/free data only. Files are local cache artifacts and are not committed because .local/ is ignored.',
    ranges: {
      testStart: startDate,
      testEnd: endDate,
      normalStart: normalStartDate,
      normalEnd: normalEndDate,
      marketEnd: marketEndDate,
      marketEndEpoch: yahooEndEpoch,
    },
    previousManifestGeneratedAt: previousManifest?.generatedAt ?? null,
    market: [],
    weather: {
      locationsFile: path.relative(repoDir, await collectLocationCsv()),
      nasaPower: [],
      nasaPowerAnomalyFile: null,
      nasaPowerAnomalyRows: 0,
      normals: [],
      historicalForecasts: [],
      singleRuns: [],
      previousRuns: [],
    },
  }

  await collectYahooMarket(manifest)
  await collectNasaPowerTemperatures(manifest)
  await collectNormals(manifest)
  await collectHistoricalForecasts(manifest)
  await collectSingleRuns(manifest)
  await collectPreviousRuns(manifest)

  const manifestPath = path.join(dataRoot, 'runs', 'free-data-manifest.json')
  await writeJson(manifestPath, manifest)
  console.log(`manifest written: ${path.relative(repoDir, manifestPath)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
