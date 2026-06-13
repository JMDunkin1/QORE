# NGAS Winter Alpha

Generated at 2026-06-13T02:39:15.100Z.

## Purpose

This active QORE research strategy combines parent experts without fitting new weather thresholds: Dual Weather supplies the cold/warm forecast-follow context, Weather Hybrid supplies post-window reversion context, Volatility Mean Reversion can confirm same-direction overreaction fades, optional weather-resolution overlays test whether close-in or already-known actual weather shifted enough to support the fade, and optional EIA storage-drawdown gates test whether cold-follow longs are allowed only after the withdrawal season has consumed enough inventory. The selected blend is ranked on train/validation only, with holdout reported after selection.

## Selected Candidate

- Architecture: Short fade plus cold follow and vol-confirmed long fade + Grade reversion size by close-in weather shift + Cold-follow requires 400 Bcf storage drawdown + 1.25x gas-overlay risk budget.
- Parent experts: Dual Weather Rotation for forecast-follow, Weather Hybrid Rotation for post-window reversion, and Volatility Mean Reversion for same-direction fade confirmation.
- Position policy: Take Dual Weather cold-follow setups directly; keep Weather Hybrid reversion-short setups, adding Dual Weather warm-short exposure when both parent experts point short, and add Weather Hybrid reversion-long setups only when Volatility Mean Reversion confirms the same long-fade direction. Weather-resolution overlay: Scale reversion exposure up when the close-in or already-known actual anomaly confirms the reversion, and shrink it when the weather shift argues against the trade. Storage gate: Allow cold-follow gas longs only after lagged EIA working gas storage available with a 7-calendar-day delay has drawn down at least 400 Bcf from the current withdrawal-season peak. Portfolio risk-budget overlay: scale active gas exposure by 1.25x, capped at 0.6x, without changing signal selection.
- Max weather UNG overlay: 0.45x; parent weather leg 0.25x and weather reversion leg 0.2x.
- Gas-overlay risk multiplier: 1.25x; effective max weather UNG overlay 0.5625x.
- Vol-confirmed reversion-long size: 1x of the parent reversion leg.
- Standalone reversion fade size: 1x of the parent reversion leg when no same-direction follow signal confirms it.
- Weather-resolution overlay: Grade reversion size by close-in weather shift. Scale reversion exposure up when the close-in or already-known actual anomaly confirms the reversion, and shrink it when the weather shift argues against the trade.
- Cold-follow storage gate: Cold-follow requires 400 Bcf storage drawdown. Allow cold-follow gas longs only after lagged EIA working gas storage available with a 7-calendar-day delay has drawn down at least 400 Bcf from the current withdrawal-season peak.
- Idle capital risk mode: Full index fallback for idle capital.
- Cost: 0.064% round trip, charged as 0.032% one-way on UNG position changes.
- Selection: Only predeclared parent-blend policies, cold-follow EIA storage-drawdown gates, and bounded gas-overlay risk multipliers are selected on train and validation. Generic idle-index risk-off variants are reported as diagnostics only, and holdout rows after 2025-11-01 are reported after selection.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 126 | 79.07% | 33.7% | 45.37% | 19.78% | 1.02 | 1.61 | -22.72% | 5.3% |
| Validation | 45 | 54.08% | 29.08% | 25% | 31.41% | 1.5 | 2.08 | -14.33% | 3.9% |
| Holdout | 48 | 34.32% | 10.94% | 23.38% | 65.47% | 2.3 | 2.9 | -12.41% | 10.8% |
| Full | 219 | 270.6% | 91.47% | 179.13% | 27.37% | 1.31 | 1.94 | -22.72% | 5.5% |

## Train/Validation Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 28 | 27.45% | 8.93 | -2.08% |
| Warm-short | 58 | 16.35% | 2.19 | -8.03% |
| Reversion-long | 34 | 21.43% | 5.04 | -5.14% |
| Reversion-short | 111 | 22.73% | 1.87 | -7.24% |
| Long-side combined | 60 | 47.34% | 6.18 | -5.14% |
| Short-side combined | 111 | 22.73% | 1.87 | -7.24% |

## Full Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 35 | 33.51% | 6.19 | -7.23% |
| Warm-short | 75 | 40.01% | 3.58 | -8.03% |
| Reversion-long | 43 | 24.78% | 4.95 | -5.14% |
| Reversion-short | 143 | 41.75% | 2.37 | -7.24% |
| Long-side combined | 76 | 58.61% | 5.2 | -7.4% |
| Short-side combined | 143 | 41.75% | 2.37 | -7.24% |
| Index fallback | 1143 | 64.83% | 0.71 | -26.95% |

## Anti-Overfit Check

