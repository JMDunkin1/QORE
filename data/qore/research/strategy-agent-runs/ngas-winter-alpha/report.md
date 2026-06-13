# NGAS Winter Alpha

Generated at 2026-06-13T03:55:52.048Z.

## Purpose

This active QORE research strategy combines parent experts without fitting new weather thresholds: Dual Weather supplies the cold/warm forecast-follow context, Weather Hybrid supplies post-window reversion context, Volatility Mean Reversion can confirm same-direction overreaction fades, optional weather-resolution overlays test whether close-in or already-known actual weather shifted enough to support the fade, and optional EIA storage-drawdown gates test whether cold-follow longs are allowed only after the withdrawal season has consumed enough inventory. The selected blend is ranked on train/validation only, with holdout reported after selection.

## Selected Candidate

- Architecture: Short fade plus cold follow and vol-confirmed long fade + Grade reversion size by close-in weather shift + Cold-follow requires 400 Bcf storage drawdown + 1.25x gas-overlay risk budget.
- Parent experts: Dual Weather Rotation for forecast-follow, Weather Hybrid Rotation for post-window reversion, and Volatility Mean Reversion for same-direction fade confirmation.
- Position policy: Take Dual Weather cold-follow setups directly; keep Weather Hybrid reversion-short setups, adding Dual Weather warm-short exposure when both parent experts point short, and add Weather Hybrid reversion-long setups only when Volatility Mean Reversion confirms the same long-fade direction. Weather-resolution overlay: Scale reversion exposure up when the close-in or already-known actual anomaly confirms the reversion, and shrink it when the weather shift argues against the trade. Storage gate: Allow cold-follow gas longs only after the standard EIA storage release date has confirmed at least a 400 Bcf drawdown from the current withdrawal-season peak. Portfolio risk-budget overlay: scale active gas exposure by 1.25x, capped at 0.6x, without changing signal selection.
- Max weather UNG overlay: 0.45x; parent weather leg 0.25x and weather reversion leg 0.2x.
- Winter-alpha hold overlay: Parent selected hold periods. Keep the parent strategy daily ledgers unchanged; Dual Weather and Weather Hybrid already selected their own follow and reversion hold periods.
- Effective parent-ledger holds: forecast-follow 3 trading day(s), post-window reversion 2 trading day(s).
- Gas-overlay risk multiplier: 1.25x; effective max weather UNG overlay 0.5625x.
- Vol-confirmed reversion-long size: 1x of the parent reversion leg.
- Standalone reversion fade size: 1x of the parent reversion leg when no same-direction follow signal confirms it.
- Weather-resolution overlay: Grade reversion size by close-in weather shift. Scale reversion exposure up when the close-in or already-known actual anomaly confirms the reversion, and shrink it when the weather shift argues against the trade.
- Cold-follow storage gate: Cold-follow requires 400 Bcf storage drawdown. Allow cold-follow gas longs only after the standard EIA storage release date has confirmed at least a 400 Bcf drawdown from the current withdrawal-season peak.
- Idle capital risk mode: Full index fallback for idle capital.
- Cost: 0.064% round trip, charged as 0.032% one-way on UNG position changes.
- Selection: Only predeclared parent-blend policies, parent daily-ledger hold overlays, cold-follow EIA storage-drawdown gates, and bounded gas-overlay risk multipliers are selected on train and validation. Generic idle-index risk-off variants are reported as diagnostics only, and holdout rows after 2025-11-01 are reported after selection.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 127 | 80.42% | 33.7% | 46.72% | 20.06% | 1.03 | 1.63 | -22.72% | 5.4% |
| Validation | 45 | 54.08% | 29.08% | 25% | 31.41% | 1.5 | 2.08 | -14.33% | 3.9% |
| Holdout | 48 | 34.32% | 10.94% | 23.38% | 65.47% | 2.3 | 2.9 | -12.41% | 10.8% |
| Full | 220 | 273.39% | 91.47% | 181.92% | 27.54% | 1.32 | 1.95 | -22.72% | 5.5% |

## Train/Validation Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 29 | 28.23% | 8.99 | -2.08% |
| Warm-short | 58 | 16.35% | 2.19 | -8.03% |
| Reversion-long | 34 | 21.43% | 5.04 | -5.14% |
| Reversion-short | 111 | 22.73% | 1.87 | -7.24% |
| Long-side combined | 61 | 48.25% | 6.23 | -5.14% |
| Short-side combined | 111 | 22.73% | 1.87 | -7.24% |

## Full Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 36 | 34.33% | 6.23 | -7.23% |
| Warm-short | 75 | 40.01% | 3.58 | -8.03% |
| Reversion-long | 43 | 24.78% | 4.95 | -5.14% |
| Reversion-short | 143 | 41.75% | 2.37 | -7.24% |
| Long-side combined | 77 | 59.59% | 5.23 | -7.4% |
| Short-side combined | 143 | 41.75% | 2.37 | -7.24% |
| Index fallback | 1142 | 65.05% | 0.71 | -26.95% |

## Anti-Overfit Check

