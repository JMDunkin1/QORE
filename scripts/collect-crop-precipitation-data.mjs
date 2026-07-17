#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './local-env.mjs'

const REPO_ROOT = process.cwd()
loadLocalEnv(REPO_ROOT)

const DATA_ROOT = process.env.QORE_DATA_ROOT ?? path.join(REPO_ROOT, 'data', 'qore')
const CONFIG_FILE = process.env.QORE_CROP_PRECIP_CONFIG ?? path.join(REPO_ROOT, 'config', 'crop-weather-soy-corn.json')
const INDEX_BASKET_CONFIG_FILE = process.env.QORE_INDEX_BASKET_CONFIG ?? path.join(REPO_ROOT, 'data', 'qore', 'market', 'index-basket-config.json')
const WEATHER_DIR = path.join(DATA_ROOT, 'weather', 'crop-precipitation-hf')
const ACTUALS_DIR = path.join(WEATHER_DIR, 'actuals')
const MARKET_DIR = path.join(DATA_ROOT, 'market', 'yahoo')
const MANIFEST_FILE = path.join(WEATHER_DIR, 'collection-manifest.json')
const START_DATE = process.env.QORE_CROP_PRECIP_START ?? '1981-01-01'
const TODAY = new Date().toISOString().slice(0, 10)
const END_DATE = process.env.QORE_CROP_PRECIP_END ?? addDays(TODAY, -1)
const MARKET_COVERAGE_END = latestExpectedMarketSession(END_DATE)
const TIMEOUT_MS = Number(process.env.QORE_CROP_PRECIP_FETCH_TIMEOUT_MS ?? 60000)
const CONCURRENCY = Math.max(1, Number(process.env.QORE_CROP_PRECIP_CONCURRENCY ?? 4))
const FORCE = truthy(process.env.QORE_CROP_PRECIP_FORCE)
const FAIL_ON_DATA_FAILURE = process.env.QORE_FAIL_ON_DATA_FAILURE === undefined
  ? true
  : truthy(process.env.QORE_FAIL_ON_DATA_FAILURE)

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function observedFixedHoliday(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day))
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1)
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function nthWeekdayOfMonth(year, monthIndex, weekday, occurrence) {
  const date = new Date(Date.UTC(year, monthIndex, 1))
  date.setUTCDate(1 + ((weekday - date.getUTCDay() + 7) % 7) + (occurrence - 1) * 7)
  return date.toISOString().slice(0, 10)
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekday + 7) % 7))
  return date.toISOString().slice(0, 10)
}

function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

