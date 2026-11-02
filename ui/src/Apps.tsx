import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { useCore } from "./core";
import { DESCRIBE_APP, playedLine, tooLongForApp, type AppBuild, type MiniApp, type Watcher } from "./apps-core";
import { playTune, unlockTune } from "./apps-audio";
import "./apps.css";
import { TIPS } from "./Tips";

type Core = ReturnType<typeof useCore>;

// "every day", "every 2 hours", "every 15 minutes": the largest unit that divides it evenly.
function every(secs: number): string {
  const units: [number, string][] = [[604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]];
  const [size, unit] = units.find(([size]) => secs % size === 0) ?? [1, "second"];
  return secs === size ? `every ${unit}` : `every ${secs / size} ${unit}s`;
}

function watching(w: Watcher): string {
  switch (w.kind) {
    case "new_thought": return w.min_points && w.min_points > 1 ? `A new thought, after ${w.min_points} points` : "A new thought";
    case "phrase": return `Hearing “${w.phrase}”`;
    case "topic": return `Talking about ${w.topic}`;
    case "volume": return `Loud voices for ${w.seconds} seconds`;
    // "Fri, Nov 6, 7:00 PM", not "11/6/2026, 7:00:00 PM".
    case "time": return `${new Date(w.at_ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${w.every_secs ? `, then ${every(w.every_secs)}` : ""}`;
    case "app_request": return "An app request";
  }
}

function Blocks({ app }: { app: MiniApp }) {
  return <ol className="apps-blocks" aria-label="App steps">
    <li><small>When</small>{watching(app.watcher)}</li>
    {app.prompt && <li><small>Consider</small>{app.watcher.kind === "app_request" ? "Look for an existing app" : "One prompt"}</li>}
    {app.publishers.map((p, i) => <li key={i}><small>Then</small>{p.kind === "card" ? "Show a card"
      : p.kind === "sound" ? app.watcher.kind === "volume" ? "Play a silly tune" : "Play a light tune" : "Propose a reminder"}</li>)}
  </ol>;
}

const working = (build: AppBuild) => ["searching", "composing", "validating"].includes(build.stage);
/** Waiting for Keep or Discard (Use this app or Dismiss, for an app you already have). */
const deciding = (build: AppBuild) => build.stage === "ready" || build.stage === "matched";
const decided = (build: AppBuild) => build.stage === "kept" || build.stage === "discarded";
const withoutApp = (build: AppBuild) => build.stage === "declined" || build.stage === "failed";

/** What the build has done, a line a step; the last is where it is now (`latest`: that one only). */
function Steps({ build, live = false, latest = false }: { build: AppBuild; live?: boolean; latest?: boolean }) {
  const busy = working(build);
  const from = latest ? build.steps.length - 1 : 0;
  return <ol className="apps-progress" aria-live={live ? "polite" : undefined} aria-relevant={live ? "additions text" : undefined}>
    {build.steps.map((step, i) => {
      if (i < from) return null;
      const last = i === build.steps.length - 1;
      return <li key={`${build.id}-${i}`} style={{ animationDelay: `${(i - from) * 70}ms` }}>
        {last && busy ? <span className="apps-spinner" aria-hidden="true" />
          : <span aria-hidden="true">{!last ? "✓" : build.stage === "failed" ? "×" : build.stage === "declined" ? "–" : "✓"}</span>}{step}
      </li>;
    })}
  </ol>;
}

function Decisions({ build, core, onDecide }: { build: AppBuild; core: Core; onDecide?: () => void }) {
  const matched = build.stage === "matched";
  const decide = (keep: boolean) => { onDecide?.(); core.decideApp(build.id, keep); };
  return <div className="apps-decisions">
    <button disabled={!core.connected} onClick={() => decide(true)}>{matched ? "Use this app" : "Keep app"}</button>
    <button className="quiet" disabled={!core.connected} onClick={() => decide(false)}>{matched ? "Dismiss" : "Discard"}</button>
  </div>;
}

