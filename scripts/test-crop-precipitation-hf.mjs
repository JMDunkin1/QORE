#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import Papa from 'papaparse'
import { appendMarketTail, cappedCoverageEnd, latestExpectedMarketSession, marketCacheCovers, reconcileAdjustedMarketTail, yahooHistorySource } from './collect-crop-precipitation-data.mjs'
import { verifyAppendOnlyPrefix } from './evaluate-crop-precipitation-hf.mjs'
import { csvPrefixSnapshot, directMetrics, freezeWritePlan, metrics, portfolioFromCrops, refreezeVersion } from './optimize-crop-precipitation-hf.mjs'

const root = process.cwd()
const dataRoot = process.env.QORE_DATA_ROOT ?? path.join(root, 'data', 'qore')
const outputRoot = process.env.QORE_OUTPUT_ROOT ?? path.join(dataRoot, 'research', 'strategy-agent-runs', 'crop-precipitation-hf')
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'crop-weather-soy-corn.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'weather', 'crop-precipitation-hf', 'collection-manifest.json'), 'utf8'))
const summary = JSON.parse(fs.readFileSync(path.join(outputRoot, 'run-summary.json'), 'utf8'))
const frozen = JSON.parse(fs.readFileSync(path.join(outputRoot, 'frozen-model.json'), 'utf8'))
const repositoryEvaluation = JSON.parse(fs.readFileSync(path.join(outputRoot, 'future-holdout-evaluation.json'), 'utf8'))
const basketConfig = JSON.parse(fs.readFileSync(path.join(dataRoot, 'market', 'index-basket-config.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function assert(condition, message) { if (!condition) throw new Error(message) }
function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function parseCsv(file) {
  const parsed = Papa.parse(fs.readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true, dynamicTyping: true })
  if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0].message}`)
  return parsed.data
}
function closeEnough(left, right, tolerance = 1e-8) { return Math.abs(Number(left) - Number(right)) <= tolerance }
function addDays(dateText, days) { const date = new Date(`${dateText}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }

assert(manifest.status === 'ok' && manifest.counts.failures === 0, 'expanded collection must be complete')
assert(manifest.contract.startDate === '1981-01-01', 'weather collection must start in 1981')
assert(manifest.request.endDate >= manifest.contract.endDate, 'actual weather coverage cannot exceed the requested collection end')
const commonWeatherEnd = manifest.weather.reduce((end, item) => item.lastDate < end ? item.lastDate : end, manifest.request.endDate)
assert(manifest.contract.endDate === commonWeatherEnd, 'freeze boundary must use common actual weather coverage')
assert(manifest.weather.every((item) => item.lastDate >= manifest.contract.endDate), 'a weather series ends before the declared common coverage')
assert(manifest.contract.configFile === 'config/crop-weather-soy-corn.json', 'manifest points at the retired crop config')
assert(manifest.counts.sites === 20 && manifest.counts.weatherRows > 330000, 'expanded soybean/corn weather coverage is missing')
assert(config.crops.length === 2, 'active universe must contain two crops')
assert(config.crops.map((crop) => crop.id).join(',') === 'soybeans,corn', 'unexpected active crop universe')
for (const crop of config.crops) {
  const weight = crop.sites.reduce((sum, site) => sum + Number(site.weight), 0)
  assert(closeEnough(weight, 1), `${crop.id} site weights must sum to one`)
}

