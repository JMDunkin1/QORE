# Henry Hub NG Futures Readiness

Checked: 2026-06-08

## Current shared cache

- `data/qore/market/yahoo/UNG-qore-market.csv` is ETF market history.
- `data/qore/market/yahoo/NG-F-qore-market.csv` is Yahoo's continuous `NG=F` front-month proxy.
- Neither file contains a delivery-month contract code, last trade date, first notice or delivery-risk date, roll date, roll trigger, roll adjustment, open interest, or per-contract settlement source.

## Source-backed pieces available without a paid market feed

- CME rulebook Chapter 220 gives the Henry Hub Natural Gas futures contract unit of `10,000 MMBtu`, the Henry Hub delivery point, physical delivery, and the expiration rule: trading terminates on the third business day before the first day of the delivery month.
- CME's product pages and expiration calendar can validate current contract specs and listed product dates, but they do not provide a repo-ready historical daily per-contract price ladder.
- EIA's Natural Gas Futures Prices table provides daily NYMEX Contract 1-4 settlement history and defines Contract 1 as the earliest delivery date, with Contract 2-4 as successive months. The EIA table currently states that futures prices after `2024-04-05` are not available.
- CFTC COT data is available without a token through historical compressed files and the public reporting environment. It can add weekly positioning/open-interest context, but it is not daily OHLC/settlement data by contract month.

## Missing before futures-grade claims

- Daily OHLC or settlement, volume, and open interest for each individual NG delivery month, e.g. `NGF2021`, `NGG2021`, etc.
- Contract master calendar with delivery month, month code, listing date if available, last trade date, first notice or delivery-risk handling, settlement type, and exchange holiday adjustments.
- Explicit roll policy, such as volume/open-interest switch or N business days before last trade, plus raw and adjusted continuous series outputs.
- Backtest execution convention: signal timestamp, next tradable session, close/open/settlement fill choice, slippage, commission, tick value, contract multiplier, margin, and maximum delivery-risk cutoff.

## Labeling rule

Until those pieces exist, QORE strategy results should be labelled `UNG ETF` or `Yahoo NG=F continuous proxy` research. They should not be described as futures-grade Henry Hub NG performance.

## Sources checked

- CME Rulebook Chapter 220: https://www.cmegroup.com/rulebook/NYMEX/2/220.pdf
- CME Henry Hub Natural Gas futures product page: https://www.cmegroup.com/markets/energy/natural-gas/natural-gas.contractSpecs.html
- CME Henry Hub Natural Gas futures calendar: https://www.cmegroup.com/markets/energy/natural-gas/natural-gas.calendar.html
- EIA Natural Gas Futures Prices: https://www.eia.gov/dnav/ng/ng_pri_fut_s1_d.htm
- EIA table definitions and notes: https://www.eia.gov/dnav/ng/tbldefs/ng_pri_fut_tbldef2.asp
- CFTC Commitments of Traders: https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm
- CFTC historical compressed files: https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm
