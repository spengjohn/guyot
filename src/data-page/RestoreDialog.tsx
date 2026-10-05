import { useEffect, useRef, useState } from 'react'
import { useAnnounce } from '../app/announce'
import { useRepo, useRepoWrite } from '../app/repoContext'
import type { BackupInfo } from '../data/backup'
import type { RestoreSummary } from '../data/restore'
import { formatMoment } from '../ui/dates'

type Preview =
  | { status: 'loading' }
  | { status: 'ready'; summary: RestoreSummary }
  | { status: 'error'; message: string }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** "3 records" / "1 record" */
const records = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`

/**
 * Confirms a restore, showing what it will change first (docs/decisions/0015). Focus
 * starts on Cancel: the safe choice for an action that changes everything.
 */
export function RestoreDialog({ backup, onClose }: { backup: BackupInfo; onClose: () => void }) {
  const repo = useRepo()
  const write = useRepoWrite()
  const announce = useAnnounce()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [opener] = useState(() => document.activeElement)
  const [preview, setPreview] = useState<Preview>({ status: 'loading' })
  const [failure, setFailure] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    let current = true
    repo.previewRestore(backup.id).then(
      (summary) => current && setPreview({ status: 'ready', summary }),
      (error: unknown) => current && setPreview({ status: 'error', message: messageOf(error) }),
    )
    return () => {
      current = false
    }
  }, [repo, backup.id])

  const restore = async () => {
    if (restoring || preview.status !== 'ready') return // aria-disabled doesn't block clicks
    setRestoring(true)
    setFailure(null)
    try {
      const outcome = await write((r) => r.restoreBackup(backup.id))
      announce(
        `Restored the backup from ${formatMoment(backup.createdAt)}: ${records(outcome.changed)} changed, ` +
          `${records(outcome.movedToDeleted)} moved to Recently deleted` +
          (outcome.cannotRestore
            ? `, ${records(outcome.cannotRestore)} could not be restored`
            : '') +
          '. A backup of your data from just before was saved.',
      )
      dialogRef.current?.close()
    } catch (error) {
      setFailure(`Nothing was changed. ${messageOf(error)}`)
    } finally {
      setRestoring(false)
    }
  }

  const handleClose = () => {
    onClose()
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="restore-title"
      aria-describedby="restore-what"
      onClose={handleClose}
      className="dialog"
    >
      <h2 id="restore-title">Restore the backup from {formatMoment(backup.createdAt)}?</h2>
      <div id="restore-what">
        <p>Your data will be changed to match this backup ({backup.reason}).</p>
        {preview.status === 'loading' && <p>Checking what would change…</p>}
        {preview.status === 'error' && (
          <p role="alert">This backup can't be restored: {preview.message}</p>
        )}
        {preview.status === 'ready' && (
          <ul>
            <li>{records(preview.summary.changed)} will be changed back.</li>
            <li>
              {records(preview.summary.movedToDeleted)} made since will move to Recently deleted.
            </li>
            {preview.summary.cannotRestore > 0 && (
              <li>
                {records(preview.summary.cannotRestore)} can't come back: they were permanently
                removed.
              </li>
            )}
          </ul>
        )}
        <p>
          A backup of your current data is saved first, so you can undo this by restoring that
          backup.
        </p>
      </div>
      {failure && <p role="alert">{failure}</p>}
      <div className="actions">
        <button
          type="button"
          className="danger"
          onClick={restore}
          aria-disabled={preview.status !== 'ready'}
        >
          {restoring ? 'Restoring…' : 'Restore this backup'}
        </button>
        <button type="button" ref={cancelRef} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}
