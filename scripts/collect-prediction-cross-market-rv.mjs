import { closeSync, createWriteStream, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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
  historyDays: numberEnv('QORE_CROSS_MARKET_HISTORY_DAYS', 365),
  maxHistoricalPairs: numberEnv('QORE_CROSS_MARKET_MAX_HISTORICAL_PAIRS', 80),
  kalshiPages: optionalNumberEnv('QORE_CROSS_MARKET_KALSHI_PAGES'),
  polymarketPages: optionalNumberEnv('QORE_CROSS_MARKET_POLYMARKET_PAGES'),
  candleIntervalMinutes: numberEnv('QORE_CROSS_MARKET_CANDLE_INTERVAL_MINUTES', 60),
  feeHaircutCents: numberEnv('QORE_CROSS_MARKET_FEE_HAIRCUT_CENTS', 1),
  basisHaircutCents: numberEnv('QORE_CROSS_MARKET_BASIS_HAIRCUT_CENTS', 0.5),
  capitalAllocationPct: numberEnv('QORE_CROSS_MARKET_CAPITAL_ALLOCATION_PCT', 1),
  holdoutDays: numberEnv('QORE_CROSS_MARKET_HOLDOUT_DAYS', 90),
  validationDays: numberEnv('QORE_CROSS_MARKET_VALIDATION_DAYS', 60),
  monteCarloIterations: numberEnv('QORE_CROSS_MARKET_MONTE_CARLO_ITERATIONS', 1000),
  maxConcurrentExposurePct: numberEnv('QORE_CROSS_MARKET_MAX_CONCURRENT_EXPOSURE_PCT', 50),
  minTrainTrades: numberEnv('QORE_CROSS_MARKET_MIN_TRAIN_TRADES', 75),
  minValidationTrades: numberEnv('QORE_CROSS_MARKET_MIN_VALIDATION_TRADES', 20),
  minValidationReturnPct: numberEnv('QORE_CROSS_MARKET_MIN_VALIDATION_RETURN_PCT', 1),
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

function addCalendarDays(dateString, days) {
  const parsed = Date.parse(`${dateString}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return dateString
  const date = new Date(parsed)
  date.setUTCDate(date.getUTCDate() + days)
  return isoDate(date)
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
  const byTs = new Map()
  const maxWindowSeconds = 30 * 86400
  for (let chunkStart = startTs; chunkStart < endTs; chunkStart += maxWindowSeconds) {
    const chunkEnd = Math.min(endTs, chunkStart + maxWindowSeconds)
    let payload = null
    try {
      payload = await requestJson(`${kalshiBaseUrl}/series/${pair.kalshi.eventKey}/markets/${pair.kalshi.id}/candlesticks`, {
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
      byTs.set(Number(candle.end_period_ts), {
        yesBid: numberFrom(candle.yes_bid?.close_dollars),
        yesAsk: numberFrom(candle.yes_ask?.close_dollars),
      })
    }
    await sleep(120)
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
  const netEdgeCents = round(grossEdgeCents - totalHaircutCents, 4)
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
        if (!edge || edge.packageCost <= 0) continue
        const observedAt = new Date(ts * 1000).toISOString()
        observations.push({
          ...observationFromEdge(pair, observedAt, observedAt.slice(0, 10), edge),
          ts,
          kalshiYesBid: kalshiQuote.yesBid,
          kalshiYesAsk: kalshiQuote.yesAsk,
          polymarketYesPrice: polyPrice,
        })
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
  const requestedHoldoutStart = addCalendarDays(maxDate, -(config.holdoutDays - 1))
  const requestedHoldoutStartIndex = dates.findIndex((date) => date >= requestedHoldoutStart)
  const fallbackHoldoutStartIndex = Math.floor(dates.length * 0.75)
  const minimumPreHoldoutDays = Math.min(60, Math.max(20, config.validationDays))
  const holdoutStartIndex =
    requestedHoldoutStartIndex >= minimumPreHoldoutDays
      ? requestedHoldoutStartIndex
      : Math.max(1, Math.min(fallbackHoldoutStartIndex, dates.length - 1))
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

function observationsByPair(observations) {
  const byPair = new Map()
  for (const observation of observations) {
    const rows = byPair.get(observation.pairId) ?? []
    rows.push(observation)
    byPair.set(observation.pairId, rows)
  }
  for (const rows of byPair.values()) rows.sort((left, right) => left.ts - right.ts)
  return byPair
}

function exitObservationFor(entry, rows, holdHours) {
  const targetTs = entry.ts + holdHours * 3600
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

function packageValueForDirection(direction, exit) {
  if (direction === 'buy_yes_kalshi_buy_no_polymarket') {
    return exit.kalshiYesBid + (1 - exit.polymarketYesPrice)
  }
  return exit.polymarketYesPrice + (1 - exit.kalshiYesAsk)
}

function markedTradeFromObservation(entry, exit, candidate) {
  const exitPackageValue = packageValueForDirection(entry.direction, exit)
  if (!Number.isFinite(exitPackageValue) || entry.packageCost <= 0) return null
  const grossPackageReturnPct = ((exitPackageValue - entry.packageCost) / entry.packageCost) * 100
  const haircutReturnPct = ((config.feeHaircutCents + config.basisHaircutCents) / 100 / entry.packageCost) * 100
  const packageReturnPct = grossPackageReturnPct - haircutReturnPct
  return {
    ...entry,
    exitObservedAt: exit.observedAt,
    exitObservedDate: exit.observedDate,
    exitPackageValue,
    holdHours: candidate.holdHours,
    entryGrossEdgeCents: entry.grossEdgeCents,
    entryNetEdgeCents: entry.netEdgeCents,
    grossPackageReturnPct,
    haircutReturnPct,
    packageReturnPct,
    netReturnPct: packageReturnPct * (config.capitalAllocationPct / 100),
  }
}

function passesCandidateEntryRules(observation, candidate) {
  if (observation.grossEdgeCents < candidate.minGrossEdgeCents) return false
  if (observation.netEdgeCents <= 0) return false
  return true
}

function selectTradesForCandidate(observations, byPair, candidate, splitDates) {
  const selected = []
  const lastByPair = new Map()
  for (const observation of observations) {
    if (!passesCandidateEntryRules(observation, candidate)) continue
    const ts = Date.parse(observation.observedAt) / 1000
    const previousTs = lastByPair.get(observation.pairId)
    if (previousTs && (ts - previousTs) / 3600 < candidate.minSpacingHours) continue
    const exit = exitObservationFor(observation, byPair.get(observation.pairId) ?? [], candidate.holdHours)
    if (!exit) continue
    const markedTrade = markedTradeFromObservation(observation, exit, candidate)
    if (!markedTrade) continue
    lastByPair.set(observation.pairId, ts)
    selected.push({
      ...markedTrade,
      split: splitForDate(observation.observedDate, splitDates),
    })
  }
  return selected
}

function selectCurrentSignalsForCandidate(signals, candidate) {
  const selected = []
  const lastByPair = new Map()
  for (const signal of signals) {
    if (!passesCandidateEntryRules(signal, candidate)) continue
    const ts = Date.parse(signal.observedAt) / 1000
    const previousTs = lastByPair.get(signal.pairId)
    if (previousTs && (ts - previousTs) / 3600 < candidate.minSpacingHours) continue
    lastByPair.set(signal.pairId, ts)
    selected.push(signal)
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

function metricRowsForTrades(trades) {
  return trades.map((trade) => ({
    ...trade,
    entryTradeDate: trade.observedDate,
    exitTradeDate: trade.exitObservedDate ?? trade.observedDate,
    portfolioAllocationPct: config.capitalAllocationPct,
  }))
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
  const toQoreRows = metricRowsForTrades(trades)
  return {
    train: additiveMetricsFromRows(toQoreRows.filter((trade) => trade.split === 'train')),
    validation: additiveMetricsFromRows(toQoreRows.filter((trade) => trade.split === 'validation')),
    holdout: additiveMetricsFromRows(toQoreRows.filter((trade) => trade.split === 'holdout')),
    all: additiveMetricsFromRows(toQoreRows),
  }
}

function maxConcurrentExposurePctForTrades(trades) {
  const events = []
  for (const trade of trades) {
    const entryTs = Date.parse(trade.observedAt)
    const exitTs = Date.parse(trade.exitObservedAt)
    if (!Number.isFinite(entryTs) || !Number.isFinite(exitTs)) continue
    events.push([entryTs, 1])
    events.push([exitTs, -1])
  }
  events.sort((left, right) => left[0] - right[0] || right[1] - left[1])

  let concurrent = 0
  let maxConcurrent = 0
  for (const [, delta] of events) {
    concurrent += delta
    maxConcurrent = Math.max(maxConcurrent, concurrent)
  }
  return round(maxConcurrent * config.capitalAllocationPct, 4)
}

function splitMaxConcurrentExposureForTrades(trades) {
  return {
    train: maxConcurrentExposurePctForTrades(trades.filter((trade) => trade.split === 'train')),
    validation: maxConcurrentExposurePctForTrades(trades.filter((trade) => trade.split === 'validation')),
    holdout: maxConcurrentExposurePctForTrades(trades.filter((trade) => trade.split === 'holdout')),
    all: maxConcurrentExposurePctForTrades(trades),
  }
}

function buildCandidates(observations, byPair, splitDates) {
  const candidates = []
  const configs = []
  const minGrossEdgeCentsValues = uniqueSortedValues([1, 1.5, 2, 3, 5, 8, 10, 15, 20, 30, config.feeHaircutCents + config.basisHaircutCents])
  for (const minGrossEdgeCents of minGrossEdgeCentsValues) {
    for (const minSpacingHours of [1, 6, 12, 24, 48, 72, 168]) {
      for (const holdHours of [1, 6, 24, 72, 168, 336, 720]) {
        configs.push({ minGrossEdgeCents, minSpacingHours, holdHours })
      }
    }
  }
  for (const candidate of configs) {
    const candidateId = `cross-edge-${String(candidate.minGrossEdgeCents).replace('.', 'p')}c-spacing-${candidate.minSpacingHours}h-hold-${candidate.holdHours}h`
    const trades = selectTradesForCandidate(observations, byPair, candidate, splitDates)
    const splitEdges = splitEdgesForTrades(trades)
    const splitMetrics = splitMetricsForTrades(trades)
    const maxConcurrentExposure = splitMaxConcurrentExposureForTrades(trades)
    const trainTradeCount = trades.filter((trade) => trade.split === 'train').length
    const validationTradeCount = trades.filter((trade) => trade.split === 'validation').length
    const holdoutTradeCount = trades.filter((trade) => trade.split === 'holdout').length
    const trainValidationReturnPct = round(splitMetrics.train.totalReturnPct + splitMetrics.validation.totalReturnPct, 4)
    const trainValidationScore = round(
      trainValidationReturnPct +
        Math.min(splitMetrics.train.sharpe, 5) * 0.35 +
        Math.min(splitMetrics.validation.sharpe, 5) * 0.65 +
        Math.max(splitMetrics.train.maxDrawdownPct, -25) * 0.08 +
        Math.max(splitMetrics.validation.maxDrawdownPct, -25) * 0.12,
      4,
    )
    const selectionEligible =
      trainTradeCount >= config.minTrainTrades &&
      validationTradeCount >= config.minValidationTrades &&
      splitMetrics.train.totalReturnPct > 0 &&
      splitMetrics.validation.totalReturnPct >= config.minValidationReturnPct &&
      splitMetrics.train.maxDrawdownPct > -25 &&
      splitMetrics.validation.maxDrawdownPct > -25 &&
      maxConcurrentExposure.all <= config.maxConcurrentExposurePct &&
      maxConcurrentExposure.train <= config.maxConcurrentExposurePct &&
      maxConcurrentExposure.validation <= config.maxConcurrentExposurePct
    candidates.push({
      candidateId,
      minGrossEdgeCents: candidate.minGrossEdgeCents,
      feeHaircutCents: config.feeHaircutCents + config.basisHaircutCents,
      minSpacingHours: candidate.minSpacingHours,
      holdHours: candidate.holdHours,
      eligible: selectionEligible && holdoutTradeCount >= 25 && splitMetrics.holdout.totalReturnPct > 0,
      selectionEligible,
      trainValidationRank: 0,
      trainValidationScore,
      maxConcurrentExposurePct: maxConcurrentExposure.all,
      trainMaxConcurrentExposurePct: maxConcurrentExposure.train,
      validationMaxConcurrentExposurePct: maxConcurrentExposure.validation,
      holdoutMaxConcurrentExposurePct: maxConcurrentExposure.holdout,
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
      dailyReturnsPct: additiveDailyReturns(metricRowsForTrades(trades)).map((value) => value * 100),
    })
  }
  candidates
    .sort(
      (left, right) =>
        Number(right.selectionEligible) - Number(left.selectionEligible) ||
        right.trainValidationScore - left.trainValidationScore ||
        right.validationReturnPct - left.validationReturnPct ||
        right.tradeCount - left.tradeCount,
    )
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

function selectedScreenRealityCheck(trades, observations, candidate, dates, candidates) {
  const thresholdRows = observations.filter((observation) => observation.grossEdgeCents >= candidate.minGrossEdgeCents)
  const selectedReturns = trades.map((trade) => trade.netReturnPct)
  const selectedDailyReturnsPct = additiveDailyReturns(metricRowsForTrades(trades)).map((value) => value * 100)
  const candidateSeries = candidates
    .filter((entry) => entry.selectionEligible && entry.dailyReturnsPct?.length)
    .map((entry) => ({
      candidateId: entry.candidateId,
      observedMeanDailyEdgePct: mean(entry.dailyReturnsPct),
      values: entry.dailyReturnsPct,
    }))
  const candidateFamily = candidateSeries.length ? candidateSeries : [{ candidateId: candidate.candidateId, observedMeanDailyEdgePct: mean(selectedDailyReturnsPct), values: selectedDailyReturnsPct }]
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
    const nullMaxMean = Math.max(
      ...candidateFamily.map((entry) => meanFromSignFlip(entry.values, iteration, `${entry.candidateId}|family-null`)),
    )
    observedBootstrapMeans.push(bootstrapMean)
    nullSelectedMeans.push(nullSelectedMean)
    nullMaxMeans.push(nullMaxMean)
    if (nullSelectedMean >= observedAverageDailyEdgePct) singleCandidateExtreme += 1
    if (nullMaxMean >= observedAverageDailyEdgePct) selectionAdjustedExtreme += 1
  }

  const bestObservedCandidate = candidateFamily
    .slice()
    .sort((left, right) => right.observedMeanDailyEdgePct - left.observedMeanDailyEdgePct)[0]

  return {
    method: 'cross-venue-marked-quote-exit-block-bootstrap',
    comparison: 'selected marked quote-exit rows versus sign-flipped candidate-family null',
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
    candidateFamilySize: candidateFamily.length,
    bestObservedCandidateId: bestObservedCandidate?.candidateId ?? null,
    bestObservedAverageDailyEdgePct: bestObservedCandidate ? round(bestObservedCandidate.observedMeanDailyEdgePct, 4) : null,
    sampleCount: thresholdRows.length,
    selectedSampleCount: trades.length,
    activeOverlayDays: new Set(thresholdRows.map((observation) => observation.observedDate)).size,
    minimumResolvablePValue: round(1 / (iterations + 1), 4),
    iterations,
    blockLength,
    positiveSelectedReturnRows: selectedReturns.filter((value) => value > 0).length,
    negativeSelectedReturnRows: selectedReturns.filter((value) => value < 0).length,
    limitation:
      `Historical support uses overlapping hourly Kalshi bid/ask candles and Polymarket price-history rows across ${dates.length.toLocaleString()} observed days. Returns are marked to later available quotes, not settlement-confirmed fills.`,
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
      targetDate: trade.exitObservedDate ?? trade.observedDate,
      entryTradeDate: trade.observedDate,
      exitTradeDate: trade.exitObservedDate ?? trade.observedDate,
      targetTradeDate: trade.exitObservedDate ?? trade.observedDate,
      direction: 'long',
      sourceId: trade.sourceId,
      windowId: 'cross-venue-rv',
      thesisKind: 'cross-venue-rv',
      leadDays: round((trade.holdHours ?? config.candleIntervalMinutes / 60) / 24, 4),
      confidence: round(trade.confidence, 4),
      weightedAnomalyF: round(trade.grossEdgeCents, 4),
      coveragePct: round(trade.matchScore * 100, 2),
      coldCoveragePct: 0,
      warmCoveragePct: 0,
      extremeCount: 0,
      grossReturnPct: round(trade.grossPackageReturnPct, 4),
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
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  const stream = createWriteStream(tmpPath)
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
    const writtenRows = countCsvDataRows(tmpPath)
    if (writtenRows !== rows.length) {
      throw new Error(`wrote ${writtenRows} CSV rows to ${path}, expected ${rows.length}`)
    }
    renameSync(tmpPath, path)
    return writtenRows
  } catch (error) {
    stream.destroy()
    try {
      unlinkSync(tmpPath)
    } catch {
      // Best effort cleanup only.
    }
    throw error
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(tmpPath, path)
}

function countCsvDataRows(path) {
  const text = readFileSync(path, 'utf8')
  if (!text.length) return 0
  let rows = 0
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === '\n' && !quoted) {
      rows += 1
    }
  }
  if (!text.endsWith('\n')) rows += 1
  return Math.max(0, rows - 1)
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
  const historicalResult = await buildHistoricalObservations(comparablePairs)
  if (historicalResult.failures.length && !config.allowPartialHistory) {
    const failedIds = historicalResult.failures.map((failure) => failure.pairId).join(', ')
    throw new Error(
      `cross-market historical collection failed for ${historicalResult.failures.length}/${historicalResult.pairsRequested} pairs (${failedIds}); ` +
        'rerun with --allow-partial-history or QORE_CROSS_MARKET_ALLOW_PARTIAL_HISTORY=1 to write a partial artifact',
    )
  }
  const { observations } = historicalResult
  const byPair = observationsByPair(observations)
  const { dates, minDate, maxDate, requestedHoldoutStart, actualHoldoutDays, splitDates } = splitDatesFromObservations(observations)
  const candidates = buildCandidates(observations, byPair, splitDates)
  const selected = selectedCandidate(candidates)
  const currentSelectedSignals = selectCurrentSignalsForCandidate(currentSignals, selected)
  const selectedTrades = selectTradesForCandidate(
    observations,
    byPair,
    { minGrossEdgeCents: selected.minGrossEdgeCents, minSpacingHours: selected.minSpacingHours, holdHours: selected.holdHours },
    splitDates,
  )
  const selectedMetrics = additiveMetricsFromRows(qoreTradeRows(selectedTrades))
  const selectedSplitMetrics = splitMetricsForTrades(selectedTrades)
  const selectedSplitEdges = splitEdgesForTrades(selectedTrades)
  const qoreRows = qoreTradeRows(selectedTrades)
  const realityCheck = selectedScreenRealityCheck(selectedTrades, observations, selected, dates, candidates)

  await writeCsv(resolve(outputDir, 'comparable-pairs.csv'), comparablePairs, [
    'pairId',
    'sourceId',
    'score',
    'currentGrossEdge',
    'liquidityMin',
    'volume24hMin',
  ])
  const historicalObservationCsvRows = await writeCsv(resolve(outputDir, 'historical-observations.csv'), observations, [
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
    'kalshiYesBid',
    'kalshiYesAsk',
    'polymarketYesPrice',
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
    'holdHours',
    'eligible',
    'selectionEligible',
    'trainValidationRank',
    'trainValidationScore',
    'maxConcurrentExposurePct',
    'trainMaxConcurrentExposurePct',
    'validationMaxConcurrentExposurePct',
    'holdoutMaxConcurrentExposurePct',
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
      historicalObservations: historicalObservationCsvRows,
      historicalStartDate: minDate,
      historicalEndDate: maxDate,
      historyDaysRequested: config.historyDays,
      holdoutDaysRequested: config.holdoutDays,
      actualHoldoutDays,
      candleIntervalMinutes: config.candleIntervalMinutes,
      portfolioAllocationPct: config.capitalAllocationPct,
      maxConcurrentExposurePct: config.maxConcurrentExposurePct,
      minSelectionTrainTrades: config.minTrainTrades,
      minSelectionValidationTrades: config.minValidationTrades,
      minSelectionValidationReturnPct: config.minValidationReturnPct,
      feeHaircutCents: config.feeHaircutCents,
      basisHaircutCents: config.basisHaircutCents,
    },
    contract: {
      trainEnd: splitDates.trainEnd,
      validationEnd: splitDates.validationEnd,
      holdoutStart: splitDates.holdoutStart,
      requestedHoldoutStart,
      feeHaircutCents: config.feeHaircutCents + config.basisHaircutCents,
      capitalAllocationPct: config.capitalAllocationPct,
      fallback: 'No idle capital allocation is modeled; rows represent detected cross-venue paper entries only.',
      selectionPolicy:
        `Comparable-market parsers are fixed before ranking: exact election-winner keys and same-candidate outright-winner keys with same year, category, and geography checks. Candidate edge, spacing, and hold-time variants are ranked on train/validation marked quote-exit diagnostics only after requiring at least ${config.minTrainTrades} train rows, ${config.minValidationTrades} validation rows, ${config.minValidationReturnPct}% validation return, and no more than ${config.maxConcurrentExposurePct}% max concurrent canary exposure; holdout is report-only.`,
      signalTiming:
        'Use overlapping hourly Kalshi bid/ask candles and Polymarket price-history rows for historical support. The paper pair buys the cheap YES side and the rich NO side, then marks the package to a later available quote in the same convergence direction.',
      overfitControl:
        `No loose fuzzy text match is auto-promoted. The selected split uses ${dates.length.toLocaleString()} unique observed days with the requested last-${config.holdoutDays}-day hidden holdout starting ${splitDates.holdoutStart}; the search includes the failed 1/6/24-hour low-edge exits plus stricter high-edge/longer-hold convergence variants, and every pair remains subject to rule-text, settlement-source, fee, liquidity, restriction, and venue-basis review before paper or live execution.`,
    },
    selected: {
      candidateId: selected.candidateId,
      architectureLabel: 'Cross-venue comparable-market relative-value detector',
      sourceSetLabel: 'Kalshi public market data + Polymarket Gamma/CLOB metadata and price history',
      sourceIds: ['kalshi-public-markets', 'kalshi-candlesticks', 'polymarket-gamma', 'polymarket-clob-price-history'],
      minGrossEdgeCents: selected.minGrossEdgeCents,
      feeHaircutCents: config.feeHaircutCents + config.basisHaircutCents,
      minSpacingHours: selected.minSpacingHours,
      holdHours: selected.holdHours,
      capitalAllocationPct: config.capitalAllocationPct,
      maxConcurrentExposurePct: selected.maxConcurrentExposurePct,
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
