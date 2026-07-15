#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadLocalEnv } from './local-env.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const dataRoot = process.env.QORE_DATA_ROOT ?? path.join(repoDir, 'data', 'qore')
const indexBasketConfigPath =
  process.env.QORE_INDEX_BASKET_CONFIG ?? path.join(repoDir, 'data', 'qore', 'market', 'index-basket-config.json')
const marketIndexBasket = JSON.parse(readFileSync(indexBasketConfigPath, 'utf8'))
const timeoutMs = Number(process.env.QORE_FETCH_TIMEOUT_MS ?? 15000)
const weatherFailureLimit = Number(process.env.QORE_WEATHER_FAILURE_LIMIT ?? 8)
const todayDate = new Date().toISOString().slice(0, 10)
const latestCompleteDate = addDays(todayDate, -1)
const startDate = process.env.QORE_TEST_START ?? '2021-01-01'
const normalStartDate = process.env.QORE_NORMAL_START ?? '1991-01-01'
const normalEndDate = process.env.QORE_NORMAL_END ?? '2020-12-31'
const marketEndDate = process.env.QORE_MARKET_END ?? todayDate
const endDate = process.env.QORE_TEST_END ?? latestCompleteDate
const yahooEndEpoch = Math.floor(new Date(`${marketEndDate}T00:00:00Z`).getTime() / 1000)
const eiaApiKey = process.env.EIA_API_KEY ?? 'DEMO_KEY'
const skipYahoo = truthy(process.env.QORE_SKIP_YAHOO)
const skipNasaPower = truthy(process.env.QORE_SKIP_NASA_POWER)
const skipOpenMeteo = truthy(process.env.QORE_SKIP_OPEN_METEO)
const skipEia = truthy(process.env.QORE_SKIP_EIA)
const failOnDataFailure = truthy(process.env.QORE_FAIL_ON_DATA_FAILURE)

const arcticBlastThresholds = {
  coldAnomalyF: -8,
  extremeAnomalyF: -14,
  minCoveragePct: 0.55,
}

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
  { symbol: 'SPY', label: 'SPDR S&P 500 ETF Trust', period1: 728265600, persistRawJson: false },
  { symbol: 'VOO', label: 'Vanguard S&P 500 ETF', period1: 1283990400, persistRawJson: false },
  { symbol: 'DIA', label: 'SPDR Dow Jones Industrial Average ETF Trust', period1: 852076800, persistRawJson: false },
  { symbol: 'QQQ', label: 'Invesco QQQ Trust', period1: 921024000, persistRawJson: false },
  { symbol: 'QQQM', label: 'Invesco NASDAQ 100 ETF', period1: 1602547200, persistRawJson: false },
  { symbol: 'IWM', label: 'iShares Russell 2000 ETF', period1: 959904000, persistRawJson: false },
]

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n') + '\n'
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
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

