import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useAnnounce } from '../app/announce'
import { Page } from '../app/Page'
import { useRepo, useRepoQuery, useRepoWrite } from '../app/repoContext'
import type { BackupInfo } from '../data/backup'
import {
  checkImport,
  exportData,
  exportFileName,
  exportToJson,
  mergeImport,
  type ImportCheck,
} from '../data/exportImport'
import type { Repo } from '../data/repo'
import { TABLE_LABELS } from '../data/tableLabels'
import type { TableName } from '../data/types/tables'
import { RestoreDialog } from '../data-page/RestoreDialog'
import { formatMoment } from '../ui/dates'
import { backupFileName, downloadText } from '../ui/download'

const loadBackups = (repo: Repo) => repo.listBackups()
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Export, import and the automatic backups, all on this device. */
export function DataPage() {
  const repo = useRepo()
  const write = useRepoWrite()
  const announce = useAnnounce()
  const backups = useRepoQuery(loadBackups)
  const [checked, setChecked] = useState<{ fileName: string; check: ImportCheck } | null>(null)
  const [fileKey, setFileKey] = useState(0) // a new key empties the file input
  const [restoring, setRestoring] = useState<BackupInfo | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  // When a file has been checked, move focus to what it holds (or what's wrong with it).
  useEffect(() => {
    if (checked) resultRef.current?.focus()
  }, [checked])

  const download = async () => {
    try {
      const file = await exportData(repo)
      downloadText(exportToJson(file), exportFileName(file.exportedAt))
      announce('Your data was downloaded.')
    } catch (error) {
      announce(`Couldn't download your data: ${messageOf(error)}`)
    }
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    // file.text() reads the chosen file in the browser; nothing is uploaded.
    const check = await checkImport(repo, await file.text())
    setChecked({ fileName: file.name, check })
  }

  const clearImport = () => {
    setChecked(null)
    setFileKey((k) => k + 1)
  }

  const merge = async () => {
    if (!checked || !checked.check.ok) return
    const { file } = checked.check
    const outcome = await write((r) => mergeImport(r, file))
    if (outcome.ok) {
      const { records, changed, conflicts, renumbered } = outcome.summary
      announce(
        `Imported ${checked.fileName}: ${records} records read, ${changed} changed` +
          (conflicts ? `, ${conflicts} conflicts logged for review` : '') +
          (renumbered ? `, ${renumbered} Role IDs renumbered` : '') +
          '.',
      )
      clearImport()
    } else {
      setChecked({ fileName: checked.fileName, check: outcome })
    }
  }

  const backUpNow = async () => {
    try {
      await write((r) => r.createBackup('Made by you'))
      announce('Backup saved.')
    } catch (error) {
      announce(`Couldn't save a backup: ${messageOf(error)}`)
    }
  }

  const downloadBackup = async (info: BackupInfo) => {
    const backup = await repo.getBackup(info.id)
    if (!backup) return announce('That backup no longer exists.')
    downloadText(backup.json, backupFileName(backup.createdAt))
    announce('Backup downloaded.')
  }

  return (
    <Page title="Your data">
      <p>Everything here stays on this device unless you download it.</p>

      <section aria-labelledby="export-heading" className="panel">
        <h2 id="export-heading">Download a copy</h2>
        <p>
          A file with all your data, including deleted records and change history. It isn't
          encrypted, so keep it somewhere safe. You can import it on another device or browser.
        </p>
        <button type="button" className="primary" onClick={download}>
          Download a copy of your data
        </button>
      </section>

      <section aria-labelledby="import-heading" className="panel">
        <h2 id="import-heading">Import a file</h2>
        <p>
          Merges a Guyot export into your data. Nothing is changed until you confirm, and a file
          with any problem is refused whole.
        </p>
        <div className="field">
          <label htmlFor="import-file">Choose an export file</label>
          <input
            key={fileKey}
            id="import-file"
            type="file"
            accept="application/json,.json"
            onChange={chooseFile}
          />
        </div>
        {checked && (
          <div
            ref={resultRef}
            role="group"
            tabIndex={-1}
            className="import-result"
            aria-labelledby="import-result-heading"
          >
            {checked.check.ok ? (
              <ImportSummary fileName={checked.fileName} check={checked.check} />
            ) : (
              <>
                <h3 id="import-result-heading">Nothing was imported</h3>
                <p>{checked.fileName} has problems:</p>
                <ul>
                  {checked.check.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="actions">
              {checked.check.ok && (
                <button type="button" className="primary" onClick={merge}>
                  Merge into my data
                </button>
              )}
              <button type="button" onClick={clearImport}>
                {checked.check.ok ? 'Cancel' : 'Choose another file'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="backups-heading" className="panel">
        <h2 id="backups-heading">Backups</h2>
        <p>
          Saved automatically on this device before upgrades and restores; the newest five are kept.
        </p>
        <div className="toolbar">
          <button type="button" onClick={backUpNow}>
            Back up now
          </button>
        </div>
        {backups.status === 'loading' && <p>Loading…</p>}
        {backups.status === 'error' && <p role="alert">{messageOf(backups.error)}</p>}
        {backups.status === 'ready' && backups.data.length === 0 && <p>No backups yet.</p>}
        {backups.status === 'ready' && backups.data.length > 0 && (
          <div className="table-wrap" role="region" aria-labelledby="backups-caption" tabIndex={0}>
            <table>
              <caption id="backups-caption">
                {backups.data.length} {backups.data.length === 1 ? 'backup' : 'backups'}, newest
                first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Made</th>
                  <th scope="col">Why</th>
                  <th scope="col">Format</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {backups.data.map((backup) => {
                  const when = formatMoment(backup.createdAt)
                  return (
                    <tr key={backup.id}>
                      <th scope="row">{when}</th>
                      <td>{backup.reason}</td>
                      <td>{backup.schemaVersion}</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          aria-label={`Download the backup from ${when}`}
                          onClick={() => downloadBackup(backup)}
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          aria-label={`Restore the backup from ${when}…`}
                          onClick={() => setRestoring(backup)}
                        >
                          Restore…
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {restoring && <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} />}
    </Page>
  )
}

function ImportSummary({
  fileName,
  check,
}: {
  fileName: string
  check: Extract<ImportCheck, { ok: true }>
}) {
  const { preview, warnings } = check
  const counts = Object.entries(preview.counts) as [TableName, number][]
  return (
    <>
      <h3 id="import-result-heading">Ready to import {fileName}</h3>
      <dl className="facts">
        <div>
          <dt>Exported</dt>
          <dd>{formatMoment(preview.exportedAt)}</dd>
        </div>
        <div>
          <dt>From device</dt>
          <dd>{preview.deviceId.slice(0, 8)}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>
            {preview.schemaVersion}
            {preview.schemaVersion !== check.file.schemaVersion &&
              ` (upgraded to ${check.file.schemaVersion})`}
          </dd>
        </div>
      </dl>
      {counts.length > 0 ? (
        <ul>
          {counts.map(([table, count]) => (
            <li key={table}>
              {TABLE_LABELS[table]}: {count}
            </li>
          ))}
        </ul>
      ) : (
        <p>The file holds no records (apart from history).</p>
      )}
      {warnings.length > 0 && (
        <>
          <p>Kept, but worth a look:</p>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">
        Records you also have are merged field by field: the newer edit wins, and the other value
        goes to the conflict log.
      </p>
    </>
  )
}
