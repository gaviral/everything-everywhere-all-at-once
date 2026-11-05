import type { CanonicalGraph, PartReference as Reference } from './contract';

export function resolvePart(graph: CanonicalGraph, reference: Reference) {
  const matches = graph.parts?.filter(part => part.id === reference.id) ?? [];
  if (matches.length !== 1) return { issue: matches.length ? 'Ambiguous part identity' : 'Part unavailable in this snapshot' };
  const part = matches[0];
  if (part.version !== reference.version) return { issue: `Revision unavailable · requested v${reference.version}, snapshot v${part.version}` };
  return { part };
}

export function PartIdentity({ graph, reference }: { graph: CanonicalGraph; reference: Reference }) {
  const resolved = resolvePart(graph, reference);
  return <span className="pd-identity">
    <strong>{resolved.part?.name ?? 'Unavailable contributor'}</strong>
    <span>{reference.id} · v{reference.version}</span>
    {resolved.part ? <small>{resolved.part.file}:{resolved.part.line} · {resolved.part.version_scope}</small>
      : <small role="status">{resolved.issue}</small>}
  </span>;
}
