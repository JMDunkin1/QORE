# Worker 2 Regularized Logistic Regression

Generated: 2026-06-10T04:01:41.271Z

## Scope

- Lane: strict-theory-regularized-logistic-regression.
- Data root: data/qore.
- Output folder: data/qore/research/strategy-agent-runs/regularized-logistic-regression.
- PnL column: returnPctEntryCloseToTarget.
- No-lookahead rule: entryTradeDate > issueDate, targetTradeDate >= targetDate, targetTradeDate > entryTradeDate.
- Model family: dependency-free L1/L2-regularized logistic regression on theory-aligned return labels.

## Selected Candidate

- Config: weather-core__lambda-0.002__l1-0__both-050
- Feature set: weather-core
- Lambda: 0.002
- L1 ratio: 0
- Cold threshold: 0.5
- Warm threshold: 0.5
- Validation rank: 30.126
- Train rows before 2025-11-01: 124
- Post-cutoff rows: 107

## Verdict

- Decision: demote logistic to diagnostics/watchlist.
- Integration action: Do not change shared strategy-tests from this lane. Do not replace the baseline and do not add cold/warm production sleeves; mark strict-theory-regularized-logistic-regression as diagnostic/watchlist until another winter validates it.
- Baseline action: Demote the strict logistic baseline from any primary/hero ranking because its six-trade post-cutoff result is fragile and driven by one large cold loss plus one large cold recovery.
- Cold sleeve: Do not promote cold-long: post-cutoff has only 2 trades, with one -17.38% net loss and one +19.82% net gain.
- Warm sleeve: Do not promote warm-short as production: post-cutoff is better controlled at 4 trades, +4.45% total return, and -2.71% max drawdown, but validation was only 3 warm trades and +0.88%.

## Metrics

| Sample | Side | Trades | Total return % | Max DD % | Win % | Profit factor | Sharpe |
|---|---:|---:|---:|---:|---:|---:|---:|
| Walk-forward validation | all | 5 | 25.49 | -2.92 | 80 | 9.26 | 3.48 |
| Walk-forward validation | cold-long | 2 | 24.4 | 0 | 100 | 99 | 10.44 |
| Walk-forward validation | warm-short | 3 | 0.88 | -2.92 | 66.7 | 1.33 | 0.49 |
| Post-cutoff test | all | 6 | 3.4 | -17.38 | 50 | 1.35 | 0.43 |
| Post-cutoff test | cold-long | 2 | -1.01 | -17.38 | 50 | 1.14 | 0.18 |
| Post-cutoff test | warm-short | 4 | 4.45 | -2.71 | 50 | 2.67 | 1.84 |

## Baseline / Threshold Audit

- Existing shared strict logistic baseline: 6 trades, 3.4% total return, -17.38% max DD, 50% win rate.
- Same final model at 0.55/0.55 thresholds: 5 trades, -1.38% total return, -17.38% max DD.
- Selected thresholds vs 0.55/0.55: +4.78 percentage points of post-cutoff total return.
- Demotion rationale: The validation curve looks strong, but the post-cutoff sample is only 6 trades, the cold side is unstable, and the 0.50 threshold improvement over 0.55 is mostly threshold sensitivity rather than robust model evidence.

## Overfit Checks

- Hyperparameter grid was fixed and small: 3 feature sets x 3 lambda values x 2 L1 ratios x 9 threshold pairs.
- Threshold selection used only walk-forward validation before 2025-11-01; post-cutoff rows were evaluated after selection.
- Minimum validation trades: 5; minimum post-cutoff trades for replacement consideration: 6.
- Source exact IDs were tested, but source-group and weather-only feature sets were also tested to make source dependence visible.
- Sleeve split was evaluated from side metrics only, not promoted as a new fitted strategy, because the post-cutoff side samples are 2 cold trades and 4 warm trades.
- Top coefficients: doySin=1.02723, doyCos=-0.43331, sampledWeight=-0.26152, coldExtremeCount=0.19729, warmExtremeCount=-0.19409, coverageStrength=0.15291, leadDays=-0.12737, extremeCount=-0.10722, coldCoveragePct=0.10467, coveragePct=0.04536.

## Recommendation

Do not replace or split the shared baseline yet. Use this run only as threshold calibration and side-diagnostic evidence; the least overfit integration is to demote logistic to a watchlist/diagnostic strategy until more out-of-sample winter rows arrive.
