# QORE Live Trading Broker Setup

## Recommendation

Create an Alpaca Trading API brokerage account for QORE's current live path.

Use Alpaca because QORE currently routes only ETF legs:

- `UNG` for the natural-gas proxy overlay.
- `VOO` and `QQQM` for the `US-INDEX-BASKET` fallback basket.
- No `NG`, `MNG`, or `QG` futures orders are routed by this adapter.

If you want exact all-year replication, the account needs margin/short capability because the checked-in all-year ledger includes negative `UNG` exposure. If you do not enable shorting, QORE will block negative `UNG` targets rather than silently changing the strategy.

Interactive Brokers is the better future account only if QORE graduates to true futures routing. That would need separate contract-month selection, expiry, roll, margin, delivery-risk, and futures order handling before any money route is acceptable.

## Account To Create

Open an Alpaca Trading API account, not a Broker API account.

For a US user, choose an individual taxable brokerage account unless you have a specific tax/account-structure reason to do otherwise. Fund it only after the dry-run and paper checks show the expected target weights.

## Credential Handoff

Put real values in `.env.local`; do not edit the example file with secrets. If `.env.local` already exists, merge these values into it instead of overwriting it.

```bash
test -f .env.local || cp .env.live.example .env.local
chmod 600 .env.local
```

Paper mode:

```bash
QORE_BROKER_MODE=paper
APCA_API_KEY_ID=...
APCA_API_SECRET_KEY=...
QORE_PAPER_ORDER_ROUTING_ENABLED=1
```

Paper mode is hard-bound to `https://paper-api.alpaca.markets`. QORE rejects order submission if `QORE_ALPACA_BASE_URL` or `APCA_API_BASE_URL` points anywhere else, so an environment override cannot silently route a paper process to the live venue.

Live mode:

```bash
QORE_BROKER_MODE=live
APCA_API_KEY_ID=...
APCA_API_SECRET_KEY=...
QORE_LIVE_TRADING_ENABLED=1
QORE_LIVE_ORDER_ROUTING_ENABLED=1
QORE_CONFIRM_LIVE_TRADING=I_UNDERSTAND_THIS_CAN_LOSE_MONEY
```

Exact negative `UNG` legs:

```bash
QORE_ALPACA_ALLOW_SHORTS=1
```

Leave `QORE_ALPACA_ALLOW_HARD_TO_BORROW=0` unless you intentionally want QORE to allow hard-to-borrow locate workflows. By default, hard-to-borrow `UNG` blocks.

Keep a nonzero cash buffer for market-order slippage. The checked-in default is `QORE_LIVE_MIN_CASH_BUFFER_PCT=2`, so an ordinary target-weight reconcile does not intentionally consume the account's final dollars or create a small margin debit.

QORE also applies a `QORE_LIVE_REBALANCE_DEADBAND_PCT=0.25` equity-relative deadband in addition to the absolute minimum order size. This prevents the minute-level reconciler from submitting tiny orders solely because prices moved a few basis points after the prior fill.

Alpaca does not support fractional short-sale orders. QORE therefore forces whole-share quantities for negative `UNG` targets, while long ETF orders can still use fractional quantities.

By default, QORE skips symbols that already have open Alpaca orders. Set `QORE_ALPACA_REPLACE_OPEN_ORDERS=1` only when the reconciler should cancel matching open orders, verify no matching open order remains, and then submit the replacement delta. Cancel, verify, or submit failures make the reconcile command exit nonzero.

## Commands

Refresh the live handoff files once:

```bash
npm run live:prepare
```

`live:prepare` refreshes market, EIA, and NASA inputs; rebuilds Summer, Winter, and All-Year artifacts; collects complete NOAA GFS/GEFS 00z inputs for the selected live contract; and writes current strategy, weather, and risk handoffs without invoking the broker. Historical Open-Meteo backfills are deliberately excluded from the unattended path because they are research inputs and can exhaust the free minutely request quota.

Then run the fail-closed readiness audit. It checks the Node version, runtime files, secret-file permissions, Git state, routing confirmations, Alpaca account status, Alpaca's authoritative market clock, current signal/risk gates, and Alpaca bid/ask access without placing an order:

```bash
npm run live:readiness
```

Check broker connectivity and write the account snapshot:

```bash
npm run broker:alpaca:status
```

Dry-run the rebalance plan:

```bash
npm run broker:alpaca:dry-run
```

Submit to Alpaca paper:

```bash
npm run broker:alpaca:paper
```

Submit to Alpaca live:

```bash
npm run broker:alpaca:live
```

Run the unattended supervisor:

```bash
npm run live:trade
```

The supervisor refreshes research data, regenerates Summer/Winter/All-Year artifacts, refreshes live weather/market/risk handoff files, and then runs the Alpaca reconciler on cadence. It launches every job with the same absolute Node binary as the service, so operation after logout or reboot does not depend on an interactive-shell `npm` path.

