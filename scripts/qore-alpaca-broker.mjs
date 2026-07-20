#!/usr/bin/env node
import crypto from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'
import { inspectGitWorkingTree } from './lib/qore-git-state.mjs'
import { liveInferenceProvenanceBlocks } from './lib/qore-live-inference-provenance.mjs'
import { resolveLiveWeatherPaths } from './lib/qore-live-paths.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const { stateDir, operatorStatePath } = resolveLiveWeatherPaths(repoDir)
const brokerDir = path.resolve(process.env.QORE_BROKER_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'broker'))
const signalIntentPath = path.resolve(process.env.QORE_LIVE_SIGNAL_INTENT_FILE ?? path.join(stateDir, 'signal-intent-reconcile.json'))
const marketReferencePath = path.resolve(process.env.QORE_LIVE_MARKET_REFERENCE_FILE ?? path.join(stateDir, 'market-reference-prices.json'))
const riskStatePath = path.resolve(process.env.QORE_LIVE_RISK_STATE_FILE ?? path.join(stateDir, 'risk-and-kill-switch-state.json'))
const brokerSnapshotPath = path.resolve(process.env.QORE_BROKER_ACCOUNT_SNAPSHOT_FILE ?? path.join(brokerDir, 'account-snapshot.json'))
const brokerStatusPath = path.resolve(process.env.QORE_BROKER_STATUS_FILE ?? path.join(brokerDir, 'status.json'))
const brokerAccountStatusPath = path.resolve(process.env.QORE_BROKER_ACCOUNT_STATUS_FILE ?? path.join(brokerDir, 'account-status.json'))
const brokerOrderLogPath = path.resolve(process.env.QORE_BROKER_ORDER_LOG_FILE ?? path.join(brokerDir, 'orders.jsonl'))
const brokerRiskLedgerPath = path.resolve(process.env.QORE_BROKER_RISK_LEDGER_FILE ?? path.join(brokerDir, 'risk-ledger.json'))
const brokerLockPath = path.resolve(process.env.QORE_BROKER_LOCK_FILE ?? path.join(brokerDir, 'operation.lock'))
const testNowFile = process.env.NODE_ENV === 'test' && process.env.QORE_TEST_NOW_FILE
  ? path.resolve(process.env.QORE_TEST_NOW_FILE)
  : null
const indexBasketConfigPath = path.join(repoDir, 'data', 'qore', 'market', 'index-basket-config.json')

const brokerMode = normalizeBrokerMode(argValue('--mode') ?? process.env.QORE_BROKER_MODE ?? (args.has('--live') ? 'live' : args.has('--paper') ? 'paper' : 'dry-run'))
const loop = args.has('--loop')
const statusOnly = args.has('--status')
const preflightOnly = args.has('--preflight-only')
const bootstrapRiskLedger = args.has('--bootstrap-risk-ledger')
const jsonOutput = args.has('--json')
const once = args.has('--once') || args.has('--reconcile') || (!loop && !statusOnly)
const loopIntervalMs = positiveNumber(process.env.QORE_BROKER_RECONCILE_INTERVAL_MS, 60_000)
const allocationPct = boundedNumber(process.env.QORE_LIVE_ACCOUNT_ALLOCATION_PCT, 100, 0, 100)
const minOrderUsd = positiveNumber(process.env.QORE_LIVE_MIN_ORDER_USD, 10)
const rebalanceDeadbandPct = boundedNumber(process.env.QORE_LIVE_REBALANCE_DEADBAND_PCT, 0.25, 0, 100)
const minCashBufferPct = boundedNumber(process.env.QORE_LIVE_MIN_CASH_BUFFER_PCT, 2, 0, 100)
const maxOrderUsd = optionalPositiveNumber(process.env.QORE_LIVE_MAX_ORDER_USD)
const fractionalOrders = !falsey(process.env.QORE_ALPACA_FRACTIONAL_ORDERS)
const allowShorts = truthy(process.env.QORE_ALPACA_ALLOW_SHORTS)
const allowHardToBorrow = truthy(process.env.QORE_ALPACA_ALLOW_HARD_TO_BORROW)
const allowStaleSignal = truthy(process.env.QORE_ALLOW_STALE_SIGNAL)
const allowOutsideMarketQueue = truthy(process.env.QORE_ALLOW_OUTSIDE_MARKET_QUEUE)
const replaceOpenOrders = truthy(process.env.QORE_ALPACA_REPLACE_OPEN_ORDERS)
const timeInForce = process.env.QORE_ALPACA_TIME_IN_FORCE ?? 'day'
const orderType = process.env.QORE_ALPACA_ORDER_TYPE ?? 'market'
const alpacaDataBaseUrl = (process.env.QORE_ALPACA_DATA_BASE_URL ?? 'https://data.alpaca.markets').replace(/\/$/, '')
const alpacaMarketDataFeed = process.env.QORE_ALPACA_MARKET_DATA_FEED ?? 'iex'
const alpacaRequestTimeoutMs = positiveNumber(process.env.QORE_ALPACA_REQUEST_TIMEOUT_MS, 15_000)
const maxQuoteAgeMinutes = positiveNumber(process.env.QORE_LIVE_MAX_QUOTE_AGE_MINUTES, 5)
const maxQuoteFutureSkewSeconds = positiveNumber(process.env.QORE_LIVE_MAX_QUOTE_FUTURE_SKEW_SECONDS, 5)
const maxClockAgeSeconds = positiveNumber(process.env.QORE_ALPACA_CLOCK_MAX_AGE_SECONDS, 30)
const maxClockFutureSkewSeconds = positiveNumber(process.env.QORE_ALPACA_CLOCK_MAX_FUTURE_SKEW_SECONDS, 5)
const maxRiskSnapshotAgeSeconds = positiveNumber(process.env.QORE_LIVE_MAX_RISK_SNAPSHOT_AGE_SECONDS, 15 * 60)
const maxRiskSnapshotFutureSkewSeconds = positiveNumber(process.env.QORE_LIVE_MAX_RISK_SNAPSHOT_FUTURE_SKEW_SECONDS, 30)
const maxDailyLossPct = positiveNumber(process.env.QORE_LIVE_MAX_DAILY_LOSS_PCT, 12)
const maxTrailingDrawdownPct = positiveNumber(process.env.QORE_LIVE_MAX_TRAILING_DRAWDOWN_PCT, 25)
const maxGrossExposurePct = positiveNumber(process.env.QORE_LIVE_MAX_GROSS_EXPOSURE_PCT, 100)
const alpacaPaperBaseUrl = 'https://paper-api.alpaca.markets'
const alpacaLiveBaseUrl = 'https://api.alpaca.markets'

const alpacaLiveRiskPolicy = {
  id: 'alpaca-live-etf-reconciler-v1',
  allowedInstruments: new Set(['UNG', 'VOO', 'QQQM']),
  maxConfidence: 1,
  minConfidence: 0,
  maxSignalAgeDays: 1,
  maxWeatherIssueAgeHours: 36,
  maxMarketDataAgeMinutes: 1440,
  maxStorageDataAgeDays: 10,
  maxAllowedSpreadBps: 75,
  maxQuoteAgeMinutes,
  maxQuoteFutureSkewSeconds,
  maxClockAgeSeconds,
  maxClockFutureSkewSeconds,
  maxRiskSnapshotAgeSeconds,
  maxRiskSnapshotFutureSkewSeconds,
  maxDailyLossPct,
  maxTrailingDrawdownPct,
  maxGrossExposurePct,
  minReferencePriceUsd: 1,
  minWeatherSourceCount: 2,
  minWeatherCoveragePct: 70,
  minWeatherDirectionalAccuracyPct: 52,
  requireFreshWeatherContext: true,
  requireStorageContext: true,
  requireMarketContext: true,
  requireAccountContext: true,
  requireOperatorContext: true,
}

const alpacaConfig = alpacaConnectionConfig(brokerMode)
const exposureSafetyAmounts = Symbol('qore-exposure-safety-amounts')
let activeBrokerLockRelease = null
let brokerShutdownStarted = false
let brokerMutationStarted = false
let brokerMutationOutcomeUncertain = false
let brokerLockRequiresManualCleanup = false

function argValue(name) {
  const inline = rawArgs.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = rawArgs.indexOf(name)
  return index >= 0 ? rawArgs[index + 1] : null
}

function normalizeBrokerMode(value) {
  const normalized = String(value ?? '').toLowerCase()
  if (['dry-run', 'paper', 'live'].includes(normalized)) return normalized
  throw new Error(`Unsupported QORE_BROKER_MODE "${value}". Use dry-run, paper, or live.`)
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function falsey(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value ?? '').toLowerCase())
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function optionalPositiveNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dateOrNull(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function ageDays(asOf, value) {
  const date = dateOrNull(value)
  return date ? (asOf.getTime() - date.getTime()) / 86400000 : null
}

function ageHours(asOf, value) {
  const days = ageDays(asOf, value)
  return days === null ? null : days * 24
}

function ageMinutes(asOf, value) {
  const hours = ageHours(asOf, value)
  return hours === null ? null : hours * 60
}

function clockSafetyBlocks(clock, label, asOf = currentTime()) {
  const blocks = []
  const isOpen = clock?.is_open ?? clock?.isOpen
  if (isOpen !== true) {
    const closedDetail = label.startsWith('Mutation-boundary')
      ? `Execution venue became closed; ${label} is_open is false.`
      : `Execution venue is closed; ${label} is_open is false.`
    blocks.push(
      typeof isOpen === 'boolean'
        ? closedDetail
        : `Alpaca market clock is unavailable; ${label} is_open is missing or not exactly true.`,
    )
  }
  const timestamp = dateOrNull(clock?.timestamp)
  const ageSeconds = timestamp ? (asOf.getTime() - timestamp.getTime()) / 1000 : null
  if (ageSeconds === null) {
    blocks.push(`${label} timestamp is missing or invalid.`)
  } else if (ageSeconds < -maxClockFutureSkewSeconds) {
    blocks.push(`${label} timestamp is ${Math.abs(ageSeconds).toFixed(1)}s future-dated; tolerance is ${maxClockFutureSkewSeconds}s.`)
  } else if (ageSeconds > maxClockAgeSeconds) {
    blocks.push(`${label} timestamp is ${ageSeconds.toFixed(1)}s old; cap is ${maxClockAgeSeconds}s.`)
  }
  return blocks
}

function freshQuoteAssessment(row, symbol, asOf = currentTime()) {
  const blocks = []
  const bidPrice = finiteNumber(row?.bidPrice)
  const askPrice = finiteNumber(row?.askPrice)
  if (bidPrice === null || bidPrice <= 0 || askPrice === null || askPrice <= 0 || askPrice < bidPrice) {
    blocks.push(`Fresh ${symbol} quote must contain positive, noncrossed bid/ask prices.`)
  }
  const midpoint = bidPrice !== null && askPrice !== null && bidPrice > 0 && askPrice >= bidPrice
    ? (bidPrice + askPrice) / 2
    : null
  const spreadBps = midpoint ? ((askPrice - bidPrice) / midpoint) * 10_000 : null
  if (midpoint === null || !Number.isFinite(midpoint) || midpoint <= 0) {
    blocks.push(`Fresh ${symbol} quote midpoint is missing or nonpositive.`)
  }
  if (spreadBps === null || !Number.isFinite(spreadBps) || spreadBps < 0) {
    blocks.push(`Fresh ${symbol} quote spread is unavailable.`)
  } else if (spreadBps > alpacaLiveRiskPolicy.maxAllowedSpreadBps) {
    blocks.push(`Fresh ${symbol} quote spread ${round(spreadBps, 4)} bps exceeds the ${alpacaLiveRiskPolicy.maxAllowedSpreadBps} bps cap.`)
  }
  const quoteTimestamp = dateOrNull(row?.quoteTimestamp)
  const ageSeconds = quoteTimestamp ? (asOf.getTime() - quoteTimestamp.getTime()) / 1000 : null
  if (ageSeconds === null) {
    blocks.push(`Fresh ${symbol} quote timestamp is missing or invalid.`)
  } else if (ageSeconds < -alpacaLiveRiskPolicy.maxQuoteFutureSkewSeconds) {
    blocks.push(`Fresh ${symbol} quote is ${Math.abs(ageSeconds).toFixed(1)}s future-dated; tolerance is ${alpacaLiveRiskPolicy.maxQuoteFutureSkewSeconds}s.`)
  } else if (ageSeconds > alpacaLiveRiskPolicy.maxQuoteAgeMinutes * 60) {
    blocks.push(`Fresh ${symbol} quote is ${(ageSeconds / 60).toFixed(2)}m old; cap is ${alpacaLiveRiskPolicy.maxQuoteAgeMinutes}m.`)
  }
  return {
    blocks,
    bidPrice,
    askPrice,
    midpoint,
    spreadBps,
    quoteTimestamp: quoteTimestamp?.toISOString() ?? null,
  }
}

function compactDate(value) {
  return String(value ?? new Date().toISOString()).slice(0, 10).replaceAll('-', '')
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function fullSnapshotHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function currentTime() {
  if (!testNowFile) return new Date()
  let value
  try {
    value = readFileSync(testNowFile, 'utf8').trim()
  } catch (error) {
    throw new Error(`Test clock could not be read at ${testNowFile}: ${error.message}`)
  }
  const parsed = dateOrNull(value)
  if (!parsed) throw new Error(`Test clock contains an invalid timestamp at ${testNowFile}.`)
  return parsed
}

function relative(filePath) {
  return path.relative(repoDir, filePath)
}

async function ensureParent(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true })
}

