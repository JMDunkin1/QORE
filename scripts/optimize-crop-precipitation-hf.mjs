#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'

const ROOT = process.cwd()
const DATA_ROOT = process.env.QORE_DATA_ROOT ?? path.join(ROOT, 'data', 'qore')
const CONFIG_FILE = process.env.QORE_CROP_PRECIP_CONFIG ?? path.join(ROOT, 'config', 'crop-weather-soy-corn.json')
const WEATHER_ROOT = path.join(DATA_ROOT, 'weather', 'crop-precipitation-hf')
const ACTUALS_DIR = path.join(WEATHER_ROOT, 'actuals')
const MANIFEST_FILE = path.join(WEATHER_ROOT, 'collection-manifest.json')
const COLLECTION_END = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')).contract.endDate
const MARKET_DIR = path.join(DATA_ROOT, 'market', 'yahoo')
const EXACT_BASKET_FILE = path.join(MARKET_DIR, 'US-INDEX-BASKET-qore-market.csv')
const PROXY_BASKET_FILE = path.join(MARKET_DIR, 'US-INDEX-BASKET-PROXY-qore-market.csv')
const INDEX_CONFIG_FILE = path.join(DATA_ROOT, 'market', 'index-basket-config.json')
const OUTPUT_ROOT = process.env.QORE_OUTPUT_ROOT ?? path.join(DATA_ROOT, 'research', 'strategy-agent-runs', 'crop-precipitation-hf')
const FREEZE_VERSIONS_DIR = path.join(OUTPUT_ROOT, 'freeze-versions')
const OPTIMIZER_FILE = fileURLToPath(import.meta.url)
const EVALUATOR_FILE = fileURLToPath(new URL('./evaluate-crop-precipitation-hf.mjs', import.meta.url))
const COLLECTOR_FILE = fileURLToPath(new URL('./collect-crop-precipitation-data.mjs', import.meta.url))

const WEATHER_BASELINE_START = '1981-01-01'
const WEATHER_BASELINE_END = '1999-12-31'
const MARKET_START = '2000-01-01'
const OOS_START_YEAR = 2010
const SIGNAL_LAG_DAYS = 2
const COST_BPS = 5
const TRADING_DAYS = 252
const LOOKBACKS = [3, 5, 7, 14, 21, 30]
const PRECIP_THRESHOLDS = [0.25, 0.5, 0.75, 1]
const TEMPERATURE_THRESHOLDS = [0.25, 0.5, 0.75]
const CARRY_SESSIONS = [0, 1, 3, 5]
const OVERLAY_NOTIONAL = 0.35
const PRICE_CONFIRMATION_DAYS = { soybeans: 0, corn: 0 }
const REGIONS = ['global', 'us', 'brazil', 'argentina']
const MIN_AFFECTED_PRODUCTION = 0.18
const FAMILIES = [
  { id: 'hot-dry-long', label: 'Hot and dry makes prices rise' },
  { id: 'drought-long', label: 'Drought makes prices rise' },
  { id: 'cool-wet-short', label: 'Cool and wet makes prices fall' },
  { id: 'warm-wet-short', label: 'Warm and wet makes prices fall' },
]

