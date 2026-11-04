import { useTriggerParts } from "./controller-part";
import { DictationPart } from "./dictation-part";
import { MatcherControlsPart } from "./matcher-controls-part";
import { StartedParts } from "./started-parts";
import { RedTeamPart } from "./red-team-part";
import type { MatcherId } from "./types";
import style from "./trigger-parts.css?inline";

export default function TriggerParts() {
  const controller = useTriggerParts();
  const { session, result } = controller;
  const counts: Record<MatcherId, number> = { exact: 0, regex: 0, fuzzy: 0, ai: 0 };
  result.triggers.forEach(trigger => { counts[trigger.matcher]++; });
  return <main className="trigger-parts" data-guide="trigger-parts">
    <div className="trigger-parts-title"><div><p className="trigger-parts-kicker">TRIGGER PARTS / FROM SPEECH TO STRUCTURE</p><h1>Words become <em>beginnings.</em></h1><p>A phrase opens a part. See the cause. Question the cut.</p></div><div className="trigger-parts-total"><strong>{String(result.parts.length).padStart(2, "0")}</strong><span>parts from one stream</span></div></div>
    <DictationPart source={session.source} edit={controller.edit} busy={controller.busy} judge={() => void controller.run("split")} aiEnabled={session.switches.ai} />
    <MatcherControlsPart switches={session.switches} toggle={controller.toggle} counts={counts} />
    <p className="trigger-parts-status" role="status">{controller.status}</p>
    <StartedParts result={result} disputes={controller.visibleDisputes} selected={controller.selected} select={controller.setSelected} />
    <RedTeamPart controller={controller} />
    <p className="trigger-parts-footnote">Local review · original words preserved · AI example is labelled · live AI requests use Meta Muse Spark</p>
  </main>;
}
export const styles = style;
