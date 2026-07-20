# QORE // Natural Gas

QORE is a local research and execution-control system for one strategy: `ngas-all-year-beta`. It combines internal summer and winter natural-gas signal engines, keeps unallocated capital in a VOO/QQQM index fallback, and routes the executable gas leg through `UNG` at Alpaca.

The browser has two surfaces:

- **Command** shows actual Alpaca paper/live equity history, positions, open orders, the current all-year target, and fail-closed risk state. Its refresh action is read-only.
- **Backtest** shows the checked-in all-year research curve, train/validation/holdout results, block-bootstrap Monte Carlo, and weather diagnostics.

No other strategy is part of the public product. Summer and winter components remain in the repository only because the all-year selector and live inference depend on them.

## Start locally

QORE requires Node 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

`npm run dev` binds the Vite dashboard and its telemetry service to loopback, chooses free local ports when necessary, and prints both URLs. Use `npm run dev:vite` only for UI work that does not need Command telemetry.

The installed launcher is optional:

```bash
npm run install:command
qore
```

## Research workflow

```bash
npm run data:refresh
npm run data:forecasts:gfs
npm run data:forecasts:gefs
npm run data:forecasts:graphcast
npm run data:quality
npm run train
npm run backtest
```

`data:quality` rebuilds the narrow weather-quality summary used by Backtest. `train` refreshes the internal summer and winter component ledgers, then rebuilds the single public all-year artifact. Use `train:component:summer` or `train:component:winter` only when deliberately working on one internal engine. `backtest` refreshes weather QA and rebuilds the all-year artifact from the existing component ledgers.

The reproducible research artifacts live under `data/qore/`. In particular, the dashboard reads:

- `data/qore/research/strategy-agent-runs/ngas-all-year-beta/run-summary.json`
- `data/qore/research/strategy-agent-runs/ngas-all-year-beta/display-curve.csv`
- `data/qore/research/ngas-weather-quality-summary.json`

Optimizer commands update checked-in artifacts. Inspect those diffs before committing them.

## Live and paper workflow

Start with dry-run, graduate to Alpaca paper, and treat live routing as a separate reviewed deployment step.

```bash
npm run trade:prepare
npm run trade:readiness
npm run broker:status
npm run broker:dry-run
npm run broker:paper
```

`trade:prepare` refreshes or verifies the current weather, market, storage, inference, signal, and risk handoffs on their configured cadences without invoking the broker reconciler. It does not retrain the strategy. `trade:readiness` is the no-order preflight. Long-running operation uses `npm run trade:run`; one supervised pass uses `npm run trade:once`.

Real-money routing is intentionally harder to enable:

```bash
npm run broker:live
```

Credentials and confirmations belong in a mode-`600` `.env.local`, never in source control. See [the broker setup guide](docs/live-trading-broker-setup.md) for exact gates, paper-to-live promotion, the Linux service, and emergency stop commands.

## Data boundary

`data/qore/` contains versioned research inputs and reproducible outputs. `.local/qore/` contains mutable runtime state: live forecasts, inference, broker snapshots, order logs, supervisor status, and local validation output. `.local/` is ignored and must not be promoted into research data without an explicit, reproducible import step.

The all-year research ledger is mixed by component: Summer Alpha gas rows use Yahoo's `NG=F` continuous front-month proxy, while Winter Alpha gas rows use Yahoo `UNG` ETF history. Alpaca routes `UNG`, not futures. The versioned all-year artifact records the instrument on each row, and the backtest remains research evidence rather than an exact simulation of live ETF fills. QORE refuses `NG`, `MNG`, and `QG` orders until contract selection, expiry, roll, margin, and delivery controls exist.

## Validate changes

```bash
npm run lint
npm run build
npm test
```

Read [the strategy contract](docs/strategy.md) before changing signal logic and [AGENTS.md](AGENTS.md) before changing repository boundaries.
