#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadLocalEnv } from './local-env.mjs'

const repoDir = process.cwd()
loadLocalEnv(repoDir)

const command = process.argv[2] ?? 'status'
const stateDir = path.resolve(process.env.QORE_LIVE_WEATHER_STATE_DIR ?? path.join(repoDir, '.local', 'qore', 'live-weather'))
const operatorStatePath = path.resolve(process.env.QORE_LIVE_OPERATOR_STATE_FILE ?? path.join(stateDir, 'operator-state.json'))

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

console.log(
  JSON.stringify(
    {
      serviceId: 'qore-live-kill-switch',
      file: path.relative(repoDir, operatorStatePath),
      killSwitchEngaged: state?.killSwitchEngaged ?? false,
      updatedAt: state?.updatedAt ?? null,
      reason: state?.reason ?? 'No operator-state file exists; derived default is clear.',
    },
    null,
    2,
  ),
)
