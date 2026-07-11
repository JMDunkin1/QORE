# QORE: Quantitative Operations Runtime Engine

QORE stands for Quantitative Operations Runtime Engine. It is a local React dashboard for researching natural-gas trading signals, including weather-driven ideas and market-volatility behavior.

## Install On Windows

Paste this into PowerShell:

```powershell
$ErrorActionPreference='Stop'; foreach ($cmd in 'git','node','npm') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Missing $cmd. Install Git and Node.js, then run this again."; exit 1 } }; $dir = if ($env:QORE_DIR) { $env:QORE_DIR } else { Join-Path $env:USERPROFILE 'QORE' }; $repo = if ($env:QORE_REPO) { $env:QORE_REPO } else { 'https://github.com/CaseLine-tech/QORE.git' }; if (Test-Path (Join-Path $dir '.git')) { git -C $dir pull --ff-only } else { git clone $repo $dir }; Set-Location $dir; npm install; node scripts/install-command.mjs; node bin/qore
```

## Install On Mac Or Linux

Paste this into Terminal:

```bash
/bin/bash -lc 'set -e; for cmd in git node npm; do command -v "$cmd" >/dev/null || { echo "Missing $cmd. Install Git and Node.js, then run this again."; exit 1; }; done; dir="${QORE_DIR:-$HOME/QORE}"; repo="${QORE_REPO:-https://github.com/CaseLine-tech/QORE.git}"; if [ -d "$dir/.git" ]; then git -C "$dir" pull --ff-only; else git clone "$repo" "$dir"; fi; cd "$dir"; npm install; node scripts/install-command.mjs; ./bin/qore'
```

After install, launch it with:

```bash
qore
```

This private repo requires GitHub access. If clone fails, make sure the user is invited to `CaseLine-tech/QORE` and is signed into GitHub for command-line Git.

## Run

```bash
npm install
qore
```

`npm run dev` starts Vite and the token-protected localhost GitHub control service. The service fast-forwards from `origin/main` on launch only when the working tree is clean, runs `npm install` after package-file updates, checks GitHub every five minutes, and leaves live updates behind the dashboard's Update button.

Optional login service:

```bash
npm run install:launch-agent
```

If `origin` is missing, add it before expecting updates:

```bash
git remote add origin <git-url>
```

Build check:

```bash
npm run build
npm run test:github-service
```

Free research data cache:

```bash
npm run collect:free-data
```

This writes no-key market and weather research data under `data/qore/` so it can be shared with the project. Check `data/qore/runs/free-data-manifest.json` to see which sources succeeded or failed. Set `QORE_DATA_ROOT=.local/qore` when you want a private scratch cache.
By default it refreshes the full shared backtest window from `2021-01-01` through the latest complete UTC day; set `QORE_TEST_START` / `QORE_TEST_END` only when you need a fixed historical slice.

Market cache note: `UNG` is ETF history, `NG=F` is a Yahoo continuous front-month proxy, and `VOO`/`QQQM` are live-orderable broad US equity ETF proxies used to derive the target-weight `US-INDEX-BASKET`. The synthetic basket is research provenance only; future live adapters must route the ETF component legs. Do not label results as futures-grade Henry Hub NG performance until per-contract prices, expiry dates, and roll logic exist.

NOAA forecast signal calendars:

```bash
npm run collect:gfs-calendar
npm run collect:gefs-calendar
npm run collect:graphcast-calendar
```

These build resume-friendly daily GFS, GEFS ensemble-mean, and GraphCastGFS forecast calendars under `data/qore/` for arctic-blast lead windows. The default end date rolls to the latest complete UTC day; set `QORE_GFS_CALENDAR_END` or `QORE_TEST_END` for a fixed snapshot. The GraphCastGFS script starts on the first raw NOAA 00z archive date verified for this collector, `2024-04-26`. Failed items make the command exit nonzero unless `QORE_GFS_ALLOW_PARTIAL=1` is set.

VPS live weather loop:

```bash
npm run live:weather
```

This is the long-running weather reader intended for an always-on VPS. It polls current Open-Meteo model forecasts every five minutes by default, scores the Eastern CONUS demand basket, writes a live handoff under `.local/qore/live-weather/`, and refreshes the `ngas-live-weather-refresh` comparison artifact on a slower cadence. Use `npm run live:weather:once` for a one-cycle health check. Tune with `QORE_LIVE_WEATHER_INTERVAL_MS`, `QORE_LIVE_WEATHER_MODELS`, `QORE_LIVE_WEATHER_FORECAST_DAYS`, and `QORE_LIVE_WEATHER_STATE_DIR`.

Polling profiles live in `config/qore-live-weather-settings.json`:

