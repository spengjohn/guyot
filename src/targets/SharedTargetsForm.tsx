import { useState, type FormEvent } from 'react'
import { useAnnounce } from '../app/announce'
import { useRepoWrite } from '../app/repoContext'
import { SHARED_TARGETS_ID } from '../data/constants'
import type { LiveRecord } from '../data/types/record'
import type { SharedTargetsData } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'
import { FieldControl } from '../fields/FieldControl'
import { saveRequest } from '../forms/editModel'
import { ChangesNotice, ConflictList, ErrorSummary } from '../forms/FormParts'
import { useEditForm } from '../forms/useEditForm'
import { formatMoment } from '../ui/dates'
import type { SavedSharedTargets } from './targetsForm'

type Shared = LiveRecord<SharedTargetsData>

interface Props {
  /** The shared targets as saved now (updates when another tab saves them). */
  latest: Shared
  fields: readonly FieldSpec[]
}

/**
 * The one shared-targets record, edited in place on the page. It uses the same edit
 * tracking as the dialogs (docs/decisions/0014). After a save, the saved record becomes
 * the form's new starting point, so its own save isn't reported as "saved elsewhere".
 */
export function SharedTargetsForm({ latest, fields }: Props) {
  const write = useRepoWrite()
  const announce = useAnnounce()
  const [opened, setOpened] = useState<Shared>(latest)
  const form = useEditForm<SavedSharedTargets>({
    table: 'sharedTargets',
    recordName: 'shared targets record',
    fields,
    opened,
    latest,
    defaults: opened,
  })
  const hasEdits = Object.keys(form.edits).length > 0

  const save = async (event: FormEvent) => {
    event.preventDefault()
    let saved: Shared | undefined
    const ok = await form.submit(async () => {
      saved = await write(async (repo) => {
        const stored = await repo.getSharedTargets()
        const { changes, expected } = saveRequest(fields, form.edits, stored)
        if (Object.keys(changes).length === 0) return stored
        return repo.update(
          'sharedTargets',
          SHARED_TARGETS_ID,
          changes as Partial<SharedTargetsData>,
          {
            expected,
          },
        )
      })
    })
    if (ok && saved) {
      setOpened(saved)
      form.reset()
      announce('Saved shared targets.')
    }
  }

  const discard = () => {
    form.reset()
    announce('Your unsaved changes to shared targets were discarded.')
  }

  const titleId = `${form.id}-title`
  return (
    <section aria-labelledby={titleId} className="panel">
      <h2 id={titleId}>Shared targets</h2>
      <p className="hint">
        Used by every active profile, unless a profile overrides them.{' '}
        {latest.updatedAt > 0 ? `Last updated ${formatMoment(latest.updatedAt)}.` : 'Not set yet.'}
      </p>
      <form onSubmit={save} noValidate aria-labelledby={titleId}>
        <ChangesNotice form={form} deletedText="" />
        <ConflictList form={form} />
        <ErrorSummary form={form} />
        {fields.map((field) => (
          <FieldControl key={form.keyOf(field)} {...form.fieldProps(field)} />
        ))}
        <div className="actions">
          <button type="submit" id={form.saveButtonId} className="primary">
            {form.saving ? 'Saving…' : 'Save shared targets'}
          </button>
          {hasEdits && (
            <button type="button" onClick={discard}>
              Discard changes
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
