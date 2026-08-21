#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { qoreExecutionHostAssessment } from './lib/qore-execution-host.mjs'

const repoDir = process.cwd()
const bridgeScript = path.join(repoDir, 'scripts', 'qore-command-bridge.mjs')
const brokerScript = path.join(repoDir, 'scripts', 'qore-alpaca-broker.mjs')
const dashboardScript = path.join(repoDir, 'scripts', 'qore-dashboard-service.mjs')
const scratch = await mkdtemp(path.join(tmpdir(), 'qore-command-bridge-'))

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

function runNode(args, env, cwd = scratch) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function freePort() {
  const server = createServer()
  await listen(server)
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await close(server)
  return port
}

async function waitForConnection(baseUrl, origin) {
  const deadline = Date.now() + 10_000
  let lastPayload = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/connection/status`, { headers: { Origin: origin } })
      lastPayload = await response.json()
      if (lastPayload.connected) return lastPayload
    } catch {
      // Startup and bounded reconnect attempts are expected to be briefly unavailable.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Command bridge did not connect: ${JSON.stringify(lastPayload)}`)
}

async function commandLog(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function waitForCommandCount(filePath, expectedCount) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const commands = await commandLog(filePath)
    if (commands.length >= expectedCount) return commands
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${expectedCount} SSH commands.`)
}

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('close', resolve))
}

function snapshotEnv(fixture) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    QORE_REPO_DIR: fixture,
    QORE_ALPACA_API_KEY_ID: '',
    QORE_ALPACA_API_SECRET_KEY: 'SUPERSECRET',
    APCA_API_KEY_ID: '',
    APCA_API_SECRET_KEY: '',
    ALPACA_API_KEY_ID: '',
    ALPACA_API_SECRET_KEY: '',
    ALPACA_API_KEY: '',
    ALPACA_SECRET_KEY: '',
    QORE_ALPACA_CLOCK_MAX_AGE_SECONDS: '30',
    QORE_ALPACA_CLOCK_MAX_FUTURE_SKEW_SECONDS: '5',
    QORE_DASHBOARD_BROKER_MAX_FUTURE_SKEW_SECONDS: '5',
    QORE_LIVE_MAX_RISK_SNAPSHOT_AGE_SECONDS: '900',
    QORE_LIVE_MAX_RISK_SNAPSHOT_FUTURE_SKEW_SECONDS: '30',
  }
}

async function commandSnapshot(fixture) {
  const result = await runNode([dashboardScript, '--snapshot-json'], snapshotEnv(fixture), repoDir)
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout.endsWith('\n'), true)
  assert.equal(result.stdout.slice(0, -1).includes('\n'), false, 'snapshot stdout must be exactly one JSON line')
  assert.ok(Buffer.byteLength(result.stdout) <= 512 * 1024)
  return { payload: JSON.parse(result.stdout), stdout: result.stdout }
}

try {
  assert.equal(qoreExecutionHostAssessment({ platform: 'darwin', host: 'James-Mac' }).allowed, false)
  assert.equal(qoreExecutionHostAssessment({ platform: 'linux', host: 'm1-server' }).allowed, true)
  assert.equal(qoreExecutionHostAssessment({ platform: 'linux', host: 'other-server' }).allowed, false)
  assert.equal(
    qoreExecutionHostAssessment({ platform: 'darwin', host: 'James-Mac', allowLoopbackTest: true }).allowed,
    true,
  )
  console.log('ok - order-capable host policy allows only m1-server outside loopback tests')

  const fixture = path.join(scratch, 'snapshot-fixture')
  const brokerDir = path.join(fixture, '.local', 'qore', 'broker')
  const weatherDir = path.join(fixture, '.local', 'qore', 'live-weather')
  const nowMs = Date.now()
  const historyAt = new Date(nowMs - 10_000).toISOString()
  const accountStatusAt = new Date(nowMs - 2_000).toISOString()
  const accountSnapshotAt = new Date(nowMs - 1_000).toISOString()
  const historyPoints = Array.from({ length: 1605 }, (_, index) => ({
    timestamp: new Date(nowMs - (1605 - index) * 60_000).toISOString(),
    equityUsd: 90_000 + index,
    profitLossUsd: index,
    profitLossPct: index / 100,
  }))
  const accountStatus = {
    generatedAt: accountStatusAt,
    sourceGeneratedAt: accountStatusAt,
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 100_000, cashUsd: 50_000, dayPnlPct: 1 },
    rawAccount: { accountNumber: 'ACCOUNT-SECRET', status: 'ACTIVE' },
    positions: [],
    openOrders: [],
    marketClock: { isOpen: true, timestamp: accountStatusAt },
    portfolioHistory: {
      sourceGeneratedAt: historyAt,
      baseValueUsd: 90_000,
      timeframe: '1D',
      points: historyPoints,
    },
    warnings: [`token=SUPERSECRET ${'w'.repeat(400)}`, 'account_id=STATUS-ACCOUNT-SECRET'],
  }
  const accountSnapshot = {
    generatedAt: accountSnapshotAt,
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 101_000, cashUsd: 51_000, dayPnlPct: 1, lastEquityUsd: 100_000 },
    rawAccount: { accountNumber: 'SNAPSHOT-ACCOUNT-SECRET', status: 'ACTIVE', shortingEnabled: true },
    positions: Array.from({ length: 70 }, (_, index) => ({
      symbol: index % 2 ? 'UNG' : 'VOO',
      qty: String(index + 1),
      account_id: 'POSITION-ACCOUNT-SECRET',
    })),
    openOrders: [],
    marketClock: { isOpen: true, timestamp: accountSnapshotAt },
  }
  await writeJson(path.join(brokerDir, 'account-status.json'), accountStatus)
  await writeJson(path.join(brokerDir, 'account-snapshot.json'), accountSnapshot)
  await writeJson(path.join(brokerDir, 'status.json'), {
    generatedAt: accountSnapshotAt,
    mode: 'paper',
    blockedReasons: ['Reconcile blocked for account_number=BROKER-ACCOUNT-SECRET.'],
    warnings: ['api_key=SUPERSECRET broker warning'],
  })
  await writeJson(path.join(weatherDir, 'risk-and-kill-switch-state.json'), {
    generatedAt: new Date().toISOString(),
    operator: { killSwitchEngaged: false },
    readiness: {
      killSwitchClear: true,
      venueOpen: true,
      accountContextPresent: true,
      marketContextPresent: true,
      weatherContextPresent: true,
      storageContextPresent: true,
      storageInferenceCoherent: true,
    },
    blockedReasons: ['Risk blocked for account_id=RISK-ACCOUNT-SECRET.'],
    warnings: ['password=SUPERSECRET risk warning'],
  })
  await writeJson(path.join(weatherDir, 'operator-state.json'), {
    updatedAt: new Date().toISOString(),
    killSwitchEngaged: true,
  })

  const connectedSnapshot = await commandSnapshot(fixture)
  assert.equal(connectedSnapshot.payload.mode, 'paper')
  assert.equal(connectedSnapshot.payload.brokerConnected, true)
  assert.equal(connectedSnapshot.payload.account.equityUsd, 101_000)
  assert.equal(connectedSnapshot.payload.account.lastEquityUsd, 100_000)
  assert.equal(connectedSnapshot.payload.account.dayPnlUsd, 1_000)
  assert.equal(connectedSnapshot.payload.sourceGeneratedAt, accountSnapshotAt)
  assert.equal(connectedSnapshot.payload.portfolioHistory.sourceGeneratedAt, historyAt)
  assert.equal(connectedSnapshot.payload.portfolioHistory.points.length, 1500)
  assert.equal(connectedSnapshot.payload.positions.length, 64)
  assert.equal(connectedSnapshot.payload.risk.killSwitchEngaged, true)
  assert.match(connectedSnapshot.payload.risk.blockedReasons.join(' '), /trading kill switch is engaged/i)
  assert.match(connectedSnapshot.payload.risk.blockedReasons.join(' '), /Risk blocked/)
  assert.match(connectedSnapshot.payload.risk.blockedReasons.join(' '), /Reconcile blocked/)
  const connectedDiagnostics = [
    ...connectedSnapshot.payload.risk.blockedReasons,
    ...connectedSnapshot.payload.risk.warnings,
  ]
  assert.ok(connectedDiagnostics.length <= 32)
  assert.ok(connectedDiagnostics.every((message) => message.length <= 240))
  assert.doesNotMatch(
    connectedSnapshot.stdout,
    /SUPERSECRET|ACCOUNT-SECRET|STATUS-ACCOUNT-SECRET|SNAPSHOT-ACCOUNT-SECRET|POSITION-ACCOUNT-SECRET/,
  )
  assert.match(connectedSnapshot.stdout, /\[redacted\]/)

  await writeJson(path.join(brokerDir, 'account-snapshot.json'), {
    ...accountSnapshot,
    generatedAt: new Date().toISOString(),
    marketClock: { isOpen: true, timestamp: new Date(Date.now() + 60_000).toISOString() },
  })
  const futureClock = await commandSnapshot(fixture)
  assert.equal(futureClock.payload.brokerConnected, false)
  assert.equal(futureClock.payload.marketClock, null)
  assert.match(futureClock.payload.risk.warnings.join(' '), /Market clock telemetry is future-dated/)

  await writeJson(path.join(brokerDir, 'account-snapshot.json'), {
    ...accountSnapshot,
    generatedAt: new Date().toISOString(),
    marketClock: { isOpen: true, timestamp: new Date(Date.now() - 31_000).toISOString() },
  })
  const staleClock = await commandSnapshot(fixture)
  assert.equal(staleClock.payload.brokerConnected, false)
  assert.equal(staleClock.payload.marketClock, null)
  assert.match(staleClock.payload.risk.warnings.join(' '), /Market clock telemetry is stale/)

  await writeJson(path.join(brokerDir, 'account-snapshot.json'), accountSnapshot)
  await writeJson(path.join(brokerDir, 'account-status.json'), {
    ...accountStatus,
    generatedAt: new Date().toISOString(),
    brokerConnected: false,
    blockedReasons: ['Latest paper account refresh failed safely.'],
  })
  const disconnected = await commandSnapshot(fixture)
  assert.equal(disconnected.payload.mode, 'paper')
  assert.equal(disconnected.payload.brokerConnected, false)
  assert.equal(disconnected.payload.sourceGeneratedAt, accountSnapshotAt)
  assert.equal(disconnected.payload.account.equityUsd, 101_000)
  assert.equal(disconnected.payload.positions.length, 64)
  assert.deepEqual(disconnected.payload.openOrders, [])
  assert.equal(disconnected.payload.marketClock, null)
  assert.equal(disconnected.payload.portfolioHistory.sourceGeneratedAt, null)
  assert.deepEqual(disconnected.payload.portfolioHistory.points, [])
  assert.match(disconnected.payload.risk.warnings.join(' '), /Displayed account data is cached/)
  assert.match(disconnected.payload.risk.warnings.join(' '), /Cached portfolio history .* was suppressed/)
  assert.match(disconnected.payload.risk.warnings.join(' '), /Latest paper account refresh failed safely/)

  await writeJson(path.join(weatherDir, 'operator-state.json'), {
    updatedAt: new Date().toISOString(),
    killSwitchEngaged: false,
  })
  await writeJson(path.join(weatherDir, 'risk-and-kill-switch-state.json'), {
    generatedAt: new Date(Date.now() + 60_000).toISOString(),
    operator: { killSwitchEngaged: false },
    readiness: { killSwitchClear: true },
  })
  const futureRisk = await commandSnapshot(fixture)
  assert.equal(futureRisk.payload.risk.killSwitchEngaged, null)
  assert.equal(futureRisk.payload.risk.readiness.killSwitchClear, null)
  assert.match(futureRisk.payload.risk.blockedReasons.join(' '), /Risk and kill-switch telemetry is future-dated/)
  console.log('ok - remote snapshot CLI is one bounded sanitized DTO with fail-closed source, clock, operator, and risk provenance')

  const fakeSsh = path.join(scratch, 'fake-ssh.mjs')
  const failureCountPath = path.join(scratch, 'ssh-failures.txt')
  const sshLogPath = path.join(scratch, 'ssh-commands.log')
  const sshDelayPath = path.join(scratch, 'ssh-delay.txt')
  const telemetryPath = path.join(scratch, 'remote-telemetry.json')
  await writeFile(telemetryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: new Date().toISOString(),
    mode: 'paper',
    brokerConnected: true,
    account: { equityUsd: 100_000 },
    positions: [],
    openOrders: [],
    marketClock: { isOpen: true, timestamp: new Date().toISOString() },
    portfolioHistory: { sourceGeneratedAt: new Date().toISOString(), timeframe: '1D', points: [] },
    strategy: { intent: null, inference: null },
    risk: {
      killSwitchEngaged: false,
      readiness: {},
      blockedReasons: [],
      warnings: ['account_id=REMOTE-ACCOUNT-SECRET', 'token=SUPERSECRET remote warning'],
    },
    supervisor: null,
  }), 'utf8')
  await writeFile(fakeSsh, `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const countPath = ${JSON.stringify(failureCountPath)}
const logPath = ${JSON.stringify(sshLogPath)}
const delayPath = ${JSON.stringify(sshDelayPath)}
const telemetryPath = ${JSON.stringify(telemetryPath)}
const command = process.argv.at(-1) ?? ''
appendFileSync(logPath, command + '\\n')
let failures = 0
try { failures = Number(readFileSync(countPath, 'utf8')) || 0 } catch {}
if (failures > 0) {
  writeFileSync(countPath, String(failures - 1))
  process.stderr.write('api_key=SUPERSECRET account_id=SSH-ACCOUNT-SECRET transport unavailable\\n')
  process.exit(1)
}
let delayMs = 0
try { delayMs = Number(readFileSync(delayPath, 'utf8')) || 0 } catch {}
if (delayMs > 0 && command.endsWith(' snapshot')) {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}
process.stdout.write(readFileSync(telemetryPath, 'utf8').trim())
`, 'utf8')
  await chmod(fakeSsh, 0o755)
  await writeFile(failureCountPath, '1', 'utf8')
  await writeFile(sshDelayPath, '0', 'utf8')

  const t3 = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<title>T3 Code</title>')
  })
  await listen(t3)
  const t3Address = t3.address()
  const t3Port = typeof t3Address === 'object' && t3Address ? t3Address.port : 0
  const bridgePort = await freePort()
  const origin = 'http://127.0.0.1:5173'
  const bridge = spawn(process.execPath, [bridgeScript], {
    cwd: repoDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      QORE_COMMAND_BRIDGE_PORT: String(bridgePort),
      QORE_COMMAND_T3_BASE_URL: `http://127.0.0.1:${t3Port}`,
      QORE_COMMAND_SSH_BIN: fakeSsh,
      QORE_COMMAND_REMOTE_REPO_DIR: repoDir,
      QORE_COMMAND_REMOTE_NODE: process.execPath,
      QORE_COMMAND_REMOTE_READ_MIN_INTERVAL_MS: '1',
      QORE_COMMAND_RECONNECT_BASE_MS: '25',
      QORE_COMMAND_RECONNECT_MAX_MS: '100',
      QORE_DASHBOARD_SERVICE_ALLOWED_ORIGINS: origin,
      QORE_ALPACA_API_SECRET_KEY: 'SUPERSECRET',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`
  try {
    const connection = await waitForConnection(bridgeBaseUrl, origin)
    assert.equal(connection.phase, 'connected')
    assert.equal(connection.progressPct, 100)
    assert.equal(connection.transport, 't3-tailscale-ssh')
    const startupCommands = (await readFile(sshLogPath, 'utf8')).trim().split('\n')
    assert.ok(startupCommands.length >= 2, 'startup SSH failure must recover through status-triggered backoff')
    assert.ok(startupCommands.every((command) => command.endsWith(' snapshot')))
    assert.ok(startupCommands.every((command) => command.includes('qore-readonly-telemetry')))
    assert.ok(startupCommands.every((command) => !command.includes(' -e ')))

    const liveResponse = await fetch(`${bridgeBaseUrl}/api/live/status`, { headers: { Origin: origin } })
    assert.equal(liveResponse.status, 200)
    assert.equal(liveResponse.headers.get('access-control-allow-origin'), origin)
    const livePayload = await liveResponse.json()
    assert.equal(livePayload.mode, 'paper')
    assert.doesNotMatch(JSON.stringify(livePayload), /SUPERSECRET|REMOTE-ACCOUNT-SECRET/)

    await writeFile(failureCountPath, '1', 'utf8')
    const refreshResponse = await fetch(`${bridgeBaseUrl}/api/live/refresh`, {
      method: 'POST',
      headers: { Origin: origin },
    })
    assert.equal(refreshResponse.status, 200)
    const refreshed = await refreshResponse.json()
    assert.match(refreshed.risk.warnings.join(' '), /Read-only broker refresh failed/)
    assert.doesNotMatch(JSON.stringify(refreshed), /SUPERSECRET|SSH-ACCOUNT-SECRET/)
    const refreshCommands = (await readFile(sshLogPath, 'utf8')).trim().split('\n')
    const refreshCommandIndex = refreshCommands.findIndex((command) => command.endsWith(' refresh'))
    assert.ok(refreshCommandIndex >= 0)
    assert.match(refreshCommands[refreshCommandIndex], /sudo -n .*qore-readonly-telemetry.* refresh$/)
    assert.match(refreshCommands[refreshCommandIndex + 1], /qore-readonly-telemetry.* snapshot$/)

    await new Promise((resolve) => setTimeout(resolve, 10))
    const raceStartCount = (await commandLog(sshLogPath)).length
    await writeFile(sshDelayPath, '150', 'utf8')
    const ordinaryRead = fetch(`${bridgeBaseUrl}/api/live/status`, { headers: { Origin: origin } })
    await waitForCommandCount(sshLogPath, raceStartCount + 1)
    const forcedRefresh = fetch(`${bridgeBaseUrl}/api/live/refresh`, {
      method: 'POST',
      headers: { Origin: origin },
    })
    const [ordinaryReadResponse, forcedRefreshResponse] = await Promise.all([ordinaryRead, forcedRefresh])
    await writeFile(sshDelayPath, '0', 'utf8')
    assert.equal(ordinaryReadResponse.status, 200)
    assert.equal(forcedRefreshResponse.status, 200)
    const raceCommands = (await commandLog(sshLogPath)).slice(raceStartCount)
    assert.equal(raceCommands.filter((command) => command.endsWith(' snapshot')).length, 2)
    assert.equal(raceCommands.filter((command) => command.endsWith(' refresh')).length, 1)
    assert.match(raceCommands[0], /qore-readonly-telemetry.* snapshot$/)
    assert.match(raceCommands[1], /qore-readonly-telemetry.* refresh$/)
    assert.match(raceCommands[2], /qore-readonly-telemetry.* snapshot$/)

    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(failureCountPath, '1', 'utf8')
    const outageResponse = await fetch(`${bridgeBaseUrl}/api/live/status`, { headers: { Origin: origin } })
    assert.equal(outageResponse.status, 502)
    const outage = await outageResponse.json()
    assert.equal(outage.connection.connected, false)
    assert.doesNotMatch(JSON.stringify(outage), /SUPERSECRET|SSH-ACCOUNT-SECRET/)
    const recovered = await waitForConnection(bridgeBaseUrl, origin)
    assert.equal(recovered.connected, true)

    const forbidden = await fetch(`${bridgeBaseUrl}/api/live/status`, {
      headers: { Origin: 'http://evil.example' },
    })
    assert.equal(forbidden.status, 403)
    console.log('ok - Command bridge queues forced refreshes behind ordinary reads and bounded status-triggered SSH backoff recovers outages')
  } finally {
    await stopChild(bridge)
    await close(t3)
  }

  const guardedEnv = {
    ...process.env,
    NODE_ENV: 'production',
    QORE_BROKER_MODE: 'paper',
    QORE_ALPACA_API_KEY_ID: '',
    QORE_ALPACA_API_SECRET_KEY: '',
    APCA_API_KEY_ID: '',
    APCA_API_SECRET_KEY: '',
    QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '0',
    QORE_BROKER_STATE_DIR: path.join(scratch, 'broker'),
    QORE_LIVE_WEATHER_STATE_DIR: path.join(scratch, 'weather'),
  }
  const guarded = await runNode([brokerScript, '--mode=paper', '--reconcile', '--json'], guardedEnv)
  assert.equal(guarded.code, 1)
  assert.match(guarded.stdout, /restricted to Linux host m1-server/)
  assert.doesNotMatch(guarded.stdout + guarded.stderr, /Missing Alpaca credentials/)
  console.log('ok - Mac paper reconcile is rejected before credentials or broker access are used')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
