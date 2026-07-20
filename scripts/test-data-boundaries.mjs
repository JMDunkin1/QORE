#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoDir = process.cwd()
const scratch = await mkdtemp(path.join(tmpdir(), 'qore-data-boundaries-'))
const eiaSecret = 'synthetic+EIA/key=very secret'

function runNode(args, env = {}) {
  const childEnv = { ...process.env, ...env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) delete childEnv[key]
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoDir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function filesBelow(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(entryPath)
      else if (entry.isFile()) files.push(entryPath)
    }
  }
  await visit(root)
  return files
}

function secretVariants(secret) {
  const variants = new Set([secret])
  let frontier = new Set([secret])
  for (let depth = 0; depth < 4; depth += 1) {
    const next = new Set()
    for (const value of frontier) {
      next.add(encodeURIComponent(value))
      next.add(new URLSearchParams([['value', value]]).toString().slice('value='.length))
    }
    frontier = new Set([...next].filter((value) => !variants.has(value)))
    for (const value of frontier) variants.add(value)
  }
  return [...variants].flatMap((variant) => [
    variant,
    variant.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
    variant.replace(/[A-F]/g, (char) => char.toLowerCase()),
  ])
}

function assertNoSecret(text, label) {
  const rendered = String(text)
  for (const variant of secretVariants(eiaSecret)) {
    assert.equal(rendered.includes(variant), false, `${label} exposed an EIA credential variant`)
  }
  for (const fragment of [eiaSecret.slice(0, 15), encodeURIComponent(eiaSecret).slice(0, 15)]) {
    assert.equal(rendered.includes(fragment), false, `${label} exposed a truncated EIA credential fragment`)
  }
}

async function assertFilesContainNoSecret(root) {
  for (const filePath of await filesBelow(root)) {
    assertNoSecret(await readFile(filePath, 'utf8'), filePath)
  }
}

const fetchPreloadPath = path.join(scratch, 'mock-eia-fetch.mjs')
await writeFile(fetchPreloadPath, `
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.hostname !== 'api.eia.gov') throw new Error('Unexpected test fetch host')
  const secret = process.env.QORE_TEST_EIA_ECHO_KEY
  const encoded = encodeURIComponent(secret)
  const doubleEncoded = encodeURIComponent(encoded)
  const mixedDoubleEncoded = doubleEncoded.replaceAll('2B', '2b').replaceAll('2F', '2f').replaceAll('3D', '3d')
  const formEncoded = new URLSearchParams([['value', secret]]).toString().slice('value='.length)
  const doubleFormEncoded = new URLSearchParams([['value', formEncoded]]).toString().slice('value='.length)
  const mode = process.env.QORE_TEST_EIA_MODE
  const request = {
    params: {
      api_key: secret,
      'API-Key': secret,
      eiaApiKey: secret,
      safeParam: 'weekly',
    },
    requestUrl: \`https://api.eia.gov/example?api_key=\${encodeURIComponent(secret)}\`,
    echoedValue: secret,
    doubleEncoded,
    mixedDoubleEncoded,
    doubleFormEncoded,
    [secret]: 'secret appeared in a property name',
    [mixedDoubleEncoded]: 'encoded secret appeared in a property name',
  }
  if (mode === 'boundary-raw' || mode === 'boundary-encoded') {
    const boundarySecret = mode === 'boundary-raw' ? secret : encoded
    return new Response(\`\${'x'.repeat(165)}\${boundarySecret} trailing error detail\`, {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    })
  }
  if (mode === 'error') {
    return new Response(JSON.stringify({ error: 'synthetic EIA failure', reason: \`rejected \${secret}\`, request }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({
    request,
    response: {
      data: [{
        period: \`2026-07-10-\${doubleEncoded}\`,
        series: \`NW2_\${mixedDoubleEncoded}\`,
        value: 3142,
        'unit-name': \`Bcf \${doubleFormEncoded}\`,
        'area-name': \`Lower 48 \${secret}\`,
        [doubleEncoded]: secret,
      }],
      safeMetadata: 'preserved',
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
`, 'utf8')