function safeMarketSymbol(symbol) {
  return symbol.replace(/[^A-Za-z0-9]/g, '-')
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

function isHeatingSeason(dateText) {
  const month = Number(dateText.slice(5, 7))
  return month <= 3 || month >= 11
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

  if (skipYahoo) {
    manifest.market.push({
      status: 'skipped',
      reason: 'QORE_SKIP_YAHOO is enabled; keeping existing cached market files.',
    })
    return
  }

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
      const safeSymbol = safeMarketSymbol(source.symbol)
      const csvPath = path.join(marketDir, `${safeSymbol}-daily.csv`)
      const jsonPath = path.join(marketDir, `${safeSymbol}-daily.raw.json`)
      const appCsvPath = path.join(marketDir, `${safeSymbol}-qore-market.csv`)
      await writeCsv(csvPath, rows, ['date', 'open', 'high', 'low', 'close', 'adjustedClose', 'volume', 'symbol', 'source'])
      const files = [csvPath, appCsvPath]
      if (source.persistRawJson !== false) {
        await writeJson(jsonPath, json)
        files.push(jsonPath)
      }
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
        files: files.map((file) => path.relative(repoDir, file)),
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

async function deriveMarketIndexBasket(manifest) {
  const marketDir = path.join(dataRoot, 'market', 'yahoo')
  const componentRows = []
  const components = marketIndexBasket.components.map((component) => ({
    symbol: component.symbol,
    label: component.label,
    targetWeight: Number(component.targetWeight),
  }))
  const totalWeight = components.reduce((sum, component) => sum + component.targetWeight, 0)

  if (!components.length || !Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error('Index basket config must include positive component target weights.')
  }
  const normalizedComponents = components.map((component) => ({
    ...component,
    targetWeight: component.targetWeight / totalWeight,
  }))

  try {
    for (const { symbol } of normalizedComponents) {
      const filePath = path.join(marketDir, `${safeMarketSymbol(symbol)}-qore-market.csv`)
      const rows = parseCsv(await readFile(filePath, 'utf8'))
        .map((row) => ({
          date: row.date,
          close: Number(row.close),
          volume: Number(row.volume),
        }))
        .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
      if (!rows.length) throw new Error(`${symbol} qore-market file did not include usable closes.`)
      componentRows.push({ symbol, rows })
    }

    const commonDates = componentRows
      .map((component) => new Set(component.rows.map((row) => row.date)))
      .reduce((dates, componentDates) => new Set([...dates].filter((date) => componentDates.has(date))))
    const dates = [...commonDates].sort()
    if (!dates.length) throw new Error('Index basket components did not have overlapping market dates.')

    const rowsBySymbol = new Map(
      componentRows.map((component) => [component.symbol, new Map(component.rows.map((row) => [row.date, row]))]),
    )

    let basketClose = 100
    const basketRows = dates.map((date, index) => {
      if (index > 0) {
        const previousDate = dates[index - 1]
        const dailyReturn = normalizedComponents.reduce((sum, component) => {
          const row = rowsBySymbol.get(component.symbol).get(date)
          const previousRow = rowsBySymbol.get(component.symbol).get(previousDate)
          return sum + component.targetWeight * (row.close / previousRow.close - 1)
        }, 0)
        basketClose *= 1 + dailyReturn
      }
      const close = round(basketClose, 6)
      const rowComponents = normalizedComponents.map((component) => {
        const row = rowsBySymbol.get(component.symbol).get(date)
        return {
          symbol: component.symbol,
          targetWeight: component.targetWeight,
          close: row.close,
          volume: row.volume,
        }
      })
      return {
        date,
        open: close,
        high: close,
        low: close,
        close,
        volume: rowComponents.reduce((sum, component) => sum + (Number.isFinite(component.volume) ? component.volume : 0), 0),
        contract: marketIndexBasket.symbol,
        storageBcf: 0,
      }
    })

    const appCsvPath = path.join(marketDir, `${marketIndexBasket.symbol}-qore-market.csv`)
    await writeCsv(appCsvPath, basketRows, ['date', 'open', 'high', 'low', 'close', 'volume', 'contract', 'storageBcf'])
    manifest.market.push({
      status: 'ok',
      symbol: marketIndexBasket.symbol,
      label: marketIndexBasket.label,
      source: 'Derived target-weight basket of Yahoo adjusted-close ETF histories.',
      methodology: marketIndexBasket.methodology,
      rebalance: marketIndexBasket.rebalance,
      components: normalizedComponents.map((component) => component.symbol),
      weights: normalizedComponents.map((component) => ({
        symbol: component.symbol,
        label: component.label,
        targetWeight: round(component.targetWeight, 6),
      })),
      rows: basketRows.length,
      firstDate: basketRows[0]?.date,
      lastDate: basketRows.at(-1)?.date,
      files: [path.relative(repoDir, appCsvPath)],
    })
    console.log(`market basket ok: ${marketIndexBasket.symbol} ${basketRows.length} rows`)
  } catch (error) {
    manifest.market.push({
      status: 'failed',
      symbol: marketIndexBasket.symbol,
      label: marketIndexBasket.label,
      components: normalizedComponents.map((component) => component.symbol),
      error: error.message,
    })
    console.warn(`market basket failed: ${marketIndexBasket.symbol}: ${error.message}`)
  }
}

async function collectEiaStorage(manifest) {
  const eiaDir = path.join(dataRoot, 'fundamentals', 'eia')
  const csvPath = path.join(eiaDir, 'working-gas-storage-lower48-weekly.csv')
  await ensureDir(eiaDir)

  if (skipEia) {
    let existingRows = []
    try {
      existingRows = parseCsv(await readFile(csvPath, 'utf8'))
        .map((row) => ({
          date: row.date,
          series: row.series,
          storageBcf: Number(row.storageBcf),
          unit: row.unit,
          areaName: row.areaName,
          source: row.source,
        }))
        .filter((row) => row.date && Number.isFinite(row.storageBcf))
    } catch {
      existingRows = []
    }
    manifest.fundamentals.eiaStorage.push({
      status: 'skipped',
      reason: 'QORE_SKIP_EIA is enabled; using existing checked-in EIA storage rows for market joins.',
      existingRows: existingRows.length,
      existingFile: path.relative(repoDir, csvPath),
    })
    return existingRows
  }

  const url = new URL('https://api.eia.gov/v2/natural-gas/stor/wkly/data/')
  url.searchParams.set('api_key', eiaApiKey)
  url.searchParams.set('frequency', 'weekly')
  url.searchParams.set('data[0]', 'value')
  url.searchParams.append('facets[series][]', 'NW2_EPG0_SWO_R48_BCF')
  url.searchParams.set('sort[0][column]', 'period')
  url.searchParams.set('sort[0][direction]', 'asc')
  url.searchParams.set('offset', '0')
  url.searchParams.set('length', '5000')

  try {
    const json = await fetchJson(url)
    const rows = (json.response?.data ?? [])
      .map((row) => ({
        date: row.period,
        series: row.series,
        storageBcf: Number(row.value),
        unit: row['unit-name'] ?? row.units ?? 'Bcf',
        areaName: row['area-name'] ?? 'Lower 48',
        source: 'EIA Open Data API',
      }))
      .filter((row) => row.date && Number.isFinite(row.storageBcf))
    const jsonPath = path.join(eiaDir, 'working-gas-storage-lower48-weekly.raw.json')
    await writeCsv(csvPath, rows, ['date', 'series', 'storageBcf', 'unit', 'areaName', 'source'])
    await writeJson(jsonPath, json)
    manifest.fundamentals.eiaStorage.push({
      status: 'ok',
      rows: rows.length,
      firstDate: rows[0]?.date,
      lastDate: rows.at(-1)?.date,
      apiKeySource: process.env.EIA_API_KEY ? 'EIA_API_KEY' : 'DEMO_KEY',
      files: [csvPath, jsonPath].map((file) => path.relative(repoDir, file)),
    })
    console.log(`eia storage ok: ${rows.length} rows`)
    return rows
  } catch (error) {
    manifest.fundamentals.eiaStorage.push({
      status: 'failed',
      error: error.message,
      url: url.toString().replace(eiaApiKey, 'REDACTED'),
    })
    console.warn(`eia storage failed: ${error.message}`)
    return []
  }
}

async function backfillMarketStorage(manifest, storageRows) {
  if (!storageRows.length) {
    manifest.fundamentals.marketStorageJoins.push({
      status: 'skipped',
      reason: 'No EIA storage rows were available.',
    })
    return
  }

  const sortedStorage = [...storageRows].sort((a, b) => a.date.localeCompare(b.date))
  const marketDir = path.join(dataRoot, 'market', 'yahoo')
  const files = ['UNG-qore-market.csv', 'NG-F-qore-market.csv']

  for (const file of files) {
    const filePath = path.join(marketDir, file)
    try {
      const rows = parseCsv(await readFile(filePath, 'utf8'))
      let storageIndex = 0
      let latestStorage = 0
      const joinedRows = rows.map((row) => {
        while (storageIndex < sortedStorage.length && sortedStorage[storageIndex].date <= row.date) {
          latestStorage = sortedStorage[storageIndex].storageBcf
          storageIndex += 1
        }
        return {
          ...row,
          storageBcf: latestStorage || row.storageBcf || 0,
        }
      })
      await writeCsv(filePath, joinedRows, ['date', 'open', 'high', 'low', 'close', 'volume', 'contract', 'storageBcf'])
      manifest.fundamentals.marketStorageJoins.push({
        status: 'ok',
        file: path.relative(repoDir, filePath),
        rows: joinedRows.length,
        storageRowsUsed: sortedStorage.length,
        firstStorageDate: sortedStorage[0]?.date,
        lastStorageDate: sortedStorage.at(-1)?.date,
      })
      console.log(`market storage joined: ${file}`)
    } catch (error) {
      manifest.fundamentals.marketStorageJoins.push({
        status: 'failed',
        file: path.relative(repoDir, filePath),
        error: error.message,
      })
      console.warn(`market storage join failed: ${file}: ${error.message}`)
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

  if (skipNasaPower) {
    manifest.weather.nasaPower.push({
      status: 'skipped',
      reason: 'QORE_SKIP_NASA_POWER is enabled; keeping existing NASA POWER files.',
    })
    return
  }

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

async function buildActualArcticBlastEvents(manifest) {
  const anomalyPath = path.join(dataRoot, 'weather', 'nasa-power', `daily-temperature-anomalies-${startDate}-${endDate}.csv`)
  const eventDir = path.join(dataRoot, 'weather', 'events')
  await ensureDir(eventDir)

  if (skipNasaPower) {
    manifest.weather.actualArcticBlastEvents.push({
      status: 'skipped',
      reason: 'QORE_SKIP_NASA_POWER is enabled; keeping existing actual arctic blast event files.',
    })
    return
  }

  let rows
  try {
    rows = parseCsv(await readFile(anomalyPath, 'utf8'))
  } catch (error) {
    manifest.weather.actualArcticBlastEvents.push({
      status: 'failed',
      error: `Could not read NASA anomaly file: ${error.message}`,
      file: path.relative(repoDir, anomalyPath),
    })
    return
  }

  const basketWeight = locations.reduce((sum, location) => sum + location.weight, 0)
  const rowsByDate = new Map()
  for (const row of rows) {
    rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row])
  }

  const dailyRows = Array.from(rowsByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => {
      const sampledWeight = dayRows.reduce((sum, row) => sum + Number(row.weight || 0), 0)
      const weightedAnomalyF = sampledWeight
        ? dayRows.reduce((sum, row) => sum + Number(row.anomalyF || 0) * Number(row.weight || 0), 0) / sampledWeight
        : 0
      const coldWeight = dayRows
        .filter((row) => Number(row.anomalyF) <= arcticBlastThresholds.coldAnomalyF)
        .reduce((sum, row) => sum + Number(row.weight || 0), 0)
      const coveragePct = basketWeight ? coldWeight / basketWeight : 0
      const extremeCount = dayRows.filter((row) => Number(row.anomalyF) <= arcticBlastThresholds.extremeAnomalyF).length
      const qualifies =
        weightedAnomalyF <= arcticBlastThresholds.coldAnomalyF &&
        coveragePct >= arcticBlastThresholds.minCoveragePct

      return {
        date,
        weightedAnomalyF: round(weightedAnomalyF, 2),
        coveragePct: round(coveragePct, 3),
        extremeCount,
        sampledWeight: round(sampledWeight, 3),
        locationCount: dayRows.length,
        heatingSeason: isHeatingSeason(date),
        qualifies,
        source: 'NASA POWER actual anomaly basket',
      }
    })

  function eventRowsFor(dayRows, prefix) {
    const events = []
    let current = null

    for (const row of dayRows) {
      if (!row.qualifies) {
        if (current) events.push(current)
        current = null
        continue
      }

      if (!current) {
        current = {
          eventId: `${prefix}-${events.length + 1}`,
          startDate: row.date,
          endDate: row.date,
          peakDate: row.date,
          minWeightedAnomalyF: row.weightedAnomalyF,
          maxCoveragePct: row.coveragePct,
          qualifyingDays: 1,
          source: 'NASA POWER actual anomaly basket',
        }
        continue
      }

      current.endDate = row.date
      current.qualifyingDays += 1
      if (row.weightedAnomalyF < current.minWeightedAnomalyF) {
        current.minWeightedAnomalyF = row.weightedAnomalyF
        current.peakDate = row.date
      }
      current.maxCoveragePct = Math.max(current.maxCoveragePct, row.coveragePct)
    }

    if (current) events.push(current)
    return events
  }

  const events = eventRowsFor(dailyRows, 'actual-cold')
  const heatingEvents = eventRowsFor(
    dailyRows.map((row) => ({
      ...row,
      qualifies: row.qualifies && row.heatingSeason,
    })),
    'actual-heating-cold',
  )

  function windowRowsFor(events) {
    return events.flatMap((event) => [
      {
        eventId: event.eventId,
        windowId: 'rumor',
        startDate: addDays(event.startDate, -10),
        endDate: addDays(event.startDate, -7),
        tradeQuestion: 'Did broad 7-10 day forecast cold bid UNG before the event?',
      },
      {
        eventId: event.eventId,
        windowId: 'selloff',
        startDate: addDays(event.startDate, -3),
        endDate: addDays(event.startDate, -1),
        tradeQuestion: 'Did UNG fade in the 1-3 day buy-the-rumor/sell-the-news window?',
      },
      {
        eventId: event.eventId,
        windowId: 'event',
        startDate: event.startDate,
        endDate: event.endDate,
        tradeQuestion: 'What happened while the actual cold event was present?',
      },
    ])
  }

  const windows = windowRowsFor(events)
  const heatingWindows = windowRowsFor(heatingEvents)

  const dailyPath = path.join(eventDir, `arctic-blast-actual-daily-${startDate}-${endDate}.csv`)
  const eventsPath = path.join(eventDir, `arctic-blast-actual-events-${startDate}-${endDate}.csv`)
  const windowsPath = path.join(eventDir, `arctic-blast-trade-windows-${startDate}-${endDate}.csv`)
  const heatingEventsPath = path.join(eventDir, `arctic-blast-heating-season-events-${startDate}-${endDate}.csv`)
  const heatingWindowsPath = path.join(eventDir, `arctic-blast-heating-season-trade-windows-${startDate}-${endDate}.csv`)
  await writeCsv(dailyPath, dailyRows, [
    'date',
    'weightedAnomalyF',
    'coveragePct',
    'extremeCount',
    'sampledWeight',
    'locationCount',
    'heatingSeason',
    'qualifies',
    'source',
  ])
  await writeCsv(eventsPath, events, [
    'eventId',
    'startDate',
    'endDate',
    'peakDate',
    'minWeightedAnomalyF',
    'maxCoveragePct',
    'qualifyingDays',
    'source',
  ])
  await writeCsv(windowsPath, windows, ['eventId', 'windowId', 'startDate', 'endDate', 'tradeQuestion'])
  await writeCsv(heatingEventsPath, heatingEvents, [
    'eventId',
    'startDate',
    'endDate',
    'peakDate',
    'minWeightedAnomalyF',
    'maxCoveragePct',
    'qualifyingDays',
    'source',
  ])
  await writeCsv(heatingWindowsPath, heatingWindows, ['eventId', 'windowId', 'startDate', 'endDate', 'tradeQuestion'])
  manifest.weather.actualArcticBlastEvents.push({
    status: 'ok',
    dailyRows: dailyRows.length,
    eventRows: events.length,
    windowRows: windows.length,
    heatingSeasonEventRows: heatingEvents.length,
    heatingSeasonWindowRows: heatingWindows.length,
    files: [dailyPath, eventsPath, windowsPath, heatingEventsPath, heatingWindowsPath].map((file) => path.relative(repoDir, file)),
  })
  console.log(`actual arctic events ok: ${events.length} events, ${heatingEvents.length} heating-season events`)
}

async function collectNormals(manifest) {
  const normalDir = path.join(dataRoot, 'weather', 'open-meteo', 'normals')
  await ensureDir(normalDir)
  let failures = 0

  if (skipOpenMeteo) {
    manifest.weather.normals.push({
      status: 'skipped',
      reason: 'QORE_SKIP_OPEN_METEO is enabled.',
    })
    return
  }

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

  if (skipOpenMeteo) {
    manifest.weather.historicalForecasts.push({
      status: 'skipped',
      reason: 'QORE_SKIP_OPEN_METEO is enabled.',
    })
    return
  }

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

  if (skipOpenMeteo) {
    manifest.weather.singleRuns.push({
      status: 'skipped',
      reason: 'QORE_SKIP_OPEN_METEO is enabled.',
    })
    return
  }

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

  if (skipOpenMeteo) {
    manifest.weather.previousRuns.push({
      status: 'skipped',
      reason: 'QORE_SKIP_OPEN_METEO is enabled.',
    })
    return
  }

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
  const profile = process.env.QORE_COLLECT_PROFILE ?? 'arctic-blast-history'
  const previousManifest = await maybeReadPreviousManifest()
  const defaultSharedDataRoot = path.join(repoDir, 'data', 'qore')
  const sharedDataRoot = path.resolve(dataRoot) === path.resolve(defaultSharedDataRoot)
  const manifest = {
    generatedAt: new Date().toISOString(),
    profile,
    dataRoot: path.relative(repoDir, dataRoot),
    sourceNote: sharedDataRoot
      ? 'No-key/free data only. Files are shared research artifacts under data/qore.'
      : 'No-key/free data only. Files are private scratch cache artifacts outside the shared data/qore root.',
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
    fundamentals: {
      eiaStorage: [],
      marketStorageJoins: [],
    },
    weather: {
      locationsFile: path.relative(repoDir, await collectLocationCsv()),
      nasaPower: [],
      nasaPowerAnomalyFile: null,
      nasaPowerAnomalyRows: 0,
      normals: [],
      historicalForecasts: [],
      singleRuns: [],
      previousRuns: [],
      actualArcticBlastEvents: [],
    },
  }

  await collectYahooMarket(manifest)
  await deriveMarketIndexBasket(manifest)
  const storageRows = await collectEiaStorage(manifest)
  await backfillMarketStorage(manifest, storageRows)
  await collectNasaPowerTemperatures(manifest)
  await buildActualArcticBlastEvents(manifest)
  await collectNormals(manifest)
  await collectHistoricalForecasts(manifest)
  await collectSingleRuns(manifest)
  await collectPreviousRuns(manifest)

  const failedSources = []
  const visit = (value, trail = []) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...trail, index]))
      return
    }
    if (!value || typeof value !== 'object') return
    if (value.status === 'failed') {
      failedSources.push({
        path: trail.join('.'),
        error: value.error ?? 'Source refresh failed without an error message.',
      })
    }
    for (const [key, child] of Object.entries(value)) visit(child, [...trail, key])
  }
  visit(manifest)
  manifest.refreshSummary = {
    failedSourceCount: failedSources.length,
    failedSources,
    failOnDataFailure,
  }

  const manifestPath = path.join(dataRoot, 'runs', 'free-data-manifest.json')
  await writeJson(manifestPath, manifest)
  console.log(`manifest written: ${path.relative(repoDir, manifestPath)}`)
  if (failOnDataFailure && failedSources.length) {
    throw new Error(`Free-data refresh had ${failedSources.length} failed source request(s); see ${path.relative(repoDir, manifestPath)}.`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
