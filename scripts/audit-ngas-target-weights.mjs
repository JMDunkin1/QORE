#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import {
  applyExecutionStep,
  createExecutionState,
  loadExecutionCalendar,
  loadResearchExecutionContract,
  targetWeightsForAllocation,
} from './lib/qore-research-execution.mjs'
import {
  executableLiveComponentContractDigestSha256,
  executableLiveGasPositionCaps,
} from './lib/qore-live-contract.mjs'

const REPO_ROOT = process.cwd()
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const LEDGER = path.join(
  REPO_ROOT,
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv',
)
const EXECUTION_CONFIG_PATH = path.join(REPO_ROOT, 'config/qore-research-execution.json')
const INDEX_BASKET_CONFIG_PATH = path.join(REPO_ROOT, 'data/qore/market/index-basket-config.json')
const MARKET_PATHS = Object.fromEntries(
  ['UNG', 'VOO', 'QQQM'].map((symbol) => [
    symbol,
    path.join(REPO_ROOT, `data/qore/market/yahoo/${symbol}-daily.csv`),
  ]),
)
const SIMULATOR_PATHS = [
  path.join(REPO_ROOT, 'scripts/lib/qore-research-execution.mjs'),
  path.join(REPO_ROOT, 'scripts/lib/qore-rebalance-deadband.mjs'),
]
const EXECUTION = loadResearchExecutionContract(REPO_ROOT)
const LEDGER_BYTES = fs.readFileSync(LEDGER)

const LEG_KEYS = [
  'summer-follow',
  'summer-fade',
  'winter-cold-follow',
  'winter-warm-short',
  'winter-reversion-long',
  'winter-reversion-short',
]
const LEG_CAP_COORDINATES = {
  'summer-follow': ['summer', 'weather-follow', 'summer-heat-long'],
  'summer-fade': ['summer', 'weather-reversion', 'reversion-short'],
  'winter-cold-follow': ['winter', 'weather-follow', 'cold-long'],
  'winter-warm-short': ['winter', 'weather-follow', 'warm-short'],
  'winter-reversion-long': ['winter', 'weather-reversion', 'reversion-long'],
  'winter-reversion-short': ['winter', 'weather-reversion', 'reversion-short'],
}
const LEG_CAPS = Object.freeze(Object.fromEntries(
  Object.entries(LEG_CAP_COORDINATES).map(([leg, [season, windowId, thesisKind]]) => {
    const cap = executableLiveGasPositionCaps[season]?.[windowId]?.[thesisKind]
    if (!Number.isFinite(cap) || cap <= 0 || cap > 1) {
      throw new Error(`Reviewed executable cap is unavailable or invalid for ${leg}.`)
    }
    return [leg, cap]
  }),
))
const BASELINE_TIE_OUT_TOLERANCES = Object.freeze({
  gasPosition: 1e-12,
  dailyNetReturnPct: 0.0000501,
  totalTurnover: 1e-8,
  endingEquityPct: 0.0001,
})

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function canonicalDigestSha256(value) {
  return sha256(JSON.stringify(canonicalize(value)))
}

function provenanceFile(role, filePath, bytes = fs.readFileSync(filePath)) {
  return {
    role,
    path: path.relative(REPO_ROOT, filePath),
    byteLength: bytes.length,
    digestSha256: sha256(bytes),
  }
}

function buildAuditProvenance() {
  const dataAndConfigFiles = [
    provenanceFile('selected-target-ledger', LEDGER, LEDGER_BYTES),
    provenanceFile('research-execution-contract', EXECUTION_CONFIG_PATH),
    provenanceFile('index-basket-config', INDEX_BASKET_CONFIG_PATH),
    ...Object.entries(MARKET_PATHS).map(([symbol, filePath]) => (
      provenanceFile(`${symbol}-adjusted-daily-market-bars`, filePath)
    )),
  ]
  const simulatorFiles = [
    provenanceFile('audit-runner', SCRIPT_PATH),
    ...SIMULATOR_PATHS.map((filePath) => provenanceFile('execution-simulator-source', filePath)),
  ]
  const binding = {
    schemaVersion: 1,
    executionContractDigestSha256: EXECUTION.digest,
    liveComponentContractDigestSha256: executableLiveComponentContractDigestSha256,
    dataAndConfigFiles,
    simulatorFiles,
  }
  const executionRecord = dataAndConfigFiles.find((record) => record.role === 'research-execution-contract')
  if (executionRecord.digestSha256 !== EXECUTION.digest) {
    throw new Error('Loaded research execution contract does not match the recorded config bytes.')
  }
  return {
    ...binding,
    bundleDigestSha256: canonicalDigestSha256(binding),
  }
}

