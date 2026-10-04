import { Page } from '../app/Page'
import { hrefFor } from '../app/routes'

export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <p>
        There's no page at this address.{' '}
        <a href={hrefFor({ page: 'tracker' })}>Go to the tracker</a>.
      </p>
    </Page>
  )
}
