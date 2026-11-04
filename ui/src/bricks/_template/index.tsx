// A brick to copy (docs/bricks.md): `cp -R ui/src/bricks/_template ui/src/bricks/<your-id>`, then put your id where
// "template" is, in brick.json, here and in template.css. A brick is a React component, the default export. It reads
// the map from `map` (read-only), changes it only through `actions`, and hears what passes through `on`: contract.ts
// says what each holds. Import from the app only "../contract"; anything else the brick needs lives in its folder.
import { useBrickEvent, usePluginState, type BrickProps } from "../contract";
import pluginStyle0 from "./template.css?inline";

export default function Template({ map, actions, on, brick }: BrickProps) {
  // Where the last thought landed: an event, since the map only says where things are now.
  const [landed, setLanded] = usePluginState<string | null>("last-landing", null);
  useBrickEvent(on, "landed", ({ threadId }) => setLanded(map.threads.find((thread) => thread.id === threadId)?.title ?? null));
  const placed = map.thoughts.filter((thought) => thought.placed).length;
  const active = map.threads.find((thread) => thread.id === map.active);
  return <div className="template">
    <p><strong>{brick.name}</strong> · {map.threads.length} {map.threads.length === 1 ? "topic" : "topics"} · {placed} {placed === 1 ? "thought" : "thoughts"}{landed && ` · last landed on ${landed}`}</p>
    {active && <button type="button" className="template-open" onClick={() => actions.openThread(active.id)}>Open {active.title}</button>}
  </div>;
}

/** Host attaches these styles only for this mount. */
export const styles = pluginStyle0;