assert(summary.status === 'rolling-pseudo-walk-forward-complete-future-holdout-frozen', 'unexpected run posture')
assert(frozen.dataAvailableThrough >= manifest.contract.endDate, 'available-data boundary predates the model training boundary')
assert(summary.futureHoldoutStart === addDays(frozen.dataAvailableThrough, 1), 'new untouched holdout must start after every row available at freeze time')
assert(summary.search.oosCore === '2010-01-01 through 2025-12-31', 'core rolling window changed')
assert(summary.search.candidatesPerCrop === 3840, 'nested regional candidate grid size changed unexpectedly')
assert(summary.crops.length === 2 && summary.data.crops === 2, 'retired crops leaked into active outputs')
assert(summary.data.weatherVariables.join(',') === 'precipitationMm,temperatureC,maxTemperatureC', 'temperature variables are missing from the run')
const allowedFamilies = new Set(['hot-dry-long', 'drought-long', 'cool-wet-short', 'warm-wet-short'])
assert(summary.search.activeFamilies.length === 4 && summary.search.activeFamilies.every((family) => allowedFamilies.has(family.id)), 'non-atomic photo rule family entered the active search')
assert(summary.search.innerValidationYears === 5 && summary.search.rollingTrainYears === 10, 'nested walk-forward windows changed')
assert(closeEnough(summary.search.overlayNotional, 0.35) && closeEnough(frozen.overlayNotional, 0.35), 'fixed crop-futures overlay cap changed')
assert(summary.search.failClosedFallback.includes('zero crop overlay'), 'optimizer must fail closed to the basket')
assert(summary.crops.every((crop) => crop.core.annualEntries >= 10), 'selected rolling strategy did not meet the high-frequency floor')
assert(summary.crops.every((crop) => crop.core.endDate === '2025-12-31'), 'core evidence must exclude exposed 2026')
assert(summary.crops.every((crop) => crop.exposed2026.startDate >= '2026-01-01'), 'exposed diagnostic boundary mismatch')
assert(summary.crops.every((crop) => crop.exposed2026.endDate === manifest.contract.endDate && crop.exactEra.endDate === manifest.contract.endDate), 'market rows beyond the declared freeze date entered optimization')
assert(packageJson.scripts['walkforward:crop-precipitation'] === 'node scripts/evaluate-crop-precipitation-hf.mjs', 'walk-forward command must use the frozen evaluator')
assert(packageJson.scripts['refreeze:crop-precipitation'] === 'node scripts/optimize-crop-precipitation-hf.mjs --refreeze', 'explicit refreeze command is missing')

const lateInceptionRows = [{ date: '2010-09-09', close: '100' }, { date: manifest.request.endDate, close: '101' }]
assert(marketCacheCovers(lateInceptionRows, manifest.request.endDate), 'late-inception market history must be reusable')
assert(!marketCacheCovers(lateInceptionRows.slice(0, -1), manifest.request.endDate), 'a truncated market cache must not satisfy the requested coverage')
assert(cappedCoverageEnd(addDays(manifest.request.endDate, 1), manifest.request.endDate) === manifest.request.endDate, 'cached weather coverage must not extend the requested contract')
assert(cappedCoverageEnd(addDays(manifest.request.endDate, -1), manifest.request.endDate) === addDays(manifest.request.endDate, -1), 'short weather coverage must remain fail-closed')
assert(latestExpectedMarketSession('2026-07-18') === '2026-07-17', 'Saturday market coverage must use Friday')
assert(latestExpectedMarketSession('2026-07-19') === '2026-07-17', 'Sunday market coverage must use Friday')
assert(latestExpectedMarketSession('2026-07-04') === '2026-07-02', 'observed Independence Day must not require a market bar')
assert(latestExpectedMarketSession('2026-04-03') === '2026-04-02', 'Good Friday must not require a market bar')
assert(latestExpectedMarketSession('2026-11-26') === '2026-11-25', 'Thanksgiving must not require a market bar')
const appendedRows = appendMarketTail(lateInceptionRows, [
  { date: '2000-01-01', close: '1' },
  { date: manifest.request.endDate, close: '999' },
  { date: addDays(manifest.request.endDate, 1), close: '102' },
])
assert(appendedRows.length === lateInceptionRows.length + 1, 'market refresh must append only unseen tail rows')
assert(JSON.stringify(appendedRows.slice(0, -2)) === JSON.stringify(lateInceptionRows.slice(0, -1)), 'market refresh changed rows before the latest cached session')
assert(appendedRows.at(-2).close === '999', 'market refresh did not replace the latest cached session')
assert(appendedRows.at(-1).close === '102', 'market refresh did not append the unseen tail session')
const reconciledRows = reconcileAdjustedMarketTail([
  { date: '2026-07-15', close: 100, adjustedClose: 100 },
  { date: '2026-07-16', close: 110, adjustedClose: 110 },
], [
  { date: '2026-07-15', close: 100, adjustedClose: 50 },
  { date: '2026-07-16', close: 110, adjustedClose: 55 },
  { date: '2026-07-17', close: 120, adjustedClose: 60 },
])
assert(reconciledRows[0].adjustedClose === 100, 'adjusted refresh changed the finalized cache prefix')
assert(reconciledRows[1].adjustedClose === 110 && reconciledRows[2].adjustedClose === 120, 'adjusted refresh did not normalize the revised tail to the cached basis')
assert(closeEnough(reconciledRows[2].adjustedClose / reconciledRows[1].adjustedClose, 60 / 55), 'adjusted refresh corrupted the return across the cache boundary')
assert(yahooHistorySource('ZC=F') === 'Yahoo chart API continuous-futures proxy', 'Yahoo futures provenance lost its proxy disclosure')
assert(yahooHistorySource('VOO') === 'Yahoo chart API ETF history', 'Yahoo ETF provenance is mislabeled as a futures proxy')

const mutableTailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qore-crop-mutable-tail-'))
try {
  const mutableTailFile = path.join(mutableTailRoot, 'market.csv')
  const mutableTailRelativePath = path.relative(root, mutableTailFile)
  fs.writeFileSync(mutableTailFile, 'date,close\n2026-07-15,100\n2026-07-16,101\n2026-07-17,102\n')
  const snapshot = csvPrefixSnapshot(mutableTailFile, '2026-07-17', 1)
  assert(snapshot.through === '2026-07-16' && snapshot.observedThrough === '2026-07-17', 'market freeze did not separate the finalized prefix from the observed tail')
  fs.writeFileSync(mutableTailFile, 'date,close\n2026-07-15,100\n2026-07-16,101\n2026-07-17,999\n2026-07-20,103\n')
  const refreshedBytes = fs.readFileSync(mutableTailFile)
  assert(sha256(refreshedBytes.subarray(0, snapshot.bytes)) === snapshot.sha256, 'latest-session refresh changed the finalized prefix')
  verifyAppendOnlyPrefix(mutableTailRelativePath, snapshot, '2026-07-17')

  const expectSuffixRefusal = (rows, message) => {
    fs.writeFileSync(mutableTailFile, `date,close\n2026-07-15,100\n2026-07-16,101\n${rows}`)
    let refused = false
    try { verifyAppendOnlyPrefix(mutableTailRelativePath, snapshot, '2026-07-17') } catch { refused = true }
    assert(refused, message)
  }
  expectSuffixRefusal('2026-07-20,103\n', 'append-only verification accepted a missing mutable-tail anchor')
  expectSuffixRefusal('2026-07-17,102\n2026-07-17,103\n', 'append-only verification accepted duplicate suffix dates')
  expectSuffixRefusal('2026-07-20,103\n2026-07-17,102\n', 'append-only verification accepted descending suffix dates')
} finally {
  fs.rmSync(mutableTailRoot, { recursive: true, force: true })
}

