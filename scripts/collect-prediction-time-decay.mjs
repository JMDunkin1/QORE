import { closeSync, createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(rootDir, process.env.QORE_TIME_DECAY_OUTPUT_DIR ?? 'data/qore/research/strategy-agent-runs/prediction-time-decay')
const lockPath = resolve(tmpdir(), 'qore-prediction-time-decay.collect.lock')
const kalshiBaseUrl = 'https://external-api.kalshi.com/trade-api/v2'
const polymarketGammaUrl = 'https://gamma-api.polymarket.com'
const polymarketClobUrl = 'https://clob.polymarket.com'
const initialCapital = 100000
const calendarDaysPerYear = 365.25
const millisecondsPerHour = 3600000
const millisecondsPerDay = 86400000
const secondsPerHour = 3600
const now = new Date()

const config = {
  historyDays: numberEnv('QORE_TIME_DECAY_HISTORY_DAYS', 365),
  maxKalshiHistoricalMarkets: numberEnv('QORE_TIME_DECAY_MAX_KALSHI_MARKETS', 160),
  maxPolymarketHistoricalMarkets: numberEnv('QORE_TIME_DECAY_MAX_POLYMARKET_MARKETS', 80),
  kalshiPages: optionalNumberEnv('QORE_TIME_DECAY_KALSHI_PAGES'),
  polymarketPages: optionalNumberEnv('QORE_TIME_DECAY_POLYMARKET_PAGES'),
  candleIntervalMinutes: numberEnv('QORE_TIME_DECAY_CANDLE_INTERVAL_MINUTES', 60),
  feeHaircutCents: numberEnv('QORE_TIME_DECAY_FEE_HAIRCUT_CENTS', 1),
  capitalAllocationPct: numberEnv('QORE_TIME_DECAY_CAPITAL_ALLOCATION_PCT', 1),
  holdoutMonths: numberEnv('QORE_TIME_DECAY_HOLDOUT_MONTHS', 2),
  validationDays: numberEnv('QORE_TIME_DECAY_VALIDATION_DAYS', 45),
  minTrainTrades: numberEnv('QORE_TIME_DECAY_MIN_TRAIN_TRADES', 120),
  minValidationTrades: numberEnv('QORE_TIME_DECAY_MIN_VALIDATION_TRADES', 35),
  monteCarloIterations: numberEnv('QORE_TIME_DECAY_MONTE_CARLO_ITERATIONS', 1000),
  reuseHistory: process.argv.includes('--reuse-history') || booleanEnv('QORE_TIME_DECAY_REUSE_HISTORY'),
  allowPartialHistory: process.argv.includes('--allow-partial-history') || booleanEnv('QORE_TIME_DECAY_ALLOW_PARTIAL_HISTORY'),
}

const monthNumbers = new Map(
  Object.entries({
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }),
)
const monthPattern =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const datePhrasePattern = new RegExp(
  `\\b(?:before|by|on\\s+or\\s+before|on/before|through|until)\\s+(?:[A-Z][a-z]+,\\s+)?(?<month>${monthPattern})\\.?\\s+(?<day>\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s+(?<year>20\\d{2}))?`,
  'i',
)
const monthYearPattern = new RegExp(
  `\\b(?:before|by|on\\s+or\\s+before|on/before|through|until)\\s+(?<month>${monthPattern})\\.?\\s+(?<year>20\\d{2})\\b`,
  'i',
)
const isoDatePattern = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/
const timeBoundPattern =
  /\b(before|by|on\s+or\s+before|on\/before|through|until|deadline|launch|happen|occur|pass|enacted|released|announced|resign|drop out|withdraw|file|ipo|list|reach|hit)\b/i
const excludedQuestionPattern =
  /\b(this week|next week|weighted average|above \$|below \$|temperature|high temperature|rainfall|snowfall|gas price|front month settle|settle price|stock price|close above|close below)\b/i

function numberEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function optionalNumberEnv(name) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : null
}

function booleanEnv(name) {
  return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').toLowerCase())
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function acquireOutputLock() {
  const tryAcquire = () => {
    const fd = openSync(lockPath, 'wx')
    try {
      writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n${outputDir}\n`)
    } finally {
      closeSync(fd)
    }
  }

  try {
    tryAcquire()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let ownerPid = null
    let ownerDetails = ''
    try {
      ownerDetails = readFileSync(lockPath, 'utf8')
      ownerPid = Number(ownerDetails.split(/\r?\n/)[0])
    } catch {
      ownerDetails = ''
    }
    if (processIsAlive(ownerPid)) {
      console.error(`prediction-time-decay collector already running from ${lockPath}: ${ownerDetails.trim()}`)
      return null
    }
    try {
      unlinkSync(lockPath)
    } catch {
      return null
    }
    tryAcquire()
  }

  return () => {
    try {
      const ownerPid = Number(readFileSync(lockPath, 'utf8').split(/\r?\n/)[0])
      if (ownerPid === process.pid) unlinkSync(lockPath)
    } catch {
      // Best effort cleanup only.
    }
  }
}

async function requestJson(url, { params, retryStatuses = new Set([429, 500, 502, 503, 504]) } = {}) {
  const target = new URL(url)
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value))
  })
  let lastError = null
  const maxAttempts = 7
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(target)
      if (retryStatuses.has(response.status) && attempt < maxAttempts - 1) {
        const retryAfterSeconds = Number(response.headers.get('retry-after'))
        const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : null
        const backoffMs = response.status === 429 ? 2500 * (attempt + 1) : 500 * (attempt + 1)
        await sleep(retryAfterMs ?? backoffMs)
        continue
      }
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText} for ${target}`)
        error.status = response.status
        throw error
      }
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts - 1) break
      await sleep(500 * (attempt + 1))
    }
  }
  throw lastError
}

function numberFrom(value, fallback = null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseJsonList(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function std(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1))
}

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct)))]
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function isoDateFromTimestamp(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? isoDate(new Date(parsed)) : ''
}

