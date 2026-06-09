import type { OrderIntent, RiskDecision, RiskPolicy, StrategySignalIntent } from './types'

export const defaultDryRunRiskPolicy: RiskPolicy = {
  id: 'dry-run-research-policy-v1',
  mode: 'paper',
  allowedInstruments: ['UNG', 'NG', 'MNG', 'QG'],
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

export function evaluateSignalRisk(signal: StrategySignalIntent, policy: RiskPolicy = defaultDryRunRiskPolicy): RiskDecision {
  const reasons: string[] = []

  if (!policy.allowedInstruments.includes(signal.instrument)) {
    reasons.push(`Instrument ${signal.instrument} is not allowed by ${policy.id}.`)
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

  return {
    id: `${signal.strategyId}:${signal.signalDate}:${signal.targetDate}:${signal.instrument}`,
    mode: policy.mode,
    createdAt: new Date().toISOString(),
    signal,
    side: sideForSignal(signal),
    quantity: 0,
    notionalUsd,
    riskDecision,
  }
}
