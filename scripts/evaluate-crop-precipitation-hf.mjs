#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  cropFeatures,
  marketData,
  metrics,
  portfolioFromCrops,
  rangeForDates,
  simulatePositions,
} from './optimize-crop-precipitation-hf.mjs'

const ROOT = process.cwd()
const DATA_ROOT = process.env.QORE_DATA_ROOT ?? path.join(ROOT, 'data', 'qore')
const OUTPUT_ROOT = process.env.QORE_OUTPUT_ROOT ?? path.join(DATA_ROOT, 'research', 'strategy-agent-runs', 'crop-precipitation-hf')
const CONFIG_FILE = process.env.QORE_CROP_PRECIP_CONFIG ?? path.join(ROOT, 'config', 'crop-weather-soy-corn.json')
const MANIFEST_FILE = path.join(DATA_ROOT, 'weather', 'crop-precipitation-hf', 'collection-manifest.json')
const FROZEN_MODEL_FILE = process.env.QORE_FROZEN_MODEL ?? path.join(OUTPUT_ROOT, 'frozen-model.json')
const EVALUATION_FILE = path.join(OUTPUT_ROOT, 'future-holdout-evaluation.json')
const OPTIMIZER_FILE = fileURLToPath(new URL('./optimize-crop-precipitation-hf.mjs', import.meta.url))
const EVALUATOR_FILE = fileURLToPath(import.meta.url)
const COLLECTOR_FILE = fileURLToPath(new URL('./collect-crop-precipitation-data.mjs', import.meta.url))

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value) }
function assert(condition, message) { if (!condition) throw new Error(message) }
function addDays(dateText, days) { const date = new Date(`${dateText}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
function resolveFrozenInput(relativePath) {
  const defaultDataRoot = path.join('data', 'qore')
  if (relativePath === defaultDataRoot || relativePath.startsWith(`${defaultDataRoot}${path.sep}`)) {
    return path.join(DATA_ROOT, path.relative(defaultDataRoot, relativePath))
  }
  return path.join(ROOT, relativePath)
}

export function verifyAppendOnlyPrefix(relativePath, snapshot, dataAvailableThrough) {
  const file = resolveFrozenInput(relativePath)
  const bytes = fs.readFileSync(file)
  const prefixBytes = Number(snapshot?.bytes)
  const mutableTailRows = Number(snapshot?.mutableTailRows)
  assert(snapshot?.through && snapshot.through <= dataAvailableThrough, `Frozen prefix date is invalid for ${relativePath}.`)
  assert(snapshot?.observedThrough && snapshot.observedThrough >= snapshot.through && snapshot.observedThrough <= dataAvailableThrough, `Frozen observed-data boundary is invalid for ${relativePath}.`)
  assert(Number.isInteger(mutableTailRows) && mutableTailRows >= 0, `Frozen mutable-tail declaration is invalid for ${relativePath}.`)
  assert(mutableTailRows === 0 ? snapshot.through === snapshot.observedThrough : snapshot.through < snapshot.observedThrough, `Frozen finalized-data boundary is invalid for ${relativePath}.`)
  assert(Number.isInteger(prefixBytes) && prefixBytes > 0 && bytes.length >= prefixBytes, `Frozen prefix is missing or truncated for ${relativePath}.`)
  assert(sha256(bytes.subarray(0, prefixBytes)) === snapshot.sha256, `Pre-freeze input changed for ${relativePath}; refusing to evaluate.`)
  const suffix = bytes.subarray(prefixBytes).toString('utf8').split(/\r?\n/).filter(Boolean)
  const suffixDates = suffix.map((row) => {
    const separator = row.indexOf(',')
    assert(separator > 0, `Malformed row detected after the frozen prefix for ${relativePath}.`)
    return row.slice(0, separator)
  })
  let priorDate = snapshot.through
  for (const date of suffixDates) {
    assert(date > priorDate, `Suffix dates are not strictly increasing after the frozen prefix for ${relativePath}.`)
    priorDate = date
  }
  assert(mutableTailRows === 0 || suffixDates.includes(snapshot.observedThrough), `Frozen mutable-tail anchor ${snapshot.observedThrough} is missing for ${relativePath}.`)
}

function verifyFrozenModel(frozen, manifest) {
  const payload = { ...frozen }
  delete payload.generatedAt
  delete payload.freezeDigest
  assert(sha256(JSON.stringify(payload)) === frozen.freezeDigest, 'Frozen model digest is invalid; refusing to evaluate.')
  assert(Array.isArray(frozen.selectedCrops), 'Frozen model has no selected crop ledger.')
  assert(Number.isFinite(Number(frozen.overlayNotional)), 'Frozen model has no overlay notional.')
  assert(sha256(fs.readFileSync(OPTIMIZER_FILE)) === frozen.inputHashes?.optimizer, 'Optimizer semantics differ from the frozen source; refusing to evaluate.')
  assert(sha256(fs.readFileSync(EVALUATOR_FILE)) === frozen.inputHashes?.evaluator, 'Evaluator semantics differ from the frozen source; refusing to evaluate.')
  assert(sha256(fs.readFileSync(COLLECTOR_FILE)) === frozen.inputHashes?.collector, 'Collector semantics differ from the frozen source; refusing to evaluate.')
  assert(frozen.inputHashes?.files && sha256(JSON.stringify(frozen.inputHashes.files)) === frozen.inputHashes.combined, 'Frozen input hash ledger is invalid; refusing to evaluate.')

  const frozenContract = frozen.collectionContract
  assert(frozenContract && frozenContract.endDate === frozen.frozenThrough, 'Frozen collection contract is missing or inconsistent.')
  assert(frozen.dataAvailableThrough >= frozen.frozenThrough, 'Frozen available-data boundary predates the training boundary.')
  assert(frozen.futureHoldoutStart === addDays(frozen.dataAvailableThrough, 1), 'Future holdout does not begin after all data available at freeze time.')
  for (const [key, value] of Object.entries(frozenContract)) {
    if (key !== 'endDate') assert(JSON.stringify(manifest.contract?.[key]) === JSON.stringify(value), `Collection contract field ${key} differs from the freeze.`)
  }
  assert(manifest.contract?.endDate >= frozen.frozenThrough, 'Collection manifest ends before the frozen training boundary.')

  const manifestPath = path.join('data', 'qore', 'weather', 'crop-precipitation-hf', 'collection-manifest.json')
  const configPath = frozenContract.configFile
  const immutablePaths = [configPath, path.join('data', 'qore', 'market', 'index-basket-config.json')]
  assert(frozen.inputHashes.files[manifestPath], 'Frozen manifest hash is absent from the input ledger.')
  for (const relativePath of immutablePaths) {
    const activeFile = relativePath === configPath ? CONFIG_FILE : resolveFrozenInput(relativePath)
    const expectedHash = frozen.inputHashes.files[relativePath]
    assert(expectedHash && sha256(fs.readFileSync(activeFile)) === expectedHash, `Immutable frozen input changed for ${relativePath}; refusing to evaluate.`)
  }

  const prefixes = frozen.inputHashes.appendOnlyPrefixes
  assert(prefixes && typeof prefixes === 'object', 'Frozen append-only input ledger is missing; refusing to evaluate.')
  const csvPaths = Object.keys(frozen.inputHashes.files).filter((relativePath) => relativePath.endsWith('.csv'))
  assert(csvPaths.length === Object.keys(prefixes).length && csvPaths.every((relativePath) => prefixes[relativePath]), 'Frozen append-only input ledger is incomplete.')
  for (const relativePath of csvPaths) verifyAppendOnlyPrefix(relativePath, prefixes[relativePath], frozen.dataAvailableThrough)
}

function frozenPositions(ensemble, features, market, allocation) {
  const output = new Float32Array(market.dates.length)
  if (!ensemble.length) return output
  const sleeves = ensemble.map((item) => simulatePositions(item.candidate, features, market))
  for (let index = 0; index < output.length; index += 1) {
    output[index] = sleeves.reduce((sum, positions) => sum + Number(positions[index]), 0) / sleeves.length * allocation
  }
  return output
}

function main() {
  const frozenBytesBefore = fs.readFileSync(FROZEN_MODEL_FILE)
  const frozen = JSON.parse(frozenBytesBefore.toString('utf8'))
  const config = readJson(CONFIG_FILE)
  const manifest = readJson(MANIFEST_FILE)
  verifyFrozenModel(frozen, manifest)
  assert(manifest.status === 'ok', `Collection manifest is ${manifest.status}.`)

  const cropsById = new Map(config.crops.map((crop) => [crop.id, crop]))
  const results = frozen.selectedCrops.map((selection) => {
    const crop = cropsById.get(selection.cropId)
    assert(crop, `Frozen crop ${selection.cropId} is absent from the active config.`)
    assert(crop.symbol === selection.symbol, `Frozen symbol for ${selection.cropId} no longer matches the active config.`)
    console.log(`evaluate frozen ensemble: ${crop.id}`)
    const market = marketData(crop)
    const features = cropFeatures(crop, market)
    const oosPositions = frozenPositions(selection.ensemble, features, market, Number(frozen.overlayNotional))
    const [start, end] = rangeForDates(market, frozen.futureHoldoutStart, manifest.contract.endDate)
    return {
      crop,
      market,
      oosPositions,
      evaluationRows: Math.max(0, end - start),
      // A frozen paper sleeve is funded at the holdout boundary, even when the
      // frozen signal was already active on the preceding historical session.
      metrics: metrics(oosPositions, market, start, end, 1, undefined, true),
      frozenCandidates: selection.ensemble.map((item) => item.candidate.id),
    }
  })

  const evaluatedThrough = results.reduce((latestCommon, result) => {
    const cropEnd = result.market.dates.at(-1) ?? frozen.frozenThrough
    return cropEnd < latestCommon ? cropEnd : latestCommon
  }, manifest.contract.endDate)
  const portfolio = portfolioFromCrops(results, frozen.futureHoldoutStart, evaluatedThrough, { launchFromZero: true })
  const hasHoldout = evaluatedThrough >= frozen.futureHoldoutStart && portfolio.dates.length > 0
  const evaluation = {
    generatedAt: new Date().toISOString(),
    status: hasHoldout ? 'frozen-future-holdout-evaluated' : 'awaiting-post-freeze-data',
    freezeDigest: frozen.freezeDigest,
    frozenThrough: frozen.frozenThrough,
    dataAvailableThrough: frozen.dataAvailableThrough,
    futureHoldoutStart: frozen.futureHoldoutStart,
    evaluatedThrough,
    selectionPerformed: false,
    frozenModelWritten: false,
    crops: results.map((result) => ({
      cropId: result.crop.id,
      symbol: result.crop.symbol,
      evaluationRows: result.evaluationRows,
      frozenCandidates: result.frozenCandidates,
      metrics: result.metrics,
    })),
    portfolio: { evaluationRows: portfolio.dates.length, metrics: portfolio.metrics },
    output: path.relative(ROOT, EVALUATION_FILE),
  }
  write(EVALUATION_FILE, `${JSON.stringify(evaluation, null, 2)}\n`)
  const frozenBytesAfter = fs.readFileSync(FROZEN_MODEL_FILE)
  assert(frozenBytesBefore.equals(frozenBytesAfter), 'Frozen model changed during evaluation.')
  console.log(`evaluation: ${evaluation.output}`)
  console.log(`freeze unchanged: ${frozen.freezeDigest}`)
  console.log(hasHoldout ? `evaluated through ${evaluatedThrough}` : `awaiting data on or after ${frozen.futureHoldoutStart}`)
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
