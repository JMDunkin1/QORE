#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceScript = path.join(projectRoot, 'scripts', 'qore-dashboard-service.mjs')
const brokerScript = path.join(projectRoot, 'scripts', 'qore-alpaca-broker.mjs')
const allowedOrigin = 'http://127.0.0.1:5173'

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

async function write(target, contents) {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, contents, 'utf8')
}

async function writeJson(target, value) {
  await write(target, `${JSON.stringify(value, null, 2)}\n`)
}

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function request(baseUrl, requestPath, options = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: options.method ?? 'GET',
    headers: options.origin === null ? {} : { Origin: options.origin ?? allowedOrigin },
  })
  return {
    status: response.status,
    refresh: response.headers.get('x-qore-refresh'),
    allowOrigin: response.headers.get('access-control-allow-origin'),
    payload: await response.json(),
  }
}

async function startService(repoDir, env = {}) {
  const port = await freePort()
  const childEnv = {
    ...process.env,
    QORE_REPO_DIR: repoDir,
    QORE_DASHBOARD_SERVICE_PORT: String(port),
    QORE_DASHBOARD_SERVICE_ALLOWED_ORIGINS: allowedOrigin,
    QORE_DASHBOARD_STALE_AFTER_MS: '3600000',
    QORE_DASHBOARD_REFRESH_MIN_INTERVAL_MS: '60000',
    ...env,
  }
  for (const [name, value] of Object.entries(childEnv)) {
    if (value === null || value === undefined) delete childEnv[name]
  }
  const child = spawn(process.execPath, [serviceScript], {
    cwd: projectRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Telemetry service exited early:\n${output}`)
    try {
      const response = await request(baseUrl, '/api/live/status', { origin: null })
      if (response.status === 200) return { baseUrl, child, stop: () => stopChild(child) }
    } catch {
      // The service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await stopChild(child)
  throw new Error(`Timed out waiting for telemetry service:\n${output}`)
}

async function createTelemetryFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'qore-dashboard-service-'))
  const now = new Date().toISOString()
  const brokerDir = path.join(root, '.local', 'qore', 'broker')
  const weatherDir = path.join(root, '.local', 'qore', 'live-weather')
  const inferenceDir = path.join(root, '.local', 'qore', 'live-inference')
  const supervisorDir = path.join(root, '.local', 'qore', 'live-trading-supervisor')
  await writeJson(path.join(brokerDir, 'account-status.json'), {
    generatedAt: now,
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 101_500, cashUsd: 55_000, dayPnlPct: 0.75, trailingDrawdownPct: -1.5 },
    rawAccount: {
      accountNumber: 'SECRET-ACCOUNT',
      buyingPower: '202000',
      status: 'ACTIVE',
      shortingEnabled: true,
      apiSecret: 'DO-NOT-EXPOSE',
    },
    positions: [{
      symbol: 'UNG', side: 'long', qty: '100', market_value: '1500', current_price: '15',
      avg_entry_price: '14', unrealized_pl: '100', unrealized_plpc: '0.07142857', account_id: 'SECRET-ID',
    }],
    openOrders: [{
      id: 'safe-order-id', account_id: 'SECRET-ID', symbol: 'UNG', side: 'buy', type: 'limit', status: 'new',
      time_in_force: 'day', qty: '5', limit_price: '14.5', submitted_at: now,
    }],
    marketClock: { isOpen: true, timestamp: now, nextClose: now },
    portfolioHistory: {
      baseValueUsd: 100_000,
      baseValueAsOf: now,
      timeframe: '1D',
      points: [{ timestamp: now, equityUsd: 101_500, profitLossUsd: 1_500, profitLossPct: 1.5 }],
    },
  })
  await writeJson(path.join(brokerDir, 'status.json'), {
    generatedAt: now,
    serviceId: 'qore-alpaca-target-weight-reconciler',
    mode: 'paper',
    approved: false,
    blockedReasons: ['reconcile safety state'],
    warnings: ['reconcile warning'],
  })
  await writeJson(path.join(brokerDir, 'account-snapshot.json'), { generatedAt: now, brokerConnected: true })
  await writeJson(path.join(weatherDir, 'status.json'), {
    generatedAt: now,
    ok: true,
    runConfiguration: { profile: 'balanced', privateToken: 'WEATHER-SECRET' },
    cycle: { durationMs: 250, cadenceMet: true, dueJobs: ['currentWeather'] },
    currentWeather: { generatedAt: now, source: 'NOAA', models: ['gfs'], digest: 'safe-digest' },
  })
  await writeJson(path.join(weatherDir, 'signal-intent-reconcile.json'), {
    generatedAt: now,
    intent: {
      strategyId: 'ngas-all-year-beta', strategyName: 'NGAS All-Year Beta', generatedAt: now,
      signalDate: '2026-07-20', targetDate: '2026-07-21', instrument: 'UNG', direction: 'long',
      confidence: 0.8, gasPosition: 0.5, indexFraction: 0.48, cashFraction: 0.02,
    },
    inference: { mode: 'live', validated: true, liveForecastAppliedToTarget: true },
  })
  await writeJson(path.join(weatherDir, 'risk-and-kill-switch-state.json'), {
    generatedAt: now,
    operator: { killSwitchEngaged: false },
    readiness: {
      killSwitchClear: true, venueOpen: true, accountContextPresent: true, marketContextPresent: true,
      weatherContextPresent: true, storageContextPresent: true, storageInferenceCoherent: true,
    },
  })
  await writeJson(path.join(weatherDir, 'operator-state.json'), { updatedAt: now, killSwitchEngaged: true, reason: 'test' })
  await writeJson(path.join(inferenceDir, 'all-year-target.json'), {
    generatedAt: now, strategyId: 'ngas-all-year-beta', inferenceMode: 'live', validated: true,
    liveForecastAppliedToTarget: true, season: 'summer', target: { targetDate: '2026-07-21', gasPosition: 0.5 },
  })
  await writeJson(path.join(supervisorDir, 'status.json'), {
    generatedAt: now, mode: 'paper', ok: true,
    jobs: [{ id: 'brokerReconcile', label: 'Broker', enabled: true, intervalMs: 60_000, state: { ok: true } }],
  })
  return root
}

async function testSanitizedDtoAndRefreshGuard() {
  const fixture = await createTelemetryFixture()
  const refreshCountPath = path.join(fixture, 'refresh-count.txt')
  await write(
    path.join(fixture, 'scripts', 'qore-alpaca-broker.mjs'),
    `#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
if (process.argv.slice(2).join(' ') !== '--status') process.exit(9)
await new Promise((resolve) => setTimeout(resolve, 150))
let count = 0
try { count = Number(await readFile(process.env.QORE_TEST_REFRESH_COUNT_FILE, 'utf8')) || 0 } catch {}
await writeFile(process.env.QORE_TEST_REFRESH_COUNT_FILE, String(count + 1))
`,
  )
  const service = await startService(fixture, { QORE_TEST_REFRESH_COUNT_FILE: refreshCountPath })
  try {
    const response = await request(service.baseUrl, '/api/live/status')
    assert.equal(response.status, 200)
    assert.equal(response.allowOrigin, allowedOrigin)
    assert.equal(response.payload.mode, 'paper')
    assert.equal(response.payload.brokerConnected, true)
    assert.equal(response.payload.account.buyingPowerUsd, 202000)
    assert.equal(response.payload.positions[0].unrealizedPnlPct, 7.1429)
    assert.equal(response.payload.positions[0].averageEntryPriceUsd, 14)
    assert.equal(response.payload.portfolioHistory.points[0].profitLossPct, 1.5)
    assert.equal(response.payload.portfolioHistory.sourceGeneratedAt, response.payload.sourceGeneratedAt)
    assert.match(response.payload.risk.blockedReasons.join(' '), /reconcile safety state/)
    assert.match(response.payload.risk.warnings.join(' '), /reconcile warning/)
    assert.equal(response.payload.risk.killSwitchEngaged, true)
    assert.equal(response.payload.risk.readiness.killSwitchClear, false)
    assert.equal(response.payload.strategy.intent.strategyId, 'ngas-all-year-beta')
    assert.equal(response.payload.supervisor.weather.profile, 'balanced')
    const serialized = JSON.stringify(response.payload)
    assert.doesNotMatch(serialized, /SECRET-ACCOUNT|SECRET-ID|DO-NOT-EXPOSE|WEATHER-SECRET/)

    const accountStatusPath = path.join(fixture, '.local', 'qore', 'broker', 'account-status.json')
    const accountStatus = JSON.parse(await readFile(accountStatusPath, 'utf8'))
    await writeJson(accountStatusPath, {
      ...accountStatus,
      positions: [...accountStatus.positions, { symbol: 'VOO' }],
      openOrders: [...accountStatus.openOrders, { id: 'partial-order' }],
    })
    const signalPath = path.join(fixture, '.local', 'qore', 'live-weather', 'signal-intent-reconcile.json')
    const signal = JSON.parse(await readFile(signalPath, 'utf8'))
    await writeJson(signalPath, {
      ...signal,
      intent: { ...signal.intent, confidence: null, gasPosition: null, indexFraction: null, cashFraction: null },
    })
    const partial = await request(service.baseUrl, '/api/live/status')
    assert.deepEqual(partial.payload.positions[1], {
      symbol: 'VOO', side: null, quantity: null, marketValueUsd: null, currentPriceUsd: null,
      averageEntryPriceUsd: null, unrealizedPnlUsd: null, unrealizedPnlPct: null,
    })
    assert.equal(partial.payload.openOrders[1].id, 'partial-order')
    assert.equal(partial.payload.openOrders[1].symbol, null)
    assert.equal(partial.payload.openOrders[1].quantity, null)
    assert.equal(partial.payload.openOrders[1].status, null)
    assert.equal(partial.payload.strategy.intent.confidence, null)
    assert.equal(partial.payload.strategy.intent.gasPosition, null)
    assert.equal(partial.payload.strategy.intent.indexFraction, null)
    assert.equal(partial.payload.strategy.intent.cashFraction, null)

    await rm(path.join(fixture, '.local', 'qore', 'live-weather', 'operator-state.json'), { force: true })
    const withoutOperator = await request(service.baseUrl, '/api/live/status')
    assert.equal(withoutOperator.payload.risk.killSwitchEngaged, null)
    assert.equal(withoutOperator.payload.risk.readiness.killSwitchClear, null)
    assert.match(withoutOperator.payload.risk.blockedReasons.join(' '), /Operator kill-switch telemetry is unavailable/)

    const riskPath = path.join(fixture, '.local', 'qore', 'live-weather', 'risk-and-kill-switch-state.json')
    const riskState = JSON.parse(await readFile(riskPath, 'utf8'))
    await writeJson(path.join(fixture, '.local', 'qore', 'live-weather', 'operator-state.json'), {
      updatedAt: new Date().toISOString(),
      killSwitchEngaged: false,
    })
    await writeJson(riskPath, {
      generatedAt: new Date().toISOString(),
      readiness: { killSwitchClear: true, venueOpen: null },
    })
    const incompleteRisk = await request(service.baseUrl, '/api/live/status')
    const incompleteBlocks = incompleteRisk.payload.risk.blockedReasons.join(' ')
    assert.equal(incompleteRisk.payload.risk.readiness.ready, null)
    assert.match(incompleteBlocks, /whether the trading venue is open/)
    assert.match(incompleteBlocks, /whether broker account context is present/)
    assert.match(incompleteBlocks, /whether market price context is present/)
    assert.match(incompleteBlocks, /whether live weather context is present/)
    assert.match(incompleteBlocks, /whether EIA storage context is present/)
    assert.match(incompleteBlocks, /whether strategy inference includes the latest EIA storage context/)
    for (const [generatedAt, expectedReason] of [
      [new Date(Date.now() - 16 * 60 * 1000).toISOString(), /telemetry is stale/],
      ['not-a-time', /missing or invalid generatedAt/],
      [new Date(Date.now() + 60_000).toISOString(), /telemetry is future-dated/],
    ]) {
      await writeJson(riskPath, { ...riskState, generatedAt })
      const unsafeRisk = await request(service.baseUrl, '/api/live/status')
      assert.equal(unsafeRisk.payload.risk.killSwitchEngaged, null)
      assert.equal(unsafeRisk.payload.risk.readiness.killSwitchClear, null)
      assert.match(unsafeRisk.payload.risk.blockedReasons.join(' '), expectedReason)
      assert.doesNotMatch(unsafeRisk.payload.risk.blockedReasons.join(' '), /Risk readiness does not report/)
    }
    await write(riskPath, '{not-valid-json\n')
    const malformedRisk = await request(service.baseUrl, '/api/live/status')
    assert.equal(malformedRisk.payload.risk.killSwitchEngaged, null)
    assert.equal(malformedRisk.payload.risk.readiness.killSwitchClear, null)
    assert.match(malformedRisk.payload.risk.blockedReasons.join(' '), /telemetry is invalid JSON/)
    assert.doesNotMatch(malformedRisk.payload.risk.blockedReasons.join(' '), /Risk readiness does not report/)

    const weatherStatusPath = path.join(fixture, '.local', 'qore', 'live-weather', 'status.json')
    const weatherStatus = JSON.parse(await readFile(weatherStatusPath, 'utf8'))
    await writeJson(weatherStatusPath, {
      ...weatherStatus,
      riskAndKillSwitchState: {
        generatedAt: new Date().toISOString(),
        readiness: { killSwitchClear: true },
      },
    })
    await rm(riskPath, { force: true })
    const missingDirectRisk = await request(service.baseUrl, '/api/live/status')
    assert.equal(missingDirectRisk.payload.risk.killSwitchEngaged, null)
    assert.equal(missingDirectRisk.payload.risk.readiness.killSwitchClear, null)
    assert.match(missingDirectRisk.payload.risk.blockedReasons.join(' '), /Risk and kill-switch telemetry is unavailable/)
    assert.doesNotMatch(missingDirectRisk.payload.risk.blockedReasons.join(' '), /Risk readiness does not report/)

    for (const origin of [
      'http://example.invalid',
      'http://127.0.0.1:5174',
      'https://127.0.0.1:5173',
      'http://127.0.0.1:5173/path',
      'http://127.0.0.1.evil.invalid:5173',
    ]) {
      const denied = await request(service.baseUrl, '/api/live/status', { origin })
      assert.equal(denied.status, 403, `${origin} must not pass the exact local-origin allowlist`)
    }

    await writeJson(path.join(fixture, '.local', 'qore', 'broker', 'status.json'), {
      generatedAt: new Date().toISOString(),
      mode: 'paper',
      blockedReasons: ['reconcile safety state'],
      warnings: Array.from({ length: 50 }, (_, index) => (
        index % 2 === 0
          ? `account_id=LEAK-${index} ${'x'.repeat(400)}`
          : `account number: "LEAK-${index}" ${'y'.repeat(400)}`
      )),
    })
    const boundedMessages = await request(service.baseUrl, '/api/live/status')
    const diagnostics = [
      ...boundedMessages.payload.risk.blockedReasons,
      ...boundedMessages.payload.risk.warnings,
    ]
    assert.ok(diagnostics.length <= 32)
    assert.equal(diagnostics.every((message) => message.length <= 240), true)
    assert.doesNotMatch(JSON.stringify(diagnostics), /LEAK-/)
    assert.match(JSON.stringify(diagnostics), /\[redacted\]/)

    const [first, second] = await Promise.all([
      request(service.baseUrl, '/api/live/refresh', { method: 'POST' }),
      request(service.baseUrl, '/api/live/refresh', { method: 'POST' }),
    ])
    assert.deepEqual(new Set([first.refresh, second.refresh]), new Set(['refreshed', 'joined']))
    assert.equal(await readFile(refreshCountPath, 'utf8'), '1')
    const cached = await request(service.baseUrl, '/api/live/refresh', { method: 'POST' })
    assert.equal(cached.refresh, 'cached')
    assert.equal(await readFile(refreshCountPath, 'utf8'), '1')
  } finally {
    await service.stop()
    await rm(fixture, { recursive: true, force: true })
  }
  console.log('ok - dashboard service returns a sanitized DTO and coalesces read-only refreshes')
}

async function testMissingSourcesDegradeCleanly() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'qore-dashboard-empty-'))
  const service = await startService(fixture)
  try {
    const response = await request(service.baseUrl, '/api/live/status')
    assert.equal(response.status, 200)
    assert.equal(response.payload.brokerConnected, false)
    assert.equal(response.payload.sourceGeneratedAt, null)
    assert.equal(response.payload.account, null)
    assert.deepEqual(response.payload.positions, [])
    assert.deepEqual(response.payload.openOrders, [])
    assert.deepEqual(response.payload.portfolioHistory.points, [])
    assert.equal(response.payload.strategy.intent, null)
    assert.equal(response.payload.supervisor, null)
    assert.equal(response.payload.risk.killSwitchEngaged, null)
    assert.equal(response.payload.risk.readiness.killSwitchClear, null)
    assert.match(response.payload.risk.blockedReasons.join(' '), /Risk and kill-switch telemetry is unavailable/)
    assert.match(response.payload.risk.blockedReasons.join(' '), /Operator kill-switch telemetry is unavailable/)
    assert.match(response.payload.risk.warnings.join(' '), /Broker telemetry is unavailable/)
  } finally {
    await service.stop()
    await rm(fixture, { recursive: true, force: true })
  }
  console.log('ok - missing local telemetry returns an explicit empty status instead of failing')
}

async function testBrowserOriginsAreDeniedByDefault() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'qore-dashboard-no-origins-'))
  const service = await startService(fixture, { QORE_DASHBOARD_SERVICE_ALLOWED_ORIGINS: null })
  try {
    const originless = await request(service.baseUrl, '/api/live/status', { origin: null })
    assert.equal(originless.status, 200)
    const browserRequest = await request(service.baseUrl, '/api/live/status')
    assert.equal(browserRequest.status, 403)
    assert.equal(browserRequest.allowOrigin, null)
  } finally {
    await service.stop()
    await rm(fixture, { recursive: true, force: true })
  }
  console.log('ok - browser origins are denied by default while originless loopback clients remain supported')
}

async function testNewestConnectionEventControlsConnectivity() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'qore-dashboard-connection-event-'))
  const brokerDir = path.join(fixture, '.local', 'qore', 'broker')
  const cachedAt = new Date(Date.now() - 60_000).toISOString()
  const failureAt = new Date().toISOString()
  await writeJson(path.join(brokerDir, 'account-snapshot.json'), {
    generatedAt: cachedAt,
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 91_000, cashUsd: 42_000, dayPnlPct: null, trailingDrawdownPct: -2 },
    rawAccount: { buyingPower: '100000', status: 'ACTIVE', shortingEnabled: null },
    positions: [],
    openOrders: [],
    marketClock: { isOpen: true, timestamp: cachedAt },
  })
  await writeJson(path.join(brokerDir, 'account-status.json'), {
    generatedAt: failureAt,
    mode: 'paper',
    brokerConnected: false,
    executionStatus: 'blocked',
    blockedReasons: ['Alpaca account refresh failed safely.'],
  })
  const service = await startService(fixture)
  try {
    const response = await request(service.baseUrl, '/api/live/status')
    assert.equal(response.status, 200)
    assert.equal(response.payload.brokerConnected, false)
    assert.equal(response.payload.account.equityUsd, 91_000)
    assert.equal(response.payload.account.dayPnlPct, null)
    assert.equal(response.payload.account.shortingEnabled, null)
    assert.equal(response.payload.sourceGeneratedAt, cachedAt)
    assert.equal(response.payload.marketClock, null)
    assert.match(response.payload.risk.warnings.join(' '), /Alpaca account refresh failed safely/)
    assert.match(response.payload.risk.warnings.join(' '), /Displayed account data is cached/)

    await rm(path.join(brokerDir, 'account-snapshot.json'))
    const failureOnly = await request(service.baseUrl, '/api/live/status')
    assert.equal(failureOnly.payload.sourceGeneratedAt, null)
    assert.equal(failureOnly.payload.account, null)
  } finally {
    await service.stop()
    await rm(fixture, { recursive: true, force: true })
  }
  console.log('ok - newest broker event controls connectivity while older account data remains visibly cached')
}

async function testPortfolioHistoryHasIndependentProvenance() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'qore-dashboard-history-source-'))
  const brokerDir = path.join(fixture, '.local', 'qore', 'broker')
  const historyAt = new Date(Date.now() - 5 * 60_000).toISOString()
  const accountAt = new Date().toISOString()
  await writeJson(path.join(brokerDir, 'account-status.json'), {
    generatedAt: historyAt,
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 90_000 },
    portfolioHistory: {
      baseValueUsd: 80_000,
      points: [{ timestamp: historyAt, equityUsd: 90_000 }],
    },
  })
  await writeJson(path.join(brokerDir, 'account-snapshot.json'), {
    generatedAt: accountAt,
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 92_000 },
    positions: [],
    openOrders: [],
  })
  const service = await startService(fixture)
  try {
    const response = await request(service.baseUrl, '/api/live/status')
    assert.equal(response.payload.sourceGeneratedAt, accountAt)
    assert.equal(response.payload.account.equityUsd, 92_000)
    assert.equal(response.payload.portfolioHistory.sourceGeneratedAt, historyAt)
    assert.equal(response.payload.portfolioHistory.points[0].equityUsd, 90_000)
    assert.match(response.payload.risk.warnings.join(' '), /portfolio history is from .*different read/i)
  } finally {
    await service.stop()
    await rm(fixture, { recursive: true, force: true })
  }
  console.log('ok - portfolio history keeps independent provenance from the selected account payload')
}

async function testCrossModeBrokerDataIsSuppressed() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'qore-dashboard-cross-mode-'))
  const brokerDir = path.join(fixture, '.local', 'qore', 'broker')
  const paperAt = new Date(Date.now() - 60_000).toISOString()
  const liveFailureAt = new Date().toISOString()
  await writeJson(path.join(brokerDir, 'account-snapshot.json'), {
    generatedAt: paperAt,
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 88_000, cashUsd: 44_000 },
    rawAccount: { accountNumber: 'PAPER-ACCOUNT-SECRET' },
    positions: [{ symbol: 'UNG', qty: '25', account_id: 'PAPER-ID-SECRET' }],
    openOrders: [{ id: 'paper-order', symbol: 'VOO', account_id: 'PAPER-ID-SECRET' }],
    marketClock: { isOpen: true, timestamp: paperAt },
    portfolioHistory: {
      baseValueUsd: 80_000,
      points: [{ timestamp: paperAt, equityUsd: 88_000 }],
    },
  })
  await writeJson(path.join(brokerDir, 'account-status.json'), {
    generatedAt: liveFailureAt,
    sourceGeneratedAt: paperAt,
    mode: 'live',
    brokerConnected: false,
    executionStatus: 'blocked',
    account: { equityUsd: 88_000, cashUsd: 44_000 },
    rawAccount: { account_number: 'PAPER-ACCOUNT-SECRET' },
    positions: [{ symbol: 'UNG', qty: '25', account_id: 'PAPER-ID-SECRET' }],
    openOrders: [{ id: 'paper-order', symbol: 'VOO', account_id: 'PAPER-ID-SECRET' }],
    marketClock: { isOpen: true, timestamp: paperAt },
    portfolioHistory: {
      sourceGeneratedAt: paperAt,
      baseValueUsd: 80_000,
      points: [{ timestamp: paperAt, equityUsd: 88_000 }],
    },
    blockedReasons: ['Live refresh failed for account_id=LIVE-ID-SECRET.'],
    warnings: ['Active live refresh warning.'],
  })
  await writeJson(path.join(brokerDir, 'status.json'), {
    generatedAt: paperAt,
    mode: 'paper',
    blockedReasons: Array.from({ length: 40 }, (_, index) => `OLD-PAPER-BLOCK-${index} account_id=PAPER-DIAGNOSTIC-SECRET`),
    warnings: Array.from({ length: 40 }, (_, index) => `OLD-PAPER-WARNING-${index} account_number=PAPER-DIAGNOSTIC-SECRET`),
  })
  const service = await startService(fixture)
  try {
    const response = await request(service.baseUrl, '/api/live/status')
    assert.equal(response.payload.mode, 'live')
    assert.equal(response.payload.brokerConnected, false)
    assert.equal(response.payload.sourceGeneratedAt, null)
    assert.equal(response.payload.account, null)
    assert.deepEqual(response.payload.positions, [])
    assert.deepEqual(response.payload.openOrders, [])
    assert.equal(response.payload.marketClock, null)
    assert.equal(response.payload.portfolioHistory.sourceGeneratedAt, null)
    assert.equal(response.payload.portfolioHistory.baseValueUsd, null)
    assert.deepEqual(response.payload.portfolioHistory.points, [])
    assert.match(response.payload.risk.warnings.join(' '), /Cached account data from paper mode was suppressed.*live mode/)
    assert.match(response.payload.risk.warnings.join(' '), /Cached portfolio history from paper mode was suppressed.*live mode/)
    assert.match(response.payload.risk.warnings.join(' '), /Live refresh failed/)
    assert.match(response.payload.risk.warnings.join(' '), /Active live refresh warning/)
    assert.doesNotMatch(response.payload.risk.blockedReasons.join(' '), /OLD-PAPER-BLOCK/)
    assert.doesNotMatch(response.payload.risk.warnings.join(' '), /OLD-PAPER-WARNING/)
    const serialized = JSON.stringify(response.payload)
    assert.doesNotMatch(serialized, /PAPER-ACCOUNT-SECRET|PAPER-ID-SECRET|LIVE-ID-SECRET|PAPER-DIAGNOSTIC-SECRET/)
    assert.match(serialized, /\[redacted\]/)
  } finally {
    await service.stop()
    await rm(fixture, { recursive: true, force: true })
  }
  console.log('ok - cached paper account data is suppressed after a newer failed live refresh')
}

async function testMalformedConnectionModeFailsClosed() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'qore-dashboard-invalid-mode-'))
  const brokerDir = path.join(fixture, '.local', 'qore', 'broker')
  const now = new Date().toISOString()
  await writeJson(path.join(brokerDir, 'account-snapshot.json'), {
    generatedAt: now,
    mode: 'paper/live',
    brokerConnected: true,
    account: { equityUsd: 77_000, cashUsd: 33_000 },
    rawAccount: { account_id: 'INVALID-MODE-ACCOUNT-SECRET' },
    positions: [{ symbol: 'UNG', account_id: 'INVALID-MODE-ACCOUNT-SECRET' }],
    openOrders: [{ id: 'invalid-mode-order', symbol: 'VOO', account_id: 'INVALID-MODE-ACCOUNT-SECRET' }],
    marketClock: { isOpen: true, timestamp: now },
    portfolioHistory: {
      baseValueUsd: 70_000,
      points: [{ timestamp: now, equityUsd: 77_000 }],
    },
  })
  await writeJson(path.join(brokerDir, 'status.json'), {
    generatedAt: now,
    mode: 'paper',
    warnings: ['A paper fallback mode must not be borrowed.'],
  })
  const service = await startService(fixture)
  try {
    const response = await request(service.baseUrl, '/api/live/status')
    assert.equal(response.payload.mode, 'unknown')
    assert.equal(response.payload.brokerConnected, false)
    assert.equal(response.payload.sourceGeneratedAt, null)
    assert.equal(response.payload.account, null)
    assert.deepEqual(response.payload.positions, [])
    assert.deepEqual(response.payload.openOrders, [])
    assert.equal(response.payload.marketClock, null)
    assert.equal(response.payload.portfolioHistory.sourceGeneratedAt, null)
    assert.deepEqual(response.payload.portfolioHistory.points, [])
    assert.match(response.payload.risk.warnings.join(' '), /missing or invalid mode/)
    assert.doesNotMatch(response.payload.risk.warnings.join(' '), /fallback mode/)
    assert.doesNotMatch(JSON.stringify(response.payload), /INVALID-MODE-ACCOUNT-SECRET/)
  } finally {
    await service.stop()
    await rm(fixture, { recursive: true, force: true })
  }
  console.log('ok - malformed connection modes fail closed without borrowing fallback mode or account data')
}

async function testMarketClockFreshnessFailsClosed() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'qore-dashboard-clock-freshness-'))
  const brokerDir = path.join(fixture, '.local', 'qore', 'broker')
  const snapshotPath = path.join(brokerDir, 'account-snapshot.json')
  const staleAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
  await writeJson(snapshotPath, {
    generatedAt: staleAt,
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 66_000 },
    positions: [],
    openOrders: [],
    marketClock: { isOpen: true, timestamp: staleAt },
  })
  const service = await startService(fixture, {
    QORE_ALPACA_CLOCK_MAX_AGE_SECONDS: '30',
    QORE_ALPACA_CLOCK_MAX_FUTURE_SKEW_SECONDS: '5',
    QORE_DASHBOARD_BROKER_MAX_FUTURE_SKEW_SECONDS: '5',
  })
  try {
    const staleConnection = await request(service.baseUrl, '/api/live/status')
    assert.equal(staleConnection.payload.mode, 'paper')
    assert.equal(staleConnection.payload.brokerConnected, false)
    assert.equal(staleConnection.payload.marketClock, null)
    assert.match(staleConnection.payload.risk.warnings.join(' '), /connection telemetry is stale or future-dated/)

    for (const [clock, expectedWarning] of [
      [{ isOpen: true }, /missing or invalid timestamp/],
      [{ timestamp: new Date().toISOString() }, /missing an exact boolean isOpen\/is_open/],
      [{ isOpen: 'true', timestamp: new Date().toISOString() }, /must be an exact boolean/],
      [{ isOpen: true, is_open: false, timestamp: new Date().toISOString() }, /conflicting isOpen and is_open/],
      [{ isOpen: true, timestamp: new Date(Date.now() - 31_000).toISOString() }, /Market clock telemetry is stale .*cap 30s/],
      [{ isOpen: true, timestamp: new Date(Date.now() + 6_000).toISOString() }, /Market clock telemetry is future-dated .*tolerance 5s/],
    ]) {
      await writeJson(snapshotPath, {
        generatedAt: new Date().toISOString(),
        mode: 'paper',
        brokerConnected: true,
        account: { equityUsd: 66_000 },
        positions: [],
        openOrders: [],
        marketClock: clock,
      })
      const invalidClock = await request(service.baseUrl, '/api/live/status')
      assert.equal(invalidClock.payload.brokerConnected, true)
      assert.equal(invalidClock.payload.marketClock, null)
      assert.match(invalidClock.payload.risk.warnings.join(' '), expectedWarning)
    }

    await writeJson(snapshotPath, {
      generatedAt: new Date().toISOString(),
      mode: 'paper',
      brokerConnected: true,
      account: { equityUsd: 66_000 },
      positions: [],
      openOrders: [],
      marketClock: { is_open: false, timestamp: new Date().toISOString() },
    })
    const validClosedClock = await request(service.baseUrl, '/api/live/status')
    assert.equal(validClosedClock.payload.brokerConnected, true)
    assert.equal(validClosedClock.payload.marketClock.isOpen, false)

    await writeJson(snapshotPath, {
      generatedAt: new Date(Date.now() + 60_000).toISOString(),
      mode: 'paper',
      brokerConnected: true,
      account: { equityUsd: 66_000 },
      positions: [],
      openOrders: [],
      marketClock: { isOpen: true, timestamp: new Date().toISOString() },
    })
    const futureConnection = await request(service.baseUrl, '/api/live/status')
    assert.equal(futureConnection.payload.mode, 'paper')
    assert.equal(futureConnection.payload.brokerConnected, false)
    assert.equal(futureConnection.payload.marketClock, null)
    assert.match(futureConnection.payload.risk.warnings.join(' '), /connection telemetry is stale or future-dated/)
  } finally {
    await service.stop()
    await rm(fixture, { recursive: true, force: true })
  }
  console.log('ok - stale connections and invalid market-clock timestamps cannot report MARKET OPEN')
}

async function startAlpacaFixture() {
  let historyFails = false
  const requests = []
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    requests.push({ method: request.method, pathname: url.pathname, search: url.search })
    response.setHeader('Content-Type', 'application/json')
    if (url.pathname === '/v2/account') {
      response.end(JSON.stringify({
        id: 'account-id', account_number: 'PA1234', equity: '101500', last_equity: '100000', cash: '55000',
        buying_power: '203000', status: 'ACTIVE', shorting_enabled: true, trading_blocked: false,
      }))
    } else if (url.pathname === '/v2/positions') {
      response.end('[]')
    } else if (url.pathname === '/v2/orders') {
      response.end('[]')
    } else if (url.pathname === '/v2/clock') {
      response.end(JSON.stringify({ is_open: false, timestamp: new Date().toISOString() }))
    } else if (url.pathname === '/v2/stocks/quotes/latest') {
      response.end(JSON.stringify({ quotes: {
        UNG: { bp: 14.99, ap: 15.01, t: new Date().toISOString() },
        VOO: { bp: 599.99, ap: 600.01, t: new Date().toISOString() },
        QQQM: { bp: 249.99, ap: 250.01, t: new Date().toISOString() },
      } }))
    } else if (url.pathname === '/v2/account/portfolio/history') {
      if (historyFails) {
        response.statusCode = 503
        response.end(JSON.stringify({ message: 'history temporarily unavailable' }))
      } else {
        response.end(JSON.stringify({
          timestamp: [1_720_000_000, 1_720_086_400], equity: ['100000', '101500'],
          profit_loss: ['0', '1500'], profit_loss_pct: ['0', '0.015'],
          base_value: '100000', base_value_asof: 1_720_000_000, timeframe: '1D',
        }))
      }
    } else {
      response.statusCode = 404
      response.end(JSON.stringify({ message: 'not found' }))
    }
  })
  await new Promise((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    failHistory: () => { historyFails = true },
    stop: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function runBrokerStatus(stateDir, alpacaBaseUrl) {
  const { stdout } = await execFileAsync(process.execPath, [brokerScript, '--mode=paper', '--status', '--json'], {
    cwd: projectRoot,
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
      QORE_ALPACA_BASE_URL: alpacaBaseUrl,
      QORE_ALPACA_DATA_BASE_URL: alpacaBaseUrl,
      QORE_ALPACA_API_KEY_ID: 'test-key-not-a-secret',
      QORE_ALPACA_API_SECRET_KEY: 'test-secret-not-a-secret',
      QORE_BROKER_STATE_DIR: stateDir,
      QORE_LIVE_WEATHER_STATE_DIR: path.join(stateDir, 'weather'),
    },
  })
  return JSON.parse(stdout)
}

async function runBrokerProcess(stateDir, alpacaBaseUrl) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [brokerScript, '--mode=paper', '--status', '--json'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
        QORE_ALPACA_BASE_URL: alpacaBaseUrl,
        QORE_ALPACA_DATA_BASE_URL: alpacaBaseUrl,
        QORE_ALPACA_API_KEY_ID: 'test-key-not-a-secret',
        QORE_ALPACA_API_SECRET_KEY: 'test-secret-not-a-secret',
        QORE_BROKER_STATE_DIR: stateDir,
        QORE_LIVE_WEATHER_STATE_DIR: path.join(stateDir, 'weather'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function testBrokerPortfolioHistoryIsBestEffort() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-broker-history-'))
  const alpaca = await startAlpacaFixture()
  try {
    const riskLedgerPath = path.join(scratch, 'risk-ledger.json')
    const reconcileStatusPath = path.join(scratch, 'status.json')
    const orderLogPath = path.join(scratch, 'orders.jsonl')
    await writeJson(riskLedgerPath, {
      generatedAt: '2026-01-01T00:00:00.000Z',
      serviceId: 'qore-alpaca-risk-ledger',
      broker: 'alpaca',
      mode: 'paper',
      accountKey: 'existing-account',
      equityUsd: 120_000,
      equityHighWatermarkUsd: 120_000,
      trailingDrawdownPct: 0,
    })
    await writeJson(reconcileStatusPath, {
      generatedAt: '2026-01-01T00:00:00.000Z',
      serviceId: 'qore-alpaca-target-weight-reconciler',
      approved: false,
      blockedReasons: ['preserve this reconcile state'],
    })
    await write(orderLogPath, '{"status":"preserve-this-order-log"}\n')
    const riskLedgerBefore = await readFile(riskLedgerPath, 'utf8')
    const reconcileStatusBefore = await readFile(reconcileStatusPath, 'utf8')
    const orderLogBefore = await readFile(orderLogPath, 'utf8')
    const status = await runBrokerStatus(scratch, alpaca.baseUrl)
    const historyRequest = alpaca.requests.find((request) => request.pathname === '/v2/account/portfolio/history')
    assert.equal(historyRequest?.method, 'GET')
    assert.match(historyRequest?.search ?? '', /period=all/)
    assert.match(historyRequest?.search ?? '', /timeframe=1D/)
    assert.equal(status.portfolioHistory.baseValueUsd, 100000)
    assert.equal(status.portfolioHistory.points[1].equityUsd, 101500)
    assert.equal(status.portfolioHistory.points[1].profitLossPct, 1.5)
    assert.equal(status.portfolioHistory.points[0].timestamp, '2024-07-03T09:46:40.000Z')
    assert.equal(status.portfolioHistory.points[1].timestamp, '2024-07-04T09:46:40.000Z')
    assert.equal(status.account.equityUsd, 101500)
    assert.equal(alpaca.requests.every((request) => request.method === 'GET'), true)
    assert.equal(await readFile(riskLedgerPath, 'utf8'), riskLedgerBefore)
    assert.equal(await readFile(reconcileStatusPath, 'utf8'), reconcileStatusBefore)
    assert.equal(await readFile(orderLogPath, 'utf8'), orderLogBefore)
    const accountStatus = JSON.parse(await readFile(path.join(scratch, 'account-status.json'), 'utf8'))
    assert.equal(accountStatus.serviceId, 'qore-alpaca-broker-status')
    assert.equal(accountStatus.portfolioHistory.points[1].equityUsd, 101500)

    alpaca.failHistory()
    const degraded = await runBrokerStatus(scratch, alpaca.baseUrl)
    assert.equal(degraded.brokerConnected, true)
    assert.equal(degraded.account.equityUsd, 101500)
    assert.equal(degraded.portfolioHistory, null)
    assert.match(degraded.warnings[0], /Portfolio history is unavailable/)
    assert.equal(await readFile(reconcileStatusPath, 'utf8'), reconcileStatusBefore)
    assert.equal(await readFile(orderLogPath, 'utf8'), orderLogBefore)
    assert.equal(await readFile(riskLedgerPath, 'utf8'), riskLedgerBefore)
  } finally {
    await alpaca.stop()
    await rm(scratch, { recursive: true, force: true })
  }
  console.log('ok - broker status normalizes daily Alpaca history without coupling it to account availability')
}

async function testOfflineStatusMarksCachedSnapshotDisconnected() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-broker-offline-'))
  const cachedAt = '2026-01-15T12:00:00.000Z'
  try {
    await writeJson(path.join(scratch, 'account-snapshot.json'), {
      generatedAt: cachedAt,
      serviceId: 'qore-alpaca-account-snapshot',
      brokerConnected: true,
      liveRoutingEnabled: false,
      mode: 'paper',
      account: { equityUsd: 91_000, cashUsd: 42_000, dayPnlPct: 0, trailingDrawdownPct: -9 },
      positions: [],
      openOrders: [],
    })
    const { stdout } = await execFileAsync(process.execPath, [brokerScript, '--mode=dry-run', '--status', '--json'], {
      cwd: projectRoot,
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        QORE_ALPACA_API_KEY_ID: '',
        QORE_ALPACA_API_SECRET_KEY: '',
        APCA_API_KEY_ID: '',
        APCA_API_SECRET_KEY: '',
        ALPACA_API_KEY_ID: '',
        ALPACA_API_SECRET_KEY: '',
        ALPACA_API_KEY: '',
        ALPACA_SECRET_KEY: '',
        QORE_BROKER_STATE_DIR: scratch,
        QORE_LIVE_WEATHER_STATE_DIR: path.join(scratch, 'weather'),
      },
    })
    const status = JSON.parse(stdout)
    assert.equal(status.brokerConnected, false)
    assert.equal(status.sourceGeneratedAt, cachedAt)
    assert.notEqual(status.generatedAt, cachedAt)
    assert.equal(status.account.equityUsd, 91_000)
    assert.match(status.warnings.join(' '), /cached/i)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  console.log('ok - offline broker status preserves cached provenance and reports disconnected')
}

async function testBrokerStatusErrorRoutingAndOperationLock() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'qore-broker-lock-'))
  const unreachablePort = await freePort()
  const reconcileStatusPath = path.join(scratch, 'status.json')
  const orderLogPath = path.join(scratch, 'orders.jsonl')
  const riskLedgerPath = path.join(scratch, 'risk-ledger.json')
  const lockPath = path.join(scratch, 'operation.lock')
  try {
    await write(reconcileStatusPath, 'reconcile-status-sentinel\n')
    await write(orderLogPath, 'order-log-sentinel\n')
    await write(riskLedgerPath, 'risk-ledger-sentinel\n')
    await write(path.join(scratch, 'account-status.json'), 'account-status-sentinel\n')
    await writeJson(lockPath, { pid: 2_147_483_647, token: 'dead-owner', acquiredAt: '2000-01-01T00:00:00.000Z' })

    const deadLocked = await runBrokerProcess(scratch, `http://127.0.0.1:${unreachablePort}`)
    assert.equal(deadLocked.code, 1)
    assert.match(JSON.parse(deadLocked.stdout).blockedReasons.join(' '), /never reclaims an existing lock automatically/)
    assert.equal(await readFile(path.join(scratch, 'account-status.json'), 'utf8'), 'account-status-sentinel\n')
    assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).token, 'dead-owner')
    assert.equal(await readFile(reconcileStatusPath, 'utf8'), 'reconcile-status-sentinel\n')
    assert.equal(await readFile(orderLogPath, 'utf8'), 'order-log-sentinel\n')
    assert.equal(await readFile(riskLedgerPath, 'utf8'), 'risk-ledger-sentinel\n')

    await rm(lockPath)
    const failed = await runBrokerProcess(scratch, `http://127.0.0.1:${unreachablePort}`)
    assert.equal(failed.code, 1)
    const failure = JSON.parse(failed.stdout)
    assert.equal(failure.serviceId, 'qore-alpaca-broker-status')
    assert.equal(failure.executionStatus, 'blocked')
    const persistedFailure = JSON.parse(await readFile(path.join(scratch, 'account-status.json'), 'utf8'))
    assert.equal(persistedFailure.serviceId, 'qore-alpaca-broker-status')
    assert.equal(await readFile(reconcileStatusPath, 'utf8'), 'reconcile-status-sentinel\n')
    assert.equal(await readFile(orderLogPath, 'utf8'), 'order-log-sentinel\n')
    assert.equal(await readFile(riskLedgerPath, 'utf8'), 'risk-ledger-sentinel\n')
    assert.equal(await readFile(lockPath, 'utf8').then(() => true, () => false), false)

    const accountStatusBefore = await readFile(path.join(scratch, 'account-status.json'), 'utf8')
    await writeJson(lockPath, { pid: process.pid, token: 'active-owner', acquiredAt: new Date().toISOString() })
    const locked = await runBrokerProcess(scratch, `http://127.0.0.1:${unreachablePort}`)
    assert.equal(locked.code, 1)
    assert.match(JSON.parse(locked.stdout).blockedReasons.join(' '), /operation lock is held/)
    assert.equal(await readFile(path.join(scratch, 'account-status.json'), 'utf8'), accountStatusBefore)
    assert.equal(await readFile(reconcileStatusPath, 'utf8'), 'reconcile-status-sentinel\n')
    assert.equal(await readFile(orderLogPath, 'utf8'), 'order-log-sentinel\n')
    assert.equal(await readFile(riskLedgerPath, 'utf8'), 'risk-ledger-sentinel\n')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  console.log('ok - broker status errors stay isolated and every pre-existing operation lock fails closed')
}

await testSanitizedDtoAndRefreshGuard()
await testMissingSourcesDegradeCleanly()
await testBrowserOriginsAreDeniedByDefault()
await testNewestConnectionEventControlsConnectivity()
await testPortfolioHistoryHasIndependentProvenance()
await testCrossModeBrokerDataIsSuppressed()
await testMalformedConnectionModeFailsClosed()
await testMarketClockFreshnessFailsClosed()
await testBrokerPortfolioHistoryIsBestEffort()
await testOfflineStatusMarksCachedSnapshotDisconnected()
await testBrokerStatusErrorRoutingAndOperationLock()
