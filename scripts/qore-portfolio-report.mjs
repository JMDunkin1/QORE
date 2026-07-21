#!/usr/bin/env node
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { Resvg } from '@resvg/resvg-js'
import { loadLocalEnv } from './local-env.mjs'
import {
  buildPortfolioReport,
  latestCompletedMarketSessionDate,
  renderPortfolioReportSvg,
  reportCaption,
} from './lib/qore-portfolio-report.mjs'
import { deliverPortfolioReport, enabledDestinations } from './lib/qore-report-delivery.mjs'
import {
  deferredDestinationIds,
  deliveryEntriesForKey,
  sentDestinationIds,
  uncertainDestinationIds,
  updateDeliveryLedger,
} from './lib/qore-report-ledger.mjs'
import { resolveLiveWeatherPaths } from './lib/qore-live-paths.mjs'
import { redactSecretText } from './lib/secret-redaction.mjs'

const repoDir = path.resolve(process.env.QORE_REPO_DIR ?? process.cwd())
loadLocalEnv(repoDir)

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const configPath = path.resolve(
  repoDir,
  argValue('--config') ?? process.env.QORE_REPORT_CONFIG ?? path.join('config', 'qore-portfolio-reports.json'),
)
const config = readJson(configPath, 'portfolio report config')
validateConfig(config)
const cadence = normalizedCadence(argValue('--cadence') ?? config?.report?.defaultCadence ?? 'daily')
const send = args.has('--send') || args.has('--scheduled') || args.has('--loop')
const scheduled = args.has('--scheduled') || args.has('--loop')
const loop = args.has('--loop')
const force = args.has('--force')
const refresh = args.has('--refresh') || (send && !force)
const jsonOutput = args.has('--json')
const periodEndArgumentPresent = rawArgs.includes('--period-end') || rawArgs.some((arg) => arg.startsWith('--period-end='))
const requestedPeriodEnd = argValue('--period-end') ?? null
const timeZone = String(config?.report?.timeZone ?? 'America/New_York')
const outputRoot = path.resolve(repoDir, config?.report?.outputDirectory ?? path.join('.local', 'qore', 'portfolio-reports'))
assertSafeOutputRoot(outputRoot)
const lockPath = path.join(outputRoot, 'operation.lock')
const ledgerPath = path.join(outputRoot, 'deliveries.json')
const statusPath = path.join(outputRoot, 'status.json')
const brokerDir = path.resolve(process.env.QORE_BROKER_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'broker'))
const accountStatusPath = path.resolve(
  process.env.QORE_BROKER_ACCOUNT_STATUS_FILE ?? path.join(brokerDir, 'account-status.json'),
)
const { stateDir: liveWeatherDir, operatorStatePath } = resolveLiveWeatherPaths(repoDir)
const signalPath = path.resolve(
  process.env.QORE_LIVE_SIGNAL_INTENT_FILE ?? path.join(liveWeatherDir, 'signal-intent-reconcile.json'),
)
const riskPath = path.resolve(
  process.env.QORE_LIVE_RISK_STATE_FILE ?? path.join(liveWeatherDir, 'risk-and-kill-switch-state.json'),
)
const basketPath = path.resolve(repoDir, 'data', 'qore', 'market', 'index-basket-config.json')
const brokerScript = path.join(repoDir, 'scripts', 'qore-alpaca-broker.mjs')
const secretValues = [
  process.env.QORE_REPORT_DISCORD_WEBHOOK_URL,
  process.env.QORE_REPORT_TELEGRAM_BOT_TOKEN,
  process.env.QORE_REPORT_TELEGRAM_CHAT_ID,
  process.env.QORE_REPORT_RESEND_API_KEY,
  process.env.QORE_REPORT_EMAIL_FROM,
  process.env.QORE_REPORT_EMAIL_TO,
  process.env.QORE_ALPACA_API_KEY_ID,
  process.env.QORE_ALPACA_API_SECRET_KEY,
  process.env.APCA_API_KEY_ID,
  process.env.APCA_API_SECRET_KEY,
  process.env.ALPACA_API_KEY_ID,
  process.env.ALPACA_API_KEY,
  process.env.ALPACA_API_SECRET_KEY,
  process.env.ALPACA_SECRET_KEY,
].filter(Boolean)

