#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const INPUT_FILE = path.join(REPO_ROOT, 'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv')
const OUTPUT_DIR = path.join(REPO_ROOT, 'data/qore/research/strategy-agent-runs/ngas-live-weather-head-to-head')
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

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n') + '\n'
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
    liveAction: row.weatherResolutionAction ?? '',
    liveScale: numberFrom(row.weatherResolutionScale, 1),
  }
}

function droppedStandaloneNoRefreshPosition(row) {
  const shift = numberFrom(row.weatherResolutionShiftF, Number.NaN)
  if (!Number.isFinite(shift) || shift === 0) return 0
  const adverseWeatherGasDirection = shift < 0 ? 1 : -1
  return -adverseWeatherGasDirection * 0.25
}

function weatherResolutionWasApplied(row) {
  return (
    row.componentVariant === 'winter-alpha' &&
    row.weatherResolutionPolicy === 'graded-shift-sizing' &&
    row.weatherResolutionAction &&
    !['none', 'no-reversion'].includes(row.weatherResolutionAction)
  )
}

function materialWeatherResolutionEffect(row) {
  return (
    weatherResolutionWasApplied(row) &&
    !['missing-kept'].includes(row.weatherResolutionAction) &&
    (numberFrom(row.weatherResolutionScale, 1) !== 1 || row.weatherResolutionAction.includes('dropped'))
  )
}

function baseReversionPosition(row) {
  if (!weatherResolutionWasApplied(row)) return numberFrom(row.reversionPosition)
  const scale = numberFrom(row.weatherResolutionScale, 1)
  if (row.weatherResolutionAction === 'standalone-adverse-dropped' || scale === 0) return droppedStandaloneNoRefreshPosition(row)
  if (materialWeatherResolutionEffect(row)) return numberFrom(row.reversionPosition) / scale
  return numberFrom(row.reversionPosition)
}

function noWeatherRefreshAllocation(row) {
  const current = currentAllocation(row)
  if (!weatherResolutionWasApplied(row)) return current
  const position = clamp(numberFrom(row.followPosition) + baseReversionPosition(row), -EFFECTIVE_OVERLAY_CAP, EFFECTIVE_OVERLAY_CAP)
  return {
    position,
    indexFraction: Math.max(0, 1 - Math.abs(position)),
    liveAction: 'no-close-in-refresh',
    liveScale: 1,
  }
}

function weatherDirectionForWinterShift(shiftF) {
  if (shiftF < 0) return 1
  if (shiftF > 0) return -1
  return 0
}

function candidateScaleForRow(row, candidate, baseReversion) {
  const action = row.weatherResolutionAction
  const shiftF = numberFrom(row.weatherResolutionShiftF, Number.NaN)

  if (action === 'missing-kept') return { action: candidate.missingScale === 0 ? 'missing-dropped' : 'missing-kept', scale: candidate.missingScale }
  if (!Number.isFinite(shiftF) || baseReversion === 0) return { action: 'none', scale: 1 }

  const absShiftF = Math.abs(shiftF)
  const weatherGasDirection = weatherDirectionForWinterShift(shiftF)
  const positionDirection = Math.sign(baseReversion)
  const sameDirectionShift = weatherGasDirection !== 0 && weatherGasDirection === positionDirection
  const adverseDirectionShift = weatherGasDirection !== 0 && weatherGasDirection === -positionDirection
  const isStandaloneDropped = action === 'standalone-adverse-dropped'

  if (sameDirectionShift) {
    return {
      action: 'confirm-scaled',
      scale: round(clamp(candidate.sameBase + absShiftF / candidate.sameDivisor, candidate.sameBase, candidate.sameMax), 4),
    }
  }

  if (adverseDirectionShift) {
    if (isStandaloneDropped && candidate.standaloneMode === 'drop') return { action: 'standalone-adverse-dropped', scale: 0 }
    if (isStandaloneDropped && candidate.standaloneMode === 'keep-base') return { action: 'standalone-adverse-kept', scale: 1 }
    if (absShiftF >= candidate.adverseDropThresholdF) return { action: 'adverse-dropped', scale: 0 }
    return {
      action: isStandaloneDropped ? 'standalone-adverse-shrunk' : 'adverse-shrunk',
      scale: round(clamp(candidate.adverseBase - absShiftF / candidate.adverseDivisor, candidate.adverseMin, candidate.adverseMax), 4),
    }
  }

  return { action: 'neutral-shrunk', scale: candidate.neutralScale }
}

