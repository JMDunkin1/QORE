function canonicalEntries(ledger) {
  return ledger?.deliveries && typeof ledger.deliveries === 'object' ? ledger.deliveries : {}
}

export function sentDestinationIds(ledger, key) {
  return new Set(Object.entries(canonicalEntries(ledger))
    .filter(([entryKey, value]) => entryKey.startsWith(`${key}:`) && value?.status === 'sent')
    .map(([entryKey]) => entryKey.slice(`${key}:`.length)))
}

export function deferredDestinationIds(ledger, key, now = Date.now()) {
  return new Set(Object.entries(canonicalEntries(ledger))
    .filter(([entryKey, value]) => {
      if (!entryKey.startsWith(`${key}:`) || value?.status !== 'failed') return false
      const attemptedAt = Date.parse(value?.attemptedAt)
      const retryAfterSeconds = Number(value?.retryAfterSeconds)
      return Number.isFinite(attemptedAt) && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        && now < attemptedAt + retryAfterSeconds * 1_000
    })
    .map(([entryKey]) => entryKey.slice(`${key}:`.length)))
}

export function uncertainDestinationIds(ledger, key) {
  return new Set(Object.entries(canonicalEntries(ledger))
    .filter(([entryKey, value]) => entryKey.startsWith(`${key}:`) && value?.status === 'uncertain')
    .map(([entryKey]) => entryKey.slice(`${key}:`.length)))
}

export function deliveryEntriesForKey(ledger, key) {
  return Object.entries(canonicalEntries(ledger))
    .filter(([entryKey]) => entryKey.startsWith(`${key}:`))
    .map(([, value]) => value)
}

export function updateDeliveryLedger(ledger, key, attempts, artifactSha256, summarySha256, report, {
  forced = false,
  forceRunId = null,
  reconcileCanonicalIds = new Set(),
  preserveCanonicalUncertainIds = new Set(),
  updatedAt = new Date().toISOString(),
} = {}) {
  if (forced && !forceRunId) throw new Error('Forced delivery ledger updates require a force run id.')
  const canonicalIds = reconcileCanonicalIds instanceof Set
    ? reconcileCanonicalIds
    : new Set(reconcileCanonicalIds ?? [])
  const priorUncertainIds = preserveCanonicalUncertainIds instanceof Set
    ? preserveCanonicalUncertainIds
    : new Set(preserveCanonicalUncertainIds ?? [])
  const next = {
    schemaVersion: 1,
    serviceId: 'qore-portfolio-report-deliveries',
    updatedAt,
    deliveries: { ...(ledger?.deliveries ?? {}) },
    forcedDeliveries: { ...(ledger?.forcedDeliveries ?? {}) },
    scheduleRuns: { ...(ledger?.scheduleRuns ?? {}) },
  }
  for (const attempt of attempts) {
    const entry = {
      destinationId: attempt.id,
      type: attempt.type,
      mode: report.mode,
      cadence: report.cadence,
      periodEnd: report.period.endDate,
      status: attempt.status,
      attemptedAt: attempt.finishedAt ?? attempt.startedAt ?? updatedAt,
      artifactSha256,
      summarySha256,
      error: attempt.status === 'sent' ? null : attempt.error,
      retryAfterSeconds: attempt.retryAfterSeconds ?? null,
    }
    if (forced) next.forcedDeliveries[`${key}:${forceRunId}:${attempt.id}`] = entry
    const canonicalKey = `${key}:${attempt.id}`
    const preservesPriorUncertainty = forced
      && canonicalIds.has(attempt.id)
      && priorUncertainIds.has(attempt.id)
      && attempt.status !== 'sent'
    if ((!forced || canonicalIds.has(attempt.id)) && !preservesPriorUncertainty) {
      next.deliveries[canonicalKey] = entry
    }
  }
  return next
}