let activeLockRelease = null
let stopping = false
let wakeLoopDelay = null

function argValue(name) {
  const inline = rawArgs.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = rawArgs.indexOf(name)
  return index >= 0 ? rawArgs[index + 1] : null
}

function normalizedCadence(value) {
  const normalized = String(value ?? '').toLowerCase()
  if (!['daily', 'weekly'].includes(normalized)) throw new Error(`Unsupported report cadence "${value}".`)
  return normalized
}

function positiveInteger(value, fallback) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback
}

function normalizeReportMode(value) {
  const normalized = String(value ?? '').toLowerCase()
  if (!['dry-run', 'paper', 'live'].includes(normalized)) throw new Error(`Unsupported report mode "${value}".`)
  return normalized
}

function reportModeFromEnvironment() {
  if (!process.env.QORE_BROKER_MODE) {
    throw new Error('External report delivery requires an explicit QORE_BROKER_MODE.')
  }
  return normalizeReportMode(process.env.QORE_BROKER_MODE)
}

function validateConfig(candidate) {
  if (candidate?.serviceId !== 'qore-portfolio-reports-config-v1') {
    throw new Error('Portfolio report config requires serviceId qore-portfolio-reports-config-v1.')
  }
  normalizedCadence(candidate?.report?.defaultCadence ?? 'daily')
  const zone = String(candidate?.report?.timeZone ?? 'America/New_York')
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date()) } catch {
    throw new Error(`Portfolio report timeZone "${zone}" is invalid.`)
  }
  for (const [field, fallback] of [['maxTelemetryAgeHours', 36], ['maxRuntimeStateAgeHours', 6]]) {
    const numeric = Number(candidate?.report?.[field] ?? fallback)
    if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${field} must be positive.`)
  }
  const pollIntervalMs = Number(candidate?.scheduler?.pollIntervalMs ?? 60_000)
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 10_000) {
    throw new Error('scheduler.pollIntervalMs must be an integer of at least 10000.')
  }
  const ids = new Set()
  for (const schedule of Array.isArray(candidate?.schedules) ? candidate.schedules : []) {
    const id = String(schedule?.id ?? '').trim()
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Every report schedule requires a lowercase id.')
    if (ids.has(id)) throw new Error(`Duplicate report schedule id "${id}".`)
    ids.add(id)
    normalizedCadence(schedule?.cadence)
    if (!Array.isArray(schedule?.weekdays) || !schedule.weekdays.length
        || schedule.weekdays.some((value) => !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 6)) {
      throw new Error(`Schedule ${id} weekdays must contain integers from 0 through 6.`)
    }
    const hour = Number(schedule?.hour)
    const minute = Number(schedule?.minute)
    const windowMinutes = Number(schedule?.deliveryWindowMinutes)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new Error(`Schedule ${id} requires a valid hour and minute.`)
    }
    if (!Number.isInteger(windowMinutes) || windowMinutes <= 0 || hour * 60 + minute + windowMinutes >= 1_440) {
      throw new Error(`Schedule ${id} deliveryWindowMinutes must be positive and remain within its local calendar day.`)
    }
    if (windowMinutes * 60_000 < pollIntervalMs + 60_000) {
      throw new Error(`Schedule ${id} deliveryWindowMinutes must exceed scheduler.pollIntervalMs by at least one minute.`)
    }
  }
  enabledDestinations(candidate)
}

function pathWithin(parent, candidate) {
  const relativePath = path.relative(parent, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function assertSafeOutputRoot(candidate) {
  const allowedRoot = path.join(repoDir, '.local', 'qore', 'portfolio-reports')
  if (!pathWithin(allowedRoot, candidate)) {
    throw new Error(`Portfolio report outputDirectory must stay within ${relative(allowedRoot)}.`)
  }
  assertNoSymlinkComponents(candidate)
}

function assertNoSymlinkComponents(candidate) {
  const resolved = path.resolve(candidate)
  const { root } = path.parse(resolved)
  let current = root
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Portfolio report path must not contain a symbolic link: ${current}.`)
    }
  }
}

