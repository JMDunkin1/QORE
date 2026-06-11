# Strategy Agent Runs - 2026-06-10

Six isolated worker lanes tested QORE strategy ideas against the shared `data/qore` dataset, and two active companion lanes now live beside those archived experiments. Each lane writes and executes its own code under a lane-specific folder so the runs can stay reproducible without touching the shared optimizer or each other.

## Shared Validation Contract

- Tradable PnL column: `returnPctEntryCloseToTarget`.
- No-lookahead rules: `entryTradeDate > issueDate`, `targetTradeDate >= targetDate`, and `targetTradeDate > entryTradeDate`.
- Main holdout split: train before `2025-11-01`, test on or after `2025-11-01`.
- Strategy universe: winter 7-10 day UNG rumor-window rows with strict cold-long or warm-short confirmation from at least two source groups and two model families.
- Promotion standard: prefer enough trades, side stability, and pre/post consistency over the highest small-sample return.

## Verdict

Among the five strict-theory weather lanes, no lane produced a replacement-grade improvement. The higher-return candidates were mostly too trade-sparse, depended on one large cold-long win, or failed when checked by side and walk-forward validation. These lanes are archived as research evidence and are no longer loaded into the active dashboard registry.

| Lane | Current baseline | Best useful finding | Promotion decision |
| --- | ---: | --- | --- |
| Rule arctic threshold | 4.9% total, 20 trades, -27.66% maxDD | Baseline thresholds were still the best train-ranked combined candidate. Cold-only looked strong full-sample but failed post-cutoff; tighter warm-short improved post-cutoff but failed train. | Archive only. |
| Regularized logistic regression | 3.4% total, 6 trades, -17.38% maxDD | Weather-core `lambda=0.002`, `l1=0`, `0.50/0.50` threshold reproduced the current post-cutoff return. No 6-trade candidate beat it. | Archive only. |
| Elastic net expected return | 21.6% total, 4 trades, -2.71% maxDD | Headline return was mostly one cold-long winner; side-specific walk-forward checks fell to 0.8% combined over 5 post trades. | Do not promote; mark as small-N suspect. |
| Gradient boosted trees | -0.64% total, 4 trades, -7.46% maxDD | Best diagnostic holdout variant made 14.65% over 4 trades, but validation used only 2 trades and the walk-forward-selected model lost money post-cutoff. | Do not promote; demote until more winters. |
| Meta-label trade filter | -6.22% total, 6 trades, -17.45% maxDD | Best validation-selected filter made 19.78% over 4 post-cutoff trades; the 6-trade candidate made only 3.75% with similar drawdown. | Keep as risk-filter research only. |

## Practical Takeaways

- Warm-short appears more stable than the cold-long side in the post-cutoff sample, but not enough to standalone-promote yet.
- Cold-long can drive impressive returns, but current evidence is too concentrated in one or two trades.
- The ML lanes should require more winters, more post-cutoff trades, or a rolling paper ledger before any dashboard promotion status changes.
- Future optimization should prioritize side-sleeve validation and drawdown control before searching larger hyperparameter grids.

## Active Lanes

The new `weather-hybrid-rotation/` lane is the second active QORE research strategy and the direct weather thesis implementation. It keeps idle capital in `US-INDEX-BASKET`, uses GFS/GEFS 7-10 day winter forecast windows as the setup, and selected a fade-only architecture so it bets against overreaction after the weather-fear window instead of chasing the initial move.

| Lane | Selected rule | Main evidence | Promotion decision |
| --- | --- | --- | --- |
| Weather hybrid rotation | Fade-only GFS/GEFS setup; anomaly >= 5F; side coverage >= 50%; confidence >= 0.50; 20% UNG reversion overlay for 2 trading days after a 2% realized UNG move; idle capital in US index basket. | Full 133.32% vs 91.47% index; train 27.95%, validation 63.98%, holdout 11.21%; holdout edge vs index was 0.27%, so the result is positive but not yet decisive. | Active research baseline, not broker-ready. Prefer this over train-heavy weather-follow candidates because validation stayed strong and holdout stayed positive after selection. |

The new `volatility-mean-reversion/` lane is intentionally separate from the five strict-theory weather models. It uses UNG daily market data instead of Arctic Blast forecast rows, enters at the next session open, exits at that session close, and trades only winter signal dates after volatility-normalized moves.

| Lane | Selected rule | Main evidence | Promotion decision |
| --- | --- | --- | --- |
| Volatility mean reversion | 35% notional; 40-session volatility lookback; abs(previous close-to-close return / volatility) >= 0.8; volatility between 2.5% and 6%; contrarian next-session open-to-close trade. | 496 full-sample trades, 462 train trades, 34 post-cutoff trades; full 68.97% total, -6.33% maxDD, Sharpe 0.68, Sortino 1.12; holdout 6.38% total, -2.08% maxDD, Sharpe 1.74. | Active research baseline, not broker-ready. This improves the risk-adjusted shape while keeping the model a winter UNG volatility-reversion lane rather than a weather-forecast-following Arctic Blast model. |

## Artifacts

- `rule-arctic-threshold/`
- `regularized-logistic-regression/`
- `elastic-net-expected-return/`
- `gradient-boosted-trees/`
- `meta-label-trade-filter/`
- `weather-hybrid-rotation/`
- `volatility-mean-reversion/`
