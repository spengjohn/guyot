// Security tests for restoring a backup (docs/decisions/0015). Backups live in IndexedDB,
// where a buggy migration, another tab or a malicious extension could alter one. A bad
// backup must change nothing: no data, and no extra backup either.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUPS_STORE, openDatabase, request, transactionDone } from '../data/db'
import { at, sampleApplication } from '../data/fixtures'
import { Repo, ValidationError } from '../data/repo'
import type { Moment, Uuid } from '../data/types/core'
import { MARKUP_PAYLOADS, PROTOTYPE_KEYS, UNSAFE_LINKS } from './hostileInputs'

let time: Moment
let repo: Repo
let dbName: string

beforeEach(async () => {
  time = at(9)
  dbName = `security-${crypto.randomUUID()}`
  repo = await Repo.open({ name: dbName, clock: () => time })
})

afterEach(() => {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

/** An application, a backup of it, then a later edit. Returns the ids. */
async function scenario() {
  const app = await repo.create('applications', { ...sampleApplication(), notes: 'before' })
  time = at(10)
  const backup = await repo.createBackup('test')
  time = at(11)
  await repo.update('applications', app.id, { notes: 'after' })
  time = at(12)
  return { appId: app.id, backupId: backup.id }
}

/** The part of an export file these tests change. */
type Tamperable = { tables: { applications: (Record<string, unknown> & { custom: object })[] } }

/** Rewrites a stored backup's export file, the way a tampering script could. */
async function tamper(backupId: Uuid, edit: (file: Tamperable) => void) {
  const db = await openDatabase(dbName)
  const tx = db.transaction(BACKUPS_STORE, 'readwrite')
  const done = transactionDone(tx)
  const store = tx.objectStore(BACKUPS_STORE)
  const backup = (await request(store.get(backupId))) as { json: string }
  const file = JSON.parse(backup.json)
  edit(file)
  await request(store.put({ ...backup, json: JSON.stringify(file) }))
  await done
  db.close()
}

/** Adds an own `key` property, the way JSON.parse does for '"__proto__": ...'. */
function withOwnKey(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

async function expectRefusedAndUnchanged(appId: Uuid, backupId: Uuid) {
  const backups = (await repo.listBackups()).length
  await expect(repo.previewRestore(backupId)).rejects.toBeInstanceOf(ValidationError)
  await expect(repo.restoreBackup(backupId)).rejects.toBeInstanceOf(ValidationError)
  expect(await repo.get('applications', appId)).toMatchObject({ notes: 'after' })
  expect((await repo.listBackups()).length).toBe(backups) // no pre-restore backup either
}

describe('a tampered backup is refused and changes nothing', () => {
  it.each(PROTOTYPE_KEYS)('with a "%s" key on a record', async (key) => {
    const { appId, backupId } = await scenario()
    await tamper(backupId, (file) =>
      withOwnKey(file.tables.applications[0], key, { polluted: true }),
    )
    await expectRefusedAndUnchanged(appId, backupId)
  })

  it.each(PROTOTYPE_KEYS)('with a "%s" key in a custom field map', async (key) => {
    const { appId, backupId } = await scenario()
    await tamper(backupId, (file) => {
      withOwnKey(file.tables.applications[0].custom, key, { polluted: true })
    })
    await expectRefusedAndUnchanged(appId, backupId)
  })

  it.each(UNSAFE_LINKS)('with %j as a listing link', async (link) => {
    const { appId, backupId } = await scenario()
    await tamper(backupId, (file) => {
      file.tables.applications[0].listing = link
    })
    await expectRefusedAndUnchanged(appId, backupId)
  })

  it('with an unknown field on a record', async () => {
    const { appId, backupId } = await scenario()
    await tamper(backupId, (file) => {
      file.tables.applications[0].autoApply = true
    })
    await expectRefusedAndUnchanged(appId, backupId)
  })
})

describe('restoring hostile text', () => {
  it.each(MARKUP_PAYLOADS)('brings back %j exactly, as plain data', async (payload) => {
    const app = await repo.create('applications', { ...sampleApplication(), notes: payload })
    time = at(10)
    const backup = await repo.createBackup('test')
    time = at(11)
    await repo.update('applications', app.id, { notes: 'edited' })
    await repo.restoreBackup(backup.id)
    expect(await repo.get('applications', app.id)).toMatchObject({ notes: payload })
  })
})
