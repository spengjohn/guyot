// @vitest-environment jsdom
import '../test/dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ListEditor } from './ListEditor'

function setup(items: string[] = []) {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<ListEditor label="Role types" items={items} onChange={onChange} />)
  const addBox = screen.getByRole('textbox', { name: 'Add to Role types' })
  /** The list as last reported, and the problem (if any). */
  const last = () => onChange.mock.calls.at(-1) as [string[], string | undefined]
  return { user, onChange, addBox, last }
}

describe('ListEditor', () => {
  it('adds an item with + Add, or with Enter, keeping focus in the add box', async () => {
    const { user, addBox, last } = setup()
    expect(screen.getByText('None yet.')).toBeTruthy()
    await user.type(addBox, 'UX designer')
    await user.click(screen.getByRole('button', { name: '+ Add' }))
    await user.type(addBox, 'Researcher{enter}')
    expect(last()).toEqual([['UX designer', 'Researcher'], undefined])
    expect(document.activeElement).toBe(addBox)
    expect(
      (screen.getByRole('textbox', { name: 'Role types, item 2 of 2' }) as HTMLInputElement).value,
    ).toBe('Researcher')
  })

  it('adds each line of a pasted list', async () => {
    const { user, addBox, last } = setup(['UX designer'])
    await user.click(addBox)
    await user.paste('Researcher\n\n  Writer \nux designer')
    expect(last()[0]).toEqual(['UX designer', 'Researcher', 'Writer']) // duplicate skipped
    expect(screen.getByText('Already in the list: ux designer.')).toBeTruthy()
  })

  it('refuses a duplicate, ignoring case and spaces', async () => {
    const { user, addBox, onChange } = setup(['UX designer'])
    await user.type(addBox, '  ux DESIGNER {enter}')
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual(['UX designer'])
    expect(screen.getByText(/Already in the list/, { selector: '.hint' })).toBeTruthy()
  })

  it('edits an item in place, and drops one emptied', async () => {
    const { user, last } = setup(['UX designer', 'Researcher'])
    const first = screen.getByRole('textbox', { name: 'Role types, item 1 of 2' })
    await user.clear(first)
    await user.type(first, 'Product designer')
    expect(last()[0]).toEqual(['Product designer', 'Researcher'])
    await user.clear(first)
    expect(last()[0]).toEqual(['Researcher']) // reported without it right away
    await user.tab() // leaving the empty row removes it
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('removes an item and moves focus to the next one', async () => {
    const { user, addBox, last } = setup(['A', 'B', 'C'])
    await user.click(screen.getByRole('button', { name: 'Remove B from Role types' }))
    expect(last()[0]).toEqual(['A', 'C'])
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Role types, item 2 of 2' }),
    )
    await user.click(screen.getByRole('button', { name: 'Remove C from Role types' }))
    await user.click(screen.getByRole('button', { name: 'Remove A from Role types' }))
    expect(document.activeElement).toBe(addBox) // nothing left: back to the add box
  })

  it('reports text typed but not yet added, so a save can catch it', async () => {
    const { user, addBox, last } = setup()
    await user.type(addBox, 'Data analyst')
    expect(last()).toEqual([
      [],
      'Press + Add to add “Data analyst” to Role types, or clear the box.',
    ])
    await user.clear(addBox)
    expect(last()).toEqual([[], undefined])
  })
})
