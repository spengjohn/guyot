import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { SHARED_TARGETS_ID } from './constants'
import { BACKUPS_STORE, openDatabase, request, transactionDone } from './db'
import { at, sampleApplication, sampleProfile } from './fixtures'
import { Repo, ValidationError } from './repo'
import type { Moment, Uuid } from './types/core'

let time: Moment
let repo: Repo
let dbName: string

beforeEach(async () => {
  time = at(9)
  dbName = `test-${crypto.randomUUID()}`
  repo = await Repo.open({ name: dbName, clock: () => time })
})

/**
 * Data before the backup: application A (notes "one"), profile P, application C.
 * After it: A's notes changed, P deleted, B created, C permanently removed, and shared
 * targets created and edited.
 */
async function scenario() {
  const a = await repo.create('applications', { ...sampleApplication(), notes: 'one' })
  const p = await repo.create('searchProfiles', sampleProfile())
  const c = await repo.create('applications', { ...sampleApplication(), roleId: 'R002' as never })
  time = at(10)
  const backup = await repo.createBackup('test')
  time = at(11)
  await repo.update('applications', a.id, { notes: 'two' })
  await repo.delete('searchProfiles', p.id)
  const b = await repo.create('applications', { ...sampleApplication(), roleId: 'R003' as never })
  await repo.delete('applications', c.id)
  await repo.purge('applications', c.id)
  await repo.getSharedTargets()
  await repo.update('sharedTargets', SHARED_TARGETS_ID, { mustHaveKeywords: ['React'] })
  time = at(12)
  return { a, b, c, p, backupId: backup.id }
}

describe('previewRestore', () => {
  it('counts what a restore would do, and changes nothing', async () => {
    const { a, backupId } = await scenario()
    expect(await repo.previewRestore(backupId)).toEqual({
      changed: 3, // A's notes, P back from deleted, shared targets reset
      movedToDeleted: 1, // B
      cannotRestore: 1, // C was removed permanently
    })
    expect(await repo.get('applications', a.id)).toMatchObject({ notes: 'two' })
  })
})

describe('restoreBackup', () => {
  it('makes the data match the backup, as new edits', async () => {
    const { a, b, c, p, backupId } = await scenario()
    const outcome = await repo.restoreBackup(backupId)
    expect(outcome).toMatchObject({ changed: 3, movedToDeleted: 1, cannotRestore: 1 })

    const restored = await repo.get('applications', a.id)
    expect(restored).toMatchObject({ notes: 'one', deleted: false })
    expect(restored?.fieldMeta.notes.updatedAt).toBe(at(12)) // a real edit, newest, so it syncs
    expect((await repo.list('searchProfiles')).map((r) => r.id)).toEqual([p.id])
    expect((await repo.listDeleted('applications')).map((r) => r.id)).toEqual([b.id])
    expect(await repo.get('applications', c.id)).toMatchObject({ purged: true }) // purge wins
    expect((await repo.getSharedTargets()).mustHaveKeywords).toEqual([])
  })

  it('saves a backup of the current data first, so the restore can be reversed', async () => {
    const { a, b, backupId } = await scenario()
    const { backupId: before } = await repo.restoreBackup(backupId)
    const [newest] = await repo.listBackups()
    expect(newest).toMatchObject({ id: before, createdAt: at(12) })
    expect(newest.reason).toMatch(/^Before restoring the backup from /)

    time = at(13)
    await repo.restoreBackup(before)
    expect(await repo.get('applications', a.id)).toMatchObject({ notes: 'two' })
    expect((await repo.list('applications')).map((r) => r.id)).toContain(b.id)
  })

  it('logs each change, so a single one can be undone', async () => {
    const { a, backupId } = await scenario()
    await repo.restoreBackup(backupId)
    const entry = (await repo.list('changeLog')).find(
      (l) => l.recordId === a.id && l.fieldKeys.includes('notes') && l.before.notes === 'two',
    )
    expect(entry).toBeDefined()
    time = at(13)
    expect(await repo.undo(entry!.id)).toEqual({ skipped: [] })
    expect(await repo.get('applications', a.id)).toMatchObject({ notes: 'two' })
  })

  it('changes nothing when the backup is invalid', async () => {
    const { a } = await scenario()
    const id = crypto.randomUUID() as Uuid
    const db = await openDatabase(dbName)
    const tx = db.transaction(BACKUPS_STORE, 'readwrite')
    const done = transactionDone(tx)
    const json = JSON.stringify({ app: 'guyot', formatVersion: 1, tables: {} })
    await request(
      tx
        .objectStore(BACKUPS_STORE)
        .put({ id, createdAt: at(13), reason: 'bad', schemaVersion: 2, json }),
    )
    await done
    db.close()

    const backups = (await repo.listBackups()).length
    await expect(repo.restoreBackup(id)).rejects.toBeInstanceOf(ValidationError)
    expect(await repo.get('applications', a.id)).toMatchObject({ notes: 'two' })
    expect(await repo.listBackups()).toHaveLength(backups) // no pre-restore backup either
  })

  it('upgrades a backup from an older format first', async () => {
    const p = await repo.create('searchProfiles', {
      ...sampleProfile(),
      overrides: { roleTypes: { mode: 'replace', items: ['UX'] } },
    })
    time = at(10)
    const { id } = await repo.createBackup('current format')
    // Rewrite that backup into format 1, where list overrides were plain lists.
    const db = await openDatabase(dbName)
    const tx = db.transaction(BACKUPS_STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(BACKUPS_STORE)
    const backup = (await request(store.get(id))) as { json: string }
    const file = JSON.parse(backup.json)
    file.schemaVersion = 1
    delete file.tables.goals
    for (const table of Object.keys(file.tables)) {
      for (const record of file.tables[table]) record.schemaVersion = 1
    }
    const profile = file.tables.searchProfiles[0]
    profile.overrides.roleTypes = ['UX']
    delete profile.customOverrides
    await request(store.put({ ...backup, schemaVersion: 1, json: JSON.stringify(file) }))
    await done
    db.close()

    time = at(11)
    await repo.update('searchProfiles', p.id, { overrides: {} })
    time = at(12)
    await repo.restoreBackup(id)
    const restored = await repo.get('searchProfiles', p.id)
    expect(restored).toMatchObject({ overrides: { roleTypes: { mode: 'replace', items: ['UX'] } } })
  })
})
