import { useCallback, useEffect, useMemo, useState } from 'react'
import { MetricRail, type MetricDatum } from '../components/MetricRail'
import { PerformanceChart } from '../components/PerformanceChart'
import type { SmoothChartSeries } from '../components/SmoothZoomChart'
import { getLiveTelemetry, refreshLiveTelemetry } from '../runtime/client'
import type { LivePerformancePoint, LiveTelemetry } from '../runtime/types'
import { classForSigned, formatCurrency, formatNumber, signedPercent } from '../utils/format'

const livePerformanceSeries: Array<SmoothChartSeries<LivePerformancePoint>> = [
  {
    axis: 'left',
    color: '#45ff78',
    dataKey: 'dailyPnlPct',
    fillOpacity: 0.16,
    id: 'dailyPnlPct',
    label: 'Daily P&L',
    mode: 'bar',
    strokeOpacity: 0.25,
    valueFormatter: (value) => signedPercent(value),
  },
  {
    axis: 'left',
    color: '#87ff9f',
    dataKey: 'equityPct',
    id: 'equityPct',
    label: 'Account return',
    mode: 'line',
    strokeWidth: 2.5,
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
  {
    axis: 'right',
    color: '#718077',
    dashArray: '5 5',
    dataKey: 'equityUsd',
    id: 'equityUsd',
    label: 'Equity USD',
    mode: 'line',
    strokeOpacity: 0.75,
    strokeWidth: 1.2,
    valueFormatter: formatCurrency,
  },
]

function timestampLabel(value: string | null | undefined) {
  if (!value) return 'NEVER'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'UNKNOWN' : date.toLocaleString()
}

function ageSeconds(value: string | null | undefined) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 1000) : null
}

function timestampsMateriallyDiffer(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return Boolean(left || right)
  const leftTimestamp = Date.parse(left)
  const rightTimestamp = Date.parse(right)
  if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) return left !== right
  return Math.abs(leftTimestamp - rightTimestamp) > 5_000
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function textValue(value: unknown, fallback = '-') {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function finiteNumericValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean' || typeof value === 'object') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function currencyValue(value: unknown) {
  const numeric = finiteNumericValue(value)
  return numeric === null ? '-' : formatCurrency(numeric)
}

function numberValue(value: unknown, digits = 2, suffix = '') {
  const numeric = finiteNumericValue(value)
  return numeric === null ? '-' : `${formatNumber(numeric, digits)}${suffix}`
}

function percentValue(value: unknown, digits = 2) {
  const numeric = finiteNumericValue(value)
  return numeric === null ? '-' : signedPercent(numeric, digits)
}

function targetValue(value: unknown, scale: number, digits: number, suffix: string) {
  const numeric = finiteNumericValue(value)
  return numeric === null ? '-' : `${formatNumber(numeric * scale, digits)}${suffix}`
}

function livePerformance(telemetry: LiveTelemetry | null): LivePerformancePoint[] {
  const rows = telemetry?.portfolioHistory?.points ?? []
  const equities = rows.map((row) => row.equityUsd).filter((value) => Number.isFinite(value) && value > 0)
  const accountEquityUsd = finiteNumericValue(telemetry?.account?.equityUsd)
  const base = finiteNumericValue(telemetry?.portfolioHistory?.baseValueUsd) ?? equities[0] ?? accountEquityUsd ?? 0
  let peak = base

  const points = rows
    .filter((row) => Number.isFinite(row.equityUsd) && row.equityUsd > 0)
    .map((row, chartIndex, validRows) => {
      peak = Math.max(peak, row.equityUsd)
      const previous = validRows[chartIndex - 1]?.equityUsd ?? base
      const parsedTime = Date.parse(row.timestamp)
      return {
        chartIndex,
        date: Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString().slice(0, 10) : String(row.timestamp).slice(0, 10),
        equityUsd: row.equityUsd,
        equityPct: base > 0 ? (row.equityUsd / base - 1) * 100 : 0,
        dailyPnlPct: previous > 0 ? (row.equityUsd / previous - 1) * 100 : 0,
        drawdownPct: peak > 0 ? (row.equityUsd / peak - 1) * 100 : 0,
      }
    })

  const accountDayPnlPct = finiteNumericValue(telemetry?.account?.dayPnlPct)
  const accountDrawdownPct = finiteNumericValue(telemetry?.account?.trailingDrawdownPct)
  if (!points.length && accountEquityUsd !== null && accountEquityUsd > 0 && accountDayPnlPct !== null && accountDrawdownPct !== null) {
    const generatedAt = telemetry?.sourceGeneratedAt ?? telemetry?.generatedAt
    return [{
      chartIndex: 0,
      date: generatedAt ? generatedAt.slice(0, 10) : 'UNKNOWN',
      equityUsd: accountEquityUsd,
      equityPct: 0,
      dailyPnlPct: accountDayPnlPct,
      drawdownPct: accountDrawdownPct,
    }]
  }
  return points
}

