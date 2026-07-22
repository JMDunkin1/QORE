#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Papa from 'papaparse'
import {
  applyExecutionStep,
  createExecutionState,
  executionAuditFields,
  loadExecutionCalendar,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
} from './lib/qore-research-execution.mjs'
import {
  COMPONENT_ARTIFACT_SCHEMA_VERSION,
  validateComponentArtifact,
} from './lib/qore-component-artifact.mjs'
import {
  ALL_YEAR_DISPLAY_CURVE_FILE,
  ALL_YEAR_DISPLAY_CURVE_HEADERS,
  ALL_YEAR_SELECTED_TRADES_FILE,
  buildAllYearOutputArtifactBindings,
} from './lib/qore-all-year-output-artifacts.mjs'
import {
  LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION,
  canonicalComponentLiveContractFromSummaries,
  executableLiveComponentContractDigestSha256,
  liveComponentContractDigestSha256,
} from './lib/qore-live-contract.mjs'
import {
  LIVE_TARGET_PARITY_POLICY,
  evaluateVersionedLiveTargetParity,
} from './lib/qore-live-target-parity.mjs'
import { ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION } from './lib/qore-live-strategy-artifact.mjs'
import { downsideDeviation } from './lib/qore-research-statistics.mjs'
import {
  brokerExecutionProfileTieOutFailures,
  loadReviewedBrokerExecutionProfile,
} from './lib/qore-broker-execution-profile.mjs'
import {
  ALL_YEAR_SELECTION_CONTRACT,
  allYearStrategyContractDigestSha256,
  loadValidationIntegrityManifest,
} from './lib/qore-validation-integrity.mjs'

const REPO_ROOT = process.cwd()
const DATA_ROOT = path.join(REPO_ROOT, 'data/qore')
const OUTPUT_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/ngas-all-year-beta')
const SUMMER_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/ngas-summer-alpha')
const WINTER_DIR = path.join(DATA_ROOT, 'research/strategy-agent-runs/ngas-winter-alpha')
const SUMMER_SUMMARY_FILE = path.join(SUMMER_DIR, 'run-summary.json')
const WINTER_SUMMARY_FILE = path.join(WINTER_DIR, 'run-summary.json')
const SUMMER_TRADES_FILE = path.join(SUMMER_DIR, 'selected-trades.csv')
const WINTER_TRADES_FILE = path.join(WINTER_DIR, 'selected-trades.csv')
const OVERNIGHT_POLICY_FILE = path.join(REPO_ROOT, 'config/qore-overnight-risk-policy.json')

const STRATEGY_ID = 'ngas-all-year-beta'
const STRATEGY_NAME = 'NGAS All-Year Beta'
const INITIAL_CAPITAL = 100000
const TRADING_DAYS = 252
const BOOTSTRAP_ITERATIONS = 20000
const BLOCK_LENGTH = 10
const MAX_DRAWDOWN_PROMOTION_FLOOR_PCT = -20
const EXECUTION_CONTRACT = loadResearchExecutionContract(REPO_ROOT)
const BROKER_EXECUTION = loadReviewedBrokerExecutionProfile(REPO_ROOT)
const VALIDATION_INTEGRITY = loadValidationIntegrityManifest(REPO_ROOT)
const OVERNIGHT_POLICY_CONTRACT = JSON.parse(fs.readFileSync(OVERNIGHT_POLICY_FILE, 'utf8'))
if (
  OVERNIGHT_POLICY_CONTRACT?.schemaVersion !== 1 ||
  !OVERNIGHT_POLICY_CONTRACT.contractId ||
  OVERNIGHT_POLICY_CONTRACT.deployedPolicyId !== 'carry-100' ||
  OVERNIGHT_POLICY_CONTRACT.selection?.selectionUsedHoldout !== false
) {
  throw new Error('The all-year artifact only supports the reviewed carry-100 overnight policy.')
}
const OVERNIGHT_POLICY_DIGEST = crypto
  .createHash('sha256')
  .update(fs.readFileSync(OVERNIGHT_POLICY_FILE))
  .digest('hex')
const COMPONENT_SIGNAL_INSTRUMENTS = {
  'ngas-summer-alpha': 'NG=F',
  'ngas-winter-alpha': 'UNG',
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
}

function parseCsvWithHeaders(filePath) {
  const raw = fs.readFileSync(filePath)
  const parsed = Papa.parse(raw.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })
  return {
    raw,
    rows: parsed.data,
    headers: parsed.meta.fields ?? [],
  }
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

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct)))
  return sorted[index]
}

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = Array.isArray(value) ? value.join('|') : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n') + '\n'
}

function unique(values) {
  return [...new Set(values)]
}

function thesisKindsFromCsv(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split('|')
  return values.map((item) => String(item).trim()).filter(Boolean)
}

function priorCalendarDate(isoDate) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
}

function tradePosition(row) {
  const position = numberFrom(row.ungPosition, Number.NaN)
  if (Number.isFinite(position)) return position
  if (row.thesisKind === 'index-fallback') return 0
  return row.direction === 'short' ? -1 : 1
}

function isMaterialStrategyRow(row) {
  const indexFraction = numberFrom(row.indexFraction, Math.max(0, 1 - Math.abs(tradePosition(row))))
  const investedIndexFraction = numberFrom(row.investedIndexFraction, indexFraction)
  return (
    row.thesisKind !== 'index-fallback' ||
    Math.abs(tradePosition(row)) > 0.000001 ||
    Math.abs(investedIndexFraction - indexFraction) > 0.000001
  )
}

function byEntryDate(rows, label) {
  const byDate = new Map()
  for (const row of rows) {
    if (byDate.has(row.entryTradeDate)) {
      throw new Error(`${label} has multiple rows for ${row.entryTradeDate}; ${STRATEGY_NAME} expects one daily row per source lane.`)
    }
    byDate.set(row.entryTradeDate, row)
  }
  return byDate
}

function componentVariantFor(strategyId) {
  if (strategyId === 'ngas-summer-alpha') return 'summer-alpha'
  if (strategyId === 'ngas-winter-alpha') return 'winter-alpha'
  return ''
}

function researchInstrumentFor(row) {
  if (row.thesisKind === 'index-fallback' && Math.abs(tradePosition(row)) <= 0.000001) {
    return 'US-INDEX-BASKET'
  }
  return 'UNG'
}

function signalInstrumentFor(componentStrategyId) {
  return COMPONENT_SIGNAL_INSTRUMENTS[componentStrategyId] ?? 'unknown'
}

function investedIndexFractionFor(row) {
  const position = tradePosition(row)
  const maximumIndexFraction = Math.max(0, 1 - Math.abs(position))
  const indexFraction = numberFrom(row.indexFraction, maximumIndexFraction)
  return Math.min(numberFrom(row.investedIndexFraction, indexFraction), maximumIndexFraction)
}

function componentSplitNameForTrade(row, contractsByStrategyId) {
  const contract = contractsByStrategyId.get(row.componentStrategyId)
  if (!contract) return 'all'
  if (row.entryTradeDate >= contract.holdoutStart) return 'holdout'
  if (row.entryTradeDate > contract.trainEnd && row.entryTradeDate <= contract.validationEnd) return 'validation'
  return 'train'
}

