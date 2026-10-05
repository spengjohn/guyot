import { useEffect, useRef, type MouseEvent } from 'react'
import { DashboardPage } from '../pages/DashboardPage'
import { DataPage } from '../pages/DataPage'
import { DeletedPage } from '../pages/DeletedPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { TargetsPage } from '../pages/TargetsPage'
import { TrackerPage } from '../pages/TrackerPage'
import { hrefFor, type Route } from './routes'
import { ThemeToggle } from './ThemeToggle'
import { useHashRoute } from './useHashRoute'

const NAV: { label: string; route: Route; current: Route['page'][] }[] = [
  { label: 'Tracker', route: { page: 'tracker' }, current: ['tracker', 'deleted'] },
  { label: 'Targets', route: { page: 'targets' }, current: ['targets'] },
  { label: 'Dashboard', route: { page: 'dashboard' }, current: ['dashboard'] },
  { label: 'Your data', route: { page: 'data' }, current: ['data'] },
]

function pageFor(route: Route) {
  // A switch over a union: TypeScript checks every page is handled (see `never` below).
  switch (route.page) {
    case 'tracker':
      return <TrackerPage />
    case 'deleted':
      return <DeletedPage />
    case 'targets':
      return <TargetsPage />
    case 'dashboard':
      return <DashboardPage />
    case 'data':
      return <DataPage />
    case 'notFound':
      return <NotFoundPage />
    default: {
      const unhandled: never = route
      return unhandled
    }
  }
}

/** Skip link, header and navigation around the current page. */
export function Shell() {
  const route = useHashRoute()
  const mainRef = useRef<HTMLElement>(null)

  // When the page changes (not on first load), move focus to its heading, so screen
  // reader and keyboard users start at the top of the new page, as on a normal site.
  const shownPage = useRef(route.page)
  useEffect(() => {
    if (shownPage.current === route.page) return
    shownPage.current = route.page
    mainRef.current?.querySelector<HTMLElement>('h1')?.focus()
  }, [route.page])

  // The skip link can't change the hash (that would be read as a route), so it moves focus itself.
  const skipToMain = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    mainRef.current?.focus()
  }

  return (
    <>
      <a className="skip-link" href="#main" onClick={skipToMain}>
        Skip to main content
      </a>
      <header className="site-header">
        <p className="brand">Guyot</p>
        <nav aria-label="Main">
          <ul>
            {NAV.map((item) => (
              <li key={item.label}>
                <a
                  href={hrefFor(item.route)}
                  aria-current={item.current.includes(route.page) ? 'page' : undefined}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <ThemeToggle />
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>
        {pageFor(route)}
      </main>
    </>
  )
}
