import indexBasketConfigJson from '../../data/qore/market/index-basket-config.json?raw'
import type { IndexBasketComponentCode, SyntheticInstrumentCode } from './types'

type IndexBasketConfig = {
  symbol: SyntheticInstrumentCode
  label: string
  methodology: string
  rebalance: 'daily-target-weight'
  components: {
    symbol: IndexBasketComponentCode
    label: string
    targetWeight: number
    role: string
  }[]
}

export const indexBasketConfig = JSON.parse(indexBasketConfigJson) as IndexBasketConfig
export const indexBasketSymbol = indexBasketConfig.symbol
export const indexBasketExecutionComponents = indexBasketConfig.components

export function indexBasketComponentNotional(totalNotionalUsd: number, indexFraction = 1) {
  const safeNotional = Math.max(0, totalNotionalUsd)
  const safeIndexFraction = Math.max(0, Math.min(1, indexFraction))
  return indexBasketExecutionComponents.map((component) => ({
    ...component,
    notionalUsd: safeNotional * safeIndexFraction * component.targetWeight,
  }))
}