function readJson(filePath, label, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (fallback !== undefined && error?.code === 'ENOENT') return fallback
    throw new Error(`Could not read ${label} at ${relative(filePath)}: ${error.message}`)
  }
}

function relative(filePath) {
  return path.relative(repoDir, filePath)
}

async function ensurePrivateDirectory(directory) {
  assertNoSymlinkComponents(directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  assertNoSymlinkComponents(directory)
  await chmod(directory, 0o700)
}

async function writePrivateFile(filePath, contents) {
  await ensurePrivateDirectory(path.dirname(filePath))
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporaryPath, contents, { mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, filePath)
    await chmod(filePath, 0o600)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

async function writePrivateJson(filePath, value) {
  await writePrivateFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function acquireReportLock(operation) {
  await ensurePrivateDirectory(outputRoot)
  const lock = {
    pid: process.pid,
    token: crypto.randomBytes(16).toString('hex'),
    acquiredAt: new Date().toISOString(),
    operation,
  }
  try {
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const existing = readJson(lockPath, 'report operation lock', {})
    throw new Error(
      `Report operation lock is held by PID ${existing?.pid ?? 'unknown'} at ${relative(lockPath)}. `
      + 'QORE never reclaims report locks automatically; verify the owner before removing it.',
    )
  }
  const release = async () => {
    try {
      const current = readJson(lockPath, 'report operation lock', {})
      if (current?.pid === lock.pid && current?.token === lock.token) await rm(lockPath, { force: true })
    } catch {
      // Never remove a lock whose ownership can no longer be proven.
    }
  }
  activeLockRelease = release
  return release
}

function boundedOutput(value, maxLength = 12_000) {
  const text = String(value ?? '')
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
}

async function refreshBrokerStatus() {
  const timeoutMs = positiveInteger(process.env.QORE_REPORT_BROKER_REFRESH_TIMEOUT_MS, 60_000)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [brokerScript, '--status'], {
      cwd: repoDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3_000).unref()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout = boundedOutput(stdout + chunk) })
    child.stderr.on('data', (chunk) => { stderr = boundedOutput(stderr + chunk) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve()
      else {
        const detail = redactSecretText(stderr || stdout, secretValues).trim()
        reject(new Error(`Read-only Alpaca status refresh failed (${code ?? signal ?? 'unknown'}): ${detail || 'no diagnostic output'}`))
      }
    })
  })
}

function assertFreshAccountStatus(accountStatus) {
  const maxAgeHours = Number(config?.report?.maxTelemetryAgeHours ?? 36)
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error('maxTelemetryAgeHours must be positive.')
  if (accountStatus?.serviceId !== 'qore-alpaca-broker-status') {
    throw new Error('Alpaca account-status telemetry has an invalid service identity.')
  }
  for (const [label, value] of [
    ['Alpaca account-status telemetry', accountStatus?.sourceGeneratedAt ?? accountStatus?.generatedAt],
    ['Alpaca portfolio-history telemetry', accountStatus?.portfolioHistory?.generatedAt],
    ['Alpaca benchmark-history telemetry', accountStatus?.benchmarkHistory?.generatedAt],
    ['Alpaca market-calendar telemetry', accountStatus?.marketCalendar?.generatedAt],
  ]) {
    const timestamp = Date.parse(value)
    const ageHours = (Date.now() - timestamp) / 3_600_000
    if (!Number.isFinite(timestamp)) throw new Error(`${label} has no valid source timestamp.`)
    if (ageHours < -0.25) throw new Error(`${label} is materially future-dated.`)
    if (ageHours > maxAgeHours) {
      throw new Error(`${label} is ${ageHours.toFixed(1)} hours old; cap is ${maxAgeHours} hours.`)
    }
  }
}

