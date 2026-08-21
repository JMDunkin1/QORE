#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'
import { resolveLiveWeatherPaths } from './lib/qore-live-paths.mjs'

const repoDir = path.resolve(process.env.QORE_REPO_DIR ?? process.cwd())
const snapshotOnly = process.argv.slice(2).includes('--snapshot-json')
try {
  loadLocalEnv(repoDir)
} catch (error) {
  if (!snapshotOnly || error?.code !== 'EACCES') throw error
  // The read-only SSH bridge intentionally runs without access to broker secrets.
  // Inherited environment values and the default .local paths remain sufficient
  // for a sanitized telemetry snapshot.
}

const host = '127.0.0.1'
const port = validPort(process.env.QORE_DASHBOARD_SERVICE_PORT ?? process.env.QORE_API_PORT) ?? 4775
const staleAfterMs = positiveNumber(process.env.QORE_DASHBOARD_STALE_AFTER_MS, 15 * 60 * 1000)
const brokerFutureToleranceMs = positiveNumber(
  process.env.QORE_DASHBOARD_BROKER_MAX_FUTURE_SKEW_SECONDS
    ?? process.env.QORE_ALPACA_CLOCK_MAX_FUTURE_SKEW_SECONDS,
  5,
) * 1000
const clockMaxAgeMs = positiveNumber(process.env.QORE_ALPACA_CLOCK_MAX_AGE_SECONDS, 30) * 1000
const clockFutureToleranceMs = positiveNumber(process.env.QORE_ALPACA_CLOCK_MAX_FUTURE_SKEW_SECONDS, 5) * 1000
const riskStaleAfterMs = positiveNumber(process.env.QORE_LIVE_MAX_RISK_SNAPSHOT_AGE_SECONDS, 15 * 60) * 1000
const riskFutureToleranceMs = positiveNumber(process.env.QORE_LIVE_MAX_RISK_SNAPSHOT_FUTURE_SKEW_SECONDS, 30) * 1000
const refreshMinIntervalMs = positiveNumber(process.env.QORE_DASHBOARD_REFRESH_MIN_INTERVAL_MS, 10_000)
const refreshTimeoutMs = positiveNumber(process.env.QORE_DASHBOARD_REFRESH_TIMEOUT_MS, 45_000)
const { stateDir: liveWeatherDir, operatorStatePath } = resolveLiveWeatherPaths(repoDir)
const brokerDir = path.resolve(process.env.QORE_BROKER_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'broker'))
const supervisorDir = path.resolve(
  process.env.QORE_LIVE_SUPERVISOR_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'live-trading-supervisor'),
)
const sourcePaths = {
  brokerAccountStatus: path.resolve(process.env.QORE_BROKER_ACCOUNT_STATUS_FILE ?? path.join(brokerDir, 'account-status.json')),
  brokerStatus: path.resolve(process.env.QORE_BROKER_STATUS_FILE ?? path.join(brokerDir, 'status.json')),
  brokerSnapshot: path.resolve(process.env.QORE_BROKER_ACCOUNT_SNAPSHOT_FILE ?? path.join(brokerDir, 'account-snapshot.json')),
  brokerOrderHistory: path.resolve(process.env.QORE_BROKER_ORDER_HISTORY_FILE ?? path.join(brokerDir, 'order-history.json')),
  liveWeatherStatus: path.resolve(process.env.QORE_LIVE_WEATHER_STATUS_FILE ?? path.join(liveWeatherDir, 'status.json')),
  signalIntent: path.resolve(process.env.QORE_LIVE_SIGNAL_INTENT_FILE ?? path.join(liveWeatherDir, 'signal-intent-reconcile.json')),
  riskState: path.resolve(process.env.QORE_LIVE_RISK_STATE_FILE ?? path.join(liveWeatherDir, 'risk-and-kill-switch-state.json')),
  operatorState: operatorStatePath,
  inference: path.resolve(
    process.env.QORE_LIVE_INFERENCE_FILE ?? path.join(repoDir, '.local', 'qore', 'live-inference', 'all-year-target.json'),
  ),
  supervisor: path.resolve(process.env.QORE_LIVE_SUPERVISOR_STATUS_FILE ?? path.join(supervisorDir, 'status.json')),
}
const brokerScript = path.join(repoDir, 'scripts', 'qore-alpaca-broker.mjs')
const configuredOrigins = String(process.env.QORE_DASHBOARD_SERVICE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const allowedOrigins = new Set(configuredOrigins.filter(isLocalOrigin))
const maxDiagnosticMessageCount = 32
const maxDiagnosticMessageLength = 240
const maxSnapshotBytes = 512 * 1024
const maxPositions = 64
const maxOpenOrders = 256
const maxPortfolioHistoryPoints = 1500
const maxSupervisorJobs = 64
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

let activeRefresh = null
let activeRefreshChild = null
let lastRefreshFinishedAt = 0
let lastRefreshError = null

function validPort(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 && numeric < 65536 ? numeric : null
}

function positiveNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean' || typeof value === 'object') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function roundedNumber(value, digits = 4) {
  const numeric = finiteNumber(value)
  if (numeric === null) return null
  const factor = 10 ** digits
  return Math.round(numeric * factor) / factor
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function safeText(value, maxLength = 500) {
  let text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim()
  for (const credential of credentialValues) text = text.split(credential).join('[redacted]')
  text = text
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:api[-_ ]?(?:key|secret)|token|password)\s*[:=]\s*)[^,;\s]+/gi, '$1[redacted]')
    .replace(/((?:["']?account(?:[_ -]?(?:id|number))["']?)\s*(?:[:=]|\bis\b|\s+)\s*)(?:"[^"]*"|'[^']*'|[^,;\s]+)/gi, '$1[redacted]')
    .replace(/https:\/\/([^:\s/@]+):([^@\s]+)@/gi, 'https://$1:[redacted]@')
  return text.slice(0, maxLength)
}

function safeString(value, maxLength = 160) {
  if (value === null || value === undefined || value === '') return null
  return safeText(value, maxLength) || null
}

function uniqueMessages(values, limit = maxDiagnosticMessageCount) {
  if (limit <= 0) return []
  const messages = []
  const seen = new Set()
  for (const group of values) {
    const candidates = Array.isArray(group) ? group : [group]
    for (const value of candidates) {
      const message = safeText(value, maxDiagnosticMessageLength)
      if (!message || seen.has(message)) continue
      seen.add(message)
      messages.push(message)
      if (messages.length >= limit) return messages
    }
  }
  return messages
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

function originAllowed(origin) {
  return !origin || (isLocalOrigin(origin) && allowedOrigins.has(origin))
}

async function readJsonSource(filePath) {
  try {
    const contents = await readFile(filePath, 'utf8')
    return { value: JSON.parse(contents), error: null }
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null, error: 'missing' }
    return { value: null, error: error instanceof SyntaxError ? 'invalid JSON' : 'unreadable' }
  }
}

function sourceIsFresh(generatedAt, futureToleranceMs = 5 * 60 * 1000) {
  const timestamp = Date.parse(generatedAt)
  return Number.isFinite(timestamp) && timestamp <= Date.now() + futureToleranceMs && Date.now() - timestamp <= staleAfterMs
}

function marketClockFreshness(clock) {
  if (!clock) return { fresh: false, reason: 'Market clock telemetry is unavailable.' }
  const hasCamelCaseFlag = Object.prototype.hasOwnProperty.call(clock, 'isOpen')
  const hasSnakeCaseFlag = Object.prototype.hasOwnProperty.call(clock, 'is_open')
  const camelCaseFlag = clock?.isOpen
  const snakeCaseFlag = clock?.is_open
  if (!hasCamelCaseFlag && !hasSnakeCaseFlag) {
    return { fresh: false, reason: 'Market clock telemetry is missing an exact boolean isOpen/is_open value.' }
  }
  if ((hasCamelCaseFlag && typeof camelCaseFlag !== 'boolean') || (hasSnakeCaseFlag && typeof snakeCaseFlag !== 'boolean')) {
    return { fresh: false, reason: 'Market clock telemetry isOpen/is_open must be an exact boolean.' }
  }
  if (hasCamelCaseFlag && hasSnakeCaseFlag && camelCaseFlag !== snakeCaseFlag) {
    return { fresh: false, reason: 'Market clock telemetry contains conflicting isOpen and is_open values.' }
  }
  const timestamp = Date.parse(clock?.timestamp)
  if (!Number.isFinite(timestamp)) {
    return { fresh: false, reason: 'Market clock telemetry has a missing or invalid timestamp.' }
  }
  const ageMs = Date.now() - timestamp
  const normalized = isoTimestamp(clock.timestamp) ?? 'an unknown time'
  if (ageMs < -clockFutureToleranceMs) {
    return { fresh: false, reason: `Market clock telemetry is future-dated (timestamp ${normalized}; tolerance ${clockFutureToleranceMs / 1000}s).` }
  }
  if (ageMs > clockMaxAgeMs) {
    return { fresh: false, reason: `Market clock telemetry is stale (timestamp ${normalized}; cap ${clockMaxAgeMs / 1000}s).` }
  }
  return { fresh: true, reason: null }
}

function timestampsMateriallyDiffer(left, right, toleranceMs = 5_000) {
  const leftTimestamp = Date.parse(left)
  const rightTimestamp = Date.parse(right)
  if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) return left !== right
  return Math.abs(leftTimestamp - rightTimestamp) > toleranceMs
}

function riskSnapshotFreshness(generatedAt) {
  const timestamp = Date.parse(generatedAt)
  if (!Number.isFinite(timestamp)) {
    return { fresh: false, reason: 'Risk and kill-switch telemetry has a missing or invalid generatedAt timestamp.' }
  }
  const ageMs = Date.now() - timestamp
  const normalized = isoTimestamp(generatedAt) ?? 'an unknown time'
  if (ageMs < -riskFutureToleranceMs) {
    return {
      fresh: false,
      reason: `Risk and kill-switch telemetry is future-dated (generated at ${normalized}; tolerance ${riskFutureToleranceMs / 1000}s).`,
    }
  }
  if (ageMs > riskStaleAfterMs) {
    return {
      fresh: false,
      reason: `Risk and kill-switch telemetry is stale (generated at ${normalized}; cap ${riskStaleAfterMs / 1000}s).`,
    }
  }
  return { fresh: true, reason: null }
}

function normalizedAccount(account, rawAccount) {
  if (!account) return null
  const equityUsd = roundedNumber(account?.equityUsd, 2)
  const dayPnlPct = roundedNumber(account?.dayPnlPct, 4)
  const reportedLastEquityUsd = roundedNumber(account?.lastEquityUsd, 2)
  const inferredLastEquityUsd = equityUsd !== null && dayPnlPct !== null && dayPnlPct > -100
    ? roundedNumber(equityUsd / (1 + dayPnlPct / 100), 2)
    : null
  const lastEquityUsd = reportedLastEquityUsd ?? inferredLastEquityUsd
  return {
    equityUsd,
    cashUsd: roundedNumber(account?.cashUsd, 2),
    lastEquityUsd,
    dayPnlUsd: roundedNumber(
      account?.dayPnlUsd ?? (equityUsd !== null && lastEquityUsd !== null ? equityUsd - lastEquityUsd : null),
      2,
    ),
    dayPnlPct,
    trailingDrawdownPct: roundedNumber(account?.trailingDrawdownPct, 4),
    buyingPowerUsd: roundedNumber(account?.buyingPowerUsd ?? rawAccount?.buyingPower, 2),
    status: safeString(account?.status ?? rawAccount?.status, 40),
    shortingEnabled: booleanOrNull(account?.shortingEnabled ?? rawAccount?.shortingEnabled),
  }
}

function successfulAccountGeneratedAt(candidate) {
  if (!candidate?.account) return null
  return isoTimestamp(candidate?.sourceGeneratedAt)
    ?? (candidate?.brokerConnected === true ? isoTimestamp(candidate?.generatedAt) : null)
}

function normalizedBrokerMode(value) {
  const mode = safeString(value, 24)
  return ['dry-run', 'paper', 'live'].includes(mode) ? mode : null
}

function sourceMatchesMode(candidate, mode) {
  return mode !== null && normalizedBrokerMode(candidate?.mode) === mode
}

function newestAccountSource(...candidates) {
  return candidates
    .filter((candidate) => candidate?.account && successfulAccountGeneratedAt(candidate))
    .map((candidate, index) => ({
      candidate,
      index,
      timestamp: Date.parse(successfulAccountGeneratedAt(candidate)),
    }))
    .sort((left, right) => {
      const leftTimestamp = Number.isFinite(left.timestamp) ? left.timestamp : -Infinity
      const rightTimestamp = Number.isFinite(right.timestamp) ? right.timestamp : -Infinity
      return rightTimestamp - leftTimestamp || left.index - right.index
    })[0]?.candidate ?? null
}

function historyGeneratedAt(candidate) {
  if (!candidate?.portfolioHistory) return null
  return isoTimestamp(candidate.portfolioHistory?.sourceGeneratedAt ?? candidate.portfolioHistory?.generatedAt)
    ?? (candidate?.brokerConnected === true ? isoTimestamp(candidate?.generatedAt) : null)
}

function newestHistorySource(...candidates) {
  return candidates
    .filter((candidate) => candidate?.portfolioHistory && historyGeneratedAt(candidate))
    .map((candidate, index) => ({ candidate, index, timestamp: Date.parse(historyGeneratedAt(candidate)) }))
    .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)[0]?.candidate ?? null
}

