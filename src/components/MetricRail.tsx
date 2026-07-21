export type MetricDatum = {
  label: string
  value: string
  detail?: string
  emphasis?: boolean
  tone?: 'positive' | 'negative' | 'warning' | 'neutral'
}

export function MetricRail({ metrics, ariaLabel }: { metrics: MetricDatum[]; ariaLabel: string }) {
  return (
    <dl className="metric-rail" aria-label={ariaLabel}>
      {metrics.map((metric) => (
        <div key={metric.label} className={`${metric.tone ?? 'neutral'}${metric.emphasis ? ' emphasis' : ''}`}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
          {metric.detail && <dd className="metric-detail">{metric.detail}</dd>}
        </div>
      ))}
    </dl>
  )
}
