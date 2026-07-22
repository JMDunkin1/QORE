#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT,
  SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE,
  SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY,
  appendSpatialDemandRevisionSettlementRecord,
  appendSpatialDemandRevisionTargetRecord,
  buildSpatialDemandRevisionFeatures,
  createSpatialDemandRevisionSettlementRecord,
  createSpatialDemandRevisionTargetRecord,
  previousReviewedMarketSession,
  readSpatialDemandRevisionManifest,
  spatialDemandRevisionDigestSha256,
  spatialDemandRevisionRecordTiming,
  spatialDemandRevisionSettlementTiming,
  spatialDemandRevisionShadowDecision,
  spatialDemandRevisionYahooChartUrl,
  summarizeSpatialDemandRevisionForecastInputs,
  validateSpatialDemandRevisionTargetRecord,
  validateSpatialDemandRevisionSettlementRecord,
} from './lib/qore-spatial-demand-revision-shadow.mjs'
import {
  spatialDemandRevisionExpectedSessions,
  spatialDemandRevisionIndependentEpisodes,
} from './evaluate-qore-spatial-demand-revision-shadow.mjs'
import {
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT,
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
  SUMMER_FORECAST_REVIEWED_MODEL_IDS,
  forecastLocationSampleSetDigestSha256,
  forecastSampleProvenanceDigestSha256,
  forecastSampleVectorDigestSha256,
  forecastValidTimeForTargetOffset,
  reviewedSummerNormalMeanF,
  summerForecastTemporalSamplingMetadata,
} from './lib/qore-summer-forecast-contract.mjs'
import {
  SUMMER_FORECAST_LOCATIONS,
  SUMMER_FORECAST_LOCATION_UNIVERSE,
} from './lib/qore-summer-location-universe.mjs'

const OFFSETS = [6, 12, 18, 24]
const TEMPORAL_CONTRACT_ID = 'custom-forecast-time-offset-mean-v1'
const TOTAL_WEIGHT = SUMMER_FORECAST_LOCATION_UNIVERSE.expectedSampledWeight

function addDays(date, count) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10)
}

function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function fileDigest(filePath) {
  return crypto.createHash('sha256').update(await readFile(filePath)).digest('hex')
}

const protectedPaths = [
  'config/qore-validation-integrity.json',
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json',
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv',
  'scripts/lib/qore-live-all-year-inference.mjs',
]
const protectedDigestsBefore = await Promise.all(protectedPaths.map(fileDigest))

