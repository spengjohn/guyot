import { useEffect, useRef, useState } from 'react'
import { useAnnounce } from '../app/announce'
import { useRepo } from '../app/repoContext'
import type { BackupInfo } from '../data/backup'
import { formatMoment } from '../ui/dates'
import { backupFileName } from '../ui/download'
import { SaveFileForm } from './SaveFileForm'

/** Downloads one backup as a file: encrypted by default (docs/decisions/0016). */
export function BackupDownloadDialog({
  backup,
  onClose,
}: {
  backup: BackupInfo
  onClose: () => void
}) {
  const repo = useRepo()
  const announce = useAnnounce()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [opener] = useState(() => document.activeElement)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const getFile = async () => {
    const full = await repo.getBackup(backup.id)
    if (!full) throw new Error('That backup no longer exists.')
    return { text: full.json, fileName: backupFileName(full.createdAt) }
  }

  const handleClose = () => {
    onClose()
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="backup-download-title"
      onClose={handleClose}
      className="dialog"
    >
      <h2 id="backup-download-title">Download the backup from {formatMoment(backup.createdAt)}</h2>
      <SaveFileForm
        encryptLabel="Download encrypted backup"
        getFile={getFile}
        onSaved={(encrypted) => {
          announce(encrypted ? 'Encrypted backup downloaded.' : 'Unencrypted backup downloaded.')
          dialogRef.current?.close()
        }}
      />
      <div className="actions">
        <button type="button" onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  )
}
