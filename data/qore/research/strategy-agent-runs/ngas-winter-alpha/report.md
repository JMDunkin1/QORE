# NGAS Winter Alpha

Generated at 2026-06-13T05:37:21.410Z.

## Purpose

This active QORE research strategy is self-contained around frozen Winter Alpha input ledgers: the embedded weather-follow input supplies cold/warm forecast-follow context, the embedded weather-reversion input supplies post-window reversion context, and the embedded volatility-confirmation input can confirm same-direction overreaction fades. Optional weather-resolution overlays test whether close-in or already-known actual weather shifted enough to support the fade, and optional EIA storage-drawdown gates test whether cold-follow longs are allowed only after the withdrawal season has consumed enough inventory. The selected blend is ranked on train/validation only, with holdout reported after selection.

## Selected Candidate

- Architecture: Short fade plus cold follow and vol-confirmed long fade + Grade reversion size and veto adverse standalone fades + Cold-follow requires 400 Bcf storage drawdown + 1.25x gas-overlay risk budget.
- Frozen inputs: weather-follow, weather-reversion, and volatility-confirmation ledgers stored under the NGAS Winter Alpha lane.
- Position policy: Take frozen cold-follow setups directly; keep frozen reversion-short setups, adding frozen warm-short exposure when both embedded experts point short, and add frozen reversion-long setups only when volatility confirmation agrees with the same long-fade direction. Weather-resolution overlay: Scale confirmed reversion exposure up, shrink confirmed fades when close-in weather argues against them, and drop unconfirmed standalone fades when close-in weather still supports the original move. Storage gate: Allow cold-follow gas longs only after the standard EIA storage release date has confirmed at least a 400 Bcf drawdown from the current withdrawal-season peak. Portfolio risk-budget overlay: scale active gas exposure by 1.25x, capped at 0.6x, without changing signal selection.
- Max weather UNG overlay: 0.45x; frozen weather-follow leg 0.25x and weather-reversion leg 0.2x.
- Winter-alpha hold overlay: Frozen-input selected hold periods. Keep the frozen daily ledgers unchanged; the embedded weather-follow and weather-reversion inputs already selected their own hold periods.
- Effective frozen-ledger holds: forecast-follow 3 trading day(s), post-window reversion 2 trading day(s).
- Gas-overlay risk multiplier: 1.25x; effective max weather UNG overlay 0.5625x.
- Vol-confirmed reversion-long size: 1x of the frozen reversion leg.
- Standalone reversion fade size: 1x of the frozen reversion leg when no same-direction follow signal confirms it.
- Weather-resolution overlay: Grade reversion size and veto adverse standalone fades. Scale confirmed reversion exposure up, shrink confirmed fades when close-in weather argues against them, and drop unconfirmed standalone fades when close-in weather still supports the original move.
- Cold-follow storage gate: Cold-follow requires 400 Bcf storage drawdown. Allow cold-follow gas longs only after the standard EIA storage release date has confirmed at least a 400 Bcf drawdown from the current withdrawal-season peak.
- Idle capital risk mode: Full index fallback for idle capital.
- Cost: 0.064% round trip, charged as 0.032% one-way on UNG position changes.
- Selection: Only predeclared frozen-input blend policies, daily-ledger hold overlays, cold-follow EIA storage-drawdown gates, and bounded gas-overlay risk multipliers are selected on train and validation. Generic idle-index risk-off variants are reported as diagnostics only, and holdout rows after 2025-11-01 are reported after selection.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 117 | 81.03% | 33.7% | 47.33% | 20.19% | 1.03 | 1.64 | -22.04% | 5.2% |
| Validation | 41 | 53.97% | 29.08% | 24.89% | 31.35% | 1.49 | 2.07 | -14.79% | 3.8% |
| Holdout | 42 | 37.22% | 10.94% | 26.28% | 71.6% | 2.48 | 3.11 | -10.64% | 10.1% |
| Full | 200 | 282.46% | 91.47% | 190.99% | 28.11% | 1.34 | 1.99 | -22.04% | 5.3% |

## Train/Validation Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 29 | 28.25% | 9 | -2.08% |
| Warm-short | 58 | 16.35% | 2.19 | -8.03% |
| Reversion-long | 34 | 21.43% | 5.04 | -5.14% |
| Reversion-short | 97 | 27.26% | 2.39 | -5.96% |
| Long-side combined | 61 | 48.27% | 6.23 | -5.14% |
| Short-side combined | 97 | 27.26% | 2.39 | -5.96% |

## Full Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 36 | 34.36% | 6.24 | -7.23% |
| Warm-short | 75 | 40.01% | 3.58 | -8.03% |
| Reversion-long | 43 | 24.78% | 4.95 | -5.14% |
| Reversion-short | 123 | 51.35% | 3.1 | -5.96% |
| Long-side combined | 77 | 59.63% | 5.23 | -7.4% |
| Short-side combined | 123 | 51.35% | 3.1 | -5.96% |
| Index fallback | 1162 | 58.31% | 0.65 | -27.32% |

## Anti-Overfit Check

