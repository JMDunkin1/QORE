import crypto from 'node:crypto'
import { eiaReportAvailableAtOpen } from './qore-signal-availability.mjs'

export const STORAGE_CONTRADICTION_SHADOW_SCHEMA_VERSION = 1
export const STORAGE_CONTRADICTION_EVALUATION_SCHEMA_VERSION = 1
export const STORAGE_CONTRADICTION_THRESHOLD_PCT = 10
export const STORAGE_CONTRADICTION_SCALE = 0
export const STORAGE_CONTRADICTION_TRAILING_YEARS = 5
export const STORAGE_CONTRADICTION_MINIMUM_PEERS = 3
export const STORAGE_CONTRADICTION_PROSPECTIVE_START = null
export const STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256 =
  '4be37f6ff377d8ec94f5f969a42417cc63923fd0c7041a5745c50e0a33cec8aa'
export const STORAGE_CONTRADICTION_EVALUATION_DIGEST_SHA256 =
  'f133712be24db75533eb9e36f162ae8d21273fc9c0c01d89e8c3525bba1c7fb8'

const THRESHOLD_GRID_PCT = Object.freeze([
  0,
  2.5,
  5,
  7.5,
  8,
  9,
  10,
  11,
  12,
  12.5,
  15,
  17.5,
  20,
  22.5,
  25,
])
const CONTRADICTED_SCALE_GRID = Object.freeze([0, 0.25, 0.5, 0.75])

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

export function storageContradictionValueDigestSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function storageContradictionShadowSourceProjection(sourceText) {
  return String(sourceText)
    .replace(
      /(STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256\s*=\s*)'[^']+'/,
      "$1'<implementation-manifest-digest>'",
    )
    .replace(
      /(STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256\s*=\s*)'[^']+'/,
      "$1'<shadow-contract-digest>'",
    )
    .replace(
      /(STORAGE_CONTRADICTION_EVALUATION_DIGEST_SHA256\s*=\s*)'[^']+'/,
      "$1'<evaluation-artifact-digest>'",
    )
}

export function storageContradictionImplementationFileDigest({ content, digestMode }) {
  const payload = digestMode === 'storage-shadow-source-projection-v1'
    ? storageContradictionShadowSourceProjection(content)
    : digestMode === 'sha256'
      ? content
      : null
  if (payload === null) throw new Error(`Unsupported storage-shadow digest mode: ${digestMode}.`)
  return crypto.createHash('sha256').update(payload).digest('hex')
}

export function validateStorageContradictionImplementationManifest(manifest, contentsByPath) {
  if (
    manifest?.schemaVersion !== 1
    || manifest.manifestId !== 'ngas-all-year-storage-contradiction-shadow-implementation-v1'
    || !Array.isArray(manifest.files)
    || !manifest.files.length
  ) {
    throw new Error('The storage-contradiction implementation manifest is invalid.')
  }
  const paths = new Set()
  for (const file of manifest.files) {
    if (!file?.path || paths.has(file.path) || !contentsByPath.has(file.path)) {
      throw new Error(`The storage-contradiction manifest has a missing or duplicate file: ${file?.path ?? 'unknown'}.`)
    }
    paths.add(file.path)
    const digest = storageContradictionImplementationFileDigest({
      content: contentsByPath.get(file.path),
      digestMode: file.digestMode,
    })
    if (digest !== file.digestSha256) {
      throw new Error(`The storage-contradiction implementation binding is stale for ${file.path}.`)
    }
  }
  return true
}

export function storageContradictionCandidateId({ thresholdPct, contradictedScale }) {
  return `storage-contradiction-veto-threshold-${thresholdPct}-scale-${contradictedScale}-v1`
}

export const STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID = storageContradictionCandidateId({
  thresholdPct: STORAGE_CONTRADICTION_THRESHOLD_PCT,
  contradictedScale: STORAGE_CONTRADICTION_SCALE,
})

export const STORAGE_CONTRADICTION_CANDIDATE_FAMILY = freezeCopy(
  CONTRADICTED_SCALE_GRID.flatMap((contradictedScale) =>
    THRESHOLD_GRID_PCT.map((thresholdPct) => ({
      candidateId: storageContradictionCandidateId({ thresholdPct, contradictedScale }),
      thresholdPct,
      contradictedScale,
    }))),
)

export const STORAGE_CONTRADICTION_CANDIDATE_FAMILY_DIGEST_SHA256 =
  '7807e44a04a4650a93dd5b8737f90b7d144c87f2cbd7ded21b7519ffd38bff1b'