## Live Strategy Inference

The broker target is inferred from persistent NOAA GFS and GEFS mean 00z forecast history. The live engine reuses the frozen Summer and Winter signal thresholds, source-family requirements, confidence scoring, follow/fade timing, Summer heat freshness and storage sizing, and Winter storage/HDD/volatility blend rules. The All-Year selector then uses the material Summer row, else the material Winter row, else the index fallback. Open-Meteo remains a separate risk-context feed and cannot set the target.

The engine requires a complete common GFS/GEFS issue set no more than two calendar days old and writes `.local/qore/live-inference/all-year-target.json` atomically. `npm run live:readiness` reports this as `Current forecast strategy inference`; the Alpaca broker independently requires `liveForecastAppliedToTarget=true` on every live reconcile, so a failed or stale inference cannot be bypassed by skipping readiness. `npm run test:live-inference` checks scoring parity against the frozen historical Summer and Winter forecast-follow ledgers.

## Linux VPS Service

Use a dedicated, unprivileged Linux user. From a clean clone of the reviewed commit:

```bash
npm ci
test -f .env.local || cp .env.live.example .env.local
chmod 600 .env.local
```

Keep `QORE_BROKER_MODE=paper` through the first deployment. Then run:

```bash
npm run live:prepare
npm run live:readiness
npm run broker:alpaca:status
npm run broker:alpaca:dry-run
npm run broker:alpaca:paper
```

On Linux, keep the hardware clock in UTC and enable the user manager across logout/reboot:

```bash
sudo timedatectl set-local-rtc 0
sudo loginctl enable-linger "$USER"
```

Install the user-level systemd service only after those checks pass:

```bash
npm run install:linux-service
systemctl --user start qore-live-trading.service
systemctl --user status qore-live-trading.service
journalctl --user -u qore-live-trading.service -f
```

The service restarts after failures, uses a single-process lock, terminates its active child on shutdown, retries failed upstream jobs before allowing downstream broker work, and writes runtime state under `.local/qore/` with a restrictive umask. Its process timezone is pinned to UTC and every start requires the static local readiness checks—including NTP synchronization—to pass. Data-refresh and signal-freshness checks are deferred until the supervisor refreshes that state, so a stale-state reboot can recover without operator intervention.

Before changing from paper to live, stop the service, change the four live-mode values in `.env.local`, rerun `npm run live:readiness`, run one explicit `npm run broker:alpaca:live`, inspect the resulting broker status and Alpaca activity, and only then restart the service.

## Emergency Stop

Engage the QORE kill switch without stopping the VPS service:

```bash
npm run live:kill-switch:engage -- --reason="operator emergency stop"
npm run live:kill-switch:status
```

The broker reads this operator file directly on every reconcile. It blocks new QORE submissions; it does not cancel already-open Alpaca orders or liquidate positions. Handle those in Alpaca if an immediate cancel/exit is required.

Clearing the stop is deliberately explicit:

```bash
npm run live:kill-switch:clear -- --confirm=RESUME_TRADING --reason="review complete"
```

## What QORE Checks Before Orders

QORE blocks live orders when:

- The signal intent is stale.
- The validated GFS/GEFS forecast set is missing or is not applied to the target.
- The kill switch is engaged.
- The venue is closed and outside-market queuing is not enabled.
- Account, market, weather, or storage risk context is missing.
- A required reference price is missing.
- Alpaca's latest bid/ask is missing, crossed, stale, or wider than the spread cap.
- The Alpaca account is not `ACTIVE`, or is blocked or user-suspended.
- Daily loss, trailing drawdown, or target gross exposure breaches the configured cap.
- The target would short `UNG` and shorting is not enabled.
- Alpaca reports `UNG` is not shortable or is hard-to-borrow without explicit permission.
- The live confirmation environment variables are absent.

The broker state and order logs are written under `.local/qore/`:

- `.local/qore/broker/account-snapshot.json`
- `.local/qore/broker/status.json`
- `.local/qore/broker/orders.jsonl`
- `.local/qore/broker/risk-ledger.json`
- `.local/qore/live-trading-supervisor/status.json`
- `.local/qore/live-inference/all-year-target.json`

## External References

- Alpaca Trading API setup: https://alpaca.markets/learn/connect-to-alpaca-api
- Alpaca stock and ETF API: https://alpaca.markets/stocks
- Alpaca paper trading: https://docs.alpaca.markets/us/docs/paper-trading
- Alpaca orders: https://docs.alpaca.markets/us/docs/working-with-orders
- Alpaca margin and short selling: https://docs.alpaca.markets/us/docs/margin-and-short-selling
- IBKR TWS API: https://www.interactivebrokers.com/campus/ibkr-api-page/twsapi-doc/
