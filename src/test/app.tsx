// Helpers for component tests that render the whole app. Import '../test/dom' first.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../app/App'

/**
 * Renders the app on a fresh database (or `dbName`), at a page such as '#/targets', and
 * waits until it has opened. Returns the user-event driver and the database name.
 */
export async function renderApp(hash = '', dbName = `test-${crypto.randomUUID()}`) {
  window.location.hash = hash
  const user = userEvent.setup()
  const view = render(<App dbName={dbName} />)
  await screen.findByRole('navigation', { name: 'Main' })
  return { user, dbName, view }
}

/** The text most recently announced through the app's live region. */
export function announced(): string | null {
  return screen.getByTestId('announcer').textContent
}