const preloadOption = `--import=${pathToFileURL(fetchPreloadPath).href}`
const collectorBaseEnv = {
  NODE_ENV: 'test',
  NODE_OPTIONS: preloadOption,
  EIA_API_KEY: eiaSecret,
  QORE_TEST_EIA_ECHO_KEY: eiaSecret,
  QORE_SKIP_YAHOO: '1',
  QORE_SKIP_NASA_POWER: '1',
  QORE_SKIP_OPEN_METEO: '1',
}

async function testEiaSuccessPersistence() {
  const dataRoot = path.join(scratch, 'collector-success')
  const result = await runNode(['scripts/collect-free-data.mjs'], {
    ...collectorBaseEnv,
    QORE_DATA_ROOT: dataRoot,
  })
  assert.equal(result.code, 0, result.stderr)
  const rawPath = path.join(dataRoot, 'fundamentals', 'eia', 'working-gas-storage-lower48-weekly.raw.json')
  const raw = JSON.parse(await readFile(rawPath, 'utf8'))
  assert.equal(raw.request.params.safeParam, 'weekly')
  assert.equal(raw.response.safeMetadata, 'preserved')
  assert.equal(raw.response.data[0].value, 3142)
  assert.equal(Object.keys(raw.request.params).some((key) => /api.?key/i.test(key)), false)
  assert.equal(raw.request.echoedValue, 'REDACTED')
  assert.match(raw.request.requestUrl, /api_key=REDACTED/)
  assert.match(raw.response.data[0].period, /REDACTED/)
  assert.match(raw.response.data[0].series, /REDACTED/)
  assert.match(raw.response.data[0]['unit-name'], /REDACTED/)
  assert.match(raw.response.data[0]['area-name'], /REDACTED/)
  assertNoSecret(result.stdout, 'collector success stdout')
  assertNoSecret(result.stderr, 'collector success stderr')
  await assertFilesContainNoSecret(dataRoot)
  console.log('ok - EIA raw response persistence removes echoed credentials and preserves data')
}

async function testEiaFailureTelemetry() {
  const dataRoot = path.join(scratch, 'collector-error')
  const result = await runNode(['scripts/collect-free-data.mjs'], {
    ...collectorBaseEnv,
    QORE_DATA_ROOT: dataRoot,
    QORE_TEST_EIA_MODE: 'error',
  })
  assert.equal(result.code, 0, result.stderr)
  const manifest = JSON.parse(await readFile(path.join(dataRoot, 'runs', 'free-data-manifest.json'), 'utf8'))
  const eiaFailure = manifest.fundamentals.eiaStorage.find((item) => item.status === 'failed')
  assert.match(eiaFailure?.error ?? '', /REDACTED/)
  assert.match(eiaFailure?.url ?? '', /api_key=REDACTED/)
  assertNoSecret(result.stdout, 'collector failure stdout')
  assertNoSecret(result.stderr, 'collector failure stderr')
  await assertFilesContainNoSecret(dataRoot)
  console.log('ok - EIA collector failure telemetry redacts the active credential')
}

async function testEiaBoundaryFailureTelemetry() {
  for (const mode of ['boundary-raw', 'boundary-encoded']) {
    const dataRoot = path.join(scratch, `collector-${mode}`)
    const result = await runNode(['scripts/collect-free-data.mjs'], {
      ...collectorBaseEnv,
      QORE_DATA_ROOT: dataRoot,
      QORE_TEST_EIA_MODE: mode,
    })
    assert.equal(result.code, 0, result.stderr)
    const manifestText = await readFile(path.join(dataRoot, 'runs', 'free-data-manifest.json'), 'utf8')
    const manifest = JSON.parse(manifestText)
    const eiaFailure = manifest.fundamentals.eiaStorage.find((item) => item.status === 'failed')
    assert.match(eiaFailure?.error ?? '', /REDACTED/)
    assertNoSecret(result.stdout, `collector ${mode} stdout`)
    assertNoSecret(result.stderr, `collector ${mode} stderr`)
    assertNoSecret(manifestText, `collector ${mode} manifest`)
    await assertFilesContainNoSecret(dataRoot)
  }
  console.log('ok - EIA collector redacts complete raw and encoded error bodies before truncation')
}

