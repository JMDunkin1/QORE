import crypto from 'node:crypto'

import {
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT,
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
  SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
  reviewedSummerNormalMeanF,
} from './qore-summer-forecast-contract.mjs'
import {
  SUMMER_FORECAST_LOCATIONS,
  SUMMER_FORECAST_LOCATION_UNIVERSE,
} from './qore-summer-location-universe.mjs'

const DAY_MS = 86_400_000
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MIN_GEFS_TEMPERATURE_F = (180 - 273.15) * 1.8 + 32
const MAX_GEFS_TEMPERATURE_F = (340 - 273.15) * 1.8 + 32
const LOCAL_DATASET_ID = 'qore-gefs-v12-fixed-model-reforecast-local-v1'
const MERGED_DATASET_ID = 'qore-gefs-v12-fixed-model-reforecast-merged-local-v1'

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  )
}

export function digestCanonicalJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

export const GEFS_V12_REFORECAST_CONTRACT = deepFreeze({
  schemaVersion: 1,
  contractId: 'qore-gefs-v12-fixed-model-reforecast-v1',
  archive: {
    provider: 'NOAA Physical Sciences Laboratory',
    bucket: 'noaa-gefs-retrospective',
    baseUrl: 'https://noaa-gefs-retrospective.s3.amazonaws.com',
    archivePeriod: ['2000-01-01', '2019-12-31'],
    modelDescription: 'GEFSv12 retrospective forecast generated with a fixed later-vintage model',
    historicalAvailabilityCaveat:
      'This is a fixed-model retrospective forecast, not the forecast product that was available to an operator on each historical issue date.',
  },
  issueRunHourUtc: '00',
  leadDays: 7,
  targetOffsetsHours: [6, 12, 18, 24],
  forecastHours: [174, 180, 186, 192],
  temperatureField: 'TMP:2 m above ground',
  grid: '0.25-degree global',
  members: ['c00', 'p01', 'p02', 'p03', 'p04'],
  defaultMembers: ['c00'],
  seasons: {
    summer: { targetMonths: [5, 6, 7, 8, 9], demandDirection: 'hot-long' },
    winter: { targetMonths: [1, 2, 3, 11, 12], demandDirection: 'cold-long' },
  },
  locationUniverse: SUMMER_FORECAST_LOCATION_UNIVERSE,
  locationCoordinates: SUMMER_FORECAST_LOCATIONS,
  normalSourceContract: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT,
  normalSourceContractDigestSha256: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
  summerTemporalContractId: SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
  marketEvaluation: {
    instrument: 'UNG',
    execution: 'next-trading-session adjusted open; prior holdings retain close-to-open return',
    positionFraction: 0.35,
    oneWayCostBps: 3.2,
    trainEnd: '2014-12-31',
    validationStart: '2015-01-01',
    validationEnd: '2016-12-31',
    hiddenHoldoutStart: '2017-01-01',
    hiddenHoldoutEnd: '2019-12-31',
  },
  candidateFamily: {
    familyId: 'gefs-v12-physical-demand-follow-12-cell-v1',
    weightedAnomalyThresholdsF: [3, 5, 7],
    breadthThresholds: [0.25, 0.5],
    holdSessions: [1, 3],
    directionRule: 'summer hot anomaly long; winter cold anomaly long; otherwise cash',
    sizingRule: 'fixed 0.35 UNG fraction; sizing and costs are not optimized',
    selectionRule: 'highest train net Sharpe; then train net return; then lexicographic candidate id',
  },
  promotion: {
    researchOnly: true,
    productionPromotionEligible: false,
    reason:
      'The source is a later-vintage fixed-model reforecast and this narrow gas-only experiment does not reproduce the production all-year selector.',
  },
})

export const GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256 = digestCanonicalJson(
  GEFS_V12_REFORECAST_CONTRACT,
)

