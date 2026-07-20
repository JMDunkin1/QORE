import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

export type SmoothChartRange = {
  startIndex: number
  endIndex: number
}

type SmoothChartAxisId = 'left' | 'right'
type SmoothChartXAxisMode = 'time' | 'event'

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
  ariaLabel: string
  data: TPoint[]
  breakLinesAfterDays?: number
  formatAxisDate: (value: string | undefined, visibleSpanDays: number) => string
  formatTooltipDate: (value: string | undefined) => string
  minWindow: number
  range: SmoothChartRange
  series: Array<SmoothChartSeries<TPoint>>
  onRangeChange: (range: SmoothChartRange) => void
  xAxisMode?: SmoothChartXAxisMode
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
const dayMs = 24 * 60 * 60 * 1000
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/

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

function calendarTimeMs(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(isoDatePattern)
  if (match) {
    const [, year, month, day] = match
    return Date.UTC(Number(year), Number(month) - 1, Number(day))
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isoDateFromTime(time: number) {
  return new Date(time).toISOString().slice(0, 10)
}

function utcMonthStart(time: number) {
  const date = new Date(time)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

function addUtcMonths(time: number, months: number) {
  const date = new Date(time)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
}

function utcMonthIndex(time: number) {
  const date = new Date(time)
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

function niceMonthStep(start: number, end: number, maxTicks: number) {
  const spanMonths = Math.max(1, utcMonthIndex(end) - utcMonthIndex(start) + 1)
  const rawStep = Math.max(1, Math.ceil(spanMonths / Math.max(maxTicks - 1, 1)))
  const niceSteps = [1, 2, 3, 6, 12, 24, 36, 60]
  return niceSteps.find((step) => step >= rawStep) ?? rawStep
}

function niceDayStep(spanDays: number, maxTicks: number) {
  const rawStep = Math.max(1, Math.ceil(spanDays / Math.max(maxTicks - 1, 1)))
  const niceSteps = [1, 2, 3, 5, 7, 14, 30, 60, 90, 180, 365]
  return niceSteps.find((step) => step >= rawStep) ?? rawStep
}

function calendarTicksForDomain(startTime: number, endTime: number, maxTicks = 6) {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return []
  const start = Math.min(startTime, endTime)
  const end = Math.max(startTime, endTime)
  if (start === end) return [{ key: isoDateFromTime(start), time: start, date: isoDateFromTime(start) }]

  const spanDays = Math.max(1, (end - start) / dayMs)
  const ticks: Array<{ key: string; time: number; date: string }> = []

  if (spanDays >= 75) {
    const monthStep = niceMonthStep(start, end, maxTicks)
    let tickTime = utcMonthStart(start)
    if (tickTime < start) tickTime = addUtcMonths(tickTime, monthStep)
    while (tickTime <= end && ticks.length < maxTicks) {
      ticks.push({ key: isoDateFromTime(tickTime), time: tickTime, date: isoDateFromTime(tickTime) })
      tickTime = addUtcMonths(tickTime, monthStep)
    }
  }

  if (!ticks.length) {
    const stepDays = niceDayStep(spanDays, maxTicks)
    const startDay = Math.ceil(start / dayMs)
    let tickTime = startDay * dayMs
    while (tickTime <= end && ticks.length < maxTicks) {
      ticks.push({ key: isoDateFromTime(tickTime), time: tickTime, date: isoDateFromTime(tickTime) })
      tickTime += stepDays * dayMs
    }
  }

  if (ticks.length < 2) {
    ticks.push(
      { key: isoDateFromTime(start), time: start, date: isoDateFromTime(start) },
      { key: isoDateFromTime(end), time: end, date: isoDateFromTime(end) },
    )
  }

  const endpointTicks = [
    { key: isoDateFromTime(start), time: start, date: isoDateFromTime(start) },
    { key: isoDateFromTime(end), time: end, date: isoDateFromTime(end) },
  ]
  const uniqueTicks = new Map<string, { key: string; time: number; date: string }>()
  const orderedTicks = [...endpointTicks, ...ticks]
  orderedTicks.forEach((tick) => uniqueTicks.set(tick.key, tick))
  const sortedTicks = [...uniqueTicks.values()].sort((first, second) => first.time - second.time)
  const minimumSpacing = ((end - start) / Math.max(maxTicks - 1, 1)) * 0.45
  const startTick = endpointTicks[0]
  const endTick = endpointTicks[1]
  const spacedTicks = [startTick]

  sortedTicks.forEach((tick) => {
    if (tick.key === startTick.key || tick.key === endTick.key) return
    const previousTick = spacedTicks.at(-1)!
    if (tick.time - previousTick.time >= minimumSpacing && end - tick.time >= minimumSpacing) spacedTicks.push(tick)
  })

  const previousTick = spacedTicks.at(-1)!
  if (spacedTicks.length === 1 || endTick.time - previousTick.time >= minimumSpacing) {
    spacedTicks.push(endTick)
  } else {
    spacedTicks[spacedTicks.length - 1] = endTick
  }

  return spacedTicks
}

function niceIndexStep(span: number, maxTicks: number) {
  const rawStep = Math.max(1, Math.ceil(span / Math.max(maxTicks - 1, 1)))
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return multiplier * magnitude
}

function eventTicksForDomain<TPoint extends SmoothChartPoint>(startValue: number, endValue: number, data: TPoint[], maxTicks = 6) {
  if (!data.length || !Number.isFinite(startValue) || !Number.isFinite(endValue)) return []
  const minIndex = Math.max(0, Math.min(data.length - 1, Math.ceil(Math.min(startValue, endValue))))
  const maxIndex = Math.max(minIndex, Math.min(data.length - 1, Math.floor(Math.max(startValue, endValue))))
  const step = niceIndexStep(Math.max(1, maxIndex - minIndex), maxTicks)
  const ticks = new Set<number>([minIndex, maxIndex])
  let tickIndex = Math.ceil(minIndex / step) * step

  while (tickIndex <= maxIndex && ticks.size < maxTicks) {
    ticks.add(tickIndex)
    tickIndex += step
  }

  return [...ticks]
    .sort((first, second) => first - second)
    .map((index) => ({
      key: `event-${index}`,
      value: index,
      date: data[index]?.date ?? '',
    }))
}

function shouldBreakLine(previousPoint: SmoothChartPoint | null, point: SmoothChartPoint, breakLinesAfterDays: number | undefined) {
  if (!previousPoint || !breakLinesAfterDays || breakLinesAfterDays <= 0) return false
  const previousTime = calendarTimeMs(previousPoint.date)
  const pointTime = calendarTimeMs(point.date)
  if (previousTime === null || pointTime === null) return false
  return Math.abs(pointTime - previousTime) / dayMs > breakLinesAfterDays
}

function linePath<TPoint extends SmoothChartPoint>(
  data: TPoint[],
  series: SmoothChartSeries<TPoint>,
  xScale: (point: TPoint) => number,
  yScale: (value: number, axis: SmoothChartAxisId) => number,
  breakLinesAfterDays?: number,
) {
  let path = ''
  let started = false
  let previousPoint: TPoint | null = null

  data.forEach((point) => {
    const value = finiteValue(point[series.dataKey])
    if (value === null) {
      started = false
      previousPoint = null
      return
    }
    if (shouldBreakLine(previousPoint, point, breakLinesAfterDays)) started = false
    const x = xScale(point)
    const y = yScale(value, series.axis)
    path += `${started ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)} `
    started = true
    previousPoint = point
  })

  return path.trim()
}

function stepPath<TPoint extends SmoothChartPoint>(
  data: TPoint[],
  series: SmoothChartSeries<TPoint>,
  xScale: (point: TPoint) => number,
  yScale: (value: number, axis: SmoothChartAxisId) => number,
  breakLinesAfterDays?: number,
) {
  let path = ''
  let previousY: number | null = null
  let previousPoint: TPoint | null = null

  data.forEach((point) => {
    const value = finiteValue(point[series.dataKey])
    if (value === null) {
      previousY = null
      previousPoint = null
      return
    }
    const shouldBreak = shouldBreakLine(previousPoint, point, breakLinesAfterDays)
    const x = xScale(point)
    const y = yScale(value, series.axis)
    if (previousY === null || shouldBreak) {
      path += `M ${x.toFixed(2)} ${y.toFixed(2)} `
    } else {
      path += `H ${x.toFixed(2)} V ${y.toFixed(2)} `
    }
    previousY = y
    previousPoint = point
  })

  return path.trim()
}

function areaPath<TPoint extends SmoothChartPoint>(
  data: TPoint[],
  series: SmoothChartSeries<TPoint>,
  xScale: (point: TPoint) => number,
  yScale: (value: number, axis: SmoothChartAxisId) => number,
  breakLinesAfterDays?: number,
) {
  const segments: Array<Array<{ x: number; y: number }>> = []
  let currentSegment: Array<{ x: number; y: number }> = []
  let previousPoint: TPoint | null = null

  data.forEach((point) => {
    const value = finiteValue(point[series.dataKey])
    if (value === null) {
      if (currentSegment.length) segments.push(currentSegment)
      currentSegment = []
      previousPoint = null
      return
    }
    if (shouldBreakLine(previousPoint, point, breakLinesAfterDays) && currentSegment.length) {
      segments.push(currentSegment)
      currentSegment = []
    }
    currentSegment.push({ x: xScale(point), y: yScale(value, series.axis) })
    previousPoint = point
  })
  if (currentSegment.length) segments.push(currentSegment)
  if (!segments.length) return ''

  const baseline = yScale(0, series.axis)
  return segments
    .map((linePoints) => {
      const head = linePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      const last = linePoints.at(-1)!
      const first = linePoints[0]
      return `${head.join(' ')} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`
    })
    .join(' ')
}

export function SmoothZoomChart<TPoint extends SmoothChartPoint>({
  ariaLabel,
  breakLinesAfterDays,
  data,
  formatAxisDate,
  formatTooltipDate,
  minWindow,
  onRangeChange,
  range,
  series,
  xAxisMode = 'time',
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
  const pointXValues = useMemo(
    () => data.map((point, index) => (xAxisMode === 'event' ? index : (calendarTimeMs(point.date) ?? index * dayMs))),
    [data, xAxisMode],
  )
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
  const xDomain = useMemo(() => {
    const values = pointXValues.slice(bounds.startIndex, bounds.endIndex + 1).filter((value) => Number.isFinite(value))
    if (!values.length) return xAxisMode === 'event' ? ([0, 1] as const) : ([0, dayMs] as const)
    const min = Math.min(...values)
    const max = Math.max(...values)
    if (min !== max) return [min, max] as const
    const pad = xAxisMode === 'event' ? 0.5 : dayMs / 2
    return [min - pad, max + pad] as const
  }, [bounds.endIndex, bounds.startIndex, pointXValues, xAxisMode])
  const xValueSpan = Math.max(xDomain[1] - xDomain[0], 1)
  const visibleSpanDays = xAxisMode === 'time' ? xValueSpan / dayMs : 0
  const xScaleValue = useCallback(
    (value: number) => plot.left + ((value - xDomain[0]) / xValueSpan) * plot.width,
    [plot.left, plot.width, xDomain, xValueSpan],
  )
  const xScalePoint = useCallback(
    (point: TPoint) => xScaleValue(pointXValues[point.chartIndex] ?? (xAxisMode === 'event' ? point.chartIndex : (calendarTimeMs(point.date) ?? point.chartIndex * dayMs))),
    [pointXValues, xAxisMode, xScaleValue],
  )
  const yScale = useCallback(
    (value: number, axis: SmoothChartAxisId) => {
      const [min, max] = axis === 'right' ? rightDomain : leftDomain
      return plot.bottom - ((value - min) / Math.max(max - min, 1)) * plot.height
    },
    [leftDomain, plot.bottom, plot.height, rightDomain],
  )
  const xTicks = useMemo(
    () =>
      xAxisMode === 'event'
        ? eventTicksForDomain(xDomain[0], xDomain[1], data)
        : calendarTicksForDomain(xDomain[0], xDomain[1]).map((tick) => ({
            key: tick.key,
            value: tick.time,
            date: tick.date,
          })),
    [data, xAxisMode, xDomain],
  )
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
    const targetValue = xDomain[0] + ratio * xValueSpan
    const nearestPoint = visibleData.reduce<TPoint | null>((nearest, point) => {
      if (!nearest) return point
      const pointDistance = Math.abs((pointXValues[point.chartIndex] ?? point.chartIndex) - targetValue)
      const nearestDistance = Math.abs((pointXValues[nearest.chartIndex] ?? nearest.chartIndex) - targetValue)
      return pointDistance < nearestDistance ? point : nearest
    }, null)
    setHoverIndex(nearestPoint?.chartIndex ?? null)
  }

  return (
    <div
      className="smooth-chart"
      ref={frameRef}
      onMouseLeave={() => setHoverIndex(null)}
      onMouseMove={(event) => handlePointerMove(event.clientX, event.clientY)}
    >
      <svg className="smooth-chart-svg" role="img" aria-label={ariaLabel} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
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
          <g key={`x-${tick.key}`} className="smooth-chart-x-tick">
            <line x1={xScaleValue(tick.value)} x2={xScaleValue(tick.value)} y1={plot.bottom} y2={plot.bottom + 5} />
            <text x={xScaleValue(tick.value)} y={plot.bottom + 20} textAnchor="middle">
              {formatAxisDate(tick.date, visibleSpanDays)}
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
                    const x = xScalePoint(point) - barWidth / 2
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
            const path =
              entry.mode === 'step'
                ? stepPath(visibleData, entry, xScalePoint, yScale, breakLinesAfterDays)
                : linePath(visibleData, entry, xScalePoint, yScale, breakLinesAfterDays)
            return (
              <g key={entry.id}>
                {entry.mode === 'area' && (
                  <path
                    className="smooth-chart-area"
                    d={areaPath(visibleData, entry, xScalePoint, yScale, breakLinesAfterDays)}
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
              x1={xScalePoint(hoveredPoint)}
              x2={xScalePoint(hoveredPoint)}
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
                    cx={xScalePoint(hoveredPoint)}
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
            left: Math.min(xScalePoint(hoveredPoint) + 12, Math.max(svgWidth - 210, 12)),
            top: plot.top + 12,
          }}
        >
          <strong>{formatTooltipDate(hoveredPoint.date)}</strong>
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
