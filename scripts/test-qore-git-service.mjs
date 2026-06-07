#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceScript = path.join(projectRoot, 'scripts', 'qore-git-service.mjs')
const allowedOrigin = 'http://127.0.0.1:5173'
let nextPort = 4874

async function run(command, args, cwd, options = {}) {
  return await execFileAsync(command, args, {
    cwd,
    timeout: options.timeout ?? 120_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(options.env ?? {}) },
  })
}

async function git(cwd, args, options = {}) {
  return await run('git', ['-c', 'user.name=QORE Test', '-c', 'user.email=qore-test@example.invalid', ...args], cwd, options)
}

async function write(repoDir, relativePath, contents) {
  const target = path.join(repoDir, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, contents, 'utf8')
}

async function commitAll(repoDir, message) {
  await git(repoDir, ['add', '-A'])
  await git(repoDir, ['commit', '-m', message])
}

async function createGitFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'qore-git-service-'))
  const remote = path.join(root, 'remote.git')
  const seed = path.join(root, 'seed')
  const repo = path.join(root, 'repo')

  await git(root, ['init', '--bare', remote])
  await mkdir(seed)
  await git(seed, ['init'])
  await git(seed, ['branch', '-M', 'main'])
  await write(seed, 'package.json', JSON.stringify({ name: 'qore-service-test', version: '1.0.0', private: true }, null, 2))
  await write(seed, 'data.txt', 'initial\n')
  await commitAll(seed, 'Initial commit')
  await git(seed, ['remote', 'add', 'origin', remote])
  await git(seed, ['push', '-u', 'origin', 'main'])
  await git(root, ['clone', remote, repo])
  await git(repo, ['checkout', 'main'])

  return { root, remote, seed, repo }
}

async function createRepoWithoutRemote() {
  const root = await mkdtemp(path.join(tmpdir(), 'qore-git-service-'))
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  await git(repo, ['init'])
  await git(repo, ['branch', '-M', 'main'])
  await write(repo, 'package.json', JSON.stringify({ name: 'qore-service-test', version: '1.0.0', private: true }, null, 2))
  await commitAll(repo, 'Initial commit')
  return { root, repo }
}

async function addRemoteCommit(fixture, relativePath, contents, message) {
  await write(fixture.seed, relativePath, contents)
  await commitAll(fixture.seed, message)
  await git(fixture.seed, ['push', 'origin', 'main'])
}

