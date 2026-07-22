import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import Papa from 'papaparse'

export const ALL_YEAR_OUTPUT_ARTIFACT_BINDING_SCHEMA_VERSION = 1
export const ALL_YEAR_SELECTED_TRADES_FILE =
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/selected-trades.csv'
export const ALL_YEAR_DISPLAY_CURVE_FILE =
  'data/qore/research/strategy-agent-runs/ngas-all-year-beta/display-curve.csv'
export const ALL_YEAR_DISPLAY_CURVE_HEADERS = Object.freeze([
  'chartIndex',
  'date',
  'equityPct',
  'benchmarkPct',
  'drawdownPct',
  'activeReturnPct',
  'position',
  'signal',
  'netReturnPct',
  'priorCloseReturnContributionPct',
  'currentSessionReturnContributionPct',
  'indexReturnPct',
  'split',
  'thesisKind',
  'priorCloseThesisKind',
  'equityUsd',
  'component',
  'researchInstrument',
  'signalInstrument',
  'direction',
  'sourceId',
  'confidence',
])

const REQUIRED_SELECTED_TRADES_HEADERS = Object.freeze([
  'strategyId',
  'entryTradeDate',
  'equityPct',
  'drawdownPct',
  'activeReturnPct',
  'ungPosition',
  'netReturnPct',
  'priorCloseReturnContributionPct',
  'currentSessionReturnContributionPct',
  'indexReturnPct',
  'split',
  'thesisKind',
  'priorCloseThesisKind',
  'equity',
  'componentVariant',
  'researchInstrument',
  'signalInstrument',
  'direction',
  'sourceId',
  'confidence',
])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function validDate(value) {
  const date = String(value ?? '')
  const parsed = Date.parse(`${date}T00:00:00Z`)
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(parsed)
    && new Date(parsed).toISOString().slice(0, 10) === date
  )
}

function artifactDates(rows, dateField, label) {
  const dates = rows.map((row) => String(row?.[dateField] ?? ''))
  for (const [index, date] of dates.entries()) {
    if (!validDate(date)) {
      throw new Error(`${label} row ${index + 1} has an invalid ${dateField}.`)
    }
    if (index > 0 && dates[index - 1] >= date) {
      throw new Error(`${label} ${dateField} values must be unique and strictly chronological.`)
    }
  }
  return dates
}

function exactSequenceMismatch(left, right) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return -1
}

function finiteNumber(value, label) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') {
    throw new Error(`${label} must be a finite number.`)
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be a finite number.`)
  return numeric
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parseCsv(raw, label) {
  const parsed = Papa.parse(raw.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })
  if (parsed.errors.length) {
    throw new Error(`${label} is not valid CSV: ${parsed.errors[0].message}`)
  }
  const headers = parsed.meta.fields ?? []
  if (!headers.length || new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error(`${label} must have unique, non-empty headers.`)
  }
  if (!parsed.data.length) throw new Error(`${label} is empty.`)
  if (parsed.data.some((row) => Object.hasOwn(row, '__parsed_extra'))) {
    throw new Error(`${label} has rows wider than its declared header.`)
  }
  return { raw, headers, rows: parsed.data }
}

export function buildAllYearOutputArtifactBinding({
  artifactKind,
  file,
  raw,
  headers,
  rows,
  dateField,
  label,
}) {
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw))) {
    throw new Error(`${label} raw bytes are required.`)
  }
  if (!Array.isArray(headers) || !headers.length) throw new Error(`${label} headers are required.`)
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${label} rows are required.`)
  const dates = artifactDates(rows, dateField, label)
  return {
    schemaVersion: ALL_YEAR_OUTPUT_ARTIFACT_BINDING_SCHEMA_VERSION,
    artifactKind,
    file,
    contentDigestSha256: sha256(raw),
    byteLength: Buffer.byteLength(raw),
    rowCount: rows.length,
    columnCount: headers.length,
    headers: [...headers],
    headerDigestSha256: sha256(headers.join('\n')),
    dateField,
    firstDate: dates[0],
    lastDate: dates.at(-1),
    dateDigestSha256: sha256(dates.join('\n')),
  }
}

