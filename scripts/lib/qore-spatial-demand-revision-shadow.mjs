import crypto from 'node:crypto'
import { chmod, link, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  SUMMER_FORECAST_LOCATIONS,
  SUMMER_FORECAST_LOCATION_UNIVERSE,
} from './qore-summer-location-universe.mjs'
import {
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT,
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
  SUMMER_FORECAST_REVIEWED_MODEL_IDS,
  forecastLocationSampleSetDigestSha256,
  forecastSampleProvenanceDigestSha256,
  forecastSampleVectorDigestSha256,
  forecastValidTimeForTargetOffset,
  parseForecastSampleValues,
  reviewedSummerNormalMeanF,
} from './qore-summer-forecast-contract.mjs'
import { executableLiveComponentActiveForDate } from './qore-live-contract.mjs'
import { summerShadowMarketSessionStatus } from './qore-summer-shadow-challenger.mjs'
import {
  FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
  validateForecastCalendarTemperatures,
} from './qore-weather-data-quality.mjs'

export const SPATIAL_DEMAND_REVISION_SHADOW_SCHEMA_VERSION = 1
export const SPATIAL_DEMAND_REVISION_FEATURE_SCHEMA_VERSION = 1
export const SPATIAL_DEMAND_REVISION_TARGET_RECORD_SCHEMA_VERSION = 1
export const SPATIAL_DEMAND_REVISION_SETTLEMENT_RECORD_SCHEMA_VERSION = 1

const DAY_MS = 86_400_000
const MAX_APPEND_CLOCK_SKEW_MS = 60_000
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const REVIEWED_TEMPORAL_CONTRACT_ID = 'custom-forecast-time-offset-mean-v1'
const REVIEWED_OFFSETS = Object.freeze([6, 12, 18, 24])
const REVIEWED_LEADS = Object.freeze([7, 8])
const REVIEWED_SOURCE_IDS = Object.freeze(['gfs', 'gefs-mean'])
const REVIEWED_TOTAL_LOCATION_WEIGHT = SUMMER_FORECAST_LOCATION_UNIVERSE.expectedSampledWeight
const SIGNAL_MARKET_LOOKBACK_DAYS = 30
const YAHOO_CHART_BASE_URL = 'https://query2.finance.yahoo.com/v8/finance/chart'

export const SPATIAL_DEMAND_REVISION_IMPLEMENTATION_PATHS = Object.freeze([
  'scripts/build-gfs-forecast-calendar.mjs',
  'scripts/collect-qore-spatial-demand-revision-shadow.mjs',
  'scripts/evaluate-qore-spatial-demand-revision-shadow.mjs',
  'scripts/settle-qore-spatial-demand-revision-shadow.mjs',
  'scripts/lib/qore-live-contract.mjs',
  'scripts/lib/qore-live-strategy-artifact.mjs',
  'scripts/lib/qore-research-execution.mjs',
  'scripts/lib/qore-spatial-demand-revision-shadow.mjs',
  'scripts/lib/qore-summer-forecast-contract.mjs',
  'scripts/lib/qore-summer-location-universe.mjs',
  'scripts/lib/qore-summer-shadow-challenger.mjs',
  'scripts/lib/qore-weather-data-quality.mjs',
  'scripts/local-env.mjs',
].toSorted())

export const SPATIAL_DEMAND_REVISION_INPUT_PATHS = Object.freeze([
  'config/qore-validation-integrity.json',
  'config/qore-research-execution.json',
  'data/qore/market/index-basket-config.json',
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/display-curve.csv',
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json',
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv',
  ...SUMMER_FORECAST_LOCATIONS.map(({ id }) => (
    `data/qore/weather/nasa-power/normals/${id}-1991-01-01-2020-12-31.json`
  )),
].toSorted())

function freezeCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy))
  if (!value || typeof value !== 'object') return value
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, freezeCopy(nested)]),
  ))
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

export function spatialDemandRevisionDigestSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function canonicalValuesEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

export const SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT = freezeCopy({
  schemaVersion: SPATIAL_DEMAND_REVISION_FEATURE_SCHEMA_VERSION,
  contractId: 'qore-spatial-demand-revision-features-v1',
  role: 'research-only-physical-feature-ledger',
  executionEligible: false,
  sourceIds: REVIEWED_SOURCE_IDS,
  modelWeighting: 'equal-complete-source-mean',
  forecastRunHourUtc: '00',
  currentLeadDays: 7,
  priorLeadDays: 8,
  vintageSpacingCalendarDays: 1,
  sameWeatherTargetRequired: true,
  temporalContractId: REVIEWED_TEMPORAL_CONTRACT_ID,
  validTimeOffsetsHoursFromTargetUtcMidnight: REVIEWED_OFFSETS,
  temporalAggregation: 'equal-weighted-arithmetic-mean',
  normalContractId: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.contractId,
  normalContractDigestSha256: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
  locationUniverse: SUMMER_FORECAST_LOCATION_UNIVERSE,
  demand: {
    baseF: 65,
    materialRevisionBreadthThresholdF: 0.25,
    demandTailThresholdF: 4,
    extremeDemandThresholdF: 8,
    texasLocationIds: ['dallas', 'houston'],
  },
  priceResponse: {
    symbol: 'NG=F',
    contract: 'Yahoo continuous front-month signal proxy',
    sourceBaseUrl: YAHOO_CHART_BASE_URL,
    lookbackDays: SIGNAL_MARKET_LOOKBACK_DAYS,
    start: 'previous reviewed completed session close',
    end: 'current forecast issue-session completed close',
    targetDateBarPolicy: 'forbidden',
    provisionalBarPolicy: 'forbidden',
  },
  historicalEvidenceStatus: 'development-contaminated',
})

export const SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256 =
  spatialDemandRevisionDigestSha256(SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT)

export const SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE = freezeCopy({
  schemaVersion: SPATIAL_DEMAND_REVISION_SHADOW_SCHEMA_VERSION,
  candidateId: 'spatial-demand-revision-breadth-price-gate-v1',
  strategyId: 'ngas-spatial-demand-revision-shadow',
  role: 'prospective-research-shadow',
  publicStrategy: false,
  executionEligible: false,
  frozenOn: '2026-07-22',
  prospectiveStart: '2026-07-23',
  sourceIds: REVIEWED_SOURCE_IDS,
  featureContractDigestSha256: SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256,
  rules: {
    minimumAbsoluteConsensusDemandRevisionF: 1,
    minimumDirectionalBreadthFraction: 2 / 3,
    requireBothModelRevisionDirections: true,
    priceGate: 'issue-session NG=F return must be flat or opposite the demand-revision direction',
    summerNegativeRevisionPolicy: 'flat',
    winterNegativeRevisionPolicy: 'short',
    gasPositionFraction: 0.25,
    minimumLocationDemandRevisionMagnitudeF: 0.25,
    holdPolicy: 'one-session-research-target',
  },
  outcomePolicy: {
    contractId: 'qore-spatial-demand-revision-forward-outcomes-v1',
    executionContractId: 'qore-causal-etf-execution-v2',
    instruments: ['UNG', 'VOO', 'QQQM'],
    targetEffectiveAt: 'current-session-adjusted-open',
    comparator: 'persistent matched index fallback under qore-causal-etf-execution-v2',
    referenceStrategy:
      'ngas-all-year-beta contract and artifact core are identity-bound but are not reconstructed from hindsight',
    missingCandidateRecordPolicy: 'missing-not-flat',
    marketOutcomeRequirement:
      'append-only next-reviewed-session adjusted OHLC observation with exact Yahoo URL and payload digest',
    scenarios: ['baseline', 'elevated', 'stress'],
  },
  evidence: {
    comparator: 'persistent matched 98%-deployed VOO/QQQM index fallback',
    referenceStrategy: 'unchanged versioned ngas-all-year-beta artifact core',
    changedEpisodeDefinition: 'candidate gas target is nonzero versus the matched index fallback',
    minimumIndependentEpisodes: 60,
    minimumEpisodesByComponent: 15,
    minimumSeasonsByComponent: 2,
    episodeEmbargoSessions: 10,
    episodeAttribution:
      'incremental log return from the first changed-target session through one reviewed session after the episode last changed target',
    minimumCompoundedActiveReturnPct: { baseline: 2, elevated: 1, stress: -2 },
    maximumActiveDrawdownPct: 10,
    maximumTopEpisodePositiveContributionFraction: 0.5,
    requirePositiveLeaveOneComponentSeasonOut: true,
    promotionPolicy:
      'Research nomination only. This candidate cannot authorize paper or live execution and must be reviewed under a new production contract if prospective evidence passes.',
  },
})

export const SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256 =
  spatialDemandRevisionDigestSha256(SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE)

export const SPATIAL_DEMAND_REVISION_OUTCOME_POLICY_DIGEST_SHA256 =
  spatialDemandRevisionDigestSha256(SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.outcomePolicy)

