// Deliberately broken features live only in this check entry, never in the feature registry.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrickMount, type BrickHost } from "../../src/BrickSlot";
import { Crash } from "../../src/Crash";
import { addBrick, isOn, switchBrick, useBricksOn, type Brick } from "../../src/bricks-core";
import { CatalogPanel } from "../../src/shell/catalog/CatalogPanel";
import type { BrickProps } from "../../src/bricks/contract";

const mode = new URLSearchParams(location.search).get("failure");
let shouldThrow = false;
let releases = 0;
function Throwing({ lifetime }: BrickProps) {
  const [, update] = useState(0);
  useEffect(() => lifetime?.cleanup(() => { releases++; document.querySelector("output")!.textContent = `${releases} resource released`; }), [lifetime]);
  if (shouldThrow) throw new Error("Synthetic render failure");
  return <button onClick={() => { shouldThrow = true; update(n => n + 1); }}>Break one feature</button>;
}
function Healthy() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(n => n + 1)}>Healthy feature: {count}</button>;
}
const healthy: Brick = { info: { id: "synthetic-healthy", name: "Healthy example", does: "Focused check", kind: "panel", defaultOn: true, demoSafe: true }, load: async () => ({ default: Healthy }) };
// The core Spine policy normally forces this id on; a crash must override that policy too.
const broken: Brick = { info: { id: "spine", name: "Throwing example", does: "Focused check", kind: "panel", defaultOn: true, demoSafe: true }, load: async () => ({ default: Throwing }) };
const late: Brick = { info: { id: "synthetic-lazy", name: "Lazy example", does: "Focused check", kind: "panel", defaultOn: false, demoSafe: true }, load: () => {
  if (mode === "chunk") return import("./late-feature");
  if (mode === "repeat" || mode === "draft") return import("./missing-feature");
  return Promise.reject(new Error("Synthetic lazy import rejection"));
} };
addBrick(healthy);
addBrick(late);
const host = { map: { visitKey: "self-heal-check" }, actionsFor: () => ({}), on: () => () => {} } as unknown as BrickHost;
function Preview() {
  const on = useBricksOn();
  const [features, setFeatures] = useState(false);
  useEffect(() => { if (mode === "chunk" || mode === "repeat") switchBrick(late.info.id, true); }, []);
  const rows = [broken, late].map(({ info }) => ({ id: info.id, name: info.name, does: info.does, kind: "panel", on: on.has(info.id), toggle: () => switchBrick(info.id, !isOn(info.id)) }));
  return <Crash><h1>Your page stays here</h1><output>0 resources released</output>
    {mode === "draft" && <textarea aria-label="Unsaved words" defaultValue="Keep this draft" />}
    <BrickMount brick={healthy} host={host} />
    {!mode && <BrickMount brick={broken} host={host} />}
    {on.has(late.info.id) && <BrickMount brick={late} host={host} />}
    <button onClick={() => switchBrick(late.info.id, true)}>Load lazy feature</button>
    <button onClick={() => { shouldThrow = false; }}>Repair example source</button>
    <button onClick={() => setFeatures(value => !value)}>Features</button>
    {features && <CatalogPanel eligible={false} active rows={rows} at={null} currentView="map" />}
  </Crash>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
