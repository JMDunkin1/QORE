import type { Strategy } from '../types'
import { arcticBlastResearchStrategies } from './arcticBlast'

export const registeredStrategies: Strategy[] = []
export const researchStrategyRegistry = arcticBlastResearchStrategies
export { arcticBlastPromotionGates, createArcticBlastSignalIntent, findArcticBlastStrategy } from './arcticBlast'
export type {
  ArcticBlastResearchStrategy,
  ArcticBlastSignalInput,
  ArcticBlastStrategyFamily,
  StrategyPromotionStatus,
} from './arcticBlast'
