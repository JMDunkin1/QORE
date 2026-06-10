# Volatility Mean Reversion Lane

Generated at 2026-06-10T15:14:13.771Z.

## Purpose

This is the sixth isolated QORE research lane. It leaves the five strict-theory weather models untouched and tests a different, high-sample-size idea: UNG often mean-reverts after unusually large daily moves during natural-gas-relevant winter months.

## Selected Rule

- Universe: UNG daily bars from 2008-01-02 through 2026-06-05; winter signal dates only.
- Signal timing: use the close-to-close return and trailing realized volatility known after the signal date closes.
- Entry/exit: enter at the next session open and exit at that same session close.
- Direction: long after a negative volatility-normalized move; short after a positive volatility-normalized move.
- Selection: train-only grid before 2025-11-01; holdout returns are reported after selection.
- Cost: 0.064% round trip, scaled by 0.35x notional.
- Chosen thresholds: 40-session volatility lookback; abs(previous return / volatility) >= 0.8; volatility between 2.5% and 6%.

## Metrics

| split | trades | total | CAGR | Sharpe | Sortino | maxDD | win | PF | t-stat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 462 | 58.85% | 2.86% | 0.65 | 1.06 | -6.33% | 55.4% | 1.38 | 2.62 |
| Holdout | 34 | 6.38% | 16.6% | 1.74 | 3.17 | -2.08% | 55.9% | 1.72 | 1.1 |
| Full | 496 | 68.97% | 3.06% | 0.68 | 1.12 | -6.33% | 55.4% | 1.41 | 2.84 |

## Side Checks

| split | long trades | long return | short trades | short return |
| --- | ---: | ---: | ---: | ---: |
| Train | 255 | 17.25% | 207 | 35.48% |
| Holdout | 16 | 1.32% | 18 | 4.99% |

## Year Checks

Train was profitable in 13 of 17 train years.

| year | split | trades | total | Sharpe | maxDD |
| --- | --- | ---: | ---: | ---: | ---: |
| 2008 | train | 17 | 1.88% | 1.34 | -1.96% |
| 2009 | train | 45 | 9.22% | 1.23 | -2.85% |
| 2010 | train | 14 | 2.6% | 1.7 | -1.01% |
| 2011 | train | 1 | -0.99% | 0 | -0.99% |
| 2012 | train | 18 | 3.32% | 1.89 | -2.61% |
| 2014 | train | 23 | 5.28% | 1.03 | -3.01% |
| 2015 | train | 27 | 4.12% | 0.98 | -2.58% |
| 2016 | train | 42 | 3.57% | 1 | -2.31% |
| 2017 | train | 14 | 1.07% | 2.19 | -0.83% |
| 2018 | train | 23 | -1.03% | -0.25 | -4.05% |
| 2019 | train | 12 | 0.87% | 0.52 | -0.93% |
| 2020 | train | 26 | 0.62% | 0.18 | -3.32% |
| 2021 | train | 34 | 9.56% | 1.78 | -2.78% |
| 2022 | train | 49 | 3.79% | 0.55 | -5.71% |
| 2023 | train | 49 | 4.93% | 0.89 | -4.11% |
| 2024 | train | 46 | -1.09% | -0.17 | -5.21% |
| 2025 | train | 22 | 0% | 0.04 | -4.61% |
| 2025 | holdout | 21 | 3.32% | 2.38 | -1.46% |
| 2026 | holdout | 13 | 2.95% | 1.33 | -2.08% |

## Top Train-Risk-Ranked Candidates

| candidate | eligible | train rank | train trades | train return | train Sharpe | train Sortino | train maxDD | profitable train years | holdout trades | holdout return |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| lb40-z0.8-vol2.5-6 | yes | 146.9478 | 462 | 58.85% | 0.65 | 1.06 | -6.33% | 13/17 | 34 | 6.38% |
| lb20-z0.65-vol2.5-6 | yes | 143.2154 | 563 | 61.6% | 0.6 | 0.98 | -8.48% | 13/17 | 41 | 4.86% |
| lb60-z0.5-vol2.5-4 | yes | 142.793 | 448 | 50.83% | 0.63 | 1.06 | -7.22% | 12/14 | 40 | 6.99% |
| lb30-z0.8-vol2.5-6 | yes | 142.0209 | 459 | 56.88% | 0.61 | 1 | -6.43% | 13/17 | 35 | 6.24% |
| lb20-z0.8-vol2.5-5 | yes | 142.009 | 400 | 56.52% | 0.65 | 1.01 | -6.14% | 12/17 | 33 | 2.07% |
| lb30-z0.8-vol2.5-5 | yes | 140.6714 | 405 | 53.96% | 0.63 | 0.99 | -7.67% | 13/17 | 32 | 1.4% |
| lb20-z0.65-vol2.5-8 | yes | 140.3174 | 581 | 59.01% | 0.58 | 0.94 | -9.11% | 13/17 | 45 | 9.78% |
| lb20-z0.65-vol2.5-99 | yes | 140.3174 | 581 | 59.01% | 0.58 | 0.94 | -9.11% | 13/17 | 46 | 9.23% |

## Verdict

Promote this lane as the new sixth research baseline, not as a broker-ready system. It clears the original sample-size problem: 496 full-sample trades, 462 train trades, and 34 post-cutoff trades. It also avoids the worst behavior of the five existing lanes because the result is not concentrated in two or three event trades.

The remaining caveat is conceptual rather than statistical: this is a winter UNG volatility-reversion model, not an Arctic Blast forecast-following model. It should be tracked beside the five existing weather lanes while more forecast-history winters accumulate.