function accountMetrics(telemetry: LiveTelemetry | null, points: LivePerformancePoint[]): MetricDatum[] {
  const account = telemetry?.account
  const dayPnlPct = account?.dayPnlPct
  const displayedDayPnlPct = finiteNumericValue(dayPnlPct)
  const first = points[0]
  const latest = points.at(-1)
  const baseEquityUsd = finiteNumericValue(telemetry?.portfolioHistory?.baseValueUsd) ?? first?.equityUsd ?? null
  const totalReturnPct = baseEquityUsd !== null && baseEquityUsd > 0 && latest?.equityUsd
    ? (latest.equityUsd / baseEquityUsd - 1) * 100
    : null
  const historyPnl = finiteNumericValue(telemetry?.portfolioHistory?.points.at(-1)?.profitLossUsd)
  const totalPnlUsd = historyPnl ?? (latest && baseEquityUsd !== null ? latest.equityUsd - baseEquityUsd : null)
  const positions = Array.isArray(telemetry?.positions) ? telemetry.positions : []
  const marketValues = positions.map((position) => finiteNumericValue(position?.marketValueUsd))
  const grossExposureUsd = marketValues.every((value) => value !== null)
    ? marketValues.reduce<number>((sum, value) => sum + Math.abs(value ?? 0), 0)
    : null
  const accountEquityUsd = finiteNumericValue(account?.equityUsd)
  const grossExposurePct = grossExposureUsd !== null && accountEquityUsd !== null && accountEquityUsd > 0
    ? (grossExposureUsd / accountEquityUsd) * 100
    : null
  const unrealizedValues = positions.map((position) => finiteNumericValue(position?.unrealizedPnlUsd))
  const unrealizedPnlUsd = unrealizedValues.every((value) => value !== null)
    ? unrealizedValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null
  const cashUsd = finiteNumericValue(account?.cashUsd)
  const cashPct = cashUsd !== null && accountEquityUsd !== null && accountEquityUsd > 0
    ? (cashUsd / accountEquityUsd) * 100
    : null

  return [
    {
      label: 'ALPACA EQUITY',
      value: currencyValue(account?.equityUsd),
      tone: accountEquityUsd !== null ? 'positive' : 'warning',
    },
    {
      label: 'P&L / RETURN',
      value: points.length > 1 && totalPnlUsd !== null && totalReturnPct !== null
        ? `${formatCurrency(totalPnlUsd)} / ${signedPercent(totalReturnPct)}`
        : '-',
      tone: points.length > 1 && totalPnlUsd !== null ? classForSigned(totalPnlUsd) : 'warning',
    },
    {
      label: 'TODAY',
      value: account && displayedDayPnlPct !== null ? signedPercent(displayedDayPnlPct) : '-',
      tone: account && displayedDayPnlPct !== null ? classForSigned(displayedDayPnlPct) : 'warning',
    },
    {
      label: 'CASH / EQUITY',
      value: account ? `${currencyValue(cashUsd)} / ${numberValue(cashPct, 1, '%')}` : '-',
    },
    {
      label: 'BUY POWER / SHORT',
      value: account
        ? `${currencyValue(account.buyingPowerUsd)} / ${account.shortingEnabled === true ? 'YES' : account.shortingEnabled === false ? 'NO' : 'UNKNOWN'}`
        : '-',
    },
    {
      label: 'TRAILING DD',
      value: percentValue(account?.trailingDrawdownPct),
      tone: finiteNumericValue(account?.trailingDrawdownPct) === null ? 'warning' : classForSigned(finiteNumericValue(account?.trailingDrawdownPct) ?? 0),
    },
    {
      label: 'EXPOSURE / VALUE',
      value: account ? `${numberValue(grossExposurePct, 1, '%')} / ${currencyValue(grossExposureUsd)}` : '-',
    },
    {
      label: 'UNREALIZED / POS',
      value: positions.length ? `${currencyValue(unrealizedPnlUsd)} / ${positions.length}` : '- / 0',
      tone: unrealizedPnlUsd === null ? 'warning' : classForSigned(unrealizedPnlUsd),
    },
  ]
}

