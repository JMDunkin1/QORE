import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import path from 'node:path'

export function tokenFileForRepo(repoDir, env = process.env) {
  return env.QORE_GIT_SERVICE_TOKEN_FILE
    ? path.resolve(repoDir, env.QORE_GIT_SERVICE_TOKEN_FILE)
    : path.join(repoDir, '.local', 'qore', 'git-service-token')
}

export async function readOrCreateServiceToken(repoDir, env = process.env) {
  const envToken = String(env.QORE_GIT_SERVICE_TOKEN ?? '').trim()
  if (envToken) return envToken

  const tokenFile = tokenFileForRepo(repoDir, env)
  try {
    const existing = (await readFile(tokenFile, 'utf8')).trim()
    if (existing.length >= 32) return existing
  } catch {
    // Missing token files are expected on first install.
  }

  const token = randomBytes(32).toString('hex')
  await mkdir(path.dirname(tokenFile), { recursive: true })
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 })
  await chmod(tokenFile, 0o600).catch(() => {})
  return token
}
