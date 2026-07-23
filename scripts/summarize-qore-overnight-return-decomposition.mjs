#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'

const OUTPUT_DIRECTORY = 'data/qore/research/strategy-agent-runs/ngas-all-year-beta'
const SELECTED_TRADES_PATH = `${OUTPUT_DIRECTORY}/selected-trades.csv`
const OVERNIGHT_RISK_SUMMARY_PATH = `${OUTPUT_DIRECTORY}/overnight-risk-summary.json`
const OVERNIGHT_RISK_CANDIDATES_PATH = `${OUTPUT_DIRECTORY}/overnight-risk-candidate-summary.csv`
const RUN_SUMMARY_PATH = `${OUTPUT_DIRECTORY}/run-summary.json`
const POLICY_CONFIG_PATH = 'config/qore-overnight-risk-policy.json'
const EXECUTION_CONFIG_PATH = 'config/qore-research-execution.json'
const MARKET_DATA_PATHS = {
  UNG: 'data/qore/market/yahoo/UNG-daily.csv',
  VOO: 'data/qore/market/yahoo/VOO-daily.csv',
  QQQM: 'data/qore/market/yahoo/QQQM-daily.csv',
}
const SUMMARY_PATH = `${OUTPUT_DIRECTORY}/overnight-return-decomposition.json`
const LEDGER_PATH = `${OUTPUT_DIRECTORY}/overnight-return-decomposition.csv`
const GENERATOR_PATH = 'scripts/summarize-qore-overnight-return-decomposition.mjs'
const FIXED_RETENTION_POLICY_IDS = [
  'carry-100',
  'cash-retain-75',
  'cash-retain-50',
  'cash-retain-25',
  'cash-retain-0',
]
const PERIODS = ['train', 'validation', 'holdout', 'all']
const EPSILON = 1e-10

