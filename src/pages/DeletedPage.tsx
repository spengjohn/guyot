import { useEffect, useRef } from 'react'
import { useAnnounce } from '../app/announce'
import { Page } from '../app/Page'
import { useRepoQuery, useRepoWrite } from '../app/repoContext'
import { hrefFor } from '../app/routes'
import type { Repo } from '../data/repo'
import type { LiveRecord } from '../data/types/record'
import type { ApplicationData } from '../data/types/tables'
import { describeApplication } from '../tracker/describe'
import { formatMoment } from '../ui/dates'

type Application = LiveRecord<ApplicationData>

/** When it was deleted: the stamp on its `deleted` field. */
const deletedAt = (app: Application) => app.fieldMeta.deleted.updatedAt

async function loadDeleted(repo: Repo) {
  const deleted = await repo.listDeleted('applications')
  return [...deleted].sort((a, b) => deletedAt(b) - deletedAt(a)) // most recent first
}

const restoreButtonId = (app: Application) => `restore-${app.id}`

export function DeletedPage() {
  const query = useRepoQuery(loadDeleted)
  const write = useRepoWrite()
  const announce = useAnnounce()
  // After a restore, focus moves to the row that took its place (or the page heading).
  const pendingFocusIndex = useRef<number | null>(null)

  useEffect(() => {
    if (pendingFocusIndex.current === null || query.status !== 'ready') return
    const rows = query.data
    const index = Math.min(pendingFocusIndex.current, rows.length - 1)
    pendingFocusIndex.current = null
    const target =
      index >= 0
        ? document.getElementById(restoreButtonId(rows[index]))
        : document.querySelector<HTMLElement>('main h1')
    target?.focus()
  }, [query])

  const restore = async (app: Application, index: number) => {
    const name = describeApplication(app)
    try {
      await write((repo) => repo.restore('applications', app.id))
      pendingFocusIndex.current = index
      announce(`Restored ${name}. It's back in the tracker.`)
    } catch (error) {
      announce(`Couldn't restore ${name}: ${String(error)}`)
    }
  }

  return (
    <Page title="Recently deleted">
      <p>
        Deleted applications stay here until you restore them.{' '}
        <a href={hrefFor({ page: 'tracker' })}>Back to applications</a>
      </p>
      {query.status === 'loading' && <p>Loading…</p>}
      {query.status === 'error' && <p role="alert">Couldn't load: {String(query.error)}</p>}
      {query.status === 'ready' && query.data.length === 0 && <p>Nothing has been deleted.</p>}
      {query.status === 'ready' && query.data.length > 0 && (
        <div className="table-wrap" role="region" aria-labelledby="deleted-caption" tabIndex={0}>
          <table>
            <caption id="deleted-caption">
              {query.data.length} deleted {query.data.length === 1 ? 'application' : 'applications'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Role ID</th>
                <th scope="col">Company</th>
                <th scope="col">Role</th>
                <th scope="col">Deleted</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((app, index) => (
                <tr key={app.id}>
                  <th scope="row">{app.roleId}</th>
                  <td>{app.company}</td>
                  <td>{app.role}</td>
                  <td>{formatMoment(deletedAt(app))}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      id={restoreButtonId(app)}
                      aria-label={`Restore ${describeApplication(app)}`}
                      onClick={() => restore(app, index)}
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  )
}
