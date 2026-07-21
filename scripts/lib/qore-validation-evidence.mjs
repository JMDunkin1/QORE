import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION = 2
export const FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID = 'ngas-all-year-beta-forward-evidence-v2'
export const PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID = 'ngas-all-year-beta-paper-execution-evidence-v2'
export const REVIEWED_NYSE_CALENDAR_ID = 'nyse-full-day-sessions-2020-2035-v1'

const STRATEGY_ID = 'ngas-all-year-beta'
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_EVIDENCE_ARTIFACT_BYTES = 5 * 1024 * 1024
const FORWARD_FILE_NAME = 'ngas-all-year-beta-forward-evidence.json'
const PAPER_FILE_NAME = 'ngas-all-year-beta-paper-execution-evidence.json'
const ALLOWED_ORDER_SYMBOLS = new Set(['UNG', 'VOO', 'QQQM'])
const ALLOWED_ORDER_STATUSES = new Set(['filled', 'canceled', 'rejected'])
const ALLOWED_ORDER_SIDES = new Set(['buy', 'sell'])
const NYSE_CALENDAR_START_YEAR = 2020
const NYSE_CALENDAR_END_YEAR = 2035
const NYSE_OPEN_MINUTE = 9 * 60 + 30
const MAX_REFERENCE_QUOTE_AGE_MS = 5 * 60 * 1000
const MAX_REFERENCE_QUOTE_FUTURE_SKEW_MS = 5 * 1000
const POSITION_TOLERANCE = 1e-8

const EXTRAORDINARY_NYSE_CLOSURES = new Set([
  '2025-01-09', // National Day of Mourning for President Jimmy Carter.
])

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !value) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function isSha256(value) {
  return SHA256_PATTERN.test(String(value ?? ''))
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function positiveFiniteNumber(value) {
  return finiteNumber(value) && value > 0
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function addDays(date, count) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + count * 86400000).toISOString().slice(0, 10)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function canonicalDigestSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function forwardInferenceDigestSha256(inference) {
  return canonicalDigestSha256(inference)
}

function brokerRecord(order) {
  return {
    orderIdSha256: order?.orderIdSha256 ?? null,
    symbol: order?.symbol ?? null,
    side: order?.side ?? null,
    quantity: order?.quantity ?? null,
    status: order?.status ?? null,
    submittedAt: order?.submittedAt ?? null,
    filledAt: order?.filledAt ?? null,
    averageFillPriceUsd: order?.averageFillPriceUsd ?? null,
    prePositionQuantity: order?.prePositionQuantity ?? null,
    postPositionQuantity: order?.postPositionQuantity ?? null,
  }
}

export function paperBrokerRecordDigestSha256(order) {
  return canonicalDigestSha256(brokerRecord(order))
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function nearestRankPercentile(values, percentile) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)]
}

function artifactPaths(repoDir, manifestPath) {
  const defaultManifestPath = path.join(repoDir, 'config', 'qore-validation-integrity.json')
  const testOverride = path.resolve(manifestPath) !== path.resolve(defaultManifestPath)
  const evidenceDir = testOverride
    ? path.dirname(path.resolve(manifestPath))
    : path.join(repoDir, '.local', 'qore', 'validation-evidence')
  return {
    forward: path.join(evidenceDir, FORWARD_FILE_NAME),
    paper: path.join(evidenceDir, PAPER_FILE_NAME),
  }
}

export function resolveValidationEvidenceArtifactPaths(repoDir, manifestPath) {
  return artifactPaths(repoDir, manifestPath)
}

function readProtectedArtifact(filePath, label) {
  let fileStat
  let raw
  try {
    fileStat = fs.lstatSync(filePath)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error('must be a regular file and must not be a symlink')
    }
    if ((fileStat.mode & 0o077) !== 0) {
      throw new Error('must not grant group or other filesystem permissions')
    }
    if (typeof process.getuid === 'function' && fileStat.uid !== process.getuid()) {
      throw new Error('must be owned by the current runtime user')
    }
    if (fileStat.size > MAX_EVIDENCE_ARTIFACT_BYTES) {
      throw new Error(`must not exceed ${MAX_EVIDENCE_ARTIFACT_BYTES} bytes`)
    }
    raw = fs.readFileSync(filePath)
  } catch (error) {
    throw new Error(`Unable to read protected ${label}: ${error.message}`)
  }

  let artifact
  try {
    artifact = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    throw new Error(`Unable to parse protected ${label}: ${error.message}`)
  }
  return {
    artifact,
    digestSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  }
}

