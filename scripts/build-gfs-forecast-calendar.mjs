#!/usr/bin/env node
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { loadLocalEnv } from './local-env.mjs'

const require = createRequire(import.meta.url)
const usePortableGribParser =
  truthy(process.env.QORE_GFS_PORTABLE_GRIB_PARSER) ||
  (process.platform === 'linux' && process.arch === 'arm64')
const portableGrib = usePortableGribParser ? require('grib-js') : null
const nativeGrib = usePortableGribParser ? null : require('@mattnucc/gribberish')

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const dataRoot = process.env.QORE_DATA_ROOT ?? path.join(repoDir, 'data', 'qore')
const outputRoot = path.resolve(process.env.QORE_GFS_OUTPUT_ROOT ?? dataRoot)
const forecastSource = process.env.QORE_FORECAST_SOURCE ?? 'gfs'
const latestCompleteDate = addDays(new Date().toISOString().slice(0, 10), -1)
const startDate = validatedDate(process.env.QORE_GFS_CALENDAR_START ?? process.env.QORE_TEST_START ?? '2021-01-01', 'calendar start')
const endDate = validatedDate(process.env.QORE_GFS_CALENDAR_END ?? process.env.QORE_TEST_END ?? latestCompleteDate, 'calendar end')
const issueEndDate = validatedDate(process.env.QORE_GFS_CALENDAR_ISSUE_END ?? endDate, 'calendar issue end')
const normalStartDate = validatedDate(process.env.QORE_NORMAL_START ?? '1991-01-01', 'normal start')
const normalEndDate = validatedDate(process.env.QORE_NORMAL_END ?? '2020-12-31', 'normal end')
const runHour = validatedRunHour(process.env.QORE_GFS_RUN_HOUR ?? '00')
const leadDays = validatedIntegerList(listFromEnv('QORE_GFS_LEAD_DAYS', [1, 2, 3, 7, 8, 9, 10]), 'lead days', 0, 100)
const validHoursUtc = validatedIntegerList(listFromEnv('QORE_GFS_VALID_HOURS', [0]), 'valid hours', 0, 23)
const coolingSeasonOnly = truthy(process.env.QORE_GFS_COOLING_SEASON_ONLY)
const heatingSeasonOnly = truthy(process.env.QORE_GFS_HEATING_SEASON_ONLY ?? (coolingSeasonOnly ? 'false' : 'true'))
const resume = truthy(process.env.QORE_GFS_RESUME)
const allowPartial = truthy(process.env.QORE_GFS_ALLOW_PARTIAL)
const concurrency = Math.max(1, Number(process.env.QORE_GFS_CONCURRENCY ?? 4))
const maxItems = Number(process.env.QORE_GFS_MAX_ITEMS ?? 0)
const timeoutMs = Number(process.env.QORE_FETCH_TIMEOUT_MS ?? 30000)

