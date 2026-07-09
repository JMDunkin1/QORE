import type { ExecutionVenue, IntegrationConnector } from '../types'
import { alpacaLiveGatewayProfile, dryRunGatewayProfile } from '../execution'

export const integrationConnectors: IntegrationConnector[] = [
  {
    name: 'NOAA Climate Data Online',
    category: 'Weather',
    status: 'Free email token',
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
    status: 'Free API key',
    purpose: 'Natural gas storage, prices, production, consumption, and regional fundamental series.',
    envVar: 'EIA_API_KEY',
    sourceUrl: 'https://www.eia.gov/opendata/documentation/APIv2.1.0.pdf',
  },
  {
    name: 'CME / NYMEX Contract Metadata',
    category: 'Market data',
    status: 'Research',
    purpose:
      'Official Henry Hub futures specs, expiration-calendar checks, product sizing, and delivery-risk metadata; historical per-contract bars and roll logic are not implemented.',
    envVar: 'CME_DATA_TOKEN',
    sourceUrl: 'https://www.cmegroup.com/markets/energy/natural-gas/natural-gas.contractSpecs.html',
  },
  {
    name: 'EIA NYMEX Futures Contract 1-4 History',
    category: 'Market data',
    status: 'Research',
    purpose:
      'No-auth daily Henry Hub NYMEX Contract 1-4 settlement history for front-ladder research; this is not a specific month-code contract database and is stale after 2024-04-05.',
    envVar: 'EIA_API_KEY',
    sourceUrl: 'https://www.eia.gov/dnav/ng/ng_pri_fut_s1_d.htm',
  },
  {
    name: dryRunGatewayProfile.label,
    category: 'Execution',
    status: 'Dry run only',
    purpose: dryRunGatewayProfile.purpose,
    envVar: 'QORE_EXECUTION_MODE',
    sourceUrl: 'local://execution/dry-run-paper-gateway',
  },
  {
    name: alpacaLiveGatewayProfile.label,
    category: 'Execution',
    status: 'Credential gated',
    purpose: alpacaLiveGatewayProfile.purpose,
    envVar: 'APCA_API_KEY_ID',
    sourceUrl: 'local://execution/alpaca-live-gateway',
  },
  {
    name: 'QORE Local Data',
    category: 'Storage',
    status: 'Ready scaffold',
    purpose: 'Reads local weather, natural-gas, signal, and run artifacts from this project data contract.',
    envVar: 'QORE_DATA_ROOT',
    sourceUrl: 'local://data/qore',
  },
  {
    name: 'Model Registry',
    category: 'ML',
    status: 'Ready scaffold',
    purpose: 'Stores future model metadata, feature sets, review status, and strategy promotion gates.',
    envVar: 'QORE_MODEL_REGISTRY',
    sourceUrl: 'local://models',
  },
]

export const executionVenues: ExecutionVenue[] = [
  {
    instrument: 'United States Natural Gas Fund',
    code: 'UNG',
    venue: 'NYSE Arca',
    contractSize: 'ETF share',
    settlement: 'T+1 equity',
    role: 'Live-orderable natural-gas proxy overlay for the Alpaca ETF adapter.',
  },
  {
    instrument: 'Vanguard S&P 500 ETF',
    code: 'VOO',
    venue: 'NYSE Arca',
    contractSize: 'ETF share',
    settlement: 'T+1 equity',
    role: '80% target-weight idle-capital fallback leg for live ETF routing.',
  },
  {
    instrument: 'Invesco NASDAQ 100 ETF',
    code: 'QQQM',
    venue: 'Nasdaq',
    contractSize: 'ETF share',
    settlement: 'T+1 equity',
    role: '20% target-weight growth tilt in the idle-capital fallback basket.',
  },
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
  'Run every strategy in dry-run and Alpaca paper mode before live routing.',
  'Require max-loss, max-position, contract-expiry, and stale-data guards.',
  'Record every signal, model version, order intent, fill, and rejected trade.',
  'Keep ETF broker routing separate from any future futures-grade broker adapter.',
]
