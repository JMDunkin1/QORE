#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const host = process.env.QORE_GIT_SERVICE_HOST ?? '127.0.0.1'
const port = Number(process.env.QORE_GIT_SERVICE_PORT ?? 4774)
const repoDir = process.env.QORE_REPO_DIR ?? process.cwd()
const checkIntervalMs = Number(process.env.QORE_GITHUB_CHECK_INTERVAL_MS ?? 5 * 60 * 1000)
const enableLaunchUpdate = process.env.QORE_GIT_SERVICE_LAUNCH_UPDATE !== '0'
const serviceStartedAt = new Date().toISOString()

let lastCheckedAt = null
let lastLaunchUpdateAt = null
let lastAction = 'Service started.'
let activeOperation = null
let latestStatus = null

function clean(value) {
  return String(value ?? '')
    .replace(/https:\/\/([^:\s/@]+):([^@\s]+)@/gi, 'https://$1:***@')
    .trim()
}

async function git(args, options = {}) {
  const { allowFailure = false, timeout = 60_000 } = options

  try {
    const result = await execFileAsync('git', args, {
      cwd: repoDir,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    })
    return {
      ok: true,
      stdout: clean(result.stdout),
      stderr: clean(result.stderr),
    }
  } catch (error) {
    const output = {
      ok: false,
      stdout: clean(error.stdout),
      stderr: clean(error.stderr || error.message),
    }
    if (allowFailure) return output
    throw new Error(output.stderr || output.stdout || `git ${args.join(' ')} failed`)
  }
}

async function currentBranch() {
  const branch = await git(['branch', '--show-current'], { allowFailure: true })
  return branch.ok && branch.stdout ? branch.stdout : 'main'
}

async function remoteUrl() {
  const remote = await git(['remote', 'get-url', 'origin'], { allowFailure: true })
  return remote.ok && remote.stdout ? remote.stdout : ''
}

async function fetchRemote(branch) {
  const remote = await remoteUrl()
  if (!remote) return { ok: false, reason: 'No origin remote is configured.' }

  const fetched = await git(['fetch', '--prune', 'origin', branch], { allowFailure: true, timeout: 120_000 })
  return fetched.ok ? { ok: true } : { ok: false, reason: fetched.stderr || fetched.stdout || 'GitHub fetch failed.' }
}

