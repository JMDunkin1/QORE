#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const once = args.has('--once')
const prepareOnly = args.has('--prepare')
const jsonOutput = args.has('--json')
const supervisorDir = path.resolve(process.env.QORE_LIVE_SUPERVISOR_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'live-trading-supervisor'))
const supervisorStatusPath = path.resolve(process.env.QORE_LIVE_SUPERVISOR_STATUS_FILE ?? path.join(supervisorDir, 'status.json'))
const supervisorLockPath = path.resolve(process.env.QORE_LIVE_SUPERVISOR_LOCK_FILE ?? path.join(supervisorDir, 'supervisor.lock'))
const schedulerTickMs = positiveNumber(process.env.QORE_LIVE_SUPERVISOR_TICK_MS, 5_000)
const jobTimeoutMs = positiveNumber(process.env.QORE_LIVE_JOB_TIMEOUT_MS, 30 * 60 * 1000)
const jobTerminationGraceMs = Math.min(positiveNumber(process.env.QORE_LIVE_JOB_TERMINATION_GRACE_MS, 5_000), 60_000)
const jobKillWaitMs = Math.min(positiveNumber(process.env.QORE_LIVE_JOB_KILL_WAIT_MS, 5_000), 60_000)
const failedJobRetryMs = positiveNumber(process.env.QORE_LIVE_FAILED_JOB_RETRY_MS, 5 * 60 * 1000)
const jobState = new Map()
const processGroupControlSupported = ['aix', 'darwin', 'freebsd', 'linux', 'netbsd', 'openbsd', 'sunos'].includes(process.platform)
let activeJobControl = null
let shuttingDown = false
let wakeFromSleep = null
let ownedSupervisorLock = null
let supervisorLockRequiresManualCleanup = false

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

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function acquireSupervisorLock() {
  await mkdir(path.dirname(supervisorLockPath), { recursive: true })
  const lock = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
    repoDir,
  }
  let handle = null
  try {
    handle = await open(supervisorLockPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(lock)}\n`, 'utf8')
    await handle.close()
    handle = null
    ownedSupervisorLock = lock
  } catch (error) {
    await handle?.close().catch(() => {})
    if (error?.code !== 'EEXIST') throw error

    let owner = null
    try {
      owner = JSON.parse(await readFile(supervisorLockPath, 'utf8'))
    } catch {
      // A malformed or unreadable lock must also fail closed.
    }
    if (processIsRunning(Number(owner?.pid))) {
      throw new Error(`QORE live supervisor is already running as PID ${owner.pid}.`)
    }
    const ownerDescription = Number.isInteger(Number(owner?.pid)) && Number(owner.pid) > 0
      ? ` for non-running PID ${owner.pid}`
      : ' with unreadable or invalid ownership metadata'
    throw new Error(
      `QORE live supervisor lock ${relative(supervisorLockPath)} already exists${ownerDescription}. `
      + 'Startup is blocked; verify that no supervisor is running, then remove the lock manually and retry.',
    )
  }
}

async function releaseSupervisorLock() {
  const expectedOwner = ownedSupervisorLock
  if (!expectedOwner) return
  ownedSupervisorLock = null

  let actualOwner
  try {
    actualOwner = JSON.parse(await readFile(supervisorLockPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(
        `QORE live supervisor: leaving ${relative(supervisorLockPath)} in place because lock ownership could not be verified.`,
      )
    }
    return
  }

  if (Number(actualOwner?.pid) !== expectedOwner.pid || actualOwner?.token !== expectedOwner.token) {
    console.error(
      `QORE live supervisor: leaving ${relative(supervisorLockPath)} in place because its ownership changed.`,
    )
    return
  }

  await unlink(supervisorLockPath).catch((error) => {
    if (error?.code !== 'ENOENT') {
      console.error(`QORE live supervisor: could not release ${relative(supervisorLockPath)}: ${error.message}`)
    }
  })
}

function requestShutdown() {
  shuttingDown = true
  if (activeJobControl) void terminateJobProcessGroup(activeJobControl, 'supervisor shutdown')
  if (wakeFromSleep) wakeFromSleep()
}

function processGroupIsRunning(groupPid) {
  if (!Number.isInteger(groupPid) || groupPid <= 0) return false
  try {
    process.kill(-groupPid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

function signalProcessGroup(groupPid, signal) {
  try {
    process.kill(-groupPid, signal)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

async function waitForProcessGroupExit(groupPid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  do {
    if (!processGroupIsRunning(groupPid)) return true
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))))
  } while (Date.now() < deadline)
  return !processGroupIsRunning(groupPid)
}

function preserveSupervisorLockForProcessGroup(control, message) {
  supervisorLockRequiresManualCleanup = true
  shuttingDown = true
  control.terminationErrors.push(message)
  if (wakeFromSleep) wakeFromSleep()
}

function recordProcessGroupError(control, message) {
  control.terminationErrors.push(message)
}

function terminateJobProcessGroup(control, reason) {
  if (control.terminationPromise) return control.terminationPromise
  control.terminationReason = reason
  control.terminationPromise = (async () => {
    if (!processGroupControlSupported || !Number.isInteger(control.groupPid) || control.groupPid <= 0) {
      preserveSupervisorLockForProcessGroup(
        control,
        `Cannot safely terminate ${control.job.label}: process-group control is unavailable.`,
      )
      return
    }

    let groupExited = false
    try {
      if (signalProcessGroup(control.groupPid, 'SIGTERM')) control.lastSignalSent = 'SIGTERM'
      groupExited = await waitForProcessGroupExit(control.groupPid, jobTerminationGraceMs)
    } catch (error) {
      recordProcessGroupError(
        control,
        `Could not send or verify SIGTERM for process group ${control.groupPid}: ${error.message}`,
      )
    }

    if (!groupExited) {
      try {
        if (signalProcessGroup(control.groupPid, 'SIGKILL')) control.lastSignalSent = 'SIGKILL'
        groupExited = await waitForProcessGroupExit(control.groupPid, jobKillWaitMs)
      } catch (error) {
        recordProcessGroupError(
          control,
          `Could not send or verify SIGKILL for process group ${control.groupPid}: ${error.message}`,
        )
      }
    }

    if (!groupExited) {
      preserveSupervisorLockForProcessGroup(
        control,
        `Process group ${control.groupPid} remained active after bounded SIGTERM/SIGKILL shutdown.`,
      )
    }
  })().finally(() => {
    control.onTerminationComplete?.()
  })
  return control.terminationPromise
}

async function sleep(ms) {
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeFromSleep = null
      resolve()
    }, ms)
    wakeFromSleep = () => {
      clearTimeout(timer)
      wakeFromSleep = null
      resolve()
    }
  })
}

function nodeJob(id, label, scriptPath, intervalEnv, fallbackIntervalMs, enabledEnv, fallbackEnabled = true, scriptArgs = [], env = {}) {
  return {
    id,
    label,
    command: process.execPath,
    args: [scriptPath, ...scriptArgs],
    intervalMs: positiveNumber(process.env[intervalEnv], fallbackIntervalMs),
    enabled: truthy(process.env[enabledEnv], fallbackEnabled),
    env,
  }
}

function jobs() {
  const brokerReconcile = nodeJob('brokerReconcile', 'Reconcile Alpaca target weights', 'scripts/qore-alpaca-broker.mjs', 'QORE_LIVE_BROKER_RECONCILE_INTERVAL_MS', 60 * 1000, 'QORE_LIVE_BROKER_RECONCILE_ENABLED', true, ['--reconcile'])
  brokerReconcile.enabled = !prepareOnly && brokerReconcile.enabled
  return [
    nodeJob('liveWeatherOnce', 'Refresh live weather, market, risk, and signal handoff', 'scripts/qore-live-weather-service.mjs', 'QORE_LIVE_HANDOFF_REFRESH_INTERVAL_MS', 5 * 60 * 1000, 'QORE_LIVE_WEATHER_HANDOFF_ENABLED', true, ['--once', '--respect-cadence', '--no-performance-test']),
    brokerReconcile,
  ]
}

function shouldRun(job, now) {
  if (!job.enabled) return false
  if (once && jobState.has(job.id)) return false
  const state = jobState.get(job.id)
  if (!state?.lastStartedAt) return true
  const intervalMs = state.ok === false ? failedJobRetryMs : job.intervalMs
  return now.getTime() - Date.parse(state.lastStartedAt) >= intervalMs
}

function runJob(job) {
  const startedAt = new Date().toISOString()
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let closeObserved = false

    if (!processGroupControlSupported) {
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
        stdoutTail: [],
        stderrTail: [
          `Refusing to start ${job.label}: QORE cannot guarantee process-tree containment on ${process.platform}.`,
        ],
      })
      return
    }

    const child = spawn(job.command, job.args, {
      cwd: repoDir,
      env: { ...process.env, ...(job.env ?? {}) },
      // POSIX detached children lead a new session/process group, so every descendant
      // that inherits that group can be stopped before the supervisor lock is released.
      detached: true,
      shell: false,
    })
    const control = {
      groupPid: child.pid,
      job,
      lastSignalSent: null,
      onTerminationComplete: null,
      terminationErrors: [],
      terminationPromise: null,
      terminationReason: null,
      unexpectedDescendants: false,
    }
    activeJobControl = control
    const timeout = setTimeout(() => {
      timedOut = true
      void terminateJobProcessGroup(control, 'job timeout')
    }, jobTimeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (!jsonOutput) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (!jsonOutput) process.stderr.write(chunk)
    })

    const finish = async (code, signal, spawnError = null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      if (control.terminationPromise) {
        await control.terminationPromise
      } else if (Number.isInteger(control.groupPid) && control.groupPid > 0) {
        let groupStillRunning = false
        try {
          groupStillRunning = processGroupIsRunning(control.groupPid)
        } catch (error) {
          recordProcessGroupError(
            control,
            `Could not verify process group ${control.groupPid} after its leader exited: ${error.message}`,
          )
          groupStillRunning = true
        }
        if (groupStillRunning) {
          control.unexpectedDescendants = true
          await terminateJobProcessGroup(control, 'job leader exited while descendants remained active')
        }
      }

      if (!closeObserved) {
        child.stdout?.destroy()
        child.stderr?.destroy()
        child.unref()
      }
      if (activeJobControl === control) activeJobControl = null
      const finishedAt = new Date().toISOString()
      const terminationErrorTail = control.terminationErrors.map((message) => `Supervisor containment failure: ${message}`)
      const descendantErrorTail = control.unexpectedDescendants
        ? ['Supervisor containment failure: job leader exited while descendants remained active.']
        : []
      resolve({
        id: job.id,
        label: job.label,
        command: [job.command, ...job.args].join(' '),
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        exitCode: code,
        signal,
        ok: code === 0
          && !timedOut
          && !spawnError
          && !control.terminationReason
          && !control.unexpectedDescendants
          && terminationErrorTail.length === 0,
        timedOut,
        stdoutTail: stdout.trimEnd().split('\n').slice(-20),
        stderrTail: [
          ...stderr.trimEnd().split('\n').slice(-20),
          spawnError?.message,
          ...descendantErrorTail,
          ...terminationErrorTail,
        ].filter(Boolean),
      })
    }

    control.onTerminationComplete = () => {
      if (!closeObserved) void finish(null, control.lastSignalSent)
    }
    child.once('error', (error) => {
      void finish(null, null, error)
    })
    child.once('exit', () => {
      if (control.terminationPromise || !Number.isInteger(control.groupPid) || control.groupPid <= 0) return
      try {
        if (!processGroupIsRunning(control.groupPid)) return
      } catch (error) {
        recordProcessGroupError(
          control,
          `Could not verify process group ${control.groupPid} after its leader exited: ${error.message}`,
        )
      }
      control.unexpectedDescendants = true
      void terminateJobProcessGroup(control, 'job leader exited while descendants remained active')
    })
    child.once('close', (code, signal) => {
      closeObserved = true
      void finish(code, signal)
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
    prepareOnly,
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
    if (shuttingDown) break
    const priorState = jobState.get(job.id)
    if (!shouldRun(job, now)) {
      if (priorState?.ok === false) break
      continue
    }
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

process.on('SIGINT', requestShutdown)
process.on('SIGTERM', requestShutdown)

try {
  await acquireSupervisorLock()
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
    if (!shuttingDown) await sleep(schedulerTickMs)
  } while (!shuttingDown)
} catch (error) {
  console.error(`QORE live supervisor: ${error.message}`)
  process.exitCode = 1
} finally {
  if (supervisorLockRequiresManualCleanup) {
    console.error(
      `QORE live supervisor: preserving ${relative(supervisorLockPath)} because a job process group could not be proven stopped. `
      + 'Verify all job descendants are stopped, inspect broker state for an ambiguous mutation, then remove the supervisor lock manually.',
    )
  } else {
    await releaseSupervisorLock()
  }
}
