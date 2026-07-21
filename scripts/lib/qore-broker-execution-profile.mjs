import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { validateIndexBasketConfig } from './qore-index-basket.mjs'

export const BROKER_EXECUTION_PROFILE_SCHEMA_VERSION = 1
export const BROKER_EXECUTION_PROFILE_ID = 'alpaca-etf-target-weight-route-v1'
export const BROKER_IMPLEMENTATION_POLICY_ID = 'alpaca-live-etf-reconciler-v1'

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  )
}

function finiteNumber(value, label, { minimum = -Infinity, maximum = Infinity, nullable = false } = {}) {
  if (nullable && value === null) return null
  if (typeof value === 'boolean' || value === '' || value === null || value === undefined) {
    throw new Error(`${label} must be ${nullable ? 'null or ' : ''}a finite number.`)
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`)
  }
  return numeric
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`)
  return value
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`)
  return value.trim()
}

function officialUrl(value, expected, label) {
  const normalized = nonEmptyString(value, label).replace(/\/$/, '')
  if (normalized !== expected) throw new Error(`${label} must equal ${expected}.`)
  return normalized
}

function sortedIndexBasket(components) {
  return validateIndexBasketConfig({ components }, { source: 'broker execution profile index basket' })
    .components
    .map(({ symbol, targetWeight }) => ({ symbol, targetWeight }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
}

export function canonicalBrokerExecutionProfile(profile) {
  const allowedSymbols = [...new Set((profile?.universe?.allowedSymbols ?? []).map((value) => String(value).toUpperCase()))]
    .sort()
  if (JSON.stringify(allowedSymbols) !== JSON.stringify(['QQQM', 'UNG', 'VOO'])) {
    throw new Error('broker execution profile allowedSymbols must equal QQQM, UNG, and VOO.')
  }
  const orderType = nonEmptyString(profile?.orders?.type, 'broker execution profile order type')
  const timeInForce = nonEmptyString(profile?.orders?.timeInForce, 'broker execution profile time in force')
  if (orderType !== 'market') throw new Error('broker execution profile order type must equal market.')
  if (timeInForce !== 'day') throw new Error('broker execution profile time in force must equal day.')

  const risk = profile?.risk ?? {}
  const canonical = {
    schemaVersion: profile?.schemaVersion,
    profileId: nonEmptyString(profile?.profileId, 'broker execution profile profileId'),
    implementationPolicyId: nonEmptyString(
      profile?.implementationPolicyId,
      'broker execution profile implementationPolicyId',
    ),
    venue: {
      broker: nonEmptyString(profile?.venue?.broker, 'broker execution profile broker'),
      assetClass: nonEmptyString(profile?.venue?.assetClass, 'broker execution profile assetClass'),
      paperBaseUrl: officialUrl(
        profile?.venue?.paperBaseUrl,
        'https://paper-api.alpaca.markets',
        'broker execution profile paperBaseUrl',
      ),
      liveBaseUrl: officialUrl(
        profile?.venue?.liveBaseUrl,
        'https://api.alpaca.markets',
        'broker execution profile liveBaseUrl',
      ),
      dataBaseUrl: officialUrl(
        profile?.venue?.dataBaseUrl,
        'https://data.alpaca.markets',
        'broker execution profile dataBaseUrl',
      ),
      marketDataFeed: nonEmptyString(profile?.venue?.marketDataFeed, 'broker execution profile marketDataFeed'),
    },
    universe: {
      allowedSymbols,
      futuresRouting: nonEmptyString(profile?.universe?.futuresRouting, 'broker execution profile futuresRouting'),
    },
    sizing: {
      accountAllocationPct: finiteNumber(
        profile?.sizing?.accountAllocationPct,
        'broker execution profile accountAllocationPct',
        { minimum: 0, maximum: 100 },
      ),
      minCashBufferPct: finiteNumber(
        profile?.sizing?.minCashBufferPct,
        'broker execution profile minCashBufferPct',
        { minimum: 0, maximum: 100 },
      ),
      rebalanceDeadbandPct: finiteNumber(
        profile?.sizing?.rebalanceDeadbandPct,
        'broker execution profile rebalanceDeadbandPct',
        { minimum: 0, maximum: 100 },
      ),
      minOrderUsd: finiteNumber(profile?.sizing?.minOrderUsd, 'broker execution profile minOrderUsd', { minimum: 0.01 }),
      maxOrderUsd: profile?.sizing?.maxOrderUsd === null
        ? null
        : finiteNumber(profile?.sizing?.maxOrderUsd, 'broker execution profile maxOrderUsd', { minimum: 0.01 }),
      indexBasket: sortedIndexBasket(profile?.sizing?.indexBasket),
    },
    orders: {
      type: orderType,
      timeInForce,
      fractionalNonShortOrders: booleanValue(
        profile?.orders?.fractionalNonShortOrders,
        'broker execution profile fractionalNonShortOrders',
      ),
      fractionalShortSales: booleanValue(
        profile?.orders?.fractionalShortSales,
        'broker execution profile fractionalShortSales',
      ),
      replaceOpenOrders: booleanValue(profile?.orders?.replaceOpenOrders, 'broker execution profile replaceOpenOrders'),
      shortExposureEnabled: booleanValue(profile?.orders?.shortExposureEnabled, 'broker execution profile shortExposureEnabled'),
      hardToBorrowAllowed: booleanValue(profile?.orders?.hardToBorrowAllowed, 'broker execution profile hardToBorrowAllowed'),
    },
    risk: {
      minConfidence: finiteNumber(risk.minConfidence, 'broker execution profile minConfidence', { minimum: 0, maximum: 1 }),
      maxConfidence: finiteNumber(risk.maxConfidence, 'broker execution profile maxConfidence', { minimum: 0, maximum: 1 }),
      maxSignalAgeDays: finiteNumber(risk.maxSignalAgeDays, 'broker execution profile maxSignalAgeDays', { minimum: 0 }),
      maxWeatherIssueAgeHours: finiteNumber(risk.maxWeatherIssueAgeHours, 'broker execution profile maxWeatherIssueAgeHours', { minimum: 0 }),
      maxMarketDataAgeMinutes: finiteNumber(risk.maxMarketDataAgeMinutes, 'broker execution profile maxMarketDataAgeMinutes', { minimum: 0 }),
      maxStorageDataAgeDays: finiteNumber(risk.maxStorageDataAgeDays, 'broker execution profile maxStorageDataAgeDays', { minimum: 0 }),
      maxAllowedSpreadBps: finiteNumber(risk.maxAllowedSpreadBps, 'broker execution profile maxAllowedSpreadBps', { minimum: 0 }),
      maxQuoteAgeMinutes: finiteNumber(risk.maxQuoteAgeMinutes, 'broker execution profile maxQuoteAgeMinutes', { minimum: 0 }),
      maxQuoteFutureSkewSeconds: finiteNumber(risk.maxQuoteFutureSkewSeconds, 'broker execution profile maxQuoteFutureSkewSeconds', { minimum: 0 }),
      maxClockAgeSeconds: finiteNumber(risk.maxClockAgeSeconds, 'broker execution profile maxClockAgeSeconds', { minimum: 0 }),
      maxClockFutureSkewSeconds: finiteNumber(risk.maxClockFutureSkewSeconds, 'broker execution profile maxClockFutureSkewSeconds', { minimum: 0 }),
      maxRiskSnapshotAgeSeconds: finiteNumber(risk.maxRiskSnapshotAgeSeconds, 'broker execution profile maxRiskSnapshotAgeSeconds', { minimum: 0 }),
      maxRiskSnapshotFutureSkewSeconds: finiteNumber(risk.maxRiskSnapshotFutureSkewSeconds, 'broker execution profile maxRiskSnapshotFutureSkewSeconds', { minimum: 0 }),
      maxDailyLossPct: finiteNumber(risk.maxDailyLossPct, 'broker execution profile maxDailyLossPct', { minimum: 0 }),
      maxTrailingDrawdownPct: finiteNumber(risk.maxTrailingDrawdownPct, 'broker execution profile maxTrailingDrawdownPct', { minimum: 0 }),
      maxGrossExposurePct: finiteNumber(risk.maxGrossExposurePct, 'broker execution profile maxGrossExposurePct', { minimum: 0 }),
      minReferencePriceUsd: finiteNumber(risk.minReferencePriceUsd, 'broker execution profile minReferencePriceUsd', { minimum: 0 }),
      minWeatherSourceCount: finiteNumber(risk.minWeatherSourceCount, 'broker execution profile minWeatherSourceCount', { minimum: 1 }),
      minWeatherCoveragePct: finiteNumber(risk.minWeatherCoveragePct, 'broker execution profile minWeatherCoveragePct', { minimum: 0, maximum: 100 }),
      minWeatherDirectionalAccuracyPct: finiteNumber(
        risk.minWeatherDirectionalAccuracyPct,
        'broker execution profile minWeatherDirectionalAccuracyPct',
        { minimum: 0, maximum: 100 },
      ),
      requireFreshWeatherContext: booleanValue(risk.requireFreshWeatherContext, 'broker execution profile requireFreshWeatherContext'),
      requireStorageContext: booleanValue(risk.requireStorageContext, 'broker execution profile requireStorageContext'),
      requireMarketContext: booleanValue(risk.requireMarketContext, 'broker execution profile requireMarketContext'),
      requireAccountContext: booleanValue(risk.requireAccountContext, 'broker execution profile requireAccountContext'),
      requireOperatorContext: booleanValue(risk.requireOperatorContext, 'broker execution profile requireOperatorContext'),
    },
    transport: {
      requestTimeoutMs: finiteNumber(
        profile?.transport?.requestTimeoutMs,
        'broker execution profile requestTimeoutMs',
        { minimum: 1 },
      ),
    },
  }
  if (canonical.schemaVersion !== BROKER_EXECUTION_PROFILE_SCHEMA_VERSION) {
    throw new Error(`broker execution profile schemaVersion must equal ${BROKER_EXECUTION_PROFILE_SCHEMA_VERSION}.`)
  }
  if (canonical.profileId !== BROKER_EXECUTION_PROFILE_ID) {
    throw new Error(`broker execution profile profileId must equal ${BROKER_EXECUTION_PROFILE_ID}.`)
  }
  if (canonical.implementationPolicyId !== BROKER_IMPLEMENTATION_POLICY_ID) {
    throw new Error(`broker execution profile implementationPolicyId must equal ${BROKER_IMPLEMENTATION_POLICY_ID}.`)
  }
  if (canonical.venue.broker !== 'alpaca' || canonical.venue.assetClass !== 'us-equities') {
    throw new Error('broker execution profile venue must equal Alpaca US equities.')
  }
  if (canonical.universe.futuresRouting !== 'blocked') {
    throw new Error('broker execution profile futuresRouting must equal blocked.')
  }
  if (canonical.orders.fractionalShortSales !== false) {
    throw new Error('broker execution profile fractionalShortSales must remain false.')
  }
  if (canonical.risk.minConfidence > canonical.risk.maxConfidence) {
    throw new Error('broker execution profile minConfidence cannot exceed maxConfidence.')
  }
  return canonical
}

export function brokerExecutionProfileDigestSha256(profile) {
  const canonical = canonicalBrokerExecutionProfile(profile)
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(canonical))).digest('hex')
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`)
  }
}