export function validatedIsoDate(value, label = 'date') {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be YYYY-MM-DD.`)
  const timestamp = Date.parse(`${text}T00:00:00Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be a valid calendar date.`)
  }
  return text
}

export function addUtcDays(date, days) {
  const timestamp = Date.parse(`${validatedIsoDate(date)}T00:00:00Z`)
  return new Date(timestamp + Number(days) * DAY_MS).toISOString().slice(0, 10)
}

export function seasonForTargetDate(targetDate) {
  const month = Number(validatedIsoDate(targetDate, 'targetDate').slice(5, 7))
  if (GEFS_V12_REFORECAST_CONTRACT.seasons.summer.targetMonths.includes(month)) return 'summer'
  if (GEFS_V12_REFORECAST_CONTRACT.seasons.winter.targetMonths.includes(month)) return 'winter'
  return null
}

export function issueDatesForReforecast({ startDate, endDate, seasons = ['summer', 'winter'] }) {
  const start = validatedIsoDate(startDate, 'startDate')
  const end = validatedIsoDate(endDate, 'endDate')
  if (start > end) throw new Error('startDate must not be after endDate.')
  const allowed = new Set(seasons)
  if (!allowed.size || [...allowed].some((season) => !Object.hasOwn(GEFS_V12_REFORECAST_CONTRACT.seasons, season))) {
    throw new Error('seasons must contain summer and/or winter.')
  }
  const dates = []
  for (let issueDate = start; issueDate <= end; issueDate = addUtcDays(issueDate, 1)) {
    const targetDate = addUtcDays(issueDate, GEFS_V12_REFORECAST_CONTRACT.leadDays)
    const season = seasonForTargetDate(targetDate)
    if (season && allowed.has(season)) dates.push({ issueDate, targetDate, season })
  }
  return dates
}

export function validateReforecastMembers(members) {
  if (!Array.isArray(members) || !members.length) throw new Error('At least one GEFS member is required.')
  if (new Set(members).size !== members.length) throw new Error('GEFS members must not contain duplicates.')
  const unsupported = members.filter((member) => !GEFS_V12_REFORECAST_CONTRACT.members.includes(member))
  if (unsupported.length) throw new Error(`Unsupported GEFS member(s): ${unsupported.join(', ')}.`)
  return [...members]
}

export function gefsV12ReforecastObjectUrls(issueDate, member) {
  const date = validatedIsoDate(issueDate, 'issueDate')
  validateReforecastMembers([member])
  const compact = date.replaceAll('-', '')
  const run = `${compact}00`
  const objectPath = [
    'GEFSv12',
    'reforecast',
    date.slice(0, 4),
    run,
    member,
    'Days:1-10',
    `tmp_2m_${run}_${member}.grib2`,
  ].join('/')
  const sourceUrl = `${GEFS_V12_REFORECAST_CONTRACT.archive.baseUrl}/${objectPath}`
  return { sourceUrl, indexUrl: `${sourceUrl}.idx`, objectPath }
}

export function parseGeFsv12TemperatureRanges(indexText, forecastHours = GEFS_V12_REFORECAST_CONTRACT.forecastHours) {
  const hours = [...forecastHours].map(Number)
  if (
    !hours.length
    || hours.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 240)
    || new Set(hours).size !== hours.length
  ) {
    throw new Error('forecastHours must contain unique integers from 0 through 240.')
  }
  const rows = String(indexText ?? '').trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split(':')
    const match = String(parts[5] ?? '').match(/^(\d+) hour fcst$/)
    return {
      line,
      messageNumber: Number(parts[0]),
      start: Number(parts[1]),
      variable: parts[3],
      level: parts[4],
      forecastHour: match ? Number(match[1]) : null,
    }
  })
  if (!rows.length || rows.some((row) => !Number.isSafeInteger(row.start) || row.start < 0)) {
    throw new Error('GEFS index is empty or contains an invalid byte offset.')
  }
  const ranges = hours.map((forecastHour) => {
    const index = rows.findIndex((row) =>
      row.variable === 'TMP'
      && row.level === '2 m above ground'
      && row.forecastHour === forecastHour
    )
    if (index < 0) throw new Error(`GEFS index has no 2 m temperature field for f${forecastHour}.`)
    const row = rows[index]
    const next = rows[index + 1]
    if (!next || !(next.start > row.start)) {
      throw new Error(`GEFS f${forecastHour} temperature field has no bounded next-message offset.`)
    }
    return {
      forecastHour,
      start: row.start,
      end: next.start - 1,
      length: next.start - row.start,
      messageNumber: row.messageNumber,
      indexLine: row.line,
    }
  })
  return ranges
}

export function buildTheoryFrozenCandidates() {
  const family = GEFS_V12_REFORECAST_CONTRACT.candidateFamily
  return family.weightedAnomalyThresholdsF.flatMap((anomalyThresholdF) =>
    family.breadthThresholds.flatMap((breadthThreshold) =>
      family.holdSessions.map((holdSessions) => ({
        candidateId: `a${anomalyThresholdF}-b${String(breadthThreshold).replace('.', 'p')}-h${holdSessions}`,
        anomalyThresholdF,
        breadthThreshold,
        holdSessions,
        positionFraction: GEFS_V12_REFORECAST_CONTRACT.marketEvaluation.positionFraction,
      })),
    ),
  )
}

export function splitForMarketDate(date) {
  const value = validatedIsoDate(date, 'market date')
  const market = GEFS_V12_REFORECAST_CONTRACT.marketEvaluation
  if (value <= market.trainEnd) return 'train'
  if (value >= market.validationStart && value <= market.validationEnd) return 'validation'
  if (value >= market.hiddenHoldoutStart && value <= market.hiddenHoldoutEnd) return 'holdout'
  return 'outside'
}

export function bindRecordDigest(record) {
  const payload = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'recordDigestSha256'))
  return { ...payload, recordDigestSha256: digestCanonicalJson(payload) }
}

function sameArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function rounded(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`)
  return value
}