function allYearSplitContract(componentSummaries) {
  const trainEnd = componentSummaries.map((summary) => summary.contract.trainEnd).sort()[0]
  const componentHoldoutStarts = componentSummaries.map((summary) => summary.contract.holdoutStart).sort()
  const selectionEnd = priorCalendarDate(componentHoldoutStarts[0])
  const holdoutStart = componentHoldoutStarts.at(-1)
  const validationEnd = priorCalendarDate(holdoutStart)
  if (
    !trainEnd ||
    !selectionEnd ||
    !holdoutStart ||
    !(trainEnd < selectionEnd && selectionEnd <= validationEnd && validationEnd < holdoutStart)
  ) {
    throw new Error('Component split dates do not define a valid conservative all-year calendar split.')
  }
  return { trainEnd, selectionEnd, validationEnd, holdoutStart }
}

function calendarSplitNameForDate(entryTradeDate, splitContract) {
  if (entryTradeDate >= splitContract.holdoutStart) return 'holdout'
  if (entryTradeDate > splitContract.trainEnd) return 'validation'
  return 'train'
}

function createCompositeRows(summerRows, winterRows, contractsByStrategyId, splitContract, executionByDate, scenarioId = EXECUTION_CONTRACT.selectionScenarioId) {
  const summerByDate = byEntryDate(summerRows, 'NGAS Summer Alpha')
  const winterByDate = byEntryDate(winterRows, 'NGAS Winter Alpha')
  const entryDates = unique([...summerByDate.keys(), ...winterByDate.keys()]).sort()
  const rows = []

  for (const entryDate of entryDates) {
    const summerRow = summerByDate.get(entryDate)
    const winterRow = winterByDate.get(entryDate)
    const summerIsMaterial = summerRow ? isMaterialStrategyRow(summerRow) : false
    const winterIsMaterial = winterRow ? isMaterialStrategyRow(winterRow) : false

    if (summerRow && winterRow && summerIsMaterial && winterIsMaterial) {
      throw new Error(`${STRATEGY_NAME} conflict on ${entryDate}: both summer and winter lanes have material rows.`)
    }
    if (
      summerRow &&
      winterRow &&
      !summerIsMaterial &&
      !winterIsMaterial &&
      (
        Math.abs(tradePosition(summerRow) - tradePosition(winterRow)) > 0.000001 ||
        Math.abs(investedIndexFractionFor(summerRow) - investedIndexFractionFor(winterRow)) > 0.000001
      )
    ) {
      throw new Error(`${STRATEGY_NAME} fallback target mismatch on ${entryDate}; refusing to pick between different idle allocations.`)
    }

    const sourceRow = summerIsMaterial ? summerRow : winterIsMaterial ? winterRow : summerRow ?? winterRow
    if (!sourceRow) throw new Error(`${STRATEGY_NAME} missing source row for ${entryDate}.`)

    const componentStrategyId = sourceRow.strategyId
    const materialRow = isMaterialStrategyRow(sourceRow)
    const row = {
      ...sourceRow,
      strategyId: STRATEGY_ID,
      variant: 'all-year-beta',
      componentStrategyId,
      componentVariant: componentVariantFor(componentStrategyId),
      researchInstrument: researchInstrumentFor(sourceRow),
      signalInstrument: signalInstrumentFor(componentStrategyId),
      componentGrossReturnPct: numberFrom(sourceRow.grossReturnPct),
      componentTradingCostPct: numberFrom(sourceRow.tradingCostPct),
      componentNetReturnPct: numberFrom(sourceRow.netReturnPct),
      materialRow,
    }
    row.componentSplit = componentSplitNameForTrade(row, contractsByStrategyId)
    row.split = calendarSplitNameForDate(row.entryTradeDate, splitContract)
    rows.push(row)
  }

  let equity = INITIAL_CAPITAL
  let peak = INITIAL_CAPITAL
  let executionState = createExecutionState(EXECUTION_CONTRACT)
  let priorCloseThesisKind = 'index-fallback'
  let priorCloseComponentThesisKinds = []
  for (const row of rows) {
    const executionDay = executionByDate.get(row.entryTradeDate)
    if (!executionDay) throw new Error(`${STRATEGY_NAME} is missing UNG/VOO/QQQM execution data for ${row.entryTradeDate}.`)
    const gasPosition = tradePosition(row)
    const investedIndexFraction = investedIndexFractionFor(row)
    row.investedIndexFraction = round(investedIndexFraction, 4)
    const targetWeights = targetWeightsForAllocation(EXECUTION_CONTRACT, { gasPosition, investedIndexFraction })
    const execution = applyExecutionStep({
      state: executionState,
      day: executionDay,
      targetWeights,
      contract: EXECUTION_CONTRACT,
      scenarioId,
    })
    executionState = execution.state
    row.ungReturnPct = round(executionDay.symbols.UNG.closeToCloseReturnPct, 4)
    row.indexReturnPct = round(executionDay.indexReturnPct, 4)
    row.grossReturnPct = round(execution.grossReturnPct, 4)
    row.tradingCostPct = round(execution.tradingCostPct + execution.borrowCostPct, 4)
    row.netReturnPct = round(execution.netReturnPct, 4)
    row.activeReturnPct = round(execution.netReturnPct - executionDay.indexReturnPct, 4)
    row.priorCloseThesisKind = priorCloseThesisKind
    row.priorCloseComponentThesisKinds = priorCloseComponentThesisKinds
    Object.assign(row, executionAuditFields(execution, executionDay, EXECUTION_CONTRACT))
    equity = Math.max(1, equity * (1 + numberFrom(row.netReturnPct) / 100))
    peak = Math.max(peak, equity)
    row.equity = round(equity, 2)
    row.equityPct = round((equity / INITIAL_CAPITAL - 1) * 100, 4)
    row.drawdownPct = round(((equity - peak) / peak) * 100, 4)
    priorCloseThesisKind = row.thesisKind
    priorCloseComponentThesisKinds = thesisKindsFromCsv(row.componentThesisKinds)
  }

  return rows
}

function profitFactor(returns) {
  const grossWins = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const grossLosses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  if (!grossLosses) return grossWins ? Number.POSITIVE_INFINITY : 0
  return grossWins / grossLosses
}