function readJsonFile(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function readDirectOperatorState() {
  try {
    return JSON.parse(readFileSync(operatorStatePath, 'utf8'))
  } catch {
    return null
  }
}

async function writeJson(filePath, value) {
  await ensureParent(filePath)
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

async function appendJsonl(filePath, value) {
  await ensureParent(filePath)
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

function existingBrokerLock() {
  try {
    const value = JSON.parse(readFileSync(brokerLockPath, 'utf8'))
    return value
  } catch {
    return null
  }
}

async function acquireBrokerLock() {
  await ensureParent(brokerLockPath)
  const token = crypto.randomBytes(16).toString('hex')
  const lock = {
    pid: process.pid,
    token,
    acquiredAt: new Date().toISOString(),
    operation: statusOnly ? 'status' : preflightOnly ? 'preflight' : 'reconcile',
  }
  const release = async () => {
    try {
      const current = JSON.parse(readFileSync(brokerLockPath, 'utf8'))
      if (current?.token === token && current?.pid === process.pid) await rm(brokerLockPath, { force: true })
    } catch {
      // Never remove a lock whose ownership can no longer be verified.
    }
  }
  try {
    // A synchronous exclusive create plus ownership publication is one event-loop
    // turn, so a signal handler cannot observe an owned lock without its cleanup.
    writeFileSync(brokerLockPath, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    activeBrokerLockRelease = release
    return release
  } catch (error) {
    if (activeBrokerLockRelease === release) activeBrokerLockRelease = null
    if (error?.code !== 'EEXIST') throw error
    const existingPid = Number(existingBrokerLock()?.pid)
    const owner = Number.isInteger(existingPid) && existingPid > 0 ? `PID ${existingPid}` : 'an unknown owner'
    throw new Error(
      `Broker operation lock is held by ${owner} at ${relative(brokerLockPath)}. `
      + 'QORE never reclaims an existing lock automatically; verify no broker process is running, then remove it explicitly.',
    )
  }
}

function alpacaConnectionConfig(mode) {
  const apiKey =
    process.env.QORE_ALPACA_API_KEY_ID ??
    process.env.APCA_API_KEY_ID ??
    process.env.ALPACA_API_KEY_ID ??
    process.env.ALPACA_API_KEY
  const secretKey =
    process.env.QORE_ALPACA_API_SECRET_KEY ??
    process.env.APCA_API_SECRET_KEY ??
    process.env.ALPACA_API_SECRET_KEY ??
    process.env.ALPACA_SECRET_KEY
  const baseUrl =
    process.env.QORE_ALPACA_BASE_URL ??
    process.env.APCA_API_BASE_URL ??
    (mode === 'live' ? alpacaLiveBaseUrl : alpacaPaperBaseUrl)
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  return {
    apiKey,
    secretKey,
    baseUrl: normalizedBaseUrl,
    paper: normalizedBaseUrl === alpacaPaperBaseUrl,
  }
}

function isLoopbackTestEndpoint(value) {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol)
      && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
      && !url.username
      && !url.password
      && (url.pathname === '' || url.pathname === '/')
      && !url.search
      && !url.hash
    )
  } catch {
    return false
  }
}

function localTestEndpointsConfirmed() {
  return (
    process.env.NODE_ENV === 'test'
    && truthy(process.env.QORE_ALPACA_TEST_ENDPOINT_CONFIRMED)
    && isLoopbackTestEndpoint(alpacaConfig.baseUrl)
    && isLoopbackTestEndpoint(alpacaDataBaseUrl)
  )
}

function assertAlpacaEndpointConfiguration() {
  if (localTestEndpointsConfirmed()) return
  const expectedTradingUrl = brokerMode === 'live' ? alpacaLiveBaseUrl : alpacaPaperBaseUrl
  if (alpacaConfig.baseUrl !== expectedTradingUrl) {
    const label = brokerMode === 'live' ? 'Live' : brokerMode === 'paper' ? 'Paper' : 'Dry-run'
    throw new Error(`${label} mode requires the exact Alpaca trading endpoint ${expectedTradingUrl}.`)
  }
  if (alpacaDataBaseUrl !== 'https://data.alpaca.markets') {
    throw new Error('Alpaca market data requires the exact endpoint https://data.alpaca.markets.')
  }
}

function requireCredentials() {
  if (!alpacaConfig.apiKey || !alpacaConfig.secretKey) {
    throw new Error('Missing Alpaca credentials. Set APCA_API_KEY_ID and APCA_API_SECRET_KEY in .env.local.')
  }
}

async function fetchAlpacaPayload(url, options, requestLabel) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), alpacaRequestTimeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' })
    const text = await response.text()
    let payload = null
    if (text) payload = JSON.parse(text)
    return { response, text, payload }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${requestLabel} timed out after ${alpacaRequestTimeoutMs}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function alpacaRequest(method, endpoint, body = null) {
  assertAlpacaEndpointConfiguration()
  requireCredentials()
  const { response, text, payload } = await fetchAlpacaPayload(`${alpacaConfig.baseUrl}${endpoint}`, {
    method,
    headers: {
      'APCA-API-KEY-ID': alpacaConfig.apiKey,
      'APCA-API-SECRET-KEY': alpacaConfig.secretKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  }, `Alpaca ${method} ${endpoint}`)
  if (!response.ok) {
    const detail = payload?.message ?? payload?.code ?? text
    const error = new Error(`Alpaca ${method} ${endpoint} failed with ${response.status}: ${detail}`)
    // A clear client-side rejection proves that Alpaca did not accept the
    // mutation. Server failures and request-timeout responses do not: the
    // order/cancel may have completed before the failing response path.
    error.qoreDefinitiveBrokerResponse = (
      response.status >= 400
      && response.status < 500
      && response.status !== 408
    )
    throw error
  }
  return payload
}

async function alpacaDataRequest(endpoint) {
  assertAlpacaEndpointConfiguration()
  requireCredentials()
  const { response, text, payload } = await fetchAlpacaPayload(`${alpacaDataBaseUrl}${endpoint}`, {
    headers: {
      'APCA-API-KEY-ID': alpacaConfig.apiKey,
      'APCA-API-SECRET-KEY': alpacaConfig.secretKey,
    },
  }, `Alpaca market data GET ${endpoint}`)
  if (!response.ok) {
    const detail = payload?.message ?? payload?.code ?? text
    throw new Error(`Alpaca market data GET ${endpoint} failed with ${response.status}: ${detail}`)
  }
  return payload
}

async function getAlpacaLatestQuotes(symbols) {
  const uniqueSymbols = [...new Set(symbols)].filter((symbol) => alpacaLiveRiskPolicy.allowedInstruments.has(symbol))
  if (!uniqueSymbols.length) {
    return { generatedAt: currentTime().toISOString(), feed: alpacaMarketDataFeed, rows: [], referencePrices: {}, spreadsBps: {} }
  }
  const params = new URLSearchParams({ symbols: uniqueSymbols.join(','), feed: alpacaMarketDataFeed })
  const payload = await alpacaDataRequest(`/v2/stocks/quotes/latest?${params}`)
  const rows = uniqueSymbols.map((symbol) => {
    const quote = payload?.quotes?.[symbol] ?? null
    const bidPrice = finiteNumber(quote?.bp)
    const askPrice = finiteNumber(quote?.ap)
    const valid = bidPrice !== null && askPrice !== null && bidPrice > 0 && askPrice >= bidPrice
    const midpoint = valid ? (bidPrice + askPrice) / 2 : null
    return {
      symbol,
      status: valid ? 'ok' : 'invalid',
      bidPrice,
      askPrice,
      midpoint: midpoint === null ? null : round(midpoint, 6),
      spreadBps: midpoint ? round(((askPrice - bidPrice) / midpoint) * 10_000, 4) : null,
      quoteTimestamp: quote?.t ?? null,
      tape: quote?.z ?? null,
    }
  })
  return {
    generatedAt: currentTime().toISOString(),
    source: 'Alpaca latest stock quotes',
    feed: alpacaMarketDataFeed,
    rows,
    referencePrices: Object.fromEntries(rows.filter((row) => row.midpoint).map((row) => [row.symbol, row.midpoint])),
    spreadsBps: Object.fromEntries(rows.filter((row) => row.spreadBps !== null).map((row) => [row.symbol, row.spreadBps])),
  }
}

async function getAlpacaOpenOrders() {
  const openOrders = await alpacaRequest('GET', '/v2/orders?status=open&limit=500&nested=false')
  if (brokerMode !== 'dry-run' && !Array.isArray(openOrders)) {
    throw new Error('Alpaca open-order response is missing or invalid; complete gross exposure cannot be verified.')
  }
  if (brokerMode !== 'dry-run' && openOrders.length >= 500) {
    throw new Error('Alpaca returned the 500-order open-order limit; complete gross exposure cannot be verified.')
  }
  return openOrders
}

async function getAlpacaOrderById(brokerOrderId) {
  return alpacaRequest('GET', `/v2/orders/${encodeURIComponent(String(brokerOrderId))}`)
}

function portfolioTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizePortfolioHistory(payload) {
  const timestamps = Array.isArray(payload?.timestamp) ? payload.timestamp : []
  const equity = Array.isArray(payload?.equity) ? payload.equity : []
  const profitLoss = Array.isArray(payload?.profit_loss) ? payload.profit_loss : []
  const profitLossPct = Array.isArray(payload?.profit_loss_pct) ? payload.profit_loss_pct : []
  const baseValueUsd = finiteNumber(payload?.base_value)
  const points = []

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = portfolioTimestamp(timestamps[index])
    const equityUsd = finiteNumber(equity[index])
    if (!timestamp || equityUsd === null) continue
    const reportedProfitLossUsd = finiteNumber(profitLoss[index])
    const reportedProfitLossRatio = finiteNumber(profitLossPct[index])
    const normalizedProfitLossUsd = reportedProfitLossUsd ?? (baseValueUsd === null ? null : equityUsd - baseValueUsd)
    const normalizedProfitLossPct = reportedProfitLossRatio === null
      ? baseValueUsd && baseValueUsd !== 0
        ? ((equityUsd - baseValueUsd) / baseValueUsd) * 100
        : null
      : reportedProfitLossRatio * 100
    points.push({
      timestamp,
      equityUsd: round(equityUsd, 2),
      profitLossUsd: normalizedProfitLossUsd === null ? null : round(normalizedProfitLossUsd, 2),
      profitLossPct: normalizedProfitLossPct === null ? null : round(normalizedProfitLossPct, 4),
    })
  }

  return {
    baseValueUsd: baseValueUsd === null ? null : round(baseValueUsd, 2),
    baseValueAsOf: portfolioTimestamp(payload?.base_value_asof),
    timeframe: String(payload?.timeframe ?? '1D'),
    points,
  }
}

async function getAlpacaPortfolioHistory() {
  const params = new URLSearchParams({ period: 'all', timeframe: '1D' })
  const payload = await alpacaRequest('GET', `/v2/account/portfolio/history?${params}`)
  return normalizePortfolioHistory(payload)
}

async function accountContextFrom(account, { persistRiskLedger = true, requireValidRiskLedger = false } = {}) {
  const equityUsd = finiteNumber(account?.equity)
  const cashUsd = finiteNumber(account?.cash)
  const lastEquityUsd = finiteNumber(account?.last_equity)
  const dayPnlPct = equityUsd !== null && lastEquityUsd !== null && lastEquityUsd > 0
    ? ((equityUsd - lastEquityUsd) / lastEquityUsd) * 100
    : null
  const normalizedEquityUsd = equityUsd ?? 0
  const accountKey = account?.id ? stableHash(String(account.id)) : 'unknown'
  let priorLedger = null
  let ledgerReadError = null
  if (existsSync(brokerRiskLedgerPath)) {
    try {
      priorLedger = JSON.parse(readFileSync(brokerRiskLedgerPath, 'utf8'))
    } catch {
      ledgerReadError = 'malformed JSON'
    }
  }
  const ledgerValid = (
    priorLedger?.serviceId === 'qore-alpaca-risk-ledger'
    && priorLedger?.broker === 'alpaca'
    && accountKey !== 'unknown'
    && priorLedger?.accountKey === accountKey
    && priorLedger?.mode === brokerMode
    && finiteNumber(priorLedger?.equityHighWatermarkUsd) > 0
  )
  if (bootstrapRiskLedger) {
    if (!preflightOnly || statusOnly || brokerMode === 'dry-run') {
      throw new Error('--bootstrap-risk-ledger is valid only with --preflight-only in paper or live mode.')
    }
    if (process.env.QORE_CONFIRM_RISK_LEDGER_BOOTSTRAP !== 'I_UNDERSTAND_THIS_RESETS_THE_TRAILING_DRAWDOWN_BASELINE') {
      throw new Error(
        'Risk-ledger bootstrap requires QORE_CONFIRM_RISK_LEDGER_BOOTSTRAP=I_UNDERSTAND_THIS_RESETS_THE_TRAILING_DRAWDOWN_BASELINE.',
      )
    }
    if (readDirectOperatorState()?.killSwitchEngaged !== true) {
      throw new Error('Risk-ledger bootstrap requires the direct operator kill switch to be engaged.')
    }
    if (accountKey === 'unknown') {
      throw new Error('Risk-ledger bootstrap requires a real Alpaca account id.')
    }
    if (normalizedEquityUsd <= 0) {
      throw new Error('Risk-ledger bootstrap requires positive current Alpaca equity.')
    }
    if (
      account?.status !== 'ACTIVE'
      || account?.trading_blocked !== false
      || account?.account_blocked !== false
      || account?.trade_suspended_by_user !== false
    ) {
      throw new Error('Risk-ledger bootstrap requires an ACTIVE Alpaca account with no trading, account, or user-suspension block.')
    }
    const gitBlocks = liveGitStateBlocks()
    if (gitBlocks.length) throw new Error(gitBlocks.join(' '))
    priorLedger = null
  } else if ((persistRiskLedger || requireValidRiskLedger) && brokerMode !== 'dry-run' && !ledgerValid) {
    const reason = !existsSync(brokerRiskLedgerPath)
      ? 'is missing'
      : ledgerReadError
        ? `contains ${ledgerReadError}`
        : accountKey === 'unknown'
          ? 'cannot be matched because Alpaca did not return a real account id'
          : priorLedger?.accountKey !== accountKey
          ? 'belongs to a different Alpaca account'
          : priorLedger?.mode !== brokerMode
            ? `belongs to mode ${priorLedger?.mode ?? 'unknown'} instead of ${brokerMode}`
            : 'does not contain a valid positive equity high-water mark'
    throw new Error(
      `Risk ledger ${reason} at ${relative(brokerRiskLedgerPath)}. `
      + 'Run an explicitly confirmed --preflight-only --bootstrap-risk-ledger while the operator kill switch is engaged.',
    )
  }
  const configuredHighWatermark = optionalPositiveNumber(process.env.QORE_BROKER_EQUITY_HIGH_WATERMARK_USD)
  const priorHighWatermark = ledgerValid && !bootstrapRiskLedger ? finiteNumber(priorLedger?.equityHighWatermarkUsd) : null
  const canComputeDrawdown = brokerMode === 'dry-run' || ledgerValid || bootstrapRiskLedger
  const equityHighWatermarkUsd = !canComputeDrawdown
    ? null
    : bootstrapRiskLedger
      ? normalizedEquityUsd
      : Math.max(normalizedEquityUsd, configuredHighWatermark ?? 0, priorHighWatermark ?? 0)
  const trailingDrawdownPct = equityHighWatermarkUsd !== null && equityHighWatermarkUsd > 0
    ? ((normalizedEquityUsd - equityHighWatermarkUsd) / equityHighWatermarkUsd) * 100
    : null
  const riskLedger = {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-alpaca-risk-ledger',
    broker: 'alpaca',
    mode: brokerMode,
    accountKey,
    equityUsd: round(normalizedEquityUsd, 2),
    equityHighWatermarkUsd: equityHighWatermarkUsd === null ? null : round(equityHighWatermarkUsd, 2),
    trailingDrawdownPct: trailingDrawdownPct === null ? null : round(trailingDrawdownPct, 4),
  }
  const mayInitializeDryRunLedger = brokerMode === 'dry-run' && !existsSync(brokerRiskLedgerPath)
  if (persistRiskLedger && (mayInitializeDryRunLedger || ledgerValid || bootstrapRiskLedger)) {
    await writeJson(brokerRiskLedgerPath, riskLedger)
  }
  return {
    equityUsd: normalizedEquityUsd,
    cashUsd: cashUsd ?? 0,
    openIntentCount: 0,
    dayPnlPct: dayPnlPct === null ? null : round(dayPnlPct, 4),
    trailingDrawdownPct: riskLedger.trailingDrawdownPct,
    consecutiveLosses: 0,
  }
}

