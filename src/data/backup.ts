import { TABLE_NAMES } from './constants'
import { BACKUPS_STORE, request, transactionDone } from './db'
import { newId } from './ids'
import type { DeviceId, Moment, Uuid } from './types/core'

/** How many automatic backups to keep. Older ones are removed. */
export const KEEP_BACKUPS = 5

/** A full copy of the data at one moment. Stored locally only; never synced or exported. */
export interface Backup {
  id: Uuid
  createdAt: Moment
  reason: string
  schemaVersion: number
  /** The data as an export file (at `schemaVersion`), ready to download. */
  json: string
}

export type BackupInfo = Omit<Backup, 'json'>

/**
 * Copies every record, exactly as stored, into a new backup. Runs in its own
 * transaction so the backup is safely saved before anything risky starts.
 * Only the newest few are kept. `keep` names a backup that must not be pruned, such
 * as the one about to be restored (docs/decisions/0015).
 */
export async function createBackup(
  db: IDBDatabase,
  deviceId: DeviceId,
  schemaVersion: number,
  reason: string,
  at: Moment,
  keep?: Uuid,
): Promise<BackupInfo> {
  const tx = db.transaction([...TABLE_NAMES, BACKUPS_STORE], 'readwrite')
  const done = transactionDone(tx)
  const tables: Record<string, unknown[]> = {}
  for (const table of TABLE_NAMES) tables[table] = await request(tx.objectStore(table).getAll())
  const file = { app: 'guyot', formatVersion: 1, exportedAt: at, deviceId, schemaVersion, tables }
  const backup: Backup = {
    id: newId(),
    createdAt: at,
    reason,
    schemaVersion,
    json: JSON.stringify(file),
  }
  const store = tx.objectStore(BACKUPS_STORE)
  await request(store.put(backup))

  // Keep only the newest few, always including `keep` if it exists.
  const all = (await request(store.getAll())) as Backup[]
  const protectedOne = all.some((b) => b.id === keep)
  const others = all.filter((b) => b.id !== keep).sort((a, b) => b.createdAt - a.createdAt)
  const room = KEEP_BACKUPS - (protectedOne ? 1 : 0)
  for (const old of others.slice(room)) await request(store.delete(old.id))
  await done
  return infoOf(backup)
}

function infoOf({ id, createdAt, reason, schemaVersion }: Backup): BackupInfo {
  return { id, createdAt, reason, schemaVersion }
}

/** Backups, newest first, without their (large) contents. */
export async function listBackups(db: IDBDatabase): Promise<BackupInfo[]> {
  const tx = db.transaction(BACKUPS_STORE, 'readonly')
  const all = (await request(tx.objectStore(BACKUPS_STORE).getAll())) as Backup[]
  return all.sort((a, b) => b.createdAt - a.createdAt).map(infoOf)
}

export async function getBackup(db: IDBDatabase, id: Uuid): Promise<Backup | undefined> {
  const tx = db.transaction(BACKUPS_STORE, 'readonly')
  return (await request(tx.objectStore(BACKUPS_STORE).get(id))) as Backup | undefined
}
