import { useLayoutEffect, useRef, useState } from "react";
import type { CatalogRow } from "../Shell";
import type { OrganizedProps } from "./CatalogPanel";
import { canonicalRows, contextIds, matchingRows, OTHER, TASKS, taskOf } from "./organization";
import "./organized.css";

export default function OrganizedCatalog({ rows: supplied, at, currentView, active, session }: OrganizedProps) {
  const rows = canonicalRows(supplied);
  const [query, setQuery] = useState(session.query);
  const [detail, setDetail] = useState(session.detail);
  const [task, setTask] = useState(session.task);
  const root = useRef<HTMLDivElement>(null);
  const position = useRef({ scroll: session.scroll, focus: session.focus });
  const navigation = useRef<{ scroll: number; focus: string } | null>(null);
  const previousAt = useRef<string | null>(null);
  // The session belongs to the presentation host, so Off/reopen does not lose a search or inspection.
  session.query = query; session.detail = detail; session.task = task;
  useLayoutEffect(() => {
    if (at && at !== previousAt.current) { setDetail(at); previousAt.current = at; }
  }, [at]);
  useLayoutEffect(() => {
    if (!active) return;
    let detach = () => {};
    const frame = requestAnimationFrame(() => {
      const scroller = root.current?.closest<HTMLElement>(".shell-tabpanel") ?? root.current?.parentElement;
      if (!scroller) return;
      scroller.scrollTop = position.current.scroll;
      const key = position.current.focus;
      const target = key ? root.current?.querySelector<HTMLElement>(`[data-catalog-focus="${CSS.escape(key)}"]`) : null;
      (target ?? root.current?.querySelector<HTMLElement>(detail ? "h2" : "input"))?.focus({ preventScroll: true });
      const remember = () => { session.scroll = scroller.scrollTop; position.current.scroll = scroller.scrollTop; };
      scroller.addEventListener("scroll", remember);
      detach = () => { scroller.removeEventListener("scroll", remember); };
    });
    return () => { cancelAnimationFrame(frame); detach(); };
  }, [active, session]);
  useLayoutEffect(() => {
    if (!active) return;
    if (!navigation.current) return;
    const next = navigation.current;
    navigation.current = null;
    const scroller = root.current?.closest<HTMLElement>(".shell-tabpanel");
    if (scroller) scroller.scrollTop = next.scroll;
    position.current = next; session.scroll = next.scroll; session.focus = next.focus;
    root.current?.querySelector<HTMLElement>(`[data-catalog-focus="${CSS.escape(next.focus)}"]`)?.focus({ preventScroll: true });
  }, [detail, task]);
  const inspect = (row: CatalogRow, focus = `inspect-${row.id}`) => {
    session.backScroll = root.current?.closest<HTMLElement>(".shell-tabpanel")?.scrollTop ?? 0;
    session.backFocus = focus;
    navigation.current = { scroll: 0, focus: "detail-title" }; setDetail(row.id);
  };
  const back = () => {
    if (detail) { navigation.current = { scroll: session.backScroll, focus: session.backFocus }; setDetail(null); }
    else { navigation.current = { scroll: session.homeScroll, focus: task ? `task-${task}` : "search" }; setTask(null); }
  };
  const selected = rows.find((row) => row.id === detail);
  const matches = matchingRows(rows, query);
  const visible = query.trim() ? matches : rows.filter((row) => taskOf(row) === task);
  const tasks = [...TASKS.map((item) => item.name), ...(rows.some((row) => taskOf(row) === OTHER) ? [OTHER] : [])];
  const context = contextIds(currentView).map((id) => rows.find((row) => row.id === id)).filter((row): row is CatalogRow => !!row);
  const control = (row: CatalogRow) => row.core ? <p>Built in · {row.on ? "On" : "Off"}</p>
    : row.toggle ? <button type="button" role="switch" className="shell-btn" aria-checked={row.on} aria-label={row.name}
      disabled={row.disabled} aria-describedby={row.disabledReason ? `catalog-policy-${row.id}` : undefined}
      onClick={() => row.toggle?.(!row.on)}>{row.on ? "On" : "Off"}</button> : null;
  return <div ref={root} className="organized-catalog" data-organized-catalog onFocusCapture={(event) => {
    const key = (event.target as HTMLElement).dataset.catalogFocus;
    if (key) { session.focus = key; position.current.focus = key; }
  }}>
    {(detail || task) && <button type="button" className="shell-link" onClick={back} data-catalog-focus="back">Back</button>}
    {detail ? selected ? <section className="organized-detail" data-detail={selected.id}>
      <h2 tabIndex={-1} data-catalog-focus="detail-title">{selected.name}</h2>
      {selected.aka && <p className="shell-aka">Also called {selected.aka}</p>}
      <p>{selected.does}</p>
      {selected.lives && <p className="shell-foot">Where: {selected.lives}</p>}
      <dl><dt>Saved choice</dt><dd>{selected.core ? "Built in" : selected.savedOn === undefined ? "Not supplied by this feature" : selected.savedOn ? "On" : "Off"}</dd>
        <dt>Effective now</dt><dd>{selected.on ? "On" : "Off"}{selected.disabled ? " · changes unavailable" : ""}</dd></dl>
      {selected.disabledReason && <p id={`catalog-policy-${selected.id}`} role="status">{selected.disabledReason}</p>}
      {selected.id === "work-spine" && <p>Reports helper activity; it does not start helpers.</p>}
      {selected.id === "countdown" && <p>Local planning in this browser. No Calendar connection.</p>}
      <div className="organized-actions">{control(selected)}{selected.show && <button type="button" className="shell-btn" onClick={selected.show}>Show</button>}</div>
      {selected.parts}
    </section> : <p role="status">This feature is no longer in the supplied list. Back returns to Features.</p> : <>
      <label className="organized-search">Find a feature
        <input type="search" value={query} placeholder="Name, alias or task" data-catalog-focus="search" onChange={(event) => setQuery(event.target.value)} />
      </label>
      {!query.trim() && !task && <>
        <section aria-label="Current view"><h3>For your current view</h3><p className="shell-foot">Inspect what helps here.</p>
          <div className="organized-context">{context.map((row) => <button type="button" className="shell-link" key={row.id} onClick={() => inspect(row, `context-${row.id}`)} data-catalog-focus={`context-${row.id}`}>{row.name}</button>)}</div>
        </section>
        <section aria-label="Tasks"><h3>What do you want to do?</h3><ul className="organized-tasks">{tasks.map((name) => <li key={name}>
          <button type="button" className="shell-btn" data-catalog-focus={`task-${name}`} onClick={() => {
            session.homeScroll = root.current?.closest<HTMLElement>(".shell-tabpanel")?.scrollTop ?? 0;
            navigation.current = { scroll: 0, focus: "search" }; setTask(name);
          }}>{name}</button>
        </li>)}</ul></section>
      </>}
      {(query.trim() || task) && <section aria-label={query.trim() ? "Matching features" : task!}>
        <h3>{query.trim() ? "Matching features" : task}</h3>
        <ul className="organized-rows">{visible.map((row) => <li key={row.id} data-row={row.id}>
          <div><strong>{row.name}</strong>{row.aka && <span className="shell-aka">{row.aka}</span>}<p>{row.does}</p></div>
          <div className="organized-actions"><button type="button" className="shell-link" aria-label={`Inspect ${row.name}`} data-catalog-focus={`inspect-${row.id}`} onClick={() => inspect(row)}>Inspect</button>
            {control(row)}{row.show && <button type="button" className="shell-link" onClick={row.show}>Show</button>}</div>
          {row.disabledReason && <p id={`catalog-policy-${row.id}`}>{row.disabledReason}</p>}
        </li>)}</ul>
        {!visible.length && <p className="shell-foot">No matching features. Try another name or task.</p>}
      </section>}
    </>}
  </div>;
}
