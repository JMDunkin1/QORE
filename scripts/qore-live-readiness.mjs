#!/usr/bin/env node
import { constants as fsConstants, existsSync, readFileSync, statSync } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { loadLocalEnv } from './local-env.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const rawArgs = process.argv.slice(2)
const jsonOutput = rawArgs.includes('--json')
const localOnly = rawArgs.includes('--local-only')
const mode = normalizeMode(argValue('--mode') ?? process.env.QORE_BROKER_MODE ?? 'dry-run')
const checks = []

function argValue(name) {
  const inline = rawArgs.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = rawArgs.indexOf(name)
  return index >= 0 ? rawArgs[index + 1] : null
}

function normalizeMode(value) {
  const normalized = String(value).toLowerCase()
  if (['dry-run', 'paper', 'live'].includes(normalized)) return normalized
  throw new Error(`Unsupported readiness mode "${value}". Use dry-run, paper, or live.`)
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function add(id, label, status, detail) {
  checks.push({ id, label, status, detail })
}

function command(commandName, args) {
  return spawnSync(commandName, args, { cwd: repoDir, encoding: 'utf8', env: process.env })
}

function nodeVersionSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23
}

function checkEnvFile(fileName) {
  const filePath = path.join(repoDir, fileName)
  if (!existsSync(filePath)) return false
  const permissions = statSync(filePath).mode & 0o777
  const exposed = (permissions & 0o077) !== 0
  add(
    `env-permissions-${fileName}`,
    `${fileName} permissions`,
    exposed && mode !== 'dry-run' ? 'block' : exposed ? 'warn' : 'pass',
    exposed
      ? `${fileName} mode is ${permissions.toString(8)}; use chmod 600 ${fileName} before storing broker keys.`
      : `${fileName} is restricted to its owner (${permissions.toString(8)}).`,
  )
  return true
}

function checkGitState() {
  const status = command('git', ['status', '--porcelain'])
  if (status.status !== 0) {
    add('git-state', 'Git working tree', 'block', status.stderr.trim() || 'Could not read Git working tree state.')
  } else if (status.stdout.trim()) {
    const changedPaths = status.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.slice(3).split(' -> ').at(-1))
      .filter(Boolean)
    const codeOrConfigPaths = changedPaths.filter((filePath) => !filePath.startsWith('data/qore/'))
    add(
      'git-state',
      'Git working tree',
      mode === 'live' && codeOrConfigPaths.length ? 'block' : 'warn',
      codeOrConfigPaths.length
        ? `Working tree has ${codeOrConfigPaths.length} code/config change(s) and ${changedPaths.length - codeOrConfigPaths.length} generated data change(s); deploy a reviewed commit for reproducible operation.`
        : `Working tree contains ${changedPaths.length} generated data artifact change(s), which is expected after a live refresh.`,
    )
  } else {
    add('git-state', 'Git working tree', 'pass', 'Working tree is clean.')
  }

  const upstream = command('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
  if (upstream.status !== 0) {
    add('git-upstream', 'Git upstream', 'warn', upstream.stderr.trim() || 'No upstream comparison is available.')
    return
  }
  const [ahead, behind] = upstream.stdout.trim().split(/\s+/).map(Number)
  if (ahead || behind) {
    add('git-upstream', 'Git upstream', mode === 'live' ? 'block' : 'warn', `HEAD differs from its upstream (ahead ${ahead}, behind ${behind}).`)
  } else {
    add('git-upstream', 'Git upstream', 'pass', 'HEAD matches its configured upstream.')
  }
}

function parseBrokerStatus(stdout) {
  try {
    return JSON.parse(stdout.trim())
  } catch {
    return null
  }
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(path.join(repoDir, relativePath), 'utf8'))
  } catch {
    return null
  }
}

function latestCsvDate(relativePath, columnName) {
  try {
    const lines = readFileSync(path.join(repoDir, relativePath), 'utf8').trim().split(/\r?\n/)
    const headers = lines.shift()?.split(',') ?? []
    const index = headers.indexOf(columnName)
    if (index < 0) return null
    return lines.reduce((latest, line) => {
      const value = line.split(',')[index]
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && (!latest || value > latest) ? value : latest
    }, null)
  } catch {
    return null
  }
}

function calendarAgeDays(dateText) {
  if (!dateText) return null
  const timestamp = Date.parse(`${dateText}T00:00:00Z`)
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(timestamp) ? Math.max(0, (today - timestamp) / 86400000) : null
}

add(
  'node-version',
  'Node.js runtime',
  nodeVersionSupported() ? 'pass' : 'block',
  `Node ${process.versions.node}; QORE requires Node 20.19+ or 22.12+.`,
)
add(
  'host-platform',
  'Host platform',
  process.platform === 'linux' ? 'pass' : 'warn',
  process.platform === 'linux' ? 'Linux host detected.' : `${process.platform} detected; repeat this check on the Linux VPS.`,
)

