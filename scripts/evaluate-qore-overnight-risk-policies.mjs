#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import {
  applyExecutionStep,
  createExecutionState,
  loadExecutionCalendar,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
} from './lib/qore-research-execution.mjs'

const TRADING_DAYS = 252
const POLICY_CONFIG_PATH = 'config/qore-overnight-risk-policy.json'
const OUTPUT_DIRECTORY = 'data/qore/research/strategy-agent-runs/ngas-all-year-beta'
const SUMMARY_PATH = `${OUTPUT_DIRECTORY}/overnight-risk-summary.json`
const CANDIDATE_SUMMARY_PATH = `${OUTPUT_DIRECTORY}/overnight-risk-candidate-summary.csv`

function numberFrom(value, fallback = Number.NaN) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round(value, digits = 8) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}

function parseCsv(filePath) {
  const parsed = Papa.parse(fs.readFileSync(filePath, 'utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })
  if (parsed.errors.length) throw new Error(`${path.basename(filePath)} could not be parsed: ${parsed.errors[0].message}`)
  return parsed.data
}

function fileDigest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function validatePolicyConfig(config, executionContract) {
  if (config?.schemaVersion !== 1 || !config.contractId) {
    throw new Error('Overnight risk policy config must have schemaVersion=1 and a contractId.')
  }
  if (config.deployedPolicyId !== 'carry-100') {
    throw new Error('The research evaluator must start from deployedPolicyId=carry-100.')
  }
  if (config.selection?.selectionUsedHoldout !== false) {
    throw new Error('Overnight policy selection must explicitly exclude holdout.')
  }
  if (config.selection?.scenarioId !== executionContract.selectionScenarioId) {
    throw new Error('Overnight policy selection scenario must match the frozen research execution selection scenario.')
  }
  if (config.selection?.eligibility?.requiresPositiveSelectionScore !== true) {
    throw new Error('Overnight policy challengers must require a positive train/validation selection score.')
  }
  if (config.holdoutReporting?.reportingOnly !== true) {
    throw new Error('Overnight policy holdout metrics must be explicitly reporting-only.')
  }
  const split = config.splitContract ?? {}
  if (!(split.trainStartDate <= split.trainEndDate && split.trainEndDate < split.validationStartDate)) {
    throw new Error('Overnight policy train and validation date boundaries are invalid.')
  }
  if (!(split.validationStartDate <= split.validationEndDate && split.validationEndDate < split.holdoutStartDate)) {
    throw new Error('Overnight policy validation and holdout date boundaries are invalid.')
  }
  for (const key of ['fixedCashRetentionPct', 'laggedMeanAbsoluteGapLookbackSessions', 'laggedMeanAbsoluteGapThresholdPct']) {
    if (!Array.isArray(config.candidateGrid?.[key]) || !config.candidateGrid[key].length) {
      throw new Error(`Overnight policy candidateGrid.${key} must be a non-empty array.`)
    }
  }
}

function policyIdNumber(value) {
  return Number.isInteger(value) ? `${value}` : `${value}`.replace('.', 'p')
}

function buildPolicies(config) {
  const policies = [
    { policyId: 'carry-100', policyType: 'fixed-retention', retentionFraction: 1 },
    ...config.candidateGrid.fixedCashRetentionPct.map((retentionPct) => ({
      policyId: `cash-retain-${policyIdNumber(retentionPct)}`,
      policyType: 'fixed-retention',
      retentionFraction: retentionPct / 100,
    })),
    ...config.candidateGrid.directionalFlattening.map((direction) => ({
      policyId: `flatten-${direction}-overnight`,
      policyType: 'directional-flatten',
      direction,
    })),
  ]
  if (config.candidateGrid.weekendCashFlattening) {
    policies.push({ policyId: 'flatten-weekend-overnight', policyType: 'weekend-flatten' })
  }
  for (const lookbackSessions of config.candidateGrid.laggedMeanAbsoluteGapLookbackSessions) {
    for (const thresholdPct of config.candidateGrid.laggedMeanAbsoluteGapThresholdPct) {
      policies.push({
        policyId: `gap-ma${lookbackSessions}-threshold${policyIdNumber(thresholdPct)}-cash-flat`,
        policyType: 'lagged-mean-absolute-gap',
        lookbackSessions,
        thresholdPct,
      })
    }
  }
  if (new Set(policies.map((policy) => policy.policyId)).size !== policies.length) {
    throw new Error('Overnight policy candidate IDs must be unique.')
  }
  return policies
}

function splitForDate(date, split) {
  if (date >= split.trainStartDate && date <= split.trainEndDate) return 'train'
  if (date >= split.validationStartDate && date <= split.validationEndDate) return 'validation'
  if (date >= split.holdoutStartDate) return 'holdout'
  return 'excluded'
}

function retentionForPolicy(policy, context) {
  if (policy.policyType === 'fixed-retention') return policy.retentionFraction
  if (policy.policyType === 'directional-flatten') {
    const directionMatches = policy.direction === 'long' ? context.preCloseGasWeight > 0 : context.preCloseGasWeight < 0
    return directionMatches ? 0 : 1
  }
  if (policy.policyType === 'weekend-flatten') return context.nextCalendarGapDays > 1 ? 0 : 1
  if (policy.policyType === 'lagged-mean-absolute-gap') {
    if (context.priorAbsoluteOvernightGapsPct.length < policy.lookbackSessions) return 1
    const window = context.priorAbsoluteOvernightGapsPct.slice(-policy.lookbackSessions)
    return mean(window) >= policy.thresholdPct ? 0 : 1
  }
  throw new Error(`Unknown overnight policy type: ${policy.policyType}`)
}

function applyCloseRetention(step, retentionFraction, scenario) {
  const preCloseGasWeight = step.state.closeWeights.UNG ?? 0
  const retainedGasWeight = preCloseGasWeight * retentionFraction
  const closeGasTurnover = Math.abs(preCloseGasWeight - retainedGasWeight)
  const closeCostRate = closeGasTurnover * scenario.oneWayBps.UNG / 10000
  const preCloseEquityFactor = 1 + step.netReturnPct / 100
  const postCloseCostFactor = 1 - closeCostRate
  if (!(preCloseEquityFactor > 0 && postCloseCostFactor > 0)) {
    throw new Error('Overnight policy produced non-positive equity at the close.')
  }
  const closeTradingCostPct = preCloseEquityFactor * closeCostRate * 100
  const closeWeights = {
    UNG: retainedGasWeight / postCloseCostFactor,
    VOO: (step.state.closeWeights.VOO ?? 0) / postCloseCostFactor,
    QQQM: (step.state.closeWeights.QQQM ?? 0) / postCloseCostFactor,
  }
  return {
    ...step,
    state: { ...step.state, closeWeights },
    netReturnPct: step.netReturnPct - closeTradingCostPct,
    currentSessionReturnContributionPct: step.currentSessionReturnContributionPct - closeTradingCostPct,
    tradingCostPct: step.tradingCostPct + closeTradingCostPct,
    gasTurnover: step.gasTurnover + closeGasTurnover,
    totalTurnover: step.totalTurnover + closeGasTurnover,
    openGasTurnover: step.gasTurnover,
    closeGasTurnover,
    openTradingCostPct: step.tradingCostPct,
    closeTradingCostPct,
    overnightRetentionFraction: retentionFraction,
    preCloseGasWeight,
    overnightGasWeight: closeWeights.UNG,
  }
}

function loadTargets(repoRoot, config) {
  const ledgerPath = path.join(repoRoot, config.sourceTargetLedger)
  const rows = parseCsv(ledgerPath)
    .map((row) => ({
      date: row.targetTradeDate || row.entryTradeDate,
      gasPosition: numberFrom(row.ungPosition, 0),
      investedIndexFraction: numberFrom(row.investedIndexFraction, numberFrom(row.indexFraction, 1)),
    }))
    .filter((row) => row.date)
    .sort((left, right) => left.date.localeCompare(right.date))
  if (!rows.length) throw new Error('The all-year selected target ledger is empty.')
  const duplicateDate = rows.find((row, index) => index && row.date === rows[index - 1].date)
  if (duplicateDate) throw new Error(`The all-year selected target ledger has duplicate date ${duplicateDate.date}.`)
  return { rows, ledgerPath }
}

function simulatePolicy({ repoRoot, policy, scenarioId, config, executionContract, targets }) {
  const targetByDate = new Map(targets.rows.map((row) => [row.date, row]))
  const calendar = loadExecutionCalendar(repoRoot, {
    startDate: targets.rows[0].date,
    endDate: targets.rows.at(-1).date,
    contract: executionContract,
  })
  const missingTargets = calendar.filter((day) => !targetByDate.has(day.date)).map((day) => day.date)
  const missingSessions = targets.rows.filter((row) => !calendar.some((day) => day.date === row.date)).map((row) => row.date)
  if (missingTargets.length || missingSessions.length) {
    throw new Error(`Selected target/calendar mismatch: ${missingTargets.length} missing targets and ${missingSessions.length} missing sessions.`)
  }

  let state = createExecutionState(executionContract)
  const priorAbsoluteOvernightGapsPct = []
  const rows = []
  const scenario = executionContract.scenarios[scenarioId]
  for (const [index, day] of calendar.entries()) {
    const target = targetByDate.get(day.date)
    const baseStep = applyExecutionStep({
      state,
      day,
      targetWeights: targetWeightsForAllocation(executionContract, target),
      contract: executionContract,
      scenarioId,
    })
    const nextDay = calendar[index + 1]
    const nextCalendarGapDays = nextDay
      ? Math.max(1, (Date.parse(nextDay.date) - Date.parse(day.date)) / 86400000)
      : 1
    const retentionFraction = retentionForPolicy(policy, {
      preCloseGasWeight: baseStep.state.closeWeights.UNG ?? 0,
      nextCalendarGapDays,
      priorAbsoluteOvernightGapsPct,
    })
    const step = applyCloseRetention(baseStep, retentionFraction, scenario)
    state = step.state
    rows.push({
      date: day.date,
      split: splitForDate(day.date, config.splitContract),
      netReturnPct: step.netReturnPct,
      grossReturnPct: step.grossReturnPct,
      tradingCostPct: step.tradingCostPct,
      borrowCostPct: step.borrowCostPct,
      openGasTurnover: step.openGasTurnover,
      closeGasTurnover: step.closeGasTurnover,
      gasTurnover: step.gasTurnover,
      indexTurnover: step.indexTurnover,
      totalTurnover: step.totalTurnover,
      openTradingCostPct: step.openTradingCostPct,
      closeTradingCostPct: step.closeTradingCostPct,
      overnightRetentionFraction: step.overnightRetentionFraction,
      overnightGuardActive: step.overnightRetentionFraction < 1,
    })
    priorAbsoluteOvernightGapsPct.push(Math.abs(day.symbols.UNG.overnightReturnPct))
  }
  return rows.filter((row) => row.split !== 'excluded')
}

function metricsFromRows(rows) {
  if (!rows.length) {
    return {
      sessions: 0,
      totalReturnPct: 0,
      cagrPct: 0,
      sharpe: 0,
      maxDrawdownPct: 0,
      calmar: 0,
      totalTurnover: 0,
      gasTurnover: 0,
      indexTurnover: 0,
      openGasTurnover: 0,
      closeGasTurnover: 0,
      tradingCostPct: 0,
      openTradingCostPct: 0,
      closeTradingCostPct: 0,
      guardedSessions: 0,
    }
  }
  const orderedRows = [...rows].sort((left, right) => left.date.localeCompare(right.date))
  const returns = orderedRows.map((row) => row.netReturnPct / 100)
  let equity = 1
  let peak = 1
  let maxDrawdownPct = 0
  for (const dailyReturn of returns) {
    equity = Math.max(0.000001, equity * (1 + dailyReturn))
    peak = Math.max(peak, equity)
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100)
  }
  const years = Math.max(1 / 365.25, (Date.parse(orderedRows.at(-1).date) - Date.parse(orderedRows[0].date)) / 86400000 / 365.25)
  const annualVolatility = standardDeviation(returns) * Math.sqrt(TRADING_DAYS)
  const averageDailyReturn = mean(returns)
  const cagrPct = (equity ** (1 / years) - 1) * 100
  return {
    sessions: orderedRows.length,
    totalReturnPct: round((equity - 1) * 100),
    cagrPct: round(cagrPct),
    sharpe: round(annualVolatility ? averageDailyReturn * TRADING_DAYS / annualVolatility : 0),
    maxDrawdownPct: round(maxDrawdownPct),
    calmar: round(Math.abs(maxDrawdownPct) ? cagrPct / Math.abs(maxDrawdownPct) : 0),
    totalTurnover: round(orderedRows.reduce((sum, row) => sum + row.totalTurnover, 0)),
    gasTurnover: round(orderedRows.reduce((sum, row) => sum + row.gasTurnover, 0)),
    indexTurnover: round(orderedRows.reduce((sum, row) => sum + row.indexTurnover, 0)),
    openGasTurnover: round(orderedRows.reduce((sum, row) => sum + row.openGasTurnover, 0)),
    closeGasTurnover: round(orderedRows.reduce((sum, row) => sum + row.closeGasTurnover, 0)),
    tradingCostPct: round(orderedRows.reduce((sum, row) => sum + row.tradingCostPct, 0)),
    openTradingCostPct: round(orderedRows.reduce((sum, row) => sum + row.openTradingCostPct, 0)),
    closeTradingCostPct: round(orderedRows.reduce((sum, row) => sum + row.closeTradingCostPct, 0)),
    guardedSessions: orderedRows.filter((row) => row.overnightGuardActive).length,
  }
}

function summarizeSimulation(rows) {
  return {
    train: metricsFromRows(rows.filter((row) => row.split === 'train')),
    validation: metricsFromRows(rows.filter((row) => row.split === 'validation')),
    preHoldout: metricsFromRows(rows.filter((row) => row.split === 'train' || row.split === 'validation')),
    holdout: metricsFromRows(rows.filter((row) => row.split === 'holdout')),
    all: metricsFromRows(rows),
  }
}

function annualizedIncrementalTurnover(candidate, carry) {
  const sessions = Math.max(1, candidate.preHoldout.sessions)
  return (candidate.preHoldout.totalTurnover - carry.preHoldout.totalTurnover) * TRADING_DAYS / sessions
}

function scoreCandidate(candidate, carry, config) {
  const eligibility = config.selection.eligibility
  const weights = config.selection.score
  const incrementalAnnualizedTurnover = annualizedIncrementalTurnover(candidate, carry)
  const score =
    (candidate.train.sharpe - carry.train.sharpe) * weights.trainSharpeImprovementWeight +
    (candidate.validation.sharpe - carry.validation.sharpe) * weights.validationSharpeImprovementWeight +
    (candidate.train.calmar - carry.train.calmar) * weights.trainCalmarImprovementWeight +
    (candidate.validation.calmar - carry.validation.calmar) * weights.validationCalmarImprovementWeight -
    Math.max(0, incrementalAnnualizedTurnover) * weights.incrementalAnnualizedTurnoverPenalty
  const isEligible =
    (!eligibility.requiresPositiveSelectionScore || score > 0) &&
    candidate.train.cagrPct >= carry.train.cagrPct * eligibility.minimumTrainCagrRetentionVsCarry &&
    candidate.validation.cagrPct >= carry.validation.cagrPct * eligibility.minimumValidationCagrRetentionVsCarry
  return {
    isEligible,
    selectionScore: round(score),
    incrementalAnnualizedTurnover: round(incrementalAnnualizedTurnover),
  }
}

function compareRankedCandidates(left, right) {
  if (left.isEligible !== right.isEligible) return left.isEligible ? -1 : 1
  if (left.selectionScore !== right.selectionScore) return right.selectionScore - left.selectionScore
  if (left.metrics.validation.sharpe !== right.metrics.validation.sharpe) return right.metrics.validation.sharpe - left.metrics.validation.sharpe
  if (left.metrics.train.sharpe !== right.metrics.train.sharpe) return right.metrics.train.sharpe - left.metrics.train.sharpe
  if (left.incrementalAnnualizedTurnover !== right.incrementalAnnualizedTurnover) {
    return left.incrementalAnnualizedTurnover - right.incrementalAnnualizedTurnover
  }
  return left.policy.policyId.localeCompare(right.policy.policyId)
}

function evaluateHoldoutComparison(challenger, carry, config) {
  const reference = config.holdoutReporting
  const comparisons = {
    sharpe: challenger.holdout.sharpe >= carry.holdout.sharpe * reference.minimumSharpeVsCarryRatio,
    maxDrawdown: reference.maximumDrawdownNoWorseThanCarry
      ? challenger.holdout.maxDrawdownPct >= carry.holdout.maxDrawdownPct
      : true,
    cagr: challenger.holdout.cagrPct >= carry.holdout.cagrPct * reference.minimumCagrVsCarryRatio,
  }
  return {
    reportingOnly: true,
    comparisons,
    meetsAllReferenceThresholds: Object.values(comparisons).every(Boolean),
  }
}

function flattenCandidateRow(result, scenarioId) {
  const row = {
    policyId: result.policy.policyId,
    policyType: result.policy.policyType,
    lookbackSessions: result.policy.lookbackSessions ?? '',
    thresholdPct: result.policy.thresholdPct ?? '',
    retentionFraction: result.policy.retentionFraction ?? '',
    direction: result.policy.direction ?? '',
    scenarioId,
    isSelectionScenario: scenarioId === result.selectionScenarioId,
    selectionEligible: scenarioId === result.selectionScenarioId ? result.isEligible : false,
    selectionScore: scenarioId === result.selectionScenarioId ? result.selectionScore : '',
    selectionRank: scenarioId === result.selectionScenarioId ? result.selectionRank : '',
    selectionUsedHoldout: false,
    incrementalAnnualizedTurnover: scenarioId === result.selectionScenarioId ? result.incrementalAnnualizedTurnover : '',
  }
  for (const split of ['train', 'validation', 'preHoldout', 'holdout', 'all']) {
    for (const [metric, value] of Object.entries(result.scenarios[scenarioId][split])) {
      row[`${split}${metric[0].toUpperCase()}${metric.slice(1)}`] = value
    }
  }
  return row
}

function csvText(rows) {
  return `${Papa.unparse(rows, { newline: '\n' })}\n`
}

export function evaluateOvernightRiskPolicies({ repoRoot = process.cwd(), writeArtifacts = true } = {}) {
  const configPath = path.join(repoRoot, POLICY_CONFIG_PATH)
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const executionContract = loadResearchExecutionContract(repoRoot)
  validatePolicyConfig(config, executionContract)
  const targets = loadTargets(repoRoot, config)
  const policies = buildPolicies(config)
  const scenarioIds = Object.keys(executionContract.scenarios)
  const evaluations = policies.map((policy) => ({
    policy,
    scenarios: Object.fromEntries(scenarioIds.map((scenarioId) => [
      scenarioId,
      summarizeSimulation(simulatePolicy({ repoRoot, policy, scenarioId, config, executionContract, targets })),
    ])),
  }))

  const selectionScenarioId = config.selection.scenarioId
  const carryEvaluation = evaluations.find((evaluation) => evaluation.policy.policyId === 'carry-100')
  const carryMetrics = carryEvaluation.scenarios[selectionScenarioId]
  const ranked = evaluations
    .filter((evaluation) => evaluation.policy.policyId !== 'carry-100')
    .map((evaluation) => {
      const metrics = evaluation.scenarios[selectionScenarioId]
      const scored = scoreCandidate(metrics, carryMetrics, config)
      return { ...evaluation, metrics, ...scored, selectionScenarioId }
    })
    .sort(compareRankedCandidates)
    .map((result, index) => ({ ...result, selectionRank: index + 1 }))
  const selectedChallenger = ranked.find((result) => result.isEligible)
  if (!selectedChallenger) throw new Error('No overnight policy challenger passed the frozen train/validation eligibility rules.')
  const holdoutComparison = evaluateHoldoutComparison(selectedChallenger.metrics, carryMetrics, config)
  const promotionRecommendationPolicyId = selectedChallenger.policy.policyId

  const rankedById = new Map(ranked.map((result) => [result.policy.policyId, result]))
  const csvRows = evaluations.flatMap((evaluation) => {
    const rankedResult = rankedById.get(evaluation.policy.policyId)
    const result = rankedResult ?? {
      ...evaluation,
      metrics: evaluation.scenarios[selectionScenarioId],
      isEligible: true,
      selectionScore: 0,
      selectionRank: 0,
      incrementalAnnualizedTurnover: 0,
      selectionScenarioId,
    }
    return scenarioIds.map((scenarioId) => flattenCandidateRow(result, scenarioId))
  })
  const summary = {
    schemaVersion: 1,
    generatedAt: 'deterministic-from-versioned-inputs',
    strategyId: 'ngas-all-year-beta',
    policyContractId: config.contractId,
    executionContractId: executionContract.contractId,
    selectionScenarioId,
    selectionUsedHoldout: false,
    candidateCount: policies.length,
    scenarioIds,
    inputDigests: {
      policyConfigSha256: fileDigest(configPath),
      executionContractSha256: executionContract.digest,
      selectedTargetsSha256: fileDigest(targets.ledgerPath),
    },
    frozenSelectionScore: config.selection.score,
    carryPolicy: {
      policyId: 'carry-100',
      scenarios: carryEvaluation.scenarios,
    },
    selectedChallenger: {
      policyId: selectedChallenger.policy.policyId,
      policy: selectedChallenger.policy,
      selectionRank: selectedChallenger.selectionRank,
      selectionScore: selectedChallenger.selectionScore,
      incrementalAnnualizedTurnover: selectedChallenger.incrementalAnnualizedTurnover,
      baselineMetrics: selectedChallenger.metrics,
      scenarioMetrics: selectedChallenger.scenarios,
    },
    holdoutComparison,
    promotionRecommendationPolicyId,
    recommendationBasis: 'train-validation-only',
    deployedPolicyId: config.deployedPolicyId,
    deploymentMatchesRecommendation: promotionRecommendationPolicyId === config.deployedPolicyId,
    artifacts: {
      candidateSummary: CANDIDATE_SUMMARY_PATH,
      summary: SUMMARY_PATH,
    },
  }

  if (writeArtifacts) {
    const outputDirectory = path.join(repoRoot, OUTPUT_DIRECTORY)
    fs.mkdirSync(outputDirectory, { recursive: true })
    fs.writeFileSync(path.join(repoRoot, CANDIDATE_SUMMARY_PATH), csvText(csvRows))
    fs.writeFileSync(path.join(repoRoot, SUMMARY_PATH), `${JSON.stringify(summary, null, 2)}\n`)
  }
  return { summary, candidateRows: csvRows }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const { summary } = evaluateOvernightRiskPolicies()
  console.log([
    `overnight-risk candidates=${summary.candidateCount}`,
    `challenger=${summary.selectedChallenger.policyId}`,
    `holdoutComparison=${summary.holdoutComparison.meetsAllReferenceThresholds ? 'meets-reference' : 'below-reference'}`,
    `recommendation=${summary.promotionRecommendationPolicyId}`,
    `deployed=${summary.deployedPolicyId}`,
  ].join(' '))
}
