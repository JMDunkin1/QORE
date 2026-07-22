#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadAdjustedYahooBars } from './lib/qore-research-execution.mjs'
import {
  GEFS_V12_REFORECAST_CONTRACT,
  assertReforecastDataset,
  buildTheoryFrozenCandidates,
  digestCanonicalJson,
  splitForMarketDate,
} from './lib/qore-gefs-v12-reforecast.mjs'
import { SUMMER_FORECAST_LOCATIONS } from './lib/qore-summer-location-universe.mjs'

const repoRoot = process.cwd()
const outputDir = path.resolve(
  process.env.QORE_GEFS_REFORECAST_OUTPUT_DIR
    ?? path.join(repoRoot, '.local/qore/research/gefs-v12-reforecast'),
)
const recordsPath = path.join(outputDir, 'issue-member-records.jsonl')
const manifestPath = path.join(outputDir, 'manifest.json')
const selectionReportPath = path.join(outputDir, 'selection-report.json')
const selectionLockPath = path.join(outputDir, 'selection-lock.json')
const holdoutReportPath = path.join(outputDir, 'holdout-report.json')
const marketPath = path.resolve(
  process.env.QORE_GEFS_REFORECAST_UNG_FILE
    ?? path.join(repoRoot, 'data/qore/market/yahoo/UNG-daily.csv'),
)
const revealHoldout = process.argv.includes('--reveal-holdout')
const allowPartial = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QORE_GEFS_REFORECAST_ALLOW_PARTIAL ?? '').toLowerCase(),
)
const bootstrapIterations = 2_000
const bootstrapBlockLength = 5
const implementationDigestSha256 = sha256(fs.readFileSync(fileURLToPath(import.meta.url)))

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function round(value, digits = 6) {
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

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required input: ${filePath}`)
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readRecords() {
  if (!fs.existsSync(recordsPath)) throw new Error(`Missing reforecast records: ${recordsPath}`)
  const text = fs.readFileSync(recordsPath, 'utf8')
  const records = text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid reforecast record line ${index + 1}: ${error.message}`)
    }
  })
  const keys = records.map((record) => `${record.issueDate}|${record.member}`)
  if (new Set(keys).size !== keys.length) throw new Error('Reforecast records contain duplicate issue/member keys.')
  return { records, text }
}

function validateDataset(manifest, recordsText, records) {
  return assertReforecastDataset({
    manifest,
    records,
    recordsText,
    requireComplete: !allowPartial,
  }).members
}

function aggregateIssues(records, requiredMembers, maximumIssueDate) {
  const scoped = records.filter((record) => !maximumIssueDate || record.issueDate <= maximumIssueDate)
  const groups = new Map()
  for (const record of scoped) {
    const key = `${record.issueDate}|${record.targetDate}|${record.season}`
    const group = groups.get(key) ?? {
      issueDate: record.issueDate,
      targetDate: record.targetDate,
      season: record.season,
      records: [],
    }
    group.records.push(record)
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => left.issueDate.localeCompare(right.issueDate)).map((group) => {
    const present = group.records.map((record) => record.member).sort()
    const expected = [...requiredMembers].sort()
    if (present.join('|') !== expected.join('|')) {
      throw new Error(`Issue ${group.issueDate} has members ${present.join(',')}; expected ${expected.join(',')}.`)
    }
    const locations = SUMMER_FORECAST_LOCATIONS.map((location) => {
      const rows = group.records.map((record) => record.locations.find((row) => row.locationId === location.id))
      if (rows.some((row) => !row)) throw new Error(`Issue ${group.issueDate} is missing ${location.id}.`)
      return {
        locationId: location.id,
        weight: location.weight,
        forecastAnomalyF: mean(rows.map((row) => Number(row.forecastAnomalyF))),
      }
    })
    const sampledWeight = locations.reduce((sum, location) => sum + location.weight, 0)
    return {
      issueDate: group.issueDate,
      targetDate: group.targetDate,
      season: group.season,
      memberCount: group.records.length,
      weightedAnomalyF: locations.reduce((sum, location) => sum + location.forecastAnomalyF * location.weight, 0) / sampledWeight,
      locations,
    }
  })
}