function newestConnectionSource(...candidates) {
  return candidates
    .filter(Boolean)
    .map((candidate, index) => ({
      candidate,
      index,
      timestamp: Date.parse(candidate?.generatedAt ?? candidate?.sourceGeneratedAt),
    }))
    .sort((left, right) => {
      const leftTimestamp = Number.isFinite(left.timestamp) ? left.timestamp : -Infinity
      const rightTimestamp = Number.isFinite(right.timestamp) ? right.timestamp : -Infinity
      return rightTimestamp - leftTimestamp || left.index - right.index
    })[0]?.candidate ?? null
}

function normalizedPosition(position) {
  const rawPnlRatio = finiteNumber(position?.unrealized_plpc)
  return {
    symbol: safeString(position?.symbol, 24),
    side: safeString(position?.side, 16),
    quantity: roundedNumber(position?.quantity ?? position?.qty, 8),
    marketValueUsd: roundedNumber(position?.marketValueUsd ?? position?.market_value, 2),
    currentPriceUsd: roundedNumber(position?.currentPriceUsd ?? position?.current_price ?? position?.asset_current_price, 4),
    averageEntryPriceUsd: roundedNumber(
      position?.averageEntryPriceUsd ?? position?.avgEntryPriceUsd ?? position?.avg_entry_price,
      4,
    ),
    unrealizedPnlUsd: roundedNumber(position?.unrealizedPnlUsd ?? position?.unrealized_pl, 2),
    unrealizedPnlPct: roundedNumber(position?.unrealizedPnlPct ?? (rawPnlRatio === null ? null : rawPnlRatio * 100), 4),
  }
}