function optimizedLiveAllocation(row, candidate) {
  if (!weatherResolutionWasApplied(row)) return currentAllocation(row)
  const followPosition = numberFrom(row.followPosition)
  const baseReversion = baseReversionPosition(row)
  const decision = candidateScaleForRow(row, candidate, baseReversion)
  const reversionPosition = baseReversion * decision.scale
  const position = clamp(followPosition + reversionPosition, -candidate.effectiveOverlayCap, candidate.effectiveOverlayCap)
  return {
    position,
    indexFraction: Math.max(0, 1 - Math.abs(position)),
    liveAction: decision.action,
    liveScale: decision.scale,
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
      sourceAction: row.weatherResolutionAction,
      optimizedLiveAction: allocation.liveAction,
      optimizedLiveScale: round(allocation.liveScale ?? 1, 4),
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

function indexSeries(series) {
  return series.map((row) => ({
    ...row,
    returnPct: row.indexReturnPct,
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
    exposurePct: round(mean(series.map((row) => Math.abs(row.position))) * 100, 1),
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

function summarizeScenario(series) {
  const splits = splitSeries(series)
  return Object.fromEntries(
    Object.entries(splits).map(([split, splitRows]) => {
      const splitMetrics = metrics(splitRows)
      const indexMetrics = metrics(indexSeries(splitRows))
      return [
        split,
        {
          ...splitMetrics,
          indexReturnPct: indexMetrics.totalReturnPct,
          edgePct: round(splitMetrics.totalReturnPct - indexMetrics.totalReturnPct, 2),
        },
      ]
    }),
  )
}

function diffMetrics(liveSummary, baselineSummary) {
  return Object.fromEntries(
    ['train', 'validation', 'holdout', 'all'].map((split) => [
      split,
      {
        returnDeltaPct: round(liveSummary[split].totalReturnPct - baselineSummary[split].totalReturnPct, 2),
        cagrDeltaPct: round(liveSummary[split].cagrPct - baselineSummary[split].cagrPct, 2),
        sharpeDelta: round(liveSummary[split].sharpe - baselineSummary[split].sharpe, 2),
        maxDrawdownDeltaPct: round(liveSummary[split].maxDrawdownPct - baselineSummary[split].maxDrawdownPct, 2),
      },
    ]),
  )
}

function candidateId(candidate) {
  const drop = Number.isFinite(candidate.adverseDropThresholdF) ? candidate.adverseDropThresholdF : 'inf'
  return [
    `sb${candidate.sameBase}`,
    `sd${candidate.sameDivisor}`,
    `sx${candidate.sameMax}`,
    `ab${candidate.adverseBase}`,
    `ad${candidate.adverseDivisor}`,
    `an${candidate.adverseMin}`,
    `ax${candidate.adverseMax}`,
    `drop${drop}`,
    `st${candidate.standaloneMode}`,
    `n${candidate.neutralScale}`,
  ].join('-')
}

function candidateGrid() {
  const sameBases = [0.75, 0.85]
  const sameDivisors = [6, 8, 10]
  const sameMaxes = [1.125, 1.25, 1.375]
  const adverseBases = [0.8, 0.9]
  const adverseDivisors = [8, 10, 12]
  const adverseMins = [0, 0.25, 0.45]
  const adverseMaxes = [0.75, 0.9]
  const adverseDropThresholds = [4, 6, Number.POSITIVE_INFINITY]
  const standaloneModes = ['drop', 'adverse-scale', 'keep-base']
  const neutralScales = [0.85]
  const candidates = []

  for (const sameBase of sameBases) {
    for (const sameDivisor of sameDivisors) {
      for (const sameMax of sameMaxes) {
        for (const adverseBase of adverseBases) {
          for (const adverseDivisor of adverseDivisors) {
            for (const adverseMin of adverseMins) {
              for (const adverseMax of adverseMaxes) {
                if (adverseMin > adverseMax) continue
                for (const adverseDropThresholdF of adverseDropThresholds) {
                  for (const standaloneMode of standaloneModes) {
                    for (const neutralScale of neutralScales) {
                      const candidate = {
                        sameBase,
                        sameDivisor,
                        sameMax,
                        adverseBase,
                        adverseDivisor,
                        adverseMin,
                        adverseMax,
                        adverseDropThresholdF,
                        standaloneMode,
                        neutralScale,
                        missingScale: 1,
                        effectiveOverlayCap: EFFECTIVE_OVERLAY_CAP,
                      }
                      candidates.push({ ...candidate, candidateId: candidateId(candidate) })
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const current = {
    candidateId: 'current-checked-in-graded-shift',
    sameBase: 0.75,
    sameDivisor: 8,
    sameMax: 1.25,
    adverseBase: 0.9,
    adverseDivisor: 10,
    adverseMin: 0.45,
    adverseMax: 0.9,
    adverseDropThresholdF: Number.POSITIVE_INFINITY,
    standaloneMode: 'drop',
    neutralScale: 0.85,
    missingScale: 1,
    effectiveOverlayCap: EFFECTIVE_OVERLAY_CAP,
  }
  return [current, ...candidates.filter((candidate) => candidate.candidateId !== candidateId(current))]
}

function actionCounts(rows) {
  return rows.reduce((counts, row) => {
    const key = row.optimizedLiveAction || 'none'
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function candidateRow(candidate, summary, baselineSummary, currentSummary, actionCountPayload, rank, eligible) {
  const vsBaseline = diffMetrics(summary, baselineSummary)
  const vsCurrent = diffMetrics(summary, currentSummary)
  return {
    candidateId: candidate.candidateId,
    rank,
    eligible,
    trainValidationScore: candidate.trainValidationScore,
    trainReturnPct: summary.train.totalReturnPct,
    trainVsNonLivePct: vsBaseline.train.returnDeltaPct,
    trainVsCurrentLivePct: vsCurrent.train.returnDeltaPct,
    trainSharpe: summary.train.sharpe,
    trainMaxDrawdownPct: summary.train.maxDrawdownPct,
    validationReturnPct: summary.validation.totalReturnPct,
    validationVsNonLivePct: vsBaseline.validation.returnDeltaPct,
    validationVsCurrentLivePct: vsCurrent.validation.returnDeltaPct,
    validationSharpe: summary.validation.sharpe,
    validationMaxDrawdownPct: summary.validation.maxDrawdownPct,
    holdoutReturnPct: summary.holdout.totalReturnPct,
    holdoutVsNonLivePct: vsBaseline.holdout.returnDeltaPct,
    holdoutVsCurrentLivePct: vsCurrent.holdout.returnDeltaPct,
    holdoutSharpe: summary.holdout.sharpe,
    holdoutMaxDrawdownPct: summary.holdout.maxDrawdownPct,
    allReturnPct: summary.all.totalReturnPct,
    allVsNonLivePct: vsBaseline.all.returnDeltaPct,
    allVsCurrentLivePct: vsCurrent.all.returnDeltaPct,
    allSharpe: summary.all.sharpe,
    allMaxDrawdownPct: summary.all.maxDrawdownPct,
    sameBase: candidate.sameBase,
    sameDivisor: candidate.sameDivisor,
    sameMax: candidate.sameMax,
    adverseBase: candidate.adverseBase,
    adverseDivisor: candidate.adverseDivisor,
    adverseMin: candidate.adverseMin,
    adverseMax: candidate.adverseMax,
    adverseDropThresholdF: Number.isFinite(candidate.adverseDropThresholdF) ? candidate.adverseDropThresholdF : 'Infinity',
    standaloneMode: candidate.standaloneMode,
    neutralScale: candidate.neutralScale,
    missingScale: candidate.missingScale,
    actionCounts: Object.entries(actionCountPayload)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join('|'),
  }
}

function scoreCandidate(summary, baselineSummary) {
  const vsBaseline = diffMetrics(summary, baselineSummary)
  const train = vsBaseline.train
  const validation = vsBaseline.validation
  const liveTrain = summary.train
  const liveValidation = summary.validation
  const baselineValidation = baselineSummary.validation
  const drawdownPenalty = Math.max(0, baselineValidation.maxDrawdownPct - liveValidation.maxDrawdownPct)
  return round(
    validation.returnDeltaPct * 2.25 +
      train.returnDeltaPct * 0.75 +
      validation.sharpeDelta * 12 +
      train.sharpeDelta * 4 +
      validation.cagrDeltaPct * 0.1 -
      drawdownPenalty * 1.5 +
      liveTrain.edgePct * 0.02 +
      liveValidation.edgePct * 0.04,
    4,
  )
}

function isEligible(summary, baselineSummary) {
  const vsBaseline = diffMetrics(summary, baselineSummary)
  return (
    vsBaseline.train.returnDeltaPct > 0 &&
    vsBaseline.validation.returnDeltaPct > 0 &&
    summary.train.totalReturnPct > 0 &&
    summary.validation.totalReturnPct > 0 &&
    summary.validation.maxDrawdownPct >= baselineSummary.validation.maxDrawdownPct - 2
  )
}

function verdictFor(selectedSummary, baselineSummary, currentSummary) {
  const selectedVsBaseline = diffMetrics(selectedSummary, baselineSummary)
  const selectedVsCurrent = diffMetrics(selectedSummary, currentSummary)

  if (selectedVsBaseline.holdout.returnDeltaPct > 0 && selectedVsBaseline.holdout.sharpeDelta >= 0) {
    return {
      winner: 'optimized-live',
      verdict:
        'Optimized live weather refresh wins the head-to-head. It was selected on train/validation and then also beat the non-live counterfactual on holdout return and holdout Sharpe.',
    }
  }

  if (selectedVsBaseline.holdout.returnDeltaPct > 0) {
    return {
      winner: 'optimized-live-lean',
      verdict:
        'Optimized live weather refresh has the better holdout return, but the risk-adjusted holdout edge is not clean enough to call it decisive.',
    }
  }

  if (selectedVsCurrent.holdout.returnDeltaPct > 0 && selectedVsBaseline.holdout.returnDeltaPct <= 0) {
    return {
      winner: 'non-live-for-now',
      verdict:
        'Optimization improves the current live overlay, but it still does not beat the non-live counterfactual on holdout. Keep the live feed for monitoring/paper evidence; do not promote the optimized overlay over non-live yet.',
    }
  }

  return {
    winner: 'non-live',
    verdict:
      'Non-live wins the decisive holdout check. The live overlay can look better in train/validation or full-sample, but the optimized live candidate did not survive the holdout head-to-head.',
  }
}

function main() {
  const sourceRows = parseCsv(INPUT_FILE).sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate))
  const nonLiveRows = replayRows(sourceRows, 'non-live no close-in weather refresh', noWeatherRefreshAllocation)
  const currentLiveRows = replayRows(sourceRows, 'current checked-in live weather refresh', currentAllocation)
  const nonLiveSummary = summarizeScenario(nonLiveRows)
  const currentLiveSummary = summarizeScenario(currentLiveRows)

  const evaluated = []
  for (const candidate of candidateGrid()) {
    const rows = replayRows(sourceRows, `optimized live ${candidate.candidateId}`, (row) => optimizedLiveAllocation(row, candidate))
    const summary = summarizeScenario(rows)
    const trainValidationScore = scoreCandidate(summary, nonLiveSummary)
    evaluated.push({
      candidate: {
        ...candidate,
        trainValidationScore,
      },
      summary,
      actionCounts: actionCounts(rows),
      eligible: isEligible(summary, nonLiveSummary),
    })
  }

  evaluated.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    return b.candidate.trainValidationScore - a.candidate.trainValidationScore
  })

  const selected = evaluated[0]
  const selectedSummary = selected.summary
  const currentVsNonLive = diffMetrics(currentLiveSummary, nonLiveSummary)
  const selectedVsNonLive = diffMetrics(selectedSummary, nonLiveSummary)
  const selectedVsCurrent = diffMetrics(selectedSummary, currentLiveSummary)
  const verdict = verdictFor(selectedSummary, nonLiveSummary, currentLiveSummary)
  const candidateRows = evaluated.map((result, index) =>
    candidateRow(
      result.candidate,
      result.summary,
      nonLiveSummary,
      currentLiveSummary,
      result.actionCounts,
      index + 1,
      result.eligible,
    ),
  )
  const topCandidates = candidateRows.slice(0, 40)
  const bestHoldoutCandidate = [...candidateRows].sort((a, b) => b.holdoutVsNonLivePct - a.holdoutVsNonLivePct)[0]
  const positiveHoldoutCandidates = candidateRows.filter((row) => row.holdoutVsNonLivePct > 0)
  const selectedReplayRows = replayRows(sourceRows, `optimized live ${selected.candidate.candidateId}`, (row) =>
    optimizedLiveAllocation(row, selected.candidate),
  )
  const selectedRows = selectedReplayRows.map((row) => ({
    ...row,
    equity: '',
    equityPct: '',
  }))
  let equity = INITIAL_CAPITAL
  for (const row of selectedRows) {
    equity = Math.max(1, equity * (1 + row.returnPct / 100))
    row.equity = round(equity, 2)
    row.equityPct = round((equity / INITIAL_CAPITAL - 1) * 100, 4)
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    strategyId: 'ngas-live-weather-head-to-head',
    inputFile: path.relative(REPO_ROOT, INPUT_FILE),
    purpose:
      'Optimize close-in live weather-resolution overlay parameters for the all-year NGAS selected row stream, using train/validation only, then compare the selected live variant against the non-live no-refresh counterfactual on holdout.',
    assumptions: {
      oneWayCostPct: ONE_WAY_COST_PCT,
      effectiveOverlayCap: EFFECTIVE_OVERLAY_CAP,
      optimizedSurface:
        'Winter Alpha close-in weather-resolution scaling inside the checked-in all-year selected stream. Summer Alpha has no active close-in resolution rows in this all-year artifact, so it is left frozen.',
      nonLiveCounterfactual:
        'Close-in weather-resolution changes are removed by restoring the inferred original reversion leg and replaying with the same daily market rows and trading-cost model.',
      selectionPolicy:
        'Candidate ranking and eligibility use train and validation only. Holdout metrics are computed after selection and are the decisive verdict check.',
      liveRoutingBoundary:
        'This is a daily-resolution research/paper replay. It does not instantiate broker routing or simulate intraday fills.',
    },
    rowCounts: {
      rows: sourceRows.length,
      winterRows: sourceRows.filter((row) => row.componentVariant === 'winter-alpha').length,
      liveResolutionRows: sourceRows.filter(weatherResolutionWasApplied).length,
      materialLiveResolutionEffectRows: sourceRows.filter(materialWeatherResolutionEffect).length,
      evaluatedLiveCandidates: evaluated.length,
      eligibleLiveCandidates: evaluated.filter((result) => result.eligible).length,
    },
    selectedCandidate: {
      candidateId: selected.candidate.candidateId,
      trainValidationScore: selected.candidate.trainValidationScore,
      eligible: selected.eligible,
      parameters: {
        sameBase: selected.candidate.sameBase,
        sameDivisor: selected.candidate.sameDivisor,
        sameMax: selected.candidate.sameMax,
        adverseBase: selected.candidate.adverseBase,
        adverseDivisor: selected.candidate.adverseDivisor,
        adverseMin: selected.candidate.adverseMin,
        adverseMax: selected.candidate.adverseMax,
        adverseDropThresholdF: Number.isFinite(selected.candidate.adverseDropThresholdF)
          ? selected.candidate.adverseDropThresholdF
          : 'Infinity',
        standaloneMode: selected.candidate.standaloneMode,
        neutralScale: selected.candidate.neutralScale,
        missingScale: selected.candidate.missingScale,
      },
      actionCounts: selected.actionCounts,
    },
    postSelectionDiagnostics: {
      note:
        'These diagnostics inspect holdout after the train/validation selection is already complete. They are not used to select the live candidate.',
      positiveHoldoutLiveCandidates: positiveHoldoutCandidates.length,
      positiveHoldoutLiveCandidatePct: round((positiveHoldoutCandidates.length / Math.max(candidateRows.length, 1)) * 100, 2),
      bestHoldoutLiveCandidate: bestHoldoutCandidate
        ? {
            candidateId: bestHoldoutCandidate.candidateId,
            trainValidationRank: bestHoldoutCandidate.rank,
            trainVsNonLivePct: bestHoldoutCandidate.trainVsNonLivePct,
            validationVsNonLivePct: bestHoldoutCandidate.validationVsNonLivePct,
            holdoutVsNonLivePct: bestHoldoutCandidate.holdoutVsNonLivePct,
            allVsNonLivePct: bestHoldoutCandidate.allVsNonLivePct,
          }
        : null,
    },
    verdict,
    headline: {
      currentLiveVsNonLive: currentVsNonLive,
      optimizedLiveVsNonLive: selectedVsNonLive,
      optimizedLiveVsCurrentLive: selectedVsCurrent,
    },
    scenarios: {
      nonLive: nonLiveSummary,
      currentLive: currentLiveSummary,
      optimizedLive: selectedSummary,
    },
    topCandidates,
    outputFiles: {
      summary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'head-to-head-summary.json')),
      candidates: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'candidate-summary.csv')),
      selectedTrades: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-live-trades.csv')),
    },
  }

  writeText(path.join(OUTPUT_DIR, 'head-to-head-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_DIR, 'candidate-summary.csv'), rowsToCsv(candidateRows, Object.keys(candidateRows[0])))
  writeText(path.join(OUTPUT_DIR, 'selected-live-trades.csv'), rowsToCsv(selectedRows, Object.keys(selectedRows[0])))

  console.log(
    [
      `winner=${summary.verdict.winner}`,
      `selected=${summary.selectedCandidate.candidateId}`,
      `eligible=${summary.selectedCandidate.eligible}`,
      `candidates=${summary.rowCounts.evaluatedLiveCandidates}`,
      `eligibleCandidates=${summary.rowCounts.eligibleLiveCandidates}`,
      `currentLiveHoldoutVsNonLive=${currentVsNonLive.holdout.returnDeltaPct}%`,
      `optimizedLiveHoldoutVsNonLive=${selectedVsNonLive.holdout.returnDeltaPct}%`,
      `optimizedLiveAllVsNonLive=${selectedVsNonLive.all.returnDeltaPct}%`,
      `summary=${path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'head-to-head-summary.json'))}`,
    ].join(' '),
  )
}

main()
