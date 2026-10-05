import { useEffect, useId, useRef, useState } from 'react'
import { useAnnounce } from '../app/announce'
import { Page } from '../app/Page'
import { useRepoQuery, useRepoWrite } from '../app/repoContext'
import type { Repo } from '../data/repo'
import type { Uuid } from '../data/types/core'
import type { LiveRecord } from '../data/types/record'
import type { SearchProfileData } from '../data/types/tables'
import { ProfileCard } from '../targets/ProfileCard'
import { ProfileDialog } from '../targets/ProfileDialog'
import { SharedTargetsForm } from '../targets/SharedTargetsForm'
import {
  describeProfile,
  duplicateOf,
  newProfile,
  overrideFields,
  profileFields,
  sharedFields,
  type SavedProfile,
} from '../targets/targetsForm'

type Profile = LiveRecord<SearchProfileData>

/** Defined outside the component, so its identity never changes (see useRepoQuery). */
async function loadTargets(repo: Repo) {
  const [shared, profiles, deleted, definitions] = await Promise.all([
    repo.getSharedTargets(),
    repo.list('searchProfiles'),
    repo.listDeleted('searchProfiles'),
    repo.list('fieldDefinitions'),
  ])
  const byName = (a: Profile, b: Profile) => describeProfile(a).localeCompare(describeProfile(b))
  const sharedSpecs = sharedFields(definitions)
  return {
    shared,
    profiles: [...profiles].sort(byName),
    deleted: [...deleted].sort(byName),
    profileSpecs: profileFields(definitions),
    sharedSpecs,
    overrideSpecs: overrideFields(sharedSpecs),
  }
}

/** Adding (or duplicating) carries the new profile's starting values, made once on click. */
type Dialog =
  { mode: 'add' | 'duplicate'; defaults: SavedProfile } | { mode: 'edit'; record: Profile } | null

interface Notice {
  changeId: Uuid
  recordId: Uuid
  name: string
}

const ADD_BUTTON_ID = 'add-profile'
const UNDO_BUTTON_ID = 'undo-profile-delete'
const editButtonId = (id: Uuid) => `edit-profile-${id}`

export function TargetsPage() {
  const query = useRepoQuery(loadTargets)
  const write = useRepoWrite()
  const announce = useAnnounce()
  const captionId = useId()
  const countId = `${captionId}-count`
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const pendingFocus = useRef<string | null>(null)

  // After a delete, undo or restore, focus goes to a button that appears once the page updates.
  useEffect(() => {
    if (!pendingFocus.current) return
    const target = document.getElementById(pendingFocus.current)
    if (target) {
      target.focus()
      pendingFocus.current = null
    }
  }, [query, notice])

  if (query.status !== 'ready') {
    return (
      <Page title="Targets">
        {query.status === 'loading' ? (
          <p>Loading…</p>
        ) : (
          <p role="alert">Couldn't load your targets: {String(query.error)}</p>
        )}
      </Page>
    )
  }
  const { shared, profiles, deleted, profileSpecs, sharedSpecs, overrideSpecs } = query.data

  const remove = async (profile: Profile) => {
    const name = describeProfile(profile)
    try {
      const changeId = await write((r) => r.delete('searchProfiles', profile.id))
      if (!changeId) return
      setNotice({ changeId, recordId: profile.id, name })
      pendingFocus.current = UNDO_BUTTON_ID
      announce(`Deleted profile ${name}. Undo is available.`)
    } catch (error) {
      announce(`Couldn't delete ${name}: ${String(error)}`)
    }
  }

  const undo = async (current: Notice) => {
    try {
      const { skipped } = await write((r) => r.undo(current.changeId))
      setNotice(null)
      if (skipped.length > 0) {
        announce(`Couldn't undo: ${current.name} was changed since it was deleted.`)
        pendingFocus.current = ADD_BUTTON_ID
      } else {
        announce(`Restored profile ${current.name}.`)
        pendingFocus.current = editButtonId(current.recordId)
      }
    } catch (error) {
      announce(`Couldn't undo: ${String(error)}`)
    }
  }

  const restore = async (profile: Profile) => {
    const name = describeProfile(profile)
    try {
      await write((r) => r.restore('searchProfiles', profile.id))
      announce(`Restored profile ${name}.`)
      pendingFocus.current = editButtonId(profile.id)
    } catch (error) {
      announce(`Couldn't restore ${name}: ${String(error)}`)
    }
  }

  const latest =
    dialog?.mode === 'edit' ? (profiles.find((p) => p.id === dialog.record.id) ?? null) : null

  return (
    <Page title="Targets">
      <p>
        Targets tell the search what to look for. Shared targets apply to every active profile; each
        profile can add to them or replace them.
      </p>

      <SharedTargetsForm latest={shared} fields={sharedSpecs} />

      <section aria-labelledby={`${captionId}-heading`} className="panel">
        <h2 id={`${captionId}-heading`}>Search profiles</h2>
        <p className="hint">
          One per search. To look in other places, duplicate a profile and change its locations.
        </p>
        <div className="toolbar">
          <button
            type="button"
            id={ADD_BUTTON_ID}
            className="primary"
            onClick={() => setDialog({ mode: 'add', defaults: newProfile() })}
          >
            Add profile
          </button>
        </div>

        {notice && (
          <div className="notice">
            <p>Deleted profile {notice.name}.</p>
            <button
              type="button"
              id={UNDO_BUTTON_ID}
              aria-label={`Undo delete of profile ${notice.name}`}
              onClick={() => undo(notice)}
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => {
                setNotice(null)
                pendingFocus.current = ADD_BUTTON_ID
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {profiles.length === 0 ? (
          <p>No profiles yet. Use Add profile to describe your first search.</p>
        ) : (
          <>
            <p id={countId} className="hint">
              {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'}
            </p>
            <ul className="card-list" aria-labelledby={countId}>
              {profiles.map((profile) => (
                <li key={profile.id}>
                  <ProfileCard
                    profile={profile}
                    fields={profileSpecs}
                    editButtonId={editButtonId(profile.id)}
                    onEdit={() => setDialog({ mode: 'edit', record: profile })}
                    onDuplicate={() =>
                      setDialog({ mode: 'duplicate', defaults: duplicateOf(profile) })
                    }
                    onDelete={() => remove(profile)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {deleted.length > 0 && (
          <details className="deleted-profiles">
            <summary>Recently deleted profiles ({deleted.length})</summary>
            <ul>
              {deleted.map((profile) => (
                <li key={profile.id}>
                  {describeProfile(profile)}{' '}
                  <button
                    type="button"
                    aria-label={`Restore profile ${describeProfile(profile)}`}
                    onClick={() => restore(profile)}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {dialog && (
        <ProfileDialog
          key={dialog.mode === 'edit' ? dialog.record.id : dialog.mode}
          opened={dialog.mode === 'edit' ? dialog.record : null}
          latest={latest}
          defaults={dialog.mode === 'edit' ? newProfile() : dialog.defaults}
          fields={profileSpecs}
          overrides={overrideSpecs}
          sharedFields={sharedSpecs}
          shared={shared}
          onClose={() => setDialog(null)}
        />
      )}
    </Page>
  )
}
