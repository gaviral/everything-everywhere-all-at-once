import { useMemo } from "react";
import { usePluginState, type BrickProps } from "../contract";
import { exampleSections, readingSections } from "./content";
import { ReadingControls, type Display } from "./controls";
import { ReadingDocument } from "./document";
import { ReadingVisit } from "./visit-state";
import pluginStyles from "./contextual-folds.css?inline";

export default function ContextualFolds(props: BrickProps) {
  const scope = JSON.stringify([props.map.visitKey ?? props.map.mapIdentity ?? "local", props.map.me]);
  return <ReadingVisit key={scope} scope={scope}><QuietReading {...props} /></ReadingVisit>;
}

function QuietReading({ map, actions }: BrickProps) {
  const sections = useMemo(() => readingSections(map), [map.threads, map.thoughts]);
  const [content, setContent] = usePluginState<boolean | null>("example", null);
  const [display, setDisplay] = usePluginState<Display>("display", { identity: false, time: false });
  const example = content ?? !sections.length;
  return <section className="contextual-folds" aria-label="Quiet reader" data-guide="contextual-folds">
    <ReadingControls example={example} changeContent={setContent} display={display} changeDisplay={setDisplay} close={actions.closeView} />
    <p className="contextual-folds-context">{example ? "Example conversation · a neighbourhood library · local practice only" : "Original words from this map"}
      {!example && !map.connected && " · disconnected · last received words"}</p>
    {example || sections.length ? <ReadingDocument key={example ? "example" : "map"} sections={example ? exampleSections : sections}
      context={{ display, example, actions, connected: map.connected, isAI: name => !example && !!map.speakers.get(name)?.ai }} />
      : <div className="contextual-folds-empty"><p>No placed words on this map yet.</p><button type="button" onClick={() => setContent(true)}>Read the example</button></div>}
  </section>;
}

export const styles = pluginStyles;
