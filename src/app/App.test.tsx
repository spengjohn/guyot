// @vitest-environment jsdom
import '../test/dom'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'

// These tests find everything by role and accessible name, the way assistive technology
// does: an input without a label, or a button without a name, can't be found.

async function start(dbName = `test-${crypto.randomUUID()}`) {
  const user = userEvent.setup()
  const view = render(<App dbName={dbName} />)
  await screen.findByRole('button', { name: 'Add application' }) // loaded, not just the heading
  return { user, dbName, view }
}

const announced = () => screen.getByTestId('announcer').textContent

async function addApplication(user: UserEvent, company: string, role: string) {
  await user.click(screen.getByRole('button', { name: 'Add application' }))
  const dialog = screen.getByRole('dialog', { name: 'Add application' })
  await user.type(within(dialog).getByRole('textbox', { name: 'Company' }), company)
  await user.type(within(dialog).getByRole('textbox', { name: 'Role' }), role)
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

describe('app shell', () => {
  it('opens on the tracker, with navigation and a skip link', async () => {
    const { user } = await start()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Tracker' }).getAttribute('aria-current')).toBe(
      'page',
    )
    await user.click(screen.getByRole('link', { name: 'Skip to main content' }))
    expect(document.activeElement).toBe(screen.getByRole('main'))
    expect(window.location.hash).toBe('') // the skip link didn't change the route
  })

  it('moves to placeholder pages and focuses their heading', async () => {
    const { user } = await start()
    await user.click(screen.getByRole('link', { name: 'Targets' }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Targets' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(document.title).toBe('Targets · Guyot')
    await user.click(screen.getByRole('link', { name: 'Dashboard' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy()
  })
})

describe('applications', () => {
  it('shows an empty state, then adds an application', async () => {
    const { user } = await start()
    expect(screen.getByText(/No applications yet/)).toBeTruthy()
    await addApplication(user, 'Example Co', 'Designer')

    const table = await screen.findByRole('table', { name: '1 application' })
    expect(within(table).getByRole('rowheader', { name: 'R001' })).toBeTruthy()
    expect(within(table).getByRole('cell', { name: 'Example Co' })).toBeTruthy()
    expect(within(table).getByRole('cell', { name: 'Applied' })).toBeTruthy()
    expect(announced()).toBe('Saved R001, Example Co, Designer.')
  })

  it('edits an application', async () => {
    const { user } = await start()
    await addApplication(user, 'Example Co', 'Designer')
    const edit = await screen.findByRole('button', { name: 'Edit R001, Example Co, Designer' })
    await user.click(edit)
    const dialog = screen.getByRole('dialog', { name: 'Edit R001, Example Co, Designer' })
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Status' }),
      'Interviewing',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const table = screen.getByRole('table')
    expect(await within(table).findByRole('cell', { name: 'Interviewing' })).toBeTruthy()
    expect(document.activeElement).toBe(edit) // focus went back to the button that opened it
  })

  it('marks required fields and refuses to save without them', async () => {
    const { user } = await start()
    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add application' }))
    const company = dialog.getByRole('textbox', { name: 'Company' })
    for (const input of [
      company,
      dialog.getByRole('textbox', { name: 'Role' }),
      dialog.getByRole('combobox', { name: 'Status' }),
    ]) {
      expect(input.getAttribute('aria-required')).toBe('true')
    }
    expect(dialog.getByText('Fields marked (required) must be filled in.')).toBeTruthy()

    await user.type(dialog.getByRole('textbox', { name: 'Role' }), 'Designer')
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    const summary = await dialog.findByRole('group', { name: 'Fix this to save' })
    expect(document.activeElement).toBe(summary)
    expect(company.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(company.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Enter the company',
    )
    expect(screen.getByText(/No applications yet/)).toBeTruthy() // nothing was saved
  })

  it('keeps optional fields under More details until wanted', async () => {
    const { user } = await start()
    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add application' }))
    const more = dialog.getByRole('button', { name: 'More details (optional)' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(dialog.queryByLabelText('Notes')).toBeNull()
    await user.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    await user.type(dialog.getByLabelText('Notes'), 'Referred by Sam')
    await user.type(dialog.getByRole('textbox', { name: 'Company' }), 'Example Co')
    await user.type(dialog.getByRole('textbox', { name: 'Role' }), 'Designer')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    // Editing a record with optional values shows them straight away.
    await user.click(await screen.findByRole('button', { name: 'Edit R001, Example Co, Designer' }))
    const edit = within(screen.getByRole('dialog', { name: 'Edit R001, Example Co, Designer' }))
    expect(
      edit.getByRole('button', { name: 'More details (optional)' }).getAttribute('aria-expanded'),
    ).toBe('true')
    expect((edit.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Referred by Sam')
  })

  it('shows errors beside the field and keeps the dialog open', async () => {
    const { user } = await start()
    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Company' }), 'Example Co')
    await user.type(within(dialog).getByRole('textbox', { name: 'Role' }), 'Designer')
    await user.click(within(dialog).getByRole('button', { name: 'More details (optional)' }))
    const listing = within(dialog).getByLabelText('Listing')
    await user.type(listing, 'not a link')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    const summary = await within(dialog).findByRole('group', { name: 'Fix this to save' })
    expect(document.activeElement).toBe(summary)
    expect(listing.getAttribute('aria-invalid')).toBe('true')
    expect(listing.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(listing.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Listing: expected a web link',
    )
  })

  it('cancels without saving', async () => {
    const { user } = await start()
    await user.click(screen.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Company' }), 'Never saved')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(/No applications yet/)).toBeTruthy()
  })
})

describe('delete, undo and restore', () => {
  it('deletes with undo, and focus follows', async () => {
    const { user } = await start()
    await addApplication(user, 'Example Co', 'Designer')
    await user.click(
      await screen.findByRole('button', { name: 'Delete R001, Example Co, Designer' }),
    )

    const undo = await screen.findByRole('button', {
      name: 'Undo delete of R001, Example Co, Designer',
    })
    await waitFor(() => expect(document.activeElement).toBe(undo))
    expect(announced()).toBe('Deleted R001, Example Co, Designer. Undo is available.')
    expect(await screen.findByText(/No applications yet/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Recently deleted (1)' })).toBeTruthy()

    await user.click(undo)
    const edit = await screen.findByRole('button', { name: 'Edit R001, Example Co, Designer' })
    await waitFor(() => expect(document.activeElement).toBe(edit))
    expect(announced()).toBe('Restored R001, Example Co, Designer.')
  })

  it('restores from Recently deleted', async () => {
    const { user } = await start()
    await addApplication(user, 'Example Co', 'Designer')
    await user.click(
      await screen.findByRole('button', { name: 'Delete R001, Example Co, Designer' }),
    )
    await user.click(await screen.findByRole('link', { name: 'Recently deleted (1)' }))

    await screen.findByRole('heading', { level: 1, name: 'Recently deleted' })
    await user.click(
      await screen.findByRole('button', { name: 'Restore R001, Example Co, Designer' }),
    )
    expect(await screen.findByText('Nothing has been deleted.')).toBeTruthy()
    expect(announced()).toBe("Restored R001, Example Co, Designer. It's back in the tracker.")
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })),
    )

    await user.click(screen.getByRole('link', { name: 'Back to applications' }))
    expect(await screen.findByRole('rowheader', { name: 'R001' })).toBeTruthy()
  })
})

describe('open tabs', () => {
  // Two copies of the app on one database stand in for two tabs.
  async function twoTabs() {
    const dbName = `test-${crypto.randomUUID()}`
    const user = userEvent.setup()
    const first = within(render(<App dbName={dbName} />).container)
    const second = within(render(<App dbName={dbName} />).container)
    await first.findByRole('button', { name: 'Add application' })
    await second.findByRole('button', { name: 'Add application' })
    return { user, first, second }
  }

  it("shows one tab's changes in the other", async () => {
    const { user, first, second } = await twoTabs()
    await user.click(first.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Company' }), 'Example Co')
    await user.type(within(dialog).getByRole('textbox', { name: 'Role' }), 'Designer')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await second.findByRole('rowheader', { name: 'R001' })).toBeTruthy()
    await user.click(second.getByRole('button', { name: 'Delete R001, Example Co, Designer' }))
    await waitFor(() => expect(first.queryByRole('rowheader', { name: 'R001' })).toBeNull())
    expect(first.getByRole('link', { name: 'Recently deleted (1)' })).toBeTruthy()
  })

  it('follows a column layout saved in the other tab', async () => {
    const { user, first, second } = await twoTabs()
    await user.click(first.getByRole('button', { name: 'Add application' }))
    const dialog = screen.getByRole('dialog', { name: 'Add application' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Company' }), 'Example Co')
    await user.type(within(dialog).getByRole('textbox', { name: 'Role' }), 'Designer')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await second.findByRole('table')

    await user.click(first.getByRole('button', { name: 'Columns' }))
    await user.click(first.getByRole('checkbox', { name: 'Listing' }))
    await waitFor(() => expect(second.queryByRole('columnheader', { name: 'Listing' })).toBeNull())
  })
})

describe('editing the same application in two tabs', () => {
  const NAME = 'R001, Example Co, Designer'

  /** Two tabs, one application (Notes "x"), and an Edit form open on it in each tab. */
  async function bothEditing() {
    const dbName = `test-${crypto.randomUUID()}`
    const user = userEvent.setup()
    const first = within(render(<App dbName={dbName} />).container)
    await first.findByRole('button', { name: 'Add application' })
    await user.click(first.getByRole('button', { name: 'Add application' }))
    const add = first.getByRole('dialog', { name: 'Add application' })
    await user.type(within(add).getByRole('textbox', { name: 'Company' }), 'Example Co')
    await user.type(within(add).getByRole('textbox', { name: 'Role' }), 'Designer')
    await user.click(within(add).getByRole('button', { name: 'More details (optional)' }))
    await user.type(within(add).getByLabelText('Notes'), 'x')
    await user.click(within(add).getByRole('button', { name: 'Save' }))
    await first.findByRole('rowheader', { name: 'R001' })

    const second = within(render(<App dbName={dbName} />).container)
    await user.click(await second.findByRole('button', { name: `Edit ${NAME}` }))
    await user.click(first.getByRole('button', { name: `Edit ${NAME}` }))
    const formA = within(first.getByRole('dialog', { name: `Edit ${NAME}` }))
    const formB = within(second.getByRole('dialog', { name: `Edit ${NAME}` }))
    return { user, first, second, formA, formB }
  }

  /** Types into Notes in a form, replacing what's there. */
  async function setNotes(user: UserEvent, form: ReturnType<typeof within>, text: string) {
    const notes = form.getByLabelText('Notes')
    await user.clear(notes)
    await user.type(notes, text)
  }

  it('updates fields this tab has not touched, and says so', async () => {
    const { user, formA, formB } = await bothEditing()
    await setNotes(user, formA, 'Tab A')
    await user.click(formA.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect((formB.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Tab A'),
    )
    expect(
      formB.getByText(
        /Saved elsewhere since you opened this form: Notes\. The form shows the new values/,
      ),
    ).toBeTruthy()
    expect(
      formB.queryByRole('region', { name: 'Changed elsewhere while you were editing' }),
    ).toBeNull()
  })

  it('refuses to overwrite a newer save, compares them, and keeps the chosen version', async () => {
    const { user, first, second, formA, formB } = await bothEditing()
    await setNotes(user, formB, 'Tab B') // B starts typing first...
    await setNotes(user, formA, 'Tab A')
    await user.click(formA.getByRole('button', { name: 'Save' })) // ...but A saves first

    const conflicts = await formB.findByRole('region', {
      name: 'Changed elsewhere while you were editing',
    })
    const notes = within(within(conflicts).getByRole('group', { name: 'Notes: two versions' }))
    const [yours, saved] = notes.getAllByRole('definition').map((dd) => dd.textContent)
    expect([yours, saved]).toEqual(['Tab B', 'Tab A'])
    expect(formB.getByLabelText('Notes').getAttribute('aria-invalid')).toBe('true')

    // Saving now is refused until the user chooses.
    await user.click(formB.getByRole('button', { name: 'Save' }))
    expect(document.activeElement).toBe(conflicts)
    expect(second.getByRole('dialog')).toBeTruthy() // still open

    await user.click(notes.getByRole('button', { name: 'Keep my Notes' }))
    expect(
      formB.queryByRole('region', { name: 'Changed elsewhere while you were editing' }),
    ).toBeNull()
    expect(document.activeElement).toBe(formB.getByRole('button', { name: 'Save' }))

    // Before saving, the form warns that this save goes over the newer version.
    expect(
      formB.getByText(
        'Changes occurred while you were editing. Caution when saving as your edits were kept and placed over the fresh data. Fields: Notes.',
      ),
    ).toBeTruthy()
    const notesInput = formB.getByLabelText('Notes')
    const described = notesInput.getAttribute('aria-describedby')!.split(' ')
    expect(described.map((id) => document.getElementById(id)?.textContent)).toContain(
      'Saving replaces the version saved elsewhere.',
    )
    await user.click(formB.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(second.queryByRole('dialog')).toBeNull())

    // Tab A (now refreshed) sees the version that was chosen.
    await user.click(first.getByRole('button', { name: `Edit ${NAME}` }))
    const reopened = within(first.getByRole('dialog', { name: `Edit ${NAME}` }))
    expect((reopened.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Tab B')
  })

  it('can take the saved version instead', async () => {
    const { user, formA, formB } = await bothEditing()
    await setNotes(user, formB, 'Tab B')
    await setNotes(user, formA, 'Tab A')
    await user.click(formA.getByRole('button', { name: 'Save' }))

    await user.click(await formB.findByRole('button', { name: 'Use saved Notes' }))
    expect((formB.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Tab A')
    expect(formB.getByLabelText('Notes').getAttribute('aria-invalid')).toBeNull()
  })

  it("won't save an application deleted in the other tab", async () => {
    const { user, first, formA, formB } = await bothEditing()
    await user.click(formA.getByRole('button', { name: 'Cancel' }))
    await user.click(first.getByRole('button', { name: `Delete ${NAME}` }))

    expect(await formB.findByText(/was deleted in another tab or on another device/)).toBeTruthy()
    await setNotes(user, formB, 'Tab B')
    await user.click(formB.getByRole('button', { name: 'Save' }))
    expect(await formB.findByText(/deleted elsewhere, so it can’t be saved/)).toBeTruthy()
  })
})

describe('column picker', () => {
  const headers = () =>
    within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((th) => th.textContent)

  it('hides and reorders columns, keeps focus, and remembers them on this device', async () => {
    const { user, dbName, view } = await start()
    await addApplication(user, 'Example Co', 'Designer')
    await screen.findByRole('table')

    const toggle = screen.getByRole('button', { name: 'Columns' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByRole('group', { name: 'Columns to show, in order' })

    await user.click(within(panel).getByRole('checkbox', { name: 'Listing' }))
    expect(headers()).not.toContain('Listing')
    expect(announced()).toBe('Listing hidden.')

    const up = within(panel).getByRole('button', { name: 'Move Company up' })
    await user.click(up)
    expect(headers()[0]).toBe('Company')
    expect(announced()).toBe('Company moved to position 1 of 12.')
    const moved = within(panel).getByRole('button', { name: 'Move Company up' })
    expect(document.activeElement).toBe(moved)
    expect(moved.getAttribute('aria-disabled')).toBe('true')
    await user.click(moved) // already first: nothing moves, and it says so
    expect(announced()).toBe('Company is already first.')
    expect(screen.getByRole('rowheader', { name: 'Example Co' })).toBeTruthy()

    view.unmount()
    await start(dbName)
    await screen.findByRole('table')
    await waitFor(() => expect(headers()[0]).toBe('Company'))
    expect(headers()).not.toContain('Listing')
  })
})
