# Rule Arctic Threshold Optimization

Generated: 2026-06-10T04:02:27.496Z

## Method

- PnL: `returnPctEntryCloseToTarget`, net of 0.064% round-trip cost.
- Timing filter: entryTradeDate > issueDate; targetTradeDate >= targetDate; targetTradeDate > entryTradeDate.
- Validation: train issue dates before 2025-11-01; test issue dates on/after 2025-11-01.
- Search discipline: fixed small threshold grid, 2+ source groups, 2+ model families, rumor-window lead days 7-10 only.

## Baseline Reproduction

- Full: 4.9% total, -27.66% maxDD, Sharpe 0.21, 20 trades
- Train: -2.21% total, -27.26% maxDD, Sharpe 0.05, 11 trades
- Test: 7.27% total, -20.75% maxDD, Sharpe 0.58, 9 trades

## Best Train-Ranked Candidate

- Params: cold <= -8F, cold coverage >= 0.55, cold extremes >= 0; warm >= 8F, warm coverage >= 0.6, warm extremes >= 0
- Full: 4.9% total, -27.66% maxDD, Sharpe 0.21, 20 trades
- Train: -2.21% total, -27.26% maxDD, Sharpe 0.05, 11 trades
- Test: 7.27% total, -20.75% maxDD, Sharpe 0.58, 9 trades
- Cold full: 23.15% total, -17.38% maxDD, Sharpe 0.76, 4 trades
- Warm full: -14.81% total, -29.61% maxDD, Sharpe -0.3, 16 trades

## Best Robust Validation Candidate

No combined candidate passed the robustness gate.

- Params: cold <= -8F, cold coverage >= 0.55, cold extremes >= 0; warm >= 8F, warm coverage >= 0.6, warm extremes >= 0
- Full: 4.9% total, -27.66% maxDD, Sharpe 0.21, 20 trades
- Train: -2.21% total, -27.26% maxDD, Sharpe 0.05, 11 trades
- Test: 7.27% total, -20.75% maxDD, Sharpe 0.58, 9 trades
- Cold full: 23.15% total, -17.38% maxDD, Sharpe 0.76, 4 trades
- Warm full: -14.81% total, -29.61% maxDD, Sharpe -0.3, 16 trades

## Side Checks

- Cold-only best: 23.08% total, -17.38% maxDD, Sharpe 0.68, 6 trades with cold <= -8F, cold coverage >= 0.55, cold extremes >= 0; warm >= 8F, warm coverage >= 0.6, warm extremes >= 0
- Warm-only best: -4.81% total, -21.76% maxDD, Sharpe -0.04, 17 trades with cold <= -8F, cold coverage >= 0.55, cold extremes >= 0; warm >= 10F, warm coverage >= 0.6, warm extremes >= 0

## Recommendation

- Verdict: Demote the combined rule baseline; do not replace it with a tuned threshold candidate.
- Integration action: Keep strict-theory-rule-arctic-threshold as a diagnostic benchmark only. If the shared integration needs a rule signal, split cold-long and warm-short into separate sleeves for reporting/ranking, but do not promote either sleeve to production until each clears multi-season validation.

- Best combined train-ranked candidate is still the current baseline (combined-coldA-8-coldC0p55-coldE0-warmA8-warmC0p6-warmE0); the threshold grid did not find a better combined rule.
- No combined candidate passed the robustness gate (0 passes).
- Cold sleeve is directionally interesting on full history (23.15% total, -17.38% maxDD, Sharpe 0.76, 4 trades) but too sparse and not validated post-cutoff (-1.01% total, -17.38% maxDD, Sharpe 0.18, 2 trades).
- Warm sleeve is unstable: train/full are weak (-21.39% total, -29.38% maxDD, Sharpe -0.94, 9 trades train; -14.81% total, -29.61% maxDD, Sharpe -0.3, 16 trades full) while the post-cutoff gain (8.36% total, -7.46% maxDD, Sharpe 0.85, 7 trades) is a small holdout bounce.
