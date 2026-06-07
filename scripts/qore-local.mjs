#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import path from 'node:path'
import { readOrCreateServiceToken } from './qore-git-auth.mjs'

const launchAgentLabel = 'com.qore.github-service'
const repoDir = path.resolve(process.cwd())
const host = process.env.QORE_GIT_SERVICE_HOST ?? '127.0.0.1'
const port = Number(process.env.QORE_GIT_SERVICE_PORT ?? 4774)
const serviceBaseUrl = `http://${host}:${port}`
const serviceUrl = `${serviceBaseUrl}/api/github/status`
const viteBin = path.join(repoDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
const serviceToken = await readOrCreateServiceToken(repoDir)
const viteArgs = process.argv.slice(2)
if (!viteArgs.some((arg) => arg === '--host' || arg.startsWith('--host='))) {
  viteArgs.unshift('--host', '127.0.0.1')
}
const childEnv = {
  ...process.env,
  QORE_GIT_SERVICE_TOKEN: serviceToken,
  VITE_QORE_GIT_SERVICE_URL: serviceBaseUrl,
  VITE_QORE_GIT_SERVICE_TOKEN: serviceToken,
}

function headerListIncludes(value, expected) {
  return String(value ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .some((header) => header === '*' || header === expected)
}

function vitePort() {
  const explicitPort = viteArgs.find((arg) => arg.startsWith('--port='))
  if (explicitPort) return explicitPort.slice('--port='.length)
  const portFlagIndex = viteArgs.indexOf('--port')
  if (portFlagIndex >= 0) return viteArgs[portFlagIndex + 1] ?? '5173'
  return '5173'
}

function dashboardOrigin() {
  return `http://127.0.0.1:${vitePort()}`
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
if (serviceState === 'incompatible') {
  console.log('Restarting QORE Git service to refresh browser auth support...')
  if (restartLaunchAgentService()) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      serviceState = await serviceIsRunning()
      if (serviceState === 'down') serviceState = false
      if (serviceState !== 'incompatible' && serviceState !== false) break
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
  console.error(`QORE Git service does not allow ${dashboardOrigin()}. Use the default dashboard port or add it to QORE_GIT_SERVICE_ALLOWED_ORIGINS.`)
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