function read(file) { return fs.readFileSync(file, 'utf8') }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value) }
function writeExclusive(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, { flag: 'wx' }) }
function parseCsv(file) {
  const parsed = Papa.parse(read(file), { header: true, skipEmptyLines: true, dynamicTyping: true })
  if (parsed.errors.length) throw new Error(`CSV parse failed for ${file}: ${parsed.errors[0].message}`)
  return parsed.data
}
function safeSymbol(symbol) { return symbol.replace(/[^A-Za-z0-9]/g, '-') }
function round(value, digits = 3) { if (!Number.isFinite(value)) return 0; const scale = 10 ** digits; return Math.round(value * scale) / scale }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function median(values) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 }
function mad(values) { const center = median(values); return median(values.map((value) => Math.abs(value - center))) }
function std(values) { if (values.length < 2) return 0; const avg = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)) }
function covariance(left, right) { if (left.length < 2 || left.length !== right.length) return 0; const a = mean(left); const b = mean(right); return left.reduce((sum, value, index) => sum + (value - a) * (right[index] - b), 0) / (left.length - 1) }
function addDays(dateText, days) { const date = new Date(`${dateText}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
function daysBetween(start, end) { return (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000 }
function dayOfYear(dateText) { const date = new Date(`${dateText}T00:00:00Z`); return Math.floor((date - new Date(Date.UTC(date.getUTCFullYear(), 0, 1))) / 86400000) + 1 }
function wrappedDoy(value) { let result = value; while (result < 1) result += 366; while (result > 366) result -= 366; return result }
function dateInWindow(dateText, window) { const md = dateText.slice(5); return window.start <= window.end ? md >= window.start && md <= window.end : md >= window.start || md <= window.end }
function activeWindow(site, dateText) { return site.windows.find((window) => dateInWindow(dateText, window)) ?? null }
function siteRegion(site) {
  if (site.latitude > 20) return 'us'
  if (site.latitude < -25 && site.longitude < -58) return 'argentina'
  return 'brazil'
}
function criticalWindow(cropId, region) {
  if (cropId === 'corn' && region === 'us') return { start: '06-15', end: '08-31' }
  if (cropId === 'corn' && region === 'brazil') return { start: '04-01', end: '06-30' }
  if (cropId === 'corn' && region === 'argentina') return { start: '12-01', end: '03-15' }
  if (cropId === 'soybeans' && region === 'us') return { start: '07-01', end: '09-15' }
  if (cropId === 'soybeans' && region === 'brazil') return { start: '11-15', end: '02-28' }
  if (cropId === 'soybeans' && region === 'argentina') return { start: '12-15', end: '03-31' }
  return null
}
function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function sha256File(file) { return sha256(read(file)) }
export function csvPrefixSnapshot(file, availableThrough, mutableTailRows = 0) {
  if (!Number.isInteger(mutableTailRows) || mutableTailRows < 0) throw new Error(`Invalid mutable CSV tail size for ${file}`)
  const bytes = fs.readFileSync(file)
  const headerEnd = bytes.indexOf(10) + 1
  if (headerEnd <= 0) throw new Error(`CSV has no header row: ${file}`)
  let cursor = headerEnd
  let priorDate = ''
  const eligibleRows = []
  while (cursor < bytes.length) {
    const newline = bytes.indexOf(10, cursor)
    const rowEnd = newline === -1 ? bytes.length : newline + 1
    const row = bytes.subarray(cursor, newline === -1 ? bytes.length : newline).toString('utf8').replace(/\r$/, '')
    if (row) {
      const date = row.slice(0, row.indexOf(','))
      if (priorDate && date < priorDate) throw new Error(`CSV is not date-sorted: ${file}`)
      priorDate = date
      if (date > availableThrough) break
      eligibleRows.push({ date, rowEnd })
    }
    cursor = rowEnd
  }
  if (eligibleRows.length <= mutableTailRows) throw new Error(`CSV has no finalized rows at or before ${availableThrough}: ${file}`)
  const observedThrough = eligibleRows.at(-1).date
  const finalized = eligibleRows.at(-(mutableTailRows + 1))
  return {
    through: finalized.date,
    observedThrough,
    mutableTailRows,
    bytes: finalized.rowEnd,
    sha256: sha256(bytes.subarray(0, finalized.rowEnd)),
  }
}
function csvLatestDate(file) {
  const rows = parseCsv(file)
  const latest = String(rows.at(-1)?.date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) throw new Error(`CSV has no valid final date: ${file}`)
  return latest
}
function csvEscape(value) { const text = Array.isArray(value) ? value.join('|') : String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }
function rowsToCsv(rows, headers) { return `${[headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')}\n` }
function html(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }

export function refreezeVersion(argv) {
  const assignment = argv.find((argument) => argument.startsWith('--refreeze='))
  const flagIndex = argv.indexOf('--refreeze')
  if (!assignment && flagIndex < 0) return null
  const version = assignment ? assignment.slice('--refreeze='.length) : flagIndex >= 0 ? argv[flagIndex + 1] : null
  if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version) || version.includes('..')) {
    throw new Error('Refreeze requires a version such as --refreeze=2026-07-v2; versions may contain letters, numbers, dots, underscores, and hyphens.')
  }
  return version
}

export function freezeWritePlan(outputRoot, version) {
  const canonicalFile = path.join(outputRoot, 'frozen-model.json')
  if (fs.existsSync(canonicalFile) && !version) {
    throw new Error('frozen-model.json already exists; refusing to overwrite the untouched holdout. Use --refreeze=<version> for an explicit, archived refreeze.')
  }
  const versionFile = version ? path.join(outputRoot, 'freeze-versions', `${version}.json`) : null
  if (versionFile && fs.existsSync(versionFile)) throw new Error(`Freeze version ${version} already exists; choose a new version.`)
  return { canonicalFile, versionFile, version }
}

function writeFreeze(plan, frozenText) {
  if (plan.versionFile) {
    if (fs.existsSync(plan.canonicalFile)) {
      const priorText = read(plan.canonicalFile)
      const prior = JSON.parse(priorText)
      const archiveFile = path.join(FREEZE_VERSIONS_DIR, `archive-${prior.freezeDigest}.json`)
      if (!fs.existsSync(archiveFile)) writeExclusive(archiveFile, priorText)
    }
    writeExclusive(plan.versionFile, frozenText)
  }
  write(plan.canonicalFile, frozenText)
}

function basketCloses(file) {
  return new Map(parseCsv(file).map((row) => [row.date, Number(row.close)]).filter(([, close]) => Number.isFinite(close) && close > 0))
}

export function marketData(crop) {
  const cropRows = parseCsv(path.join(MARKET_DIR, `${safeSymbol(crop.symbol)}-daily.csv`))
    .map((row) => ({ date: row.date, close: Number(row.adjustedClose ?? row.close) }))
    .filter((row) => row.date >= MARKET_START && row.date <= COLLECTION_END && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  const exact = basketCloses(EXACT_BASKET_FILE)
  const proxy = basketCloses(PROXY_BASKET_FILE)
  const joined = cropRows.filter((row) => exact.has(row.date) || proxy.has(row.date))
  const dates = []
  const signalDates = []
  const cropReturns = []
  const benchmarkReturns = []
  const benchmarkSources = []
  for (let index = 0; index < joined.length - 1; index += 1) {
    const current = joined[index]
    const next = joined[index + 1]
    let benchmarkReturn
    let benchmarkSource
    if (exact.has(current.date) && exact.has(next.date)) {
      benchmarkReturn = exact.get(next.date) / exact.get(current.date) - 1
      benchmarkSource = 'exact-80-VOO-20-QQQM'
    } else if (proxy.has(current.date) && proxy.has(next.date)) {
      benchmarkReturn = proxy.get(next.date) / proxy.get(current.date) - 1
      benchmarkSource = 'proxy-80-SPY-20-QQQ'
    } else continue
    dates.push(next.date)
    signalDates.push(current.date)
    cropReturns.push(next.close / current.close - 1)
    benchmarkReturns.push(benchmarkReturn)
    benchmarkSources.push(benchmarkSource)
  }
  if (dates.length < 2500) throw new Error(`${crop.id} has insufficient market history.`)
  const confirmationDays = PRICE_CONFIRMATION_DAYS[crop.id] ?? 0
  const confirmationMomentum = new Float64Array(cropReturns.length)
  for (let index = 0; index < cropReturns.length; index += 1) {
    let wealth = 1
    for (let cursor = Math.max(0, index - confirmationDays); cursor < index; cursor += 1) wealth *= 1 + cropReturns[cursor]
    confirmationMomentum[index] = wealth - 1
  }
  return {
    dates,
    signalDates,
    cropReturns: Float64Array.from(cropReturns),
    confirmationDays,
    confirmationMomentum,
    benchmarkReturns: Float64Array.from(benchmarkReturns),
    benchmarkSources,
  }
}

function siteFeatureMaps(site) {
  const rows = parseCsv(path.join(ACTUALS_DIR, `${site.id}.csv`))
    .map((row) => ({
      date: row.date,
      precipitationMm: Number(row.precipitationMm),
      temperatureC: Number(row.temperatureC),
      maxTemperatureC: Number(row.maxTemperatureC),
    }))
    .filter((row) => Number.isFinite(row.precipitationMm) && Number.isFinite(row.temperatureC) && Number.isFinite(row.maxTemperatureC))
    .sort((a, b) => a.date.localeCompare(b.date))
  const output = new Map()
  for (const lookback of LOOKBACKS) {
    let precipRunning = 0
    let temperatureRunning = 0
    let maxTemperatureRunning = 0
    const precipTotals = new Array(rows.length).fill(null)
    const temperatureMeans = new Array(rows.length).fill(null)
    const maxTemperatureMeans = new Array(rows.length).fill(null)
    for (let index = 0; index < rows.length; index += 1) {
      precipRunning += rows[index].precipitationMm
      temperatureRunning += rows[index].temperatureC
      maxTemperatureRunning += rows[index].maxTemperatureC
      if (index >= lookback) {
        precipRunning -= rows[index - lookback].precipitationMm
        temperatureRunning -= rows[index - lookback].temperatureC
        maxTemperatureRunning -= rows[index - lookback].maxTemperatureC
      }
      if (index >= lookback - 1) {
        precipTotals[index] = precipRunning
        temperatureMeans[index] = temperatureRunning / lookback
        maxTemperatureMeans[index] = maxTemperatureRunning / lookback
      }
    }
    function seasonalNormals(values) {
      const samplesByDoy = Array.from({ length: 367 }, () => [])
      for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].date < WEATHER_BASELINE_START || rows[index].date > WEATHER_BASELINE_END || values[index] === null) continue
        const doy = dayOfYear(rows[index].date)
        for (let offset = -15; offset <= 15; offset += 1) samplesByDoy[wrappedDoy(doy + offset)].push(values[index])
      }
      return samplesByDoy.map((samples) => ({ mean: mean(samples), std: std(samples) }))
    }
    const precipNormals = seasonalNormals(precipTotals)
    const temperatureNormals = seasonalNormals(temperatureMeans)
    const maxTemperatureNormals = seasonalNormals(maxTemperatureMeans)
    const byDate = new Map()
    for (let index = 0; index < rows.length; index += 1) {
      if (precipTotals[index] === null) continue
      const doy = dayOfYear(rows[index].date)
      const precipZ = precipNormals[doy].std > 0 ? (precipTotals[index] - precipNormals[doy].mean) / precipNormals[doy].std : 0
      const temperatureZ = temperatureNormals[doy].std > 0 ? (temperatureMeans[index] - temperatureNormals[doy].mean) / temperatureNormals[doy].std : 0
      const maxTemperatureZ = maxTemperatureNormals[doy].std > 0 ? (maxTemperatureMeans[index] - maxTemperatureNormals[doy].mean) / maxTemperatureNormals[doy].std : 0
      byDate.set(rows[index].date, {
        precipZ: Math.max(-4, Math.min(4, precipZ)),
        temperatureZ: Math.max(-4, Math.min(4, temperatureZ)),
        maxTemperatureZ: Math.max(-4, Math.min(4, maxTemperatureZ)),
      })
    }
    output.set(lookback, byDate)
  }
  return output
}

