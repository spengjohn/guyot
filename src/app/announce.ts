import { createContext, useContext } from 'react'

/** Reads a short message aloud to screen reader users, such as "Saved". */
export type Announce = (message: string) => void

export const AnnounceContext = createContext<Announce>(() => {})

export function useAnnounce(): Announce {
  return useContext(AnnounceContext)
}
