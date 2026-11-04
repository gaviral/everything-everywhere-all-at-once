import { useEffect, useState } from "react";
import { addWater, MINUTE, postpone, readPreferences, savePreferences, type Preferences } from "./state";

export function useCare(person: string, settingsOpen: boolean) {
  const [preferences, setPreferences] = useState(() => readPreferences(person));
  const [saved, setSaved] = useState(true);
  const [now, setNow] = useState(Date.now);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const update = (next: Preferences) => {
    setPreferences(next);
    setSaved(savePreferences(person, next));
    setNow(Date.now());
  };
  useEffect(() => {
    const refresh = () => { setNow(Date.now()); setVisible(document.visibilityState === "visible"); };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const timer = preferences.enabled || settingsOpen ? window.setInterval(refresh, 1000) : null;
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [preferences.enabled, settingsOpen]);
  return {
    preferences, saved, now, visible,
    configure: (patch: Partial<Preferences>) => update({ ...preferences, ...patch,
      nextAt: preferences.enabled ? Date.now() + (patch.frequency ?? preferences.frequency) * MINUTE : 0 }),
    start: () => update({ ...preferences, enabled: true, nextAt: Date.now() + preferences.frequency * MINUTE }),
    stop: () => update({ ...preferences, enabled: false, nextAt: 0 }),
    dismiss: () => update(postpone(preferences, Date.now())),
    water: () => update(addWater(preferences, Date.now())),
  };
}