export function cropFeatures(crop, market) {
  const sites = new Map(crop.sites.map((site) => [site.id, siteFeatureMaps(site)]))
  const output = new Map()
  for (const lookback of LOOKBACKS) {
    const byDate = new Map()
    for (const signalDate of market.signalDates) {
      const observedThrough = addDays(signalDate, -SIGNAL_LAG_DAYS)
      const siteRows = []
      for (const site of crop.sites) {
        const feature = sites.get(site.id)?.get(lookback)?.get(observedThrough)
        const region = siteRegion(site)
        const stageWindow = criticalWindow(crop.id, region)
        if (!activeWindow(site, observedThrough) || !stageWindow || !dateInWindow(observedThrough, stageWindow) || !feature) continue
        siteRows.push({
          siteId: site.id,
          region,
          weight: Number(site.weight),
          precipitationZ: feature.precipZ,
          temperatureZ: feature.temperatureZ,
          maxTemperatureZ: feature.maxTemperatureZ,
        })
      }
      if (siteRows.length) byDate.set(signalDate, { observedThrough, siteRows })
    }
    output.set(lookback, market.signalDates.map((date) => byDate.get(date) ?? null))
  }
  return output
}

function candidateGrid() {
  const rows = []
  for (const family of FAMILIES) for (const lookback of LOOKBACKS) for (const precipitationThreshold of PRECIP_THRESHOLDS) for (const carry of CARRY_SESSIONS) for (const region of REGIONS) {
    const temperatureValues = family.id === 'drought-long' ? [null] : TEMPERATURE_THRESHOLDS
    for (const temperatureThreshold of temperatureValues) rows.push({
      id: `${family.id}-r${region}-lb${lookback}-p${String(precipitationThreshold).replace('.', '_')}${temperatureThreshold === null ? '' : `-t${String(temperatureThreshold).replace('.', '_')}`}-c${carry}`,
      family: family.id,
      familyLabel: family.label,
      region,
      lookback,
      precipitationThreshold,
      temperatureThreshold,
      carry,
    })
  }
  return rows
}

function desiredDirection(feature, candidate) {
  if (!feature) return 0
  const p = candidate.precipitationThreshold
  const t = candidate.temperatureThreshold ?? 0
  const rows = feature.siteRows.filter((row) => candidate.region === 'global' || row.region === candidate.region)
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0)
  if (totalWeight <= 0) return 0
  const affectedWeight = rows.reduce((sum, row) => {
    const hotDry = row.precipitationZ <= -p && row.maxTemperatureZ >= t
    const drought = row.precipitationZ <= -(p * 1.5)
    const coolWet = row.precipitationZ >= p && row.temperatureZ <= -t
    const warmWet = row.precipitationZ >= p && row.temperatureZ >= t
    const matched = candidate.family === 'hot-dry-long' ? hotDry
      : candidate.family === 'drought-long' ? drought
        : candidate.family === 'cool-wet-short' ? coolWet
          : candidate.family === 'warm-wet-short' ? warmWet
            : false
    return sum + (matched ? row.weight : 0)
  }, 0)
  if (affectedWeight / totalWeight < MIN_AFFECTED_PRODUCTION) return 0
  if (candidate.family === 'hot-dry-long' || candidate.family === 'drought-long') return 1
  if (candidate.family === 'cool-wet-short' || candidate.family === 'warm-wet-short') return -1
  return 0
}

export function simulatePositions(candidate, features, market) {
  const rowCount = market.dates.length
  const positions = new Int8Array(rowCount)
  let position = 0
  let carry = 0
  for (let index = 0; index < rowCount; index += 1) {
    let desired = desiredDirection(features.get(candidate.lookback)[index], candidate)
    if (desired !== 0 && market.confirmationDays > 0 && Math.sign(market.confirmationMomentum[index]) !== desired) desired = 0
    if (desired !== 0) {
      position = desired
      carry = candidate.carry
    } else if (carry > 0) {
      carry -= 1
    } else {
      position = 0
    }
    positions[index] = position
  }
  return positions
}

export function rangeForDates(market, startDate, endDate) {
  let start = market.dates.findIndex((date) => date >= startDate)
  if (start < 0) start = market.dates.length
  let end = market.dates.findIndex((date) => date > endDate)
  if (end < 0) end = market.dates.length
  return [start, end]
}

