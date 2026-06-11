# Weather Hybrid Rotation Lane

Generated at 2026-06-11T13:59:09.561Z.

## Purpose

This is the second active QORE research strategy. It tests the user thesis directly: use 7-10 day Arctic Blast / warm-winter forecasts to rotate part of the portfolio into UNG, then fade post-window overreactions, while idle capital stays in the diversified US index basket.

## Selected Candidate

- Architecture: Overreaction fade only.
- Source set: GFS plus GEFS mean.
- Weather leg: 0.25x max UNG overlay; 3 trading-day max hold; fixed sizing.
- Reversion leg: 0.2x max UNG overlay for 2 trading day(s) after a 2% realized UNG move.
- Signal gates: absolute forecast anomaly >= 5F; side coverage >= 0.5; confidence >= 0.5; source groups >= 1; model families >= 2.
- Cost: 0.064% round trip, charged as 0.032% one-way on UNG position changes.
- Selection: candidate rank used train and validation only. Holdout rows after 2025-11-01 were reported after selection.

## Metrics

| split | events | strategy | index | edge | CAGR | Sharpe | Sortino | maxDD | exposure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 204 | 27.95% | 33.7% | -5.75% | 7.93% | 0.5 | 0.75 | -28.12% | 5.2% |
| Validation | 67 | 63.98% | 29.08% | 34.9% | 36.69% | 1.8 | 2.42 | -14.94% | 3.5% |
| Holdout | 68 | 11.21% | 10.94% | 0.27% | 19.88% | 1.16 | 1.75 | -10.93% | 10% |
| Full | 339 | 133.32% | 91.47% | 41.85% | 16.93% | 0.95 | 1.37 | -28.12% | 5.3% |

## Side Checks

| leg | daily rows | return | Sharpe | maxDD |
| --- | ---: | ---: | ---: | ---: |
| Cold-long | 0 | 0% | 0 | 0% |
| Warm-short | 0 | 0% | 0 | 0% |
| Reversion-long | 187 | 1.76% | 0.22 | -14.48% |
| Reversion-short | 171 | 12.63% | 1.05 | -10.26% |
| Index fallback | 1004 | 103.57% | 1.08 | -26.43% |

## Top Train/Validation-Ranked Candidates

| candidate | eligible | rank | train edge | validation edge | holdout edge | full edge | events |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| fade-only-gfs-gefs-core-a5-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-fixed | yes | 88.3231 | -5.75% | 34.9% | 0.27% | 41.85% | 339 |
| fade-only-gfs-gefs-core-a5-c0.5-q0.5-wf0.4-rf0.2-fh3-rh2-mv2-fixed | yes | 88.3231 | -5.75% | 34.9% | 0.27% | 41.85% | 339 |
| fade-only-gfs-gefs-core-a5-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-confidence-scaled | yes | 87.4271 | -6.52% | 34.9% | 0.25% | 40.41% | 339 |
| fade-only-gfs-gefs-core-a5-c0.5-q0.5-wf0.4-rf0.2-fh3-rh2-mv2-confidence-scaled | yes | 87.4271 | -6.52% | 34.9% | 0.25% | 40.41% | 339 |
| fade-only-gfs-gefs-core-a5-c0.5-q0.35-wf0.25-rf0.2-fh3-rh2-mv2-confidence-scaled | yes | 86.3884 | -7.58% | 34.85% | 0.25% | 38.41% | 344 |
| fade-only-gfs-gefs-core-a5-c0.5-q0.35-wf0.4-rf0.2-fh3-rh2-mv2-confidence-scaled | yes | 86.3884 | -7.58% | 34.85% | 0.25% | 38.41% | 344 |
| fade-only-gfs-gefs-core-a5-c0.5-q0.35-wf0.25-rf0.2-fh3-rh2-mv2-fixed | yes | 85.5549 | -8.2% | 34.78% | 0.27% | 37.22% | 344 |
| fade-only-gfs-gefs-core-a5-c0.5-q0.35-wf0.4-rf0.2-fh3-rh2-mv2-fixed | yes | 85.5549 | -8.2% | 34.78% | 0.27% | 37.22% | 344 |
| follow-and-fade-ncep-complex-a8-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-confidence-scaled | yes | 75.312 | 26.84% | 2.64% | -11.54% | 18.72% | 795 |
| follow-and-fade-ncep-complex-a8-c0.5-q0.5-wf0.25-rf0.2-fh3-rh2-mv2-fixed | yes | 75.304 | 26.83% | 2.64% | -11.54% | 18.71% | 795 |
| follow-and-fade-ncep-complex-a8-c0.5-q0.35-wf0.25-rf0.2-fh3-rh2-mv2-confidence-scaled | yes | 74.7191 | 26.16% | 2.64% | -11.54% | 17.83% | 797 |
| follow-and-fade-ncep-complex-a8-c0.5-q0.35-wf0.25-rf0.2-fh3-rh2-mv2-fixed | yes | 73.9451 | 25.33% | 2.64% | -11.54% | 16.74% | 797 |

## Verdict

Promote this as an active research baseline, not broker-ready. It gives QORE the intended second lane: a weather-aware portfolio rotation that remains market-invested when the forecast edge is weak. The strongest caution is that the holdout is still only one winter, so the strategy should stay behind human promotion gates until more winters or paper-trading evidence accumulate.
