// @vitest-environment jsdom
import '../test/dom'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { announced, renderApp } from '../test/app'

async function openTargets(dbName?: string) {
  const app = await renderApp('#/targets', dbName)
  await screen.findByRole('button', { name: 'Add profile' })
  return app
}

const sharedForm = () => within(screen.getByRole('region', { name: 'Shared targets' }))
type Scope = ReturnType<typeof within>

/** Opens a field's collapsible row by clicking its summary; returns the row. */
async function openRow(user: UserEvent, scope: Scope, label: string) {
  const summaryLabel = scope.getByText(label, { selector: '.collapsible-label' })
  const row = summaryLabel.closest('details')!
  if (!row.open) await user.click(summaryLabel)
  return row
}

/** Adds items to a list through its add box, pressing Enter after each. */
async function addItems(user: UserEvent, scope: Scope, list: string, items: string[]) {
  const box = scope.getByRole('textbox', { name: `Add to ${list}` })
  for (const item of items) await user.type(box, `${item}{enter}`)
}

async function saveShared(user: UserEvent, roleTypes: string[]) {
  await openRow(user, sharedForm(), 'Role types')
  await addItems(user, sharedForm(), 'Role types', roleTypes)
  await user.click(sharedForm().getByRole('button', { name: 'Save shared targets' }))
  await waitFor(() => expect(announced()).toBe('Saved shared targets.'))
}

