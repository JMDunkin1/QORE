#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/ngas-winter-alpha')
const WEATHER_HYBRID_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/weather-hybrid-rotation')
const DUAL_WEATHER_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/dual-weather-rotation')
const INDEX_MARKET_FILE = path.join(DATA_ROOT, 'market/yahoo/US-INDEX-BASKET-qore-market.csv')

const STRATEGY_ID = 'ngas-winter-alpha'
const INITIAL_CAPITAL = 100000
const TRAIN_END = '2024-03-31'
const VALIDATION_END = '2025-10-31'
const HOLDOUT_START = '2025-11-01'
const ROUND_TRIP_COST_PCT = 0.064
const ONE_WAY_COST_PCT = ROUND_TRIP_COST_PCT / 2
const TRADING_DAYS = 252
const BOOTSTRAP_ITERATIONS = 1200
const BLOCK_LENGTH = 10
const INDEX_TREND_LOOKBACK_SESSIONS = 200

const BLEND_POLICIES = [
  {
    id: 'net-additive-parent-overlay',
    label: 'Net additive parent overlay',
    positionPolicy:
      'Use Dual Weather forecast-follow position plus Weather Hybrid reversion position; opposite signals reduce exposure and same-side signals add, capped at the sum of parent risk budgets.',
    conflictPolicy: 'net-position',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'dual-follow-first',
    label: 'Dual follow first',
    positionPolicy: 'Use Dual Weather follow legs first; use Weather Hybrid reversion only when no follow leg is active.',
    conflictPolicy: 'follow-first',
    overlayCap: 0.25,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'weather-fade-first',
    label: 'Weather Hybrid fade first',
    positionPolicy: 'Use Weather Hybrid reversion first; use Dual Weather follow only when no reversion leg is active.',
    conflictPolicy: 'fade-first',
    overlayCap: 0.25,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'short-fade-priority',
    label: 'Reversion-short priority',
    positionPolicy:
      'Use Weather Hybrid reversion-short first, then Dual Weather follow, then other Weather Hybrid reversion rows.',
    conflictPolicy: 'short-fade-first',
    overlayCap: 0.25,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'fade-primary-confirmed-follow',
    label: 'Fade primary, confirmed follow',
    positionPolicy:
      'Use Weather Hybrid reversion as the primary gas overlay; add Dual Weather follow exposure only when the parent signals point the same way.',
    conflictPolicy: 'fade-confirmed-follow',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'fade-primary-confirmed-follow-risk-off',
    label: 'Fade primary, confirmed follow, index risk-off',
    positionPolicy:
      'Use Weather Hybrid reversion as the primary gas overlay; add Dual Weather follow exposure only when the parent signals point the same way, and move idle index capital to cash when the index is below its 200-session trend.',
    conflictPolicy: 'fade-confirmed-follow',
    overlayCap: 0.45,
    indexRiskMode: 'idle-index-200d-trend',
    selectionEligible: false,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionLong', 'reversionShort'],
  },
  {
    id: 'short-fade-confirmed-long',
    label: 'Short fade plus confirmed long fade',
    positionPolicy:
      'Take Weather Hybrid reversion-short setups directly; take reversion-long setups only when Dual Weather confirms cold demand in the same direction.',
    conflictPolicy: 'short-fade-confirmed-long',
    overlayCap: 0.45,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionShort'],
  },
  {
    id: 'short-fade-confirmed-long-risk-off',
    label: 'Short fade plus confirmed long fade, index risk-off',
    positionPolicy:
      'Take Weather Hybrid reversion-short setups directly; take reversion-long setups only when Dual Weather confirms cold demand in the same direction, and move idle index capital to cash when the index is below its 200-session trend.',
    conflictPolicy: 'short-fade-confirmed-long',
    overlayCap: 0.45,
    indexRiskMode: 'idle-index-200d-trend',
    selectionEligible: false,
    requiredSideChecks: ['coldLong', 'warmShort', 'reversionShort'],
  },
  {
    id: 'weather-hybrid-parent-risk-off',
    label: 'Weather Hybrid parent with index risk-off',
    positionPolicy:
      'Use the selected Weather Hybrid reversion parent unchanged, but move idle index capital to cash when the index is below its 200-session trend.',
    conflictPolicy: 'weather-hybrid-parent',
    overlayCap: 0.2,
    indexRiskMode: 'idle-index-200d-trend',
    selectionEligible: false,
    requiredSideChecks: ['reversionLong', 'reversionShort'],
  },
  {
    id: 'short-fade-only',
    label: 'Weather Hybrid short fade only',
    positionPolicy: 'Use only Weather Hybrid reversion-short setups and leave all other gas overlays inactive.',
    conflictPolicy: 'short-fade-only',
    overlayCap: 0.2,
    indexRiskMode: 'full-index-fallback',
    selectionEligible: true,
    requiredSideChecks: ['reversionShort'],
  },
]

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
}

function parseCsv(filePath) {
  return Papa.parse(readText(filePath), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  }).data
}

