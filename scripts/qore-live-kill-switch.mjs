#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'
import { resolveLiveWeatherPaths } from './lib/qore-live-paths.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const command = process.argv[2] ?? 'status'
const { operatorStatePath } = resolveLiveWeatherPaths(repoDir)

async function readState() {
  if (!existsSync(operatorStatePath)) return null
  return JSON.parse(await readFile(operatorStatePath, 'utf8'))
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : null
}

async function writeState(killSwitchEngaged) {
  const prior = await readState()
  const state = {
    ...(prior ?? {}),
    updatedAt: new Date().toISOString(),
    updatedBy: process.env.USER ?? 'qore-operator',
    killSwitchEngaged,
    reason: argValue('--reason') ?? (killSwitchEngaged ? 'Operator engaged emergency stop.' : 'Operator explicitly resumed trading.'),
  }
  await mkdir(path.dirname(operatorStatePath), { recursive: true })
  const temporaryPath = `${operatorStatePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, operatorStatePath)
  await chmod(operatorStatePath, 0o600)
  return state
}

let state
if (command === 'engage') {
  state = await writeState(true)
} else if (command === 'clear') {
  if (argValue('--confirm') !== 'RESUME_TRADING') {
    throw new Error('Clearing the kill switch requires --confirm=RESUME_TRADING.')
  }
  state = await writeState(false)
} else if (command === 'status') {
  state = await readState()
} else {
  throw new Error('Use status, engage, or clear.')
}

const stateValid = typeof state?.killSwitchEngaged === 'boolean'

console.log(
  JSON.stringify(
    {
      serviceId: 'qore-live-kill-switch',
      file: path.relative(repoDir, operatorStatePath),
      killSwitchEngaged: stateValid ? state.killSwitchEngaged : null,
      stateValid,
      blocked: !stateValid || state.killSwitchEngaged,
      updatedAt: state?.updatedAt ?? null,
      reason: stateValid
        ? state?.reason ?? (state.killSwitchEngaged ? 'Operator kill switch is engaged.' : 'Operator explicitly cleared the kill switch.')
        : state ? 'Operator-state file is invalid; killSwitchEngaged must be boolean.' : 'Operator-state file is missing; kill-switch state is UNKNOWN.',
    },
    null,
    2,
  ),
)
