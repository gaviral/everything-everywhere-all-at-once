import { useMemo, useRef } from "react";
import type { BrickActions, BrickProps } from "../contract";
import { blankDraft, useCheckpoint } from "./checkpoint";
import { documentsOf, exampleDocuments, type ReadingDocument } from "./documents";
import { DraftEditor } from "./DraftEditor";
import { SourceReader } from "./SourceReader";
import { useReadingUpdates } from "./use-reading-updates";
import featureStyles from "./place-drafts.css?inline";

export default function PlaceDrafts({ map, actions }: BrickProps) {
  const live = useMemo(() => documentsOf(map), [map.threads, map.thoughts, map.jobs]);
  // Never restore another map's words before the connection confirms its identity.
  const identity = map.mapIdentity ? JSON.stringify([map.mapIdentity, map.me]) : "example";
  const example = !map.mapIdentity;
  return <ReadingWorkspace key={identity} identity={identity} incoming={example ? exampleDocuments : live}
    example={example} actions={actions} connected={map.connected} />;
}

function ReadingWorkspace({ identity, incoming, example, actions, connected }: {
  identity: string; incoming: ReadingDocument[]; example: boolean; actions: BrickActions; connected: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const { checkpoint, warning, change } = useCheckpoint(identity);
  const { documents, pending, release } = useReadingUpdates(incoming, root);
  const activeId = checkpoint.active || documents[0]?.id || "empty";
  const active = documents.find(item => item.id === activeId);
  const draft = checkpoint.drafts[activeId] ?? blankDraft;
  const retained = Object.keys(checkpoint.drafts).filter(id => checkpoint.drafts[id].text && !documents.some(item => item.id === id));
  return <section className="place-drafts" ref={root} data-guide="place-drafts" aria-label="Keep my place">
    <div className="place-drafts-intro"><div><p className="place-drafts-eyebrow">Keep my place</p>
      <h1>Come back to<br /><em>the thought.</em></h1></div>
      <p>Read a little. Follow a source.<br />Your unfinished words will be here.</p></div>
    <div className="place-drafts-status" role="status">
      <span>{example ? "Fictional example · waiting for an identified map" : "This map · reading history · drafts unsent"}</span>
      {pending && <button type="button" onClick={release}>Updates waiting · show when ready</button>}
      {!connected && !example && <span>Offline · last received sources</span>}
    </div>
    {warning && <p className="place-drafts-warning" role="alert">{warning}</p>}
    <nav className="place-drafts-readings" aria-label="Choose a reading">
      {documents.map(item => <button type="button" key={item.id} aria-current={activeId === item.id ? "page" : undefined}
        onClick={() => change(old => ({ ...old, active: item.id }))}>{item.title}
        {checkpoint.drafts[item.id]?.text && <span className="place-drafts-draft-mark"> · draft</span>}</button>)}
      {retained.map(id => <button type="button" key={id} aria-current={activeId === id ? "page" : undefined}
        onClick={() => change(old => ({ ...old, active: id }))}>Draft · source unavailable</button>)}
    </nav>
    <div className="place-drafts-spread">
      <div className="place-drafts-reading">
        <p className="place-drafts-eyebrow">{active?.kind ?? "Retained reading place"}</p>
        <h2 id={`place-drafts-title-${encodeURIComponent(activeId)}`}>{active?.title ?? (documents.length ? "Your source is away" : "A quiet place to begin")}</h2>
        {!documents.length && <p>No topics or helper results yet. Keep a draft here while you wait.</p>}
        <SourceReader document={active} documentId={activeId} folded={checkpoint.folded}
          place={checkpoint.places[activeId]} quote={checkpoint.quotes[activeId]}
          fold={id => change(old => ({ ...old, active: activeId, folded: { ...old.folded, [id]: !old.folded[id] } }))}
          keepPlace={place => change(old => ({ ...old, active: activeId, places: { ...old.places, [activeId]: place } }))}
          keepQuote={quote => change(old => ({ ...old, active: activeId, quotes: { ...old.quotes, [activeId]: quote } }))}
          openSource={id => {
            change(old => ({ ...old, active: activeId }));
            actions.openThought(id);
          }} />
      </div>
      <DraftEditor documentId={activeId} draft={draft} quote={checkpoint.quotes[activeId]}
        change={value => change(old => ({ ...old, active: activeId, drafts: { ...old.drafts, [activeId]: value } }))} />
    </div>
  </section>;
}

export const styles = featureStyles;
