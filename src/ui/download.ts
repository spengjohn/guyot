/**
 * Saves text as a file through the browser's normal download. The text becomes a Blob
 * (file-like data held in memory), the Blob gets a temporary object URL, and a link to
 * it is clicked. Nothing is sent anywhere: the data never leaves this browser.
 */
export function downloadText(text: string, fileName: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0) // free the memory once the download starts
}

/** 'guyot-backup-2026-10-04-1430.json', using this device's local date and time. */
export function backupFileName(at: number): string {
  const date = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `guyot-backup-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.json`
}
