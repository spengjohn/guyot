import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup, listBackups } from './backup'
import { SCHEMA_VERSION, SHARED_TARGETS_ID, TABLE_NAMES } from './constants'
import { META_STORE, openDatabase, request, SETTINGS_STORE, transactionDone } from './db'
import { exportData, exportToJson, importJson } from './exportImport'
import {
  LAPTOP,
  PHONE,
  at,
  editField,
  emptySharedTargets,
  makeRecord,
  sampleApplication,
  sampleGoal,
  samplePosting,
  sampleProfile,
  tombstone,
} from './fixtures'
import { addField, migrateRecord, MIGRATIONS, NewerDataError, type Migrations } from './migrate'
import { Repo } from './repo'
import { defaultStamp, stampEdit } from './stamp'
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

// The upgrade from version 0: add `contact` as a default. The real steps follow it.
const addContact: Migrations = {
  ...MIGRATIONS,
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
    expect(app).toMatchObject({ schemaVersion: SCHEMA_VERSION, contact: '' })
    expect(app?.fieldMeta.contact.updatedAt).toBe(0) // a default, never beats a real edit

    const [backup] = await repo.listBackups()
    expect(backup).toMatchObject({ schemaVersion: 0, createdAt: at(15) })
    const saved = JSON.parse((await repo.getBackup(backup.id))!.json)
    expect(saved.schemaVersion).toBe(0)
    expect(saved.tables.applications[0]).not.toHaveProperty('contact') // the data as it was
    repo.close()
    expect((await peek(name, 'applications', appId)).version).toBe(SCHEMA_VERSION)
  })

  it('changes nothing if a step fails, and keeps the backup', async () => {
    const { name, appId } = await oldDatabase()
    const failing: Migrations = {
      ...MIGRATIONS,
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
    const forgetful: Migrations = { ...MIGRATIONS, 0: (record) => record } // forgets `contact`
    await expect(Repo.open({ name, migrations: forgetful })).rejects.toThrow(/contact: missing/)
    expect((await peek(name, 'applications', appId)).version).toBe(0)
  })

  it('refuses data saved by a newer version of the app', async () => {
    const { name, appId } = await oldDatabase()
    const newer = SCHEMA_VERSION + 1
    await rewrite(name, (_t, r) => ({ ...r, schemaVersion: newer }), newer)
    await expect(Repo.open({ name })).rejects.toBeInstanceOf(NewerDataError)
    expect((await peek(name, 'applications', appId)).record).toMatchObject({ schemaVersion: newer })
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

// ---------- The real upgrade: version 1 to 2 ----------

/** The stores as database version 1 created them. Frozen: never edit to match newer code. */
const VERSION_1_TABLES = [
  'searchProfiles',
  'sharedTargets',
  'postings',
  'stageRows',
  'applications',
  'resumeVersions',
  'jdSnapshots',
  'fieldDefinitions',
  'pipelineDefinitions',
  'stageInstructions',
  'conflictLog',
  'changeLog',
]
const VERSION_1_ROLE_ID_TABLES = [
  'postings',
  'stageRows',
  'applications',
  'jdSnapshots',
  'resumeVersions',
]

const IDS = {
  profile: '11111111-1111-4111-8111-111111111111' as Uuid,
  application: '22222222-2222-4222-8222-222222222222' as Uuid,
  field: '33333333-3333-4333-8333-333333333333' as Uuid,
  posting: '44444444-4444-4444-8444-444444444444' as Uuid,
  change: '55555555-5555-4555-8555-555555555555' as Uuid,
}
const stamp = stampEdit(undefined, LAPTOP, at(9))
const v1 = (record: object): Obj => ({ ...record, schemaVersion: 1 })

/** A profile as version 1 stored it: list overrides were plain lists, no customOverrides. */
function version1Profile(): Obj {
  const data: Obj = { ...sampleProfile() }
  delete data.customOverrides
  data.overrides = { roleTypes: ['UX designer'], excludeRule: 'No agencies' }
  return v1(makeRecord(IDS.profile, data, stamp))
}

/**
 * An application as version 1 stored it, with a Deadline. The deadline was its most
 * recent edit, so removing it on upgrade also changes the record's newest stamp.
 */
function version1Application(): Obj {
  const app = makeRecord(IDS.application, sampleApplication(), stamp)
  app.custom[IDS.field] = true
  app.fieldMeta[`custom.${IDS.field}`] = stamp
  const record = v1(app)
  const deadlineStamp = stampEdit(undefined, PHONE, at(11))
  record.deadline = { kind: 'day', day: '2026-10-15' }
  record.fieldMeta = { ...(record.fieldMeta as Obj), deadline: deadlineStamp }
  record.updatedAt = deadlineStamp.updatedAt
  record.deviceId = deadlineStamp.deviceId
  return record
}

/** The same application after the upgrade: no deadline, and its newest stamp is the next one. */
function upgradedApplication(): Obj {
  const record: Obj = { ...version1Application(), schemaVersion: 2 }
  delete record.deadline
  const fieldMeta = { ...(record.fieldMeta as Obj) }
  delete fieldMeta.deadline
  return { ...record, fieldMeta, updatedAt: stamp.updatedAt, deviceId: stamp.deviceId }
}

/** One record of every kind version 1 could hold, in version 1 format. */
function version1Records(): { table: TableName; record: Obj }[] {
  return [
    { table: 'searchProfiles', record: version1Profile() },
    {
      table: 'sharedTargets',
      record: v1(makeRecord(SHARED_TARGETS_ID, emptySharedTargets(), defaultStamp(LAPTOP))),
    },
    {
      table: 'fieldDefinitions',
      record: v1(
        makeRecord(
          IDS.field,
          { scope: { table: 'applications' }, label: 'Referral', type: 'yesNo' },
          stamp,
        ),
      ),
    },
    { table: 'applications', record: version1Application() },
    { table: 'postings', record: v1(tombstone(IDS.posting, stamp)) },
    {
      table: 'changeLog',
      record: v1(
        makeRecord(
          IDS.change,
          {
            table: 'applications',
            recordId: IDS.application,
            action: 'create',
            fieldKeys: ['company'],
            stamps: { company: stamp },
            before: {},
            appliedBy: 'user',
            stageId: null,
          },
          stamp,
        ),
      ),
    },
  ]
}

const VERSION_1_META: Meta = {
  deviceId: LAPTOP,
  schemaVersion: 1,
  nextRoleNumber: 8,
  lastBackupAt: null,
}
const SETTINGS = { columnLayouts: [] }

/** Builds a database exactly as version 1 of the app left it, without using today's code. */
async function version1Database(): Promise<string> {
  const name = `test-${crypto.randomUUID()}`
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      for (const table of VERSION_1_TABLES) {
        const store = req.result.createObjectStore(table, { keyPath: 'id' })
        if (VERSION_1_ROLE_ID_TABLES.includes(table)) store.createIndex('roleId', 'roleId')
        if (table === 'conflictLog' || table === 'changeLog') {
          store.createIndex('recordId', 'recordId')
        }
      }
      req.result.createObjectStore('meta')
      req.result.createObjectStore('settings')
      req.result.createObjectStore('backups', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const tx = db.transaction([...VERSION_1_TABLES, 'meta', 'settings'], 'readwrite')
  const done = transactionDone(tx)
  for (const { table, record } of version1Records()) {
    await request(tx.objectStore(table).put(record))
  }
  await request(tx.objectStore('meta').put(VERSION_1_META, 'meta'))
  await request(tx.objectStore('settings').put(SETTINGS, 'local'))
  await done
  db.close()
  return name
}

describe('upgrading a version 1 database', () => {
  it('adds the goals store and keeps every record, the device ID and settings', async () => {
    const name = await version1Database()
    const repo = await Repo.open({ name, clock: () => at(15) })
    expect(repo.deviceId).toBe(LAPTOP)

    for (const { table, record } of version1Records()) {
      const stored = await repo.get(table, record.id as Uuid)
      if (table === 'searchProfiles') continue // checked below
      if (table === 'applications') {
        expect(stored).toEqual(upgradedApplication()) // deadline gone, everything else kept
        continue
      }
      expect(stored).toEqual({ ...record, schemaVersion: 2 })
    }
    expect(await repo.nextRoleId()).toBe('R008') // the counter survived

    // The new store works.
    const goal = await repo.create('goals', sampleGoal())
    expect(await repo.list('goals')).toEqual([goal])
    repo.close()

    const db = await openDatabase(name)
    const tx = db.transaction([META_STORE, SETTINGS_STORE], 'readonly')
    expect(await request(tx.objectStore(SETTINGS_STORE).get('local'))).toEqual(SETTINGS)
    expect(await request(tx.objectStore(META_STORE).get('meta'))).toMatchObject({
      deviceId: LAPTOP,
      schemaVersion: 2,
      lastBackupAt: at(15),
    })
    db.close()
  })

  it('turns list overrides into Replace overrides, keeping their stamps', async () => {
    const name = await version1Database()
    const repo = await Repo.open({ name, clock: () => at(15) })
    const before = version1Profile()
    const after = await repo.get('searchProfiles', IDS.profile)
    expect(after).toEqual({
      ...before,
      schemaVersion: 2,
      overrides: {
        roleTypes: { mode: 'replace', items: ['UX designer'] }, // version 1 meant "profile wins"
        excludeRule: 'No agencies', // not a list: unchanged
      },
      customOverrides: {},
      fieldMeta: before.fieldMeta, // same edits, stored a new way: stamps unchanged
    })
  })

  it("merges another device's upgrade of the same record without conflicts", async () => {
    const name = await version1Database()
    const repo = await Repo.open({ name, clock: () => at(15) })
    const phoneCopy = migrateRecord(version1Profile(), 'searchProfiles', PHONE)
    const outcome = await repo.saveMerged('searchProfiles', phoneCopy)
    expect(outcome).toMatchObject({ changed: false, conflicts: 0 })
    expect(await repo.list('conflictLog')).toEqual([])
  })

  it('backs up the version 1 data first', async () => {
    const name = await version1Database()
    const repo = await Repo.open({ name, clock: () => at(15) })
    const [backup] = await repo.listBackups()
    expect(backup).toMatchObject({ schemaVersion: 1, createdAt: at(15) })
    const saved = JSON.parse((await repo.getBackup(backup.id))!.json)
    expect(saved.tables.searchProfiles).toEqual([version1Profile()])
    expect(saved.tables.applications).toEqual([version1Application()]) // deadline kept here
  })
})

describe('importing older files', () => {
  async function version0Export() {
    const repo = await Repo.open({ name: `test-${crypto.randomUUID()}`, clock: () => at(14) })
    const app = await repo.create('applications', sampleApplication())
    const file = JSON.parse(exportToJson(await exportData(repo)))
    file.schemaVersion = 0
    delete file.tables.goals // version 0 had no goals table
    for (const table of TABLE_NAMES) {
      if (!file.tables[table]) continue
      file.tables[table] = file.tables[table].map((r: Obj) => toVersion0(table, r))
    }
    return { json: JSON.stringify(file), appId: app.id }
  }

  it('upgrades the file, then imports it', async () => {
    const { json, appId } = await version0Export()
    const repo = await Repo.open({ name: `test-${crypto.randomUUID()}` })
    const outcome = await importJson(repo, json, { migrations: addContact })
    expect(outcome).toMatchObject({ ok: true })
    expect(await repo.get('applications', appId)).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      contact: '',
    })
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

  it('imports a version 1 file, which has no goals table', async () => {
    const tables: Record<string, Obj[]> = {}
    for (const table of VERSION_1_TABLES) tables[table] = []
    for (const { table, record } of version1Records()) tables[table].push(record)
    tables.postings.push(v1(makeRecord(crypto.randomUUID() as Uuid, samplePosting(), stamp)))
    const file = {
      app: 'guyot',
      formatVersion: 1,
      exportedAt: at(12),
      deviceId: PHONE,
      schemaVersion: 1,
      tables,
    }
    const repo = await Repo.open({ name: `test-${crypto.randomUUID()}`, clock: () => at(15) })
    const outcome = await importJson(repo, JSON.stringify(file))
    expect(outcome).toMatchObject({ ok: true })
    const profile = await repo.get('searchProfiles', IDS.profile)
    expect(profile).toMatchObject({
      schemaVersion: 2,
      overrides: { roleTypes: { mode: 'replace', items: ['UX designer'] } },
      customOverrides: {},
    })
  })

  it('still rejects a current file that is missing a table', async () => {
    const repo = await Repo.open({ name: `test-${crypto.randomUUID()}` })
    const file = JSON.parse(exportToJson(await exportData(repo)))
    delete file.tables.goals
    expect(await importJson(repo, JSON.stringify(file))).toEqual({
      ok: false,
      errors: ['file.tables.goals: missing'],
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