function signalsForCandidate(issues, candidate) {
  return issues.flatMap((issue) => {
    const hot = issue.season === 'summer'
    const directionalAnomaly = hot ? issue.weightedAnomalyF : -issue.weightedAnomalyF
    const qualifyingWeight = issue.locations.reduce((sum, location) => {
      const directionalLocationAnomaly = hot ? location.forecastAnomalyF : -location.forecastAnomalyF
      return sum + (directionalLocationAnomaly >= candidate.anomalyThresholdF ? location.weight : 0)
    }, 0)
    const sampledWeight = issue.locations.reduce((sum, location) => sum + location.weight, 0)
    const breadth = sampledWeight ? qualifyingWeight / sampledWeight : 0
    if (directionalAnomaly < candidate.anomalyThresholdF || breadth < candidate.breadthThreshold) return []
    return [{
      issueDate: issue.issueDate,
      targetDate: issue.targetDate,
      season: issue.season,
      weightedAnomalyF: issue.weightedAnomalyF,
      breadth,
    }]
  })
}

function targetSchedule(bars, signals, candidate) {
  const schedule = new Map(bars.map((bar) => [bar.date, 0]))
  const dates = bars.map((bar) => bar.date)
  for (const signal of signals) {
    const entryIndex = dates.findIndex((date) => date > signal.issueDate)
    if (entryIndex < 0) continue
    for (let offset = 0; offset < candidate.holdSessions && entryIndex + offset < dates.length; offset += 1) {
      schedule.set(dates[entryIndex + offset], candidate.positionFraction)
    }
  }
  return schedule
}

function simulateCandidate(bars, issues, candidate) {
  const signals = signalsForCandidate(issues, candidate)
  const schedule = targetSchedule(bars, signals, candidate)
  const rows = []
  let closeWeight = 0
  let priorTarget = 0
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1]
    const current = bars[index]
    const overnightReturn = current.open / previous.close - 1
    const intradayReturn = current.close / current.open - 1
    const equityOpenFactor = 1 + closeWeight * overnightReturn
    if (!(equityOpenFactor > 0)) throw new Error(`UNG-only equity became non-positive at ${current.date} open.`)
    const openWeight = closeWeight * (1 + overnightReturn) / equityOpenFactor
    const target = schedule.get(current.date) ?? 0
    const forceTransition = target === 0 && openWeight > 0 || target > 0 && priorTarget === 0
    const executes = forceTransition || Math.abs(target - openWeight) >= 0.0025
    const executedWeight = executes ? target : openWeight
    const turnover = executes ? Math.abs(target - openWeight) : 0
    const tradingCostFraction = turnover * GEFS_V12_REFORECAST_CONTRACT.marketEvaluation.oneWayCostBps / 10_000
    const grossReturnFraction = equityOpenFactor * (1 + executedWeight * intradayReturn) - 1
    const netReturnFraction = grossReturnFraction - equityOpenFactor * tradingCostFraction
    const closeFactorFromOpen = 1 + executedWeight * intradayReturn - tradingCostFraction
    if (!(closeFactorFromOpen > 0)) throw new Error(`UNG-only equity became non-positive at ${current.date} close.`)
    closeWeight = executedWeight * (1 + intradayReturn) / closeFactorFromOpen
    rows.push({
      date: current.date,
      split: splitForMarketDate(current.date),
      target,
      netReturnPct: netReturnFraction * 100,
      grossReturnPct: grossReturnFraction * 100,
      tradingCostPct: equityOpenFactor * tradingCostFraction * 100,
      entered: priorTarget === 0 && target > 0,
    })
    priorTarget = target
  }
  return { rows, signals }
}