export function metrics(positions, market, start = 0, end = market.dates.length, allocation = 1, costBps = COST_BPS, launchFromZero = false) {
  if (end <= start) return { totalReturnPct: 0, benchmarkReturnPct: 0, edgePct: 0, relativeReturnPct: 0, excessInformationRatio: 0, cagrPct: 0, regressionAlphaPct: 0, sharpe: 0, maxDrawdownPct: 0, entries: 0, positionChanges: 0, annualEntries: 0, exposurePct: 0, turnover: 0, startDate: null, endDate: null }
  const strategyReturns = []
  const benchmarkReturns = []
  const excessReturns = []
  let equity = 1
  let benchmarkEquity = 1
  let relativeEquity = 1
  let peak = 1
  let drawdown = 0
  let entries = 0
  let positionChanges = 0
  let turnover = 0
  let exposure = 0
  for (let index = start; index < end; index += 1) {
    const position = Number(positions[index] ?? 0) * allocation
    const prior = Number(index > 0 && !(launchFromZero && index === start) ? positions[index - 1] : 0) * allocation
    const change = Math.abs(position - prior)
    if (change > 1e-8) positionChanges += 1
    if (Math.abs(position) > 1e-8 && (Math.abs(prior) <= 1e-8 || Math.sign(position) !== Math.sign(prior))) entries += 1
    const benchmarkReturn = market.benchmarkReturns[index]
    // The index basket is the collateral/fallback book. Crop futures are an
    // additive notional overlay, so an active weather signal does not sell the
    // long-run basket merely to fund futures margin.
    const gross = benchmarkReturn + position * market.cropReturns[index]
    const strategyReturn = gross - change * costBps / 10000
    strategyReturns.push(strategyReturn)
    benchmarkReturns.push(benchmarkReturn)
    excessReturns.push(strategyReturn - benchmarkReturn)
    equity *= 1 + strategyReturn
    benchmarkEquity *= 1 + benchmarkReturn
    relativeEquity *= (1 + strategyReturn) / (1 + benchmarkReturn)
    peak = Math.max(peak, equity)
    drawdown = Math.min(drawdown, equity / peak - 1)
    turnover += change
    exposure += Math.abs(position)
  }
  const years = Math.max(daysBetween(market.dates[start], market.dates[end - 1]) / 365.25, 1 / 365.25)
  const vol = std(strategyReturns) * Math.sqrt(TRADING_DAYS)
  const excessVol = std(excessReturns) * Math.sqrt(TRADING_DAYS)
  const benchmarkVariance = std(benchmarkReturns) ** 2
  const beta = benchmarkVariance ? covariance(strategyReturns, benchmarkReturns) / benchmarkVariance : 0
  const alpha = mean(strategyReturns.map((value, index) => value - beta * benchmarkReturns[index])) * TRADING_DAYS
  return {
    totalReturnPct: round((equity - 1) * 100, 2),
    benchmarkReturnPct: round((benchmarkEquity - 1) * 100, 2),
    edgePct: round((equity - benchmarkEquity) * 100, 2),
    relativeReturnPct: round((relativeEquity - 1) * 100, 2),
    excessInformationRatio: round(excessVol ? mean(excessReturns) * TRADING_DAYS / excessVol : 0, 2),
    cagrPct: round((equity ** (1 / years) - 1) * 100, 2),
    regressionAlphaPct: round(alpha * 100, 2),
    sharpe: round(vol ? mean(strategyReturns) * TRADING_DAYS / vol : 0, 2),
    maxDrawdownPct: round(drawdown * 100, 2),
    entries,
    positionChanges,
    annualEntries: round(entries / years, 1),
    exposurePct: round(exposure / (end - start) * 100, 1),
    turnover: round(turnover, 2),
    startDate: market.dates[start],
    endDate: market.dates[end - 1],
  }
}

function optimizerScores(item, market, trainStartYear, trainEndYear) {
  // The rule parameters are fixed; only the trailing five years of the outer
  // training window are used as inner validation. Earlier years are kept out
  // of ranking so the selector does not merely maximize a full-window fit.
  const validationStartYear = Math.max(trainStartYear + 5, trainEndYear - 4)
  const [start, end] = rangeForDates(market, `${validationStartYear}-01-01`, `${trainEndYear}-12-31`)
  const aggregate = metrics(item.positions, market, start, end, OVERLAY_NOTIONAL)
  const stressed = metrics(item.positions, market, start, end, OVERLAY_NOTIONAL, 20)
  const annual = []
  for (let year = validationStartYear; year <= trainEndYear; year += 1) {
    const [yearStart, yearEnd] = rangeForDates(market, `${year}-01-01`, `${year}-12-31`)
    if (yearEnd - yearStart > 100) annual.push(metrics(item.positions, market, yearStart, yearEnd, OVERLAY_NOTIONAL))
  }
  const relativeReturns = annual.map((row) => row.relativeReturnPct)
  const positiveYears = relativeReturns.filter((value) => value > 0).length
  const eligible = annual.length >= 5
    && aggregate.annualEntries >= 10 && aggregate.annualEntries <= 60
    && positiveYears / annual.length >= 0.6
    && median(relativeReturns) > 0
    && aggregate.excessInformationRatio > 0
    && stressed.relativeReturnPct > 0
    && aggregate.maxDrawdownPct > -40
  const instabilityPenalty = mad(relativeReturns) * 0.5
  const drawdownPenalty = Math.max(0, -aggregate.maxDrawdownPct - 30) * 0.25
  return {
    aggregate,
    stressed,
    validationStartYear,
    eligible,
    robust: median(relativeReturns) + aggregate.excessInformationRatio * 1.5 - instabilityPenalty - drawdownPenalty,
  }
}

function positionCorrelation(left, right, start, end) {
  const a = []; const b = []
  for (let index = start; index < end; index += 1) { a.push(Number(left[index])); b.push(Number(right[index])) }
  const denominator = std(a) * std(b)
  return denominator ? covariance(a, b) / denominator : 1
}

function selectEnsemble(candidateRuns, market, trainStartYear, trainEndYear) {
  const scored = candidateRuns.map((item) => ({ item, scores: optimizerScores(item, market, trainStartYear, trainEndYear) }))
  const pool = scored.filter((row) => row.scores.eligible).sort((left, right) => right.scores.robust - left.scores.robust)
  if (!pool.length) return []
  const [start, end] = rangeForDates(market, `${Math.max(trainStartYear + 5, trainEndYear - 4)}-01-01`, `${trainEndYear}-12-31`)
  const selected = []
  for (const row of pool) {
    if (selected.some((existing) => existing.item.candidate.family === row.item.candidate.family)) continue
    if (selected.some((existing) => Math.abs(positionCorrelation(existing.item.positions, row.item.positions, start, end)) > 0.8)) continue
    selected.push({ ...row, objective: selected.length ? 'nested-diversifier' : 'nested-robust-relative-edge' })
    if (selected.length >= 3) break
  }
  return selected
}

function averagePositions(selected, length) {
  const output = new Float32Array(length)
  if (!selected.length) return output
  for (let index = 0; index < length; index += 1) output[index] = mean(selected.map((row) => Number(row.item.positions[index]))) * OVERLAY_NOTIONAL
  return output
}

