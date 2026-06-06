#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { readOrCreateServiceToken } from './qore-git-auth.mjs'

const label = 'com.qore.github-service'
const repoDir = process.cwd()
const launchAgentsDir = path.join(homedir(), 'Library', 'LaunchAgents')
const plistPath = path.join(launchAgentsDir, `${label}.plist`)
const logDir = path.join(homedir(), 'Library', 'Logs', 'QORE')
const nodePath = process.execPath
const scriptPath = path.join(repoDir, 'scripts', 'qore-git-service.mjs')
const serviceToken = await readOrCreateServiceToken(repoDir)
const launchPath = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

mkdirSync(launchAgentsDir, { recursive: true })
mkdirSync(logDir, { recursive: true })

try {
  execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, stdio: 'ignore' })
} catch {
  console.warn('Warning: origin remote is not configured, so GitHub updates will be disabled until you add one.')
  console.warn('Add one with: git remote add origin <git-url>')
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>QORE_REPO_DIR</key>
    <string>${xmlEscape(repoDir)}</string>
    <key>QORE_GIT_SERVICE_TOKEN</key>
    <string>${xmlEscape(serviceToken)}</string>
    <key>PATH</key>
    <string>${xmlEscape(launchPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logDir, 'github-service.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logDir, 'github-service.error.log'))}</string>
</dict>
</plist>
`

writeFileSync(plistPath, plist, 'utf8')

const domain = `gui/${process.getuid()}`
try {
  execFileSync('launchctl', ['bootout', domain, plistPath], { stdio: 'ignore' })
} catch {
  // The job may not be loaded yet.
}
execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'inherit' })
execFileSync('launchctl', ['kickstart', '-k', `${domain}/${label}`], { stdio: 'inherit' })

console.log(`Installed ${label} at ${plistPath}`)
