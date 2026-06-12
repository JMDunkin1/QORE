# NGAS Winter Alpha

Generated at 2026-06-12T03:52:40.523Z.

## Purpose

This active QORE research strategy combines parent experts without fitting new weather thresholds: Dual Weather supplies the cold/warm forecast-follow context, Weather Hybrid supplies post-window reversion context, Volatility Mean Reversion can confirm same-direction overreaction fades, and optional weather-resolution overlays test whether close-in or already-known actual weather shifted enough to support the fade. The selected blend is ranked on train/validation only, with holdout reported after selection.

## Selected Candidate

- Architecture: Short fade plus cold follow and vol-confirmed long fade + Grade reversion size by close-in weather shift.
- Parent experts: Dual Weather Rotation for forecast-follow, Weather Hybrid Rotation for post-window reversion, and Volatility Mean Reversion for same-direction fade confirmation.
- Position policy: Take Dual Weather cold-follow setups directly; keep Weather Hybrid reversion-short setups, adding Dual Weather warm-short exposure when both parent experts point short, and add Weather Hybrid reversion-long setups only when Volatility Mean Reversion confirms the same long-fade direction. Weather-resolution overlay: Scale reversion exposure up when the close-in or already-known actual anomaly confirms the reversion, and shrink it when the weather shift argues against the trade.
- Max weather UNG overlay: 0.45x; parent weather leg 0.25x and weather reversion leg 0.2x.
- Vol-confirmed reversion-long size: 1x of the parent reversion leg.
- Standalone reversion fade size: 1x of the parent reversion leg when no same-direction follow signal confirms it.
- Weather-resolution overlay: Grade reversion size by close-in weather shift. Scale reversion exposure up when the close-in or already-known actual anomaly confirms the reversion, and shrink it when the weather shift argues against the trade.
- Idle capital risk mode: Full index fallback for idle capital.
- Cost: 0.064% round trip, charged as 0.032% one-way on UNG position changes.
- Selection: Only predeclared parent-blend policies are selected on train and validation. Generic idle-index risk-off variants are reported as diagnostics only, and holdout rows after 2025-11-01 are reported after selection.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 138 | 65.77% | 33.7% | 32.07% | 16.95% | 0.91 | 1.4 | -23.74% | 4.7% |
| Validation | 50 | 49% | 29.08% | 19.92% | 28.66% | 1.42 | 1.94 | -15.43% | 3.5% |
| Holdout | 51 | 25.01% | 10.94% | 14.07% | 46.38% | 1.93 | 2.59 | -10.52% | 9.1% |
| Full | 239 | 208.78% | 91.47% | 117.31% | 23.15% | 1.18 | 1.72 | -23.74% | 4.8% |

## Train/Validation Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 45 | 18.27% | 3.85 | -10.58% |
| Warm-short | 58 | 12.56% | 2.06 | -6.03% |
| Reversion-long | 36 | 18.82% | 4.29 | -8% |
| Reversion-short | 111 | 14.78% | 1.5 | -7.81% |
| Long-side combined | 77 | 36.17% | 4.02 | -13.27% |
| Short-side combined | 111 | 14.78% | 1.5 | -7.81% |

## Full Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 55 | 19.44% | 2.95 | -10.58% |
| Warm-short | 75 | 30.97% | 3.42 | -6.03% |
| Reversion-long | 45 | 21.71% | 4.25 | -8% |
| Reversion-short | 143 | 29.14% | 2.03 | -7.81% |
| Long-side combined | 96 | 40.87% | 3.44 | -13.27% |
| Short-side combined | 143 | 29.14% | 2.03 | -7.81% |
| Index fallback | 1123 | 69.74% | 0.76 | -26.69% |

## Anti-Overfit Check

