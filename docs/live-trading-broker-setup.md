# Alpaca Paper and Live Setup

QORE's current broker adapter routes `UNG`, `VOO`, and `QQQM` through an Alpaca **Trading API** account. It deliberately refuses `NG`, `MNG`, and `QG` futures. Use a dedicated Alpaca account if you want Command's portfolio history to represent QORE alone; deposits, manual trades, and unrelated positions affect the account-level curve.

Order-capable broker commands are additionally restricted to Linux host `m1-server`. The main Mac may develop and backtest QORE and display sanitized M1 telemetry, but paper/live reconcile commands fail before broker access. Keep Alpaca credentials only in the M1 deployment's mode-`600` `.env.local`.

Start in dry-run, then paper. Live routing is a separate reviewed decision.

## Credentials

Copy the template without putting secrets in the example file:

```bash
test -f .env.local || cp .env.live.example .env.local
chmod 600 .env.local
```

Paper configuration:

```dotenv
QORE_BROKER_MODE=paper
APCA_API_KEY_ID=...
APCA_API_SECRET_KEY=...
QORE_PAPER_ORDER_ROUTING_ENABLED=1
```

Paper mode is hard-bound to `https://paper-api.alpaca.markets`; live mode is hard-bound to `https://api.alpaca.markets`; market data is hard-bound to `https://data.alpaca.markets`. QORE validates all configured endpoints before sending credentials and rejects redirects.

Live configuration requires every confirmation below:

```dotenv
QORE_BROKER_MODE=live
APCA_API_KEY_ID=...
APCA_API_SECRET_KEY=...
QORE_LIVE_TRADING_ENABLED=1
QORE_LIVE_ORDER_ROUTING_ENABLED=1
QORE_CONFIRM_LIVE_TRADING=I_UNDERSTAND_THIS_CAN_LOSE_MONEY
```

Exact all-year replication may require negative `UNG` exposure. Use a margin/short-capable account and opt in only after checking borrow behavior:

```dotenv
QORE_ALPACA_ALLOW_SHORTS=1
QORE_ALPACA_ALLOW_HARD_TO_BORROW=0
```

Alpaca does not support fractional short sales, so negative `UNG` targets use whole shares. QORE blocks a target when the account cannot short, Alpaca reports `UNG` unshortable, or it is hard-to-borrow without explicit permission.

Review the sizing and risk defaults in `.env.live.example` and `config/qore-live-broker-settings.json`. Keep a cash buffer. Open-order replacement is disabled by default; enabling it replaces a matching order only after Alpaca confirms that exact order is terminally canceled with zero filled quantity and the position remains unchanged.

### First-time risk-ledger bootstrap

Paper and live reconciliation require an existing risk ledger bound to the current Alpaca account and broker mode. QORE never silently creates or resets that trailing-drawdown baseline. For a first deployment or an intentional mode/account change, engage the kill switch and run the explicit no-order bootstrap:

```bash
npm run trade:prepare
npm run kill:engage -- --reason="risk-ledger bootstrap"
QORE_CONFIRM_RISK_LEDGER_BOOTSTRAP=I_UNDERSTAND_THIS_RESETS_THE_TRAILING_DRAWDOWN_BASELINE \
  node scripts/qore-alpaca-broker.mjs --mode=paper --preflight-only --bootstrap-risk-ledger --json
```

The command writes the current equity as the high-water mark, submits no orders, and remains blocked because the kill switch is engaged. Inspect `.local/qore/broker/risk-ledger.json`, then clear the kill switch through the reviewed command below. Repeat with `--mode=live` only when intentionally promoting that account to live operation. Do not persist the bootstrap confirmation in `.env.local`.

## Safe promotion sequence

Refresh current operational handoffs without calling the broker reconciler:

```bash
npm run trade:prepare
```

This refreshes or verifies current weather, rolling completed-session market history, market references, EIA storage state, promotion-eligible checked-in strategy status, validated GFS/GEFS all-year inference, signal intent, and risk state on their configured cadences. It does **not** retrain the checked-in strategy or submit an order. Paper/live inference is bound to the SHA-256 digest of the checked-in all-year `run-summary.json` and fails closed when its promotion gates do not pass or the artifact changes after inference.

Then run the no-order checks and dry-run plan:

```bash
npm run trade:readiness
npm run broker:status
npm run broker:dry-run
```

`trade:readiness` checks the runtime, required files, secret permissions, Git state, credentials and routing confirmations, signal freshness, validated inference, Alpaca account/clock/quotes, and current pre-trade gates without placing an order.

Only after inspecting the plan, submit to paper:

```bash
npm run broker:paper
```

Accumulate non-overlapping paper evidence before considering live. For a live promotion, stop the supervisor, update `.env.local`, rerun readiness, run one explicit live reconcile, inspect Alpaca and `.local/qore/broker/status.json`, then restart supervision:

```bash
npm run broker:live
```

## Continuous operation

One supervised pass:

```bash
npm run trade:once
```

Long-running supervisor:

```bash
npm run trade:run
```

The supervisor runs the live weather/inference handoff and then the broker reconciler. Failed upstream work stops that pass before broker work. It contains each job and its descendants in a process group, uses bounded TERM-to-KILL shutdown before releasing its single-process lock, and writes status under `.local/qore/live-trading-supervisor/`.

