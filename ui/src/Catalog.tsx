// The Catalog (docs/bricks.md): every brick the app has, each with its one line and its switch, grouped by where it
// shows; those not fit to switch on in front of people fold away under "Not for the demo". Opened from the Apps panel,
// a modal sheet as Recap is (Esc, ×, or a click outside closes it). A switch acts at once, and only in this browser.
import { useEffect, useRef } from "react";
import type { BrickKind } from "./bricks/contract";
import { BRICKS, closeCatalog, KINDS, switchBrick, useBricksOn, useCatalogOpen, type Brick } from "./bricks-core";
import "./bricks.css";

/** Each kind's heading and what it means for a person. */
const GROUPS: Record<BrickKind, [title: string, line: string]> = {
  view: ["Views", "Other ways to see the map, beside Map and Palace"],
  card: ["Cards", "Small cards above the composer"],
  input: ["Inputs", "More ways to add a thought or point at one"],
  panel: ["Panels", "Tools that float over the page"],
};

/** Only while open: closed, the page has no sheet at all. */
export function Catalog() {
  return useCatalogOpen() ? <CatalogSheet /> : null;
}

function CatalogSheet() {
  const on = useBricksOn();
  const sheet = useRef<HTMLDialogElement>(null);
  // Modal from its first frame, as Recap is: the page behind holds still, × rings only when the focus before it did
  // (the keyboard), and focus goes back where it was (the Apps panel's Catalog button) when it closes.
  useEffect(() => {
    const dialog = sheet.current!;
    const previous = document.activeElement as HTMLElement | null;
    const ring = !!previous?.matches(":focus-visible");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    const close = dialog.querySelector<HTMLButtonElement>(".catalog-close");
    close?.blur();
    close?.focus({ focusVisible: ring });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  const ready = BRICKS.filter((brick) => brick.info.demoSafe);
  const more = BRICKS.filter((brick) => !brick.info.demoSafe);
  const count = BRICKS.filter((brick) => on.has(brick.info.id)).length;
  return <dialog ref={sheet} className="catalog" aria-labelledby="catalog-title" onCancel={(event) => { event.preventDefault(); closeCatalog(); }}
    onClick={(event) => { if (event.target === event.currentTarget) closeCatalog(); }}>
    <div className="catalog-top">
      <div>
        <h2 id="catalog-title">Catalog</h2>
        <p>Parts of the app you can switch on or off · {count} of {BRICKS.length} on</p>
      </div>
      <button type="button" className="catalog-close" onClick={closeCatalog} aria-label="Close">×</button>
    </div>
    <Groups bricks={ready} on={on} />
    {more.length > 0 && <details className="catalog-more">
      <summary>Not for the demo · {more.length}</summary>
      <Groups bricks={more} on={on} />
    </details>}
    <p className="catalog-foot">Each is a brick: a folder of its own in the app's code, listed here as soon as it's added. Switches are kept in this browser.</p>
  </dialog>;
}

function Groups({ bricks, on }: { bricks: readonly Brick[]; on: ReadonlySet<string> }) {
  return <>{KINDS.filter((kind) => bricks.some((brick) => brick.info.kind === kind)).map((kind) => (
    <section key={kind} className="catalog-group" aria-label={GROUPS[kind][0]}>
      <h3>{GROUPS[kind][0]} <span>{GROUPS[kind][1]}</span></h3>
      <ul>
        {bricks.filter((brick) => brick.info.kind === kind).map(({ info }) => {
          const shown = on.has(info.id);
          return <li key={info.id} className="catalog-row">
            <div><strong>{info.name}</strong><p>{info.does}</p></div>
            <button type="button" className={shown ? "apps-switch on" : "apps-switch"} role="switch" aria-checked={shown} aria-label={info.name}
              onClick={() => switchBrick(info.id, !shown)}>{shown ? "On" : "Off"}</button>
          </li>;
        })}
      </ul>
    </section>
  ))}</>;
}
