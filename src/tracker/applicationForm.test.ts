import { describe, expect, it } from 'vitest'
import { APPLICATION_FIELDS } from '../data/builtinFields'
import { LAPTOP, PHONE, at, editField, makeRecord, sampleApplication } from '../data/fixtures'
import { stampEdit } from '../data/stamp'
import type { CalendarDay, FieldId, Uuid } from '../data/types/core'
import { builtinSpec, customSpec, type FieldSpec } from '../fields/columns'
import {
  fieldState,
  formErrors,
  keepMine,
  missingRequired,
  newApplication,
  newDraft,
  saveRequest,
  takeSaved,
  withEdit,
} from './applicationForm'

const ID = '33333333-3333-4333-8333-333333333333' as Uuid
const FIELD = '11111111-1111-4111-8111-111111111111' as FieldId
const OTHER = '22222222-2222-4222-8222-222222222222' as FieldId
const today = '2026-10-04' as CalendarDay

const spec = (key: string): FieldSpec => builtinSpec(APPLICATION_FIELDS.find((f) => f.key === key)!)
const notes = spec('notes')
const contact = spec('contact')
const referral = customSpec(FIELD, {
  scope: { table: 'applications' },
  label: 'Referral',
  type: 'text',
})
const fields = [notes, contact, referral]

/** The record when the form opened, and the same record after another tab saved Notes. */
function versions() {
  const opened = makeRecord(ID, sampleApplication(), stampEdit(undefined, LAPTOP, at(9)))
  const savedElsewhere = editField(opened, 'notes', 'Tab A', PHONE, at(10))
  return { opened, savedElsewhere }
}

describe('fields in the form', () => {
  it('shows the latest saved value in fields the user has not touched', () => {
    const { opened, savedElsewhere } = versions()
    expect(fieldState(notes, {}, savedElsewhere, opened)).toEqual({
      value: 'Tab A',
      edited: false,
      conflict: null,
      changedSinceOpened: true,
    })
    expect(fieldState(contact, {}, savedElsewhere, opened).changedSinceOpened).toBe(false)
  })

  it('flags a conflict when a field the user edited was saved again elsewhere', () => {
    const { opened, savedElsewhere } = versions()
    const edits = withEdit({}, notes, 'Tab B', opened) // typed before Tab A saved
    expect(fieldState(notes, edits, opened, opened).conflict).toBeNull()
    expect(fieldState(notes, edits, savedElsewhere, opened)).toEqual({
      value: 'Tab B',
      edited: true,
      conflict: { yours: 'Tab B', saved: 'Tab A' },
      changedSinceOpened: true,
    })
  })

  it('sees no conflict when both made the same change', () => {
    const { opened, savedElsewhere } = versions()
    const edits = withEdit({}, notes, 'Tab A', opened)
    expect(fieldState(notes, edits, savedElsewhere, opened).conflict).toBeNull()
  })

  it('resolves a conflict either way', () => {
    const { opened, savedElsewhere } = versions()
    const edits = withEdit({}, notes, 'Tab B', opened)
    const kept = keepMine(edits, notes, savedElsewhere)
    expect(fieldState(notes, kept, savedElsewhere, opened)).toMatchObject({
      value: 'Tab B',
      conflict: null,
    })
    const dropped = takeSaved(edits, notes)
    expect(fieldState(notes, dropped, savedElsewhere, opened)).toMatchObject({
      value: 'Tab A',
      edited: false,
    })
  })

  it('keeps the first base when a field is edited again', () => {
    const { opened, savedElsewhere } = versions()
    let edits = withEdit({}, notes, 'B', opened)
    edits = withEdit(edits, notes, 'Bo', savedElsewhere) // typing on after Tab A saved
    expect(fieldState(notes, edits, savedElsewhere, opened).conflict).not.toBeNull()
  })
})

describe('saveRequest', () => {
  it('saves only real edits, each with the stamp it was based on', () => {
    const { opened } = versions()
    let edits = withEdit({}, notes, 'Called recruiter', opened)
    edits = withEdit(edits, contact, '', opened) // same as saved: nothing to save
    expect(saveRequest(fields, edits, opened)).toEqual({
      changes: { notes: 'Called recruiter' },
      expected: { notes: opened.fieldMeta.notes },
    })
  })

  it('passes custom values along, expecting no stamp on a value never set', () => {
    const { opened } = versions()
    const current = { ...opened, custom: { [OTHER]: true } } // set elsewhere meanwhile
    const edits = withEdit({}, referral, 'Sam', opened)
    expect(saveRequest(fields, edits, current)).toEqual({
      changes: { custom: { [OTHER]: true, [FIELD]: 'Sam' } },
      expected: { [`custom.${FIELD}`]: null },
    })
  })
})

describe('new applications', () => {
  it('starts as Applied, today, and applies the edits', () => {
    const defaults = newDraft(today)
    const edits = withEdit(withEdit({}, notes, 'Hi', defaults), referral, 'Sam', defaults)
    const data = newApplication(fields, edits, defaults)
    expect(data).toMatchObject({ status: 'applied', dateApplied: today, notes: 'Hi' })
    expect(data.custom).toEqual({ [FIELD]: 'Sam' })
    expect(data).not.toHaveProperty('fieldMeta')
  })
})

describe('missingRequired', () => {
  const required = ['company', 'role', 'dateApplied', 'status'].map(spec)
  const values = (v: Record<string, unknown>) => (field: FieldSpec) =>
    (v[field.key] ?? null) as never

  it('lists empty and blank required fields, with what to do', () => {
    expect(
      missingRequired([...required, notes], values({ company: '  ', status: 'applied' })),
    ).toEqual({
      company: 'Enter the company',
      role: 'Enter the role',
      dateApplied: 'Enter the date you applied',
    })
  })

  it('is empty when every required field is filled; optional fields never count', () => {
    const filled = values({
      company: 'Example Co',
      role: 'Designer',
      dateApplied: today,
      status: 'applied',
    })
    expect(missingRequired([...required, notes, referral], filled)).toEqual({})
  })
})

describe('formErrors', () => {
  it('puts each error beside its field, with the field label', () => {
    const custom = new Map([[FIELD, 'Referral']])
    const result = formErrors(
      [
        'applications.listing: expected a web link',
        'applications.dateApplied: expected a date (YYYY-MM-DD)',
        `applications.custom.${FIELD}: expected yes/no`,
        'applications.updatedAt: must match the newest field stamp',
      ],
      custom,
    )
    expect(result).toEqual({
      byField: {
        listing: 'Listing: expected a web link',
        dateApplied: 'Date Applied: expected a date (YYYY-MM-DD)',
        [FIELD]: 'Referral: expected yes/no',
      },
      general: ['applications.updatedAt: must match the newest field stamp'],
    })
  })
})
