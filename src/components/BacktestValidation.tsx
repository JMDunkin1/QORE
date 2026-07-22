import { useMemo } from 'react'
import { allYearBacktest, allYearTrades, overnightRiskHeatmap } from '../data/allYearBacktest'
import { formatCurrency, formatNumber } from '../utils/format'

type SimulatedPath = {
  id: number
  values: number[]
  finalValue: number
  selected: boolean
}

type PromotionGateKey = keyof typeof allYearBacktest.validation.promotionGates

const promotionGateLabels = {
  positiveTrainEdge: 'POSITIVE TRAIN EDGE',
  positiveValidationEdge: 'POSITIVE VALIDATION EDGE',
  preHoldoutBootstrapSignificance: 'SELECTION BOOTSTRAP P < 0.05',
  trainMaxDrawdown: 'TRAIN MAX DRAWDOWN',
  validationMaxDrawdown: 'VALIDATION MAX DRAWDOWN',
  summerComponent: 'SUMMER COMPONENT',
  summerTemporalContract: 'SUMMER TEMPORAL CONTRACT',
  winterComponent: 'WINTER COMPONENT',
  liveContract: 'LIVE CONTRACT DIGEST',
  liveTargetParity: 'LIVE TARGET PARITY',
  brokerExecution: 'BROKER EXECUTION PROFILE',
  pristineForwardEvidence: 'PRISTINE FORWARD EVIDENCE',
  strategyContractSeal: 'STRATEGY CONTRACT SEAL',
  paperApproval: 'PAPER APPROVAL',
  paperExecutionEvidence: 'PAPER EXECUTION EVIDENCE',
  liveApproval: 'LIVE APPROVAL',
} as const satisfies Record<PromotionGateKey, string>

const promotionGateEntries = Object.entries(promotionGateLabels) as Array<[PromotionGateKey, string]>

function seededRandom(seed = 8_419) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

function percentile(values: number[], probability: number) {
  const sorted = [...values].sort((first, second) => first - second)
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability)))] ?? 0
}

function buildMonteCarlo(returns: number[], simulations = 64, blockLength = 10) {
  const random = seededRandom()
  const rawPaths: Array<Omit<SimulatedPath, 'selected'>> = []
  const pointStride = Math.max(1, Math.floor(returns.length / 120))

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const sampled: number[] = []
    while (sampled.length < returns.length) {
      const blockStart = Math.floor(random() * returns.length)
      for (let offset = 0; offset < blockLength && sampled.length < returns.length; offset += 1) {
        sampled.push(returns[(blockStart + offset) % returns.length])
      }
    }

    let equity = 100_000
    const values = [equity]
    sampled.forEach((dailyReturn, index) => {
      equity = Math.max(1, equity * (1 + dailyReturn / 100))
      if ((index + 1) % pointStride === 0 || index === sampled.length - 1) values.push(equity)
    })
    rawPaths.push({ id: simulation, values, finalValue: equity })
  }

  const finalValues = rawPaths.map((path) => path.finalValue)
  const medianFinal = percentile(finalValues, 0.5)
  const selectedId = rawPaths.reduce(
    (closest, path) =>
      Math.abs(path.finalValue - medianFinal) < Math.abs(closest.finalValue - medianFinal) ? path : closest,
    rawPaths[0],
  )?.id
  const paths = rawPaths.map((path) => ({ ...path, selected: path.id === selectedId }))
  return {
    paths,
    sampleCount: returns.length,
    simulationCount: simulations,
    blockLength,
    positiveFinalPct: (finalValues.filter((value) => value > 100_000).length / Math.max(finalValues.length, 1)) * 100,
    finalP05: percentile(finalValues, 0.05),
    finalP50: medianFinal,
    finalP95: percentile(finalValues, 0.95),
  }
}

function signedPercent(value: number, digits = 3) {
  return `${value > 0 ? '+' : ''}${formatNumber(value, digits)}%`
}

