import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { redactSecretText } from './secret-redaction.mjs'

const DEFAULT_TIMEOUT_MS = 15_000
const PROVIDER_HOSTS = {
  discord: new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']),
  resend: new Set(['api.resend.com']),
}

function safeText(value, maxLength = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength)
}

function envName(value, field) {
  const name = String(value ?? '').trim()
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`${field} must name an uppercase environment variable.`)
  return name
}

function requiredEnv(env, name, destinationId) {
  const value = String(env[name] ?? '').trim()
  if (!value) throw new Error(`Destination ${destinationId} requires ${name}.`)
  return value
}

function positiveInteger(value, fallback) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback
}

function positiveDelaySeconds(value) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric)
  const retryAt = Date.parse(value)
  return Number.isFinite(retryAt) && retryAt > Date.now() ? Math.ceil((retryAt - Date.now()) / 1_000) : null
}

function assertHttpsProviderUrl(value, type) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${type} destination URL is invalid.`)
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${type} destination requires an HTTPS URL without embedded credentials.`)
  }
  if (!PROVIDER_HOSTS[type]?.has(url.hostname)) throw new Error(`${type} destination host is not allowed.`)
  return url
}

function discordUrl(value) {
  const url = assertHttpsProviderUrl(value, 'discord')
  if (!/^\/api(?:\/v\d+)?\/webhooks\/[^/]+\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('Discord destination must use an incoming-webhook URL.')
  }
  url.searchParams.set('wait', 'true')
  return url.toString()
}

function telegramUrl(token) {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Telegram bot token has an invalid format.')
  return `https://api.telegram.org/bot${token}/sendPhoto`
}

function emailAddress(value, field, { allowDisplayName = false } = {}) {
  const address = String(value ?? '').trim()
  const plain = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
  const displayed = /^[^<>\r\n]{1,100}\s<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/
  if (!plain.test(address) && !(allowDisplayName && displayed.test(address))) {
    throw new Error(`${field} must be one email address${allowDisplayName ? ' with an optional display name' : ''}.`)
  }
  return address
}

async function boundedResponseText(response, maxBytes = 32_000) {
  if (!response?.body?.getReader) return (await response.text()).slice(0, maxBytes)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let remaining = maxBytes
  let reachedLimit = false
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value.subarray(0, remaining)
      text += decoder.decode(chunk, { stream: chunk.length === value.length })
      remaining -= chunk.length
      if (chunk.length < value.length) {
        reachedLimit = true
        break
      }
    }
    if (remaining === 0) reachedLimit = true
    if (reachedLimit) await reader.cancel()
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

async function request(url, options, { timeoutMs, label, secrets = [], fetchImpl = fetch }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: 'error',
      signal: controller.signal,
    })
    const responseText = await boundedResponseText(response)
    if (!response.ok) {
      let payload = null
      try { payload = JSON.parse(responseText) } catch {}
      const error = new Error(`${label} returned HTTP ${response.status}.`)
      error.httpStatus = response.status
      error.ambiguous = response.status >= 500
      error.retryAfterSeconds = positiveDelaySeconds(
        response.headers?.get?.('retry-after') ?? payload?.retry_after ?? payload?.parameters?.retry_after,
      )
      throw error
    }
    return { status: response.status, responseText }
  } catch (error) {
    const timedOut = error?.name === 'AbortError'
    const message = timedOut ? `${label} timed out after ${timeoutMs}ms.` : redactSecretText(error?.message ?? String(error), secrets)
    const sanitized = new Error(safeText(message, 500))
    if (error?.retryAfterSeconds) sanitized.retryAfterSeconds = error.retryAfterSeconds
    sanitized.ambiguous = timedOut || error?.ambiguous === true || !error?.httpStatus
    throw sanitized
  } finally {
    clearTimeout(timeout)
  }
}

async function sendDiscord({ destination, bytes, filename, caption, env, timeoutMs, fetchImpl }) {
  const webhookEnv = envName(destination.webhookUrlEnv, 'webhookUrlEnv')
  const webhook = requiredEnv(env, webhookEnv, destination.id)
  const form = new FormData()
  form.set('payload_json', JSON.stringify({
    content: caption,
    allowed_mentions: { parse: [] },
    attachments: [{ id: 0, filename, description: 'QORE portfolio report' }],
  }))
  form.set('files[0]', new Blob([bytes], { type: 'image/png' }), filename)
  const resolvedUrl = discordUrl(webhook)
  const webhookParts = new URL(resolvedUrl).pathname.split('/').filter(Boolean).slice(-2)
  await request(resolvedUrl, { method: 'POST', body: form }, {
    timeoutMs,
    label: `Discord destination ${destination.id}`,
    secrets: [webhook, ...webhookParts],
    fetchImpl,
  })
  return { provider: 'discord' }
}

