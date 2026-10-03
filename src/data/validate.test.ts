import { describe, expect, it } from 'vitest'
import { LIMITS, SCHEMA_VERSION, SHARED_TARGETS_ID } from './constants'
import {
  LAPTOP,
  at,
  emptyExportFile,
  emptySharedTargets,
  makeRecord,
  sampleApplication,
  tombstone,
} from './fixtures'
import { defaultStamp, stampEdit } from './stamp'
import type { Uuid } from './types/core'
import type { FieldDefinitionData } from './types/fields'
import { validateExportFile, validateRecord, type ValidationContext } from './validate'

const APP_ID = '22222222-2222-4222-8222-222222222222' as Uuid
const FIELD = '33333333-3333-4333-8333-333333333333' as Uuid
const noFields: ValidationContext = { customFields: new Map() }
const stamp = stampEdit(undefined, LAPTOP, at(14))

function application() {
  return makeRecord(APP_ID, sampleApplication(), stamp)
}

/** Validates a record that may have been modified into an invalid shape. */
function check(record: unknown, ctx = noFields) {
  return validateRecord('applications', record, ctx)
}

describe('validateRecord', () => {
  it('accepts a valid application', () => {
    expect(check(application())).toEqual({ errors: [], warnings: [] })
  })

  it('accepts default-stamped records (updatedAt 0)', () => {
    const record = makeRecord(SHARED_TARGETS_ID, emptySharedTargets(), defaultStamp(LAPTOP))
    expect(validateRecord('sharedTargets', record, noFields).errors).toEqual([])
  })

  it('rejects unknown fields', () => {
    const record = { ...application(), salary: 100 }
    expect(check(record).errors).toContain('applications.salary: unknown field')
  })

  it('rejects a field without a stamp', () => {
    const record = application()
    delete (record.fieldMeta as Record<string, unknown>).company
    expect(check(record).errors).toContain('applications.fieldMeta.company: missing stamp')
  })

  it('rejects impossible calendar days', () => {
    const record = { ...application(), dateApplied: '2026-02-30' }
    expect(check(record).errors).toEqual(['applications.dateApplied: expected a date (YYYY-MM-DD)'])
  })

  it('rejects oversized text', () => {
    const record = { ...application(), notes: 'x'.repeat(LIMITS.longText + 1) }
    expect(check(record).errors).toEqual([
      `applications.notes: longer than ${LIMITS.longText} characters`,
    ])
  })

  it('rejects links that are not http(s)', () => {
    const record = { ...application(), listing: 'javascript:alert(1)' }
    expect(check(record).errors).toEqual(['applications.listing: expected a web link'])
  })

  it('rejects an updatedAt that does not match the newest stamp', () => {
    const record = { ...application(), updatedAt: at(9) }
    expect(check(record).errors).toEqual([
      'applications.updatedAt: must match the newest field stamp',
    ])
  })

  it('rejects the wrong schema version', () => {
    const record = { ...application(), schemaVersion: SCHEMA_VERSION + 1 }
    expect(check(record).errors).toHaveLength(1)
  })

  it('accepts a tombstone and rejects one that still holds data', () => {
    const dead = tombstone(APP_ID, stamp)
    expect(check(dead).errors).toEqual([])
    expect(check({ ...dead, company: 'Example Co' }).errors).toContain(
      'applications.company: unknown field',
    )
  })

  it('keeps and flags a value for an unknown custom field', () => {
    const record = application()
    record.custom[FIELD] = 'something'
    record.fieldMeta[`custom.${FIELD}`] = stamp
    expect(check(record)).toEqual({
      errors: [],
      warnings: [`applications.custom.${FIELD}: value for an unknown custom field (kept)`],
    })
  })

  it('checks custom values against their field type', () => {
    const def: FieldDefinitionData = {
      scope: { table: 'applications' },
      label: 'Referral',
      type: 'yesNo',
    }
    const ctx = { customFields: new Map([[FIELD, def]]) }
    const record = application()
    record.custom[FIELD] = 'yes'
    record.fieldMeta[`custom.${FIELD}`] = stamp
    expect(check(record, ctx).errors).toEqual([`applications.custom.${FIELD}: expected yes/no`])
    record.custom[FIELD] = true
    expect(check(record, ctx).errors).toEqual([])
  })

  it('rejects dangerous keys from parsed JSON', () => {
    const record = JSON.parse(JSON.stringify(application()))
    // JSON.parse creates a real "__proto__" key, unlike an object literal.
    record.custom = JSON.parse('{"__proto__": "x"}')
    expect(check(record).errors.length).toBeGreaterThan(0)
  })
})

describe('validateExportFile', () => {
  function fileWith(applications: unknown[]) {
    const file = emptyExportFile() as unknown as { tables: Record<string, unknown[]> }
    file.tables.applications = applications
    return file
  }

  it('accepts a valid file', () => {
    const result = validateExportFile(fileWith([application()]))
    expect(result.ok).toBe(true)
  })

  it('rejects the whole file if one record is invalid', () => {
    const bad = { ...application(), id: FIELD, company: 42 }
    const result = validateExportFile(fileWith([application(), bad]))
    expect(result).toEqual({ ok: false, errors: ['applications[1].company: expected text'] })
  })

  it('rejects duplicate IDs', () => {
    const result = validateExportFile(fileWith([application(), application()]))
    expect(result).toEqual({ ok: false, errors: ['applications[1].id: duplicate ID'] })
  })

  it('rejects files from a newer version of Guyot', () => {
    const file = { ...emptyExportFile(), schemaVersion: SCHEMA_VERSION + 1 }
    const result = validateExportFile(file)
    expect(result.ok).toBe(false)
  })

  it('rejects a missing table', () => {
    const file = emptyExportFile() as unknown as { tables: Record<string, unknown> }
    delete file.tables.changeLog
    expect(validateExportFile(file)).toEqual({
      ok: false,
      errors: ['file.tables.changeLog: missing'],
    })
  })

  it('rejects shared targets without the fixed ID', () => {
    const file = emptyExportFile() as unknown as { tables: Record<string, unknown[]> }
    file.tables.sharedTargets = [makeRecord(APP_ID, emptySharedTargets(), stamp)]
    expect(validateExportFile(file)).toEqual({
      ok: false,
      errors: ['sharedTargets[0].id: shared targets must use the fixed shared-targets ID'],
    })
  })

  it('knows custom fields defined in the same file', () => {
    const def = makeRecord(
      FIELD,
      { scope: { table: 'applications' }, label: 'Referral', type: 'yesNo' },
      stamp,
    )
    const record = application()
    record.custom[FIELD] = true
    record.fieldMeta[`custom.${FIELD}`] = stamp
    const file = fileWith([record])
    file.tables.fieldDefinitions = [def]
    const result = validateExportFile(file)
    expect(result).toEqual({ ok: true, file, warnings: [] })
  })
})
