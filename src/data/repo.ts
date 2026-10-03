import { LOG_TABLES, SCHEMA_VERSION, SHARED_TARGETS_ID } from './constants'
import { META_STORE, openDatabase, request, transactionDone } from './db'
import { emptySharedTargets } from './defaults'
import { deterministicId, formatRoleId, newId, roleNumber } from './ids'
import { getValue, jsonEqual, mergeRecords, type ConflictDraft } from './merge'
import { compareStamps, defaultStamp, sameStamp, stampEdit } from './stamp'
import { now } from './time'
import type { DeviceId, JsonValue, Moment, RoleId, Uuid } from './types/core'
import type { FieldDefinitionData } from './types/fields'
import type { FieldMeta, FieldStamp, LiveRecord, StoredRecord, SyncFields } from './types/record'
import type {
  ChangeAction,
  ChangeLogData,
  ConflictLogData,
  Meta,
  RecordOf,
  SharedTargetsData,
  TableName,
  Tables,
} from './types/tables'
import { mapFieldsOf, SYNC_KEYS, validateRecord, type ValidationContext } from './validate'

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

/** Thrown when a write fails validation. Nothing is saved. */
export class ValidationError extends Error {
  readonly errors: string[]
  constructor(errors: string[]) {
    super(`Invalid data: ${errors[0] ?? 'unknown problem'}`)
    this.name = 'ValidationError'
    this.errors = errors
  }
}

type Obj = Record<string, unknown>
/** A stored record seen as a plain object, for code that works on any table. */
type Stored = Obj & SyncFields & { purged: boolean }