const singleMarket = {
  dates: ['2026-07-16'],
  benchmarkReturns: Float64Array.from([0.01]),
  cropReturns: Float64Array.from([0.02]),
}
const singleMetrics = metrics(Int8Array.from([1]), singleMarket, 0, 1, 0.35, 0)
assert(closeEnough(singleMetrics.totalReturnPct, 1.7) && closeEnough(singleMetrics.benchmarkReturnPct, 1), 'single-session crop metrics discarded realized return')
assert(closeEnough(singleMetrics.relativeReturnPct, (1.017 / 1.01 - 1) * 100, 0.01), 'single-session crop metrics discarded relative return')
assert(singleMetrics.startDate === '2026-07-16' && singleMetrics.endDate === '2026-07-16', 'single-session crop metrics discarded the evaluation date')
const boundaryMarket = {
  dates: ['2026-07-15', '2026-07-16'],
  benchmarkReturns: Float64Array.from([0, 0]),
  cropReturns: Float64Array.from([0, 0]),
}
const boundaryMetrics = metrics(Int8Array.from([1, 1]), boundaryMarket, 1, 2, 1, 5, true)
assert(closeEnough(boundaryMetrics.totalReturnPct, -0.05), 'holdout crop metrics did not charge the boundary entry cost')
assert(boundaryMetrics.entries === 1 && boundaryMetrics.positionChanges === 1, 'holdout crop metrics inherited a pre-freeze position')
const boundaryBasketRows = parseCsv(path.join(dataRoot, 'market', 'yahoo', 'US-INDEX-BASKET-qore-market.csv'))
const portfolioPriorDate = boundaryBasketRows[0].date
const portfolioStartDate = boundaryBasketRows[1].date
const boundaryPortfolio = portfolioFromCrops([{
  market: { dates: [portfolioPriorDate, portfolioStartDate], cropReturns: Float64Array.from([0, 0]) },
  oosPositions: Float32Array.from([1, 1]),
}], portfolioStartDate, portfolioStartDate, { launchFromZero: true })
assert(boundaryPortfolio.dates.length === 1, 'portfolio boundary-cost fixture did not resolve a benchmark session')
assert(closeEnough(boundaryPortfolio.returns[0], boundaryPortfolio.benchmarkReturns[0] - 5 / 10000), 'holdout portfolio did not charge the boundary entry cost')
const singlePortfolioMetrics = directMetrics(Float64Array.from([0.017]), Float64Array.from([0.01]), ['2026-07-16'])
assert(closeEnough(singlePortfolioMetrics.totalReturnPct, 1.7) && closeEnough(singlePortfolioMetrics.benchmarkReturnPct, 1), 'single-session portfolio metrics discarded realized return')
assert(closeEnough(singlePortfolioMetrics.relativeReturnPct, (1.017 / 1.01 - 1) * 100, 0.01), 'single-session portfolio metrics discarded relative return')
assert(refreezeVersion(['--refreeze=2026-07-v2']) === '2026-07-v2', 'versioned refreeze flag was not parsed')
let missingRefreezeVersionRefused = false
try { refreezeVersion(['--refreeze']) } catch { missingRefreezeVersionRefused = true }
assert(missingRefreezeVersionRefused, 'refreeze accepted a missing version')
const freezeGuardRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qore-crop-freeze-guard-'))
try {
  fs.writeFileSync(path.join(freezeGuardRoot, 'frozen-model.json'), '{}\n')
  let refused = false
  try { freezeWritePlan(freezeGuardRoot, null) } catch (error) { refused = error.message.includes('refusing to overwrite') }
  assert(refused, 'optimizer did not refuse an implicit frozen-model overwrite')
  assert(freezeWritePlan(freezeGuardRoot, '2026-07-v2').versionFile.endsWith('freeze-versions/2026-07-v2.json'), 'refreeze does not use a versioned artifact')
} finally {
  fs.rmSync(freezeGuardRoot, { recursive: true, force: true })
}

