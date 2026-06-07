import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function parseEnvLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const separator = trimmed.indexOf('=')
  if (separator < 1) return null
  const key = trimmed.slice(0, separator).trim()
  let value = trimmed.slice(separator + 1).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  return [key, value]
}

export function loadLocalEnv(repoDir = process.cwd()) {
  const inheritedKeys = new Set(Object.keys(process.env))

  for (const fileName of ['.env', '.env.local']) {
    const filePath = path.join(repoDir, fileName)
    if (!existsSync(filePath)) continue
    const text = readFileSync(filePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const entry = parseEnvLine(line)
      if (!entry) continue
      const [key, value] = entry
      if (!inheritedKeys.has(key)) process.env[key] = value
    }
  }
}
