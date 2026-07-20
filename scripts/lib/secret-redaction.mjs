function apiKeyFieldName(name) {
  const normalized = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase()
  return normalized === 'apikey' || normalized.endsWith('apikey')
}

export function omitApiKeyFields(value, secrets = []) {
  if (Array.isArray(value)) return value.map((child) => omitApiKeyFields(child, secrets))
  if (typeof value === 'string') return redactSecretText(value, secrets)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !apiKeyFieldName(key))
      .map(([key, child]) => [redactSecretText(key, secrets), omitApiKeyFields(child, secrets)]),
  )
}

function encodedSecretVariants(secret, maxDepth = 6) {
  const variants = new Set([secret])
  let frontier = new Set([secret])

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = new Set()
    for (const value of frontier) {
      try {
        next.add(encodeURIComponent(value))
      } catch {
        // URLSearchParams below still gives a safe form-encoded representation.
      }
      next.add(new URLSearchParams([['value', value]]).toString().slice('value='.length))
    }
    frontier = new Set([...next].filter((value) => !variants.has(value)))
    for (const value of frontier) variants.add(value)
    if (!frontier.size) break
  }

  return variants
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function percentCasePattern(value) {
  let pattern = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '%' && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      const hex = value.slice(index + 1, index + 3)
      pattern += `%${[...hex].map((digit) => /[A-Fa-f]/.test(digit) ? `[${digit.toUpperCase()}${digit.toLowerCase()}]` : digit).join('')}`
      index += 2
    } else {
      pattern += regexEscape(char)
    }
  }
  return pattern
}

export function redactSecretText(value, secrets) {
  let text = String(value ?? '')
  const variants = new Set()

  for (const secretValue of secrets ?? []) {
    const secret = String(secretValue ?? '')
    if (!secret) continue
    for (const variant of encodedSecretVariants(secret)) variants.add(variant)
  }

  for (const variant of [...variants].filter(Boolean).sort((left, right) => right.length - left.length)) {
    text = text.replace(new RegExp(percentCasePattern(variant), 'gi'), 'REDACTED')
  }
  return text
}