- Candidate count: 642.
- Eligible candidates: 608.
- Eligibility requires a selectable gas-alpha policy, positive train and validation edge, lower train and validation drawdown than the index basket, and train/validation volatility under a 20% annualized risk budget.
- Index risk-off variants are diagnostic-only because they can create cash-flat equity shelves and are a portfolio overlay rather than a gas-alpha rule.
- Weather-resolution overlays use GFS/GEFS lead-1 to lead-3 forecasts available by the trade date, or target-day actual weather only when the target date is already before the trade date.
- Cold-follow storage gates use EIA Lower 48 working gas storage rows on or after the standard 10:30 a.m. ET Thursday release date, normally six calendar days after the Friday week-ending storage date. The seasonal drawdown is measured from the current withdrawal-season storage peak.
- Hold-period overlays only shorten frozen daily ledger holds for the selected graded vol-confirmed family; they do not create new weather signals, extend an input hold, alter forecast thresholds, or use holdout rows for selection.
- Gas-overlay risk multipliers are predeclared sizing variants on the selected graded vol-confirmed family only; they do not change entry dates, directions, frozen input signals, or weather thresholds.
- Holdout was not used for selection: yes.
- Primary p-value: 0.0075 (selection-adjusted centered circular block bootstrap).
- Single-candidate p-value: 0.0058.
- Selection-adjusted p-value: 0.0075 across 608 eligible candidates.
- Observed active edge: 0.05242% per day / 13.21% annualized.
- Mean daily-edge 90% bootstrap interval: 0.02444% to 0.08436%.
- Zero-edge null 90% interval: -0.02798% to 0.03194%.
- Bootstrap setup: 1200 iterations, 10-session circular blocks, minimum resolvable p-value 0.0008.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | hold | storage gate | risk mult | rank | train edge | validation edge | holdout edge | full edge | Sharpe | maxDD |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 138.8122 | 47.33% | 24.89% | 26.28% | 190.99% | 1.34 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 137.5858 | 33.49% | 31.38% | 10.76% | 135.03% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 136.8252 | 48.27% | 22.77% | 25.72% | 186.15% | 1.34 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 136.0497 | 45.26% | 23.84% | 25.17% | 181.02% | 1.33 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 135.5768 | 35.2% | 28.8% | 10.27% | 131.77% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 134.7352 | 49.19% | 20.67% | 25.17% | 181.29% | 1.33 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 134.6148 | 32.09% | 30.02% | 10.36% | 128.47% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 134.0207 | 46.15% | 21.82% | 24.64% | 176.48% | 1.32 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 133.4153 | 36.91% | 26.25% | 9.78% | 128.46% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-125 | no | parent-selected | none | 1.25x | 133.2123 | 41.14% | 25.03% | 20.37% | 162.34% | 1.25 | -23.66% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 133.0897 | 43.21% | 22.8% | 24.06% | 171.26% | 1.32 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 133.0493 | 29.43% | 30.75% | 21.73% | 154.43% | 1.26 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 132.6748 | 33.72% | 27.56% | 9.89% | 125.39% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 132.5882 | 50.09% | 18.59% | 24.61% | 176.42% | 1.32 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-125 | yes | parent-selected | none | 1.25x | 132.2698 | 42.95% | 22.56% | 19.84% | 158.85% | 1.25 | -22.9% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 132.0977 | 47.02% | 19.82% | 24.11% | 171.92% | 1.31 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 131.777 | 41.34% | 23.06% | 25.29% | 171.33% | 1.3 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 131.6786 | 28.25% | 30.52% | 13.81% | 130.96% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 131.6398 | 30.7% | 28.66% | 9.94% | 122.02% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-125 | yes | parent-selected | none | 1.25x | 131.4448 | 44.76% | 20.12% | 19.31% | 155.32% | 1.24 | -22.14% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 131.2133 | 38.62% | 23.73% | 9.29% | 125.11% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 131.1412 | 44.04% | 20.87% | 23.56% | 167.01% | 1.31 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 131.0053 | 39.4% | 23.99% | 19.53% | 154.24% | 1.24 | -23.43% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 130.9238 | 31.1% | 28.18% | 21.19% | 150.97% | 1.25 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 130.6313 | 35.35% | 25.13% | 9.41% | 122.27% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 130.4955 | 42.24% | 21.61% | 24.75% | 168.26% | 1.3 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 130.4048 | 28.23% | 29.42% | 20.83% | 146.73% | 1.24 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 130.0863 | 41.12% | 21.63% | 19.03% | 150.96% | 1.24 | -22.7% |
| ngas-alpha-fade-primary-confirmed-follow-risk-off | no | parent-selected | none | 1x | 130.0541 | 0.45% | 28.29% | 7.08% | 57.69% | 1.21 | -27.94% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 130.0367 | 41.17% | 21.76% | 22.96% | 161.72% | 1.3 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 130.0312 | 47.88% | 17.83% | 23.58% | 167.35% | 1.3 | -22.06% |
| ngas-alpha-net-additive-parent-overlay | no | parent-selected | none | 1x | 130.0236 | 22.94% | 26.55% | -1.06% | 76.41% | 1.04 | -31.21% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 129.7878 | 32.25% | 26.32% | 9.49% | 119.12% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-125 | yes | parent-selected | none | 1.25x | 129.6858 | 46.57% | 17.7% | 18.77% | 151.74% | 1.24 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 129.6614 | 28.25% | 29.13% | 12.91% | 125.86% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 129.6391 | 29.92% | 27.55% | 15.9% | 133.58% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 129.5471 | 29.91% | 27.95% | 13.3% | 127.74% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 129.2736 | 28.24% | 28.86% | 20.78% | 145.41% | 1.24 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 129.215 | 43.13% | 20.16% | 24.19% | 165.15% | 1.29 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 129.1717 | 44.87% | 18.96% | 23.05% | 162.75% | 1.3 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 129.1703 | 42.84% | 19.29% | 18.52% | 147.63% | 1.23 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 129.1045 | 39.57% | 22.09% | 24.23% | 162.59% | 1.29 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 128.9966 | 27.09% | 29.2% | 13.26% | 124.62% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 128.9078 | 32.77% | 25.64% | 20.65% | 147.47% | 1.24 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 128.6948 | 29.32% | 27.32% | 9.53% | 115.68% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 128.6648 | 37.67% | 22.94% | 18.71% | 146.28% | 1.23 | -23.3% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 128.5448 | 36.97% | 22.72% | 8.94% | 119.11% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 128.5094 | 29.91% | 27.25% | 12.41% | 124.03% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 128.4513 | 29.82% | 26.97% | 20.32% | 143.47% | 1.24 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 128.2472 | 41.95% | 19.93% | 22.48% | 157.76% | 1.29 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 128.1216 | 29.9% | 26.98% | 20.25% | 143.46% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 128.0065 | 40.42% | 20.71% | 23.71% | 159.71% | 1.28 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 127.9013 | 33.79% | 24.01% | 9.04% | 116.18% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 127.8886 | 30.74% | 27.29% | 10.84% | 121.67% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 127.8708 | 27.03% | 28.1% | 19.93% | 139.17% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 127.8415 | 44.01% | 18.71% | 23.64% | 161.99% | 1.28 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 127.7893 | 39.3% | 20.69% | 18.22% | 143.2% | 1.23 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 127.5456 | 31.59% | 25.02% | 15.39% | 130.31% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 127.5286 | 31.57% | 25.42% | 12.8% | 124.47% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 127.3112 | 45.68% | 17.07% | 22.55% | 158.47% | 1.29 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 127.2978 | 44.55% | 16.98% | 18.01% | 144.26% | 1.23 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 127.1901 | 28.71% | 26.37% | 15.27% | 127.17% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 127.1789 | 31.57% | 25.38% | 11.91% | 122.14% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 127.0244 | 27.09% | 27.87% | 12.41% | 119.81% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 126.8498 | 30.78% | 25.1% | 9.1% | 112.94% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 126.8261 | 28.67% | 26.75% | 12.78% | 121.58% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 126.7581 | 31.56% | 25.11% | 19.71% | 141.45% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 126.7431 | 27.1% | 27.61% | 19.92% | 138.24% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 126.728 | 41.27% | 19.32% | 23.18% | 156.78% | 1.28 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 126.6433 | 40.92% | 18.47% | 17.74% | 140.07% | 1.22 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 126.6063 | 34.44% | 23.13% | 20.12% | 143.92% | 1.24 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 126.539 | 39.41% | 22.52% | 26.45% | 169.09% | 1.31 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 126.4455 | 37.81% | 21.13% | 23.17% | 154.03% | 1.28 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 126.4003 | 31.41% | 24.55% | 19.8% | 140.17% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 126.3208 | 35.95% | 21.9% | 17.88% | 138.48% | 1.22 | -23.18% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 126.2322 | 42.73% | 18.11% | 22% | 153.77% | 1.28 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 126.2036 | 25.94% | 27.88% | 12.72% | 118.38% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 125.8853 | 28.54% | 25.77% | 19.44% | 136.1% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 125.8679 | 33.22% | 23.52% | 11.41% | 120.18% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 125.8228 | 35.33% | 21.72% | 8.59% | 113.2% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 125.7824 | 28.67% | 26.07% | 11.93% | 118.07% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 125.7316 | 32.27% | 24.77% | 10.11% | 117.61% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 125.6006 | 28.68% | 25.82% | 19.41% | 136.4% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 125.468 | 42.1% | 17.94% | 22.65% | 153.82% | 1.27 | -22.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 125.4631 | 33.26% | 22.53% | 14.88% | 126.99% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 125.4458 | 37.48% | 19.76% | 17.42% | 135.58% | 1.22 | -22.51% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 125.4086 | 33.21% | 23.26% | 19.18% | 139.37% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 125.3321 | 33.22% | 22.91% | 12.29% | 121.16% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 125.3181 | 29.46% | 26.12% | 10.43% | 115.85% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 125.2891 | 30.3% | 23.97% | 14.78% | 124.08% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 125.2695 | 38.62% | 19.81% | 22.67% | 151.32% | 1.27 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 125.2243 | 25.83% | 26.79% | 19.04% | 131.74% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 125.0708 | 32.24% | 22.9% | 8.67% | 110.18% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 124.9201 | 27.5% | 25.21% | 14.64% | 120.86% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 124.8641 | 30.25% | 24.33% | 12.3% | 118.5% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 124.8058 | 42.54% | 16.26% | 17.25% | 136.9% | 1.22 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 124.5054 | 30.25% | 24.29% | 11.45% | 116.28% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 124.3636 | 30.25% | 24.04% | 18.91% | 134.5% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 124.3632 | 43.5% | 16.31% | 21.52% | 149.78% | 1.28 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 124.345 | 40.13% | 20.44% | 25.62% | 163.46% | 1.3 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 124.3236 | 27.44% | 25.56% | 12.26% | 115.52% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 124.2856 | 25.95% | 26.38% | 19.07% | 131.19% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 124.2303 | 32.99% | 22.15% | 19.29% | 136.83% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 124.2274 | 25.94% | 26.61% | 11.9% | 113.85% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 124.1295 | 39.41% | 18.49% | 22.17% | 148.58% | 1.26 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 124.0398 | 39.02% | 17.64% | 16.96% | 132.64% | 1.21 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 123.9913 | 30.05% | 23.47% | 18.96% | 133% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 123.972 | 37.71% | 21.58% | 25.33% | 160.44% | 1.29 | -23.15% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 123.9367 | 37.13% | 19.7% | 20.77% | 143.29% | 1.27 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 123.6566 | 33.79% | 22.29% | 9.37% | 113.54% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 123.6135 | 36.06% | 20.17% | 22.11% | 145.64% | 1.26 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 123.4238 | 27.26% | 24.58% | 18.57% | 128.87% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 123.3916 | 24.79% | 26.58% | 12.17% | 112.25% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 123.3566 | 34.92% | 20.06% | 14.36% | 123.63% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 123.3349 | 31.82% | 22.52% | 10.97% | 114.44% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 123.2656 | 31.88% | 21.58% | 14.29% | 120.95% | 1.17 | -22.04% |
| ngas-alpha-net-additive-parent-overlay-block-adverse-2f | no | parent-selected | none | 1x | 123.2418 | 35.46% | 18.57% | -1.09% | 82.91% | 1.06 | -29.99% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 123.2231 | 30.91% | 23.72% | 9.72% | 112.02% | 1.17 | -22.04% |
| ngas-alpha-dual-follow-first | no | parent-selected | none | 1x | 123.1906 | 22.57% | 21.93% | -9.1% | 48.86% | 0.94 | -31.42% |
| ngas-alpha-fade-primary-confirmed-follow | no | parent-selected | none | 1x | 123.1466 | 2.78% | 38.8% | 9.53% | 84.55% | 1.07 | -30.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 123.1419 | 27.44% | 24.9% | 11.45% | 112.21% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 123.1201 | 27.45% | 24.67% | 18.59% | 129.46% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 123.1131 | 31.82% | 22.27% | 18.39% | 132.55% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 123.0371 | 29.01% | 22.91% | 14.17% | 117.94% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 123.0148 | 33.69% | 20.72% | 8.24% | 107.38% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 122.8995 | 40.2% | 17.17% | 21.67% | 145.8% | 1.26 | -22.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 122.8098 | 26.55% | 24.66% | 8.7% | 103.29% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 122.7786 | 31.82% | 21.94% | 11.81% | 115.37% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 122.6066 | 28.18% | 24.95% | 10.01% | 110.11% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 122.5435 | 36.82% | 18.91% | 21.64% | 143.1% | 1.26 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 122.5191 | 26.29% | 24.05% | 14.01% | 114.63% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 122.3738 | 40.55% | 15.54% | 16.5% | 129.68% | 1.2 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 122.2847 | 37.82% | 18.06% | 20.34% | 139.86% | 1.26 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 122.2021 | 28.94% | 23.25% | 11.8% | 112.61% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 122.0965 | 40.84% | 18.37% | 24.79% | 157.85% | 1.28 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 122.0616 | 25.59% | 26.45% | 13.89% | 117.77% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 121.9936 | 28.95% | 22.98% | 18.1% | 127.67% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 121.9688 | 31.55% | 21.18% | 18.47% | 129.86% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 121.8485 | 38.39% | 19.59% | 24.54% | 155.16% | 1.28 | -23.15% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 121.8254 | 28.94% | 23.21% | 10.99% | 110.52% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 121.7621 | 24.81% | 25.15% | 18.22% | 124.27% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 121.6031 | 26.21% | 24.37% | 11.73% | 109.54% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 121.5203 | 28.69% | 22.39% | 18.11% | 125.96% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing | yes | parent-selected | none | 1x | 121.4183 | 32.52% | 19.83% | 16.22% | 123.29% | 1.2 | -22.94% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 121.4149 | 24.79% | 25.36% | 11.4% | 107.98% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 121.3676 | 35.3% | 19.83% | 8.64% | 109.45% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 121.364 | 37.57% | 17.66% | 21.17% | 140.54% | 1.25 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 121.3585 | 36.02% | 20.65% | 24.21% | 151.97% | 1.28 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 121.2408 | 28.74% | 24.1% | 21.92% | 139.12% | 1.23 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 121.2351 | 33.46% | 19.23% | 13.8% | 117.78% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 121.1216 | 32.35% | 21.35% | 9.02% | 108.17% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 121.0781 | 30.51% | 20.65% | 13.7% | 114.99% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 121.0753 | 27.86% | 22.67% | 8.31% | 100.88% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 121.0316 | 37.37% | 18.24% | 14.77% | 125.32% | 1.22 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 120.6979 | 30.43% | 21.52% | 10.53% | 108.78% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 120.6721 | 27.72% | 21.87% | 13.56% | 111.89% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 120.6691 | 30.44% | 21.29% | 17.61% | 125.83% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 120.6487 | 38.51% | 16.42% | 19.91% | 136.41% | 1.25 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 120.6281 | 26.23% | 23.53% | 17.76% | 122.64% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 120.5736 | 29.55% | 22.67% | 9.34% | 106.5% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 120.3719 | 26.21% | 23.74% | 10.96% | 106.43% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing | yes | parent-selected | none | 1x | 120.3613 | 33.88% | 17.91% | 15.81% | 120.75% | 1.19 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 120.192 | 38.32% | 16.4% | 20.69% | 137.94% | 1.24 | -22.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 120.1911 | 30.43% | 20.97% | 11.33% | 109.67% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 119.9216 | 27.06% | 23.95% | 13.13% | 113.76% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 119.886 | 41.54% | 16.32% | 23.96% | 152.26% | 1.27 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 119.8808 | 23.44% | 24.2% | 17.26% | 117.31% | 1.19 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 119.8601 | 26.9% | 23.8% | 9.59% | 104.47% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 119.8497 | 25.59% | 25.09% | 12.99% | 112.88% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 119.7507 | 33.48% | 22.67% | 20.53% | 142.08% | 1.21 | -25.44% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 119.7082 | 32.85% | 18.58% | 19.07% | 128.27% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 119.6871 | 24.54% | 25.32% | 13.34% | 112.15% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 119.672 | 39.07% | 17.62% | 23.75% | 149.89% | 1.27 | -23.15% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 119.5728 | 30.12% | 20.22% | 17.64% | 123.02% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 119.5516 | 27.65% | 21.92% | 17.3% | 120.96% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 119.5506 | 27.63% | 22.18% | 11.3% | 106.81% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 119.4342 | 35.12% | 17.1% | 18.44% | 127.79% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 119.3038 | 29.16% | 20.7% | 7.92% | 98.46% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 119.2935 | 36.67% | 18.75% | 23.46% | 147.01% | 1.27 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 119.2512 | 33.68% | 20.73% | 25.47% | 150.56% | 1.26 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 119.1348 | 30.25% | 21.64% | 21.11% | 134.84% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f | yes | parent-selected | none | 1x | 119.1136 | 32.75% | 18.37% | 10.42% | 106.38% | 1.14 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 119.1034 | 27.63% | 22.13% | 10.52% | 104.84% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 119.0976 | 32.01% | 18.4% | 13.23% | 112% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 119.0652 | 37.39% | 15.62% | 17.79% | 127.25% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 118.9603 | 27.55% | 23.09% | 21.01% | 132.28% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 118.8811 | 29.14% | 19.71% | 13.12% | 109.11% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 118.8501 | 33.79% | 19% | 8.32% | 104.31% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing | yes | parent-selected | none | 1x | 118.8248 | 35.24% | 16% | 15.4% | 118.19% | 1.19 | -22.6% |
| ngas-alpha-weather-hybrid-parent-risk-off | no | parent-selected | none | 1x | 118.7995 | -9.46% | 25.34% | -2.38% | 16.81% | 1.06 | -25.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 118.7852 | 39.19% | 14.79% | 19.48% | 132.95% | 1.24 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 118.7142 | 39.68% | 14.16% | 17.15% | 126.64% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 118.6785 | 34.34% | 19.71% | 23.1% | 143.67% | 1.26 | -23.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 118.6526 | 30.93% | 20.41% | 8.66% | 102.87% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 118.6122 | 35.05% | 20.24% | 19.74% | 137.81% | 1.21 | -24.76% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 118.4401 | 36.58% | 16.79% | 14.39% | 119.84% | 1.2 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 118.3706 | 29.06% | 20.32% | 16.83% | 119.23% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 118.3372 | 27.06% | 23.26% | 12.24% | 110.22% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 118.1933 | 24.72% | 22.21% | 16.84% | 114.79% | 1.19 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 118.075 | 32.58% | 18.26% | 20.02% | 129.37% | 1.23 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 118.0274 | 29.04% | 20.53% | 10.09% | 103.2% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 117.9466 | 28.21% | 21.63% | 8.95% | 101.06% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 117.8147 | 34.37% | 19.3% | 24.64% | 146.65% | 1.26 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 117.7696 | 22.49% | 24% | 11.08% | 100.26% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 117.7411 | 29.04% | 20.01% | 10.85% | 104.05% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 117.7306 | 29.23% | 21.03% | 16.08% | 119.2% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 117.7217 | 32.09% | 21.73% | 19.69% | 135.14% | 1.2 | -25.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 117.7106 | 28.54% | 21.47% | 12.38% | 109.74% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 117.6796 | 23.87% | 21.74% | 12.74% | 102.46% | 1.14 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 117.6007 | 36.62% | 17.83% | 18.94% | 133.52% | 1.2 | -24.07% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 117.5968 | 30.45% | 18.74% | 7.53% | 96% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 117.5426 | 25.94% | 22.93% | 12.62% | 108.37% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 117.413 | 39.73% | 15.66% | 22.96% | 144.64% | 1.26 | -23.15% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 117.3772 | 24.54% | 24.02% | 12.48% | 107.53% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 117.231 | 37.31% | 16.86% | 22.71% | 142.07% | 1.26 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing | yes | parent-selected | none | 1x | 117.2213 | 36.6% | 14.11% | 14.98% | 115.59% | 1.18 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 117.1878 | 27.55% | 22.29% | 20.97% | 130.5% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 117.1416 | 23.49% | 24.19% | 12.79% | 106.62% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 117.0553 | 31.75% | 19.21% | 20.31% | 130.54% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 117.0248 | 28.98% | 20.74% | 20.24% | 128.25% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25 | yes | parent-selected | none | 1x | 117.0122 | 37.08% | 13.48% | 12.73% | 109.62% | 1.16 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 117.0045 | 33.26% | 17.13% | 19.59% | 127.16% | 1.23 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 116.9722 | 28.54% | 21.44% | 11.5% | 107.51% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50 | yes | parent-selected | none | 1x | 116.9177 | 34.14% | 15.21% | 13.35% | 109.53% | 1.15 | -23.78% |
| ngas-alpha-net-additive-parent-overlay-graded-shift-sizing | no | parent-selected | none | 1x | 116.8865 | 33.95% | 16.57% | 4.62% | 90.72% | 1.09 | -29.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 116.8851 | 30.57% | 17.57% | 12.67% | 106.31% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 116.8777 | 32.26% | 19.86% | 24.39% | 143.04% | 1.25 | -23.15% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 116.8483 | 26.37% | 22.07% | 20.1% | 125.57% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f | yes | parent-selected | none | 1x | 116.8111 | 32.66% | 16.64% | 10.06% | 101.88% | 1.13 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 116.784 | 34.96% | 17.9% | 22.38% | 139.04% | 1.25 | -23.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 116.7012 | 33.59% | 19.4% | 18.93% | 131.12% | 1.2 | -24.61% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 116.5701 | 22.52% | 22.71% | 16.52% | 110.79% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 116.4886 | 32.29% | 18.17% | 7.99% | 99.23% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 116.4537 | 41.89% | 13.96% | 26.19% | 152.96% | 1.26 | -24.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 116.4263 | 25.99% | 20.25% | 16.42% | 112.25% | 1.18 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 116.2222 | 35.06% | 17.87% | 23.82% | 142.73% | 1.25 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 116.1287 | 38.18% | 15.45% | 18.15% | 129.21% | 1.19 | -23.38% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 116.0991 | 29.51% | 19.48% | 8.31% | 97.65% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75 | yes | parent-selected | none | 1x | 116.0917 | 31.23% | 16.95% | 13.97% | 109.37% | 1.15 | -24.65% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 116.04 | 33.92% | 16% | 19.16% | 124.93% | 1.22 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 116.0351 | 25.14% | 19.79% | 12.34% | 100.05% | 1.13 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 116.0051 | 23.75% | 22.01% | 10.68% | 97.88% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 115.9567 | 25.94% | 22.27% | 11.77% | 105.01% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 115.9531 | 35.79% | 15.35% | 14.02% | 114.41% | 1.19 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 115.9218 | 29.05% | 20.49% | 20.17% | 127.68% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 115.8042 | 30.71% | 20.78% | 18.85% | 128.32% | 1.19 | -25.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 115.7631 | 28.03% | 20.16% | 15.44% | 113.57% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 115.6922 | 35.07% | 17.1% | 18.17% | 127.07% | 1.19 | -23.94% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 115.6626 | 30.73% | 18.61% | 15.32% | 115.15% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 115.6609 | 22.49% | 22.9% | 10.38% | 96.5% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 115.6366 | 23.79% | 21.26% | 16.11% | 109.35% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 115.4856 | 30% | 19.03% | 11.63% | 105.7% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 115.4576 | 27.34% | 20.57% | 11.89% | 104.56% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 115.4087 | 30% | 19.63% | 10.75% | 104.77% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 115.3822 | 32.92% | 18.49% | 23.61% | 139.36% | 1.24 | -23.15% |
| ngas-alpha-short-fade-priority | no | parent-selected | none | 1x | 115.3276 | 25.22% | 15.41% | -15.25% | 28.26% | 0.86 | -30.59% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 115.1821 | 24.82% | 21.92% | 12.1% | 103.04% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long | yes | parent-selected | none | 1x | 115.0927 | 28.35% | 18.71% | 14.58% | 109.15% | 1.14 | -25.51% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 115.0466 | 32.81% | 16.81% | 14.04% | 112.16% | 1.18 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 115.0185 | 37.94% | 14.99% | 21.95% | 137.15% | 1.24 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 114.9748 | 26.42% | 21.35% | 20.1% | 124.16% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 114.9015 | 34.58% | 14.87% | 18.74% | 122.67% | 1.21 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 114.8803 | 30.41% | 18.41% | 19.47% | 124.19% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 114.8587 | 23.49% | 22.95% | 11.97% | 102.25% | 1.15 | -22.04% |
| ngas-alpha-dual-follow-first-block-adverse-2f | no | parent-selected | none | 1x | 114.8507 | 31.24% | 13.45% | -4.59% | 58.55% | 0.98 | -30.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 114.8353 | 35.06% | 14.24% | 16.41% | 116.57% | 1.19 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 114.8278 | 33.24% | 16.8% | 19.51% | 126.22% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 114.7573 | 27.73% | 19.83% | 19.37% | 121.77% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 114.7548 | 27.26% | 18.3% | 16% | 109.68% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 114.7537 | 32.12% | 18.57% | 18.13% | 124.53% | 1.19 | -24.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 114.7075 | 35.56% | 16.11% | 21.67% | 134.41% | 1.24 | -23.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 114.6264 | 23.75% | 21.45% | 9.99% | 95.14% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 114.5976 | 22.44% | 23.07% | 12.24% | 101.16% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 114.5888 | 32.84% | 15.21% | 17.06% | 116.1% | 1.19 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 114.5786 | 25.06% | 19.82% | 15.69% | 107.88% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 114.5227 | 27.34% | 20.53% | 11.05% | 102.45% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 114.5127 | 30.84% | 19% | 23.32% | 135.65% | 1.24 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 114.4774 | 41.67% | 14.65% | 16.5% | 129.74% | 1.23 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 114.4701 | 24.37% | 21.5% | 8.75% | 93.42% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 114.4527 | 40.08% | 13.4% | 25.08% | 145.33% | 1.25 | -24.13% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 114.4298 | 25.18% | 21.06% | 19.19% | 118.97% | 1.2 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 114.3923 | 30.54% | 18.7% | 19.37% | 124.82% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f | yes | parent-selected | none | 1x | 114.3726 | 32.57% | 14.93% | 9.71% | 97.41% | 1.12 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 114.3572 | 35.74% | 16.45% | 23% | 138.79% | 1.24 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 114.2951 | 26.42% | 17.85% | 11.94% | 97.61% | 1.13 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 114.2562 | 36.56% | 14.82% | 17.42% | 123.01% | 1.18 | -23.28% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 114.2413 | 30.62% | 16.18% | 17.69% | 115.57% | 1.18 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 114.2381 | 25.02% | 20.05% | 10.29% | 95.48% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 113.9996 | 30.8% | 17.35% | 7.67% | 94.22% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 113.8547 | 29.33% | 19.85% | 18.01% | 121.61% | 1.18 | -24.91% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 113.8278 | 28.42% | 17.15% | 18.33% | 114.98% | 1.18 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 113.8262 | 33.57% | 17.13% | 22.82% | 135.67% | 1.23 | -23.15% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 113.7457 | 33.53% | 16.37% | 17.41% | 120.72% | 1.18 | -23.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 113.7378 | 27.84% | 19.63% | 19.34% | 121.5% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 113.7206 | 29.46% | 17.85% | 14.71% | 109.74% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 113.6696 | 26.83% | 19.29% | 14.8% | 108.01% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 113.5872 | 24.82% | 21.28% | 11.29% | 99.87% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 113.5431 | 32.23% | 16.22% | 14.55% | 111.08% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 113.5299 | 25.02% | 20% | 9.59% | 93.73% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 113.5296 | 26.32% | 18.38% | 15.28% | 106.37% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 113.4041 | 34.99% | 13.91% | 13.65% | 109.05% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 113.3031 | 28.74% | 18.24% | 11.17% | 100.75% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 113.2595 | 31.02% | 17.85% | 20.89% | 127.59% | 1.23 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 113.2179 | 39.61% | 15.13% | 19.05% | 133.4% | 1.24 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 113.1716 | 32.05% | 15.87% | 13.67% | 107.92% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 113.0532 | 28.74% | 18.8% | 10.34% | 99.86% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 113.0516 | 26.15% | 19.67% | 11.41% | 99.46% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 113.0152 | 31.47% | 17.69% | 22.57% | 132.2% | 1.23 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 112.9408 | 25.29% | 20.41% | 19.23% | 117.92% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 112.9338 | 31.03% | 15.66% | 11.23% | 99.82% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 112.9153 | 32.03% | 16.92% | 18.58% | 121.91% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 112.8303 | 29.08% | 17.61% | 18.64% | 117.95% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 112.7632 | 30.66% | 17.74% | 17.32% | 118.05% | 1.18 | -24.31% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 112.7413 | 31.84% | 16.11% | 18.71% | 120.13% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 112.7406 | 23.71% | 20.91% | 11.58% | 97.8% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 112.6726 | 25.53% | 19.55% | 8.17% | 90.42% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 112.6275 | 36.15% | 14.33% | 20.96% | 129.81% | 1.23 | -23.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 112.5711 | 26.28% | 18.11% | 9.89% | 93.05% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 112.5629 | 26.28% | 18.56% | 9.19% | 92.29% | 1.13 | -22.04% |
| ngas-alpha-fade-primary-confirmed-follow-block-adverse-2f | yes | parent-selected | none | 1x | 112.554 | 7.74% | 26.44% | 8.45% | 71.15% | 1.04 | -23.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 112.5381 | 27.69% | 15.93% | 11.53% | 95.15% | 1.12 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 112.5373 | 26.47% | 18.93% | 18.5% | 115.4% | 1.19 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow | yes | parent-selected | none | 1x | 112.4525 | 36.91% | 14.77% | 12.1% | 110.49% | 1.16 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 112.3727 | 38.28% | 12.84% | 23.98% | 137.83% | 1.24 | -24.18% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 112.3327 | 22.44% | 21.89% | 11.46% | 97.05% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 112.2873 | 29.26% | 17.92% | 18.58% | 118.8% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 112.2332 | 34.94% | 14.2% | 16.68% | 116.9% | 1.17 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 112.1387 | 26.15% | 19.63% | 10.6% | 97.45% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 112.1072 | 34.21% | 15.77% | 22.04% | 131.96% | 1.22 | -23.15% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f | yes | parent-selected | none | 1x | 112.0821 | 32.46% | 13.24% | 9.35% | 92.97% | 1.11 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-125 | yes | parent-selected | none | 1.25x | 111.9923 | 37.65% | 13.43% | 20.29% | 128.96% | 1.18 | -25.31% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 111.9747 | 29.43% | 18.14% | 22.25% | 128.41% | 1.22 | -23.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 111.7841 | 28.19% | 17.08% | 14.1% | 104.4% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 111.7682 | 32% | 15.64% | 16.64% | 114.47% | 1.17 | -23.7% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 111.7211 | 30.88% | 15.56% | 13.97% | 105.9% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 111.6421 | 25.64% | 18.42% | 14.16% | 102.53% | 1.13 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 111.6328 | 26.64% | 18.77% | 18.51% | 115.41% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 111.53 | 31.56% | 16.22% | 20.25% | 123.56% | 1.22 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 111.5012 | 32.09% | 16.39% | 21.83% | 128.73% | 1.22 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 111.4501 | 33.72% | 13.86% | 13.78% | 107% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 111.2986 | 31.27% | 14.93% | 13.3% | 103.71% | 1.15 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing | yes | parent-selected | none | 1x | 111.2502 | 34.9% | 15.25% | 14.56% | 113.94% | 1.17 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 111.1262 | 23.71% | 20.3% | 10.81% | 94.8% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 111.0835 | 36.08% | 13.47% | 25.21% | 138.04% | 1.22 | -24.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 110.9988 | 29.73% | 15.02% | 10.8% | 95.22% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 110.9601 | 27.48% | 17.44% | 10.72% | 95.86% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 110.9511 | 26.69% | 17.62% | 7.59% | 87.42% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 110.9283 | 30.68% | 16.22% | 17.82% | 116.06% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 110.8152 | 27.48% | 17.98% | 9.92% | 95.01% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 110.7338 | 30.43% | 15.42% | 17.91% | 114.13% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 110.6996 | 24.97% | 18.77% | 10.92% | 94.42% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 110.6738 | 27.76% | 16.82% | 17.81% | 111.81% | 1.18 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 110.6587 | 30.03% | 16.9% | 21.54% | 125.17% | 1.22 | -23.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 110.6403 | 24.16% | 19.48% | 18.37% | 111.79% | 1.18 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 110.4928 | 29.78% | 17.1% | 21.29% | 124.53% | 1.19 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 110.4358 | 36.06% | 12.9% | 19.46% | 122.81% | 1.17 | -25.12% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 110.2973 | 27.99% | 17.14% | 17.79% | 112.87% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 110.2137 | 36.49% | 12.28% | 22.88% | 130.48% | 1.22 | -24.23% |
| ngas-alpha-short-fade-priority-block-adverse-2f | no | parent-selected | none | 1x | 110.0809 | 30.22% | 10.13% | -13.09% | 31.81% | 0.88 | -29.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 110.0657 | 33.33% | 13.57% | 15.95% | 110.88% | 1.16 | -23.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 109.8927 | 32.7% | 15.1% | 21.08% | 125.25% | 1.21 | -23.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 109.8191 | 29.54% | 14.9% | 13.4% | 100.78% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 109.7965 | 32.1% | 14.61% | 19.61% | 119.54% | 1.21 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 109.7532 | 26.57% | 17.98% | 16.34% | 108.52% | 1.16 | -24.56% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 109.7441 | 26.92% | 16.32% | 13.49% | 99.13% | 1.12 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 109.7077 | 24.97% | 18.73% | 10.16% | 92.53% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 109.6181 | 32.31% | 13.3% | 13.24% | 102.04% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 109.6116 | 20.35% | 20.85% | 11.13% | 90.49% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 109.4956 | 30.5% | 13.99% | 12.93% | 99.54% | 1.14 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 109.4808 | 22.83% | 19.06% | 17.39% | 106.1% | 1.17 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 109.3613 | 25.44% | 17.92% | 17.68% | 109.43% | 1.17 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 109.2765 | 34.55% | 12.93% | 24.15% | 131.3% | 1.21 | -24.13% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 109.2307 | 30.61% | 15.66% | 20.83% | 121.92% | 1.21 | -23.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 109.1446 | 27.84% | 15.71% | 7.01% | 84.4% | 1.1 | -22.04% |
| ngas-alpha-dual-follow-first-graded-shift-sizing | no | parent-selected | none | 1x | 109.1144 | 31.18% | 10.84% | -2.26% | 59.26% | 0.98 | -30.56% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 109.0688 | 19.03% | 21.18% | 12.44% | 91.69% | 1.12 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 109.0568 | 34.48% | 12.36% | 18.63% | 116.75% | 1.16 | -24.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 108.9943 | 28.43% | 14.37% | 10.37% | 90.66% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 108.8213 | 29.33% | 15.52% | 17.06% | 110.29% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 108.7826 | 26.23% | 16.65% | 10.27% | 91.03% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 108.7552 | 27.76% | 16.08% | 15.72% | 105.39% | 1.15 | -24.01% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 108.6918 | 28.55% | 16.4% | 20.41% | 118.56% | 1.18 | -23.86% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 108.6713 | 29.04% | 14.73% | 17.11% | 108.22% | 1.17 | -22.11% |
| ngas-alpha-weather-fade-first | no | parent-selected | none | 1x | 108.5711 | 0.72% | 24.9% | -7.6% | 22.41% | 0.84 | -28.84% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 108.4724 | 33.89% | 14.43% | 13.28% | 107.26% | 1.16 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 108.4666 | 28.59% | 16.6% | 20.34% | 118.92% | 1.17 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 108.4322 | 26.23% | 17.16% | 9.5% | 90.22% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 108.1808 | 26.72% | 16.37% | 16.99% | 107.04% | 1.17 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 107.9176 | 27.94% | 15.07% | 9.17% | 88.39% | 1.09 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 107.9121 | 28.21% | 14.24% | 12.82% | 95.72% | 1.12 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 107.8131 | 30.89% | 12.74% | 12.7% | 97.14% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 107.7976 | 21.48% | 18.91% | 10.54% | 87.52% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 107.7172 | 28.95% | 14.2% | 15.1% | 102.26% | 1.14 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 107.699 | 32.62% | 13% | 18.97% | 115.53% | 1.2 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 107.6688 | 23.98% | 17.14% | 16.77% | 102.97% | 1.16 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 107.6567 | 31.19% | 14.42% | 20.12% | 118.66% | 1.2 | -23.36% |
| ngas-alpha-fade-primary-confirmed-follow-graded-shift-sizing | yes | parent-selected | none | 1x | 107.6498 | 9.9% | 24.48% | 15.27% | 86.84% | 1.09 | -25.29% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 107.4443 | 32.91% | 11.83% | 17.8% | 110.78% | 1.15 | -24.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 107.3745 | 33.03% | 12.39% | 23.09% | 124.66% | 1.2 | -24.18% |
| ngas-alpha-short-fade-plus-cold-follow-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 107.3705 | 37% | 13.28% | 15.77% | 116.43% | 1.19 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 107.3406 | 30.26% | 14.16% | 15.48% | 105.44% | 1.12 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f | yes | parent-selected | none | 1x | 107.2446 | 14.9% | 21.31% | 8.18% | 74.75% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 107.2176 | 25.87% | 14.88% | 14.29% | 96.2% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 107.1472 | 20.35% | 19.78% | 10.43% | 86.86% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 107.0722 | 26.63% | 16.43% | 20.13% | 114.32% | 1.19 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 107.0306 | 23.25% | 16.69% | 12.87% | 91.8% | 1.11 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 107.0153 | 27.14% | 13.73% | 9.93% | 86.16% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 106.8784 | 25.87% | 14.85% | 13.39% | 94.07% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 106.8718 | 18.7% | 19.7% | 12.42% | 88.24% | 1.11 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 106.8378 | 27.31% | 15.7% | 19.53% | 112.67% | 1.17 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 106.7678 | 27.99% | 14.83% | 16.3% | 104.61% | 1.16 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 106.6081 | 27.41% | 15.91% | 19.51% | 113.26% | 1.16 | -23.86% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f | yes | parent-selected | none | 1x | 106.5282 | 29.34% | 14.55% | 8.99% | 89.36% | 1.09 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 106.0355 | 34.99% | 13.75% | 18.31% | 119.94% | 1.21 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 105.9886 | 22.61% | 16.99% | 9.95% | 84.55% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 105.9668 | 25.12% | 15.24% | 16.14% | 99.83% | 1.15 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 105.9651 | 29.49% | 12.18% | 12.16% | 92.3% | 1.11 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 105.9642 | 21.48% | 18.36% | 9.84% | 84.88% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 105.9236 | 26.77% | 14.45% | 8.82% | 84.38% | 1.08 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 105.8272 | 27.16% | 15.31% | 19.5% | 111.49% | 1.19 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 105.8208 | 21.91% | 17.63% | 16.65% | 99.81% | 1.15 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 105.7891 | 29.01% | 13.59% | 14.87% | 100.59% | 1.11 | -23.86% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 105.7785 | 31.96% | 13.59% | 25.53% | 131.07% | 1.21 | -24.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 105.6472 | 32.94% | 11.17% | 20.7% | 116.18% | 1.19 | -24.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 105.6397 | 30.13% | 12.33% | 14.48% | 99.11% | 1.14 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 105.4661 | 24.8% | 14.27% | 13.72% | 91.77% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 105.4035 | 31.51% | 11.85% | 22.04% | 118.13% | 1.19 | -24.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 105.4001 | 24.4% | 14.8% | 12.27% | 88.8% | 1.1 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f | yes | parent-selected | none | 1x | 105.1536 | 15.2% | 19.55% | 8.16% | 72.1% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 105.1474 | 24.8% | 14.23% | 12.86% | 89.74% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 104.9258 | 26.08% | 15% | 18.66% | 106.87% | 1.16 | -23.98% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 104.9031 | 26.23% | 15.23% | 18.67% | 107.67% | 1.15 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 104.7162 | 22.61% | 16.94% | 9.25% | 82.87% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 104.6603 | 23.06% | 16.22% | 16.03% | 97.74% | 1.15 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 104.6593 | 18.37% | 18.23% | 12.39% | 84.81% | 1.09 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 104.4262 | 27.68% | 14.19% | 18.86% | 108.65% | 1.18 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 104.2706 | 23.74% | 15.09% | 9.36% | 81.57% | 1.1 | -22.04% |
| ngas-alpha-short-fade-confirmed-long-risk-off | no | parent-selected | none | 1x | 104.2441 | 20.71% | 3.23% | 7.67% | 50.84% | 1.21 | -20.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 104.1948 | 26.27% | 13.36% | 15.52% | 96.68% | 1.14 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 104.0926 | 27.77% | 13.02% | 14.26% | 95.79% | 1.1 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 104.0472 | 32.36% | 10.56% | 20.48% | 113.29% | 1.18 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 104.0211 | 25.61% | 13.84% | 8.48% | 80.42% | 1.08 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing | yes | parent-selected | none | 1x | 104.0038 | 29.78% | 10.76% | 16.15% | 99.08% | 1.13 | -24.37% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 103.9975 | 30.61% | 13.05% | 24.45% | 124.7% | 1.2 | -24.95% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 103.7356 | 25.55% | 12.93% | 11.67% | 85.79% | 1.09 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 103.6746 | 23.73% | 13.66% | 13.15% | 87.39% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 103.5797 | 23.74% | 15.53% | 8.67% | 80.84% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 103.5298 | 24.2% | 14.83% | 15.41% | 95.64% | 1.14 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 103.3062 | 14.96% | 19.73% | 11.74% | 79.92% | 1.08 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 103.1879 | 23.73% | 13.62% | 12.33% | 85.47% | 1.09 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 103.1627 | 28.19% | 13.08% | 18.23% | 105.81% | 1.17 | -23.58% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f | yes | parent-selected | none | 1x | 103.0766 | 15.48% | 17.81% | 8.13% | 69.45% | 1.03 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 103.0301 | 25.06% | 14.55% | 17.84% | 102.17% | 1.14 | -23.98% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 102.9523 | 24.57% | 12.45% | 9.05% | 77.32% | 1.07 | -22.04% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 102.6236 | 30.59% | 15.83% | 5.37% | 85.44% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 102.4461 | 26.53% | 12.45% | 13.64% | 91.04% | 1.09 | -23.98% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 102.4053 | 18.03% | 16.77% | 12.37% | 81.4% | 1.08 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 102.2273 | 25.33% | 13.44% | 14.8% | 93.51% | 1.13 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 102.1751 | 22.87% | 14.3% | 12.17% | 84.9% | 1.09 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 102.145 | 29.27% | 12.5% | 23.37% | 118.43% | 1.19 | -24.99% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 102.0065 | 25.62% | 16.35% | 7.02% | 81.83% | 1.09 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 101.9281 | 24.46% | 13.22% | 8.13% | 76.5% | 1.07 | -22.28% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 101.8756 | 26.69% | 11.07% | 11.07% | 82.78% | 1.09 | -22.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 101.8142 | 14.64% | 18.77% | 11.71% | 77.53% | 1.07 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 101.7426 | 22.67% | 13.06% | 12.58% | 83.06% | 1.09 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 101.4233 | 29.42% | 13.06% | 12.56% | 94.89% | 1.12 | -22.09% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f | yes | parent-selected | none | 1x | 101.3127 | 29.51% | 15.28% | 1.35% | 73.11% | 1.05 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 101.2984 | 22.67% | 13.01% | 11.8% | 81.25% | 1.08 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 101.2822 | 22.87% | 14.26% | 11.29% | 82.86% | 1.08 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 101.151 | 28.5% | 10.76% | 19.94% | 105.41% | 1.16 | -24.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 101.0428 | 23.64% | 13.6% | 16.91% | 95.54% | 1.13 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone | yes | parent-selected | none | 1x | 100.9742 | 29.21% | 10.16% | 15.95% | 96.34% | 1.11 | -25.9% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f | yes | parent-selected | none | 1x | 100.9136 | 15.76% | 16.07% | 8.11% | 66.8% | 1.02 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 100.7773 | 26.46% | 13.13% | 20.68% | 108.33% | 1.15 | -23.56% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 100.6511 | 29.38% | 10.39% | 15.36% | 95.81% | 1.13 | -24.1% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing | yes | parent-selected | none | 1x | 100.6327 | 24.57% | 15.8% | 2.94% | 69.67% | 1.04 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 100.4862 | 27.95% | 13.06% | 19.65% | 108.6% | 1.13 | -26.52% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 100.4836 | 21.93% | 13.71% | 11.69% | 81.07% | 1.08 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 100.4685 | 27.94% | 11.95% | 22.3% | 112.27% | 1.18 | -25.02% |
| ngas-alpha-short-fade-priority-graded-shift-sizing | no | parent-selected | none | 1x | 100.3138 | 22.44% | 8.71% | -9.35% | 27.09% | 0.85 | -29.36% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 100.2762 | 14.32% | 17.81% | 11.69% | 75.15% | 1.06 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 99.8617 | 26.47% | 13.1% | 24.55% | 117.1% | 1.17 | -24.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 99.6643 | 27.94% | 10.16% | 19.73% | 102.62% | 1.15 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 99.6037 | 21.93% | 13.67% | 10.85% | 79.12% | 1.07 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 99.5704 | 36.51% | 9.61% | 19.16% | 115.66% | 1.19 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 99.4162 | 26.81% | 12.54% | 18.85% | 103.57% | 1.12 | -26.31% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 99.1831 | 22.72% | 13.19% | 16.18% | 91.41% | 1.12 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 99.1478 | 25.37% | 12.6% | 19.83% | 103.24% | 1.14 | -23.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f | yes | parent-selected | none | 1x | 99.1146 | 26.28% | 9.99% | 11% | 79.84% | 1.06 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 99.0161 | 24.05% | 11.31% | 12.41% | 81.71% | 1.07 | -24.1% |
| ngas-alpha-weather-fade-first-block-adverse-2f | yes | parent-selected | none | 1x | 98.8346 | 10.43% | 13.56% | -5.93% | 24.43% | 0.85 | -26.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 98.6636 | 21% | 13.13% | 11.22% | 77.27% | 1.07 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 98.6362 | 13.99% | 16.85% | 11.66% | 72.76% | 1.05 | -23.1% |
| ngas-alpha-net-additive-parent-overlay-close-confirm-1_5f | no | parent-selected | none | 1x | 98.5938 | 26.45% | 11.17% | 5.46% | 69.98% | 1.01 | -31.72% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 98.3294 | 34% | 9.92% | 19.83% | 113.36% | 1.19 | -24.33% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 98.2932 | 25.39% | 12.57% | 23.52% | 111.53% | 1.16 | -24.95% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 98.1932 | 17.69% | 17.29% | 12.34% | 81.7% | 1.08 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 98.1386 | 20.55% | 11.84% | 11.44% | 74.56% | 1.07 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 98.1383 | 25.3% | 12.64% | 19.74% | 103% | 1.14 | -23.56% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 98.1262 | 25.68% | 12.02% | 18.04% | 98.59% | 1.11 | -26.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 97.7736 | 22.16% | 11.99% | 7.42% | 68.77% | 1.05 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 97.7567 | 21% | 13.09% | 10.41% | 75.42% | 1.06 | -22.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 97.5913 | 24.28% | 12.07% | 18.97% | 98.22% | 1.13 | -23.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 97.4394 | 20.55% | 11.79% | 10.74% | 72.94% | 1.06 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 97.3956 | 26.93% | 10.27% | 14.9% | 90.21% | 1.08 | -23.56% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 96.811 | 25.29% | 10.86% | 20.17% | 100.24% | 1.15 | -25.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 96.8016 | 20.06% | 12.55% | 10.74% | 73.5% | 1.06 | -22.28% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 96.7922 | 24.54% | 11.5% | 17.24% | 93.68% | 1.1 | -25.88% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 96.7458 | 24.26% | 12.13% | 18.93% | 98.2% | 1.13 | -23.64% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 96.7198 | 26.22% | 13.96% | 4.7% | 73.06% | 1.06 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone | yes | parent-selected | none | 1x | 96.7185 | 31.89% | 9.73% | 14.67% | 97.26% | 1.12 | -25.43% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 96.5857 | 24.3% | 12.04% | 22.49% | 106.04% | 1.15 | -24.99% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f | yes | parent-selected | none | 1x | 96.371 | 13.58% | 17.41% | 8.08% | 65.33% | 1.01 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing | yes | parent-selected | none | 1x | 96.3517 | 29.45% | 10.04% | 15.31% | 95.1% | 1.11 | -24.44% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 96.2189 | 21.38% | 14.46% | 6.34% | 69.6% | 1.05 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 96.1136 | 25.03% | 9.99% | 14.64% | 85.76% | 1.09 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 96.0511 | 25.83% | 9.86% | 14.31% | 86.16% | 1.07 | -23.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 95.9498 | 23.19% | 11.54% | 18.12% | 93.27% | 1.12 | -23.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 95.8052 | 20.06% | 12.5% | 9.97% | 71.75% | 1.06 | -22.28% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 95.0628 | 23.22% | 11.61% | 18.12% | 93.46% | 1.12 | -23.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 94.9232 | 23.22% | 11.51% | 21.46% | 100.62% | 1.14 | -25.02% |
| ngas-alpha-short-fade-confirmed-long-graded-shift-sizing | yes | parent-selected | none | 1x | 94.8515 | 25.88% | 14.84% | 13.36% | 94.01% | 1.13 | -24.29% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 94.6651 | 24.73% | 9.46% | 13.72% | 82.14% | 1.07 | -23.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 94.3022 | 22.27% | 10.46% | 15.64% | 84.03% | 1.08 | -25.45% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 94.1933 | 16.43% | 13.15% | 13.02% | 73.22% | 1.05 | -23.8% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 94.145 | 19.74% | 14.94% | 8.16% | 71.72% | 1.05 | -23.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 93.4513 | 22.19% | 11.1% | 17.31% | 88.78% | 1.11 | -23.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 93.2766 | 23.63% | 9.05% | 13.13% | 78.16% | 1.06 | -23.82% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 93.1044 | 27.55% | 9.51% | 14.61% | 89.09% | 1.1 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 92.8931 | 18.2% | 11.38% | 9.78% | 66.09% | 1.04 | -22.6% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow | yes | parent-selected | none | 1x | 92.7172 | 18.73% | 14.39% | 4.05% | 60% | 1 | -23.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f | yes | parent-selected | none | 1x | 92.6361 | 13.58% | 12.74% | 8.74% | 58.5% | 0.99 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 92.5988 | 21.03% | 10.48% | 16.43% | 83.56% | 1.1 | -24% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 92.413 | 31.98% | 8.29% | 18.41% | 102.94% | 1.15 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 91.6737 | 21.05% | 10.46% | 19.42% | 90.03% | 1.12 | -25.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 91.6147 | 18.2% | 11.33% | 9.09% | 64.53% | 1.04 | -22.6% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 91.388 | 13.66% | 15.89% | 11.64% | 70.38% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f | yes | parent-selected | none | 1x | 91.3722 | 23.17% | 9.63% | 10.28% | 72.28% | 1.03 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 91.2985 | 29.54% | 8.59% | 19.08% | 100.73% | 1.15 | -24.33% |
| ngas-alpha-short-fade-confirmed-long-block-adverse-2f | yes | parent-selected | none | 1x | 91.1781 | 21.87% | 14.14% | 6.63% | 70.49% | 1.04 | -23.79% |
| ngas-alpha-net-additive-parent-overlay-close-confirm-3f | no | parent-selected | none | 1x | 91.1116 | 27.29% | 7.37% | 4.01% | 61.05% | 0.98 | -32.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 90.3891 | 21.44% | 8.24% | 11.94% | 70.31% | 1.04 | -24% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 90.2613 | 20.12% | 10.08% | 15.7% | 79.6% | 1.08 | -24% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 90.0749 | 13.34% | 15.62% | 10.51% | 66.92% | 1.03 | -23.48% |
| ngas-alpha-net-additive-parent-overlay-spared-confirm-1_5f | no | parent-selected | none | 1x | 89.8986 | 29.78% | 4.99% | 1.7% | 55.41% | 0.97 | -30.52% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 89.8487 | 12.43% | 12.74% | 12.31% | 63.96% | 1.02 | -23.8% |
| ngas-alpha-short-fade-confirmed-long | yes | parent-selected | none | 1x | 89.7431 | 28.12% | 11.45% | 9.68% | 82.81% | 1.08 | -25.17% |
| ngas-alpha-dual-follow-first-close-confirm-1_5f | no | parent-selected | none | 1x | 89.5301 | 25% | 5.84% | -0.85% | 44.24% | 0.92 | -32.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 89.0864 | 17.74% | 12.13% | 3.58% | 53.42% | 0.98 | -22.35% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 88.0169 | 13.02% | 14.2% | 10.48% | 63.78% | 1.02 | -23.48% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 87.9289 | 15.65% | 13.08% | 7.48% | 59.95% | 1.01 | -23.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-3f | yes | parent-selected | none | 1x | 87.9195 | 9.36% | 15.75% | 6.31% | 51.47% | 0.96 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 87.8817 | 15.76% | 12.24% | 12.97% | 70.24% | 1.04 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 87.8319 | 17.41% | 11.4% | 3.56% | 51.57% | 0.98 | -22.32% |
| ngas-alpha-weather-fade-first-graded-shift-sizing | no | parent-selected | none | 1x | 87.0776 | 0.92% | 12.78% | -3.28% | 14.13% | 0.8 | -26.91% |
| ngas-alpha-dual-follow-first-close-confirm-3f | no | parent-selected | none | 1x | 86.8543 | 27.94% | 3.06% | -1.05% | 43.23% | 0.92 | -33.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 86.7124 | 17.07% | 10.67% | 3.53% | 49.73% | 0.97 | -22.29% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-spared-confirm-1_5f | yes | parent-selected | none | 1x | 86.5573 | 13.63% | 12.25% | -0.37% | 38.75% | 0.91 | -22.35% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 86.1623 | 23.25% | 8.18% | 13.89% | 77.47% | 1.06 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-1_5f | yes | parent-selected | none | 1x | 86.023 | 11.7% | 12.37% | 8.69% | 54.56% | 0.97 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-3f | yes | parent-selected | none | 1x | 85.7985 | 9.65% | 14.05% | 6.29% | 49.05% | 0.95 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 85.7129 | 12.7% | 12.78% | 10.45% | 60.65% | 1.01 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-spared-confirm-1_5f | yes | parent-selected | none | 1x | 85.4903 | 13.92% | 11.25% | -0.4% | 37.53% | 0.91 | -22.32% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 85.2059 | 16.73% | 9.94% | 3.51% | 47.88% | 0.96 | -22.26% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 85.0289 | 13.86% | 15.84% | 4.09% | 54.5% | 1 | -22.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-3f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 84.3983 | 9.42% | 14.22% | 9.81% | 56.19% | 0.99 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-spared-confirm-1_5f | yes | parent-selected | none | 1x | 84.3168 | 14.2% | 10.26% | -0.42% | 36.3% | 0.9 | -22.29% |
| ngas-alpha-fade-primary-confirmed-follow-close-confirm-1_5f | no | parent-selected | none | 1x | 83.9831 | -4.13% | 20.8% | 11.79% | 46.87% | 0.95 | -26.39% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-3f | yes | parent-selected | none | 1x | 83.7175 | 9.92% | 12.37% | 6.26% | 46.63% | 0.94 | -23.48% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-1_5f | yes | parent-selected | none | 1x | 83.6537 | 12.88% | 15.29% | 0.11% | 43.55% | 0.94 | -22.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 83.5234 | 12.38% | 11.37% | 10.43% | 57.54% | 0.99 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 83.5094 | 13.71% | 10.78% | 2.92% | 43.28% | 0.94 | -22.35% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-spared-confirm-1_5f | yes | parent-selected | none | 1x | 83.0128 | 14.48% | 9.28% | -0.44% | 35.06% | 0.9 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-3f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 82.8903 | 9.12% | 13.3% | 9.78% | 54.01% | 0.98 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 82.8399 | 13.39% | 10.53% | 2.9% | 42.29% | 0.94 | -22.32% |
| ngas-alpha-short-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 82.358 | 16.39% | 11.1% | 3.49% | 49.28% | 0.97 | -22.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 82.1479 | 13.06% | 10.27% | 2.88% | 41.3% | 0.94 | -22.29% |
| ngas-alpha-short-fade-priority-close-confirm-1_5f | no | parent-selected | none | 1x | 82.0094 | 19.54% | 3.22% | -8.46% | 16.3% | 0.81 | -30.88% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-3f | yes | parent-selected | none | 1x | 81.683 | 10.19% | 10.7% | 6.24% | 44.22% | 0.93 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 81.4224 | 12.73% | 10.02% | 2.85% | 40.31% | 0.93 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-3f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 81.4138 | 8.8% | 12.37% | 9.76% | 51.83% | 0.97 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 81.1625 | 11.78% | 10.9% | 12.26% | 59.4% | 1 | -23.8% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-3f-storage-drawdown-400bcf | no | parent-selected | storage-drawdown-400bcf | 1x | 81.1276 | 11.53% | 16.25% | 3.77% | 50.63% | 0.98 | -23.91% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-3f | no | parent-selected | none | 1x | 79.9366 | 10.57% | 15.7% | -0.2% | 39.85% | 0.93 | -23.91% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-3f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 79.9078 | 8.49% | 11.45% | 9.73% | 49.65% | 0.96 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-spared-confirm-1_5f | yes | parent-selected | none | 1x | 79.8059 | 12.31% | 11.23% | -0.47% | 34.85% | 0.9 | -22.23% |
| ngas-alpha-short-fade-confirmed-long-close-confirm-1_5f | yes | parent-selected | none | 1x | 79.749 | 6.53% | 16.37% | 8.12% | 51.36% | 0.98 | -24.78% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 79.4241 | 12.05% | 11.87% | 10.4% | 57.81% | 0.99 | -23.48% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 79.1666 | 31.67% | 2.92% | 21.84% | 98.38% | 1.13 | -26.09% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 79.1525 | 9.93% | 13.97% | 3.43% | 43.51% | 0.95 | -22.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 78.4944 | 15% | 7.77% | 3.7% | 41.8% | 0.94 | -23.28% |
| ngas-alpha-dual-follow-first-spared-confirm-1_5f | no | parent-selected | none | 1x | 78.1507 | 26.75% | 0% | -0.57% | 37.11% | 0.89 | -31.91% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 77.5391 | 28.67% | 3.07% | 20.6% | 90.77% | 1.11 | -26.04% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow | yes | parent-selected | none | 1x | 77.3199 | 29.86% | 2.05% | 17.26% | 83.47% | 1.07 | -26.33% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-3f | yes | parent-selected | none | 1x | 77.0037 | 8.09% | 11.99% | 6.21% | 42.87% | 0.92 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 76.3144 | 12.39% | 9.77% | 2.83% | 39.3% | 0.93 | -22.23% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 76.2113 | 27.26% | 3.45% | 21.08% | 90.17% | 1.1 | -26.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-spared-confirm-1_5f | yes | parent-selected | none | 1x | 76.1983 | 12.16% | 7.37% | -0.26% | 28.82% | 0.87 | -23.28% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-graded-shift-sizing | yes | parent-selected | none | 1x | 76.0039 | 26.89% | 2.19% | 16.05% | 76.25% | 1.05 | -26.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 75.6454 | 10.73% | 8.49% | 11.16% | 51.14% | 0.97 | -23.61% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-3f-storage-drawdown-600bcf | no | parent-selected | storage-drawdown-600bcf | 1x | 75.3673 | 7.66% | 14.37% | 3.11% | 39.8% | 0.94 | -23.91% |
| ngas-alpha-short-fade-priority-close-confirm-3f | no | parent-selected | none | 1x | 74.8438 | 19.58% | 0.21% | -9.3% | 9.95% | 0.78 | -31.35% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 74.6928 | 24.35% | 3.6% | 19.84% | 82.77% | 1.08 | -26.04% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 74.2405 | 14.32% | 8.19% | 3.65% | 41.37% | 0.93 | -23.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 74.0274 | 11.04% | 7.38% | 3.04% | 33.65% | 0.9 | -23.28% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-3f | yes | parent-selected | none | 1x | 73.742 | 7.99% | 8.1% | 6.95% | 37.66% | 0.9 | -23.61% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-3f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 72.7015 | 8.17% | 10.53% | 9.71% | 47.48% | 0.96 | -23.48% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 72.4844 | 13.78% | 5.51% | 13.58% | 55.69% | 0.99 | -24.51% |
| ngas-alpha-weather-fade-first-close-confirm-1_5f | no | parent-selected | none | 1x | 72.413 | 1.7% | 6.89% | -1.88% | 9.33% | 0.78 | -28.09% |
| ngas-alpha-short-fade-only-block-adverse-2f | yes | parent-selected | none | 1x | 71.8656 | 20% | 7.85% | 0.36% | 42.76% | 0.97 | -22.78% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 71.7962 | 9.34% | 11.94% | 3.77% | 39.9% | 0.94 | -24.69% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-spared-confirm-1_5f | yes | parent-selected | none | 1x | 71.5729 | 10.3% | 8.31% | -0.31% | 27.42% | 0.86 | -23.22% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-1_5f | yes | parent-selected | none | 1x | 71.4383 | 12.16% | 4.61% | 9.28% | 42.98% | 0.93 | -24.51% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-3f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 71.4043 | 6.88% | 8.1% | 10.46% | 42.66% | 0.94 | -23.61% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 71.3753 | 21.61% | 2.92% | 15.95% | 68.66% | 1.03 | -26.09% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-spared-confirm-1_5f | yes | parent-selected | none | 1x | 70.6656 | 8.38% | 11.4% | -0.2% | 29.57% | 0.88 | -24.69% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-block-adverse-2f | yes | parent-selected | none | 1x | 70.014 | 19.9% | 2.05% | 11.57% | 55.28% | 0.97 | -26.09% |
| ngas-alpha-fade-primary-confirmed-follow-close-confirm-3f | no | parent-selected | none | 1x | 69.8156 | -6.33% | 15.11% | 10.48% | 31.54% | 0.89 | -25.49% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 69.4251 | 10.08% | 7.61% | 11.11% | 48.41% | 0.96 | -23.61% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 69.3281 | 9.85% | 6.05% | 12.87% | 48.69% | 0.96 | -24.51% |
| ngas-alpha-fade-primary-confirmed-follow-spared-confirm-1_5f | no | parent-selected | none | 1x | 68.8729 | -1.74% | 14.22% | 3.05% | 24.07% | 0.86 | -26.19% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 68.6442 | 17.47% | 3.45% | 15.22% | 61.29% | 1 | -26.09% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 68.1844 | 10.38% | 6.89% | 2.99% | 31.72% | 0.89 | -23.22% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-3f | yes | parent-selected | none | 1x | 66.9537 | 6.18% | 7.73% | 6.9% | 34.04% | 0.89 | -23.61% |
| ngas-alpha-short-fade-priority-spared-confirm-1_5f | no | parent-selected | none | 1x | 66.7128 | 21.09% | -2.15% | -11.92% | 3.07% | 0.75 | -30.61% |
| ngas-alpha-short-fade-confirmed-long-spared-confirm-1_5f | yes | parent-selected | none | 1x | 66.3933 | 6.11% | 11.55% | -0.44% | 25.8% | 0.87 | -23.93% |
| ngas-alpha-short-fade-only | yes | parent-selected | none | 1x | 66.2597 | 20.74% | 5.27% | 0.41% | 39.58% | 0.95 | -24.18% |
| ngas-alpha-weather-fade-first-close-confirm-3f | no | parent-selected | none | 1x | 65.9381 | 2.25% | 3.82% | -2.21% | 4.97% | 0.76 | -28.86% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 65.7386 | 5.53% | 10.13% | 3.11% | 29.59% | 0.89 | -24.69% |
| ngas-alpha-short-fade-only-graded-shift-sizing | yes | parent-selected | none | 1x | 65.6256 | 10.69% | 8.92% | 2.55% | 34.65% | 0.93 | -23.16% |
| ngas-alpha-short-fade-confirmed-long-close-confirm-3f | yes | parent-selected | none | 1x | 63.6681 | 1.3% | 12.52% | 6.24% | 32.54% | 0.9 | -25.15% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-3f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 62.6425 | 6.26% | 6.31% | 10.41% | 38.48% | 0.92 | -23.61% |
| ngas-alpha-weather-fade-first-spared-confirm-1_5f | no | parent-selected | none | 1x | 62.4194 | 4.7% | 1.94% | -5.01% | 0.61% | 0.74 | -27.83% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 61.602 | 12.27% | 3.52% | 3.81% | 30.63% | 0.89 | -24.21% |
| ngas-alpha-short-fade-only-close-confirm-1_5f | yes | parent-selected | none | 1x | 60.3678 | 8.19% | 8.49% | 2.94% | 30.81% | 0.91 | -24.68% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-spared-confirm-1_5f | yes | parent-selected | none | 1x | 59.69 | 10.67% | 2.64% | -0.15% | 19.21% | 0.83 | -24.21% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 59.2271 | 8.38% | 4.05% | 3.15% | 24.34% | 0.86 | -24.21% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 55.545 | 8.1% | 1.67% | 11.82% | 36.14% | 0.91 | -23.75% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-3f | yes | parent-selected | none | 1x | 53.9513 | 6.54% | 0.81% | 7.58% | 24.43% | 0.85 | -23.75% |
| ngas-alpha-short-fade-only-close-confirm-3f | yes | parent-selected | none | 1x | 53.6333 | 5.88% | 6.99% | 2.04% | 23.13% | 0.87 | -25.09% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-3f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 52.4926 | 4.32% | 2.2% | 11.11% | 29.69% | 0.88 | -23.75% |
| ngas-alpha-short-fade-only-spared-confirm-1_5f | yes | parent-selected | none | 1x | 51.2318 | 8.5% | 5.02% | -0.35% | 19.43% | 0.86 | -24.31% |

## Verdict

Load this as an active research-baseline strategy, not broker-ready. The selected blend keeps idle capital in the index fallback so any return improvement comes from explicit gas overlays rather than a cash timing patch. It has cleared the current holdout-edge and bootstrap reality checks, but still needs non-overlapping paper validation before any broker adapter exists.
