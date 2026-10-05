/**
 * Passphrase encryption for files that leave the browser: exports and downloaded
 * backups (docs/decisions/0016). Uses only the browser's Web Crypto API.
 *
 * - The key comes from the passphrase through PBKDF2-SHA-256 with a random salt per file.
 * - The data is encrypted with AES-GCM and a random IV per file. GCM also checks the
 *   data wasn't altered, so a wrong passphrase or a changed file fails instead of
 *   producing garbage.
 * - The file's header (salt, settings) is bound to the encrypted data as "additional
 *   data", so changing it also fails the check.
 *
 * A lost passphrase can't be recovered: nothing else can open the file.
 */

/** OWASP's current guidance for PBKDF2-SHA-256. Tests pass a smaller number for speed. */
export const PBKDF2_ITERATIONS = 600_000
/** Above this, a file is refused rather than freezing the page while deriving the key. */
const MAX_ITERATIONS = 10_000_000
export const MIN_PASSPHRASE_LENGTH = 10

export interface EncryptedFile {
  app: 'guyot'
  kind: 'encrypted'
  formatVersion: 1
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string } // salt in base64
  cipher: { name: 'AES-GCM'; iv: string } // iv in base64
  data: string // base64 of the encrypted bytes
}

/** The passphrase didn't open the file, or the file was changed. */
export class DecryptError extends Error {
  constructor() {
    super('That passphrase doesn’t open this file (or the file was changed).')
    this.name = 'DecryptError'
  }
}

// ---------- Bytes and base64 ----------

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The header, as the exact bytes bound to the encrypted data. */
function headerBytes(file: Omit<EncryptedFile, 'data'>): Uint8Array<ArrayBuffer> {
  const { app, kind, formatVersion, kdf, cipher } = file
  const header = JSON.stringify([
    app,
    kind,
    formatVersion,
    kdf.name,
    kdf.hash,
    kdf.iterations,
    kdf.salt,
    cipher.name,
    cipher.iv,
  ])
  return new TextEncoder().encode(header)
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---------- Encrypting and decrypting ----------

/** Encrypts text with a passphrase, with a fresh salt and IV every time. */
export async function encryptText(
  text: string,
  passphrase: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<EncryptedFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const header: Omit<EncryptedFile, 'data'> = {
    app: 'guyot',
    kind: 'encrypted',
    formatVersion: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
  }
  const key = await deriveKey(passphrase, salt, iterations)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: headerBytes(header) },
    key,
    new TextEncoder().encode(text),
  )
  return { ...header, data: toBase64(new Uint8Array(encrypted)) }
}

/** Decrypts a file made by encryptText. Throws DecryptError if it can't be opened. */
export async function decryptText(file: EncryptedFile, passphrase: string): Promise<string> {
  if (file.kdf.iterations > MAX_ITERATIONS) throw new DecryptError()
  try {
    const key = await deriveKey(passphrase, fromBase64(file.kdf.salt), file.kdf.iterations)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(file.cipher.iv), additionalData: headerBytes(file) },
      key,
      fromBase64(file.data),
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new DecryptError() // GCM's check failed: wrong passphrase, or changed data
  }
}

/** True for a parsed JSON value shaped like an encrypted Guyot file. */
export function isEncryptedFile(value: unknown): value is EncryptedFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const kdf = v.kdf as Record<string, unknown> | undefined
  const cipher = v.cipher as Record<string, unknown> | undefined
  return (
    v.app === 'guyot' &&
    v.kind === 'encrypted' &&
    v.formatVersion === 1 &&
    typeof v.data === 'string' &&
    kdf?.name === 'PBKDF2' &&
    kdf.hash === 'SHA-256' &&
    typeof kdf.iterations === 'number' &&
    Number.isInteger(kdf.iterations) &&
    kdf.iterations > 0 &&
    typeof kdf.salt === 'string' &&
    cipher?.name === 'AES-GCM' &&
    typeof cipher.iv === 'string'
  )
}

/** The encrypted file in some text, or null if the text isn't one. */
export function encryptedFileIn(text: string): EncryptedFile | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isEncryptedFile(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** What's wrong with a new passphrase and its confirmation, or null if it's fine. */
export function passphraseProblem(passphrase: string, confirmation: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters. A few unrelated words work well.`
  }
  if (passphrase !== confirmation) return 'The two passphrases don’t match.'
  return null
}
