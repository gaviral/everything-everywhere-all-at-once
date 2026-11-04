import { createRoot, type Root } from "react-dom/client";
import { switchBrick } from "../../bricks-core";
import { dismissNotice, noticeDismissed, useRecovery } from "./state";
import "./self-heal.css";

function Notices() {
  const { stopped } = useRecovery();
  return <aside className="self-heal-notices" aria-label="Feature recovery notices" aria-live="polite">
    {Object.entries(stopped).filter(([id]) => !noticeDismissed(id)).map(([id, feature]) => <section className="self-heal-notice brick-broke" key={id}>
      <strong>{feature.name} stopped.</strong>
      <p>We switched it off in this browser. The rest of your page is still here.</p>
      <div><button type="button" onClick={() => switchBrick(id, true)}>Turn it back on<span className="self-heal-sr">: {feature.name}</span></button>
        <button type="button" onClick={() => dismissNotice(id)} aria-label={`Dismiss ${feature.name} notice`}>Dismiss</button></div>
    </section>)}
  </aside>;
}
let root: Root | undefined;
/** A separate notice root survives the failed feature unmounting, including a failed main view. */
export function ensureNotices() {
  if (root) return;
  const element = document.createElement("div");
  element.dataset.selfHeal = "";
  document.body.append(element);
  root = createRoot(element);
  root.render(<Notices />);
}
