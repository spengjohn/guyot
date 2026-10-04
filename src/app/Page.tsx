import { useEffect, type ReactNode } from 'react'

/**
 * A page's heading and browser tab title. The heading can take focus (tabIndex -1:
 * focusable by code, not by Tab), so Shell can move focus to it when the page changes.
 */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Guyot`
  }, [title])
  return (
    <>
      <h1 tabIndex={-1}>{title}</h1>
      {children}
    </>
  )
}