function accountBinding(accountStatus) {
  const existing = String(accountStatus?.accountBinding ?? '').trim()
  return /^[a-f0-9]{24}$/.test(existing) ? existing : null
}

function reportDeliveryKey(report, binding) {
  return `${report.mode}:${binding}:${report.cadence}:${report.period.endDate}`
}

function assertReusableReport(stored, current) {
  if (stored?.schemaVersion !== 1 || stored?.serviceId !== 'qore-portfolio-report'
      || stored?.mode !== current.mode || stored?.cadence !== current.cadence
      || stored?.period?.startDate !== current.period.startDate
      || stored?.period?.endDate !== current.period.endDate) {
    throw new Error('Stored canonical report metadata is inconsistent; preserve and manually quarantine this delivery state before further action.')
  }
}

async function generateReport(selectedCadence, {
  allowSend = send,
  scheduleRun = null,
} = {}) {
  const release = await acquireReportLock(`${selectedCadence}${allowSend ? '-send' : '-preview'}`)
  const startedAt = new Date().toISOString()
  try {
    if (refresh) await refreshBrokerStatus()
    const accountStatus = readJson(accountStatusPath, 'Alpaca account status')
    assertFreshAccountStatus(accountStatus)
    const binding = accountBinding(accountStatus)
    if (allowSend && !binding) {
      throw new Error('External report delivery requires the canonical Alpaca account binding; refresh broker status first.')
    }
    if (allowSend && reportModeFromEnvironment() !== normalizeReportMode(accountStatus?.mode)) {
      throw new Error(`Report mode ${accountStatus?.mode} does not match configured broker mode ${process.env.QORE_BROKER_MODE}.`)
    }
    const scheduleRunKey = scheduleRun
      ? `${accountStatus.mode}:${binding}:${scheduleRun.id}:${scheduleRun.localDate}`
      : null
    if (scheduleRunKey) {
      const scheduleLedger = readJson(ledgerPath, 'report delivery ledger', { scheduleRuns: {} })
      if (scheduleLedger?.scheduleRuns?.[scheduleRunKey]?.status === 'complete') {
        return { scheduleId: scheduleRun.id, cadence: selectedCadence, alreadyComplete: true }
      }
    }
    const signalSnapshot = readJson(signalPath, 'signal intent', null)
    const riskSnapshot = readJson(riskPath, 'risk state', null)
    const operatorSnapshot = readJson(operatorStatePath, 'operator state', null)
    const reportRiskSnapshot = {
      ...(riskSnapshot ?? {}),
      operator: operatorSnapshot
        ? { ...(riskSnapshot?.operator ?? {}), ...operatorSnapshot, source: 'operator-state-file-direct-report-read' }
        : null,
    }
    const basketConfig = readJson(basketPath, 'index basket config')
    let report = buildPortfolioReport({
      accountStatus,
      signalSnapshot,
      riskSnapshot: reportRiskSnapshot,
      basketConfig,
      cadence: selectedCadence,
      generatedAt: new Date().toISOString(),
      timeZone,
      maxRuntimeStateAgeHours: Number(config?.report?.maxRuntimeStateAgeHours ?? 6),
      dedicatedQoreAccount: config?.report?.dedicatedQoreAccount === true,
      periodEnd: requestedPeriodEnd,
    })
    if (allowSend && requestedPeriodEnd === null) {
      const expectedPeriodEnd = latestCompletedMarketSessionDate(accountStatus, report.generatedAt)
      if (!expectedPeriodEnd) throw new Error('No completed market session is available for report delivery.')
      if (report.period.endDate !== expectedPeriodEnd) {
        throw new Error(
          `${report.cadence} report period ${report.period.endDate} is not ready for completed session ${expectedPeriodEnd}; delivery was deferred.`,
        )
      }
    }
    const key = reportDeliveryKey(report, binding ?? 'unbound')
    const forceRunId = force ? `force-${Date.now()}-${crypto.randomBytes(4).toString('hex')}` : null
    let attempts = []
    let skippedDestinations = []
    let deferredDestinations = []
    let uncertainDestinations = []
    let destinations = []
    let ledger = null
    let priorEntries = []
    let alreadySent = new Set()
    let deferred = new Set()
    let uncertain = new Set()
    let forceResolutionIds = new Set()
    let forcePriorUncertainIds = new Set()
    let resolvingCanonicalDelivery = false
    let deliverySkipIds = new Set()
    let png = null
    let summaryBytes = null
    let reusedArtifact = false

    if (allowSend) {
      if (process.env.QORE_REPORT_SEND_ENABLED !== '1') {
        throw new Error('External report delivery requires QORE_REPORT_SEND_ENABLED=1.')
      }
      if (!binding) throw new Error('External report delivery requires a stable sanitized Alpaca account binding; refresh broker status first.')
      destinations = enabledDestinations(config)
      if (!destinations.length) throw new Error('External report delivery requires at least one enabled destination.')
      ledger = readJson(ledgerPath, 'report delivery ledger', {
        schemaVersion: 1,
        serviceId: 'qore-portfolio-report-deliveries',
        deliveries: {},
      })
      priorEntries = deliveryEntriesForKey(ledger, key)
      if (force && priorEntries.length === 0) {
        throw new Error('--force requires existing canonical delivery state for this account and market period.')
      }
      const canonicalSent = sentDestinationIds(ledger, key)
      forcePriorUncertainIds = uncertainDestinationIds(ledger, key)
      if (force && priorEntries.length) {
        forceResolutionIds = new Set(destinations
          .filter((destination) => !canonicalSent.has(destination.id))
          .map((destination) => destination.id))
        resolvingCanonicalDelivery = forceResolutionIds.size > 0
      }
      if (requestedPeriodEnd !== null && !resolvingCanonicalDelivery) {
        throw new Error('--period-end requires at least one unresolved canonical destination for the selected period.')
      }
      alreadySent = force && !resolvingCanonicalDelivery ? new Set() : canonicalSent
      deferred = force ? new Set() : deferredDestinationIds(ledger, key)
      uncertain = force ? new Set() : uncertainDestinationIds(ledger, key)
      deliverySkipIds = resolvingCanonicalDelivery
        ? new Set(alreadySent)
        : new Set([...alreadySent, ...deferred, ...uncertain])
      skippedDestinations = destinations.filter((destination) => alreadySent.has(destination.id)).map((destination) => destination.id)
      deferredDestinations = destinations.filter((destination) => deferred.has(destination.id)).map((destination) => destination.id)
      uncertainDestinations = destinations.filter((destination) => uncertain.has(destination.id)).map((destination) => destination.id)
    }

    const canonicalPeriodDirectory = path.join(
      outputRoot,
      allowSend ? 'deliveries' : 'previews',
      report.mode,
      `account-${binding ?? 'unbound'}`,
      report.cadence,
      report.period.endDate,
    )
    const periodDirectory = forceRunId && !resolvingCanonicalDelivery
      ? path.join(canonicalPeriodDirectory, 'forced', forceRunId)
      : canonicalPeriodDirectory
    const svgPath = path.join(periodDirectory, 'report.svg')
    const pngPath = path.join(periodDirectory, 'report.png')
    const summaryPath = path.join(periodDirectory, 'summary.json')

    if (allowSend) {
      const reusableEntries = !force || resolvingCanonicalDelivery ? priorEntries : []
      if (reusableEntries.length) {
        if (![svgPath, pngPath, summaryPath].every((filePath) => existsSync(filePath))) {
          throw new Error('A canonical delivery artifact is missing; preserve and manually quarantine this delivery state before further action.')
        }
        summaryBytes = await readFile(summaryPath)
        let storedReport
        try {
          storedReport = JSON.parse(summaryBytes.toString('utf8'))
        } catch (error) {
          throw new Error(`Could not read stored partial-delivery report at ${relative(summaryPath)}: ${error.message}`)
        }
        assertReusableReport(storedReport, report)
        const storedPng = await readFile(pngPath)
        const storedHash = crypto.createHash('sha256').update(storedPng).digest('hex')
        const storedSummaryHash = crypto.createHash('sha256').update(summaryBytes).digest('hex')
        if (reusableEntries.some((entry) => entry?.artifactSha256 !== storedHash)) {
          throw new Error('The canonical report PNG hash does not match its ledger; preserve and manually quarantine this delivery state.')
        }
        if (reusableEntries.some((entry) => entry?.summarySha256 !== storedSummaryHash)) {
          throw new Error('The canonical report summary hash does not match its ledger; preserve and manually quarantine this delivery state.')
        }
        report = storedReport
        png = storedPng
        reusedArtifact = true
      }
    }

    if (!png) {
      const svg = renderPortfolioReportSvg(report)
      if (/\b(?:NaN|Infinity|undefined)\b/.test(svg)) throw new Error('Report renderer produced an invalid numeric value.')
      png = new Resvg(svg, {
        fitTo: { mode: 'width', value: 1600 },
        font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans Mono' },
      }).render().asPng()
      summaryBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8')
      await writePrivateFile(svgPath, svg)
      await writePrivateFile(pngPath, png)
      await writePrivateFile(summaryPath, summaryBytes)
    }
    const artifactSha256 = crypto.createHash('sha256').update(png).digest('hex')
    const summarySha256 = crypto.createHash('sha256').update(summaryBytes).digest('hex')

    if (allowSend) {
      const providerDeliveryKey = force && !resolvingCanonicalDelivery
        ? `${key}:${forceRunId}`
        : key
      const pendingStartedAt = new Date().toISOString()
      const pendingAttempts = destinations
        .filter((destination) => !deliverySkipIds.has(destination.id))
        .map((destination) => ({
          id: destination.id,
          type: destination.type,
          status: 'uncertain',
          startedAt: pendingStartedAt,
          finishedAt: pendingStartedAt,
          error: 'Delivery started; final provider acknowledgement was not recorded.',
          retryAfterSeconds: null,
        }))
      if (pendingAttempts.length) {
        ledger = updateDeliveryLedger(ledger, key, pendingAttempts, artifactSha256, summarySha256, report, {
          forced: force,
          forceRunId,
          reconcileCanonicalIds: forceResolutionIds,
          preserveCanonicalUncertainIds: forcePriorUncertainIds,
        })
        await writePrivateJson(ledgerPath, ledger)
      }
      attempts = await deliverPortfolioReport({
        config,
        artifactPath: pngPath,
        artifactBytes: png,
        filename: `qore-${report.mode}-${report.cadence}-${report.period.endDate}.png`,
        caption: reportCaption(report),
        deliveryKey: providerDeliveryKey,
        skipDestinationIds: deliverySkipIds,
      })
      const nextLedger = updateDeliveryLedger(ledger, key, attempts, artifactSha256, summarySha256, report, {
        forced: force,
        forceRunId,
        reconcileCanonicalIds: forceResolutionIds,
        preserveCanonicalUncertainIds: forcePriorUncertainIds,
      })
      deferred = deferredDestinationIds(nextLedger, key)
      uncertain = uncertainDestinationIds(nextLedger, key)
      deferredDestinations = destinations.filter((destination) => deferred.has(destination.id)).map((destination) => destination.id)
      uncertainDestinations = destinations.filter((destination) => uncertain.has(destination.id)).map((destination) => destination.id)
      const canonicalSent = sentDestinationIds(nextLedger, key)
      const allDestinationsCovered = destinations.every((destination) => canonicalSent.has(destination.id))
      if (scheduleRunKey && allDestinationsCovered) {
        nextLedger.scheduleRuns[scheduleRunKey] = {
          status: 'complete',
          cadence: report.cadence,
          periodEnd: report.period.endDate,
          completedAt: new Date().toISOString(),
        }
      }
      await writePrivateJson(ledgerPath, nextLedger)
    }

    const result = {
      generatedAt: report.generatedAt,
      cadence: report.cadence,
      period: report.period,
      mode: report.mode,
      equityUsd: report.account.equityUsd,
      pnlUsd: report.account.pnlUsd,
      returnPct: report.account.returnPct,
      basketReturnPct: report.benchmark.basket.returnPct,
      relativePctPoints: report.relative.pctPoints,
      relativeUsd: report.relative.usd,
      files: {
        png: relative(pngPath),
        svg: relative(svgPath),
        summary: relative(summaryPath),
      },
      deliveries: attempts,
      skippedDestinations,
      deferredDestinations,
      uncertainDestinations,
      reusedArtifact,
    }
    await writePrivateJson(statusPath, {
      serviceId: 'qore-portfolio-report-status',
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: attempts.every((attempt) => attempt.status === 'sent')
        && deferredDestinations.length === 0
        && uncertainDestinations.length === 0,
      ...result,
    })
    return result
  } catch (error) {
    await writePrivateJson(statusPath, {
      serviceId: 'qore-portfolio-report-status',
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      cadence: selectedCadence,
      error: redactSecretText(error?.message ?? String(error), secretValues).slice(0, 1000),
    }).catch(() => {})
    throw error
  } finally {
    await release()
    if (activeLockRelease === release) activeLockRelease = null
  }
}