const requiredFiles = [
  'config/qore-live-broker-settings.json',
  'config/qore-live-weather-settings.json',
  'data/qore/market/index-basket-config.json',
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv',
  'scripts/qore-alpaca-broker.mjs',
  'scripts/qore-live-trading-supervisor.mjs',
]
for (const relativePath of requiredFiles) {
  add(
    `file-${relativePath}`,
    relativePath,
    existsSync(path.join(repoDir, relativePath)) ? 'pass' : 'block',
    existsSync(path.join(repoDir, relativePath)) ? 'Required runtime file is present.' : 'Required runtime file is missing.',
  )
}

const allYearTradesPath = 'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv'
const latestAllYearDate = latestCsvDate(allYearTradesPath, 'entryTradeDate')
const allYearAgeDays = calendarAgeDays(latestAllYearDate)
add(
  'all-year-artifact-freshness',
  'All-year strategy artifact freshness',
  allYearAgeDays !== null && allYearAgeDays <= 1 ? 'pass' : 'block',
  allYearAgeDays === null
    ? 'Could not determine the latest entryTradeDate in the all-year artifact.'
    : `Latest all-year row is ${latestAllYearDate} (${allYearAgeDays.toFixed(1)} calendar day(s) old); cap is 1 day.`,
)

const dataManifest = readJson('data/qore/runs/free-data-manifest.json')
if (dataManifest) {
  const failedSourceCount = Number(dataManifest.refreshSummary?.failedSourceCount ?? 0)
  add(
    'last-data-refresh',
    'Last free-data refresh',
    failedSourceCount > 0 ? 'block' : 'pass',
    failedSourceCount > 0
      ? `The last refresh recorded ${failedSourceCount} failed source request(s).`
      : `Refresh manifest is healthy (${dataManifest.generatedAt ?? 'timestamp unavailable'}).`,
  )
}

const signalHandoff = readJson('.local/qore/live-weather/signal-intent-reconcile.json')
if (signalHandoff?.inference?.liveForecastAppliedToTarget === false) {
  add(
    'live-strategy-inference',
    'Current forecast strategy inference',
    mode === 'live' ? 'block' : 'warn',
    'Current weather is a risk gate only; it is not yet converted into the all-year target. Real-money mode remains blocked.',
  )
} else if (signalHandoff?.inference?.liveForecastAppliedToTarget === true) {
  add('live-strategy-inference', 'Current forecast strategy inference', 'pass', 'The current forecast was applied to the target-weight inference.')
}

const hasDotEnv = checkEnvFile('.env')
const hasLocalEnv = checkEnvFile('.env.local')
const hasEnv = hasDotEnv || hasLocalEnv
if (!hasEnv && mode !== 'dry-run') {
  add('env-file', 'Broker environment file', 'block', 'Create .env.local from .env.live.example before paper or live operation.')
}

const apiKey = process.env.QORE_ALPACA_API_KEY_ID ?? process.env.APCA_API_KEY_ID ?? process.env.ALPACA_API_KEY_ID ?? process.env.ALPACA_API_KEY
const secretKey = process.env.QORE_ALPACA_API_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY ?? process.env.ALPACA_API_SECRET_KEY ?? process.env.ALPACA_SECRET_KEY
add(
  'alpaca-credentials',
  'Alpaca credentials',
  apiKey && secretKey ? 'pass' : mode === 'dry-run' ? 'warn' : 'block',
  apiKey && secretKey ? 'An API key and secret are loaded; values were not printed.' : 'Alpaca API key and secret are not both configured.',
)

if (mode === 'paper') {
  add(
    'paper-routing-confirmation',
    'Paper routing confirmation',
    truthy(process.env.QORE_PAPER_ORDER_ROUTING_ENABLED) ? 'pass' : 'block',
    'Paper routing requires QORE_PAPER_ORDER_ROUTING_ENABLED=1.',
  )
}
if (mode === 'live') {
  const liveFlags =
    truthy(process.env.QORE_LIVE_TRADING_ENABLED) &&
    truthy(process.env.QORE_LIVE_ORDER_ROUTING_ENABLED) &&
    process.env.QORE_CONFIRM_LIVE_TRADING === 'I_UNDERSTAND_THIS_CAN_LOSE_MONEY'
  add(
    'live-routing-confirmation',
    'Live routing confirmation',
    liveFlags ? 'pass' : 'block',
    liveFlags
      ? 'All three independent real-money confirmation gates are set.'
      : 'Live mode requires both routing flags plus the exact loss-risk confirmation phrase.',
  )
}

