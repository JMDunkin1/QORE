#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  GEFS_V12_REFORECAST_CONTRACT,
  GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
  addUtcDays,
  assertBoundRecord,
  assertReforecastDataset,
  bindRecordDigest,
  buildTheoryFrozenCandidates,
  digestCanonicalJson,
  gefsV12ReforecastObjectUrls,
  issueDatesForReforecast,
  parseGeFsv12TemperatureRanges,
  seasonForTargetDate,
  splitForMarketDate,
} from './lib/qore-gefs-v12-reforecast.mjs'
import {
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT,
  SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
  reviewedSummerNormalMeanF,
} from './lib/qore-summer-forecast-contract.mjs'
import { SUMMER_FORECAST_LOCATIONS } from './lib/qore-summer-location-universe.mjs'

const repoRoot = process.cwd()

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function fixtureRecordForIssue(issueDate) {
  const targetDate = addUtcDays(issueDate, GEFS_V12_REFORECAST_CONTRACT.leadDays)
  const member = 'c00'
  const urls = gefsV12ReforecastObjectUrls(issueDate, member)
  const indexPayloadDigestSha256 = '1'.repeat(64)
  const locations = SUMMER_FORECAST_LOCATIONS.map((location, locationIndex) => {
    const sampleValuesF = GEFS_V12_REFORECAST_CONTRACT.forecastHours.map((_, sampleIndex) =>
      round(60 + locationIndex / 10 + sampleIndex, 3))
    const forecastMeanF = round(sampleValuesF.reduce((sum, value) => sum + value, 0) / sampleValuesF.length, 3)
    const normalMeanF = reviewedSummerNormalMeanF({ locationId: location.id, targetDate })
    const payload = {
      locationId: location.id,
      weight: location.weight,
      sampleValuesF,
      forecastMeanF,
      normalMeanF,
      forecastAnomalyF: round(forecastMeanF - normalMeanF, 3),
      nearestGridLatitude: location.latitude,
      nearestGridLongitude: location.longitude,
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
    season: seasonForTargetDate(targetDate),
    member,
    modelId: `noaa-gefs-v12-fixed-reforecast-${member}`,
    runHourUtc: GEFS_V12_REFORECAST_CONTRACT.issueRunHourUtc,
    leadDays: GEFS_V12_REFORECAST_CONTRACT.leadDays,
    forecastTemporalContractId: GEFS_V12_REFORECAST_CONTRACT.summerTemporalContractId,
    targetOffsetsHours: [...GEFS_V12_REFORECAST_CONTRACT.targetOffsetsHours],
    forecastHours: [...GEFS_V12_REFORECAST_CONTRACT.forecastHours],
    ...urls,
    indexPayloadDigestSha256,
    normalSourceContractId: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT.contractId,
    normalSourceContractDigestSha256: SUMMER_FORECAST_NORMAL_SOURCE_CONTRACT_DIGEST_SHA256,
    grid: { rows: 721, cols: 1440 },
    samples: GEFS_V12_REFORECAST_CONTRACT.forecastHours.map((forecastHour, index) => {
      const offsetHours = GEFS_V12_REFORECAST_CONTRACT.targetOffsetsHours[index]
      const byteStart = 1_000 + index * 1_000
      return {
        offsetHours,
        forecastHour,
        validTimeUtc: `${addUtcDays(targetDate, offsetHours === 24 ? 1 : 0)}T${String(offsetHours % 24).padStart(2, '0')}:00Z`,
        byteStart,
        byteEnd: byteStart + 99,
        byteLength: 100,
        indexLine: `${index + 1}:${byteStart}:d=${issueDate.replaceAll('-', '')}00:TMP:2 m above ground:${forecastHour} hour fcst:ENS=low-res ctl`,
        indexPayloadDigestSha256,
        sourcePayloadDigestSha256: String(index + 2).repeat(64),
      }
    }),
    locations,
  })
}

function localDataset(records, { startDate, endDate, implementationDigests }) {
  const recordsText = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
  const configuration = {
    contractDigestSha256: GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
    startDate,
    endDate,
    members: ['c00'],
    seasons: ['summer'],
    forecastHours: [...GEFS_V12_REFORECAST_CONTRACT.forecastHours],
    locationUniverseContractId: GEFS_V12_REFORECAST_CONTRACT.locationUniverse.contractId,
  }
  return {
    recordsText,
    manifest: {
      schemaVersion: 1,
      datasetId: 'qore-gefs-v12-fixed-model-reforecast-local-v1',
      researchOnly: true,
      productionPromotionEligible: false,
      status: 'complete',
      complete: true,
      contract: GEFS_V12_REFORECAST_CONTRACT,
      contractDigestSha256: GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
      configuration,
      configurationDigestSha256: digestCanonicalJson(configuration),
      implementationDigests,
      planCount: records.length,
      completedCount: records.length,
      output: {
        recordsPath: 'issue-member-records.jsonl',
        recordsBytes: Buffer.byteLength(recordsText),
        recordsDigestSha256: sha256(recordsText),
        rawGribRetained: false,
      },
    },
  }
}

function writeDataset(directory, dataset) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'issue-member-records.jsonl'), dataset.recordsText)
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(dataset.manifest, null, 2)}\n`)
}

assert.match(GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256, /^[a-f0-9]{64}$/)
assert.equal(GEFS_V12_REFORECAST_CONTRACT.locationUniverse.expectedLocationCount, 18)
assert.equal(SUMMER_FORECAST_LOCATIONS.length, 18)
assert.equal(GEFS_V12_REFORECAST_CONTRACT.promotion.productionPromotionEligible, false)
assert.equal(addUtcDays('2019-12-24', 7), '2019-12-31')
assert.equal(seasonForTargetDate('2019-07-08'), 'summer')
assert.equal(seasonForTargetDate('2019-12-31'), 'winter')
assert.equal(seasonForTargetDate('2019-04-15'), null)

const issueDates = issueDatesForReforecast({
  startDate: '2019-04-23',
  endDate: '2019-04-25',
  seasons: ['summer'],
})
assert.deepEqual(issueDates, [
  { issueDate: '2019-04-24', targetDate: '2019-05-01', season: 'summer' },
  { issueDate: '2019-04-25', targetDate: '2019-05-02', season: 'summer' },
])

const urls = gefsV12ReforecastObjectUrls('2019-07-01', 'c00')
assert.equal(
  urls.objectPath,
  'GEFSv12/reforecast/2019/2019070100/c00/Days:1-10/tmp_2m_2019070100_c00.grib2',
)
assert.equal(urls.indexUrl, `${urls.sourceUrl}.idx`)

const indexText = [
  '58:25531319:d=2019070100:TMP:2 m above ground:174 hour fcst:ENS=low-res ctl',
  '59:25966183:d=2019070100:TMP:2 m above ground:177 hour fcst:ENS=low-res ctl',
  '60:26402099:d=2019070100:TMP:2 m above ground:180 hour fcst:ENS=low-res ctl',
  '61:26842868:d=2019070100:TMP:2 m above ground:183 hour fcst:ENS=low-res ctl',
  '62:27280081:d=2019070100:TMP:2 m above ground:186 hour fcst:ENS=low-res ctl',
  '63:27719629:d=2019070100:TMP:2 m above ground:189 hour fcst:ENS=low-res ctl',
  '64:28157404:d=2019070100:TMP:2 m above ground:192 hour fcst:ENS=low-res ctl',
  '65:28592741:d=2019070100:TMP:2 m above ground:195 hour fcst:ENS=low-res ctl',
].join('\n')
const ranges = parseGeFsv12TemperatureRanges(indexText)
assert.deepEqual(ranges.map((range) => range.forecastHour), [174, 180, 186, 192])
assert.deepEqual(ranges.map((range) => range.length), [434864, 440769, 439548, 435337])
assert.throws(
  () => parseGeFsv12TemperatureRanges(indexText.replace('186 hour fcst', '185 hour fcst')),
  /no 2 m temperature field for f186/,
)

const candidates = buildTheoryFrozenCandidates()
assert.equal(candidates.length, 12)
assert.equal(new Set(candidates.map((candidate) => candidate.candidateId)).size, 12)
assert.deepEqual(new Set(candidates.map((candidate) => candidate.positionFraction)), new Set([0.35]))
assert.equal(splitForMarketDate('2014-12-31'), 'train')
assert.equal(splitForMarketDate('2015-01-01'), 'validation')
assert.equal(splitForMarketDate('2017-01-01'), 'holdout')
assert.equal(splitForMarketDate('2020-01-01'), 'outside')

const fixtureRecord = fixtureRecordForIssue('2019-07-01')
assert.equal(assertBoundRecord(fixtureRecord), fixtureRecord)
assert.throws(
  () => assertBoundRecord({ ...fixtureRecord, targetDate: '2019-07-09' }),
  /record digest mismatch/,
)
const forgedAnomaly = structuredClone(fixtureRecord)
forgedAnomaly.locations[0].forecastAnomalyF += 1
const forgedVectorPayload = Object.fromEntries(
  Object.entries(forgedAnomaly.locations[0]).filter(([key]) => key !== 'locationVectorDigestSha256'),
)
forgedAnomaly.locations[0].locationVectorDigestSha256 = digestCanonicalJson(forgedVectorPayload)
assert.throws(
  () => assertBoundRecord(bindRecordDigest(forgedAnomaly)),
  /forecastAnomalyF does not reproduce its inputs/,
)
const forgedProvenance = structuredClone(fixtureRecord)
forgedProvenance.samples[0].sourcePayloadDigestSha256 = 'not-a-digest'
assert.throws(
  () => assertBoundRecord(bindRecordDigest(forgedProvenance)),
  /sourcePayloadDigestSha256 must be a lowercase SHA-256 digest/,
)
const forgedWeight = structuredClone(fixtureRecord)
forgedWeight.locations[0].weight += 1
forgedWeight.locations[0].locationVectorDigestSha256 = digestCanonicalJson(Object.fromEntries(
  Object.entries(forgedWeight.locations[0]).filter(([key]) => key !== 'locationVectorDigestSha256'),
))
assert.throws(() => assertBoundRecord(bindRecordDigest(forgedWeight)), /weight is invalid/)

const implementationDigests = {
  collectorSha256: 'a'.repeat(64),
  contractLibrarySha256: 'b'.repeat(64),
}
const fixtureDataset = localDataset([fixtureRecord], {
  startDate: fixtureRecord.issueDate,
  endDate: fixtureRecord.issueDate,
  implementationDigests,
})
assert.equal(assertReforecastDataset({
  manifest: fixtureDataset.manifest,
  records: [fixtureRecord],
  recordsText: fixtureDataset.recordsText,
}).expectedCount, 1)
assert.throws(
  () => assertReforecastDataset({
    manifest: { ...fixtureDataset.manifest, planCount: 2 },
    records: [fixtureRecord],
    recordsText: fixtureDataset.recordsText,
  }),
  /planCount does not match/,
)
assert.throws(
  () => assertReforecastDataset({
    manifest: fixtureDataset.manifest,
    records: [fixtureRecord],
    recordsText: `${fixtureDataset.recordsText} `,
  }),
  /output size\/digest does not authenticate/,
)

const localResearchRoot = path.join(repoRoot, '.local/qore/research')
fs.mkdirSync(localResearchRoot, { recursive: true })
const integrationRoot = fs.mkdtempSync(path.join(localResearchRoot, 'gefs-v12-test-'))
try {
  const firstShard = path.join(integrationRoot, 'shard-a')
  const secondShard = path.join(integrationRoot, 'shard-b')
  const firstRecord = fixtureRecordForIssue('2019-04-24')
  const secondRecord = fixtureRecordForIssue('2019-04-25')
  writeDataset(firstShard, localDataset([firstRecord], {
    startDate: firstRecord.issueDate,
    endDate: firstRecord.issueDate,
    implementationDigests,
  }))
  writeDataset(secondShard, localDataset([secondRecord], {
    startDate: secondRecord.issueDate,
    endDate: secondRecord.issueDate,
    implementationDigests: { ...implementationDigests, collectorSha256: 'c'.repeat(64) },
  }))
  const mergeEnvironment = {
    ...process.env,
    QORE_GEFS_REFORECAST_SHARDS: `${firstShard},${secondShard}`,
  }
  const mixedMerge = spawnSync(process.execPath, ['scripts/merge-gefs-v12-reforecast-shards.mjs'], {
    cwd: repoRoot,
    env: { ...mergeEnvironment, QORE_GEFS_REFORECAST_OUTPUT_DIR: path.join(integrationRoot, 'mixed-output') },
    encoding: 'utf8',
  })
  assert.notEqual(mixedMerge.status, 0)
  assert.match(`${mixedMerge.stdout}\n${mixedMerge.stderr}`, /acquisition implementation digests differ/)

  writeDataset(secondShard, localDataset([secondRecord], {
    startDate: secondRecord.issueDate,
    endDate: secondRecord.issueDate,
    implementationDigests,
  }))
  const mergedOutput = path.join(integrationRoot, 'merged-output')
  const homogeneousMerge = spawnSync(process.execPath, ['scripts/merge-gefs-v12-reforecast-shards.mjs'], {
    cwd: repoRoot,
    env: { ...mergeEnvironment, QORE_GEFS_REFORECAST_OUTPUT_DIR: mergedOutput },
    encoding: 'utf8',
  })
  assert.equal(homogeneousMerge.status, 0, homogeneousMerge.stderr)
  const mergedRecordsText = fs.readFileSync(path.join(mergedOutput, 'issue-member-records.jsonl'), 'utf8')
  const mergedRecords = mergedRecordsText.trim().split(/\r?\n/).map((line) => JSON.parse(line))
  const mergedManifest = JSON.parse(fs.readFileSync(path.join(mergedOutput, 'manifest.json'), 'utf8'))
  assert.equal(assertReforecastDataset({
    manifest: mergedManifest,
    records: mergedRecords,
    recordsText: mergedRecordsText,
  }).expectedCount, 2)
} finally {
  fs.rmSync(integrationRoot, { recursive: true, force: true })
}

const versionedAudit = JSON.parse(
  fs.readFileSync('data/qore/research/gefs-v12-reforecast-audit.json', 'utf8'),
)
assert.equal(versionedAudit.schemaVersion, 1)
assert.equal(versionedAudit.status, 'validation-rejected-holdout-not-evaluated')
assert.equal(versionedAudit.productionPromotionEligible, false)
assert.equal(versionedAudit.dataset.issueMemberRecords, 3865)
assert.equal(
  versionedAudit.dataset.contractDigestSha256,
  GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
)
assert.ok(candidates.some(({ candidateId }) => candidateId === versionedAudit.selectedCandidate.candidateId))
assert.equal(versionedAudit.familyDiagnostics.allCandidatesNegativeTrain, true)
assert.equal(versionedAudit.validationGate.passed, false)
assert.equal(versionedAudit.validationGate.validationYearPositive['2016'], false)
assert.equal(versionedAudit.selectionLock.hiddenHoldoutStatus, 'not-evaluated')

process.stdout.write('QORE GEFSv12 reforecast tests passed.\n')