function zonedScheduleParts(date, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
  return {
    weekday,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
    date: `${values.year}-${values.month}-${values.day}`,
  }
}

function dueScheduleRuns(now = new Date(), since = null) {
  const schedules = (Array.isArray(config?.schedules) ? config.schedules : [])
    .filter((schedule) => schedule?.enabled === true)
  const runs = new Map()
  const inspect = (instant) => {
    const { weekday, minuteOfDay, date } = zonedScheduleParts(instant, timeZone)
    for (const schedule of schedules) {
      const weekdays = Array.isArray(schedule?.weekdays) ? schedule.weekdays.map(Number) : []
      const scheduledMinute = Number(schedule?.hour) * 60 + Number(schedule?.minute)
      const windowMinutes = positiveInteger(schedule?.deliveryWindowMinutes, 180)
      if (weekdays.includes(weekday)
          && Number.isInteger(scheduledMinute)
          && minuteOfDay >= scheduledMinute
          && minuteOfDay <= scheduledMinute + windowMinutes) {
        runs.set(schedule.id, { schedule, localDate: date })
      }
    }
  }
  if (since instanceof Date && Number.isFinite(since.getTime()) && since < now) {
    const maxWindowMinutes = Math.max(1, ...schedules.map((schedule) => positiveInteger(schedule?.deliveryWindowMinutes, 180)))
    const pollIntervalMs = positiveInteger(config?.scheduler?.pollIntervalMs, 60_000)
    const boundedSince = Math.max(since.getTime(), now.getTime() - maxWindowMinutes * 60_000 - pollIntervalMs)
    const firstMinute = Math.floor(boundedSince / 60_000) * 60_000 + 60_000
    for (let timestamp = firstMinute; timestamp <= now.getTime(); timestamp += 60_000) {
      inspect(new Date(timestamp))
    }
  }
  inspect(now)
  return [...runs.values()]
}

