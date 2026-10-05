import { useId, useState, type FormEvent } from 'react'
import { encryptText, MIN_PASSPHRASE_LENGTH, passphraseProblem } from '../data/crypto'
import { downloadText } from '../ui/download'

interface Props {
  /** The download button's label, e.g. "Download encrypted copy". */
  encryptLabel: string
  /** Produces the file's plain text and name when the user downloads. */
  getFile: () => Promise<{ text: string; fileName: string }>
  /** Called after the download starts, saying whether it was encrypted. */
  onSaved: (encrypted: boolean) => void
}

/**
 * Downloads a file encrypted with a passphrase (docs/decisions/0016). An unencrypted
 * download is possible, but only from a closed section, after a warning and an "I
 * understand" box. The passphrase is never stored, and is cleared after use.
 */
export function SaveFileForm({ encryptLabel, getFile, onSaved }: Props) {
  const id = useId()
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [problem, setProblem] = useState<{ field: 'passphrase' | 'confirm'; text: string } | null>(
    null,
  )
  const [understood, setUnderstood] = useState(false)
  const [plainProblem, setPlainProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const saveEncrypted = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const issue = passphraseProblem(passphrase, confirmation)
    if (issue) {
      setProblem({
        field: passphrase.length < MIN_PASSPHRASE_LENGTH ? 'passphrase' : 'confirm',
        text: issue,
      })
      return
    }
    setProblem(null)
    setBusy(true)
    try {
      const { text, fileName } = await getFile()
      const sealed = await encryptText(text, passphrase)
      downloadText(JSON.stringify(sealed), fileName.replace(/\.json$/, '-encrypted.json'))
      setPassphrase('')
      setConfirmation('')
      onSaved(true)
    } catch (error) {
      setProblem({ field: 'passphrase', text: `Couldn't save the file: ${String(error)}` })
    } finally {
      setBusy(false)
    }
  }

  const savePlain = async () => {
    if (busy) return
    if (!understood) {
      setPlainProblem('Tick the box above first, to confirm you understand the risk.')
      return
    }
    setPlainProblem(null)
    setBusy(true)
    try {
      const { text, fileName } = await getFile()
      downloadText(text, fileName)
      setUnderstood(false)
      onSaved(false)
    } finally {
      setBusy(false)
    }
  }

  const errorFor = (field: 'passphrase' | 'confirm') =>
    problem?.field === field
      ? { 'aria-invalid': true, 'aria-describedby': `${id}-${field}-error ${id}-hint` }
      : { 'aria-describedby': `${id}-hint` }

  return (
    <div className="save-file">
      <form onSubmit={saveEncrypted} noValidate>
        <p id={`${id}-hint`} className="hint">
          At least {MIN_PASSPHRASE_LENGTH} characters. Write it down somewhere safe: a lost
          passphrase can’t be recovered, and the file can’t be opened without it.
        </p>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-passphrase`}>Passphrase</label>
            <input
              id={`${id}-passphrase`}
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              {...errorFor('passphrase')}
            />
            {problem?.field === 'passphrase' && (
              <p id={`${id}-passphrase-error`} className="field-error">
                {problem.text}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-confirm`}>Passphrase again</label>
            <input
              id={`${id}-confirm`}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              {...errorFor('confirm')}
            />
            {problem?.field === 'confirm' && (
              <p id={`${id}-confirm-error`} className="field-error">
                {problem.text}
              </p>
            )}
          </div>
        </div>
        <button type="submit" className="primary">
          {busy ? 'Encrypting…' : encryptLabel}
        </button>
      </form>

      <details className="unencrypted">
        <summary>Download without encryption (strongly recommended against)</summary>
        <p className="warning">
          <strong>Unencrypted files are strongly recommended against.</strong> Anyone who gets the
          file (from a shared computer, an email, a cloud folder) can read all your data, including
          your notes and eligibility notes.
        </p>
        <div className="check">
          <input
            type="checkbox"
            id={`${id}-understood`}
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          <label htmlFor={`${id}-understood`}>
            I understand that anyone who gets this file can read all of it
          </label>
        </div>
        <button
          type="button"
          aria-disabled={!understood}
          aria-describedby={plainProblem ? `${id}-plain-error` : undefined}
          onClick={savePlain}
        >
          Download unencrypted
        </button>
        {plainProblem && (
          <p id={`${id}-plain-error`} className="field-error">
            {plainProblem}
          </p>
        )}
      </details>
    </div>
  )
}