function sourceInput({
  sourceId,
  targetDate,
  priorForecastF,
  currentForecastF,
  priorByLocation = {},
  currentByLocation = {},
}) {
  const currentIssueDate = previousReviewedMarketSession(targetDate)
  const priorIssueDate = addDays(currentIssueDate, -1)
  const weatherTargetDate = addDays(currentIssueDate, 7)
  const modelId = SUMMER_FORECAST_REVIEWED_MODEL_IDS[sourceId]
  const manifest = {
    schemaVersion: 1,
    forecastSource: sourceId,
    runHour: '00',
    leadDays: [7, 8],
    validTimeOffsetsHoursFromTargetUtcMidnight: OFFSETS,
    temporalSampling: summerForecastTemporalSamplingMetadata({
      runHourUtc: '00',
      leadDays: [7, 8],
      offsets: OFFSETS,
    }),
  }

  function group({ issueDate, leadDays, fallbackForecastF, byLocation }) {
    const samples = OFFSETS.map((offsetHours, index) => ({
      offsetHours,
      validTimeUtc: forecastValidTimeForTargetOffset({
        targetDate: weatherTargetDate,
        offsetHours,
      }),
      forecastHour: leadDays * 24 + offsetHours,
      sourceUrl: sourceId === 'gfs'
        ? `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${issueDate.replaceAll('-', '')}/00/atmos/gfs.t00z.pgrb2.0p25.f${String(leadDays * 24 + offsetHours).padStart(3, '0')}`
        : `https://noaa-gefs-pds.s3.amazonaws.com/gefs.${issueDate.replaceAll('-', '')}/00/atmos/pgrb2sp25/geavg.t00z.pgrb2s.0p25.f${String(leadDays * 24 + offsetHours).padStart(3, '0')}`,
      get indexUrl() { return `${this.sourceUrl}.idx` },
      indexLine: `1:0:d=${issueDate.replaceAll('-', '')}00:TMP:2 m above ground:${index}`,
      sourceIndexPayloadDigestSha256: String(index + 5).repeat(64),
      sourcePayloadDigestSha256: String(index + 1).repeat(64),
    }))
    const provenanceDigest = forecastSampleProvenanceDigestSha256({
      contractId: TEMPORAL_CONTRACT_ID,
      issueDate,
      targetDate: weatherTargetDate,
      leadDays,
      modelId,
      samples,
    })
    const locationRows = SUMMER_FORECAST_LOCATIONS.map((location) => {
      const forecastMeanF = Number(byLocation[location.id] ?? fallbackForecastF)
      const normalMeanF = reviewedSummerNormalMeanF({
        locationId: location.id,
        targetDate: weatherTargetDate,
      })
      const forecastAnomalyF = round(forecastMeanF - normalMeanF)
      const sampledForecastValuesF = OFFSETS.map(() => forecastMeanF).join('|')
      const row = {
        sourceId,
        issueDate,
        targetDate: weatherTargetDate,
        leadDays,
        windowId: 'rumor',
        modelId,
        locationId: location.id,
        region: location.region,
        weight: location.weight,
        forecastMeanF,
        normalMeanF,
        forecastAnomalyF,
        forecastTemporalContractId: TEMPORAL_CONTRACT_ID,
        sampledValidTimeOffsetsHours: OFFSETS.join('|'),
        sampledValidHoursUtc: OFFSETS.join('|'),
        sampledForecastValuesF,
        normalSourceContractId: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.contractId,
        normalSourceContractDigestSha256:
          SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
        normalSourcePayloadDigestSha256:
          SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.payloadDigestSha256ByLocationId[location.id],
        forecastSampleProvenanceDigestSha256: provenanceDigest,
      }
      row.forecastSampleVectorDigestSha256 = forecastSampleVectorDigestSha256({
        contractId: TEMPORAL_CONTRACT_ID,
        issueDate,
        targetDate: weatherTargetDate,
        leadDays,
        modelId,
        locationId: location.id,
        weight: location.weight,
        offsets: OFFSETS,
        sampleValuesF: OFFSETS.map(() => forecastMeanF),
        normalMeanF,
        forecastAnomalyF,
        normalSourceContractId: row.normalSourceContractId,
        normalSourceContractDigestSha256: row.normalSourceContractDigestSha256,
        normalSourcePayloadDigestSha256: row.normalSourcePayloadDigestSha256,
        provenanceDigestSha256: provenanceDigest,
      })
      return row
    })
    const weightedAnomalyF = locationRows.reduce(
      (sum, row) => sum + Number(row.weight) * Number(row.forecastAnomalyF),
      0,
    ) / TOTAL_WEIGHT
    const coldWeight = locationRows
      .filter((row) => row.forecastAnomalyF <= -8)
      .reduce((sum, row) => sum + row.weight, 0)
    const scoreRow = {
      sourceId,
      issueDate,
      targetDate: weatherTargetDate,
      leadDays,
      windowId: 'rumor',
      modelId,
      locationCount: locationRows.length,
      sampledWeight: round(locationRows.reduce((sum, row) => sum + row.weight, 0)),
      weightedAnomalyF: round(weightedAnomalyF),
      coveragePct: round(coldWeight / TOTAL_WEIGHT),
      extremeCount: locationRows.filter((row) => row.forecastAnomalyF <= -14).length,
      forecastTemporalContractId: TEMPORAL_CONTRACT_ID,
      sampledValidTimeOffsetsHours: OFFSETS.join('|'),
      sampledValidHoursUtc: OFFSETS.join('|'),
      forecastSampleProvenanceJson: JSON.stringify(samples),
      forecastSampleProvenanceDigestSha256: provenanceDigest,
    }
    scoreRow.locationSampleVectorSetDigestSha256 = forecastLocationSampleSetDigestSha256({
      contractId: TEMPORAL_CONTRACT_ID,
      issueDate,
      targetDate: weatherTargetDate,
      leadDays,
      modelId,
      locationRows,
    })
    return { scoreRow, locationRows }
  }

  const prior = group({
    issueDate: priorIssueDate,
    leadDays: 8,
    fallbackForecastF: priorForecastF,
    byLocation: priorByLocation,
  })
  const current = group({
    issueDate: currentIssueDate,
    leadDays: 7,
    fallbackForecastF: currentForecastF,
    byLocation: currentByLocation,
  })
  return {
    sourceId,
    manifest,
    manifestDigestSha256: spatialDemandRevisionDigestSha256(manifest),
    scoreRows: [prior.scoreRow, current.scoreRow],
    locationRows: [...prior.locationRows, ...current.locationRows],
  }
}

