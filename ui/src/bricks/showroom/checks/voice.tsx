import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BrickOn } from "../../contract";
import { useNavigation } from "../useNavigation";

let receive: (words: string) => void = () => {};
const on: BrickOn = (name, listener) => {
  if (name === "words") receive = listener as (words: string) => void;
  return () => { receive = () => {}; };
};
Object.assign(window, { showroomWords: (words: string) => receive(words) });
function VoiceCheck() {
  const [position, setPosition] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const move = useCallback((step: number) => setPosition(value => value + step), []);
  useNavigation(on, enabled, move);
  return <><output data-position>{position}</output><button id="pause" onClick={() => setEnabled(value => !value)}>Pause</button><input aria-label="Editing control" /></>;
}
createRoot(document.getElementById("root")!).render(<VoiceCheck />);
