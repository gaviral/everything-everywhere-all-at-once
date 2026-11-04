import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BrickProps, Thought } from "../contract";
import { cacheKey, content, fallback, groupsOf, parentLine, words } from "./terse-text";
import "./terse.css";

// Disposable, memory-only: never journaled or used for routing.
const cache = new Map<string, string>();
function Emphasis({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((part, i) => part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</>;
}
export function Terse({ map, actions }: BrickProps) {
  const [time, setTime] = useState(!!map.conversationSpine);
  const [folded, setFolded] = useState(new Set<string>());
  const [original, setOriginal] = useState<Thought | null>(null);
  const [revision, refresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const groups = useMemo(() => groupsOf(map, time), [map.thoughts, map.threads, time]);
  const parent = (t: Thought) => map.threads.find(thread => thread.id === t.thread_id)?.title ?? "";
  const line = (t: Thought) => cache.get(cacheKey(t, parent(t))) ?? fallback(content(t));
  useEffect(() => setTime(!!map.conversationSpine), [map.conversationSpine]);
  useEffect(() => { if (original) dialog.current?.showModal(); }, [original]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let timer = 0, disposed = false, busy = false;
    let request: AbortController | null = null;
    let inFlight: Thought[] = [];
    const visible = new Set<string>();
    const attempted = new Set<string>();
    const schedule = () => { clearTimeout(timer); timer = window.setTimeout(run, 650); };
    const run = async () => {
      if (disposed || busy || map.partial) return;
      const batch = map.thoughts.filter(t => visible.has(t.id) && !cache.has(cacheKey(t, parent(t))) && !attempted.has(cacheKey(t, parent(t)))).slice(0, 12);
      if (!batch.length) return;
      busy = true;
      inFlight = batch;
      request = new AbortController();
      for (const t of batch) attempted.add(cacheKey(t, parent(t)));
      try {
        const response = await fetch(`/terse${location.search}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: batch.map(t => t.id) }), signal: request.signal });
        if (response.ok) {
          const result = await response.json() as { retry?: boolean; lines?: { id: string; source: string; parent: string; line: string }[] };
          if (result.retry) for (const t of batch) attempted.delete(cacheKey(t, parent(t)));
          for (const row of result.lines ?? []) {
            const thought = batch.find(t => t.id === row.id);
            if (thought && row.source === content(thought) && row.parent === parent(thought) && words(row.line) <= 12 && row.line.trim()) cache.set(cacheKey(thought, row.parent), row.line);
          }
          if (!disposed) refresh(n => n + 1);
        }
      } catch { /* Keep the cut, quietly. */ }
      busy = false;
      inFlight = [];
      if (!disposed) timer = window.setTimeout(run, 2000);
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { const id = (entry.target as HTMLElement).dataset.terseId!; if (entry.isIntersecting) visible.add(id); else visible.delete(id); }
      if (request && busy && inFlight.some(t => !visible.has(t.id))) {
        request.abort();
        for (const t of inFlight) attempted.delete(cacheKey(t, parent(t)));
      }
      schedule();
    }, { root: element, threshold: 0.1 });
    element.querySelectorAll<HTMLElement>("[data-terse-id]").forEach(e => observer.observe(e));
    return () => { disposed = true; clearTimeout(timer); observer.disconnect(); request?.abort(); };
  }, [map.thoughts, map.threads, map.partial, folded, time]);
  const all = groups.flatMap(g => g.thoughts);
  const [here, setHere] = useState(0);
  useLayoutEffect(() => {
    const labels = root.current?.querySelectorAll('.spine-terse-parent strong, .spine-terse-theme, .spine-terse-words') ?? [];
    setHere([...labels].reduce((sum, label) => sum + words(label.textContent ?? ""), 0));
  }, [groups, folded, time, revision]);
  const full = all.reduce((n,t) => n + words(content(t)), 0);
  const groupView = (group: typeof groups[number], i: number, children?: React.ReactNode) => {
    const key = `${group.id}:${i}`, closed = folded.has(key);
    return <section className="spine-terse-group" key={key}>
      <button className="spine-terse-parent" aria-expanded={!closed} onClick={() => setFolded(was => { const next = new Set(was); if (closed) next.delete(key); else next.add(key); return next; })}>
        <span aria-hidden="true">{closed ? "▸" : "▾"}</span><strong>{parentLine(group.title)}</strong>{group.thoughts.length > 0 && <small>{group.thoughts.length}</small>}
      </button>
      {!closed && <ul>{group.thoughts.map(t => <li key={t.id}><button className="spine-terse-line" data-terse-id={t.id} onClick={() => { setOriginal(t); actions.readThought?.(t.id); }} aria-label={`Open original from ${t.speaker}`}>
        <span className="spine-terse-speaker">{t.speaker}</span><span className="spine-terse-words"><Emphasis text={line(t)} /></span>
      </button></li>)}</ul>}
      {!closed && children}
    </section>;
  };
  // Topics retain the map's existing theme and parent hierarchy. Time retains chronological runs.
  const rendered = time ? groups.map((g,i) => groupView(g,i)) : (() => {
    const renderThread = (id: string): React.ReactNode => {
      const group = groups.find(g => g.id === id);
      const children = map.threads.filter(t => t.parent_id === id);
      const nested = children.map(t => renderThread(t.id));
      return <div key={id} className="spine-terse-branch">{groupView(group ?? { id, title: map.threads.find(t => t.id === id)?.title ?? "", thoughts: [] }, group ? groups.indexOf(group) : -1, nested)}</div>;
    };
    const roots = map.threads.filter(t => !t.parent_id || !map.threads.some(p => p.id === t.parent_id));
    const themes = [...new Set(roots.map(t => t.topic ?? ""))];
    return <>{themes.map(theme => <div key={theme}>{theme && <h3 className="spine-terse-theme">{parentLine(theme)}</h3>}{roots.filter(t => (t.topic ?? "") === theme).map(t => renderThread(t.id))}</div>)}{groups.filter(g => g.id === "unplaced").map((g,i) => groupView(g,i))}</>;
  })();
  return <div className="spine-terse" ref={root} data-revision={revision}>
    <div className="spine-terse-toolbar"><p>{here} words here, {full} in full</p><div aria-label="Conversation order"><button aria-pressed={time} onClick={() => setTime(true)}>Time</button><button aria-pressed={!time} onClick={() => setTime(false)}>Topics</button></div></div>
    <div className="spine-terse-outline">{rendered}</div>
    <dialog ref={dialog} className="spine-terse-original" onClose={() => setOriginal(null)} onClick={e => { if (e.target === dialog.current) dialog.current?.close(); }}>
      <button className="spine-terse-close" onClick={() => dialog.current?.close()}>Close original</button><h2>{original?.speaker}</h2><p>{original && content(original)}</p>
    </dialog>
  </div>;
}