function featureFixture({
  targetDate = '2026-07-23',
  gfsPrior = 75,
  gfsCurrent = 77,
  gefsPrior = gfsPrior,
  gefsCurrent = gfsCurrent,
  priorByLocation = {},
  currentByLocation = {},
  startClose = 100,
  endClose = 99,
} = {}) {
  const currentIssueDate = previousReviewedMarketSession(targetDate)
  const sourceUrl = spatialDemandRevisionYahooChartUrl({ symbol: 'NG=F', targetDate })
  const responsePayloadDigestSha256 = 'a'.repeat(64)
  const sourceInputs = [
    sourceInput({
      sourceId: 'gfs',
      targetDate,
      priorForecastF: gfsPrior,
      currentForecastF: gfsCurrent,
      priorByLocation,
      currentByLocation,
    }),
    sourceInput({
      sourceId: 'gefs-mean',
      targetDate,
      priorForecastF: gefsPrior,
      currentForecastF: gefsCurrent,
      priorByLocation,
      currentByLocation,
    }),
  ]
  const gasBars = [
    {
      date: addDays(currentIssueDate, -1),
      close: startClose,
      contract: 'NG=F',
      provisional: false,
      sourceUrl,
      responsePayloadDigestSha256,
    },
    {
      date: currentIssueDate,
      close: endClose,
      contract: 'NG=F',
      provisional: false,
      sourceUrl,
      responsePayloadDigestSha256,
    },
  ]
  return {
    targetDate,
    sourceInputs,
    gasBars,
    featureBundle: buildSpatialDemandRevisionFeatures({ targetDate, sourceInputs, gasBars }),
  }
}

assert.equal(SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT.executionEligible, false)
assert.equal(SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.executionEligible, false)
assert.equal(SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.publicStrategy, false)
assert.equal(SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY.familySize, 1)
assert.equal(SPATIAL_DEMAND_REVISION_SHADOW_REGISTRY.candidates.length, 1)
assert.ok(Object.isFrozen(SPATIAL_DEMAND_REVISION_FEATURE_CONTRACT))
assert.ok(Object.isFrozen(SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE))

const summer = featureFixture()
assert.equal(summer.featureBundle.season, 'summer')
assert.equal(summer.featureBundle.consensus.demandRevisionF, 2)
assert.equal(summer.featureBundle.consensus.directionalBreadthFraction, 1)
assert.equal(summer.featureBundle.priceResponse.responsePct, -1)
for (const input of summer.sourceInputs) {
  assert.equal(summarizeSpatialDemandRevisionForecastInputs(input).complete, true)
}
const summerDecision = spatialDemandRevisionShadowDecision(summer.featureBundle)
assert.equal(summerDecision.status, 'valid-signal')
assert.equal(summerDecision.target.gasPosition, 0.25)
assert.equal(summerDecision.target.indexFraction, 0.75)
assert.equal(summerDecision.target.executionEligible, false)

const alreadyPriced = featureFixture({ startClose: 100, endClose: 101 })
assert.equal(spatialDemandRevisionShadowDecision(alreadyPriced.featureBundle).status, 'valid-flat')
assert.match(
  spatialDemandRevisionShadowDecision(alreadyPriced.featureBundle).reason,
  /priceNotAlreadyMovingWithRevision/,
)

const disagreement = featureFixture({
  gfsPrior: 75,
  gfsCurrent: 77,
  gefsPrior: 77,
  gefsCurrent: 75,
})
assert.equal(spatialDemandRevisionShadowDecision(disagreement.featureBundle).status, 'valid-flat')
assert.match(
  spatialDemandRevisionShadowDecision(disagreement.featureBundle).reason,
  /completeModelDirectionAgreement/,
)

