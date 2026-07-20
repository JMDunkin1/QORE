import { useState, type ReactNode } from 'react'
import {
  SmoothZoomChart,
  type SmoothChartPoint,
  type SmoothChartRange,
  type SmoothChartSeries,
} from './SmoothZoomChart'

function fullRange(length: number): SmoothChartRange {
  return { startIndex: 0, endIndex: Math.max(length - 1, 0) }
}

function utcDate(value: string | undefined) {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function formatAxisDate(value: string | undefined, visibleSpanDays: number) {
  const date = utcDate(value)
  if (!date) return '-'
  if (visibleSpanDays <= 120) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return date
    .toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .replace(/ (\d{2})$/, ' ’$1')
}

function formatTooltipDate(value: string | undefined) {
  const date = utcDate(value)
  return date
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : '-'
}

export function PerformanceChart<TPoint extends SmoothChartPoint>({
  title,
  meta,
  data,
  series,
  empty,
  actions,
  breakLinesAfterDays,
}: {
  title: string
  meta?: string
  data: TPoint[]
  series: Array<SmoothChartSeries<TPoint>>
  empty: string
  actions?: ReactNode
  breakLinesAfterDays?: number
}) {
  const [rangeState, setRangeState] = useState(() => ({ dataLength: data.length, range: fullRange(data.length) }))
  const range = rangeState.dataLength === data.length ? rangeState.range : fullRange(data.length)
  const setRange = (nextRange: SmoothChartRange) => setRangeState({ dataLength: data.length, range: nextRange })

  return (
    <section className="performance-panel" aria-label={title}>
      <header className="section-header chart-header">
        <div className="chart-title-group">
          <h2>{title}</h2>
          {meta && <span>{meta}</span>}
        </div>
        <div className="chart-actions">
          {actions}
          {data.length > 1 && (
            <button type="button" className="text-button" onClick={() => setRange(fullRange(data.length))}>
              RESET VIEW
            </button>
          )}
        </div>
      </header>
      <div className="performance-frame" title="Pinch to zoom; two-finger horizontal scroll to pan.">
        {data.length ? (
          <SmoothZoomChart
            ariaLabel={title}
            data={data}
            breakLinesAfterDays={breakLinesAfterDays}
            formatAxisDate={formatAxisDate}
            formatTooltipDate={formatTooltipDate}
            minWindow={Math.min(10, Math.max(data.length, 1))}
            range={range}
            series={series}
            onRangeChange={setRange}
          />
        ) : (
          <div className="empty-state">
            <span>{empty}</span>
          </div>
        )}
      </div>
    </section>
  )
}
