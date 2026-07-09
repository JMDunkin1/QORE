#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const once = args.has('--once')
const jsonOutput = args.has('--json')
const supervisorDir = path.resolve(process.env.QORE_LIVE_SUPERVISOR_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'live-trading-supervisor'))
const supervisorStatusPath = path.resolve(process.env.QORE_LIVE_SUPERVISOR_STATUS_FILE ?? path.join(supervisorDir, 'status.json'))
const schedulerTickMs = positiveNumber(process.env.QORE_LIVE_SUPERVISOR_TICK_MS, 5_000)
const jobTimeoutMs = positiveNumber(process.env.QORE_LIVE_JOB_TIMEOUT_MS, 30 * 60 * 1000)
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const jobState = new Map()

function truthy(value, fallback = false) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function relative(filePath) {
  return path.relative(repoDir, filePath)
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function commandJob(id, label, script, intervalEnv, fallbackIntervalMs, enabledEnv, fallbackEnabled = true) {
  return {
    id,
    label,
    command: npmCommand,
    args: ['run', script],
    intervalMs: positiveNumber(process.env[intervalEnv], fallbackIntervalMs),
    enabled: truthy(process.env[enabledEnv], fallbackEnabled),
  }
}

function jobs() {
  const researchRefreshEnabled = truthy(process.env.QORE_LIVE_REFRESH_RESEARCH, true)
  return [
    commandJob('collectFreeData', 'Collect free market/weather/storage data', 'collect:free-data', 'QORE_LIVE_DATA_REFRESH_INTERVAL_MS', 24 * 60 * 60 * 1000, 'QORE_LIVE_COLLECT_FREE_DATA_ENABLED', researchRefreshEnabled),
    commandJob('optimizeSummerAlpha', 'Refresh NGAS Summer Alpha artifact', 'optimize:ngas-summer-alpha', 'QORE_LIVE_SIGNAL_REFRESH_INTERVAL_MS', 24 * 60 * 60 * 1000, 'QORE_LIVE_OPTIMIZE_SUMMER_ENABLED', researchRefreshEnabled),
    commandJob('optimizeWinterAlpha', 'Refresh NGAS Winter Alpha artifact', 'optimize:ngas-winter-alpha', 'QORE_LIVE_SIGNAL_REFRESH_INTERVAL_MS', 24 * 60 * 60 * 1000, 'QORE_LIVE_OPTIMIZE_WINTER_ENABLED', researchRefreshEnabled),
    commandJob('optimizeAllYearBeta', 'Refresh NGAS All-Year Beta artifact', 'optimize:ngas-all-year-beta', 'QORE_LIVE_SIGNAL_REFRESH_INTERVAL_MS', 24 * 60 * 60 * 1000, 'QORE_LIVE_OPTIMIZE_ALL_YEAR_ENABLED', researchRefreshEnabled),
    commandJob('liveWeatherOnce', 'Refresh live weather, market, risk, and signal handoff', 'live:weather:once', 'QORE_LIVE_HANDOFF_REFRESH_INTERVAL_MS', 5 * 60 * 1000, 'QORE_LIVE_WEATHER_HANDOFF_ENABLED', true),
    commandJob('brokerReconcile', 'Reconcile Alpaca target weights', 'broker:alpaca:reconcile', 'QORE_LIVE_BROKER_RECONCILE_INTERVAL_MS', 60 * 1000, 'QORE_LIVE_BROKER_RECONCILE_ENABLED', true),
  ]
}

function shouldRun(job, now) {
  if (!job.enabled) return false
  if (once && jobState.has(job.id)) return false
  const state = jobState.get(job.id)
  if (!state?.lastStartedAt) return true
  return now.getTime() - Date.parse(state.lastStartedAt) >= job.intervalMs
}

function runJob(job) {
  const startedAt = new Date().toISOString()
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(job.command, job.args, {
      cwd: repoDir,
      env: process.env,
      shell: process.platform === 'win32',
    })
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, jobTimeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (!jsonOutput) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (!jsonOutput) process.stderr.write(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      const finishedAt = new Date().toISOString()
      resolve({
        id: job.id,
        label: job.label,
        command: [job.command, ...job.args].join(' '),
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        exitCode: null,
        signal: null,
        ok: false,
        timedOut,
        stdoutTail: stdout.trimEnd().split('\n').slice(-20),
        stderrTail: [...stderr.trimEnd().split('\n').slice(-20), error.message].filter(Boolean),
      })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      const finishedAt = new Date().toISOString()
      resolve({
        id: job.id,
        label: job.label,
        command: [job.command, ...job.args].join(' '),
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        exitCode: code,
        signal,
        ok: code === 0 && !timedOut,
        timedOut,
        stdoutTail: stdout.trimEnd().split('\n').slice(-20),
        stderrTail: stderr.trimEnd().split('\n').slice(-20),
      })
    })
  })
}

async function writeSupervisorStatus(activeJob = null) {
  const jobSnapshots = jobs().map((job) => ({
    id: job.id,
    label: job.label,
    enabled: job.enabled,
    intervalMs: job.intervalMs,
    state: jobState.get(job.id) ?? null,
  }))
  const failedJobs = jobSnapshots.filter((job) => job.state && !job.state.ok)
  const status = {
    generatedAt: new Date().toISOString(),
    serviceId: 'qore-live-trading-supervisor',
    mode: process.env.QORE_BROKER_MODE ?? 'dry-run',
    once,
    ok: failedJobs.length === 0,
    activeJob,
    jobs: jobSnapshots,
    failedJobs: failedJobs.map((job) => ({
      id: job.id,
      label: job.label,
      exitCode: job.state.exitCode,
      signal: job.state.signal,
      timedOut: job.state.timedOut,
    })),
    files: {
      status: relative(supervisorStatusPath),
    },
  }
  await writeJson(supervisorStatusPath, status)
  return status
}

async function schedulerPass() {
  const now = new Date()
  const results = []
  for (const job of jobs()) {
    if (!shouldRun(job, now)) continue
    await writeSupervisorStatus({ id: job.id, label: job.label, startedAt: new Date().toISOString() })
    if (!jsonOutput) console.log(`QORE live supervisor: ${job.label}`)
    const result = await runJob(job)
    results.push(result)
    jobState.set(job.id, result)
    await writeSupervisorStatus()
    if (!result.ok) {
      if (!jsonOutput) console.error(`QORE live supervisor: stopping pass after failed ${job.label}.`)
      break
    }
  }
  return results
}

if (!jsonOutput) {
  console.log(`QORE live supervisor writing ${relative(supervisorStatusPath)}.`)
}

do {
  const results = await schedulerPass()
  const status = await writeSupervisorStatus()
  if (jsonOutput) console.log(JSON.stringify(status, null, 2))
  if (once) {
    if (results.some((result) => !result.ok) || !status.ok) process.exitCode = 1
    break
  }
  await new Promise((resolve) => setTimeout(resolve, schedulerTickMs))
} while (true)
