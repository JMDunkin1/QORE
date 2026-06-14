# NGAS All-Year Beta

Generated at 2026-06-14T05:04:05.044Z.

## Purpose

NGAS All-Year Beta is the checked-in all-year artifact for the existing NGAS Summer Alpha and NGAS Winter Alpha row selector. It does not add a new threshold, entry rule, or optimization layer: each date uses the exact material Summer row, else the exact material Winter row, else the shared US index basket fallback row.

## Selected Candidate

- Architecture: Summer/Winter composite artifact.
- Source ledgers: ngas-summer-alpha + ngas-winter-alpha.
- Row policy: For each entry date, pick the material Summer Alpha row, else the material Winter Alpha row, else the identical no-cost index fallback row.
- Material row definition: A source row is material when it has a non-index thesis, non-zero gas position, or non-zero trading cost.
- Selection: no independent all-year parameter search; the component ledgers remain selected by their own train/validation contracts.
- P-value: direct standalone all-year centered circular block bootstrap, not Fisher-combined component p-values.

## Metrics

| split | executed rows | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 224 | 186.29% | 40.58% | 145.71% | 38.52% | 1.64 | 2.62 | -15.86% | 11.1% |
| Validation | 86 | 70.74% | 19.78% | 50.96% | 54.83% | 2.64 | 4.78 | -9.57% | 13.2% |
| Holdout | 87 | 99.9% | 30.16% | 69.74% | 65.03% | 2.38 | 3.23 | -16.72% | 10% |
| Full | 397 | 877.16% | 119.17% | 757.99% | 52.11% | 2 | 3.11 | -15.86% | 11.2% |

## Component Rows

| component | gas-overlay rows |
| --- | ---: |
| NGAS Summer Alpha | 197 |
| NGAS Winter Alpha | 200 |
| Index fallback | 970 |
| Material or cost-bearing rows | 540 |

## Anti-Overfit Check

- Candidate count: 1.
- Eligible candidates: 1.
- Holdout was not used for any all-year selection: yes.
- Primary p-value: 0.00005 (standalone all-year centered circular block bootstrap).
- Single-candidate p-value: 0.00005.
- Selection-adjusted p-value: n/a.
- Observed active edge: 0.11306% per day / 28.49% annualized.
- Mean daily-edge 90% bootstrap interval: 0.07507% to 0.15172%.
- Zero-edge null 90% interval: -0.03799% to 0.03866%.
- Bootstrap setup: 20000 iterations, 10-session circular blocks, minimum resolvable p-value 0.00005.

## Verdict

Load this as an active research-baseline artifact, not broker-ready. It preserves the current Summer/Winter row behavior exactly while making the all-year path reproducible as a checked-in ledger with its own direct bootstrap p-value.
