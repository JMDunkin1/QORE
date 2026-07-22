const EPSILON = 1e-12

export const REBALANCE_DEADBAND_POLICY_ID = 'risk-reductions-and-ung-transitions-bypass-v1'

function finiteNumber(value, label) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number.`)
  return parsed
}

export function rebalanceDecision({
  symbol,
  current,
  target,
  deadband,
  forceRiskReduction = false,
}) {
  const currentValue = finiteNumber(current, 'rebalance current value')
  const targetValue = finiteNumber(target, 'rebalance target value')
  const deadbandValue = finiteNumber(deadband, 'rebalance deadband')
  if (deadbandValue < 0) throw new Error('rebalance deadband must be non-negative.')

  const delta = targetValue - currentValue
  if (Math.abs(delta) <= EPSILON) return { executes: false, reason: 'at-target', delta }

  const currentIsFlat = Math.abs(currentValue) <= EPSILON
  const targetIsFlat = Math.abs(targetValue) <= EPSILON
  const signFlip = !currentIsFlat && !targetIsFlat && Math.sign(currentValue) !== Math.sign(targetValue)
  const riskReduction = Math.abs(targetValue) + EPSILON < Math.abs(currentValue)

  if (symbol === 'UNG') {
    if (currentIsFlat && !targetIsFlat) return { executes: true, reason: 'ung-entry', delta }
    if (!currentIsFlat && targetIsFlat) return { executes: true, reason: 'ung-exit', delta }
    if (signFlip) return { executes: true, reason: 'ung-sign-flip', delta }
    if (riskReduction) return { executes: true, reason: 'ung-risk-reduction', delta }
  }
  if (forceRiskReduction && riskReduction) {
    return { executes: true, reason: 'portfolio-risk-reduction', delta }
  }
  if (Math.abs(delta) + EPSILON >= deadbandValue) {
    return { executes: true, reason: 'outside-deadband', delta }
  }
  return { executes: false, reason: 'inside-deadband', delta }
}

export function rebalanceDecisionsForAllocation({
  legs,
  deadband,
  forceRiskReduction = false,
}) {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new Error('rebalance allocation legs must be a non-empty array.')
  }
  const normalizedLegs = legs.map((leg) => ({
    symbol: String(leg?.symbol ?? ''),
    current: finiteNumber(leg?.current, 'rebalance current value'),
    target: finiteNumber(leg?.target, 'rebalance target value'),
  }))
  if (normalizedLegs.some((leg) => !leg.symbol)) {
    throw new Error('rebalance allocation leg symbol must be non-empty.')
  }
  if (new Set(normalizedLegs.map((leg) => leg.symbol)).size !== normalizedLegs.length) {
    throw new Error('rebalance allocation leg symbols must be unique.')
  }

  const preliminary = normalizedLegs.map((leg) => rebalanceDecision({
    ...leg,
    deadband,
    forceRiskReduction,
  }))
  const executesGrossIncrease = preliminary.some((decision, index) => (
    decision.executes
    && Math.abs(normalizedLegs[index].target) > Math.abs(normalizedLegs[index].current) + EPSILON
  ))
  const forcePairedReductions = forceRiskReduction || executesGrossIncrease

  return Object.fromEntries(normalizedLegs.map((leg, index) => [
    leg.symbol,
    forcePairedReductions
      ? rebalanceDecision({ ...leg, deadband, forceRiskReduction: true })
      : preliminary[index],
  ]))
}
