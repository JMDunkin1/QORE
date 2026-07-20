# QORE Agent Contract

## Mission

Keep QORE focused on the all-year natural-gas system. A change belongs here only if it helps collect or validate natural-gas inputs, train or backtest `ngas-all-year-beta`, infer or execute its current target, enforce trading safety, or show those results in Command or Backtest.

Do not reintroduce crop, generic rotation, volatility-only, broad model-zoo, GitHub-control, or multi-strategy dashboard code.

## Product invariants

- `ngas-all-year-beta` is the only public strategy.
- `ngas-summer-alpha` and `ngas-winter-alpha` are internal component ledgers, not navigation items, selectable strategies, or independently promoted products.
- The UI has exactly two routes: `command` and `backtest`.
- Command consumes local runtime telemetry only. Do not mix research returns into live account performance.
- Backtest consumes versioned all-year artifacts only. Label `NG=F` research and `UNG` execution as different instrument contracts.
- The dashboard telemetry API stays read-only with respect to orders. `POST /api/live/refresh` may run broker `--status`; it must never reconcile or submit.
- Browser DTOs must not contain credentials, account identifiers, raw broker payloads, or unbounded log content.
- Alpaca execution is limited to `UNG`, `VOO`, and `QQQM`. Futures symbols remain blocked.
- Paper and live routes fail closed on stale/missing inference, risk limits, broker/account state, quote quality, venue state, or the operator kill switch.

## Code map

| Area | Responsibility |
| --- | --- |
| `src/views/CommandView.tsx` | Actual Alpaca account performance and operational state |
| `src/views/BacktestView.tsx` | Checked-in all-year research and validation |
| `src/data/allYearBacktest.ts` | Narrow parser/adapter for displayed research artifacts |
| `src/runtime/` | Typed client boundary for the local telemetry API |
| `scripts/optimize-ngas-*-alpha.mjs` | Internal seasonal component training |
| `scripts/optimize-ngas-all-year-beta.mjs` | Deterministic all-year selector and display artifact generation |
| `scripts/summarize-ngas-weather-quality.mjs` | Reproducible narrow weather-QA artifact for Backtest |
| `scripts/lib/qore-live-all-year-inference.mjs` | Shared live seasonal scoring and selector logic |
| `scripts/qore-live-*.mjs` | Current inputs, inference, risk, and supervision |
| `scripts/qore-alpaca-broker.mjs` | Authoritative Alpaca status, preflight, reconciliation, and order boundary |
| `scripts/qore-dashboard-service.mjs` | Loopback, sanitized, read-only Command telemetry |
| `config/qore-live-*.json` | Reviewed cadence and broker/risk defaults |

Prefer narrow modules with explicit inputs and outputs. Keep the runtime scripts usable without the React app so an agent can inspect, test, and operate the system from the command line.

## State and generated files

Versioned research lives in `data/qore/`. Optimizers intentionally update their own directory under `data/qore/research/strategy-agent-runs/`; review summaries, selected rows, and display curves together. Never hand-edit a generated performance curve to improve a result.

Mutable operational state belongs under `.local/qore/` and remains untracked. This includes live weather, selected-contract NOAA calendars, current inference, signal/risk handoffs, broker snapshots, order logs, supervisor locks/status, and live-weather comparison output. Tests should use temporary directories or `.local/`, never overwrite checked-in research artifacts.

Secrets belong only in the process environment or `.env.local`. Never print them, include them in a browser response, or commit them.

## Change workflow

1. Read `docs/strategy.md` and the affected script before changing a signal contract.
2. Preserve no-lookahead timing, component-specific split boundaries, costs, and the rule that holdout is reporting-only.
3. Rebuild the narrowest affected artifact. If a component changes, rebuild the all-year artifact afterward.
4. Run `npm run lint`, `npm run build`, and the relevant test command. Run `npm test` before a broad handoff.
5. Inspect `git diff --check`, generated-artifact diffs, and any `.local`/tracked-state boundary changes.

For trading code, also run `npm run test:live-inference`, `npm run test:live-trading`, and `npm run test:dashboard-service`. Never use paper or live order commands as automated tests.

## Safety rules

- Default to `dry-run`; paper routing requires an explicit flag; live requires all three live confirmations.
- `trade:prepare` may refresh runtime handoffs but must not submit orders or retrain checked-in research.
- The kill switch blocks new QORE submissions; it does not cancel existing orders or liquidate positions.
- Treat a dirty code/config worktree as a live-mode blocker until it is reviewed and committed.
- Preserve loopback binding and strict allowed origins for the dashboard service.
- Any proposed futures adapter requires a new reviewed contract for delivery month, expiry, rolling, margin, price limits, and delivery risk before implementation.
