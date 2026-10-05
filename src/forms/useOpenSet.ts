import { useState } from 'react'

/** Which collapsible rows are open, by key, with "expand all" and "collapse all". */
export function useOpenSet(initial: () => Iterable<string>) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initial()))
  return {
    isOpen: (key: string) => open.has(key),
    setOpen: (key: string, isOpen: boolean) =>
      setOpen((current) => {
        const next = new Set(current)
        if (isOpen) next.add(key)
        else next.delete(key)
        return next
      }),
    openAll: (keys: Iterable<string>) => setOpen(new Set(keys)),
    closeAll: () => setOpen(new Set()),
  }
}
