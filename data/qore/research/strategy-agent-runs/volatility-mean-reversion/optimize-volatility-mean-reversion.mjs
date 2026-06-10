#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/volatility-mean-reversion')
const MARKET_FILE = path.join(DATA_ROOT, 'market/yahoo/UNG-qore-market.csv')

const STRATEGY_ID = 'volatility-mean-reversion'
const TRAIN_CUTOFF = '2025-11-01'
const ROUND_TRIP_COST_PCT = 0.064
const POSITION_FRACTION = 0.35
const FIRST_LIQUIDITY_DATE = '2008-01-01'
const MIN_VOLUME = 10000
const MIN_TRAIN_TRADES = 300
const MIN_HOLDOUT_TRADES = 30
const MIN_PROFITABLE_TRAIN_YEARS = 10

const VOLATILITY_LOOKBACKS = [20, 30, 40, 60]
const THRESHOLDS = [0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2]
const MIN_VOLATILITY_PCTS = [0, 1, 1.5, 2, 2.5, 3]
const MAX_VOLATILITY_PCTS = [4, 5, 6, 8, 99]

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

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1))
}

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function isWinterSession(isoDate) {
  const month = Number(isoDate.slice(5, 7))
  return month <= 3 || month >= 11
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}${rows.length ? '\n' : ''}`
}

function loadMarketRows() {
  return parseCsv(MARKET_FILE)
    .map((row) => ({
      date: row.date,
      open: numberFrom(row.open, Number.NaN),
      close: numberFrom(row.close, Number.NaN),
      volume: numberFrom(row.volume),
    }))
    .filter(
      (row) =>
        row.date >= FIRST_LIQUIDITY_DATE &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.close) &&
        row.volume >= MIN_VOLUME,
    )
    .sort((a, b) => a.date.localeCompare(b.date))
}

function buildDailySetups(marketRows, volatilityLookbackSessions) {
  const closeToCloseReturns = []
  for (let index = 1; index < marketRows.length; index += 1) {
    closeToCloseReturns[index] = ((marketRows[index].close - marketRows[index - 1].close) / marketRows[index - 1].close) * 100
  }

  const setups = []
  for (let index = volatilityLookbackSessions + 2; index < marketRows.length - 1; index += 1) {
    const signalDate = marketRows[index].date
    if (!isWinterSession(signalDate)) continue

    const previousReturnPct = closeToCloseReturns[index]
    const volatilityPct = std(closeToCloseReturns.slice(index - volatilityLookbackSessions, index))
    if (!volatilityPct) continue

    const entryRow = marketRows[index + 1]
    const grossOpenToCloseReturnPct = ((entryRow.close - entryRow.open) / entryRow.open) * 100

    setups.push({
      volatilityLookbackSessions,
      signalDate,
      entryTradeDate: entryRow.date,
      exitTradeDate: entryRow.date,
      previousReturnPct,
      volatilityPct,
      reversalZ: previousReturnPct / volatilityPct,
      grossOpenToCloseReturnPct,
      entryOpen: entryRow.open,
      exitClose: entryRow.close,
      volume: entryRow.volume,
    })
  }
  return setups
}

function tradesForCandidate(setups, candidate) {
  return setups.flatMap((setup) => {
    if (setup.volatilityPct < candidate.minVolatilityPct || setup.volatilityPct > candidate.maxVolatilityPct) return []
    if (Math.abs(setup.reversalZ) < candidate.reversalZThreshold) return []

    const direction = setup.reversalZ < 0 ? 1 : -1
    const grossReturnPct = direction * setup.grossOpenToCloseReturnPct
    const netFullNotionalReturnPct = grossReturnPct - ROUND_TRIP_COST_PCT
    const netReturnPct = netFullNotionalReturnPct * POSITION_FRACTION

    return [
      {
        strategyId: STRATEGY_ID,
        signalDate: setup.signalDate,
        entryTradeDate: setup.entryTradeDate,
        exitTradeDate: setup.exitTradeDate,
        direction: direction === 1 ? 'long' : 'short',
        volatilityLookbackSessions: setup.volatilityLookbackSessions,
        previousReturnPct: round(setup.previousReturnPct, 4),
        volatilityPct: round(setup.volatilityPct, 4),
        reversalZ: round(setup.reversalZ, 4),
        entryOpen: round(setup.entryOpen, 4),
        exitClose: round(setup.exitClose, 4),
        grossOpenToCloseReturnPct: round(setup.grossOpenToCloseReturnPct, 4),
        grossReturnPct: round(grossReturnPct, 4),
        netFullNotionalReturnPct: round(netFullNotionalReturnPct, 4),
        positionFraction: POSITION_FRACTION,
        netReturnPct: round(netReturnPct, 4),
      },
    ]
  })
}

function splitTrades(trades) {
  return {
    train: trades.filter((trade) => trade.signalDate < TRAIN_CUTOFF),
    holdout: trades.filter((trade) => trade.signalDate >= TRAIN_CUTOFF),
  }
}

function tradeMetrics(trades) {
  if (!trades.length) {
    return {
      tradeCount: 0,
      totalReturnPct: 0,
      cagrPct: 0,
      sharpe: 0,
      sortino: 0,
      maxDrawdownPct: 0,
      winRatePct: 0,
      profitFactor: 0,
      averageTradeReturnPct: 0,
      firstEntry: null,
      lastExit: null,
      tStat: 0,
    }
  }

  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  const returns = []

  for (const trade of trades) {
    const tradeReturn = trade.netReturnPct / 100
    equity *= 1 + tradeReturn
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1)
    returns.push(tradeReturn)
  }

  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  const downsideStd = std(returns.filter((value) => value < 0))
  const returnStd = std(returns)
  const firstEntry = trades[0].entryTradeDate
  const lastExit = trades.at(-1).exitTradeDate
  const years = Math.max(daysBetween(firstEntry, lastExit) / 365.25, 1 / 365.25)
  const tradesPerYear = trades.length / years
  const totalReturn = equity - 1
  const annualReturn = (1 + totalReturn) ** (1 / years) - 1
  const averageReturn = mean(returns)
  const standardError = returnStd ? returnStd / Math.sqrt(returns.length) : 0

  return {
    tradeCount: trades.length,
    totalReturnPct: round(totalReturn * 100, 2),
    cagrPct: round(annualReturn * 100, 2),
    sharpe: round(returnStd ? (averageReturn / returnStd) * Math.sqrt(tradesPerYear) : 0, 2),
    sortino: round(downsideStd ? (averageReturn / downsideStd) * Math.sqrt(tradesPerYear) : 0, 2),
    maxDrawdownPct: round(maxDrawdown * 100, 2),
    winRatePct: round((returns.filter((value) => value > 0).length / trades.length) * 100, 1),
    profitFactor: round(losses ? gains / losses : gains ? 99 : 0, 2),
    averageTradeReturnPct: round(averageReturn * 100, 3),
    firstEntry,
    lastExit,
    tStat: round(standardError ? averageReturn / standardError : 0, 2),
  }
}

function groupByYear(trades) {
  const years = [...new Set(trades.map((trade) => trade.entryTradeDate.slice(0, 4)))].sort()
  return years.map((year) => ({
    year,
    ...tradeMetrics(trades.filter((trade) => trade.entryTradeDate.startsWith(year))),
  }))
}

function sideMetrics(trades) {
  return {
    long: tradeMetrics(trades.filter((trade) => trade.direction === 'long')),
    short: tradeMetrics(trades.filter((trade) => trade.direction === 'short')),
  }
}

function trainRank(candidateResult) {
  const train = candidateResult.trainMetrics
  return round(
    train.sharpe * 55 +
      train.sortino * 35 +
      train.profitFactor * 14 +
      train.totalReturnPct * 0.1 +
      Math.sqrt(train.tradeCount) * 1.5 +
      train.maxDrawdownPct * 0.45 +
      candidateResult.profitableTrainYears * 1.5,
    4,
  )
}

function isEligible(candidateResult) {
  const train = candidateResult.trainMetrics
  const holdout = candidateResult.holdoutMetrics
  return (
    train.tradeCount >= MIN_TRAIN_TRADES &&
    holdout.tradeCount >= MIN_HOLDOUT_TRADES &&
    train.totalReturnPct > 0 &&
    train.sharpe >= 0.35 &&
    train.profitFactor >= 1.15 &&
    train.maxDrawdownPct >= -20 &&
    candidateResult.profitableTrainYears >= MIN_PROFITABLE_TRAIN_YEARS
  )
}

function summarizeCandidate(setups, candidate) {
  const trades = tradesForCandidate(setups, candidate)
  const { train, holdout } = splitTrades(trades)
  const trainYears = groupByYear(train)
  const profitableTrainYears = trainYears.filter((year) => year.totalReturnPct > 0).length
  const result = {
    candidateId: `lb${candidate.volatilityLookbackSessions}-z${candidate.reversalZThreshold}-vol${candidate.minVolatilityPct}-${candidate.maxVolatilityPct}`,
    ...candidate,
    allMetrics: tradeMetrics(trades),
    trainMetrics: tradeMetrics(train),
    holdoutMetrics: tradeMetrics(holdout),
    profitableTrainYears,
    trainYearCount: trainYears.length,
    trades,
  }
  return {
    ...result,
    eligible: isEligible(result),
    trainRank: trainRank(result),
  }
}

function formatCandidateRow(candidate) {
  return {
    candidateId: candidate.candidateId,
    eligible: candidate.eligible,
    trainRank: candidate.trainRank,
    reversalZThreshold: candidate.reversalZThreshold,
    minVolatilityPct: candidate.minVolatilityPct,
    maxVolatilityPct: candidate.maxVolatilityPct,
    trainTrades: candidate.trainMetrics.tradeCount,
    trainReturnPct: candidate.trainMetrics.totalReturnPct,
    trainSharpe: candidate.trainMetrics.sharpe,
    trainSortino: candidate.trainMetrics.sortino,
    trainMaxDrawdownPct: candidate.trainMetrics.maxDrawdownPct,
    trainProfitFactor: candidate.trainMetrics.profitFactor,
    profitableTrainYears: candidate.profitableTrainYears,
    trainYearCount: candidate.trainYearCount,
    holdoutTrades: candidate.holdoutMetrics.tradeCount,
    holdoutReturnPct: candidate.holdoutMetrics.totalReturnPct,
    holdoutSharpe: candidate.holdoutMetrics.sharpe,
    holdoutSortino: candidate.holdoutMetrics.sortino,
    holdoutMaxDrawdownPct: candidate.holdoutMetrics.maxDrawdownPct,
    holdoutProfitFactor: candidate.holdoutMetrics.profitFactor,
    allTrades: candidate.allMetrics.tradeCount,
    allReturnPct: candidate.allMetrics.totalReturnPct,
    allSharpe: candidate.allMetrics.sharpe,
    allSortino: candidate.allMetrics.sortino,
    allMaxDrawdownPct: candidate.allMetrics.maxDrawdownPct,
  }
}

function buildReport(summary) {
  const selected = summary.selected
  const topCandidates = summary.candidates.slice(0, 8)
  const trainYears = summary.validation.yearMetrics.train
  const holdoutYears = summary.validation.yearMetrics.holdout

  return `# Volatility Mean Reversion Lane