function marketHolidaysForYear(year) {
  const holidays = new Set([
    observedFixedHoliday(year, 0, 1),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    addDays(easterSunday(year), -2),
    lastWeekdayOfMonth(year, 4, 1),
    observedFixedHoliday(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ])
  if (year >= 2022) holidays.add(observedFixedHoliday(year, 5, 19))
  return holidays
}

function isExpectedMarketSession(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`)
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const year = date.getUTCFullYear()
  // New Year's Day can be observed in the preceding calendar year.
  return ![year, year + 1].some((holidayYear) => marketHolidaysForYear(holidayYear).has(dateText))
}

export function latestExpectedMarketSession(endDate) {
  let date = endDate
  while (!isExpectedMarketSession(date)) date = addDays(date, -1)
  return date
}

function compactDate(dateText) {
  return dateText.replaceAll('-', '')
}

function isoFromCompact(dateText) {
  return `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`
}

function dateFromEpoch(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

function safeSymbol(symbol) {
  return symbol.replace(/[^A-Za-z0-9]/g, '-')
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return `${[headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')}\n`
}

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (character === '"') quoted = !quoted
    else if (character === ',' && !quoted) {
      values.push(value)
      value = ''
    } else value += character
  }
  values.push(value)
  return values
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  const headers = parseCsvLine(lines[0] ?? '')
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

async function ensureDir(directory) {
  await mkdir(directory, { recursive: true })
}

async function fetchJson(url, attempt = 1) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'QORE crop precipitation research collector' },
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`)
    const parsed = JSON.parse(text)
    if (parsed?.error) throw new Error(parsed?.messages?.join('; ') ?? JSON.stringify(parsed.error))
    return parsed
  } catch (error) {
    if (attempt >= 3) throw error
    await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    return fetchJson(url, attempt + 1)
  } finally {
    clearTimeout(timeout)
  }
}

async function cachedCsv(filePath) {
  try {
    const text = await readFile(filePath, 'utf8')
    const rows = parseCsv(text)
    if (!rows.length || rows.some((row) => !row.date)) return null
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index].date <= rows[index - 1].date) return null
    }
    return { text, rows, firstDate: rows[0].date, lastDate: rows.at(-1).date }
  } catch {
    return null
  }
}

export function marketCacheCovers(rows, endDate) {
  return Boolean(rows.length && rows.at(-1).date >= endDate)
}

export function yahooHistorySource(symbol) {
  return symbol.endsWith('=F')
    ? 'Yahoo chart API continuous-futures proxy'
    : 'Yahoo chart API ETF history'
}

export function appendMarketTail(existingRows, fetchedRows) {
  const lastCachedDate = existingRows.at(-1)?.date ?? ''
  const rowsByDate = new Map(existingRows.map((row) => [row.date, row]))
  for (const row of fetchedRows) {
    if (row.date >= lastCachedDate) rowsByDate.set(row.date, row)
  }
  return [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export function reconcileAdjustedMarketTail(existingRows, fetchedRows) {
  if (existingRows.length < 2 || !fetchedRows.length) return appendMarketTail(existingRows, fetchedRows)
  // Yahoo revises every earlier adjusted close after a distribution or split.
  // Anchor the refreshed tail to the penultimate cached session so those
  // revisions cannot create a discontinuity at the append boundary, while the
  // latest (potentially preliminary) cached bar can still be replaced.
  const anchor = existingRows.at(-2)
  const refreshedAnchor = fetchedRows.find((row) => row.date === anchor.date)
  if (!refreshedAnchor) throw new Error(`Yahoo refresh omitted adjustment anchor ${anchor.date}.`)
  const cachedAdjusted = Number(anchor.adjustedClose || anchor.close)
  const refreshedAdjusted = Number(refreshedAnchor.adjustedClose || refreshedAnchor.close)
  if (!(cachedAdjusted > 0) || !(refreshedAdjusted > 0)) {
    throw new Error(`Yahoo refresh has an invalid adjustment anchor on ${anchor.date}.`)
  }
  const adjustmentBasis = cachedAdjusted / refreshedAdjusted
  const normalizedRows = fetchedRows.map((row) => ({
    ...row,
    adjustedClose: Number(row.adjustedClose || row.close) * adjustmentBasis,
  }))
  return appendMarketTail(existingRows, normalizedRows)
}

export function cappedCoverageEnd(coverageEnd, requestedEnd) {
  if (!coverageEnd) return null
  return coverageEnd < requestedEnd ? coverageEnd : requestedEnd
}

async function weatherCacheState(filePath, startDate, endDate) {
  if (FORCE) return null
  const cached = await cachedCsv(filePath)
  if (!cached || cached.firstDate !== startDate || cached.lastDate < endDate) return null
  const header = cached.text.split(/\r?\n/, 1)[0]
  return header.includes('precipitationMm') && header.includes('temperatureC') && header.includes('maxTemperatureC')
    ? cached
    : null
}

async function collectWeatherSite(crop, site) {
  const outputFile = path.join(ACTUALS_DIR, `${site.id}.csv`)
  const cached = await weatherCacheState(outputFile, START_DATE, END_DATE)
  if (cached) {
    return {
      status: 'cached',
      cropId: crop.id,
      siteId: site.id,
      rows: cached.rows.length,
      firstDate: cached.firstDate,
      lastDate: cached.lastDate,
      file: path.relative(REPO_ROOT, outputFile),
    }
  }

  const params = new URLSearchParams({
    parameters: 'PRECTOTCORR,T2M,T2M_MAX',
    community: 'AG',
    longitude: String(site.longitude),
    latitude: String(site.latitude),
    start: compactDate(START_DATE),
    end: compactDate(END_DATE),
    format: 'JSON',
    'time-standard': 'UTC',
  })
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${params}`
  const json = await fetchJson(url)
  const precipitation = json?.properties?.parameter?.PRECTOTCORR
  const temperature = json?.properties?.parameter?.T2M
  const maxTemperature = json?.properties?.parameter?.T2M_MAX
  if (!precipitation || !temperature || !maxTemperature) throw new Error('NASA POWER response did not include PRECTOTCORR, T2M, and T2M_MAX values.')

  const rows = Object.entries(precipitation)
    .map(([date, value]) => ({
      date: isoFromCompact(date),
      precipitationMm: Number(value),
      temperatureC: Number(temperature[date]),
      maxTemperatureC: Number(maxTemperature[date]),
      siteId: site.id,
      cropId: crop.id,
      latitude: site.latitude,
      longitude: site.longitude,
      source: 'NASA POWER MERRA-2 PRECTOTCORR T2M T2M_MAX',
    }))
    .filter((row) => Number.isFinite(row.precipitationMm) && row.precipitationMm > -900
      && Number.isFinite(row.temperatureC) && row.temperatureC > -900
      && Number.isFinite(row.maxTemperatureC) && row.maxTemperatureC > -900)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!rows.length) throw new Error('NASA POWER returned no usable precipitation observations.')
  await ensureDir(path.dirname(outputFile))
  await writeFile(
    outputFile,
    rowsToCsv(rows, ['date', 'precipitationMm', 'temperatureC', 'maxTemperatureC', 'siteId', 'cropId', 'latitude', 'longitude', 'source']),
  )
  return {
    status: 'ok',
    cropId: crop.id,
    siteId: site.id,
    rows: rows.length,
    firstDate: rows[0].date,
    lastDate: rows.at(-1).date,
    file: path.relative(REPO_ROOT, outputFile),
    requestUrl: url,
  }
}