function normalizedOrder(order) {
  return {
    id: safeString(order?.id ?? order?.orderId, 80),
    clientOrderId: safeString(order?.clientOrderId ?? order?.client_order_id, 96),
    symbol: safeString(order?.symbol, 24),
    side: safeString(order?.side, 16),
    type: safeString(order?.type ?? order?.order_type, 24),
    status: safeString(order?.status, 32),
    timeInForce: safeString(order?.timeInForce ?? order?.time_in_force, 16),
    quantity: roundedNumber(order?.quantity ?? order?.qty, 8),
    notionalUsd: roundedNumber(order?.notionalUsd ?? order?.notional, 2),
    filledQuantity: roundedNumber(order?.filledQuantity ?? order?.filled_qty, 8),
    limitPriceUsd: roundedNumber(order?.limitPriceUsd ?? order?.limit_price, 4),
    stopPriceUsd: roundedNumber(order?.stopPriceUsd ?? order?.stop_price, 4),
    averageFillPriceUsd: roundedNumber(order?.averageFillPriceUsd ?? order?.filled_avg_price, 4),
    submittedAt: isoTimestamp(order?.submittedAt ?? order?.submitted_at),
    filledAt: isoTimestamp(order?.filledAt ?? order?.filled_at),
    canceledAt: isoTimestamp(order?.canceledAt ?? order?.canceled_at),
    updatedAt: isoTimestamp(order?.updatedAt ?? order?.updated_at),
  }
}