if (heatingSeasonOnly && coolingSeasonOnly) {
  throw new Error('Set only one seasonal calendar filter: QORE_GFS_HEATING_SEASON_ONLY or QORE_GFS_COOLING_SEASON_ONLY.')
}
if (startDate > endDate) throw new Error('QORE GFS calendar start must not be after calendar end.')
if (issueEndDate < startDate || issueEndDate > endDate) {
  throw new Error('QORE GFS calendar issue end must be between calendar start and calendar end.')
}
if (normalStartDate > normalEndDate) throw new Error('QORE normal start must not be after normal end.')

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
const sourceConfigs = {
  gfs: {
    outputPrefix: 'gfs',
    weatherDir: 'noaa-gfs',
    modelId: () => `ncep-gfs-global-${runHour}z-noaa-aws`,
    source: 'NOAA GFS 0.25 degree forecast archive on AWS, TMP 2 m above ground',
    userAgent: 'QORE NOAA GFS backfill',
    objectBases(issueDate, fhr) {
      const ymd = compactDate(issueDate)
      const fff = String(fhr).padStart(3, '0')
      const fileName = `gfs.t${runHour}z.pgrb2.0p25.f${fff}`
      return [
        `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${ymd}/${runHour}/atmos/${fileName}`,
        `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${ymd}/${runHour}/${fileName}`,
      ]
    },
  },
  'gefs-mean': {
    outputPrefix: 'gefs-mean',
    weatherDir: 'noaa-gefs',
    modelId: () => `ncep-gefs-mean-${runHour}z-noaa-aws`,
    source: 'NOAA GEFS 0.25 degree ensemble mean forecast archive on AWS, TMP 2 m above ground',
    userAgent: 'QORE NOAA GEFS backfill',
    objectBases(issueDate, fhr) {
      const ymd = compactDate(issueDate)
      const fff = String(fhr).padStart(3, '0')
      const fileName = `geavg.t${runHour}z.pgrb2s.0p25.f${fff}`
      return [
        `https://noaa-gefs-pds.s3.amazonaws.com/gefs.${ymd}/${runHour}/atmos/pgrb2sp25/${fileName}`,
      ]
    },
  },
  graphcastgfs: {
    outputPrefix: 'graphcastgfs',
    weatherDir: 'gfs-graphcast',
    modelId: () => `ncep-gfs-graphcast-${runHour}z-noaa-aws`,
    source: 'NOAA GraphCastGFS 0.25 degree forecast archive on AWS, TMP 2 m above ground',
    userAgent: 'QORE NOAA GraphCastGFS backfill',
    objectBases(issueDate, fhr) {
      const ymd = compactDate(issueDate)
      const fff = String(fhr).padStart(3, '0')
      const fileName = `graphcastgfs.t${runHour}z.pgrb2.0p25.f${fff}`
      return [
        `https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com/graphcastgfs.${ymd}/${runHour}/forecasts_13_levels/${fileName}`,
      ]
    },
  },
  aigfs: {
    outputPrefix: 'aigfs',
    weatherDir: 'aigfs',
    modelId: () => `ncep-aigfs-025-${runHour}z-openmeteo-single-runs`,
    source: 'Open-Meteo Single Runs API, model ncep_aigfs025, temperature_2m',
    userAgent: 'QORE NCEP AIGFS live calendar',
    openMeteoModel: 'ncep_aigfs025',
  },
  'ecmwf-ifs': {
    outputPrefix: 'ecmwf-ifs',
    weatherDir: 'ecmwf-ifs',
    modelId: () => `ecmwf-ifs-${runHour}z-openmeteo-single-runs`,
    source: 'Open-Meteo Single Runs API, model ecmwf_ifs, temperature_2m',
    userAgent: 'QORE ECMWF IFS live calendar',
    openMeteoModel: 'ecmwf_ifs',
  },
  'ecmwf-aifs': {
    outputPrefix: 'ecmwf-aifs',
    weatherDir: 'ecmwf-aifs',
    modelId: () => `ecmwf-aifs-025-${runHour}z-openmeteo-single-runs`,
    source: 'Open-Meteo Single Runs API, model ecmwf_aifs025_single, temperature_2m',
    userAgent: 'QORE ECMWF AIFS live calendar',
    openMeteoModel: 'ecmwf_aifs025_single',
  },
  'gem-global': {
    outputPrefix: 'gem-global',
    weatherDir: 'gem-global',
    modelId: () => `gem-global-${runHour}z-openmeteo-single-runs`,
    source: 'Open-Meteo Single Runs API, model gem_global, temperature_2m',
    userAgent: 'QORE GEM Global live calendar',
    openMeteoModel: 'gem_global',
  },
}
const sourceConfig = Object.hasOwn(sourceConfigs, forecastSource) ? sourceConfigs[forecastSource] : null
if (!sourceConfig) {
  throw new Error(`Unsupported QORE_FORECAST_SOURCE=${forecastSource}. Expected one of: ${Object.keys(sourceConfigs).join(', ')}`)
}
const rangeLabel = `${startDate}-${endDate}`
const validHourLabel = validHoursUtc.join('-')
const leadLabel = leadDays.join('-')
const defaultBaseName = `${sourceConfig.outputPrefix}-${runHour}z-daily-forecast-calendar-${rangeLabel}-leads-${leadLabel}-hours-${validHourLabel}`
const baseName = validatedOutputBasename(
  truthy(process.env.QORE_GFS_FORCE_DEFAULT_OUTPUT_BASENAME)
    ? defaultBaseName
    : process.env.QORE_GFS_OUTPUT_BASENAME ?? defaultBaseName,
)
const anomalyPath = resolveOutputPath('weather', sourceConfig.weatherDir, `${baseName}-location-anomalies.csv`)
const scorePath = resolveOutputPath('research', `${baseName}-signal-scores.csv`)
const returnsPath = resolveOutputPath('research', `${baseName}-signal-returns.csv`)
const manifestPath = resolveOutputPath('weather', sourceConfig.weatherDir, `${baseName}-manifest.json`)

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

function validatedDate(value, label) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`QORE GFS ${label} must be a valid YYYY-MM-DD date.`)
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`QORE GFS ${label} must be a valid YYYY-MM-DD date.`)
  }
  return text
}

