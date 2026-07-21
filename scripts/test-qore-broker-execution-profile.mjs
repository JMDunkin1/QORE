#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  brokerExecutionProfileDigestSha256,
  brokerExecutionProfileTieOutFailures,
  loadReviewedBrokerExecutionProfile,
  resolveBrokerExecutionProfile,
} from './lib/qore-broker-execution-profile.mjs'
import { allYearStrategyContractDigestSha256 } from './lib/qore-validation-integrity.mjs'

const repoDir = process.cwd()
const reviewed = loadReviewedBrokerExecutionProfile(repoDir)
const researchExecution = JSON.parse(fs.readFileSync('config/qore-research-execution.json', 'utf8'))
assert.deepEqual(brokerExecutionProfileTieOutFailures(reviewed.profile, researchExecution), [])

for (const field of ['deploymentFraction', 'rebalanceDeadbandPct']) {
  for (const [label, invalidValue] of [
    ['missing', undefined],
    ['string', String(researchExecution[field])],
    ['null', null],
    ['non-finite', Number.NaN],
  ]) {
    const invalidExecution = structuredClone(researchExecution)
    if (invalidValue === undefined) delete invalidExecution[field]
    else invalidExecution[field] = invalidValue
    assert.match(
      brokerExecutionProfileTieOutFailures(reviewed.profile, invalidExecution).join('; '),
      new RegExp(`research execution ${field} must be a finite number`),
      `${field} must fail closed when ${label}`,
    )
  }
}

const reordered = structuredClone(reviewed.profile)
reordered.universe.allowedSymbols.reverse()
reordered.sizing.indexBasket.reverse()
assert.equal(brokerExecutionProfileDigestSha256(reordered), reviewed.profileDigestSha256)

const changedBasket = structuredClone(reviewed.profile)
changedBasket.sizing.indexBasket = [
  { symbol: 'VOO', targetWeight: 0.7 },
  { symbol: 'QQQM', targetWeight: 0.3 },
]
assert.notEqual(brokerExecutionProfileDigestSha256(changedBasket), reviewed.profileDigestSha256)
assert.match(
  brokerExecutionProfileTieOutFailures(changedBasket, researchExecution).join('; '),
  /index basket/,
)
const sealedSummary = {
  strategyId: 'ngas-all-year-beta',
  contract: {
    brokerExecution: {
      schemaVersion: reviewed.profile.schemaVersion,
      profileId: reviewed.profile.profileId,
      profileDigestSha256: reviewed.profileDigestSha256,
    },
  },
}
const changedSealedSummary = structuredClone(sealedSummary)
changedSealedSummary.contract.brokerExecution.profileDigestSha256 = brokerExecutionProfileDigestSha256(changedBasket)
assert.notEqual(
  allYearStrategyContractDigestSha256(changedSealedSummary),
  allYearStrategyContractDigestSha256(sealedSummary),
  'broker profile changes must invalidate the end-to-end strategy seal',
)

const matchingEnv = {
  QORE_ALPACA_ALLOW_SHORTS: '1',
  QORE_ALPACA_ALLOW_HARD_TO_BORROW: '0',
  QORE_ALPACA_REPLACE_OPEN_ORDERS: '0',
}
const resolved = resolveBrokerExecutionProfile(reviewed.profile, matchingEnv)
assert.equal(brokerExecutionProfileDigestSha256(resolved), reviewed.profileDigestSha256)

const boundOverrides = {
  QORE_LIVE_ACCOUNT_ALLOCATION_PCT: '99',
  QORE_LIVE_MIN_CASH_BUFFER_PCT: '3',
  QORE_LIVE_REBALANCE_DEADBAND_PCT: '0.5',
  QORE_LIVE_MIN_ORDER_USD: '11',
  QORE_LIVE_MAX_ORDER_USD: '100',
  QORE_ALPACA_FRACTIONAL_ORDERS: '0',
  QORE_ALPACA_ALLOW_SHORTS: '0',
  QORE_ALPACA_ALLOW_HARD_TO_BORROW: '1',
  QORE_ALPACA_REPLACE_OPEN_ORDERS: '1',
  QORE_ALPACA_MARKET_DATA_FEED: 'sip',
  QORE_LIVE_MAX_QUOTE_AGE_MINUTES: '6',
  QORE_LIVE_MAX_QUOTE_FUTURE_SKEW_SECONDS: '6',
  QORE_ALPACA_CLOCK_MAX_AGE_SECONDS: '31',
  QORE_ALPACA_CLOCK_MAX_FUTURE_SKEW_SECONDS: '6',
  QORE_LIVE_MAX_RISK_SNAPSHOT_AGE_SECONDS: '901',
  QORE_LIVE_MAX_RISK_SNAPSHOT_FUTURE_SKEW_SECONDS: '31',
  QORE_LIVE_MAX_DAILY_LOSS_PCT: '11',
  QORE_LIVE_MAX_TRAILING_DRAWDOWN_PCT: '24',
  QORE_LIVE_MAX_GROSS_EXPOSURE_PCT: '99',
  QORE_ALPACA_REQUEST_TIMEOUT_MS: '15001',
}
for (const [name, value] of Object.entries(boundOverrides)) {
  const candidate = resolveBrokerExecutionProfile(reviewed.profile, { ...matchingEnv, [name]: value })
  assert.notEqual(
    brokerExecutionProfileDigestSha256(candidate),
    reviewed.profileDigestSha256,
    `${name} must change the resolved broker execution profile digest`,
  )
}

const irrelevantEnv = {
  ...matchingEnv,
  APCA_API_KEY_ID: 'secret-key',
  APCA_API_SECRET_KEY: 'secret-value',
  QORE_BROKER_STATE_DIR: '/tmp/irrelevant-state',
  QORE_CONFIRM_LIVE_TRADING: 'I_UNDERSTAND_THIS_CAN_LOSE_MONEY',
  QORE_LIVE_ORDER_ROUTING_ENABLED: '1',
}
assert.equal(
  brokerExecutionProfileDigestSha256(resolveBrokerExecutionProfile(reviewed.profile, irrelevantEnv)),
  reviewed.profileDigestSha256,
)

assert.throws(
  () => resolveBrokerExecutionProfile(reviewed.profile, { ...matchingEnv, QORE_LIVE_ACCOUNT_ALLOCATION_PCT: 'invalid' }),
  /QORE_LIVE_ACCOUNT_ALLOCATION_PCT/,
)
assert.throws(
  () => resolveBrokerExecutionProfile(reviewed.profile, { ...matchingEnv, QORE_ALPACA_ORDER_TYPE: 'limit' }),
  /order type must equal market/,
)
assert.throws(
  () => resolveBrokerExecutionProfile(reviewed.profile, { ...matchingEnv, QORE_ALPACA_TIME_IN_FORCE: 'gtc' }),
  /time in force must equal day/,
)

console.log(`ok - broker execution profile is canonical, research-tied, and env-sensitive digest=${reviewed.profileDigestSha256}`)