function numberFrom(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1))
}

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.floor((sorted.length - 1) * pct), 0, sorted.length - 1)
  return sorted[index]
}

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function daySplit(isoDate) {
  if (isoDate <= TRAIN_END) return 'train'
  if (isoDate <= VALIDATION_END) return 'validation'
  return 'holdout'
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}${rows.length ? '\n' : ''}`
}

function isFollowRow(row) {
  return row?.windowId === 'weather-follow'
}

function isReversionRow(row) {
  return row?.windowId === 'weather-reversion'
}

function baseFallbackRow(dualRow, weatherRow) {
  return dualRow ?? weatherRow
}

function sameDirection(firstPosition, secondPosition) {
  return firstPosition !== 0 && secondPosition !== 0 && Math.sign(firstPosition) === Math.sign(secondPosition)
}

function chooseDominantRow(followRow, reversionRow, position, policy) {
  if (policy.conflictPolicy === 'net-position' && followRow && reversionRow) {
    return Math.abs(numberFrom(followRow.ungPosition)) >= Math.abs(numberFrom(reversionRow.ungPosition))
      ? followRow
      : reversionRow
  }
  if (position !== 0 && followRow) return followRow
  if (position !== 0 && reversionRow) return reversionRow
  return followRow ?? reversionRow
}

function blendPositionFor(policy, dualRow, weatherRow) {
  const followRow = isFollowRow(dualRow) ? dualRow : null
  const reversionRow = isReversionRow(weatherRow) ? weatherRow : null
  const followPosition = numberFrom(followRow?.ungPosition)
  const reversionPosition = numberFrom(reversionRow?.ungPosition)

  if (policy.conflictPolicy === 'net-position') {
    return {
      followRow,
      reversionRow,
      followPosition,
      reversionPosition,
      position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
      blendLeg:
        followRow && reversionRow
          ? 'dual-follow+weather-hybrid-reversion'
          : followRow
            ? 'dual-follow'
            : reversionRow
              ? 'weather-hybrid-reversion'
              : 'index-fallback',
    }
  }

  if (policy.conflictPolicy === 'fade-confirmed-follow') {
    if (reversionRow && followRow && sameDirection(followPosition, reversionPosition)) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-follow+weather-hybrid-reversion',
      }
    }
    if (reversionRow) {
      return {
        followRow: null,
        reversionRow,
        followPosition: 0,
        reversionPosition,
        position: reversionPosition,
        blendLeg: 'weather-hybrid-reversion',
      }
    }
  }

  if (
    policy.conflictPolicy === 'confirmed-warm-short' ||
    policy.conflictPolicy === 'confirmed-warm-short-plus-cold-follow'
  ) {
    if (
      followRow?.thesisKind === 'warm-short' &&
      reversionRow?.thesisKind === 'reversion-short' &&
      sameDirection(followPosition, reversionPosition)
    ) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-warm-short+weather-hybrid-reversion',
      }
    }
    if (policy.conflictPolicy === 'confirmed-warm-short-plus-cold-follow' && followRow?.thesisKind === 'cold-long') {
      return {
        followRow,
        reversionRow: null,
        followPosition,
        reversionPosition: 0,
        position: followPosition,
        blendLeg: 'dual-cold-follow',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-confirmed-long') {
    if (reversionRow?.thesisKind === 'reversion-short') {
      const includeFollow = followRow && sameDirection(followPosition, reversionPosition)
      return {
        followRow: includeFollow ? followRow : null,
        reversionRow,
        followPosition: includeFollow ? followPosition : 0,
        reversionPosition,
        position: clamp((includeFollow ? followPosition : 0) + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: includeFollow ? 'confirmed-follow+weather-hybrid-reversion' : 'weather-hybrid-reversion',
      }
    }
    if (reversionRow?.thesisKind === 'reversion-long' && followRow && sameDirection(followPosition, reversionPosition)) {
      return {
        followRow,
        reversionRow,
        followPosition,
        reversionPosition,
        position: clamp(followPosition + reversionPosition, -policy.overlayCap, policy.overlayCap),
        blendLeg: 'confirmed-follow+weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'weather-hybrid-parent') {
    if (reversionRow) {
      return {
        followRow: null,
        reversionRow,
        followPosition: 0,
        reversionPosition,
        position: reversionPosition,
        blendLeg: 'weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'short-fade-only') {
    if (reversionRow?.thesisKind === 'reversion-short') {
      return {
        followRow: null,
        reversionRow,
        followPosition: 0,
        reversionPosition,
        position: reversionPosition,
        blendLeg: 'weather-hybrid-reversion',
      }
    }
  }

  if (policy.conflictPolicy === 'follow-first') {
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
    if (reversionRow) {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
  }

  if (policy.conflictPolicy === 'fade-first') {
    if (reversionRow) {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
  }

  if (policy.conflictPolicy === 'short-fade-first') {
    if (reversionRow?.thesisKind === 'reversion-short') {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
    if (followRow) return { followRow, reversionRow, followPosition, reversionPosition: 0, position: followPosition, blendLeg: 'dual-follow' }
    if (reversionRow) {
      return { followRow, reversionRow, followPosition: 0, reversionPosition, position: reversionPosition, blendLeg: 'weather-hybrid-reversion' }
    }
  }

  return { followRow, reversionRow, followPosition: 0, reversionPosition: 0, position: 0, blendLeg: 'index-fallback' }
}

function buildIndexTrendRiskMap(marketRows) {
  const riskByDate = new Map()
  const closes = []

  for (const row of marketRows) {
    const close = numberFrom(row.close, null)
    if (!Number.isFinite(close) || close <= 0) continue
    const previousClose = closes.at(-1)
    const hasLookback = closes.length >= INDEX_TREND_LOOKBACK_SESSIONS
    const trendAverage = hasLookback ? mean(closes.slice(-INDEX_TREND_LOOKBACK_SESSIONS)) : 0
    riskByDate.set(row.date, !hasLookback || previousClose >= trendAverage)
    closes.push(close)
  }

  return riskByDate
}

function indexRiskOnForDate(policy, date, indexTrendRiskByDate) {
  if (policy.indexRiskMode !== 'idle-index-200d-trend') return true
  return indexTrendRiskByDate.get(date) ?? true
}

function indexRiskLabelFor(policy) {
  return policy.indexRiskMode === 'idle-index-200d-trend'
    ? `${INDEX_TREND_LOOKBACK_SESSIONS}-session index trend risk-off for idle capital`
    : 'Full index fallback for idle capital'
}

function buildRowsForPolicy(policy, dualRows, weatherRows, indexTrendRiskByDate) {
  const dualByDate = new Map(dualRows.map((row) => [row.entryTradeDate, row]))
  const weatherByDate = new Map(weatherRows.map((row) => [row.entryTradeDate, row]))
  const dates = [...new Set([...dualByDate.keys(), ...weatherByDate.keys()])].sort()
  const rows = []
  const curve = []
  let equity = INITIAL_CAPITAL
  let peak = INITIAL_CAPITAL
  let previousPosition = 0

  for (const date of dates) {
    const dualRow = dualByDate.get(date)
    const weatherRow = weatherByDate.get(date)
    const fallback = baseFallbackRow(dualRow, weatherRow)
    const blend = blendPositionFor(policy, dualRow, weatherRow)
    const weatherActive = blend.position !== 0
    const activeFollowRow = weatherActive ? blend.followRow : null
    const activeReversionRow = weatherActive ? blend.reversionRow : null
    const dominant = weatherActive ? chooseDominantRow(activeFollowRow, activeReversionRow, blend.position, policy) ?? fallback : fallback
    const isFallback = blend.position === 0
    const indexReturnPct = numberFrom(fallback.indexReturnPct)
    const ungReturnPct = numberFrom(fallback.ungReturnPct)
    const indexFraction = Math.max(0, 1 - Math.abs(blend.position))
    const indexRiskOn = indexRiskOnForDate(policy, date, indexTrendRiskByDate)
    const investedIndexFraction = indexRiskOn ? indexFraction : 0
    const cashFraction = indexFraction - investedIndexFraction
    const grossReturnPct = investedIndexFraction * indexReturnPct + blend.position * ungReturnPct
    const tradingCostPct = Math.abs(blend.position - previousPosition) * ONE_WAY_COST_PCT
    const netReturnPct = investedIndexFraction * indexReturnPct + blend.position * ungReturnPct - tradingCostPct
    const previousEquity = equity
    equity = Math.max(1, equity * (1 + netReturnPct / 100))
    peak = Math.max(peak, equity)
    const drawdownPct = ((equity - peak) / peak) * 100
    const componentThesisKinds = [
      activeFollowRow?.thesisKind ? `follow:${activeFollowRow.thesisKind}` : null,
      activeReversionRow?.thesisKind ? `reversion:${activeReversionRow.thesisKind}` : null,
    ].filter(Boolean)

    const row = {
      strategyId: STRATEGY_ID,
      signalDate: dominant.issueDate ?? date,
      issueDate: dominant.issueDate ?? date,
      targetDate: dominant.targetDate ?? date,
      entryTradeDate: date,
      exitTradeDate: date,
      targetTradeDate: date,
      direction: blend.position < 0 ? 'short' : 'long',
      sourceId: isFallback
        ? 'US-INDEX-BASKET'
        : blend.followRow && blend.reversionRow
          ? 'dual-weather+weather-hybrid'
          : blend.followRow
            ? blend.followRow.sourceId
            : blend.reversionRow?.sourceId,
      windowId: isFallback
        ? 'index-fallback'
        : blend.followRow && blend.reversionRow
          ? 'winter-alpha-blend'
          : blend.followRow
            ? 'weather-follow'
            : 'weather-reversion',
      thesisKind: isFallback ? 'index-fallback' : dominant.thesisKind,
      leadDays: numberFrom(dominant.leadDays),
      confidence: round(Math.max(numberFrom(activeFollowRow?.confidence), numberFrom(activeReversionRow?.confidence)), 4),
      weightedAnomalyF: numberFrom(dominant.weightedAnomalyF),
      coveragePct: numberFrom(dominant.coveragePct),
      coldCoveragePct: dominant.thesisKind === 'cold-long' ? numberFrom(dominant.coldCoveragePct || dominant.coveragePct) : 0,
      warmCoveragePct: dominant.thesisKind === 'warm-short' ? numberFrom(dominant.warmCoveragePct || dominant.coveragePct) : 0,
      extremeCount: numberFrom(dominant.extremeCount),
      indexFraction: round(indexFraction, 4),
      investedIndexFraction: round(investedIndexFraction, 4),
      cashFraction: round(cashFraction, 4),
      indexRiskMode: policy.indexRiskMode,
      indexRiskOn,
      ungPosition: round(blend.position, 4),
      ungReturnPct: round(ungReturnPct, 4),
      indexReturnPct: round(indexReturnPct, 4),
      grossReturnPct: round(grossReturnPct, 4),
      tradingCostPct: round(tradingCostPct, 4),
      netReturnPct: round(netReturnPct, 4),
      equity: round(equity, 2),
      equityPct: round((equity / INITIAL_CAPITAL - 1) * 100, 4),
      drawdownPct: round(drawdownPct, 4),
      rank: round(Math.max(numberFrom(activeFollowRow?.rank), numberFrom(activeReversionRow?.rank)), 4),
      sourceStrategyId: isFallback
        ? 'index-fallback'
        : blend.followRow && blend.reversionRow
          ? 'dual-weather-rotation+weather-hybrid-rotation'
          : blend.followRow
            ? 'dual-weather-rotation'
            : 'weather-hybrid-rotation',
      blendLeg: blend.blendLeg,
      followPosition: round(blend.followPosition, 4),
      reversionPosition: round(blend.reversionPosition, 4),
      componentThesisKinds,
      positionPolicy: policy.id,
    }

    rows.push(row)
    curve.push({
      date,
      equity,
      equityPct: (equity / INITIAL_CAPITAL - 1) * 100,
      dailyPnlPct: previousEquity ? ((equity - previousEquity) / previousEquity) * 100 : 0,
      drawdownPct,
      position: blend.position,
      netReturnPct,
      indexReturnPct,
      activeReturnPct: netReturnPct - indexReturnPct,
    })
    previousPosition = blend.position
  }

  return { rows, curve }
}

function metricsFromCurve(curve, tradeCount) {
  if (!curve.length) {
    return {
      totalReturnPct: 0,
      cagrPct: 0,
      annualVolPct: 0,
      sharpe: 0,
      sortino: 0,
      maxDrawdownPct: 0,
      calmar: 0,
      winRatePct: 0,
      profitFactor: 0,
      tradeCount,
      exposurePct: 0,
      turnover: 0,
      var95Pct: 0,
      cvar95Pct: 0,
      averageDailyPnlPct: 0,
      firstEntry: null,
      lastExit: null,
      averageHoldDays: 1,
      tStat: 0,
    }
  }

  const returns = curve.map((point) => point.dailyPnlPct / 100)
  const negativeReturns = returns.filter((value) => value < 0)
  let rebasedEquity = 1
  let rebasedPeak = 1
  let maxDrawdown = 0
  for (const value of returns) {
    rebasedEquity *= 1 + value
    rebasedPeak = Math.max(rebasedPeak, rebasedEquity)
    maxDrawdown = Math.min(maxDrawdown, rebasedEquity / rebasedPeak - 1)
  }
  const totalReturn = rebasedEquity - 1
  const years = Math.max(daysBetween(curve[0].date, curve.at(-1).date) / 365.25, 1 / 365.25)
  const annualReturn = (1 + totalReturn) ** (1 / years) - 1
  const annualVol = std(returns) * Math.sqrt(TRADING_DAYS)
  const downsideVol = std(negativeReturns) * Math.sqrt(TRADING_DAYS)
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)
  const exposure = mean(curve.map((point) => Math.abs(point.position)))
  const turnover = curve.reduce((sum, point, index) => sum + Math.abs(point.position - (curve[index - 1]?.position ?? 0)), 0)
  const avg = mean(returns)
  const standardError = std(returns) ? std(returns) / Math.sqrt(returns.length) : 0

  return {
    totalReturnPct: round(totalReturn * 100, 2),
    cagrPct: round(annualReturn * 100, 2),
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (avg * TRADING_DAYS) / annualVol : 0, 2),
    sortino: round(downsideVol ? (avg * TRADING_DAYS) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdown * 100, 2),
    calmar: round(Math.abs(maxDrawdown) ? annualReturn / Math.abs(maxDrawdown) : 0, 2),
    winRatePct: round((returns.filter((value) => value > 0).length / Math.max(returns.length, 1)) * 100, 1),
    profitFactor: round(losses ? gains / losses : gains ? 99 : 0, 2),
    tradeCount,
    exposurePct: round(exposure * 100, 1),
    turnover: round(turnover, 2),
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(avg * 100, 3),
    firstEntry: curve[0].date,
    lastExit: curve.at(-1).date,
    averageHoldDays: 1,
    tStat: round(standardError ? avg / standardError : 0, 2),
  }
}

function curveForSplit(curve, split) {
  return curve.filter((point) => daySplit(point.date) === split)
}

function rowsForSplit(rows, split) {
  return rows.filter((row) => daySplit(row.entryTradeDate) === split)
}

function indexCurveFromRows(rows) {
  return rows.map((row) => ({
    date: row.entryTradeDate,
    dailyPnlPct: numberFrom(row.indexReturnPct),
    position: 0,
  }))
}

function sideReturnSnapshot(rows, splitFilter = () => true) {
  const metricFor = (thesisKinds) => {
    const selectedRows = rows.filter((row) => splitFilter(row) && thesisKinds.includes(row.thesisKind))
    return metricsFromCurve(
      selectedRows.map((row) => ({
        date: row.entryTradeDate,
        equity: INITIAL_CAPITAL * (1 + numberFrom(row.netReturnPct) / 100),
        dailyPnlPct: numberFrom(row.netReturnPct),
        drawdownPct: numberFrom(row.netReturnPct) < 0 ? numberFrom(row.netReturnPct) : 0,
        position: numberFrom(row.ungPosition),
      })),
      selectedRows.length,
    )
  }

  return {
    coldLong: metricFor(['cold-long']),
    warmShort: metricFor(['warm-short']),
    weatherFollow: metricFor(['cold-long', 'warm-short']),
    reversionLong: metricFor(['reversion-long']),
    reversionShort: metricFor(['reversion-short']),
    weatherReversion: metricFor(['reversion-long', 'reversion-short']),
    longSide: metricFor(['cold-long', 'reversion-long']),
    shortSide: metricFor(['warm-short', 'reversion-short']),
    fallback: metricFor(['index-fallback']),
  }
}

function legCounts(rows, splitFilter = () => true) {
  const scoped = rows.filter((row) => splitFilter(row))
  return {
    dualFollow: scoped.filter((row) => row.blendLeg === 'dual-follow').length,
    dualColdFollow: scoped.filter((row) => row.blendLeg === 'dual-cold-follow').length,
    weatherHybridReversion: scoped.filter((row) => row.blendLeg === 'weather-hybrid-reversion').length,
    blended: scoped.filter((row) => row.blendLeg === 'dual-follow+weather-hybrid-reversion').length,
    confirmedBlended: scoped.filter((row) =>
      ['confirmed-follow+weather-hybrid-reversion', 'confirmed-warm-short+weather-hybrid-reversion'].includes(row.blendLeg),
    ).length,
    coldLong: scoped.filter((row) => row.thesisKind === 'cold-long').length,
    warmShort: scoped.filter((row) => row.thesisKind === 'warm-short').length,
    reversionLong: scoped.filter((row) => row.thesisKind === 'reversion-long').length,
    reversionShort: scoped.filter((row) => row.thesisKind === 'reversion-short').length,
    indexRiskOff: scoped.filter((row) => row.indexRiskOn === false).length,
  }
}

function summarizePolicy(policy, dualRows, weatherRows, indexTrendRiskByDate) {
  const { rows, curve } = buildRowsForPolicy(policy, dualRows, weatherRows, indexTrendRiskByDate)
  const eventRows = rows.filter((row) => row.windowId !== 'index-fallback')
  const indexCurve = indexCurveFromRows(rows)
  const indexMetrics = {
    all: metricsFromCurve(indexCurve, 0),
    train: metricsFromCurve(curveForSplit(indexCurve, 'train'), 0),
    validation: metricsFromCurve(curveForSplit(indexCurve, 'validation'), 0),
    holdout: metricsFromCurve(curveForSplit(indexCurve, 'holdout'), 0),
  }
  const allMetrics = metricsFromCurve(curve, eventRows.length)
  const trainMetrics = metricsFromCurve(curveForSplit(curve, 'train'), rowsForSplit(eventRows, 'train').length)
  const validationMetrics = metricsFromCurve(curveForSplit(curve, 'validation'), rowsForSplit(eventRows, 'validation').length)
  const holdoutMetrics = metricsFromCurve(curveForSplit(curve, 'holdout'), rowsForSplit(eventRows, 'holdout').length)
  const splitEdges = {
    train: round(trainMetrics.totalReturnPct - indexMetrics.train.totalReturnPct, 2),
    validation: round(validationMetrics.totalReturnPct - indexMetrics.validation.totalReturnPct, 2),
    holdout: round(holdoutMetrics.totalReturnPct - indexMetrics.holdout.totalReturnPct, 2),
    all: round(allMetrics.totalReturnPct - indexMetrics.all.totalReturnPct, 2),
  }
  const sideReturns = {
    all: sideReturnSnapshot(rows),
    trainValidation: sideReturnSnapshot(rows, (row) => row.entryTradeDate <= VALIDATION_END),
    holdout: sideReturnSnapshot(rows, (row) => daySplit(row.entryTradeDate) === 'holdout'),
  }
  const result = {
    candidateId: `ngas-alpha-${policy.id}`,
    architectureId: 'parent-expert-blend',
    architectureLabel: policy.label,
    architectureDescription: policy.positionPolicy,
    useFollowLeg: true,
    useReversionLeg: true,
    sourceSetId: 'parent-selected-weather-experts',
    sourceSetLabel: 'Dual Weather follow plus Weather Hybrid reversion',
    sourceIds: ['dual-weather-rotation', 'weather-hybrid-rotation'],
    sourceWeightMode: 'parent-selected',
    sizingMode: policy.id,
    indexRiskMode: policy.indexRiskMode,
    indexRiskLabel: indexRiskLabelFor(policy),
    indexTrendLookbackSessions:
      policy.indexRiskMode === 'idle-index-200d-trend' ? INDEX_TREND_LOOKBACK_SESSIONS : null,
    anomalyThreshold: null,
    coverageThreshold: null,
    minConfidence: null,
    weatherFraction: 0.25,
    reversionFraction: 0.2,
    overlayCap: policy.overlayCap,
    followHoldDays: 3,
    reversionHoldDays: 2,
    minRealizedMovePct: 2,
    positionPolicy: policy.positionPolicy,
    conflictPolicy: policy.conflictPolicy,
    selectionEligible: policy.selectionEligible,
    requiredSideChecks: policy.requiredSideChecks,
    allMetrics,
    trainMetrics,
    validationMetrics,
    holdoutMetrics,
    indexMetrics,
    splitEdges,
    sideReturns,
    legCounts: {
      all: legCounts(rows),
      trainValidation: legCounts(rows, (row) => row.entryTradeDate <= VALIDATION_END),
      holdout: legCounts(rows, (row) => daySplit(row.entryTradeDate) === 'holdout'),
    },
    rows,
    curve,
  }

  return {
    ...result,
    eligible: isEligible(result),
    trainValidationRank: trainValidationRank(result),
  }
}

function isEligible(result) {
  const sides = result.sideReturns.trainValidation
  const sideChecksPass = result.requiredSideChecks.every((sideKey) => sides[sideKey].tradeCount > 0 && sides[sideKey].totalReturnPct > 0)

  return (
    result.trainMetrics.tradeCount >= 20 &&
    result.validationMetrics.tradeCount >= 10 &&
    result.trainMetrics.totalReturnPct > 0 &&
    result.validationMetrics.totalReturnPct > 0 &&
    result.selectionEligible &&
    result.indexRiskMode === 'full-index-fallback' &&
    result.splitEdges.train > 0 &&
    result.splitEdges.validation > 0 &&
    result.trainMetrics.maxDrawdownPct > result.indexMetrics.train.maxDrawdownPct &&
    result.validationMetrics.maxDrawdownPct > result.indexMetrics.validation.maxDrawdownPct &&
    result.trainMetrics.annualVolPct <= 20 &&
    result.validationMetrics.annualVolPct <= 20 &&
    sideChecksPass
  )
}

function trainValidationRank(result) {
  const sides = result.sideReturns.trainValidation
  const sideQuality =
    Math.min(12, sides.coldLong.totalReturnPct) +
    Math.min(12, sides.warmShort.totalReturnPct) +
    Math.min(12, sides.reversionLong.totalReturnPct) +
    Math.min(12, sides.reversionShort.totalReturnPct)
  const balance =
    Math.min(result.legCounts.trainValidation.coldLong, result.legCounts.trainValidation.warmShort) +
    Math.min(result.legCounts.trainValidation.reversionLong, result.legCounts.trainValidation.reversionShort)

  return round(
    result.splitEdges.train * 0.6 +
      result.splitEdges.validation * 1.05 +
      result.trainMetrics.sharpe * 8 +
      result.validationMetrics.sharpe * 11 +
      result.trainMetrics.sortino * 3 +
      result.validationMetrics.sortino * 4 +
      (result.trainMetrics.maxDrawdownPct - result.indexMetrics.train.maxDrawdownPct) * 1.3 +
      (result.validationMetrics.maxDrawdownPct - result.indexMetrics.validation.maxDrawdownPct) * 1.5 +
      (result.indexMetrics.train.annualVolPct - result.trainMetrics.annualVolPct) * 0.7 +
      (result.indexMetrics.validation.annualVolPct - result.validationMetrics.annualVolPct) * 0.9 +
      Math.sqrt(result.trainMetrics.tradeCount + result.validationMetrics.tradeCount) * 0.9 +
      Math.sqrt(balance) * 1.15 +
      sideQuality * 0.3,
    4,
  )
}

function formatCandidateRow(candidate) {
  return {
    candidateId: candidate.candidateId,
    eligible: candidate.eligible,
    trainValidationRank: candidate.trainValidationRank,
    architectureId: candidate.architectureId,
    conflictPolicy: candidate.conflictPolicy,
    indexRiskMode: candidate.indexRiskMode,
    selectionEligible: candidate.selectionEligible,
    overlayCap: candidate.overlayCap,
    trainReturnPct: candidate.trainMetrics.totalReturnPct,
    trainIndexReturnPct: candidate.indexMetrics.train.totalReturnPct,
    trainEdgePct: candidate.splitEdges.train,
    trainSharpe: candidate.trainMetrics.sharpe,
    trainVolatilityPct: candidate.trainMetrics.annualVolPct,
    trainMaxDrawdownPct: candidate.trainMetrics.maxDrawdownPct,
    validationReturnPct: candidate.validationMetrics.totalReturnPct,
    validationIndexReturnPct: candidate.indexMetrics.validation.totalReturnPct,
    validationEdgePct: candidate.splitEdges.validation,
    validationSharpe: candidate.validationMetrics.sharpe,
    validationVolatilityPct: candidate.validationMetrics.annualVolPct,
    validationMaxDrawdownPct: candidate.validationMetrics.maxDrawdownPct,
    trainValidationColdLongReturnPct: candidate.sideReturns.trainValidation.coldLong.totalReturnPct,
    trainValidationWarmShortReturnPct: candidate.sideReturns.trainValidation.warmShort.totalReturnPct,
    trainValidationReversionLongReturnPct: candidate.sideReturns.trainValidation.reversionLong.totalReturnPct,
    trainValidationReversionShortReturnPct: candidate.sideReturns.trainValidation.reversionShort.totalReturnPct,
    holdoutReturnPct: candidate.holdoutMetrics.totalReturnPct,
    holdoutIndexReturnPct: candidate.indexMetrics.holdout.totalReturnPct,
    holdoutEdgePct: candidate.splitEdges.holdout,
    holdoutSharpe: candidate.holdoutMetrics.sharpe,
    holdoutMaxDrawdownPct: candidate.holdoutMetrics.maxDrawdownPct,
    allReturnPct: candidate.allMetrics.totalReturnPct,
    allIndexReturnPct: candidate.indexMetrics.all.totalReturnPct,
    allEdgePct: candidate.splitEdges.all,
    allVolatilityPct: candidate.allMetrics.annualVolPct,
    allSharpe: candidate.allMetrics.sharpe,
    allMaxDrawdownPct: candidate.allMetrics.maxDrawdownPct,
  }
}

function selectedTradeRows(rows) {
  const headers = [
    'strategyId',
    'signalDate',
    'issueDate',
    'targetDate',
    'entryTradeDate',
    'exitTradeDate',
    'targetTradeDate',
    'direction',
    'sourceId',
    'windowId',
    'thesisKind',
    'leadDays',
    'confidence',
    'weightedAnomalyF',
    'coveragePct',
    'coldCoveragePct',
    'warmCoveragePct',
    'extremeCount',
    'indexFraction',
    'investedIndexFraction',
    'cashFraction',
    'indexRiskMode',
    'indexRiskOn',
    'ungPosition',
    'ungReturnPct',
    'indexReturnPct',
    'grossReturnPct',
    'tradingCostPct',
    'netReturnPct',
    'equity',
    'equityPct',
    'drawdownPct',
    'rank',
    'sourceStrategyId',
    'blendLeg',
    'followPosition',
    'reversionPosition',
    'componentThesisKinds',
    'positionPolicy',
  ]
  return { headers, rows }
}

function createSeededRandom(seed = 1987) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function blockBootstrapRealityCheck(curve) {
  const activeReturns = curve.map((point) => point.activeReturnPct / 100)
  const observed = mean(activeReturns)
  const random = createSeededRandom()
  let count = 0

  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    const sampled = []
    while (sampled.length < activeReturns.length) {
      const start = Math.floor(random() * activeReturns.length)
      for (let offset = 0; offset < BLOCK_LENGTH && sampled.length < activeReturns.length; offset += 1) {
        sampled.push(activeReturns[(start + offset) % activeReturns.length])
      }
    }
    if (mean(sampled) >= observed) count += 1
  }

  return {
    observedAverageDailyEdgePct: round(observed * 100, 5),
    pValue: round((count + 1) / (BOOTSTRAP_ITERATIONS + 1), 4),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BLOCK_LENGTH,
  }
}

function sideRow(label, metrics) {
  return `| ${label} | ${metrics.tradeCount} | ${metrics.totalReturnPct}% | ${metrics.sharpe} | ${metrics.maxDrawdownPct}% |`
}

function buildReport(summary) {
  const selected = summary.selected
  const topCandidates = summary.candidates

  return `# NGAS Winter Alpha

