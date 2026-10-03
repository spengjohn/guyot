import { createBackup } from './backup'
import { SCHEMA_VERSION, TABLE_NAMES } from './constants'
import { META_STORE, request, transactionDone } from './db'
import { defaultStamp } from './stamp'
import { now } from './time'
import type { DeviceId, Moment, Uuid } from './types/core'
import type { FieldDefinitionData } from './types/fields'
import type { FieldMeta } from './types/record'
import type { Meta, TableName } from './types/tables'
import { validateRecord } from './validate'

type Obj = Record<string, unknown>

/** Upgrades one live record from version N to N+1. Use addField for new fields. */
export type Migration = (record: Obj, table: TableName, deviceId: DeviceId) => Obj
export type Migrations = Readonly<Record<number, Migration>>

/**
 * The upgrade steps, keyed by the version each one upgrades FROM.
 * To change the record format: add a step here, bump SCHEMA_VERSION, and update the
 * types and validation to match. None yet: version 1 is the first.
 */
export const MIGRATIONS: Migrations = {}

/** Thrown when stored data is newer than this app. An old app must not rewrite it. */
export class NewerDataError extends Error {
  constructor(version: number) {
    super(
      `Your data was saved by a newer version of Guyot (format ${version}). Reload to update the app.`,
    )
    this.name = 'NewerDataError'
  }
}

/**
 * Adds a new field with a default value, stamped 0 so it never beats a real edit
 * made on another device (integrity rule 7).
 */
export function addField(record: Obj, key: string, value: unknown, deviceId: DeviceId): Obj {
  const fieldMeta: FieldMeta = { ...(record.fieldMeta as FieldMeta), [key]: defaultStamp(deviceId) }
  return { ...record, [key]: value, fieldMeta }
}

/** True if there is an upgrade path from `version` to the current version. */
export function canUpgrade(version: number, migrations: Migrations = MIGRATIONS): boolean {
  for (let v = version; v < SCHEMA_VERSION; v++) if (!migrations[v]) return false
  return true
}

/** Upgrades one record to the current version. Tombstones have no data, so only their version changes. */
export function migrateRecord(
  record: Obj,
  table: TableName,
  deviceId: DeviceId,
  migrations: Migrations = MIGRATIONS,
): Obj {
  let current = structuredClone(record)
  while ((current.schemaVersion as number) < SCHEMA_VERSION) {
    const from = current.schemaVersion as number
    const step = migrations[from]
    if (!step) throw new Error(`No upgrade from format version ${from}`)
    if (current.purged !== true) current = step(current, table, deviceId)
    current = { ...current, schemaVersion: from + 1 }
  }
  return current
}

export interface MigrationResult {
  from: number
  backupId: Uuid
}

/**
 * Brings stored data up to the current version if needed. Saves a backup first, in its
 * own transaction, then upgrades and validates every record in one transaction: if
 * anything fails, nothing changes and the backup remains. Returns null if no upgrade was needed.
 */
export async function migrateDatabase(
  db: IDBDatabase,
  options: { migrations?: Migrations; clock?: () => Moment } = {},
): Promise<MigrationResult | null> {
  const migrations = options.migrations ?? MIGRATIONS
  const meta = await readMeta(db)
  const from = meta.schemaVersion
  if (from > SCHEMA_VERSION) throw new NewerDataError(from)
  if (from === SCHEMA_VERSION) return null
  if (!canUpgrade(from, migrations)) throw new Error(`No upgrade from format version ${from}`)

  const at = (options.clock ?? now)()
  const reason = `Before upgrading from format ${from} to ${SCHEMA_VERSION}`
  const backup = await createBackup(db, meta.deviceId, from, reason, at)

  const tx = db.transaction([...TABLE_NAMES, META_STORE], 'readwrite')
  const done = transactionDone(tx)
  done.catch(() => {}) // handled below
  try {
    const upgraded: { table: TableName; record: Obj }[] = []
    for (const table of TABLE_NAMES) {
      for (const record of (await request(tx.objectStore(table).getAll())) as Obj[]) {
        upgraded.push({ table, record: migrateRecord(record, table, meta.deviceId, migrations) })
      }
    }
    // Check everything against the new format before writing anything.
    const customFields = new Map<string, FieldDefinitionData>()
    for (const { table, record } of upgraded) {
      if (table === 'fieldDefinitions' && record.purged === false) {
        customFields.set(record.id as string, record as unknown as FieldDefinitionData)
      }
    }
    for (const { table, record } of upgraded) {
      const report = validateRecord(table, record, { customFields })
      if (report.errors.length > 0) {
        throw new Error(`The upgrade produced invalid data: ${report.errors[0]}`)
      }
    }
    for (const { table, record } of upgraded) await request(tx.objectStore(table).put(record))
    const next: Meta = { ...meta, schemaVersion: SCHEMA_VERSION, lastBackupAt: at }
    await request(tx.objectStore(META_STORE).put(next, 'meta'))
    await done
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // already finished
    }
    throw error
  }
  return { from, backupId: backup.id }
}

/**
 * Upgrades an older export file's records in memory so it can be imported.
 * Files that are current, newer, or not files at all are returned unchanged for
 * validation to judge.
 */
export function upgradeFile(input: unknown, migrations: Migrations = MIGRATIONS): unknown {
  if (typeof input !== 'object' || input === null) return input
  const file = input as Obj
  const version = file.schemaVersion
  if (typeof version !== 'number' || version >= SCHEMA_VERSION) return input
  if (!canUpgrade(version, migrations) || typeof file.tables !== 'object' || !file.tables) {
    return input
  }
  const tables: Record<string, unknown> = { ...(file.tables as Obj) }
  for (const table of TABLE_NAMES) {
    const records = tables[table]
    if (!Array.isArray(records)) continue
    tables[table] = records.map((record) =>
      typeof record === 'object' && record !== null
        ? migrateRecord(record as Obj, table, file.deviceId as DeviceId, migrations)
        : record,
    )
  }
  return { ...file, schemaVersion: SCHEMA_VERSION, tables }
}

async function readMeta(db: IDBDatabase): Promise<Meta> {
  const tx = db.transaction(META_STORE, 'readonly')
  return (await request(tx.objectStore(META_STORE).get('meta'))) as Meta
}
