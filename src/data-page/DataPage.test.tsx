// @vitest-environment jsdom
import '../test/dom'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptText, encryptedFileIn, encryptText } from '../data/crypto'
import { exportData, exportToJson } from '../data/exportImport'
import { sampleApplication } from '../data/fixtures'
import { Repo } from '../data/repo'
import { announced, renderApp } from '../test/app'

// jsdom can't really download files: capture what would be downloaded instead.
let downloads: { name: string; blob: Blob }[]
beforeEach(() => {
  downloads = []
  let blob: Blob | undefined
  URL.createObjectURL = vi.fn((b: Blob) => {
    blob = b
    return 'blob:test'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, blob: blob! })
  })
})
afterEach(() => vi.restoreAllMocks())

/** Reads a Blob's text (jsdom's Blob may lack .text()). */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsText(blob)
  })
}

async function openData(dbName?: string) {
  const app = await renderApp('#/data', dbName)
  await screen.findByRole('heading', { level: 1, name: 'Your data' })
  return app
}

/** An export file from another device, holding one application. */
async function exportFromAnotherDevice(): Promise<string> {
  const other = await Repo.open({ name: `test-${crypto.randomUUID()}` })
  await other.create('applications', sampleApplication())
  const json = exportToJson(await exportData(other))
  other.close()
  return json
}

async function upload(user: UserEvent, text: string, name = 'export.json') {
  const file = new File([text], name, { type: 'application/json' })
  if (!file.text) Object.defineProperty(file, 'text', { value: () => blobText(file) })
  await user.upload(screen.getByLabelText('Choose an export file'), file)
}

const PASSPHRASE = 'plum orchard window seven'
const exportPanel = () => within(screen.getByRole('region', { name: 'Download a copy' }))

describe('download a copy', () => {
  it('downloads an encrypted export, once the passphrase is typed twice', async () => {
    const { user } = await openData()
    const panel = exportPanel()
    await user.type(panel.getByLabelText('Passphrase'), PASSPHRASE)
    await user.type(panel.getByLabelText('Passphrase again'), 'something else entirely')
    await user.click(panel.getByRole('button', { name: 'Download encrypted copy' }))
    expect(await panel.findByText('The two passphrases don’t match.')).toBeTruthy()
    expect(panel.getByLabelText('Passphrase again').getAttribute('aria-invalid')).toBe('true')
    expect(downloads).toHaveLength(0)

    await user.clear(panel.getByLabelText('Passphrase again'))
    await user.type(panel.getByLabelText('Passphrase again'), PASSPHRASE)
    await user.click(panel.getByRole('button', { name: 'Download encrypted copy' }))
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 5000 })
    expect(downloads[0].name).toMatch(/^guyot-export-\d{4}-\d{2}-\d{2}-encrypted\.json$/)
    const text = await blobText(downloads[0].blob)
    const sealed = encryptedFileIn(text)
    expect(sealed).not.toBeNull()
    expect(JSON.parse(await decryptText(sealed!, PASSPHRASE))).toMatchObject({ app: 'guyot' })
    expect(announced()).toBe('An encrypted copy of your data was downloaded.')
    expect((panel.getByLabelText('Passphrase') as HTMLInputElement).value).toBe('') // cleared
  })

  it('downloads unencrypted only after a warning is acknowledged', async () => {
    const { user } = await openData()
    const panel = exportPanel()
    await user.click(panel.getByText('Download without encryption (strongly recommended against)'))
    expect(panel.getByText(/Unencrypted files are strongly recommended against/)).toBeTruthy()
    const plain = panel.getByRole('button', { name: 'Download unencrypted' })
    expect(plain.getAttribute('aria-disabled')).toBe('true')
    await user.click(plain)
    expect(panel.getByText(/Tick the box above first/)).toBeTruthy()
    expect(downloads).toHaveLength(0)

    await user.click(panel.getByRole('checkbox', { name: /I understand/ }))
    await user.click(plain)
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].name).toMatch(/^guyot-export-\d{4}-\d{2}-\d{2}\.json$/)
    expect(JSON.parse(await blobText(downloads[0].blob))).toMatchObject({ app: 'guyot' })
    expect(announced()).toBe('An unencrypted copy of your data was downloaded.')
  })
})

