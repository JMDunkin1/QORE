# NGAS Summer Alpha Lane

Generated at 2026-06-12T20:29:27.597Z.

## Purpose

This is the NGAS Summer Alpha cooling-season research strategy. It explicitly requires both active legs: a multi-model summer heat-demand follow trade and a same-direction post-move overreaction fade. Capital that is not assigned to gas stays in the diversified US index basket.

## Research Basis

- Demand link: EIA treats cooling degree days as the measure of air-conditioning need, so this lane maps broad summer warmth to higher gas-fired power demand and broad summer coolness to lower demand.
- Forecast-combination link: Bates-Granger-style forecast combination says independent forecasts can contain useful information even when none should be selected alone. This lane tests equal-weight and train-only inverse-error-shrunk source weights.
- Weather-risk-premium link: published natural-gas event studies report that U.S. natural gas futures react to forecasted temperatures and temperature shocks.
- Freshness link: the heat-follow leg only buys the first broad heat signal after a quiet period, because repeated heat forecasts are more likely already priced.
- Overreaction link: the fade leg is a constrained contrarian response only when gas first moves in the weather-demand direction, not a standalone price-only reversal.
- Overfit control: candidate rank uses train and validation only. Holdout after 2025-01-01 is reported after selection, and a deterministic block-bootstrap reality check is run on daily active return versus the index fallback.

## Selected Candidate

- Architecture: Confirmed heat follow plus same-direction fade.
- Source set: GFS plus GEFS mean.
- Source weighting: equal forecast weights.
- Weather leg: 0.25x max NG futures overlay for 3 trading day(s), long only on fresh broad summer heat after 3 quiet calendar day(s). Cool-short rows remain diagnostic until the data produces enough confirmed cool events.
- Reversion leg: 0.3x max NG futures overlay for 1 trading day(s) after a 2% realized same-direction gas move, opposite the weather-driven move.
- Sizing: fixed.
- Signal gates: absolute forecast anomaly >= 5F; side coverage >= 0.25; confidence >= 0.5; source groups >= 1; model families >= 2; heat-follow freshness lookback 3 calendar day(s).
- Cost: 0.064% round trip, charged as 0.032% one-way on gas position changes.
- Selection: candidate rank used train and validation only. Holdout rows after 2025-01-01 were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 136 | 50.92% | 24.48% | 26.44% | 14.8% | 0.8 | 1.24 | -23.72% | 4.8% |
| Validation | 45 | 35.23% | 18.88% | 16.35% | 35.37% | 1.95 | 3.1 | -9.35% | 4.8% |
| Holdout | 46 | 49.46% | 29.38% | 20.08% | 32.69% | 1.56 | 2.22 | -19.78% | 3.4% |
| Full | 227 | 205.04% | 91.47% | 113.57% | 22.87% | 1.19 | 1.78 | -23.72% | 4.4% |

## Executed Leg Rows

| split | follow | reversion | summer-cold-short | summer-heat-long | reversion-long | reversion-short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train/validation | 121 | 60 | 0 | 121 | 0 | 60 |
| Holdout | 32 | 14 | 0 | 32 | 0 | 14 |

## Side Checks

Train/validation side gates used for selection:

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Summer cold-short diagnostic | 0 | 0% | 0 | 0% |
| Summer heat-long | 121 | 35.52% | 2.67 | -12.64% |
| Weather follow combined | 121 | 35.52% | 2.67 | -12.64% |
| Reversion-long | 0 | 0% | 0 | 0% |
| Reversion-short | 60 | 6.76% | 1.37 | -7.25% |
| Weather reversion combined | 60 | 6.76% | 1.37 | -7.25% |

## Anti-Overfit Check

- Candidate search count: 41472.
- Eligible dual-leg candidates: 1904.
- Skipped clustered heat-follow signals: 227.
- Block-bootstrap p-value versus index daily active return: 0.005.
- Bootstrap setup: 1200 iterations, 10-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 120.5501 | 26.44% | 16.35% | 20.08% | 113.57% | 227 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 120.5501 | 26.44% | 16.35% | 20.08% | 113.57% | 227 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 117.4071 | 24.09% | 16.35% | 20.08% | 108.82% | 227 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 117.4071 | 24.09% | 16.35% | 20.08% | 108.82% | 227 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.25-rf0.2-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 116.0636 | 26.59% | 14.25% | 16.88% | 102.7% | 227 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.25-rf0.2-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 116.0636 | 26.59% | 14.25% | 16.88% | 102.7% | 227 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.2-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 112.8406 | 24.24% | 14.25% | 16.88% | 98.12% | 227 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.2-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 112.8406 | 24.24% | 14.25% | 16.88% | 98.12% | 227 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.25-rf0.1-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 111.0331 | 26.62% | 12.14% | 13.74% | 91.87% | 227 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.25-rf0.1-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 111.0331 | 26.62% | 12.14% | 13.74% | 91.87% | 227 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.1-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 107.8811 | 24.26% | 12.14% | 13.74% | 87.45% | 227 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.1-fh3-rh1-mv2-fresh3-vol0-fixed | yes | 107.8811 | 24.26% | 12.14% | 13.74% | 87.45% | 227 |

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. It fixes the prior underperformance by using the futures-grade gas series, requiring multi-model confirmation, buying only fresh broad heat signals, and fading same-direction heat overreactions. The cool-short side remains diagnostic until there are enough confirmed cooling-season cool events to validate it without overfitting.
