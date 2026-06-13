# NGAS Summer Alpha Lane

Generated at 2026-06-13T01:37:54.093Z.

## Purpose

This is the NGAS Summer Alpha cooling-season research strategy. It explicitly requires both active legs: a multi-model summer heat-demand follow trade and a same-direction post-move overreaction fade. Capital that is not assigned to gas stays in the diversified US index basket.

## Research Basis

- Demand link: EIA treats cooling degree days as the measure of air-conditioning need, so this lane maps broad summer warmth to higher gas-fired power demand and broad summer coolness to lower demand.
- Forecast-combination link: Bates-Granger-style forecast combination says independent forecasts can contain useful information even when none should be selected alone. This lane tests equal-weight and train-only inverse-error-shrunk source weights.
- Weather-risk-premium link: published natural-gas event studies report that U.S. natural gas futures react to forecasted temperatures and temperature shocks.
- Freshness link: the heat-follow leg only buys the first broad heat signal after a quiet period, because repeated heat forecasts are more likely already priced.
- Storage-deficit link: the heat-follow leg gets a modest size tilt only when lagged EIA Lower 48 storage is below its trailing 5-year seasonal norm, because summer heat should matter more when the supply cushion is thinner.
- Overreaction link: the fade leg is a constrained contrarian response only when gas first moves in the weather-demand direction, not a standalone price-only reversal.
- Overfit control: candidate rank uses train and validation only. Holdout after 2025-01-01 is reported after selection, and a deterministic block-bootstrap reality check is run on daily active return versus the index fallback.

## Selected Candidate

- Architecture: Confirmed heat follow plus same-direction fade.
- Source set: GFS plus GEFS mean.
- Source weighting: equal forecast weights.
- Weather leg: 0.25x max NG futures overlay for 3 trading day(s), long only on fresh broad summer heat after 3 quiet calendar day(s). Cool-short rows remain diagnostic until the data produces enough confirmed cool events.
- Storage tilt: fresh heat-follow rows are scaled by 1.25x, capped at 0.4x notional, only when EIA storage available with a 7-calendar-day lag is below its trailing 5-year seasonal average.
- Reversion leg: 0.3x max NG futures overlay for 1 trading day(s) after a 2% realized same-direction gas move, opposite the weather-driven move.
- Sizing: fixed.
- Signal gates: absolute forecast anomaly >= 5F; side coverage >= 0.25; confidence >= 0.5; source groups >= 1; model families >= 2; heat-follow freshness lookback 3 calendar day(s).
- Cost: 0.064% round trip, charged as 0.032% one-way on gas position changes.
- Selection: candidate rank used train and validation only. Holdout rows after 2025-01-01 were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 136 | 56.85% | 24.48% | 32.37% | 16.3% | 0.86 | 1.32 | -22.75% | 5.3% |
| Validation | 45 | 35.23% | 18.88% | 16.35% | 35.37% | 1.95 | 3.1 | -9.35% | 4.8% |
| Holdout | 46 | 51.35% | 29.38% | 21.97% | 33.87% | 1.6 | 2.28 | -19.78% | 3.6% |
| Full | 227 | 221.04% | 91.47% | 129.57% | 24.03% | 1.22 | 1.84 | -22.75% | 4.7% |

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
| Summer heat-long | 121 | 40.9% | 2.85 | -12.21% |
| Weather follow combined | 121 | 40.9% | 2.85 | -12.21% |
| Reversion-long | 0 | 0% | 0 | 0% |
| Reversion-short | 60 | 6.74% | 1.36 | -7.26% |
| Weather reversion combined | 60 | 6.74% | 1.36 | -7.26% |

## Anti-Overfit Check

- Candidate search count: 41472.
- Eligible dual-leg candidates: 1974.
- Skipped clustered heat-follow signals: 227.
- Storage-deficit boosted heat-follow rows: 66.
- Block-bootstrap p-value versus index daily active return: 0.0058.
- Bootstrap setup: 1200 iterations, 10-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 126.9426 | 32.37% | 16.35% | 21.97% | 129.57% | 227 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 126.9426 | 32.37% | 16.35% | 21.97% | 129.57% | 227 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 123.6386 | 29.93% | 16.35% | 21.97% | 124.56% | 227 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.3-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 123.6386 | 29.93% | 16.35% | 21.97% | 124.56% | 227 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.25-rf0.2-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 122.4651 | 32.53% | 14.25% | 18.73% | 118.13% | 227 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.25-rf0.2-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 122.4651 | 32.53% | 14.25% | 18.73% | 118.13% | 227 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.2-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 119.1521 | 30.08% | 14.25% | 18.73% | 113.3% | 227 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.2-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 119.1521 | 30.08% | 14.25% | 18.73% | 113.3% | 227 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.25-rf0.1-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 117.4416 | 32.56% | 12.14% | 15.55% | 106.73% | 227 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.25-rf0.1-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 117.4416 | 32.56% | 12.14% | 15.55% | 106.73% | 227 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.1-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 114.1286 | 30.11% | 12.14% | 15.55% | 102.08% | 227 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.25-rf0.1-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 114.1286 | 30.11% | 12.14% | 15.55% | 102.08% | 227 |

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. It fixes the prior underperformance by using the futures-grade gas series, requiring multi-model confirmation, buying only fresh broad heat signals, and fading same-direction heat overreactions. The cool-short side remains diagnostic until there are enough confirmed cooling-season cool events to validate it without overfitting.
