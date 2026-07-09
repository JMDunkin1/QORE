import { indexBasketComponentNotional, indexBasketExecutionComponents, indexBasketSymbol } from './indexBasket'
import type {
  ExecutionInstrumentCode,
  OrderIntent,
  OrderLegIntent,
  RiskCheckCategory,
  RiskCheckResult,
  RiskCheckStatus,
  RiskDecision,
  RiskEvaluationContext,
  RiskPolicy,
  StrategySignalIntent,
} from './types'

export const defaultDryRunRiskPolicy: RiskPolicy = {
  id: 'dry-run-research-policy-v1',
  mode: 'paper',
  allowedInstruments: ['UNG', 'NG', 'MNG', 'QG', 'VOO', 'QQQM'],
  maxConfidence: 1,
  minConfidence: 0.55,
  maxHoldingDays: 12,
  maxNotionalUsd: 25000,
  maxOpenIntents: 1,
  maxSingleLegNotionalUsd: 25000,
  allowShortGas: true,
  liveRoutingEnabled: false,
}

export const weatherModelGuardrailRiskPolicy: RiskPolicy = {
  id: 'ngas-weather-guardrail-risk-v1',
  mode: 'paper',
  allowedInstruments: ['UNG', 'NG', 'MNG', 'QG', 'VOO', 'QQQM'],
  maxConfidence: 1,
  minConfidence: 0,
  maxDailyLossPct: 12,
  maxTrailingDrawdownPct: 25,
  maxConsecutiveLosses: 8,
  maxSignalAgeDays: 1,
  maxWeatherIssueAgeHours: 36,
  maxMarketDataAgeMinutes: 1440,
  maxStorageDataAgeDays: 10,
  maxAllowedSpreadBps: 75,
  minReferencePriceUsd: 1,
  minWeatherSourceCount: 2,
  minWeatherCoveragePct: 70,
  minWeatherDirectionalAccuracyPct: 52,
  requireFreshWeatherContext: true,
  requireStorageContext: true,
  requireMarketContext: true,
  requireAccountContext: true,
  requireOperatorContext: true,
  requireManualApproval: false,
  allowShortGas: true,
  notes: [
    'Autonomous guardrails preserve the strategy sizing, direction, and index/gas/cash weights.',
    'Fresh weather, market, storage, account, and autonomous operator-state context must be supplied before approval.',
    'Emergency loss, drawdown, spread, price, venue, and kill-switch blocks can stop trading, but they do not resize approved trades.',
  ],
  liveRoutingEnabled: false,
}

export const paperExecutionReadinessGates = [
  {
    id: 'no-live-routing',
    label: 'Live routing disabled',
    status: 'locked',
    detail: 'The dry-run policy keeps liveRoutingEnabled false; live routing uses the separate Alpaca policy and gateway.',
  },
  {
    id: 'signal-audit',
    label: 'Signal audit trail',
    status: 'ready',
    detail: 'Every paper intent carries strategy, signal date, target date, confidence, and data-source notes.',
  },
  {
    id: 'risk-policy',
    label: 'Risk policy required',
    status: 'ready',
    detail: 'Position size, allowed instruments, confidence, and holding-window checks run before paper fills.',
  },
  {
    id: 'broker-adapter',
    label: 'Broker adapter gated',
    status: 'ready',
    detail: 'Live broker routing now uses a separate adapter and cannot reuse the dry-run gateway by accident.',
  },
  {
    id: 'weather-guardrail-risk',
    label: 'Weather guardrail risk policy',
    status: 'ready',
    detail: 'The NGAS weather policy adds fresh-data, emergency drawdown/loss, spread, price, kill-switch, and venue-state gates without resizing approved trades.',
  },
] as const

function sideForSignal(signal: StrategySignalIntent) {
  if (signal.direction === 'long') return 'buy'
  if (signal.direction === 'short') return 'sell'
  return 'hold'
}

function clampFraction(value: number) {
  return Math.max(0, Math.min(1, value))
}

function finiteOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dateOrNull(value: string | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function ageDays(asOf: Date, value: string | undefined) {
  const date = dateOrNull(value)
  return date ? (asOf.getTime() - date.getTime()) / 86400000 : null
}

function ageHours(asOf: Date, value: string | undefined) {
  const days = ageDays(asOf, value)
  return days === null ? null : days * 24
}

function ageMinutes(asOf: Date, value: string | undefined) {
  const hours = ageHours(asOf, value)
  return hours === null ? null : hours * 60
}

function addCheck(
  checks: RiskCheckResult[],
  id: string,
  label: string,
  category: RiskCheckCategory,
  status: RiskCheckStatus,
  detail: string,
) {
  checks.push({ id, label, category, status, detail })
}

function defaultGasPositionForSignal(signal: StrategySignalIntent, indexFraction: number) {
  if (signal.direction === 'flat' || sideForSignal(signal) === 'hold') return 0
  const gasExposure = Math.max(0, 1 - indexFraction)
  return signal.direction === 'short' ? -gasExposure : gasExposure
}

function signedGasPositionForSignal(signal: StrategySignalIntent, gasPosition: number) {
  if (signal.direction === 'short') return -Math.abs(gasPosition)
  if (signal.direction === 'long') return Math.abs(gasPosition)
  return 0
}

function signalGasFraction(signal: StrategySignalIntent) {
  const indexFraction = clampFraction(signal.indexFraction ?? 0)
  const gasPosition = signedGasPositionForSignal(signal, signal.gasPosition ?? defaultGasPositionForSignal(signal, indexFraction))
  return Math.abs(gasPosition)
}

function signalIndexFraction(signal: StrategySignalIntent) {
  return clampFraction(signal.indexFraction ?? 0)
}

function requestedNotionalFor(policy: RiskPolicy, context: RiskEvaluationContext) {
  const requested = finiteOrNull(context.requestedNotionalUsd)
  return requested === null ? (policy.maxNotionalUsd ?? Number.POSITIVE_INFINITY) : Math.max(0, requested)
}

function capNotionalForSignal(signal: StrategySignalIntent, policy: RiskPolicy, context: RiskEvaluationContext) {
  const caps = [policy.maxNotionalUsd ?? Number.POSITIVE_INFINITY]
  const gasFraction = signalGasFraction(signal)
  const indexFraction = signalIndexFraction(signal)
  const largestLegFraction = Math.max(
    gasFraction,
    ...indexBasketExecutionComponents.map((component) => component.targetWeight * indexFraction),
  )

  if (policy.maxSingleLegNotionalUsd && largestLegFraction > 0) {
    caps.push(policy.maxSingleLegNotionalUsd / largestLegFraction)
  }
  if (policy.maxGasLegNotionalUsd && gasFraction > 0) {
    caps.push(policy.maxGasLegNotionalUsd / gasFraction)
  }
  if (policy.maxIndexLegNotionalUsd && indexFraction > 0) {
    caps.push(policy.maxIndexLegNotionalUsd / indexFraction)
  }
  if (policy.maxAccountAllocationPct && context.account?.equityUsd) {
    caps.push(context.account.equityUsd * (policy.maxAccountAllocationPct / 100))
  }
  if (policy.minCashBufferPct && context.account?.cashUsd !== undefined && context.account?.equityUsd !== undefined) {
    caps.push(Math.max(0, context.account.cashUsd - context.account.equityUsd * (policy.minCashBufferPct / 100)))
  }

  const finiteCaps = caps.filter((cap) => Number.isFinite(cap) && cap >= 0)
  return finiteCaps.length ? Math.max(0, Math.min(...finiteCaps)) : Number.POSITIVE_INFINITY
}

function instrumentsForSignal(signal: StrategySignalIntent): ExecutionInstrumentCode[] {
  const instruments = new Set<ExecutionInstrumentCode>()
  if (signalGasFraction(signal) > 0) instruments.add(signal.instrument)
  if (signalIndexFraction(signal) > 0) {
    indexBasketExecutionComponents.forEach((component) => instruments.add(component.symbol))
  }
  if (!instruments.size && signal.direction !== 'flat') instruments.add(signal.instrument)
  return [...instruments]
}

function hasRecentLossCooldown(context: RiskEvaluationContext, policy: RiskPolicy, asOf: Date) {
  if (!policy.cooldownDaysAfterLoss || !context.account?.lastLossDate) return false
  const days = ageDays(asOf, context.account.lastLossDate)
  return days !== null && days >= 0 && days < policy.cooldownDaysAfterLoss
}

function orderLegsForSignal(signal: StrategySignalIntent, notionalUsd: number): OrderLegIntent[] {
  const indexFraction = clampFraction(signal.indexFraction ?? 0)
  const gasPosition = signedGasPositionForSignal(signal, signal.gasPosition ?? defaultGasPositionForSignal(signal, indexFraction))
  const gasNotionalUsd = Math.max(0, Math.abs(gasPosition) * notionalUsd)
  const legs = indexBasketComponentNotional(notionalUsd, indexFraction).map((component): OrderLegIntent => ({
    id: `${signal.strategyId}:${signal.signalDate}:${component.symbol}`,
    role: 'index-fallback',
    instrument: component.symbol,
    side: component.notionalUsd > 0 ? 'buy' : 'hold',
    targetWeight: component.targetWeight * indexFraction,
    quantity: 0,
    notionalUsd: component.notionalUsd,
    sourceSynthetic: indexBasketSymbol,
  }))

  if (gasNotionalUsd > 0) {
    legs.push({
      id: `${signal.strategyId}:${signal.signalDate}:${signal.instrument}`,
      role: 'gas-overlay',
      instrument: signal.instrument,
      side: sideForSignal(signal),
      targetWeight: gasPosition,
      quantity: 0,
      notionalUsd: gasNotionalUsd,
    })
  }

  const cashFraction = clampFraction(signal.cashFraction ?? Math.max(0, 1 - indexFraction - Math.abs(gasPosition)))
  if (cashFraction > 0) {
    legs.push({
      id: `${signal.strategyId}:${signal.signalDate}:cash`,
      role: 'cash',
      instrument: 'CASH',
      side: 'hold',
      targetWeight: cashFraction,
      quantity: 0,
      notionalUsd: notionalUsd * cashFraction,
    })
  }

  return legs
}

export function evaluateSignalRisk(
  signal: StrategySignalIntent,
  policy: RiskPolicy = defaultDryRunRiskPolicy,
  context: RiskEvaluationContext = {},
): RiskDecision {
  const checks: RiskCheckResult[] = []
  const asOf = dateOrNull(context.asOf) ?? new Date()
  const requestedNotionalUsd = requestedNotionalFor(policy, context)
  const cappedNotionalUsd = Math.min(requestedNotionalUsd, capNotionalForSignal(signal, policy, context))

  if (!policy.allowedInstruments.includes(signal.instrument)) {
    addCheck(checks, 'instrument-allowed', 'Allowed instrument', 'instrument', 'block', `Instrument ${signal.instrument} is not allowed by ${policy.id}.`)
  } else {
    addCheck(checks, 'instrument-allowed', 'Allowed instrument', 'instrument', 'pass', `${signal.instrument} is allowed by ${policy.id}.`)
  }

  if (signal.sourceSynthetic && signal.sourceSynthetic !== indexBasketSymbol) {
    addCheck(
      checks,
      'synthetic-source',
      'Synthetic source',
      'instrument',
      'block',
      `Synthetic source ${signal.sourceSynthetic} is not recognized by ${policy.id}.`,
    )
  }

  if (!Number.isFinite(signal.confidence)) {
    addCheck(checks, 'confidence-scale', 'Confidence scale', 'confidence', 'block', 'Confidence is missing or not numeric.')
  } else if (policy.minConfidence !== undefined && signal.confidence < policy.minConfidence) {
    addCheck(
      checks,
      'confidence-minimum',
      'Minimum confidence',
      'confidence',
      'block',
      `Confidence ${signal.confidence.toFixed(2)} is below ${policy.minConfidence.toFixed(2)}.`,
    )
  } else {
    addCheck(checks, 'confidence-minimum', 'Minimum confidence', 'confidence', 'pass', `Confidence ${signal.confidence.toFixed(2)} clears the policy floor.`)
  }

  if (signal.confidence > policy.maxConfidence) {
    addCheck(checks, 'confidence-maximum', 'Maximum confidence', 'confidence', 'block', `Confidence ${signal.confidence.toFixed(2)} is above the accepted scale.`)
  }

  if (policy.maxHoldingDays !== undefined) {
    if (!Number.isFinite(signal.maxHoldingDays) || signal.maxHoldingDays <= 0) {
      addCheck(checks, 'holding-window', 'Holding window', 'holding-window', 'block', 'Holding window is missing or invalid.')
    } else if (signal.maxHoldingDays > policy.maxHoldingDays) {
      addCheck(checks, 'holding-window', 'Holding window', 'holding-window', 'block', `Holding window ${signal.maxHoldingDays}d exceeds ${policy.maxHoldingDays}d.`)
    } else {
      addCheck(checks, 'holding-window', 'Holding window', 'holding-window', 'pass', `Holding window ${signal.maxHoldingDays}d is within the cap.`)
    }
  }

  if (policy.liveRoutingEnabled && policy.mode !== 'live') {
    addCheck(checks, 'live-routing-mode', 'Live routing', 'architecture', 'block', 'Live routing requires a live-mode risk policy.')
  } else if (policy.liveRoutingEnabled) {
    addCheck(checks, 'live-routing-mode', 'Live routing', 'architecture', 'pass', 'Live routing is permitted by this policy when the broker gateway gates also pass.')
  } else {
    addCheck(checks, 'no-live-routing', 'Live routing', 'architecture', 'pass', 'Policy is paper/dry-run only.')
  }

  if (signal.direction === 'short' && policy.allowShortGas === false) {
    addCheck(checks, 'short-gas-allowed', 'Short gas exposure', 'exposure', 'block', 'Short gas exposure is disabled by this policy.')
  }

  if (context.requestedNotionalUsd !== undefined && requestedNotionalUsd <= 0) {
    addCheck(checks, 'positive-notional', 'Positive notional', 'notional', 'block', 'Requested notional must be positive.')
  }
  if (cappedNotionalUsd <= 0 && signal.direction !== 'flat') {
    addCheck(checks, 'risk-budget', 'Risk budget', 'notional', 'block', 'No risk budget remains after policy sizing checks.')
  } else if (requestedNotionalUsd > cappedNotionalUsd) {
    addCheck(
      checks,
      'notional-cap',
      'Notional cap',
      'notional',
      'warn',
      `Requested $${Math.round(requestedNotionalUsd).toLocaleString()} is capped to $${Math.round(cappedNotionalUsd).toLocaleString()} by ${policy.id}.`,
    )
  } else if (policy.maxNotionalUsd !== undefined) {
    addCheck(
      checks,
      'notional-cap',
      'Notional cap',
      'notional',
      'pass',
      `Requested notional is within the $${Math.round(policy.maxNotionalUsd).toLocaleString()} policy cap.`,
    )
  } else if (context.requestedNotionalUsd !== undefined) {
    addCheck(checks, 'notional-preserved', 'Notional preserved', 'notional', 'pass', 'No sizing cap is applied; requested notional is preserved.')
  }

  if (policy.requireAccountContext && !context.account) {
    addCheck(checks, 'account-context', 'Account context', 'portfolio', 'block', 'Account equity, cash, loss, and open-intent context is required.')
  }
  if (context.account) {
    if (policy.maxOpenIntents !== undefined && context.account.openIntentCount >= policy.maxOpenIntents) {
      addCheck(
        checks,
        'open-intent-count',
        'Open intents',
        'portfolio',
        'block',
        `${context.account.openIntentCount} open intent(s) already meet or exceed the ${policy.maxOpenIntents} intent cap.`,
      )
    } else if (policy.maxOpenIntents !== undefined) {
      addCheck(checks, 'open-intent-count', 'Open intents', 'portfolio', 'pass', `${context.account.openIntentCount} open intent(s) is below the cap.`)
    }
    if (policy.maxDailyLossPct && (context.account.dayPnlPct ?? 0) <= -Math.abs(policy.maxDailyLossPct)) {
      addCheck(
        checks,
        'daily-loss-stop',
        'Daily loss stop',
        'drawdown',
        'block',
        `Daily P&L ${context.account.dayPnlPct}% breaches the ${policy.maxDailyLossPct}% loss stop.`,
      )
    }
    if (policy.maxTrailingDrawdownPct && (context.account.trailingDrawdownPct ?? 0) <= -Math.abs(policy.maxTrailingDrawdownPct)) {
      addCheck(
        checks,
        'trailing-drawdown-stop',
        'Trailing drawdown stop',
        'drawdown',
        'block',
        `Trailing drawdown ${context.account.trailingDrawdownPct}% breaches the ${policy.maxTrailingDrawdownPct}% stop.`,
      )
    }
    if (policy.maxConsecutiveLosses && (context.account.consecutiveLosses ?? 0) >= policy.maxConsecutiveLosses) {
      addCheck(
        checks,
        'loss-streak-stop',
        'Loss streak stop',
        'drawdown',
        'block',
        `${context.account.consecutiveLosses} consecutive losses meet or exceed the ${policy.maxConsecutiveLosses} loss cap.`,
      )
    }
    if (hasRecentLossCooldown(context, policy, asOf)) {
      addCheck(
        checks,
        'loss-cooldown',
        'Loss cooldown',
        'drawdown',
        'block',
        `Last loss on ${context.account.lastLossDate} is inside the ${policy.cooldownDaysAfterLoss}d cooldown.`,
      )
    }
  }

  if (policy.requireOperatorContext && !context.operator) {
    addCheck(checks, 'operator-context', 'Operator state', 'operations', 'block', 'Autonomous operator state is required so kill-switch and venue-open checks cannot be skipped.')
  }
  if (policy.requireManualApproval && !context.operator?.manualApproval) {
    addCheck(checks, 'manual-approval', 'Manual approval', 'operations', 'block', 'Manual operator approval is required before this guardrail order intent can pass.')
  } else if (policy.requireManualApproval) {
    addCheck(checks, 'manual-approval', 'Manual approval', 'operations', 'pass', 'Manual approval is present.')
  }
  if (context.operator?.killSwitchEngaged) {
    addCheck(checks, 'kill-switch', 'Kill switch', 'operations', 'block', 'Operator kill switch is engaged.')
  }
  if (context.operator?.venueOpen === false) {
    addCheck(checks, 'venue-open', 'Venue open', 'operations', 'block', 'Execution venue is marked closed.')
  }

  if (policy.maxSignalAgeDays) {
    const signalAgeDays = ageDays(asOf, signal.generatedAt)
    if (signalAgeDays === null || signalAgeDays < 0) {
      addCheck(checks, 'signal-freshness', 'Signal freshness', 'freshness', 'block', 'Signal generation time is missing, invalid, or in the future.')
    } else if (signalAgeDays > policy.maxSignalAgeDays) {
      addCheck(checks, 'signal-freshness', 'Signal freshness', 'freshness', 'block', `Signal is ${signalAgeDays.toFixed(1)}d old; cap is ${policy.maxSignalAgeDays}d.`)
    } else {
      addCheck(checks, 'signal-freshness', 'Signal freshness', 'freshness', 'pass', `Signal age ${signalAgeDays.toFixed(1)}d is fresh enough.`)
    }
  }

  if (policy.requireFreshWeatherContext && !context.weather) {
    addCheck(checks, 'weather-context', 'Weather context', 'freshness', 'block', 'Fresh weather model context is required.')
  }
  if (context.weather) {
    const weatherAgeHours = ageHours(asOf, context.weather.forecastIssuedAt)
    if (policy.maxWeatherIssueAgeHours && (weatherAgeHours === null || weatherAgeHours < 0 || weatherAgeHours > policy.maxWeatherIssueAgeHours)) {
      addCheck(
        checks,
        'weather-freshness',
        'Weather issue freshness',
        'freshness',
        'block',
        weatherAgeHours === null
          ? 'Weather issue time is invalid.'
          : `Weather issue is ${weatherAgeHours.toFixed(1)}h old; cap is ${policy.maxWeatherIssueAgeHours}h.`,
      )
    } else {
      addCheck(checks, 'weather-freshness', 'Weather issue freshness', 'freshness', 'pass', 'Weather issue time is inside the freshness window.')
    }
    if (policy.minWeatherSourceCount && context.weather.sourceCount < policy.minWeatherSourceCount) {
      addCheck(checks, 'weather-source-count', 'Weather source count', 'freshness', 'block', `${context.weather.sourceCount} weather source(s) supplied; floor is ${policy.minWeatherSourceCount}.`)
    }
    if (policy.minWeatherCoveragePct && context.weather.coveragePct < policy.minWeatherCoveragePct) {
      addCheck(checks, 'weather-coverage', 'Weather coverage', 'freshness', 'block', `Weather coverage ${context.weather.coveragePct}% is below the ${policy.minWeatherCoveragePct}% floor.`)
    }
    if (
      policy.minWeatherDirectionalAccuracyPct &&
      context.weather.directionalAccuracyPct !== undefined &&
      context.weather.directionalAccuracyPct < policy.minWeatherDirectionalAccuracyPct
    ) {
      addCheck(
        checks,
        'weather-directional-accuracy',
        'Weather directional accuracy',
        'freshness',
        'warn',
        `Weather directional accuracy ${context.weather.directionalAccuracyPct}% is below the ${policy.minWeatherDirectionalAccuracyPct}% caution line.`,
      )
    }
  }

  if (policy.requireStorageContext && !context.storage) {
    addCheck(checks, 'storage-context', 'Storage context', 'freshness', 'block', 'Fresh EIA storage context is required.')
  }
  if (context.storage && policy.maxStorageDataAgeDays) {
    const storageAgeDays = ageDays(asOf, context.storage.reportedAt)
    if (storageAgeDays === null || storageAgeDays < 0 || storageAgeDays > policy.maxStorageDataAgeDays) {
      addCheck(
        checks,
        'storage-freshness',
        'Storage freshness',
        'freshness',
        'block',
        storageAgeDays === null ? 'Storage report time is invalid.' : `Storage report is ${storageAgeDays.toFixed(1)}d old; cap is ${policy.maxStorageDataAgeDays}d.`,
      )
    } else {
      addCheck(checks, 'storage-freshness', 'Storage freshness', 'freshness', 'pass', 'Storage report is inside the freshness window.')
    }
  }

  if (policy.requireMarketContext && !context.market) {
    addCheck(checks, 'market-context', 'Market context', 'market', 'block', 'Fresh market price context is required.')
  }
  if (context.market) {
    const marketAgeMinutes = ageMinutes(asOf, context.market.priceUpdatedAt)
    if (policy.maxMarketDataAgeMinutes && (marketAgeMinutes === null || marketAgeMinutes < 0 || marketAgeMinutes > policy.maxMarketDataAgeMinutes)) {
      addCheck(
        checks,
        'market-freshness',
        'Market data freshness',
        'market',
        'block',
        marketAgeMinutes === null
          ? 'Market update time is invalid.'
          : `Market prices are ${marketAgeMinutes.toFixed(0)}m old; cap is ${policy.maxMarketDataAgeMinutes}m.`,
      )
    } else {
      addCheck(checks, 'market-freshness', 'Market data freshness', 'market', 'pass', 'Market prices are inside the freshness window.')
    }

    instrumentsForSignal(signal).forEach((instrument) => {
      const price = context.market?.referencePrices[instrument]
      if (price === undefined || price === null || price <= 0) {
        addCheck(checks, `reference-price-${instrument}`, `${instrument} reference price`, 'market', 'block', `Missing positive reference price for ${instrument}.`)
      } else if (policy.minReferencePriceUsd && price < policy.minReferencePriceUsd) {
        addCheck(
          checks,
          `reference-price-${instrument}`,
          `${instrument} reference price`,
          'market',
          'block',
          `${instrument} reference price $${price} is below $${policy.minReferencePriceUsd}.`,
        )
      }

      if (policy.maxAllowedSpreadBps !== undefined) {
        const spreadBps = context.market?.spreadsBps?.[instrument]
        if (spreadBps === undefined || !Number.isFinite(spreadBps) || spreadBps < 0) {
          addCheck(
            checks,
            `spread-${instrument}`,
            `${instrument} spread`,
            'market',
            'block',
            `Missing finite non-negative spread for ${instrument}; cap is ${policy.maxAllowedSpreadBps} bps.`,
          )
        } else if (spreadBps > policy.maxAllowedSpreadBps) {
          addCheck(checks, `spread-${instrument}`, `${instrument} spread`, 'market', 'block', `${instrument} spread ${spreadBps} bps exceeds the ${policy.maxAllowedSpreadBps} bps cap.`)
        } else {
          addCheck(checks, `spread-${instrument}`, `${instrument} spread`, 'market', 'pass', `${instrument} spread ${spreadBps} bps is inside the ${policy.maxAllowedSpreadBps} bps cap.`)
        }
      }
    })
  }

  const reasons = checks.filter((check) => check.status === 'block').map((check) => check.detail)
  const warnings = checks.filter((check) => check.status === 'warn').map((check) => check.detail)

  return {
    approved: reasons.length === 0,
    mode: policy.mode,
    reasons,
    warnings,
    checks,
    cappedNotionalUsd,
  }
}

export function createOrderIntent(
  signal: StrategySignalIntent,
  requestedNotionalUsd: number,
  policy: RiskPolicy = defaultDryRunRiskPolicy,
  context: RiskEvaluationContext = {},
): OrderIntent {
  const riskDecision = evaluateSignalRisk(signal, policy, { ...context, requestedNotionalUsd })
  const notionalUsd = Math.min(Math.max(0, requestedNotionalUsd), riskDecision.cappedNotionalUsd)
  const legs = orderLegsForSignal(signal, notionalUsd)

  return {
    id: `${signal.strategyId}:${signal.signalDate}:${signal.targetDate}:${signal.instrument}`,
    mode: policy.mode,
    createdAt: new Date().toISOString(),
    signal,
    side: sideForSignal(signal),
    quantity: 0,
    notionalUsd,
    legs,
    riskDecision,
  }
}
