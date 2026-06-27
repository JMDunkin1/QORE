import { closeSync, createWriteStream, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(rootDir, process.env.QORE_CROSS_MARKET_OUTPUT_DIR ?? 'data/qore/research/strategy-agent-runs/prediction-cross-market-rv')
const lockPath = resolve(tmpdir(), 'qore-prediction-cross-market-rv.collect.lock')
const kalshiBaseUrl = 'https://external-api.kalshi.com/trade-api/v2'
const polymarketGammaUrl = 'https://gamma-api.polymarket.com'
const polymarketClobUrl = 'https://clob.polymarket.com'
const initialCapital = 100000
const calendarDaysPerYear = 365.25
const generatedAt = new Date()

const config = {
  historyDays: numberEnv('QORE_CROSS_MARKET_HISTORY_DAYS', 30),
  maxHistoricalPairs: numberEnv('QORE_CROSS_MARKET_MAX_HISTORICAL_PAIRS', 80),
  kalshiPages: optionalNumberEnv('QORE_CROSS_MARKET_KALSHI_PAGES'),
  polymarketPages: optionalNumberEnv('QORE_CROSS_MARKET_POLYMARKET_PAGES'),
  candleIntervalMinutes: numberEnv('QORE_CROSS_MARKET_CANDLE_INTERVAL_MINUTES', 60),
  feeHaircutCents: numberEnv('QORE_CROSS_MARKET_FEE_HAIRCUT_CENTS', 1),
  basisHaircutCents: numberEnv('QORE_CROSS_MARKET_BASIS_HAIRCUT_CENTS', 0.5),
  capitalAllocationPct: numberEnv('QORE_CROSS_MARKET_CAPITAL_ALLOCATION_PCT', 1),
  allowPartialHistory: process.argv.includes('--allow-partial-history') || booleanEnv('QORE_CROSS_MARKET_ALLOW_PARTIAL_HISTORY'),
}

const stateNames = [
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'florida',
  'georgia',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new york',
  'north carolina',
  'north dakota',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'rhode island',
  'south carolina',
  'south dakota',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'west virginia',
  'wisconsin',
  'wyoming',
]
const stateAbbreviations = new Map(
  Object.entries({
    al: 'alabama',
    ak: 'alaska',
    az: 'arizona',
    ar: 'arkansas',
    ca: 'california',
    co: 'colorado',
    ct: 'connecticut',
    de: 'delaware',
    fl: 'florida',
    ga: 'georgia',
    hi: 'hawaii',
    id: 'idaho',
    il: 'illinois',
    in: 'indiana',
    ia: 'iowa',
    ks: 'kansas',
    ky: 'kentucky',
    la: 'louisiana',
    me: 'maine',
    md: 'maryland',
    ma: 'massachusetts',
    mi: 'michigan',
    mn: 'minnesota',
    ms: 'mississippi',
    mo: 'missouri',
    mt: 'montana',
    ne: 'nebraska',
    nv: 'nevada',
    nh: 'new hampshire',
    nj: 'new jersey',
    nm: 'new mexico',
    ny: 'new york',
    nc: 'north carolina',
    nd: 'north dakota',
    oh: 'ohio',
    ok: 'oklahoma',
    or: 'oregon',
    pa: 'pennsylvania',
    ri: 'rhode island',
    sc: 'south carolina',
    sd: 'south dakota',
    tn: 'tennessee',
    tx: 'texas',
    ut: 'utah',
    vt: 'vermont',
    va: 'virginia',
    wa: 'washington',
    wv: 'west virginia',
    wi: 'wisconsin',
    wy: 'wyoming',
  }),
)

const synonymTokens = new Map(
  Object.entries({
    democratic: 'democrat',
    democrats: 'democrat',
    democrat: 'democrat',
    republicans: 'republican',
    republican: 'republican',
    gop: 'republican',
    gubernatorial: 'governor',
    senatorial: 'senate',
    mens: 'men',
    fifa: 'world',
  }),
)
const tokenStopwords = new Set(
  'will would shall the a an to be on by before after at in of for and or is are have has this that yes no market markets win wins winner race election contract contracts result results party'.split(
    ' ',
  ),
)

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
      console.error(`prediction-cross-market-rv collector already running from ${lockPath}: ${ownerDetails.trim()}`)
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

function daysBetween(startDate, endDate) {
  return Math.max(1, (Date.parse(endDate) - Date.parse(startDate)) / 86400000)
}

function inclusiveCalendarDaysBetween(startDate, endDate) {
  const startTime = Date.parse(startDate)
  const endTime = Date.parse(endDate)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 1
  return Math.max(1, Math.floor((endTime - startTime) / 86400000) + 1)
}

function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedTokens(text) {
  return normalizeText(text)
    .split(' ')
    .filter(Boolean)
    .map((token) => synonymTokens.get(token) ?? token)
    .map((token) => (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token))
    .filter((token) => token.length > 1 && !tokenStopwords.has(token))
}

function normalizedTokenSet(text) {
  return new Set(normalizedTokens(text))
}

function normalizedKey(text) {
  return normalizedTokens(text).join(' ')
}

function jaccard(left, right) {
  let overlap = 0
  for (const token of left) {
    if (right.has(token)) overlap += 1
  }
  return overlap / Math.max(1, left.size + right.size - overlap)
}

function stateFromText(text) {
  const normalized = ` ${normalizeText(text).replaceAll('-', ' ')} `
  for (const state of stateNames) {
    if (normalized.includes(` ${state} `)) return state.replaceAll(' ', '_')
  }
  return ''
}

function houseDistrict(text) {
  const match = normalizeText(text).match(/\b([a-z]{2})[- ]?(\d{1,2})\b/)
  if (!match || !stateAbbreviations.has(match[1])) return ''
  return `${match[1]}-${match[2]}`
}

function yearFromText(text) {
  return String(text ?? '').match(/20\d{2}/)?.[0] ?? ''
}

function candidateKey(text) {
  const normalized = normalizeText(text)
    .replace(/\(d\)/g, ' democrat ')
    .replace(/\(r\)/g, ' republican ')
    .replace(/\bdemocrats?\b|\bdemocratic\b/g, ' democrat ')
    .replace(/\brepublicans?\b|\bgop\b/g, ' republican ')
    .replace(
      /\b(the|will|win|wins|party|candidate|race|election|governor|senate|house|seat|for|in|of|primary|nomination|presidential)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
  return normalizedKey(normalized)
}

function eventCategory(text) {
  const normalized = normalizeText(text)
  if (normalized.includes('world cup')) return 'world_cup'
  if (normalized.includes('senate')) return 'senate'
  if (normalized.includes('governor') || normalized.includes('gubernatorial')) return 'governor'
  if (normalized.includes('house')) return 'house'
  if (normalized.includes('president') || normalized.includes('presidential')) return 'president'
  if (normalized.includes('ballon')) return 'ballon'
  return ''
}

function excludedWinnerProposition(text) {
  const normalized = normalizeText(text)
  return (
    /\bwin (?:the )?(?:semi final|semifinal|quarter final|quarterfinal|finals?|final stage)\b/.test(normalized) ||
    /\bkxwcstageofelim\b/.test(normalized) ||
    /\b(exactly|more than|below|above|at least|county|counties|finishing order|fewest|most goals|score|scored|group [a-z]|group stage|round of|fair play|golden ball|silver ball|golden boot|medal|award|stage of elimination|popular vote|margin|seats?|primary|nominee|nomination|third place|third-place)\b/.test(
      normalized,
    ) ||
    /\bstate senate\b/.test(normalized) ||
    /\bstate house\b/.test(normalized) ||
    /\bgovernorships\b/.test(normalized) ||
    /\bsenate elections\b.*\band\b/.test(normalized)
  )
}

function electionSignature(row) {
  const title = row.title || row.question || ''
  const specific = row.yes_sub_title || row.subtitle || row.groupItemTitle || ''
  const fullText = `${title} ${specific} ${row.rules_primary || ''} ${row.ticker || ''} ${row.slug || ''}`
  const normalized = normalizeText(fullText)
  if (String(row.ticker || '').startsWith('KXSTATELEG')) return null
  if (normalized.includes('holding more seats than any other party')) return null
  if (!/\bwin\b|\bwins\b/.test(normalized)) return null
  if (excludedWinnerProposition(normalized)) return null

  let office = ''
  let scope = ''
  const district = houseDistrict(fullText)
  const state = stateFromText(fullText)
  if (district && normalized.includes('house')) {
    office = 'house'
    scope = district
  } else if (normalized.includes('senate') && state) {
    office = 'senate'
    scope = state
  } else if ((normalized.includes('governor') || normalized.includes('gubernatorial')) && state) {
    office = 'governor'
    scope = state
  } else if (/(presidential.*nomination|nomination.*president)/.test(normalized)) {
    office = 'presidential_nomination'
    scope = normalized.includes('republican') || normalized.includes('gop') ? 'republican' : normalized.includes('democrat') ? 'democrat' : ''
  } else {
    return null
  }

  let candidateText = ''
  const titleText = normalizeText(title)
  if (titleText.startsWith('who will win ') && specific) {
    candidateText = specific
  } else {
    const match = titleText.match(/^will (.+?) win /)
    candidateText = match?.[1] ?? specific
  }
  if (/\bdemocrats?\b|\bdemocratic\b/.test(titleText)) candidateText = 'democrat'
  if (/\brepublicans?\b|\bgop\b/.test(titleText)) candidateText = 'republican'
  const candidate = candidateKey(candidateText)
  const year = yearFromText(fullText)
  if (!candidate || !scope || !year) return null
  return {
    type: 'election_winner_exact',
    key: `election|${office}|${scope}|${year}|${candidate}`,
    candidate,
    event: `${office} ${scope} ${year}`,
    eventTokens: normalizedTokenSet(`${office} ${scope} ${year}`),
    category: office,
    state: scope,
    year,
    score: 1,
  }
}

function outrightWinnerSignature(row) {
  const title = row.title || row.question || ''
  const specific = row.yes_sub_title || row.subtitle || row.groupItemTitle || ''
  const fullText = `${title} ${specific} ${row.rules_primary || ''} ${row.ticker || ''} ${row.slug || ''}`
  if (excludedWinnerProposition(fullText)) return null
  const match = normalizeText(title).match(/^will (?:the )?(.+?) win (?:the )?(.+)$/)
  if (!match) return null
  const candidate = normalizedKey(match[1])
  const event = match[2]
  const eventTokens = normalizedTokenSet(event)
  const category = eventCategory(event)
  if (!candidate || eventTokens.size < 2 || !category) return null
  return {
    type: 'outright_winner_exact',
    key: `winner|${category}|${yearFromText(fullText)}|${candidate}`,
    candidate,
    event,
    eventTokens,
    category,
    state: stateFromText(event),
    year: yearFromText(fullText),
    score: 0,
  }
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
    await sleep(20)
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
      await sleep(20)
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

function kalshiRow(market) {
  const yesBid = numberFrom(market.yes_bid_dollars)
  const yesAsk = numberFrom(market.yes_ask_dollars)
  if (yesBid === null || yesAsk === null) return null
  return {
    venue: 'kalshi',
    id: market.ticker,
    eventKey: market.event_ticker || '',
    question: [market.title, market.yes_sub_title].filter(Boolean).join(' '),
    title: market.title || '',
    yesBid,
    yesAsk,
    noAsk: numberFrom(market.no_ask_dollars, 1 - yesBid),
    closeTime: market.close_time || market.expected_expiration_time || market.expiration_time || '',
    liquidity: numberFrom(market.liquidity_dollars, 0),
    volume24h: numberFrom(market.volume_24h_fp, 0),
    signatures: [electionSignature(market), outrightWinnerSignature(market)].filter(Boolean),
  }
}

function polymarketRow(market) {
  const outcomes = parseJsonList(market.outcomes)
  const tokenIds = parseJsonList(market.clobTokenIds)
  if (outcomes.length !== 2 || tokenIds.length !== 2) return null
  const outcomeMap = new Map(outcomes.map((outcome, index) => [String(outcome).trim().toLowerCase(), String(tokenIds[index])]))
  if (!outcomeMap.has('yes') || !outcomeMap.has('no')) return null
  const yesBid = numberFrom(market.bestBid)
  const yesAsk = numberFrom(market.bestAsk)
  if (yesBid === null || yesAsk === null) return null
  return {
    venue: 'polymarket',
    id: String(market.id),
    eventKey: Array.isArray(market.events) ? market.events[0]?.slug || market.events[0]?.ticker || '' : market.slug || '',
    question: [market.question, market.groupItemTitle].filter(Boolean).join(' '),
    title: market.question || '',
    yesBid,
    yesAsk,
    noAsk: 1 - yesBid,
    closeTime: market.endDate || '',
    liquidity: numberFrom(market.liquidityNum ?? market.liquidityClob, 0),
    volume24h: numberFrom(market.volume24hr, 0),
    yesTokenId: outcomeMap.get('yes'),
    noTokenId: outcomeMap.get('no'),
    restricted: Boolean(market.restricted),
    signatures: [electionSignature(market), outrightWinnerSignature(market)].filter(Boolean),
  }
}

function currentEdgeForPair(pair, kalshiQuote = pair.kalshi, polymarketPrice = null) {
  const polyYesBid = polymarketPrice ?? pair.polymarket.yesBid
  const polyYesAsk = polymarketPrice ?? pair.polymarket.yesAsk
  const kalshiYesBid = kalshiQuote.yesBid
  const kalshiYesAsk = kalshiQuote.yesAsk
  if ([polyYesBid, polyYesAsk, kalshiYesBid, kalshiYesAsk].some((value) => value === null || value === undefined)) return null

  const kalshiYesEdge = polyYesBid - kalshiYesAsk
  const polyYesEdge = kalshiYesBid - polyYesAsk
  if (kalshiYesEdge >= polyYesEdge) {
    return {
      direction: 'buy_yes_kalshi_buy_no_polymarket',
      grossEdge: kalshiYesEdge,
      packageCost: kalshiYesAsk + (1 - polyYesBid),
      cheapYesPrice: kalshiYesAsk,
      richYesPrice: polyYesBid,
    }
  }
  return {
    direction: 'buy_yes_polymarket_buy_no_kalshi',
    grossEdge: polyYesEdge,
    packageCost: polyYesAsk + (1 - kalshiYesBid),
    cheapYesPrice: polyYesAsk,
    richYesPrice: kalshiYesBid,
  }
}

function buildComparablePairs(kalshiMarkets, polymarketMarkets) {
  const kalshiRows = kalshiMarkets.map(kalshiRow).filter((row) => row && row.signatures.length)
  const polymarketRows = polymarketMarkets.map(polymarketRow).filter((row) => row && row.signatures.length)
  const pairs = []
  const seen = new Set()
  const polymarketElectionByKey = new Map()
  const polymarketWinnerByCandidate = new Map()

  for (const polymarket of polymarketRows) {
    for (const signature of polymarket.signatures) {
      if (signature.type === 'election_winner_exact') polymarketElectionByKey.set(signature.key, { polymarket, signature })
      if (signature.type === 'outright_winner_exact') {
        const group = polymarketWinnerByCandidate.get(signature.candidate) ?? []
        group.push({ polymarket, signature })
        polymarketWinnerByCandidate.set(signature.candidate, group)
      }
    }
  }

  const addPair = (kalshi, polymarket, kalshiSignature, polymarketSignature, sourceId, score) => {
    const pairId = `${kalshi.id}|${polymarket.id}`
    if (seen.has(pairId)) return
    seen.add(pairId)
    const currentEdge = currentEdgeForPair({ kalshi, polymarket })
    pairs.push({
      pairId,
      sourceId,
      score,
      kalshi,
      polymarket,
      kalshiSignature,
      polymarketSignature,
      currentEdge,
      currentGrossEdge: currentEdge?.grossEdge ?? null,
      liquidityMin: Math.min(kalshi.liquidity ?? 0, polymarket.liquidity ?? 0),
      volume24hMin: Math.min(kalshi.volume24h ?? 0, polymarket.volume24h ?? 0),
    })
  }

  for (const kalshi of kalshiRows) {
    for (const kalshiSignature of kalshi.signatures) {
      if (kalshiSignature.type === 'election_winner_exact') {
        const match = polymarketElectionByKey.get(kalshiSignature.key)
        if (match) addPair(kalshi, match.polymarket, kalshiSignature, match.signature, 'election_winner_exact', 1)
      }
      if (kalshiSignature.type === 'outright_winner_exact') {
        for (const match of polymarketWinnerByCandidate.get(kalshiSignature.candidate) ?? []) {
          const polySignature = match.signature
          if (kalshiSignature.year && polySignature.year && kalshiSignature.year !== polySignature.year) continue
          if (kalshiSignature.category && polySignature.category && kalshiSignature.category !== polySignature.category) continue
          if (kalshiSignature.state && polySignature.state && kalshiSignature.state !== polySignature.state) continue
          const similarity = jaccard(kalshiSignature.eventTokens, polySignature.eventTokens)
          const minimumSimilarity = kalshiSignature.category === 'world_cup' || polySignature.category === 'world_cup' ? 0.45 : 0.72
          if (similarity < minimumSimilarity) continue
          addPair(kalshi, match.polymarket, kalshiSignature, polySignature, 'outright_winner_exact', round(similarity, 4))
        }
      }
    }
  }

  return pairs.sort(
    (left, right) =>
      (right.currentGrossEdge ?? -Infinity) - (left.currentGrossEdge ?? -Infinity) ||
      right.score - left.score ||
      left.pairId.localeCompare(right.pairId),
  )
}

async function kalshiCandles(pair, startTs, endTs) {
  const payload = await requestJson(`${kalshiBaseUrl}/series/${pair.kalshi.eventKey}/markets/${pair.kalshi.id}/candlesticks`, {
    params: {
      start_ts: startTs,
      end_ts: endTs,
      period_interval: config.candleIntervalMinutes,
    },
  })
  const byTs = new Map()
  for (const candle of payload.candlesticks ?? []) {
    byTs.set(Number(candle.end_period_ts), {
      yesBid: numberFrom(candle.yes_bid?.close_dollars),
      yesAsk: numberFrom(candle.yes_ask?.close_dollars),
    })
  }
  return byTs
}

async function polymarketHistory(pair, startTs, endTs) {
  const intervalSeconds = config.candleIntervalMinutes * 60
  const byTs = new Map()
  const maxWindowSeconds = 7 * 86400
  for (let chunkStart = startTs; chunkStart < endTs; chunkStart += maxWindowSeconds) {
    const chunkEnd = Math.min(endTs, chunkStart + maxWindowSeconds)
    let payload = null
    try {
      payload = await requestJson(`${polymarketClobUrl}/prices-history`, {
        params: {
          market: pair.polymarket.yesTokenId,
          startTs: chunkStart,
          endTs: chunkEnd,
          fidelity: config.candleIntervalMinutes,
        },
      })
    } catch (error) {
      if (error.status !== 400) throw error
      continue
    }
    for (const point of payload.history ?? []) {
      const price = numberFrom(point.p)
      if (price === null) continue
      const bucket = Math.floor(Number(point.t) / intervalSeconds) * intervalSeconds
      byTs.set(bucket, price)
    }
    await sleep(10)
  }
  return byTs
}

function observationFromEdge(pair, observedAt, observedDate, edge, split = null) {
  const grossEdgeCents = round(edge.grossEdge * 100, 4)
  const totalHaircutCents = round(config.feeHaircutCents + config.basisHaircutCents, 4)
  const netEdgeCents = Math.max(0, round(grossEdgeCents - totalHaircutCents, 4))
  const netEdge = netEdgeCents / 100
  const packageReturnPct = edge.packageCost > 0 ? (netEdge / edge.packageCost) * 100 : 0
  return {
    observedAt,
    observedDate,
    pairId: pair.pairId,
    sourceId: pair.sourceId,
    kalshiMarketId: pair.kalshi.id,
    polymarketMarketId: pair.polymarket.id,
    kalshiTitle: pair.kalshi.question,
    polymarketTitle: pair.polymarket.question,
    kalshiCloseTime: pair.kalshi.closeTime,
    polymarketCloseTime: pair.polymarket.closeTime,
    direction: edge.direction,
    grossEdge: grossEdgeCents / 100,
    grossEdgeCents,
    netEdge,
    netEdgeCents,
    packageCost: edge.packageCost,
    packageReturnPct,
    netReturnPct: packageReturnPct * (config.capitalAllocationPct / 100),
    confidence: Math.min(1, Math.max(0, netEdge * 18)),
    matchScore: pair.score,
    liquidityMin: pair.liquidityMin,
    volume24hMin: pair.volume24hMin,
    split,
  }
}

async function buildHistoricalObservations(pairs) {
  const endTs = Math.floor(generatedAt.getTime() / 1000)
  const startTs = Math.floor((generatedAt.getTime() - config.historyDays * 86400000) / 1000)
  const selectedPairs = pairs
    .filter((pair) => pair.kalshi.eventKey && pair.polymarket.yesTokenId)
    .slice(0, config.maxHistoricalPairs)
  const observations = []
  const failures = []
  for (let index = 0; index < selectedPairs.length; index += 1) {
    const pair = selectedPairs[index]
    if (index % 10 === 0) console.log(`cross-market history ${index + 1}/${selectedPairs.length}`)
    try {
      const [kalshiByTs, polyByTs] = await Promise.all([kalshiCandles(pair, startTs, endTs), polymarketHistory(pair, startTs, endTs)])
      for (const [ts, kalshiQuote] of kalshiByTs.entries()) {
        const polyPrice = polyByTs.get(ts)
        if (polyPrice === undefined) continue
        const edge = currentEdgeForPair(pair, kalshiQuote, polyPrice)
        if (!edge || edge.grossEdge <= 0 || edge.packageCost <= 0) continue
        const observedAt = new Date(ts * 1000).toISOString()
        observations.push(observationFromEdge(pair, observedAt, observedAt.slice(0, 10), edge))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({
        pairId: pair.pairId,
        sourceId: pair.sourceId,
        kalshiMarketId: pair.kalshi.id,
        polymarketMarketId: pair.polymarket.id,
        message,
      })
      console.log(`cross-market history failed ${pair.pairId}: ${message}`)
    }
    await sleep(35)
  }
  return {
    observations: observations.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.pairId.localeCompare(right.pairId)),
    pairsRequested: selectedPairs.length,
    pairsSucceeded: selectedPairs.length - failures.length,
    failures,
  }
}

function uniqueSortedValues(values) {
  return [...new Set(values)].sort((left, right) => left - right)
}

function splitDatesFromObservations(observations) {
  const dates = [...new Set(observations.map((observation) => observation.observedDate).filter(Boolean))].sort()
  const minDate = dates[0] ?? isoDate(generatedAt)
  const maxDate = dates.at(-1) ?? isoDate(generatedAt)
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

function splitForDate(date, splitDates) {
  if (date >= splitDates.holdoutStart) return 'holdout'
  if (date > splitDates.trainEnd && date <= splitDates.validationEnd) return 'validation'
  return 'train'
}

function selectTradesForCandidate(observations, candidate, splitDates) {
  const selected = []
  const lastByPair = new Map()
  for (const observation of observations) {
    if (observation.grossEdgeCents < candidate.minGrossEdgeCents) continue
    if (observation.netEdgeCents <= 0) continue
    const ts = Date.parse(observation.observedAt) / 1000
    const previousTs = lastByPair.get(observation.pairId)
    if (previousTs && (ts - previousTs) / 3600 < candidate.minSpacingHours) continue
    lastByPair.set(observation.pairId, ts)
    selected.push({
      ...observation,
      split: splitForDate(observation.observedDate, splitDates),
    })
  }
  return selected
}

function rowEntryDate(row) {
  return row.entryTradeDate ?? row.observedDate ?? row.signalDate ?? ''
}

function rowExitDate(row) {
  return row.exitTradeDate ?? rowEntryDate(row)
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
    elapsedDays: firstEntry && lastExit ? inclusiveCalendarDaysBetween(firstEntry, lastExit) : 1,
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
  const toQoreRows = trades.map((trade) => ({
    ...trade,
    entryTradeDate: trade.observedDate,
    exitTradeDate: trade.observedDate,
    portfolioAllocationPct: config.capitalAllocationPct,
  }))
  return {
    train: additiveMetricsFromRows(toQoreRows.filter((trade) => trade.split === 'train')),
    validation: additiveMetricsFromRows(toQoreRows.filter((trade) => trade.split === 'validation')),
    holdout: additiveMetricsFromRows(toQoreRows.filter((trade) => trade.split === 'holdout')),
    all: additiveMetricsFromRows(toQoreRows),
  }
}

function buildCandidates(observations, splitDates) {
  const candidates = []
  const configs = []
  const minGrossEdgeCentsValues = uniqueSortedValues([1, 1.5, 2, 3, 5, config.feeHaircutCents + config.basisHaircutCents])
  for (const minGrossEdgeCents of minGrossEdgeCentsValues) {
    for (const minSpacingHours of [1, 6, 24]) {
      configs.push({ minGrossEdgeCents, minSpacingHours })
    }
  }
  for (const candidate of configs) {
    const candidateId = `cross-edge-${String(candidate.minGrossEdgeCents).replace('.', 'p')}c-spacing-${candidate.minSpacingHours}h`
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
      feeHaircutCents: config.feeHaircutCents + config.basisHaircutCents,
      minSpacingHours: candidate.minSpacingHours,
      eligible: selectionEligible && holdoutTradeCount >= 8,
      selectionEligible,
      trainValidationRank: 0,
      trainEdgePct: splitEdges.train,
      validationEdgePct: splitEdges.validation,
      holdoutEdgePct: splitEdges.holdout,
      currentEdgePct: null,
      allEdgePct: splitEdges.all,
      trainReturnPct: splitMetrics.train.totalReturnPct,
      validationReturnPct: splitMetrics.validation.totalReturnPct,
      holdoutReturnPct: splitMetrics.holdout.totalReturnPct,
      currentReturnPct: null,
      trainSharpe: splitMetrics.train.sharpe,
      validationSharpe: splitMetrics.validation.sharpe,
      holdoutSharpe: splitMetrics.holdout.sharpe,
      currentSharpe: null,
      trainMaxDrawdownPct: splitMetrics.train.maxDrawdownPct,
      validationMaxDrawdownPct: splitMetrics.validation.maxDrawdownPct,
      holdoutMaxDrawdownPct: splitMetrics.holdout.maxDrawdownPct,
      currentMaxDrawdownPct: null,
      tradeCount: trades.length,
      holdoutTradeCount,
      currentTradeCount: null,
      averageNetReturnPct: round(mean(trades.map((trade) => trade.netReturnPct)), 4),
      averagePackageReturnPct: round(mean(trades.map((trade) => trade.packageReturnPct)), 4),
    })
  }
  candidates
    .sort((left, right) => right.trainEdgePct + right.validationEdgePct - (left.trainEdgePct + left.validationEdgePct) || right.tradeCount - left.tradeCount)
    .forEach((candidate, index) => {
      candidate.trainValidationRank = index + 1
    })
  return candidates
}

function selectedCandidate(candidates) {
  return (
    candidates.find((candidate) => candidate.selectionEligible) ??
    candidates.find((candidate) => candidate.eligible) ??
    candidates.find((candidate) => candidate.tradeCount > 0) ??
    candidates[0]
  )
}

function selectedScreenRealityCheck(trades, observations, candidate, dates) {
  const thresholdRows = observations.filter((observation) => observation.grossEdgeCents >= candidate.minGrossEdgeCents)
  const thresholdReturns = thresholdRows.map((observation) => observation.netReturnPct)
  const selectedReturns = trades.map((trade) => trade.netReturnPct)
  return {
    method: 'cross-venue-historical-quote-overlap-screen',
    comparison: 'threshold-qualified Kalshi/Polymarket quote-overlap rows after fee and basis haircuts',
    alternative: 'not-applicable',
    pValue: null,
    singleCandidatePValue: null,
    selectionAdjustedPValue: null,
    observedAverageDailyEdgePct: round(mean(thresholdReturns), 4),
    observedAnnualizedEdgePct: round(mean(thresholdReturns) * 252, 2),
    dailyActiveVolPct: round(std(thresholdReturns), 4),
    sampleCount: thresholdRows.length,
    selectedSampleCount: trades.length,
    activeOverlayDays: new Set(thresholdRows.map((observation) => observation.observedDate)).size,
    minimumResolvablePValue: null,
    positiveSelectedReturnRows: selectedReturns.filter((value) => value > 0).length,
    limitation:
      `Historical support uses overlapping hourly Kalshi bid/ask candles and Polymarket price-history rows across ${dates.length.toLocaleString()} observed days. It is quote-screen evidence, not settlement-confirmed fills.`,
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
      strategyId: 'prediction-cross-market-rv-alpha',
      variant: 'cross-venue-rv',
      observedAt: trade.observedAt,
      signalDate: trade.observedDate,
      issueDate: trade.observedDate,
      targetDate: trade.observedDate,
      entryTradeDate: trade.observedDate,
      exitTradeDate: trade.observedDate,
      targetTradeDate: trade.observedDate,
      direction: 'long',
      sourceId: trade.sourceId,
      windowId: 'cross-venue-rv',
      thesisKind: 'cross-venue-rv',
      leadDays: 1,
      confidence: round(trade.confidence, 4),
      weightedAnomalyF: round(trade.grossEdgeCents, 4),
      coveragePct: round(trade.matchScore * 100, 2),
      coldCoveragePct: 0,
      warmCoveragePct: 0,
      extremeCount: 0,
      grossReturnPct: round(trade.grossEdgeCents, 4),
      tradingCostPct: config.feeHaircutCents + config.basisHaircutCents,
      netReturnPct,
      indexReturnPct: 0,
      ungReturnPct: netReturnPct,
      ungPosition: 1,
      equity: round(equity, 2),
      equityPct: round(cumulativeReturnPct, 4),
      drawdownPct: round(cumulativeReturnPct - peakReturnPct, 4),
      rank: index + 1,
      pairId: trade.pairId,
      earlyMarketId: trade.kalshiMarketId,
      laterMarketId: trade.polymarketMarketId,
      earlyDeadline: trade.kalshiCloseTime,
      laterDeadline: trade.polymarketCloseTime,
      packageCost: round(trade.packageCost, 4),
      grossEdgePct: round(trade.grossEdgeCents, 4),
      packageReturnPct: round(trade.packageReturnPct, 4),
      portfolioAllocationPct: config.capitalAllocationPct,
      executableSize: '',
      liquidityMin: round(trade.liquidityMin, 4),
      volume24hMin: round(trade.volume24hMin, 4),
      split: trade.split,
    }
  })
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function main() {
  const releaseOutputLock = acquireOutputLock()
  if (!releaseOutputLock) {
    process.exitCode = 1
    return
  }
  try {
  mkdirSync(outputDir, { recursive: true })
  const [kalshiMarkets, polymarketMarkets] = await Promise.all([fetchKalshiMarkets(), fetchPolymarketMarkets()])
  const comparablePairs = buildComparablePairs(kalshiMarkets, polymarketMarkets)
  const currentSignals = comparablePairs
    .filter((pair) => pair.currentEdge && pair.currentEdge.grossEdge > 0)
    .map((pair) => observationFromEdge(pair, generatedAt.toISOString(), isoDate(generatedAt), pair.currentEdge, 'current'))
  const currentSelectedSignals = currentSignals.filter((signal) => signal.grossEdgeCents >= config.feeHaircutCents + config.basisHaircutCents && signal.netEdgeCents > 0)
  const historicalResult = await buildHistoricalObservations(comparablePairs)
  if (historicalResult.failures.length && !config.allowPartialHistory) {
    const failedIds = historicalResult.failures.map((failure) => failure.pairId).join(', ')
    throw new Error(
      `cross-market historical collection failed for ${historicalResult.failures.length}/${historicalResult.pairsRequested} pairs (${failedIds}); ` +
        'rerun with --allow-partial-history or QORE_CROSS_MARKET_ALLOW_PARTIAL_HISTORY=1 to write a partial artifact',
    )
  }
  const { observations } = historicalResult
  const { dates, minDate, maxDate, splitDates } = splitDatesFromObservations(observations)
  const candidates = buildCandidates(observations, splitDates)
  const selected = selectedCandidate(candidates)
  const selectedTrades = selectTradesForCandidate(
    observations,
    { minGrossEdgeCents: selected.minGrossEdgeCents, minSpacingHours: selected.minSpacingHours },
    splitDates,
  )
  const selectedMetrics = additiveMetricsFromRows(qoreTradeRows(selectedTrades))
  const selectedSplitMetrics = splitMetricsForTrades(selectedTrades)
  const selectedSplitEdges = splitEdgesForTrades(selectedTrades)
  const qoreRows = qoreTradeRows(selectedTrades)
  const realityCheck = selectedScreenRealityCheck(selectedTrades, observations, selected, dates)

  await writeCsv(resolve(outputDir, 'comparable-pairs.csv'), comparablePairs, [
    'pairId',
    'sourceId',
    'score',
    'currentGrossEdge',
    'liquidityMin',
    'volume24hMin',
  ])
  await writeCsv(resolve(outputDir, 'historical-observations.csv'), observations, [
    'observedAt',
    'observedDate',
    'pairId',
    'sourceId',
    'kalshiMarketId',
    'polymarketMarketId',
    'kalshiTitle',
    'polymarketTitle',
    'direction',
    'grossEdgeCents',
    'netEdgeCents',
    'packageCost',
    'packageReturnPct',
    'netReturnPct',
  ])
  await writeCsv(resolve(outputDir, 'cross-venue-signals.csv'), currentSignals, [
    'observedAt',
    'sourceId',
    'pairId',
    'direction',
    'grossEdgeCents',
    'netEdgeCents',
    'packageCost',
    'kalshiTitle',
    'kalshiMarketId',
    'polymarketTitle',
    'polymarketMarketId',
    'kalshiCloseTime',
    'polymarketCloseTime',
  ])
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
    'currentEdgePct',
    'allEdgePct',
    'trainReturnPct',
    'validationReturnPct',
    'holdoutReturnPct',
    'currentReturnPct',
    'trainSharpe',
    'validationSharpe',
    'holdoutSharpe',
    'currentSharpe',
    'trainMaxDrawdownPct',
    'validationMaxDrawdownPct',
    'holdoutMaxDrawdownPct',
    'currentMaxDrawdownPct',
    'tradeCount',
    'holdoutTradeCount',
    'currentTradeCount',
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
    generatedAt: generatedAt.toISOString(),
    strategyId: 'prediction-cross-market-rv-alpha',
    displayName: 'Prediction Cross-Market RV Alpha',
    data: {
      kalshiMarkets: kalshiMarkets.length,
      polymarketMarkets: polymarketMarkets.length,
      comparablePairs: comparablePairs.length,
      crossVenueSignals: currentSignals.length,
      crossVenueActionablePaperSignals: currentSelectedSignals.length,
      crossVenueExactBoxCandidates: comparablePairs.filter((pair) => pair.sourceId === 'election_winner_exact').length,
      crossVenueRelativeValuePaperSignals: currentSelectedSignals.length,
      crossVenueWatchlistSignals: Math.max(0, currentSignals.length - currentSelectedSignals.length),
      historicalPairsRequested: historicalResult.pairsRequested,
      historicalPairsSucceeded: historicalResult.pairsSucceeded,
      historicalPairsFailed: historicalResult.failures.length,
      historicalFailedPairIds: historicalResult.failures.map((failure) => failure.pairId),
      historicalAllowPartial: config.allowPartialHistory,
      historicalObservations: observations.length,
      historicalStartDate: minDate,
      historicalEndDate: maxDate,
      historyDaysRequested: config.historyDays,
      candleIntervalMinutes: config.candleIntervalMinutes,
      portfolioAllocationPct: config.capitalAllocationPct,
      feeHaircutCents: config.feeHaircutCents,
      basisHaircutCents: config.basisHaircutCents,
    },
    contract: {
      trainEnd: splitDates.trainEnd,
      validationEnd: splitDates.validationEnd,
      holdoutStart: splitDates.holdoutStart,
      feeHaircutCents: config.feeHaircutCents + config.basisHaircutCents,
      capitalAllocationPct: config.capitalAllocationPct,
      fallback: 'No idle capital allocation is modeled; rows represent detected cross-venue paper entries only.',
      selectionPolicy:
        'Comparable-market parsers are fixed before ranking: exact election-winner keys and same-candidate outright-winner keys with same year, category, and geography checks. Candidate threshold and spacing variants are ranked on train/validation quote-overlap diagnostics only; holdout is report-only.',
      signalTiming:
        'Use overlapping hourly Kalshi bid/ask candles and Polymarket price-history rows for historical support. The paper pair buys the cheap YES side and the rich NO side, then assumes convergence to close the quote gap.',
      overfitControl:
        `No loose fuzzy text match is auto-promoted. The selected split uses ${dates.length.toLocaleString()} unique observed days with hidden holdout starting ${splitDates.holdoutStart}; every pair remains subject to rule-text, settlement-source, fee, liquidity, restriction, and venue-basis review before paper or live execution.`,
    },
    selected: {
      candidateId: selected.candidateId,
      architectureLabel: 'Cross-venue comparable-market relative-value detector',
      sourceSetLabel: 'Kalshi public market data + Polymarket Gamma/CLOB metadata and price history',
      sourceIds: ['kalshi-public-markets', 'kalshi-candlesticks', 'polymarket-gamma', 'polymarket-clob-price-history'],
      minGrossEdgeCents: selected.minGrossEdgeCents,
      feeHaircutCents: config.feeHaircutCents + config.basisHaircutCents,
      minSpacingHours: selected.minSpacingHours,
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
      currentTopOpportunities: currentSelectedSignals
        .sort((left, right) => right.netEdgeCents - left.netEdgeCents)
        .slice(0, 20)
        .map((signal) => ({
          sourceId: signal.sourceId,
          direction: signal.direction,
          grossEdgeCents: round(signal.grossEdgeCents, 4),
          netEdgeCents: round(signal.netEdgeCents, 4),
          kalshiMarketId: signal.kalshiMarketId,
          polymarketMarketId: signal.polymarketMarketId,
          basisFlags: 'cross_venue_rule_text;settlement_source;venue_basis;historical_price_proxy',
        })),
    },
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
      selectedTrades: 'data/qore/research/strategy-agent-runs/prediction-cross-market-rv/selected-trades.csv',
      candidateSummary: 'data/qore/research/strategy-agent-runs/prediction-cross-market-rv/candidate-summary.csv',
      crossVenueSignals: 'data/qore/research/strategy-agent-runs/prediction-cross-market-rv/cross-venue-signals.csv',
      historicalObservations: 'data/qore/research/strategy-agent-runs/prediction-cross-market-rv/historical-observations.csv',
      comparablePairs: 'data/qore/research/strategy-agent-runs/prediction-cross-market-rv/comparable-pairs.csv',
    },
    caveat:
      'This is a research and paper-candidate artifact, not live routing. Historical rows use quote overlap and Polymarket price-history proxies rather than settlement-confirmed fills; rule text, depth, fees, restrictions, and venue-basis must still be reviewed.',
  })
  console.log(
    `saved prediction-cross-market-rv: ${comparablePairs.length} comparable pairs, ${observations.length} historical observations, ${qoreRows.length} selected paper rows`,
  )
  } finally {
    releaseOutputLock()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
