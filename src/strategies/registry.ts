import type { Strategy } from '../types'
import { arcticBlastResearchBacktestResults, arcticBlastResearchStrategies } from './arcticBlast'
import { predictionTimeLadderResearchBacktestResults, predictionTimeLadderResearchStrategies } from './predictionTimeLadder'

export const registeredStrategies: Strategy[] = []
export const researchStrategyRegistry = [...arcticBlastResearchStrategies, ...predictionTimeLadderResearchStrategies]
export const researchBacktestResults = [...arcticBlastResearchBacktestResults, ...predictionTimeLadderResearchBacktestResults]
export { arcticBlastPromotionGates, createArcticBlastSignalIntent, findArcticBlastStrategy } from './arcticBlast'
export type {
  ArcticBlastResearchBacktestResult,
  ArcticBlastResearchStrategy,
  ArcticBlastSignalInput,
  ArcticBlastStrategyFamily,
  StrategyPromotionStatus,
} from './arcticBlast'
export type {
  PredictionTimeLadderBacktestResult,
  PredictionTimeLadderResearchStrategy,
  PredictionTimeLadderTrade,
} from './predictionTimeLadder'