function normalizedMarketClock(clock) {
  if (!clock) return null
  return {
    isOpen: booleanOrNull(clock?.isOpen ?? clock?.is_open),
    timestamp: isoTimestamp(clock?.timestamp),
    nextOpen: isoTimestamp(clock?.nextOpen ?? clock?.next_open),
    nextClose: isoTimestamp(clock?.nextClose ?? clock?.next_close),
  }
}

function normalizedPortfolioHistory(history, sourceGeneratedAt = null) {
  if (!history) return { sourceGeneratedAt: null, baseValueUsd: null, baseValueAsOf: null, timeframe: '1D', points: [] }
  const baseValueUsd = roundedNumber(history?.baseValueUsd ?? history?.base_value, 2)
  const rawPoints = Array.isArray(history?.points)
    ? history.points
    : (Array.isArray(history?.timestamp) ? history.timestamp : []).map((timestamp, index) => ({
        timestamp,
        equityUsd: history?.equity?.[index],
        profitLossUsd: history?.profit_loss?.[index],
        profitLossPct: finiteNumber(history?.profit_loss_pct?.[index]) === null
          ? null
          : finiteNumber(history.profit_loss_pct[index]) * 100,
      }))
  const byTimestamp = new Map()
  for (const point of rawPoints) {
    const timestamp = isoTimestamp(point?.timestamp)
    const equityUsd = roundedNumber(point?.equityUsd, 2)
    if (!timestamp || equityUsd === null) continue
    byTimestamp.set(timestamp, {
      timestamp,
      equityUsd,
      profitLossUsd: roundedNumber(point?.profitLossUsd, 2),
      profitLossPct: roundedNumber(point?.profitLossPct, 4),
    })
  }
  return {
    sourceGeneratedAt: isoTimestamp(sourceGeneratedAt),
    baseValueUsd,
    baseValueAsOf: isoTimestamp(history?.baseValueAsOf ?? history?.base_value_asof),
    timeframe: safeString(history?.timeframe, 16) ?? '1D',
    points: [...byTimestamp.values()]
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .slice(-maxPortfolioHistoryPoints),
  }
}

function normalizedIntent(intent) {
  if (!intent) return null
  return {
    strategyId: safeString(intent?.strategyId, 80),
    strategyName: safeString(intent?.strategyName, 120),
    generatedAt: isoTimestamp(intent?.generatedAt),
    signalDate: safeString(intent?.signalDate, 24),
    targetDate: safeString(intent?.targetDate, 24),
    instrument: safeString(intent?.instrument, 24),
    direction: safeString(intent?.direction, 16),
    confidence: roundedNumber(intent?.confidence, 4),
    expectedReturnPct: roundedNumber(intent?.expectedReturnPct, 4),
    indexFraction: roundedNumber(intent?.indexFraction, 6),
    gasPosition: roundedNumber(intent?.gasPosition, 6),
    cashFraction: roundedNumber(intent?.cashFraction, 6),
    maxHoldingDays: roundedNumber(intent?.maxHoldingDays, 2),
    source: safeString(intent?.source, 120),
  }
}

function normalizedForecastValidation(validation) {
  if (!validation) return null
  return {
    latestCommonIssueDate: safeString(validation?.latestCommonIssueDate, 24),
    issueAgeDays: roundedNumber(validation?.issueAgeDays, 3),
    runHourUtc: safeString(validation?.runHourUtc, 8),
    requiredSources: Array.isArray(validation?.requiredSources)
      ? validation.requiredSources.slice(0, 32).map((value) => safeString(value, 40)).filter(Boolean)
      : [],
    collectedSources: Array.isArray(validation?.collectedSources)
      ? validation.collectedSources.slice(0, 32).map((value) => safeString(value, 40)).filter(Boolean)
      : [],
    requiredLeads: Array.isArray(validation?.requiredLeads)
      ? validation.requiredLeads.slice(0, 64).map((value) => roundedNumber(value, 2)).filter((value) => value !== null)
      : [],
    scoreRowCount: roundedNumber(validation?.scoreRowCount, 0),
  }
}

function normalizedInference(signalInference, fullInference) {
  const summary = signalInference ?? {}
  const full = fullInference ?? {}
  if (!signalInference && !fullInference) return null
  const target = full?.target
  return {
    generatedAt: isoTimestamp(full?.generatedAt),
    mode: safeString(summary?.mode ?? full?.inferenceMode, 120),
    validated: booleanOrNull(summary?.validated ?? full?.validated),
    liveForecastAppliedToTarget: booleanOrNull(
      summary?.liveForecastAppliedToTarget ?? full?.liveForecastAppliedToTarget,
    ),
    strategyId: safeString(full?.strategyId, 80),
    season: safeString(full?.season, 24),
    componentStrategyId: safeString(summary?.componentStrategyId ?? target?.componentStrategyId, 100),
    windowId: safeString(summary?.windowId ?? target?.windowId, 80),
    thesisKind: safeString(summary?.thesisKind ?? target?.thesisKind, 80),
    target: target
      ? {
          signalDate: safeString(target?.signalDate, 24),
          targetDate: safeString(target?.targetDate, 24),
          gasPosition: roundedNumber(target?.gasPosition, 6),
          indexFraction: roundedNumber(target?.indexFraction, 6),
          cashFraction: roundedNumber(target?.cashFraction, 6),
          confidence: roundedNumber(target?.confidence, 4),
        }
      : null,
    forecastValidation: normalizedForecastValidation(summary?.forecastValidation ?? full?.forecastValidation),
  }
}

