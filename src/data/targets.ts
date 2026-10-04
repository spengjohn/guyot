import type { SearchProfileData, SharedTargetsData, SharedTargetsFields } from './types/tables'

/** The shared fields that hold lists, such as 'roleTypes'. */
type ListKey = {
  [K in keyof SharedTargetsFields]: SharedTargetsFields[K] extends string[] ? K : never
}[keyof SharedTargetsFields]

/**
 * Which shared fields are lists. The type requires every field, with 'list' exactly
 * for the list fields, so adding a shared field without updating this fails the build.
 */
const KINDS: {
  [K in keyof SharedTargetsFields]: SharedTargetsFields[K] extends string[] ? 'list' : 'text'
} = {
  roleTypes: 'list',
  industries: 'list',
  prioritizeCompanies: 'list',
  excludeCompanies: 'list',
  excludeRule: 'text',
  mustHaveKeywords: 'list',
  niceToHaveKeywords: 'list',
  dealbreakers: 'list',
  eligibilityNotes: 'text',
  preferredSources: 'list',
}
const KEYS = Object.keys(KINDS) as (keyof SharedTargetsFields)[]
const LIST_KEYS = KEYS.filter((key): key is ListKey => KINDS[key] === 'list')
const TEXT_KEYS = KEYS.filter(
  (key): key is Exclude<keyof SharedTargetsFields, ListKey> => KINDS[key] === 'text',
)

/**
 * The targets one profile actually uses: the shared targets with the profile's
 * overrides applied. Pure: changes neither input. See docs/decisions/0012.
 * - List, Add to shared: the shared items, then the profile's; duplicates removed.
 * - List, Replace: the profile's items instead.
 * - Text and custom fields: the profile's value wins where set (null clears a custom value).
 */
export function effectiveTargets(
  shared: SharedTargetsData,
  profile: Pick<SearchProfileData, 'overrides' | 'customOverrides'>,
): SharedTargetsData {
  const result = structuredClone(shared)
  for (const key of LIST_KEYS) {
    const override = profile.overrides[key]
    if (!override) continue
    result[key] =
      override.mode === 'replace'
        ? [...override.items]
        : withoutDuplicates([...shared[key], ...override.items])
  }
  for (const key of TEXT_KEYS) {
    const override = profile.overrides[key]
    if (override !== undefined) result[key] = override
  }
  result.custom = { ...result.custom, ...structuredClone(profile.customOverrides) }
  return result
}

/**
 * Keeps the first of items that match ignoring case and surrounding spaces, so
 * 'React' and ' react' count once and the shared spelling wins.
 */
function withoutDuplicates(items: string[]): string[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
