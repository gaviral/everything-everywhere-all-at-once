// The Catalog (docs/bricks.md): every brick the app has, each with its one line and its switch, grouped by where it
// shows; those not fit to switch on in front of people fold away under "Not for the demo". Opened from the Apps panel,
// or by a brick (`openCatalog`, at a brick's row: shown, marked and its switch focused), a modal sheet as Recap is (Esc,
// ×, or a click outside closes it). A switch acts at once, and only in this browser.
import { BUILT_INS, featureAvailable, switchBuiltIn, useBuiltInsOn } from "./shell/features";
import { FEATURE_NAMES } from "./shell/names";
import { useEffect, useRef } from "react";
import type { BrickKind } from "./bricks/contract";
import { BRICKS, closeCatalog, KINDS, switchBrick, useBricksOn, useCatalogAt, useCatalogOpen, type Brick } from "./bricks-core";
import "./bricks.css";
import { AppParts, type AppPartsState } from "./AppParts";
import type { MiniApp } from "./apps-core";

/** Each kind's heading and what it means for a person. */
const GROUPS: Record<BrickKind, [title: string, line: string]> = {
  view: ["Views", "Other ways to see the map, beside Cards and Pictures"],
  card: ["Cards", "Small cards above the input box"],
  input: ["Inputs", "More ways to add a thought or point at one"],
  panel: ["Panels", "Tools that float over the page"],
};

/** Only while open: closed, the page has no sheet at all. */
export function Catalog({ apps, state }: { apps: readonly MiniApp[]; state: AppPartsState }) {
  return useCatalogOpen() ? <CatalogSheet apps={apps} state={state} /> : null;
}

function CatalogSheet({ apps, state }: { apps: readonly MiniApp[]; state: AppPartsState }) {
  const on = useBricksOn();
  const builtIns = useBuiltInsOn();
  const at = useCatalogAt();
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
    if (!at) close?.focus({ focusVisible: ring });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  // Asked for a brick's row: shown (out of "Not for the demo" if it's folded there), marked, and its switch focused.
  useEffect(() => {
    if (!at) return;
    const row = sheet.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(at.id)}"]`);
    const folded = row?.closest("details");
    if (folded) folded.open = true;
    row?.scrollIntoView({ block: "center" });
    row?.querySelector<HTMLButtonElement>("[role=switch]")?.focus({ preventScroll: true, focusVisible: true });
  }, [at]);
  const ready = BRICKS.filter((brick) => brick.info.demoSafe);
  const more = BRICKS.filter((brick) => !brick.info.demoSafe);
  const count = BRICKS.filter((brick) => on.has(brick.info.id)).length + Number(builtIns.has("compare-phone-reading"));
  return <dialog ref={sheet} className="catalog" aria-labelledby="catalog-title" onCancel={(event) => { event.preventDefault(); closeCatalog(); }}
    onClick={(event) => { if (event.target === event.currentTarget) closeCatalog(); }}>
    <div className="catalog-top">
      <div>
        <h2 id="catalog-title">Features</h2>
        <p>Features you can switch on or off · {count} of {BRICKS.length + 1} on</p>
      </div>
      <button type="button" className="catalog-close" onClick={closeCatalog} aria-label="Close">×</button>
    </div>
    {apps.length > 0 && <section className="catalog-apps" aria-label="Built apps">
      <h3>Built apps · inspect their parts</h3>
      {apps.map((app) => <article className="catalog-app" key={app.id}><strong>{app.name}</strong><p>{app.purpose}</p>
        <AppParts app={app} apps={apps} state={state} />
      </article>)}
    </section>}
    <section className="catalog-group" aria-label="Built in"><h3>Built in</h3><ul>
      {BUILT_INS.filter(b => b.id === "compare-phone-reading").map(b => <li className="catalog-row" data-row={b.id} key={b.id}>
        <div><strong>{FEATURE_NAMES[b.id].name}</strong><p>{FEATURE_NAMES[b.id].does}</p></div>
        <button type="button" className="apps-switch" role="switch" aria-label={FEATURE_NAMES[b.id].name} aria-checked={builtIns.has(b.id)} onClick={() => switchBuiltIn(b.id, !builtIns.has(b.id))}>{builtIns.has(b.id) ? "On" : "Off"}</button>
      </li>)}
    </ul></section>
    {featureAvailable("helpers") && <section className="catalog-group" aria-label="Thinking helpers"><ul><li className="catalog-row">
      <div><strong>Thinking helpers</strong><p>Say “put five helpers on the pitch”. Read their answers in Work spine.</p></div>
      <button type="button" className={builtIns.has("helpers") ? "apps-switch on" : "apps-switch"} role="switch" aria-checked={builtIns.has("helpers")} aria-label="Thinking helpers" onClick={() => switchBuiltIn("helpers", !builtIns.has("helpers"))}>{builtIns.has("helpers") ? "On" : "Off"}</button>
    </li></ul></section>}
    <Groups bricks={ready} on={on} at={at?.id ?? null} />
    {more.length > 0 && <details className="catalog-more">
      <summary>Not for the demo · {more.length}</summary>
      <Groups bricks={more} on={on} at={at?.id ?? null} />
    </details>}
    <p className="catalog-foot">Each feature is a small add-on, listed here as soon as it's available. Your choices are kept in this browser.</p>
  </dialog>;
}

function Groups({ bricks, on, at }: { bricks: readonly Brick[]; on: ReadonlySet<string>; at: string | null }) {
  return <>{KINDS.filter((kind) => bricks.some((brick) => brick.info.kind === kind)).map((kind) => (
    <section key={kind} className="catalog-group" aria-label={GROUPS[kind][0]}>
      <h3>{GROUPS[kind][0]} <span>{GROUPS[kind][1]}</span></h3>
      <ul>
        {bricks.filter((brick) => brick.info.kind === kind).map(({ info }) => {
          const shown = on.has(info.id);
          return <li key={info.id} className={info.id === at ? "catalog-row catalog-at" : "catalog-row"} data-row={info.id} aria-current={info.id === at || undefined}>
            <div><strong>{info.name}</strong><p>{info.does}</p></div>
            <button type="button" className={shown ? "apps-switch on" : "apps-switch"} role="switch" aria-checked={shown} aria-label={info.name}
              onClick={() => switchBrick(info.id, !shown)}>{shown ? "On" : "Off"}</button>
          </li>;
        })}
      </ul>
    </section>
  ))}</>;
}