function validatedRunHour(value) {
  const text = String(value ?? '')
  if (!/^\d{2}$/.test(text) || Number(text) < 0 || Number(text) > 23) {
    throw new Error('QORE_GFS_RUN_HOUR must be a two-digit UTC hour from 00 through 23.')
  }
  return text
}

function validatedIntegerList(values, label, min, max) {
  const parsed = values.map(Number)
  if (!parsed.length || parsed.some((value) => !Number.isInteger(value) || value < min || value > max)) {
    throw new Error(`QORE GFS ${label} must contain only integers from ${min} through ${max}.`)
  }
  return parsed
}

function validatedOutputBasename(value) {
  const text = String(value ?? '')
  if (
    !text ||
    text.length > 220 ||
    text === '.' ||
    text === '..' ||
    path.basename(text) !== text ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)
  ) {
    throw new Error('QORE_GFS_OUTPUT_BASENAME must be a single safe filename component.')
  }
  return text
}

function resolveOutputPath(...segments) {
  const filePath = path.resolve(outputRoot, ...segments)
  const relativePath = path.relative(outputRoot, filePath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error('QORE GFS output path must remain beneath QORE_GFS_OUTPUT_ROOT.')
  }
  return filePath
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

function isCoolingSeason(dateText) {
  const month = Number(dateText.slice(5, 7))
  return month >= 5 && month <= 9
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
        'User-Agent': sourceConfig.userAgent,
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

async function fetchJson(url) {
  const response = await fetchWithTimeout(url)
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`)
  return JSON.parse(text)
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

async function fetchForecastIndex(issueDate, fhr) {
  const bases = process.env.QORE_GFS_OBJECT_BASE
    ? [process.env.QORE_GFS_OBJECT_BASE]
    : sourceConfig.objectBases(issueDate, fhr)
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
  if (targetIndex === -1) throw new Error(`Could not find TMP:2 m above ground in ${forecastSource} index.`)
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
  if (!Number.isFinite(valueK)) {
    throw new Error(`Portable GRIB decoder did not produce a finite value for ${location.id}.`)
  }
  return {
    valueF: kelvinToFahrenheit(valueK),
    nearestGridLatitude: message.latlng.latitude[row],
    nearestGridLongitude: message.latlng.longitude[col] > 180 ? message.latlng.longitude[col] - 360 : message.latlng.longitude[col],
  }
}

function gribSigned16(value) {
  return value & 0x8000 ? -(value & 0x7fff) : value
}

function firstPortableFieldSections(bytes) {
  const messageStart = bytes.indexOf('GRIB')
  if (messageStart < 0 || bytes[messageStart + 7] !== 2) {
    throw new Error('Portable GRIB decoder expected a GRIB2 message.')
  }
  const declaredLength = Number(bytes.readBigUInt64BE(messageStart + 8))
  const messageEnd = messageStart + declaredLength
  if (!Number.isSafeInteger(declaredLength) || messageEnd > bytes.length) {
    throw new Error('Portable GRIB2 message is truncated or too large to decode safely.')
  }

  const sections = new Map()
  let offset = messageStart + 16
  while (offset + 4 <= messageEnd && bytes.toString('ascii', offset, offset + 4) !== '7777') {
    if (offset + 5 > messageEnd) throw new Error('Portable GRIB2 section header is truncated.')
    const length = bytes.readUInt32BE(offset)
    const number = bytes[offset + 4]
    if (length < 5 || offset + length > messageEnd) {
      throw new Error(`Portable GRIB2 section ${number} has an invalid length.`)
    }
    sections.set(number, { offset, length })
    offset += length
    if (number === 7) break
  }
  return sections
}

function readPackedUnsigned(bytes, start, bitOffset, bitCount) {
  let value = 0
  for (let bit = 0; bit < bitCount; bit += 1) {
    const absoluteBit = bitOffset + bit
    const byteOffset = start + Math.floor(absoluteBit / 8)
    if (byteOffset >= bytes.length) throw new Error('Portable GRIB2 packed data is truncated.')
    value = value * 2 + ((bytes[byteOffset] >> (7 - (absoluteBit % 8))) & 1)
  }
  return value
}

function decodeSimplePackedData(bytes, gridPointCount) {
  const sections = firstPortableFieldSections(bytes)
  const section5 = sections.get(5)
  const section6 = sections.get(6)
  const section7 = sections.get(7)
  if (!section5 || !section6 || !section7) {
    throw new Error('Portable GRIB2 simple-packing decode requires sections 5, 6, and 7.')
  }
  if (section5.length < 21 || section6.length < 6 || section7.length < 5) {
    throw new Error('Portable GRIB2 simple-packing sections are truncated.')
  }
  const template = bytes.readUInt16BE(section5.offset + 9)
  if (template !== 0) {
    throw new Error(`Portable GRIB2 data representation template ${template} is not decoded by the fallback.`)
  }

  const packedPointCount = bytes.readUInt32BE(section5.offset + 5)
  const referenceValue = bytes.readFloatBE(section5.offset + 11)
  const binaryScale = gribSigned16(bytes.readUInt16BE(section5.offset + 15))
  const decimalScale = gribSigned16(bytes.readUInt16BE(section5.offset + 17))
  const bitsPerValue = bytes[section5.offset + 19]
  if (bitsPerValue > 53) throw new Error(`Portable GRIB2 simple packing uses unsupported ${bitsPerValue}-bit values.`)
  if (packedPointCount * bitsPerValue > (section7.length - 5) * 8) {
    throw new Error('Portable GRIB2 simple-packed values exceed the data section.')
  }

  const dataStart = section7.offset + 5
  const packedValues = Array.from({ length: packedPointCount }, (_, index) => {
    const packedValue = bitsPerValue ? readPackedUnsigned(bytes, dataStart, index * bitsPerValue, bitsPerValue) : 0
    return (referenceValue + packedValue * (2 ** binaryScale)) * (10 ** -decimalScale)
  })

  const bitmapIndicator = bytes[section6.offset + 5]
  if (bitmapIndicator === 255) {
    if (packedPointCount !== gridPointCount) {
      throw new Error(`Portable GRIB2 point count ${packedPointCount} does not match grid size ${gridPointCount}.`)
    }
    return packedValues
  }
  if (bitmapIndicator !== 0) {
    throw new Error(`Portable GRIB2 bitmap indicator ${bitmapIndicator} is unsupported.`)
  }
  if (gridPointCount > (section6.length - 6) * 8) {
    throw new Error('Portable GRIB2 bitmap is shorter than the decoded grid.')
  }

  const bitmapStart = section6.offset + 6
  const data = new Array(gridPointCount)
  let packedIndex = 0
  for (let index = 0; index < gridPointCount; index += 1) {
    const present = readPackedUnsigned(bytes, bitmapStart, index, 1) === 1
    data[index] = present ? packedValues[packedIndex++] : Number.NaN
  }
  if (packedIndex !== packedValues.length) {
    throw new Error('Portable GRIB2 bitmap does not match the packed point count.')
  }
  return data
}

function parsePortableMessage(bytes) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  let parsed = null
  let parseError = null
  portableGrib.readData(arrayBuffer, (error, messages) => {
    parseError = error
    parsed = messages
  })
  if (parseError) throw parseError
  const field = parsed?.[0]?.fields?.[0]
  if (!field) return null
  const grid = field.grid?.definition ?? {}
  const rows = Number(grid.nj ?? grid.ny)
  const cols = Number(grid.ni ?? grid.nx)
  const latitudeStep = Math.abs(Number(grid.dj ?? grid.dy))
  const longitudeStep = Math.abs(Number(grid.di ?? grid.dx))
  const latitudeStart = Number(grid.la1)
  const longitudeStart = Number(grid.lo1)
  const gridPointCount = rows * cols
  const data = field.data ?? decodeSimplePackedData(bytes, gridPointCount)
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0 || data.length !== gridPointCount) {
    throw new Error(`Portable GRIB decoder returned an invalid grid (${rows}x${cols}, ${data.length} values).`)
  }
  return {
    gridShape: { rows, cols },
    data,
    latlng: {
      latitude: Array.from({ length: rows }, (_, index) => latitudeStart - index * latitudeStep),
      longitude: Array.from({ length: cols }, (_, index) => longitudeStart + index * longitudeStep),
    },
  }
}

function parseFirstMessage(bytes) {
  if (usePortableGribParser) return parsePortableMessage(bytes)
  return nativeGrib.parseMessagesFromBuffer(bytes)[0] ?? null
}

async function fetchForecastSamples(issueDate, fhr) {
  if (sourceConfig.openMeteoModel) {
    const url = new URL('https://single-runs-api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', locations.map((location) => location.latitude).join(','))
    url.searchParams.set('longitude', locations.map((location) => location.longitude).join(','))
    url.searchParams.set('run', `${issueDate}T${runHour}:00`)
    url.searchParams.set('hourly', 'temperature_2m')
    url.searchParams.set('models', sourceConfig.openMeteoModel)
    url.searchParams.set('temperature_unit', 'fahrenheit')
    url.searchParams.set('forecast_days', '16')
    url.searchParams.set('timezone', 'UTC')
    const json = await fetchWithRetry(`Open-Meteo ${forecastSource} ${issueDate}`, () => fetchJson(url))
    const responses = Array.isArray(json) ? json : [json]
    const validTime = new Date(Date.parse(`${issueDate}T${runHour}:00:00Z`) + fhr * 3600000).toISOString().slice(0, 16)
    return {
      sourceUrl: url.toString(),
      indexUrl: '',
      indexLine: '',
      samples: Object.fromEntries(locations.map((location, index) => {
        const response = responses[index] ?? responses[0]
        const timeIndex = response?.hourly?.time?.indexOf(validTime) ?? -1
        const valueF = Number(response?.hourly?.temperature_2m?.[timeIndex])
        if (timeIndex < 0 || !Number.isFinite(valueF)) throw new Error(`Open-Meteo ${forecastSource} response omitted ${validTime} for ${location.id}`)
        return [location.id, {
          valueF,
          nearestGridLatitude: response.latitude ?? location.latitude,
          nearestGridLongitude: response.longitude ?? location.longitude,
        }]
      })),
    }
  }
  const { gribUrl, idxUrl, text } = await fetchForecastIndex(issueDate, fhr)
  const { start, end, indexLine } = targetRangeFromIndex(text)
  const bytes = await fetchWithRetry(`grib ${gribUrl}`, () => fetchRange(gribUrl, start, end))
  const message = parseFirstMessage(bytes)
  if (!message) throw new Error(`Could not parse ${forecastSource} GRIB message from ${gribUrl}`)
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
    console.warn(`${forecastSource} calendar resume pruned ${prunedKeys.size} incomplete output groups`)
  }

  return { completeKeys, prunedKeys }
}

function buildWorkItems(doneKeys, options = {}) {
  const { includeDone = false } = options
  const items = []
  for (const issueDate of datesBetween(startDate, issueEndDate)) {
    for (const leadDay of leadDays) {
      const targetDate = addDays(issueDate, leadDay)
      if (targetDate > endDate) continue
      if (heatingSeasonOnly && !isHeatingSeason(targetDate)) continue
      if (coolingSeasonOnly && !isCoolingSeason(targetDate)) continue
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
      modelId: sourceConfig.modelId(),
      locationId: location.id,
      region: location.region,
      weight: location.weight,
      forecastMeanF: round(forecastMeanF, 3),
      normalMeanF: round(normalMeanF, 3),
      forecastAnomalyF: round(forecastMeanF - normalMeanF, 3),
      sampledValidHoursUtc: validHoursUtc.join('|'),
      nearestGridLatitude: nearest.nearestGridLatitude,
      nearestGridLongitude: nearest.nearestGridLongitude,
      source: sourceConfig.source,
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
    modelId: sourceConfig.modelId(),
    weightedAnomalyF: round(weightedAnomalyF, 3),
    coveragePct: round(coveragePct, 3),
    extremeCount: locationRows.filter((row) => row.forecastAnomalyF <= arcticBlastThresholds.extremeAnomalyF).length,
    sampledWeight: round(sampledWeight, 3),
    locationCount: locationRows.length,
    sampledValidHoursUtc: validHoursUtc.join('|'),
    qualifies:
      weightedAnomalyF <= arcticBlastThresholds.coldAnomalyF &&
      coveragePct >= arcticBlastThresholds.minCoveragePct,
    source: sourceConfig.source,
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
        console.warn(`${forecastSource} calendar failed: ${item.issueDate} lead ${item.leadDays}: ${error.message}`)
      }
      completed += 1
      if (completed % 25 === 0 || completed === items.length) {
        console.log(`${forecastSource} calendar progress: ${completed}/${items.length} items (${failures.length} failures)`)
      }
    }
  }

  console.log(
    `${forecastSource} calendar start: ${items.length} items, range ${startDate}..${endDate}, leads ${leadDays.join(',')}, valid hours ${validHoursUtc.join(',')}, concurrency ${concurrency}`,
  )
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  await writeQueue

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: sourceConfig.source,
    forecastSource,
    range: { startDate, issueEndDate, targetEndDate: endDate },
    runHour,
    leadDays,
    validHoursUtc,
    heatingSeasonOnly,
    coolingSeasonOnly,
    allowPartial,
    modelId: sourceConfig.modelId(),
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
  console.log(`${forecastSource} calendar manifest written: ${path.relative(repoDir, manifestPath)}`)
  if (failures.length && !allowPartial) {
    console.error(
      `${forecastSource} calendar incomplete: ${failures.length} failures. Set QORE_GFS_ALLOW_PARTIAL=1 to keep a zero exit code for partial exploratory runs.`,
    )
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