const disabledLiveJobs = {
  QORE_LIVE_MARKET_REFERENCE_PRICES_ENABLED: '0',
  QORE_LIVE_BROKER_ACCOUNT_AND_POSITIONS_ENABLED: '0',
  QORE_LIVE_STRATEGY_INFERENCE_ENABLED: '0',
  QORE_LIVE_RISK_AND_KILL_SWITCH_STATE_ENABLED: '0',
  QORE_LIVE_SIGNAL_INTENT_RECONCILE_ENABLED: '0',
}

async function testLiveEiaSuccessTelemetry() {
  const stateDir = path.join(scratch, 'live-eia-success')
  const result = await runNode([
    'scripts/qore-live-weather-service.mjs',
    '--once',
    '--no-current-forecast',
    '--no-performance-test',
    '--no-forecast-calendar',
  ], {
    ...collectorBaseEnv,
    ...disabledLiveJobs,
    QORE_LIVE_WEATHER_STATE_DIR: stateDir,
    QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '1',
  })
  assert.equal(result.code, 0, result.stderr)
  const snapshot = JSON.parse(await readFile(path.join(stateDir, 'eia-storage-release-window.json'), 'utf8'))
  assert.match(snapshot.storageRows[0].date, /REDACTED/)
  assert.match(snapshot.storageRows[0].series, /REDACTED/)
  assert.match(snapshot.storageRows[0].unit, /REDACTED/)
  assert.match(snapshot.storageRows[0].areaName, /REDACTED/)
  assertNoSecret(result.stdout, 'live weather success stdout')
  assertNoSecret(result.stderr, 'live weather success stderr')
  await assertFilesContainNoSecret(stateDir)
  console.log('ok - live EIA rows are sanitized before telemetry derivation')
}

async function testLiveEiaFailureTelemetry() {
  const stateDir = path.join(scratch, 'live-eia-error')
  const result = await runNode([
    'scripts/qore-live-weather-service.mjs',
    '--once',
    '--no-current-forecast',
    '--no-performance-test',
    '--no-forecast-calendar',
  ], {
    ...collectorBaseEnv,
    ...disabledLiveJobs,
    QORE_LIVE_WEATHER_STATE_DIR: stateDir,
    QORE_TEST_EIA_MODE: 'error',
    QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '1',
  })
  assert.equal(result.code, 0, result.stderr)
  const snapshot = JSON.parse(await readFile(path.join(stateDir, 'eia-storage-release-window.json'), 'utf8'))
  assert.match(snapshot.liveError ?? '', /REDACTED/)
  assertNoSecret(result.stdout, 'live weather stdout')
  assertNoSecret(result.stderr, 'live weather stderr')
  await assertFilesContainNoSecret(stateDir)
  console.log('ok - live EIA failure snapshot redacts the active credential')
}

async function testLiveEiaBoundaryFailureTelemetry() {
  for (const mode of ['boundary-raw', 'boundary-encoded']) {
    const stateDir = path.join(scratch, `live-eia-${mode}`)
    const result = await runNode([
      'scripts/qore-live-weather-service.mjs',
      '--once',
      '--no-current-forecast',
      '--no-performance-test',
      '--no-forecast-calendar',
    ], {
      ...collectorBaseEnv,
      ...disabledLiveJobs,
      QORE_LIVE_WEATHER_STATE_DIR: stateDir,
      QORE_TEST_EIA_MODE: mode,
      QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '1',
    })
    assert.equal(result.code, 0, result.stderr)
    const snapshotText = await readFile(path.join(stateDir, 'eia-storage-release-window.json'), 'utf8')
    const snapshot = JSON.parse(snapshotText)
    assert.match(snapshot.liveError ?? '', /REDACTED/)
    assertNoSecret(result.stdout, `live weather ${mode} stdout`)
    assertNoSecret(result.stderr, `live weather ${mode} stderr`)
    assertNoSecret(snapshotText, `live weather ${mode} snapshot`)
    await assertFilesContainNoSecret(stateDir)
  }
  console.log('ok - live EIA fetch redacts complete raw and encoded error bodies before truncation')
}

async function testForecastCalendarStateBoundary() {
  const caseDir = path.join(scratch, 'live-forecast-calendar')
  const stateDir = path.join(caseDir, 'state')
  const sentinelPath = path.join(caseDir, 'parent-sentinel.txt')
  await mkdir(caseDir, { recursive: true })
  await writeFile(sentinelPath, 'unchanged\n', 'utf8')
  const result = await runNode([
    'scripts/qore-live-weather-service.mjs',
    '--once',
    '--forecast-calendar',
    '--no-current-forecast',
    '--no-performance-test',
  ], {
    NODE_ENV: 'test',
    NODE_OPTIONS: undefined,
    ...disabledLiveJobs,
    QORE_LIVE_WEATHER_STATE_DIR: stateDir,
    QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '0',
    QORE_LIVE_WEATHER_GFS_SOURCES: 'gfs',
    QORE_LIVE_WEATHER_GFS_RUN_HOURS: '00',
    QORE_LIVE_WEATHER_GFS_START: '2026-01-01',
    QORE_LIVE_WEATHER_GFS_END: '2026-01-01',
    QORE_GFS_LEAD_DAYS: '1',
    QORE_GFS_OUTPUT_BASENAME: '../../../../escaped-live-calendar',
  })
  assert.equal(result.code, 0, result.stderr)
  const outputRoot = path.join(stateDir, 'forecast-calendar')
  const outputFiles = await filesBelow(outputRoot)
  assert.ok(outputFiles.some((filePath) => filePath.endsWith('-manifest.json')), 'forecast child did not write its manifest')
  assert.ok(outputFiles.every((filePath) => filePath.startsWith(`${outputRoot}${path.sep}`)))

  const status = JSON.parse(await readFile(path.join(stateDir, 'status.json'), 'utf8'))
  assert.equal(status.liveJobs.forecastCalendar.ok, true)
  assert.equal(path.resolve(repoDir, status.runConfiguration.forecastCalendarOutputRoot), outputRoot)
  assert.equal(await readFile(sentinelPath, 'utf8'), 'unchanged\n')
  const filesOutsideState = (await filesBelow(caseDir)).filter((filePath) => !filePath.startsWith(`${stateDir}${path.sep}`))
  assert.deepEqual(filesOutsideState, [sentinelPath])
  console.log('ok - live forecast-calendar child writes only beneath the configured state directory')
}

async function testBuilderRejectsPathShapingInputs() {
  const variants = [
    { label: 'basename', env: { QORE_GFS_OUTPUT_BASENAME: '../../../../escaped-calendar' }, error: /single safe filename component/ },
    { label: 'date', env: { QORE_GFS_CALENDAR_START: '../../2026-01-01' }, error: /valid YYYY-MM-DD date/ },
    { label: 'hour', env: { QORE_GFS_RUN_HOUR: '../../00' }, error: /two-digit UTC hour/ },
    { label: 'source', env: { QORE_FORECAST_SOURCE: '../../gfs' }, error: /Unsupported QORE_FORECAST_SOURCE/ },
    { label: 'prototype-source', env: { QORE_FORECAST_SOURCE: '__proto__' }, error: /Unsupported QORE_FORECAST_SOURCE/ },
  ]

  for (const variant of variants) {
    const caseDir = path.join(scratch, `hostile-builder-${variant.label}`)
    const outputRoot = path.join(caseDir, 'output')
    const sentinelPath = path.join(caseDir, 'parent-sentinel.txt')
    await mkdir(caseDir, { recursive: true })
    await writeFile(sentinelPath, 'unchanged\n', 'utf8')
    const result = await runNode(['scripts/build-gfs-forecast-calendar.mjs'], {
      NODE_ENV: 'test',
      NODE_OPTIONS: undefined,
      QORE_GFS_OUTPUT_ROOT: outputRoot,
      QORE_GFS_CALENDAR_START: '2026-01-01',
      QORE_GFS_CALENDAR_END: '2026-01-01',
      QORE_GFS_LEAD_DAYS: '1',
      ...variant.env,
    })
    assert.equal(result.code, 1, `${variant.label} path shaping must fail closed`)
    assert.match(result.stderr, variant.error)
    assert.equal(await readFile(sentinelPath, 'utf8'), 'unchanged\n')
    assert.deepEqual(await filesBelow(caseDir), [sentinelPath])
  }
  console.log('ok - forecast-calendar builder rejects path-shaped basename, dates, hours, and sources before creating files')
}