- Candidate count: 99.
- Eligible candidates: 67.
- Eligibility requires a selectable gas-alpha policy, positive train and validation edge, lower train and validation drawdown than the index basket, and train/validation volatility under a 20% annualized risk budget.
- Index risk-off variants are diagnostic-only because they can create cash-flat equity shelves and are a portfolio overlay rather than a gas-alpha rule.
- Weather-resolution overlays use GFS/GEFS lead-1 to lead-3 forecasts available by the trade date, or target-day actual weather only when the target date is already before the trade date.
- Holdout was not used for selection: yes.
- Primary p-value: 0.0283 (selection-adjusted centered circular block bootstrap).
- Single-candidate p-value: 0.0117.
- Selection-adjusted p-value: 0.0283 across 67 eligible candidates.
- Observed active edge: 0.03619% per day / 9.12% annualized.
- Mean daily-edge 90% bootstrap interval: 0.01218% to 0.06185%.
- Zero-edge null 90% interval: -0.02401% to 0.02566%.
- Bootstrap setup: 1200 iterations, 10-session circular blocks, minimum resolvable p-value 0.0008.

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | Sharpe | maxDD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ngas-alpha-fade-primary-confirmed-follow-risk-off | no | 130.0541 | 0.45% | 28.29% | 7.08% | 57.69% | 1.21 | -27.94% |
| ngas-alpha-net-additive-parent-overlay | no | 130.0236 | 22.94% | 26.55% | -1.06% | 76.41% | 1.04 | -31.21% |
| ngas-alpha-net-additive-parent-overlay-graded-shift-sizing | no | 126.9892 | 29.29% | 23.15% | -0.24% | 83.21% | 1.07 | -30.39% |
| ngas-alpha-net-additive-parent-overlay-block-adverse-2f | no | 123.2418 | 35.46% | 18.57% | -1.09% | 82.91% | 1.06 | -29.99% |
| ngas-alpha-dual-follow-first | no | 123.1906 | 22.57% | 21.93% | -9.1% | 48.86% | 0.94 | -31.42% |
| ngas-alpha-fade-primary-confirmed-follow | no | 123.1466 | 2.78% | 38.8% | 9.53% | 84.55% | 1.07 | -30.82% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-graded-shift-sizing | yes | 121.2882 | 32.07% | 19.92% | 14.07% | 117.31% | 1.18 | -23.74% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-graded-shift-sizing | yes | 120.3887 | 33.43% | 17.99% | 13.67% | 114.82% | 1.17 | -23.23% |
| ngas-alpha-fade-primary-confirmed-follow-graded-shift-sizing | no | 119.9191 | 6.2% | 32.97% | 11% | 84.97% | 1.09 | -27.63% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-block-adverse-2f | yes | 119.1136 | 32.75% | 18.37% | 10.42% | 106.38% | 1.14 | -22.09% |
| ngas-alpha-weather-hybrid-parent-risk-off | no | 118.7995 | -9.46% | 25.34% | -2.38% | 16.81% | 1.06 | -25.73% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-graded-shift-sizing | yes | 118.7937 | 34.78% | 16.09% | 13.26% | 112.31% | 1.17 | -23.23% |
| ngas-alpha-dual-follow-first-graded-shift-sizing | no | 117.8551 | 26.61% | 17.16% | -6.83% | 52.59% | 0.96 | -31.13% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-graded-shift-sizing | yes | 117.2462 | 36.14% | 14.2% | 12.85% | 109.77% | 1.16 | -23.23% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25 | yes | 117.0122 | 37.08% | 13.48% | 12.73% | 109.62% | 1.16 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50 | yes | 116.9177 | 34.14% | 15.21% | 13.35% | 109.53% | 1.15 | -23.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-block-adverse-2f | yes | 116.8111 | 32.66% | 16.64% | 10.06% | 101.88% | 1.13 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75 | yes | 116.0917 | 31.23% | 16.95% | 13.97% | 109.37% | 1.15 | -24.65% |
| ngas-alpha-short-fade-priority | no | 115.3276 | 25.22% | 15.41% | -15.25% | 28.26% | 0.86 | -30.59% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long | yes | 115.0927 | 28.35% | 18.71% | 14.58% | 109.15% | 1.14 | -25.51% |
| ngas-alpha-dual-follow-first-block-adverse-2f | no | 114.8507 | 31.24% | 13.45% | -4.59% | 58.55% | 0.98 | -30.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-block-adverse-2f | yes | 114.3726 | 32.57% | 14.93% | 9.71% | 97.41% | 1.12 | -22.09% |
| ngas-alpha-short-fade-priority-graded-shift-sizing | no | 112.7051 | 27.32% | 12.52% | -12.85% | 32.18% | 0.88 | -30.02% |
| ngas-alpha-fade-primary-confirmed-follow-block-adverse-2f | yes | 112.554 | 7.74% | 26.44% | 8.45% | 71.15% | 1.04 | -23.72% |
| ngas-alpha-short-fade-plus-cold-follow | yes | 112.4525 | 36.91% | 14.77% | 12.1% | 110.49% | 1.16 | -23.5% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-block-adverse-2f | yes | 112.0821 | 32.46% | 13.24% | 9.35% | 92.97% | 1.11 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-graded-shift-sizing | yes | 111.2785 | 34.45% | 15.33% | 12.44% | 108.14% | 1.15 | -23.23% |
| ngas-alpha-short-fade-priority-block-adverse-2f | no | 110.0809 | 30.22% | 10.13% | -13.09% | 31.81% | 0.88 | -29.11% |
| ngas-alpha-weather-fade-first | no | 108.5711 | 0.72% | 24.9% | -7.6% | 22.41% | 0.84 | -28.84% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-1_5f | yes | 107.2446 | 14.9% | 21.31% | 8.18% | 74.75% | 1.04 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-block-adverse-2f | yes | 106.5282 | 29.34% | 14.55% | 8.99% | 89.36% | 1.09 | -22.09% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-1_5f | yes | 105.1536 | 15.2% | 19.55% | 8.16% | 72.1% | 1.04 | -23.1% |
| ngas-alpha-short-fade-confirmed-long-risk-off | no | 104.2441 | 20.71% | 3.23% | 7.67% | 50.84% | 1.21 | -20.23% |
| ngas-alpha-weather-fade-first-graded-shift-sizing | no | 103.6581 | 3.71% | 19.52% | -5.57% | 23.68% | 0.85 | -27.13% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-1_5f | yes | 103.0766 | 15.48% | 17.81% | 8.13% | 69.45% | 1.03 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-graded-shift-sizing | yes | 102.9117 | 29.56% | 10.81% | 15.08% | 96.32% | 1.12 | -24.77% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-block-adverse-2f | yes | 101.3127 | 29.51% | 15.28% | 1.35% | 73.11% | 1.05 | -22.04% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone | yes | 100.9742 | 29.21% | 10.16% | 15.95% | 96.34% | 1.11 | -25.9% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-1_5f | yes | 100.9136 | 15.76% | 16.07% | 8.11% | 66.8% | 1.02 | -23.1% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-graded-shift-sizing | yes | 100.6327 | 24.57% | 15.8% | 2.94% | 69.67% | 1.04 | -22.05% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-block-adverse-2f | yes | 99.1146 | 26.28% | 9.99% | 11% | 79.84% | 1.06 | -24.1% |
| ngas-alpha-weather-fade-first-block-adverse-2f | yes | 98.8346 | 10.43% | 13.56% | -5.93% | 24.43% | 0.85 | -26.26% |
| ngas-alpha-net-additive-parent-overlay-close-confirm-1_5f | no | 98.5938 | 26.45% | 11.17% | 5.46% | 69.98% | 1.01 | -31.72% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone | yes | 96.7185 | 31.89% | 9.73% | 14.67% | 97.26% | 1.12 | -25.43% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-1_5f | yes | 96.371 | 13.58% | 17.41% | 8.08% | 65.33% | 1.01 | -23.1% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-graded-shift-sizing | yes | 95.42 | 29.23% | 10.08% | 14.25% | 92.37% | 1.1 | -24.83% |
| ngas-alpha-short-fade-confirmed-long-graded-shift-sizing | yes | 93.3991 | 27.16% | 13.57% | 10.63% | 87.49% | 1.1 | -24.91% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow | yes | 92.7172 | 18.73% | 14.39% | 4.05% | 60% | 1 | -23.02% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-1_5f | yes | 92.6361 | 13.58% | 12.74% | 8.74% | 58.5% | 0.99 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-block-adverse-2f | yes | 91.3722 | 23.17% | 9.63% | 10.28% | 72.28% | 1.03 | -24.1% |
| ngas-alpha-short-fade-confirmed-long-block-adverse-2f | yes | 91.1781 | 21.87% | 14.14% | 6.63% | 70.49% | 1.04 | -23.79% |
| ngas-alpha-net-additive-parent-overlay-close-confirm-3f | no | 91.1116 | 27.29% | 7.37% | 4.01% | 61.05% | 0.98 | -32.42% |
| ngas-alpha-net-additive-parent-overlay-spared-confirm-1_5f | no | 89.8986 | 29.78% | 4.99% | 1.7% | 55.41% | 0.97 | -30.52% |
| ngas-alpha-short-fade-confirmed-long | yes | 89.7431 | 28.12% | 11.45% | 9.68% | 82.81% | 1.08 | -25.17% |
| ngas-alpha-dual-follow-first-close-confirm-1_5f | no | 89.5301 | 25% | 5.84% | -0.85% | 44.24% | 0.92 | -32.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-close-confirm-3f | yes | 87.9195 | 9.36% | 15.75% | 6.31% | 51.47% | 0.96 | -23.48% |
| ngas-alpha-dual-follow-first-close-confirm-3f | no | 86.8543 | 27.94% | 3.06% | -1.05% | 43.23% | 0.92 | -33.42% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-spared-confirm-1_5f | yes | 86.5573 | 13.63% | 12.25% | -0.37% | 38.75% | 0.91 | -22.35% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-1_5f | yes | 86.023 | 11.7% | 12.37% | 8.69% | 54.56% | 0.97 | -23.8% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-close-confirm-3f | yes | 85.7985 | 9.65% | 14.05% | 6.29% | 49.05% | 0.95 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-75-spared-confirm-1_5f | yes | 85.4903 | 13.92% | 11.25% | -0.4% | 37.53% | 0.91 | -22.32% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-spared-confirm-1_5f | yes | 84.3168 | 14.2% | 10.26% | -0.42% | 36.3% | 0.9 | -22.29% |
| ngas-alpha-fade-primary-confirmed-follow-close-confirm-1_5f | no | 83.9831 | -4.13% | 20.8% | 11.79% | 46.87% | 0.95 | -26.39% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-close-confirm-3f | yes | 83.7175 | 9.92% | 12.37% | 6.26% | 46.63% | 0.94 | -23.48% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-1_5f | yes | 83.6537 | 12.88% | 15.29% | 0.11% | 43.55% | 0.94 | -22.78% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-spared-confirm-1_5f | yes | 83.0128 | 14.48% | 9.28% | -0.44% | 35.06% | 0.9 | -22.26% |
| ngas-alpha-short-fade-priority-close-confirm-1_5f | no | 82.0094 | 19.54% | 3.22% | -8.46% | 16.3% | 0.81 | -30.88% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-25-close-confirm-3f | yes | 81.683 | 10.19% | 10.7% | 6.24% | 44.22% | 0.93 | -23.48% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-close-confirm-3f | no | 79.9366 | 10.57% | 15.7% | -0.2% | 39.85% | 0.93 | -23.91% |
| ngas-alpha-short-fade-plus-cold-follow-spared-confirm-1_5f | yes | 79.8059 | 12.31% | 11.23% | -0.47% | 34.85% | 0.9 | -22.23% |
| ngas-alpha-short-fade-confirmed-long-close-confirm-1_5f | yes | 79.749 | 6.53% | 16.37% | 8.12% | 51.36% | 0.98 | -24.78% |
| ngas-alpha-dual-follow-first-spared-confirm-1_5f | no | 78.1507 | 26.75% | 0% | -0.57% | 37.11% | 0.89 | -31.91% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow | yes | 77.3199 | 29.86% | 2.05% | 17.26% | 83.47% | 1.07 | -26.33% |
| ngas-alpha-short-fade-plus-cold-follow-close-confirm-3f | yes | 77.0037 | 8.09% | 11.99% | 6.21% | 42.87% | 0.92 | -23.48% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-spared-confirm-1_5f | yes | 76.1983 | 12.16% | 7.37% | -0.26% | 28.82% | 0.87 | -23.28% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-graded-shift-sizing | yes | 76.0039 | 26.89% | 2.19% | 16.05% | 76.25% | 1.05 | -26.04% |
| ngas-alpha-short-fade-priority-close-confirm-3f | no | 74.8438 | 19.58% | 0.21% | -9.3% | 9.95% | 0.78 | -31.35% |
| ngas-alpha-short-fade-plus-cold-follow-vol-long-50-shrunk-standalone-close-confirm-3f | yes | 73.742 | 7.99% | 8.1% | 6.95% | 37.66% | 0.9 | -23.61% |
| ngas-alpha-weather-fade-first-close-confirm-1_5f | no | 72.413 | 1.7% | 6.89% | -1.88% | 9.33% | 0.78 | -28.09% |
| ngas-alpha-short-fade-only-block-adverse-2f | yes | 71.8656 | 20% | 7.85% | 0.36% | 42.76% | 0.97 | -22.78% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-spared-confirm-1_5f | yes | 71.5729 | 10.3% | 8.31% | -0.31% | 27.42% | 0.86 | -23.22% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-1_5f | yes | 71.4383 | 12.16% | 4.61% | 9.28% | 42.98% | 0.93 | -24.51% |
| ngas-alpha-vol-confirmed-fade-plus-cold-follow-spared-confirm-1_5f | yes | 70.6656 | 8.38% | 11.4% | -0.2% | 29.57% | 0.88 | -24.69% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-block-adverse-2f | yes | 70.014 | 19.9% | 2.05% | 11.57% | 55.28% | 0.97 | -26.09% |
| ngas-alpha-fade-primary-confirmed-follow-close-confirm-3f | no | 69.8156 | -6.33% | 15.11% | 10.48% | 31.54% | 0.89 | -25.49% |
| ngas-alpha-fade-primary-confirmed-follow-spared-confirm-1_5f | no | 68.8729 | -1.74% | 14.22% | 3.05% | 24.07% | 0.86 | -26.19% |
| ngas-alpha-short-fade-only-graded-shift-sizing | yes | 68.3227 | 18.97% | 6.69% | 1.48% | 41.56% | 0.96 | -23.79% |
| ngas-alpha-short-fade-plus-cold-follow-shrunk-standalone-close-confirm-3f | yes | 66.9537 | 6.18% | 7.73% | 6.9% | 34.04% | 0.89 | -23.61% |
| ngas-alpha-short-fade-priority-spared-confirm-1_5f | no | 66.7128 | 21.09% | -2.15% | -11.92% | 3.07% | 0.75 | -30.61% |
| ngas-alpha-short-fade-confirmed-long-spared-confirm-1_5f | yes | 66.3933 | 6.11% | 11.55% | -0.44% | 25.8% | 0.87 | -23.93% |
| ngas-alpha-short-fade-only | yes | 66.2597 | 20.74% | 5.27% | 0.41% | 39.58% | 0.95 | -24.18% |
| ngas-alpha-weather-fade-first-close-confirm-3f | no | 65.9381 | 2.25% | 3.82% | -2.21% | 4.97% | 0.76 | -28.86% |
| ngas-alpha-short-fade-confirmed-long-close-confirm-3f | yes | 63.6681 | 1.3% | 12.52% | 6.24% | 32.54% | 0.9 | -25.15% |
| ngas-alpha-weather-fade-first-spared-confirm-1_5f | no | 62.4194 | 4.7% | 1.94% | -5.01% | 0.61% | 0.74 | -27.83% |
| ngas-alpha-short-fade-only-close-confirm-1_5f | yes | 60.3678 | 8.19% | 8.49% | 2.94% | 30.81% | 0.91 | -24.68% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-spared-confirm-1_5f | yes | 59.69 | 10.67% | 2.64% | -0.15% | 19.21% | 0.83 | -24.21% |
| ngas-alpha-confirmed-warm-short-plus-cold-follow-close-confirm-3f | yes | 53.9513 | 6.54% | 0.81% | 7.58% | 24.43% | 0.85 | -23.75% |
| ngas-alpha-short-fade-only-close-confirm-3f | yes | 53.6333 | 5.88% | 6.99% | 2.04% | 23.13% | 0.87 | -25.09% |
| ngas-alpha-short-fade-only-spared-confirm-1_5f | yes | 51.2318 | 8.5% | 5.02% | -0.35% | 19.43% | 0.86 | -24.31% |

## Verdict

Load this as an active research-baseline strategy, not broker-ready. The selected blend keeps idle capital in the index fallback so any return improvement comes from explicit gas overlays rather than a cash timing patch. It has cleared the current holdout-edge and bootstrap reality checks, but still needs non-overlapping paper validation before any broker adapter exists.
