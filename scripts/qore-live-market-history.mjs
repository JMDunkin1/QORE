#!/usr/bin/env node
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadLocalEnv } from './local-env.mjs'
import { validateIndexBasketConfig } from './lib/qore-index-basket.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const targetDate = process.env.QORE_LIVE_MARKET_HISTORY_DATE
  ?? process.env.QORE_LIVE_INFERENCE_DATE
  ?? new Date().toISOString().slice(0, 10)
const stateDir = path.resolve(
  process.env.QORE_LIVE_MARKET_HISTORY_STATE_DIR
    ?? path.join(repoDir, '.local', 'qore', 'live-market-history'),
)
const indexBasketConfigPath = path.resolve(
  process.env.QORE_INDEX_BASKET_CONFIG ?? path.join(repoDir, 'data', 'qore', 'market', 'index-basket-config.json'),
)
const lookbackDays = Number(process.env.QORE_LIVE_MARKET_HISTORY_LOOKBACK_DAYS ?? 270)
const fetchTimeoutMs = Number(
  process.env.QORE_LIVE_MARKET_HISTORY_FETCH_TIMEOUT_MS
    ?? process.env.QORE_LIVE_INFERENCE_FETCH_TIMEOUT_MS
    ?? 45_000,
)
const configuredBaseUrl = process.env.QORE_LIVE_MARKET_HISTORY_YAHOO_BASE_URL
const yahooBaseUrl = configuredBaseUrl ?? 'https://query2.finance.yahoo.com/v8/finance/chart'
const minimumSessions = 42
const symbols = ['NG=F', 'UNG', 'VOO', 'QQQM']

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
}

function addDays(date, count) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10)
}

function dateFromEpoch(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows) {
  const headers = ['date', 'open', 'high', 'low', 'close', 'volume', 'contract', 'storageBcf']
  return `${[headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')}\n`
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, content, { mode: 0o600 })
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

async function fetchYahooDaily(symbol) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs)
  const url = new URL(`${yahooBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(symbol)}`)
  url.searchParams.set('period1', String(Math.floor(Date.parse(`${addDays(targetDate, -lookbackDays)}T00:00:00Z`) / 1000)))
  url.searchParams.set('period2', String(Math.floor(Date.parse(`${addDays(targetDate, 1)}T00:00:00Z`) / 1000)))
  url.searchParams.set('interval', '1d')
  url.searchParams.set('events', 'history')
  url.searchParams.set('includeAdjustedClose', 'true')
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'QORE live market-history collector' },
      redirect: 'error',
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok) throw new Error(`Yahoo ${symbol} request failed with HTTP ${response.status}: ${body.slice(0, 180)}`)
    const payload = JSON.parse(body)
    const result = payload.chart?.result?.[0]
    const quote = result?.indicators?.quote?.[0]
    const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? []
    const timestamps = result?.timestamp ?? []
    if (!result || !quote || !timestamps.length) throw new Error(`Yahoo ${symbol} response did not include daily bars.`)
    const rows = timestamps.map((timestamp, index) => ({
      date: dateFromEpoch(timestamp),
      open: Number(quote.open?.[index]),
      high: Number(quote.high?.[index]),
      low: Number(quote.low?.[index]),
      close: Number(adjusted[index] ?? quote.close?.[index]),
      volume: Number(quote.volume?.[index]),
      contract: symbol,
      storageBcf: 0,
    })).filter((row) => row.date < targetDate
      && Number.isFinite(row.open) && row.open > 0
      && Number.isFinite(row.high) && row.high > 0
      && Number.isFinite(row.low) && row.low > 0
      && Number.isFinite(row.close) && row.close > 0)
      .sort((left, right) => left.date.localeCompare(right.date))
    const seen = new Set()
    for (const row of rows) {
      if (seen.has(row.date)) throw new Error(`Yahoo ${symbol} response contains duplicate date ${row.date}.`)
      seen.add(row.date)
    }
    if (rows.length < minimumSessions) {
      throw new Error(`Yahoo ${symbol} returned only ${rows.length} completed sessions before ${targetDate}; at least ${minimumSessions} are required.`)
    }
    return rows
  } finally {
    clearTimeout(timeout)
  }
}