function nthWeekdayOfMonth(year, month, weekday, occurrence) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const day = 1 + ((weekday - first + 7) % 7) + (occurrence - 1) * 7
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function lastWeekdayOfMonth(year, month, weekday) {
  const final = new Date(Date.UTC(year, month, 0))
  const day = final.getUTCDate() - ((final.getUTCDay() - weekday + 7) % 7)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function observedFixedHoliday(year, month, day) {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
  if (weekday === 6) return addDays(date, -1)
  if (weekday === 0) return addDays(date, 1)
  return date
}

function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function nyseClosureDates(year) {
  const dates = new Set([
    observedFixedHoliday(year, 1, 1),
    observedFixedHoliday(year + 1, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    addDays(easterSunday(year), -2),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ])
  if (year >= 2022) dates.add(observedFixedHoliday(year, 6, 19))
  return dates
}

export function reviewedNyseSessionStatus(date) {
  if (!isDate(date)) return { session: false, reason: 'invalid-calendar-date' }
  const year = Number(date.slice(0, 4))
  if (year < NYSE_CALENDAR_START_YEAR || year > NYSE_CALENDAR_END_YEAR) {
    return { session: false, reason: 'outside-reviewed-nyse-calendar' }
  }
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
  if (weekday === 0 || weekday === 6) return { session: false, reason: 'nyse-weekend' }
  if (nyseClosureDates(year).has(date) || EXTRAORDINARY_NYSE_CLOSURES.has(date)) {
    return { session: false, reason: 'nyse-full-day-closure' }
  }
  return { session: true, reason: null }
}

export function reviewedNyseSessionDates(startDate, endDate) {
  if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) return []
  const dates = []
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    if (reviewedNyseSessionStatus(date).session) dates.push(date)
  }
  return dates
}

function newYorkTimestampParts(timestamp) {
  if (!isIsoTimestamp(timestamp)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  }
}

function seasonBounds(season, seasonYear) {
  if (!Number.isInteger(seasonYear) || seasonYear < 2000 || seasonYear > 2100) return null
  if (season === 'summer') return { startDate: `${seasonYear}-05-01`, endDate: `${seasonYear}-09-30` }
  if (season === 'winter') return { startDate: `${seasonYear}-11-01`, endDate: `${seasonYear + 1}-03-31` }
  return null
}

function completeSeasonCounts(sessionDates, prospectiveStart, observedThrough) {
  const covered = new Set(sessionDates)
  const result = { completeSummerSeasons: 0, completeWinterSeasons: 0 }
  if (!isDate(prospectiveStart) || !isDate(observedThrough)) return result
  const firstYear = Number(prospectiveStart.slice(0, 4)) - 1
  const lastYear = Number(observedThrough.slice(0, 4))
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const [season, field] of [
      ['summer', 'completeSummerSeasons'],
      ['winter', 'completeWinterSeasons'],
    ]) {
      const bounds = seasonBounds(season, year)
      if (bounds.startDate < prospectiveStart || bounds.endDate > observedThrough) continue
      const expected = reviewedNyseSessionDates(bounds.startDate, bounds.endDate)
      if (expected.length > 0 && expected.every((date) => covered.has(date))) result[field] += 1
    }
  }
  return result
}

function commonDigest(records, field) {
  const values = [...new Set(records.map((record) => record?.[field]).filter(isSha256))]
  return values.length === 1 ? values[0] : null
}