export function loadReviewedBrokerExecutionProfile(repoDir) {
  const settingsPath = path.join(repoDir, 'config', 'qore-live-broker-settings.json')
  const basketPath = path.join(repoDir, 'data', 'qore', 'market', 'index-basket-config.json')
  const settings = readJson(settingsPath, 'reviewed broker settings')
  const basket = validateIndexBasketConfig(readJson(basketPath, 'reviewed index basket'), {
    source: 'reviewed index basket',
  })
  const execution = settings?.alpaca?.reviewedExecutionProfile
  const profile = canonicalBrokerExecutionProfile({
    schemaVersion: execution?.schemaVersion,
    profileId: execution?.profileId,
    implementationPolicyId: execution?.implementationPolicyId,
    venue: {
      broker: 'alpaca',
      assetClass: 'us-equities',
      paperBaseUrl: settings?.alpaca?.paperBaseUrl,
      liveBaseUrl: settings?.alpaca?.liveBaseUrl,
      dataBaseUrl: settings?.alpaca?.dataBaseUrl,
      marketDataFeed: settings?.alpaca?.marketDataFeed,
    },
    universe: {
      allowedSymbols: settings?.alpaca?.symbols,
      futuresRouting: execution?.futuresRouting,
    },
    sizing: {
      ...execution?.sizing,
      indexBasket: basket.components,
    },
    orders: execution?.orders,
    risk: settings?.gates?.riskDefaults,
    transport: { requestTimeoutMs: settings?.gates?.riskDefaults?.alpacaRequestTimeoutMs },
  })
  return {
    profile,
    profileDigestSha256: brokerExecutionProfileDigestSha256(profile),
    settingsPath,
    basketPath,
  }
}

