#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const repoDir = process.cwd()
const scratch = await mkdtemp(path.join(tmpdir(), 'qore-live-test-'))
const liveDir = path.join(scratch, 'live-weather')
const brokerDir = path.join(scratch, 'broker')

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoDir,
      env: { ...process.env, ...env },
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

async function writeHandoffs({ killSwitchEngaged = false, marketSpreads = {} } = {}) {
  const now = new Date().toISOString()
  await writeJson(path.join(liveDir, 'signal-intent-reconcile.json'), {
    generatedAt: now,
    stale: false,
    signalAgeDays: 0,
    intent: {
      strategyId: 'ngas-all-year-beta',
      signalDate: today(),
      targetDate: today(),
      instrument: 'UNG',
      direction: 'flat',
      confidence: 0.8,
      indexFraction: 1,
      gasPosition: 0,
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
}) {
  await rm(brokerDir, { recursive: true, force: true })
  await writeHandoffs({ killSwitchEngaged, marketSpreads })
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
    ? ['scripts/qore-live-readiness.mjs', '--mode=paper', '--json']
    : ['scripts/qore-alpaca-broker.mjs', '--mode=paper', preflightOnly ? '--preflight-only' : '--reconcile', '--json']
  const result = await runNode(commandArgs, {
    APCA_API_KEY_ID: 'test-key',
    APCA_API_SECRET_KEY: 'test-secret',
    QORE_ALPACA_BASE_URL: baseUrl,
    QORE_ALPACA_DATA_BASE_URL: baseUrl,
    QORE_ALPACA_MARKET_DATA_FEED: 'iex',
    QORE_LIVE_WEATHER_STATE_DIR: liveDir,
    QORE_BROKER_STATE_DIR: brokerDir,
    QORE_PAPER_ORDER_ROUTING_ENABLED: '1',
    QORE_LIVE_MAX_QUOTE_AGE_MINUTES: '5',
  })
  await new Promise((resolve) => server.close(resolve))
  const status = JSON.parse(await readFile(path.join(brokerDir, 'status.json'), 'utf8'))

  if (readinessOnly) {
    const readiness = JSON.parse(result.stdout)
    assert.equal(result.code, 0, `${name}: readiness should exit 0 (${result.stderr})`)
    assert.equal(readiness.ready, true, `${name}: readiness should be ready`)
    assert.equal(readiness.checks.find((check) => check.id === 'broker-preflight')?.status, 'pass')
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
  } else {
    assert.equal(result.code, 0, `${name}: approved reconcile should exit 0 (${result.stderr})`)
    assert.equal(status.approved, true, `${name}: reconcile should be approved`)
    assert.equal(status.executionStatus, 'submitted', `${name}: orders should be submitted`)
    assert.equal(submittedOrders.length, 2, `${name}: VOO and QQQM deltas should be submitted`)
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

try {
  await scenario({ name: 'paper reconcile uses Alpaca bid/ask and submits ETF deltas' })
  await scenario({ name: 'preflight validates the complete route without submitting', preflightOnly: true })
  await scenario({ name: 'readiness runs the complete no-order broker preflight', readinessOnly: true })
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
  await testSupervisorLock()
} finally {
  await rm(scratch, { recursive: true, force: true })
}
