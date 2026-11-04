import { useEffect, useRef, type RefObject } from "react";
import { FREQUENCIES, isQuiet, localDay, type Frequency, type Preferences } from "./state";
import { useWaterReading } from "./water";

export function CareGlyph({ water = false }: { water?: boolean }) {
  return <svg className="care-prompts-glyph" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    {water ? <path d="M24 5C21 12 10 22 10 30a14 14 0 0 0 28 0C38 22 27 12 24 5Z" fill="currentColor" opacity=".8" />
      : <><path d="M24 39C10 34 7 18 10 9c13 0 25 12 14 30Z" fill="currentColor" opacity=".5" /><path d="M24 39C20 23 28 11 41 9c1 16-5 26-17 30Z" fill="currentColor" /><path d="M24 40V27" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
  </svg>;
}

type SettingsProps = {
  preferences: Preferences; now: number; saved: boolean; open: boolean;
  opener: RefObject<HTMLButtonElement | null>;
  close(): void; start(): void; stop(): void; example(): void; water(): void;
  configure(patch: Partial<Preferences>): void;
};

function WaterCard({ preferences, now, active, water }: Pick<SettingsProps, "preferences" | "now" | "water"> & { active: boolean }) {
  const reading = useWaterReading(active);
  const total = preferences.water.day === localDay(now) ? preferences.water.total : 0;
  return <section className="care-prompts-water" aria-label="Water today">
    <div className="care-prompts-water-top"><CareGlyph water /><div><h3>Water, at your pace</h3><p aria-live="polite">{total} {total === 1 ? "glass" : "glasses"} tapped today</p></div></div>
    <button type="button" className="care-prompts-water-button" onClick={water}>I had a glass of water <span aria-hidden="true">＋</span></button>
    <p className="care-prompts-source">Phone water: {reading ? `${reading.total} glasses · ${reading.stale ? "Stale reading" : "Updated"} ${new Date(reading.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Unavailable"}</p>
    <p className="care-prompts-fine">{reading ? "Phone readings stay separate from your taps." : "No phone source connected. Your taps work here."}</p>
  </section>;
}

function TimingControls({ preferences: p, configure }: Pick<SettingsProps, "preferences" | "configure">) {
  return <fieldset className="care-prompts-timing"><legend>Your rhythm</legend>
    <label className="care-prompts-frequency">A gentle prompt every
      <select value={p.frequency} onChange={event => configure({ frequency: Number(event.target.value) as Frequency })}>
        {FREQUENCIES.map(value => <option key={value} value={value}>{value} minutes</option>)}
      </select>
    </label>
    <label className="care-prompts-toggle"><input type="checkbox" checked={p.quiet} onChange={event => configure({ quiet: event.target.checked })} /><span>Quiet hours</span></label>
    {p.quiet && <><div className="care-prompts-hours">
      <label>From<input aria-label="Quiet hours from" type="time" required value={p.start} onChange={event => { if (event.target.validity.valid && event.target.value) configure({ start: event.target.value }); }} /></label>
      <span aria-hidden="true">→</span>
      <label>Until<input aria-label="Quiet hours until" type="time" required value={p.end} onChange={event => { if (event.target.validity.valid && event.target.value) configure({ end: event.target.value }); }} /></label>
    </div><p className="care-prompts-fine">This device’s local time. {p.start === p.end ? "Matching times keep the whole day quiet." : "No prompts during these hours."}</p></>}
  </fieldset>;
}

export function CareSettings(props: SettingsProps) {
  const { preferences: p, now, open, opener } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) { dialog.current.close(); opener.current?.focus({ preventScroll: true }); }
  }, [open, opener]);
  return <dialog ref={dialog} className="care-prompts-settings" aria-labelledby="care-prompts-title" onCancel={props.close} onClose={props.close}>
    <div className="care-prompts-settings-top"><span className="care-prompts-eyebrow">A LITTLE ROOM FOR YOU</span><button type="button" className="care-prompts-close" aria-label="Close care settings" onClick={props.close}>×</button></div>
    <div className="care-prompts-heading"><CareGlyph /><h2 id="care-prompts-title">Small pauses.<br />Your choice.</h2></div>
    <p className="care-prompts-intro">A quiet nudge to take a break or have some water. Only if you’d like one.</p>
    <div className="care-prompts-example"><span>EXAMPLE PROMPT</span><p>Take a break<span aria-hidden="true">↗</span></p><button type="button" onClick={props.example}>Try the corner prompt</button></div>
    <TimingControls preferences={p} configure={props.configure} />
    <WaterCard preferences={p} now={now} active={open} water={props.water} />
    <div className="care-prompts-consent">
      <p role="status">{p.enabled ? isQuiet(p, now) ? "On · resting for quiet hours" : `On · every ${p.frequency} minutes` : "Off · no prompts until you agree"}</p>
      {p.enabled ? <button type="button" className="care-prompts-stop" onClick={props.stop}>Stop all prompts</button>
        : <button type="button" className="care-prompts-start" onClick={props.start}>Yes, turn on my prompts</button>}
      <p className="care-prompts-fine">For you, in this tab. Nothing is sent or shared. You can stop at any time.</p>
      {!props.saved && <p className="care-prompts-fine" role="status">Storage is unavailable. Reloading will reset your choices.</p>}
    </div>
  </dialog>;
}

export function CornerPrompt({ water, example, dismiss }: { water: boolean; example: boolean; dismiss(): void }) {
  return <button className="care-prompts-prompt" type="button" onClick={dismiss} aria-label={`${example ? "Example: " : ""}${water ? "Had some water?" : "Take a break"}. Dismiss prompt`}>
    <CareGlyph water={water} /><span><small>{example ? "EXAMPLE · JUST A PREVIEW" : "A MOMENT FOR YOU"}</small><strong>{water ? "Had some water?" : "Take a break"}</strong><small>Tap to dismiss <span aria-hidden="true">✓</span></small></span>
  </button>;
}