function assertProvenanceFilesUnchanged(provenance) {
  for (const record of [...provenance.dataAndConfigFiles, ...provenance.simulatorFiles]) {
    const filePath = path.join(REPO_ROOT, record.path)
    const bytes = fs.readFileSync(filePath)
    if (bytes.length !== record.byteLength || sha256(bytes) !== record.digestSha256) {
      throw new Error(`Audit provenance input changed during the run: ${record.path}`)
    }
  }
}

function requiredNumber(value, label) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    throw new Error(`${label} must be a finite number.`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number.`)
  return parsed
}

function parseLedger(bytes) {
  const parsed = Papa.parse(bytes.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (value) => value.trim(),
  })
  if (parsed.errors.length) {
    const first = parsed.errors[0]
    throw new Error(`Selected target ledger could not be parsed: ${first.message} at row ${first.row ?? 'unknown'}.`)
  }
  if (!parsed.data.length) throw new Error('Selected target ledger is empty.')
  let previousDate = null
  for (const [index, row] of parsed.data.entries()) {
    const date = String(row?.entryTradeDate ?? '')
    const parsedDate = new Date(`${date}T00:00:00.000Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || Number.isNaN(parsedDate.getTime())
      || parsedDate.toISOString().slice(0, 10) !== date
    ) throw new Error(`Selected target ledger row ${index + 1} has an invalid entryTradeDate.`)
    if (previousDate !== null && date <= previousDate) {
      throw new Error('Selected target ledger entryTradeDate values must be unique and strictly chronological.')
    }
    previousDate = date
  }
  return parsed.data
}

function round(value, digits = 5) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}

function legFor(row, rawGasPosition) {
  if (row.componentStrategyId === 'ngas-summer-alpha') {
    if (row.thesisKind === 'summer-heat-long') return 'summer-follow'
    if (row.thesisKind === 'reversion-short') return 'summer-fade'
  }
  if (row.componentStrategyId === 'ngas-winter-alpha') {
    if (row.thesisKind === 'cold-long') return 'winter-cold-follow'
    if (row.thesisKind === 'warm-short') return 'winter-warm-short'
    if (row.thesisKind === 'reversion-long') return 'winter-reversion-long'
    if (row.thesisKind === 'reversion-short') return 'winter-reversion-short'
  }
  if (Math.abs(rawGasPosition) > 1e-12) {
    throw new Error(
      `Unknown material target ${row.componentStrategyId || '(missing component)'}/`
        + `${row.thesisKind || '(missing thesis)'} on ${row.entryTradeDate}.`,
    )
  }
  return 'index-fallback'
}

function classifyLedgerRow(row) {
  const rawGasPosition = requiredNumber(
    row.ungPosition,
    `Selected target ledger ungPosition on ${row.entryTradeDate}`,
  )
  const leg = legFor(row, rawGasPosition)
  if (leg !== 'index-fallback' && Math.abs(rawGasPosition) > LEG_CAPS[leg] + 1e-12) {
    throw new Error(
      `Baseline target ${rawGasPosition} exceeds reviewed ${leg} cap ${LEG_CAPS[leg]} on ${row.entryTradeDate}.`,
    )
  }
  return {
    row,
    date: row.entryTradeDate,
    year: row.entryTradeDate.slice(0, 4),
    leg,
    rawGasPosition,
  }
}

const ROWS = parseLedger(LEDGER_BYTES)
const AUDIT_ROWS = ROWS.map(classifyLedgerRow)
const EXECUTION_BY_DATE = new Map(
  loadExecutionCalendar(REPO_ROOT, {
    startDate: ROWS[0].entryTradeDate,
    contract: EXECUTION,
  }).map((day) => [day.date, day]),
)
const AUDIT_PROVENANCE = buildAuditProvenance()

