import { describe, expect, it } from 'vitest'
import type { Uuid } from '../data/types/core'
import {
  moveColumn,
  resolveColumns,
  setColumnHidden,
  toLayout,
  withLayout,
  type Column,
  type FieldSpec,
} from './columns'

const spec = (key: string, custom = false): FieldSpec => ({
  key,
  label: key,
  type: 'text',
  readOnly: false,
  required: false,
  custom,
})
const FIELD = '11111111-1111-4111-8111-111111111111' as Uuid
const fields = [spec('company'), spec('role'), spec('notes')]
const scope = { table: 'applications' } as const
const keys = (columns: Column[]) => columns.map((c) => c.field.key)
const hidden = (columns: Column[]) => columns.filter((c) => c.hidden).map((c) => c.field.key)

describe('resolveColumns', () => {
  it('uses the default order and hidden columns when nothing is saved', () => {
    const columns = resolveColumns(undefined, fields, ['notes'])
    expect(keys(columns)).toEqual(['company', 'role', 'notes'])
    expect(hidden(columns)).toEqual(['notes'])
  })

  it('follows the saved layout, ignoring fields that no longer exist', () => {
    const layout = { scope, order: ['role', 'gone', 'company', 'notes'], hidden: ['company'] }
    const columns = resolveColumns(layout, fields, ['notes'])
    expect(keys(columns)).toEqual(['role', 'company', 'notes'])
    expect(hidden(columns)).toEqual(['company']) // saved choice beats the default
  })

  it('adds new fields at the end: custom shown, built-ins by their default', () => {
    const layout = { scope, order: ['role'], hidden: [] }
    const columns = resolveColumns(layout, [...fields, spec(FIELD, true)], ['notes'])
    expect(keys(columns)).toEqual(['role', 'company', 'notes', FIELD])
    expect(hidden(columns)).toEqual(['notes'])
  })

  it('never shows an empty table', () => {
    const layout = { scope, order: ['company'], hidden: ['company'] }
    expect(hidden(resolveColumns(layout, [spec('company')], []))).toEqual([])
  })
})

describe('changing columns', () => {
  const columns = resolveColumns(undefined, fields, [])

  it('moves a column up or down, staying put at the ends', () => {
    expect(keys(moveColumn(columns, 'role', -1))).toEqual(['role', 'company', 'notes'])
    expect(keys(moveColumn(columns, 'role', 1))).toEqual(['company', 'notes', 'role'])
    expect(keys(moveColumn(columns, 'company', -1))).toEqual(['company', 'role', 'notes'])
    expect(keys(moveColumn(columns, 'notes', 1))).toEqual(['company', 'role', 'notes'])
  })

  it("hides and shows columns, but won't hide the last one", () => {
    let next = setColumnHidden(columns, 'company', true)
    next = setColumnHidden(next, 'role', true)
    expect(hidden(next)).toEqual(['company', 'role'])
    expect(hidden(setColumnHidden(next, 'notes', true))).toEqual(['company', 'role'])
    expect(hidden(setColumnHidden(next, 'role', false))).toEqual(['company'])
  })

  it('saves the layout per scope', () => {
    const layout = toLayout(scope, setColumnHidden(columns, 'notes', true))
    expect(layout).toEqual({ scope, order: ['company', 'role', 'notes'], hidden: ['notes'] })
    const other = { scope: { table: 'searchProfiles' as const }, order: [], hidden: [] }
    const settings = withLayout(withLayout({ columnLayouts: [other] }, layout), layout)
    expect(settings.columnLayouts).toEqual([other, layout])
  })
})
