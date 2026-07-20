import { spawnSync } from 'node:child_process'

const acquisitionArtifactPrefixes = [
  'data/qore/fundamentals/eia/',
  'data/qore/market/yahoo/',
  'data/qore/weather/',
]

function safeRepoRelativePath(filePath) {
  if (!filePath || filePath.startsWith('/') || filePath.includes('\\')) return false
  const segments = filePath.split('/')
  return segments.every((segment) => segment && segment !== '.' && segment !== '..')
}

function isWriterOwnedAcquisitionPath(filePath) {
  if (!safeRepoRelativePath(filePath) || !/\.(?:csv|json)$/.test(filePath)) return false
  if (filePath === 'data/qore/runs/free-data-manifest.json') return true
  return acquisitionArtifactPrefixes.some((prefix) => filePath.startsWith(prefix))
}

export function statusEntriesFromPorcelain(output) {
  const records = output.split('\0')
  const entries = []
  const malformedRecords = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.length < 4 || record[2] !== ' ') {
      malformedRecords.push(record)
      continue
    }
    const status = record.slice(0, 2)
    const filePath = record.slice(3)
    const paths = [filePath]
    if (status.includes('R') || status.includes('C')) {
      const sourcePath = records[index + 1]
      if (sourcePath) paths.push(sourcePath)
      else malformedRecords.push(record)
      index += 1
    }
    entries.push({ status, paths })
  }
  return { entries, malformedRecords }
}

export function inspectGitWorkingTree(repoDir, env = process.env) {
  const status = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repoDir,
    encoding: 'utf8',
    env,
  })
  if (status.status !== 0) {
    return {
      readable: false,
      error: status.stderr.trim() || status.error?.message || 'Could not read Git working tree state.',
      changedPaths: [],
      codeOrConfigPaths: [],
      generatedArtifactPaths: [],
    }
  }

  const parsed = statusEntriesFromPorcelain(status.stdout)
  const allowedEntries = parsed.entries.filter(
    (entry) => [' M', '??'].includes(entry.status)
      && entry.paths.length === 1
      && isWriterOwnedAcquisitionPath(entry.paths[0]),
  )
  const disallowedEntries = parsed.entries.filter((entry) => !allowedEntries.includes(entry))
  const changedPaths = [...new Set(parsed.entries.flatMap((entry) => entry.paths))]
  const codeOrConfigPaths = [
    ...new Set([
      ...disallowedEntries.flatMap((entry) => entry.paths),
      ...parsed.malformedRecords.map((_, index) => `<malformed-git-status-record-${index + 1}>`),
    ]),
  ]
  return {
    readable: true,
    error: null,
    changedPaths,
    codeOrConfigPaths,
    generatedArtifactPaths: [...new Set(allowedEntries.flatMap((entry) => entry.paths))],
  }
}
