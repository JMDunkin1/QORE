import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

export type SmoothChartRange = {
  startIndex: number
  endIndex: number
}

type SmoothChartAxisId = 'left' | 'right'

export type SmoothChartPoint = {
  chartIndex: number
  date: string
  [key: string]: string | number | null | undefined
}

export type SmoothChartSeries<TPoint extends SmoothChartPoint> = {
  axis: SmoothChartAxisId
  color: string
  dataKey: Extract<keyof TPoint, string>
  id: string
  label: string
  dashArray?: string
  fill?: string
  fillOpacity?: number
  mode?: 'area' | 'bar' | 'line' | 'step'
  strokeOpacity?: number
  strokeWidth?: number
  visible?: boolean
  valueFormatter?: (value: number) => string
}

type SmoothZoomChartProps<TPoint extends SmoothChartPoint> = {
  data: TPoint[]
  formatDate: (value: string | undefined) => string
  minWindow: number
  range: SmoothChartRange
  series: Array<SmoothChartSeries<TPoint>>
  onRangeChange: (range: SmoothChartRange) => void
}

type Dimensions = {
  height: number
  width: number
}

type PlotBox = {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

type WebKitGestureEvent = Event & {
  clientX?: number
  clientY?: number
  scale?: number
}

const chartMargins = { top: 18, right: 52, bottom: 30, left: 48 }
const maxZoomPowerPerInput = 2.25
const wheelZoomPowerPerPixel = 0.08
const webKitGestureZoomGain = 3.5

function clampRatio(value: number) {
  return Math.max(0, Math.min(value, 1))
}

function finiteValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function fullRange(total: number): SmoothChartRange {
  return { startIndex: 0, endIndex: Math.max(total - 1, 0) }
}

function clampRange(range: SmoothChartRange, total: number, minWindow: number): SmoothChartRange {
  if (total <= 0) return fullRange(total)
  const requestedSpan = range.endIndex - range.startIndex + 1
  const minimumSpan = Math.min(minWindow, total)
  const span = Math.max(minimumSpan, Math.min(Number.isFinite(requestedSpan) ? requestedSpan : total, total))
  const rawStartIndex = Number.isFinite(range.startIndex) ? range.startIndex : 0
  const startIndex = Math.max(0, Math.min(rawStartIndex, total - span))
  return { startIndex, endIndex: startIndex + span - 1 }
}

function rangeDataBounds(range: SmoothChartRange, total: number, minWindow: number): SmoothChartRange {
  if (total <= 0) return fullRange(total)
  const clamped = clampRange(range, total, minWindow)
  const startIndex = Math.max(0, Math.min(Math.floor(clamped.startIndex), total - 1))
  const endIndex = Math.max(startIndex, Math.min(Math.ceil(clamped.endIndex), total - 1))
  return { startIndex, endIndex }
}

function normalizeWheelZoomPower(event: WheelEvent) {
  const deltaModeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1
  return -event.deltaY * deltaModeScale * wheelZoomPowerPerPixel
}

function zoomRangeAtRatio(
  range: SmoothChartRange,
  total: number,
  minWindow: number,
  zoomPower: number,
  anchorRatio: number,
): SmoothChartRange {
  if (total <= 1 || !Number.isFinite(zoomPower) || zoomPower === 0) return clampRange(range, total, minWindow)
  const current = clampRange(range, total, minWindow)
  const span = current.endIndex - current.startIndex + 1
  const scale = 2 ** Math.max(-maxZoomPowerPerInput, Math.min(zoomPower, maxZoomPowerPerInput))
  const nextSpan = Math.max(Math.min(minWindow, total), Math.min(total, span / scale))
  const ratio = clampRatio(anchorRatio)
  const anchorIndex = current.startIndex + (span - 1) * ratio
  const startIndex = anchorIndex - (nextSpan - 1) * ratio
  return clampRange({ startIndex, endIndex: startIndex + nextSpan - 1 }, total, minWindow)
}

function panRangeByDelta(range: SmoothChartRange, total: number, minWindow: number, panDelta: number, plotWidth: number) {
  if (total <= 1 || !Number.isFinite(panDelta) || panDelta === 0 || plotWidth <= 0) {
    return clampRange(range, total, minWindow)
  }
  const current = clampRange(range, total, minWindow)
  const span = current.endIndex - current.startIndex + 1
  const offset = (panDelta / plotWidth) * span
  return clampRange({ startIndex: current.startIndex + offset, endIndex: current.endIndex + offset }, total, minWindow)
}

function expandDomain(values: number[]) {
  if (!values.length) return [-1, 1] as const
  let min = Math.min(...values, 0)
  let max = Math.max(...values, 0)
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1)
    min -= pad
    max += pad
  } else {
    const pad = (max - min) * 0.08
    min -= pad
    max += pad
  }
  return [min, max] as const
}