export const SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY = freezeCopy({
  schemaVersion: 1,
  registryId: 'qore-spatial-demand-revision-research-shadows-v1',
  familySize: 1,
  selectionPolicy: 'single-theory-first-candidate-no-post-seal-additions-v1',
  productionCandidateRegistry: false,
  candidates: [{
    candidateId: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.candidateId,
    contractDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256,
  }],
})

export const SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY_DIGEST_SHA256 =
  spatialDemandRevisionDigestSha256(SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY)

function isoDateTimestamp(value, label) {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be an ISO calendar date.`)
  const timestamp = Date.parse(`${text}T00:00:00Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be a valid ISO calendar date.`)
  }
  return timestamp
}

function addDays(date, count) {
  return new Date(isoDateTimestamp(date, 'date') + count * DAY_MS).toISOString().slice(0, 10)
}

export function spatialDemandRevisionYahooChartUrl({
  symbol,
  targetDate,
  lookbackDays = SIGNAL_MARKET_LOOKBACK_DAYS,
}) {
  isoDateTimestamp(targetDate, 'Yahoo targetDate')
  if (!['NG=F', 'UNG', 'VOO', 'QQQM'].includes(symbol)) {
    throw new Error(`Unsupported spatial-demand-revision Yahoo symbol ${symbol}.`)
  }
  if (!Number.isInteger(lookbackDays) || lookbackDays < 2 || lookbackDays > 730) {
    throw new Error('Yahoo lookbackDays must be an integer from 2 through 730.')
  }
  const url = new URL(`${YAHOO_CHART_BASE_URL}/${encodeURIComponent(symbol)}`)
  url.searchParams.set('period1', String(Math.floor(isoDateTimestamp(addDays(targetDate, -lookbackDays), 'period1') / 1000)))
  url.searchParams.set('period2', String(Math.floor(isoDateTimestamp(addDays(targetDate, 1), 'period2') / 1000)))
  url.searchParams.set('interval', '1d')
  url.searchParams.set('events', 'history')
  url.searchParams.set('includeAdjustedClose', 'true')
  return url.toString()
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sameArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function parsedNumberList(value) {
  if (Array.isArray(value)) return value.map(Number)
  if (typeof value !== 'string' || !value.trim()) return []
  return value.split(/[|,]/).map(Number)
}

function sourceModelId(sourceId) {
  return SUMMER_FORECAST_REVIEWED_MODEL_IDS[sourceId]
}

function reviewedForecastObjectUrls({ sourceId, issueDate, forecastHour }) {
  const ymd = String(issueDate).replaceAll('-', '')
  const fff = String(forecastHour).padStart(3, '0')
  if (sourceId === 'gfs') {
    const fileName = `gfs.t00z.pgrb2.0p25.f${fff}`
    return [
      `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${ymd}/00/atmos/${fileName}`,
      `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${ymd}/00/${fileName}`,
    ]
  }
  if (sourceId === 'gefs-mean') {
    return [
      `https://noaa-gefs-pds.s3.amazonaws.com/gefs.${ymd}/00/atmos/pgrb2sp25/geavg.t00z.pgrb2s.0p25.f${fff}`,
    ]
  }
  return []
}

function forecastGroupKey(row, sourceId = row?.sourceId) {
  return [sourceId, row?.issueDate, row?.targetDate, row?.leadDays, row?.windowId, row?.modelId].join('|')
}

function expectedUniverseFailures(rows, label) {
  const failures = []
  const expected = new Map(
    SUMMER_FORECAST_LOCATION_UNIVERSE.locations.map((row) => [row.locationId, row.weight]),
  )
  if (rows.length !== expected.size) failures.push(`${label} must contain exactly ${expected.size} locations`)
  const seen = new Set()
  for (const row of rows) {
    if (seen.has(row.locationId)) failures.push(`${label} contains duplicate location ${row.locationId}`)
    seen.add(row.locationId)
    if (!expected.has(row.locationId)) failures.push(`${label} contains unexpected location ${row.locationId}`)
    if (expected.has(row.locationId) && Math.abs(Number(row.weight) - expected.get(row.locationId)) > 1e-9) {
      failures.push(`${label} changed the reviewed weight for ${row.locationId}`)
    }
  }
  for (const locationId of expected.keys()) {
    if (!seen.has(locationId)) failures.push(`${label} is missing location ${locationId}`)
  }
  const sampledWeight = rows.reduce((sum, row) => sum + Number(row.weight), 0)
  if (!Number.isFinite(sampledWeight) || Math.abs(sampledWeight - REVIEWED_TOTAL_LOCATION_WEIGHT) > 1e-9) {
    failures.push(`${label} sampled weight must equal ${REVIEWED_TOTAL_LOCATION_WEIGHT}`)
  }
  return failures
}

function provenanceFailures({ score, locationRows, sourceId, label }) {
  const failures = []
  const offsets = parsedNumberList(score?.sampledValidTimeOffsetsHours)
  if (!sameArray(offsets, REVIEWED_OFFSETS)) failures.push(`${label} offsets must be exactly 6|12|18|24`)
  let samples = []
  try {
    samples = JSON.parse(String(score?.forecastSampleProvenanceJson ?? ''))
  } catch {
    failures.push(`${label} forecastSampleProvenanceJson must be valid JSON`)
  }
  if (!Array.isArray(samples) || samples.length !== REVIEWED_OFFSETS.length) {
    failures.push(`${label} provenance must contain one sample per reviewed offset`)
    samples = []
  }
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    const offset = REVIEWED_OFFSETS[index]
    if (Number(sample?.offsetHours) !== offset) failures.push(`${label} provenance offsets are out of order`)
    if (sample?.validTimeUtc !== forecastValidTimeForTargetOffset({ targetDate: score.targetDate, offsetHours: offset })) {
      failures.push(`${label} provenance valid time does not match target plus offset`)
    }
    if (Number(sample?.forecastHour) !== Number(score.leadDays) * 24 + offset) {
      failures.push(`${label} provenance forecast hour does not match the lead and offset`)
    }
    const reviewedUrls = reviewedForecastObjectUrls({
      sourceId,
      issueDate: score.issueDate,
      forecastHour: Number(score.leadDays) * 24 + offset,
    })
    if (!reviewedUrls.includes(sample?.sourceUrl)) {
      failures.push(`${label} provenance sourceUrl is not the reviewed NOAA object identity`)
    }
    if (!SHA256_PATTERN.test(String(sample?.sourcePayloadDigestSha256 ?? ''))) {
      failures.push(`${label} provenance source payload digest is missing or malformed`)
    }
    if (sample?.indexUrl !== `${sample?.sourceUrl}.idx`
      || typeof sample?.indexLine !== 'string'
      || !sample.indexLine
      || !SHA256_PATTERN.test(String(sample?.sourceIndexPayloadDigestSha256 ?? ''))) {
      failures.push(`${label} indexed NOAA provenance identity is incomplete`)
    }
  }
  const provenanceDigest = forecastSampleProvenanceDigestSha256({
    contractId: score?.forecastTemporalContractId,
    issueDate: score?.issueDate,
    targetDate: score?.targetDate,
    leadDays: score?.leadDays,
    modelId: score?.modelId,
    samples,
  })
  if (score?.forecastSampleProvenanceDigestSha256 !== provenanceDigest) {
    failures.push(`${label} score provenance digest does not bind the persisted sample identities`)
  }

  for (const row of locationRows) {
    const values = parseForecastSampleValues(row.sampledForecastValuesF)
    if (values.length !== REVIEWED_OFFSETS.length || values.some((value) => !Number.isFinite(value))) {
      failures.push(`${label} ${row.locationId} sample vector is incomplete`)
      continue
    }
    const meanF = round(values.reduce((sum, value) => sum + value, 0) / values.length, 3)
    if (Math.abs(meanF - Number(row.forecastMeanF)) > 1e-9) {
      failures.push(`${label} ${row.locationId} forecast mean does not bind the sample vector`)
    }
    if (row.normalSourceContractId !== SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.contractId
      || row.normalSourceContractDigestSha256 !== SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256) {
      failures.push(`${label} ${row.locationId} normal source contract is not reviewed`)
    }
    const expectedPayloadDigest =
      SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.payloadDigestSha256ByLocationId[row.locationId]
    if (row.normalSourcePayloadDigestSha256 !== expectedPayloadDigest) {
      failures.push(`${label} ${row.locationId} normal payload digest is not reviewed`)
    }
    try {
      const expectedNormal = reviewedSummerNormalMeanF({
        locationId: row.locationId,
        targetDate: row.targetDate,
      })
      if (Math.abs(Number(row.normalMeanF) - expectedNormal) > 1e-9) {
        failures.push(`${label} ${row.locationId} normal mean does not match the retained payload`)
      }
    } catch (error) {
      failures.push(`${label} ${row.locationId} normal authentication failed: ${error.message}`)
    }
    if (row.forecastSampleProvenanceDigestSha256 !== provenanceDigest) {
      failures.push(`${label} ${row.locationId} is not bound to the score provenance`)
    }
    const vectorDigest = forecastSampleVectorDigestSha256({
      contractId: row.forecastTemporalContractId,
      issueDate: row.issueDate,
      targetDate: row.targetDate,
      leadDays: row.leadDays,
      modelId: row.modelId,
      locationId: row.locationId,
      weight: row.weight,
      offsets: REVIEWED_OFFSETS,
      sampleValuesF: values,
      normalMeanF: row.normalMeanF,
      forecastAnomalyF: row.forecastAnomalyF,
      normalSourceContractId: row.normalSourceContractId,
      normalSourceContractDigestSha256: row.normalSourceContractDigestSha256,
      normalSourcePayloadDigestSha256: row.normalSourcePayloadDigestSha256,
      provenanceDigestSha256: provenanceDigest,
    })
    if (row.forecastSampleVectorDigestSha256 !== vectorDigest) {
      failures.push(`${label} ${row.locationId} vector digest is stale or malformed`)
    }
  }
  const locationSetDigest = forecastLocationSampleSetDigestSha256({
    contractId: score?.forecastTemporalContractId,
    issueDate: score?.issueDate,
    targetDate: score?.targetDate,
    leadDays: score?.leadDays,
    modelId: score?.modelId,
    locationRows,
  })
  if (score?.locationSampleVectorSetDigestSha256 !== locationSetDigest) {
    failures.push(`${label} score does not bind the complete location-vector set`)
  }
  if (sourceModelId(sourceId) !== score?.modelId) failures.push(`${label} modelId is not the reviewed ${sourceId} model`)
  return failures
}