const weakRevision = featureFixture({ gfsCurrent: 75.5 })
assert.equal(spatialDemandRevisionShadowDecision(weakRevision.featureBundle).status, 'valid-flat')
assert.match(spatialDemandRevisionShadowDecision(weakRevision.featureBundle).reason, /minimumRevision/)

const numericalNoise = featureFixture({ gfsCurrent: 75.1 })
assert.equal(numericalNoise.featureBundle.consensus.directionalBreadthFraction, 0)

let positiveWeight = 0
const mixedCurrent = {}
for (const location of SUMMER_FORECAST_LOCATIONS) {
  if (positiveWeight + location.weight <= 0.6 + 1e-9) {
    mixedCurrent[location.id] = 78
    positiveWeight += location.weight
  } else {
    mixedCurrent[location.id] = 74.9
  }
}
const narrowBreadth = featureFixture({ currentByLocation: mixedCurrent })
assert.ok(narrowBreadth.featureBundle.consensus.demandRevisionF >= 1)
assert.ok(narrowBreadth.featureBundle.consensus.directionalBreadthFraction < 2 / 3)
assert.match(spatialDemandRevisionShadowDecision(narrowBreadth.featureBundle).reason, /minimumBreadth/)

const summerNegative = featureFixture({
  gfsPrior: 77,
  gfsCurrent: 75,
  startClose: 100,
  endClose: 101,
})
assert.equal(spatialDemandRevisionShadowDecision(summerNegative.featureBundle).status, 'valid-flat')
assert.match(
  spatialDemandRevisionShadowDecision(summerNegative.featureBundle).reason,
  /summerDirectionAllowed/,
)

const winter = featureFixture({
  targetDate: '2026-01-08',
  gfsPrior: 30,
  gfsCurrent: 32,
  startClose: 100,
  endClose: 101,
})
assert.equal(winter.featureBundle.season, 'winter')
assert.equal(winter.featureBundle.consensus.demandRevisionF, -2)
const winterDecision = spatialDemandRevisionShadowDecision(winter.featureBundle)
assert.equal(winterDecision.status, 'valid-signal')
assert.equal(winterDecision.target.gasPosition, -0.25)
assert.equal(winterDecision.target.indexFraction, 0.75)

const inactive = buildSpatialDemandRevisionFeatures({
  targetDate: '2026-10-15',
  sourceInputs: [],
  gasBars: [],
})
assert.equal(inactive.season, 'inactive')
assert.equal(spatialDemandRevisionShadowDecision(inactive).status, 'valid-flat')

assert.throws(
  () => buildSpatialDemandRevisionFeatures({
    targetDate: summer.targetDate,
    sourceInputs: [summer.sourceInputs[0], summer.sourceInputs[0], summer.sourceInputs[1]],
    gasBars: summer.gasBars,
  }),
  /complete GFS\/GEFS source set/,
)
assert.throws(
  () => buildSpatialDemandRevisionFeatures({
    targetDate: summer.targetDate,
    sourceInputs: summer.sourceInputs,
    gasBars: [...summer.gasBars, {
      date: summer.targetDate,
      close: 98,
      contract: 'NG=F',
      provisional: false,
    }],
  }),
  /target-date or future bar/,
)
assert.throws(
  () => buildSpatialDemandRevisionFeatures({
    targetDate: summer.targetDate,
    sourceInputs: summer.sourceInputs,
    gasBars: summer.gasBars.map((row, index) => ({ ...row, provisional: index === 1 })),
  }),
  /provisional/,
)

for (const mutate of [
  (input) => { input.locationRows.pop() },
  (input) => { input.locationRows[0].weight = 0.5 },
  (input) => { input.locationRows[0].normalMeanF += 1 },
  (input) => { input.scoreRows[0].forecastSampleProvenanceJson = '[]' },
  (input) => { input.scoreRows[0].targetDate = addDays(input.scoreRows[0].targetDate, 1) },
]) {
  const tampered = structuredClone(summer.sourceInputs[0])
  mutate(tampered)
  assert.equal(summarizeSpatialDemandRevisionForecastInputs(tampered).complete, false)
}

