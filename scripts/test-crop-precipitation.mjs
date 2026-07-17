#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Papa from 'papaparse'

const repoRoot = process.cwd()
const dataRoot = process.env.QORE_DATA_ROOT ?? path.join(repoRoot, 'data', 'qore')
const outputRoot = process.env.QORE_OUTPUT_ROOT ?? path.join(dataRoot, 'research', 'strategy-agent-runs', 'crop-precipitation-refined')
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'crop-precipitation-universe.json'), 'utf8'))
const basketConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data', 'qore', 'market', 'index-basket-config.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'weather', 'crop-precipitation', 'collection-manifest.json'), 'utf8'))
const frozen = JSON.parse(fs.readFileSync(path.join(outputRoot, 'frozen-selection.json'), 'utf8'))
const selection = JSON.parse(fs.readFileSync(path.join(outputRoot, 'selection-summary.json'), 'utf8'))
const summary = JSON.parse(fs.readFileSync(path.join(outputRoot, 'run-summary.json'), 'utf8'))

function parseCsv(filePath) {
  const result = Papa.parse(fs.readFileSync(filePath, 'utf8'), { header: true, skipEmptyLines: true, dynamicTyping: true })
  if (result.errors.length) throw new Error(`${filePath}: ${result.errors[0].message}`)
  return result.data
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function closeEnough(left, right, tolerance = 1e-10) {
  return Math.abs(Number(left) - Number(right)) <= tolerance
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

function selectionCsvHash(text) {
  const lines = text.trim().split(/\r?\n/)
  return sha256Text(`${[lines[0], ...lines.slice(1).filter((line) => line.slice(0, 10) <= '2026-01-15')].join('\n')}\n`)
}

assert(manifest.status === 'ok' && manifest.counts.failures === 0, 'collection manifest must be complete')
assert(manifest.counts.weatherRows > 400000, 'expected more than 400,000 precipitation observations')
assert(frozen.contract.optimizationEnd === '2026-01-15', 'optimization cutoff must be pinned to 2026-01-15')
assert(frozen.contract.walkForwardStart === '2026-01-16', 'walk-forward must begin 2026-01-16')
assert(frozen.contract.selectionUsesWalkForward === false, 'selection contract must exclude walk-forward')
assert(selection.status === 'selection-frozen-walk-forward-unopened', 'selection artifact must state unopened walk-forward posture')
assert(selection.freezeDigest === frozen.freezeDigest && summary.freezeDigest === frozen.freezeDigest, 'freeze digest mismatch across artifacts')

const frozenPayload = { ...frozen }
delete frozenPayload.generatedAt
delete frozenPayload.freezeDigest
assert(sha256Text(JSON.stringify(frozenPayload)) === frozen.freezeDigest, 'frozen selection content digest is invalid')

for (const [relativePath, expectedHash] of Object.entries(frozen.inputHashes.files)) {
  const filePath = path.join(repoRoot, relativePath)
  const text = fs.readFileSync(filePath, 'utf8')
  if (!relativePath.endsWith('.csv')) {
    assert(sha256Text(text) === expectedHash, `frozen fixed-input hash mismatch for ${relativePath}`)
    continue
  }
  assert(selectionCsvHash(text) === expectedHash, `frozen pre-cutoff hash mismatch for ${relativePath}`)
  const mutated = text.split(/\r?\n/).map((line, index) => {
    if (index === 0 || line.slice(0, 10) <= '2026-01-15') return line
    return `${line.slice(0, 10)},999999,-999999,999999,-999999,post-cutoff-poison`
  }).join('\n')
  assert(selectionCsvHash(mutated) === expectedHash, `post-cutoff mutation changed selection hash for ${relativePath}`)
}

assert(basketConfig.symbol === 'US-INDEX-BASKET', 'fallback symbol must be US-INDEX-BASKET')
assert(basketConfig.rebalance === 'daily-target-weight', 'fallback must use daily target weights')
const weights = Object.fromEntries(basketConfig.components.map((component) => [component.symbol, Number(component.targetWeight)]))
assert(closeEnough(weights.VOO, 0.8) && closeEnough(weights.QQQM, 0.2), 'fallback must be exactly 80% VOO and 20% QQQM')
assert(closeEnough(Object.values(weights).reduce((sum, value) => sum + value, 0), 1), 'fallback weights must sum to one')

const marketDir = path.join(dataRoot, 'market', 'yahoo')
const voo = new Map(parseCsv(path.join(marketDir, 'VOO-daily.csv')).map((row) => [row.date, Number(row.adjustedClose)]))
const qqqm = new Map(parseCsv(path.join(marketDir, 'QQQM-daily.csv')).map((row) => [row.date, Number(row.adjustedClose)]))
const basket = parseCsv(path.join(marketDir, 'US-INDEX-BASKET-qore-market.csv'))
for (let index = 1; index < basket.length; index += 1) {
  const date = basket[index].date
  const priorDate = basket[index - 1].date
  const expected = 0.8 * (voo.get(date) / voo.get(priorDate) - 1) + 0.2 * (qqqm.get(date) / qqqm.get(priorDate) - 1)
  const actual = Number(basket[index].close) / Number(basket[index - 1].close) - 1
  assert(closeEnough(actual, expected, 1e-8), `synthetic fallback return mismatch on ${date}`)
}
assert(basket[0].date === '2020-10-13', 'literal QQQM basket should begin at inception overlap')
assert(basket.at(-1).date >= summary.contract.walkForwardEnd, 'fallback does not cover the full walk-forward end')

const candidates = parseCsv(path.join(outputRoot, 'candidate-summary.csv'))
assert(candidates.length === selection.search.candidateCount, 'candidate-summary row count mismatch')
assert(!Object.keys(candidates[0]).some((key) => /holdout|walk.?forward/i.test(key)), 'selection ledger exposes walk-forward metrics')
for (const crop of config.crops) {
  const cropCandidates = candidates.filter((row) => row.cropId === crop.id)
  const eligible = cropCandidates.filter((row) => row.eligible === true || row.eligible === 'true')
  const pool = eligible.length ? eligible : cropCandidates
  pool.sort((left, right) => Number(right.selectionRank) - Number(left.selectionRank))
  const selected = frozen.selectedCrops.find((item) => item.cropId === crop.id)
  assert(selected?.candidate.id === pool[0].candidateId, `${crop.id} frozen rule is not the top eligible pre-cutoff rule`)
}

const daily = parseCsv(path.join(outputRoot, 'selected-daily.csv'))
assert(daily.some((row) => row.date === '2026-01-16'), 'walk-forward boundary return is missing')
for (const row of daily) {
  if (row.date <= frozen.contract.optimizationEnd) continue
  assert(row.date >= frozen.contract.walkForwardStart, `split gap detected on ${row.date}`)
}
for (const row of daily.filter((item) => Number(item.position) === 0 && Number(item.turnover) === 0)) {
  assert(closeEnough(row.strategyReturn, row.benchmarkReturn, 1e-10), `flat fallback mismatch for ${row.cropId}/${row.date}`)
  assert(closeEnough(row.indexFraction, 1), `flat row index fraction must be one for ${row.cropId}/${row.date}`)
}
for (const row of daily) {
  const expectedFraction = Math.max(0, 1 - Math.abs(Number(row.position)))
  assert(closeEnough(row.indexFraction, expectedFraction), `index fraction formula mismatch for ${row.cropId}/${row.date}`)
  const expectedGross = Number(row.position) * Number(row.cropReturn) + expectedFraction * Number(row.benchmarkReturn)
  assert(closeEnough(row.grossReturn, expectedGross, 1e-10), `gross fallback formula mismatch for ${row.cropId}/${row.date}`)
}

const trades = parseCsv(path.join(outputRoot, 'selected-trades.csv'))
for (const row of trades) {
  assert(row.entryReturnDate > row.signalDate, `same-session return timing at ${row.cropId}/${row.signalDate}`)
  const expectedSplit = row.entryReturnDate <= frozen.contract.trainEnd
    ? 'train'
    : row.entryReturnDate <= frozen.contract.optimizationEnd ? 'validation' : 'holdout'
  assert(row.split === expectedSplit, `split mismatch at ${row.cropId}/${row.entryReturnDate}`)
}

const report = fs.readFileSync(path.join(outputRoot, 'report.html'), 'utf8')
assert(report.includes('Pseudo-walk-forward discovery evidence'), 'report must visibly state pseudo-walk-forward limitations')
assert(report.includes('80% VOO / 20% QQQM'), 'report must state the exact fallback basket')
assert(report.includes(frozen.freezeDigest), 'report must expose the frozen-selection digest')

console.log(`refined crop checks passed: ${config.crops.length} crops, ${manifest.counts.weatherRows} weather rows, ${candidates.length} pre-cutoff candidates, ${daily.length} selected daily rows`)
