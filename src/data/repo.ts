import {
  LOG_TABLES,
  ROLE_ID_TABLES,
  SCHEMA_VERSION,
  SHARED_TARGETS_ID,
  TABLE_NAMES,
} from './constants'
import { getBackup, listBackups, type Backup, type BackupInfo } from './backup'
import { META_STORE, openDatabase, request, SETTINGS_STORE, transactionDone } from './db'
import { migrateDatabase, type Migrations } from './migrate'
import { emptyLocalSettings, emptySharedTargets } from './defaults'
import { deterministicId, formatRoleId, newId, roleNumber } from './ids'
import { getValue, jsonEqual, mergeRecords, type ConflictDraft } from './merge'
import { compareStamps, defaultStamp, sameStamp, stampEdit } from './stamp'
import { now } from './time'
import type { DeviceId, JsonValue, Moment, RoleId, Uuid } from './types/core'
import type { FieldDefinitionData } from './types/fields'
import type {
  FieldMeta,
  FieldStamp,
  LiveRecord,
  StampRef,
  StoredRecord,
  SyncFields,
} from './types/record'
import type {
  ChangeAction,
  ChangeLogData,
  ConflictLogData,
  LocalSettings,
  Meta,
  RecordOf,
  SharedTargetsData,
  TableName,
  Tables,
} from './types/tables'
import {
  mapFieldsOf,
  SYNC_KEYS,
  validateLocalSettings,
  validateRecord,
  type ValidationContext,
} from './validate'

/** Tables the user edits directly: everything except the two logs. */
export type DataTable = Exclude<TableName, 'changeLog' | 'conflictLog'>
type Live<T extends TableName> = LiveRecord<Tables[T]>

/** Who made a change. AI changes also say which stage made them. */
export interface WriteOptions {
  appliedBy?: 'user' | 'ai' | 'import'
  stageId?: Uuid | null
}

export interface MergeOutcome<T extends TableName> {
  record: RecordOf<T>
  changed: boolean
  conflicts: number
}

export interface MergeSummary {
  records: number
  changed: number
  conflicts: number // new conflict log entries
  renumbered: number // postings (with their rows) moved to a new Role ID
}

/** Thrown when a write fails validation. Nothing is saved. */
export class ValidationError extends Error {
  readonly errors: string[]
  constructor(errors: string[]) {
    super(`Invalid data: ${errors[0] ?? 'unknown problem'}`)
    this.name = 'ValidationError'
    this.errors = errors
  }
}

/**
 * Thrown when an update says which stamps it expects and a field has changed since
 * (in another tab, or merged from another device). Nothing is saved. See docs/decisions/0014.
 */
export class StaleEditError extends Error {
  readonly fieldKeys: string[]
  constructor(fieldKeys: string[]) {
    super(`Changed since you started editing: ${fieldKeys.join(', ')}`)
    this.name = 'StaleEditError'
    this.fieldKeys = fieldKeys
  }
}

/**
 * For each field (fieldMeta key) an update may touch, the stamp it must still have,
 * or null if the field must still have no stamp. A touched field not listed is stale.
 */
export type ExpectedStamps = Record<string, StampRef | null>

type Obj = Record<string, unknown>
/** A stored record seen as a plain object, for code that works on any table. */
type Stored = Obj & SyncFields & { purged: boolean }

const META_KEY = 'meta'
const SETTINGS_KEY = 'local'

/**
 * All reads and writes of synced records. Every write is stamped, validated and
 * logged inside one IndexedDB transaction, so it either fully happens or not at all.
 */
export class Repo {
  readonly deviceId: DeviceId
  private readonly db: IDBDatabase
  private readonly clock: () => Moment

  private constructor(db: IDBDatabase, deviceId: DeviceId, clock: () => Moment) {
    this.db = db
    this.deviceId = deviceId
    this.clock = clock
  }

