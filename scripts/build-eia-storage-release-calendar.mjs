#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { easternTimeToUtcIso, nominalEiaStorageReleaseAt } from './lib/eia-release-time.mjs'

const REPO_ROOT = process.cwd()
const STORAGE_FILE = path.join(
  REPO_ROOT,
  'data/qore/fundamentals/eia/working-gas-storage-lower48-weekly.csv',
)
const OUTPUT_FILE = path.join(
  REPO_ROOT,
  'data/qore/fundamentals/eia/working-gas-storage-release-calendar.json',
)
const VERIFIED_THROUGH_PERIOD_END_DATE = '2026-12-25'

const RELEASE_EXCEPTIONS = [
  ['2010-11-05', '2010-11-10', '12:00', 'holiday-schedule'],
  ['2010-11-19', '2010-11-24', '12:00', 'holiday-schedule'],
  ['2011-11-18', '2011-11-23', '12:00', 'holiday-schedule'],
  ['2012-06-29', '2012-07-06', '10:30', 'holiday-schedule'],
  ['2012-11-16', '2012-11-21', '12:00', 'holiday-schedule'],
  ['2012-12-21', '2012-12-28', '10:30', 'holiday-schedule'],
  ['2012-12-28', '2013-01-04', '10:30', 'holiday-schedule'],
  ['2013-10-11', '2013-10-22', '10:30', 'extraordinary-delay'],
  ['2013-11-22', '2013-11-27', '12:00', 'holiday-schedule'],
  ['2013-12-20', '2013-12-27', '10:30', 'holiday-schedule'],
  ['2013-12-27', '2014-01-03', '10:30', 'holiday-schedule'],
  ['2014-11-07', '2014-11-14', '10:30', 'holiday-schedule'],
  ['2014-11-21', '2014-11-26', '12:00', 'holiday-schedule'],
  ['2014-12-19', '2014-12-24', '12:00', 'holiday-schedule'],
  ['2014-12-26', '2014-12-31', '12:00', 'holiday-schedule'],
  ['2015-11-06', '2015-11-13', '10:30', 'holiday-schedule'],
  ['2015-11-20', '2015-11-25', '12:00', 'holiday-schedule'],
  ['2016-11-18', '2016-11-23', '12:00', 'holiday-schedule'],
  ['2017-06-30', '2017-07-07', '10:30', 'holiday-schedule'],
  ['2017-11-17', '2017-11-22', '12:00', 'holiday-schedule'],
  ['2018-06-29', '2018-07-06', '10:30', 'holiday-schedule'],
  ['2018-11-16', '2018-11-21', '12:00', 'holiday-schedule'],
  ['2018-11-30', '2018-12-07', '10:30', 'holiday-schedule'],
  ['2018-12-21', '2018-12-28', '10:30', 'holiday-schedule'],
  ['2018-12-28', '2019-01-04', '10:30', 'holiday-schedule'],
  ['2019-06-28', '2019-07-03', '12:00', 'holiday-schedule'],
  ['2019-11-22', '2019-11-27', '12:00', 'holiday-schedule'],
  ['2019-12-20', '2019-12-27', '10:30', 'holiday-schedule'],
  ['2019-12-27', '2020-01-03', '10:30', 'holiday-schedule'],
  ['2020-11-06', '2020-11-13', '10:30', 'holiday-schedule'],
  ['2020-11-20', '2020-11-25', '12:00', 'holiday-schedule'],
  ['2020-12-18', '2020-12-23', '12:00', 'holiday-schedule'],
  ['2021-01-15', '2021-01-22', '10:30', 'holiday-schedule'],
  ['2021-11-05', '2021-11-10', '12:00', 'holiday-schedule'],
  ['2021-11-19', '2021-11-24', '12:00', 'holiday-schedule'],
  ['2022-11-18', '2022-11-23', '12:00', 'holiday-schedule'],
  ['2023-06-30', '2023-07-07', '10:30', 'holiday-schedule'],
  ['2023-11-03', '2023-11-16', '10:30', 'extraordinary-delay'],
  ['2023-11-17', '2023-11-22', '12:00', 'holiday-schedule'],
  ['2024-06-14', '2024-06-21', '10:30', 'holiday-schedule'],
  ['2024-06-28', '2024-07-03', '12:00', 'holiday-schedule'],
  ['2024-11-22', '2024-11-27', '12:00', 'holiday-schedule'],
  ['2024-12-20', '2024-12-27', '10:30', 'holiday-schedule'],
  ['2024-12-27', '2025-01-03', '10:30', 'holiday-schedule'],
  ['2025-01-03', '2025-01-08', '12:00', 'holiday-schedule'],
  ['2025-06-13', '2025-06-18', '12:00', 'holiday-schedule'],
  ['2025-11-07', '2025-11-14', '10:30', 'holiday-schedule'],
  ['2025-11-21', '2025-11-26', '12:00', 'holiday-schedule'],
  ['2025-12-19', '2025-12-29', '12:00', 'holiday-schedule'],
  ['2025-12-26', '2025-12-31', '12:00', 'holiday-schedule'],
  ['2026-11-06', '2026-11-13', '10:30', 'holiday-schedule'],
  ['2026-11-20', '2026-11-25', '12:00', 'holiday-schedule'],
]

function addCalendarDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function storageDates(csvText) {
  return csvText
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
}

async function main() {
  const inputDates = storageDates(await readFile(STORAGE_FILE, 'utf8'))
  if (!inputDates.length) throw new Error(`No EIA storage rows found in ${STORAGE_FILE}`)
  if (new Date(`${VERIFIED_THROUGH_PERIOD_END_DATE}T00:00:00Z`).getUTCDay() !== 5) {
    throw new Error(`EIA release-calendar verification must end on a Friday period: ${VERIFIED_THROUGH_PERIOD_END_DATE}`)
  }
  if (inputDates.at(-1) > VERIFIED_THROUGH_PERIOD_END_DATE) {
    throw new Error(
      `EIA storage input ${inputDates.at(-1)} exceeds release-calendar verification ${VERIFIED_THROUGH_PERIOD_END_DATE}`,
    )
  }
  const allPeriodEndDates = [...inputDates]
  for (let date = addCalendarDays(inputDates.at(-1), 7); date <= VERIFIED_THROUGH_PERIOD_END_DATE; date = addCalendarDays(date, 7)) {
    allPeriodEndDates.push(date)
  }

  const exceptions = new Map(
    RELEASE_EXCEPTIONS.map(([periodEndDate, releaseDate, releaseTimeEastern, releaseKind]) => [
      periodEndDate,
      { releasedAt: easternTimeToUtcIso(releaseDate, releaseTimeEastern), releaseKind },
    ]),
  )
  for (const periodEndDate of exceptions.keys()) {
    if (!allPeriodEndDates.includes(periodEndDate)) throw new Error(`EIA release exception has no calendar row: ${periodEndDate}`)
  }

  const releases = allPeriodEndDates.map((periodEndDate) => {
    const exception = exceptions.get(periodEndDate)
    return {
      periodEndDate,
      releasedAt: exception?.releasedAt ?? nominalEiaStorageReleaseAt(periodEndDate),
      releaseKind: exception?.releaseKind ?? 'standard-schedule',
    }
  })
  const calendar = {
    schemaVersion: 1,
    calendarId: 'eia-wngsr-release-calendar-v1',
    timeZone: 'America/New_York',
    verifiedThroughPeriodEndDate: VERIFIED_THROUGH_PERIOD_END_DATE,
    standardReleasePolicy: {
      periodEndWeekday: 'Friday',
      releaseWeekday: 'Thursday',
      releaseTimeEastern: '10:30',
    },
    sources: [
      {
        label: 'EIA Weekly Natural Gas Storage Report release schedule',
        url: 'https://ir.eia.gov/ngs/schedule.html',
      },
      {
        label: 'EIA WNGSR Performance Evaluation for 2011 through 2013',
        url: 'https://ir.eia.gov/ngs/wngsrevaluation_2014.pdf',
      },
      {
        label: 'EIA November 2023 systems-upgrade release notice',
        url: 'https://www.eia.gov/pressroom/releases/press545.php',
      },
    ],
    releases,
  }
  await writeFile(OUTPUT_FILE, `${JSON.stringify(calendar, null, 2)}\n`)
  console.log(`wrote ${path.relative(REPO_ROOT, OUTPUT_FILE)} (${releases.length} releases)`)
}

await main()
