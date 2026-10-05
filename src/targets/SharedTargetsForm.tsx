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
import { CollapsibleField, ExpandControls } from '../forms/CollapsibleField'
import { previewOf } from '../forms/preview'
import { useEditForm } from '../forms/useEditForm'
import { useOpenSet } from '../forms/useOpenSet'
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
  // Every field starts collapsed; Expand all opens them. Fields needing attention stay open.
  const rows = useOpenSet(() => [])
  // Bumped after Save or Discard, so inputs that keep their own text start fresh.
  const [version, setVersion] = useState(0)

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
      setVersion((v) => v + 1)
      announce('Saved shared targets.')
    }
  }

  const discard = () => {
    form.reset()
    setVersion((v) => v + 1)
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
        <ExpandControls
          count={fields.length}
          what="shared targets"
          onExpand={() => rows.openAll(fields.map((f) => f.key))}
          onCollapse={rows.closeAll}
        />
        <div className="field-grid">
          {fields.map((field) => (
            <CollapsibleField
              key={field.key}
              label={field.label}
              preview={previewOf(field, form.stateOf(field).value)}
              open={rows.isOpen(field.key)}
              onToggle={(open) => rows.setOpen(field.key, open)}
              attention={form.needsAttention(field)}
            >
              <FieldControl key={`${form.keyOf(field)}#${version}`} {...form.fieldProps(field)} />
            </CollapsibleField>
          ))}
        </div>
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
