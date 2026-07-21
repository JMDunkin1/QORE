# Portfolio reports

QORE can build a private PNG portfolio brief from read-only Alpaca telemetry and send the same artifact to any combination of Discord, Telegram, and email. Daily is the default cadence; weekly remains available as a separate profile.

The report contains:

- current Alpaca equity;
- exact-session daily or weekly Alpaca portfolio-history change in dollars and percent;
- VOO and QQQM close-to-close performance;
- the configured target-weight `US-INDEX-BASKET` return;
- account performance versus that basket in percentage points and a clearly labeled hypothetical active-gap dollar amount on opening equity;
- UNG, VOO, QQQM, `OTHER`, and cash allocations in dollars and percent;
- a freshness-validated `ngas-all-year-beta` target plus sanitized, bounded operational insights.

The comparison is account-level by default, not pure strategy attribution. Deposits, withdrawals, manual trades, fees, and unrelated positions can affect Alpaca account equity. A dedicated QORE Alpaca account gives the comparison its cleanest meaning. Set `report.dedicatedQoreAccount` only when the Alpaca account is actually dedicated; the report then says “dedicated account,” not “strategy,” because it does not prove order lineage or neutralize every cash flow. Any non-QORE holding automatically downgrades the label back to account-level and is aggregated as `OTHER` without exposing its symbol.

## Data and safety contract

`npm run report:daily` and `npm run report:weekly` first invoke Alpaca `--status`, which is GET-only. Reporting never reconciles, cancels, or submits orders and never rewrites the risk ledger.

VOO and QQQM comparisons come from bounded, adjusted Alpaca `1Day` bars on the configured market-data feed. They never use Backtest's Yahoo research curve. Account performance comes from exact matching `1D` portfolio-history endpoints, while current equity is displayed separately with its as-of timestamp. Alpaca's New York market calendar is the canonical session grid, including early-close times. Session eligibility is evaluated at the earlier portfolio/benchmark capture timestamp, so a pre-close snapshot cannot become a completed close merely because it is rendered later. An in-progress session is excluded, and outbound delivery fails if fresh telemetry is not ready for the latest completed session. The report also fails if the account, VOO, and QQQM do not share every session in the displayed range. The weekly basket chains each session's configured target-weight component return and requires at least seven calendar days of coverage. `report.timeZone` controls display and scheduler timing only; it never changes market-session identity.

Generated previews live below `.local/qore/portfolio-reports/previews/<mode>/account-<binding>/`; immutable send artifacts live below `.local/qore/portfolio-reports/deliveries/<mode>/account-<binding>/`. The delivery ledger, scheduler state, status, and report lock remain at the report root. All are written with private permissions. The binding is one-way and prevents one paper/live account's artifact from overwriting another's. Canonical PNG and summary hashes are recorded before delivery, and provider adapters send the already-hashed PNG bytes rather than rereading the file. Configuration cannot redirect these files outside that operational-state root or through a symbolic link. They must remain untracked.

## Preview locally

With Alpaca credentials in `.env.local`:

```bash
npm run report:daily
npm run report:weekly
```

Both commands refresh read-only Alpaca status and write a preview without sending it. Use the script directly without `--refresh` only when intentionally inspecting an existing fresh `account-status.json`:

```bash
node scripts/qore-portfolio-report.mjs --cadence=daily
```

## Free delivery adapters

All adapters are disabled in `config/qore-portfolio-reports.json` until explicitly enabled. Multiple destinations, including multiple destinations of the same type, can be enabled together; each requires a unique `id`.

### Telegram Bot API

