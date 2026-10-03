import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { PHONE, at, editField, sampleApplication } from './fixtures'
import { Repo } from './repo'
import type { Moment, Uuid } from './types/core'
import type { ChangeAction } from './types/tables'

const FIELD = '55555555-5555-4555-8555-555555555555' as Uuid

let time: Moment
let repo: Repo

beforeEach(async () => {
  time = at(14)
  repo = await Repo.open({ name: `test-${crypto.randomUUID()}`, clock: () => time })
})

/** The most recent change log entry with this action. */
async function lastChange(action: ChangeAction) {
  const entries = (await repo.list('changeLog')).filter((e) => e.action === action)
  return entries.sort((a, b) => a.updatedAt - b.updatedAt).at(-1)!
}

async function notes(id: Uuid) {
  const record = await repo.get('applications', id)
  return record && !record.purged ? record.notes : undefined
}

describe('undo', () => {
  it('puts back the old value, and can itself be undone', async () => {
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.update('applications', app.id, { notes: 'first draft' })
    time = at(16)
    await repo.undo((await lastChange('update')).id)
    expect(await notes(app.id)).toBe('')
    time = at(17)
    await repo.undo((await lastChange('undo')).id)
    expect(await notes(app.id)).toBe('first draft')
  })

  it('leaves fields that changed later alone', async () => {
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.update('applications', app.id, { notes: 'a', contact: 'Sam' })
    const first = await lastChange('update')
    time = at(16)
    await repo.update('applications', app.id, { notes: 'b' })
    time = at(17)
    const result = await repo.undo(first.id)
    expect(result.skipped).toEqual(['notes'])
    expect(await notes(app.id)).toBe('b') // newer work kept
    const record = await repo.get('applications', app.id)
    expect(record && !record.purged && record.contact).toBe('') // undone
  })

  it('does nothing the second time', async () => {
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.update('applications', app.id, { notes: 'x' })
    const change = await lastChange('update')
    time = at(16)
    await repo.undo(change.id)
    time = at(17)
    await repo.update('applications', app.id, { contact: 'unrelated' })
    time = at(18)
    expect((await repo.undo(change.id)).skipped).toEqual(['notes'])
    expect(await notes(app.id)).toBe('')
  })

  it('never overwrites a newer edit, even when the clock went backwards', async () => {
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.update('applications', app.id, { notes: 'first' })
    const first = await lastChange('update')
    time = at(14, 50) // clock corrected backwards: the next change's log entry looks older
    await repo.update('applications', app.id, { notes: 'second' })
    time = at(16)
    expect((await repo.undo(first.id)).skipped).toEqual(['notes'])
    expect(await notes(app.id)).toBe('second')
  })

  it('can undo the later of two changes made in the same millisecond', async () => {
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.update('applications', app.id, { notes: 'a' })
    await repo.update('applications', app.id, { notes: 'b' }) // same clock reading
    const entries = (await repo.list('changeLog')).filter((e) => e.action === 'update')
    const second = entries.find((e) => e.before.notes === 'a')!
    time = at(16)
    expect((await repo.undo(second.id)).skipped).toEqual([])
    expect(await notes(app.id)).toBe('a')
  })

  it('undoing a creation moves the record to recently deleted', async () => {
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.undo((await lastChange('create')).id)
    expect((await repo.listDeleted('applications')).map((r) => r.id)).toEqual([app.id])
  })

  it('undoing a delete restores the record', async () => {
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.delete('applications', app.id)
    time = at(16)
    await repo.undo((await lastChange('delete')).id)
    expect((await repo.list('applications')).map((r) => r.id)).toEqual([app.id])
  })

  it('removes a custom value that the change added', async () => {
    await repo.create('fieldDefinitions', {
      scope: { table: 'applications' },
      label: 'Referral',
      type: 'yesNo',
    })
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.update('applications', app.id, { custom: { [FIELD]: true } })
    time = at(16)
    await repo.undo((await lastChange('update')).id)
    const record = await repo.get('applications', app.id)
    expect(record && !record.purged && record.custom).toEqual({})
  })

  it('works the same for AI changes', async () => {
    const app = await repo.create('applications', sampleApplication())
    time = at(15)
    await repo.update('applications', app.id, { notes: 'AI wrote this' }, { appliedBy: 'ai' })
    expect(await lastChange('update')).toMatchObject({ appliedBy: 'ai' })
    time = at(16)
    await repo.undo((await lastChange('update')).id)
    expect(await notes(app.id)).toBe('')
  })

  it('refuses to undo a permanent removal', async () => {
    const app = await repo.create('applications', sampleApplication())
    await repo.delete('applications', app.id)
    await repo.purge('applications', app.id)
    await expect(repo.undo((await lastChange('purge')).id)).rejects.toThrow(/cannot be undone/)
  })
})

describe('conflicts', () => {
  /** Creates a conflict: this device's note wins, the phone's loses. */
  async function withConflict() {
    const app = await repo.create('applications', sampleApplication())
    time = at(16)
    await repo.update('applications', app.id, { notes: 'laptop note' })
    await repo.saveMerged('applications', editField(app, 'notes', 'phone note', PHONE, at(15)))
    const [conflict] = await repo.list('conflictLog')
    return { app, conflict }
  }

  it('restore puts the losing value back as a new edit', async () => {
    const { app, conflict } = await withConflict()
    time = at(17)
    await repo.restoreConflict(conflict.id)
    expect(await notes(app.id)).toBe('phone note')
    const record = await repo.get('applications', app.id)
    expect(record?.fieldMeta.notes).toMatchObject({ updatedAt: at(17), deviceId: repo.deviceId })
    expect(await repo.get('conflictLog', conflict.id)).toMatchObject({ resolved: true })
    await expect(repo.restoreConflict(conflict.id)).rejects.toThrow(/already resolved/)
  })

  it('dismiss keeps the winner and marks the conflict resolved', async () => {
    const { app, conflict } = await withConflict()
    time = at(17)
    await repo.dismissConflict(conflict.id)
    expect(await notes(app.id)).toBe('laptop note')
    expect(await repo.get('conflictLog', conflict.id)).toMatchObject({ resolved: true })
  })
})