export const STORAGE_CONTRADICTION_SHADOW = freezeCopy({
  schemaVersion: STORAGE_CONTRADICTION_SHADOW_SCHEMA_VERSION,
  contractId: 'ngas-all-year-storage-contradiction-shadow-v1',
  strategyId: 'ngas-all-year-beta',
  role: 'historical-research-shadow-and-frozen-hypothesis',
  executionEligible: false,
  promotionEligible: false,
  publicStrategy: false,
  frozenOn: '2026-07-23',
  prospectiveStart: STORAGE_CONTRADICTION_PROSPECTIVE_START,
  selectedCandidateId: STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID,
  selectedCandidate: {
    thresholdPct: STORAGE_CONTRADICTION_THRESHOLD_PCT,
    contradictedScale: STORAGE_CONTRADICTION_SCALE,
    comparisonOperator: 'strictly-greater-than',
  },
  candidateFamily: STORAGE_CONTRADICTION_CANDIDATE_FAMILY,
  candidateFamilyDigestSha256: STORAGE_CONTRADICTION_CANDIDATE_FAMILY_DIGEST_SHA256,
  comparator: {
    selectedTradesPath:
      'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv',
    selectedTradesDigestSha256:
      'ff39c0755c4777550113419e32a000e41a625612b30cedefa6103f2f8c2f04ea',
    sealedStrategyContractDigestSha256:
      '07ae468c936b65c141ae2d52d0088c13e185495bcfe9a9b897892d3b83c99285',
    executionReadiness:
      'legacy-active-comparator-remains-needs-validation-and-routing-ineligible',
    executionContractPath: 'config/qore-research-execution.json',
    executionContractDigestSha256:
      'c18dea27526796dd6ad06ecffaa5cb1a32ac34fc587bc0cf79e0a007626e106d',
  },
  implementationSeal: {
    manifestPath: 'config/qore-storage-contradiction-shadow-implementation.json',
    manifestDigestSha256: STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
    shadowModuleDigestMode: 'storage-shadow-source-projection-v1',
  },
  storageContext: {
    sourceId: 'eia-working-gas-lower48-weekly',
    sourcePath: 'data/qore/fundamentals/eia/working-gas-storage-lower48-weekly.csv',
    releaseCalendarPath:
      'data/qore/fundamentals/eia/working-gas-storage-release-calendar.json',
    availabilityRule: 'released-at-or-before-09:30-America/New_York-on-trade-date',
    seasonalBucketRule: 'zero-based-floor-day-of-year-minus-one-divided-by-seven',
    peerRule: 'same-seasonal-week-in-the-five-prior-period-end-years',
    trailingYears: STORAGE_CONTRADICTION_TRAILING_YEARS,
    minimumPeers: STORAGE_CONTRADICTION_MINIMUM_PEERS,
    valueRule: '(latest-storage-bcf-minus-peer-mean-bcf)-divided-by-peer-mean-bcf-times-100',
    valueVintagePolicy:
      'Release timing is historical-calendar-causal, but values come from the current checked-in EIA series; release-vintage revisions are not excluded.',
  },
  allocationRule: {
    contradictionRule:
      'sign(selected-gas-position)-times-storage-deviation-pct-strictly-greater-than-threshold-pct',
    action: 'scale-selected-gas-position-and-return-released-capacity-to-the-index-basket',
    noGasAction: 'unchanged',
    missingContextAction: 'observation-unavailable-and-selected-allocation-unchanged',
  },
  evaluation: {
    historicalEvidenceStatus: 'development-contaminated',
    selectionPrefixEnd: '2024-12-31',
    reportOnlyStart: '2025-01-01',
    familyAdjustment:
      'Every threshold and contradicted-scale pair in the frozen 60-member family is included.',
    promotionPolicy:
      'No historical result can promote this shadow. Promotion requires a new reviewed contract and prospective evidence gates.',
    prospectiveEvidencePolicy:
      'The legacy active comparator is bound. Prospective collection remains blocked until a trusted pre-open writer, outcome-independent terminal evaluation date, and external chronology seal exist; post-hoc artifact rebuilds cannot be labeled pristine evidence.',
    prospectiveCollectionStatus:
      'blocked-no-trusted-writer-terminal-date-or-external-seal',
    integrationPolicy:
      'The shadow is not imported by live inference, dashboard telemetry, broker handoffs, or order routing.',
  },
})

export const STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256 =
  '424cac8cd568e0e19c3d3248b1989541b2ae674368653b55ae2e72d4cbfc0d7a'

function validIsoDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText ?? ''))) return false
  const parsed = new Date(`${dateText}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateText
}

export function storageSeasonalWeek(isoDate) {
  if (!validIsoDate(isoDate)) throw new Error(`Invalid storage date: ${isoDate ?? 'missing'}.`)
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const dayOfYear = Math.floor((date - yearStart) / 86_400_000) + 1
  return Math.floor((dayOfYear - 1) / 7)
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizedStorageRows(storageRows, tradeDate) {
  if (!Array.isArray(storageRows) || !validIsoDate(tradeDate)) {
    throw new Error('A causal storage context requires storage rows and a valid trade date.')
  }
  const rows = storageRows
    .map((row) => ({
      date: row.date,
      year: Number(row.year ?? String(row.date ?? '').slice(0, 4)),
      seasonalWeek: Number(row.seasonalWeek ?? (validIsoDate(row.date) ? storageSeasonalWeek(row.date) : Number.NaN)),
      storageBcf: Number(row.storageBcf),
      releasedAt: row.releasedAt,
    }))
    .filter((row) => (
      validIsoDate(row.date)
      && Number.isInteger(row.year)
      && Number.isInteger(row.seasonalWeek)
      && Number.isFinite(row.storageBcf)
      && row.storageBcf > 0
      && Number.isFinite(Date.parse(String(row.releasedAt ?? '')))
    ))
    .sort((left, right) => left.date.localeCompare(right.date))
  return {
    rows,
    availableRows: rows.filter((row) => eiaReportAvailableAtOpen(row.releasedAt, tradeDate)),
  }
}

function unavailableStorageContext(latest, peers) {
  return {
    available: false,
    reason: 'insufficient-seasonal-peers',
    storageDate: latest.date,
    peerCount: peers.length,
  }
}

function availableStorageContext(latest, peers, seasonalMethod) {
  const seasonalAverageBcf = average(peers.map((row) => row.storageBcf))
  return {
    available: true,
    seasonalMethod,
    storageDate: latest.date,
    storageReleaseAt: latest.releasedAt,
    storageBcf: latest.storageBcf,
    seasonalAverageBcf,
    storageDeviationPct: ((latest.storageBcf - seasonalAverageBcf) / seasonalAverageBcf) * 100,
    peerCount: peers.length,
    peerDates: peers.map((row) => row.date),
  }
}

export function buildCausalStorageContext(storageRows, tradeDate) {
  const { availableRows } = normalizedStorageRows(storageRows, tradeDate)
  const latest = availableRows.at(-1)
  if (!latest) {
    return { available: false, reason: 'missing-released-storage' }
  }
  const peers = availableRows.filter((row) => (
    row.seasonalWeek === latest.seasonalWeek
    && row.year >= latest.year - STORAGE_CONTRADICTION_TRAILING_YEARS
    && row.year < latest.year
  ))
  if (peers.length < STORAGE_CONTRADICTION_MINIMUM_PEERS) {
    return unavailableStorageContext(latest, peers)
  }
  return availableStorageContext(latest, peers, 'jan1-anchored-seven-day-bucket')
}

function seasonalDayIndex(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  return Math.floor(
    (Date.UTC(2000, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(2000, 0, 1))
      / 86_400_000,
  )
}

function circularSeasonalDayDistance(leftDate, rightDate) {
  const distance = Math.abs(seasonalDayIndex(leftDate) - seasonalDayIndex(rightDate))
  return Math.min(distance, 366 - distance)
}

export function buildNearestPeriodStorageContext(storageRows, tradeDate) {
  const { availableRows } = normalizedStorageRows(storageRows, tradeDate)
  const latest = availableRows.at(-1)
  if (!latest) return { available: false, reason: 'missing-released-storage' }
  const peers = []
  for (
    let year = latest.year - STORAGE_CONTRADICTION_TRAILING_YEARS;
    year < latest.year;
    year += 1
  ) {
    const nearest = availableRows
      .filter((row) => row.year === year)
      .map((row) => ({ row, distance: circularSeasonalDayDistance(latest.date, row.date) }))
      .filter(({ distance }) => distance <= 8)
      .toSorted((left, right) => left.distance - right.distance || left.row.date.localeCompare(right.row.date))[0]
    if (nearest) peers.push(nearest.row)
  }
  if (peers.length < STORAGE_CONTRADICTION_MINIMUM_PEERS) {
    return unavailableStorageContext(latest, peers)
  }
  return availableStorageContext(latest, peers, 'nearest-period-end-within-eight-seasonal-days')
}

export function evaluateStorageContradictionShadow({
  gasPosition,
  storageContext,
  thresholdPct = STORAGE_CONTRADICTION_THRESHOLD_PCT,
  contradictedScale = STORAGE_CONTRADICTION_SCALE,
}) {
  const selectedGasPosition = Number(gasPosition)
  if (!Number.isFinite(selectedGasPosition) || Math.abs(selectedGasPosition) > 1) {
    throw new Error('Storage-contradiction gasPosition must be finite and inside [-1, 1].')
  }
  if (!(Number(thresholdPct) >= 0) || !(Number(contradictedScale) >= 0 && Number(contradictedScale) <= 1)) {
    throw new Error('Storage-contradiction threshold and scale are outside the supported range.')
  }
  if (selectedGasPosition === 0) {
    return {
      observationAvailable: Boolean(storageContext?.available),
      contradicted: false,
      scale: 1,
      gasPosition: 0,
      investedIndexFraction: 1,
      reason: 'no-selected-gas-position',
    }
  }
  if (!storageContext?.available || !Number.isFinite(storageContext.storageDeviationPct)) {
    return {
      observationAvailable: false,
      contradicted: false,
      scale: 1,
      gasPosition: selectedGasPosition,
      investedIndexFraction: 1 - Math.abs(selectedGasPosition),
      reason: storageContext?.reason ?? 'missing-storage-context',
    }
  }
  const directionalStorageDeviationPct =
    Math.sign(selectedGasPosition) * storageContext.storageDeviationPct
  const contradicted = directionalStorageDeviationPct > Number(thresholdPct)
  const scale = contradicted ? Number(contradictedScale) : 1
  const scaledGasPosition = scale === 0 ? 0 : selectedGasPosition * scale
  return {
    observationAvailable: true,
    contradicted,
    scale,
    gasPosition: scaledGasPosition,
    investedIndexFraction: 1 - Math.abs(scaledGasPosition),
    directionalStorageDeviationPct,
    reason: contradicted ? 'storage-contradicts-selected-gas-direction' : 'storage-does-not-contradict',
  }
}

export function validateStorageContradictionShadow({
  selectedTradesDigestSha256 = STORAGE_CONTRADICTION_SHADOW.comparator.selectedTradesDigestSha256,
  executionContractDigestSha256 = STORAGE_CONTRADICTION_SHADOW.comparator.executionContractDigestSha256,
  sealedStrategyContractDigestSha256 =
    STORAGE_CONTRADICTION_SHADOW.comparator.sealedStrategyContractDigestSha256,
  implementationManifestDigestSha256 =
    STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
} = {}) {
  if (
    STORAGE_CONTRADICTION_SHADOW.executionEligible
    || STORAGE_CONTRADICTION_SHADOW.promotionEligible
    || STORAGE_CONTRADICTION_SHADOW.publicStrategy
  ) {
    throw new Error('The storage-contradiction shadow must remain research-only and execution-ineligible.')
  }
  if (STORAGE_CONTRADICTION_CANDIDATE_FAMILY.length !== 60) {
    throw new Error('The storage-contradiction candidate family must contain exactly 60 candidates.')
  }
  const ids = new Set(STORAGE_CONTRADICTION_CANDIDATE_FAMILY.map((candidate) => candidate.candidateId))
  if (ids.size !== STORAGE_CONTRADICTION_CANDIDATE_FAMILY.length) {
    throw new Error('The storage-contradiction candidate family contains duplicate identifiers.')
  }
  if (!ids.has(STORAGE_CONTRADICTION_SELECTED_CANDIDATE_ID)) {
    throw new Error('The selected storage-contradiction candidate is absent from the frozen family.')
  }
  if (
    STORAGE_CONTRADICTION_CANDIDATE_FAMILY_DIGEST_SHA256
      !== storageContradictionValueDigestSha256(STORAGE_CONTRADICTION_CANDIDATE_FAMILY)
  ) {
    throw new Error('The storage-contradiction candidate-family digest is stale.')
  }
  if (
    selectedTradesDigestSha256
      !== STORAGE_CONTRADICTION_SHADOW.comparator.selectedTradesDigestSha256
    || executionContractDigestSha256
      !== STORAGE_CONTRADICTION_SHADOW.comparator.executionContractDigestSha256
    || sealedStrategyContractDigestSha256
      !== STORAGE_CONTRADICTION_SHADOW.comparator.sealedStrategyContractDigestSha256
    || implementationManifestDigestSha256
      !== STORAGE_CONTRADICTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256
  ) {
    throw new Error('The storage-contradiction comparator no longer matches its sealed active inputs.')
  }
  if (
    STORAGE_CONTRADICTION_SHADOW_DIGEST_SHA256
      !== storageContradictionValueDigestSha256(STORAGE_CONTRADICTION_SHADOW)
  ) {
    throw new Error('The storage-contradiction shadow contract digest is stale.')
  }
  return true
}
