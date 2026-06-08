#!/usr/bin/env node
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseMessagesFromBuffer } from '@mattnucc/gribberish'
import { loadLocalEnv } from './local-env.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const dataRoot = process.env.QORE_DATA_ROOT ?? path.join(repoDir, '.local', 'qore')
const startDate = process.env.QORE_GFS_CALENDAR_START ?? process.env.QORE_TEST_START ?? '2021-01-01'
const endDate = process.env.QORE_GFS_CALENDAR_END ?? process.env.QORE_TEST_END ?? '2026-03-31'
const normalStartDate = process.env.QORE_NORMAL_START ?? '1991-01-01'
const normalEndDate = process.env.QORE_NORMAL_END ?? '2020-12-31'
const runHour = process.env.QORE_GFS_RUN_HOUR ?? '00'
const leadDays = listFromEnv('QORE_GFS_LEAD_DAYS', [1, 2, 3, 7, 8, 9, 10]).map(Number)
const validHoursUtc = listFromEnv('QORE_GFS_VALID_HOURS', [0]).map(Number)
const heatingSeasonOnly = truthy(process.env.QORE_GFS_HEATING_SEASON_ONLY ?? 'true')
const resume = truthy(process.env.QORE_GFS_RESUME)
const allowPartial = truthy(process.env.QORE_GFS_ALLOW_PARTIAL)
const concurrency = Math.max(1, Number(process.env.QORE_GFS_CONCURRENCY ?? 4))
const maxItems = Number(process.env.QORE_GFS_MAX_ITEMS ?? 0)
const timeoutMs = Number(process.env.QORE_FETCH_TIMEOUT_MS ?? 30000)

const arcticBlastThresholds = {
  coldAnomalyF: -8,
  extremeAnomalyF: -14,
  minCoveragePct: 0.55,
}

const locations = [
  { id: 'minneapolis', name: 'Minneapolis', latitude: 44.9778, longitude: -93.265, region: 'Upper Midwest', weight: 0.07 },
  { id: 'chicago', name: 'Chicago', latitude: 41.8781, longitude: -87.6298, region: 'Great Lakes', weight: 0.09 },
  { id: 'detroit', name: 'Detroit', latitude: 42.3314, longitude: -83.0458, region: 'Great Lakes', weight: 0.06 },
  { id: 'cleveland', name: 'Cleveland', latitude: 41.4993, longitude: -81.6944, region: 'Great Lakes', weight: 0.05 },
  { id: 'indianapolis', name: 'Indianapolis', latitude: 39.7684, longitude: -86.1581, region: 'Ohio Valley', weight: 0.05 },
  { id: 'st-louis', name: 'St. Louis', latitude: 38.627, longitude: -90.1994, region: 'Midwest', weight: 0.05 },
  { id: 'kansas-city', name: 'Kansas City', latitude: 39.0997, longitude: -94.5786, region: 'Central Plains', weight: 0.04 },
  { id: 'nashville', name: 'Nashville', latitude: 36.1627, longitude: -86.7816, region: 'Mid-South', weight: 0.05 },
  { id: 'memphis', name: 'Memphis', latitude: 35.1495, longitude: -90.049, region: 'Mid-South', weight: 0.04 },
  { id: 'atlanta', name: 'Atlanta', latitude: 33.749, longitude: -84.388, region: 'Southeast', weight: 0.07 },
  { id: 'charlotte', name: 'Charlotte', latitude: 35.2271, longitude: -80.8431, region: 'Southeast', weight: 0.05 },
  { id: 'raleigh', name: 'Raleigh', latitude: 35.7796, longitude: -78.6382, region: 'Southeast', weight: 0.04 },
  { id: 'washington-dc', name: 'Washington, DC', latitude: 38.9072, longitude: -77.0369, region: 'Mid-Atlantic', weight: 0.07 },
  { id: 'philadelphia', name: 'Philadelphia', latitude: 39.9526, longitude: -75.1652, region: 'Mid-Atlantic', weight: 0.06 },
  { id: 'new-york', name: 'New York', latitude: 40.7128, longitude: -74.006, region: 'Northeast', weight: 0.11 },
  { id: 'boston', name: 'Boston', latitude: 42.3601, longitude: -71.0589, region: 'Northeast', weight: 0.06 },
  { id: 'dallas', name: 'Dallas', latitude: 32.7767, longitude: -96.797, region: 'Texas/Oklahoma fringe', weight: 0.05 },
  { id: 'houston', name: 'Houston', latitude: 29.7604, longitude: -95.3698, region: 'Texas/Oklahoma fringe', weight: 0.05 },
]