- Candidate count: 642.
- Eligible candidates: 605.
- Eligibility requires a selectable gas-alpha policy, positive train and validation edge, lower train and validation drawdown than the index basket, and train/validation volatility under a 20% annualized risk budget.
- Index risk-off variants are diagnostic-only because they can create cash-flat equity shelves and are a portfolio overlay rather than a gas-alpha rule.
- Weather-resolution overlays use GFS/GEFS lead-1 to lead-3 forecasts available by the trade date, or target-day actual weather only when the target date is already before the trade date.
- Cold-follow storage gates use EIA Lower 48 working gas storage rows on or after the standard 10:30 a.m. ET Thursday release date, normally six calendar days after the Friday week-ending storage date. The seasonal drawdown is measured from the current withdrawal-season storage peak.
- Hold-period overlays only shorten parent-selected daily ledger holds for the selected graded vol-confirmed family; they do not create new weather signals, extend a parent hold, alter forecast thresholds, or use holdout rows for selection.
- Gas-overlay risk multipliers are predeclared sizing variants on the selected graded vol-confirmed family only; they do not change entry dates, directions, parent signals, or weather thresholds.
- Holdout was not used for selection: yes.
- Primary p-value: 0.0092 (selection-adjusted centered circular block bootstrap).
- Single-candidate p-value: 0.0058.
- Selection-adjusted p-value: 0.0092 across 605 eligible candidates.
- Observed active edge: 0.05067% per day / 12.77% annualized.
- Mean daily-edge 90% bootstrap interval: 0.02263% to 0.08183%.
- Zero-edge null 90% interval: -0.02803% to 0.03116%.
- Bootstrap setup: 1200 iterations, 10-session circular blocks, minimum resolvable p-value 0.0008.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | hold | storage gate | risk mult | rank | train edge | validation edge | holdout edge | full edge | Sharpe | maxDD |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 139.0012 | 46.72% | 25% | 23.38% | 181.92% | 1.32 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 138.7746 | 37.54% | 29.36% | 10.1% | 136.92% | 1.22 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 136.8512 | 47.65% | 22.88% | 22.84% | 177.2% | 1.31 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 136.7971 | 39.29% | 26.81% | 9.61% | 133.64% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 135.9657 | 44.68% | 23.95% | 22.41% | 172.54% | 1.31 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 135.7811 | 35.95% | 28.09% | 9.72% | 130.26% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 135.145 | 30.44% | 30.29% | 20.57% | 152.55% | 1.25 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 134.7522 | 48.57% | 20.78% | 22.3% | 172.45% | 1.3 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 134.7311 | 41.04% | 24.29% | 9.12% | 130.31% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 134.0387 | 45.56% | 21.93% | 21.89% | 168.1% | 1.3 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 133.8976 | 37.61% | 25.66% | 9.26% | 127.16% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 133.106 | 32.12% | 27.73% | 20.04% | 149.11% | 1.25 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-125 | no | parent-selected | none | 1.25x | 132.9717 | 40.55% | 25.15% | 17.6% | 153.95% | 1.23 | -24.55% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 132.9602 | 42.66% | 22.9% | 21.44% | 163.35% | 1.29 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 132.8338 | 32.17% | 28.51% | 13.13% | 132.83% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 132.7611 | 34.36% | 26.83% | 9.34% | 123.7% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 132.6267 | 49.47% | 18.69% | 21.75% | 167.69% | 1.29 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 132.5446 | 42.79% | 21.8% | 8.63% | 126.94% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 132.309 | 29.19% | 28.99% | 19.73% | 144.97% | 1.24 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-125 | yes | parent-selected | none | 1.25x | 132.1477 | 42.35% | 22.67% | 17.08% | 150.55% | 1.23 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 131.9882 | 46.43% | 19.92% | 21.37% | 163.65% | 1.29 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 131.8776 | 39.28% | 23.26% | 8.79% | 124.02% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 131.8398 | 40.75% | 23.17% | 22.42% | 162.73% | 1.28 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 131.6919 | 30.93% | 27.09% | 14.8% | 131.82% | 1.18 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 131.4033 | 29.24% | 28.4% | 19.63% | 143.58% | 1.23 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-125 | yes | parent-selected | none | 1.25x | 131.1552 | 44.16% | 20.22% | 16.56% | 147.1% | 1.22 | -23.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 131.0017 | 43.49% | 20.97% | 20.95% | 159.19% | 1.29 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 130.992 | 33.8% | 25.19% | 19.51% | 145.63% | 1.24 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 130.9886 | 35.94% | 24.52% | 8.89% | 120.79% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 130.8376 | 32.17% | 27.13% | 12.24% | 127.7% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 130.7578 | 33.87% | 25.97% | 12.63% | 129.59% | 1.21 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 130.6917 | 38.84% | 24.09% | 16.89% | 146.37% | 1.22 | -24.38% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 130.5843 | 41.64% | 21.72% | 21.88% | 159.73% | 1.27 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 130.3615 | 30.79% | 26.54% | 19.22% | 141.73% | 1.23 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 130.1908 | 30.91% | 26.53% | 19.1% | 141.64% | 1.23 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 130.0963 | 30.83% | 27.28% | 12.62% | 126.39% | 1.2 | -22.04% |
| ngas-alpha-fade-primary-confirmed-follow-risk-off | no | parent-selected | none | 1x | 130.0541 | 0.45% | 28.29% | 7.08% | 57.69% | 1.21 | -27.94% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 130.0472 | 40.65% | 21.86% | 20.47% | 154.35% | 1.28 | -23.03% |
| ngas-alpha-net-additive-parent-overlay | no | parent-selected | none | 1x | 130.0236 | 22.94% | 26.55% | -1.06% | 76.41% | 1.04 | -31.21% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 129.8936 | 40.94% | 20.88% | 8.31% | 120.84% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 129.8637 | 40.55% | 21.73% | 16.4% | 143.16% | 1.22 | -23.66% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 129.8357 | 47.28% | 17.93% | 20.85% | 159.18% | 1.28 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 129.7816 | 32.79% | 25.58% | 8.96% | 117.26% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 129.7011 | 33.87% | 25.28% | 11.74% | 125.86% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 129.6444 | 32.61% | 24.58% | 14.29% | 128.56% | 1.18 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-125 | yes | parent-selected | none | 1.25x | 129.5812 | 45.96% | 17.8% | 16.04% | 143.6% | 1.21 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 129.495 | 27.95% | 27.69% | 18.89% | 137.52% | 1.23 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 129.2638 | 42.53% | 20.27% | 21.34% | 156.69% | 1.27 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 129.1594 | 29.67% | 25.94% | 14.22% | 125.51% | 1.17 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 129.1062 | 44.31% | 19.06% | 20.45% | 155.02% | 1.28 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 129.0671 | 37.52% | 22.23% | 8.44% | 117.83% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 129.0353 | 39% | 22.2% | 21.49% | 154.53% | 1.27 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 128.9388 | 32.58% | 24.67% | 18.58% | 139.64% | 1.23 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 128.9357 | 42.26% | 19.39% | 15.9% | 139.91% | 1.21 | -22.94% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 128.753 | 35.48% | 22.69% | 18.98% | 142.1% | 1.23 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 128.7423 | 28.05% | 27.18% | 18.83% | 136.52% | 1.22 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 128.6428 | 35.57% | 23.47% | 12.13% | 126.3% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 128.4626 | 35.57% | 23.43% | 11.25% | 123.95% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 128.3682 | 37.14% | 23.04% | 16.19% | 138.91% | 1.21 | -24.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 128.251 | 32.39% | 24.13% | 18.71% | 138.45% | 1.23 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 128.1556 | 30.83% | 25.97% | 11.77% | 121.55% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 128.1247 | 41.43% | 20.03% | 20% | 150.47% | 1.27 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 128.0711 | 34.28% | 23.39% | 8.53% | 114.51% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 128.0093 | 32.45% | 24.86% | 12.14% | 123.33% | 1.2 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 127.9348 | 39.86% | 20.81% | 20.98% | 151.71% | 1.26 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 127.9163 | 43.4% | 18.82% | 20.8% | 153.61% | 1.26 | -22.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 127.6343 | 34.24% | 22.82% | 18.05% | 137.58% | 1.22 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 127.5867 | 38.76% | 20.79% | 15.72% | 135.9% | 1.21 | -23.53% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 127.5829 | 34.29% | 22.09% | 13.78% | 125.26% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 127.5765 | 29.47% | 25.36% | 18.4% | 134.47% | 1.22 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 127.5238 | 29.64% | 25.39% | 18.33% | 134.69% | 1.22 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 127.3313 | 29.49% | 26.06% | 12.1% | 120.05% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 127.2422 | 43.97% | 17.08% | 15.4% | 136.62% | 1.2 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 127.1671 | 37.26% | 21.6% | 10.74% | 121.99% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 127.1544 | 31.27% | 23.54% | 13.73% | 122.44% | 1.17 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 127.1252 | 45.12% | 17.16% | 19.96% | 150.84% | 1.27 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 127.0881 | 39.09% | 19.97% | 7.99% | 114.84% | 1.18 | -22.04% |
| ngas-alpha-net-additive-parent-overlay-graded-shift-sizing | no | parent-selected | none | 1x | 126.9892 | 29.29% | 23.15% | -0.24% | 83.21% | 1.07 | -30.39% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 126.9556 | 32.45% | 24.19% | 11.29% | 119.8% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 126.6588 | 40.7% | 19.43% | 20.46% | 148.85% | 1.26 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 126.6015 | 26.7% | 26.4% | 18.04% | 130.21% | 1.22 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 126.5508 | 37.26% | 20.99% | 11.62% | 122.97% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 126.5342 | 40.38% | 18.56% | 15.24% | 132.84% | 1.2 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 126.5204 | 28.42% | 24.8% | 13.64% | 119.3% | 1.16 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 126.3728 | 37.27% | 21.23% | 20.57% | 146.49% | 1.25 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 126.3663 | 31.23% | 23.62% | 17.82% | 132.81% | 1.21 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 126.2387 | 42.2% | 18.21% | 19.53% | 146.57% | 1.26 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 126.2075 | 33.98% | 21.74% | 18.2% | 135.12% | 1.22 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 126.1901 | 35.77% | 21.21% | 8.1% | 111.73% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 126.1138 | 34.06% | 22.47% | 11.66% | 120.23% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 126.0958 | 26.86% | 25.97% | 18.03% | 129.59% | 1.21 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 125.9482 | 35.44% | 22% | 15.48% | 131.59% | 1.2 | -24.06% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 125.7656 | 34.06% | 22.43% | 10.81% | 118% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 125.6615 | 30.98% | 23.06% | 17.92% | 131.39% | 1.22 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 125.6572 | 31.43% | 25.81% | 11.49% | 121.65% | 1.19 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 125.4439 | 35.96% | 19.63% | 13.27% | 121.92% | 1.16 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 125.4266 | 29.49% | 24.81% | 11.29% | 115.49% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 125.3793 | 31.03% | 23.76% | 11.64% | 117.16% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 125.3291 | 38.33% | 22.59% | 25.02% | 163.27% | 1.29 | -23.67% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 125.3083 | 41.53% | 18.04% | 19.95% | 145.96% | 1.25 | -22.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 125.1968 | 38.08% | 19.91% | 20.08% | 143.84% | 1.25 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 125.1859 | 32.87% | 21.17% | 13.25% | 119.32% | 1.16 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 125.1332 | 36.97% | 19.86% | 15.03% | 128.75% | 1.2 | -23.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 124.9923 | 32.81% | 21.86% | 17.32% | 130.86% | 1.21 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 124.8068 | 28.37% | 24.27% | 17.55% | 127.86% | 1.21 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 124.767 | 28.14% | 24.19% | 17.59% | 127.35% | 1.21 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 124.7312 | 41.99% | 16.36% | 14.77% | 129.74% | 1.19 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 124.6779 | 29.93% | 22.51% | 13.17% | 116.4% | 1.16 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 124.5371 | 35.67% | 20.68% | 10.33% | 116.14% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 124.5238 | 28.16% | 24.85% | 11.59% | 113.81% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 124.4142 | 42.97% | 16.4% | 19.06% | 142.66% | 1.25 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 124.4096 | 37.26% | 19.06% | 7.67% | 108.92% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 124.2691 | 31.03% | 23.12% | 10.84% | 113.84% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 124.0638 | 38.87% | 18.59% | 19.59% | 141.16% | 1.24 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 124.0614 | 27.16% | 23.66% | 13.05% | 113.18% | 1.15 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 124.0537 | 36.67% | 19.79% | 18.55% | 136.94% | 1.25 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 124.0508 | 35.67% | 20.11% | 11.17% | 117.09% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 123.9992 | 38.5% | 17.74% | 14.58% | 125.88% | 1.19 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 123.8151 | 29.66% | 23.11% | 8.18% | 104.68% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 123.7163 | 29.88% | 22.58% | 17.07% | 126.08% | 1.2 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 123.6908 | 35.55% | 20.27% | 19.64% | 138.6% | 1.24 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 123.657 | 32.49% | 20.79% | 17.43% | 128.27% | 1.21 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 123.5007 | 32.96% | 23.32% | 10.75% | 117.6% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 123.4348 | 32.56% | 21.49% | 11.18% | 114.24% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 123.3043 | 25.67% | 24.76% | 17.23% | 122.77% | 1.2 | -22.47% |
| ngas-alpha-net-additive-parent-overlay-block-adverse-2f | no | parent-selected | none | 1x | 123.2418 | 35.46% | 18.57% | -1.09% | 82.91% | 1.06 | -29.99% |
| ngas-alpha-dual-follow-first | no | parent-selected | none | 1x | 123.1906 | 22.57% | 21.93% | -9.1% | 48.86% | 0.94 | -31.42% |
| ngas-alpha-fade-primary-confirmed-follow | no | parent-selected | none | 1x | 123.1466 | 2.78% | 38.8% | 9.53% | 84.55% | 1.07 | -30.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 123.1246 | 39.05% | 20.5% | 24.2% | 157.73% | 1.28 | -23.67% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 123.0754 | 34.46% | 18.82% | 12.76% | 116.17% | 1.15 | -22.22% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 123.0712 | 30.11% | 24.71% | 11.04% | 115.84% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 123.0581 | 32.56% | 21.44% | 10.38% | 112.14% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 122.929 | 29.58% | 22.01% | 17.12% | 124.45% | 1.2 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 122.8509 | 31.45% | 20.25% | 12.71% | 113.46% | 1.15 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 122.8146 | 36.68% | 21.64% | 23.97% | 154.99% | 1.28 | -23.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 122.7628 | 39.66% | 17.27% | 19.09% | 138.44% | 1.24 | -22.93% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 122.6568 | 29.61% | 22.67% | 11.15% | 111.09% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 122.5578 | 36.31% | 19.01% | 19.18% | 136.12% | 1.24 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 122.5386 | 28.16% | 23.65% | 10.81% | 109.52% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 122.3783 | 31.38% | 20.9% | 16.59% | 124.26% | 1.2 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 122.2222 | 40.03% | 15.64% | 14.13% | 122.97% | 1.18 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 122.2102 | 37.36% | 18.14% | 18.13% | 133.57% | 1.24 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 122.0926 | 30.98% | 21.14% | 7.8% | 102.26% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 122.0819 | 28.6% | 21.49% | 12.61% | 110.45% | 1.15 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 122.0573 | 27.1% | 23.14% | 16.77% | 121.15% | 1.19 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 121.9626 | 34.08% | 19.77% | 9.92% | 110.39% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 121.5658 | 34.08% | 19.23% | 10.72% | 111.28% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 121.4866 | 29.61% | 22.05% | 10.38% | 107.96% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 121.3227 | 34.48% | 20.86% | 10.01% | 113.53% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 121.3118 | 37.06% | 17.75% | 18.71% | 133.61% | 1.23 | -23.03% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing | yes | parent-selected | none | 1x | 121.2882 | 32.07% | 19.92% | 14.07% | 117.31% | 1.18 | -23.74% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 121.0985 | 31.01% | 19.84% | 16.66% | 121.52% | 1.2 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 121.0732 | 31.57% | 22.33% | 10.34% | 112.01% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 121.0316 | 37.37% | 18.24% | 14.77% | 125.32% | 1.22 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 121.0133 | 28.53% | 21.54% | 16.32% | 119.48% | 1.19 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 120.9341 | 39.75% | 18.43% | 23.38% | 152.21% | 1.27 | -23.67% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 120.902 | 24.22% | 23.85% | 16.37% | 115.98% | 1.19 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 120.8563 | 31.06% | 20.5% | 10.71% | 108.35% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 120.7979 | 32.96% | 18.01% | 12.24% | 110.49% | 1.14 | -22.34% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 120.6881 | 37.37% | 19.65% | 23.19% | 149.78% | 1.27 | -23.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 120.6342 | 27.73% | 24.17% | 22.2% | 137.9% | 1.23 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 120.5812 | 38.04% | 16.5% | 17.7% | 130.18% | 1.23 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 120.4902 | 28.8% | 23.61% | 10.6% | 110.11% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 120.4891 | 32.31% | 19.19% | 7.41% | 99.82% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 120.4596 | 31.06% | 20.45% | 9.95% | 106.36% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing | yes | parent-selected | none | 1x | 120.3887 | 33.43% | 17.99% | 13.67% | 114.82% | 1.17 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 120.2869 | 30.03% | 19.33% | 12.17% | 107.69% | 1.14 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 120.2606 | 35.05% | 20.7% | 22.92% | 146.87% | 1.26 | -23.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 120.1903 | 37.8% | 16.5% | 18.24% | 131.06% | 1.22 | -23.03% |
| ngas-alpha-fade-primary-confirmed-follow-graded-shift-sizing | no | parent-selected | none | 1x | 119.9191 | 6.2% | 32.97% | 11% | 84.97% | 1.09 | -27.63% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 119.9013 | 29.95% | 19.94% | 15.86% | 117.76% | 1.19 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 119.8502 | 26.25% | 24.98% | 14.55% | 117.75% | 1.18 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 119.7082 | 32.85% | 18.58% | 19.07% | 128.27% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 119.4342 | 35.12% | 17.1% | 18.44% | 127.79% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 119.335 | 25.5% | 21.87% | 15.95% | 113.48% | 1.18 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 119.2956 | 32.51% | 18.87% | 9.51% | 104.72% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f | yes | parent-selected | none | 1x | 119.1136 | 32.75% | 18.37% | 10.42% | 106.38% | 1.14 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 119.0652 | 37.39% | 15.62% | 17.79% | 127.25% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 119.0567 | 36.01% | 18.42% | 9.27% | 109.44% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 118.9693 | 32.51% | 18.36% | 10.27% | 105.57% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 118.9687 | 33.02% | 19.98% | 9.63% | 108.16% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 118.8958 | 25.51% | 22.45% | 10.55% | 101.63% | 1.15 | -22.04% |
| ngas-alpha-weather-hybrid-parent-risk-off | no | parent-selected | none | 1x | 118.7995 | -9.46% | 25.34% | -2.38% | 16.81% | 1.06 | -25.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing | yes | parent-selected | none | 1x | 118.7937 | 34.78% | 16.09% | 13.26% | 112.31% | 1.17 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 118.7862 | 38.72% | 14.88% | 17.28% | 126.79% | 1.22 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 118.7411 | 33.63% | 17.25% | 7.02% | 97.36% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 118.7142 | 39.68% | 14.16% | 17.15% | 126.64% | 1.22 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 118.6874 | 24.65% | 21.4% | 11.88% | 101.2% | 1.13 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 118.6536 | 40.45% | 16.38% | 22.56% | 146.71% | 1.25 | -23.67% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 118.5732 | 30.18% | 21.35% | 9.92% | 106.49% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 118.5281 | 38.04% | 17.67% | 22.4% | 144.59% | 1.26 | -23.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 118.4827 | 29.22% | 21.7% | 21.4% | 133.63% | 1.22 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 118.4401 | 36.58% | 16.79% | 14.39% | 119.84% | 1.2 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 118.4214 | 31.46% | 17.2% | 11.72% | 104.89% | 1.13 | -22.47% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 118.3669 | 32.44% | 22.73% | 19.17% | 136.69% | 1.2 | -26.24% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 118.2702 | 26.59% | 23.15% | 21.28% | 131.14% | 1.22 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 118.2386 | 35.69% | 18.8% | 22.17% | 141.98% | 1.25 | -23.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 118.1356 | 32.63% | 20.79% | 24.05% | 145.03% | 1.25 | -23.67% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 118.0278 | 32.13% | 18.35% | 17.8% | 123.28% | 1.21 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 117.8742 | 27.5% | 22.53% | 10.15% | 104.46% | 1.15 | -22.04% |
| ngas-alpha-dual-follow-first-graded-shift-sizing | no | parent-selected | none | 1x | 117.8551 | 26.61% | 17.16% | -6.83% | 52.59% | 0.96 | -31.13% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 117.6942 | 27.74% | 22.5% | 13.79% | 113.75% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 117.6196 | 33.42% | 19.76% | 21.87% | 138.91% | 1.25 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 117.6138 | 23.3% | 22.37% | 15.64% | 109.49% | 1.17 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 117.564 | 26.78% | 19.91% | 15.54% | 110.94% | 1.18 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 117.5085 | 26.25% | 23.64% | 13.65% | 112.87% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 117.4272 | 25.17% | 23.92% | 13.97% | 112.14% | 1.17 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing | yes | parent-selected | none | 1x | 117.2462 | 36.14% | 14.2% | 12.85% | 109.77% | 1.16 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 117.1694 | 34% | 20.3% | 18.38% | 132.49% | 1.19 | -25.57% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 117.1658 | 26.8% | 20.49% | 10.16% | 99.24% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 117.0932 | 28.21% | 21.09% | 16.36% | 118.05% | 1.16 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 117.0923 | 32.8% | 17.22% | 17.39% | 121.12% | 1.21 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 117.0489 | 25.93% | 19.45% | 11.49% | 98.8% | 1.13 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25 | yes | parent-selected | none | 1x | 117.0122 | 37.08% | 13.48% | 12.73% | 109.62% | 1.16 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50 | yes | parent-selected | none | 1x | 116.9177 | 34.14% | 15.21% | 13.35% | 109.53% | 1.15 | -23.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 116.8156 | 25.51% | 21.37% | 9.86% | 97.86% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f | yes | parent-selected | none | 1x | 116.8111 | 32.66% | 16.64% | 10.06% | 101.88% | 1.13 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 116.8057 | 34.46% | 17.66% | 8.92% | 104.3% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 116.7813 | 24.57% | 20.92% | 15.23% | 108.06% | 1.17 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-125 | yes | parent-selected | storage-drawdown-400bcf | 1.25x | 116.6777 | 41.6% | 14.01% | 24.74% | 148.87% | 1.25 | -24.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 116.6351 | 33.33% | 19.36% | 23.23% | 141.19% | 1.24 | -23.67% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 116.5836 | 26.55% | 22.35% | 21.25% | 129.31% | 1.21 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 116.5482 | 31.56% | 19.11% | 9.25% | 102.87% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 116.5129 | 31.1% | 21.79% | 18.39% | 130.08% | 1.19 | -26.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 116.4412 | 30.72% | 19.27% | 20.59% | 129.35% | 1.21 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 116.3401 | 38.69% | 15.71% | 21.62% | 139.42% | 1.24 | -23.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 116.1992 | 28.01% | 20.79% | 20.51% | 127.12% | 1.21 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 116.1566 | 36.33% | 16.92% | 21.43% | 137.12% | 1.24 | -23.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 116.1285 | 27.74% | 21.82% | 12.9% | 110.2% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 116.1279 | 35.56% | 17.89% | 17.59% | 128.27% | 1.18 | -24.88% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75 | yes | parent-selected | none | 1x | 116.0917 | 31.23% | 16.95% | 13.97% | 109.37% | 1.15 | -24.65% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 116.0843 | 33.47% | 16.08% | 16.97% | 118.93% | 1.2 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 116.0452 | 28.8% | 20.37% | 9.51% | 101.06% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 115.9531 | 35.79% | 15.35% | 14.02% | 114.41% | 1.19 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 115.8812 | 25.45% | 22.13% | 20.36% | 124.5% | 1.2 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 115.8066 | 26.8% | 19.93% | 9.46% | 96.49% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 115.7945 | 28.06% | 17.96% | 15.12% | 108.38% | 1.17 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 115.7761 | 31.26% | 19.92% | 23.04% | 137.85% | 1.24 | -23.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 115.7446 | 34.03% | 17.96% | 21.17% | 134.34% | 1.24 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 115.6893 | 25.85% | 19.48% | 14.81% | 106.59% | 1.17 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 115.5127 | 29.21% | 20.05% | 13.03% | 109.73% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 115.5118 | 28.09% | 18.55% | 9.76% | 96.83% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 115.3787 | 26.58% | 21.55% | 13.24% | 108.36% | 1.16 | -22.04% |
| ngas-alpha-short-fade-priority | no | parent-selected | none | 1x | 115.3276 | 25.22% | 15.41% | -15.25% | 28.26% | 0.86 | -30.59% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 115.3164 | 32.59% | 19.46% | 17.64% | 126.11% | 1.18 | -25.38% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 115.2999 | 27.21% | 17.51% | 11.09% | 96.37% | 1.12 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 115.2866 | 28.04% | 20.55% | 20.45% | 126.5% | 1.2 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 115.215 | 25.17% | 22.63% | 13.11% | 107.52% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 115.1292 | 24.09% | 22.86% | 13.39% | 106.61% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 115.1112 | 29.71% | 18.67% | 15.59% | 114.02% | 1.15 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long | yes | parent-selected | none | 1x | 115.0927 | 28.35% | 18.71% | 14.58% | 109.15% | 1.14 | -25.51% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 115.0466 | 32.81% | 16.81% | 14.04% | 112.16% | 1.18 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 115.0216 | 34.01% | 17.93% | 22.42% | 137.33% | 1.23 | -23.67% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 114.9653 | 34.13% | 14.96% | 16.55% | 116.71% | 1.2 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 114.9347 | 27.06% | 20.22% | 15.7% | 112.49% | 1.15 | -22.4% |
| ngas-alpha-dual-follow-first-block-adverse-2f | no | parent-selected | none | 1x | 114.8507 | 31.24% | 13.45% | -4.59% | 58.55% | 0.98 | -30.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 114.8353 | 35.06% | 14.24% | 16.41% | 116.57% | 1.19 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 114.8111 | 28.09% | 18.5% | 9.07% | 95.08% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1-risk-125 | yes | fh3-rh1 | none | 1.25x | 114.6964 | 37.11% | 15.5% | 16.81% | 124.03% | 1.17 | -24.2% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 114.6235 | 29.21% | 20.02% | 12.14% | 107.5% | 1.16 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 114.5888 | 32.84% | 15.21% | 17.06% | 116.1% | 1.19 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 114.5492 | 32.93% | 16.89% | 8.57% | 99.23% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-120 | yes | parent-selected | storage-drawdown-400bcf | 1.2x | 114.5327 | 39.8% | 13.45% | 23.7% | 141.49% | 1.24 | -24.51% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 114.5308 | 27.12% | 18.05% | 14.4% | 105.09% | 1.16 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 114.5174 | 29.77% | 20.84% | 17.61% | 123.57% | 1.18 | -25.83% |
| ngas-alpha-short-fade-plus-cold-follow-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 114.4774 | 41.67% | 14.65% | 16.5% | 129.74% | 1.23 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f | yes | parent-selected | none | 1x | 114.3726 | 32.57% | 14.93% | 9.71% | 97.41% | 1.12 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 114.3216 | 25.46% | 21.41% | 20.37% | 123.05% | 1.2 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 114.2844 | 34.06% | 17.16% | 16.89% | 122.13% | 1.17 | -24.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 114.2416 | 31.92% | 18.55% | 22.26% | 134.23% | 1.23 | -23.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 114.2413 | 30.62% | 16.18% | 17.69% | 115.57% | 1.18 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 114.1767 | 32.2% | 16.86% | 19.79% | 125.05% | 1.2 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 114.1532 | 29.43% | 18.47% | 19.74% | 123.08% | 1.2 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 114.0997 | 30.11% | 18.24% | 8.86% | 97.65% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 113.9531 | 36.95% | 15.05% | 20.68% | 132.27% | 1.23 | -23.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 113.8942 | 26.8% | 19.89% | 19.63% | 120.71% | 1.2 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 113.8278 | 28.42% | 17.15% | 18.33% | 114.98% | 1.18 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 113.8016 | 29.38% | 17.07% | 8.68% | 93.63% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 113.7933 | 29.38% | 16.62% | 9.37% | 94.39% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 113.7811 | 29.52% | 18.76% | 19.65% | 123.65% | 1.2 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 113.7625 | 26.58% | 20.9% | 12.39% | 105% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 113.7056 | 34.63% | 16.16% | 20.46% | 129.78% | 1.23 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 113.5744 | 28.49% | 15.6% | 10.68% | 93.92% | 1.11 | -22.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 113.4417 | 24.31% | 21.12% | 19.44% | 117.96% | 1.19 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 113.4336 | 29.9% | 19.05% | 22.04% | 130.79% | 1.22 | -23.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 113.4074 | 31.17% | 18.62% | 16.89% | 119.83% | 1.17 | -25.2% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 113.4041 | 34.99% | 13.91% | 13.65% | 109.05% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 113.3014 | 39.14% | 15.21% | 16.86% | 127.24% | 1.22 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 113.2906 | 34.68% | 16.51% | 21.61% | 133.45% | 1.22 | -23.67% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 113.2287 | 30.69% | 17.63% | 12.27% | 105.69% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 113.2117 | 27.99% | 19.21% | 12.52% | 104.56% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 113.1716 | 32.05% | 15.87% | 13.67% | 107.92% | 1.17 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2-risk-125 | yes | fh1-rh2 | none | 1.25x | 113.0911 | 33.02% | 14.75% | 10.9% | 100.71% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 113.0887 | 25.43% | 20.61% | 12.7% | 103.04% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 113.0795 | 30.69% | 18.22% | 11.39% | 104.76% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 112.9356 | 26.88% | 19.69% | 19.61% | 120.39% | 1.19 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 112.9182 | 28.48% | 17.91% | 14.97% | 108.68% | 1.14 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 112.9147 | 31.2% | 16.28% | 14.82% | 109.97% | 1.14 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 112.8687 | 25.91% | 19.34% | 15.05% | 107% | 1.14 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 112.8662 | 24.9% | 20.37% | 9.26% | 93.42% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 112.865 | 24.09% | 21.63% | 12.57% | 102.25% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1-risk-120 | yes | fh3-rh1 | none | 1.2x | 112.8334 | 35.54% | 14.88% | 16.14% | 118.13% | 1.16 | -24.07% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 112.7956 | 32.57% | 17.19% | 21.49% | 130.59% | 1.22 | -23.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 112.7157 | 23.02% | 21.81% | 12.81% | 101.16% | 1.15 | -22.04% |
| ngas-alpha-short-fade-priority-graded-shift-sizing | no | parent-selected | none | 1x | 112.7051 | 27.32% | 12.52% | -12.85% | 32.18% | 0.88 | -30.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 112.6064 | 28.43% | 19.9% | 16.83% | 117.16% | 1.17 | -25.62% |
| ngas-alpha-fade-primary-confirmed-follow-block-adverse-2f | yes | parent-selected | none | 1x | 112.554 | 7.74% | 26.44% | 8.45% | 71.15% | 1.04 | -23.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 112.4569 | 32.58% | 16.43% | 16.18% | 116.08% | 1.16 | -24.57% |
| ngas-alpha-short-fade-plus-cold-follow | yes | parent-selected | none | 1x | 112.4525 | 36.91% | 14.77% | 12.1% | 110.49% | 1.16 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 112.444 | 27.99% | 19.17% | 11.67% | 102.44% | 1.15 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 112.4416 | 30.2% | 17.9% | 19.79% | 123.47% | 1.22 | -24.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 112.2621 | 30.99% | 16.98% | 18.86% | 120.76% | 1.19 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 112.1522 | 31.41% | 16.13% | 8.22% | 94.22% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-115 | yes | parent-selected | storage-drawdown-400bcf | 1.15x | 112.0827 | 38.01% | 12.89% | 22.67% | 134.24% | 1.22 | -24.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f | yes | parent-selected | none | 1x | 112.0821 | 32.46% | 13.24% | 9.35% | 92.97% | 1.11 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-125 | yes | parent-selected | none | 1.25x | 112.0542 | 37.36% | 13.48% | 18.9% | 125.16% | 1.16 | -25.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 112.0287 | 30.85% | 16.16% | 18.98% | 119.03% | 1.19 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 112.0266 | 24.38% | 20.47% | 19.49% | 116.88% | 1.18 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 111.9576 | 30.52% | 17.75% | 21.3% | 127.39% | 1.22 | -23.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 111.8802 | 28.15% | 17.67% | 18.9% | 116.91% | 1.19 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 111.6831 | 28.29% | 17.98% | 18.85% | 117.7% | 1.19 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 111.6399 | 29.76% | 17.79% | 16.15% | 113.65% | 1.16 | -25.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 111.5926 | 35.22% | 14.38% | 19.75% | 125.24% | 1.22 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 111.5892 | 25.6% | 18.99% | 18.74% | 114.41% | 1.18 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 111.5735 | 25.43% | 19.98% | 11.88% | 99.86% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.25x | 111.498 | 30.29% | 16.89% | 20.72% | 123.7% | 1.19 | -24.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-125 | yes | parent-selected | storage-drawdown-600bcf | 1.25x | 111.4583 | 35.79% | 13.52% | 23.77% | 134.13% | 1.21 | -24.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 111.2986 | 31.27% | 14.93% | 13.3% | 103.71% | 1.15 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing | yes | parent-selected | none | 1x | 111.2785 | 34.45% | 15.33% | 12.44% | 108.14% | 1.15 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 111.2252 | 29.39% | 16.9% | 11.8% | 100.74% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 111.1156 | 33.21% | 15.83% | 20.71% | 126.94% | 1.21 | -23.75% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 111.1102 | 26.77% | 18.38% | 12.01% | 99.45% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 111.0942 | 26.06% | 18.43% | 8.68% | 90.42% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 111.0149 | 33.97% | 14.25% | 15.46% | 112.31% | 1.15 | -23.94% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 110.9835 | 29.39% | 17.46% | 10.95% | 99.85% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 110.9736 | 28.54% | 18.19% | 21.04% | 123.86% | 1.21 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 110.9017 | 29.9% | 15.62% | 14.23% | 104.85% | 1.13 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 110.8407 | 24.29% | 19.67% | 12.15% | 97.79% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2-risk-120 | yes | fh1-rh2 | none | 1.2x | 110.8271 | 31.62% | 14.15% | 10.49% | 96.05% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 110.8067 | 27.26% | 17.14% | 14.35% | 103.4% | 1.13 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 110.7767 | 32.68% | 13.92% | 14.05% | 105.91% | 1.13 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 110.7426 | 25.72% | 18.83% | 18.77% | 114.38% | 1.18 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 110.6391 | 30.74% | 16.27% | 19.16% | 119.49% | 1.21 | -24.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 110.6162 | 24.76% | 18.47% | 14.39% | 101.58% | 1.13 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 110.5814 | 31.09% | 15.7% | 15.47% | 110.12% | 1.15 | -24.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 110.4526 | 31.14% | 16.45% | 20.56% | 123.97% | 1.21 | -23.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 110.41 | 23.02% | 20.63% | 12.03% | 97.05% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-120 | yes | parent-selected | none | 1.2x | 110.3377 | 35.79% | 12.95% | 18.13% | 119.23% | 1.16 | -25.59% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 110.146 | 26.77% | 18.33% | 11.2% | 97.45% | 1.14 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 110.1231 | 29.69% | 16.28% | 18.08% | 114.97% | 1.18 | -22.4% |
| ngas-alpha-short-fade-priority-block-adverse-2f | no | parent-selected | none | 1x | 110.0809 | 30.22% | 10.13% | -13.09% | 31.81% | 0.88 | -29.11% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 109.7592 | 29.49% | 15.47% | 18.17% | 113.09% | 1.18 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 109.6622 | 26.87% | 16.87% | 18.05% | 110.84% | 1.18 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-risk-110 | yes | parent-selected | storage-drawdown-400bcf | 1.1x | 109.6617 | 36.24% | 12.33% | 21.64% | 127.12% | 1.21 | -24.57% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 109.6576 | 29.13% | 16.95% | 20.33% | 120.67% | 1.2 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.2x | 109.6455 | 29.03% | 16.2% | 19.87% | 117.78% | 1.18 | -24.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 109.6446 | 23.3% | 19.53% | 18.62% | 110.81% | 1.17 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-125 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.25x | 109.5238 | 29.1% | 16.39% | 19.78% | 118.1% | 1.17 | -24.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 109.4956 | 30.5% | 13.99% | 12.93% | 99.54% | 1.14 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-120 | yes | parent-selected | storage-drawdown-600bcf | 1.2x | 109.3673 | 34.28% | 12.98% | 22.78% | 127.62% | 1.2 | -24.51% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 109.3311 | 27.06% | 17.2% | 18.04% | 111.84% | 1.17 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 109.3137 | 27.22% | 16.52% | 8.09% | 87.42% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 109.2435 | 24.29% | 19.06% | 11.38% | 94.8% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 109.0688 | 19.03% | 21.18% | 12.44% | 91.69% | 1.12 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 109.0307 | 28.1% | 16.17% | 11.31% | 95.85% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 109.0019 | 32.41% | 13.63% | 14.79% | 106.58% | 1.14 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 108.9412 | 28.61% | 14.95% | 13.65% | 99.79% | 1.12 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 108.8996 | 31.27% | 14.66% | 18.53% | 115.52% | 1.2 | -24.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 108.8972 | 25.55% | 17.54% | 11.49% | 94.42% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 108.8636 | 31.74% | 15.15% | 19.82% | 120.54% | 1.2 | -23.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 108.8567 | 31.31% | 13.36% | 13.5% | 101.01% | 1.12 | -22.4% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 108.7335 | 28.1% | 16.7% | 10.51% | 95% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 108.7092 | 26.04% | 16.37% | 13.73% | 98.19% | 1.12 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 108.6399 | 25.78% | 18.03% | 15.28% | 104.64% | 1.15 | -25.21% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2-risk-115 | yes | fh1-rh2 | none | 1.15x | 108.6076 | 30.23% | 13.54% | 10.07% | 91.45% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 108.5972 | 22.05% | 19.11% | 17.61% | 105.23% | 1.16 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-115 | yes | parent-selected | none | 1.15x | 108.5777 | 34.22% | 12.41% | 17.37% | 113.38% | 1.15 | -25.38% |
| ngas-alpha-weather-fade-first | no | parent-selected | none | 1x | 108.5711 | 0.72% | 24.9% | -7.6% | 22.41% | 0.84 | -28.84% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 108.4724 | 33.89% | 14.43% | 13.28% | 107.26% | 1.16 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 108.3596 | 24.57% | 17.97% | 17.93% | 108.46% | 1.17 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2-risk-125 | yes | fh2-rh2 | none | 1.25x | 108.3219 | 30.77% | 13.95% | 14.94% | 104.66% | 1.11 | -24.19% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 108.1916 | 29.71% | 15.71% | 19.63% | 117.46% | 1.19 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 107.9801 | 28.4% | 15.58% | 17.32% | 109.27% | 1.17 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 107.8702 | 20.87% | 19.72% | 11.65% | 90.49% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 107.8489 | 26.96% | 16.13% | 14.67% | 101.56% | 1.14 | -24.66% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 107.8345 | 25.55% | 17.5% | 10.72% | 92.53% | 1.13 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-120 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.2x | 107.6643 | 27.89% | 15.72% | 18.97% | 112.49% | 1.16 | -24.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 107.6537 | 28.15% | 14.78% | 17.36% | 107.25% | 1.17 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.15x | 107.521 | 27.78% | 15.51% | 19.01% | 111.94% | 1.16 | -24.27% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 107.4787 | 28.38% | 14.62% | 7.51% | 84.41% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 107.3705 | 37% | 13.28% | 15.77% | 116.43% | 1.19 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.25x | 107.3243 | 27.8% | 13.98% | 13.95% | 97.07% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f | yes | parent-selected | none | 1x | 107.2446 | 14.9% | 21.31% | 8.18% | 74.75% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 107.1361 | 25.84% | 16.42% | 17.24% | 106.07% | 1.16 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-115 | yes | parent-selected | storage-drawdown-600bcf | 1.15x | 107.1238 | 32.77% | 12.43% | 21.79% | 121.21% | 1.19 | -24.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-125 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.25x | 107.0341 | 27.8% | 13.94% | 13.06% | 94.93% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 106.9522 | 26.82% | 15.44% | 10.83% | 91.03% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1-risk-125 | yes | fh1-rh1 | none | 1.25x | 106.9312 | 28.28% | 14.39% | 9.49% | 88.4% | 1.09 | -22.12% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 106.9272 | 27.32% | 14.29% | 13.06% | 94.79% | 1.11 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 106.9062 | 23.19% | 17.19% | 16.99% | 102.11% | 1.16 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 106.8821 | 31.8% | 13.05% | 17.89% | 111.57% | 1.19 | -24.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 106.8718 | 18.7% | 19.7% | 12.42% | 88.24% | 1.11 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 106.8552 | 29.95% | 12.79% | 12.95% | 96.17% | 1.11 | -22.54% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 106.7334 | 28.14% | 14.24% | 14.06% | 98.46% | 1.13 | -24.12% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-risk-110 | yes | parent-selected | none | 1.1x | 106.6762 | 32.66% | 11.88% | 16.6% | 107.62% | 1.14 | -25.18% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 106.6576 | 30.29% | 14.47% | 18.93% | 114.25% | 1.18 | -23.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2-risk-120 | yes | fh2-rh2 | none | 1.2x | 106.6229 | 29.5% | 13.39% | 14.35% | 99.85% | 1.11 | -24.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 106.601 | 26.82% | 15.95% | 10.07% | 90.22% | 1.12 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f | yes | parent-selected | none | 1x | 106.5282 | 29.34% | 14.55% | 8.99% | 89.36% | 1.09 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2-risk-110 | yes | fh1-rh2 | none | 1.1x | 106.3556 | 28.85% | 12.94% | 9.65% | 86.91% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 106.2952 | 22.01% | 17.8% | 11.06% | 87.53% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 106.2507 | 22.47% | 16.74% | 13.09% | 90.97% | 1.11 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 106.22 | 34.53% | 13.83% | 16.12% | 114.03% | 1.19 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 106.1941 | 25.83% | 16.48% | 19.04% | 110.37% | 1.18 | -24.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 105.7301 | 27.11% | 14.88% | 16.55% | 103.66% | 1.16 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-115 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.15x | 105.5653 | 26.69% | 15.04% | 18.16% | 106.95% | 1.15 | -24.27% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 105.3845 | 20.87% | 18.66% | 10.95% | 86.87% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.2x | 105.3578 | 26.64% | 13.41% | 13.4% | 92.59% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.25x | 105.2716 | 31.44% | 13.62% | 24.82% | 128.46% | 1.2 | -25.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-400bcf | 1.1x | 105.1775 | 26.52% | 14.82% | 18.16% | 106.19% | 1.15 | -24.32% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f | yes | parent-selected | none | 1x | 105.1536 | 15.2% | 19.55% | 8.16% | 72.1% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 105.1172 | 24.33% | 15.29% | 16.36% | 98.98% | 1.15 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 105.0051 | 26.36% | 15.36% | 18.41% | 107.58% | 1.17 | -24.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-120 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.2x | 105.0006 | 26.64% | 13.37% | 12.54% | 90.56% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 104.9586 | 21.14% | 17.67% | 16.87% | 98.96% | 1.15 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1-risk-120 | yes | fh1-rh1 | none | 1.2x | 104.9057 | 27.1% | 13.8% | 9.13% | 84.4% | 1.08 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 104.9042 | 28.59% | 12.23% | 12.39% | 91.38% | 1.1 | -22.68% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 104.8744 | 29.32% | 12.38% | 13.44% | 95.36% | 1.12 | -24.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-risk-110 | yes | parent-selected | storage-drawdown-600bcf | 1.1x | 104.8308 | 31.27% | 11.89% | 20.8% | 114.9% | 1.18 | -24.57% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 104.7937 | 32.72% | 11.21% | 19.58% | 113.26% | 1.18 | -24.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2-risk-115 | yes | fh2-rh2 | none | 1.15x | 104.7129 | 28.23% | 12.83% | 13.76% | 95.09% | 1.1 | -24.27% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 104.6593 | 18.37% | 18.23% | 12.39% | 84.81% | 1.09 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 104.5842 | 23.61% | 14.85% | 12.48% | 87.98% | 1.1 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 104.3467 | 23.14% | 15.89% | 10.46% | 84.55% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 104.3095 | 22.01% | 17.24% | 10.36% | 84.88% | 1.11 | -22.04% |
| ngas-alpha-short-fade-confirmed-long-risk-off | no | parent-selected | none | 1x | 104.2441 | 20.71% | 3.23% | 7.67% | 50.84% | 1.21 | -20.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 104.0472 | 32.36% | 10.56% | 20.48% | 113.29% | 1.18 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 103.8406 | 22.28% | 16.27% | 16.25% | 96.89% | 1.14 | -22.96% |
| ngas-alpha-weather-fade-first-graded-shift-sizing | no | parent-selected | none | 1x | 103.6581 | 3.71% | 19.52% | -5.57% | 23.68% | 0.85 | -27.13% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 103.6281 | 26.88% | 14.24% | 17.78% | 104.78% | 1.17 | -24.08% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.2x | 103.5201 | 30.12% | 13.07% | 23.77% | 122.25% | 1.19 | -25.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 103.3062 | 14.96% | 19.73% | 11.74% | 79.92% | 1.08 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 103.2912 | 25.47% | 13.41% | 15.74% | 95.84% | 1.14 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.15x | 103.2623 | 25.48% | 12.84% | 12.84% | 88.17% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2-risk-110 | yes | fh2-rh2 | storage-drawdown-600bcf | 1.1x | 103.2608 | 25.49% | 14.37% | 17.35% | 101.5% | 1.14 | -24.32% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 103.1225 | 23.14% | 15.84% | 9.76% | 82.88% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f | yes | parent-selected | none | 1x | 103.0766 | 15.48% | 17.81% | 8.13% | 69.45% | 1.03 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-115 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.15x | 102.9361 | 25.48% | 12.8% | 12.03% | 86.24% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing | yes | parent-selected | none | 1x | 102.9117 | 29.56% | 10.81% | 15.08% | 96.32% | 1.12 | -24.77% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1-risk-115 | yes | fh1-rh1 | none | 1.15x | 102.8997 | 25.92% | 13.22% | 8.77% | 80.44% | 1.08 | -22.41% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 102.8232 | 24.75% | 12.97% | 11.88% | 84.99% | 1.09 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2-risk-110 | yes | fh2-rh2 | none | 1.1x | 102.7909 | 26.97% | 12.27% | 13.17% | 90.39% | 1.09 | -24.32% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 102.6536 | 23.41% | 14.87% | 15.63% | 94.8% | 1.14 | -22.96% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 102.6236 | 30.59% | 15.83% | 5.37% | 85.44% | 1.11 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 102.5372 | 24.27% | 14% | 9.87% | 81.57% | 1.1 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 102.4053 | 18.03% | 16.77% | 12.37% | 81.4% | 1.08 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 102.2766 | 27.39% | 13.13% | 17.15% | 101.97% | 1.16 | -24.08% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 102.0065 | 25.62% | 16.35% | 7.02% | 81.83% | 1.09 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh2 | yes | fh1-rh2 | none | 1x | 101.8736 | 26.1% | 11.74% | 8.8% | 77.97% | 1.08 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 101.8545 | 24.27% | 14.44% | 9.17% | 80.85% | 1.09 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 101.8142 | 14.64% | 18.77% | 11.71% | 77.53% | 1.07 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.15x | 101.7621 | 28.81% | 12.53% | 22.73% | 116.13% | 1.18 | -25.27% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 101.4233 | 29.42% | 13.06% | 12.56% | 94.89% | 1.12 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 101.4096 | 24.54% | 13.49% | 15.01% | 92.68% | 1.13 | -22.96% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f | yes | parent-selected | none | 1x | 101.3127 | 29.51% | 15.28% | 1.35% | 73.11% | 1.05 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-400bcf | 1.1x | 101.2058 | 24.33% | 12.27% | 12.29% | 83.8% | 1.09 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.25x | 101.1602 | 23.2% | 13.62% | 12.5% | 84.92% | 1.09 | -22.12% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 101.0512 | 25.89% | 11.11% | 11.28% | 81.98% | 1.08 | -22.96% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone | yes | parent-selected | none | 1x | 100.9742 | 29.21% | 10.16% | 15.95% | 96.34% | 1.11 | -25.9% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1-risk-110 | yes | fh1-rh1 | none | 1.1x | 100.9302 | 24.75% | 12.63% | 8.41% | 76.51% | 1.07 | -22.56% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f | yes | parent-selected | none | 1x | 100.9136 | 15.76% | 16.07% | 8.11% | 66.8% | 1.02 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-400bcf | 1x | 100.8195 | 24.03% | 13.44% | 16.47% | 94.94% | 1.13 | -24.41% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2-risk-110 | yes | fh1-rh2 | storage-drawdown-600bcf | 1.1x | 100.6621 | 24.33% | 12.22% | 11.51% | 81.98% | 1.09 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 100.6511 | 29.38% | 10.39% | 15.36% | 95.81% | 1.13 | -24.1% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing | yes | parent-selected | none | 1x | 100.6327 | 24.57% | 15.8% | 2.94% | 69.67% | 1.04 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-125 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.25x | 100.427 | 23.2% | 13.59% | 11.62% | 82.87% | 1.08 | -22.12% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 100.3883 | 28.28% | 10.8% | 18.83% | 102.59% | 1.15 | -24.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.25x | 100.2837 | 25.97% | 13.16% | 20.83% | 107.79% | 1.15 | -23.87% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 100.2762 | 14.32% | 17.81% | 11.69% | 75.15% | 1.06 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-400bcf | 1.1x | 100.0466 | 27.5% | 11.98% | 21.69% | 110.11% | 1.17 | -25.29% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1-risk-125 | no | fh3-rh1 | none | 1.25x | 99.9389 | 27.45% | 13.09% | 18.97% | 106.17% | 1.12 | -26.92% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 99.6643 | 27.94% | 10.16% | 19.73% | 102.62% | 1.15 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 99.5704 | 36.51% | 9.61% | 19.16% | 115.66% | 1.19 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-125 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.25x | 99.5076 | 25.98% | 13.13% | 23.85% | 114.61% | 1.17 | -25.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.2x | 99.3057 | 22.25% | 13.07% | 12.01% | 81.08% | 1.08 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f | yes | parent-selected | none | 1x | 99.1146 | 26.28% | 9.99% | 11% | 79.84% | 1.06 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh2 | yes | fh2-rh2 | storage-drawdown-600bcf | 1x | 99.0138 | 23.11% | 13.03% | 15.74% | 90.82% | 1.12 | -24.41% |
| ngas-alpha-weather-fade-first-block-adverse-2f | yes | parent-selected | none | 1x | 98.8346 | 10.43% | 13.56% | -5.93% | 24.43% | 0.85 | -26.26% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1-risk-120 | no | fh3-rh1 | none | 1.2x | 98.8269 | 26.33% | 12.57% | 18.2% | 101.28% | 1.11 | -26.69% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.2x | 98.7842 | 24.9% | 12.63% | 19.97% | 102.73% | 1.14 | -23.95% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh2 | yes | fh2-rh2 | none | 1x | 98.6839 | 24.45% | 11.15% | 11.98% | 81.14% | 1.07 | -24.41% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 98.6362 | 13.99% | 16.85% | 11.66% | 72.76% | 1.05 | -23.1% |
| ngas-alpha-net-additive-parent-overlay-close-confirm-1_5f | no | parent-selected | none | 1x | 98.5938 | 26.45% | 11.17% | 5.46% | 69.98% | 1.01 | -31.72% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-120 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.2x | 98.434 | 22.25% | 13.03% | 11.16% | 79.13% | 1.07 | -22.26% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 98.1932 | 17.69% | 17.29% | 12.34% | 81.7% | 1.08 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-120 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.2x | 97.8401 | 24.91% | 12.6% | 22.85% | 109.18% | 1.16 | -25.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-125 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.25x | 97.8286 | 24.8% | 12.67% | 19.89% | 102.47% | 1.13 | -23.87% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1-risk-115 | yes | fh3-rh1 | none | 1.15x | 97.6909 | 25.22% | 12.05% | 17.43% | 96.44% | 1.1 | -26.46% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.15x | 97.5877 | 21.3% | 12.51% | 11.52% | 77.28% | 1.07 | -22.41% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 97.5319 | 33.78% | 9.96% | 18.72% | 110.46% | 1.18 | -24.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.15x | 97.2652 | 23.83% | 12.09% | 19.11% | 97.74% | 1.13 | -24.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1-risk-125 | yes | fh2-rh1 | none | 1.25x | 97.0957 | 26.43% | 10.3% | 15.04% | 89.71% | 1.08 | -23.87% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-400bcf | 1x | 96.9658 | 22.04% | 11.13% | 11.18% | 75.21% | 1.07 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh1-rh1 | yes | fh1-rh1 | none | 1x | 96.8617 | 22.42% | 11.46% | 7.68% | 68.78% | 1.05 | -22.86% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 96.7198 | 26.22% | 13.96% | 4.7% | 73.06% | 1.06 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone | yes | parent-selected | none | 1x | 96.7185 | 31.89% | 9.73% | 14.67% | 97.26% | 1.12 | -25.43% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-115 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.15x | 96.649 | 21.3% | 12.47% | 10.71% | 75.43% | 1.06 | -22.41% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-400bcf | 1x | 96.4436 | 24.89% | 10.88% | 19.63% | 98.36% | 1.14 | -25.33% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f | yes | parent-selected | none | 1x | 96.371 | 13.58% | 17.41% | 8.08% | 65.33% | 1.01 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1-risk-110 | yes | fh3-rh1 | none | 1.1x | 96.3669 | 24.11% | 11.53% | 16.66% | 91.65% | 1.1 | -26.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-120 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.2x | 96.2791 | 23.79% | 12.16% | 19.07% | 97.7% | 1.13 | -23.95% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh2 | yes | fh1-rh2 | storage-drawdown-600bcf | 1x | 96.2681 | 22.04% | 11.08% | 10.48% | 73.58% | 1.07 | -22.04% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 96.2189 | 21.38% | 14.46% | 6.34% | 69.6% | 1.05 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-115 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.15x | 96.2166 | 23.85% | 12.07% | 21.85% | 103.83% | 1.14 | -25.27% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 96.1136 | 25.03% | 9.99% | 14.64% | 85.76% | 1.09 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-400bcf | 1.1x | 95.7132 | 20.35% | 11.96% | 11.02% | 73.52% | 1.06 | -22.56% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1-risk-120 | yes | fh2-rh1 | none | 1.2x | 95.6382 | 25.35% | 9.89% | 14.45% | 85.68% | 1.07 | -23.95% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-400bcf | 1.1x | 95.5937 | 22.76% | 11.56% | 18.25% | 92.82% | 1.12 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing | yes | parent-selected | none | 1x | 95.42 | 29.23% | 10.08% | 14.25% | 92.37% | 1.1 | -24.83% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1-risk-110 | yes | fh1-rh1 | storage-drawdown-600bcf | 1.1x | 94.765 | 20.35% | 11.91% | 10.26% | 71.77% | 1.06 | -22.56% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-115 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.15x | 94.6831 | 22.77% | 11.64% | 18.25% | 92.99% | 1.12 | -24.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1-risk-110 | yes | fh3-rh1 | storage-drawdown-600bcf | 1.1x | 94.6321 | 22.79% | 11.54% | 20.86% | 98.55% | 1.13 | -25.29% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1-risk-115 | yes | fh2-rh1 | none | 1.15x | 94.2057 | 24.28% | 9.48% | 13.85% | 81.69% | 1.06 | -24.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 94.1933 | 16.43% | 13.15% | 13.02% | 73.22% | 1.05 | -23.8% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 94.145 | 19.74% | 14.94% | 8.16% | 71.72% | 1.05 | -23.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh3-rh1 | yes | fh3-rh1 | none | 1x | 93.9544 | 21.88% | 10.48% | 15.12% | 82.25% | 1.08 | -25.77% |
| ngas-alpha-short-fade-confirmed-long-graded-shift-sizing | yes | parent-selected | none | 1x | 93.3991 | 27.16% | 13.57% | 10.63% | 87.49% | 1.1 | -24.91% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1-risk-110 | yes | fh2-rh1 | storage-drawdown-600bcf | 1.1x | 93.1196 | 21.76% | 11.13% | 17.43% | 88.34% | 1.11 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 93.1044 | 27.55% | 9.51% | 14.61% | 89.09% | 1.1 | -24.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1-risk-110 | yes | fh2-rh1 | none | 1.1x | 92.9577 | 23.2% | 9.08% | 13.25% | 77.73% | 1.06 | -24.1% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow | yes | parent-selected | none | 1x | 92.7172 | 18.73% | 14.39% | 4.05% | 60% | 1 | -23.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f | yes | parent-selected | none | 1x | 92.6361 | 13.58% | 12.74% | 8.74% | 58.5% | 0.99 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 92.413 | 31.98% | 8.29% | 18.41% | 102.94% | 1.15 | -24.79% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-400bcf | 1x | 92.3057 | 20.64% | 10.5% | 16.54% | 83.16% | 1.1 | -24.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-400bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-400bcf | 1x | 92.0207 | 18.46% | 10.85% | 10.04% | 66.11% | 1.04 | -22.86% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh3-rh1 | yes | fh3-rh1 | storage-drawdown-600bcf | 1x | 91.4151 | 20.67% | 10.48% | 18.88% | 88.21% | 1.11 | -25.33% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 91.388 | 13.66% | 15.89% | 11.64% | 70.38% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f | yes | parent-selected | none | 1x | 91.3722 | 23.17% | 9.63% | 10.28% | 72.28% | 1.03 | -24.1% |
| ngas-alpha-short-fade-confirmed-long-block-adverse-2f | yes | parent-selected | none | 1x | 91.1781 | 21.87% | 14.14% | 6.63% | 70.49% | 1.04 | -23.79% |
| ngas-alpha-net-additive-parent-overlay-close-confirm-3f | no | parent-selected | none | 1x | 91.1116 | 27.29% | 7.37% | 4.01% | 61.05% | 0.98 | -32.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh1-rh1 | yes | fh1-rh1 | storage-drawdown-600bcf | 1x | 90.7595 | 18.46% | 10.8% | 9.34% | 64.54% | 1.04 | -22.86% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 90.4965 | 29.32% | 8.64% | 17.98% | 97.95% | 1.14 | -24.64% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-fh2-rh1 | yes | fh2-rh1 | none | 1x | 90.1227 | 21.05% | 8.26% | 12.05% | 69.93% | 1.04 | -24.25% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-3f-storage-drawdown-400bcf | yes | parent-selected | storage-drawdown-400bcf | 1x | 90.0749 | 13.34% | 15.62% | 10.51% | 66.92% | 1.03 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing-storage-drawdown-600bcf-fh2-rh1 | yes | fh2-rh1 | storage-drawdown-600bcf | 1x | 89.9011 | 19.74% | 10.1% | 15.81% | 79.21% | 1.08 | -24.25% |
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
| ngas-alpha-short-fade-only-graded-shift-sizing | yes | parent-selected | none | 1x | 68.3227 | 18.97% | 6.69% | 1.48% | 41.56% | 0.96 | -23.79% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 68.1844 | 10.38% | 6.89% | 2.99% | 31.72% | 0.89 | -23.22% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-3f | yes | parent-selected | none | 1x | 66.9537 | 6.18% | 7.73% | 6.9% | 34.04% | 0.89 | -23.61% |
| ngas-alpha-short-fade-priority-spared-confirm-1_5f | no | parent-selected | none | 1x | 66.7128 | 21.09% | -2.15% | -11.92% | 3.07% | 0.75 | -30.61% |
| ngas-alpha-short-fade-confirmed-long-spared-confirm-1_5f | yes | parent-selected | none | 1x | 66.3933 | 6.11% | 11.55% | -0.44% | 25.8% | 0.87 | -23.93% |
| ngas-alpha-short-fade-only | yes | parent-selected | none | 1x | 66.2597 | 20.74% | 5.27% | 0.41% | 39.58% | 0.95 | -24.18% |
| ngas-alpha-weather-fade-first-close-confirm-3f | no | parent-selected | none | 1x | 65.9381 | 2.25% | 3.82% | -2.21% | 4.97% | 0.76 | -28.86% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-spared-confirm-1_5f-storage-drawdown-600bcf | yes | parent-selected | storage-drawdown-600bcf | 1x | 65.7386 | 5.53% | 10.13% | 3.11% | 29.59% | 0.89 | -24.69% |
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
