import { useEffect, useMemo, useState } from "react";
import { LookPicker, type Look } from "./looks/LookPicker";
import "./looks/looks.css";
import type { BrickProps } from "../contract";
import { PartDimensions } from "../../msg1351/part-dimensions";
import type { CodePart } from "../../code-canvas/types";
import { knownParts, thisDemo } from "./this-demo";
import "./example.css";

export default function PartDimensionsExample({ actions }: BrickProps) {
  const [look, setLook] = useState<Look>("paper");
  const [source, setSource] = useState<CodePart[] | null>(null);
  useEffect(() => {
    const leaving = new AbortController();
    fetch("/code-canvas/snapshot", { cache: "no-store", signal: leaving.signal })
      .then(response => response.ok ? response.json() : null)
      .then(snapshot => setSource(snapshot?.parts ?? null))
      .catch(() => {});
    return () => leaving.abort();
  }, []);
  const parts = useMemo(() => knownParts(source), [source]);
  const presentation = useMemo(() => thisDemo(parts), [parts]);
  return <section data-look={look} className="part-dimensions-example" aria-label="This demo as parts" data-guide="part-dimensions">
    <div><strong>This demo, as parts{source ? ` · ${source.length.toLocaleString()} real parts in the source` : ""}</strong><LookPicker look={look} onChange={setLook} /><button onClick={() => actions.openCatalog("part-dimensions")}>Features</button></div>
    <PartDimensions enabled graph={{ parts }} presentation={presentation} />
  </section>;
}