function shiftIsoDateMonths(dateString, months) {
  const parsed = Date.parse(`${dateString}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return dateString
  const date = new Date(parsed)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const month = date.getUTCMonth()
  const year = date.getUTCFullYear()
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDayOfMonth))
  return isoDate(date)
}

function daysBetween(startDate, endDate) {
  const startTime = Date.parse(startDate)
  const endTime = Date.parse(endDate)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 1
  return Math.max(1, (endTime - startTime) / millisecondsPerDay)
}

function inferYear(month, day, explicitYear, fallbackYear) {
  if (explicitYear) return Number(explicitYear)
  if (fallbackYear) return fallbackYear
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day))
  if (candidate.getTime() < now.getTime() - 30 * 86400000) return now.getUTCFullYear() + 1
  return now.getUTCFullYear()
}

function parseIsoYear(value) {
  const match = String(value ?? '').match(/^(20\d{2})-/)
  return match ? Number(match[1]) : null
}

function deadlineFromText(text, fallbackYear) {
  if (!text) return { date: '', phrase: '' }
  const dateMatch = String(text).match(datePhrasePattern)
  if (dateMatch?.groups) {
    const month = monthNumbers.get(dateMatch.groups.month.toLowerCase().replace('.', ''))
    const day = Number(dateMatch.groups.day)
    const year = inferYear(month, day, dateMatch.groups.year, fallbackYear)
    if (month && day >= 1 && day <= 31) {
      return {
        date: isoDate(new Date(Date.UTC(year, month - 1, day))),
        phrase: dateMatch[0],
      }
    }
  }
  const monthYearMatch = String(text).match(monthYearPattern)
  if (monthYearMatch?.groups) {
    const month = monthNumbers.get(monthYearMatch.groups.month.toLowerCase().replace('.', ''))
    if (month) {
      return {
        date: isoDate(new Date(Date.UTC(Number(monthYearMatch.groups.year), month - 1, 1))),
        phrase: monthYearMatch[0],
      }
    }
  }
  const isoMatch = String(text).match(isoDatePattern)
  if (isoMatch && timeBoundPattern.test(text)) {
    return {
      date: isoDate(new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])))),
      phrase: isoMatch[0],
    }
  }
  return { date: '', phrase: '' }
}

function firstDeadline(texts, fallbackYear) {
  for (const text of texts) {
    const deadline = deadlineFromText(text, fallbackYear)
    if (deadline.date) return deadline
  }
  return { date: '', phrase: '' }
}

function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTimeDecayQuestion(text) {
  const normalized = normalizeText(text)
  if (!normalized || excludedQuestionPattern.test(normalized)) return false
  return timeBoundPattern.test(normalized)
}

async function fetchKalshiMarkets() {
  const markets = []
  let cursor = null
  let page = 0
  while (true) {
    const payload = await requestJson(`${kalshiBaseUrl}/markets`, {
      params: {
        limit: 1000,
        status: 'open',
        mve_filter: 'exclude',
        cursor,
      },
    })
    const batch = payload.markets ?? []
    markets.push(...batch)
    page += 1
    console.log(`kalshi page ${page}: ${batch.length} markets, total ${markets.length}`)
    cursor = payload.cursor
    if (!cursor || (config.kalshiPages && page >= config.kalshiPages)) break
    await sleep(25)
  }
  return markets
}

async function fetchPolymarketMarkets() {
  const markets = []
  const limit = 100
  let offset = 0
  let page = 0
  while (true) {
    try {
      const batch = await requestJson(`${polymarketGammaUrl}/markets`, {
        params: { active: 'true', closed: 'false', limit, offset },
      })
      if (!Array.isArray(batch)) throw new Error(`Unexpected Polymarket payload at offset ${offset}`)
      markets.push(...batch)
      page += 1
      console.log(`polymarket page ${page}: ${batch.length} markets, total ${markets.length}`)
      if (batch.length < limit || (config.polymarketPages && page >= config.polymarketPages)) break
      offset += limit
      await sleep(25)
    } catch (error) {
      if (error.status === 422 && markets.length) {
        console.log(`polymarket pagination stopped at offset ${offset}: 422 boundary`)
        break
      }
      throw error
    }
  }
  return markets
}

function kalshiTimeDecayRow(market) {
  const title = [market.title, market.yes_sub_title].filter(Boolean).join(' ')
  const fullText = [title, market.rules_primary, market.rules_secondary].filter(Boolean).join(' ')
  if (!isTimeDecayQuestion(fullText)) return null
  const closeDate = isoDateFromTimestamp(market.close_time)
  const fallbackYear = parseIsoYear(market.close_time)
  const deadline = firstDeadline([market.yes_sub_title, market.title, market.rules_primary, market.rules_secondary], fallbackYear)
  if (!deadline.date) return null
  const yesBid = numberFrom(market.yes_bid_dollars)
  const yesAsk = numberFrom(market.yes_ask_dollars)
  if (yesBid === null || yesAsk === null) return null
  const closeTime = market.close_time || market.expected_expiration_time || market.expiration_time || ''
  return {
    venue: 'kalshi',
    marketId: market.ticker,
    eventKey: market.event_ticker || '',
    question: title || market.ticker,
    deadline: deadline.date,
    yesBid,
    yesAsk,
    yesPrice: round((yesBid + yesAsk) / 2, 4),
    volume24h: numberFrom(market.volume_24h_fp, 0),
    liquidity: numberFrom(market.liquidity_dollars, 0),
    closeTime,
    updatedTime: market.updated_time || '',
    sourceRef: market.event_ticker || '',
    rawDeadlinePhrase: deadline.phrase,
    deadlineMatchesClose: closeDate ? Math.abs(Date.parse(deadline.date) - Date.parse(closeDate)) <= 2 * 86400000 : false,
    yesTokenId: '',
  }
}

function polymarketTimeDecayRow(market) {
  const outcomes = parseJsonList(market.outcomes)
  const tokenIds = parseJsonList(market.clobTokenIds)
  if (outcomes.length !== 2 || tokenIds.length !== 2) return null
  const outcomeMap = new Map(outcomes.map((outcome, index) => [String(outcome).trim().toLowerCase(), String(tokenIds[index])]))
  if (!outcomeMap.has('yes') || !outcomeMap.has('no')) return null
  const question = [market.question, market.groupItemTitle].filter(Boolean).join(' ')
  const fullText = [question, market.description].filter(Boolean).join(' ')
  if (!isTimeDecayQuestion(fullText)) return null
  const deadline = firstDeadline([market.question, market.groupItemTitle, market.description], parseIsoYear(market.endDate))
  if (!deadline.date) return null
  const yesBid = numberFrom(market.bestBid)
  const yesAsk = numberFrom(market.bestAsk)
  const yesPrice = yesBid !== null && yesAsk !== null ? round((yesBid + yesAsk) / 2, 4) : numberFrom(market.lastTradePrice)
  if (yesPrice === null) return null
  return {
    venue: 'polymarket',
    marketId: String(market.id),
    eventKey: Array.isArray(market.events) ? market.events[0]?.slug || market.events[0]?.ticker || '' : market.slug || '',
    question: question || market.slug || String(market.id),
    deadline: deadline.date,
    yesBid,
    yesAsk,
    yesPrice,
    volume24h: numberFrom(market.volume24hr, 0),
    liquidity: numberFrom(market.liquidityNum ?? market.liquidityClob, 0),
    closeTime: market.endDate || '',
    updatedTime: market.updatedAt || '',
    sourceRef: market.slug || '',
    rawDeadlinePhrase: deadline.phrase,
    deadlineMatchesClose: true,
    yesTokenId: outcomeMap.get('yes'),
  }
}

function historyRank(row) {
  const liquidityScore = Math.log10(Math.max(1, row.liquidity ?? 0) + 1)
  const volumeScore = Math.log10(Math.max(1, row.volume24h ?? 0) + 1)
  const price = row.yesPrice ?? row.yesBid ?? 0
  const priceScore = price >= 0.05 && price <= 0.9 ? 2 : 0
  const deadlineScore = row.deadlineMatchesClose ? 1 : 0
  return liquidityScore * 2 + volumeScore + priceScore + deadlineScore
}

function selectedHistoryMarkets(rows) {
  const futureRows = rows
    .filter((row) => Date.parse(row.deadline) > now.getTime())
    .sort((left, right) => historyRank(right) - historyRank(left) || left.deadline.localeCompare(right.deadline))
  const kalshi = futureRows
    .filter((row) => row.venue === 'kalshi' && row.eventKey)
    .slice(0, config.maxKalshiHistoricalMarkets)
  const polymarket = futureRows
    .filter((row) => row.venue === 'polymarket' && row.yesTokenId)
    .slice(0, config.maxPolymarketHistoricalMarkets)
  return [...kalshi, ...polymarket]
}

function observationBase(row, ts, values) {
  const observedAt = new Date(ts * 1000).toISOString()
  const observedDate = observedAt.slice(0, 10)
  const yesPrice = values.yesPrice ?? (values.yesBid !== null && values.yesAsk !== null ? (values.yesBid + values.yesAsk) / 2 : null)
  if (yesPrice === null) return null
  return {
    ts,
    observedAt,
    observedDate,
    venue: row.venue,
    marketId: row.marketId,
    eventKey: row.eventKey,
    question: row.question,
    deadline: row.deadline,
    yesBid: values.yesBid,
    yesAsk: values.yesAsk,
    yesPrice,
    daysToDeadline: daysBetween(observedAt, `${row.deadline}T23:59:59Z`),
    liquidity: row.liquidity,
    volume24h: row.volume24h,
  }
}

async function kalshiMarketHistory(row, startTs, endTs) {
  const observations = []
  const maxWindowSeconds = 30 * 86400
  for (let chunkStart = startTs; chunkStart < endTs; chunkStart += maxWindowSeconds) {
    const chunkEnd = Math.min(endTs, chunkStart + maxWindowSeconds)
    let payload = null
    try {
      payload = await requestJson(`${kalshiBaseUrl}/series/${row.eventKey}/markets/${row.marketId}/candlesticks`, {
        params: {
          start_ts: chunkStart,
          end_ts: chunkEnd,
          period_interval: config.candleIntervalMinutes,
        },
      })
    } catch (error) {
      if (error.status !== 400) throw error
      continue
    }
    for (const candle of payload.candlesticks ?? []) {
      const yesBid = numberFrom(candle.yes_bid?.close_dollars)
      const yesAsk = numberFrom(candle.yes_ask?.close_dollars)
      if (yesBid === null || yesAsk === null) continue
      const observation = observationBase(row, Number(candle.end_period_ts), {
        yesBid,
        yesAsk,
        yesPrice: round((yesBid + yesAsk) / 2, 4),
      })
      if (observation && observation.daysToDeadline > 0) observations.push(observation)
    }
    await sleep(100)
  }
  return observations
}

async function polymarketHistory(row, startTs, endTs) {
  const intervalSeconds = config.candleIntervalMinutes * 60
  const observations = []
  const maxWindowSeconds = 7 * 86400
  for (let chunkStart = startTs; chunkStart < endTs; chunkStart += maxWindowSeconds) {
    const chunkEnd = Math.min(endTs, chunkStart + maxWindowSeconds)
    let payload = null
    try {
      payload = await requestJson(`${polymarketClobUrl}/prices-history`, {
        params: {
          market: row.yesTokenId,
          startTs: chunkStart,
          endTs: chunkEnd,
          fidelity: config.candleIntervalMinutes,
        },
      })
    } catch (error) {
      if (error.status !== 400) throw error
      continue
    }
    const byBucket = new Map()
    for (const point of payload.history ?? []) {
      const price = numberFrom(point.p)
      if (price === null) continue
      const bucket = Math.floor(Number(point.t) / intervalSeconds) * intervalSeconds
      byBucket.set(bucket, price)
    }
    for (const [ts, price] of byBucket.entries()) {
      const observation = observationBase(row, ts, {
        yesBid: price,
        yesAsk: price,
        yesPrice: price,
      })
      if (observation && observation.daysToDeadline > 0) observations.push(observation)
    }
    await sleep(10)
  }
  return observations
}

async function buildHistoricalObservations(markets) {
  const endTs = Math.floor(now.getTime() / 1000)
  const startTs = Math.floor((now.getTime() - config.historyDays * 86400000) / 1000)
  const observations = []
  const failures = []
  for (let index = 0; index < markets.length; index += 1) {
    const market = markets[index]
    if (index % 10 === 0) console.log(`time-decay history ${index + 1}/${markets.length}`)
    try {
      const rows =
        market.venue === 'kalshi'
          ? await kalshiMarketHistory(market, startTs, endTs)
          : await polymarketHistory(market, startTs, endTs)
      observations.push(...rows)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({
        venue: market.venue,
        marketId: market.marketId,
        question: market.question,
        message,
      })
      console.log(`time-decay history failed ${market.venue}:${market.marketId}: ${message}`)
    }
    await sleep(25)
  }
  return {
    observations: observations.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.marketId.localeCompare(right.marketId)),
    marketsRequested: markets.length,
    marketsSucceeded: markets.length - failures.length,
    failures,
  }
}

function splitDatesFromObservations(observations) {
  const dates = [...new Set(observations.map((observation) => observation.observedDate).filter(Boolean))].sort()
  const minDate = dates[0] ?? isoDate(now)
  const maxDate = dates.at(-1) ?? isoDate(now)
  const requestedHoldoutStart = shiftIsoDateMonths(maxDate, -config.holdoutMonths)
  const requestedHoldoutIndex = dates.findIndex((date) => date >= requestedHoldoutStart)
  const fallbackHoldoutIndex = Math.floor(dates.length * 0.75)
  const minimumPreHoldoutDays = Math.max(30, Math.min(75, config.validationDays))
  const holdoutStartIndex =
    requestedHoldoutIndex >= minimumPreHoldoutDays
      ? requestedHoldoutIndex
      : Math.max(1, Math.min(fallbackHoldoutIndex, dates.length - 1))
  const validationSize = Math.max(1, Math.min(config.validationDays, Math.floor(holdoutStartIndex * 0.35), holdoutStartIndex - 1))
  const validationStartIndex = Math.max(1, holdoutStartIndex - validationSize)
  return {
    dates,
    minDate,
    maxDate,
    requestedHoldoutStart,
    actualHoldoutDays: Math.max(0, dates.length - holdoutStartIndex),
    splitDates: {
      trainEnd: dates[validationStartIndex - 1] ?? minDate,
      validationEnd: dates[holdoutStartIndex - 1] ?? dates[validationStartIndex] ?? maxDate,
      holdoutStart: dates[holdoutStartIndex] ?? maxDate,
    },
  }
}

function splitForDate(date, splitDates) {
  if (date >= splitDates.holdoutStart) return 'holdout'
  if (date > splitDates.trainEnd && date <= splitDates.validationEnd) return 'validation'
  return 'train'
}

function observationsByMarket(observations) {
  const byMarket = new Map()
  for (const observation of observations) {
    const rows = byMarket.get(observation.marketId) ?? []
    rows.push(observation)
    byMarket.set(observation.marketId, rows)
  }
  for (const rows of byMarket.values()) rows.sort((left, right) => left.ts - right.ts)
  return byMarket
}

function firstObservationAtOrAfter(rows, targetTs) {
  let left = 0
  let right = rows.length - 1
  let match = null
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (rows[mid].ts >= targetTs) {
      match = rows[mid]
      right = mid - 1
    } else {
      left = mid + 1
    }
  }
  return match
}

function lastObservationAtOrBefore(rows, targetTs) {
  let left = 0
  let right = rows.length - 1
  let match = null
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (rows[mid].ts <= targetTs) {
      match = rows[mid]
      left = mid + 1
    } else {
      right = mid - 1
    }
  }
  return match
}

function enrichedObservations(observations, byMarket) {
  for (const observation of observations) {
    const rows = byMarket.get(observation.marketId) ?? []
    const prior = lastObservationAtOrBefore(rows, observation.ts - 24 * secondsPerHour)
    observation.yesPriceCents = round(observation.yesPrice * 100, 4)
    observation.recentChangeCents = prior ? round((observation.yesPrice - prior.yesPrice) * 100, 4) : null
  }
  return observations
}

function exitObservationFor(entry, byMarket, holdHours) {
  return firstObservationAtOrAfter(byMarket.get(entry.marketId) ?? [], entry.ts + holdHours * secondsPerHour)
}

function venueAllowed(candidate, venue) {
  return candidate.venueSet === 'all' || candidate.venueSet === venue
}

function observationPassesCandidate(observation, candidate) {
  if (!venueAllowed(candidate, observation.venue)) return false
  if (observation.daysToDeadline < candidate.minDaysToDeadline || observation.daysToDeadline > candidate.maxDaysToDeadline) return false
  if (observation.yesPriceCents < candidate.minYesPriceCents || observation.yesPriceCents > candidate.maxYesPriceCents) return false
  if (candidate.maxRecentRiseCents < 99) {
    if (observation.recentChangeCents === null) return false
    if (observation.recentChangeCents > candidate.maxRecentRiseCents) return false
  }
  return true
}

function timeDecayTradeFromObservation(entry, exit, candidate) {
  const entryYes = entry.venue === 'kalshi' ? entry.yesBid : entry.yesPrice
  const exitYes = entry.venue === 'kalshi' ? exit.yesAsk : exit.yesPrice
  if (entryYes === null || exitYes === null) return null
  const capitalAtRisk = 1 - entryYes
  if (!Number.isFinite(capitalAtRisk) || capitalAtRisk <= 0.01) return null
  const grossDecayCents = round((entryYes - exitYes) * 100, 4)
  const netDecayCents = round(grossDecayCents - config.feeHaircutCents, 4)
  const packageReturnPct = (netDecayCents / 100 / capitalAtRisk) * 100
  const grossPackageReturnPct = (grossDecayCents / 100 / capitalAtRisk) * 100
  return {
    ...entry,
    exitObservedAt: exit.observedAt,
    exitObservedDate: exit.observedDate,
    exitYesPrice: exitYes,
    holdHours: candidate.holdHours,
    capitalAtRisk,
    grossDecayCents,
    netDecayCents,
    grossPackageReturnPct,
    packageReturnPct,
    netReturnPct: packageReturnPct * (config.capitalAllocationPct / 100),
  }
}

function selectTradesForCandidate(observations, byMarket, candidate, splitDates) {
  const selected = []
  const lastEntryByMarket = new Map()
  for (const observation of observations) {
    if (!observationPassesCandidate(observation, candidate)) continue
    const previousTs = lastEntryByMarket.get(observation.marketId)
    if (previousTs && (observation.ts - previousTs) / 3600 < candidate.minSpacingHours) continue
    const exit = exitObservationFor(observation, byMarket, candidate.holdHours)
    if (!exit || exit.ts > Date.parse(`${observation.deadline}T23:59:59Z`) / 1000) continue
    const markedTrade = timeDecayTradeFromObservation(observation, exit, candidate)
    if (!markedTrade) continue
    lastEntryByMarket.set(observation.marketId, observation.ts)
    selected.push({
      ...markedTrade,
      split: splitForDate(observation.observedDate, splitDates),
    })
  }
  return selected
}

function rowEntryDate(row) {
  return row.entryTradeDate ?? row.observedDate ?? row.signalDate ?? ''
}

function rowExitDate(row) {
  return row.exitTradeDate ?? row.exitObservedDate ?? rowEntryDate(row)
}

function rowNetReturnPct(row) {
  return numberFrom(row.netReturnPct, 0) ?? 0
}

function rowAllocationPct(row) {
  return numberFrom(row.portfolioAllocationPct, config.capitalAllocationPct) ?? config.capitalAllocationPct
}

function timestampFrom(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : null
}

function holdHoursForRow(row) {
  const holdHours = numberFrom(row.holdHours)
  return holdHours !== null && holdHours > 0 ? holdHours : null
}

function rowEntryTime(row) {
  return timestampFrom(row.observedAt) ?? timestampFrom(row.entryObservedAt) ?? timestampFrom(rowEntryDate(row))
}

function rowExitTime(row) {
  const explicitExit = timestampFrom(row.exitObservedAt)
  if (explicitExit !== null) return explicitExit
  const entryTime = rowEntryTime(row)
  const holdHours = holdHoursForRow(row)
  if (entryTime !== null && holdHours !== null) return entryTime + holdHours * millisecondsPerHour
  return timestampFrom(rowExitDate(row))
}

function elapsedDaysBetweenTimes(startTime, endTime) {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null
  return (endTime - startTime) / millisecondsPerDay
}

function holdDaysForRow(row) {
  const elapsedDays = elapsedDaysBetweenTimes(rowEntryTime(row), rowExitTime(row))
  if (elapsedDays !== null) return elapsedDays
  const holdHours = holdHoursForRow(row)
  if (holdHours !== null) return holdHours / 24
  return daysBetween(rowEntryDate(row), rowExitDate(row))
}

function metricRowsForTrades(trades) {
  return trades.map((trade) => ({
    ...trade,
    entryTradeDate: trade.observedDate,
    exitTradeDate: trade.exitObservedDate ?? trade.observedDate,
    portfolioAllocationPct: config.capitalAllocationPct,
  }))
}

function rowDateBounds(rows) {
  const entryTimes = rows.map(rowEntryTime).filter((value) => value !== null)
  const exitTimes = rows.map(rowExitTime).filter((value) => value !== null)
  const firstEntryTime = entryTimes.length ? Math.min(...entryTimes) : null
  const lastExitTime = exitTimes.length ? Math.max(...exitTimes) : firstEntryTime
  const firstEntry = firstEntryTime === null ? '' : isoDate(new Date(firstEntryTime))
  const lastExit = lastExitTime === null ? firstEntry : isoDate(new Date(lastExitTime))
  const elapsedDays = firstEntryTime !== null && lastExitTime !== null
    ? elapsedDaysBetweenTimes(firstEntryTime, lastExitTime) ?? 1
    : 1
  return {
    firstEntry,
    lastExit,
    elapsedDays,
    firstEntryTime,
    dailyBucketCount: Math.max(1, Math.ceil(elapsedDays)),
  }
}

function additiveDailyReturns(rows) {
  if (!rows.length) return []
  const { firstEntryTime, dailyBucketCount } = rowDateBounds(rows)
  if (firstEntryTime === null) return []
  const returns = Array.from({ length: dailyBucketCount }, () => 0)
  for (const row of rows) {
    const entryTime = rowEntryTime(row)
    const exitTime = rowExitTime(row)
    if (entryTime === null || exitTime === null || exitTime <= entryTime) continue
    const holdDays = holdDaysForRow(row)
    const startOffset = Math.max(0, Math.floor((entryTime - firstEntryTime) / millisecondsPerDay))
    const endOffset = Math.min(dailyBucketCount, Math.ceil((exitTime - firstEntryTime) / millisecondsPerDay))
    const dailyReturn = rowNetReturnPct(row) / 100 / holdDays
    for (let offset = startOffset; offset < endOffset; offset += 1) {
      const bucketStart = firstEntryTime + offset * millisecondsPerDay
      const bucketEnd = bucketStart + millisecondsPerDay
      const overlapDays = Math.max(0, Math.min(exitTime, bucketEnd) - Math.max(entryTime, bucketStart)) / millisecondsPerDay
      returns[offset] += dailyReturn * overlapDays
    }
  }
  return returns
}

function additiveMetricsFromRows(rows) {
  const rowReturns = rows.map((row) => rowNetReturnPct(row) / 100)
  const dailyReturns = additiveDailyReturns(rows)
  const negativeDailyReturns = dailyReturns.filter((value) => value < 0)
  let cumulativeReturn = 0
  let peak = 0
  let maxDrawdownPct = 0
  dailyReturns.forEach((value) => {
    cumulativeReturn += value
    peak = Math.max(peak, cumulativeReturn)
    maxDrawdownPct = Math.min(maxDrawdownPct, (cumulativeReturn - peak) * 100)
  })
  const { firstEntry, lastExit, elapsedDays } = rowDateBounds(rows)
  const annualVol = std(dailyReturns) * Math.sqrt(calendarDaysPerYear)
  const downsideVol = std(negativeDailyReturns) * Math.sqrt(calendarDaysPerYear)
  const var95 = percentile(dailyReturns, 0.05)
  const cvarSlice = dailyReturns.filter((value) => value <= var95)
  const totalReturnPct = rows.reduce((sum, row) => sum + rowNetReturnPct(row), 0)
  const cagrPct = totalReturnPct <= -100 ? -100 : ((1 + totalReturnPct / 100) ** (calendarDaysPerYear / elapsedDays) - 1) * 100
  const grossWins = rowReturns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const grossLosses = Math.abs(rowReturns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
  const exposureDays = rows.reduce((sum, row) => sum + holdDaysForRow(row) * rowAllocationPct(row), 0)
  return {
    totalReturnPct: round(totalReturnPct, 2),
    cagrPct: round(cagrPct, 2),
    annualVolPct: round(annualVol * 100, 2),
    sharpe: round(annualVol ? (mean(dailyReturns) * calendarDaysPerYear) / annualVol : 0, 2),
    sortino: round(downsideVol ? (mean(dailyReturns) * calendarDaysPerYear) / downsideVol : 0, 2),
    maxDrawdownPct: round(maxDrawdownPct, 2),
    calmar: round(Math.abs(maxDrawdownPct) ? cagrPct / Math.abs(maxDrawdownPct) : 0, 2),
    winRatePct: round(rowReturns.length ? (rowReturns.filter((value) => value > 0).length / rowReturns.length) * 100 : 0, 1),
    profitFactor: round(grossLosses ? grossWins / grossLosses : grossWins ? 999 : 0, 2),
    tradeCount: rows.length,
    exposurePct: round(exposureDays / Math.max(elapsedDays, 1), 1),
    turnover: rows.length,
    var95Pct: round(var95 * 100, 2),
    cvar95Pct: round(mean(cvarSlice) * 100, 2),
    averageDailyPnlPct: round(mean(dailyReturns) * 100, 3),
    firstEntry,
    lastExit,
    averageHoldDays: round(mean(rows.map(holdDaysForRow)), 1),
    averageTradeReturnPct: round(mean(rows.map(rowNetReturnPct)), 3),
  }
}

function compoundReturnPct(trades) {
  return round(trades.reduce((sum, trade) => sum + trade.netReturnPct, 0), 2)
}

function splitEdgesForTrades(trades) {
  return {
    train: compoundReturnPct(trades.filter((trade) => trade.split === 'train')),
    validation: compoundReturnPct(trades.filter((trade) => trade.split === 'validation')),
    holdout: compoundReturnPct(trades.filter((trade) => trade.split === 'holdout')),
    all: compoundReturnPct(trades),
  }
}

function splitMetricsForTrades(trades) {
  const rows = metricRowsForTrades(trades)
  return {
    train: additiveMetricsFromRows(rows.filter((trade) => trade.split === 'train')),
    validation: additiveMetricsFromRows(rows.filter((trade) => trade.split === 'validation')),
    holdout: additiveMetricsFromRows(rows.filter((trade) => trade.split === 'holdout')),
    all: additiveMetricsFromRows(rows),
  }
}

function candidateConfigs() {
  const configs = []
  for (const venueSet of ['all', 'kalshi', 'polymarket']) {
    for (const holdHours of [1, 6, 24]) {
      for (const minSpacingHours of [6, 24]) {
        for (const minDaysToDeadline of [2, 7]) {
          for (const maxDaysToDeadline of [30, 180, 730]) {
            if (minDaysToDeadline >= maxDaysToDeadline) continue
            for (const [minYesPriceCents, maxYesPriceCents] of [
              [5, 70],
              [15, 80],
              [25, 95],
            ]) {
              for (const maxRecentRiseCents of [0, 3, 999]) {
                configs.push({
                  venueSet,
                  holdHours,
                  minSpacingHours,
                  minDaysToDeadline,
                  maxDaysToDeadline,
                  minYesPriceCents,
                  maxYesPriceCents,
                  maxRecentRiseCents,
                })
              }
            }
          }
        }
      }
    }
  }
  return configs
}

function buildCandidates(observations, byMarket, splitDates) {
  const candidates = []
  for (const candidate of candidateConfigs()) {
    const recentLabel = candidate.maxRecentRiseCents >= 99 ? 'any' : `${candidate.maxRecentRiseCents}c`
    const candidateId = `decay-${candidate.venueSet}-yes-${candidate.minYesPriceCents}-${candidate.maxYesPriceCents}c-days-${candidate.minDaysToDeadline}-${candidate.maxDaysToDeadline}-rise-${recentLabel}-spacing-${candidate.minSpacingHours}h-hold-${candidate.holdHours}h`
    const trades = selectTradesForCandidate(observations, byMarket, candidate, splitDates)
    const splitEdges = splitEdgesForTrades(trades)
    const splitMetrics = splitMetricsForTrades(trades)
    const trainTradeCount = trades.filter((trade) => trade.split === 'train').length
    const validationTradeCount = trades.filter((trade) => trade.split === 'validation').length
    const preHoldoutTradeCount = trainTradeCount + validationTradeCount
    const holdoutTradeCount = trades.filter((trade) => trade.split === 'holdout').length
    const trainValidationReturnPct = round(splitMetrics.train.totalReturnPct + splitMetrics.validation.totalReturnPct, 4)
    const trainValidationScore = round(
      splitMetrics.validation.totalReturnPct * 1.2 +
        splitMetrics.train.totalReturnPct * 0.35 +
        Math.min(splitMetrics.validation.sharpe, 5) * 0.75 +
        Math.min(splitMetrics.train.sharpe, 5) * 0.25 +
        Math.max(splitMetrics.validation.maxDrawdownPct, -25) * 0.1,
      4,
    )
    const selectionEligible =
      trainTradeCount >= config.minTrainTrades &&
      validationTradeCount >= config.minValidationTrades &&
      splitMetrics.train.totalReturnPct > 0 &&
      splitMetrics.validation.totalReturnPct > 0 &&
      splitMetrics.train.maxDrawdownPct > -35 &&
      splitMetrics.validation.maxDrawdownPct > -25
    candidates.push({
      candidateId,
      venueSet: candidate.venueSet,
      minYesPriceCents: candidate.minYesPriceCents,
      maxYesPriceCents: candidate.maxYesPriceCents,
      minDaysToDeadline: candidate.minDaysToDeadline,
      maxDaysToDeadline: candidate.maxDaysToDeadline,
      maxRecentRiseCents: candidate.maxRecentRiseCents >= 99 ? '' : candidate.maxRecentRiseCents,
      feeHaircutCents: config.feeHaircutCents,
      minSpacingHours: candidate.minSpacingHours,
      holdHours: candidate.holdHours,
      eligible: selectionEligible && holdoutTradeCount >= config.minValidationTrades && splitMetrics.holdout.totalReturnPct > 0,
      selectionEligible,
      trainValidationRank: 0,
      trainValidationScore,
      trainValidationReturnPct,
      trainTradeCount,
      validationTradeCount,
      preHoldoutTradeCount,
      trainEdgePct: splitEdges.train,
      validationEdgePct: splitEdges.validation,
      holdoutEdgePct: splitEdges.holdout,
      allEdgePct: splitEdges.all,
      trainReturnPct: splitMetrics.train.totalReturnPct,
      validationReturnPct: splitMetrics.validation.totalReturnPct,
      holdoutReturnPct: splitMetrics.holdout.totalReturnPct,
      allReturnPct: splitMetrics.all.totalReturnPct,
      trainAnnualReturnPct: splitMetrics.train.cagrPct,
      validationAnnualReturnPct: splitMetrics.validation.cagrPct,
      holdoutAnnualReturnPct: splitMetrics.holdout.cagrPct,
      allAnnualReturnPct: splitMetrics.all.cagrPct,
      trainSharpe: splitMetrics.train.sharpe,
      validationSharpe: splitMetrics.validation.sharpe,
      holdoutSharpe: splitMetrics.holdout.sharpe,
      trainMaxDrawdownPct: splitMetrics.train.maxDrawdownPct,
      validationMaxDrawdownPct: splitMetrics.validation.maxDrawdownPct,
      holdoutMaxDrawdownPct: splitMetrics.holdout.maxDrawdownPct,
      tradeCount: trades.length,
      holdoutTradeCount,
      averageNetReturnPct: round(mean(trades.map((trade) => trade.netReturnPct)), 4),
      averagePackageReturnPct: round(mean(trades.map((trade) => trade.packageReturnPct)), 4),
      dailyReturnsPct: additiveDailyReturns(metricRowsForTrades(trades)).map((value) => value * 100),
    })
  }
  candidates
    .sort(
      (left, right) =>
        Number(right.selectionEligible) - Number(left.selectionEligible) ||
        Number(right.preHoldoutTradeCount > 0) - Number(left.preHoldoutTradeCount > 0) ||
        right.trainValidationScore - left.trainValidationScore ||
        right.validationReturnPct - left.validationReturnPct ||
        right.preHoldoutTradeCount - left.preHoldoutTradeCount ||
        right.tradeCount - left.tradeCount,
    )
    .forEach((candidate, index) => {
      candidate.trainValidationRank = index + 1
    })
  return candidates
}

function selectedCandidate(candidates) {
  return candidates.find((candidate) => candidate.selectionEligible) ?? null
}

function diagnosticFallbackCandidate(candidates) {
  return (
    candidates.find((candidate) => candidate.preHoldoutTradeCount > 0) ??
    candidates.find((candidate) => candidate.tradeCount > 0) ??
    candidates[0] ??
    null
  )
}

function candidateSelectionConfig(candidate) {
  return {
    venueSet: candidate.venueSet,
    holdHours: candidate.holdHours,
    minSpacingHours: candidate.minSpacingHours,
    minDaysToDeadline: candidate.minDaysToDeadline,
    maxDaysToDeadline: candidate.maxDaysToDeadline,
    minYesPriceCents: candidate.minYesPriceCents,
    maxYesPriceCents: candidate.maxYesPriceCents,
    maxRecentRiseCents: candidate.maxRecentRiseCents === '' ? 999 : Number(candidate.maxRecentRiseCents),
  }
}

function hashString(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededUnit(value) {
  let state = hashString(value) || 1
  state = Math.imul(state, 1664525) + 1013904223
  return (state >>> 0) / 4294967296
}

function meanFromSignFlip(values, iteration, key) {
  if (!values.length) return 0
  return mean(values.map((value, index) => value * (seededUnit(`${key}|${iteration}|${index}`) < 0.5 ? -1 : 1)))
}

function blockBootstrapMean(values, iteration, blockLength, key) {
  if (!values.length) return 0
  const sampled = []
  while (sampled.length < values.length) {
    const startIndex = Math.floor(seededUnit(`${key}|${iteration}|${sampled.length}`) * values.length)
    for (let offset = 0; offset < blockLength && sampled.length < values.length; offset += 1) {
      sampled.push(values[(startIndex + offset) % values.length] ?? 0)
    }
  }
  return mean(sampled)
}

function percentileSummary(values) {
  return {
    p05: round(percentile(values, 0.05), 4),
    p50: round(percentile(values, 0.5), 4),
    p95: round(percentile(values, 0.95), 4),
  }
}

function selectedScreenRealityCheck(trades, observations, candidate, dates, candidates, comparisonLabel = 'selected') {
  const selectedDailyReturnsPct = additiveDailyReturns(metricRowsForTrades(trades)).map((value) => value * 100)
  const candidateFamily = candidates
    .filter((entry) => entry.trainTradeCount >= config.minTrainTrades && entry.validationTradeCount >= config.minValidationTrades && entry.dailyReturnsPct?.length)
    .slice(0, 250)
    .map((entry) => ({
      candidateId: entry.candidateId,
      observedMeanDailyEdgePct: mean(entry.dailyReturnsPct),
      values: entry.dailyReturnsPct,
    }))
  const family = candidateFamily.length
    ? candidateFamily
    : [{ candidateId: candidate.candidateId, observedMeanDailyEdgePct: mean(selectedDailyReturnsPct), values: selectedDailyReturnsPct }]
  const iterations = config.monteCarloIterations
  const blockLength = Math.max(1, Math.min(10, Math.round(Math.sqrt(Math.max(selectedDailyReturnsPct.length, 1)))))
  const observedAverageDailyEdgePct = mean(selectedDailyReturnsPct)
  const observedBootstrapMeans = []
  const nullSelectedMeans = []
  const nullMaxMeans = []
  let singleCandidateExtreme = 1
  let selectionAdjustedExtreme = 1

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const bootstrapMean = blockBootstrapMean(selectedDailyReturnsPct, iteration, blockLength, `${candidate.candidateId}|bootstrap`)
    const nullSelectedMean = meanFromSignFlip(selectedDailyReturnsPct, iteration, `${candidate.candidateId}|null`)
    const nullMaxMean = Math.max(...family.map((entry) => meanFromSignFlip(entry.values, iteration, `${entry.candidateId}|family-null`)))
    observedBootstrapMeans.push(bootstrapMean)
    nullSelectedMeans.push(nullSelectedMean)
    nullMaxMeans.push(nullMaxMean)
    if (nullSelectedMean >= observedAverageDailyEdgePct) singleCandidateExtreme += 1
    if (nullMaxMean >= observedAverageDailyEdgePct) selectionAdjustedExtreme += 1
  }

  const bestObservedCandidate = family
    .slice()
    .sort((left, right) => right.observedMeanDailyEdgePct - left.observedMeanDailyEdgePct)[0]

  return {
    method: 'time-decay-marked-quote-exit-block-bootstrap',
    comparison: `${comparisonLabel} buy-NO marked quote-exit rows versus sign-flipped candidate-family null`,
    alternative: 'positive mean daily marked edge after fixed train/validation selection',
    pValue: round(selectionAdjustedExtreme / (iterations + 1), 4),
    singleCandidatePValue: round(singleCandidateExtreme / (iterations + 1), 4),
    selectionAdjustedPValue: round(selectionAdjustedExtreme / (iterations + 1), 4),
    observedAverageDailyEdgePct: round(observedAverageDailyEdgePct, 4),
    observedAnnualizedEdgePct: round(observedAverageDailyEdgePct * calendarDaysPerYear, 2),
    dailyActiveVolPct: round(std(selectedDailyReturnsPct), 4),
    standardErrorDailyEdgePct: round(std(selectedDailyReturnsPct) / Math.sqrt(Math.max(selectedDailyReturnsPct.length, 1)), 4),
    meanConfidenceIntervalDailyEdgePct: percentileSummary(observedBootstrapMeans),
    nullConfidenceIntervalDailyEdgePct: percentileSummary(nullSelectedMeans),
    nullMaxMeanDailyEdgePct: percentileSummary(nullMaxMeans),
    candidateFamilySize: family.length,
    bestObservedCandidateId: bestObservedCandidate?.candidateId ?? null,
    bestObservedAverageDailyEdgePct: bestObservedCandidate ? round(bestObservedCandidate.observedMeanDailyEdgePct, 4) : null,
    sampleCount: observations.length,
    selectedSampleCount: trades.length,
    activeOverlayDays: new Set(trades.map((trade) => trade.observedDate)).size,
    minimumResolvablePValue: round(1 / (iterations + 1), 4),
    iterations,
    blockLength,
    positiveSelectedReturnRows: trades.filter((trade) => trade.netReturnPct > 0).length,
    negativeSelectedReturnRows: trades.filter((trade) => trade.netReturnPct < 0).length,
    diagnosticOnly: comparisonLabel !== 'selected',
    limitation:
      `Historical support uses hourly Kalshi bid/ask candles and Polymarket price-history proxies across ${dates.length.toLocaleString()} observed days. Returns are marked to later quotes, not settlement-confirmed fills.`,
  }
}

function qoreTradeRows(trades) {
  let cumulativeReturnPct = 0
  let peakReturnPct = 0
  return trades.map((trade, index) => {
    const netReturnPct = round(trade.netReturnPct, 4)
    cumulativeReturnPct += netReturnPct
    peakReturnPct = Math.max(peakReturnPct, cumulativeReturnPct)
    const equity = initialCapital * (1 + cumulativeReturnPct / 100)
    return {
      strategyId: 'prediction-time-decay-alpha',
      variant: 'time-decay-fade',
      observedAt: trade.observedAt,
      signalDate: trade.observedDate,
      issueDate: trade.observedDate,
      targetDate: trade.exitObservedDate ?? trade.observedDate,
      entryTradeDate: trade.observedDate,
      exitTradeDate: trade.exitObservedDate ?? trade.observedDate,
      targetTradeDate: trade.exitObservedDate ?? trade.observedDate,
      direction: 'short',
      sourceId: trade.venue,
      windowId: 'time-decay-fade',
      thesisKind: 'time-decay-fade',
      leadDays: round((trade.holdHours ?? config.candleIntervalMinutes / 60) / 24, 4),
      holdHours: trade.holdHours ?? config.candleIntervalMinutes / 60,
      confidence: round(Math.min(1, Math.max(0, Math.abs(trade.netDecayCents) / 8)), 4),
      weightedAnomalyF: round(trade.netDecayCents, 4),
      coveragePct: round(trade.daysToDeadline, 4),
      coldCoveragePct: round(trade.yesPriceCents, 4),
      warmCoveragePct: trade.recentChangeCents === null ? '' : round(trade.recentChangeCents, 4),
      extremeCount: 0,
      grossReturnPct: round(trade.grossPackageReturnPct, 4),
      tradingCostPct: config.feeHaircutCents,
      netReturnPct,
      indexReturnPct: 0,
      ungReturnPct: netReturnPct,
      ungPosition: -1,
      equity: round(equity, 2),
      equityPct: round(cumulativeReturnPct, 4),
      drawdownPct: round(cumulativeReturnPct - peakReturnPct, 4),
      rank: index + 1,
      pairId: trade.marketId,
      earlyMarketId: trade.marketId,
      laterMarketId: trade.marketId,
      earlyDeadline: trade.deadline,
      laterDeadline: trade.deadline,
      packageCost: round(trade.capitalAtRisk, 4),
      grossEdgePct: round(trade.grossDecayCents, 4),
      packageReturnPct: round(trade.packageReturnPct, 4),
      portfolioAllocationPct: config.capitalAllocationPct,
      executableSize: '',
      liquidityMin: round(trade.liquidity ?? 0, 4),
      volume24hMin: round(trade.volume24h ?? 0, 4),
      split: trade.split,
    }
  })
}

function currentOpportunities(marketRows, byMarket, selected) {
  return marketRows
    .map((row) => {
      const observedAt = now.toISOString()
      const observedDate = isoDate(now)
      const observedTs = Math.floor(now.getTime() / 1000)
      const yesPrice = row.venue === 'kalshi' ? row.yesBid : row.yesPrice
      const prior = lastObservationAtOrBefore(byMarket.get(row.marketId) ?? [], observedTs - 24 * secondsPerHour)
      const recentChangeCents = prior && Number.isFinite(yesPrice) ? round((yesPrice - prior.yesPrice) * 100, 4) : null
      return {
        ts: observedTs,
        observedAt,
        observedDate,
        venue: row.venue,
        marketId: row.marketId,
        eventKey: row.eventKey,
        question: row.question,
        deadline: row.deadline,
        yesBid: row.yesBid ?? row.yesPrice,
        yesAsk: row.yesAsk ?? row.yesPrice,
        yesPrice,
        yesPriceCents: round(yesPrice * 100, 4),
        recentChangeCents,
        daysToDeadline: daysBetween(observedAt, `${row.deadline}T23:59:59Z`),
        liquidity: row.liquidity,
        volume24h: row.volume24h,
      }
    })
    .filter((row) => observationPassesCandidate(row, selected))
    .sort((left, right) => left.yesPrice - right.yesPrice || (right.liquidity ?? 0) - (left.liquidity ?? 0))
    .slice(0, 25)
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === ',' && !quoted) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }
  values.push(current)
  return values
}

function readCsv(path) {
  const lines = readFileSync(path, 'utf8').trimEnd().split(/\r?\n/)
  const headers = parseCsvLine(lines[0] ?? '')
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function csvNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  return numberFrom(value, fallback)
}

function readCachedSummary() {
  try {
    return JSON.parse(readFileSync(resolve(outputDir, 'run-summary.json'), 'utf8'))
  } catch {
    return null
  }
}

function readCachedMarketRows() {
  return readCsv(resolve(outputDir, 'current-markets.csv')).map((row) => ({
    venue: row.venue,
    marketId: row.marketId,
    eventKey: row.eventKey,
    question: row.question,
    deadline: row.deadline,
    yesBid: csvNumber(row.yesBid),
    yesAsk: csvNumber(row.yesAsk),
    yesPrice: csvNumber(row.yesPrice, 0),
    volume24h: csvNumber(row.volume24h, 0),
    liquidity: csvNumber(row.liquidity, 0),
    closeTime: row.closeTime,
    updatedTime: row.updatedTime,
    sourceRef: row.sourceRef,
    rawDeadlinePhrase: row.rawDeadlinePhrase,
    deadlineMatchesClose: row.deadlineMatchesClose === 'true',
    yesTokenId: '',
  }))
}

function csvHeaderIndexes(headers, requiredHeaders, path) {
  const headerIndexes = new Map(headers.map((header, index) => [header, index]))
  return Object.fromEntries(
    requiredHeaders.map((header) => {
      const index = headerIndexes.get(header)
      if (index === undefined) throw new Error(`${path} is missing required ${header} column`)
      return [header, index]
    }),
  )
}

function createStringInterner() {
  const cache = new Map()
  return (value) => {
    if (!value) return ''
    const cached = cache.get(value)
    if (cached !== undefined) return cached
    cache.set(value, value)
    return value
  }
}

async function readCachedHistoricalObservations() {
  const path = resolve(outputDir, 'historical-observations.csv')
  const observations = []
  const intern = createStringInterner()
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let columns = null
  for await (const line of lines) {
    if (columns === null) {
      columns = csvHeaderIndexes(
        parseCsvLine(line),
        [
          'observedAt',
          'observedDate',
          'venue',
          'marketId',
          'eventKey',
          'question',
          'deadline',
          'yesBid',
          'yesAsk',
          'yesPrice',
          'daysToDeadline',
          'liquidity',
          'volume24h',
        ],
        path,
      )
      continue
    }
    if (!line) continue
    const values = parseCsvLine(line)
    const observedAt = values[columns.observedAt] ?? ''
    observations.push({
      ts: Math.floor(Date.parse(observedAt) / 1000),
      observedAt,
      observedDate: intern(values[columns.observedDate] ?? ''),
      venue: intern(values[columns.venue] ?? ''),
      marketId: intern(values[columns.marketId] ?? ''),
      eventKey: intern(values[columns.eventKey] ?? ''),
      question: intern(values[columns.question] ?? ''),
      deadline: intern(values[columns.deadline] ?? ''),
      yesBid: csvNumber(values[columns.yesBid]),
      yesAsk: csvNumber(values[columns.yesAsk]),
      yesPrice: csvNumber(values[columns.yesPrice], 0),
      daysToDeadline: csvNumber(values[columns.daysToDeadline], 0),
      liquidity: csvNumber(values[columns.liquidity], 0),
      volume24h: csvNumber(values[columns.volume24h], 0),
    })
  }
  return observations
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function waitForWritable(stream, eventName) {
  return new Promise((resolveWait, reject) => {
    const cleanup = () => {
      stream.off(eventName, onEvent)
      stream.off('error', onError)
    }
    const onEvent = () => {
      cleanup()
      resolveWait()
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    stream.once(eventName, onEvent)
    stream.once('error', onError)
  })
}

async function writeCsv(path, rows, fields) {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}`
  const stream = createWriteStream(tempPath)
  const writeLine = async (line) => {
    if (!stream.write(line)) await waitForWritable(stream, 'drain')
  }
  try {
    await writeLine(`${fields.join(',')}\n`)
    for (const row of rows) {
      await writeLine(`${fields.map((field) => csvEscape(row[field])).join(',')}\n`)
    }
    stream.end()
    await waitForWritable(stream, 'finish')
    renameSync(tempPath, path)
  } catch (error) {
    stream.destroy()
    try {
      unlinkSync(tempPath)
    } catch {}
    throw error
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(tempPath, path)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {}
    throw error
  }
}

async function main() {
  const releaseOutputLock = acquireOutputLock()
  if (!releaseOutputLock) {
    process.exitCode = 1
    return
  }
  try {
    mkdirSync(outputDir, { recursive: true })
    const generatedAt = now.toISOString()
    const cachedSummary = config.reuseHistory ? readCachedSummary() : null
    let sourceMarketCounts = {
      kalshiMarkets: 0,
      polymarketMarkets: 0,
    }
    let marketRows = []
    let historicalResult = null

    if (config.reuseHistory) {
      marketRows = readCachedMarketRows()
      const cachedObservations = await readCachedHistoricalObservations()
      sourceMarketCounts = {
        kalshiMarkets: Number(cachedSummary?.data?.kalshiMarkets ?? 0),
        polymarketMarkets: Number(cachedSummary?.data?.polymarketMarkets ?? 0),
      }
      historicalResult = {
        observations: cachedObservations,
        marketsRequested: Number(cachedSummary?.data?.timeDecayHistoricalMarketsRequested ?? cachedSummary?.data?.historicalPairsRequested ?? 0),
        marketsSucceeded: Number(cachedSummary?.data?.timeDecayHistoricalMarketsSucceeded ?? cachedSummary?.data?.historicalPairsSucceeded ?? 0),
        failures: [],
      }
    } else {
      const [kalshiMarkets, polymarketMarkets] = await Promise.all([fetchKalshiMarkets(), fetchPolymarketMarkets()])
      sourceMarketCounts = {
        kalshiMarkets: kalshiMarkets.length,
        polymarketMarkets: polymarketMarkets.length,
      }
      marketRows = [...kalshiMarkets.map(kalshiTimeDecayRow).filter(Boolean), ...polymarketMarkets.map(polymarketTimeDecayRow).filter(Boolean)]
      const historyMarkets = selectedHistoryMarkets(marketRows)
      historicalResult = await buildHistoricalObservations(historyMarkets)
    }

    if (historicalResult.failures.length && !config.allowPartialHistory) {
      const failedIds = historicalResult.failures.map((failure) => `${failure.venue}:${failure.marketId}`).join(', ')
      throw new Error(
        `time-decay historical collection failed for ${historicalResult.failures.length}/${historicalResult.marketsRequested} markets (${failedIds}); ` +
          'rerun with --allow-partial-history or QORE_TIME_DECAY_ALLOW_PARTIAL_HISTORY=1 to write a partial artifact',
      )
    }
    const rawObservations = historicalResult.observations
    const initialByMarket = observationsByMarket(rawObservations)
    const observations = enrichedObservations(rawObservations, initialByMarket)
    const byMarket = observationsByMarket(observations)
    const { dates, minDate, maxDate, requestedHoldoutStart, actualHoldoutDays, splitDates } = splitDatesFromObservations(observations)
    const candidates = buildCandidates(observations, byMarket, splitDates)
    const selected = selectedCandidate(candidates)
    const diagnosticFallback = selected ?? diagnosticFallbackCandidate(candidates)
    const selectedConfig = selected ? candidateSelectionConfig(selected) : null
    const diagnosticConfig = diagnosticFallback ? candidateSelectionConfig(diagnosticFallback) : null
    const selectedTrades = selectedConfig ? selectTradesForCandidate(observations, byMarket, selectedConfig, splitDates) : []
    const diagnosticTrades =
      selected || !diagnosticConfig ? selectedTrades : selectTradesForCandidate(observations, byMarket, diagnosticConfig, splitDates)
    const qoreRows = qoreTradeRows(selectedTrades)
    const selectedMetrics = additiveMetricsFromRows(qoreRows)
    const selectedSplitMetrics = splitMetricsForTrades(selectedTrades)
    const selectedSplitEdges = splitEdgesForTrades(selectedTrades)
    const realityCheck = diagnosticFallback
      ? selectedScreenRealityCheck(diagnosticTrades, observations, diagnosticFallback, dates, candidates, selected ? 'selected' : 'diagnostic fallback')
      : {
          method: 'time-decay-marked-quote-exit-block-bootstrap',
          comparison: 'no selected candidate available',
          alternative: 'positive mean daily marked edge after fixed train/validation selection',
          pValue: null,
          singleCandidatePValue: null,
          selectionAdjustedPValue: null,
          observedAverageDailyEdgePct: null,
          observedAnnualizedEdgePct: null,
          dailyActiveVolPct: null,
          standardErrorDailyEdgePct: null,
          sampleCount: observations.length,
          selectedSampleCount: 0,
          activeOverlayDays: 0,
          minimumResolvablePValue: round(1 / (config.monteCarloIterations + 1), 4),
          iterations: config.monteCarloIterations,
          blockLength: 1,
          positiveSelectedReturnRows: 0,
          negativeSelectedReturnRows: 0,
          diagnosticOnly: true,
          limitation:
            `Historical support uses hourly Kalshi bid/ask candles and Polymarket price-history proxies across ${dates.length.toLocaleString()} observed days. Returns are marked to later quotes, not settlement-confirmed fills.`,
        }
    const currentTop = selectedConfig ? currentOpportunities(marketRows, byMarket, selectedConfig) : []

    await writeCsv(resolve(outputDir, 'current-markets.csv'), marketRows, [
      'venue',
      'marketId',
      'eventKey',
      'question',
      'deadline',
      'yesBid',
      'yesAsk',
      'yesPrice',
      'volume24h',
      'liquidity',
      'closeTime',
      'updatedTime',
      'sourceRef',
      'rawDeadlinePhrase',
      'deadlineMatchesClose',
    ])
    await writeCsv(resolve(outputDir, 'historical-observations.csv'), observations, [
      'observedAt',
      'observedDate',
      'venue',
      'marketId',
      'eventKey',
      'question',
      'deadline',
      'yesBid',
      'yesAsk',
      'yesPrice',
      'yesPriceCents',
      'recentChangeCents',
      'daysToDeadline',
      'liquidity',
      'volume24h',
    ])
    await writeCsv(resolve(outputDir, 'candidate-summary.csv'), candidates, [
      'candidateId',
      'venueSet',
      'minYesPriceCents',
      'maxYesPriceCents',
      'minDaysToDeadline',
      'maxDaysToDeadline',
      'maxRecentRiseCents',
      'feeHaircutCents',
      'minSpacingHours',
      'holdHours',
      'eligible',
      'selectionEligible',
      'trainValidationRank',
      'trainValidationScore',
      'trainValidationReturnPct',
      'trainTradeCount',
      'validationTradeCount',
      'preHoldoutTradeCount',
      'trainEdgePct',
      'validationEdgePct',
      'holdoutEdgePct',
      'allEdgePct',
      'trainReturnPct',
      'validationReturnPct',
      'holdoutReturnPct',
      'allReturnPct',
      'trainAnnualReturnPct',
      'validationAnnualReturnPct',
      'holdoutAnnualReturnPct',
      'allAnnualReturnPct',
      'trainSharpe',
      'validationSharpe',
      'holdoutSharpe',
      'trainMaxDrawdownPct',
      'validationMaxDrawdownPct',
      'holdoutMaxDrawdownPct',
      'tradeCount',
      'holdoutTradeCount',
      'averageNetReturnPct',
      'averagePackageReturnPct',
    ])
    await writeCsv(resolve(outputDir, 'selected-trades.csv'), qoreRows, [
      'strategyId',
      'variant',
      'observedAt',
      'signalDate',
      'issueDate',
      'targetDate',
      'entryTradeDate',
      'exitTradeDate',
      'targetTradeDate',
      'direction',
      'sourceId',
      'windowId',
      'thesisKind',
      'leadDays',
      'confidence',
      'weightedAnomalyF',
      'coveragePct',
      'coldCoveragePct',
      'warmCoveragePct',
      'extremeCount',
      'grossReturnPct',
      'tradingCostPct',
      'netReturnPct',
      'indexReturnPct',
      'ungReturnPct',
      'ungPosition',
      'equity',
      'equityPct',
      'drawdownPct',
      'rank',
      'pairId',
      'earlyMarketId',
      'laterMarketId',
      'earlyDeadline',
      'laterDeadline',
      'packageCost',
      'grossEdgePct',
      'packageReturnPct',
      'portfolioAllocationPct',
      'executableSize',
      'liquidityMin',
      'volume24hMin',
      'split',
    ])

    writeJson(resolve(outputDir, 'run-summary.json'), {
      generatedAt,
      strategyId: 'prediction-time-decay-alpha',
      displayName: 'Prediction Time-Decay Alpha',
      data: {
        kalshiMarkets: sourceMarketCounts.kalshiMarkets,
        polymarketMarkets: sourceMarketCounts.polymarketMarkets,
        parsedDateThresholdMarkets: marketRows.length,
        timeDecayMarkets: marketRows.length,
        timeDecayHistoricalMarketsRequested: historicalResult.marketsRequested,
        timeDecayHistoricalMarketsSucceeded: historicalResult.marketsSucceeded,
        historicalPairsRequested: historicalResult.marketsRequested,
        historicalPairsSucceeded: historicalResult.marketsSucceeded,
        historicalPairsFailed: historicalResult.failures.length,
        historicalFailedPairIds: historicalResult.failures.map((failure) => `${failure.venue}:${failure.marketId}`),
        historicalAllowPartial: config.allowPartialHistory,
        historicalObservations: observations.length,
        historicalStartDate: minDate,
        historicalEndDate: maxDate,
        historyDaysRequested: config.historyDays,
        holdoutMonths: config.holdoutMonths,
        actualHoldoutDays,
        validationDays: config.validationDays,
        candleIntervalMinutes: config.candleIntervalMinutes,
        portfolioAllocationPct: config.capitalAllocationPct,
        feeHaircutCents: config.feeHaircutCents,
        selectedRows: qoreRows.length,
        currentDecayCandidates: currentTop.length,
      },
      contract: {
        trainEnd: splitDates.trainEnd,
        validationEnd: splitDates.validationEnd,
        holdoutStart: splitDates.holdoutStart,
        requestedHoldoutStart,
        feeHaircutCents: config.feeHaircutCents,
        capitalAllocationPct: config.capitalAllocationPct,
        fallback:
          'No idle capital allocation is modeled; rows represent buy-NO/fade-YES entries on time-bound markets, then quote-mark exits after the selected short horizon.',
        selectionPolicy:
          'Venue set, YES-price band, days-to-deadline band, recent-upmove filter, pair-spacing, and hold-time variants are ranked only on train/validation marked quote exits. The final two calendar months are report-only holdout and are not used for selection.',
        signalTiming:
          'Enter by fading YES when a time-bound market remains inside the selected YES-price and days-to-deadline band without a disqualifying 24-hour upmove. Kalshi uses entry YES bid and exit YES ask; Polymarket uses CLOB price-history proxies with an explicit fee haircut.',
        overfitControl:
          `Candidate ranking never reads holdout. The split uses ${dates.length.toLocaleString()} unique observed days with the requested final ${config.holdoutMonths} calendar months hidden from selection starting ${splitDates.holdoutStart}. The strategy remains paper/research until rule text, fees, depth, locate/margin mechanics, and settlement behavior are reviewed.`,
      },
      selection: selected
        ? {
            status: 'selected',
            candidateId: selected.candidateId,
            selectionEligible: selected.selectionEligible,
            eligible: selected.eligible,
            diagnosticOnly: false,
          }
        : {
            status: 'no-selection',
            reason:
              'No candidate passed selectionEligible/eligible gates; fallback candidates are diagnostic only and selected-trades.csv is intentionally empty.',
            diagnosticFallback: diagnosticFallback
              ? {
                  candidateId: diagnosticFallback.candidateId,
                  eligible: diagnosticFallback.eligible,
                  selectionEligible: diagnosticFallback.selectionEligible,
                  trainValidationRank: diagnosticFallback.trainValidationRank,
                  trainValidationScore: diagnosticFallback.trainValidationScore,
                  trainValidationReturnPct: diagnosticFallback.trainValidationReturnPct,
                  trainTradeCount: diagnosticFallback.trainTradeCount,
                  validationTradeCount: diagnosticFallback.validationTradeCount,
                  preHoldoutTradeCount: diagnosticFallback.preHoldoutTradeCount,
                  tradeCount: diagnosticFallback.tradeCount,
                  holdoutTradeCount: diagnosticFallback.holdoutTradeCount,
                  trainReturnPct: diagnosticFallback.trainReturnPct,
                  validationReturnPct: diagnosticFallback.validationReturnPct,
                  holdoutReturnPct: diagnosticFallback.holdoutReturnPct,
                  allReturnPct: diagnosticFallback.allReturnPct,
                  diagnosticRows: diagnosticTrades.length,
                }
              : null,
          },
      selected: selected
        ? {
            candidateId: selected.candidateId,
            architectureLabel: 'Short-horizon time-decay YES-fade detector',
            sourceSetLabel: 'Kalshi public market data/candlesticks + Polymarket Gamma/CLOB price history',
            sourceIds: ['kalshi-public-markets', 'kalshi-candlesticks', 'polymarket-gamma', 'polymarket-clob-price-history'],
            minGrossEdgeCents: selected.minYesPriceCents,
            feeHaircutCents: config.feeHaircutCents,
            minSpacingHours: selected.minSpacingHours,
            holdHours: selected.holdHours,
            capitalAllocationPct: config.capitalAllocationPct,
            allMetrics: selectedMetrics,
            trainMetrics: selectedSplitMetrics.train,
            validationMetrics: selectedSplitMetrics.validation,
            holdoutMetrics: selectedSplitMetrics.holdout,
            currentMetrics: additiveMetricsFromRows([]),
            indexMetrics: {
              all: additiveMetricsFromRows([]),
              train: additiveMetricsFromRows([]),
              validation: additiveMetricsFromRows([]),
              holdout: additiveMetricsFromRows([]),
            },
            splitEdges: selectedSplitEdges,
            splitAnnualEdges: {
              train: selectedSplitMetrics.train.cagrPct,
              validation: selectedSplitMetrics.validation.cagrPct,
              holdout: selectedSplitMetrics.holdout.cagrPct,
              all: selectedSplitMetrics.all.cagrPct,
            },
            splitTotalReturns: {
              train: selectedSplitMetrics.train.totalReturnPct,
              validation: selectedSplitMetrics.validation.totalReturnPct,
              holdout: selectedSplitMetrics.holdout.totalReturnPct,
              all: selectedSplitMetrics.all.totalReturnPct,
            },
            sourceUniverse: [...new Set(qoreRows.map((row) => row.sourceId))].sort(),
            currentTopOpportunities: currentTop.map((row) => ({
              venue: row.venue,
              marketId: row.marketId,
              question: row.question,
              deadline: row.deadline,
              yesPriceCents: row.yesPriceCents,
              recentChangeCents: row.recentChangeCents,
              daysToDeadline: round(row.daysToDeadline, 2),
              basisFlags: row.venue === 'polymarket' ? 'price_history_proxy;rule_text;depth;fees' : 'bid_ask_mark;rule_text;depth;fees',
            })),
          }
        : null,
      search: {
        candidateCount: candidates.length,
        eligibleCandidateCount: candidates.filter((candidate) => candidate.selectionEligible).length,
        selectionUsedHoldout: false,
        validationScope: 'historical-holdout',
      },
      validation: {
        realityCheck,
      },
      outputFiles: {
        selectedTrades: 'data/qore/research/strategy-agent-runs/prediction-time-decay/selected-trades.csv',
        candidateSummary: 'data/qore/research/strategy-agent-runs/prediction-time-decay/candidate-summary.csv',
        currentMarkets: 'data/qore/research/strategy-agent-runs/prediction-time-decay/current-markets.csv',
      },
      caveat:
        'This is a research artifact, not live routing. When selection.status is no-selection, fallback rows are diagnostic only and must not enter the active strategy registry or leaderboard. Historical rows use quote/proxy marks rather than settlement-confirmed fills; the raw historical-observations.csv dump is local-only and intentionally omitted from the checked-in outputFiles contract because it can exceed repository blob limits. Every market needs contract-language, liquidity, fee, shorting/buy-NO mechanics, and event-news review before paper or live execution.',
    })
    console.log(
      `saved prediction-time-decay: ${marketRows.length} time-bound markets, ${observations.length} historical observations, ${qoreRows.length} selected paper rows${selected ? '' : ' (no eligible selection; diagnostic fallback only)'}`,
    )
  } finally {
    releaseOutputLock()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
