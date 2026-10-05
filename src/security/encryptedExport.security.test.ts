// Security tests for encrypted exports (docs/decisions/0016), beyond crypto.test.ts:
// every part of the header is tamper-checked, the settings can't quietly get weaker,
// and a decrypted file still goes through the same validation as a plain import.
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DecryptError,
  decryptText,
  encryptText,
  MIN_PASSPHRASE_LENGTH,
  passphraseProblem,
  PBKDF2_ITERATIONS,
  type EncryptedFile,
} from '../data/crypto'
import { checkImport, exportData, exportToJson } from '../data/exportImport'
import { at, sampleApplication } from '../data/fixtures'
import { Repo } from '../data/repo'
import { MARKUP_PAYLOADS } from './hostileInputs'

const FAST = 1_000 // iterations: real files use PBKDF2_ITERATIONS, which is slow on purpose
const secret = 'correct horse battery staple'

async function device() {
  return Repo.open({ name: `security-${crypto.randomUUID()}`, clock: () => at(14) })
}

/** Changes one base64 character, keeping the text valid base64. */
function flip(base64: string): string {
  const i = Math.floor(base64.length / 2)
  return base64.slice(0, i) + (base64[i] === 'A' ? 'B' : 'A') + base64.slice(i + 1)
}

afterEach(() => {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

describe('settings that must not get weaker', () => {
  it('derives keys with at least the iterations in ADR 0016', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000)
  })

  it('asks for a passphrase of at least 10 characters', () => {
    expect(MIN_PASSPHRASE_LENGTH).toBeGreaterThanOrEqual(10)
    expect(passphraseProblem('123456789', '123456789')).not.toBeNull()
  })

  it('uses the full iteration count when none is given', async () => {
    // Slow by design (about a second). Proves the app's call path isn't using a test value.
    const file = await encryptText('data', secret)
    expect(file.kdf.iterations).toBe(PBKDF2_ITERATIONS)
  }, 30_000)
})

describe('every part of the file is tamper-checked', () => {
  const edits: [string, (file: EncryptedFile) => EncryptedFile][] = [
    ['one byte of the data', (f) => ({ ...f, data: flip(f.data) })],
    ['the salt', (f) => ({ ...f, kdf: { ...f.kdf, salt: flip(f.kdf.salt) } })],
    ['the IV', (f) => ({ ...f, cipher: { ...f.cipher, iv: flip(f.cipher.iv) } })],
    ['the iteration count', (f) => ({ ...f, kdf: { ...f.kdf, iterations: f.kdf.iterations + 1 } })],
    ['truncated data', (f) => ({ ...f, data: f.data.slice(0, -8) })],
  ]
  it.each(edits)('refuses a file with a changed %s', async (_, edit) => {
    const file = await encryptText('{"app":"guyot"}', secret, FAST)
    await expect(decryptText(edit(file), secret)).rejects.toBeInstanceOf(DecryptError)
  })

  it('refuses an empty passphrase', async () => {
    const file = await encryptText('data', secret, FAST)
    await expect(decryptText(file, '')).rejects.toBeInstanceOf(DecryptError)
  })
})

describe('what the encrypted file reveals', () => {
  it('contains none of the exported text', async () => {
    const repo = await device()
    await repo.create('applications', {
      ...sampleApplication(),
      company: 'Distinctive Company Name',
      notes: MARKUP_PAYLOADS[0],
    })
    const sealed = JSON.stringify(
      await encryptText(exportToJson(await exportData(repo)), secret, FAST),
    )
    expect(sealed).not.toContain('Distinctive Company Name')
    expect(sealed).not.toContain('<script>')
    expect(sealed).not.toContain('applications')
  })
})

describe('a decrypted file is validated like any import', () => {
  it('refuses a correctly encrypted file with a "__proto__" key', async () => {
    const laptop = await device()
    await laptop.create('applications', sampleApplication())
    const file = JSON.parse(exportToJson(await exportData(laptop)))
    Object.defineProperty(file.tables.applications[0], '__proto__', {
      value: { polluted: true },
      enumerable: true,
    })
    // Someone who knows the passphrase can encrypt anything; encryption isn't validation.
    const sealed = await encryptText(JSON.stringify(file), secret, FAST)

    const phone = await device()
    const check = await checkImport(phone, await decryptText(sealed, secret))
    expect(check.ok).toBe(false)
    expect(await phone.list('applications')).toEqual([])
  })
})