function optimizeCrop(crop) {
  console.log(`features: ${crop.id}`)
  const market = marketData(crop)
  const features = cropFeatures(crop, market)
  const grid = candidateGrid()
  const uniqueDirections = new Map()
  for (const candidate of grid) {
    const positions = simulatePositions(candidate, features, market)
    const directionHash = sha256(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength))
    if (!uniqueDirections.has(directionHash)) uniqueDirections.set(directionHash, { candidate, positions, directionHash })
  }
  const candidateRuns = [...uniqueDirections.values()]
  console.log(`candidates: ${crop.id} raw=${grid.length} unique=${candidateRuns.length}`)
  const firstYear = Number(market.dates[0].slice(0, 4))
  const lastYear = Number(market.dates.at(-1).slice(0, 4))
  const oosPositions = new Float32Array(market.dates.length)
  const foldRows = []
  for (let testYear = Math.max(OOS_START_YEAR, firstYear + 6); testYear <= lastYear; testYear += 1) {
    const trainEndYear = testYear - 1
    const trainStartYear = Math.max(firstYear, testYear - 10)
    const selected = selectEnsemble(candidateRuns, market, trainStartYear, trainEndYear)
    const foldPositions = averagePositions(selected, market.dates.length)
    const [testStart, testEnd] = rangeForDates(market, `${testYear}-01-01`, `${testYear}-12-31`)
    for (let index = testStart; index < testEnd; index += 1) oosPositions[index] = foldPositions[index]
    const foldMetrics = metrics(foldPositions, market, testStart, testEnd)
    foldRows.push({
      cropId: crop.id,
      testYear,
      trainStartYear,
      trainEndYear,
      selectedCandidates: selected.map((row) => row.item.candidate.id),
      selectedDirectionHashes: selected.map((row) => row.item.directionHash),
      objectives: selected.map((row) => row.objective),
      ...foldMetrics,
    })
  }
  const finalTrainStartYear = Math.max(firstYear, lastYear - 10)
  const finalSelected = selectEnsemble(candidateRuns, market, finalTrainStartYear, lastYear)
  const [coreStart, coreEnd] = rangeForDates(market, `${OOS_START_YEAR}-01-01`, '2025-12-31')
  const [exposedStart, exposedEnd] = rangeForDates(market, '2026-01-01', market.dates.at(-1))
  const exactStartIndex = market.benchmarkSources.findIndex((source) => source.startsWith('exact-'))
  const coreMetrics = metrics(oosPositions, market, coreStart, coreEnd)
  const exposedMetrics = metrics(oosPositions, market, exposedStart, exposedEnd)
  const exactMetrics = exactStartIndex >= 0 ? metrics(oosPositions, market, exactStartIndex, market.dates.length) : null
  console.log(`oos: ${crop.id} core=${coreMetrics.totalReturnPct}% edge=${coreMetrics.edgePct}% entries/yr=${coreMetrics.annualEntries}`)
  return { crop, market, features, candidateRuns, oosPositions, foldRows, finalSelected, coreMetrics, exposedMetrics, exactMetrics }
}

function benchmarkCalendar(startDate, endDate) {
  const exact = basketCloses(EXACT_BASKET_FILE)
  const proxy = basketCloses(PROXY_BASKET_FILE)
  const allDates = [...new Set([...exact.keys(), ...proxy.keys()])].sort()
  const rows = []
  for (let index = 1; index < allDates.length; index += 1) {
    const priorDate = allDates[index - 1]
    const date = allDates[index]
    if (date < startDate || date > endDate) continue
    if (exact.has(priorDate) && exact.has(date)) {
      rows.push({ date, benchmarkReturn: exact.get(date) / exact.get(priorDate) - 1, benchmarkSource: 'exact-80-VOO-20-QQQM' })
    } else if (proxy.has(priorDate) && proxy.has(date)) {
      rows.push({ date, benchmarkReturn: proxy.get(date) / proxy.get(priorDate) - 1, benchmarkSource: 'proxy-80-SPY-20-QQQ' })
    }
  }
  return rows
}

export function portfolioFromCrops(crops, startDate, endDate, { launchFromZero = false } = {}) {
  const calendar = benchmarkCalendar(startDate, endDate)
  const dates = calendar.map((row) => row.date)
  const endpointMaps = crops.map((item) => new Map(item.market.dates.map((date, index) => [date, index])))
  const benchmarkReturns = Float64Array.from(calendar.map((row) => row.benchmarkReturn))
  const syntheticReturns = new Float64Array(dates.length)
  const sleeveLaunched = new Array(crops.length).fill(false)
  for (let outputIndex = 0; outputIndex < dates.length; outputIndex += 1) {
    const date = dates[outputIndex]
    let overlayReturn = 0
    for (let cropIndex = 0; cropIndex < crops.length; cropIndex += 1) {
      const crop = crops[cropIndex]
      const index = endpointMaps[cropIndex].get(date)
      if (index === undefined) continue
      const position = Number(crop.oosPositions[index])
      const prior = Number(index > 0 && (!launchFromZero || sleeveLaunched[cropIndex]) ? crop.oosPositions[index - 1] : 0)
      overlayReturn += position * crop.market.cropReturns[index] - Math.abs(position - prior) * COST_BPS / 10000
      sleeveLaunched[cropIndex] = true
    }
    // The basket is valued once on the canonical daily calendar. A crop that
    // skips a session is carried at its last close; its full interval return is
    // recognized when that crop next prints, instead of dropping every sleeve.
    syntheticReturns[outputIndex] = benchmarkReturns[outputIndex] + overlayReturn / crops.length
  }
  return { dates, returns: syntheticReturns, benchmarkReturns, metrics: directMetrics(syntheticReturns, benchmarkReturns, dates) }
}

export function directMetrics(strategyReturns, benchmarkReturns, dates) {
  if (!dates.length) return {}
  let equity = 1; let benchmark = 1; let relative = 1; let peak = 1; let drawdown = 0
  const excess = []
  for (let index = 0; index < dates.length; index += 1) { equity *= 1 + strategyReturns[index]; benchmark *= 1 + benchmarkReturns[index]; relative *= (1 + strategyReturns[index]) / (1 + benchmarkReturns[index]); excess.push(strategyReturns[index] - benchmarkReturns[index]); peak = Math.max(peak, equity); drawdown = Math.min(drawdown, equity / peak - 1) }
  const years = Math.max(daysBetween(dates[0], dates.at(-1)) / 365.25, 1 / 365.25)
  const vol = std([...strategyReturns]) * Math.sqrt(TRADING_DAYS)
  const bench = [...benchmarkReturns]
  const variance = std(bench) ** 2
  const beta = variance ? covariance([...strategyReturns], bench) / variance : 0
  const alpha = mean([...strategyReturns].map((value, index) => value - beta * bench[index])) * TRADING_DAYS
  const excessVol = std(excess) * Math.sqrt(TRADING_DAYS)
  return {
    totalReturnPct: round((equity - 1) * 100, 2), benchmarkReturnPct: round((benchmark - 1) * 100, 2), edgePct: round((equity - benchmark) * 100, 2),
    relativeReturnPct: round((relative - 1) * 100, 2), excessInformationRatio: round(excessVol ? mean(excess) * TRADING_DAYS / excessVol : 0, 2),
    cagrPct: round((equity ** (1 / years) - 1) * 100, 2), regressionAlphaPct: round(alpha * 100, 2), sharpe: round(vol ? mean([...strategyReturns]) * TRADING_DAYS / vol : 0, 2),
    maxDrawdownPct: round(drawdown * 100, 2), startDate: dates[0], endDate: dates.at(-1),
  }
}

function researchStatus(core, exactEra) {
  if (core.relativeReturnPct > 0 && core.excessInformationRatio > 0 && exactEra?.relativeReturnPct > 0) return 'C - historical challenger; future proof required'
  return 'Reject'
}

