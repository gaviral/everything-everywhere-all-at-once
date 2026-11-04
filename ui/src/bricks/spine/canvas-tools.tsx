// Optional shell slots on the existing React Flow canvas. Positions are local presentation,
// never World positions; only the shell owns the bodies, draft, socket and mutation actions.
import { useContext, useEffect, useRef, useState } from "react";
import { Panel, useReactFlow, type Node, type NodeChange, type NodeProps, type Viewport } from "@xyflow/react";
import { CanvasToolsContext, ToolSlot, type CanvasToolId } from "../contract";
import type { ItemNode } from "./nodes";
import "./canvas-tools.css";

const IDS: CanvasToolId[] = ["composer", "features", "history"];
const LABELS = { composer: "Type a thought", features: "Features", history: "History" };
type ToolNode = Node<{ tool: CanvasToolId; height: number }, "canvasTool">;
export type CanvasNode = ItemNode | ToolNode | import("./capture").CaptureNode;

export function useCanvasToolNodes() {
  const tools = useContext(CanvasToolsContext);
  const [positions, setPositions] = useState({ composer: { x: -460, y: 0 }, features: { x: -460, y: 260 }, history: { x: -460, y: 840 } });
  const [size, setSize] = useState(() => ({ width: innerWidth, height: innerHeight }));
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const narrow = size.width <= 560;
  const nodes: ToolNode[] = tools ? IDS.map(tool => {
    const height = tool === "composer" ? 180 : narrow ? Math.max(180, Math.min(440, size.height - 350)) : tool === "features" ? 520 : 380;
    return { id: `canvas-tool:${tool}`, type: "canvasTool", position: positions[tool], data: { tool, height },
      width: 350, height, hidden: narrow && tools.request.id !== tool, dragHandle: ".canvas-tool-handle",
      selectable: false, connectable: false, focusable: false, zIndex: 50 };
  }) : [];
  const change = (changes: NodeChange<CanvasNode>[]) => {
    for (const c of changes) if (c.type === "position" && c.position && c.id.startsWith("canvas-tool:")) {
      const tool = c.id.slice("canvas-tool:".length) as CanvasToolId;
      setPositions(was => ({ ...was, [tool]: c.position! }));
    }
  };
  return { nodes, change };
}

export function CanvasToolNode({ data }: NodeProps<ToolNode>) {
  const tools = useContext(CanvasToolsContext);
  if (!tools) return null;
  return <section className="canvas-tool" data-canvas-tool={data.tool} aria-label={LABELS[data.tool]} style={{ height: data.height }}>
    <div className="spine-tool-head">
      <button type="button" className="canvas-tool-handle" aria-label={`Drag ${LABELS[data.tool]}`} title="Drag this handle to move the tool">⠿ {LABELS[data.tool]}</button>
      <button type="button" className="nodrag" onClick={() => tools.focus(data.tool)}>Focus tool</button>
    </div>
    <div className={`canvas-tool-content nodrag nowheel nopan${data.tool === "composer" ? "" : " shell-tabpanel"}`}><ToolSlot host={tools.slots[data.tool]} /></div>
  </section>;
}

export function CanvasToolControls({ hold }: { hold: () => void }) {
  const tools = useContext(CanvasToolsContext);
  const flow = useReactFlow<CanvasNode>();
  const previous = useRef<Viewport | null>(null);
  useEffect(() => {
    if (!tools) {
      if (previous.current) void flow.setViewport(previous.current, { duration: 0 });
      previous.current = null;
      return;
    }
    hold();
    const tool = tools.request.id;
    if (!tool) {
      if (previous.current) void flow.setViewport(previous.current, { duration: 0 });
      previous.current = null;
      return;
    }
    previous.current ??= flow.getViewport();
    // Wait for the node and the stable portal target to be attached, including after a narrow resize.
    const frame = requestAnimationFrame(() => {
      const node = flow.getNode(`canvas-tool:${tool}`);
      if (!node) return;
      const zoom = Math.min(1, (innerWidth - 32) / 350);
      const canvas = document.querySelector(".spine-frame")!.getBoundingClientRect();
      const y = innerWidth <= 560 ? 180 : 145;
      void flow.setViewport({ x: (canvas.width - 350 * zoom) / 2 - node.position.x * zoom,
        y: y - node.position.y * zoom, zoom }, { duration: 0 });
      const target = tools.slots[tool].querySelector<HTMLElement>(tool === "composer" ? "textarea" : "button");
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tools?.request.revision, flow]);
  useEffect(() => {
    if (!tools) return;
    const resize = () => tools.focus(tools.request.id);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [tools]);
  // Keyboard focus into an off-screen tool restores its readable camera too.
  useEffect(() => {
    if (!tools) return;
    const focus = (event: FocusEvent) => {
      const tool = (event.target as Element)?.closest<HTMLElement>("[data-canvas-tool]")?.dataset.canvasTool as CanvasToolId | undefined;
      if (tool && tools.request.id !== tool) tools.focus(tool);
    };
    document.addEventListener("focusin", focus);
    return () => document.removeEventListener("focusin", focus);
  }, [tools]);
  if (!tools) return null;
  return <Panel position="top-left" className="canvas-tools-controls" aria-label="Canvas tools">
    <div>{IDS.map(id => <button type="button" key={id} aria-pressed={tools.request.id === id} onClick={() => tools.focus(id)}>Focus {LABELS[id]}</button>)}</div>
    <div><button type="button" onClick={() => { tools.focus(null); const pane = document.querySelector<HTMLElement>(".react-flow__pane"); if (pane) { pane.tabIndex = -1; pane.focus({ preventScroll: true }); } }}>Return to canvas</button>
      <button type="button" onClick={tools.exit}>Exit canvas tools</button></div>
  </Panel>;
}
