#!/usr/bin/env node
import { constants as fsConstants, existsSync, readFileSync, statSync } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { loadLocalEnv } from './local-env.mjs'
import { inspectGitWorkingTree } from './lib/qore-git-state.mjs'
import { liveInferenceProvenanceBlocks } from './lib/qore-live-inference-provenance.mjs'
import { resolveLiveWeatherPaths } from './lib/qore-live-paths.mjs'
import { loadAllYearStrategyArtifact, strategyArtifactBindingBlocks } from './lib/qore-live-strategy-artifact.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const rawArgs = process.argv.slice(2)
const jsonOutput = rawArgs.includes('--json')
const localOnly = rawArgs.includes('--local-only')
const supervisorPrestart = rawArgs.includes('--supervisor-prestart')
const mode = normalizeMode(argValue('--mode') ?? process.env.QORE_BROKER_MODE ?? 'dry-run')
const { stateDir: weatherStateDir } = resolveLiveWeatherPaths(repoDir)
const signalIntentPath = path.resolve(process.env.QORE_LIVE_SIGNAL_INTENT_FILE ?? path.join(weatherStateDir, 'signal-intent-reconcile.json'))
const maxSignalAgeDays = 1
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

function signalFreshness(signalHandoff) {
  const issueDate = signalHandoff?.inference?.forecastValidation?.latestCommonIssueDate
  const targetDate = signalHandoff?.intent?.targetDate
  const freshnessDate = mode === 'dry-run' ? issueDate ?? targetDate : issueDate
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(freshnessDate ?? ''))
    ? new Date(`${freshnessDate}T00:00:00Z`)
    : null
  const validDate = parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === freshnessDate
    ? parsedDate
    : null
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const ageDays = validDate ? (today - validDate.getTime()) / 86400000 : null
  return {
    ageDays,
    freshnessDate,
    source: issueDate ? 'validated inference issue date' : mode === 'dry-run' ? 'target date' : 'validated inference issue date',
    stale: signalHandoff?.stale === true || ageDays === null || ageDays < 0 || ageDays > maxSignalAgeDays,
  }
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
  const state = inspectGitWorkingTree(repoDir)
  if (!state.readable) {
    add('git-state', 'Git working tree', 'block', state.error)
  } else if (state.changedPaths.length) {
    add(
      'git-state',
      'Git working tree',
      mode === 'live' && state.codeOrConfigPaths.length ? 'block' : 'warn',
      state.codeOrConfigPaths.length
        ? `Working tree has ${state.codeOrConfigPaths.length} code/config change(s) and ${state.generatedArtifactPaths.length} generated data change(s); deploy a reviewed commit for reproducible operation.`
        : `Working tree contains ${state.generatedArtifactPaths.length} generated data artifact change(s), which is expected after a live refresh.`,
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

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(path.resolve(repoDir, filePath), 'utf8'))
  } catch {
    return null
  }
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

const dataManifest = readJson('data/qore/runs/free-data-manifest.json')
if (!supervisorPrestart && dataManifest) {
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

const signalHandoff = readJson(signalIntentPath)
const inferenceProvenanceBlocks = liveInferenceProvenanceBlocks(signalHandoff)
let strategyArtifactBlocks
try {
  strategyArtifactBlocks = strategyArtifactBindingBlocks(
    signalHandoff?.inference?.strategyArtifact,
    loadAllYearStrategyArtifact(repoDir),
    { mode },
  )
} catch (error) {
  strategyArtifactBlocks = [`current reviewed strategy artifact is unavailable: ${error.message}`]
}
const liveInferenceBlocks = [...inferenceProvenanceBlocks, ...strategyArtifactBlocks]
if (
  !supervisorPrestart
  && signalHandoff?.inference?.strategyId === 'ngas-all-year-beta'
  && signalHandoff.inference.validated === true
  && signalHandoff.inference.liveForecastAppliedToTarget === true
  && (mode === 'dry-run' || liveInferenceBlocks.length === 0)
) {
  add('live-strategy-inference', 'Current forecast strategy inference', 'pass', 'The current validated forecast was applied to the target-weight inference.')
} else if (!supervisorPrestart) {
  add(
    'live-strategy-inference',
    'Current forecast strategy inference',
    mode === 'dry-run' ? 'warn' : 'block',
    signalHandoff
      ? `The configured signal handoff does not contain validated production live inference (${path.relative(repoDir, signalIntentPath)}): ${liveInferenceBlocks.join('; ') || 'identity/validation flags are incomplete'}. Paper/live routing remains blocked.`
      : `The configured signal handoff is missing or malformed (${path.relative(repoDir, signalIntentPath)}). Paper/live routing remains blocked.`,
  )
}

if (!supervisorPrestart) {
  const currentSignalFreshness = signalFreshness(signalHandoff)
  add(
    'live-strategy-freshness',
    'Current forecast strategy freshness',
    currentSignalFreshness.stale ? (mode === 'dry-run' ? 'warn' : 'block') : 'pass',
    currentSignalFreshness.ageDays === null
      ? mode === 'dry-run'
        ? 'The signal handoff has no valid validated inference issue date or target date.'
        : 'The signal handoff has no valid validated inference issue date.'
      : `${currentSignalFreshness.source} ${currentSignalFreshness.freshnessDate} is ${currentSignalFreshness.ageDays.toFixed(1)} calendar day(s) old; cap is ${maxSignalAgeDays} day.`,
  )
}

const hasDotEnv = checkEnvFile('.env')
const hasLocalEnv = checkEnvFile('.env.local')
const hasEnv = hasDotEnv || hasLocalEnv
if (!hasEnv && mode !== 'dry-run') {
  add(
    'env-file',
    'Broker environment file',
    mode === 'live' ? 'block' : 'warn',
    mode === 'live'
      ? 'Create .env.local from .env.live.example before live operation.'
      : 'No local broker environment file is present; paper credentials must be supplied by the process environment.',
  )
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
      rawAccount.tradingBlocked === false &&
      rawAccount.accountBlocked === false &&
      rawAccount.tradeSuspendedByUser === false
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
