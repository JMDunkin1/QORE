import type { LiveBrokerCode, RiskPolicy } from './types'

export const recommendedLiveBroker = {
  id: 'alpaca-trading-api',
  broker: 'alpaca' satisfies LiveBrokerCode,
  label: 'Alpaca Trading API',
  account: 'Individual taxable brokerage account with API keys; margin/short capability is needed for exact negative UNG legs.',
  rationale:
    'QORE currently routes an ETF proxy basket, not futures. Alpaca is the lowest-friction API-first path for US stock and ETF paper/live routing.',
  liveOrderableSymbols: ['UNG', 'VOO', 'QQQM'],
  excludedSymbols: ['NG', 'MNG', 'QG'],
  setupDoc: 'docs/live-trading-broker-setup.md',
} as const

export const alpacaLiveRiskPolicy: RiskPolicy = {
  id: 'alpaca-live-etf-reconciler-v1',
  mode: 'live',
  allowedInstruments: ['UNG', 'VOO', 'QQQM'],
  maxConfidence: 1,
  minConfidence: 0,
  maxSignalAgeDays: 1,
  maxWeatherIssueAgeHours: 36,
  maxMarketDataAgeMinutes: 1440,
  maxStorageDataAgeDays: 10,
  maxAllowedSpreadBps: 75,
  minReferencePriceUsd: 1,
  minWeatherSourceCount: 2,
  minWeatherCoveragePct: 70,
  minWeatherDirectionalAccuracyPct: 52,
  requireFreshWeatherContext: true,
  requireStorageContext: true,
  requireMarketContext: true,
  requireAccountContext: true,
  requireOperatorContext: true,
  requireManualApproval: false,
  allowShortGas: true,
  notes: [
    'Live routing is ETF-only: UNG for the gas overlay and VOO/QQQM for the index basket.',
    'NG, MNG, and QG futures codes are deliberately excluded until futures contract, expiry, roll, and delivery logic exists.',
    'The gateway reconciles target weights against broker positions and sends only delta orders after live environment gates pass.',
  ],
  liveRoutingEnabled: true,
}

export const alpacaLiveGatewayProfile = {
  id: 'qore-alpaca-live-gateway',
  label: 'Alpaca live gateway',
  mode: 'live',
  brokerConnected: 'env-credential-gated',
  liveRoutingEnabled: 'requires-live-confirmation',
  purpose:
    'Routes approved ETF target-weight deltas to Alpaca paper or live accounts after kill-switch, freshness, account, and live-confirmation gates pass.',
} as const

export const liveExecutionReadinessGates = [
  {
    id: 'broker-account',
    label: 'Broker account',
    status: 'ready',
    detail: 'Use an Alpaca Trading API account; exact all-year replication needs margin/short capability for negative UNG rows.',
  },
  {
    id: 'credential-handoff',
    label: 'Credential handoff',
    status: 'ready',
    detail: 'Set Alpaca API key and secret in .env.local; the repo never commits secrets.',
  },
  {
    id: 'paper-first',
    label: 'Paper and dry run',
    status: 'ready',
    detail: 'The same reconciler can run dry-run, Alpaca paper, or Alpaca live modes.',
  },
  {
    id: 'live-confirmation',
    label: 'Live confirmation',
    status: 'locked',
    detail: 'Real orders require QORE_LIVE_TRADING_ENABLED, QORE_LIVE_ORDER_ROUTING_ENABLED, and the loss-risk confirmation phrase.',
  },
  {
    id: 'futures-excluded',
    label: 'Futures excluded',
    status: 'ready',
    detail: 'The live adapter refuses NG, MNG, and QG futures symbols until a futures-grade router is built.',
  },
] as const
