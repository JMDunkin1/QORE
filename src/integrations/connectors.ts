import type { ExecutionVenue, IntegrationConnector } from '../types'

export const integrationConnectors: IntegrationConnector[] = [
  {
    name: 'NOAA Climate Data Online',
    category: 'Weather',
    status: 'Needs key',
    purpose: 'Historical station data, daily summaries, degree-day features, and station metadata.',
    envVar: 'NOAA_CDO_TOKEN',
    sourceUrl: 'https://www.ncdc.noaa.gov/cdo-web/webservices/v2',
  },
  {
    name: 'Open-Meteo Forecast Archives',
    category: 'Weather',
    status: 'Ready scaffold',
    purpose: 'Current forecasts, historical forecast runs, previous-run lead windows, and 2m temperature anomaly inputs.',
    envVar: 'OPEN_METEO_BASE_URL',
    sourceUrl: 'https://open-meteo.com/en/docs/historical-forecast-api',
  },
  {
    name: 'EIA Open Data API',
    category: 'Market data',
    status: 'Needs key',
    purpose: 'Natural gas storage, prices, production, consumption, and regional fundamental series.',
    envVar: 'EIA_API_KEY',
    sourceUrl: 'https://www.eia.gov/opendata/documentation/APIv2.1.0.pdf',
  },
  {
    name: 'CME / NYMEX Contract Metadata',
    category: 'Market data',
    status: 'Ready scaffold',
    purpose: 'Henry Hub futures contract specs, expirations, product sizing, and risk calendar metadata.',
    envVar: 'CME_DATA_TOKEN',
    sourceUrl: 'https://www.cmegroup.com/markets/energy/natural-gas/natural-gas.contractSpecs.html',
  },
  {
    name: 'IBKR Gateway / TWS API',
    category: 'Execution',
    status: 'Paper only',
    purpose: 'Paper-trade futures orders first, then graduate to broker-approved live routing with kill switches.',
    envVar: 'IBKR_ACCOUNT_ID',
    sourceUrl: 'https://ibkrcampus.com/campus/ibkr-api-page/getting-started/',
  },
  {
    name: 'QORE Local Data',
    category: 'Storage',
    status: 'Ready scaffold',
    purpose: 'Reads local weather, natural-gas, signal, and run artifacts from this project data contract.',
    envVar: 'QORE_DATA_ROOT',
    sourceUrl: 'local://.local/qore',
  },
  {
    name: 'Model Registry',
    category: 'ML',
    status: 'Ready scaffold',
    purpose: 'Stores model runs, feature sets, champion/challenger status, and strategy promotion gates.',
    envVar: 'QORE_MODEL_REGISTRY',
    sourceUrl: 'local://models',
  },
]

export const executionVenues: ExecutionVenue[] = [
  {
    instrument: 'Henry Hub Natural Gas Futures',
    code: 'NG',
    venue: 'CME / NYMEX',
    contractSize: '10,000 MMBtu',
    settlement: 'Physical',
    role: 'Primary liquid benchmark for research and production-grade futures routing.',
  },
  {
    instrument: 'Micro Henry Hub Natural Gas Futures',
    code: 'MNG',
    venue: 'CME / NYMEX',
    contractSize: '1,000 MMBtu',
    settlement: 'Financial',
    role: 'Smaller notional lane for early paper/live experiments after controls are proven.',
  },
  {
    instrument: 'E-mini Henry Hub Natural Gas Futures',
    code: 'QG',
    venue: 'CME / NYMEX',
    contractSize: '2,500 MMBtu',
    settlement: 'Financial',
    role: 'Middle-size test lane when micro is too small and full-size NG is too large.',
  },
]

export const adapterChecklist = [
  'Normalize market bars and weather features before modeling.',
  'Run every strategy in paper mode before enabling any live order path.',
  'Require max-loss, max-position, contract-expiry, and stale-data guards.',
  'Record every signal, model version, order intent, fill, and rejected trade.',
  'Separate research credentials from broker execution credentials.',
]
