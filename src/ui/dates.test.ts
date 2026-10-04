import { describe, expect, it } from 'vitest'
import type { CalendarDay, Moment } from '../data/types/core'
import {
  formatCalendarDay,
  formatDeadline,
  momentToZonedTime,
  todayLocal,
  zonedTimeToMoment,
} from './dates'

const day = (value: string) => value as CalendarDay

describe('calendar days', () => {
  it("formats in the locale's order, without moving the day", () => {
    expect(formatCalendarDay(day('2026-10-15'), 'en-US')).toBe('Oct 15, 2026')
    expect(formatCalendarDay(day('2026-10-15'), 'en-GB')).toBe('15 Oct 2026')
    expect(formatCalendarDay(day('2026-01-01'), 'en-US')).toBe('Jan 1, 2026')
  })

  it("reads today from the device's calendar", () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})

describe('zoned times', () => {
  it('converts a time in a zone to a moment and back', () => {
    const at = zonedTimeToMoment(day('2026-10-15'), '23:59', 'America/Los_Angeles')
    expect(at).toBe(Date.UTC(2026, 9, 16, 6, 59)) // PDT is UTC-7
    expect(momentToZonedTime(at, 'America/Los_Angeles')).toEqual({
      day: '2026-10-15',
      time: '23:59',
    })
    expect(zonedTimeToMoment(day('2026-01-15'), '09:00', 'UTC')).toBe(Date.UTC(2026, 0, 15, 9))
  })

  it('picks the first of a time that happens twice (clocks go back)', () => {
    // New York, 2026-11-01: 1:30 AM happens in EDT (UTC-4), then again in EST (UTC-5).
    expect(zonedTimeToMoment(day('2026-11-01'), '01:30', 'America/New_York')).toBe(
      Date.UTC(2026, 10, 1, 5, 30),
    )
  })

  it('moves a skipped time forward (clocks go forward)', () => {
    // New York, 2026-03-08: clocks jump from 2:00 to 3:00 AM, so 2:30 becomes 3:30 EDT.
    const at = zonedTimeToMoment(day('2026-03-08'), '02:30', 'America/New_York')
    expect(at).toBe(Date.UTC(2026, 2, 8, 7, 30))
    expect(momentToZonedTime(at, 'America/New_York').time).toBe('03:30')
  })

  it("shows a deadline in the device's zone, with the posting's time as a hint", () => {
    const at = Date.UTC(2026, 9, 16, 6, 59) as Moment
    const deadline = { kind: 'time', at: { at, timeZone: 'America/Los_Angeles' } } as const
    expect(formatDeadline(deadline, 'en-US', 'Europe/London')).toBe(
      'Oct 16, 2026, 7:59 AM (Oct 15, 2026, 11:59 PM America/Los_Angeles)',
    )
    expect(formatDeadline(deadline, 'en-US', 'America/Los_Angeles')).toBe('Oct 15, 2026, 11:59 PM')
    expect(formatDeadline({ kind: 'day', day: day('2026-10-15') }, 'en-US')).toBe('Oct 15, 2026')
  })
})
