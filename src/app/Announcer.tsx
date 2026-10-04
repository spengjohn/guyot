import { useCallback, useState, type ReactNode } from 'react'
import { AnnounceContext } from './announce'

/**
 * One polite live region for the whole app. role="status" makes screen readers read
 * changes to it when they finish speaking. The region is always on the page (a region
 * added together with its text is often not read); each message is a new element, so
 * the same message twice in a row is still read.
 */
export function Announcer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState({ text: '', count: 0 })
  const announce = useCallback((text: string) => {
    setMessage((previous) => ({ text, count: previous.count + 1 }))
  }, [])
  return (
    <AnnounceContext value={announce}>
      {children}
      <div role="status" className="visually-hidden" data-testid="announcer">
        <span key={message.count}>{message.text}</span>
      </div>
    </AnnounceContext>
  )
}
