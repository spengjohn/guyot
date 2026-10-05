import { useId, useState, type FormEvent } from 'react'

interface Props {
  /** Tries the passphrase; resolves false if it doesn't open the file. */
  onUnlock: (passphrase: string) => Promise<boolean>
  onCancel: () => void
}

/** Asks for the passphrase of an encrypted file being imported. */
export function UnlockForm({ onUnlock, onCancel }: Props) {
  const id = useId()
  const [passphrase, setPassphrase] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const ok = await onUnlock(passphrase)
      setWrong(!ok)
      if (ok) setPassphrase('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-passphrase`}>Passphrase for this file</label>
        <input
          id={`${id}-passphrase`}
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          {...(wrong
            ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` }
            : { 'aria-describedby': `${id}-hint` })}
        />
        {wrong ? (
          <p id={`${id}-error`} className="field-error" role="alert">
            That passphrase doesn’t open this file (or the file was changed). Check it and try
            again.
          </p>
        ) : (
          <p id={`${id}-hint`} className="hint">
            The passphrase chosen when the file was downloaded. Nothing is changed until you confirm
            the import.
          </p>
        )}
      </div>
      <div className="actions">
        <button type="submit" className="primary">
          {busy ? 'Opening…' : 'Open file'}
        </button>
        <button type="button" onClick={onCancel}>
          Choose another file
        </button>
      </div>
    </form>
  )
}
