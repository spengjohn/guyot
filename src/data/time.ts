import type { CalendarDay, Moment } from './types/core'

export function now(): Moment {
  return Date.now() as Moment
}

/** True for a real 'YYYY-MM-DD' day. Checks the calendar too, so '2026-02-30' fails. */
export function isCalendarDay(value: string): value is CalendarDay {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  // Date.UTC rolls invalid days over (Feb 30 -> Mar 2), so compare the parts back.
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** True for an IANA time zone the browser knows, such as 'America/Los_Angeles'. */
export function isTimeZone(value: string): boolean {
  if (value === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}
