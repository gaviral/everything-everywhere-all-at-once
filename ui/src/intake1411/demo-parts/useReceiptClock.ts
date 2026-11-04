import { useEffect, useState } from 'react'
import type { EvidenceReceipt } from './contracts'
import { nextProofExpiry } from './readiness'

/** One deadline, no polling. Unmounting cancels the pending deadline. */
export function useReceiptClock(receipts: readonly EvidenceReceipt[]) {
  const [tick, setTick] = useState(0)
  const now = Date.now()
  const expiry = nextProofExpiry(receipts, now)
  useEffect(() => {
    if (expiry === undefined) return
    const timeout = window.setTimeout(() => setTick(value => value + 1), Math.min(2_147_483_647, Math.max(1, expiry - Date.now())))
    return () => window.clearTimeout(timeout)
  }, [expiry, tick])
  return now
}