async function runScheduledCycle({ now = new Date(), since = null } = {}) {
  const scheduleRuns = dueScheduleRuns(now, since)
  const results = []
  for (const { schedule, localDate } of scheduleRuns) {
    const scheduleCadence = normalizedCadence(schedule.cadence)
    try {
      const result = await generateReport(scheduleCadence, {
        allowSend: true,
        scheduleRun: { id: schedule.id, localDate },
      })
      if (!result?.alreadyComplete) results.push(result)
    } catch (error) {
      results.push({
        scheduleId: schedule.id,
        cadence: scheduleCadence,
        error: redactSecretText(error?.message ?? String(error), secretValues).slice(0, 1000),
        deliveries: [],
        skippedDestinations: [],
        deferredDestinations: [],
        uncertainDestinations: [],
      })
    }
  }
  return results
}

function printResult(result) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (Array.isArray(result)) {
    if (!result.length) console.log('No portfolio report schedule is due.')
    else result.forEach(printResult)
    return
  }
  if (result.error) {
    console.error(`Schedule ${result.scheduleId ?? result.cadence} deferred: ${result.error}`)
    return
  }
  const relation = result.relativePctPoints > 0 ? 'ahead' : result.relativePctPoints < 0 ? 'behind' : 'even'
  console.log(
    `QORE ${result.cadence} report: equity $${result.equityUsd.toLocaleString('en-US')}; `
    + `${result.returnPct >= 0 ? '+' : ''}${result.returnPct.toFixed(2)}%; ${relation} of the index basket by ${Math.abs(result.relativePctPoints).toFixed(2)} pp.`,
  )
  console.log(`Wrote ${result.files.png}.`)
  for (const delivery of result.deliveries) {
    const label = delivery.status === 'sent' ? 'Sent' : delivery.status === 'uncertain' ? 'Uncertain' : 'Failed'
    console.log(`${label} ${delivery.id}${delivery.error ? `: ${delivery.error}` : ''}.`)
  }
  for (const id of result.skippedDestinations) console.log(`Skipped ${id}; this market period was already delivered.`)
  for (const id of result.deferredDestinations) console.log(`Deferred ${id}; the provider retry-after window is still active.`)
  for (const id of result.uncertainDestinations) console.log(`Held ${id}; prior non-idempotent delivery outcome is uncertain and requires reviewed --force.`)
}

