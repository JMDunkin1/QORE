import crypto from 'node:crypto'

export const PRICE_EXHAUSTION_SHADOW_SCHEMA_VERSION = 1
export const PRICE_EXHAUSTION_EVALUATION_SCHEMA_VERSION = 1
export const PRICE_EXHAUSTION_SELECTED_LOOKBACK_SESSIONS = 5
export const PRICE_EXHAUSTION_VOLATILITY_LOOKBACK_SESSIONS = 20
export const PRICE_EXHAUSTION_SELECTED_THRESHOLD = 1
export const PRICE_EXHAUSTION_SELECTED_SCALE = 0
export const PRICE_EXHAUSTION_PROSPECTIVE_START = null
export const PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256 =
  '41ac35aefbba092e1f742e8d4d93f7cb3633895fc8d15b1ef7284cf20239de83'
export const PRICE_EXHAUSTION_EVALUATION_DIGEST_SHA256 =
  'd2e1609b8242255011ead497bc5f025f6ff74ceab097708bfc9de2445b44c738'

const LOOKBACK_GRID = Object.freeze([2, 3, 5, 10])
const THRESHOLD_GRID = Object.freeze([0.5, 1, 1.5, 2])
const EXHAUSTED_SCALE_GRID = Object.freeze([0, 0.5, 0.75])

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

export function priceExhaustionValueDigestSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function priceExhaustionShadowSourceProjection(sourceText) {
  return String(sourceText)
    .replace(
      /(PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256\s*=\s*)\n?\s*'[^']+'/,
      "$1'<implementation-manifest-digest>'",
    )
    .replace(
      /(PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256\s*=\s*)\n?\s*'[^']+'/,
      "$1'<shadow-contract-digest>'",
    )
    .replace(
      /(PRICE_EXHAUSTION_EVALUATION_DIGEST_SHA256\s*=\s*)\n?\s*'[^']+'/,
      "$1'<evaluation-artifact-digest>'",
    )
}

export function priceExhaustionImplementationFileDigest({ content, digestMode }) {
  const payload = digestMode === 'price-exhaustion-shadow-source-projection-v1'
    ? priceExhaustionShadowSourceProjection(content)
    : digestMode === 'sha256'
      ? content
      : null
  if (payload === null) throw new Error(`Unsupported price-exhaustion digest mode: ${digestMode}.`)
  return crypto.createHash('sha256').update(payload).digest('hex')
}

export function validatePriceExhaustionImplementationManifest(manifest, contentsByPath) {
  if (
    manifest?.schemaVersion !== 1
    || manifest.manifestId !== 'ngas-all-year-price-exhaustion-shadow-implementation-v1'
    || !Array.isArray(manifest.files)
    || !manifest.files.length
  ) {
    throw new Error('The price-exhaustion implementation manifest is invalid.')
  }
  const paths = new Set()
  for (const file of manifest.files) {
    if (!file?.path || paths.has(file.path) || !contentsByPath.has(file.path)) {
      throw new Error(`The price-exhaustion manifest has a missing or duplicate file: ${file?.path ?? 'unknown'}.`)
    }
    paths.add(file.path)
    const digest = priceExhaustionImplementationFileDigest({
      content: contentsByPath.get(file.path),
      digestMode: file.digestMode,
    })
    if (digest !== file.digestSha256) {
      throw new Error(`The price-exhaustion implementation binding is stale for ${file.path}.`)
    }
  }
  return true
}

export function priceExhaustionCandidateId({
  lookbackSessions,
  threshold,
  exhaustedScale,
}) {
  return `price-exhaustion-ung-l${lookbackSessions}-z${threshold}-s${exhaustedScale}-v1`
}

export const PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID = priceExhaustionCandidateId({
  lookbackSessions: PRICE_EXHAUSTION_SELECTED_LOOKBACK_SESSIONS,
  threshold: PRICE_EXHAUSTION_SELECTED_THRESHOLD,
  exhaustedScale: PRICE_EXHAUSTION_SELECTED_SCALE,
})

