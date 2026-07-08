#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const INPUT_FILE = path.join(REPO_ROOT, 'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv')
const OUTPUT_DIR = path.join(REPO_ROOT, 'data/qore/research/strategy-agent-runs/ngas-live-weather-refresh')
const INITIAL_CAPITAL = 100000
const TRADING_DAYS = 252
const ONE_WAY_COST_PCT = 0.032
const EFFECTIVE_OVERLAY_CAP = 0.5625

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
  if (value === '' || value === null || value === undefined) return fallback
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
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
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

function profitFactor(returns) {
  const grossWins = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const grossLosses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  if (!grossLosses) return grossWins ? Number.POSITIVE_INFINITY : 0
  return grossWins / grossLosses
}

function investedIndexFraction(row, position) {
  const explicit = numberFrom(row.investedIndexFraction, Number.NaN)
  if (Number.isFinite(explicit)) return explicit
  const indexFraction = numberFrom(row.indexFraction, Number.NaN)
  if (Number.isFinite(indexFraction)) return indexFraction
  return Math.max(0, 1 - Math.abs(position))
}

function currentAllocation(row) {
  const position = numberFrom(row.ungPosition)
  return {
    position,
    indexFraction: investedIndexFraction(row, position),
  }
}

function droppedStandaloneNoRefreshPosition(row) {
  const shift = numberFrom(row.weatherResolutionShiftF, Number.NaN)
  if (!Number.isFinite(shift) || shift === 0) return 0
  const adverseWeatherGasDirection = shift < 0 ? 1 : -1
  return -adverseWeatherGasDirection * 0.25
}

function noWeatherRefreshAllocation(row) {
  const current = currentAllocation(row)
  if (row.componentVariant !== 'winter-alpha') return current
  if (row.weatherResolutionPolicy !== 'graded-shift-sizing') return current

  const action = row.weatherResolutionAction
  const scale = numberFrom(row.weatherResolutionScale, 1)
  const hasResolutionEffect =
    action && !['', 'none', 'missing-kept', 'no-reversion'].includes(action) && (scale !== 1 || action.includes('dropped'))
  if (!hasResolutionEffect) return current

  const followPosition = numberFrom(row.followPosition)
  let reversionPosition = 0
  if (scale === 0) {
    reversionPosition = droppedStandaloneNoRefreshPosition(row)
  } else {
    reversionPosition = numberFrom(row.reversionPosition) / scale
  }

  const position = clamp(followPosition + reversionPosition, -EFFECTIVE_OVERLAY_CAP, EFFECTIVE_OVERLAY_CAP)
  return {
    position,
    indexFraction: Math.max(0, 1 - Math.abs(position)),
  }
}

function returnForAllocation(row, allocation, previousPosition) {
  const grossReturnPct =
    allocation.indexFraction * numberFrom(row.indexReturnPct) + allocation.position * numberFrom(row.ungReturnPct)
  const tradingCostPct = Math.abs(allocation.position - previousPosition) * ONE_WAY_COST_PCT
  return {
    grossReturnPct,
    tradingCostPct,
    returnPct: grossReturnPct - tradingCostPct,
  }
}

function replayRows(rows, label, allocationForRow) {
  let previousPosition = 0
  return rows.map((row) => {
    const allocation = allocationForRow(row)
    const returns = returnForAllocation(row, allocation, previousPosition)
    previousPosition = allocation.position
    return {
      scenario: label,
      date: row.entryTradeDate,
      split: row.split,
      componentVariant: row.componentVariant,
      weatherResolutionAction: row.weatherResolutionAction,
      weatherResolutionScale: row.weatherResolutionScale,
      position: round(allocation.position, 4),
      indexFraction: round(allocation.indexFraction, 4),
      ungReturnPct: numberFrom(row.ungReturnPct),
      indexReturnPct: numberFrom(row.indexReturnPct),
      grossReturnPct: round(returns.grossReturnPct, 4),
      tradingCostPct: round(returns.tradingCostPct, 4),
      returnPct: round(returns.returnPct, 4),
    }
  })
}