function metrics(rows) {
  if (!rows.length) return {
    sessionCount: 0, activeSessions: 0, entryCount: 0, totalReturnPct: 0, cagrPct: 0,
    sharpe: 0, sortino: 0, maxDrawdownPct: 0, tradingCostPct: 0,
  }
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (const row of rows) {
    equity *= 1 + row.netReturnPct / 100
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100)
  }
  const returns = rows.map((row) => row.netReturnPct / 100)
  const average = mean(returns)
  const deviation = standardDeviation(returns)
  const downside = Math.sqrt(mean(returns.map((value) => Math.min(value, 0) ** 2)))
  const years = Math.max(1 / 252, rows.length / 252)
  return {
    sessionCount: rows.length,
    activeSessions: rows.filter((row) => row.target > 0).length,
    entryCount: rows.filter((row) => row.entered).length,
    totalReturnPct: round((equity - 1) * 100, 4),
    cagrPct: round((equity ** (1 / years) - 1) * 100, 4),
    sharpe: round(deviation ? average / deviation * Math.sqrt(252) : 0, 4),
    sortino: round(downside ? average / downside * Math.sqrt(252) : 0, 4),
    maxDrawdownPct: round(maxDrawdown, 4),
    tradingCostPct: round(rows.reduce((sum, row) => sum + row.tradingCostPct, 0), 4),
  }
}

function metricsByYear(rows) {
  return Object.fromEntries([...new Set(rows.map((row) => row.date.slice(0, 4)))].sort().map((year) => [
    year,
    metrics(rows.filter((row) => row.date.startsWith(year))),
  ]))
}

function createRng(seedHex) {
  let state = Number.parseInt(seedHex.slice(0, 8), 16) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4_294_967_296
  }
}

function selectionAdjustedPValue(candidateReturns, selectedCandidateId) {
  const selected = candidateReturns.find((candidate) => candidate.candidateId === selectedCandidateId)
  if (!selected || !selected.returns.length) return 1
  const observed = mean(selected.returns)
  if (!(observed > 0)) return 1
  const length = selected.returns.length
  if (candidateReturns.some((candidate) => candidate.returns.length !== length)) {
    throw new Error('Candidate validation return vectors are not aligned.')
  }
  const centered = candidateReturns.map((candidate) => {
    const average = mean(candidate.returns)
    return candidate.returns.map((value) => value - average)
  })
  const rng = createRng(digestCanonicalJson({
    family: GEFS_V12_REFORECAST_CONTRACT.candidateFamily,
    selectedCandidateId,
    length,
  }))
  let exceedances = 0
  for (let iteration = 0; iteration < bootstrapIterations; iteration += 1) {
    const indices = []
    while (indices.length < length) {
      const start = Math.floor(rng() * length)
      for (let offset = 0; offset < bootstrapBlockLength && indices.length < length; offset += 1) {
        indices.push((start + offset) % length)
      }
    }
    const maximumMean = Math.max(...centered.map((returns) =>
      indices.reduce((sum, index) => sum + returns[index], 0) / length,
    ))
    if (maximumMean >= observed) exceedances += 1
  }
  return round((exceedances + 1) / (bootstrapIterations + 1), 6)
}

function candidateSummary(candidate, simulation) {
  const trainRows = simulation.rows.filter((row) => row.split === 'train')
  const validationRows = simulation.rows.filter((row) => row.split === 'validation')
  return {
    ...candidate,
    train: metrics(trainRows),
    validation: metrics(validationRows),
    validationByYear: metricsByYear(validationRows),
    signalCountThroughValidation: simulation.signals.filter((signal) => signal.issueDate <= '2016-12-31').length,
    validationReturns: validationRows.map((row) => row.netReturnPct / 100),
  }
}

