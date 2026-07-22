#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { buildPortfolioReport, renderPortfolioReportSvg } from './lib/qore-portfolio-report.mjs'
import { deliverPortfolioReport } from './lib/qore-report-delivery.mjs'
import { validateIndexBasketConfig } from './lib/qore-index-basket.mjs'
import {
  sentDestinationIds,
  uncertainDestinationIds,
  updateDeliveryLedger,
} from './lib/qore-report-ledger.mjs'

process.env.NODE_ENV = 'test'

const repoDir = process.cwd()
const reportScript = path.join(repoDir, 'scripts', 'qore-portfolio-report.mjs')
const scratch = await mkdtemp(path.join(tmpdir(), 'qore-portfolio-report-'))
const localOutputTestRoot = path.join(
  repoDir,
  '.local',
  'qore',
  'portfolio-reports',
  `test-${process.pid}-${path.basename(scratch)}`,
)
const basket = {
  symbol: 'US-INDEX-BASKET',
  components: [
    { symbol: 'VOO', label: 'Vanguard S&P 500 ETF', targetWeight: 0.8 },
    { symbol: 'QQQM', label: 'Invesco NASDAQ 100 ETF', targetWeight: 0.2 },
  ],
}

function benchmarkRow(symbol, values) {
  return {
    symbol,
    points: values.map(([date, closeUsd]) => ({ timestamp: `${date}T20:00:00.000Z`, closeUsd })),
  }
}

function dailyFixture(overrides = {}) {
  const generatedAt = '2026-07-21T21:55:00.000Z'
  return {
    generatedAt,
    sourceGeneratedAt: generatedAt,
    serviceId: 'qore-alpaca-broker-status',
    brokerConnected: true,
    mode: 'paper',
    account: {
      equityUsd: 101_000,
      lastEquityUsd: 100_000,
      cashUsd: 20_000,
      dayPnlUsd: 1_000,
      dayPnlPct: 1,
    },
    positions: [
      { symbol: 'UNG', side: 'long', market_value: '11000' },
      { symbol: 'VOO', side: 'long', market_value: '55000' },
      { symbol: 'QQQM', side: 'long', market_value: '15000' },
      { symbol: 'SECRET', side: 'long', market_value: '999999' },
    ],
    portfolioHistory: {
      generatedAt,
      timeframe: '1D',
      points: [
        { timestamp: '2026-07-17T20:00:00.000Z', equityUsd: 100_000, profitLossUsd: 0, profitLossPct: 0 },
        { timestamp: '2026-07-20T20:00:00.000Z', equityUsd: 101_000, profitLossUsd: 1_000, profitLossPct: 1 },
      ],
    },
    benchmarkHistory: {
      generatedAt,
      source: 'Alpaca historical stock bars',
      feed: 'iex',
      adjustment: 'all',
      timeframe: '1Day',
      rows: [
        benchmarkRow('VOO', [['2026-07-17', 100], ['2026-07-20', 102]]),
        benchmarkRow('QQQM', [['2026-07-17', 100], ['2026-07-20', 99]]),
      ],
    },
    marketCalendar: {
      generatedAt,
      source: 'Alpaca US market calendar',
      rows: [
        { date: '2026-07-17', open: '09:30', close: '16:00' },
        { date: '2026-07-20', open: '09:30', close: '16:00' },
      ],
    },
    ...overrides,
  }
}

function signalFixture(generatedAt = '2026-07-21T21:55:00.000Z') {
  return {
    generatedAt,
    serviceId: 'qore-live-signal-intent-reconcile',
    stale: false,
    intent: {
      strategyId: 'ngas-all-year-beta',
      direction: 'long',
      gasPosition: 0.25,
      indexFraction: 0.73,
      cashFraction: 0.02,
      targetDate: '2026-07-21',
      generatedAt,
    },
  }
}