const wrongSourceIdentity = structuredClone(summer.sourceInputs[0])
const wrongSourceSamples = JSON.parse(wrongSourceIdentity.scoreRows[0].forecastSampleProvenanceJson)
wrongSourceSamples[0].sourceUrl = 'https://example.invalid/forged.grib2'
wrongSourceIdentity.scoreRows[0].forecastSampleProvenanceJson = JSON.stringify(wrongSourceSamples)
assert.ok(
  summarizeSpatialDemandRevisionForecastInputs(wrongSourceIdentity).failures
    .some((failure) => failure.includes('not the reviewed NOAA object identity')),
)

const inputProvenance = {
  forecastInputsDigestSha256: spatialDemandRevisionDigestSha256(summer.sourceInputs),
  marketRowsDigestSha256: spatialDemandRevisionDigestSha256(summer.gasBars),
  marketSourceDigestSha256: spatialDemandRevisionDigestSha256({
    sourceId: 'yahoo-chart-api',
    symbol: 'NG=F',
    sourceUrl: summer.gasBars[0].sourceUrl,
    responsePayloadDigestSha256: summer.gasBars[0].responsePayloadDigestSha256,
  }),
  forecastAtoms: summer.sourceInputs,
  marketRows: summer.gasBars,
  marketSource: {
    sourceId: 'yahoo-chart-api',
    symbol: 'NG=F',
    sourceUrl: summer.gasBars[0].sourceUrl,
    responsePayloadDigestSha256: summer.gasBars[0].responsePayloadDigestSha256,
  },
  dataCollectionStatus: 'complete',
}
const record = createSpatialDemandRevisionTargetRecord({
  generatedAt: '2026-07-23T12:00:00.000Z',
  targetDate: summer.targetDate,
  manifestDigestSha256: '1'.repeat(64),
  referenceStrategyContractDigestSha256: '2'.repeat(64),
  referenceStrategyArtifactCoreDigestSha256: '3'.repeat(64),
  featureBundle: summer.featureBundle,
  decision: summerDecision,
  inputProvenance,
  diagnostics: { status: 'complete', message: null },
})
assert.equal(validateSpatialDemandRevisionTargetRecord(record), true)

const tamperedMarketSourceRecord = structuredClone(record)
tamperedMarketSourceRecord.inputProvenance.marketRows[0].sourceUrl =
  'https://example.invalid/forged-market-response'
tamperedMarketSourceRecord.inputProvenance.marketRowsDigestSha256 =
  spatialDemandRevisionDigestSha256(tamperedMarketSourceRecord.inputProvenance.marketRows)
delete tamperedMarketSourceRecord.recordDigestSha256
tamperedMarketSourceRecord.recordDigestSha256 =
  spatialDemandRevisionDigestSha256(tamperedMarketSourceRecord)
assert.throws(
  () => validateSpatialDemandRevisionTargetRecord(tamperedMarketSourceRecord),
  /not bound to the reviewed Yahoo response payload/,
)

const tamperedFeatureRecord = structuredClone(record)
tamperedFeatureRecord.featureBundle.consensus.demandRevisionF = 99
delete tamperedFeatureRecord.recordDigestSha256
tamperedFeatureRecord.recordDigestSha256 = spatialDemandRevisionDigestSha256(tamperedFeatureRecord)
assert.throws(
  () => validateSpatialDemandRevisionTargetRecord(tamperedFeatureRecord),
  /does not reproduce/,
)

const tamperedDecisionRecord = structuredClone(record)
tamperedDecisionRecord.decision.target.gasPosition = 0
tamperedDecisionRecord.decision.target.indexFraction = 1
tamperedDecisionRecord.decision.target.direction = 'flat'
tamperedDecisionRecord.decision.target.componentStrategyId = 'index-fallback'
tamperedDecisionRecord.decision.target.windowId = 'index-fallback'
tamperedDecisionRecord.decision.target.thesisKind = 'index-fallback'
delete tamperedDecisionRecord.recordDigestSha256
tamperedDecisionRecord.recordDigestSha256 = spatialDemandRevisionDigestSha256(tamperedDecisionRecord)
assert.throws(
  () => validateSpatialDemandRevisionTargetRecord(tamperedDecisionRecord),
  /does not reproduce/,
)

