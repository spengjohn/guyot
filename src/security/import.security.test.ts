// Security tests for JSON import: a file from anywhere must not be able to run code,
// pollute objects, sneak in unsafe links, or freeze the page. See docs/security.md.
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { LIMITS } from '../data/constants'
import { exportData, exportToJson, importJson, MAX_IMPORT_CHARS } from '../data/exportImport'
import { at, sampleApplication, samplePosting } from '../data/fixtures'
import { Repo } from '../data/repo'
import { HIDDEN_TEXT, MARKUP_PAYLOADS, PROTOTYPE_KEYS, UNSAFE_LINKS } from './hostileInputs'

async function device() {
  return Repo.open({ name: `security-${crypto.randomUUID()}`, clock: () => at(14) })
}

/** An export file (parsed) with one application and one posting, ready to tamper with. */
async function sampleFile() {
  const repo = await device()
  await repo.create('applications', sampleApplication())
  await repo.create('postings', samplePosting())
  return JSON.parse(exportToJson(await exportData(repo)))
}

/** Imports `json` into a fresh device and returns the outcome and the device. */
async function importInto(json: string) {
  const repo = await device()
  const outcome = await importJson(repo, json)
  return { repo, outcome }
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

afterEach(() => {
  // Nothing in these tests should ever reach the global prototype.
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined()
})

describe('prototype pollution', () => {
  it.each(PROTOTYPE_KEYS)('rejects a file with a "%s" key on a record', async (key) => {
    const file = await sampleFile()
    withOwnKey(file.tables.applications[0], key, { polluted: true })
    const { repo, outcome } = await importInto(JSON.stringify(file))
    expect(outcome.ok).toBe(false)
    expect(await repo.list('applications')).toEqual([])
  })

  it.each(PROTOTYPE_KEYS)('rejects a "%s" key inside a custom field map', async (key) => {
    const file = await sampleFile()
    withOwnKey(file.tables.applications[0].custom, key, { polluted: true })
    withOwnKey(file.tables.applications[0].fieldMeta, `custom.${key}`, {
      updatedAt: at(14),
      deviceId: file.deviceId,
      base: null,
    })
    expect((await importInto(JSON.stringify(file))).outcome.ok).toBe(false)
  })

  it.each(PROTOTYPE_KEYS)('rejects a "%s" key in fieldMeta', async (key) => {
    const file = await sampleFile()
    withOwnKey(file.tables.postings[0].fieldMeta, key, { polluted: true })
    expect((await importInto(JSON.stringify(file))).outcome.ok).toBe(false)
  })

  it('rejects a "__proto__" key in the file header and tables', async () => {
    const file = await sampleFile()
    withOwnKey(file, '__proto__', { polluted: true })
    expect((await importInto(JSON.stringify(file))).outcome.ok).toBe(false)

    const other = await sampleFile()
    withOwnKey(other.tables, '__proto__', [{ polluted: true }])
    expect((await importInto(JSON.stringify(other))).outcome.ok).toBe(false)
  })
})

describe('unsafe links', () => {
  it.each(UNSAFE_LINKS)('rejects %j as a listing link', async (link) => {
    const file = await sampleFile()
    file.tables.applications[0].listing = link
    const { repo, outcome } = await importInto(JSON.stringify(file))
    expect(outcome.ok).toBe(false)
    expect(await repo.list('applications')).toEqual([])
  })

  it.each(UNSAFE_LINKS)('rejects %j as a posting link', async (link) => {
    const file = await sampleFile()
    file.tables.postings[0].url = link
    expect((await importInto(JSON.stringify(file))).outcome.ok).toBe(false)
  })
})

describe('hostile text is kept as plain data', () => {
  // The data layer stores text exactly as given; the UI must render it as text.
  // Changing it here would hide what the user pasted. Rendering is guarded by lint rules.
  it.each([...MARKUP_PAYLOADS, ...HIDDEN_TEXT])('stores %j unchanged', async (payload) => {
    const file = await sampleFile()
    file.tables.postings[0].text = payload
    file.tables.applications[0].notes = payload
    const { repo, outcome } = await importInto(JSON.stringify(file))
    expect(outcome.ok).toBe(true)
    const [posting] = await repo.list('postings')
    const [application] = await repo.list('applications')
    expect(posting.text).toBe(payload)
    expect(application.notes).toBe(payload)
  })
})

describe('files built to freeze the page', () => {
  it('refuses a file over the size limit before parsing it', async () => {
    const huge = '"' + 'x'.repeat(MAX_IMPORT_CHARS) + '"'
    expect((await importInto(huge)).outcome).toEqual({
      ok: false,
      errors: ['File: too large to import'],
    })
  })

  it('rejects deeply nested JSON without throwing', async () => {
    const depth = 200_000
    const nested = '['.repeat(depth) + ']'.repeat(depth)
    expect((await importInto(nested)).outcome.ok).toBe(false)
  })

  it('rejects text longer than the field limit', async () => {
    const file = await sampleFile()
    file.tables.postings[0].text = 'x'.repeat(LIMITS.postingText + 1)
    expect((await importInto(JSON.stringify(file))).outcome.ok).toBe(false)
  })

  it('caps the number of reported errors', async () => {
    const file = await sampleFile()
    const bad = { ...file.tables.postings[0], company: 42 }
    file.tables.postings = Array.from({ length: 5_000 }, () => ({
      ...bad,
      id: crypto.randomUUID(),
    }))
    const { outcome } = await importInto(JSON.stringify(file))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.errors.length).toBeLessThanOrEqual(LIMITS.reportedIssues)
  })

  it('rejects a file that is not a Guyot export', async () => {
    const file = await sampleFile()
    file.app = 'something-else'
    expect((await importInto(JSON.stringify(file))).outcome.ok).toBe(false)
  })
})
