# Elastic Net Expected-Return Lane

Generated at 2026-06-10T04:02:54.174Z.

## Setup

- Strategy lane: strict-theory-elastic-net-expected-return.
- Train/test: fit final models on issueDate < 2025-11-01; report holdout on issueDate >= 2025-11-01.
- Walk-forward selection: wf-2024-nov-dec 2024-11-01 to 2025-01-01; wf-2025-jan-feb 2025-01-01 to 2025-03-01; wf-2025-mar-oct 2025-03-01 to 2025-11-01.
- PnL: returnPctEntryCloseToTarget, with entryTradeDate > issueDate, targetTradeDate >= targetDate, and targetTradeDate > entryTradeDate.
- Cost: 0.064% round trip per trade.

## Commands And Inputs Checked

- Inspected theory.md.
- Inspected scripts/optimize-arctic-strategies.mjs read-only; not rerun here because it writes shared strategy-tests artifacts.
- Inspected data/qore/research/strategy-tests/arctic-blast-strategy-baselines.csv and arctic-blast-strategy-baselines.json.
- Ran node data/qore/research/strategy-agent-runs/elastic-net-expected-return/optimize-elastic-net-expected-return.mjs.

## Lane Output Files

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

Demote elastic-net expected-return to a diagnostic/shadow lane. Do not replace the current baseline, and do not split it into cold/warm sleeves yet; the best-looking holdout returns are still dominated by too few post-cutoff trades.

## Integration Action

Remove strict-theory-elastic-net-expected-return from any primary recommended-strategy slot. Keep the fixed strict-theory rule baseline as the conservative anchor, treat elastic-net selected trades as diagnostics only, and revisit promotion only after it clears source-robust features plus at least 8 post-cutoff trades with acceptable drawdown.

## Why Not Promote

- Baseline reproduction depends on exact source-id features instead of source-robust weather/source-group features.
- Baseline reproduction has only 4 post-cutoff trades versus the 8-trade combined minimum.
- Post-cutoff baseline mix is 1 cold-long and 3 warm-short trades, so the 21.6% headline return is not broad evidence.
- Best combined walk-forward candidate is not replacement-eligible: 4 post-cutoff trades, 21.6% total return, -2.71% max drawdown.
- Cold-long sleeve selected by walk-forward validation loses -1.01% post-cutoff over 2 trades.
- Warm-short sleeve is only 1.83% post-cutoff over 3 trades with 33.3% win rate.
- Cold/warm two-sleeve split falls to 0.8% post-cutoff over 5 trades with -17.38% max drawdown.
