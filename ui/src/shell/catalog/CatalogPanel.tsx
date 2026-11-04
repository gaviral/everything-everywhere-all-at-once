import { Component, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { CatalogTab, type CatalogRow } from "../Shell";
import { NAMES } from "../names";
import { newCatalogSession, setOrganization, useOrganization, type CatalogSession } from "./preference";

export type OrganizedProps = { rows: CatalogRow[]; at: string | null; currentView: string; active: boolean; session: CatalogSession };
class LoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** The baseline stays eager. Only an opted-in, open ordinary visit requests the renderer and its CSS. */
export function CatalogPanel({ eligible, ...props }: Omit<OrganizedProps, "session"> & { eligible: boolean }) {
  const enabled = useOrganization();
  const session = useRef(newCatalogSession());
  const [Renderer, setRenderer] = useState<ComponentType<OrganizedProps> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!eligible || !enabled || !props.active || Renderer || failed) return;
    let alive = true;
    import("./OrganizedCatalog").then((module) => { if (alive) setRenderer(() => module.default); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [eligible, enabled, props.active, Renderer, failed]);
  if (!eligible) return <CatalogTab rows={props.rows} at={props.at} />;
  const off = () => {
    setOrganization(false);
    requestAnimationFrame(() => {
      const root = document.querySelector('[data-catalog-preference]');
      const list = root?.closest(".shell-catalog");
      const id = session.current.detail;
      const row = id ? list?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`) : null;
      const target = row?.querySelector<HTMLElement>("button:not(:disabled)") ?? list?.querySelector<HTMLElement>("button:not(:disabled)");
      target?.scrollIntoView({ block: "nearest" });
      target?.focus({ preventScroll: true });
    });
  };
  // names-ok: the presentation preference's required name, distinct from capability names.
  const preference = <div className="shell-foot" data-catalog-preference style={{ position: "sticky", top: -14, zIndex: 2,
    background: "var(--surface-2)", margin: 0, padding: "8px 0 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    <span>{NAMES.catalogTab.organization} </span>
    <button type="button" className="shell-link" style={{ minHeight: 32 }} role="switch" aria-label={NAMES.catalogTab.organization} aria-checked={enabled}
      onClick={() => enabled ? off() : setOrganization(true)}>{enabled ? "Off · restore original list" : "Enable"}</button>
  </div>;
  if (!enabled) return <CatalogTab rows={props.rows} at={props.at} header={preference} />;
  const fallback = <><p role="status" className="shell-foot">Organization could not load. The original list is available below.</p><CatalogTab rows={props.rows} at={props.at} /></>;
  return <div className="catalog-presentation">
    {preference}
    {failed ? fallback : Renderer ? <LoadBoundary fallback={fallback}><Renderer {...props} session={session.current} /></LoadBoundary>
      : <p role="status" className="shell-foot">Loading feature organization…</p>}
  </div>;
}
