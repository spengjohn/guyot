// @vitest-environment jsdom
import '../test/dom'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('download a copy', () => {
  it('downloads every record as an export file', async () => {
    const { user } = await openData()
    await user.click(screen.getByRole('button', { name: 'Download a copy of your data' }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].name).toMatch(/^guyot-export-\d{4}-\d{2}-\d{2}\.json$/)
    const file = JSON.parse(await blobText(downloads[0].blob))
    expect(file).toMatchObject({ app: 'guyot', formatVersion: 1 })
    expect(announced()).toBe('Your data was downloaded.')
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

  it('refuses a bad file and changes nothing', async () => {
    const { user } = await openData()
    await upload(user, '{not json', 'broken.json')
    const result = await screen.findByRole('group', { name: 'Nothing was imported' })
    expect(within(result).getByText('File: not valid JSON')).toBeTruthy()
    expect(within(result).queryByRole('button', { name: 'Merge into my data' })).toBeNull()
  })
})

describe('backups', () => {
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