function normalizedWeatherStatus(weather) {
  if (!weather) return null
  const cycle = weather?.cycle
  const current = weather?.currentWeather
  return {
    generatedAt: isoTimestamp(weather?.generatedAt),
    ok: booleanOrNull(weather?.ok),
    profile: safeString(weather?.runConfiguration?.profile ?? weather?.profile, 48),
    cycle: cycle
      ? {
          durationMs: roundedNumber(cycle?.durationMs, 0),
          cadenceMet: booleanOrNull(cycle?.cadenceMet),
          dueJobs: Array.isArray(cycle?.dueJobs)
            ? cycle.dueJobs.slice(0, 64).map((value) => safeString(value, 80)).filter(Boolean)
            : [],
        }
      : null,
    currentWeather: current
      ? {
          generatedAt: isoTimestamp(current?.generatedAt),
          source: safeString(current?.source, 160),
          models: Array.isArray(current?.models)
            ? current.models.slice(0, 32).map((value) => safeString(value, 60)).filter(Boolean)
            : [],
          latestActionableScore: roundedNumber(current?.latestActionableScore, 6),
          digest: safeString(current?.digest, 160),
        }
      : null,
  }
}

function normalizedJobState(state) {
  if (!state) return null
  return {
    lastStartedAt: isoTimestamp(state?.lastStartedAt),
    lastFinishedAt: isoTimestamp(state?.lastFinishedAt),
    exitCode: roundedNumber(state?.exitCode, 0),
    signal: safeString(state?.signal, 24),
    ok: booleanOrNull(state?.ok),
    timedOut: booleanOrNull(state?.timedOut),
  }
}

function normalizedSupervisor(supervisor, weather) {
  if (!supervisor && !weather) return null
  return {
    generatedAt: isoTimestamp(supervisor?.generatedAt),
    mode: safeString(supervisor?.mode, 24),
    ok: booleanOrNull(supervisor?.ok),
    activeJob: supervisor?.activeJob
      ? {
          id: safeString(supervisor.activeJob.id, 80),
          label: safeString(supervisor.activeJob.label, 160),
          startedAt: isoTimestamp(supervisor.activeJob.startedAt),
        }
      : null,
    jobs: Array.isArray(supervisor?.jobs)
      ? supervisor.jobs.slice(0, maxSupervisorJobs).map((job) => ({
          id: safeString(job?.id, 80),
          label: safeString(job?.label, 160),
          enabled: booleanOrNull(job?.enabled),
          intervalMs: roundedNumber(job?.intervalMs, 0),
          state: normalizedJobState(job?.state),
        }))
      : [],
    failedJobs: Array.isArray(supervisor?.failedJobs)
      ? supervisor.failedJobs.slice(0, maxSupervisorJobs).map((job) => ({
          id: safeString(job?.id, 80),
          label: safeString(job?.label, 160),
          exitCode: roundedNumber(job?.exitCode, 0),
          signal: safeString(job?.signal, 24),
          timedOut: booleanOrNull(job?.timedOut),
        }))
      : [],
    weather: normalizedWeatherStatus(weather),
  }
}

function normalizedReadiness(readiness) {
  const source = readiness ?? {}
  const result = {
    killSwitchClear: booleanOrNull(source?.killSwitchClear),
    venueOpen: booleanOrNull(source?.venueOpen),
    accountContextPresent: booleanOrNull(source?.accountContextPresent),
    marketContextPresent: booleanOrNull(source?.marketContextPresent),
    weatherContextPresent: booleanOrNull(source?.weatherContextPresent),
    storageContextPresent: booleanOrNull(source?.storageContextPresent),
    storageInferenceCoherent: booleanOrNull(source?.storageInferenceCoherent),
  }
  const checks = Object.values(result)
  const ready = checks.every((value) => value === true)
    ? true
    : checks.some((value) => value === false) ? false : null
  return { ready, ...result }
}

function readinessBlocks(readiness, includeUnknown = false) {
  const labels = {
    killSwitchClear: {
      failed: 'The trading kill switch is engaged.',
      unknown: 'Risk readiness does not report whether the trading kill switch is clear.',
    },
    venueOpen: {
      failed: 'The trading venue is closed.',
      unknown: 'Risk readiness does not report whether the trading venue is open.',
    },
    accountContextPresent: {
      failed: 'Broker account context is unavailable.',
      unknown: 'Risk readiness does not report whether broker account context is present.',
    },
    marketContextPresent: {
      failed: 'Market price context is unavailable.',
      unknown: 'Risk readiness does not report whether market price context is present.',
    },
    weatherContextPresent: {
      failed: 'Live weather context is unavailable.',
      unknown: 'Risk readiness does not report whether live weather context is present.',
    },
    storageContextPresent: {
      failed: 'EIA storage context is unavailable.',
      unknown: 'Risk readiness does not report whether EIA storage context is present.',
    },
    storageInferenceCoherent: {
      failed: 'Strategy inference does not include the latest EIA storage context.',
      unknown: 'Risk readiness does not report whether strategy inference includes the latest EIA storage context.',
    },
  }
  return Object.entries(labels).flatMap(([key, label]) => {
    if (readiness?.[key] === false) return [label.failed]
    if (includeUnknown && readiness?.[key] !== true) return [label.unknown]
    return []
  })
}

