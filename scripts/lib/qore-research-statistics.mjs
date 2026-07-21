function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}

export function downsideDeviation(returns, minimumAcceptableReturn = 0) {
  if (!returns.length) return 0
  return Math.sqrt(
    mean(returns.map((value) => Math.min(value - minimumAcceptableReturn, 0) ** 2)),
  )
}

export function laggedRollingAnnualizedVolPct(
  returnPercentages,
  currentIndex,
  lookback = 20,
  tradingDays = 252,
) {
  const startIndex = Math.max(0, currentIndex - lookback)
  const availableReturns = returnPercentages
    .slice(startIndex, currentIndex)
    .map((value) => value / 100)
  return sampleStandardDeviation(availableReturns) * Math.sqrt(tradingDays) * 100
}

export function volatilityTargetedFraction({
  annualizedVolPct,
  baseFraction,
  confidence,
  maximumScale = 1.25,
  minimumScale = 0.35,
  targetVolPct,
}) {
  const volatilityScale = annualizedVolPct > 0
    ? Math.max(minimumScale, Math.min(maximumScale, targetVolPct / annualizedVolPct))
    : 1
  return baseFraction * confidence * volatilityScale
}
