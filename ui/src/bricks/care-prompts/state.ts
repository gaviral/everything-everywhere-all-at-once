export const MINUTE = 60_000;
export const FREQUENCIES = [30, 60, 90] as const;
export type Frequency = typeof FREQUENCIES[number];
export type Preferences = {
  enabled: boolean;
  frequency: Frequency;
  quiet: boolean;
  start: string;
  end: string;
  nextAt: number;
  turn: number;
  water: { day: string; total: number; time: number };
};

export function localDay(now: number) {
  const date = new Date(now);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function defaults(): Preferences {
  return { enabled: false, frequency: 60, quiet: true, start: "22:00", end: "08:00", nextAt: 0, turn: 0,
    water: { day: localDay(Date.now()), total: 0, time: 0 } };
}

const validTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export const storageKey = (person: string) => `e2a2o.care-prompts.v1:${person}`;

export function readPreferences(person: string): Preferences {
  const fallback = defaults();
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(person)) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    return {
      enabled: value.enabled === true && finite(value.nextAt) && value.nextAt > 0,
      frequency: FREQUENCIES.includes(value.frequency) ? value.frequency : 60,
      quiet: value.quiet !== false,
      start: validTime(value.start) ? value.start : fallback.start,
      end: validTime(value.end) ? value.end : fallback.end,
      nextAt: finite(value.nextAt) ? value.nextAt : 0,
      turn: Number.isSafeInteger(value.turn) && value.turn >= 0 ? value.turn : 0,
      water: value.water && value.water.day === fallback.water.day && Number.isSafeInteger(value.water.total)
        && value.water.total >= 0 && finite(value.water.time) ? value.water : fallback.water,
    };
  } catch { return fallback; }
}

export function savePreferences(person: string, value: Preferences): boolean {
  try { sessionStorage.setItem(storageKey(person), JSON.stringify(value)); return true; }
  catch { return false; }
}

export function isQuiet(preferences: Preferences, now: number) {
  if (!preferences.quiet) return false;
  const date = new Date(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = minutes(preferences.start), end = minutes(preferences.end);
  // Equal times deliberately mean all day, never an accidental removal of quiet hours.
  return start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
}

export function promptDue(preferences: Preferences, now: number) {
  return preferences.enabled && preferences.nextAt > 0 && now >= preferences.nextAt && !isQuiet(preferences, now);
}

export function postpone(preferences: Preferences, now: number): Preferences {
  return { ...preferences, nextAt: now + preferences.frequency * MINUTE, turn: preferences.turn + 1 };
}

export function addWater(preferences: Preferences, now: number): Preferences {
  const day = localDay(now);
  return { ...preferences, water: { day, total: (preferences.water.day === day ? preferences.water.total : 0) + 1, time: now } };
}