const META_KEY = 'meta'

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

  /** Opens the database, creating this device's ID on first run. `clock` is for tests. */
  static async open(options: { name?: string; clock?: () => Moment } = {}): Promise<Repo> {
    const db = await openDatabase(options.name)
    const meta = await inTransaction(db, [META_STORE], async (tx) => {
      const store = tx.objectStore(META_STORE)
      const existing = (await request(store.get(META_KEY))) as Meta | undefined
      if (existing) return existing
      const created: Meta = {
        deviceId: crypto.randomUUID() as DeviceId,
        nextRoleNumber: 1,
        lastBackupAt: null,
      }
      await request(store.put(created, META_KEY))
      return created
    })
    return new Repo(db, meta.deviceId, options.clock ?? now)
  }

  close(): void {
    this.db.close()
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

  async create<T extends DataTable>(
    table: T,
    data: Tables[T],
    options: WriteOptions = {},
  ): Promise<Live<T>> {
    assertDataTable(table)
    if (table === 'sharedTargets') {
      throw new Error('There is only one shared-targets record; use getSharedTargets().')
    }
    assertNoSyncKeys(data as Obj)
    return this.write(table, async (tx, ctx) => {
      const at = this.clock()
      const stamp = stampEdit(undefined, this.deviceId, at)
      const record = buildRecord(newId(), data as Obj, stamp, mapFieldsOf(table))
      await save(tx, table, record, ctx)
      const keys = Object.keys(record.fieldMeta)
      await this.logChange(tx, ctx, table, record.id, 'create', keys, {}, at, options)
      return record as unknown as Live<T>
    })
  }

  /**
   * Changes some fields. Only fields whose value actually changes get a new stamp.
   * For map-like fields (such as `custom`), pass the whole new map; entries are compared one by one.
   */
  async update<T extends DataTable>(
    table: T,
    id: Uuid,
    changes: Partial<Tables[T]>,
    options: WriteOptions = {},
  ): Promise<Live<T>> {
    assertDataTable(table)
    assertNoSyncKeys(changes as Obj)
    const record = await this.write(table, (tx, ctx) =>
      this.change(tx, ctx, table, id, changes as Obj, 'update', options),
    )
    return record as unknown as Live<T> // validated for this table before saving
  }

  /** Soft delete: the record moves to "recently deleted" and can be restored. */
  async delete(table: DataTable, id: Uuid, options: WriteOptions = {}): Promise<void> {
    assertDataTable(table)
    if (table === 'sharedTargets') throw new Error('Shared targets can be reset, not deleted.')
    await this.write(table, (tx, ctx) =>
      this.change(tx, ctx, table, id, { deleted: true }, 'delete', options),
    )
  }

  async restore(table: DataTable, id: Uuid, options: WriteOptions = {}): Promise<void> {
    assertDataTable(table)
    await this.write(table, (tx, ctx) =>
      this.change(tx, ctx, table, id, { deleted: false }, 'restore', options),
    )
  }

  /**
   * Permanent removal. The record must be deleted first. Leaves a tombstone so other
   * devices don't bring it back, and clears its old values from the logs.
   */
  async purge(table: DataTable, id: Uuid, options: WriteOptions = {}): Promise<void> {
    assertDataTable(table)
    if (table === 'sharedTargets') throw new Error('Shared targets can be reset, not removed.')
    await this.write(table, async (tx, ctx) => {
      const old = await load(tx, table, id)
      if (!old.deleted) throw new Error('Delete the record before removing it permanently.')
      const at = this.clock()
      await save(tx, table, tombstoneOf(old, this.deviceId, at), ctx)
      await this.scrubLogs(tx, ctx, id, at)
      await this.logChange(tx, ctx, table, id, 'purge', [], {}, at, options)
    })
  }

  // ---------- Shared targets ----------

  /** The one shared-targets record. Created on first use with default-stamped empty values. */
  async getSharedTargets(): Promise<LiveRecord<SharedTargetsData>> {
    return this.write('sharedTargets', async (tx, ctx) => {
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
    const record = await this.write('sharedTargets', (tx, ctx) =>
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
    return this.write(table, async (tx, ctx) => {
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
      // Even when our copy wins every field (nothing to save), the losing values are still logged.
      const changed = !local || !jsonEqual(local, merged)
      const at = this.clock()
      let conflicts = 0
      if (!LOG_TABLES.includes(table)) {
        for (const draft of drafts) {
          if (await this.logConflict(tx, ctx, table, remote.id, draft, at)) conflicts++
        }
      }
      if (!changed) return { record: local as RecordOf<T>, changed, conflicts }

      await save(tx, table, merged, ctx)
      if (!LOG_TABLES.includes(table)) {
        if (merged.purged) {
          if (!local?.purged) await this.scrubLogs(tx, ctx, remote.id, at)
          await this.logChange(tx, ctx, table, remote.id, 'import', [], {}, at, options)
        } else {
          const keys = changedKeys(local, merged)
          const before = local ? valuesOf(local, keys) : {}
          await this.logChange(tx, ctx, table, remote.id, 'import', keys, before, at, options)
        }
      }
      if (typeof merged.roleId === 'string') await bumpRoleCounter(tx, merged.roleId as RoleId)
      return { record: merged as unknown as RecordOf<T>, changed, conflicts }
    })
  }

  // ---------- Internals ----------

  /** Runs `fn` in one read-write transaction with everything a write may touch. */
  private write<R>(
    table: TableName,
    fn: (tx: IDBTransaction, ctx: ValidationContext) => Promise<R>,
  ): Promise<R> {
    const stores = [table, 'changeLog', 'conflictLog', 'fieldDefinitions', META_STORE]
    return inTransaction(this.db, stores, async (tx) => fn(tx, await loadContext(tx)))
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
  ): Promise<Stored> {
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
    if (keys.length === 0) return old
    await save(tx, table, next, ctx)
    await this.logChange(tx, ctx, table, id, action, keys, before, at, options)
    return next
  }

  private async logChange(
    tx: IDBTransaction,
    ctx: ValidationContext,
    table: TableName,
    recordId: Uuid,
    action: ChangeAction,
    fieldKeys: string[],
    before: Record<string, JsonValue>,
    at: Moment,
    options: WriteOptions,
  ): Promise<void> {
    if (LOG_TABLES.includes(table)) return
    const data: ChangeLogData = {
      table,
      recordId,
      action,
      fieldKeys,
      before,
      appliedBy: options.appliedBy ?? 'user',
      stageId: options.stageId ?? null,
    }
    const stamp = stampEdit(undefined, this.deviceId, at)
    await save(tx, 'changeLog', buildRecord(newId(), data as unknown as Obj, stamp, []), ctx)
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
    const changes = tx.objectStore('changeLog').index('recordId')
    for (const entry of (await request(changes.getAll(recordId))) as Stored[]) {
      if (entry.purged || Object.keys(entry.before as Obj).length === 0) continue
      const { next } = applyChanges(entry, { before: {} }, [], this.deviceId, at, false)
      await save(tx, 'changeLog', next, ctx)
    }
    const conflicts = tx.objectStore('conflictLog').index('recordId')
    for (const entry of (await request(conflicts.getAll(recordId))) as Stored[]) {
      if (!entry.purged) await save(tx, 'conflictLog', tombstoneOf(entry, this.deviceId, at), ctx)
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

async function bumpRoleCounter(tx: IDBTransaction, roleId: RoleId): Promise<void> {
  const store = tx.objectStore(META_STORE)
  const meta = (await request(store.get(META_KEY))) as Meta
  const n = roleNumber(roleId)
  if (n >= meta.nextRoleNumber)
    await request(store.put({ ...meta, nextRoleNumber: n + 1 }, META_KEY))
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