function assertSha256(value, label) {
  if (!SHA256_PATTERN.test(String(value ?? ''))) throw new Error(`${label} must be a lowercase SHA-256 digest.`)
  return value
}

function assertImplementationDigests(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must identify the collector and contract-library implementations.`)
  }
  assertSha256(value.collectorSha256, `${label}.collectorSha256`)
  assertSha256(value.contractLibrarySha256, `${label}.contractLibrarySha256`)
  return {
    collectorSha256: value.collectorSha256,
    contractLibrarySha256: value.contractLibrarySha256,
  }
}

function expectedValidTimeUtc(targetDate, offsetHours) {
  const hour = offsetHours % 24
  const date = addUtcDays(targetDate, offsetHours === 24 ? 1 : 0)
  return `${date}T${String(hour).padStart(2, '0')}:00Z`
}

export function assertBoundRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Reforecast record must be an object.')
  }
  if (record?.schemaVersion !== 1) throw new Error('Reforecast record schemaVersion must equal 1.')
  if (record.contractId !== GEFS_V12_REFORECAST_CONTRACT.contractId) {
    throw new Error('Reforecast record contractId does not match the reviewed contract.')
  }
  if (record?.contractDigestSha256 !== GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256) {
    throw new Error('Reforecast record contract digest does not match the reviewed contract.')
  }
  const expected = bindRecordDigest(record).recordDigestSha256
  if (record.recordDigestSha256 !== expected) throw new Error('Reforecast record digest mismatch.')
  if (!GEFS_V12_REFORECAST_CONTRACT.members.includes(record.member)) throw new Error('Reforecast record member is invalid.')
  const issueDate = validatedIsoDate(record.issueDate, 'Reforecast record issueDate')
  const targetDate = validatedIsoDate(record.targetDate, 'Reforecast record targetDate')
  const [archiveStart, archiveEnd] = GEFS_V12_REFORECAST_CONTRACT.archive.archivePeriod
  if (issueDate < archiveStart || targetDate > archiveEnd) {
    throw new Error('Reforecast record issue/target dates fall outside the reviewed archive period.')
  }
  if (targetDate !== addUtcDays(issueDate, GEFS_V12_REFORECAST_CONTRACT.leadDays)) {
    throw new Error('Reforecast record targetDate is not issueDate plus seven days.')
  }
  if (record.season !== seasonForTargetDate(targetDate)) throw new Error('Reforecast record season is invalid.')
  if (record.modelId !== `noaa-gefs-v12-fixed-reforecast-${record.member}`) {
    throw new Error('Reforecast record modelId is invalid for its member.')
  }
  if (record.runHourUtc !== GEFS_V12_REFORECAST_CONTRACT.issueRunHourUtc) {
    throw new Error('Reforecast record runHourUtc is invalid.')
  }
  if (record.leadDays !== GEFS_V12_REFORECAST_CONTRACT.leadDays) {
    throw new Error('Reforecast record leadDays is invalid.')
  }
  if (record.forecastTemporalContractId !== GEFS_V12_REFORECAST_CONTRACT.summerTemporalContractId) {
    throw new Error('Reforecast record temporal contract is invalid.')
  }
  if (!sameArray(record.targetOffsetsHours, GEFS_V12_REFORECAST_CONTRACT.targetOffsetsHours)) {
    throw new Error('Reforecast record target offsets do not match the reviewed temporal contract.')
  }
  if (!sameArray(record.forecastHours, GEFS_V12_REFORECAST_CONTRACT.forecastHours)) {
    throw new Error('Reforecast record forecast hours do not match the reviewed temporal contract.')
  }
  const expectedUrls = gefsV12ReforecastObjectUrls(issueDate, record.member)
  for (const field of ['sourceUrl', 'indexUrl', 'objectPath']) {
    if (record[field] !== expectedUrls[field]) throw new Error(`Reforecast record ${field} is invalid.`)
  }
  assertSha256(record.indexPayloadDigestSha256, 'Reforecast record indexPayloadDigestSha256')
  if (record.normalSourceContractId !== SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.contractId) {
    throw new Error('Reforecast record normal source contractId is invalid.')
  }
  if (record.normalSourceContractDigestSha256 !== SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256) {
    throw new Error('Reforecast record normal source contract digest is invalid.')
  }
  if (record.grid?.rows !== 721 || record.grid?.cols !== 1440) {
    throw new Error('Reforecast record grid must be the reviewed 721-by-1440 global grid.')
  }
  if (!Array.isArray(record.samples) || record.samples.length !== GEFS_V12_REFORECAST_CONTRACT.forecastHours.length) {
    throw new Error('Reforecast record must contain four bounded sample provenance entries.')
  }
  let priorByteEnd = -1
  record.samples.forEach((sample, index) => {
    const offsetHours = GEFS_V12_REFORECAST_CONTRACT.targetOffsetsHours[index]
    const forecastHour = GEFS_V12_REFORECAST_CONTRACT.forecastHours[index]
    if (sample?.offsetHours !== offsetHours || sample?.forecastHour !== forecastHour) {
      throw new Error(`Reforecast sample ${index + 1} is not in reviewed offset/forecast-hour order.`)
    }
    if (sample.validTimeUtc !== expectedValidTimeUtc(targetDate, offsetHours)) {
      throw new Error(`Reforecast sample ${index + 1} validTimeUtc is invalid.`)
    }
    if (
      !Number.isSafeInteger(sample.byteStart)
      || !Number.isSafeInteger(sample.byteEnd)
      || !Number.isSafeInteger(sample.byteLength)
      || sample.byteStart < 0
      || sample.byteEnd < sample.byteStart
      || sample.byteLength !== sample.byteEnd - sample.byteStart + 1
      || sample.byteStart <= priorByteEnd
    ) {
      throw new Error(`Reforecast sample ${index + 1} has invalid or overlapping byte bounds.`)
    }
    priorByteEnd = sample.byteEnd
    const parts = String(sample.indexLine ?? '').split(':')
    if (
      !Number.isSafeInteger(Number(parts[0]))
      || Number(parts[0]) < 1
      || Number(parts[1]) !== sample.byteStart
      || parts[2] !== `d=${issueDate.replaceAll('-', '')}${GEFS_V12_REFORECAST_CONTRACT.issueRunHourUtc}`
      || parts[3] !== 'TMP'
      || parts[4] !== '2 m above ground'
      || parts[5] !== `${forecastHour} hour fcst`
    ) {
      throw new Error(`Reforecast sample ${index + 1} indexLine is not bound to the expected field.`)
    }
    if (sample.indexPayloadDigestSha256 !== record.indexPayloadDigestSha256) {
      throw new Error(`Reforecast sample ${index + 1} index digest differs from its record.`)
    }
    assertSha256(sample.sourcePayloadDigestSha256, `Reforecast sample ${index + 1} sourcePayloadDigestSha256`)
  })
  if (!Array.isArray(record.locations) || record.locations.length !== SUMMER_FORECAST_LOCATIONS.length) {
    throw new Error('Reforecast record must contain the exact 18-location basket.')
  }
  const ids = record.locations.map((location) => location.locationId)
  if (!sameArray(ids, SUMMER_FORECAST_LOCATIONS.map((location) => location.id))) {
    throw new Error('Reforecast record location identities/order do not match the exact basket.')
  }
  record.locations.forEach((location, index) => {
    const reviewedLocation = SUMMER_FORECAST_LOCATIONS[index]
    if (location.weight !== reviewedLocation.weight) {
      throw new Error(`Reforecast location ${reviewedLocation.id} weight is invalid.`)
    }
    if (!Array.isArray(location.sampleValuesF) || location.sampleValuesF.length !== record.samples.length) {
      throw new Error(`Reforecast location ${reviewedLocation.id} must contain four sample values.`)
    }
    location.sampleValuesF.forEach((value, sampleIndex) => {
      assertFiniteNumber(value, `Reforecast location ${reviewedLocation.id} sample ${sampleIndex + 1}`)
      if (value < MIN_GEFS_TEMPERATURE_F - 0.001 || value > MAX_GEFS_TEMPERATURE_F + 0.001) {
        throw new Error(`Reforecast location ${reviewedLocation.id} sample ${sampleIndex + 1} is outside the physical temperature range.`)
      }
    })
    const expectedMean = rounded(
      location.sampleValuesF.reduce((sum, value) => sum + value, 0) / location.sampleValuesF.length,
      3,
    )
    assertFiniteNumber(location.forecastMeanF, `Reforecast location ${reviewedLocation.id} forecastMeanF`)
    if (location.forecastMeanF !== expectedMean) {
      throw new Error(`Reforecast location ${reviewedLocation.id} forecastMeanF does not reproduce its samples.`)
    }
    const expectedNormal = reviewedSummerNormalMeanF({ locationId: reviewedLocation.id, targetDate })
    if (location.normalMeanF !== expectedNormal) {
      throw new Error(`Reforecast location ${reviewedLocation.id} normalMeanF does not match the reviewed normal.`)
    }
    assertFiniteNumber(location.forecastAnomalyF, `Reforecast location ${reviewedLocation.id} forecastAnomalyF`)
    if (location.forecastAnomalyF !== rounded(expectedMean - expectedNormal, 3)) {
      throw new Error(`Reforecast location ${reviewedLocation.id} forecastAnomalyF does not reproduce its inputs.`)
    }
    const nearestLatitude = assertFiniteNumber(
      location.nearestGridLatitude,
      `Reforecast location ${reviewedLocation.id} nearestGridLatitude`,
    )
    const nearestLongitude = assertFiniteNumber(
      location.nearestGridLongitude,
      `Reforecast location ${reviewedLocation.id} nearestGridLongitude`,
    )
    const longitudeDistance = Math.abs(nearestLongitude - reviewedLocation.longitude)
    if (
      Math.abs(nearestLatitude - reviewedLocation.latitude) > 0.126
      || Math.min(longitudeDistance, 360 - longitudeDistance) > 0.126
    ) {
      throw new Error(`Reforecast location ${reviewedLocation.id} nearest grid point is invalid.`)
    }
    const expectedNormalPayloadDigest =
      SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.payloadDigestSha256ByLocationId[reviewedLocation.id]
    if (location.normalSourcePayloadDigestSha256 !== expectedNormalPayloadDigest) {
      throw new Error(`Reforecast location ${reviewedLocation.id} normal payload digest is invalid.`)
    }
    const vectorPayload = Object.fromEntries(
      Object.entries(location).filter(([key]) => key !== 'locationVectorDigestSha256'),
    )
    if (location.locationVectorDigestSha256 !== digestCanonicalJson(vectorPayload)) {
      throw new Error(`Reforecast location ${reviewedLocation.id} vector digest mismatch.`)
    }
  })
  return record
}

function validateDatasetConfiguration(configuration) {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new Error('Reforecast manifest configuration is missing.')
  }
  if (configuration.contractDigestSha256 !== GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256) {
    throw new Error('Reforecast manifest configuration contract digest is invalid.')
  }
  const startDate = validatedIsoDate(configuration.startDate, 'Reforecast configuration startDate')
  const endDate = validatedIsoDate(configuration.endDate, 'Reforecast configuration endDate')
  if (startDate > endDate) throw new Error('Reforecast configuration startDate is after endDate.')
  const lastIssueDate = addUtcDays(
    GEFS_V12_REFORECAST_CONTRACT.archive.archivePeriod[1],
    -GEFS_V12_REFORECAST_CONTRACT.leadDays,
  )
  if (startDate < GEFS_V12_REFORECAST_CONTRACT.archive.archivePeriod[0] || endDate > lastIssueDate) {
    throw new Error('Reforecast configuration issue dates fall outside the reviewed archive period.')
  }
  const members = validateReforecastMembers(configuration.members)
  const seasons = configuration.seasons
  if (
    !Array.isArray(seasons)
    || !seasons.length
    || new Set(seasons).size !== seasons.length
    || seasons.some((season) => !Object.hasOwn(GEFS_V12_REFORECAST_CONTRACT.seasons, season))
  ) {
    throw new Error('Reforecast configuration seasons are invalid or duplicated.')
  }
  if (!sameArray(configuration.forecastHours, GEFS_V12_REFORECAST_CONTRACT.forecastHours)) {
    throw new Error('Reforecast configuration forecast hours are invalid.')
  }
  if (configuration.locationUniverseContractId !== GEFS_V12_REFORECAST_CONTRACT.locationUniverse.contractId) {
    throw new Error('Reforecast configuration location universe is invalid.')
  }
  return { startDate, endDate, members, seasons: [...seasons] }
}

function validateMergeProvenance(mergeProvenance, configuration, recordCount) {
  if (!mergeProvenance || typeof mergeProvenance !== 'object' || Array.isArray(mergeProvenance)) {
    throw new Error('Merged reforecast manifest is missing merge provenance.')
  }
  assertSha256(mergeProvenance.implementationDigestSha256, 'Merge implementationDigestSha256')
  if (
    !Number.isInteger(mergeProvenance.shardCount)
    || mergeProvenance.shardCount < 2
    || !Array.isArray(mergeProvenance.shards)
    || mergeProvenance.shards.length !== mergeProvenance.shardCount
  ) {
    throw new Error('Merged reforecast manifest has an invalid shard count.')
  }
  const paths = new Set()
  const sortedShards = [...mergeProvenance.shards].sort((left, right) =>
    String(left.startDate).localeCompare(String(right.startDate)))
  let totalRecords = 0
  let acquisitionImplementationDigests
  for (const [index, shard] of sortedShards.entries()) {
    if (typeof shard.path !== 'string' || !shard.path || paths.has(shard.path)) {
      throw new Error('Merged reforecast provenance has a missing or duplicate shard path.')
    }
    paths.add(shard.path)
    const startDate = validatedIsoDate(shard.startDate, `Merged shard ${index + 1} startDate`)
    const endDate = validatedIsoDate(shard.endDate, `Merged shard ${index + 1} endDate`)
    if (startDate > endDate || startDate < configuration.startDate || endDate > configuration.endDate) {
      throw new Error(`Merged shard ${index + 1} date range is invalid.`)
    }
    const expectedShardCount = issueDatesForReforecast({
      startDate,
      endDate,
      seasons: configuration.seasons,
    }).length * configuration.members.length
    if (!Number.isInteger(shard.recordCount) || shard.recordCount !== expectedShardCount) {
      throw new Error(`Merged shard ${index + 1} record count does not match its configured plan.`)
    }
    totalRecords += shard.recordCount
    assertSha256(shard.manifestDigestSha256, `Merged shard ${index + 1} manifestDigestSha256`)
    assertSha256(shard.recordsDigestSha256, `Merged shard ${index + 1} recordsDigestSha256`)
    const implementationDigests = assertImplementationDigests(
      shard.acquisitionImplementationDigests,
      `Merged shard ${index + 1} acquisitionImplementationDigests`,
    )
    if (
      acquisitionImplementationDigests
      && digestCanonicalJson(implementationDigests) !== digestCanonicalJson(acquisitionImplementationDigests)
    ) {
      throw new Error('Merged reforecast provenance contains mixed shard acquisition implementation digests.')
    }
    acquisitionImplementationDigests = implementationDigests
    if (index === 0) {
      if (startDate !== configuration.startDate) {
        throw new Error('Merged shard provenance does not begin at the configured startDate.')
      }
    } else if (startDate !== addUtcDays(sortedShards[index - 1].endDate, 1)) {
      throw new Error('Merged shard provenance date ranges are not contiguous.')
    }
    if (index === sortedShards.length - 1 && endDate !== configuration.endDate) {
      throw new Error('Merged shard provenance does not end at the configured endDate.')
    }
  }
  if (totalRecords !== recordCount) {
    throw new Error('Merged shard provenance record counts do not match the merged record count.')
  }
  return acquisitionImplementationDigests
}

export function assertReforecastDataset({
  manifest,
  records,
  recordsText,
  requireComplete = true,
  allowedDatasetIds = [LOCAL_DATASET_ID, MERGED_DATASET_ID],
}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Reforecast manifest must be an object.')
  }
  if (manifest.schemaVersion !== 1) throw new Error('Reforecast manifest schemaVersion must equal 1.')
  if (!allowedDatasetIds.includes(manifest.datasetId)) throw new Error('Reforecast manifest datasetId is invalid.')
  if (manifest.researchOnly !== true || manifest.productionPromotionEligible !== false) {
    throw new Error('Reforecast manifest must remain research-only and promotion-ineligible.')
  }
  if (manifest.contractDigestSha256 !== GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256) {
    throw new Error('Reforecast manifest contract digest does not match the reviewed contract.')
  }
  if (digestCanonicalJson(manifest.contract) !== GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256) {
    throw new Error('Reforecast manifest embedded contract does not match the reviewed contract.')
  }
  const configuration = validateDatasetConfiguration(manifest.configuration)
  if (manifest.configurationDigestSha256 !== digestCanonicalJson(manifest.configuration)) {
    throw new Error('Reforecast manifest configuration digest mismatch.')
  }
  const expectedKeys = new Set(
    issueDatesForReforecast(configuration)
      .flatMap(({ issueDate }) => configuration.members.map((member) => `${issueDate}|${member}`)),
  )
  if (!Number.isInteger(manifest.planCount) || manifest.planCount !== expectedKeys.size) {
    throw new Error('Reforecast manifest planCount does not match its complete configured plan.')
  }
  if (!Array.isArray(records)) throw new Error('Reforecast dataset records must be an array.')
  const keys = new Set()
  for (const [index, record] of records.entries()) {
    try {
      assertBoundRecord(record)
    } catch (error) {
      throw new Error(`Invalid reforecast record ${index + 1}: ${error.message}`)
    }
    const key = `${record.issueDate}|${record.member}`
    if (!expectedKeys.has(key)) throw new Error(`Unexpected reforecast issue/member key: ${key}.`)
    if (keys.has(key)) throw new Error(`Duplicate reforecast issue/member key: ${key}.`)
    keys.add(key)
  }
  if (!Number.isInteger(manifest.completedCount) || manifest.completedCount !== records.length) {
    throw new Error('Reforecast manifest completedCount does not match the record count.')
  }
  const complete = manifest.complete === true && manifest.status === 'complete'
  if (manifest.complete !== (manifest.status === 'complete')) {
    throw new Error('Reforecast manifest complete flag and status disagree.')
  }
  if (requireComplete && !complete) {
    throw new Error('Reforecast dataset is partial. Complete it or explicitly allow a partial diagnostic dataset.')
  }
  if (complete) {
    if (records.length !== expectedKeys.size) {
      throw new Error('Complete reforecast dataset record count does not match its configured plan.')
    }
    const missing = [...expectedKeys].find((key) => !keys.has(key))
    if (missing) throw new Error(`Complete reforecast dataset is missing ${missing}.`)
  } else if (manifest.status !== 'partial') {
    throw new Error('Incomplete reforecast manifest status must be partial.')
  }
  if (typeof recordsText !== 'string' && !Buffer.isBuffer(recordsText)) {
    throw new Error('Reforecast dataset recordsText is required for output authentication.')
  }
  const recordsBytes = Buffer.isBuffer(recordsText) ? recordsText.byteLength : Buffer.byteLength(recordsText)
  const recordsDigestSha256 = crypto.createHash('sha256').update(recordsText).digest('hex')
  if (
    manifest.output?.recordsBytes !== recordsBytes
    || manifest.output?.recordsDigestSha256 !== recordsDigestSha256
  ) {
    throw new Error('Reforecast manifest output size/digest does not authenticate the record bytes.')
  }
  if (manifest.output?.rawGribRetained !== false) {
    throw new Error('Reforecast manifest must state that raw GRIB bytes were not retained.')
  }
  let acquisitionImplementationDigests
  if (manifest.datasetId === LOCAL_DATASET_ID) {
    acquisitionImplementationDigests = assertImplementationDigests(
      manifest.implementationDigests,
      'Reforecast manifest implementationDigests',
    )
  } else {
    acquisitionImplementationDigests = validateMergeProvenance(
      manifest.mergeProvenance,
      configuration,
      records.length,
    )
  }
  return {
    members: configuration.members,
    seasons: configuration.seasons,
    expectedCount: expectedKeys.size,
    complete,
    acquisitionImplementationDigests,
  }
}
