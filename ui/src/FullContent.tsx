import { useEffect, useRef, useState, type ReactNode } from "react";
import { ReactFlow, ReactFlowProvider, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { FullContentContext, type FullContentRequest } from "./bricks/contract";
import type { Thought, Thread } from "./core";
import "./full-content.css";

type Content = { title: string; thoughts: readonly Thought[]; displayedPoint?: string; wrap: boolean };
type ContentNode = Node<Content, "content">;
function ContentCard({ data }: NodeProps<ContentNode>) {
  return <article className={`full-content-card nodrag ${data.wrap ? "full-content-wrap" : ""}`}>
    <h2>Complete topic title</h2><div data-full-title>{data.title}</div>
    {data.displayedPoint !== undefined && <><h2>Displayed point</h2><div data-full-displayed>{data.displayedPoint}</div></>}
    {data.thoughts.map((thought, i) => <section key={thought.id} data-full-thought={thought.id}>
      <h2>{i + 1}. Recognized words</h2><div data-full-words>{thought.text}</div>
      <h2>Source point</h2><div data-full-point>{thought.point}</div>
    </section>)}
  </article>;
}
const nodeTypes = { content: ContentCard };

function Inspector({ content, close }: { content: Omit<Content, "wrap">; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [wrap, setWrap] = useState(false);
  const flow = useReactFlow();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const pan = (x: number, y: number) => {
    const view = flow.getViewport();
    void flow.setViewport({ ...view, x: view.x + x, y: view.y + y }, { duration: 0 });
  };
  return <dialog ref={dialog} className="full-content" aria-label="Full content inspector" onCancel={(event) => { event.preventDefault(); close(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Tab") {
        const buttons = dialog.current!.querySelectorAll<HTMLButtonElement>(".full-content-toolbar button");
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault(); buttons[0].focus(); }
      }
      const delta: Record<string, [number, number]> = { ArrowLeft: [100, 0], ArrowRight: [-100, 0], ArrowUp: [0, 100], ArrowDown: [0, -100] };
      if (delta[event.key]) { event.preventDefault(); pan(...delta[event.key]); }
    }}>
    <div className="full-content-toolbar" role="toolbar" aria-label="Full content controls">
      <strong>Full content</strong>
      <button type="button" autoFocus onClick={close}>Close</button>
      <button type="button" aria-pressed={wrap} onClick={() => { setWrap(!wrap); void flow.setViewport({ x: 24, y: 96, zoom: 1 }, { duration: 0 }); }}>Wrap</button>
      <span>Drag or scroll to pan · pinch to zoom · arrow keys to pan</span>
    </div>
    <ReactFlow<ContentNode> nodes={[{ id: "inspection", type: "content", position: { x: 0, y: 0 }, data: { ...content, wrap }, draggable: false, selectable: false, focusable: false }]}
      nodeTypes={nodeTypes} defaultViewport={{ x: 24, y: 96, zoom: 1 }} minZoom={0.04} maxZoom={2}
      panOnScroll zoomOnPinch zoomOnDoubleClick={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false}
      elementsSelectable={false} proOptions={{ hideAttribution: true }} aria-label="Full content canvas" />
  </dialog>;
}

/** Source data is snapshotted on open; this temporary canvas owns no World positions. */
export function FullContentProvider({ enabled, threads, thoughts, children }: { enabled: boolean; threads: readonly Thread[]; thoughts: readonly Thought[]; children: ReactNode }) {
  const [opened, setOpened] = useState<{ content: Omit<Content, "wrap">; request: FullContentRequest; source: HTMLElement } | null>(null);
  const close = () => {
    setOpened(null);
    if (opened) requestAnimationFrame(() => {
      // The modal took focus away, hiding the node's :focus-within actions.
      // Reveal them through the source node's main control before focusing Inspect.
      opened.source.closest(".spine-tools")?.parentElement
        ?.querySelector<HTMLElement>(':scope > button, :scope > [role="button"]')?.focus({ preventScroll: true });
      opened.source.focus({ preventScroll: true });
      opened.request.restoreCamera();
    });
  };
  useEffect(() => { if (!enabled && opened) close(); }, [enabled, opened]);
  return <FullContentContext.Provider value={enabled ? (request, source) => {
    const title = threads.find(t => t.id === request.threadId)?.title ?? "";
    const selected = thoughts.filter(t => request.thoughtIds ? request.thoughtIds.includes(t.id) : t.thread_id === request.threadId);
    setOpened({ request, source, content: { title, thoughts: selected, displayedPoint: request.displayedPoint } });
  } : null}>
    {children}
    {enabled && opened && <ReactFlowProvider><Inspector content={opened.content} close={close} /></ReactFlowProvider>}
  </FullContentContext.Provider>;
}