const basketWeight = locations.reduce((sum, location) => sum + location.weight, 0)
const rangeLabel = `${startDate}-${endDate}`
const validHourLabel = validHoursUtc.join('-')
const leadLabel = leadDays.join('-')
const baseName = `gfs-${runHour}z-daily-forecast-calendar-${rangeLabel}-leads-${leadLabel}-hours-${validHourLabel}`
const anomalyPath = path.join(dataRoot, 'weather', 'noaa-gfs', `${baseName}-location-anomalies.csv`)
const scorePath = path.join(dataRoot, 'research', `${baseName}-signal-scores.csv`)
const returnsPath = path.join(dataRoot, 'research', `${baseName}-signal-returns.csv`)
const manifestPath = path.join(dataRoot, 'weather', 'noaa-gfs', `${baseName}-manifest.json`)

const anomalyHeaders = [
  'issueDate',
  'targetDate',
  'leadDays',
  'windowId',
  'modelId',
  'locationId',
  'region',
  'weight',
  'forecastMeanF',
  'normalMeanF',
  'forecastAnomalyF',
  'sampledValidHoursUtc',
  'nearestGridLatitude',
  'nearestGridLongitude',
  'source',
]
const scoreHeaders = [
  'issueDate',
  'targetDate',
  'leadDays',
  'windowId',
  'modelId',
  'weightedAnomalyF',
  'coveragePct',
  'extremeCount',
  'sampledWeight',
  'locationCount',
  'sampledValidHoursUtc',
  'qualifies',
  'source',
]
const returnHeaders = [
  'issueDate',
  'targetDate',
  'leadDays',
  'windowId',
  'modelId',
  'symbol',
  'priorTradeDate',
  'entryTradeDate',
  'targetTradeDate',
  'priorClose',
  'entryClose',
  'targetClose',
  'returnPctPriorCloseToTarget',
  'returnPctEntryCloseToTarget',
  'qualifies',
]

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rowsToCsv(rows, headers) {
  return rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n') + (rows.length ? '\n' : '')
}

function listFromEnv(key, fallback) {
  const value = process.env[key]
  if (!value) return fallback
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function compactDate(dateText) {
  return dateText.replaceAll('-', '')
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function datesBetween(start, end) {
  const dates = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) dates.push(cursor)
  return dates
}

function isHeatingSeason(dateText) {
  const month = Number(dateText.slice(5, 7))
  return month <= 3 || month >= 11
}

function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function kelvinToFahrenheit(value) {
  return (value - 273.15) * 1.8 + 32
}

function fahrenheitFromCelsius(value) {
  return value * 1.8 + 32
}

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      value += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }

  values.push(value)
  return values
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'QORE NOAA GFS backfill',
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url)
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`)
  return text
}

async function fetchRange(url, start, end) {
  const response = await fetchWithTimeout(url, { headers: { Range: `bytes=${start}-${end}` } })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP ${response.status}: ${bytes.toString('utf8', 0, 180)}`)
  }
  return bytes
}

async function fetchWithRetry(label, fn, retries = 2) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
    }
  }
  throw new Error(`${label}: ${lastError.message}`)
}

function gfsObjectBases(issueDate, fhr) {
  const ymd = compactDate(issueDate)
  const fff = String(fhr).padStart(3, '0')
  const fileName = `gfs.t${runHour}z.pgrb2.0p25.f${fff}`
  return [
    `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${ymd}/${runHour}/atmos/${fileName}`,
    `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${ymd}/${runHour}/${fileName}`,
  ]
}

