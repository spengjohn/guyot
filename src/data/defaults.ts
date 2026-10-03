import type { SharedTargetsData } from './types/tables'

/** Starting values for the shared-targets record. Stamped as defaults, so they never beat real edits. */
export function emptySharedTargets(): SharedTargetsData {
  return {
    roleTypes: [],
    industries: [],
    prioritizeCompanies: [],
    excludeCompanies: [],
    excludeRule: '',
    mustHaveKeywords: [],
    niceToHaveKeywords: [],
    dealbreakers: [],
    eligibilityNotes: '',
    preferredSources: [],
    custom: {},
  }
}
