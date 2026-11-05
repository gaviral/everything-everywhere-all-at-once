import { useEffect, useState } from "react";
import { EXAMPLE_TURNS } from "./example";

const OPENING_TURNS = 4;

/** One clock advances one speaker's words; cleanup owns every pending tick. */
export function usePlayback(enabled: boolean) {
  const [count, setCount] = useState(OPENING_TURNS);
  const [words, setWords] = useState(0);
  const [playing, setPlaying] = useState(false);
  const next = EXAMPLE_TURNS[count];
  const wordCount = next?.text.split(" ").length ?? 0;
  useEffect(() => {
    if (!enabled || !playing || !next) return;
    const timer = window.setTimeout(() => {
      if (words < wordCount) setWords(words + 1);
      else { setWords(0); setCount(count + 1); }
    }, words === wordCount ? 850 : 190);
    return () => window.clearTimeout(timer);
  }, [enabled, playing, next, words, wordCount, count]);
  return {
    turns: EXAMPLE_TURNS.slice(0, count),
    partial: next && words ? { ...next, text: next.text.split(" ").slice(0, words).join(" ") } : null,
    playing: enabled && playing && !!next,
    done: !next,
    play: () => setPlaying(value => !value),
    replay: () => { setCount(0); setWords(0); setPlaying(true); },
    pause: () => setPlaying(false),
    progress: (count + (wordCount ? words / wordCount : 0)) / EXAMPLE_TURNS.length,
  };
}
