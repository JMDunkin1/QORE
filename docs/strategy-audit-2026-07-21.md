# NGAS All-Year Beta strategy audit — 2026-07-21

## Decision

Do not promote a return-optimized historical variant. Keep `ngas-all-year-beta` in `needs-validation` and keep paper/live routing disabled. No tested return change could be defended below the requested 33% overfit-probability ceiling; the best low-risk idea is frozen as a non-executable prospective shadow instead.

The checked-in strategy has useful development evidence, but it does not satisfy a defensible non-overfit promotion standard. Its pre-holdout bootstrap is not significant, its train drawdown breaches the promotion floor, and the Winter component has no eligible candidate. More importantly, repository development began after the dates labeled as component holdouts, and holdout results were printed throughout repeated searches. The 2021-2026 history must therefore be treated as development-contaminated retrospective evidence rather than sealed out-of-sample evidence.

## Checked-in baseline

| Period | Total return | CAGR | Sharpe | Max drawdown |
| --- | ---: | ---: | ---: | ---: |
| Train | 66.18% | 18.57% | 0.91 | -28.32% |
| Artifact validation | 101.10% | 46.52% | 1.92 | -16.68% |
| Retrospective evaluation | 17.77% | 26.63% | 1.44 | -9.39% |
| Full calendar | 293.56% | 28.16% | 1.31 | -28.32% |

The full-calendar bootstrap p-value is 0.02175, but it includes data observed during development and is reporting-only. The promotion-eligible prefix ending 2024-12-31 has p=0.15314; its 2024 tuning return is 25.94% versus 25.17% for the index, only +0.77 percentage points of edge. The artifact also fails the -20% train drawdown floor and the Winter component gate.

## What was tested

- Reconstructed the search history from Git. The recorded Summer family grew from 27,648 to 103,680 candidates and the Winter family from 10 to 642 before later narrowing. Reported holdout metrics remained visible while those families changed.
- Re-ran the current 2-candidate Summer family and the current 135-candidate Winter family.
- Re-expanded Summer to its 103,680-variant grid under the current causal UNG execution accounting. Of 590 mechanically eligible rows, the strongest improved headline return and drawdown but had a selection-adjusted p-value of 0.0758 even though the adjustment retained only 80 surviving near-top candidates rather than the complete historical search universe.
- Ran an isolated broad Winter neighborhood of 2,025 combinations across hold policy, repeat-signal freshness, storage gate, heating-demand sizing, and 1.00x-1.25x overlay risk.
- Re-tested a deliberately simpler Winter challenger with a three-day repeated-signal freshness rule and 1.00x overlay risk.
- Tested hard Summer realized-move thresholds from 1.00% through 5.00%, then a theory-first continuous fade ramp that scales from zero at a 1.50% move to the existing full fade size at 2.00%. Replayed both through the exact all-year execution engine.
- Tested the continuous ramp under baseline, elevated, and stress costs, inspected every changed target and its subsequent overnight window, and compared it with a broader 1.50%-4.00% ramp to check whether the result generalized beyond the three threshold-edge events.
- Tested all 50 versioned overnight policies under baseline, elevated, and stress friction. `carry-100` remains the correct deployed policy; the close-side challenger failed the holdout comparisons and lacks executable fill evidence.
- Checked baseline/elevated/stress transaction costs and borrow assumptions.
- Audited signal timing, split boundaries, forecast coverage, live-source parity, execution-price parity, artifact promotion, broker provenance, and exposure limits.
- Examined block-bootstrap sensitivity. On the all-year selection prefix, p-values ranged from 0.192 at a one-session block to 0.034 at a 252-session block; the fixed ten-session result is about 0.15. That instability is inconsistent with a strong promotion claim.

## Best retrospective challengers