function compareCandidates(left, right) {
  return right.train.sharpe - left.train.sharpe
    || right.train.totalReturnPct - left.train.totalReturnPct
    || left.candidateId.localeCompare(right.candidateId)
}

function lockDigest(lock) {
  return digestCanonicalJson(Object.fromEntries(Object.entries(lock).filter(([key]) => key !== 'lockDigestSha256')))
}

function validateLock(lock, bindings) {
  if (lock.schemaVersion !== 1 || lock.lockDigestSha256 !== lockDigest(lock)) throw new Error('Selection lock is invalid or has been modified.')
  for (const [key, expected] of Object.entries(bindings)) {
    if (lock[key] !== expected) throw new Error(`Selection lock ${key} no longer matches the frozen input.`)
  }
}

function main() {
  const manifest = readJson(manifestPath)
  const { records, text: recordsText } = readRecords()
  const requiredMembers = validateDataset(manifest, recordsText, records)
  const datasetDigestSha256 = sha256(recordsText)
  const manifestDigestSha256 = sha256(fs.readFileSync(manifestPath))
  const marketDigestSha256 = sha256(fs.readFileSync(marketPath))
  const candidateFamilyDigestSha256 = digestCanonicalJson(GEFS_V12_REFORECAST_CONTRACT.candidateFamily)
  const bindings = {
    datasetDigestSha256,
    manifestDigestSha256,
    marketDigestSha256,
    implementationDigestSha256,
    candidateFamilyDigestSha256,
  }
  const market = GEFS_V12_REFORECAST_CONTRACT.marketEvaluation

  if (revealHoldout) {
    const lock = readJson(selectionLockPath)
    validateLock(lock, bindings)
    if (lock.validationSupportive !== true) {
      throw new Error('Hidden holdout reveal is blocked because the frozen 2015-2016 validation gate did not pass.')
    }
    const candidate = buildTheoryFrozenCandidates().find((value) => value.candidateId === lock.selectedCandidateId)
    if (!candidate) throw new Error('Locked candidate is no longer in the frozen family.')
    const bars = loadAdjustedYahooBars(marketPath).filter((bar) => bar.date <= market.hiddenHoldoutEnd)
    const issues = aggregateIssues(records, requiredMembers, market.hiddenHoldoutEnd)
    const simulation = simulateCandidate(bars, issues, candidate)
    const holdoutRows = simulation.rows.filter((row) => row.split === 'holdout')
    const report = {
      schemaVersion: 1,
      reportId: 'qore-gefs-v12-hidden-holdout-v1',
      generatedAt: new Date().toISOString(),
      status: 'hidden-holdout-revealed-for-locked-winner-only',
      lockDigestSha256: lock.lockDigestSha256,
      selectedCandidate: candidate,
      holdout: metrics(holdoutRows),
      holdoutByYear: metricsByYear(holdoutRows),
      holdoutSignalCount: simulation.signals.filter((signal) => signal.issueDate >= market.hiddenHoldoutStart).length,
      datasetComplete: manifest.complete === true,
      memberSet: requiredMembers,
      promotion: GEFS_V12_REFORECAST_CONTRACT.promotion,
      interpretation:
        'This holdout is evidence about a narrow physical-demand weather-follow thesis only. It is not permission to change ngas-all-year-beta or enable paper/live routing.',
    }
    fs.writeFileSync(holdoutReportPath, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`Revealed locked winner ${candidate.candidateId}: holdout ${report.holdout.totalReturnPct}% (${holdoutReportPath})\n`)
    return
  }

  const bars = loadAdjustedYahooBars(marketPath).filter((bar) => bar.date <= market.validationEnd)
  const issues = aggregateIssues(records, requiredMembers, market.validationEnd)
  const candidates = buildTheoryFrozenCandidates()
  const summaries = candidates.map((candidate) => candidateSummary(candidate, simulateCandidate(bars, issues, candidate)))
  const ranked = [...summaries].sort(compareCandidates)
  const selected = ranked[0]
  if (!selected) throw new Error('Frozen candidate family was empty.')
  const pValue = selectionAdjustedPValue(
    summaries.map((candidate) => ({ candidateId: candidate.candidateId, returns: candidate.validationReturns })),
    selected.candidateId,
  )
  const validationYearPositive = Object.fromEntries(['2015', '2016'].map((year) => [
    year,
    Number(selected.validationByYear[year]?.totalReturnPct) > 0,
  ]))
  const validationSupportive = selected.validation.totalReturnPct > 0
    && selected.validation.sharpe > 0
    && selected.validation.activeSessions >= 20
    && Object.values(validationYearPositive).every(Boolean)
    && pValue <= 0.2
  const lockPayload = {
    schemaVersion: 1,
    lockId: 'qore-gefs-v12-selection-before-2017-holdout-v1',
    ...bindings,
    selectedCandidateId: selected.candidateId,
    selectedOn: 'train-only',
    trainEnd: market.trainEnd,
    validationStart: market.validationStart,
    validationEnd: market.validationEnd,
    hiddenHoldoutStart: market.hiddenHoldoutStart,
    hiddenHoldoutEnd: market.hiddenHoldoutEnd,
    hiddenHoldoutStatus: 'not-evaluated',
    validationYearPositive,
    validationSupportive,
    validationSelectionAdjustedPValue: pValue,
  }
  const lock = { ...lockPayload, lockDigestSha256: lockDigest(lockPayload) }
  if (fs.existsSync(selectionLockPath)) {
    const prior = readJson(selectionLockPath)
    if (JSON.stringify(prior) !== JSON.stringify(lock)) {
      throw new Error('A different selection lock already exists; use a new output directory rather than silently relocking the holdout.')
    }
  } else {
    fs.writeFileSync(selectionLockPath, `${JSON.stringify(lock, null, 2)}\n`)
  }
  const report = {
    schemaVersion: 1,
    reportId: 'qore-gefs-v12-train-validation-selection-v1',
    generatedAt: new Date().toISOString(),
    status: 'selection-locked-before-hidden-holdout',
    datasetComplete: manifest.complete === true,
    memberSet: requiredMembers,
    sourceCaveat: GEFS_V12_REFORECAST_CONTRACT.archive.historicalAvailabilityCaveat,
    splitContract: {
      trainEnd: market.trainEnd,
      validationStart: market.validationStart,
      validationEnd: market.validationEnd,
      hiddenHoldoutStart: market.hiddenHoldoutStart,
      hiddenHoldoutEnd: market.hiddenHoldoutEnd,
    },
    family: {
      ...GEFS_V12_REFORECAST_CONTRACT.candidateFamily,
      candidateCount: candidates.length,
      selectionAdjustedBootstrap: {
        method: 'centered circular block bootstrap of maximum validation mean across the frozen family',
        iterations: bootstrapIterations,
        blockLength: bootstrapBlockLength,
        pValue,
      },
    },
    selectedCandidate: {
      candidateId: selected.candidateId,
      anomalyThresholdF: selected.anomalyThresholdF,
      breadthThreshold: selected.breadthThreshold,
      holdSessions: selected.holdSessions,
      positionFraction: selected.positionFraction,
      train: selected.train,
      validation: selected.validation,
      validationByYear: selected.validationByYear,
      validationYearPositive,
      validationSupportive,
    },
    candidates: ranked.map(({ validationReturns, ...candidate }) => candidate),
    selectionLock: lock,
    promotion: GEFS_V12_REFORECAST_CONTRACT.promotion,
    nextStep: 'Only `--reveal-holdout` evaluates the locked winner on 2017-2019; it does not evaluate challenger holdouts.',
  }
  fs.writeFileSync(selectionReportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`Locked ${selected.candidateId}; validation ${selected.validation.totalReturnPct}%, family p=${pValue}. Holdout remains unread.\n`)
}

main()