export function summarizeSpatialDemandRevisionForecastInputs({
  sourceId,
  manifest,
  scoreRows,
  locationRows,
}) {
  const failures = []
  if (!REVIEWED_SOURCE_IDS.includes(sourceId)) failures.push(`Unsupported research-shadow source ${sourceId}`)
  const temporal = manifest?.temporalSampling
  if (manifest?.forecastSource !== sourceId) failures.push(`${sourceId} manifest source identity is inconsistent`)
  if (manifest?.runHour !== '00') failures.push(`${sourceId} manifest runHour must be 00`)
  if (!sameArray((manifest?.leadDays ?? []).map(Number), REVIEWED_LEADS)) {
    failures.push(`${sourceId} manifest leadDays must be exactly 7,8`)
  }
  const manifestOffsets = manifest?.validTimeOffsetsHoursFromTargetUtcMidnight ?? manifest?.validHoursUtc
  if (!sameArray((manifestOffsets ?? []).map(Number), REVIEWED_OFFSETS)) {
    failures.push(`${sourceId} manifest offsets must be exactly 6,12,18,24`)
  }
  if (temporal?.contractId !== REVIEWED_TEMPORAL_CONTRACT_ID
    || temporal?.forecastIssueRunHourUtc !== '00'
    || temporal?.aggregation !== 'equal-weighted-arithmetic-mean'
    || temporal?.summerExecutionEligible !== false) {
    failures.push(`${sourceId} manifest temporal metadata is not the reviewed research-only multi-lead contract`)
  }
  if (!Array.isArray(scoreRows) || !scoreRows.length) failures.push(`${sourceId} score rows are empty`)
  if (!Array.isArray(locationRows) || !locationRows.length) failures.push(`${sourceId} location rows are empty`)

  let validatedScores = Array.isArray(scoreRows) ? scoreRows : []
  let validatedLocations = Array.isArray(locationRows) ? locationRows : []
  try {
    const validated = validateForecastCalendarTemperatures({
      scoreRows: validatedScores,
      locationRows: validatedLocations,
      mode: 'reject',
      label: `${sourceId} spatial-demand-revision inputs`,
      sourceId,
      scoreLocationAggregateContract: FORECAST_SCORE_LOCATION_AGGREGATE_CONTRACT,
    })
    validatedScores = validated.scoreRows
    validatedLocations = validated.locationRows
  } catch (error) {
    failures.push(error.message)
  }

  const locationsByGroup = new Map()
  for (const row of validatedLocations) {
    const key = forecastGroupKey(row, sourceId)
    locationsByGroup.set(key, [...(locationsByGroup.get(key) ?? []), row])
  }
  const scoreGroups = new Set()
  for (const score of validatedScores) {
    const label = `${sourceId} ${score.issueDate} lead-${score.leadDays}`
    const key = forecastGroupKey(score, sourceId)
    if (scoreGroups.has(key)) failures.push(`${label} score group is duplicated`)
    scoreGroups.add(key)
    const lead = Number(score.leadDays)
    if (!REVIEWED_LEADS.includes(lead)) failures.push(`${label} is outside the reviewed lead set`)
    if (score.windowId !== 'rumor') failures.push(`${label} windowId must be rumor`)
    if (score.forecastTemporalContractId !== REVIEWED_TEMPORAL_CONTRACT_ID) {
      failures.push(`${label} temporal contract id is inconsistent`)
    }
    if (!sameArray(parsedNumberList(score.sampledValidTimeOffsetsHours), REVIEWED_OFFSETS)
      || !sameArray(parsedNumberList(score.sampledValidHoursUtc), REVIEWED_OFFSETS)) {
      failures.push(`${label} sampled offsets must be exactly 6|12|18|24`)
    }
    try {
      if (score.targetDate !== addDays(score.issueDate, lead)) failures.push(`${label} targetDate does not equal issueDate plus leadDays`)
    } catch (error) {
      failures.push(`${label} date identity is invalid: ${error.message}`)
    }
    const groupLocations = locationsByGroup.get(key) ?? []
    failures.push(...expectedUniverseFailures(groupLocations, label))
    failures.push(...provenanceFailures({ score, locationRows: groupLocations, sourceId, label }))
  }
  for (const key of locationsByGroup.keys()) {
    if (!scoreGroups.has(key)) failures.push(`${sourceId} location group ${key} has no score row`)
  }
  const uniqueFailures = [...new Set(failures)]
  return {
    schemaVersion: SPATIAL_DEMAND_REVISION_FEATURE_SCHEMA_VERSION,
    contractId: SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT.contractId,
    sourceId,
    complete: uniqueFailures.length === 0,
    scoreRowCount: validatedScores.length,
    locationRowCount: validatedLocations.length,
    failures: uniqueFailures,
  }
}

export function assertSpatialDemandRevisionForecastInputs(inputs) {
  const summary = summarizeSpatialDemandRevisionForecastInputs(inputs)
  if (!summary.complete) {
    const error = new Error(`Spatial-demand-revision forecast inputs are invalid: ${summary.failures.join('; ')}.`)
    error.name = 'SpatialDemandRevisionForecastContractError'
    error.diagnostics = summary
    throw error
  }
  return summary
}

function demandValueF({ season, forecastMeanF, normalMeanF }) {
  if (season === 'summer') {
    return Math.max(0, forecastMeanF - 65) - Math.max(0, normalMeanF - 65)
  }
  if (season === 'winter') {
    return Math.max(0, 65 - forecastMeanF) - Math.max(0, 65 - normalMeanF)
  }
  throw new Error(`Unsupported shadow season ${season}.`)
}

function atomFeatures({ season, scoreRow, locationRows }) {
  const values = locationRows.map((row) => ({
    locationId: row.locationId,
    region: row.region,
    weight: Number(row.weight),
    forecastMeanF: Number(row.forecastMeanF),
    normalMeanF: Number(row.normalMeanF),
    demandAnomalyF: demandValueF({
      season,
      forecastMeanF: Number(row.forecastMeanF),
      normalMeanF: Number(row.normalMeanF),
    }),
  })).toSorted((left, right) => left.locationId.localeCompare(right.locationId))
  const weighted = (selector) => values.reduce(
    (sum, row) => sum + row.weight * selector(row),
    0,
  ) / REVIEWED_TOTAL_LOCATION_WEIGHT
  const texas = values.filter((row) => ['dallas', 'houston'].includes(row.locationId))
  const texasWeight = texas.reduce((sum, row) => sum + row.weight, 0)
  return {
    issueDate: scoreRow.issueDate,
    weatherTargetDate: scoreRow.targetDate,
    leadDays: Number(scoreRow.leadDays),
    demandLevelF: round(weighted((row) => row.demandAnomalyF), 4),
    positiveDemandBreadthFraction: round(weighted((row) => row.demandAnomalyF > 0 ? 1 : 0), 4),
    negativeDemandBreadthFraction: round(weighted((row) => row.demandAnomalyF < 0 ? 1 : 0), 4),
    positiveDemandTailF: round(weighted((row) => Math.max(0, row.demandAnomalyF - 4)), 4),
    negativeDemandTailF: round(weighted((row) => Math.max(0, -row.demandAnomalyF - 4)), 4),
    positiveExtremeLocationCount: values.filter((row) => row.demandAnomalyF >= 8).length,
    negativeExtremeLocationCount: values.filter((row) => row.demandAnomalyF <= -8).length,
    texasDemandF: round(
      texasWeight
        ? texas.reduce((sum, row) => sum + row.weight * row.demandAnomalyF, 0) / texasWeight
        : 0,
      4,
    ),
    locations: values.map((row) => ({
      locationId: row.locationId,
      weight: row.weight,
      demandAnomalyF: round(row.demandAnomalyF, 4),
    })),
  }
}

