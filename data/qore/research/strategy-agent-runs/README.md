# Strategy Agent Runs - 2026-06-10

Five isolated worker lanes tested the existing strict-theory Arctic Blast algorithms against the shared `data/qore` dataset. Each worker wrote and executed its own code under a lane-specific folder so the lanes could run without touching the shared optimizer or each other.

## Shared Validation Contract

- Tradable PnL column: `returnPctEntryCloseToTarget`.
- No-lookahead rules: `entryTradeDate > issueDate`, `targetTradeDate >= targetDate`, and `targetTradeDate > entryTradeDate`.
- Main holdout split: train before `2025-11-01`, test on or after `2025-11-01`.
- Strategy universe: winter 7-10 day UNG rumor-window rows with strict cold-long or warm-short confirmation from at least two source groups and two model families.
- Promotion standard: prefer enough trades, side stability, and pre/post consistency over the highest small-sample return.

## Verdict

No lane produced a replacement-grade improvement. The higher-return candidates were mostly too trade-sparse, depended on one large cold-long win, or failed when checked by side and walk-forward validation. The shared baselines should stay unchanged for now.

| Lane | Current baseline | Best useful finding | Promotion decision |
| --- | ---: | --- | --- |
| Rule arctic threshold | 4.9% total, 20 trades, -27.66% maxDD | Baseline thresholds were still the best train-ranked combined candidate. Cold-only looked strong full-sample but failed post-cutoff; tighter warm-short improved post-cutoff but failed train. | Keep baseline. |
| Regularized logistic regression | 3.4% total, 6 trades, -17.38% maxDD | Weather-core `lambda=0.002`, `l1=0`, `0.50/0.50` threshold reproduced the current post-cutoff return. No 6-trade candidate beat it. | Keep baseline. |
| Elastic net expected return | 21.6% total, 4 trades, -2.71% maxDD | Headline return was mostly one cold-long winner; side-specific walk-forward checks fell to 0.8% combined over 5 post trades. | Do not promote; mark as small-N suspect. |
| Gradient boosted trees | -0.64% total, 4 trades, -7.46% maxDD | Best diagnostic holdout variant made 14.65% over 4 trades, but validation used only 2 trades and the walk-forward-selected model lost money post-cutoff. | Do not promote; demote until more winters. |
| Meta-label trade filter | -6.22% total, 6 trades, -17.45% maxDD | Best validation-selected filter made 19.78% over 4 post-cutoff trades; the 6-trade candidate made only 3.75% with similar drawdown. | Keep as risk-filter research only. |

## Practical Takeaways

- Warm-short appears more stable than the cold-long side in the post-cutoff sample, but not enough to standalone-promote yet.
- Cold-long can drive impressive returns, but current evidence is too concentrated in one or two trades.
- The ML lanes should require more winters, more post-cutoff trades, or a rolling paper ledger before any dashboard promotion status changes.
- Future optimization should prioritize side-sleeve validation and drawdown control before searching larger hyperparameter grids.

## Artifacts

- `rule-arctic-threshold/`
- `regularized-logistic-regression/`
- `elastic-net-expected-return/`
- `gradient-boosted-trees/`
- `meta-label-trade-filter/`
