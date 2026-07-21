#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  downsideDeviation,
  laggedRollingAnnualizedVolPct,
  volatilityTargetedFraction,
} from './lib/qore-research-statistics.mjs'

function close(left, right, tolerance = 1e-12, message = '') {
  assert.ok(Math.abs(left - right) <= tolerance, `${message} expected ${right}, received ${left}`)
}

function closeToCloseReturnsPct(closes) {
  return closes.slice(1).map((value, index) => ((value - closes[index]) / closes[index]) * 100)
}

function currentVolatilityTarget(closes, baseFraction = 0.35, confidence = 0.8, targetVolPct = 18) {
  const returnsPct = closeToCloseReturnsPct(closes)
  const currentIndex = returnsPct.length - 1
  const annualizedVolPct = laggedRollingAnnualizedVolPct(returnsPct, currentIndex)
  return volatilityTargetedFraction({
    annualizedVolPct,
    baseFraction,
    confidence,
    targetVolPct,
  })
}

const returns = [0.02, -0.01, 0.01, -0.03]
close(
  downsideDeviation(returns),
  Math.sqrt((0 ** 2 + (-0.01) ** 2 + 0 ** 2 + (-0.03) ** 2) / returns.length),
  1e-12,
  'downside deviation must include every observation in the denominator',
)
close(
  downsideDeviation([0.02, 0, 0.01], 0.01),
  Math.sqrt((0 ** 2 + (-0.01) ** 2 + 0 ** 2) / 3),
  1e-12,
  'downside deviation must apply the minimum acceptable return before squaring',
)
assert.equal(downsideDeviation([0.01, 0.02]), 0)
close(downsideDeviation([-0.01, -0.01]), 0.01, 1e-12, 'equal losses must retain non-zero downside risk')
assert.equal(downsideDeviation([]), 0)

const closes = [
  100, 101, 99, 102, 100, 103, 101, 104, 102, 105, 103,
  106, 104, 107, 105, 108, 106, 109, 107, 110, 108, 111,
]
const baselineTarget = currentVolatilityTarget(closes)
const currentCloseMutated = [...closes]
currentCloseMutated[currentCloseMutated.length - 1] *= 4
close(
  currentVolatilityTarget(currentCloseMutated),
  baselineTarget,
  1e-12,
  'the current-session close must not change a target effective at the current-session open',
)

const priorCloseMutated = [...closes]
priorCloseMutated[priorCloseMutated.length - 2] *= 1.5
assert.notEqual(
  currentVolatilityTarget(priorCloseMutated),
  baselineTarget,
  'the regression fixture must remain sensitive to information available before the current open',
)

console.log('research statistics passed downside-deviation and lagged-volatility checks')