  /**
   * Opens the database, creating this device's ID on first run, and upgrades older
   * data (after a backup). Refuses data saved by a newer version of the app.
   * `clock` and `migrations` are for tests.
   */
  static async open(
    options: { name?: string; clock?: () => Moment; migrations?: Migrations } = {},
  ): Promise<Repo> {
    const clock = options.clock ?? now
    const db = await openDatabase(options.name)
    try {
      const meta = await inTransaction(db, [META_STORE], async (tx) => {
        const store = tx.objectStore(META_STORE)
        const existing = (await request(store.get(META_KEY))) as Meta | undefined
        if (existing) return existing
        const created: Meta = {
          deviceId: crypto.randomUUID() as DeviceId,
          schemaVersion: SCHEMA_VERSION,
          nextRoleNumber: 1,
          lastBackupAt: null,
        }
        await request(store.put(created, META_KEY))
        return created
      })
      await migrateDatabase(db, { migrations: options.migrations, clock })
      return new Repo(db, meta.deviceId, clock)
    } catch (error) {
      db.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  /** The IndexedDB database's name. Tabs with the same name share the same data. */
  get databaseName(): string {
    return this.db.name
  }

  /** Automatic local backups, newest first. */
  listBackups(): Promise<BackupInfo[]> {
    return listBackups(this.db)
  }

  /** One backup, including its data as export-file JSON (for download). */
  getBackup(id: Uuid): Promise<Backup | undefined> {
    return getBackup(this.db, id)
  }

  // ---------- Local settings ----------

  /**
   * This device's settings, such as column layouts. Local only: never synced or exported.
   * Missing or damaged settings fall back to the defaults; they are preferences, not data.
   */
  async getLocalSettings(): Promise<LocalSettings> {
    const tx = this.db.transaction(SETTINGS_STORE, 'readonly')
    const stored: unknown = await request(tx.objectStore(SETTINGS_STORE).get(SETTINGS_KEY))
    if (stored === undefined || validateLocalSettings(stored).length > 0) {
      return emptyLocalSettings()
    }
    return stored as LocalSettings // checked just above
  }

  /** Saves this device's settings after validating them. */
  async saveLocalSettings(settings: LocalSettings): Promise<void> {
    const errors = validateLocalSettings(settings)
    if (errors.length > 0) throw new ValidationError(errors)
    await inTransaction(this.db, [SETTINGS_STORE], async (tx) => {
      await request(tx.objectStore(SETTINGS_STORE).put(structuredClone(settings), SETTINGS_KEY))
    })
  }

  // ---------- Reading ----------

  /** Any stored record by ID, including deleted ones and tombstones. */
  async get<T extends TableName>(table: T, id: Uuid): Promise<RecordOf<T> | undefined> {
    const tx = this.db.transaction(table, 'readonly')
    return (await request(tx.objectStore(table).get(id))) as RecordOf<T> | undefined
  }

  /** Records that are not deleted. */
  async list<T extends TableName>(table: T): Promise<Live<T>[]> {
    const all = await this.getAll(table)
    return all.filter((r): r is Live<T> => !r.purged && !r.deleted)
  }

  /** Deleted records that can still be restored (the "recently deleted" view). */
  async listDeleted<T extends DataTable>(table: T): Promise<Live<T>[]> {
    const all = await this.getAll(table)
    return all.filter((r): r is Live<T> => !r.purged && r.deleted)
  }

  private async getAll<T extends TableName>(table: T): Promise<RecordOf<T>[]> {
    const tx = this.db.transaction(table, 'readonly')
    return (await request(tx.objectStore(table).getAll())) as RecordOf<T>[]
  }

  // ---------- Writing ----------

  /**
   * Creates a record. With `assignRoleId`, the record gets the next free Role ID in the
   * same transaction, so a create that fails validation doesn't use up a number.
   */
  async create<T extends DataTable>(
    table: T,
    data: Tables[T],
    options: WriteOptions & { assignRoleId?: boolean } = {},
  ): Promise<Live<T>> {
    assertDataTable(table)
    if (table === 'sharedTargets') {
      throw new Error('There is only one shared-targets record; use getSharedTargets().')
    }
    assertNoSyncKeys(data as Obj)
    if (options.assignRoleId && !ROLE_ID_TABLES.includes(table)) {
      throw new Error(`${table} records have no Role ID`)
    }
    return this.write(async (tx, ctx) => {
      let fields = data as Obj
      if (options.assignRoleId) {
        const store = tx.objectStore(META_STORE)
        const meta = (await request(store.get(META_KEY))) as Meta
        fields = { ...fields, roleId: formatRoleId(meta.nextRoleNumber) }
        await request(store.put({ ...meta, nextRoleNumber: meta.nextRoleNumber + 1 }, META_KEY))
      }
      const at = this.clock()
      const stamp = stampEdit(undefined, this.deviceId, at)
      const record = buildRecord(newId(), fields, stamp, mapFieldsOf(table))
      await save(tx, table, record, ctx)
      const keys = Object.keys(record.fieldMeta)
      await this.logChange(tx, ctx, table, record, 'create', keys, {}, at, options)
      return record as unknown as Live<T>
    })
  }

  /**
   * Changes some fields. Only fields whose value actually changes get a new stamp.
   * For map-like fields (such as `custom`), pass the whole new map; entries are compared one by one.
   * With `expected`, every field that would change must still have the stamp the caller
   * saw; otherwise nothing is saved and StaleEditError says which fields changed since.
   */
  async update<T extends DataTable>(
    table: T,
    id: Uuid,
    changes: Partial<Tables[T]>,
    options: WriteOptions & { expected?: ExpectedStamps } = {},
  ): Promise<Live<T>> {
    assertDataTable(table)
    assertNoSyncKeys(changes as Obj)
    const { record } = await this.write((tx, ctx) =>
      this.change(tx, ctx, table, id, changes as Obj, 'update', options, false, options.expected),
    )
    return record as unknown as Live<T> // validated for this table before saving
  }

  /**
   * Soft delete: the record moves to "recently deleted" and can be restored.
   * Returns the change log ID (for undo), or null if it was already deleted.
   */
  async delete(table: DataTable, id: Uuid, options: WriteOptions = {}): Promise<Uuid | null> {
    assertDataTable(table)
    if (table === 'sharedTargets') throw new Error('Shared targets can be reset, not deleted.')
    const { changeId } = await this.write((tx, ctx) =>
      this.change(tx, ctx, table, id, { deleted: true }, 'delete', options),
    )
    return changeId
  }

  /** Brings a deleted record back. Returns the change log ID, or null if it wasn't deleted. */
  async restore(table: DataTable, id: Uuid, options: WriteOptions = {}): Promise<Uuid | null> {
    assertDataTable(table)
    const { changeId } = await this.write((tx, ctx) =>
      this.change(tx, ctx, table, id, { deleted: false }, 'restore', options),
    )
    return changeId
  }

  /**
   * Permanent removal. The record must be deleted first. Leaves a tombstone so other
   * devices don't bring it back, and clears its old values from the logs (docs/decisions/0003).
   */
  async purge(table: DataTable, id: Uuid, options: WriteOptions = {}): Promise<void> {
    assertDataTable(table)
    if (table === 'sharedTargets') throw new Error('Shared targets can be reset, not removed.')
    await this.write(async (tx, ctx) => {
      const old = await load(tx, table, id)
      if (!old.deleted) throw new Error('Delete the record before removing it permanently.')
      const at = this.clock()
      const tombstone = tombstoneOf(old, this.deviceId, at)
      await save(tx, table, tombstone, ctx)
      await this.scrubLogs(tx, ctx, id, at)
      await this.logChange(tx, ctx, table, tombstone, 'purge', [], {}, at, options)
    })
  }

  // ---------- Shared targets ----------

  /** The one shared-targets record. Created on first use with default-stamped empty values. */
  async getSharedTargets(): Promise<LiveRecord<SharedTargetsData>> {
    return this.write(async (tx, ctx) => {
      const store = tx.objectStore('sharedTargets')
      const existing = await request(store.get(SHARED_TARGETS_ID))
      if (existing) return existing as LiveRecord<SharedTargetsData>
      const record = buildRecord(
        SHARED_TARGETS_ID,
        emptySharedTargets() as unknown as Obj,
        defaultStamp(this.deviceId),
        mapFieldsOf('sharedTargets'),
      )
      await save(tx, 'sharedTargets', record, ctx)
      return record as unknown as LiveRecord<SharedTargetsData>
    })
  }

  /** Clears every shared target as real edits, so the reset wins on other devices too. */
  async resetSharedTargets(options: WriteOptions = {}): Promise<LiveRecord<SharedTargetsData>> {
    await this.getSharedTargets()
    const empty = emptySharedTargets() as unknown as Obj
    const { record } = await this.write((tx, ctx) =>
      this.change(tx, ctx, 'sharedTargets', SHARED_TARGETS_ID, empty, 'update', options, true),
    )
    return record as unknown as LiveRecord<SharedTargetsData> // validated before saving
  }

  // ---------- Role IDs ----------

  /** The next free Role ID on this device (R001, R002...). */
  async nextRoleId(): Promise<RoleId> {
    return inTransaction(this.db, [META_STORE], async (tx) => {
      const store = tx.objectStore(META_STORE)
      const meta = (await request(store.get(META_KEY))) as Meta
      const roleId = formatRoleId(meta.nextRoleNumber)
      await request(store.put({ ...meta, nextRoleNumber: meta.nextRoleNumber + 1 }, META_KEY))
      return roleId
    })
  }

  // ---------- Undo and conflicts ----------

  /**
   * Undoes one logged change by putting back its old values, as a new (undoable) edit.
   * A field is undone only if it still has the exact stamp this change wrote; anything
   * that touched it since (on any device) gives it a different stamp, so it is left
   * alone and returned in `skipped`. No clocks are compared, so a wrong clock can't
   * make undo overwrite newer work (docs/decisions/0008). Undoing a creation deletes the record (it stays in
   * "recently deleted"). A permanent removal cannot be undone.
   */
  async undo(changeId: Uuid, options: WriteOptions = {}): Promise<{ skipped: string[] }> {
    return this.write(async (tx, ctx) => {
      const entry = (await load(tx, 'changeLog', changeId)) as Stored & ChangeLogData
      if (entry.action === 'purge') throw new Error('A permanent removal cannot be undone.')
      const table = entry.table as DataTable
      const record = await load(tx, table, entry.recordId)

      const unchangedSince = (key: string) => {
        const written = entry.stamps[key]
        const current = record.fieldMeta[key]
        return written !== undefined && current !== undefined && sameStamp(written, current)
      }
      const skipped = entry.fieldKeys.filter((key) => !unchangedSince(key))
      const keys = entry.fieldKeys.filter(unchangedSince)

      // A change that touched `deleted` without an old value created the record.
      const created = entry.fieldKeys.includes('deleted') && !Object.hasOwn(entry.before, 'deleted')
      if (created) {
        if (keys.includes('deleted')) {
          await this.change(tx, ctx, table, record.id, { deleted: true }, 'undo', options)
        }
        return { skipped }
      }

      let changes: Obj = {}
      for (const key of keys) {
        const old = Object.hasOwn(entry.before, key) ? entry.before[key] : undefined
        changes = withField(record, changes, key, old)
      }
      await this.change(tx, ctx, table, record.id, changes, 'undo', options)
      return { skipped }
    })
  }

  /** Puts a conflict's losing value back as a new edit, and marks the conflict resolved. */
  async restoreConflict(conflictId: Uuid, options: WriteOptions = {}): Promise<void> {
    await this.write(async (tx, ctx) => {
      const conflict = (await load(tx, 'conflictLog', conflictId)) as Stored & ConflictLogData
      if (conflict.resolved) throw new Error('This conflict was already resolved.')
      const table = conflict.table as DataTable
      const record = await load(tx, table, conflict.recordId)
      const changes = withField(record, {}, conflict.fieldKey, conflict.losingValue)
      await this.change(tx, ctx, table, record.id, changes, 'update', options)
      await this.change(tx, ctx, 'conflictLog', conflictId, { resolved: true }, 'update', options)
    })
  }

  /** Keeps the winning value and marks the conflict resolved. */
  async dismissConflict(conflictId: Uuid, options: WriteOptions = {}): Promise<void> {
    await this.write((tx, ctx) =>
      this.change(tx, ctx, 'conflictLog', conflictId, { resolved: true }, 'update', options),
    )
  }

  // ---------- Merging (import now, sync later) ----------

  /**
   * Merges a record from another device or an import file into this device's copy.
   * Validates it first, writes any real conflicts to the conflict log, and logs the change.
   */
  async saveMerged<T extends TableName>(
    table: T,
    incoming: unknown,
    options: WriteOptions = { appliedBy: 'import' },
  ): Promise<MergeOutcome<T>> {
    return this.write(async (tx, ctx) => {
      const outcome = await this.mergeOne(tx, ctx, table, incoming, options)
      await this.renumberCollisions(tx, ctx, options)
      return outcome
    })
  }

  /**
   * Merges many records in one transaction: if any record fails, none are saved
   * (docs/decisions/0009).
   * Field definitions go first so later records are checked against them.
   * Finishes by renumbering any Role ID collisions.
   */
  async saveMergedMany(
    entries: { table: TableName; record: unknown }[],
    options: WriteOptions = { appliedBy: 'import' },
  ): Promise<MergeSummary> {
    const isDefs = (e: { table: TableName }) => e.table === 'fieldDefinitions'
    const ordered = [...entries.filter(isDefs), ...entries.filter((e) => !isDefs(e))]
    return this.write(async (tx, ctx) => {
      const summary: MergeSummary = { records: 0, changed: 0, conflicts: 0, renumbered: 0 }
      let context = ctx
      let defsDone = false
      for (const { table, record } of ordered) {
        if (!defsDone && table !== 'fieldDefinitions') {
          context = await loadContext(tx) // now includes the merged field definitions
          defsDone = true
        }
        const outcome = await this.mergeOne(tx, context, table, record, options)
        summary.records++
        if (outcome.changed) summary.changed++
        summary.conflicts += outcome.conflicts
      }
      summary.renumbered = await this.renumberCollisions(tx, context, options)
      return summary
    })
  }

  /** Every stored record in a table, including deleted ones and tombstones. For export. */
  async listAll<T extends TableName>(table: T): Promise<RecordOf<T>[]> {
    return this.getAll(table)
  }

  // ---------- Internals ----------

  /** Runs `fn` in one read-write transaction over every store, so any write can touch any table. */
  private write<R>(fn: (tx: IDBTransaction, ctx: ValidationContext) => Promise<R>): Promise<R> {
    return inTransaction(this.db, [...TABLE_NAMES, META_STORE], async (tx) =>
      fn(tx, await loadContext(tx)),
    )
  }

  private async mergeOne<T extends TableName>(
    tx: IDBTransaction,
    ctx: ValidationContext,
    table: T,
    incoming: unknown,
    options: WriteOptions,
  ): Promise<MergeOutcome<T>> {
    const report = validateRecord(table, incoming, ctx)
    if (report.errors.length > 0) throw new ValidationError(report.errors)
    const remote = incoming as Stored
    if (table === 'sharedTargets' && (remote.id !== SHARED_TARGETS_ID || remote.deleted)) {
      throw new ValidationError(['sharedTargets: must use the fixed ID and cannot be deleted'])
    }

    const local = (await request(tx.objectStore(table).get(remote.id))) as Stored | undefined
    let merged: Stored
    let drafts: ConflictDraft[] = []
    if (!local) {
      merged = structuredClone(remote)
    } else {
      const result = mergeRecords(local as StoredRecord<object>, remote as StoredRecord<object>)
      merged = result.record as unknown as Stored
      drafts = result.conflicts
    }
    const at = this.clock()

    // A log entry about a record this device purged must not bring its data back.
    if (LOG_TABLES.includes(table) && !merged.purged) {
      const target = await request(
        tx.objectStore(merged.table as TableName).get(merged.recordId as Uuid),
      )
      if ((target as Stored | undefined)?.purged)
        merged = scrubbed(table, merged, this.deviceId, at)
    }

    // Even when our copy wins every field (nothing to save), the losing values are still logged.
    const changed = !local || !jsonEqual(local, merged)
    let conflicts = 0
    if (!LOG_TABLES.includes(table)) {
      for (const draft of drafts) {
        if (await this.logConflict(tx, ctx, table, remote.id, draft, at)) conflicts++
      }
    }
    if (!changed) return { record: local as unknown as RecordOf<T>, changed, conflicts }

    await save(tx, table, merged, ctx)
    if (!LOG_TABLES.includes(table)) {
      if (merged.purged) {
        if (!local?.purged) await this.scrubLogs(tx, ctx, remote.id, at)
        await this.logChange(tx, ctx, table, merged, 'import', [], {}, at, options)
      } else {
        const keys = changedKeys(local, merged)
        const before = local ? valuesOf(local, keys) : {}
        await this.logChange(tx, ctx, table, merged, 'import', keys, before, at, options)
      }
    }
    return { record: merged as unknown as RecordOf<T>, changed, conflicts }
  }

  /**
   * Gives every posting its own Role ID. When two postings (or unlinked rows) share one,
   * the smaller id keeps it and the other moves, with its linked rows, to the next free
   * number. Returns how many were renumbered. See docs/decisions/0011.
   */
  private async renumberCollisions(
    tx: IDBTransaction,
    ctx: ValidationContext,
    options: WriteOptions,
  ): Promise<number> {
    // roleId -> owner (the posting, or the row itself if unlinked) -> its rows
    const byRole = new Map<string, Map<string, { table: TableName; id: Uuid }[]>>()
    let highest = 0
    for (const table of ROLE_ID_TABLES) {
      for (const row of (await request(tx.objectStore(table).getAll())) as Stored[]) {
        if (row.purged || typeof row.roleId !== 'string') continue
        highest = Math.max(highest, roleNumber(row.roleId as RoleId))
        const owner = table === 'postings' ? row.id : ((row.postingId as Uuid | null) ?? row.id)
        const owners = byRole.get(row.roleId) ?? new Map()
        byRole.set(row.roleId, owners)
        owners.set(owner, [...(owners.get(owner) ?? []), { table, id: row.id }])
      }
    }

    const metaStore = tx.objectStore(META_STORE)
    const meta = (await request(metaStore.get(META_KEY))) as Meta
    let next = Math.max(highest + 1, meta.nextRoleNumber)
    let renumbered = 0
    const byKey = <V>(a: [string, V], b: [string, V]) => (a[0] < b[0] ? -1 : 1)
    for (const [, owners] of [...byRole.entries()].sort(byKey)) {
      if (owners.size < 2) continue
      const [, ...movers] = [...owners.entries()].sort(byKey) // smallest id keeps the number
      for (const [, rows] of movers) {
        const changes = { roleId: formatRoleId(next++) }
        for (const row of rows) {
          await this.change(tx, ctx, row.table, row.id, changes, 'renumber', options)
        }
        renumbered++
      }
    }
    if (next !== meta.nextRoleNumber) {
      await request(metaStore.put({ ...meta, nextRoleNumber: next }, META_KEY))
    }
    return renumbered
  }

  private async change(
    tx: IDBTransaction,
    ctx: ValidationContext,
    table: TableName,
    id: Uuid,
    changes: Obj,
    action: ChangeAction,
    options: WriteOptions,
    force = false,
    expected?: ExpectedStamps,
  ): Promise<{ record: Stored; changeId: Uuid | null }> {
    const old = await load(tx, table, id)
    const at = this.clock()
    const { next, keys, before } = applyChanges(
      old,
      changes,
      mapFieldsOf(table),
      this.deviceId,
      at,
      force,
    )
    if (expected) {
      // Checked inside the transaction, so no other write can slip in between.
      const stale = keys.filter((key) => {
        if (!Object.hasOwn(expected, key)) return true
        const want = expected[key]
        const have = old.fieldMeta[key]
        return want === null ? have !== undefined : !have || !sameStamp(want, have)
      })
      if (stale.length > 0) throw new StaleEditError(stale)
    }
    if (keys.length === 0) return { record: old, changeId: null }
    await save(tx, table, next, ctx)
    const changeId = await this.logChange(tx, ctx, table, next, action, keys, before, at, options)
    return { record: next, changeId }
  }

  private async logChange(
    tx: IDBTransaction,
    ctx: ValidationContext,
    table: TableName,
    record: Stored, // the record as saved by this change
    action: ChangeAction,
    fieldKeys: string[],
    before: Record<string, JsonValue>,
    at: Moment,
    options: WriteOptions,
  ): Promise<Uuid | null> {
    if (LOG_TABLES.includes(table)) return null
    // The exact stamps this change wrote. Undo compares them with the current stamps.
    const stamps: FieldMeta = {}
    for (const key of fieldKeys) stamps[key] = record.fieldMeta[key]
    const data: ChangeLogData = {
      table,
      recordId: record.id,
      action,
      fieldKeys,
      stamps,
      before,
      appliedBy: options.appliedBy ?? 'user',
      stageId: options.stageId ?? null,
    }
    const stamp = stampEdit(undefined, this.deviceId, at)
    const id = newId()
    await save(tx, 'changeLog', buildRecord(id, data as unknown as Obj, stamp, []), ctx)
    return id
  }

  private async logConflict(
    tx: IDBTransaction,
    ctx: ValidationContext,
    table: TableName,
    recordId: Uuid,
    draft: ConflictDraft,
    at: Moment,
  ): Promise<boolean> {
    // Same ID on every device that sees this conflict, so sync shows it once.
    const { updatedAt, deviceId } = draft.losingStamp
    const id = deterministicId(`${table}|${recordId}|${draft.fieldKey}|${updatedAt}|${deviceId}`)
    const store = tx.objectStore('conflictLog')
    if (await request(store.get(id))) return false // already logged
    const data: ConflictLogData = {
      table,
      recordId,
      fieldKey: draft.fieldKey,
      losingValue: draft.losingValue,
      losingStamp: draft.losingStamp,
      winningStamp: draft.winningStamp,
      resolved: false,
    }
    const stamp = stampEdit(undefined, this.deviceId, at)
    await save(tx, 'conflictLog', buildRecord(id, data as unknown as Obj, stamp, []), ctx)
    return true
  }

  /** After a purge: clear the record's old values from the change log and remove its conflicts. */
  private async scrubLogs(
    tx: IDBTransaction,
    ctx: ValidationContext,
    recordId: Uuid,
    at: Moment,
  ): Promise<void> {
    for (const table of LOG_TABLES) {
      const index = tx.objectStore(table).index('recordId')
      for (const entry of (await request(index.getAll(recordId))) as Stored[]) {
        const clean = scrubbed(table, entry, this.deviceId, at)
        if (clean !== entry) await save(tx, table, clean, ctx)
      }
    }
  }
}

// ---------- Helpers ----------

/**
 * Runs `fn` inside a transaction and waits for it to commit. If `fn` throws, the
 * transaction is aborted, so none of its writes happen.
 * Inside `fn`, await only IndexedDB requests: waiting on anything else lets the
 * transaction close early.
 */
async function inTransaction<R>(
  db: IDBDatabase,
  stores: string[],
  fn: (tx: IDBTransaction) => Promise<R>,
): Promise<R> {
  const tx = db.transaction([...new Set(stores)], 'readwrite')
  const done = transactionDone(tx)
  done.catch(() => {}) // handled below; avoids an "unhandled rejection" warning
  try {
    const result = await fn(tx)
    await done
    return result
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // already finished
    }
    throw error
  }
}

async function loadContext(tx: IDBTransaction): Promise<ValidationContext> {
  const defs = (await request(tx.objectStore('fieldDefinitions').getAll())) as Stored[]
  const customFields = new Map<string, FieldDefinitionData>()
  for (const def of defs) {
    if (!def.purged) customFields.set(def.id, def as unknown as FieldDefinitionData)
  }
  return { customFields }
}

async function load(tx: IDBTransaction, table: TableName, id: Uuid): Promise<Stored> {
  const record = (await request(tx.objectStore(table).get(id))) as Stored | undefined
  if (!record) throw new Error(`No ${table} record with ID ${id}`)
  if (record.purged) throw new Error(`That ${table} record was permanently removed`)
  return record
}

async function save(
  tx: IDBTransaction,
  table: TableName,
  record: Obj,
  ctx: ValidationContext,
): Promise<void> {
  const report = validateRecord(table, record, ctx)
  if (report.errors.length > 0) throw new ValidationError(report.errors)
  await request(tx.objectStore(table).put(record))
}

/**
 * A log entry with a purged record's data removed: change-log entries lose their old
 * values; conflict entries become tombstones. Returns the entry unchanged if already clean.
 */
function scrubbed(table: TableName, entry: Stored, deviceId: DeviceId, at: Moment): Stored {
  if (entry.purged) return entry
  if (table === 'conflictLog') return tombstoneOf(entry, deviceId, at)
  if (Object.keys(entry.before as Obj).length === 0) return entry
  return applyChanges(entry, { before: {} }, [], deviceId, at, false).next
}

/**
 * Adds one field change, by fieldMeta key, to `changes`. For a map entry
 * ('custom.<id>'), builds the whole new map; a value of undefined removes the entry.
 */
function withField(record: Stored, changes: Obj, key: string, value: unknown): Obj {
  const dot = key.indexOf('.')
  if (dot === -1) {
    if (value !== undefined) changes[key] = structuredClone(value)
    return changes
  }
  const [top, entry] = [key.slice(0, dot), key.slice(dot + 1)]
  const current = changes[top]
  const map: Obj = isObj(current) ? current : isObj(record[top]) ? structuredClone(record[top]) : {}
  if (value === undefined) delete map[entry]
  else map[entry] = structuredClone(value)
  changes[top] = map
  return changes
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertDataTable(table: TableName): void {
  if (LOG_TABLES.includes(table)) throw new Error(`${table} is written by the app only`)
}

function assertNoSyncKeys(data: Obj): void {
  const bad = Object.keys(data).filter((key) => SYNC_KEYS.has(key))
  if (bad.length > 0)
    throw new ValidationError(bad.map((key) => `${key}: set by the app, not editable`))
}

/** A new record with every field (and map entry) stamped with `stamp`. */
function buildRecord(id: Uuid, data: Obj, stamp: FieldStamp, mapFields: string[]): Stored {
  const fieldMeta: FieldMeta = { deleted: stamp }
  for (const [key, value] of Object.entries(data)) {
    if (mapFields.includes(key) && isObj(value)) {
      for (const entry of Object.keys(value)) fieldMeta[`${key}.${entry}`] = stamp
    } else {
      fieldMeta[key] = stamp
    }
  }
  return {
    ...structuredClone(data),
    id,
    updatedAt: stamp.updatedAt,
    deviceId: stamp.deviceId,
    deleted: false,
    schemaVersion: SCHEMA_VERSION,
    fieldMeta,
    purged: false,
  }
}

function tombstoneOf(record: Stored, deviceId: DeviceId, at: Moment): Stored {
  const stamp = stampEdit(record.fieldMeta.deleted, deviceId, at)
  return {
    id: record.id,
    updatedAt: stamp.updatedAt,
    deviceId: stamp.deviceId,
    deleted: true,
    schemaVersion: SCHEMA_VERSION,
    fieldMeta: { deleted: stamp },
    purged: true,
  }
}

/**
 * Applies changes to a copy of `old`, stamping only the fields that change
 * (all given fields if `force`). Returns the touched fieldMeta keys and their old values.
 */
function applyChanges(
  old: Stored,
  changes: Obj,
  mapFields: string[],
  deviceId: DeviceId,
  at: Moment,
  force: boolean,
): { next: Stored; keys: string[]; before: Record<string, JsonValue> } {
  const next = structuredClone(old)
  const keys: string[] = []
  const before: Record<string, JsonValue> = {}
  const touch = (key: string, oldValue: unknown) => {
    keys.push(key)
    if (oldValue !== undefined) before[key] = oldValue as JsonValue
  }

  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) continue
    if (mapFields.includes(field) && isObj(value)) {
      const oldMap = isObj(old[field]) ? old[field] : {}
      for (const entry of new Set([...Object.keys(oldMap), ...Object.keys(value)])) {
        const oldEntry = Object.hasOwn(oldMap, entry) ? oldMap[entry] : undefined
        const newEntry = Object.hasOwn(value, entry) ? value[entry] : undefined
        if (oldEntry === undefined && newEntry === undefined) continue
        if (!force && jsonEqual(oldEntry, newEntry)) continue
        touch(`${field}.${entry}`, oldEntry)
      }
    } else {
      if (!force && jsonEqual(old[field], value)) continue
      touch(field, old[field])
    }
    next[field] = structuredClone(value)
  }

  for (const key of keys) next.fieldMeta[key] = stampEdit(old.fieldMeta[key], deviceId, at)
  const newest = Object.values(next.fieldMeta).reduce((a, b) => (compareStamps(a, b) >= 0 ? a : b))
  next.updatedAt = newest.updatedAt
  next.deviceId = newest.deviceId
  return { next, keys, before }
}

/** fieldMeta keys whose stamp differs between the two copies. */
function changedKeys(local: Stored | undefined, merged: Stored): string[] {
  return Object.keys(merged.fieldMeta).filter((key) => {
    const old = local?.fieldMeta[key]
    return !old || !sameStamp(old, merged.fieldMeta[key])
  })
}

function valuesOf(record: Stored, keys: string[]): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {}
  for (const key of keys) {
    const value = getValue(record, key)
    if (value !== undefined) values[key] = value as JsonValue
  }
  return values
}
