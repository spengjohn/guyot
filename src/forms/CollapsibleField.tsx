import type { ReactNode, SyntheticEvent } from 'react'
import { useAnnounce } from '../app/announce'

interface Props {
  label: string
  /** A one-line summary shown next to the label, open or closed. */
  preview: string
  open: boolean
  onToggle: (open: boolean) => void
  /** The field has an error or conflict: it stays open and says so. */
  attention?: boolean
  children: ReactNode
}

/**
 * One field as a row that opens and closes: a native <details>, so the keyboard and
 * screen readers already know how to use it. Its open state comes from the parent, so
 * "Expand all" can open every row. A field that needs attention can't be closed.
 */
export function CollapsibleField({ label, preview, open, onToggle, attention, children }: Props) {
  const isOpen = open || Boolean(attention)
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const now = event.currentTarget.open
    if (!now && attention) {
      event.currentTarget.open = true // keep it open while something there needs fixing
      return
    }
    if (now !== open) onToggle(now)
  }
  return (
    <details className="collapsible" open={isOpen} onToggle={handleToggle}>
      <summary>
        <span className="collapsible-label">{label}</span>
        <span className="collapsible-preview">{preview}</span>
        {attention && <span className="tag">Needs attention</span>}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  )
}

/** "Expand all" and "Collapse all" for a set of collapsible fields. */
export function ExpandControls({
  count,
  what,
  onExpand,
  onCollapse,
}: {
  count: number
  what: string
  onExpand: () => void
  onCollapse: () => void
}) {
  const announce = useAnnounce()
  return (
    <div className="expand-controls">
      <button
        type="button"
        onClick={() => {
          onExpand()
          announce(`All ${count} ${what} expanded.`)
        }}
      >
        Expand all
      </button>
      <button
        type="button"
        onClick={() => {
          onCollapse()
          announce(`All ${count} ${what} collapsed.`)
        }}
      >
        Collapse all
      </button>
    </div>
  )
}
