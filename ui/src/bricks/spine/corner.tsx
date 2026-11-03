// The camera's corner, bottom left: "Following · title" (it follows your talk; a hand on the map holds it, and this
// brings it back), See all, and the zoom stops (one place at three distances, not three tabs): Words, where every word
// reads; Titles, where the whole map's titles do; Pictures, each thread its picture (a tangent's smaller, beside its topic). Each with its key.
export type Stop = "words" | "titles" | "pictures";
export const STOPS: { stop: Stop; label: string; key: string; does: string }[] = [
  { stop: "words", label: "Words", key: "1", does: "every word, at reading size" },
  { stop: "titles", label: "Titles", key: "2", does: "read topic names; drag to see more" },
  { stop: "pictures", label: "Pictures", key: "3", does: "every topic as its picture" },
];

const cls = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");

/** The follow's mark: a ring with you in the middle. */
function FollowIcon() {
  return <svg className="spine-follow-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="8" cy="8" r="2" fill="currentColor" />
  </svg>;
}

export function Corner({ following, title, stop, narrow, follow, seeAll, choose }: {
  following: boolean; title: string; stop: Stop; narrow: boolean;
  follow(): void; seeAll(): void; choose(stop: Stop): void;
}) {
  const followButton = <button type="button" className={cls("spine-pill", "spine-follow", following && "spine-following")} aria-pressed={following} onClick={follow}
    title={following ? "The view follows your talk: press to hold it still (F)" : "Follow your talk again (F)"}>
    <FollowIcon />
    <span className="spine-follow-word">{following ? "Following" : "Follow"}</span>
    {title && !narrow && <><span className="spine-follow-sep" aria-hidden="true">·</span><span className="spine-follow-title">{title}</span></>}
    {!narrow && <kbd className="spine-key">F</kbd>}
  </button>;
  if (narrow) return following ? null : followButton;
  return <div className="spine-camera" role="group" aria-label="Camera">
    <div className="spine-camera-row">
      <div className="spine-stops" role="group" aria-label="Zoom stops">
        {STOPS.map((s) => <button key={s.stop} type="button" className="spine-stop" aria-pressed={stop === s.stop} onClick={() => choose(s.stop)} title={`${s.label}: ${s.does} (${s.key})`}>
          {s.label}<kbd className="spine-key">{s.key}</kbd>
        </button>)}
      </div>
      <button type="button" className="spine-pill" onClick={seeAll} title="See everything (0)">See all<kbd className="spine-key">0</kbd></button>
    </div>
    {followButton}
  </div>;
}
