import { useEffect, useState } from "react";
import type { BrickProps } from "../contract";
import { BuildCheck } from "./BuildCheck";
import { CheckTile } from "./CheckTile";
import { TakeSummary } from "./TakeSummary";
import { commitHash, manualChecks, readMapCheck, type Marks } from "./checks";
import checklistStyle from "./take-checklist.css?inline";

const reportedCommit = commitHash(import.meta.env.VITE_BUILD_ID);

function TakeSession({ map, actions }: BrickProps) {
  const [marks, setMarks] = useState<Marks>({});
  const [entered, setEntered] = useState("");
  const [take, setTake] = useState(1);
  const mapCheck = readMapCheck(map);
  const buildChecked = !!reportedCommit || (!!commitHash(entered) && !!marks.build);
  const count = Number(mapCheck.done) + Number(buildChecked) + manualChecks.filter(check => marks[check.id]).length;
  const toggle = (id: keyof Marks) => setMarks(previous => ({ ...previous, [id]: !previous[id] }));
  const reset = () => { setMarks({}); setTake(previous => previous + 1); };

  // A disconnected view cannot carry its human sign-off into a fresh snapshot.
  useEffect(() => { if (!map.connected) setMarks({}); }, [map.connected]);

  return <section className="take-checklist" aria-label="Take checklist" data-guide="take-checklist">
    <TakeSummary count={count} total={8} take={take} onReset={reset} onClose={() => actions.closeView()} />
    <div className="take-checklist-grid">
      <BuildCheck reported={reportedCommit} entered={entered} checked={buildChecked}
        onEnter={value => { setEntered(value); setMarks(previous => ({ ...previous, build: false })); }}
        onToggle={() => toggle("build")} />
      <CheckTile title="Empty map" detail={mapCheck.detail} done={mapCheck.done}
        source={mapCheck.done ? "Live · map is empty" : mapCheck.label} />
      {manualChecks.map(check => <CheckTile key={check.id} title={check.title} detail={check.detail}
        done={!!marks[check.id]} source={marks[check.id] ? "Checked by you" : "Check by hand"}
        onToggle={() => toggle(check.id)} />)}
    </div>
    <p className="take-checklist-footnote">Ticks only record your checks. Nothing is switched on or off.
      <span> Checks reset on leaving this view or disconnecting.</span></p>
  </section>;
}

export default function TakeChecklist(props: BrickProps) {
  return <TakeSession key={`${props.map.mapIdentity ?? props.map.visitKey ?? "visit"}:${props.map.me}`} {...props} />;
}

export const styles = checklistStyle;