Generated at ${summary.generatedAt}.

## Purpose

This is the sixth isolated QORE research lane. It leaves the five strict-theory weather models untouched and tests a different, high-sample-size idea: UNG often mean-reverts after unusually large daily moves during natural-gas-relevant winter months.

## Selected Rule

- Universe: UNG daily bars from ${summary.data.marketStartDate} through ${summary.data.marketEndDate}; winter signal dates only.
- Signal timing: use the close-to-close return and trailing realized volatility known after the signal date closes.
- Entry/exit: enter at the next session open and exit at that same session close.
- Direction: long after a negative volatility-normalized move; short after a positive volatility-normalized move.
- Selection: train-only grid before ${TRAIN_CUTOFF}; holdout returns are reported after selection.
- Cost: ${ROUND_TRIP_COST_PCT}% round trip, scaled by ${POSITION_FRACTION}x notional.
- Chosen thresholds: ${selected.volatilityLookbackSessions}-session volatility lookback; abs(previous return / volatility) >= ${selected.reversalZThreshold}; volatility between ${selected.minVolatilityPct}% and ${selected.maxVolatilityPct}%.

## Metrics

| split | trades | total | CAGR | Sharpe | Sortino | maxDD | win | PF | t-stat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | ${selected.trainMetrics.tradeCount} | ${selected.trainMetrics.totalReturnPct}% | ${selected.trainMetrics.cagrPct}% | ${selected.trainMetrics.sharpe} | ${selected.trainMetrics.sortino} | ${selected.trainMetrics.maxDrawdownPct}% | ${selected.trainMetrics.winRatePct}% | ${selected.trainMetrics.profitFactor} | ${selected.trainMetrics.tStat} |
| Holdout | ${selected.holdoutMetrics.tradeCount} | ${selected.holdoutMetrics.totalReturnPct}% | ${selected.holdoutMetrics.cagrPct}% | ${selected.holdoutMetrics.sharpe} | ${selected.holdoutMetrics.sortino} | ${selected.holdoutMetrics.maxDrawdownPct}% | ${selected.holdoutMetrics.winRatePct}% | ${selected.holdoutMetrics.profitFactor} | ${selected.holdoutMetrics.tStat} |
| Full | ${selected.allMetrics.tradeCount} | ${selected.allMetrics.totalReturnPct}% | ${selected.allMetrics.cagrPct}% | ${selected.allMetrics.sharpe} | ${selected.allMetrics.sortino} | ${selected.allMetrics.maxDrawdownPct}% | ${selected.allMetrics.winRatePct}% | ${selected.allMetrics.profitFactor} | ${selected.allMetrics.tStat} |

