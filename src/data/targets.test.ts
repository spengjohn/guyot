import { describe, expect, it } from 'vitest'
import { emptySharedTargets } from './defaults'
import { effectiveTargets } from './targets'
import type { Uuid } from './types/core'
import type { SearchProfileData, SharedTargetsData } from './types/tables'

const FIELD = '77777777-7777-4777-8777-777777777777' as Uuid

function shared(): SharedTargetsData {
  return {
    ...emptySharedTargets(),
    roleTypes: ['Frontend developer', 'React'],
    excludeCompanies: ['Agency Co'],
    excludeRule: 'No recruiters',
    custom: { [FIELD]: true },
  }
}
type Overrides = Pick<SearchProfileData, 'overrides' | 'customOverrides'>
const none: Overrides = { overrides: {}, customOverrides: {} }

describe('effectiveTargets', () => {
  it('uses the shared targets where the profile sets nothing', () => {
    expect(effectiveTargets(shared(), none)).toEqual(shared())
  })

  it('adds the profile items to the shared list, without duplicates', () => {
    const result = effectiveTargets(shared(), {
      ...none,
      overrides: { roleTypes: { mode: 'add', items: [' react', 'UX designer', 'UX Designer'] } },
    })
    // The shared spelling wins; case and surrounding spaces don't make a new item.
    expect(result.roleTypes).toEqual(['Frontend developer', 'React', 'UX designer'])
  })

  it('replaces the shared list, including with an empty list', () => {
    const result = effectiveTargets(shared(), {
      ...none,
      overrides: {
        roleTypes: { mode: 'replace', items: ['Designer'] },
        excludeCompanies: { mode: 'replace', items: [] },
      },
    })
    expect(result.roleTypes).toEqual(['Designer'])
    expect(result.excludeCompanies).toEqual([])
  })

  it('lets text overrides win, including an empty one', () => {
    const result = effectiveTargets(shared(), { ...none, overrides: { excludeRule: '' } })
    expect(result.excludeRule).toBe('')
  })

  it('overrides custom fields by field ID; null overrides to empty', () => {
    const other = '88888888-8888-4888-8888-888888888888' as Uuid
    expect(
      effectiveTargets(shared(), { ...none, customOverrides: { [FIELD]: null } }).custom,
    ).toEqual({ [FIELD]: null })
    expect(
      effectiveTargets(shared(), { ...none, customOverrides: { [other]: 'x' } }).custom,
    ).toEqual({ [FIELD]: true, [other]: 'x' })
  })

  it('changes neither input', () => {
    const input = shared()
    const profile: Overrides = {
      overrides: { roleTypes: { mode: 'replace', items: ['Designer'] } },
      customOverrides: { [FIELD]: false },
    }
    const result = effectiveTargets(input, profile)
    result.roleTypes.push('changed')
    expect(input).toEqual(shared())
    expect(profile.overrides.roleTypes?.items).toEqual(['Designer'])
  })
})
