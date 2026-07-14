#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadLocalEnv } from './local-env.mjs'
import { enrichForecastRows, inferAllYearTarget, numberFrom, round, selectedContracts } from './lib/qore-live-all-year-inference.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)
const dataRoot = path.join(repoDir, 'data', 'qore')
const stateDir = path.resolve(process.env.QORE_LIVE_INFERENCE_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'live-inference'))
const forecastRoot = path.join(stateDir, 'noaa-calendar')
const outputPath = path.resolve(process.env.QORE_LIVE_INFERENCE_FILE ?? path.join(stateDir, 'all-year-target.json'))
const today = process.env.QORE_LIVE_INFERENCE_DATE ?? new Date().toISOString().slice(0, 10)
const lookbackDays = Math.max(10, Number(process.env.QORE_LIVE_INFERENCE_LOOKBACK_DAYS ?? 16))
const fetchTimeoutMs = Number(process.env.QORE_LIVE_INFERENCE_FETCH_TIMEOUT_MS ?? 45_000)

function addDays(date, count) { return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10) }
function parseCsvLine(line) {
  const values = []; let value = ''; let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]; const next = line[index + 1]
    if (char === '"' && quoted && next === '"') { value += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { values.push(value); value = '' }
    else value += char
  }
  values.push(value); return values
}
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}
async function readCsv(filePath) { return existsSync(filePath) ? parseCsv(await readFile(filePath, 'utf8')) : [] }
async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n')
  await rename(temporary, filePath)
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoDir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-12000) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve({ code, stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${(stderr || stdout).trim()}`)))
  })
}
function sourcePaths(sourceId) {
  const weatherDir = sourceId === 'gfs' ? 'noaa-gfs' : 'noaa-gefs'
  const base = `qore-live-${sourceId}-00z`
  return {
    base,
    score: path.join(forecastRoot, 'research', `${base}-signal-scores.csv`),
    locations: path.join(forecastRoot, 'weather', weatherDir, `${base}-location-anomalies.csv`),
    manifest: path.join(forecastRoot, 'weather', weatherDir, `${base}-manifest.json`),
  }
}
async function collectNoaa(sourceId) {
  const paths = sourcePaths(sourceId)
  const month = Number(today.slice(5, 7))
  const leadDays = month >= 5 && month <= 9 ? '7' : '1,2,3,7,8,9,10'
  const result = await run(process.execPath, ['scripts/build-gfs-forecast-calendar.mjs'], {
    QORE_FORECAST_SOURCE: sourceId,
    QORE_GFS_RUN_HOUR: '00',
    QORE_GFS_CALENDAR_START: addDays(today, -lookbackDays),
    QORE_GFS_CALENDAR_ISSUE_END: today,
    QORE_GFS_CALENDAR_END: addDays(today, 10),
    QORE_GFS_LEAD_DAYS: leadDays,
    QORE_GFS_HEATING_SEASON_ONLY: '0',
    QORE_GFS_COOLING_SEASON_ONLY: '0',
    QORE_GFS_RESUME: '1',
    QORE_GFS_ALLOW_PARTIAL: '1',
    QORE_GFS_CONCURRENCY: process.env.QORE_LIVE_INFERENCE_FETCH_CONCURRENCY ?? '4',
    QORE_FETCH_TIMEOUT_MS: String(fetchTimeoutMs),
    QORE_GFS_OUTPUT_ROOT: forecastRoot,
    QORE_GFS_OUTPUT_BASENAME: paths.base,
  })
  return { sourceId, paths, result }
}
async function loadForecastRows() {
  const scores = []; const locations = []; const manifests = []
  for (const sourceId of ['gfs', 'gefs-mean']) {
    const paths = sourcePaths(sourceId)
    for (const row of await readCsv(paths.score)) scores.push({ ...row, sourceId })
    for (const row of await readCsv(paths.locations)) locations.push({ ...row, sourceId })
    if (existsSync(paths.manifest)) manifests.push(JSON.parse(await readFile(paths.manifest, 'utf8')))
  }
  const month = Number(today.slice(5, 7)); const season = month >= 5 && month <= 9 ? 'summer' : 'winter'
  return { rows: enrichForecastRows(scores, locations, season), manifests }
}
async function marketDays() {
  const month = Number(today.slice(5, 7)); const fileName = month >= 5 && month <= 9 ? 'NG-F-qore-market.csv' : 'UNG-qore-market.csv'
  const gasRows = await readCsv(path.join(dataRoot, 'market', 'yahoo', fileName))
  const indexRows = await readCsv(path.join(dataRoot, 'market', 'yahoo', 'US-INDEX-BASKET-qore-market.csv'))
  const indexDates = new Set(indexRows.map((row) => row.date))
  const rows = gasRows.filter((row) => indexDates.has(row.date) && numberFrom(row.close) > 0).map((row) => ({ date: row.date, gasClose: numberFrom(row.close) }))
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  if (weekday > 0 && weekday < 6 && rows.at(-1)?.date < today) rows.push({ date: today, gasClose: rows.at(-1).gasClose, provisional: true })
  return rows
}
function latestCommonIssue(rows, requiredLeads) {
  const byIssue = new Map()
  for (const row of rows) {
    const key = row.issueDate
    const entry = byIssue.get(key) ?? new Map()
    entry.set(`${row.sourceId}|${row.leadDays}`, true); byIssue.set(key, entry)
  }
  return [...byIssue.entries()].filter(([, keys]) => ['gfs', 'gefs-mean'].every((source) => requiredLeads.every((lead) => keys.has(`${source}|${lead}`))))
    .map(([date]) => date).sort().at(-1) ?? null
}

async function main() {
  await mkdir(forecastRoot, { recursive: true })
  const collections = []
  if (!['1', 'true', 'yes'].includes(String(process.env.QORE_LIVE_INFERENCE_SKIP_FETCH ?? '').toLowerCase())) {
    for (const sourceId of ['gfs', 'gefs-mean']) collections.push(await collectNoaa(sourceId))
  }
  const { rows, manifests } = await loadForecastRows()
  const month = Number(today.slice(5, 7)); const summer = month >= 5 && month <= 9
  const relevantRows = rows.filter((row) => summer ? row.leadDays === 7 : [1, 2, 3, 7, 8, 9, 10].includes(row.leadDays))
  const latestIssueDate = latestCommonIssue(relevantRows, summer ? [7] : [1, 2, 3, 7, 8, 9, 10])
  const issueAgeDays = latestIssueDate ? (Date.parse(today) - Date.parse(latestIssueDate)) / 86400000 : null
  if (!latestIssueDate || issueAgeDays > 2) throw new Error(`Validated GFS/GEFS 00z set is stale or incomplete (latest common issue: ${latestIssueDate ?? 'none'}).`)
  const days = await marketDays()
  const storageRows = await readCsv(path.join(dataRoot, 'fundamentals', 'eia', 'working-gas-storage-lower48-weekly.csv'))
  const target = inferAllYearTarget({ forecastRows: rows, marketDays: days, storageRows, targetDate: today })
  const snapshot = {
    generatedAt: new Date().toISOString(), serviceId: 'qore-live-all-year-inference', validated: true,
    inferenceMode: 'selected-contract-live-noaa-gfs-gefs-00z', liveForecastAppliedToTarget: true,
    strategyId: 'ngas-all-year-beta', season: summer ? 'summer' : 'winter', target,
    forecastValidation: {
      latestCommonIssueDate: latestIssueDate, issueAgeDays: round(issueAgeDays, 2), runHourUtc: '00',
      requiredSources: ['gfs', 'gefs-mean'], requiredLeads: summer ? [7] : [1, 2, 3, 7, 8, 9, 10],
      scoreRowCount: relevantRows.length,
    },
    selectedContracts: summer ? { summer: selectedContracts.summer } : { winterFollow: selectedContracts.winterFollow, winterFade: selectedContracts.winterFade },
    files: { snapshot: path.relative(repoDir, outputPath), forecastState: path.relative(repoDir, forecastRoot) },
    collection: { attempted: collections.length > 0, manifests: manifests.map((manifest) => ({ source: manifest.forecastSource, generatedAt: manifest.generatedAt, failures: manifest.failures?.length ?? 0 })) },
  }
  await writeJsonAtomic(outputPath, snapshot)
  console.log(`live-inference validated=true season=${snapshot.season} issue=${latestIssueDate} target=${today} gas=${target.gasPosition} file=${path.relative(repoDir, outputPath)}`)
}

main().catch(async (error) => {
  await writeJsonAtomic(outputPath, { generatedAt: new Date().toISOString(), serviceId: 'qore-live-all-year-inference', validated: false, liveForecastAppliedToTarget: false, error: error.message })
  console.error(error)
  process.exit(1)
})
