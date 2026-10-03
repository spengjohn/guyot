import { describe, expect, it } from 'vitest'
import { SHARED_TARGETS_ID } from './constants'
import { LAPTOP, PHONE, at, editField, emptySharedTargets, makeRecord, tombstone } from './fixtures'
import { mergeRecords, type MergeResult } from './merge'
import { defaultStamp, stampEdit } from './stamp'
import type { Moment, Uuid } from './types/core'
import type { StoredRecord } from './types/record'
import type { SharedTargetsData } from './types/tables'
import { validateRecord } from './validate'

type Targets = StoredRecord<SharedTargetsData>
const FIELD = '11111111-1111-4111-8111-111111111111' as Uuid

/** Merges both ways, checks the results match, and returns one of them. */
function mergeBoth(a: Targets, b: Targets): MergeResult<SharedTargetsData> {
  const ab = mergeRecords(a, b)
  const ba = mergeRecords(b, a)
  expect(ab.record).toEqual(ba.record)
  expect(ab.conflicts).toEqual(ba.conflicts)
  const report = validateRecord('sharedTargets', ab.record, { customFields: new Map() })
  expect(report.errors).toEqual([])
  return ab
}

/** A fresh shared-targets record on a device: empty values, stamped as defaults. */
function seeded(deviceId: typeof LAPTOP) {
  return makeRecord(SHARED_TARGETS_ID, emptySharedTargets(), defaultStamp(deviceId))
}

/** The laptop's targets after the user fills some in at 2:00 PM. */
function laptopWithTargets() {
  let laptop = seeded(LAPTOP)
  laptop = editField(laptop, 'mustHaveKeywords', ['TypeScript', 'React'], LAPTOP, at(14))
  laptop = editField(laptop, 'excludeRule', 'No staffing agencies', LAPTOP, at(14))
  return laptop
}

describe('defaults never beat real edits', () => {
  it("a new device's empty defaults don't wipe real targets", () => {
    // Phone opens Guyot for the first time at 3:00 PM, before syncing.
    const phone = seeded(PHONE)
    const { record, conflicts } = mergeBoth(laptopWithTargets(), phone)
    expect(record.purged).toBe(false)
    if (record.purged) return
    expect(record.mustHaveKeywords).toEqual(['TypeScript', 'React'])
    expect(record.excludeRule).toBe('No staffing agencies')
    expect(conflicts).toEqual([])
  })

  it("the phone's first edit keeps the laptop's other fields", () => {
    const phone = editField(seeded(PHONE), 'dealbreakers', ['Unpaid trial work'], PHONE, at(15))
    const { record, conflicts } = mergeBoth(laptopWithTargets(), phone)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(record.mustHaveKeywords).toEqual(['TypeScript', 'React'])
    expect(record.dealbreakers).toEqual(['Unpaid trial work'])
    expect(conflicts).toEqual([])
  })

  it("a migration default doesn't overwrite a value set on another device", () => {
    // Both devices upgraded and got the new field (excludeRule here) as a default;
    // the laptop then set it for real.
    const laptop = laptopWithTargets()
    const phone = structuredClone(laptop)
    phone.excludeRule = ''
    phone.fieldMeta.excludeRule = defaultStamp(PHONE)
    const { record, conflicts } = mergeBoth(laptop, phone)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(record.excludeRule).toBe('No staffing agencies')
    expect(conflicts).toEqual([])
  })
})

