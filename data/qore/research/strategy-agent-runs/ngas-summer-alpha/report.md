# NGAS Summer Alpha Lane

Generated at 2026-06-13T19:24:38.927Z.

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
- Close-in weather-resolution fade check: none.
- Sizing: fixed.
- Signal gates: absolute forecast anomaly >= 5F; side coverage >= 0.25; confidence >= 0.5; source groups >= 1; model families >= 2; heat-follow freshness lookback 3 calendar day(s).
- Cost: 0.064% round trip, charged as 0.032% one-way on gas position changes.
- Selection: candidate rank used train and validation only. Holdout rows after 2025-01-01 were not used to choose the candidate.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 107 | 96.6% | 33.45% | 63.15% | 25.45% | 1.19 | 1.78 | -19.18% | 5.8% |
| Validation | 45 | 50.6% | 25.17% | 25.43% | 50.82% | 2.37 | 4.13 | -9.57% | 6.6% |
| Holdout | 45 | 60.16% | 31.21% | 28.95% | 38.69% | 1.73 | 2.48 | -19.5% | 4.8% |
| Full | 197 | 374.22% | 119.17% | 255.05% | 33.16% | 1.53 | 2.29 | -19.5% | 5.7% |

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
| Summer heat-long | 122 | 59.07% | 3.12 | -12.64% |
| Weather follow combined | 122 | 59.07% | 3.12 | -12.64% |
| Reversion-long | 0 | 0% | 0 | 0% |
| Reversion-short | 30 | 12.91% | 4.6 | -7.61% |
| Weather reversion combined | 30 | 12.91% | 4.6 | -7.61% |

## Anti-Overfit Check

- Candidate search count: 2.
- Eligible dual-leg candidates: 2.
- Skipped clustered heat-follow signals: 227.
- Storage-deficit boosted heat-follow rows: 68.
- Cooling-demand-sized reversion rows: 42.
- Close-in weather-resolution adjusted rows: 0.
- Close-in weather-resolution dropped rows: 0.
- Close-in weather-resolution comparison: current active Summer Alpha family with no close-in fade check versus graded close-in fade check.
- Primary block-bootstrap p-value versus index daily active return: 0.0017 (rank-window selection-adjusted centered circular block bootstrap).
- Single-candidate p-value: 0.0008.
- Selection-adjusted p-value: 0.0017 across 2 near-top eligible candidates.
- Bootstrap setup: 1200 iterations, 10-session circular blocks.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | weather resolution | train edge | validation edge | holdout edge | full edge | executed rows |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-wrnone-sdef1.25-vol0-fixed | yes | 179.9611 | none | 63.15% | 25.43% | 28.95% | 255.05% | 197 |
| summer-gfs-gefs-core-equal-a5-c0.25-q0.5-wf0.35-rf0.35-rdcooling-demand-tiered-fh3-rh1-mv2-fresh3-wrgraded-shift-sdef1.25-vol0-fixed | yes | 179.9611 | graded-shift | 63.15% | 25.43% | 28.95% | 255.05% | 197 |

## Verdict

Load this as an active needs-more-validation strategy, not broker-ready. It fixes the prior underperformance by using the futures-grade gas series, requiring multi-model confirmation, buying only fresh broad heat signals, and fading same-direction heat overreactions only when lagged storage is not below its trailing seasonal norm. The cool-short side remains diagnostic until there are enough confirmed cooling-season cool events to validate it without overfitting.