async function dashboardStatus() {
  const entries = await Promise.all(Object.entries(sourcePaths).map(async ([key, filePath]) => [key, await readJsonSource(filePath)]))
  const sources = Object.fromEntries(entries)
  const brokerAccountStatus = sources.brokerAccountStatus.value
  const brokerStatus = sources.brokerStatus.value
  const brokerSnapshot = sources.brokerSnapshot.value
  const weather = sources.liveWeatherStatus.value
  const signal = sources.signalIntent.value ?? weather?.signalIntentReconcile ?? null
  const directRiskState = sources.riskState
  const riskStateSource = directRiskState.error === null ? directRiskState.value : null
  const riskFreshness = directRiskState.error
    ? {
        fresh: false,
        reason: directRiskState.error === 'missing'
          ? 'Risk and kill-switch telemetry is unavailable.'
          : `Risk and kill-switch telemetry is ${directRiskState.error}.`,
      }
    : riskStateSource
      ? riskSnapshotFreshness(riskStateSource?.generatedAt)
      : { fresh: false, reason: 'Risk and kill-switch telemetry is unavailable.' }
  const riskState = riskFreshness.fresh ? riskStateSource : null
  const operatorState = sources.operatorState.value
  const inference = sources.inference.value ?? weather?.strategyInference ?? null
  const supervisorSource = sources.supervisor.value

  const connectionSource = newestConnectionSource(brokerAccountStatus, brokerSnapshot)
  const activeConnectionMode = normalizedBrokerMode(connectionSource?.mode)
  const brokerFresh = sourceIsFresh(
    connectionSource?.generatedAt ?? connectionSource?.sourceGeneratedAt,
    brokerFutureToleranceMs,
  )
  const brokerReportedConnected = connectionSource?.brokerConnected === true
  const authoritativeConnection = Boolean(
    activeConnectionMode
      && brokerReportedConnected
      && brokerFresh
      && sourceMatchesMode(connectionSource, activeConnectionMode),
  )
  const brokerCandidates = [brokerAccountStatus, brokerSnapshot]
  const matchingModeCandidates = brokerCandidates.filter((candidate) => sourceMatchesMode(candidate, activeConnectionMode))
  const successfulMatchingModeCandidates = matchingModeCandidates.filter((candidate) => candidate?.brokerConnected === true)
  const accountSource = newestAccountSource(...successfulMatchingModeCandidates)
  const portfolioHistorySource = newestHistorySource(...successfulMatchingModeCandidates)
  const crossModeAccountSources = brokerCandidates.filter((candidate) => (
    successfulAccountGeneratedAt(candidate) && !sourceMatchesMode(candidate, activeConnectionMode)
  ))
  const crossModeHistorySources = brokerCandidates.filter((candidate) => (
    historyGeneratedAt(candidate) && !sourceMatchesMode(candidate, activeConnectionMode)
  ))
  const disconnectedEmbeddedAccountSources = matchingModeCandidates.filter((candidate) => (
    candidate?.brokerConnected !== true && successfulAccountGeneratedAt(candidate)
  ))
  const disconnectedEmbeddedHistorySources = matchingModeCandidates.filter((candidate) => (
    candidate?.brokerConnected !== true && historyGeneratedAt(candidate)
  ))
  const rawAccount = accountSource?.rawAccount ?? null
  const sourceGeneratedAt = successfulAccountGeneratedAt(accountSource)
  const portfolioHistoryGeneratedAt = historyGeneratedAt(portfolioHistorySource)
  const connectionCanSupplyMarketClock = authoritativeConnection
  const clockFreshness = connectionCanSupplyMarketClock
    ? marketClockFreshness(connectionSource?.marketClock)
    : { fresh: false, reason: null }
  const marketClockSource = connectionCanSupplyMarketClock && clockFreshness.fresh ? connectionSource : null
  const positionsSource = Array.isArray(accountSource?.positions) ? accountSource.positions : []
  const ordersSource = Array.isArray(accountSource?.openOrders) ? accountSource.openOrders : []
  const orderHistory = sources.brokerOrderHistory.value
  const orderHistorySource = sourceMatchesMode(orderHistory, activeConnectionMode) && Array.isArray(orderHistory?.orders)
    ? orderHistory.orders
    : []
  const operatorKillSwitch = booleanOrNull(operatorState?.killSwitchEngaged)
  const killSwitchEngaged = operatorKillSwitch === true
    ? true
    : operatorKillSwitch === false && riskFreshness.fresh ? false : null
  const reportedReadiness = normalizedReadiness(riskState?.readiness)
  const killSwitchClear = killSwitchEngaged === true
    ? false
    : killSwitchEngaged === false ? reportedReadiness.killSwitchClear : null
  const readiness = normalizedReadiness({ ...reportedReadiness, killSwitchClear })
  const sourceWarnings = []
  const safetyBlocks = []
  const brokerStatusMatchesActiveMode = sourceMatchesMode(brokerStatus, activeConnectionMode)
  const brokerAccountDiagnosticsAreRelevant = sourceMatchesMode(brokerAccountStatus, activeConnectionMode) && (
    brokerAccountStatus === connectionSource
    || brokerAccountStatus === accountSource
    || brokerAccountStatus === portfolioHistorySource
    || brokerAccountStatus === marketClockSource
  )

  if (!connectionSource) sourceWarnings.push('Broker telemetry is unavailable; run a read-only broker refresh.')
  else {
    if (!activeConnectionMode) sourceWarnings.push('Broker connection telemetry has a missing or invalid mode; connectivity, account data, and market clock are unavailable.')
    if (!brokerFresh) sourceWarnings.push(`Broker connection telemetry is stale or future-dated (last event at ${isoTimestamp(connectionSource?.generatedAt ?? connectionSource?.sourceGeneratedAt) ?? 'an unknown time'}).`)
  }
  if (connectionCanSupplyMarketClock && !clockFreshness.fresh) sourceWarnings.push(clockFreshness.reason)
  if (accountSource && accountSource !== connectionSource) {
    sourceWarnings.push(`Displayed account data is cached from ${sourceGeneratedAt ?? 'an unknown time'}; the newest broker connection event has no account payload.`)
  }
  if (!accountSource && crossModeAccountSources.length) {
    const sourceModes = [...new Set(crossModeAccountSources.map((candidate) => normalizedBrokerMode(candidate?.mode) ?? 'unknown'))]
    sourceWarnings.push(`Cached account data from ${sourceModes.join('/')} mode was suppressed because the newest broker connection event is ${activeConnectionMode ?? 'unknown'} mode.`)
  } else if (!accountSource && disconnectedEmbeddedAccountSources.length) {
    sourceWarnings.push(`Cached account data embedded in a disconnected ${activeConnectionMode ?? 'unknown'} event was suppressed because it is not a successful account payload for the active mode.`)
  }
  if (!portfolioHistorySource && crossModeHistorySources.length) {
    const sourceModes = [...new Set(crossModeHistorySources.map((candidate) => normalizedBrokerMode(candidate?.mode) ?? 'unknown'))]
    sourceWarnings.push(`Cached portfolio history from ${sourceModes.join('/')} mode was suppressed because the newest broker connection event is ${activeConnectionMode ?? 'unknown'} mode.`)
  } else if (!portfolioHistorySource && disconnectedEmbeddedHistorySources.length) {
    sourceWarnings.push(`Cached portfolio history embedded in a disconnected ${activeConnectionMode ?? 'unknown'} event was suppressed because it is not a successful history payload for the active mode.`)
  }
  if (portfolioHistorySource && !sourceIsFresh(portfolioHistoryGeneratedAt)) {
    sourceWarnings.push(`Displayed portfolio history is stale (last fetched at ${portfolioHistoryGeneratedAt ?? 'an unknown time'}).`)
  }
  if (portfolioHistorySource && sourceGeneratedAt && timestampsMateriallyDiffer(portfolioHistoryGeneratedAt, sourceGeneratedAt)) {
    sourceWarnings.push(`Displayed portfolio history is from ${portfolioHistoryGeneratedAt ?? 'an unknown time'}, a different read than the selected account data from ${sourceGeneratedAt}.`)
  }
  if (!weather) sourceWarnings.push('Live weather service telemetry is unavailable.')
  else if (!sourceIsFresh(weather?.generatedAt)) sourceWarnings.push(`Live weather telemetry is stale (last generated at ${isoTimestamp(weather?.generatedAt) ?? 'an unknown time'}).`)
  if (!signal) sourceWarnings.push('Natural-gas signal intent is unavailable.')
  else if (!sourceIsFresh(signal?.generatedAt)) sourceWarnings.push(`Signal intent is stale (last generated at ${isoTimestamp(signal?.generatedAt) ?? 'an unknown time'}).`)
  if (directRiskState.error) safetyBlocks.push(riskFreshness.reason)
  else if (!riskStateSource) safetyBlocks.push('Risk and kill-switch telemetry is unavailable.')
  else if (!riskFreshness.fresh) safetyBlocks.push(riskFreshness.reason)
  if (!operatorState) safetyBlocks.push('Operator kill-switch telemetry is unavailable.')
  else if (operatorKillSwitch === null) safetyBlocks.push('Operator kill-switch telemetry must contain a boolean killSwitchEngaged value.')
  if (!supervisorSource) sourceWarnings.push('Live trading supervisor telemetry is unavailable.')
  else if (!sourceIsFresh(supervisorSource?.generatedAt)) sourceWarnings.push(`Supervisor telemetry is stale (last generated at ${isoTimestamp(supervisorSource?.generatedAt) ?? 'an unknown time'}).`)
  for (const [key, source] of Object.entries(sources)) {
    if (source.error && source.error !== 'missing') sourceWarnings.push(`${key} telemetry is ${source.error}.`)
  }
  if (lastRefreshError) sourceWarnings.push(`The last read-only broker refresh failed: ${lastRefreshError}`)

  const blockedReasons = uniqueMessages([
    killSwitchEngaged === true ? ['The trading kill switch is engaged.'] : [],
    safetyBlocks,
    readinessBlocks(readiness, riskFreshness.fresh),
    riskState?.blockedReasons ?? [],
    brokerStatusMatchesActiveMode ? brokerStatus?.blockedReasons ?? [] : [],
  ])
  const warnings = uniqueMessages([
    sourceWarnings,
    connectionSource?.brokerConnected === true ? [] : connectionSource?.blockedReasons ?? [],
    brokerAccountDiagnosticsAreRelevant ? brokerAccountStatus?.warnings ?? [] : [],
    brokerStatusMatchesActiveMode ? brokerStatus?.warnings ?? [] : [],
    riskState?.warnings ?? [],
  ], Math.max(0, maxDiagnosticMessageCount - blockedReasons.length))

  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt,
    mode: activeConnectionMode ?? 'unknown',
    brokerConnected: Boolean(authoritativeConnection && marketClockSource),
    account: normalizedAccount(accountSource?.account, rawAccount),
    positions: positionsSource.slice(0, maxPositions).map(normalizedPosition).filter((position) => position.symbol),
    openOrders: ordersSource.slice(0, maxOpenOrders).map(normalizedOrder).filter((order) => order.symbol || order.id),
    recentOrders: orderHistorySource
      .slice(0, 200)
      .map(normalizedOrder)
      .filter((order) => order.symbol || order.id),
    marketClock: normalizedMarketClock(marketClockSource?.marketClock),
    portfolioHistory: normalizedPortfolioHistory(
      portfolioHistorySource?.portfolioHistory,
      portfolioHistoryGeneratedAt,
    ),
    strategy: {
      intent: normalizedIntent(signal?.intent),
      inference: normalizedInference(signal?.inference, inference),
    },
    risk: {
      killSwitchEngaged,
      readiness,
      blockedReasons,
      warnings,
    },
    supervisor: normalizedSupervisor(supervisorSource, weather),
  }
}