function envNumber(env, name, fallback, bounds) {
  if (env[name] === undefined) return fallback
  return finiteNumber(env[name], name, bounds)
}

function envOptionalNumber(env, name, fallback) {
  if (env[name] === undefined) return fallback
  if (env[name] === '') return null
  return finiteNumber(env[name], name, { minimum: 0.01 })
}

function envBoolean(env, name, fallback) {
  if (env[name] === undefined) return fallback
  const normalized = String(env[name]).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false
  throw new Error(`${name} must be an explicit boolean value.`)
}

export function resolveBrokerExecutionProfile(reviewedProfile, env = process.env) {
  const profile = structuredClone(canonicalBrokerExecutionProfile(reviewedProfile))
  profile.sizing.accountAllocationPct = envNumber(
    env,
    'QORE_LIVE_ACCOUNT_ALLOCATION_PCT',
    profile.sizing.accountAllocationPct,
    { minimum: 0, maximum: 100 },
  )
  profile.sizing.minCashBufferPct = envNumber(
    env,
    'QORE_LIVE_MIN_CASH_BUFFER_PCT',
    profile.sizing.minCashBufferPct,
    { minimum: 0, maximum: 100 },
  )
  profile.sizing.rebalanceDeadbandPct = envNumber(
    env,
    'QORE_LIVE_REBALANCE_DEADBAND_PCT',
    profile.sizing.rebalanceDeadbandPct,
    { minimum: 0, maximum: 100 },
  )
  profile.sizing.minOrderUsd = envNumber(
    env,
    'QORE_LIVE_MIN_ORDER_USD',
    profile.sizing.minOrderUsd,
    { minimum: 0.01 },
  )
  profile.sizing.maxOrderUsd = envOptionalNumber(env, 'QORE_LIVE_MAX_ORDER_USD', profile.sizing.maxOrderUsd)
  profile.orders.fractionalNonShortOrders = envBoolean(
    env,
    'QORE_ALPACA_FRACTIONAL_ORDERS',
    profile.orders.fractionalNonShortOrders,
  )
  profile.orders.shortExposureEnabled = envBoolean(env, 'QORE_ALPACA_ALLOW_SHORTS', false)
  profile.orders.hardToBorrowAllowed = envBoolean(env, 'QORE_ALPACA_ALLOW_HARD_TO_BORROW', false)
  profile.orders.replaceOpenOrders = envBoolean(env, 'QORE_ALPACA_REPLACE_OPEN_ORDERS', false)
  profile.orders.timeInForce = env.QORE_ALPACA_TIME_IN_FORCE ?? profile.orders.timeInForce
  profile.orders.type = env.QORE_ALPACA_ORDER_TYPE ?? profile.orders.type
  profile.venue.marketDataFeed = env.QORE_ALPACA_MARKET_DATA_FEED ?? profile.venue.marketDataFeed

  const riskOverrides = {
    maxQuoteAgeMinutes: 'QORE_LIVE_MAX_QUOTE_AGE_MINUTES',
    maxQuoteFutureSkewSeconds: 'QORE_LIVE_MAX_QUOTE_FUTURE_SKEW_SECONDS',
    maxClockAgeSeconds: 'QORE_ALPACA_CLOCK_MAX_AGE_SECONDS',
    maxClockFutureSkewSeconds: 'QORE_ALPACA_CLOCK_MAX_FUTURE_SKEW_SECONDS',
    maxRiskSnapshotAgeSeconds: 'QORE_LIVE_MAX_RISK_SNAPSHOT_AGE_SECONDS',
    maxRiskSnapshotFutureSkewSeconds: 'QORE_LIVE_MAX_RISK_SNAPSHOT_FUTURE_SKEW_SECONDS',
    maxDailyLossPct: 'QORE_LIVE_MAX_DAILY_LOSS_PCT',
    maxTrailingDrawdownPct: 'QORE_LIVE_MAX_TRAILING_DRAWDOWN_PCT',
    maxGrossExposurePct: 'QORE_LIVE_MAX_GROSS_EXPOSURE_PCT',
  }
  for (const [field, envName] of Object.entries(riskOverrides)) {
    profile.risk[field] = envNumber(env, envName, profile.risk[field], { minimum: 0 })
  }
  profile.transport.requestTimeoutMs = envNumber(
    env,
    'QORE_ALPACA_REQUEST_TIMEOUT_MS',
    profile.transport.requestTimeoutMs,
    { minimum: 1 },
  )
  return canonicalBrokerExecutionProfile(profile)
}

