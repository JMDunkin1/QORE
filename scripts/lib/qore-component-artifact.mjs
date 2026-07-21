import crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { loadExecutionCalendar } from './qore-research-execution.mjs'

export const COMPONENT_ARTIFACT_SCHEMA_VERSION = 3
export const COMPONENT_SELECTED_TRADES_BINDING_SCHEMA_VERSION = 1

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function selectedTradeDates(rows, label) {
  const dates = rows.map((row) => String(row?.entryTradeDate ?? ''))
  for (const [index, date] of dates.entries()) {
    const parsed = Date.parse(`${date}T00:00:00Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(parsed)
      || new Date(parsed).toISOString().slice(0, 10) !== date
    ) {
      throw new Error(`${label} selected-trades row ${index + 1} has an invalid entryTradeDate.`)
    }
    if (index > 0 && dates[index - 1] >= date) {
      throw new Error(`${label} selected-trades entryTradeDate values must be unique and strictly chronological.`)
    }
  }
  return dates
}

function exactDateMismatch(left, right) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return { index, selectedTradeDate: left[index] ?? null, authoritativeSessionDate: right[index] ?? null }
    }
  }
  return null
}

export function buildComponentSelectedTradesBinding({
  repoRoot,
  file,
  raw,
  rows,
  executionContract,
  label = 'Component artifact',
}) {
  if (typeof repoRoot !== 'string' || !repoRoot) throw new Error(`${label} repoRoot is required.`)
  if (typeof file !== 'string' || !file) throw new Error(`${label} selected-trades file path is required.`)
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw))) {
    throw new Error(`${label} selected-trades raw bytes are required.`)
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${label} selected-trades artifact is empty.`)

  const dates = selectedTradeDates(rows, label)
  const authoritativeDates = loadExecutionCalendar(repoRoot, {
    startDate: dates[0],
    endDate: dates.at(-1),
    contract: executionContract,
  }).map((day) => day.date)
  const mismatch = exactDateMismatch(dates, authoritativeDates)
  if (mismatch) {
    throw new Error(
      `${label} selected-trades dates do not exactly match the authoritative UNG/VOO/QQQM execution calendar at row ${mismatch.index + 1}: selected=${mismatch.selectedTradeDate ?? 'missing'} authoritative=${mismatch.authoritativeSessionDate ?? 'missing'}.`,
    )
  }

  const dateDigestSha256 = sha256(dates.join('\n'))
  return {
    schemaVersion: COMPONENT_SELECTED_TRADES_BINDING_SCHEMA_VERSION,
    artifactKind: 'component-selected-trades',
    file,
    contentDigestSha256: sha256(raw),
    byteLength: Buffer.byteLength(raw),
    rowCount: rows.length,
    dateField: 'entryTradeDate',
    firstEntryTradeDate: dates[0],
    lastEntryTradeDate: dates.at(-1),
    entryTradeDateDigestSha256: dateDigestSha256,
    authoritativeCalendar: {
      calendarId: 'common-adjusted-ung-voo-qqqm-execution-sessions',
      executionContractId: executionContract.contractId,
      executionContractDigest: executionContract.digest,
      sessionCount: authoritativeDates.length,
      firstSessionDate: authoritativeDates[0],
      lastSessionDate: authoritativeDates.at(-1),
      sessionDateDigestSha256: sha256(authoritativeDates.join('\n')),
    },
  }
}

function priorCalendarDate(isoDate) {
  const timestamp = Date.parse(`${isoDate}T00:00:00Z`)
  return Number.isFinite(timestamp) ? new Date(timestamp - 86400000).toISOString().slice(0, 10) : ''
}

export function validateComponentArtifact({
  repoRoot,
  label,
  expectedStrategyId,
  requiredSchemaVersion,
  summary,
  trades,
  executionContract,
}) {
  if (summary.artifactSchemaVersion !== requiredSchemaVersion) {
    throw new Error(
      `${label} artifact schema ${summary.artifactSchemaVersion ?? 'missing'} does not match required schema ${requiredSchemaVersion}.`,
    )
  }
  if (summary.strategyId !== expectedStrategyId) {
    throw new Error(`${label} summary strategyId ${summary.strategyId ?? 'missing'} does not match ${expectedStrategyId}.`)
  }
  const componentContract = summary.contract
  if (
    !componentContract?.trainEnd ||
    !componentContract?.validationEnd ||
    !componentContract?.holdoutStart ||
    !(componentContract.trainEnd < componentContract.validationEnd) ||
    componentContract.validationEnd !== priorCalendarDate(componentContract.holdoutStart) ||
    summary.search?.selectionUsedHoldout !== false
  ) {
    throw new Error(`${label} does not have a contiguous ordered split contract with holdout excluded from selection.`)
  }
  const execution = componentContract.execution
  if (
    execution?.contractId !== executionContract.contractId ||
    execution?.contractDigest !== executionContract.digest ||
    execution?.scenarioId !== executionContract.selectionScenarioId
  ) {
    throw new Error(`${label} was not generated with the current research execution contract and selection scenario.`)
  }
  if (!isDeepStrictEqual(execution.scenarios, executionContract.scenarios)) {
    throw new Error(`${label} execution scenarios do not match the current research execution contract.`)
  }
  const requiredHeaders = [
    'strategyId',
    'entryTradeDate',
    'thesisKind',
    'ungPosition',
    'indexFraction',
    'frictionContractId',
    'frictionScenarioId',
    'priorCloseReturnContributionPct',
    'currentSessionReturnContributionPct',
  ]
  const missingHeaders = requiredHeaders.filter((header) => !trades.headers.includes(header))
  if (missingHeaders.length) {
    throw new Error(`${label} selected-trades schema is missing: ${missingHeaders.join(', ')}.`)
  }
  if (!trades.rows.length) throw new Error(`${label} selected-trades artifact is empty.`)
  const invalidRow = trades.rows.find(
    (row) =>
      row.strategyId !== expectedStrategyId ||
      !row.entryTradeDate ||
      !row.thesisKind ||
      !Number.isFinite(Number(row.ungPosition)) ||
      !Number.isFinite(Number(row.indexFraction)) ||
      row.frictionContractId !== executionContract.contractId ||
      row.frictionScenarioId !== executionContract.selectionScenarioId,
  )
  if (invalidRow) {
    throw new Error(`${label} selected-trades row ${invalidRow.entryTradeDate || 'unknown'} is stale or malformed.`)
  }

  const expectedBinding = buildComponentSelectedTradesBinding({
    repoRoot,
    file: summary?.outputFiles?.selectedTrades,
    raw: trades.raw,
    rows: trades.rows,
    executionContract,
    label,
  })
  const binding = summary?.data?.selectedTradesArtifact
  if (!isDeepStrictEqual(binding, expectedBinding)) {
    throw new Error(`${label} selected-trades artifact binding does not match its reviewed summary.`)
  }
  if (
    summary?.data?.marketDays !== expectedBinding.rowCount
    || summary?.data?.marketStartDate !== expectedBinding.firstEntryTradeDate
    || summary?.data?.marketEndDate !== expectedBinding.lastEntryTradeDate
    || summary?.selected?.allMetrics?.firstEntry !== expectedBinding.firstEntryTradeDate
    || summary?.selected?.allMetrics?.lastExit !== expectedBinding.lastEntryTradeDate
  ) {
    throw new Error(`${label} selected-trades row/date metadata does not match its reviewed summary.`)
  }
}