function summarizeForwardArtifact(artifact, manifest, failures) {
  const prefix = 'forward validation evidence artifact'
  if (artifact?.schemaVersion !== VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION) {
    failures.push(`${prefix} schemaVersion must equal ${VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION}`)
  }
  if (artifact?.artifactId !== FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID) {
    failures.push(`${prefix} artifactId must equal ${FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID}`)
  }
  if (artifact?.strategyId !== STRATEGY_ID) failures.push(`${prefix} strategyId must equal ${STRATEGY_ID}`)
  if (artifact?.marketCalendarId !== REVIEWED_NYSE_CALENDAR_ID) {
    failures.push(`${prefix} marketCalendarId must equal ${REVIEWED_NYSE_CALENDAR_ID}`)
  }
  if (artifact?.observedThrough !== manifest?.observedForwardEvidence?.observedThrough) {
    failures.push(`${prefix} observedThrough must equal the reviewed manifest`)
  }

  const prospectiveStart = manifest?.historicalEvidence?.prospectiveStart
  const observedThrough = manifest?.observedForwardEvidence?.observedThrough
  const sealedStrategyDigest = manifest?.sealedStrategyContractDigestSha256
  const sealedArtifactDigest = manifest?.sealedStrategyArtifactDigestSha256
  const observations = Array.isArray(artifact?.observations) ? artifact.observations : []
  if (!Array.isArray(artifact?.observations)) failures.push(`${prefix} observations must be an array`)
  const observationIds = new Set()
  const observationDates = new Set()
  const inferenceDigests = new Set()
  const episodeIds = new Set()
  const independentEpisodes = []

  for (const [index, observation] of observations.entries()) {
    const label = `${prefix} observations[${index}]`
    if (!isSha256(observation?.observationIdSha256)) {
      failures.push(`${label}.observationIdSha256 must be a lowercase SHA-256 digest`)
    } else if (observationIds.has(observation.observationIdSha256)) {
      failures.push(`${label}.observationIdSha256 must be unique`)
    } else observationIds.add(observation.observationIdSha256)

    if (!isDate(observation?.sessionDate)) {
      failures.push(`${label}.sessionDate must be a calendar date`)
    } else {
      if (observationDates.has(observation.sessionDate)) failures.push(`${label}.sessionDate must be unique`)
      observationDates.add(observation.sessionDate)
      const sessionStatus = reviewedNyseSessionStatus(observation.sessionDate)
      if (!sessionStatus.session) failures.push(`${label}.sessionDate must be a reviewed NYSE session (${sessionStatus.reason})`)
      if (isDate(prospectiveStart) && observation.sessionDate < prospectiveStart) {
        failures.push(`${label}.sessionDate cannot precede prospectiveStart`)
      }
      if (isDate(observedThrough) && observation.sessionDate > observedThrough) {
        failures.push(`${label}.sessionDate cannot exceed observedThrough`)
      }
    }

    const recordedParts = newYorkTimestampParts(observation?.recordedAt)
    if (!recordedParts) failures.push(`${label}.recordedAt must be an ISO timestamp`)
    else if (recordedParts.date !== observation.sessionDate || recordedParts.minute >= NYSE_OPEN_MINUTE) {
      failures.push(`${label}.recordedAt must be before 09:30 America/New_York on sessionDate`)
    }

    if (observation?.strategyContractDigestSha256 !== sealedStrategyDigest) {
      failures.push(`${label}.strategyContractDigestSha256 must equal the sealed strategy contract`)
    }
    if (observation?.strategyArtifactDigestSha256 !== sealedArtifactDigest || !isSha256(sealedArtifactDigest)) {
      failures.push(`${label}.strategyArtifactDigestSha256 must equal the sealed strategy artifact`)
    }
    if (!observation?.inference || typeof observation.inference !== 'object' || Array.isArray(observation.inference)) {
      failures.push(`${label}.inference must be an object`)
    } else {
      if (observation.inference.schemaVersion !== 1) failures.push(`${label}.inference.schemaVersion must equal 1`)
      if (observation.inference.strategyId !== STRATEGY_ID) failures.push(`${label}.inference.strategyId must equal ${STRATEGY_ID}`)
      if (!isIsoTimestamp(observation.inference.generatedAt)) failures.push(`${label}.inference.generatedAt must be an ISO timestamp`)
      else if (isIsoTimestamp(observation.recordedAt) && Date.parse(observation.inference.generatedAt) > Date.parse(observation.recordedAt)) {
        failures.push(`${label}.inference.generatedAt cannot postdate recordedAt`)
      }
      if (observation.inference.targetDate !== observation.sessionDate) {
        failures.push(`${label}.inference.targetDate must equal sessionDate`)
      }
      for (const field of ['gasPosition', 'indexFraction', 'cashFraction']) {
        if (!finiteNumber(observation.inference[field])) failures.push(`${label}.inference.${field} must be finite`)
      }
      if (
        finiteNumber(observation.inference.gasPosition)
        && (observation.inference.gasPosition < -1 || observation.inference.gasPosition > 1)
      ) failures.push(`${label}.inference.gasPosition must be between -1 and 1`)
      for (const field of ['indexFraction', 'cashFraction']) {
        if (
          finiteNumber(observation.inference[field])
          && (observation.inference[field] < 0 || observation.inference[field] > 1)
        ) failures.push(`${label}.inference.${field} must be between 0 and 1`)
      }
      if (
        ['gasPosition', 'indexFraction', 'cashFraction']
          .every((field) => finiteNumber(observation.inference[field]))
        && Math.abs(
          Math.abs(observation.inference.gasPosition)
            + observation.inference.indexFraction
            + observation.inference.cashFraction
            - 1,
        ) > 1e-6
      ) failures.push(`${label}.inference allocations must sum to one using absolute gas exposure`)
      if (typeof observation.inference.thesisKind !== 'string' || !observation.inference.thesisKind) {
        failures.push(`${label}.inference.thesisKind must be a non-empty string`)
      }
    }
    if (!isSha256(observation?.inferenceDigestSha256)) {
      failures.push(`${label}.inferenceDigestSha256 must be a lowercase SHA-256 digest`)
    } else {
      if (inferenceDigests.has(observation.inferenceDigestSha256)) failures.push(`${label}.inferenceDigestSha256 must be unique`)
      inferenceDigests.add(observation.inferenceDigestSha256)
      if (observation?.inference && observation.inferenceDigestSha256 !== forwardInferenceDigestSha256(observation.inference)) {
        failures.push(`${label}.inferenceDigestSha256 must match the canonical inference record`)
      }
    }

    if (observation?.independentEpisode === null) continue
    const episode = observation?.independentEpisode
    const episodeFailureCount = failures.length
    if (!episode || typeof episode !== 'object' || Array.isArray(episode)) {
      failures.push(`${label}.independentEpisode must be null or an object`)
      continue
    }
    if (!isSha256(episode.episodeIdSha256)) failures.push(`${label}.independentEpisode.episodeIdSha256 must be a lowercase SHA-256 digest`)
    else if (episodeIds.has(episode.episodeIdSha256)) failures.push(`${label}.independentEpisode.episodeIdSha256 must be unique`)
    else episodeIds.add(episode.episodeIdSha256)
    for (const field of ['forecastWindowStart', 'forecastWindowEnd', 'observationWindowStart', 'observationWindowEnd']) {
      if (!isDate(episode[field])) failures.push(`${label}.independentEpisode.${field} must be a calendar date`)
    }
    if (
      isDate(episode.forecastWindowStart)
      && isDate(episode.forecastWindowEnd)
      && isDate(episode.observationWindowStart)
      && isDate(episode.observationWindowEnd)
      && !(
        observation.sessionDate <= episode.forecastWindowStart
        && episode.forecastWindowStart <= episode.forecastWindowEnd
        && episode.forecastWindowEnd < episode.observationWindowStart
        && episode.observationWindowStart <= episode.observationWindowEnd
      )
    ) {
      failures.push(`${label}.independentEpisode must have a causal forecast window followed by an observation window`)
    }
    if (isDate(observedThrough) && isDate(episode.observationWindowEnd) && episode.observationWindowEnd > observedThrough) {
      failures.push(`${label}.independentEpisode.observationWindowEnd cannot exceed observedThrough`)
    }
    if (failures.length === episodeFailureCount) independentEpisodes.push({ ...episode, label })
  }

  independentEpisodes.sort((left, right) => (
    left.forecastWindowStart.localeCompare(right.forecastWindowStart)
    || left.episodeIdSha256.localeCompare(right.episodeIdSha256)
  ))
  for (let index = 1; index < independentEpisodes.length; index += 1) {
    const previous = independentEpisodes[index - 1]
    const current = independentEpisodes[index]
    if (current.forecastWindowStart <= previous.observationWindowEnd) {
      failures.push(`${current.label}.independentEpisode overlaps the preceding forecast/observation episode window`)
    }
  }

  const seasonCounts = completeSeasonCounts([...observationDates], prospectiveStart, observedThrough)
  return {
    independentEpisodes: independentEpisodes.length,
    ...seasonCounts,
    observedThrough: artifact?.observedThrough ?? null,
    strategyContractDigestSha256: commonDigest(observations, 'strategyContractDigestSha256'),
    strategyArtifactDigestSha256: commonDigest(observations, 'strategyArtifactDigestSha256'),
  }
}

