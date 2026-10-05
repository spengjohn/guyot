import type { ReactNode } from 'react'
import type { ListOverride } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'
import { FieldValue } from '../fields/FieldValue'
import type { EditValue } from './editModel'
import { OVERWRITE_WARNING, type EditForm } from './useEditForm'

const names = (list: readonly FieldSpec[]) => list.map((f) => f.label).join(', ')

/**
 * What changed elsewhere while the form was open, and the overwrite warning, in a live
 * region. Each form has its own live regions: while a modal dialog is open, the rest of
 * the page (including the app's own live region) is inert, so screen readers ignore it.
 * Also holds the form's quieter messages ("Keeping your Notes…").
 */
export function ChangesNotice({ form, deletedText }: { form: EditForm; deletedText: string }) {
  const { deletedElsewhere, changedElsewhere, conflicts, overwrites, message } = form
  const active = deletedElsewhere || changedElsewhere.length > 0 || overwrites.length > 0
  return (
    <>
      <div role="status" className={active ? 'notice' : ''}>
        {overwrites.length > 0 && (
          <p>
            <strong>
              {OVERWRITE_WARNING} Fields: {names(overwrites)}.
            </strong>
          </p>
        )}
        {deletedElsewhere ? (
          <p>{deletedText}</p>
        ) : changedElsewhere.length > 0 ? (
          <p>
            Saved elsewhere since you opened this form: {names(changedElsewhere)}.{' '}
            {conflicts.length > 0
              ? `${conflicts.length === 1 ? 'One conflicts' : `${conflicts.length} conflict`} with your edits: compare and choose below.`
              : 'The form shows the new values; your own edits are kept.'}
          </p>
        ) : null}
      </div>
      <div role="status" className="visually-hidden">
        <span key={message.count}>{message.text}</span>
      </div>
    </>
  )
}

/** Each conflicting field's two versions side by side, with Keep mine / Use saved. */
export function ConflictList({ form }: { form: EditForm }) {
  const { conflicts, conflictsRef, id, stateOf, keepButtonId, resolve } = form
  if (conflicts.length === 0) return null
  return (
    <section
      ref={conflictsRef}
      tabIndex={-1}
      className="conflicts"
      aria-labelledby={`${id}-conflicts`}
    >
      <h3 id={`${id}-conflicts`}>Changed elsewhere while you were editing</h3>
      <p>
        Compare each version, then choose which one to keep. Keep yours, and saving replaces the
        version saved elsewhere; use the saved one, and your edit is dropped. Nothing is saved until
        you press Save.
      </p>
      {conflicts.map((field) => {
        const conflict = stateOf(field).conflict!
        const headingId = `${id}-conflict-${field.key}`
        return (
          <div key={field.key} role="group" aria-labelledby={headingId} className="conflict">
            <h4 id={headingId}>{field.label}: two versions</h4>
            <dl className="compare">
              <div>
                <dt>Your edit</dt>
                <dd>
                  <CompareValue field={field} value={conflict.yours} />
                </dd>
              </div>
              <div>
                <dt>Saved elsewhere</dt>
                <dd>
                  <CompareValue field={field} value={conflict.saved} />
                </dd>
              </div>
            </dl>
            <div className="actions">
              <button type="button" id={keepButtonId(field)} onClick={() => resolve(field, 'mine')}>
                Keep my {field.label}
              </button>
              <button type="button" onClick={() => resolve(field, 'saved')}>
                Use saved {field.label}
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}

/** The errors that stop a save, in a group that takes focus when they appear. */
export function ErrorSummary({ form }: { form: EditForm }) {
  const { errors, summaryRef, id } = form
  const all = [...errors.general, ...Object.values(errors.byField)]
  if (all.length === 0) return null
  return (
    <div
      ref={summaryRef}
      role="group"
      tabIndex={-1}
      className="error-summary"
      aria-labelledby={`${id}-errors`}
    >
      <h3 id={`${id}-errors`}>Fix {all.length === 1 ? 'this' : 'these'} to save</h3>
      <ul>
        {all.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  )
}

/** A value in the comparison: in full, with empty shown as such. */
function CompareValue({ field, value }: { field: FieldSpec; value: EditValue }): ReactNode {
  if (value === undefined) return <em>(uses the shared value)</em>
  if (value === null || value === '') return <em>(empty)</em>
  if (typeof value === 'object' && 'mode' in value) return <OverrideValue value={value} />
  return <FieldValue field={field} value={value} full />
}

function OverrideValue({ value }: { value: ListOverride }) {
  const verb = value.mode === 'add' ? 'Add to shared' : 'Replace shared with'
  return (
    <>
      {verb}: {value.items.length > 0 ? value.items.join(', ') : <em>(nothing)</em>}
    </>
  )
}