function simulate(candidate, scenarioId = EXECUTION.selectionScenarioId) {
  let state = createExecutionState(EXECUTION)
  const curve = []
  for (const material of AUDIT_ROWS) {
    const day = EXECUTION_BY_DATE.get(material.date)
    if (!day) throw new Error(`Missing execution day ${material.date}`)
    const { row, leg } = material
    const scale = leg === 'index-fallback' ? 0 : candidate.scales[leg]
    const scaledPosition = material.rawGasPosition * scale
    const gasPosition =
      Math.sign(scaledPosition) * Math.min(Math.abs(scaledPosition), LEG_CAPS[leg] ?? 0)
    const investedIndexFraction = 1 - Math.abs(gasPosition)
    const step = applyExecutionStep({
      state,
      day,
      targetWeights: targetWeightsForAllocation(EXECUTION, { gasPosition, investedIndexFraction }),
      contract: EXECUTION,
      scenarioId,
    })
    state = step.state
    curve.push({
      date: row.entryTradeDate,
      year: row.entryTradeDate.slice(0, 4),
      leg,
      gasPosition,
      netReturnPct: step.netReturnPct,
      indexReturnPct: day.indexReturnPct,
      turnover: step.totalTurnover,
    })
  }
  return curve
}

function assertBaselineTieOut(curve) {
  if (curve.length !== AUDIT_ROWS.length) {
    throw new Error('Scale-1 baseline row count does not match the selected target ledger.')
  }
  let maximumGasPositionDifference = 0
  let maximumDailyNetReturnDifferencePct = 0
  let maximumTotalTurnoverDifference = 0
  for (const [index, simulated] of curve.entries()) {
    const material = AUDIT_ROWS[index]
    if (simulated.date !== material.date) {
      throw new Error(`Scale-1 baseline chronology diverges at ${material.date}.`)
    }
    const gasDifference = Math.abs(simulated.gasPosition - material.rawGasPosition)
    const returnDifference = Math.abs(
      simulated.netReturnPct - requiredNumber(material.row.netReturnPct, `ledger netReturnPct on ${material.date}`),
    )
    const turnoverDifference = Math.abs(
      simulated.turnover - requiredNumber(material.row.totalTurnover, `ledger totalTurnover on ${material.date}`),
    )
    maximumGasPositionDifference = Math.max(maximumGasPositionDifference, gasDifference)
    maximumDailyNetReturnDifferencePct = Math.max(maximumDailyNetReturnDifferencePct, returnDifference)
    maximumTotalTurnoverDifference = Math.max(maximumTotalTurnoverDifference, turnoverDifference)
  }
  const simulatedEndingEquityPct = totalReturnPct(curve)
  const recordedEndingEquityPct = requiredNumber(
    AUDIT_ROWS.at(-1).row.equityPct,
    'selected target ledger final equityPct',
  )
  const endingEquityDifferencePct = Math.abs(simulatedEndingEquityPct - recordedEndingEquityPct)
  const checks = [
    [maximumGasPositionDifference, BASELINE_TIE_OUT_TOLERANCES.gasPosition, 'gas position'],
    [maximumDailyNetReturnDifferencePct, BASELINE_TIE_OUT_TOLERANCES.dailyNetReturnPct, 'daily net return'],
    [maximumTotalTurnoverDifference, BASELINE_TIE_OUT_TOLERANCES.totalTurnover, 'total turnover'],
    [endingEquityDifferencePct, BASELINE_TIE_OUT_TOLERANCES.endingEquityPct, 'ending equity'],
  ]
  const failed = checks.find(([actual, tolerance]) => actual > tolerance)
  if (failed) throw new Error(`Scale-1 baseline ${failed[2]} tie-out failed: ${failed[0]} > ${failed[1]}.`)
  return {
    passed: true,
    rowCount: curve.length,
    tolerances: BASELINE_TIE_OUT_TOLERANCES,
    maximumGasPositionDifference,
    maximumDailyNetReturnDifferencePct,
    maximumTotalTurnoverDifference,
    simulatedEndingEquityPct: round(simulatedEndingEquityPct),
    recordedEndingEquityPct,
    endingEquityDifferencePct,
  }
}

function maxDrawdownPct(curve) {
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (const row of curve) {
    equity *= 1 + row.netReturnPct / 100
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100)
  }
  return maxDrawdown
}