export function Apps({ core }: { core: Core }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  // Only an app asked for here shows here; one said or typed in the composer builds in the dock (DockBuild), so the
  // map under this panel stays where it is.
  const build = core.apps.inPanel ? core.apps.build : null;
  // The core makes one app at a time: while any build works or waits for Keep, so does the form.
  const waiting = !!core.apps.build && (working(core.apps.build) || deciding(core.apps.build));
  const buildArea = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (!core.snapshotRevision || initialized.current) return;
    initialized.current = true;
    if (core.world.apps.length === 0) setOpen(true);
  }, [core.snapshotRevision, core.world.apps.length]);
  useEffect(() => {
    if (open && build && ["searching", "ready", "matched", "declined", "failed", "kept"].includes(build.stage)) {
      buildArea.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      if ((deciding(build) || withoutApp(build)) && (document.activeElement === document.body || document.activeElement?.closest(".apps-form"))) {
        buildArea.current?.focus({ preventScroll: true });
      }
    }
  }, [build?.id, build?.stage, open]);
  // Typed here (or picked as the closest app): the build shows here, and the panel stays open after Keep or Discard.
  const compose = (text: string) => {
    core.apps.askedInPanel(text);
    if (!core.composeApp(text)) { core.apps.askedInPanel(null); return false; }
    setOpen(true);
    return true;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!request.trim() || waiting || !core.connected) return;
    // What the core would answer, without sending what it would refuse.
    if (tooLongForApp(request)) { core.showNotice(DESCRIBE_APP); return; }
    if (compose(request.trim())) setRequest("");
  };
  const matched = core.world.apps.find((a) => a.id === build?.match_id);
  const play = () => {
    const playful = !!core.apps.soundPending?.playful;
    unlockTune();
    window.setTimeout(() => {
      if (playTune(playful)) core.apps.clearSound();
      else core.showNotice("Sound isn't available in this browser right now.");
    }, 50);
  };
  const enabledCount = core.world.apps.filter((a) => a.enabled).length;
  return <aside className={`apps-panel${open ? " is-open" : ""}${core.apps.soundPending ? " has-sound" : ""}`} aria-label="Apps">
    <div className="apps-heading">
      <button className="apps-title" aria-expanded={open} aria-controls="apps-content" onClick={() => setOpen(!open)}>
        <strong>Apps</strong><span>{enabledCount} on</span><span className="apps-toggle">{open ? "Close" : "Open"}</span>
      </button>
      {open && <button className="apps-new" onClick={() => document.getElementById("app-request")?.focus()}>Make an app</button>}
    </div>
    {core.apps.soundPending && <div className="apps-sound" role="status">
      <span>{core.apps.soundPending.name} has a {core.apps.soundPending.playful ? "silly" : "quiet"} tune for you{core.apps.soundPending.why ? `: ${core.apps.soundPending.why}` : ""}.</span><button onClick={play}>Play tune</button>
      <button onClick={core.apps.clearSound} aria-label="Dismiss tune">×</button>
    </div>}
    {open && <div id="apps-content">
      {build && <div className={`apps-build ${build.stage}`} ref={buildArea} tabIndex={-1} role="region" aria-label="App being composed">
        <p className="apps-request">“{build.request}”</p>
        <Steps build={build} live />
        {build.stage === "declined" && build.instead && <div className="apps-instead">
          <p>Closest app: “{build.instead}”</p>
          <div className="apps-decisions"><button disabled={!core.connected} onClick={() => compose(build.instead)}>Make that instead</button></div>
        </div>}
        {build.draft && !decided(build) && <div className="apps-preview">
          <strong>{build.draft.name}</strong><p>{build.draft.purpose}</p><Blocks app={build.draft} />
          {build.draft.prompt && <details><summary>Prompt</summary><p className="apps-prompt">{build.draft.prompt.system}</p></details>}
          {build.draft.publishers.some((p) => p.kind === "reminder") && <p className="apps-help">Reminders wait for your approval on the map.</p>}
        </div>}
        {matched && build.stage === "matched" && <div className="apps-preview"><a href={`#app-${matched.id}`}>{matched.name}</a><p>{matched.purpose}</p><Blocks app={matched} /></div>}
        {deciding(build) && <Decisions build={build} core={core} />}
        {decided(build) && <p role="status">{build.message}</p>}
      </div>}
      <form className="apps-form" onSubmit={submit}>
        <label htmlFor="app-request">What would you like an app to do?</label>
        <div><input id="app-request" value={request} onChange={(e) => setRequest(e.target.value)} maxLength={2000}
          placeholder="Show a card when I mention the demo" disabled={waiting} />
          <button disabled={!core.connected || !request.trim() || waiting}>Make app</button></div>
        <p className="apps-help">{waiting && !build ? "Keep or discard the app at the bottom of the screen first." : "You can also say “make an app that…” while the mic is on."}</p>
      </form>
      <div className="apps-list">
        {core.world.apps.length > 0 && <h2 className="apps-list-heading">Your apps</h2>}
        {core.world.apps.map((app) => <article className="apps-row" key={app.id} id={`app-${app.id}`}>
          <div className="apps-info"><strong>{app.name}</strong><p>{app.purpose}</p>
            <details><summary>Steps</summary><Blocks app={app} />
              {app.prompt && <p className="apps-prompt">{app.prompt.system}</p>}
              <button className="apps-remove" disabled={!core.connected} onClick={() => core.removeApp(app.id)}>Remove app</button>
            </details>
            {app.id === "app-volume" && app.watcher.kind === "volume" && <label className="apps-output">When it gets loud
              <select aria-label={`${app.name} response`} value={app.publishers.some((p) => p.kind === "sound") ? "sound" : "card"}
                disabled={!core.connected} onChange={(e) => { if (e.target.value === "sound") unlockTune(); core.appOutput(app.id, e.target.value === "sound"); }}>
                <option value="sound">Play a silly tune, with a card</option><option value="card">Show a calm card only</option>
              </select>
            </label>}
          </div>
          <button className={`apps-switch ${app.enabled ? "on" : ""}`} role="switch" aria-checked={app.enabled}
            aria-label={app.name} disabled={!core.connected} onClick={() => core.toggleApp(app.id, !app.enabled)}>{app.enabled ? "On" : "Off"}</button>
        </article>)}
      </div>
    </div>}
  </aside>;
}