export function RealityCheckPanel() {
  const check = allYearBacktest.validation.selectionRealityCheck
  const gates = allYearBacktest.validation.promotionGates
  const passedGateCount = promotionGateEntries.filter(([key]) => gates[key]).length
  return (
    <section className="validation-panel" aria-labelledby="all-year-bootstrap-title">
      <header className="validation-heading">
        <h3 id="all-year-bootstrap-title">Selection-safe active-edge bootstrap</h3>
        <dl>
          <div>
            <dt>P-VALUE</dt>
            <dd className={check.pValue < 0.05 ? 'positive' : 'warning'}>{formatNumber(check.pValue, 5)}</dd>
          </div>
          <div>
            <dt>THROUGH</dt>
            <dd>{check.sampleEndDate}</dd>
          </div>
        </dl>
      </header>
      <dl className="mc-summary">
        <div><dt>OBSERVED / DAY</dt><dd>{signedPercent(check.observedAverageDailyEdgePct, 5)}</dd></div>
        <div><dt>ANNUALIZED</dt><dd>{signedPercent(check.observedAnnualizedEdgePct, 2)}</dd></div>
        <div><dt>MEAN 90%</dt><dd>{signedPercent(check.meanConfidenceIntervalDailyEdgePct.p05, 5)} — {signedPercent(check.meanConfidenceIntervalDailyEdgePct.p95, 5)}</dd></div>
        <div><dt>NULL 90%</dt><dd>{signedPercent(check.nullConfidenceIntervalDailyEdgePct.p05, 5)} — {signedPercent(check.nullConfidenceIntervalDailyEdgePct.p95, 5)}</dd></div>
        <div><dt>ACTIVE / ROWS</dt><dd>{formatNumber(check.activeOverlayDays, 0)} / {formatNumber(check.sampleCount, 0)}</dd></div>
        <div><dt>BLOCK</dt><dd>{formatNumber(check.blockLength, 0)} SESSIONS</dd></div>
      </dl>
      <p className="section-note">
        {check.method}. Only rows from {check.sampleStartDate} through {check.sampleEndDate} enter the all-year return gates.
      </p>
      <header className="validation-heading">
        <h3>Paper/live eligibility gates</h3>
        <dl>
          <div>
            <dt>PASSED</dt>
            <dd className={passedGateCount === promotionGateEntries.length ? 'positive' : 'warning'}>
              {passedGateCount} / {promotionGateEntries.length}
            </dd>
          </div>
        </dl>
      </header>
      <dl className="gate-list" aria-label="All-year paper and live eligibility gates">
        {promotionGateEntries.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd className={gates[key] ? 'positive' : 'warning'}>{gates[key] ? 'PASS' : 'FAIL'}</dd>
          </div>
        ))}
      </dl>
      <p className="section-note">
        Return gates use the selection prefix only. Component gates retain each component&apos;s declared pre-holdout result; execution, evidence, and approval gates fail closed independently.
      </p>
    </section>
  )
}

export function MonteCarloChart() {
  const plot = useMemo(() => buildMonteCarlo(allYearTrades.map((trade) => trade.netReturnPct)), [])
  const reportOnlyCheck = allYearBacktest.validation.realityCheck
  const allValues = plot.paths.flatMap((path) => path.values)
  const logMin = Math.log10(Math.max(1, Math.min(...allValues)))
  const logMax = Math.log10(Math.max(...allValues))
  const logSpan = Math.max(logMax - logMin, 0.001)
  const x = (index: number, count: number) => (index / Math.max(count - 1, 1)) * 1000
  const y = (value: number) => 304 - ((Math.log10(Math.max(1, value)) - logMin) / logSpan) * 288

  return (
    <section className="validation-panel" aria-labelledby="monte-carlo-title">
      <header className="validation-heading">
        <h3 id="monte-carlo-title">Full-calendar Monte Carlo · report-only</h3>
        <dl>
          <div>
            <dt>REPORT-ONLY P</dt>
            <dd className="warning">{formatNumber(reportOnlyCheck.pValue, 5)}</dd>
          </div>
          <div>
            <dt>PATHS</dt>
            <dd>{plot.simulationCount}</dd>
          </div>
        </dl>
      </header>
      <div className="monte-carlo-chart">
        <svg viewBox="0 0 1000 320" preserveAspectRatio="none" role="img" aria-label="Report-only simulated full-calendar portfolio equity paths on a logarithmic scale">
          <line x1="0" x2="1000" y1={y(100_000)} y2={y(100_000)} className="mc-baseline" />
          {plot.paths.map((path) => (
            <polyline
              key={path.id}
              className={path.selected ? 'mc-path selected' : 'mc-path'}
              points={path.values.map((value, index) => `${x(index, path.values.length)},${y(value)}`).join(' ')}
            />
          ))}
        </svg>
      </div>
      <dl className="mc-summary">
        <div><dt>P05 FINAL</dt><dd>{formatCurrency(plot.finalP05)}</dd></div>
        <div><dt>P50 FINAL</dt><dd>{formatCurrency(plot.finalP50)}</dd></div>
        <div><dt>P95 FINAL</dt><dd>{formatCurrency(plot.finalP95)}</dd></div>
        <div><dt>POSITIVE FINAL</dt><dd>{formatNumber(plot.positiveFinalPct, 0)}%</dd></div>
        <div><dt>SIM / ROWS</dt><dd>{plot.simulationCount} / {plot.sampleCount}</dd></div>
        <div><dt>REPORT THROUGH</dt><dd>{reportOnlyCheck.sampleEndDate}</dd></div>
      </dl>
      <p className="section-note">
        Uses the full calendar, including rows after the {allYearBacktest.validation.selectionMetrics.throughDate} selection cutoff. It is descriptive only, not promotion evidence or a live-wealth forecast.
      </p>
    </section>
  )
}

