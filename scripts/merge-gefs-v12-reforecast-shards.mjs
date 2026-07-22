#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GEFS_V12_REFORECAST_CONTRACT,
  GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
  assertReforecastDataset,
  digestCanonicalJson,
  issueDatesForReforecast,
} from './lib/qore-gefs-v12-reforecast.mjs'

const repoRoot = process.cwd()
const localResearchRoot = path.join(repoRoot, '.local/qore/research')
const outputDir = path.resolve(
  process.env.QORE_GEFS_REFORECAST_OUTPUT_DIR
    ?? path.join(localResearchRoot, 'gefs-v12-reforecast'),
)
const shardDirs = String(process.env.QORE_GEFS_REFORECAST_SHARDS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value))

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

if (shardDirs.length < 2) {
  throw new Error('QORE_GEFS_REFORECAST_SHARDS must list at least two completed shard directories.')
}
if (!isWithin(localResearchRoot, outputDir)) {
  throw new Error('Merged GEFS reforecast output must remain beneath .local/qore/research/.')
}
if (fs.existsSync(outputDir)) {
  throw new Error(`Merged output already exists: ${outputDir}`)
}
if (new Set(shardDirs).size !== shardDirs.length) {
  throw new Error('QORE_GEFS_REFORECAST_SHARDS must not contain duplicate directories.')
}

const shardBundles = shardDirs.map((shardDir) => {
  const manifestPath = path.join(shardDir, 'manifest.json')
  const recordsPath = path.join(shardDir, 'issue-member-records.jsonl')
  const manifestBytes = fs.readFileSync(manifestPath)
  const recordBytes = fs.readFileSync(recordsPath)
  const manifest = JSON.parse(manifestBytes)
  const records = recordBytes.toString('utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Invalid record ${index + 1} in ${shardDir}: ${error.message}`)
    }
  })
  let validation
  try {
    validation = assertReforecastDataset({
      manifest,
      records,
      recordsText: recordBytes,
      requireComplete: true,
      allowedDatasetIds: ['qore-gefs-v12-fixed-model-reforecast-local-v1'],
    })
  } catch (error) {
    throw new Error(`Invalid completed shard ${shardDir}: ${error.message}`)
  }
  return {
    shardDir,
    manifest,
    records,
    acquisitionImplementationDigests: validation.acquisitionImplementationDigests,
    manifestDigestSha256: sha256(manifestBytes),
    recordsDigestSha256: sha256(recordBytes),
  }
})

const reference = shardBundles[0].manifest.configuration
const referenceImplementationDigests = digestCanonicalJson(
  shardBundles[0].acquisitionImplementationDigests,
)
for (const { shardDir, manifest, acquisitionImplementationDigests } of shardBundles) {
  const configuration = manifest.configuration
  for (const field of ['contractDigestSha256', 'members', 'seasons', 'forecastHours', 'locationUniverseContractId']) {
    if (JSON.stringify(configuration?.[field]) !== JSON.stringify(reference?.[field])) {
      throw new Error(`Shard configuration ${field} differs: ${shardDir}`)
    }
  }
  if (digestCanonicalJson(acquisitionImplementationDigests) !== referenceImplementationDigests) {
    throw new Error(`Shard acquisition implementation digests differ: ${shardDir}`)
  }
}

const startDate = shardBundles
  .map(({ manifest }) => manifest.configuration.startDate)
  .sort()[0]
const endDate = shardBundles
  .map(({ manifest }) => manifest.configuration.endDate)
  .sort()
  .at(-1)
const members = [...reference.members]
const seasons = [...reference.seasons]
const expectedKeys = new Set(
  issueDatesForReforecast({ startDate, endDate, seasons })
    .flatMap(({ issueDate }) => members.map((member) => `${issueDate}|${member}`)),
)
const recordsByKey = new Map()
for (const { shardDir, manifest, records } of shardBundles) {
  for (const record of records) {
    const key = `${record.issueDate}|${record.member}`
    if (record.issueDate < manifest.configuration.startDate || record.issueDate > manifest.configuration.endDate) {
      throw new Error(`Shard record ${key} is outside its configured date range: ${shardDir}`)
    }
    if (!expectedKeys.has(key)) throw new Error(`Unexpected merged record key: ${key}`)
    if (recordsByKey.has(key)) throw new Error(`Duplicate merged record key: ${key}`)
    recordsByKey.set(key, record)
  }
}
const missing = [...expectedKeys].filter((key) => !recordsByKey.has(key))
if (missing.length) {
  throw new Error(`Merged shards omit ${missing.length} expected issue/member records; first missing ${missing[0]}.`)
}

const records = [...recordsByKey.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, record]) => record)
const recordsText = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
const configuration = {
  contractDigestSha256: GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
  startDate,
  endDate,
  members,
  seasons,
  forecastHours: [...reference.forecastHours],
  locationUniverseContractId: reference.locationUniverseContractId,
}
const mergeImplementationPath = fileURLToPath(import.meta.url)
const manifest = {
  schemaVersion: 1,
  datasetId: 'qore-gefs-v12-fixed-model-reforecast-merged-local-v1',
  researchOnly: true,
  productionPromotionEligible: false,
  status: 'complete',
  complete: true,
  completedAt: new Date().toISOString(),
  contract: GEFS_V12_REFORECAST_CONTRACT,
  contractDigestSha256: GEFS_V12_REFORECAST_CONTRACT_DIGEST_SHA256,
  configuration,
  configurationDigestSha256: digestCanonicalJson(configuration),
  planCount: expectedKeys.size,
  completedCount: records.length,
  output: {
    recordsPath: path.relative(repoRoot, path.join(outputDir, 'issue-member-records.jsonl')),
    recordsBytes: Buffer.byteLength(recordsText),
    recordsDigestSha256: sha256(recordsText),
    rawGribRetained: false,
    acquisition: 'validated merge of completed, bounded-range issue/member shards',
  },
  mergeProvenance: {
    implementationDigestSha256: sha256(fs.readFileSync(mergeImplementationPath)),
    shardCount: shardBundles.length,
    shards: shardBundles.map(({ shardDir, manifest, manifestDigestSha256, recordsDigestSha256 }) => ({
      path: path.relative(repoRoot, shardDir),
      startDate: manifest.configuration.startDate,
      endDate: manifest.configuration.endDate,
      recordCount: manifest.completedCount,
      manifestDigestSha256,
      recordsDigestSha256,
      acquisitionImplementationDigests: manifest.implementationDigests,
    })),
  },
  limitations: [
    GEFS_V12_REFORECAST_CONTRACT.archive.historicalAvailabilityCaveat,
    'The c00 dataset is a control-member screen; five-member confirmation remains separate.',
    'This local dataset is not a production strategy artifact and cannot enable paper or live trading.',
  ],
}

assertReforecastDataset({
  manifest,
  records,
  recordsText,
  requireComplete: true,
  allowedDatasetIds: ['qore-gefs-v12-fixed-model-reforecast-merged-local-v1'],
})

fs.mkdirSync(outputDir, { recursive: true })
fs.writeFileSync(path.join(outputDir, 'issue-member-records.jsonl'), recordsText)
fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Merged ${records.length} authenticated records from ${shardBundles.length} shards into ${outputDir}.\n`)
