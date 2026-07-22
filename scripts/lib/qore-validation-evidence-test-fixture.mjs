import crypto from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID,
  PAPER_EXECUTION_EVIDENCE_ARTIFACT_ID,
  REVIEWED_NYSE_CALENDAR_ID,
  VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
  forwardInferenceDigestSha256,
  paperBrokerRecordDigestSha256,
  resolveValidationEvidenceArtifactPaths,
  reviewedNyseSessionDates,
} from './qore-validation-evidence.mjs'

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

function firstCompleteSeasons(kind, prospectiveStart, observedThrough, count) {
  const result = []
  const firstYear = Number(prospectiveStart.slice(0, 4)) - 1
  const lastYear = Number(observedThrough.slice(0, 4))
  for (let year = firstYear; year <= lastYear && result.length < count; year += 1) {
    const bounds = seasonBounds(kind, year)
    if (prospectiveStart <= bounds.startDate && bounds.endDate <= observedThrough) result.push(bounds)
  }
  if (result.length !== count) throw new Error(`Fixture period does not contain ${count} complete ${kind} seasons.`)
  return result
}

function episodeDates(prospectiveStart, observedThrough, count) {
  const selected = []
  let previousObservationEnd = null
  for (const sessionDate of reviewedNyseSessionDates(prospectiveStart, observedThrough)) {
    const observationEnd = addDays(sessionDate, 1)
    if (observationEnd > observedThrough) continue
    if (previousObservationEnd !== null && sessionDate <= previousObservationEnd) continue
    selected.push(sessionDate)
    previousObservationEnd = observationEnd
    if (selected.length === count) break
  }
  if (selected.length !== count) throw new Error(`Fixture period does not contain ${count} non-overlapping episodes.`)
  return selected
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
  prospectiveStart = '2023-01-01',
  observedThrough = '2025-09-30',
  paperPeriodStart = '2023-01-03',
  paperPeriodEnd = null,
  submittedOrderCount = 10,
} = {}) {
  const paths = resolveValidationEvidenceArtifactPaths(repoDir, manifestPath)
  const coveredSeasonBounds = [
    ...firstCompleteSeasons('summer', prospectiveStart, observedThrough, 2),
    ...firstCompleteSeasons('winter', prospectiveStart, observedThrough, 2),
  ]
  const coveredSessions = new Set(coveredSeasonBounds.flatMap(({ startDate, endDate }) => (
    reviewedNyseSessionDates(startDate, endDate)
  )))
  const selectedEpisodeDates = episodeDates(prospectiveStart, observedThrough, 60)
  const episodeDateSet = new Set(selectedEpisodeDates)
  for (const date of selectedEpisodeDates) coveredSessions.add(date)

  const observations = [...coveredSessions].sort().map((sessionDate) => {
    const inference = {
      schemaVersion: 1,
      strategyId: 'ngas-all-year-beta',
      generatedAt: `${sessionDate}T11:59:00.000Z`,
      targetDate: sessionDate,
      gasPosition: 0,
      indexFraction: 0.98,
      cashFraction: 0.02,
      thesisKind: 'index-fallback',
    }
    return {
      observationIdSha256: digest(`forward-observation:${sessionDate}`),
      sessionDate,
      recordedAt: `${sessionDate}T12:00:00.000Z`,
      strategyContractDigestSha256,
      strategyArtifactDigestSha256: strategyArtifactCoreDigestSha256,
      inference,
      inferenceDigestSha256: forwardInferenceDigestSha256(inference),
      independentEpisode: episodeDateSet.has(sessionDate)
        ? {
            episodeIdSha256: digest(`forward-episode:${sessionDate}`),
            forecastWindowStart: sessionDate,
            forecastWindowEnd: sessionDate,
            observationWindowStart: addDays(sessionDate, 1),
            observationWindowEnd: addDays(sessionDate, 1),
          }
        : null,
    }
  })
  const forwardArtifact = {
    schemaVersion: VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
    artifactId: FORWARD_VALIDATION_EVIDENCE_ARTIFACT_ID,
    strategyId: 'ngas-all-year-beta',
    marketCalendarId: REVIEWED_NYSE_CALENDAR_ID,
    observedThrough,
    observations,
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
    schemaVersion: VALIDATION_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
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
      independentEpisodes: 60,
      completeSummerSeasons: 2,
      completeWinterSeasons: 2,
      observedThrough,
      strategyContractDigestSha256,
      strategyArtifactDigestSha256: strategyArtifactCoreDigestSha256,
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
      ungFilledOrders: Math.min(4, submittedOrderCount),
      ungLongFilledOrders: Math.min(2, submittedOrderCount),
      ungShortFilledOrders: Math.max(0, Math.min(2, submittedOrderCount - 2)),
      medianAbsoluteSlippageBps: 10,
      p95AbsoluteSlippageBps: submittedOrderCount >= 10 ? 20 : 10,
    },
    forwardEvidenceArtifactDigestSha256: await writeProtectedJson(paths.forward, forwardArtifact),
    paperEvidenceArtifactDigestSha256: await writeProtectedJson(paths.paper, paperArtifact),
  }
}
