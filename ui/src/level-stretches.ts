// Stretches of talk in the `?level` meter's readings (Level.tsx), so a minute of normal talk, a raised voice and a
// shout gives each voice's typical reading. Where a voice starts and ends is found relative to the voice and to the
// room between voices, not at a fixed level: after the browser's processing, a room can read above 0.01.

/** A reading arrives every 320 ms while the mic is on (apps-audio.ts). */
export const READING_MS = 320;
/** About a second: quiet this long ends a stretch (longer than a breath between sentences, shorter than the pause
 * between voices the test asks for), and a stretch shorter than this (a cough) isn't a voice to measure. */
export const SECOND = Math.round(1000 / READING_MS);
// Under the lowest level an app can use (0.01, composition_schema in apps.rs) is quiet in any room.
const QUIET = 0.01;
// A voice keeps within a factor of two of itself: in the 24 synthesized clips (6 voices, 4 texts, 2026-11-01), no
// second fell under 0.54 of the two seconds before it, and past the first words none rose over 1.45 of all before it.
// So a second under half is a pause, a second at twice is a new, louder sound, and twice the room is a voice.
const APART = 2;
// A pause is judged against the voice's last two seconds, not all of it: in headless Chrome, after a quiet stretch
// with other talk in it, the browser's auto gain let a voice in loud and halved it within about 3 s (2026-11-01).
const RECENT = 2 * SECOND;

export type Stretch = { typical: number; seconds: number };

function median(readings: number[]) {
  const sorted = [...readings].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// The median, as apps.rs's voices were measured: a reading at the voice's usual level, short dips included.
function stretchOf(readings: number[]): Stretch {
  return { typical: median(readings), seconds: (readings.length * READING_MS) / 1000 };
}

/** Splits readings into stretches of talk: `feed` each one, `end` when they stop (the mic went off), and each
 * stretch long enough to measure goes to `onStretch` as it ends. */
export function splitTalk(onStretch: (stretch: Stretch) => void) {
  // The stretch so far; its last `quiet` readings (a pause beginning) or `louder` ones (a new voice) are in doubt.
  let voice: number[] = [];
  let quiet = 0;
  let louder = 0;
  // The last pause's readings: null until the mic has heard one, while the room isn't known yet.
  let room: number[] | null = null;
  const spoken = () => voice.slice(0, voice.length - quiet - louder);
  const close = () => {
    if (spoken().length >= SECOND) onStretch(stretchOf(spoken()));
    voice = [];
    quiet = louder = 0;
  };
  return {
    feed(level: number) {
      const roomLevel = room ? median(room) : 0;
      if (!voice.length) {
        if (level >= Math.max(QUIET, roomLevel * APART)) voice = [level];
        else room = [...(room ?? []), level].slice(-SECOND);
        return;
      }
      const typical = median(spoken());
      const lately = median(spoken().slice(-RECENT));
      voice.push(level);
      // Back near the room counts as quiet too, so a click that started a stretch can't keep it going on the room.
      quiet = level < Math.max(QUIET, lately / APART, roomLevel * APART) ? quiet + 1 : 0;
      // A second at twice the stretch's typical is a voice over what came before: the room's own sound, which can
      // start a stretch before the first pause or in a noisy one. The stretch starts again there.
      louder = level >= typical * APART ? louder + 1 : 0;
      if (quiet >= SECOND) {
        const pause = voice.slice(-quiet);
        close();
        room = pause;
      } else if (louder >= SECOND) {
        voice = voice.slice(-louder);
        louder = 0;
      }
    },
    current: (): Stretch | null => (spoken().length ? stretchOf(spoken()) : null),
    end() {
      close();
      // A mic that starts again starts its auto gain again too, so the room is learned again.
      room = null;
    },
  };
}
