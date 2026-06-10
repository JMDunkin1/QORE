# Rule Arctic Threshold Optimization

Generated: 2026-06-10T03:25:16.388Z

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

Do not replace the current baseline yet; use the refined thresholds as research input because the validation set is still small and side balance is fragile.
