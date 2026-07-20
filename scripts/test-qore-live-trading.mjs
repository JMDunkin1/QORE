#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { nominalEiaStorageReleaseAt } from './lib/eia-release-time.mjs'
import { resolveLiveWeatherPaths } from './lib/qore-live-paths.mjs'

process.env.NODE_ENV = 'test'

const repoDir = process.cwd()
const scratch = await mkdtemp(path.join(tmpdir(), 'qore-live-test-'))
const liveDir = path.join(scratch, 'live-weather')
const brokerDir = path.join(scratch, 'broker')
const executionRepo = path.join(scratch, 'execution-repo')
const nonGitExecutionRepo = path.join(scratch, 'execution-repo-without-git')
const brokerScript = path.join(repoDir, 'scripts', 'qore-alpaca-broker.mjs')
const readinessScript = path.join(repoDir, 'scripts', 'qore-live-readiness.mjs')
const supervisorScript = path.join(repoDir, 'scripts', 'qore-live-trading-supervisor.mjs')
const dashboardScript = path.join(repoDir, 'scripts', 'qore-dashboard-service.mjs')
const validBasket = {
  components: [
    { symbol: 'VOO', targetWeight: 0.8 },
    { symbol: 'QQQM', targetWeight: 0.2 },
  ],
}

function runNode(args, env = {}) {
  const cwd = env.QORE_TEST_CWD ?? repoDir
  const childEnv = { ...process.env, ...env }
  delete childEnv.QORE_TEST_CWD
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value === null) delete childEnv[name]
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function inferenceSeason(dateText = today()) {
  const month = Number(dateText.slice(5, 7))
  const leadMonth = Number(new Date(Date.parse(`${dateText}T00:00:00Z`) + 7 * 86400000).toISOString().slice(5, 7))
  return (month >= 5 && month <= 9) || (leadMonth >= 5 && leadMonth <= 9) ? 'summer' : 'winter'
}