function offlineBrokerSnapshot() {
  const existing = readJsonFile(brokerSnapshotPath)
  if (existing?.account) {
    return {
      ...existing,
      sourceGeneratedAt: existing.sourceGeneratedAt ?? existing.generatedAt ?? null,
      brokerConnected: false,
      liveRoutingEnabled: false,
      mode: brokerMode === 'live' ? 'paper' : brokerMode,
      notes: [
        ...(Array.isArray(existing.notes) ? existing.notes : []),
        'Cached account snapshot only. No broker connection was used.',
      ],
    }
  }
  const envHasAccount = process.env.QORE_BROKER_EQUITY_USD !== undefined || process.env.QORE_BROKER_CASH_USD !== undefined
  if (!envHasAccount) return null
  return {
    generatedAt: new Date().toISOString(),
    broker: 'alpaca',
    brokerConnected: false,
    liveRoutingEnabled: false,
    mode: brokerMode === 'live' ? 'paper' : brokerMode,
    account: {
      equityUsd: Number(process.env.QORE_BROKER_EQUITY_USD ?? 0),
      cashUsd: Number(process.env.QORE_BROKER_CASH_USD ?? 0),
      openIntentCount: Number(process.env.QORE_BROKER_OPEN_INTENT_COUNT ?? 0),
      dayPnlPct: Number(process.env.QORE_BROKER_DAY_PNL_PCT ?? 0),
      trailingDrawdownPct: Number(process.env.QORE_BROKER_TRAILING_DRAWDOWN_PCT ?? 0),
      consecutiveLosses: Number(process.env.QORE_BROKER_CONSECUTIVE_LOSSES ?? 0),
    },
    positions: [],
    openOrders: [],
    notes: ['Offline env/account snapshot. No broker connection was used.'],
  }
}

async function getAlpacaBrokerSnapshot({ allowOffline = false, persistRiskLedger = true } = {}) {
  if (!alpacaConfig.apiKey || !alpacaConfig.secretKey) {
    if (allowOffline) {
      const offline = offlineBrokerSnapshot()
      if (offline) return offline
    }
    requireCredentials()
  }

  const [account, positions, openOrders, marketClock] = await Promise.all([
    alpacaRequest('GET', '/v2/account'),
    alpacaRequest('GET', '/v2/positions'),
    getAlpacaOpenOrders(),
    alpacaRequest('GET', '/v2/clock'),
  ])
  const snapshot = {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-alpaca-account-snapshot',
    broker: 'alpaca',
    brokerConnected: true,
    liveRoutingEnabled: brokerMode === 'live',
    mode: brokerMode === 'live' ? 'live' : 'paper',
    account: await accountContextFrom(account, { persistRiskLedger }),
    positions,
    openOrders,
    rawAccount: {
      accountNumber: account?.account_number ? `...${String(account.account_number).slice(-4)}` : null,
      status: account?.status ?? null,
      tradingBlocked: account?.trading_blocked ?? null,
      transfersBlocked: account?.transfers_blocked ?? null,
      accountBlocked: account?.account_blocked ?? null,
      tradeSuspendedByUser: account?.trade_suspended_by_user ?? null,
      shortingEnabled: account?.shorting_enabled ?? null,
      buyingPower: account?.buying_power ?? null,
    },
    marketClock: {
      isOpen: typeof marketClock?.is_open === 'boolean' ? marketClock.is_open : null,
      timestamp: marketClock?.timestamp ?? null,
      nextOpen: marketClock?.next_open ?? null,
      nextClose: marketClock?.next_close ?? null,
    },
    files: {
      snapshot: relative(brokerSnapshotPath),
      orderLog: relative(brokerOrderLogPath),
      riskLedger: relative(brokerRiskLedgerPath),
    },
  }
  snapshot.account.openIntentCount = openOrders.length
  await writeJson(brokerSnapshotPath, snapshot)
  return snapshot
}

function readIndexBasketConfig() {
  const config = readJsonFile(indexBasketConfigPath)
  if (!config?.components?.length) throw new Error(`Missing index basket config at ${relative(indexBasketConfigPath)}.`)
  const seen = new Set()
  const components = config.components.map((component) => {
    const symbol = String(component?.symbol ?? '').trim()
    const targetWeight = finiteNumber(component?.targetWeight)
    if (!symbol || !alpacaLiveRiskPolicy.allowedInstruments.has(symbol) || symbol === 'UNG') {
      throw new Error(`Index basket config contains unsupported component symbol "${symbol || 'missing'}".`)
    }
    if (seen.has(symbol)) throw new Error(`Index basket config contains duplicate component symbol ${symbol}.`)
    if (targetWeight === null || targetWeight <= 0) {
      throw new Error(`Index basket component ${symbol} must have a positive finite targetWeight.`)
    }
    seen.add(symbol)
    return { ...component, symbol, targetWeight }
  })
  const totalWeight = components.reduce((sum, component) => sum + component.targetWeight, 0)
  const symbols = [...seen].sort()
  if (symbols.length !== 2 || symbols[0] !== 'QQQM' || symbols[1] !== 'VOO') {
    throw new Error('Index basket config must contain exactly one VOO component and one QQQM component.')
  }
  if (!Number.isFinite(totalWeight) || Math.abs(totalWeight - 1) > 0.001) {
    throw new Error(`Index basket component weights must sum to 1 within 0.001 (received ${round(totalWeight, 6)}).`)
  }
  return {
    ...config,
    components: components.map((component) => ({ ...component, targetWeight: component.targetWeight / totalWeight })),
  }
}

function readSignalIntent() {
  const snapshot = readJsonFile(signalIntentPath)
  if (!snapshot?.intent) throw new Error(`Missing signal intent. Run npm run trade:weather:once to write ${relative(signalIntentPath)}.`)
  return snapshot
}

function readMarketReference() {
  const snapshot = readJsonFile(marketReferencePath)
  if (!snapshot?.referencePrices) throw new Error(`Missing market reference prices. Run npm run trade:weather:once to write ${relative(marketReferencePath)}.`)
  return snapshot
}

function readRiskState() {
  const riskState = readJsonFile(riskStatePath, null)
  const operatorState = readJsonFile(operatorStatePath, null)
  if (!riskState) return null
  if (typeof operatorState?.killSwitchEngaged !== 'boolean') {
    return {
      ...riskState,
      operator: null,
    }
  }
  return {
    ...riskState,
    operator: {
      ...(riskState.operator ?? {}),
      ...operatorState,
      source: 'operator-state-file-direct-broker-read',
    },
  }
}

function signedPositionNotional(position) {
  const qtyRaw = Number(position?.qty)
  const side = String(position?.side ?? '').toLowerCase()
  const signedQty = side === 'short' ? -Math.abs(qtyRaw) : qtyRaw
  const price = Number(position?.current_price ?? position?.asset_current_price)
  if (Number.isFinite(signedQty) && Number.isFinite(price) && price > 0) return signedQty * price
  const marketValue = Number(position?.market_value)
  if (!Number.isFinite(marketValue)) {
    if (brokerMode !== 'dry-run') {
      throw new Error(`Cannot determine current notional exposure for Alpaca position ${position?.symbol ?? 'with missing symbol'}.`)
    }
    return 0
  }
  return side === 'short' ? -Math.abs(marketValue) : marketValue
}

function signedPositionQuantity(position) {
  const quantity = finiteNumber(position?.qty)
  const side = String(position?.side ?? '').toLowerCase()
  if (quantity === null || quantity < 0 || !['long', 'short'].includes(side)) {
    if (brokerMode !== 'dry-run') {
      throw new Error(`Cannot determine signed share quantity for Alpaca position ${position?.symbol ?? 'with missing symbol'}.`)
    }
    return 0
  }
  return side === 'short' ? -Math.abs(quantity) : Math.abs(quantity)
}

function currentNotionalsFromPositions(positions) {
  const current = {}
  for (const position of positions ?? []) {
    const symbol = position?.symbol
    if (!symbol) {
      if (brokerMode !== 'dry-run') throw new Error('Alpaca returned a position with no symbol; gross exposure cannot be verified.')
      continue
    }
    current[symbol] = (current[symbol] ?? 0) + signedPositionNotional(position)
  }
  return current
}

function currentQuantitiesFromPositions(positions) {
  const current = {}
  for (const position of positions ?? []) {
    const symbol = position?.symbol
    if (!symbol) {
      if (brokerMode !== 'dry-run') throw new Error('Alpaca returned a position with no symbol; share quantity cannot be verified.')
      continue
    }
    current[symbol] = (current[symbol] ?? 0) + signedPositionQuantity(position)
  }
  return current
}

function buildTargets(signalIntent, accountEquityUsd) {
  const intent = signalIntent.intent
  const basket = readIndexBasketConfig()
  const capitalBase = Math.max(0, accountEquityUsd * (allocationPct / 100))
  const cashReserve = accountEquityUsd * (minCashBufferPct / 100)
  const deployable = Math.max(0, capitalBase - cashReserve)
  const explicitIndexFraction = finiteNumber(intent.indexFraction)
  const explicitGasPosition = finiteNumber(intent.gasPosition)
  const explicitCashFraction = finiteNumber(intent.cashFraction)
  if (brokerMode !== 'dry-run') {
    if (intent.strategyId !== 'ngas-all-year-beta') {
      throw new Error('Signal intent strategyId must equal ngas-all-year-beta for paper/live routing.')
    }
    if (signalIntent?.inference?.strategyId !== 'ngas-all-year-beta') {
      throw new Error('Signal inference strategyId must equal ngas-all-year-beta for paper/live routing.')
    }
    if (intent.instrument !== 'UNG') {
      throw new Error('Signal intent instrument must equal UNG for paper/live routing.')
    }
    if (explicitIndexFraction === null || explicitIndexFraction < 0 || explicitIndexFraction > 1) {
      throw new Error('Signal intent indexFraction must be an explicit finite value between 0 and 1 for paper/live routing.')
    }
    if (explicitGasPosition === null || explicitGasPosition < -1 || explicitGasPosition > 1) {
      throw new Error('Signal intent gasPosition must be an explicit finite value between -1 and 1 for paper/live routing.')
    }
    if (explicitCashFraction === null || explicitCashFraction < 0 || explicitCashFraction > 1) {
      throw new Error('Signal intent cashFraction must be an explicit finite value between 0 and 1 for paper/live routing.')
    }
    const allocationTotal = Math.abs(explicitGasPosition) + explicitIndexFraction + explicitCashFraction
    if (Math.abs(allocationTotal - 1) > 0.001) {
      throw new Error(
        `Signal intent target weights are out of contract: abs(gasPosition) + indexFraction + cashFraction must equal 1 (received ${round(allocationTotal, 6)}).`,
      )
    }
    const expectedDirection = explicitGasPosition > 0 ? 'long' : explicitGasPosition < 0 ? 'short' : 'flat'
    if (intent.direction !== expectedDirection) {
      throw new Error(`Signal intent direction must be ${expectedDirection} when gasPosition is ${explicitGasPosition}.`)
    }
  }
  const gasPosition = explicitGasPosition
    ?? (intent.direction === 'short' ? -1 : intent.direction === 'long' ? 1 : 0)
  const indexFraction = explicitIndexFraction ?? Math.max(0, 1 - Math.abs(gasPosition))
  const targets = {}

  for (const component of basket.components) {
    targets[component.symbol] = round(deployable * indexFraction * component.targetWeight, 2)
  }
  targets.UNG = round(deployable * gasPosition, 2)
  return targets
}

function referencePricesFor(marketSnapshot, positions, quoteSnapshot = null) {
  const prices = { ...(marketSnapshot.referencePrices ?? {}) }
  for (const position of positions ?? []) {
    const symbol = position?.symbol
    const price = Number(position?.current_price ?? position?.asset_current_price)
    if (symbol && Number.isFinite(price) && price > 0 && !prices[symbol]) prices[symbol] = price
  }
  Object.assign(prices, quoteSnapshot?.referencePrices ?? {})
  return prices
}

function orderQuantity(absDeltaUsd, price, forceWholeShares = false) {
  const raw = absDeltaUsd / price
  if (forceWholeShares || !fractionalOrders) return Math.floor(raw)
  return Math.floor(raw * 1_000_000) / 1_000_000
}

function clientOrderIdFor(intent, symbol, side, targetDeltaNotionalUsd) {
  const hash = stableHash({ strategyId: intent.strategyId, signalDate: intent.signalDate, symbol, side, targetDeltaNotionalUsd })
  return `qore-${compactDate(intent.signalDate)}-${symbol}-${side}-${hash}`.slice(0, 48)
}

function buildPlannedOrders({ signalSnapshot, targets, current, currentQuantities, prices, openOrders, accountEquityUsd }) {
  const intent = signalSnapshot.intent
  const planned = []
  const skipped = []
  const openSymbols = new Set((openOrders ?? []).map((order) => order.symbol).filter(Boolean))
  const rebalanceDeadbandUsd = Math.max(0, accountEquityUsd) * (rebalanceDeadbandPct / 100)

  for (const [symbol, targetNotionalUsd] of Object.entries(targets)) {
    const price = Number(prices[symbol])
    if (!Number.isFinite(price) || price <= 0) continue
    const currentNotionalUsd = Number(current[symbol] ?? 0)
    const targetDeltaNotionalUsd = targetNotionalUsd - currentNotionalUsd
    if (Math.abs(targetDeltaNotionalUsd) < rebalanceDeadbandUsd) continue
    let deltaNotionalUsd = targetDeltaNotionalUsd
    if (maxOrderUsd && Math.abs(deltaNotionalUsd) > maxOrderUsd) {
      deltaNotionalUsd = Math.sign(deltaNotionalUsd) * maxOrderUsd
    }
    const absDeltaUsd = Math.abs(deltaNotionalUsd)
    if (absDeltaUsd < minOrderUsd) continue
    const side = deltaNotionalUsd > 0 ? 'buy' : 'sell'
    const opensShort = symbol === 'UNG' && side === 'sell' && targetNotionalUsd < 0
    const quantity = orderQuantity(absDeltaUsd, price, opensShort)
    if (quantity <= 0) continue
    const orderRequest = {
      clientOrderId: clientOrderIdFor(intent, symbol, side, targetDeltaNotionalUsd),
      symbol,
      side,
      quantity,
      estimatedNotionalUsd: round(quantity * price, 2),
      orderType,
      timeInForce,
      targetNotionalUsd: round(targetNotionalUsd, 2),
      currentNotionalUsd: round(currentNotionalUsd, 2),
      currentSignedQuantity: currentQuantities[symbol] ?? 0,
      deltaNotionalUsd: round(deltaNotionalUsd, 2),
      reason: opensShort
        ? `${intent.strategyId} target-weight reconcile for ${intent.signalDate}; whole-share UNG quantity because Alpaca does not support fractional short-sale orders.`
        : `${intent.strategyId} target-weight reconcile for ${intent.signalDate}.`,
    }
    if (!replaceOpenOrders && openSymbols.has(symbol)) {
      skipped.push({
        ...orderRequest,
        reason: `${orderRequest.reason} Existing open ${symbol} order found and QORE_ALPACA_REPLACE_OPEN_ORDERS is not enabled.`,
      })
      continue
    }
    planned.push(orderRequest)
  }
  planned.sort((left, right) => Number(left.side === 'buy') - Number(right.side === 'buy'))
  return { plannedOrders: planned, skippedOrders: skipped }
}