async function fetchGfsIndex(issueDate, fhr) {
  const bases = gfsObjectBases(issueDate, fhr)
  const errors = []
  for (const gribUrl of bases) {
    const idxUrl = `${gribUrl}.idx`
    try {
      const text = await fetchWithRetry(`index ${idxUrl}`, () => fetchText(idxUrl))
      return { gribUrl, idxUrl, text }
    } catch (error) {
      errors.push(`${idxUrl}: ${error.message}`)
    }
  }
  throw new Error(errors.join(' | '))
}

function targetRangeFromIndex(indexText) {
  const rows = indexText.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split(':')
    return {
      line,
      messageNumber: Number(parts[0]),
      start: Number(parts[1]),
      variable: parts[3],
      level: parts[4],
      forecast: parts[5],
    }
  })
  const targetIndex = rows.findIndex((row) =>
    row.variable === 'TMP' &&
    row.level.includes('2 m') &&
    row.level.includes('above ground')
  )
  if (targetIndex === -1) throw new Error('Could not find TMP:2 m above ground in GFS index.')
  const target = rows[targetIndex]
  const next = rows[targetIndex + 1]
  if (!next) throw new Error(`TMP range was last row in index: ${target.line}`)
  return { start: target.start, end: next.start - 1, indexLine: target.line }
}

function sampleLocation(message, location) {
  const { rows, cols } = message.gridShape
  const normalizedLongitude = location.longitude < 0 ? location.longitude + 360 : location.longitude
  const row = Math.max(0, Math.min(rows - 1, Math.round((90 - location.latitude) / 0.25)))
  const col = Math.max(0, Math.min(cols - 1, Math.round(normalizedLongitude / 0.25)))
  const valueK = message.data[row * cols + col]
  return {
    valueF: kelvinToFahrenheit(valueK),
    nearestGridLatitude: message.latlng.latitude[row],
    nearestGridLongitude: message.latlng.longitude[col] > 180 ? message.latlng.longitude[col] - 360 : message.latlng.longitude[col],
  }
}

async function fetchForecastSamples(issueDate, fhr) {
  const { gribUrl, idxUrl, text } = await fetchGfsIndex(issueDate, fhr)
  const { start, end, indexLine } = targetRangeFromIndex(text)
  const bytes = await fetchWithRetry(`grib ${gribUrl}`, () => fetchRange(gribUrl, start, end))
  const [message] = parseMessagesFromBuffer(bytes)
  if (!message) throw new Error(`Could not parse GFS GRIB message from ${gribUrl}`)
  return {
    sourceUrl: gribUrl,
    indexUrl: idxUrl,
    indexLine,
    samples: Object.fromEntries(locations.map((location) => [location.id, sampleLocation(message, location)])),
  }
}

async function loadNormalMeans() {
  const means = new Map()
  const missing = []
  for (const location of locations) {
    const filePath = path.join(dataRoot, 'weather', 'nasa-power', 'normals', `${location.id}-${normalStartDate}-${normalEndDate}.json`)
    try {
      const json = JSON.parse(await readFile(filePath, 'utf8'))
      const values = json.properties?.parameter?.T2M ?? {}
      const byMonthDay = new Map()
      for (const [date, value] of Object.entries(values)) {
        if (typeof value !== 'number' || value <= -900) continue
        const monthDay = date.slice(4)
        byMonthDay.set(monthDay, [...(byMonthDay.get(monthDay) ?? []), fahrenheitFromCelsius(value)])
      }
      for (const [monthDay, monthDayValues] of byMonthDay.entries()) {
        means.set(`${location.id}-${monthDay}`, average(monthDayValues))
      }
    } catch (error) {
      missing.push({ locationId: location.id, file: path.relative(repoDir, filePath), error: error.message })
    }
  }
  if (missing.length) {
    throw new Error(`Missing NASA POWER normal files: ${JSON.stringify(missing.slice(0, 3))}`)
  }
  return means
}

