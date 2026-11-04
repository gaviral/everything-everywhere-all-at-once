import { useLayoutEffect, useRef } from "react";
import { usePluginState } from "../contract";
import { sectionPlaces, type ReadingSection } from "./content";
import { ReadingPassage, type ReadingContext } from "./passage";

export function ReadingDocument({ sections, context }: { sections: ReadingSection[]; context: ReadingContext }) {
  const key = context.example ? "example" : "map";
  const [place, setPlace] = usePluginState(`place:${key}`, "");
  const [folded, setFolded] = usePluginState<Record<string, boolean>>(`folds:${key}`, {});
  const pages = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const pending = useRef<string | null>(null);
  const places = sectionPlaces(sections);
  const current = places.some(item => item.section.id === place) ? place : places[0]?.section.id;
  const frame = useRef(0);
  const jump = (id: string) => {
    const item = places.find(item => item.section.id === id);
    if (!item) return;
    pending.current = id;
    setFolded(old => ({ ...old, ...Object.fromEntries([...item.parents, id].map(key => [key, false])) }));
    setPlace(id);
  };
  useLayoutEffect(() => {
    const target = pending.current ?? (!restored.current ? current : null);
    const focus = pending.current !== null;
    restored.current = true;
    pending.current = null;
    if (!target || !pages.current) return;
    const summary = [...pages.current.querySelectorAll<HTMLElement>("[data-reading-heading]")].find(item => item.dataset.readingHeading === target);
    if (summary) {
      pages.current.scrollTop += summary.getBoundingClientRect().top - pages.current.getBoundingClientRect().top - 20;
      if (focus) summary.focus({ preventScroll: true });
    }
  });
  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

  const trackPosition = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const root = pages.current;
      if (!root) return;
      const top = root.getBoundingClientRect().top + 65;
      const headings = [...root.querySelectorAll<HTMLElement>("[data-reading-heading]")].filter(item => item.getClientRects().length);
      const nearest = headings.filter(item => item.getBoundingClientRect().top <= top).at(-1) ?? headings[0];
      if (nearest?.dataset.readingHeading) setPlace(nearest.dataset.readingHeading);
    });
  };
  const fold = (id: string, closed: boolean) => {
    setFolded(old => old[id] === closed ? old : { ...old, [id]: closed });
    if (closed && (current === id || places.find(item => item.section.id === current)?.parents.includes(id))) setPlace(id);
  };

  return <div className="contextual-folds-document">
    <nav className="contextual-folds-position" aria-label="Reading position">
      <p className="contextual-folds-label">Position</p>
      <p className="contextual-folds-place">{Math.max(1, places.findIndex(item => item.section.id === current) + 1)} <span>/ {places.length}</span></p>
      <p className="contextual-folds-position-help">Place only</p>
      <ol>{places.map(({ section, parents }, index) => <li key={section.id}>
        <button type="button" aria-current={current === section.id ? "location" : undefined}
          className={parents.length ? "contextual-folds-branch-link" : undefined} onClick={() => jump(section.id)}>
          <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span>{section.title}</span>
        </button>
      </li>)}</ol>
    </nav>
    <div className="contextual-folds-pages" ref={pages} onScroll={trackPosition} tabIndex={0} aria-label="Original words">
      {sections.map(section => <SectionFold key={section.id} section={section} context={context} folded={folded}
        fold={fold} />)}
      <p className="contextual-folds-end">{context.example ? "End of this example" : "End of the received words"}</p>
    </div>
  </div>;
}

function SectionFold({ section, context, folded, fold }: {
  section: ReadingSection; context: ReadingContext; folded: Record<string, boolean>; fold(id: string, closed: boolean): void;
}) {
  const toggle = () => fold(section.id, !folded[section.id]);
  return <details className="contextual-folds-section" data-section={section.id} open={!folded[section.id]}>
    <summary data-reading-heading={section.id} onClick={event => {
      event.preventDefault();
      toggle();
    }} onKeyDown={event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    }}>
      <span className="contextual-folds-fold-mark" aria-hidden="true">⌄</span>
      <span><span className="contextual-folds-topic-title">{section.title}</span>
        <span className="contextual-folds-topic-context">{section.archived && "Archived · "}{section.passages.length} {section.passages.length === 1 ? "passage" : "passages"}{section.children.length ? ` · ${section.children.length} ${section.children.length === 1 ? "tangent" : "tangents"}` : ""}</span>
      </span>
    </summary>
    <div className="contextual-folds-section-body">
      {section.passages.map(passage => <ReadingPassage key={passage.thought.id} passage={passage} context={context} />)}
      {section.children.map(child => <SectionFold key={child.id} section={child} context={context} folded={folded} fold={fold} />)}
    </div>
  </details>;
}
