import { useEffect, useRef, useState } from 'react'
import { useAnnounce } from '../app/announce'
import { Page } from '../app/Page'
import { useRepoQuery, useRepoWrite } from '../app/repoContext'
import { hrefFor } from '../app/routes'
import { APPLICATION_FIELDS, APPLICATION_HIDDEN_BY_DEFAULT } from '../data/builtinFields'
import type { Repo } from '../data/repo'
import type { Uuid } from '../data/types/core'
import type { LiveRecord } from '../data/types/record'
import type { ApplicationData, LocalSettings } from '../data/types/tables'
import {
  builtinSpec,
  customSpec,
  findLayout,
  resolveColumns,
  toLayout,
  withLayout,
  type Column,
} from '../fields/columns'
import { ApplicationDialog } from '../tracker/ApplicationDialog'
import { ApplicationsTable } from '../tracker/ApplicationsTable'
import { ColumnPicker } from '../tracker/ColumnPicker'
import { describeApplication, editButtonId } from '../tracker/describe'

type Application = LiveRecord<ApplicationData>
const SCOPE = { table: 'applications' } as const

/** Defined outside the component, so its identity never changes (see useRepoQuery). */
async function loadTracker(repo: Repo) {
  const [applications, deleted, definitions, settings] = await Promise.all([
    repo.list('applications'),
    repo.listDeleted('applications'),
    repo.list('fieldDefinitions'),
    repo.getLocalSettings(),
  ])
  const custom = definitions
    .filter((def) => def.scope.table === 'applications')
    .map((def) => customSpec(def.id, def))
  return {
    applications: [...applications].sort(newestFirst),
    deletedCount: deleted.length,
    fields: [...APPLICATION_FIELDS.map(builtinSpec), ...custom],
    settings,
  }
}

/** Newest Date Applied first (no date last), then newest Role ID. */
function newestFirst(a: Application, b: Application): number {
  const dayA = a.dateApplied ?? ''
  const dayB = b.dateApplied ?? ''
  if (dayA !== dayB) return dayA < dayB ? 1 : -1
  return a.roleId < b.roleId ? 1 : a.roleId > b.roleId ? -1 : 0
}

/** For editing, the record as it was when Edit was pressed; the form compares later saves with it. */
type Dialog = { mode: 'add' } | { mode: 'edit'; record: Application } | null
interface Notice {
  text: string
  changeId: Uuid
  recordId: Uuid
  name: string
}

const UNDO_BUTTON_ID = 'undo-delete'
const ADD_BUTTON_ID = 'add-application'

export function TrackerPage() {
  const query = useRepoQuery(loadTracker)
  const write = useRepoWrite()
  const announce = useAnnounce()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [columnChoice, setColumnChoice] = useState<{
    settings: LocalSettings
    columns: Column[]
  } | null>(null)
  const pendingFocus = useRef<string | null>(null)

  // After a delete or undo, focus goes to a button that appears once the page updates.
  useEffect(() => {
    if (!pendingFocus.current) return
    const target = document.getElementById(pendingFocus.current)
    if (target) {
      target.focus()
      pendingFocus.current = null
    }
  }, [query, notice])

  if (query.status === 'loading') {
    return (
      <Page title="Applications">
        <p>Loading…</p>
      </Page>
    )
  }
  if (query.status === 'error') {
    return (
      <Page title="Applications">
        <p role="alert">Couldn't load your applications: {String(query.error)}</p>
      </Page>
    )
  }
  const { applications, deletedCount, fields, settings } = query.data

  // A column change shows at once, before its save finishes. It stands only while the
  // settings it was made on are current: once settings load again (after this save, or
  // after another tab saved a layout), the saved layout is used.
  const choice = columnChoice?.settings === settings ? columnChoice.columns : null
  const layout = choice ? toLayout(SCOPE, choice) : findLayout(settings, SCOPE)
  const columns = resolveColumns(layout, fields, APPLICATION_HIDDEN_BY_DEFAULT)

  const changeColumns = (next: Column[]) => {
    setColumnChoice({ settings, columns: next })
    write((r) => r.saveLocalSettings(withLayout(settings, toLayout(SCOPE, next)))).catch(() => {
      announce("Couldn't save the column layout on this device.")
    })
  }

  const remove = async (app: Application) => {
    const name = describeApplication(app)
    try {
      const changeId = await write((r) => r.delete('applications', app.id))
      if (!changeId) return
      setNotice({ text: `Deleted ${name}.`, changeId, recordId: app.id, name })
      pendingFocus.current = UNDO_BUTTON_ID
      announce(`Deleted ${name}. Undo is available.`)
    } catch (error) {
      announce(`Couldn't delete ${name}: ${String(error)}`)
    }
  }

  const undo = async (current: Notice) => {
    try {
      const { skipped } = await write((r) => r.undo(current.changeId))
      setNotice(null)
      if (skipped.length > 0) {
        announce(`Couldn't undo: ${current.name} was changed since it was deleted.`)
        pendingFocus.current = ADD_BUTTON_ID
      } else {
        announce(`Restored ${current.name}.`)
        pendingFocus.current = editButtonId({ id: current.recordId })
      }
    } catch (error) {
      announce(`Couldn't undo: ${String(error)}`)
    }
  }

  const dismiss = () => {
    setNotice(null)
    pendingFocus.current = ADD_BUTTON_ID
  }

  // The record as saved now; null once it's deleted (here or elsewhere) while the form is open.
  const latest =
    dialog?.mode === 'edit' ? (applications.find((a) => a.id === dialog.record.id) ?? null) : null

  return (
    <Page title="Applications">
      <div className="toolbar">
        <button
          type="button"
          id={ADD_BUTTON_ID}
          className="primary"
          onClick={() => setDialog({ mode: 'add' })}
        >
          Add application
        </button>
        <ColumnPicker columns={columns} onChange={changeColumns} />
        <a href={hrefFor({ page: 'deleted' })}>Recently deleted ({deletedCount})</a>
      </div>

      {notice && (
        <div className="notice">
          <p>{notice.text}</p>
          <button
            type="button"
            id={UNDO_BUTTON_ID}
            aria-label={`Undo delete of ${notice.name}`}
            onClick={() => undo(notice)}
          >
            Undo
          </button>
          <button type="button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}

      {applications.length === 0 ? (
        <p>No applications yet. Use Add application to record one.</p>
      ) : (
        <ApplicationsTable
          applications={applications}
          columns={columns}
          onEdit={(app) => setDialog({ mode: 'edit', record: app })}
          onDelete={remove}
        />
      )}

      {dialog && (
        <ApplicationDialog
          key={dialog.mode === 'edit' ? dialog.record.id : 'add'}
          opened={dialog.mode === 'edit' ? dialog.record : null}
          latest={latest}
          fields={fields.filter((f) => !f.readOnly)}
          onClose={() => setDialog(null)}
        />
      )}
    </Page>
  )
}