function StrategyReadout({ telemetry }: { telemetry: LiveTelemetry | null }) {
  const intentContainer = record(telemetry?.strategy?.intent)
  const intent = record(intentContainer?.intent) ?? intentContainer
  const inferenceContainer = record(telemetry?.strategy?.inference)
  const inference = record(inferenceContainer?.inference) ?? inferenceContainer

  return (
    <section className="data-section" aria-labelledby="live-strategy-title">
      <header className="section-header compact">
        <h2 id="live-strategy-title">Current target</h2>
      </header>
      <dl className="terminal-readout">
        <div><dt>SIGNAL DATE</dt><dd>{textValue(intent?.signalDate)}</dd></div>
        <div><dt>TARGET DATE</dt><dd>{textValue(intent?.targetDate)}</dd></div>
        <div><dt>DIRECTION</dt><dd>{textValue(intent?.direction).toUpperCase()}</dd></div>
        <div><dt>CONFIDENCE</dt><dd>{targetValue(intent?.confidence, 100, 1, '%')}</dd></div>
        <div><dt>UNG TARGET</dt><dd>{targetValue(intent?.gasPosition, 1, 3, 'x')}</dd></div>
        <div><dt>INDEX TARGET</dt><dd>{targetValue(intent?.indexFraction, 100, 1, '%')}</dd></div>
        <div><dt>CASH TARGET</dt><dd>{targetValue(intent?.cashFraction, 100, 1, '%')}</dd></div>
        <div><dt>INFERENCE</dt><dd>{inference?.validated === true ? 'VALIDATED' : inference ? 'NOT VALIDATED' : 'NO SNAPSHOT'}</dd></div>
      </dl>
      {!intent && <p className="section-note warning">No current signal-intent file. Run the live preparation workflow before evaluating orders.</p>}
    </section>
  )
}