async function testLiveForecastCalendarRejectsPathShapingInputs() {
  const variants = [
    { label: 'date', env: { QORE_LIVE_WEATHER_GFS_START: '../../2026-01-01' }, error: /valid YYYY-MM-DD date/ },
    { label: 'hour', env: { QORE_LIVE_WEATHER_GFS_RUN_HOURS: '../../06' }, error: /two-digit UTC hours/ },
    { label: 'source', env: { QORE_LIVE_WEATHER_GFS_SOURCES: '../../gfs' }, error: /Unsupported live forecast calendar source/ },
  ]

  for (const variant of variants) {
    const caseDir = path.join(scratch, `hostile-live-${variant.label}`)
    const stateDir = path.join(caseDir, 'state')
    const sentinelPath = path.join(caseDir, 'parent-sentinel.txt')
    await mkdir(caseDir, { recursive: true })
    await writeFile(sentinelPath, 'unchanged\n', 'utf8')
    const result = await runNode([
      'scripts/qore-live-weather-service.mjs',
      '--once',
      '--forecast-calendar',
      '--no-current-forecast',
      '--no-performance-test',
    ], {
      NODE_ENV: 'test',
      NODE_OPTIONS: undefined,
      ...disabledLiveJobs,
      QORE_LIVE_WEATHER_STATE_DIR: stateDir,
      QORE_LIVE_EIA_STORAGE_RELEASE_WINDOW_ENABLED: '0',
      QORE_LIVE_WEATHER_GFS_START: '2026-01-01',
      QORE_LIVE_WEATHER_GFS_END: '2026-01-01',
      QORE_LIVE_WEATHER_GFS_RUN_HOURS: '00',
      QORE_LIVE_WEATHER_GFS_SOURCES: 'gfs',
      ...variant.env,
    })
    assert.equal(result.code, 1, `${variant.label} path shaping must fail closed`)
    const status = JSON.parse(await readFile(path.join(stateDir, 'status.json'), 'utf8'))
    assert.match(status.liveJobs.forecastCalendar.error ?? '', variant.error)
    assert.equal(await readFile(sentinelPath, 'utf8'), 'unchanged\n')
    const filesOutsideState = (await filesBelow(caseDir)).filter((filePath) => !filePath.startsWith(`${stateDir}${path.sep}`))
    assert.deepEqual(filesOutsideState, [sentinelPath])
  }
  console.log('ok - live forecast calendar rejects path-shaped dates, hours, and sources before spawning')
}

try {
  await testEiaSuccessPersistence()
  await testEiaFailureTelemetry()
  await testEiaBoundaryFailureTelemetry()
  await testLiveEiaSuccessTelemetry()
  await testLiveEiaFailureTelemetry()
  await testLiveEiaBoundaryFailureTelemetry()
  await testForecastCalendarStateBoundary()
  await testBuilderRejectsPathShapingInputs()
  await testLiveForecastCalendarRejectsPathShapingInputs()
} finally {
  await rm(scratch, { recursive: true, force: true })
}