async function request(baseUrl, requestPath, options = {}) {
  const headers = {
    ...(options.origin === null ? {} : { Origin: options.origin ?? allowedOrigin }),
    ...(options.token === undefined ? {} : { 'X-QORE-Git-Token': options.token }),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  }
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

async function startService(repoDir, options = {}) {
  const port = nextPort++
  const token = options.token ?? `test-token-${port}-0123456789abcdef`
  const child = spawn(process.execPath, [serviceScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      QORE_REPO_DIR: repoDir,
      QORE_GIT_SERVICE_HOST: '127.0.0.1',
      QORE_GIT_SERVICE_PORT: String(port),
      QORE_GIT_SERVICE_TOKEN: token,
      QORE_GIT_SERVICE_LAUNCH_UPDATE: options.launchUpdate ? '1' : '0',
      QORE_GITHUB_CHECK_INTERVAL_MS: '3600000',
      QORE_GIT_SERVICE_ALLOWED_ORIGINS: allowedOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    if (child.exitCode !== null) throw new Error(`Service exited early:\n${output}`)
    try {
      const response = await request(baseUrl, '/api/github/status', { token })
      if (response.status === 200) return { baseUrl, token, child, output: () => output, stop: () => stopService(child) }
    } catch {
      // Service is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill('SIGTERM')
  throw new Error(`Timed out waiting for service:\n${output}`)
}

async function stopService(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function withFixture(createFixture, fn) {
  const fixture = await createFixture()
  try {
    await fn(fixture)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
}

const tests = [
  {
    name: 'requires a service token and blocks unexpected origins',
    run: () =>
      withFixture(createGitFixture, async ({ repo }) => {
        const service = await startService(repo)
        try {
          const noToken = await request(service.baseUrl, '/api/github/status')
          assert.equal(noToken.status, 401)
          const badOrigin = await request(service.baseUrl, '/api/github/status', { token: service.token, origin: 'http://example.invalid' })
          assert.equal(badOrigin.status, 403)
          const ok = await request(service.baseUrl, '/api/github/status', { token: service.token })
          assert.equal(ok.status, 200)
          assert.equal(ok.payload.status.repoDir, repo)
        } finally {
          await service.stop()
        }
      }),
  },
  {
    name: 'reports a repo without origin as not configured',
    run: () =>
      withFixture(createRepoWithoutRemote, async ({ repo }) => {
        const service = await startService(repo)
        try {
          const status = (await request(service.baseUrl, '/api/github/status', { token: service.token })).payload.status
          assert.equal(status.configured, false)
          assert.equal(status.updateAvailable, false)
        } finally {
          await service.stop()
        }
      }),
  },
  {
    name: 'fast-forwards a clean repo on manual update',
    run: () =>
      withFixture(createGitFixture, async (fixture) => {
        const service = await startService(fixture.repo)
        try {
          await addRemoteCommit(fixture, 'data.txt', 'remote update\n', 'Remote update')
          const update = await request(service.baseUrl, '/api/github/update', { method: 'POST', token: service.token })
          assert.equal(update.status, 200)
          assert.equal(update.payload.status.behind, 0)
          assert.match(await readFile(path.join(fixture.repo, 'data.txt'), 'utf8'), /remote update/)
        } finally {
          await service.stop()
        }
      }),
  },
  {
    name: 'skips launch update when the working tree is dirty',
    run: () =>
      withFixture(createGitFixture, async (fixture) => {
        await addRemoteCommit(fixture, 'data.txt', 'remote launch update\n', 'Remote launch update')
        await write(fixture.repo, 'local-notes.txt', 'dirty local work\n')
        const service = await startService(fixture.repo, { launchUpdate: true })
        try {
          const status = (await request(service.baseUrl, '/api/github/status', { token: service.token })).payload.status
          assert.match(status.lastAction, /Launch update skipped/)
          assert.equal(status.dirty, true)
          assert.equal(status.behind, 1)
          assert.match(await readFile(path.join(fixture.repo, 'data.txt'), 'utf8'), /initial/)
        } finally {
          await service.stop()
        }
      }),
  },
  {
    name: 'runs npm install when package files change during update',
    run: () =>
      withFixture(createGitFixture, async (fixture) => {
        const service = await startService(fixture.repo)
        try {
          await addRemoteCommit(
            fixture,
            'package.json',
            `${JSON.stringify({ name: 'qore-service-test', version: '1.0.1', private: true }, null, 2)}\n`,
            'Update package metadata',
          )
          const update = await request(service.baseUrl, '/api/github/update', { method: 'POST', token: service.token })
          assert.equal(update.status, 200)
          assert.match(update.payload.status.lastAction, /Dependencies refreshed/)
          assert.equal(existsSync(path.join(fixture.repo, 'package-lock.json')), true)
        } finally {
          await service.stop()
        }
      }),
  },
  {
    name: 'refuses to push when local and remote have diverged',
    run: () =>
      withFixture(createGitFixture, async (fixture) => {
        await write(fixture.repo, 'local.txt', 'local commit\n')
        await commitAll(fixture.repo, 'Local commit')
        await addRemoteCommit(fixture, 'remote.txt', 'remote commit\n', 'Remote commit')
        const service = await startService(fixture.repo)
        try {
          const status = (await request(service.baseUrl, '/api/github/status?refresh=1', { token: service.token })).payload.status
          assert.equal(status.ahead, 1)
          assert.equal(status.behind, 1)
          const push = await request(service.baseUrl, '/api/github/push', {
            method: 'POST',
            token: service.token,
            body: { message: 'Push diverged work' },
          })
          assert.equal(push.status, 500)
          assert.match(push.payload.error, /Update before pushing/)
        } finally {
          await service.stop()
        }
      }),
  },
  {
    name: 'skips update from detached HEAD',
    run: () =>
      withFixture(createGitFixture, async (fixture) => {
        await git(fixture.repo, ['checkout', '--detach', 'HEAD'])
        const service = await startService(fixture.repo)
        try {
          const status = (await request(service.baseUrl, '/api/github/status', { token: service.token })).payload.status
          assert.equal(status.branch, 'detached')
          assert.equal(status.detached, true)
          const update = await request(service.baseUrl, '/api/github/update', { method: 'POST', token: service.token })
          assert.equal(update.status, 200)
          assert.match(update.payload.status.lastAction, /detached HEAD/)
        } finally {
          await service.stop()
        }
      }),
  },
  {
    name: 'reports failed fetches and redacts credentialed remotes',
    run: () =>
      withFixture(createRepoWithoutRemote, async ({ repo }) => {
        await git(repo, ['remote', 'add', 'origin', 'https://user:super-secret@127.0.0.1:1/repo.git'])
        const service = await startService(repo)
        try {
          const status = (await request(service.baseUrl, '/api/github/status?refresh=1', { token: service.token })).payload.status
          assert.equal(status.ok, false)
          assert.doesNotMatch(status.remoteUrl, /super-secret/)
          assert.match(status.remoteUrl, /user:\*\*\*/)
          assert.doesNotMatch(status.message, /super-secret/)
        } finally {
          await service.stop()
        }
      }),
  },
]

let failures = 0
for (const test of tests) {
  try {
    await test.run()
    console.log(`ok - ${test.name}`)
  } catch (error) {
    failures += 1
    console.error(`not ok - ${test.name}`)
    console.error(error)
  }
}

if (failures > 0) process.exit(1)
