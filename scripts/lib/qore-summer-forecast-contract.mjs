import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

const DAY_MS = 86400000

export const SUMMER_FORECAST_TEMPORAL_CONTRACT_SCHEMA_VERSION = 2
export const SUMMER_FORECAST_TEMPORAL_CONTRACT_ID =
  'summer-target-local-day-four-sample-mean-v1'
export const LEGACY_FORECAST_TEMPORAL_CONTRACT_ID =
  'legacy-target-utc-midnight-single-snapshot-v1'
export const SUMMER_FORECAST_TEMPORAL_INPUT_ROLE = 'summer-production-lead-7-calendar'
export const FORECAST_SAMPLE_VALUE_BINDING_SCHEMA_VERSION = 1
export const SUMMER_FORECAST_FAILURE_SAMPLE_LIMIT = 20

function freezeCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy))
  if (!value || typeof value !== 'object') return value
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, freezeCopy(nested)]),
  ))
}

export const SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT = freezeCopy({
  contractId: 'nasa-power-merra2-lst-t2m-1991-2020-v1',
  apiName: 'POWER Daily API',
  apiVersion: 'v2.9.4',
  upstreamSource: 'MERRA2',
  timeStandard: 'LST',
  parameter: 'T2M',
  startDate: '1991-01-01',
  endDate: '2020-12-31',
  aggregation: 'same-calendar-month-day-arithmetic-mean-converted-C-to-F',
  retainedPayloadPathTemplate:
    'data/qore/weather/nasa-power/normals/{locationId}-1991-01-01-2020-12-31.json',
  payloadDigestSha256ByLocationId: {
    atlanta: '0810f0fc8a90118b9ee78160ca0a8b07ff765c211e2b358ccb1ad515a5d0f9ec',
    boston: 'f1ace71546bd44d70b32c8281ffd0c8146e43e5a70e4519b1dd4724a70c21ff9',
    charlotte: '79c72d67eaeaa2f7a571397b527ce7e643101fe2e59e4662af47f89bbd135589',
    chicago: '371516b28991c393b58e0397b11fec342fa0889673dfd349cf1f4e303f37003b',
    cleveland: '2796510c46879cfd3000abc92f23fe433abda00cb69bef106b5576698224b135',
    dallas: '4b3d8648923891fab65ad6cf3ff64146f4462deaf80c0c2e8ec3d2e4db2348fd',
    detroit: '2e824bb05e63c57f04b5920e50151539d9a7098badf46a90cd42d230a8aac7f2',
    houston: '520c32658c959069798e70f4acf024e687f937dee358507780208922db6781f5',
    indianapolis: 'dd17c50dc054452117f2924a591c07694d15f84c11545dbb29523bdc6468854c',
    'kansas-city': '69456f00d87cb878a5519ed38c73c0bf241995a5a2f88cb8335a9535dab607f7',
    memphis: '9abe74e9c50ed3b38351c9e2e348c614f51cca718e4238099a0def5f96315125',
    minneapolis: '783c46d0c07a7a7b99ff3fa8f65c66e4773f1bf5d7ae19f7e6b2f17a311584e6',
    nashville: 'f8d2cd1ef3b61c6c360f7cf7d685c187da76dc78986e69395a216e88c0aa0689',
    'new-york': 'da386333e72f33767c006da9febf366ed0b2090168caaf911e4577588b562938',
    philadelphia: '4c0ebfca3239e592cced47e0ba1e1a8d315bbf3892434811fa4766d16d73bb36',
    raleigh: '02d9ee85ef2804f9a482f1c97d460bf5348064ee498b6cb78f3a2f414e825852',
    'st-louis': 'afe6c6bac4ed1e9812cb767798328eddc6c7d8bf4c34ee024af26a4ac250befc',
    'washington-dc': '475680dd2ac2d3ec115de7bbeb6eb37da8dbea2afe51777a34ff802bf1bda11f',
  },
})
export const SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256 =
  digestValueSha256(SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT)

const reviewedNormalPayloadCache = new Map()

function reviewedNormalPayload(locationId) {
  if (reviewedNormalPayloadCache.has(locationId)) {
    return reviewedNormalPayloadCache.get(locationId)
  }
  const expectedDigest =
    SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.payloadDigestSha256ByLocationId[locationId]
  if (!expectedDigest) throw new Error(`No reviewed retained normal payload for ${locationId}.`)
  const relativePath = SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.retainedPayloadPathTemplate
    .replace('{locationId}', locationId)
  const raw = readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
  const actualDigest = crypto.createHash('sha256').update(raw).digest('hex')
  if (actualDigest !== expectedDigest) {
    throw new Error(`Retained normal payload digest mismatch for ${locationId}.`)
  }
  const json = JSON.parse(raw)
  const byMonthDay = new Map()
  for (const [date, value] of Object.entries(json.properties?.parameter?.T2M ?? {})) {
    if (typeof value !== 'number' || value <= -900) continue
    const monthDay = date.slice(4)
    const fahrenheit = value * 9 / 5 + 32
    byMonthDay.set(monthDay, [...(byMonthDay.get(monthDay) ?? []), fahrenheit])
  }
  const payload = { digestSha256: actualDigest, byMonthDay }
  reviewedNormalPayloadCache.set(locationId, payload)
  return payload
}

