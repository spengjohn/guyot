/**
 * The app's pages. Routes live in the URL hash ('#/tracker') so a reload works on
 * static hosting: the server only ever sees '/'.
 */
export type Route =
  | { page: 'tracker' }
  | { page: 'deleted' } // recently deleted applications
  | { page: 'targets' }
  | { page: 'dashboard' }
  | { page: 'data' } // export, import and backups
  | { page: 'notFound' }

const PATHS: Record<Route['page'], string> = {
  tracker: '/tracker',
  deleted: '/tracker/deleted',
  targets: '/targets',
  dashboard: '/dashboard',
  data: '/data',
  notFound: '/not-found',
}

/** Reads a route from a location hash. An empty hash is the tracker, the home page. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '') || '/tracker'
  for (const [page, pagePath] of Object.entries(PATHS)) {
    if (page !== 'notFound' && pagePath === path) return { page } as Route // page came from PATHS
  }
  return { page: 'notFound' }
}

/** The href for a link to a route, such as '#/tracker'. */
export function hrefFor(route: Route): string {
  return `#${PATHS[route.page]}`
}