| Challenger | Train edge | Validation edge | Full return | Sharpe | Max drawdown | Turnover | Statistical verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Broad Summer winner: 3F anomaly / 0.35 confidence | +37.55pp | +3.55pp | 220.92% | 1.24 | -19.16% | 116.71 | adjusted p=0.0758 over only 80 survivors; retrospective only |
| Summer hard 1.50% realized-move fade | +22.31pp | +8.60pp | 223.84% | 1.23 | -22.71% | 109.63 | only 3 added entries; estimated 40%-60% overfit risk; reject |
| Summer 1.50%-2.00% linear fade ramp | +21.60pp | +7.71pp | 218.29% | 1.21 | -22.71% | 107.50 | only 2 material pre-selection additions; shadow only |
| Current Winter | -5.28pp | +30.40pp | 169.94% | 1.05 | -31.38% | 134.63 | p=0.1507; ineligible |
| Three-day freshness, one-day follow hold, 1.25x risk | +4.48pp | +21.09pp | 174.29% | 1.10 | -25.65% | 180 trades | family-adjusted p=0.0899; retrospective only |
| Three-day freshness, 1.00x risk | +6.03pp | +22.29pp | 171.03% | 1.11 | -28.73% | 100.11 | single-candidate p=0.0491; not adjusted for the historical search |

The hard 1.50% Summer threshold raises the exact all-year full return from 293.56% to 308.15%, but it changes only three dates and the selection-prefix bootstrap remains weak at about p=0.125. The continuous ramp is safer: it raises all-year full return to 301.15%, CAGR from 28.16% to 28.60%, and Sharpe from 1.307 to 1.324 with the same -28.32% drawdown. It also survives stress costs. However, two pre-selection overnight gaps produce nearly all of that gain, the largest incremental UNG target is still 32.38% of deployable capital, and the unadjusted selection-prefix p-value remains about 0.134. A broader 1.50%-4.00% ramp loses to the current strategy. The narrow ramp therefore remains a prospective shadow, not an executed target.

The broad-search winners improve several retrospective metrics, but none clears a complete-family multiple-testing test. Every challenger was evaluated after the historical evaluation periods were visible. They are rejected for promotion.

## Material audit findings

1. **Historical holdouts are not sealed.** Summer's labeled holdout begins 2025-01-01 and Winter's begins 2025-11-01, while repository strategy development first appears on 2026-06-11. Candidate reports disclose holdout metrics, so later family choices cannot be proven independent of them.
2. **The effective search universe is understated.** Current reality checks cover only the surviving families, not the historical architecture and parameter searches. The all-year family size of one also omits component selection.
3. **A latent Summer sizing path used same-day information.** Volatility-target candidates included the current close-to-close return in volatility used for the position effective at that day's open. The selected fixed-size candidate is unaffected, but the candidate path is noncausal until corrected.
4. **Risk-adjusted ranking was misstated.** Sortino used the standard deviation of negative observations instead of downside deviation over all sessions.
5. **Side gates do not isolate gas alpha.** Some thesis profitability checks credit blended portfolio/index return and can count a row in more than one Winter thesis. These gates should eventually use marginal net gas-sleeve contribution clustered by independent forecast episode.
6. **Summer 2026 evidence is missing, not flat.** The cooling-season day-7 GFS/GEFS calendars end 2025-09-30. The audited daily coverage contract finds 833 required issue dates, 758 fully covered dates, and a 75-date gap per source from 2026-04-24 through 2026-07-07. May-July 2026 rows silently fall back to the index, so the public curve contains no 2026 Summer overlays.
7. **Research/live target parity fails in Winter.** The dedicated Summer production-source replay matches all 585 targets whose weather target falls in May-September, including seven material April entries for May weather targets, across gas position, index fraction, and thesis. Replaying all 1,362 versioned Winter targets through the production forecast-source contract still produces 15 target mismatches. Examples include research-flat/live-short on 2024-11-25 (0 versus -0.2517) and research-short/live-flat on 2025-11-24 (-0.4681 versus 0). AIGFS also lacks train/validation history, and research still assumes the adjusted open while live market orders necessarily arrive later.
8. **The broker boundary accepted excess UNG concentration.** Before remediation, a provenance-valid handoff could specify `abs(gasPosition)` up to 1 even though the reviewed seasonal contracts cap the Summer and Winter overlays far below that.
9. **Short execution evidence is incomplete.** The baseline assumes zero borrow cost; live shortability checks help, but retrospective availability, rejects, and fills are not modeled.

