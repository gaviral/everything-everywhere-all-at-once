import { useCallback, useEffect, useRef, useState } from "react";
import { usePluginState, type BrickProps } from "../contract";
import { GROUPS, featureEnabled, inGroup, setFeature, useFeatures, type Feature, type Group } from "./catalog";
import { FeatureCard, GroupPicker, ReturnDecision, ShowroomDialog } from "./parts";
import { revealFeature } from "./navigation";
import { useCardFocus, useNavigation } from "./useNavigation";
import "./showroom.css";

export default function Showroom({ actions, on, map }: BrickProps) {
  const features = useFeatures();
  const [visit, setVisit] = usePluginState<{ group: Group; selected: number }>("showroom:visit", { group: "New today", selected: 0 });
  const [mode, setMode] = useState<"browse" | "try" | "decide" | "closed">("browse");
  const [trial, setTrial] = useState<Feature | null>(null);
  const [notice, setNotice] = useState("");
  const stopNavigation = useRef<() => void>(() => {});
  useEffect(() => () => stopNavigation.current(), []);
  const group = visit.group;
  const matching = inGroup(features, group);
  const selected = Math.min(visit.selected, Math.max(0, matching.length - 1));
  const pageStart = Math.floor(selected / 4) * 4;
  const move = useCallback((step: number) => setVisit(old => ({ ...old, selected: Math.max(0, Math.min(matching.length - 1, old.selected + step)) })), [matching.length, setVisit]);
  useNavigation(on, mode === "browse", move);
  useCardFocus(mode === "browse", `${group}:${selected}`);

  const tryFeature = (feature: Feature) => {
    stopNavigation.current(); setFeature(feature, true);
    if (!featureEnabled(feature)) { setNotice(`${feature.name} is unavailable in this mode.`); return; }
    setTrial(feature); setMode("try"); setNotice("");
    if (feature.kind === "view" && map.threads.length === 0 && !["decisions", "choice-map", "focused-find", "spine"].includes(feature.id)) {
      actions.notify(`${feature.name} is on. Add a thought to the map to see this view.`);
      return;
    }
    stopNavigation.current = revealFeature(feature, actions, () => {
      setNotice(`${feature.name} is on. Its view could not open; choose Show in Features.`);
      setMode("browse");
    });
  };
  const decide = (keep: boolean) => {
    stopNavigation.current(); if (trial) setFeature(trial, keep);
    setMode("browse"); setNotice(trial ? `${trial.name} ${keep ? "kept on" : "turned off"}.` : ""); setTrial(null);
  };

  if (mode === "try" && trial) return <button className="showroom-back" onClick={() => { stopNavigation.current(); setMode("decide"); }}>← Back to showroom</button>;
  if (mode === "decide" && trial) return <ReturnDecision feature={trial} keep={() => decide(true)} off={() => decide(false)} resume={() => setMode("try")} />;
  if (mode === "closed") return <button className="showroom-back" onClick={() => setMode("browse")}>Open showroom ↗</button>;
  return <ShowroomDialog label="Feature showroom" close={() => setMode("closed")}>
    <div className="showroom-heading"><div><p className="showroom-eyebrow">The feature collection · {features.length} to explore</p><h1>Find what stays.</h1><p className="showroom-intro">Try it on your map. Keep what you love.</p></div><button className="showroom-close" onClick={() => setMode("closed")} aria-label="Close showroom">×</button></div>
    <GroupPicker group={group} counts={GROUPS.map(name => inGroup(features, name).length)} choose={group => { setVisit({ group, selected: 0 }); setNotice(""); }} />
    <div className="showroom-cards">{matching.slice(pageStart, pageStart + 4).map((feature, i) => <FeatureCard key={feature.id} feature={feature} number={pageStart + i + 1} selected={selected === pageStart + i} select={() => setVisit({ group, selected: pageStart + i })} tryFeature={() => tryFeature(feature)} />)}</div>
    {!matching.length && <p className="showroom-empty">No features in this group yet. Explore another collection.</p>}
    <div className="showroom-footer"><div><p role="status">{notice || `${selected + (matching.length ? 1 : 0)} of ${matching.length} · ${group}`}</p><p className="showroom-hint">← → to explore · Say “next” or “back” if already listening</p></div><div className="showroom-paging"><button onClick={() => move(-1)} disabled={selected === 0} aria-label="Previous feature">←</button><button onClick={() => move(1)} disabled={selected >= matching.length - 1} aria-label="Next feature">→</button></div></div>
  </ShowroomDialog>;
}