function derivedUngDirection(order) {
  if (order?.symbol !== 'UNG') return null
  if (order.side === 'buy' && order.postPositionQuantity > 0 && order.postPositionQuantity > order.prePositionQuantity) return 'long'
  if (order.side === 'sell' && order.postPositionQuantity < 0 && order.postPositionQuantity < order.prePositionQuantity) return 'short'
  return null
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function summarizePaperArtifact(artifact, manifest, failures) {
  const prefix = 'paper execution evidence artifact'
  if (artifact?.schemaVersion !== VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION) {
    failures.push(`${prefix} schemaVersion must equal ${VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION}`)
  }
  if (artifact?.artifactId !== PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID) {
    failures.push(`${prefix} artifactId must equal ${PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID}`)
  }
  if (artifact?.strategyId !== STRATEGY_ID) failures.push(`${prefix} strategyId must equal ${STRATEGY_ID}`)
  if (artifact?.marketCalendarId !== REVIEWED_NYSE_CALENDAR_ID) {
    failures.push(`${prefix} marketCalendarId must equal ${REVIEWED_NYSE_CALENDAR_ID}`)
  }
  if (artifact?.strategyContractDigestSha256 !== manifest?.sealedStrategyContractDigestSha256) {
    failures.push(`${prefix} strategy-contract digest must equal the sealed strategy contract`)
  }
  if (artifact?.brokerExecutionProfileDigestSha256 !== manifest?.sealedBrokerExecutionProfileDigestSha256) {
    failures.push(`${prefix} broker execution profile digest must equal the sealed broker profile`)
  }
  if (artifact?.accountPseudonymSha256 !== manifest?.paperExecutionEvidence?.accountPseudonymSha256) {
    failures.push(`${prefix} account pseudonym must equal the reviewed manifest`)
  }

  const sessions = Array.isArray(artifact?.tradingSessions) ? artifact.tradingSessions : []
  if (!Array.isArray(artifact?.tradingSessions)) failures.push(`${prefix} tradingSessions must be an array`)
  const sessionSet = new Set()
  for (const [index, sessionDate] of sessions.entries()) {
    if (!isDate(sessionDate)) failures.push(`${prefix} tradingSessions[${index}] must be a calendar date`)
    const status = reviewedNyseSessionStatus(sessionDate)
    if (isDate(sessionDate) && !status.session) {
      failures.push(`${prefix} tradingSessions[${index}] must be a reviewed NYSE session (${status.reason})`)
    }
    if (sessionSet.has(sessionDate)) failures.push(`${prefix} tradingSessions[${index}] must be unique`)
    sessionSet.add(sessionDate)
    if (index > 0 && sessions[index - 1] >= sessionDate) failures.push(`${prefix} tradingSessions must be strictly chronological`)
  }
  if (sessions.length > 0 && isDate(sessions[0]) && isDate(sessions.at(-1))) {
    const expectedSessions = reviewedNyseSessionDates(sessions[0], sessions.at(-1))
    if (!arraysEqual(sessions, expectedSessions)) {
      failures.push(`${prefix} tradingSessions must equal the complete reviewed NYSE session set for the evidence period`)
    }
  }

  const orders = Array.isArray(artifact?.orders) ? artifact.orders : []
  if (!Array.isArray(artifact?.orders)) failures.push(`${prefix} orders must be an array`)
  const orderIds = new Set()
  const brokerRecordDigests = new Set()
  const filledOrders = []
  const coherentFilledOrders = []
  for (const [index, order] of orders.entries()) {
    const label = `${prefix} orders[${index}]`
    if (Object.hasOwn(order ?? {}, 'targetExposure')) {
      failures.push(`${label}.targetExposure is not accepted; direction must derive from side, quantity, and signed positions`)
    }
    if (!isSha256(order?.orderIdSha256)) failures.push(`${label}.orderIdSha256 must be a lowercase SHA-256 digest`)
    else if (orderIds.has(order.orderIdSha256)) failures.push(`${label}.orderIdSha256 must be unique`)
    else orderIds.add(order.orderIdSha256)
    if (!isSha256(order?.brokerRecordDigestSha256)) failures.push(`${label}.brokerRecordDigestSha256 must be a lowercase SHA-256 digest`)
    else {
      if (brokerRecordDigests.has(order.brokerRecordDigestSha256)) failures.push(`${label}.brokerRecordDigestSha256 must be unique`)
      brokerRecordDigests.add(order.brokerRecordDigestSha256)
      if (order.brokerRecordDigestSha256 !== paperBrokerRecordDigestSha256(order)) {
        failures.push(`${label}.brokerRecordDigestSha256 must match the canonical broker order/fill record`)
      }
    }
    if (!ALLOWED_ORDER_SYMBOLS.has(order?.symbol)) failures.push(`${label}.symbol must be UNG, VOO, or QQQM`)
    if (!ALLOWED_ORDER_STATUSES.has(order?.status)) failures.push(`${label}.status must be filled, canceled, or rejected`)
    if (!ALLOWED_ORDER_SIDES.has(order?.side)) failures.push(`${label}.side must equal buy or sell`)
    if (!positiveFiniteNumber(order?.quantity)) failures.push(`${label}.quantity must be positive`)
    if (!isIsoTimestamp(order?.submittedAt)) failures.push(`${label}.submittedAt must be an ISO timestamp`)
    const submittedParts = newYorkTimestampParts(order?.submittedAt)
    const sessionDate = submittedParts?.date ?? null
    if (sessionDate && !sessionSet.has(sessionDate)) failures.push(`${label}.submittedAt must fall on a recorded trading session`)

    if (order?.status === 'filled') {
      const coherenceFailureCount = failures.length
      if (!isIsoTimestamp(order?.filledAt)) failures.push(`${label}.filledAt must be an ISO timestamp when filled`)
      const filledParts = newYorkTimestampParts(order?.filledAt)
      if (
        isIsoTimestamp(order?.submittedAt)
        && isIsoTimestamp(order?.filledAt)
        && (Date.parse(order.filledAt) < Date.parse(order.submittedAt) || filledParts?.date !== sessionDate)
      ) failures.push(`${label}.filledAt must be on the submission session and not precede submittedAt`)
      if (!finiteNumber(order?.prePositionQuantity)) failures.push(`${label}.prePositionQuantity must be finite when filled`)
      if (!finiteNumber(order?.postPositionQuantity)) failures.push(`${label}.postPositionQuantity must be finite when filled`)
      if (finiteNumber(order?.prePositionQuantity) && finiteNumber(order?.postPositionQuantity) && positiveFiniteNumber(order?.quantity)) {
        const expectedPost = order.prePositionQuantity + (order.side === 'buy' ? order.quantity : -order.quantity)
        if (Math.abs(expectedPost - order.postPositionQuantity) > POSITION_TOLERANCE) {
          failures.push(`${label} side, quantity, and pre/post signed position are incoherent`)
        }
      }
      if (!positiveFiniteNumber(order?.referencePriceUsd)) failures.push(`${label}.referencePriceUsd must be positive when filled`)
      if (!positiveFiniteNumber(order?.averageFillPriceUsd)) failures.push(`${label}.averageFillPriceUsd must be positive when filled`)
      if (!isIsoTimestamp(order?.referenceQuoteTimestamp)) failures.push(`${label}.referenceQuoteTimestamp must be an ISO timestamp when filled`)
      if (!positiveFiniteNumber(order?.referenceQuoteBidPriceUsd)) failures.push(`${label}.referenceQuoteBidPriceUsd must be positive when filled`)
      if (!positiveFiniteNumber(order?.referenceQuoteAskPriceUsd)) failures.push(`${label}.referenceQuoteAskPriceUsd must be positive when filled`)
      if (
        positiveFiniteNumber(order?.referenceQuoteBidPriceUsd)
        && positiveFiniteNumber(order?.referenceQuoteAskPriceUsd)
        && order.referenceQuoteAskPriceUsd < order.referenceQuoteBidPriceUsd
      ) failures.push(`${label} reference quote ask must not be below bid`)
      if (
        positiveFiniteNumber(order?.referencePriceUsd)
        && positiveFiniteNumber(order?.referenceQuoteBidPriceUsd)
        && positiveFiniteNumber(order?.referenceQuoteAskPriceUsd)
      ) {
        const midpoint = (order.referenceQuoteBidPriceUsd + order.referenceQuoteAskPriceUsd) / 2
        if (Math.abs(order.referencePriceUsd - midpoint) > Math.max(1e-8, midpoint * 1e-8)) {
          failures.push(`${label}.referencePriceUsd must equal the reviewed quote midpoint`)
        }
      }
      if (isIsoTimestamp(order?.filledAt) && isIsoTimestamp(order?.referenceQuoteTimestamp)) {
        const quoteAgeMs = Date.parse(order.filledAt) - Date.parse(order.referenceQuoteTimestamp)
        if (quoteAgeMs > MAX_REFERENCE_QUOTE_AGE_MS || quoteAgeMs < -MAX_REFERENCE_QUOTE_FUTURE_SKEW_MS) {
          failures.push(`${label}.referenceQuoteTimestamp must be fresh at fill time`)
        }
      }
      if (positiveFiniteNumber(order?.referencePriceUsd) && positiveFiniteNumber(order?.averageFillPriceUsd)) filledOrders.push(order)
      if (failures.length === coherenceFailureCount) coherentFilledOrders.push(order)
    } else {
      for (const field of [
        'filledAt',
        'referencePriceUsd',
        'averageFillPriceUsd',
        'referenceQuoteTimestamp',
        'referenceQuoteBidPriceUsd',
        'referenceQuoteAskPriceUsd',
        'prePositionQuantity',
        'postPositionQuantity',
      ]) {
        if (order?.[field] !== null) failures.push(`${label}.${field} must be null unless status equals filled`)
      }
    }
  }

  const lastPositionBySymbol = new Map()
  for (const order of coherentFilledOrders.sort((left, right) => left.filledAt.localeCompare(right.filledAt))) {
    if (lastPositionBySymbol.has(order.symbol)) {
      const previousPost = lastPositionBySymbol.get(order.symbol)
      if (Math.abs(previousPost - order.prePositionQuantity) > POSITION_TOLERANCE) {
        failures.push(`${prefix} filled ${order.symbol} orders must form a coherent signed-position chain`)
      }
    }
    lastPositionBySymbol.set(order.symbol, order.postPositionQuantity)
  }

  const slippageBps = filledOrders.map((order) => Math.abs(order.averageFillPriceUsd / order.referencePriceUsd - 1) * 10000)
  const ungFilledOrders = filledOrders.filter((order) => order.symbol === 'UNG')
  return {
    strategyContractDigestSha256: artifact?.strategyContractDigestSha256 ?? null,
    brokerExecutionProfileDigestSha256: artifact?.brokerExecutionProfileDigestSha256 ?? null,
    accountPseudonymSha256: artifact?.accountPseudonymSha256 ?? null,
    periodStart: sessions[0] ?? null,
    periodEnd: sessions.at(-1) ?? null,
    tradingSessions: sessions.length,
    submittedOrders: orders.length,
    filledOrders: filledOrders.length,
    ungFilledOrders: ungFilledOrders.length,
    ungLongFilledOrders: ungFilledOrders.filter((order) => derivedUngDirection(order) === 'long').length,
    ungShortFilledOrders: ungFilledOrders.filter((order) => derivedUngDirection(order) === 'short').length,
    medianAbsoluteSlippageBps: round(median(slippageBps)),
    p95AbsoluteSlippageBps: round(nearestRankPercentile(slippageBps, 0.95)),
  }
}

function exactSummaryFailures(label, summary, expected, fields) {
  const failures = []
  for (const field of fields) {
    if (summary[field] !== expected?.[field]) {
      failures.push(`${label} ${field} (${summary[field]}) does not match the reviewed manifest (${expected?.[field]})`)
    }
  }
  return failures
}

function verifyOne({ filePath, label, expectedDigest, summarize, manifest, expected, fields }) {
  const failures = []
  let loaded
  try {
    loaded = readProtectedArtifact(filePath, label)
  } catch (error) {
    failures.push(error.message)
    return { required: true, valid: false, filePath, digestSha256: null, summary: null, failures }
  }
  if (loaded.digestSha256 !== expectedDigest) {
    failures.push(`${label} digest ${loaded.digestSha256} does not match the reviewed manifest ${expectedDigest}`)
  }
  const summary = summarize(loaded.artifact, manifest, failures)
  failures.push(...exactSummaryFailures(label, summary, expected, fields))
  return {
    required: true,
    valid: failures.length === 0,
    filePath,
    digestSha256: loaded.digestSha256,
    summary,
    failures,
  }
}

export function verifyValidationEvidenceArtifacts(repoDir, manifestPath, manifest) {
  const paths = artifactPaths(repoDir, manifestPath)
  const observed = manifest?.observedForwardEvidence
  const observedCount = ['independentEpisodes', 'completeSummerSeasons', 'completeWinterSeasons']
    .reduce((sum, field) => sum + (Number.isInteger(observed?.[field]) ? observed[field] : 0), 0)
  const forward = observedCount > 0
    ? verifyOne({
        filePath: paths.forward,
        label: 'forward validation evidence artifact',
        expectedDigest: observed?.evidenceArtifactDigestSha256,
        summarize: summarizeForwardArtifact,
        manifest,
        expected: observed,
        fields: [
          'independentEpisodes',
          'completeSummerSeasons',
          'completeWinterSeasons',
          'observedThrough',
          'strategyContractDigestSha256',
          'strategyArtifactDigestSha256',
        ],
      })
    : { required: false, valid: false, filePath: paths.forward, digestSha256: null, summary: null, failures: [] }
  const paper = manifest?.paperExecutionEvidence?.status === 'reviewed'
    ? verifyOne({
        filePath: paths.paper,
        label: 'paper execution evidence artifact',
        expectedDigest: manifest.paperExecutionEvidence.evidenceArtifactDigestSha256,
        summarize: summarizePaperArtifact,
        manifest,
        expected: manifest.paperExecutionEvidence,
        fields: [
          'strategyContractDigestSha256',
          'brokerExecutionProfileDigestSha256',
          'accountPseudonymSha256',
          'periodStart',
          'periodEnd',
          'tradingSessions',
          'submittedOrders',
          'filledOrders',
          'ungFilledOrders',
          'ungLongFilledOrders',
          'ungShortFilledOrders',
          'medianAbsoluteSlippageBps',
          'p95AbsoluteSlippageBps',
        ],
      })
    : { required: false, valid: false, filePath: paths.paper, digestSha256: null, summary: null, failures: [] }
  return {
    paths,
    forward,
    paper,
    failures: [...forward.failures, ...paper.failures],
  }
}