try {
  await access(repoDir, fsConstants.R_OK | fsConstants.W_OK)
  add('repo-access', 'Runtime directory access', 'pass', 'The runtime user can read and write the repository state directory.')
} catch (error) {
  add('repo-access', 'Runtime directory access', 'block', error.message)
}

checkGitState()

if (process.platform === 'linux') {
  const ntpSynchronized = command('timedatectl', ['show', '-p', 'NTPSynchronized', '--value'])
  add(
    'host-clock-sync',
    'Host clock synchronization',
    ntpSynchronized.status === 0 && ntpSynchronized.stdout.trim() === 'yes' ? 'pass' : 'block',
    ntpSynchronized.status === 0 && ntpSynchronized.stdout.trim() === 'yes'
      ? 'The host clock is NTP-synchronized.'
      : 'The host clock is not confirmed synchronized; accurate market and quote timestamps are required.',
  )
  const localRtc = command('timedatectl', ['show', '-p', 'LocalRTC', '--value'])
  add(
    'host-rtc-mode',
    'Hardware clock mode',
    localRtc.status === 0 && localRtc.stdout.trim() === 'no' ? 'pass' : 'warn',
    localRtc.status === 0 && localRtc.stdout.trim() === 'no'
      ? 'The hardware clock is stored in UTC.'
      : 'The hardware clock is stored in local time; switch it to UTC to avoid DST/reboot timestamp problems.',
  )
  const userSystemd = command('systemctl', ['--user', 'show-environment'])
  add(
    'systemd-user-manager',
    'systemd user manager',
    userSystemd.status === 0 ? 'pass' : 'warn',
    userSystemd.status === 0
      ? 'The systemd user manager is reachable.'
      : 'The systemd user manager is not reachable in this session; enable lingering before unattended operation.',
  )
}

if (!localOnly && mode !== 'dry-run' && apiKey && secretKey) {
  const broker = command(process.execPath, ['scripts/qore-alpaca-broker.mjs', `--mode=${mode}`, '--preflight-only', '--json'])
  const status = parseBrokerStatus(broker.stdout)
  if (!status?.account || status?.mode !== mode) {
    add('broker-connectivity', 'Alpaca connectivity', 'block', status?.blockedReasons?.join(' ') || broker.stderr.trim() || 'Broker status check failed.')
  } else {
    add('broker-connectivity', 'Alpaca connectivity', 'pass', 'Trading API account, positions, and open orders are readable.')
    const rawAccount = status.rawAccount ?? {}
    const accountReady =
      rawAccount.status === 'ACTIVE' &&
      rawAccount.tradingBlocked !== true &&
      rawAccount.accountBlocked !== true &&
      rawAccount.tradeSuspendedByUser !== true
    add(
      'broker-account-status',
      'Alpaca account status',
      accountReady ? 'pass' : 'block',
      accountReady ? 'Account is ACTIVE and not blocked or user-suspended.' : 'Account is not ACTIVE or has a trading/account suspension flag.',
    )
    const quoteRows = status.marketData?.rows ?? []
    const quotesReady = quoteRows.length === 3 && quoteRows.every((row) => row.status === 'ok' && Number.isFinite(row.spreadBps))
    add(
      'alpaca-market-data',
      'Alpaca latest quotes',
      quotesReady ? 'pass' : 'block',
      quotesReady ? `Executable bid/ask quotes are readable from the ${status.marketData.feed} feed.` : 'One or more UNG/VOO/QQQM bid/ask quotes are unavailable.',
    )
    add(
      'broker-preflight',
      'No-order broker preflight',
      status.preflightApproved && ['planned', 'no-op'].includes(status.executionStatus) ? 'pass' : 'block',
      status.preflightApproved
        ? 'All current signal, risk, account, market-clock, and routing gates passed without placing an order.'
        : status.blockedReasons?.join(' ') || 'Broker preflight did not approve the current reconcile.',
    )
  }
} else if (localOnly && mode !== 'dry-run') {
  add('broker-connectivity', 'Alpaca connectivity', 'warn', 'Skipped by --local-only; run again without it on the VPS before enabling the service.')
}

const blocks = checks.filter((check) => check.status === 'block')
const warnings = checks.filter((check) => check.status === 'warn')
const result = {
  generatedAt: new Date().toISOString(),
  serviceId: 'qore-live-readiness',
  mode,
  ready: blocks.length === 0,
  summary: { passed: checks.length - blocks.length - warnings.length, warnings: warnings.length, blocks: blocks.length },
  checks,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`QORE ${mode} readiness: ${result.ready ? 'READY' : 'BLOCKED'} (${result.summary.blocks} blocks, ${result.summary.warnings} warnings).`)
  for (const check of checks.filter((item) => item.status !== 'pass')) {
    console.log(`- ${check.status.toUpperCase()}: ${check.label}: ${check.detail}`)
  }
}

if (!result.ready) process.exitCode = 1
