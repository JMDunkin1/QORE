import {
  type ChangeEvent,
  type ElementType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
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
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
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
const strategyChartMargin = { top: 16, right: 18, bottom: 12, left: 0 }
const maxChartWheelZoomPower = 4
const primaryRankMinTrades = 8
const minZoomWindow = 4
const strategyDetailLineMaxPoints = 80
const millisecondsPerYear = 365.25 * 24 * 60 * 60 * 1000
const benchmarkLabel = 'UNG buy/hold'
const indexBenchmarkLabel = 'US index basket'
const researchRankScore = (result: (typeof researchBacktestResults)[number]) => {
  const samplePenalty = result.metrics.tradeCount >= primaryRankMinTrades ? 0 : -10000
  const tradeCountCredit = Math.min(result.metrics.tradeCount, 100) * 0.03
  return samplePenalty + result.metrics.cagrPct + result.metrics.sharpe * 8 + result.metrics.calmar * 4 + result.metrics.maxDrawdownPct * 0.4 + tradeCountCredit
}
const sortResearchResults = (a: (typeof researchBacktestResults)[number], b: (typeof researchBacktestResults)[number]) =>
  researchRankScore(b) - researchRankScore(a) ||
  b.metrics.cagrPct - a.metrics.cagrPct ||
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
type SplitEdgeName = 'train' | 'validation' | 'holdout' | 'all'
type WeatherSideSeason = 'winter' | 'summer' | 'all-year'
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

const weatherSideDefinitions: readonly WeatherSideDefinition[] = [
  { id: 'cold-long', label: 'Cold-long', seasons: ['winter', 'all-year'], thesisKinds: ['cold-long'] },
  { id: 'warm-short', label: 'Warm-short', seasons: ['winter', 'all-year'], thesisKinds: ['warm-short'] },
  { id: 'summer-cold-short', label: 'Summer cold-short', seasons: ['summer', 'all-year'], thesisKinds: ['summer-cold-short'] },
  { id: 'summer-heat-long', label: 'Summer heat-long', seasons: ['summer', 'all-year'], thesisKinds: ['summer-heat-long'] },
  { id: 'reversion-long', label: 'Reversion-long', thesisKinds: ['reversion-long'] },
  { id: 'reversion-short', label: 'Reversion-short', thesisKinds: ['reversion-short'] },
  { id: 'index-fallback', label: 'Index fallback', thesisKinds: ['index-fallback'] },
]

function splitEdgeForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined, split: SplitEdgeName) {
  const splitEdges = strategy?.params.splitEdges
  if (!splitEdges || typeof splitEdges !== 'object') return null
  const value = (splitEdges as Partial<Record<SplitEdgeName, unknown>>)[split]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

function weatherSideSeasonForStrategy(strategy: ResearchBacktestResult['strategy'] | null | undefined): WeatherSideSeason {
  if (strategy?.family === 'weather-summer') return 'summer'
  if (strategy?.family === 'weather-alpha') return 'winter'
  return 'all-year'
}

function tradeHasThesisKind(trade: ResearchTrade, thesisKind: string) {
  if (trade.thesisKind === thesisKind) return true
  return trade.componentThesisKinds?.some((component) => component === thesisKind || component.endsWith(`:${thesisKind}`)) ?? false
}

function sideStatsForTrades(trades: ResearchTrade[], weatherSeason: WeatherSideSeason) {
  return weatherSideDefinitions.filter((side) => !side.seasons || side.seasons.includes(weatherSeason)).map((side) => {
    const sideTrades = trades.filter((trade) => side.thesisKinds.some((thesisKind) => tradeHasThesisKind(trade, thesisKind)))
    const totalReturnPct = sideTrades.reduce((equity, trade) => equity * (1 + trade.netReturnPct / 100), 1) - 1
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

function strategyPerformanceChartSeries(strategyColor: string | undefined, showDetailLines: boolean): SmoothChartSeries<DashboardChartPoint>[] {
  return [
    {
      axis: 'left',
      color: strategyColor ?? '#0891b2',
      dataKey: 'gasReturnPct',
      fillOpacity: 0.2,
      id: 'gasReturnPct',
      label: 'Trade return %',
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
      <span className="chart-title-strategy-meta">
        {selectedItem && <strong className={classForSigned(selectedItem.returnPct)}>{signedPercent(selectedItem.returnPct)}</strong>}
        <em>{selectedItem ? `${selectedItem.family} / ${selectedItem.status}` : 'No research strategies'}</em>
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
        ? strategyPerformanceChartSeries(selectedBacktest.strategy.color, showDetailLines)
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
  const [strategyChartRange, setStrategyChartRange] = useState<ChartRange>(() =>
    fullChartRange(defaultSelectedBacktest?.curve.length ?? 0),
  )
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
  const researchOnlyCount = useMemo(
    () => researchStrategyRegistry.filter((strategy) => strategy.promotionStatus !== 'paper-candidate').length,
    [],
  )
  const selectedBacktest = useMemo(
    () => leaderboard.find((result) => result.strategy.id === selectedStrategyId) ?? leaderboard[0] ?? null,
    [leaderboard, selectedStrategyId],
  )
  const selectedSampleStatus = useMemo(() => sampleStatusFor(selectedBacktest), [selectedBacktest])
  const selectedWeatherSideSeason = useMemo(() => weatherSideSeasonForStrategy(selectedBacktest?.strategy), [selectedBacktest])
  const selectedSideStats = useMemo(
    () => sideStatsForTrades(selectedBacktest?.trades ?? [], selectedWeatherSideSeason),
    [selectedBacktest, selectedWeatherSideSeason],
  )
  const benchmarkSummaryByStrategyId = useMemo(
    () =>
      new Map(
        leaderboard.map((result) => {
          const dates = result.curve.map((point) => point.date)
          const benchmarkStartDate =
            result.researchMetrics.firstEntry ||
            result.trades
              .slice()
              .sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate))[0]?.entryTradeDate ||
            dates[0]
          const benchmarkReturnPct = relativeBenchmarkReturn(
            [...benchmarkPctByDate(benchmarkMarketBars, dates, benchmarkStartDate).values()],
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
  const indexBenchmarkSummaryByStrategyId = useMemo(
    () =>
      new Map(
        leaderboard.map((result) => {
          const dates = result.curve.map((point) => point.date)
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
    const dates = selectedBacktest ? selectedBacktest.curve.map((point) => point.date) : joinedRows.map((point) => point.date)
    const benchmarkStartDate =
      selectedBacktest?.researchMetrics.firstEntry ||
      selectedBacktest?.trades
        .slice()
        .sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate))[0]?.entryTradeDate ||
      dates[0]
    return benchmarkPctByDate(indexBenchmarkMarketBars, dates, benchmarkStartDate)
  }, [joinedRows, selectedBacktest])
  const latestMarket = market.at(-1)
  const latestPoint = selectedBacktest?.curve.at(-1) ?? joinedRows.at(-1)
  const hasLabData = weather.length > 0 || market.length > 0
  const chartData: DashboardChartPoint[] = useMemo(
    () =>
      selectedBacktest
        ? selectedBacktest.curve.map((point, chartIndex) => ({
            ...point,
            chartIndex,
            gasReturnPct: point.gasReturnPct,
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
            demandScore: point.demandScore,
            storageBcf: point.storageBcf,
            benchmarkPct: benchmarkByDate.get(point.date) ?? null,
            indexBenchmarkPct: indexBenchmarkByDate.get(point.date) ?? null,
          })),
    [benchmarkByDate, indexBenchmarkByDate, joinedRows, selectedBacktest],
  )
  const clampedStrategyChartRange = useMemo(
    () => clampChartRange(strategyChartRange, chartData.length),
    [chartData.length, strategyChartRange],
  )
  const scatterData = joinedRows.length
    ? joinedRows.map((point) => ({
        date: point.date,
        weatherSurprise: Number(point.weatherSurprise.toFixed(2)),
        returnPct: Number((point.dailyReturn * 100).toFixed(3)),
        storageBcf: point.storageBcf,
      }))
    : hasLabData
      ? []
      : (selectedBacktest?.curve.map((point) => ({
          date: point.date,
          weatherSurprise: Number(point.weatherSurprise.toFixed(2)),
          returnPct: Number(point.gasReturnPct.toFixed(3)),
          strategy: selectedBacktest.strategy.name,
        })) ?? [])
  const weatherScoreBars = weatherMetrics
    ? [
        { name: `${weatherMetrics.metricLabel} MAE`, value: weatherMetrics.mae, color: '#2563eb' },
        { name: `${weatherMetrics.metricLabel} RMSE`, value: weatherMetrics.rmse, color: '#0891b2' },
        { name: 'Bias', value: weatherMetrics.bias, color: weatherMetrics.bias > 0 ? '#f97316' : '#7c3aed' },
        { name: 'R2', value: weatherMetrics.r2, color: '#0f766e' },
      ]
    : []
  const strategyBars = leaderboard.map((result, index) => ({
    rankLabel: `#${index + 1}`,
    name: result.strategy.name,
    returnPct: result.metrics.totalReturnPct,
    sharpe: result.metrics.sharpe,
    color: result.strategy.color,
  }))
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
  const selectedIndexBenchmarkPoints = chartData.filter((point) => Number.isFinite(point.indexBenchmarkPct))
  const selectedIndexBenchmarkValues = selectedIndexBenchmarkPoints.map((point) => point.indexBenchmarkPct as number)
  const selectedIndexBenchmarkReturnPct = relativeBenchmarkReturn(selectedIndexBenchmarkValues)
  const selectedIndexBenchmarkAnnualReturnPct = annualizedReturnPct(
    selectedIndexBenchmarkReturnPct,
    selectedIndexBenchmarkPoints[0]?.date,
    selectedIndexBenchmarkPoints.at(-1)?.date,
  )
  const selectedIndexBenchmarkAnnualEdgePct = selectedBacktest
    ? selectedBacktest.metrics.cagrPct - selectedIndexBenchmarkAnnualReturnPct
    : 0
  const selectedHoldoutEdgePct = splitEdgeForStrategy(selectedBacktest?.strategy, 'holdout')
  const visibleStrategyBounds = chartRangeDataBounds(clampedStrategyChartRange, chartData.length)
  const visibleStrategyChartData = chartData.slice(visibleStrategyBounds.startIndex, visibleStrategyBounds.endIndex + 1)
  const showStrategyDetailLines = visibleStrategyChartData.length <= strategyDetailLineMaxPoints
  const strategyDetailChartSeries = useMemo<SmoothChartSeries<DashboardChartPoint>[]>(
    () => strategyPerformanceChartSeries(selectedBacktest?.strategy.color, showStrategyDetailLines),
    [selectedBacktest?.strategy.color, showStrategyDetailLines],
  )
  const selectedRangeStats = selectedBacktest
    ? (() => {
        const returnRows = visibleStrategyChartData.map((point) => point.gasReturnPct).filter(Number.isFinite)
        const rangeReturnPct = (returnRows.reduce((equity, value) => equity * (1 + value / 100), 1) - 1) * 100
        const benchmarkReturnPct = relativeBenchmarkReturn(visibleStrategyChartData.map((point) => point.benchmarkPct))
        const benchmarkEdgePct = rangeReturnPct - benchmarkReturnPct
        const indexBenchmarkReturnPct = relativeBenchmarkReturn(visibleStrategyChartData.map((point) => point.indexBenchmarkPct))
        const indexBenchmarkEdgePct = rangeReturnPct - indexBenchmarkReturnPct
        const maxDrawdownPct = visibleStrategyChartData.length
          ? Math.min(...visibleStrategyChartData.map((point) => point.drawdownPct ?? 0))
          : 0
        const bestRowPct = returnRows.length ? Math.max(...returnRows) : 0
        const worstRowPct = returnRows.length ? Math.min(...returnRows) : 0
        return [
          { label: 'Visible rows', value: `${visibleStrategyChartData.length}`, tone: 'neutral' as Tone },
          { label: 'Strategy return', value: signedPercent(roundNumber(rangeReturnPct)), tone: classForSigned(rangeReturnPct) },
          {
            label: indexBenchmarkLabel,
            value: signedPercent(roundNumber(indexBenchmarkReturnPct)),
            tone: classForSigned(indexBenchmarkReturnPct),
          },
          {
            label: 'Edge vs index',
            value: signedPercent(roundNumber(indexBenchmarkEdgePct)),
            tone: classForSigned(indexBenchmarkEdgePct),
          },
          { label: benchmarkLabel, value: signedPercent(roundNumber(benchmarkReturnPct)), tone: classForSigned(benchmarkReturnPct) },
          { label: 'Edge vs UNG', value: signedPercent(roundNumber(benchmarkEdgePct)), tone: classForSigned(benchmarkEdgePct) },
          { label: 'Max DD', value: signedPercent(maxDrawdownPct), tone: maxDrawdownPct < -5 ? 'negative' : 'neutral' },
          { label: 'Best row', value: signedPercent(bestRowPct), tone: classForSigned(bestRowPct) },
          { label: 'Worst row', value: signedPercent(worstRowPct), tone: classForSigned(worstRowPct) },
        ]
      })()
    : []
  const emptyStats = [
    ['Win rate', '-', 'Positive return rows'],
    ['Profit factor', '-', 'Gross wins / losses'],
    ['Trades', '0', 'Position changes'],
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
    const nextLength = leaderboard.find((result) => result.strategy.id === strategyId)?.curve.length ?? chartData.length
    const nextRange = fullChartRange(nextLength)
    setStrategyChartRange(nextRange)
  }

  const zoomStrategyChart = (direction: 'in' | 'out') => {
    setStrategyChartRange((current) => zoomChartRange(current, chartData.length, direction))
  }

  const panStrategyChart = (direction: 'left' | 'right') => {
    setStrategyChartRange((current) => panChartRange(current, chartData.length, direction))
  }

  const resetStrategyChart = () => {
    setStrategyChartRange(fullChartRange(chartData.length))
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
            label="Average yearly return"
            value={selectedBacktest ? signedPercent(selectedBacktest.metrics.cagrPct) : topResearchStrategy ? signedPercent(topResearchStrategy.metrics.cagrPct) : '-'}
            detail={
              selectedBacktest
                ? `${signedPercent(selectedBacktest.metrics.totalReturnPct)} total from ${formatShortDate(selectedBacktest.researchMetrics.firstEntry)} to ${formatShortDate(selectedBacktest.researchMetrics.lastExit)}`
                : topResearchStrategy
                  ? `${signedPercent(topResearchStrategy.metrics.totalReturnPct)} total research baseline`
                  : 'No research strategies loaded'
            }
            tone={selectedBacktest ? classForSigned(selectedBacktest.metrics.cagrPct) : topResearchStrategy ? classForSigned(topResearchStrategy.metrics.cagrPct) : 'warning'}
          />
          <MetricCard
            icon={LineChartIcon}
            label="Yearly vs index"
            value={selectedBacktest ? signedPercent(selectedIndexBenchmarkAnnualEdgePct) : '-'}
            detail={
              selectedBacktest
                ? `${indexBenchmarkLabel} ${signedPercent(selectedIndexBenchmarkAnnualReturnPct)} yearly over same window`
                : 'Needs a selected strategy window'
            }
            tone={selectedBacktest ? classForSigned(selectedIndexBenchmarkAnnualEdgePct) : 'warning'}
          />
          <MetricCard
            icon={Gauge}
            label="Holdout edge"
            value={selectedHoldoutEdgePct === null ? '-' : signedPercent(selectedHoldoutEdgePct)}
            detail={
              selectedHoldoutEdgePct === null
                ? 'No holdout split for selected strategy'
                : `Report-only edge vs ${indexBenchmarkLabel} after selection`
            }
            tone={selectedHoldoutEdgePct === null ? 'warning' : classForSigned(selectedHoldoutEdgePct)}
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
                ? `${signedPercent(selectedBacktest.metrics.cagrPct)} CAGR, ${formatNumber(selectedBacktest.metrics.annualVolPct)}% annual vol`
                : topResearchStrategy
                  ? `${signedPercent(topResearchStrategy.metrics.cagrPct)} CAGR in research baseline`
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
            <div className="split-layout">
              <OverviewPerformancePanel
                key={`${selectedBacktest?.strategy.id ?? 'lab'}-${chartData.length}`}
                chartData={chartData}
                onSelectStrategy={selectStrategy}
                selectedBacktest={selectedBacktest}
                selectedStrategyId={selectedBacktest?.strategy.id ?? selectedStrategyId}
                selectedStrategyItem={selectedStrategyItem}
                strategyItems={strategyStripItems}
              />

              <article className="panel market-tape">
                <SectionHeading eyebrow="Market tape" title="Current regime" />
                <dl>
                  <div>
                    <dt>Contract</dt>
                    <dd>{latestMarket?.contract ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>Last close</dt>
                    <dd>{latestMarket ? `$${formatNumber(latestMarket.close, 3)}` : '-'}</dd>
                  </div>
                  <div>
                    <dt>Volume</dt>
                    <dd>{latestMarket ? formatCompact(latestMarket.volume) : '-'}</dd>
                  </div>
                  <div>
                    <dt>Storage</dt>
                    <dd>{latestMarket ? `${formatNumber(latestMarket.storageBcf, 1)} Bcf` : '-'}</dd>
                  </div>
                  <div>
                    <dt>HDD miss</dt>
                    <dd className={classForSigned(latestPoint?.hddError ?? 0)}>{latestPoint ? formatNumber(latestPoint.hddError) : '-'}</dd>
                  </div>
                  <div>
                    <dt>Weather surprise</dt>
                    <dd className={classForSigned(latestPoint?.weatherSurprise ?? 0)}>
                      {latestPoint ? formatNumber(latestPoint.weatherSurprise) : '-'}
                    </dd>
                  </div>
                </dl>
              </article>
            </div>

            <div className="three-column">
              <article className="panel chart-panel">
                <SectionHeading eyebrow="Weather driver" title="Demand surprise vs return" />
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={chartMargin}>
                      <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="weatherSurprise"
                        name="Weather surprise"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis dataKey="returnPct" name="Return %" type="number" tick={{ fontSize: 12 }} />
                      <ReferenceLine x={0} stroke="#9aa3af" />
                      <ReferenceLine y={0} stroke="#9aa3af" />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
                      <Scatter data={scatterData} fill="#0891b2" isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                  {!scatterData.length && (
                    <ChartEmptyOverlay
                      title={hasLabData ? 'No matched dates' : 'No research curve'}
                      detail={
                        hasLabData
                          ? 'Imported weather and market rows need overlapping dates before this panel can plot.'
                          : 'Research strategy artifacts need trade rows before this panel can plot.'
                      }
                    />
                  )}
                </div>
              </article>

              <article className="panel chart-panel">
                <SectionHeading eyebrow="Strategy board" title="Return by strategy" />
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={strategyBars} margin={strategyChartMargin}>
                      <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" />
                      <XAxis dataKey="rankLabel" tick={{ fontSize: 11 }} interval={0} tickLine={false} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(label) => strategyBars.find((entry) => entry.rankLabel === String(label))?.name ?? label}
                      />
                      <Bar dataKey="returnPct" name="Return %" isAnimationActive={false}>
                        {strategyBars.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {!strategyBars.length && <ChartEmptyOverlay title="No strategies registered" detail="Real strategies will appear here as soon as they are added." />}
                </div>
                {!!strategyBars.length && (
                  <div className="strategy-chart-key" aria-label="Strategy chart key">
                    {strategyBars.map((entry) => (
                      <div key={entry.name}>
                        <span>
                          <i style={{ background: entry.color }} />
                          {entry.rankLabel}
                        </span>
                        <strong>{entry.name}</strong>
                        <em>{signedPercent(entry.returnPct)}</em>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="panel run-list">
                <SectionHeading
                  eyebrow="Registry"
                  title="Model run ladder"
                  action={
                    <span className={`repo-pill ${researchOnlyCount ? 'warning' : 'positive'}`}>
                      {researchOnlyCount ? `${researchOnlyCount} research-only` : 'Paper-ready'}
                    </span>
                  }
                />
                <div className="run-stack">
                  {researchStrategyRegistry.map((strategy) => (
                    <article key={strategy.id} className="run-row">
                      <div>
                        <span>{strategy.family}</span>
                        <strong>{strategy.name}</strong>
                        <em>{strategy.directionPolicy}</em>
                      </div>
                      <div className="run-metrics">
                        <strong className={classForSigned(strategy.metrics.totalReturnPct)}>{signedPercent(strategy.metrics.totalReturnPct)}</strong>
                        <span>{formatNumber(strategy.metrics.sharpe)} Sharpe</span>
                        <span>{strategy.metrics.tradeCount} trades</span>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            </div>
          </section>
        )}

        {activeView === 'backtest' && (
          <section className="view-stack">
            <div className="lab-layout">
              <aside className="panel control-panel">
                <SectionHeading
                  eyebrow="Research"
                  title={
                    <StrategyTitleSelect
                      items={strategyStripItems}
                      selectedItem={selectedStrategyItem}
                      selectedStrategyId={selectedStrategyId}
                      onSelectStrategy={selectStrategy}
                    />
                  }
                />
                <dl className="artifact-summary">
                  <div>
                    <dt>Variant</dt>
                    <dd>{selectedBacktest?.strategy.variant ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>Trades</dt>
                    <dd>{selectedBacktest?.metrics.tradeCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Quality</dt>
                    <dd>{selectedSampleStatus.label}</dd>
                  </div>
                  <div>
                    <dt>Period</dt>
                    <dd>
                      {selectedBacktest
                        ? `${selectedBacktest.researchMetrics.firstEntry} to ${selectedBacktest.researchMetrics.lastExit}`
                        : '-'}
                    </dd>
                  </div>
                  <div>
                    <dt>Sources</dt>
                    <dd>{selectedBacktest?.strategy.sourceUniverse.join(', ') || '-'}</dd>
                  </div>
                  <div>
                    <dt>Capital</dt>
                    <dd>{formatCurrency(settings.initialCapital)}</dd>
                  </div>
                </dl>
              </aside>

              <article className="panel chart-panel wide">
                <SectionHeading
                  eyebrow={selectedBacktest?.strategy.desk ?? 'Strategy lab'}
                  title={selectedBacktest?.strategy.name ?? 'No research strategies'}
                  action={
                    <div className="heading-actions">
                      <span className={`repo-pill ${selectedSampleStatus.tone}`}>
                        {selectedSampleStatus.label}
                      </span>
                      <ChartZoomToolbar
                        data={chartData}
                        range={clampedStrategyChartRange}
                        onZoomIn={() => zoomStrategyChart('in')}
                        onZoomOut={() => zoomStrategyChart('out')}
                        onPanLeft={() => panStrategyChart('left')}
                        onPanRight={() => panStrategyChart('right')}
                        onReset={resetStrategyChart}
                      />
                    </div>
                  }
                />
                <p className="thesis">
                  {selectedBacktest?.strategy.thesis ?? 'No research strategy is active.'}
                </p>
                <div className="chart-frame tall">
                  <SmoothZoomChart
                    data={chartData}
                    formatDate={formatShortDate}
                    minWindow={minZoomWindow}
                    onRangeChange={setStrategyChartRange}
                    range={clampedStrategyChartRange}
                    series={strategyDetailChartSeries}
                  />
                  {!selectedBacktest && (
                    <ChartEmptyOverlay
                      title="No research strategy selected"
                      detail="Strategy-test artifacts will populate this chart when available."
                    />
                  )}
                </div>
                {!!selectedRangeStats.length && (
                  <dl className="chart-range-stats" aria-label="Visible strategy range">
                    {selectedRangeStats.map((stat) => (
                      <div key={stat.label}>
                        <dt>{stat.label}</dt>
                        <dd className={stat.tone}>{stat.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </article>
            </div>

            <div className="stat-grid">
              {(selectedBacktest
                ? [
                    ['Win rate', `${formatNumber(selectedBacktest.metrics.winRatePct, 1)}%`, 'Positive return rows'],
                    ['Profit factor', formatNumber(selectedBacktest.metrics.profitFactor), 'Gross wins / losses'],
                    ['Trades', `${selectedBacktest.metrics.tradeCount}`, 'Completed trades'],
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

            <article className="panel table-panel">
              <SectionHeading
                eyebrow="Side split"
                title="Weather side split"
                action={<span className={`repo-pill ${selectedSampleStatus.tone}`}>{selectedBacktest?.strategy.promotionStatus ?? 'Pending'}</span>}
              />
              <div className="side-split-grid">
                {selectedSideStats.map((side) => (
                  <article key={side.id} className="side-split-card">
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
                ))}
              </div>
            </article>

            <article className="panel table-panel">
              <SectionHeading eyebrow="Ranking" title="Strategy leaderboard" />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th>Total return</th>
                      <th>Index</th>
                      <th>Vs index</th>
                      <th>Holdout edge</th>
                      <th>UNG</th>
                      <th>Vs UNG</th>
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
                        const benchmarkSummary = benchmarkSummaryByStrategyId.get(result.strategy.id)
                        const indexBenchmarkSummary = indexBenchmarkSummaryByStrategyId.get(result.strategy.id)
                        const holdoutEdgePct = splitEdgeForStrategy(result.strategy, 'holdout')
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
                            <td className={classForSigned(indexBenchmarkSummary?.returnPct ?? 0)}>
                              {signedPercent(indexBenchmarkSummary?.returnPct ?? 0)}
                            </td>
                            <td className={classForSigned(indexBenchmarkSummary?.edgePct ?? 0)}>
                              {signedPercent(indexBenchmarkSummary?.edgePct ?? 0)}
                            </td>
                            <td className={holdoutEdgePct === null ? undefined : classForSigned(holdoutEdgePct)}>
                              {holdoutEdgePct === null ? '-' : signedPercent(holdoutEdgePct)}
                            </td>
                            <td className={classForSigned(benchmarkSummary?.returnPct ?? 0)}>{signedPercent(benchmarkSummary?.returnPct ?? 0)}</td>
                            <td className={classForSigned(benchmarkSummary?.edgePct ?? 0)}>{signedPercent(benchmarkSummary?.edgePct ?? 0)}</td>
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
                        <td colSpan={12}>
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
              <SectionHeading eyebrow="Routing runway" title="Natural gas instruments" />
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
