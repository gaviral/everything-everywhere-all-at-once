import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import Hashtags from "../index";
import { tagGroups, taggedThoughts, tagsIn } from "../tags";
import type { BrickActions, BrickProps, Thought, Thread } from "../../contract";

interface FixtureData { thoughts: Thought[]; threads: Thread[]; visitKey: string }
declare global {
  interface Window {
    hashtagsCheck: {
      set(data: FixtureData): void;
      tagsIn: typeof tagsIn;
      index: typeof taggedThoughts;
      groups: typeof tagGroups;
      opened: string[];
    };
  }
}

const opened: string[] = [];
function Fixture() {
  const [data, set] = useState<FixtureData>({ thoughts: [], threads: [], visitKey: "first" });
  const [away, setAway] = useState(false);
  window.hashtagsCheck = { set, tagsIn, index: taggedThoughts, groups: tagGroups, opened };
  const map = { ...data, active: null, me: "you", speakers: new Map(), connected: true,
    questions: [], jobs: [], usage: null, suggestions: [], reminders: [], apps: [], notes: {},
    points: new Map(), rooms: new Map(), topics: [], positions: {}, partial: "" };
  const actions = {
    openThought(id: string) { opened.push(id); setAway(true); return true; },
    closeView() { setAway(true); },
  } as BrickActions;
  const props: BrickProps = { map, actions, on: () => () => {}, brick: {
    id: "hashtags", name: "Hashtags", does: "Tag thoughts", kind: "view", defaultOn: false, demoSafe: true,
  } };
  return away ? <button id="return-to-hashtags" onClick={() => setAway(false)}>Return to Hashtags</button> : <Hashtags {...props} />;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