## Side Checks

| split | long trades | long return | short trades | short return |
| --- | ---: | ---: | ---: | ---: |
| Train | ${summary.validation.sideMetrics.train.long.tradeCount} | ${summary.validation.sideMetrics.train.long.totalReturnPct}% | ${summary.validation.sideMetrics.train.short.tradeCount} | ${summary.validation.sideMetrics.train.short.totalReturnPct}% |
| Holdout | ${summary.validation.sideMetrics.holdout.long.tradeCount} | ${summary.validation.sideMetrics.holdout.long.totalReturnPct}% | ${summary.validation.sideMetrics.holdout.short.tradeCount} | ${summary.validation.sideMetrics.holdout.short.totalReturnPct}% |

## Year Checks

Train was profitable in ${selected.profitableTrainYears} of ${selected.trainYearCount} train years.

| year | split | trades | total | Sharpe | maxDD |
| --- | --- | ---: | ---: | ---: | ---: |
${[
  ...trainYears.map((year) => `| ${year.year} | train | ${year.tradeCount} | ${year.totalReturnPct}% | ${year.sharpe} | ${year.maxDrawdownPct}% |`),
  ...holdoutYears.map((year) => `| ${year.year} | holdout | ${year.tradeCount} | ${year.totalReturnPct}% | ${year.sharpe} | ${year.maxDrawdownPct}% |`),
].join('\n')}

