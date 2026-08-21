#!/usr/bin/env node
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux') {
  throw new Error('The QORE systemd installer must be run on the Linux VPS.')
}

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(repoDir, '.env.local')
if (!existsSync(envPath)) {
  throw new Error(`Missing ${envPath}. Create it from .env.live.example and configure paper or live mode first.`)
}
await chmod(envPath, 0o600)

// Installation only verifies static host/config prerequisites. Fresh signal,
// market, and risk handoffs are produced by the supervisor after it starts.
const readiness = spawnSync(process.execPath, [
  'scripts/qore-live-readiness.mjs',
  '--local-only',
  '--supervisor-prestart',
], {
  cwd: repoDir,
  env: process.env,
  encoding: 'utf8',
  stdio: 'inherit',
})
if (readiness.status !== 0) {
  throw new Error('Local readiness checks failed; the systemd service was not installed.')
}

function quoteUnitPath(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function escapeUnitDirectivePath(value) {
  return String(value)
    .replaceAll('\\', '\\x5c')
    .replaceAll(' ', '\\x20')
    .replaceAll('\t', '\\x09')
    .replaceAll('"', '\\x22')
    .replaceAll('%', '%%')
}

const unitDir = path.join(homedir(), '.config', 'systemd', 'user')
const unitPath = path.join(unitDir, 'qore-live-trading.service')
const unit = `[Unit]
Description=QORE live weather and Alpaca trading supervisor
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${escapeUnitDirectivePath(repoDir)}
Environment=TZ=UTC
ExecStartPre=${quoteUnitPath(process.execPath)} ${quoteUnitPath(path.join(repoDir, 'scripts', 'qore-live-readiness.mjs'))} --local-only --supervisor-prestart
ExecStart=${quoteUnitPath(process.execPath)} ${quoteUnitPath(path.join(repoDir, 'scripts', 'qore-live-trading-supervisor.mjs'))}
Restart=always
RestartSec=15
TimeoutStopSec=120
KillMode=control-group
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`

await mkdir(unitDir, { recursive: true })
await writeFile(unitPath, unit, { encoding: 'utf8', mode: 0o600 })

for (const args of [['--user', 'daemon-reload'], ['--user', 'enable', 'qore-live-trading.service']]) {
  const result = spawnSync('systemctl', args, { encoding: 'utf8', stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`systemctl ${args.join(' ')} failed.`)
}

console.log(`Installed ${unitPath}.`)
console.log('Before the first start, run: npm run trade:readiness')
console.log('Start it with: systemctl --user start qore-live-trading.service')
console.log('Follow it with: journalctl --user -u qore-live-trading.service -f')
console.log(`Keep the user service running after logout with: sudo loginctl enable-linger ${process.env.USER ?? '<user>'}`)
