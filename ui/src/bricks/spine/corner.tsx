// Camera controls describe reading, topic scanning and overview; stable internal stop ids keep existing preferences and shortcuts.
export type Stop = "words" | "titles" | "pictures";
export const STOPS: { stop: Stop; label: string; key: string; does: string }[] = [
  { stop: "words", label: "Read", key: "1", does: "every word, at reading size" },
  { stop: "titles", label: "Topics", key: "2", does: "read topic names; drag to see more" },
  { stop: "pictures", label: "Overview", key: "3", does: "scan topic landmarks; drag to explore" },
];

const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");

/** The follow's mark: a ring with you in the middle. */
function FollowIcon() {
  return <svg className="spine-follow-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="8" cy="8" r="2" fill="currentColor" />
  </svg>;
}

export function Corner({ following, title, stop, narrow, follow, seeAll, choose, lens, switchLens }: {
  lens?: "time" | "topics"; switchLens?(view: "time" | "topics"): void;
  following: boolean; title: string; stop: Stop; narrow: boolean;
  follow(): void; seeAll(): void; choose(stop: Stop): void;
}) {
  const followButton = <button type="button" className={cls("spine-pill", "spine-follow", following && "spine-following")} aria-pressed={following} aria-keyshortcuts="F" data-camera-follow onClick={follow}
    title={following ? "View follows new thoughts. Turn off to explore freely (F)" : "View stays where you leave it. Turn on to follow new thoughts (F)"}>
    <FollowIcon />
    <span className="spine-follow-word">{following ? "Auto-follow on" : "Auto-follow off"}</span>
    {title && !narrow && <><span className="spine-follow-sep" aria-hidden="true">·</span><span className="spine-follow-title">{title}</span></>}
    {!narrow && <kbd className="spine-key">F</kbd>}
  </button>;
  const lenses = lens && <div className="spine-lenses spine-stops" role="group" aria-label="Organize thoughts">
    {(["time", "topics"] as const).map(view => <button key={view} type="button" className="spine-stop" aria-pressed={lens === view} onClick={() => switchLens?.(view)}>{view === "time" ? "Time" : "Topics"}</button>)}
  </div>;
  const zooms = <div className="spine-stops" role="group" aria-label="Map zoom">
    {STOPS.map(s => <button key={s.stop} type="button" className="spine-stop" data-zoom-stop={s.stop} aria-pressed={stop === s.stop}
      aria-keyshortcuts={s.key} onClick={() => choose(s.stop)} title={`${s.label}: ${s.does} (${s.key})`}>
      {s.label}{!narrow && <kbd className="spine-key">{s.key}</kbd>}
    </button>)}
  </div>;
  const fit = <button type="button" className="spine-pill" data-camera-fit aria-label="Fit map in view" aria-keyshortcuts="0" onClick={seeAll} title="Fit the whole map in view (0)">Fit map{!narrow && <kbd className="spine-key">0</kbd>}</button>;
  if (narrow) return <>
    {lenses}<div className="spine-phone-zoom"><span className="spine-zoom-label">Map zoom</span>{zooms}</div>
    {followButton}{fit}
  </>;
  return <div className="spine-camera" role="group" aria-label="Camera">
    <div className="spine-camera-row"><span className="spine-zoom-label">Map zoom</span>{lenses}{zooms}{fit}</div>
    {followButton}
  </div>;
}
