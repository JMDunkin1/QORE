# NGAS Winter Alpha

Generated at 2026-06-11T20:23:27.719Z.

## Purpose

This active QORE research strategy combines parent experts without fitting new weather thresholds: Dual Weather supplies the cold/warm forecast-follow context, and Weather Hybrid supplies post-window reversion context. The selected blend is ranked on train/validation only, with holdout reported after selection.

## Selected Candidate

- Architecture: Short fade plus confirmed long fade.
- Parent experts: Dual Weather Rotation for forecast-follow and Weather Hybrid Rotation for post-window reversion.
- Position policy: Take Weather Hybrid reversion-short setups directly; take reversion-long setups only when Dual Weather confirms cold demand in the same direction.
- Max weather UNG overlay: 0.45x; parent weather leg 0.25x and weather reversion leg 0.2x.
- Idle capital risk mode: Full index fallback for idle capital.
- Cost: 0.064% round trip, charged as 0.032% one-way on UNG position changes.
- Selection: Only predeclared parent-blend policies are selected on train and validation. Generic idle-index risk-off variants are reported as diagnostics only, and holdout rows after 2025-11-01 are reported after selection.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 101 | 61.82% | 33.7% | 28.12% | 16.08% | 0.88 | 1.36 | -25.17% | 4% |
| Validation | 40 | 40.53% | 29.08% | 11.45% | 23.99% | 1.24 | 1.69 | -16.35% | 2.9% |
| Holdout | 34 | 20.62% | 10.94% | 9.68% | 37.71% | 1.81 | 2.71 | -7.31% | 7.5% |
| Full | 175 | 174.28% | 91.47% | 82.81% | 20.48% | 1.08 | 1.61 | -25.17% | 4% |

## Train/Validation Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 4 | 3.14% | 4.42 | -3.36% |
| Warm-short | 58 | 14.58% | 2.27 | -6.03% |
| Reversion-long | 0 | 0% | 0 | 0% |
| Reversion-short | 79 | 5.87% | 1.14 | -5.89% |
| Long-side combined | 4 | 3.14% | 4.42 | -3.36% |
| Short-side combined | 137 | 21.3% | 1.71 | -7.11% |

## Full Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 4 | 3.14% | 4.42 | -3.36% |
| Warm-short | 75 | 34.62% | 3.64 | -6.03% |
| Reversion-long | 0 | 0% | 0 | 0% |
| Reversion-short | 96 | -1.06% | -0.07 | -12.36% |
| Long-side combined | 4 | 3.14% | 4.42 | -3.36% |
| Short-side combined | 171 | 33.19% | 1.92 | -7.11% |
| Index fallback | 1187 | 99.66% | 0.9 | -24.02% |

## Anti-Overfit Check

- Candidate count: 10.
- Eligible candidates: 2.
- Eligibility requires a selectable gas-alpha policy, positive train and validation edge, lower train and validation drawdown than the index basket, and train/validation volatility under a 20% annualized risk budget.
- Index risk-off variants are diagnostic-only because they can create cash-flat equity shelves and are a portfolio overlay rather than a gas-alpha rule.
- Holdout was not used for selection: yes.
- Block-bootstrap p-value versus index active daily return: 0.4988.
- Bootstrap setup: 1200 iterations, 10-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | Sharpe | maxDD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ngas-alpha-fade-primary-confirmed-follow-risk-off | no | 125.7836 | 0.45% | 28.29% | 7.08% | 57.69% | 1.21 | -27.94% |
| ngas-alpha-net-additive-parent-overlay | no | 122.5457 | 22.94% | 26.55% | -1.06% | 76.41% | 1.04 | -31.21% |
| ngas-alpha-weather-hybrid-parent-risk-off | no | 118.7995 | -9.46% | 25.34% | -2.38% | 16.81% | 1.06 | -25.73% |
| ngas-alpha-fade-primary-confirmed-follow | no | 117.1301 | 2.78% | 38.8% | 9.53% | 84.55% | 1.07 | -30.82% |
| ngas-alpha-dual-follow-first | no | 115.7187 | 22.57% | 21.93% | -9.1% | 48.86% | 0.94 | -31.42% |
| ngas-alpha-short-fade-priority | no | 108.0477 | 25.22% | 15.41% | -15.25% | 28.26% | 0.86 | -30.59% |
| ngas-alpha-weather-fade-first | no | 102.8752 | 0.72% | 24.9% | -7.6% | 22.41% | 0.84 | -28.84% |
| ngas-alpha-short-fade-confirmed-long-risk-off | no | 102.1634 | 20.71% | 3.23% | 7.67% | 50.84% | 1.21 | -20.23% |
| ngas-alpha-short-fade-confirmed-long | yes | 86.0094 | 28.12% | 11.45% | 9.68% | 82.81% | 1.08 | -25.17% |
| ngas-alpha-short-fade-only | yes | 66.2597 | 20.74% | 5.27% | 0.41% | 39.58% | 0.95 | -24.18% |

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. The selected blend keeps idle capital in the index fallback so any return improvement comes from explicit gas overlays rather than a cash timing patch. Holdout is still one winter and the bootstrap reality check remains the promotion gate.