function inferenceContract(season = inferenceSeason()) {
  return season === 'summer'
    ? {
        requiredSources: ['gfs', 'gefs-mean'],
        collectedSources: ['gfs', 'gefs-mean'],
        requiredLeads: [7],
        scoreRowCount: 2,
      }
    : {
        requiredSources: ['gfs', 'gefs-mean', 'aigfs'],
        collectedSources: ['gfs', 'gefs-mean', 'ecmwf-ifs', 'ecmwf-aifs', 'aigfs'],
        requiredLeads: [1, 2, 3, 7, 8, 9, 10],
        scoreRowCount: 21,
      }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function accountKey(value) {
  return crypto.createHash('sha256').update(JSON.stringify(String(value))).digest('hex').slice(0, 12)
}

function testEiaReleaseTimestamp() {
  assert.equal(nominalEiaStorageReleaseAt('2026-07-03'), '2026-07-09T14:30:00.000Z')
  assert.equal(nominalEiaStorageReleaseAt('2026-01-16'), '2026-01-22T15:30:00.000Z')
  assert.equal(nominalEiaStorageReleaseAt('not-a-date'), null)
  console.log('ok - EIA storage freshness uses the publication time after the weekly period ends')
}

async function writeHandoffs({
  killSwitchEngaged = false,
  operatorState = null,
  riskGeneratedAt = undefined,
  marketSpreads = {},
  liveForecastAppliedToTarget = true,
  inferenceValidated = liveForecastAppliedToTarget,
  targetDate = today(),
  gasPosition = 0,
  indexFraction = 1,
  cashFraction = Math.max(0, 1 - Math.abs(gasPosition) - indexFraction),
  instrument = 'UNG',
  direction = gasPosition > 0 ? 'long' : gasPosition < 0 ? 'short' : 'flat',
  intentStrategyId = 'ngas-all-year-beta',
  inferenceStrategyId = 'ngas-all-year-beta',
  forecastIssueDate = targetDate,
  inferenceProvenanceOverrides = {},
  riskReadinessOverrides = {},
  handoffNow = null,
} = {}) {
  const now = handoffNow ?? new Date().toISOString()
  const asOfDate = new Date(now).toISOString().slice(0, 10)
  const season = inferenceSeason(asOfDate)
  const contract = inferenceContract(season)
  const effectiveRiskGeneratedAt = riskGeneratedAt === undefined ? now : riskGeneratedAt
  await writeJson(path.join(liveDir, 'signal-intent-reconcile.json'), {
    generatedAt: now,
    stale: false,
    signalAgeDays: 0,
    intent: {
      strategyId: intentStrategyId,
      signalDate: asOfDate,
      targetDate,
      instrument,
      direction,
      confidence: 0.8,
      indexFraction,
      gasPosition,
      cashFraction,
    },
    inference: {
      strategyId: inferenceStrategyId,
      mode: liveForecastAppliedToTarget ? 'selected-contract-live-source-set-00z' : 'historical-artifact-latest-row',
      season,
      targetDate,
      componentStrategyId: gasPosition === 0 ? 'index-fallback' : `ngas-${season}-alpha`,
      windowId: gasPosition === 0 ? 'index-fallback' : 'weather-follow',
      thesisKind: gasPosition === 0
        ? 'index-fallback'
        : season === 'summer'
          ? gasPosition > 0 ? 'summer-heat-long' : 'summer-cold-short'
          : gasPosition > 0 ? 'cold-long' : 'warm-short',
      liveForecastAppliedToTarget,
      validated: inferenceValidated,
      ...inferenceProvenanceOverrides,
      forecastValidation: {
        latestCommonIssueDate: forecastIssueDate,
        issueAgeDays: /^\d{4}-\d{2}-\d{2}$/.test(String(forecastIssueDate ?? ''))
          ? (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${forecastIssueDate}T00:00:00Z`)) / 86400000
          : null,
        runHourUtc: '00',
        ...contract,
        ...(inferenceProvenanceOverrides.forecastValidation ?? {}),
      },
    },
  })
  await writeJson(path.join(liveDir, 'market-reference-prices.json'), {
    generatedAt: now,
    referencePrices: { UNG: 15, VOO: 100, QQQM: 50 },
    freshness: { freshestPriceUpdatedAt: now },
    rows: Object.entries(marketSpreads).map(([symbol, spreadBps]) => ({ symbol, spreadBps })),
  })
  const riskState = {
    operator: { killSwitchEngaged: false, venueOpen: true },
    weather: { forecastIssuedAt: now, sourceCount: 2, coveragePct: 100 },
    storage: { reportedAt: now },
    market: { priceUpdatedAt: now, referencePrices: { UNG: 15, VOO: 100, QQQM: 50 } },
    readiness: {
      accountContextPresent: true,
      marketContextPresent: true,
      weatherContextPresent: true,
      storageContextPresent: true,
      storageInferenceCoherent: true,
      ...riskReadinessOverrides,
    },
  }
  if (effectiveRiskGeneratedAt !== null) riskState.generatedAt = effectiveRiskGeneratedAt
  await writeJson(path.join(liveDir, 'risk-and-kill-switch-state.json'), riskState)
  const effectiveOperatorState = operatorState ?? (killSwitchEngaged ? 'engaged' : 'clear')
  if (effectiveOperatorState === 'missing') {
    await rm(path.join(liveDir, 'operator-state.json'), { force: true })
  } else if (effectiveOperatorState === 'invalid') {
    await writeJson(path.join(liveDir, 'operator-state.json'), { killSwitchEngaged: 'false', updatedAt: now })
  } else {
    await writeJson(path.join(liveDir, 'operator-state.json'), {
      killSwitchEngaged: effectiveOperatorState === 'engaged',
      updatedAt: now,
    })
  }
}

function jsonResponse(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function scenario({
  name,
  accountOverrides = {},
  quoteOverrides = {},
  killSwitchEngaged = false,
  operatorState = null,
  riskGeneratedAt = undefined,
  marketSpreads = {},
  positions = [],
  rejectFirstOrder = false,
  preflightOnly = false,
  readinessOnly = false,
  marketOpen = true,
  marketClockOverrides = {},
  marketClockDelayByRead = [],
  expectedBlock = null,
  expectedSubmissionFailure = false,
  brokerMode = 'paper',
  allowTestEndpoint = true,
  allowShorts = false,
  gasPosition = 0,
  indexFraction = 1,
  expectedOrderCount = 2,
  expectedFirstSide = null,
  expectedNoOp = false,
  minCashBufferPct = '0',
  maxOrderUsd = undefined,
  expectedTargetNotionalUsd = null,
  expectedDeltaNotionalUsd = null,
  reconcileCount = 1,
  fillSubmittedOrders = false,
  rejectDuplicateClientOrderIds = false,
  liveForecastAppliedToTarget = true,
  inferenceValidated = liveForecastAppliedToTarget,
  targetDate = today(),
  maxRiskSnapshotAgeSeconds = '900',
  cashFraction = Math.max(0, 1 - Math.abs(gasPosition) - indexFraction),
  instrument = 'UNG',
  direction = gasPosition > 0 ? 'long' : gasPosition < 0 ? 'short' : 'flat',
  basket = validBasket,
  commandEnvOverrides = {},
  gitStateUnavailable = false,
  dirtyCodePath = null,
  riskStateMissing = false,
  intentStrategyId = 'ngas-all-year-beta',
  inferenceStrategyId = 'ngas-all-year-beta',
  forecastIssueDate = targetDate,
  inferenceProvenanceOverrides = {},
  riskReadinessOverrides = {},
  ledgerState = 'valid',
  openOrders = [],
  engageKillAfterFirstOrder = false,
  engageKillAfterInitialOpenOrdersRead = false,
  cancelFailureSymbol = null,
  cancelFailureStatus = 500,
  verifyOpenOrdersFailure = false,
  expectedMutationHalt = null,
  expectedRequestCount = null,
  maxGrossExposurePct = '100',
  bootstrapThenReconcile = false,
  expectedExposurePrefixes = null,
  positionDriftAfterFirstOrder = [],
  reportSubmittedOrdersAsOpen = false,
  bootstrapOnly = false,
  bootstrapConfirmation = undefined,
  dirtyCodeAfterFirstOrder = null,
  marketOpenAfterFirstOrder = null,
  marketClockOverridesAfterFirstOrder = null,
  accountOverridesAfterFirstOrder = null,
  accountOverridesBySubmittedOrder = [],
  accountOverridesByRead = [],
  firstOrderResponseStatus = 'accepted',
  positionPriceAfterFirstOrder = {},
  assetOverrides = {},
  assetOverridesByRead = [],
  expectedAssetRequestCount = null,
  expectedRiskLedgerHighWatermark = null,
  fillDuringCancelSymbol = null,
  cancelOrderLookupFailureSymbol = null,
  cancelConfirmedStatusBySymbol = {},
  positionDriftDuringCancel = [],
  quoteOverridesByRead = [],
  expectedSubmittedQuantityBySymbol = null,
  expectedBrokerLockPresent = null,
  handoffNow = null,
  nowAfterFreshQuote = null,
  mutateSignalAfterFreshQuote = null,
  mutateRiskAfterFreshQuote = null,
  positionsAfterFreshQuote = null,
  openOrdersAfterFreshQuote = null,
}) {
  await rm(brokerDir, { recursive: true, force: true })
  const testNowPath = path.join(liveDir, 'broker-test-now.txt')
  await rm(testNowPath, { force: true })
  if (handoffNow) await writeFile(testNowPath, `${handoffNow}\n`, 'utf8')
  await writeHandoffs({
    killSwitchEngaged,
    operatorState,
    riskGeneratedAt,
    marketSpreads,
    liveForecastAppliedToTarget,
    inferenceValidated,
    targetDate,
    gasPosition,
    indexFraction,
    cashFraction,
    instrument,
    direction,
    intentStrategyId,
    inferenceStrategyId,
    forecastIssueDate,
    inferenceProvenanceOverrides,
    riskReadinessOverrides,
    handoffNow,
  })
  if (riskStateMissing) await rm(path.join(liveDir, 'risk-and-kill-switch-state.json'), { force: true })
  const commandCwd = gitStateUnavailable ? nonGitExecutionRepo : executionRepo
  await writeJson(path.join(commandCwd, 'data/qore/market/index-basket-config.json'), basket)
  if (dirtyCodePath) await writeJson(path.join(commandCwd, dirtyCodePath), { dirty: true })
  const submittedOrders = []
  const canceledOrders = []
  const submittedClientOrderIds = new Set()
  let brokerPositions = positions
  let brokerOpenOrders = [...openOrders]
  let brokerMarketOpen = marketOpen
  let brokerClockOverrides = marketClockOverrides
  let brokerAccountOverrides = accountOverrides
  let accountReadCount = 0
  let openOrderReadCount = 0
  let quoteReadCount = 0
  let clockReadCount = 0
  let assetReadCount = 0
  let requestCount = 0
  let boundaryFixtureMutationApplied = false
  let scenarioNow = handoffNow
  const orderHistory = new Map()
  const server = createServer(async (request, response) => {
    requestCount += 1
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/v2/account') {
      accountReadCount += 1
      jsonResponse(response, 200, {
        id: 'paper-account-id',
        account_number: 'TEST1234',
        status: 'ACTIVE',
        equity: '10000',
        last_equity: '10000',
        cash: '10000',
        buying_power: '10000',
        trading_blocked: false,
        account_blocked: false,
        trade_suspended_by_user: false,
        shorting_enabled: true,
        ...brokerAccountOverrides,
        ...(accountOverridesByRead[accountReadCount - 1] ?? {}),
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/positions') {
      jsonResponse(response, 200, brokerPositions)
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/orders') {
      openOrderReadCount += 1
      if (verifyOpenOrdersFailure && openOrderReadCount > 1) {
        jsonResponse(response, 500, { message: 'simulated open-order verification failure' })
        return
      }
      if (engageKillAfterInitialOpenOrdersRead && openOrderReadCount === 1) {
        await writeJson(path.join(liveDir, 'operator-state.json'), {
          killSwitchEngaged: true,
          updatedAt: new Date().toISOString(),
        })
      }
      jsonResponse(response, 200, brokerOpenOrders)
      return
    }
    if (request.method === 'GET' && url.pathname.startsWith('/v2/orders/')) {
      const brokerOrderId = decodeURIComponent(url.pathname.slice('/v2/orders/'.length))
      const confirmedOrder = orderHistory.get(brokerOrderId)
      if (confirmedOrder?.symbol === cancelOrderLookupFailureSymbol) {
        jsonResponse(response, 500, { message: `simulated ${confirmedOrder.symbol} order lookup failure` })
      } else if (confirmedOrder) jsonResponse(response, 200, confirmedOrder)
      else jsonResponse(response, 404, { message: `order ${brokerOrderId} not found` })
      return
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/v2/orders/')) {
      const brokerOrderId = decodeURIComponent(url.pathname.slice('/v2/orders/'.length))
      const openOrder = brokerOpenOrders.find((order) => String(order.id) === brokerOrderId)
      if (cancelFailureSymbol && openOrder?.symbol === cancelFailureSymbol) {
        jsonResponse(response, cancelFailureStatus, { message: `simulated ${cancelFailureSymbol} cancellation failure` })
        return
      }
      canceledOrders.push(brokerOrderId)
      brokerOpenOrders = brokerOpenOrders.filter((order) => String(order.id) !== brokerOrderId)
      if (positionDriftDuringCancel.length) brokerPositions = [...brokerPositions, ...positionDriftDuringCancel]
      const initialFilledQuantity = Number(openOrder?.filled_qty ?? 0)
      orderHistory.set(brokerOrderId, {
        ...openOrder,
        id: brokerOrderId,
        status: cancelConfirmedStatusBySymbol[openOrder?.symbol] ?? 'canceled',
        filled_qty: String(initialFilledQuantity + (openOrder?.symbol === fillDuringCancelSymbol ? 1 : 0)),
      })
      jsonResponse(response, 200, { id: brokerOrderId, status: 'canceled' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/clock') {
      clockReadCount += 1
      const clockDelayMs = Number(marketClockDelayByRead[clockReadCount - 1] ?? 0)
      if (clockDelayMs > 0) await delay(clockDelayMs)
      const clockNow = scenarioNow ?? new Date().toISOString()
      const clockNowMs = Date.parse(clockNow)
      jsonResponse(response, 200, {
        is_open: brokerMarketOpen,
        timestamp: clockNow,
        next_open: new Date(clockNowMs + 3600000).toISOString(),
        next_close: new Date(clockNowMs + 7200000).toISOString(),
        ...brokerClockOverrides,
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/assets/UNG') {
      assetReadCount += 1
      jsonResponse(response, 200, {
        symbol: 'UNG',
        status: 'active',
        tradable: true,
        marginable: true,
        shortable: true,
        easy_to_borrow: true,
        borrow_status: 'easy_to_borrow',
        ...assetOverrides,
        ...(assetOverridesByRead[assetReadCount - 1] ?? {}),
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/stocks/quotes/latest') {
      quoteReadCount += 1
      const timestamp = scenarioNow ?? new Date().toISOString()
      const readOverrides = quoteOverridesByRead[quoteReadCount - 1] ?? {}
      if (quoteReadCount === 2 && !boundaryFixtureMutationApplied) {
        boundaryFixtureMutationApplied = true
        if (mutateSignalAfterFreshQuote) {
          const signalPath = path.join(liveDir, 'signal-intent-reconcile.json')
          const signal = JSON.parse(await readFile(signalPath, 'utf8'))
          const mutatedSignal = await mutateSignalAfterFreshQuote(signal)
          await writeJson(signalPath, mutatedSignal ?? signal)
        }
        if (mutateRiskAfterFreshQuote) {
          const riskPath = path.join(liveDir, 'risk-and-kill-switch-state.json')
          const risk = JSON.parse(await readFile(riskPath, 'utf8'))
          const mutatedRisk = await mutateRiskAfterFreshQuote(risk)
          await writeJson(riskPath, mutatedRisk ?? risk)
        }
        if (positionsAfterFreshQuote !== null) brokerPositions = [...positionsAfterFreshQuote]
        if (openOrdersAfterFreshQuote !== null) brokerOpenOrders = [...openOrdersAfterFreshQuote]
        if (nowAfterFreshQuote) {
          scenarioNow = nowAfterFreshQuote
          await writeFile(testNowPath, `${scenarioNow}\n`, 'utf8')
        }
      }
      jsonResponse(response, 200, {
        quotes: {
          UNG: { bp: 14.99, ap: 15.01, t: timestamp },
          VOO: { bp: 99.99, ap: 100.01, t: timestamp },
          QQQM: { bp: 49.99, ap: 50.01, t: timestamp },
          ...quoteOverrides,
          ...readOverrides,
        },
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v2/orders') {
      let body = ''
      for await (const chunk of request) body += chunk
      const order = JSON.parse(body)
      submittedOrders.push(order)
      if (rejectFirstOrder && submittedOrders.length === 1) {
        jsonResponse(response, 422, { message: 'simulated sell rejection' })
        return
      }
      if (rejectDuplicateClientOrderIds && submittedClientOrderIds.has(order.client_order_id)) {
        jsonResponse(response, 422, { message: 'client_order_id must be unique' })
        return
      }
      submittedClientOrderIds.add(order.client_order_id)
      if (submittedOrders.length === 1 && reportSubmittedOrdersAsOpen) {
        const price = { UNG: 15, VOO: 100, QQQM: 50 }[order.symbol]
        brokerOpenOrders.push({
          id: 'pending-first-submission',
          symbol: order.symbol,
          side: order.side,
          qty: order.qty,
          filled_qty: '0',
          notional: String(Number(order.qty) * price),
          client_order_id: order.client_order_id,
          status: 'accepted',
        })
      }
      if (submittedOrders.length === 1 && positionDriftAfterFirstOrder.length) {
        brokerPositions = [...brokerPositions, ...positionDriftAfterFirstOrder]
      }
      if (submittedOrders.length === 1 && Object.keys(positionPriceAfterFirstOrder).length) {
        brokerPositions = brokerPositions.map((position) => {
          const nextPrice = positionPriceAfterFirstOrder[position.symbol]
          if (!nextPrice) return position
          const quantity = Number(position.qty)
          return {
            ...position,
            current_price: String(nextPrice),
            market_value: String(Math.abs(quantity * nextPrice)),
          }
        })
      }
      if (submittedOrders.length === 1 && dirtyCodeAfterFirstOrder) {
        await writeJson(path.join(commandCwd, dirtyCodeAfterFirstOrder), { changedAfterFirstOrder: true })
      }
      if (submittedOrders.length === 1 && marketOpenAfterFirstOrder !== null) {
        brokerMarketOpen = marketOpenAfterFirstOrder
      }
      if (submittedOrders.length === 1 && marketClockOverridesAfterFirstOrder) {
        brokerClockOverrides = { ...brokerClockOverrides, ...marketClockOverridesAfterFirstOrder }
      }
      if (submittedOrders.length === 1 && accountOverridesAfterFirstOrder) {
        brokerAccountOverrides = { ...brokerAccountOverrides, ...accountOverridesAfterFirstOrder }
      }
      const scheduledAccountOverrides = accountOverridesBySubmittedOrder[submittedOrders.length - 1]
      if (scheduledAccountOverrides) {
        brokerAccountOverrides = { ...brokerAccountOverrides, ...scheduledAccountOverrides }
      }
      if (engageKillAfterFirstOrder && submittedOrders.length === 1) {
        await writeJson(path.join(liveDir, 'operator-state.json'), {
          killSwitchEngaged: true,
          updatedAt: new Date().toISOString(),
        })
      }
      if (fillSubmittedOrders) {
        const price = { UNG: 15, VOO: 100, QQQM: 50 }[order.symbol]
        const existing = brokerPositions.find((position) => position.symbol === order.symbol)
        const currentNotionalUsd = Number(existing?.market_value ?? 0)
        const filledNotionalUsd = Number(order.qty) * price * (order.side === 'buy' ? 1 : -1)
        const marketValue = currentNotionalUsd + filledNotionalUsd
        brokerPositions = [
          ...brokerPositions.filter((position) => position.symbol !== order.symbol),
          {
            symbol: order.symbol,
            qty: String(Math.abs(marketValue / price)),
            side: marketValue < 0 ? 'short' : 'long',
            current_price: String(price),
            market_value: String(Math.abs(marketValue)),
          },
        ]
      }
      jsonResponse(response, 200, {
        id: `order-${submittedOrders.length}`,
        status: submittedOrders.length === 1 ? firstOrderResponseStatus : 'accepted',
      })
      return
    }
    jsonResponse(response, 404, { message: `Unexpected ${request.method} ${url.pathname}` })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const commandArgs = readinessOnly
    ? [readinessScript, `--mode=${brokerMode}`, '--json']
    : bootstrapOnly
      ? [brokerScript, `--mode=${brokerMode}`, '--preflight-only', '--bootstrap-risk-ledger', '--json']
    : [brokerScript, `--mode=${brokerMode}`, preflightOnly ? '--preflight-only' : '--reconcile', '--json']
  const commandEnv = {
    APCA_API_KEY_ID: 'test-key',
    APCA_API_SECRET_KEY: 'test-secret',
    QORE_ALPACA_BASE_URL: baseUrl,
    QORE_ALPACA_DATA_BASE_URL: baseUrl,
    NODE_ENV: 'test',
    QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: allowTestEndpoint ? '1' : '0',
    QORE_ALPACA_MARKET_DATA_FEED: 'iex',
    QORE_LIVE_WEATHER_STATE_DIR: liveDir,
    QORE_BROKER_STATE_DIR: brokerDir,
    QORE_PAPER_ORDER_ROUTING_ENABLED: '1',
    QORE_ALPACA_ALLOW_SHORTS: allowShorts ? '1' : '0',
    QORE_LIVE_TRADING_ENABLED: brokerMode === 'live' ? '1' : '0',
    QORE_LIVE_ORDER_ROUTING_ENABLED: brokerMode === 'live' ? '1' : '0',
    QORE_CONFIRM_LIVE_TRADING: brokerMode === 'live' ? 'I_UNDERSTAND_THIS_CAN_LOSE_MONEY' : '',
    QORE_LIVE_MAX_QUOTE_AGE_MINUTES: '5',
    QORE_LIVE_MAX_RISK_SNAPSHOT_AGE_SECONDS: maxRiskSnapshotAgeSeconds,
    QORE_LIVE_MIN_CASH_BUFFER_PCT: minCashBufferPct,
    QORE_LIVE_REBALANCE_DEADBAND_PCT: '0.25',
    QORE_LIVE_MAX_ORDER_USD: maxOrderUsd,
    QORE_LIVE_MAX_GROSS_EXPOSURE_PCT: maxGrossExposurePct,
    QORE_CONFIRM_RISK_LEDGER_BOOTSTRAP: bootstrapConfirmation,
    QORE_TEST_CWD: commandCwd,
    QORE_TEST_NOW_FILE: handoffNow ? testNowPath : undefined,
    ...commandEnvOverrides,
  }
  const accountStatusSentinel = `${JSON.stringify({
    generatedAt: '2026-01-01T00:00:00.000Z',
    serviceId: 'qore-alpaca-broker-status',
    portfolioHistory: { points: [{ timestamp: '2026-01-01T00:00:00.000Z', equityUsd: 10_000 }] },
  }, null, 2)}\n`
  await mkdir(brokerDir, { recursive: true })
  const fixtureAccountId = String(accountOverrides.id ?? 'paper-account-id')
  const fixtureEquity = Number(accountOverrides.equity ?? 10_000)
  if (ledgerState === 'valid') {
    await writeJson(path.join(brokerDir, 'risk-ledger.json'), {
      generatedAt: new Date().toISOString(),
      serviceId: 'qore-alpaca-risk-ledger',
      broker: 'alpaca',
      mode: brokerMode,
      accountKey: accountKey(fixtureAccountId),
      equityUsd: fixtureEquity,
      equityHighWatermarkUsd: Math.max(10_000, fixtureEquity),
      trailingDrawdownPct: 0,
    })
  } else if (ledgerState === 'malformed') {
    await writeFile(path.join(brokerDir, 'risk-ledger.json'), '{not-json\n', 'utf8')
  } else if (ledgerState === 'mode-mismatch') {
    await writeJson(path.join(brokerDir, 'risk-ledger.json'), {
      generatedAt: new Date().toISOString(),
      serviceId: 'qore-alpaca-risk-ledger',
      broker: 'alpaca',
      mode: brokerMode === 'live' ? 'paper' : 'live',
      accountKey: accountKey(fixtureAccountId),
      equityHighWatermarkUsd: Math.max(10_000, fixtureEquity),
    })
  } else if (ledgerState === 'account-mismatch') {
    await writeJson(path.join(brokerDir, 'risk-ledger.json'), {
      generatedAt: new Date().toISOString(),
      serviceId: 'qore-alpaca-risk-ledger',
      broker: 'alpaca',
      mode: brokerMode,
      accountKey: accountKey('different-account'),
      equityHighWatermarkUsd: Math.max(10_000, fixtureEquity),
    })
  }
  await writeFile(path.join(brokerDir, 'account-status.json'), accountStatusSentinel, 'utf8')
  const results = []
  if (bootstrapThenReconcile) {
    const bootstrap = await runNode(
      [brokerScript, `--mode=${brokerMode}`, '--preflight-only', '--bootstrap-risk-ledger', '--json'],
      {
        ...commandEnv,
        QORE_CONFIRM_RISK_LEDGER_BOOTSTRAP: 'I_UNDERSTAND_THIS_RESETS_THE_TRAILING_DRAWDOWN_BASELINE',
      },
    )
    assert.equal(bootstrap.code, 1, `${name}: engaged-switch bootstrap preflight remains blocked`)
    assert.equal(submittedOrders.length, 0, `${name}: bootstrap must never submit an order`)
    const bootstrappedLedger = JSON.parse(await readFile(path.join(brokerDir, 'risk-ledger.json'), 'utf8'))
    assert.equal(bootstrappedLedger.accountKey, accountKey(fixtureAccountId), `${name}: bootstrap account binding`)
    assert.equal(bootstrappedLedger.mode, brokerMode, `${name}: bootstrap mode binding`)
    assert.equal(bootstrappedLedger.equityHighWatermarkUsd, fixtureEquity, `${name}: current equity baseline`)
    await writeJson(path.join(liveDir, 'operator-state.json'), {
      killSwitchEngaged: false,
      updatedAt: new Date().toISOString(),
    })
    results.push(await runNode([brokerScript, `--mode=${brokerMode}`, '--reconcile', '--json'], commandEnv))
  } else {
    for (let attempt = 0; attempt < reconcileCount; attempt += 1) {
      results.push(await runNode(commandArgs, commandEnv))
    }
  }
  const result = results.at(-1)
  await new Promise((resolve) => server.close(resolve))
  if (dirtyCodePath) await rm(path.join(commandCwd, dirtyCodePath), { force: true })
  if (dirtyCodeAfterFirstOrder) await rm(path.join(commandCwd, dirtyCodeAfterFirstOrder), { force: true })
  const status = JSON.parse(await readFile(path.join(brokerDir, 'status.json'), 'utf8'))
  assert.equal(
    await readFile(path.join(brokerDir, 'account-status.json'), 'utf8'),
    accountStatusSentinel,
    `${name}: reconcile must not overwrite account/history status telemetry`,
  )

  if (readinessOnly) {
    const readiness = JSON.parse(result.stdout)
    if (expectedBlock) {
      assert.equal(result.code, 1, `${name}: readiness should fail closed`)
      assert.equal(readiness.ready, false, `${name}: readiness should be blocked`)
      assert.match(readiness.checks.map((check) => check.detail).join(' '), expectedBlock)
    } else {
      assert.equal(result.code, 0, `${name}: readiness should exit 0 (${result.stderr || result.stdout})`)
      assert.equal(readiness.ready, true, `${name}: readiness should be ready`)
      assert.equal(readiness.checks.find((check) => check.id === 'broker-preflight')?.status, 'pass')
      assert.equal(readiness.checks.find((check) => check.id === 'live-strategy-inference')?.status, 'pass')
      assert.equal(readiness.checks.some((check) => check.id === 'all-year-artifact-freshness'), false)
    }
    assert.equal(submittedOrders.length, 0, `${name}: readiness must submit no orders`)
  } else if (expectedSubmissionFailure) {
    assert.equal(result.code, 1, `${name}: failed submission should exit 1`)
    assert.equal(status.approved, false, `${name}: failed submission should not be approved`)
    assert.equal(status.executionStatus, 'submit-failed', `${name}: failure should be reported as submit-failed`)
    assert.equal(submittedOrders.length, 1, `${name}: later buys must not be attempted after the sell fails`)
    assert.equal(submittedOrders[0].side, 'sell', `${name}: risk-reducing sell should be attempted first`)
    assert.ok(
      status.orderResults.some((order) => order.status === 'blocked' && /remaining orders were halted/.test(order.message)),
      `${name}: remaining orders should be recorded as halted`,
    )
  } else if (expectedMutationHalt) {
    assert.equal(result.code, 1, `${name}: mutation halt should exit 1`)
    assert.equal(status.approved, false, `${name}: mutation halt must not be approved`)
    assert.equal(status.executionStatus, expectedMutationHalt.executionStatus, `${name}: execution status`)
    assert.equal(submittedOrders.length, expectedMutationHalt.submittedOrderCount ?? 0, `${name}: submitted order count`)
    assert.equal(canceledOrders.length, expectedMutationHalt.canceledOrderCount ?? 0, `${name}: canceled order count`)
    assert.match(
      status.orderResults.map((order) => order.message ?? '').join(' ')
        + ' ' + JSON.stringify(status.openOrderReplacement),
      expectedMutationHalt.reason,
      `${name}: mutation halt reason`,
    )
  } else if (expectedBlock) {
    assert.equal(result.code, 1, `${name}: blocked reconcile should exit 1`)
    assert.equal(status.approved, false, `${name}: blocked reconcile should not be approved`)
    assert.match(status.blockedReasons.join(' '), expectedBlock, `${name}: expected block reason`)
    assert.equal(submittedOrders.length, 0, `${name}: blocked reconcile must submit no orders`)
  } else if (preflightOnly) {
    assert.equal(result.code, 0, `${name}: preflight should exit 0 (${result.stderr})`)
    assert.equal(status.preflightApproved, true, `${name}: preflight should be approved`)
    assert.equal(status.executionStatus, 'planned', `${name}: preflight should only plan orders`)
    assert.equal(submittedOrders.length, 0, `${name}: preflight must submit no orders`)
  } else if (expectedNoOp) {
    assert.equal(result.code, 0, `${name}: no-op reconcile should exit 0 (${result.stderr})`)
    assert.equal(status.approved, true, `${name}: no-op reconcile should remain approved`)
    assert.equal(status.executionStatus, 'no-op', `${name}: drift inside the deadband should be a no-op`)
    assert.equal(submittedOrders.length, 0, `${name}: no-op reconcile must submit no orders`)
  } else {
    assert.equal(result.code, 0, `${name}: approved reconcile should exit 0 (${result.stderr})`)
    assert.equal(status.approved, true, `${name}: reconcile should be approved`)
    assert.equal(status.executionStatus, 'submitted', `${name}: orders should be submitted`)
    assert.equal(submittedOrders.length, expectedOrderCount, `${name}: expected paper order count`)
    if (expectedFirstSide) assert.equal(submittedOrders[0]?.side, expectedFirstSide, `${name}: expected first paper order side`)
  }
  if (expectedTargetNotionalUsd) {
    assert.deepEqual(status.targetNotionalUsd, expectedTargetNotionalUsd, `${name}: expected target notionals`)
  }
  if (expectedDeltaNotionalUsd !== null) {
    assert.ok(
      status.plannedOrders.every((order) => Math.abs(order.deltaNotionalUsd) === expectedDeltaNotionalUsd),
      `${name}: expected every planned order to respect the configured cap`,
    )
  }
  if (expectedExposurePrefixes) {
    assert.deepEqual(
      status.exposurePlan.prefixes.map((prefix) => prefix.projectedGrossUsd),
      expectedExposurePrefixes,
      `${name}: conservative prefix exposure`,
    )
  }
  if (reconcileCount > 1) {
    assert.ok(results.every((entry) => entry.code === 0), `${name}: every reconcile should exit 0`)
    assert.equal(
      new Set(submittedOrders.map((order) => order.client_order_id)).size,
      submittedOrders.length,
      `${name}: filled tranches should use distinct client order IDs`,
    )
  }
  if (expectedRequestCount !== null) {
    assert.equal(requestCount, expectedRequestCount, `${name}: endpoint rejection must occur before any request`)
  }
  if (expectedAssetRequestCount !== null) {
    assert.equal(assetReadCount, expectedAssetRequestCount, `${name}: UNG asset/borrow request count`)
  }
  if (expectedRiskLedgerHighWatermark !== null) {
    const ledger = JSON.parse(await readFile(path.join(brokerDir, 'risk-ledger.json'), 'utf8'))
    assert.equal(ledger.equityHighWatermarkUsd, expectedRiskLedgerHighWatermark, `${name}: persisted equity high-water mark`)
  }
  if (expectedSubmittedQuantityBySymbol) {
    const actualBySymbol = Object.fromEntries(submittedOrders.map((order) => [order.symbol, Number(order.qty)]))
    for (const [symbol, expectedQuantity] of Object.entries(expectedSubmittedQuantityBySymbol)) {
      assert.equal(actualBySymbol[symbol], expectedQuantity, `${name}: refreshed ${symbol} order quantity`)
    }
  }
  if (expectedBrokerLockPresent !== null) {
    assert.equal(
      existsSync(path.join(brokerDir, 'operation.lock')),
      expectedBrokerLockPresent,
      `${name}: broker operation lock retention`,
    )
  }
  console.log(`ok - ${name}`)
}

async function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function testSupervisorLock() {
  const supervisorDir = path.join(scratch, 'supervisor')
  const env = {
    ...process.env,
    QORE_LIVE_SUPERVISOR_STATE_DIR: supervisorDir,
    QORE_LIVE_REFRESH_RESEARCH: '0',
    QORE_LIVE_COLLECT_FREE_DATA_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_SUMMER_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_WINTER_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_ALL_YEAR_ENABLED: '0',
    QORE_LIVE_WEATHER_HANDOFF_ENABLED: '0',
    QORE_LIVE_BROKER_RECONCILE_ENABLED: '0',
    QORE_LIVE_SUPERVISOR_TICK_MS: '100',
  }
  const first = spawn(process.execPath, ['scripts/qore-live-trading-supervisor.mjs'], {
    cwd: repoDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitForFile(path.join(supervisorDir, 'supervisor.lock'))
    const second = await runNode(['scripts/qore-live-trading-supervisor.mjs', '--once'], env)
    assert.equal(second.code, 1)
    assert.match(second.stderr, /already running/)
  } finally {
    first.kill('SIGTERM')
    await new Promise((resolve) => first.once('close', resolve))
  }
  assert.equal(existsSync(path.join(supervisorDir, 'supervisor.lock')), false)

  const staleLockPath = path.join(supervisorDir, 'supervisor.lock')
  const deadLock = `${JSON.stringify({ pid: 999_999_999, token: 'dead-owner' })}\n`
  await writeFile(staleLockPath, deadLock, 'utf8')
  let stale = await runNode(['scripts/qore-live-trading-supervisor.mjs', '--once'], env)
  assert.equal(stale.code, 1)
  assert.match(stale.stderr, /remove the lock manually/)
  assert.equal(await readFile(staleLockPath, 'utf8'), deadLock)
  await rm(staleLockPath)

  const malformedLock = '{not-json\n'
  await writeFile(staleLockPath, malformedLock, 'utf8')
  stale = await runNode(['scripts/qore-live-trading-supervisor.mjs', '--once'], env)
  assert.equal(stale.code, 1)
  assert.match(stale.stderr, /remove the lock manually/)
  assert.equal(await readFile(staleLockPath, 'utf8'), malformedLock)
  await rm(staleLockPath)
  console.log('ok - supervisor locks fail closed and ownership-checked shutdown cleanup works')
}

async function testSupervisorChangedLockOwnershipIsPreserved() {
  const supervisorDir = path.join(scratch, 'supervisor-ownership-change')
  const lockPath = path.join(supervisorDir, 'supervisor.lock')
  const env = {
    ...process.env,
    QORE_LIVE_SUPERVISOR_STATE_DIR: supervisorDir,
    QORE_LIVE_WEATHER_HANDOFF_ENABLED: '0',
    QORE_LIVE_BROKER_RECONCILE_ENABLED: '0',
    QORE_LIVE_SUPERVISOR_TICK_MS: '100',
  }
  const child = spawn(process.execPath, ['scripts/qore-live-trading-supervisor.mjs'], {
    cwd: repoDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitForFile(lockPath)
    const original = JSON.parse(await readFile(lockPath, 'utf8'))
    await writeJson(lockPath, { ...original, token: 'replacement-owner-token' })
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('close', resolve))
    assert.equal(existsSync(lockPath), true)
    assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).token, 'replacement-owner-token')
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    await rm(supervisorDir, { recursive: true, force: true })
  }
  console.log('ok - supervisor shutdown preserves a lock whose ownership token changed')
}

async function writeTermResistantSupervisorFixture(fixtureDir) {
  const fixtureScriptsDir = path.join(fixtureDir, 'scripts')
  await mkdir(fixtureScriptsDir, { recursive: true })
  const grandchildSource = [
    "const { appendFileSync } = require('node:fs')",
    "process.on('SIGTERM', () => {})",
    "setInterval(() => appendFileSync(process.env.QORE_TEST_HEARTBEAT_FILE, `${process.pid}\\n`), 20)",
  ].join(';')
  await writeFile(
    path.join(fixtureScriptsDir, 'qore-live-weather-service.mjs'),
    [
      "import { spawn } from 'node:child_process'",
      `spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { env: process.env, stdio: 'ignore' })`,
      "process.on('SIGTERM', () => {})",
      'setInterval(() => {}, 1000)',
    ].join('\n'),
    'utf8',
  )
}

async function testSupervisorKillsTimedOutProcessTreeBeforeLockRelease() {
  const fixtureDir = path.join(scratch, 'supervisor-process-tree-timeout')
  const stateDir = path.join(fixtureDir, 'state')
  const heartbeatPath = path.join(fixtureDir, 'grandchild-heartbeat.log')
  await writeTermResistantSupervisorFixture(fixtureDir)
  const result = await runNode([supervisorScript, '--once', '--json'], {
    QORE_TEST_CWD: fixtureDir,
    QORE_TEST_HEARTBEAT_FILE: heartbeatPath,
    QORE_LIVE_SUPERVISOR_STATE_DIR: stateDir,
    QORE_LIVE_WEATHER_HANDOFF_ENABLED: '1',
    QORE_LIVE_BROKER_RECONCILE_ENABLED: '0',
    QORE_LIVE_JOB_TIMEOUT_MS: '300',
    QORE_LIVE_JOB_TERMINATION_GRACE_MS: '100',
    QORE_LIVE_JOB_KILL_WAIT_MS: '1000',
  })
  assert.equal(result.code, 1)
  const status = JSON.parse(result.stdout)
  const weatherState = status.jobs.find((job) => job.id === 'liveWeatherOnce')?.state
  assert.equal(weatherState?.timedOut, true)
  assert.equal(weatherState?.signal, 'SIGKILL')
  assert.equal(existsSync(path.join(stateDir, 'supervisor.lock')), false)
  const heartbeatBefore = await readFile(heartbeatPath, 'utf8')
  assert.ok(heartbeatBefore.length > 0, 'grandchild must run before containment is tested')
  await delay(250)
  assert.equal(await readFile(heartbeatPath, 'utf8'), heartbeatBefore, 'grandchild writes must stop before lock release')
  console.log('ok - supervisor kills a timed-out child and grandchild before releasing its lock')
}

async function testSupervisorShutdownKillsProcessTreeBeforeLockRelease() {
  const fixtureDir = path.join(scratch, 'supervisor-process-tree-shutdown')
  const stateDir = path.join(fixtureDir, 'state')
  const lockPath = path.join(stateDir, 'supervisor.lock')
  const heartbeatPath = path.join(fixtureDir, 'grandchild-heartbeat.log')
  await writeTermResistantSupervisorFixture(fixtureDir)
  const child = spawn(process.execPath, [supervisorScript, '--json'], {
    cwd: fixtureDir,
    env: {
      ...process.env,
      QORE_TEST_HEARTBEAT_FILE: heartbeatPath,
      QORE_LIVE_SUPERVISOR_STATE_DIR: stateDir,
      QORE_LIVE_WEATHER_HANDOFF_ENABLED: '1',
      QORE_LIVE_BROKER_RECONCILE_ENABLED: '0',
      QORE_LIVE_JOB_TIMEOUT_MS: '60000',
      QORE_LIVE_JOB_TERMINATION_GRACE_MS: '100',
      QORE_LIVE_JOB_KILL_WAIT_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.resume()
  child.stderr.resume()
  try {
    await waitForFile(lockPath)
    await waitForFile(heartbeatPath)
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('close', resolve))
    assert.equal(existsSync(lockPath), false)
    const heartbeatBefore = await readFile(heartbeatPath, 'utf8')
    assert.ok(heartbeatBefore.length > 0, 'grandchild must run before shutdown containment is tested')
    await delay(250)
    assert.equal(await readFile(heartbeatPath, 'utf8'), heartbeatBefore, 'shutdown must quiesce descendants before lock release')
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  console.log('ok - supervisor shutdown kills its child and grandchild before releasing its lock')
}

async function testHangingBrokerStatusReleasesOwnedLockOnSignal() {
  const stateDir = path.join(scratch, 'hanging-broker-status')
  const lockPath = path.join(stateDir, 'operation.lock')
  const sockets = new Set()
  const server = createServer(() => {
    // Intentionally never complete any Alpaca request.
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const child = spawn(process.execPath, [brokerScript, '--mode=paper', '--status', '--json'], {
    cwd: executionRepo,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APCA_API_KEY_ID: 'test-key',
      APCA_API_SECRET_KEY: 'test-secret',
      QORE_ALPACA_BASE_URL: baseUrl,
      QORE_ALPACA_DATA_BASE_URL: baseUrl,
      QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
      QORE_BROKER_STATE_DIR: stateDir,
      QORE_ALPACA_REQUEST_TIMEOUT_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.resume()
  child.stderr.resume()
  try {
    await waitForFile(lockPath)
    child.kill('SIGTERM')
    const close = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
    assert.equal(close.code, 143)
    assert.equal(existsSync(lockPath), false)
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
  console.log('ok - SIGTERM releases an owned pre-mutation broker status lock')
}

async function testHeadersThenStalledStatusBodyTimesOutAndReleasesLock() {
  const stateDir = path.join(scratch, 'stalled-status-body')
  const lockPath = path.join(stateDir, 'operation.lock')
  const sockets = new Set()
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/v2/account') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.flushHeaders()
      return
    }
    if (url.pathname === '/v2/positions' || url.pathname === '/v2/orders') jsonResponse(response, 200, [])
    else if (url.pathname === '/v2/clock') jsonResponse(response, 200, { is_open: true })
    else jsonResponse(response, 200, { quotes: {} })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    const result = await runNode([brokerScript, '--mode=paper', '--status', '--json'], {
      APCA_API_KEY_ID: 'test-key', APCA_API_SECRET_KEY: 'test-secret',
      QORE_ALPACA_BASE_URL: baseUrl, QORE_ALPACA_DATA_BASE_URL: baseUrl,
      QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1', QORE_BROKER_STATE_DIR: stateDir,
      QORE_ALPACA_REQUEST_TIMEOUT_MS: '100',
    })
    assert.equal(result.code, 1)
    assert.match(result.stdout, /timed out after 100ms/)
    assert.equal(existsSync(lockPath), false)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
  console.log('ok - request timeout covers a stalled response body and releases a read-only lock')
}

async function testSignalPreservesLockAfterMutationStarts() {
  const stateDir = path.join(scratch, 'hanging-broker-mutation')
  const lockPath = path.join(stateDir, 'operation.lock')
  const sockets = new Set()
  let postStarted = false
  await writeHandoffs()
  await writeJson(path.join(stateDir, 'risk-ledger.json'), {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-alpaca-risk-ledger',
    broker: 'alpaca',
    mode: 'paper',
    accountKey: accountKey('paper-account-id'),
    equityUsd: 10_000,
    equityHighWatermarkUsd: 10_000,
    trailingDrawdownPct: 0,
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'POST' && url.pathname === '/v2/orders') {
      postStarted = true
      return
    }
    if (url.pathname === '/v2/account') {
      jsonResponse(response, 200, {
        id: 'paper-account-id', status: 'ACTIVE', equity: '10000', last_equity: '10000', cash: '10000',
        trading_blocked: false, account_blocked: false, trade_suspended_by_user: false, shorting_enabled: true,
      })
    } else if (url.pathname === '/v2/positions' || url.pathname === '/v2/orders') {
      jsonResponse(response, 200, [])
    } else if (url.pathname === '/v2/clock') {
      jsonResponse(response, 200, { is_open: true, timestamp: new Date().toISOString() })
    } else if (url.pathname === '/v2/stocks/quotes/latest') {
      const timestamp = new Date().toISOString()
      jsonResponse(response, 200, { quotes: {
        UNG: { bp: 14.99, ap: 15.01, t: timestamp },
        VOO: { bp: 99.99, ap: 100.01, t: timestamp },
        QQQM: { bp: 49.99, ap: 50.01, t: timestamp },
      } })
    } else {
      jsonResponse(response, 404, { message: `unexpected ${request.method} ${url.pathname}` })
    }
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const child = spawn(process.execPath, [brokerScript, '--mode=paper', '--reconcile', '--json'], {
    cwd: executionRepo,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APCA_API_KEY_ID: 'test-key',
      APCA_API_SECRET_KEY: 'test-secret',
      QORE_ALPACA_BASE_URL: baseUrl,
      QORE_ALPACA_DATA_BASE_URL: baseUrl,
      QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
      QORE_LIVE_WEATHER_STATE_DIR: liveDir,
      QORE_BROKER_STATE_DIR: stateDir,
      QORE_PAPER_ORDER_ROUTING_ENABLED: '1',
      QORE_LIVE_MIN_CASH_BUFFER_PCT: '0',
      QORE_ALPACA_REQUEST_TIMEOUT_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.resume()
  child.stderr.resume()
  try {
    await waitForFile(lockPath)
    const deadline = Date.now() + 5000
    while (!postStarted && Date.now() < deadline) await delay(25)
    assert.equal(postStarted, true, 'broker mutation should start before termination')
    child.kill('SIGTERM')
    const close = await new Promise((resolve) => child.once('close', (code) => resolve(code)))
    assert.equal(close, 143)
    assert.equal(existsSync(lockPath), true)
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
    await rm(lockPath, { force: true })
  }
  console.log('ok - signal preserves the broker lock after an ambiguous in-flight mutation')
}

async function testUncertainMutationTimeoutPreservesLockWithoutSignal() {
  const stateDir = path.join(scratch, 'uncertain-mutation-timeout')
  const lockPath = path.join(stateDir, 'operation.lock')
  const sockets = new Set()
  await writeHandoffs()
  await writeJson(path.join(stateDir, 'risk-ledger.json'), {
    generatedAt: new Date().toISOString(), serviceId: 'qore-alpaca-risk-ledger', broker: 'alpaca', mode: 'paper',
    accountKey: accountKey('paper-account-id'), equityUsd: 10_000, equityHighWatermarkUsd: 10_000, trailingDrawdownPct: 0,
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'POST' && url.pathname === '/v2/orders') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.flushHeaders()
      return
    }
    if (url.pathname === '/v2/account') {
      jsonResponse(response, 200, {
        id: 'paper-account-id', status: 'ACTIVE', equity: '10000', last_equity: '10000', cash: '10000',
        trading_blocked: false, account_blocked: false, trade_suspended_by_user: false, shorting_enabled: true,
      })
    } else if (url.pathname === '/v2/positions' || url.pathname === '/v2/orders') jsonResponse(response, 200, [])
    else if (url.pathname === '/v2/clock') jsonResponse(response, 200, { is_open: true, timestamp: new Date().toISOString() })
    else if (url.pathname === '/v2/stocks/quotes/latest') {
      const timestamp = new Date().toISOString()
      jsonResponse(response, 200, { quotes: {
        UNG: { bp: 14.99, ap: 15.01, t: timestamp }, VOO: { bp: 99.99, ap: 100.01, t: timestamp },
        QQQM: { bp: 49.99, ap: 50.01, t: timestamp },
      } })
    } else jsonResponse(response, 404, { message: `unexpected ${request.method} ${url.pathname}` })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    const result = await runNode([brokerScript, '--mode=paper', '--reconcile', '--json'], {
      APCA_API_KEY_ID: 'test-key', APCA_API_SECRET_KEY: 'test-secret',
      QORE_ALPACA_BASE_URL: baseUrl, QORE_ALPACA_DATA_BASE_URL: baseUrl, QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
      QORE_LIVE_WEATHER_STATE_DIR: liveDir, QORE_BROKER_STATE_DIR: stateDir,
      QORE_PAPER_ORDER_ROUTING_ENABLED: '1', QORE_LIVE_MIN_CASH_BUFFER_PCT: '0', QORE_ALPACA_REQUEST_TIMEOUT_MS: '100',
    })
    assert.equal(result.code, 1)
    assert.match(result.stdout, /timed out after 100ms/)
    assert.equal(existsSync(lockPath), true)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
    await rm(lockPath, { force: true })
  }
  console.log('ok - an unconfirmed mutation response preserves the broker lock without a signal')
}

async function testMutationServerFailurePreservesLock() {
  const stateDir = path.join(scratch, 'uncertain-mutation-server-failure')
  const lockPath = path.join(stateDir, 'operation.lock')
  await writeHandoffs()
  await writeJson(path.join(stateDir, 'risk-ledger.json'), {
    generatedAt: new Date().toISOString(), serviceId: 'qore-alpaca-risk-ledger', broker: 'alpaca', mode: 'paper',
    accountKey: accountKey('paper-account-id'), equityUsd: 10_000, equityHighWatermarkUsd: 10_000, trailingDrawdownPct: 0,
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'POST' && url.pathname === '/v2/orders') {
      jsonResponse(response, 502, { message: 'upstream response failed after dispatch' })
    } else if (url.pathname === '/v2/account') {
      jsonResponse(response, 200, {
        id: 'paper-account-id', status: 'ACTIVE', equity: '10000', last_equity: '10000', cash: '10000',
        trading_blocked: false, account_blocked: false, trade_suspended_by_user: false, shorting_enabled: true,
      })
    } else if (url.pathname === '/v2/positions' || url.pathname === '/v2/orders') jsonResponse(response, 200, [])
    else if (url.pathname === '/v2/clock') jsonResponse(response, 200, { is_open: true, timestamp: new Date().toISOString() })
    else if (url.pathname === '/v2/stocks/quotes/latest') {
      const timestamp = new Date().toISOString()
      jsonResponse(response, 200, { quotes: {
        UNG: { bp: 14.99, ap: 15.01, t: timestamp }, VOO: { bp: 99.99, ap: 100.01, t: timestamp },
        QQQM: { bp: 49.99, ap: 50.01, t: timestamp },
      } })
    } else jsonResponse(response, 404, { message: `unexpected ${request.method} ${url.pathname}` })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    const result = await runNode([brokerScript, '--mode=paper', '--reconcile', '--json'], {
      APCA_API_KEY_ID: 'test-key', APCA_API_SECRET_KEY: 'test-secret',
      QORE_ALPACA_BASE_URL: baseUrl, QORE_ALPACA_DATA_BASE_URL: baseUrl, QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
      QORE_LIVE_WEATHER_STATE_DIR: liveDir, QORE_BROKER_STATE_DIR: stateDir,
      QORE_PAPER_ORDER_ROUTING_ENABLED: '1', QORE_LIVE_MIN_CASH_BUFFER_PCT: '0',
    })
    assert.equal(result.code, 1)
    assert.match(result.stdout, /failed with 502/)
    assert.equal(existsSync(lockPath), true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(lockPath, { force: true })
  }
  console.log('ok - a mutation server failure preserves the broker lock for reconciliation')
}

async function testMaliciousDataEndpointMakesZeroRequests() {
  let requestCount = 0
  const server = createServer((_request, response) => {
    requestCount += 1
    jsonResponse(response, 500, { message: 'must never be reached' })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const maliciousDataUrl = `http://127.0.0.1:${server.address().port}`
  const endpointDir = path.join(scratch, 'malicious-data-endpoint')
  try {
    const result = await runNode([brokerScript, '--mode=paper', '--status', '--json'], {
      APCA_API_KEY_ID: 'test-key',
      APCA_API_SECRET_KEY: 'test-secret',
      QORE_ALPACA_BASE_URL: 'https://paper-api.alpaca.markets',
      QORE_ALPACA_DATA_BASE_URL: maliciousDataUrl,
      QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '0',
      QORE_BROKER_STATE_DIR: endpointDir,
    })
    assert.equal(result.code, 1)
    assert.match(result.stdout, /market data requires the exact endpoint/)
    assert.equal(requestCount, 0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  console.log('ok - malicious Alpaca data endpoint is rejected before any credentialed request')
}

async function testStatusDoesNotSynthesizeOrRewriteInvalidRiskLedger() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/v2/account') {
      jsonResponse(response, 200, {
        id: 'paper-account-id', status: 'ACTIVE', equity: '10000', last_equity: '10000', cash: '10000',
        trading_blocked: false, account_blocked: false, trade_suspended_by_user: false,
      })
    } else if (url.pathname === '/v2/positions' || url.pathname === '/v2/orders') {
      jsonResponse(response, 200, [])
    } else if (url.pathname === '/v2/clock') {
      jsonResponse(response, 200, { is_open: true, timestamp: new Date().toISOString() })
    } else if (url.pathname === '/v2/stocks/quotes/latest') {
      const timestamp = new Date().toISOString()
      jsonResponse(response, 200, { quotes: {
        UNG: { bp: 14.99, ap: 15.01, t: timestamp },
        VOO: { bp: 99.99, ap: 100.01, t: timestamp },
        QQQM: { bp: 49.99, ap: 50.01, t: timestamp },
      } })
    } else if (url.pathname === '/v2/account/portfolio/history') {
      jsonResponse(response, 200, { timestamp: [], equity: [], profit_loss: [], profit_loss_pct: [] })
    } else {
      jsonResponse(response, 404, { message: `unexpected ${url.pathname}` })
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    for (const variant of ['missing', 'malformed']) {
      const statusDir = path.join(scratch, `status-risk-ledger-${variant}`)
      const ledgerPath = path.join(statusDir, 'risk-ledger.json')
      if (variant === 'malformed') {
        await mkdir(statusDir, { recursive: true })
        await writeFile(ledgerPath, '{not-json\n', 'utf8')
      }
      const before = variant === 'malformed' ? await readFile(ledgerPath, 'utf8') : null
      const result = await runNode([brokerScript, '--mode=paper', '--status', '--json'], {
        APCA_API_KEY_ID: 'test-key',
        APCA_API_SECRET_KEY: 'test-secret',
        QORE_ALPACA_BASE_URL: baseUrl,
        QORE_ALPACA_DATA_BASE_URL: baseUrl,
        QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
        QORE_BROKER_STATE_DIR: statusDir,
      })
      assert.equal(result.code, 0, result.stderr)
      const status = JSON.parse(result.stdout)
      assert.equal(status.account.trailingDrawdownPct, null)
      if (variant === 'missing') assert.equal(existsSync(ledgerPath), false)
      else assert.equal(await readFile(ledgerPath, 'utf8'), before)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  console.log('ok - status leaves invalid risk ledgers untouched and reports drawdown UNKNOWN')
}

async function testPrepareDisablesBrokerOverride() {
  const supervisorDir = path.join(scratch, 'prepare-supervisor')
  const result = await runNode(['scripts/qore-live-trading-supervisor.mjs', '--once', '--prepare', '--json'], {
    QORE_LIVE_SUPERVISOR_STATE_DIR: supervisorDir,
    QORE_LIVE_REFRESH_RESEARCH: '0',
    QORE_LIVE_COLLECT_FREE_DATA_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_SUMMER_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_WINTER_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_ALL_YEAR_ENABLED: '0',
    QORE_LIVE_WEATHER_HANDOFF_ENABLED: '0',
    QORE_LIVE_BROKER_RECONCILE_ENABLED: '1',
    QORE_BROKER_MODE: 'dry-run',
  })
  assert.equal(result.code, 0, result.stderr)
  const status = JSON.parse(await readFile(path.join(supervisorDir, 'status.json'), 'utf8'))
  assert.equal(status.prepareOnly, true)
  assert.deepEqual(status.jobs.map((job) => job.id), ['liveWeatherOnce', 'brokerReconcile'])
  const broker = status.jobs.find((job) => job.id === 'brokerReconcile')
  assert.equal(broker?.enabled, false)
  assert.equal(broker?.state, null)
  console.log('ok - preparation mode disables broker reconcile despite an enabling environment override')
}

async function testSupervisorWeatherCadence() {
  const cadenceDir = path.join(scratch, 'cadence')
  const weatherDir = path.join(cadenceDir, 'weather')
  const inferencePath = path.join(cadenceDir, 'all-year-target.json')
  const now = new Date().toISOString()
  await writeJson(inferencePath, {
    generatedAt: now,
    validated: true,
    liveForecastAppliedToTarget: true,
    storageValidation: { latestInputDate: today(), latestPolledDate: today(), latestPolledStorageBcf: 3000 },
    target: { targetDate: today(), gasPosition: 0, indexFraction: 1, cashFraction: 0 },
  })
  await writeJson(path.join(weatherDir, 'current-weather-snapshot.json'), {
    generatedAt: now,
    digest: 'test-weather-digest',
    riskContext: { forecastIssuedAt: now, sourceCount: 2, coveragePct: 100 },
  })
  await writeJson(path.join(weatherDir, 'market-reference-prices.json'), {
    generatedAt: now,
    freshness: { freshestPriceUpdatedAt: now },
    referencePrices: { UNG: 15 },
    rows: [{ symbol: 'UNG', status: 'ok' }],
  })
  await writeJson(path.join(weatherDir, 'broker-account-and-positions.json'), {
    generatedAt: now,
    liveRoutingEnabled: true,
    brokerConnected: true,
    account: { equityUsd: 10_000 },
  })
  await writeJson(path.join(weatherDir, 'eia-storage-release-window.json'), {
    generatedAt: now,
    latestStorage: { date: today(), storageBcf: 3000 },
    riskContext: { reportedAt: now },
  })
  const env = {
    QORE_LIVE_SUPERVISOR_STATE_DIR: path.join(cadenceDir, 'supervisor'),
    QORE_LIVE_WEATHER_STATE_DIR: weatherDir,
    QORE_LIVE_WEATHER_PROFILE: 'conservative',
    QORE_LIVE_INFERENCE_FILE: inferencePath,
    QORE_LIVE_REFRESH_RESEARCH: '0',
    QORE_LIVE_COLLECT_FREE_DATA_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_SUMMER_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_WINTER_ENABLED: '0',
    QORE_LIVE_OPTIMIZE_ALL_YEAR_ENABLED: '0',
    QORE_LIVE_WEATHER_HANDOFF_ENABLED: '1',
    QORE_LIVE_BROKER_RECONCILE_ENABLED: '0',
    QORE_LIVE_WEATHER_CURRENT_FORECAST: '1',
    QORE_LIVE_MARKET_REFERENCE_PRICES_ENABLED: '1',
    QORE_LIVE_BROKER_ACCOUNT_AND_POSITIONS_ENABLED: '1',
    QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '1',
    QORE_LIVE_RISK_AND_KILL_SWITCH_STATE_ENABLED: '1',
    QORE_LIVE_SIGNAL_INTENT_RECONCILE_ENABLED: '0',
    QORE_LIVE_STRATEGY_INFERENCE_INTERVAL_MS: String(60 * 60 * 1000),
  }
  const result = await runNode(['scripts/qore-live-trading-supervisor.mjs', '--once', '--json'], env)
  assert.equal(result.code, 0, result.stderr)
  const supervisor = JSON.parse(await readFile(path.join(cadenceDir, 'supervisor', 'status.json'), 'utf8'))
  const weather = supervisor.jobs.find((job) => job.id === 'liveWeatherOnce')?.state
  assert.equal(weather?.ok, true)
  assert.match(weather.command, /--respect-cadence/)
  const status = JSON.parse(await readFile(path.join(cadenceDir, 'weather', 'status.json'), 'utf8'))
  assert.equal(status.runConfiguration.respectCadence, true)
  assert.equal(status.runConfiguration.profile, 'conservative')
  assert.equal(status.cycle.dueJobs.includes('strategyInference'), false)
  assert.deepEqual(status.cycle.dueJobs, ['riskAndKillSwitchState'])
  const risk = JSON.parse(await readFile(path.join(weatherDir, 'risk-and-kill-switch-state.json'), 'utf8'))
  assert.equal(risk.operator, null)
  assert.equal(risk.readiness.killSwitchClear, null)
  assert.match(risk.blockedReasons.join(' '), /Operator state is missing/)
  assert.equal(risk.readiness.accountContextPresent, true)
  assert.equal(risk.readiness.marketContextPresent, true)
  assert.equal(risk.readiness.weatherContextPresent, true)
  assert.equal(risk.readiness.storageContextPresent, true)
  console.log('ok - supervisor one-shot preserves cadences and hydrates fresh risk dependencies')
}

async function testStorageInferenceCoherencyFailsClosed() {
  const coherencyDir = path.join(scratch, 'storage-coherency')
  const weatherDir = path.join(coherencyDir, 'weather')
  const inferencePath = path.join(coherencyDir, 'all-year-target.json')
  const now = new Date().toISOString()
  await writeJson(inferencePath, {
    generatedAt: now,
    validated: true,
    liveForecastAppliedToTarget: true,
    storageValidation: { latestInputDate: '2026-01-09', latestPolledDate: '2026-01-09', latestPolledStorageBcf: 4100 },
    target: { targetDate: today(), gasPosition: 0, indexFraction: 1, cashFraction: 0 },
  })
  await writeJson(path.join(weatherDir, 'eia-storage-release-window.json'), {
    generatedAt: now,
    latestStorage: { date: '2026-01-16', storageBcf: 3900 },
    riskContext: { reportedAt: '2026-01-22T14:30:00.000Z' },
  })
  const result = await runNode(['scripts/qore-live-weather-service.mjs', '--once', '--respect-cadence', '--no-performance-test', '--no-forecast-calendar'], {
    QORE_LIVE_WEATHER_STATE_DIR: weatherDir,
    QORE_LIVE_INFERENCE_FILE: inferencePath,
    QORE_LIVE_WEATHER_CURRENT_FORECAST: '0',
    QORE_LIVE_MARKET_REFERENCE_PRICES_ENABLED: '0',
    QORE_LIVE_BROKER_ACCOUNT_AND_POSITIONS_ENABLED: '0',
    QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '1',
    QORE_LIVE_STRATEGY_INFERENCE_ENABLED: '1',
    QORE_LIVE_RISK_AND_KILL_SWITCH_STATE_ENABLED: '1',
    QORE_LIVE_SIGNAL_INTENT_RECONCILE_ENABLED: '0',
  })
  assert.equal(result.code, 0, result.stderr)
  const risk = JSON.parse(await readFile(path.join(weatherDir, 'risk-and-kill-switch-state.json'), 'utf8'))
  assert.equal(risk.storage, null)
  assert.equal(risk.readiness.storageContextPresent, false)
  assert.equal(risk.readiness.storageInferenceCoherent, false)
  console.log('ok - fresher polled EIA context fails closed until strategy inference applies the release')
}

async function testContinuousHydratedCadenceSleeps() {
  const cadenceDir = path.join(scratch, 'continuous-cadence')
  const weatherDir = path.join(cadenceDir, 'weather')
  const inferencePath = path.join(cadenceDir, 'all-year-target.json')
  await writeJson(inferencePath, {
    generatedAt: new Date().toISOString(),
    strategyId: 'ngas-all-year-beta',
    validated: true,
    liveForecastAppliedToTarget: true,
    target: { targetDate: today(), gasPosition: 0, indexFraction: 1, cashFraction: 0 },
  })
  const child = spawn(process.execPath, ['scripts/qore-live-weather-service.mjs', '--respect-cadence', '--no-performance-test', '--no-forecast-calendar'], {
    cwd: repoDir,
    env: {
      ...process.env,
      QORE_LIVE_WEATHER_STATE_DIR: weatherDir,
      QORE_LIVE_INFERENCE_FILE: inferencePath,
      QORE_LIVE_WEATHER_CURRENT_FORECAST: '0',
      QORE_LIVE_MARKET_REFERENCE_PRICES_ENABLED: '0',
      QORE_LIVE_BROKER_ACCOUNT_AND_POSITIONS_ENABLED: '0',
      QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '0',
      QORE_LIVE_RISK_AND_KILL_SWITCH_STATE_ENABLED: '0',
      QORE_LIVE_SIGNAL_INTENT_RECONCILE_ENABLED: '0',
      QORE_LIVE_STRATEGY_INFERENCE_ENABLED: '1',
      QORE_LIVE_STRATEGY_INFERENCE_INTERVAL_MS: String(60 * 60 * 1000),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })))
  const statusPath = path.join(weatherDir, 'status.json')
  const deadline = Date.now() + 8_000
  while (!existsSync(statusPath) && Date.now() < deadline) await delay(25)
  try {
    assert.equal(existsSync(statusPath), true, `continuous cadence status was not written: ${stderr}`)
    const status = JSON.parse(await readFile(statusPath, 'utf8'))
    assert.deepEqual(status.cycle.dueJobs, [])
    assert.ok(status.cycle.sleepMs > 30 * 60 * 1000, `hydrated job should sleep until cadence, got ${status.cycle.sleepMs}ms`)
  } finally {
    child.kill('SIGTERM')
    await closed
  }
  console.log('ok - continuous cadence sleeps after hydrating fresh outputs')
}

async function testInvalidInferenceRetriesWithoutReplacingLastSuccess() {
  const inferenceDir = path.join(scratch, 'inference-retry')
  const inferencePath = path.join(inferenceDir, 'all-year-target.json')
  const validated = {
    generatedAt: '2026-07-14T00:00:00.000Z',
    validated: true,
    liveForecastAppliedToTarget: true,
    target: { targetDate: '2026-07-14', gasPosition: 0, indexFraction: 1, cashFraction: 0 },
  }
  await writeJson(inferencePath, validated)
  const before = await readFile(inferencePath, 'utf8')
  const refresh = await runNode(['scripts/qore-live-strategy-inference.mjs'], {
    QORE_LIVE_INFERENCE_STATE_DIR: inferenceDir,
    QORE_LIVE_INFERENCE_FILE: inferencePath,
    QORE_LIVE_INFERENCE_SKIP_FETCH: '1',
  })
  assert.equal(refresh.code, 1)
  assert.equal(await readFile(inferencePath, 'utf8'), before)

  await writeJson(inferencePath, { generatedAt: new Date().toISOString(), validated: false, liveForecastAppliedToTarget: false, error: 'previous failure' })
  const weatherDir = path.join(inferenceDir, 'weather')
  const weather = await runNode(['scripts/qore-live-weather-service.mjs', '--once', '--respect-cadence', '--no-performance-test'], {
    QORE_LIVE_WEATHER_STATE_DIR: weatherDir,
    QORE_LIVE_INFERENCE_STATE_DIR: inferenceDir,
    QORE_LIVE_INFERENCE_FILE: inferencePath,
    QORE_LIVE_INFERENCE_SKIP_FETCH: '1',
    QORE_LIVE_WEATHER_CURRENT_FORECAST: '0',
    QORE_LIVE_MARKET_REFERENCE_PRICES_ENABLED: '0',
    QORE_LIVE_BROKER_ACCOUNT_AND_POSITIONS_ENABLED: '0',
    QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '0',
    QORE_LIVE_RISK_AND_KILL_SWITCH_STATE_ENABLED: '0',
    QORE_LIVE_SIGNAL_INTENT_RECONCILE_ENABLED: '0',
  })
  assert.equal(weather.code, 1)
  const status = JSON.parse(await readFile(path.join(weatherDir, 'status.json'), 'utf8'))
  assert.deepEqual(status.cycle.dueJobs, ['strategyInference'])
  console.log('ok - invalid inference snapshots retry immediately without replacing the last success')
}

async function testMissingInferenceFailsClosed() {
  const invalidPath = path.join(scratch, 'invalid-signal-intent.json')
  const variants = [
    {
      inference: { validated: true, liveForecastAppliedToTarget: true, forecastValidation: { latestCommonIssueDate: today() } },
      expectedCheck: 'live-strategy-inference',
    },
    {
      inference: { strategyId: 'ngas-all-year-beta', validated: true, liveForecastAppliedToTarget: true },
      intent: { targetDate: today() },
      expectedCheck: 'live-strategy-freshness',
    },
  ]
  for (const variant of variants) {
    await writeJson(invalidPath, variant)
    for (const mode of ['paper', 'live']) {
      const result = await runNode(['scripts/qore-live-readiness.mjs', `--mode=${mode}`, '--local-only', '--json'], {
        QORE_LIVE_SIGNAL_INTENT_FILE: invalidPath,
      })
      const readiness = JSON.parse(result.stdout)
      assert.equal(readiness.checks.find((check) => check.id === variant.expectedCheck)?.status, 'block')
    }
  }
  console.log('ok - paper/live readiness requires exact inference identity and validated issue-date freshness')
}

async function testMissingKillSwitchStatusIsUnknown() {
  const killDir = path.join(scratch, 'missing-kill-status')
  const result = await runNode(['scripts/qore-live-kill-switch.mjs', 'status'], {
    QORE_LIVE_WEATHER_STATE_DIR: killDir,
  })
  assert.equal(result.code, 0, result.stderr)
  const status = JSON.parse(result.stdout)
  assert.equal(status.killSwitchEngaged, null)
  assert.equal(status.stateValid, false)
  assert.equal(status.blocked, true)
  assert.match(status.reason, /UNKNOWN/)
  console.log('ok - missing operator state reports UNKNOWN and blocked')
}

async function testCanonicalOperatorStatePath() {
  const fixture = path.join(scratch, 'canonical-operator-state')
  const customWeatherDir = path.join(fixture, 'custom-weather-state')
  const explicitOperatorPath = path.join(fixture, 'canonical', 'operator-state.json')
  const legacyOperatorPath = path.join(fixture, 'legacy-cadence-operator.json')
  const settingsPath = path.join(fixture, 'weather-settings.json')
  const canonicalEnv = {
    QORE_LIVE_WEATHER_STATE_DIR: customWeatherDir,
    QORE_LIVE_OPERATOR_STATE_FILE: explicitOperatorPath,
  }

  const relativePaths = resolveLiveWeatherPaths(repoDir, {
    QORE_LIVE_WEATHER_STATE_DIR: 'relative-weather-state',
    QORE_LIVE_OPERATOR_STATE_FILE: 'relative-operator-state.json',
  })
  assert.equal(relativePaths.stateDir, path.join(repoDir, 'relative-weather-state'))
  assert.equal(relativePaths.operatorStatePath, path.join(repoDir, 'relative-operator-state.json'))
  assert.equal(relativePaths.operatorStateSource, 'QORE_LIVE_OPERATOR_STATE_FILE')
  const stateDerivedPaths = resolveLiveWeatherPaths(repoDir, {
    QORE_LIVE_WEATHER_STATE_DIR: 'relative-weather-state',
  })
  assert.equal(stateDerivedPaths.operatorStatePath, path.join(repoDir, 'relative-weather-state', 'operator-state.json'))
  assert.equal(stateDerivedPaths.operatorStateSource, 'QORE_LIVE_WEATHER_STATE_DIR')
  const absolutePaths = resolveLiveWeatherPaths(repoDir, canonicalEnv)
  assert.equal(absolutePaths.stateDir, customWeatherDir)
  assert.equal(absolutePaths.operatorStatePath, explicitOperatorPath)
  assert.equal(absolutePaths.operatorStateSource, 'QORE_LIVE_OPERATOR_STATE_FILE')

  await writeJson(path.join(customWeatherDir, 'operator-state.json'), {
    killSwitchEngaged: false,
    reason: 'Default custom-state path must lose to the canonical override.',
  })
  await writeJson(legacyOperatorPath, {
    killSwitchEngaged: false,
    reason: 'Legacy cadence config must not override the canonical path.',
  })
  await writeJson(settingsPath, {
    defaultProfile: 'test',
    profiles: {
      test: {
        cadences: {
          riskAndKillSwitchState: {
            enabled: true,
            operatorStateFile: legacyOperatorPath,
          },
        },
      },
    },
  })

  const engaged = await runNode(['scripts/qore-live-kill-switch.mjs', 'engage', '--reason=canonical-path-regression'], canonicalEnv)
  assert.equal(engaged.code, 0, engaged.stderr)
  const killStatus = JSON.parse(engaged.stdout)
  assert.equal(killStatus.file, path.relative(repoDir, explicitOperatorPath))
  assert.equal(JSON.parse(await readFile(explicitOperatorPath, 'utf8')).killSwitchEngaged, true)

  const weather = await runNode([
    'scripts/qore-live-weather-service.mjs', '--once', '--no-performance-test', '--no-forecast-calendar',
  ], {
    ...canonicalEnv,
    QORE_LIVE_WEATHER_SETTINGS_FILE: settingsPath,
    QORE_LIVE_WEATHER_PROFILE: 'test',
    QORE_LIVE_WEATHER_CURRENT_FORECAST: '0',
    QORE_LIVE_MARKET_REFERENCE_PRICES_ENABLED: '0',
    QORE_LIVE_BROKER_ACCOUNT_AND_POSITIONS_ENABLED: '0',
    QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '0',
    QORE_LIVE_STRATEGY_INFERENCE_ENABLED: '0',
    QORE_LIVE_RISK_AND_KILL_SWITCH_STATE_ENABLED: '1',
    QORE_LIVE_SIGNAL_INTENT_RECONCILE_ENABLED: '0',
  })
  assert.equal(weather.code, 0, weather.stderr)
  assert.match(weather.stderr, /ignored deprecated riskAndKillSwitchState\.operatorStateFile/)
  const weatherStatus = JSON.parse(await readFile(path.join(customWeatherDir, 'status.json'), 'utf8'))
  assert.equal(weatherStatus.runConfiguration.operatorState.file, path.relative(repoDir, explicitOperatorPath))
  assert.equal(weatherStatus.runConfiguration.operatorState.source, 'QORE_LIVE_OPERATOR_STATE_FILE')
  assert.equal(weatherStatus.runConfiguration.operatorState.ignoredLegacyCadenceFile, legacyOperatorPath)
  const risk = JSON.parse(await readFile(path.join(customWeatherDir, 'risk-and-kill-switch-state.json'), 'utf8'))
  assert.equal(risk.operator.killSwitchEngaged, true)
  assert.equal(risk.operatorStateFile, path.relative(repoDir, explicitOperatorPath))
  assert.equal(JSON.parse(await readFile(legacyOperatorPath, 'utf8')).killSwitchEngaged, false)

  const dashboardPort = await freePort()
  const dashboard = spawn(process.execPath, [dashboardScript], {
    cwd: repoDir,
    env: {
      ...process.env,
      ...canonicalEnv,
      QORE_REPO_DIR: repoDir,
      QORE_DASHBOARD_SERVICE_PORT: String(dashboardPort),
      QORE_DASHBOARD_SERVICE_ALLOWED_ORIGINS: '',
      QORE_BROKER_STATE_DIR: path.join(fixture, 'dashboard-broker'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let dashboardOutput = ''
  dashboard.stdout.on('data', (chunk) => { dashboardOutput += chunk })
  dashboard.stderr.on('data', (chunk) => { dashboardOutput += chunk })
  const dashboardClosed = new Promise((resolve) => dashboard.once('close', resolve))
  let dashboardTelemetry = null
  try {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (dashboard.exitCode !== null) throw new Error(`Dashboard exited early: ${dashboardOutput}`)
      try {
        const response = await fetch(`http://127.0.0.1:${dashboardPort}/api/live/status`)
        if (response.ok) {
          dashboardTelemetry = await response.json()
          break
        }
      } catch {
        await delay(25)
      }
    }
    assert.ok(dashboardTelemetry, `dashboard did not start: ${dashboardOutput}`)
    assert.equal(dashboardTelemetry.risk.killSwitchEngaged, true)
    assert.match(dashboardTelemetry.risk.blockedReasons.join(' '), /kill switch is engaged/i)
  } finally {
    if (dashboard.exitCode === null) dashboard.kill('SIGTERM')
    await dashboardClosed
  }

  await scenario({
    name: 'readiness and broker honor the canonical operator-state override',
    readinessOnly: true,
    expectedBlock: /kill switch is engaged/i,
    commandEnvOverrides: {
      ...canonicalEnv,
      QORE_LIVE_SIGNAL_INTENT_FILE: path.join(liveDir, 'signal-intent-reconcile.json'),
      QORE_LIVE_MARKET_REFERENCE_FILE: path.join(liveDir, 'market-reference-prices.json'),
      QORE_LIVE_RISK_STATE_FILE: path.join(liveDir, 'risk-and-kill-switch-state.json'),
    },
  })
  console.log('ok - kill switch, weather risk, readiness, broker, and dashboard share one canonical operator-state path')
}

async function runGit(cwd, args) {
  return await new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function prepareExecutionRepoFixture(root, { initializeGit }) {
  await mkdir(root, { recursive: true })
  await symlink(path.join(repoDir, 'scripts'), path.join(root, 'scripts'), 'dir')
  await writeJson(path.join(root, 'config/qore-live-broker-settings.json'), {})
  await writeJson(path.join(root, 'config/qore-live-weather-settings.json'), {})
  await writeJson(path.join(root, 'data/qore/market/index-basket-config.json'), validBasket)
  if (!initializeGit) return
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.email', 'qore-test@example.com'],
    ['config', 'user.name', 'QORE Test'],
    ['add', '.'],
    ['commit', '-m', 'clean execution fixture'],
  ]) {
    const result = await runGit(root, args)
    assert.equal(result.code, 0, result.stderr)
  }
}

async function testGitGeneratedArtifactAllowlist() {
  const gitDir = path.join(scratch, 'readiness-git-state')
  const generatedPath = path.join(gitDir, 'data/qore/runs/free-data-manifest.json')
  const researchPath = path.join(gitDir, 'data/qore/research/run-summary.json')
  const datasetManifestPath = path.join(gitDir, 'data/qore/dataset-manifest.json')
  const executionConfigPath = path.join(gitDir, 'data/qore/market/index-basket-config.json')
  const requiredPaths = [
    'config/qore-live-broker-settings.json',
    'config/qore-live-weather-settings.json',
    'scripts/qore-alpaca-broker.mjs',
    'scripts/qore-live-trading-supervisor.mjs',
  ]
  await writeJson(generatedPath, { generatedAt: 'baseline' })
  await writeJson(researchPath, { generatedAt: 'baseline' })
  await writeJson(datasetManifestPath, { generatedAt: 'baseline' })
  await writeJson(executionConfigPath, { symbols: ['VOO'] })
  for (const relativePath of requiredPaths) await writeJson(path.join(gitDir, relativePath), {})
  const commands = [
    ['init', '-b', 'main'],
    ['config', 'user.email', 'qore-test@example.com'],
    ['config', 'user.name', 'QORE Test'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ]
  for (const args of commands) {
    const result = await runGit(gitDir, args)
    assert.equal(result.code, 0, result.stderr)
  }

  const signalPath = path.join(scratch, 'readiness-git-state-signal.json')
  const currentInferenceSeason = inferenceSeason()
  const currentInferenceContract = inferenceContract(currentInferenceSeason)
  await writeJson(signalPath, {
    inference: {
      strategyId: 'ngas-all-year-beta',
      mode: 'selected-contract-live-source-set-00z',
      season: currentInferenceSeason,
      targetDate: today(),
      componentStrategyId: 'index-fallback',
      windowId: 'index-fallback',
      thesisKind: 'index-fallback',
      validated: true,
      liveForecastAppliedToTarget: true,
      forecastValidation: {
        latestCommonIssueDate: today(), issueAgeDays: 0, runHourUtc: '00',
        ...currentInferenceContract,
      },
    },
    intent: { targetDate: today(), gasPosition: 0 },
  })
  const readinessEnv = {
    QORE_TEST_CWD: gitDir,
    QORE_LIVE_SIGNAL_INTENT_FILE: signalPath,
    APCA_API_KEY_ID: 'test-key',
    APCA_API_SECRET_KEY: 'test-secret',
    QORE_LIVE_TRADING_ENABLED: '1',
    QORE_LIVE_ORDER_ROUTING_ENABLED: '1',
    QORE_CONFIRM_LIVE_TRADING: 'I_UNDERSTAND_THIS_CAN_LOSE_MONEY',
  }
  const readinessScript = path.join(repoDir, 'scripts/qore-live-readiness.mjs')

  await writeJson(generatedPath, { generatedAt: new Date().toISOString() })
  let result = await runNode([readinessScript, '--mode=live', '--local-only', '--json'], readinessEnv)
  let readiness = JSON.parse(result.stdout)
  let gitState = readiness.checks.find((check) => check.id === 'git-state')
  assert.equal(gitState?.status, 'warn')
  assert.match(gitState?.detail ?? '', /1 generated data artifact change/)

  await writeJson(generatedPath, { generatedAt: 'baseline' })
  await writeJson(executionConfigPath, { symbols: ['QQQM'] })
  result = await runNode([readinessScript, '--mode=live', '--local-only', '--json'], readinessEnv)
  readiness = JSON.parse(result.stdout)
  gitState = readiness.checks.find((check) => check.id === 'git-state')
  assert.equal(gitState?.status, 'block')
  assert.match(gitState?.detail ?? '', /1 code\/config change/)

  await writeJson(executionConfigPath, { symbols: ['VOO'] })
  await writeJson(researchPath, { generatedAt: 'changed research' })
  result = await runNode([readinessScript, '--mode=live', '--local-only', '--json'], readinessEnv)
  readiness = JSON.parse(result.stdout)
  gitState = readiness.checks.find((check) => check.id === 'git-state')
  assert.equal(gitState?.status, 'block')
  assert.match(gitState?.detail ?? '', /1 code\/config change/)

  await writeJson(researchPath, { generatedAt: 'baseline' })
  await writeJson(datasetManifestPath, { generatedAt: 'changed dataset manifest' })
  result = await runNode([readinessScript, '--mode=live', '--local-only', '--json'], readinessEnv)
  readiness = JSON.parse(result.stdout)
  gitState = readiness.checks.find((check) => check.id === 'git-state')
  assert.equal(gitState?.status, 'block')
  assert.match(gitState?.detail ?? '', /1 code\/config change/)

  await writeJson(datasetManifestPath, { generatedAt: 'baseline' })
  await rm(generatedPath)
  result = await runNode([readinessScript, '--mode=live', '--local-only', '--json'], readinessEnv)
  readiness = JSON.parse(result.stdout)
  gitState = readiness.checks.find((check) => check.id === 'git-state')
  assert.equal(gitState?.status, 'block')
  assert.match(gitState?.detail ?? '', /1 code\/config change/)

  await writeJson(generatedPath, { generatedAt: 'baseline' })
  await writeJson(generatedPath, { generatedAt: 'staged acquisition' })
  let gitResult = await runGit(gitDir, ['add', 'data/qore/runs/free-data-manifest.json'])
  assert.equal(gitResult.code, 0, gitResult.stderr)
  result = await runNode([readinessScript, '--mode=live', '--local-only', '--json'], readinessEnv)
  readiness = JSON.parse(result.stdout)
  gitState = readiness.checks.find((check) => check.id === 'git-state')
  assert.equal(gitState?.status, 'block')
  assert.match(gitState?.detail ?? '', /1 code\/config change/)
  gitResult = await runGit(gitDir, ['reset', 'HEAD', '--', 'data/qore/runs/free-data-manifest.json'])
  assert.equal(gitResult.code, 0, gitResult.stderr)
  console.log('ok - live Git gate only allows unstaged writer-owned acquisition outputs')
}

async function testStaleTargetFailsDirectReadiness() {
  await writeHandoffs({ targetDate: '2000-01-01' })
  for (const mode of ['paper', 'live']) {
    const result = await runNode(['scripts/qore-live-readiness.mjs', `--mode=${mode}`, '--local-only', '--json'], {
      QORE_LIVE_SIGNAL_INTENT_FILE: path.join(liveDir, 'signal-intent-reconcile.json'),
    })
    const readiness = JSON.parse(result.stdout)
    assert.equal(result.code, 1)
    const freshness = readiness.checks.find((check) => check.id === 'live-strategy-freshness')
    assert.equal(freshness?.status, 'block')
    assert.match(freshness?.detail ?? '', /validated inference issue date 2000-01-01/)
  }
  console.log('ok - direct paper/live readiness recomputes and blocks a stale target')
}

async function testSupervisorPrestartDefersRefreshableState() {
  await writeHandoffs({ targetDate: '2000-01-01' })
  const result = await runNode(['scripts/qore-live-readiness.mjs', '--mode=live', '--local-only', '--supervisor-prestart', '--json'], {
    QORE_LIVE_SIGNAL_INTENT_FILE: path.join(liveDir, 'signal-intent-reconcile.json'),
  })
  const readiness = JSON.parse(result.stdout)
  assert.equal(readiness.checks.some((check) => check.id === 'last-data-refresh'), false)
  assert.equal(readiness.checks.some((check) => check.id === 'live-strategy-inference'), false)
  assert.equal(readiness.checks.some((check) => check.id === 'live-strategy-freshness'), false)

  const installer = await readFile(path.join(repoDir, 'scripts/install-linux-live-service.mjs'), 'utf8')
  assert.match(installer, /ExecStartPre=.* --local-only --supervisor-prestart/)
  console.log('ok - systemd prestart defers state that the supervisor refreshes')
}

async function testSignalFreshnessUsesValidatedInferenceIssue() {
  const freshnessDir = path.join(scratch, 'signal-freshness')
  const inferencePath = path.join(freshnessDir, 'all-year-target.json')
  await writeJson(inferencePath, {
    generatedAt: new Date().toISOString(),
    strategyId: 'ngas-all-year-beta',
    validated: true,
    liveForecastAppliedToTarget: true,
    inferenceMode: 'test-live-inference',
    forecastValidation: { latestCommonIssueDate: today(), issueAgeDays: 0 },
    target: {
      strategyId: 'ngas-all-year-beta',
      signalDate: '2020-01-01',
      targetDate: today(),
      gasPosition: 0,
      indexFraction: 1,
      cashFraction: 0,
      direction: 'flat',
      confidence: 0.8,
      windowId: 'weather-reversion',
    },
  })
  const result = await runNode(['scripts/qore-live-weather-service.mjs', '--once', '--no-performance-test'], {
    QORE_LIVE_WEATHER_STATE_DIR: freshnessDir,
    QORE_LIVE_INFERENCE_FILE: inferencePath,
    QORE_LIVE_WEATHER_CURRENT_FORECAST: '0',
    QORE_LIVE_MARKET_REFERENCE_PRICES_ENABLED: '0',
    QORE_LIVE_BROKER_ACCOUNT_AND_POSITIONS_ENABLED: '0',
    QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '0',
    QORE_LIVE_STRATEGY_INFERENCE_ENABLED: '0',
    QORE_LIVE_RISK_AND_KILL_SWITCH_STATE_ENABLED: '0',
    QORE_LIVE_SIGNAL_INTENT_RECONCILE_ENABLED: '1',
  })
  assert.equal(result.code, 0, result.stderr)
  const signal = JSON.parse(await readFile(path.join(freshnessDir, 'signal-intent-reconcile.json'), 'utf8'))
  assert.equal(signal.intent.signalDate, '2020-01-01')
  assert.equal(signal.signalAgeDays, 0)
  console.log('ok - signal freshness follows the validated inference issue instead of target lifecycle age')
}

async function testMalformedInferenceTargetCannotReplaceSignalIntent() {
  const targetDir = path.join(scratch, 'strict-signal-target')
  const inferencePath = path.join(targetDir, 'all-year-target.json')
  const signalPath = path.join(targetDir, 'signal-intent-reconcile.json')
  const validTarget = {
    strategyId: 'ngas-all-year-beta',
    signalDate: today(),
    targetDate: today(),
    direction: 'flat',
    gasPosition: 0,
    indexFraction: 1,
    cashFraction: 0,
    confidence: 0.8,
    windowId: 'index-fallback',
  }
  const variants = [
    {
      label: 'missing gas weight',
      mutate: (target) => Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'gasPosition')),
    },
    { label: 'non-finite confidence', mutate: (target) => ({ ...target, confidence: null }) },
    { label: 'inconsistent direction', mutate: (target) => ({ ...target, direction: 'long' }) },
    { label: 'invalid allocation total', mutate: (target) => ({ ...target, cashFraction: 0.25 }) },
    { label: 'invalid signal date', mutate: (target) => ({ ...target, signalDate: 'not-a-date' }) },
    { label: 'foreign target strategy', mutate: (target) => ({ ...target, strategyId: 'another-strategy' }) },
    { label: 'foreign inference strategy', inferenceStrategyId: 'another-strategy', mutate: (target) => target },
  ]

  for (const variant of variants) {
    await writeJson(inferencePath, {
      generatedAt: new Date().toISOString(),
      strategyId: variant.inferenceStrategyId ?? 'ngas-all-year-beta',
      validated: true,
      liveForecastAppliedToTarget: true,
      inferenceMode: 'test-live-inference',
      forecastValidation: { latestCommonIssueDate: today(), issueAgeDays: 0 },
      target: variant.mutate(validTarget),
    })
    await writeJson(signalPath, { sentinel: variant.label })
    const before = await readFile(signalPath, 'utf8')
    const result = await runNode(['scripts/qore-live-weather-service.mjs', '--once', '--no-performance-test'], {
      QORE_LIVE_WEATHER_STATE_DIR: targetDir,
      QORE_LIVE_INFERENCE_FILE: inferencePath,
      QORE_LIVE_SIGNAL_INTENT_FILE: signalPath,
      QORE_LIVE_WEATHER_CURRENT_FORECAST: '0',
      QORE_LIVE_MARKET_REFERENCE_PRICES_ENABLED: '0',
      QORE_LIVE_BROKER_ACCOUNT_AND_POSITIONS_ENABLED: '0',
      QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '0',
      QORE_LIVE_STRATEGY_INFERENCE_ENABLED: '0',
      QORE_LIVE_RISK_AND_KILL_SWITCH_STATE_ENABLED: '0',
      QORE_LIVE_SIGNAL_INTENT_RECONCILE_ENABLED: '1',
    })
    assert.equal(result.code, 1, `${variant.label} must fail the signal handoff job`)
    assert.equal(await readFile(signalPath, 'utf8'), before, `${variant.label} must preserve the last signal handoff`)
  }
  console.log('ok - malformed inference targets cannot be normalized into a valid-looking broker handoff')
}

await prepareExecutionRepoFixture(executionRepo, { initializeGit: true })
await prepareExecutionRepoFixture(nonGitExecutionRepo, { initializeGit: false })

try {
  const currentTestInferenceSeason = inferenceSeason()
  const oppositeTestInferenceSeason = currentTestInferenceSeason === 'summer' ? 'winter' : 'summer'
  const oppositeTestInferenceContract = inferenceContract(oppositeTestInferenceSeason)
  testEiaReleaseTimestamp()
  await scenario({ name: 'paper reconcile uses Alpaca bid/ask and submits ETF deltas' })
  await scenario({
    name: 'capped paper reconcile advances through two consecutively filled tranches',
    gasPosition: 1,
    indexFraction: 0,
    maxOrderUsd: '100',
    reconcileCount: 2,
    fillSubmittedOrders: true,
    rejectDuplicateClientOrderIds: true,
    expectedOrderCount: 2,
    expectedDeltaNotionalUsd: 100,
  })
  await scenario({
    name: 'paper reconcile defaults to a two-percent cash buffer when the setting is absent',
    minCashBufferPct: null,
    expectedTargetNotionalUsd: { VOO: 7840, QQQM: 1960, UNG: 0 },
  })
  await scenario({
    name: 'paper reconcile can route the strategy short leg when Alpaca confirms borrowability',
    allowShorts: true,
    gasPosition: -1,
    indexFraction: 0,
    expectedOrderCount: 1,
    expectedFirstSide: 'sell',
    expectedAssetRequestCount: 2,
  })
  await scenario({
    name: 'paper reconcile blocks when UNG borrowability is revoked at the final submission boundary',
    allowShorts: true,
    gasPosition: -1,
    indexFraction: 0,
    assetOverridesByRead: [{}, { shortable: false }],
    expectedAssetRequestCount: 2,
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Final submission safety recheck blocked UNG order.*shortable=true/,
    },
  })
  await scenario({
    name: 'paper reconcile requires Alpaca shortable to be exactly true',
    allowShorts: true, gasPosition: -1, indexFraction: 0,
    assetOverrides: { shortable: false },
    expectedBlock: /shortable=true/,
  })
  await scenario({
    name: 'paper reconcile blocks unknown UNG borrow availability even with the HTB override',
    allowShorts: true, gasPosition: -1, indexFraction: 0,
    assetOverrides: { easy_to_borrow: null, borrow_status: null },
    commandEnvOverrides: { QORE_ALPACA_ALLOW_HARD_TO_BORROW: '1' },
    expectedBlock: /easy_to_borrow must be explicitly boolean/,
  })
  await scenario({
    name: 'paper reconcile rejects status-only HTB when easy_to_borrow is missing',
    allowShorts: true, gasPosition: -1, indexFraction: 0,
    assetOverrides: { easy_to_borrow: null, borrow_status: 'hard_to_borrow' },
    commandEnvOverrides: { QORE_ALPACA_ALLOW_HARD_TO_BORROW: '1' },
    expectedBlock: /easy_to_borrow must be explicitly boolean/,
  })
  await scenario({
    name: 'paper reconcile blocks recognized hard-to-borrow UNG without explicit permission',
    allowShorts: true, gasPosition: -1, indexFraction: 0,
    assetOverrides: { easy_to_borrow: false, borrow_status: null },
    expectedBlock: /hard-to-borrow/,
  })
  await scenario({
    name: 'paper reconcile permits positively recognized HTB only with explicit permission',
    allowShorts: true, gasPosition: -1, indexFraction: 0,
    assetOverrides: { easy_to_borrow: false, borrow_status: null },
    commandEnvOverrides: { QORE_ALPACA_ALLOW_HARD_TO_BORROW: '1' },
    expectedOrderCount: 1,
    expectedFirstSide: 'sell',
  })
  await scenario({
    name: 'paper reconcile permits a risk-reducing UNG buy-to-cover without current borrow permission',
    positions: [{ symbol: 'UNG', qty: '100', side: 'short', current_price: '15', market_value: '1500' }],
    gasPosition: -0.1,
    indexFraction: 0,
    cashFraction: 0.9,
    allowShorts: false,
    assetOverrides: { shortable: false, easy_to_borrow: null, borrow_status: null },
    expectedOrderCount: 1,
    expectedFirstSide: 'buy',
    expectedAssetRequestCount: 0,
  })
  await scenario({
    name: 'paper reconcile ignores mark-to-market drift inside the equity-relative deadband',
    positions: [
      { symbol: 'VOO', qty: '79.9', side: 'long', current_price: '100', market_value: '7990' },
      { symbol: 'QQQM', qty: '40.2', side: 'long', current_price: '50', market_value: '2010' },
    ],
    expectedOrderCount: 0,
    expectedNoOp: true,
  })
  await scenario({
    name: 'paper reconcile applies the equity-relative deadband before the maximum order cap',
    accountOverrides: { equity: '100000', last_equity: '100000', cash: '100000', buying_power: '100000' },
    maxOrderUsd: '100',
    expectedDeltaNotionalUsd: 100,
  })
  await scenario({ name: 'preflight validates the complete route without submitting', preflightOnly: true })
  await scenario({ name: 'readiness runs the complete no-order broker preflight', readinessOnly: true })
  await scenario({
    name: 'readiness blocks when an Alpaca safety flag is not exactly false',
    readinessOnly: true,
    accountOverrides: { trading_blocked: null },
    expectedBlock: /Account is not ACTIVE or has a trading\/account suspension flag/,
  })
  await scenario({
    name: 'paper reconcile requires a live forecast applied to the target',
    liveForecastAppliedToTarget: false,
    expectedBlock: /live forecast has not been applied/,
  })
  await scenario({
    name: 'paper reconcile requires validated inference',
    liveForecastAppliedToTarget: true,
    inferenceValidated: false,
    expectedBlock: /live forecast inference is not validated/,
  })
  await scenario({
    name: 'paper reconcile requires the exact inference strategy id',
    inferenceStrategyId: null,
    expectedBlock: /Signal inference strategyId must equal ngas-all-year-beta/,
  })
  await scenario({
    name: 'paper reconcile requires a validated forecast issue date without target fallback',
    forecastIssueDate: null,
    expectedBlock: /no valid validated inference issue date/,
  })
  await scenario({
    name: 'paper reconcile rejects a non-production inference mode',
    inferenceProvenanceOverrides: { mode: 'forged-live-inference' },
    expectedBlock: /provenance is invalid: inference mode must equal/,
  })
  await scenario({
    name: 'paper reconcile rejects a partial selected-contract source set',
    inferenceProvenanceOverrides: {
      forecastValidation: { requiredSources: ['gfs'], collectedSources: ['gfs'], scoreRowCount: 1 },
    },
    expectedBlock: /requiredSources must equal the reviewed/,
  })
  await scenario({
    name: `paper reconcile rejects ${oppositeTestInferenceSeason} provenance for a current ${currentTestInferenceSeason} target`,
    gasPosition: 0.2, indexFraction: 0.8, cashFraction: 0,
    inferenceProvenanceOverrides: {
      season: oppositeTestInferenceSeason,
      componentStrategyId: `ngas-${oppositeTestInferenceSeason}-alpha`,
      windowId: 'weather-follow',
      thesisKind: oppositeTestInferenceSeason === 'summer' ? 'summer-heat-long' : 'cold-long',
      forecastValidation: oppositeTestInferenceContract,
    },
    expectedBlock: new RegExp(`inference season must equal ${currentTestInferenceSeason}`),
  })
  await scenario({
    name: `paper reconcile rejects incoherent ${currentTestInferenceSeason} component window diagnostics`,
    gasPosition: 0.2, indexFraction: 0.8, cashFraction: 0,
    inferenceProvenanceOverrides: {
      windowId: 'weather-follow',
      thesisKind: currentTestInferenceSeason === 'summer' ? 'cold-long' : 'summer-heat-long',
    },
    expectedBlock: new RegExp(`windowId/thesisKind is not a reviewed ${currentTestInferenceSeason} target combination`),
  })
  const currentSeasonLongThesis = currentTestInferenceSeason === 'summer' ? 'summer-heat-long' : 'cold-long'
  const currentSeasonShortThesis = currentTestInferenceSeason === 'summer' ? 'summer-cold-short' : 'warm-short'
  await scenario({
    name: `paper reconcile rejects positive ${currentSeasonLongThesis} provenance with a negative target`,
    gasPosition: -0.2, indexFraction: 0.8, cashFraction: 0,
    inferenceProvenanceOverrides: { thesisKind: currentSeasonLongThesis },
    expectedBlock: new RegExp(`${currentSeasonLongThesis} provenance requires intent gasPosition greater than zero`),
  })
  await scenario({
    name: `paper reconcile rejects negative ${currentSeasonShortThesis} provenance with a positive target`,
    gasPosition: 0.2, indexFraction: 0.8, cashFraction: 0,
    inferenceProvenanceOverrides: { thesisKind: currentSeasonShortThesis },
    expectedBlock: new RegExp(`${currentSeasonShortThesis} provenance requires intent gasPosition less than zero`),
  })
  await scenario({
    name: 'paper reconcile requires inference and intent target lifecycle dates to match',
    inferenceProvenanceOverrides: { targetDate: '2000-01-01' },
    expectedBlock: /inference targetDate must be valid and exactly match intent targetDate/,
  })
  await scenario({
    name: 'paper reconcile blocks a future target lifecycle even with coherent nested dates',
    targetDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    expectedBlock: /intent targetDate must be the current UTC date/,
  })
  await scenario({
    name: 'readiness rejects corrupt selected-contract row provenance',
    readinessOnly: true,
    inferenceProvenanceOverrides: { forecastValidation: { scoreRowCount: 0 } },
    expectedBlock: /scoreRowCount must be an integer/,
  })
  await scenario({
    name: 'paper reconcile ignores the stale-signal diagnostic override',
    targetDate: '2000-01-01',
    commandEnvOverrides: { QORE_ALLOW_STALE_SIGNAL: '1' },
    expectedBlock: /Signal intent is stale .*validated inference issue date 2000-01-01/,
  })
  await scenario({
    name: 'paper reconcile blocks without an explicit operator-state file',
    operatorState: 'missing',
    expectedBlock: /Explicit operator state with a boolean killSwitchEngaged value is required/,
  })
  await scenario({
    name: 'paper reconcile blocks a malformed operator-state file',
    operatorState: 'invalid',
    expectedBlock: /Explicit operator state with a boolean killSwitchEngaged value is required/,
  })
  await scenario({
    name: 'paper reconcile blocks when the direct risk state is missing',
    riskStateMissing: true,
    expectedBlock: /Risk snapshot generatedAt is missing or invalid|Fresh weather model context is required/,
  })
  await scenario({
    name: 'paper reconcile blocks a missing risk snapshot timestamp',
    riskGeneratedAt: null,
    expectedBlock: /Risk snapshot generatedAt is missing or invalid/,
  })
  await scenario({
    name: 'paper reconcile blocks an invalid risk snapshot timestamp',
    riskGeneratedAt: 'not-a-time',
    expectedBlock: /Risk snapshot generatedAt is missing or invalid/,
  })
  await scenario({
    name: 'paper reconcile blocks a stale risk snapshot using the configured limit',
    riskGeneratedAt: new Date(Date.now() - 2_000).toISOString(),
    maxRiskSnapshotAgeSeconds: '1',
    expectedBlock: /Risk snapshot is .* old; cap is 1s/,
  })
  await scenario({
    name: 'paper reconcile blocks a risk snapshot future-dated beyond tolerance',
    riskGeneratedAt: new Date(Date.now() + 60_000).toISOString(),
    expectedBlock: /Risk snapshot is .* future-dated; tolerance is 30s/,
  })
  await scenario({
    name: 'paper reconcile blocks incoherent storage inference readiness',
    riskReadinessOverrides: { storageInferenceCoherent: false },
    expectedBlock: /storageInferenceCoherent is not true/,
  })
  await scenario({
    name: 'paper mode refuses a non-paper trading endpoint',
    allowTestEndpoint: false,
    expectedBlock: /Paper mode requires the exact Alpaca trading endpoint/,
    expectedRequestCount: 0,
  })
  await testMaliciousDataEndpointMakesZeroRequests()
  await testMissingInferenceFailsClosed()
  await testMissingKillSwitchStatusIsUnknown()
  await testCanonicalOperatorStatePath()
  await testStaleTargetFailsDirectReadiness()
  await testSupervisorPrestartDefersRefreshableState()
  await testSignalFreshnessUsesValidatedInferenceIssue()
  await testMalformedInferenceTargetCannotReplaceSignalIntent()
  await testGitGeneratedArtifactAllowlist()
  await scenario({
    name: 'authoritative Alpaca market clock blocks a closed venue',
    marketOpen: false,
    expectedBlock: /Execution venue is closed/,
  })
  await scenario({
    name: 'missing Alpaca market-clock state remains unknown and blocks',
    marketOpen: null,
    expectedBlock: /market clock is unavailable/,
  })
  await scenario({
    name: 'initial Alpaca market clock requires a timestamp',
    marketClockOverrides: { timestamp: null },
    expectedBlock: /Initial Alpaca market clock timestamp is missing or invalid/,
  })
  await scenario({
    name: 'initial Alpaca market clock blocks a stale timestamp',
    marketClockOverrides: { timestamp: new Date(Date.now() - 60000).toISOString() },
    expectedBlock: /Initial Alpaca market clock timestamp is .* old/,
  })
  await scenario({
    name: 'initial Alpaca market clock blocks a materially future timestamp',
    marketClockOverrides: { timestamp: new Date(Date.now() + 60000).toISOString() },
    expectedBlock: /Initial Alpaca market clock timestamp is .* future-dated/,
  })
  await scenario({
    name: 'paper reconcile ignores the outside-market diagnostic override',
    marketOpen: false,
    commandEnvOverrides: { QORE_ALLOW_OUTSIDE_MARKET_QUEUE: '1' },
    expectedBlock: /Execution venue is closed/,
  })
  await scenario({
    name: 'wide Alpaca spread blocks all submissions',
    quoteOverrides: { VOO: { bp: 99, ap: 101, t: new Date().toISOString() } },
    expectedBlock: /VOO spread .* exceeds/,
  })
  await scenario({
    name: 'invalid Alpaca quote cannot fall back to cached spread data',
    quoteOverrides: { VOO: { bp: 101, ap: 99, t: new Date().toISOString() } },
    marketSpreads: { VOO: 10, QQQM: 10 },
    expectedBlock: /invalid bid\/ask quote for VOO/,
  })
  await scenario({
    name: 'a later-order fresh quote spread breach halts the remaining batch',
    quoteOverridesByRead: [{}, {}, { QQQM: { bp: 49, ap: 51, t: new Date().toISOString() } }],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /Fresh QQQM quote spread .* exceeds/,
    },
  })
  await scenario({
    name: 'a later valid quote recomputes the submitted quantity from fresh ask',
    quoteOverridesByRead: [{}, {}, { QQQM: { bp: 59.99, ap: 60.01, t: new Date().toISOString() } }],
    expectedOrderCount: 2,
    expectedSubmittedQuantityBySymbol: { QQQM: 33.327778 },
  })
  await scenario({
    name: 'a later-order stale quote halts the remaining batch',
    quoteOverridesByRead: [{}, {}, { QQQM: { bp: 49.99, ap: 50.01, t: '2000-01-01T00:00:00.000Z' } }],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /Fresh QQQM quote is .* old/,
    },
  })
  await scenario({
    name: 'a later-order crossed quote halts the remaining batch',
    quoteOverridesByRead: [{}, {}, { QQQM: { bp: 51, ap: 49, t: new Date().toISOString() } }],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /Fresh QQQM quote must contain positive, noncrossed bid\/ask prices/,
    },
  })
  await scenario({
    name: 'failed risk-reducing sell halts later buy submissions',
    positions: [{ symbol: 'UNG', qty: '100', side: 'long', current_price: '15', market_value: '1500' }],
    rejectFirstOrder: true,
    expectedSubmissionFailure: true,
  })
  await scenario({
    name: 'kill switch engagement after the first accepted order halts all remaining mutations',
    engageKillAfterFirstOrder: true,
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /kill switch became engaged/,
    },
  })
  await scenario({
    name: 'market closure after the first accepted order halts all remaining mutations',
    marketOpenAfterFirstOrder: false,
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /venue became closed/,
    },
  })
  await scenario({
    name: 'a stale Alpaca clock before a later mutation halts the remaining batch',
    marketClockOverridesAfterFirstOrder: { timestamp: '2000-01-01T00:00:00.000Z' },
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /Mutation-boundary Alpaca market clock timestamp is .* old/,
    },
  })
  await scenario({
    name: 'a near-cap quote that ages during the final clock await blocks before POST',
    marketClockDelayByRead: [0, 900],
    commandEnvOverrides: { QORE_LIVE_MAX_QUOTE_AGE_MINUTES: '0.01' },
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Final submission safety recheck blocked VOO order: Fresh VOO quote is .* old/,
    },
  })
  await scenario({
    name: 'UTC rollover after the refreshed quote expires the fixed current-date signal before POST',
    handoffNow: `${today()}T23:59:59.000Z`,
    nowAfterFreshQuote: new Date(Date.parse(`${today()}T23:59:59.000Z`) + 2000).toISOString(),
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /intent targetDate must be the current UTC date/,
    },
  })
  await scenario({
    name: 'a valid changed target after the refreshed quote invalidates the canonical signal binding',
    mutateSignalAfterFreshQuote: (signal) => {
      signal.intent.gasPosition = 0.2
      signal.intent.indexFraction = 0.8
      signal.intent.cashFraction = 0
      signal.intent.direction = 'long'
      signal.inference.componentStrategyId = `ngas-${signal.inference.season}-alpha`
      signal.inference.windowId = 'weather-follow'
      signal.inference.thesisKind = signal.inference.season === 'summer' ? 'summer-heat-long' : 'cold-long'
      return signal
    },
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Canonical signal intent changed after reconcile planning/,
    },
  })
  await scenario({
    name: 'a valid risk snapshot change after the refreshed quote invalidates the canonical risk binding',
    mutateRiskAfterFreshQuote: (risk) => {
      risk.market.referencePrices.UNG = 15.25
      return risk
    },
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Canonical risk snapshot changed after reconcile planning/,
    },
  })
  await scenario({
    name: 'risk readiness invalidation after the refreshed quote blocks the final POST',
    mutateRiskAfterFreshQuote: (risk) => {
      risk.readiness.storageInferenceCoherent = false
      return risk
    },
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /storageInferenceCoherent is not true/,
    },
  })
  await scenario({
    name: 'risk snapshot expiry after the refreshed quote blocks the final POST',
    handoffNow: `${today()}T12:00:00.000Z`,
    nowAfterFreshQuote: new Date(Date.parse(`${today()}T12:00:00.000Z`) + 901000).toISOString(),
    commandEnvOverrides: { QORE_LIVE_MAX_QUOTE_AGE_MINUTES: '30' },
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Risk snapshot is 901\.0s old; cap is 900s/,
    },
  })
  await scenario({
    name: 'a final account-equity drop invalidates the refreshed gross-exposure plan before POST',
    accountOverridesByRead: [
      {},
      {},
      { equity: '7900', last_equity: '7900', cash: '7900', buying_power: '7900' },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Final submission safety recheck blocked VOO order.*current-equity sizing envelope/,
    },
    expectedRiskLedgerHighWatermark: 10000,
  })
  await scenario({
    name: 'same-symbol position drift after the refreshed quote invalidates the final fixed delta',
    positionsAfterFreshQuote: [
      { symbol: 'VOO', qty: '1', side: 'long', current_price: '100', market_value: '100' },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Final VOO signed share quantity drifted from 0 to 1/,
    },
  })
  await scenario({
    name: 'sub-microshare UNG drift cannot turn a fixed whole-share sell into an unchecked short',
    positions: [
      { symbol: 'UNG', qty: '1', side: 'long', current_price: '15', market_value: '15' },
    ],
    positionsAfterFreshQuote: [
      { symbol: 'UNG', qty: '0.9999995', side: 'long', current_price: '15', market_value: '14.9999925' },
    ],
    gasPosition: 0,
    indexFraction: 0,
    cashFraction: 1,
    commandEnvOverrides: { QORE_LIVE_REBALANCE_DEADBAND_PCT: '0.01' },
    expectedAssetRequestCount: 0,
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Final UNG signed share quantity drifted from 1 to 0\.9999995/,
    },
  })
  await scenario({
    name: 'unrelated position exposure appearing after the refreshed quote blocks the final envelope',
    positionsAfterFreshQuote: [
      { symbol: 'AAPL', qty: '30', side: 'long', current_price: '100', market_value: '3000' },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Final submission safety recheck blocked VOO order.*current-equity sizing envelope/,
    },
  })
  await scenario({
    name: 'a new matching open order after the refreshed quote invalidates the final fixed delta',
    openOrdersAfterFreshQuote: [
      {
        id: 'new-voo-order',
        symbol: 'VOO',
        side: 'buy',
        qty: '1',
        filled_qty: '0',
        notional: '100',
        client_order_id: 'external-new-voo-order',
        status: 'accepted',
      },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 0,
      reason: /Final open-order state contains 1 VOO order/,
    },
  })
  await scenario({
    name: 'fresh equity enforces the configured cash-buffer sizing envelope across the batch',
    minCashBufferPct: null,
    accountOverridesByRead: [
      {},
      {},
      {},
      { equity: '9900', last_equity: '9900', cash: '9900', buying_power: '9900' },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /Fresh exposure recheck blocked order submission.*98% current-equity sizing envelope/,
    },
  })
  await scenario({
    name: 'final equity enforces the configured cash-buffer sizing envelope before the second POST',
    minCashBufferPct: null,
    accountOverridesByRead: [
      {},
      {},
      {},
      {},
      { equity: '9900', last_equity: '9900', cash: '9900', buying_power: '9900' },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /Final submission safety recheck blocked QQQM order.*98% current-equity sizing envelope/,
    },
  })
  await scenario({
    name: 'same-symbol partial-fill drift under the exposure cap halts a stale fixed delta',
    reportSubmittedOrdersAsOpen: true,
    positionDriftAfterFirstOrder: [
      { symbol: 'QQQM', qty: '10', side: 'long', current_price: '50', market_value: '500' },
    ],
    commandEnvOverrides: { QORE_LIVE_ACCOUNT_ALLOCATION_PCT: '80' },
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /QQQM signed share quantity drifted from 0 to 10/,
    },
  })
  await scenario({
    name: 'mark-price movement without share-quantity drift does not stale the fixed delta',
    positions: [{ symbol: 'QQQM', qty: '5', side: 'long', current_price: '50', market_value: '250' }],
    positionPriceAfterFirstOrder: { QQQM: 55 },
    commandEnvOverrides: { QORE_LIVE_ACCOUNT_ALLOCATION_PCT: '80' },
    expectedOrderCount: 2,
  })
  await scenario({
    name: 'filled response exposure is retained until positions prove the fill',
    firstOrderResponseStatus: 'filled',
    positionDriftAfterFirstOrder: [
      { symbol: 'AAPL', qty: '10', side: 'long', current_price: '100', market_value: '1000' },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed', submittedOrderCount: 1,
      reason: /Fresh exposure recheck blocked order submission/,
    },
  })
  await scenario({
    name: 'intrarun equity peak persists before a later drawdown check',
    gasPosition: 0.2, indexFraction: 0.8, cashFraction: 0,
    maxGrossExposurePct: '200',
    accountOverridesBySubmittedOrder: [
      { equity: '12000', last_equity: '12000', cash: '12000' },
      { equity: '8000', last_equity: '8000', cash: '8000' },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed', submittedOrderCount: 2,
      reason: /Fresh account safety recheck blocked order submission.*trailing drawdown/,
    },
    expectedRiskLedgerHighWatermark: 12000,
  })
  await scenario({
    name: 'an equity peak observed only by the final account GET persists for the next drawdown check',
    accountOverridesByRead: [
      {},
      {},
      { equity: '12000', last_equity: '12000', cash: '12000', buying_power: '12000' },
      { equity: '8000', last_equity: '8000', cash: '8000', buying_power: '8000' },
    ],
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /Fresh account safety recheck blocked order submission.*trailing drawdown/,
    },
    expectedRiskLedgerHighWatermark: 12000,
  })
  await scenario({
    name: 'a fresh account block after the first order halts the remaining batch',
    accountOverridesAfterFirstOrder: { trading_blocked: true },
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /Fresh account safety recheck blocked order submission.*trading_blocked/,
    },
  })
  await scenario({
    name: 'a fresh unknown account safety flag halts the remaining batch',
    accountOverridesAfterFirstOrder: { account_blocked: null },
    expectedMutationHalt: {
      executionStatus: 'submit-failed', submittedOrderCount: 1,
      reason: /account_blocked is not exactly false/,
    },
  })
  await scenario({
    name: 'blocked Alpaca account fails preflight',
    accountOverrides: { trading_blocked: true },
    expectedBlock: /trading_blocked must be exactly false/,
  })
  for (const [field, label] of [
    ['trading_blocked', 'trading'], ['account_blocked', 'account'], ['trade_suspended_by_user', 'user suspension'],
  ]) {
    await scenario({
      name: `missing ${label} safety flag fails preflight`,
      accountOverrides: { [field]: null },
      expectedBlock: new RegExp(`${field} must be exactly false`),
    })
  }
  await scenario({
    name: 'daily loss stop fails preflight',
    accountOverrides: { equity: '8500', last_equity: '10000', cash: '8500', buying_power: '8500' },
    expectedBlock: /Daily P&L .* breaches/,
  })
  await scenario({
    name: 'missing Alpaca last equity fails the daily-loss gate closed',
    accountOverrides: { last_equity: null },
    expectedBlock: /Daily P&L is unavailable/,
  })
  await scenario({
    name: 'paper reconcile rejects a missing index target',
    indexFraction: null,
    cashFraction: 0,
    expectedBlock: /indexFraction must be an explicit finite value/,
  })
  await scenario({
    name: 'paper reconcile rejects an invalid gas target',
    gasPosition: 'not-a-number',
    indexFraction: 1,
    cashFraction: 0,
    expectedBlock: /gasPosition must be an explicit finite value/,
  })
  await scenario({
    name: 'paper reconcile rejects target weights that do not conserve capital',
    gasPosition: 0.5,
    indexFraction: 0.5,
    cashFraction: 0.5,
    expectedBlock: /target weights are out of contract/,
  })
  await scenario({
    name: 'paper reconcile rejects an inconsistent direction',
    gasPosition: 0.5,
    indexFraction: 0.5,
    cashFraction: 0,
    direction: 'flat',
    expectedBlock: /direction must be long/,
  })
  await scenario({
    name: 'paper reconcile rejects a non-UNG signal instrument',
    instrument: 'NG',
    expectedBlock: /instrument must equal UNG/,
  })
  await scenario({
    name: 'paper reconcile rejects a foreign signal strategy',
    intentStrategyId: 'another-strategy',
    expectedBlock: /strategyId must equal ngas-all-year-beta/,
  })
  await scenario({
    name: 'paper reconcile rejects a foreign inference strategy',
    inferenceStrategyId: 'another-strategy',
    expectedBlock: /Signal inference strategyId must equal ngas-all-year-beta/,
  })
  await scenario({
    name: 'paper reconcile rejects invalid configured basket weights',
    basket: { components: [{ symbol: 'VOO', targetWeight: null }, { symbol: 'QQQM', targetWeight: 1 }] },
    expectedBlock: /positive finite targetWeight/,
  })
  await scenario({
    name: 'paper reconcile rejects an incomplete configured basket',
    basket: { components: [{ symbol: 'VOO', targetWeight: 1 }] },
    expectedBlock: /exactly one VOO component and one QQQM component/,
  })
  await scenario({
    name: 'paper reconcile rejects a basket whose weights require material normalization',
    basket: { components: [{ symbol: 'VOO', targetWeight: 0.7 }, { symbol: 'QQQM', targetWeight: 0.2 }] },
    expectedBlock: /weights must sum to 1 within 0.001/,
  })
  await scenario({
    name: 'paper reconcile blocks a missing bound risk ledger',
    ledgerState: 'missing',
    expectedBlock: /Risk ledger is missing/,
  })
  await scenario({
    name: 'paper reconcile blocks a malformed bound risk ledger',
    ledgerState: 'malformed',
    expectedBlock: /contains malformed JSON/,
  })
  await scenario({
    name: 'paper reconcile blocks a risk ledger from another mode',
    ledgerState: 'mode-mismatch',
    expectedBlock: /belongs to mode .* instead of paper/,
  })
  await scenario({
    name: 'paper reconcile blocks a risk ledger from another account',
    ledgerState: 'account-mismatch',
    expectedBlock: /belongs to a different Alpaca account/,
  })
  await scenario({
    name: 'risk-ledger bootstrap requires the exact explicit confirmation',
    ledgerState: 'missing',
    operatorState: 'engaged',
    bootstrapOnly: true,
    expectedBlock: /QORE_CONFIRM_RISK_LEDGER_BOOTSTRAP/,
  })
  await scenario({
    name: 'risk-ledger bootstrap requires the direct kill switch to be engaged',
    ledgerState: 'missing',
    operatorState: 'clear',
    bootstrapOnly: true,
    bootstrapConfirmation: 'I_UNDERSTAND_THIS_RESETS_THE_TRAILING_DRAWDOWN_BASELINE',
    expectedBlock: /requires the direct operator kill switch to be engaged/,
  })
  await scenario({
    name: 'risk-ledger bootstrap requires a real Alpaca account id',
    ledgerState: 'missing',
    operatorState: 'engaged',
    accountOverrides: { id: null },
    bootstrapOnly: true,
    bootstrapConfirmation: 'I_UNDERSTAND_THIS_RESETS_THE_TRAILING_DRAWDOWN_BASELINE',
    expectedBlock: /requires a real Alpaca account id/,
  })
  await scenario({
    name: 'risk-ledger bootstrap requires safety flags to be exactly false',
    ledgerState: 'missing', operatorState: 'engaged',
    accountOverrides: { trade_suspended_by_user: null },
    bootstrapOnly: true,
    bootstrapConfirmation: 'I_UNDERSTAND_THIS_RESETS_THE_TRAILING_DRAWDOWN_BASELINE',
    expectedBlock: /ACTIVE Alpaca account with no trading, account, or user-suspension block/,
  })
  await scenario({
    name: 'explicit engaged-switch preflight bootstraps the risk ledger and a later clear reconcile passes',
    ledgerState: 'missing',
    operatorState: 'engaged',
    bootstrapThenReconcile: true,
  })
  await scenario({
    name: 'unrelated current positions count toward the gross-exposure prefix cap',
    positions: [{ symbol: 'AAPL', qty: '20', side: 'long', current_price: '100', market_value: '2000' }],
    expectedBlock: /Planned order prefix 2 .* above the 100% current-equity sizing envelope/,
  })
  await scenario({
    name: 'unrelated outstanding orders count toward conservative gross exposure',
    openOrders: [{ id: 'aapl-open', symbol: 'AAPL', side: 'buy', qty: '20', filled_qty: '0', limit_price: '100' }],
    expectedBlock: /Planned order prefix 2 .* above the 100% current-equity sizing envelope/,
  })
  await scenario({
    name: 'an over-cap account may submit only a strictly exposure-reducing capped tranche',
    positions: [{ symbol: 'VOO', qty: '110', side: 'long', current_price: '100', market_value: '11000' }],
    gasPosition: 0,
    indexFraction: 0,
    cashFraction: 1,
    maxOrderUsd: '1000',
    expectedOrderCount: 1,
    expectedFirstSide: 'sell',
    expectedExposurePrefixes: [10000],
  })
  await scenario({
    name: 'an account over the allocation envelope may submit a strictly exposure-reducing tranche',
    positions: [{ symbol: 'VOO', qty: '60', side: 'long', current_price: '100', market_value: '6000' }],
    gasPosition: 0,
    indexFraction: 0,
    cashFraction: 1,
    maxOrderUsd: '1000',
    maxGrossExposurePct: '200',
    commandEnvOverrides: { QORE_LIVE_ACCOUNT_ALLOCATION_PCT: '50' },
    expectedOrderCount: 1,
    expectedFirstSide: 'sell',
  })
  await scenario({
    name: 'an over-cap batch blocks a later prefix that increases projected gross',
    positions: [{ symbol: 'VOO', qty: '110', side: 'long', current_price: '100', market_value: '11000' }],
    expectedBlock: /does not strictly reduce projected gross exposure/,
  })
  await scenario({
    name: 'kill switch engagement before replacement prevents cancellations and all new orders',
    openOrders: [
      { id: 'voo-open', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0', limit_price: '100' },
      { id: 'qqqm-open', symbol: 'QQQM', side: 'buy', qty: '1', filled_qty: '0', limit_price: '50' },
    ],
    engageKillAfterInitialOpenOrdersRead: true,
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 0,
      reason: /kill switch became engaged/,
    },
  })
  await scenario({
    name: 'one cancellation failure halts replacement and the entire new-order batch',
    openOrders: [
      { id: 'voo-open', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0', limit_price: '100' },
      { id: 'qqqm-open', symbol: 'QQQM', side: 'buy', qty: '1', filled_qty: '0', limit_price: '50' },
    ],
    cancelFailureSymbol: 'VOO',
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 0,
      reason: /simulated VOO cancellation failure/,
    },
    expectedBrokerLockPresent: true,
  })
  await scenario({
    name: 'a definitive-looking cancellation rejection still preserves the broker lock',
    openOrders: [{ id: 'voo-rejected-cancel', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0', limit_price: '100' }],
    cancelFailureSymbol: 'VOO',
    cancelFailureStatus: 422,
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 0,
      reason: /failed with 422/,
    },
    expectedBrokerLockPresent: true,
  })
  await scenario({
    name: 'open-order verification failure halts the entire new-order batch',
    openOrders: [{ id: 'voo-open', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0', limit_price: '100' }],
    verifyOpenOrdersFailure: true,
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 1,
      reason: /simulated open-order verification failure/,
    },
    expectedBrokerLockPresent: false,
  })
  await scenario({
    name: 'a fill during cancellation with lagging positions halts the entire replacement batch',
    openOrders: [{ id: 'voo-open', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0', limit_price: '100' }],
    fillDuringCancelSymbol: 'VOO',
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 1,
      reason: /filled_qty 1 instead of exactly zero/,
    },
    expectedBrokerLockPresent: true,
  })
  await scenario({
    name: 'a pre-existing partial fill cannot enter replacement cancellation',
    openOrders: [{ id: 'voo-partial', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0.5', limit_price: '100' }],
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 0,
      reason: /must have filled_qty exactly zero/,
    },
    expectedBrokerLockPresent: false,
  })
  await scenario({
    name: 'an order-by-id failure after accepted cancellation preserves the broker lock',
    openOrders: [{ id: 'voo-lookup-fail', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0', limit_price: '100' }],
    cancelOrderLookupFailureSymbol: 'VOO',
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 1,
      reason: /simulated VOO order lookup failure/,
    },
    expectedBrokerLockPresent: true,
  })
  await scenario({
    name: 'a nonterminal order state after accepted cancellation preserves the broker lock',
    openOrders: [{ id: 'voo-pending-cancel', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0', limit_price: '100' }],
    cancelConfirmedStatusBySymbol: { VOO: 'pending_cancel' },
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 1,
      reason: /is pending_cancel after cancellation/,
    },
    expectedBrokerLockPresent: true,
  })
  await scenario({
    name: 'position drift during accepted cancellation preserves the broker lock',
    openOrders: [{ id: 'voo-position-drift', symbol: 'VOO', side: 'buy', qty: '1', filled_qty: '0', limit_price: '100' }],
    positionDriftDuringCancel: [{ symbol: 'VOO', qty: '1', side: 'long', current_price: '100', market_value: '100' }],
    commandEnvOverrides: { QORE_ALPACA_REPLACE_OPEN_ORDERS: '1' },
    expectedMutationHalt: {
      executionStatus: 'replace-failed',
      submittedOrderCount: 0,
      canceledOrderCount: 1,
      reason: /VOO position changed from 0 to 1/,
    },
    expectedBrokerLockPresent: true,
  })
  await scenario({
    name: 'direct operator kill switch blocks all submissions',
    killSwitchEngaged: true,
    expectedBlock: /kill switch is engaged/,
  })
  await scenario({
    name: 'live mode blocks a historical-artifact target even when all routing flags are enabled',
    brokerMode: 'live',
    liveForecastAppliedToTarget: false,
    expectedBlock: /live forecast has not been applied/,
  })
  await scenario({
    name: 'direct live broker reconcile blocks an unvalidated applied inference',
    brokerMode: 'live',
    liveForecastAppliedToTarget: true,
    inferenceValidated: false,
    expectedBlock: /live forecast inference is not validated/,
  })
  await scenario({
    name: 'direct live broker reconcile recomputes and blocks a stale target',
    brokerMode: 'live',
    targetDate: '2000-01-01',
    expectedBlock: /Signal intent is stale .*validated inference issue date 2000-01-01/,
  })
  await scenario({
    name: 'live reconcile ignores the stale-signal diagnostic override',
    brokerMode: 'live',
    targetDate: '2000-01-01',
    commandEnvOverrides: { QORE_ALLOW_STALE_SIGNAL: '1' },
    expectedBlock: /Signal intent is stale .*validated inference issue date 2000-01-01/,
  })
  await scenario({
    name: 'live reconcile ignores the outside-market diagnostic override',
    brokerMode: 'live',
    marketOpen: false,
    commandEnvOverrides: { QORE_ALLOW_OUTSIDE_MARKET_QUEUE: '1' },
    expectedBlock: /Execution venue is closed/,
  })
  await scenario({
    name: 'live reconcile blocks a dirty code working tree at the broker boundary',
    brokerMode: 'live',
    dirtyCodePath: 'config/unreviewed-live-change.json',
    expectedBlock: /requires a clean code\/config working tree/,
  })
  await scenario({
    name: 'live reconcile rechecks Git state after the first accepted order',
    brokerMode: 'live',
    dirtyCodeAfterFirstOrder: 'config/changed-after-first-live-order.json',
    expectedMutationHalt: {
      executionStatus: 'submit-failed',
      submittedOrderCount: 1,
      reason: /requires a clean code\/config working tree/,
    },
  })
  await scenario({
    name: 'live reconcile blocks when Git state cannot be read at the broker boundary',
    brokerMode: 'live',
    gitStateUnavailable: true,
    expectedBlock: /requires a readable Git working tree state/,
  })
  await testSupervisorLock()
  await testSupervisorChangedLockOwnershipIsPreserved()
  await testSupervisorKillsTimedOutProcessTreeBeforeLockRelease()
  await testSupervisorShutdownKillsProcessTreeBeforeLockRelease()
  await testHangingBrokerStatusReleasesOwnedLockOnSignal()
  await testHeadersThenStalledStatusBodyTimesOutAndReleasesLock()
  await testSignalPreservesLockAfterMutationStarts()
  await testUncertainMutationTimeoutPreservesLockWithoutSignal()
  await testMutationServerFailurePreservesLock()
  await testStatusDoesNotSynthesizeOrRewriteInvalidRiskLedger()
  await testPrepareDisablesBrokerOverride()
  await testSupervisorWeatherCadence()
  await testStorageInferenceCoherencyFailsClosed()
  await testContinuousHydratedCadenceSleeps()
  await testInvalidInferenceRetriesWithoutReplacingLastSuccess()
} finally {
  await rm(scratch, { recursive: true, force: true })
}