const inputFailure = createSpatialDemandRevisionTargetRecord({
  generatedAt: '2026-07-24T12:00:00.000Z',
  targetDate: '2026-07-24',
  manifestDigestSha256: '1'.repeat(64),
  referenceStrategyContractDigestSha256: '2'.repeat(64),
  referenceStrategyArtifactCoreDigestSha256: '3'.repeat(64),
  featureBundle: null,
  decision: { status: 'input-failure', target: null, reason: 'test-failure' },
  inputProvenance: {
    forecastInputsDigestSha256: spatialDemandRevisionDigestSha256([]),
    marketRowsDigestSha256: spatialDemandRevisionDigestSha256([]),
    marketSourceDigestSha256: spatialDemandRevisionDigestSha256(null),
    forecastAtoms: [],
    marketRows: [],
    marketSource: null,
    dataCollectionStatus: 'input-failure',
  },
  diagnostics: { status: 'input-failure', message: 'test' },
})
assert.equal(inputFailure.decision.target, null)
assert.equal(inputFailure.featureBundle, null)

assert.deepEqual(
  spatialDemandRevisionRecordTiming({
    targetDate: '2026-07-23',
    generatedAt: '2026-07-23T13:29:59.000Z',
    prospectiveStart: '2026-07-23',
  }),
  { eligible: true, reason: null },
)
assert.equal(spatialDemandRevisionRecordTiming({
  targetDate: '2026-07-23',
  generatedAt: '2026-07-23T13:30:00.000Z',
  prospectiveStart: '2026-07-23',
}).reason, 'at-or-after-session-open')
assert.equal(spatialDemandRevisionRecordTiming({
  targetDate: '2026-11-26',
  generatedAt: '2026-11-26T12:00:00.000Z',
  prospectiveStart: '2026-07-23',
}).reason, 'not-us-equity-market-session')
assert.equal(spatialDemandRevisionRecordTiming({
  targetDate: '2026-07-22',
  generatedAt: '2026-07-22T12:00:00.000Z',
  prospectiveStart: '2026-07-23',
}).reason, 'before-prospective-start')

function settlementOutcome(symbol) {
  const sourceUrl = spatialDemandRevisionYahooChartUrl({
    symbol,
    targetDate: '2026-07-24',
  })
  return {
    symbol,
    sourceId: 'yahoo-chart-api',
    sourceUrl,
    responsePayloadDigestSha256: symbol === 'UNG'
      ? 'b'.repeat(64)
      : symbol === 'VOO'
        ? 'c'.repeat(64)
        : 'd'.repeat(64),
    previous: {
      date: '2026-07-22',
      rawClose: 100,
      adjustedClose: 100,
    },
    current: {
      date: '2026-07-23',
      rawOpen: 101,
      rawHigh: 103,
      rawLow: 100,
      rawClose: 102,
      adjustedOpen: 101,
      adjustedHigh: 103,
      adjustedLow: 100,
      adjustedClose: 102,
      adjustmentFactor: 1,
      volume: 1_000,
    },
  }
}

const settlement = createSpatialDemandRevisionSettlementRecord({
  generatedAt: '2026-07-24T12:00:00.000Z',
  targetDate: '2026-07-23',
  manifestDigestSha256: '1'.repeat(64),
  targetRecordDigestSha256: record.recordDigestSha256,
  executionContractDigestSha256: '4'.repeat(64),
  symbolOutcomes: ['UNG', 'VOO', 'QQQM'].map(settlementOutcome),
})
assert.equal(validateSpatialDemandRevisionSettlementRecord(settlement), true)
assert.deepEqual(
  spatialDemandRevisionSettlementTiming({
    targetDate: '2026-07-23',
    generatedAt: settlement.generatedAt,
    prospectiveStart: '2026-07-23',
  }),
  { eligible: true, reason: null, settlementDate: '2026-07-24' },
)
assert.equal(spatialDemandRevisionSettlementTiming({
  targetDate: '2026-07-23',
  generatedAt: '2026-07-27T12:00:00.000Z',
  prospectiveStart: '2026-07-23',
}).reason, 'not-next-reviewed-session-date')
const malformedSettlement = structuredClone(settlement)
malformedSettlement.symbolOutcomes[0].current.adjustedOpen += 1
delete malformedSettlement.recordDigestSha256
malformedSettlement.recordDigestSha256 = spatialDemandRevisionDigestSha256(malformedSettlement)
assert.throws(
  () => validateSpatialDemandRevisionSettlementRecord(malformedSettlement),
  /adjusted OHLC does not reproduce/,
)