// The dock's cards rise and settle as the unfinished card does (App.tsx).
const spring = { type: "spring", stiffness: 220, damping: 28 } as const;

/** How long the line after Keep or Discard stays before the card goes: about a second to look at it, then 240 words
 *  a minute. "Loud Silly Tune · Your app is on." stays 2.75 s, "App discarded." 1.5 s. */
const readingMs = (text: string) => 1000 + 250 * (text.match(/[\p{L}\p{N}']+/gu)?.length ?? 0);

/** A tune an app just played, said in the dock beside your live words, where your eyes are when it plays (the Apps
 *  panel above the map is often scrolled away): "♪ Loud Silly Tune: voices stayed loud for 3 s". Up for reading
 *  time (`readingMs`, about 3 s), as the line after Keep is; a second tune restarts it. It grows the dock as a card
 *  does, so it carries data-dock-card: a thought that just landed under it moves clear (App.tsx). A tune played from
 *  the Apps panel's "Play tune" shows no line: that card said which app and why where you clicked. */
export function DockTune({ core }: { core: Core }) {
  const played = core.apps.played;
  const { setPlayed } = core.apps;
  useEffect(() => {
    if (!played) return;
    const timer = window.setTimeout(() => setPlayed((shown) => (shown?.id === played.id ? null : shown)), readingMs(playedLine(played)));
    return () => window.clearTimeout(timer);
  }, [played?.id]);
  return <AnimatePresence>
    {played && <motion.div key="dock-tune" className="dock-tune" role="status" data-dock-card initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
      <span className="dock-tune-mark" aria-hidden="true">♪</span><span><strong>{played.name}</strong>{played.why ? `: ${played.why}` : " played its tune"}</span>
    </motion.div>}
  </AnimatePresence>;
}

/** An app asked for by voice or in the composer builds here, in the dock with your live words: its steps while it
 *  works, then the app in a line with its blocks and Keep or Discard, a short line after, then it goes. It used to
 *  open the Apps panel above the map and scroll to it, so the map left the screen mid-talk and came back with a
 *  jump. The dock publishes its height and the map's end makes room for it (App.tsx), so the map stays put; only a
 *  thought you said in the last 10 s that the card would cover moves clear of it, once, as for the unfinished card
 *  (data-dock-card). `onLeave` takes focus that was in the card when it goes (to the composer). */
/** The build the dock's card shows: the current one, unless the panel has it or the card was dismissed (`gone`). */
export function dockBuild(apps: Core["apps"], gone: string | null) {
  const current = apps.build;
  return current && !apps.inPanel && current.id !== gone ? current : null;
}

/** Whether a build still wants the person: its card in the dock, or one in the panel not yet kept or discarded. The
 *  core keeps the last build after it's decided, so `apps.build` alone stays set for the rest of the visit. */
export function buildInTheWay(apps: Core["apps"], gone: string | null) {
  return !!dockBuild(apps, gone) || (!!apps.build && apps.inPanel && !decided(apps.build));
}

/** `dismissed`: the card's dismissal held by the page, so others in the dock (the install hint) see it go too. */
export function DockBuild({ core, onLeave, dismissed }: { core: Core; onLeave: () => void;
  dismissed?: [string | null, (id: string) => void] }) {
  const own = useState<string | null>(null);
  const [gone, setGone] = dismissed ?? own;
  const build = dockBuild(core.apps, gone);
  const card = useRef<HTMLDivElement>(null);
  // A choice made from the keyboard: when its buttons go, focus stays in the card instead of falling to the page.
  const keyed = useRef(false);
  const matched = core.world.apps.find((a) => a.id === build?.match_id);
  const app = build?.draft ?? matched;
  const confirmation = !build || !decided(build) ? "" : build.stage === "kept" && app ? `${app.name} · ${build.message}` : build.message;
  const leave = (id: string) => {
    // Keyboard focus in the card would fall to the page; a click's or a tap's isn't moved (a tap on a phone would
    // open its keyboard).
    const focused = document.activeElement;
    if (focused && card.current?.contains(focused) && (focused === card.current || focused.matches(":focus-visible"))) onLeave();
    setGone(id);
  };
  useEffect(() => {
    if (!build || !decided(build)) return;
    const timer = window.setTimeout(() => leave(build.id), readingMs(confirmation));
    return () => window.clearTimeout(timer);
  }, [build?.id, build?.stage]);
  useEffect(() => {
    if (!build) return;
    const lost = !document.activeElement || document.activeElement === document.body;
    // As in the panel: a card that needs you takes focus when nothing else has it, so Tab reaches Keep next.
    if (lost && (keyed.current || deciding(build) || withoutApp(build))) card.current?.focus({ preventScroll: true });
    keyed.current = false;
  }, [build?.id, build?.stage]);
  const status = !build ? ""
    : working(build) ? `Making an app: ${build.steps.at(-1) ?? ""}`
    : build.stage === "ready" && app ? `${app.name}: ${app.purpose} ${build.message}`
    : build.stage === "declined" && build.instead ? `${build.message} Closest app: ${build.instead}.`
    : decided(build) ? confirmation : build.message;
  return <>
    <div className="sr-only" role="status">{status}</div>
    <AnimatePresence>
      {build && <motion.div key="dock-build" ref={card} tabIndex={-1} className={`dock-build ${build.stage}`} role="group" aria-label="App being composed" data-dock-card
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={spring}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !withoutApp(build)) return;
          event.preventDefault();
          event.stopPropagation();
          leave(build.id);
        }}>
        <span className="dock-build-mark" aria-hidden="true" data-tip={build.stage === "kept" ? undefined : TIPS.build}>{build.stage === "kept" ? "✓" : "✦"}</span>
        <div className="dock-build-text">
          {app && (deciding(build) || build.stage === "kept")
            ? <p className="dock-build-title"><strong>{app.name}</strong><span> · {build.stage === "kept" ? build.message : app.purpose}</span></p>
            : <p className="dock-build-title">{working(build) && <strong>Making an app: </strong>}<span>{decided(build) ? build.message : `“${build.request}”`}</span></p>}
          {build.stage === "ready" && build.draft ? <Blocks app={build.draft} /> : !decided(build) && <Steps build={build} latest={!working(build)} />}
          {build.stage === "declined" && build.instead && <p className="dock-build-instead">Closest app: “{build.instead}”</p>}
        </div>
        {deciding(build) && <Decisions build={build} core={core} onDecide={() => { keyed.current = !!document.activeElement?.matches(":focus-visible"); }} />}
        {withoutApp(build) && <div className="apps-decisions">
          {build.stage === "declined" && build.instead && <button disabled={!core.connected} onClick={() => core.composeApp(build.instead)}>Make that instead</button>}
          <button className="quiet" onClick={() => leave(build.id)}>Dismiss</button>
        </div>}
      </motion.div>}
    </AnimatePresence>
  </>;
}