function ticksForDomain(min: number, max: number, count = 5) {
  if (count <= 1) return [min]
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1))
}

function ticksForRange(range: SmoothChartRange, total: number, minWindow: number, maxTicks = 6) {
  if (total <= 0) return []
  const { startIndex, endIndex } = rangeDataBounds(range, total, minWindow)
  if (startIndex === endIndex) return [startIndex]

  const tickCount = Math.min(maxTicks, endIndex - startIndex + 1)
  const ticks = new Set<number>()
  for (let index = 0; index < tickCount; index += 1) {
    ticks.add(Math.round(startIndex + ((endIndex - startIndex) * index) / (tickCount - 1)))
  }
  return [...ticks].sort((first, second) => first - second)
}

function linePath<TPoint extends SmoothChartPoint>(
  data: TPoint[],
  series: SmoothChartSeries<TPoint>,
  xScale: (value: number) => number,
  yScale: (value: number, axis: SmoothChartAxisId) => number,
) {
  let path = ''
  let started = false

  data.forEach((point) => {
    const value = finiteValue(point[series.dataKey])
    if (value === null) {
      started = false
      return
    }
    const x = xScale(point.chartIndex)
    const y = yScale(value, series.axis)
    path += `${started ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)} `
    started = true
  })

  return path.trim()
}

function stepPath<TPoint extends SmoothChartPoint>(
  data: TPoint[],
  series: SmoothChartSeries<TPoint>,
  xScale: (value: number) => number,
  yScale: (value: number, axis: SmoothChartAxisId) => number,
) {
  let path = ''
  let previousY: number | null = null

  data.forEach((point) => {
    const value = finiteValue(point[series.dataKey])
    if (value === null) {
      previousY = null
      return
    }
    const x = xScale(point.chartIndex)
    const y = yScale(value, series.axis)
    if (previousY === null) {
      path += `M ${x.toFixed(2)} ${y.toFixed(2)} `
    } else {
      path += `H ${x.toFixed(2)} V ${y.toFixed(2)} `
    }
    previousY = y
  })

  return path.trim()
}

function areaPath<TPoint extends SmoothChartPoint>(
  data: TPoint[],
  series: SmoothChartSeries<TPoint>,
  xScale: (value: number) => number,
  yScale: (value: number, axis: SmoothChartAxisId) => number,
) {
  const linePoints = data
    .map((point) => {
      const value = finiteValue(point[series.dataKey])
      return value === null ? null : { x: xScale(point.chartIndex), y: yScale(value, series.axis) }
    })
    .filter((point): point is { x: number; y: number } => Boolean(point))

  if (!linePoints.length) return ''

  const baseline = yScale(0, series.axis)
  const head = linePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
  const last = linePoints.at(-1)!
  const first = linePoints[0]
  return `${head.join(' ')} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`
}

