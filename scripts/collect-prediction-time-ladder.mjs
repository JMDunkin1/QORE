import { closeSync, createWriteStream, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(rootDir, process.env.QORE_TIME_LADDER_OUTPUT_DIR ?? 'data/qore/research/strategy-agent-runs/prediction-time-ladder')
const kalshiBaseUrl = 'https://external-api.kalshi.com/trade-api/v2'
const polymarketGammaUrl = 'https://gamma-api.polymarket.com'
const polymarketClobUrl = 'https://clob.polymarket.com'
const lockPath = resolve(tmpdir(), 'qore-prediction-time-ladder.collect.lock')
const initialCapital = 100000
const tradingDaysPerYear = 252
const calendarDaysPerYear = 365.25
const now = new Date()

const config = {
  historyDays: numberEnv('QORE_TIME_LADDER_HISTORY_DAYS', 180),
  maxHistoricalPairs: numberEnv('QORE_TIME_LADDER_MAX_HISTORICAL_PAIRS', 600),
  kalshiPages: optionalNumberEnv('QORE_TIME_LADDER_KALSHI_PAGES'),
  polymarketPages: optionalNumberEnv('QORE_TIME_LADDER_POLYMARKET_PAGES'),
  polymarketBookPairs: numberEnv('QORE_TIME_LADDER_POLYMARKET_BOOK_PAIRS', 180),
  candleIntervalMinutes: numberEnv('QORE_TIME_LADDER_CANDLE_INTERVAL_MINUTES', 60),
  feeHaircutCents: numberEnv('QORE_TIME_LADDER_FEE_HAIRCUT_CENTS', 1),
  capitalAllocationPct: numberEnv('QORE_TIME_LADDER_CAPITAL_ALLOCATION_PCT', 1),
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

function numberEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function optionalNumberEnv(name) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : null
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
      console.error(`prediction-time-ladder collector already running from ${lockPath}: ${ownerDetails.trim()}`)
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(target)
      if (retryStatuses.has(response.status) && attempt < 3) {
        await sleep(350 * (attempt + 1))
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
      if (attempt === 3) break
      await sleep(350 * (attempt + 1))
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

function isoDate(date) {
  return date.toISOString().slice(0, 10)
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
  if (isoMatch) {
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

function isoDateFromTimestamp(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? isoDate(new Date(parsed)) : ''
}

function dateDistanceDays(left, right) {
  const leftTime = Date.parse(left || '')
  const rightTime = Date.parse(right || '')
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Infinity
  return Math.abs(leftTime - rightTime) / 86400000
}

function kalshiTickerDeadlineCandidates(ticker) {
  const candidates = []
  const tickerPattern = new RegExp(`(?:^|-)(?<year>\\d{2})(?<month>${monthPattern})(?<day>\\d{0,2})(?=-|$)`, 'gi')
  for (const match of String(ticker ?? '').matchAll(tickerPattern)) {
    const month = monthNumbers.get(match.groups.month.toLowerCase())
    const day = match.groups.day ? Number(match.groups.day) : 1
    if (!month || day < 1 || day > 31) continue
    candidates.push({
      date: isoDate(new Date(Date.UTC(2000 + Number(match.groups.year), month - 1, day))),
      phrase: match[0].replace(/^-/, ''),
    })
  }
  return candidates
}

function kalshiDeadline(market) {
  const closeDate = isoDateFromTimestamp(market.close_time)
  const fallbackYear = parseIsoYear(market.close_time)
  const tickerDeadlines = kalshiTickerDeadlineCandidates(market.ticker)
  const tickerDeadline = closeDate
    ? tickerDeadlines.find((deadline) => dateDistanceDays(deadline.date, closeDate) <= 2)
    : tickerDeadlines[0]
  if (tickerDeadline) return tickerDeadline

  const contractDeadline = firstDeadline([market.yes_sub_title, market.rules_primary, market.rules_secondary], fallbackYear)
  if (contractDeadline.date) {
    if (closeDate && dateDistanceDays(contractDeadline.date, closeDate) > 2) return { date: '', phrase: '' }
    return contractDeadline
  }

  return { date: '', phrase: '' }
}

function normalizeText(text) {
  return String(text ?? '')
    .replace(datePhrasePattern, ' ')
    .replace(monthYearPattern, ' ')
    .replace(isoDatePattern, ' ')
    .toLowerCase()
    .replace(/\b(yes|no)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
    await sleep(60)
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
      await sleep(60)
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

function kalshiRows(markets) {
  return markets
    .map((market) => {
      const title = market.title || market.yes_sub_title || ''
      const deadline = kalshiDeadline(market)
      if (!deadline.date) return null
      const eventKey = market.event_ticker || ''
      return {
        venue: 'kalshi',
        marketId: market.ticker,
        eventKey,
        baseKey: `kalshi:${eventKey}:${normalizeText(title) || 'date-ladder'}`,
        question: title,
        deadline: deadline.date,
        yesBid: numberFrom(market.yes_bid_dollars),
        yesAsk: numberFrom(market.yes_ask_dollars),
        noAsk: numberFrom(market.no_ask_dollars),
        yesBidSize: numberFrom(market.yes_bid_size_fp),
        yesAskSize: numberFrom(market.yes_ask_size_fp),
        noAskSize: numberFrom(market.yes_bid_size_fp),
        volume24h: numberFrom(market.volume_24h_fp),
        liquidity: numberFrom(market.liquidity_dollars),
        closeTime: market.close_time || '',
        updatedTime: market.updated_time || '',
        sourceRef: eventKey,
        rawDeadlinePhrase: deadline.phrase,
      }
    })
    .filter(Boolean)
}

function polymarketRows(markets) {
  return markets
    .map((market) => {
      const outcomes = parseJsonList(market.outcomes)
      const tokens = parseJsonList(market.clobTokenIds)
      if (outcomes.length !== 2 || tokens.length !== 2) return null
      const outcomeMap = new Map(outcomes.map((outcome, index) => [String(outcome).trim().toLowerCase(), String(tokens[index])]))
      if (!outcomeMap.has('yes') || !outcomeMap.has('no')) return null
      const event = Array.isArray(market.events) ? market.events[0] : null
      const eventKey = event?.slug || event?.ticker || market.slug || ''
      const deadline = firstDeadline(
        [market.question, market.groupItemTitle, market.description],
        parseIsoYear(market.endDate),
      )
      if (!deadline.date) return null
      const yesBid = numberFrom(market.bestBid)
      const yesAsk = numberFrom(market.bestAsk)
      return {
        venue: 'polymarket',
        marketId: String(market.id),
        eventKey,
        baseKey: `polymarket:${eventKey}:${normalizeText(market.question) || 'date-ladder'}`,
        question: market.question || '',
        deadline: deadline.date,
        yesBid,
        yesAsk,
        noAsk: yesBid === null ? null : 1 - yesBid,
        yesBidSize: null,
        yesAskSize: null,
        noAskSize: null,
        volume24h: numberFrom(market.volume24hr),
        liquidity: numberFrom(market.liquidityNum ?? market.liquidityClob),
        closeTime: market.endDate || '',
        updatedTime: market.updatedAt || '',
        sourceRef: market.slug || '',
        yesTokenId: outcomeMap.get('yes'),
        noTokenId: outcomeMap.get('no'),
        rawDeadlinePhrase: deadline.phrase,
      }
    })
    .filter(Boolean)
}

function buildPairs(rows) {
  const groups = new Map()
  rows.forEach((row) => {
    const group = groups.get(row.baseKey) ?? []
    group.push(row)
    groups.set(row.baseKey, group)
  })
  const pairs = []
  for (const [groupKey, groupRows] of groups.entries()) {
    const sortedRows = [...groupRows].sort((a, b) => a.deadline.localeCompare(b.deadline) || a.marketId.localeCompare(b.marketId))
    if (new Set(sortedRows.map((row) => row.deadline)).size < 2) continue
    for (let i = 0; i < sortedRows.length; i += 1) {
      for (let j = i + 1; j < sortedRows.length; j += 1) {
        const early = sortedRows[i]
        const later = sortedRows[j]
        if (early.deadline >= later.deadline) continue
        const packageCost = early.noAsk !== null && later.yesAsk !== null ? early.noAsk + later.yesAsk : null
        const grossEdge = packageCost === null ? null : 1 - packageCost
        pairs.push({
          venue: early.venue,
          groupKey,
          earlyMarketId: early.marketId,
          laterMarketId: later.marketId,
          earlyQuestion: early.question,
          laterQuestion: later.question,
          earlyDeadline: early.deadline,
          laterDeadline: later.deadline,
          earlyYesBid: early.yesBid,
          laterYesAsk: later.yesAsk,
          earlyNoAsk: early.noAsk,
          packageCost,
          grossEdge,
          executableSize:
            early.noAskSize !== null && later.yesAskSize !== null && early.noAskSize > 0 && later.yesAskSize > 0
              ? Math.min(early.noAskSize, later.yesAskSize)
              : null,
          volume24hMin: early.volume24h !== null && later.volume24h !== null ? Math.min(early.volume24h, later.volume24h) : null,
          liquidityMin: early.liquidity !== null && later.liquidity !== null ? Math.min(early.liquidity, later.liquidity) : null,
          earlyEventKey: early.eventKey,
          laterEventKey: later.eventKey,
          earlyYesTokenId: early.yesTokenId || '',
          earlyNoTokenId: early.noTokenId || '',
          laterYesTokenId: later.yesTokenId || '',
          settlementRisk: early.venue === 'polymarket' ? 'verify-uma-wording-and-token-depth' : 'verify-contract-language',
        })
      }
    }
  }
  return pairs
}

async function refinePolymarketPairs(pairs) {
  const candidates = pairs
    .filter((pair) => pair.venue === 'polymarket' && pair.earlyNoTokenId && pair.laterYesTokenId)
    .sort((a, b) => (b.grossEdge ?? -Infinity) - (a.grossEdge ?? -Infinity))
    .slice(0, config.polymarketBookPairs)
  const bookCache = new Map()
  const getBook = async (tokenId) => {
    if (!tokenId) return null
    if (!bookCache.has(tokenId)) {
      try {
        bookCache.set(tokenId, await requestJson(`${polymarketClobUrl}/book`, { params: { token_id: tokenId } }))
      } catch {
        bookCache.set(tokenId, null)
      }
      await sleep(40)
    }
    return bookCache.get(tokenId)
  }
  const bestAsk = (book) => {
    const asks = (book?.asks ?? [])
      .map((level) => ({ price: numberFrom(level.price), size: numberFrom(level.size) }))
      .filter((level) => level.price !== null && level.size !== null)
    return asks.length ? asks.sort((a, b) => a.price - b.price)[0] : null
  }
  const bestBid = (book) => {
    const bids = (book?.bids ?? [])
      .map((level) => ({ price: numberFrom(level.price), size: numberFrom(level.size) }))
      .filter((level) => level.price !== null && level.size !== null)
    return bids.length ? bids.sort((a, b) => b.price - a.price)[0] : null
  }
  const refined = new Map()
  for (const pair of candidates) {
    const earlyNoAsk = bestAsk(await getBook(pair.earlyNoTokenId))
    const laterYesAsk = bestAsk(await getBook(pair.laterYesTokenId))
    const earlyYesBid = bestBid(await getBook(pair.earlyYesTokenId))
    if (!earlyNoAsk || !laterYesAsk) continue
    const packageCost = earlyNoAsk.price + laterYesAsk.price
    refined.set(`${pair.earlyMarketId}|${pair.laterMarketId}`, {
      ...pair,
      earlyYesBid: earlyYesBid?.price ?? pair.earlyYesBid,
      earlyNoAsk: earlyNoAsk.price,
      laterYesAsk: laterYesAsk.price,
      packageCost,
      grossEdge: 1 - packageCost,
      executableSize: Math.min(earlyNoAsk.size, laterYesAsk.size),
    })
  }
  return pairs.map((pair) => refined.get(`${pair.earlyMarketId}|${pair.laterMarketId}`) ?? pair)
}

function uniquePreserve(items) {
  const seen = new Set()
  const output = []
  for (const item of items) {
    const cleaned = String(item ?? '').replace(/\s+/g, ' ').trim()
    const key = cleaned.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(key)
  }
  return output
}

async function kalshiCandles(pair, startTs, endTs) {
  const fetchCandles = async (marketId, eventKey) => {
    const payload = await requestJson(`${kalshiBaseUrl}/series/${eventKey}/markets/${marketId}/candlesticks`, {
      params: {
        start_ts: startTs,
        end_ts: endTs,
        period_interval: config.candleIntervalMinutes,
      },
    })
    const byTs = new Map()
    for (const candle of payload.candlesticks ?? []) {
      byTs.set(Number(candle.end_period_ts), {
        yesBidClose: numberFrom(candle.yes_bid?.close_dollars),
        yesAskClose: numberFrom(candle.yes_ask?.close_dollars),
        yesBidHigh: numberFrom(candle.yes_bid?.high_dollars),
        yesAskLow: numberFrom(candle.yes_ask?.low_dollars),
      })
    }
    return byTs
  }
  const early = await fetchCandles(pair.earlyMarketId, pair.earlyEventKey)
  await sleep(35)
  const later = await fetchCandles(pair.laterMarketId, pair.laterEventKey)
  return [...early.keys()]
    .filter((ts) => later.has(ts))
    .map((ts) => {
      const earlyPoint = early.get(ts)
      const laterPoint = later.get(ts)
      const closeEdge =
        earlyPoint.yesBidClose !== null && laterPoint.yesAskClose !== null ? earlyPoint.yesBidClose - laterPoint.yesAskClose : null
      const optimisticEdge =
        earlyPoint.yesBidHigh !== null && laterPoint.yesAskLow !== null ? earlyPoint.yesBidHigh - laterPoint.yesAskLow : null
      const packageCost = closeEdge === null ? null : 1 - closeEdge
      return {
        ts,
        observedAt: new Date(ts * 1000).toISOString(),
        observedDate: new Date(ts * 1000).toISOString().slice(0, 10),
        venue: pair.venue,
        pairId: `${pair.earlyMarketId}|${pair.laterMarketId}`,
        earlyMarketId: pair.earlyMarketId,
        laterMarketId: pair.laterMarketId,
        earlyQuestion: pair.earlyQuestion,
        laterQuestion: pair.laterQuestion,
        earlyDeadline: pair.earlyDeadline,
        laterDeadline: pair.laterDeadline,
        edge: closeEdge,
        optimisticEdge,
        packageCost,
        executableSize: pair.executableSize,
        liquidityMin: pair.liquidityMin,
        volume24hMin: pair.volume24hMin,
      }
    })
    .filter((observation) => observation.edge !== null && observation.packageCost !== null && observation.packageCost > 0)
}

async function buildHistoricalObservations(pairs) {
  const startTs = Math.floor((now.getTime() - config.historyDays * 86400000) / 1000)
  const endTs = Math.floor(now.getTime() / 1000)
  const rankedPairs = [...pairs]
    .filter((pair) => pair.venue === 'kalshi')
    .sort(
      (a, b) =>
        (b.grossEdge ?? -Infinity) - (a.grossEdge ?? -Infinity) ||
        (b.volume24hMin ?? 0) - (a.volume24hMin ?? 0) ||
        (b.liquidityMin ?? 0) - (a.liquidityMin ?? 0),
    )
    .slice(0, config.maxHistoricalPairs)
  const observations = []
  for (let index = 0; index < rankedPairs.length; index += 1) {
    const pair = rankedPairs[index]
    if (index % 25 === 0) console.log(`historical candles ${index + 1}/${rankedPairs.length}`)
    try {
      observations.push(...(await kalshiCandles(pair, startTs, endTs)))
    } catch (error) {
      console.log(`historical failed ${pair.earlyMarketId}->${pair.laterMarketId}: ${error.message}`)
    }
    await sleep(55)
  }
  return observations.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.pairId.localeCompare(b.pairId))
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

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function splitForDate(date, splitDates) {
  if (date >= splitDates.holdoutStart) return 'holdout'
  if (date > splitDates.trainEnd && date <= splitDates.validationEnd) return 'validation'
  return 'train'
}

function uniqueSortedValues(values) {
  return [...new Set(values)].sort((left, right) => left - right)
}

function splitDatesFromObservations(observations) {
  const dates = [...new Set(observations.map((observation) => observation.observedDate).filter(Boolean))].sort()
  const minDate = dates[0] ?? isoDate(now)
  const maxDate = dates.at(-1) ?? isoDate(now)
  const validationStartIndex = Math.floor(dates.length * 0.55)
  const holdoutStartIndex = Math.floor(dates.length * 0.82)
  return {
    dates,
    minDate,
    maxDate,
    splitDates: {
      trainEnd: dates[validationStartIndex] ?? minDate,
      validationEnd: dates[holdoutStartIndex] ?? maxDate,
      holdoutStart: dates[holdoutStartIndex] ?? maxDate,
    },
  }
}

function rowEntryDate(row) {
  return row.entryTradeDate ?? row.observedDate ?? row.signalDate ?? ''
}

function rowExitDate(row) {
  return row.exitTradeDate ?? row.laterDeadline ?? row.targetDate ?? rowEntryDate(row)
}

function rowNetReturnPct(row) {
  return numberFrom(row.netReturnPct, 0) ?? 0
}

function rowAllocationPct(row) {
  return numberFrom(row.portfolioAllocationPct, config.capitalAllocationPct) ?? config.capitalAllocationPct
}

function holdDaysForRow(row) {
  return daysBetween(rowEntryDate(row), rowExitDate(row))
}

function rowDateBounds(rows) {
  const entries = rows.map(rowEntryDate).filter(Boolean).sort()
  const exits = rows.map(rowExitDate).filter(Boolean).sort()
  const firstEntry = entries[0] ?? ''
  const lastExit = exits.at(-1) ?? firstEntry
  return {
    firstEntry,
    lastExit,
    elapsedDays: firstEntry && lastExit ? daysBetween(firstEntry, lastExit) : 1,
  }
}

function additiveDailyReturns(rows) {
  if (!rows.length) return []
  const { firstEntry, elapsedDays } = rowDateBounds(rows)
  if (!firstEntry) return []
  const returns = Array.from({ length: elapsedDays }, () => 0)
  for (const row of rows) {
    const entryDate = rowEntryDate(row)
    const entryTime = Date.parse(entryDate)
    const firstTime = Date.parse(firstEntry)
    if (!Number.isFinite(entryTime) || !Number.isFinite(firstTime)) continue
    const holdDays = holdDaysForRow(row)
    const startOffset = Math.max(0, Math.floor((entryTime - firstTime) / 86400000))
    const dailyReturn = rowNetReturnPct(row) / 100 / holdDays
    for (let offset = 0; offset < holdDays && startOffset + offset < returns.length; offset += 1) {
      returns[startOffset + offset] += dailyReturn
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

function tradeReturnPct(observation) {
  const netEdge = Math.max(0, observation.edge - config.feeHaircutCents / 100)
  return observation.packageCost ? (netEdge / observation.packageCost) * 100 : 0
}

function portfolioReturnPct(packageReturnPct) {
  return packageReturnPct * (config.capitalAllocationPct / 100)
}

function selectTradesForCandidate(observations, candidate, splitDates) {
  const selected = []
  const lastByPair = new Map()
  for (const observation of observations) {
    if (observation.edge * 100 < candidate.minGrossEdgeCents) continue
    const packageReturnPct = tradeReturnPct(observation)
    if (packageReturnPct <= 0) continue
    const previousTs = lastByPair.get(observation.pairId)
    if (previousTs && (observation.ts - previousTs) / 3600 < candidate.minSpacingHours) continue
    lastByPair.set(observation.pairId, observation.ts)
    selected.push({
      ...observation,
      packageReturnPct,
      netReturnPct: portfolioReturnPct(packageReturnPct),
      grossReturnPct: observation.edge * 100,
      split: splitForDate(observation.observedDate, splitDates),
    })
  }
  return selected
}

function metricsFromReturns(trades) {
  return additiveMetricsFromRows(trades)
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
  return {
    train: metricsFromReturns(trades.filter((trade) => trade.split === 'train')),
    validation: metricsFromReturns(trades.filter((trade) => trade.split === 'validation')),
    holdout: metricsFromReturns(trades.filter((trade) => trade.split === 'holdout')),
    all: metricsFromReturns(trades),
  }
}

function selectedScreenRealityCheck(trades, observations, candidate) {
  const thresholdRows = observations.filter((observation) => observation.edge * 100 >= candidate.minGrossEdgeCents)
  const thresholdReturns = thresholdRows.map((observation) => portfolioReturnPct(tradeReturnPct(observation)))
  const selectedReturns = trades.map((trade) => trade.netReturnPct)
  const observed = mean(thresholdReturns)
  return {
    method: 'descriptive-selected-quote-screen',
    comparison: 'threshold-qualified quote package net edge after fee haircut',
    alternative: 'not-applicable',
    pValue: null,
    singleCandidatePValue: null,
    selectionAdjustedPValue: null,
    observedAverageDailyEdgePct: round(observed, 4),
    observedAnnualizedEdgePct: round(observed * tradingDaysPerYear, 2),
    dailyActiveVolPct: round(std(thresholdReturns), 4),
    sampleCount: thresholdRows.length,
    selectedSampleCount: trades.length,
    activeOverlayDays: new Set(thresholdRows.map((observation) => observation.observedDate)).size,
    minimumResolvablePValue: null,
    positiveSelectedReturnRows: selectedReturns.filter((value) => value > 0).length,
    limitation:
      'No inferential p-value is reported because selected rows are mechanically positive after quote-edge gating; settlement-based paper outcomes are required for a valid reality check.',
  }
}

function buildCandidates(observations, splitDates) {
  const candidates = []
  const configs = []
  const minGrossEdgeCentsValues = uniqueSortedValues([config.feeHaircutCents, 1.5, 2, 3, 4, 5])
  for (const minGrossEdgeCents of minGrossEdgeCentsValues) {
    for (const minSpacingHours of [1, 6, 24]) {
      configs.push({ minGrossEdgeCents, minSpacingHours })
    }
  }
  for (const candidate of configs) {
    const candidateId = `edge-${String(candidate.minGrossEdgeCents).replace('.', 'p')}c-spacing-${candidate.minSpacingHours}h`
    const trades = selectTradesForCandidate(observations, candidate, splitDates)
    const splitEdges = splitEdgesForTrades(trades)
    const splitMetrics = splitMetricsForTrades(trades)
    const trainTradeCount = trades.filter((trade) => trade.split === 'train').length
    const validationTradeCount = trades.filter((trade) => trade.split === 'validation').length
    const holdoutTradeCount = trades.filter((trade) => trade.split === 'holdout').length
    const selectionEligible =
      trainTradeCount >= 8 &&
      validationTradeCount >= 8 &&
      splitEdges.train > 0 &&
      splitEdges.validation > 0
    candidates.push({
      candidateId,
      minGrossEdgeCents: candidate.minGrossEdgeCents,
      feeHaircutCents: config.feeHaircutCents,
      minSpacingHours: candidate.minSpacingHours,
      eligible: selectionEligible && holdoutTradeCount >= 8,
      selectionEligible,
      trainValidationRank: 0,
      trainEdgePct: splitEdges.train,
      validationEdgePct: splitEdges.validation,
      holdoutEdgePct: splitEdges.holdout,
      allEdgePct: splitEdges.all,
      trainReturnPct: splitMetrics.train.totalReturnPct,
      validationReturnPct: splitMetrics.validation.totalReturnPct,
      holdoutReturnPct: splitMetrics.holdout.totalReturnPct,
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
    })
  }
  candidates
    .sort((a, b) => b.trainEdgePct + b.validationEdgePct - (a.trainEdgePct + a.validationEdgePct) || b.tradeCount - a.tradeCount)
    .forEach((candidate, index) => {
      candidate.trainValidationRank = index + 1
    })
  return candidates
}

function selectedCandidate(candidates) {
  return (
    candidates.find((candidate) => candidate.selectionEligible) ??
    candidates.find((candidate) => candidate.eligible) ??
    candidates[0]
  )
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function waitForWritable(stream, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off(eventName, onEvent)
      stream.off('error', onError)
    }
    const onEvent = () => {
      cleanup()
      resolve()
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
  const stream = createWriteStream(path)
  const writeLine = async (line) => {
    if (!stream.write(line)) await waitForWritable(stream, 'drain')
  }
  await writeLine(`${fields.join(',')}\n`)
  for (const row of rows) {
    await writeLine(`${fields.map((field) => csvEscape(row[field])).join(',')}\n`)
  }
  stream.end()
  await waitForWritable(stream, 'finish')
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
      strategyId: 'prediction-time-ladder-alpha',
      variant: 'time-ladder-arb',
      observedAt: trade.observedAt,
      signalDate: trade.observedDate,
      issueDate: trade.observedDate,
      targetDate: trade.laterDeadline,
      entryTradeDate: trade.observedDate,
      exitTradeDate: trade.laterDeadline,
      targetTradeDate: trade.laterDeadline,
      direction: 'long',
      sourceId: trade.venue,
      windowId: 'time-ladder-package',
      thesisKind: 'time-ladder-package',
      leadDays: Math.max(1, Math.round((Date.parse(trade.laterDeadline) - Date.parse(trade.observedDate)) / 86400000)),
      confidence: round(Math.min(1, Math.max(0, trade.edge * 20)), 4),
      weightedAnomalyF: round(trade.edge * 100, 4),
      coveragePct: round(trade.executableSize ?? 0, 4),
      coldCoveragePct: 0,
      warmCoveragePct: 0,
      extremeCount: 0,
      grossReturnPct: round(trade.grossReturnPct, 4),
      tradingCostPct: config.feeHaircutCents,
      netReturnPct,
      indexReturnPct: 0,
      ungReturnPct: netReturnPct,
      ungPosition: 1,
      equity: round(equity, 2),
      equityPct: round(cumulativeReturnPct, 4),
      drawdownPct: round(cumulativeReturnPct - peakReturnPct, 4),
      rank: index + 1,
      pairId: trade.pairId,
      earlyMarketId: trade.earlyMarketId,
      laterMarketId: trade.laterMarketId,
      earlyDeadline: trade.earlyDeadline,
      laterDeadline: trade.laterDeadline,
      packageCost: round(trade.packageCost, 4),
      grossEdgePct: round(trade.edge * 100, 4),
      packageReturnPct: round(trade.packageReturnPct, 4),
      portfolioAllocationPct: config.capitalAllocationPct,
      executableSize: trade.executableSize ?? '',
      liquidityMin: trade.liquidityMin ?? '',
      volume24hMin: trade.volume24hMin ?? '',
      split: trade.split,
    }
  })
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function removeStaleOutputFile(name) {
  try {
    unlinkSync(resolve(outputDir, name))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
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
  for (const staleFile of ['cross-venue-signals.csv', 'time-ladder-selected-trades.csv', 'time-ladder-candidate-summary.csv']) {
    removeStaleOutputFile(staleFile)
  }
  const generatedAt = now.toISOString()
  const [kalshiMarkets, polymarketMarkets] = await Promise.all([fetchKalshiMarkets(), fetchPolymarketMarkets()])
  const marketRows = [...kalshiRows(kalshiMarkets), ...polymarketRows(polymarketMarkets)]
  let pairs = buildPairs(marketRows)
  pairs = await refinePolymarketPairs(pairs)
  pairs.sort((a, b) => (b.grossEdge ?? -Infinity) - (a.grossEdge ?? -Infinity))

  const observations = await buildHistoricalObservations(pairs)
  const { dates, minDate, maxDate, splitDates } = splitDatesFromObservations(observations)
  const candidates = buildCandidates(observations, splitDates)
  const selected = selectedCandidate(candidates)
  const selectedTrades = selectTradesForCandidate(
    observations,
    { minGrossEdgeCents: selected.minGrossEdgeCents, minSpacingHours: selected.minSpacingHours },
    splitDates,
  )
  const selectedMetrics = metricsFromReturns(selectedTrades)
  const selectedSplitMetrics = splitMetricsForTrades(selectedTrades)
  const selectedSplitEdges = splitEdgesForTrades(selectedTrades)
  const currentOpportunities = pairs.filter((pair) => (pair.grossEdge ?? 0) > 0)
  const currentStrongOpportunities = pairs.filter((pair) => (pair.grossEdge ?? 0) * 100 >= selected.minGrossEdgeCents)
  const timeLadderRealityCheck = selectedScreenRealityCheck(selectedTrades, observations, selected)
  const timeLadderQoreRows = qoreTradeRows(selectedTrades)

  await writeCsv(
    resolve(outputDir, 'current-markets.csv'),
    marketRows,
    [
      'venue',
      'marketId',
      'eventKey',
      'baseKey',
      'question',
      'deadline',
      'yesBid',
      'yesAsk',
      'noAsk',
      'yesBidSize',
      'yesAskSize',
      'noAskSize',
      'volume24h',
      'liquidity',
      'closeTime',
      'updatedTime',
      'sourceRef',
      'rawDeadlinePhrase',
    ],
  )
  await writeCsv(
    resolve(outputDir, 'all-detected-ladder-pairs.csv'),
    pairs,
    [
      'venue',
      'groupKey',
      'earlyMarketId',
      'laterMarketId',
      'earlyQuestion',
      'laterQuestion',
      'earlyDeadline',
      'laterDeadline',
      'earlyYesBid',
      'laterYesAsk',
      'earlyNoAsk',
      'packageCost',
      'grossEdge',
      'executableSize',
      'volume24hMin',
      'liquidityMin',
      'settlementRisk',
    ],
  )
  await writeCsv(
    resolve(outputDir, 'historical-observations.csv'),
    observations,
    [
      'observedAt',
      'observedDate',
      'venue',
      'pairId',
      'earlyMarketId',
      'laterMarketId',
      'earlyDeadline',
      'laterDeadline',
      'edge',
      'optimisticEdge',
      'packageCost',
      'executableSize',
      'liquidityMin',
      'volume24hMin',
    ],
  )
  await writeCsv(resolve(outputDir, 'candidate-summary.csv'), candidates, [
    'candidateId',
    'minGrossEdgeCents',
    'feeHaircutCents',
    'minSpacingHours',
    'eligible',
    'selectionEligible',
    'trainValidationRank',
    'trainEdgePct',
    'validationEdgePct',
    'holdoutEdgePct',
    'allEdgePct',
    'trainReturnPct',
    'validationReturnPct',
    'holdoutReturnPct',
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
  await writeCsv(resolve(outputDir, 'selected-trades.csv'), timeLadderQoreRows, [
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
    strategyId: 'prediction-time-ladder-alpha',
    displayName: 'Prediction Time-Ladder Alpha',
    data: {
      kalshiMarkets: kalshiMarkets.length,
      polymarketMarkets: polymarketMarkets.length,
      parsedDateThresholdMarkets: marketRows.length,
      ladderPairs: pairs.length,
      currentPositivePackages: currentOpportunities.length,
      currentPackagesAboveSelectedThreshold: currentStrongOpportunities.length,
      historicalPairsRequested: Math.min(config.maxHistoricalPairs, pairs.filter((pair) => pair.venue === 'kalshi').length),
      historicalObservations: observations.length,
      historicalStartDate: minDate,
      historicalEndDate: maxDate,
      historyDaysRequested: config.historyDays,
      candleIntervalMinutes: config.candleIntervalMinutes,
      portfolioAllocationPct: config.capitalAllocationPct,
    },
    contract: {
      trainEnd: splitDates.trainEnd,
      validationEnd: splitDates.validationEnd,
      holdoutStart: splitDates.holdoutStart,
      feeHaircutCents: config.feeHaircutCents,
      capitalAllocationPct: config.capitalAllocationPct,
      fallback: 'No idle capital allocation is modeled; rows represent detected package entries only.',
      selectionPolicy:
        'Candidate threshold and spacing variants are ranked on train/validation diagnostics across unique observation days; holdout is report-only and is not used for selection. The checked-in selected lane uses the selected gross-edge and pair-spacing gates.',
      signalTiming:
        'Use venue top-of-book quotes only. The executable package is buy NO on the earlier deadline plus buy YES on the later deadline.',
      overfitControl:
        `No contract wording is auto-promoted and no inferential p-value is reported for quote-edge-selected rows. The split uses ${dates.length.toLocaleString()} unique observed days with a hidden holdout starting ${splitDates.holdoutStart}. Every positive package remains subject to same-underlier, same-resolution-source, fee, liquidity, and settlement review before paper execution.`,
    },
    selected: {
      candidateId: selected.candidateId,
      architectureLabel: 'Nested deadline package detector',
      sourceSetLabel: 'Kalshi public market data + Polymarket Gamma/CLOB metadata',
      sourceIds: ['kalshi-public-markets', 'kalshi-candlesticks', 'polymarket-gamma', 'polymarket-public-search', 'polymarket-clob'],
      minGrossEdgeCents: selected.minGrossEdgeCents,
      feeHaircutCents: config.feeHaircutCents,
      minSpacingHours: selected.minSpacingHours,
      capitalAllocationPct: config.capitalAllocationPct,
      allMetrics: selectedMetrics,
      trainMetrics: selectedSplitMetrics.train,
      validationMetrics: selectedSplitMetrics.validation,
      holdoutMetrics: selectedSplitMetrics.holdout,
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
      sourceUniverse: [...new Set(timeLadderQoreRows.map((row) => row.sourceId))].sort(),
      currentTopOpportunities: currentStrongOpportunities.slice(0, 20),
    },
    search: {
      candidateCount: candidates.length,
      eligibleCandidateCount: candidates.filter((candidate) => candidate.selectionEligible).length,
      selectionUsedHoldout: false,
    },
    validation: {
      realityCheck: timeLadderRealityCheck,
    },
    outputFiles: {
      selectedTrades: 'data/qore/research/strategy-agent-runs/prediction-time-ladder/selected-trades.csv',
      candidateSummary: 'data/qore/research/strategy-agent-runs/prediction-time-ladder/candidate-summary.csv',
      currentMarkets: 'data/qore/research/strategy-agent-runs/prediction-time-ladder/current-markets.csv',
      detectedPairs: 'data/qore/research/strategy-agent-runs/prediction-time-ladder/all-detected-ladder-pairs.csv',
      historicalObservations: 'data/qore/research/strategy-agent-runs/prediction-time-ladder/historical-observations.csv',
    },
    caveat:
      'This is a research and paper-candidate artifact, not live routing. Historical candles are not full historical order-book depth, and all current packages need contract-language review before execution.',
  })
  console.log(
    `saved prediction-time-ladder: ${marketRows.length} date markets, ${pairs.length} ladders, ${observations.length} support observations, ${timeLadderQoreRows.length} selected paper rows`,
  )
  } finally {
    releaseOutputLock()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
