import {
  type ChangeEvent,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudSun,
  Database,
  Download,
  FileUp,
  Gauge,
  GitBranch,
  GitCommit,
  LineChart as LineChartIcon,
  Play,
  RadioTower,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  UploadCloud,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './App.css'
import indexBasketCsv from '../data/qore/market/yahoo/US-INDEX-BASKET-qore-market.csv?raw'
import ungMarketCsv from '../data/qore/market/yahoo/UNG-qore-market.csv?raw'
import { defaultSettings, joinMarketWeather } from './backtesting/engine'
import { SmoothZoomChart, type SmoothChartSeries } from './components/SmoothZoomChart'
import { realDataCatalog, totalLocationRows, totalSignalReturns, totalSignalScores } from './data/realDataCatalog'
import { sharedWeatherMetrics } from './data/weatherAccuracy'
import { defaultDryRunRiskPolicy, dryRunGatewayProfile, paperExecutionReadinessGates } from './execution'
import { fetchGithubStatus, pushToGithub, updateFromGithub, type GithubStatus } from './githubControl'
import { executionVenues, integrationConnectors } from './integrations/connectors'
import { evaluateWeatherModel } from './ml/evaluation'
import { researchBacktestResults, researchStrategyRegistry } from './strategies/registry'
import type { ActiveView, MarketBar, WeatherPoint } from './types'
import { classForSigned, formatCompact, formatCurrency, formatNumber, signedPercent } from './utils/format'
import { parseMarketCsv, parseWeatherCsv } from './utils/importers'

const navItems: Array<{ id: ActiveView; label: string; icon: ElementType }> = [
  { id: 'overview', label: 'Command', icon: Gauge },
  { id: 'backtest', label: 'Backtest', icon: LineChartIcon },
  { id: 'models', label: 'Models', icon: Brain },
  { id: 'data', label: 'Data Ops', icon: Database },
  { id: 'execution', label: 'Execution', icon: RadioTower },
  { id: 'github', label: 'GitHub', icon: GitBranch },
]

const activeViews: ActiveView[] = ['overview', 'backtest', 'models', 'data', 'execution', 'github']
const chartMargin = { top: 16, right: 18, bottom: 4, left: 0 }
const maxChartWheelZoomPower = 4
const maxSvgZoomPowerPerInput = 2.25
const svgWheelZoomPowerPerPixel = 0.08
const svgWebKitGestureZoomGain = 3.5
const minSvgViewportWidth = 18
const primaryRankMinTrades = 8
const minZoomWindow = 4
const sparseStrategyGapBreakDays = 45
const strategyDetailLineMaxPoints = 80
const millisecondsPerYear = 365.25 * 24 * 60 * 60 * 1000
const benchmarkLabel = 'UNG buy/hold'
const indexBenchmarkLabel = 'VOO/QQQM index basket'
const researchRankReturnPct = (result: (typeof researchBacktestResults)[number]) =>
  isPredictionCrossMarketStrategy(result.strategy) ? result.metrics.totalReturnPct : result.metrics.cagrPct
const researchRankScore = (result: (typeof researchBacktestResults)[number]) => {
  const samplePenalty = result.metrics.tradeCount >= primaryRankMinTrades ? 0 : -10000
  const tradeCountCredit = Math.min(result.metrics.tradeCount, 100) * 0.03
  return samplePenalty + researchRankReturnPct(result) + result.metrics.sharpe * 8 + result.metrics.calmar * 4 + result.metrics.maxDrawdownPct * 0.4 + tradeCountCredit
}
const sortResearchResults = (a: (typeof researchBacktestResults)[number], b: (typeof researchBacktestResults)[number]) =>
  researchRankScore(b) - researchRankScore(a) ||
  researchRankReturnPct(b) - researchRankReturnPct(a) ||
  b.metrics.sharpe - a.metrics.sharpe ||
  b.metrics.calmar - a.metrics.calmar ||
  b.metrics.totalReturnPct - a.metrics.totalReturnPct
const activeStrategyLabel = (count = researchStrategyRegistry.length) => `${count} active research ${count === 1 ? 'strategy' : 'strategies'} loaded`
const defaultSelectedBacktest = [...researchBacktestResults].sort(sortResearchResults)[0] ?? null
const defaultSelectedStrategyId = defaultSelectedBacktest?.strategy.id ?? ''
const benchmarkMarketBars = parseMarketCsv(ungMarketCsv).sort((a, b) => a.date.localeCompare(b.date))
const indexBenchmarkMarketBars = parseMarketCsv(indexBasketCsv).sort((a, b) => a.date.localeCompare(b.date))
const tooltipStyle = {
  background: '#ffffff',
  border: '1px solid #d8dde4',
  borderRadius: 8,
  boxShadow: '0 18px 50px rgba(32, 39, 50, 0.14)',
  color: '#18202b',
}

function viewFromHash(): ActiveView {
  const hash = window.location.hash.replace('#', '')
  return activeViews.includes(hash as ActiveView) ? (hash as ActiveView) : 'overview'
}

type MetricCardProps = {
  label: string
  value: string
  detail: string
  icon: ElementType
  tone?: 'positive' | 'negative' | 'neutral' | 'warning'
}

type DashboardChartPoint = {
  chartIndex: number
  date: string
  [key: string]: string | number | null | undefined
  equity: number | null
  equityPct: number | null
  dailyPnlPct: number | null
  drawdownPct: number | null
  close: number
  weatherSurprise: number
  hddError: number
  position: number | null
  signal: number | null
  gasReturnPct: number
  activeTradeReturnPct: number | null
  demandScore: number
  storageBcf: number
  closeScaled: number | null
  benchmarkPct: number | null
  indexBenchmarkPct: number | null
  sourceId?: string
  windowId?: string
  netReturnPct?: number
}

type ResearchTrade = (typeof researchBacktestResults)[number]['trades'][number]
type ResearchBacktestResult = (typeof researchBacktestResults)[number]
type Tone = 'positive' | 'negative' | 'neutral' | 'warning'
type ChartRange = {
  startIndex: number
  endIndex: number
}
type SvgViewport = {
  x: number
  y: number
  width: number
  height: number
}
type WebKitGestureEvent = Event & {
  clientX?: number
  clientY?: number
  scale?: number
}
type SplitEdgeName = 'train' | 'validation' | 'holdout' | 'current' | 'all'
type WeatherSideSeason = 'winter' | 'summer' | 'all-year' | 'prediction'
type CurrentPaperScanFreshness = {
  isFresh?: boolean
  generatedDate?: string | null
  latestObservedDate?: string | null
  latestExitDate?: string | null
  latestTargetDate?: string | null
}
type RealityCheckPercentiles = {
  p05: number
  p50: number
  p95: number
}
type RealityCheckMetrics = {
  method?: string
  comparison?: string
  alternative?: string
  pValue?: number | null
  singleCandidatePValue?: number | null
  selectionAdjustedPValue?: number | null
  observedAverageDailyEdgePct?: number
  observedAnnualizedEdgePct?: number
  dailyActiveVolPct?: number
  standardErrorDailyEdgePct?: number
  meanConfidenceIntervalDailyEdgePct?: RealityCheckPercentiles
  nullConfidenceIntervalDailyEdgePct?: RealityCheckPercentiles
  nullMaxMeanDailyEdgePct?: RealityCheckPercentiles | null
  candidateFamilySize?: number
  bestObservedCandidateId?: string | null
  bestObservedAverageDailyEdgePct?: number | null
  sampleCount?: number
  selectedSampleCount?: number
  activeOverlayDays?: number
  minimumResolvablePValue?: number | null
  iterations?: number
  blockLength?: number
  componentPValues?: Record<string, number>
  limitation?: string
}
type WeatherSideDefinition = {
  id: string
  label: string
  seasons?: readonly WeatherSideSeason[]
  thesisKinds: readonly string[]
}
type StrategySelectorItem = {
  id: string
  name: string
  family: string
  status: string
  returnPct: number
  color: string
  selected: boolean
}
type CandidateDiagnostics = {
  selectedCandidateId?: string
  selectedCandidateIds?: string[]
  candidateCount?: number
  eligibleCandidateCount?: number
  selectionUsedHoldout?: boolean
  validationScope?: 'historical-holdout' | 'current-paper-scan'
  candidates?: CandidateRecord[]
}
type CandidateRecord = Record<string, unknown>
type CandidateMetricRow = {
  id: string
  index: number
  eligible: boolean
  selected: boolean
  trainValidationRank: number | null
  trainEdgePct: number | null
  validationEdgePct: number | null
  holdoutEdgePct: number | null
  allEdgePct: number | null
  trainReturnPct: number | null
  validationReturnPct: number | null
  holdoutReturnPct: number | null
  trainSharpe: number | null
  validationSharpe: number | null
  holdoutSharpe: number | null
  trainMaxDrawdownPct: number | null
  validationMaxDrawdownPct: number | null
  holdoutMaxDrawdownPct: number | null
  source: CandidateRecord
}
type CandidateParameterDefinition = {
  label: string
  keys: readonly string[]
  order?: readonly string[]
  nominal?: boolean
}
type ParameterHeatmapCell = {
  xKey: string
  yKey: string
  xLabel: string
  yLabel: string
  candidateCount: number
  averageHoldoutEdgePct: number | null
  averageTrainValidationEdgePct: number | null
  selected: boolean
  localNeighbor: boolean
  stablePlateau: boolean
}
type ParameterStabilitySummary = {
  selectedHoldoutEdgePct: number | null
  selectedTrainValidationEdgePct: number | null
  stableThresholdPct: number | null
  localCellCount: number
  localStableCellCount: number
  globalStableCellCount: number
  scorePct: number | null
  label: 'Broad plateau' | 'Mixed surface' | 'Isolated spike' | 'No selected cell'
  detail: string
}
type ParameterHeatmapPlot = {
  xLabel: string
  yLabel: string
  xValues: Array<{ key: string; label: string }>
  yValues: Array<{ key: string; label: string }>
  cells: ParameterHeatmapCell[]
  valueMin: number
  valueMax: number
  stability: ParameterStabilitySummary
}
type ParameterComparisonCell = ParameterHeatmapCell & {
  displayLabel: string
  normalizedValue: number
}
type MonteCarloStressPath = {
  id: string
  label: string
  selected: boolean
  eligible: boolean
  color: string
  points: number[]
  finalValue: number
}
type MonteCarloStressPlot = {
  paths: MonteCarloStressPath[]
  startValue: number
  valueMin: number
  valueMax: number
  positiveFinalPct: number
  sampleCount: number
  blockLength: number
  simulationCount: number
}
type HeatmapSurfacePixel = {
  x: number
  y: number
  width: number
  height: number
  value: number
}
const validationParameterDefinitions: readonly CandidateParameterDefinition[] = [
  { label: 'Component lane', keys: ['componentValidationLane'], nominal: true },
  { label: 'Weather resolution', keys: ['weatherResolutionPolicy', 'weatherResolutionMode'], order: ['none', 'graded-shift', 'graded-shift-sizing'] },
  {
    label: 'Storage gate',
    keys: ['coldFollowStoragePolicy'],
    order: ['storage-seasonal-tight', 'storage-drawdown-400bcf-or-seasonal-tight', 'storage-drawdown-400bcf'],
  },
  { label: 'Freshness gate', keys: ['followFreshnessPolicy'], order: ['fresh-follow-5d', 'fresh-follow-3d', 'none'] },
  { label: 'Demand gate', keys: ['heatingDemandPolicy'], order: ['none', 'hdd-follow-gate-6f', 'hdd-follow-tiered'] },
  { label: 'Long fade scale', keys: ['reversionLongScale'] },
  { label: 'Standalone fade', keys: ['standaloneReversionScale'] },
  { label: 'Overlay cap', keys: ['overlayCap'] },
  { label: 'Risk multiplier', keys: ['overlayRiskMultiplier'] },
  { label: 'Weather size', keys: ['weatherFraction'] },
  { label: 'Reversion size', keys: ['reversionFraction'] },
  { label: 'Follow hold', keys: ['followHoldDays', 'holdFollowDays'] },
  { label: 'Fade hold', keys: ['reversionHoldDays', 'holdReversionDays'] },
  { label: 'Fresh heat', keys: ['freshHeatLookbackDays'] },
  { label: 'Storage heat tilt', keys: ['storageDeficitHeatMultiplier'] },
  { label: 'Min edge', keys: ['minGrossEdgeCents'] },
  { label: 'Spacing', keys: ['minSpacingHours'] },
  { label: 'Fee haircut', keys: ['feeHaircutCents'] },
  { label: 'Capital canary', keys: ['capitalAllocationPct'] },
]

const compactParameterLabels: Record<string, string> = {
  Missing: 'Not used',
  'graded-shift': 'Graded fade',
  'graded-shift-sizing': 'Graded sizing',
  'hdd-follow-gate-6f': 'HDD gate 6F',
  'hdd-follow-tiered': 'HDD tiered',
  'fresh-follow-3d': 'Fresh 3d',
  'fresh-follow-5d': 'Fresh 5d',
  none: 'None',
  'storage-drawdown-400bcf': '400 Bcf draw',
  'storage-drawdown-400bcf-or-seasonal-tight': '400 Bcf or tight',
  'storage-seasonal-tight': 'Seasonal tight',
}
const heatmapColorStops = [
  { at: 0, color: [49, 21, 99] },
  { at: 0.42, color: [41, 121, 142] },
  { at: 0.72, color: [82, 190, 121] },
  { at: 1, color: [244, 224, 64] },
] as const
const monteCarloPalette = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#0891b2', '#ca8a04', '#db2777', '#111827']

const weatherSideDefinitions: readonly WeatherSideDefinition[] = [
  { id: 'time-ladder-package', label: 'Time-ladder package', seasons: ['prediction'], thesisKinds: ['time-ladder-package'] },
  { id: 'cross-venue-rv', label: 'Cross-venue RV', seasons: ['prediction'], thesisKinds: ['cross-venue-rv'] },
  { id: 'cold-long', label: 'Cold-long', seasons: ['winter', 'all-year'], thesisKinds: ['cold-long'] },
  { id: 'warm-short', label: 'Warm-short', seasons: ['winter', 'all-year'], thesisKinds: ['warm-short'] },
  { id: 'summer-cold-short', label: 'Summer cold-short', seasons: ['summer', 'all-year'], thesisKinds: ['summer-cold-short'] },
  { id: 'summer-heat-long', label: 'Summer heat-long', seasons: ['summer', 'all-year'], thesisKinds: ['summer-heat-long'] },
  { id: 'reversion-long', label: 'Reversion-long', thesisKinds: ['reversion-long'] },
  { id: 'reversion-short', label: 'Reversion-short', thesisKinds: ['reversion-short'] },
  { id: 'index-fallback', label: 'Index fallback', thesisKinds: ['index-fallback'] },
]

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function finiteNumbers(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
}

function parameterRawValue(candidate: CandidateRecord, definition: CandidateParameterDefinition) {
  for (const key of definition.keys) {
    const value = candidate[key]
    if (value !== null && value !== undefined && value !== '') return value
  }
  return null
}

function parameterFingerprint(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Missing'
  return String(value)
}

function compactParameterValue(value: unknown) {
  const fingerprint = parameterFingerprint(value)
  if (compactParameterLabels[fingerprint]) return compactParameterLabels[fingerprint]
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const numericValue = numberOrNull(value)
  if (numericValue !== null) return formatNumber(numericValue, Number.isInteger(numericValue) ? 0 : 2)
  return fingerprint.replaceAll('-', ' ')
}

function parameterSortRank(value: string, definition: CandidateParameterDefinition) {
  const orderedIndex = definition.order?.indexOf(value) ?? -1
  if (orderedIndex >= 0) return { bucket: 0, value: orderedIndex, label: value }
  const numericValue = Number(value)
  if (Number.isFinite(numericValue)) return { bucket: 1, value: numericValue, label: value }
  return { bucket: 2, value: 0, label: value }
}

function sortParameterValuesFor(definition: CandidateParameterDefinition) {
  return (a: string, b: string) => {
    const rankA = parameterSortRank(a, definition)
    const rankB = parameterSortRank(b, definition)
    return rankA.bucket - rankB.bucket || rankA.value - rankB.value || rankA.label.localeCompare(rankB.label)
  }
}

function parameterAxisQuality(definition: CandidateParameterDefinition) {
  if (definition.nominal) return 0
  return definition.order ? 1.1 : 1
}

function strategyCandidateDiagnostics(strategy: ResearchBacktestResult['strategy'] | null | undefined): CandidateDiagnostics | null {
  const diagnostics = strategy?.params.candidateDiagnostics
  if (!diagnostics || typeof diagnostics !== 'object') return null
  const value = diagnostics as CandidateDiagnostics
  return Array.isArray(value.candidates) ? value : null
}

function candidateMetricRows(diagnostics: CandidateDiagnostics | null): CandidateMetricRow[] {
  const selectedCandidateId = diagnostics?.selectedCandidateId
  const selectedCandidateIds = new Set([selectedCandidateId, ...(diagnostics?.selectedCandidateIds ?? [])].filter(Boolean))
  return (diagnostics?.candidates ?? [])
    .map((candidate, index) => {
      const id = typeof candidate.candidateId === 'string' ? candidate.candidateId : `candidate-${index + 1}`
      return {
        id,
        index,
        eligible: candidate.eligible === true || candidate.selectionEligible === true,
        selected: selectedCandidateIds.has(id),
        trainValidationRank: numberOrNull(candidate.trainValidationRank),
        trainEdgePct: numberOrNull(candidate.trainEdgePct),
        validationEdgePct: numberOrNull(candidate.validationEdgePct),
        holdoutEdgePct: numberOrNull(candidate.holdoutEdgePct),
        allEdgePct: numberOrNull(candidate.allEdgePct),
        trainReturnPct: numberOrNull(candidate.trainReturnPct),
        validationReturnPct: numberOrNull(candidate.validationReturnPct),
        holdoutReturnPct: numberOrNull(candidate.holdoutReturnPct),
        trainSharpe: numberOrNull(candidate.trainSharpe),
        validationSharpe: numberOrNull(candidate.validationSharpe),
        holdoutSharpe: numberOrNull(candidate.holdoutSharpe),
        trainMaxDrawdownPct: numberOrNull(candidate.trainMaxDrawdownPct),
        validationMaxDrawdownPct: numberOrNull(candidate.validationMaxDrawdownPct),
        holdoutMaxDrawdownPct: numberOrNull(candidate.holdoutMaxDrawdownPct),
        source: candidate,
      }
    })
    .filter((candidate) => finiteNumbers([candidate.trainEdgePct, candidate.validationEdgePct, candidate.holdoutEdgePct]).length > 0)
}

function trainValidationEdge(candidate: CandidateMetricRow) {
  return average(finiteNumbers([candidate.trainEdgePct, candidate.validationEdgePct]))
}

function selectedCandidateRow(candidates: CandidateMetricRow[]) {
  return candidates.find((candidate) => candidate.selected) ?? candidates[0] ?? null
}

function parameterAxisCandidates(candidates: CandidateMetricRow[]) {
  return validationParameterDefinitions
    .map((definition) => {
      const values = new Set<string>()
      let coverage = 0
      let selectedCoverage = 0
      candidates.forEach((candidate) => {
        const key = parameterFingerprint(parameterRawValue(candidate.source, definition))
        if (key === 'Missing') return
        values.add(key)
        coverage += 1
        if (candidate.selected) selectedCoverage += 1
      })
      return {
        definition,
        values: [...values].sort(sortParameterValuesFor(definition)),
        coverage,
        selectedCoverage,
      }
    })
    .filter((axis) => axis.values.length > 1)
    .sort(
      (a, b) =>
        parameterAxisQuality(b.definition) - parameterAxisQuality(a.definition) ||
        b.values.length - a.values.length ||
        b.coverage - a.coverage ||
        b.selectedCoverage - a.selectedCoverage,
    )
}

function emptyParameterStabilitySummary(): ParameterStabilitySummary {
  return {
    selectedHoldoutEdgePct: null,
    selectedTrainValidationEdgePct: null,
    stableThresholdPct: null,
    localCellCount: 0,
    localStableCellCount: 0,
    globalStableCellCount: 0,
    scorePct: null,
    label: 'No selected cell',
    detail: 'No selected setting was found on this surface.',
  }
}

function buildParameterStabilitySummary(cells: ParameterHeatmapCell[], xValues: string[], yValues: string[]): ParameterStabilitySummary {
  const selectedCell = cells
    .filter((cell) => cell.selected && cell.averageHoldoutEdgePct !== null)
    .sort((a, b) => (b.averageHoldoutEdgePct ?? Number.NEGATIVE_INFINITY) - (a.averageHoldoutEdgePct ?? Number.NEGATIVE_INFINITY))[0]
  if (!selectedCell || selectedCell.averageHoldoutEdgePct === null) return emptyParameterStabilitySummary()

  const selectedXIndex = xValues.indexOf(selectedCell.xKey)
  const selectedYIndex = yValues.indexOf(selectedCell.yKey)
  const populatedCells = cells.filter((cell) => cell.candidateCount > 0 && cell.averageHoldoutEdgePct !== null)
  const tolerancePct = Math.max(3, Math.abs(selectedCell.averageHoldoutEdgePct) * 0.18)
  const stableThresholdPct = selectedCell.averageHoldoutEdgePct - tolerancePct
  const localCells = populatedCells.filter((cell) => {
    const xIndex = xValues.indexOf(cell.xKey)
    const yIndex = yValues.indexOf(cell.yKey)
    return Math.abs(xIndex - selectedXIndex) <= 1 && Math.abs(yIndex - selectedYIndex) <= 1
  })
  const localStableCells = localCells.filter((cell) => (cell.averageHoldoutEdgePct ?? Number.NEGATIVE_INFINITY) >= stableThresholdPct)
  const globalStableCells = populatedCells.filter((cell) => (cell.averageHoldoutEdgePct ?? Number.NEGATIVE_INFINITY) >= stableThresholdPct)
  const scorePct = localCells.length ? (localStableCells.length / localCells.length) * 100 : null
  const label =
    scorePct === null
      ? 'No selected cell'
      : scorePct >= 70
        ? 'Broad plateau'
        : scorePct >= 35
          ? 'Mixed surface'
          : 'Isolated spike'
  const detail =
    scorePct === null
      ? 'No selected setting was found on this surface.'
      : `${formatNumber(localStableCells.length, 0)} of ${formatNumber(localCells.length, 0)} nearby cells stay within ${formatNumber(tolerancePct, 1)} pts of selected holdout.`

  return {
    selectedHoldoutEdgePct: selectedCell.averageHoldoutEdgePct,
    selectedTrainValidationEdgePct: selectedCell.averageTrainValidationEdgePct,
    stableThresholdPct,
    localCellCount: localCells.length,
    localStableCellCount: localStableCells.length,
    globalStableCellCount: globalStableCells.length,
    scorePct,
    label,
    detail,
  }
}

function annotateParameterStabilityCells(
  cells: ParameterHeatmapCell[],
  xValues: string[],
  yValues: string[],
  stability: ParameterStabilitySummary,
) {
  const selectedCell = cells
    .filter((cell) => cell.selected && cell.averageHoldoutEdgePct !== null)
    .sort((a, b) => (b.averageHoldoutEdgePct ?? Number.NEGATIVE_INFINITY) - (a.averageHoldoutEdgePct ?? Number.NEGATIVE_INFINITY))[0]
  if (!selectedCell || stability.stableThresholdPct === null) return cells
  const stableThresholdPct = stability.stableThresholdPct
  const selectedXIndex = xValues.indexOf(selectedCell.xKey)
  const selectedYIndex = yValues.indexOf(selectedCell.yKey)
  return cells.map((cell) => {
    const xIndex = xValues.indexOf(cell.xKey)
    const yIndex = yValues.indexOf(cell.yKey)
    const localNeighbor = Math.abs(xIndex - selectedXIndex) <= 1 && Math.abs(yIndex - selectedYIndex) <= 1
    return {
      ...cell,
      localNeighbor,
      stablePlateau: localNeighbor && cell.averageHoldoutEdgePct !== null && cell.averageHoldoutEdgePct >= stableThresholdPct,
    }
  })
}

function buildParameterHeatmapCells(
  rows: CandidateMetricRow[],
  xAxis: { definition: CandidateParameterDefinition },
  yAxis: { definition: CandidateParameterDefinition } | null,
  xValues: string[],
  yValues: string[],
) {
  const groups = new Map<string, CandidateMetricRow[]>()
  rows.forEach((candidate) => {
    const xKey = parameterFingerprint(parameterRawValue(candidate.source, xAxis.definition))
    const yKey = yAxis ? parameterFingerprint(parameterRawValue(candidate.source, yAxis.definition)) : 'All'
    const groupKey = `${xKey}\u0000${yKey}`
    const group = groups.get(groupKey) ?? []
    group.push(candidate)
    groups.set(groupKey, group)
  })

  return yValues.flatMap((yKey) =>
    xValues.map((xKey) => {
      const group = groups.get(`${xKey}\u0000${yKey}`) ?? []
      const holdoutEdges = finiteNumbers(group.map((row) => row.holdoutEdgePct))
      return {
        xKey,
        yKey,
        xLabel: compactParameterValue(xKey),
        yLabel: compactParameterValue(yKey),
        candidateCount: group.length,
        averageHoldoutEdgePct: holdoutEdges.length ? average(holdoutEdges) : null,
        averageTrainValidationEdgePct: group.length ? average(group.map(trainValidationEdge)) : null,
        selected: group.some((row) => row.selected),
        localNeighbor: false,
        stablePlateau: false,
      }
    }),
  )
}

function buildParameterHeatmapPlot(candidates: CandidateMetricRow[]): ParameterHeatmapPlot | null {
  const axes = parameterAxisCandidates(candidates)
  if (!axes.length) return null
  const pairOptions = axes
    .flatMap((xAxis) =>
      axes
        .filter((yAxis) => yAxis.definition.label !== xAxis.definition.label)
        .map((yAxis) => {
          const rows = candidates.filter((candidate) => {
            const xKey = parameterFingerprint(parameterRawValue(candidate.source, xAxis.definition))
            const yKey = parameterFingerprint(parameterRawValue(candidate.source, yAxis.definition))
            return xKey !== 'Missing' && yKey !== 'Missing'
          })
          const xValues = [
            ...new Set(rows.map((candidate) => parameterFingerprint(parameterRawValue(candidate.source, xAxis.definition)))),
          ].sort(sortParameterValuesFor(xAxis.definition))
          const yValues = [
            ...new Set(rows.map((candidate) => parameterFingerprint(parameterRawValue(candidate.source, yAxis.definition)))),
          ].sort(sortParameterValuesFor(yAxis.definition))
          const cells = buildParameterHeatmapCells(rows, xAxis, yAxis, xValues, yValues)
          const stability = buildParameterStabilitySummary(cells, xValues, yValues)
          const populatedCells = cells.filter((cell) => cell.candidateCount > 0 && cell.averageHoldoutEdgePct !== null)
          const values = finiteNumbers(cells.map((cell) => cell.averageHoldoutEdgePct))
          const holdoutSpread = values.length ? Math.max(...values) - Math.min(...values) : 0
          return { xAxis, yAxis, rows, xValues, yValues, cells, stability, populatedCells, holdoutSpread }
        }),
    )
    .filter(
      (option) =>
        option.xValues.length > 1 &&
        option.yValues.length > 1 &&
        option.populatedCells.length >= 4 &&
        option.stability.selectedHoldoutEdgePct !== null,
    )
    .sort(
      (a, b) =>
        parameterAxisQuality(b.xAxis.definition) +
          parameterAxisQuality(b.yAxis.definition) -
          (parameterAxisQuality(a.xAxis.definition) + parameterAxisQuality(a.yAxis.definition)) ||
        a.stability.localStableCellCount / Math.max(a.stability.localCellCount, 1) -
          b.stability.localStableCellCount / Math.max(b.stability.localCellCount, 1) ||
        b.xValues.length * b.yValues.length - a.xValues.length * a.yValues.length ||
        b.holdoutSpread - a.holdoutSpread ||
        b.rows.length - a.rows.length,
    )

  const fallbackAxis = axes.find((axis) => !axis.definition.nominal) ?? axes[0]
  const fallbackRows = candidates.filter(
    (candidate) => parameterFingerprint(parameterRawValue(candidate.source, fallbackAxis.definition)) !== 'Missing',
  )
  const fallbackXValues = [
    ...new Set(fallbackRows.map((candidate) => parameterFingerprint(parameterRawValue(candidate.source, fallbackAxis.definition)))),
  ].sort(sortParameterValuesFor(fallbackAxis.definition))
  const bestPair = pairOptions[0]
  const xAxis = bestPair?.xAxis ?? fallbackAxis
  const yAxis = bestPair?.yAxis
  const rows = bestPair?.rows ?? fallbackRows
  const xValues = bestPair?.xValues ?? fallbackXValues
  const yValues = bestPair?.yValues ?? ['All']
  if (!xValues.length || !yValues.length) return null

  const rawCells = bestPair?.cells ?? buildParameterHeatmapCells(rows, xAxis, yAxis ?? null, xValues, yValues)
  const stability = bestPair?.stability ?? buildParameterStabilitySummary(rawCells, xValues, yValues)
  const cells = annotateParameterStabilityCells(rawCells, xValues, yValues, stability)
  const values = finiteNumbers(cells.map((cell) => cell.averageHoldoutEdgePct))
  return {
    xLabel: xAxis.definition.label,
    yLabel: yAxis?.definition.label ?? 'Candidate set',
    xValues: xValues.map((key) => ({ key, label: compactParameterValue(key) })),
    yValues: yValues.map((key) => ({ key, label: compactParameterValue(key) })),
    cells,
    valueMin: values.length ? Math.min(...values) : 0,
    valueMax: values.length ? Math.max(...values) : 1,
    stability,
  }
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: string) {
  let state = hashString(seed) || 1
  return () => {
    state = Math.imul(state, 1664525) + 1013904223
    return (state >>> 0) / 4294967296
  }
}

function sampledReturnPathPoints(returnsPct: number[], startValue = 100) {
  const points = [startValue]
  let value = startValue
  returnsPct.forEach((returnPct) => {
    value = Math.max(startValue * 0.2, value * (1 + returnPct / 100))
    points.push(Number(value.toFixed(2)))
  })
  return points
}

function downsamplePathPoints(points: number[], maxPoints = 48) {
  if (points.length <= maxPoints) return points
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(maxPoints - 1, 1)) * (points.length - 1))
    return points[sourceIndex] ?? points[points.length - 1] ?? 100
  })
}

