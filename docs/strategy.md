# All-Year Natural-Gas Strategy Contract

## Scope

`ngas-all-year-beta` is QORE's only public strategy. It is a deterministic daily selector over two internal component ledgers:

1. use the material Summer Alpha row;
2. otherwise use the material Winter Alpha row;
3. otherwise use the shared, no-cost `US-INDEX-BASKET` fallback row.

A component row is material when it has a non-index thesis, non-zero gas position, or non-zero trading cost. If summer and winter are both material on the same date, artifact generation fails instead of choosing silently. The all-year layer adds no threshold search, sizing search, or holdout-driven selection.

## Economic thesis

The winter engine tests the observation that sufficiently broad cold forecasts across the central and eastern United States can raise expected heating demand and natural-gas prices. Longer-lead cold confirmation can support a gas-follow position; as the event approaches or the market overreacts, the engine can use weather resolution and same-direction price behavior for a reversion/fade decision.

The summer engine applies the same demand logic to cooling: fresh, multi-model heat forecasts can support a gas-long overlay, while same-direction rallies can qualify for a storage- and demand-aware fade. These are tested rules, not assumed causal facts.

## Timing and inputs

- Forecast issue-date signals execute only on later trading sessions.
- Live target inference requires a complete common NOAA GFS/GEFS 00z issue set and rejects stale or incomplete forecast state.
- Open-Meteo current forecasts provide operational weather/risk context; they do not set the broker target.
- EIA Lower 48 storage is used only after the component's conservative release/availability lag.
- NASA POWER actual temperatures and 1991–2020 normals support historical anomaly and forecast-quality work.
- Unallocated capital follows the configured VOO/QQQM target-weight index basket.

The exact frozen thresholds, sources, sizing rules, costs, and split dates are authoritative in the component `run-summary.json` files and `scripts/lib/qore-live-all-year-inference.mjs`. Change those together; do not describe one contract and execute another.

## Research contract

The summer and winter components retain their own train, validation, and holdout boundaries. Each component selects on train/validation only. The all-year artifact preserves those source-row split labels and reports holdout only after selection.

The primary all-year significance check is a centered circular block bootstrap of daily active return versus the index fallback. The UI's Monte Carlo panel is explicitly a full-calendar block-bootstrap diagnostic, not a forecast of live wealth or an independent proof of significance.

Run the pipeline with:

```bash
npm run train
npm run backtest
```

The authoritative output is `data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json`; `selected-trades.csv` is the full audit ledger and `display-curve.csv` is its narrow UI projection.

## Research versus execution

Historical gas returns are component-specific: Summer Alpha uses Yahoo's continuous `NG=F` proxy, while Winter Alpha uses Yahoo `UNG` ETF history. The versioned all-year ledger labels the research instrument on every row. Live and paper reconciliation uses `UNG` because the Alpaca adapter is equity/ETF-only. Differences in tracking, fees, market hours, liquidity, borrow, and futures roll behavior mean the mixed-instrument backtest is not an exact execution simulation.

Negative `UNG` targets require a margin/short-capable Alpaca account, explicit QORE permission, current Alpaca shortability, and whole-share sizing. If those conditions fail, QORE blocks the order rather than changing the strategy.

True `NG`, `MNG`, or `QG` execution remains out of scope until the project has reviewed contract-month selection, expiry and roll logic, margin and price-limit handling, and delivery-risk controls.

## Promotion standard

Treat the checked-in artifact as a research baseline. Before enabling real capital, require clean reproducible artifacts, passing inference parity and trading tests, non-overlapping Alpaca paper evidence, reviewed broker/risk configuration, a clean deployed commit, and a successful no-order readiness audit. Live account performance must be evaluated from Alpaca telemetry, never spliced with the research curve.
