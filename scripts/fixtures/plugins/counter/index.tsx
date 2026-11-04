import { useEffect } from "react";
import { usePluginState, type BrickProps } from "../../../../ui/src/bricks/contract";
export default function Counter({ on, lifetime }: BrickProps) {
  const [count, setCount] = usePluginState("count", 0);
  const [draft, setDraft] = usePluginState("draft", "");
  useEffect(() => on("notice", () => setCount(n => n + 1)), [on, setCount]);
  useEffect(() => { const timer = setInterval(() => {}, 1000); return lifetime?.cleanup(() => clearInterval(timer)); }, [lifetime]);
  return <section className="counter"><label>Plugin draft<input aria-label="Plugin draft" value={draft} onChange={e => setDraft(e.target.value)} /></label><button onClick={() => setCount(n => n + 1)}>Count {count}</button></section>;
}
