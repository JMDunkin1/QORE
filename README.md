# QORE

Local React dashboard for researching whether weather forecast error can predict natural gas returns.

## Run

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and the localhost GitHub control service. The service fast-forwards from `origin/main` on launch when possible, checks GitHub every five minutes, and leaves live updates behind the dashboard's Update button.

Optional login service:

```bash
npm run install:launch-agent
```

Build check:

```bash
npm run build
```

## What It Does

- Generates deterministic demo weather and Henry Hub-style natural gas fixtures.
- Joins weather and market rows by `date`.
- Runs five strategy templates with slippage, commission, position sizing, and max exposure controls.
- Computes total return, CAGR, volatility, Sharpe, Sortino, max drawdown, Calmar, win rate, profit factor, exposure, turnover, VaR, and CVaR.
- Tracks weather forecast quality with HDD/CDD MAE, RMSE, R2, directional accuracy, cold-surprise recall, and calibration.
- Provides CSV import lanes for replacing demo data with local or external backtest data.

## CSV Contracts

Weather:

```csv
date,stationBlend,actualHdd,forecastHdd,actualCdd,forecastCdd,tempAnomalyF,windMph,precipIn,confidence
```

Natural gas:

```csv
date,open,high,low,close,volume,contract,storageBcf
```

## Integration Seams

- `src/integrations/connectors.ts`: NOAA CDO, EIA API, CME/NYMEX metadata, IBKR paper execution, local project data, model registry.
- `src/backtesting/engine.ts`: replace or extend strategy signal functions here.
- `src/ml/evaluation.ts`: weather model scoring and feature importance.
- `src/utils/importers.ts`: CSV parsers for dashboard ingestion.

Live trading is deliberately not connected. The execution view is a paper-trading readiness layer for future broker adapters and risk controls.
