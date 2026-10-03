import type { DeviceId, Moment } from './types/core'
import type { FieldStamp, StampRef } from './types/record'

/** Stamp for a value the app filled in. Any real edit beats it. See docs/decisions/0004. */
export function defaultStamp(deviceId: DeviceId): FieldStamp {
  return { updatedAt: 0 as Moment, deviceId, base: null }
}

/**
 * Stamp for a real edit. Always newer than the value it replaces, even if this
 * device's clock is behind (clock skew guard). See docs/decisions/0005, and 0002 for `base`.
 */
export function stampEdit(
  previous: FieldStamp | undefined,
  deviceId: DeviceId,
  at: Moment,
): FieldStamp {
  if (!previous) return { updatedAt: at, deviceId, base: null }
  const updatedAt = Math.max(at, previous.updatedAt + 1) as Moment
  let base: StampRef | null
  if (previous.updatedAt === 0) {
    base = null // defaults are never a base
  } else if (previous.deviceId === deviceId) {
    base = previous.base // editing our own value again: keep what it was built on
  } else {
    base = { updatedAt: previous.updatedAt, deviceId: previous.deviceId }
  }
  return { updatedAt, deviceId, base }
}

/** Positive if a is newer, negative if b is newer. Ties go to the larger deviceId. */
export function compareStamps(a: StampRef, b: StampRef): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt
  if (a.deviceId === b.deviceId) return 0
  return a.deviceId > b.deviceId ? 1 : -1
}

export function sameStamp(a: StampRef, b: StampRef): boolean {
  return a.updatedAt === b.updatedAt && a.deviceId === b.deviceId
}