async function loadMarketRows(fileName) {
  const filePath = path.join(dataRoot, 'market', 'yahoo', fileName)
  const rows = parseCsv(await readFile(filePath, 'utf8'))
    .map((row) => ({
      ...row,
      close: Number(row.close),
    }))
    .filter((row) => row.date && Number.isFinite(row.close))
    .sort((a, b) => a.date.localeCompare(b.date))
  return rows
}

function marketOnOrBefore(rows, date) {
  let found = null
  for (const row of rows) {
    if (row.date > date) break
    found = row
  }
  return found
}

function marketBefore(rows, date) {
  let found = null
  for (const row of rows) {
    if (row.date >= date) break
    found = row
  }
  return found
}

function marketOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date) ?? null
}

function returnPct(start, end) {
  return start?.close && end?.close ? round(((end.close - start.close) / start.close) * 100, 3) : ''
}

function windowIdForLead(leadDay) {
  if (leadDay >= 7 && leadDay <= 10) return 'rumor'
  if (leadDay >= 1 && leadDay <= 3) return 'selloff'
  return 'other'
}

async function prepareOutputFiles() {
  await ensureDir(path.dirname(anomalyPath))
  await ensureDir(path.dirname(scorePath))
  await ensureDir(path.dirname(returnsPath))
  if (!resume) {
    await rm(anomalyPath, { force: true })
    await rm(scorePath, { force: true })
    await rm(returnsPath, { force: true })
  }
  if (!existsSync(anomalyPath)) await writeFile(anomalyPath, `${anomalyHeaders.join(',')}\n`)
  if (!existsSync(scorePath)) await writeFile(scorePath, `${scoreHeaders.join(',')}\n`)
  if (!existsSync(returnsPath)) await writeFile(returnsPath, `${returnHeaders.join(',')}\n`)
}

function rowKey(row) {
  return `${row.issueDate}|${row.leadDays}`
}