function validateGasBars(gasBars, targetDate) {
  if (!Array.isArray(gasBars) || !gasBars.length) throw new Error('NG=F market bars are empty.')
  const normalized = gasBars.map((row) => ({
    date: String(row.date ?? ''),
    close: Number(row.close ?? row.gasClose),
    contract: row.contract ?? 'NG=F',
    provisional: row.provisional === true || String(row.provisional).toLowerCase() === 'true',
  })).toSorted((left, right) => left.date.localeCompare(right.date))
  const seen = new Set()
  for (const row of normalized) {
    isoDateTimestamp(row.date, 'NG=F bar date')
    if (seen.has(row.date)) throw new Error(`NG=F market bars contain duplicate date ${row.date}.`)
    seen.add(row.date)
    if (!Number.isFinite(row.close) || row.close <= 0) throw new Error(`NG=F market bar ${row.date} has an invalid close.`)
    if (row.contract !== 'NG=F') throw new Error(`Market response requires NG=F; received ${row.contract}.`)
    if (row.provisional) throw new Error(`NG=F market bar ${row.date} is provisional.`)
    if (row.date >= targetDate) throw new Error(`NG=F target-date or future bar ${row.date} is forbidden.`)
  }
  return normalized
}

function marketPriceResponse({ gasBars, currentIssueDate, targetDate }) {
  const rows = validateGasBars(gasBars, targetDate)
  const endIndex = rows.findIndex((row) => row.date === currentIssueDate)
  if (endIndex <= 0) {
    throw new Error(`NG=F market history must contain the current issue-session close ${currentIssueDate} and a prior session.`)
  }
  const start = rows[endIndex - 1]
  const end = rows[endIndex]
  const expectedStartDate = previousReviewedMarketSession(currentIssueDate)
  if (start.date !== expectedStartDate) {
    throw new Error(
      `NG=F price response must start on reviewed session ${expectedStartDate}; received ${start.date}.`,
    )
  }
  return {
    symbol: 'NG=F',
    contract: SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT.priceResponse.contract,
    startSessionDate: start.date,
    endSessionDate: end.date,
    startClose: start.close,
    endClose: end.close,
    responsePct: round((end.close / start.close - 1) * 100, 4),
    completedSessionCutoffExclusive: targetDate,
  }
}

function groupRowsByAtom(rows, sourceId) {
  const groups = new Map()
  for (const row of rows) {
    const key = forecastGroupKey(row, sourceId)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return groups
}

function sourceRevisionFeatures({ season, sourceId, scoreRows, locationRows, currentIssueDate }) {
  const priorIssueDate = addDays(currentIssueDate, -1)
  const weatherTargetDate = addDays(currentIssueDate, 7)
  const score = (issueDate, leadDays) => scoreRows.find((row) => (
    row.issueDate === issueDate
    && row.targetDate === weatherTargetDate
    && Number(row.leadDays) === leadDays
    && row.modelId === sourceModelId(sourceId)
  ))
  const currentScore = score(currentIssueDate, 7)
  const priorScore = score(priorIssueDate, 8)
  if (!currentScore || !priorScore) {
    throw new Error(`${sourceId} is missing the same-target lead-8 to lead-7 pair for ${weatherTargetDate}.`)
  }
  const grouped = groupRowsByAtom(locationRows, sourceId)
  const currentRows = grouped.get(forecastGroupKey(currentScore, sourceId)) ?? []
  const priorRows = grouped.get(forecastGroupKey(priorScore, sourceId)) ?? []
  const current = atomFeatures({ season, scoreRow: currentScore, locationRows: currentRows })
  const prior = atomFeatures({ season, scoreRow: priorScore, locationRows: priorRows })
  const priorByLocation = new Map(prior.locations.map((row) => [row.locationId, row]))
  const locationRevisions = current.locations.map((row) => {
    const old = priorByLocation.get(row.locationId)
    if (!old || Math.abs(old.weight - row.weight) > 1e-9) {
      throw new Error(`${sourceId} changed the location universe between vintages at ${row.locationId}.`)
    }
    const currentRaw = currentRows.find((candidate) => candidate.locationId === row.locationId)
    const priorRaw = priorRows.find((candidate) => candidate.locationId === row.locationId)
    if (Math.abs(Number(currentRaw?.normalMeanF) - Number(priorRaw?.normalMeanF)) > 1e-9
      || currentRaw?.normalSourcePayloadDigestSha256 !== priorRaw?.normalSourcePayloadDigestSha256) {
      throw new Error(`${sourceId} changed the reviewed normal between vintages at ${row.locationId}.`)
    }
    return {
      locationId: row.locationId,
      weight: row.weight,
      priorDemandAnomalyF: old.demandAnomalyF,
      currentDemandAnomalyF: row.demandAnomalyF,
      demandRevisionF: round(row.demandAnomalyF - old.demandAnomalyF, 4),
    }
  })
  return {
    sourceId,
    prior,
    current,
    revision: {
      demandLevelF: round(current.demandLevelF - prior.demandLevelF, 4),
      positiveDemandBreadthFraction: round(
        current.positiveDemandBreadthFraction - prior.positiveDemandBreadthFraction,
        4,
      ),
      negativeDemandBreadthFraction: round(
        current.negativeDemandBreadthFraction - prior.negativeDemandBreadthFraction,
        4,
      ),
      positiveDemandTailF: round(current.positiveDemandTailF - prior.positiveDemandTailF, 4),
      negativeDemandTailF: round(current.negativeDemandTailF - prior.negativeDemandTailF, 4),
      texasDemandF: round(current.texasDemandF - prior.texasDemandF, 4),
      locations: locationRevisions,
    },
  }
}

export function spatialDemandRevisionSeasonForDate(targetDate) {
  isoDateTimestamp(targetDate, 'targetDate')
  if (executableLiveComponentActiveForDate({ season: 'summer', targetDate })) return 'summer'
  if (executableLiveComponentActiveForDate({ season: 'winter', targetDate })) return 'winter'
  return 'inactive'
}

export function previousReviewedMarketSession(targetDate) {
  isoDateTimestamp(targetDate, 'targetDate')
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = addDays(targetDate, -offset)
    if (summerShadowMarketSessionStatus(candidate).session) return candidate
  }
  throw new Error(`Could not resolve a reviewed prior market session for ${targetDate}.`)
}

export function nextReviewedMarketSession(targetDate) {
  isoDateTimestamp(targetDate, 'targetDate')
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = addDays(targetDate, offset)
    const status = summerShadowMarketSessionStatus(candidate)
    if (status.reason === 'unreviewed-session-calendar-year') {
      throw new Error(`Reviewed market-session calendar does not cover ${candidate}.`)
    }
    if (status.session) return candidate
  }
  throw new Error(`Could not resolve a reviewed next market session for ${targetDate}.`)
}