## Implemented audit response

- No historical return winner is promoted and no live signal parameter is changed.
- The current historical evaluation is explicitly labeled development-contaminated and a prospective-evidence seal becomes a required promotion input.
- Same-day volatility lookahead and Sortino calculation defects are corrected with regression tests.
- Paper/live handoffs are constrained at both sanitized handoff and broker boundaries to the exact reviewed component/window/thesis caps: Summer heat follow 0.4375, cold follow 0.35, cold-signal reversion 0.35, heat-signal reversion 0.50, Winter follow/reversion 0.5625, and index fallback zero.
- Summer promotion requires the exact reviewed 18-location forecast basket and weights on every required GFS/GEFS issue date; partial or substituted location coverage fails closed.
- All-year promotion now requires deterministic, content-bound production-source replays for both components. Summer uses its dedicated lead-7 GFS/GEFS calendars and passes 585 of 585 targets tied to May-September weather dates, including the April/May boundary; Winter retains 15 mismatches in 1,362 rows, so the combined `liveTargetParity` gate remains false.
- The expanded parity policy is sealed before the prospective period begins, with zero forward observations, under end-to-end strategy digest `a09b0b755ebe148d235b7e842e0cd966f083efc3514279d429ba921903306b98`. The executable signal contract and selected-trade ledgers are unchanged.
- The 1.50%-2.00% Summer fade ramp is frozen as research-only shadow logic under its own digest and a digest of the complete active Summer comparator contract. It is excluded from candidate selection, promotion, selected ledgers, the executable contract, dashboard DTOs, and broker handoffs; `npm run research:summer-shadow` can write one owner-only, append-only, structurally validated record before 09:30 New York time only on the active Summer comparator schedule. Winter-only sessions, weekends, published full-day closures, and dates beyond the versioned 2026-2028 calendar fail closed, and those records cannot unlock paper or live routing.
- Prospective claims now require an observation end, sealed-contract and evidence digests, feasible completed-season chronology, and ordered reviews/approvals.
- Live eligibility now requires contract-bound, pseudonymized Alpaca paper evidence covering at least 60 trading sessions and 10 fills—including four UNG fills with at least two long and two short—with reviewed median absolute slippage at or below 25 bps and p95 at or below 50 bps.
- The end-to-end seal now includes the exact Summer location universe and a canonical Alpaca execution/risk profile tied to the backtest's 98% deployment, 0.25% deadband, and 80/20 VOO/QQQM basket. Production environment drift blocks before broker access, and test artifacts are confined to confirmed loopback endpoints.
- Evidence and approvals are checked against the runtime clock; future-dated records and reviews made before a claimed period is complete cannot unlock routing. The stable paper-account pseudonym stays out of browser-imported artifacts.
- The strongest simple Winter idea is documented as a rejected retrospective challenger. If revisited, it must be frozen before observation and evaluated without further tuning.

## Required evidence before promotion

Freeze a single end-to-end contract and candidate-registry digest before collecting new evidence. The next evaluation must use timestamped inference, quotes, shortability/borrow state, routing decisions, rejects, and Alpaca paper fills. The checked-in seal requires at least 60 independent episodes, two complete Summers, and two complete Winters. Before live approval it also requires at least 60 paper-trading sessions and 10 fills, including four UNG fills with at least two long and two short, with reviewed median absolute slippage at or below 25 bps and p95 at or below 50 bps. Evaluation must also preserve a purge/embargo covering forecast lead plus holding period, report parameter-neighborhood and block-length sensitivity, and evaluate marginal gas contribution net of costs.

Any change to signal, sizing, source set, location universe, cost model, selection rule, or broker execution/risk profile invalidates the seal and restarts the prospective window. Until those requirements and a separately reviewed live approval are present, permitted use is research and shadow observation only.
