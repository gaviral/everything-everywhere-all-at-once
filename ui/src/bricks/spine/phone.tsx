// Optional room controller. The Canvas remains the renderer and owns its camera and reading state.
import { useContext, useEffect, useRef, useState } from "react";
import { EdgeLabelRenderer, useReactFlow } from "@xyflow/react";
import { PhoneRemoteContext, type MapSnapshot, type RemoteGesture } from "../contract";
import type { Item, Layout } from "./layout";

type Selection = { thread: string | null; thought: string | null; opened: boolean };
export function PhoneNavigation({ map, layout, reveal, overview, hold }: {
  map: MapSnapshot; layout: Layout; reveal: (thread: string, thought: string | null, open: boolean) => void;
  overview: () => void; hold: () => void;
}) {
  const channel = useContext(PhoneRemoteContext);
  const flow = useReactFlow();
  const [selection, setSelection] = useState<Selection | null>(null);
  const current = useRef<Selection>({ thread: null, thought: null, opened: false });
  const previous = useRef<Selection | null>(null);
  const live = useRef({ map, reveal, overview, hold });
  live.current = { map, reveal, overview, hold };
  useEffect(() => {
    if (!channel) { setSelection(null); return; }
    const publish = (s: Selection) => {
      const world = live.current.map;
      const topic = world.threads.find((t) => t.id === s.thread);
      const thought = world.thoughts.find((t) => t.id === s.thought);
      const thoughts = world.thoughts.filter((t) => t.thread_id === s.thread);
      channel.select({ kind: "selection", thread_id: s.thread, thought_id: s.thought, enabled: true,
        label: topic ? `${topic.title}${thought ? ` · Thought ${thoughts.indexOf(thought) + 1} of ${thoughts.length}` : ` · ${thoughts.length} thoughts`}` : "No topics yet" });
    };
    const receive = (gesture: RemoteGesture) => {
      const { map, reveal, overview, hold } = live.current;
      const s = { ...current.current };
      const threads = map.threads;
      if (!threads.some((t) => t.id === s.thread)) { s.thread = threads[0]?.id ?? null; s.thought = null; }
      if (gesture.kind === "left" || gesture.kind === "right") {
        const i = threads.findIndex((t) => t.id === s.thread);
        s.thread = threads[Math.max(0, Math.min(threads.length - 1, i + (gesture.kind === "right" ? 1 : -1)))]?.id ?? null;
        s.thought = null; s.opened = false;
      } else if (gesture.kind === "up" || gesture.kind === "down") {
        const thoughts = map.thoughts.filter((t) => t.thread_id === s.thread);
        const i = thoughts.findIndex((t) => t.id === s.thought);
        s.thought = thoughts[Math.max(0, Math.min(thoughts.length - 1, i + (gesture.kind === "down" ? 1 : -1)))]?.id ?? null;
        s.opened = false;
      } else if (gesture.kind === "open") {
        previous.current = { ...s }; s.opened = true;
      } else if (gesture.kind === "back") {
        if (previous.current) { Object.assign(s, previous.current); previous.current = null; }
        else { s.thought = null; s.opened = false; overview(); }
      } else if (gesture.kind === "zoom") {
        hold(); const v = flow.getViewport();
        const zoom = Math.max(0.15, Math.min(2, v.zoom * gesture.scale));
        const bounds = document.querySelector(".spine-flow")?.getBoundingClientRect();
        const cx = (bounds?.width ?? innerWidth) / 2, cy = (bounds?.height ?? innerHeight) / 2;
        void flow.setViewport({ x: cx - (cx - v.x) * zoom / v.zoom, y: cy - (cy - v.y) * zoom / v.zoom, zoom });
      } else if (gesture.kind === "pan") {
        hold(); const v = flow.getViewport(); void flow.setViewport({ ...v, x: v.x + gesture.x, y: v.y + gesture.y });
      }
      current.current = s; setSelection(s); publish(s);
      if (!["hello", "zoom", "pan"].includes(gesture.kind) && s.thread) reveal(s.thread, s.thought, s.opened);
    };
    // A newly enabled desktop is ready even before the phone asks.
    const first = live.current.map.threads[0]?.id ?? null;
    current.current = { thread: first, thought: null, opened: false };
    publish(current.current);
    return channel.subscribe(receive);
  }, [channel, flow]);
  const topic = map.threads.find((t) => t.id === selection?.thread);
  const thought = map.thoughts.find((t) => t.id === selection?.thought);
  const item: Item | undefined = selection?.thought
    ? layout.items.find((item) => item.thoughts?.includes(selection.thought!))
    : layout.byKey.get(`t:${selection?.thread}`);
  if (!channel || !selection) return null;
  return <>
    {item && <EdgeLabelRenderer><div className="spine-phone-ring" data-remote-thread={selection.thread} data-remote-thought={selection.thought ?? ""}
      data-remote-open={selection.opened} style={{ transform: `translate(${item.box.x - 10}px, ${item.box.y - 10}px)`, width: item.box.w + 20, height: item.box.h + 20 }} /></EdgeLabelRenderer>}
    <div className="spine-phone-caption" role="status">{topic?.title ?? "No topics yet"}{topic && <span>{thought ? `Thought ${map.thoughts.filter((t) => t.thread_id === topic.id).findIndex((t) => t.id === thought.id) + 1} of ${map.thoughts.filter((t) => t.thread_id === topic.id).length}` : `${map.thoughts.filter((t) => t.thread_id === topic.id).length} thoughts`}</span>}{selection.opened && <b>Open</b>}</div>
  </>;
}
