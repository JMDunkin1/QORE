# Meta-label trade filter optimization
Generated: 2026-06-10T04:02:13.808Z
## Verdict
Do not replace the shared baseline. Use this as a risk-filter diagnostic unless a longer walk-forward window confirms it.
Current shared meta-label baseline: -6.22% total, 6 post-cutoff trades, -17.45% maxDD, Sharpe -0.17.
Best validation-selected post-cutoff report card in this run: 19.78% total, 4 trades, 50% win, -2.38% maxDD, Sharpe 2.25.
Best combined candidate that clears the fixed six-trade post-cutoff minimum: 3.75% total, 6 trades, 50% win, -17.38% maxDD, Sharpe 0.45.
## Integration recommendation
- Action: Demote strict-theory-meta-label-trade-filter from the primary strategy shortlist; keep it as a diagnostic research lane only.
- Baseline decision: Do not replace the shared meta-label baseline with the four-trade selected candidate.
- Sleeve decision: Do not integrate separate cold-long or warm-short sleeves yet.
- Evidence: The selected combined candidate improves the post-cutoff report card by shrinking to four trades, below the fixed six-trade minimum used for primary ranking.
- Evidence: The best six-trade combined candidate is only modestly positive and still carries the December cold-long drawdown.
- Evidence: Cold-long has no validation-usable independent sleeve, while the selected warm-short sleeve loses post-cutoff.
- Promotion gate: Require a longer walk-forward window or at least another winter with six or more non-overlapping post-cutoff trades before promotion.
## Selected lanes
| lane | selected | validation | test | sourceIds |
| --- | --- | --- | --- | --- |
| combined | ncep-gem-cross-provider / fixed-theory-gate / lambda008-threshold055 | 29.26% total, 4 trades, 100% win, 0% maxDD, Sharpe 4.85 | 19.78% total, 4 trades, 50% win, -2.38% maxDD, Sharpe 2.25 | gfs\|gefs-mean\|gem-global |
| cold-long | none | n/a | n/a |  |
| warm-short | long-history-cross-provider / broader-coverage / lambda008-threshold055 | 3.91% total, 2 trades, 100% win, 0% maxDD, Sharpe 12.71 | -7.46% total, 2 trades, 0% win, -7.46% maxDD, Sharpe -3.61 | gfs\|gefs-mean\|ecmwf-ifs\|gem-global |
## Minimum-trade candidates
| lane | minimumTrades | selected | validation | test | sourceIds |
| --- | --- | --- | --- | --- | --- |
| combined | 6 | all-confirmed-sources / fixed-theory-gate / lambda008-threshold055 | 25.49% total, 5 trades, 80% win, -2.92% maxDD, Sharpe 3.48 | 3.75% total, 6 trades, 50% win, -17.38% maxDD, Sharpe 0.45 | gfs\|gefs-mean\|graphcastgfs\|ecmwf-ifs\|ecmwf-aifs\|aigfs\|gem-global |
| cold-long | 2 | none | n/a | n/a |  |
| warm-short | 3 | long-history-cross-provider / broader-coverage / lambda004-threshold055 | 3.91% total, 2 trades, 100% win, 0% maxDD, Sharpe 12.71 | -7.65% total, 3 trades, 0% win, -7.65% maxDD, Sharpe -1.7 | gfs\|gefs-mean\|ecmwf-ifs\|gem-global |
## Overfit controls
- Final train/test split: train issueDate < 2025-11-01; test issueDate >= 2025-11-01.
- Hyperparameter selection split: fit issueDate < 2025-01-01; validation 2025-01-01 <= issueDate < 2025-11-01.
- Small fixed grid only: 3 weather gates x 5 logistic settings x 5 source sets.
- The post-cutoff test return was not used to choose the selected lane configurations.
- No-lookahead timing filter enforced: entryTradeDate > issueDate, targetTradeDate >= targetDate, targetTradeDate > entryTradeDate, symbol UNG.
- Timing audit: 3074 accepted UNG rows; 15315 rejected invalid/lookahead UNG rows from 18389 UNG return rows.
- Source-set candidates require at least two source groups and two model families; dynamic trained-source set drops sources with no pre-cutoff candidate evidence.
- Round-trip friction applied per trade: 0.064%.
## Weather rationale
- Cold-long stays tied to the theory: winter 7-10 day broad severe cold should lift UNG into the event window.
- Warm-short is evaluated separately because broad warmth is a different natural-gas demand story: less heating demand, bearish UNG exposure.
- The best-looking filters should reduce trades that are weak by breadth, severity, source family coverage, or classifier-estimated acceptance probability; they should not create trades outside the winter rumor-window thesis.
## Outputs
- Summary CSV: data/qore/research/strategy-agent-runs/meta-label-trade-filter/candidate-summary.csv
- Full JSON: data/qore/research/strategy-agent-runs/meta-label-trade-filter/results.json
- Selected post-cutoff trades: data/qore/research/strategy-agent-runs/meta-label-trade-filter/selected-post-cutoff-trades.csv
- Minimum-trade post-cutoff trades: data/qore/research/strategy-agent-runs/meta-label-trade-filter/minimum-trade-post-cutoff-trades.csv
## Dataset
- Forecast calendars: gfs, gefs-mean, graphcastgfs, ecmwf-ifs, ecmwf-aifs, aigfs, gem-global
- Return column used as PnL: returnPctEntryCloseToTarget.