export function buildAllYearOutputArtifactBindings({ selectedTrades, displayCurve }) {
  return {
    selectedTradesArtifact: buildAllYearOutputArtifactBinding({
      artifactKind: 'all-year-selected-trades',
      file: ALL_YEAR_SELECTED_TRADES_FILE,
      ...selectedTrades,
      dateField: 'entryTradeDate',
      label: 'All-year selected-trades artifact',
    }),
    displayCurveArtifact: buildAllYearOutputArtifactBinding({
      artifactKind: 'all-year-display-curve',
      file: ALL_YEAR_DISPLAY_CURVE_FILE,
      ...displayCurve,
      dateField: 'date',
      label: 'All-year display-curve artifact',
    }),
  }
}

function validateArtifactSchemas(selectedTrades, displayCurve) {
  const missingSelectedHeaders = REQUIRED_SELECTED_TRADES_HEADERS.filter(
    (header) => !selectedTrades.headers.includes(header),
  )
  if (missingSelectedHeaders.length) {
    throw new Error(`All-year selected-trades schema is missing: ${missingSelectedHeaders.join(', ')}.`)
  }
  if (!isDeepStrictEqual(displayCurve.headers, [...ALL_YEAR_DISPLAY_CURVE_HEADERS])) {
    throw new Error('All-year display-curve headers do not match the reviewed browser projection schema.')
  }
  const malformedSelectedRow = selectedTrades.rows.find(
    (row) => row.strategyId !== 'ngas-all-year-beta' || !['train', 'validation', 'holdout'].includes(row.split),
  )
  if (malformedSelectedRow) {
    throw new Error(`All-year selected-trades row ${malformedSelectedRow.entryTradeDate || 'unknown'} is malformed.`)
  }
  const malformedDisplayRow = displayCurve.rows.find(
    (row, index) => Number(row.chartIndex) !== index || !['train', 'validation', 'holdout'].includes(row.split),
  )
  if (malformedDisplayRow) {
    throw new Error(`All-year display-curve row ${malformedDisplayRow.date || 'unknown'} is malformed.`)
  }
}

function validateCrossArtifactShape(selectedTrades, displayCurve) {
  const selectedDates = artifactDates(
    selectedTrades.rows,
    'entryTradeDate',
    'All-year selected-trades artifact',
  )
  const displayDates = artifactDates(displayCurve.rows, 'date', 'All-year display-curve artifact')
  const mismatchIndex = exactSequenceMismatch(selectedDates, displayDates)
  if (mismatchIndex >= 0) {
    throw new Error(
      `All-year selected-trades and display-curve dates diverge at row ${mismatchIndex + 1}: selected=${selectedDates[mismatchIndex] ?? 'missing'} display=${displayDates[mismatchIndex] ?? 'missing'}.`,
    )
  }
  let benchmarkEquity = 100_000
  for (const [index, selected] of selectedTrades.rows.entries()) {
    const display = displayCurve.rows[index]
    for (const [selectedField, displayField] of [
      ['equityPct', 'equityPct'],
      ['drawdownPct', 'drawdownPct'],
      ['activeReturnPct', 'activeReturnPct'],
      ['ungPosition', 'position'],
      ['split', 'split'],
      ['thesisKind', 'thesisKind'],
      ['priorCloseThesisKind', 'priorCloseThesisKind'],
      ['netReturnPct', 'netReturnPct'],
      ['indexReturnPct', 'indexReturnPct'],
      ['priorCloseReturnContributionPct', 'priorCloseReturnContributionPct'],
      ['currentSessionReturnContributionPct', 'currentSessionReturnContributionPct'],
      ['equity', 'equityUsd'],
      ['componentVariant', 'component'],
      ['researchInstrument', 'researchInstrument'],
      ['signalInstrument', 'signalInstrument'],
      ['direction', 'direction'],
      ['sourceId', 'sourceId'],
      ['confidence', 'confidence'],
    ]) {
      if (String(selected[selectedField] ?? '') !== String(display[displayField] ?? '')) {
        throw new Error(
          `All-year display-curve ${displayField} does not match selected-trades at ${selected.entryTradeDate}.`,
        )
      }
    }

    const position = finiteNumber(selected.ungPosition, `All-year selected-trades ungPosition at ${selected.entryTradeDate}`)
    const confidence = finiteNumber(selected.confidence, `All-year selected-trades confidence at ${selected.entryTradeDate}`)
    const expectedSignal = round(confidence * Math.sign(position), 4)
    if (finiteNumber(display.signal, `All-year display-curve signal at ${display.date}`) !== expectedSignal) {
      throw new Error(`All-year display-curve signal does not match selected-trades at ${selected.entryTradeDate}.`)
    }

    benchmarkEquity *= 1 + finiteNumber(
      selected.indexReturnPct,
      `All-year selected-trades indexReturnPct at ${selected.entryTradeDate}`,
    ) / 100
    const expectedBenchmarkPct = round((benchmarkEquity / 100_000 - 1) * 100, 4)
    if (
      finiteNumber(display.benchmarkPct, `All-year display-curve benchmarkPct at ${display.date}`)
      !== expectedBenchmarkPct
    ) {
      throw new Error(`All-year display-curve benchmarkPct does not match selected-trades at ${selected.entryTradeDate}.`)
    }
  }
}

