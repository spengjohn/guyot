import type { ReactNode } from 'react'
import type { CalendarDay, ZonedMoment } from '../data/types/core'
import type { Deadline, FieldValue as Value, Money } from '../data/types/fields'
import { formatCalendarDay, formatDeadline } from '../ui/dates'
import type { FieldSpec } from './columns'

const LONG_TEXT_PREVIEW = 120

/**
 * How one field's value appears in a table cell. Empty values show nothing.
 * `full` shows long text whole instead of a preview (for comparing versions).
 */
export function FieldValue({
  field,
  value,
  full = false,
}: {
  field: FieldSpec
  value: Value | undefined
  full?: boolean
}) {
  return <>{display(field, value, full)}</>
}

// Stored values were validated against their field type before saving, so each
// branch below can treat the value as that type.
function display(field: FieldSpec, value: Value | undefined, full: boolean): ReactNode {
  if (value === null || value === undefined || value === '') return null
  switch (field.type) {
    case 'text':
      return value as string
    case 'longText': {
      const text = value as string
      if (full) return <span className="long-text">{text}</span>
      return text.length > LONG_TEXT_PREVIEW ? `${text.slice(0, LONG_TEXT_PREVIEW)}…` : text
    }
    case 'number':
      return new Intl.NumberFormat().format(value as number)
    case 'date':
      return formatCalendarDay(value as CalendarDay)
    case 'dateTime':
      return formatDeadline({ kind: 'time', at: value as ZonedMoment })
    case 'deadline':
      return formatDeadline(value as Deadline)
    case 'yesNo':
      return value ? 'Yes' : 'No'
    case 'link':
      return <ExternalLink href={value as string} />
    case 'choice':
      return choiceLabel(field, value as string)
    case 'choiceList':
      return (value as string[]).map((id) => choiceLabel(field, id)).join(', ')
    case 'textList':
      return (value as string[]).join(', ')
    case 'money': {
      const money = value as Money
      const amount = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: money.currency,
      }).format(money.amount)
      return `${amount} per ${money.period}`
    }
    case 'reference':
      return 'Attached'
  }
}

/** An option's label. An option this device doesn't know is shown, not hidden. */
function choiceLabel(field: FieldSpec, id: string): string {
  const option = field.choices && Object.hasOwn(field.choices, id) ? field.choices[id] : undefined
  return option ? option.label : `Unknown option (${id})`
}

/**
 * A link showing only its domain, so the destination is visible before clicking.
 * Opens in a new tab, without giving that page access to this one.
 */
function ExternalLink({ href }: { href: string }) {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return <>{href}</>
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return <>{href}</>
  return (
    <a href={url.href} target="_blank" rel="noopener noreferrer">
      {url.hostname}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  )
}
