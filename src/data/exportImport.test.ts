import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, SHARED_TARGETS_ID } from './constants'
import {
  checkImport,
  exportData,
  exportFileName,
  exportToJson,
  importJson,
  mergeImport,
} from './exportImport'
import { at, sampleApplication, samplePosting } from './fixtures'
import { Repo } from './repo'
import type { Moment, Uuid } from './types/core'

/** A device with its own database and a clock the test controls. */
async function device() {
  const clock = { time: at(14) }
  const repo = await Repo.open({ name: `test-${crypto.randomUUID()}`, clock: () => clock.time })
  return { repo, clock }
}

async function exportJson(repo: Repo) {
  return exportToJson(await exportData(repo))
}

describe('export and import', () => {
  it('moves everything to a new device', async () => {
    const laptop = await device()
    const app = await laptop.repo.create('applications', sampleApplication())
    await laptop.repo.getSharedTargets()
    await laptop.repo.update('sharedTargets', SHARED_TARGETS_ID, { mustHaveKeywords: ['React'] })

    const phone = await device()
    const outcome = await importJson(phone.repo, await exportJson(laptop.repo))
    expect(outcome).toMatchObject({ ok: true, warnings: [] })
    expect(await phone.repo.get('applications', app.id)).toEqual(app)
    expect((await phone.repo.getSharedTargets()).mustHaveKeywords).toEqual(['React'])
  })

  it('importing the same file twice changes nothing the second time', async () => {
    const laptop = await device()
    await laptop.repo.create('applications', sampleApplication())
    const json = await exportJson(laptop.repo)
    const phone = await device()
    await importJson(phone.repo, json)
    const again = await importJson(phone.repo, json)
    expect(again).toMatchObject({ ok: true, summary: { changed: 0, conflicts: 0 } })
  })

  it('names files by local date', () => {
    expect(exportFileName(new Date(2026, 9, 3, 23, 30).getTime() as Moment)).toBe(
      'guyot-export-2026-10-03.json',
    )
  })
})

describe('checkImport', () => {
  it('shows what a file holds without changing anything', async () => {
    const { repo: laptop } = await device()
    await laptop.create('applications', sampleApplication())
    const gone = await laptop.create('applications', {
      ...sampleApplication(),
      roleId: 'R002' as never,
    })
    await laptop.delete('applications', gone.id)
    const json = await exportJson(laptop)

    const { repo: phone } = await device()
    const check = await checkImport(phone, json)
    if (!check.ok) throw new Error(check.errors[0])
    expect(check.preview).toEqual({
      deviceId: laptop.deviceId,
      exportedAt: expect.any(Number),
      schemaVersion: SCHEMA_VERSION,
      counts: { applications: 1 }, // deleted records and logs aren't counted
    })
    expect(await phone.list('applications')).toEqual([]) // nothing merged yet

    expect(await mergeImport(phone, check.file)).toMatchObject({ ok: true })
    expect(await phone.list('applications')).toHaveLength(1)
  })

  it('reports problems the same way importJson does', async () => {
    const { repo } = await device()
    expect(await checkImport(repo, '{not json')).toEqual({
      ok: false,
      errors: ['File: not valid JSON'],
    })
  })
})

describe('rejected imports change nothing', () => {
  it('rejects text that is not JSON', async () => {
    const { repo } = await device()
    expect(await importJson(repo, 'not json')).toEqual({
      ok: false,
      errors: ['File: not valid JSON'],
    })
  })

  it('rejects the whole file when one record is invalid', async () => {
    const laptop = await device()
    await laptop.repo.create('applications', sampleApplication())
    await laptop.repo.create('postings', samplePosting())
    const file = JSON.parse(await exportJson(laptop.repo))
    file.tables.postings[0].company = 42

    const phone = await device()
    const outcome = await importJson(phone.repo, JSON.stringify(file))
    expect(outcome.ok).toBe(false)
    expect(await phone.repo.list('applications')).toEqual([])
  })

  it('rolls back records already merged when a later one fails', async () => {
    const laptop = await device()
    const app = await laptop.repo.create('applications', sampleApplication())
    // A deleted shared-targets record passes the record checks but is refused by the merge.
    const targets = structuredClone(await laptop.repo.getSharedTargets())
    targets.deleted = true
    targets.fieldMeta.deleted = { updatedAt: at(15), deviceId: laptop.repo.deviceId, base: null }
    targets.updatedAt = at(15)

    const phone = await device()
    const merge = phone.repo.saveMergedMany([
      { table: 'applications', record: app }, // written first...
      { table: 'sharedTargets', record: targets }, // ...then this fails
    ])
    await expect(merge).rejects.toThrow(/cannot be deleted/)
    expect(await phone.repo.list('applications')).toEqual([])
    expect(await phone.repo.list('changeLog')).toEqual([])
  })
})