function bootstrapReturnPath(returnsPct: number[], simulationIndex: number, blockLength: number) {
  const random = seededRandom(`selected-active-path-${simulationIndex}`)
  const sampledReturns: number[] = []
  while (sampledReturns.length < returnsPct.length) {
    const startIndex = Math.floor(random() * returnsPct.length)
    for (let offset = 0; offset < blockLength && sampledReturns.length < returnsPct.length; offset += 1) {
      sampledReturns.push(returnsPct[(startIndex + offset) % returnsPct.length] ?? 0)
    }
  }
  return sampledReturns
}

function activeReturnPctForTrade(trade: ResearchTrade) {
  const netReturnPct = numberOrNull(trade.netReturnPct) ?? 0
  const indexReturnPct = numberOrNull(trade.indexReturnPct) ?? 0
  return netReturnPct - indexReturnPct
}

function buildMonteCarloStressPlot(trades: ResearchTrade[]): MonteCarloStressPlot {
  const startValue = 100
  const returnsPct = trades.map(activeReturnPctForTrade).filter((value) => Number.isFinite(value))
  const blockLength = Math.max(1, Math.min(10, Math.round(Math.sqrt(Math.max(returnsPct.length, 1)))))
  const simulationCount = returnsPct.length ? 120 : 0
  const simulatedPaths = Array.from({ length: simulationCount }, (_, simulationIndex) => {
    const sampledReturns = bootstrapReturnPath(returnsPct, simulationIndex, blockLength)
    const fullPoints = sampledReturnPathPoints(sampledReturns, startValue)
    return {
      id: `bootstrap-${simulationIndex}`,
      label: `Bootstrap ${simulationIndex + 1}`,
      selected: false,
      eligible: true,
      color: monteCarloPalette[simulationIndex % monteCarloPalette.length],
      points: downsamplePathPoints(fullPoints),
      finalValue: fullPoints[fullPoints.length - 1] ?? startValue,
    }
  })
  const observedFullPoints = sampledReturnPathPoints(returnsPct, startValue)
  const observedPath =
    returnsPct.length > 0
      ? [
          {
            id: 'observed-selected-path',
            label: 'Observed selected path',
            selected: true,
            eligible: true,
            color: '#111827',
            points: downsamplePathPoints(observedFullPoints),
            finalValue: observedFullPoints[observedFullPoints.length - 1] ?? startValue,
          },
        ]
      : []
  const paths = [...simulatedPaths, ...observedPath]
  const allValues = paths.flatMap((path) => path.points)
  const positiveFinalPct = simulatedPaths.length
    ? (simulatedPaths.filter((path) => path.finalValue >= startValue).length * 100) / simulatedPaths.length
    : 0
  return {
    paths,
    startValue,
    valueMin: allValues.length ? Math.min(...allValues) : startValue * 0.7,
    valueMax: allValues.length ? Math.max(...allValues) : startValue * 1.3,
    positiveFinalPct,
    sampleCount: returnsPct.length,
    blockLength,
    simulationCount,
  }
}