function heatmapBackground(value: number, minimum: number, maximum: number) {
  const ratio = (value - minimum) / Math.max(maximum - minimum, 0.0001)
  const alpha = 0.08 + Math.max(0, Math.min(1, ratio)) * 0.4
  return `rgba(69, 255, 120, ${alpha.toFixed(3)})`
}

export function OvernightRiskHeatmap() {
  const values = overnightRiskHeatmap.cells.map((cell) => cell.validationSharpe)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const leader = overnightRiskHeatmap.cells.find((cell) => cell.researchLeader)

  return (
    <section className="validation-panel heatmap-panel" aria-labelledby="overnight-risk-heatmap-title">
      <header className="validation-heading">
        <div>
          <span className="section-eyebrow">PARAMETER STABILITY</span>
          <h3 id="overnight-risk-heatmap-title">Overnight guard sensitivity · research-only</h3>
        </div>
        <dl>
          <div>
            <dt>METRIC</dt>
            <dd>VALIDATION SHARPE</dd>
          </div>
          <div>
            <dt>LEADER</dt>
            <dd>{leader ? `${leader.lookbackSessions}D / ${formatNumber(leader.thresholdPct, 2)}%` : '—'}</dd>
          </div>
        </dl>
      </header>
      <div className="risk-heatmap-scroll" tabIndex={0} aria-label="Overnight risk parameter heat map">
        <table className="risk-heatmap">
          <thead>
            <tr>
              <th scope="col">LOOKBACK ↓ / GAP →</th>
              {overnightRiskHeatmap.thresholds.map((threshold) => (
                <th scope="col" key={threshold}>{formatNumber(threshold, 2)}%</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overnightRiskHeatmap.lookbacks.map((lookback) => (
              <tr key={lookback}>
                <th scope="row">{lookback}D</th>
                {overnightRiskHeatmap.thresholds.map((threshold) => {
                  const cell = overnightRiskHeatmap.cells.find(
                    (candidate) => candidate.lookbackSessions === lookback && candidate.thresholdPct === threshold,
                  )
                  return (
                    <td
                      key={threshold}
                      className={cell?.researchLeader ? 'heatmap-cell research-leader' : 'heatmap-cell'}
                      style={cell ? { backgroundColor: heatmapBackground(cell.validationSharpe, minimum, maximum) } : undefined}
                      title={cell
                        ? `${cell.policyId}: validation Sharpe ${formatNumber(cell.validationSharpe, 2)}, return ${signedPercent(cell.validationReturnPct, 2)}${cell.eligible ? ', selection-eligible' : ''}`
                        : 'No candidate'}
                    >
                      {cell ? formatNumber(cell.validationSharpe, 2) : '—'}
                      {cell?.researchLeader && <span className="heatmap-leader-mark" aria-label="Research-only leader">◆</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span>LOWER</span>
        <i />
        <span>HIGHER</span>
      </div>
      <p className="section-note">
        Baseline-cost validation Sharpe across the versioned all-year overnight-gap policy grid. The diamond marks the train/validation research leader; deployment remains carry-through and the holdout is excluded from selection.
      </p>
    </section>
  )
}

export function BacktestValidation() {
  return (
    <section className="validation-band" aria-label="Selection-safe validation">
      <RealityCheckPanel />
    </section>
  )
}