```bash
npm run live:weather:rapid
npm run live:weather:fast
npm run live:weather -- --profile=rapid-test
npm run live:weather -- --profile=fast
npm run live:weather -- --profile=balanced
npm run live:weather -- --profile=conservative
```

`rapid-test` requests a one-second current-weather cadence with one batched GFS pull across all tracked locations. The two-model profiles keep ECMWF IFS plus GFS for stronger guardrail context. The status file reports `cycle.durationMs`, `cycle.sleepMs`, `cycle.cycleOverrunMs`, and `cycle.cadenceMet` so you can see whether the VPS/API round trip can actually keep up before leaving it there. Env vars still override the profile, so `QORE_LIVE_WEATHER_INTERVAL_MS=1000 npm run live:weather` remains valid for quick experiments.

Set `QORE_LIVE_WEATHER_RUN_GFS_CALENDAR=1` when the VPS should also keep near-window NOAA GFS/GEFS archive calendars warm. That heavier path polls run hours `00,06,12,18` by default with resume and partial-output mode enabled. The live loop writes broker handoff files under `.local/qore/live-weather/`; the Alpaca broker reconciler consumes those files and keeps its own account snapshot plus order logs under `.local/qore/broker/`.

The other live lanes are market reference prices with spread-availability metadata, broker account and position state, risk/kill-switch state, current signal-intent reconciliation, and EIA storage polling around the weekly release window. Their intervals and slider bounds are recorded in `liveCadences` inside `config/qore-live-weather-settings.json`, and every lane writes its own status artifact under `.local/qore/live-weather/`.

Alpaca broker bridge:

```bash
npm run broker:alpaca:status
npm run broker:alpaca:dry-run
npm run broker:alpaca:paper
npm run broker:alpaca:live
npm run live:readiness
npm run live:trade
```

The recommended account for the current QORE live path is an Alpaca Trading API brokerage account. QORE routes only `UNG`, `VOO`, and `QQQM` through this adapter; `NG`, `MNG`, and `QG` futures are deliberately refused until a futures-grade router exists. Executable midpoint/spread checks use authenticated Alpaca latest quotes, while account status, Alpaca's authoritative market clock, daily loss, trailing drawdown, gross exposure, stale inputs, and the operator kill switch all fail closed before submission. Real-money orders require Alpaca keys in a mode-`600` `.env.local` plus `QORE_LIVE_TRADING_ENABLED=1`, `QORE_LIVE_ORDER_ROUTING_ENABLED=1`, and `QORE_CONFIRM_LIVE_TRADING=I_UNDERSTAND_THIS_CAN_LOSE_MONEY`. Refresh once with `npm run live:weather:once`, then run `npm run live:readiness`; readiness performs a complete no-order preflight before paper/live routing. The Linux user-service installer is `npm run install:linux-service`; emergency-stop commands are `npm run live:kill-switch:engage` and `npm run live:kill-switch:clear -- --confirm=RESUME_TRADING`. See `docs/live-trading-broker-setup.md`.

## What It Does

- Opens on the tracked `data/qore` research catalog without bundled starter rows.
- Shows source-backed market, weather, forecast-calendar, signal-score, and signal-return inventory.
- Loads active research strategies from vetted artifacts; current-paper scans stay visible, with stale status unless they have same-day `generatedAt` metadata and non-expired current rows.
- Keeps NGAS Summer Alpha and NGAS Winter Alpha as deprecated source ledgers for the all-year composite, not active dashboard baselines.
- Keeps older weather, volatility, and strict-theory lanes archived as research evidence instead of active baselines.
- Joins explicitly imported weather and market rows by `date` for session-only lab checks.
- Tracks imported weather forecast quality with HDD/CDD MAE, RMSE, R2, directional accuracy, cold-surprise recall, and calibration.
- Provides CSV import lanes for intentionally loading local or external backtest rows.

## CSV Contracts

Weather:

```csv
date,stationBlend,actualHdd,forecastHdd,actualCdd,forecastCdd,tempAnomalyF,windMph,precipIn,confidence
```

Natural gas:

```csv
date,open,high,low,close,volume,contract,storageBcf
```

For ETF or continuous-proxy research, `contract` may be `UNG` or `NG=F`. For futures-grade tests, `contract` must identify the actual NG delivery month and be paired with an explicit expiry/roll calendar.

Forecast signal returns:

```csv
issueDate,targetDate,leadDays,windowId,modelId,symbol,priorTradeDate,entryTradeDate,targetTradeDate,priorClose,entryClose,targetClose,returnPctPriorCloseToTarget,returnPctEntryCloseToTarget,qualifies
```

