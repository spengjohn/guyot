import { isCalendarDay } from '../data/time'
import type { CalendarDay, Moment } from '../data/types/core'
import type { Deadline } from '../data/types/fields'

const DAY_MS = 86_400_000

/** Today's date on this device's calendar, as 'YYYY-MM-DD'. */
export function todayLocal(now: Date = new Date()): CalendarDay {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return day as CalendarDay // built from a real date, so always valid
}

/**
 * A calendar day in the device's format ("Oct 15, 2026" or "15 Oct 2026").
 * The day is treated as midnight UTC and formatted in UTC, so no time zone can move it
 * to the day before or after.
 */
export function formatCalendarDay(day: CalendarDay, locale?: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    Date.UTC(year, month - 1, date),
  )
}

/** The device's IANA time zone, such as 'Europe/London'. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Every time zone the browser knows, for a picker. */
export function timeZoneNames(): string[] {
  return Intl.supportedValuesOf('timeZone')
}

/** A moment in this device's format and time zone, or in `timeZone` if given. */
export function formatMoment(at: Moment, timeZone?: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(at)
}

/**
 * The clock time in `timeZone` at a moment, written as if it were UTC. Comparing it
 * with the moment itself gives the zone's offset then.
 */
function wallClockAsUtc(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
}

function offsetAt(at: number, timeZone: string): number {
  const whole = Math.floor(at / 1000) * 1000 // the parts above have no milliseconds
  return wallClockAsUtc(whole, timeZone) - whole
}

/**
 * The moment when clocks in `timeZone` show `day` at `time` ('HH:MM').
 * Around daylight-saving changes: a time that happens twice picks the first; a time
 * that is skipped moves forward by the gap (2:30 on a spring-forward night becomes 3:30).
 */
export function zonedTimeToMoment(day: CalendarDay, time: string, timeZone: string): Moment {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wall = Date.UTC(year, month - 1, date, hour, minute)
  // The zone's offset a day before and a day after covers any change on this day.
  const before = wall - offsetAt(wall - DAY_MS, timeZone)
  const after = wall - offsetAt(wall + DAY_MS, timeZone)
  const matches = [before, after].filter((at) => wallClockAsUtc(at, timeZone) === wall)
  return (matches.length > 0 ? Math.min(...matches) : before) as Moment
}

/** The day and 'HH:MM' that clocks in `timeZone` show at a moment. For editing. */
export function momentToZonedTime(
  at: Moment,
  timeZone: string,
): { day: CalendarDay; time: string } {
  const iso = new Date(wallClockAsUtc(at, timeZone)).toISOString() // '2026-10-15T23:59:00.000Z'
  const day = iso.slice(0, 10)
  if (!isCalendarDay(day)) throw new Error(`Unexpected date ${iso}`)
  return { day, time: iso.slice(11, 16) }
}

/**
 * A deadline for display. A time is shown in the device's zone, with the posting's
 * own time as a hint when the zones differ: "Oct 16, 2026, 7:59 AM (Oct 15, 2026,
 * 11:59 PM America/Los_Angeles)".
 */
export function formatDeadline(deadline: Deadline, locale?: string, localZone = deviceTimeZone()) {
  if (deadline.kind === 'day') return formatCalendarDay(deadline.day, locale)
  const { at, timeZone } = deadline.at
  const local = formatMoment(at, localZone, locale)
  if (timeZone === localZone) return local
  return `${local} (${formatMoment(at, timeZone, locale)} ${timeZone})`
}
