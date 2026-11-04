import type { VariantReference as Reference } from "./contracts";

export function VariantReference({ reference }: { reference: Reference }) {
  return <div className="demo-variants-reference">
    <h3>{reference.title}</h3>
    <dl><dt>Original reference</dt><dd>{reference.branchId}</dd><dt>Canvas</dt><dd>{reference.canvasId}</dd></dl>
    <p>Original retained</p>
  </div>;
}
