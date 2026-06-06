#!/usr/bin/env node
import { chmod, lstat, mkdir, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const quiet = process.argv.includes('--quiet')
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localBinDir = path.join(homedir(), '.local', 'bin')
const qoreBin = path.join(repoDir, 'bin', 'qore')
const qoreCommand = path.join(localBinDir, 'qore')
const oldQuantCommand = path.join(localBinDir, 'quant')
const oldQuantTarget = path.join(repoDir, 'bin', 'quant')
const zshrcPath = path.join(homedir(), '.zshrc')

function log(message) {
  if (!quiet) console.log(message)
}

async function pathExists(filePath) {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

async function removeOldQuantCommand() {
  try {
    const target = await readlink(oldQuantCommand)
    const resolved = path.resolve(path.dirname(oldQuantCommand), target)
    if (target === oldQuantTarget || resolved === oldQuantTarget || target.includes('/QORE/bin/quant')) {
      await unlink(oldQuantCommand)
      log(`Removed old command: ${oldQuantCommand}`)
    }
  } catch {
    // No old command, or it was not a symlink owned by this repo.
  }
}

async function installQoreCommand() {
  await mkdir(localBinDir, { recursive: true })
  await chmod(qoreBin, 0o755)

  try {
    const target = await readlink(qoreCommand)
    const resolved = path.resolve(path.dirname(qoreCommand), target)
    if (target === qoreBin || resolved === qoreBin) {
      log(`QORE command already installed: ${qoreCommand}`)
      return true
    }
    log(`QORE command already exists and points somewhere else: ${qoreCommand}`)
    log(`Leave it alone or repoint it manually to: ${qoreBin}`)
    return false
  } catch {
    if (await pathExists(qoreCommand)) {
      log(`QORE command already exists and is not a symlink: ${qoreCommand}`)
      log(`Leave it alone or replace it manually with a symlink to: ${qoreBin}`)
      return false
    }
  }

  await symlink(qoreBin, qoreCommand)
  log(`Installed command: ${qoreCommand}`)
  return true
}

async function ensureLocalBinOnZshPath() {
  const exportLine = 'export PATH="$HOME/.local/bin:$PATH"'
  let contents = ''
  try {
    contents = await readFile(zshrcPath, 'utf8')
  } catch {
    // The file will be created below.
  }

  if (contents.includes('$HOME/.local/bin') || contents.includes(`${homedir()}/.local/bin`)) return false

  const prefix = contents && !contents.endsWith('\n') ? '\n' : ''
  await writeFile(zshrcPath, `${contents}${prefix}${exportLine}\n`, 'utf8')
  return true
}

await removeOldQuantCommand()
const installed = await installQoreCommand()
const updatedPath = await ensureLocalBinOnZshPath()

if (!quiet) {
  if (installed) console.log('Launch QORE with: qore')
  if (updatedPath) console.log('Open a new terminal, or run: source ~/.zshrc')
}