function conservativeOpenOrderNotional(openOrder, prices) {
  const explicitNotional = finiteNumber(openOrder?.notional)
  if (explicitNotional !== null && explicitNotional > 0) return Math.abs(explicitNotional)
  const quantity = finiteNumber(openOrder?.qty ?? openOrder?.quantity)
  const filledQuantity = finiteNumber(openOrder?.filled_qty ?? openOrder?.filledQuantity) ?? 0
  const remainingQuantity = quantity === null ? null : Math.max(0, quantity - Math.max(0, filledQuantity))
  const priceCandidates = [
    finiteNumber(openOrder?.limit_price),
    finiteNumber(openOrder?.stop_price),
    finiteNumber(prices?.[openOrder?.symbol]),
  ].filter((value) => value !== null && value > 0)
  if (remainingQuantity === null || priceCandidates.length === 0) return null
  return remainingQuantity * Math.max(...priceCandidates)
}

function exposureCeilings(accountEquityUsd) {
  const equityUsd = finiteNumber(accountEquityUsd)
  if (equityUsd === null || equityUsd <= 0) {
    return {
      maxGrossUsd: null,
      deploymentCeilingUsd: null,
      effectiveExposureCeilingUsd: null,
      effectiveExposureCeilingPct: null,
    }
  }
  const maxGrossUsd = equityUsd * (alpacaLiveRiskPolicy.maxGrossExposurePct / 100)
  const allocationCeilingUsd = equityUsd * (allocationPct / 100)
  const cashReserveUsd = equityUsd * (minCashBufferPct / 100)
  const deploymentCeilingUsd = Math.max(0, allocationCeilingUsd - cashReserveUsd)
  const effectiveExposureCeilingUsd = Math.min(maxGrossUsd, deploymentCeilingUsd)
  return {
    maxGrossUsd,
    deploymentCeilingUsd,
    effectiveExposureCeilingUsd,
    effectiveExposureCeilingPct: (effectiveExposureCeilingUsd / equityUsd) * 100,
  }
}

function exposureEnvelopeAssessment(exposurePlan, accountEquityUsd) {
  const blocks = []
  const ceilings = exposureCeilings(accountEquityUsd)
  const safetyAmounts = exposurePlan?.[exposureSafetyAmounts] ?? exposurePlan
  const startingGrossUsd = finiteNumber(safetyAmounts?.startingGrossUsd)
  const prefixes = Array.isArray(safetyAmounts?.prefixes) ? safetyAmounts.prefixes : []
  if (brokerMode !== 'dry-run' && (ceilings.effectiveExposureCeilingUsd === null || startingGrossUsd === null)) {
    blocks.push('Cannot evaluate gross exposure because account equity or the refreshed exposure plan is missing or invalid.')
    return { ...ceilings, startsOverCap: false, blocks }
  }
  if (ceilings.effectiveExposureCeilingUsd === null || startingGrossUsd === null) {
    return { ...ceilings, startsOverCap: false, blocks }
  }

  const startsOverCap = startingGrossUsd > ceilings.effectiveExposureCeilingUsd + 0.01
  let previousGrossUsd = startingGrossUsd
  for (let index = 0; index < prefixes.length; index += 1) {
    const prefix = prefixes[index]
    const projectedGrossUsd = finiteNumber(prefix?.projectedGrossUsd)
    if (projectedGrossUsd === null) {
      if (brokerMode !== 'dry-run') blocks.push(`Planned order prefix ${index + 1} has invalid projected gross exposure.`)
      continue
    }
    const projectedGrossExposurePct = Number(accountEquityUsd) > 0
      ? round((projectedGrossUsd / Number(accountEquityUsd)) * 100, 4)
      : null
    if (brokerMode !== 'dry-run') {
      if (startsOverCap && projectedGrossUsd >= previousGrossUsd - 0.01) {
        blocks.push(
          `Account starts over the current-equity sizing envelope; planned order prefix ${index + 1} `
          + `(${prefix.side} ${prefix.symbol}) does not strictly reduce projected gross exposure.`,
        )
      } else if (!startsOverCap && projectedGrossUsd > ceilings.effectiveExposureCeilingUsd + 0.01) {
        blocks.push(
          `Planned order prefix ${index + 1} (${prefix.side} ${prefix.symbol}) projects gross exposure `
          + `${projectedGrossExposurePct}% above the ${round(ceilings.effectiveExposureCeilingPct, 4)}% current-equity sizing envelope `
          + `(allocation ${allocationPct}% less ${minCashBufferPct}% cash buffer; gross cap ${alpacaLiveRiskPolicy.maxGrossExposurePct}%).`,
        )
      }
    }
    previousGrossUsd = projectedGrossUsd
  }
  return { ...ceilings, startsOverCap, blocks }
}

function evaluateGrossExposurePlan({ current, openOrders, plannedOrders, prices, accountEquityUsd, assumeMatchingOrdersCanceled = replaceOpenOrders }) {
  const plannedSymbols = new Set(plannedOrders.map((order) => order.symbol))
  const retainedOpenOrders = assumeMatchingOrdersCanceled
    ? (openOrders ?? []).filter((order) => !plannedSymbols.has(order?.symbol))
    : (openOrders ?? [])
  const unknownOpenOrders = []
  let outstandingOpenOrderExposureUsd = 0
  for (const openOrder of retainedOpenOrders) {
    const notional = conservativeOpenOrderNotional(openOrder, prices)
    if (notional === null) {
      unknownOpenOrders.push(openOrder?.symbol ?? 'unknown')
      continue
    }
    outstandingOpenOrderExposureUsd += Math.abs(notional)
  }
  const projectedPositions = { ...current }
  const positionGross = () => Object.values(projectedPositions).reduce((sum, value) => sum + Math.abs(Number(value ?? 0)), 0)
  const startingGrossUsd = positionGross() + outstandingOpenOrderExposureUsd
  const prefixes = []
  const rawPrefixes = []
  const blocks = []

  if (brokerMode !== 'dry-run' && unknownOpenOrders.length) {
    blocks.push(
      `Cannot conservatively value outstanding open-order exposure for ${[...new Set(unknownOpenOrders)].join(', ')}.`,
    )
  }
  for (let index = 0; index < plannedOrders.length; index += 1) {
    const order = plannedOrders[index]
    const orderQuantity = finiteNumber(order.quantity)
    const orderPrice = finiteNumber(prices?.[order.symbol])
    const exactOrderNotionalUsd = orderQuantity !== null && orderQuantity > 0 && orderPrice !== null && orderPrice > 0
      ? orderQuantity * orderPrice
      : finiteNumber(order.estimatedNotionalUsd)
    const signedDeltaUsd = exactOrderNotionalUsd === null
      ? Number.NaN
      : order.side === 'buy' ? exactOrderNotionalUsd : -exactOrderNotionalUsd
    projectedPositions[order.symbol] = Number(projectedPositions[order.symbol] ?? 0) + signedDeltaUsd
    const projectedGrossUsd = positionGross() + outstandingOpenOrderExposureUsd
    const prefix = {
      orderIndex: index,
      symbol: order.symbol,
      side: order.side,
      projectedGrossUsd: round(projectedGrossUsd, 2),
      projectedGrossExposurePct: accountEquityUsd > 0 ? round((projectedGrossUsd / accountEquityUsd) * 100, 4) : null,
    }
    prefixes.push(prefix)
    rawPrefixes.push({
      orderIndex: index,
      symbol: order.symbol,
      side: order.side,
      projectedGrossUsd,
    })
  }

  const safetyAmounts = { startingGrossUsd, prefixes: rawPrefixes }
  const envelope = exposureEnvelopeAssessment(safetyAmounts, accountEquityUsd)
  blocks.push(...envelope.blocks)

  const plan = {
    maxGrossUsd: envelope.maxGrossUsd === null ? null : round(envelope.maxGrossUsd, 2),
    deploymentCeilingUsd: envelope.deploymentCeilingUsd === null ? null : round(envelope.deploymentCeilingUsd, 2),
    effectiveExposureCeilingUsd: envelope.effectiveExposureCeilingUsd === null
      ? null
      : round(envelope.effectiveExposureCeilingUsd, 2),
    effectiveExposureCeilingPct: envelope.effectiveExposureCeilingPct === null
      ? null
      : round(envelope.effectiveExposureCeilingPct, 4),
    startingGrossUsd: round(startingGrossUsd, 2),
    startingGrossExposurePct: accountEquityUsd > 0 ? round((startingGrossUsd / accountEquityUsd) * 100, 4) : null,
    outstandingOpenOrderExposureUsd: round(outstandingOpenOrderExposureUsd, 2),
    startsOverCap: envelope.startsOverCap,
    prefixes,
    blocks,
  }
  Object.defineProperty(plan, exposureSafetyAmounts, { value: safetyAmounts })
  return plan
}

function openOrderId(openOrder) {
  return openOrder?.id ?? openOrder?.order_id ?? openOrder?.brokerOrderId ?? null
}

function matchingOpenOrders(openOrders, symbols) {
  return (openOrders ?? []).filter((order) => order?.symbol && symbols.has(order.symbol))
}

function directAccountSafetyBlocks(account, accountContext, label = 'Fresh') {
  const blocks = []
  if (account?.status !== 'ACTIVE') blocks.push(`${label} Alpaca account status is ${account?.status ?? 'unknown'}; ACTIVE is required.`)
  if (account?.trading_blocked !== false) blocks.push(`${label} Alpaca trading_blocked is not exactly false.`)
  if (account?.account_blocked !== false) blocks.push(`${label} Alpaca account_blocked is not exactly false.`)
  if (account?.trade_suspended_by_user !== false) blocks.push(`${label} Alpaca trade_suspended_by_user is not exactly false.`)
  if (!Number.isFinite(accountContext?.equityUsd) || accountContext.equityUsd <= 0) {
    blocks.push(`${label} Alpaca account equity is missing, invalid, or nonpositive.`)
  }
  if (accountContext?.dayPnlPct === null) {
    blocks.push(`${label} daily P&L is unavailable because Alpaca last_equity is missing, invalid, or zero.`)
  } else if (accountContext?.dayPnlPct <= -Math.abs(alpacaLiveRiskPolicy.maxDailyLossPct)) {
    blocks.push(`${label} daily P&L ${accountContext.dayPnlPct}% breaches the ${alpacaLiveRiskPolicy.maxDailyLossPct}% loss stop.`)
  }
  if (accountContext?.trailingDrawdownPct === null) {
    blocks.push(`${label} trailing drawdown is unavailable.`)
  } else if (accountContext?.trailingDrawdownPct <= -Math.abs(alpacaLiveRiskPolicy.maxTrailingDrawdownPct)) {
    blocks.push(`${label} trailing drawdown ${accountContext.trailingDrawdownPct}% breaches the ${alpacaLiveRiskPolicy.maxTrailingDrawdownPct}% stop.`)
  }
  return blocks
}

async function persistMutationBoundaryAccountState() {
  const account = await alpacaRequest('GET', '/v2/account')
  const accountContext = await accountContextFrom(account, {
    persistRiskLedger: true,
    requireValidRiskLedger: brokerMode !== 'dry-run',
  })
  const blocks = brokerMode === 'dry-run' ? [] : directAccountSafetyBlocks(account, accountContext, 'Mutation-boundary')
  if (blocks.length) throw new Error(blocks.join(' '))
}

function localMutationBoundaryBlocks() {
  if (brokerMode === 'dry-run') return []
  const blocks = []
  const operatorState = readDirectOperatorState()
  if (typeof operatorState?.killSwitchEngaged !== 'boolean') {
    blocks.push(`Direct operator state is missing or invalid at ${relative(operatorStatePath)}.`)
  } else if (operatorState.killSwitchEngaged) {
    blocks.push('QORE kill switch became engaged before broker mutation.')
  }
  if (brokerMode === 'live') blocks.push(...liveGitStateBlocks())
  return blocks
}

async function mutationBoundaryBlocks({ accountStatePersisted = false } = {}) {
  if (brokerMode === 'dry-run') return []
  const blocks = localMutationBoundaryBlocks()
  if (blocks.length) return blocks
  if (!accountStatePersisted) {
    try {
      await persistMutationBoundaryAccountState()
    } catch (error) {
      blocks.push(`Fresh account/risk-ledger persistence failed before broker mutation: ${error.message}`)
    }
  }
  if (blocks.length) return blocks
  try {
    const clock = await alpacaRequest('GET', '/v2/clock')
    blocks.push(...clockSafetyBlocks(clock, 'Mutation-boundary Alpaca market clock'))
  } catch (error) {
    blocks.push(`Alpaca market-clock recheck failed before broker mutation: ${error.message}`)
  }
  return blocks
}

async function assertMutationBoundary(options = {}) {
  const blocks = await mutationBoundaryBlocks(options)
  if (blocks.length) {
    const error = new Error(`Mutation safety recheck blocked: ${blocks.join(' ')}`)
    error.qoreMutationBoundary = true
    throw error
  }
}

async function alpacaMutationRequest(method, endpoint, body = null, { deferConfirmation = false } = {}) {
  brokerMutationStarted = true
  brokerMutationOutcomeUncertain = true
  try {
    const result = await alpacaRequest(method, endpoint, body)
    if (!deferConfirmation) brokerMutationOutcomeUncertain = false
    return result
  } catch (error) {
    if (error?.qoreDefinitiveBrokerResponse && !deferConfirmation) brokerMutationOutcomeUncertain = false
    throw error
  }
}

async function cancelOpenOrder(openOrder, expectedQuantities) {
  const brokerOrderId = openOrderId(openOrder)
  if (!brokerOrderId) {
    throw new Error(`Open order for ${openOrder?.symbol ?? 'unknown symbol'} is missing an Alpaca order id.`)
  }
  const initialFilledQuantity = finiteNumber(openOrder?.filled_qty ?? openOrder?.filledQuantity)
  if (initialFilledQuantity === null || initialFilledQuantity !== 0) {
    throw new Error(`Open order ${brokerOrderId} must have filled_qty exactly zero before safe replacement.`)
  }
  await assertMutationBoundary()
  const raw = await alpacaMutationRequest(
    'DELETE',
    `/v2/orders/${encodeURIComponent(String(brokerOrderId))}`,
    null,
    { deferConfirmation: true },
  )
  let confirmedOrder
  let positions
  try {
    ;[confirmedOrder, positions] = await Promise.all([
      getAlpacaOrderById(brokerOrderId),
      alpacaRequest('GET', '/v2/positions'),
    ])
  } catch (error) {
    throw new Error(`Cancellation state for Alpaca order ${brokerOrderId} could not be verified: ${error.message}`)
  }
  const confirmedStatus = String(confirmedOrder?.status ?? '').toLowerCase()
  const confirmedFilledQuantity = finiteNumber(confirmedOrder?.filled_qty ?? confirmedOrder?.filledQuantity)
  if (confirmedStatus !== 'canceled') {
    throw new Error(
      `Alpaca order ${brokerOrderId} is ${confirmedStatus || 'unknown'} after cancellation; the original reconcile delta is no longer provably valid.`,
    )
  }
  if (confirmedFilledQuantity === null || confirmedFilledQuantity !== 0) {
    throw new Error(
      `Canceled Alpaca order ${brokerOrderId} reports filled_qty ${confirmedFilledQuantity ?? 'unknown'} instead of exactly zero; rebuild the reconcile delta from converged positions.`,
    )
  }
  const freshQuantities = currentQuantitiesFromPositions(positions)
  const expectedQuantity = Number(expectedQuantities?.[openOrder.symbol] ?? 0)
  const freshQuantity = Number(freshQuantities[openOrder.symbol] ?? 0)
  if (Math.abs(freshQuantity - expectedQuantity) > 0.000001) {
    throw new Error(
      `Alpaca ${openOrder.symbol} position changed from ${expectedQuantity} to ${freshQuantity} while order ${brokerOrderId} was canceled; the original reconcile delta is stale.`,
    )
  }
  brokerMutationOutcomeUncertain = false
  return {
    symbol: openOrder.symbol,
    brokerOrderId,
    status: 'canceled',
    canceledAt: new Date().toISOString(),
    raw,
    confirmedOrder: {
      status: confirmedStatus,
      filledQuantity: confirmedFilledQuantity,
    },
  }
}