export function SmoothZoomChart<TPoint extends SmoothChartPoint>({
  data,
  formatDate,
  minWindow,
  onRangeChange,
  range,
  series,
}: SmoothZoomChartProps<TPoint>) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const pendingRangeRef = useRef(range)
  const frameRequestRef = useRef<number | null>(null)
  const dimensionsRef = useRef<Dimensions>({ width: 0, height: 0 })
  const gestureAnchorRatioRef = useRef(0.5)
  const gestureActiveRef = useRef(false)
  const gestureStartRangeRef = useRef<SmoothChartRange | null>(null)
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 0, height: 0 })
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const activeSeries = useMemo(() => series.filter((entry) => entry.visible !== false), [series])
  const hasRightAxis = activeSeries.some((entry) => entry.axis === 'right')
  const clampedRange = useMemo(() => clampRange(range, data.length, minWindow), [data.length, minWindow, range])
  const bounds = useMemo(() => rangeDataBounds(clampedRange, data.length, minWindow), [clampedRange, data.length, minWindow])
  const visibleData = useMemo(() => data.slice(bounds.startIndex, bounds.endIndex + 1), [bounds.endIndex, bounds.startIndex, data])
  const svgWidth = Math.max(dimensions.width, 1)
  const svgHeight = Math.max(dimensions.height, 1)
  const plot: PlotBox = {
    bottom: Math.max(svgHeight - chartMargins.bottom, chartMargins.top + 20),
    height: Math.max(svgHeight - chartMargins.top - chartMargins.bottom, 20),
    left: chartMargins.left,
    right: Math.max(svgWidth - chartMargins.right, chartMargins.left + 20),
    top: chartMargins.top,
    width: Math.max(svgWidth - chartMargins.left - chartMargins.right, 20),
  }
  const leftDomain = useMemo(() => {
    const values = visibleData.flatMap((point) =>
      activeSeries
        .filter((entry) => entry.axis === 'left')
        .map((entry) => finiteValue(point[entry.dataKey]))
        .filter((value): value is number => value !== null),
    )
    return expandDomain(values)
  }, [activeSeries, visibleData])
  const rightDomain = useMemo(() => {
    const values = visibleData.flatMap((point) =>
      activeSeries
        .filter((entry) => entry.axis === 'right')
        .map((entry) => finiteValue(point[entry.dataKey]))
        .filter((value): value is number => value !== null),
    )
    return expandDomain(values)
  }, [activeSeries, visibleData])
  const xSpan = Math.max(clampedRange.endIndex - clampedRange.startIndex, 1)
  const xScale = useCallback(
    (value: number) => plot.left + ((value - clampedRange.startIndex) / xSpan) * plot.width,
    [clampedRange.startIndex, plot.left, plot.width, xSpan],
  )
  const yScale = useCallback(
    (value: number, axis: SmoothChartAxisId) => {
      const [min, max] = axis === 'right' ? rightDomain : leftDomain
      return plot.bottom - ((value - min) / Math.max(max - min, 1)) * plot.height
    },
    [leftDomain, plot.bottom, plot.height, rightDomain],
  )
  const xTicks = useMemo(() => ticksForRange(clampedRange, data.length, minWindow), [clampedRange, data.length, minWindow])
  const leftTicks = useMemo(() => ticksForDomain(leftDomain[0], leftDomain[1]), [leftDomain])
  const rightTicks = useMemo(() => ticksForDomain(rightDomain[0], rightDomain[1]), [rightDomain])
  const reactId = useId()
  const clipId = useMemo(() => `smooth-chart-clip-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId])
  const hoveredPoint = hoverIndex === null ? null : data[hoverIndex]

  useEffect(() => {
    pendingRangeRef.current = clampedRange
  }, [clampedRange])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextDimensions = {
        height: Math.round(entry.contentRect.height),
        width: Math.round(entry.contentRect.width),
      }
      dimensionsRef.current = nextDimensions
      setDimensions(nextDimensions)
    })
    resizeObserver.observe(frame)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      if (frameRequestRef.current !== null) window.cancelAnimationFrame(frameRequestRef.current)
    }
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const anchorRatioForClientX = (clientX: number | undefined) => {
      const rect = frame.getBoundingClientRect()
      const currentDimensions = dimensionsRef.current
      const plotWidth = Math.max(currentDimensions.width - chartMargins.left - chartMargins.right, 20)
      const plotLeft = rect.left + chartMargins.left
      return clampRatio(((clientX ?? rect.left + rect.width / 2) - plotLeft) / plotWidth)
    }

    const eventStartedInFrame = (event: Event) => {
      const gestureEvent = event as WebKitGestureEvent
      const target = event.target
      if (target instanceof Node && frame.contains(target)) return true
      if (typeof gestureEvent.clientX !== 'number') return false
      const rect = frame.getBoundingClientRect()
      const clientY = 'clientY' in gestureEvent && typeof gestureEvent.clientY === 'number' ? gestureEvent.clientY : rect.top + rect.height / 2
      return gestureEvent.clientX >= rect.left && gestureEvent.clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    }

    const scheduleRange = (nextRange: SmoothChartRange) => {
      pendingRangeRef.current = nextRange
      if (frameRequestRef.current !== null) return
      frameRequestRef.current = window.requestAnimationFrame(() => {
        frameRequestRef.current = null
        onRangeChange(pendingRangeRef.current)
      })
    }

    const handleWheel = (event: WheelEvent) => {
      const isPinchZoom = event.ctrlKey || event.metaKey
      const isHorizontalPan = !isPinchZoom && Math.abs(event.deltaX) > Math.max(2, Math.abs(event.deltaY) * 1.35)
      if ((!isPinchZoom && !isHorizontalPan) || data.length <= 1) return

      if (event.cancelable) event.preventDefault()
      const currentDimensions = dimensionsRef.current
      const plotWidth = Math.max(currentDimensions.width - chartMargins.left - chartMargins.right, 20)
      const anchorRatio = anchorRatioForClientX(event.clientX)
      let nextRange = pendingRangeRef.current

      if (isHorizontalPan) {
        nextRange = panRangeByDelta(nextRange, data.length, minWindow, event.deltaX, plotWidth)
      }
      if (isPinchZoom) {
        nextRange = zoomRangeAtRatio(nextRange, data.length, minWindow, normalizeWheelZoomPower(event), anchorRatio)
      }

      scheduleRange(nextRange)
    }

    const handleGestureStart = (event: Event) => {
      if (data.length <= 1) return
      if (!eventStartedInFrame(event)) return
      if (event.cancelable) event.preventDefault()
      const gestureEvent = event as WebKitGestureEvent
      gestureActiveRef.current = true
      gestureStartRangeRef.current = pendingRangeRef.current
      gestureAnchorRatioRef.current = anchorRatioForClientX(gestureEvent.clientX)
    }

    const handleGestureChange = (event: Event) => {
      if (data.length <= 1) return
      if (!gestureActiveRef.current) return
      if (event.cancelable) event.preventDefault()
      const gestureEvent = event as WebKitGestureEvent
      const scale = typeof gestureEvent.scale === 'number' && Number.isFinite(gestureEvent.scale) ? gestureEvent.scale : 1
      const startRange = gestureStartRangeRef.current ?? pendingRangeRef.current
      const zoomPower = Math.log2(Math.max(0.05, scale)) * webKitGestureZoomGain
      scheduleRange(zoomRangeAtRatio(startRange, data.length, minWindow, zoomPower, gestureAnchorRatioRef.current))
    }

    const handleGestureEnd = () => {
      gestureActiveRef.current = false
      gestureStartRangeRef.current = null
    }

    frame.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('gesturestart', handleGestureStart, { capture: true, passive: false } as AddEventListenerOptions)
    window.addEventListener('gesturechange', handleGestureChange, { capture: true, passive: false } as AddEventListenerOptions)
    window.addEventListener('gestureend', handleGestureEnd, true)

    return () => {
      frame.removeEventListener('wheel', handleWheel)
      window.removeEventListener('gesturestart', handleGestureStart, true)
      window.removeEventListener('gesturechange', handleGestureChange, true)
      window.removeEventListener('gestureend', handleGestureEnd, true)
    }
  }, [data.length, minWindow, onRangeChange])

  const handlePointerMove = (clientX: number, clientY: number) => {
    const frame = frameRef.current
    if (!frame || !data.length) return
    const rect = frame.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    if (localX < plot.left || localX > plot.right || localY < plot.top || localY > plot.bottom) {
      setHoverIndex(null)
      return
    }
    const ratio = (localX - plot.left) / Math.max(plot.width, 1)
    const nextIndex = Math.max(0, Math.min(data.length - 1, Math.round(clampedRange.startIndex + ratio * xSpan)))
    setHoverIndex(nextIndex)
  }

  return (
    <div
      className="smooth-chart"
      ref={frameRef}
      onMouseLeave={() => setHoverIndex(null)}
      onMouseMove={(event) => handlePointerMove(event.clientX, event.clientY)}
    >
      <svg className="smooth-chart-svg" role="img" viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} />
          </clipPath>
        </defs>

        {leftTicks.map((tick) => {
          const y = yScale(tick, 'left')
          return (
            <g key={`grid-${tick}`} className="smooth-chart-gridline">
              <line x1={plot.left} x2={plot.right} y1={y} y2={y} />
              <text x={plot.left - 8} y={y + 4} textAnchor="end">
                {tick.toFixed(Math.abs(tick) < 10 ? 1 : 0)}
              </text>
            </g>
          )
        })}

        {hasRightAxis &&
          rightTicks.map((tick) => (
            <text key={`right-${tick}`} className="smooth-chart-axis-label right" x={plot.right + 8} y={yScale(tick, 'right') + 4}>
              {tick.toFixed(Math.abs(tick) < 10 ? 1 : 0)}
            </text>
          ))}

        <line className="smooth-chart-axis-line" x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} />
        {xTicks.map((tick) => (
          <g key={`x-${tick}`} className="smooth-chart-x-tick">
            <line x1={xScale(tick)} x2={xScale(tick)} y1={plot.bottom} y2={plot.bottom + 5} />
            <text x={xScale(tick)} y={plot.bottom + 20} textAnchor="middle">
              {formatDate(data[tick]?.date)}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {activeSeries.map((entry) => {
            if (entry.mode === 'bar') {
              const span = Math.max(clampedRange.endIndex - clampedRange.startIndex + 1, 1)
              const barWidth = Math.max(1, Math.min(10, (plot.width / span) * 0.72))
              const baseline = yScale(0, entry.axis)
              return (
                <g key={entry.id}>
                  {visibleData.map((point) => {
                    const value = finiteValue(point[entry.dataKey])
                    if (value === null) return null
                    const x = xScale(point.chartIndex) - barWidth / 2
                    const y = yScale(value, entry.axis)
                    return (
                      <rect
                        key={`${entry.id}-${point.chartIndex}`}
                        className="smooth-chart-bar"
                        x={x}
                        y={Math.min(y, baseline)}
                        width={barWidth}
                        height={Math.max(Math.abs(baseline - y), 1)}
                        fill={entry.color}
                        fillOpacity={entry.fillOpacity ?? 0.2}
                        stroke={entry.color}
                        strokeOpacity={entry.strokeOpacity ?? 0.3}
                      />
                    )
                  })}
                </g>
              )
            }

            const strokeWidth = entry.strokeWidth ?? 2
            const path = entry.mode === 'step' ? stepPath(visibleData, entry, xScale, yScale) : linePath(visibleData, entry, xScale, yScale)
            return (
              <g key={entry.id}>
                {entry.mode === 'area' && (
                  <path
                    className="smooth-chart-area"
                    d={areaPath(visibleData, entry, xScale, yScale)}
                    fill={entry.fill ?? entry.color}
                    fillOpacity={entry.fillOpacity ?? 0.35}
                  />
                )}
                <path
                  className="smooth-chart-line"
                  d={path}
                  fill="none"
                  stroke={entry.color}
                  strokeDasharray={entry.dashArray}
                  strokeOpacity={entry.strokeOpacity ?? 1}
                  strokeWidth={strokeWidth}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}

          {hoveredPoint && (
            <line
              className="smooth-chart-hover-line"
              x1={xScale(hoveredPoint.chartIndex)}
              x2={xScale(hoveredPoint.chartIndex)}
              y1={plot.top}
              y2={plot.bottom}
            />
          )}
          {hoveredPoint &&
            activeSeries
              .filter((entry) => entry.mode !== 'bar')
              .map((entry) => {
                const value = finiteValue(hoveredPoint[entry.dataKey])
                if (value === null) return null
                return (
                  <circle
                    key={`dot-${entry.id}`}
                    className="smooth-chart-hover-dot"
                    cx={xScale(hoveredPoint.chartIndex)}
                    cy={yScale(value, entry.axis)}
                    r={entry.strokeWidth && entry.strokeWidth > 2 ? 4.5 : 4}
                    fill="#ffffff"
                    stroke={entry.color}
                    strokeWidth={2}
                  />
                )
              })}
        </g>
      </svg>

      <div className="smooth-chart-legend" aria-hidden="true">
        {activeSeries.map((entry) => (
          <span key={entry.id}>
            <i style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>

      {hoveredPoint && (
        <div
          className="smooth-chart-tooltip"
          style={{
            left: Math.min(xScale(hoveredPoint.chartIndex) + 12, Math.max(svgWidth - 210, 12)),
            top: plot.top + 12,
          }}
        >
          <strong>{formatDate(hoveredPoint.date)}</strong>
          {activeSeries.map((entry) => {
            const value = finiteValue(hoveredPoint[entry.dataKey])
            if (value === null) return null
            return (
              <span key={`tooltip-${entry.id}`}>
                <i style={{ background: entry.color }} />
                {entry.label}: {entry.valueFormatter ? entry.valueFormatter(value) : value.toFixed(2)}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
