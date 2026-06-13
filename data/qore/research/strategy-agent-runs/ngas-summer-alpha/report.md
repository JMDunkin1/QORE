# NGAS Summer Alpha Lane

Generated at 2026-06-13T05:05:50.099Z.

## Purpose

This is the NGAS Summer Alpha cooling-season research strategy. It explicitly requires both active legs: a multi-model summer heat-demand follow trade and a same-direction post-move overreaction fade. Capital that is not assigned to gas stays in the diversified US index basket.

## Research Basis

- Demand link: EIA treats cooling degree days as the measure of air-conditioning need, so this lane maps broad summer warmth to higher gas-fired power demand and broad summer coolness to lower demand.
- Forecast-combination link: Bates-Granger-style forecast combination says independent forecasts can contain useful information even when none should be selected alone. This lane tests equal-weight and train-only inverse-error-shrunk source weights.
- Weather-risk-premium link: published natural-gas event studies report that U.S. natural gas futures react to forecasted temperatures and temperature shocks.
- Freshness link: the heat-follow leg only buys the first broad heat signal after a quiet period, because repeated heat forecasts are more likely already priced.
- Storage-deficit link: the heat-follow leg gets a modest size tilt only when lagged EIA Lower 48 storage is below its trailing 5-year seasonal norm, because summer heat should matter more when the supply cushion is thinner.
- Overreaction link: the fade leg is a constrained contrarian response only when gas first moves in the weather-demand direction, not a standalone price-only reversal.
- Cooling-demand fade sizing link: the fade can size heat-rally shorts by forecast CDD anomaly, because CDD is closer to summer power-sector gas burn than raw temperature anomaly alone.
- Storage-aware fade link: heat-driven rallies are not faded when lagged Lower 48 storage is below its trailing seasonal norm, because a tight balance sheet can let weather risk persist.
- Overfit control: candidate rank uses train and validation only. Holdout after 2025-01-01 is reported after selection, and a deterministic block-bootstrap reality check is run on daily active return versus the index fallback.

## Selected Candidate

- Architecture: Confirmed heat follow plus storage-aware same-direction fade.
- Source set: GFS plus GEFS mean.
- Source weighting: equal forecast weights.
- Weather leg: 0.35x max NG futures overlay for 3 trading day(s), long only on fresh broad summer heat after 3 quiet calendar day(s). Cool-short rows remain diagnostic until the data produces enough confirmed cool events.
- Storage tilt: fresh heat-follow rows are scaled by 1.25x, capped at 0.4375x notional, only when EIA storage available with a 7-calendar-day lag is below its trailing 5-year seasonal average.
- Reversion leg: 0.35x max NG futures overlay for 1 trading day(s) after a 2% realized same-direction gas move, opposite the weather-driven move. Heat-rally fades are skipped when lagged storage is below its trailing seasonal norm.
- Reversion demand sizing: cooling-demand tiered sizing: CDD anomaly < 5F trims the fade, 5-8F modestly adds size, and >= 8F can lift the fade up to 0.5x.
- Sizing: fixed.
- Signal gates: absolute forecast anomaly >= 5F; side coverage >= 0.25; confidence >= 0.5; source groups >= 1; model families >= 2; heat-follow freshness lookback 3 calendar day(s).
- Cost: 0.064% round trip, charged as 0.032% one-way on gas position changes.
- Selection: candidate rank used train and validation only. Holdout rows after 2025-01-01 were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 107 | 83.73% | 24.48% | 59.25% | 22.63% | 1.08 | 1.65 | -20.03% | 5.8% |
| Validation | 45 | 43.8% | 18.88% | 24.92% | 43.98% | 2.08 | 3.65 | -9.37% | 6.6% |
| Holdout | 45 | 58% | 29.38% | 28.62% | 37.98% | 1.68 | 2.49 | -19.78% | 4.9% |
| Full | 197 | 317.48% | 91.47% | 226.01% | 30.2% | 1.4 | 2.16 | -20.15% | 5.7% |

## Executed Leg Rows

| split | follow | reversion | summer-cold-short | summer-heat-long | reversion-long | reversion-short |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train/validation | 122 | 30 | 0 | 122 | 0 | 30 |
| Holdout | 33 | 12 | 0 | 33 | 0 | 12 |

## Side Checks

Train/validation side gates used for selection:

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Summer cold-short diagnostic | 0 | 0% | 0 | 0% |
| Summer heat-long | 122 | 58.53% | 3.08 | -12.37% |
| Weather follow combined | 122 | 58.53% | 3.08 | -12.37% |
| Reversion-long | 0 | 0% | 0 | 0% |
| Reversion-short | 30 | 12.43% | 4.54 | -7.54% |
| Weather reversion combined | 30 | 12.43% | 4.54 | -7.54% |

## Anti-Overfit Check

- Candidate search count: 103680.
- Eligible dual-leg candidates: 8648.
- Skipped clustered heat-follow signals: 227.
- Storage-deficit boosted heat-follow rows: 68.
- Cooling-demand-sized reversion rows: 42.
- Block-bootstrap p-value versus index daily active return: 0.0008.
- Bootstrap setup: 1200 iterations, 10-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 169.1241 | 59.25% | 24.92% | 28.62% | 226.01% | 197 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 169.1241 | 59.25% | 24.92% | 28.62% | 226.01% | 197 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.3-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 164.7456 | 57.65% | 23.62% | 27.38% | 215.35% | 197 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.35-rf0.3-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 164.7456 | 57.65% | 23.62% | 27.38% | 215.35% | 197 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 164.3131 | 55.26% | 24.92% | 28.62% | 216.94% | 197 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 164.3131 | 55.26% | 24.92% | 28.62% | 216.94% | 197 |
| summer-gfs-gefs-core-bg-shrink-a5-c0.25-q0.5-wf0.35-rf0.3-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 159.9636 | 53.69% | 23.62% | 27.38% | 206.51% | 197 |
| summer-ncep-complex-bg-shrink-a5-c0.25-q0.5-wf0.35-rf0.3-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 159.9636 | 53.69% | 23.62% | 27.38% | 206.51% | 197 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdfixed-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 158.5581 | 56.28% | 21.66% | 25.37% | 201.67% | 197 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdfixed-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 158.5581 | 56.28% | 21.66% | 25.37% | 201.67% | 197 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.2-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 155.3371 | 54.44% | 21.01% | 24.9% | 194.67% | 197 |
| summer-ncep-complex-equal-a5-c0.25-q0.5-wf0.35-rf0.2-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-sdef1.25-vol0-fixed | yes | 155.3371 | 54.44% | 21.01% | 24.9% | 194.67% | 197 |

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. It fixes the prior underperformance by using the futures-grade gas series, requiring multi-model confirmation, buying only fresh broad heat signals, and fading same-direction heat overreactions only when lagged storage is not below its trailing seasonal norm. The cool-short side remains diagnostic until there are enough confirmed cooling-season cool events to validate it without overfitting.
