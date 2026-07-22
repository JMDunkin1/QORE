import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import {
  REBALANCE_DEADBAND_POLICY_ID,
  rebalanceDecisionsForAllocation,
} from './qore-rebalance-deadband.mjs'

export const EXECUTION_SYMBOLS = ['UNG', 'VOO', 'QQQM']

function numberFrom(value, fallback = Number.NaN) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 8) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parseCsv(filePath) {
  const parsed = Papa.parse(fs.readFileSync(filePath, 'utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })
  if (parsed.errors.length) {
    throw new Error(`${path.basename(filePath)} could not be parsed: ${parsed.errors[0].message}`)
  }
  return parsed.data
}

export function adjustedBarFromYahooRow(row, label = 'Yahoo row') {
  const rawOpen = numberFrom(row.open)
  const rawHigh = numberFrom(row.high)
  const rawLow = numberFrom(row.low)
  const rawClose = numberFrom(row.close)
  const adjustedClose = numberFrom(row.adjustedClose, rawClose)
  if (
    !row.date ||
    ![rawOpen, rawHigh, rawLow, rawClose, adjustedClose].every((value) => Number.isFinite(value) && value > 0)
  ) {
    throw new Error(`${label} ${row.date || '(missing date)'} has missing or non-positive OHLC data.`)
  }
  const adjustmentFactor = adjustedClose / rawClose
  return {
    date: row.date,
    open: rawOpen * adjustmentFactor,
    high: rawHigh * adjustmentFactor,
    low: rawLow * adjustmentFactor,
    close: adjustedClose,
    rawClose,
    adjustmentFactor,
  }
}

export function loadAdjustedYahooBars(filePath) {
  return parseCsv(filePath)
    .map((row) => adjustedBarFromYahooRow(row, path.basename(filePath)))
    .sort((left, right) => left.date.localeCompare(right.date))
}

function calendarDaysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function symbolReturn(current, previous) {
  const overnight = current.open / previous.close - 1
  const intraday = current.close / current.open - 1
  const closeToClose = current.close / previous.close - 1
  return {
    adjustedOpen: current.open,
    adjustedClose: current.close,
    overnightReturnPct: overnight * 100,
    intradayReturnPct: intraday * 100,
    closeToCloseReturnPct: closeToClose * 100,
  }
}

export function loadResearchExecutionContract(repoRoot) {
  const filePath = path.join(repoRoot, 'config/qore-research-execution.json')
  const contract = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  validateResearchExecutionContract(contract)
  const basketFilePath = path.join(repoRoot, 'data/qore/market/index-basket-config.json')
  const basket = JSON.parse(fs.readFileSync(basketFilePath, 'utf8'))
  const liveWeights = Object.fromEntries(
    (basket.components ?? []).map((component) => [component.symbol, numberFrom(component.targetWeight)]),
  )
  for (const symbol of ['VOO', 'QQQM']) {
    const liveWeight = numberFrom(liveWeights[symbol])
    if (!Number.isFinite(liveWeight) || Math.abs(numberFrom(contract.indexWeights[symbol]) - liveWeight) > 0.000001) {
      throw new Error(`Research execution ${symbol} weight does not match data/qore/market/index-basket-config.json.`)
    }
  }
  return {
    ...contract,
    filePath,
    digest: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  }
}

export function validateResearchExecutionContract(contract) {
  if (contract?.schemaVersion !== 1 || !contract.contractId) {
    throw new Error('Research execution contract must have schemaVersion=1 and a contractId.')
  }
  if (!(contract.deploymentFraction > 0 && contract.deploymentFraction <= 1)) {
    throw new Error('Research execution deploymentFraction must be in (0, 1].')
  }
  if (!(contract.rebalanceDeadbandPct >= 0 && contract.rebalanceDeadbandPct <= 100)) {
    throw new Error('Research execution rebalanceDeadbandPct must be between 0 and 100.')
  }
  if (contract.rebalanceDeadbandPolicyId !== REBALANCE_DEADBAND_POLICY_ID) {
    throw new Error(`Research execution rebalanceDeadbandPolicyId must equal ${REBALANCE_DEADBAND_POLICY_ID}.`)
  }
  const indexWeightTotal = numberFrom(contract.indexWeights?.VOO) + numberFrom(contract.indexWeights?.QQQM)
  if (
    !(numberFrom(contract.indexWeights?.VOO) >= 0) ||
    !(numberFrom(contract.indexWeights?.QQQM) >= 0) ||
    Math.abs(indexWeightTotal - 1) > 0.000001
  ) {
    throw new Error('Research execution VOO/QQQM index weights must be non-negative and sum to one.')
  }
  const selectionEligibleScenarioIds = Object.entries(contract.scenarios ?? {})
    .filter(([, scenario]) => scenario.selectionEligible === true)
    .map(([scenarioId]) => scenarioId)
  if (
    selectionEligibleScenarioIds.length !== 1 ||
    selectionEligibleScenarioIds[0] !== contract.selectionScenarioId
  ) {
    throw new Error('Exactly one research execution scenario must be selection eligible, and it must match selectionScenarioId.')
  }
  for (const [scenarioId, scenario] of Object.entries(contract.scenarios ?? {})) {
    for (const symbol of EXECUTION_SYMBOLS) {
      if (!(numberFrom(scenario.oneWayBps?.[symbol]) >= 0)) {
        throw new Error(`Research execution scenario ${scenarioId} is missing a non-negative ${symbol} one-way cost.`)
      }
    }
    if (!(numberFrom(scenario.annualBorrowRatePct) >= 0)) {
      throw new Error(`Research execution scenario ${scenarioId} has an invalid annual borrow rate.`)
    }
  }
}

export function loadExecutionCalendar(
  repoRoot,
  { startDate = '', endDate = '', contract = loadResearchExecutionContract(repoRoot) } = {},
) {
  const marketRoot = path.join(repoRoot, 'data/qore/market/yahoo')
  const barsBySymbol = new Map()
  for (const symbol of EXECUTION_SYMBOLS) {
    const rows = loadAdjustedYahooBars(path.join(marketRoot, `${symbol}-daily.csv`))
    barsBySymbol.set(symbol, new Map(rows.map((row) => [row.date, row])))
  }

  const commonDates = [...barsBySymbol.get(EXECUTION_SYMBOLS[0]).keys()]
    .filter((date) => EXECUTION_SYMBOLS.every((symbol) => barsBySymbol.get(symbol).has(date)))
    .filter((date) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
    .sort()
  const allCommonDates = [...barsBySymbol.get(EXECUTION_SYMBOLS[0]).keys()]
    .filter((date) => EXECUTION_SYMBOLS.every((symbol) => barsBySymbol.get(symbol).has(date)))
    .sort()
  const previousCommonDate = new Map(allCommonDates.map((date, index) => [date, allCommonDates[index - 1]]))
  const days = []

  for (const date of commonDates) {
    const previousDate = previousCommonDate.get(date)
    if (!previousDate) continue
    const symbols = {}
    for (const symbol of EXECUTION_SYMBOLS) {
      symbols[symbol] = symbolReturn(barsBySymbol.get(symbol).get(date), barsBySymbol.get(symbol).get(previousDate))
    }
    const indexReturnPct =
      contract.indexWeights.VOO * symbols.VOO.closeToCloseReturnPct +
      contract.indexWeights.QQQM * symbols.QQQM.closeToCloseReturnPct
    const indexOvernightReturnPct =
      contract.indexWeights.VOO * symbols.VOO.overnightReturnPct +
      contract.indexWeights.QQQM * symbols.QQQM.overnightReturnPct
    const indexIntradayReturnPct =
      contract.indexWeights.VOO * symbols.VOO.intradayReturnPct +
      contract.indexWeights.QQQM * symbols.QQQM.intradayReturnPct
    days.push({
      date,
      previousDate,
      calendarGapDays: calendarDaysBetween(previousDate, date),
      symbols,
      indexReturnPct,
      indexOvernightReturnPct,
      indexIntradayReturnPct,
    })
  }

  if (!days.length) throw new Error('No common UNG/VOO/QQQM execution sessions were available.')
  return days
}

export function targetWeightsForAllocation(contract, { gasPosition = 0, investedIndexFraction = 1 } = {}) {
  const deployable = contract.deploymentFraction
  const gasTarget = numberFrom(gasPosition, 0)
  const requestedIndexTarget = numberFrom(investedIndexFraction, 0)
  if (Math.abs(gasTarget) > 1 || requestedIndexTarget < 0) {
    throw new Error('Research execution targets must have |gasPosition| <= 1 and investedIndexFraction >= 0.')
  }
  const indexTarget = Math.min(requestedIndexTarget, Math.max(0, 1 - Math.abs(gasTarget)))
  return {
    UNG: deployable * gasTarget,
    VOO: deployable * indexTarget * contract.indexWeights.VOO,
    QQQM: deployable * indexTarget * contract.indexWeights.QQQM,
  }
}

export function createExecutionState(contract, initialAllocation = { gasPosition: 0, investedIndexFraction: 1 }) {
  return {
    closeWeights: targetWeightsForAllocation(contract, initialAllocation),
    previousDate: null,
  }
}

function weightedReturn(weights, day, returnKey) {
  return EXECUTION_SYMBOLS.reduce(
    (sum, symbol) => sum + (weights[symbol] ?? 0) * (day.symbols[symbol][returnKey] / 100),
    0,
  )
}

export function applyExecutionStep({ state, day, targetWeights, contract, scenarioId = contract.selectionScenarioId }) {
  const scenario = contract.scenarios[scenarioId]
  if (!scenario) throw new Error(`Unknown research execution scenario: ${scenarioId}`)
  if (state.previousDate && state.previousDate !== day.previousDate) {
    throw new Error(
      `Research execution calendar is discontinuous: state closed ${state.previousDate}, but ${day.date} follows ${day.previousDate}.`,
    )
  }
  const overnightReturn = weightedReturn(state.closeWeights, day, 'overnightReturnPct')
  const equityOpenFactor = 1 + overnightReturn
  if (!(equityOpenFactor > 0)) throw new Error(`Research execution equity was non-positive at the ${day.date} open.`)

  const openWeights = {}
  const executedWeights = {}
  const turnoverBySymbol = {}
  const targetTurnoverBySymbol = {}
  const tradingCostBySymbolPct = {}
  const deadbandFraction = contract.rebalanceDeadbandPct / 100

  for (const symbol of EXECUTION_SYMBOLS) {
    const previousCloseWeight = state.closeWeights[symbol] ?? 0
    openWeights[symbol] = previousCloseWeight * (1 + day.symbols[symbol].overnightReturnPct / 100) / equityOpenFactor
  }
  const startsOverDeploymentEnvelope = EXECUTION_SYMBOLS.reduce(
    (sum, symbol) => sum + Math.abs(openWeights[symbol] ?? 0),
    0,
  ) > contract.deploymentFraction + 1e-12
  const deadbandDecisions = rebalanceDecisionsForAllocation({
    legs: EXECUTION_SYMBOLS.map((symbol) => ({
      symbol,
      current: openWeights[symbol],
      target: targetWeights[symbol] ?? 0,
    })),
    deadband: deadbandFraction,
    forceRiskReduction: startsOverDeploymentEnvelope,
  })

  for (const symbol of EXECUTION_SYMBOLS) {
    const previousCloseWeight = state.closeWeights[symbol] ?? 0
    const requestedDelta = (targetWeights[symbol] ?? 0) - openWeights[symbol]
    const targetDelta = (targetWeights[symbol] ?? 0) - previousCloseWeight
    const decision = deadbandDecisions[symbol]
    const executes = decision.executes
    executedWeights[symbol] = executes ? targetWeights[symbol] ?? 0 : openWeights[symbol]
    turnoverBySymbol[symbol] = executes ? Math.abs(requestedDelta) : 0
    targetTurnoverBySymbol[symbol] = Math.abs(targetDelta)
    tradingCostBySymbolPct[symbol] = turnoverBySymbol[symbol] * scenario.oneWayBps[symbol] / 100
  }

  const intradayReturn = weightedReturn(executedWeights, day, 'intradayReturnPct')
  const grossReturnPct = ((1 + overnightReturn) * (1 + intradayReturn) - 1) * 100
  const tradingCostAtOpenPct = EXECUTION_SYMBOLS.reduce((sum, symbol) => sum + tradingCostBySymbolPct[symbol], 0)
  const tradingCostPct = equityOpenFactor * tradingCostAtOpenPct
  const tradingCostEffectBySymbolPct = Object.fromEntries(
    EXECUTION_SYMBOLS.map((symbol) => [symbol, equityOpenFactor * tradingCostBySymbolPct[symbol]]),
  )
  const borrowCostPct = Math.max(0, -(state.closeWeights.UNG ?? 0)) * scenario.annualBorrowRatePct * day.calendarGapDays / 360
  const netReturnPct = grossReturnPct - tradingCostPct - borrowCostPct
  // The close-to-open move and borrow accrued across the gap belong to the
  // holdings that were already in place at the prior close. Everything from
  // the current open onward belongs to the newly executed target. Keeping
  // these contributions additive avoids crediting an entry-day gap to the new
  // thesis while still reconciling exactly to the daily net return.
  const priorCloseReturnContributionPct = overnightReturn * 100 - borrowCostPct
  const currentSessionReturnContributionPct = netReturnPct - priorCloseReturnContributionPct
  const closeFactorFromOpen = 1 + intradayReturn - tradingCostAtOpenPct / 100 - borrowCostPct / (100 * equityOpenFactor)
  if (!(closeFactorFromOpen > 0)) throw new Error(`Research execution equity was non-positive at the ${day.date} close.`)

  const closeWeights = Object.fromEntries(
    EXECUTION_SYMBOLS.map((symbol) => [
      symbol,
      executedWeights[symbol] * (1 + day.symbols[symbol].intradayReturnPct / 100) / closeFactorFromOpen,
    ]),
  )
  const totalTurnover = EXECUTION_SYMBOLS.reduce((sum, symbol) => sum + turnoverBySymbol[symbol], 0)
  const totalTargetTurnover = EXECUTION_SYMBOLS.reduce((sum, symbol) => sum + targetTurnoverBySymbol[symbol], 0)

  return {
    state: { closeWeights, previousDate: day.date },
    scenarioId,
    targetWeights,
    openWeights,
    executedWeights,
    turnoverBySymbol,
    targetTurnoverBySymbol,
    tradingCostAtOpenBySymbolPct: tradingCostBySymbolPct,
    tradingCostBySymbolPct: tradingCostEffectBySymbolPct,
    totalTurnover,
    totalTargetTurnover,
    gasTurnover: turnoverBySymbol.UNG,
    indexTurnover: turnoverBySymbol.VOO + turnoverBySymbol.QQQM,
    overnightPortfolioReturnPct: overnightReturn * 100,
    intradayPortfolioReturnPct: intradayReturn * 100,
    priorCloseReturnContributionPct,
    currentSessionReturnContributionPct,
    grossReturnPct,
    tradingCostPct,
    borrowCostPct,
    netReturnPct,
  }
}

export function executionAuditFields(step, day, contract) {
  return {
    executionInstrument: 'UNG',
    executionPriceConvention: contract.priceConvention,
    priorUngPosition: round(step.openWeights.UNG),
    deployedUngPosition: round(step.executedWeights.UNG),
    deployedVooPosition: round(step.executedWeights.VOO),
    deployedQqqmPosition: round(step.executedWeights.QQQM),
    ungOvernightReturnPct: round(day.symbols.UNG.overnightReturnPct),
    ungIntradayReturnPct: round(day.symbols.UNG.intradayReturnPct),
    vooReturnPct: round(day.symbols.VOO.closeToCloseReturnPct),
    qqqmReturnPct: round(day.symbols.QQQM.closeToCloseReturnPct),
    indexOvernightReturnPct: round(day.indexOvernightReturnPct),
    indexIntradayReturnPct: round(day.indexIntradayReturnPct),
    overnightPortfolioReturnPct: round(step.overnightPortfolioReturnPct),
    intradayPortfolioReturnPct: round(step.intradayPortfolioReturnPct),
    priorCloseReturnContributionPct: round(step.priorCloseReturnContributionPct),
    currentSessionReturnContributionPct: round(step.currentSessionReturnContributionPct),
    gasTargetTurnover: round(step.targetTurnoverBySymbol.UNG),
    vooTargetTurnover: round(step.targetTurnoverBySymbol.VOO),
    qqqmTargetTurnover: round(step.targetTurnoverBySymbol.QQQM),
    gasTurnover: round(step.gasTurnover),
    vooTurnover: round(step.turnoverBySymbol.VOO),
    qqqmTurnover: round(step.turnoverBySymbol.QQQM),
    indexTurnover: round(step.indexTurnover),
    totalTurnover: round(step.totalTurnover),
    gasTradingCostPct: round(step.tradingCostBySymbolPct.UNG),
    vooTradingCostPct: round(step.tradingCostBySymbolPct.VOO),
    qqqmTradingCostPct: round(step.tradingCostBySymbolPct.QQQM),
    borrowCostPct: round(step.borrowCostPct),
    frictionContractId: contract.contractId,
    frictionScenarioId: step.scenarioId,
  }
}

function thesisKindsFrom(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value === 'string') return value.split('|').map((entry) => entry.trim()).filter(Boolean)
  return []
}

export function causalReturnContributionsForRow(row) {
  return [
    {
      period: 'prior-close-to-open',
      thesisKind: row.priorCloseThesisKind ?? 'index-fallback',
      componentThesisKinds: thesisKindsFrom(row.priorCloseComponentThesisKinds),
      returnPct: numberFrom(row.priorCloseReturnContributionPct, 0),
      position: numberFrom(row.priorUngPosition, 0),
    },
    {
      period: 'current-session',
      thesisKind: row.thesisKind ?? 'index-fallback',
      componentThesisKinds: thesisKindsFrom(row.componentThesisKinds),
      returnPct: numberFrom(row.currentSessionReturnContributionPct, numberFrom(row.netReturnPct, 0)),
      position: numberFrom(row.deployedUngPosition, numberFrom(row.ungPosition, 0)),
    },
  ]
}
