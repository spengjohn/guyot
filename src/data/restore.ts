import { LOG_TABLES, SHARED_TARGETS_ID, TABLE_NAMES } from './constants'
import { jsonEqual } from './merge'
import type { Uuid } from './types/core'
import type { ExportFile, TableName } from './types/tables'
import { SYNC_KEYS } from './validate'

type Obj = Record<string, unknown>
/** A stored record seen as a plain object. */
type Stored = Obj & { id: Uuid; deleted: boolean; purged: boolean }

/** Tables a restore changes. The two logs are history and are left as they are. */
export const RESTORE_TABLES: readonly TableName[] = TABLE_NAMES.filter(
  (table) => !LOG_TABLES.includes(table),
)

export interface RestorePlan {
  /** Records to change back: their data fields (and `deleted`) as in the backup. */
  changes: { table: TableName; id: Uuid; data: Obj }[]
  /** Records created since the backup: moved to Recently deleted. */
  deletions: { table: TableName; id: Uuid }[]
  /** Records in the backup that were permanently removed since: they can't come back. */
  skipped: { table: TableName; id: Uuid }[]
  /** Shared targets weren't in the backup (made after it), so they are reset to empty. */
  resetSharedTargets: boolean
}

export interface RestoreSummary {
  changed: number
  movedToDeleted: number
  cannotRestore: number
}

/** A record's own data, without the sync fields the app manages. */
function dataOf(record: Obj): Obj {
  const data: Obj = {}
  for (const [key, value] of Object.entries(record)) {
    if (!SYNC_KEYS.has(key)) data[key] = value
  }
  return data
}

/**
 * What it takes to make the current data match a backup, as edits (docs/decisions/0015).
 * Pure: reads both inputs, changes neither. `current` holds every stored record per
 * table, including deleted ones and tombstones.
 */
export function planRestore(
  current: Readonly<Partial<Record<TableName, readonly Obj[]>>>,
  backup: ExportFile,
): RestorePlan {
  const plan: RestorePlan = { changes: [], deletions: [], skipped: [], resetSharedTargets: false }
  for (const table of RESTORE_TABLES) {
    const saved = new Map<string, Stored>()
    for (const record of backup.tables[table] as unknown as Stored[]) {
      if (!record.purged) saved.set(record.id, record)
    }
    const seen = new Set<string>()
    for (const record of (current[table] ?? []) as Stored[]) {
      seen.add(record.id)
      const old = saved.get(record.id)
      if (record.purged) {
        if (old) plan.skipped.push({ table, id: record.id }) // purge always wins
        continue
      }
      if (!old) {
        // Made after the backup (or purged before it, which can't still be live).
        if (table === 'sharedTargets' && record.id === SHARED_TARGETS_ID) {
          plan.resetSharedTargets = true
        } else if (!record.deleted) {
          plan.deletions.push({ table, id: record.id })
        }
        continue
      }
      const data = { ...dataOf(old), deleted: old.deleted }
      const now = { ...dataOf(record), deleted: record.deleted }
      if (!jsonEqual(data, now)) plan.changes.push({ table, id: record.id, data })
    }
    // In the backup but not stored at all: can't happen for local backups, since records
    // are never removed without a tombstone. Reported rather than guessed at.
    for (const id of saved.keys()) {
      if (!seen.has(id)) plan.skipped.push({ table, id: id as Uuid })
    }
  }
  return plan
}

export function summarize(plan: RestorePlan): RestoreSummary {
  return {
    changed: plan.changes.length + (plan.resetSharedTargets ? 1 : 0),
    movedToDeleted: plan.deletions.length,
    cannotRestore: plan.skipped.length,
  }
}