Generated at ${summary.generatedAt}.

## Purpose

This active QORE research strategy combines parent experts without fitting new weather thresholds: Dual Weather supplies the cold/warm forecast-follow context, and Weather Hybrid supplies post-window reversion context. The selected blend is ranked on train/validation only, with holdout reported after selection.

## Selected Candidate

- Architecture: ${selected.architectureLabel}.
- Parent experts: Dual Weather Rotation for forecast-follow and Weather Hybrid Rotation for post-window reversion.
- Position policy: ${selected.positionPolicy}
- Max weather UNG overlay: ${selected.overlayCap}x; parent weather leg ${selected.weatherFraction}x and weather reversion leg ${selected.reversionFraction}x.
- Idle capital risk mode: ${selected.indexRiskLabel}.
- Cost: ${ROUND_TRIP_COST_PCT}% round trip, charged as ${ONE_WAY_COST_PCT}% one-way on UNG position changes.
- Selection: ${summary.contract.selectionPolicy}

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | ${selected.trainMetrics.tradeCount} | ${selected.trainMetrics.totalReturnPct}% | ${selected.indexMetrics.train.totalReturnPct}% | ${selected.splitEdges.train}% | ${selected.trainMetrics.cagrPct}% | ${selected.trainMetrics.sharpe} | ${selected.trainMetrics.sortino} | ${selected.trainMetrics.maxDrawdownPct}% | ${selected.trainMetrics.exposurePct}% |
| Validation | ${selected.validationMetrics.tradeCount} | ${selected.validationMetrics.totalReturnPct}% | ${selected.indexMetrics.validation.totalReturnPct}% | ${selected.splitEdges.validation}% | ${selected.validationMetrics.cagrPct}% | ${selected.validationMetrics.sharpe} | ${selected.validationMetrics.sortino} | ${selected.validationMetrics.maxDrawdownPct}% | ${selected.validationMetrics.exposurePct}% |
| Holdout | ${selected.holdoutMetrics.tradeCount} | ${selected.holdoutMetrics.totalReturnPct}% | ${selected.indexMetrics.holdout.totalReturnPct}% | ${selected.splitEdges.holdout}% | ${selected.holdoutMetrics.cagrPct}% | ${selected.holdoutMetrics.sharpe} | ${selected.holdoutMetrics.sortino} | ${selected.holdoutMetrics.maxDrawdownPct}% | ${selected.holdoutMetrics.exposurePct}% |
| Full | ${selected.allMetrics.tradeCount} | ${selected.allMetrics.totalReturnPct}% | ${selected.indexMetrics.all.totalReturnPct}% | ${selected.splitEdges.all}% | ${selected.allMetrics.cagrPct}% | ${selected.allMetrics.sharpe} | ${selected.allMetrics.sortino} | ${selected.allMetrics.maxDrawdownPct}% | ${selected.allMetrics.exposurePct}% |

