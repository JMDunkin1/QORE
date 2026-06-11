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

Market cache note: `UNG` is ETF history, `NG=F` is a Yahoo continuous front-month proxy, and `SPY`/`DIA`/`QQQ`/`IWM` are broad US equity ETF proxies used to derive `US-INDEX-BASKET`. Do not label results as futures-grade Henry Hub NG performance until `data/qore/market/futures/henry-hub-ng-readiness.md` is satisfied with per-contract prices, expiry dates, and roll logic.

NOAA forecast signal calendars:

```bash
npm run collect:gfs-calendar
npm run collect:gefs-calendar
npm run collect:graphcast-calendar
```

These build resume-friendly daily GFS, GEFS ensemble-mean, and GraphCastGFS forecast calendars under `data/qore/` for arctic-blast lead windows. The default end date rolls to the latest complete UTC day; set `QORE_GFS_CALENDAR_END` or `QORE_TEST_END` for a fixed snapshot. The GraphCastGFS script starts on the first raw NOAA 00z archive date verified for this collector, `2024-04-26`. Failed items make the command exit nonzero unless `QORE_GFS_ALLOW_PARTIAL=1` is set.

## What It Does

- Opens on the tracked `data/qore` research catalog without bundled starter rows.
- Shows source-backed market, weather, forecast-calendar, signal-score, and signal-return inventory.
- Loads two active research strategies: Weather Hybrid Rotation and UNG winter volatility mean reversion.
- Keeps the rejected Winter Weather Demand strategy lanes archived as research evidence instead of active baselines.
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

Optimize the archived Winter Weather Demand strict strategy tests:

```bash
npm run optimize:arctic-strategies
```

This reads the shared forecast score/return/location rows, filters to no-lookahead `UNG` trades, and writes five archived `strict-theory` variants under `data/qore/research/strategy-tests/`. The variants only trade winter 7-10 day rumor-window rows: long for severe broad cold, short for significant broad warmth, with at least two independent forecast source groups confirming the same event. They are not imported into the active dashboard registry because the current evidence is too sparse, drawdown-heavy, or unstable.

## Active Research Strategies

The first active strategy is `weather-hybrid-rotation`. It keeps idle capital in `US-INDEX-BASKET`, then rotates a measured UNG overlay when winter weather fear creates a high-confidence setup:

- Signal date: after a forecast issue date, use only later trading sessions.
- Weather setup: 7-10 day winter GFS/GEFS Arctic Blast or warm-winter windows.
- Selected architecture: fade-only, so it waits for the weather-fear window and then fades the realized UNG overreaction.
- Fallback: every non-overlay day remains invested in the diversified US index basket.
- Selection: candidates were ranked on train/validation only; holdout rows after `2025-11-01` were reported after selection.

The selected weather-hybrid run made `133.32%` full-sample versus `91.47%` for the index basket, with `-28.12%` max drawdown. The important anti-overfit detail is the split: train return was `27.95%`, validation was `63.98%`, and holdout was `11.21%`; holdout edge versus the index basket was only `0.27%`, so this is an active research baseline, not a broker-ready system.

Rebuild it with:

```bash
npm run optimize:weather-hybrid
```

The second active strategy is `volatility-mean-reversion`. It does not trade the weather forecast directly. It trades UNG's next regular session after a large winter close-to-close move:

- Signal date: after the UNG market close, measure the latest close-to-close return against trailing 40-session realized volatility.
- Trade filter: only act when the absolute volatility-normalized move is at least `0.8`, and trailing volatility is between `2.5%` and `6%`.
- Direction: go long for the next session after a large down move; go short for the next session after a large up move.
- Exit: close the trade the same session, so the holding window is next-session open to next-session close.
- Sizing and cost: results use `35%` notional and `0.064%` round-trip cost.

The edge hypothesis is short-horizon overreaction. UNG can gap or trend hard on weather headlines, inventory anxiety, contract-roll pressure, ETF flow, and natural-gas volatility. In winter, those moves often overshoot into the close. The strategy waits until that move is already known, then fades the next day's intraday follow-through rather than trying to predict the original shock.

The reason it is kept is sample quality. The selected rule was picked on pre-`2025-11-01` training data, then checked on holdout rows after selection. It has `496` full-sample trades, `462` train trades, and `34` holdout trades; full-sample return is `68.97%` with `-6.33%` max drawdown, while holdout return is `6.38%` with `-2.08%` max drawdown. That is not broker-ready, but it is a cleaner high-sample companion lane beside the weather-hybrid strategy.

## Non-Live Execution Architecture

QORE has strategy and execution architecture, but no live broker hookup. The active research strategy registry lives in `src/strategies/arcticBlast.ts`, dry-run risk and order-intent code lives in `src/execution/`, and the dashboard execution view exposes the dry-run paper gateway plus promotion gates.

The current boundary is deliberate:

- Strategy code can create auditable signal intents.
- Risk code can approve or reject dry-run order intents.
- The paper gateway can produce simulated fills.
- No broker client, account credential, or live order route is instantiated.

## Integration Seams

- `src/integrations/connectors.ts`: NOAA CDO, EIA API, CME/NYMEX metadata, dry-run paper execution, local project data, model registry.
- `src/backtesting/engine.ts`: register real strategy signal functions here; none are bundled by default.
- `src/backtesting/timing.ts`: no-lookahead timing checks for forecast signal-return rows.
- `src/ml/evaluation.ts`: weather model scoring for imported rows.
- `src/utils/importers.ts`: CSV parsers for dashboard ingestion.

Live trading is deliberately not connected. The execution view is a paper-trading readiness layer for future broker adapters and risk controls.
