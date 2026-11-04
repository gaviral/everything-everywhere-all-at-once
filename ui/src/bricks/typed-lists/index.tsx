import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BrickProps } from "../contract";
import { CardCollection, SourceWords } from "./Cards";
import { RecordEditor, SchemaEditor } from "./Editors";
import { sourceOf, type Field, type RecordCard } from "./model";
import { useBoardVisit } from "./visit";
import stylesheet from "./typed-lists.css?inline";

function EditorDialog({ children, close }: { children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const restore = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => { dialog.current?.showModal(); return () => { restore.current?.focus({ preventScroll: true }); }; }, []);
  return <dialog className="tl-dialog" ref={dialog} aria-label="Thought board detail" onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}>
    <button type="button" className="tl-close" aria-label="Close detail" onClick={close}>Close ×</button>{children}
  </dialog>;
}

function ThoughtBoard({ map, actions, visit }: BrickProps & { visit: string }) {
  const { workspace, examples, setWorkspace, setExamples } = useBoardVisit(visit);
  const [editor, setEditor] = useState<RecordCard | "schema" | null>(null);
  const [source, setSource] = useState<RecordCard | null>(null);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const { schema, example, view } = workspace;
  const records = example ? examples : workspace.records;
  const available = map.thoughts.filter(thought => thought.text.trim() && thought.placed && thought.thread_id && !workspace.records.some(record => record.source.id === thought.id));
  const keepRecords = (update: (old: RecordCard[]) => RecordCard[]) => {
    if (example) setExamples(update);
    else setWorkspace(old => ({ ...old, records: update(old.records) }));
  };
  const keepCard = (card: RecordCard) => {
    keepRecords(old => old.some(record => record.source.id === card.source.id) ? old.map(record => record.source.id === card.source.id ? card : record) : [...old, card]);
    setEditor(null); setSelected(""); setNotice("Card kept for this visit. Source words stay linked.");
  };
  const move = (card: RecordCard, field: Field, value: string) => {
    keepRecords(old => old.map(record => record.source.id === card.source.id ? { ...record, values: { ...record.values, [field.id]: value } } : record));
    setNotice(`${card.title} → ${value || "Unassigned"}. Source words kept.`);
  };
  const addSelected = () => {
    const thought = available.find(thought => thought.id === selected);
    if (!thought) return;
    setEditor({ source: sourceOf(thought), title: (thought.point || thought.text).slice(0, 120), values: {} });
  };
  const switchMode = () => { setWorkspace(old => ({ ...old, example: !old.example })); setSelected(""); setNotice(""); };
  return <section className="thought-board" aria-label="Thought board" data-guide="typed-lists">
    <header className="tl-header"><div><p className="tl-eyebrow">WORDS → SOMETHING YOU CAN WORK WITH</p><h1>{schema.name}</h1><p>A little structure. A way back to every thought.</p></div>
      <button type="button" onClick={() => actions.closeView()}>Back to map ↗</button></header>
    <div className="tl-toolbar"><div className="tl-actions"><span className="tl-mode">{example ? "Example board" : "Your thoughts"}</span><span>{records.length} linked {records.length === 1 ? "card" : "cards"}</span></div>
      <div className="tl-actions"><div className="tl-view" role="group" aria-label="Display"><button type="button" aria-pressed={view === "board"} disabled={!schema.fields.some(field => field.kind === "choice")} onClick={() => setWorkspace(old => ({ ...old, view: "board" }))}>Board</button><button type="button" aria-pressed={view === "list"} onClick={() => setWorkspace(old => ({ ...old, view: "list" }))}>List</button></div>
        <button type="button" onClick={() => setEditor("schema")}>Shape list</button></div></div>
    <aside className="tl-context"><div><strong>{example ? "Try a thought becoming a plan." : "Your words, with room to act."}</strong><p>{example ? "Clearly labelled examples. Edit a field or move a card, then follow its source words." : "Choose a thought from your map. Give it fields without rewriting what was said."}</p></div>
      <button type="button" className={example ? "tl-primary" : ""} onClick={switchMode}>{example ? "Use my thoughts" : "Explore example"}</button></aside>
    {!example && <div className="tl-add"><label>Thought to turn into a card<select aria-label="Source thought" value={selected} onChange={e => setSelected(e.target.value)}><option value="">{available.length ? "Choose original words…" : "No unlinked placed thoughts yet"}</option>{available.map(thought => <option key={thought.id} value={thought.id}>{thought.speaker}: {thought.text.slice(0, 100)}</option>)}</select></label><button type="button" className="tl-primary" disabled={!selected || records.length >= 100} onClick={addSelected}>Add linked card</button></div>}
    <p className="tl-notice" role="status">{notice || "Local to this visit · not shared or saved to the map"}</p>
    <CardCollection records={records} schema={schema} view={view} edit={setEditor} source={setSource} move={move} />
    {!records.length && <div className="tl-empty"><h2>Your next step starts with a thought.</h2><p>{available.length ? "Choose its source words above to make your first card." : "Add a thought on the map, then return here to give it structure."}</p><button type="button" onClick={() => actions.closeView()}>Go to map</button></div>}
    <footer className="tl-footnote">Text · date · choice<span>Cards can change. Their source words stay connected.</span></footer>
    {editor && <EditorDialog close={() => setEditor(null)}>{editor === "schema" ? <SchemaEditor schema={schema} save={next => { setWorkspace(old => ({ ...old, schema: next })); setEditor(null); setNotice("List shape kept for this visit. Existing cards keep their fields."); }} cancel={() => setEditor(null)} /> : <RecordEditor card={editor} schema={schema} save={keepCard} cancel={() => setEditor(null)} />}</EditorDialog>}
    {source && <EditorDialog close={() => setSource(null)}><SourceWords card={source} example={example} thoughts={map.thoughts} open={() => { if (actions.openThought(source.source.id)) setSource(null); }} /></EditorDialog>}
  </section>;
}

export default function TypedLists(props: BrickProps) {
  const visit = JSON.stringify([props.map.visitKey ?? props.map.mapIdentity ?? "visit", props.map.me]);
  return <ThoughtBoard key={visit} visit={visit} {...props} />;
}

export const styles = stylesheet;