function reportHtml(summary) {
  const cropRows = summary.crops.map((crop) => `<tr><td><strong>${html(crop.crop)}</strong><small>${html(crop.symbol)}</small></td><td>${html(crop.status)}</td><td>${crop.core.totalReturnPct.toFixed(2)}%</td><td class="${crop.core.edgePct >= 0 ? 'pos' : 'neg'}">${crop.core.edgePct.toFixed(2)} pts</td><td class="${crop.exactEra.edgePct >= 0 ? 'pos' : 'neg'}">${crop.exactEra.edgePct.toFixed(2)} pts</td><td>${crop.core.annualEntries.toFixed(1)}</td><td>${crop.core.regressionAlphaPct.toFixed(2)}%</td></tr>`).join('')
  const folds = summary.foldRows.filter((row) => row.testYear >= 2022).map((row) => `<tr><td>${html(row.cropId)}</td><td>${row.testYear}</td><td>${row.totalReturnPct.toFixed(2)}%</td><td>${row.edgePct.toFixed(2)} pts</td><td>${row.entries}</td><td><small>${html(row.selectedCandidates.join(' · '))}</small></td></tr>`).join('')
  const dispositions = summary.crops.map((crop) => `<div class="card"><h3>${html(crop.crop)} · ${html(crop.status)}</h3><p><strong>Actionability:</strong> ${crop.status.startsWith('A') ? 'Advance to a frozen future paper test.' : crop.status.startsWith('B') ? 'Watchlist pending future proof.' : crop.status.startsWith('C') ? 'Screen flag only.' : 'Pass; do not deploy.'}</p><p><strong>Variant wedge:</strong> the supplied temperature/precipitation regimes must add return beyond the index fallback, not merely identify stressful crop weather.</p><p><strong>Why now:</strong> the rule universe has been narrowed to the photo hypothesis and all unrelated fade, shock, breadth, coffee, cotton, and sugar lanes are inactive.</p><p><strong>First rejection:</strong> long-run alpha ${crop.core.regressionAlphaPct.toFixed(2)}%; exact-era edge ${crop.exactEra.edgePct.toFixed(2)} points.</p><p><strong>What would make it investable:</strong> positive edge and alpha in the unopened post-${html(summary.futureHoldoutStart)} sample after at least 20 entries.</p><p><strong>What kills it:</strong> negative future edge, unstable rule-family turnover, or failure under controlled futures rolls.</p></div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QORE crop precipitation HF walk-forward</title><style>
  :root{--ink:#17202a;--muted:#65717e;--line:#dce3e8;--paper:#f5f7f8;--card:#fff;--navy:#153a55;--green:#14765a;--red:#b53c3c;--amber:#a96b16}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:linear-gradient(120deg,#102d42,#1a526c);color:white;padding:56px max(5vw,32px)}header h1{font-size:42px;line-height:1.08;max-width:900px;margin:8px 0 14px}header p{max-width:900px;color:#d9e7ef;font-size:18px}.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-weight:700;font-size:12px}.wrap{max-width:1200px;margin:0 auto;padding:28px 32px 64px}.warning{background:#fff4dc;border-left:5px solid var(--amber);padding:16px 18px;margin:0 0 24px}.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0 30px}.tile,.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}.tile strong{display:block;font-size:27px;color:var(--navy)}.tile span,small{display:block;color:var(--muted)}h2{font-size:24px;margin:34px 0 12px}h3{margin-top:0}table{width:100%;border-collapse:collapse;background:white;border:1px solid var(--line)}th,td{padding:12px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}th{background:#edf2f5;color:#44515d;font-size:12px;text-transform:uppercase;letter-spacing:.04em}th:first-child,td:first-child{text-align:left}.pos{color:var(--green);font-weight:700}.neg{color:var(--red);font-weight:700}.method{display:grid;grid-template-columns:1fr 1fr;gap:16px}.method ul{padding-left:20px;margin-bottom:0}code{font-size:12px;word-break:break-all}footer{color:var(--muted);padding-top:34px}@media(max-width:800px){.tiles,.method{grid-template-columns:1fr 1fr}header h1{font-size:32px}.wrap{padding:20px 14px}table{font-size:12px}}@media(max-width:520px){.tiles,.method{grid-template-columns:1fr}}
  </style></head><body><header><div class="eyebrow">QORE research · nested weather-overlay strategy v5</div><h1>Soybean &amp; corn weather-regime walk-forward</h1><p>The index basket remains fully invested. Only the supplied photo regimes can add a capped crop-futures overlay: hot/dry or drought is bullish; cool/wet or warm/wet is bearish.</p></header><main class="wrap"><div class="warning"><strong>No new untouched holdout result exists yet.</strong> Weather coverage and model training end on ${html(summary.data.weatherEnd)}, but input rows through ${html(summary.data.availableThrough)} were already present at freeze time. This report treats 2010–2025 as architecture-exposed nested walk-forward evidence and freezes the next genuinely untouched holdout from ${html(summary.futureHoldoutStart)} onward.</div>
  <section class="tiles"><div class="tile"><strong>${summary.data.weatherRows.toLocaleString()}</strong><span>daily location rows</span></div><div class="tile"><strong>3</strong><span>weather variables per row</span></div><div class="tile"><strong>${summary.search.candidatesPerCrop.toLocaleString()}</strong><span>photo-constrained rules per crop</span></div><div class="tile"><strong>${summary.portfolio.core.totalReturnPct.toFixed(2)}%</strong><span>2010–2025 two-crop portfolio</span></div></section>
  <section><h2>Photo translated into testable regimes</h2><div class="method"><div class="card"><h3>Long crop-futures overlay</h3><ul><li><strong>Hot and dry:</strong> below-normal rolling precipitation plus above-normal rolling maximum temperature across at least 18% of active production weight.</li><li><strong>Drought:</strong> precipitation at least 1.5 times beyond the candidate dry threshold.</li></ul></div><div class="card"><h3>Short crop-futures overlay</h3><ul><li><strong>Cool and wet:</strong> above-normal precipitation plus below-normal mean temperature.</li><li><strong>Warm and wet:</strong> above-normal precipitation plus above-normal mean temperature.</li><li><strong>Nothing:</strong> zero crop overlay; the 80% VOO / 20% QQQM basket stays fully invested.</li></ul></div></div></section>
  <section><h2>Crop-by-crop rolling evidence</h2><table><thead><tr><th>Crop</th><th>Research status</th><th>Strategy return</th><th>2010–25 edge</th><th>Exact-era edge</th><th>Entries / year</th><th>Reg. alpha</th></tr></thead><tbody>${cropRows}</tbody></table></section>
  <section class="method"><div class="card"><h3>What changed</h3><ul><li>Only soybeans and corn remain active.</li><li>Stress is classified at each site before aggregation, so dry U.S. weather is not canceled by wet South American weather.</li><li>Signals are limited to fixed reproductive/fill windows and separate U.S., Brazil, Argentina, and global lanes.</li><li>Only four atomic photo families remain. Duplicate direction vectors are removed before selection.</li><li>The basket stays fully invested and crop futures are capped at a fixed ${(summary.search.overlayNotional * 100).toFixed(0)}% notional overlay.</li></ul></div><div class="card"><h3>Walk-forward integrity</h3><ul><li>Each outer test year sees only the preceding ten years.</li><li>Candidate ranking uses only the trailing five inner-validation years, requires three of five positive relative years, and survives 20 bps one-way costs.</li><li>The ensemble may hold zero to three behaviorally distinct families; no passing candidate means zero crop exposure.</li><li>Before QQQM exists, 80% SPY / 20% QQQ is labeled as a research proxy. The recent period uses the exact 80% VOO / 20% QQQM fallback.</li><li>Five basis points one-way crop turnover cost and a two-calendar-day signal delay are applied.</li></ul></div></section>
  <section><h2>Portfolio read</h2><div class="card"><p>The equal-weight soybean/corn rolling portfolio returned <strong>${summary.portfolio.core.totalReturnPct.toFixed(2)}%</strong> in 2010–2025 versus <strong>${summary.portfolio.core.benchmarkReturnPct.toFixed(2)}%</strong> for the stitched fallback, for <strong class="${summary.portfolio.core.edgePct >= 0 ? 'pos' : 'neg'}">${summary.portfolio.core.edgePct.toFixed(2)} points</strong> of edge. Annualized regression alpha was ${summary.portfolio.core.regressionAlphaPct.toFixed(2)}%, Sharpe ${summary.portfolio.core.sharpe.toFixed(2)}, and maximum drawdown ${summary.portfolio.core.maxDrawdownPct.toFixed(2)}%.</p><p>The exposed 2026 diagnostic returned ${summary.portfolio.exposed.totalReturnPct.toFixed(2)}% versus ${summary.portfolio.exposed.benchmarkReturnPct.toFixed(2)}%. It is not an untouched test and is not used as promotion evidence.</p></div></section>
  <section><h2>Research disposition</h2><div class="method">${dispositions}</div></section>
  <section><h2>Recent fold ledger</h2><table><thead><tr><th>Crop</th><th>Test year</th><th>Return</th><th>Edge</th><th>Entries</th><th>Frozen rule ensemble</th></tr></thead><tbody>${folds}</tbody></table></section>
  <section><h2>Remaining limitations</h2><div class="card"><ul><li>NASA POWER is finalized MERRA-2 reanalysis, not archived point-in-time forecast vintages.</li><li>Yahoo continuous futures contain uncontrolled roll behavior and omit collateral yield, margin financing, executable spread and slippage detail.</li><li>The additive futures overlay assumes the basket remains collateral; contract-level execution data are required before this is tradable.</li><li>The architecture was redesigned after historical results were visible, so 2010–2025 is development evidence rather than a pristine research holdout.</li><li>The first clean live-style verdict can only be measured after ${html(summary.futureHoldoutStart)} without modifying the frozen model.</li></ul></div></section>
  <section><h2>Sources</h2><div class="card"><p>User-supplied photo for directional hypotheses; <a href="https://power.larc.nasa.gov/docs/services/api/temporal/daily/">NASA POWER Daily API</a> for weather coverage; local QORE market files for crop futures and the index baskets.</p></div></section>
  <footer>Generated ${html(summary.generatedAt)} · Freeze ${html(summary.freezeDigest)} · Research candidate, not an approved trading strategy.</footer></main></body></html>`
}

function main() {
  const config = JSON.parse(read(CONFIG_FILE))
  const manifest = JSON.parse(read(MANIFEST_FILE))
  if (manifest.status !== 'ok') throw new Error(`Collection manifest is ${manifest.status}.`)
  const version = refreezeVersion(process.argv.slice(2))
  const freezePlan = freezeWritePlan(OUTPUT_ROOT, version)
  if (config.crops.length !== 2 || config.crops.map((crop) => crop.id).join(',') !== 'soybeans,corn') throw new Error('Active universe must contain only soybeans and corn.')
  const results = config.crops.map(optimizeCrop)
  const marketEnd = manifest.contract.endDate
  const portfolioCore = portfolioFromCrops(results, `${OOS_START_YEAR}-01-01`, '2025-12-31')
  const portfolioExposed = portfolioFromCrops(results, '2026-01-01', marketEnd)
  const inputFiles = [
    CONFIG_FILE,
    MANIFEST_FILE,
    INDEX_CONFIG_FILE,
    EXACT_BASKET_FILE,
    PROXY_BASKET_FILE,
    ...config.crops.map((crop) => path.join(MARKET_DIR, `${safeSymbol(crop.symbol)}-daily.csv`)),
    ...config.crops.flatMap((crop) => crop.sites.map((site) => path.join(ACTUALS_DIR, `${site.id}.csv`))),
  ]
  const inputFileHashes = Object.fromEntries(inputFiles.map((file) => [path.relative(ROOT, file), sha256File(file)]))
  const marketAppendOnlyFiles = [
    EXACT_BASKET_FILE,
    PROXY_BASKET_FILE,
    ...config.crops.map((crop) => path.join(MARKET_DIR, `${safeSymbol(crop.symbol)}-daily.csv`)),
  ]
  const weatherAppendOnlyFiles = [
    ...config.crops.flatMap((crop) => crop.sites.map((site) => path.join(ACTUALS_DIR, `${site.id}.csv`))),
  ]
  const appendOnlyFiles = [...marketAppendOnlyFiles, ...weatherAppendOnlyFiles]
  const dataAvailableThrough = appendOnlyFiles.reduce((latest, file) => {
    const fileEnd = csvLatestDate(file)
    return fileEnd > latest ? fileEnd : latest
  }, marketEnd)
  const marketPaths = new Set(marketAppendOnlyFiles)
  const appendOnlyPrefixes = Object.fromEntries(appendOnlyFiles.map((file) => [
    path.relative(ROOT, file),
    csvPrefixSnapshot(file, dataAvailableThrough, marketPaths.has(file) ? 1 : 0),
  ]))
  const frozenPayload = {
    strategyId: 'crop-weather-photo-soy-corn-v5',
    freezeVersion: version ?? 'initial',
    frozenThrough: marketEnd,
    dataAvailableThrough,
    futureHoldoutStart: addDays(dataAvailableThrough, 1),
    signalLagDays: SIGNAL_LAG_DAYS,
    oneWayCostBps: COST_BPS,
    overlayNotional: OVERLAY_NOTIONAL,
    exactFallback: JSON.parse(read(INDEX_CONFIG_FILE)),
    proxyFallback: config.researchProxyBasket,
    collectionContract: manifest.contract,
    selectedCrops: results.map((result) => ({
      cropId: result.crop.id,
      symbol: result.crop.symbol,
      finalTrainingStartYear: Math.max(Number(result.market.dates[0].slice(0, 4)), Number(marketEnd.slice(0, 4)) - 10),
      finalTrainingEnd: marketEnd,
      ensemble: result.finalSelected.map((row) => ({ objective: row.objective, directionHash: row.item.directionHash, candidate: row.item.candidate, validationStartYear: row.scores.validationStartYear, trainingMetrics: row.scores.aggregate, stressedCostMetrics: row.scores.stressed })),
    })),
    inputHashes: {
      files: inputFileHashes,
      combined: sha256(JSON.stringify(inputFileHashes)),
      appendOnlyPrefixes,
      optimizer: sha256File(OPTIMIZER_FILE),
      evaluator: sha256File(EVALUATOR_FILE),
      collector: sha256File(COLLECTOR_FILE),
    },
  }
  const freezeDigest = sha256(JSON.stringify(frozenPayload))
  const foldRows = results.flatMap((result) => result.foldRows)
  const cropRows = results.map((result) => ({
    cropId: result.crop.id, crop: result.crop.label, symbol: result.crop.symbol,
    coreReturnPct: result.coreMetrics.totalReturnPct, coreFallbackPct: result.coreMetrics.benchmarkReturnPct, coreEdgePct: result.coreMetrics.edgePct,
    coreRelativeReturnPct: result.coreMetrics.relativeReturnPct, coreExcessInformationRatio: result.coreMetrics.excessInformationRatio,
    coreAlphaPct: result.coreMetrics.regressionAlphaPct, coreSharpe: result.coreMetrics.sharpe, coreMaxDrawdownPct: result.coreMetrics.maxDrawdownPct,
    coreEntries: result.coreMetrics.entries, coreEntriesPerYear: result.coreMetrics.annualEntries,
    exposed2026ReturnPct: result.exposedMetrics.totalReturnPct, exposed2026FallbackPct: result.exposedMetrics.benchmarkReturnPct, exposed2026EdgePct: result.exposedMetrics.edgePct,
    exactEraReturnPct: result.exactMetrics?.totalReturnPct ?? 0, exactEraFallbackPct: result.exactMetrics?.benchmarkReturnPct ?? 0, exactEraEdgePct: result.exactMetrics?.edgePct ?? 0, exactEraRelativeReturnPct: result.exactMetrics?.relativeReturnPct ?? 0,
    futureFrozenCandidates: result.finalSelected.map((row) => row.item.candidate.id),
  }))
  const summary = {
    generatedAt: new Date().toISOString(),
    status: 'rolling-pseudo-walk-forward-complete-future-holdout-frozen',
    freezeDigest,
    futureHoldoutStart: frozenPayload.futureHoldoutStart,
    data: {
      weatherStart: manifest.contract.startDate, weatherEnd: manifest.contract.endDate,
      availableThrough: frozenPayload.dataAvailableThrough,
      weatherYears: daysBetween(manifest.contract.startDate, manifest.contract.endDate) / 365.25,
      weatherSites: manifest.counts.sites, weatherRows: manifest.counts.weatherRows,
      crops: config.crops.length, marketRows: manifest.counts.marketRows, weatherVariables: ['precipitationMm', 'temperatureC', 'maxTemperatureC'],
    },
    search: {
      candidatesPerCrop: candidateGrid().length,
      uniqueCandidatesByCrop: Object.fromEntries(results.map((result) => [result.crop.id, result.candidateRuns.length])),
      activeFamilies: FAMILIES,
      photoHypothesis: config.photoHypothesis,
      optimizerObjectives: ['nested five-year relative edge', 'excess-return information ratio', '20 bps stressed-cost survival'],
      minimumAnnualEntries: 10,
      rollingTrainYears: 10,
      innerValidationYears: 5,
      overlayNotional: OVERLAY_NOTIONAL,
      regions: REGIONS,
      minimumAffectedProduction: MIN_AFFECTED_PRODUCTION,
      failClosedFallback: 'zero crop overlay when no candidate passes; retain the full index basket',
      oosCore: '2010-01-01 through 2025-12-31',
      exposedDiagnostic: `2026-01-01 through ${marketEnd}`,
    },
    crops: results.map((result) => ({ cropId: result.crop.id, crop: result.crop.label, symbol: result.crop.symbol, status: researchStatus(result.coreMetrics, result.exactMetrics), core: result.coreMetrics, exposed2026: result.exposedMetrics, exactEra: result.exactMetrics })),
    portfolio: { core: portfolioCore.metrics, exposed: portfolioExposed.metrics },
    foldRows,
    caveats: [
      'The soybean/corn universe and photo-derived rules were specified with historical data already visible, so 2026 is exposed to development.',
      '2010-2025 is a nested yearly pseudo-walk-forward: every outer year uses prior data only and candidate ranking uses a trailing inner-validation block, but the architecture itself was designed after earlier research.',
      'The pre-QQQM benchmark is an 80/20 SPY/QQQ economic proxy; the exact fallback remains 80/20 VOO/QQQM when both exact components exist.',
      'The basket remains fully invested while crop futures are an additive capped notional overlay.',
      'NASA POWER is finalized MERRA-2 reanalysis and Yahoo futures are uncontrolled continuous proxies with no explicit roll or collateral model.',
    ],
    sources: config.sources,
    outputs: {
      report: path.relative(ROOT, path.join(OUTPUT_ROOT, 'report.html')),
      runSummary: path.relative(ROOT, path.join(OUTPUT_ROOT, 'run-summary.json')),
      cropSummary: path.relative(ROOT, path.join(OUTPUT_ROOT, 'crop-summary.csv')),
      folds: path.relative(ROOT, path.join(OUTPUT_ROOT, 'walk-forward-folds.csv')),
      frozenModel: path.relative(ROOT, freezePlan.canonicalFile),
      frozenModelVersion: freezePlan.versionFile ? path.relative(ROOT, freezePlan.versionFile) : null,
    },
  }
  writeFreeze(freezePlan, `${JSON.stringify({ generatedAt: summary.generatedAt, freezeDigest, ...frozenPayload }, null, 2)}\n`)
  write(path.join(OUTPUT_ROOT, 'walk-forward-folds.csv'), rowsToCsv(foldRows, Object.keys(foldRows[0])))
  write(path.join(OUTPUT_ROOT, 'crop-summary.csv'), rowsToCsv(cropRows, Object.keys(cropRows[0])))
  write(path.join(OUTPUT_ROOT, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  write(path.join(OUTPUT_ROOT, 'report.html'), reportHtml(summary))
  console.log(`report: ${summary.outputs.report}`)
  console.log(`portfolio core=${summary.portfolio.core.totalReturnPct}% fallback=${summary.portfolio.core.benchmarkReturnPct}% edge=${summary.portfolio.core.edgePct}%`)
  if (version) console.log(`refreeze version ${version}: ${path.relative(ROOT, freezePlan.versionFile)}`)
  console.log(`future holdout starts ${summary.futureHoldoutStart} freeze=${freezeDigest}`)
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