For archived Arctic Blast strategy testing, use the `close-after-issue-v1` timing convention from `src/backtesting/timing.ts`: treat the forecast score as available only after the `issueDate` close, enter at the first market close strictly after `issueDate`, and exit at the first market close on or after `targetDate` and strictly after entry. Use `returnPctEntryCloseToTarget`; `returnPctPriorCloseToTarget` is diagnostic only because it starts before the signal is known.

## Active Research Strategies

The active NGAS strategy is `ngas-all-year-beta`. It is its own checked-in artifact, but it does not add a new threshold, entry rule, or optimization layer: each date uses the exact material Summer Alpha row, else the exact material Winter Alpha row, else the shared no-cost index fallback row.

```bash
npm run optimize:ngas-all-year-beta
```

The selected beta artifact made `877.16%` full-sample versus `119.17%` for the VOO/QQQM index basket, with `-15.86%` max drawdown. Train return was `186.29%`, validation was `70.74%`, and holdout was `99.9%`; holdout edge versus the index basket was `69.74%`. Its direct all-year centered circular block bootstrap p-value is `0.00005`, replacing the old Fisher-combined component p-value. It remains a research baseline and still needs non-overlapping Alpaca paper validation before real capital should be enabled, even though the separate broker bridge now exists.

The live-weather-refresh replay compares that checked-in all-year ledger against a no-close-in-weather-refresh counterfactual:

```bash
npm run test:ngas-live-weather-refresh
npm run optimize:ngas-live-weather-head-to-head
```

On the current artifact, the close-in weather-refresh version made `877.16%` full-sample versus `844.97%` without refresh, a `+32.19` point full-sample advantage. Hidden holdout was mixed: `99.9%` with refresh versus `102.57%` without refresh, a `-2.67` point holdout difference. The head-to-head optimizer tunes the live close-in Winter Alpha weather-resolution scaling on train/validation only, then reports the selected live variant against the non-live counterfactual on holdout. Its selected optimized-live variant made `917.47%` full-sample, but only `97.94%` holdout versus `102.57%` for non-live; `0` of `5,832` tuned live variants beat non-live on holdout. Verdict: keep the live reader for monitoring and paper evidence, but prefer the non-live close-in overlay for promotion until new out-of-sample paper/live rows prove otherwise.

The prediction-market checked-in artifacts include active `prediction-time-ladder-alpha` and `prediction-cross-market-rv-alpha` lanes plus a failed diagnostic `prediction-time-decay-alpha` research artifact. The cross-market and time-decay models remain separate collectors; time-decay keeps its raw `historical-observations.csv` quote/proxy dump local-only, while only its summary, candidate, current-market, and selected-trade artifacts are checked in. Stale current rows are reported separately from historical support rows.

`prediction-time-ladder-alpha` scans Kalshi and Polymarket date-threshold markets for nested deadline packages where buying NO on the earlier deadline plus YES on the later deadline shows positive quote edge after fees.

```bash
npm run collect:prediction-time-ladder
```

The checked-in artifact scanned `63,278` Kalshi markets and `2,100` Polymarket markets, parsed `10,922` date-threshold markets, found `3,473` same-venue ladder pairs, and selected `39` historical paper rows. Candidate selection ranks gross-edge, pair-spacing, and maximum-lockup gates on train/validation only across `181` unique observed days, then reports the final three calendar months as hidden holdout starting `2026-03-27`. The selected `edge-3c-spacing-1h-maxhold-365d` lane made `3.54%` modeled total return, with `0.48%` train, `0.11%` validation, and `2.94%` hidden holdout. It reports no inferential p-value because selected rows are mechanically positive after quote-edge gating. It is a research and paper-candidate artifact, not live routing, and every package still needs contract-language, liquidity, fee, and settlement review.

`prediction-cross-market-rv-alpha` is the separate cross-venue relative-value model. It compares economically similar Kalshi and Polymarket contracts using fixed comparable-market parsers, currently exact election-winner and outright-winner propositions, then paper-trades the cheap YES side against the rich NO side.

```bash
npm run collect:prediction-cross-market-rv
```