function interpolateColor(left: readonly number[], right: readonly number[], amount: number) {
  const value = Math.max(0, Math.min(amount, 1))
  return left.map((channel, index) => Math.round(channel + (right[index] - channel) * value))
}

function heatmapBackground(value: number | null, minValue: number, maxValue: number) {
  if (value === null) return '#eef2f7'
  const span = Math.max(maxValue - minValue, 0.001)
  const ratio = Math.max(0, Math.min(1, (value - minValue) / span))
  const rightStop = heatmapColorStops.find((stop) => stop.at >= ratio) ?? heatmapColorStops[heatmapColorStops.length - 1]
  const leftStop = [...heatmapColorStops].reverse().find((stop) => stop.at <= ratio) ?? heatmapColorStops[0]
  const stopSpan = Math.max(rightStop.at - leftStop.at, 0.001)
  const [red, green, blue] = interpolateColor(leftStop.color, rightStop.color, (ratio - leftStop.at) / stopSpan)
  return `rgb(${red}, ${green}, ${blue})`
}

function heatmapCellCenter(plot: ParameterHeatmapPlot, cell: ParameterHeatmapCell) {
  const xIndex = Math.max(0, plot.xValues.findIndex((value) => value.key === cell.xKey))
  const yIndex = Math.max(0, plot.yValues.findIndex((value) => value.key === cell.yKey))
  return {
    x: ((xIndex + 0.5) / Math.max(plot.xValues.length, 1)) * 100,
    y: ((yIndex + 0.5) / Math.max(plot.yValues.length, 1)) * 100,
  }
}

function buildHeatmapSurfacePixels(plot: ParameterHeatmapPlot, columns = 17, rows = 17): HeatmapSurfacePixel[] {
  const observations = plot.cells
    .filter((cell) => cell.averageHoldoutEdgePct !== null && cell.candidateCount > 0)
    .map((cell) => {
      const center = heatmapCellCenter(plot, cell)
      return {
        x: center.x / 100,
        y: center.y / 100,
        value: cell.averageHoldoutEdgePct ?? 0,
      }
    })
  if (!observations.length) return []
  const pixelWidth = 100 / columns
  const pixelHeight = 100 / rows
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = (column + 0.5) / columns
    const y = (row + 0.5) / rows
    let weightedValue = 0
    let totalWeight = 0
    observations.forEach((observation) => {
      const distance = Math.hypot(x - observation.x, y - observation.y)
      const weight = 1 / (distance * distance + 0.012)
      weightedValue += observation.value * weight
      totalWeight += weight
    })
    return {
      x: column * pixelWidth,
      y: row * pixelHeight,
      width: pixelWidth + 0.4,
      height: pixelHeight + 0.4,
      value: weightedValue / Math.max(totalWeight, 0.001),
    }
  })
}

function splitMetricParamForStrategy(
  strategy: ResearchBacktestResult['strategy'] | null | undefined,
  paramName: 'splitEdges' | 'splitAnnualEdges' | 'splitTotalReturns',
  split: SplitEdgeName,
) {
  const values = strategy?.params[paramName]
  if (!values || typeof values !== 'object') return null
  const value = (values as Partial<Record<SplitEdgeName, unknown>>)[split]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function splitEdgeForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined, split: SplitEdgeName) {
  return splitMetricParamForStrategy(strategy, 'splitEdges', split)
}

function splitAnnualEdgeForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined, split: SplitEdgeName) {
  return splitMetricParamForStrategy(strategy, 'splitAnnualEdges', split)
}

function splitTotalReturnForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined, split: SplitEdgeName) {
  return splitMetricParamForStrategy(strategy, 'splitTotalReturns', split) ?? splitEdgeForStrategy(strategy, split)
}

function realityCheckForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined): RealityCheckMetrics | null {
  const realityCheck = strategy?.params.realityCheck
  if (!realityCheck || typeof realityCheck !== 'object') return null
  const value = realityCheck as Partial<RealityCheckMetrics>
  const hasPValue = typeof value.pValue === 'number' && Number.isFinite(value.pValue)
  const hasValidationNote = typeof value.method === 'string' || typeof value.limitation === 'string'
  return hasPValue || hasValidationNote ? (value as RealityCheckMetrics) : null
}

function formatPValue(value: number | null | undefined, minimum?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  if (minimum && value <= minimum) return `<=${formatNumber(minimum, 4)}`
  if (value < 0.0001) return '<0.0001'
  return formatNumber(value, 4)
}

function componentPValueList(realityCheck: RealityCheckMetrics | null | undefined) {
  return Object.values(realityCheck?.componentPValues ?? {}).filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
}

function primaryPValueDetail(realityCheck: RealityCheckMetrics | null | undefined) {
  if (!realityCheck) return 'No reality check'
  if (typeof realityCheck.pValue !== 'number' || !Number.isFinite(realityCheck.pValue)) return 'No inferential p-value'
  if (componentPValueList(realityCheck).length > 1) return 'Fisher combined'
  return realityCheck.selectionAdjustedPValue === null || realityCheck.selectionAdjustedPValue === undefined
    ? 'Single strategy bootstrap'
    : 'Selection-adjusted bootstrap'
}

function roundNumber(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function benchmarkPctByDate(marketBars: MarketBar[], dates: string[], startDate: string | undefined) {
  const orderedDates = [...new Set(dates.filter(Boolean))].sort()
  if (!orderedDates.length) return new Map<string, number | null>()

  const baseDate = startDate || orderedDates[0]
  const lookupDates = [...new Set([baseDate, ...orderedDates])].sort()
  const closeByDate = new Map<string, number>()
  let marketIndex = 0
  let lastClose: number | null = null

  lookupDates.forEach((date) => {
    while (marketIndex < marketBars.length && marketBars[marketIndex].date <= date) {
      const close = marketBars[marketIndex].close
      if (Number.isFinite(close) && close > 0) lastClose = close
      marketIndex += 1
    }
    if (lastClose !== null) closeByDate.set(date, lastClose)
  })

  const baseClose = closeByDate.get(baseDate) ?? closeByDate.get(orderedDates[0])
  return new Map(
    orderedDates.map((date) => {
      const close = closeByDate.get(date)
      return [date, baseClose && close ? roundNumber((close / baseClose - 1) * 100) : null]
    }),
  )
}

function relativeBenchmarkReturn(values: Array<number | null | undefined>) {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value))
  if (finiteValues.length < 2) return finiteValues[0] ?? 0
  const start = 1 + finiteValues[0] / 100
  const end = 1 + finiteValues.at(-1)! / 100
  return start ? (end / start - 1) * 100 : 0
}

function annualizedReturnPct(totalReturnPct: number, startDate: string | undefined, endDate: string | undefined) {
  const startTime = Date.parse(startDate ?? '')
  const endTime = Date.parse(endDate ?? '')
  const years = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime
    ? (endTime - startTime) / millisecondsPerYear
    : 1 / 365.25
  return ((1 + totalReturnPct / 100) ** (1 / years) - 1) * 100
}

function isPredictionMarketStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined) {
  return strategy?.family === 'prediction-time-ladder' || strategy?.family === 'prediction-cross-market'
}

function isPredictionCrossMarketStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined) {
  return strategy?.family === 'prediction-cross-market' || strategy?.params.variant === 'cross-venue-rv'
}

function predictionMarketObservationWindowForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined) {
  if (!isPredictionMarketStrategy(strategy)) return null
  const dataAudit = strategy?.params.dataAudit
  if (!dataAudit || typeof dataAudit !== 'object') return null
  const audit = dataAudit as Record<string, unknown>
  const startDate = audit.historicalStartDate
  const endDate = audit.historicalEndDate
  return typeof startDate === 'string' && typeof endDate === 'string' && startDate && endDate ? { startDate, endDate } : null
}

function weatherSideSeasonForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined): WeatherSideSeason {
  if (isPredictionMarketStrategy(strategy)) return 'prediction'
  if (strategy?.family === 'weather-summer') return 'summer'
  if (strategy?.family === 'weather-alpha') return 'winter'
  return 'all-year'
}

function hasIndexBenchmarkForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined) {
  return !isPredictionMarketStrategy(strategy)
}

function validationScopeForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined) {
  return strategy?.params.validationScope === 'current-paper-scan' ? 'current-paper-scan' : 'historical-holdout'
}

function isCurrentPaperScanStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined) {
  return validationScopeForStrategy(strategy) === 'current-paper-scan'
}

function currentPaperScanFreshnessForStrategy(
  strategy: ResearchBacktestResult['strategy'] | null | undefined,
): CurrentPaperScanFreshness | null {
  const freshness = strategy?.params.currentPaperScanFreshness
  return freshness && typeof freshness === 'object' ? (freshness as CurrentPaperScanFreshness) : null
}

function currentPaperScanDateLabel(freshness: CurrentPaperScanFreshness | null) {
  return freshness?.latestObservedDate ?? freshness?.generatedDate ?? freshness?.latestExitDate ?? freshness?.latestTargetDate ?? null
}

function tradeHasThesisKind(trade: ResearchTrade, thesisKind: string) {
  if (trade.thesisKind === thesisKind) return true
  return trade.componentThesisKinds?.some((component) => component === thesisKind || component.endsWith(`:${thesisKind}`)) ?? false
}

function sideStatsForTrades(trades: ResearchTrade[], weatherSeason: WeatherSideSeason) {
  return weatherSideDefinitions.filter((side) => !side.seasons || side.seasons.includes(weatherSeason)).map((side) => {
    const sideTrades = trades.filter((trade) => side.thesisKinds.some((thesisKind) => tradeHasThesisKind(trade, thesisKind)))
    const totalReturnPct =
      weatherSeason === 'prediction'
        ? sideTrades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / 100
        : sideTrades.reduce((equity, trade) => equity * (1 + trade.netReturnPct / 100), 1) - 1
    const winRatePct = sideTrades.length
      ? (sideTrades.filter((trade) => trade.netReturnPct > 0).length / sideTrades.length) * 100
      : 0
    const averageTradeReturnPct = sideTrades.length
      ? sideTrades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / sideTrades.length
      : 0

    return {
      ...side,
      tradeCount: sideTrades.length,
      totalReturnPct: roundNumber(totalReturnPct * 100),
      winRatePct: roundNumber(winRatePct, 1),
      averageTradeReturnPct: roundNumber(averageTradeReturnPct),
    }
  })
}

type WeatherSideStats = ReturnType<typeof sideStatsForTrades>[number]

function SideSplitCard({ side, className = '' }: { side: WeatherSideStats; className?: string }) {
  return (
    <article className={`side-split-card${className ? ` ${className}` : ''}`}>
      <span>{side.label}</span>
      <strong className={classForSigned(side.totalReturnPct)}>{signedPercent(side.totalReturnPct)}</strong>
      <dl>
        <div>
          <dt>Trades</dt>
          <dd>{side.tradeCount}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{formatNumber(side.winRatePct, 1)}%</dd>
        </div>
        <div>
          <dt>Avg trade</dt>
          <dd className={classForSigned(side.averageTradeReturnPct)}>{signedPercent(side.averageTradeReturnPct)}</dd>
        </div>
      </dl>
    </article>
  )
}

function strategyPerformanceChartSeries(
  strategyColor: string | undefined,
  showDetailLines: boolean,
  options: { isPredictionMarket?: boolean; showBenchmarks?: boolean } = {},
): SmoothChartSeries<DashboardChartPoint>[] {
  const showBenchmarks = options.showBenchmarks ?? true
  const benchmarkSeries: SmoothChartSeries<DashboardChartPoint>[] = showBenchmarks
    ? [
        {
          axis: 'left',
          color: '#7c3aed',
          dashArray: '6 3',
          dataKey: 'indexBenchmarkPct',
          id: 'indexBenchmarkPct',
          label: `${indexBenchmarkLabel} %`,
          strokeWidth: 2,
          valueFormatter: (value) => signedPercent(roundNumber(value)),
        },
        {
          axis: 'left',
          color: '#475569',
          dashArray: '5 4',
          dataKey: 'benchmarkPct',
          id: 'benchmarkPct',
          label: `${benchmarkLabel} %`,
          strokeWidth: 2,
          valueFormatter: (value) => signedPercent(roundNumber(value)),
        },
      ]
    : []

  return [
    {
      axis: 'left',
      color: strategyColor ?? '#0891b2',
      dataKey: 'activeTradeReturnPct',
      fillOpacity: 0.2,
      id: 'activeTradeReturnPct',
      label: options.isPredictionMarket ? 'Package row return %' : 'Active leg return %',
      mode: 'bar',
      strokeOpacity: 0.3,
      valueFormatter: (value) => signedPercent(roundNumber(value)),
    },
    {
      axis: 'left',
      color: '#2563eb',
      dataKey: 'equityPct',
      fill: '#dbeafe',
      fillOpacity: 0.62,
      id: 'equityPct',
      label: 'Equity %',
      mode: 'area',
      strokeWidth: 2.4,
      valueFormatter: (value) => signedPercent(roundNumber(value)),
    },
    {
      axis: 'left',
      color: '#e11d48',
      dataKey: 'drawdownPct',
      id: 'drawdownPct',
      label: 'Drawdown %',
      strokeWidth: 2,
      valueFormatter: (value) => signedPercent(roundNumber(value)),
    },
    ...benchmarkSeries,
    {
      axis: 'right',
      color: '#0f766e',
      dataKey: 'position',
      id: 'position',
      label: 'Position',
      mode: 'step',
      strokeWidth: 2,
      valueFormatter: (value) => formatNumber(value),
      visible: showDetailLines,
    },
    {
      axis: 'right',
      color: '#f97316',
      dashArray: '4 3',
      dataKey: 'signal',
      id: 'signal',
      label: 'Signal',
      mode: 'step',
      strokeWidth: 2,
      valueFormatter: (value) => formatNumber(value),
      visible: showDetailLines,
    },
  ]
}

function marketOverviewChartSeries(): SmoothChartSeries<DashboardChartPoint>[] {
  return [
    {
      axis: 'left',
      color: '#2563eb',
      dataKey: 'equityPct',
      fill: '#dbeafe',
      fillOpacity: 0.62,
      id: 'equityPct',
      label: 'Equity %',
      mode: 'area',
      strokeWidth: 2,
      valueFormatter: (value) => signedPercent(roundNumber(value)),
    },
    {
      axis: 'left',
      color: '#7c3aed',
      dashArray: '6 3',
      dataKey: 'indexBenchmarkPct',
      id: 'indexBenchmarkPct',
      label: `${indexBenchmarkLabel} %`,
      strokeWidth: 2,
      valueFormatter: (value) => signedPercent(roundNumber(value)),
    },
    {
      axis: 'right',
      color: '#f97316',
      dataKey: 'closeScaled',
      id: 'secondary',
      label: 'Gas px x1000',
      strokeWidth: 2,
      valueFormatter: (value) => formatNumber(value),
    },
    {
      axis: 'left',
      color: '#e11d48',
      dataKey: 'drawdownPct',
      id: 'drawdownPct',
      label: 'Drawdown %',
      strokeWidth: 2,
      valueFormatter: (value) => signedPercent(roundNumber(value)),
    },
  ]
}

function sampleStatusFor(result: ResearchBacktestResult | null): { label: string; tone: Tone } {
  if (!result) return { label: 'Pending', tone: 'warning' }
  if (isCurrentPaperScanStrategy(result.strategy)) {
    const freshness = currentPaperScanFreshnessForStrategy(result.strategy)
    if (freshness?.isFresh === false) {
      const dateLabel = currentPaperScanDateLabel(freshness)
      return { label: dateLabel ? `Stale paper scan: ${dateLabel}` : 'Stale paper scan', tone: 'warning' }
    }
    return { label: 'Current paper scan', tone: 'warning' }
  }
  if (result.metrics.tradeCount < primaryRankMinTrades) {
    return { label: `Thin sample: ${result.metrics.tradeCount}/${primaryRankMinTrades}`, tone: 'warning' }
  }
  if (result.strategy.promotionStatus === 'needs-more-validation') return { label: 'Needs more validation', tone: 'warning' }
  if (result.metrics.maxDrawdownPct <= -20) return { label: 'Drawdown review', tone: 'warning' }
  if (result.strategy.promotionStatus === 'research-diagnostic') return { label: 'Research only', tone: 'warning' }
  return { label: 'Baseline sample', tone: 'positive' }
}