function RiskReadout({ telemetry }: { telemetry: LiveTelemetry | null }) {
  const readiness = telemetry?.risk?.readiness ?? {}
  const rows = Object.entries(readiness)
  const blocks = telemetry?.risk?.blockedReasons ?? []
  const warnings = telemetry?.risk?.warnings ?? []
  const killSwitchEngaged = telemetry?.risk?.killSwitchEngaged
  const killSwitchLabel = killSwitchEngaged === true ? 'ENGAGED' : killSwitchEngaged === false ? 'CLEAR' : 'UNKNOWN'
  const killSwitchTone = killSwitchEngaged === true ? 'negative' : killSwitchEngaged === false ? 'positive' : 'warning'
  return (
    <section className="data-section" aria-labelledby="risk-title">
      <header className="section-header compact">
        <h2 id="risk-title">Risk gates</h2>
        <span className={`plain-status ${killSwitchTone}`}>
          KILL SWITCH {killSwitchLabel}
        </span>
      </header>
      {rows.length ? (
        <dl className="gate-list">
          {rows.map(([label, value]) => {
            const pass = value === true || value === 'ready' || value === 'connected'
            return <div key={label}><dt>{label.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()}</dt><dd className={pass ? 'positive' : 'warning'}>{textValue(value).toUpperCase()}</dd></div>
          })}
        </dl>
      ) : (
        <div className="inline-empty">NO RISK SNAPSHOT</div>
      )}
      {(blocks.length > 0 || warnings.length > 0) && (
        <div className="runtime-messages">
          {blocks.map((message) => <p key={`block-${message}`} className="negative">BLOCK // {message}</p>)}
          {warnings.map((message) => <p key={`warn-${message}`} className="warning">WARN // {message}</p>)}
        </div>
      )}
    </section>
  )
}

export function CommandView() {
  const [telemetry, setTelemetry] = useState<LiveTelemetry | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (refresh = false, showActivity = refresh) => {
    if (showActivity) setRefreshing(true)
    try {
      const next = refresh ? await refreshLiveTelemetry() : await getLiveTelemetry()
      setTelemetry(next)
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Runtime API unavailable.')
    } finally {
      if (showActivity) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void getLiveTelemetry()
      .then((next) => {
        if (!active) return
        setTelemetry(next)
        setError('')
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Runtime API unavailable.')
      })
    const interval = window.setInterval(() => void load(false, false), 60_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [load])

  const performance = useMemo(() => livePerformance(telemetry), [telemetry])
  const positions = Array.isArray(telemetry?.positions) ? telemetry.positions : []
  const openOrders = Array.isArray(telemetry?.openOrders) ? telemetry.openOrders : []
  const sourceAgeSeconds = ageSeconds(telemetry?.sourceGeneratedAt)
  const historySourceGeneratedAt = telemetry?.portfolioHistory?.sourceGeneratedAt
  const historyAgeSeconds = ageSeconds(historySourceGeneratedAt)
  const historyHasData = performance.length > 0
  const historyProvenanceDiffers = Boolean(
    historyHasData
      && telemetry?.sourceGeneratedAt
      && historySourceGeneratedAt
      && timestampsMateriallyDiffer(telemetry.sourceGeneratedAt, historySourceGeneratedAt),
  )
  const historyProvenanceWarning = historyHasData && (
    !historySourceGeneratedAt
    || historyProvenanceDiffers
    || (historyAgeSeconds !== null && historyAgeSeconds > 120)
  )
  const stale = Boolean(telemetry?.stale) || (sourceAgeSeconds !== null && sourceAgeSeconds > 120)
  const connected = Boolean(telemetry?.brokerConnected)
  const statusTone = error || !connected ? 'negative' : stale ? 'warning' : 'positive'
  const marketStatus = telemetry?.marketClock?.isOpen === true
    ? 'MARKET OPEN'
    : telemetry?.marketClock?.isOpen === false ? 'MARKET CLOSED' : 'MARKET UNKNOWN'

  return (
    <main className="view" id="command-view">
      <header className="view-header">
        <h1>Command</h1>
        <dl className="view-status">
          <div>
            <dt>CONNECTION</dt>
            <dd className={statusTone}>{connected ? `${telemetry?.mode?.toUpperCase()} / ${stale ? 'STALE' : 'ONLINE'}` : 'OFFLINE'}</dd>
          </div>
          <div>
            <dt>LAST ALPACA READ</dt>
            <dd>{timestampLabel(telemetry?.sourceGeneratedAt)}</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd>READ ONLY</dd>
          </div>
        </dl>
      </header>

      {error && <div className="warning-line negative"><strong>RUNTIME OFFLINE</strong><span>{error} Start QORE with the local launcher to connect the dashboard.</span></div>}
      {!error && stale && sourceAgeSeconds !== null && <div className="warning-line"><strong>STALE BROKER STATE</strong><span>The most recent Alpaca snapshot is {formatNumber(sourceAgeSeconds / 60, 1)} minutes old. Refresh before acting on it.</span></div>}
      {!error && historyProvenanceWarning && <div className="warning-line"><strong>HISTORY PROVENANCE</strong><span>Portfolio history was read at {timestampLabel(historySourceGeneratedAt)}; selected account data was read at {timestampLabel(telemetry?.sourceGeneratedAt)}.</span></div>}
      <div className="warning-line subtle" role="note"><strong>ACCOUNT-LEVEL DATA</strong><span>Deposits, manual trades, or unrelated positions affect Alpaca portfolio history. Use a dedicated account for strategy-pure performance.</span></div>

      <MetricRail metrics={accountMetrics(telemetry, performance)} ariaLabel="Actual Alpaca account metrics" />

      <PerformanceChart
        title="Alpaca performance"
        meta={`${marketStatus} · ${performance.length} DAYS · HISTORY ${timestampLabel(historySourceGeneratedAt)}`}
        data={performance}
        series={livePerformanceSeries}
        empty="NO ALPACA HISTORY · CONNECT PAPER OR LIVE, THEN REFRESH"
        actions={<button type="button" className="text-button primary" disabled={refreshing} onClick={() => void load(true)}>{refreshing ? 'REFRESHING…' : 'REFRESH ALPACA'}</button>}
      />

      <div className="data-grid">
        <StrategyReadout telemetry={telemetry} />
        <RiskReadout telemetry={telemetry} />
      </div>

      <section className="data-section" aria-labelledby="positions-title">
        <header className="section-header">
          <h2 id="positions-title">Positions</h2>
          <span className="plain-status">{positions.length} OPEN</span>
        </header>
        {positions.length ? (
          <div className="table-scroll positions-table">
            <table>
              <thead><tr><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>MARK</th><th>MARKET VALUE</th><th>AVG ENTRY</th><th>UNREALIZED</th><th>RETURN</th></tr></thead>
              <tbody>
                {positions.map((position, index) => {
                  const unrealizedPnlUsd = finiteNumericValue(position?.unrealizedPnlUsd)
                  const unrealizedPnlPct = finiteNumericValue(position?.unrealizedPnlPct)
                  return (
                  <tr key={`${textValue(position?.symbol, 'UNKNOWN')}-${index}`}>
                    <th scope="row">{textValue(position?.symbol, 'UNKNOWN')}</th>
                    <td>{textValue(position?.side, 'UNKNOWN').toUpperCase()}</td>
                    <td>{numberValue(position?.quantity, 4)}</td>
                    <td>{currencyValue(position?.currentPriceUsd)}</td>
                    <td>{currencyValue(position?.marketValueUsd)}</td>
                    <td>{currencyValue(position?.averageEntryPriceUsd)}</td>
                    <td className={unrealizedPnlUsd === null ? 'warning' : classForSigned(unrealizedPnlUsd)}>{currencyValue(unrealizedPnlUsd)}</td>
                    <td className={unrealizedPnlPct === null ? 'warning' : classForSigned(unrealizedPnlPct)}>{percentValue(unrealizedPnlPct)}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="inline-empty">NO OPEN POSITIONS</div>}
      </section>

      <section className="data-section" aria-labelledby="orders-title">
        <header className="section-header compact">
          <h2 id="orders-title">Open orders</h2>
        </header>
        {openOrders.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>SUBMITTED</th><th>SYMBOL</th><th>SIDE</th><th>TYPE</th><th>QTY</th><th>FILLED</th><th>STATUS</th></tr></thead>
              <tbody>{openOrders.map((order, index) => <tr key={`${textValue(order?.id, 'UNKNOWN')}-${index}`}><td>{order?.submittedAt ? timestampLabel(order.submittedAt) : '-'}</td><th scope="row">{textValue(order?.symbol, 'UNKNOWN')}</th><td>{textValue(order?.side, 'UNKNOWN').toUpperCase()}</td><td>{textValue(order?.type, 'UNKNOWN').toUpperCase()}</td><td>{numberValue(order?.quantity, 4)}</td><td>{numberValue(order?.filledQuantity, 4)}</td><td>{textValue(order?.status, 'UNKNOWN').toUpperCase()}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div className="inline-empty">NO OPEN ORDERS</div>}
      </section>
    </main>
  )
}