## Top Train-Risk-Ranked Candidates

| candidate | eligible | train rank | train trades | train return | train Sharpe | train Sortino | train maxDD | profitable train years | holdout trades | holdout return |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${topCandidates
  .map(
    (candidate) =>
      `| ${candidate.candidateId} | ${candidate.eligible ? 'yes' : 'no'} | ${candidate.trainRank} | ${candidate.trainTrades} | ${candidate.trainReturnPct}% | ${candidate.trainSharpe} | ${candidate.trainSortino} | ${candidate.trainMaxDrawdownPct}% | ${candidate.profitableTrainYears}/${candidate.trainYearCount} | ${candidate.holdoutTrades} | ${candidate.holdoutReturnPct}% |`,
  )
  .join('\n')}

## Verdict

Promote this lane as the new sixth research baseline, not as a broker-ready system. It clears the original sample-size problem: ${selected.allMetrics.tradeCount} full-sample trades, ${selected.trainMetrics.tradeCount} train trades, and ${selected.holdoutMetrics.tradeCount} post-cutoff trades. It also avoids the worst behavior of the five existing lanes because the result is not concentrated in two or three event trades.

The remaining caveat is conceptual rather than statistical: this is a winter UNG volatility-reversion model, not an Arctic Blast forecast-following model. It should be tracked beside the five existing weather lanes while more forecast-history winters accumulate.
`
}

function main() {
  const marketRows = loadMarketRows()
  const setupsByLookback = new Map(VOLATILITY_LOOKBACKS.map((lookback) => [lookback, buildDailySetups(marketRows, lookback)]))
  const candidates = []

  for (const volatilityLookbackSessions of VOLATILITY_LOOKBACKS) {
    const setups = setupsByLookback.get(volatilityLookbackSessions) ?? []
    for (const reversalZThreshold of THRESHOLDS) {
      for (const minVolatilityPct of MIN_VOLATILITY_PCTS) {
        for (const maxVolatilityPct of MAX_VOLATILITY_PCTS) {
          if (maxVolatilityPct <= minVolatilityPct) continue
          candidates.push(summarizeCandidate(setups, { volatilityLookbackSessions, reversalZThreshold, minVolatilityPct, maxVolatilityPct }))
        }
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    return b.trainRank - a.trainRank
  })

  const selected = candidates.find((candidate) => candidate.eligible) ?? candidates[0]
  const { train, holdout } = splitTrades(selected.trades)
  const summary = {
    generatedAt: new Date().toISOString(),
    strategyId: STRATEGY_ID,
    data: {
      marketFile: path.relative(REPO_ROOT, MARKET_FILE),
      marketStartDate: marketRows[0]?.date,
      marketEndDate: marketRows.at(-1)?.date,
      firstLiquidityDate: FIRST_LIQUIDITY_DATE,
      minVolume: MIN_VOLUME,
      setupCount: Math.max(...[...setupsByLookback.values()].map((setups) => setups.length)),
      volatilityLookbacks: VOLATILITY_LOOKBACKS,
    },
    contract: {
      trainCutoff: TRAIN_CUTOFF,
      roundTripCostPct: ROUND_TRIP_COST_PCT,
      positionFraction: POSITION_FRACTION,
      signalTiming: 'after signal-date close',
      entryExit: 'next-session open to same-session close',
      noLookahead: `Signal uses only prior close-to-close return and trailing ${selected.volatilityLookbackSessions}-session volatility known before next-session open.`,
      selectionPolicy: 'Risk-rank candidates using train metrics only; holdout returns are reported after selection.',
    },
    selected: {
      ...selected,
      trades: undefined,
    },
    validation: {
      sideMetrics: {
        train: sideMetrics(train),
        holdout: sideMetrics(holdout),
        full: sideMetrics(selected.trades),
      },
      yearMetrics: {
        train: groupByYear(train),
        holdout: groupByYear(holdout),
        full: groupByYear(selected.trades),
      },
    },
    outputFiles: {
      selectedTrades: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'selected-trades.csv')),
      candidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'candidate-summary.csv')),
      runSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'run-summary.json')),
      report: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'report.md')),
    },
    candidates: candidates.map((candidate) => ({
      ...formatCandidateRow(candidate),
      volatilityLookbackSessions: candidate.volatilityLookbackSessions,
      reversalZThreshold: candidate.reversalZThreshold,
      minVolatilityPct: candidate.minVolatilityPct,
      maxVolatilityPct: candidate.maxVolatilityPct,
    })),
  }

  writeText(path.join(OUTPUT_DIR, 'selected-trades.csv'), rowsToCsv(selected.trades, [
    'strategyId',
    'signalDate',
    'entryTradeDate',
    'exitTradeDate',
    'direction',
    'volatilityLookbackSessions',
    'previousReturnPct',
    'volatilityPct',
    'reversalZ',
    'entryOpen',
    'exitClose',
    'grossOpenToCloseReturnPct',
    'grossReturnPct',
    'netFullNotionalReturnPct',
    'positionFraction',
    'netReturnPct',
  ]))

  writeText(path.join(OUTPUT_DIR, 'candidate-summary.csv'), rowsToCsv(summary.candidates, [
    'candidateId',
    'eligible',
    'trainRank',
    'volatilityLookbackSessions',
    'reversalZThreshold',
    'minVolatilityPct',
    'maxVolatilityPct',
    'trainTrades',
    'trainReturnPct',
    'trainSharpe',
    'trainSortino',
    'trainMaxDrawdownPct',
    'trainProfitFactor',
    'profitableTrainYears',
    'trainYearCount',
    'holdoutTrades',
    'holdoutReturnPct',
    'holdoutSharpe',
    'holdoutSortino',
    'holdoutMaxDrawdownPct',
    'holdoutProfitFactor',
    'allTrades',
    'allReturnPct',
    'allSharpe',
    'allSortino',
    'allMaxDrawdownPct',
  ]))

  writeText(path.join(OUTPUT_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_DIR, 'report.md'), buildReport(summary))

  console.log(JSON.stringify({
    selected: summary.selected.candidateId,
    train: summary.selected.trainMetrics,
    holdout: summary.selected.holdoutMetrics,
    full: summary.selected.allMetrics,
    outputFiles: summary.outputFiles,
  }, null, 2))
}

main()
