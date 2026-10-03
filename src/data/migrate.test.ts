import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup, listBackups } from './backup'
import { TABLE_NAMES } from './constants'
import { META_STORE, openDatabase, request, transactionDone } from './db'
import { exportData, exportToJson, importJson } from './exportImport'
import { LAPTOP, PHONE, at, editField, sampleApplication } from './fixtures'
import { addField, NewerDataError, type Migrations } from './migrate'
import { Repo } from './repo'
import type { Moment, Uuid } from './types/core'
import type { Meta, TableName } from './types/tables'

type Obj = Record<string, unknown>

// A pretend older format: version 0, where applications had no `contact` field.
const toVersion0 = (table: TableName, record: Obj): Obj => {
  const old: Obj = { ...record, schemaVersion: 0 }
  if (table === 'applications' && old.purged === false) {
    delete old.contact
    const fieldMeta = { ...(old.fieldMeta as Obj) }
    delete fieldMeta.contact
    old.fieldMeta = fieldMeta
  }
  return old
}

// The upgrade from version 0: add `contact` as a default.
const addContact: Migrations = {
  0: (record, table, deviceId) =>
    table === 'applications' ? addField(record, 'contact', '', deviceId) : record,
}

/** A database with one application, rewritten into version 0. Returns its name and the app ID. */
async function oldDatabase(): Promise<{ name: string; appId: Uuid }> {
  const name = `test-${crypto.randomUUID()}`
  const repo = await Repo.open({ name, clock: () => at(14) })
  const app = await repo.create('applications', sampleApplication())
  repo.close()
  await rewrite(name, toVersion0, 0)
  return { name, appId: app.id }
}

/** Edits every stored record directly, below the repo, and sets the stored format version. */
async function rewrite(name: string, edit: (t: TableName, r: Obj) => Obj, version: number) {
  const db = await openDatabase(name)
  const tx = db.transaction([...TABLE_NAMES, META_STORE], 'readwrite')
  const done = transactionDone(tx)
  for (const table of TABLE_NAMES) {
    for (const record of (await request(tx.objectStore(table).getAll())) as Obj[]) {
      await request(tx.objectStore(table).put(edit(table, record)))
    }
  }
  const meta = (await request(tx.objectStore(META_STORE).get('meta'))) as Meta
  await request(tx.objectStore(META_STORE).put({ ...meta, schemaVersion: version }, 'meta'))
  await done
  db.close()
}

/** Reads one stored record and the stored format version, below the repo. */
async function peek(name: string, table: TableName, id: Uuid) {
  const db = await openDatabase(name)
  const tx = db.transaction([table, META_STORE], 'readonly')
  const record = (await request(tx.objectStore(table).get(id))) as Obj
  const meta = (await request(tx.objectStore(META_STORE).get('meta'))) as Meta
  const backups = await listBackups(db)
  db.close()
  return { record, version: meta.schemaVersion, backups }
}

describe('upgrading stored data', () => {
  it('backs up, then upgrades every record', async () => {
    const { name, appId } = await oldDatabase()
    const repo = await Repo.open({ name, clock: () => at(15), migrations: addContact })

    const app = await repo.get('applications', appId)
    expect(app).toMatchObject({ schemaVersion: 1, contact: '' })
    expect(app?.fieldMeta.contact.updatedAt).toBe(0) // a default, never beats a real edit

    const [backup] = await repo.listBackups()
    expect(backup).toMatchObject({ schemaVersion: 0, createdAt: at(15) })
    const saved = JSON.parse((await repo.getBackup(backup.id))!.json)
    expect(saved.schemaVersion).toBe(0)
    expect(saved.tables.applications[0]).not.toHaveProperty('contact') // the data as it was
    repo.close()
    expect((await peek(name, 'applications', appId)).version).toBe(1)
  })

  it('changes nothing if a step fails, and keeps the backup', async () => {
    const { name, appId } = await oldDatabase()
    const failing: Migrations = {
      0: () => {
        throw new Error('bug in migration')
      },
    }
    await expect(Repo.open({ name, migrations: failing })).rejects.toThrow('bug in migration')
    const after = await peek(name, 'applications', appId)
    expect(after.version).toBe(0)
    expect(after.record).toMatchObject({ schemaVersion: 0 })
    expect(after.backups).toHaveLength(1)
  })

  it('refuses an upgrade that produces invalid data', async () => {
    const { name, appId } = await oldDatabase()
    const forgetful: Migrations = { 0: (record) => record } // forgets to add `contact`
    await expect(Repo.open({ name, migrations: forgetful })).rejects.toThrow(/contact: missing/)
    expect((await peek(name, 'applications', appId)).version).toBe(0)
  })

  it('refuses data saved by a newer version of the app', async () => {
    const { name, appId } = await oldDatabase()
    await rewrite(name, (_t, r) => ({ ...r, schemaVersion: 2 }), 2)
    await expect(Repo.open({ name })).rejects.toBeInstanceOf(NewerDataError)
    expect((await peek(name, 'applications', appId)).record).toMatchObject({ schemaVersion: 2 })
  })

  it("an upgrade's default doesn't overwrite a value set on another device", async () => {
    const { name, appId } = await oldDatabase()
    const repo = await Repo.open({ name, clock: () => at(15), migrations: addContact })
    const upgraded = await repo.get('applications', appId)
    if (!upgraded || upgraded.purged) throw new Error('missing')
    // The phone upgraded earlier and the user filled in the new field at 10:00.
    const phone = editField(upgraded, 'contact', 'Sam Lee', PHONE, at(10))
    await repo.saveMerged('applications', phone)
    const merged = await repo.get('applications', appId)
    expect(merged && !merged.purged && merged.contact).toBe('Sam Lee')
    expect(await repo.list('conflictLog')).toEqual([])
  })
})

describe('importing older files', () => {
  async function version0Export() {
    const repo = await Repo.open({ name: `test-${crypto.randomUUID()}`, clock: () => at(14) })
    const app = await repo.create('applications', sampleApplication())
    const file = JSON.parse(exportToJson(await exportData(repo)))
    file.schemaVersion = 0
    for (const table of TABLE_NAMES) {
      file.tables[table] = file.tables[table].map((r: Obj) => toVersion0(table, r))
    }
    return { json: JSON.stringify(file), appId: app.id }
  }

  it('upgrades the file, then imports it', async () => {
    const { json, appId } = await version0Export()
    const repo = await Repo.open({ name: `test-${crypto.randomUUID()}` })
    const outcome = await importJson(repo, json, { migrations: addContact })
    expect(outcome).toMatchObject({ ok: true })
    expect(await repo.get('applications', appId)).toMatchObject({ schemaVersion: 1, contact: '' })
  })

  it('rejects an older file when there is no upgrade path', async () => {
    const { json } = await version0Export()
    const repo = await Repo.open({ name: `test-${crypto.randomUUID()}` })
    const outcome = await importJson(repo, json)
    expect(outcome).toEqual({
      ok: false,
      errors: [
        'file.schemaVersion: made by an older version of Guyot that this version cannot upgrade',
      ],
    })
  })
})

describe('backups', () => {
  it('keeps only the newest five', async () => {
    const db = await openDatabase(`test-${crypto.randomUUID()}`)
    for (let hour = 1; hour <= 7; hour++) {
      await createBackup(db, LAPTOP, 1, `backup ${hour}`, at(hour) as Moment)
    }
    const backups = await listBackups(db)
    expect(backups.map((b) => b.reason)).toEqual([
      'backup 7',
      'backup 6',
      'backup 5',
      'backup 4',
      'backup 3',
    ])
    db.close()
  })
})
