import { type ChangeEvent, type ElementType, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Bot,
  Brain,
  CloudSun,
  Database,
  FileUp,
  Flame,
  Gauge,
  LineChart as LineChartIcon,
  Play,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  Zap,
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
import { defaultSettings, rankStrategies } from './backtesting/engine'
import { generateDemoData, modelRuns, strategies } from './data/demoData'
import { adapterChecklist, executionVenues, integrationConnectors } from './integrations/connectors'
import { evaluateWeatherModel, featureImportance } from './ml/evaluation'
import type { ActiveView, BacktestSettings, MarketBar, StrategyId, WeatherPoint } from './types'
import { classForSigned, formatCompact, formatCurrency, formatNumber, signedPercent } from './utils/format'
import { parseMarketCsv, parseWeatherCsv } from './utils/importers'

const demoData = generateDemoData()

const navItems: Array<{ id: ActiveView; label: string; icon: ElementType }> = [
  { id: 'overview', label: 'Command', icon: Gauge },
  { id: 'backtest', label: 'Backtest', icon: LineChartIcon },
  { id: 'models', label: 'Models', icon: Brain },
  { id: 'data', label: 'Data Ops', icon: Database },
  { id: 'execution', label: 'Execution', icon: RadioTower },
]

const activeViews: ActiveView[] = ['overview', 'backtest', 'models', 'data', 'execution']

const chartMargin = { top: 16, right: 18, bottom: 4, left: 0 }
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

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="range-control">
      <span>
        {label}
        <strong>
          {formatNumber(value, step < 1 ? 2 : 0)}
          {suffix}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

function App() {
  const [activeView, setActiveViewState] = useState<ActiveView>(() => viewFromHash())
  const [weather, setWeather] = useState<WeatherPoint[]>(demoData.weather)
  const [market, setMarket] = useState<MarketBar[]>(demoData.market)
  const [settings, setSettings] = useState<BacktestSettings>(defaultSettings)
  const [selectedStrategyId, setSelectedStrategyId] = useState<StrategyId>('ml-ensemble')
  const [dataLabel, setDataLabel] = useState('Demo fixture pack')
  const [importLog, setImportLog] = useState('Ready for weather CSV, natural gas CSV, or QORE run artifacts.')

  const leaderboard = useMemo(() => rankStrategies(market, weather, settings), [market, weather, settings])
  const selectedBacktest = useMemo(
    () => leaderboard.find((result) => result.strategy.id === selectedStrategyId) ?? leaderboard[0],
    [leaderboard, selectedStrategyId],
  )
  const weatherMetrics = useMemo(() => evaluateWeatherModel(weather), [weather])
  const latestPoint = selectedBacktest.joined.at(-1)
  const chartData = selectedBacktest.curve.map((point, index) => ({
    ...point,
    gasReturnPct: (selectedBacktest.joined[index]?.dailyReturn ?? 0) * 100,
    demandScore: selectedBacktest.joined[index]?.demandScore ?? 0,
    storageBcf: selectedBacktest.joined[index]?.storageBcf ?? 0,
    closeScaled: point.close * 1000,
  }))
  const scatterData = selectedBacktest.joined.map((point) => ({
    weatherSurprise: Number(point.weatherSurprise.toFixed(2)),
    returnPct: Number((point.dailyReturn * 100).toFixed(3)),
    storageBcf: point.storageBcf,
  }))
  const weatherScoreBars = [
    { name: 'HDD MAE', value: weatherMetrics.hddMae, color: '#2563eb' },
    { name: 'HDD RMSE', value: weatherMetrics.hddRmse, color: '#0891b2' },
    { name: 'CDD MAE', value: weatherMetrics.cddMae, color: '#f97316' },
    { name: 'CDD RMSE', value: weatherMetrics.cddRmse, color: '#ef4444' },
  ]
  const strategyBars = leaderboard.map((result) => ({
    name:
      result.strategy.id === 'ml-ensemble'
        ? 'ML'
        : result.strategy.id === 'weather-stress-long'
          ? 'Stress'
          : result.strategy.id === 'storage-fade'
            ? 'Storage'
            : result.strategy.id === 'volatility-breakout'
              ? 'Vol'
              : 'Carry',
    returnPct: result.metrics.totalReturnPct,
    sharpe: result.metrics.sharpe,
    color: result.strategy.color,
  }))

  const updateSetting = (key: keyof BacktestSettings, value: number) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const setActiveView = (view: ActiveView) => {
    setActiveViewState(view)
    window.history.replaceState(null, '', `#${view}`)
  }

  useEffect(() => {
    const handleHashChange = () => setActiveViewState(viewFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const handleFile = (kind: 'weather' | 'market') => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      if (kind === 'weather') {
        const rows = parseWeatherCsv(text)
        if (rows.length < 2) throw new Error('Weather CSV did not contain enough rows.')
        setWeather(rows)
        setDataLabel(`${file.name} + ${market.length} market rows`)
        setImportLog(`Loaded ${rows.length} weather rows from ${file.name}.`)
      } else {
        const rows = parseMarketCsv(text)
        if (rows.length < 2) throw new Error('Market CSV did not contain enough rows.')
        setMarket(rows)
        setDataLabel(`${weather.length} weather rows + ${file.name}`)
        setImportLog(`Loaded ${rows.length} natural gas rows from ${file.name}.`)
      }
    } catch (error) {
      setImportLog(error instanceof Error ? error.message : 'Import failed.')
    } finally {
      event.currentTarget.value = ''
    }
  }

  const resetDemoData = () => {
    setWeather(demoData.weather)
    setMarket(demoData.market)
    setDataLabel('Demo fixture pack')
    setImportLog('Demo weather and natural gas fixtures restored.')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="QORE dashboard sections">
        <div className="brand-block">
          <div className="brand-mark">
            <Flame size={23} aria-hidden="true" />
          </div>
          <div>
            <strong>QORE</strong>
            <span>Weather alpha desk</span>
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
            <span className="eyebrow">Natural gas x weather research</span>
            <h1>Strategy command center</h1>
          </div>
          <div className="top-actions">
            <button type="button" className="ghost-button" onClick={resetDemoData}>
              <Zap size={17} aria-hidden="true" />
              Demo data
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
            value={signedPercent(selectedBacktest.metrics.totalReturnPct)}
            detail={`${selectedBacktest.strategy.name} on ${selectedBacktest.curve.length} sessions`}
            tone={classForSigned(selectedBacktest.metrics.totalReturnPct)}
          />
          <MetricCard
            icon={Activity}
            label="Sharpe / Sortino"
            value={`${formatNumber(selectedBacktest.metrics.sharpe)} / ${formatNumber(selectedBacktest.metrics.sortino)}`}
            detail={`${signedPercent(selectedBacktest.metrics.cagrPct)} CAGR, ${formatNumber(selectedBacktest.metrics.annualVolPct)}% vol`}
            tone={selectedBacktest.metrics.sharpe > 1 ? 'positive' : 'neutral'}
          />
          <MetricCard
            icon={ShieldCheck}
            label="Max drawdown"
            value={signedPercent(selectedBacktest.metrics.maxDrawdownPct)}
            detail={`${formatNumber(selectedBacktest.metrics.var95Pct)}% daily VaR 95`}
            tone={selectedBacktest.metrics.maxDrawdownPct < -7 ? 'negative' : 'positive'}
          />
          <MetricCard
            icon={CloudSun}
            label="Weather accuracy"
            value={`${formatNumber(weatherMetrics.directionalAccuracyPct, 1)}%`}
            detail={`HDD MAE ${formatNumber(weatherMetrics.hddMae)} | R2 ${formatNumber(weatherMetrics.r2, 3)}`}
            tone={weatherMetrics.directionalAccuracyPct > 60 ? 'positive' : 'warning'}
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
                        dataKey="closeScaled"
                        name="Gas px x1000"
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
                </div>
              </article>

              <article className="panel market-tape">
                <SectionHeading eyebrow="Market tape" title="Current regime" />
                <dl>
                  <div>
                    <dt>Contract</dt>
                    <dd>{latestPoint?.contract ?? 'NG'}</dd>
                  </div>
                  <div>
                    <dt>Last close</dt>
                    <dd>${formatNumber(latestPoint?.close ?? 0, 3)}</dd>
                  </div>
                  <div>
                    <dt>Volume</dt>
                    <dd>{formatCompact(latestPoint?.volume ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Storage</dt>
                    <dd>{formatNumber(latestPoint?.storageBcf ?? 0, 1)} Bcf</dd>
                  </div>
                  <div>
                    <dt>HDD miss</dt>
                    <dd className={classForSigned(latestPoint?.hddError ?? 0)}>{formatNumber(latestPoint?.hddError ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Weather surprise</dt>
                    <dd className={classForSigned(latestPoint?.weatherSurprise ?? 0)}>
                      {formatNumber(latestPoint?.weatherSurprise ?? 0)}
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
                </div>
              </article>

              <article className="panel chart-panel">
                <SectionHeading eyebrow="Strategy board" title="Return by strategy" />
                <div className="chart-frame">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={strategyBars} margin={chartMargin}>
                      <CartesianGrid stroke="#e7ebef" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="returnPct" name="Return %" isAnimationActive={false}>
                        {strategyBars.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="panel run-list">
                <SectionHeading eyebrow="Champion" title="Model run ladder" />
                {modelRuns.map((run) => (
                  <button key={run.id} type="button" className="run-row" onClick={() => setActiveView('models')}>
                    <span className={`status-dot ${run.status.toLowerCase()}`}></span>
                    <div>
                      <strong>{run.name}</strong>
                      <span>
                        {run.status} | {formatNumber(run.directionalAccuracyPct, 1)}% directional
                      </span>
                    </div>
                    <em>{signedPercent(run.pnlLiftPct, 1)}</em>
                  </button>
                ))}
              </article>
            </div>
          </section>
        )}

        {activeView === 'backtest' && (
          <section className="view-stack">
            <div className="lab-layout">
              <aside className="panel control-panel">
                <SectionHeading eyebrow="Controls" title="Backtest lab" />
                <label className="select-control">
                  <span>Strategy</span>
                  <select value={selectedStrategyId} onChange={(event) => setSelectedStrategyId(event.currentTarget.value as StrategyId)}>
                    {strategies.map((strategy) => (
                      <option key={strategy.id} value={strategy.id}>
                        {strategy.name}
                      </option>
                    ))}
                  </select>
                </label>
                <RangeControl
                  label="Risk per signal"
                  value={settings.riskPerSignal}
                  min={0.05}
                  max={1.25}
                  step={0.05}
                  onChange={(value) => updateSetting('riskPerSignal', value)}
                />
                <RangeControl
                  label="Max exposure"
                  value={settings.maxExposure}
                  min={0.25}
                  max={2}
                  step={0.05}
                  onChange={(value) => updateSetting('maxExposure', value)}
                />
                <RangeControl
                  label="Weather weight"
                  value={settings.weatherWeight}
                  min={0}
                  max={1.2}
                  step={0.05}
                  onChange={(value) => updateSetting('weatherWeight', value)}
                />
                <RangeControl
                  label="Storage weight"
                  value={settings.storageWeight}
                  min={0}
                  max={1.2}
                  step={0.05}
                  onChange={(value) => updateSetting('storageWeight', value)}
                />
                <RangeControl
                  label="Slippage"
                  value={settings.slippageBps}
                  min={0}
                  max={12}
                  step={0.5}
                  suffix=" bps"
                  onChange={(value) => updateSetting('slippageBps', value)}
                />
                <RangeControl
                  label="Commission"
                  value={settings.commissionBps}
                  min={0}
                  max={6}
                  step={0.25}
                  suffix=" bps"
                  onChange={(value) => updateSetting('commissionBps', value)}
                />
              </aside>

              <article className="panel chart-panel wide">
                <SectionHeading
                  eyebrow={selectedBacktest.strategy.desk}
                  title={selectedBacktest.strategy.name}
                  action={<span className={`risk-pill ${selectedBacktest.strategy.riskLevel.toLowerCase()}`}>{selectedBacktest.strategy.riskLevel}</span>}
                />
                <p className="thesis">{selectedBacktest.strategy.thesis}</p>
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
                </div>
              </article>
            </div>

            <div className="stat-grid">
              {[
                ['CAGR', signedPercent(selectedBacktest.metrics.cagrPct), 'Annualized return'],
                ['Volatility', `${formatNumber(selectedBacktest.metrics.annualVolPct)}%`, 'Annualized variability'],
                ['Win rate', `${formatNumber(selectedBacktest.metrics.winRatePct, 1)}%`, 'Positive daily PnL'],
                ['Profit factor', formatNumber(selectedBacktest.metrics.profitFactor), 'Gross wins / losses'],
                ['Trades', `${selectedBacktest.metrics.tradeCount}`, 'Position changes'],
                ['Exposure', `${formatNumber(selectedBacktest.metrics.exposurePct, 1)}%`, 'Average absolute'],
                ['Turnover', formatNumber(selectedBacktest.metrics.turnover), 'Path churn'],
                ['CVaR 95', `${formatNumber(selectedBacktest.metrics.cvar95Pct)}%`, 'Tail daily loss'],
              ].map(([label, value, detail]) => (
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
                    {leaderboard.map((result, index) => (
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
                    ))}
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
                </div>
              </article>
              <article className="panel model-score">
                <SectionHeading eyebrow="Champion gates" title="Weather edge" />
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
              </article>
            </div>

            <div className="three-column models-grid">
              <article className="panel table-panel double">
                <SectionHeading eyebrow="Registry" title="Model runs" />
                <div className="table-wrap">
                  <table className="compact-table">
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Target</th>
                        <th>MAE</th>
                        <th>Direction</th>
                        <th>PnL lift</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelRuns.map((run) => (
                        <tr key={run.id}>
                          <td>
                            <strong>{run.name}</strong>
                            <span>{run.lastRun} | {run.status}</span>
                          </td>
                          <td>{run.target}</td>
                          <td>{formatNumber(run.mae)}</td>
                          <td>{formatNumber(run.directionalAccuracyPct, 1)}%</td>
                          <td className={classForSigned(run.pnlLiftPct)}>{signedPercent(run.pnlLiftPct, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="panel chart-panel">
                <SectionHeading eyebrow="Features" title="Importance" />
                <div className="feature-list">
                  {featureImportance.map((feature) => (
                    <div key={feature.feature} className="feature-row">
                      <span>{feature.feature}</span>
                      <div className="feature-bar">
                        <i style={{ width: `${feature.importance * 100}%` }}></i>
                      </div>
                      <em>{feature.direction}</em>
                    </div>
                  ))}
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
                  <button type="button" className="ghost-button" onClick={resetDemoData}>
                    <Zap size={17} aria-hidden="true" />
                    Reset fixtures
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
                    <dd>{selectedBacktest.joined.length}</dd>
                  </div>
                  <div>
                    <dt>Capital base</dt>
                    <dd>{formatCurrency(settings.initialCapital)}</dd>
                  </div>
                </dl>
              </article>
            </div>

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
                <SectionHeading eyebrow="Controls" title="Paper-trading gate" />
                <div className="readiness-grid">
                  {adapterChecklist.map((item, index) => (
                    <div key={item} className="readiness-row">
                      <span>{index + 1}</span>
                      <p>{item}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel execution-card">
                <SectionHeading eyebrow="Adapter" title="IBKR bridge" />
                <div className="execution-status">
                  <Bot size={36} aria-hidden="true" />
                  <strong>Paper mode first</strong>
                  <span>Orders are intentionally not connected in this build.</span>
                </div>
                <button type="button" className="primary-button" onClick={() => setActiveView('data')}>
                  <SlidersHorizontal size={17} aria-hidden="true" />
                  Review adapters
                </button>
              </article>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
