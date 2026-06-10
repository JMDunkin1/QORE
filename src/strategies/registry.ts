import type { Strategy } from '../types'
import { arcticBlastResearchBacktestResults, arcticBlastResearchStrategies } from './arcticBlast'

export const registeredStrategies: Strategy[] = []
export const researchStrategyRegistry = arcticBlastResearchStrategies
export const researchBacktestResults = arcticBlastResearchBacktestResults
export { arcticBlastPromotionGates, createArcticBlastSignalIntent, findArcticBlastStrategy } from './arcticBlast'
export type {
  ArcticBlastResearchBacktestResult,
  ArcticBlastResearchStrategy,
  ArcticBlastSignalInput,
  ArcticBlastStrategyFamily,
  StrategyPromotionStatus,
} from './arcticBlast'