function metricsFromReturns(rows, returnKey = 'netReturnPct') {
  const orderedRows = [...rows].sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate) || a.targetTradeDate.localeCompare(b.targetTradeDate))
  const returns = orderedRows.map((row) => numberFrom(row[returnKey]) / 100)
  const firstEntry = orderedRows[0]?.entryTradeDate ?? ''
  const lastExit = orderedRows.at(-1)?.targetTradeDate ?? orderedRows.at(-1)?.exitTradeDate ?? orderedRows.at(-1)?.entryTradeDate ?? firstEntry
  const years = firstEntry && lastExit ? daysBetween(firstEntry, lastExit) / 365.25 : 1
  let equity = 1
  let peak = 1
  let maxDrawdownPct = 0

  for (const dailyReturn of returns) {
    equity = Math.max(0.000001, equity * (1 + dailyReturn))
    peak = Math.max(peak, equity)
    maxDrawdownPct = Math.min(maxDrawdownPct, ((equity - peak) / peak) * 100)
  }

  const totalReturnPct = round((equity - 1) * 100, 2)
  const cagrPct = round((equity ** (1 / Math.max(years, 1 / 365.25)) - 1) * 100, 2)
  const annualVol = std(returns) * Math.sqrt(TRADING_DAYS)
  const downsideVol = downsideDeviation(returns) * Math.sqrt(TRADING_DAYS)
  const averageDailyReturn = mean(returns)
  const var95 = percentile(returns, 0.05)
  const cvarSlice = returns.filter((value) => value <= var95)
  const activeTradeCount = returnKey === 'netReturnPct' ? orderedRows.filter((row) => row.thesisKind !== 'index-fallback').length : 0

  return {
    totalReturnPct,
    cagrPct,
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (averageDailyReturn * TRADING_DAYS) / annualVol : 0, 2),
    sortino: round(downsideVol ? (averageDailyReturn * TRADING_DAYS) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    calmar: round(Math.abs(maxDrawdownPct) ? cagrPct / Math.abs(maxDrawdownPct) : 0, 2),
    winRatePct: round(returns.length ? (returns.filter((value) => value > 0).length / returns.length) * 100 : 0, 1),
    profitFactor: round(profitFactor(returns), 2),
    tradeCount: activeTradeCount,
    exposurePct: returnKey === 'netReturnPct' ? round(mean(orderedRows.map((row) => Math.abs(tradePosition(row)))) * 100, 1) : 0,
    turnover: returnKey === 'netReturnPct' ? round(orderedRows.reduce((sum, row) => sum + numberFrom(row.totalTurnover), 0), 2) : 0,
    gasTurnover: returnKey === 'netReturnPct' ? round(orderedRows.reduce((sum, row) => sum + numberFrom(row.gasTurnover), 0), 2) : 0,
    indexTurnover: returnKey === 'netReturnPct' ? round(orderedRows.reduce((sum, row) => sum + numberFrom(row.indexTurnover), 0), 2) : 0,
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(averageDailyReturn * 100, 3),
    firstEntry,
    lastExit,
    averageHoldDays: 1,
    tStat: round(std(returns) ? (averageDailyReturn / std(returns)) * Math.sqrt(returns.length) : 0, 2),
  }
}

function compoundReturnPct(rows, returnKey) {
  const total = rows.reduce((equity, row) => equity * (1 + numberFrom(row[returnKey]) / 100), 1)
  return round((total - 1) * 100, 2)
}

function annualizedCompoundReturnPct(rows, returnKey) {
  const orderedRows = [...rows].sort((a, b) => a.entryTradeDate.localeCompare(b.entryTradeDate) || a.targetTradeDate.localeCompare(b.targetTradeDate))
  const total = orderedRows.reduce((equity, row) => equity * (1 + numberFrom(row[returnKey]) / 100), 1)
  const firstEntry = orderedRows[0]?.entryTradeDate ?? ''
  const lastExit = orderedRows.at(-1)?.targetTradeDate ?? orderedRows.at(-1)?.exitTradeDate ?? orderedRows.at(-1)?.entryTradeDate ?? firstEntry
  const years = firstEntry && lastExit ? daysBetween(firstEntry, lastExit) / 365.25 : 1
  return round((total ** (1 / Math.max(years, 1 / 365.25)) - 1) * 100, 2)
}

function splitRows(rows) {
  return {
    train: rows.filter((row) => row.split === 'train'),
    validation: rows.filter((row) => row.split === 'validation'),
    holdout: rows.filter((row) => row.split === 'holdout'),
    all: rows,
  }
}

function chronologicalSelectionRows(rows, splitContract) {
  const firstReportingOnlyIndex = rows.findIndex((row) => row.entryTradeDate > splitContract.selectionEnd)
  const selectionRows = firstReportingOnlyIndex < 0 ? rows : rows.slice(0, firstReportingOnlyIndex)
  const reportingOnlyRows = firstReportingOnlyIndex < 0 ? [] : rows.slice(firstReportingOnlyIndex)
  if (selectionRows.some((row) => row.componentSplit === 'holdout')) {
    throw new Error('All-year eligibility contains a component holdout row.')
  }
  if (
    selectionRows.some((row) => row.entryTradeDate > splitContract.selectionEnd) ||
    reportingOnlyRows.some((row) => row.entryTradeDate <= splitContract.selectionEnd)
  ) {
    throw new Error('All-year eligibility is not a chronological prefix ending at the component-safe selection boundary.')
  }
  return selectionRows
}

function splitEdges(splits) {
  return Object.fromEntries(
    Object.entries(splits).map(([split, rows]) => [
      split,
      round(compoundReturnPct(rows, 'netReturnPct') - compoundReturnPct(rows, 'indexReturnPct'), 2),
    ]),
  )
}

function splitAnnualEdges(splits) {
  return Object.fromEntries(
    Object.entries(splits).map(([split, rows]) => [
      split,
      round(annualizedCompoundReturnPct(rows, 'netReturnPct') - annualizedCompoundReturnPct(rows, 'indexReturnPct'), 2),
    ]),
  )
}

function createSeededRandom(seed = 1729) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function blockBootstrapMeans(values, { seed = 1729 } = {}) {
  const random = createSeededRandom(seed)
  const means = []

  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    const sample = []
    while (sample.length < values.length) {
      const start = Math.floor(random() * values.length)
      for (let offset = 0; offset < BLOCK_LENGTH && sample.length < values.length; offset += 1) {
        sample.push(values[(start + offset) % values.length])
      }
    }
    means.push(mean(sample))
  }

  return means
}

function pValueFromNullMeans(nullMeans, observed) {
  const exceedances = nullMeans.filter((value) => value >= observed).length
  return round((exceedances + 1) / (BOOTSTRAP_ITERATIONS + 1), 5)
}

function pctSummary(values) {
  return {
    p05: round(percentile(values, 0.05) * 100, 5),
    p50: round(percentile(values, 0.5) * 100, 5),
    p95: round(percentile(values, 0.95) * 100, 5),
  }
}

