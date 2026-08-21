#!/usr/bin/env node
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const mode = String(process.env.QORE_BROKER_MODE ?? 'dry-run').trim().toLowerCase()
if (!['paper', 'live'].includes(mode)) throw new Error('Order history requires explicit paper or live broker mode.')

const expectedBaseUrl = mode === 'paper'
  ? 'https://paper-api.alpaca.markets'
  : 'https://api.alpaca.markets'
const configuredBaseUrl = String(process.env.QORE_ALPACA_BASE_URL ?? expectedBaseUrl).replace(/\/$/, '')
const testEndpointAllowed = process.env.NODE_ENV === 'test' && process.env.QORE_ALPACA_TEST_ENDPOINT_CONFIRMED === '1'
if (configuredBaseUrl !== expectedBaseUrl && !testEndpointAllowed) {
  throw new Error(`${mode} order history is hard-bound to ${expectedBaseUrl}.`)
}

const apiKey = process.env.QORE_ALPACA_API_KEY_ID ?? process.env.APCA_API_KEY_ID
const apiSecret = process.env.QORE_ALPACA_API_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY
if (!apiKey || !apiSecret) throw new Error('Alpaca credentials are unavailable.')

const brokerDir = path.resolve(process.env.QORE_BROKER_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'broker'))
const outputPath = path.resolve(process.env.QORE_BROKER_ORDER_HISTORY_FILE ?? path.join(brokerDir, 'order-history.json'))
const timeoutMs = Math.max(1_000, Number(process.env.QORE_ALPACA_REQUEST_TIMEOUT_MS) || 15_000)
const params = new URLSearchParams({ status: 'all', limit: '500', direction: 'desc', nested: 'false' })
const response = await fetch(`${configuredBaseUrl}/v2/orders?${params}`, {
  headers: {
    Accept: 'application/json',
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': apiSecret,
  },
  redirect: 'error',
  signal: AbortSignal.timeout(timeoutMs),
})
if (!response.ok) throw new Error(`Alpaca order history returned HTTP ${response.status}.`)
const rawOrders = await response.json()
if (!Array.isArray(rawOrders)) throw new Error('Alpaca order-history response is missing or invalid.')

function text(value, maxLength) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function number(value, digits) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const factor = 10 ** digits
  return Math.round(parsed * factor) / factor
}

function timestamp(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const orders = rawOrders.map((order) => ({
  id: text(order?.id, 80),
  clientOrderId: text(order?.client_order_id, 96),
  symbol: text(order?.symbol, 24),
  side: text(order?.side, 16),
  type: text(order?.type ?? order?.order_type, 24),
  status: text(order?.status, 32),
  timeInForce: text(order?.time_in_force, 16),
  quantity: number(order?.qty, 8),
  notionalUsd: number(order?.notional, 2),
  filledQuantity: number(order?.filled_qty, 8),
  limitPriceUsd: number(order?.limit_price, 4),
  stopPriceUsd: number(order?.stop_price, 4),
  averageFillPriceUsd: number(order?.filled_avg_price, 4),
  submittedAt: timestamp(order?.submitted_at),
  filledAt: timestamp(order?.filled_at),
  canceledAt: timestamp(order?.canceled_at),
  updatedAt: timestamp(order?.updated_at),
})).filter((order) => order.id || order.symbol)

const payload = {
  generatedAt: new Date().toISOString(),
  serviceId: 'qore-alpaca-order-history',
  broker: 'alpaca',
  mode,
  limited: rawOrders.length >= 500,
  orders,
}
await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o770 })
const temporaryPath = `${outputPath}.${process.pid}.tmp`
await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o660 })
await rename(temporaryPath, outputPath)

if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(payload)}\n`)
else console.log(`Fetched ${orders.length} Alpaca ${mode} order${orders.length === 1 ? '' : 's'}.`)