## Train/Validation Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
${sideRow('Cold-long', selected.sideReturns.trainValidation.coldLong)}
${sideRow('Warm-short', selected.sideReturns.trainValidation.warmShort)}
${sideRow('Reversion-long', selected.sideReturns.trainValidation.reversionLong)}
${sideRow('Reversion-short', selected.sideReturns.trainValidation.reversionShort)}
${sideRow('Long-side combined', selected.sideReturns.trainValidation.longSide)}
${sideRow('Short-side combined', selected.sideReturns.trainValidation.shortSide)}

## Full Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
${sideRow('Cold-long', selected.sideReturns.all.coldLong)}
${sideRow('Warm-short', selected.sideReturns.all.warmShort)}
${sideRow('Reversion-long', selected.sideReturns.all.reversionLong)}
${sideRow('Reversion-short', selected.sideReturns.all.reversionShort)}
${sideRow('Long-side combined', selected.sideReturns.all.longSide)}
${sideRow('Short-side combined', selected.sideReturns.all.shortSide)}
${sideRow('Index fallback', selected.sideReturns.all.fallback)}

## Anti-Overfit Check

- Candidate count: ${summary.search.candidateCount}.
- Eligible candidates: ${summary.search.eligibleCandidateCount}.
- Eligibility requires a selectable gas-alpha policy, positive train and validation edge, lower train and validation drawdown than the index basket, and train/validation volatility under a 20% annualized risk budget.
- Index risk-off variants are diagnostic-only because they can create cash-flat equity shelves and are a portfolio overlay rather than a gas-alpha rule.
- Holdout was not used for selection: ${summary.search.selectionUsedHoldout ? 'no' : 'yes'}.
- Block-bootstrap p-value versus index active daily return: ${summary.validation.realityCheck.pValue}.
- Bootstrap setup: ${summary.validation.realityCheck.iterations} iterations, ${summary.validation.realityCheck.blockLength}-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | Sharpe | maxDD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${topCandidates
  .map(
    (candidate) =>
      `| ${candidate.candidateId} | ${candidate.eligible ? 'yes' : 'no'} | ${candidate.trainValidationRank} | ${candidate.trainEdgePct}% | ${candidate.validationEdgePct}% | ${candidate.holdoutEdgePct}% | ${candidate.allEdgePct}% | ${candidate.allSharpe} | ${candidate.allMaxDrawdownPct}% |`,
  )
  .join('\n')}

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. The selected blend keeps idle capital in the index fallback so any return improvement comes from explicit gas overlays rather than a cash timing patch. Holdout is still one winter and the bootstrap reality check remains the promotion gate.
`
}

function main() {
  const weatherSummary = JSON.parse(readText(path.join(WEATHER_HYBRID_DIR, 'run-summary.json')))
  const dualSummary = JSON.parse(readText(path.join(DUAL_WEATHER_DIR, 'run-summary.json')))
  const weatherRows = parseCsv(path.join(WEATHER_HYBRID_DIR, 'selected-trades.csv'))
  const dualRows = parseCsv(path.join(DUAL_WEATHER_DIR, 'selected-trades.csv'))
  const indexMarketRows = parseCsv(INDEX_MARKET_FILE)
  const indexTrendRiskByDate = buildIndexTrendRiskMap(indexMarketRows)
  const candidates = BLEND_POLICIES.map((policy) => summarizePolicy(policy, dualRows, weatherRows, indexTrendRiskByDate)).sort(
    (a, b) => b.trainValidationRank - a.trainValidationRank,
  )
  const selected = candidates.find((candidate) => candidate.eligible) ?? candidates[0]
  const realityCheck = blockBootstrapRealityCheck(selected.curve)
  const { headers, rows } = selectedTradeRows(selected.rows)
  const summary = {
    generatedAt: new Date().toISOString(),
    strategyId: STRATEGY_ID,
    data: {
      weatherHybridSummary: path.relative(REPO_ROOT, path.join(WEATHER_HYBRID_DIR, 'run-summary.json')),
      weatherHybridTrades: path.relative(REPO_ROOT, path.join(WEATHER_HYBRID_DIR, 'selected-trades.csv')),
      dualWeatherSummary: path.relative(REPO_ROOT, path.join(DUAL_WEATHER_DIR, 'run-summary.json')),
      dualWeatherTrades: path.relative(REPO_ROOT, path.join(DUAL_WEATHER_DIR, 'selected-trades.csv')),
      marketStartDate: selected.allMetrics.firstEntry,
      marketEndDate: selected.allMetrics.lastExit,
      marketDays: selected.rows.length,
    },
    contract: {
      trainEnd: TRAIN_END,
      validationEnd: VALIDATION_END,
      holdoutStart: HOLDOUT_START,
      roundTripCostPct: ROUND_TRIP_COST_PCT,
      oneWayCostPct: ONE_WAY_COST_PCT,
      fallback: 'Unallocated capital remains in US-INDEX-BASKET close-to-close.',
      signalTiming:
        'Parent strategies already enforce post-signal execution; NGAS Winter Alpha only combines parent daily ledgers and recalculates costs.',
      selectionPolicy:
        'Only predeclared parent-blend policies are selected on train and validation. Generic idle-index risk-off variants are reported as diagnostics only, and holdout rows after 2025-11-01 are reported after selection.',
      overfitControl:
        'No new weather thresholds are fit here; parent candidates were selected by their own train/validation generators, and this layer only chooses a fixed blend policy while reporting portfolio-level risk-off overlays as diagnostics.',
      indexTrendLookbackSessions: INDEX_TREND_LOOKBACK_SESSIONS,
    },
    parents: {
      weatherHybrid: {
        strategyId: weatherSummary.strategyId,
        candidateId: weatherSummary.selected.candidateId,
        role: 'post-window overreaction fade expert',
      },
      dualWeather: {
        strategyId: dualSummary.strategyId,
        candidateId: dualSummary.selected.candidateId,
        role: 'cold-long and warm-short forecast-follow expert',
      },
    },
    selected: {
      ...selected,
      rows: undefined,
      curve: undefined,
    },
    candidates: candidates.map(formatCandidateRow),
    search: {
      candidateCount: candidates.length,
      eligibleCandidateCount: candidates.filter((candidate) => candidate.eligible).length,
      selectionUsedHoldout: false,
    },
    validation: {
      realityCheck,
    },
    outputFiles: {
      candidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'candidate-summary.csv')),
      selectedTrades: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-trades.csv')),
      report: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'report.md')),
    },
  }

  writeText(path.join(OUTPUT_DIR, 'candidate-summary.csv'), rowsToCsv(candidates.map(formatCandidateRow), Object.keys(formatCandidateRow(candidates[0]))))
  writeText(path.join(OUTPUT_DIR, 'selected-trades.csv'), rowsToCsv(rows, headers))
  writeText(path.join(OUTPUT_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_DIR, 'report.md'), buildReport(summary))

  console.log(
    [
      `Selected ${selected.candidateId}`,
      `return=${selected.allMetrics.totalReturnPct}%`,
      `edge=${selected.splitEdges.all}%`,
      `holdoutEdge=${selected.splitEdges.holdout}%`,
      `pValue=${realityCheck.pValue}`,
    ].join(' '),
  )
}

main()
