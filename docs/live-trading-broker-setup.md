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
```

Paper mode:

```bash
QORE_BROKER_MODE=paper
APCA_API_KEY_ID=...
APCA_API_SECRET_KEY=...
QORE_PAPER_ORDER_ROUTING_ENABLED=1
```

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

Alpaca does not support fractional short-sale orders. QORE therefore forces whole-share quantities for negative `UNG` targets, while long ETF orders can still use fractional quantities.

By default, QORE skips symbols that already have open Alpaca orders. Set `QORE_ALPACA_REPLACE_OPEN_ORDERS=1` only when the reconciler should cancel matching open orders, verify no matching open order remains, and then submit the replacement delta. Cancel, verify, or submit failures make the reconcile command exit nonzero.

## Commands

Refresh live handoff files once:

```bash
npm run live:weather:once
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

The supervisor refreshes research data, regenerates Summer/Winter/All-Year artifacts, refreshes live weather/market/risk handoff files, and then runs the Alpaca reconciler on cadence.

## What QORE Checks Before Orders

QORE blocks live orders when:

- The signal intent is stale.
- The kill switch is engaged.
- The venue is closed and outside-market queuing is not enabled.
- Account, market, weather, or storage risk context is missing.
- A required reference price is missing.
- The target would short `UNG` and shorting is not enabled.
- Alpaca reports `UNG` is not shortable or is hard-to-borrow without explicit permission.
- The live confirmation environment variables are absent.

The broker state and order logs are written under `.local/qore/`:

- `.local/qore/broker/account-snapshot.json`
- `.local/qore/broker/status.json`
- `.local/qore/broker/orders.jsonl`
- `.local/qore/live-trading-supervisor/status.json`

## External References

- Alpaca Trading API setup: https://alpaca.markets/learn/connect-to-alpaca-api
- Alpaca stock and ETF API: https://alpaca.markets/stocks
- Alpaca paper trading: https://docs.alpaca.markets/us/docs/paper-trading
- Alpaca orders: https://docs.alpaca.markets/us/docs/working-with-orders
- Alpaca margin and short selling: https://docs.alpaca.markets/us/docs/margin-and-short-selling
- IBKR TWS API: https://www.interactivebrokers.com/campus/ibkr-api-page/twsapi-doc/