function round(value, digits = 8) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function requiredNumber(row, field, label) {
  const source = row[field]
  if (source === undefined || source === null || `${source}`.trim() === '') {
    throw new Error(`${label} is missing ${field}.`)
  }
  const parsed = Number(source)
  if (!Number.isFinite(parsed)) throw new Error(`${label} has invalid ${field}: ${source}`)
  return parsed
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

function fileDigest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function textDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function csvText(rows) {
  return `${Papa.unparse(rows, { newline: '\n' })}\n`
}

function dateForRow(row) {
  return row.targetTradeDate || row.entryTradeDate
}

function riskSplitForDate(date, split) {
  if (date >= split.trainStartDate && date <= split.trainEndDate) return 'train'
  if (date >= split.validationStartDate && date <= split.validationEndDate) return 'validation'
  if (date >= split.holdoutStartDate) return 'holdout'
  return 'excluded'
}

function seasonForStrategyId(strategyId) {
  if (strategyId === 'ngas-summer-alpha') return 'summer'
  if (strategyId === 'ngas-winter-alpha') return 'winter'
  if (!strategyId) return ''
  throw new Error(`Unknown component strategy in selected-trades: ${strategyId}`)
}

function sum(rows, field) {
  return round(rows.reduce((total, row) => total + row[field], 0))
}

function average(rows, field) {
  return rows.length ? round(rows.reduce((total, row) => total + row[field], 0) / rows.length) : 0
}

function assertUniqueChronologicalRows(rows) {
  for (const [index, row] of rows.entries()) {
    if (!row.date) throw new Error(`selected-trades row ${index + 1} is missing a trade date.`)
    if (index && rows[index - 1].date >= row.date) {
      throw new Error(`selected-trades must be strictly chronological; found ${rows[index - 1].date} then ${row.date}.`)
    }
  }
}

function buildAuditRows(sourceRows, splitContract) {
  const ordered = sourceRows
    .map((row) => ({ ...row, date: dateForRow(row) }))
    .filter((row) => row.date)
    .sort((left, right) => left.date.localeCompare(right.date))
  assertUniqueChronologicalRows(ordered)

  return ordered.map((row, index) => {
    const label = `selected-trades ${row.date}`
    const priorSourceRow = ordered[index - 1]
    const riskSplit = riskSplitForDate(row.date, splitContract)
    if (riskSplit === 'excluded') {
      throw new Error(`${label} falls outside the overnight-risk split contract.`)
    }

    const preTradeOpenUngWeight = requiredNumber(row, 'priorUngPosition', label)
    const deployedUngWeight = requiredNumber(row, 'deployedUngPosition', label)
    const targetUngPosition = requiredNumber(row, 'ungPosition', label)
    const ungOvernightReturnPct = requiredNumber(row, 'ungOvernightReturnPct', label)
    const ungIntradayReturnPct = requiredNumber(row, 'ungIntradayReturnPct', label)
    const grossPortfolioCloseToOpenContributionPct = requiredNumber(row, 'overnightPortfolioReturnPct', label)
    const grossPortfolioOpenToCloseContributionPctOnOpenEquity = requiredNumber(
      row,
      'intradayPortfolioReturnPct',
      label,
    )
    const closeToOpenNetContributionPct = requiredNumber(row, 'priorCloseReturnContributionPct', label)
    const openToCloseNetContributionPct = requiredNumber(row, 'currentSessionReturnContributionPct', label)
    const reportedNetReturnPct = requiredNumber(row, 'netReturnPct', label)
    const reportedGrossReturnPct = requiredNumber(row, 'grossReturnPct', label)
    const gasTradingCostPct = requiredNumber(row, 'gasTradingCostPct', label)
    const vooTradingCostPct = requiredNumber(row, 'vooTradingCostPct', label)
    const qqqmTradingCostPct = requiredNumber(row, 'qqqmTradingCostPct', label)
    const indexTradingCostPct = vooTradingCostPct + qqqmTradingCostPct
    const openTradingCostPct = gasTradingCostPct + indexTradingCostPct
    const borrowCostPct = requiredNumber(row, 'borrowCostPct', label)

    const ungOvernightFactor = 1 + ungOvernightReturnPct / 100
    const portfolioOvernightFactor = 1 + grossPortfolioCloseToOpenContributionPct / 100
    if (!(ungOvernightFactor > 0 && portfolioOvernightFactor > 0)) {
      throw new Error(`${label} has a non-positive overnight factor.`)
    }
    // selected-trades stores the drifted UNG weight at the current open. Undo
    // that drift to recover the weight that actually earned the overnight gap.
    const priorCloseUngWeight = preTradeOpenUngWeight * portfolioOvernightFactor / ungOvernightFactor
    const grossUngCloseToOpenContributionPct = priorCloseUngWeight * ungOvernightReturnPct
    const grossUngOpenToCloseContributionPctOnOpenEquity = deployedUngWeight * ungIntradayReturnPct
    const grossIndexCloseToOpenContributionPct =
      grossPortfolioCloseToOpenContributionPct - grossUngCloseToOpenContributionPct
    const grossIndexOpenToCloseContributionPctOnOpenEquity =
      grossPortfolioOpenToCloseContributionPctOnOpenEquity -
      grossUngOpenToCloseContributionPctOnOpenEquity
    const grossPortfolioInteractionContributionPct =
      grossPortfolioCloseToOpenContributionPct *
      grossPortfolioOpenToCloseContributionPctOnOpenEquity /
      100
    const grossUngOpenToCloseInteractionContributionPct =
      grossPortfolioCloseToOpenContributionPct *
      grossUngOpenToCloseContributionPctOnOpenEquity /
      100
    const grossIndexOpenToCloseInteractionContributionPct =
      grossPortfolioCloseToOpenContributionPct *
      grossIndexOpenToCloseContributionPctOnOpenEquity /
      100
    const grossPortfolioOpenToCloseContributionPctOnPriorCloseEquity =
      grossPortfolioOpenToCloseContributionPctOnOpenEquity +
      grossPortfolioInteractionContributionPct
    const grossUngOpenToCloseContributionPctOnPriorCloseEquity =
      grossUngOpenToCloseContributionPctOnOpenEquity +
      grossUngOpenToCloseInteractionContributionPct
    const grossIndexOpenToCloseContributionPctOnPriorCloseEquity =
      grossIndexOpenToCloseContributionPctOnOpenEquity +
      grossIndexOpenToCloseInteractionContributionPct

    const ungCloseToOpenNetContributionPct = grossUngCloseToOpenContributionPct - borrowCostPct
    const indexCloseToOpenNetContributionPct = grossIndexCloseToOpenContributionPct
    const ungOpenToCloseNetContributionPct =
      grossUngOpenToCloseContributionPctOnPriorCloseEquity - gasTradingCostPct
    const indexOpenToCloseNetContributionPct =
      grossIndexOpenToCloseContributionPctOnPriorCloseEquity - indexTradingCostPct
    const additiveNetReturnPct = closeToOpenNetContributionPct + openToCloseNetContributionPct
    const grossAdditiveReturnPct =
      grossPortfolioCloseToOpenContributionPct +
      grossPortfolioOpenToCloseContributionPctOnPriorCloseEquity
    const currentComponentStrategyId = row.componentStrategyId
    const priorCloseComponentStrategyId = priorSourceRow?.componentStrategyId ?? ''

    return {
      date: row.date,
      overnightRiskSplit: riskSplit,
      allYearSplit: row.split,
      currentComponentStrategyId,
      priorCloseComponentStrategyId,
      currentSessionSeason: seasonForStrategyId(currentComponentStrategyId),
      priorCloseSeason: seasonForStrategyId(priorCloseComponentStrategyId),
      currentThesisKind: row.thesisKind,
      priorCloseThesisKind: row.priorCloseThesisKind,
      targetUngPosition: round(targetUngPosition),
      priorCloseUngWeight: round(priorCloseUngWeight),
      preTradeOpenUngWeight: round(preTradeOpenUngWeight),
      deployedUngWeight: round(deployedUngWeight),
      priorCloseOverlayActive: Math.abs(priorCloseUngWeight) > EPSILON,
      currentSessionOverlayActive: Math.abs(deployedUngWeight) > EPSILON,
      eitherOverlayActive: Math.abs(priorCloseUngWeight) > EPSILON || Math.abs(deployedUngWeight) > EPSILON,
      ungOvernightReturnPct: round(ungOvernightReturnPct),
      ungIntradayReturnPct: round(ungIntradayReturnPct),
      grossPortfolioCloseToOpenContributionPct: round(grossPortfolioCloseToOpenContributionPct),
      grossPortfolioOpenToCloseContributionPctOnOpenEquity: round(
        grossPortfolioOpenToCloseContributionPctOnOpenEquity,
      ),
      grossPortfolioInteractionContributionPct: round(grossPortfolioInteractionContributionPct),
      grossPortfolioOpenToCloseContributionPctOnPriorCloseEquity: round(
        grossPortfolioOpenToCloseContributionPctOnPriorCloseEquity,
      ),
      closeToOpenNetContributionPct: round(closeToOpenNetContributionPct),
      openToCloseNetContributionPct: round(openToCloseNetContributionPct),
      additiveNetReturnPct: round(additiveNetReturnPct),
      reportedNetReturnPct: round(reportedNetReturnPct),
      reportedNetReconciliationResidualPct: round(additiveNetReturnPct - reportedNetReturnPct),
      reportedGrossReturnPct: round(reportedGrossReturnPct),
      grossAdditiveReturnPct: round(grossAdditiveReturnPct),
      reportedGrossReconciliationResidualPct: round(grossAdditiveReturnPct - reportedGrossReturnPct),
      grossUngCloseToOpenContributionPct: round(grossUngCloseToOpenContributionPct),
      grossUngOpenToCloseContributionPctOnOpenEquity: round(
        grossUngOpenToCloseContributionPctOnOpenEquity,
      ),
      grossUngOpenToCloseInteractionContributionPct: round(
        grossUngOpenToCloseInteractionContributionPct,
      ),
      grossUngOpenToCloseContributionPctOnPriorCloseEquity: round(
        grossUngOpenToCloseContributionPctOnPriorCloseEquity,
      ),
      ungCloseToOpenNetContributionPct: round(ungCloseToOpenNetContributionPct),
      ungOpenToCloseNetContributionPct: round(ungOpenToCloseNetContributionPct),
      ungAdditiveNetContributionPct: round(
        ungCloseToOpenNetContributionPct + ungOpenToCloseNetContributionPct,
      ),
      grossIndexCloseToOpenContributionPct: round(grossIndexCloseToOpenContributionPct),
      grossIndexOpenToCloseContributionPctOnOpenEquity: round(
        grossIndexOpenToCloseContributionPctOnOpenEquity,
      ),
      grossIndexOpenToCloseInteractionContributionPct: round(
        grossIndexOpenToCloseInteractionContributionPct,
      ),
      grossIndexOpenToCloseContributionPctOnPriorCloseEquity: round(
        grossIndexOpenToCloseContributionPctOnPriorCloseEquity,
      ),
      indexCloseToOpenNetContributionPct: round(indexCloseToOpenNetContributionPct),
      indexOpenToCloseNetContributionPct: round(indexOpenToCloseNetContributionPct),
      indexAdditiveNetContributionPct: round(
        indexCloseToOpenNetContributionPct + indexOpenToCloseNetContributionPct,
      ),
      openTradingCostPct: round(openTradingCostPct),
      gasTradingCostPct: round(gasTradingCostPct),
      indexTradingCostPct: round(indexTradingCostPct),
      borrowCostPct: round(borrowCostPct),
      frictionContractId: row.frictionContractId,
      frictionScenarioId: row.frictionScenarioId,
      executionPriceConvention: row.executionPriceConvention,
    }
  })
}

function aggregatePortfolio(rows) {
  return {
    sessions: rows.length,
    startDate: rows[0]?.date ?? null,
    endDate: rows.at(-1)?.date ?? null,
    ledgerNet: {
      closeToOpenContributionPct: sum(rows, 'closeToOpenNetContributionPct'),
      openToCloseContributionPct: sum(rows, 'openToCloseNetContributionPct'),
      additiveContributionPct: sum(rows, 'additiveNetReturnPct'),
    },
    grossPortfolio: {
      closeToOpenContributionPct: sum(rows, 'grossPortfolioCloseToOpenContributionPct'),
      openToCloseContributionPctOnOpenEquity: sum(
        rows,
        'grossPortfolioOpenToCloseContributionPctOnOpenEquity',
      ),
      openToCloseInteractionContributionPct: sum(rows, 'grossPortfolioInteractionContributionPct'),
      openToCloseContributionPctOnPriorCloseEquity: sum(
        rows,
        'grossPortfolioOpenToCloseContributionPctOnPriorCloseEquity',
      ),
    },
    grossUng: {
      closeToOpenContributionPct: sum(rows, 'grossUngCloseToOpenContributionPct'),
      openToCloseContributionPctOnOpenEquity: sum(
        rows,
        'grossUngOpenToCloseContributionPctOnOpenEquity',
      ),
      openToCloseInteractionContributionPct: sum(
        rows,
        'grossUngOpenToCloseInteractionContributionPct',
      ),
      openToCloseContributionPctOnPriorCloseEquity: sum(
        rows,
        'grossUngOpenToCloseContributionPctOnPriorCloseEquity',
      ),
    },
    netUng: {
      closeToOpenContributionPct: sum(rows, 'ungCloseToOpenNetContributionPct'),
      openToCloseContributionPct: sum(rows, 'ungOpenToCloseNetContributionPct'),
      additiveContributionPct: sum(rows, 'ungAdditiveNetContributionPct'),
    },
    netIndex: {
      closeToOpenContributionPct: sum(rows, 'indexCloseToOpenNetContributionPct'),
      openToCloseContributionPct: sum(rows, 'indexOpenToCloseNetContributionPct'),
      additiveContributionPct: sum(rows, 'indexAdditiveNetContributionPct'),
    },
    activeOverlay: {
      priorCloseSessions: rows.filter((row) => row.priorCloseOverlayActive).length,
      currentSessionSessions: rows.filter((row) => row.currentSessionOverlayActive).length,
      eitherSessionCount: rows.filter((row) => row.eitherOverlayActive).length,
      priorCloseLongSessions: rows.filter((row) => row.priorCloseUngWeight > EPSILON).length,
      priorCloseShortSessions: rows.filter((row) => row.priorCloseUngWeight < -EPSILON).length,
      currentSessionLongSessions: rows.filter((row) => row.deployedUngWeight > EPSILON).length,
      currentSessionShortSessions: rows.filter((row) => row.deployedUngWeight < -EPSILON).length,
      meanAbsoluteUngOvernightReturnPct: average(
        rows.filter((row) => row.priorCloseOverlayActive).map((row) => ({
          value: Math.abs(row.ungOvernightReturnPct),
        })),
        'value',
      ),
    },
    costs: {
      openTradingCostPct: sum(rows, 'openTradingCostPct'),
      gasTradingCostPct: sum(rows, 'gasTradingCostPct'),
      indexTradingCostPct: sum(rows, 'indexTradingCostPct'),
      borrowCostPct: sum(rows, 'borrowCostPct'),
    },
  }
}

function aggregateSeason(rows, season) {
  const priorCloseRows = rows.filter(
    (row) => row.priorCloseSeason === season && row.priorCloseOverlayActive,
  )
  const currentSessionRows = rows.filter(
    (row) => row.currentSessionSeason === season && row.currentSessionOverlayActive,
  )
  return {
    priorCloseActiveSessions: priorCloseRows.length,
    currentSessionActiveSessions: currentSessionRows.length,
    grossUngCloseToOpenContributionPct: sum(priorCloseRows, 'grossUngCloseToOpenContributionPct'),
    grossUngOpenToCloseContributionPctOnOpenEquity: sum(
      currentSessionRows,
      'grossUngOpenToCloseContributionPctOnOpenEquity',
    ),
    grossUngOpenToCloseInteractionContributionPct: sum(
      currentSessionRows,
      'grossUngOpenToCloseInteractionContributionPct',
    ),
    netUngCloseToOpenContributionPct: sum(priorCloseRows, 'ungCloseToOpenNetContributionPct'),
    netUngOpenToCloseContributionPct: sum(currentSessionRows, 'ungOpenToCloseNetContributionPct'),
    netUngAdditiveContributionPct: round(
      sum(priorCloseRows, 'ungCloseToOpenNetContributionPct') +
      sum(currentSessionRows, 'ungOpenToCloseNetContributionPct'),
    ),
  }
}

function aggregateByPeriod(rows) {
  return Object.fromEntries(PERIODS.map((period) => [
    period,
    aggregatePortfolio(period === 'all' ? rows : rows.filter((row) => row.overnightRiskSplit === period)),
  ]))
}

function aggregateBySeason(rows) {
  return Object.fromEntries(['summer', 'winter'].map((season) => [
    season,
    Object.fromEntries(PERIODS.map((period) => {
      const periodRows = period === 'all'
        ? rows
        : rows.filter((row) => row.overnightRiskSplit === period)
      return [period, aggregateSeason(periodRows, season)]
    })),
  ]))
}

function candidateMetrics(row, prefix) {
  return {
    sessions: requiredNumber(row, `${prefix}Sessions`, `${row.policyId} ${prefix}`),
    totalReturnPct: requiredNumber(row, `${prefix}TotalReturnPct`, `${row.policyId} ${prefix}`),
    cagrPct: requiredNumber(row, `${prefix}CagrPct`, `${row.policyId} ${prefix}`),
    sharpe: requiredNumber(row, `${prefix}Sharpe`, `${row.policyId} ${prefix}`),
    maxDrawdownPct: requiredNumber(row, `${prefix}MaxDrawdownPct`, `${row.policyId} ${prefix}`),
    totalTurnover: requiredNumber(row, `${prefix}TotalTurnover`, `${row.policyId} ${prefix}`),
    gasTurnover: requiredNumber(row, `${prefix}GasTurnover`, `${row.policyId} ${prefix}`),
    closeGasTurnover: requiredNumber(row, `${prefix}CloseGasTurnover`, `${row.policyId} ${prefix}`),
    tradingCostPct: requiredNumber(row, `${prefix}TradingCostPct`, `${row.policyId} ${prefix}`),
  }
}

function fixedRetentionComparisons(candidateRows, scenarioId) {
  const byPolicyId = new Map(
    candidateRows
      .filter((row) => row.policyType === 'fixed-retention' && row.scenarioId === scenarioId)
      .map((row) => [row.policyId, row]),
  )
  const missing = FIXED_RETENTION_POLICY_IDS.filter((policyId) => !byPolicyId.has(policyId))
  if (missing.length) throw new Error(`Fixed-retention candidate summary is missing: ${missing.join(', ')}`)
  const carry = byPolicyId.get('carry-100')
  const carryMetrics = Object.fromEntries(
    [...PERIODS, 'preHoldout'].map((period) => [period, candidateMetrics(carry, period)]),
  )
  const policies = FIXED_RETENTION_POLICY_IDS.map((policyId) => {
    const row = byPolicyId.get(policyId)
    const metrics = Object.fromEntries(
      [...PERIODS, 'preHoldout'].map((period) => [period, candidateMetrics(row, period)]),
    )
    return {
      policyId,
      retentionFraction: requiredNumber(row, 'retentionFraction', policyId),
      scenarioId,
      metrics,
      deltaVsCarry: Object.fromEntries(
        [...PERIODS, 'preHoldout'].map((period) => [period, {
          totalReturnPct: round(metrics[period].totalReturnPct - carryMetrics[period].totalReturnPct),
          cagrPct: round(metrics[period].cagrPct - carryMetrics[period].cagrPct),
          sharpe: round(metrics[period].sharpe - carryMetrics[period].sharpe),
          maxDrawdownPct: round(
            metrics[period].maxDrawdownPct - carryMetrics[period].maxDrawdownPct,
          ),
          tradingCostPct: round(
            metrics[period].tradingCostPct - carryMetrics[period].tradingCostPct,
          ),
        }]),
      ),
    }
  })
  return {
    scenarioId,
    policies,
    allCagrStrictlyDeclinesAsRetentionFalls: policies.every(
      (policy, index) => !index || policy.metrics.all.cagrPct < policies[index - 1].metrics.all.cagrPct,
    ),
  }
}

function maxAbsolute(rows, field) {
  return round(Math.max(0, ...rows.map((row) => Math.abs(row[field]))))
}

function inputBinding(repoRoot, relativePath) {
  return {
    path: relativePath,
    sha256: fileDigest(path.join(repoRoot, relativePath)),
  }
}

export function summarizeQoreOvernightReturnDecomposition({
  repoRoot = process.cwd(),
  writeArtifacts = true,
} = {}) {
  const sourcePaths = {
    selectedTrades: path.join(repoRoot, SELECTED_TRADES_PATH),
    overnightRiskSummary: path.join(repoRoot, OVERNIGHT_RISK_SUMMARY_PATH),
    overnightRiskCandidates: path.join(repoRoot, OVERNIGHT_RISK_CANDIDATES_PATH),
    policyConfig: path.join(repoRoot, POLICY_CONFIG_PATH),
  }
  const policyConfig = JSON.parse(fs.readFileSync(sourcePaths.policyConfig, 'utf8'))
  const overnightRiskSummary = JSON.parse(fs.readFileSync(sourcePaths.overnightRiskSummary, 'utf8'))
  const selectedTradesDigest = fileDigest(sourcePaths.selectedTrades)
  if (policyConfig.deployedPolicyId !== 'carry-100' || overnightRiskSummary.deployedPolicyId !== 'carry-100') {
    throw new Error('Overnight return decomposition requires deployedPolicyId=carry-100.')
  }
  if (overnightRiskSummary.inputDigests?.selectedTargetsSha256 !== selectedTradesDigest) {
    throw new Error('Overnight risk summary is not bound to the current selected-trades ledger.')
  }

  const rows = buildAuditRows(parseCsv(sourcePaths.selectedTrades), policyConfig.splitContract)
  const ledgerText = csvText(rows)
  const byRiskSplit = aggregateByPeriod(rows)
  const bySeason = aggregateBySeason(rows)
  const preHoldoutRows = rows.filter((row) => row.overnightRiskSplit !== 'holdout')
  const holdoutRows = rows.filter((row) => row.overnightRiskSplit === 'holdout')
  const preHoldoutGrossUngCloseToOpenContributionPct = sum(
    preHoldoutRows,
    'grossUngCloseToOpenContributionPct',
  )
  const holdoutGrossUngCloseToOpenContributionPct = sum(
    holdoutRows,
    'grossUngCloseToOpenContributionPct',
  )
  const fixedRetention = fixedRetentionComparisons(
    parseCsv(sourcePaths.overnightRiskCandidates),
    overnightRiskSummary.selectionScenarioId,
  )
  const holdoutComparisons = overnightRiskSummary.holdoutComparison?.comparisons ?? {}
  const challengerFailsAllHoldoutGates =
    overnightRiskSummary.holdoutComparison?.meetsAllReferenceThresholds === false &&
    ['sharpe', 'maxDrawdown', 'cagr'].every((gate) => holdoutComparisons[gate] === false)
  const signReversal =
    preHoldoutGrossUngCloseToOpenContributionPct < 0 &&
    holdoutGrossUngCloseToOpenContributionPct > 0
  if (!challengerFailsAllHoldoutGates) {
    throw new Error('Selected overnight challenger does not fail all frozen holdout reference gates.')
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: 'deterministic-from-versioned-inputs',
    strategyId: 'ngas-all-year-beta',
    researchOnly: true,
    sessionCount: rows.length,
    startDate: rows[0]?.date ?? null,
    endDate: rows.at(-1)?.date ?? null,
    splitContract: policyConfig.splitContract,
    executionInterpretation: {
      closeToOpen:
        'priorCloseReturnContributionPct: prior-close holdings earn the overnight move and accrue borrow cost.',
      openToClose:
        'currentSessionReturnContributionPct: current-open holdings earn the intraday move, including the overnight/intraday interaction and open trading costs.',
      additiveIdentity:
        'closeToOpenNetContributionPct + openToCloseNetContributionPct = additiveNetReturnPct before the selected-trades four-decimal display rounding.',
      priceConvention: rows[0]?.executionPriceConvention ?? null,
      auctionExecutionEvidence: false,
    },
    inputBindings: {
      selectedTrades: inputBinding(repoRoot, SELECTED_TRADES_PATH),
      overnightRiskSummary: inputBinding(repoRoot, OVERNIGHT_RISK_SUMMARY_PATH),
      overnightRiskCandidateSummary: inputBinding(repoRoot, OVERNIGHT_RISK_CANDIDATES_PATH),
      allYearRunSummary: inputBinding(repoRoot, RUN_SUMMARY_PATH),
      overnightRiskPolicyConfig: inputBinding(repoRoot, POLICY_CONFIG_PATH),
      researchExecutionConfig: inputBinding(repoRoot, EXECUTION_CONFIG_PATH),
      marketData: Object.fromEntries(
        Object.entries(MARKET_DATA_PATHS).map(([symbol, relativePath]) => [
          symbol,
          inputBinding(repoRoot, relativePath),
        ]),
      ),
      generator: inputBinding(repoRoot, GENERATOR_PATH),
    },
    reconciliation: {
      maxAbsoluteReportedNetResidualPct: maxAbsolute(rows, 'reportedNetReconciliationResidualPct'),
      maxAbsoluteReportedGrossResidualPct: maxAbsolute(rows, 'reportedGrossReconciliationResidualPct'),
      maxAbsoluteCloseToOpenLegResidualPct: round(Math.max(
        0,
        ...rows.map((row) => Math.abs(
          row.ungCloseToOpenNetContributionPct +
          row.indexCloseToOpenNetContributionPct -
          row.closeToOpenNetContributionPct
        )),
      )),
      maxAbsoluteOpenToCloseLegResidualPct: round(Math.max(
        0,
        ...rows.map((row) => Math.abs(
          row.ungOpenToCloseNetContributionPct +
          row.indexOpenToCloseNetContributionPct -
          row.openToCloseNetContributionPct
        )),
      )),
    },
    aggregates: {
      byRiskSplit,
      ungOverlayBySeason: bySeason,
    },
    fixedRetentionComparison: fixedRetention,
    regimeDiagnostic: {
      preHoldoutGrossUngCloseToOpenContributionPct,
      holdoutGrossUngCloseToOpenContributionPct,
      grossUngCloseToOpenSignReversed: signReversal,
    },
    decision: {
      deploymentPolicyId: 'carry-100',
      promotionEligible: false,
      selectedChallengerPolicyId: overnightRiskSummary.selectedChallenger.policyId,
      selectedChallengerHoldoutComparisons: holdoutComparisons,
      selectedChallengerFailsAllHoldoutGates: challengerFailsAllHoldoutGates,
      reasons: [
        signReversal
          ? 'gross-ung-close-to-open-contribution-reverses-from-negative-pre-holdout-to-positive-holdout'
          : 'gross-ung-close-to-open-contribution-does-not-show-a-negative-pre-holdout-to-positive-holdout-reversal',
        'selected-challenger-fails-sharpe-max-drawdown-and-cagr-holdout-reference-gates',
        'fixed-retention-all-period-cagr-declines-as-overnight-retention-is-reduced',
        'daily-adjusted-bars-do-not-provide-auction-fill-evidence',
      ],
    },
    artifacts: {
      ledger: {
        path: LEDGER_PATH,
        sha256: textDigest(ledgerText),
      },
      summary: {
        path: SUMMARY_PATH,
      },
    },
  }

  if (writeArtifacts) {
    fs.mkdirSync(path.join(repoRoot, OUTPUT_DIRECTORY), { recursive: true })
    fs.writeFileSync(path.join(repoRoot, LEDGER_PATH), ledgerText)
    fs.writeFileSync(path.join(repoRoot, SUMMARY_PATH), `${JSON.stringify(summary, null, 2)}\n`)
  }
  return { summary, rows, ledgerText }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const { summary } = summarizeQoreOvernightReturnDecomposition()
  const all = summary.aggregates.byRiskSplit.all
  console.log([
    `overnight-return-decomposition sessions=${summary.sessionCount}`,
    `ung-close-to-open=${all.grossUng.closeToOpenContributionPct}%`,
    `ung-open-to-close=${all.grossUng.openToCloseContributionPctOnOpenEquity}%`,
    `signReversal=${summary.regimeDiagnostic.grossUngCloseToOpenSignReversed}`,
    `promotionEligible=${summary.decision.promotionEligible}`,
    `deployed=${summary.decision.deploymentPolicyId}`,
  ].join(' '))
}