export function reviewedSummerNormalMeanF({ locationId, targetDate }) {
  isoDateTimestamp(targetDate, 'targetDate')
  const values = reviewedNormalPayload(locationId).byMonthDay.get(targetDate.slice(5).replace('-', ''))
  if (!values?.length) {
    throw new Error(`Reviewed retained normal has no samples for ${locationId} ${targetDate.slice(5)}.`)
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 3)
}

export const SUMMER_FORECAST_REVIEWED_MODEL_IDS = freezeCopy({
  gfs: 'ncep-gfs-global-00z-noaa-aws',
  'gefs-mean': 'ncep-gefs-mean-00z-noaa-aws',
  graphcastgfs: 'ncep-gfs-graphcast-00z-noaa-aws',
  aigfs: 'ncep-aigfs-025-00z-openmeteo-single-runs',
  'ecmwf-ifs': 'ecmwf-ifs-00z-openmeteo-single-runs',
  'ecmwf-aifs': 'ecmwf-aifs-025-00z-openmeteo-single-runs',
  'gem-global': 'gem-global-00z-openmeteo-single-runs',
})

export const FORECAST_SAMPLE_VALUE_BINDING = freezeCopy({
  schemaVersion: FORECAST_SAMPLE_VALUE_BINDING_SCHEMA_VERSION,
  sampleValuesField: 'sampledForecastValuesF',
  sampleValuesEncoding: 'pipe-delimited-degrees-F-in-offset-order-decimal-round-trip',
  sampleProvenanceField: 'forecastSampleProvenanceJson',
  sampleProvenanceDigestField: 'forecastSampleProvenanceDigestSha256',
  locationVectorDigestField: 'forecastSampleVectorDigestSha256',
  locationSetDigestField: 'locationSampleVectorSetDigestSha256',
  normalIdentityFields: [
    'normalSourceContractId',
    'normalSourceContractDigestSha256',
    'normalSourcePayloadDigestSha256',
  ],
  normalSourceContract: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT,
  normalSourceContractDigestSha256: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
  reviewedWindowId: 'rumor',
  reviewedModelIds: SUMMER_FORECAST_REVIEWED_MODEL_IDS,
  acquisitionIdentityFields: [
    'sourceUrl',
    'indexUrl',
    'indexLine',
    'sourceIndexPayloadDigestSha256',
    'sourcePayloadDigestSha256',
  ],
  aggregateRule: 'forecastMeanF-equals-rounded-3dp-arithmetic-mean-of-stored-samples',
  digestAlgorithm: 'sha256-canonical-json',
  acquisitionTrustBoundary:
    'The builder hashes each fetched GRIB field or Open-Meteo response and binds that digest plus upstream object identity into the persisted score provenance. Relabel-only or accidental value changes fail validation. Raw forecast bytes are not retained and SHA-256 bindings are not signatures, so a malicious process able to fabricate values and recompute every digest remains inside the trusted builder acquisition-attestation boundary.',
})

export const SUMMER_FORECAST_TEMPORAL_CONTRACT = freezeCopy({
  schemaVersion: SUMMER_FORECAST_TEMPORAL_CONTRACT_SCHEMA_VERSION,
  contractId: SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
  forecastIssueRunHourUtc: '00',
  requiredLeadDays: 7,
  validTimeOffsetsHoursFromTargetUtcMidnight: [6, 12, 18, 24],
  aggregation: 'equal-weighted-arithmetic-mean',
  targetDateSemantics:
    'The targetDate remains issueDate plus leadDays. Offset 24 samples the following UTC midnight and is aggregated into that targetDate as the reviewed Eastern/Central US local-day approximation.',
  targetDayBasis: 'eastern-central-us-local-calendar-day-four-sample-approximation',
  comparisonStatistic: 'NASA-POWER-daily-T2M-mean',
  valueBinding: FORECAST_SAMPLE_VALUE_BINDING,
  summerExecutionEligible: true,
})

export const LEGACY_FORECAST_TEMPORAL_CONTRACT = freezeCopy({
  schemaVersion: SUMMER_FORECAST_TEMPORAL_CONTRACT_SCHEMA_VERSION,
  contractId: LEGACY_FORECAST_TEMPORAL_CONTRACT_ID,
  validTimeOffsetsHoursFromTargetUtcMidnight: [0],
  aggregation: 'single-snapshot',
  targetDayBasis: 'target-utc-midnight-instantaneous-snapshot',
  comparisonStatistic: 'instantaneous-T2M',
  summerExecutionEligible: false,
})

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function parsedOffsets(value) {
  if (Array.isArray(value)) return value.map(Number)
  if (typeof value !== 'string' || !value.trim()) return []
  return value.split(/[|,]/).map(Number)
}

