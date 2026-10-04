import { useMemo, useSyncExternalStore } from 'react'
import { parseRoute, type Route } from './routes'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const readHash = () => window.location.hash

/** The current route. Re-renders when the hash changes (links, back and forward). */
export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash)
  return useMemo(() => parseRoute(hash), [hash])
}
