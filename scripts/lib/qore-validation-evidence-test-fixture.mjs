import crypto from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_FORWARD_OUTCOME_POLICY,
  FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID,
  FORWARD_VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
  PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID,
  PAPER_EXECUTION_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
  REVIEWED_NYSE_CALENDAR_ID,
  buildForwardSettlementRecords,
  forwardExecutableTargetDigestSha256,
  forwardInferenceDigestSha256,
  forwardObservationIdSha256,
  forwardOutcomePolicyDigestSha256,
  paperBrokerRecordDigestSha256,
  resolveValidationEvidenceArtifactPaths,
  reviewedNyseSessionDates,
  reviewedNyseSessionStatus,
} from './qore-validation-evidence.mjs'
import { loadResearchExecutionContract } from './qore-research-execution.mjs'
import { executableLiveComponentActiveForDate } from './qore-live-contract.mjs'

function addDays(date, count) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + count * 86400000).toISOString().slice(0, 10)
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function writeProtectedJson(filePath, value) {
  const raw = `${JSON.stringify(value, null, 2)}\n`
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, raw, { encoding: 'utf8', mode: 0o600 })
  await chmod(filePath, 0o600)
  return digest(raw)
}

function seasonBounds(kind, year) {
  return kind === 'summer'
    ? { startDate: `${year}-05-01`, endDate: `${year}-09-30` }
    : { startDate: `${year}-11-01`, endDate: `${year + 1}-03-31` }
}

function completeSeasons(kind, prospectiveStart, observedThrough) {
  const result = []
  const firstYear = Number(prospectiveStart.slice(0, 4)) - 1
  const lastYear = Number(observedThrough.slice(0, 4))
  for (let year = firstYear; year <= lastYear; year += 1) {
    const bounds = seasonBounds(kind, year)
    if (prospectiveStart <= bounds.startDate && bounds.endDate <= observedThrough) result.push(bounds)
  }
  return result
}

function componentEpisodeDates(kind, prospectiveStart, observedThrough, count, embargoSessions) {
  const selected = []
  const spacing = embargoSessions + 3
  for (const bounds of completeSeasons(kind, prospectiveStart, observedThrough)) {
    const sessions = reviewedNyseSessionDates(bounds.startDate, bounds.endDate)
      .filter((targetDate) => executableLiveComponentActiveForDate({
        season: kind,
        targetDate,
      }))
    for (let index = 0; index < sessions.length - 1 && selected.length < count; index += spacing) {
      selected.push(sessions[index])
    }
    if (selected.length === count) break
  }
  if (selected.length !== count) {
    throw new Error(`Fixture period does not contain ${count} embargo-separated ${kind} episodes.`)
  }
  return selected
}

function priorReviewedSession(date) {
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addDays(date, -offset)
    if (reviewedNyseSessionStatus(candidate).session) return candidate
  }
  throw new Error(`Unable to find the preceding reviewed session for ${date}.`)
}

function completeSeasonCounts(prospectiveStart, observedThrough) {
  const result = { completeSummerSeasons: 0, completeWinterSeasons: 0 }
  const firstYear = Number(prospectiveStart.slice(0, 4)) - 1
  const lastYear = Number(observedThrough.slice(0, 4))
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const [kind, field] of [
      ['summer', 'completeSummerSeasons'],
      ['winter', 'completeWinterSeasons'],
    ]) {
      const bounds = seasonBounds(kind, year)
      if (prospectiveStart <= bounds.startDate && bounds.endDate <= observedThrough) result[field] += 1
    }
  }
  return result
}

function paperSessions(periodStart, periodEnd) {
  if (periodEnd) return reviewedNyseSessionDates(periodStart, periodEnd)
  const horizonEnd = addDays(periodStart, 180)
  return reviewedNyseSessionDates(periodStart, horizonEnd).slice(0, 60)
}

