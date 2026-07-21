# All-Year Natural-Gas Strategy Contract

## Scope

`ngas-all-year-beta` is QORE's only public strategy. It is a deterministic daily selector over two internal component ledgers:

1. use the material Summer Alpha row;
2. otherwise use the material Winter Alpha row;
3. otherwise use the shared `US-INDEX-BASKET` fallback target.

A component row is material when it has a non-index thesis, non-zero gas position, or an explicit index-to-cash allocation change. If summer and winter are both material on the same date, artifact generation fails instead of choosing silently. The all-year layer selects targets first and then recomputes the complete UNG/VOO/QQQM execution ledger, so component-local costs cannot decide which lane wins. It adds no threshold search, sizing search, or holdout-driven selection.

## Economic thesis

The winter engine tests the observation that sufficiently broad cold forecasts across the central and eastern United States can raise expected heating demand and natural-gas prices. Longer-lead cold confirmation can support a gas-follow position; as the event approaches or the market overreacts, the engine can use weather resolution and same-direction price behavior for a reversion/fade decision.

The summer engine applies the same demand logic to cooling: fresh, multi-model heat forecasts can support a gas-long overlay, while same-direction rallies can qualify for a storage- and demand-aware fade. These are tested rules, not assumed causal facts.

## Timing and inputs

- Forecast issue-date signals execute only on later trading sessions.
- Live target inference requires a complete common NOAA GFS/GEFS 00z issue set and rejects stale or incomplete forecast state.
- Live price inputs come from an ignored rolling Yahoo cache of completed sessions. The target-date daily bar is excluded; both gas series must cover the authoritative VOO/QQQM session set, and an unverified intervening weekday fails closed.
- Open-Meteo current forecasts provide operational weather/risk context; they do not set the broker target.
- EIA Lower 48 storage is used only after its versioned WNGSR publication timestamp.
- NASA POWER actual temperatures and 1991–2020 normals support historical anomaly and forecast-quality work.
- Unallocated deployable capital follows the configured VOO/QQQM target-weight index basket. The frozen research execution contract keeps the broker's default 2% cash buffer uninvested.

The exact frozen thresholds, sources, sizing rules, costs, and split dates are authoritative in the component `run-summary.json` files and the executable live contract consumed by `scripts/lib/qore-live-all-year-inference.mjs`. The all-year artifact stores their canonical contract and digest; paper/live inference fails closed unless that reviewed digest matches the executable contract. Change those together; do not describe one contract and execute another.

## Research contract

The summer and winter components retain their own train, validation, and holdout boundaries. Each component selects and determines its eligibility on its own train/validation period only. The all-year artifact records each source row's component split separately. Its public `split` is one calendar-wide partition: train ends at the earliest component train end, public holdout starts at the latest component holdout, and the intervening sessions are validation. A separate selection cutoff ends before the earliest component holdout. All-year return-based promotion gates and the selection bootstrap use only that chronological prefix; later composite returns are reporting-only at the all-year layer, while the component-eligibility gates retain each component's separately sealed pre-holdout result. This ensures no component validation row is mislabeled as public holdout and no component holdout return enters an all-year return-based promotion gate.

All-year eligibility uses a centered circular block bootstrap of every chronological daily active return in that contiguous calendar-wide train/validation prefix versus the index fallback. The UI's Monte Carlo panel is explicitly a report-only full-calendar block-bootstrap diagnostic, not a forecast of live wealth or an independent proof of significance.

Run the pipeline with:

```bash
npm run train
npm run backtest
```

The authoritative output is `data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json`; `selected-trades.csv` is the full audit ledger and `display-curve.csv` is its narrow UI projection.

## Research versus execution

Summer Alpha retains Yahoo's continuous `NG=F` proxy only for price confirmation, realized-move gates, and signal-volatility sizing. Every gas return used for Summer selection, Winter selection, and the all-year portfolio is Yahoo `UNG` ETF history. The all-year ledger therefore has one gas P&L contract: `UNG`, matching the Alpaca adapter.

The frozen `config/qore-research-execution.json` contract applies a causal daily timeline. Prior-close holdings earn the close-to-open move; current targets become effective at the split- and distribution-adjusted session open and earn only open-to-close returns. Any same-date close-in weather update used at that open comes from a frozen 00Z run assumed available before the New York session; the historical calendar does not store a separate publication timestamp. Summer and Winter storage logic uses the versioned EIA WNGSR release calendar, including published holiday changes and documented extraordinary delays, and admits a report only at a session open after its publication timestamp. A missing storage release-calendar row fails closed. NASA POWER actual meteorology carries a conservative three-calendar-day availability lag. Turnover is computed separately for UNG, VOO, and QQQM after drift and the broker's default rebalance deadband. Exactly one frozen baseline cost scenario may rank candidates; elevated and stress costs are reporting-only and cannot be made selection-eligible without changing the versioned contract.

The separate `config/qore-overnight-risk-policy.json` contract tests whether QORE should reduce UNG at the close and restore the ordinary target at the next open. Its 50-policy audit covers fixed retention, long-only and short-only flattening, weekend flattening, and lagged rolling-gap guards under baseline, elevated, and stress friction. Calendar years 2021–2023 train the overlay, 2024 validates it, and 2025 onward is a report-only holdout. The pre-holdout winner is the sole research recommendation; holdout comparisons cannot promote, reject, or replace it. The deployed policy remains `carry-100` until the recommended close-side execution path is separately reviewed and implemented. Reproduce the audit with `npm run research:overnight-risk`.

`carry-100` means no closing-auction or overnight-session order is added: the prior-close UNG holding owns the overnight move and the next causal target still starts at the regular-session open. Alternative auction or extended-hours routes remain research-only unless their own timestamped quote/fill evidence, broker entitlement, order cutoffs, and whole-share constraints are validated.

This is still an idealized once-per-session execution simulation. The live supervisor may reassess an updated target or drift intraday, while the daily Yahoo history cannot reconstruct those quote crossings or fills. Missing historical quotes and fills cannot be recreated, and future gaps, slippage, partial fills, market impact, and borrow availability remain live outcomes. NASA POWER actuals are not archived as immutable historical vintages, so later upstream revisions also cannot be removed retrospectively. ETF expenses and historical futures-roll tracking are already embedded in UNG adjusted prices; taxes remain account-specific and are excluded from the pretax research return.

Negative `UNG` targets require a margin/short-capable Alpaca account, explicit QORE permission, current Alpaca shortability, and whole-share sizing. If those conditions fail, QORE blocks the order rather than changing the strategy.

True `NG`, `MNG`, or `QG` execution remains out of scope until the project has reviewed contract-month selection, expiry and roll logic, margin and price-limit handling, and delivery-risk controls.

## Promotion standard

Treat the checked-in artifact as a research baseline. Before enabling real capital, require clean reproducible artifacts, passing inference parity and trading tests, non-overlapping Alpaca paper evidence, reviewed broker/risk configuration, a clean deployed commit, and a successful no-order readiness audit. Live account performance must be evaluated from Alpaca telemetry, never spliced with the research curve.
