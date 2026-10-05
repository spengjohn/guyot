import { describe, expect, it } from 'vitest'
import { EMPLOYMENT_TYPES } from '../data/builtinFields'
import type { FieldSpec } from '../fields/columns'
import { previewOf } from './preview'

const spec = (type: FieldSpec['type'], extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key: 'f',
  label: 'Field',
  type,
  readOnly: false,
  required: false,
  custom: false,
  ...extra,
})
const override = (type: FieldSpec['type']) =>
  spec(type, { key: 'overrides.f', path: 'overrides.f' })

describe('previewOf', () => {
  it('summarizes lists by count and first items', () => {
    expect(previewOf(spec('textList'), [])).toBe('None yet')
    expect(previewOf(spec('textList'), ['UX designer', 'Researcher'])).toBe(
      '2: UX designer, Researcher',
    )
    const long = Array.from({ length: 20 }, (_, i) => `Item number ${i}`)
    expect(previewOf(spec('textList'), long)).toMatch(/^20: Item number 0, .*…$/)
  })

  it('summarizes text, choices and empty values', () => {
    expect(previewOf(spec('longText'), '')).toBe('Not set')
    expect(previewOf(spec('longText'), 'No   staffing\nagencies')).toBe('No staffing agencies')
    expect(previewOf(spec('choiceList', { choices: EMPLOYMENT_TYPES }), ['fullTime'])).toBe(
      '1: Full time',
    )
  })

  it('says how an override treats the shared value', () => {
    expect(previewOf(override('textList'), undefined)).toBe('Uses shared')
    expect(previewOf(override('textList'), { mode: 'add', items: ['A', 'B'] })).toBe('Adds 2: A, B')
    expect(previewOf(override('textList'), { mode: 'replace', items: [] })).toBe(
      'Replaces with nothing',
    )
    expect(previewOf(override('longText'), 'Only startups')).toBe('Overridden: Only startups')
    expect(previewOf(override('longText'), '')).toBe('Overridden: empty')
  })
})
