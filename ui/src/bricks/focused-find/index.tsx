import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { BrickProps } from "../contract";
import { filterSources, hasFilter, sourceFields, type Source } from "./rules";
import "./focused-find.css";

const Result = memo(function Result({ source, ai, open }: { source: Source; ai: boolean; open: (id: string) => void }) {
  const { thought, title, date } = source;
  return <li className="focused-find-result" data-focused-thought={thought.id}>
    <p className="focused-find-point">{thought.point || thought.text}</p>
    <p className="focused-find-meta">{title} · {ai ? "✦ " : ""}{thought.speaker || "Unknown speaker"} · <time dateTime={source.day || undefined}>{date}</time></p>
    <details className="focused-find-original"><summary>Exact original words</summary><p>{thought.text}</p></details>
    <button type="button" onClick={() => open(thought.id)}>Open original</button>
  </li>;
});

export default function FocusedFind({ map, actions }: BrickProps) {
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [limit, setLimit] = useState(50);
  const input = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(query);
  const sources = useMemo(() => sourceFields(map.thoughts, map.threads), [map.thoughts, map.threads]);
  const speakers = useMemo(() => [...new Set(sources.map((source) => source.thought.speaker))].sort(), [sources]);
  const themes = useMemo(() => [...new Set(sources.map((source) => source.theme))].sort(), [sources]);
  const filters = { query, speaker, theme, day };
  const chosen = hasFilter(filters);
  const search = query.trim() ? deferred : "";
  const matches = useMemo(() => filterSources(sources, { query: search, speaker, theme, day }), [sources, search, speaker, theme, day]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  const clear = () => { setQuery(""); setSpeaker(null); setTheme(null); setDay(""); setLimit(50); input.current?.focus(); };
  return <section className="focused-find" aria-label="Find within the map" onKeyDown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); actions.closeView(); }
  }}>
    <div className="focused-find-top"><h1>Focused find</h1><button type="button" onClick={actions.closeView}>Close</button></div>
    <form className="focused-find-form" onSubmit={(event) => event.preventDefault()}>
      <label className="focused-find-words">Words<input ref={input} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(50); }} /></label>
      <label>Speaker<select value={speaker === null ? "" : JSON.stringify(speaker)} onChange={(event) => { setSpeaker(event.target.value ? JSON.parse(event.target.value) : null); setLimit(50); }}>
        <option value="">All</option>{[...new Set([...speakers, ...(speaker !== null ? [speaker] : [])])].map((name) => <option key={name} value={JSON.stringify(name)}>{name || "Unknown speaker"}</option>)}
      </select></label>
      <label>Theme<select value={theme === null ? "" : JSON.stringify(theme)} onChange={(event) => { setTheme(event.target.value ? JSON.parse(event.target.value) : null); setLimit(50); }}>
        <option value="">All</option>{[...new Set([...themes, ...(theme !== null ? [theme] : [])])].map((name) => <option key={name} value={JSON.stringify(name)}>{name || "No theme"}</option>)}
      </select></label>
      <label>Day<input type="date" value={day} onChange={(event) => { setDay(event.target.value); setLimit(50); }} /></label>
      <button type="button" onClick={clear}>Clear filters</button>
    </form>
    <p className="focused-find-status" role="status" aria-live="polite">{!chosen ? "Choose a filter or type words" : !matches.length ? "No matching thoughts" : `Showing ${Math.min(limit, matches.length)} of ${matches.length} matching thoughts`}{query !== deferred && " · Updating…"}</p>
    {chosen && <ol className="focused-find-results">{matches.slice(0, limit).map((source) => <Result key={source.thought.id} source={source} ai={map.speakers.get(source.thought.speaker)?.ai ?? false} open={actions.openThought} />)}</ol>}
    {matches.length > limit && <button type="button" onClick={() => setLimit((was) => was + 50)}>Show next 50</button>}
  </section>;
}
