import { useEffect, useId, useRef, useState } from 'react'
import { useAnnounce } from '../app/announce'
import { moveColumn, setColumnHidden, type Column } from '../fields/columns'

interface Props {
  columns: readonly Column[]
  onChange: (columns: Column[]) => void
}

/**
 * Which columns show, and in what order: a checklist with Move up and Move down buttons
 * (no drag and drop, so it works the same by keyboard, touch and screen reader).
 * The end buttons use aria-disabled rather than disabled, so they keep focus.
 */
export function ColumnPicker({ columns, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const baseId = useId()
  const announce = useAnnounce()
  const pendingFocus = useRef<string | null>(null)

  // Reordering moves elements in the page, which can drop focus, so put it back on
  // the button that was pressed, in its new place.
  useEffect(() => {
    if (!pendingFocus.current) return
    document.getElementById(pendingFocus.current)?.focus()
    pendingFocus.current = null
  }, [columns])

  const buttonId = (key: string, by: -1 | 1) => `${baseId}-${by < 0 ? 'up' : 'down'}-${key}`

  const move = (index: number, by: -1 | 1) => {
    const { key, label } = columns[index].field
    const to = index + by
    if (to < 0 || to >= columns.length) {
      announce(`${label} is already ${by < 0 ? 'first' : 'last'}.`)
      return
    }
    pendingFocus.current = buttonId(key, by)
    onChange(moveColumn(columns, key, by))
    announce(`${label} moved to position ${to + 1} of ${columns.length}.`)
  }

  const toggle = (column: Column, show: boolean) => {
    const next = setColumnHidden(columns, column.field.key, !show)
    if (next.find((c) => c.field.key === column.field.key)?.hidden === column.hidden) {
      announce('At least one column must stay visible.')
      return
    }
    onChange(next)
    announce(`${column.field.label} ${show ? 'shown' : 'hidden'}.`)
  }

  return (
    <div className="column-picker">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${baseId}-panel`}
        onClick={() => setOpen(!open)}
      >
        Columns
      </button>
      <fieldset id={`${baseId}-panel`} hidden={!open} className="column-panel">
        <legend>Columns to show, in order</legend>
        <p className="hint">Saved on this device only.</p>
        <ol>
          {columns.map((column, index) => {
            const { key, label } = column.field
            const checkboxId = `${baseId}-show-${key}`
            return (
              <li key={key}>
                <input
                  type="checkbox"
                  id={checkboxId}
                  checked={!column.hidden}
                  onChange={(e) => toggle(column, e.target.checked)}
                />
                <label htmlFor={checkboxId}>{label}</label>
                <span className="move-buttons">
                  <button
                    type="button"
                    id={buttonId(key, -1)}
                    aria-label={`Move ${label} up`}
                    aria-disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    id={buttonId(key, 1)}
                    aria-label={`Move ${label} down`}
                    aria-disabled={index === columns.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Down
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
      </fieldset>
    </div>
  )
}