- Candidate count: 267.
- Eligible candidates: 232.
- Eligibility requires a selectable gas-alpha policy, positive train and validation edge, lower train and validation drawdown than the index basket, and train/validation volatility under a 20% annualized risk budget.
- Index risk-off variants are diagnostic-only because they can create cash-flat equity shelves and are a portfolio overlay rather than a gas-alpha rule.
- Weather-resolution overlays use GFS/GEFS lead-1 to lead-3 forecasts available by the trade date, or target-day actual weather only when the target date is already before the trade date.
- Cold-follow storage gates use EIA Lower 48 working gas storage rows only after a 7-calendar-day availability lag. The seasonal drawdown is measured from the current withdrawal-season storage peak.
- Gas-overlay risk multipliers are predeclared sizing variants on the selected graded vol-confirmed family only; they do not change entry dates, directions, parent signals, or weather thresholds.
- Holdout was not used for selection: yes.
- Primary p-value: 0.005 (selection-adjusted centered circular block bootstrap).
- Single-candidate p-value: 0.0058.
- Selection-adjusted p-value: 0.005 across 232 eligible candidates.
- Observed active edge: 0.05011% per day / 12.63% annualized.
- Mean daily-edge 90% bootstrap interval: 0.02212% to 0.08116%.
- Zero-edge null 90% interval: -0.02799% to 0.03105%.
- Bootstrap setup: 1200 iterations, 10-session circular blocks, minimum resolvable p-value 0.0008.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | storage gate | risk mult | rank | train edge | validation edge | holdout edge | full edge | Sharpe | maxDD |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | storage-drawdown-400bcf | 1.25x | 137.9441 | 45.37% | 25% | 23.38% | 179.13% | 1.31 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | storage-drawdown-400bcf | 1.25x | 135.8251 | 46.29% | 22.88% | 22.84% | 174.44% | 1.31 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | storage-drawdown-400bcf | 1.2x | 134.9576 | 43.4% | 23.95% | 22.41% | 169.92% | 1.3 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | storage-drawdown-400bcf | 1.25x | 133.6901 | 47.2% | 20.78% | 22.3% | 169.73% | 1.3 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | storage-drawdown-400bcf | 1.2x | 133.0176 | 44.27% | 21.93% | 21.89% | 165.51% | 1.29 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-125 | no | none | 1.25x | 132.9717 | 40.55% | 25.15% | 17.6% | 153.95% | 1.23 | -24.55% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-125 | yes | none | 1.25x | 132.1477 | 42.35% | 22.67% | 17.08% | 150.55% | 1.23 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | storage-drawdown-400bcf | 1.15x | 131.9881 | 41.44% | 22.9% | 21.44% | 160.9% | 1.29 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | storage-drawdown-400bcf | 1.25x | 131.5576 | 48.1% | 18.69% | 21.75% | 165% | 1.29 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-125 | yes | none | 1.25x | 131.1552 | 44.16% | 20.22% | 16.56% | 147.1% | 1.22 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | storage-drawdown-400bcf | 1.2x | 130.8811 | 45.13% | 19.92% | 21.37% | 161.09% | 1.28 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-120 | yes | none | 1.2x | 130.6917 | 38.84% | 24.09% | 16.89% | 146.37% | 1.22 | -24.38% |
| ngas-alpha-fade-primary-confirmed-follow-risk-off | no | none | 1x | 130.0541 | 0.45% | 28.29% | 7.08% | 57.69% | 1.21 | -27.94% |
| ngas-alpha-net-additive-parent-overlay | no | none | 1x | 130.0236 | 22.94% | 26.55% | -1.06% | 76.41% | 1.04 | -31.21% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | storage-drawdown-400bcf | 1.15x | 130.0226 | 42.27% | 20.97% | 20.95% | 156.77% | 1.28 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-120 | yes | none | 1.2x | 129.8637 | 40.55% | 21.73% | 16.4% | 143.16% | 1.22 | -23.66% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-125 | yes | none | 1.25x | 129.5812 | 45.96% | 17.8% | 16.04% | 143.6% | 1.21 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | storage-drawdown-400bcf | 1.1x | 129.1111 | 39.49% | 21.86% | 20.47% | 152.07% | 1.27 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-120 | yes | none | 1.2x | 128.9357 | 42.26% | 19.39% | 15.9% | 139.91% | 1.21 | -22.94% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | storage-drawdown-400bcf | 1.2x | 128.8456 | 45.98% | 17.93% | 20.85% | 156.66% | 1.27 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | storage-drawdown-600bcf | 1.25x | 128.7199 | 40.75% | 21.05% | 22.42% | 157.8% | 1.26 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-115 | yes | none | 1.15x | 128.3682 | 37.14% | 23.04% | 16.19% | 138.91% | 1.21 | -24.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | storage-drawdown-400bcf | 1.15x | 128.1281 | 43.08% | 19.06% | 20.45% | 152.63% | 1.27 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | storage-drawdown-600bcf | 1.25x | 127.5954 | 41.64% | 19.62% | 21.88% | 154.84% | 1.26 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-115 | yes | none | 1.15x | 127.5867 | 38.76% | 20.79% | 15.72% | 135.9% | 1.21 | -23.53% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-120 | yes | none | 1.2x | 127.2422 | 43.97% | 17.08% | 15.4% | 136.62% | 1.2 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | storage-drawdown-400bcf | 1.1x | 127.1816 | 40.27% | 20.03% | 20% | 148.21% | 1.27 | -23.03% |
| ngas-alpha-net-additive-parent-overlay-graded-shift-sizing | no | none | 1x | 126.9892 | 29.29% | 23.15% | -0.24% | 83.21% | 1.07 | -30.39% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-115 | yes | none | 1.15x | 126.5342 | 40.38% | 18.56% | 15.24% | 132.84% | 1.2 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | storage-drawdown-600bcf | 1.25x | 126.2959 | 42.53% | 18.19% | 21.34% | 151.85% | 1.25 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | storage-drawdown-600bcf | 1.2x | 126.1794 | 39% | 20.18% | 21.49% | 149.91% | 1.25 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | storage-drawdown-400bcf | 1.15x | 126.1411 | 43.88% | 17.16% | 19.96% | 148.48% | 1.26 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-110 | yes | none | 1.1x | 125.9482 | 35.44% | 22% | 15.48% | 131.59% | 1.2 | -24.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | storage-drawdown-400bcf | 1.1x | 125.3256 | 41.04% | 18.21% | 19.53% | 144.34% | 1.26 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-110 | yes | none | 1.1x | 125.1332 | 36.97% | 19.86% | 15.03% | 128.75% | 1.2 | -23.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | storage-drawdown-600bcf | 1.2x | 124.9809 | 39.86% | 18.81% | 20.98% | 147.12% | 1.25 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | storage-drawdown-600bcf | 1.25x | 124.9694 | 43.4% | 16.76% | 20.8% | 148.81% | 1.25 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-115 | yes | none | 1.15x | 124.7312 | 41.99% | 16.36% | 14.77% | 129.74% | 1.19 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-110 | yes | none | 1.1x | 123.9992 | 38.5% | 17.74% | 14.58% | 125.88% | 1.19 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | storage-drawdown-600bcf | 1.2x | 123.7944 | 40.7% | 17.44% | 20.46% | 144.3% | 1.24 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | storage-drawdown-600bcf | 1.15x | 123.5624 | 37.27% | 19.3% | 20.57% | 142.16% | 1.24 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | storage-drawdown-400bcf | 1.1x | 123.4651 | 41.8% | 16.4% | 19.06% | 140.45% | 1.25 | -23.03% |
| ngas-alpha-net-additive-parent-overlay-block-adverse-2f | no | none | 1x | 123.2418 | 35.46% | 18.57% | -1.09% | 82.91% | 1.06 | -29.99% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 123.2186 | 35.64% | 19.79% | 18.55% | 134.97% | 1.24 | -23.23% |
| ngas-alpha-dual-follow-first | no | none | 1x | 123.1906 | 22.57% | 21.93% | -9.1% | 48.86% | 0.94 | -31.42% |
| ngas-alpha-fade-primary-confirmed-follow | no | none | 1x | 123.1466 | 2.78% | 38.8% | 9.53% | 84.55% | 1.07 | -30.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | storage-drawdown-600bcf | 1.2x | 122.4664 | 41.53% | 16.08% | 19.95% | 141.44% | 1.24 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | storage-drawdown-600bcf | 1.15x | 122.4074 | 38.08% | 18% | 20.08% | 139.54% | 1.24 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-110 | yes | none | 1.1x | 122.2222 | 40.03% | 15.64% | 14.13% | 122.97% | 1.18 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 121.3751 | 36.33% | 18.14% | 18.13% | 131.62% | 1.24 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | storage-drawdown-600bcf | 1.15x | 121.2939 | 38.87% | 16.69% | 19.59% | 136.89% | 1.23 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing | yes | none | 1x | 121.2882 | 32.07% | 19.92% | 14.07% | 117.31% | 1.18 | -23.74% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | storage-drawdown-600bcf | 1.1x | 121.0239 | 35.55% | 18.43% | 19.64% | 134.55% | 1.23 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing | yes | none | 1x | 120.3887 | 33.43% | 17.99% | 13.67% | 114.82% | 1.17 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 120.1536 | 36.34% | 18.24% | 14.77% | 123.42% | 1.21 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | storage-drawdown-600bcf | 1.15x | 120.0049 | 39.66% | 15.39% | 19.09% | 134.21% | 1.22 | -22.93% |
| ngas-alpha-fade-primary-confirmed-follow-graded-shift-sizing | no | none | 1x | 119.9191 | 6.2% | 32.97% | 11% | 84.97% | 1.09 | -27.63% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | storage-drawdown-600bcf | 1.1x | 119.8629 | 36.31% | 17.19% | 19.18% | 132.1% | 1.22 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 119.7161 | 37.01% | 16.5% | 17.7% | 128.25% | 1.23 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f | yes | none | 1x | 119.1136 | 32.75% | 18.37% | 10.42% | 106.38% | 1.14 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 118.8911 | 31.85% | 18.58% | 19.07% | 126.35% | 1.21 | -23.5% |
| ngas-alpha-weather-hybrid-parent-risk-off | no | none | 1x | 118.7995 | -9.46% | 25.34% | -2.38% | 16.81% | 1.06 | -25.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing | yes | none | 1x | 118.7937 | 34.78% | 16.09% | 13.26% | 112.31% | 1.17 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | storage-drawdown-600bcf | 1.1x | 118.6379 | 37.06% | 15.95% | 18.71% | 129.62% | 1.22 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 118.6051 | 34.1% | 17.1% | 18.44% | 125.87% | 1.21 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 118.2131 | 36.37% | 15.62% | 17.79% | 125.34% | 1.21 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 117.9451 | 37.68% | 14.88% | 17.28% | 124.88% | 1.22 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 117.8731 | 38.64% | 14.16% | 17.15% | 124.73% | 1.21 | -23.5% |
| ngas-alpha-dual-follow-first-graded-shift-sizing | no | none | 1x | 117.8551 | 26.61% | 17.16% | -6.83% | 52.59% | 0.96 | -31.13% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 117.5981 | 35.56% | 16.79% | 14.39% | 117.97% | 1.2 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | storage-drawdown-600bcf | 1.1x | 117.5269 | 37.8% | 14.71% | 18.24% | 127.1% | 1.21 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing | yes | none | 1x | 117.2462 | 36.14% | 14.2% | 12.85% | 109.77% | 1.16 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25 | yes | none | 1x | 117.0122 | 37.08% | 13.48% | 12.73% | 109.62% | 1.16 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50 | yes | none | 1x | 116.9177 | 34.14% | 15.21% | 13.35% | 109.53% | 1.15 | -23.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f | yes | none | 1x | 116.8111 | 32.66% | 16.64% | 10.06% | 101.88% | 1.13 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75 | yes | none | 1x | 116.0917 | 31.23% | 16.95% | 13.97% | 109.37% | 1.15 | -24.65% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 115.6614 | 32.13% | 16.7% | 17.8% | 119.77% | 1.2 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | storage-drawdown-400bcf | 1.25x | 115.6386 | 40.28% | 14.01% | 24.74% | 146.32% | 1.24 | -24.48% |
| ngas-alpha-short-fade-priority | no | none | 1x | 115.3276 | 25.22% | 15.41% | -15.25% | 28.26% | 0.86 | -30.59% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 115.1111 | 34.77% | 15.35% | 14.02% | 112.58% | 1.18 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long | yes | none | 1x | 115.0927 | 28.35% | 18.71% | 14.58% | 109.15% | 1.14 | -25.51% |
| ngas-alpha-dual-follow-first-block-adverse-2f | no | none | 1x | 114.8507 | 31.24% | 13.45% | -4.59% | 58.55% | 0.98 | -30.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 114.6264 | 32.8% | 15.58% | 17.39% | 117.63% | 1.2 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f | yes | none | 1x | 114.3726 | 32.57% | 14.93% | 9.71% | 97.41% | 1.12 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 113.6304 | 33.47% | 14.46% | 16.97% | 115.46% | 1.19 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 113.5652 | 40.62% | 14.65% | 16.5% | 127.81% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | storage-drawdown-400bcf | 1.2x | 113.5356 | 38.55% | 13.45% | 23.7% | 139.09% | 1.23 | -24.51% |
| ngas-alpha-short-fade-priority-graded-shift-sizing | no | none | 1x | 112.7051 | 27.32% | 12.52% | -12.85% | 32.18% | 0.88 | -30.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 112.6066 | 32.81% | 15.18% | 14.04% | 108.77% | 1.17 | -22.09% |
| ngas-alpha-fade-primary-confirmed-follow-block-adverse-2f | yes | none | 1x | 112.554 | 7.74% | 26.44% | 8.45% | 71.15% | 1.04 | -23.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 112.5381 | 33.98% | 13.91% | 13.65% | 107.25% | 1.16 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 112.5309 | 34.13% | 13.35% | 16.55% | 113.27% | 1.18 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow | yes | none | 1x | 112.4525 | 36.91% | 14.77% | 12.1% | 110.49% | 1.16 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 112.4252 | 38.1% | 15.21% | 16.86% | 125.32% | 1.22 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 112.4114 | 35.06% | 12.64% | 16.41% | 113.13% | 1.18 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 112.1944 | 32.84% | 13.6% | 17.06% | 112.66% | 1.18 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f | yes | none | 1x | 112.0821 | 32.46% | 13.24% | 9.35% | 92.97% | 1.11 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-125 | yes | none | 1.25x | 112.0542 | 37.36% | 13.48% | 18.9% | 125.16% | 1.16 | -25.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 111.8274 | 30.62% | 14.56% | 17.69% | 112.14% | 1.17 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 111.4124 | 28.42% | 15.52% | 18.33% | 111.56% | 1.17 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing | yes | none | 1x | 111.2785 | 34.45% | 15.33% | 12.44% | 108.14% | 1.15 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | storage-drawdown-400bcf | 1.15x | 111.1646 | 36.83% | 12.89% | 22.67% | 131.99% | 1.22 | -24.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 110.7421 | 32.05% | 14.25% | 13.67% | 104.58% | 1.16 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-120 | yes | none | 1.2x | 110.3377 | 35.79% | 12.95% | 18.13% | 119.23% | 1.16 | -25.59% |
| ngas-alpha-short-fade-priority-block-adverse-2f | no | none | 1x | 110.0809 | 30.22% | 10.13% | -13.09% | 31.81% | 0.88 | -29.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 108.8796 | 31.27% | 13.32% | 13.3% | 100.41% | 1.14 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | storage-drawdown-400bcf | 1.1x | 108.7366 | 35.11% | 12.33% | 21.64% | 125.01% | 1.21 | -24.57% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-115 | yes | none | 1.15x | 108.5777 | 34.22% | 12.41% | 17.37% | 113.38% | 1.15 | -25.38% |
| ngas-alpha-weather-fade-first | no | none | 1x | 108.5711 | 0.72% | 24.9% | -7.6% | 22.41% | 0.84 | -28.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | storage-drawdown-600bcf | 1.25x | 108.4944 | 35.79% | 11.54% | 23.77% | 129.6% | 1.2 | -24.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 108.3559 | 18.11% | 21.18% | 12.44% | 89.99% | 1.11 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 107.6112 | 32.88% | 14.43% | 13.28% | 105.47% | 1.16 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f | yes | none | 1x | 107.2446 | 14.9% | 21.31% | 8.18% | 74.75% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 107.1066 | 30.5% | 12.4% | 12.93% | 96.29% | 1.13 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-110 | yes | none | 1.1x | 106.6762 | 32.66% | 11.88% | 16.6% | 107.62% | 1.14 | -25.18% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f | yes | none | 1x | 106.5282 | 29.34% | 14.55% | 8.99% | 89.36% | 1.09 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | storage-drawdown-600bcf | 1.2x | 106.4874 | 34.28% | 11.08% | 22.78% | 123.35% | 1.19 | -24.51% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 106.0849 | 17.79% | 19.7% | 12.42% | 86.56% | 1.1 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f | yes | none | 1x | 105.1536 | 15.2% | 19.55% | 8.16% | 72.1% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 104.9097 | 37% | 11.69% | 15.77% | 112.99% | 1.18 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | storage-drawdown-600bcf | 1.15x | 104.4484 | 32.77% | 10.62% | 21.79% | 117.2% | 1.18 | -24.54% |
| ngas-alpha-short-fade-confirmed-long-risk-off | no | none | 1x | 104.2441 | 20.71% | 3.23% | 7.67% | 50.84% | 1.21 | -20.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 103.9466 | 31.72% | 11.21% | 19.58% | 111.43% | 1.18 | -24.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 103.8424 | 17.46% | 18.23% | 12.39% | 83.15% | 1.09 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 103.7592 | 34.53% | 12.24% | 16.12% | 110.62% | 1.18 | -23.23% |
| ngas-alpha-weather-fade-first-graded-shift-sizing | no | none | 1x | 103.6581 | 3.71% | 19.52% | -5.57% | 23.68% | 0.85 | -27.13% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 103.2061 | 31.37% | 10.56% | 20.48% | 111.46% | 1.17 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f | yes | none | 1x | 103.0766 | 15.48% | 17.81% | 8.13% | 69.45% | 1.03 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing | yes | none | 1x | 102.9117 | 29.56% | 10.81% | 15.08% | 96.32% | 1.12 | -24.77% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | storage-drawdown-600bcf | 1.1x | 102.2704 | 31.27% | 10.16% | 20.8% | 111.14% | 1.17 | -24.57% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 101.8741 | 29.61% | 15.83% | 5.37% | 83.78% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 101.6184 | 17.12% | 16.77% | 12.37% | 79.77% | 1.08 | -23.1% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f | yes | none | 1x | 101.3127 | 29.51% | 15.28% | 1.35% | 73.11% | 1.05 | -22.04% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 101.2517 | 24.66% | 16.35% | 7.02% | 80.19% | 1.09 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone | yes | none | 1x | 100.9742 | 29.21% | 10.16% | 15.95% | 96.34% | 1.11 | -25.9% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f | yes | none | 1x | 100.9136 | 15.76% | 16.07% | 8.11% | 66.8% | 1.02 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 100.7903 | 14.96% | 18.07% | 11.74% | 76.89% | 1.07 | -23.1% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing | yes | none | 1x | 100.6327 | 24.57% | 15.8% | 2.94% | 69.67% | 1.04 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 99.8031 | 28.4% | 10.39% | 15.36% | 94.08% | 1.12 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 99.3088 | 14.64% | 17.12% | 11.71% | 74.53% | 1.06 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f | yes | none | 1x | 99.1146 | 26.28% | 9.99% | 11% | 79.84% | 1.06 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 98.9992 | 29.42% | 11.47% | 12.56% | 91.69% | 1.11 | -22.09% |
| ngas-alpha-weather-fade-first-block-adverse-2f | yes | none | 1x | 98.8346 | 10.43% | 13.56% | -5.93% | 24.43% | 0.85 | -26.26% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 98.6762 | 35.49% | 9.61% | 19.16% | 113.82% | 1.18 | -24.79% |
| ngas-alpha-net-additive-parent-overlay-close-confirm-1_5f | no | none | 1x | 98.5938 | 26.45% | 11.17% | 5.46% | 69.98% | 1.01 | -31.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 98.0464 | 28.28% | 9.24% | 18.83% | 99.3% | 1.14 | -24.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 97.7813 | 14.32% | 16.17% | 11.69% | 72.17% | 1.05 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 97.356 | 16.78% | 17.29% | 12.34% | 80.06% | 1.08 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 97.2824 | 27.94% | 8.6% | 19.73% | 99.34% | 1.14 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone | yes | none | 1x | 96.7185 | 31.89% | 9.73% | 14.67% | 97.26% | 1.12 | -25.43% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 96.6737 | 32.77% | 9.96% | 18.72% | 108.65% | 1.17 | -24.64% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f | yes | none | 1x | 96.371 | 13.58% | 17.41% | 8.08% | 65.33% | 1.01 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 96.1518 | 13.99% | 15.22% | 11.66% | 69.81% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing | yes | none | 1x | 95.42 | 29.23% | 10.08% | 14.25% | 92.37% | 1.1 | -24.83% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 94.3867 | 26.22% | 12.39% | 4.7% | 70.15% | 1.05 | -22.04% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 93.8816 | 21.38% | 12.88% | 6.34% | 66.72% | 1.04 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 93.7266 | 25.03% | 8.44% | 14.64% | 82.66% | 1.08 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 93.4124 | 15.53% | 13.15% | 13.02% | 71.63% | 1.05 | -23.8% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 93.4012 | 18.81% | 14.94% | 8.16% | 70.14% | 1.04 | -23.02% |
| ngas-alpha-short-fade-confirmed-long-graded-shift-sizing | yes | none | 1x | 93.3991 | 27.16% | 13.57% | 10.63% | 87.49% | 1.1 | -24.91% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow | yes | none | 1x | 92.7172 | 18.73% | 14.39% | 4.05% | 60% | 1 | -23.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f | yes | none | 1x | 92.6361 | 13.58% | 12.74% | 8.74% | 58.5% | 0.99 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 92.2372 | 26.58% | 9.51% | 14.61% | 87.41% | 1.1 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f | yes | none | 1x | 91.3722 | 23.17% | 9.63% | 10.28% | 72.28% | 1.03 | -24.1% |
| ngas-alpha-short-fade-confirmed-long-block-adverse-2f | yes | none | 1x | 91.1781 | 21.87% | 14.14% | 6.63% | 70.49% | 1.04 | -23.79% |
| ngas-alpha-net-additive-parent-overlay-close-confirm-3f | no | none | 1x | 91.1116 | 27.29% | 7.37% | 4.01% | 61.05% | 0.98 | -32.42% |
| ngas-alpha-net-additive-parent-overlay-spared-confirm-1_5f | no | none | 1x | 89.8986 | 29.78% | 4.99% | 1.7% | 55.41% | 0.97 | -30.52% |
| ngas-alpha-short-fade-confirmed-long | yes | none | 1x | 89.7431 | 28.12% | 11.45% | 9.68% | 82.81% | 1.08 | -25.17% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 89.7052 | 31.98% | 6.76% | 18.41% | 99.65% | 1.14 | -24.79% |
| ngas-alpha-dual-follow-first-close-confirm-1_5f | no | none | 1x | 89.5301 | 25% | 5.84% | -0.85% | 44.24% | 0.92 | -32.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-3f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 89.2679 | 12.45% | 15.62% | 10.51% | 65.37% | 1.02 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 88.9949 | 13.66% | 14.27% | 11.64% | 67.46% | 1.03 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 88.346 | 16.83% | 12.13% | 3.58% | 51.95% | 0.98 | -22.35% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 88.1982 | 29.32% | 7.1% | 17.98% | 94.72% | 1.13 | -24.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-3f | yes | none | 1x | 87.9195 | 9.36% | 15.75% | 6.31% | 51.47% | 0.96 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 87.4168 | 12.43% | 11.16% | 12.31% | 61.1% | 1.01 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-3f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 87.2459 | 12.14% | 14.2% | 10.48% | 62.24% | 1.01 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 87.0915 | 16.5% | 11.4% | 3.56% | 50.11% | 0.97 | -22.32% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 87.0805 | 14.86% | 12.24% | 12.97% | 68.67% | 1.04 | -23.8% |
| ngas-alpha-dual-follow-first-close-confirm-3f | no | none | 1x | 86.8543 | 27.94% | 3.06% | -1.05% | 43.23% | 0.92 | -33.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-spared-confirm-1_5f | yes | none | 1x | 86.5573 | 13.63% | 12.25% | -0.37% | 38.75% | 0.91 | -22.35% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-1_5f | yes | none | 1x | 86.023 | 11.7% | 12.37% | 8.69% | 54.56% | 0.97 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 86.008 | 16.17% | 10.67% | 3.53% | 48.28% | 0.96 | -22.29% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-3f | yes | none | 1x | 85.7985 | 9.65% | 14.05% | 6.29% | 49.05% | 0.95 | -23.48% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 85.6331 | 15.65% | 11.51% | 7.48% | 57.18% | 1 | -23.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-spared-confirm-1_5f | yes | none | 1x | 85.4903 | 13.92% | 11.25% | -0.4% | 37.53% | 0.91 | -22.32% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-3f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 84.9119 | 11.82% | 12.78% | 10.45% | 59.13% | 1 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 84.4785 | 15.83% | 9.94% | 3.51% | 46.44% | 0.96 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-spared-confirm-1_5f | yes | none | 1x | 84.3168 | 14.2% | 10.26% | -0.42% | 36.3% | 0.9 | -22.29% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 84.2989 | 12.97% | 15.84% | 4.09% | 53.03% | 0.99 | -22.78% |
| ngas-alpha-fade-primary-confirmed-follow-close-confirm-1_5f | no | none | 1x | 83.9831 | -4.13% | 20.8% | 11.79% | 46.87% | 0.95 | -26.39% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-3f | yes | none | 1x | 83.7175 | 9.92% | 12.37% | 6.26% | 46.63% | 0.94 | -23.48% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-1_5f | yes | none | 1x | 83.6537 | 12.88% | 15.29% | 0.11% | 43.55% | 0.94 | -22.78% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 83.4762 | 23.25% | 6.65% | 13.89% | 74.46% | 1.05 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-spared-confirm-1_5f | yes | none | 1x | 83.0128 | 14.48% | 9.28% | -0.44% | 35.06% | 0.9 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-3f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 82.7524 | 11.5% | 11.37% | 10.43% | 56.04% | 0.99 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-3f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 82.0929 | 9.42% | 12.62% | 9.81% | 53.42% | 0.98 | -23.48% |
| ngas-alpha-short-fade-priority-close-confirm-1_5f | no | none | 1x | 82.0094 | 19.54% | 3.22% | -8.46% | 16.3% | 0.81 | -30.88% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-3f | yes | none | 1x | 81.683 | 10.19% | 10.7% | 6.24% | 44.22% | 0.93 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 81.6492 | 15.49% | 11.1% | 3.49% | 47.83% | 0.96 | -22.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 81.223 | 13.71% | 9.22% | 2.92% | 40.65% | 0.93 | -22.35% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-3f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 80.5554 | 9.12% | 11.71% | 9.78% | 51.26% | 0.97 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 80.5135 | 13.39% | 8.97% | 2.9% | 39.68% | 0.93 | -22.32% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-3f-storage-drawdown-400bcf | no | storage-drawdown-400bcf | 1x | 80.4377 | 10.66% | 16.25% | 3.77% | 49.17% | 0.97 | -23.91% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-3f | no | none | 1x | 79.9366 | 10.57% | 15.7% | -0.2% | 39.85% | 0.93 | -23.91% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 79.832 | 13.06% | 8.72% | 2.88% | 38.7% | 0.92 | -22.29% |
| ngas-alpha-short-fade-plus-cold-follow-spared-confirm-1_5f | yes | none | 1x | 79.8059 | 12.31% | 11.23% | -0.47% | 34.85% | 0.9 | -22.23% |
| ngas-alpha-short-fade-confirmed-long-close-confirm-1_5f | yes | none | 1x | 79.749 | 6.53% | 16.37% | 8.12% | 51.36% | 0.98 | -24.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 79.0975 | 12.73% | 8.47% | 2.85% | 37.72% | 0.92 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-3f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 78.9794 | 8.8% | 10.79% | 9.76% | 49.11% | 0.96 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 78.7119 | 11.78% | 9.33% | 12.26% | 56.59% | 0.99 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-3f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 78.6391 | 11.17% | 11.87% | 10.4% | 56.32% | 0.99 | -23.48% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 78.2765 | 30.68% | 2.92% | 21.84% | 96.64% | 1.12 | -26.09% |
| ngas-alpha-dual-follow-first-spared-confirm-1_5f | no | none | 1x | 78.1507 | 26.75% | 0% | -0.57% | 37.11% | 0.89 | -31.91% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 77.766 | 14.11% | 7.77% | 3.7% | 40.4% | 0.93 | -23.28% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-3f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 77.4839 | 8.49% | 9.88% | 9.73% | 46.96% | 0.95 | -23.48% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow | yes | none | 1x | 77.3199 | 29.86% | 2.05% | 17.26% | 83.47% | 1.07 | -26.33% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-3f | yes | none | 1x | 77.0037 | 8.09% | 11.99% | 6.21% | 42.87% | 0.92 | -23.48% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 76.8172 | 9.93% | 12.4% | 3.43% | 40.92% | 0.94 | -22.78% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-graded-shift-sizing-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 76.661 | 27.7% | 3.07% | 20.6% | 89.08% | 1.1 | -26.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-spared-confirm-1_5f | yes | none | 1x | 76.1983 | 12.16% | 7.37% | -0.26% | 28.82% | 0.87 | -23.28% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-graded-shift-sizing | yes | none | 1x | 76.0039 | 26.89% | 2.19% | 16.05% | 76.25% | 1.05 | -26.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-3f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 74.8504 | 9.86% | 8.49% | 11.16% | 49.69% | 0.96 | -23.61% |
| ngas-alpha-short-fade-priority-close-confirm-3f | no | none | 1x | 74.8438 | 19.58% | 0.21% | -9.3% | 9.95% | 0.78 | -31.35% |
| ngas-alpha-short-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 73.9932 | 12.39% | 8.22% | 2.83% | 36.73% | 0.92 | -22.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-3f | yes | none | 1x | 73.742 | 7.99% | 8.1% | 6.95% | 37.66% | 0.9 | -23.61% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 73.5077 | 13.43% | 8.19% | 3.65% | 39.97% | 0.93 | -23.22% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-3f-storage-drawdown-600bcf | no | storage-drawdown-600bcf | 1x | 73.0593 | 7.66% | 12.79% | 3.11% | 37.26% | 0.93 | -23.91% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 72.4568 | 27.26% | 1.97% | 21.08% | 87.03% | 1.09 | -26.09% |
| ngas-alpha-weather-fade-first-close-confirm-1_5f | no | none | 1x | 72.413 | 1.7% | 6.89% | -1.88% | 9.33% | 0.78 | -28.09% |
| ngas-alpha-short-fade-only-block-adverse-2f | yes | none | 1x | 71.8656 | 20% | 7.85% | 0.36% | 42.76% | 0.97 | -22.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 71.743 | 11.04% | 5.86% | 3.04% | 31.14% | 0.89 | -23.28% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 71.6783 | 12.89% | 5.51% | 13.58% | 54.21% | 0.98 | -24.51% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-spared-confirm-1_5f | yes | none | 1x | 71.5729 | 10.3% | 8.31% | -0.31% | 27.42% | 0.86 | -23.22% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-1_5f | yes | none | 1x | 71.4383 | 12.16% | 4.61% | 9.28% | 42.98% | 0.93 | -24.51% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 71.0769 | 8.48% | 11.94% | 3.77% | 38.51% | 0.93 | -24.69% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-graded-shift-sizing-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 70.9278 | 24.35% | 2.11% | 19.84% | 79.71% | 1.07 | -26.04% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-spared-confirm-1_5f | yes | none | 1x | 70.6656 | 8.38% | 11.4% | -0.2% | 29.57% | 0.88 | -24.69% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-block-adverse-2f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 70.5128 | 20.67% | 2.92% | 15.95% | 67.09% | 1.02 | -26.09% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-3f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 70.2583 | 8.17% | 8.97% | 9.71% | 44.81% | 0.94 | -23.48% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-block-adverse-2f | yes | none | 1x | 70.014 | 19.9% | 2.05% | 11.57% | 55.28% | 0.97 | -26.09% |
| ngas-alpha-fade-primary-confirmed-follow-close-confirm-3f | no | none | 1x | 69.8156 | -6.33% | 15.11% | 10.48% | 31.54% | 0.89 | -25.49% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-3f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 69.0224 | 6.88% | 6.57% | 10.46% | 40.04% | 0.93 | -23.61% |
| ngas-alpha-fade-primary-confirmed-follow-spared-confirm-1_5f | no | none | 1x | 68.8729 | -1.74% | 14.22% | 3.05% | 24.07% | 0.86 | -26.19% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-3f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 68.6151 | 9.22% | 7.61% | 11.11% | 46.97% | 0.95 | -23.61% |
| ngas-alpha-short-fade-only-graded-shift-sizing | yes | none | 1x | 68.3227 | 18.97% | 6.69% | 1.48% | 41.56% | 0.96 | -23.79% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-3f | yes | none | 1x | 66.9537 | 6.18% | 7.73% | 6.9% | 34.04% | 0.89 | -23.61% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 66.9302 | 9.85% | 4.54% | 12.87% | 46.01% | 0.95 | -24.51% |
| ngas-alpha-short-fade-priority-spared-confirm-1_5f | no | none | 1x | 66.7128 | 21.09% | -2.15% | -11.92% | 3.07% | 0.75 | -30.61% |
| ngas-alpha-short-fade-confirmed-long-spared-confirm-1_5f | yes | none | 1x | 66.3933 | 6.11% | 11.55% | -0.44% | 25.8% | 0.87 | -23.93% |
| ngas-alpha-short-fade-only | yes | none | 1x | 66.2597 | 20.74% | 5.27% | 0.41% | 39.58% | 0.95 | -24.18% |
| ngas-alpha-weather-fade-first-close-confirm-3f | no | none | 1x | 65.9381 | 2.25% | 3.82% | -2.21% | 4.97% | 0.76 | -28.86% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 65.8947 | 10.38% | 5.37% | 2.99% | 29.23% | 0.88 | -23.22% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-block-adverse-2f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 64.887 | 17.47% | 1.97% | 15.22% | 58.46% | 0.99 | -26.09% |
| ngas-alpha-short-fade-confirmed-long-close-confirm-3f | yes | none | 1x | 63.6681 | 1.3% | 12.52% | 6.24% | 32.54% | 0.9 | -25.15% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 63.4367 | 5.53% | 8.6% | 3.11% | 27.15% | 0.88 | -24.69% |
| ngas-alpha-weather-fade-first-spared-confirm-1_5f | no | none | 1x | 62.4194 | 4.7% | 1.94% | -5.01% | 0.61% | 0.74 | -27.83% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 60.9063 | 11.39% | 3.52% | 3.81% | 29.3% | 0.88 | -24.21% |
| ngas-alpha-short-fade-only-close-confirm-1_5f | yes | none | 1x | 60.3678 | 8.19% | 8.49% | 2.94% | 30.81% | 0.91 | -24.68% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-3f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 60.3618 | 6.26% | 4.8% | 10.41% | 35.91% | 0.91 | -23.61% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-spared-confirm-1_5f | yes | none | 1x | 59.69 | 10.67% | 2.64% | -0.15% | 19.21% | 0.83 | -24.21% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 56.9618 | 8.38% | 2.56% | 3.15% | 21.93% | 0.85 | -24.21% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-3f-storage-drawdown-400bcf | yes | storage-drawdown-400bcf | 1x | 54.73 | 7.25% | 1.67% | 11.82% | 34.77% | 0.9 | -23.75% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-3f | yes | none | 1x | 53.9513 | 6.54% | 0.81% | 7.58% | 24.43% | 0.85 | -23.75% |
| ngas-alpha-short-fade-only-close-confirm-3f | yes | none | 1x | 53.6333 | 5.88% | 6.99% | 2.04% | 23.13% | 0.87 | -25.09% |
| ngas-alpha-short-fade-only-spared-confirm-1_5f | yes | none | 1x | 51.2318 | 8.5% | 5.02% | -0.35% | 19.43% | 0.86 | -24.31% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-3f-storage-drawdown-600bcf | yes | storage-drawdown-600bcf | 1x | 50.1331 | 4.32% | 0.73% | 11.11% | 27.22% | 0.87 | -23.75% |

## Verdict

Load this as an active research-baseline strategy, not broker-ready. The selected blend keeps idle capital in the index fallback so any return improvement comes from explicit gas overlays rather than a cash timing patch. It has cleared the current holdout-edge and bootstrap reality checks, but still needs non-overlapping paper validation before any broker adapter exists.