export const PRICE_EXHAUSTION_CANDIDATE_FAMILY = freezeCopy(
  LOOKBACK_GRID.flatMap((lookbackSessions) =>
    THRESHOLD_GRID.flatMap((threshold) =>
      EXHAUSTED_SCALE_GRID.map((exhaustedScale) => ({
        candidateId: priceExhaustionCandidateId({
          lookbackSessions,
          threshold,
          exhaustedScale,
        }),
        lookbackSessions,
        threshold,
        exhaustedScale,
      })))),
)

export const PRICE_EXHAUSTION_CANDIDATE_FAMILY_DIGEST_SHA256 =
  '0a8f8a02ad1e8c0a50ba78905b6e6384d98a066916aa1abffab1d2836d9621b6'

export const PRICE_EXHAUSTION_SHADOW = freezeCopy({
  schemaVersion: PRICE_EXHAUSTION_SHADOW_SCHEMA_VERSION,
  contractId: 'ngas-all-year-price-exhaustion-shadow-v1',
  strategyId: 'ngas-all-year-beta',
  role: 'focused-historical-research-shadow-of-a-retrospectively-discovered-rule',
  executionEligible: false,
  promotionEligible: false,
  publicStrategy: false,
  activeStrategyChanged: false,
  frozenOn: '2026-07-23',
  prospectiveStart: PRICE_EXHAUSTION_PROSPECTIVE_START,
  selectedCandidateId: PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID,
  selectedCandidate: {
    market: 'UNG',
    lookbackSessions: PRICE_EXHAUSTION_SELECTED_LOOKBACK_SESSIONS,
    volatilityLookbackSessions: PRICE_EXHAUSTION_VOLATILITY_LOOKBACK_SESSIONS,
    threshold: PRICE_EXHAUSTION_SELECTED_THRESHOLD,
    exhaustedScale: PRICE_EXHAUSTION_SELECTED_SCALE,
    comparisonOperator: 'strictly-greater-than',
  },
  discoveryProvenance: {
    status: 'retrospectively-discovered-before-this-focused-freeze',
    originalExploratoryFamily:
      'same-direction price exhaustion inside a wider development-contaminated market-state search',
    focusedFamilyUse:
      'sensitivity-and-multiple-testing-audit-only; the 48-member focused family did not select or promote the frozen rule',
  },
  candidateFamily: PRICE_EXHAUSTION_CANDIDATE_FAMILY,
  candidateFamilyDigestSha256: PRICE_EXHAUSTION_CANDIDATE_FAMILY_DIGEST_SHA256,
  comparator: {
    selectedTradesPath:
      'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv',
    selectedTradesDigestSha256:
      'ff39c0755c4777550113419e32a000e41a625612b30cedefa6103f2f8c2f04ea',
    runSummaryPath:
      'data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json',
    runSummaryDigestSha256:
      'c1542dd264c8e3e342d4a63d5e4973864ac1e4bb0bf4109fd22bb2fdf4d1d7b8',
    sealedStrategyContractDigestSha256:
      '07ae468c936b65c141ae2d52d0088c13e185495bcfe9a9b897892d3b83c99285',
    executionReadiness:
      'legacy-active-comparator-remains-needs-validation-and-routing-ineligible',
    executionContractPath: 'config/qore-research-execution.json',
    executionContractDigestSha256:
      'c18dea27526796dd6ad06ecffaa5cb1a32ac34fc587bc0cf79e0a007626e106d',
  },
  implementationSeal: {
    manifestPath: 'config/qore-price-exhaustion-shadow-implementation.json',
    manifestDigestSha256: PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
    shadowModuleDigestMode: 'price-exhaustion-shadow-source-projection-v1',
  },
  priceContext: {
    sourceId: 'yahoo-ung-daily-adjusted-close',
    sourcePath: 'data/qore/market/yahoo/UNG-daily.csv',
    sourceDigestSha256:
      '780fc8edcf1e3d15444028f8febfe2ecb64c8693f8e63d135787aa4172b3b064',
    availabilityRule: 'only adjusted-close returns whose session date is strictly before the trade date',
    returnRule: 'split-and-distribution-adjusted-close-to-adjusted-close-percent-return',
    volatilityRule:
      'sample-standard-deviation-of-up-to-the-prior-20-completed-daily-returns; expanding only at the comparator inception edge',
    exhaustionRule:
      'compounded-prior-lookback-return-pct-divided-by-daily-return-sample-std-pct-times-square-root-lookback',
  },
  allocationRule: {
    directionalScore: 'sign(selected-gas-position)-times-price-exhaustion-z',
    vetoRule: 'directional-score-strictly-greater-than-threshold',
    action: 'scale-selected-gas-position-and-return-released-capacity-to-the-index-basket',
    noGasAction: 'unchanged',
    missingContextAction: 'observation-unavailable-and-selected-allocation-unchanged',
  },
  evaluation: {
    historicalEvidenceStatus: 'development-contaminated',
    selectionPrefixEnd: '2024-12-31',
    reportOnlyStart: '2025-01-01',
    familyAdjustment:
      'Every one of the exact 4 lookbacks by 4 thresholds by 3 exhausted scales is included.',
    promotionPolicy:
      'No historical result can promote this shadow. The focused family measures sensitivity around a previously discovered rule.',
    prospectiveEvidencePolicy:
      'The legacy active comparator is bound. Prospective collection remains blocked until a trusted pre-open writer, reviewed terminal evaluation date, and external chronology seal exist.',
    prospectiveCollectionStatus:
      'blocked-no-trusted-writer-terminal-date-or-external-seal',
    integrationPolicy:
      'The shadow is not imported by live inference, dashboard telemetry, broker handoffs, order routing, or public UI code.',
  },
})