export function brokerExecutionProfileTieOutFailures(profile, researchExecutionContract) {
  const failures = []
  const deploymentFraction = (profile.sizing.accountAllocationPct - profile.sizing.minCashBufferPct) / 100
  const researchDeploymentFraction = researchExecutionContract?.deploymentFraction
  if (typeof researchDeploymentFraction !== 'number' || !Number.isFinite(researchDeploymentFraction)) {
    failures.push('research execution deploymentFraction must be a finite number')
  } else if (Math.abs(deploymentFraction - researchDeploymentFraction) > 1e-12) {
    failures.push('broker allocation less cash buffer does not equal the research execution deploymentFraction')
  }
  const researchRebalanceDeadbandPct = researchExecutionContract?.rebalanceDeadbandPct
  if (typeof researchRebalanceDeadbandPct !== 'number' || !Number.isFinite(researchRebalanceDeadbandPct)) {
    failures.push('research execution rebalanceDeadbandPct must be a finite number')
  } else if (Math.abs(profile.sizing.rebalanceDeadbandPct - researchRebalanceDeadbandPct) > 1e-12) {
    failures.push('broker rebalance deadband does not equal the research execution deadband')
  }
  const researchWeights = Object.entries(researchExecutionContract?.indexWeights ?? {})
    .map(([symbol, targetWeight]) => ({ symbol, targetWeight: Number(targetWeight) }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
  if (JSON.stringify(profile.sizing.indexBasket) !== JSON.stringify(researchWeights)) {
    failures.push('broker index basket does not equal the research execution index weights')
  }
  return failures
}