const payload = { ...frozen }
delete payload.generatedAt
delete payload.freezeDigest
assert(sha256(JSON.stringify(payload)) === frozen.freezeDigest, 'frozen model digest is invalid')
assert(frozen.freezeDigest === summary.freezeDigest, 'freeze digest mismatch across artifacts')
assert(repositoryEvaluation.freezeDigest === frozen.freezeDigest, 'checked-in future holdout evaluation uses a different freeze')
assert(frozen.futureHoldoutStart === summary.futureHoldoutStart, 'future holdout mismatch')
assert(sha256(JSON.stringify(frozen.inputHashes.files)) === frozen.inputHashes.combined, 'combined frozen input hash is invalid')
assert(frozen.collectionContract.endDate === frozen.frozenThrough, 'frozen collection contract does not match the training boundary')
for (const [key, value] of Object.entries(frozen.collectionContract)) {
  if (key !== 'endDate') assert(JSON.stringify(manifest.contract[key]) === JSON.stringify(value), `collection contract field ${key} changed`)
}
assert(manifest.contract.endDate >= frozen.frozenThrough, 'active collection predates the freeze')
for (const relativePath of ['config/crop-weather-soy-corn.json', 'data/qore/market/index-basket-config.json']) {
  assert(sha256(fs.readFileSync(path.join(root, relativePath))) === frozen.inputHashes.files[relativePath], `immutable frozen input hash mismatch for ${relativePath}`)
}
const frozenCsvPaths = Object.keys(frozen.inputHashes.files).filter((relativePath) => relativePath.endsWith('.csv'))
assert(frozenCsvPaths.length === Object.keys(frozen.inputHashes.appendOnlyPrefixes).length, 'append-only prefix ledger has an unexpected size')
assert(frozenCsvPaths.every((relativePath) => {
  const snapshot = frozen.inputHashes.appendOnlyPrefixes[relativePath]
  const isMarket = relativePath.includes('/market/yahoo/')
  return snapshot?.mutableTailRows === (isMarket ? 1 : 0)
    && snapshot.through <= snapshot.observedThrough
    && snapshot.observedThrough <= frozen.dataAvailableThrough
    && (isMarket ? snapshot.through < snapshot.observedThrough : snapshot.through === snapshot.observedThrough)
}), 'append-only prefix ledger does not isolate the mutable market tail')
const latestFrozenInputDate = frozenCsvPaths.reduce((latest, relativePath) => {
  const rows = parseCsv(path.join(root, relativePath)).filter((row) => row.date <= frozen.dataAvailableThrough)
  const fileEnd = String(rows.at(-1)?.date ?? '')
  assert(frozen.inputHashes.appendOnlyPrefixes[relativePath].observedThrough === fileEnd, `frozen observed-data boundary is stale for ${relativePath}`)
  return fileEnd > latest ? fileEnd : latest
}, frozen.frozenThrough)
assert(frozen.dataAvailableThrough === latestFrozenInputDate, 'frozen available-data boundary omits a pre-existing input suffix')
assert(sha256(fs.readFileSync(path.join(root, 'scripts', 'optimize-crop-precipitation-hf.mjs'), 'utf8')) === frozen.inputHashes.optimizer, 'optimizer source hash is stale')
assert(sha256(fs.readFileSync(path.join(root, 'scripts', 'evaluate-crop-precipitation-hf.mjs'), 'utf8')) === frozen.inputHashes.evaluator, 'evaluator source hash is stale')
assert(sha256(fs.readFileSync(path.join(root, 'scripts', 'collect-crop-precipitation-data.mjs'), 'utf8')) === frozen.inputHashes.collector, 'collector source hash is stale')
assert(frozen.selectedCrops.length === 2, 'frozen model must retain soybeans and corn only')
for (const crop of frozen.selectedCrops) {
  assert(crop.finalTrainingEnd === manifest.contract.endDate, `${crop.cropId} final model did not train through the freeze date`)
  assert(crop.ensemble.length >= 0 && crop.ensemble.length <= 3, `${crop.cropId} ensemble must fail closed or contain at most three rules`)
  assert(new Set(crop.ensemble.map((item) => item.directionHash)).size === crop.ensemble.length, `${crop.cropId} ensemble contains duplicate position directions`)
  assert(crop.ensemble.every((item) => allowedFamilies.has(item.candidate.family)), `${crop.cropId} froze a retired rule family`)
  assert(crop.ensemble.every((item) => item.stressedCostMetrics.relativeReturnPct > 0), `${crop.cropId} froze a rule that fails 20 bps cost stress`)
}

const exactWeights = Object.fromEntries(basketConfig.components.map((component) => [component.symbol, Number(component.targetWeight)]))
const proxyWeights = Object.fromEntries(config.researchProxyBasket.components.map((component) => [component.symbol, Number(component.targetWeight)]))
assert(closeEnough(exactWeights.VOO, 0.8) && closeEnough(exactWeights.QQQM, 0.2), 'exact fallback must remain 80% VOO / 20% QQQM')
assert(closeEnough(proxyWeights.SPY, 0.8) && closeEnough(proxyWeights.QQQ, 0.2), 'pre-inception proxy must be 80% SPY / 20% QQQ')

