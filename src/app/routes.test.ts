import { describe, expect, it } from 'vitest'
import { hrefFor, parseRoute } from './routes'

describe('routes', () => {
  it('reads each page from the hash', () => {
    expect(parseRoute('#/tracker')).toEqual({ page: 'tracker' })
    expect(parseRoute('#/tracker/deleted')).toEqual({ page: 'deleted' })
    expect(parseRoute('#/targets/')).toEqual({ page: 'targets' })
    expect(parseRoute('#/dashboard')).toEqual({ page: 'dashboard' })
  })

  it('treats an empty hash as the tracker and anything else as not found', () => {
    expect(parseRoute('')).toEqual({ page: 'tracker' })
    expect(parseRoute('#')).toEqual({ page: 'tracker' })
    expect(parseRoute('#/nope')).toEqual({ page: 'notFound' })
    expect(parseRoute('#/not-found')).toEqual({ page: 'notFound' })
  })

  it('builds links that parse back to the same route', () => {
    for (const page of ['tracker', 'deleted', 'targets', 'dashboard'] as const) {
      expect(parseRoute(hrefFor({ page }))).toEqual({ page })
    }
  })
})
