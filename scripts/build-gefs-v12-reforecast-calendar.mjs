#!/usr/bin/env node
import crypto from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import {
  GEFS_V12_REFORECAST_CONTRACT,
  GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
  addUtcDays,
  assertBoundRecord,
  bindRecordDigest,
  digestCanonicalJson,
  gefsV12ReforecastObjectUrls,
  issueDatesForReforecast,
  parseGeFsv12TemperatureRanges,
  validateReforecastMembers,
  validatedIsoDate,
} from './lib/qore-gefs-v12-reforecast.mjs'
import {
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT,
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
  reviewedSummerNormalMeanF,
} from './lib/qore-summer-forecast-contract.mjs'
import { SUMMER_FORECAST_LOCATIONS } from './lib/qore-summer-location-universe.mjs'

const require = createRequire(import.meta.url)
const grib = require('@mattnucc/gribberish')
const repoRoot = process.cwd()
const defaultOutputDir = path.join(repoRoot, '.local/qore/research/gefs-v12-reforecast')
const outputDir = path.resolve(process.env.QORE_GEFS_REFORECAST_OUTPUT_DIR ?? defaultOutputDir)
const recordsPath = path.join(outputDir, 'issue-member-records.jsonl')
const failuresPath = path.join(outputDir, 'failures.jsonl')
const manifestPath = path.join(outputDir, 'manifest.json')
const startDate = validatedIsoDate(process.env.QORE_GEFS_REFORECAST_START ?? '2007-04-18', 'startDate')
const endDate = validatedIsoDate(process.env.QORE_GEFS_REFORECAST_END ?? '2019-12-24', 'endDate')
const members = validateReforecastMembers(
  String(process.env.QORE_GEFS_REFORECAST_MEMBERS ?? GEFS_V12_REFORECAST_CONTRACT.defaultMembers.join(','))
    .split(',').map((value) => value.trim()).filter(Boolean),
)
const seasons = String(process.env.QORE_GEFS_REFORECAST_SEASONS ?? 'summer,winter')
  .split(',').map((value) => value.trim()).filter(Boolean)
const resume = truthy(process.env.QORE_GEFS_REFORECAST_RESUME)
const replace = truthy(process.env.QORE_GEFS_REFORECAST_REPLACE)
const concurrency = validatedPositiveInteger(process.env.QORE_GEFS_REFORECAST_CONCURRENCY ?? 2, 'concurrency')
const maxItems = validatedNonNegativeInteger(process.env.QORE_GEFS_REFORECAST_MAX_ITEMS ?? 0, 'maxItems')
const timeoutMs = validatedPositiveInteger(process.env.QORE_GEFS_REFORECAST_TIMEOUT_MS ?? 30_000, 'timeoutMs')

if (startDate > endDate) throw new Error('QORE_GEFS_REFORECAST_START must not be after the end date.')
if (startDate < GEFS_V12_REFORECAST_CONTRACT.archive.archivePeriod[0] || endDate > '2019-12-24') {
  throw new Error('GEFS issue dates must remain inside 2000-01-01 through 2019-12-24 so the day-7 target stays in the archive period.')
}
if (resume && replace) throw new Error('Set only one of QORE_GEFS_REFORECAST_RESUME and QORE_GEFS_REFORECAST_REPLACE.')

const configuration = {
  contractDigestSha256: GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
  startDate,
  endDate,
  members,
  seasons,
  forecastHours: GEFS_V12_REFORECAST_CONTRACT.forecastHours,
  locationUniverseContractId: GEFS_V12_REFORECAST_CONTRACT.locationUniverse.contractId,
}
const configurationDigestSha256 = digestCanonicalJson(configuration)
const implementationDigests = {
  collectorSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  contractLibrarySha256: sha256(await readFile(fileURLToPath(new URL('./lib/qore-gefs-v12-reforecast.mjs', import.meta.url)))),
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function validatedPositiveInteger(value, label) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`)
  return parsed
}

function validatedNonNegativeInteger(value, label) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer.`)
  return parsed
}

function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function sha256File(filePath) {
  if (!existsSync(filePath)) return null
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}

