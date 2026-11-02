import { Fragment, type ReactNode } from "react";

// Only these inline tokens become elements. Everything else remains a React text node (including HTML).
function inline(text: string): ReactNode[] {
  const root: ReactNode[] = [];
  const stack = [{ mark: "", nodes: root, key: 0 }];
  const add = (...nodes: ReactNode[]) => stack[stack.length - 1].nodes.push(...nodes);
  const tokens = /(?<!`)`([^`\n]+)`(?!`)|\*+/g;
  let at = 0;
  for (const token of text.matchAll(tokens)) {
    add(text.slice(at, token.index));
    at = token.index + token[0].length;
    if (token[1] !== undefined) {
      add(<code key={token.index}>{token[1]}</code>);
      continue;
    }
    let stars = token[0];
    if (stars.length > 3) { add(stars); continue; }
    const closes = token.index > 0 && !/\s/.test(text[token.index - 1]);
    const opens = at < text.length && !/\s/.test(text[at]);
    while (closes && stack.length > 1 && stars.length >= stack[stack.length - 1].mark.length) {
      const frame = stack.pop()!;
      stars = stars.slice(frame.mark.length);
      add(frame.mark === "**" ? <strong key={frame.key}>{frame.nodes}</strong> : <em key={frame.key}>{frame.nodes}</em>);
    }
    if (opens && stars && stack.length < 16) {
      if (stars.length >= 2) {
        stack.push({ mark: "**", nodes: [], key: token.index });
        stars = stars.slice(2);
      }
      if (stars) stack.push({ mark: "*", nodes: [], key: token.index + 2 });
    } else add(stars);
  }
  add(text.slice(at));
  // Unclosed delimiters are literal, without losing any text or completed formatting inside them.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    add(frame.mark, ...frame.nodes);
  }
  return root;
}

const bullet = (line: string) => /^(-|\d{1,9}\.) (.*)$/.exec(line);

/** The complete dialect: emphasis, inline code and flat lists. No HTML, URLs or other Markdown is interpreted. */
export function parseMarkdown(text: string): ReactNode[] {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => bullet(line))) return inline(text);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const first = bullet(lines[i]);
    const start = i;
    if (!first) {
      while (i < lines.length && !bullet(lines[i])) i++;
      nodes.push(<Fragment key={start}>{inline(lines.slice(start, i).join("\n"))}</Fragment>);
      continue;
    }
    const ordered = first[1] !== "-";
    const items: ReactNode[] = [];
    let number = ordered ? Number.parseInt(first[1], 10) : 0;
    while (i < lines.length) {
      const item = bullet(lines[i]);
      if (!item || (item[1] !== "-") !== ordered) break;
      // Phrasing elements keep lists valid inside existing spans, paragraphs and buttons. ARIA supplies list
      // semantics; local styles avoid the map's .points li layout and its extra point markers.
      items.push(<span key={i++} role="listitem" style={{ display: "flex", gap: ".5em" }}>
        <span aria-hidden="true" style={{ flex: "none" }}>{ordered ? `${number++}.` : "•"}</span>
        <span style={{ minWidth: 0 }}>{inline(item[2])}</span>
      </span>);
    }
    nodes.push(<span key={start} role="list" style={{ display: "block", paddingInlineStart: "1em" }}>{items}</span>);
  }
  return nodes;
}

/** Wrapper-free for plain text: existing typography, spacing and line wrapping stay with the caller. */
export function Markdown({ text }: { text: string }) {
  return <>{parseMarkdown(text)}</>;
}