async function sendTelegram({ destination, bytes, filename, caption, env, timeoutMs, fetchImpl }) {
  const tokenEnv = envName(destination.botTokenEnv, 'botTokenEnv')
  const chatIdEnv = envName(destination.chatIdEnv, 'chatIdEnv')
  const token = requiredEnv(env, tokenEnv, destination.id)
  const chatId = requiredEnv(env, chatIdEnv, destination.id)
  const form = new FormData()
  form.set('chat_id', chatId)
  form.set('caption', caption.slice(0, 1024))
  form.set('photo', new Blob([bytes], { type: 'image/png' }), filename)
  if (destination.messageThreadIdEnv) {
    const threadEnv = envName(destination.messageThreadIdEnv, 'messageThreadIdEnv')
    form.set('message_thread_id', requiredEnv(env, threadEnv, destination.id))
  }
  const response = await request(telegramUrl(token), { method: 'POST', body: form }, {
    timeoutMs,
    label: `Telegram destination ${destination.id}`,
    secrets: [token, token.split(':')[1], chatId],
    fetchImpl,
  })
  let payload = null
  try { payload = JSON.parse(response.responseText) } catch {}
  if (payload?.ok !== true) {
    const error = new Error(`Telegram destination ${destination.id} returned an unsuccessful response.`)
    if (payload?.ok === false) error.retryAfterSeconds = positiveDelaySeconds(payload?.parameters?.retry_after)
    else error.ambiguous = true
    throw error
  }
  return { provider: 'telegram' }
}

async function sendResend({ destination, bytes, filename, caption, env, timeoutMs, fetchImpl, deliveryKey }) {
  const apiKeyEnv = envName(destination.apiKeyEnv, 'apiKeyEnv')
  const fromEnv = envName(destination.fromEnv, 'fromEnv')
  const toEnv = envName(destination.toEnv, 'toEnv')
  const apiKey = requiredEnv(env, apiKeyEnv, destination.id)
  const from = emailAddress(requiredEnv(env, fromEnv, destination.id), fromEnv, { allowDisplayName: true })
  const to = emailAddress(requiredEnv(env, toEnv, destination.id), toEnv)
  const subjectPrefix = safeText(destination.subjectPrefix ?? 'QORE portfolio report', 80)
  const subject = `${subjectPrefix} · ${safeText(caption.split('\n')[0], 120)}`
  const htmlCaption = caption
    .split('\n')
    .map((line) => line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
    .join('<br>')
  const body = {
    from,
    to: [to],
    subject,
    html: `<p>${htmlCaption}</p><p><img src="cid:qore-report" alt="QORE portfolio report"></p>`,
    attachments: [{
      filename,
      content: Buffer.from(bytes).toString('base64'),
      content_id: 'qore-report',
    }],
  }
  await request('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `qore-${crypto.createHash('sha256').update(deliveryKey).digest('hex')}`,
    },
    body: JSON.stringify(body),
  }, {
    timeoutMs,
    label: `Resend destination ${destination.id}`,
    secrets: [apiKey, from, to],
    fetchImpl,
  })
  return { provider: 'resend' }
}

const adapters = {
  discord: sendDiscord,
  telegram: sendTelegram,
  resend: sendResend,
}

export function enabledDestinations(config) {
  const destinations = Array.isArray(config?.delivery?.destinations) ? config.delivery.destinations : []
  const ids = new Set()
  return destinations.filter((destination) => {
    const id = safeText(destination?.id, 80)
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
      throw new Error('Every report destination requires a lowercase id containing only letters, numbers, and hyphens.')
    }
    if (ids.has(id)) throw new Error(`Duplicate report destination id "${id}".`)
    ids.add(id)
    if (!Object.hasOwn(adapters, destination?.type)) throw new Error(`Destination ${id} has unsupported type "${destination?.type}".`)
    return destination?.enabled === true
  })
}

export async function deliverPortfolioReport({
  config,
  artifactPath,
  artifactBytes = null,
  filename,
  caption,
  deliveryKey,
  env = process.env,
  skipDestinationIds = new Set(),
  fetchImpl = fetch,
} = {}) {
  const bytes = artifactBytes === null ? await readFile(artifactPath) : Buffer.from(artifactBytes)
  if (bytes.length > 9 * 1024 * 1024) throw new Error('Report PNG exceeds the shared 9 MiB delivery limit.')
  const timeoutMs = positiveInteger(config?.delivery?.requestTimeoutMs, DEFAULT_TIMEOUT_MS)
  const destinations = enabledDestinations(config)
  const attempts = destinations
    .filter((destination) => !skipDestinationIds.has(destination.id))
    .map(async (destination) => {
      const startedAt = new Date().toISOString()
      try {
        const adapter = adapters[destination.type]
        const result = await adapter({
          destination,
          bytes,
          filename,
          caption,
          deliveryKey: `${deliveryKey}:${destination.id}`,
          env,
          timeoutMs,
          fetchImpl,
        })
        return { id: destination.id, type: destination.type, status: 'sent', startedAt, finishedAt: new Date().toISOString(), ...result }
      } catch (error) {
        const uncertain = error?.ambiguous === true
        return {
          id: destination.id,
          type: destination.type,
          status: uncertain ? 'uncertain' : 'failed',
          startedAt,
          finishedAt: new Date().toISOString(),
          error: safeText(error?.message ?? error, 500),
          retryAfterSeconds: error?.retryAfterSeconds ?? null,
        }
      }
    })
  return Promise.all(attempts)
}