export async function writeValidationEvidenceTestFixtures({
  repoDir,
  manifestPath,
  strategyContractDigestSha256,
  strategyArtifactCoreDigestSha256,
  brokerExecutionProfileDigestSha256,
  accountPseudonymSha256,
  preregistrationDigestSha256,
  sealedAt,
  prospectiveStart = '2020-01-03',
  observedThrough = '2025-09-30',
  paperPeriodStart = '2023-01-03',
  paperPeriodEnd = null,
  submittedOrderCount = 10,
  forwardOutcomePolicy = DEFAULT_FORWARD_OUTCOME_POLICY,
  materialGasPosition = null,
  materialUngIntradayReturnPct = 1,
  episodesPerComponent = 30,
  additionalWithinEmbargoTarget = false,
} = {}) {
  if (!/^[a-f0-9]{64}$/.test(String(preregistrationDigestSha256 ?? ''))) {
    throw new Error('Fixture preregistrationDigestSha256 must be explicit and valid.')
  }
  if (new Date(sealedAt).toISOString() !== sealedAt) {
    throw new Error('Fixture sealedAt must be an explicit ISO timestamp.')
  }
  const paths = resolveValidationEvidenceArtifactPaths(repoDir, manifestPath)
  const componentByEpisodeDate = new Map()
  for (const date of componentEpisodeDates(
    'summer',
    prospectiveStart,
    observedThrough,
    episodesPerComponent,
    forwardOutcomePolicy.episodeEmbargoSessions,
  )) componentByEpisodeDate.set(date, 'ngas-summer-alpha')
  for (const date of componentEpisodeDates(
    'winter',
    prospectiveStart,
    observedThrough,
    episodesPerComponent,
    forwardOutcomePolicy.episodeEmbargoSessions,
  )) componentByEpisodeDate.set(date, 'ngas-winter-alpha')
  const policyDigestSha256 = forwardOutcomePolicyDigestSha256(forwardOutcomePolicy)
  const coveredSessions = reviewedNyseSessionDates(prospectiveStart, observedThrough)
  let expectedMaterialEpisodeCount = componentByEpisodeDate.size
  if (additionalWithinEmbargoTarget) {
    const firstEpisodeDate = componentByEpisodeDate.keys().next().value
    const firstEpisodeIndex = coveredSessions.indexOf(firstEpisodeDate)
    const additionalDate = coveredSessions[firstEpisodeIndex + 5]
    componentByEpisodeDate.set(additionalDate, componentByEpisodeDate.get(firstEpisodeDate))
    // The added target bridges the first two otherwise independent targets
    // inside the 10-session embargo; it must reduce, not increase, the count.
    expectedMaterialEpisodeCount -= 1
  }
  const observations = coveredSessions.map((sessionDate) => {
    const episodeComponentStrategyId = componentByEpisodeDate.get(sessionDate) ?? null
    const active = episodeComponentStrategyId !== null
      && (materialGasPosition === null || Math.abs(materialGasPosition) > 1e-8)
    const gasPosition = active
      ? materialGasPosition ?? (episodeComponentStrategyId === 'ngas-summer-alpha' ? 0.35 : 0.3125)
      : 0
    const inference = {
      schemaVersion: 1,
      strategyId: 'ngas-all-year-beta',
      componentStrategyId: active ? episodeComponentStrategyId : 'index-fallback',
      generatedAt: `${sessionDate}T11:59:00.000Z`,
      targetDate: sessionDate,
      gasPosition,
      indexFraction: 1 - Math.abs(gasPosition),
      cashFraction: 0,
      windowId: active ? 'weather-follow' : 'index-fallback',
      thesisKind: active
        ? episodeComponentStrategyId === 'ngas-summer-alpha' ? 'summer-heat-long' : 'cold-long'
        : 'index-fallback',
    }
    const observation = {
      observationIdSha256: null,
      sessionDate,
      recordedAt: `${sessionDate}T12:00:00.000Z`,
      strategyContractDigestSha256,
      strategyArtifactDigestSha256: strategyArtifactCoreDigestSha256,
      outcomePolicyDigestSha256: policyDigestSha256,
      preregistrationDigestSha256,
      sealedAt,
      inference,
      inferenceDigestSha256: forwardInferenceDigestSha256(inference),
      liveInferenceDigestSha256: digest(`live-inference:${sessionDate}:${JSON.stringify(inference)}`),
      signalHandoffDigestSha256: digest(`signal-handoff:${sessionDate}:${JSON.stringify(inference)}`),
      inputProvenanceDigestSha256: digest(`point-in-time-inputs:${sessionDate}`),
      executableTargetDigestSha256: forwardExecutableTargetDigestSha256(inference),
    }
    observation.observationIdSha256 = forwardObservationIdSha256(observation)
    return observation
  })
  const marketSessions = coveredSessions.map((sessionDate) => {
    const previousDate = priorReviewedSession(sessionDate)
    const material = componentByEpisodeDate.has(sessionDate)
    return {
      schemaVersion: 1,
      sourceId: forwardOutcomePolicy.marketDataSourceId,
      date: sessionDate,
      previousDate,
      calendarGapDays: Math.round(
        (Date.parse(`${sessionDate}T00:00:00.000Z`) - Date.parse(`${previousDate}T00:00:00.000Z`)) / 86400000,
      ),
      symbols: {
        UNG: { overnightReturnPct: 0, intradayReturnPct: material ? materialUngIntradayReturnPct : 0 },
        VOO: { overnightReturnPct: 0, intradayReturnPct: 0 },
        QQQM: { overnightReturnPct: 0, intradayReturnPct: 0 },
      },
    }
  })
  const settlements = buildForwardSettlementRecords({
    observations,
    marketSessions,
    outcomePolicy: forwardOutcomePolicy,
    executionContract: loadResearchExecutionContract(repoDir),
    settledAtBySessionDate: (sessionDate) => `${sessionDate}T22:00:00.000Z`,
  })
  const forwardArtifact = {
    schemaVersion: FORWARD_VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
    artifactId: FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID,
    strategyId: 'ngas-all-year-beta',
    marketCalendarId: REVIEWED_NYSE_CALENDAR_ID,
    observedThrough,
    outcomePolicyDigestSha256: policyDigestSha256,
    preregistrationDigestSha256,
    sealedAt,
    commitmentJournal: {
      schemaVersion: 1,
      writerId: 'qore-test-forward-commitment-writer-v1',
      testOnly: true,
      preregistrationDigestSha256,
      sealedAt,
    },
    observations,
    settlements,
  }

  const sessions = paperSessions(paperPeriodStart, paperPeriodEnd)
  if (sessions.length < 60) throw new Error('Paper fixture requires at least 60 complete reviewed NYSE sessions.')
  const positions = new Map()
  const orders = Array.from({ length: submittedOrderCount }, (_, index) => {
    const filled = index < 10
    const symbol = index < 4 ? 'UNG' : 'VOO'
    const side = index < 2 ? 'buy' : index < 4 ? 'sell' : 'buy'
    const quantity = index === 2 ? 3 : 1
    const sessionDate = sessions[Math.min(index, sessions.length - 1)]
    const prePositionQuantity = filled ? positions.get(symbol) ?? 0 : null
    const postPositionQuantity = filled
      ? prePositionQuantity + (side === 'buy' ? quantity : -quantity)
      : null
    if (filled) positions.set(symbol, postPositionQuantity)
    const slippageBps = index === 9 ? 20 : 10
    const order = {
      orderIdSha256: digest(`paper-order-${index + 1}`),
      brokerRecordDigestSha256: null,
      symbol,
      side,
      quantity,
      status: filled ? 'filled' : 'canceled',
      submittedAt: `${sessionDate}T15:00:00.000Z`,
      filledAt: filled ? `${sessionDate}T15:00:01.000Z` : null,
      prePositionQuantity,
      postPositionQuantity,
      referenceQuoteTimestamp: filled ? `${sessionDate}T15:00:00.000Z` : null,
      referenceQuoteBidPriceUsd: filled ? 99.99 : null,
      referenceQuoteAskPriceUsd: filled ? 100.01 : null,
      referencePriceUsd: filled ? 100 : null,
      averageFillPriceUsd: filled ? 100 * (1 + slippageBps / 10000) : null,
    }
    order.brokerRecordDigestSha256 = paperBrokerRecordDigestSha256(order)
    return order
  })
  const paperArtifact = {
    schemaVersion: PAPER_EXECUTION_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
    artifactId: PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID,
    strategyId: 'ngas-all-year-beta',
    marketCalendarId: REVIEWED_NYSE_CALENDAR_ID,
    strategyContractDigestSha256,
    brokerExecutionProfileDigestSha256,
    accountPseudonymSha256,
    tradingSessions: sessions,
    orders,
  }

  return {
    paths,
    forwardArtifact,
    paperArtifact,
    forwardSummary: {
      independentEpisodes: (
        materialGasPosition === null
        || Math.abs(materialGasPosition) >= forwardOutcomePolicy.minimumMaterialAbsoluteGasPosition
      )
        ? expectedMaterialEpisodeCount
        : 0,
      ...completeSeasonCounts(prospectiveStart, observedThrough),
      observedThrough,
      strategyContractDigestSha256,
      strategyArtifactDigestSha256: strategyArtifactCoreDigestSha256,
      outcomePolicyDigestSha256: policyDigestSha256,
      preregistrationDigestSha256,
      sealedAt,
    },
    paperSummary: {
      strategyContractDigestSha256,
      brokerExecutionProfileDigestSha256,
      accountPseudonymSha256,
      periodStart: sessions[0],
      periodEnd: sessions.at(-1),
      tradingSessions: sessions.length,
      submittedOrders: submittedOrderCount,
      filledOrders: Math.min(10, submittedOrderCount),
      filledOrderRatio: submittedOrderCount > 0
        ? Math.round(Math.min(10, submittedOrderCount) / submittedOrderCount * 1e6) / 1e6
        : 0,
      ungFilledOrders: Math.min(4, submittedOrderCount),
      ungLongFilledOrders: Math.min(2, submittedOrderCount),
      ungShortFilledOrders: Math.max(0, Math.min(2, submittedOrderCount - 2)),
      medianAbsoluteSlippageBps: 10,
      p95AbsoluteSlippageBps: submittedOrderCount >= 10 ? 20 : 10,
      ungMedianAbsoluteSlippageBps: 10,
      ungP95AbsoluteSlippageBps: 10,
    },
    forwardEvidenceArtifactDigestSha256: await writeProtectedJson(paths.forward, forwardArtifact),
    paperEvidenceArtifactDigestSha256: await writeProtectedJson(paths.paper, paperArtifact),
  }
}
