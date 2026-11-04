import { Fragment } from "react";

export interface WorkRow {
  id: number;
  kind: "item" | "text" | "code";
  text: string;
  marker?: string;
  status?: "checked" | "pending";
  children: WorkRow[];
}

/** A deliberately literal outline, not a Markdown rewrite. Non-list lines and code stay in order;
 * headings, links and HTML remain inert text. The original string is kept separately for complete source. */
export function outlineOf(source: string): WorkRow[] {
  const roots: WorkRow[] = [];
  const stack: { indent: number; row: WorkRow }[] = [];
  const lines = source.split(/\r\n|\n|\r/);
  let fence: { char: string; length: number; row: WorkRow } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      fence.row.text += "\n" + line;
      const end = line.trim().match(/^(`{3,}|~{3,})\s*$/);
      if (end && end[1][0] === fence.char && end[1].length >= fence.length) fence = null;
      continue;
    }
    const indentText = line.match(/^[ \t]*/)![0];
    const indent = indentText.replace(/\t/g, "    ").length;
    const item = line.slice(indentText.length).match(/^([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/);
    // A blank belongs to the current item. A sibling or an unindented paragraph ends it.
    if (line.trim()) while (stack.length && indent <= stack.at(-1)!.indent) stack.pop();
    const row: WorkRow = {
      id: i, kind: item ? "item" : "text", text: item ? item[3] : line,
      ...(item ? { marker: item[1] } : {}),
      ...(item?.[2] ? { status: item[2] === " " ? "pending" as const : "checked" as const } : {}),
      children: [],
    };
    (stack.at(-1)?.row.children ?? roots).push(row);
    const start = !item && line.trim().match(/^(`{3,}|~{3,})/);
    if (start) {
      row.kind = "code";
      fence = { char: start[1][0], length: start[1].length, row };
    }
    if (item) stack.push({ indent, row });
  }
  return roots;
}

function Words({ text }: { text: string }) {
  // Only backtick code gets monospace. Everything else is the source's literal wording.
  return <>{text.split(/(`+[^`\n]+`+)/g).map((part, i) => /^(`+)([^`\n]+)\1$/.test(part)
    ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>)}</>;
}

export function Outline({ rows, folded, toggle }: {
  rows: readonly WorkRow[]; folded: ReadonlySet<number>; toggle: (id: number) => void;
}) {
  return <ul className="work-list-outline">{rows.map((row) => <li key={row.id} className="work-list-row" data-line={row.id}>
    <div className="work-list-line">
      {row.children.length > 0 && <button className="work-list-fold" type="button" aria-expanded={!folded.has(row.id)}
        aria-label={`${folded.has(row.id) ? "Expand" : "Fold"} details at line ${row.id + 1}`} onClick={() => toggle(row.id)}>
        {folded.has(row.id) ? "+" : "−"}
      </button>}
      {row.kind === "item" && <span className="work-list-marker" aria-hidden="true">{row.marker}</span>}
      {row.status && <span className="work-list-status" role="checkbox" aria-checked={row.status === "checked"} aria-readonly="true"
        aria-label={row.status === "checked" ? "Checked task (read only)" : "Pending task (read only)"}>
        {row.status === "checked" ? "[x]" : "[ ]"}
      </span>}
      {row.kind === "code" ? <pre className="work-list-code"><code>{row.text}</code></pre>
        : <span className="work-list-words"><Words text={row.text} /></span>}
    </div>
    {row.children.length > 0 && !folded.has(row.id) && <Outline rows={row.children} folded={folded} toggle={toggle} />}
  </li>)}</ul>;
}