The checked-in cross-market artifact scanned `59,740` Kalshi markets and `2,100` Polymarket markets, found `153` comparable pairs, wrote `303,783` overlapping hourly quote observations from `2025-07-02` through `2026-06-28`, and selected `278` marked quote-exit rows. Candidate selection ranks gross-edge, pair-spacing, and hold-time gates on train/validation only after requiring at least `75` train rows, `20` validation rows, `1%` validation return, and no more than `50%` max concurrent canary exposure; the final `90` calendar days are hidden holdout starting `2026-03-31`. The selected `cross-edge-8c-spacing-48h-hold-336h` lane made `32.20%` modeled total return, with `23.93%` train, `1.61%` validation, and `6.66%` hidden holdout while staying at `46%` max concurrent canary exposure. Its selection-adjusted sign-flip/block-bootstrap p-value is `0.001`, but this is still marked quote-overlap evidence rather than settlement-confirmed fills. History collection chunks Kalshi candle requests and fails closed on per-pair fetch errors; `npm run collect:prediction-cross-market-rv -- --allow-partial-history` writes a partial artifact only when explicitly requested and records failed pair IDs in `run-summary.json`. Every pair still needs rule-text, depth, fee, restriction, deadline-metadata, and venue-basis review before paper or live execution.

`prediction-time-decay-alpha` tests the short-horizon idea that YES odds in time-bound markets should usually decay as time passes unless new information offsets the clock. It models a buy-NO/fade-YES paper entry and marks the exit after a selected short hold.

```bash
npm run collect:prediction-time-decay
```

The checked-in time-decay artifact scanned `59,550` Kalshi markets and `2,100` Polymarket markets, parsed `8,023` time-bound markets, wrote `804,478` hourly Kalshi quote / Polymarket price-history observations from `2025-06-28` through `2026-06-28`, and selected `0` marked quote-exit rows because no train/validation candidate passed. Candidate selection ranks venue, YES-price band, days-to-deadline band, recent-upmove filter, spacing, and hold-time variants on train/validation only; the final two calendar months are hidden holdout starting `2026-04-28`. There were `0` eligible candidates: the best diagnostic fallback, `decay-polymarket-yes-25-95c-days-2-730-rise-any-spacing-24h-hold-24h`, made `+0.64%` train, `-7.26%` validation, and `-10.55%` hidden holdout, with a selection-adjusted sign-flip/block-bootstrap p-value of `1.0000`. Treat this as a failed research lane, not a promotable strategy; every current candidate still needs rule-text, depth, fee, shorting/buy-NO mechanics, and event-news review before paper or live execution.

## Deprecated Component Lanes

`ngas-summer-alpha` and `ngas-winter-alpha` remain checked in as source ledgers for the all-year composite. They are still loaded by `src/strategies/arcticBlast.ts` so the all-year artifact can verify exact row selection and drift, but they are no longer exported as active dashboard strategies.

Use these optimizers only when intentionally refreshing the component source ledgers:

```bash
npm run optimize:ngas-summer-alpha
npm run optimize:ngas-winter-alpha
```

Summer Alpha keeps idle capital in `US-INDEX-BASKET`, then uses fresh multi-model day-7 summer heat forecasts to add NG futures exposure while skipping clustered heat-follow longs and fading same-direction gas rallies. Winter Alpha owns the frozen weather-follow, weather-reversion, and volatility-confirmation ledgers that supply the winter rows. Their standalone metrics remain research context, but the active surface is the all-year composite.

## Broker-Gated Execution Architecture

QORE has strategy and execution architecture plus an Alpaca ETF broker bridge. The active research strategy registry lives in `src/strategies/arcticBlast.ts`, risk and order-intent code lives in `src/execution/`, and the dashboard execution view exposes both the dry-run paper gateway and the live-gated Alpaca adapter.

The current boundary is deliberate:

- Strategy code can create auditable signal intents.
- Risk code can approve or reject dry-run order intents.
- The paper gateway can produce simulated fills.
- The Alpaca gateway can reconcile target weights against broker positions and route ETF delta orders only after credential, freshness, kill-switch, market, account, and live-confirmation gates pass.
- No futures broker client or futures order route is instantiated.

The stricter `ngas-weather-guardrail-risk-v1` policy is the intended pre-trade guard for autonomous experimental NGAS weather-model paper/live-equivalent testing. It keeps live routing disabled, requires fresh weather, storage, market, account, and operator-state context, preserves the strategy's full notional request and index/gas/cash weights, and blocks only on emergency daily-loss, trailing-drawdown, loss-streak, spread, stale-data, missing-price, venue-closed, and kill-switch conditions.

## Integration Seams

- `src/integrations/connectors.ts`: NOAA CDO, EIA API, CME/NYMEX metadata, dry-run paper execution, local project data, model registry.
- `src/backtesting/engine.ts`: register real strategy signal functions here; none are bundled by default.
- `src/backtesting/timing.ts`: no-lookahead timing checks for forecast signal-return rows.
- `src/ml/evaluation.ts`: weather model scoring for imported rows.
- `src/utils/importers.ts`: CSV parsers for dashboard ingestion.

Live futures trading is deliberately not connected. The execution view is now an ETF-only readiness and routing layer for Alpaca paper/live accounts plus future broker adapters and risk controls.
