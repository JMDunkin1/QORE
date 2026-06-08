export type SignalReturnRow = {
  issueDate: string
  targetDate: string
  leadDays: number
  windowId: string
  modelId: string
  symbol: string
  priorTradeDate: string
  entryTradeDate: string
  targetTradeDate: string
  priorClose: number | null
  entryClose: number | null
  targetClose: number | null
  returnPctPriorCloseToTarget: number | null
  returnPctEntryCloseToTarget: number | null
  qualifies: boolean
}

export type SignalReturnTimingIssue =
  | 'missing-date'
  | 'lead-window-mismatch'
  | 'entry-not-after-issue'
  | 'target-before-forecast-date'
  | 'target-not-after-entry'
  | 'missing-entry-return'

export type SignalReturnTimingReview = {
  isTradable: boolean
  approvedReturnPct: number | null
  issues: SignalReturnTimingIssue[]
}

export type SignalReturnTimingSummary = {
  totalRows: number
  tradableRows: number
  rejectedRows: number
  issueCounts: Record<SignalReturnTimingIssue, number>
}

export const arcticBlastNoLookaheadConvention = {
  id: 'close-after-issue-v1',
  signal: 'Use issueDate forecast scores only after the issueDate market close.',
  entry: 'Enter at the first available market close strictly after issueDate.',
  exit: 'Exit at the first available market close on or after targetDate and strictly after entryTradeDate.',
  returnColumn: 'returnPctEntryCloseToTarget',
  disallowedReturnColumn: 'returnPctPriorCloseToTarget',
}

export function expectedWindowIdForLead(leadDays: number) {
  if (leadDays >= 7 && leadDays <= 10) return 'rumor'
  if (leadDays >= 1 && leadDays <= 3) return 'selloff'
  return 'other'
}

function hasIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function hasRequiredDates(row: SignalReturnRow) {
  return (
    hasIsoDate(row.issueDate) &&
    hasIsoDate(row.targetDate) &&
    hasIsoDate(row.entryTradeDate) &&
    hasIsoDate(row.targetTradeDate)
  )
}

export function validateSignalReturnTiming(row: SignalReturnRow): SignalReturnTimingReview {
  const issues: SignalReturnTimingIssue[] = []

  if (!hasRequiredDates(row)) issues.push('missing-date')

  if (row.windowId !== expectedWindowIdForLead(row.leadDays)) {
    issues.push('lead-window-mismatch')
  }

  if (hasIsoDate(row.issueDate) && hasIsoDate(row.entryTradeDate) && row.entryTradeDate <= row.issueDate) {
    issues.push('entry-not-after-issue')
  }

  if (hasIsoDate(row.targetDate) && hasIsoDate(row.targetTradeDate) && row.targetTradeDate < row.targetDate) {
    issues.push('target-before-forecast-date')
  }

  if (
    hasIsoDate(row.entryTradeDate) &&
    hasIsoDate(row.targetTradeDate) &&
    row.targetTradeDate <= row.entryTradeDate
  ) {
    issues.push('target-not-after-entry')
  }

  if (row.returnPctEntryCloseToTarget === null) {
    issues.push('missing-entry-return')
  }

  return {
    isTradable: issues.length === 0,
    approvedReturnPct: issues.length === 0 ? row.returnPctEntryCloseToTarget : null,
    issues,
  }
}

export function filterNoLookaheadSignalReturns(rows: SignalReturnRow[]) {
  return rows.filter((row) => validateSignalReturnTiming(row).isTradable)
}

export function summarizeSignalReturnTiming(rows: SignalReturnRow[]): SignalReturnTimingSummary {
  const issueCounts = {
    'missing-date': 0,
    'lead-window-mismatch': 0,
    'entry-not-after-issue': 0,
    'target-before-forecast-date': 0,
    'target-not-after-entry': 0,
    'missing-entry-return': 0,
  } satisfies Record<SignalReturnTimingIssue, number>

  let tradableRows = 0

  for (const row of rows) {
    const review = validateSignalReturnTiming(row)
    if (review.isTradable) {
      tradableRows += 1
    } else {
      for (const issue of review.issues) issueCounts[issue] += 1
    }
  }

  return {
    totalRows: rows.length,
    tradableRows,
    rejectedRows: rows.length - tradableRows,
    issueCounts,
  }
}
