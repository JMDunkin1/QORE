# Spatial-demand and forecast-revision shadow

## Status

This is one frozen, non-executable research candidate. It does not modify `ngas-all-year-beta`, component optimizers, selected research artifacts, inference handoffs, dashboard DTOs, readiness, or broker routing. Its separate manifest is locally sealed but has no external timestamp anchor, so its observations are not claimed as pristine forward evidence and cannot satisfy a production promotion gate.

The candidate exists to test a narrow physical question: when the same future weather day becomes more heating- or cooling-demand intensive across the reviewed load basket, do natural-gas returns improve when both GFS and GEFS agree and the price has not already moved in the same direction?

## Frozen feature

For each target trading session, the collector resolves the preceding reviewed market session as the current forecast issue. It compares:

- the current issue's lead-7 forecast; and
- the previous calendar day's lead-8 forecast for the exact same weather target.

Both forecasts must be 00Z runs with exact target offsets `6|12|18|24`, equal-mean aggregation, the complete reviewed 18-location/1.06-weight universe, and authenticated retained NASA POWER normals. GFS and GEFS must both be complete. Every retained sample binds the exact reviewed NOAA object and index URL, selected-field and index payload digests, forecast hour, valid time, location vector, and complete location set.

At each location, Summer demand is CDD anomaly and Winter demand is HDD anomaly around 65F. The shadow retains the source-level and consensus demand level, revision, directional breadth, tails, extremes, Texas sub-basket, model disagreement, and full 18-location revision vector. These diagnostics are preserved without fitting source weights or a temperature-to-price conversion coefficient.

The price gate uses `NG=F` only as a research signal proxy. It compares the close of the reviewed session immediately before the current issue with the current issue-session close. Target-session, future, provisional, duplicated, substituted, or non-session bars are rejected. `NG=F` research and `UNG` execution remain different contracts.

## Frozen decision

The candidate has one rule set and no tunable family:

- GFS and GEFS demand-revision directions must agree.
- Absolute equal-model consensus revision must be at least 1 demand-degree F.
- At least two-thirds of reviewed location weight must revise in that direction by at least 0.25 demand-degree F, so rounding noise cannot manufacture breadth.
- The issue-session `NG=F` return must be flat or opposite the revision direction.
- Summer can go long but cannot short; Winter can go long or short.
- A passing signal uses exactly `+0.25` or `-0.25` gas exposure, `0.75` index exposure, and zero cash. Otherwise it records the exact index fallback.

This low-dimensional categorical rule was chosen instead of fitting a continuous residual coefficient, CNN, graph model, or many thresholds. It follows the demand thesis while keeping the effective candidate family at one.

## Collection and evidence boundary

Run the standalone collector before 09:30 New York time on a reviewed 2026-2028 market session:

```bash
node scripts/collect-qore-spatial-demand-revision-shadow.mjs
```

It writes one owner-only record per date beneath:

```text
.local/qore/shadow-validation/spatial-demand-revision-breadth-price-gate-v1/targets/
```

The writer uses its own clock, allows at most 60 seconds between feature generation and append, uses atomic no-overwrite creation, and rejects holidays, weekends, unreviewed calendar years, post-open records, and backfills. An input failure is recorded as a failure with no feature and no synthetic flat target. Valid records re-derive the feature and decision from their retained forecast atoms and market rows before append.

Before collecting a new target, the same command attempts to settle the preceding reviewed target. Settlement is allowed only before the next reviewed session's open and writes exact adjusted `UNG`/`VOO`/`QQQM` OHLC, official Yahoo request identity, response-payload digest, target-record digest, outcome-policy digest, and research-execution digest beneath the adjacent `settlements/` directory. A missing prior target or failed settlement is never backfilled: the collector still preserves the current pre-open target, records the settlement failure in its diagnostics, and exits nonzero so the operator is alerted without turning one gap into a permanent collection outage.

The local Codex automation `QORE Spatial Demand Shadow` runs this collector on reviewed weekdays at 08:00 New York time and then runs the read-only evaluator. It reports failed runs only and is explicitly restricted from tracked-file changes, resealing, retraining, broker calls, paper/live routing, and order operations. Because it is a local job, the machine and Codex automation host must be available during the pre-open window.

Inspect collection completeness with:

```bash
node scripts/evaluate-qore-spatial-demand-revision-shadow.mjs
```

The evaluator is deliberately read-only. It reports missing sessions, input failures, signals, directions, ten-session-embargoed episodes, component seasons, and settlements. Across the complete contiguous evidence prefix it replays the candidate and a persistent matched 98%-deployed VOO/QQQM fallback through the frozen shared execution engine under baseline, elevated, and stress costs. Missing targets, input failures, and missing settlements are never imputed as flat observations.

## Interpretation limits

- The checked 2021-2026 revision experiments are development-contaminated and rejected for promotion; this journal starts a new observation lane rather than relabeling those results.
- Local hashes prove internal consistency, not historical existence. A signed remote commit/tag, transparency log, or WORM/notary timestamp is required before any future observation can be called pristine.
- NOAA 00Z issue dates are treated as available before the later target session; the current archive does not independently attest the precise publication timestamp.
- `NG=F` is a continuous front-month proxy and can contain roll effects.
- Raw remote GRIB objects are not retained. The reviewed builder and its payload bindings remain the acquisition-attestation boundary.
- The current all-year artifact is a sealed identity reference and remains `needs-validation` and paper/live ineligible. It is not reconstructed as a daily comparator from later data. The prospective return comparator is the frozen matched index fallback, which isolates the standalone value of the new physical signal before any future integration proposal.

The frozen research review minimum is 60 independent changed episodes, at least 15 episodes and two seasons per component, positive leave-one-component-season-out results, limited top-episode concentration, no more than 10% active drawdown, and acceptable incremental returns under baseline, elevated, and stress costs. Passing those gates could justify a new reviewed production proposal only; it cannot promote this shadow automatically.
