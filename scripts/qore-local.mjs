#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import path from 'node:path'
import { readOrCreateServiceToken } from './qore-git-auth.mjs'

const launchAgentLabel = 'com.qore.github-service'
const repoDir = path.resolve(process.cwd())
const host = process.env.QORE_GIT_SERVICE_HOST ?? '127.0.0.1'
const servicePort = Number(process.env.QORE_GIT_SERVICE_PORT ?? 4774)
const serviceBaseUrl = `http://${host}:${servicePort}`
const serviceUrl = `${serviceBaseUrl}/api/github/status`
const viteBin = path.join(repoDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
const serviceToken = await readOrCreateServiceToken(repoDir)
const viteArgs = process.argv.slice(2)
if (!viteArgs.some((arg) => arg === '--host' || arg.startsWith('--host='))) {
  viteArgs.unshift('--host', '127.0.0.1')
}
const dashboardPort = await ensureVitePort()
const childEnv = {
  ...process.env,
  QORE_GIT_SERVICE_TOKEN: serviceToken,
  QORE_GIT_SERVICE_ALLOWED_ORIGINS: process.env.QORE_GIT_SERVICE_ALLOWED_ORIGINS ?? dashboardAllowedOrigins(),
  VITE_QORE_GIT_SERVICE_URL: serviceBaseUrl,
  VITE_QORE_GIT_SERVICE_TOKEN: serviceToken,
}

function headerListIncludes(value, expected) {
  return String(value ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .some((header) => header === '*' || header === expected)
}

function argValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const flagIndex = args.indexOf(name)
  return flagIndex >= 0 ? args[flagIndex + 1] : ''
}

function hasArg(args, name) {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

function normalizePort(value) {
  const candidate = Number(value)
  return Number.isInteger(candidate) && candidate > 0 && candidate < 65536 ? candidate : null
}

function portIsAvailable(portToCheck, hostToCheck) {
  return new Promise((resolve) => {
    const server = createNetServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen({ host: hostToCheck, port: portToCheck })
  })
}

async function firstAvailablePort(hostToCheck, preferredPort) {
  for (let offset = 0; offset < 50; offset += 1) {
    const candidate = preferredPort + offset
    if (candidate >= 65536) break
    if (await portIsAvailable(candidate, hostToCheck)) return candidate
  }
  throw new Error(`No open QORE dashboard port found starting at ${preferredPort}.`)
}

async function ensureVitePort() {
  const explicitPort = viteArgs.find((arg) => arg.startsWith('--port='))
  if (explicitPort) return normalizePort(explicitPort.slice('--port='.length)) ?? 5173
  const portFlagIndex = viteArgs.indexOf('--port')
  if (portFlagIndex >= 0) return normalizePort(viteArgs[portFlagIndex + 1]) ?? 5173

  const preferredPort = normalizePort(process.env.QORE_PORT) ?? 5173
  const dashboardHost = argValue(viteArgs, '--host') || '127.0.0.1'
  const selectedPort = await firstAvailablePort(dashboardHost, preferredPort)
  viteArgs.unshift('--port', String(selectedPort))
  if (!hasArg(viteArgs, '--strictPort')) viteArgs.unshift('--strictPort')
  if (selectedPort !== preferredPort) {
    console.log(`QORE dashboard port ${preferredPort} is busy; using ${selectedPort}.`)
  }
  return selectedPort
}

function vitePort() {
  return String(dashboardPort)
}

function dashboardOrigin() {
  return `http://127.0.0.1:${vitePort()}`
}

function dashboardAllowedOrigins() {
  return [dashboardOrigin(), `http://localhost:${vitePort()}`].join(',')
}

function serviceBrowserAccess() {
  return new Promise((resolve) => {
    const req = request(
      serviceUrl,
      {
        method: 'OPTIONS',
        timeout: 900,
        headers: {
          Origin: dashboardOrigin(),
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'x-qore-git-token',
        },
      },
      (res) => {
        res.resume()
        const allowHeaders = res.headers['access-control-allow-headers']
        if (res.statusCode === 403) {
          resolve('origin-denied')
          return
        }
        if ((res.statusCode ?? 500) >= 400) {
          resolve('incompatible')
          return
        }
        resolve(headerListIncludes(allowHeaders, 'x-qore-git-token') ? 'ok' : 'incompatible')
      },
    )
    req.on('error', () => resolve('down'))
    req.on('timeout', () => {
      req.destroy()
      resolve('down')
    })
    req.end()
  })
}

function serviceIsRunning() {
  return new Promise((resolve) => {
    const req = request(serviceUrl, { method: 'GET', timeout: 900, headers: { 'X-QORE-Git-Token': serviceToken } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', async () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          resolve('unauthorized')
          return
        }
        if (res.statusCode !== 200) {
          const browserAccess = await serviceBrowserAccess()
          resolve(browserAccess === 'ok' ? Boolean(res.statusCode) : browserAccess)
          return
        }
        try {
          const payload = JSON.parse(body)
          const runningRepoDir = payload?.status?.repoDir ? path.resolve(payload.status.repoDir) : ''
          if (!runningRepoDir) {
            resolve('incompatible')
            return
          }
          if (runningRepoDir && runningRepoDir !== repoDir) {
            resolve('wrong-repo')
            return
          }
        } catch {
          resolve('incompatible')
          return
        }
        const browserAccess = await serviceBrowserAccess()
        resolve(browserAccess === 'ok' ? true : browserAccess)
      })
      if (res.statusCode === 401 || res.statusCode === 403) {
        res.resume()
      }
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

function restartLaunchAgentService() {
  if (process.platform !== 'darwin') return false
  const serviceName = `gui/${process.getuid()}/${launchAgentLabel}`
  const result = spawnSync('launchctl', ['kickstart', '-k', serviceName], { stdio: 'ignore' })
  return result.status === 0
}

function spawnChild(command, args, options = {}) {
  return spawn(command, args, {
    cwd: repoDir,
    env: childEnv,
    stdio: 'inherit',
    ...options,
  })
}

if (!existsSync(viteBin)) {
  console.error('Vite is not installed. Run npm install first.')
  process.exit(1)
}

let service = null
let serviceState = await serviceIsRunning()
if (serviceState === 'down') serviceState = false
if (serviceState === 'incompatible' || serviceState === 'origin-denied') {
  const restartReason =
    serviceState === 'origin-denied' ? `allow ${dashboardOrigin()}` : 'refresh browser auth support'
  console.log(`Restarting QORE Git service to ${restartReason}...`)
  if (restartLaunchAgentService()) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      serviceState = await serviceIsRunning()
      if (serviceState === 'down') serviceState = false
      if (serviceState !== 'incompatible' && serviceState !== 'origin-denied' && serviceState !== false) break
    }
  }
}
if (serviceState === 'unauthorized') {
  console.error('QORE Git service is already running with a different token. Restart the service or set QORE_GIT_SERVICE_TOKEN to match it.')
  process.exit(1)
}
if (serviceState === 'wrong-repo') {
  console.error('QORE Git service is already running for a different checkout. Stop that service or use a different QORE_GIT_SERVICE_PORT.')
  process.exit(1)
}
if (serviceState === 'origin-denied') {
  console.error(`QORE Git service does not allow ${dashboardOrigin()}. Restart the service or add it to QORE_GIT_SERVICE_ALLOWED_ORIGINS.`)
  process.exit(1)
}
if (serviceState === 'incompatible') {
  console.error('QORE Git service is running with an older browser contract. Restart it with: launchctl kickstart -k gui/$(id -u)/com.qore.github-service')
  process.exit(1)
}
if (!serviceState) {
  service = spawnChild(process.execPath, ['scripts/qore-git-service.mjs'])
}

const vite = spawnChild(viteBin, viteArgs)

function shutdown(signal) {
  if (service && !service.killed) service.kill(signal)
  if (!vite.killed) vite.kill(signal)
}

vite.on('exit', (code) => {
  if (service && !service.killed) service.kill('SIGTERM')
  process.exit(code ?? 0)
})

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
