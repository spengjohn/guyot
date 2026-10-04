import { jsonEqual } from '../data/merge'
import type { Uuid } from '../data/types/core'
import type {
  BuiltinField,
  ChoiceOption,
  ColumnLayout,
  FieldDefinitionData,
  FieldScope,
  FieldType,
} from '../data/types/fields'
import type { LocalSettings } from '../data/types/tables'

/** One field as the UI sees it, whether built in or user-made. */
export interface FieldSpec {
  key: string // a built-in key ('company') or a custom field's ID
  label: string
  type: FieldType
  readOnly: boolean
  required: boolean
  choices?: Readonly<Record<string, ChoiceOption>>
  custom: boolean
}

export function builtinSpec(field: BuiltinField): FieldSpec {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    readOnly: field.readOnly ?? false,
    required: field.required,
    choices: field.choices,
    custom: false,
  }
}

export function customSpec(id: Uuid, def: FieldDefinitionData): FieldSpec {
  return {
    key: id,
    label: def.label,
    type: def.type,
    readOnly: false,
    required: false,
    choices: def.type === 'choice' ? def.choices : undefined,
    custom: true,
  }
}

export interface Column {
  field: FieldSpec
  hidden: boolean
}

/**
 * This device's columns: the saved order and visibility, for the fields that exist now.
 * Fields the layout doesn't mention yet (new custom fields, or built-ins added by an
 * update) go at the end: custom ones shown, built-ins as their default says.
 * Saved keys for fields that no longer exist are ignored.
 */
export function resolveColumns(
  layout: ColumnLayout | undefined,
  fields: readonly FieldSpec[],
  hiddenByDefault: readonly string[],
): Column[] {
  const byKey = new Map(fields.map((field) => [field.key, field]))
  const saved = layout?.order.filter((key) => byKey.has(key)) ?? []
  const savedSet = new Set(saved)
  const hidden = new Set(layout?.hidden ?? [])
  const columns: Column[] = saved.map((key) => ({
    field: byKey.get(key)!,
    hidden: hidden.has(key),
  }))
  for (const field of fields) {
    if (savedSet.has(field.key)) continue
    columns.push({ field, hidden: !field.custom && hiddenByDefault.includes(field.key) })
  }
  if (columns.length > 0 && columns.every((c) => c.hidden)) columns[0].hidden = false
  return columns
}

/** Moves a column one place up (-1) or down (+1). At either end it stays put. */
export function moveColumn(columns: readonly Column[], key: string, by: -1 | 1): Column[] {
  const from = columns.findIndex((c) => c.field.key === key)
  const to = from + by
  if (from === -1 || to < 0 || to >= columns.length) return [...columns]
  const next = [...columns]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** Shows or hides a column. The last visible column can't be hidden. */
export function setColumnHidden(
  columns: readonly Column[],
  key: string,
  hidden: boolean,
): Column[] {
  const visible = columns.filter((c) => !c.hidden)
  if (hidden && visible.length === 1 && visible[0].field.key === key) return [...columns]
  return columns.map((c) => (c.field.key === key ? { ...c, hidden } : c))
}

export function toLayout(scope: FieldScope, columns: readonly Column[]): ColumnLayout {
  return {
    scope,
    order: columns.map((c) => c.field.key),
    hidden: columns.filter((c) => c.hidden).map((c) => c.field.key),
  }
}

export function findLayout(settings: LocalSettings, scope: FieldScope): ColumnLayout | undefined {
  return settings.columnLayouts.find((layout) => jsonEqual(layout.scope, scope))
}

/** Settings with the layout for one scope replaced (or added). */
export function withLayout(settings: LocalSettings, layout: ColumnLayout): LocalSettings {
  const others = settings.columnLayouts.filter((l) => !jsonEqual(l.scope, layout.scope))
  return { ...settings, columnLayouts: [...others, layout] }
}
