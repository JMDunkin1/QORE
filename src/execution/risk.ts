import { indexBasketComponentNotional, indexBasketSymbol } from './indexBasket'
import type { OrderIntent, OrderLegIntent, RiskDecision, RiskPolicy, StrategySignalIntent } from './types'

export const defaultDryRunRiskPolicy: RiskPolicy = {
  id: 'dry-run-research-policy-v1',
  mode: 'paper',
  allowedInstruments: ['UNG', 'NG', 'MNG', 'QG', 'VOO', 'QQQM'],
  maxConfidence: 1,
  minConfidence: 0.55,
  maxHoldingDays: 12,
  maxNotionalUsd: 25000,
  maxOpenIntents: 1,
  liveRoutingEnabled: false,
}

export const paperExecutionReadinessGates = [
  {
    id: 'no-live-routing',
    label: 'Live routing disabled',
    status: 'locked',
    detail: 'No broker client is instantiated and the risk policy type keeps liveRoutingEnabled false.',
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
    label: 'Broker adapter absent',
    status: 'locked',
    detail: 'Future broker work must implement a separate gateway and cannot reuse the dry-run gateway by accident.',
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

export function evaluateSignalRisk(signal: StrategySignalIntent, policy: RiskPolicy = defaultDryRunRiskPolicy): RiskDecision {
  const reasons: string[] = []

  if (!policy.allowedInstruments.includes(signal.instrument)) {
    reasons.push(`Instrument ${signal.instrument} is not allowed by ${policy.id}.`)
  }

  if (signal.sourceSynthetic && signal.sourceSynthetic !== indexBasketSymbol) {
    reasons.push(`Synthetic source ${signal.sourceSynthetic} is not recognized by ${policy.id}.`)
  }

  if (signal.confidence < policy.minConfidence) {
    reasons.push(`Confidence ${signal.confidence.toFixed(2)} is below ${policy.minConfidence.toFixed(2)}.`)
  }

  if (signal.confidence > policy.maxConfidence) {
    reasons.push(`Confidence ${signal.confidence.toFixed(2)} is above the accepted scale.`)
  }

  if (signal.maxHoldingDays > policy.maxHoldingDays) {
    reasons.push(`Holding window ${signal.maxHoldingDays}d exceeds ${policy.maxHoldingDays}d.`)
  }

  if (policy.liveRoutingEnabled) {
    reasons.push('Live routing is not permitted in this architecture.')
  }

  return {
    approved: reasons.length === 0,
    mode: policy.mode,
    reasons,
    cappedNotionalUsd: policy.maxNotionalUsd,
  }
}

export function createOrderIntent(
  signal: StrategySignalIntent,
  requestedNotionalUsd: number,
  policy: RiskPolicy = defaultDryRunRiskPolicy,
): OrderIntent {
  const riskDecision = evaluateSignalRisk(signal, policy)
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
