import { createOrderIntent, defaultDryRunRiskPolicy } from './risk'
import type { ExecutionGateway, OrderIntent, PaperFill, RiskPolicy, StrategySignalIntent } from './types'

export const dryRunGatewayProfile = {
  id: 'qore-dry-run-paper-gateway',
  label: 'Dry-run paper gateway',
  mode: 'paper',
  brokerConnected: false,
  liveRoutingEnabled: false,
  purpose: 'Turns approved research signals into auditable paper fills without broker credentials or network order routing.',
} as const

export function estimatePaperQuantity(notionalUsd: number, referencePrice: number) {
  if (referencePrice <= 0 || notionalUsd <= 0) return 0
  return Math.floor(notionalUsd / referencePrice)
}

export function createPaperOrderIntent(
  signal: StrategySignalIntent,
  requestedNotionalUsd: number,
  referencePrice: number,
  policy: RiskPolicy = defaultDryRunRiskPolicy,
): OrderIntent {
  const intent = createOrderIntent(signal, requestedNotionalUsd, policy)
  return {
    ...intent,
    quantity: estimatePaperQuantity(intent.notionalUsd, referencePrice),
  }
}

export function paperFillFromIntent(intent: OrderIntent, referencePrice: number): PaperFill {
  if (!intent.riskDecision.approved || intent.side === 'hold') {
    return {
      orderIntentId: intent.id,
      filledAt: new Date().toISOString(),
      fillPrice: referencePrice,
      quantity: 0,
      notionalUsd: 0,
      status: 'paper-rejected',
      notes: intent.riskDecision.reasons.length ? intent.riskDecision.reasons : ['No executable side.'],
    }
  }

  const quantity = estimatePaperQuantity(intent.notionalUsd, referencePrice)

  return {
    orderIntentId: intent.id,
    filledAt: new Date().toISOString(),
    fillPrice: referencePrice,
    quantity,
    notionalUsd: quantity * referencePrice,
    status: quantity > 0 ? 'paper-filled' : 'paper-rejected',
    notes: quantity > 0 ? ['Dry-run fill only. No broker order was routed.'] : ['Reference price produced zero quantity.'],
  }
}

export class DryRunPaperGateway implements ExecutionGateway {
  mode = 'paper' as const
  referencePrice: number

  constructor(referencePrice = 1) {
    this.referencePrice = referencePrice
  }

  submitOrderIntent(intent: OrderIntent) {
    return paperFillFromIntent(intent, this.referencePrice)
  }
}
