import { createOrderIntent, defaultDryRunRiskPolicy } from './risk'
import type {
  ExecutionGateway,
  OrderIntent,
  OrderLegIntent,
  PaperFill,
  PaperReferencePrices,
  RiskEvaluationContext,
  RiskPolicy,
  StrategySignalIntent,
} from './types'

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

function executableLegs(intent: OrderIntent) {
  return intent.legs.filter((leg) => leg.instrument !== 'CASH' && leg.side !== 'hold' && leg.notionalUsd > 0)
}

function referencePriceForLeg(
  leg: OrderLegIntent,
  referencePrices: number | PaperReferencePrices,
  executableLegCount: number,
) {
  if (leg.instrument === 'CASH') return 1
  if (typeof referencePrices === 'number') {
    return executableLegCount === 1 ? referencePrices : null
  }
  return referencePrices[leg.instrument] ?? null
}

function quantityForLeg(leg: OrderLegIntent, referencePrices: number | PaperReferencePrices, executableLegCount: number) {
  const referencePrice = referencePriceForLeg(leg, referencePrices, executableLegCount)
  if (!referencePrice) return 0
  return estimatePaperQuantity(leg.notionalUsd, referencePrice)
}

export function createPaperOrderIntent(
  signal: StrategySignalIntent,
  requestedNotionalUsd: number,
  referencePrices: number | PaperReferencePrices,
  policy: RiskPolicy = defaultDryRunRiskPolicy,
  context: RiskEvaluationContext = {},
): OrderIntent {
  const intent = createOrderIntent(signal, requestedNotionalUsd, policy, context)
  const executableLegCount = executableLegs(intent).length
  const aggregateReferencePrice =
    typeof referencePrices === 'number'
      ? executableLegCount <= 1
        ? referencePrices
        : null
      : referencePrices[intent.signal.instrument] ?? null
  return {
    ...intent,
    quantity: aggregateReferencePrice ? estimatePaperQuantity(intent.notionalUsd, aggregateReferencePrice) : 0,
    legs: intent.legs.map((leg) => ({
      ...leg,
      quantity: quantityForLeg(leg, referencePrices, executableLegCount),
    })),
  }
}

export function paperFillFromIntent(intent: OrderIntent, referencePrices: number | PaperReferencePrices): PaperFill {
  if (!intent.riskDecision.approved || intent.side === 'hold') {
    return {
      orderIntentId: intent.id,
      filledAt: new Date().toISOString(),
      fillPrice: typeof referencePrices === 'number' ? referencePrices : 0,
      quantity: 0,
      notionalUsd: 0,
      status: 'paper-rejected',
      notes: intent.riskDecision.reasons.length ? intent.riskDecision.reasons : ['No executable side.'],
    }
  }

  const executable = executableLegs(intent)
  if (!executable.length) {
    return {
      orderIntentId: intent.id,
      filledAt: new Date().toISOString(),
      fillPrice: typeof referencePrices === 'number' ? referencePrices : 0,
      quantity: 0,
      notionalUsd: 0,
      status: 'paper-rejected',
      notes: ['No executable leg.'],
    }
  }

  const legFills = executable.map((leg) => {
    const fillPrice = referencePriceForLeg(leg, referencePrices, executable.length) ?? 0
    const quantity = estimatePaperQuantity(leg.notionalUsd, fillPrice)
    return {
      orderLegId: leg.id,
      instrument: leg.instrument,
      side: leg.side,
      fillPrice,
      quantity,
      notionalUsd: quantity * fillPrice,
      status: quantity > 0 ? ('paper-filled' as const) : ('paper-rejected' as const),
    }
  })
  const missingPrices = legFills.filter((fill) => fill.fillPrice <= 0).map((fill) => fill.instrument)
  const rejectedLegs = legFills.filter((fill) => fill.status === 'paper-rejected')
  const status = missingPrices.length || rejectedLegs.length ? 'paper-rejected' : 'paper-filled'

  return {
    orderIntentId: intent.id,
    filledAt: new Date().toISOString(),
    fillPrice: typeof referencePrices === 'number' ? referencePrices : 0,
    quantity: legFills.reduce((sum, fill) => sum + fill.quantity, 0),
    notionalUsd: legFills.reduce((sum, fill) => sum + fill.notionalUsd, 0),
    status,
    notes:
      status === 'paper-filled'
        ? ['Dry-run fill only. No broker order was routed.']
        : missingPrices.length
          ? [`Missing reference price for ${missingPrices.join(', ')}.`]
          : ['Reference price produced zero quantity.'],
    legFills,
  }
}

export class DryRunPaperGateway implements ExecutionGateway {
  mode = 'paper' as const
  referencePrices: number | PaperReferencePrices

  constructor(referencePrices: number | PaperReferencePrices = 1) {
    this.referencePrices = referencePrices
  }

  submitOrderIntent(intent: OrderIntent) {
    return paperFillFromIntent(intent, this.referencePrices)
  }
}