/** Adds a profile with just a name, through the dialog. */
async function addProfile(user: UserEvent, name: string) {
  await user.click(screen.getByRole('button', { name: 'Add profile' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Add profile' }))
  await user.type(dialog.getByRole('textbox', { name: 'Name' }), name)
  await user.click(dialog.getByRole('button', { name: 'Save' }))
  await screen.findByRole('article', { name })
}

describe('shared targets', () => {
  it('saves list items added as rows, and keeps them', async () => {
    const { user, dbName, view } = await openTargets()
    expect(sharedForm().getByText(/Not set yet/)).toBeTruthy()
    const row = await openRow(user, sharedForm(), 'Role types')
    expect(row.open).toBe(true)
    await saveShared(user, ['UX designer', '  ', 'Researcher']) // a blank entry adds nothing

    view.unmount()
    await openTargets(dbName)
    const roleTypes = await openRow(user, sharedForm(), 'Role types')
    expect(roleTypes.querySelector('.collapsible-preview')?.textContent).toBe(
      '2: UX designer, Researcher',
    )
    const first = sharedForm().getByRole('textbox', { name: 'Role types, item 1 of 2' })
    expect((first as HTMLInputElement).value).toBe('UX designer')
    expect(sharedForm().getByText(/Last updated/)).toBeTruthy()
  })

  it('starts collapsed, with Expand all and Collapse all', async () => {
    const { user } = await openTargets()
    const rows = () => [...document.querySelectorAll<HTMLDetailsElement>('details.collapsible')]
    expect(rows().length).toBe(10)
    expect(rows().every((r) => !r.open)).toBe(true)
    await user.click(sharedForm().getByRole('button', { name: 'Expand all' }))
    expect(rows().every((r) => r.open)).toBe(true)
    expect(announced()).toBe('All 10 shared targets expanded.')
    await user.click(sharedForm().getByRole('button', { name: 'Collapse all' }))
    expect(rows().every((r) => !r.open)).toBe(true)
  })

  it('opens a field that needs attention, and keeps text not yet added', async () => {
    const { user } = await openTargets()
    const row = await openRow(user, sharedForm(), 'Industries')
    await user.type(sharedForm().getByRole('textbox', { name: 'Add to Industries' }), 'Health tech')
    await user.click(row.querySelector('summary')!) // close it, with the text still waiting
    await user.click(sharedForm().getByRole('button', { name: 'Save shared targets' }))
    await sharedForm().findByRole('group', { name: 'Fix this to save' })
    expect(row.open).toBe(true)
    expect(within(row).getByText('Needs attention')).toBeTruthy()
    expect(
      sharedForm().getAllByText(/Press \+ Add to add “Health tech” to Industries/).length,
    ).toBeGreaterThan(0)
  })

  it('shows a conflict when another tab saved the same field first', async () => {
    const { user, dbName } = await openTargets()
    const first = within(screen.getByRole('region', { name: 'Shared targets' }))
    // A second tab on the same data.
    const { view } = await renderApp('#/targets', dbName)
    const [second] = await within(view.container).findAllByRole('region', {
      name: 'Shared targets',
    })
    const tabB = within(second)

    await openRow(user, tabB, 'Dealbreakers')
    await addItems(user, tabB, 'Dealbreakers', ['Unpaid'])
    await openRow(user, first, 'Dealbreakers')
    await addItems(user, first, 'Dealbreakers', ['Night shifts'])
    await user.click(first.getByRole('button', { name: 'Save shared targets' }))

    const conflicts = await tabB.findByRole('region', {
      name: 'Changed elsewhere while you were editing',
    })
    const versions = within(
      within(conflicts).getByRole('group', { name: 'Dealbreakers: two versions' }),
    )
    expect(versions.getAllByRole('definition').map((dd) => dd.textContent)).toEqual([
      'Unpaid',
      'Night shifts',
    ])
  })

  it('marks eligibility notes as personal', async () => {
    await openTargets()
    const notes = sharedForm().getByRole('textbox', { name: 'Eligibility notes' })
    const hint = document.getElementById(notes.getAttribute('aria-describedby')!.split(' ')[0])
    expect(hint?.textContent).toBe('Personal. Sent to an AI only from stages that need it.')
  })
})

describe('search profiles', () => {
  it('needs a name', async () => {
    const { user } = await openTargets()
    await user.click(screen.getByRole('button', { name: 'Add profile' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add profile' }))
    expect(dialog.getByRole('checkbox', { name: 'Active' })).toHaveProperty('checked', true)
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await dialog.findByRole('group', { name: 'Fix this to save' })
    const name = dialog.getByRole('textbox', { name: 'Name' })
    expect(name.getAttribute('aria-required')).toBe('true')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Enter a name for this profile',
    )
  })

  it('adds a profile that adds to a shared list, showing what it will use', async () => {
    const { user } = await openTargets()
    await saveShared(user, ['UX designer'])
    await user.click(screen.getByRole('button', { name: 'Add profile' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add profile' }))
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'Remote UX')
    await user.click(dialog.getByRole('checkbox', { name: 'Remote' }))

    await user.click(
      dialog.getByRole('button', { name: 'Override shared targets for this profile' }),
    )
    const overrideRow = await openRow(user, dialog, 'Role types')
    expect(overrideRow.querySelector('.collapsible-preview')?.textContent).toBe('Uses shared')
    const roleTypes = within(dialog.getByRole('group', { name: 'Role types' }))
    expect(roleTypes.getByRole('radio', { name: 'Use shared' })).toHaveProperty('checked', true)
    await user.click(roleTypes.getByRole('radio', { name: 'Add to shared' }))
    await addItems(user, roleTypes, 'Role types for this profile', ['Researcher'])
    expect(overrideRow.querySelector('.collapsible-preview')?.textContent).toBe(
      'Adds 1: Researcher',
    )
    expect(roleTypes.getByText(/This profile will use:/).textContent).toBe(
      'This profile will use: UX designer, Researcher',
    )
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    const card = within(await screen.findByRole('article', { name: 'Remote UX' }))
    expect(card.getByRole('definition').textContent).toBe('Remote') // only Work modes has a value
    expect(card.getByRole('term').textContent).toBe('Work modes')
    expect(card.getByText('Overrides 1 shared target.')).toBeTruthy()
    expect(card.queryByText('Inactive')).toBeNull()
    expect(announced()).toBe('Saved profile Remote UX.')

    // The override was saved as one value: mode and items together.
    await user.click(screen.getByRole('button', { name: 'Edit Remote UX' }))
    const edit = within(screen.getByRole('dialog', { name: 'Edit profile Remote UX' }))
    // Overrides that are set start open, and Role types is one.
    const savedRow = edit
      .getByText('Role types', { selector: '.collapsible-label' })
      .closest('details')!
    expect(savedRow.open).toBe(true)
    const saved = within(edit.getByRole('group', { name: 'Role types' }))
    expect(saved.getByRole('radio', { name: 'Add to shared' })).toHaveProperty('checked', true)
    const item = saved.getByRole('textbox', { name: 'Role types for this profile, item 1 of 1' })
    expect((item as HTMLInputElement).value).toBe('Researcher')
  })

  it('shows an empty profile as just its name, and marks one switched off', async () => {
    const { user } = await openTargets()
    await addProfile(user, 'Frontend')
    const card = within(screen.getByRole('article', { name: 'Frontend' }))
    expect(card.queryAllByRole('term')).toHaveLength(0) // no fields have values
    expect(card.queryByText('Inactive')).toBeNull()

    await user.click(card.getByRole('button', { name: 'Edit Frontend' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Edit profile Frontend' }))
    await user.click(dialog.getByRole('checkbox', { name: 'Active' }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    const updated = within(await screen.findByRole('article', { name: 'Frontend' }))
    expect(await updated.findByText('Inactive')).toBeTruthy()
  })

  it('duplicates a profile only when the copy is saved', async () => {
    const { user } = await openTargets()
    await addProfile(user, 'Frontend')
    await user.click(screen.getByRole('button', { name: 'Duplicate Frontend' }))
    let dialog = within(screen.getByRole('dialog', { name: 'Duplicate profile' }))
    expect((dialog.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Frontend (copy)',
    )
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('list', { name: '1 profile' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Duplicate Frontend' }))
    dialog = within(screen.getByRole('dialog', { name: 'Duplicate profile' }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('article', { name: 'Frontend (copy)' })).toBeTruthy()
    expect(screen.getByRole('list', { name: '2 profiles' })).toBeTruthy()
  })

  it('deletes with undo, and restores from Recently deleted profiles', async () => {
    const { user } = await openTargets()
    await addProfile(user, 'Frontend')
    await user.click(screen.getByRole('button', { name: 'Delete Frontend' }))
    const undo = await screen.findByRole('button', { name: 'Undo delete of profile Frontend' })
    await waitFor(() => expect(document.activeElement).toBe(undo))
    await user.click(undo)
    expect(await screen.findByRole('article', { name: 'Frontend' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete Frontend' }))
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await user.click(await screen.findByText('Recently deleted profiles (1)'))
    await user.click(screen.getByRole('button', { name: 'Restore profile Frontend' }))
    expect(await screen.findByRole('article', { name: 'Frontend' })).toBeTruthy()
    expect(announced()).toBe('Restored profile Frontend.')
  })
})