Telegram says its bot platform is free for users and developers. Create a bot with `@BotFather`, start a private conversation with it or add it to a private group, and obtain the destination chat ID. `sendPhoto` supports PNG files up to 10 MB; QORE applies a shared 9 MiB cap. See the [Telegram bot introduction](https://core.telegram.org/bots) and [`sendPhoto` reference](https://core.telegram.org/bots/api#sendphoto).

```dotenv
QORE_REPORT_TELEGRAM_BOT_TOKEN=...
QORE_REPORT_TELEGRAM_CHAT_ID=...
```

Set `telegram-primary.enabled` to `true` in the report config.

### Discord incoming webhook

Create an incoming webhook in a private Discord channel and keep its complete URL in `.env.local`. Incoming webhooks accept multipart file uploads without a persistent bot process. Discord's ordinary default upload limit is currently 10 MiB. See [Discord webhooks](https://docs.discord.com/developers/resources/webhook) and [file uploads](https://docs.discord.com/developers/reference#uploading-files).

```dotenv
QORE_REPORT_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Set `discord-primary.enabled` to `true` in the report config.

### Resend email

Resend's current free tier is 3,000 emails per month and 100 per day, which is ample for a personal report. Sending beyond the account owner generally requires a verified domain. See [Resend pricing limits](https://resend.com/docs/knowledge-base/what-is-resend-pricing), [account quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), and [attachments](https://resend.com/docs/dashboard/emails/attachments). Provider limits can change; verify them before relying on unattended delivery.

```dotenv
QORE_REPORT_RESEND_API_KEY=...
QORE_REPORT_EMAIL_FROM=QORE <reports@your-domain.example>
QORE_REPORT_EMAIL_TO=you@example.com
```

The current adapter intentionally accepts one recipient per destination. Add another enabled Resend destination for another private recipient. Set `email-primary.enabled` to `true` in the report config.

## Send and schedule

External delivery needs both an enabled destination and the explicit send gate:

```dotenv
QORE_REPORT_SEND_ENABLED=1
QORE_BROKER_MODE=paper
```

Set `QORE_BROKER_MODE` explicitly to `dry-run`, `paper`, or `live` for every outbound run. QORE verifies that it matches the fresh Alpaca status snapshot and requires the one-way binding derived from the full Alpaca account ID.

Send the current daily report once:

```bash
npm run report:send
```

Send a weekly report explicitly:

```bash
npm run report:weekly -- --send
```

Successful deliveries are recorded by broker mode, a one-way internal account binding, cadence, market-period end, and destination. Before any provider request, QORE records an uncertain write-ahead attempt; a crash or ambiguous response therefore cannot trigger an automatic duplicate. Clear failures may retry and honor provider `Retry-After` windows, while uncertain outcomes are held for operator review.

Use `--force` only with a one-shot `--send` command after a canonical delivery attempt exists. When canonical destinations are unfinished or uncertain, the reviewed force run reuses the immutable original artifact, targets only those unresolved destinations, and reconciles successful outcomes into canonical state. A clear forced failure never erases a prior ambiguous outcome. To resolve an older retained period after newer sessions exist, select it explicitly:

```bash
node scripts/qore-portfolio-report.mjs --cadence=daily --send --force --period-end=2026-07-20
```

The selected period must still be present in the bounded Alpaca history and have at least one unresolved canonical destination; historical all-complete duplicates are rejected so current account state can never be rendered under an old period label. Without `--period-end`, when every destination for the current period is already complete, `--force` is an intentional duplicate to all enabled destinations. A first-ever force is rejected, as are forced scheduled or looped runs. If a canonical artifact is missing or either hash fails, QORE will not manufacture a replacement or resend; preserve the ledger and period directory, inspect the provider state, and manually quarantine that period before any further operator action.

For continuous scheduling:

```bash
npm run report:run
```

The runner is independent of the trading supervisor. It requires an explicit `QORE_BROKER_MODE`, uses the schedules in `config/qore-portfolio-reports.json`, interprets them in `report.timeZone`, and records each completed schedule window by account so polling cannot resend the same report. A schedule sends only the latest completed Alpaca market session; lagging bars are deferred instead of completing the wrong day. Configuration rejects a delivery window too short for the polling interval. The loop anchors each poll to the prior check time and scans a bounded active/just-crossed window after a long refresh/delivery cycle, retaining only the newest missed run per schedule; a multi-day sleep cannot fan out stale reports. The checked-in default checks every 15 minutes and enables a weekday daily report at 6:30 p.m. New York time with a three-hour delivery window. The Sunday weekly schedule is present but disabled.

Run the scheduler under a dedicated user service manager on the same machine that owns `.local/qore/` and the Alpaca credentials. Use a restrictive umask and restart policy; do not add report delivery to the trading supervisor, because a messaging outage must never block trading supervision.

## Privacy

Every enabled provider receives the PNG's portfolio values and holdings. Use private chats/channels and a recipient you control. QORE sends only its strict report model: no credentials, account identifiers, order IDs, raw Alpaca payloads, logs, raw risk reasons, or non-QORE symbols. Missing, stale, or invalid risk/target telemetry is labeled explicitly. Tokens, webhook URLs, chat IDs, sender addresses, and recipients belong only in `.env.local`; the checked-in config stores environment-variable names, not their values.
