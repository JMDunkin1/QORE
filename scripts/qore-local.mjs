#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'

const repoDir = path.resolve(process.cwd())
const host = '127.0.0.1'
const viteBin = path.join(repoDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
const rawViteArgs = process.argv.slice(2)
const preferredDashboardPort = normalizePort(optionValue(rawViteArgs, '--port') ?? process.env.QORE_PORT) ?? 5173
const preferredServicePort = normalizePort(
  process.env.QORE_DASHBOARD_SERVICE_PORT ?? process.env.QORE_API_PORT,
) ?? 4775
const dashboardFallbackLimit = positiveInteger(process.env.QORE_PORT_FALLBACK_LIMIT) ?? 50
const serviceFallbackLimit = positiveInteger(process.env.QORE_DASHBOARD_SERVICE_PORT_FALLBACK_LIMIT) ?? 50

function optionValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

function withoutOption(args, name, consumesValue = true) {
  const result = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === name) {
      if (consumesValue && args[index + 1] !== undefined && !args[index + 1].startsWith('--')) index += 1
      continue
    }
    if (arg.startsWith(`${name}=`)) continue
    result.push(arg)
  }
  return result
}

function normalizePort(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 && numeric < 65536 ? numeric : null
}

function positiveInteger(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

function portIsAvailable(port, excludedPorts = new Set()) {
  if (excludedPorts.has(port)) return Promise.resolve(false)
  return new Promise((resolve) => {
    const server = createNetServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen({ host, port })
  })
}

async function firstAvailablePort(preferredPort, fallbackLimit, label, excludedPorts = new Set()) {
  for (let offset = 0; offset < fallbackLimit; offset += 1) {
    const candidate = preferredPort + offset
    if (candidate >= 65536) break
    if (await portIsAvailable(candidate, excludedPorts)) return candidate
  }
  throw new Error(`No open ${label} found starting at ${preferredPort}.`)
}

if (!existsSync(viteBin)) {
  console.error('Vite is not installed. Run npm install first.')
  process.exit(1)
}

const dashboardPort = await firstAvailablePort(preferredDashboardPort, dashboardFallbackLimit, 'QORE dashboard port')
const servicePort = await firstAvailablePort(
  preferredServicePort,
  serviceFallbackLimit,
  'QORE telemetry service port',
  new Set([dashboardPort]),
)
if (dashboardPort !== preferredDashboardPort) {
  console.log(`QORE dashboard port ${preferredDashboardPort} is busy; using ${dashboardPort}.`)
}
if (servicePort !== preferredServicePort) {
  console.log(`QORE telemetry service port ${preferredServicePort} is busy; using ${servicePort}.`)
}

let viteArgs = withoutOption(rawViteArgs, '--host')
viteArgs = withoutOption(viteArgs, '--port')
viteArgs = withoutOption(viteArgs, '--strictPort', false)
viteArgs.push('--host', host, '--port', String(dashboardPort), '--strictPort')

const dashboardOrigins = [`http://${host}:${dashboardPort}`, `http://localhost:${dashboardPort}`]
const serviceBaseUrl = `http://${host}:${servicePort}`
const commonEnv = {
  ...process.env,
  QORE_REPO_DIR: repoDir,
  QORE_COMMAND_BRIDGE_PORT: String(servicePort),
  QORE_DASHBOARD_SERVICE_ALLOWED_ORIGINS: dashboardOrigins.join(','),
  VITE_QORE_API_URL: serviceBaseUrl,
}

function spawnChild(command, args) {
  return spawn(command, args, {
    cwd: repoDir,
    env: commonEnv,
    stdio: 'inherit',
  })
}

console.log(`QORE dashboard: http://${host}:${dashboardPort}`)
console.log(`QORE M1 telemetry bridge: ${serviceBaseUrl}`)

const service = spawnChild(process.execPath, ['scripts/qore-command-bridge.mjs'])
const vite = spawnChild(viteBin, viteArgs)
let shuttingDown = false

function stopChildren(signal) {
  if (shuttingDown) return
  shuttingDown = true
  if (!service.killed) service.kill(signal)
  if (!vite.killed) vite.kill(signal)
}

service.on('error', (error) => {
  console.error(`Could not start QORE M1 telemetry bridge: ${error.message}`)
  stopChildren('SIGTERM')
  process.exitCode = 1
})

vite.on('error', (error) => {
  console.error(`Could not start Vite: ${error.message}`)
  stopChildren('SIGTERM')
  process.exitCode = 1
})

service.on('exit', (code, signal) => {
  if (shuttingDown) return
  console.error(`QORE M1 telemetry bridge stopped (${code ?? signal ?? 'unknown'}).`)
  stopChildren('SIGTERM')
  process.exitCode = code || 1
})

vite.on('exit', (code, signal) => {
  if (shuttingDown) return
  if (code) console.error(`Vite stopped (${code ?? signal ?? 'unknown'}).`)
  stopChildren('SIGTERM')
  process.exitCode = code ?? 0
})

process.on('SIGTERM', () => stopChildren('SIGTERM'))
process.on('SIGINT', () => stopChildren('SIGINT'))