function totalReturnPct(curve, key = 'netReturnPct') {
  return (curve.reduce((equity, row) => equity * (1 + row[key] / 100), 1) - 1) * 100
}

function summaryFor(curve) {
  const returns = curve.map((row) => row.netReturnPct / 100)
  const annualVol = std(returns) * Math.sqrt(252)
  return {
    totalReturnPct: round(totalReturnPct(curve)),
    annualizedActiveEdgePct: round(
      mean(curve.map((row) => row.netReturnPct - row.indexReturnPct)) * 252,
    ),
    sharpe: round(annualVol ? (mean(returns) * 252) / annualVol : 0),
    maxDrawdownPct: round(maxDrawdownPct(curve)),
    turnover: round(curve.reduce((sum, row) => sum + row.turnover, 0)),
  }
}

function slice(curve, start, end) {
  return curve.filter((row) => (!start || row.date >= start) && (!end || row.date <= end))
}

function candidateId(scales) {
  return LEG_KEYS.map((key) => `${key}=${scales[key]}`).join('|')
}

function candidate(scales, family) {
  return { id: candidateId(scales), family, scales }
}

const baselineScales = Object.fromEntries(LEG_KEYS.map((key) => [key, 1]))
const candidateMap = new Map()
function addCandidate(scales, family) {
  const item = candidate({ ...baselineScales, ...scales }, family)
  if (!candidateMap.has(item.id)) candidateMap.set(item.id, item)
}
addCandidate({}, 'baseline')

for (const key of LEG_KEYS) {
  for (const value of [0, 0.5, 0.75, 1.25]) addCandidate({ [key]: value }, 'single-leg')
}
for (const summer of [0, 0.5, 0.75, 1, 1.25]) {
  for (const winter of [0, 0.5, 0.75, 1, 1.25]) {
    addCandidate(
      Object.fromEntries(LEG_KEYS.map((key) => [key, key.startsWith('summer-') ? summer : winter])),
      'component-grid',
    )
  }
}
for (const globalScale of [0.5, 0.75, 1.25]) {
  addCandidate(Object.fromEntries(LEG_KEYS.map((key) => [key, globalScale])), 'global-scale')
}
for (const summer of [1.05, 1.1, 1.15, 1.2]) {
  addCandidate(
    Object.fromEntries(LEG_KEYS.map((key) => [key, key.startsWith('summer-') ? summer : 1])),
    'summer-neighborhood',
  )
}

const exhaustiveValues = [0, 0.5, 1, 1.25]
function addExhaustive(index, scales) {
  if (index === LEG_KEYS.length) {
    addCandidate(scales, 'exhaustive-leg-grid')
    return
  }
  for (const value of exhaustiveValues) addExhaustive(index + 1, { ...scales, [LEG_KEYS[index]]: value })
}
addExhaustive(0, {})

const baseline = simulate(candidateMap.get(candidateId(baselineScales)))
const baselineTieOut = assertBaselineTieOut(baseline)
const baselineByDate = new Map(baseline.map((row) => [row.date, row]))
const baselineSummary = summaryFor(baseline)
const results = []

function incrementalSummary(curve, start, end) {
  const rows = slice(curve, start, end)
  const baselineRows = rows.map((row) => baselineByDate.get(row.date))
  const differences = rows.map((row, index) => row.netReturnPct - baselineRows[index].netReturnPct)
  return {
    dailySumPct: differences.reduce((sum, value) => sum + value, 0),
    compoundedReturnDifferencePct: totalReturnPct(rows) - totalReturnPct(baselineRows),
    positiveDayFraction: differences.filter((value) => value > 0).length / Math.max(1, differences.filter((value) => value !== 0).length),
  }
}

