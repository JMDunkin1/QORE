# QORE Shared Research Data

This directory is tracked on purpose. It contains the market, weather, forecast-calendar, and source-evidence artifacts used to test the arctic-blast / natural-gas thesis.

`data/qore` is the default `QORE_DATA_ROOT`. Use `QORE_DATA_ROOT=.local/qore` for private scratch runs that should not be shared through Git.
Collector defaults roll forward: `npm run collect:free-data` starts at `2021-01-01` and ends on the latest complete UTC day, and the NOAA calendar commands use the latest complete UTC day unless a fixed end date is supplied.

The main forecast calendars are stored as:

- `weather/<provider>/...-location-anomalies.csv`
- `research/...-signal-scores.csv`
- `research/...-signal-returns.csv`
- `weather/<provider>/...-manifest.json`

The score files are the best entry point for strategy testing. The location files preserve the 18-city eastern-CONUS basket that produced each score, and the return files join each forecast signal to `UNG` and `NG=F`.
