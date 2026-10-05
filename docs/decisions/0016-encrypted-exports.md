# 0016. Exports and downloaded backups are encrypted by default

Status: Accepted (2026-10-04)

## Context

An export or a downloaded backup holds everything: applications, notes, contacts, eligibility notes, the change history, even deleted records. Once it's downloaded, it lives wherever files go: a Downloads folder, an email, a synced cloud folder, a shared computer. CLAUDE.md already requires data to be encrypted with the user's passphrase before it leaves the browser, for sync. Exports are the same situation.

Scenario: you download an export to move to a new laptop and leave it in your Downloads folder, which syncs to a cloud drive shared with family. A plain JSON file there can be read by anyone who opens it.

## Decision

- **Encrypted unless you deliberately choose otherwise.** Every download (Download a copy, and a backup's Download…) is encrypted with a passphrase you type twice, at least 10 characters.
- **How:**
  - **Key:** PBKDF2-SHA-256 with 600,000 iterations (OWASP's current guidance) and a random 16-byte salt per file derives a 256-bit key.
  - **Cipher:** AES-GCM with a random 12-byte IV per file encrypts the export JSON.
  - **Tamper check:** the file's header (format, salt, iterations, IV) is bound to the ciphertext as additional authenticated data, so a wrong passphrase, or any change to the data or header, fails the check and nothing is imported.
  - **Standard parts only:** everything uses the browser's Web Crypto API, with no library.
- **The file** is JSON: `{ "app": "guyot", "kind": "encrypted", "formatVersion": 1, "kdf": {…}, "cipher": {…}, "data": "<base64>" }`, named `…-encrypted.json`. Importing recognises it and asks for the passphrase; plain exports from before still import.
- **The passphrase** is never stored, never logged, and cleared from the page after use. Both screens say that a lost passphrase can't be recovered and the file can't be opened without it.
- **The unencrypted option** stays, for people who want to read or process their own file. It sits in a closed section titled "Download without encryption (strongly recommended against)", with a warning, and its button works only after ticking "I understand that anyone who gets this file can read all of it".
- **Safety limit on import:** an encrypted file asking for more than 10 million iterations is refused, so a crafted file can't freeze the page.

### Backups inside the browser stay unencrypted

Automatic backups live in the same IndexedDB as the live data, which isn't encrypted. Encrypting only the backups would protect nothing the live data next to them doesn't already give away. They're also made automatically, for example right before an upgrade when the app opens, when there's no passphrase to use. Doing this properly means encrypting all local data behind a passphrase asked for when the app opens (a "lock this device" feature). That's a separate decision, for later if wanted. Backups are encrypted when they're downloaded, like exports.

## Alternatives considered

- **Always encrypted, no plain option.** Safest, but users couldn't read or reuse their own data without Guyot, which goes against user choice. A strongly worded, deliberate opt-out keeps the choice while making encryption the path of least resistance.
- **Plain by default, encryption optional.** Most people take the default, and the default would be a readable file of their whole job search.
- **A crypto library, or a newer KDF (Argon2, scrypt).** Not built into browsers; would add a runtime dependency. PBKDF2 at OWASP's iteration count is the strongest built-in choice.

## Consequences

- Moving data needs the passphrase. A lost passphrase means a lost file; the UI says so plainly.
- Encrypting or opening a file takes a moment (deliberately slow key derivation).
- Sync (step 3) can reuse the same module for device files.

## In the code

[crypto.ts](../../src/data/crypto.ts); [SaveFileForm.tsx](../../src/data-page/SaveFileForm.tsx), [UnlockForm.tsx](../../src/data-page/UnlockForm.tsx), [BackupDownloadDialog.tsx](../../src/data-page/BackupDownloadDialog.tsx), [DataPage.tsx](../../src/pages/DataPage.tsx). Tests: [crypto.test.ts](../../src/data/crypto.test.ts), "imports an encrypted export" in [exportImport.test.ts](../../src/data/exportImport.test.ts), [DataPage.test.tsx](../../src/data-page/DataPage.test.tsx).
