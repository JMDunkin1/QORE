import { useState } from 'react'
import { BacktestValidation, MonteCarloChart, OvernightRiskHeatmap } from '../components/BacktestValidation'
import { MetricRail, type MetricDatum } from '../components/MetricRail'
import { PerformanceChart } from '../components/PerformanceChart'
import {
  allYearBacktest,
  backtestPoints,
  sleeveStats,
  weatherQuality,
  type BacktestMetrics,
  type BacktestPoint,
} from '../data/allYearBacktest'
import type { SmoothChartSeries } from '../components/SmoothZoomChart'
import { classForSigned, formatNumber, signedPercent } from '../utils/format'

const positionSeries: SmoothChartSeries<BacktestPoint> = {
  axis: 'right',
  color: '#6f7d70',
  dataKey: 'position',
  id: 'position',
  label: 'Gas position',
  mode: 'step',
  strokeOpacity: 0.24,
  strokeWidth: 1,
  valueFormatter: (value) => `${formatNumber(value, 2)}x`,
}

const performanceSeries: Array<SmoothChartSeries<BacktestPoint>> = [
  {
    axis: 'left',
    color: '#45ff78',
    dataKey: 'netReturnPct',
    fillOpacity: 0.18,
    id: 'netReturnPct',
    label: 'Daily strategy +/-',
    mode: 'bar',
    strokeOpacity: 0.2,
    valueFormatter: (value) => signedPercent(value),
  },
  {
    axis: 'left',
    color: '#87ff9f',
    dataKey: 'equityPct',
    id: 'equityPct',
    label: 'All-Year equity',
    mode: 'line',
    strokeWidth: 2.4,
    valueFormatter: (value) => signedPercent(value),
  },
  {
    axis: 'left',
    color: '#718077',
    dashArray: '6 5',
    dataKey: 'benchmarkPct',
    id: 'benchmarkPct',
    label: 'VOO/QQQM fallback',
    mode: 'line',
    strokeWidth: 1.5,
    valueFormatter: (value) => signedPercent(value),
  },
  {
    axis: 'left',
    color: '#ff5f68',
    dataKey: 'drawdownPct',
    id: 'drawdownPct',
    label: 'Drawdown',
    mode: 'line',
    strokeWidth: 1.5,
    valueFormatter: (value) => signedPercent(value),
  },
]

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function signedPoints(value: number, digits = 2) {
  return `${value > 0 ? '+' : ''}${formatNumber(value, digits)} pts`
}

function metricsForBacktest(): MetricDatum[] {
  const selection = allYearBacktest.validation.selectionMetrics
  const realityCheck = allYearBacktest.validation.selectionRealityCheck
  return [
    {
      label: 'ALGO VS INDEX',
      value: signedPoints(selection.splitEdges.all),
      detail: `STRATEGY - INDEX · THROUGH ${selection.throughDate}`,
      emphasis: true,
      tone: classForSigned(selection.splitEdges.all),
    },
    {
      label: 'VALIDATION EDGE',
      value: signedPoints(selection.splitEdges.validation),
      detail: 'HISTORICAL VALIDATION SPLIT',
      tone: classForSigned(selection.splitEdges.validation),
    },
    {
      label: 'STRATEGY / INDEX',
      value: `${signedPercent(selection.strategy.all.totalReturnPct)} / ${signedPercent(selection.index.all.totalReturnPct)}`,
      detail: 'SELECTION-PERIOD RETURNS',
    },
    {
      label: 'GAS TARGET DAYS',
      value: `${formatNumber(realityCheck.activeOverlayDays, 0)} / ${formatNumber(realityCheck.sampleCount, 0)}`,
      detail: 'TARGET ACTIVE / TOTAL SESSIONS',
    },
  ]
}

function SplitRow({ label, metrics, indexMetrics, edge }: { label: string; metrics: BacktestMetrics; indexMetrics: BacktestMetrics; edge: number }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{metrics.firstEntry && metrics.lastExit ? `${metrics.firstEntry} — ${metrics.lastExit}` : '—'}</td>
      <td className={classForSigned(metrics.totalReturnPct)}>{signedPercent(metrics.totalReturnPct)}</td>
      <td>{signedPercent(indexMetrics.totalReturnPct)}</td>
      <td className={classForSigned(edge)}>{signedPercent(edge)}</td>
      <td>{formatNumber(metrics.cagrPct)}%</td>
      <td>{formatNumber(metrics.sharpe)}</td>
      <td className="negative">{signedPercent(metrics.maxDrawdownPct)}</td>
      <td>{formatNumber(metrics.tradeCount, 0)}</td>
    </tr>
  )
}