const marketDir = path.join(dataRoot, 'market', 'yahoo')
const cornDates = new Set(parseCsv(path.join(marketDir, 'ZC-F-daily.csv')).map((row) => row.date))
const soybeanDates = new Set(parseCsv(path.join(marketDir, 'ZS-F-daily.csv')).map((row) => row.date))
assert(cornDates.has('2018-12-14') && cornDates.has('2018-12-19') && !cornDates.has('2018-12-17') && !cornDates.has('2018-12-18'), 'corn missing-session regression fixture changed')
assert(['2018-12-14', '2018-12-17', '2018-12-18', '2018-12-19'].every((date) => soybeanDates.has(date)), 'soybean daily-session regression fixture changed')
assert(summary.crops.every((crop) => closeEnough(crop.core.benchmarkReturnPct, summary.portfolio.core.benchmarkReturnPct, 0.01)), 'portfolio discarded benchmark sessions when crop calendars diverged')
assert(closeEnough(summary.portfolio.core.benchmarkReturnPct, 837.33, 0.01), 'canonical daily portfolio benchmark changed unexpectedly')
const voo = new Map(parseCsv(path.join(marketDir, 'VOO-daily.csv')).map((row) => [row.date, Number(row.adjustedClose)]))
const qqqm = new Map(parseCsv(path.join(marketDir, 'QQQM-daily.csv')).map((row) => [row.date, Number(row.adjustedClose)]))
const exactBasket = parseCsv(path.join(marketDir, 'US-INDEX-BASKET-qore-market.csv'))
for (let index = 1; index < exactBasket.length; index += 1) {
  const date = exactBasket[index].date
  const prior = exactBasket[index - 1].date
  const expected = 0.8 * (voo.get(date) / voo.get(prior) - 1) + 0.2 * (qqqm.get(date) / qqqm.get(prior) - 1)
  const actual = Number(exactBasket[index].close) / Number(exactBasket[index - 1].close) - 1
  assert(closeEnough(actual, expected), `exact fallback reconstruction mismatch on ${date}`)
}

for (const crop of config.crops) {
  for (const site of crop.sites) {
    const rows = parseCsv(path.join(dataRoot, 'weather', 'crop-precipitation-hf', 'actuals', `${site.id}.csv`))
    assert(rows.length > 16000, `${site.id} weather history is too short`)
    assert(['precipitationMm', 'temperatureC', 'maxTemperatureC'].every((field) => Number.isFinite(Number(rows[0][field]))), `${site.id} is missing a weather variable`)
  }
}

const folds = parseCsv(path.join(outputRoot, 'walk-forward-folds.csv'))
assert(folds.length === 34, 'expected 17 yearly folds for soybeans and corn')
for (const fold of folds) {
  assert(Number(fold.trainEndYear) === Number(fold.testYear) - 1, `${fold.cropId}/${fold.testYear} sees its test year during selection`)
  assert(Number(fold.trainStartYear) <= Number(fold.trainEndYear) - 5, `${fold.cropId}/${fold.testYear} has insufficient prior training history`)
  const selectedIds = String(fold.selectedCandidates ?? '').split('|').filter(Boolean)
  const selectedHashes = String(fold.selectedDirectionHashes ?? '').split('|').filter(Boolean)
  assert(selectedIds.length <= 3, `${fold.cropId}/${fold.testYear} selected too many rules`)
  assert(new Set(selectedHashes).size === selectedHashes.length && selectedHashes.length === selectedIds.length, `${fold.cropId}/${fold.testYear} contains duplicate semantic rules`)
  if (!selectedIds.length) {
    assert(closeEnough(fold.totalReturnPct, fold.benchmarkReturnPct, 0.01), `${fold.cropId}/${fold.testYear} fail-closed fold did not equal the basket`)
    assert(closeEnough(fold.relativeReturnPct, 0, 0.01), `${fold.cropId}/${fold.testYear} fail-closed relative return is nonzero`)
  }
}

const cropRows = parseCsv(path.join(outputRoot, 'crop-summary.csv'))
assert(cropRows.length === 2, 'crop summary must contain only soybeans and corn')
const report = fs.readFileSync(path.join(outputRoot, 'report.html'), 'utf8')
assert(report.includes('No new untouched holdout result exists yet'), 'report must disclose that the future holdout is unopened')
assert(report.includes('80% VOO / 20% QQQM'), 'report must preserve the exact fallback description')
assert(report.includes('Hot and dry') && report.includes('Cool and wet') && report.includes('Warm and wet') && report.includes('Drought'), 'report does not emulate every photo regime')
assert(report.includes('basket remains fully invested') && report.includes('trailing five inner-validation years'), 'report does not explain the additive nested redesign')
assert(!report.includes('Only soybeans, coffee, cotton, and sugar remain active'), 'retired crop strategy language remains in the report')
assert(report.includes(frozen.freezeDigest), 'report must display the freeze digest')

