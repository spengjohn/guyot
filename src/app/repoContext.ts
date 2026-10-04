import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Repo } from '../data/repo'

export interface RepoContextValue {
  repo: Repo
  /** Goes up after every write, here or in another tab, so queries know to load again. */
  revision: number
  /** Call after a write. Also tells other open tabs to reload. */
  changed: () => void
}

/** null until a RepoProvider is above in the tree. */
export const RepoContext = createContext<RepoContextValue | null>(null)

function useRepoContext(): RepoContextValue {
  const value = useContext(RepoContext)
  if (!value) throw new Error('useRepo must be used inside a RepoProvider')
  return value
}

export function useRepo(): Repo {
  return useRepoContext().repo
}

export type QueryState<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: unknown }

/**
 * Loads data through the repo, and loads it again after every write.
 * `load` must keep the same identity between renders (define it outside the
 * component, or wrap it in useCallback), or it would load on every render.
 * While reloading, the previous data stays on screen.
 */
export function useRepoQuery<T>(load: (repo: Repo) => Promise<T>): QueryState<T> {
  const { repo, revision } = useRepoContext()
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' })
  useEffect(() => {
    let current = true // false once a newer load starts or the component goes away
    load(repo).then(
      (data) => current && setState({ status: 'ready', data }),
      (error: unknown) => current && setState({ status: 'error', error }),
    )
    return () => {
      current = false
    }
  }, [repo, revision, load])
  return state
}

/**
 * Returns a function that runs a write through the repo, then tells every query to
 * reload. Errors are passed on to the caller.
 */
export function useRepoWrite(): <R>(write: (repo: Repo) => Promise<R>) => Promise<R> {
  const { repo, changed } = useRepoContext()
  return useCallback(
    async (write) => {
      try {
        return await write(repo)
      } finally {
        changed() // even a failed write may have been partly attempted; reload to be sure
      }
    },
    [repo, changed],
  )
}
