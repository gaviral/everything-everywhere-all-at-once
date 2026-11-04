import { useCallback, useEffect, useRef, useState } from "react";
import type { OriginalStroke, PenDevicesAdapter, StrokeAcknowledgment } from "./contracts";

export interface DeliveryRecord {
  readonly stroke: OriginalStroke;
  readonly state: "pending" | "acknowledged" | "unconfirmed";
  readonly acknowledgment?: StrokeAcknowledgment;
  readonly message: string;
}

/** Cancellation ends outstanding work; records stay visible and no automatic replay occurs. */
export function useStrokeDelivery(adapter: PenDevicesAdapter, enabled: boolean) {
  const [records, setRecords] = useState<readonly DeliveryRecord[]>([]);
  const pending = useRef(new Map<string, { controller: AbortController; sessionId: string }>());
  const enabledNow = useRef(enabled);
  enabledNow.current = enabled;
  const update = useCallback((id: string, patch: Partial<DeliveryRecord>) => {
    setRecords(rows => rows.map(row => row.stroke.id === id ? { ...row, ...patch } : row));
  }, []);
  useEffect(() => {
    const stopAll = () => {
      for (const { controller } of pending.current.values()) controller.abort();
      pending.current.clear();
      setRecords(rows => rows.map(row => row.state === "pending" ? { ...row, state: "unconfirmed", message: "Stopped; receipt unconfirmed" } : row));
    };
    if (!enabled) { stopAll(); return; }
    const unsubscribe = adapter.subscribe(() => {
      const sessions = adapter.getSnapshot().sessions;
      for (const [id, work] of pending.current) {
        if (sessions.find(session => session.id === work.sessionId)?.connected) continue;
        work.controller.abort();
        pending.current.delete(id);
        update(id, { state: "unconfirmed", message: "Destination disconnected; receipt unconfirmed" });
      }
    });
    return () => {
      unsubscribe();
      stopAll();
    };
  }, [adapter, enabled, update]);
  const deliver = useCallback(async (stroke: OriginalStroke) => {
    if (!enabledNow.current) return;
    const session = adapter.getSnapshot().sessions.find(item => item.id === stroke.sessionId);
    const controller = new AbortController();
    setRecords(rows => [...rows, { stroke, state: "pending", message: "Waiting for destination acknowledgment" }]);
    pending.current.set(stroke.id, { controller, sessionId: stroke.sessionId });
    try {
      if (!session?.connected) throw new Error("Destination disconnected; receipt unconfirmed");
      const receipt = await adapter.sendStroke(stroke, controller.signal);
      if (controller.signal.aborted) return;
      if (receipt.strokeId !== stroke.id || receipt.sessionId !== stroke.sessionId || !Number.isFinite(receipt.acceptedAtMs)) {
        throw new Error("Destination receipt did not match this stroke");
      }
      update(stroke.id, { state: "acknowledged", acknowledgment: receipt, message: "Acknowledged by destination" });
    } catch {
      if (!controller.signal.aborted) update(stroke.id, { state: "unconfirmed", message: "Delivery unconfirmed. Check the destination before drawing again." });
    } finally { pending.current.delete(stroke.id); }
  }, [adapter, update]);
  return { records, deliver };
}