function nearestIndex(values, target, circular = false) {
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  values.forEach((value, index) => {
    const direct = Math.abs(Number(value) - target)
    const distance = circular ? Math.min(direct, 360 - direct) : direct
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  if (bestIndex < 0) throw new Error('GRIB grid coordinate array was empty.')
  return bestIndex
}

function sampleLocations(bytes) {
  const message = grib.parseMessagesFromBuffer(bytes)[0]
  if (!message) throw new Error('GRIB range did not decode to a message.')
  const rows = Number(message.gridShape?.rows)
  const cols = Number(message.gridShape?.cols)
  const latitudes = message.latlng?.latitude ?? []
  const longitudes = message.latlng?.longitude ?? []
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0 || message.data?.length !== rows * cols) {
    throw new Error('GEFS GRIB grid shape or data length is invalid.')
  }
  if (latitudes.length !== rows || longitudes.length !== cols) {
    throw new Error('GEFS GRIB coordinate vectors do not match the grid shape.')
  }
  return {
    grid: { rows, cols },
    locations: SUMMER_FORECAST_LOCATIONS.map((location) => {
      const normalizedLongitude = location.longitude < 0 ? location.longitude + 360 : location.longitude
      const row = nearestIndex(latitudes, location.latitude)
      const col = nearestIndex(longitudes, normalizedLongitude, true)
      const valueK = Number(message.data[row * cols + col])
      if (!Number.isFinite(valueK) || valueK < 180 || valueK > 340) {
        throw new Error(`GEFS 2 m temperature for ${location.id} is outside the physical Kelvin range.`)
      }
      const nearestLongitude = Number(longitudes[col]) > 180 ? Number(longitudes[col]) - 360 : Number(longitudes[col])
      return {
        locationId: location.id,
        valueF: round((valueK - 273.15) * 1.8 + 32, 3),
        nearestGridLatitude: Number(latitudes[row]),
        nearestGridLongitude: nearestLongitude,
      }
    }),
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      headers: { 'User-Agent': 'QORE GEFSv12 fixed-model reforecast research', ...(options.headers ?? {}) },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function withRetry(label, fn, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'unknown failure'}`)
}

async function fetchIndex(indexUrl) {
  const response = await fetchWithTimeout(indexUrl)
  const text = await response.text()
  if (!response.ok) throw new Error(`index HTTP ${response.status}: ${text.slice(0, 120)}`)
  return text
}

async function fetchBoundedRange(sourceUrl, range) {
  const response = await fetchWithTimeout(sourceUrl, { headers: { Range: `bytes=${range.start}-${range.end}` } })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (response.status !== 206) {
    throw new Error(`range request returned HTTP ${response.status}; refusing a potentially unbounded object response`)
  }
  if (bytes.length !== range.length) {
    throw new Error(`range returned ${bytes.length} bytes, expected ${range.length}`)
  }
  const contentRange = response.headers.get('content-range') ?? ''
  if (!contentRange.startsWith(`bytes ${range.start}-${range.end}/`)) {
    throw new Error(`range response did not bind the requested offsets: ${contentRange || '(missing)'}`)
  }
  return bytes
}

async function collectIssueMember(item) {
  const { issueDate, targetDate, season, member } = item
  const { sourceUrl, indexUrl, objectPath } = gefsV12ReforecastObjectUrls(issueDate, member)
  const indexText = await withRetry(indexUrl, () => fetchIndex(indexUrl))
  const ranges = parseGeFsv12TemperatureRanges(indexText)
  const indexPayloadDigestSha256 = sha256(indexText)
  const decodedSamples = []
  for (const [offsetIndex, range] of ranges.entries()) {
    const bytes = await withRetry(`${sourceUrl} f${range.forecastHour}`, () => fetchBoundedRange(sourceUrl, range))
    decodedSamples.push({
      range,
      sourcePayloadDigestSha256: sha256(bytes),
      decoded: sampleLocations(bytes),
      offsetHours: GEFS_V12_REFORECAST_CONTRACT.targetOffsetsHours[offsetIndex],
    })
  }
  const firstGrid = decodedSamples[0].decoded.grid
  if (decodedSamples.some((sample) => sample.decoded.grid.rows !== firstGrid.rows || sample.decoded.grid.cols !== firstGrid.cols)) {
    throw new Error('GEFS sample grid shape changed within one issue/member record.')
  }
  const locations = SUMMER_FORECAST_LOCATIONS.map((location) => {
    const sampled = decodedSamples.map((sample) => {
      const value = sample.decoded.locations.find((candidate) => candidate.locationId === location.id)
      if (!value) throw new Error(`Decoded sample omitted ${location.id}.`)
      return value
    })
    const sampleValuesF = sampled.map((value) => value.valueF)
    const forecastMeanF = round(sampleValuesF.reduce((sum, value) => sum + value, 0) / sampleValuesF.length, 3)
    const normalMeanF = reviewedSummerNormalMeanF({ locationId: location.id, targetDate })
    const payload = {
      locationId: location.id,
      weight: location.weight,
      sampleValuesF,
      forecastMeanF,
      normalMeanF,
      forecastAnomalyF: round(forecastMeanF - normalMeanF, 3),
      nearestGridLatitude: sampled[0].nearestGridLatitude,
      nearestGridLongitude: sampled[0].nearestGridLongitude,
      normalSourcePayloadDigestSha256:
        SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.payloadDigestSha256ByLocationId[location.id],
    }
    return { ...payload, locationVectorDigestSha256: digestCanonicalJson(payload) }
  })
  return bindRecordDigest({
    schemaVersion: 1,
    contractId: GEFS_V12_REFORECAST_CONTRACT.contractId,
    contractDigestSha256: GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
    issueDate,
    targetDate,
    season,
    member,
    modelId: `noaa-gefs-v12-fixed-reforecast-${member}`,
    runHourUtc: '00',
    leadDays: GEFS_V12_REFORECAST_CONTRACT.leadDays,
    forecastTemporalContractId: GEFS_V12_REFORECAST_CONTRACT.summerTemporalContractId,
    targetOffsetsHours: GEFS_V12_REFORECAST_CONTRACT.targetOffsetsHours,
    forecastHours: GEFS_V12_REFORECAST_CONTRACT.forecastHours,
    sourceUrl,
    indexUrl,
    objectPath,
    indexPayloadDigestSha256,
    normalSourceContractId: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.contractId,
    normalSourceContractDigestSha256: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
    grid: firstGrid,
    samples: decodedSamples.map((sample) => ({
      offsetHours: sample.offsetHours,
      forecastHour: sample.range.forecastHour,
      validTimeUtc: `${addUtcDays(targetDate, sample.offsetHours === 24 ? 1 : 0)}T${String(sample.offsetHours % 24).padStart(2, '0')}:00Z`,
      byteStart: sample.range.start,
      byteEnd: sample.range.end,
      byteLength: sample.range.length,
      indexLine: sample.range.indexLine,
      indexPayloadDigestSha256,
      sourcePayloadDigestSha256: sample.sourcePayloadDigestSha256,
    })),
    locations,
  })
}

async function existingCompletedKeys() {
  if (!existsSync(recordsPath)) return new Set()
  const text = await readFile(recordsPath, 'utf8')
  const keys = new Set()
  for (const [index, line] of text.split(/\r?\n/).filter(Boolean).entries()) {
    let record
    try {
      record = JSON.parse(line)
      assertBoundRecord(record)
    } catch (error) {
      throw new Error(`Cannot resume: record line ${index + 1} is invalid: ${error.message}`)
    }
    const key = `${record.issueDate}|${record.member}`
    if (keys.has(key)) throw new Error(`Cannot resume: duplicate record key ${key}.`)
    keys.add(key)
  }
  return keys
}

async function prepareOutput() {
  await mkdir(outputDir, { recursive: true })
  if (replace) {
    for (const filePath of [recordsPath, failuresPath, manifestPath]) {
      if (existsSync(filePath)) await unlink(filePath)
    }
  }
  if (!resume && !replace && [recordsPath, failuresPath, manifestPath].some(existsSync)) {
    throw new Error('Reforecast output already exists. Set QORE_GEFS_REFORECAST_RESUME=1 or use a new output directory.')
  }
  if (resume && existsSync(manifestPath)) {
    const prior = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (prior.configurationDigestSha256 !== configurationDigestSha256) {
      throw new Error('Cannot resume: the requested configuration does not match the existing manifest.')
    }
  }
}

async function writeManifest({ planCount, attemptedThisRun, completedKeys, failures, startedAt }) {
  const recordsDigest = await sha256File(recordsPath)
  const recordsBytes = existsSync(recordsPath) ? (await stat(recordsPath)).size : 0
  const complete = completedKeys.size === planCount && failures.length === 0 && maxItems === 0
  const manifest = {
    schemaVersion: 1,
    datasetId: 'qore-gefs-v12-fixed-model-reforecast-local-v1',
    researchOnly: true,
    productionPromotionEligible: false,
    status: complete ? 'complete' : 'partial',
    complete,
    startedAt,
    completedAt: new Date().toISOString(),
    contract: GEFS_V12_REFORECAST_CONTRACT,
    contractDigestSha256: GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
    configuration,
    configurationDigestSha256,
    implementationDigests,
    planCount,
    attemptedThisRun,
    completedCount: completedKeys.size,
    failureCountThisRun: failures.length,
    output: {
      recordsPath: path.relative(repoRoot, recordsPath),
      recordsBytes,
      recordsDigestSha256: recordsDigest,
      rawGribRetained: false,
      acquisition: 'one index request and four HTTP byte ranges per issue/member',
    },
    limitations: [
      GEFS_V12_REFORECAST_CONTRACT.archive.historicalAvailabilityCaveat,
      'The default c00 run is a control-member screen; rerun with c00,p01,p02,p03,p04 for ensemble confirmation.',
      'This local dataset is not a production strategy artifact and cannot enable paper or live trading.',
    ],
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function main() {
  await prepareOutput()
  const startedAt = new Date().toISOString()
  const completedKeys = await existingCompletedKeys()
  const issueDates = issueDatesForReforecast({ startDate, endDate, seasons })
  const plan = issueDates.flatMap((issue) => members.map((member) => ({ ...issue, member })))
  const planKeys = new Set(plan.map((item) => `${item.issueDate}|${item.member}`))
  const outside = [...completedKeys].filter((key) => !planKeys.has(key))
  if (outside.length) throw new Error(`Cannot resume: ${outside.length} existing records are outside the requested plan.`)
  let pending = plan.filter((item) => !completedKeys.has(`${item.issueDate}|${item.member}`))
  if (maxItems > 0) pending = pending.slice(0, maxItems)
  const failures = []
  let attemptedThisRun = 0

  for (let cursor = 0; cursor < pending.length; cursor += concurrency) {
    const batch = pending.slice(cursor, cursor + concurrency)
    const results = await Promise.all(batch.map(async (item) => {
      try {
        return { item, record: await collectIssueMember(item) }
      } catch (error) {
        return { item, error }
      }
    }))
    const successes = results.filter((result) => result.record)
    if (successes.length) {
      await appendFile(recordsPath, successes.map((result) => JSON.stringify(result.record)).join('\n') + '\n')
      successes.forEach(({ item }) => completedKeys.add(`${item.issueDate}|${item.member}`))
    }
    const failed = results.filter((result) => result.error).map(({ item, error }) => ({
      issueDate: item.issueDate,
      targetDate: item.targetDate,
      member: item.member,
      error: error.message,
    }))
    if (failed.length) {
      failures.push(...failed)
      await appendFile(failuresPath, failed.map((failure) => JSON.stringify(failure)).join('\n') + '\n')
    }
    attemptedThisRun += results.length
    if (attemptedThisRun % 20 === 0 || attemptedThisRun === pending.length) {
      process.stdout.write(`GEFSv12 reforecast: ${attemptedThisRun}/${pending.length} attempted, ${completedKeys.size}/${plan.length} complete, ${failures.length} failed\n`)
    }
  }

  const manifest = await writeManifest({ planCount: plan.length, attemptedThisRun, completedKeys, failures, startedAt })
  process.stdout.write(`${manifest.status}: ${completedKeys.size}/${plan.length} issue/member records; manifest ${manifestPath}\n`)
  if (failures.length) process.exitCode = 1
}

await main()
