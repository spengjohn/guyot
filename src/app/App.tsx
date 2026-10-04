import { useEffect, useState } from 'react'
import { Repo } from '../data/repo'
import { Announcer } from './Announcer'
import { RepoProvider } from './RepoProvider'
import { Shell } from './Shell'

type OpenState =
  { status: 'opening' } | { status: 'ready'; repo: Repo } | { status: 'failed'; message: string }

/** Opens the local database, then shows the app. `dbName` is for tests. */
export function App({ dbName }: { dbName?: string }) {
  const [state, setState] = useState<OpenState>({ status: 'opening' })

  useEffect(() => {
    let cancelled = false
    let opened: Repo | undefined
    Repo.open({ name: dbName }).then(
      (repo) => {
        if (cancelled) return repo.close()
        opened = repo
        setState({ status: 'ready', repo })
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    // Runs when the component goes away (or, in development, React's double check).
    return () => {
      cancelled = true
      opened?.close()
    }
  }, [dbName])

  if (state.status === 'opening') {
    return (
      <main id="main" className="center">
        <p role="status">Opening your data…</p>
      </main>
    )
  }
  if (state.status === 'failed') {
    return (
      <main id="main" className="center">
        <h1>Guyot couldn't open your data</h1>
        <p>{state.message}</p>
        <p>Your data has not been changed.</p>
      </main>
    )
  }
  return (
    <RepoProvider repo={state.repo}>
      <Announcer>
        <Shell />
      </Announcer>
    </RepoProvider>
  )
}