function checkedInRows(rows) {
  return rows.map((row) => ({
    scenario: 'checked-in all-year beta',
    date: row.entryTradeDate,
    split: row.split,
    componentVariant: row.componentVariant,
    weatherResolutionAction: row.weatherResolutionAction,
    weatherResolutionScale: row.weatherResolutionScale,
    position: numberFrom(row.ungPosition),
    indexFraction: investedIndexFraction(row, numberFrom(row.ungPosition)),
    ungReturnPct: numberFrom(row.ungReturnPct),
    indexReturnPct: numberFrom(row.indexReturnPct),
    grossReturnPct: numberFrom(row.grossReturnPct),
    tradingCostPct: numberFrom(row.tradingCostPct),
    returnPct: numberFrom(row.netReturnPct),
  }))
}

function metrics(series) {
  const returns = series.map((row) => row.returnPct / 100)
  const negativeReturns = returns.filter((value) => value < 0)
  const firstEntry = series[0]?.date ?? ''
  const lastExit = series.at(-1)?.date ?? firstEntry
  const years = firstEntry && lastExit ? daysBetween(firstEntry, lastExit) / 365.25 : 1
  let equity = 1
  let peak = 1
  let maxDrawdownPct = 0

  for (const dailyReturn of returns) {
    equity = Math.max(0.000001, equity * (1 + dailyReturn))
    peak = Math.max(peak, equity)
    maxDrawdownPct = Math.min(maxDrawdownPct, ((equity - peak) / peak) * 100)
  }

  const annualVol = std(returns) * Math.sqrt(TRADING_DAYS)
  const downsideVol = std(negativeReturns) * Math.sqrt(TRADING_DAYS)
  const averageDailyReturn = mean(returns)
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)

  return {
    totalReturnPct: round((equity - 1) * 100, 2),
    cagrPct: round((equity ** (1 / Math.max(years, 1 / 365.25)) - 1) * 100, 2),
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (averageDailyReturn * TRADING_DAYS) / annualVol : 0, 2),
    sortino: round(downsideVol ? (averageDailyReturn * TRADING_DAYS) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    winRatePct: round(returns.length ? (returns.filter((value) => value > 0).length / returns.length) * 100 : 0, 1),
    profitFactor: round(profitFactor(returns), 2),
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(averageDailyReturn * 100, 3),
    firstEntry,
    lastExit,
  }
}

function splitSeries(series) {
  return {
    train: series.filter((row) => row.split === 'train'),
    validation: series.filter((row) => row.split === 'validation'),
    holdout: series.filter((row) => row.split === 'holdout'),
    all: series,
  }
}

function indexSeries(series) {
  return series.map((row) => ({
    ...row,
    returnPct: row.indexReturnPct,
  }))
}

function summarizeScenario(series, baselineBySplit) {
  const splits = splitSeries(series)
  return Object.fromEntries(
    Object.entries(splits).map(([split, splitRows]) => {
      const splitMetrics = metrics(splitRows)
      const indexMetrics = metrics(indexSeries(splitRows))
      const baseline = baselineBySplit[split]
      return [
        split,
        {
          ...splitMetrics,
          indexReturnPct: indexMetrics.totalReturnPct,
          edgePct: round(splitMetrics.totalReturnPct - indexMetrics.totalReturnPct, 2),
          deltaVsCheckedInPct: baseline ? round(splitMetrics.totalReturnPct - baseline.totalReturnPct, 2) : 0,
        },
      ]
    }),
  )
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n') + '\n'
}

function flattenSummary(summary) {
  return Object.entries(summary.scenarios).flatMap(([scenario, splits]) =>
    Object.entries(splits).map(([split, values]) => ({
      scenario,
      split,
      ...values,
    })),
  )
}

function comparisonHeadline(checkedInSummary, noWeatherRefreshSummary) {
  return Object.fromEntries(
    ['train', 'validation', 'holdout', 'all'].map((split) => {
      const live = checkedInSummary[split]
      const noRefresh = noWeatherRefreshSummary[split]
      return [
        split,
        {
          liveRefreshReturnPct: live.totalReturnPct,
          noRefreshReturnPct: noRefresh.totalReturnPct,
          liveMinusNoRefreshPct: round(live.totalReturnPct - noRefresh.totalReturnPct, 2),
          liveRefreshCagrPct: live.cagrPct,
          noRefreshCagrPct: noRefresh.cagrPct,
          liveRefreshSharpe: live.sharpe,
          noRefreshSharpe: noRefresh.sharpe,
          liveRefreshMaxDrawdownPct: live.maxDrawdownPct,
          noRefreshMaxDrawdownPct: noRefresh.maxDrawdownPct,
        },
      ]
    }),
  )
}