describe('import a file', () => {
  it('shows what the file holds, then merges it on confirm', async () => {
    const { user } = await openData()
    await upload(user, await exportFromAnotherDevice())
    const result = await screen.findByRole('group', { name: 'Ready to import export.json' })
    await waitFor(() => expect(document.activeElement).toBe(result))
    expect(within(result).getByText('Applications: 1')).toBeTruthy()

    await user.click(within(result).getByRole('button', { name: 'Merge into my data' }))
    await waitFor(() => expect(announced()).toMatch(/^Imported export.json: \d+ records read/))
    await user.click(screen.getByRole('link', { name: 'Tracker' }))
    expect(await screen.findByRole('rowheader', { name: 'R001' })).toBeTruthy()
  })

  it('asks for the passphrase of an encrypted file before showing it', async () => {
    const { user } = await openData()
    const sealed = await encryptText(await exportFromAnotherDevice(), PASSPHRASE, 1_000)
    await upload(user, JSON.stringify(sealed), 'sealed.json')
    const locked = await screen.findByRole('group', { name: 'sealed.json is encrypted' })
    const field = within(locked).getByLabelText('Passphrase for this file')

    await user.type(field, 'not the passphrase')
    await user.click(within(locked).getByRole('button', { name: 'Open file' }))
    expect(await within(locked).findByRole('alert')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')

    await user.clear(field)
    await user.type(field, PASSPHRASE)
    await user.click(within(locked).getByRole('button', { name: 'Open file' }))
    const result = await screen.findByRole('group', { name: 'Ready to import sealed.json' })
    expect(within(result).getByText('Applications: 1')).toBeTruthy()
  })

  it('refuses a bad file and changes nothing', async () => {
    const { user } = await openData()
    await upload(user, '{not json', 'broken.json')
    const result = await screen.findByRole('group', { name: 'Nothing was imported' })
    expect(within(result).getByText('File: not valid JSON')).toBeTruthy()
    expect(within(result).queryByRole('button', { name: 'Merge into my data' })).toBeNull()
  })
})

describe('backups', () => {
  it('downloads a backup encrypted, from its own dialog', async () => {
    const { user } = await openData()
    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    await user.click(await screen.findByRole('button', { name: /^Download the backup from / }))
    const dialog = within(await screen.findByRole('dialog', { name: /^Download the backup from / }))
    await user.type(dialog.getByLabelText('Passphrase'), PASSPHRASE)
    await user.type(dialog.getByLabelText('Passphrase again'), PASSPHRASE)
    await user.click(dialog.getByRole('button', { name: 'Download encrypted backup' }))
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 5000 })
    expect(downloads[0].name).toMatch(/^guyot-backup-.*-encrypted\.json$/)
    expect(encryptedFileIn(await blobText(downloads[0].blob))).not.toBeNull()
    expect(announced()).toBe('Encrypted backup downloaded.')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('backs up, then restores after showing what will change', async () => {
    const { user } = await openData()
    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    await screen.findByRole('table', { name: '1 backup, newest first' })

    // Add an application after the backup.
    await user.click(screen.getByRole('link', { name: 'Tracker' }))
    await user.click(await screen.findByRole('button', { name: 'Add application' }))
    const add = within(screen.getByRole('dialog', { name: 'Add application' }))
    await user.type(add.getByRole('textbox', { name: 'Company' }), 'Example Co')
    await user.type(add.getByRole('textbox', { name: 'Role' }), 'Designer')
    await user.click(add.getByRole('button', { name: 'Save' }))
    await screen.findByRole('rowheader', { name: 'R001' })

    await user.click(screen.getByRole('link', { name: 'Your data' }))
    const restoreButton = await screen.findByRole('button', { name: /^Restore the backup from / })
    await user.click(restoreButton)
    const dialog = within(await screen.findByRole('dialog', { name: /^Restore the backup from / }))
    expect(
      await dialog.findByText('1 record made since will move to Recently deleted.'),
    ).toBeTruthy()
    expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Cancel' }))

    await user.click(dialog.getByRole('button', { name: 'Restore this backup' }))
    await waitFor(() =>
      expect(announced()).toMatch(/^Restored the backup from .*1 record moved to Recently deleted/),
    )
    expect(await screen.findByRole('table', { name: '2 backups, newest first' })).toBeTruthy()

    await user.click(screen.getByRole('link', { name: 'Tracker' }))
    expect(await screen.findByText(/No applications yet/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Recently deleted (1)' })).toBeTruthy()
  })
})