async function cancelMatchingOpenOrders(openOrders, plannedOrders, expectedQuantities) {
  const plannedSymbols = new Set(plannedOrders.map((order) => order.symbol))
  const cancellationResults = []
  let haltedReason = null
  for (const openOrder of matchingOpenOrders(openOrders, plannedSymbols)) {
    try {
      cancellationResults.push(await cancelOpenOrder(openOrder, expectedQuantities))
    } catch (error) {
      cancellationResults.push({
        symbol: openOrder?.symbol ?? 'unknown',
        brokerOrderId: openOrderId(openOrder),
        status: 'cancel_failed',
        canceledAt: new Date().toISOString(),
        message: error.message,
      })
      haltedReason = error.message
      break
    }
  }
  return { cancellationResults, haltedReason }
}

async function replaceOpenOrdersForPlannedSymbols(openOrders, plannedOrders, expectedQuantities) {
  const plannedSymbols = new Set(plannedOrders.map((order) => order.symbol))
  const cancellation = await cancelMatchingOpenOrders(openOrders, plannedOrders, expectedQuantities)
  const { cancellationResults, haltedReason } = cancellation
  const blockedSymbols = new Set()
  let verification = {
    checkedAt: new Date().toISOString(),
    status: 'not-needed',
    remainingOpenOrders: [],
  }

  if (haltedReason) {
    for (const symbol of plannedSymbols) blockedSymbols.add(symbol)
    verification = {
      checkedAt: new Date().toISOString(),
      status: 'not-attempted-after-cancel-failure',
      remainingOpenOrders: [],
      message: haltedReason,
    }
  } else if (cancellationResults.length > 0) {
    try {
      const refreshedOpenOrders = await getAlpacaOpenOrders()
      const remainingOpenOrders = matchingOpenOrders(refreshedOpenOrders, plannedSymbols).map((order) => ({
        symbol: order.symbol,
        brokerOrderId: openOrderId(order),
        status: order.status ?? null,
      }))
      for (const order of remainingOpenOrders) blockedSymbols.add(order.symbol)
      if (remainingOpenOrders.length) {
        for (const symbol of plannedSymbols) blockedSymbols.add(symbol)
      }
      verification = {
        checkedAt: new Date().toISOString(),
        status: remainingOpenOrders.length ? 'open-orders-remain' : 'clear',
        remainingOpenOrders,
      }
    } catch (error) {
      for (const symbol of plannedSymbols) blockedSymbols.add(symbol)
      verification = {
        checkedAt: new Date().toISOString(),
        status: 'verify_failed',
        remainingOpenOrders: [],
        message: error.message,
      }
    }
  }

  return {
    enabled: true,
    cancellationResults,
    verification,
    halted: blockedSymbols.size > 0,
    blockedSymbols,
  }
}

function accountShortingEnabled(brokerSnapshot) {
  const value = brokerSnapshot?.rawAccount?.shortingEnabled
  if (value === true) return true
  if (value === false) return false
  if (truthy(value)) return true
  if (falsey(value)) return false
  return null
}

function ungAssetBorrowBlocks(asset) {
  const blocks = []
  if (asset?.shortable !== true) {
    blocks.push('Alpaca must explicitly report shortable=true for UNG.')
    return blocks
  }
  const borrowStatus = String(asset?.borrow_status ?? '').toLowerCase()
  const easyBorrowFlag = asset?.easy_to_borrow
  const statusReportsEasy = borrowStatus === 'easy_to_borrow'
  const statusReportsHard = borrowStatus === 'hard_to_borrow'
  if (typeof easyBorrowFlag !== 'boolean') {
    blocks.push('Alpaca easy_to_borrow must be explicitly boolean before UNG short exposure can increase.')
    return blocks
  }
  if (borrowStatus && !statusReportsEasy && !statusReportsHard) {
    blocks.push(`Alpaca returned an unrecognized UNG borrow_status value: ${borrowStatus}.`)
    return blocks
  }
  if (
    (easyBorrowFlag === true && statusReportsHard)
    || (easyBorrowFlag === false && statusReportsEasy)
  ) {
    blocks.push('Alpaca returned conflicting UNG borrow-availability fields.')
    return blocks
  }
  const easyBorrowConfirmed = easyBorrowFlag === true || statusReportsEasy
  // Alpaca's asset response represents HTB as shortable=true with
  // easy_to_borrow=false; borrow_status is accepted when present.
  const hardToBorrowConfirmed = easyBorrowFlag === false || statusReportsHard
  if (easyBorrowConfirmed) return blocks
  if (hardToBorrowConfirmed) {
    if (!allowHardToBorrow) {
      blocks.push('Alpaca reports UNG is hard-to-borrow; QORE_ALPACA_ALLOW_HARD_TO_BORROW is not enabled.')
    }
    return blocks
  }
  blocks.push('Alpaca did not provide a recognized positive UNG borrow-availability state.')
  return blocks
}

async function shortabilityBlocks(plannedOrders, brokerSnapshot) {
  const blocks = []
  const needsUngShort = plannedOrders.some(orderIncreasesUngShortExposure)
  if (!needsUngShort) return blocks
  if (!allowShorts) {
    blocks.push('Negative UNG target requires QORE_ALPACA_ALLOW_SHORTS=1 and a margin/short-capable account.')
    return blocks
  }
  const shortingEnabled = accountShortingEnabled(brokerSnapshot)
  if (shortingEnabled === false) {
    blocks.push('Alpaca account does not have shorting enabled; use a margin/short-capable account before routing negative UNG targets.')
    return blocks
  }
  if (shortingEnabled === null && brokerMode !== 'dry-run') {
    blocks.push('Alpaca account shorting capability could not be verified before routing a negative UNG target.')
    return blocks
  }
  if (!alpacaConfig.apiKey || !alpacaConfig.secretKey) return blocks
  const asset = await alpacaRequest('GET', '/v2/assets/UNG')
  blocks.push(...ungAssetBorrowBlocks(asset))
  return blocks
}

function signalAgeBlock(signalSnapshot, asOf = currentTime()) {
  if (brokerMode === 'dry-run' && allowStaleSignal) return null
  const issueDate = signalSnapshot?.inference?.forecastValidation?.latestCommonIssueDate
  const targetDate = signalSnapshot?.intent?.targetDate
  const freshnessDate = brokerMode === 'dry-run' ? issueDate ?? targetDate : issueDate
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(freshnessDate ?? ''))
    ? dateOrNull(`${freshnessDate}T00:00:00Z`)
    : null
  const validDate = parsedDate?.toISOString().slice(0, 10) === freshnessDate ? parsedDate : null
  const today = Date.parse(`${asOf.toISOString().slice(0, 10)}T00:00:00Z`)
  const age = validDate ? (today - validDate.getTime()) / 86400000 : null
  if (signalSnapshot.stale || age === null || age < 0 || age > alpacaLiveRiskPolicy.maxSignalAgeDays) {
    const source = issueDate ? 'validated inference issue date' : brokerMode === 'dry-run' ? 'target date' : 'validated inference issue date'
    const detail = age === null
      ? brokerMode === 'dry-run'
        ? 'no valid validated inference issue date or target date'
        : 'no valid validated inference issue date'
      : `${source} ${freshnessDate} is ${round(age, 2)} days old`
    return `Signal intent is stale (${detail}). Refresh data/signals before routing.`
  }
  return null
}

function liveGitStateBlocks() {
  if (brokerMode !== 'live') return []
  const state = inspectGitWorkingTree(repoDir)
  if (!state.readable) {
    return [`Live routing requires a readable Git working tree state: ${state.error}`]
  }
  if (state.codeOrConfigPaths.length) {
    return [
      `Live routing requires a clean code/config working tree; found ${state.codeOrConfigPaths.length} disallowed change(s). `
      + 'Deploy a reviewed commit before submitting real-money orders.',
    ]
  }
  return []
}

function liveConfirmationBlocks() {
  if (brokerMode !== 'live') return []
  const blocks = []
  if (!localTestEndpointsConfirmed() && alpacaConfig.baseUrl !== alpacaLiveBaseUrl) {
    blocks.push(`Live mode requires the exact Alpaca live endpoint ${alpacaLiveBaseUrl}.`)
  }
  if (!truthy(process.env.QORE_LIVE_TRADING_ENABLED)) blocks.push('QORE_LIVE_TRADING_ENABLED=1 is required for real-money orders.')
  if (!truthy(process.env.QORE_LIVE_ORDER_ROUTING_ENABLED)) blocks.push('QORE_LIVE_ORDER_ROUTING_ENABLED=1 is required for real-money orders.')
  if (process.env.QORE_CONFIRM_LIVE_TRADING !== 'I_UNDERSTAND_THIS_CAN_LOSE_MONEY') {
    blocks.push('QORE_CONFIRM_LIVE_TRADING must equal I_UNDERSTAND_THIS_CAN_LOSE_MONEY.')
  }
  return blocks
}

function paperConfirmationBlocks() {
  if (brokerMode !== 'paper') return []
  const blocks = []
  if (!localTestEndpointsConfirmed() && alpacaConfig.baseUrl !== alpacaPaperBaseUrl) {
    blocks.push(`Paper mode requires the exact Alpaca paper endpoint ${alpacaPaperBaseUrl}.`)
  }
  if (!truthy(process.env.QORE_PAPER_ORDER_ROUTING_ENABLED) && !args.has('--execute')) {
    blocks.push('Paper order submission requires QORE_PAPER_ORDER_ROUTING_ENABLED=1 or --execute.')
  }
  return blocks
}

function spreadBpsBySymbol(marketSnapshot, quoteSnapshot = null) {
  const spreads = {}
  for (const row of marketSnapshot?.rows ?? []) {
    const spread = finiteNumber(row?.spreadBps)
    if (row?.symbol && spread !== null) spreads[row.symbol] = spread
  }
  Object.assign(spreads, quoteSnapshot?.spreadsBps ?? {})
  return spreads
}

function symbolsWithRequiredMarketChecks({ plannedOrders, skippedOrders, targets, current }) {
  const symbols = new Set([...plannedOrders, ...skippedOrders].map((order) => order.symbol))
  for (const [symbol, targetNotionalUsd] of Object.entries(targets)) {
    if (Math.abs(Number(targetNotionalUsd ?? 0)) > 0 || Math.abs(Number(current[symbol] ?? 0)) > 0) {
      symbols.add(symbol)
    }
  }
  return [...symbols].filter((symbol) => alpacaLiveRiskPolicy.allowedInstruments.has(symbol))
}

function riskSnapshotSafetyChecks(riskSnapshot, asOf = currentTime()) {
  const checks = []
  const addCheck = (id, label, status, detail) => checks.push({ id, label, status, detail })

  if (brokerMode !== 'dry-run') {
    const riskGeneratedAt = dateOrNull(riskSnapshot?.generatedAt)
    const riskAgeSeconds = riskGeneratedAt ? (asOf.getTime() - riskGeneratedAt.getTime()) / 1000 : null
    if (riskAgeSeconds === null) {
      addCheck(
        'risk-snapshot-freshness',
        'Risk snapshot freshness',
        'block',
        'Risk snapshot generatedAt is missing or invalid.',
      )
    } else if (riskAgeSeconds < -alpacaLiveRiskPolicy.maxRiskSnapshotFutureSkewSeconds) {
      addCheck(
        'risk-snapshot-freshness',
        'Risk snapshot freshness',
        'block',
        `Risk snapshot is ${Math.abs(riskAgeSeconds).toFixed(1)}s future-dated; tolerance is ${alpacaLiveRiskPolicy.maxRiskSnapshotFutureSkewSeconds}s.`,
      )
    } else if (riskAgeSeconds > alpacaLiveRiskPolicy.maxRiskSnapshotAgeSeconds) {
      addCheck(
        'risk-snapshot-freshness',
        'Risk snapshot freshness',
        'block',
        `Risk snapshot is ${riskAgeSeconds.toFixed(1)}s old; cap is ${alpacaLiveRiskPolicy.maxRiskSnapshotAgeSeconds}s.`,
      )
    }
  }

  const operator = riskSnapshot?.operator
  if (
    brokerMode !== 'dry-run'
    && alpacaLiveRiskPolicy.requireOperatorContext
    && typeof operator?.killSwitchEngaged !== 'boolean'
  ) {
    addCheck(
      'operator-context',
      'Operator state',
      'block',
      `Explicit operator state with a boolean killSwitchEngaged value is required at ${relative(operatorStatePath)}.`,
    )
  } else if (operator?.killSwitchEngaged === true) {
    addCheck('operator-kill-switch', 'Operator kill switch', 'block', 'QORE kill switch is engaged.')
  }

  if (brokerMode !== 'dry-run') {
    const readiness = riskSnapshot?.readiness ?? {}
    for (const [key, present] of Object.entries({
      accountContextPresent: readiness.accountContextPresent,
      marketContextPresent: readiness.marketContextPresent,
      weatherContextPresent: readiness.weatherContextPresent,
      storageContextPresent: readiness.storageContextPresent,
      storageInferenceCoherent: readiness.storageInferenceCoherent,
    })) {
      if (present !== true) {
        addCheck(
          `risk-readiness-${key}`,
          'Paper/live risk readiness',
          'block',
          `Paper/live risk context is incomplete: ${key} is not true.`,
        )
      }
    }
  }

  const weather = riskSnapshot?.weather
  if (alpacaLiveRiskPolicy.requireFreshWeatherContext && !weather) {
    addCheck('weather-context', 'Weather context', 'block', 'Fresh weather model context is required.')
  } else if (weather) {
    const weatherAgeHours = ageHours(asOf, weather.forecastIssuedAt)
    if (
      weatherAgeHours === null
      || weatherAgeHours < 0
      || weatherAgeHours > alpacaLiveRiskPolicy.maxWeatherIssueAgeHours
    ) {
      addCheck(
        'weather-freshness',
        'Weather issue freshness',
        'block',
        weatherAgeHours === null
          ? 'Weather issue time is invalid.'
          : `Weather issue is ${weatherAgeHours.toFixed(1)}h old; cap is ${alpacaLiveRiskPolicy.maxWeatherIssueAgeHours}h.`,
      )
    }
    const sourceCount = finiteNumber(weather.sourceCount)
    if (sourceCount === null || sourceCount < alpacaLiveRiskPolicy.minWeatherSourceCount) {
      addCheck(
        'weather-source-count',
        'Weather source count',
        'block',
        `${sourceCount ?? 0} weather source(s) supplied; floor is ${alpacaLiveRiskPolicy.minWeatherSourceCount}.`,
      )
    }
    const coveragePct = finiteNumber(weather.coveragePct)
    if (coveragePct === null || coveragePct < alpacaLiveRiskPolicy.minWeatherCoveragePct) {
      addCheck(
        'weather-coverage',
        'Weather coverage',
        'block',
        `Weather coverage ${coveragePct ?? 0}% is below the ${alpacaLiveRiskPolicy.minWeatherCoveragePct}% floor.`,
      )
    }
    const directionalAccuracyPct = finiteNumber(weather.directionalAccuracyPct)
    if (directionalAccuracyPct !== null && directionalAccuracyPct < alpacaLiveRiskPolicy.minWeatherDirectionalAccuracyPct) {
      addCheck(
        'weather-directional-accuracy',
        'Weather directional accuracy',
        'warn',
        `Weather directional accuracy ${directionalAccuracyPct}% is below the ${alpacaLiveRiskPolicy.minWeatherDirectionalAccuracyPct}% caution line.`,
      )
    }
  }

  const storage = riskSnapshot?.storage
  if (alpacaLiveRiskPolicy.requireStorageContext && !storage) {
    addCheck('storage-context', 'Storage context', 'block', 'Fresh EIA storage context is required.')
  } else if (storage) {
    const storageAgeDays = ageDays(asOf, storage.reportedAt)
    if (storageAgeDays === null || storageAgeDays < 0 || storageAgeDays > alpacaLiveRiskPolicy.maxStorageDataAgeDays) {
      addCheck(
        'storage-freshness',
        'Storage freshness',
        'block',
        storageAgeDays === null ? 'Storage report time is invalid.' : `Storage report is ${storageAgeDays.toFixed(1)}d old; cap is ${alpacaLiveRiskPolicy.maxStorageDataAgeDays}d.`,
      )
    }
  }

  return checks
}