function main() {
  const sourceRows = parseCsv(INPUT_FILE)
  const checkedIn = checkedInRows(sourceRows)
  const currentReplay = replayRows(sourceRows, 'current replay from positions', currentAllocation)
  const noWeatherRefresh = replayRows(sourceRows, 'counterfactual no close-in weather refresh', noWeatherRefreshAllocation)
  const checkedInSummary = summarizeScenario(checkedIn, {})
  const baselineBySplit = checkedInSummary
  const noWeatherRefreshSummary = summarizeScenario(noWeatherRefresh, baselineBySplit)
  const weatherEffectRows = sourceRows.filter(
    (row) =>
      row.componentVariant === 'winter-alpha' &&
      row.weatherResolutionPolicy === 'graded-shift-sizing' &&
      row.weatherResolutionAction &&
      !['none', 'missing-kept', 'no-reversion'].includes(row.weatherResolutionAction),
  )
  const summary = {
    generatedAt: new Date().toISOString(),
    strategyId: 'ngas-live-weather-refresh-test',
    purpose:
      'Compare the checked-in all-year daily ledger, which includes close-in weather refresh behavior, with a no-close-in-weather-refresh counterfactual replay. This tests whether the existing live-weather-style adjustment layer helped returns; it does not add broker routing.',
    inputFile: path.relative(REPO_ROOT, INPUT_FILE),
    assumptions: {
      oneWayCostPct: ONE_WAY_COST_PCT,
      effectiveOverlayCap: EFFECTIVE_OVERLAY_CAP,
      droppedStandaloneNoRefreshPosition:
        'Rows that the current weather-resolution logic fully dropped are restored as a conservative +/-0.25 standalone reversion position inferred from the adverse forecast-shift direction.',
      noNewOptimization:
        'This is a replay comparison of the current all-year row stream, not a fresh parameter search or a live broker simulation.',
    },
    rowCounts: {
      rows: sourceRows.length,
      winterWeatherResolutionEffectRows: weatherEffectRows.length,
      droppedStandaloneRows: weatherEffectRows.filter((row) => row.weatherResolutionScale === '0').length,
    },
    headline: comparisonHeadline(checkedInSummary, noWeatherRefreshSummary),
    scenarios: {
      checkedIn: checkedInSummary,
      liveWeatherRefresh: checkedInSummary,
      currentReplay: summarizeScenario(currentReplay, baselineBySplit),
      noWeatherRefresh: noWeatherRefreshSummary,
    },
  }
  const replayRowsForCsv = [...currentReplay, ...noWeatherRefresh]
  const summaryRows = flattenSummary(summary)

  writeText(path.join(OUTPUT_DIR, 'comparison-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_DIR, 'comparison-summary.csv'), rowsToCsv(summaryRows, Object.keys(summaryRows[0])))
  writeText(path.join(OUTPUT_DIR, 'replayed-trades.csv'), rowsToCsv(replayRowsForCsv, Object.keys(replayRowsForCsv[0])))

  const checkedAll = summary.scenarios.checkedIn.all
  const noRefreshAll = summary.scenarios.noWeatherRefresh.all
  const checkedHoldout = summary.scenarios.checkedIn.holdout
  const noRefreshHoldout = summary.scenarios.noWeatherRefresh.holdout
  console.log(
    [
      `checkedInAll=${checkedAll.totalReturnPct}%`,
      `noRefreshAll=${noRefreshAll.totalReturnPct}%`,
      `deltaAll=${round(noRefreshAll.totalReturnPct - checkedAll.totalReturnPct, 2)}%`,
      `liveMinusNoRefreshAll=${round(checkedAll.totalReturnPct - noRefreshAll.totalReturnPct, 2)}%`,
      `checkedInHoldout=${checkedHoldout.totalReturnPct}%`,
      `noRefreshHoldout=${noRefreshHoldout.totalReturnPct}%`,
      `deltaHoldout=${round(noRefreshHoldout.totalReturnPct - checkedHoldout.totalReturnPct, 2)}%`,
      `liveMinusNoRefreshHoldout=${round(checkedHoldout.totalReturnPct - noRefreshHoldout.totalReturnPct, 2)}%`,
      `weatherEffectRows=${summary.rowCounts.winterWeatherResolutionEffectRows}`,
    ].join(' '),
  )
}

main()
