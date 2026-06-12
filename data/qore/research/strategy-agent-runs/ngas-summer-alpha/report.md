# NGAS Summer Alpha Lane

Generated at 2026-06-12T02:52:01.363Z.

## Purpose

This is the NGAS Summer Alpha cooling-season research strategy. It explicitly requires both active legs: a multi-model summer heat-demand follow trade and a same-direction post-move overreaction fade. Capital that is not assigned to gas stays in the diversified US index basket.

## Research Basis

- Demand link: EIA treats cooling degree days as the measure of air-conditioning need, so this lane maps broad summer warmth to higher gas-fired power demand and broad summer coolness to lower demand.
- Forecast-combination link: Bates-Granger-style forecast combination says independent forecasts can contain useful information even when none should be selected alone. This lane tests equal-weight and train-only inverse-error-shrunk source weights.
- Weather-risk-premium link: published natural-gas event studies report that U.S. natural gas futures react to forecasted temperatures and temperature shocks.
- Overreaction link: the fade leg is a constrained contrarian response only when gas first moves in the weather-demand direction, not a standalone price-only reversal.
- Overfit control: candidate rank uses train and validation only. Holdout after 2025-01-01 is reported after selection, and a deterministic block-bootstrap reality check is run on daily active return versus the index fallback.

## Selected Candidate

- Architecture: Confirmed heat follow plus same-direction fade.
- Source set: GFS plus GEFS mean.
- Source weighting: train-only inverse forecast-error shrinkage.
- Weather leg: 0.25x max NG futures overlay for 3 trading day(s), long for broad summer heat. Cool-short rows remain diagnostic until the data produces enough confirmed cool events.
- Reversion leg: 0.3x max NG futures overlay for 1 trading day(s) after a 2% realized same-direction gas move, opposite the weather-driven move.
- Sizing: fixed.
- Signal gates: absolute forecast anomaly >= 5F; side coverage >= 0.25; confidence >= 0.5; source groups >= 1; model families >= 2.
- Cost: 0.064% round trip, charged as 0.032% one-way on gas position changes.
- Selection: candidate rank used train and validation only. Holdout rows after 2025-01-01 were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 201 | 39.5% | 24.48% | 15.02% | 11.81% | 0.65 | 0.99 | -26.11% | 6.8% |
| Validation | 79 | 34.87% | 18.88% | 15.99% | 35.01% | 1.83 | 3.08 | -11.86% | 8% |
| Holdout | 74 | 34.6% | 29.38% | 5.22% | 23.26% | 1.18 | 1.71 | -19.78% | 5.3% |
| Full | 354 | 153.23% | 91.47% | 61.76% | 18.72% | 0.98 | 1.48 | -26.11% | 6.6% |

## Executed Leg Rows

| split | follow | reversion | summer-cold-short | summer-heat-long | reversion-long | reversion-short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train/validation | 258 | 22 | 0 | 258 | 0 | 22 |
| Holdout | 68 | 6 | 0 | 68 | 0 | 6 |

## Side Checks

Train/validation side gates used for selection:

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Summer cold-short diagnostic | 0 | 0% | 0 | 0% |
| Summer heat-long | 258 | 16.3% | 0.73 | -18.71% |
| Weather follow combined | 258 | 16.3% | 0.73 | -18.71% |
| Reversion-long | 0 | 0% | 0 | 0% |
| Reversion-short | 22 | 9.98% | 5.64 | -2.66% |
| Weather reversion combined | 22 | 9.98% | 5.64 | -2.66% |

## Anti-Overfit Check

- Candidate search count: 41472.
- Eligible dual-leg candidates: 1614.
- Block-bootstrap p-value versus index daily active return: 0.0716.
- Bootstrap setup: 1200 iterations, 10-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-vol0-fixed | yes | 112.187 | 15.02% | 15.99% | 5.22% | 61.76% | 354 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-vol0-fixed | yes | 112.187 | 15.02% | 15.99% | 5.22% | 61.76% | 354 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.35-wf0.25-rf0.3-fh3-rh1-mv2-vol0-fixed | yes | 110.99 | 14.77% | 15.06% | 4.03% | 57.34% | 385 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.35-wf0.25-rf0.3-fh3-rh1-mv2-vol0-fixed | yes | 110.99 | 14.77% | 15.06% | 4.03% | 57.34% | 385 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv4-vol0-fixed | yes | 107.9473 | 11.39% | 15.99% | 4.9% | 54.58% | 350 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv4-vol0-fixed | yes | 107.9473 | 11.39% | 15.99% | 4.9% | 54.58% | 350 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.35-wf0.25-rf0.3-fh3-rh1-mv2-vol0-fixed | yes | 107.505 | 11.29% | 15.06% | 4.03% | 51.12% | 385 |
| summer-ncep-complex-equal-a5-c0.25-q0.35-wf0.25-rf0.3-fh3-rh1-mv2-vol0-fixed | yes | 107.505 | 11.29% | 15.06% | 4.03% | 51.12% | 385 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.35-wf0.25-rf0.3-fh3-rh1-mv4-vol0-fixed | yes | 106.8314 | 11.24% | 15.06% | 2.09% | 47.52% | 382 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.35-wf0.25-rf0.3-fh3-rh1-mv4-vol0-fixed | yes | 106.8314 | 11.24% | 15.06% | 2.09% | 47.52% | 382 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-vol0-fixed | yes | 105.41 | 12.13% | 14.51% | 5.22% | 53.81% | 354 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-vol0-fixed | yes | 105.41 | 12.13% | 14.51% | 5.22% | 53.81% | 354 |

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. It fixes the prior underperformance by using the futures-grade gas series, requiring multi-model confirmation, and only fading same-direction heat overreactions. The cool-short side remains diagnostic until there are enough confirmed cooling-season cool events to validate it without overfitting.