function liveRiskPolicyGate({ signalSnapshot, riskSnapshot, marketSnapshot, quoteSnapshot, brokerSnapshot, prices, targets, current, plannedOrders, skippedOrders, exposurePlan }) {
  const blocks = []
  const warnings = []
  const checks = []
  const asOf = currentTime()
  const addCheck = (id, label, status, detail) => {
    checks.push({ id, label, status, detail })
    if (status === 'block') blocks.push(detail)
    if (status === 'warn') warnings.push(detail)
  }
  const intent = signalSnapshot.intent ?? {}

  if (brokerMode !== 'dry-run') {
    const rawAccount = brokerSnapshot?.rawAccount ?? {}
    if (rawAccount.status !== 'ACTIVE') {
      addCheck('account-active', 'Broker account active', 'block', `Alpaca account status is ${rawAccount.status ?? 'unknown'}; ACTIVE is required.`)
    }
    if (rawAccount.tradingBlocked !== false) {
      addCheck('account-trading-blocked', 'Broker trading permission', 'block', `Alpaca trading_blocked must be exactly false (received ${rawAccount.tradingBlocked ?? 'unknown'}).`)
    }
    if (rawAccount.accountBlocked !== false) {
      addCheck('account-blocked', 'Broker account permission', 'block', `Alpaca account_blocked must be exactly false (received ${rawAccount.accountBlocked ?? 'unknown'}).`)
    }
    if (rawAccount.tradeSuspendedByUser !== false) {
      addCheck('account-user-suspended', 'Broker user suspension', 'block', `Alpaca trade_suspended_by_user must be exactly false (received ${rawAccount.tradeSuspendedByUser ?? 'unknown'}).`)
    }
  }

  const dayPnlPct = finiteNumber(brokerSnapshot?.account?.dayPnlPct)
  if (brokerMode !== 'dry-run' && dayPnlPct === null) {
    addCheck('daily-loss-stop', 'Daily loss stop', 'block', 'Daily P&L is unavailable because Alpaca last_equity is missing, invalid, or zero.')
  } else if (dayPnlPct !== null && dayPnlPct <= -Math.abs(alpacaLiveRiskPolicy.maxDailyLossPct)) {
    addCheck('daily-loss-stop', 'Daily loss stop', 'block', `Daily P&L ${dayPnlPct}% breaches the ${alpacaLiveRiskPolicy.maxDailyLossPct}% loss stop.`)
  }
  const trailingDrawdownPct = finiteNumber(brokerSnapshot?.account?.trailingDrawdownPct)
  if (trailingDrawdownPct !== null && trailingDrawdownPct <= -Math.abs(alpacaLiveRiskPolicy.maxTrailingDrawdownPct)) {
    addCheck(
      'trailing-drawdown-stop',
      'Trailing drawdown stop',
      'block',
      `Trailing drawdown ${trailingDrawdownPct}% breaches the ${alpacaLiveRiskPolicy.maxTrailingDrawdownPct}% stop.`,
    )
  }

  if (exposurePlan?.blocks?.length) {
    for (const detail of exposurePlan.blocks) {
      addCheck('gross-exposure-cap', 'Gross exposure cap', 'block', detail)
    }
  }

  for (const symbol of [intent.instrument, ...Object.keys(targets)].filter(Boolean)) {
    if (!alpacaLiveRiskPolicy.allowedInstruments.has(symbol)) {
      addCheck('instrument-allowed', 'Allowed instrument', 'block', `${symbol} is not allowed by ${alpacaLiveRiskPolicy.id}.`)
    }
  }

  const confidence = finiteNumber(intent.confidence)
  if (confidence === null) {
    addCheck('confidence-scale', 'Confidence scale', 'block', 'Signal confidence is missing or not numeric.')
  } else {
    if (confidence < alpacaLiveRiskPolicy.minConfidence) {
      addCheck('confidence-minimum', 'Minimum confidence', 'block', `Signal confidence ${confidence} is below ${alpacaLiveRiskPolicy.minConfidence}.`)
    }
    if (confidence > alpacaLiveRiskPolicy.maxConfidence) {
      addCheck('confidence-maximum', 'Maximum confidence', 'block', `Signal confidence ${confidence} is above ${alpacaLiveRiskPolicy.maxConfidence}.`)
    }
  }

  for (const check of riskSnapshotSafetyChecks(riskSnapshot, asOf)) {
    addCheck(check.id, check.label, check.status, check.detail)
  }

  const market = riskSnapshot?.market
  const marketPriceUpdatedAt = quoteSnapshot?.generatedAt ?? market?.priceUpdatedAt ?? marketSnapshot?.freshness?.freshestPriceUpdatedAt
  if (alpacaLiveRiskPolicy.requireMarketContext && !marketPriceUpdatedAt) {
    addCheck('market-context', 'Market context', 'block', 'Fresh market price context is required.')
  } else if (marketPriceUpdatedAt) {
    const marketAgeMinutes = ageMinutes(asOf, marketPriceUpdatedAt)
    if (marketAgeMinutes === null || marketAgeMinutes < 0 || marketAgeMinutes > alpacaLiveRiskPolicy.maxMarketDataAgeMinutes) {
      addCheck(
        'market-freshness',
        'Market data freshness',
        'block',
        marketAgeMinutes === null
          ? 'Market update time is invalid.'
          : `Market prices are ${marketAgeMinutes.toFixed(0)}m old; cap is ${alpacaLiveRiskPolicy.maxMarketDataAgeMinutes}m.`,
      )
    }
  }

  const spreads = spreadBpsBySymbol(marketSnapshot, quoteSnapshot)
  const quotesBySymbol = Object.fromEntries((quoteSnapshot?.rows ?? []).map((row) => [row.symbol, row]))
  for (const symbol of symbolsWithRequiredMarketChecks({ plannedOrders, skippedOrders, targets, current })) {
    const quote = quotesBySymbol[symbol]
    if (brokerMode !== 'dry-run' && quote?.status !== 'ok') {
      addCheck(
        `quote-validity-${symbol}`,
        `${symbol} quote validity`,
        'block',
        `Alpaca returned a missing or invalid bid/ask quote for ${symbol}.`,
      )
    }
    const price = finiteNumber(prices[symbol] ?? market?.referencePrices?.[symbol] ?? marketSnapshot?.referencePrices?.[symbol])
    if (price === null || price <= 0) {
      addCheck(`reference-price-${symbol}`, `${symbol} reference price`, 'block', `Missing positive reference price for ${symbol}.`)
    } else if (price < alpacaLiveRiskPolicy.minReferencePriceUsd) {
      addCheck(
        `reference-price-${symbol}`,
        `${symbol} reference price`,
        'block',
        `${symbol} reference price $${price} is below $${alpacaLiveRiskPolicy.minReferencePriceUsd}.`,
      )
    }

    const spread = finiteNumber(brokerMode === 'dry-run' ? market?.spreadsBps?.[symbol] ?? spreads[symbol] : quote?.spreadBps)
    if (spread === null || spread < 0) {
      addCheck(
        `spread-${symbol}`,
        `${symbol} spread`,
        'block',
        `Missing finite non-negative spread for ${symbol}; cap is ${alpacaLiveRiskPolicy.maxAllowedSpreadBps} bps.`,
      )
    } else if (spread > alpacaLiveRiskPolicy.maxAllowedSpreadBps) {
      addCheck(`spread-${symbol}`, `${symbol} spread`, 'block', `${symbol} spread ${spread} bps exceeds the ${alpacaLiveRiskPolicy.maxAllowedSpreadBps} bps cap.`)
    }

    const quoteAgeMinutes = ageMinutes(asOf, quote?.quoteTimestamp)
    if (brokerMode !== 'dry-run' && (quoteAgeMinutes === null || quoteAgeMinutes < 0 || quoteAgeMinutes > alpacaLiveRiskPolicy.maxQuoteAgeMinutes)) {
      addCheck(
        `quote-freshness-${symbol}`,
        `${symbol} quote freshness`,
        'block',
        quoteAgeMinutes === null
          ? `Missing valid Alpaca quote timestamp for ${symbol}.`
          : `${symbol} quote is ${quoteAgeMinutes.toFixed(2)}m old; cap is ${alpacaLiveRiskPolicy.maxQuoteAgeMinutes}m.`,
      )
    }
  }

  return { blocks, warnings, checks }
}

function contextBlocks({ signalSnapshot, riskSnapshot, marketSnapshot, quoteSnapshot, quoteError, brokerSnapshot, prices, targets, current, plannedOrders, skippedOrders, exposurePlan }) {
  const blocks = []
  const warnings = []
  const staleBlock = signalAgeBlock(signalSnapshot)
  if (staleBlock) blocks.push(staleBlock)
  if (brokerMode !== 'dry-run' && signalSnapshot?.inference?.liveForecastAppliedToTarget !== true) {
    blocks.push('Current live forecast has not been applied to the all-year target; paper/live routing is disabled.')
  }
  if (brokerMode !== 'dry-run' && signalSnapshot?.inference?.validated !== true) {
    blocks.push('Current live forecast inference is not validated; paper/live routing is disabled.')
  }
  if (brokerMode !== 'dry-run') {
    for (const detail of liveInferenceProvenanceBlocks(signalSnapshot, currentTime())) {
      blocks.push(`Current live forecast provenance is invalid: ${detail}.`)
    }
  }

  if (alpacaLiveRiskPolicy.requireAccountContext && (!brokerSnapshot?.account?.equityUsd || brokerSnapshot.account.equityUsd <= 0)) {
    blocks.push('Broker account equity is missing or zero.')
  }
  if (brokerMode !== 'dry-run') {
    blocks.push(...clockSafetyBlocks(brokerSnapshot?.marketClock, 'Initial Alpaca market clock'))
  } else if (riskSnapshot?.operator?.venueOpen === false && !allowOutsideMarketQueue) {
    blocks.push('Execution venue is closed; dry-run planning is disabled.')
  }
  if (!riskSnapshot) {
    const message = `Risk state file is missing at ${relative(riskStatePath)}.`
    if (brokerMode === 'live') blocks.push(message)
    else warnings.push(message)
  }
  if (quoteError) blocks.push(`Alpaca latest quote check failed: ${quoteError}`)

  for (const symbol of Object.keys(targets)) {
    if (!Number.isFinite(Number(prices[symbol])) || Number(prices[symbol]) <= 0) {
      blocks.push(`Missing positive reference price for ${symbol}.`)
    }
  }
  if (skippedOrders.length > 0) {
    const skippedSymbols = [...new Set(skippedOrders.map((order) => order.symbol))].join(', ')
    blocks.push(
      `Required delta order(s) for ${skippedSymbols} were skipped because open orders already exist and QORE_ALPACA_REPLACE_OPEN_ORDERS is not enabled.`,
    )
  }
  if (!marketSnapshot?.freshness?.freshestPriceUpdatedAt) warnings.push('Market reference freshness timestamp is missing.')
  const riskGate = liveRiskPolicyGate({ signalSnapshot, riskSnapshot, marketSnapshot, quoteSnapshot, brokerSnapshot, prices, targets, current, plannedOrders, skippedOrders, exposurePlan })
  return {
    blocks: [...blocks, ...riskGate.blocks],
    warnings: [...warnings, ...riskGate.warnings],
    riskPolicyChecks: riskGate.checks,
  }
}

function orderResultFailed(result) {
  return ['rejected', 'canceled', 'expired', 'blocked'].includes(String(result?.status ?? '').toLowerCase())
}

function summarizeExecution({ preflightApproved, dryRun, plannedOrders, orderResults, openOrderReplacement }) {
  const failedOrderCount = preflightApproved ? orderResults.filter(orderResultFailed).length : 0
  const skippedOrderCount = orderResults.filter((result) => result.status === 'skipped').length
  const replacementFailed =
    openOrderReplacement?.verification?.status === 'verify_failed' ||
    (openOrderReplacement?.cancellationResults ?? []).some((result) => result.status !== 'canceled') ||
    (openOrderReplacement?.verification?.remainingOpenOrders ?? []).length > 0
  const replacementBlockedOrderCount = preflightApproved
    ? orderResults.filter((result) => result.status === 'blocked' && result.message?.includes('Open-order replacement')).length
    : 0

  if (!preflightApproved) {
    return { executionStatus: 'blocked', executionOk: false, failedOrderCount, replacementBlockedOrderCount, skippedOrderCount }
  }
  if (dryRun) {
    return { executionStatus: 'planned', executionOk: true, failedOrderCount, replacementBlockedOrderCount, skippedOrderCount }
  }
  if (skippedOrderCount > 0) {
    return { executionStatus: 'blocked', executionOk: false, failedOrderCount, replacementBlockedOrderCount, skippedOrderCount }
  }
  if (replacementFailed || replacementBlockedOrderCount > 0) {
    return { executionStatus: 'replace-failed', executionOk: false, failedOrderCount, replacementBlockedOrderCount, skippedOrderCount }
  }
  if (failedOrderCount > 0) {
    return { executionStatus: 'submit-failed', executionOk: false, failedOrderCount, replacementBlockedOrderCount, skippedOrderCount }
  }
  if (plannedOrders.length === 0) {
    return { executionStatus: 'no-op', executionOk: true, failedOrderCount, replacementBlockedOrderCount, skippedOrderCount }
  }
  return { executionStatus: 'submitted', executionOk: true, failedOrderCount, replacementBlockedOrderCount, skippedOrderCount }
}