function riskFixture(overrides = {}) {
  return {
    generatedAt: '2026-07-21T21:55:00.000Z',
    serviceId: 'qore-live-risk-and-kill-switch-state',
    blockedReasons: [],
    warnings: [],
    operator: { killSwitchEngaged: false },
    ...overrides,
  }
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function waitForFile(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${filePath}.`)
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function testDailyMathAndSafeVisual() {
  const report = buildPortfolioReport({
    accountStatus: dailyFixture(),
    signalSnapshot: signalFixture(),
    riskSnapshot: riskFixture({ blockedReasons: ['unsafe <tag> & "quote" API_KEY=secret account TEST1234'] }),
    basketConfig: basket,
    cadence: 'daily',
    generatedAt: '2026-07-21T22:00:00.000Z',
  })
  assert.equal(report.account.pnlUsd, 1_000)
  assert.equal(report.account.returnPct, 1)
  assert.equal(report.benchmark.rows.find((row) => row.symbol === 'VOO').returnPct, 2)
  assert.equal(report.benchmark.rows.find((row) => row.symbol === 'QQQM').returnPct, -1)
  assert.equal(report.benchmark.basket.returnPct, 1.4)
  assert.equal(report.relative.pctPoints, -0.4)
  assert.equal(report.relative.usd, -400)
  assert.deepEqual(report.allocations.rows.map((row) => row.symbol), ['UNG', 'VOO', 'QQQM', 'OTHER', 'CASH'])
  assert.equal(report.allocations.otherPositionCount, 1)
  assert.equal(report.attribution.scope, 'account')
  assert.deepEqual(report.risk.blockedReasons, ['Runtime risk service reported 1 blocked gate.'])
  assert.equal(report.risk.blockCount, 1)
  const svg = renderPortfolioReportSvg(report)
  assert.match(svg, /\$101,000/)
  assert.match(svg, /−\$400/)
  assert.match(svg, /Runtime[\s\S]*risk service reported 1 blocked gate/)
  assert.doesNotMatch(svg, /unsafe|secret|TEST1234|<tag>|\b(?:NaN|Infinity|undefined)\b|SECRET/)
  console.log('ok - daily report shows actual, index, and benchmark-relative dollar and percentage results')
}

function testWeeklyDailyTargetWeightCompounding() {
  const dates = ['2026-07-10', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']
  const voo = dates.map((date, index) => [date, 100 * (1.01 ** index)])
  const qqqm = dates.map((date) => [date, 100])
  const history = dates.map((date, index) => ({
    timestamp: `${date}T20:00:00.000Z`,
    equityUsd: 100_000 + index * 1_000,
    profitLossUsd: index * 1_000,
    profitLossPct: index,
  }))
  const accountStatus = dailyFixture({
    account: { equityUsd: 105_000, cashUsd: 10_000, dayPnlPct: null },
    portfolioHistory: { generatedAt: '2026-07-21T21:55:00.000Z', timeframe: '1D', points: history },
    benchmarkHistory: {
      generatedAt: '2026-07-21T21:55:00.000Z',
      source: 'Alpaca historical stock bars',
      feed: 'iex',
      adjustment: 'all',
      timeframe: '1Day',
      rows: [benchmarkRow('VOO', voo), benchmarkRow('QQQM', qqqm)],
    },
    marketCalendar: {
      generatedAt: '2026-07-21T21:55:00.000Z',
      source: 'Alpaca US market calendar',
      rows: dates.map((date) => ({ date, open: '09:30', close: '16:00' })),
    },
  })
  const report = buildPortfolioReport({ accountStatus, basketConfig: basket, cadence: 'weekly' })
  const expectedBasketPct = ((1.008 ** 5) - 1) * 100
  assert.ok(Math.abs(report.benchmark.basket.returnPct - expectedBasketPct) < 0.0001)
  assert.equal(report.account.returnPct, 5)
  assert.equal(report.period.startDate, '2026-07-10')
  assert.equal(report.period.endDate, '2026-07-17')
  console.log('ok - weekly report compounds each configured daily target-weight benchmark return')
}

function testStrictBasketAndMissingBenchmarkFailures() {
  assert.throws(() => validateIndexBasketConfig({ components: [{ symbol: 'VOO', targetWeight: 1 }] }), /exactly one VOO.*QQQM/)
  assert.throws(() => validateIndexBasketConfig({ components: [
    { symbol: 'VOO', targetWeight: 0.7 },
    { symbol: 'QQQM', targetWeight: 0.2 },
  ] }), /sum to 1/)
  const missing = dailyFixture()
  missing.benchmarkHistory.rows[1].points = []
  assert.throws(() => buildPortfolioReport({ accountStatus: missing, basketConfig: basket }), /QQQM.*at least two/)

  const wrongPortfolioTimeframe = dailyFixture()
  wrongPortfolioTimeframe.portfolioHistory.timeframe = '1H'
  assert.throws(
    () => buildPortfolioReport({ accountStatus: wrongPortfolioTimeframe, basketConfig: basket }),
    /portfolio history with exact timeframe 1D/,
  )
  console.log('ok - invalid weights and incomplete live benchmarks fail instead of becoming zero returns')
}

function testExactSessionAlignmentAndWeeklyCoverage() {
  const missingAccountBoundary = dailyFixture()
  missingAccountBoundary.portfolioHistory.points.pop()
  assert.throws(
    () => buildPortfolioReport({ accountStatus: missingAccountBoundary, basketConfig: basket }),
    /complete .* session grid/,
  )

  assert.throws(
    () => buildPortfolioReport({ accountStatus: dailyFixture(), basketConfig: basket, cadence: 'weekly' }),
    /at least seven calendar days/,
  )

  const dates = ['2026-07-10', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']
  const accountStatus = dailyFixture({
    account: { equityUsd: 106_000, cashUsd: 10_000 },
    positions: [],
    portfolioHistory: {
      generatedAt: '2026-07-21T21:55:00.000Z',
      timeframe: '1D',
      points: dates.filter((date) => date !== '2026-07-15').map((date, index) => ({
        timestamp: `${date}T20:00:00.000Z`,
        equityUsd: 100_000 + index * 1_000,
        profitLossUsd: index * 1_000,
        profitLossPct: index,
      })),
    },
    benchmarkHistory: {
      generatedAt: '2026-07-21T21:55:00.000Z',
      source: 'Alpaca historical stock bars',
      feed: 'iex',
      adjustment: 'all',
      timeframe: '1Day',
      rows: [
        benchmarkRow('VOO', dates.filter((date) => date !== '2026-07-15').map((date) => [date, 100])),
        benchmarkRow('QQQM', dates.filter((date) => date !== '2026-07-15').map((date) => [date, 100])),
      ],
    },
    marketCalendar: {
      generatedAt: '2026-07-21T21:55:00.000Z',
      source: 'Alpaca US market calendar',
      rows: dates.map((date) => ({ date, open: '09:30', close: '16:00' })),
    },
  })
  assert.throws(
    () => buildPortfolioReport({ accountStatus, basketConfig: basket, cadence: 'weekly' }),
    /complete .* session grid/,
  )
  console.log('ok - report periods require exact boundaries, full shared sessions, and real weekly coverage')
}

function testCompletedSessionCutoffAndMarketTimeZone() {
  const accountStatus = dailyFixture()
  accountStatus.portfolioHistory.points.push({
    timestamp: '2026-07-21T20:00:00.000Z',
    equityUsd: 102_000,
    profitLossUsd: 2_000,
    profitLossPct: 2,
  })
  accountStatus.benchmarkHistory.rows.find((row) => row.symbol === 'VOO').points.push({
    timestamp: '2026-07-21T20:00:00.000Z',
    closeUsd: 103,
  })
  accountStatus.benchmarkHistory.rows.find((row) => row.symbol === 'QQQM').points.push({
    timestamp: '2026-07-21T20:00:00.000Z',
    closeUsd: 101,
  })
  accountStatus.marketCalendar.rows.push({ date: '2026-07-21', open: '09:30', close: '16:00' })
  accountStatus.portfolioHistory.generatedAt = '2026-07-21T19:59:59.000Z'
  accountStatus.benchmarkHistory.generatedAt = '2026-07-21T19:59:59.000Z'

  const beforeClose = buildPortfolioReport({
    accountStatus,
    basketConfig: basket,
    generatedAt: '2026-07-21T19:59:59.000Z',
  })
  assert.equal(beforeClose.period.endDate, '2026-07-20')
  const renderedAfterCloseFromPreCloseCapture = buildPortfolioReport({
    accountStatus,
    basketConfig: basket,
    generatedAt: '2026-07-21T20:00:01.000Z',
  })
  assert.equal(renderedAfterCloseFromPreCloseCapture.period.endDate, '2026-07-20')
  accountStatus.portfolioHistory.generatedAt = '2026-07-21T20:00:01.000Z'
  accountStatus.benchmarkHistory.generatedAt = '2026-07-21T20:00:01.000Z'
  const afterClose = buildPortfolioReport({
    accountStatus,
    basketConfig: basket,
    generatedAt: '2026-07-21T20:00:01.000Z',
  })
  assert.equal(afterClose.period.endDate, '2026-07-21')
  const selectedHistoricalPeriod = buildPortfolioReport({
    accountStatus,
    basketConfig: basket,
    generatedAt: '2026-07-21T20:00:01.000Z',
    periodEnd: '2026-07-20',
  })
  assert.equal(selectedHistoricalPeriod.period.endDate, '2026-07-20')

  const midnightBars = dailyFixture()
  midnightBars.generatedAt = '2026-07-21T04:59:00.000Z'
  midnightBars.sourceGeneratedAt = '2026-07-21T04:59:00.000Z'
  midnightBars.portfolioHistory.generatedAt = '2026-07-21T04:59:00.000Z'
  midnightBars.benchmarkHistory.generatedAt = '2026-07-21T04:59:00.000Z'
  midnightBars.marketCalendar.generatedAt = '2026-07-21T04:59:00.000Z'
  for (const point of midnightBars.portfolioHistory.points) {
    point.timestamp = `${point.timestamp.slice(0, 10)}T04:00:00.000Z`
  }
  for (const row of midnightBars.benchmarkHistory.rows) {
    for (const point of row.points) point.timestamp = `${point.timestamp.slice(0, 10)}T04:00:00.000Z`
  }
  const westernDisplay = buildPortfolioReport({
    accountStatus: midnightBars,
    basketConfig: basket,
    generatedAt: '2026-07-21T05:00:00.000Z',
    timeZone: 'America/Los_Angeles',
  })
  assert.equal(westernDisplay.period.endDate, '2026-07-20')

  const skewedCapture = dailyFixture()
  skewedCapture.portfolioHistory.generatedAt = '2026-07-21T05:00:00.000Z'
  skewedCapture.benchmarkHistory.generatedAt = '2026-07-21T05:06:00.001Z'
  assert.throws(
    () => buildPortfolioReport({
      accountStatus: skewedCapture,
      basketConfig: basket,
      generatedAt: '2026-07-21T06:00:00.000Z',
    }),
    /capture timestamps differ by more than five minutes/,
  )
  console.log('ok - only completed New York market sessions can enter a report period')
}

function testRuntimeFreshnessAndAttributionLabels() {
  const accountStatus = dailyFixture({
    positions: [
      { symbol: 'UNG', side: 'long', market_value: '11000' },
      { symbol: 'VOO', side: 'long', market_value: '55000' },
      { symbol: 'QQQM', side: 'long', market_value: '15000' },
    ],
  })
  const stale = buildPortfolioReport({
    accountStatus,
    basketConfig: basket,
    signalSnapshot: { ...signalFixture(), stale: true },
    riskSnapshot: riskFixture({ generatedAt: '2026-07-20T10:00:00.000Z' }),
    cadence: 'daily',
    generatedAt: '2026-07-21T22:00:00.000Z',
    dedicatedQoreAccount: true,
  })
  assert.equal(stale.target, null)
  assert.equal(stale.targetStatus.status, 'stale')
  assert.equal(stale.risk.status, 'stale')
  assert.deepEqual(stale.risk.blockedReasons, ['Runtime risk telemetry is stale.'])
  assert.equal(stale.attribution.scope, 'dedicated-account')
  const svg = renderPortfolioReportSvg(stale)
  assert.match(svg, /QORE DEDICATED/)
  assert.match(svg, /STALE TARGET SNAPSHOT/)
  console.log('ok - stale target/risk state is explicit and dedicated-account labeling requires clean holdings')
}

function testDynamicPerformanceScale() {
  const accountStatus = dailyFixture({
    account: { equityUsd: 112_000, cashUsd: 20_000 },
    positions: [],
    portfolioHistory: {
      generatedAt: '2026-07-21T21:55:00.000Z',
      timeframe: '1D',
      points: [
        { timestamp: '2026-07-17T20:00:00.000Z', equityUsd: 100_000, profitLossUsd: 0, profitLossPct: 0 },
        { timestamp: '2026-07-20T20:00:00.000Z', equityUsd: 112_000, profitLossUsd: 12_000, profitLossPct: 12 },
      ],
    },
  })
  const report = buildPortfolioReport({ accountStatus, basketConfig: basket })
  assert.match(renderPortfolioReportSvg(report), /SHARED SCALE ±12%/)
  console.log('ok - performance bars share a dynamic scale instead of clipping large returns')
}

function testGrossExposureAndRiskCounts() {
  const accountStatus = dailyFixture({
    positions: [
      { symbol: 'UNG', side: 'long', market_value: '11000' },
      { symbol: 'VOO', side: 'long', market_value: '55000' },
      { symbol: 'QQQM', side: 'long', market_value: '15000' },
      { symbol: 'FOREIGN_LONG', side: 'long', market_value: '100000' },
      { symbol: 'FOREIGN_SHORT', side: 'short', market_value: '100000' },
    ],
  })
  const report = buildPortfolioReport({
    accountStatus,
    basketConfig: basket,
    riskSnapshot: riskFixture({ blockedReasons: ['a', 'b', 'c', 'd', 'e'] }),
    generatedAt: '2026-07-21T22:00:00.000Z',
    dedicatedQoreAccount: true,
  })
  assert.equal(report.allocations.rows.find((row) => row.symbol === 'OTHER').marketValueUsd, 0)
  assert.equal(report.allocations.grossExposureUsd, 281_000)
  assert.equal(report.risk.blockCount, 5)
  assert.equal(report.attribution.scope, 'account')
  const svg = renderPortfolioReportSvg(report)
  assert.match(svg, /5 RISK GATES BLOCKED/)
  assert.match(svg, /PORTFOLIO ALLOCATION · SCALE 100%/)

  const leveraged = dailyFixture({
    positions: [{ symbol: 'UNG', side: 'long', market_value: '250000' }],
  })
  const leveragedSvg = renderPortfolioReportSvg(buildPortfolioReport({ accountStatus: leveraged, basketConfig: basket }))
  assert.match(leveragedSvg, /PORTFOLIO ALLOCATION · SCALE 250%/)

  const unpriced = dailyFixture({ positions: [{ symbol: 'UNG', side: 'long', market_value: null }] })
  assert.throws(
    () => buildPortfolioReport({ accountStatus: unpriced, basketConfig: basket }),
    /unpriced holding/,
  )
  assert.throws(
    () => buildPortfolioReport({
      accountStatus: dailyFixture({ positions: [{ symbol: 'UNG', market_value: '1000' }] }),
      basketConfig: basket,
    }),
    /exact long or short side/,
  )

  assert.throws(
    () => buildPortfolioReport({ accountStatus: dailyFixture({ positions: null }), basketConfig: basket }),
    /explicit Alpaca positions array/,
  )
  const missingCash = dailyFixture()
  missingCash.account.cashUsd = null
  assert.throws(
    () => buildPortfolioReport({ accountStatus: missingCash, basketConfig: basket }),
    /numeric Alpaca cash telemetry/,
  )

  const operatorAlreadyReported = buildPortfolioReport({
    accountStatus: dailyFixture(),
    basketConfig: basket,
    riskSnapshot: riskFixture({
      blockedReasons: ['Operator state is missing.'],
      operator: {},
      warnings: ['warning-one', 'warning-two'],
    }),
    generatedAt: '2026-07-21T22:00:00.000Z',
  })
  assert.equal(operatorAlreadyReported.risk.blockCount, 1)

  const warningsOnly = buildPortfolioReport({
    accountStatus: dailyFixture(),
    basketConfig: basket,
    riskSnapshot: riskFixture({ warnings: ['warning-one', 'warning-two'] }),
    generatedAt: '2026-07-21T22:00:00.000Z',
  })
  assert.match(renderPortfolioReportSvg(warningsOnly), /2 RISK WARNINGS · NO ACTIVE BLOCKS/)
  assert.match(warningsOnly.insights.at(-1).text, /reported 2 warnings/)
  console.log('ok - gross exposure preserves offsetting positions, risk counts stay accurate, and allocation scale is dynamic')
}

function testForcedDeliveryLedgerReconciliation() {
  const key = 'paper:0123456789abcdef01234567:daily:2026-07-20'
  const report = {
    mode: 'paper',
    cadence: 'daily',
    period: { endDate: '2026-07-20' },
  }
  let ledger = updateDeliveryLedger({}, key, [
    {
      id: 'discord', type: 'discord', status: 'uncertain',
      startedAt: '2026-07-21T01:00:00.000Z', finishedAt: '2026-07-21T01:00:00.000Z',
      error: 'Delivery started; final provider acknowledgement was not recorded.',
    },
    {
      id: 'telegram', type: 'telegram', status: 'sent',
      startedAt: '2026-07-21T01:00:00.000Z', finishedAt: '2026-07-21T01:00:01.000Z',
    },
  ], 'artifact-hash', 'summary-hash', report)
  assert.deepEqual([...uncertainDestinationIds(ledger, key)], ['discord'])

  ledger = updateDeliveryLedger(ledger, key, [{
    id: 'discord', type: 'discord', status: 'uncertain',
    startedAt: '2026-07-21T02:00:00.000Z', finishedAt: '2026-07-21T02:00:00.000Z',
    error: 'Delivery started; final provider acknowledgement was not recorded.',
  }], 'artifact-hash', 'summary-hash', report, {
    forced: true,
    forceRunId: 'force-failed',
    reconcileCanonicalIds: new Set(['discord']),
    preserveCanonicalUncertainIds: new Set(['discord']),
  })
  assert.deepEqual([...uncertainDestinationIds(ledger, key)], ['discord'])

  ledger = updateDeliveryLedger(ledger, key, [{
    id: 'discord', type: 'discord', status: 'failed',
    startedAt: '2026-07-21T02:00:00.000Z', finishedAt: '2026-07-21T02:00:01.000Z',
    error: 'Discord returned HTTP 400.',
  }], 'artifact-hash', 'summary-hash', report, {
    forced: true,
    forceRunId: 'force-failed',
    reconcileCanonicalIds: new Set(['discord']),
    preserveCanonicalUncertainIds: new Set(['discord']),
  })
  assert.deepEqual([...uncertainDestinationIds(ledger, key)], ['discord'])

  ledger = updateDeliveryLedger(ledger, key, [{
    id: 'discord', type: 'discord', status: 'sent',
    startedAt: '2026-07-21T02:00:00.000Z', finishedAt: '2026-07-21T02:00:01.000Z',
  }], 'artifact-hash', 'summary-hash', report, {
    forced: true,
    forceRunId: 'force-reviewed',
    reconcileCanonicalIds: new Set(['discord']),
    preserveCanonicalUncertainIds: new Set(['discord']),
  })
  assert.deepEqual([...uncertainDestinationIds(ledger, key)], [])
  assert.deepEqual([...sentDestinationIds(ledger, key)].sort(), ['discord', 'telegram'])
  assert.equal(ledger.forcedDeliveries[`${key}:force-reviewed:discord`].status, 'sent')
  assert.equal(ledger.deliveries[`${key}:discord`].summarySha256, 'summary-hash')

  const pureDuplicate = updateDeliveryLedger(ledger, key, [{
    id: 'discord', type: 'discord', status: 'uncertain',
    startedAt: '2026-07-21T03:00:00.000Z', finishedAt: '2026-07-21T03:00:00.000Z',
    error: 'Delivery started; final provider acknowledgement was not recorded.',
  }], 'artifact-hash', 'summary-hash', report, {
    forced: true,
    forceRunId: 'force-duplicate',
  })
  assert.equal(pureDuplicate.deliveries[`${key}:discord`].status, 'sent')
  assert.equal(pureDuplicate.forcedDeliveries[`${key}:force-duplicate:discord`].status, 'uncertain')
  console.log('ok - forced recovery resolves canonical uncertainty without corrupting duplicate-send audit state')
}

async function testIndependentDeliveryAndSecretRedaction() {
  const artifactPath = path.join(scratch, 'delivery.png')
  await writeFile(artifactPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const config = {
    delivery: {
      requestTimeoutMs: 5_000,
      destinations: [
        { id: 'discord', type: 'discord', enabled: true, webhookUrlEnv: 'TEST_DISCORD_URL' },
        { id: 'telegram', type: 'telegram', enabled: true, botTokenEnv: 'TEST_TELEGRAM_TOKEN', chatIdEnv: 'TEST_TELEGRAM_CHAT' },
        { id: 'email', type: 'resend', enabled: true, apiKeyEnv: 'TEST_RESEND_KEY', fromEnv: 'TEST_EMAIL_FROM', toEnv: 'TEST_EMAIL_TO' },
      ],
    },
  }
  const env = {
    TEST_DISCORD_URL: 'https://discord.com/api/webhooks/123456/discord-secret-value',
    TEST_TELEGRAM_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdef1234',
    TEST_TELEGRAM_CHAT: '-1001234567890',
    TEST_RESEND_KEY: 're_secret_value',
    TEST_EMAIL_FROM: 'qore@example.com',
    TEST_EMAIL_TO: 'owner@example.com',
  }
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    if (String(url).includes('discord.com')) return new Response('discord leaked discord-secret-value', { status: 500 })
    if (String(url).includes('api.telegram.org')) return new Response('{"ok":true,"result":{}}', { status: 200 })
    return new Response('{}', { status: 200 })
  }
  const attempts = await deliverPortfolioReport({
    config,
    artifactPath,
    filename: 'report.png',
    caption: 'safe caption',
    deliveryKey: 'daily:2026-07-21',
    env,
    fetchImpl,
  })
  assert.equal(calls.length, 3)
  assert.deepEqual(attempts.map((attempt) => attempt.status), ['uncertain', 'sent', 'sent'])
  const serialized = JSON.stringify(attempts)
  assert.doesNotMatch(serialized, /discord-secret-value/)
  for (const secret of Object.values(env)) assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  calls.length = 0
  const retry = await deliverPortfolioReport({
    config,
    artifactPath,
    filename: 'report.png',
    caption: 'safe caption',
    deliveryKey: 'daily:2026-07-21',
    env,
    skipDestinationIds: new Set(['telegram', 'email']),
    fetchImpl,
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(retry.map((attempt) => attempt.id), ['discord'])

  const telegramFailure = await deliverPortfolioReport({
    config: { delivery: { destinations: [config.delivery.destinations[1]] } },
    artifactPath,
    filename: 'report.png',
    caption: 'safe caption',
    deliveryKey: 'daily:2026-07-21',
    env,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      description: `provider echoed ${env.TEST_TELEGRAM_CHAT}`,
      parameters: { retry_after: 42 },
    }), { status: 200 }),
  })
  assert.equal(telegramFailure[0].status, 'failed')
  assert.equal(telegramFailure[0].retryAfterSeconds, 42)
  assert.doesNotMatch(JSON.stringify(telegramFailure), /provider echoed|-1001234567890/)

  const telegramMalformedSuccess = await deliverPortfolioReport({
    config: { delivery: { destinations: [config.delivery.destinations[1]] } },
    artifactPath,
    filename: 'report.png',
    caption: 'safe caption',
    deliveryKey: 'daily:2026-07-21',
    env,
    fetchImpl: async () => new Response('{"unexpected":true}', { status: 200 }),
  })
  assert.equal(telegramMalformedSuccess[0].status, 'uncertain')

  let responseCancelled = false
  const oversizedResponse = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(32_000))
      controller.enqueue(new Uint8Array(1_024))
    },
    cancel() { responseCancelled = true },
  })
  const boundedFailure = await deliverPortfolioReport({
    config: { delivery: { destinations: [config.delivery.destinations[0]] } },
    artifactPath,
    filename: 'report.png',
    caption: 'safe caption',
    deliveryKey: 'daily:2026-07-21',
    env,
    fetchImpl: async () => new Response(oversizedResponse, { status: 500 }),
  })
  assert.equal(boundedFailure[0].status, 'uncertain')
  assert.equal(responseCancelled, true)

  const resendAmbiguous = await deliverPortfolioReport({
    config: { delivery: { destinations: [config.delivery.destinations[2]] } },
    artifactPath,
    filename: 'report.png',
    caption: 'safe caption',
    deliveryKey: 'daily:2026-07-21',
    env,
    fetchImpl: async () => { throw new TypeError('connection reset') },
  })
  assert.equal(resendAmbiguous[0].status, 'uncertain')

  const inMemoryArtifact = await deliverPortfolioReport({
    config: { delivery: { destinations: [config.delivery.destinations[1]] } },
    artifactPath: path.join(scratch, 'intentionally-missing.png'),
    artifactBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    filename: 'report.png',
    caption: 'safe caption',
    deliveryKey: 'daily:2026-07-21',
    env,
    fetchImpl: async () => new Response('{"ok":true}', { status: 200 }),
  })
  assert.equal(inMemoryArtifact[0].status, 'sent')
  console.log('ok - fan-out isolates failures, redacts secrets, and retries only unfinished destinations')
}

async function testCliRendersPrivatePngWithoutSending() {
  const root = path.join(scratch, 'cli')
  const brokerDir = path.join(root, 'broker')
  const weatherDir = path.join(root, 'weather')
  const outputDirectory = path.join(localOutputTestRoot, 'cli')
  const configPath = path.join(root, 'config.json')
  await writeJson(path.join(brokerDir, 'account-status.json'), dailyFixture({
    accountBinding: '0123456789abcdef01234567',
  }))
  await writeJson(path.join(weatherDir, 'signal.json'), signalFixture())
  await writeJson(path.join(weatherDir, 'risk.json'), riskFixture())
  await writeJson(path.join(weatherDir, 'operator.json'), { killSwitchEngaged: false })
  await writeJson(configPath, {
    serviceId: 'qore-portfolio-reports-config-v1',
    report: { defaultCadence: 'daily', timeZone: 'America/New_York', maxTelemetryAgeHours: 36, outputDirectory },
    delivery: { destinations: [] },
  })
  const result = await runNode([reportScript, '--cadence=daily', '--json'], {
    NODE_ENV: 'test',
    QORE_REPORT_CONFIG: configPath,
    QORE_BROKER_STATE_DIR: brokerDir,
    QORE_LIVE_SIGNAL_INTENT_FILE: path.join(weatherDir, 'signal.json'),
    QORE_LIVE_RISK_STATE_FILE: path.join(weatherDir, 'risk.json'),
    QORE_LIVE_OPERATOR_STATE_FILE: path.join(weatherDir, 'operator.json'),
  })
  assert.equal(result.code, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  const pngPath = path.join(repoDir, payload.files.png)
  const png = await readFile(pngPath)
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  assert.equal((await stat(pngPath)).mode & 0o777, 0o600)
  assert.equal((await stat(path.dirname(pngPath))).mode & 0o777, 0o700)
  assert.deepEqual(payload.deliveries, [])

  const unsafeFlags = await runNode([reportScript, '--loop', '--force'], {
    NODE_ENV: 'test',
    QORE_REPORT_CONFIG: configPath,
  })
  assert.equal(unsafeFlags.code, 1)
  assert.match(unsafeFlags.stderr, /--force cannot be combined/)

  const implicitModeSend = await runNode([reportScript, '--send'], {
    NODE_ENV: 'test',
    QORE_REPORT_CONFIG: configPath,
    QORE_BROKER_MODE: '',
  })
  assert.equal(implicitModeSend.code, 1)
  assert.match(implicitModeSend.stderr, /explicit QORE_BROKER_MODE/)

  const shortWindowConfigPath = path.join(root, 'short-window-config.json')
  await writeJson(shortWindowConfigPath, {
    serviceId: 'qore-portfolio-reports-config-v1',
    report: { defaultCadence: 'daily', timeZone: 'America/New_York', maxTelemetryAgeHours: 36, outputDirectory },
    schedules: [{
      id: 'too-short', enabled: true, cadence: 'daily', weekdays: [1],
      hour: 18, minute: 30, deliveryWindowMinutes: 1,
    }],
    scheduler: { pollIntervalMs: 120_000 },
    delivery: { destinations: [] },
  })
  const shortWindow = await runNode([reportScript], {
    NODE_ENV: 'test',
    QORE_REPORT_CONFIG: shortWindowConfigPath,
  })
  assert.equal(shortWindow.code, 1)
  assert.match(shortWindow.stderr, /must exceed scheduler\.pollIntervalMs/)

  const forceConfigPath = path.join(root, 'force-config.json')
  await writeJson(forceConfigPath, {
    serviceId: 'qore-portfolio-reports-config-v1',
    report: { defaultCadence: 'daily', timeZone: 'America/New_York', maxTelemetryAgeHours: 36, outputDirectory },
    delivery: {
      destinations: [{
        id: 'discord', type: 'discord', enabled: true, webhookUrlEnv: 'TEST_DISCORD_URL',
      }],
    },
  })
  const forceWithoutCanonical = await runNode([reportScript, '--send', '--force'], {
    NODE_ENV: 'test',
    QORE_REPORT_CONFIG: forceConfigPath,
    QORE_BROKER_MODE: 'paper',
    QORE_REPORT_SEND_ENABLED: '1',
    QORE_BROKER_STATE_DIR: brokerDir,
    QORE_LIVE_SIGNAL_INTENT_FILE: path.join(weatherDir, 'signal.json'),
    QORE_LIVE_RISK_STATE_FILE: path.join(weatherDir, 'risk.json'),
    QORE_LIVE_OPERATOR_STATE_FILE: path.join(weatherDir, 'operator.json'),
  })
  assert.equal(forceWithoutCanonical.code, 1)
  assert.match(forceWithoutCanonical.stderr, /--force requires existing canonical delivery state/)

  await writeJson(path.join(outputDirectory, 'deliveries.json'), {
    schemaVersion: 1,
    serviceId: 'qore-portfolio-report-deliveries',
    deliveries: {
      'paper:0123456789abcdef01234567:daily:2026-07-20:discord': {
        destinationId: 'discord', type: 'discord', status: 'sent',
        attemptedAt: new Date().toISOString(), artifactSha256: 'hash', summarySha256: 'summary-hash',
      },
    },
  })
  const historicalCompleteForce = await runNode([
    reportScript, '--send', '--force', '--period-end=2026-07-20',
  ], {
    NODE_ENV: 'test',
    QORE_REPORT_CONFIG: forceConfigPath,
    QORE_BROKER_MODE: 'paper',
    QORE_REPORT_SEND_ENABLED: '1',
    QORE_BROKER_STATE_DIR: brokerDir,
    QORE_LIVE_SIGNAL_INTENT_FILE: path.join(weatherDir, 'signal.json'),
    QORE_LIVE_RISK_STATE_FILE: path.join(weatherDir, 'risk.json'),
    QORE_LIVE_OPERATOR_STATE_FILE: path.join(weatherDir, 'operator.json'),
  })
  assert.equal(historicalCompleteForce.code, 1)
  assert.match(historicalCompleteForce.stderr, /--period-end requires at least one unresolved canonical destination/)
  console.log('ok - preview writes private SVG, PNG, and summary artifacts without delivery calls')
}

async function testOrdinarySendsRequireSuccessfulBrokerRefresh() {
  const root = path.join(scratch, 'required-send-refresh')
  const weatherDir = path.join(root, 'weather')
  await writeJson(path.join(weatherDir, 'signal.json'), signalFixture())
  await writeJson(path.join(weatherDir, 'risk.json'), riskFixture())
  await writeJson(path.join(weatherDir, 'operator.json'), { killSwitchEngaged: false })

  let brokerRequestCount = 0
  const server = createServer((_request, response) => {
    brokerRequestCount += 1
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end('{"message":"broker refresh unavailable"}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    for (const mode of ['paper', 'dry-run']) {
      brokerRequestCount = 0
      const brokerDir = path.join(root, mode, 'broker')
      const outputDirectory = path.join(localOutputTestRoot, 'required-send-refresh', mode)
      const configPath = path.join(root, mode, 'config.json')
      await writeJson(path.join(brokerDir, 'account-status.json'), dailyFixture({
        mode,
        accountBinding: '0123456789abcdef01234567',
      }))
      await writeJson(configPath, {
        serviceId: 'qore-portfolio-reports-config-v1',
        report: { defaultCadence: 'daily', timeZone: 'America/New_York', maxTelemetryAgeHours: 36, outputDirectory },
        delivery: {
          destinations: [{
            id: 'discord', type: 'discord', enabled: true, webhookUrlEnv: 'TEST_DISCORD_URL',
          }],
        },
      })
      const result = await runNode([reportScript, '--send'], {
        NODE_ENV: 'test',
        QORE_REPORT_CONFIG: configPath,
        QORE_BROKER_MODE: mode,
        QORE_REPORT_SEND_ENABLED: '1',
        QORE_BROKER_STATE_DIR: brokerDir,
        QORE_LIVE_SIGNAL_INTENT_FILE: path.join(weatherDir, 'signal.json'),
        QORE_LIVE_RISK_STATE_FILE: path.join(weatherDir, 'risk.json'),
        QORE_LIVE_OPERATOR_STATE_FILE: path.join(weatherDir, 'operator.json'),
        QORE_ALPACA_API_KEY_ID: 'test-key',
        QORE_ALPACA_API_SECRET_KEY: 'test-secret',
        QORE_ALPACA_BASE_URL: baseUrl,
        QORE_ALPACA_DATA_BASE_URL: baseUrl,
        QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
      })
      assert.equal(result.code, 1)
      assert.ok(brokerRequestCount > 0, `${mode} outbound delivery must attempt a broker refresh`)
      assert.match(result.stderr, /Read-only Alpaca status refresh failed/)
      assert.equal(existsSync(path.join(outputDirectory, 'deliveries.json')), false)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  console.log('ok - ordinary paper and dry-run sends require a successful broker refresh before delivery')
}

async function testSymlinkedOutputRootIsRejected() {
  const root = path.join(scratch, 'symlink-output')
  const configPath = path.join(root, 'config.json')
  const linkParent = path.join(localOutputTestRoot, 'symlink-output')
  const linkPath = path.join(linkParent, 'redirect')
  await mkdir(linkParent, { recursive: true })
  await symlink(root, linkPath, 'dir')
  await writeJson(configPath, {
    serviceId: 'qore-portfolio-reports-config-v1',
    report: {
      defaultCadence: 'daily',
      timeZone: 'America/New_York',
      maxTelemetryAgeHours: 36,
      outputDirectory: linkPath,
    },
    delivery: { destinations: [] },
  })
  const result = await runNode([reportScript], {
    NODE_ENV: 'test',
    QORE_REPORT_CONFIG: configPath,
  })
  assert.equal(result.code, 1)
  assert.match(result.stderr, /must not contain a symbolic link/)
  console.log('ok - report output refuses symlinked paths outside the private operational root')
}

async function testSignalKeepsLockUntilRefreshSettles() {
  const root = path.join(scratch, 'signal-lock')
  const outputDirectory = path.join(localOutputTestRoot, 'signal-lock')
  const brokerDir = path.join(root, 'broker')
  const configPath = path.join(root, 'config.json')
  await writeJson(configPath, {
    serviceId: 'qore-portfolio-reports-config-v1',
    report: { defaultCadence: 'daily', timeZone: 'America/New_York', maxTelemetryAgeHours: 36, outputDirectory },
    delivery: { destinations: [] },
  })
  const sockets = new Set()
  const server = createServer(() => {})
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const child = spawn(process.execPath, [reportScript, '--refresh'], {
    cwd: repoDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      QORE_REPORT_CONFIG: configPath,
      QORE_BROKER_STATE_DIR: brokerDir,
      QORE_BROKER_MODE: 'paper',
      QORE_REPORT_BROKER_REFRESH_TIMEOUT_MS: '500',
      APCA_API_KEY_ID: 'test-key',
      APCA_API_SECRET_KEY: 'test-secret',
      QORE_ALPACA_BASE_URL: baseUrl,
      QORE_ALPACA_DATA_BASE_URL: baseUrl,
      QORE_ALPACA_TEST_ENDPOINT_CONFIRMED: '1',
      QORE_ALPACA_REQUEST_TIMEOUT_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.resume()
  child.stderr.resume()
  const reportLockPath = path.join(outputDirectory, 'operation.lock')
  try {
    await waitForFile(reportLockPath)
    child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(existsSync(reportLockPath), true, 'report lock must remain while the refresh is still active')
    await new Promise((resolve) => child.once('close', resolve))
    assert.equal(existsSync(reportLockPath), false)
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
  console.log('ok - SIGTERM keeps the report lock until the active read-only refresh settles')
}

try {
  testDailyMathAndSafeVisual()
  testWeeklyDailyTargetWeightCompounding()
  testStrictBasketAndMissingBenchmarkFailures()
  testExactSessionAlignmentAndWeeklyCoverage()
  testCompletedSessionCutoffAndMarketTimeZone()
  testRuntimeFreshnessAndAttributionLabels()
  testDynamicPerformanceScale()
  testGrossExposureAndRiskCounts()
  testForcedDeliveryLedgerReconciliation()
  await testIndependentDeliveryAndSecretRedaction()
  await testCliRendersPrivatePngWithoutSending()
  await testOrdinarySendsRequireSuccessfulBrokerRefresh()
  await testSymlinkedOutputRootIsRejected()
  await testSignalKeepsLockUntilRefreshSettles()
} finally {
  await rm(scratch, { recursive: true, force: true })
  await rm(localOutputTestRoot, { recursive: true, force: true })
}
