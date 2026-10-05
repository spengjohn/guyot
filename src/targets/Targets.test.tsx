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

async function saveShared(user: UserEvent, roleTypes: string) {
  const box = sharedForm().getByRole('textbox', { name: 'Role types' })
  await user.type(box, roleTypes)
  await user.click(sharedForm().getByRole('button', { name: 'Save shared targets' }))
  await waitFor(() => expect(announced()).toBe('Saved shared targets.'))
}

/** Adds a profile with just a name, through the dialog. */
async function addProfile(user: UserEvent, name: string) {
  await user.click(screen.getByRole('button', { name: 'Add profile' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Add profile' }))
  await user.type(dialog.getByRole('textbox', { name: 'Name' }), name)
  await user.click(dialog.getByRole('button', { name: 'Save' }))
  await screen.findByRole('rowheader', { name })
}

describe('shared targets', () => {
  it('saves lists typed one per line, and keeps them', async () => {
    const { user, dbName, view } = await openTargets()
    expect(sharedForm().getByText(/Not set yet/)).toBeTruthy()
    await saveShared(user, 'UX designer{enter}  {enter}Researcher')

    view.unmount()
    await openTargets(dbName)
    const box = sharedForm().getByRole('textbox', { name: 'Role types' }) as HTMLTextAreaElement
    expect(box.value).toBe('UX designer\nResearcher') // the blank line was dropped
    expect(sharedForm().getByText(/Last updated/)).toBeTruthy()
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

    await user.type(tabB.getByRole('textbox', { name: 'Dealbreakers' }), 'Unpaid')
    await user.type(first.getByRole('textbox', { name: 'Dealbreakers' }), 'Night shifts')
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
    await saveShared(user, 'UX designer')
    await user.click(screen.getByRole('button', { name: 'Add profile' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add profile' }))
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'Remote UX')
    await user.click(dialog.getByRole('checkbox', { name: 'Remote' }))

    await user.click(
      dialog.getByRole('button', { name: 'Override shared targets for this profile' }),
    )
    const roleTypes = within(dialog.getByRole('group', { name: 'Role types' }))
    expect(roleTypes.getByRole('radio', { name: 'Use shared' })).toHaveProperty('checked', true)
    await user.click(roleTypes.getByRole('radio', { name: 'Add to shared' }))
    await user.type(roleTypes.getByRole('textbox', { name: 'Role types to add' }), 'Researcher')
    expect(roleTypes.getByText(/This profile will use:/).textContent).toBe(
      'This profile will use: UX designer, Researcher',
    )
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    const row = within((await screen.findByRole('rowheader', { name: 'Remote UX' })).closest('tr')!)
    expect(row.getByRole('cell', { name: 'Remote' })).toBeTruthy()
    expect(announced()).toBe('Saved profile Remote UX.')

    // The override was saved as one value: mode and items together.
    await user.click(screen.getByRole('button', { name: 'Edit Remote UX' }))
    const edit = within(screen.getByRole('dialog', { name: 'Edit profile Remote UX' }))
    const saved = within(edit.getByRole('group', { name: 'Role types' })) // overrides start open
    expect(saved.getByRole('radio', { name: 'Add to shared' })).toHaveProperty('checked', true)
    expect(
      (saved.getByRole('textbox', { name: 'Role types to add' }) as HTMLTextAreaElement).value,
    ).toBe('Researcher')
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
    expect(screen.getByRole('table', { name: '1 profile' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Duplicate Frontend' }))
    dialog = within(screen.getByRole('dialog', { name: 'Duplicate profile' }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('rowheader', { name: 'Frontend (copy)' })).toBeTruthy()
    expect(screen.getByRole('table', { name: '2 profiles' })).toBeTruthy()
  })

  it('deletes with undo, and restores from Recently deleted profiles', async () => {
    const { user } = await openTargets()
    await addProfile(user, 'Frontend')
    await user.click(screen.getByRole('button', { name: 'Delete Frontend' }))
    const undo = await screen.findByRole('button', { name: 'Undo delete of profile Frontend' })
    await waitFor(() => expect(document.activeElement).toBe(undo))
    await user.click(undo)
    expect(await screen.findByRole('rowheader', { name: 'Frontend' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete Frontend' }))
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await user.click(await screen.findByText('Recently deleted profiles (1)'))
    await user.click(screen.getByRole('button', { name: 'Restore profile Frontend' }))
    expect(await screen.findByRole('rowheader', { name: 'Frontend' })).toBeTruthy()
    expect(announced()).toBe('Restored profile Frontend.')
  })
})