function blockBootstrapRealityCheck(rows, { seed = 1987 } = {}) {
  const activeReturns = rows.map((row) => (numberFrom(row.netReturnPct) - numberFrom(row.indexReturnPct)) / 100)
  const inputDateDigest = crypto
    .createHash('sha256')
    .update(rows.map((row) => row.entryTradeDate).join('\n'))
    .digest('hex')
  const observed = mean(activeReturns)
  const centered = activeReturns.map((value) => value - observed)
  const meanBootstrapMeans = blockBootstrapMeans(activeReturns, { seed })
  const nullBootstrapMeans = blockBootstrapMeans(centered, { seed })
  const singleCandidatePValue = observed > 0 ? pValueFromNullMeans(nullBootstrapMeans, observed) : 1

  return {
    method: 'standalone all-year centered circular block bootstrap',
    comparison: 'all-year beta net daily return minus US index basket daily return',
    alternative: 'greater-than-zero daily active edge',
    observedAverageDailyEdgePct: round(observed * 100, 5),
    observedAnnualizedEdgePct: round(observed * TRADING_DAYS * 100, 2),
    pValue: singleCandidatePValue,
    singleCandidatePValue,
    selectionAdjustedPValue: null,
    candidateFamilySize: 1,
    bestObservedCandidateId: STRATEGY_ID,
    bestObservedAverageDailyEdgePct: round(observed * 100, 5),
    dailyActiveVolPct: round(std(activeReturns) * 100, 4),
    standardErrorDailyEdgePct: round(std(activeReturns) / Math.sqrt(Math.max(activeReturns.length, 1)) * 100, 5),
    meanConfidenceIntervalDailyEdgePct: pctSummary(meanBootstrapMeans),
    nullConfidenceIntervalDailyEdgePct: pctSummary(nullBootstrapMeans),
    nullMaxMeanDailyEdgePct: null,
    sampleCount: activeReturns.length,
    sampleStartDate: rows[0]?.entryTradeDate ?? '',
    sampleEndDate: rows.at(-1)?.entryTradeDate ?? '',
    inputDateDigest,
    activeOverlayDays: rows.filter((row) => row.thesisKind !== 'index-fallback').length,
    materialRows: rows.filter(isMaterialStrategyRow).length,
    minimumResolvablePValue: round(1 / (BOOTSTRAP_ITERATIONS + 1), 5),
    iterations: BOOTSTRAP_ITERATIONS,
    blockLength: BLOCK_LENGTH,
  }
}

function sourceUniverseFor(rows) {
  return unique(rows.map((row) => row.sourceId)).sort()
}

function displayCurveRows(rows) {
  let benchmarkEquity = INITIAL_CAPITAL
  return rows.map((row, chartIndex) => {
    benchmarkEquity *= 1 + numberFrom(row.indexReturnPct) / 100
    const position = tradePosition(row)
    return {
      chartIndex,
      date: row.entryTradeDate || row.targetTradeDate,
      equityPct: row.equityPct,
      benchmarkPct: round((benchmarkEquity / INITIAL_CAPITAL - 1) * 100, 4),
      drawdownPct: row.drawdownPct,
      activeReturnPct: row.activeReturnPct,
      position,
      signal: round(numberFrom(row.confidence) * Math.sign(position), 4),
      netReturnPct: row.netReturnPct,
      priorCloseReturnContributionPct: row.priorCloseReturnContributionPct,
      currentSessionReturnContributionPct: row.currentSessionReturnContributionPct,
      indexReturnPct: row.indexReturnPct,
      split: row.split,
      thesisKind: row.thesisKind,
      priorCloseThesisKind: row.priorCloseThesisKind,
      equityUsd: row.equity,
      component: row.componentVariant,
      researchInstrument: row.researchInstrument,
      signalInstrument: row.signalInstrument,
      direction: row.direction,
      sourceId: row.sourceId,
      confidence: row.confidence,
    }
  })
}

function formatCandidateRow(selected, summaryMetrics, eligible, selectionEvaluation) {
  const selectionMetrics = selectionEvaluation.metrics
  const selectionIndexMetrics = selectionEvaluation.indexMetrics
  const selectionEdges = selectionEvaluation.edges
  return {
    candidateId: STRATEGY_ID,
    eligible,
    trainValidationRank: round(selectionEdges.train + selectionEdges.validation, 4),
    architectureId: 'summer-winter-composite-artifact',
    sourceSetId: 'ngas-summer-alpha+ngas-winter-alpha',
    sourceWeightMode: 'component-selected',
    sizingMode: 'component-selected',
    rowSelectionPolicy: 'material-summer-else-material-winter-else-shared-fallback',
    selectionUsedHoldout: false,
    componentStrategyIds: selected.componentStrategyIds.join('|'),
    gasOverlayRows: summaryMetrics.gasOverlayRows,
    materialRows: summaryMetrics.materialRows,
    indexFallbackRows: summaryMetrics.indexFallbackRows,
    summerGasRows: selected.componentTradeCounts.summer,
    winterGasRows: selected.componentTradeCounts.winter,
    trainReturnPct: selectionMetrics.train.totalReturnPct,
    trainIndexReturnPct: selectionIndexMetrics.train.totalReturnPct,
    trainEdgePct: selectionEdges.train,
    trainSharpe: selectionMetrics.train.sharpe,
    trainMaxDrawdownPct: selectionMetrics.train.maxDrawdownPct,
    validationReturnPct: selectionMetrics.validation.totalReturnPct,
    validationIndexReturnPct: selectionIndexMetrics.validation.totalReturnPct,
    validationEdgePct: selectionEdges.validation,
    validationSharpe: selectionMetrics.validation.sharpe,
    validationMaxDrawdownPct: selectionMetrics.validation.maxDrawdownPct,
    holdoutReturnPct: selected.holdoutMetrics.totalReturnPct,
    holdoutIndexReturnPct: selected.indexMetrics.holdout.totalReturnPct,
    holdoutEdgePct: selected.splitEdges.holdout,
    holdoutSharpe: selected.holdoutMetrics.sharpe,
    holdoutMaxDrawdownPct: selected.holdoutMetrics.maxDrawdownPct,
    allReturnPct: selected.allMetrics.totalReturnPct,
    allIndexReturnPct: selected.indexMetrics.all.totalReturnPct,
    allEdgePct: selected.splitEdges.all,
    allSharpe: selected.allMetrics.sharpe,
    allMaxDrawdownPct: selected.allMetrics.maxDrawdownPct,
  }
}