const frozenBytesBeforeEvaluation = fs.readFileSync(path.join(outputRoot, 'frozen-model.json'))
const evaluationFile = path.join(outputRoot, 'future-holdout-evaluation.json')
const evaluationBytesBefore = fs.readFileSync(evaluationFile)
const evaluationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qore-crop-evaluation-'))
try {
  for (const [source, expectedMessage] of [
    ['evaluator', 'Evaluator semantics differ from the frozen source'],
    ['collector', 'Collector semantics differ from the frozen source'],
  ]) {
    const invalidFrozen = structuredClone(frozen)
    invalidFrozen.inputHashes[source] = '0'.repeat(64)
    const invalidPayload = { ...invalidFrozen }
    delete invalidPayload.generatedAt
    delete invalidPayload.freezeDigest
    invalidFrozen.freezeDigest = sha256(JSON.stringify(invalidPayload))
    const invalidFrozenFile = path.join(evaluationRoot, `invalid-${source}-frozen-model.json`)
    fs.writeFileSync(invalidFrozenFile, `${JSON.stringify(invalidFrozen, null, 2)}\n`)
    const refusedRun = spawnSync(process.execPath, [path.join(root, 'scripts', 'evaluate-crop-precipitation-hf.mjs')], {
      cwd: root,
      env: { ...process.env, QORE_OUTPUT_ROOT: evaluationRoot, QORE_FROZEN_MODEL: invalidFrozenFile },
      encoding: 'utf8',
    })
    assert(refusedRun.status !== 0 && refusedRun.stderr.includes(expectedMessage), `frozen evaluator accepted a stale ${source} source hash`)
  }

  const evaluationRun = spawnSync(process.execPath, [path.join(root, 'scripts', 'evaluate-crop-precipitation-hf.mjs')], {
    cwd: root,
    env: { ...process.env, QORE_OUTPUT_ROOT: evaluationRoot, QORE_FROZEN_MODEL: path.join(outputRoot, 'frozen-model.json') },
    encoding: 'utf8',
  })
  assert(evaluationRun.status === 0, `frozen evaluator failed: ${evaluationRun.stderr || evaluationRun.stdout}`)
  const frozenBytesAfterEvaluation = fs.readFileSync(path.join(outputRoot, 'frozen-model.json'))
  assert(frozenBytesBeforeEvaluation.equals(frozenBytesAfterEvaluation), 'walk-forward evaluation rewrote frozen-model.json')
  assert(evaluationBytesBefore.equals(fs.readFileSync(evaluationFile)), 'walk-forward verification mutated the repository evaluation artifact')
  const evaluation = JSON.parse(fs.readFileSync(path.join(evaluationRoot, 'future-holdout-evaluation.json'), 'utf8'))
  assert(evaluation.freezeDigest === frozen.freezeDigest, 'walk-forward evaluation used a different freeze')
  assert(evaluation.dataAvailableThrough === frozen.dataAvailableThrough && evaluation.futureHoldoutStart === addDays(evaluation.dataAvailableThrough, 1), 'walk-forward evaluation lost the frozen available-data boundary')
  assert(evaluation.selectionPerformed === false && evaluation.frozenModelWritten === false, 'walk-forward evaluation performed model selection or freeze writes')
  assert(evaluation.crops.every((crop) => crop.frozenCandidates.join('|') === frozen.selectedCrops.find((item) => item.cropId === crop.cropId).ensemble.map((item) => item.candidate.id).join('|')), 'walk-forward evaluation did not use the frozen candidate ensemble')
} finally {
  fs.rmSync(evaluationRoot, { recursive: true, force: true })
}

console.log(`photo-regime crop checks passed: soybeans and corn, ${manifest.counts.sites} crop-location series, ${manifest.counts.weatherRows} weather rows, ${folds.length} yearly walk-forward folds`)
