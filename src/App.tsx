import { type ChangeEvent, type ElementType, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
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
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  UploadCloud,
} from 'lucide-react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import { defaultSettings, joinMarketWeather } from './backtesting/engine'
import { realDataCatalog, totalLocationRows, totalSignalReturns, totalSignalScores } from './data/realDataCatalog'
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
const primaryRankMinTrades = 8
const researchRankScore = (result: (typeof researchBacktestResults)[number]) => {
  const samplePenalty = result.metrics.tradeCount >= primaryRankMinTrades ? 0 : -10000
  return samplePenalty + result.metrics.totalReturnPct + result.metrics.sharpe * 2 + result.metrics.maxDrawdownPct * 0.25
}
const sortResearchResults = (a: (typeof researchBacktestResults)[number], b: (typeof researchBacktestResults)[number]) =>
  researchRankScore(b) - researchRankScore(a) || b.metrics.totalReturnPct - a.metrics.totalReturnPct || b.metrics.sharpe - a.metrics.sharpe
const defaultSelectedStrategyId =
  [...researchBacktestResults].sort(sortResearchResults)[0]?.strategy.id ?? ''
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
  date: string
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
  title: string
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

function ChartEmptyOverlay({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="chart-empty-overlay">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
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
  const [dataLabel, setDataLabel] = useState(`${researchStrategyRegistry.length} research strategies loaded`)
  const [importLog, setImportLog] = useState(
    `Tracked real data is available under ${realDataCatalog.defaultDataRoot}; ${researchStrategyRegistry.length} research strategies are loaded from strategy-test artifacts.`,
  )
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null)
  const [githubError, setGithubError] = useState('')
  const [githubMessage, setGithubMessage] = useState('Checking GitHub.')
  const [githubBusy, setGithubBusy] = useState(false)
  const [githubChecking, setGithubChecking] = useState(false)
  const [commitMessage, setCommitMessage] = useState('Update QORE dashboard')

  const joinedRows = useMemo(() => joinMarketWeather(market, weather), [market, weather])
  const weatherMetrics = useMemo(() => (weather.length ? evaluateWeatherModel(weather) : null), [weather])
  const leaderboard = useMemo(() => [...researchBacktestResults].sort(sortResearchResults), [])
  const topResearchStrategy = useMemo(
    () => leaderboard[0]?.strategy ?? [...researchStrategyRegistry].sort((a, b) => b.metrics.totalReturnPct - a.metrics.totalReturnPct)[0] ?? null,
    [leaderboard],
  )
  const needsValidationCount = useMemo(
    () => researchStrategyRegistry.filter((strategy) => strategy.promotionStatus === 'needs-more-validation').length,
    [],
  )
  const selectedBacktest = useMemo(
    () => leaderboard.find((result) => result.strategy.id === selectedStrategyId) ?? leaderboard[0] ?? null,
    [leaderboard, selectedStrategyId],
  )
  const latestMarket = market.at(-1)
  const latestPoint = selectedBacktest?.curve.at(-1) ?? joinedRows.at(-1)
  const hasLabData = weather.length > 0 || market.length > 0
  const chartData: DashboardChartPoint[] = selectedBacktest
    ? selectedBacktest.curve.map((point) => ({
        ...point,
        gasReturnPct: point.gasReturnPct,
        demandScore: point.demandScore,
        storageBcf: point.storageBcf,
        closeScaled: point.closeScaled,
      }))
    : joinedRows.map((point) => ({
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
      }))
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
        { name: 'HDD MAE', value: weatherMetrics.hddMae, color: '#2563eb' },
        { name: 'HDD RMSE', value: weatherMetrics.hddRmse, color: '#0891b2' },
        { name: 'CDD MAE', value: weatherMetrics.cddMae, color: '#f97316' },
        { name: 'CDD RMSE', value: weatherMetrics.cddRmse, color: '#ef4444' },
      ]
    : []
  const strategyBars = leaderboard.map((result, index) => ({
    rankLabel: `#${index + 1}`,
    name: result.strategy.name,
    returnPct: result.metrics.totalReturnPct,
    sharpe: result.metrics.sharpe,
    color: result.strategy.color,
  }))
  const secondaryChartSeries = selectedBacktest
    ? { dataKey: 'gasReturnPct', name: 'Trade return %' }
    : { dataKey: 'closeScaled', name: 'Gas px x1000' }
  const emptyStats = [
    ['CAGR', '-', 'Annualized return'],
    ['Volatility', '-', 'Annualized variability'],
    ['Win rate', '-', 'Positive daily PnL'],
    ['Profit factor', '-', 'Gross wins / losses'],
    ['Trades', '0', 'Position changes'],
    ['Exposure', '-', 'Average absolute'],
    ['Turnover', '-', 'Path churn'],
    ['CVaR 95', '-', 'Tail daily loss'],
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
    setDataLabel(`${researchStrategyRegistry.length} research strategies loaded`)
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
            label="Total return"
            value={selectedBacktest ? signedPercent(selectedBacktest.metrics.totalReturnPct) : topResearchStrategy ? signedPercent(topResearchStrategy.metrics.totalReturnPct) : '-'}
            detail={selectedBacktest ? `${selectedBacktest.strategy.name} on ${selectedBacktest.metrics.tradeCount} trades` : topResearchStrategy ? `${topResearchStrategy.name} research baseline` : 'No research strategies loaded'}
            tone={selectedBacktest ? classForSigned(selectedBacktest.metrics.totalReturnPct) : topResearchStrategy ? classForSigned(topResearchStrategy.metrics.totalReturnPct) : 'warning'}
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
                ? `${signedPercent(selectedBacktest.metrics.cagrPct)} CAGR, ${formatNumber(selectedBacktest.metrics.annualVolPct)}% vol`
                : topResearchStrategy
                  ? `${signedPercent(topResearchStrategy.metrics.cagrPct)} CAGR in event-row optimizer`
                  : 'Ready for real strategy metrics'
            }
            tone={(selectedBacktest?.metrics.sharpe ?? topResearchStrategy?.metrics.sharpe ?? 0) > 1 ? 'positive' : 'neutral'}
          />
          <MetricCard
            icon={ShieldCheck}
            label="Max drawdown"
            value={selectedBacktest ? signedPercent(selectedBacktest.metrics.maxDrawdownPct) : topResearchStrategy ? signedPercent(topResearchStrategy.metrics.maxDrawdownPct) : '-'}
            detail={selectedBacktest ? `${formatNumber(selectedBacktest.metrics.var95Pct)}% trade VaR 95` : topResearchStrategy ? `${topResearchStrategy.metrics.tradeCount} optimized event trades` : 'No risk path until a strategy runs'}
            tone={(selectedBacktest?.metrics.maxDrawdownPct ?? topResearchStrategy?.metrics.maxDrawdownPct ?? 0) < -15 ? 'negative' : 'positive'}
          />
          <MetricCard
            icon={CloudSun}
            label="Weather accuracy"
            value={weatherMetrics ? `${formatNumber(weatherMetrics.directionalAccuracyPct, 1)}%` : '-'}
            detail={weatherMetrics ? `HDD MAE ${formatNumber(weatherMetrics.hddMae)} | R2 ${formatNumber(weatherMetrics.r2, 3)}` : 'Import weather rows to score'}
            tone={weatherMetrics && weatherMetrics.directionalAccuracyPct > 60 ? 'positive' : 'warning'}
          />
        </section>

        {activeView === 'overview' && (
          <section className="view-stack">
            <div className="split-layout">
              <article className="panel chart-panel wide">
                <SectionHeading eyebrow="Live read" title="Equity, gas, and drawdown" />
                <div className="chart-frame tall">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={chartMargin}>
                      <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" />
                      <XAxis dataKey="date" minTickGap={30} tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="equityPct"
                        name="Equity %"
                        stroke="#2563eb"
                        fill="#dbeafe"
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey={secondaryChartSeries.dataKey}
                        name={secondaryChartSeries.name}
                        stroke="#f97316"
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="drawdownPct"
                        name="Drawdown %"
                        stroke="#e11d48"
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                  {!chartData.length && (
                    <ChartEmptyOverlay
                      title="No graph data yet"
                      detail="Research strategy artifacts are loaded, but no trade curve could be built."
                    />
                  )}
                </div>
              </article>

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
                    <span className={`repo-pill ${needsValidationCount ? 'warning' : 'positive'}`}>
                      {needsValidationCount ? `${needsValidationCount} thin-sample` : 'Validated sample'}
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
                <SectionHeading eyebrow="Research" title="Artifact selector" />
                <label className="select-control">
                  <span>Strategy</span>
                  <select value={selectedStrategyId} disabled={!leaderboard.length} onChange={(event) => setSelectedStrategyId(event.currentTarget.value)}>
                    {leaderboard.length ? (
                      leaderboard.map((result) => (
                        <option key={result.strategy.id} value={result.strategy.id}>
                          {result.strategy.name}
                        </option>
                      ))
                    ) : (
                      <option value="">No research strategies</option>
                    )}
                  </select>
                </label>
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
                    <span className={`repo-pill ${selectedBacktest?.strategy.promotionStatus === 'paper-candidate' ? 'positive' : 'warning'}`}>
                      {selectedBacktest?.strategy.promotionStatus ?? 'Pending'}
                    </span>
                  }
                />
                <p className="thesis">
                  {selectedBacktest?.strategy.thesis ?? 'No research strategy is active.'}
                </p>
                <div className="chart-frame tall">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={chartMargin}>
                      <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" />
                      <XAxis dataKey="date" minTickGap={30} tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="equityPct"
                        name="Equity %"
                        stroke="#2563eb"
                        dot={false}
                        strokeWidth={2.4}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="position"
                        name="Position"
                        stroke="#0f766e"
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="signal"
                        name="Signal"
                        stroke="#f97316"
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  {!selectedBacktest && (
                    <ChartEmptyOverlay
                      title="No research strategy selected"
                      detail="Strategy-test artifacts will populate this chart when available."
                    />
                  )}
                </div>
              </article>
            </div>

            <div className="stat-grid">
              {(selectedBacktest
                ? [
                    ['CAGR', signedPercent(selectedBacktest.metrics.cagrPct), 'Annualized return'],
                    ['Volatility', `${formatNumber(selectedBacktest.metrics.annualVolPct)}%`, 'Annualized variability'],
                    ['Win rate', `${formatNumber(selectedBacktest.metrics.winRatePct, 1)}%`, 'Positive trades'],
                    ['Profit factor', formatNumber(selectedBacktest.metrics.profitFactor), 'Gross wins / losses'],
                    ['Trades', `${selectedBacktest.metrics.tradeCount}`, 'Completed trades'],
                    ['Exposure', `${formatNumber(selectedBacktest.metrics.exposurePct, 1)}%`, 'Estimated time in trade'],
                    ['Turnover', formatNumber(selectedBacktest.metrics.turnover), 'Trade count proxy'],
                    ['CVaR 95', `${formatNumber(selectedBacktest.metrics.cvar95Pct)}%`, 'Tail trade loss'],
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
              <SectionHeading eyebrow="Ranking" title="Strategy leaderboard" />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th>Return</th>
                      <th>Sharpe</th>
                      <th>Drawdown</th>
                      <th>Win rate</th>
                      <th>Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.length ? (
                      leaderboard.map((result, index) => (
                        <tr key={result.strategy.id} onClick={() => setSelectedStrategyId(result.strategy.id)}>
                          <td>
                            <strong>#{index + 1} {result.strategy.name}</strong>
                            <span>{result.strategy.desk}</span>
                          </td>
                          <td className={classForSigned(result.metrics.totalReturnPct)}>{signedPercent(result.metrics.totalReturnPct)}</td>
                          <td>{formatNumber(result.metrics.sharpe)}</td>
                          <td className="negative">{signedPercent(result.metrics.maxDrawdownPct)}</td>
                          <td>{formatNumber(result.metrics.winRatePct, 1)}%</td>
                          <td>{result.metrics.tradeCount}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>
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
                  {!weatherScoreBars.length && <ChartEmptyOverlay title="No imported weather rows" detail="The model QA chart is ready for real imported rows." />}
                </div>
              </article>
              <article className="panel model-score">
                <SectionHeading eyebrow="Champion gates" title="Weather edge" />
                {weatherMetrics ? (
                  <>
                    <div className="score-ring">
                      <strong>{formatNumber(weatherMetrics.directionalAccuracyPct, 1)}%</strong>
                      <span>Directional accuracy</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Cold recall</dt>
                        <dd>{formatNumber(weatherMetrics.coldSurpriseRecallPct, 1)}%</dd>
                      </div>
                      <div>
                        <dt>Calibration</dt>
                        <dd>{formatNumber(weatherMetrics.calibrationScorePct, 1)}%</dd>
                      </div>
                      <div>
                        <dt>R2</dt>
                        <dd>{formatNumber(weatherMetrics.r2, 3)}</dd>
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
                    <dt>Research strategies</dt>
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
