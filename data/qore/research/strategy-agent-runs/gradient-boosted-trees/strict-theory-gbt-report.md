# Strict-Theory Gradient Boosted Trees Run

Generated: 2026-06-10T04:04:43.054Z

## Contract

- PnL column: `returnPctEntryCloseToTarget`.
- Timing guard: `entryTradeDate > issueDate`, `targetTradeDate >= targetDate`, `targetTradeDate > entryTradeDate`.
- Universe: winter 7-10 day UNG rumor rows with cold-long or warm-short strict-theory confirmation from at least two source groups and two model families.
- Validation: model/config ranking uses only pre-2025-11-01 walk-forward folds; the post-2025-11-01 holdout is reported after selection.

## Dataset

- Strict-theory tradable rows: 231
- Pre-cutoff rows: 124
- Post-cutoff rows: 107
- Side counts: cold-long 59, warm-short 172

## Selected By Walk-Forward Rank

- ID: `strict-theory-gbt__all__consensus__longHistoryCore__weatherOnly__e12__d2__lr0.06__lf0.1__sig8__cov0.55__ex0__thr0.064`
- Params: side=all, candidateMode=consensus, sourcePolicy=longHistoryCore, features=weatherOnly, estimators=12, depth=2, learningRate=0.06, minLeafFrac=0.1
- Weather gate: minSignal=8F, minCoverage=0.55, minExtremeCount=0, minExpectedTheoryReturn=0.064%
- Walk-forward: total=17.94%, sharpe=4.17, drawdown=0%, trades=2, worstFold=17.94%
- Holdout: total=-5.23%, sharpe=-1.55, drawdown=-7.46%, trades=3
- Holdout sides: cold-long 0% / 0 trades; warm-short -5.23% / 3 trades

## Current Shared Baseline Comparator

- Current strict-theory GBT baseline: total=-0.64%, sharpe=-0.06, drawdown=-7.46%, trades=4

## Sleeve Check

- Cold-only GBT configs with validation: 0; max validation trades=0; max holdout trades=0.
- Warm-only GBT configs with validation: 2400; max validation trades=1; max holdout trades=2.
- All-side GBT max validation trades=2; max holdout trades=4.

## Robust Top Candidates

- None met the minimum robustness bar of 6 validation trades plus at least 3 holdout trades.

## Diagnostic Top Holdout

- strict-theory-gbt__all__consensus__longHistoryCore__weatherOnly__e20__d2__lr0.06__lf0.1__sig8__cov0.55__ex0__thr0.25: holdout=14.65% over 4 trades; walk-forward=17.94% over 2 trades; cold holdout=18.77%/1 trades; warm holdout=-3.47%/3 trades. This is useful evidence, not a replacement-grade result, because the validation sample is only two trades.

## Recommendation

Verdict: demote.

- Baseline: Do not replace the shared strict-theory-gradient-boosted-trees baseline with any candidate from this lane.
- Split sleeves: Do not split GBT into cold/warm sleeves yet: cold-only has no walk-forward-valid configs, and warm-only has too few validation trades with non-positive holdout behavior.
- Replacement: Do not replace GBT with the top holdout diagnostic; its apparent gain depends on two validation trades and one cold-long holdout winner.
- Integration: Mark strict-theory-gradient-boosted-trees as research-only/demoted in shared strategy integration, keep it out of default recommended-strategy charts, and wait for additional winter out-of-sample evidence before promotion.
