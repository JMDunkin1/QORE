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
const OUTPUT_PATH = path.resolve(
  process.argv[2] ?? path.join(REPO_ROOT, '.local/qore/research/continuous-target-weight-audit.json'),
)
const LEDGER_PATH = path.join(
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
const SCRIPT_BYTES = fs.readFileSync(SCRIPT_PATH)
const LEDGER_BYTES = fs.readFileSync(LEDGER_PATH)
const EXECUTION = loadResearchExecutionContract(REPO_ROOT)

const TRAIN_END = '2023-12-31'
const VALIDATION_START = '2024-01-01'
const VALIDATION_END = '2024-12-31'
const HIDDEN_START = '2025-01-01'
const GLOBAL_HALTON_COUNT = 32768
const NEAR_HALTON_COUNT = 32768
const ULTRA_NEAR_HALTON_COUNT = 8192
const LOCAL_SEED_COUNT = 24
const LOCAL_POINTS_PER_SEED = 384
const TRAIN_TOP_COUNT = 1024
const TRAIN_VERY_SMALL_COUNT = 512
const COST_TOP_COUNT = 64
const COST_VERY_SMALL_COUNT = 32
const HIDDEN_TOP_COUNT = 8
const HIDDEN_VERY_SMALL_COUNT = 8
const HALTON_PRIMES = [2, 3, 5, 7, 11, 13]
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
    provenanceFile('selected-target-ledger', LEDGER_PATH, LEDGER_BYTES),
    provenanceFile('research-execution-contract', EXECUTION_CONFIG_PATH),
    provenanceFile('index-basket-config', INDEX_BASKET_CONFIG_PATH),
    ...Object.entries(MARKET_PATHS).map(([symbol, filePath]) => (
      provenanceFile(`${symbol}-adjusted-daily-market-bars`, filePath)
    )),
  ]
  const simulatorFiles = [
    provenanceFile('audit-runner', SCRIPT_PATH, SCRIPT_BYTES),
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

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function sampleStd(values) {
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

const ROWS = parseLedger(LEDGER_BYTES)
const MATERIAL_ROWS = ROWS.map((row) => ({
  row,
  date: row.entryTradeDate,
  year: row.entryTradeDate.slice(0, 4),
  rawGasPosition: requiredNumber(
    row.ungPosition,
    `Selected target ledger ungPosition on ${row.entryTradeDate}`,
  ),
}))
for (const material of MATERIAL_ROWS) {
  material.leg = legFor(material.row, material.rawGasPosition)
  if (
    material.leg !== 'index-fallback'
    && Math.abs(material.rawGasPosition) > LEG_CAPS[material.leg] + 1e-12
  ) {
    throw new Error(
      `Baseline target ${material.rawGasPosition} exceeds reviewed ${material.leg} cap `
        + `${LEG_CAPS[material.leg]} on ${material.date}.`,
    )
  }
}
const EXECUTION_BY_DATE = new Map(
  loadExecutionCalendar(REPO_ROOT, {
    startDate: ROWS[0].entryTradeDate,
    contract: EXECUTION,
  }).map((day) => [day.date, day]),
)
const AUDIT_PROVENANCE = buildAuditProvenance()
const TRAIN_ROWS = MATERIAL_ROWS.filter((item) => item.date <= TRAIN_END)
const VALIDATION_ROWS = MATERIAL_ROWS.filter(
  (item) => item.date >= VALIDATION_START && item.date <= VALIDATION_END,
)
const HIDDEN_ROWS = MATERIAL_ROWS.filter((item) => item.date >= HIDDEN_START)

function scaleId(scales) {
  return LEG_KEYS.map((key) => round(scales[key], 6).toFixed(6)).join('|')
}

function normalizeScales(scales) {
  return Object.fromEntries(LEG_KEYS.map((key) => [key, round(Math.max(0, Math.min(1.35, scales[key])), 6)]))
}

function candidate(scales, family) {
  const normalized = normalizeScales(scales)
  return { id: scaleId(normalized), family, scales: normalized }
}

const baselineScales = Object.fromEntries(LEG_KEYS.map((key) => [key, 1]))
const candidateMap = new Map()
function addCandidate(scales, family) {
  const item = candidate({ ...baselineScales, ...scales }, family)
  if (!candidateMap.has(item.id)) candidateMap.set(item.id, item)
  return candidateMap.get(item.id)
}

function halton(index, base) {
  let fraction = 1
  let result = 0
  let cursor = index
  while (cursor > 0) {
    fraction /= base
    result += fraction * (cursor % base)
    cursor = Math.floor(cursor / base)
  }
  return result
}

function haltonScales(index, low, high, shift = 0) {
  return Object.fromEntries(LEG_KEYS.map((key, dimension) => {
    const sequenceIndex = index + shift * (dimension + 1)
    return [key, low + (high - low) * halton(sequenceIndex, HALTON_PRIMES[dimension])]
  }))
}

function gasPositionFor(item, scales) {
  if (item.leg === 'index-fallback') return 0
  const scaled = item.rawGasPosition * scales[item.leg]
  return Math.sign(scaled) * Math.min(Math.abs(scaled), LEG_CAPS[item.leg])
}

function simulatePeriod(item, rows, scenarioId, initialState = null, baselineDaily = null, keepDaily = false) {
  let state = initialState ? structuredClone(initialState) : createExecutionState(EXECUTION)
  let equity = 1
  let peak = 1
  let maxDrawdownPct = 0
  let returnSum = 0
  let returnSumSquares = 0
  let turnover = 0
  let gasTurnover = 0
  let incrementalSumPct = 0
  let changedDays = 0
  const byYear = {}
  const byLeg = Object.fromEntries(LEG_KEYS.map((key) => [key, 0]))
  byLeg['index-fallback'] = 0
  const daily = keepDaily ? [] : null

  for (const material of rows) {
    const day = EXECUTION_BY_DATE.get(material.date)
    if (!day) throw new Error(`Missing execution day ${material.date}`)
    const gasPosition = gasPositionFor(material, item.scales)
    const step = applyExecutionStep({
      state,
      day,
      targetWeights: targetWeightsForAllocation(EXECUTION, {
        gasPosition,
        investedIndexFraction: 1 - Math.abs(gasPosition),
      }),
      contract: EXECUTION,
      scenarioId,
    })
    state = step.state
    const dailyReturn = step.netReturnPct / 100
    equity *= 1 + dailyReturn
    peak = Math.max(peak, equity)
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100)
    returnSum += dailyReturn
    returnSumSquares += dailyReturn ** 2
    turnover += step.totalTurnover
    gasTurnover += step.gasTurnover
    const baselineReturn = baselineDaily?.get(material.date)?.netReturnPct ?? step.netReturnPct
    const increment = step.netReturnPct - baselineReturn
    incrementalSumPct += increment
    byYear[material.year] = (byYear[material.year] ?? 0) + increment
    byLeg[material.leg] += increment
    if (Math.abs(increment) > 1e-10) changedDays += 1
    if (keepDaily) {
      daily.push({
        date: material.date,
        year: material.year,
        leg: material.leg,
        gasPosition,
        netReturnPct: step.netReturnPct,
        baselineReturnPct: baselineReturn,
        incrementPct: increment,
        turnover: step.totalTurnover,
      })
    }
  }
  const count = rows.length
  const average = count ? returnSum / count : 0
  const variance = count > 1 ? Math.max(0, (returnSumSquares - count * average ** 2) / (count - 1)) : 0
  const annualVol = Math.sqrt(variance) * Math.sqrt(252)
  return {
    state,
    daily,
    summary: {
      sessionCount: count,
      totalReturnPct: round((equity - 1) * 100),
      sharpe: round(annualVol ? average * 252 / annualVol : 0),
      maxDrawdownPct: round(maxDrawdownPct),
      turnover: round(turnover),
      gasTurnover: round(gasTurnover),
      incrementalSumPct: round(incrementalSumPct),
      changedDays,
      byYear: Object.fromEntries(Object.entries(byYear).map(([year, value]) => [year, round(value)])),
      byLeg: Object.fromEntries(Object.entries(byLeg).map(([leg, value]) => [leg, round(value)])),
    },
  }
}

function baselineFor(rows, scenarioId, initialState = null) {
  const item = candidate(baselineScales, 'baseline')
  const result = simulatePeriod(item, rows, scenarioId, initialState, null, true)
  return {
    ...result,
    dailyMap: new Map(result.daily.map((row) => [row.date, row])),
  }
}

function assertBaselinePeriodTieOut(result, rows, label) {
  if (result.daily.length !== rows.length) {
    throw new Error(`Scale-1 ${label} baseline row count does not match the selected target ledger.`)
  }
  let maximumGasPositionDifference = 0
  let maximumDailyNetReturnDifferencePct = 0
  let maximumTotalTurnoverDifference = 0
  for (const [index, simulated] of result.daily.entries()) {
    const material = rows[index]
    if (simulated.date !== material.date) {
      throw new Error(`Scale-1 ${label} baseline chronology diverges at ${material.date}.`)
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
  const checks = [
    [maximumGasPositionDifference, BASELINE_TIE_OUT_TOLERANCES.gasPosition, 'gas position'],
    [maximumDailyNetReturnDifferencePct, BASELINE_TIE_OUT_TOLERANCES.dailyNetReturnPct, 'daily net return'],
    [maximumTotalTurnoverDifference, BASELINE_TIE_OUT_TOLERANCES.totalTurnover, 'total turnover'],
  ]
  const failed = checks.find(([actual, tolerance]) => actual > tolerance)
  if (failed) {
    throw new Error(`Scale-1 ${label} baseline ${failed[2]} tie-out failed: ${failed[0]} > ${failed[1]}.`)
  }
  return {
    passed: true,
    rowCount: rows.length,
    firstDate: rows[0]?.date ?? null,
    lastDate: rows.at(-1)?.date ?? null,
    maximumGasPositionDifference,
    maximumDailyNetReturnDifferencePct,
    maximumTotalTurnoverDifference,
  }
}

function assertBaselineEndingEquityTieOut(prefixDaily, hiddenDaily) {
  const daily = [...prefixDaily, ...hiddenDaily]
  const simulatedEndingEquityPct = (
    daily.reduce((equity, row) => equity * (1 + row.netReturnPct / 100), 1) - 1
  ) * 100
  const recordedEndingEquityPct = requiredNumber(
    MATERIAL_ROWS.at(-1).row.equityPct,
    'selected target ledger final equityPct',
  )
  const endingEquityDifferencePct = Math.abs(simulatedEndingEquityPct - recordedEndingEquityPct)
  if (endingEquityDifferencePct > BASELINE_TIE_OUT_TOLERANCES.endingEquityPct) {
    throw new Error(
      `Scale-1 baseline ending equity tie-out failed: ${endingEquityDifferencePct} `
        + `> ${BASELINE_TIE_OUT_TOLERANCES.endingEquityPct}.`,
    )
  }
  return {
    passed: true,
    simulatedEndingEquityPct: round(simulatedEndingEquityPct),
    recordedEndingEquityPct,
    endingEquityDifferencePct,
  }
}

function distanceFromBaseline(item) {
  return LEG_KEYS.reduce((sum, key) => sum + Math.abs(item.scales[key] - 1), 0)
}

function changedLegs(item, tolerance = 1e-9) {
  return LEG_KEYS.filter((key) => Math.abs(item.scales[key] - 1) > tolerance).length
}

function maxLegDistance(item) {
  return Math.max(...LEG_KEYS.map((key) => Math.abs(item.scales[key] - 1)))
}

function isVerySmall(record) {
  return record.distance <= 0.2 && maxLegDistance(record.item) <= 0.05
}

function uniqueRecords(...groups) {
  const seen = new Set()
  const result = []
  for (const group of groups) {
    for (const record of group) {
      if (seen.has(record.item.id)) continue
      seen.add(record.item.id)
      result.push(record)
    }
  }
  return result
}

function trainRecord(item, result) {
  const years = ['2021', '2022', '2023'].map((year) => result.summary.byYear[year] ?? 0)
  const distance = distanceFromBaseline(item)
  const changes = changedLegs(item)
  const minYear = Math.min(...years)
  const averageYear = mean(years)
  // This score is fixed before 2024 is opened. It strongly rewards breadth,
  // while shrinking continuous six-dimensional searches toward scale=1.
  const robustTrainScore = minYear + 0.35 * averageYear - 0.2 * distance - 0.08 * Math.max(0, changes - 1)
  return {
    item,
    train: result,
    distance: round(distance),
    changedLegs: changes,
    positiveTrainYears: years.filter((value) => value > 0).length,
    minTrainYearIncrementPct: round(minYear),
    robustTrainScore: round(robustTrainScore),
  }
}

function qualifiesTrain(record, baseline) {
  return record.train.summary.incrementalSumPct > 0
    && record.positiveTrainYears >= 2
    && record.train.summary.sharpe >= baseline.summary.sharpe - 0.03
    && record.train.summary.maxDrawdownPct >= baseline.summary.maxDrawdownPct - 1.5
    && record.train.summary.turnover <= baseline.summary.turnover * 1.12
}

function addStructuredCandidates() {
  addCandidate(baselineScales, 'baseline')
  for (const key of LEG_KEYS) {
    for (let basisPoints = 7000; basisPoints <= 13000; basisPoints += 100) {
      addCandidate({ [key]: basisPoints / 10000 }, 'single-leg-dense')
    }
  }
  for (let basisPoints = 6000; basisPoints <= 13000; basisPoints += 50) {
    const value = basisPoints / 10000
    addCandidate(Object.fromEntries(LEG_KEYS.map((key) => [key, value])), 'global-shrinkage-dense')
  }
  for (let summerBp = 7000; summerBp <= 12500; summerBp += 250) {
    for (let winterBp = 7000; winterBp <= 12500; winterBp += 250) {
      const summer = summerBp / 10000
      const winter = winterBp / 10000
      addCandidate(Object.fromEntries(LEG_KEYS.map((key) => [
        key,
        key.startsWith('summer-') ? summer : winter,
      ])), 'component-shrinkage-grid')
    }
  }
  for (let index = 1; index <= GLOBAL_HALTON_COUNT; index += 1) {
    addCandidate(haltonScales(index, 0, 1.35, 19), 'halton-global')
  }
  for (let index = 1; index <= NEAR_HALTON_COUNT; index += 1) {
    addCandidate(haltonScales(index, 0.78, 1.22, 97), 'halton-near-baseline')
  }
  for (let index = 1; index <= ULTRA_NEAR_HALTON_COUNT; index += 1) {
    addCandidate(haltonScales(index, 0.97, 1.03, 193), 'halton-ultra-near-baseline')
  }
}

function localScales(seed, index) {
  const radius = index <= LOCAL_POINTS_PER_SEED / 2 ? 0.06 : 0.018
  return Object.fromEntries(LEG_KEYS.map((key, dimension) => {
    const unit = halton(index + 211 * (dimension + 1), HALTON_PRIMES[dimension]) * 2 - 1
    return [key, seed.scales[key] + radius * unit]
  }))
}

function compactRecord(record) {
  return {
    candidateId: record.item.id,
    family: record.item.family,
    scales: record.item.scales,
    distance: record.distance,
    changedLegs: record.changedLegs,
    robustTrainScore: record.robustTrainScore,
    positiveTrainYears: record.positiveTrainYears,
    minTrainYearIncrementPct: record.minTrainYearIncrementPct,
    train: record.train.summary,
    validation: record.validation?.summary,
    prefix: record.prefix?.summary,
    elevatedPrefixIncrementPct: record.elevatedPrefixIncrementPct,
    stressPrefixIncrementPct: record.stressPrefixIncrementPct,
    sensitivity: record.sensitivity,
    concentration: record.concentration,
    bootstrap: record.bootstrap,
    hidden: record.hidden?.summary,
    full: record.full,
  }
}

function sensitivityCandidates(item) {
  const rows = []
  for (const delta of [-0.05, -0.025, -0.01, 0.01, 0.025, 0.05]) {
    for (const key of LEG_KEYS) {
      rows.push(candidate({ ...item.scales, [key]: item.scales[key] + delta }, `sensitivity-${delta}`))
    }
  }
  rows.push(candidate(Object.fromEntries(LEG_KEYS.map((key) => [
    key,
    1 + 0.5 * (item.scales[key] - 1),
  ])), 'half-shrink'))
  return rows
}

function concentrationFor(daily) {
  const increments = daily.map((row) => row.incrementPct)
  const positive = increments.filter((value) => value > 0).sort((a, b) => b - a)
  const absolute = increments.map(Math.abs).sort((a, b) => b - a)
  const positiveSum = positive.reduce((sum, value) => sum + value, 0)
  const absoluteSum = absolute.reduce((sum, value) => sum + value, 0)
  const byLeg = {}
  for (const row of daily) byLeg[row.leg] = (byLeg[row.leg] ?? 0) + row.incrementPct
  const positiveLegTotal = Object.values(byLeg).filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const largestPositiveLegShare = positiveLegTotal
    ? Math.max(...Object.values(byLeg).map((value) => Math.max(0, value))) / positiveLegTotal
    : 0
  return {
    changedDays: increments.filter((value) => Math.abs(value) > 1e-10).length,
    top5PositiveDayShare: round(positiveSum ? positive.slice(0, 5).reduce((sum, value) => sum + value, 0) / positiveSum : 0),
    top10AbsoluteDayShare: round(absoluteSum ? absolute.slice(0, 10).reduce((sum, value) => sum + value, 0) / absoluteSum : 0),
    largestPositiveLegShare: round(largestPositiveLegShare),
    byLeg: Object.fromEntries(Object.entries(byLeg).map(([leg, value]) => [leg, round(value)])),
  }
}

function seededGenerator(seedText) {
  let state = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function movingBlockBootstrap(daily, seedText, draws = 4000, blockSize = 10) {
  const increments = daily.map((row) => row.incrementPct)
  const random = seededGenerator(seedText)
  let nonpositive = 0
  const sampledSums = []
  for (let draw = 0; draw < draws; draw += 1) {
    let total = 0
    let sampled = 0
    while (sampled < increments.length) {
      const start = Math.floor(random() * increments.length)
      for (let offset = 0; offset < blockSize && sampled < increments.length; offset += 1) {
        total += increments[(start + offset) % increments.length]
        sampled += 1
      }
    }
    if (total <= 0) nonpositive += 1
    sampledSums.push(total)
  }
  sampledSums.sort((a, b) => a - b)
  return {
    method: `circular-moving-block-${blockSize}-session`,
    draws,
    probabilityNonpositive: round(nonpositive / draws),
    p05IncrementPct: round(sampledSums[Math.floor(draws * 0.05)]),
    medianIncrementPct: round(sampledSums[Math.floor(draws * 0.5)]),
    p95IncrementPct: round(sampledSums[Math.floor(draws * 0.95)]),
  }
}

function combinedSummary(prefixDaily, hiddenDaily) {
  const daily = [...prefixDaily, ...hiddenDaily]
  let equity = 1
  let peak = 1
  let drawdown = 0
  for (const row of daily) {
    equity *= 1 + row.netReturnPct / 100
    peak = Math.max(peak, equity)
    drawdown = Math.min(drawdown, (equity / peak - 1) * 100)
  }
  const returns = daily.map((row) => row.netReturnPct / 100)
  const vol = sampleStd(returns) * Math.sqrt(252)
  return {
    totalReturnPct: round((equity - 1) * 100),
    sharpe: round(vol ? mean(returns) * 252 / vol : 0),
    maxDrawdownPct: round(drawdown),
    turnover: round(daily.reduce((sum, row) => sum + row.turnover, 0)),
  }
}

console.error('Building deterministic continuous candidate universe...')
addStructuredCandidates()

const baselineTrain = baselineFor(TRAIN_ROWS, EXECUTION.selectionScenarioId)
const baselineTrainTieOut = assertBaselinePeriodTieOut(baselineTrain, TRAIN_ROWS, 'train')
let evaluatedCandidateCount = 0
const trainRecords = []
for (const item of candidateMap.values()) {
  const result = item.family === 'baseline'
    ? baselineTrain
    : simulatePeriod(item, TRAIN_ROWS, EXECUTION.selectionScenarioId, null, baselineTrain.dailyMap)
  trainRecords.push(trainRecord(item, result))
  evaluatedCandidateCount += 1
}

const initialTrainLeaders = trainRecords
  .filter((record) => record.item.family !== 'baseline' && qualifiesTrain(record, baselineTrain))
  .sort((left, right) => right.robustTrainScore - left.robustTrainScore)
  .slice(0, LOCAL_SEED_COUNT)

console.error(`Refining ${initialTrainLeaders.length} train-only neighborhoods...`)
const localItems = []
for (const seed of initialTrainLeaders) {
  for (let index = 1; index <= LOCAL_POINTS_PER_SEED; index += 1) {
    const before = candidateMap.size
    const local = addCandidate(localScales(seed.item, index), 'train-local-refinement')
    if (candidateMap.size > before) localItems.push(local)
  }
}
for (const item of localItems) {
  const result = simulatePeriod(item, TRAIN_ROWS, EXECUTION.selectionScenarioId, null, baselineTrain.dailyMap)
  trainRecords.push(trainRecord(item, result))
  evaluatedCandidateCount += 1
}

const trainQualified = trainRecords
  .filter((record) => record.item.family !== 'baseline' && qualifiesTrain(record, baselineTrain))
  .sort((left, right) => right.robustTrainScore - left.robustTrainScore)
const trainVerySmallQualified = trainQualified.filter(isVerySmall)
const trainTopShortlist = trainQualified.slice(0, TRAIN_TOP_COUNT)
const trainVerySmallShortlist = trainVerySmallQualified.slice(0, TRAIN_VERY_SMALL_COUNT)
const trainShortlist = uniqueRecords(trainTopShortlist, trainVerySmallShortlist)
const trainTopShortlistIds = new Set(trainTopShortlist.map((record) => record.item.id))
const trainVerySmallShortlistIds = new Set(trainVerySmallShortlist.map((record) => record.item.id))

console.error(`Train-only freeze: ${trainShortlist.length} candidates. Applying within-run withheld 2024 validation...`)
const baselineValidation = baselineFor(
  VALIDATION_ROWS,
  EXECUTION.selectionScenarioId,
  baselineTrain.state,
)
const baselineValidationTieOut = assertBaselinePeriodTieOut(
  baselineValidation,
  VALIDATION_ROWS,
  'validation',
)
for (const record of trainShortlist) {
  record.validation = simulatePeriod(
    record.item,
    VALIDATION_ROWS,
    EXECUTION.selectionScenarioId,
    record.train.state,
    baselineValidation.dailyMap,
  )
}

const validationPass = trainShortlist.filter((record) =>
  record.validation.summary.incrementalSumPct > 0
  && record.validation.summary.sharpe >= baselineValidation.summary.sharpe - 0.05
  && record.validation.summary.maxDrawdownPct >= baselineValidation.summary.maxDrawdownPct - 1
  && record.validation.summary.turnover <= baselineValidation.summary.turnover * 1.12
)

// Validation is pass/fail. Ordering remains the pre-validation train ordering.
const validationVerySmallPass = validationPass.filter(isVerySmall)
const validationTopCostPool = validationPass.slice(0, COST_TOP_COUNT)
const validationVerySmallCostPool = validationVerySmallPass.slice(0, COST_VERY_SMALL_COUNT)
const validationSurvivors = uniqueRecords(validationTopCostPool, validationVerySmallCostPool)
const prefixRows = [...TRAIN_ROWS, ...VALIDATION_ROWS]
const baselinePrefixByScenario = {}
for (const scenarioId of Object.keys(EXECUTION.scenarios)) {
  baselinePrefixByScenario[scenarioId] = baselineFor(prefixRows, scenarioId)
}

console.error(`Testing ${validationSurvivors.length} frozen survivors under costs and local perturbations...`)
for (const record of validationSurvivors) {
  record.prefix = simulatePeriod(
    record.item,
    prefixRows,
    EXECUTION.selectionScenarioId,
    null,
    baselinePrefixByScenario[EXECUTION.selectionScenarioId].dailyMap,
    true,
  )
  const elevated = simulatePeriod(
    record.item,
    prefixRows,
    'elevated',
    null,
    baselinePrefixByScenario.elevated.dailyMap,
  )
  const stress = simulatePeriod(
    record.item,
    prefixRows,
    'stress',
    null,
    baselinePrefixByScenario.stress.dailyMap,
  )
  record.elevatedPrefixIncrementPct = elevated.summary.incrementalSumPct
  record.stressPrefixIncrementPct = stress.summary.incrementalSumPct
  const sensitivities = sensitivityCandidates(record.item).map((sensitivityItem) => {
    const result = simulatePeriod(
      sensitivityItem,
      prefixRows,
      EXECUTION.selectionScenarioId,
      null,
      baselinePrefixByScenario[EXECUTION.selectionScenarioId].dailyMap,
    )
    return result.summary.incrementalSumPct
  })
  record.sensitivity = {
    count: sensitivities.length,
    positiveFraction: round(sensitivities.filter((value) => value > 0).length / sensitivities.length),
    minimumIncrementPct: round(Math.min(...sensitivities)),
    medianIncrementPct: round([...sensitivities].sort((a, b) => a - b)[Math.floor(sensitivities.length / 2)]),
    maximumIncrementPct: round(Math.max(...sensitivities)),
  }
  record.concentration = concentrationFor(record.prefix.daily)
  record.bootstrap = movingBlockBootstrap(record.prefix.daily, record.item.id)
}

const robustPrefixSurvivors = validationSurvivors.filter((record) =>
  record.elevatedPrefixIncrementPct > 0
  && record.stressPrefixIncrementPct > 0
  && record.sensitivity.positiveFraction >= 0.9
  && record.sensitivity.minimumIncrementPct > -0.25
  && record.bootstrap.probabilityNonpositive < 0.33
)

// Freeze by train rank, not 2024 magnitude. The 2025+ rows have not participated
// in candidate construction, ranking, or gates, although the local files are not
// historically sealed and were necessarily parsed at process start.
const robustVerySmallSurvivors = robustPrefixSurvivors.filter(isVerySmall)
const robustTopFinalists = robustPrefixSurvivors.slice(0, HIDDEN_TOP_COUNT)
const robustVerySmallFinalists = robustVerySmallSurvivors.slice(0, HIDDEN_VERY_SMALL_COUNT)
const hiddenFinalists = uniqueRecords(robustTopFinalists, robustVerySmallFinalists)
const baselineHidden = baselineFor(
  HIDDEN_ROWS,
  EXECUTION.selectionScenarioId,
  baselinePrefixByScenario[EXECUTION.selectionScenarioId].state,
)
const baselineHiddenTieOut = assertBaselinePeriodTieOut(baselineHidden, HIDDEN_ROWS, 'report-only')
const baselineEndingEquityTieOut = assertBaselineEndingEquityTieOut(
  baselinePrefixByScenario[EXECUTION.selectionScenarioId].daily,
  baselineHidden.daily,
)

console.error(`Finalist freeze: ${hiddenFinalists.length}. Evaluating within-run report-only 2025+...`)
for (const record of hiddenFinalists) {
  record.hidden = simulatePeriod(
    record.item,
    HIDDEN_ROWS,
    EXECUTION.selectionScenarioId,
    record.prefix.state,
    baselineHidden.dailyMap,
    true,
  )
  record.full = combinedSummary(record.prefix.daily, record.hidden.daily)
}

const combinedPrefixLeaders = [...validationSurvivors]
  .sort((left, right) => right.prefix.summary.incrementalSumPct - left.prefix.summary.incrementalSumPct)
  .slice(0, 20)
const lowDistanceRobust = hiddenFinalists
  .filter(isVerySmall)
  .sort((left, right) => left.distance - right.distance || right.robustTrainScore - left.robustTrainScore)

const output = {
  method: {
    status: 'development-contaminated retrospective audit; no implementation authority',
    deterministic: true,
    trainOnlySelection: `2021-01-01 through ${TRAIN_END}`,
    validationPolicy: `${VALIDATION_START} through ${VALIDATION_END} withheld from train ranking and used only as pass/fail after the train freeze`,
    hiddenReportOnly: `${HIDDEN_START} onward excluded from candidate construction, ranking, and gates until after the finalist freeze; historically visible and not sealed out-of-sample`,
    candidateRange: '[0, 1.35] non-negative multiplier per target sleeve',
    generator: {
      global: `Halton(${HALTON_PRIMES.join(',')}) ${GLOBAL_HALTON_COUNT} points on [0,1.35]^6`,
      nearBaseline: `Halton(${HALTON_PRIMES.join(',')}) ${NEAR_HALTON_COUNT} points on [0.78,1.22]^6`,
      ultraNearBaseline: `Halton(${HALTON_PRIMES.join(',')}) ${ULTRA_NEAR_HALTON_COUNT} points on [0.97,1.03]^6`,
      structured: '0.01 single-leg, 0.005 global shrinkage, and 0.025 Summer/Winter component grid',
      trainLocal: `${LOCAL_SEED_COUNT} train-only seeds x ${LOCAL_POINTS_PER_SEED} deterministic Halton perturbations`,
    },
    trainConstraint: 'positive total train increment; at least 2/3 positive train years; Sharpe no more than 0.03 below baseline; drawdown no more than 1.5pp worse; turnover no more than 12% higher',
    validationConstraint: 'positive 2024 increment; Sharpe no more than 0.05 below baseline; drawdown no more than 1pp worse; turnover no more than 12% higher',
    finalConstraint: 'positive elevated/stress cost increment; >=90% positive local perturbations; worst perturbation >-0.25pp; 10-session block-bootstrap P(nonpositive)<33%',
    executionContractId: EXECUTION.contractId,
    executionContractDigestSha256: EXECUTION.digest,
    selectionScenarioId: EXECUTION.selectionScenarioId,
    ledgerPath: path.relative(REPO_ROOT, LEDGER_PATH),
    ledgerDigestSha256: sha256(LEDGER_BYTES),
    scriptDigestSha256: sha256(SCRIPT_BYTES),
    liveComponentContractDigestSha256: executableLiveComponentContractDigestSha256,
    reviewedLegCaps: LEG_CAPS,
    provenance: AUDIT_PROVENANCE,
    legKeys: LEG_KEYS,
    caveat: 'The checked ledger contains the known legacy Summer target-midnight weather contract, so this audit can reject scale changes but cannot make historical returns execution-eligible.',
  },
  counts: {
    initialUniqueCandidates: candidateMap.size - localItems.length,
    localUniqueCandidates: localItems.length,
    evaluatedCandidateCount,
    trainQualifiedCount: trainQualified.length,
    trainVerySmallQualifiedCount: trainVerySmallQualified.length,
    trainShortlistCount: trainShortlist.length,
    trainTopShortlistCount: trainTopShortlist.length,
    trainVerySmallShortlistCount: trainVerySmallShortlist.length,
    validationPassCount: validationPass.length,
    validationTopShortlistPassCount: validationPass.filter((record) => trainTopShortlistIds.has(record.item.id)).length,
    validationVerySmallShortlistPassCount: validationPass.filter((record) => trainVerySmallShortlistIds.has(record.item.id)).length,
    validationVerySmallPassCount: validationVerySmallPass.length,
    validationSurvivorCostTestCount: validationSurvivors.length,
    robustPrefixSurvivorCount: robustPrefixSurvivors.length,
    robustVerySmallPrefixSurvivorCount: robustVerySmallSurvivors.length,
    hiddenFinalistCount: hiddenFinalists.length,
  },
  baseline: {
    train: baselineTrain.summary,
    validation: baselineValidation.summary,
    prefix: baselinePrefixByScenario[EXECUTION.selectionScenarioId].summary,
    hidden: baselineHidden.summary,
    full: combinedSummary(
      baselinePrefixByScenario[EXECUTION.selectionScenarioId].daily,
      baselineHidden.daily,
    ),
  },
  baselineTieOut: {
    passed: true,
    tolerances: BASELINE_TIE_OUT_TOLERANCES,
    train: baselineTrainTieOut,
    validation: baselineValidationTieOut,
    reportOnly: baselineHiddenTieOut,
    endingEquity: baselineEndingEquityTieOut,
  },
  initialTrainLeaders: initialTrainLeaders.slice(0, 12).map(compactRecord),
  trainShortlistTop: trainShortlist.slice(0, 20).map(compactRecord),
  validationPassByFrozenTrainRank: validationPass.slice(0, 30).map(compactRecord),
  bestCombinedPrefixExploratoryOnly: combinedPrefixLeaders.map(compactRecord),
  hiddenFinalists: hiddenFinalists.map(compactRecord),
  lowDistanceRobust: lowDistanceRobust.slice(0, 20).map(compactRecord),
}

assertProvenanceFilesUnchanged(AUDIT_PROVENANCE)
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`)
const negativeHidden = hiddenFinalists.filter((record) => record.hidden.summary.incrementalSumPct < 0)
const negativeBothYears = hiddenFinalists.filter((record) =>
  record.hidden.summary.byYear['2025'] < 0 && record.hidden.summary.byYear['2026'] < 0
)
const negativeVerySmall = robustVerySmallFinalists.filter((record) => record.hidden.summary.incrementalSumPct < 0)
console.error(
  `Audit summary: ${evaluatedCandidateCount} candidates; ${trainShortlist.length} train-frozen; `
    + `${validationPass.length} passed 2024; ${hiddenFinalists.length} hidden finalists.`,
)
console.error(
  `Hidden result: ${negativeHidden.length}/${hiddenFinalists.length} trailed baseline overall; `
    + `${negativeBothYears.length}/${hiddenFinalists.length} trailed in both 2025 and 2026; `
    + `${negativeVerySmall.length}/${robustVerySmallFinalists.length} very-small finalists trailed.`,
)
console.error(`Wrote ${OUTPUT_PATH}`)