function isoDateTimestamp(value, label) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${label} must be an ISO calendar date.`)
  }
  const timestamp = Date.parse(`${text}T00:00:00Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be a valid ISO calendar date.`)
  }
  return timestamp
}

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

function digestValueSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function compactSummerForecastFailures(failures) {
  if (!Array.isArray(failures) || failures.some((failure) =>
    typeof failure !== 'string' || !failure.trim())) {
    throw new Error('Summer forecast failures must be an array of non-empty strings.')
  }
  const uniqueFailures = [...new Set(failures)].sort()
  return {
    failureCount: uniqueFailures.length,
    failureDigestSha256: digestValueSha256(uniqueFailures),
    failureSamples: uniqueFailures.slice(0, SUMMER_FORECAST_FAILURE_SAMPLE_LIMIT),
  }
}

function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function parseForecastSampleValues(value) {
  if (Array.isArray(value)) {
    return value.map((sample) => String(sample).trim() === '' ? Number.NaN : Number(sample))
  }
  if (typeof value !== 'string' || !value.trim()) return []
  return value.split('|').map((sample) => sample.trim() === '' ? Number.NaN : Number(sample))
}

export function forecastSampleProvenanceDigestSha256({
  contractId,
  issueDate,
  targetDate,
  leadDays,
  modelId,
  samples,
}) {
  return digestValueSha256({
    schemaVersion: FORECAST_SAMPLE_VALUE_BINDING_SCHEMA_VERSION,
    contractId,
    issueDate,
    targetDate,
    leadDays: Number(leadDays),
    modelId,
    samples,
  })
}

export function forecastSampleVectorDigestSha256({
  contractId,
  issueDate,
  targetDate,
  leadDays,
  modelId,
  locationId,
  weight,
  offsets,
  sampleValuesF,
  normalMeanF,
  forecastAnomalyF,
  normalSourceContractId,
  normalSourceContractDigestSha256,
  normalSourcePayloadDigestSha256,
  provenanceDigestSha256,
}) {
  return digestValueSha256({
    schemaVersion: FORECAST_SAMPLE_VALUE_BINDING_SCHEMA_VERSION,
    contractId,
    issueDate,
    targetDate,
    leadDays: Number(leadDays),
    modelId,
    locationId,
    weight: Number(weight),
    offsets,
    sampleValuesF,
    normalMeanF: Number(normalMeanF),
    forecastAnomalyF: Number(forecastAnomalyF),
    normalSourceContractId,
    normalSourceContractDigestSha256,
    normalSourcePayloadDigestSha256,
    provenanceDigestSha256,
  })
}

export function forecastLocationSampleSetDigestSha256({
  contractId,
  issueDate,
  targetDate,
  leadDays,
  modelId,
  locationRows,
}) {
  const locations = [...locationRows]
    .map((row) => ({
      locationId: row.locationId,
      forecastSampleVectorDigestSha256: row.forecastSampleVectorDigestSha256,
    }))
    .sort((left, right) => String(left.locationId).localeCompare(String(right.locationId)))
  return digestValueSha256({
    schemaVersion: FORECAST_SAMPLE_VALUE_BINDING_SCHEMA_VERSION,
    contractId,
    issueDate,
    targetDate,
    leadDays: Number(leadDays),
    modelId,
    locations,
  })
}

export function validateForecastTimeOffsets(offsets, { label = 'forecast time offsets' } = {}) {
  if (!Array.isArray(offsets) || !offsets.length) {
    throw new Error(`${label} must contain at least one integer offset.`)
  }
  const parsed = offsets.map(Number)
  if (parsed.some((offset) => !Number.isInteger(offset) || offset < 0 || offset > 24)) {
    throw new Error(`${label} must contain only integers from 0 through 24.`)
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error(`${label} must not contain duplicate offsets.`)
  }
  if (parsed.some((offset, index) => index > 0 && offset <= parsed[index - 1])) {
    throw new Error(`${label} must be strictly increasing.`)
  }
  return parsed
}

export function forecastValidTimeForTargetOffset({ targetDate, offsetHours }) {
  const targetTimestamp = isoDateTimestamp(targetDate, 'targetDate')
  const offsets = validateForecastTimeOffsets([offsetHours], { label: 'forecast valid-time offset' })
  const timestamp = targetTimestamp + offsets[0] * 3600000
  return new Date(timestamp).toISOString().slice(0, 16)
}

export function summerForecastTemporalSamplingMetadata({
  runHourUtc,
  leadDays,
  offsets,
  requestedContractId = null,
}) {
  const validatedOffsets = validateForecastTimeOffsets(offsets)
  const normalizedRunHour = String(runHourUtc ?? '')
  const normalizedLeadDays = Array.isArray(leadDays) ? leadDays.map(Number) : [Number(leadDays)]
  const summerConfiguration = (
    normalizedRunHour === SUMMER_FORECAST_TEMPORAL_CONTRACT.forecastIssueRunHourUtc
    && sameArray(normalizedLeadDays, [SUMMER_FORECAST_TEMPORAL_CONTRACT.requiredLeadDays])
    && sameArray(
      validatedOffsets,
      SUMMER_FORECAST_TEMPORAL_CONTRACT.validTimeOffsetsHoursFromTargetUtcMidnight,
    )
  )
  const legacyConfiguration = sameArray(
    validatedOffsets,
    LEGACY_FORECAST_TEMPORAL_CONTRACT.validTimeOffsetsHoursFromTargetUtcMidnight,
  )

  if (requestedContractId === SUMMER_FORECAST_TEMPORAL_CONTRACT_ID && !summerConfiguration) {
    throw new Error(
      `Summer forecast temporal contract ${SUMMER_FORECAST_TEMPORAL_CONTRACT_ID} requires run 00, lead days 7, and the exact ordered offset set 6,12,18,24.`,
    )
  }
  if (requestedContractId === LEGACY_FORECAST_TEMPORAL_CONTRACT_ID && !legacyConfiguration) {
    throw new Error(
      `Legacy forecast temporal contract ${LEGACY_FORECAST_TEMPORAL_CONTRACT_ID} requires the exact offset set 0.`,
    )
  }
  if (
    requestedContractId
    && ![SUMMER_FORECAST_TEMPORAL_CONTRACT_ID, LEGACY_FORECAST_TEMPORAL_CONTRACT_ID].includes(requestedContractId)
  ) {
    throw new Error(`Unsupported forecast temporal contract: ${requestedContractId}.`)
  }

  const contract = summerConfiguration
    ? SUMMER_FORECAST_TEMPORAL_CONTRACT
    : legacyConfiguration
      ? LEGACY_FORECAST_TEMPORAL_CONTRACT
      : null
  return {
    schemaVersion: SUMMER_FORECAST_TEMPORAL_CONTRACT_SCHEMA_VERSION,
    contractId: contract?.contractId ?? 'custom-forecast-time-offset-mean-v1',
    forecastIssueRunHourUtc: normalizedRunHour,
    leadDays: normalizedLeadDays,
    validTimeOffsetsHoursFromTargetUtcMidnight: validatedOffsets,
    aggregation: validatedOffsets.length === 1
      ? 'single-snapshot'
      : 'equal-weighted-arithmetic-mean',
    targetDateSemantics: contract?.targetDateSemantics
      ?? 'The targetDate remains issueDate plus leadDays; offsets are measured from target UTC midnight.',
    targetDayBasis: contract?.targetDayBasis ?? 'custom-target-utc-offset-sampling',
    comparisonStatistic: contract?.comparisonStatistic ?? 'sampled-T2M',
    ...(contract?.summerExecutionEligible === true
      ? { valueBinding: FORECAST_SAMPLE_VALUE_BINDING }
      : {}),
    summerExecutionEligible: contract?.summerExecutionEligible === true,
  }
}

function rowTemporalFailures(row, label, sourceId) {
  const failures = []
  if (row?.forecastTemporalContractId !== SUMMER_FORECAST_TEMPORAL_CONTRACT_ID) {
    failures.push(`${label} forecastTemporalContractId is not the corrected Summer contract`)
  }
  const offsets = parsedOffsets(row?.sampledValidTimeOffsetsHours)
  if (!sameArray(
    offsets,
    SUMMER_FORECAST_TEMPORAL_CONTRACT.validTimeOffsetsHoursFromTargetUtcMidnight,
  )) {
    failures.push(`${label} sampledValidTimeOffsetsHours is not exactly 6|12|18|24`)
  }
  const legacyAlias = parsedOffsets(row?.sampledValidHoursUtc)
  if (!sameArray(legacyAlias, offsets)) {
    failures.push(`${label} sampledValidHoursUtc does not match sampledValidTimeOffsetsHours`)
  }
  if (Number(row?.leadDays) !== SUMMER_FORECAST_TEMPORAL_CONTRACT.requiredLeadDays) {
    failures.push(`${label} leadDays is not 7`)
  }
  let issueTimestamp = null
  try {
    issueTimestamp = isoDateTimestamp(row?.issueDate, 'issueDate')
    isoDateTimestamp(row?.targetDate, 'targetDate')
  } catch {
    failures.push(`${label} issueDate and targetDate must be valid ISO calendar dates`)
  }
  if (issueTimestamp !== null) {
    const expectedTargetDate = new Date(
      issueTimestamp + SUMMER_FORECAST_TEMPORAL_CONTRACT.requiredLeadDays * DAY_MS,
    ).toISOString().slice(0, 10)
    if (row?.targetDate !== expectedTargetDate) {
      failures.push(`${label} targetDate is not issueDate plus the reviewed seven-day lead`)
    }
  }
  if (row?.windowId !== FORECAST_SAMPLE_VALUE_BINDING.reviewedWindowId) {
    failures.push(`${label} windowId is not the reviewed Summer rumor window`)
  }
  const reviewedModelId = SUMMER_FORECAST_REVIEWED_MODEL_IDS[sourceId]
  if (!reviewedModelId) {
    failures.push(`${label} sourceId has no reviewed Summer model identity`)
  } else if (row?.modelId !== reviewedModelId) {
    failures.push(`${label} modelId does not match the reviewed ${sourceId} Summer model`)
  }
  if (row?.sourceId && row.sourceId !== sourceId) {
    failures.push(`${label} embedded sourceId does not match the requested source`)
  }
  return failures
}

function forecastGroupKey(row) {
  return [row?.issueDate, row?.targetDate, row?.leadDays, row?.windowId, row?.modelId].join('|')
}

function forecastSourceIssueLeadKey(row, sourceId) {
  return [sourceId, row?.issueDate, row?.leadDays].join('|')
}

function parsedProvenanceSamples(row, label, failures) {
  let samples
  try {
    samples = JSON.parse(String(row?.forecastSampleProvenanceJson ?? ''))
  } catch {
    failures.push(`${label} forecastSampleProvenanceJson is not valid JSON`)
    return []
  }
  if (!Array.isArray(samples)) {
    failures.push(`${label} forecastSampleProvenanceJson must encode an array`)
    return []
  }
  return samples
}

function scoreValueBindingFailures(score, locationRows, label) {
  const failures = []
  const offsets = parsedOffsets(score?.sampledValidTimeOffsetsHours)
  const samples = parsedProvenanceSamples(score, label, failures)
  if (samples.length !== offsets.length) {
    failures.push(`${label} provenance sample count does not match the exact offset count`)
  }
  samples.forEach((sample, index) => {
    const offsetHours = offsets[index]
    if (Number(sample?.offsetHours) !== offsetHours) {
      failures.push(`${label} provenance offsets do not match sampledValidTimeOffsetsHours in order`)
    }
    let expectedValidTimeUtc = null
    try {
      expectedValidTimeUtc = forecastValidTimeForTargetOffset({
        targetDate: score?.targetDate,
        offsetHours,
      })
    } catch {
      failures.push(`${label} targetDate cannot produce deterministic sample valid times`)
    }
    if (expectedValidTimeUtc && sample?.validTimeUtc !== expectedValidTimeUtc) {
      failures.push(`${label} provenance validTimeUtc does not match targetDate plus offset`)
    }
    if (Number(sample?.forecastHour) !== Number(score?.leadDays) * 24 + offsetHours) {
      failures.push(`${label} provenance forecastHour does not match leadDays plus offset`)
    }
    if (typeof sample?.sourceUrl !== 'string' || !sample.sourceUrl) {
      failures.push(`${label} provenance sourceUrl is missing`)
    }
    if (
      !Object.hasOwn(sample ?? {}, 'indexUrl')
      || !Object.hasOwn(sample ?? {}, 'indexLine')
      || !Object.hasOwn(sample ?? {}, 'sourceIndexPayloadDigestSha256')
    ) {
      failures.push(`${label} provenance index identity fields are missing`)
    }
    if (typeof sample?.indexUrl !== 'string' || typeof sample?.indexLine !== 'string') {
      failures.push(`${label} provenance indexUrl and indexLine must be strings`)
    } else if (sample.indexUrl) {
      if (sample.indexUrl !== `${sample.sourceUrl}.idx`) {
        failures.push(`${label} provenance indexUrl does not identify the source object index`)
      }
      if (typeof sample?.indexLine !== 'string' || !sample.indexLine) {
        failures.push(`${label} provenance indexLine is missing for an indexed source`)
      }
      if (
        typeof sample?.sourceIndexPayloadDigestSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(sample.sourceIndexPayloadDigestSha256)
      ) {
        failures.push(`${label} provenance sourceIndexPayloadDigestSha256 is missing or malformed for an indexed source`)
      }
    } else if (sample.indexLine !== '' || sample?.sourceIndexPayloadDigestSha256 !== '') {
      failures.push(`${label} provenance non-indexed sources must use explicit empty index sentinels`)
    }
    if (
      typeof sample?.sourcePayloadDigestSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(sample.sourcePayloadDigestSha256)
    ) {
      failures.push(`${label} provenance sourcePayloadDigestSha256 is missing or malformed`)
    }
  })
  const expectedProvenanceDigest = forecastSampleProvenanceDigestSha256({
    contractId: score?.forecastTemporalContractId,
    issueDate: score?.issueDate,
    targetDate: score?.targetDate,
    leadDays: score?.leadDays,
    modelId: score?.modelId,
    samples,
  })
  if (score?.forecastSampleProvenanceDigestSha256 !== expectedProvenanceDigest) {
    failures.push(`${label} forecastSampleProvenanceDigestSha256 does not bind the persisted provenance`)
  }
  for (const location of locationRows) {
    const sampleValuesF = parseForecastSampleValues(location?.sampledForecastValuesF)
    if (
      sampleValuesF.length !== offsets.length
      || sampleValuesF.some((value) => !Number.isFinite(value))
    ) {
      failures.push(`${label} location sample vectors must contain one finite value per exact offset`)
      continue
    }
    const recomputedMeanF = round(
      sampleValuesF.reduce((sum, value) => sum + value, 0) / sampleValuesF.length,
      3,
    )
    const forecastMeanF = Number(location?.forecastMeanF)
    if (!Number.isFinite(forecastMeanF)) {
      failures.push(`${label} location forecastMeanF must be finite`)
    } else if (Math.abs(recomputedMeanF - forecastMeanF) > 1e-9) {
      failures.push(`${label} forecastMeanF does not equal the arithmetic mean of persisted samples`)
    }
    const normalMeanF = Number(location?.normalMeanF)
    const forecastAnomalyF = Number(location?.forecastAnomalyF)
    if (!Number.isFinite(normalMeanF) || !Number.isFinite(forecastAnomalyF)) {
      failures.push(`${label} location normalMeanF and forecastAnomalyF must be finite`)
    } else if (
      Math.abs(round(forecastMeanF - normalMeanF, 3) - forecastAnomalyF)
      > 0.001 + 1e-9
    ) {
      failures.push(`${label} forecastAnomalyF does not match the bound forecast mean and normal`)
    }
    if (location?.normalSourceContractId !== SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.contractId) {
      failures.push(`${label} normalSourceContractId does not match the reviewed NASA POWER normal contract`)
    }
    if (
      location?.normalSourceContractDigestSha256
      !== SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256
    ) {
      failures.push(`${label} normalSourceContractDigestSha256 does not match the reviewed normal source/version`)
    }
    if (
      typeof location?.normalSourcePayloadDigestSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(location.normalSourcePayloadDigestSha256)
    ) {
      failures.push(`${label} normalSourcePayloadDigestSha256 is missing or malformed`)
    } else {
      const expectedPayloadDigest =
        SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.payloadDigestSha256ByLocationId[
          location?.locationId
        ]
      if (!expectedPayloadDigest) {
        failures.push(`${label} locationId has no reviewed retained normal payload`)
      } else if (location.normalSourcePayloadDigestSha256 !== expectedPayloadDigest) {
        failures.push(`${label} normalSourcePayloadDigestSha256 does not match the reviewed retained normal payload for locationId`)
      }
    }
    try {
      const expectedNormalMeanF = reviewedSummerNormalMeanF({
        locationId: location?.locationId,
        targetDate: location?.targetDate,
      })
      if (Math.abs(Number(location?.normalMeanF) - expectedNormalMeanF) > 1e-9) {
        failures.push(`${label} normalMeanF does not match the reviewed retained normal payload for locationId and target month-day`)
      }
    } catch (error) {
      failures.push(`${label} could not authenticate normalMeanF against the reviewed retained normal payload: ${error.message}`)
    }
    if (location?.forecastSampleProvenanceDigestSha256 !== expectedProvenanceDigest) {
      failures.push(`${label} location sample vector is not bound to the score provenance`)
    }
    const expectedVectorDigest = forecastSampleVectorDigestSha256({
      contractId: location?.forecastTemporalContractId,
      issueDate: location?.issueDate,
      targetDate: location?.targetDate,
      leadDays: location?.leadDays,
      modelId: location?.modelId,
      locationId: location?.locationId,
      weight: location?.weight,
      offsets,
      sampleValuesF,
      normalMeanF: location?.normalMeanF,
      forecastAnomalyF: location?.forecastAnomalyF,
      normalSourceContractId: location?.normalSourceContractId,
      normalSourceContractDigestSha256: location?.normalSourceContractDigestSha256,
      normalSourcePayloadDigestSha256: location?.normalSourcePayloadDigestSha256,
      provenanceDigestSha256: expectedProvenanceDigest,
    })
    if (location?.forecastSampleVectorDigestSha256 !== expectedVectorDigest) {
      failures.push(`${label} forecastSampleVectorDigestSha256 does not bind samples, normals, anomaly, weight, provenance, and row identity`)
    }
  }
  if (!locationRows.length) {
    failures.push(`${label} has no location vectors to bind`)
  }
  if (new Set(locationRows.map((row) => row.locationId)).size !== locationRows.length) {
    failures.push(`${label} location vectors contain duplicate locationId values`)
  }
  if (Number(score?.locationCount) !== locationRows.length) {
    failures.push(`${label} locationCount does not match the bound location vectors`)
  }
  const weightedLocations = locationRows.map((location) => ({
    weight: Number(location?.weight),
    forecastAnomalyF: Number(location?.forecastAnomalyF),
  }))
  if (weightedLocations.some(({ weight, forecastAnomalyF }) =>
    !Number.isFinite(weight) || weight < 0 || !Number.isFinite(forecastAnomalyF))) {
    failures.push(`${label} location weights and forecast anomalies must be finite with non-negative weights`)
  } else {
    const sampledWeight = weightedLocations.reduce((sum, location) => sum + location.weight, 0)
    const weightedAnomalyF = sampledWeight
      ? weightedLocations.reduce(
        (sum, location) => sum + location.forecastAnomalyF * location.weight,
        0,
      ) / sampledWeight
      : 0
    const scoreSampledWeight = Number(score?.sampledWeight)
    const scoreWeightedAnomalyF = Number(score?.weightedAnomalyF)
    if (!Number.isFinite(scoreSampledWeight)) {
      failures.push(`${label} score sampledWeight must be finite`)
    } else if (Math.abs(round(sampledWeight, 3) - scoreSampledWeight) > 1e-9) {
      failures.push(`${label} sampledWeight does not match the bound location rows`)
    }
    if (!Number.isFinite(scoreWeightedAnomalyF)) {
      failures.push(`${label} score weightedAnomalyF must be finite`)
    } else if (Math.abs(round(weightedAnomalyF, 3) - scoreWeightedAnomalyF) > 1e-9) {
      failures.push(`${label} weightedAnomalyF does not match the bound location rows`)
    }
  }
  const expectedLocationSetDigest = forecastLocationSampleSetDigestSha256({
    contractId: score?.forecastTemporalContractId,
    issueDate: score?.issueDate,
    targetDate: score?.targetDate,
    leadDays: score?.leadDays,
    modelId: score?.modelId,
    locationRows,
  })
  if (score?.locationSampleVectorSetDigestSha256 !== expectedLocationSetDigest) {
    failures.push(`${label} locationSampleVectorSetDigestSha256 does not bind the score to its location vectors`)
  }
  return failures
}

export function forecastTemporalValueBindingFailures({ scoreRows, locationRows, sourceId = null }) {
  const failures = []
  for (const row of Array.isArray(scoreRows) ? scoreRows : []) {
    failures.push(...rowTemporalFailures(row, `${sourceId ?? 'Summer source'} score rows`, sourceId))
  }
  for (const row of Array.isArray(locationRows) ? locationRows : []) {
    failures.push(...rowTemporalFailures(row, `${sourceId ?? 'Summer source'} location rows`, sourceId))
  }
  const locationsByGroup = new Map()
  for (const row of Array.isArray(locationRows) ? locationRows : []) {
    const key = forecastGroupKey(row)
    locationsByGroup.set(key, [...(locationsByGroup.get(key) ?? []), row])
  }
  const scoreGroups = new Set()
  const sourceIssueLeadGroups = new Set()
  for (const score of Array.isArray(scoreRows) ? scoreRows : []) {
    const groupKey = forecastGroupKey(score)
    const sourceIssueLeadKey = forecastSourceIssueLeadKey(score, sourceId)
    const label = `${sourceId ?? 'Forecast source'} score group ${forecastGroupKey(score)}`
    if (scoreGroups.has(groupKey)) failures.push(`${label} is duplicated`)
    if (sourceIssueLeadGroups.has(sourceIssueLeadKey)) {
      failures.push(`${label} is an extra group for the same source, issueDate, and leadDays`)
    }
    scoreGroups.add(groupKey)
    sourceIssueLeadGroups.add(sourceIssueLeadKey)
    const groupLocations = locationsByGroup.get(groupKey) ?? []
    failures.push(...scoreValueBindingFailures(score, groupLocations, label))
  }
  for (const groupKey of locationsByGroup.keys()) {
    if (!scoreGroups.has(groupKey)) {
      failures.push(`${sourceId ?? 'Forecast source'} location group ${groupKey} has no score row`)
    }
  }
  return [...new Set(failures)]
}

function manifestTemporalFailures(manifest, label) {
  const failures = []
  const temporal = manifest?.temporalSampling
  if (!temporal || typeof temporal !== 'object') {
    return [`${label} temporalSampling metadata is missing`]
  }
  for (const [field, expected] of [
    ['schemaVersion', SUMMER_FORECAST_TEMPORAL_CONTRACT.schemaVersion],
    ['contractId', SUMMER_FORECAST_TEMPORAL_CONTRACT.contractId],
    ['forecastIssueRunHourUtc', SUMMER_FORECAST_TEMPORAL_CONTRACT.forecastIssueRunHourUtc],
    ['aggregation', SUMMER_FORECAST_TEMPORAL_CONTRACT.aggregation],
    ['targetDateSemantics', SUMMER_FORECAST_TEMPORAL_CONTRACT.targetDateSemantics],
    ['targetDayBasis', SUMMER_FORECAST_TEMPORAL_CONTRACT.targetDayBasis],
    ['comparisonStatistic', SUMMER_FORECAST_TEMPORAL_CONTRACT.comparisonStatistic],
    ['summerExecutionEligible', true],
  ]) {
    if (temporal[field] !== expected) failures.push(`${label} temporalSampling.${field} does not match the corrected Summer contract`)
  }
  if (!sameArray(
    temporal.validTimeOffsetsHoursFromTargetUtcMidnight,
    SUMMER_FORECAST_TEMPORAL_CONTRACT.validTimeOffsetsHoursFromTargetUtcMidnight,
  )) {
    failures.push(`${label} temporalSampling offsets are not exactly 6,12,18,24`)
  }
  if (
    !temporal.valueBinding
    || digestValueSha256(temporal.valueBinding) !== digestValueSha256(FORECAST_SAMPLE_VALUE_BINDING)
  ) {
    failures.push(`${label} temporalSampling.valueBinding does not match the reviewed sample-value binding`)
  }
  if (!sameArray(parsedOffsets(temporal.leadDays), [SUMMER_FORECAST_TEMPORAL_CONTRACT.requiredLeadDays])) {
    failures.push(`${label} temporalSampling leadDays are not exactly 7`)
  }
  if (manifest?.runHour !== SUMMER_FORECAST_TEMPORAL_CONTRACT.forecastIssueRunHourUtc) {
    failures.push(`${label} runHour is not 00`)
  }
  if (!sameArray(parsedOffsets(manifest?.leadDays), [SUMMER_FORECAST_TEMPORAL_CONTRACT.requiredLeadDays])) {
    failures.push(`${label} leadDays are not exactly 7`)
  }
  const topLevelOffsets = manifest?.validTimeOffsetsHoursFromTargetUtcMidnight
    ?? manifest?.validHoursUtc
  if (!sameArray(
    parsedOffsets(topLevelOffsets),
    SUMMER_FORECAST_TEMPORAL_CONTRACT.validTimeOffsetsHoursFromTargetUtcMidnight,
  )) {
    failures.push(`${label} top-level offsets are not exactly 6,12,18,24`)
  }
  return failures
}

export function summarizeSummerForecastTemporalInputs({
  manifest,
  scoreRows,
  locationRows,
  sourceId = null,
}) {
  const failures = []
  failures.push(...manifestTemporalFailures(manifest, `${sourceId ?? 'Summer source'} manifest`))
  if (sourceId && manifest?.forecastSource !== sourceId) {
    failures.push(`${sourceId} manifest forecastSource does not match the requested source`)
  }
  if (!Array.isArray(scoreRows) || !scoreRows.length) {
    failures.push(`${sourceId ?? 'Summer source'} score rows are empty`)
  } else {
    scoreRows.forEach((row) => {
      failures.push(...rowTemporalFailures(row, `${sourceId ?? 'Summer source'} score rows`, sourceId))
    })
  }
  if (!Array.isArray(locationRows) || !locationRows.length) {
    failures.push(`${sourceId ?? 'Summer source'} location rows are empty`)
  } else {
    locationRows.forEach((row) => {
      failures.push(...rowTemporalFailures(row, `${sourceId ?? 'Summer source'} location rows`, sourceId))
    })
  }
  failures.push(...forecastTemporalValueBindingFailures({ scoreRows, locationRows, sourceId }))
  const uniqueFailures = [...new Set(failures)]
  return {
    schemaVersion: SUMMER_FORECAST_TEMPORAL_CONTRACT_SCHEMA_VERSION,
    contractId: SUMMER_FORECAST_TEMPORAL_CONTRACT_ID,
    complete: uniqueFailures.length === 0,
    promotionEligible: uniqueFailures.length === 0,
    sourceId,
    scoreRowCount: Array.isArray(scoreRows) ? scoreRows.length : 0,
    locationRowCount: Array.isArray(locationRows) ? locationRows.length : 0,
    failures: uniqueFailures,
  }
}

export function summerForecastTemporalInputsForCoverage(calendarInputs) {
  if (!Array.isArray(calendarInputs)) throw new Error('calendarInputs must be an array.')
  return calendarInputs.filter((input) =>
    input?.temporalInputRole === SUMMER_FORECAST_TEMPORAL_INPUT_ROLE)
}

export function summerForecastCalendarsWithDedicatedOverrides({
  generalCalendars,
  dedicatedCalendars,
}) {
  if (!Array.isArray(generalCalendars) || !Array.isArray(dedicatedCalendars)) {
    throw new Error('generalCalendars and dedicatedCalendars must be arrays.')
  }
  if (dedicatedCalendars.some((calendar) => !calendar?.id)) {
    throw new Error('dedicated Summer calendars must have non-empty source ids.')
  }
  const dedicatedSourceIds = new Set(dedicatedCalendars.map((calendar) => calendar.id))
  if (dedicatedSourceIds.size !== dedicatedCalendars.length) {
    throw new Error('dedicated Summer calendars must have unique source ids.')
  }
  return [
    ...generalCalendars.filter((calendar) => !dedicatedSourceIds.has(calendar?.id)),
    ...dedicatedCalendars,
  ]
}

export function assertSummerForecastTemporalInputs(inputs) {
  const summary = summarizeSummerForecastTemporalInputs(inputs)
  if (!summary.complete) {
    const error = new Error(
      `Corrected Summer forecast temporal inputs are required: ${summary.failures.join('; ')}.`,
    )
    error.name = 'SummerForecastTemporalContractError'
    error.diagnostics = summary
    throw error
  }
  return summary
}

export function summerTargetDateForIssueDate(issueDate) {
  const timestamp = isoDateTimestamp(issueDate, 'issueDate')
  return new Date(timestamp + SUMMER_FORECAST_TEMPORAL_CONTRACT.requiredLeadDays * DAY_MS)
    .toISOString()
    .slice(0, 10)
}