function executionSnapshotBinding(signalSnapshot, riskSnapshot) {
  return {
    signalSha256: fullSnapshotHash(signalSnapshot),
    riskSha256: fullSnapshotHash(riskSnapshot),
  }
}

function finalSignalSnapshotBlocks(signalSnapshot, expectedSha256, asOf) {
  const blocks = []
  if (fullSnapshotHash(signalSnapshot) !== expectedSha256) {
    blocks.push('Canonical signal intent changed after reconcile planning; the fixed execution plan is stale.')
  }
  try {
    buildTargets(signalSnapshot, 1)
  } catch (error) {
    blocks.push(`Current signal target contract is invalid: ${error.message}`)
  }
  if (signalSnapshot?.inference?.liveForecastAppliedToTarget !== true) {
    blocks.push('Current live forecast has not been applied to the all-year target; paper/live routing is disabled.')
  }
  if (signalSnapshot?.inference?.validated !== true) {
    blocks.push('Current live forecast inference is not validated; paper/live routing is disabled.')
  }
  for (const detail of liveInferenceProvenanceBlocks(signalSnapshot, asOf)) {
    blocks.push(`Current live forecast provenance is invalid: ${detail}.`)
  }
  const staleBlock = signalAgeBlock(signalSnapshot, asOf)
  if (staleBlock) blocks.push(staleBlock)
  return blocks
}

function finalRiskSnapshotBlocks(riskSnapshot, expectedSha256, asOf) {
  const blocks = []
  if (fullSnapshotHash(riskSnapshot) !== expectedSha256) {
    blocks.push('Canonical risk snapshot changed after reconcile planning; the fixed execution plan is stale.')
  }
  blocks.push(
    ...riskSnapshotSafetyChecks(riskSnapshot, asOf)
      .filter((check) => check.status === 'block')
      .map((check) => check.detail),
  )
  return blocks
}

async function dispatchOrderAtFinalSubmissionBoundary(order, executionBinding, priorSubmittedOrders, body) {
  const needsUngBorrow = orderIncreasesUngShortExposure(order)
  let account
  let clock
  let positions
  let openOrders
  let asset
  try {
    ;[account, clock, positions, openOrders, asset] = await Promise.all([
      alpacaRequest('GET', '/v2/account'),
      alpacaRequest('GET', '/v2/clock'),
      alpacaRequest('GET', '/v2/positions'),
      getAlpacaOpenOrders(),
      needsUngBorrow ? alpacaRequest('GET', '/v2/assets/UNG') : Promise.resolve(null),
    ])
  } catch (error) {
    throw new Error(`Final broker-context recheck failed before order submission: ${error.message}`)
  }

  let accountContext
  try {
    accountContext = await accountContextFrom(account, {
      persistRiskLedger: brokerMode !== 'dry-run',
      requireValidRiskLedger: brokerMode !== 'dry-run',
    })
  } catch (error) {
    throw new Error(`Final account/risk-ledger recheck blocked order submission: ${error.message}`)
  }

  let currentSignalSnapshot
  let currentRiskSnapshot
  try {
    currentSignalSnapshot = readSignalIntent()
  } catch (error) {
    throw new Error(`Final canonical signal recheck failed before order submission: ${error.message}`)
  }
  try {
    currentRiskSnapshot = readRiskState()
  } catch (error) {
    throw new Error(`Final canonical risk recheck failed before order submission: ${error.message}`)
  }

  // Everything below is synchronous. Keep this validation immediately adjacent
  // to the POST so no network or filesystem await can stale a checked context.
  const asOf = currentTime()
  const finalCurrent = currentNotionalsFromPositions(positions)
  const finalQuantities = currentQuantitiesFromPositions(positions)
  const finalOrderSymbolQuantity = Number(finalQuantities[order.symbol] ?? 0)
  const newlyObservedMatchingOrders = openOrders.filter((openOrder) => openOrder?.symbol === order.symbol)
  const unobservedSubmittedOrders = unobservedSubmittedOpenOrders(priorSubmittedOrders, openOrders, finalQuantities)
  const finalPrices = currentPricesForFinalExposure(positions, order)
  finalCurrent[order.symbol] = finalOrderSymbolQuantity * Number(order.freshQuote.askPrice)
  const finalExposurePlan = evaluateGrossExposurePlan({
    current: finalCurrent,
    openOrders: [...openOrders, ...unobservedSubmittedOrders],
    plannedOrders: [order],
    prices: finalPrices,
    accountEquityUsd: accountContext.equityUsd,
    assumeMatchingOrdersCanceled: false,
  })
  const blocks = [
    ...localMutationBoundaryBlocks(),
    ...directAccountSafetyBlocks(account, accountContext, 'Final'),
    ...(finalOrderSymbolQuantity !== Number(order.currentSignedQuantity)
      ? [
          `Final ${order.symbol} signed share quantity drifted from ${order.currentSignedQuantity} to ${finalOrderSymbolQuantity}; `
          + 'the fixed reconcile delta is stale.',
        ]
      : []),
    ...(newlyObservedMatchingOrders.length
      ? [
          `Final open-order state contains ${newlyObservedMatchingOrders.length} ${order.symbol} order(s); `
          + 'the fixed reconcile delta is stale.',
        ]
      : []),
    ...finalExposurePlan.blocks,
    ...clockSafetyBlocks(clock, 'Mutation-boundary Alpaca market clock', asOf),
    ...freshQuoteAssessment(order.freshQuote, order.symbol, asOf).blocks,
    ...finalSignalSnapshotBlocks(currentSignalSnapshot, executionBinding.signalSha256, asOf),
    ...finalRiskSnapshotBlocks(currentRiskSnapshot, executionBinding.riskSha256, asOf),
  ]
  if (needsUngBorrow) {
    if (!allowShorts) {
      blocks.push('Negative UNG target requires QORE_ALPACA_ALLOW_SHORTS=1 and a margin/short-capable account.')
    }
    if (account?.shorting_enabled !== true) {
      blocks.push('Final Alpaca account must explicitly report shorting_enabled=true before UNG short exposure can increase.')
    }
    blocks.push(...ungAssetBorrowBlocks(asset))
  }
  if (blocks.length) {
    throw new Error(`Final submission safety recheck blocked ${order.symbol} order: ${blocks.join(' ')}`)
  }
  return alpacaMutationRequest('POST', '/v2/orders', body)
}

async function submitOrder(order, executionBinding, priorSubmittedOrders) {
  const body = {
    symbol: order.symbol,
    side: order.side,
    type: order.orderType,
    time_in_force: order.timeInForce,
    qty: String(order.quantity),
    client_order_id: order.clientOrderId,
  }
  const raw = await dispatchOrderAtFinalSubmissionBoundary(order, executionBinding, priorSubmittedOrders, body)
  return {
    request: order,
    status: raw?.status ?? 'submitted',
    brokerOrderId: raw?.id,
    submittedAt: new Date().toISOString(),
    raw,
  }
}

function pendingOrderAsOpenOrder(order) {
  return {
    symbol: order.symbol,
    side: order.side,
    notional: Number(order.quantity) * Number(order.freshQuote?.askPrice),
    client_order_id: order.clientOrderId,
    status: 'locally-observed-accepted',
  }
}

function submittedOrderReflected(submission, freshQuantities) {
  const order = submission.order
  const signedFillQuantity = order.side === 'buy' ? order.quantity : -order.quantity
  const expectedQuantity = Number(order.currentSignedQuantity) + signedFillQuantity
  // Exact equality is intentionally conservative here. Decimal strings that
  // encode the same quantity parse identically; any arithmetic discrepancy
  // keeps the prior order counted as outstanding rather than dropping exposure.
  return Number(freshQuantities[order.symbol] ?? 0) === expectedQuantity
}

function unobservedSubmittedOpenOrders(priorSubmittedOrders, openOrders, currentQuantities) {
  const observedClientOrderIds = new Set(
    (openOrders ?? [])
      .map((openOrder) => openOrder?.client_order_id ?? openOrder?.clientOrderId)
      .filter(Boolean),
  )
  return priorSubmittedOrders
    .filter((submission) => !observedClientOrderIds.has(submission.order.clientOrderId))
    .filter((submission) => !submittedOrderReflected(submission, currentQuantities))
    .map((submission) => pendingOrderAsOpenOrder(submission.order))
}

function currentPricesForFinalExposure(positions, order) {
  const prices = {}
  for (const position of positions ?? []) {
    if (!position?.symbol || position.symbol === order.symbol) continue
    const price = finiteNumber(position?.current_price ?? position?.asset_current_price)
    if (price !== null && price > 0) prices[position.symbol] = Math.max(prices[position.symbol] ?? 0, price)
  }
  prices[order.symbol] = Number(order.freshQuote.askPrice)
  return prices
}

function orderIncreasesUngShortExposure(order) {
  if (order.symbol !== 'UNG' || order.side !== 'sell') return false
  const currentQuantity = Number(order.currentSignedQuantity)
  const projectedQuantity = currentQuantity - Number(order.quantity)
  return Number.isFinite(currentQuantity) && Number.isFinite(projectedQuantity)
    && projectedQuantity < 0
    && Math.abs(projectedQuantity) > Math.abs(Math.min(0, currentQuantity))
}

