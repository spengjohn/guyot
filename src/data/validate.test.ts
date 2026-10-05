import { describe, expect, it } from 'vitest'
import { LIMITS, SCHEMA_VERSION, SHARED_TARGETS_ID } from './constants'
import {
  LAPTOP,
  at,
  emptyExportFile,
  emptySharedTargets,
  makeRecord,
  sampleApplication,
  sampleGoal,
  sampleProfile,
  tombstone,
} from './fixtures'
import { defaultStamp, stampEdit } from './stamp'
import type { Uuid } from './types/core'
import type { FieldDefinitionData } from './types/fields'
import {
  validateExportFile,
  validateLocalSettings,
  validateRecord,
  type ValidationContext,
} from './validate'
import { STATUS_CHOICES } from './builtinFields'

const APP_ID = '22222222-2222-4222-8222-222222222222' as Uuid
const FIELD = '33333333-3333-4333-8333-333333333333' as Uuid
type Obj = Record<string, unknown>
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

  it('accepts every Status option and rejects anything else', () => {
    for (const status of Object.keys(STATUS_CHOICES)) {
      expect(check({ ...application(), status }).errors).toEqual([])
    }
    expect(check({ ...application(), status: 'ghosted' }).errors).toEqual([
      'applications.status: not a valid Status',
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

describe('search profile overrides', () => {
  const PROFILE_ID = '55555555-5555-4555-8555-555555555555' as Uuid
  const sharedField: FieldDefinitionData = {
    scope: { table: 'sharedTargets' },
    label: 'Visa sponsorship',
    type: 'yesNo',
  }

  function profile(overrides: Obj, customOverrides: Obj = {}) {
    return makeRecord(PROFILE_ID, { ...sampleProfile(), overrides, customOverrides }, stamp)
  }
  const checkProfile = (record: unknown, ctx = noFields) =>
    validateRecord('searchProfiles', record, ctx)

  it('accepts list overrides in both modes, and text overrides', () => {
    const record = profile({
      roleTypes: { mode: 'add', items: ['UX designer'] },
      dealbreakers: { mode: 'replace', items: [] },
      excludeRule: 'No agencies',
    })
    expect(checkProfile(record)).toEqual({ errors: [], warnings: [] })
  })

  it('rejects a plain list, which would leave the mode unknown', () => {
    const record = profile({ roleTypes: ['UX designer'] })
    expect(checkProfile(record).errors).toEqual([
      'searchProfiles.overrides.roleTypes: expected an object',
    ])
  })

  it('rejects an unknown mode and a mode without items', () => {
    expect(checkProfile(profile({ roleTypes: { mode: 'merge', items: [] } })).errors).toEqual([
      'searchProfiles.overrides.roleTypes.mode: expected one of add, replace',
    ])
    expect(checkProfile(profile({ roleTypes: { mode: 'add' } })).errors).toEqual([
      'searchProfiles.overrides.roleTypes.items: missing',
    ])
  })

  it('rejects overrides of fields that are not shared targets', () => {
    expect(checkProfile(profile({ salary: 'high' })).errors).toContain(
      'searchProfiles.overrides.salary: not a shared target field',
    )
  })

  it('checks custom overrides against their field, keyed by field ID', () => {
    const ctx = { customFields: new Map([[FIELD, sharedField]]) }
    expect(checkProfile(profile({}, { [FIELD]: true }), ctx)).toEqual({ errors: [], warnings: [] })
    expect(checkProfile(profile({}, { [FIELD]: null }), ctx).errors).toEqual([]) // empty
    expect(checkProfile(profile({}, { [FIELD]: 'yes' }), ctx).errors).toEqual([
      `searchProfiles.customOverrides.${FIELD}: expected yes/no`,
    ])
    expect(checkProfile(profile({}, { Visa: true }), ctx).errors).toContain(
      'searchProfiles.customOverrides.Visa: expected an ID',
    )
  })

  it('keeps and flags custom overrides for unknown or non-shared fields', () => {
    expect(checkProfile(profile({}, { [FIELD]: true })).warnings).toEqual([
      `searchProfiles.customOverrides.${FIELD}: value for an unknown custom field (kept)`,
    ])
    const appField = { ...sharedField, scope: { table: 'applications' as const } }
    const ctx = { customFields: new Map([[FIELD, appField]]) }
    expect(checkProfile(profile({}, { [FIELD]: true }), ctx)).toEqual({
      errors: [],
      warnings: [
        `searchProfiles.customOverrides.${FIELD}: overrides a field that is not a shared target (kept)`,
      ],
    })
  })
})

describe('search profile choices', () => {
  const PROFILE_ID = '77777777-7777-4777-8777-777777777777' as Uuid
  const profile = (changes: Obj) =>
    makeRecord(PROFILE_ID, { ...sampleProfile(), ...changes }, stamp)
  const errors = (changes: Obj) =>
    validateRecord('searchProfiles', profile(changes), noFields).errors

  it('accepts the fixed options', () => {
    expect(
      errors({
        employmentTypes: ['fullTime', 'contract'],
        workModes: ['remote', 'hybrid'],
        priority: 'high',
      }),
    ).toEqual([])
    expect(errors({ priority: null })).toEqual([])
  })

  it('rejects anything else, item by item', () => {
    expect(errors({ employmentTypes: ['fullTime', 'gig'] })).toEqual([
      'searchProfiles.employmentTypes[1]: not a valid Employment type',
    ])
    expect(errors({ workModes: ['office'] })).toEqual([
      'searchProfiles.workModes[0]: not a valid Work mode',
    ])
    expect(errors({ priority: 'urgent' })).toEqual([
      'searchProfiles.priority: not a valid Priority',
    ])
  })
})

describe('goals', () => {
  const GOAL_ID = '66666666-6666-4666-8666-666666666666' as Uuid
  const goal = (changes: Obj = {}) => makeRecord(GOAL_ID, { ...sampleGoal(), ...changes }, stamp)
  const checkGoal = (record: unknown) => validateRecord('goals', record, noFields).errors

  it('accepts a valid goal, with or without an end day', () => {
    expect(checkGoal(goal())).toEqual([])
    expect(checkGoal(goal({ endDay: '2026-12-31', period: 'month' }))).toEqual([])
  })

  it('rejects a target that is not a whole number of at least 1', () => {
    expect(checkGoal(goal({ target: 0 }))).toEqual(['goals.target: below 1'])
    expect(checkGoal(goal({ target: 2.5 }))).toEqual(['goals.target: expected a whole number'])
  })

  it('rejects unknown measures, periods and weekdays', () => {
    expect(checkGoal(goal({ measure: 'interviews' }))).toHaveLength(1)
    expect(checkGoal(goal({ period: 'year' }))).toHaveLength(1)
    expect(checkGoal(goal({ weekStartsOn: 'mon' }))).toHaveLength(1)
  })

  it('rejects an end day before the start day', () => {
    expect(checkGoal(goal({ endDay: '2026-10-04' }))).toEqual([
      'goals.endDay: before the start day',
    ])
    expect(checkGoal(goal({ endDay: '2026-10-05' }))).toEqual([]) // one-day goal
  })
})

describe('validateLocalSettings', () => {
  it('accepts column layouts and rejects damaged ones', () => {
    const layout = { scope: { table: 'applications' }, order: ['company', FIELD], hidden: [] }
    expect(validateLocalSettings({ columnLayouts: [layout] })).toEqual([])
    expect(validateLocalSettings({ columnLayouts: [{ ...layout, order: 'company' }] })).toEqual([
      'settings.columnLayouts[0].order: expected a list',
    ])
    expect(validateLocalSettings(null)).toEqual(['settings: expected an object'])
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