function deriveIndexBasket(rowsBySymbol, indexBasketConfig) {
  if (indexBasketConfig.symbol !== 'US-INDEX-BASKET') {
    throw new Error('Live market history requires the reviewed US-INDEX-BASKET configuration.')
  }
  const components = validateIndexBasketConfig(indexBasketConfig, {
    source: path.relative(repoDir, indexBasketConfigPath),
  }).components
  const maps = new Map(components.map(({ symbol }) => [symbol, new Map(rowsBySymbol.get(symbol).map((row) => [row.date, row]))]))
  const vooDates = new Set(maps.get('VOO').keys())
  const qqqmDates = new Set(maps.get('QQQM').keys())
  const componentDateMismatch = [
    ...[...vooDates].filter((date) => !qqqmDates.has(date)),
    ...[...qqqmDates].filter((date) => !vooDates.has(date)),
  ].sort()
  if (componentDateMismatch.length) {
    throw new Error(`VOO/QQQM completed-session calendars differ on: ${componentDateMismatch.join(', ')}.`)
  }
  const commonDates = components.map(({ symbol }) => new Set(maps.get(symbol).keys()))
    .reduce((dates, current) => new Set([...dates].filter((date) => current.has(date))))
  const dates = [...commonDates].sort()
  if (dates.length < minimumSessions) {
    throw new Error(`VOO/QQQM returned only ${dates.length} common completed sessions before ${targetDate}; at least ${minimumSessions} are required.`)
  }
  for (const { symbol } of components) {
    const latest = rowsBySymbol.get(symbol).at(-1)?.date ?? null
    if (latest !== dates.at(-1)) {
      throw new Error(`${symbol} latest completed date ${latest ?? 'none'} does not match the latest common VOO/QQQM date ${dates.at(-1)}.`)
    }
  }
  let close = 100
  return dates.map((date, index) => {
    if (index > 0) {
      const priorDate = dates[index - 1]
      const dailyReturn = components.reduce((sum, component) => {
        const current = maps.get(component.symbol).get(date).close
        const prior = maps.get(component.symbol).get(priorDate).close
        return sum + component.targetWeight * (current / prior - 1)
      }, 0)
      close *= 1 + dailyReturn
    }
    const volume = components.reduce((sum, component) => sum + (maps.get(component.symbol).get(date).volume || 0), 0)
    return { date, open: close, high: close, low: close, close, volume, contract: indexBasketConfig.symbol, storageBcf: 0 }
  })
}

async function main() {
  if (!validDate(targetDate)) throw new Error(`QORE_LIVE_MARKET_HISTORY_DATE must be YYYY-MM-DD; received ${targetDate}.`)
  if (!Number.isInteger(lookbackDays) || lookbackDays < 90 || lookbackDays > 730) {
    throw new Error(`QORE_LIVE_MARKET_HISTORY_LOOKBACK_DAYS must be an integer from 90 through 730; received ${lookbackDays}.`)
  }
  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs < 1_000 || fetchTimeoutMs > 120_000) {
    throw new Error(`QORE_LIVE_MARKET_HISTORY_FETCH_TIMEOUT_MS must be from 1000 through 120000; received ${fetchTimeoutMs}.`)
  }
  if (
    configuredBaseUrl
    && !(
      process.env.NODE_ENV === 'test'
      && process.env.QORE_TEST_LIVE_INFERENCE_OVERRIDES === '1'
    )
  ) {
    throw new Error('QORE_LIVE_MARKET_HISTORY_YAHOO_BASE_URL is restricted to the explicit reviewed test-input capability.')
  }
  const indexBasketConfig = JSON.parse(await readFile(indexBasketConfigPath, 'utf8'))
  const rowsBySymbol = new Map(await Promise.all(
    symbols.map(async (symbol) => [symbol, await fetchYahooDaily(symbol)]),
  ))
  const indexRows = deriveIndexBasket(rowsBySymbol, indexBasketConfig)
  const authoritativeDates = indexRows.slice(-minimumSessions).map((row) => row.date)
  for (const symbol of ['NG=F', 'UNG']) {
    const availableDates = new Set(rowsBySymbol.get(symbol).map((row) => row.date))
    const missingDates = authoritativeDates.filter((date) => !availableDates.has(date))
    if (missingDates.length) {
      throw new Error(`${symbol} is missing authoritative VOO/QQQM session(s): ${missingDates.join(', ')}.`)
    }
  }
  const outputRows = new Map([
    ['NG-F-qore-market.csv', rowsBySymbol.get('NG=F')],
    ['UNG-qore-market.csv', rowsBySymbol.get('UNG')],
    ['VOO-qore-market.csv', rowsBySymbol.get('VOO')],
    ['QQQM-qore-market.csv', rowsBySymbol.get('QQQM')],
    ['US-INDEX-BASKET-qore-market.csv', indexRows],
  ])
  const manifest = {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-live-market-history',
    targetDate,
    completedSessionCutoffExclusive: targetDate,
    lookbackDays,
    source: 'Yahoo chart API',
    methodology: `Adjusted daily closes; ${indexBasketConfig.symbol} uses the reviewed daily target-weight VOO/QQQM configuration.`,
    indexBasket: {
      symbol: indexBasketConfig.symbol,
      components: indexBasketConfig.components.map((component) => ({
        symbol: component.symbol,
        targetWeight: Number(component.targetWeight),
      })),
    },
    authoritativeSessionSource: 'Common completed VOO/QQQM daily bars',
    authoritativeSessionsValidated: authoritativeDates.length,
    series: [...outputRows.entries()].map(([file, rows]) => ({
      symbol: rows[0]?.contract ?? null,
      file: path.relative(repoDir, path.join(stateDir, file)),
      rows: rows.length,
      firstDate: rows[0]?.date ?? null,
      latestDate: rows.at(-1)?.date ?? null,
    })),
  }
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  for (const [file, rows] of outputRows) await writeAtomic(path.join(stateDir, file), rowsToCsv(rows))
  await writeAtomic(path.join(stateDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`live-market-history target=${targetDate} latest=${indexRows.at(-1).date} sessions=${indexRows.length} dir=${path.relative(repoDir, stateDir)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
