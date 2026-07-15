#!/usr/bin/env node
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const stateDir = path.resolve(process.env.QORE_LIVE_WEATHER_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'live-weather'))
const brokerDir = path.resolve(process.env.QORE_BROKER_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'broker'))
const signalIntentPath = path.resolve(process.env.QORE_LIVE_SIGNAL_INTENT_FILE ?? path.join(stateDir, 'signal-intent-reconcile.json'))
const marketReferencePath = path.resolve(process.env.QORE_LIVE_MARKET_REFERENCE_FILE ?? path.join(stateDir, 'market-reference-prices.json'))
const riskStatePath = path.resolve(process.env.QORE_LIVE_RISK_STATE_FILE ?? path.join(stateDir, 'risk-and-kill-switch-state.json'))
const operatorStatePath = path.resolve(process.env.QORE_LIVE_OPERATOR_STATE_FILE ?? path.join(stateDir, 'operator-state.json'))
const brokerSnapshotPath = path.resolve(process.env.QORE_BROKER_ACCOUNT_SNAPSHOT_FILE ?? path.join(brokerDir, 'account-snapshot.json'))
const brokerStatusPath = path.resolve(process.env.QORE_BROKER_STATUS_FILE ?? path.join(brokerDir, 'status.json'))
const brokerOrderLogPath = path.resolve(process.env.QORE_BROKER_ORDER_LOG_FILE ?? path.join(brokerDir, 'orders.jsonl'))
const brokerRiskLedgerPath = path.resolve(process.env.QORE_BROKER_RISK_LEDGER_FILE ?? path.join(brokerDir, 'risk-ledger.json'))
const indexBasketConfigPath = path.join(repoDir, 'data', 'qore', 'market', 'index-basket-config.json')

const brokerMode = normalizeBrokerMode(argValue('--mode') ?? process.env.QORE_BROKER_MODE ?? (args.has('--live') ? 'live' : args.has('--paper') ? 'paper' : 'dry-run'))
const loop = args.has('--loop')
const statusOnly = args.has('--status')
const preflightOnly = args.has('--preflight-only')
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
const maxQuoteAgeMinutes = positiveNumber(process.env.QORE_LIVE_MAX_QUOTE_AGE_MINUTES, 5)
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

function compactDate(value) {
  return String(value ?? new Date().toISOString()).slice(0, 10).replaceAll('-', '')
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)
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