function buildReport(summary) {
  const selected = summary.selected
  return `# ${STRATEGY_NAME}

Generated at ${summary.generatedAt}.

## Purpose

${STRATEGY_NAME} is the checked-in all-year artifact for the existing NGAS Summer Alpha and NGAS Winter Alpha row selector. It does not add a new threshold, entry rule, or optimization layer: each date uses the exact material Summer row, else the exact material Winter row, else the shared US index basket fallback row.

## Selected Candidate

- Architecture: Summer/Winter composite artifact.
- Source ledgers: ${selected.componentStrategyIds.join(' + ')}.
- Signal and P&L instruments: Summer keeps NG=F as a signal input, but every gas-sleeve return and both seasonal validation paths use UNG. Idle rows use the VOO/QQQM fallback.
- Execution: prior-close holdings earn the overnight move; current UNG/VOO/QQQM targets become effective at the split-adjusted session open under ${summary.contract.execution.contractId}.
- Overnight policy: ${summary.contract.overnightRisk.deployedPolicyId}. The separately versioned audit reports a train/validation recommendation, but close-side execution remains research-only; prior-close holdings therefore stay in place until the next causal open execution.
- Row policy: ${selected.rowSelectionPolicy}
- Material row definition: ${selected.materialRowDefinition}
- Selection: no independent all-year parameter search; the component ledgers remain selected by their own train/validation contracts.
- P-values: a direct component-safe centered circular block bootstrap through ${summary.contract.selectionEnd} controls eligibility; a separate full-calendar bootstrap is report-only. Neither uses Fisher-combined component p-values.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | ${selected.trainMetrics.tradeCount} | ${selected.trainMetrics.totalReturnPct}% | ${selected.indexMetrics.train.totalReturnPct}% | ${selected.splitEdges.train}% | ${selected.trainMetrics.cagrPct}% | ${selected.trainMetrics.sharpe} | ${selected.trainMetrics.sortino} | ${selected.trainMetrics.maxDrawdownPct}% | ${selected.trainMetrics.exposurePct}% |
| Validation | ${selected.validationMetrics.tradeCount} | ${selected.validationMetrics.totalReturnPct}% | ${selected.indexMetrics.validation.totalReturnPct}% | ${selected.splitEdges.validation}% | ${selected.validationMetrics.cagrPct}% | ${selected.validationMetrics.sharpe} | ${selected.validationMetrics.sortino} | ${selected.validationMetrics.maxDrawdownPct}% | ${selected.validationMetrics.exposurePct}% |
| Holdout | ${selected.holdoutMetrics.tradeCount} | ${selected.holdoutMetrics.totalReturnPct}% | ${selected.indexMetrics.holdout.totalReturnPct}% | ${selected.splitEdges.holdout}% | ${selected.holdoutMetrics.cagrPct}% | ${selected.holdoutMetrics.sharpe} | ${selected.holdoutMetrics.sortino} | ${selected.holdoutMetrics.maxDrawdownPct}% | ${selected.holdoutMetrics.exposurePct}% |
| Full | ${selected.allMetrics.tradeCount} | ${selected.allMetrics.totalReturnPct}% | ${selected.indexMetrics.all.totalReturnPct}% | ${selected.splitEdges.all}% | ${selected.allMetrics.cagrPct}% | ${selected.allMetrics.sharpe} | ${selected.allMetrics.sortino} | ${selected.allMetrics.maxDrawdownPct}% | ${selected.allMetrics.exposurePct}% |

## Component Rows

| component | gas-overlay rows |
| --- | ---: |
| NGAS Summer Alpha | ${selected.componentTradeCounts.summer} |
| NGAS Winter Alpha | ${selected.componentTradeCounts.winter} |
| Index fallback | ${selected.indexFallbackRows} |
| Material target rows | ${selected.materialRows} |

## Anti-Overfit Check

- Candidate count: ${summary.search.candidateCount}.
- Eligible candidates: ${summary.search.eligibleCandidateCount}.
- Return-based promotion gates use only rows through ${summary.contract.selectionEnd}: positive train edge ${summary.validation.promotionGates.positiveTrainEdge ? 'pass' : 'fail'}; positive validation edge ${summary.validation.promotionGates.positiveValidationEdge ? 'pass' : 'fail'}; component-safe bootstrap p-value below 0.05 ${summary.validation.promotionGates.preHoldoutBootstrapSignificance ? 'pass' : 'fail'}; train and validation max drawdowns above ${summary.contract.maxDrawdownPromotionFloorPct}% ${summary.validation.promotionGates.trainMaxDrawdown && summary.validation.promotionGates.validationMaxDrawdown ? 'pass' : 'fail'}. Component gates use declared historical splits only as diagnostics: Summer statistical and forecast-coverage promotion ${summary.validation.promotionGates.summerComponent ? 'pass' : 'fail'}; Winter statistical promotion ${summary.validation.promotionGates.winterComponent ? 'pass' : 'fail'}; canonical live signal contract ${summary.validation.promotionGates.liveContract ? 'pass' : 'fail'}; production-source exact-target parity ${summary.validation.promotionGates.liveTargetParity ? 'pass' : `fail (Summer ${summary.validation.liveTargetParity.components.summer.mismatchCount}/${summary.validation.liveTargetParity.components.summer.comparedRowCount}; Winter ${summary.validation.liveTargetParity.components.winter.mismatchCount}/${summary.validation.liveTargetParity.components.winter.comparedRowCount} mismatches)`}; research-tied broker execution profile ${summary.validation.promotionGates.brokerExecution ? 'pass' : 'fail'}; exact strategy-contract seal ${summary.validation.promotionGates.strategyContractSeal ? 'pass' : 'fail'}; paper approval ${summary.validation.promotionGates.paperApproval ? 'pass' : 'fail'}; pristine prospective evidence ${summary.validation.promotionGates.pristineForwardEvidence ? 'pass' : 'fail'}; reviewed paper fills/slippage evidence ${summary.validation.promotionGates.paperExecutionEvidence ? 'pass' : 'fail'}; live approval ${summary.validation.promotionGates.liveApproval ? 'pass' : 'fail'}.
- Validation integrity: evidence from ${summary.validation.integrity.historicalEvidenceStart} through ${summary.validation.integrity.observedThrough} is ${summary.validation.integrity.historicalEvidenceStatus}; development began ${summary.validation.integrity.developmentBegan}, and the sealed prospective period starts ${summary.validation.integrity.prospectiveStart}. Forward evidence is observed through ${summary.validation.integrity.forwardObservedThrough ?? 'not yet recorded'}; reviewed paper execution evidence is ${summary.validation.integrity.paperExecutionEvidenceStatus}. Paper approval is ${summary.validation.integrity.paperApprovalStatus}; live approval is ${summary.validation.integrity.liveApprovalStatus}. Paper eligibility ${summary.validation.eligibility.paperEligible ? 'passes' : 'fails'}; live eligibility ${summary.validation.eligibility.liveEligible ? 'passes' : 'fails'}.
- Public holdout starts ${summary.contract.holdoutStart}, when both components are in holdout. Composite returns after the selection boundary are report-only at the all-year layer: ${summary.search.selectionUsedHoldout ? 'no' : 'yes'}.
- Component-safe selection p-value: ${summary.validation.selectionRealityCheck.pValue} (${summary.validation.selectionRealityCheck.method}).
- Full-calendar diagnostic p-value: ${summary.validation.realityCheck.pValue} (${summary.validation.realityCheck.method}).
- Single-candidate p-value: ${summary.validation.realityCheck.singleCandidatePValue}.
- Selection-adjusted p-value: ${summary.validation.realityCheck.selectionAdjustedPValue ?? 'n/a'}.
- Observed active edge: ${summary.validation.realityCheck.observedAverageDailyEdgePct}% per day / ${summary.validation.realityCheck.observedAnnualizedEdgePct}% annualized.
- Mean daily-edge 90% bootstrap interval: ${summary.validation.realityCheck.meanConfidenceIntervalDailyEdgePct.p05}% to ${summary.validation.realityCheck.meanConfidenceIntervalDailyEdgePct.p95}%.
- Zero-edge null 90% interval: ${summary.validation.realityCheck.nullConfidenceIntervalDailyEdgePct.p05}% to ${summary.validation.realityCheck.nullConfidenceIntervalDailyEdgePct.p95}%.
- Bootstrap setup: ${summary.validation.realityCheck.iterations} iterations, ${summary.validation.realityCheck.blockLength}-session circular blocks, minimum resolvable p-value ${summary.validation.realityCheck.minimumResolvablePValue}.

## Verdict

${summary.status === 'research-baseline'
  ? `This artifact is eligible for approved paper routing. Live routing remains ${summary.validation.eligibility.liveEligible ? 'eligible under the reviewed prospective-evidence and approval gates' : 'disabled pending pristine prospective evidence and explicit live approval'}.`
  : 'Keep this in needs-validation status. The causal ETF ledger is reproducible, but one or more paper-eligibility gates fail.'}
`
}

