import type { LiveTelemetry } from './types'

const apiBaseUrl = (import.meta.env.VITE_QORE_API_URL ?? 'http://127.0.0.1:4775').replace(/\/$/, '')

async function request(path: string, options: RequestInit = {}, timeoutMs = 8_000) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
      signal: controller.signal,
    })
    const payload = (await response.json().catch(() => ({}))) as LiveTelemetry
    if (!response.ok) throw new Error(payload.error || `Runtime API returned ${response.status}.`)
    return payload
  } finally {
    window.clearTimeout(timeout)
  }
}

export function getLiveTelemetry() {
  return request('/api/live/status')
}

export function refreshLiveTelemetry() {
  return request('/api/live/refresh', { method: 'POST' }, 50_000)
}
