#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { nominalEiaStorageReleaseAt } from './lib/eia-release-time.mjs'

const repoDir = process.cwd()
const scratch = await mkdtemp(path.join(tmpdir(), 'qore-live-test-'))
const liveDir = path.join(scratch, 'live-weather')
const brokerDir = path.join(scratch, 'broker')

function runNode(args, env = {}) {
  const cwd = env.QORE_TEST_CWD ?? repoDir
  const childEnv = { ...process.env, ...env }
  delete childEnv.QORE_TEST_CWD
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function testEiaReleaseTimestamp() {
  assert.equal(nominalEiaStorageReleaseAt('2026-07-03'), '2026-07-09T14:30:00.000Z')
  assert.equal(nominalEiaStorageReleaseAt('2026-01-16'), '2026-01-22T15:30:00.000Z')
  assert.equal(nominalEiaStorageReleaseAt('not-a-date'), null)
  console.log('ok - EIA storage freshness uses the publication time after the weekly period ends')
}

async function writeHandoffs({
  killSwitchEngaged = false,
  marketSpreads = {},
  liveForecastAppliedToTarget = true,
  inferenceValidated = liveForecastAppliedToTarget,
  targetDate = today(),
  gasPosition = 0,
  indexFraction = 1,
} = {}) {
  const now = new Date().toISOString()
  await writeJson(path.join(liveDir, 'signal-intent-reconcile.json'), {
    generatedAt: now,
    stale: false,
    signalAgeDays: 0,
    intent: {
      strategyId: 'ngas-all-year-beta',
      signalDate: today(),
      targetDate,
      instrument: 'UNG',
      direction: gasPosition > 0 ? 'long' : gasPosition < 0 ? 'short' : 'flat',
      confidence: 0.8,
      indexFraction,
      gasPosition,
    },
    inference: {
      mode: liveForecastAppliedToTarget ? 'test-live-inference' : 'historical-artifact-latest-row',
      liveForecastAppliedToTarget,
      validated: inferenceValidated,
    },
  })
  await writeJson(path.join(liveDir, 'market-reference-prices.json'), {
    generatedAt: now,
    referencePrices: { UNG: 15, VOO: 100, QQQM: 50 },
    freshness: { freshestPriceUpdatedAt: now },
    rows: Object.entries(marketSpreads).map(([symbol, spreadBps]) => ({ symbol, spreadBps })),
  })
  await writeJson(path.join(liveDir, 'risk-and-kill-switch-state.json'), {
    generatedAt: now,
    operator: { killSwitchEngaged: false, venueOpen: true },
    weather: { forecastIssuedAt: now, sourceCount: 2, coveragePct: 100 },
    storage: { reportedAt: now },
    market: { priceUpdatedAt: now, referencePrices: { UNG: 15, VOO: 100, QQQM: 50 } },
    readiness: {
      accountContextPresent: true,
      marketContextPresent: true,
      weatherContextPresent: true,
      storageContextPresent: true,
    },
  })
  if (killSwitchEngaged) {
    await writeJson(path.join(liveDir, 'operator-state.json'), { killSwitchEngaged: true, updatedAt: now })
  } else {
    await rm(path.join(liveDir, 'operator-state.json'), { force: true })
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
  marketSpreads = {},
  positions = [],
  rejectFirstOrder = false,
  preflightOnly = false,
  readinessOnly = false,
  marketOpen = true,
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
  liveForecastAppliedToTarget = true,
  inferenceValidated = liveForecastAppliedToTarget,
  targetDate = today(),
}) {
  await rm(brokerDir, { recursive: true, force: true })
  await writeHandoffs({
    killSwitchEngaged,
    marketSpreads,
    liveForecastAppliedToTarget,
    inferenceValidated,
    targetDate,
    gasPosition,
    indexFraction,
  })
  const submittedOrders = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/v2/account') {
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
        ...accountOverrides,
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/positions') {
      jsonResponse(response, 200, positions)
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/orders') {
      jsonResponse(response, 200, [])
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/clock') {
      jsonResponse(response, 200, {
        is_open: marketOpen,
        timestamp: new Date().toISOString(),
        next_open: new Date(Date.now() + 3600000).toISOString(),
        next_close: new Date(Date.now() + 7200000).toISOString(),
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/assets/UNG') {
      jsonResponse(response, 200, {
        symbol: 'UNG',
        status: 'active',
        tradable: true,
        marginable: true,
        shortable: true,
        easy_to_borrow: true,
        borrow_status: 'easy_to_borrow',
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v2/stocks/quotes/latest') {
      const timestamp = new Date().toISOString()
      jsonResponse(response, 200, {
        quotes: {
          UNG: { bp: 14.99, ap: 15.01, t: timestamp },
          VOO: { bp: 99.99, ap: 100.01, t: timestamp },
          QQQM: { bp: 49.99, ap: 50.01, t: timestamp },
          ...quoteOverrides,
        },
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v2/orders') {
      let body = ''
      for await (const chunk of request) body += chunk
      submittedOrders.push(JSON.parse(body))
      if (rejectFirstOrder && submittedOrders.length === 1) {
        jsonResponse(response, 422, { message: 'simulated sell rejection' })
        return
      }
      jsonResponse(response, 200, { id: `order-${submittedOrders.length}`, status: 'accepted' })
      return
    }
    jsonResponse(response, 404, { message: `Unexpected ${request.method} ${url.pathname}` })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const commandArgs = readinessOnly
    ? ['scripts/qore-live-readiness.mjs', `--mode=${brokerMode}`, '--json']
    : ['scripts/qore-alpaca-broker.mjs', `--mode=${brokerMode}`, preflightOnly ? '--preflight-only' : '--reconcile', '--json']
  const result = await runNode(commandArgs, {
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
    QORE_LIVE_MIN_CASH_BUFFER_PCT: '0',
    QORE_LIVE_REBALANCE_DEADBAND_PCT: '0.25',
  })
  await new Promise((resolve) => server.close(resolve))
  const status = JSON.parse(await readFile(path.join(brokerDir, 'status.json'), 'utf8'))

  if (readinessOnly) {
    const readiness = JSON.parse(result.stdout)
    assert.equal(result.code, 0, `${name}: readiness should exit 0 (${result.stderr || result.stdout})`)
    assert.equal(readiness.ready, true, `${name}: readiness should be ready`)
    assert.equal(readiness.checks.find((check) => check.id === 'broker-preflight')?.status, 'pass')
    assert.equal(readiness.checks.find((check) => check.id === 'live-strategy-inference')?.status, 'pass')
    assert.equal(readiness.checks.some((check) => check.id === 'all-year-artifact-freshness'), false)
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
  console.log('ok - duplicate supervisor lock and shutdown cleanup')
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
  await writeJson(invalidPath, { inference: { liveForecastAppliedToTarget: true } })
  const result = await runNode(['scripts/qore-live-readiness.mjs', '--mode=live', '--local-only', '--json'], {
    QORE_LIVE_SIGNAL_INTENT_FILE: invalidPath,
  })
  const readiness = JSON.parse(result.stdout)
  assert.equal(readiness.checks.find((check) => check.id === 'live-strategy-inference')?.status, 'block')
  console.log('ok - live readiness fails closed without validated configured inference')
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

async function testGitGeneratedArtifactAllowlist() {
  const gitDir = path.join(scratch, 'readiness-git-state')
  const generatedPath = path.join(gitDir, 'data/qore/runs/free-data-manifest.json')
  const executionConfigPath = path.join(gitDir, 'data/qore/market/index-basket-config.json')
  const requiredPaths = [
    'config/qore-live-broker-settings.json',
    'config/qore-live-weather-settings.json',
    'scripts/qore-alpaca-broker.mjs',
    'scripts/qore-live-trading-supervisor.mjs',
  ]
  await writeJson(generatedPath, { generatedAt: 'baseline' })
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
  await writeJson(signalPath, {
    inference: { validated: true, liveForecastAppliedToTarget: true, forecastValidation: { latestCommonIssueDate: today() } },
    intent: { targetDate: today() },
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
  console.log('ok - live readiness only allows narrow generated artifacts through the dirty-tree gate')
}

async function testStaleTargetFailsDirectReadiness() {
  await writeHandoffs({ targetDate: '2000-01-01' })
  const result = await runNode(['scripts/qore-live-readiness.mjs', '--mode=live', '--local-only', '--json'], {
    QORE_LIVE_SIGNAL_INTENT_FILE: path.join(liveDir, 'signal-intent-reconcile.json'),
  })
  const readiness = JSON.parse(result.stdout)
  assert.equal(result.code, 1)
  const freshness = readiness.checks.find((check) => check.id === 'live-strategy-freshness')
  assert.equal(freshness?.status, 'block')
  assert.match(freshness?.detail ?? '', /target date 2000-01-01/)
  console.log('ok - direct live readiness recomputes and blocks a stale target')
}

async function testSignalFreshnessUsesValidatedInferenceIssue() {
  const freshnessDir = path.join(scratch, 'signal-freshness')
  const inferencePath = path.join(freshnessDir, 'all-year-target.json')
  await writeJson(inferencePath, {
    generatedAt: new Date().toISOString(),
    validated: true,
    liveForecastAppliedToTarget: true,
    inferenceMode: 'test-live-inference',
    forecastValidation: { latestCommonIssueDate: today(), issueAgeDays: 0 },
    target: {
      signalDate: '2020-01-01',
      targetDate: today(),
      gasPosition: 0,
      indexFraction: 1,
      cashFraction: 0,
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

try {
  testEiaReleaseTimestamp()
  await scenario({ name: 'paper reconcile uses Alpaca bid/ask and submits ETF deltas' })
  await scenario({
    name: 'paper reconcile can route the strategy short leg when Alpaca confirms borrowability',
    allowShorts: true,
    gasPosition: -1,
    indexFraction: 0,
    expectedOrderCount: 1,
    expectedFirstSide: 'sell',
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
  await scenario({ name: 'preflight validates the complete route without submitting', preflightOnly: true })
  await scenario({ name: 'readiness runs the complete no-order broker preflight', readinessOnly: true })
  await scenario({
    name: 'paper mode refuses a non-paper trading endpoint',
    allowTestEndpoint: false,
    expectedBlock: /Paper mode requires the exact Alpaca paper endpoint/,
  })
  await testMissingInferenceFailsClosed()
  await testStaleTargetFailsDirectReadiness()
  await testSignalFreshnessUsesValidatedInferenceIssue()
  await testGitGeneratedArtifactAllowlist()
  await scenario({
    name: 'authoritative Alpaca market clock blocks a closed venue',
    marketOpen: false,
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
    name: 'failed risk-reducing sell halts later buy submissions',
    positions: [{ symbol: 'UNG', qty: '100', side: 'long', current_price: '15', market_value: '1500' }],
    rejectFirstOrder: true,
    expectedSubmissionFailure: true,
  })
  await scenario({
    name: 'blocked Alpaca account fails preflight',
    accountOverrides: { trading_blocked: true },
    expectedBlock: /trading_blocked=true/,
  })
  await scenario({
    name: 'daily loss stop fails preflight',
    accountOverrides: { equity: '8500', last_equity: '10000', cash: '8500', buying_power: '8500' },
    expectedBlock: /Daily P&L .* breaches/,
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
    expectedBlock: /Signal intent is stale .*target date 2000-01-01/,
  })
  await testSupervisorLock()
  await testPrepareDisablesBrokerOverride()
  await testSupervisorWeatherCadence()
  await testStorageInferenceCoherencyFailsClosed()
  await testContinuousHydratedCadenceSleeps()
  await testInvalidInferenceRetriesWithoutReplacingLastSuccess()
} finally {
  await rm(scratch, { recursive: true, force: true })
}