function main() {
  const summerSummary = JSON.parse(readText(SUMMER_SUMMARY_FILE))
  const winterSummary = JSON.parse(readText(WINTER_SUMMARY_FILE))
  const summer = parseCsvWithHeaders(SUMMER_TRADES_FILE)
  const winter = parseCsvWithHeaders(WINTER_TRADES_FILE)
  validateComponentArtifact({
    repoRoot: REPO_ROOT,
    label: 'NGAS Summer Alpha',
    expectedStrategyId: 'ngas-summer-alpha',
    requiredSchemaVersion: COMPONENT_ARTIFACT_SCHEMA_VERSION,
    summary: summerSummary,
    trades: summer,
    executionContract: EXECUTION_CONTRACT,
  })
  validateComponentArtifact({
    repoRoot: REPO_ROOT,
    label: 'NGAS Winter Alpha',
    expectedStrategyId: 'ngas-winter-alpha',
    requiredSchemaVersion: COMPONENT_ARTIFACT_SCHEMA_VERSION,
    summary: winterSummary,
    trades: winter,
    executionContract: EXECUTION_CONTRACT,
  })
  const executionByDate = new Map(loadExecutionCalendar(REPO_ROOT, { startDate: '2021-01-01' }).map((day) => [day.date, day]))
  const contractsByStrategyId = new Map([
    [summerSummary.strategyId, summerSummary.contract],
    [winterSummary.strategyId, winterSummary.contract],
  ])
  const splitContract = allYearSplitContract([summerSummary, winterSummary])
  const liveComponentContract = canonicalComponentLiveContractFromSummaries(summerSummary, winterSummary)
  const liveComponentContractDigest = liveComponentContractDigestSha256(liveComponentContract)
  const liveComponentContractMatchesExecutable =
    liveComponentContractDigest === executableLiveComponentContractDigestSha256
  const liveTargetParity = evaluateVersionedLiveTargetParity(REPO_ROOT)
  const artifactExecutionContract = {
    contractId: EXECUTION_CONTRACT.contractId,
    contractDigest: EXECUTION_CONTRACT.digest,
    scenarioId: EXECUTION_CONTRACT.selectionScenarioId,
    priceConvention: EXECUTION_CONTRACT.priceConvention,
    initialState: EXECUTION_CONTRACT.initialState,
    deploymentFraction: EXECUTION_CONTRACT.deploymentFraction,
    rebalanceDeadbandPct: EXECUTION_CONTRACT.rebalanceDeadbandPct,
    rebalanceDeadbandPolicyId: EXECUTION_CONTRACT.rebalanceDeadbandPolicyId,
    indexWeights: EXECUTION_CONTRACT.indexWeights,
    turnoverConvention: EXECUTION_CONTRACT.turnoverConvention,
    benchmarkConvention: EXECUTION_CONTRACT.benchmarkConvention,
    selectionRule: EXECUTION_CONTRACT.selectionRule,
    costCalibration: EXECUTION_CONTRACT.costCalibration,
    scenarios: EXECUTION_CONTRACT.scenarios,
  }
  const brokerExecutionTieOutFailures = brokerExecutionProfileTieOutFailures(
    BROKER_EXECUTION.profile,
    artifactExecutionContract,
  )
  const artifactBrokerExecutionContract = {
    schemaVersion: BROKER_EXECUTION.profile.schemaVersion,
    profileId: BROKER_EXECUTION.profile.profileId,
    profileDigestSha256: BROKER_EXECUTION.profileDigestSha256,
    profile: BROKER_EXECUTION.profile,
  }
  const artifactOvernightRiskContract = {
    contractId: OVERNIGHT_POLICY_CONTRACT.contractId,
    contractDigest: OVERNIGHT_POLICY_DIGEST,
    deployedPolicyId: OVERNIGHT_POLICY_CONTRACT.deployedPolicyId,
    behavior: 'Retain the complete prior-close UNG position overnight; execute the next causal target at the adjusted session open.',
    candidatePoliciesResearchOnly: true,
    selectionUsedHoldout: false,
    holdoutUse: 'The 2025+ retrospective period is descriptive only and cannot change a policy recommendation or all-year eligibility.',
    evaluationSummary: 'data/qore/research/strategy-agent-runs/ngas-all-year-beta/overnight-risk-summary.json',
    candidateSummary: 'data/qore/research/strategy-agent-runs/ngas-all-year-beta/overnight-risk-candidate-summary.csv',
  }
  const artifactLiveInferenceContract = {
    componentContractSchemaVersion: LIVE_COMPONENT_CONTRACT_SCHEMA_VERSION,
    componentContract: liveComponentContract,
    componentContractDigestSha256: liveComponentContractDigest,
    executableContractDigestSha256: executableLiveComponentContractDigestSha256,
  }
  const rows = createCompositeRows(summer.rows, winter.rows, contractsByStrategyId, splitContract, executionByDate)
  const splits = splitRows(rows)
  const edges = splitEdges(splits)
  const annualEdges = splitAnnualEdges(splits)
  const metricsBySplit = Object.fromEntries(Object.entries(splits).map(([split, splitRowsForMetrics]) => [split, metricsFromReturns(splitRowsForMetrics)]))
  const indexMetricsBySplit = Object.fromEntries(Object.entries(splits).map(([split, splitRowsForMetrics]) => [split, metricsFromReturns(splitRowsForMetrics, 'indexReturnPct')]))
  const selectionRows = chronologicalSelectionRows(rows, splitContract)
  const selectionSplits = splitRows(selectionRows)
  const selectionEdges = splitEdges(selectionSplits)
  const selectionMetricsBySplit = Object.fromEntries(
    Object.entries(selectionSplits).map(([split, splitRowsForMetrics]) => [split, metricsFromReturns(splitRowsForMetrics)]),
  )
  const selectionIndexMetricsBySplit = Object.fromEntries(
    Object.entries(selectionSplits).map(([split, splitRowsForMetrics]) => [split, metricsFromReturns(splitRowsForMetrics, 'indexReturnPct')]),
  )
  const selectionRealityCheck = blockBootstrapRealityCheck(selectionRows)
  const realityCheck = blockBootstrapRealityCheck(rows)
  const frictionScenarios = Object.fromEntries(
    Object.keys(EXECUTION_CONTRACT.scenarios).map((scenarioId) => {
      const scenarioRows = scenarioId === EXECUTION_CONTRACT.selectionScenarioId
        ? rows
        : createCompositeRows(summer.rows, winter.rows, contractsByStrategyId, splitContract, executionByDate, scenarioId)
      const scenarioSplits = splitRows(scenarioRows)
      const scenarioMetrics = Object.fromEntries(
        Object.entries(scenarioSplits).map(([split, splitRowsForMetrics]) => [split, metricsFromReturns(splitRowsForMetrics)]),
      )
      return [scenarioId, {
        selectionEligible: EXECUTION_CONTRACT.scenarios[scenarioId].selectionEligible,
        oneWayBps: EXECUTION_CONTRACT.scenarios[scenarioId].oneWayBps,
        annualBorrowRatePct: EXECUTION_CONTRACT.scenarios[scenarioId].annualBorrowRatePct,
        metrics: scenarioMetrics,
      }]
    }),
  )
  const summaryMetrics = {
    gasOverlayRows: rows.filter((row) => row.thesisKind !== 'index-fallback').length,
    materialRows: rows.filter(isMaterialStrategyRow).length,
    indexFallbackRows: rows.filter((row) => row.thesisKind === 'index-fallback').length,
  }
  const generatedAt = new Date().toISOString()
  const selected = {
    candidateId: STRATEGY_ID,
    architectureLabel: 'Summer/Winter composite artifact',
    sourceSetLabel: 'NGAS Summer Alpha + NGAS Winter Alpha',
    sourceIds: [summerSummary.strategyId, winterSummary.strategyId],
    componentStrategyIds: [summerSummary.strategyId, winterSummary.strategyId],
    sourceWeightMode: 'component-selected',
    sizingMode: 'component-selected',
    allMetrics: metricsBySplit.all,
    trainMetrics: metricsBySplit.train,
    validationMetrics: metricsBySplit.validation,
    holdoutMetrics: metricsBySplit.holdout,
    indexMetrics: {
      all: indexMetricsBySplit.all,
      train: indexMetricsBySplit.train,
      validation: indexMetricsBySplit.validation,
      holdout: indexMetricsBySplit.holdout,
    },
    splitEdges: edges,
    splitAnnualEdges: annualEdges,
    rowSelectionPolicy: 'For each entry date, pick the material Summer Alpha row, else the material Winter Alpha row, else the shared index-fallback target. The all-year ledger then recomputes every executed leg and cost.',
    materialRowDefinition: 'A source row is material when it has a non-index thesis, non-zero gas target, or an explicit index-to-cash allocation change. All-year costs are recomputed after target selection.',
    componentTradeCounts: {
      summer: rows.filter((row) => row.componentStrategyId === summerSummary.strategyId && row.thesisKind !== 'index-fallback').length,
      winter: rows.filter((row) => row.componentStrategyId === winterSummary.strategyId && row.thesisKind !== 'index-fallback').length,
    },
    indexFallbackRows: summaryMetrics.indexFallbackRows,
    materialRows: summaryMetrics.materialRows,
    sourceUniverse: sourceUniverseFor(rows),
  }
  const strategyContractDigestSha256 = allYearStrategyContractDigestSha256({
    strategyId: STRATEGY_ID,
    contract: {
      allYearSelection: ALL_YEAR_SELECTION_CONTRACT,
      execution: artifactExecutionContract,
      brokerExecution: artifactBrokerExecutionContract,
      overnightRisk: artifactOvernightRiskContract,
      liveInference: artifactLiveInferenceContract,
      liveTargetParity: LIVE_TARGET_PARITY_POLICY,
    },
  })
  const validationIntegrity = {
    ...VALIDATION_INTEGRITY.binding,
    strategyContractDigestSha256,
  }
  const promotionGates = {
    positiveTrainEdge: selectionEdges.train > 0,
    positiveValidationEdge: selectionEdges.validation > 0,
    preHoldoutBootstrapSignificance: selectionRealityCheck.pValue < 0.05,
    trainMaxDrawdown: selectionMetricsBySplit.train.maxDrawdownPct > MAX_DRAWDOWN_PROMOTION_FLOOR_PCT,
    validationMaxDrawdown: selectionMetricsBySplit.validation.maxDrawdownPct > MAX_DRAWDOWN_PROMOTION_FLOOR_PCT,
    summerComponent: summerSummary.promotion?.eligible === true,
    winterComponent: winterSummary.search.eligibleCandidateCount > 0,
    liveContract: liveComponentContractMatchesExecutable,
    liveTargetParity: liveTargetParity.exactTargetParity,
    brokerExecution: brokerExecutionTieOutFailures.length === 0,
    pristineForwardEvidence: VALIDATION_INTEGRITY.binding.pristineForwardEvidence,
    strategyContractSeal:
      VALIDATION_INTEGRITY.binding.sealedStrategyContractDigestSha256 === strategyContractDigestSha256,
    paperApproval: VALIDATION_INTEGRITY.binding.paperApprovalStatus === 'approved',
    paperExecutionEvidence: VALIDATION_INTEGRITY.binding.paperExecutionEvidenceSatisfied,
    liveApproval: VALIDATION_INTEGRITY.binding.liveApprovalStatus === 'approved',
  }
  const paperEligible = [
    'positiveTrainEdge',
    'positiveValidationEdge',
    'preHoldoutBootstrapSignificance',
    'trainMaxDrawdown',
    'validationMaxDrawdown',
    'summerComponent',
    'winterComponent',
    'liveContract',
    'liveTargetParity',
    'brokerExecution',
    'strategyContractSeal',
    'paperApproval',
  ].every((gate) => promotionGates[gate])
  const liveEligible = paperEligible
    && promotionGates.pristineForwardEvidence
    && promotionGates.paperExecutionEvidence
    && promotionGates.liveApproval
  const eligible = paperEligible
  const candidateRow = formatCandidateRow(selected, summaryMetrics, eligible, {
    metrics: selectionMetricsBySplit,
    indexMetrics: selectionIndexMetricsBySplit,
    edges: selectionEdges,
  })
  const headers = unique([
    'strategyId',
    'variant',
    'componentStrategyId',
    'componentVariant',
    'researchInstrument',
    'signalInstrument',
    'componentGrossReturnPct',
    'componentTradingCostPct',
    'componentNetReturnPct',
    ...summer.headers,
    ...winter.headers,
    'materialRow',
    'activeReturnPct',
    'componentSplit',
    'split',
  ])
  const selectedTradesRaw = rowsToCsv(rows, headers)
  const curveRows = displayCurveRows(rows)
  const displayCurveRaw = rowsToCsv(curveRows, [...ALL_YEAR_DISPLAY_CURVE_HEADERS])
  const outputArtifactBindings = buildAllYearOutputArtifactBindings({
    selectedTrades: { raw: selectedTradesRaw, headers, rows },
    displayCurve: {
      raw: displayCurveRaw,
      headers: [...ALL_YEAR_DISPLAY_CURVE_HEADERS],
      rows: curveRows,
    },
  })
  const summary = {
    artifactSchemaVersion: ALL_YEAR_STRATEGY_ARTIFACT_SCHEMA_VERSION,
    generatedAt,
    strategyId: STRATEGY_ID,
    displayName: STRATEGY_NAME,
    status: eligible ? 'research-baseline' : 'needs-validation',
    data: {
      summerSummaryFile: path.relative(REPO_ROOT, SUMMER_SUMMARY_FILE),
      summerSelectedTrades: path.relative(REPO_ROOT, SUMMER_TRADES_FILE),
      winterSummaryFile: path.relative(REPO_ROOT, WINTER_SUMMARY_FILE),
      winterSelectedTrades: path.relative(REPO_ROOT, WINTER_TRADES_FILE),
      validationIntegrityManifest: path.relative(REPO_ROOT, VALIDATION_INTEGRITY.filePath),
      brokerSettings: path.relative(REPO_ROOT, BROKER_EXECUTION.settingsPath),
      indexBasket: path.relative(REPO_ROOT, BROKER_EXECUTION.basketPath),
      marketStartDate: selected.allMetrics.firstEntry,
      marketEndDate: selected.allMetrics.lastExit,
      marketDays: rows.length,
      ...outputArtifactBindings,
    },
    contract: {
      allYearSelection: ALL_YEAR_SELECTION_CONTRACT,
      trainEnd: splitContract.trainEnd,
      selectionEnd: splitContract.selectionEnd,
      validationEnd: splitContract.validationEnd,
      holdoutStart: splitContract.holdoutStart,
      summerTrainEnd: summerSummary.contract.trainEnd,
      summerValidationEnd: summerSummary.contract.validationEnd,
      summerHoldoutStart: summerSummary.contract.holdoutStart,
      winterTrainEnd: winterSummary.contract.trainEnd,
      winterValidationEnd: winterSummary.contract.validationEnd,
      winterHoldoutStart: winterSummary.contract.holdoutStart,
      fallback: 'Unallocated deployable capital is routed to the configured VOO/QQQM target-weight index basket; the broker cash buffer remains uninvested.',
      selectionPolicy: 'No independent all-year optimization. The artifact freezes the exact Summer/Winter material-row selector into its own ledger.',
      signalTiming:
        'Component source rows keep their source-lane signal timing. Prior holdings earn close-to-open returns; selected current targets earn adjusted-open-to-close returns.',
      overfitControl: "All-year return-based eligibility mechanically excludes component holdout rows by using one chronological calendar-wide train/validation prefix ending before the earliest component holdout. Those historical splits are development-contaminated rather than pristine. Public holdout reporting begins only at the latest component holdout and is reporting-only; only evidence collected under the prospective validation-integrity seal can satisfy the live evidence gate.",
      researchInstruments: {
        summer: {
          componentStrategyId: summerSummary.strategyId,
          gasSymbol: 'UNG',
          signalSymbol: 'NG=F',
          contract: 'NG=F signal features with Yahoo UNG ETF P&L',
        },
        winter: {
          componentStrategyId: winterSummary.strategyId,
          gasSymbol: 'UNG',
          signalSymbol: 'UNG',
          contract: 'Yahoo UNG ETF historical series',
        },
        indexFallback: {
          symbol: 'US-INDEX-BASKET',
          contract: 'Configured target-weight VOO/QQQM close-to-close series',
        },
      },
      executionInstrument: {
        gasSymbol: 'UNG',
        contract: 'Alpaca equity/ETF execution',
      },
      execution: artifactExecutionContract,
      brokerExecution: artifactBrokerExecutionContract,
      overnightRisk: artifactOvernightRiskContract,
      liveInference: artifactLiveInferenceContract,
      liveTargetParity: LIVE_TARGET_PARITY_POLICY,
      maxDrawdownPromotionFloorPct: MAX_DRAWDOWN_PROMOTION_FLOOR_PCT,
    },
    selected,
    search: {
      candidateCount: 1,
      eligibleCandidateCount: eligible ? 1 : 0,
      selectionStatus: eligible ? 'fixed-composite-passes-promotion-gates' : 'fixed-composite-retained-needs-validation',
      selectionUsedHoldout: false,
      paperEligible,
      liveEligible,
    },
    validation: {
      integrity: validationIntegrity,
      eligibility: {
        paperEligible,
        liveEligible,
        promotionEligible: liveEligible,
      },
      selectionRealityCheck,
      selectionMetrics: {
        throughDate: splitContract.selectionEnd,
        strategy: selectionMetricsBySplit,
        index: selectionIndexMetricsBySplit,
        splitEdges: selectionEdges,
      },
      realityCheck,
      liveTargetParity,
      promotionGates,
      frictionScenarios,
      componentRealityChecks: {
        [summerSummary.strategyId]: summerSummary.validation.realityCheck,
        [winterSummary.strategyId]: winterSummary.validation.realityCheck,
      },
    },
    outputFiles: {
      selectedTrades: ALL_YEAR_SELECTED_TRADES_FILE,
      displayCurve: ALL_YEAR_DISPLAY_CURVE_FILE,
      candidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'candidate-summary.csv')),
      runSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'run-summary.json')),
      frictionStressSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'friction-stress-summary.csv')),
      overnightRiskSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'overnight-risk-summary.json')),
      overnightRiskCandidateSummary: path.relative(REPO_ROOT, path.join(OUTPUT_DIR, 'overnight-risk-candidate-summary.csv')),
    },
    candidates: [candidateRow],
  }

  writeText(path.join(OUTPUT_DIR, 'selected-trades.csv'), selectedTradesRaw)
  writeText(path.join(OUTPUT_DIR, 'display-curve.csv'), displayCurveRaw)
  writeText(path.join(OUTPUT_DIR, 'candidate-summary.csv'), rowsToCsv([candidateRow], Object.keys(candidateRow)))
  const frictionStressRows = Object.entries(frictionScenarios).map(([scenarioId, scenario]) => ({
    scenarioId,
    selectionEligible: scenario.selectionEligible,
    ungOneWayBps: scenario.oneWayBps.UNG,
    vooOneWayBps: scenario.oneWayBps.VOO,
    qqqmOneWayBps: scenario.oneWayBps.QQQM,
    annualBorrowRatePct: scenario.annualBorrowRatePct,
    totalReturnPct: scenario.metrics.all.totalReturnPct,
    cagrPct: scenario.metrics.all.cagrPct,
    sharpe: scenario.metrics.all.sharpe,
    maxDrawdownPct: scenario.metrics.all.maxDrawdownPct,
    holdoutReturnPct: scenario.metrics.holdout.totalReturnPct,
    holdoutCagrPct: scenario.metrics.holdout.cagrPct,
  }))
  writeText(
    path.join(OUTPUT_DIR, 'friction-stress-summary.csv'),
    rowsToCsv(frictionStressRows, Object.keys(frictionStressRows[0] ?? {})),
  )
  writeText(path.join(OUTPUT_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeText(path.join(OUTPUT_DIR, 'report.md'), buildReport(summary))

  console.log(
    [
      `Selected ${STRATEGY_ID}`,
      `return=${selected.allMetrics.totalReturnPct}%`,
      `cagr=${selected.allMetrics.cagrPct}%`,
      `sharpe=${selected.allMetrics.sharpe}`,
      `maxDD=${selected.allMetrics.maxDrawdownPct}%`,
      `holdoutEdge=${selected.splitEdges.holdout}%`,
      `pValue=${realityCheck.pValue}`,
      `rows=${rows.length}`,
    ].join(' '),
  )
}

main()
