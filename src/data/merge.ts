import { compareStamps, sameStamp } from './stamp'
import type { JsonValue } from './types/core'
import type { FieldMeta, FieldStamp, StoredRecord, Tombstone } from './types/record'

/** A value that lost a merge. repo.ts turns these into conflict log records. */
export interface ConflictDraft {
  fieldKey: string
  losingValue: JsonValue
  losingStamp: FieldStamp
  winningStamp: FieldStamp
}

export interface MergeResult<D> {
  record: StoredRecord<D>
  conflicts: ConflictDraft[]
}

type Obj = Record<string, unknown>

/**
 * Merges two copies of the same record, field by field. Pure: changes neither input.
 * Symmetric: merging (a, b) and (b, a) gives the same record.
 * Both copies must already be validated and at the same schemaVersion.
 */
export function mergeRecords<D>(a: StoredRecord<D>, b: StoredRecord<D>): MergeResult<D> {
  if (a.id !== b.id) throw new Error(`Cannot merge different records: ${a.id} and ${b.id}`)
  if (a.schemaVersion !== b.schemaVersion) {
    throw new Error(
      `Cannot merge ${a.id}: schema versions ${a.schemaVersion} and ${b.schemaVersion}`,
    )
  }
  if (a.purged || b.purged) return { record: mergeTombstone(a, b), conflicts: [] }

  const merged = structuredClone(a) as Obj
  const meta: FieldMeta = { ...a.fieldMeta }
  const conflicts: ConflictDraft[] = []
  const keys = new Set([...Object.keys(a.fieldMeta), ...Object.keys(b.fieldMeta)])

  for (const key of [...keys].sort()) {
    const stampA = a.fieldMeta[key]
    const stampB = b.fieldMeta[key]
    if (!stampB) continue // only a has it; already in merged
    if (!stampA) {
      setValue(merged, key, getValue(b, key))
      meta[key] = stampB
      continue
    }
    const order = compareStamps(stampA, stampB)
    if (order === 0) continue // same edit on both copies

    const aWins = order > 0
    const [winner, loser] = aWins ? [stampA, stampB] : [stampB, stampA]
    const winningValue = getValue(aWins ? a : b, key)
    const losingValue = getValue(aWins ? b : a, key)
    if (!aWins) {
      setValue(merged, key, winningValue)
      meta[key] = stampB
    }
    if (isRealConflict(winner, loser, winningValue, losingValue)) {
      conflicts.push({
        fieldKey: key,
        losingValue: (losingValue ?? null) as JsonValue,
        losingStamp: loser,
        winningStamp: winner,
      })
    }
  }

  const newest = newestStamp(meta)
  merged.fieldMeta = meta
  merged.updatedAt = newest.updatedAt
  merged.deviceId = newest.deviceId
  return { record: merged as StoredRecord<D>, conflicts }
}

/**
 * The losing value is kept for review only if someone actually changed it
 * without seeing the winning edit.
 */
function isRealConflict(
  winner: FieldStamp,
  loser: FieldStamp,
  winningValue: unknown,
  losingValue: unknown,
): boolean {
  if (jsonEqual(winningValue, losingValue)) return false
  if (loser.updatedAt === 0) return false // defaults never conflict
  if (winner.deviceId === loser.deviceId) return false // a later edit on the same device
  if (winner.base && sameStamp(winner.base, loser)) return false // winner was made on top of loser
  return true
}

/** Purge always wins. If both are tombstones, keep the newer one. */
function mergeTombstone<D>(a: StoredRecord<D>, b: StoredRecord<D>): Tombstone {
  let tombstone: Tombstone
  if (a.purged && b.purged) tombstone = compareStamps(a, b) >= 0 ? a : b
  else tombstone = a.purged ? a : (b as Tombstone)
  return structuredClone(tombstone)
}

function newestStamp(meta: FieldMeta): FieldStamp {
  let newest: FieldStamp | undefined
  for (const stamp of Object.values(meta)) {
    if (!newest || compareStamps(stamp, newest) > 0) newest = stamp
  }
  if (!newest) throw new Error('Record has no field stamps')
  return newest
}

/** 'company' -> ['company', null]; 'custom.<id>' -> ['custom', '<id>'] */
function splitKey(key: string): [string, string | null] {
  const dot = key.indexOf('.')
  return dot === -1 ? [key, null] : [key.slice(0, dot), key.slice(dot + 1)]
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads a field. A map entry that was removed reads as undefined. */
function getValue(record: object, key: string): unknown {
  const [top, entry] = splitKey(key)
  const value = (record as Obj)[top]
  if (entry === null) return value
  return isObj(value) && Object.hasOwn(value, entry) ? value[entry] : undefined
}

/** Writes a field. Writing undefined to a map entry removes it. */
function setValue(record: Obj, key: string, value: unknown): void {
  const [top, entry] = splitKey(key)
  if (entry === null) {
    record[top] = structuredClone(value)
    return
  }
  let container = record[top]
  if (!isObj(container)) {
    container = {}
    record[top] = container
  }
  const map = container as Obj
  if (value === undefined) delete map[entry]
  else map[entry] = structuredClone(value)
}

/** Deep equality for JSON-like values. Object key order doesn't matter. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => jsonEqual(item, b[i]))
  }
  if (isObj(a) && isObj(b)) {
    const keysA = Object.keys(a)
    if (keysA.length !== Object.keys(b).length) return false
    return keysA.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  }
  return false
}
