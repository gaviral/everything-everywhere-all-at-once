// Where this map runs, as the core says at /room (core/src/main.rs `room_info`), and the words that depend on it.
// On a laptop the map and the AI key live on that computer; hosted (`E2A2O_HOSTED=1`, set by a deploy) they live
// on the site's server, so no line may send someone to a .env file or "the host's computer" there. Off a Mac, or
// hosted, a dated item saves as a calendar file (.ics) instead of going to Reminders or Calendar.
// Pure rules here (scripts/hosted-check.mjs holds them); room.tsx provides the context.
import { createContext, useContext } from "react";
import { dated } from "./action-line";
import { saveFile } from "./save-file";

export type Model = { step: string; model: string };
/** A sample map the empty map offers (core/src/sample.rs `SAMPLES`): its file's name and what its button says. */
export type SampleChoice = { id: string; label: string };
export type Site = { hosted: boolean; calendarFile: boolean; sample: boolean; samples: SampleChoice[]; models: Model[] };
export type SiteDoor = { hosted?: boolean; calendar_file?: boolean; sample?: boolean; samples?: SampleChoice[]; models?: Model[] };

/** Before the core answers, or a core from before these fields: a laptop, as it always was. */
export const LOCAL: Site = { hosted: false, calendarFile: false, sample: false, samples: [], models: [] };

export function siteFrom(door: SiteDoor | null): Site {
  if (!door) return LOCAL;
  return { hosted: !!door.hosted, calendarFile: !!door.calendar_file, sample: !!door.sample, samples: door.samples ?? [], models: door.models ?? [] };
}

/** The shorter sample maps under "Try a sample map" (which opens the first, the student's week): each another moment
 *  where talking into a live map helps. None when the core offers only the one, or is from before the choice. */
export function moreSamples(samples: SampleChoice[]): SampleChoice[] {
  return samples.slice(1);
}

export const SiteContext = createContext<Site>(LOCAL);
export const useSite = () => useContext(SiteContext);

/** Where your thoughts are kept, for the room menu: on the host's computer, or on the site's server. */
export function savedWhere(hosted: boolean): string {
  return hosted ? "Your thoughts are saved with your account, on this site's server." : "Your thoughts are saved on the host's computer.";
}

/** The hosted site's daily limit: past it, the site's proxy starts each core without the key until midnight Pacific
 *  and follows the core's "MODEL_API_KEY is not set" with a line of its own that starts with these words. */
const RESTING = "Today's free tries are used up";
export const isResting = (message: string) => message.startsWith(RESTING);

/** What a missing or refused AI key means, and who can fix it: on a laptop you, in .env; hosted, the site's owner.
 *  `resting`: the key is held back for the rest of the day (the daily limit), so nothing needs fixing: it says when. */
export function keyWords(hosted: boolean, refused: boolean, what: "notice" | "mic" | "tour", resting = false): string {
  if (resting && !refused) {
    if (what === "mic") return `${RESTING}, so listening is off until tomorrow. You can still type.`;
    if (what === "tour") return `${RESTING}, so until tomorrow this map is for exploring. Type “where was I?”, “next one” or “palace” and press Enter.`;
    return `${RESTING} until tomorrow (midnight Pacific). You can browse the map and type; what you type is placed then.`;
  }
  if (hosted) {
    const why = refused ? "This site's AI key was refused" : "This site has no AI key right now";
    if (what === "mic") return `${why}, so listening is off. You can still type.`;
    if (what === "tour") return `${why}, so this map is for exploring. Type “where was I?”, “next one” or “palace” and press Enter.`;
    return `${why}: you can browse the map, but new thoughts and listening are off until its owner fixes it.`;
  }
  if (what === "mic") return refused ? "The AI key was refused: check MODEL_API_KEY in .env. You can still type." : "No AI key: listening needs MODEL_API_KEY in .env. You can still type.";
  if (what === "tour") return "Without an AI key, this map is for exploring. Type “where was I?”, “next one” or “palace” and press Enter. To talk and add thoughts, put MODEL_API_KEY in .env.";
  return refused ? "The AI key was refused. Check MODEL_API_KEY in .env, then restart." : "No AI key: you can browse the map, but new thoughts and listening need MODEL_API_KEY in .env (see .env.example).";
}

/** A core message about the key (it names MODEL_API_KEY, as core/src/model.rs says it), in this site's words. */
export function siteText(text: string, hosted: boolean): string {
  return hosted && text.includes("MODEL_API_KEY") ? keyWords(true, text.includes("refused"), "notice") : text;
}

/** "muse-spark-1.2-contributor" → "Muse Spark 1.2": the public name (Contributor mode is how the key asks). */
export function modelName(id: string): string {
  return id.split("-").filter((part) => part && part !== "contributor")
    .map((part) => (/^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1))).join(" ");
}

/** The first screen's line: which Meta model does what, as the core asks them, in the end card's words (one model, its
 *  steps together: "Tidies, builds, recaps: Muse Spark 1.3"), so the video's first and last frames name them alike.
 *  Empty without a key (none runs). */
export function modelsLine(models: Model[]): string {
  const groups = new Map<string, string[]>();
  for (const m of models) groups.set(modelName(m.model), [...(groups.get(modelName(m.model)) ?? []), m.step]);
  return [...groups].map(([name, steps]) => {
    const said = steps.join(", ");
    return `${said[0].toUpperCase()}${said.slice(1)}: ${name}`;
  }).join(" · ");
}

/** A dated item as a calendar file: one all-day event, which Apple, Google and Outlook calendars open. Null without a
 *  real day (a calendar can't hold it). `now` stamps the file. */
export function icsFor(action: { id: string; title: string; when: string }, now: Date): string | null {
  if (!dated(action.when)) return null;
  const [y, m, d] = action.when.trim().split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const date = (t: Date) => t.toISOString().slice(0, 10).replace(/-/g, "");
  const end = new Date(start.getTime() + 86_400_000);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  // Text values escape \ ; , and line breaks (RFC 5545 §3.3.11).
  const text = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//E2A2O//Thread map//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${action.id}-${date(start)}@e2a2o`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${date(start)}`, `DTEND;VALUE=DATE:${date(end)}`,
    `SUMMARY:${text(action.title)}`, "TRANSP:TRANSPARENT", "END:VEVENT", "END:VCALENDAR"];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A content line longer than 75 bytes continues on the next, after a space (RFC 5545 §3.1), never inside a character. */
function fold(line: string): string {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const parts: string[] = [];
  let part = "";
  for (const ch of line) {
    if (bytes(part + ch) > (parts.length ? 74 : 75)) { parts.push(part); part = ""; }
    part += ch;
  }
  parts.push(part);
  return parts.join("\r\n ");
}

/** The file's name: the title's words, so a Downloads folder says what it is. */
export function icsName(title: string): string {
  const words = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
  return `${words || "event"}.ics`;
}

/** Saves a calendar file through the browser; false when there's no day to put on a calendar. */
export function downloadIcs(action: { id: string; title: string; when: string }): boolean {
  const ics = icsFor(action, new Date());
  if (!ics) return false;
  saveFile(ics, "text/calendar;charset=utf-8", icsName(action.title));
  return true;
}
