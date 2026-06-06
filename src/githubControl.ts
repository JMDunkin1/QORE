export type GithubStatus = {
  ok: boolean
  configured: boolean
  remoteUrl?: string
  branch: string
  currentCommit?: string
  currentShort?: string
  remoteCommit?: string
  remoteShort?: string
  detached?: boolean
  ahead: number
  behind: number
  updateAvailable: boolean
  dirty: boolean
  dirtyCount: number
  dirtyFiles: string[]
  lastCheckedAt: string | null
  lastLaunchUpdateAt: string | null
  lastDependencyInstallAt?: string | null
  lastAction: string
  serviceStartedAt: string
  liveUpdateMode: string
  launchUpdateMode: string
  message: string
}

type GithubServiceResponse = {
  status?: GithubStatus
  error?: string
}

const serviceBaseUrl = (import.meta.env.VITE_QORE_GIT_SERVICE_URL ?? 'http://127.0.0.1:4774').replace(/\/$/, '')
const serviceToken = import.meta.env.VITE_QORE_GIT_SERVICE_TOKEN ?? ''

async function requestGithub(path: string, options: RequestInit = {}) {
  const response = await fetch(`${serviceBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(serviceToken ? { 'X-QORE-Git-Token': serviceToken } : {}),
      ...options.headers,
    },
  })
  const payload = (await response.json().catch(() => ({}))) as GithubServiceResponse
  if (!response.ok || !payload.status) {
    throw new Error(payload.error ?? 'QORE Git service is unavailable.')
  }
  return payload.status
}

export function fetchGithubStatus(refresh = false) {
  return requestGithub(`/api/github/status${refresh ? '?refresh=1' : ''}`)
}

export function updateFromGithub() {
  return requestGithub('/api/github/update', { method: 'POST' })
}

export function pushToGithub(message: string) {
  return requestGithub('/api/github/push', {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}
