import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { linesToList } from './parse'

interface Props {
  /** The list's name, used in every label: "Role types". */
  label: string
  /** The items when the editor opens (it keeps its own copy while editing). */
  items: readonly string[]
  /**
   * Called with the trimmed, non-blank items. `problem` is set while the add box holds
   * text that hasn't been added, so a save can't silently drop it.
   */
  onChange: (items: string[], problem?: string) => void
  /** IDs of hint or error text describing the list as a whole. */
  describedBy?: string
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const clean = (rows: readonly string[]) => rows.map((r) => r.trim()).filter((r) => r !== '')

/**
 * A list as rows: each item is a small text box with Remove, and an add box below with
 * "+ Add". Enter in the add box adds; pasting several lines adds each line.
 */
export function ListEditor({ label, items, onChange, describedBy }: Props) {
  const id = useId()
  const [rows, setRows] = useState<string[]>(() => [...items])
  const [pending, setPending] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [status, setStatus] = useState({ text: '', count: 0 })
  const focusNext = useRef<string | null>(null)

  // After a removal, focus moves to the row that took its place (or the add box).
  useEffect(() => {
    if (!focusNext.current) return
    document.getElementById(focusNext.current)?.focus()
    focusNext.current = null
  }, [rows])

  const rowId = (index: number) => `${id}-item-${index}`
  const addId = `${id}-add`
  const announce = (text: string) => setStatus((s) => ({ text, count: s.count + 1 }))

  const emit = (nextRows: string[], nextPending: string) => {
    const waiting = nextPending.trim()
    onChange(
      clean(nextRows),
      waiting ? `Press + Add to add “${waiting}” to ${label}, or clear the box.` : undefined,
    )
  }

  /** Adds new items, skipping ones already in the list. */
  const addItems = (candidates: string[]) => {
    const next = [...rows]
    const skipped: string[] = []
    for (const item of candidates) {
      if (next.some((row) => same(row, item))) skipped.push(item)
      else next.push(item)
    }
    const added = candidates.length - skipped.length
    setRows(next)
    setPending('')
    emit(next, '')
    setNote(skipped.length > 0 ? `Already in the list: ${skipped.join(', ')}.` : null)
    const count = clean(next).length
    if (added > 0) {
      const what =
        added === 1
          ? `Added ${candidates.find((c) => !skipped.includes(c))}`
          : `Added ${added} items`
      announce(`${what}. ${count} ${count === 1 ? 'item' : 'items'} in ${label}.`)
    } else if (skipped.length > 0) {
      announce(`Already in the list: ${skipped.join(', ')}.`)
    }
  }

  const add = () => {
    const text = pending.trim()
    if (text === '') return
    addItems(linesToList(text))
  }

  const onAddKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault() // add the item instead of submitting the form
    add()
  }

  const onAddPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (!/[\r\n]/.test(text)) return // a single line pastes into the box as usual
    event.preventDefault()
    addItems(linesToList(text.replace(/\r/g, '')))
  }

  const editRow = (index: number, value: string) => {
    const next = rows.map((row, i) => (i === index ? value : row))
    setRows(next)
    emit(next, pending)
  }

  const removeRow = (index: number) => {
    const removed = rows[index].trim()
    const next = rows.filter((_, i) => i !== index)
    focusNext.current = next.length === 0 ? addId : rowId(Math.min(index, next.length - 1))
    setRows(next)
    emit(next, pending)
    const count = clean(next).length
    announce(
      `Removed ${removed || 'an empty item'}. ${count} ${count === 1 ? 'item' : 'items'} left.`,
    )
  }

  /** An emptied row disappears once the user moves on from it. */
  const dropIfEmpty = (index: number) => {
    if (rows[index].trim() !== '') return
    const next = rows.filter((_, i) => i !== index)
    setRows(next)
    emit(next, pending)
  }

  return (
    <div className="list-editor">
      {rows.length > 0 ? (
        <ul className="list-rows">
          {rows.map((row, index) => (
            <li key={index}>
              <input
                id={rowId(index)}
                value={row}
                aria-label={`${label}, item ${index + 1} of ${rows.length}`}
                onChange={(e) => editRow(index, e.target.value)}
                onBlur={() => dropIfEmpty(index)}
              />
              <button
                type="button"
                aria-label={`Remove ${row.trim() || 'empty item'} from ${label}`}
                onClick={() => removeRow(index)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">None yet.</p>
      )}
      <div className="list-add">
        <label htmlFor={addId}>Add to {label}</label>
        <input
          id={addId}
          value={pending}
          onChange={(e) => {
            setPending(e.target.value)
            setNote(null)
            emit(rows, e.target.value)
          }}
          onKeyDown={onAddKey}
          onPaste={onAddPaste}
          aria-describedby={[`${id}-how`, note ? `${id}-note` : '', describedBy ?? '']
            .filter(Boolean)
            .join(' ')}
        />
        <button type="button" onClick={add}>
          + Add
        </button>
      </div>
      <p id={`${id}-how`} className="hint">
        Press Enter or + Add. Pasting several lines adds each one.
      </p>
      {note && (
        <p id={`${id}-note`} className="hint">
          {note}
        </p>
      )}
      <div role="status" className="visually-hidden">
        <span key={status.count}>{status.text}</span>
      </div>
    </div>
  )
}
