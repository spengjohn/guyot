import { SEARCH_PROFILE_FIELDS, SHARED_TARGET_FIELDS } from '../data/builtinFields'
import type { FieldDefinitionData } from '../data/types/fields'
import type { FieldMeta, LiveRecord } from '../data/types/record'
import type { SearchProfileData, SharedTargetsData } from '../data/types/tables'
import { builtinSpec, customSpec, type FieldSpec } from '../fields/columns'

export type SavedProfile = SearchProfileData & { fieldMeta: FieldMeta }
export type SavedSharedTargets = SharedTargetsData & { fieldMeta: FieldMeta }
type Definition = LiveRecord<FieldDefinitionData>

/** Custom fields defined for one table, as field specs. */
function customFor(definitions: readonly Definition[], table: string): FieldSpec[] {
  return definitions.filter((d) => d.scope.table === table).map((d) => customSpec(d.id, d))
}

/** The profile's own fields: built-in, then custom. */
export function profileFields(definitions: readonly Definition[]): FieldSpec[] {
  return [...SEARCH_PROFILE_FIELDS.map(builtinSpec), ...customFor(definitions, 'searchProfiles')]
}

/** The shared-target fields: built-in, then custom. */
export function sharedFields(definitions: readonly Definition[]): FieldSpec[] {
  return [...SHARED_TARGET_FIELDS.map(builtinSpec), ...customFor(definitions, 'sharedTargets')]
}

/**
 * One override field per shared field, stored in the profile's `overrides` map (built-in
 * fields, by name) or `customOverrides` map (custom fields, by ID) (docs/decisions/0012).
 */
export function overrideFields(shared: readonly FieldSpec[]): FieldSpec[] {
  return shared.map((field) => {
    const path = field.custom ? `customOverrides.${field.key}` : `overrides.${field.key}`
    return { ...field, key: path, path, required: false, hint: undefined }
  })
}

/** The shared field an override field overrides (its spec without the override path). */
export function sharedFieldOf(override: FieldSpec, shared: readonly FieldSpec[]): FieldSpec {
  const key = override.key.slice(override.key.indexOf('.') + 1)
  return shared.find((f) => f.key === key)!
}

/** What a new profile starts as. */
export function newProfile(): SavedProfile {
  return {
    name: '',
    term: '',
    employmentTypes: [],
    locations: [],
    workModes: [],
    minimumPay: null,
    priority: null,
    active: true,
    notes: '',
    overrides: {},
    customOverrides: {},
    custom: {},
    fieldMeta: {},
  }
}

/** A new, unsaved profile with the same values as `profile`, named as a copy. */
export function duplicateOf(profile: SearchProfileData): SavedProfile {
  const copy = structuredClone(profile) as SearchProfileData & Record<string, unknown>
  for (const key of ['id', 'updatedAt', 'deviceId', 'deleted', 'schemaVersion', 'purged']) {
    delete copy[key]
  }
  return { ...copy, name: `${profile.name} (copy)`, fieldMeta: {} }
}

export const PROFILE_REQUIRED_MESSAGES: Readonly<Record<string, string>> = {
  name: 'Enter a name for this profile',
}

/** A short name for a profile in labels and messages. */
export function describeProfile(profile: Pick<SearchProfileData, 'name'>): string {
  return profile.name.trim() || 'Untitled profile'
}