async function gitStatus(options = {}) {
  const { refresh = false } = options
  const branch = await currentBranch()
  const remote = await remoteUrl()
  const configured = Boolean(remote)
  let fetchError = ''

  if (refresh && configured) {
    const fetched = await fetchRemote(branch)
    if (!fetched.ok) fetchError = fetched.reason
  }

  const porcelain = await git(['status', '--porcelain=v1'], { allowFailure: true })
  const dirtyFiles = porcelain.stdout
    ? porcelain.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 20)
    : []
  const head = await git(['rev-parse', 'HEAD'], { allowFailure: true })
  const headShort = await git(['rev-parse', '--short', 'HEAD'], { allowFailure: true })
  const remoteHead = configured ? await git(['rev-parse', `origin/${branch}`], { allowFailure: true }) : { ok: false, stdout: '' }
  const remoteShort = configured ? await git(['rev-parse', '--short', `origin/${branch}`], { allowFailure: true }) : { ok: false, stdout: '' }
  const counts =
    configured && remoteHead.ok
      ? await git(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`], { allowFailure: true })
      : { ok: false, stdout: '' }
  const [aheadText = '0', behindText = '0'] = counts.stdout.split(/\s+/)
  const ahead = Number(aheadText) || 0
  const behind = Number(behindText) || 0

  lastCheckedAt = new Date().toISOString()
  latestStatus = {
    ok: !fetchError,
    configured,
    remoteUrl: remote,
    branch,
    currentCommit: head.ok ? head.stdout : '',
    currentShort: headShort.ok ? headShort.stdout : '',
    remoteCommit: remoteHead.ok ? remoteHead.stdout : '',
    remoteShort: remoteShort.ok ? remoteShort.stdout : '',
    ahead,
    behind,
    updateAvailable: behind > 0,
    dirty: dirtyFiles.length > 0,
    dirtyCount: dirtyFiles.length,
    dirtyFiles,
    lastCheckedAt,
    lastLaunchUpdateAt,
    lastAction,
    serviceStartedAt,
    liveUpdateMode: 'manual',
    launchUpdateMode: 'auto fast-forward',
    message: fetchError || (configured ? 'GitHub status current.' : 'No origin remote is configured.'),
  }

  return latestStatus
}

async function pullUpdates(reason) {
  const before = await gitStatus({ refresh: true })
  if (!before.configured) {
    lastAction = 'Update skipped: no origin remote.'
    return await gitStatus()
  }
  if (!before.updateAvailable) {
    lastAction = 'No GitHub update available.'
    return before
  }

  await git(['pull', '--ff-only', '--autostash', 'origin', before.branch], { timeout: 120_000 })
  if (reason === 'launch') lastLaunchUpdateAt = new Date().toISOString()
  lastAction = reason === 'launch' ? 'Launch update applied.' : 'Manual update applied.'
  return await gitStatus({ refresh: true })
}

async function pushChanges(message) {
  const before = await gitStatus({ refresh: true })
  if (!before.configured) throw new Error('No origin remote is configured.')
  if (before.behind > 0) throw new Error('GitHub has newer commits. Update before pushing.')

  if (before.dirty) {
    const commitMessage = String(message ?? '').trim()
    if (!commitMessage) throw new Error('A commit message is required for local changes.')
    await git(['add', '-A'], { timeout: 120_000 })
    const staged = await git(['diff', '--cached', '--quiet'], { allowFailure: true })
    if (staged.ok) {
      lastAction = 'No staged changes to commit.'
    } else {
      await git(['commit', '-m', commitMessage], { timeout: 120_000 })
      lastAction = 'Local changes committed.'
    }
  }

  const afterCommit = await gitStatus({ refresh: true })
  if (afterCommit.behind > 0) throw new Error('GitHub has newer commits. Update before pushing.')
  if (afterCommit.ahead === 0) {
    lastAction = 'Nothing to push.'
    return afterCommit
  }

  await git(['push', '-u', 'origin', afterCommit.branch], { timeout: 120_000 })
  lastAction = 'Changes pushed to GitHub.'
  return await gitStatus({ refresh: true })
}

async function exclusive(name, fn) {
  if (activeOperation) throw new Error(`Another Git operation is already running: ${activeOperation}.`)
  activeOperation = name
  try {
    return await fn()
  } finally {
    activeOperation = null
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  return JSON.parse(text)
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }

  try {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`)
    if (req.method === 'GET' && url.pathname === '/api/github/status') {
      const refresh = url.searchParams.get('refresh') === '1'
      const status = await exclusive('status check', () => gitStatus({ refresh }))
      sendJson(res, 200, { status })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/github/update') {
      const status = await exclusive('manual update', () => pullUpdates('manual'))
      sendJson(res, 200, { status })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/github/push') {
      const body = await readBody(req)
      const status = await exclusive('push', () => pushChanges(body.message))
      sendJson(res, 200, { status })
      return
    }

    sendJson(res, 404, { error: 'Not found.' })
  } catch (error) {
    sendJson(res, 500, { error: clean(error.message) })
  }
})

async function periodicCheck() {
  if (activeOperation) return
  try {
    await exclusive('scheduled status check', () => gitStatus({ refresh: true }))
  } catch (error) {
    lastAction = clean(error.message)
  }
}

server.listen(port, host, async () => {
  console.log(`QORE Git service listening on http://${host}:${port}`)
  try {
    if (enableLaunchUpdate) {
      await exclusive('launch update', () => pullUpdates('launch'))
    } else {
      await exclusive('initial status check', () => gitStatus({ refresh: true }))
    }
  } catch (error) {
    lastAction = clean(error.message)
    await gitStatus({ refresh: false }).catch(() => {
      latestStatus = {
        ok: false,
        configured: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        updateAvailable: false,
        dirty: false,
        dirtyCount: 0,
        dirtyFiles: [],
        lastCheckedAt,
        lastLaunchUpdateAt,
        lastAction,
        serviceStartedAt,
        liveUpdateMode: 'manual',
        launchUpdateMode: 'auto fast-forward',
        message: lastAction,
      }
    })
  }
})

setInterval(periodicCheck, checkIntervalMs)

process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))