export function buildSpatialDemandRevisionFeatures({
  targetDate,
  sourceInputs,
  gasBars,
}) {
  isoDateTimestamp(targetDate, 'targetDate')
  const season = spatialDemandRevisionSeasonForDate(targetDate)
  if (season === 'inactive') {
    return {
      schemaVersion: SPATIAL_DEMAND_REVISION_FEATURE_SCHEMA_VERSION,
      contractId: SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT.contractId,
      contractDigestSha256: SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256,
      executionEligible: false,
      targetDate,
      season,
      complete: true,
      currentIssueDate: null,
      weatherTargetDate: null,
      sourceIds: REVIEWED_SOURCE_IDS,
      sourceFeatures: [],
      consensus: null,
      priceResponse: null,
      diagnostics: { status: 'inactive-season', failures: [] },
    }
  }
  if (!Array.isArray(sourceInputs)) throw new Error('sourceInputs must be an array.')
  const bySource = new Map(sourceInputs.map((input) => [input.sourceId, input]))
  if (sourceInputs.length !== REVIEWED_SOURCE_IDS.length
    || bySource.size !== REVIEWED_SOURCE_IDS.length
    || REVIEWED_SOURCE_IDS.some((sourceId) => !bySource.has(sourceId))) {
    throw new Error('Spatial-demand revision requires the complete GFS/GEFS source set with no substitutions.')
  }
  const currentIssueDate = previousReviewedMarketSession(targetDate)
  const sourceFeatures = REVIEWED_SOURCE_IDS.map((sourceId) => {
    const input = bySource.get(sourceId)
    assertSpatialDemandRevisionForecastInputs(input)
    return sourceRevisionFeatures({
      season,
      sourceId,
      scoreRows: input.scoreRows,
      locationRows: input.locationRows,
      currentIssueDate,
    })
  })
  const weatherTargetDate = sourceFeatures[0].current.weatherTargetDate
  if (sourceFeatures.some((source) => source.current.weatherTargetDate !== weatherTargetDate)) {
    throw new Error('GFS and GEFS revisions do not share the exact weather target date.')
  }
  const locationIds = SUMMER_FORECAST_LOCATIONS.map((row) => row.id).toSorted()
  const consensusLocations = locationIds.map((locationId) => {
    const rows = sourceFeatures.map((source) => source.revision.locations.find((row) => row.locationId === locationId))
    if (rows.some((row) => !row)) throw new Error(`The complete source set is missing ${locationId}.`)
    return {
      locationId,
      weight: rows[0].weight,
      demandRevisionF: round(rows.reduce((sum, row) => sum + row.demandRevisionF, 0) / rows.length, 4),
    }
  })
  const mean = (selector) => round(
    sourceFeatures.reduce((sum, source) => sum + selector(source), 0) / sourceFeatures.length,
    4,
  )
  const consensusRevision = mean((source) => source.revision.demandLevelF)
  const direction = Math.sign(consensusRevision)
  const directionalBreadthFraction = direction === 0
    ? 0
    : round(consensusLocations
      .filter((row) => (
        Math.sign(row.demandRevisionF) === direction
        && Math.abs(row.demandRevisionF)
          >= SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT.demand.materialRevisionBreadthThresholdF
      ))
      .reduce((sum, row) => sum + row.weight, 0) / REVIEWED_TOTAL_LOCATION_WEIGHT, 4)
  const priceResponse = marketPriceResponse({ gasBars, currentIssueDate, targetDate })
  return {
    schemaVersion: SPATIAL_DEMAND_REVISION_FEATURE_SCHEMA_VERSION,
    contractId: SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT.contractId,
    contractDigestSha256: SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256,
    executionEligible: false,
    targetDate,
    season,
    complete: true,
    currentIssueDate,
    priorIssueDate: addDays(currentIssueDate, -1),
    weatherTargetDate,
    sourceIds: REVIEWED_SOURCE_IDS,
    sourceFeatures,
    consensus: {
      currentDemandLevelF: mean((source) => source.current.demandLevelF),
      priorDemandLevelF: mean((source) => source.prior.demandLevelF),
      demandRevisionF: consensusRevision,
      demandRevisionDirection: direction,
      directionalBreadthFraction,
      currentLevelDisagreementF: round(
        Math.abs(sourceFeatures[0].current.demandLevelF - sourceFeatures[1].current.demandLevelF),
        4,
      ),
      revisionDisagreementF: round(
        Math.abs(sourceFeatures[0].revision.demandLevelF - sourceFeatures[1].revision.demandLevelF),
        4,
      ),
      texasDemandRevisionF: mean((source) => source.revision.texasDemandF),
      positiveDemandTailRevisionF: mean((source) => source.revision.positiveDemandTailF),
      negativeDemandTailRevisionF: mean((source) => source.revision.negativeDemandTailF),
      locations: consensusLocations,
    },
    priceResponse,
    diagnostics: { status: 'complete', failures: [] },
  }
}

function flatShadowTarget({ targetDate, signalDate, reason }) {
  return {
    strategyId: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.strategyId,
    componentStrategyId: 'index-fallback',
    candidateId: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.candidateId,
    candidateContractDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256,
    executionEligible: false,
    targetDate,
    direction: 'flat',
    gasPosition: 0,
    indexFraction: 1,
    cashFraction: 0,
    signalDate: signalDate ?? targetDate,
    confidence: 0,
    windowId: 'index-fallback',
    thesisKind: 'index-fallback',
    decisionReason: reason,
  }
}

export function spatialDemandRevisionShadowDecision(featureBundle) {
  if (!featureBundle || typeof featureBundle !== 'object' || featureBundle.complete !== true) {
    return { status: 'input-failure', target: null, reason: 'feature-inputs-incomplete' }
  }
  if (featureBundle.contractDigestSha256 !== SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256) {
    throw new Error('Feature bundle does not match the frozen spatial-demand-revision feature contract.')
  }
  if (featureBundle.season === 'inactive') {
    return {
      status: 'valid-flat',
      target: flatShadowTarget({
        targetDate: featureBundle.targetDate,
        signalDate: featureBundle.targetDate,
        reason: 'inactive-season',
      }),
      reason: 'inactive-season',
    }
  }
  const rules = SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.rules
  const sourceDirections = featureBundle.sourceFeatures.map((source) => Math.sign(source.revision.demandLevelF))
  const direction = Math.sign(featureBundle.consensus.demandRevisionF)
  const gates = {
    completeModelDirectionAgreement:
      direction !== 0 && sourceDirections.every((sourceDirection) => sourceDirection === direction),
    minimumRevision:
      Math.abs(featureBundle.consensus.demandRevisionF) >= rules.minimumAbsoluteConsensusDemandRevisionF,
    minimumBreadth:
      featureBundle.consensus.directionalBreadthFraction >= rules.minimumDirectionalBreadthFraction,
    summerDirectionAllowed: featureBundle.season !== 'summer' || direction > 0,
    priceNotAlreadyMovingWithRevision: direction * featureBundle.priceResponse.responsePct <= 0,
  }
  const failed = Object.entries(gates).filter(([, passed]) => !passed).map(([gate]) => gate)
  if (failed.length) {
    return {
      status: 'valid-flat',
      target: {
        ...flatShadowTarget({
          targetDate: featureBundle.targetDate,
          signalDate: featureBundle.currentIssueDate,
          reason: failed.join('|'),
        }),
        gates,
      },
      reason: failed.join('|'),
    }
  }
  const gasPosition = round(direction * rules.gasPositionFraction, 4)
  const thesisKind = featureBundle.season === 'summer'
    ? 'summer-demand-revision-long'
    : direction > 0
      ? 'winter-demand-revision-long'
      : 'winter-demand-revision-short'
  return {
    status: 'valid-signal',
    reason: 'all-frozen-gates-passed',
    target: {
      strategyId: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.strategyId,
      componentStrategyId: `research-only-${featureBundle.season}-spatial-demand-revision`,
      candidateId: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.candidateId,
      candidateContractDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256,
      executionEligible: false,
      targetDate: featureBundle.targetDate,
      direction: gasPosition > 0 ? 'long' : 'short',
      gasPosition,
      indexFraction: round(1 - Math.abs(gasPosition), 4),
      cashFraction: 0,
      signalDate: featureBundle.currentIssueDate,
      weatherTargetDate: featureBundle.weatherTargetDate,
      confidence: round(Math.min(
        1,
        Math.abs(featureBundle.consensus.demandRevisionF)
          / rules.minimumAbsoluteConsensusDemandRevisionF
          * featureBundle.consensus.directionalBreadthFraction,
      ), 4),
      windowId: 'weather-follow',
      thesisKind,
      sourceIds: REVIEWED_SOURCE_IDS,
      gates,
      decisionReason: 'all-frozen-gates-passed',
    },
  }
}

function newYorkClock(timestamp) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

export function spatialDemandRevisionRecordTiming({ targetDate, generatedAt, prospectiveStart }) {
  try {
    isoDateTimestamp(targetDate, 'targetDate')
    isoDateTimestamp(prospectiveStart, 'prospectiveStart')
  } catch {
    return { eligible: false, reason: 'invalid-target-date' }
  }
  if (targetDate < prospectiveStart) return { eligible: false, reason: 'before-prospective-start' }
  const session = summerShadowMarketSessionStatus(targetDate)
  if (!session.session) return { eligible: false, reason: session.reason }
  const clock = newYorkClock(generatedAt)
  if (!clock) return { eligible: false, reason: 'invalid-generation-time' }
  if (clock.date !== targetDate) return { eligible: false, reason: 'not-target-session-date' }
  if (clock.minuteOfDay >= 570) return { eligible: false, reason: 'at-or-after-session-open' }
  return { eligible: true, reason: null }
}

