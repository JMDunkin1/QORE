function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function validateIndexBasketConfig(config, { source = 'index basket config' } = {}) {
  if (!config?.components?.length) throw new Error(`Missing components in ${source}.`)
  const seen = new Set()
  const components = config.components.map((component) => {
    const symbol = String(component?.symbol ?? '').trim().toUpperCase()
    const targetWeight = finiteNumber(component?.targetWeight)
    if (!['VOO', 'QQQM'].includes(symbol)) {
      throw new Error(`${source} contains unsupported component symbol "${symbol || 'missing'}".`)
    }
    if (seen.has(symbol)) throw new Error(`${source} contains duplicate component symbol ${symbol}.`)
    if (targetWeight === null || targetWeight <= 0) {
      throw new Error(`${source} component ${symbol} must have a positive finite targetWeight.`)
    }
    seen.add(symbol)
    return { ...component, symbol, targetWeight }
  })
  const symbols = [...seen].sort()
  if (symbols.length !== 2 || symbols[0] !== 'QQQM' || symbols[1] !== 'VOO') {
    throw new Error(`${source} must contain exactly one VOO component and one QQQM component.`)
  }
  const totalWeight = components.reduce((sum, component) => sum + component.targetWeight, 0)
  if (!Number.isFinite(totalWeight) || Math.abs(totalWeight - 1) > 0.001) {
    throw new Error(`${source} component weights must sum to 1 within 0.001 (received ${round(totalWeight)}).`)
  }
  return {
    ...config,
    components: components.map((component) => ({ ...component, targetWeight: component.targetWeight / totalWeight })),
  }
}