export function validateAllYearOutputArtifactInputs({ summary, selectedTrades, displayCurve }) {
  if (summary?.outputFiles?.selectedTrades !== ALL_YEAR_SELECTED_TRADES_FILE) {
    throw new Error('All-year selected-trades path does not match the reviewed artifact path.')
  }
  if (summary?.outputFiles?.displayCurve !== ALL_YEAR_DISPLAY_CURVE_FILE) {
    throw new Error('All-year display-curve path does not match the reviewed artifact path.')
  }
  validateArtifactSchemas(selectedTrades, displayCurve)
  validateCrossArtifactShape(selectedTrades, displayCurve)
  const bindings = buildAllYearOutputArtifactBindings({ selectedTrades, displayCurve })
  if (!isDeepStrictEqual(summary?.data?.selectedTradesArtifact, bindings.selectedTradesArtifact)) {
    throw new Error('All-year selected-trades artifact binding does not match its reviewed summary.')
  }
  if (!isDeepStrictEqual(summary?.data?.displayCurveArtifact, bindings.displayCurveArtifact)) {
    throw new Error('All-year display-curve artifact binding does not match its reviewed summary.')
  }
  const selectedBinding = bindings.selectedTradesArtifact
  if (
    summary?.data?.marketDays !== selectedBinding.rowCount
    || summary?.data?.marketStartDate !== selectedBinding.firstDate
    || summary?.data?.marketEndDate !== selectedBinding.lastDate
    || summary?.selected?.allMetrics?.firstEntry !== selectedBinding.firstDate
    || summary?.selected?.allMetrics?.lastExit !== selectedBinding.lastDate
  ) {
    throw new Error('All-year output artifact row/date metadata does not match its reviewed summary.')
  }
  return { selectedTrades, displayCurve, bindings }
}

export function validateAllYearOutputArtifacts(repoRoot, summary) {
  const selectedTrades = parseCsv(
    fs.readFileSync(path.join(repoRoot, ALL_YEAR_SELECTED_TRADES_FILE)),
    'All-year selected-trades artifact',
  )
  const displayCurve = parseCsv(
    fs.readFileSync(path.join(repoRoot, ALL_YEAR_DISPLAY_CURVE_FILE)),
    'All-year display-curve artifact',
  )
  return validateAllYearOutputArtifactInputs({ summary, selectedTrades, displayCurve })
}
