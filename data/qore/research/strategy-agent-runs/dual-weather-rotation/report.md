# Dual Weather Rotation Lane

Generated at 2026-06-11T17:47:20.699Z.

## Purpose

This is the third active QORE research strategy. It explicitly requires both requested legs: a weather-demand follow trade and a post-move overreaction fade. Capital that is not assigned to UNG stays in the diversified US index basket.

## Research Basis

- Demand link: EIA treats heating and cooling degree days as energy-demand measures, and its natural-gas weather-sensitivity work ties higher winter HDDs to higher natural gas consumption and storage withdrawals.
- Forecast-combination link: Bates-Granger-style forecast combination says independent forecasts can contain useful information even when none should be selected alone. This lane tests equal-weight and train-only inverse-error-shrunk source weights.
- Weather-risk-premium link: published natural-gas event studies report that U.S. natural gas futures react to forecasted temperatures and temperature shocks.
- Overreaction link: the fade leg is a constrained contrarian response to large weather-window UNG moves, not a standalone price-only reversal.
- Overfit control: candidate rank uses train and validation only. Holdout after 2025-11-01 is reported after selection, and a deterministic block-bootstrap reality check is run on daily active return versus the index fallback.

## Selected Candidate

- Architecture: Forecast follow plus overreaction fade.
- Source set: NCEP complex.
- Source weighting: train-only inverse forecast-error shrinkage.
- Weather leg: 0.25x max UNG overlay for 3 trading day(s), long for broad cold and short for broad warmth.
- Reversion leg: 0.2x max UNG overlay for 2 trading day(s) after a 2% realized UNG move, opposite the realized move.
- Sizing: fixed.
- Signal gates: absolute forecast anomaly >= 5F; side coverage >= 0.5; confidence >= 0.5; source groups >= 1; model families >= 2.
- Cost: 0.064% round trip, charged as 0.032% one-way on UNG position changes.
- Selection: candidate rank used train and validation only. Holdout rows after 2025-11-01 were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 292 | 53.06% | 33.7% | 19.36% | 14.1% | 0.78 | 1.2 | -31.42% | 8.5% |
| Validation | 100 | 47.32% | 29.08% | 18.24% | 27.74% | 1.4 | 1.86 | -12.22% | 5.8% |
| Holdout | 102 | 2.01% | 10.94% | -8.93% | 3.45% | 0.27 | 0.38 | -13.97% | 16.2% |
| Full | 494 | 130.02% | 91.47% | 38.55% | 16.63% | 0.9 | 1.31 | -31.42% | 8.5% |

## Executed Leg Rows

| split | follow | reversion | cold-long | warm-short | reversion-long | reversion-short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train/validation | 280 | 112 | 45 | 235 | 57 | 55 |
| Holdout | 73 | 29 | 10 | 63 | 14 | 15 |

## Side Checks

Train/validation side gates used for selection:

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 45 | 17.89% | 4.09 | -9.1% |
| Warm-short | 235 | 29.2% | 1.43 | -12.56% |
| Weather follow combined | 280 | 52.31% | 1.9 | -12.66% |
| Reversion-long | 57 | 10.41% | 2.02 | -5.18% |
| Reversion-short | 55 | -1.95% | -0.44 | -6.18% |
| Weather reversion combined | 112 | 8.25% | 0.98 | -7.12% |

## Anti-Overfit Check

- Candidate search count: 8192.
- Eligible dual-leg candidates: 92.
- Block-bootstrap p-value versus index daily active return: 0.209.
- Bootstrap setup: 1200 iterations, 10-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dual-ncep-complex-bg-shrink-a5-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-vol0-fixed | yes | 106.7047 | 19.36% | 18.24% | -8.93% | 38.55% | 494 |
| dual-ncep-complex-bg-shrink-a5-c0.5-q0.35-wf0.25-rf0.2-fh3-rh2-mv2-vol0-fixed | yes | 104.2666 | 17.13% | 18.24% | -8.93% | 35.19% | 497 |
| dual-ncep-complex-bg-shrink-a5-c0.5-q0.5-wf0.15-rf0.2-fh3-rh2-mv2-vol0-fixed | yes | 103.8197 | 9.11% | 21.47% | -8.49% | 28.81% | 494 |
| dual-ncep-complex-bg-shrink-a5-c0.35-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-vol0-fixed | yes | 102.6572 | 9.47% | 21.32% | -9.86% | 26.2% | 532 |
| dual-ncep-complex-bg-shrink-a5-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-vol0-confidence-scaled | yes | 101.5082 | 15.14% | 17.68% | -8.78% | 31.68% | 494 |
| dual-ncep-complex-bg-shrink-a5-c0.5-q0.35-wf0.15-rf0.2-fh3-rh2-mv2-vol0-fixed | yes | 101.1931 | 6.77% | 21.47% | -8.49% | 25.2% | 497 |
| dual-ncep-complex-bg-shrink-a5-c0.35-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-vol0-confidence-scaled | yes | 101.0757 | 8.61% | 20.92% | -9.6% | 24.85% | 532 |
| dual-ncep-complex-bg-shrink-a5-c0.5-q0.35-wf0.25-rf0.2-fh3-rh2-mv2-vol0-confidence-scaled | yes | 100.8966 | 14.3% | 17.68% | -8.78% | 30.41% | 497 |
| dual-ncep-complex-bg-shrink-a5-c0.5-q0.5-wf0.15-rf0.2-fh3-rh2-mv2-vol0-confidence-scaled | yes | 100.2297 | 6.51% | 20.98% | -8.41% | 24.25% | 494 |
| dual-ncep-complex-bg-shrink-a5-c0.35-q0.35-wf0.25-rf0.2-fh3-rh2-mv2-vol0-confidence-scaled | yes | 99.8118 | 6.74% | 20.92% | -9.6% | 22.01% | 540 |
| dual-ncep-complex-bg-shrink-a5-c0.5-q0.35-wf0.15-rf0.2-fh3-rh2-mv2-vol0-confidence-scaled | yes | 99.4596 | 5.61% | 20.98% | -8.41% | 22.87% | 497 |
| dual-ncep-complex-bg-shrink-a5-c0.35-q0.5-wf0.15-rf0.2-fh3-rh2-mv2-vol0-fixed | yes | 99.1687 | 2.16% | 22.79% | -9.05% | 18.78% | 532 |

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. It satisfies the two-leg requirement on train/validation, stays invested through the index basket when weather confidence is low, and is selected without looking at the holdout. The newest holdout trails the index fallback and the block-bootstrap p-value is weak, so live routing should stay disabled until paper evidence accumulates.
