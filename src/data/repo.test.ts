import 'fake-indexeddb/auto' // puts an in-memory IndexedDB on the global object
import { beforeEach, describe, expect, it } from 'vitest'
import { SHARED_TARGETS_ID } from './constants'
import { PHONE, at, editField, emptySharedTargets, makeRecord, sampleApplication } from './fixtures'
import { deterministicId } from './ids'
import { Repo, ValidationError } from './repo'
import { defaultStamp, stampEdit } from './stamp'
import type { Moment, Uuid } from './types/core'
import type { ApplicationData } from './types/tables'

const FIELD = '44444444-4444-4444-8444-444444444444' as Uuid

let time: Moment
let repo: Repo
let dbName: string

beforeEach(async () => {
  time = at(14)
  dbName = `test-${crypto.randomUUID()}` // a fresh database for every test
  repo = await Repo.open({ name: dbName, clock: () => time })
})

async function createApplication(changes: Partial<ApplicationData> = {}) {
  return repo.create('applications', { ...sampleApplication(), ...changes })
}

describe('opening', () => {
  it('keeps the same device ID across restarts', async () => {
    const first = repo.deviceId
    repo.close()
    const reopened = await Repo.open({ name: dbName })
    expect(reopened.deviceId).toBe(first)
  })
})

describe('create', () => {
  it('stamps every field and logs the change', async () => {
    const record = await createApplication()
    expect(record.fieldMeta.company).toEqual({
      updatedAt: at(14),
      deviceId: repo.deviceId,
      base: null,
    })
    expect(await repo.list('applications')).toEqual([record])
    const [log] = await repo.list('changeLog')
    expect(log).toMatchObject({ action: 'create', recordId: record.id, appliedBy: 'user' })
  })

  it('rejects invalid data and saves nothing', async () => {
    await expect(createApplication({ dateApplied: '2026-02-30' as never })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(await repo.list('applications')).toEqual([])
    expect(await repo.list('changeLog')).toEqual([])
  })

  it('refuses app-owned fields in the data', async () => {
    const data = { ...sampleApplication(), deleted: true }
    await expect(repo.create('applications', data)).rejects.toThrow(/set by the app/)
  })

  it('refuses direct writes to the logs', async () => {
    // @ts-expect-error -- the type system already forbids this; check the runtime guard too
    await expect(repo.create('changeLog', {})).rejects.toThrow(/written by the app only/)
  })
})

describe('update', () => {
  it('stamps only the fields that changed and logs their old values', async () => {
    const created = await createApplication()
    time = at(15)
    const updated = await repo.update('applications', created.id, {
      notes: 'Called recruiter',
      company: 'Example Co', // unchanged
    })
    expect(updated.fieldMeta.notes.updatedAt).toBe(at(15))
    expect(updated.fieldMeta.company.updatedAt).toBe(at(14))
    expect(updated.updatedAt).toBe(at(15))
    const log = (await repo.list('changeLog')).find((l) => l.action === 'update')
    expect(log).toMatchObject({ fieldKeys: ['notes'], before: { notes: '' } })
  })

  it('does nothing when no value changes', async () => {
    const created = await createApplication()
    time = at(15)
    const same = await repo.update('applications', created.id, { notes: '' })
    expect(same).toEqual(created)
    expect(await repo.list('changeLog')).toHaveLength(1)
  })

  it('leaves the record untouched when the update is invalid', async () => {
    const created = await createApplication()
    await expect(
      repo.update('applications', created.id, { notes: 'ok', listing: 'ftp://x' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await repo.get('applications', created.id)).toEqual(created)
  })

  it('stamps custom values entry by entry', async () => {
    await repo.create('fieldDefinitions', {
      scope: { table: 'applications' },
      label: 'Referral',
      type: 'yesNo',
    })
    const created = await createApplication()
    time = at(15)
    const withValue = await repo.update('applications', created.id, { custom: { [FIELD]: true } })
    expect(withValue.fieldMeta[`custom.${FIELD}`].updatedAt).toBe(at(15))
    time = at(16)
    const cleared = await repo.update('applications', created.id, { custom: {} })
    expect(cleared.custom).toEqual({})
    expect(cleared.fieldMeta[`custom.${FIELD}`].updatedAt).toBe(at(16)) // removal is stamped
  })

  it('stays newer than the old value when the clock goes backwards', async () => {
    const created = await createApplication()
    time = at(9) // clock was moved back
    const updated = await repo.update('applications', created.id, { notes: 'later edit' })
    expect(updated.fieldMeta.notes.updatedAt).toBe(at(14) + 1)
  })
})

describe('delete, restore and purge', () => {
  it('moves records to recently deleted and back', async () => {
    const created = await createApplication()
    await repo.delete('applications', created.id)
    expect(await repo.list('applications')).toEqual([])
    expect((await repo.listDeleted('applications')).map((r) => r.id)).toEqual([created.id])
    await repo.restore('applications', created.id)
    expect((await repo.list('applications')).map((r) => r.id)).toEqual([created.id])
  })

  it('only purges deleted records', async () => {
    const created = await createApplication()
    await expect(repo.purge('applications', created.id)).rejects.toThrow(/Delete the record/)
  })

  it('leaves a tombstone and clears the record from the logs', async () => {
    const created = await createApplication({ notes: 'private note' })
    time = at(15)
    await repo.update('applications', created.id, { notes: 'edited' })
    // A conflict about this record, from merging another device's copy.
    const other = editField(created, 'notes', 'phone note', PHONE, at(14, 30))
    await repo.saveMerged('applications', other)
    expect(await repo.list('conflictLog')).toHaveLength(1)

    await repo.delete('applications', created.id)
    await repo.purge('applications', created.id)

    const stored = await repo.get('applications', created.id)
    expect(stored).toMatchObject({ id: created.id, deleted: true, purged: true })
    expect(Object.keys(stored ?? {})).not.toContain('notes')
    expect(await repo.list('conflictLog')).toEqual([])
    const logs = await repo.list('changeLog')
    expect(logs.every((l) => Object.keys(l.before).length === 0)).toBe(true)
    expect(JSON.stringify(logs)).not.toContain('private note')
  })
})

describe('shared targets', () => {
  it('is created once, with default stamps', async () => {
    const first = await repo.getSharedTargets()
    expect(first.id).toBe(SHARED_TARGETS_ID)
    expect(Object.values(first.fieldMeta).every((s) => s.updatedAt === 0)).toBe(true)
    time = at(15)
    expect(await repo.getSharedTargets()).toEqual(first)
  })

  it('cannot be created, deleted or purged', async () => {
    await repo.getSharedTargets()
    await expect(repo.create('sharedTargets', {} as never)).rejects.toThrow(/only one/)
    await expect(repo.delete('sharedTargets', SHARED_TARGETS_ID)).rejects.toThrow(/reset/)
    await expect(repo.purge('sharedTargets', SHARED_TARGETS_ID)).rejects.toThrow(/reset/)
  })

  it('reset stamps every field as a real edit', async () => {
    await repo.getSharedTargets()
    await repo.update('sharedTargets', SHARED_TARGETS_ID, { mustHaveKeywords: ['React'] })
    time = at(15)
    const reset = await repo.resetSharedTargets()
    expect(reset.mustHaveKeywords).toEqual([])
    expect(reset.fieldMeta.dealbreakers.updatedAt).toBe(at(15)) // unchanged, but stamped
  })
})

describe('Role IDs', () => {
  it('counts up and survives restarts', async () => {
    expect(await repo.nextRoleId()).toBe('R001')
    expect(await repo.nextRoleId()).toBe('R002')
    repo.close()
    repo = await Repo.open({ name: dbName })
    expect(await repo.nextRoleId()).toBe('R003')
  })

  it('skips past Role IDs that arrive from other devices', async () => {
    const id = crypto.randomUUID() as Uuid
    const record = makeRecord(
      id,
      { ...sampleApplication(), roleId: 'R041' },
      stampEdit(undefined, PHONE, at(10)),
    )
    await repo.saveMerged('applications', record)
    expect(await repo.nextRoleId()).toBe('R042')
  })
})

describe('saveMerged', () => {
  it('adds a record it has never seen', async () => {
    const record = makeRecord(
      crypto.randomUUID() as Uuid,
      sampleApplication(),
      stampEdit(undefined, PHONE, at(10)),
    )
    const outcome = await repo.saveMerged('applications', record)
    expect(outcome).toMatchObject({ changed: true, conflicts: 0 })
    expect(await repo.get('applications', record.id)).toEqual(record)
  })

  it('logs a real conflict once, with an ID every device agrees on', async () => {
    const created = await createApplication()
    time = at(16)
    await repo.update('applications', created.id, { notes: 'laptop note' })
    const phone = editField(created, 'notes', 'phone note', PHONE, at(15))
    expect((await repo.saveMerged('applications', phone)).conflicts).toBe(1)
    expect((await repo.saveMerged('applications', phone)).changed).toBe(false)

    const [conflict] = await repo.list('conflictLog')
    expect(conflict).toMatchObject({
      fieldKey: 'notes',
      losingValue: 'phone note',
      resolved: false,
    })
    const { updatedAt, deviceId } = phone.fieldMeta.notes
    expect(conflict.id).toBe(
      deterministicId(`applications|${created.id}|notes|${updatedAt}|${deviceId}`),
    )
  })

  it('rejects an invalid record and changes nothing', async () => {
    const created = await createApplication()
    const bad = { ...editField(created, 'notes', 'x', PHONE, at(15)), company: 42 }
    await expect(repo.saveMerged('applications', bad)).rejects.toBeInstanceOf(ValidationError)
    expect(await repo.get('applications', created.id)).toEqual(created)
  })

  it("doesn't let another device's defaults wipe real shared targets", async () => {
    await repo.getSharedTargets()
    await repo.update('sharedTargets', SHARED_TARGETS_ID, { mustHaveKeywords: ['React'] })
    const phoneDefaults = makeRecord(SHARED_TARGETS_ID, emptySharedTargets(), defaultStamp(PHONE))
    await repo.saveMerged('sharedTargets', phoneDefaults)
    expect((await repo.getSharedTargets()).mustHaveKeywords).toEqual(['React'])
    expect(await repo.list('conflictLog')).toEqual([])
  })
})