function assertTargetProjection(target, recordTargetDate) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('candidateTarget must be an object.')
  if (target.executionEligible !== false
    || target.strategyId !== SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.strategyId
    || target.candidateId !== SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.candidateId
    || target.candidateContractDigestSha256 !== SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256) {
    throw new Error('candidateTarget does not match the frozen research-only candidate.')
  }
  if (target.targetDate !== recordTargetDate) throw new Error('candidateTarget.targetDate must match the record targetDate.')
  for (const field of ['gasPosition', 'indexFraction', 'cashFraction', 'confidence']) {
    if (!Number.isFinite(target[field])) throw new Error(`candidateTarget.${field} must be finite.`)
  }
  if (target.cashFraction !== 0 || target.indexFraction !== round(1 - Math.abs(target.gasPosition), 4)) {
    throw new Error('candidateTarget must use exact zero cash and one-minus-absolute-gas index allocation.')
  }
  if (![0, -0.25, 0.25].includes(target.gasPosition)) {
    throw new Error('candidateTarget gasPosition is outside the frozen research shadow lattice.')
  }
  const direction = target.gasPosition > 0 ? 'long' : target.gasPosition < 0 ? 'short' : 'flat'
  if (target.direction !== direction) throw new Error('candidateTarget direction must match gasPosition.')
  if (target.gasPosition === 0) {
    if (target.componentStrategyId !== 'index-fallback'
      || target.windowId !== 'index-fallback'
      || target.thesisKind !== 'index-fallback') {
      throw new Error('Flat candidate targets must use coherent index-fallback provenance.')
    }
  } else if (!String(target.componentStrategyId).startsWith('research-only-')
    || target.windowId !== 'weather-follow'
    || target.thesisKind === 'index-fallback') {
    throw new Error('Nonzero candidate targets must use coherent research-only weather-follow provenance.')
  }
}

export function createSpatialDemandRevisionTargetRecord({
  generatedAt,
  targetDate,
  manifestDigestSha256,
  referenceStrategyContractDigestSha256,
  referenceStrategyArtifactCoreDigestSha256,
  featureBundle = null,
  decision,
  inputProvenance,
  diagnostics = null,
}) {
  const record = {
    schemaVersion: SPATIAL_DEMAND_REVISION_TARGET_RECORD_SCHEMA_VERSION,
    recordKind: 'research-only-spatial-demand-revision-target',
    generatedAt,
    targetDate,
    executionEligible: false,
    registryId: SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY.registryId,
    registryDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY_DIGEST_SHA256,
    manifestDigestSha256,
    referenceStrategyContractDigestSha256,
    referenceStrategyArtifactCoreDigestSha256,
    featureContractDigestSha256: SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256,
    candidateContractDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256,
    featureBundle,
    decision,
    inputProvenance,
    diagnostics,
  }
  record.recordDigestSha256 = spatialDemandRevisionDigestSha256(record)
  validateSpatialDemandRevisionTargetRecord(record)
  return record
}

export function validateSpatialDemandRevisionTargetRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Shadow target record must be an object.')
  if (record.schemaVersion !== SPATIAL_DEMAND_REVISION_TARGET_RECORD_SCHEMA_VERSION
    || record.recordKind !== 'research-only-spatial-demand-revision-target'
    || record.executionEligible !== false
    || record.registryId !== SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY.registryId
    || record.registryDigestSha256 !== SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY_DIGEST_SHA256
    || record.featureContractDigestSha256 !== SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256
    || record.candidateContractDigestSha256 !== SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256) {
    throw new Error('Shadow target record does not match the frozen research-only registry.')
  }
  isoDateTimestamp(record.targetDate, 'targetDate')
  const generatedAt = new Date(record.generatedAt)
  if (Number.isNaN(generatedAt.getTime()) || generatedAt.toISOString() !== record.generatedAt) {
    throw new Error('Shadow target record generatedAt must be a canonical ISO timestamp.')
  }
  for (const [label, digest] of [
    ['manifest', record.manifestDigestSha256],
    ['reference strategy', record.referenceStrategyContractDigestSha256],
    ['reference artifact core', record.referenceStrategyArtifactCoreDigestSha256],
  ]) {
    if (!SHA256_PATTERN.test(String(digest ?? ''))) throw new Error(`${label} digest must be a lowercase SHA-256 digest.`)
  }
  if (!record.decision || !['valid-signal', 'valid-flat', 'input-failure'].includes(record.decision.status)) {
    throw new Error('Shadow target record decision status is invalid.')
  }
  if (record.decision.status === 'input-failure') {
    if (record.decision.target !== null || record.featureBundle !== null) {
      throw new Error('Input-failure records must preserve missing features and must not synthesize a flat target.')
    }
    if (record.inputProvenance?.dataCollectionStatus !== 'input-failure') {
      throw new Error('Input-failure records must preserve inputProvenance.dataCollectionStatus=input-failure.')
    }
  } else {
    if (!record.featureBundle || record.featureBundle.complete !== true) {
      throw new Error('Valid decisions require a complete feature bundle.')
    }
    if (record.featureBundle.targetDate !== record.targetDate
      || record.featureBundle.contractDigestSha256 !== SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256) {
      throw new Error('Feature bundle does not bind the record target and frozen feature contract.')
    }
    assertTargetProjection(record.decision.target, record.targetDate)
  }
  if (!record.inputProvenance || typeof record.inputProvenance !== 'object' || Array.isArray(record.inputProvenance)) {
    throw new Error('inputProvenance must be an object.')
  }
  if (!Array.isArray(record.inputProvenance.forecastAtoms)
    || !Array.isArray(record.inputProvenance.marketRows)) {
    throw new Error('inputProvenance must retain forecastAtoms and marketRows arrays.')
  }
  for (const [field, value] of [
    ['forecastInputsDigestSha256', record.inputProvenance.forecastAtoms],
    ['marketRowsDigestSha256', record.inputProvenance.marketRows],
    ['marketSourceDigestSha256', record.inputProvenance.marketSource],
  ]) {
    if (!SHA256_PATTERN.test(String(record.inputProvenance[field] ?? ''))) {
      throw new Error(`inputProvenance.${field} must be a lowercase SHA-256 digest.`)
    }
    if (record.inputProvenance[field] !== spatialDemandRevisionDigestSha256(value)) {
      throw new Error(`inputProvenance.${field} does not bind its retained inputs.`)
    }
  }
  if (record.decision.status !== 'input-failure') {
    for (const atom of record.inputProvenance.forecastAtoms) {
      if (!atom || typeof atom !== 'object' || !atom.manifest
        || atom.manifestDigestSha256 !== spatialDemandRevisionDigestSha256(atom.manifest)) {
        throw new Error('A retained forecast atom has an invalid manifest binding.')
      }
    }
    const activeMarketFeature = record.featureBundle?.season !== 'inactive'
    if (activeMarketFeature) {
      const source = record.inputProvenance.marketSource
      const expectedUrl = spatialDemandRevisionYahooChartUrl({
        symbol: 'NG=F',
        targetDate: record.targetDate,
      })
      if (!source
        || source.sourceId !== 'yahoo-chart-api'
        || source.symbol !== 'NG=F'
        || source.sourceUrl !== expectedUrl
        || !SHA256_PATTERN.test(String(source.responsePayloadDigestSha256 ?? ''))) {
        throw new Error('Valid active records require the exact reviewed Yahoo NG=F source identity and payload digest.')
      }
      if (record.inputProvenance.marketRows.some((row) => (
        row.sourceUrl !== source.sourceUrl
        || row.responsePayloadDigestSha256 !== source.responsePayloadDigestSha256
      ))) {
        throw new Error('Retained market rows are not bound to the reviewed Yahoo response payload.')
      }
    } else if (record.inputProvenance.marketSource !== null
      || record.inputProvenance.marketRows.length !== 0) {
      throw new Error('Inactive records must not fabricate a market source or market rows.')
    }
    const rebuiltFeatureBundle = buildSpatialDemandRevisionFeatures({
      targetDate: record.targetDate,
      sourceInputs: record.inputProvenance.forecastAtoms,
      gasBars: record.inputProvenance.marketRows,
    })
    if (!canonicalValuesEqual(record.featureBundle, rebuiltFeatureBundle)) {
      throw new Error('Feature bundle does not reproduce from the retained forecast and market inputs.')
    }
    const rebuiltDecision = spatialDemandRevisionShadowDecision(rebuiltFeatureBundle)
    if (!canonicalValuesEqual(record.decision, rebuiltDecision)) {
      throw new Error('Shadow decision does not reproduce from the retained feature bundle.')
    }
  }
  const projected = { ...record }
  delete projected.recordDigestSha256
  if (record.recordDigestSha256 !== spatialDemandRevisionDigestSha256(projected)) {
    throw new Error('Shadow target record digest is stale or malformed.')
  }
  return true
}

function appendClock(testNow) {
  if (testNow === undefined) return new Date()
  if (process.env.NODE_ENV !== 'test'
    || process.env.QORE_TEST_SPATIAL_SHADOW_OVERRIDES !== '1') {
    throw new Error('The spatial-demand-revision test clock requires the explicit test capability.')
  }
  const parsed = new Date(testNow)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== testNow) {
    throw new Error('The spatial-demand-revision test clock must be a canonical ISO timestamp.')
  }
  return parsed
}

