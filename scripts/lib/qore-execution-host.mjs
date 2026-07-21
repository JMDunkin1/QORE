import { hostname } from 'node:os'

export const qoreExecutionHostname = 'm1-server'

function normalizedHostname(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\.$/, '').split('.')[0]
}

export function qoreExecutionHostAssessment({
  platform = process.platform,
  host = hostname(),
  allowLoopbackTest = false,
} = {}) {
  const actualHost = normalizedHostname(host)
  const allowed = allowLoopbackTest || (platform === 'linux' && actualHost === qoreExecutionHostname)
  return {
    allowed,
    platform,
    host: actualHost || 'unknown',
    requiredPlatform: 'linux',
    requiredHost: qoreExecutionHostname,
    loopbackTest: allowLoopbackTest,
  }
}

export function assertQoreExecutionHost(options = {}) {
  const assessment = qoreExecutionHostAssessment(options)
  if (assessment.allowed) return assessment
  throw new Error(
    `Order-capable QORE commands are restricted to Linux host ${assessment.requiredHost}; `
    + `this host is ${assessment.host} (${assessment.platform}). This computer is viewer/research-only.`,
  )
}