async function collectMarketSymbol(symbol, label) {
  const outputFile = path.join(MARKET_DIR, `${safeSymbol(symbol)}-daily.csv`)
  const cached = FORCE ? null : await cachedCsv(outputFile)
  // Re-request one finalized overlap session plus the latest cached session.
  // The overlap reconciles Yahoo's revised adjusted-close basis, while the
  // latest session remains refreshable if its first bar was preliminary.
  const fetchStart = cached ? (cached.rows.at(-2)?.date ?? cached.lastDate) : START_DATE
  const period1 = Math.floor(new Date(`${fetchStart}T00:00:00Z`).getTime() / 1000)
  const requestedPeriod2 = addDays(END_DATE, 1)
  const period2Date = requestedPeriod2 > fetchStart ? requestedPeriod2 : addDays(fetchStart, 1)
  const period2 = Math.floor(new Date(`${period2Date}T00:00:00Z`).getTime() / 1000)
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`
  const json = await fetchJson(url)
  const result = json?.chart?.result?.[0]
  const quote = result?.indicators?.quote?.[0]
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? []
  const timestamps = result?.timestamp ?? []
  if (!quote || !timestamps.length) {
    if (cached && marketCacheCovers(cached.rows, MARKET_COVERAGE_END)) {
      return {
        status: 'cached', symbol, label, rows: cached.rows.length,
        firstDate: cached.firstDate, lastDate: cached.lastDate,
        file: path.relative(REPO_ROOT, outputFile), requestUrl: url,
      }
    }
    if (cached) {
      throw new Error(`Yahoo returned no daily bars and the ${symbol} cache ends ${cached.lastDate}, before the expected market session ${MARKET_COVERAGE_END}.`)
    }
    throw new Error(json?.chart?.error?.description ?? 'Yahoo returned no daily bars.')
  }

  const fetchedRows = timestamps
    .map((timestamp, index) => ({
      date: dateFromEpoch(timestamp),
      open: quote.open?.[index] ?? '',
      high: quote.high?.[index] ?? '',
      low: quote.low?.[index] ?? '',
      close: quote.close?.[index] ?? '',
      adjustedClose: adjusted[index] ?? quote.close?.[index] ?? '',
      volume: quote.volume?.[index] ?? '',
      symbol,
      source: yahooHistorySource(symbol),
    }))
    .filter((row) => [row.open, row.high, row.low, row.close, row.adjustedClose]
      .every((value) => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0))
  if (!fetchedRows.length && !cached) throw new Error('Yahoo returned no complete daily bars.')
  const rows = reconcileAdjustedMarketTail(cached?.rows ?? [], fetchedRows)
  if (!rows.length) throw new Error('Yahoo returned no complete daily bars.')
  if (!marketCacheCovers(rows, MARKET_COVERAGE_END)) {
    throw new Error(`Yahoo market history for ${symbol} ends ${rows.at(-1).date}, before the expected market session ${MARKET_COVERAGE_END}.`)
  }
  await ensureDir(path.dirname(outputFile))
  const headers = ['date', 'open', 'high', 'low', 'close', 'adjustedClose', 'volume', 'symbol', 'source']
  if (!cached || fetchedRows.some((row) => row.date >= cached.lastDate)) {
    await writeFile(
      outputFile,
      rowsToCsv(rows, headers),
    )
  }
  return {
    status: 'ok',
    symbol,
    label,
    rows: rows.length,
    firstDate: rows[0].date,
    lastDate: rows.at(-1).date,
    file: path.relative(REPO_ROOT, outputFile),
    requestUrl: url,
  }
}

async function buildIndexBasket(basketConfig) {
  const components = basketConfig.components ?? []
  const totalWeight = components.reduce((sum, component) => sum + Number(component.targetWeight ?? 0), 0)
  if (!components.length || totalWeight <= 0) throw new Error('Index basket config requires positive component weights.')
  const normalized = components.map((component) => ({ ...component, targetWeight: Number(component.targetWeight) / totalWeight }))
  const componentRows = []
  for (const component of normalized) {
    const filePath = path.join(MARKET_DIR, `${safeSymbol(component.symbol)}-daily.csv`)
    const rows = parseCsv(await readFile(filePath, 'utf8'))
      .map((row) => ({ date: row.date, close: Number(row.adjustedClose || row.close), volume: Number(row.volume || 0) }))
      .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    componentRows.push({ ...component, rowsByDate: new Map(rows.map((row) => [row.date, row])) })
  }
  const commonDates = [...componentRows[0].rowsByDate.keys()]
    .filter((date) => componentRows.every((component) => component.rowsByDate.has(date)))
    .sort()
  if (commonDates.length < 2) throw new Error('Index basket components have no usable common history.')
  let close = 100
  const rows = commonDates.map((date, index) => {
    if (index > 0) {
      const priorDate = commonDates[index - 1]
      const dailyReturn = componentRows.reduce((sum, component) => {
        const current = component.rowsByDate.get(date).close
        const prior = component.rowsByDate.get(priorDate).close
        return sum + component.targetWeight * (current / prior - 1)
      }, 0)
      close *= 1 + dailyReturn
    }
    const volume = componentRows.reduce((sum, component) => sum + component.rowsByDate.get(date).volume, 0)
    return { date, open: close, high: close, low: close, close, volume, contract: basketConfig.symbol, storageBcf: 0 }
  })
  const outputFile = path.join(MARKET_DIR, `${basketConfig.symbol}-qore-market.csv`)
  await writeFile(outputFile, rowsToCsv(rows, ['date', 'open', 'high', 'low', 'close', 'volume', 'contract', 'storageBcf']))
  return {
    status: 'ok',
    symbol: basketConfig.symbol,
    label: basketConfig.label,
    rows: rows.length,
    firstDate: rows[0].date,
    lastDate: rows.at(-1).date,
    file: path.relative(REPO_ROOT, outputFile),
    source: 'Daily target-weight returns from Yahoo adjusted-close component histories',
    rebalance: basketConfig.rebalance,
    components: normalized.map((component) => ({ symbol: component.symbol, targetWeight: component.targetWeight })),
  }
}

async function buildConfiguredBasket(basketConfig) {
  for (const component of basketConfig.components ?? []) {
    const existing = await collectMarketSymbol(component.symbol, component.label)
    if (existing.status === 'failed') throw new Error(`Could not collect ${component.symbol} for ${basketConfig.symbol}.`)
  }
  return buildIndexBasket(basketConfig)
}

async function mapConcurrent(items, worker, concurrency) {
  const results = new Array(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await worker(items[index])
      } catch (error) {
        results[index] = { ...items[index].identity, status: 'failed', error: error.message }
      }
      const result = results[index]
      console.log(`${result.status}: ${result.cropId ? `${result.cropId}/` : ''}${result.siteId ?? result.symbol}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'))
  const indexBasketConfig = JSON.parse(await readFile(INDEX_BASKET_CONFIG_FILE, 'utf8'))
  await ensureDir(ACTUALS_DIR)
  await ensureDir(MARKET_DIR)

  const weatherJobs = config.crops.flatMap((crop) => crop.sites.map((site) => ({
    crop,
    site,
    identity: { cropId: crop.id, siteId: site.id },
  })))
  const weather = await mapConcurrent(weatherJobs, (job) => collectWeatherSite(job.crop, job.site), CONCURRENCY)

  const symbols = [
    ...config.crops.map((crop) => ({ symbol: crop.symbol, label: crop.label })),
    { symbol: config.benchmarkSymbol, label: 'Diversified agriculture benchmark' },
    ...indexBasketConfig.components.map((component) => ({ symbol: component.symbol, label: component.label })),
    ...(config.researchProxyBasket?.components ?? []).map((component) => ({ symbol: component.symbol, label: component.label })),
  ]
  const uniqueSymbols = [...new Map(symbols.map((item) => [item.symbol, item])).values()]
  const market = await mapConcurrent(
    uniqueSymbols.map((item) => ({ ...item, identity: { symbol: item.symbol } })),
    (item) => collectMarketSymbol(item.symbol, item.label),
    Math.min(CONCURRENCY, 3),
  )
  try {
    const basket = await buildIndexBasket(indexBasketConfig)
    market.push(basket)
    console.log(`ok: ${basket.symbol}`)
  } catch (error) {
    market.push({ status: 'failed', symbol: indexBasketConfig.symbol, error: error.message })
    console.log(`failed: ${indexBasketConfig.symbol}`)
  }
  if (config.researchProxyBasket) {
    try {
      const basket = await buildConfiguredBasket(config.researchProxyBasket)
      market.push(basket)
      console.log(`ok: ${basket.symbol}`)
    } catch (error) {
      market.push({ status: 'failed', symbol: config.researchProxyBasket.symbol, error: error.message })
      console.log(`failed: ${config.researchProxyBasket.symbol}`)
    }
  }

  const weatherCoverageEnd = weather
    .filter((item) => item.status !== 'failed' && item.lastDate)
    .reduce((commonEnd, item) => commonEnd === null || item.lastDate < commonEnd ? item.lastDate : commonEnd, null)
  const manifest = {
    generatedAt: new Date().toISOString(),
    status: [...weather, ...market].some((item) => item.status === 'failed') ? 'partial' : 'ok',
    request: { startDate: START_DATE, endDate: END_DATE },
    contract: {
      startDate: START_DATE,
      endDate: cappedCoverageEnd(weatherCoverageEnd, END_DATE),
      configFile: path.relative(REPO_ROOT, CONFIG_FILE),
      weatherSource: config.weatherSource,
      marketSource: config.marketSource,
      note: 'NASA POWER finalized precipitation and temperature are lagged discovery inputs, not historical forecast vintages. Yahoo continuous futures are preliminary price proxies, not contract-level roll backtests.',
    },
    counts: {
      crops: config.crops.length,
      sites: weather.length,
      weatherRows: weather.reduce((sum, item) => sum + (item.rows ?? 0), 0),
      marketSymbols: market.length,
      marketRows: market.reduce((sum, item) => sum + (item.rows ?? 0), 0),
      failures: [...weather, ...market].filter((item) => item.status === 'failed').length,
    },
    weather,
    market,
  }
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`manifest: ${path.relative(REPO_ROOT, MANIFEST_FILE)}`)
  console.log(`weather rows=${manifest.counts.weatherRows} market rows=${manifest.counts.marketRows} failures=${manifest.counts.failures}`)
  if (manifest.counts.failures && FAIL_ON_DATA_FAILURE) process.exitCode = 1
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main()
