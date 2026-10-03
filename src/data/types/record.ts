import type { DeviceId, Moment, Uuid } from './core'

/** A point in one field's history: when, and on which device. */
export interface StampRef {
  updatedAt: Moment // 0 means an app-filled default, never a real edit
  deviceId: DeviceId
}

/** Who changed one field last, and when. */
export interface FieldStamp extends StampRef {
  /** The last other-device stamp this edit replaced. Tells real conflicts from normal catch-up. */
  base: StampRef | null
}

/**
 * One stamp per field. Key is a built-in field name ('company'), 'deleted',
 * or a dotted path for map entries: 'custom.<fieldId>', 'overrides.<key>', 'choices.<choiceId>'.
 */
export type FieldMeta = Record<string, FieldStamp>

export interface SyncFields {
  id: Uuid
  updatedAt: Moment // newest stamp in fieldMeta
  deviceId: DeviceId // device that made that newest change
  deleted: boolean
  schemaVersion: number
  fieldMeta: FieldMeta
}

/** A normal record: sync fields plus the table's own data. */
export type LiveRecord<D> = SyncFields & { purged: false } & D

/**
 * What remains after a permanent removal. Data fields are gone; the id stays so
 * other devices know not to bring the record back. Purge always wins on merge.
 */
export type Tombstone = SyncFields & { purged: true; deleted: true }

/** Every stored record is either live or a tombstone. Check `purged` to tell them apart. */
export type StoredRecord<D> = LiveRecord<D> | Tombstone
