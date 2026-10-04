import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Repo } from '../data/repo'
import { RepoContext } from './repoContext'

/**
 * Makes one open Repo available to every component below it, and keeps open tabs in
 * step: after a write, this tab tells the others (on a BroadcastChannel) that something
 * changed, and they reload from IndexedDB. The message carries no data, so IndexedDB
 * stays the only source of truth.
 */
export function RepoProvider({ repo, children }: { repo: Repo; children: ReactNode }) {
  const [revision, setRevision] = useState(0)
  const channel = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return // very old browsers: no tab sync
    const current = new BroadcastChannel(`guyot-changes:${repo.databaseName}`)
    // A channel never receives its own messages, only other tabs'.
    current.onmessage = () => setRevision((n) => n + 1)
    channel.current = current
    return () => {
      current.close()
      channel.current = null
    }
  }, [repo])

  const changed = useCallback(() => {
    setRevision((n) => n + 1)
    channel.current?.postMessage({ type: 'changed' })
  }, [])

  const value = useMemo(() => ({ repo, revision, changed }), [repo, revision, changed])
  return <RepoContext value={value}>{children}</RepoContext>
}
