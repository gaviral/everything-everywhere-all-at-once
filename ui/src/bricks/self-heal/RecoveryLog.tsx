import { switchBrick } from "../../bricks-core";
import { isStopped, useRecovery } from "./state";
import "./self-heal.css";

export function RecoveryLog({ showEmpty = false }: { showEmpty?: boolean }) {
  const { log } = useRecovery();
  if (!log.length && !showEmpty) return null;
  return <section className="self-heal-log" aria-label="Feature recovery">
    <h3>Feature recovery</h3>
    <p>{log.length ? "Saved in this browser · latest 20 incidents" : "No features have stopped in this browser. Recovery is always ready."}</p>
    {[...log].reverse().map((entry, index) => <article key={`${entry.at}-${index}`}>
      <strong>{entry.name}</strong>
      <p>{isStopped(entry.id) ? "Switched off in this browser" : "Recovery cleared"} · <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time></p>
      <details><summary>Error details</summary><pre>{entry.error}</pre></details>
      {isStopped(entry.id) && <button type="button" onClick={() => switchBrick(entry.id, true)}>Turn it back on<span className="self-heal-sr">: {entry.name}</span></button>}
    </article>)}
  </section>;
}
