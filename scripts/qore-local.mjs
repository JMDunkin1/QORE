#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import path from 'node:path'

const repoDir = process.cwd()
const host = process.env.QORE_GIT_SERVICE_HOST ?? '127.0.0.1'
const port = Number(process.env.QORE_GIT_SERVICE_PORT ?? 4774)
const serviceUrl = `http://${host}:${port}/api/github/status`
const viteBin = path.join(repoDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')

function serviceIsRunning() {
  return new Promise((resolve) => {
    const req = request(serviceUrl, { method: 'GET', timeout: 900 }, (res) => {
      res.resume()
      resolve(res.statusCode && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

function spawnChild(command, args, options = {}) {
  return spawn(command, args, {
    cwd: repoDir,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })
}

if (!existsSync(viteBin)) {
  console.error('Vite is not installed. Run npm install first.')
  process.exit(1)
}

let service = null
if (!(await serviceIsRunning())) {
  service = spawnChild(process.execPath, ['scripts/qore-git-service.mjs'])
}

const vite = spawnChild(viteBin, ['--host', '127.0.0.1'])

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
