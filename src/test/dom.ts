// Setup for component tests, which run in jsdom (a browser imitation in Node).
// Import this first in any test file that starts with `// @vitest-environment jsdom`.
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup() // unmount what the test rendered
  window.location.hash = ''
})

// jsdom may not implement modal dialogs. This stand-in opens and closes them (and fires
// 'close', as browsers do); focus trapping and Esc are the browser's job, not tested here.
const dialog = HTMLDialogElement.prototype
if (typeof dialog.showModal !== 'function') {
  dialog.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  dialog.close = function (this: HTMLDialogElement) {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