export async function appendSpatialDemandRevisionTargetRecord({
  stateDir,
  record,
  prospectiveStart,
  testNow,
}) {
  validateSpatialDemandRevisionTargetRecord(record)
  const now = appendClock(testNow)
  const timing = spatialDemandRevisionRecordTiming({
    targetDate: record.targetDate,
    generatedAt: record.generatedAt,
    prospectiveStart,
  })
  if (!timing.eligible) return { written: false, reason: timing.reason, filePath: null }
  const currentClock = newYorkClock(now.toISOString())
  if (currentClock?.date !== record.targetDate) {
    return { written: false, reason: 'not-current-target-session-date', filePath: null }
  }
  if (currentClock.minuteOfDay >= 570) {
    return { written: false, reason: 'at-or-after-session-open', filePath: null }
  }
  if (Math.abs(now.getTime() - Date.parse(record.generatedAt)) > MAX_APPEND_CLOCK_SKEW_MS) {
    return { written: false, reason: 'generation-time-not-current', filePath: null }
  }
  const resolvedDir = path.resolve(stateDir)
  await mkdir(resolvedDir, { recursive: true, mode: 0o700 })
  const dirStat = await lstat(resolvedDir)
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error('Shadow target state path must be a real directory.')
  await chmod(resolvedDir, 0o700)
  const filePath = path.join(resolvedDir, `${record.targetDate}.json`)
  const temporaryPath = path.join(resolvedDir, `.${record.targetDate}.${process.pid}.${crypto.randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`)
    await handle.sync()
    await handle.close()
    handle = null
    try {
      await link(temporaryPath, filePath)
    } catch (error) {
      if (error?.code === 'EEXIST') return { written: false, reason: 'already-recorded', filePath }
      throw error
    }
    return { written: true, reason: null, filePath }
  } finally {
    await handle?.close().catch(() => {})
    await unlink(temporaryPath).catch(() => {})
  }
}

export function spatialDemandRevisionSettlementTiming({
  targetDate,
  generatedAt,
  prospectiveStart,
}) {
  try {
    isoDateTimestamp(targetDate, 'targetDate')
    isoDateTimestamp(prospectiveStart, 'prospectiveStart')
  } catch {
    return { eligible: false, reason: 'invalid-target-date' }
  }
  if (targetDate < prospectiveStart) return { eligible: false, reason: 'before-prospective-start' }
  const targetSession = summerShadowMarketSessionStatus(targetDate)
  if (!targetSession.session) return { eligible: false, reason: targetSession.reason }
  let settlementDate
  try {
    settlementDate = nextReviewedMarketSession(targetDate)
  } catch {
    return { eligible: false, reason: 'unreviewed-session-calendar-year' }
  }
  const clock = newYorkClock(generatedAt)
  if (!clock) return { eligible: false, reason: 'invalid-generation-time' }
  if (clock.date !== settlementDate) return { eligible: false, reason: 'not-next-reviewed-session-date' }
  if (clock.minuteOfDay >= 570) return { eligible: false, reason: 'at-or-after-session-open' }
  return { eligible: true, reason: null, settlementDate }
}

function assertSettlementBar(bar, { label, expectedDate, previous = false }) {
  if (!bar || typeof bar !== 'object' || bar.date !== expectedDate) {
    throw new Error(`${label} must bind reviewed date ${expectedDate}.`)
  }
  const required = previous
    ? ['rawClose', 'adjustedClose']
    : ['rawOpen', 'rawHigh', 'rawLow', 'rawClose', 'adjustedOpen', 'adjustedHigh', 'adjustedLow', 'adjustedClose']
  for (const field of required) {
    if (!Number.isFinite(bar[field]) || bar[field] <= 0) {
      throw new Error(`${label}.${field} must be finite and positive.`)
    }
  }
  if (!previous) {
    if (!Number.isFinite(bar.volume) || bar.volume < 0) throw new Error(`${label}.volume must be non-negative.`)
    if (bar.rawHigh < Math.max(bar.rawOpen, bar.rawClose)
      || bar.rawLow > Math.min(bar.rawOpen, bar.rawClose)
      || bar.rawLow > bar.rawHigh
      || bar.adjustedHigh < Math.max(bar.adjustedOpen, bar.adjustedClose)
      || bar.adjustedLow > Math.min(bar.adjustedOpen, bar.adjustedClose)
      || bar.adjustedLow > bar.adjustedHigh) {
      throw new Error(`${label} OHLC ordering is invalid.`)
    }
    const factor = bar.adjustedClose / bar.rawClose
    if (!Number.isFinite(bar.adjustmentFactor)
      || Math.abs(bar.adjustmentFactor - factor) > 1e-10
      || Math.abs(bar.adjustedOpen - bar.rawOpen * factor) > 1e-8
      || Math.abs(bar.adjustedHigh - bar.rawHigh * factor) > 1e-8
      || Math.abs(bar.adjustedLow - bar.rawLow * factor) > 1e-8) {
      throw new Error(`${label} adjusted OHLC does not reproduce from raw OHLC and adjusted close.`)
    }
  }
}

export function createSpatialDemandRevisionSettlementRecord({
  generatedAt,
  targetDate,
  manifestDigestSha256,
  targetRecordDigestSha256,
  executionContractDigestSha256,
  symbolOutcomes,
}) {
  const record = {
    schemaVersion: SPATIAL_DEMAND_REVISION_SETTLEMENT_RECORD_SCHEMA_VERSION,
    recordKind: 'research-only-spatial-demand-revision-settlement',
    generatedAt,
    targetDate,
    settlementCutoffDate: nextReviewedMarketSession(targetDate),
    executionEligible: false,
    registryDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY_DIGEST_SHA256,
    candidateContractDigestSha256: SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256,
    outcomePolicyDigestSha256: SPATIAL_DEMAND_REVISION_OUTCOME_POLICY_DIGEST_SHA256,
    manifestDigestSha256,
    targetRecordDigestSha256,
    executionContractId:
      SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.outcomePolicy.executionContractId,
    executionContractDigestSha256,
    matchedFallbackTarget: {
      gasPosition: 0,
      indexFraction: 1,
      cashFraction: 0,
    },
    symbolOutcomes,
  }
  record.recordDigestSha256 = spatialDemandRevisionDigestSha256(record)
  validateSpatialDemandRevisionSettlementRecord(record)
  return record
}

export function validateSpatialDemandRevisionSettlementRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Spatial-demand-revision settlement must be an object.')
  }
  if (record.schemaVersion !== SPATIAL_DEMAND_REVISION_SETTLEMENT_RECORD_SCHEMA_VERSION
    || record.recordKind !== 'research-only-spatial-demand-revision-settlement'
    || record.executionEligible !== false
    || record.registryDigestSha256 !== SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY_DIGEST_SHA256
    || record.candidateContractDigestSha256 !== SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256
    || record.outcomePolicyDigestSha256 !== SPATIAL_DEMAND_REVISION_OUTCOME_POLICY_DIGEST_SHA256
    || record.executionContractId
      !== SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.outcomePolicy.executionContractId) {
    throw new Error('Settlement does not match the frozen research-only outcome contract.')
  }
  isoDateTimestamp(record.targetDate, 'settlement targetDate')
  if (record.settlementCutoffDate !== nextReviewedMarketSession(record.targetDate)) {
    throw new Error('Settlement cutoff must be the next reviewed market session.')
  }
  const generatedAt = new Date(record.generatedAt)
  if (Number.isNaN(generatedAt.getTime()) || generatedAt.toISOString() !== record.generatedAt) {
    throw new Error('Settlement generatedAt must be a canonical ISO timestamp.')
  }
  for (const [label, digest] of [
    ['manifest', record.manifestDigestSha256],
    ['target record', record.targetRecordDigestSha256],
    ['execution contract', record.executionContractDigestSha256],
  ]) {
    if (!SHA256_PATTERN.test(String(digest ?? ''))) {
      throw new Error(`Settlement ${label} digest must be a lowercase SHA-256 digest.`)
    }
  }
  if (!canonicalValuesEqual(record.matchedFallbackTarget, {
    gasPosition: 0,
    indexFraction: 1,
    cashFraction: 0,
  })) {
    throw new Error('Settlement matched fallback target is not the frozen index fallback.')
  }
  const expectedSymbols = SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.outcomePolicy.instruments
  if (!Array.isArray(record.symbolOutcomes)
    || !sameArray(record.symbolOutcomes.map((row) => row?.symbol), expectedSymbols)) {
    throw new Error(`Settlement must contain exact ordered outcomes for ${expectedSymbols.join(', ')}.`)
  }
  const expectedPreviousDate = previousReviewedMarketSession(record.targetDate)
  for (const outcome of record.symbolOutcomes) {
    const expectedUrl = spatialDemandRevisionYahooChartUrl({
      symbol: outcome.symbol,
      targetDate: record.settlementCutoffDate,
    })
    if (outcome.sourceId !== 'yahoo-chart-api'
      || outcome.sourceUrl !== expectedUrl
      || !SHA256_PATTERN.test(String(outcome.responsePayloadDigestSha256 ?? ''))) {
      throw new Error(`Settlement ${outcome.symbol} source identity or payload digest is invalid.`)
    }
    assertSettlementBar(outcome.previous, {
      label: `${outcome.symbol}.previous`,
      expectedDate: expectedPreviousDate,
      previous: true,
    })
    assertSettlementBar(outcome.current, {
      label: `${outcome.symbol}.current`,
      expectedDate: record.targetDate,
    })
  }
  const projected = { ...record }
  delete projected.recordDigestSha256
  if (record.recordDigestSha256 !== spatialDemandRevisionDigestSha256(projected)) {
    throw new Error('Settlement record digest is stale or malformed.')
  }
  return true
}

