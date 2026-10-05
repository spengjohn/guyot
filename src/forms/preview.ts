import type { Money } from '../data/types/fields'
import type { ListOverride } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'
import type { EditValue } from './editModel'

const MAX = 60

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX ? `${flat.slice(0, MAX - 1)}…` : flat
}

/** "3: UX designer, Researcher, Writer" (shortened if long). */
function listPreview(items: readonly string[]): string {
  return `${items.length}: ${shorten(items.join(', '))}`
}

function choiceLabel(field: FieldSpec, id: string): string {
  return field.choices && Object.hasOwn(field.choices, id) ? field.choices[id].label : id
}

function isListOverride(value: EditValue): value is ListOverride {
  return typeof value === 'object' && value !== null && 'mode' in value && 'items' in value
}

/**
 * A one-line summary of a field's value, shown on its collapsed row: "None yet",
 * "3: UX designer, …", "Uses shared", "Adds 2: …". Plain text, for the summary line.
 */
export function previewOf(field: FieldSpec, value: EditValue): string {
  if (field.path && value === undefined) return 'Uses shared'
  if (isListOverride(value)) {
    if (value.items.length === 0)
      return value.mode === 'add' ? 'Adds nothing yet' : 'Replaces with nothing'
    return value.mode === 'add'
      ? `Adds ${listPreview(value.items)}`
      : `Replaces with ${listPreview(value.items)}`
  }
  const prefix = field.path ? 'Overridden: ' : ''
  if (value === undefined || value === null || value === '')
    return field.path ? 'Overridden: empty' : 'Not set'
  if (Array.isArray(value)) {
    if (value.length === 0) return field.path ? 'Overridden: none' : 'None yet'
    const items = field.type === 'choiceList' ? value.map((id) => choiceLabel(field, id)) : value
    return prefix + listPreview(items)
  }
  switch (typeof value) {
    case 'string':
      return prefix + (field.type === 'choice' ? choiceLabel(field, value) : shorten(value))
    case 'boolean':
      return prefix + (value ? 'Yes' : 'No')
    case 'number':
      return prefix + new Intl.NumberFormat().format(value)
  }
  if ('currency' in value) {
    const money = value as Money
    const amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: money.currency })
    return `${prefix}${amount.format(money.amount)} per ${money.period}`
  }
  return `${prefix}Set`
}
