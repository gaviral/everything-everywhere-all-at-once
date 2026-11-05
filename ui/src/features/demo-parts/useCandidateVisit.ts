import { useLayoutEffect, useRef, useState } from 'react'

export function useCandidateVisit(candidateIds: readonly string[]) {
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const returnId = useRef<string | null>(null)
  const available = inspectedId !== null && candidateIds.includes(inspectedId)
  useLayoutEffect(() => {
    if (inspectedId !== null && !available) setInspectedId(null)
    if (available || returnId.current === null) return
    const button = buttons.current.get(returnId.current) ?? buttons.current.values().next().value
    button?.focus()
    returnId.current = null
  }, [available, inspectedId])
  return {
    inspectedId: available ? inspectedId : null,
    inspect(id: string) { returnId.current = id; setInspectedId(id) },
    onReturn() { setInspectedId(null) },
    inspectRef: (id: string) => (button: HTMLButtonElement | null) => {
      if (button) buttons.current.set(id, button)
      else buttons.current.delete(id)
    },
  }
}