function MetricCard({ label, value, detail, icon: Icon, tone = 'neutral' }: MetricCardProps) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">
        <Icon size={18} aria-hidden="true" />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  )
}

function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string
  title: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="section-heading">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  )
}

function StrategyTitleSelect({
  items,
  selectedItem,
  selectedStrategyId,
  onSelectStrategy,
}: {
  items: StrategySelectorItem[]
  selectedItem: StrategySelectorItem | null
  selectedStrategyId: string
  onSelectStrategy: (strategyId: string) => void
}) {
  return (
    <label className="chart-title-strategy">
      <span className="chart-title-strategy-control">
        <span className="chart-title-strategy-swatch" style={{ background: selectedItem?.color ?? '#0f766e' }} />
        <span className="chart-title-strategy-name">{selectedItem?.name ?? 'No research strategies'}</span>
        <select
          value={selectedItem?.id ?? selectedStrategyId}
          disabled={!items.length}
          onChange={(event) => onSelectStrategy(event.currentTarget.value)}
          aria-label="Select chart strategy"
        >
          {items.length ? (
            items.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))
          ) : (
            <option value="">No research strategies</option>
          )}
        </select>
        <ChevronDown size={18} aria-hidden="true" />
      </span>
    </label>
  )
}

function ChartEmptyOverlay({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="chart-empty-overlay">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function fullSvgViewport(): SvgViewport {
  return { x: 0, y: 0, width: 100, height: 100 }
}

function clampSvgViewport(viewport: SvgViewport): SvgViewport {
  const width = Math.max(minSvgViewportWidth, Math.min(Number.isFinite(viewport.width) ? viewport.width : 100, 100))
  const height = Math.max(minSvgViewportWidth, Math.min(Number.isFinite(viewport.height) ? viewport.height : 100, 100))
  const x = Math.max(0, Math.min(Number.isFinite(viewport.x) ? viewport.x : 0, 100 - width))
  const y = Math.max(0, Math.min(Number.isFinite(viewport.y) ? viewport.y : 0, 100 - height))
  return { x, y, width, height }
}

function normalizeSvgWheelZoomPower(event: WheelEvent) {
  const deltaModeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1
  return -event.deltaY * deltaModeScale * svgWheelZoomPowerPerPixel
}

function zoomSvgViewportAtRatio(viewport: SvgViewport, zoomPower: number, anchorXRatio: number, anchorYRatio: number): SvgViewport {
  if (!Number.isFinite(zoomPower) || zoomPower === 0) return clampSvgViewport(viewport)
  const current = clampSvgViewport(viewport)
  const scale = 2 ** Math.max(-maxSvgZoomPowerPerInput, Math.min(zoomPower, maxSvgZoomPowerPerInput))
  const width = Math.max(minSvgViewportWidth, Math.min(100, current.width / scale))
  const height = Math.max(minSvgViewportWidth, Math.min(100, current.height / scale))
  const xRatio = clampRatio(anchorXRatio)
  const yRatio = clampRatio(anchorYRatio)
  const anchorX = current.x + current.width * xRatio
  const anchorY = current.y + current.height * yRatio
  return clampSvgViewport({ x: anchorX - width * xRatio, y: anchorY - height * yRatio, width, height })
}

function panSvgViewportByDelta(viewport: SvgViewport, deltaX: number, deltaY: number, frameWidth: number, frameHeight: number): SvgViewport {
  if ((!Number.isFinite(deltaX) || deltaX === 0) && (!Number.isFinite(deltaY) || deltaY === 0)) return clampSvgViewport(viewport)
  const current = clampSvgViewport(viewport)
  const x = frameWidth > 0 ? current.x + (deltaX / frameWidth) * current.width : current.x
  const y = frameHeight > 0 ? current.y + (deltaY / frameHeight) * current.height : current.y
  return clampSvgViewport({ x, y, width: current.width, height: current.height })
}

function isSvgViewportZoomed(viewport: SvgViewport) {
  const current = clampSvgViewport(viewport)
  return current.width < 99.999 || current.height < 99.999
}

function projectSvgX(viewport: SvgViewport, value: number) {
  const clamped = clampSvgViewport(viewport)
  return ((value - clamped.x) / clamped.width) * 100
}

function projectSvgY(viewport: SvgViewport, value: number) {
  const clamped = clampSvgViewport(viewport)
  return ((value - clamped.y) / clamped.height) * 100
}

function projectSvgWidth(viewport: SvgViewport, width: number) {
  return (width / clampSvgViewport(viewport).width) * 100
}

function projectSvgHeight(viewport: SvgViewport, height: number) {
  return (height / clampSvgViewport(viewport).height) * 100
}

function useSvgTrackpadViewport(enabled: boolean, resetKey: string) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const pendingViewportRef = useRef<SvgViewport>(fullSvgViewport())
  const frameRequestRef = useRef<number | null>(null)
  const gestureActiveRef = useRef(false)
  const gestureStartViewportRef = useRef<SvgViewport | null>(null)
  const gestureAnchorRatioRef = useRef({ x: 0.5, y: 0.5 })
  const [viewportState, setViewportState] = useState<{ resetKey: string; viewport: SvgViewport }>(() => ({
    resetKey,
    viewport: fullSvgViewport(),
  }))
  const viewport = viewportState.resetKey === resetKey ? viewportState.viewport : fullSvgViewport()

  useEffect(() => {
    const nextViewport = fullSvgViewport()
    pendingViewportRef.current = nextViewport
    gestureStartViewportRef.current = null
    gestureActiveRef.current = false
  }, [resetKey])

  useEffect(() => {
    pendingViewportRef.current = clampSvgViewport(viewport)
  }, [viewport])

  useEffect(() => {
    return () => {
      if (frameRequestRef.current !== null) window.cancelAnimationFrame(frameRequestRef.current)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const svg = svgRef.current
    if (!svg) return

    const anchorRatiosForClientPoint = (clientX: number | undefined, clientY: number | undefined) => {
      const rect = svg.getBoundingClientRect()
      return {
        x: clampRatio(((clientX ?? rect.left + rect.width / 2) - rect.left) / Math.max(rect.width, 1)),
        y: clampRatio(((clientY ?? rect.top + rect.height / 2) - rect.top) / Math.max(rect.height, 1)),
      }
    }

    const eventStartedInFrame = (event: Event) => {
      const gestureEvent = event as WebKitGestureEvent
      const target = event.target
      if (target instanceof Node && svg.contains(target)) return true
      if (typeof gestureEvent.clientX !== 'number') return false
      const rect = svg.getBoundingClientRect()
      const clientY = typeof gestureEvent.clientY === 'number' ? gestureEvent.clientY : rect.top + rect.height / 2
      return gestureEvent.clientX >= rect.left && gestureEvent.clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    }

    const scheduleViewport = (nextViewport: SvgViewport) => {
      pendingViewportRef.current = clampSvgViewport(nextViewport)
      if (frameRequestRef.current !== null) return
      frameRequestRef.current = window.requestAnimationFrame(() => {
        frameRequestRef.current = null
        setViewportState({ resetKey, viewport: pendingViewportRef.current })
      })
    }

    const handleWheel = (event: WheelEvent) => {
      const isPinchZoom = event.ctrlKey || event.metaKey
      const isZoomedPan = !isPinchZoom && isSvgViewportZoomed(pendingViewportRef.current)
      if (!isPinchZoom && !isZoomedPan) return

      if (event.cancelable) event.preventDefault()
      const rect = svg.getBoundingClientRect()
      let nextViewport = pendingViewportRef.current
      if (isZoomedPan) nextViewport = panSvgViewportByDelta(nextViewport, event.deltaX, event.deltaY, rect.width, rect.height)
      if (isPinchZoom) {
        const anchor = anchorRatiosForClientPoint(event.clientX, event.clientY)
        nextViewport = zoomSvgViewportAtRatio(nextViewport, normalizeSvgWheelZoomPower(event), anchor.x, anchor.y)
      }
      scheduleViewport(nextViewport)
    }

    const handleGestureStart = (event: Event) => {
      if (!eventStartedInFrame(event)) return
      if (event.cancelable) event.preventDefault()
      const gestureEvent = event as WebKitGestureEvent
      gestureActiveRef.current = true
      gestureStartViewportRef.current = pendingViewportRef.current
      gestureAnchorRatioRef.current = anchorRatiosForClientPoint(gestureEvent.clientX, gestureEvent.clientY)
    }

    const handleGestureChange = (event: Event) => {
      if (!gestureActiveRef.current) return
      if (event.cancelable) event.preventDefault()
      const gestureEvent = event as WebKitGestureEvent
      const scale = typeof gestureEvent.scale === 'number' && Number.isFinite(gestureEvent.scale) ? gestureEvent.scale : 1
      const zoomPower = Math.log2(Math.max(0.05, scale)) * svgWebKitGestureZoomGain
      const anchor = gestureAnchorRatioRef.current
      scheduleViewport(
        zoomSvgViewportAtRatio(
          gestureStartViewportRef.current ?? pendingViewportRef.current,
          zoomPower,
          anchor.x,
          anchor.y,
        ),
      )
    }

    const handleGestureEnd = () => {
      gestureActiveRef.current = false
      gestureStartViewportRef.current = null
    }

    svg.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('gesturestart', handleGestureStart, { capture: true, passive: false } as AddEventListenerOptions)
    window.addEventListener('gesturechange', handleGestureChange, { capture: true, passive: false } as AddEventListenerOptions)
    window.addEventListener('gestureend', handleGestureEnd, true)

    return () => {
      svg.removeEventListener('wheel', handleWheel)
      window.removeEventListener('gesturestart', handleGestureStart, true)
      window.removeEventListener('gesturechange', handleGestureChange, true)
      window.removeEventListener('gestureend', handleGestureEnd, true)
    }
  }, [enabled, resetKey])

  const clampedViewport = clampSvgViewport(viewport)
  return {
    svgRef,
    viewport: clampedViewport,
  }
}

function zoomSvgViewportXAtRatio(viewport: SvgViewport, zoomPower: number, anchorXRatio: number): SvgViewport {
  const current = clampSvgViewport(viewport)
  const next = zoomSvgViewportAtRatio(current, zoomPower, anchorXRatio, 0.5)
  return clampSvgViewport({ x: next.x, y: 0, width: next.width, height: 100 })
}

function panSvgViewportXByDelta(viewport: SvgViewport, deltaX: number, frameWidth: number): SvgViewport {
  const current = clampSvgViewport(viewport)
  const next = panSvgViewportByDelta(current, deltaX, 0, frameWidth, 1)
  return clampSvgViewport({ x: next.x, y: 0, width: next.width, height: 100 })
}

function useSvgTrackpadXViewport(enabled: boolean, resetKey: string) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const pendingViewportRef = useRef<SvgViewport>(fullSvgViewport())
  const frameRequestRef = useRef<number | null>(null)
  const gestureActiveRef = useRef(false)
  const gestureStartViewportRef = useRef<SvgViewport | null>(null)
  const gestureAnchorRatioRef = useRef(0.5)
  const [viewportState, setViewportState] = useState<{ resetKey: string; viewport: SvgViewport }>(() => ({
    resetKey,
    viewport: fullSvgViewport(),
  }))
  const viewport = viewportState.resetKey === resetKey ? viewportState.viewport : fullSvgViewport()

  useEffect(() => {
    const nextViewport = fullSvgViewport()
    pendingViewportRef.current = nextViewport
    gestureStartViewportRef.current = null
    gestureActiveRef.current = false
  }, [resetKey])

  useEffect(() => {
    const current = clampSvgViewport(viewport)
    pendingViewportRef.current = { x: current.x, y: 0, width: current.width, height: 100 }
  }, [viewport])

  useEffect(() => {
    return () => {
      if (frameRequestRef.current !== null) window.cancelAnimationFrame(frameRequestRef.current)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const svg = svgRef.current
    if (!svg) return

    const anchorRatioForClientX = (clientX: number | undefined) => {
      const rect = svg.getBoundingClientRect()
      return clampRatio(((clientX ?? rect.left + rect.width / 2) - rect.left) / Math.max(rect.width, 1))
    }

    const eventStartedInFrame = (event: Event) => {
      const gestureEvent = event as WebKitGestureEvent
      const target = event.target
      if (target instanceof Node && svg.contains(target)) return true
      if (typeof gestureEvent.clientX !== 'number') return false
      const rect = svg.getBoundingClientRect()
      const clientY = typeof gestureEvent.clientY === 'number' ? gestureEvent.clientY : rect.top + rect.height / 2
      return gestureEvent.clientX >= rect.left && gestureEvent.clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    }

    const scheduleViewport = (nextViewport: SvgViewport) => {
      const current = clampSvgViewport(nextViewport)
      pendingViewportRef.current = { x: current.x, y: 0, width: current.width, height: 100 }
      if (frameRequestRef.current !== null) return
      frameRequestRef.current = window.requestAnimationFrame(() => {
        frameRequestRef.current = null
        setViewportState({ resetKey, viewport: pendingViewportRef.current })
      })
    }

    const handleWheel = (event: WheelEvent) => {
      const isPinchZoom = event.ctrlKey || event.metaKey
      const isHorizontalPan = !isPinchZoom && Math.abs(event.deltaX) > Math.max(2, Math.abs(event.deltaY) * 1.35)
      if (!isPinchZoom && !isHorizontalPan) return

      if (event.cancelable) event.preventDefault()
      const rect = svg.getBoundingClientRect()
      let nextViewport = pendingViewportRef.current

      if (isHorizontalPan) nextViewport = panSvgViewportXByDelta(nextViewport, event.deltaX, rect.width)
      if (isPinchZoom) {
        nextViewport = zoomSvgViewportXAtRatio(nextViewport, normalizeSvgWheelZoomPower(event), anchorRatioForClientX(event.clientX))
      }

      scheduleViewport(nextViewport)
    }

    const handleGestureStart = (event: Event) => {
      if (!eventStartedInFrame(event)) return
      if (event.cancelable) event.preventDefault()
      const gestureEvent = event as WebKitGestureEvent
      gestureActiveRef.current = true
      gestureStartViewportRef.current = pendingViewportRef.current
      gestureAnchorRatioRef.current = anchorRatioForClientX(gestureEvent.clientX)
    }

    const handleGestureChange = (event: Event) => {
      if (!gestureActiveRef.current) return
      if (event.cancelable) event.preventDefault()
      const gestureEvent = event as WebKitGestureEvent
      const scale = typeof gestureEvent.scale === 'number' && Number.isFinite(gestureEvent.scale) ? gestureEvent.scale : 1
      const zoomPower = Math.log2(Math.max(0.05, scale)) * svgWebKitGestureZoomGain
      scheduleViewport(zoomSvgViewportXAtRatio(gestureStartViewportRef.current ?? pendingViewportRef.current, zoomPower, gestureAnchorRatioRef.current))
    }

    const handleGestureEnd = () => {
      gestureActiveRef.current = false
      gestureStartViewportRef.current = null
    }

    svg.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('gesturestart', handleGestureStart, { capture: true, passive: false } as AddEventListenerOptions)
    window.addEventListener('gesturechange', handleGestureChange, { capture: true, passive: false } as AddEventListenerOptions)
    window.addEventListener('gestureend', handleGestureEnd, true)

    return () => {
      svg.removeEventListener('wheel', handleWheel)
      window.removeEventListener('gesturestart', handleGestureStart, true)
      window.removeEventListener('gesturechange', handleGestureChange, true)
      window.removeEventListener('gestureend', handleGestureEnd, true)
    }
  }, [enabled, resetKey])

  const current = clampSvgViewport(viewport)
  return {
    svgRef,
    viewport: { x: current.x, y: 0, width: current.width, height: 100 },
  }
}

function ValidationEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="validation-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function parameterComparisonCells(plot: ParameterHeatmapPlot): ParameterComparisonCell[] {
  const cells = plot.cells.filter((cell) => cell.candidateCount > 0 && cell.averageHoldoutEdgePct !== null)
  const values = finiteNumbers(cells.map((cell) => cell.averageHoldoutEdgePct))
  const minValue = values.length ? Math.min(...values) : 0
  const maxValue = values.length ? Math.max(...values) : 0
  const span = Math.max(maxValue - minValue, 0.001)
  return cells.map((cell) => {
    const axisLabel = cell.yKey === 'All' ? cell.xLabel : `${cell.xLabel} / ${cell.yLabel}`
    const value = cell.averageHoldoutEdgePct ?? minValue
    return {
      ...cell,
      displayLabel: axisLabel,
      normalizedValue: values.length <= 1 ? 1 : 0.18 + ((value - minValue) / span) * 0.82,
    }
  })
}

function ParameterSmallFamilyCheck({ plot }: { plot: ParameterHeatmapPlot }) {
  const cells = parameterComparisonCells(plot)
  const values = finiteNumbers(cells.map((cell) => cell.averageHoldoutEdgePct))
  const minValue = values.length ? Math.min(...values) : null
  const maxValue = values.length ? Math.max(...values) : null
  const selectedCell = cells.find((cell) => cell.selected) ?? cells[0] ?? null
  const rangePct = minValue === null || maxValue === null ? null : maxValue - minValue
  return (
    <div className="parameter-comparison" role="img" aria-label={`${plot.xLabel} small candidate-family comparison`}>
      <div className="parameter-comparison-summary">
        <div>
          <span>Selected holdout</span>
          <strong className={classForSigned(selectedCell?.averageHoldoutEdgePct ?? 0)}>
            {selectedCell?.averageHoldoutEdgePct === null || selectedCell?.averageHoldoutEdgePct === undefined
              ? '-'
              : signedPercent(selectedCell.averageHoldoutEdgePct)}
          </strong>
        </div>
        <div>
          <span>Compared</span>
          <strong>{formatNumber(cells.length, 0)}</strong>
        </div>
        <div>
          <span>Holdout range</span>
          <strong>{rangePct === null ? '-' : `${formatNumber(rangePct, 2)} pts`}</strong>
        </div>
      </div>
      <div className="parameter-comparison-list">
        {cells.map((cell) => (
          <div key={`${cell.xKey}-${cell.yKey}`} className={`parameter-comparison-row${cell.selected ? ' selected' : ''}`}>
            <span>{cell.displayLabel}</span>
            <i aria-hidden="true">
              <b style={{ width: `${cell.normalizedValue * 100}%` }} />
            </i>
            <strong className={classForSigned(cell.averageHoldoutEdgePct ?? 0)}>{signedPercent(cell.averageHoldoutEdgePct ?? 0)}</strong>
            <em>{cell.selected ? 'Selected' : 'Checked'}</em>
          </div>
        ))}
      </div>
    </div>
  )
}

function ParameterStabilityHeatmap({ plot, resetKey }: { plot: ParameterHeatmapPlot | null; resetKey: string }) {
  const populatedCells = plot?.cells.filter((cell) => cell.candidateCount > 0 && cell.averageHoldoutEdgePct !== null) ?? []
  const uniqueHoldoutValues = new Set(populatedCells.map((cell) => cell.averageHoldoutEdgePct?.toFixed(4))).size
  const hasUsableSurface = !!plot && populatedCells.length >= 4 && uniqueHoldoutValues > 1 && plot.stability.selectedHoldoutEdgePct !== null
  const surfacePixels = plot ? buildHeatmapSurfacePixels(plot) : []
  const heatmapTitle = plot ? `${plot.yLabel} by ${plot.xLabel}` : 'Parameter stability'
  const heatmapDetail = plot ? `${plot.stability.label}; ${formatNumber(populatedCells.length, 0)} checked cells` : 'No comparison surface'
  const { svgRef: heatmapSvgRef, viewport: heatmapViewport } = useSvgTrackpadViewport(hasUsableSurface, resetKey)
  const heatmapXAxisStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${plot?.xValues.length ?? 1}, minmax(0, 1fr))`,
    left: `${(-heatmapViewport.x / heatmapViewport.width) * 100}%`,
    width: `${(100 / heatmapViewport.width) * 100}%`,
  }
  const heatmapYAxisStyle: CSSProperties = {
    gridTemplateRows: `repeat(${plot?.yValues.length ?? 1}, minmax(0, 1fr))`,
    height: `${(100 / heatmapViewport.height) * 100}%`,
    top: `${(-heatmapViewport.y / heatmapViewport.height) * 100}%`,
  }
  return (
    <div className="validation-chart validation-chart-plot validation-chart-heatmap">
      <div className="validation-chart-heading">
        <span>Parameter surface</span>
        <strong>{heatmapTitle}</strong>
        <em>{heatmapDetail}</em>
      </div>
      {plot && hasUsableSurface ? (
        <div className="parameter-heatmap-wrap">
          <div className="parameter-heatmap" role="img" aria-label={`${plot.xLabel} by ${plot.yLabel} holdout performance heat map`}>
            <div className="parameter-heatmap-y-axis-window">
              <div className="parameter-heatmap-y-axis" style={heatmapYAxisStyle}>
                {plot.yValues.map((value) => (
                  <span key={value.key}>{value.label}</span>
                ))}
              </div>
            </div>
            <svg
              className="parameter-heatmap-surface"
              ref={heatmapSvgRef}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <g className="parameter-heatmap-pixels">
                {surfacePixels.map((pixel, index) => (
                  <rect
                    key={index}
                    x={projectSvgX(heatmapViewport, pixel.x)}
                    y={projectSvgY(heatmapViewport, pixel.y)}
                    width={projectSvgWidth(heatmapViewport, pixel.width)}
                    height={projectSvgHeight(heatmapViewport, pixel.height)}
                    fill={heatmapBackground(pixel.value, plot.valueMin, plot.valueMax)}
                  />
                ))}
              </g>
              <g className="parameter-heatmap-hit-cells">
                {plot.cells.map((cell) => {
                  const xIndex = Math.max(0, plot.xValues.findIndex((value) => value.key === cell.xKey))
                  const yIndex = Math.max(0, plot.yValues.findIndex((value) => value.key === cell.yKey))
                  return (
                    <rect
                      key={`${cell.xKey}-${cell.yKey}`}
                      className={`parameter-heatmap-cell${cell.selected ? ' selected' : ''}${cell.localNeighbor ? ' local-neighbor' : ''}${cell.stablePlateau ? ' stable-plateau' : ''}${cell.candidateCount ? '' : ' empty'}`}
                      x={projectSvgX(heatmapViewport, (xIndex / plot.xValues.length) * 100)}
                      y={projectSvgY(heatmapViewport, (yIndex / plot.yValues.length) * 100)}
                      width={projectSvgWidth(heatmapViewport, 100 / plot.xValues.length)}
                      height={projectSvgHeight(heatmapViewport, 100 / plot.yValues.length)}
                    >
                      <title>
                        {`${plot.xLabel}: ${cell.xLabel}; ${plot.yLabel}: ${cell.yLabel}; holdout ${
                          cell.averageHoldoutEdgePct === null ? '-' : signedPercent(cell.averageHoldoutEdgePct)
                        }; train/validation ${
                          cell.averageTrainValidationEdgePct === null ? '-' : signedPercent(cell.averageTrainValidationEdgePct)
                        }; ${formatNumber(cell.candidateCount, 0)} sets${
                          cell.localNeighbor ? `; ${cell.stablePlateau ? 'inside' : 'below'} local plateau band` : ''
                        }`}
                      </title>
                    </rect>
                  )
                })}
              </g>
            </svg>
            <div className="parameter-heatmap-scale" aria-hidden="true">
              <span>{signedPercent(plot.valueMax)}</span>
              <i />
              <span>{signedPercent(plot.valueMin)}</span>
            </div>
            <div className="parameter-heatmap-x-axis-window">
              <div className="parameter-heatmap-x-axis" style={heatmapXAxisStyle}>
                {plot.xValues.map((value) => (
                  <span key={value.key}>{value.label}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : plot ? (
        <ParameterSmallFamilyCheck plot={plot} />
      ) : (
        <ValidationEmpty
          title="No variable parameters"
          detail="The selected strategy does not have a multi-row parameter family in the loaded artifact."
        />
      )}
    </div>
  )
}

function MonteCarloStressChart({ plot, resetKey }: { plot: MonteCarloStressPlot; resetKey: string }) {
  const hasUsableFan = plot.sampleCount > 1 && plot.simulationCount > 0
  const { svgRef: monteCarloSvgRef, viewport: monteCarloViewport } = useSvgTrackpadXViewport(plot.paths.length > 0 && hasUsableFan, resetKey)
  const baseX = (index: number, total: number) => 4 + (index / Math.max(total - 1, 1)) * 92
  const visibleStartX = monteCarloViewport.x
  const visibleEndX = monteCarloViewport.x + monteCarloViewport.width
  const visiblePathValues = plot.paths.flatMap((path) =>
    path.points.filter((_, index) => {
      const x = baseX(index, path.points.length)
      return x >= visibleStartX && x <= visibleEndX
    }),
  )
  const visibleDomainValues = visiblePathValues.length
    ? [plot.startValue, ...visiblePathValues]
    : [plot.startValue, plot.valueMin, plot.valueMax]
  let domainMin = Math.min(...visibleDomainValues)
  let domainMax = Math.max(...visibleDomainValues)
  if (domainMin === domainMax) {
    const pad = Math.max(1, Math.abs(domainMin) * 0.1)
    domainMin -= pad
    domainMax += pad
  } else {
    const pad = (domainMax - domainMin) * 0.08
    domainMin -= pad
    domainMax += pad
  }
  const domainSpan = Math.max(domainMax - domainMin, 1)
  const baseY = (value: number) => 94 - ((value - domainMin) / domainSpan) * 88
  const toX = (index: number, total: number) => projectSvgX(monteCarloViewport, baseX(index, total))
  const toY = (value: number) => baseY(value)
  return (
    <div className="validation-chart validation-chart-plot">
      <div className="validation-chart-heading">
        <span>Monte Carlo</span>
        <strong>Bootstrap path fan</strong>
        {!!plot.paths.length && hasUsableFan && (
          <em>
            {formatNumber(plot.positiveFinalPct, 0)}% finish above start; {formatNumber(plot.sampleCount, 0)} rows,{' '}
            {formatNumber(plot.blockLength, 0)}d blocks
          </em>
        )}
      </div>
      {plot.paths.length && hasUsableFan ? (
        <div className="monte-carlo-path-chart">
          <svg
            ref={monteCarloSvgRef}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label="Monte Carlo simulated path fan"
          >
            {plot.paths.map((path) => {
              const points = path.points.map((value, index) => `${toX(index, path.points.length)},${toY(value)}`).join(' ')
              return (
                <g key={path.id} className={`monte-carlo-path${path.selected ? ' selected' : ''}${path.eligible ? '' : ' ineligible'}`}>
                  <title>
                    {`${path.label}: start ${formatNumber(plot.startValue, 0)}, finish ${formatNumber(path.finalValue, 0)}`}
                  </title>
                  <polyline points={points} stroke={path.selected ? '#111827' : path.color} vectorEffect="non-scaling-stroke" />
                </g>
              )
            })}
          </svg>
          <div className="validation-axis">
            <span>{formatNumber(domainMin, 0)}</span>
            <span>{formatNumber(plot.startValue, 0)} start</span>
            <span>{formatNumber(domainMax, 0)}</span>
          </div>
        </div>
      ) : plot.paths.length ? (
        <ValidationEmpty
          title="Too few return rows"
          detail="The selected path needs at least two return rows before block-resampled paths are meaningful."
        />
      ) : (
        <ValidationEmpty
          title="No return samples"
          detail="The selected strategy has no row-level active returns to resample."
        />
      )}
    </div>
  )
}

function OverfitValidationPills({ selectedBacktest }: { selectedBacktest: ResearchBacktestResult | null }) {
  const diagnostics = useMemo(() => strategyCandidateDiagnostics(selectedBacktest?.strategy), [selectedBacktest])
  const candidates = useMemo(() => candidateMetricRows(diagnostics), [diagnostics])
  const selectedCandidate = useMemo(() => selectedCandidateRow(candidates), [candidates])
  const candidateCount = diagnostics?.candidateCount ?? candidates.length
  const eligibleCandidateCount = diagnostics?.eligibleCandidateCount ?? candidates.filter((candidate) => candidate.eligible).length
  const selectedCandidateCount = candidates.filter((candidate) => candidate.selected).length
  const isCurrentPaperScan = diagnostics?.validationScope === 'current-paper-scan'
  const currentPaperScanFreshness = currentPaperScanFreshnessForStrategy(selectedBacktest?.strategy)
  const paperScanLabel = currentPaperScanFreshness?.isFresh === false ? 'Stale paper scan' : 'Current paper scan'
  const selectedCandidateLabel =
    selectedCandidateCount > 1
      ? `${selectedCandidateCount} selected component sets`
      : selectedCandidate
        ? `Selected set ${selectedCandidate.index + 1}`
        : 'No selected set'

  return (
    <div className="validation-summary-pills">
      <span className="repo-pill">{formatNumber(candidateCount, 0)} parameter sets</span>
      <span className="repo-pill">{formatNumber(eligibleCandidateCount, 0)} eligible</span>
      <span className={`repo-pill ${diagnostics?.selectionUsedHoldout ? 'negative' : isCurrentPaperScan ? 'warning' : 'positive'}`}>
        {diagnostics?.selectionUsedHoldout ? 'Holdout used in selection' : isCurrentPaperScan ? paperScanLabel : 'Holdout report-only'}
      </span>
      <span className={`repo-pill ${selectedCandidate ? 'positive' : 'warning'}`}>{selectedCandidateLabel}</span>
    </div>
  )
}

function OverfitValidationBand({ selectedBacktest }: { selectedBacktest: ResearchBacktestResult | null }) {
  const diagnostics = useMemo(() => strategyCandidateDiagnostics(selectedBacktest?.strategy), [selectedBacktest])
  const candidates = useMemo(() => candidateMetricRows(diagnostics), [diagnostics])
  const heatmapPlot = useMemo(() => buildParameterHeatmapPlot(candidates), [candidates])
  const monteCarloPlot = useMemo(
    () => buildMonteCarloStressPlot(isPredictionMarketStrategy(selectedBacktest?.strategy) ? [] : (selectedBacktest?.trades ?? [])),
    [selectedBacktest],
  )
  const chartResetKey = selectedBacktest?.strategy.id ?? 'no-strategy'

  return (
    <section className="overfit-validation-band" aria-label="Anti-overfit validation charts">
      <div className="overfit-chart-grid">
        <ParameterStabilityHeatmap plot={heatmapPlot} resetKey={chartResetKey} />
        <MonteCarloStressChart plot={monteCarloPlot} resetKey={chartResetKey} />
      </div>
    </section>
  )
}

function fullChartRange(total: number): ChartRange {
  return { startIndex: 0, endIndex: Math.max(total - 1, 0) }
}

function clampChartRange(range: ChartRange, total: number): ChartRange {
  if (total <= 0) return fullChartRange(total)
  const requestedSpan = range.endIndex - range.startIndex + 1
  const minimumSpan = Math.min(minZoomWindow, total)
  const span = Math.max(minimumSpan, Math.min(Number.isFinite(requestedSpan) ? requestedSpan : total, total))
  const rawStartIndex = Number.isFinite(range.startIndex) ? range.startIndex : 0
  const startIndex = Math.max(0, Math.min(rawStartIndex, total - span))
  return { startIndex, endIndex: startIndex + span - 1 }
}

function chartRangeDataBounds(range: ChartRange, total: number): ChartRange {
  if (total <= 0) return fullChartRange(total)
  const clamped = clampChartRange(range, total)
  const startIndex = Math.max(0, Math.min(Math.floor(clamped.startIndex), total - 1))
  const endIndex = Math.max(startIndex, Math.min(Math.ceil(clamped.endIndex), total - 1))
  return { startIndex, endIndex }
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(value, 1))
}

function clampChartWheelZoomPower(value: number) {
  return Math.max(-maxChartWheelZoomPower, Math.min(value, maxChartWheelZoomPower))
}

function zoomChartRangeAtRatio(range: ChartRange, total: number, zoomPower: number, anchorRatio: number): ChartRange {
  if (total <= 1 || !Number.isFinite(zoomPower) || zoomPower === 0) return clampChartRange(range, total)
  const current = clampChartRange(range, total)
  const span = current.endIndex - current.startIndex + 1
  const minimumSpan = Math.min(minZoomWindow, total)
  const ratio = clampRatio(anchorRatio)
  const scale = 2 ** clampChartWheelZoomPower(zoomPower)
  const nextSpan = Math.max(minimumSpan, Math.min(total, span / scale))

  const anchorIndex = current.startIndex + (span - 1) * ratio
  const startIndex = anchorIndex - (nextSpan - 1) * ratio
  return clampChartRange({ startIndex, endIndex: startIndex + nextSpan - 1 }, total)
}

function zoomChartRange(range: ChartRange, total: number, direction: 'in' | 'out'): ChartRange {
  return zoomChartRangeAtRatio(range, total, direction === 'in' ? 0.7 : -0.7, 0.5)
}

function panChartRange(range: ChartRange, total: number, direction: 'left' | 'right'): ChartRange {
  if (total <= 1) return fullChartRange(total)
  const current = clampChartRange(range, total)
  const span = current.endIndex - current.startIndex + 1
  const offset = Math.max(1, span * 0.45) * (direction === 'left' ? -1 : 1)
  return clampChartRange({ startIndex: current.startIndex + offset, endIndex: current.endIndex + offset }, total)
}

function isFullChartRange(range: ChartRange, total: number) {
  const clamped = clampChartRange(range, total)
  return total <= 1 || (clamped.startIndex <= 0.001 && clamped.endIndex >= total - 1.001)
}

function formatShortDate(value: string | undefined) {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  }).format(date)
}

function signedUnit(value: number, unit: string, digits = 2) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatNumber(value, digits)}${unit}`
}