async function countRowsByKey(filePath) {
  if (!existsSync(filePath)) return new Map()
  const counts = new Map()
  const rows = parseCsv(await readFile(filePath, 'utf8'))
  for (const row of rows) {
    if (!row.issueDate || !row.leadDays) continue
    const key = rowKey(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

async function rewriteRowsWithoutKeys(filePath, headers, keysToRemove) {
  const rows = parseCsv(await readFile(filePath, 'utf8')).filter((row) => !keysToRemove.has(rowKey(row)))
  await writeFile(filePath, `${headers.join(',')}\n${rowsToCsv(rows, headers)}`)
}

async function loadResumeState(expectedReturnRows) {
  if (!resume) return { completeKeys: new Set(), prunedKeys: new Set() }

  const scoreCounts = await countRowsByKey(scorePath)
  const anomalyCounts = await countRowsByKey(anomalyPath)
  const returnCounts = await countRowsByKey(returnsPath)
  const allKeys = new Set([...scoreCounts.keys(), ...anomalyCounts.keys(), ...returnCounts.keys()])
  const completeKeys = new Set()
  const prunedKeys = new Set()

  for (const key of allKeys) {
    const isComplete =
      scoreCounts.get(key) === 1 &&
      anomalyCounts.get(key) === locations.length &&
      returnCounts.get(key) === expectedReturnRows
    if (isComplete) {
      completeKeys.add(key)
    } else {
      prunedKeys.add(key)
    }
  }

  if (prunedKeys.size) {
    await rewriteRowsWithoutKeys(anomalyPath, anomalyHeaders, prunedKeys)
    await rewriteRowsWithoutKeys(scorePath, scoreHeaders, prunedKeys)
    await rewriteRowsWithoutKeys(returnsPath, returnHeaders, prunedKeys)
    console.warn(`gfs calendar resume pruned ${prunedKeys.size} incomplete output groups`)
  }

  return { completeKeys, prunedKeys }
}

function buildWorkItems(doneKeys, options = {}) {
  const { includeDone = false } = options
  const items = []
  for (const issueDate of datesBetween(startDate, endDate)) {
    for (const leadDay of leadDays) {
      const targetDate = addDays(issueDate, leadDay)
      if (targetDate > endDate) continue
      if (heatingSeasonOnly && !isHeatingSeason(targetDate)) continue
      const key = `${issueDate}|${leadDay}`
      if (!includeDone && doneKeys.has(key)) continue
      items.push({
        key,
        issueDate,
        leadDays: leadDay,
        targetDate,
        windowId: windowIdForLead(leadDay),
      })
    }
  }
  return items
}

async function buildItem(item, normalMeans) {
  const validSamples = []
  for (const validHour of validHoursUtc) {
    const fhr = item.leadDays * 24 + validHour
    const samples = await fetchForecastSamples(item.issueDate, fhr)
    validSamples.push({ validHour, fhr, ...samples })
  }

  const locationRows = locations.map((location) => {
    const values = validSamples.map((sample) => sample.samples[location.id]).filter(Boolean)
    const forecastMeanF = average(values.map((value) => value.valueF))
    const monthDay = compactDate(item.targetDate).slice(4)
    const normalMeanF = normalMeans.get(`${location.id}-${monthDay}`)
    const nearest = values[0] ?? {}
    return {
      issueDate: item.issueDate,
      targetDate: item.targetDate,
      leadDays: item.leadDays,
      windowId: item.windowId,
      modelId: `ncep-gfs-global-${runHour}z-noaa-aws`,
      locationId: location.id,
      region: location.region,
      weight: location.weight,
      forecastMeanF: round(forecastMeanF, 3),
      normalMeanF: round(normalMeanF, 3),
      forecastAnomalyF: round(forecastMeanF - normalMeanF, 3),
      sampledValidHoursUtc: validHoursUtc.join('|'),
      nearestGridLatitude: nearest.nearestGridLatitude,
      nearestGridLongitude: nearest.nearestGridLongitude,
      source: 'NOAA GFS 0.25 degree forecast archive on AWS, TMP 2 m above ground',
    }
  })

  const sampledWeight = locationRows.reduce((sum, row) => sum + Number(row.weight || 0), 0)
  const weightedAnomalyF = sampledWeight
    ? locationRows.reduce((sum, row) => sum + row.forecastAnomalyF * Number(row.weight || 0), 0) / sampledWeight
    : 0
  const coldWeight = locationRows
    .filter((row) => row.forecastAnomalyF <= arcticBlastThresholds.coldAnomalyF)
    .reduce((sum, row) => sum + Number(row.weight || 0), 0)
  const coveragePct = basketWeight ? coldWeight / basketWeight : 0
  const scoreRow = {
    issueDate: item.issueDate,
    targetDate: item.targetDate,
    leadDays: item.leadDays,
    windowId: item.windowId,
    modelId: `ncep-gfs-global-${runHour}z-noaa-aws`,
    weightedAnomalyF: round(weightedAnomalyF, 3),
    coveragePct: round(coveragePct, 3),
    extremeCount: locationRows.filter((row) => row.forecastAnomalyF <= arcticBlastThresholds.extremeAnomalyF).length,
    sampledWeight: round(sampledWeight, 3),
    locationCount: locationRows.length,
    sampledValidHoursUtc: validHoursUtc.join('|'),
    qualifies:
      weightedAnomalyF <= arcticBlastThresholds.coldAnomalyF &&
      coveragePct >= arcticBlastThresholds.minCoveragePct,
    source: 'NOAA GFS 0.25 degree forecast archive on AWS, TMP 2 m above ground',
  }

  return { item, locationRows, scoreRow }
}

function buildReturnRows(scoreRow, marketBySymbol) {
  return Object.entries(marketBySymbol).map(([symbol, rows]) => {
    const prior = marketBefore(rows, scoreRow.issueDate)
    const entry = marketOnOrAfter(rows, scoreRow.issueDate)
    const target = marketOnOrBefore(rows, scoreRow.targetDate)
    return {
      issueDate: scoreRow.issueDate,
      targetDate: scoreRow.targetDate,
      leadDays: scoreRow.leadDays,
      windowId: scoreRow.windowId,
      modelId: scoreRow.modelId,
      symbol,
      priorTradeDate: prior?.date ?? '',
      entryTradeDate: entry?.date ?? '',
      targetTradeDate: target?.date ?? '',
      priorClose: prior?.close ?? '',
      entryClose: entry?.close ?? '',
      targetClose: target?.close ?? '',
      returnPctPriorCloseToTarget: returnPct(prior, target),
      returnPctEntryCloseToTarget: returnPct(entry, target),
      qualifies: scoreRow.qualifies,
    }
  })
}

async function main() {
  await prepareOutputFiles()
  const normalMeans = await loadNormalMeans()
  const marketBySymbol = {
    UNG: await loadMarketRows('UNG-qore-market.csv'),
    'NG=F': await loadMarketRows('NG-F-qore-market.csv'),
  }
  const marketSymbols = Object.keys(marketBySymbol)
  const { completeKeys: doneKeys, prunedKeys } = await loadResumeState(marketSymbols.length)
  const expectedItems = buildWorkItems(new Set(), { includeDone: true })
  const items = buildWorkItems(doneKeys)
  if (maxItems > 0) items.splice(maxItems)
  const failures = []
  let completed = 0
  let writeQueue = Promise.resolve()

  function queueWrite(scoreResult) {
    writeQueue = writeQueue.then(async () => {
      const returnRows = buildReturnRows(scoreResult.scoreRow, marketBySymbol)
      await appendFile(anomalyPath, rowsToCsv(scoreResult.locationRows, anomalyHeaders))
      await appendFile(returnsPath, rowsToCsv(returnRows, returnHeaders))
      await appendFile(scorePath, rowsToCsv([scoreResult.scoreRow], scoreHeaders))
    })
    return writeQueue
  }

  let nextIndex = 0
  async function worker() {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      if (!item) return
      try {
        const result = await buildItem(item, normalMeans)
        await queueWrite(result)
      } catch (error) {
        failures.push({ ...item, error: error.message })
        console.warn(`gfs calendar failed: ${item.issueDate} lead ${item.leadDays}: ${error.message}`)
      }
      completed += 1
      if (completed % 25 === 0 || completed === items.length) {
        console.log(`gfs calendar progress: ${completed}/${items.length} items (${failures.length} failures)`)
      }
    }
  }

  console.log(
    `gfs calendar start: ${items.length} items, range ${startDate}..${endDate}, leads ${leadDays.join(',')}, valid hours ${validHoursUtc.join(',')}, concurrency ${concurrency}`,
  )
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  await writeQueue

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'NOAA GFS 0.25 degree forecast archive on AWS, TMP 2 m above ground',
    range: { startDate, endDate },
    runHour,
    leadDays,
    validHoursUtc,
    heatingSeasonOnly,
    allowPartial,
    modelId: `ncep-gfs-global-${runHour}z-noaa-aws`,
    locations: locations.length,
    expectedScoreRows: expectedItems.length,
    existingCompleteRowsBeforeRun: doneKeys.size,
    resumePrunedRowsBeforeRun: prunedKeys.size,
    itemRowsAttemptedThisRun: items.length,
    itemRowsCompletedThisRun: items.length - failures.length,
    finalCompleteRows: doneKeys.size + items.length - failures.length,
    missingCompleteRows: expectedItems.length - (doneKeys.size + items.length - failures.length),
    failures,
    files: {
      locationAnomalies: path.relative(repoDir, anomalyPath),
      signalScores: path.relative(repoDir, scorePath),
      signalReturns: path.relative(repoDir, returnsPath),
      manifest: path.relative(repoDir, manifestPath),
    },
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`gfs calendar manifest written: ${path.relative(repoDir, manifestPath)}`)
  if (failures.length && !allowPartial) {
    console.error(
      `gfs calendar incomplete: ${failures.length} failures. Set QORE_GFS_ALLOW_PARTIAL=1 to keep a zero exit code for partial exploratory runs.`,
    )
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
