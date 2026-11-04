import type { Thought } from "../contract";
import type { Field, RecordCard, Schema } from "./model";
import { boardGroups } from "./model";

type CardProps = { card: RecordCard; fields: Field[]; grouping?: Field; edit: (card: RecordCard) => void; source: (card: RecordCard) => void; move: (card: RecordCard, field: Field, value: string) => void };

function ThoughtCard({ card, fields, grouping, edit, source, move }: CardProps) {
  return <article className="tl-card" data-source-id={card.source.id}>
    <h3>{card.title}</h3>
    <dl>{fields.filter(field => field.id !== grouping?.id).map(field => <div key={field.id}><dt>{field.name}</dt><dd>{card.values[field.id] || "Unassigned"}</dd></div>)}</dl>
    {grouping && <label className="tl-move">{grouping.name}<select aria-label={`Move ${card.title}`} value={card.values[grouping.id] ?? ""} onChange={e => move(card, grouping, e.target.value)}><option value="">Unassigned</option>{grouping.options.map(option => <option key={option}>{option}</option>)}</select></label>}
    <footer><button type="button" className="tl-source-link" onClick={() => source(card)}>↗ Source words</button><button type="button" onClick={() => edit(card)}>Edit card</button></footer>
  </article>;
}

export function CardCollection({ records, schema, view, ...handlers }: { records: RecordCard[]; schema: Schema; view: "list" | "board" } & Pick<CardProps, "edit" | "source" | "move">) {
  const field = schema.fields.find(field => field.kind === "choice");
  if (view === "board" && field) return <div className="tl-board">{boardGroups(records, field).filter(group => group.value || group.records.length).map((group, index) =>
    <section className="tl-column" key={group.value} data-tone={index % 3}><h2><span className="tl-dot" />{group.value || "Unassigned"}<span className="tl-count">{group.records.length}</span></h2>
      {group.records.map(card => <ThoughtCard key={card.source.id} card={card} fields={schema.fields} grouping={field} {...handlers} />)}
      {!group.records.length && <p className="tl-column-empty">Room for the next thought.</p>}
    </section>)}</div>;
  return <div className="tl-list">{records.map(card => <ThoughtCard key={card.source.id} card={card} fields={schema.fields} {...handlers} />)}</div>;
}

export function SourceWords({ card, example, thoughts, open }: { card: RecordCard; example: boolean; thoughts: readonly Thought[]; open: () => void }) {
  const current = thoughts.find(thought => thought.id === card.source.id);
  return <div className="tl-source"><p className="tl-eyebrow">{example ? "Example source" : "Original source snapshot"} · {card.source.speaker}</p>
    <h2>The words behind the card</h2><blockquote>{card.source.text}</blockquote>
    <p>{example ? "Illustrative words. This example is separate from your map." : !current ? "Source unavailable on this map. The captured words remain here." : current.text !== card.source.text ? "Source changed since this card was made. The captured words remain here." : "These are the original words, kept separately from the card’s fields."}</p>
    {!example && <button type="button" className="tl-primary" disabled={!current?.placed || !current.thread_id} onClick={open}>{current && current.text !== card.source.text ? "Open current source on map" : "Open original on map"}</button>}
  </div>;
}