function stopChild(child, signal) {
  if (!child.pid || child.killed) return
  child.kill(signal)
}

function runReadOnlyBrokerRefresh() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [brokerScript, '--status'], {
      cwd: repoDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeRefreshChild = child
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (activeRefreshChild === child) activeRefreshChild = null
      callback(value)
    }
    const timer = setTimeout(() => {
      timedOut = true
      stopChild(child, 'SIGTERM')
    }, refreshTimeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-8000)
    })
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8000)
    })
    child.on('error', (error) => finish(reject, error))
    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(reject, new Error(`broker status refresh timed out after ${refreshTimeoutMs}ms`))
        return
      }
      if (code === 0) {
        finish(resolve, { code, signal })
        return
      }
      finish(reject, new Error(safeText(stderr || stdout || `broker status refresh exited ${code ?? signal ?? 'unknown'}`)))
    })
  })
}

async function refreshBrokerStatus() {
  if (activeRefresh) return { state: 'joined', promise: activeRefresh }
  if (lastRefreshFinishedAt && Date.now() - lastRefreshFinishedAt < refreshMinIntervalMs) {
    return { state: 'cached', promise: Promise.resolve() }
  }

  activeRefresh = runReadOnlyBrokerRefresh()
    .then(() => {
      lastRefreshError = null
    })
    .catch((error) => {
      lastRefreshError = safeText(error.message || error)
    })
    .finally(() => {
      lastRefreshFinishedAt = Date.now()
      activeRefresh = null
    })
  return { state: 'refreshed', promise: activeRefresh }
}