function ChartZoomToolbar({
  data,
  range,
  onZoomIn,
  onZoomOut,
  onPanLeft,
  onPanRight,
  onReset,
}: {
  data: DashboardChartPoint[]
  range: ChartRange
  onZoomIn: () => void
  onZoomOut: () => void
  onPanLeft: () => void
  onPanRight: () => void
  onReset: () => void
}) {
  const total = data.length
  const clampedRange = clampChartRange(range, total)
  const { startIndex: startDataIndex, endIndex: endDataIndex } = chartRangeDataBounds(clampedRange, total)
  const span = total ? endDataIndex - startDataIndex + 1 : 0
  const rangeLabel = total
    ? `${formatShortDate(data[startDataIndex]?.date)} - ${formatShortDate(data[endDataIndex]?.date)}`
    : 'No range'

  return (
    <div className="chart-toolbar" aria-label="Chart controls">
      <span className="chart-range-label">
        {rangeLabel}
        {total > 0 ? ` (${span}/${total})` : ''}
      </span>
      <div className="chart-button-group">
        <button type="button" onClick={onPanLeft} disabled={clampedRange.startIndex <= 0} title="Pan left" aria-label="Pan chart left">
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={onZoomIn} disabled={span <= Math.min(minZoomWindow, total)} title="Zoom in" aria-label="Zoom chart in">
          <ZoomIn size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={onZoomOut} disabled={isFullChartRange(clampedRange, total)} title="Zoom out" aria-label="Zoom chart out">
          <ZoomOut size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={onPanRight} disabled={clampedRange.endIndex >= total - 1} title="Pan right" aria-label="Pan chart right">
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        <button type="button" onClick={onReset} disabled={isFullChartRange(clampedRange, total)} title="Reset range" aria-label="Reset chart range">
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function OverviewPerformancePanel({
  chartData,
  onSelectStrategy,
  selectedBacktest,
  selectedStrategyId,
  selectedStrategyItem,
  strategyItems,
}: {
  chartData: DashboardChartPoint[]
  onSelectStrategy: (strategyId: string) => void
  selectedBacktest: ResearchBacktestResult | null
  selectedStrategyId: string
  selectedStrategyItem: StrategySelectorItem | null
  strategyItems: StrategySelectorItem[]
}) {
  const [range, setRange] = useState<ChartRange>(() => fullChartRange(chartData.length))
  const clampedRange = useMemo(() => clampChartRange(range, chartData.length), [chartData.length, range])
  const visibleBounds = chartRangeDataBounds(clampedRange, chartData.length)
  const visibleChartData = chartData.slice(visibleBounds.startIndex, visibleBounds.endIndex + 1)
  const showDetailLines = visibleChartData.length <= strategyDetailLineMaxPoints
  const series = useMemo<SmoothChartSeries<DashboardChartPoint>[]>(
    () =>
      selectedBacktest
        ? strategyPerformanceChartSeries(selectedBacktest.strategy.color, showDetailLines, {
            isPredictionMarket: isPredictionMarketStrategy(selectedBacktest.strategy),
            showBenchmarks: hasIndexBenchmarkForStrategy(selectedBacktest.strategy),
          })
        : marketOverviewChartSeries(),
    [selectedBacktest, showDetailLines],
  )

  const zoomChart = (direction: 'in' | 'out') => {
    setRange((current) => zoomChartRange(current, chartData.length, direction))
  }

  const panChart = (direction: 'left' | 'right') => {
    setRange((current) => panChartRange(current, chartData.length, direction))
  }

  const resetChart = () => {
    setRange(fullChartRange(chartData.length))
  }

  return (
    <article className="panel chart-panel wide">
      <SectionHeading
        eyebrow="Live read"
        title={
          <StrategyTitleSelect
            items={strategyItems}
            selectedItem={selectedStrategyItem}
            selectedStrategyId={selectedStrategyId}
            onSelectStrategy={onSelectStrategy}
          />
        }
        action={
          <ChartZoomToolbar
            data={chartData}
            range={clampedRange}
            onZoomIn={() => zoomChart('in')}
            onZoomOut={() => zoomChart('out')}
            onPanLeft={() => panChart('left')}
            onPanRight={() => panChart('right')}
            onReset={resetChart}
          />
        }
      />
      <div className="chart-frame tall">
        <SmoothZoomChart
          breakLinesAfterDays={selectedBacktest ? sparseStrategyGapBreakDays : undefined}
          data={chartData}
          formatDate={formatShortDate}
          minWindow={minZoomWindow}
          onRangeChange={setRange}
          range={clampedRange}
          series={series}
        />
        {!chartData.length && (
          <ChartEmptyOverlay
            title="No graph data yet"
            detail="Research strategy artifacts are loaded, but no trade curve could be built."
          />
        )}
      </div>
    </article>
  )
}

function EmptyList({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-list">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function githubTone(status: GithubStatus | null, error: string) {
  if (error || !status?.configured) return 'warning'
  if (status.updateAvailable || status.behind > 0) return 'negative'
  if (status.dirty || status.ahead > 0) return 'warning'
  return 'positive'
}

function githubRemoteLabel(status: GithubStatus | null, error: string) {
  if (error) return 'GitHub service unavailable'
  if (!status) return 'Waiting for GitHub service'
  return status.remoteUrl || 'origin remote not configured'
}

function githubStatusMessage(status: GithubStatus) {
  if (status.checking) return status.message || 'Checking GitHub.'
  const checkedAt = formatTimestamp(status.lastCheckedAt)
  const checkedSuffix = checkedAt === 'Never' || checkedAt === 'Unknown' ? '' : ` Checked at ${checkedAt}.`
  if (!status.ok || !status.configured) return `${status.message || status.lastAction}${checkedSuffix}`.trim()
  if (status.updateAvailable) return `Update ready.${checkedSuffix}`
  if (status.dirty || status.ahead > 0) return `Local changes.${checkedSuffix}`
  return `GitHub checked at ${checkedAt}.`
}

function App() {
  const [activeView, setActiveViewState] = useState<ActiveView>(() => viewFromHash())
  const [weather, setWeather] = useState<WeatherPoint[]>([])
  const [market, setMarket] = useState<MarketBar[]>([])
  const settings = defaultSettings
  const [selectedStrategyId, setSelectedStrategyId] = useState(defaultSelectedStrategyId)
  const [dataLabel, setDataLabel] = useState(activeStrategyLabel())
  const [importLog, setImportLog] = useState(
    `Tracked real data is available under ${realDataCatalog.defaultDataRoot}; ${activeStrategyLabel()} from vetted strategy artifacts.`,
  )
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null)
  const [githubError, setGithubError] = useState('')
  const [githubMessage, setGithubMessage] = useState('Checking GitHub.')
  const [githubBusy, setGithubBusy] = useState(false)
  const [githubChecking, setGithubChecking] = useState(false)
  const [commitMessage, setCommitMessage] = useState('Update QORE dashboard')

  const joinedRows = useMemo(() => joinMarketWeather(market, weather), [market, weather])
  const importedWeatherMetrics = useMemo(() => (weather.length ? evaluateWeatherModel(weather) : null), [weather])
  const weatherMetrics = importedWeatherMetrics ?? sharedWeatherMetrics
  const weatherMetricsSource = importedWeatherMetrics ? 'Imported lab CSV' : 'Shared forecast calendars'
  const leaderboard = useMemo(() => [...researchBacktestResults].sort(sortResearchResults), [])
  const topResearchStrategy = useMemo(
    () => leaderboard[0]?.strategy ?? [...researchStrategyRegistry].sort((a, b) => b.metrics.totalReturnPct - a.metrics.totalReturnPct)[0] ?? null,
    [leaderboard],
  )
  const selectedBacktest = useMemo(
    () => leaderboard.find((result) => result.strategy.id === selectedStrategyId) ?? leaderboard[0] ?? null,
    [leaderboard, selectedStrategyId],
  )
  const selectedSampleStatus = useMemo(() => sampleStatusFor(selectedBacktest), [selectedBacktest])
  const selectedWeatherSideSeason = useMemo(() => weatherSideSeasonForStrategy(selectedBacktest?.strategy), [selectedBacktest])
  const selectedSideStats = useMemo(
    () => sideStatsForTrades(selectedBacktest?.trades ?? [], selectedWeatherSideSeason).filter((side) => side.tradeCount > 0),
    [selectedBacktest, selectedWeatherSideSeason],
  )
  const selectedComponentSideStats = useMemo(() => selectedSideStats.filter((side) => side.id !== 'index-fallback'), [selectedSideStats])
  const selectedIndexSideStat = useMemo(() => selectedSideStats.find((side) => side.id === 'index-fallback') ?? null, [selectedSideStats])
  const indexBenchmarkSummaryByStrategyId = useMemo(
    () =>
      new Map<string, { returnPct: number | null; edgePct: number | null }>(
        leaderboard.map((result) => {
          if (!hasIndexBenchmarkForStrategy(result.strategy)) {
            return [
              result.strategy.id,
              {
                returnPct: null,
                edgePct: null,
              },
            ] as const
          }
          const dates = [result.researchMetrics.firstEntry, result.researchMetrics.lastExit].filter((date): date is string => !!date)
          const benchmarkStartDate =
            result.researchMetrics.firstEntry ||
            result.trades
              .slice()
              .sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate))[0]?.entryTradeDate ||
            dates[0]
          const benchmarkReturnPct = relativeBenchmarkReturn(
            [...benchmarkPctByDate(indexBenchmarkMarketBars, dates, benchmarkStartDate).values()],
          )
          return [
            result.strategy.id,
            {
              returnPct: benchmarkReturnPct,
              edgePct: result.metrics.totalReturnPct - benchmarkReturnPct,
            },
          ] as const
        }),
      ),
    [leaderboard],
  )
  const benchmarkByDate = useMemo(() => {
    if (selectedBacktest && !hasIndexBenchmarkForStrategy(selectedBacktest.strategy)) return new Map<string, number | null>()
    const dates = selectedBacktest ? selectedBacktest.curve.map((point) => point.date) : joinedRows.map((point) => point.date)
    const benchmarkStartDate =
      selectedBacktest?.researchMetrics.firstEntry ||
      selectedBacktest?.trades
        .slice()
        .sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate))[0]?.entryTradeDate ||
      dates[0]
    return benchmarkPctByDate(selectedBacktest ? benchmarkMarketBars : market, dates, benchmarkStartDate)
  }, [joinedRows, market, selectedBacktest])
  const indexBenchmarkByDate = useMemo(() => {
    if (selectedBacktest && !hasIndexBenchmarkForStrategy(selectedBacktest.strategy)) return new Map<string, number | null>()
    const dates = selectedBacktest ? selectedBacktest.curve.map((point) => point.date) : joinedRows.map((point) => point.date)
    const benchmarkStartDate =
      selectedBacktest?.researchMetrics.firstEntry ||
      selectedBacktest?.trades
        .slice()
        .sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate))[0]?.entryTradeDate ||
      dates[0]
    return benchmarkPctByDate(indexBenchmarkMarketBars, dates, benchmarkStartDate)
  }, [joinedRows, selectedBacktest])
  const hasLabData = weather.length > 0 || market.length > 0
  const chartData: DashboardChartPoint[] = useMemo(
    () =>
      selectedBacktest
        ? selectedBacktest.curve.map((point, chartIndex) => ({
            ...point,
            chartIndex,
            gasReturnPct: point.gasReturnPct,
            activeTradeReturnPct: point.windowId === 'index-fallback' ? null : point.gasReturnPct,
            demandScore: point.demandScore,
            storageBcf: point.storageBcf,
            closeScaled: point.closeScaled,
            benchmarkPct: benchmarkByDate.get(point.date) ?? null,
            indexBenchmarkPct: indexBenchmarkByDate.get(point.date) ?? null,
          }))
        : joinedRows.map((point, chartIndex) => ({
            chartIndex,
            date: point.date,
            equity: null,
            equityPct: null,
            dailyPnlPct: null,
            drawdownPct: null,
            close: point.close,
            weatherSurprise: point.weatherSurprise,
            hddError: point.hddError,
            position: null,
            signal: null,
            closeScaled: point.close * 1000,
            gasReturnPct: point.dailyReturn * 100,
            activeTradeReturnPct: null,
            demandScore: point.demandScore,
            storageBcf: point.storageBcf,
            benchmarkPct: benchmarkByDate.get(point.date) ?? null,
            indexBenchmarkPct: indexBenchmarkByDate.get(point.date) ?? null,
          })),
    [benchmarkByDate, indexBenchmarkByDate, joinedRows, selectedBacktest],
  )
  const weatherScoreBars = weatherMetrics
    ? [
        { name: `${weatherMetrics.metricLabel} MAE`, value: weatherMetrics.mae, color: '#2563eb' },
        { name: `${weatherMetrics.metricLabel} RMSE`, value: weatherMetrics.rmse, color: '#0891b2' },
        { name: 'Bias', value: weatherMetrics.bias, color: weatherMetrics.bias > 0 ? '#f97316' : '#7c3aed' },
        { name: 'R2', value: weatherMetrics.r2, color: '#0f766e' },
      ]
    : []
  const strategyStripItems = leaderboard.map((result) => ({
    id: result.strategy.id,
    name: result.strategy.name,
    family: result.strategy.family,
    status: sampleStatusFor(result).label,
    returnPct: result.metrics.totalReturnPct,
    color: result.strategy.color,
    selected: result.strategy.id === selectedStrategyId,
  }))
  const selectedStrategyItem = strategyStripItems.find((strategy) => strategy.selected) ?? strategyStripItems[0] ?? null
  const selectedHasIndexBenchmark = hasIndexBenchmarkForStrategy(selectedBacktest?.strategy)
  const selectedMetricWindowStartDate = selectedBacktest?.researchMetrics.firstEntry
  const selectedMetricWindowEndDate = selectedBacktest?.researchMetrics.lastExit
  const selectedIndexBenchmarkWindowValues =
    selectedBacktest && selectedHasIndexBenchmark
      ? [
          ...benchmarkPctByDate(
            indexBenchmarkMarketBars,
            [selectedMetricWindowStartDate, selectedMetricWindowEndDate].filter((date): date is string => !!date),
            selectedMetricWindowStartDate,
          ).values(),
        ]
      : []
  const selectedIndexBenchmarkReturnPct =
    selectedBacktest && selectedHasIndexBenchmark ? relativeBenchmarkReturn(selectedIndexBenchmarkWindowValues) : null
  const selectedIndexBenchmarkAnnualReturnPct =
    selectedBacktest && selectedIndexBenchmarkReturnPct !== null
      ? annualizedReturnPct(selectedIndexBenchmarkReturnPct, selectedMetricWindowStartDate, selectedMetricWindowEndDate)
      : null
  const selectedIndexBenchmarkAnnualEdgePct =
    selectedBacktest && selectedIndexBenchmarkAnnualReturnPct !== null
      ? selectedBacktest.metrics.cagrPct - selectedIndexBenchmarkAnnualReturnPct
      : null
  const selectedIsCurrentPaperScan = isCurrentPaperScanStrategy(selectedBacktest?.strategy)
  const selectedCurrentPaperScanFreshness = currentPaperScanFreshnessForStrategy(selectedBacktest?.strategy)
  const selectedCurrentPaperScanDate = currentPaperScanDateLabel(selectedCurrentPaperScanFreshness)
  const selectedIsPredictionMarket = isPredictionMarketStrategy(selectedBacktest?.strategy)
  const selectedIsPredictionCrossMarket = isPredictionCrossMarketStrategy(selectedBacktest?.strategy)
  const selectedHoldoutTotalEdgePct = splitEdgeForStrategy(selectedBacktest?.strategy, 'holdout')
  const selectedHoldoutAnnualEdgePct = splitAnnualEdgeForStrategy(selectedBacktest?.strategy, 'holdout')
  const selectedHoldoutTotalReturnPct = selectedIsPredictionCrossMarket
    ? splitTotalReturnForStrategy(selectedBacktest?.strategy, 'holdout')
    : selectedHoldoutTotalEdgePct
  const selectedCurrentScanEdgePct = splitEdgeForStrategy(selectedBacktest?.strategy, 'current')
  const selectedCurrentScanTotalReturnPct = selectedIsPredictionCrossMarket
    ? splitTotalReturnForStrategy(selectedBacktest?.strategy, 'current')
    : selectedCurrentScanEdgePct
  const selectedUsesAbsoluteSplitReturns = selectedIsPredictionMarket
  const selectedPredictionObservationWindow = predictionMarketObservationWindowForStrategy(selectedBacktest?.strategy)
  const selectedPredictionLatestDateLabel = selectedIsPredictionCrossMarket ? 'latest observation' : 'latest settlement'
  const selectedPredictionReturnDetailLabel = selectedIsPredictionCrossMarket ? 'quote-screen total' : 'modeled package return'
  const selectedPerformanceCardLabel = selectedIsPredictionCrossMarket
    ? 'Quote-screen total return'
    : selectedIsPredictionMarket
      ? 'Settlement yearly return'
      : 'Average yearly return'
  const selectedPerformanceCardValuePct = selectedBacktest
    ? selectedIsPredictionCrossMarket
      ? selectedBacktest.metrics.totalReturnPct
      : selectedBacktest.metrics.cagrPct
    : topResearchStrategy
      ? isPredictionCrossMarketStrategy(topResearchStrategy)
        ? topResearchStrategy.metrics.totalReturnPct
        : topResearchStrategy.metrics.cagrPct
      : null
  const selectedPerformanceCardDetail = selectedBacktest
    ? selectedIsPredictionMarket
      ? selectedPredictionObservationWindow
        ? `${signedPercent(selectedBacktest.metrics.totalReturnPct)} ${selectedPredictionReturnDetailLabel}; observed ${formatShortDate(selectedPredictionObservationWindow.startDate)} to ${formatShortDate(selectedPredictionObservationWindow.endDate)}; ${selectedPredictionLatestDateLabel} ${formatShortDate(selectedBacktest.researchMetrics.lastExit)}`
        : `${signedPercent(selectedBacktest.metrics.totalReturnPct)} ${selectedPredictionReturnDetailLabel}; ${selectedPredictionLatestDateLabel} ${formatShortDate(selectedBacktest.researchMetrics.lastExit)}`
      : `${signedPercent(selectedBacktest.metrics.totalReturnPct)} total from ${formatShortDate(selectedBacktest.researchMetrics.firstEntry)} to ${formatShortDate(selectedBacktest.researchMetrics.lastExit)}`
    : topResearchStrategy
      ? `${signedPercent(topResearchStrategy.metrics.totalReturnPct)} total research baseline`
      : 'No research strategies loaded'
  const selectedValidationCardLabel = selectedIsCurrentPaperScan ? 'Paper scan' : selectedIsPredictionCrossMarket ? 'Quote holdout' : 'Annual holdout'
  const selectedValidationCardValuePct = selectedIsCurrentPaperScan
    ? selectedCurrentScanTotalReturnPct
    : selectedIsPredictionCrossMarket
      ? selectedHoldoutTotalReturnPct
      : selectedHoldoutAnnualEdgePct
  const selectedValidationCardDetail = selectedIsCurrentPaperScan
    ? selectedCurrentPaperScanFreshness?.isFresh === false
      ? selectedCurrentPaperScanDate
        ? `Stale paper scan from ${selectedCurrentPaperScanDate}; refresh before treating as current`
        : 'Stale paper scan; refresh before treating as current'
      : selectedCurrentScanTotalReturnPct === null
      ? 'Current scan has no selected paper rows'
      : selectedIsPredictionCrossMarket
        ? 'Current top-of-book total; no historical holdout split'
        : `Current top-of-book scan; no historical holdout split`
    : selectedIsPredictionCrossMarket
      ? selectedHoldoutTotalReturnPct === null
        ? 'No holdout split for selected strategy'
        : selectedHoldoutAnnualEdgePct === null
          ? 'Report-only quote-screen total return'
          : `Report-only quote-screen total; ${signedPercent(selectedHoldoutAnnualEdgePct)} annualized`
    : selectedHoldoutAnnualEdgePct === null
      ? 'No holdout split for selected strategy'
      : selectedHoldoutTotalEdgePct === null
        ? 'Report-only annual split return'
        : selectedUsesAbsoluteSplitReturns
          ? `Report-only absolute return; ${signedPercent(selectedHoldoutTotalEdgePct)} cumulative`
          : `Report-only vs index basket; ${signedPercent(selectedHoldoutTotalEdgePct)} cumulative`
  const selectedRealityCheck = realityCheckForStrategy(selectedBacktest?.strategy)
  const emptyStats = [
    ['Win rate', '-', 'Positive return rows'],
    ['Profit factor', '-', 'Gross wins / losses'],
    ['P-value', '-', 'No reality check'],
    ['Exposure', '-', 'Average absolute'],
    ['Turnover', '-', 'Path churn'],
    ['CVaR 95', '-', 'Tail return-row loss'],
  ]

  const loadGithubStatus = useCallback(async (refresh = false) => {
    if (refresh) {
      setGithubChecking(true)
      setGithubMessage('Checking GitHub.')
    }
    try {
      const status = await fetchGithubStatus(refresh)
      setGithubStatus(status)
      setGithubError('')
      setGithubMessage(githubStatusMessage(status))
      setGithubChecking(Boolean(status.checking))
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'QORE Git service is unavailable.')
      setGithubMessage('GitHub service offline.')
      setGithubChecking(false)
    }
  }, [])

  const refreshDashboard = useCallback(() => {
    void loadGithubStatus(true)
  }, [loadGithubStatus])

  const setActiveView = (view: ActiveView) => {
    setActiveViewState(view)
    window.history.replaceState(null, '', `#${view}`)
  }

  const selectStrategy = (strategyId: string) => {
    setSelectedStrategyId(strategyId)
  }

  useEffect(() => {
    const handleHashChange = () => setActiveViewState(viewFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const initialCheck = window.setTimeout(() => {
      refreshDashboard()
    }, 0)
    const interval = window.setInterval(() => {
      refreshDashboard()
    }, 5 * 60 * 1000)
    return () => {
      window.clearTimeout(initialCheck)
      window.clearInterval(interval)
    }
  }, [refreshDashboard])

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) refreshDashboard()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refreshDashboard])

  useEffect(() => {
    if (!githubStatus?.checking) return
    const retry = window.setTimeout(() => {
      refreshDashboard()
    }, 2000)
    return () => window.clearTimeout(retry)
  }, [githubStatus?.checking, refreshDashboard])

  useEffect(() => {
    const handleDashboardRefreshShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.shiftKey || event.altKey) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'r') return
      event.preventDefault()
      refreshDashboard()
    }

    window.addEventListener('keydown', handleDashboardRefreshShortcut)
    return () => window.removeEventListener('keydown', handleDashboardRefreshShortcut)
  }, [refreshDashboard])

  const handleFile = (kind: 'weather' | 'market') => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      if (kind === 'weather') {
        const rows = parseWeatherCsv(text)
        if (rows.length < 2) throw new Error('Weather CSV did not contain enough rows.')
        setWeather(rows)
        setDataLabel(`${rows.length} weather rows loaded`)
        setImportLog(`Loaded ${rows.length} weather rows from ${file.name}.`)
      } else {
        const rows = parseMarketCsv(text)
        if (rows.length < 2) throw new Error('Market CSV did not contain enough rows.')
        setMarket(rows)
        setDataLabel(`${rows.length} market rows loaded`)
        setImportLog(`Loaded ${rows.length} natural gas rows from ${file.name}.`)
      }
    } catch (error) {
      setImportLog(error instanceof Error ? error.message : 'Import failed.')
    } finally {
      event.currentTarget.value = ''
    }
  }

  const clearLabData = () => {
    setWeather([])
    setMarket([])
    setDataLabel(activeStrategyLabel())
    setImportLog('Cleared imported session rows. Shared strategy and data files were not changed.')
  }

  const handleGithubUpdate = async () => {
    if (!githubStatus?.updateAvailable) return
    const confirmed = window.confirm('Update QORE from GitHub now? Stop running tests or local work first.')
    if (!confirmed) return

    setGithubBusy(true)
    setGithubMessage('Updating from GitHub.')
    try {
      const status = await updateFromGithub()
      setGithubStatus(status)
      setGithubError('')
      setGithubMessage(status.lastAction || status.message)
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub update failed.')
    } finally {
      setGithubBusy(false)
    }
  }

  const handleGithubPush = async () => {
    if (!githubStatus?.configured) return
    if (githubStatus.dirty && !commitMessage.trim()) {
      setGithubError('A commit message is required for local changes.')
      return
    }
    const confirmed = window.confirm(
      githubStatus.dirty ? 'Commit local changes and push to GitHub?' : 'Push committed changes to GitHub?',
    )
    if (!confirmed) return

    setGithubBusy(true)
    setGithubMessage('Pushing to GitHub.')
    try {
      const status = await pushToGithub(commitMessage)
      setGithubStatus(status)
      setGithubError('')
      setGithubMessage(status.lastAction || status.message)
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub push failed.')
    } finally {
      setGithubBusy(false)
    }
  }

  const isGithubChecking = githubChecking || Boolean(githubStatus?.checking)
  const repoTone = isGithubChecking ? 'warning' : githubTone(githubStatus, githubError)
  const repoBranchLabel = githubStatus?.branch ?? (githubError ? 'Unknown' : 'main')
  const repoRemoteLabel = githubRemoteLabel(githubStatus, githubError)
  const dirtyFileRows = githubError
    ? [githubError]
    : githubStatus
      ? githubStatus.dirtyFiles.length
        ? githubStatus.dirtyFiles
        : ['Clean working tree']
      : ['Waiting for GitHub service']
  const repoStatusText = githubError
    ? 'Service offline'
    : isGithubChecking
      ? 'Checking'
      : githubStatus?.updateAvailable
        ? 'Update ready'
        : githubStatus?.dirty || (githubStatus?.ahead ?? 0) > 0
          ? 'Local changes'
          : githubStatus?.configured
            ? 'Current'
            : 'No remote'

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="QORE dashboard sections">
        <div className="brand-block">
          <div className="brand-mark">
            <img src="/favicon.svg?v=planet-mark-v2" alt="" aria-hidden="true" />
          </div>
          <div>
            <strong>QORE</strong>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className={activeView === item.id ? 'active' : ''}
                onClick={() => setActiveView(item.id)}
                title={item.label}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="source-chip">
          <Database size={16} aria-hidden="true" />
          <span>{dataLabel}</span>
        </div>
      </aside>

      <main className="dashboard">
        <header className="topbar">
          <div>
            <h1>Strategy command center</h1>
            <p className="topbar-subtitle">Quantitative Operations Runtime Engine</p>
          </div>
          <div className="top-actions">
            <button type="button" className="ghost-button" disabled={githubChecking} onClick={refreshDashboard} title="Refresh dashboard">
              <RefreshCw size={17} aria-hidden="true" />
              {githubChecking ? 'Checking' : 'Refresh'}
            </button>
            <button type="button" className="ghost-button" disabled={!hasLabData} onClick={clearLabData}>
              <Database size={17} aria-hidden="true" />
              Clear lab
            </button>
            <button type="button" className="ghost-button" onClick={() => setActiveView('github')}>
              <GitBranch size={17} aria-hidden="true" />
              GitHub
            </button>
            <button type="button" className="primary-button" onClick={() => setActiveView('backtest')}>
              <Play size={17} aria-hidden="true" />
              Run lab
            </button>
          </div>
        </header>

        <section className="metric-grid" aria-label="Primary quant metrics">
          <MetricCard
            icon={TrendingUp}
            label={selectedPerformanceCardLabel}
            value={selectedPerformanceCardValuePct === null ? '-' : signedPercent(selectedPerformanceCardValuePct)}
            detail={selectedPerformanceCardDetail}
            tone={selectedPerformanceCardValuePct === null ? 'warning' : classForSigned(selectedPerformanceCardValuePct)}
          />
          <MetricCard
            icon={LineChartIcon}
            label="Annualized alpha"
            value={selectedIndexBenchmarkAnnualEdgePct === null ? '-' : signedPercent(selectedIndexBenchmarkAnnualEdgePct)}
            detail={
              !selectedBacktest
                ? 'Needs a selected strategy window'
                : selectedIndexBenchmarkAnnualReturnPct === null
                  ? 'No benchmark edge modeled for this strategy'
                  : `${indexBenchmarkLabel} ${signedPercent(selectedIndexBenchmarkAnnualReturnPct)} yearly over same window`
            }
            tone={selectedIndexBenchmarkAnnualEdgePct === null ? 'warning' : classForSigned(selectedIndexBenchmarkAnnualEdgePct)}
          />
          <MetricCard
            icon={Gauge}
            label={selectedValidationCardLabel}
            value={selectedValidationCardValuePct === null ? '-' : signedPercent(selectedValidationCardValuePct)}
            detail={selectedValidationCardDetail}
            tone={selectedValidationCardValuePct === null ? 'warning' : classForSigned(selectedValidationCardValuePct)}
          />
          <MetricCard
            icon={Activity}
            label="Sharpe / Sortino"
            value={
              selectedBacktest
                ? `${formatNumber(selectedBacktest.metrics.sharpe)} / ${formatNumber(selectedBacktest.metrics.sortino)}`
                : topResearchStrategy
                  ? `${formatNumber(topResearchStrategy.metrics.sharpe)} / ${formatNumber(topResearchStrategy.metrics.sortino)}`
                  : '- / -'
            }
            detail={
              selectedBacktest
                ? selectedIsPredictionCrossMarket
                  ? `${signedPercent(selectedBacktest.metrics.totalReturnPct)} quote-screen total, ${formatNumber(selectedBacktest.metrics.annualVolPct)}% annual vol`
                  : `${signedPercent(selectedBacktest.metrics.cagrPct)} CAGR, ${formatNumber(selectedBacktest.metrics.annualVolPct)}% annual vol`
                : topResearchStrategy
                  ? isPredictionCrossMarketStrategy(topResearchStrategy)
                    ? `${signedPercent(topResearchStrategy.metrics.totalReturnPct)} quote-screen total in research baseline`
                    : `${signedPercent(topResearchStrategy.metrics.cagrPct)} CAGR in research baseline`
                  : 'Ready for real strategy metrics'
            }
            tone={(selectedBacktest?.metrics.sharpe ?? topResearchStrategy?.metrics.sharpe ?? 0) > 1 ? 'positive' : 'neutral'}
          />
          <MetricCard
            icon={ShieldCheck}
            label="Max drawdown"
            value={selectedBacktest ? signedPercent(selectedBacktest.metrics.maxDrawdownPct) : topResearchStrategy ? signedPercent(topResearchStrategy.metrics.maxDrawdownPct) : '-'}
            detail={selectedBacktest ? `${formatNumber(selectedBacktest.metrics.var95Pct)}% return-row VaR 95` : topResearchStrategy ? `${topResearchStrategy.metrics.tradeCount} optimized return rows` : 'No risk path until a strategy runs'}
            tone={(selectedBacktest?.metrics.maxDrawdownPct ?? topResearchStrategy?.metrics.maxDrawdownPct ?? 0) < -15 ? 'negative' : 'positive'}
          />
          <MetricCard
            icon={CloudSun}
            label="Weather accuracy"
            value={`${formatNumber(weatherMetrics.directionalAccuracyPct, 1)}%`}
            detail={`${weatherMetrics.metricLabel} MAE ${formatNumber(weatherMetrics.mae)}${weatherMetrics.unitLabel} | ${formatCompact(weatherMetrics.rowCount)} scored rows`}
            tone={weatherMetrics && weatherMetrics.directionalAccuracyPct > 60 ? 'positive' : 'warning'}
          />
        </section>

        {activeView === 'overview' && (
          <section className="view-stack">
            <OverviewPerformancePanel
              key={`${selectedBacktest?.strategy.id ?? 'lab'}-${chartData.length}`}
              chartData={chartData}
              onSelectStrategy={selectStrategy}
              selectedBacktest={selectedBacktest}
              selectedStrategyId={selectedBacktest?.strategy.id ?? selectedStrategyId}
              selectedStrategyItem={selectedStrategyItem}
              strategyItems={strategyStripItems}
            />

            <article className="panel table-panel">
              <SectionHeading eyebrow="Ranking" title="Strategy leaderboard" />
              <div className="table-wrap">
                <table className="leaderboard-table">
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th>Total return</th>
                      <th>Index</th>
                      <th>Holdout/scan</th>
                      <th>Sharpe</th>
                      <th>Drawdown</th>
                      <th>Win rate</th>
                      <th>Trades</th>
                      <th>Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.length ? (
                      leaderboard.map((result, index) => {
                        const sampleStatus = sampleStatusFor(result)
                        const indexBenchmarkSummary = indexBenchmarkSummaryByStrategyId.get(result.strategy.id)
                        const indexBenchmarkReturnPct = indexBenchmarkSummary?.returnPct
                        const isCurrentPaperScan = isCurrentPaperScanStrategy(result.strategy)
                        const isPredictionCrossMarket = isPredictionCrossMarketStrategy(result.strategy)
                        const validationEdgePct = isCurrentPaperScan
                          ? splitTotalReturnForStrategy(result.strategy, 'current')
                          : isPredictionCrossMarket
                            ? splitTotalReturnForStrategy(result.strategy, 'holdout')
                            : splitAnnualEdgeForStrategy(result.strategy, 'holdout')
                        return (
                          <tr
                            key={result.strategy.id}
                            className={result.strategy.id === selectedStrategyId ? 'selected-row' : undefined}
                            onClick={() => selectStrategy(result.strategy.id)}
                          >
                            <td>
                              <strong>#{index + 1} {result.strategy.name}</strong>
                              <span>{result.strategy.desk}</span>
                            </td>
                            <td className={classForSigned(result.metrics.totalReturnPct)}>{signedPercent(result.metrics.totalReturnPct)}</td>
                            <td className={typeof indexBenchmarkReturnPct === 'number' ? classForSigned(indexBenchmarkReturnPct) : undefined}>
                              {typeof indexBenchmarkReturnPct === 'number' ? signedPercent(indexBenchmarkReturnPct) : '-'}
                            </td>
                            <td className={validationEdgePct === null ? undefined : classForSigned(validationEdgePct)}>
                              {validationEdgePct === null ? '-' : signedPercent(validationEdgePct)}
                            </td>
                            <td>{formatNumber(result.metrics.sharpe)}</td>
                            <td className="negative">{signedPercent(result.metrics.maxDrawdownPct)}</td>
                            <td>{formatNumber(result.metrics.winRatePct, 1)}%</td>
                            <td>{result.metrics.tradeCount}</td>
                            <td>
                              <span className={`table-pill ${sampleStatus.tone}`}>{sampleStatus.label}</span>
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={9}>
                          <strong>No research strategies</strong>
                          <span>Research strategy results will populate this table.</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

          </section>
        )}

        {activeView === 'backtest' && (
          <section className="view-stack">
            <article className="panel backtest-summary-panel">
              <SectionHeading
                eyebrow={selectedBacktest?.strategy.desk ?? 'Strategy lab'}
                title="Anti-overfit validation"
                action={
                  <div className="heading-actions backtest-heading-actions">
                    <OverfitValidationPills selectedBacktest={selectedBacktest} />
                    <span className={`repo-pill ${selectedSampleStatus.tone}`}>
                      {selectedSampleStatus.label}
                    </span>
                  </div>
                }
              />
              <div className="backtest-selector-row">
                <StrategyTitleSelect
                  items={strategyStripItems}
                  selectedItem={selectedStrategyItem}
                  selectedStrategyId={selectedStrategyId}
                  onSelectStrategy={selectStrategy}
                />
              </div>
              <OverfitValidationBand selectedBacktest={selectedBacktest} />
              <div className="stat-grid backtest-stat-grid">
                {(selectedBacktest
                  ? [
                      ['Win rate', `${formatNumber(selectedBacktest.metrics.winRatePct, 1)}%`, 'Positive return rows'],
                      ['Profit factor', formatNumber(selectedBacktest.metrics.profitFactor), 'Gross wins / losses'],
                      [
                        'P-value',
                        selectedRealityCheck
                          ? formatPValue(selectedRealityCheck.pValue, selectedRealityCheck.minimumResolvablePValue)
                          : '-',
                        primaryPValueDetail(selectedRealityCheck),
                      ],
                      ['Exposure', `${formatNumber(selectedBacktest.metrics.exposurePct, 1)}%`, 'Estimated time in trade'],
                      ['Turnover', formatNumber(selectedBacktest.metrics.turnover), 'Trade count proxy'],
                      ['CVaR 95', `${formatNumber(selectedBacktest.metrics.cvar95Pct)}%`, 'Tail return-row loss'],
                    ]
                  : emptyStats
                ).map(([label, value, detail]) => (
                  <article key={label} className="stat-tile">
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <em>{detail}</em>
                  </article>
                ))}
              </div>
            </article>

            <article className="panel table-panel">
              <SectionHeading
                eyebrow="Component split"
                title="Sub-strategy breakdown"
                action={<span className={`repo-pill ${selectedSampleStatus.tone}`}>{selectedBacktest?.strategy.promotionStatus ?? 'Pending'}</span>}
              />
              <div className="side-split-grid">
                {!!selectedComponentSideStats.length && (
                  <div
                    className="side-split-primary-grid"
                    style={{ '--side-split-columns': selectedComponentSideStats.length || 1 } as CSSProperties}
                  >
                    {selectedComponentSideStats.map((side) => (
                      <SideSplitCard key={side.id} side={side} />
                    ))}
                  </div>
                )}
                {selectedIndexSideStat && <SideSplitCard side={selectedIndexSideStat} className="index-fallback" />}
              </div>
            </article>

          </section>
        )}

        {activeView === 'models' && (
          <section className="view-stack">
            <div className="split-layout">
              <article className="panel chart-panel wide">
                <SectionHeading eyebrow="Forecast QA" title="Weather model error profile" />
                <div className="chart-frame tall">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weatherScoreBars} margin={chartMargin}>
                      <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="value" name="Error" isAnimationActive={false}>
                        {weatherScoreBars.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {!weatherScoreBars.length && <ChartEmptyOverlay title="No weather scores" detail="Forecast score rows need matching actual anomalies." />}
                </div>
              </article>
              <article className="panel model-score">
                <SectionHeading eyebrow={weatherMetricsSource} title="Weather edge" />
                {weatherMetrics ? (
                  <>
                    <div className="score-ring">
                      <strong>{formatNumber(weatherMetrics.directionalAccuracyPct, 1)}%</strong>
                      <span>Directional accuracy</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Cold recall</dt>
                        <dd>{formatNumber(weatherMetrics.coldRecallPct, 1)}%</dd>
                      </div>
                      <div>
                        <dt>Bias</dt>
                        <dd>{signedUnit(weatherMetrics.bias, weatherMetrics.unitLabel)}</dd>
                      </div>
                      <div>
                        <dt>R2</dt>
                        <dd>{formatNumber(weatherMetrics.r2, 3)}</dd>
                      </div>
                      <div>
                        <dt>Rows</dt>
                        <dd>{formatCompact(weatherMetrics.rowCount)}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <EmptyList title="No model edge scored" detail="Real imported forecast rows will populate these gates." />
                )}
              </article>
            </div>

            <div className="three-column models-grid">
              <article className="panel table-panel double">
                <SectionHeading eyebrow="Registry" title="Model runs" />
                <div className="table-wrap">
                  <table className="compact-table">
                    <thead>
                      <tr>
                        <th>Calendar</th>
                        <th>Issue dates</th>
                        <th>Scores</th>
                        <th>Returns</th>
                        <th>Locations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {realDataCatalog.forecastCalendars.map((calendar) => (
                        <tr key={calendar.id}>
                          <td>
                            <strong>{calendar.label}</strong>
                            <span>{calendar.id}</span>
                          </td>
                          <td>
                            {calendar.issueDateStart} to {calendar.issueDateEnd}
                          </td>
                          <td>{formatCompact(calendar.scoreRows)}</td>
                          <td>{formatCompact(calendar.returnRows)}</td>
                          <td>{formatCompact(calendar.locationRows)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="panel chart-panel">
                <SectionHeading eyebrow="Dataset" title="Real sources" />
                <div className="feature-list">
                  <div className="feature-row">
                    <span>Forecast scores</span>
                    <div className="feature-bar">
                      <i style={{ width: '100%' }}></i>
                    </div>
                    <em>{formatCompact(totalSignalScores)}</em>
                  </div>
                  <div className="feature-row">
                    <span>Signal returns</span>
                    <div className="feature-bar">
                      <i style={{ width: '100%' }}></i>
                    </div>
                    <em>{formatCompact(totalSignalReturns)}</em>
                  </div>
                  <div className="feature-row">
                    <span>Location rows</span>
                    <div className="feature-bar">
                      <i style={{ width: '100%' }}></i>
                    </div>
                    <em>{formatCompact(totalLocationRows)}</em>
                  </div>
                </div>
              </article>
            </div>
          </section>
        )}

        {activeView === 'data' && (
          <section className="view-stack">
            <div className="split-layout">
              <article className="panel data-import wide">
                <SectionHeading eyebrow="Plug-in lane" title="Data ingest" />
                <div className="import-actions">
                  <label className="file-button">
                    <FileUp size={18} aria-hidden="true" />
                    Weather CSV
                    <input type="file" accept=".csv,text/csv" onChange={handleFile('weather')} />
                  </label>
                  <label className="file-button">
                    <Upload size={18} aria-hidden="true" />
                    Natural gas CSV
                    <input type="file" accept=".csv,text/csv" onChange={handleFile('market')} />
                  </label>
                  <button type="button" className="ghost-button" disabled={!hasLabData} onClick={clearLabData}>
                    <Database size={17} aria-hidden="true" />
                    Clear lab
                  </button>
                </div>
                <p className="import-log">{importLog}</p>
                <div className="schema-grid">
                  <div>
                    <strong>Weather columns</strong>
                    <code>date, stationBlend, actualHdd, forecastHdd, actualCdd, forecastCdd, tempAnomalyF, windMph, precipIn, confidence</code>
                  </div>
                  <div>
                    <strong>Natural gas columns</strong>
                    <code>date, open, high, low, close, volume, contract, storageBcf</code>
                  </div>
                </div>
              </article>

              <article className="panel source-health">
                <SectionHeading eyebrow="Dataset" title="Coverage" />
                <dl>
                  <div>
                    <dt>Weather rows</dt>
                    <dd>{weather.length}</dd>
                  </div>
                  <div>
                    <dt>Market rows</dt>
                    <dd>{market.length}</dd>
                  </div>
                  <div>
                    <dt>Joined rows</dt>
                    <dd>{joinedRows.length}</dd>
                  </div>
                  <div>
                    <dt>Active strategies</dt>
                    <dd>{researchStrategyRegistry.length}</dd>
                  </div>
                  <div>
                    <dt>Capital base</dt>
                    <dd>{formatCurrency(settings.initialCapital)}</dd>
                  </div>
                  <div>
                    <dt>Catalog root</dt>
                    <dd>{realDataCatalog.defaultDataRoot}</dd>
                  </div>
                </dl>
              </article>
            </div>

            <article className="panel table-panel">
              <SectionHeading eyebrow="Shared data" title="Forecast calendar files" />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Calendar</th>
                      <th>Issue dates</th>
                      <th>Score rows</th>
                      <th>Return rows</th>
                      <th>Return file</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realDataCatalog.forecastCalendars.map((calendar) => (
                      <tr key={calendar.id}>
                        <td>
                          <strong>{calendar.label}</strong>
                        </td>
                        <td>
                          {calendar.issueDateStart} to {calendar.issueDateEnd}
                        </td>
                        <td>{formatCompact(calendar.scoreRows)}</td>
                        <td>{formatCompact(calendar.returnRows)}</td>
                        <td>
                          <code>{calendar.signalReturnsPath}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel connector-panel">
              <SectionHeading eyebrow="Infrastructure" title="Provider adapters" />
              <div className="connector-grid">
                {integrationConnectors.map((connector) => (
                  <article key={connector.name} className="connector-card">
                    <div>
                      <span>{connector.category}</span>
                      <strong>{connector.name}</strong>
                    </div>
                    <p>{connector.purpose}</p>
                    <footer>
                      <code>{connector.envVar}</code>
                      <em>{connector.status}</em>
                    </footer>
                  </article>
                ))}
              </div>
            </article>
          </section>
        )}

        {activeView === 'execution' && (
          <section className="view-stack">
            <article className="panel table-panel">
              <SectionHeading eyebrow="Routing runway" title="Orderable instruments" />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th>Code</th>
                      <th>Venue</th>
                      <th>Size</th>
                      <th>Settlement</th>
                      <th>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executionVenues.map((venue) => (
                      <tr key={venue.code}>
                        <td>
                          <strong>{venue.instrument}</strong>
                        </td>
                        <td>{venue.code}</td>
                        <td>{venue.venue}</td>
                        <td>{venue.contractSize}</td>
                        <td>{venue.settlement}</td>
                        <td>{venue.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <div className="split-layout">
              <article className="panel readiness-panel wide">
                <SectionHeading eyebrow="Controls" title="Dry-run paper gate" />
                <div className="readiness-grid">
                  {paperExecutionReadinessGates.map((gate, index) => (
                    <div key={gate.id} className="readiness-row">
                      <span>{index + 1}</span>
                      <p>
                        <strong>{gate.label}</strong>
                        {gate.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel execution-card">
                <SectionHeading eyebrow="Adapter" title={dryRunGatewayProfile.label} />
                <div className="execution-status">
                  <RadioTower size={36} aria-hidden="true" />
                  <strong>Live routing disabled</strong>
                  <span>{dryRunGatewayProfile.purpose}</span>
                  <code>{defaultDryRunRiskPolicy.id}: max ${formatCompact(defaultDryRunRiskPolicy.maxNotionalUsd)} notional, {defaultDryRunRiskPolicy.maxHoldingDays}d hold cap</code>
                </div>
                <button type="button" className="primary-button" onClick={() => setActiveView('data')}>
                  <SlidersHorizontal size={17} aria-hidden="true" />
                  Review adapters
                </button>
              </article>
            </div>
          </section>
        )}

        {activeView === 'github' && (
          <section className="view-stack">
            <div className="split-layout">
              <article className="panel github-panel wide">
                <SectionHeading
                  eyebrow="Repository"
                  title="GitHub control"
                  action={<span className={`repo-pill ${repoTone}`}>{repoStatusText}</span>}
                />
                <div className="repo-status-grid">
                  <article>
                    <GitBranch size={18} aria-hidden="true" />
                    <span>Branch</span>
                    <strong>{repoBranchLabel}</strong>
                    <em>{githubStatus?.currentShort ?? (githubError ? 'No status' : 'Local')}</em>
                  </article>
                  <article>
                    <Download size={18} aria-hidden="true" />
                    <span>Behind</span>
                    <strong>{githubStatus?.behind ?? '-'}</strong>
                    <em>{githubStatus?.remoteShort ?? (githubError ? 'No status' : 'Remote')}</em>
                  </article>
                  <article>
                    <UploadCloud size={18} aria-hidden="true" />
                    <span>Ahead</span>
                    <strong>{githubStatus?.ahead ?? '-'}</strong>
                    <em>{githubStatus?.dirtyCount ?? 0} dirty</em>
                  </article>
                  <article>
                    <Clock3 size={18} aria-hidden="true" />
                    <span>Last check</span>
                    <strong>{isGithubChecking ? 'Checking...' : formatTimestamp(githubStatus?.lastCheckedAt)}</strong>
                    <em>{isGithubChecking ? 'GitHub refresh' : `${formatTimestamp(githubStatus?.lastLaunchUpdateAt)} launch`}</em>
                  </article>
                </div>
                <div className={`github-message ${repoTone}`}>
                  {repoTone === 'positive' ? (
                    <CheckCircle2 size={18} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={18} aria-hidden="true" />
                  )}
                  <span>{githubError || githubMessage || githubStatus?.message}</span>
                </div>
                <code>{repoRemoteLabel}</code>
              </article>

              <article className="panel github-actions-card">
                <SectionHeading eyebrow="Actions" title="Sync controls" />
                <div className="github-button-grid">
                  <button type="button" className="ghost-button" disabled={githubBusy || githubChecking} onClick={refreshDashboard}>
                    <RefreshCw size={17} aria-hidden="true" />
                    {githubChecking ? 'Checking' : 'Check now'}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={githubBusy || !githubStatus?.updateAvailable}
                    onClick={() => void handleGithubUpdate()}
                  >
                    <Download size={17} aria-hidden="true" />
                    Update
                  </button>
                </div>
                <label className="commit-control">
                  <span>Commit message</span>
                  <input value={commitMessage} onChange={(event) => setCommitMessage(event.currentTarget.value)} />
                </label>
                <button
                  type="button"
                  className="primary-button push-button"
                  disabled={githubBusy || !githubStatus?.configured || (!githubStatus?.dirty && (githubStatus?.ahead ?? 0) === 0)}
                  onClick={() => void handleGithubPush()}
                >
                  <GitCommit size={17} aria-hidden="true" />
                  Commit + push
                </button>
              </article>
            </div>

            <article className="panel table-panel">
              <SectionHeading eyebrow="Working tree" title="Local change list" />
              <div className="dirty-file-list">
                {dirtyFileRows.map((file) => (
                  <code key={file}>{file}</code>
                ))}
              </div>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