for (const item of candidateMap.values()) {
  const curve = item.family === 'baseline' ? baseline : simulate(item)
  const byYear = Object.fromEntries(
    ['2021', '2022', '2023', '2024', '2025', '2026'].map((year) => [
      year,
      round(incrementalSummary(curve, `${year}-01-01`, `${year}-12-31`).dailySumPct),
    ]),
  )
  const train = incrementalSummary(curve, '2021-01-01', '2023-12-31')
  const validation = incrementalSummary(curve, '2024-01-01', '2024-12-31')
  const recent = incrementalSummary(curve, '2025-01-01', '')
  const selectionYears = ['2021', '2022', '2023', '2024'].map((year) => byYear[year])
  const changedLegs = LEG_KEYS.filter((key) => item.scales[key] !== 1).length
  const distance = LEG_KEYS.reduce((sum, key) => sum + Math.abs(item.scales[key] - 1), 0)
  const robustScore =
    Math.min(train.dailySumPct / 3, validation.dailySumPct)
    + mean(selectionYears)
    - distance * 0.15
    - Math.max(0, changedLegs - 1) * 0.1
  results.push({
    candidateId: item.id,
    family: item.family,
    scales: item.scales,
    changedLegs,
    distance: round(distance),
    robustScore: round(robustScore),
    positiveSelectionYears: selectionYears.filter((value) => value > 0).length,
    trainIncrementalSumPct: round(train.dailySumPct),
    validationIncrementalSumPct: round(validation.dailySumPct),
    recentIncrementalSumPct: round(recent.dailySumPct),
    byYear,
    ...summaryFor(curve),
  })
}

const constrained = results
  .filter((row) =>
    row.family !== 'baseline'
    && row.trainIncrementalSumPct > 0
    && row.validationIncrementalSumPct > 0
    && row.positiveSelectionYears >= 3
    && row.maxDrawdownPct >= baselineSummary.maxDrawdownPct - 2
  )
  .sort((left, right) => right.robustScore - left.robustScore)

const topByFamily = Object.fromEntries(
  [...new Set(results.map((row) => row.family))].map((family) => [
    family,
    results
      .filter((row) => row.family === family)
      .sort((left, right) => right.robustScore - left.robustScore)
      .slice(0, 100),
  ]),
)

const simpleAblationScales = {
  'summer-only': Object.fromEntries(LEG_KEYS.map((key) => [key, key.startsWith('summer-') ? 1 : 0])),
  'winter-only': Object.fromEntries(LEG_KEYS.map((key) => [key, key.startsWith('winter-') ? 1 : 0])),
  'index-only': Object.fromEntries(LEG_KEYS.map((key) => [key, 0])),
}
const simpleAblations = Object.fromEntries(Object.entries(simpleAblationScales).map(([label, scales]) => {
  const result = results.find((row) => row.candidateId === candidateId(scales))
  if (!result) throw new Error(`Missing ${label} audit ablation.`)
  return [label, {
    totalReturnPct: result.totalReturnPct,
    sharpe: result.sharpe,
    maxDrawdownPct: result.maxDrawdownPct,
    turnover: result.turnover,
  }]
}))

assertProvenanceFilesUnchanged(AUDIT_PROVENANCE)
console.log(JSON.stringify({
  method: {
    status: 'development-contaminated retrospective audit only',
    selectionPrefix: '2021-01-01 through 2024-12-31',
    reportOnly: '2025-01-01 onward',
    executionContractId: EXECUTION.contractId,
    executionContractDigestSha256: EXECUTION.digest,
    scenarioId: EXECUTION.selectionScenarioId,
    ledgerPath: path.relative(REPO_ROOT, LEDGER),
    ledgerDigestSha256: sha256(LEDGER_BYTES),
    liveComponentContractDigestSha256: executableLiveComponentContractDigestSha256,
    reviewedLegCaps: LEG_CAPS,
    provenance: AUDIT_PROVENANCE,
    weatherEvidenceStatus:
      'The selected ledger uses the legacy target-UTC-midnight Summer snapshot and is retained for development-contaminated historical comparison only.',
    candidateCount: results.length,
    legKeys: LEG_KEYS,
    exhaustiveValues,
    constraint:
      'positive 2021-2023 and 2024 incremental daily-return sums, at least three positive selection years, and drawdown no more than two percentage points worse than baseline',
  },
  baseline: baselineSummary,
  baselineTieOut,
  simpleAblations,
  constrainedCandidateCount: constrained.length,
  constrainedRecentNonnegativeCount: constrained.filter((row) => row.recentIncrementalSumPct >= 0).length,
  bestRecentNonnegativeConstrained: constrained
    .filter((row) => row.recentIncrementalSumPct >= 0)
    .slice(0, 30),
  bestConstrained: constrained.slice(0, 30),
  topByFamily,
}, null, 2))
