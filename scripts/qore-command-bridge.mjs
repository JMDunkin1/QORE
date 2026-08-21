#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const host = '127.0.0.1'
const port = validPort(process.env.QORE_COMMAND_BRIDGE_PORT ?? process.env.QORE_DASHBOARD_SERVICE_PORT) ?? 4775
const remoteHost = process.env.QORE_COMMAND_REMOTE_HOST ?? '100.81.167.107'
const remoteName = process.env.QORE_COMMAND_REMOTE_NAME ?? 'm1-server'
const remoteUser = process.env.QORE_COMMAND_REMOTE_USER ?? 'jdunkin'
const remoteTelemetryHelper = process.env.QORE_COMMAND_REMOTE_TELEMETRY_HELPER
  ?? '/usr/local/sbin/qore-readonly-telemetry'
const t3BaseUrl = new URL(process.env.QORE_COMMAND_T3_BASE_URL ?? `http://${remoteHost}:3000`)
const sshBinary = process.env.QORE_COMMAND_SSH_BIN ?? '/usr/bin/ssh'
const identityFile = path.resolve(
  process.env.QORE_COMMAND_SSH_IDENTITY_FILE ?? path.join(homedir(), '.ssh', 'id_ed25519'),
)
const readMinIntervalMs = positiveNumber(process.env.QORE_COMMAND_REMOTE_READ_MIN_INTERVAL_MS, 5_000)
const reconnectBaseMs = positiveNumber(process.env.QORE_COMMAND_RECONNECT_BASE_MS, 1_000)
const reconnectMaxMs = Math.max(
  reconnectBaseMs,
  positiveNumber(process.env.QORE_COMMAND_RECONNECT_MAX_MS, 30_000),
)
const remoteSnapshotTimeoutMs = positiveNumber(process.env.QORE_COMMAND_REMOTE_SNAPSHOT_TIMEOUT_MS, 20_000)
const remoteRefreshTimeoutMs = positiveNumber(process.env.QORE_COMMAND_REMOTE_REFRESH_TIMEOUT_MS, 45_000)
const maxSnapshotBytes = 512 * 1024
const maxDiagnosticBytes = 8 * 1024
const maxDiagnosticMessageCount = 32
const maxDiagnosticMessageLength = 240
const credentialValues = [
  process.env.QORE_ALPACA_API_KEY_ID,
  process.env.QORE_ALPACA_API_SECRET_KEY,
  process.env.APCA_API_KEY_ID,
  process.env.APCA_API_SECRET_KEY,
  process.env.ALPACA_API_KEY_ID,
  process.env.ALPACA_API_SECRET_KEY,
  process.env.ALPACA_API_KEY,
  process.env.ALPACA_SECRET_KEY,
].filter((value) => typeof value === 'string' && value.length >= 4)
const allowedOrigins = new Set(
  String(process.env.QORE_DASHBOARD_SERVICE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(isLocalOrigin),
)
const testUpstreamUrl = process.env.NODE_ENV === 'test' && process.env.QORE_COMMAND_TEST_UPSTREAM_URL
  ? new URL(process.env.QORE_COMMAND_TEST_UPSTREAM_URL)
  : null

let shuttingDown = false
let cachedTelemetry = null
let telemetryReadAt = 0
let activeRead = null
let activeConnect = null
let reconnectAttempts = 0
let nextReconnectAt = 0
let connection = connectionState('starting', 5, 'Starting the Command viewer.', false)
const activeChildren = new Set()

function validPort(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 && numeric < 65536 ? numeric : null
}

function positiveNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function isLocalOrigin(origin) {
  try {
    const parsed = new URL(origin)
    return (
      parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
      && Boolean(validPort(parsed.port))
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
    )
  } catch {
    return false
  }
}

function connectionState(phase, progressPct, detail, connected, error = null) {
  return {
    generatedAt: new Date().toISOString(),
    phase,
    progressPct,
    connected,
    remoteName,
    transport: 't3-tailscale-ssh',
    detail,
    error,
  }
}

function updateConnection(phase, progressPct, detail, connected = false, error = null) {
  connection = connectionState(phase, progressPct, detail, connected, error)
}

function safeText(value, maxLength = maxDiagnosticMessageLength) {
  let text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim()
  for (const credential of credentialValues) text = text.split(credential).join('[redacted]')
  if (remoteHost) text = text.replaceAll(remoteHost, remoteName)
  if (remoteUser) text = text.replaceAll(remoteUser, '[redacted-user]')
  text = text
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:api[-_ ]?(?:key|secret)|token|password)\s*[:=]\s*)[^,;\s]+/gi, '$1[redacted]')
    .replace(/((?:["']?account(?:[_ -]?(?:id|number))["']?)\s*(?:[:=]|\bis\b|\s+)\s*)(?:"[^"]*"|'[^']*'|[^,;\s]+)/gi, '$1[redacted]')
    .replace(/https:\/\/([^:\s/@]+):([^@\s]+)@/gi, 'https://$1:[redacted]@')
  return text.slice(0, maxLength)
}

function safeError(error) {
  return safeText(error?.message ?? error ?? 'Unknown connection error.')
}

function uniqueMessages(groups, limit = maxDiagnosticMessageCount) {
  if (limit <= 0) return []
  const result = []
  const seen = new Set()
  for (const group of groups) {
    for (const value of Array.isArray(group) ? group : [group]) {
      const message = safeText(value)
      if (!message || seen.has(message)) continue
      seen.add(message)
      result.push(message)
      if (result.length >= limit) return result
    }
  }
  return result
}

function normalizedTelemetry(value, refreshError = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${remoteName} returned an invalid telemetry object.`)
  }
  const riskSource = value.risk && typeof value.risk === 'object' && !Array.isArray(value.risk)
    ? value.risk
    : {}
  const blockedReasons = uniqueMessages([riskSource.blockedReasons])
  const warnings = uniqueMessages(
    [riskSource.warnings, refreshError ? `Read-only broker refresh failed: ${refreshError}` : []],
    Math.max(0, maxDiagnosticMessageCount - blockedReasons.length),
  )
  const telemetry = {
    ...value,
    ...(value.error ? { error: safeText(value.error) } : {}),
    portfolioHistory: value.portfolioHistory && typeof value.portfolioHistory === 'object'
      ? {
          ...value.portfolioHistory,
          ...(value.portfolioHistory.error ? { error: safeText(value.portfolioHistory.error) } : {}),
        }
      : value.portfolioHistory,
    risk: { ...riskSource, blockedReasons, warnings },
  }
  if (Buffer.byteLength(JSON.stringify(telemetry)) > maxSnapshotBytes) {
    throw new Error(`${remoteName} returned oversized telemetry.`)
  }
  return telemetry
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function commandResult(
  command,
  args,
  timeoutMs = 15_000,
  { maxStdoutBytes = maxSnapshotBytes, maxStderrBytes = maxDiagnosticBytes } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    activeChildren.add(child)
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeChildren.delete(child)
      callback(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(reject, new Error(`${path.basename(command)} timed out.`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdoutBytes) {
        child.kill('SIGTERM')
        finish(reject, new Error(`${path.basename(command)} returned oversized output.`))
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes <= maxStderrBytes) stderr += chunk
    })
    child.on('error', (error) => finish(reject, error))
    child.on('close', (code) => {
      if (code === 0) finish(resolve, { stdout, stderr })
      else finish(reject, new Error(stderr.trim() || `${path.basename(command)} exited ${code}.`))
    })
  })
}

function sshArgs(remoteCommand) {
  return [
    '-i', identityFile,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    `${remoteUser}@${remoteHost}`,
    remoteCommand,
  ]
}

async function checkExistingT3Route() {
  updateConnection('checking-t3', 28, `Checking the existing T3 connection to ${remoteName}.`)
  try {
    const response = await fetch(t3BaseUrl, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`T3 returned ${response.status}.`)
  } catch (error) {
    throw new Error(`The existing T3/Tailscale route is unavailable: ${safeError(error)}`)
  }
}

async function readTestTelemetry(refreshBroker) {
  const response = await fetch(new URL(refreshBroker ? '/api/live/refresh' : '/api/live/status', testUpstreamUrl), {
    method: refreshBroker ? 'POST' : 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(refreshBroker ? 45_000 : 5_000),
  })
  if (!response.ok) throw new Error(`Test telemetry returned ${response.status}.`)
  return normalizedTelemetry(await response.json())
}

async function runRemoteBrokerRefresh() {
  const command = `exec sudo -n ${shellQuote(remoteTelemetryHelper)} refresh`
  await commandResult(sshBinary, sshArgs(command), remoteRefreshTimeoutMs)
}

async function runRemoteSnapshot() {
  const command = `exec sudo -n ${shellQuote(remoteTelemetryHelper)} snapshot`
  const result = await commandResult(sshBinary, sshArgs(command), remoteSnapshotTimeoutMs)
  const output = result.stdout.trim()
  if (!output || output.includes('\n')) throw new Error(`${remoteName} returned invalid telemetry framing.`)
  try {
    return JSON.parse(output)
  } catch {
    throw new Error(`${remoteName} returned invalid telemetry JSON.`)
  }
}

async function readRemoteTelemetry(refreshBroker = false) {
  if (testUpstreamUrl) return readTestTelemetry(refreshBroker)
  let refreshError = null
  if (refreshBroker) {
    try {
      await runRemoteBrokerRefresh()
    } catch (error) {
      refreshError = safeError(error)
    }
  }
  return normalizedTelemetry(await runRemoteSnapshot(), refreshError)
}

function resetReconnectBackoff() {
  reconnectAttempts = 0
  nextReconnectAt = 0
}

function recordConnectionFailure(error, detail) {
  reconnectAttempts = Math.min(reconnectAttempts + 1, 16)
  const exponent = Math.min(reconnectAttempts - 1, 10)
  const delayMs = Math.min(reconnectMaxMs, reconnectBaseMs * (2 ** exponent))
  nextReconnectAt = Date.now() + delayMs
  updateConnection(
    'error',
    0,
    `${detail} A bounded reconnect will be available shortly.`,
    false,
    safeError(error),
  )
}

async function loadRemoteTelemetry(force = false, refreshBroker = false) {
  if (
    !force
    && connection.connected
    && cachedTelemetry
    && Date.now() - telemetryReadAt < readMinIntervalMs
  ) return cachedTelemetry

  while (activeRead) {
    if (!refreshBroker || activeRead.refreshBroker) return activeRead.promise
    try {
      await activeRead.promise
    } catch {
      // A forced broker refresh still gets its own attempt after an ordinary read fails.
    }
  }

  const read = { refreshBroker, promise: null }
  read.promise = readRemoteTelemetry(refreshBroker)
    .then((telemetry) => {
      cachedTelemetry = telemetry
      telemetryReadAt = Date.now()
      resetReconnectBackoff()
      updateConnection('connected', 100, `${remoteName} telemetry is connected read-only.`, true)
      return telemetry
    })
    .catch((error) => {
      recordConnectionFailure(error, `Could not read ${remoteName} telemetry.`)
      throw error
    })
    .finally(() => {
      if (activeRead === read) activeRead = null
    })
  activeRead = read
  return read.promise
}

function connect(force = false) {
  if (shuttingDown) return Promise.resolve()
  if (activeConnect) return activeConnect
  if (connection.connected && !force) return Promise.resolve()
  if (!force && Date.now() < nextReconnectAt) return Promise.resolve()

  activeConnect = (async () => {
    let telemetryAttempted = false
    try {
      await checkExistingT3Route()
      updateConnection('reading-telemetry', 72, `Reading sanitized QORE state over the existing M1 connection.`)
      telemetryAttempted = true
      await loadRemoteTelemetry(true)
    } catch (error) {
      if (!telemetryAttempted) recordConnectionFailure(error, `Could not connect to ${remoteName}.`)
    } finally {
      activeConnect = null
    }
  })()
  return activeConnect
}

function corsHeaders(origin) {
  return origin && allowedOrigins.has(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {}
}

function sendJson(response, statusCode, value, origin = null) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(origin),
  })
  response.end(`${JSON.stringify(value)}\n`)
}

async function serveTelemetry(request, response, origin) {
  try {
    if (!connection.connected) await connect()
    if (!connection.connected) throw new Error(connection.error ?? connection.detail)
    const refreshBroker = request.method === 'POST'
    const telemetry = await loadRemoteTelemetry(refreshBroker, refreshBroker)
    sendJson(response, 200, telemetry, origin)
  } catch {
    sendJson(response, 502, { error: connection.error ?? connection.detail, connection }, origin)
  }
}

const server = createServer((request, response) => {
  const origin = request.headers.origin ?? null
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: 'Origin is not allowed.' })
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
      ...corsHeaders(origin),
    })
    response.end()
    return
  }
  if (request.method === 'GET' && request.url === '/api/connection/status') {
    if (!connection.connected) void connect()
    sendJson(response, 200, connection, origin)
    return
  }
  if (
    (request.method === 'GET' && request.url === '/api/live/status')
    || (request.method === 'POST' && request.url === '/api/live/refresh')
  ) {
    void serveTelemetry(request, response, origin)
    return
  }
  sendJson(response, 404, { error: 'Not found.' }, origin)
})

server.listen(port, host, () => {
  console.log(`QORE Command bridge: http://${host}:${port}`)
  void connect(true)
})

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of activeChildren) child.kill('SIGTERM')
  server.close(() => process.exit(0))
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