The standalone weather/inference service is available as `npm run trade:weather`; use `npm run trade:weather:once` for a one-cycle diagnostic and `npm run trade:infer` for direct selected-contract inference. Default inference first invokes the same collector exposed as `npm run trade:market-history`: Yahoo `NG=F`, `UNG`, `VOO`, and `QQQM` daily bars are fetched into `.local/qore/live-market-history/`, the VOO/QQQM basket is rebuilt there, and any target-date bar is excluded because it may still be in progress. The common completed VOO/QQQM dates are authoritative; both gas histories must cover the latest 42 of those sessions. A target weekday may receive a provisional row carrying the immediately preceding verified close, but any intervening weekday—including an unverified exchange holiday—fails closed. Set `QORE_LIVE_INFERENCE_SKIP_MARKET_REFRESH=1` only for a diagnostic that intentionally reuses a same-target-date local manifest; stale or mismatched local state remains invalid.

## Linux user service

Use a dedicated unprivileged Linux user and a reviewed, clean commit:

```bash
npm ci
test -f .env.local || cp .env.live.example .env.local
chmod 600 .env.local
npm run trade:prepare
npm run trade:readiness
npm run broker:dry-run
npm run broker:paper
```

Keep the host clock synchronized and enable the user manager across logout/reboot:

```bash
sudo timedatectl set-local-rtc 0
sudo loginctl enable-linger "$USER"
```

Install and inspect the user-level service only after paper checks pass:

```bash
npm run service:install:linux
systemctl --user start qore-live-trading.service
systemctl --user status qore-live-trading.service
journalctl --user -u qore-live-trading.service -f
```

## Emergency stop

Engage the operator kill switch:

```bash
npm run kill:engage -- --reason="operator emergency stop"
npm run kill:status
```

This blocks new QORE submissions. It does not cancel existing Alpaca orders or liquidate positions; use Alpaca directly if an immediate cancel or exit is required.

The kill-switch command, weather risk generation, broker, readiness preflight, and Command dashboard all resolve one canonical file. `QORE_LIVE_OPERATOR_STATE_FILE` has explicit precedence; when it is unset, the path is `operator-state.json` under `QORE_LIVE_WEATHER_STATE_DIR`. Weather cadence configuration cannot override this safety path.

Clear it only after review:

```bash
npm run kill:clear -- --confirm=RESUME_TRADING --reason="review complete"
```

## Fail-closed order gates

QORE blocks submission when any required state is stale, missing, malformed, or unsafe, including:

- validated GFS/GEFS inference is absent or not applied to the target;
- the checked-in all-year artifact is not promotion-eligible, or its digest no longer matches the inference handoff;
- signal intent is stale;
- the explicit operator-state file is missing, malformed, or has the kill switch engaged;
- the generated risk snapshot is missing, invalid, future-dated beyond tolerance, or older than the configured 15-minute default cap;
- the Alpaca venue is closed or its market clock cannot be verified;
- Alpaca account, market, weather, storage, price, or quote state is unavailable;
- the account is inactive, blocked, or suspended;
- the quote is crossed, stale, or wider than the configured spread cap;
- the immediately refreshed per-order quote or Alpaca clock timestamp is missing, stale, or materially future-dated;
- the account-bound risk ledger is absent, malformed, or belongs to another account or mode;
- daily loss, trailing drawdown, or conservative gross exposure exceeds its cap;
- a negative `UNG` target lacks short permission or borrow availability;
- mode-specific paper/live confirmation variables are missing.

The runtime state is intentionally local:

```text
.local/qore/live-weather/
.local/qore/live-market-history/
.local/qore/live-inference/all-year-target.json
.local/qore/broker/account-snapshot.json
.local/qore/broker/account-status.json
.local/qore/broker/status.json
.local/qore/broker/orders.jsonl
.local/qore/broker/risk-ledger.json
.local/qore/live-trading-supervisor/status.json
.local/qore/portfolio-reports/
```

Do not commit these files. `account-status.json` contains read-only account, portfolio-history, and bounded VOO/QQQM benchmark telemetry, while `status.json` remains the reconcile/preflight result. Broker status never initializes or rewrites the risk ledger. The Command UI reads a sanitized loopback telemetry API; its **Refresh Alpaca** action invokes broker status only and cannot reconcile or submit orders. Portfolio reports use the same read-only status path and keep their artifacts and delivery receipts local.

A broker-wide local lock prevents status and reconcile operations from interleaving their snapshots or order activity. QORE never reclaims an existing broker lock automatically. A signal received before any broker mutation removes an owned lock; a signal after a cancellation or submission starts deliberately preserves the lock because broker outcome may be ambiguous. An accepted cancellation also retains the lock until Alpaca proves the exact order is canceled with zero fill and the position is unchanged. In either stale-lock case, first verify and reconcile Alpaca state and confirm no broker process is running, then remove only `.local/qore/broker/operation.lock` manually. The supervisor similarly never reclaims its lock; verify no supervisor is running before manually removing a stale `.local/qore/live-trading-supervisor/supervisor.lock`.