const impossibleOhlcSettlement = structuredClone(settlement)
impossibleOhlcSettlement.symbolOutcomes[0].current.rawHigh =
  impossibleOhlcSettlement.symbolOutcomes[0].current.rawOpen - 1
impossibleOhlcSettlement.symbolOutcomes[0].current.adjustedHigh =
  impossibleOhlcSettlement.symbolOutcomes[0].current.rawHigh
  * impossibleOhlcSettlement.symbolOutcomes[0].current.adjustmentFactor
delete impossibleOhlcSettlement.recordDigestSha256
impossibleOhlcSettlement.recordDigestSha256 = spatialDemandRevisionDigestSha256(
  impossibleOhlcSettlement,
)
assert.throws(
  () => validateSpatialDemandRevisionSettlementRecord(impossibleOhlcSettlement),
  /OHLC ordering/,
)

const episodeSessions = spatialDemandRevisionExpectedSessions('2026-07-23', '2026-08-31')
const episodeRecords = [0, 5, 16].map((index) => ({
  targetDate: episodeSessions[index],
  decision: { status: 'valid-signal' },
  featureBundle: { season: 'summer' },
}))
const independentEpisodes = spatialDemandRevisionIndependentEpisodes({
  sessions: episodeSessions,
  records: episodeRecords,
})
assert.equal(independentEpisodes.length, 2)
assert.equal(independentEpisodes[0].signalCount, 2)
assert.equal(independentEpisodes[1].signalCount, 1)
assert.throws(
  () => spatialDemandRevisionExpectedSessions('2028-12-29', '2029-01-03'),
  /does not cover evaluation date/,
)