function refreshOrderFromQuote(order, freshSignedQuantity, quote, accountEquityUsd) {
  // Size against the same conservative ask valuation used by the refreshed
  // exposure plan. Mixing midpoint target sizing with ask-valued exposure can
  // overshoot the current-equity deployment envelope by the half-spread.
  const currentReferenceNotionalUsd = freshSignedQuantity * quote.askPrice
  const targetDeltaNotionalUsd = Number(order.targetNotionalUsd) - currentReferenceNotionalUsd
  const rebalanceDeadbandUsd = Math.max(0, accountEquityUsd) * (rebalanceDeadbandPct / 100)
  if (Math.abs(targetDeltaNotionalUsd) < rebalanceDeadbandUsd) {
    throw new Error(`Fresh ${order.symbol} quote moved the fixed reconcile delta inside the rebalance deadband.`)
  }
  let deltaNotionalUsd = targetDeltaNotionalUsd
  if (maxOrderUsd && Math.abs(deltaNotionalUsd) > maxOrderUsd) {
    deltaNotionalUsd = Math.sign(deltaNotionalUsd) * maxOrderUsd
  }
  if (Math.abs(deltaNotionalUsd) < minOrderUsd) {
    throw new Error(`Fresh ${order.symbol} quote moved the fixed reconcile delta below the minimum order size.`)
  }
  const side = deltaNotionalUsd > 0 ? 'buy' : 'sell'
  if (side !== order.side) {
    throw new Error(`Fresh ${order.symbol} quote reversed the planned ${order.side} delta to ${side}; the reconcile plan is stale.`)
  }
  const forceWholeShares = order.symbol === 'UNG' && side === 'sell' && Number(order.targetNotionalUsd) < 0
  const quantity = orderQuantity(Math.abs(deltaNotionalUsd), quote.askPrice, forceWholeShares)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Fresh ${order.symbol} quote does not support a positive executable order quantity.`)
  }
  const refreshedOrder = {
    ...order,
    quantity,
    currentSignedQuantity: freshSignedQuantity,
    currentNotionalUsd: round(freshSignedQuantity * quote.askPrice, 2),
    deltaNotionalUsd: round(deltaNotionalUsd, 2),
    estimatedNotionalUsd: round(quantity * quote.askPrice, 2),
    freshQuote: {
      bidPrice: quote.bidPrice,
      askPrice: quote.askPrice,
      midpoint: round(quote.midpoint, 6),
      spreadBps: round(quote.spreadBps, 4),
      quoteTimestamp: quote.quoteTimestamp,
    },
  }
  if (orderIncreasesUngShortExposure(refreshedOrder) && !orderIncreasesUngShortExposure(order)) {
    throw new Error('Fresh UNG quote would turn a previously risk-reducing delta into a short-increasing order; rerun preflight.')
  }
  return refreshedOrder
}

async function assertFreshExposureBeforeOrder({ order, prices, priorSubmittedOrders }) {
  let account
  let positions
  let openOrders
  try {
    ;[account, positions, openOrders] = await Promise.all([
      alpacaRequest('GET', '/v2/account'),
      alpacaRequest('GET', '/v2/positions'),
      getAlpacaOpenOrders(),
    ])
  } catch (error) {
    throw new Error(`Fresh exposure recheck failed before order submission: ${error.message}`)
  }
  let freshAccountContext
  try {
    freshAccountContext = await accountContextFrom(account, {
      persistRiskLedger: brokerMode !== 'dry-run',
      requireValidRiskLedger: brokerMode !== 'dry-run',
    })
  } catch (error) {
    throw new Error(`Fresh account/risk-ledger recheck blocked order submission: ${error.message}`)
  }
  const freshAccountBlocks = brokerMode === 'dry-run' ? [] : directAccountSafetyBlocks(account, freshAccountContext)
  if (freshAccountBlocks.length) {
    throw new Error(`Fresh account safety recheck blocked order submission: ${freshAccountBlocks.join(' ')}`)
  }
  const freshCurrent = currentNotionalsFromPositions(positions)
  const freshQuantities = currentQuantitiesFromPositions(positions)
  const freshOrderSymbolQuantity = Number(freshQuantities[order.symbol] ?? 0)
  if (freshOrderSymbolQuantity !== Number(order.currentSignedQuantity)) {
    throw new Error(
      `Fresh ${order.symbol} signed share quantity drifted from ${order.currentSignedQuantity} to ${freshOrderSymbolQuantity}; `
      + 'the fixed reconcile delta is stale.',
    )
  }
  const newlyObservedMatchingOrders = (openOrders ?? []).filter((openOrder) => openOrder?.symbol === order.symbol)
  if (newlyObservedMatchingOrders.length) {
    throw new Error(
      `Fresh open-order state contains ${newlyObservedMatchingOrders.length} ${order.symbol} order(s); the fixed reconcile delta is stale.`,
    )
  }
  const unobservedSubmittedOrders = unobservedSubmittedOpenOrders(priorSubmittedOrders, openOrders, freshQuantities)
  let freshQuoteSnapshot
  try {
    freshQuoteSnapshot = await getAlpacaLatestQuotes([order.symbol])
  } catch (error) {
    throw new Error(`Fresh ${order.symbol} quote recheck failed before order submission: ${error.message}`)
  }
  const freshQuote = freshQuoteAssessment(freshQuoteSnapshot?.rows?.[0], order.symbol)
  if (freshQuote.blocks.length) {
    throw new Error(`Fresh ${order.symbol} quote recheck blocked order submission: ${freshQuote.blocks.join(' ')}`)
  }
  const refreshedOrder = refreshOrderFromQuote(order, freshOrderSymbolQuantity, freshQuote, freshAccountContext.equityUsd)
  const freshPrices = { ...prices, [order.symbol]: freshQuote.askPrice }
  freshCurrent[order.symbol] = freshOrderSymbolQuantity * freshQuote.askPrice
  const exposurePlan = evaluateGrossExposurePlan({
    current: freshCurrent,
    openOrders: [...(openOrders ?? []), ...unobservedSubmittedOrders],
    plannedOrders: [refreshedOrder],
    prices: freshPrices,
    accountEquityUsd: freshAccountContext.equityUsd,
    assumeMatchingOrdersCanceled: false,
  })
  if (exposurePlan.blocks.length) {
    throw new Error(`Fresh exposure recheck blocked order submission: ${exposurePlan.blocks.join(' ')}`)
  }
  return { exposurePlan, refreshedOrder }
}

async function reconcileOnce() {
  const signalSnapshot = readSignalIntent()
  const marketSnapshot = readMarketReference()
  const riskSnapshot = readRiskState()
  const executionBinding = executionSnapshotBinding(signalSnapshot, riskSnapshot)
  const brokerSnapshot = await getAlpacaBrokerSnapshot({ allowOffline: brokerMode === 'dry-run' })
  const accountEquityUsd = Number(brokerSnapshot?.account?.equityUsd ?? 0)
  const targets = buildTargets(signalSnapshot, accountEquityUsd)
  const current = currentNotionalsFromPositions(brokerSnapshot.positions)
  const currentQuantities = currentQuantitiesFromPositions(brokerSnapshot.positions)
  const quoteSymbols = [...new Set([...Object.keys(targets), ...Object.keys(current)])]
  let quoteSnapshot = null
  let quoteError = null
  if (alpacaConfig.apiKey && alpacaConfig.secretKey) {
    try {
      quoteSnapshot = await getAlpacaLatestQuotes(quoteSymbols)
    } catch (error) {
      quoteError = error.message
    }
  }
  const prices = referencePricesFor(marketSnapshot, brokerSnapshot.positions, quoteSnapshot)
  const { plannedOrders, skippedOrders } = buildPlannedOrders({
    signalSnapshot,
    targets,
    current,
    currentQuantities,
    prices,
    openOrders: brokerSnapshot.openOrders,
    accountEquityUsd,
  })
  const exposurePlan = evaluateGrossExposurePlan({
    current,
    openOrders: brokerSnapshot.openOrders,
    plannedOrders,
    prices,
    accountEquityUsd,
  })
  const gateResult = contextBlocks({
    signalSnapshot,
    riskSnapshot,
    marketSnapshot,
    quoteSnapshot,
    quoteError,
    brokerSnapshot,
    prices,
    targets,
    current,
    plannedOrders,
    skippedOrders,
    exposurePlan,
  })
  const blockedReasons = [
    ...gateResult.blocks,
    ...liveGitStateBlocks(),
    ...liveConfirmationBlocks(),
    ...paperConfirmationBlocks(),
    ...(await shortabilityBlocks(plannedOrders, brokerSnapshot)),
  ]
  const preflightApproved = blockedReasons.length === 0
  const dryRun = brokerMode === 'dry-run' || preflightOnly
  const orderResults = []
  let openOrderReplacement = {
    enabled: replaceOpenOrders,
    cancellationResults: [],
    verification: {
      checkedAt: new Date().toISOString(),
      status: replaceOpenOrders ? 'not-needed' : 'disabled',
      remainingOpenOrders: [],
    },
    blockedSymbols: new Set(),
  }

  for (const order of skippedOrders) {
    orderResults.push({
      request: order,
      status: 'skipped',
      submittedAt: new Date().toISOString(),
      message: 'Existing open order for this symbol must be replaced or cleared before this delta can be reconciled.',
    })
  }

  if (preflightApproved && !dryRun && replaceOpenOrders && plannedOrders.length > 0) {
    openOrderReplacement = await replaceOpenOrdersForPlannedSymbols(
      brokerSnapshot.openOrders,
      plannedOrders,
      currentQuantities,
    )
    if (openOrderReplacement.halted) {
      const replacementReason =
        openOrderReplacement.verification?.message
        ?? openOrderReplacement.cancellationResults.find((result) => result.status !== 'canceled')?.message
        ?? 'Matching open orders could not be canceled and verified clear.'
      blockedReasons.push(`Open-order replacement halted the new-order batch: ${replacementReason}`)
    }
  }

  if (preflightApproved && !dryRun) {
    let submissionHalted = false
    const priorSubmittedOrders = []
    for (const order of plannedOrders) {
      if (submissionHalted) {
        orderResults.push({
          request: order,
          status: 'blocked',
          submittedAt: new Date().toISOString(),
          message: 'A prior order submission failed; remaining orders were halted to prevent unintended gross exposure.',
        })
        continue
      }
      if (openOrderReplacement.blockedSymbols.has(order.symbol)) {
        orderResults.push({
          request: order,
          status: 'blocked',
          submittedAt: new Date().toISOString(),
          message: 'Open-order replacement did not complete cleanly; replacement delta was not submitted.',
        })
        continue
      }
      try {
        const { refreshedOrder } = await assertFreshExposureBeforeOrder({ order, prices, priorSubmittedOrders })
        Object.assign(order, refreshedOrder)
        const submittedOrder = await submitOrder(order, executionBinding, priorSubmittedOrders)
        orderResults.push(submittedOrder)
        if (!orderResultFailed(submittedOrder)) {
          priorSubmittedOrders.push({ order, status: submittedOrder.status })
        }
        if (orderResultFailed(submittedOrder)) submissionHalted = true
      } catch (error) {
        orderResults.push({
          request: order,
          status: 'rejected',
          submittedAt: new Date().toISOString(),
          message: error.message,
        })
        if (!blockedReasons.includes(error.message)) blockedReasons.push(error.message)
        submissionHalted = true
      }
    }
  } else {
    for (const order of plannedOrders) {
      orderResults.push({
        request: order,
        status: dryRun ? 'planned' : 'blocked',
        message: dryRun ? 'Dry run only. No broker order submitted.' : blockedReasons.join(' '),
      })
    }
  }
  const execution = summarizeExecution({
    preflightApproved,
    dryRun,
    plannedOrders,
    orderResults,
    openOrderReplacement,
  })
  const approved = preflightApproved && execution.executionOk

  const result = {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-alpaca-target-weight-reconciler',
    broker: 'alpaca',
    mode: brokerMode,
    dryRun,
    preflightOnly,
    preflightApproved,
    approved,
    executionStatus: execution.executionStatus,
    executionOk: execution.executionOk,
    failedOrderCount: execution.failedOrderCount,
    replacementBlockedOrderCount: execution.replacementBlockedOrderCount,
    skippedOrderCount: execution.skippedOrderCount,
    blockedReasons,
    warnings: gateResult.warnings,
    riskPolicyChecks: gateResult.riskPolicyChecks,
    rawAccount: brokerSnapshot.rawAccount ?? null,
    marketClock: brokerSnapshot.marketClock ?? null,
    marketData: quoteSnapshot
      ? {
          source: quoteSnapshot.source,
          feed: quoteSnapshot.feed,
          generatedAt: quoteSnapshot.generatedAt,
          rows: quoteSnapshot.rows,
        }
      : null,
    account: brokerSnapshot.account,
    signal: {
      strategyId: signalSnapshot.intent.strategyId,
      signalDate: signalSnapshot.intent.signalDate,
      targetDate: signalSnapshot.intent.targetDate,
      direction: signalSnapshot.intent.direction,
      gasPosition: signalSnapshot.intent.gasPosition,
      indexFraction: signalSnapshot.intent.indexFraction,
      stale: signalSnapshot.stale,
      signalAgeDays: signalSnapshot.signalAgeDays,
    },
    targetNotionalUsd: targets,
    currentNotionalUsd: current,
    reconcileConstraints: {
      minOrderUsd,
      rebalanceDeadbandPct,
      allocationPct,
      minCashBufferPct,
      maxGrossExposurePct: alpacaLiveRiskPolicy.maxGrossExposurePct,
      effectiveMinimumRebalanceUsd: round(Math.max(minOrderUsd, accountEquityUsd * (rebalanceDeadbandPct / 100)), 2),
    },
    exposurePlan,
    plannedOrders,
    openOrderReplacement: {
      ...openOrderReplacement,
      blockedSymbols: [...openOrderReplacement.blockedSymbols],
    },
    orderResults,
    files: {
      status: relative(brokerStatusPath),
      accountSnapshot: relative(brokerSnapshotPath),
      orderLog: relative(brokerOrderLogPath),
      riskLedger: relative(brokerRiskLedgerPath),
      signalIntent: relative(signalIntentPath),
      marketReference: relative(marketReferencePath),
      riskState: relative(riskStatePath),
    },
  }
  await writeJson(brokerStatusPath, result)
  await appendJsonl(brokerOrderLogPath, result)
  return result
}

async function statusOnce() {
  const snapshot = await getAlpacaBrokerSnapshot({
    allowOffline: brokerMode === 'dry-run',
    persistRiskLedger: false,
  })
  const credentialsAvailable = Boolean(alpacaConfig.apiKey && alpacaConfig.secretKey)
  const [marketData, portfolioHistoryResult] = await Promise.all([
    credentialsAvailable ? getAlpacaLatestQuotes([...alpacaLiveRiskPolicy.allowedInstruments]) : null,
    credentialsAvailable
      ? getAlpacaPortfolioHistory()
          .then((value) => ({ value, warning: null }))
          .catch((error) => ({ value: null, warning: `Portfolio history is unavailable: ${error.message}` }))
      : { value: null, warning: null },
  ])
  const cachedSnapshotWarning = !credentialsAvailable && snapshot?.sourceGeneratedAt
    ? `Broker credentials are unavailable; account data is cached from ${snapshot.sourceGeneratedAt}.`
    : null
  const sourceGeneratedAt = credentialsAvailable
    ? snapshot?.generatedAt ?? null
    : snapshot?.sourceGeneratedAt ?? null
  const status = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt,
    serviceId: 'qore-alpaca-broker-status',
    broker: 'alpaca',
    mode: brokerMode,
    baseUrl: alpacaConfig.baseUrl,
    paper: alpacaConfig.paper,
    brokerConnected: Boolean(credentialsAvailable && snapshot?.brokerConnected),
    account: snapshot?.account ?? null,
    rawAccount: snapshot?.rawAccount ?? null,
    positions: snapshot?.positions ?? [],
    openOrders: snapshot?.openOrders ?? [],
    marketData,
    marketClock: snapshot?.marketClock ?? null,
    portfolioHistory: portfolioHistoryResult.value,
    warnings: [portfolioHistoryResult.warning, cachedSnapshotWarning].filter(Boolean),
    files: {
      accountSnapshot: relative(brokerSnapshotPath),
      accountStatus: relative(brokerAccountStatusPath),
      reconcileStatus: relative(brokerStatusPath),
    },
  }
  await writeJson(brokerAccountStatusPath, status)
  return status
}

function printResult(result) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  const orderWord = result.plannedOrders?.length === 1 ? 'order' : 'orders'
  if (result.serviceId === 'qore-alpaca-broker-status') {
    console.log(`Alpaca ${result.mode} status: ${result.brokerConnected ? 'connected' : 'offline'}; equity $${round(result.account?.equityUsd ?? 0, 2).toLocaleString()}.`)
    console.log(`Wrote ${result.files.accountStatus}.`)
    return
  }
  console.log(`QORE Alpaca ${result.mode}: ${result.executionStatus ?? (result.approved ? 'approved' : 'blocked')}; planned ${result.plannedOrders.length} ${orderWord}.`)
  if (result.failedOrderCount > 0) console.log(`Failed broker submissions: ${result.failedOrderCount}.`)
  if (result.replacementBlockedOrderCount > 0) console.log(`Replacement-blocked orders: ${result.replacementBlockedOrderCount}.`)
  if (result.skippedOrderCount > 0) console.log(`Skipped required deltas: ${result.skippedOrderCount}.`)
  if (result.blockedReasons.length) {
    for (const reason of result.blockedReasons) console.log(`- ${reason}`)
  }
  console.log(`Wrote ${result.files.status}.`)
}

function resultShouldFailProcess(result) {
  if (result?.serviceId !== 'qore-alpaca-target-weight-reconciler') return false
  return result.executionOk === false || ['replace-failed', 'submit-failed'].includes(result?.executionStatus)
}

function failureStatus(error) {
  return {
    generatedAt: new Date().toISOString(),
    serviceId: statusOnly ? 'qore-alpaca-broker-status' : 'qore-alpaca-target-weight-reconciler',
    broker: 'alpaca',
    mode: brokerMode,
    brokerConnected: false,
    approved: false,
    executionOk: false,
    executionStatus: 'blocked',
    blockedReasons: [error.message],
  }
}

function printFailure(status) {
  if (jsonOutput) console.log(JSON.stringify(status, null, 2))
  else console.error(`QORE Alpaca ${brokerMode}: ${status.blockedReasons[0]}`)
}

async function runCommand() {
  let releaseLock = null
  brokerMutationStarted = false
  brokerMutationOutcomeUncertain = false
  try {
    releaseLock = await acquireBrokerLock()
    try {
      const result = statusOnly ? await statusOnce() : await reconcileOnce()
      printResult(result)
      if (resultShouldFailProcess(result)) process.exitCode = 1
    } catch (error) {
      const status = failureStatus(error)
      await writeJson(statusOnly ? brokerAccountStatusPath : brokerStatusPath, status)
      printFailure(status)
      process.exitCode = 1
    }
  } catch (error) {
    printFailure(failureStatus(error))
    process.exitCode = 1
  } finally {
    if (releaseLock && !brokerMutationOutcomeUncertain) {
      await releaseLock()
      if (activeBrokerLockRelease === releaseLock) activeBrokerLockRelease = null
    } else if (releaseLock) {
      brokerLockRequiresManualCleanup = true
      if (activeBrokerLockRelease === releaseLock) activeBrokerLockRelease = null
      console.error(
        `QORE Alpaca ${brokerMode}: preserving ${relative(brokerLockPath)} because a broker mutation response was not confirmed; reconcile broker state before manual lock removal.`,
      )
    }
  }
}

function requestBrokerShutdown(signal) {
  if (brokerShutdownStarted) return
  brokerShutdownStarted = true
  const exitCode = signal === 'SIGINT' ? 130 : 143
  void (async () => {
    try {
      if (activeBrokerLockRelease && !brokerMutationStarted && !brokerLockRequiresManualCleanup) {
        await activeBrokerLockRelease()
      } else if (activeBrokerLockRelease) {
        console.error(
          `QORE Alpaca ${brokerMode}: preserving ${relative(brokerLockPath)} after signal because a broker mutation began; reconcile broker state before manual lock removal.`,
        )
      }
    } finally {
      activeBrokerLockRelease = null
      process.exit(exitCode)
    }
  })()
}

process.once('SIGINT', () => requestBrokerShutdown('SIGINT'))
process.once('SIGTERM', () => requestBrokerShutdown('SIGTERM'))

if (loop) {
  while (true) {
    await runCommand()
    if (brokerLockRequiresManualCleanup) break
    await new Promise((resolve) => setTimeout(resolve, loopIntervalMs))
  }
}

if (once || statusOnly) await runCommand()