export function BacktestView() {
  const [showPosition, setShowPosition] = useState(false)
  const reportMetrics = allYearBacktest.selected.allMetrics
  const selection = allYearBacktest.validation.selectionMetrics
  const selectionMetrics = selection.strategy.all
  const selectionEnd = selection.throughDate
  const researchInstruments = allYearBacktest.contract.researchInstruments
  const executionInstrument = allYearBacktest.contract.executionInstrument
  const stateTone = allYearBacktest.status === 'research-baseline' ? 'positive' : 'warning'

  return (
    <main className="view" id="backtest-view">
      <header className="view-header">
        <div className="view-heading">
          <span>{allYearBacktest.strategyId.toUpperCase()}</span>
          <h1>Backtest</h1>
        </div>
        <div className="view-status-line" aria-label="Backtest status">
          <span className={stateTone}>{allYearBacktest.status.toUpperCase()}</span>
          <span>{dateLabel(selectionMetrics.firstEntry)} — {dateLabel(selectionMetrics.lastExit)}</span>
          <span>SELECTION THROUGH {selectionEnd}</span>
        </div>
      </header>

      <aside className="backtest-contract" aria-label="Research contract">
        <header>
          <span>
            SUMMER {researchInstruments.summer.signalSymbol} SIGNAL / WINTER {researchInstruments.winter.signalSymbol} SIGNAL → {executionInstrument.gasSymbol} EXECUTION
          </span>
          <small>RESEARCH CONTRACT</small>
        </header>
        <div>
          <p>Every displayed gas return uses UNG. Prior holdings own the overnight move, current targets start at the adjusted session open, and turnover costs cover UNG, VOO, and QQQM.</p>
          <p>Only the chronological train/validation prefix through {selectionEnd} enters promotion. Every later row and full-calendar diagnostic is report-only.</p>
        </div>
      </aside>

      <MetricRail metrics={metricsForBacktest()} ariaLabel={`Selection-safe algorithm performance through ${selectionEnd}`} />

      <PerformanceChart
        title="Strategy vs index"
        meta={`${formatNumber(backtestPoints.length, 0)} SESSIONS · REPORT-ONLY AFTER ${selectionEnd} · THROUGH ${reportMetrics.lastExit}`}
        data={backtestPoints}
        series={[{ ...positionSeries, visible: showPosition }, ...performanceSeries]}
        empty="NO CURVE · RUN THE ALL-YEAR BACKTEST"
        actions={
          <button
            type="button"
            className="text-button"
            aria-pressed={showPosition}
            onClick={() => setShowPosition((current) => !current)}
          >
            {showPosition ? '[X]' : '[ ]'} GAS POSITION
          </button>
        }
      />

      <section className="backtest-visual-stack" aria-label="Backtest robustness charts">
        <MonteCarloChart />
        <OvernightRiskHeatmap />
      </section>

      <section className="research-evidence" aria-labelledby="research-evidence-title">
        <header className="section-header research-evidence-header">
          <div>
            <span className="section-eyebrow">SELECTION SAFETY</span>
            <h2 id="research-evidence-title">Research evidence &amp; diagnostics</h2>
          </div>
          <span className={`plain-status ${stateTone}`}>{allYearBacktest.status.toUpperCase()}</span>
        </header>
        <div className="research-evidence-body">
          <BacktestValidation />

          <section className="data-section" aria-labelledby="selection-split-title">
            <header className="section-header">
              <h2 id="selection-split-title">Selection evidence</h2>
              <span className="plain-status">ELIGIBILITY THROUGH {selectionEnd}</span>
            </header>
            <div className="table-scroll" tabIndex={0} aria-label="Selection evidence by split">
              <table>
                <thead><tr><th>SPLIT</th><th>WINDOW</th><th>STRATEGY</th><th>INDEX</th><th>CUM. EDGE</th><th>CAGR</th><th>SHARPE</th><th>MAX DD</th><th>ACTIVE</th></tr></thead>
                <tbody>
                  <SplitRow label="TRAIN" metrics={selection.strategy.train} indexMetrics={selection.index.train} edge={selection.splitEdges.train} />
                  <SplitRow label="VALIDATION" metrics={selection.strategy.validation} indexMetrics={selection.index.validation} edge={selection.splitEdges.validation} />
                  <SplitRow label="TRAIN + VALIDATION" metrics={selection.strategy.all} indexMetrics={selection.index.all} edge={selection.splitEdges.all} />
                </tbody>
              </table>
            </div>
          </section>

          <section className="data-section" aria-labelledby="report-split-title">
            <header className="section-header">
              <h2 id="report-split-title">Later / full-calendar diagnostics</h2>
              <span className="plain-status warning">REPORT-ONLY · NO PROMOTION INPUT</span>
            </header>
            <div className="table-scroll" tabIndex={0} aria-label="Report-only diagnostics by split">
              <table>
                <thead><tr><th>SPLIT</th><th>WINDOW</th><th>STRATEGY</th><th>INDEX</th><th>CUM. EDGE</th><th>CAGR</th><th>SHARPE</th><th>MAX DD</th><th>ACTIVE</th></tr></thead>
                <tbody>
                  <SplitRow label="EXPANDED VALIDATION · REPORT-ONLY" metrics={allYearBacktest.selected.validationMetrics} indexMetrics={allYearBacktest.selected.indexMetrics.validation} edge={allYearBacktest.selected.splitEdges.validation} />
                  <SplitRow label="PUBLIC HOLDOUT · REPORT-ONLY" metrics={allYearBacktest.selected.holdoutMetrics} indexMetrics={allYearBacktest.selected.indexMetrics.holdout} edge={allYearBacktest.selected.splitEdges.holdout} />
                  <SplitRow label="FULL CALENDAR · REPORT-ONLY" metrics={reportMetrics} indexMetrics={allYearBacktest.selected.indexMetrics.all} edge={allYearBacktest.selected.splitEdges.all} />
                </tbody>
              </table>
            </div>
          </section>

          <div className="data-grid">
            <section className="data-section" aria-labelledby="diagnostics-title">
              <header className="section-header compact">
                <h2 id="diagnostics-title">Full-calendar risk / weather</h2>
                <span className="plain-status warning">REPORT-ONLY</span>
              </header>
              <dl className="terminal-readout">
                <div><dt>WIN RATE</dt><dd>{formatNumber(reportMetrics.winRatePct, 1)}%</dd></div>
                <div><dt>PROFIT FACTOR</dt><dd>{formatNumber(reportMetrics.profitFactor)}</dd></div>
                <div><dt>CVaR95</dt><dd className="negative">{signedPercent(reportMetrics.cvar95Pct)}</dd></div>
                <div><dt>AVG DAILY P&amp;L</dt><dd>{signedPercent(reportMetrics.averageDailyPnlPct, 3)}</dd></div>
                <div><dt>WEATHER DIRECTION</dt><dd>{formatNumber(weatherQuality.directionalAccuracyPct, 1)}%</dd></div>
                <div><dt>COLD ≤ {formatNumber(weatherQuality.coldEventThresholdF, 0)}F RECALL</dt><dd>{formatNumber(weatherQuality.coldRecallPct, 1)}%</dd></div>
                <div><dt>WEATHER MAE</dt><dd>{formatNumber(weatherQuality.maeF, 2)}F</dd></div>
                <div><dt>WEATHER RMSE</dt><dd>{formatNumber(weatherQuality.rmseF, 2)}F</dd></div>
                <div><dt>WEATHER BIAS</dt><dd>{weatherQuality.biasF > 0 ? '+' : ''}{formatNumber(weatherQuality.biasF, 2)}F</dd></div>
                <div><dt>WEATHER R²</dt><dd className={classForSigned(weatherQuality.r2)}>{formatNumber(weatherQuality.r2, 3)}</dd></div>
                <div><dt>WEATHER SOURCES</dt><dd>{formatNumber(weatherQuality.sourceCount, 0)}</dd></div>
                <div><dt>SCORED FORECASTS</dt><dd>{formatNumber(weatherQuality.rowCount, 0)}</dd></div>
              </dl>
            </section>

            <section className="data-section" aria-labelledby="sleeve-title">
              <header className="section-header compact">
                <h2 id="sleeve-title">Full-calendar seasonal attribution</h2>
                <span className="plain-status warning">REPORT-ONLY</span>
              </header>
              <div className="table-scroll compact-table" tabIndex={0} aria-label="Full-calendar seasonal attribution">
                <table>
                  <thead><tr><th>THESIS</th><th>TARGET ROWS</th><th>CAUSAL COMPOUND</th><th>WIN DAYS</th><th>AVG / DAY</th></tr></thead>
                  <tbody>
                    {sleeveStats.map((sleeve) => (
                      <tr key={sleeve.id}>
                        <th scope="row">{sleeve.label}</th>
                        <td>{sleeve.rowCount}</td>
                        <td className={classForSigned(sleeve.totalReturnPct)}>{signedPercent(sleeve.totalReturnPct)}</td>
                        <td>{formatNumber(sleeve.winRatePct, 1)}%</td>
                        <td className={classForSigned(sleeve.averageReturnPct)}>{signedPercent(sleeve.averageReturnPct, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  )
}