async function writeJson(filePath, value) {
  await ensureParent(filePath)
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function appendJsonl(filePath, value) {
  await ensureParent(filePath)
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
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

function localTestEndpointConfirmed() {
  if (process.env.NODE_ENV !== 'test' || !truthy(process.env.QORE_ALPACA_TEST_ENDPOINT_CONFIRMED)) return false
  try {
    const host = new URL(alpacaConfig.baseUrl).hostname
    return ['127.0.0.1', '::1', 'localhost'].includes(host)
  } catch {
    return false
  }
}

function requireCredentials() {
  if (!alpacaConfig.apiKey || !alpacaConfig.secretKey) {
    throw new Error('Missing Alpaca credentials. Set APCA_API_KEY_ID and APCA_API_SECRET_KEY in .env.local.')
  }
}

async function alpacaRequest(method, endpoint, body = null) {
  requireCredentials()
  const response = await fetch(`${alpacaConfig.baseUrl}${endpoint}`, {
    method,
    headers: {
      'APCA-API-KEY-ID': alpacaConfig.apiKey,
      'APCA-API-SECRET-KEY': alpacaConfig.secretKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    const detail = payload?.message ?? payload?.code ?? text
    throw new Error(`Alpaca ${method} ${endpoint} failed with ${response.status}: ${detail}`)
  }
  return payload
}

async function alpacaDataRequest(endpoint) {
  requireCredentials()
  const response = await fetch(`${alpacaDataBaseUrl}${endpoint}`, {
    headers: {
      'APCA-API-KEY-ID': alpacaConfig.apiKey,
      'APCA-API-SECRET-KEY': alpacaConfig.secretKey,
    },
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    const detail = payload?.message ?? payload?.code ?? text
    throw new Error(`Alpaca market data GET ${endpoint} failed with ${response.status}: ${detail}`)
  }
  return payload
}

async function getAlpacaLatestQuotes(symbols) {
  const uniqueSymbols = [...new Set(symbols)].filter((symbol) => alpacaLiveRiskPolicy.allowedInstruments.has(symbol))
  if (!uniqueSymbols.length) {
    return { generatedAt: new Date().toISOString(), feed: alpacaMarketDataFeed, rows: [], referencePrices: {}, spreadsBps: {} }
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
    generatedAt: new Date().toISOString(),
    source: 'Alpaca latest stock quotes',
    feed: alpacaMarketDataFeed,
    rows,
    referencePrices: Object.fromEntries(rows.filter((row) => row.midpoint).map((row) => [row.symbol, row.midpoint])),
    spreadsBps: Object.fromEntries(rows.filter((row) => row.spreadBps !== null).map((row) => [row.symbol, row.spreadBps])),
  }
}

async function getAlpacaOpenOrders() {
  return alpacaRequest('GET', '/v2/orders?status=open&limit=100&nested=false')
}

async function accountContextFrom(account) {
  const equityUsd = Number(account?.equity)
  const cashUsd = Number(account?.cash)
  const dayPnlPct = Number(account?.equity) && Number(account?.last_equity)
    ? ((Number(account.equity) - Number(account.last_equity)) / Number(account.last_equity)) * 100
    : 0
  const normalizedEquityUsd = Number.isFinite(equityUsd) ? equityUsd : 0
  const accountKey = account?.id ? stableHash(String(account.id)) : 'unknown'
  const priorLedger = readJsonFile(brokerRiskLedgerPath)
  const sameAccount = priorLedger?.accountKey === accountKey && priorLedger?.mode === brokerMode
  const configuredHighWatermark = optionalPositiveNumber(process.env.QORE_BROKER_EQUITY_HIGH_WATERMARK_USD)
  const priorHighWatermark = sameAccount ? finiteNumber(priorLedger?.equityHighWatermarkUsd) : null
  const equityHighWatermarkUsd = Math.max(normalizedEquityUsd, configuredHighWatermark ?? 0, priorHighWatermark ?? 0)
  const trailingDrawdownPct = equityHighWatermarkUsd > 0
    ? ((normalizedEquityUsd - equityHighWatermarkUsd) / equityHighWatermarkUsd) * 100
    : 0
  const riskLedger = {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-alpaca-risk-ledger',
    broker: 'alpaca',
    mode: brokerMode,
    accountKey,
    equityUsd: round(normalizedEquityUsd, 2),
    equityHighWatermarkUsd: round(equityHighWatermarkUsd, 2),
    trailingDrawdownPct: round(trailingDrawdownPct, 4),
  }
  await writeJson(brokerRiskLedgerPath, riskLedger)
  return {
    equityUsd: normalizedEquityUsd,
    cashUsd: Number.isFinite(cashUsd) ? cashUsd : 0,
    openIntentCount: 0,
    dayPnlPct: round(dayPnlPct, 4),
    trailingDrawdownPct: riskLedger.trailingDrawdownPct,
    consecutiveLosses: 0,
  }
}

function offlineBrokerSnapshot() {
  const existing = readJsonFile(brokerSnapshotPath)
  if (existing?.account) return existing
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

async function getAlpacaBrokerSnapshot({ allowOffline = false } = {}) {
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
    account: await accountContextFrom(account),
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
      isOpen: marketClock?.is_open === true,
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
  return config
}

function readSignalIntent() {
  const snapshot = readJsonFile(signalIntentPath)
  if (!snapshot?.intent) throw new Error(`Missing signal intent. Run npm run live:weather:once to write ${relative(signalIntentPath)}.`)
  return snapshot
}

function readMarketReference() {
  const snapshot = readJsonFile(marketReferencePath)
  if (!snapshot?.referencePrices) throw new Error(`Missing market reference prices. Run npm run live:weather:once to write ${relative(marketReferencePath)}.`)
  return snapshot
}

function readRiskState() {
  const riskState = readJsonFile(riskStatePath, null)
  const operatorState = readJsonFile(operatorStatePath, null)
  if (!riskState || !operatorState) return riskState
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
  if (!Number.isFinite(marketValue)) return 0
  return side === 'short' ? -Math.abs(marketValue) : marketValue
}

function currentNotionalsFromPositions(positions) {
  const current = {}
  for (const position of positions ?? []) {
    const symbol = position?.symbol
    if (!symbol) continue
    current[symbol] = round((current[symbol] ?? 0) + signedPositionNotional(position), 2)
  }
  return current
}

function buildTargets(signalIntent, accountEquityUsd) {
  const intent = signalIntent.intent
  const basket = readIndexBasketConfig()
  const capitalBase = Math.max(0, accountEquityUsd * (allocationPct / 100))
  const cashReserve = accountEquityUsd * (minCashBufferPct / 100)
  const deployable = Math.max(0, capitalBase - cashReserve)
  const indexFraction = Math.max(0, Math.min(1, Number(intent.indexFraction ?? 0)))
  const gasPosition = Number(intent.gasPosition ?? (intent.direction === 'short' ? -1 : intent.direction === 'long' ? 1 : 0))
  const targets = {}

  for (const component of basket.components) {
    targets[component.symbol] = round(deployable * indexFraction * Number(component.targetWeight ?? 0), 2)
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

function buildPlannedOrders({ signalSnapshot, targets, current, prices, openOrders, accountEquityUsd }) {
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
    const opensShort = symbol === 'UNG' && targetNotionalUsd < 0
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

function openOrderId(openOrder) {
  return openOrder?.id ?? openOrder?.order_id ?? openOrder?.brokerOrderId ?? null
}

function matchingOpenOrders(openOrders, symbols) {
  return (openOrders ?? []).filter((order) => order?.symbol && symbols.has(order.symbol))
}

async function cancelOpenOrder(openOrder) {
  const brokerOrderId = openOrderId(openOrder)
  if (!brokerOrderId) {
    throw new Error(`Open order for ${openOrder?.symbol ?? 'unknown symbol'} is missing an Alpaca order id.`)
  }
  const raw = await alpacaRequest('DELETE', `/v2/orders/${encodeURIComponent(String(brokerOrderId))}`)
  return {
    symbol: openOrder.symbol,
    brokerOrderId,
    status: 'canceled',
    canceledAt: new Date().toISOString(),
    raw,
  }
}

async function cancelMatchingOpenOrders(openOrders, plannedOrders) {
  const plannedSymbols = new Set(plannedOrders.map((order) => order.symbol))
  const cancellationResults = []
  for (const openOrder of matchingOpenOrders(openOrders, plannedSymbols)) {
    try {
      cancellationResults.push(await cancelOpenOrder(openOrder))
    } catch (error) {
      cancellationResults.push({
        symbol: openOrder?.symbol ?? 'unknown',
        brokerOrderId: openOrderId(openOrder),
        status: 'cancel_failed',
        canceledAt: new Date().toISOString(),
        message: error.message,
      })
    }
  }
  return cancellationResults
}

async function replaceOpenOrdersForPlannedSymbols(openOrders, plannedOrders) {
  const plannedSymbols = new Set(plannedOrders.map((order) => order.symbol))
  const cancellationResults = await cancelMatchingOpenOrders(openOrders, plannedOrders)
  const blockedSymbols = new Set(
    cancellationResults
      .filter((result) => result.status !== 'canceled')
      .map((result) => result.symbol)
      .filter(Boolean),
  )
  let verification = {
    checkedAt: new Date().toISOString(),
    status: 'not-needed',
    remainingOpenOrders: [],
  }

  if (cancellationResults.length > 0) {
    try {
      const refreshedOpenOrders = await getAlpacaOpenOrders()
      const remainingOpenOrders = matchingOpenOrders(refreshedOpenOrders, plannedSymbols).map((order) => ({
        symbol: order.symbol,
        brokerOrderId: openOrderId(order),
        status: order.status ?? null,
      }))
      for (const order of remainingOpenOrders) blockedSymbols.add(order.symbol)
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

async function shortabilityBlocks(plannedOrders, targets, brokerSnapshot) {
  const blocks = []
  const needsUngShort = Number(targets.UNG ?? 0) < 0 || plannedOrders.some((order) => order.symbol === 'UNG' && order.side === 'sell' && order.targetNotionalUsd < 0)
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
  if (!asset?.shortable) blocks.push('Alpaca reports UNG is not shortable right now.')
  if (asset?.borrow_status === 'hard_to_borrow' && !allowHardToBorrow) {
    blocks.push('Alpaca reports UNG is hard-to-borrow; QORE_ALPACA_ALLOW_HARD_TO_BORROW is not enabled.')
  }
  return blocks
}

function signalAgeBlock(signalSnapshot) {
  if (allowStaleSignal) return null
  const issueDate = signalSnapshot?.inference?.forecastValidation?.latestCommonIssueDate
  const targetDate = signalSnapshot?.intent?.targetDate
  const freshnessDate = issueDate ?? targetDate
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(freshnessDate ?? ''))
    ? dateOrNull(`${freshnessDate}T00:00:00Z`)
    : null
  const validDate = parsedDate?.toISOString().slice(0, 10) === freshnessDate ? parsedDate : null
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const age = validDate ? (today - validDate.getTime()) / 86400000 : null
  if (signalSnapshot.stale || age === null || age < 0 || age > alpacaLiveRiskPolicy.maxSignalAgeDays) {
    const source = issueDate ? 'validated inference issue date' : 'target date'
    const detail = age === null
      ? 'no valid validated inference issue date or target date'
      : `${source} ${freshnessDate} is ${round(age, 2)} days old`
    return `Signal intent is stale (${detail}). Refresh data/signals before routing.`
  }
  return null
}

function liveConfirmationBlocks() {
  if (brokerMode !== 'live') return []
  const blocks = []
  if (!localTestEndpointConfirmed() && alpacaConfig.baseUrl !== alpacaLiveBaseUrl) {
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
  if (!localTestEndpointConfirmed() && alpacaConfig.baseUrl !== alpacaPaperBaseUrl) {
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

function liveRiskPolicyGate({ signalSnapshot, riskSnapshot, marketSnapshot, quoteSnapshot, brokerSnapshot, prices, targets, current, plannedOrders, skippedOrders }) {
  const blocks = []
  const warnings = []
  const checks = []
  const asOf = new Date()
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
    if (rawAccount.tradingBlocked === true) {
      addCheck('account-trading-blocked', 'Broker trading permission', 'block', 'Alpaca reports trading_blocked=true.')
    }
    if (rawAccount.accountBlocked === true) {
      addCheck('account-blocked', 'Broker account permission', 'block', 'Alpaca reports account_blocked=true.')
    }
    if (rawAccount.tradeSuspendedByUser === true) {
      addCheck('account-user-suspended', 'Broker user suspension', 'block', 'Alpaca reports trade_suspended_by_user=true.')
    }
  }

  const dayPnlPct = finiteNumber(brokerSnapshot?.account?.dayPnlPct)
  if (dayPnlPct !== null && dayPnlPct <= -Math.abs(alpacaLiveRiskPolicy.maxDailyLossPct)) {
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

  const accountEquityUsd = finiteNumber(brokerSnapshot?.account?.equityUsd)
  const grossTargetUsd = Object.values(targets).reduce((sum, value) => sum + Math.abs(Number(value ?? 0)), 0)
  const grossExposurePct = accountEquityUsd && accountEquityUsd > 0 ? (grossTargetUsd / accountEquityUsd) * 100 : null
  if (grossExposurePct !== null && grossExposurePct > alpacaLiveRiskPolicy.maxGrossExposurePct + 0.01) {
    addCheck(
      'gross-exposure-cap',
      'Gross exposure cap',
      'block',
      `Target gross exposure ${grossExposurePct.toFixed(2)}% exceeds the ${alpacaLiveRiskPolicy.maxGrossExposurePct}% cap.`,
    )
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

  const operator = riskSnapshot?.operator
  if (alpacaLiveRiskPolicy.requireOperatorContext && !operator) {
    addCheck('operator-context', 'Operator state', 'block', 'Autonomous operator state is required so kill-switch and venue-open checks cannot be skipped.')
  }

  const weather = riskSnapshot?.weather
  if (alpacaLiveRiskPolicy.requireFreshWeatherContext && !weather) {
    addCheck('weather-context', 'Weather context', 'block', 'Fresh weather model context is required.')
  } else if (weather) {
    const weatherAgeHours = ageHours(asOf, weather.forecastIssuedAt)
    if (
      weatherAgeHours === null ||
      weatherAgeHours < 0 ||
      weatherAgeHours > alpacaLiveRiskPolicy.maxWeatherIssueAgeHours
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

function contextBlocks({ signalSnapshot, riskSnapshot, marketSnapshot, quoteSnapshot, quoteError, brokerSnapshot, prices, targets, current, plannedOrders, skippedOrders }) {
  const blocks = []
  const warnings = []
  const staleBlock = signalAgeBlock(signalSnapshot)
  if (staleBlock) blocks.push(staleBlock)
  if (brokerMode === 'live' && signalSnapshot?.inference?.liveForecastAppliedToTarget !== true) {
    blocks.push('Current live forecast has not been applied to the all-year target; real-money routing is disabled.')
  }
  if (brokerMode === 'live' && signalSnapshot?.inference?.validated !== true) {
    blocks.push('Current live forecast inference is not validated; real-money routing is disabled.')
  }

  if (alpacaLiveRiskPolicy.requireAccountContext && (!brokerSnapshot?.account?.equityUsd || brokerSnapshot.account.equityUsd <= 0)) {
    blocks.push('Broker account equity is missing or zero.')
  }
  if (riskSnapshot?.operator?.killSwitchEngaged) blocks.push('QORE kill switch is engaged.')
  const venueOpen = brokerMode === 'dry-run'
    ? riskSnapshot?.operator?.venueOpen
    : brokerSnapshot?.marketClock?.isOpen
  if (brokerMode !== 'dry-run' && typeof venueOpen !== 'boolean') {
    blocks.push('Alpaca market clock is unavailable; venue-open status cannot be verified.')
  } else if (venueOpen === false && !allowOutsideMarketQueue) {
    blocks.push('Execution venue is closed and QORE_ALLOW_OUTSIDE_MARKET_QUEUE is not enabled.')
  }
  if (!riskSnapshot) {
    const message = `Risk state file is missing at ${relative(riskStatePath)}.`
    if (brokerMode === 'live') blocks.push(message)
    else warnings.push(message)
  } else if (brokerMode === 'live') {
    const readiness = riskSnapshot.readiness ?? {}
    for (const [key, present] of Object.entries({
      accountContextPresent: readiness.accountContextPresent,
      marketContextPresent: readiness.marketContextPresent,
      weatherContextPresent: readiness.weatherContextPresent,
      storageContextPresent: readiness.storageContextPresent,
    })) {
      if (!present) blocks.push(`Live risk context is incomplete: ${key} is false.`)
    }
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
  const riskGate = liveRiskPolicyGate({ signalSnapshot, riskSnapshot, marketSnapshot, quoteSnapshot, brokerSnapshot, prices, targets, current, plannedOrders, skippedOrders })
  return {
    blocks: [...blocks, ...riskGate.blocks],
    warnings: [...warnings, ...riskGate.warnings],
    riskPolicyChecks: riskGate.checks,
  }
}

function orderResultFailed(result) {
  return ['rejected', 'canceled', 'expired'].includes(String(result?.status ?? '').toLowerCase())
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

async function submitOrder(order) {
  const body = {
    symbol: order.symbol,
    side: order.side,
    type: order.orderType,
    time_in_force: order.timeInForce,
    qty: String(order.quantity),
    client_order_id: order.clientOrderId,
  }
  const raw = await alpacaRequest('POST', '/v2/orders', body)
  return {
    request: order,
    status: raw?.status ?? 'submitted',
    brokerOrderId: raw?.id,
    submittedAt: new Date().toISOString(),
    raw,
  }
}

async function reconcileOnce() {
  const signalSnapshot = readSignalIntent()
  const marketSnapshot = readMarketReference()
  const riskSnapshot = readRiskState()
  const brokerSnapshot = await getAlpacaBrokerSnapshot({ allowOffline: brokerMode === 'dry-run' })
  const accountEquityUsd = Number(brokerSnapshot?.account?.equityUsd ?? 0)
  const targets = buildTargets(signalSnapshot, accountEquityUsd)
  const current = currentNotionalsFromPositions(brokerSnapshot.positions)
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
    prices,
    openOrders: brokerSnapshot.openOrders,
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
  })
  const blockedReasons = [
    ...gateResult.blocks,
    ...liveConfirmationBlocks(),
    ...paperConfirmationBlocks(),
    ...(await shortabilityBlocks(plannedOrders, targets, brokerSnapshot)),
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
    openOrderReplacement = await replaceOpenOrdersForPlannedSymbols(brokerSnapshot.openOrders, plannedOrders)
  }

  if (preflightApproved && !dryRun) {
    let submissionHalted = false
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
        const submittedOrder = await submitOrder(order)
        orderResults.push(submittedOrder)
        if (orderResultFailed(submittedOrder)) submissionHalted = true
      } catch (error) {
        orderResults.push({
          request: order,
          status: 'rejected',
          submittedAt: new Date().toISOString(),
          message: error.message,
        })
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
      effectiveMinimumRebalanceUsd: round(Math.max(minOrderUsd, accountEquityUsd * (rebalanceDeadbandPct / 100)), 2),
    },
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
  const snapshot = await getAlpacaBrokerSnapshot({ allowOffline: brokerMode === 'dry-run' })
  const marketData = alpacaConfig.apiKey && alpacaConfig.secretKey
    ? await getAlpacaLatestQuotes([...alpacaLiveRiskPolicy.allowedInstruments])
    : null
  const status = {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-alpaca-broker-status',
    broker: 'alpaca',
    mode: brokerMode,
    baseUrl: alpacaConfig.baseUrl,
    paper: alpacaConfig.paper,
    brokerConnected: Boolean(snapshot?.brokerConnected),
    account: snapshot?.account ?? null,
    rawAccount: snapshot?.rawAccount ?? null,
    positions: snapshot?.positions ?? [],
    openOrders: snapshot?.openOrders ?? [],
    marketData,
    marketClock: snapshot?.marketClock ?? null,
    files: {
      accountSnapshot: relative(brokerSnapshotPath),
      status: relative(brokerStatusPath),
    },
  }
  await writeJson(brokerStatusPath, status)
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
    console.log(`Wrote ${result.files.status}.`)
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

async function runCommand() {
  const result = statusOnly ? await statusOnce() : await reconcileOnce()
  printResult(result)
  if (resultShouldFailProcess(result)) process.exitCode = 1
}

if (loop) {
  while (true) {
    try {
      await runCommand()
    } catch (error) {
      const status = {
        generatedAt: new Date().toISOString(),
        serviceId: 'qore-alpaca-target-weight-reconciler',
        broker: 'alpaca',
        mode: brokerMode,
        approved: false,
        blockedReasons: [error.message],
      }
      await writeJson(brokerStatusPath, status)
      if (jsonOutput) console.log(JSON.stringify(status, null, 2))
      else console.error(`QORE Alpaca ${brokerMode}: ${error.message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, loopIntervalMs))
  }
}

if (once || statusOnly) {
  try {
    await runCommand()
  } catch (error) {
    const status = {
      generatedAt: new Date().toISOString(),
      serviceId: statusOnly ? 'qore-alpaca-broker-status' : 'qore-alpaca-target-weight-reconciler',
      broker: 'alpaca',
      mode: brokerMode,
      approved: false,
      executionOk: false,
      executionStatus: 'blocked',
      blockedReasons: [error.message],
    }
    await writeJson(brokerStatusPath, status)
    if (jsonOutput) console.log(JSON.stringify(status, null, 2))
    else console.error(`QORE Alpaca ${brokerMode}: ${error.message}`)
    process.exitCode = 1
  }
}