describe('field-level merge', () => {
  it('edits to different fields on different devices both survive', () => {
    const synced = laptopWithTargets()
    const laptop = editField(synced, 'industries', ['Health'], LAPTOP, at(16))
    const phone = editField(synced, 'roleTypes', ['Frontend'], PHONE, at(16, 5))
    const { record, conflicts } = mergeBoth(laptop, phone)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(record.industries).toEqual(['Health'])
    expect(record.roleTypes).toEqual(['Frontend'])
    expect(conflicts).toEqual([])
    expect(record.updatedAt).toBe(at(16, 5))
    expect(record.deviceId).toBe(PHONE)
  })

  it('concurrent edits to one field: newest wins, the other goes to the conflict log', () => {
    const synced = laptopWithTargets()
    const laptop = editField(synced, 'mustHaveKeywords', ['Vue'], LAPTOP, at(16))
    const phone = editField(synced, 'mustHaveKeywords', ['Svelte'], PHONE, at(15, 30))
    const { record, conflicts } = mergeBoth(laptop, phone)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(record.mustHaveKeywords).toEqual(['Vue'])
    expect(conflicts).toEqual([
      {
        fieldKey: 'mustHaveKeywords',
        losingValue: ['Svelte'],
        losingStamp: phone.fieldMeta.mustHaveKeywords,
        winningStamp: laptop.fieldMeta.mustHaveKeywords,
      },
    ])
  })

  it('an edit made on top of the other device’s value is not a conflict', () => {
    const laptop = laptopWithTargets()
    const phone = editField(laptop, 'mustHaveKeywords', ['TypeScript'], PHONE, at(15))
    const { record, conflicts } = mergeBoth(laptop, phone)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(record.mustHaveKeywords).toEqual(['TypeScript'])
    expect(conflicts).toEqual([])
  })

  it('several edits in a row on one device are still not a conflict', () => {
    const laptop = laptopWithTargets()
    let phone = editField(laptop, 'mustHaveKeywords', ['A'], PHONE, at(15))
    phone = editField(phone, 'mustHaveKeywords', ['B'], PHONE, at(15, 10))
    expect(phone.fieldMeta.mustHaveKeywords.base).toEqual({ updatedAt: at(14), deviceId: LAPTOP })
    const { conflicts } = mergeBoth(laptop, phone)
    expect(conflicts).toEqual([])
  })

  it('a tie on time goes to the larger deviceId', () => {
    const synced = laptopWithTargets()
    const laptop = editField(synced, 'excludeRule', 'Laptop rule', LAPTOP, at(16))
    const phone = editField(synced, 'excludeRule', 'Phone rule', PHONE, at(16))
    const { record, conflicts } = mergeBoth(laptop, phone)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(record.excludeRule).toBe('Phone rule') // 'bbbb…' > 'aaaa…'
    expect(conflicts.map((c) => c.losingValue)).toEqual(['Laptop rule'])
  })

  it('equal values are never logged as conflicts', () => {
    const synced = laptopWithTargets()
    const laptop = editField(synced, 'industries', ['Health'], LAPTOP, at(16))
    const phone = editField(synced, 'industries', ['Health'], PHONE, at(16, 1))
    expect(mergeBoth(laptop, phone).conflicts).toEqual([])
  })

  it('a delete on one device and an edit on another both survive', () => {
    const synced = laptopWithTargets()
    const laptop = editField(synced, 'deleted', true, LAPTOP, at(15))
    const phone = editField(synced, 'roleTypes', ['Frontend'], PHONE, at(15, 30))
    const { record } = mergeBoth(laptop, phone)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(record.deleted).toBe(true)
    expect(record.roleTypes).toEqual(['Frontend'])
  })
})

describe('map fields', () => {
  it('a new custom value from the other device is added', () => {
    const synced = laptopWithTargets()
    const phone = editField(synced, `custom.${FIELD}`, 'Remote first', PHONE, at(15))
    const { record } = mergeBoth(synced, phone)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(record.custom[FIELD]).toBe('Remote first')
  })

  it('a removed custom value stays removed', () => {
    const withValue = editField(laptopWithTargets(), `custom.${FIELD}`, 'x', PHONE, at(15))
    const removed = editField(withValue, `custom.${FIELD}`, undefined, LAPTOP, at(16))
    const { record } = mergeBoth(withValue, removed)
    if (record.purged) throw new Error('unexpected tombstone')
    expect(Object.hasOwn(record.custom, FIELD)).toBe(false)
  })
})

describe('tombstones', () => {
  it('purge wins over a later edit, with nothing sent to the conflict log', () => {
    const synced = laptopWithTargets()
    const purged = tombstone(SHARED_TARGETS_ID, stampEdit(undefined, LAPTOP, at(15)))
    const phone = editField(synced, 'roleTypes', ['Frontend'], PHONE, at(16))
    const ab = mergeRecords(purged, phone)
    const ba = mergeRecords(phone, purged)
    expect(ab).toEqual({ record: purged, conflicts: [] })
    expect(ba).toEqual({ record: purged, conflicts: [] })
  })
})

describe('guards', () => {
  it('refuses to merge different records', () => {
    const other = { ...seeded(PHONE), id: FIELD }
    expect(() => mergeRecords(seeded(LAPTOP), other)).toThrow(/different records/)
  })
})

describe('stampEdit', () => {
  it('is always newer than the value it replaces, even with a slow clock', () => {
    const previous = stampEdit(undefined, LAPTOP, 5000 as Moment)
    const next = stampEdit(previous, PHONE, 3000 as Moment)
    expect(next.updatedAt).toBe(5001)
  })

  it('records the other device’s stamp as its base, but never a default', () => {
    expect(stampEdit(defaultStamp(LAPTOP), PHONE, at(15)).base).toBeNull()
    const laptopEdit = stampEdit(undefined, LAPTOP, at(14))
    expect(stampEdit(laptopEdit, PHONE, at(15)).base).toEqual({
      updatedAt: at(14),
      deviceId: LAPTOP,
    })
  })
})
