// Where bricks show in the app (docs/bricks.md): each kind in its place, each brick's code loaded only once it's on,
// and each behind a boundary of its own, so a brick that breaks says so in one line, with its switch, while the rest
// of the page carries on. The playground (bricks/playground.tsx) mounts a brick the same way, against a sample map.
import { Component, lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import type { BrickActions, BrickInfo, BrickKind, BrickOn, BrickProps, MapSnapshot } from "./bricks/contract";
import { BRICKS, brickEvents, landingWatcher, snapshotOf, switchBrick, useBricksOn, type Brick } from "./bricks-core";
import { onReading } from "./apps-audio";
import type { World } from "./core";
import "./bricks.css";

/** What every brick on the page is handed (contract.ts `BrickProps`, but its own brick.json). */
export type BrickHost = { map: MapSnapshot; actions: BrickActions; on: BrickOn };

/** This window's host: the map from its world (`revision`: the core's snapshot count, so a reconnect's catch-up isn't
 *  taken for landings), the app's own actions (`act`, the latest each render, behind actions that keep their
 *  identity), and events: landings seen here, and the mic's loudness as the core is sent it (apps-audio.ts). */
export function useBrickHost(world: World, revision: number, me: string, connected: boolean, rooms: ReadonlyMap<string, string>, act: BrickActions): BrickHost {
  const map = useMemo(() => snapshotOf(world, me, connected, rooms), [world, me, connected, rooms]);
  const latest = useRef(act);
  useLayoutEffect(() => { latest.current = act; });
  const actions = useMemo<BrickActions>(() => ({
    addThought: (text) => latest.current.addThought(text),
    openThread: (id) => latest.current.openThread(id),
    select: (id) => latest.current.select(id),
    notify: (text) => latest.current.notify(text),
    listen: (on) => latest.current.listen(on),
  }), []);
  const [events] = useState(brickEvents);
  const on = useMemo<BrickOn>(() => (name, listener) => name === "loudness" ? onReading(listener as (level: number) => void) : events.on(name, listener), [events]);
  const [landings] = useState(landingWatcher);
  useEffect(() => {
    for (const landing of landings(world.thoughts, me, revision)) events.emit("landed", landing);
  }, [world.thoughts, me, revision, landings, events]);
  return useMemo(() => ({ map, actions, on }), [map, actions, on]);
}

const components = new Map<string, LazyExoticComponent<ComponentType<BrickProps>>>();
function componentOf(brick: Brick) {
  let component = components.get(brick.info.id);
  if (!component) components.set(brick.info.id, component = lazy(brick.load));
  return component;
}

/** One brick in its kind's place: a view in the map's (padded clear of the dock, as the Palace is), a card in the
 *  dock (its height counted with the dock's cards, so a thought just shown moves clear of it), a panel or an input
 *  wherever it places itself. Only a new map, a switch or a new action re-renders it, not the page's clock. */
export const BrickMount = memo(function BrickMount({ brick, host }: { brick: Brick; host: BrickHost }) {
  const Shown = componentOf(brick);
  const { info } = brick;
  const inner = <BrickBoundary info={info}><Suspense fallback={null}><Shown map={host.map} actions={host.actions} on={host.on} brick={info} /></Suspense></BrickBoundary>;
  if (info.kind === "view") return <main className="brick-view" aria-label={info.name} data-brick={info.id}>{inner}</main>;
  if (info.kind === "card") return <div className="brick-card" data-brick={info.id} data-dock-card>{inner}</div>;
  return <div className="brick-float" data-brick={info.id}>{inner}</div>;
});

/** Every brick of `kind` that's on, in the Catalog's order. With none on, nothing at all. */
export const BrickSlot = memo(function BrickSlot({ kind, host }: { kind: BrickKind; host: BrickHost }) {
  const on = useBricksOn();
  return <>{BRICKS.filter((brick) => brick.info.kind === kind && on.has(brick.info.id)).map((brick) => <BrickMount key={brick.info.id} brick={brick} host={host} />)}</>;
});

/** A brick that throws shows one quiet line with a way to switch it off, not the page's "Something broke" (Crash.tsx). */
class BrickBoundary extends Component<{ info: BrickInfo; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };

  static getDerivedStateFromError() {
    return { broken: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(`The ${this.props.info.name} brick stopped:`, error);
  }

  render() {
    if (!this.state.broken) return this.props.children;
    const { info } = this.props;
    const floating = info.kind === "panel" || info.kind === "input";
    return <p className={floating ? "brick-broke brick-broke-floating" : "brick-broke"} role="status">
      <span>{info.name} stopped working.</span>
      <button type="button" onClick={() => switchBrick(info.id, false)}>Switch it off</button>
    </p>;
  }
}