describe('Role ID collisions', () => {
  it('renumbers a colliding posting together with its application', async () => {
    const laptop = await device()
    const phone = await device()
    const laptopPosting = await laptop.repo.create('postings', samplePosting()) // R001
    const phonePosting = await phone.repo.create('postings', samplePosting()) // also R001
    const phoneApp = await phone.repo.create('applications', {
      ...sampleApplication(),
      postingId: phonePosting.id,
    })

    const outcome = await importJson(laptop.repo, await exportJson(phone.repo))
    expect(outcome).toMatchObject({ ok: true, summary: { renumbered: 1 } })

    // Tombstones have no data, so check `purged` before reading roleId.
    const roleIdOf = async (table: 'postings' | 'applications', id: Uuid) => {
      const record = await laptop.repo.get(table, id)
      return record && !record.purged ? record.roleId : undefined
    }
    const keeper = laptopPosting.id < phonePosting.id ? laptopPosting.id : phonePosting.id
    const mover = keeper === laptopPosting.id ? phonePosting.id : laptopPosting.id
    expect(await roleIdOf('postings', keeper)).toBe('R001')
    expect(await roleIdOf('postings', mover)).toBe('R002')
    // The application always moves with its posting.
    expect(await roleIdOf('applications', phoneApp.id)).toBe(
      await roleIdOf('postings', phonePosting.id),
    )
    expect(await laptop.repo.nextRoleId()).toBe('R003')
    const renumbers = (await laptop.repo.list('changeLog')).filter((l) => l.action === 'renumber')
    expect(renumbers.length).toBeGreaterThan(0)
  })
})

describe('purged data stays gone', () => {
  it("an old log entry from another device doesn't bring purged data back", async () => {
    const phone = await device()
    const app = await phone.repo.create('applications', sampleApplication())
    phone.clock.time = at(15)
    await phone.repo.update('applications', app.id, { notes: 'secret note' })

    const laptop = await device()
    laptop.clock.time = at(16)
    await importJson(laptop.repo, await exportJson(phone.repo))
    await laptop.repo.delete('applications', app.id)
    await laptop.repo.purge('applications', app.id)

    // Meanwhile the phone edits the note again: a log entry the laptop has never seen,
    // whose old value is 'secret note'.
    phone.clock.time = at(17)
    await phone.repo.update('applications', app.id, { notes: 'newer note' })
    const phoneExport = await exportJson(phone.repo)
    expect(phoneExport).toContain('secret note')

    laptop.clock.time = at(18)
    await importJson(laptop.repo, phoneExport)
    expect(await laptop.repo.get('applications', app.id)).toMatchObject({ purged: true })
    const laptopExport = await exportJson(laptop.repo)
    expect(laptopExport).not.toContain('secret note')
    expect(laptopExport).not.toContain('edited') // old value in the entry the laptop never saw
    expect(laptopExport).not.toContain('newer note')
  })

  it('a purge on one device is applied on the other', async () => {
    const phone = await device()
    const app = await phone.repo.create('applications', sampleApplication())
    phone.clock.time = at(15)
    await phone.repo.update('applications', app.id, { notes: 'secret note' })
    phone.clock.time = at(15, 30)
    await phone.repo.update('applications', app.id, { notes: 'edited' }) // log keeps 'secret note'

    const laptop = await device()
    laptop.clock.time = at(16)
    await importJson(laptop.repo, await exportJson(phone.repo))
    await laptop.repo.delete('applications', app.id)
    await laptop.repo.purge('applications', app.id)

    phone.clock.time = at(17)
    await importJson(phone.repo, await exportJson(laptop.repo))
    expect(await phone.repo.get('applications', app.id)).toMatchObject({ purged: true })
    expect(await exportJson(phone.repo)).not.toContain('secret note')
  })
})
