export type MetricDatum = {
  label: string
  value: string
  tone?: 'positive' | 'negative' | 'warning' | 'neutral'
}

export function MetricRail({ metrics, ariaLabel }: { metrics: MetricDatum[]; ariaLabel: string }) {
  return (
    <dl className="metric-rail" aria-label={ariaLabel}>
      {metrics.map((metric) => (
        <div key={metric.label} className={metric.tone ?? 'neutral'}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  )
}