export const PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256 =
  '4715db73b0d3bdda7c460606893081a09d3b99e881765ad23fe47ec05a815b60'

function validIsoDate(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText ?? ''))) return false
  const parsed = new Date(`${dateText}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateText
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  )
}

function compoundedReturnPct(values) {
  return (values.reduce((wealth, value) => wealth * (1 + value / 100), 1) - 1) * 100
}

export function buildPriorUngPriceExhaustionContext({
  priorCompletedReturns,
  tradeDate,
  lookbackSessions = PRICE_EXHAUSTION_SELECTED_LOOKBACK_SESSIONS,
  volatilityLookbackSessions = PRICE_EXHAUSTION_VOLATILITY_LOOKBACK_SESSIONS,
}) {
  if (!validIsoDate(tradeDate)) {
    throw new Error(`Invalid price-exhaustion trade date: ${tradeDate ?? 'missing'}.`)
  }
  if (!Number.isInteger(lookbackSessions) || lookbackSessions < 2) {
    throw new Error('Price-exhaustion lookbackSessions must be an integer of at least two.')
  }
  if (!Number.isInteger(volatilityLookbackSessions) || volatilityLookbackSessions < lookbackSessions) {
    throw new Error('Price-exhaustion volatilityLookbackSessions must cover the return lookback.')
  }
  const rows = (priorCompletedReturns ?? [])
    .map((row) => ({ date: row?.date, returnPct: Number(row?.returnPct) }))
    .filter((row) => validIsoDate(row.date) && row.date < tradeDate && Number.isFinite(row.returnPct))
    .toSorted((left, right) => left.date.localeCompare(right.date))
  if (new Set(rows.map((row) => row.date)).size !== rows.length) {
    throw new Error('Price-exhaustion prior returns contain duplicate session dates.')
  }
  const recent = rows.slice(-lookbackSessions)
  const volatilityWindow = rows.slice(-volatilityLookbackSessions)
  if (recent.length < lookbackSessions || volatilityWindow.length < 2) {
    return {
      available: false,
      reason: 'insufficient-prior-completed-returns',
      lookbackSessions,
      recentObservationCount: recent.length,
      volatilityObservationCount: volatilityWindow.length,
    }
  }
  const dailyReturnStdPct = sampleStandardDeviation(
    volatilityWindow.map((row) => row.returnPct),
  )
  if (!(dailyReturnStdPct > 0)) {
    return {
      available: false,
      reason: 'zero-prior-daily-return-volatility',
      lookbackSessions,
      recentObservationCount: recent.length,
      volatilityObservationCount: volatilityWindow.length,
    }
  }
  const compoundedPriorReturnPct = compoundedReturnPct(recent.map((row) => row.returnPct))
  return {
    available: true,
    lookbackSessions,
    volatilityLookbackSessions,
    mostRecentCompletedSession: rows.at(-1).date,
    recentStartSession: recent[0].date,
    volatilityStartSession: volatilityWindow[0].date,
    recentObservationCount: recent.length,
    volatilityObservationCount: volatilityWindow.length,
    compoundedPriorReturnPct,
    dailyReturnStdPct,
    z: compoundedPriorReturnPct / (dailyReturnStdPct * Math.sqrt(lookbackSessions)),
  }
}

export function evaluatePriceExhaustionShadow({
  gasPosition,
  priceContext,
  threshold = PRICE_EXHAUSTION_SELECTED_THRESHOLD,
  exhaustedScale = PRICE_EXHAUSTION_SELECTED_SCALE,
}) {
  const selectedGasPosition = Number(gasPosition)
  if (!Number.isFinite(selectedGasPosition) || Math.abs(selectedGasPosition) > 1) {
    throw new Error('Price-exhaustion gasPosition must be finite and inside [-1, 1].')
  }
  if (!(Number(threshold) >= 0) || !(Number(exhaustedScale) >= 0 && Number(exhaustedScale) <= 1)) {
    throw new Error('Price-exhaustion threshold and scale are outside the supported range.')
  }
  if (selectedGasPosition === 0) {
    return {
      observationAvailable: Boolean(priceContext?.available),
      priceExhausted: false,
      scale: 1,
      gasPosition: 0,
      investedIndexFraction: 1,
      reason: 'no-selected-gas-position',
    }
  }
  if (!priceContext?.available || !Number.isFinite(priceContext.z)) {
    return {
      observationAvailable: false,
      priceExhausted: false,
      scale: 1,
      gasPosition: selectedGasPosition,
      investedIndexFraction: 1 - Math.abs(selectedGasPosition),
      reason: priceContext?.reason ?? 'missing-prior-price-context',
    }
  }
  const directionalScore = Math.sign(selectedGasPosition) * priceContext.z
  const priceExhausted = directionalScore > Number(threshold)
  const scale = priceExhausted ? Number(exhaustedScale) : 1
  const scaledGasPosition = scale === 0 ? 0 : selectedGasPosition * scale
  return {
    observationAvailable: true,
    priceExhausted,
    scale,
    gasPosition: scaledGasPosition,
    investedIndexFraction: 1 - Math.abs(scaledGasPosition),
    priceExhaustionZ: priceContext.z,
    directionalScore,
    reason: priceExhausted
      ? 'same-direction-prior-price-move-is-exhausted'
      : 'same-direction-prior-price-move-is-not-exhausted',
  }
}

export function validatePriceExhaustionShadow({
  selectedTradesDigestSha256 = PRICE_EXHAUSTION_SHADOW.comparator.selectedTradesDigestSha256,
  runSummaryDigestSha256 = PRICE_EXHAUSTION_SHADOW.comparator.runSummaryDigestSha256,
  executionContractDigestSha256 = PRICE_EXHAUSTION_SHADOW.comparator.executionContractDigestSha256,
  sealedStrategyContractDigestSha256 =
    PRICE_EXHAUSTION_SHADOW.comparator.sealedStrategyContractDigestSha256,
  ungPriceDigestSha256 = PRICE_EXHAUSTION_SHADOW.priceContext.sourceDigestSha256,
  implementationManifestDigestSha256 =
    PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256,
} = {}) {
  if (
    PRICE_EXHAUSTION_SHADOW.executionEligible
    || PRICE_EXHAUSTION_SHADOW.promotionEligible
    || PRICE_EXHAUSTION_SHADOW.publicStrategy
    || PRICE_EXHAUSTION_SHADOW.activeStrategyChanged
  ) {
    throw new Error('The price-exhaustion shadow must remain non-public and execution-ineligible.')
  }
  if (PRICE_EXHAUSTION_SHADOW.prospectiveStart !== null) {
    throw new Error('The price-exhaustion shadow cannot have a prospective start.')
  }
  if (PRICE_EXHAUSTION_CANDIDATE_FAMILY.length !== 48) {
    throw new Error('The price-exhaustion candidate family must contain exactly 48 candidates.')
  }
  const actualGrid = new Set(PRICE_EXHAUSTION_CANDIDATE_FAMILY.map((candidate) => (
    `${candidate.lookbackSessions}|${candidate.threshold}|${candidate.exhaustedScale}`
  )))
  const requiredGrid = new Set(LOOKBACK_GRID.flatMap((lookback) =>
    THRESHOLD_GRID.flatMap((threshold) =>
      EXHAUSTED_SCALE_GRID.map((scale) => `${lookback}|${threshold}|${scale}`))))
  if (actualGrid.size !== 48 || [...requiredGrid].some((value) => !actualGrid.has(value))) {
    throw new Error('The price-exhaustion candidate family does not match the exact frozen grid.')
  }
  const ids = new Set(PRICE_EXHAUSTION_CANDIDATE_FAMILY.map(({ candidateId }) => candidateId))
  if (ids.size !== 48 || !ids.has(PRICE_EXHAUSTION_SELECTED_CANDIDATE_ID)) {
    throw new Error('The price-exhaustion candidate identifiers are duplicate or omit the selected rule.')
  }
  if (
    PRICE_EXHAUSTION_CANDIDATE_FAMILY_DIGEST_SHA256
      !== priceExhaustionValueDigestSha256(PRICE_EXHAUSTION_CANDIDATE_FAMILY)
  ) {
    throw new Error('The price-exhaustion candidate-family digest is stale.')
  }
  if (
    selectedTradesDigestSha256 !== PRICE_EXHAUSTION_SHADOW.comparator.selectedTradesDigestSha256
    || runSummaryDigestSha256 !== PRICE_EXHAUSTION_SHADOW.comparator.runSummaryDigestSha256
    || executionContractDigestSha256
      !== PRICE_EXHAUSTION_SHADOW.comparator.executionContractDigestSha256
    || sealedStrategyContractDigestSha256
      !== PRICE_EXHAUSTION_SHADOW.comparator.sealedStrategyContractDigestSha256
    || ungPriceDigestSha256 !== PRICE_EXHAUSTION_SHADOW.priceContext.sourceDigestSha256
    || implementationManifestDigestSha256
      !== PRICE_EXHAUSTION_IMPLEMENTATION_MANIFEST_DIGEST_SHA256
  ) {
    throw new Error('The price-exhaustion shadow no longer matches its bound inputs.')
  }
  if (
    PRICE_EXHAUSTION_SHADOW_DIGEST_SHA256
      !== priceExhaustionValueDigestSha256(PRICE_EXHAUSTION_SHADOW)
  ) {
    throw new Error('The price-exhaustion shadow contract digest is stale.')
  }
  return true
}