function corsHeaders(req) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
  const origin = req.headers.origin
  if (origin && originAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  }
  return headers
}

function sendJson(req, res, statusCode, body, extraHeaders = {}) {
  const payload = `${JSON.stringify(body)}\n`
  res.writeHead(statusCode, { ...corsHeaders(req), 'Content-Length': Buffer.byteLength(payload), ...extraHeaders })
  res.end(payload)
}

const server = createServer(async (req, res) => {
  if (!originAllowed(req.headers.origin)) {
    sendJson(req, res, 403, { error: 'Origin is not allowed for the local QORE telemetry service.' })
    return
  }

  const requestUrl = new URL(req.url ?? '/', `http://${host}:${port}`)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders(req), 'Content-Length': '0' })
    res.end()
    return
  }

  try {
    if (req.method === 'GET' && requestUrl.pathname === '/api/live/status') {
      sendJson(req, res, 200, await dashboardStatus())
      return
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/live/refresh') {
      const refresh = await refreshBrokerStatus()
      await refresh.promise
      sendJson(req, res, 200, await dashboardStatus(), { 'X-QORE-Refresh': refresh.state })
      return
    }
    sendJson(req, res, 404, { error: 'Not found.' })
  } catch (error) {
    sendJson(req, res, 500, { error: safeText(error.message || 'Telemetry service failure.') })
  }
})

function shutdown() {
  if (activeRefreshChild) stopChild(activeRefreshChild, 'SIGTERM')
  server.close(() => process.exit(0))
}

if (snapshotOnly) {
  try {
    const payload = JSON.stringify(await dashboardStatus())
    if (Buffer.byteLength(payload) > maxSnapshotBytes) {
      throw new Error('Sanitized Command telemetry exceeds the bounded snapshot size.')
    }
    process.stdout.write(`${payload}\n`)
  } catch (error) {
    process.stderr.write(`${safeText(error?.message ?? 'Telemetry snapshot failure.')}\n`)
    process.exitCode = 1
  }
} else {
  server.listen(port, host, () => {
    console.log(`QORE telemetry service listening at http://${host}:${port}`)
  })
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
