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
- Loads two active research strategies: NGAS Summer Alpha and NGAS Winter Alpha.
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

The first active strategy is `ngas-summer-alpha`. It keeps idle capital in `US-INDEX-BASKET`, then uses fresh multi-model day-7 summer heat forecasts to add NG futures exposure while skipping clustered heat-follow longs, and fades same-direction gas rallies after the observation window only when lagged storage is not below its trailing seasonal norm. The selected fade can size heat-rally shorts by forecast CDD demand intensity. Cool-short evidence stays diagnostic until enough validated cooling-season cool events exist.

```bash
npm run optimize:ngas-summer-alpha
```

The selected summer run made `317.48%` full-sample versus `91.47%` for the index basket, with `-20.15%` max drawdown. Train return was `83.73%`, validation was `43.8%`, and holdout was `58%`; holdout edge versus the index basket was `28.62%`. The selected overlay uses `0.35x` base NG exposure, allows the storage-deficit heat tilt to reach `0.4375x`, and lets CDD-tiered fade sizing lift qualifying heat-rally shorts up to `0.5x`. It remains needs-more-validation, not broker-ready.

The second active strategy is `ngas-winter-alpha`. It now owns frozen weather-follow, weather-reversion, and volatility-confirmation ledgers inside its own lane instead of reading archived strategy folders. The frozen inputs preserve the current winter blend exactly: cold-follow and warm-short context, post-window fade context, selected same-direction fade confirmation, and optional shorter daily-ledger holds when train/validation prefers faster exits.

```bash
npm run optimize:ngas-winter-alpha
```

The selected winter run made `282.46%` full-sample versus `91.47%` for the index basket, with `-22.04%` max drawdown. Train return was `81.03%`, validation was `53.97%`, and holdout was `37.22%`; holdout edge versus the index basket was `26.28%`. The selected blend uses frozen-input holds, a `400 Bcf` cold-follow storage-drawdown gate, adverse standalone-fade vetoes, and a `1.25x` gas-overlay risk multiplier capped at `0.5625x`. It is a research-baseline, not broker-ready, and still needs non-overlapping paper validation before any live route exists.

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
