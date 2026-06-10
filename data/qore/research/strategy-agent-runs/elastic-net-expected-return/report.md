# Elastic Net Expected-Return Lane

Generated at 2026-06-10T03:27:19.187Z.

## Setup

- Strategy lane: strict-theory-elastic-net-expected-return.
- Train/test: fit final models on issueDate < 2025-11-01; report holdout on issueDate >= 2025-11-01.
- Walk-forward selection: wf-2024-nov-dec 2024-11-01 to 2025-01-01; wf-2025-jan-feb 2025-01-01 to 2025-03-01; wf-2025-mar-oct 2025-03-01 to 2025-11-01.
- PnL: returnPctEntryCloseToTarget, with entryTradeDate > issueDate, targetTradeDate >= targetDate, and targetTradeDate > entryTradeDate.
- Cost: 0.064% round trip per trade.

## Commands

- node scripts/optimize-arctic-strategies.mjs
- node data/qore/research/strategy-agent-runs/elastic-net-expected-return/optimize-elastic-net-expected-return.mjs

## Changed Files

- data/qore/research/strategy-agent-runs/elastic-net-expected-return/optimize-elastic-net-expected-return.mjs
- data/qore/research/strategy-agent-runs/elastic-net-expected-return/candidate-metrics.csv
- data/qore/research/strategy-agent-runs/elastic-net-expected-return/selected-trades.csv
- data/qore/research/strategy-agent-runs/elastic-net-expected-return/run-summary.json
- data/qore/research/strategy-agent-runs/elastic-net-expected-return/report.md

## Dataset

- Strict tradable rows: 231; train 124; post-cutoff 107.
- Side rows: cold-long 59; warm-short 172.

## Best Candidates

| candidate | features | threshold | cvTrades | cvReturn | postTrades | postReturn | postDD | replace |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline reproduction | source-id | 0.064 | 5 | 29.78% | 4 | 21.6% | -2.71% | no |
| best combined by CV | source-id | 0.064 | 5 | 29.78% | 4 | 21.6% | -2.71% | no |
| best cold-long by CV | weather-only | 0.064 | 2 | 24.4% | 2 | -1.01% | -17.38% | no |
| best warm-short by CV | weather-only | 0.064 | 3 | 4.29% | 3 | 1.83% | -2.38% | no |
| two-sleeve | cold-long:weather-only + warm-short:weather-only | cold-long:0.064 + warm-short:0.064 | 2/3 | 24.4%/4.29% | 5 | 0.8% | -17.38% | no |

## Recommendation

Do not replace the current baseline. The best-looking holdout returns are still dominated by too few post-cutoff trades, and the side-specific checks show the warm-short sleeve is not independently robust.