const scratch = await mkdtemp(path.join(tmpdir(), 'qore-spatial-demand-revision-shadow-'))
const priorNodeEnv = process.env.NODE_ENV
const priorTestCapability = process.env.QORE_TEST_SPATIAL_SHADOW_OVERRIDES
try {
  process.env.NODE_ENV = 'test'
  process.env.QORE_TEST_SPATIAL_SHADOW_OVERRIDES = '1'
  const firstWrite = await appendSpatialDemandRevisionTargetRecord({
    stateDir: scratch,
    record,
    prospectiveStart: '2026-07-23',
    testNow: record.generatedAt,
  })
  assert.equal(firstWrite.written, true)
  assert.equal((await stat(firstWrite.filePath)).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(await readFile(firstWrite.filePath, 'utf8')), record)
  const duplicateWrite = await appendSpatialDemandRevisionTargetRecord({
    stateDir: scratch,
    record,
    prospectiveStart: '2026-07-23',
    testNow: record.generatedAt,
  })
  assert.deepEqual(
    { written: duplicateWrite.written, reason: duplicateWrite.reason },
    { written: false, reason: 'already-recorded' },
  )
  const backfill = await appendSpatialDemandRevisionTargetRecord({
    stateDir: scratch,
    record,
    prospectiveStart: '2026-07-23',
    testNow: '2026-07-24T12:00:00.000Z',
  })
  assert.equal(backfill.reason, 'not-current-target-session-date')
  const failedWrite = await appendSpatialDemandRevisionTargetRecord({
    stateDir: scratch,
    record: inputFailure,
    prospectiveStart: '2026-07-23',
    testNow: inputFailure.generatedAt,
  })
  assert.equal(failedWrite.written, true)
  assert.equal(JSON.parse(await readFile(failedWrite.filePath, 'utf8')).decision.target, null)

  const settlementDir = path.join(scratch, 'settlements')
  const firstSettlement = await appendSpatialDemandRevisionSettlementRecord({
    stateDir: settlementDir,
    record: settlement,
    prospectiveStart: '2026-07-23',
    testNow: settlement.generatedAt,
  })
  assert.equal(firstSettlement.written, true)
  assert.equal((await stat(firstSettlement.filePath)).mode & 0o777, 0o600)
  const duplicateSettlement = await appendSpatialDemandRevisionSettlementRecord({
    stateDir: settlementDir,
    record: settlement,
    prospectiveStart: '2026-07-23',
    testNow: settlement.generatedAt,
  })
  assert.equal(duplicateSettlement.reason, 'already-settled')

  const realStateDir = path.join(scratch, 'real-state')
  const linkedStateDir = path.join(scratch, 'linked-state')
  await mkdir(realStateDir, { mode: 0o700 })
  await symlink(realStateDir, linkedStateDir)
  await assert.rejects(
    appendSpatialDemandRevisionTargetRecord({
      stateDir: linkedStateDir,
      record,
      prospectiveStart: '2026-07-23',
      testNow: record.generatedAt,
    }),
    /must be a real directory/,
  )
} finally {
  if (priorNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = priorNodeEnv
  if (priorTestCapability === undefined) delete process.env.QORE_TEST_SPATIAL_SHADOW_OVERRIDES
  else process.env.QORE_TEST_SPATIAL_SHADOW_OVERRIDES = priorTestCapability
  await rm(scratch, { recursive: true, force: true })
}

const rejectedCollectorOverride = await runNode(
  ['scripts/collect-qore-spatial-demand-revision-shadow.mjs'],
  {
    NODE_ENV: 'test',
    QORE_TEST_LIVE_INFERENCE_OVERRIDES: '1',
    QORE_GFS_OBJECT_BASE: 'http://127.0.0.1:1/forged',
  },
)
assert.equal(rejectedCollectorOverride.code, 1)
assert.match(rejectedCollectorOverride.stderr, /forbids test mode and endpoint overrides/)
const rejectedSettlementOverride = await runNode(
  ['scripts/settle-qore-spatial-demand-revision-shadow.mjs'],
  {
    NODE_ENV: 'test',
    QORE_TEST_LIVE_INFERENCE_OVERRIDES: '1',
    QORE_LIVE_MARKET_HISTORY_YAHOO_BASE_URL: 'http://127.0.0.1:1/forged',
  },
)
assert.equal(rejectedSettlementOverride.code, 1)
assert.match(rejectedSettlementOverride.stderr, /forbids test mode and endpoint overrides/)

const manifestPath = path.join(process.cwd(), 'config', 'qore-spatial-demand-revision-shadow.json')
const { manifest: sealedManifest } = await readSpatialDemandRevisionManifest(
  process.cwd(),
  manifestPath,
)
const manifestScratch = await mkdtemp(path.join(tmpdir(), 'qore-spatial-manifest-'))
try {
  const movedStart = structuredClone(sealedManifest)
  movedStart.prospectiveStart = '2026-07-24'
  delete movedStart.manifestDigestSha256
  movedStart.manifestDigestSha256 = spatialDemandRevisionDigestSha256(movedStart)
  const movedStartPath = path.join(manifestScratch, 'moved-start.json')
  await writeFile(movedStartPath, JSON.stringify(movedStart))
  await assert.rejects(
    readSpatialDemandRevisionManifest(process.cwd(), movedStartPath),
    /must equal the candidate-frozen prospective start/,
  )

  const changedImplementation = structuredClone(sealedManifest)
  changedImplementation.implementationFiles[0].digestSha256 = '0'.repeat(64)
  delete changedImplementation.manifestDigestSha256
  changedImplementation.manifestDigestSha256 = spatialDemandRevisionDigestSha256(
    changedImplementation,
  )
  const changedImplementationPath = path.join(manifestScratch, 'changed-implementation.json')
  await writeFile(changedImplementationPath, JSON.stringify(changedImplementation))
  await assert.rejects(
    readSpatialDemandRevisionManifest(process.cwd(), changedImplementationPath),
    /implementation file digest changed/,
  )
} finally {
  await rm(manifestScratch, { recursive: true, force: true })
}

assert.deepEqual(
  await Promise.all(protectedPaths.map(fileDigest)),
  protectedDigestsBefore,
  'research-shadow tests must not mutate production strategy/configuration artifacts',
)

console.log(
  `spatial-demand-revision shadow passed candidate=${SPATIAL_DEMAND_REVISION_SHADOW_CANDIDATE.candidateId} summer=${summerDecision.target.gasPosition} winter=${winterDecision.target.gasPosition}`,
)
