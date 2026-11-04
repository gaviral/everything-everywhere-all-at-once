import { useEffect, useState } from "react";
import { emptyLedger, readLedger, type Entry, type Ledger } from "./model";
import { exampleLedger } from "./example";

type Loaded = { ledger: Ledger; raw: string | null; error: string };
function load(key: string | null, example: boolean): Loaded {
  if (example) return { ledger: exampleLedger, raw: null, error: "" };
  if (!key) return { ledger: emptyLedger(), raw: null, error: "Waiting for the map identity before saving." };
  try {
    const raw = localStorage.getItem(key);
    return { ledger: readLedger(raw), raw, error: "" };
  } catch {
    return { ledger: emptyLedger(), raw: null, error: "Saved history could not be read. It has been kept untouched; saving is paused." };
  }
}

export function useLedger(key: string | null, example: boolean) {
  const [loaded, setLoaded] = useState(() => load(key, example));
  useEffect(() => {
    if (!key || example) return;
    const refresh = (event: StorageEvent) => { if (event.key === key || event.key === null) setLoaded(load(key, false)); };
    addEventListener("storage", refresh);
    return () => removeEventListener("storage", refresh);
  }, [key, example]);
  const append = (entry: Entry): boolean => {
    if (loaded.error) return false;
    const next: Ledger = { version: 1, entries: [...loaded.ledger.entries, entry] };
    try {
      const raw = JSON.stringify(next);
      readLedger(raw);
      if (!example) {
        if (!key) return false;
        if (localStorage.getItem(key) !== loaded.raw) {
          setLoaded({ ...load(key, false), error: "History changed in another tab. Close this form and reopen the view before saving." });
          return false;
        }
        localStorage.setItem(key, raw);
      }
      setLoaded({ ledger: next, raw, error: "" });
      return true;
    } catch {
      setLoaded(old => ({ ...old, error: "History was not saved. Browser storage may be full or unavailable. Your previous history is unchanged; reopen this view to try again." }));
      return false;
    }
  };
  return { ledger: loaded.ledger, error: loaded.error, append };
}
