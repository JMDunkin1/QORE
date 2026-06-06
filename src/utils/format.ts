export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function signedPercent(value: number, digits = 2) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatNumber(value, digits)}%`
}

export function classForSigned(value: number) {
  if (value > 0.05) return 'positive'
  if (value < -0.05) return 'negative'
  return 'neutral'
}