function stop(signal) {
  if (stopping) return
  stopping = true
  wakeLoopDelay?.()
  process.exitCode = signal ? 0 : process.exitCode
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stop(signal) })
}

async function loopDelay(delayMs) {
  if (stopping) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeLoopDelay = null
      resolve()
    }, delayMs)
    wakeLoopDelay = () => {
      clearTimeout(timer)
      wakeLoopDelay = null
      resolve()
    }
  })
}

try {
  if (force && scheduled) throw new Error('--force cannot be combined with --scheduled or --loop.')
  if (force && !args.has('--send')) throw new Error('--force requires an explicit --send run.')
  if (periodEndArgumentPresent && !requestedPeriodEnd) throw new Error('--period-end requires a YYYY-MM-DD value.')
  if (requestedPeriodEnd !== null && (!force || !args.has('--send'))) {
    throw new Error('--period-end is only available with an explicit --send --force recovery run.')
  }
  if (send) reportModeFromEnvironment()
  if (loop) {
    if (process.env.QORE_REPORT_SEND_ENABLED !== '1') throw new Error('Report loop requires QORE_REPORT_SEND_ENABLED=1.')
    if (!enabledDestinations(config).length) throw new Error('Report loop requires at least one enabled destination.')
    const pollIntervalMs = positiveInteger(config?.scheduler?.pollIntervalMs, 60_000)
    console.log(`QORE portfolio report scheduler running in ${timeZone}; polling every ${pollIntervalMs}ms.`)
    let lastScheduleCheckAt = null
    while (!stopping) {
      const cycleCheckAt = new Date()
      try {
        const results = await runScheduledCycle({ now: cycleCheckAt, since: lastScheduleCheckAt })
        if (results.length) printResult(results)
      } catch (error) {
        console.error(redactSecretText(error?.message ?? String(error), secretValues))
      }
      lastScheduleCheckAt = cycleCheckAt
      const nextCheckAt = cycleCheckAt.getTime() + pollIntervalMs
      await loopDelay(Math.max(0, nextCheckAt - Date.now()))
    }
  } else {
    const result = args.has('--scheduled') ? await runScheduledCycle() : await generateReport(cadence)
    printResult(result)
    const entries = Array.isArray(result) ? result : [result]
    const deliveries = entries.flatMap((entry) => entry.deliveries ?? [])
    if (entries.some((entry) => entry.error || entry.deferredDestinations?.length || entry.uncertainDestinations?.length)
        || deliveries.some((delivery) => delivery.status !== 'sent')) process.exitCode = 1
  }
} catch (error) {
  console.error(`Portfolio report failed: ${redactSecretText(error?.message ?? String(error), secretValues)}`)
  process.exitCode = 1
}
