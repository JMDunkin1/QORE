import { isDeepStrictEqual } from 'node:util'

function priorCalendarDate(isoDate) {
  const timestamp = Date.parse(`${isoDate}T00:00:00Z`)
  return Number.isFinite(timestamp) ? new Date(timestamp - 86400000).toISOString().slice(0, 10) : ''
}

export function validateComponentArtifact({
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
}