export async function appendSpatialDemandRevisionSettlementRecord({
  stateDir,
  record,
  prospectiveStart,
  testNow,
}) {
  validateSpatialDemandRevisionSettlementRecord(record)
  const now = appendClock(testNow)
  const timing = spatialDemandRevisionSettlementTiming({
    targetDate: record.targetDate,
    generatedAt: record.generatedAt,
    prospectiveStart,
  })
  if (!timing.eligible) return { written: false, reason: timing.reason, filePath: null }
  const currentClock = newYorkClock(now.toISOString())
  if (currentClock?.date !== timing.settlementDate) {
    return { written: false, reason: 'not-current-settlement-session-date', filePath: null }
  }
  if (currentClock.minuteOfDay >= 570) {
    return { written: false, reason: 'at-or-after-session-open', filePath: null }
  }
  if (Math.abs(now.getTime() - Date.parse(record.generatedAt)) > MAX_APPEND_CLOCK_SKEW_MS) {
    return { written: false, reason: 'generation-time-not-current', filePath: null }
  }
  const resolvedDir = path.resolve(stateDir)
  await mkdir(resolvedDir, { recursive: true, mode: 0o700 })
  const dirStat = await lstat(resolvedDir)
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new Error('Settlement state path must be a real directory.')
  }
  await chmod(resolvedDir, 0o700)
  const filePath = path.join(resolvedDir, `${record.targetDate}.json`)
  const temporaryPath = path.join(
    resolvedDir,
    `.${record.targetDate}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  let handle
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`)
    await handle.sync()
    await handle.close()
    handle = null
    try {
      await link(temporaryPath, filePath)
    } catch (error) {
      if (error?.code === 'EEXIST') return { written: false, reason: 'already-settled', filePath }
      throw error
    }
    return { written: true, reason: null, filePath }
  } finally {
    await handle?.close().catch(() => {})
    await unlink(temporaryPath).catch(() => {})
  }
}

export async function readSpatialDemandRevisionManifest(repoDir, manifestPath) {
  const resolvedPath = path.resolve(manifestPath ?? path.join(repoDir, 'config', 'qore-spatial-demand-revision-shadow.json'))
  const raw = await readFile(resolvedPath, 'utf8')
  const manifest = JSON.parse(raw)
  const failures = []
  if (manifest.schemaVersion !== 1
    || manifest.manifestId !== 'qore-spatial-demand-revision-shadow-v1'
    || manifest.registryId !== SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY.registryId
    || manifest.registryDigestSha256 !== SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY_DIGEST_SHA256
    || manifest.featureContractDigestSha256 !== SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT_DIGEST_SHA256
    || manifest.candidateContractDigestSha256 !== SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE_DIGEST_SHA256
    || manifest.outcomePolicyDigestSha256 !== SPATIAL_DEMAND_REVISION_OUTCOME_POLICY_DIGEST_SHA256) {
    failures.push('manifest contract or registry digests do not match the frozen implementation')
  }
  try {
    isoDateTimestamp(manifest.prospectiveStart, 'manifest prospectiveStart')
  } catch (error) {
    failures.push(error.message)
  }
  if (manifest.prospectiveStart !== SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.prospectiveStart) {
    failures.push('manifest prospectiveStart must equal the candidate-frozen prospective start')
  }
  let sealedAt
  try {
    sealedAt = new Date(manifest.sealedAt)
    if (Number.isNaN(sealedAt.getTime()) || sealedAt.toISOString() !== manifest.sealedAt) throw new Error()
    if (sealedAt.toISOString().slice(0, 10) >= manifest.prospectiveStart) {
      failures.push('manifest seal date must be strictly before prospectiveStart')
    }
  } catch {
    failures.push('manifest sealedAt must be a canonical ISO timestamp')
  }
  if (manifest.externalAnchor !== null || manifest.pristineForwardEvidence !== false) {
    failures.push('the local research shadow must not claim an absent external anchor or pristine evidence')
  }
  if (manifest.historicalEvidenceStatus !== 'development-contaminated') {
    failures.push('historicalEvidenceStatus must remain development-contaminated')
  }
  if (manifest.sealStrength !== 'local-hash-only-no-external-chronology-proof') {
    failures.push('sealStrength must disclose the absence of external chronology proof')
  }
  if (manifest.referenceStrategy?.strategyId !== 'ngas-all-year-beta'
    || !SHA256_PATTERN.test(String(manifest.referenceStrategy?.strategyContractDigestSha256 ?? ''))
    || !SHA256_PATTERN.test(String(manifest.referenceStrategy?.strategyArtifactCoreDigestSha256 ?? ''))) {
    failures.push('manifest referenceStrategy must bind ngas-all-year-beta strategy and artifact-core digests')
  }

  const fileCollections = [
    ['implementationFiles', SPATIAL_DEMAND_REVISION_IMPLEMENTATION_PATHS],
    ['immutableInputFiles', SPATIAL_DEMAND_REVISION_INPUT_PATHS],
  ]
  for (const [field, expectedPaths] of fileCollections) {
    const entries = manifest[field]
    if (!Array.isArray(entries)
      || !sameArray(entries.map((entry) => entry?.path), expectedPaths)) {
      failures.push(`${field} must contain the exact sorted reviewed path inventory`)
      continue
    }
    const seenPaths = new Set()
    for (const entry of entries) {
      if (seenPaths.has(entry.path)) failures.push(`${field} contains duplicate path ${entry.path}`)
      seenPaths.add(entry.path)
      if (!SHA256_PATTERN.test(String(entry.digestSha256 ?? ''))) {
        failures.push(`${field} digest is malformed: ${entry.path}`)
      }
    }
  }
  const executionInput = (manifest.immutableInputFiles ?? [])
    .find((entry) => entry?.path === 'config/qore-research-execution.json')
  if (!executionInput
    || manifest.researchExecutionContractDigestSha256 !== executionInput.digestSha256) {
    failures.push('researchExecutionContractDigestSha256 must bind the sealed execution-contract input bytes')
  }

  const repositoryRealPath = await realpath(repoDir)
  for (const entry of [
    ...(manifest.implementationFiles ?? []),
    ...(manifest.immutableInputFiles ?? []),
  ]) {
    if (!entry || typeof entry.path !== 'string') continue
    const filePath = path.resolve(repoDir, entry.path)
    const relative = path.relative(repoDir, filePath)
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      failures.push(`implementation file path escapes the repository: ${entry.path}`)
      continue
    }
    try {
      const linkStat = await lstat(filePath)
      if (!linkStat.isFile() || linkStat.isSymbolicLink()) {
        failures.push(`sealed path must be a regular non-symlink file: ${entry.path}`)
        continue
      }
      const resolvedRealPath = await realpath(filePath)
      const realRelative = path.relative(repositoryRealPath, resolvedRealPath)
      if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        failures.push(`sealed file resolves outside the repository: ${entry.path}`)
        continue
      }
      const bytes = await readFile(filePath)
      const digest = crypto.createHash('sha256').update(bytes).digest('hex')
      if (digest !== entry.digestSha256) failures.push(`implementation file digest changed: ${entry.path}`)
    } catch (error) {
      failures.push(`implementation file is unreadable: ${entry.path}: ${error.message}`)
    }
  }
  const projected = { ...manifest }
  delete projected.manifestDigestSha256
  if (!SHA256_PATTERN.test(String(manifest.manifestDigestSha256 ?? ''))) {
    failures.push('manifestDigestSha256 must be a lowercase SHA-256 digest')
  }
  if (manifest.manifestDigestSha256 !== spatialDemandRevisionDigestSha256(projected)) {
    failures.push('manifestDigestSha256 does not bind the canonical manifest projection')
  }
  if (failures.length) throw new Error(`Spatial-demand-revision shadow manifest is invalid: ${failures.join('; ')}.`)
  return { manifest, manifestDigestSha256: manifest.manifestDigestSha256, path: resolvedPath }
}

validateSpatialDemandRevisionShadowContract()

export function validateSpatialDemandRevisionShadowContract() {
  if (SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.executionEligible
    || SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.publicStrategy) {
    throw new Error('Spatial-demand-revision challenger must remain research-only.')
  }
  if (SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY.familySize !== 1
    || SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY.candidates.length !== 1
    || SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY.productionCandidateRegistry !== false) {
    throw new Error('Spatial-demand-revision registry must remain a separate one-candidate research registry.')
  }
  if (SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.rules.gasPositionFraction !== 0.25) {
    throw new Error('Spatial-demand-revision shadow position must remain on the frozen 0.25 lattice point.')
  }
  return true
}
