import { useState } from 'react'
import { BacktestValidation } from '../components/BacktestValidation'
import { MetricRail, type MetricDatum } from '../components/MetricRail'
import { PerformanceChart } from '../components/PerformanceChart'
import {
  allYearBacktest,
  backtestPoints,
  recentBacktestRows,
  sleeveStats,
  weatherQuality,
  type BacktestMetrics,
  type BacktestPoint,
} from '../data/allYearBacktest'
import type { SmoothChartSeries } from '../components/SmoothZoomChart'
import { classForSigned, formatCurrency, formatNumber, signedPercent } from '../utils/format'

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
    dataKey: 'activeReturnPct',
    fillOpacity: 0.15,
    id: 'activeReturnPct',
    label: 'Daily active edge',
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

function metricsForBacktest(): MetricDatum[] {
  const selection = allYearBacktest.validation.selectionMetrics
  const metrics = selection.strategy.all
  const realityCheck = allYearBacktest.validation.selectionRealityCheck
  const drawdownFloor = allYearBacktest.contract.maxDrawdownPromotionFloorPct
  return [
    {
      label: 'SELECTION CAGR',
      value: signedPercent(metrics.cagrPct),
      tone: 'positive',
    },
    {
      label: 'SELECTION RETURN / INDEX',
      value: `${signedPercent(metrics.totalReturnPct)} / ${signedPercent(selection.index.all.totalReturnPct)}`,
      tone: 'positive',
    },
    {
      label: 'VALIDATION EDGE',
      value: signedPercent(selection.splitEdges.validation),
      tone: selection.splitEdges.validation > 0 ? 'positive' : 'warning',
    },
    {
      label: 'VALIDATION SHARPE',
      value: formatNumber(selection.strategy.validation.sharpe),
    },
    {
      label: 'MAX DD / FLOOR',
      value: `${signedPercent(metrics.maxDrawdownPct)} / ${signedPercent(drawdownFloor)}`,
      tone: metrics.maxDrawdownPct > drawdownFloor ? 'positive' : 'warning',
    },
    {
      label: 'VOL / VAR95',
      value: `${formatNumber(metrics.annualVolPct)}% / ${signedPercent(metrics.var95Pct)}`,
    },
    {
      label: 'ACTIVE / EXPOSURE',
      value: `${formatNumber(metrics.tradeCount, 0)} / ${formatNumber(metrics.exposurePct, 1)}%`,
    },
    {
      label: 'SELECTION P / ITER',
      value: `${formatNumber(realityCheck.pValue, 5)} / ${formatNumber(realityCheck.iterations, 0)}`,
      tone: realityCheck.pValue < 0.05 ? 'positive' : 'warning',
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
  const finalEquity = backtestPoints.at(-1) ? 100_000 * (1 + (backtestPoints.at(-1)?.equityPct ?? 0) / 100) : 100_000

  return (
    <main className="view" id="backtest-view">
      <header className="view-header">
        <h1>Backtest</h1>
        <dl className="view-status">
          <div>
            <dt>STRATEGY</dt>
            <dd>{allYearBacktest.strategyId.toUpperCase()}</dd>
          </div>
          <div>
            <dt>STATE</dt>
            <dd className={allYearBacktest.status === 'research-baseline' ? 'positive' : 'warning'}>
              {allYearBacktest.status.toUpperCase()}
            </dd>
          </div>
          <div>
            <dt>EVIDENCE PERIOD</dt>
            <dd>{dateLabel(selectionMetrics.firstEntry)} — {dateLabel(selectionMetrics.lastExit)}</dd>
          </div>
          <div>
            <dt>REPORT THROUGH</dt>
            <dd>{dateLabel(reportMetrics.lastExit)}</dd>
          </div>
          <div>
            <dt>BUILT</dt>
            <dd>{new Date(allYearBacktest.generatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </header>

      <div className="warning-line" role="note">
        <strong>{researchInstruments.summer.signalSymbol} SIGNAL → {executionInstrument.gasSymbol} P&amp;L / ALPACA</strong>
        <span>Every gas return now uses UNG. Prior holdings own the overnight move, current targets start at the adjusted session open, and turnover costs cover UNG, VOO, and QQQM. Exact fills, intraday retargeting, and borrow availability remain broker outcomes.</span>
      </div>

      <div className="warning-line" role="note">
        <strong>ELIGIBILITY THROUGH {selectionEnd}</strong>
        <span>Only the chronological train/validation prefix through this date enters all-year promotion. Later rows, the expanded public validation split, holdout, full-calendar curve, and full-calendar bootstrap are report-only.</span>
      </div>

      <MetricRail metrics={metricsForBacktest()} ariaLabel={`Selection-safe backtest evidence through ${selectionEnd}`} />

      <PerformanceChart
        title={`Full-calendar equity / benchmark / drawdown · report-only after ${selectionEnd}`}
        meta={`${formatCurrency(finalEquity)} END · ${formatNumber(backtestPoints.length, 0)} DAYS · ${formatNumber(reportMetrics.turnover, 2)} TURN · REPORT THROUGH ${reportMetrics.lastExit}`}
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

      <BacktestValidation />

      <section className="data-section" aria-labelledby="selection-split-title">
        <header className="section-header">
          <h2 id="selection-split-title">Selection evidence</h2>
          <span className="plain-status">ELIGIBILITY THROUGH {selectionEnd}</span>
        </header>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>SPLIT</th>
                <th>WINDOW</th>
                <th>STRATEGY</th>
                <th>INDEX</th>
                <th>CUM. EDGE</th>
                <th>CAGR</th>
                <th>SHARPE</th>
                <th>MAX DD</th>
                <th>ACTIVE</th>
              </tr>
            </thead>
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
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>SPLIT</th>
                <th>WINDOW</th>
                <th>STRATEGY</th>
                <th>INDEX</th>
                <th>CUM. EDGE</th>
                <th>CAGR</th>
                <th>SHARPE</th>
                <th>MAX DD</th>
                <th>ACTIVE</th>
              </tr>
            </thead>
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
            <div><dt>AVG DAILY P&L</dt><dd>{signedPercent(reportMetrics.averageDailyPnlPct, 3)}</dd></div>
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
          <div className="table-scroll compact-table">
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

      <section className="data-section" aria-labelledby="tape-title">
        <header className="section-header compact">
          <h2 id="tape-title">Recent report-only rows</h2>
          <span className="plain-status warning">AFTER SELECTION CUTOFF</span>
        </header>
        <div className="table-scroll trade-tape">
          <table>
            <thead><tr><th>DATE</th><th>SPLIT</th><th>THESIS</th><th>TARGET SLEEVE</th><th>GAS POS</th><th>DAILY</th><th>ACTIVE EDGE</th><th>EQUITY</th></tr></thead>
            <tbody>
              {recentBacktestRows.map((row) => (
                <tr key={`${row.date}-${row.chartIndex}`}>
                  <td>{row.date}</td>
                  <td>{row.split.toUpperCase()}</td>
                  <td>{row.thesisKind.toUpperCase()}</td>
                  <td>{row.researchInstrument}</td>
                  <td>{formatNumber(row.position, 2)}x</td>
                  <td className={classForSigned(row.netReturnPct)}>{signedPercent(row.netReturnPct, 3)}</td>
                  <td className={classForSigned(row.activeReturnPct)}>{signedPercent(row.activeReturnPct, 3)}</td>
                  <td>{signedPercent(row.equityPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
