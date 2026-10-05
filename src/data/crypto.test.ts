import { describe, expect, it } from 'vitest'
import {
  DecryptError,
  decryptText,
  encryptedFileIn,
  encryptText,
  passphraseProblem,
  type EncryptedFile,
} from './crypto'

const FAST = 1_000 // iterations: real files use 600,000, which is slow on purpose
const secret = 'correct horse battery staple'

describe('encryptText and decryptText', () => {
  it('round-trips text with the right passphrase', async () => {
    const file = await encryptText('{"hello":"wörld"}', secret, FAST)
    expect(file).toMatchObject({ app: 'guyot', kind: 'encrypted', kdf: { iterations: FAST } })
    expect(file.data).not.toContain('hello') // nothing readable is left in the file
    expect(await decryptText(file, secret)).toBe('{"hello":"wörld"}')
  })

  it('refuses a wrong passphrase', async () => {
    const file = await encryptText('data', secret, FAST)
    await expect(decryptText(file, 'wrong passphrase!')).rejects.toBeInstanceOf(DecryptError)
  })

  it('refuses a file whose data or header was changed', async () => {
    const file = await encryptText('data', secret, FAST)
    const flipped = file.data.startsWith('A') ? `B${file.data.slice(1)}` : `A${file.data.slice(1)}`
    await expect(decryptText({ ...file, data: flipped }, secret)).rejects.toBeInstanceOf(
      DecryptError,
    )
    // The salt, IV and settings are bound to the data, so editing them fails too.
    const otherIv = (await encryptText('x', secret, FAST)).cipher.iv
    const tampered: EncryptedFile = { ...file, cipher: { ...file.cipher, iv: otherIv } }
    await expect(decryptText(tampered, secret)).rejects.toBeInstanceOf(DecryptError)
  })

  it('uses a fresh salt and IV every time', async () => {
    const a = await encryptText('same', secret, FAST)
    const b = await encryptText('same', secret, FAST)
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.cipher.iv).not.toBe(b.cipher.iv)
    expect(a.data).not.toBe(b.data)
  })

  it('refuses a file asking for an absurd amount of work', async () => {
    const file = await encryptText('data', secret, FAST)
    const heavy = { ...file, kdf: { ...file.kdf, iterations: 1e9 } }
    await expect(decryptText(heavy, secret)).rejects.toBeInstanceOf(DecryptError)
  })
})

describe('recognizing encrypted files', () => {
  it('finds an encrypted file in text, and nothing in other text', async () => {
    const file = await encryptText('data', secret, FAST)
    expect(encryptedFileIn(JSON.stringify(file))).toEqual(file)
    expect(encryptedFileIn('{"app":"guyot","formatVersion":1}')).toBeNull()
    expect(encryptedFileIn('not json')).toBeNull()
  })
})

describe('passphraseProblem', () => {
  it('asks for length and a matching confirmation', () => {
    expect(passphraseProblem('short', 'short')).toMatch(/at least 10/)
    expect(passphraseProblem('long enough phrase', 'long enough phrasE')).toMatch(/don’t match/)
    expect(passphraseProblem('long enough phrase', 'long enough phrase')).toBeNull()
  })
})
