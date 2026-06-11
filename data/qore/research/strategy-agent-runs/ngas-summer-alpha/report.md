# NGAS Summer Alpha Lane

Generated at 2026-06-11T19:49:04.889Z.

## Purpose

This is the NGAS Summer Alpha cooling-season research strategy. It explicitly requires both requested legs: a weather-demand follow trade and a post-move overreaction fade. Capital that is not assigned to UNG stays in the diversified US index basket.

## Research Basis

- Demand link: EIA treats cooling degree days as the measure of air-conditioning need, so this lane maps broad summer warmth to higher gas-fired power demand and broad summer coolness to lower demand.
- Forecast-combination link: Bates-Granger-style forecast combination says independent forecasts can contain useful information even when none should be selected alone. This lane tests equal-weight and train-only inverse-error-shrunk source weights.
- Weather-risk-premium link: published natural-gas event studies report that U.S. natural gas futures react to forecasted temperatures and temperature shocks.
- Overreaction link: the fade leg is a constrained contrarian response to large weather-window UNG moves, not a standalone price-only reversal.
- Overfit control: candidate rank uses train and validation only. Holdout after 2025-01-01 is reported after selection, and a deterministic block-bootstrap reality check is run on daily active return versus the index fallback.

## Selected Candidate

- Architecture: Forecast follow plus overreaction fade.
- Source set: GFS single-source cooling signal.
- Source weighting: train-only inverse forecast-error shrinkage.
- Weather leg: 0.15x max UNG overlay for 3 trading day(s), short for broad summer coolness and long for broad summer heat.
- Reversion leg: 0.2x max UNG overlay for 1 trading day(s) after a 2% realized UNG move, opposite the realized move.
- Sizing: vol-target, 24% annualized UNG volatility target.
- Signal gates: absolute forecast anomaly >= 3F; side coverage >= 0.35; confidence >= 0.35; source groups >= 1; model families >= 1.
- Cost: 0.064% round trip, charged as 0.032% one-way on UNG position changes.
- Selection: candidate rank used train and validation only. Holdout rows after 2025-01-01 were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 231 | 24.96% | 24.48% | 0.48% | 7.76% | 0.49 | 0.74 | -27.42% | 1.6% |
| Validation | 93 | 19.65% | 18.88% | 0.77% | 19.72% | 1.36 | 1.85 | -9.33% | 1.7% |
| Holdout | 85 | 27.02% | 29.38% | -2.36% | 18.33% | 1.01 | 1.36 | -19.78% | 1.2% |
| Full | 409 | 89.9% | 91.47% | -1.57% | 12.57% | 0.76 | 1.09 | -27.42% | 1.5% |

## Executed Leg Rows

| split | follow | reversion | summer-cold-short | summer-heat-long | reversion-long | reversion-short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train/validation | 279 | 45 | 12 | 267 | 23 | 22 |
| Holdout | 76 | 9 | 7 | 69 | 5 | 4 |

## Side Checks

Train/validation side gates used for selection:

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Summer cold-short | 12 | 0.53% | 0.88 | -2.29% |
| Summer heat-long | 267 | 1.65% | 0.18 | -20.18% |
| Weather follow combined | 279 | 2.18% | 0.2 | -20.41% |
| Reversion-long | 23 | 12.04% | 8.08 | -2.15% |
| Reversion-short | 22 | -1.13% | -0.79 | -4.42% |
| Weather reversion combined | 45 | 10.78% | 3.71 | -4.41% |

## Anti-Overfit Check

- Candidate search count: 27648.
- Eligible dual-leg candidates: 12.
- Block-bootstrap p-value versus index daily active return: 1.
- Bootstrap setup: 1200 iterations, 10-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| summer-gfs-single-bg-shrink-a3-c0.35-q0.35-wf0.15-rf0.2-fh3-rh1-mv2-vol24-vol-target | yes | 50.7277 | 0.48% | 0.77% | -2.36% | -1.57% | 409 |
| summer-gfs-single-bg-shrink-a3-c0.35-q0.35-wf0.25-rf0.2-fh3-rh1-mv2-vol24-vol-target | yes | 50.3302 | 0.8% | 0.46% | -3.59% | -3.39% | 409 |
| summer-gfs-single-equal-a3-c0.35-q0.35-wf0.15-rf0.2-fh3-rh1-mv2-vol24-vol-target | yes | 50.2957 | 0.28% | 0.67% | -2.19% | -1.77% | 398 |
| summer-gfs-single-equal-a3-c0.35-q0.35-wf0.25-rf0.2-fh3-rh1-mv2-vol24-vol-target | yes | 49.8542 | 0.47% | 0.48% | -3.61% | -3.9% | 398 |
| summer-gfs-single-bg-shrink-a3-c0.35-q0.35-wf0.15-rf0.2-fh3-rh1-mv2-vol18-vol-target | yes | 49.6687 | 0.13% | 0.49% | -1.78% | -1.67% | 409 |
| summer-gfs-single-bg-shrink-a3-c0.35-q0.35-wf0.15-rf0.1-fh3-rh1-mv2-vol24-vol-target | yes | 49.3837 | 0.51% | 0.17% | -2.11% | -2.09% | 409 |
| summer-gfs-single-equal-a3-c0.35-q0.35-wf0.15-rf0.1-fh3-rh1-mv2-vol24-vol-target | yes | 49.1787 | 0.31% | 0.2% | -2.17% | -2.43% | 398 |
| summer-gfs-single-bg-shrink-a3-c0.35-q0.35-wf0.25-rf0.2-fh3-rh1-mv2-vol18-vol-target | yes | 49.1107 | 0.38% | 0.19% | -2.7% | -3.12% | 409 |
| summer-gfs-single-bg-shrink-a3-c0.35-q0.35-wf0.15-rf0.1-fh3-rh1-mv2-vol0-confidence-scaled | yes | 48.9227 | 0.17% | 0.32% | -4.35% | -5.71% | 409 |
| summer-gfs-single-bg-shrink-a3-c0.35-q0.35-wf0.15-rf0.1-fh3-rh1-mv2-vol18-vol-target | yes | 48.7847 | 0.27% | 0.03% | -1.58% | -1.89% | 409 |
| summer-gfs-single-equal-a3-c0.35-q0.35-wf0.25-rf0.2-fh3-rh1-mv2-vol18-vol-target | yes | 48.6807 | 0.09% | 0.21% | -2.72% | -3.58% | 398 |
| summer-gfs-single-equal-a3-c0.35-q0.35-wf0.15-rf0.1-fh3-rh1-mv2-vol18-vol-target | yes | 48.5982 | 0.1% | 0.06% | -1.63% | -2.18% | 398 |

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. It satisfies the two-leg requirement on train/validation, stays invested through the index basket when weather confidence is low, and is selected without looking at the holdout. Promotion depends on the holdout edge and block-bootstrap p-value staying credible as more cooling-season evidence accumulates.
